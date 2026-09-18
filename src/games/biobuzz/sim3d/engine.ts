/**
 * BIOBUZZ 3D PHYSICS — engine bootstrap (Day 1 seam, `docs/biobuzz/plan-3d.md` §2.5, §3.2).
 *
 * The deterministic Rapier 3D wasm module is reached ONLY through a dynamic `import()` inside
 * `initPhysics3d()` — exactly the pattern `scripts/spike3d.ts` (the Day 0 spike) used, and the
 * same reason the shared 2D `initPhysics()` (`src/sim/physicsEngine.ts`) awaits its own module
 * before any step: a client that never steps a 3D world must never pay for the ~1.1 MB gzipped
 * chunk (`docs/biobuzz/spike3d-results.md`). Nothing else lives in this file — building a
 * world, syncing it to `World` JSON, and stepping it are Lane A's `bodies.ts` / `step3d.ts`.
 *
 * DETERMINISM (plan §2.5): `@dimforge/rapier3d-deterministic-compat` is the ONE package this
 * module may import — never the non-compat `-deterministic` build (Day 0 measured it as not a
 * drop-in on this toolchain: no Node/tsx entry point, and Vite's optimizer refuses its wasm
 * import outright) and never the 2D `@dimforge/rapier2d-compat`, which is a different engine
 * for a different solve.
 */

/** the resolved module's shape — `typeof import(...)`, so every caller gets the package's own
 * types without a second, hand-maintained copy of them. */
export type Rapier3d = typeof import('@dimforge/rapier3d-deterministic-compat');

let mod: Rapier3d | null = null;
let inFlight: Promise<void> | null = null;

/**
 * Resolve the wasm module, exactly once per process.
 *
 * IDEMPOTENT and safe to call from every site that might need to be first — the server at
 * boot (beside `initPhysics()`), the smoke suite, a solo 3D practice start, LAN hosting a 3D
 * room: a second call while the first is still in flight awaits the SAME promise rather than
 * importing (and re-initializing) the module twice.
 */
export async function initPhysics3d(): Promise<void> {
  if (mod) return;
  if (!inFlight) {
    inFlight = (async () => {
      // matches the spike's exact call: the compat build needs `init()` before any world uses it.
      const resolved: Rapier3d = await import('@dimforge/rapier3d-deterministic-compat');
      await resolved.init();
      mod = resolved;
    })();
  }
  return inFlight;
}

/** has `initPhysics3d()` resolved? */
export function physics3dReady(): boolean {
  return mod !== null;
}

/**
 * The resolved module.
 *
 * Throws rather than lazily initializing: a call before `initPhysics3d()` has resolved is a
 * bug at the CALL SITE (every step-capable entry point is supposed to await it first, exactly
 * like the 2D `initPhysics()` contract), not a state this function should paper over by
 * kicking off a second, unawaited load.
 */
export function rapier3d(): Rapier3d {
  if (!mod) throw new Error('3D physics not initialised: await initPhysics3d() first');
  return mod;
}

// ---------------------------------------------------------------------------------------------
// THE PERSISTENT WORLD (Day 1, docs/biobuzz/plan-3d.md section 3.2). Everything below is new
// for the 3D port; the loader above is untouched.
// ---------------------------------------------------------------------------------------------

import type { Alliance, Artifact, BallState, RobotState, World } from '../../../types';
import { chassisInertia } from '../../../sim/robot';
import { shoveMass } from '../../../sim/drivetrain';
import { robotExtents } from '../../../sim/physics';
import { PHYS_FRICTION, PHYS_WALL_FRICTION, GRAVITY, PHYS_SOLVER_ITERS, PHYS_CONTACT_FREQ, PHYS_ALLOWED_ERROR } from '../../../config';
import { BB3_CCD_SPEED, BB_POLLEN_R } from '../config';
import {
  buildHiveTray3d,
  buildStatics3d,
  elementMass,
  robotHeightIn,
  ELEMENT_FRICTION,
  ELEMENT_RESTITUTION,
  ELEMENT_ROLL_DAMP,
} from './bodies';
import { hyp3, QUAT_IDENTITY, round4, yawQuat, yawOfQuat } from './math3';

/** the LAST JSON a robot body was synced to -- what `syncRobot` diffs the CURRENT `RobotState`
 * against to decide "did something outside the solve move this" (see plan section 3.2). */
interface LastRobot {
  x: number;
  y: number;
  z: number;
  heading: number;
  vx: number;
  vy: number;
  vz: number;
  angVel: number;
}

/** the LAST JSON an element body was synced to. `fixed` records which BODY KIND it was built
 * as (dynamic ground/flight/hive-cell vs. a fixed flower-parked seat), so a state change that
 * crosses that line (a capture into `held`, a placement into a FLOWER) is caught even when the
 * position happens not to have moved. */
interface LastElement {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  fixed: boolean;
}

export interface Engine3d {
  world3d: InstanceType<Rapier3d['World']>;
  robots: Map<number, InstanceType<Rapier3d['RigidBody']>>;
  elements: Map<number, InstanceType<Rapier3d['RigidBody']>>;
  hiveTrays: Record<Alliance, InstanceType<Rapier3d['RigidBody']>>;
  /** element id -> consecutive ticks under `BB3_REST_SPEED` (`derive.ts`'s cell-membership
   * timer). Reset to 0 the instant an element is faster than that, off by any writer. */
  restTicks: Map<number, number>;
  /** ballId -> consecutive ticks inside an eligible intake mouth (`elements3d.ts`'s
   * capture timer, `BB3_CAPTURE_TICKS`). Separate from `restTicks`: a fast-moving element can
   * still be captured (a slow flight ball), and a resting one outside every mouth never starts
   * this clock. */
  captureTicks: Map<number, number>;
  lastRobot: Map<number, LastRobot>;
  lastElement: Map<number, LastElement>;
  /** `world.tick` as of the last `engineFor` call -- a SMALLER tick next time means a restart
   * or a reseed (a fresh world reusing the same JS object is not a case that arises here, but a
   * scene or a smoke fixture rebuilding `world.tick` back to 0 on the SAME `World` object is),
   * and the engine is rebuilt from scratch rather than asked to reconcile backwards in time. */
  lastTick: number;
  /** how many times the containment safety net has fired this match -- a smoke assertion reads
   * this and expects it to STAY zero; see `containmentPass`. */
  containmentFixes: number;
}

const ENGINES = new WeakMap<World, Engine3d>();

function disposeEngine(e: Engine3d): void {
  e.world3d.free();
}

function buildEngine(world: World): Engine3d {
  const RAPIER = rapier3d();
  const world3d = new RAPIER.World({ x: 0, y: 0, z: -GRAVITY });
  world3d.integrationParameters.lengthUnit = 10; // matches the Day 0 spike's inches convention
  // THE SAME SOLVER TUNING AS THE 2D ROBOT SOLVE (`physicsEngine.ts`'s `makeWorld`), not
  // Rapier3D's own defaults (4 solver iterations, unset contact frequency/allowed error).
  // Parity gap found by measurement (this lane's final report): a robot staged flush against
  // a wall (a real BIOBUZZ start position) spinning on `rotate: 1` for one second gave 2D
  // 0.298 rad/s against 3D 0.691 (ratio 2.317) even after the collider-footprint and
  // wall-friction fixes below; matching these three parameters brought it to 1.458, and the
  // remaining gap turned out to be the check comparing wall-contact friction between two
  // DIFFERENT Rapier solvers rather than the shared drivetrain model -- see the SIM3D lane's
  // drive-feel checks, which now measure in the open field instead.
  world3d.integrationParameters.numSolverIterations = PHYS_SOLVER_ITERS;
  world3d.integrationParameters.contact_natural_frequency = PHYS_CONTACT_FREQ;
  world3d.integrationParameters.normalizedAllowedLinearError = PHYS_ALLOWED_ERROR;
  buildStatics3d(RAPIER, world3d, PHYS_WALL_FRICTION);
  const hiveTrays: Record<Alliance, InstanceType<Rapier3d['RigidBody']>> = {
    red: buildHiveTray3d(RAPIER, world3d, 'red'),
    blue: buildHiveTray3d(RAPIER, world3d, 'blue'),
  };
  const engine: Engine3d = {
    world3d,
    robots: new Map(),
    elements: new Map(),
    hiveTrays,
    restTicks: new Map(),
    captureTicks: new Map(),
    lastRobot: new Map(),
    lastElement: new Map(),
    lastTick: world.tick,
    containmentFixes: 0,
  };
  // DETERMINISTIC BUILD ORDER: statics, the two trays (above), robots by ascending id, elements
  // by ascending id (plan section 3.2 / this lane's binding design point 1).
  for (const r of [...world.robots].sort((a, b) => a.id - b.id)) syncRobot(RAPIER, engine, r);
  for (const b of [...world.balls].sort((a, b) => a.id - b.id)) syncElement(RAPIER, engine, b);
  return engine;
}

/**
 * The persistent 3D engine for `world`, building it on first use and rebuilding it from scratch
 * when `world.tick` has gone BACKWARDS (a restart or a reseed reusing the same `World` object)
 * or the set of robot ids has changed (a robot joined or left). Every other call reuses the same
 * engine and relies on `syncRobot`/`syncElement` to reconcile it to the world's current JSON.
 */
export function engineFor(world: World): Engine3d {
  let e = ENGINES.get(world);
  if (e) {
    const idsNow = world.robots.map((r) => r.id);
    const idsMatch = idsNow.length === e.robots.size && idsNow.every((id) => e!.robots.has(id));
    if (world.tick < e.lastTick || !idsMatch) {
      disposeEngine(e);
      e = undefined;
    }
  }
  if (!e) {
    e = buildEngine(world);
    ENGINES.set(world, e);
  }
  e.lastTick = world.tick;
  return e;
}

const POSE_EPS = 1e-4;

/**
 * Reconcile one robot's body to its current `RobotState` JSON. Creates the body on first use;
 * afterwards, TELEPORTS it (position, rotation, both velocities) only when the JSON has moved
 * by more than `POSE_EPS` since the last sync -- a reconcile snap, a scene edit, a restart --
 * and otherwise leaves it alone so a resting/sleeping body stays asleep.
 *
 * MASS IS RECOMPUTED EVERY TICK, unconditionally, because `shoveMass` depends on `r.powerDraw`,
 * which changes tick to tick (a spun-up flywheel, a running intake) exactly the way the 2D
 * `solveRobots` picks it up fresh every rebuild. Setting mass properties does not move the body,
 * so it cannot fight the "leave a resting body alone" rule above.
 */
function syncRobot(RAPIER: Rapier3d, engine: Engine3d, r: RobotState): void {
  const z = r.z ?? 0;
  const heightIn = robotHeightIn(r.spec);
  const centreZ = z + heightIn / 2;
  const vz = r.vz ?? 0;

  let body = engine.robots.get(r.id);
  if (!body) {
    body = engine.world3d.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(r.pos.x, r.pos.y, centreZ)
        .setRotation(yawQuat(r.heading))
        .setLinvel(r.vel.x, r.vel.y, vz)
        .setAngvel({ x: 0, y: 0, z: r.angVel })
        .enabledRotations(false, false, true),
    );
    /**
     * THE COLLIDER IS THE 2D SOLVE'S FOOTPRINT, NOT THE BARE CHASSIS BOX -- parity bug found by
     * measurement (this lane's final report). `solveRobots` (`src/sim/physicsEngine.ts`) builds
     * its robot-vs-wall/robot-vs-robot collider from `robotExtents` (`front`/`rear`/`half`),
     * which GROWS the box by the intake reach on whichever edge(s) it is mounted (a `frontback`
     * sweeper on both fore-and-aft ends) -- the same shared helper DECODE uses. A body built
     * from `spec.length`/`spec.width` alone is SMALLER on that edge, so a robot staged flush
     * against a wall (a BIOBUZZ start position sits exactly where `robotExtents`' footprint
     * touches it) reads NO wall contact in 3D where 2D has one: measured on the default spec
     * (frontback mount, reach 3) at a wall-flush spawn, one second of `rotate: 1` gave 2D
     * 0.298 rad/s against 3D's 9.011 rad/s (ratio 30.2) -- not an inertia gap (mass 22.657 and
     * inertia 970.49 matched to the last digit in both engines, confirmed by probe) but a
     * MISSING contact: 2D's footprint rear corner sits exactly on the wall's inner face while
     * the undersized 3D box sat 3in clear of it, so the wall's friction never resisted the spin
     * the way it does in 2D. The forward drive-feel case is the same root cause seen from the
     * other side: the same wall-flush spawn has 2D's footprint DRAGGING off the wall for the
     * first few ticks of a forward command, and the undersized 3D box has nothing to drag
     * against, reaching 95% of top speed sooner (2D 1.10s vs 3D 0.95s before this fix).
     *
     * `forward` OFFSETS the box exactly as `physicsEngine.ts` does (`setTranslation(forward, 0)`
     * on the collider) so an asymmetric mount (front-only or back-only reach) grows the correct
     * end -- `hx`/`half` collapse to `spec.length/2`/`spec.width/2` for a mount with no reach,
     * so this is a strict generalization, not a behavior change, for a robot that has none.
     */
    const fe = robotExtents(r);
    const hx = (fe.front + fe.rear) / 2;
    const forward = (fe.front - fe.rear) / 2;
    const collider = RAPIER.ColliderDesc.cuboid(hx, fe.half, heightIn / 2)
      .setTranslation(forward, 0, 0)
      .setDensity(0) // mass comes ENTIRELY from `setAdditionalMassProperties` below, every tick
      .setFriction(PHYS_FRICTION)
      .setRestitution(0);
    engine.world3d.createCollider(collider, body);
    engine.robots.set(r.id, body);
  }

  // the SAME mass `updateRobot`'s wrench was computed against -- see `robot3d.ts`'s header for
  // why the two must agree exactly.
  const m = shoveMass(r.spec, r.butterflyTank, r.powerDraw);
  const inertia = chassisInertia(m, r.spec);
  body.setAdditionalMassProperties(m, { x: 0, y: 0, z: 0 }, { x: inertia, y: inertia, z: inertia }, QUAT_IDENTITY, true);

  const last = engine.lastRobot.get(r.id);
  const changed =
    !last ||
    Math.abs(last.x - r.pos.x) > POSE_EPS ||
    Math.abs(last.y - r.pos.y) > POSE_EPS ||
    Math.abs(last.z - z) > POSE_EPS ||
    Math.abs(last.heading - r.heading) > POSE_EPS ||
    Math.abs(last.vx - r.vel.x) > POSE_EPS ||
    Math.abs(last.vy - r.vel.y) > POSE_EPS ||
    Math.abs(last.vz - vz) > POSE_EPS ||
    Math.abs(last.angVel - r.angVel) > POSE_EPS;
  if (changed) {
    body.setTranslation({ x: r.pos.x, y: r.pos.y, z: centreZ }, true);
    body.setRotation(yawQuat(r.heading), true);
    body.setLinvel({ x: r.vel.x, y: r.vel.y, z: vz }, true);
    body.setAngvel({ x: 0, y: 0, z: r.angVel }, true);
  }
  engine.lastRobot.set(r.id, {
    x: r.pos.x,
    y: r.pos.y,
    z,
    heading: r.heading,
    vx: r.vel.x,
    vy: r.vel.y,
    vz,
    angVel: r.angVel,
  });
}

/** sync every robot in `world.robots` -- exported so `step3d.ts` can call it without reaching
 * into this module's internals for a per-robot loop it would otherwise have to duplicate. */
export function syncRobots(world: World, engine: Engine3d): void {
  const RAPIER = rapier3d();
  for (const r of world.robots) syncRobot(RAPIER, engine, r);
}

/** the robot a chassis-body TRANSLATION corresponds to, for `readback` and `robot3d.ts`'s yaw
 * readout -- kept here rather than duplicated, since it is one half of what `syncRobot` wrote. */
export function robotBodyOf(engine: Engine3d, id: number): InstanceType<Rapier3d['RigidBody']> | undefined {
  return engine.robots.get(id);
}

/** does this `BallState` want an ordinary DYNAMIC sphere body -- everything except `held`,
 * `stock`, and a FLOWER-parked `element` (which is FIXED; see `isFixedFlowerState`)? BIOBUZZ
 * never produces `basin`/`rail` (DECODE/Chain Reaction only), so they fall through to "no body"
 * along with `held`/`stock` -- defensive, not expected. */
function wantsDynamicBody(state: BallState): boolean {
  if (state.kind === 'ground' || state.kind === 'flight') return true;
  if (state.kind === 'element') return !state.el.startsWith('flower:');
  return false;
}

/** a FLOWER-parked element: FIXED at its JSON position (Day 1 shortcut -- the 2D `placeInFlower`
 * parks it there and the real tube is Day 2; see `bodies.ts`'s file header). */
function isFixedFlowerState(state: BallState): boolean {
  return state.kind === 'element' && state.el.startsWith('flower:');
}

function removeElementBody(engine: Engine3d, id: number): void {
  const body = engine.elements.get(id);
  if (!body) return;
  engine.world3d.removeRigidBody(body);
  engine.elements.delete(id);
  engine.lastElement.delete(id);
  engine.restTicks.delete(id);
}

/**
 * Reconcile one artifact's body to its current JSON. A body exists iff `state.kind` is
 * `'ground' | 'flight' | 'element'` (plan section 3.2 rule 2); `'held'`/`'stock'` have none, and
 * are removed here the tick they become that (a capture, a place into a FLOWER's stack, an entry
 * into a human player's hand -- none of those write a position that matters once the body is
 * gone).
 *
 * A KIND CROSSING (dynamic <-> fixed, i.e. entering or leaving a FLOWER's stack) rebuilds the
 * body outright, since a Rapier body's type is fixed at creation. Otherwise this is the same
 * create-once / diff-teleport-or-leave-alone rule `syncRobot` uses.
 */
function syncElement(RAPIER: Rapier3d, engine: Engine3d, b: Artifact): void {
  const wantDynamic = wantsDynamicBody(b.state);
  const wantFixed = isFixedFlowerState(b.state);
  const existing = engine.elements.get(b.id);

  if (!wantDynamic && !wantFixed) {
    removeElementBody(engine, b.id);
    return;
  }

  const last = engine.lastElement.get(b.id);
  if (existing && last && last.fixed !== wantFixed) {
    // crossed the dynamic/fixed line: a fresh body of the other kind, not a mutation of this one
    removeElementBody(engine, b.id);
    syncElement(RAPIER, engine, b);
    return;
  }

  const r = b.r ?? BB_POLLEN_R;
  const centreZ = b.z + r;
  const isNectar = b.color === 'red' || b.color === 'blue';

  if (!existing) {
    let body: InstanceType<Rapier3d['RigidBody']>;
    if (wantFixed) {
      body = engine.world3d.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(b.pos.x, b.pos.y, centreZ),
      );
      engine.world3d.createCollider(
        RAPIER.ColliderDesc.ball(r)
          .setFriction(ELEMENT_FRICTION)
          .setRestitution(ELEMENT_RESTITUTION)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max),
        body,
      );
    } else {
      body = engine.world3d.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(b.pos.x, b.pos.y, centreZ)
          .setLinvel(b.vel.x, b.vel.y, b.vz)
          .setAngularDamping(ELEMENT_ROLL_DAMP)
          .setCcdEnabled(hyp3(b.vel.x, b.vel.y, b.vz) > BB3_CCD_SPEED),
      );
      // MAX COMBINE, NOT THE DEFAULT AVERAGE: the floor is deliberately 0-friction for
      // robots (see bodies.ts's floor comment), and an element resting on it must not inherit
      // that -- MAX(elementFriction, otherSurface) keeps this element's own 0.6 against a
      // 0-friction floor while still reading the higher of the two against anything (a wall, a
      // hive wall, another element) whose own friction happens to exceed it.
      engine.world3d.createCollider(
        RAPIER.ColliderDesc.ball(r)
          .setMass(elementMass(isNectar))
          .setFriction(ELEMENT_FRICTION)
          .setRestitution(ELEMENT_RESTITUTION)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max),
        body,
      );
    }
    engine.elements.set(b.id, body);
    engine.lastElement.set(b.id, { x: b.pos.x, y: b.pos.y, z: b.z, vx: b.vel.x, vy: b.vel.y, vz: b.vz, fixed: wantFixed });
    return;
  }

  const changed =
    !last ||
    Math.abs(last.x - b.pos.x) > POSE_EPS ||
    Math.abs(last.y - b.pos.y) > POSE_EPS ||
    Math.abs(last.z - b.z) > POSE_EPS ||
    (!wantFixed &&
      (Math.abs(last.vx - b.vel.x) > POSE_EPS ||
        Math.abs(last.vy - b.vel.y) > POSE_EPS ||
        Math.abs(last.vz - b.vz) > POSE_EPS));
  if (changed) {
    existing.setTranslation({ x: b.pos.x, y: b.pos.y, z: centreZ }, true);
    if (!wantFixed) existing.setLinvel({ x: b.vel.x, y: b.vel.y, z: b.vz }, true);
  }
  // ONLY TOUCH CCD WHEN IT ACTUALLY CHANGES. `enableCcd` is a write even when the value is
  // unchanged, and (measured) calling any RigidBody setter every tick on a body that would
  // otherwise have gone to sleep keeps resetting its sleep timer -- a resting element then
  // never sleeps and drifts a hair every tick under residual solver noise, which is exactly
  // the "a resting element stays at rest" invariant this port has to hold.
  if (!wantFixed) {
    const wantCcd = hyp3(b.vel.x, b.vel.y, b.vz) > BB3_CCD_SPEED;
    if (existing.isCcdEnabled() !== wantCcd) existing.enableCcd(wantCcd);
  }
  engine.lastElement.set(b.id, { x: b.pos.x, y: b.pos.y, z: b.z, vx: b.vel.x, vy: b.vel.y, vz: b.vz, fixed: wantFixed });
}

/** sync every artifact in `world.balls`. */
export function syncElements(world: World, engine: Engine3d): void {
  const RAPIER = rapier3d();
  for (const b of world.balls) syncElement(RAPIER, engine, b);
}

import { BB_HALF_X, BB_HALF_Y } from '../config';
import { hiveTiltAngle } from './hive3d';
import { tiltQuatX } from './math3';

/**
 * Drive both hive trays' KINEMATIC rotation from `hiveTiltAngle` -- the Day 1 fallback
 * (`BB3_HIVE_DYNAMIC = false`). Called every tick, unconditionally, before `world3d.step()`:
 * a position-based kinematic body only moves when told where to go NEXT, so this is not a
 * diffed sync like `syncRobot`/`syncElement`, it is the tray's whole reason for moving at all.
 */
export function applyHiveTilt(world: World, engine: Engine3d): void {
  for (const a of ['red', 'blue'] as const) {
    const theta = hiveTiltAngle(world, a);
    engine.hiveTrays[a].setNextKinematicRotation(tiltQuatX(theta));
  }
}

/** advance the persistent world one tick. A thin wrapper so `step3d.ts` never touches
 * `engine.world3d` directly -- the persistence itself (never rebuilding a fresh `RAPIER.World`
 * per tick, unlike the 2D `solveRobots`/`solveArtifacts`) is this module's whole contract. */
export function stepWorld3d(engine: Engine3d): void {
  engine.world3d.step();
}

/**
 * READBACK (plan section 3.1 step 6): every dynamic body writes `pos`/`z`/`vel`/`vz` back into
 * `world`, and a robot's `heading`/`angVel` too, all rounded to `round4` so the JSON is the
 * truth and two ticks that are physically identical serialise identically. A FIXED (flower-
 * parked) element is untouched -- it never moves on its own, and its JSON is already correct
 * (the 2D `placeInFlower`/`retrieveFromFlower` bookkeeping wrote it).
 *
 * Also refreshes `engine.last*` to the JSON just written, so next tick's sync sees NO diff
 * unless gameplay (capture/launch/place/derive) changes something in between -- exactly the
 * "leave a resting body alone" contract `syncRobot`/`syncElement` need to hold.
 */
export function readback(world: World, engine: Engine3d): void {
  for (const r of world.robots) {
    const body = engine.robots.get(r.id);
    if (!body) continue;
    const t = body.translation();
    const v = body.linvel();
    const av = body.angvel();
    const heightIn = robotHeightIn(r.spec);
    const z = round4(t.z - heightIn / 2);
    const heading = round4(yawOfQuat(body.rotation()));
    r.pos.x = round4(t.x);
    r.pos.y = round4(t.y);
    r.z = z;
    r.heading = heading;
    r.vel.x = round4(v.x);
    r.vel.y = round4(v.y);
    r.vz = round4(v.z);
    r.angVel = round4(av.z);
    engine.lastRobot.set(r.id, {
      x: r.pos.x,
      y: r.pos.y,
      z,
      heading,
      vx: r.vel.x,
      vy: r.vel.y,
      vz: r.vz,
      angVel: r.angVel,
    });
  }
  for (const b of world.balls) {
    if (isFixedFlowerState(b.state)) continue; // never moves on its own
    const body = engine.elements.get(b.id);
    if (!body) continue;
    const t = body.translation();
    const v = body.linvel();
    const r = b.r ?? BB_POLLEN_R;
    const z = round4(t.z - r);
    b.pos.x = round4(t.x);
    b.pos.y = round4(t.y);
    b.z = z;
    b.vel.x = round4(v.x);
    b.vel.y = round4(v.y);
    b.vz = round4(v.z);
    engine.lastElement.set(b.id, { x: b.pos.x, y: b.pos.y, z, vx: b.vel.x, vy: b.vel.y, vz: b.vz, fixed: false });
  }
}

/**
 * THE CONTAINMENT SAFETY NET (plan section 3.1 step 9) -- a NaN, an element or robot outside
 * the perimeter, or an element centre below the tiles is placed back at the nearest interior
 * floor point, AT REST, on BOTH the body and the JSON, and `engine.containmentFixes` counts it.
 * A smoke check expects this to STAY zero over ordinary play; it exists for the tick the solver
 * genuinely has no better answer, never as the design (see `sim/physics.ts`'s 2D perimeter
 * invariant for the same idea one dimension down).
 */
export function containmentPass(world: World, engine: Engine3d): void {
  const limX = BB_HALF_X - 0.5;
  const limY = BB_HALF_Y - 0.5;
  const clampXY = (x: number, y: number): { x: number; y: number } => ({
    x: Number.isFinite(x) ? Math.max(-limX, Math.min(limX, x)) : 0,
    y: Number.isFinite(y) ? Math.max(-limY, Math.min(limY, y)) : 0,
  });

  for (const r of world.robots) {
    const bad =
      !Number.isFinite(r.pos.x) ||
      !Number.isFinite(r.pos.y) ||
      Math.abs(r.pos.x) > BB_HALF_X ||
      Math.abs(r.pos.y) > BB_HALF_Y;
    if (!bad) continue;
    const p = clampXY(r.pos.x, r.pos.y);
    r.pos.x = p.x;
    r.pos.y = p.y;
    r.vel.x = 0;
    r.vel.y = 0;
    const body = engine.robots.get(r.id);
    if (body) {
      const heightIn = robotHeightIn(r.spec);
      body.setTranslation({ x: p.x, y: p.y, z: (r.z ?? 0) + heightIn / 2 }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    engine.containmentFixes++;
  }

  for (const b of world.balls) {
    if (!wantsDynamicBody(b.state) && !isFixedFlowerState(b.state)) continue;
    const bad =
      !Number.isFinite(b.pos.x) ||
      !Number.isFinite(b.pos.y) ||
      !Number.isFinite(b.z) ||
      Math.abs(b.pos.x) > BB_HALF_X ||
      Math.abs(b.pos.y) > BB_HALF_Y ||
      b.z < -0.5;
    if (!bad) continue;
    const p = clampXY(b.pos.x, b.pos.y);
    b.pos.x = p.x;
    b.pos.y = p.y;
    b.z = 0;
    b.vel.x = 0;
    b.vel.y = 0;
    b.vz = 0;
    const r = b.r ?? BB_POLLEN_R;
    const body = engine.elements.get(b.id);
    if (body) {
      body.setTranslation({ x: p.x, y: p.y, z: r }, true);
      if (!isFixedFlowerState(b.state)) body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    engine.containmentFixes++;
  }
}
