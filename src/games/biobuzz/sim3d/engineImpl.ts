/**
 * BIOBUZZ 3D PHYSICS — the PERSISTENT WORLD (Day 1, `docs/biobuzz/plan-3d.md` §3.2).
 *
 * ⚠️ **HEAVY. This module is reachable ONLY through `sim3d/impl.ts`, which only
 * `initPhysics3d()` (`engine.ts`) imports — and it imports it dynamically.** Everything here
 * used to sit below the loader inside `engine.ts`, which made a static `import` of the loader
 * drag the whole 3D implementation into the MAIN chunk; `npm run bundleaudit` measured that at
 * ~17 KB gz of physics logic every player of every game downloaded whether or not they ever
 * stepped a 3D world. The loader stayed in `engine.ts`; the world moved here, unchanged.
 * Nothing under `src/` outside `sim3d/` may import this file — the RENDER lane asserts it.
 */
import { rapier3d, type Rapier3d } from './engine';

import type { Alliance, Artifact, BallState, RobotState, World } from '../../../types';
import { chassisInertia } from '../../../sim/robot';
import { shoveMass } from '../../../sim/drivetrain';
import { BALL_REST_SPEED, PHYS_FRICTION, PHYS_WALL_FRICTION, GRAVITY, PHYS_SOLVER_ITERS, PHYS_ALLOWED_ERROR } from '../../../config';
import { BB3_CCD_SPEED, BB3_CONTACT_FREQ, BB3_LAUNCH_CLEAR_MAX, BB3_LAUNCH_CLEAR_SLOP, BB3_LAUNCH_CLEAR_STEP, BB3_REST_SPEED, BB3_REST_TICKS, BB3_ROLL_DECEL, BB3_ROLL_FLOOR_Z, BB_POLLEN_R, bbHeightNow } from '../config';
import { chassis3dShapes, type Chassis3dShape } from './bodies';
import {
  buildHiveTray3d,
  buildStatics3d,
  elementMass,
  hiveTrayRefTheta,
  robotHeightIn,
  useHiveDynamic,
  ELEMENT_FRICTION,
  ELEMENT_RESTITUTION,
  ELEMENT_ROLL_DAMP,
} from './bodies';
import { hyp3, QUAT_IDENTITY, round4, yawQuat, yawOfQuat } from './math3';
import { datan2, rot } from '../../../math';

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

/** the LAST JSON an element body was synced to — what `syncElement` diffs against, the same way
 * `LastRobot` works. It used to carry a `fixed` flag recording which BODY KIND the element was
 * built as, back when a flower-parked element was a FIXED body; since Day 2 every element that
 * wants a body at all is dynamic (`wantsDynamicBody`), the flag was written `false` at all three
 * call sites and read nowhere, so it is gone. */
interface LastElement {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface Engine3d {
  world3d: InstanceType<Rapier3d['World']>;
  robots: Map<number, InstanceType<Rapier3d['RigidBody']>>;
  elements: Map<number, InstanceType<Rapier3d['RigidBody']>>;
  hiveTrays: Record<Alliance, InstanceType<Rapier3d['RigidBody']>>;
  /** each tray's REVOLUTE JOINT to its fixed anchor, or `null` on the Day 1 kinematic path
   * (`BB3_HIVE_DYNAMIC` off). Held so the limits can be re-read and so a future motor-based
   * brake has somewhere to live; the detent itself does not need it (see `applyHiveTilt`). */
  hiveJoints: Record<Alliance, InstanceType<Rapier3d['ImpulseJoint']> | null>;
  /** is each tray currently HELD at a stop by the detent? A per-engine cache, not state: it is
   * recomputed from the torque balance every tick and read only for the "do not re-pin a body
   * that is already exactly pinned" guard, which is what keeps a resting element from being
   * re-woken 60 times a second. */
  hiveHeld: Record<Alliance, boolean>;
  /** element id -> consecutive ticks under `BB3_REST_SPEED` (`derive.ts`'s cell-membership
   * timer). Reset to 0 the instant an element is faster than that, off by any writer. */
  restTicks: Map<number, number>;
  lastRobot: Map<number, LastRobot>;
  lastElement: Map<number, LastElement>;
  /**
   * The HEIGHT each robot's chassis collider was actually BUILT to (in) — which is not always
   * `robotHeightIn(spec)`, because of R102's DEPLOY LATCH (plan §3.3).
   *
   * A build taller than R102's 18-in starting cube STOWS to get under it and DEPLOYS when the
   * MATCH begins, so its collider is one box before the `pre` edge and a taller one after, and
   * `bbHeightNow` is the single reader of the phase that decides which. It has to be RECORDED
   * rather than recomputed at each use, because READBACK converts the body's centre z into
   * `RobotState.z` (the chassis BOTTOM) by subtracting half the height: read back against a
   * height the collider was NOT built to and the robot's z jumps by the difference on the deploy
   * tick, which is a robot that visibly sinks into the tiles for one frame and a `worldHash`
   * that moves for no gameplay reason.
   */
  robotHeights: Map<number, number>;
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
  // ⚠️ CONTACT STIFFNESS IS THE ONE PARAMETER THAT IS **NOT** THE 2D ROBOT SOLVE'S.
  // `PHYS_CONTACT_FREQ` (12 Hz) is tuned for DECODE's robot-robot shove and cannot move — its
  // own header records that 15 Hz broke the classifier-jitter ratchet and 25 Hz broke two G408
  // checks. A soft contact sags `g/(2·π·f)²` at rest, which at 12 Hz is 0.068 in of overlap on
  // every resting pair in this world: MEASURED here, an element settled in a HIVE cell sank
  // 0.127 in into the tray floor (3 or 5 elements, both alliances, 900 ticks) and a POLLEN
  // column in a FLOWER tube overlapped itself by up to 0.95 in at capacity. The 2D pipeline
  // already answered this question the other way for BALLS — `PHYS_BALL_CONTACT_FREQ` is 25,
  // "stiffer than the robot world (12 Hz), which let two grounded balls sit visibly
  // overlapping" — and the 3D engine runs ONE world, so it had been giving every element in it
  // the chassis numbers. `BB3_CONTACT_FREQ` is BIOBUZZ's own dial; at 30 Hz the same cell
  // measurement is 0.035 in. See its header in `../config` for the full sweep.
  // ⚠️ `sim3d/predict.ts` builds a SECOND world with a hand-copied parameter block and must
  // carry the same four values, or a predicted contact solves at a different stiffness from the
  // authoritative one and every landed shot reconciles with a snap. The SIM3D lane asserts it.
  world3d.integrationParameters.contact_natural_frequency = BB3_CONTACT_FREQ;
  world3d.integrationParameters.normalizedAllowedLinearError = PHYS_ALLOWED_ERROR;
  buildStatics3d(RAPIER, world3d, PHYS_WALL_FRICTION);
  // THE TRAY IS BUILT AT THE POSE THE WORLD SAYS IT IS IN, not at level: a dynamic body created
  // upright and then rotated into place is a body that falls for one tick, and an engine rebuilt
  // mid-swing (a reconcile, a scene restart) has to resume the swing, not restart it.
  const trayRed = buildHiveTray3d(RAPIER, world3d, 'red', hiveTiltAngle(world, 'red'));
  const trayBlue = buildHiveTray3d(RAPIER, world3d, 'blue', hiveTiltAngle(world, 'blue'));
  const hiveTrays: Record<Alliance, InstanceType<Rapier3d['RigidBody']>> = {
    red: trayRed.body,
    blue: trayBlue.body,
  };
  const hiveJoints: Record<Alliance, InstanceType<Rapier3d['ImpulseJoint']> | null> = {
    red: trayRed.joint,
    blue: trayBlue.joint,
  };
  const engine: Engine3d = {
    world3d,
    robots: new Map(),
    elements: new Map(),
    hiveTrays,
    hiveJoints,
    hiveHeld: { red: true, blue: true },
    restTicks: new Map(),
    lastRobot: new Map(),
    lastElement: new Map(),
    robotHeights: new Map(),
    lastTick: world.tick,
    containmentFixes: 0,
  };
  // DETERMINISTIC BUILD ORDER: statics, the two trays (above), robots by ascending id, elements
  // by ascending id (plan section 3.2 / this lane's binding design point 1).
  for (const r of [...world.robots].sort((a, b) => a.id - b.id)) {
    syncRobot(RAPIER, engine, r, bbHeightNow(world, r.spec));
  }
  for (const b of [...world.balls].sort((a, b) => a.id - b.id)) syncElement(RAPIER, engine, world, b);
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
 * THE CHASSIS COLLIDER, at `heightIn`. Extracted because it is built twice: once when the body
 * is created, and again at the R102 DEPLOY EDGE when a stowed robot stands up (see
 * `Engine3d.robotHeights`). Two copies of this would be two chances for the footprint rule below
 * to drift.
 */
function addChassisCollider(
  RAPIER: Rapier3d,
  engine: Engine3d,
  body: InstanceType<Rapier3d['RigidBody']>,
  r: RobotState,
  heightIn: number,
): void {
  // A COMPOUND WITH AN OPEN MOUTH, not one `robotExtents` cuboid — see `chassis3dShapes`
  // (`bodies.ts`) for what it is and for why the outermost surfaces are unchanged. Every box is
  // density 0; the body's real mass and inertia are written below, every tick.
  for (const s of chassis3dShapes(r.spec, heightIn)) {
    engine.world3d.createCollider(
      RAPIER.ColliderDesc.cuboid(s.hx, s.hy, s.hz)
        .setTranslation(s.cx, s.cy, s.cz)
        .setDensity(0)
        .setFriction(PHYS_FRICTION)
        .setRestitution(0),
      body,
    );
  }
}

/** the height a robot's collider is CURRENTLY built to — the recorded one, falling back to the
 * build's deployed height for a body this engine has not seen yet. Readback and the containment
 * net both have to use it; see `Engine3d.robotHeights`. */
function builtHeight(engine: Engine3d, r: RobotState): number {
  return engine.robotHeights.get(r.id) ?? robotHeightIn(r.spec);
}

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
function syncRobot(RAPIER: Rapier3d, engine: Engine3d, r: RobotState, wantHeight: number): void {
  const z = r.z ?? 0;
  const heightIn = wantHeight;
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
    addChassisCollider(RAPIER, engine, body, r, heightIn);
    engine.robots.set(r.id, body);
    engine.robotHeights.set(r.id, heightIn);
  } else if (Math.abs((engine.robotHeights.get(r.id) ?? heightIn) - heightIn) > 1e-9) {
    /**
     * THE DEPLOY EDGE (plan §3.3): the robot has just stood up (or, on a rewind, sat back down),
     * so the chassis collider is REBUILT at the new height and the body re-seated so its BOTTOM
     * stays where `RobotState.z` says it is. A collider cannot be resized in place, and scaling
     * the body would scale the intake-reach footprint with it.
     *
     * It happens ONCE per robot per match, at the `pre` boundary, and only for a build over
     * R102's cube — every 18-in-and-under robot takes the `!body` path above and never comes
     * back here.
     */
    for (let i = body.numColliders() - 1; i >= 0; i--) {
      engine.world3d.removeCollider(body.collider(i), false);
    }
    addChassisCollider(RAPIER, engine, body, r, heightIn);
    engine.robotHeights.set(r.id, heightIn);
    body.setTranslation({ x: r.pos.x, y: r.pos.y, z: centreZ }, true);
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
  for (const r of world.robots) syncRobot(RAPIER, engine, r, bbHeightNow(world, r.spec));
}

/** the robot a chassis-body TRANSLATION corresponds to, for `readback` and `robot3d.ts`'s yaw
 * readout -- kept here rather than duplicated, since it is one half of what `syncRobot` wrote. */
export function robotBodyOf(engine: Engine3d, id: number): InstanceType<Rapier3d['RigidBody']> | undefined {
  return engine.robots.get(id);
}

/**
 * Does this `BallState` want a DYNAMIC sphere body? Everything except `held` and `stock`.
 *
 * WARNING -- **A FLOWER-PARKED ELEMENT IS DYNAMIC SINCE DAY 2**, and that is the whole
 * flower-tube change seen from the engine's side. It used to be a FIXED body pinned at whatever
 * z the 2D `placeInFlower` computed from `flowerStackZ` -- the Day 1 shortcut, taken because the
 * tube had no geometry to fall through. It has geometry now (`flowerTube.ts`: three real plates
 * with their real bores), so a placed element is dropped at the top ring and SEATS WHERE THE
 * RINGS LET IT, and `derive.ts` reads the column back off the bodies exactly as it reads a hive
 * cell. Nothing in this file distinguishes a flower element from a hive-cell one any more.
 *
 * BIOBUZZ never produces `basin`/`rail` (DECODE/Chain Reaction only), so they fall through to
 * "no body" along with `held`/`stock` -- defensive, not expected.
 */
function wantsDynamicBody(state: BallState): boolean {
  if (state.kind === 'ground' || state.kind === 'flight') return true;
  if (state.kind === 'element') return true;
  return false;
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
/** the distance from a point to a `Chassis3dShape` box, both in the SAME robot frame; 0 inside. */
function boxGap(s: Chassis3dShape, lx: number, ly: number, lz: number): number {
  const dx = Math.max(Math.abs(lx - s.cx) - s.hx, 0);
  const dy = Math.max(Math.abs(ly - s.cy) - s.hy, 0);
  const dz = Math.max(Math.abs(lz - s.cz) - s.hz, 0);
  return hyp3(dx, dy, dz);
}

/** one robot's chassis compound, plus what it takes to put a world point into its frame. */
interface BirthSolid {
  px: number;
  py: number;
  /** the chassis MID-height in world z — `Chassis3dShape.cz` is measured from here */
  pz: number;
  heading: number;
  shapes: readonly Chassis3dShape[];
}

/** is this world-frame sphere centre clear of every chassis solid by at least `need`? */
function clearOfSolids(solids: readonly BirthSolid[], x: number, y: number, z: number, need: number): boolean {
  for (const s of solids) {
    const l = rot({ x: x - s.px, y: y - s.py }, -s.heading);
    const lz = z - s.pz;
    for (const box of s.shapes) if (boxGap(box, l.x, l.y, lz) < need) return false;
  }
  return true;
}

/**
 * ⚠️ **A FLIGHT BODY IS BORN CLEAR OF THE ROBOT THAT THREW IT.** 3D only, by construction: this
 * runs at the moment `syncElement` CREATES a body, and 2D never creates one.
 *
 * A launch point is a point on the MECHANISM, and a mechanism lives inside the robot. On the
 * default 15x17 frame with the default `frontback` mount, `launchLine` releases a dump at
 * `mountOrigin('back')` x = −7.50, z = `BB_LAUNCH_Z0` = 10 — straddling BOTH the frame box
 * (x[−7.50,7.50], z[0,18]) and the back mouth LINTEL (x[−10.50,−7.50], z[3.60,18.00]), which is
 * a closed 3-inch pocket. 2D does not care: a flight element there collides with nothing. In 3D
 * every one of those elements is a real sphere inside a real compound, and the measurement was
 * total — all four rose ~2 in, jammed, and rode the chassis at z≈12 without ever entering
 * flight. **0/28 on the 28-pose tutorial grid; a dumper could not score at all, and 3D is every
 * server-connected match.**
 *
 * The fix belongs HERE and not in the shared release. A shared `launchClearance()` in `robot.ts`
 * was tried and reverted: it took 3D to 3/28 and regressed 2D to 24/28, because it moves the
 * release point every 2D check measures from. The sync rule — a body is teleported only when its
 * JSON differs from what the last readback wrote — is what makes a one-time nudge at CREATION
 * stick instead of being undone on the next tick.
 *
 * ⚠️ **THE MARCH IS ALONG THE ELEMENT'S OWN BALLISTIC ARC, AND THE VELOCITY IS ADVANCED WITH
 * IT** — the body is born a few milliseconds further down the parabola it was solved onto, not
 * translated off it. That distinction is the whole difference between a fix and a different
 * miss, and the measurement says so: a dumper's lob leaves at 80.6° (vh 33.6, vz 203.1 in/s),
 * so the only cheap way out of the pocket is UP, and a straight-ray nudge of 8.9 in raises the
 * RELEASE 8.9 in while leaving the solved `vz` alone. The arc then apexes at 68.5 instead of
 * 63.4, clears the top of the opening band (65.5) and hits the structure above it: 3/28 on the
 * grid, a fix that scored barely better than the bug. Advancing `vz` by `g·t` over the same path
 * puts the apex back at 63.4 and the element back through the opening, descending and inboard,
 * because it is quite literally the same throw — just started `t` later.
 *
 * The JSON is written back so the 2D map, the 3D scene and the body all agree about where the
 * element is. A body that finds no clear point inside `BB3_LAUNCH_CLEAR_MAX` of path is left
 * exactly where the release put it.
 *
 * It runs on EVERY flight body this engine creates, not only on a fresh launch, so an engine
 * REBUILD (`engineFor`: a tick going backwards, a robot joining or leaving) that happens to
 * re-create a mid-air element while it is against a chassis nudges that one too. That is wanted
 * rather than tolerated: creating a body inside a solid is the failure being prevented, whatever
 * put it there, and the nudge is a pure function of the world JSON, so every peer that rebuilds
 * from the same state makes the same one.
 */
function birthClear(engine: Engine3d, world: World, b: Artifact, radius: number): void {
  const sp = hyp3(b.vel.x, b.vel.y, b.vz);
  if (!(sp > 1e-9)) return;
  const solids: BirthSolid[] = [];
  for (const rob of world.robots) {
    const h = builtHeight(engine, rob);
    solids.push({
      px: rob.pos.x,
      py: rob.pos.y,
      pz: (rob.z ?? 0) + h / 2,
      heading: rob.heading,
      shapes: chassis3dShapes(rob.spec, h),
    });
  }
  if (solids.length === 0) return;
  const need = radius + BB3_LAUNCH_CLEAR_SLOP;
  const z0 = b.z + radius;
  if (clearOfSolids(solids, b.pos.x, b.pos.y, z0, need)) return;
  // the march is in TIME, one `BB3_LAUNCH_CLEAR_STEP` of path per sample at the release speed —
  // which is the same thing as stepping along the velocity over these distances (the parabola
  // drops 0.37 in over the 9 in a default dumper needs) while staying exactly on the arc.
  const dt = BB3_LAUNCH_CLEAR_STEP / sp;
  const tMax = BB3_LAUNCH_CLEAR_MAX / sp;
  for (let t = dt; t <= tMax; t += dt) {
    const x = b.pos.x + b.vel.x * t;
    const y = b.pos.y + b.vel.y * t;
    const z = z0 + b.vz * t - 0.5 * GRAVITY * t * t;
    if (clearOfSolids(solids, x, y, z, need)) {
      b.pos = { x, y };
      b.z = z - radius;
      b.vz = b.vz - GRAVITY * t;
      return;
    }
  }
}

function syncElement(RAPIER: Rapier3d, engine: Engine3d, world: World, b: Artifact): void {
  const existing = engine.elements.get(b.id);

  if (!wantsDynamicBody(b.state)) {
    removeElementBody(engine, b.id);
    return;
  }

  const last = engine.lastElement.get(b.id);
  const r = b.r ?? BB_POLLEN_R;
  const isNectar = b.color === 'red' || b.color === 'blue';

  if (!existing && b.state.kind === 'flight') birthClear(engine, world, b, r);
  const centreZ = b.z + r;

  if (!existing) {
    const body = engine.world3d.createRigidBody(
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
    engine.elements.set(b.id, body);
    engine.lastElement.set(b.id, { x: b.pos.x, y: b.pos.y, z: b.z, vx: b.vel.x, vy: b.vel.y, vz: b.vz });
    return;
  }

  const changed =
    !last ||
    Math.abs(last.x - b.pos.x) > POSE_EPS ||
    Math.abs(last.y - b.pos.y) > POSE_EPS ||
    Math.abs(last.z - b.z) > POSE_EPS ||
    Math.abs(last.vx - b.vel.x) > POSE_EPS ||
    Math.abs(last.vy - b.vel.y) > POSE_EPS ||
    Math.abs(last.vz - b.vz) > POSE_EPS;
  if (changed) {
    existing.setTranslation({ x: b.pos.x, y: b.pos.y, z: centreZ }, true);
    existing.setLinvel({ x: b.vel.x, y: b.vel.y, z: b.vz }, true);
  }
  // ONLY TOUCH CCD WHEN IT ACTUALLY CHANGES. `enableCcd` is a write even when the value is
  // unchanged, and (measured) calling any RigidBody setter every tick on a body that would
  // otherwise have gone to sleep keeps resetting its sleep timer -- a resting element then
  // never sleeps and drifts a hair every tick under residual solver noise, which is exactly
  // the "a resting element stays at rest" invariant this port has to hold.
  const wantCcd = hyp3(b.vel.x, b.vel.y, b.vz) > BB3_CCD_SPEED;
  if (existing.isCcdEnabled() !== wantCcd) existing.enableCcd(wantCcd);
  engine.lastElement.set(b.id, { x: b.pos.x, y: b.pos.y, z: b.z, vx: b.vel.x, vy: b.vel.y, vz: b.vz });
}

/** sync every artifact in `world.balls`. */
export function syncElements(world: World, engine: Engine3d): void {
  const RAPIER = rapier3d();
  for (const b of world.balls) syncElement(RAPIER, engine, world, b);
}

import { BB_HALF_X, BB_HALF_Y } from '../config';
import { hiveDetentHold, hiveTiltAngle } from './hive3d';
import { tiltQuatX } from './math3';

/**
 * Drive both hive trays' KINEMATIC rotation from `hiveTiltAngle` -- the Day 1 fallback
 * (`BB3_HIVE_DYNAMIC = false`). Called every tick, unconditionally, before `world3d.step()`:
 * a position-based kinematic body only moves when told where to go NEXT, so this is not a
 * diffed sync like `syncRobot`/`syncElement`, it is the tray's whole reason for moving at all.
 *
 * SUBTRACTS `hiveTrayRefTheta(a)` FROM THE ABSOLUTE TILT -- 0 on the Day 1 fallback (a no-op),
 * the CAD's own capture angle when `BB3_FIELD_COLLIDERS` is on: `bodies.ts`'s tray colliders are
 * built at IDENTITY rotation with their RAW (as-captured) `(v, w)` as translation, so the BODY's
 * own rotation is the ONLY place either the CAD's capture-tilt correction or the live swing
 * happens. An earlier version left colliders at identity here and instead gave EACH one its own
 * extra local rotation (undone on top by this same body rotation) -- that composition checked
 * out by hand and against every geometry check, but measurably destabilized a KINEMATIC body:
 * an element resting inches clear of every collider (confirmed by a direct point-containment
 * query) got a several-hundred-in/s velocity on the very first tick, and it went away completely
 * once no collider carried its own non-identity local rotation. See `buildHiveTray3d`'s own
 * comment for how the collider side of this was simplified to match.
 */
export function applyHiveTilt(world: World, engine: Engine3d): void {
  if (useHiveDynamic()) {
    hiveDetentHold(world, engine);
    return;
  }
  for (const a of ['red', 'blue'] as const) {
    const theta = hiveTiltAngle(world, a) - hiveTrayRefTheta(a);
    engine.hiveTrays[a].setNextKinematicRotation(tiltQuatX(theta));
  }
}

/** the tray body's live tilt (rad) -- a pure x-axis rotation, since the revolute joint removes
 * every other freedom, so the same one-term read `yawOfQuat` does for a chassis about z. */
export function trayTilt(body: InstanceType<Rapier3d['RigidBody']>): number {
  const q = body.rotation();
  return 2 * datan2(q.x, q.w);
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
 * truth and two ticks that are physically identical serialise identically. EVERY element that
 * has a body is read back,
 * including one sitting in a FLOWER -- since Day 2 that is a dynamic sphere in a real tube, not
 * a fixed body parked at a modelled height.
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
    const z = round4(t.z - builtHeight(engine, r) / 2);
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
  /**
   * THE TRAY'S OWN READBACK (Day 2). Under the DYNAMIC see-saw the tray is a solved body like any
   * other, so its pose is JSON: `hives[a].angle` and `angVel`, rounded to 1e-4 like everything
   * else. `hiveTiltAngle` reads that field back and is therefore reading the joint.
   *
   * Absent on the kinematic path -- deliberately, and it is what makes `hiveTiltAngle`'s fallback
   * exact rather than approximate: a kinematic tray's angle is EXACTLY what the timer says, so
   * serialising a rounded copy of it would only introduce a discrepancy with the 2D renderer,
   * which computes the same formula from `tipping`.
   */
  if (useHiveDynamic() && world.biobuzz) {
    for (const a of ['red', 'blue'] as const) {
      const body = engine.hiveTrays[a];
      world.biobuzz.hives[a].angle = round4(trayTilt(body));
      world.biobuzz.hives[a].angVel = round4(body.angvel().x);
    }
  }
  for (const b of world.balls) {
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
    engine.lastElement.set(b.id, { x: b.pos.x, y: b.pos.y, z, vx: b.vel.x, vy: b.vel.y, vz: b.vz });
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
      body.setTranslation({ x: p.x, y: p.y, z: (r.z ?? 0) + builtHeight(engine, r) / 2 }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    engine.containmentFixes++;
  }

  for (const b of world.balls) {
    if (!wantsDynamicBody(b.state)) continue;
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
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    engine.containmentFixes++;
  }
}

/**
 * ⚠️ **ROLLING RESISTANCE IS COULOMB, NOT EXPONENTIAL — AND WITHOUT IT A 3D ELEMENT NEVER
 * STOPS.** Rapier bleeds a rolling sphere's speed with `setAngularDamping`, which is a
 * PROPORTIONAL law: the speed halves, and halves again, and is never zero. The 2D pipeline
 * stops a POLLEN with the shared `stepGroundBall` — a CONSTANT deceleration
 * (`BALL_ROLL_FRICTION`) plus a hard snap under `BALL_REST_SPEED` — which is what a ball on
 * carpet actually does and what gives it a finite roll-out.
 *
 * The cost of the difference was not physical realism, it was the MATCH CLOCK: an element
 * coasting at a speed no player can see held the settle predicate open for seconds after the
 * buzzer (measured by the settle lane before this pass: 6.60 / 7.02 / 8.13 s to finalize on
 * seeds 7 / 21 / 99, against 2D's 0.52 s, every one of them held by a ground element still
 * reading as "moving").
 *
 * WHAT IT DOES, in three cases, and the third is the one that is easy to get wrong:
 *  1. **ON THE TILES** — the shared constant deceleration and the shared rest snap, applied to
 *     the BODY (linear AND angular: a sphere whose spin survived the snap simply rolls off
 *     again on the next tick's contact).
 *  2. **AT REST ON SOMETHING ELSE** — a hive frame bar, a tray floor, a FLOWER's ring plate, a
 *     pile of other elements. No rolling law (it may be on a slope and entitled to slide), but
 *     once it has read at rest for `BB3_REST_TICKS` it is snapped the same way, which is what
 *     stops the damping creep that the JSON-side snap in `derive.ts` could never reach: that one
 *     is gated on the element's TAG, and an element on structure is tagged `flight`.
 *  3. **IN THE AIR** — nothing, ever. An element at the apex of a lob is momentarily slower than
 *     any rest threshold there is, and snapping it would freeze it in mid-air. The
 *     discriminator is CONTACT, asked of the narrow phase, not height or speed.
 */
export function groundRoll3d(world: World, engine: Engine3d, dt: number): void {
  for (const b of world.balls) {
    if (!wantsDynamicBody(b.state)) continue;
    const body = engine.elements.get(b.id);
    if (!body) continue;
    const speed = Math.sqrt(b.vel.x * b.vel.x + b.vel.y * b.vel.y);
    const onFloor = b.z <= BB3_ROLL_FLOOR_Z;

    if (onFloor) {
      // the 2D law, verbatim: constant deceleration, then the hard snap.
      let ns = speed - BB3_ROLL_DECEL * dt;
      if (ns <= 0 || ns < BALL_REST_SPEED) ns = 0;
      const k = speed > 1e-9 ? ns / speed : 0;
      b.vel.x *= k;
      b.vel.y *= k;
      // ⚠️ **THE PLANAR SNAP MUST NOT STEAL A LIVE REBOUND.** This used to read
      // `if (ns === 0) b.vz = 0`, which killed the BOUNCE of anything landing with no planar
      // speed of its own: an element dropped straight down reaches the floor band
      // (`BB3_ROLL_FLOOR_Z`) with `speed` 0, so `ns` is 0, so the `vz` the solver had just
      // given it back was zeroed on the very tick it was earned. MEASURED, a pollen dropped
      // from 24 in: with planar drift it rebounds to 1.19 in (effective e 0.223, which is the
      // element's own 0.45 averaged with the tiles'); dropped vertically it rebounded to
      // nothing at all and crept down to rest instead. The rest snap is a ROLLING law — it is
      // about a ball that will not stop sliding — so it now only takes `vz` when `vz` is
      // itself at rest, and `BALL_REST_SPEED` (2 in/s) is the same threshold the planar half
      // uses. A settled element still snaps exactly as before: its `vz` is already ~0.
      if (ns === 0 && Math.abs(b.vz) < BALL_REST_SPEED) b.vz = 0;
      body.setLinvel({ x: b.vel.x, y: b.vel.y, z: b.vz }, true);
      // THE SPIN GOES WITH IT. Scaled by the same factor while it is rolling, zeroed with it at
      // rest — a stopped sphere still spinning re-accelerates itself through floor contact.
      const w = body.angvel();
      body.setAngvel({ x: w.x * k, y: w.y * k, z: w.z * k }, true);
      continue;
    }

    // OFF THE FLOOR: only an element that is TOUCHING something and has read at rest for a
    // while, and only to stop the creep — never a rolling law, and never in mid-air.
    const still = speed < BB3_REST_SPEED && Math.abs(b.vz) < BB3_REST_SPEED;
    if (!still || (engine.restTicks.get(b.id) ?? 0) < BB3_REST_TICKS) continue;
    let touching = false;
    for (let i = 0; i < body.numColliders() && !touching; i++) {
      engine.world3d.contactPairsWith(body.collider(i), () => {
        touching = true;
      });
    }
    if (!touching) continue;
    b.vel.x = 0;
    b.vel.y = 0;
    b.vz = 0;
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}
