import type { RobotState } from '../../../types';
import type { DriveWrench } from '../../../sim/robot';
import type { Engine3d } from './engineImpl';
import { robotBodyOf } from './engineImpl';

/**
 * BIOBUZZ 3D PHYSICS -- robot pose + wrench application (Day 1, `docs/biobuzz/plan-3d.md`
 * section 3.3).
 *
 * `robotPose3` is the ONE pose reader every `sim3d/` file uses instead of touching
 * `r.pos`/`r.heading`/`r.z` directly -- so the day pitch/roll unlock (`RobotState.q?`, the plan's
 * own note on why `q` stays optional and absent reads upright) is a change to this ONE function,
 * not a grep-and-replace across the lane.
 */
export interface Pose3 {
  x: number;
  y: number;
  z: number;
  heading: number;
}

export function robotPose3(r: RobotState): Pose3 {
  return { x: r.pos.x, y: r.pos.y, z: r.z ?? 0, heading: r.heading };
}

/**
 * Apply the shared `DriveWrench` (`src/sim/robot.ts`'s `updateRobot`, unchanged from the 2D
 * pipeline -- the drivetrain model is shared, plan section 3.3) as a force in the floor plane
 * and a yaw torque. NO EXTRA YAW BRAKE IS ADDED HERE: the 2D `solveRobots` sets none either
 * (`PHYS_FRICTION`/`PHYS_WALL_FRICTION` are the only robot-body tuning it applies) -- every
 * braking term (`MOTOR_BRAKE_MULT`, `MOTOR_SHOVE_BRAKE`) already lives INSIDE the wrench itself,
 * computed by `updateRobot` before this ever runs, so adding a second one here would be the
 * exact double-count `docs/area/physics.md` warns against for the 2D solver's own yaw.
 */
export function applyRobotWrench(engine: Engine3d, robotId: number, w: DriveWrench): void {
  const body = robotBodyOf(engine, robotId);
  if (!body) return;
  // RAPIER FORCES PERSIST ACROSS STEPS -- unlike the 2D `solveRobots`, which rebuilds a
  // fresh `RAPIER.World` (and therefore a force-free body) every tick, this world is
  // PERSISTENT, so a force added one tick and never cleared is STILL THERE next tick, on top
  // of whatever this tick adds. `addForce`/`addTorque` accumulate (`resetForces`/
  // `resetTorques` exist precisely because they do not clear themselves), so every tick's
  // wrench must start from a clean slate or the applied force compounds without bound --
  // measured: without this, a straight-line drive command oscillated between ~0 and ~115
  // in/s with a roughly 20-tick period instead of settling at a steady top speed.
  body.resetForces(true);
  body.resetTorques(true);
  if (w.fx !== 0 || w.fy !== 0) body.addForce({ x: w.fx, y: w.fy, z: 0 }, true);
  if (w.tau !== 0) body.addTorque({ x: 0, y: 0, z: w.tau }, true);
}

/**
 * `world.rrContacts` is no longer filled from here. It used to walk the 3D solve's own
 * contact pairs (`contactPairsWith` on each robot's chassis collider), but the shared
 * `squareUpRobotsWalls` (`src/sim/physics.ts`, called from `step3d.ts` stage 8b) already
 * records the SAME set from a SAT test on `RobotState`/`World` JSON alone -- the identical
 * test 2D runs, so a set built there is byte-parity with 2D by construction, where a 3D-solve
 * contact set was merely close to it. Keeping both would double-record every touching pair.
 */
