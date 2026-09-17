import type { RobotCommand, World } from '../../../types';
import { updateRobot, type DriveWrench } from '../../../sim/robot';
import { robotsEnabled } from '../../../sim/match';
import { bbAimAssist } from '../play';
import { updateBiobuzzPenalties } from '../penalties';
import { bbApplyScore, bbScoreWorld } from '../score';
import { biobuzzStepMatch } from '../step';
import { engineFor, syncElements, syncRobots, applyHiveTilt, stepWorld3d, readback, containmentPass } from './engine';
import { applyRobotWrench, fillRrContacts3d } from './robot3d';
import { deriveTick } from './derive';
import { hive3dTick } from './hive3d';
import { elements3dAimAndLaunch, elements3dCapture, elements3dHumanPlayer, elements3dPlaceAndRetrieve } from './elements3d';

/**
 * BIOBUZZ 3D PHYSICS -- the tick (Day 1, `docs/biobuzz/plan-3d.md` section 3.1). Mirrors
 * `step.ts`'s `step2d` stage numbering and reasoning (see that function's header for WHY each
 * stage sits where it does; every stage below that also exists in 2D keeps the same reason).
 *
 *   0-3. RESOLVE COMMANDS, AIM HOOK, DRIVETRAIN -- identical to 2D: a disabled robot gets a
 *        zero command, a turretless dumper's held fire steers the chassis (`bbAimAssist`)
 *        BEFORE `updateRobot` sees it, and `updateRobot` (the SHARED motor/traction model,
 *        untouched) returns a `DriveWrench` per robot.
 *   4. CLEAR rrContacts -- after the drivetrain reads last tick's, same as 2D.
 *   5. SYNC -- `engineFor(world)` builds the persistent Rapier 3D world on first use;
 *      `syncRobots`/`syncElements` reconcile every body to this tick's JSON.
 *   6. APPLY WRENCHES + KINEMATIC TRAY POSE -- the wrench becomes a force + yaw torque on each
 *      robot body (`applyRobotWrench`); both hive trays' next kinematic rotation is set from
 *      `hiveTiltAngle` (`applyHiveTilt`) -- the Day 1 fallback, not a joint.
 *   7. `world3d.step()`.
 *   8. READBACK -- every dynamic body writes `pos`/`z`/`vel`/`vz` (and, for a robot,
 *      `heading`/`angVel`) back into `world`, rounded to 1e-4; `fillRrContacts3d` reads contact
 *      pairs off the JUST-STEPPED world, robots in ascending id order.
 *   9. CONTAINMENT -- the safety net, never the design; see `engine.ts`'s `containmentPass`.
 *  10. DERIVE -- `deriveTick`: cell membership, ground/flight tagging, `hives[a].contents`.
 *  11. GAMEPLAY -- capture, aim+launch, place/retrieve, human player (`elements3d.ts`), then the
 *      hive TIMER over what derive just wrote (`hive3dTick`) -- in that order, so a tip
 *      triggered by an element captured/launched/placed THIS tick still uses this tick's load.
 *  12. PENALTIES -- the shared `updateBiobuzzPenalties`, reading poses/contacts only (it moves
 *      nothing), same call the 2D pipeline makes.
 *  13. PHASE MACHINE -- the shared `biobuzzStepMatch` (now exported for this seam).
 *  14. SCORE -- `bbScoreWorld` + `bbApplyScore`, recomputed from scratch, last, same as 2D.
 */
const ZERO_CMD: RobotCommand = {
  driveX: 0,
  driveY: 0,
  rotate: 0,
  leftDrive: 0,
  rightDrive: 0,
  intake: false,
  fire: false,
};

export function step3d(world: World, dt: number, commands: Map<number, RobotCommand>): void {
  world.time += dt;
  world.tick++;

  const enabled = robotsEnabled(world);
  const actual = new Map<number, RobotCommand>();
  const drive = new Map<number, DriveWrench>();

  // 1-3. resolve commands, the dumper aim hook, the shared drivetrain model.
  for (const r of world.robots) {
    let cmd = enabled ? (commands.get(r.id) ?? ZERO_CMD) : ZERO_CMD;
    const aim = bbAimAssist(world, r, cmd, enabled);
    if (aim !== null) {
      const fwd = ((cmd.leftDrive ?? 0) + (cmd.rightDrive ?? 0)) / 2;
      const room = 1 - Math.abs(aim);
      const f = Math.max(-room, Math.min(room, fwd));
      cmd = { ...cmd, rotate: aim, leftDrive: f - aim, rightDrive: f + aim };
    }
    actual.set(r.id, cmd);
    drive.set(r.id, updateRobot(world, r, cmd, dt));
  }

  // 4. see `step.ts`'s stage 4 note -- not a misplaced reset.
  world.rrContacts.length = 0;

  // 5. sync the persistent 3D world to this tick's JSON.
  const engine = engineFor(world);
  syncRobots(world, engine);
  syncElements(world, engine);

  // 6. wrenches + the kinematic tray.
  for (const r of world.robots) {
    const w = drive.get(r.id);
    if (w) applyRobotWrench(engine, r.id, w);
  }
  applyHiveTilt(world, engine);

  // 7. step.
  stepWorld3d(engine);

  // 8. readback + contacts.
  readback(world, engine);
  fillRrContacts3d(world, engine);

  // 9. containment safety net.
  containmentPass(world, engine);

  // 10. derive.
  deriveTick(world, engine);

  // 11. gameplay.
  if (world.biobuzz) {
    elements3dCapture(world, engine, actual, enabled);
    elements3dAimAndLaunch(world, dt, actual, enabled);
    elements3dPlaceAndRetrieve(world, actual, enabled);
    elements3dHumanPlayer(world, actual, enabled);
    hive3dTick(world, dt);
  }

  // 12. penalties.
  if (world.biobuzz) updateBiobuzzPenalties(world, dt, actual);

  // 13. phase machine.
  biobuzzStepMatch(world, dt);

  // 14. score, from scratch, last.
  if (world.biobuzz) bbApplyScore(world, bbScoreWorld(world));
}
