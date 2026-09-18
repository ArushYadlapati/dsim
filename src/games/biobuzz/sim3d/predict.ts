import type { Artifact, RobotCommand, RobotState, Vec2, World } from '../../../types';
import { SIM_DT, PHYS_FRICTION, PHYS_WALL_FRICTION, GRAVITY, PHYS_SOLVER_ITERS, PHYS_CONTACT_FREQ, PHYS_ALLOWED_ERROR } from '../../../config';
import { updateRobot } from '../../../sim/robot';
import { chassisInertia } from '../../../sim/robot';
import { shoveMass } from '../../../sim/drivetrain';
import { robotExtents, squareUpRobotsWalls } from '../../../sim/physics';
import { dcos, dsin } from '../../../math';
import {
  BB3_CCD_SPEED,
  BB_HALF_X,
  BB_HALF_Y,
  BB_POLLEN_R,
  PREDICT_ELEMENT_RADIUS,
  PREDICT_MAX_TICKS,
} from '../config';
import { rapier3d, type Rapier3d } from './engine';
import {
  buildHiveTray3d,
  buildStatics3d,
  elementMass,
  robotHeightIn,
  ELEMENT_FRICTION,
  ELEMENT_RESTITUTION,
  ELEMENT_ROLL_DAMP,
} from './bodies';
import { hiveTiltAngle } from './hive3d';
import { hyp3, QUAT_IDENTITY, round4, tiltQuatX, yawQuat, yawOfQuat } from './math3';

/**
 * BIOBUZZ 3D — CLIENT-SIDE PREDICTION WORLDS (Day 2, `docs/biobuzz/plan-3d.md` §5).
 *
 * A networked client renders its own robot from inputs it has not had acknowledged yet, and then
 * RECONCILES: when the authoritative snapshot arrives it adopts that world and re-steps every
 * input newer than the snapshot's tick. `src/game.ts` does that today by replaying the WHOLE
 * game step, which is the honest thing for a 2D-physics room and much too expensive for a 3D
 * one — 56 spheres, four chassis and a hive, forty times, inside one frame.
 *
 * So this file offers two cheaper worlds that answer the ONE question a reconcile actually asks:
 * **where is MY robot after re-stepping these inputs?**
 *
 *  · **LIGHT** — the shared drive model and the walls, and nothing else. No wasm, no elements, no
 *    other robots. Exact on open floor, which is where a driver spends the match; the server
 *    corrects the moment they touch something.
 *  · **FULL** — a small persistent Rapier 3D world re-seated from each snapshot: the statics, the
 *    trays at their snapshot angle, the other robots kinematic where the snapshot puts them, the
 *    elements within `PREDICT_ELEMENT_RADIUS` dynamic, and the local robot dynamic. Right through
 *    a push, at the cost of the physics chunk and ~15 bodies.
 *
 * ── THE CONTRACT (`Predictor`) ──────────────────────────────────────────────────────────────
 * `reset(authoritativeWorld, serverTick)` adopts a snapshot; `step(cmd)` re-steps ONE buffered
 * input and returns the local robot's predicted pose; `dispose()` frees the wasm world. Lane C
 * calls `reset` once per snapshot and `step` once per buffered input, and feeds the final pose
 * into `game.ts`'s existing `localSmooth` offset — the correction machinery does not change at
 * all, only what computes the pose it is correcting against.
 *
 * ⚠️ **NEITHER PREDICTOR IS AUTHORITATIVE AND NEITHER TRIES TO BE.** They never write to the
 * world they were reset from, they never run gameplay (no capture, no launch, no scoring, no
 * penalties), and they may be WRONG — that is what reconciliation is for. Everything they omit
 * is omitted in the direction of "the server will correct it", never "the client decides".
 *
 * ⚠️ **AND NEITHER MAY BE THE SERVER'S STEP.** `step3d` stays the one authority; nothing here is
 * imported by `step3d.ts` and nothing here is reachable from the server.
 */

/** the local robot's pose after a re-step — everything `game.ts` needs to place it and to
 * compute its own smoothing offset. */
export interface PredictedPose {
  pos: Vec2;
  vel: Vec2;
  heading: number;
  angVel: number;
  z: number;
  vz: number;
}

export interface Predictor {
  /** `'light'` or `'full'` — what the Prediction setting and the Auto probe name it by. */
  readonly kind: 'light' | 'full';
  /** the server tick this predictor was last reset to. */
  readonly tick: number;
  /** adopt an authoritative snapshot. Cheap for LIGHT (one pose copy); for FULL this is where
   * the bodies are re-seated and the near-element set is rebuilt. */
  reset(world: World, serverTick: number): void;
  /** re-step ONE buffered input and return the local robot's predicted pose. */
  step(cmd: RobotCommand): PredictedPose;
  /** free any wasm world. Idempotent; a disposed predictor must not be stepped again. */
  dispose(): void;
}

/** the pose out of a `RobotState`, rounded the way the readback rounds — so a predicted pose and
 * an authoritative one are comparable without a tolerance argument about representation. */
function poseOf(r: RobotState): PredictedPose {
  return {
    pos: { x: round4(r.pos.x), y: round4(r.pos.y) },
    vel: { x: round4(r.vel.x), y: round4(r.vel.y) },
    heading: round4(r.heading),
    angVel: round4(r.angVel),
    z: round4(r.z ?? 0),
    vz: round4(r.vz ?? 0),
  };
}

/**
 * A SCRATCH WORLD holding one robot.
 *
 * `updateRobot` takes a `World` (it reads the match phase and the robot-robot contact list), so a
 * predictor that re-steps the shared drive model needs one — but it must not be the real world,
 * because a predictor that mutated the world it was reset from would be writing client opinion
 * into the state the server owns. This is a SHALLOW clone with its own robot array, its own
 * empty `balls` and its own empty `rrContacts`; everything else is shared by reference and never
 * written.
 */
function scratchWorld(from: World, local: RobotState): World {
  return { ...from, robots: [local], balls: [], rrContacts: [] } as World;
}

/** a deep-enough copy of one robot: every field the drive model writes gets its own object, the
 * rest rides by reference (`spec` is frozen-by-convention and never mutated by a step). */
function cloneRobot(r: RobotState): RobotState {
  return {
    ...r,
    pos: { x: r.pos.x, y: r.pos.y },
    vel: { x: r.vel.x, y: r.vel.y },
    hopper: [...r.hopper],
  };
}

/**
 * THE ANALYTIC WALL CLAMP the LIGHT predictor needs and the FULL one does not.
 *
 * In the real 3D solve the perimeter is four cuboid colliders, so a robot simply cannot leave the
 * field. LIGHT has no colliders at all, and a 40-tick re-step at 82 in/s covers 55 in — enough to
 * put a robot through the wall and leave the correction larger than `SMOOTH_MAX_DIST`, which
 * SNAPS instead of smoothing. So the footprint is clamped inside the perimeter by hand, using
 * `robotExtents` (the intake-reach footprint the 2D solve and the 3D collider both use), and the
 * velocity into the wall is zeroed so the next tick does not push straight back into it.
 */
function clampToField(r: RobotState): void {
  const fe = robotExtents(r);
  const c = dcos(r.heading);
  const s = dsin(r.heading);
  // the footprint's half-extents projected onto the world axes: a box `front`/`rear` long and
  // `half` wide, rotated by the heading. `forward` is the offset of its centre from the origin.
  const hx = (fe.front + fe.rear) / 2;
  const forward = (fe.front - fe.rear) / 2;
  const cx = r.pos.x + forward * c;
  const cy = r.pos.y + forward * s;
  const spanX = Math.abs(hx * c) + Math.abs(fe.half * s);
  const spanY = Math.abs(hx * s) + Math.abs(fe.half * c);
  const limX = BB_HALF_X - spanX;
  const limY = BB_HALF_Y - spanY;
  if (cx > limX) {
    r.pos.x -= cx - limX;
    if (r.vel.x > 0) r.vel.x = 0;
  } else if (cx < -limX) {
    r.pos.x += -limX - cx;
    if (r.vel.x < 0) r.vel.x = 0;
  }
  if (cy > limY) {
    r.pos.y -= cy - limY;
    if (r.vel.y > 0) r.vel.y = 0;
  } else if (cy < -limY) {
    r.pos.y += -limY - cy;
    if (r.vel.y < 0) r.vel.y = 0;
  }
}

/**
 * LIGHT — the shared drive model, integrated, plus the walls.
 *
 * `updateRobot` returns a WRENCH (a force and a yaw torque), because in both real pipelines a
 * solver is what turns it into motion. Here the integration is done by hand, and it is the same
 * integration Rapier does for a body with no contacts and no damping: `v += F/m·dt`,
 * `p += v·dt`, `ω += τ/I·dt`, `θ += ω·dt`, with the SAME mass and inertia `engine.ts` hands the
 * real body (`shoveMass`, `chassisInertia`). So on open floor Light is not an approximation of
 * the 3D solve — it IS the 3D solve, with the parts that only matter in contact left out.
 *
 * `squareUpRobotsWalls` runs after, exactly as `step3d` stage 8b runs it, so a robot driving
 * along a wall gets the same contact torque the real pipeline gives it.
 */
export function createLightPredictor(world: World, localRobotId: number): Predictor {
  let local: RobotState | null = null;
  let scratch: World | null = null;
  let tick = 0;

  const self: Predictor = {
    kind: 'light',
    get tick() {
      return tick;
    },
    reset(w: World, serverTick: number): void {
      const src = w.robots.find((r) => r.id === localRobotId);
      local = src ? cloneRobot(src) : null;
      scratch = local ? scratchWorld(w, local) : null;
      tick = serverTick;
    },
    step(cmd: RobotCommand): PredictedPose {
      if (!local || !scratch) return { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, heading: 0, angVel: 0, z: 0, vz: 0 };
      const preVels = new Map<number, Vec2>([[local.id, { x: local.vel.x, y: local.vel.y }]]);
      const wr = updateRobot(scratch, local, cmd, SIM_DT);
      const m = shoveMass(local.spec, local.butterflyTank, local.powerDraw);
      const inertia = chassisInertia(m, local.spec);
      local.vel.x += (wr.fx / m) * SIM_DT;
      local.vel.y += (wr.fy / m) * SIM_DT;
      local.angVel += (wr.tau / inertia) * SIM_DT;
      local.pos.x += local.vel.x * SIM_DT;
      local.pos.y += local.vel.y * SIM_DT;
      local.heading += local.angVel * SIM_DT;
      squareUpRobotsWalls(scratch, preVels, BB_HALF_X, BB_HALF_Y);
      clampToField(local);
      /**
       * ROUNDED EVERY TICK, the way the real pipeline's readback rounds — not just on the way
       * out. `step3d` writes `round4` into the JSON after every step, so the state the NEXT tick's
       * drive model reads is a rounded one; a predictor that carried full precision internally
       * would be re-stepping a slightly different history from the one it is predicting against,
       * and the difference compounds over a forty-tick window.
       */
      local.pos.x = round4(local.pos.x);
      local.pos.y = round4(local.pos.y);
      local.heading = round4(local.heading);
      local.vel.x = round4(local.vel.x);
      local.vel.y = round4(local.vel.y);
      local.angVel = round4(local.angVel);
      tick++;
      return poseOf(local);
    },
    dispose(): void {
      local = null;
      scratch = null;
    },
  };
  // SEEDED, so a caller that creates one and steps it without waiting for a snapshot gets the
  // world it asked for rather than an empty predictor. Lane C's first `reset` overwrites it.
  self.reset(world, world.tick);
  return self;
}

/**
 * FULL — a small persistent Rapier 3D world, RE-SEATED from each snapshot.
 *
 * ⚠️ **PERSISTENT, NOT REBUILT.** The plan says "rebuilds a small 3D world per reconcile", and
 * what is rebuilt per reconcile is its CONTENT: every body is re-seated and the near-element set
 * is replaced. The world object and its ~80 STATIC colliders (the perimeter, the floor, the hive
 * frames, the flower supports and the twelve ring-plate trimeshes) are built ONCE, at creation,
 * because building them is most of the cost and none of it changes between snapshots. A literal
 * per-reconcile rebuild would spend the whole budget on geometry that is identical every time.
 *
 * What the world carries, and what each omission costs:
 *  · **statics** — the field. Not optional: a prediction that can drive through a wall produces
 *    a correction bigger than `SMOOTH_MAX_DIST`, which snaps.
 *  · **the two hive TRAYS**, KINEMATIC at the snapshot's own `hives[a].angle`. Kinematic because
 *    a client has no business predicting a TIP — the server decides that, and a tray the client
 *    swung independently would fight every snapshot.
 *  · **the other ROBOTS**, KINEMATIC at their snapshot pose. A remote robot's future inputs are
 *    unknown, so holding it still for 0.67 s is the only honest guess; the local robot still
 *    feels it as a solid, which is the point.
 *  · **ELEMENTS within `PREDICT_ELEMENT_RADIUS`**, dynamic. Further ones cannot reach the robot
 *    inside the window.
 */
export function createFullPredictor(world: World, localRobotId: number): Predictor {
  const RAPIER = rapier3d();
  const world3d = new RAPIER.World({ x: 0, y: 0, z: -GRAVITY });
  world3d.integrationParameters.lengthUnit = 10;
  world3d.integrationParameters.numSolverIterations = PHYS_SOLVER_ITERS;
  world3d.integrationParameters.contact_natural_frequency = PHYS_CONTACT_FREQ;
  world3d.integrationParameters.normalizedAllowedLinearError = PHYS_ALLOWED_ERROR;
  buildStatics3d(RAPIER, world3d, PHYS_WALL_FRICTION);
  // the trays are KINEMATIC here whatever `BB3_HIVE_DYNAMIC` says — see the header.
  const trays = {
    red: buildKinematicTray(RAPIER, world3d, 'red'),
    blue: buildKinematicTray(RAPIER, world3d, 'blue'),
  };

  let localBody: InstanceType<Rapier3d['RigidBody']> | null = null;
  let local: RobotState | null = null;
  let scratch: World | null = null;
  const others = new Map<number, InstanceType<Rapier3d['RigidBody']>>();
  const elements = new Map<number, InstanceType<Rapier3d['RigidBody']>>();
  let tick = 0;
  let disposed = false;

  function clearElements(): void {
    for (const b of elements.values()) world3d.removeRigidBody(b);
    elements.clear();
  }

  const self: Predictor = {
    kind: 'full',
    get tick() {
      return tick;
    },
    reset(w: World, serverTick: number): void {
      if (disposed) return;
      tick = serverTick;
      const src = w.robots.find((r) => r.id === localRobotId);
      local = src ? cloneRobot(src) : null;
      scratch = local ? scratchWorld(w, local) : null;

      for (const a of ['red', 'blue'] as const) {
        trays[a].setNextKinematicRotation(tiltQuatX(hiveTiltAngle(w, a)));
      }

      // the LOCAL robot: created once, re-seated every reset.
      if (local) {
        if (!localBody) localBody = makeRobotBody(RAPIER, world3d, local, true);
        seatRobot(localBody, local);
      }
      // the others: kinematic, created on first sight, re-seated every reset.
      for (const r of w.robots) {
        if (r.id === localRobotId) continue;
        let body = others.get(r.id);
        if (!body) {
          body = makeRobotBody(RAPIER, world3d, r, false);
          others.set(r.id, body);
        }
        seatRobot(body, r);
      }

      // the near elements: replaced outright. Fifteen-ish bodies is cheaper to rebuild than to
      // diff, and a diff would have to answer "did this id leave the radius" anyway.
      clearElements();
      if (local) {
        const r2 = PREDICT_ELEMENT_RADIUS * PREDICT_ELEMENT_RADIUS;
        for (const b of w.balls) {
          if (b.state.kind === 'held' || b.state.kind === 'stock') continue;
          const dx = b.pos.x - local.pos.x;
          const dy = b.pos.y - local.pos.y;
          if (dx * dx + dy * dy > r2) continue;
          elements.set(b.id, makeElementBody(RAPIER, world3d, b));
        }
      }
    },
    step(cmd: RobotCommand): PredictedPose {
      if (disposed || !local || !scratch || !localBody) {
        return { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, heading: 0, angVel: 0, z: 0, vz: 0 };
      }
      const preVels = new Map<number, Vec2>([[local.id, { x: local.vel.x, y: local.vel.y }]]);
      const wr = updateRobot(scratch, local, cmd, SIM_DT);
      const m = shoveMass(local.spec, local.butterflyTank, local.powerDraw);
      const inertia = chassisInertia(m, local.spec);
      localBody.setAdditionalMassProperties(
        m,
        { x: 0, y: 0, z: 0 },
        { x: inertia, y: inertia, z: inertia },
        QUAT_IDENTITY,
        true,
      );
      localBody.resetForces(true);
      localBody.resetTorques(true);
      if (wr.fx !== 0 || wr.fy !== 0) localBody.addForce({ x: wr.fx, y: wr.fy, z: 0 }, true);
      if (wr.tau !== 0) localBody.addTorque({ x: 0, y: 0, z: wr.tau }, true);
      world3d.step();
      const t = localBody.translation();
      const v = localBody.linvel();
      const av = localBody.angvel();
      const heightIn = robotHeightIn(local.spec);
      local.pos.x = round4(t.x);
      local.pos.y = round4(t.y);
      local.z = round4(t.z - heightIn / 2);
      local.heading = round4(yawOfQuat(localBody.rotation()));
      local.vel.x = round4(v.x);
      local.vel.y = round4(v.y);
      local.vz = round4(v.z);
      local.angVel = round4(av.z);
      // the SAME stage 8b the real pipeline runs, for the same reason: a wall-flush robot's
      // contact torque comes from this pass and not from the solver.
      squareUpRobotsWalls(scratch, preVels, BB_HALF_X, BB_HALF_Y);
      seatRobot(localBody, local);
      tick++;
      return poseOf(local);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      clearElements();
      world3d.free();
      localBody = null;
      local = null;
      scratch = null;
      others.clear();
    },
  };
  self.reset(world, world.tick); // seeded, same reasoning as the LIGHT predictor's
  return self;
}

function buildKinematicTray(
  RAPIER: Rapier3d,
  world3d: InstanceType<Rapier3d['World']>,
  alliance: 'red' | 'blue',
): InstanceType<Rapier3d['RigidBody']> {
  // `buildHiveTray3d` honours `BB3_HIVE_DYNAMIC`; a prediction world always wants the kinematic
  // shape, so the dynamic branch's joint is simply discarded and the body driven by hand. That
  // is cheaper than a second collider builder and cannot drift from the real tray's geometry.
  const built = buildHiveTray3d(RAPIER, world3d, alliance, 0);
  return built.body;
}

function makeRobotBody(
  RAPIER: Rapier3d,
  world3d: InstanceType<Rapier3d['World']>,
  r: RobotState,
  dynamic: boolean,
): InstanceType<Rapier3d['RigidBody']> {
  const heightIn = robotHeightIn(r.spec);
  const desc = dynamic
    ? RAPIER.RigidBodyDesc.dynamic().enabledRotations(false, false, true)
    : RAPIER.RigidBodyDesc.kinematicPositionBased();
  const body = world3d.createRigidBody(desc);
  const fe = robotExtents(r);
  const hx = (fe.front + fe.rear) / 2;
  const forward = (fe.front - fe.rear) / 2;
  world3d.createCollider(
    RAPIER.ColliderDesc.cuboid(hx, fe.half, heightIn / 2)
      .setTranslation(forward, 0, 0)
      .setDensity(0)
      .setFriction(PHYS_FRICTION)
      .setRestitution(0),
    body,
  );
  return body;
}

function seatRobot(body: InstanceType<Rapier3d['RigidBody']>, r: RobotState): void {
  const heightIn = robotHeightIn(r.spec);
  body.setTranslation({ x: r.pos.x, y: r.pos.y, z: (r.z ?? 0) + heightIn / 2 }, true);
  body.setRotation(yawQuat(r.heading), true);
  body.setLinvel({ x: r.vel.x, y: r.vel.y, z: r.vz ?? 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: r.angVel }, true);
}

function makeElementBody(
  RAPIER: Rapier3d,
  world3d: InstanceType<Rapier3d['World']>,
  b: Artifact,
): InstanceType<Rapier3d['RigidBody']> {
  const r = b.r ?? BB_POLLEN_R;
  const body = world3d.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(b.pos.x, b.pos.y, b.z + r)
      .setLinvel(b.vel.x, b.vel.y, b.vz)
      .setAngularDamping(ELEMENT_ROLL_DAMP)
      .setCcdEnabled(hyp3(b.vel.x, b.vel.y, b.vz) > BB3_CCD_SPEED),
  );
  world3d.createCollider(
    RAPIER.ColliderDesc.ball(r)
      .setMass(elementMass(b.color === 'red' || b.color === 'blue'))
      .setFriction(ELEMENT_FRICTION)
      .setRestitution(ELEMENT_RESTITUTION)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max),
    body,
  );
  return body;
}

/**
 * THE AUTO PROBE (plan §5): how long ONE full reconcile of `PREDICT_MAX_TICKS` costs, in ms, on
 * THIS machine, measured against THIS world.
 *
 * Auto runs it during the pre-match countdown and picks Full when the answer is under
 * `PREDICT_FULL_BUDGET_MS`. It is a measurement and not a benchmark: it builds a real predictor,
 * resets it to the real world and re-steps a real forty-tick window with a straight-ahead
 * command, then disposes it. The build cost is EXCLUDED from the timing on purpose — it is paid
 * once when the predictor is created, not once per reconcile, and including it would make Auto
 * choose Light on a machine that could comfortably run Full.
 *
 * ⚠️ It calls `performance.now` through the caller's clock, NOT its own: this module is under the
 * sim determinism guard and may not read a clock. `now()` is a parameter for that reason, and the
 * default is `Date.now`, which is only ever used by a smoke lane that has already decided it is
 * measuring rather than simulating.
 */
export function probeFullReconcileMs(
  world: World,
  localRobotId: number,
  now: () => number = () => Date.now(),
  ticks: number = PREDICT_MAX_TICKS,
): number {
  const p = createFullPredictor(world, localRobotId);
  try {
    p.reset(world, world.tick);
    const cmd: RobotCommand = {
      driveX: 0,
      driveY: 1,
      rotate: 0,
      leftDrive: 1,
      rightDrive: 1,
      intake: false,
      fire: false,
    };
    const t0 = now();
    for (let i = 0; i < ticks; i++) p.step(cmd);
    return now() - t0;
  } finally {
    p.dispose();
  }
}
