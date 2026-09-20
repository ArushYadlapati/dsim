import type { Artifact, RobotCommand, RobotState, Vec2, World } from '../../../types';
import { SIM_DT, PHYS_FRICTION, PHYS_WALL_FRICTION, GRAVITY, PHYS_SOLVER_ITERS, PHYS_ALLOWED_ERROR } from '../../../config';
import { updateRobot } from '../../../sim/robot';
import { robotsEnabled } from '../../../sim/match';
import { chassisInertia } from '../../../sim/robot';
import { shoveMass } from '../../../sim/drivetrain';
import { robotExtents, squareUpRobotsWalls } from '../../../sim/physics';
import { dcos, dsin } from '../../../math';
import {
  BB3_CCD_SPEED,
  BB3_CONTACT_FREQ,
  BB_HALF_X,
  BB_HALF_Y,
  BB_POLLEN_R,
  PREDICT_ELEMENT_RADIUS,
  PREDICT_MAX_TICKS,
  bbHeightNow,
} from '../config';
import { bbRampSettled } from '../robot';
import { rapier3d, type Rapier3d } from './engine';
import {
  buildHiveTray3d,
  buildStatics3d,
  chassisBoxDesc,
  chassis3dReachShapes,
  clearChassis3dColliders,
  elementMass,
  reachColliderDesc,
  ELEMENT_FRICTION,
  ELEMENT_RESTITUTION,
  ELEMENT_ROLL_DAMP,
  GROUP_ELEMENT,
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

/** what `step3d` stage 1 hands a DISABLED robot. */
const ZERO_CMD: RobotCommand = {
  driveX: 0,
  driveY: 0,
  rotate: 0,
  leftDrive: 0,
  rightDrive: 0,
  intake: false,
  fire: false,
};

/**
 * THE COMMAND AS THE AUTHORITY WOULD APPLY IT. `step3d` zeroes every command while the robots are
 * disabled (pre-match, the auto→teleop transition, after the buzzer); a predictor that re-stepped
 * the raw stick anyway drove the local robot a few inches ON SCREEN ONLY, every frame, until the
 * next snapshot pulled it back (owner, 2026-09-20: "in a server-required game, the robot can move
 * slightly VISUALLY"). The phase read is the scratch world's, which is the last snapshot's — a
 * predicted 3D room never advances its own match clock — so the local robot wakes one snapshot
 * after the server enables it rather than a round trip before.
 */
const liveCmd = (w: World, cmd: RobotCommand): RobotCommand => (robotsEnabled(w) ? cmd : ZERO_CMD);

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
      const wr = updateRobot(scratch, local, liveCmd(scratch, cmd), SIM_DT);
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
  // ⚠️ THE SAME FOUR PARAMETERS AS THE AUTHORITATIVE WORLD (`engineImpl.ts`'s `buildEngine`),
  // and `contact_natural_frequency` is BIOBUZZ's own `BB3_CONTACT_FREQ`, not the shared
  // `PHYS_CONTACT_FREQ` the robot solve uses -- see that function's comment for why the 3D
  // world needs a stiffer contact than DECODE's chassis shove does. This block is HAND-COPIED,
  // so moving one and not the other predicts contacts at a different stiffness from the
  // authority and reconciles with a snap on every landed shot; the SIM3D lane asserts the two
  // worlds agree rather than trusting the copy.
  world3d.integrationParameters.contact_natural_frequency = BB3_CONTACT_FREQ;
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
  /** the height each chassis collider was actually BUILT to — `Engine3d.robotHeights`' job, done
   * here for the predictor's own world. READBACK subtracts the same half-height the build added,
   * so recomputing it instead of recording it is how a robot's z jumps on the deploy tick. */
  let localHeight = 0;
  const otherHeights = new Map<number, number>();
  /** the RAMP-READY state each chassis was last built with — `Engine3d.robotRampReady`'s twin
   * here, so a predicted wall/flower contact with a deployed ramp matches the authority's
   * collider set at the same settle edge (`bbRampSettled`) rather than one tick's worth of
   * "the server has a crossbar there and I don't". */
  let localRampReady = false;
  const otherRampReady = new Map<number, boolean>();
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

      // the LOCAL robot: created once, RE-FITTED across the deploy edge (and the ramp-settle
      // edge, now), re-seated every reset.
      if (local) {
        const h = bbHeightNow(w, local.spec);
        const ramp = bbRampSettled(local, w.time);
        if (!localBody) {
          localBody = makeRobotBody(RAPIER, world3d, local, true, h, ramp);
          localHeight = h;
          localRampReady = ramp;
        } else {
          const fit = refitRobotBody(RAPIER, world3d, localBody, local, localHeight, h, localRampReady, ramp);
          localHeight = fit.height;
          localRampReady = fit.ramp;
        }
        seatRobot(localBody, local, localHeight);
      }
      // the others: kinematic, created on first sight, re-fitted and re-seated every reset.
      for (const r of w.robots) {
        if (r.id === localRobotId) continue;
        const h = bbHeightNow(w, r.spec);
        const ramp = bbRampSettled(r, w.time);
        let body = others.get(r.id);
        if (!body) {
          body = makeRobotBody(RAPIER, world3d, r, false, h, ramp);
          others.set(r.id, body);
          otherRampReady.set(r.id, ramp);
        } else {
          const fit = refitRobotBody(RAPIER, world3d, body, r, otherHeights.get(r.id) ?? h, h, otherRampReady.get(r.id) ?? false, ramp);
          otherRampReady.set(r.id, fit.ramp);
        }
        otherHeights.set(r.id, h);
        seatRobot(body, r, h);
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
      const wr = updateRobot(scratch, local, liveCmd(scratch, cmd), SIM_DT);
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
      // the height the collider was BUILT to, not `robotHeightIn` — see `localHeight`.
      local.pos.x = round4(t.x);
      local.pos.y = round4(t.y);
      local.z = round4(t.z - localHeight / 2);
      local.heading = round4(yawOfQuat(localBody.rotation()));
      local.vel.x = round4(v.x);
      local.vel.y = round4(v.y);
      local.vz = round4(v.z);
      local.angVel = round4(av.z);
      // the SAME stage 8b the real pipeline runs, for the same reason: a wall-flush robot's
      // contact torque comes from this pass and not from the solver.
      squareUpRobotsWalls(scratch, preVels, BB_HALF_X, BB_HALF_Y);
      seatRobot(localBody, local, localHeight);
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

/**
 * ⚠️ **THE PREDICTOR'S CHASSIS IS ONE `robotExtents` CUBOID, AND THAT IS A MEASURED TRADE, NOT
 * AN OVERSIGHT.** The authority solves a compound with an open intake mouth (`chassis3dShapes`,
 * `bodies.ts`); this predictor does not, so a predicted element can bounce off a mouth the real
 * one rolls into, and the reconcile corrects it. Giving the predictor the same compound was
 * tried on 2026-09-19 and costs what it looks like it would cost: the forty-tick reconcile went
 * from 3–6 ms to 9–11 ms with the compound on the LOCAL robot alone, and to 16–17 ms on all four
 * (dev box, best of five, alternated A/B against the tree without it). `PREDICT_FULL_BUDGET_MS`
 * is 8, Auto reads that probe, and it would have picked LIGHT on nearly every machine — the
 * fidelity fix would have switched Full prediction OFF. The mismatch is real, small (the arm
 * tips end exactly where `robotExtents` ends, so walls, robots and the hive meet the same
 * surfaces; only the pocket differs) and cheaper to reconcile than to predict. If the budget or
 * the compound ever gets cheaper, `fitChassis` is the one place to change.
 *
 * What IS taken from the authority is the HEIGHT rule: `heightIn` comes from the CALLER, which
 * reads `bbHeightNow(world, spec)` — stowed before the match, deployed after — exactly as
 * `syncRobots` does, and the body is re-fitted across the deploy edge. It used to be
 * `robotHeightIn` (deployed, whatever the phase), so the predicted robot stood at the wrong
 * height for the whole of `pre` and its readback subtracted a half-height it had not added.
 *
 * ⚠️ **THE ARCHETYPE REACH HARDWARE IS NOT PART OF THAT TRADE, AND IS ADDED ANYWAY** (owner,
 * 2026-09-20: "It should be a collider."). It is not the mouth-pocket compound this note is
 * about — it is two or three SMALL boxes (`chassis3dReachShapes`, `GROUP_POCKET`, same as the
 * authority), and skipping them would leave a driver with side rollers or a deployed ramp
 * rubber-banding at every wall the authority stands them off from and the predictor does not
 * (2.65 in for side rollers, 2.17 for a settled ramp — see this file's measurement in the PREDICT
 * lane for the actual reconcile-cost delta this added).
 */
function makeRobotBody(
  RAPIER: Rapier3d,
  world3d: InstanceType<Rapier3d['World']>,
  r: RobotState,
  dynamic: boolean,
  heightIn: number,
  rampReady: boolean,
): InstanceType<Rapier3d['RigidBody']> {
  const desc = dynamic
    ? RAPIER.RigidBodyDesc.dynamic().enabledRotations(false, false, true)
    : RAPIER.RigidBodyDesc.kinematicPositionBased();
  const body = world3d.createRigidBody(desc);
  fitChassis(RAPIER, world3d, body, r, heightIn, rampReady);
  return body;
}

/**
 * The one `robotExtents` cuboid — see the note above `makeRobotBody` for why it is not the
 * authority's compound. Density 0: the predictor writes the body's mass itself.
 *
 * ⚠️ **ITS EDGES ARE BROKEN THE SAME WAY THE AUTHORITY'S ARE** (`chassisBoxDesc`,
 * `bodies.ts`). The two chassis shapes are allowed to differ about the MOUTH POCKET, because
 * only an element fits through it and a mispredicted element is a cheap reconcile; they are
 * NOT allowed to differ about the outer corner, because that is the driver's own pose. With a
 * square predictor corner against a rounded authority one, a graze at 0.25–0.45 in of overlap
 * is a CATCH locally and a clean slide on the server — the client stops dead and is then
 * snapped forward, which is the worst-looking disagreement the reconcile can produce. Measured
 * by putting THIS shape on the authority's own body and running the flower-column graze, so the
 * only variable is the corner: at 0.35 in of overlap a square cuboid keeps **0.33** of a free
 * run and yaws **107°**, an edge-broken one keeps **1.00** and yaws **0°** — 70+ in of
 * divergence from the compound the server actually solves, every time a driver clips a column.
 * It is ONE collider on each body and it is still a plain cuboid (the break is a contact skin,
 * see `chassisBoxDesc`), so it costs nothing `PREDICT_FULL_BUDGET_MS` can see; the COMPOUND is
 * what that budget refused, not the edge break.
 */
function fitChassis(
  RAPIER: Rapier3d,
  world3d: InstanceType<Rapier3d['World']>,
  body: InstanceType<Rapier3d['RigidBody']>,
  r: RobotState,
  heightIn: number,
  rampReady: boolean,
): void {
  const fe = robotExtents(r);
  const hx = (fe.front + fe.rear) / 2;
  const forward = (fe.front - fe.rear) / 2;
  world3d.createCollider(
    chassisBoxDesc(RAPIER, hx, fe.half, heightIn / 2)
      .setTranslation(forward, 0, 0)
      .setDensity(0)
      .setFriction(PHYS_FRICTION)
      .setRestitution(0),
    body,
  );
  // the SAME reach shapes the authority builds (`chassis3dReachShapes`, `bodies.ts`) — see
  // `makeRobotBody`'s own note on why this is added despite the predictor otherwise keeping one
  // bare cuboid.
  for (const s of chassis3dReachShapes(r.spec, heightIn, rampReady)) {
    world3d.createCollider(reachColliderDesc(RAPIER, s), body);
  }
}

/**
 * Re-fit an existing chassis body to `heightIn`/`rampReady` if it was built to something else —
 * the R102 DEPLOY EDGE and the ramp's own SETTLE EDGE, seen from the predictor. A collider cannot
 * be resized in place, so the shape is dropped and rebuilt, which is what the authority does at
 * the same edges. Returns what the body now carries, so the caller can record it and read back
 * against the SAME half-height it added (get the height wrong and the predicted robot sinks a
 * few inches for one tick).
 */
function refitRobotBody(
  RAPIER: Rapier3d,
  world3d: InstanceType<Rapier3d['World']>,
  body: InstanceType<Rapier3d['RigidBody']>,
  r: RobotState,
  builtHeight: number,
  heightIn: number,
  builtRamp: boolean,
  rampReady: boolean,
): { height: number; ramp: boolean } {
  if (Math.abs(builtHeight - heightIn) <= 1e-9 && builtRamp === rampReady) return { height: builtHeight, ramp: builtRamp };
  clearChassis3dColliders(world3d, body);
  fitChassis(RAPIER, world3d, body, r, heightIn, rampReady);
  return { height: heightIn, ramp: rampReady };
}

function seatRobot(body: InstanceType<Rapier3d['RigidBody']>, r: RobotState, heightIn: number): void {
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
  // the same narrowed memberships the authority gives an element (`GROUP_ELEMENT`). This world
  // has no pocket filler to filter against — the predictor's chassis is one cuboid — but the
  // groups are part of what an element IS, and two worlds that disagree about them would be a
  // reconcile difference nobody would think to look for.
  world3d.createCollider(
    RAPIER.ColliderDesc.ball(r)
      .setMass(elementMass(b.color === 'red' || b.color === 'blue'))
      .setFriction(ELEMENT_FRICTION)
      .setRestitution(ELEMENT_RESTITUTION)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setCollisionGroups(GROUP_ELEMENT),
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
 * ⚠️ **`now` IS REQUIRED, AND HAS NO DEFAULT, BECAUSE THIS MODULE MAY NOT READ A CLOCK.**
 * `scripts/smoke.ts`'s source guard scans `sim3d/` for `Date`/`performance` — "replays must be
 * pure" — and it is right to: a sim file that can read the wall clock is a sim file that can make
 * a replay diverge from the run that produced it. A first pass here defaulted the parameter to
 * a wall-clock default (`() => Date` dot `now()`), which reads exactly as harmless and is exactly the thing the guard exists
 * to catch; the guard caught it on the first `npm test`.
 *
 * So the CALLER supplies the clock. `game.ts` passes `performance.now`, and a smoke lane passes
 * whatever it is timing with — both of them modules that have already decided they are measuring
 * rather than simulating.
 */
export function probeFullReconcileMs(
  world: World,
  localRobotId: number,
  now: () => number,
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
