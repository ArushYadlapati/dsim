import type { RobotCommand, Vec2, World } from '../../../types';
import { updateRobot, type DriveWrench } from '../../../sim/robot';
import { robotsEnabled } from '../../../sim/match';
import { squareUpRobotsWalls } from '../../../sim/physics';
import { bbAimAssist } from '../play';
import { updateBiobuzzPenalties } from '../penalties';
import { bbApplyScore, bbScoreWorld } from '../score';
import { biobuzzStepMatch } from '../step';
import { BB_HALF_X, BB_HALF_Y } from '../config';
import { engineFor, syncElements, syncRobots, applyHiveTilt, stepWorld3d, readback, containmentPass, groundRoll3d } from './engineImpl';
import { applyRobotWrench } from './robot3d';
import { deriveTick } from './derive';
import { hiveContactPass } from './contacts3d';
import { hive3dJointTick, hive3dTick } from './hive3d';
import { elements3dAimAndLaunch, elements3dCapture, elements3dHumanPlayer, elements3dPlaceAndRetrieve } from './elements3d';

/**
 * ⚠️ HEAVY. Reached only through `sim3d/impl.ts` (and therefore only after `initPhysics3d()`);
 * `sim3d/step3d.ts` is the one-line gate `step.ts` dispatches through. The function below kept
 * its name, its contents and its stage numbering when it moved out of `step3d.ts` — see
 * `engine.ts`'s header for why the implementation had to leave the main chunk.
 */
/**
 * BIOBUZZ 3D PHYSICS -- the tick (Day 1, `docs/biobuzz/plan-3d.md` section 3.1). Mirrors
 * `step.ts`'s `step2d` stage numbering and reasoning (see that function's header for WHY each
 * stage sits where it does; every stage below that also exists in 2D keeps the same reason).
 *
 *   0-3. RESOLVE COMMANDS, AIM HOOK, DRIVETRAIN -- identical to 2D: a disabled robot gets a
 *        zero command, a turretless dumper's held fire steers the chassis (`bbAimAssist`)
 *        BEFORE `updateRobot` sees it, and `updateRobot` (the SHARED motor/traction model,
 *        untouched) returns a `DriveWrench` per robot.
 *   4. CLEAR rrContacts, THEN SNAPSHOT preVels3d -- after the drivetrain reads last tick's
 *      contacts, same as 2D; preVels3d is r.vel as it stands right now (this tick's
 *      pre-solve velocity, the same quantity 2D's solveRobots hands back), captured here
 *      because nothing between here and readback (8) touches the JSON vel.
 *   5. SYNC -- `engineFor(world)` builds the persistent Rapier 3D world on first use;
 *      `syncRobots`/`syncElements` reconcile every body to this tick's JSON.
 *   6. APPLY WRENCHES + KINEMATIC TRAY POSE -- the wrench becomes a force + yaw torque on each
 *      robot body (`applyRobotWrench`); both hive trays' next kinematic rotation is set from
 *      `hiveTiltAngle` (`applyHiveTilt`) -- the Day 1 fallback, not a joint.
 *   7. `world3d.step()`.
 *   8. READBACK -- every dynamic body writes `pos`/`z`/`vel`/`vz` (and, for a robot,
 *      `heading`/`angVel`) back into `world`, rounded to 1e-4.
 *   8b. WALL SQUARE-UP -- the shared `squareUpRobotsWalls` (src/sim/physics.ts, also CR's),
 *       called with preVels3d exactly the way 2D's step2d calls it with solveRobots's own
 *       return. It is PURE JSON -- RobotState/World only, no Rapier handle -- so it drops
 *       into the 3D pipeline unchanged. This is the fix for the yaw-rate and ramp-time
 *       parity checks: a BIOBUZZ start position spans a robot's `robotExtents` footprint
 *       flush against a wall, and this is the contact-torque pass that resists a spin or a
 *       drive-away against that contact, which 3D had no equivalent of before this fix.
 *       It also RECORDS world.rrContacts (SAT on geometric overlap alone, byte-identical to
 *       2D's own test), which replaces this lane's previous bespoke fillRrContacts3d.
 *   9. CONTAINMENT -- the safety net, never the design; see `engine.ts`'s `containmentPass`.
 *  9b. CONTACT RULES -- G409 (a robot catching a spilling element), the only BIOBUZZ rule whose
 *      subject is a contact rather than a position, and 3D-only for that reason
 *      (`contacts3d.ts`). G417 (ramming the HIVE) used to live in this stage too; it is REMOVED
 *      entirely (owner ruling, 2026-09-19).
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
  // ...and the pre-solve velocity snapshot squareUpRobotsWalls needs at stage 8b -- see the
  // header. Nothing between here and readback (8) writes r.vel's JSON.
  const preVels3d = new Map<number, Vec2>(world.robots.map((r) => [r.id, { x: r.vel.x, y: r.vel.y }]));

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

  // 8. readback.
  readback(world, engine);

  // 8b. wall square-up + rrContacts -- see the header.
  squareUpRobotsWalls(world, preVels3d, BB_HALF_X, BB_HALF_Y);

  // 9. containment safety net.
  containmentPass(world, engine);

  // 9a. ROLLING RESISTANCE + THE REST SNAP — the Coulomb law the 2D pipeline gets from the
  //     shared `stepGroundBall`, which Rapier's exponential damping is not. BEFORE `derive`, so
  //     the tags and `restTicks` are read off the velocities an element actually has, and AFTER
  //     readback, so it is the step's own answer being damped rather than last tick's.
  groundRoll3d(world, engine, dt);

  // 9b. THE CONTACT RULES -- G409's spill tag, read off the pairs the step just resolved
  //     (`contacts3d.ts`). BEFORE derive, because `derive.ts` is about to re-tag every element
  //     and a spilled one has to be judged against the contact that actually happened rather
  //     than against the state it ends the tick in.
  if (world.biobuzz) hiveContactPass(world, engine);

  // 10. derive.
  deriveTick(world, engine);

  // 11. gameplay.
  if (world.biobuzz) {
    elements3dCapture(world, engine, actual, enabled);
    elements3dAimAndLaunch(world, dt, actual, enabled);
    elements3dPlaceAndRetrieve(world, actual, enabled);
    elements3dHumanPlayer(world, actual, enabled);
    hive3dTick(world, dt);
    hive3dJointTick(world, engine);
  }

  // 12. penalties.
  if (world.biobuzz) updateBiobuzzPenalties(world, dt, actual);

  // 13. phase machine.
  biobuzzStepMatch(world, dt);

  // 14. score, from scratch, last.
  if (world.biobuzz) bbApplyScore(world, bbScoreWorld(world));
}
