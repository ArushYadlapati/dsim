import type { RobotState, World } from '../../../types';
import type { DriveWrench } from '../../../sim/robot';
import type { Engine3d } from './engine';
import { robotBodyOf } from './engine';

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
 * FILL `world.rrContacts` FROM THE 3D SOLVE -- the twin of the 2D `physics.ts`'s
 * `squareUpPair`, which records a pair "on geometric overlap alone" (see `docs/area/physics.md`)
 * so `updateRobot`'s shoved/leaning read of LAST tick's contacts works the same way in 3D.
 *
 * DETERMINISTIC ITERATION: robots by ascending id, then `contactPairsWith` on that robot's own
 * chassis collider -- matching every OTHER robot collider it is actually touching, filtered
 * through `robotColliderByHandle` so a contact with a STATIC (a wall, the hive frame, a flower
 * foot) or with an ELEMENT never becomes an `rrContacts` entry. `a < b` (by id), the same
 * ordering convention `rrContacts` has always carried, so a set built here reads identically to
 * one the 2D pass built.
 */
export function fillRrContacts3d(world: World, engine: Engine3d): void {
  const ids = [...world.robots.map((r) => r.id)].sort((x, y) => x - y);
  const seen = new Set<string>();
  for (const id of ids) {
    const body = engine.robots.get(id);
    if (!body) continue;
    const n = body.numColliders();
    for (let i = 0; i < n; i++) {
      const collider = body.collider(i);
      engine.world3d.contactPairsWith(collider, (other) => {
        const otherBody = other.parent();
        if (!otherBody) return;
        const otherId = engine.robotColliderByHandle.get(other.handle);
        if (otherId === undefined || otherId === id) return;
        const a = Math.min(id, otherId);
        const b = Math.max(id, otherId);
        const key = `${a}-${b}`;
        if (seen.has(key)) return;
        seen.add(key);
        world.rrContacts.push({ a, b });
      });
    }
  }
}
