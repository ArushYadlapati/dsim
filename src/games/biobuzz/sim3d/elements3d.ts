import type { Alliance, Artifact, RobotCommand, RobotState, World } from '../../../types';
import { rot, wrapAngle } from '../../../math';
import { BB3_CAPTURE_TICKS, BB3_INTAKE_Z, BB_POLLEN_R, BB_HOOD_DEFAULT_DEG, BB_AIM_TOL } from '../config';
import { capturePollen } from '../elements';
import { bbAimTarget, bbHumanPlayerTick } from '../play';
import { bbLaunch, bbMouths, bbSlewTurret, bbTurretSolution, type BbShot } from '../robot';
import { bbIsTurreted, bbLauncherOf } from '../mechs';
import { rectContains, type BiobuzzState } from '../state';
import { flowerPlace3d, flowerRetrieve3d } from './flower3d';
import type { Engine3d } from './engineImpl';
import { bbKindIndex } from '../score';

/**
 * BIOBUZZ 3D PHYSICS -- capture / aim+launch / place / human player (Day 1, docs/biobuzz/
 * plan-3d.md section 3.8). Everything here is called from step3d.ts's gameplay stage, AFTER
 * derive.ts has run, and everything here writes only PLAIN JSON on world.balls/world.biobuzz --
 * the next tick's engine.ts sync is what turns a JSON change into a body create/remove/
 * teleport. Nothing in this file touches Rapier directly except elements3dCapture reading an
 * element's CURRENT bottom height off its own JSON z (already the 2D convention; see
 * bodies.ts's header) -- there is no physics call here that 2D's own functions do not already
 * make for us via capturePollen/releasePollen.
 *
 * WHAT DID NOT CARRY OVER FROM 2D, AND WHY.
 * The 2D hive CAPTURE test (hiveAccepts: "does a flight element crossing the opening belong to
 * this alliance, right now, descending, over the correct face") has no analogue here: a shot
 * that arrives over the open face is a REAL body meeting a REAL open box, and whether it stays
 * is derive.ts's rest test on the NEXT tick it settles, not a one-tick capture predicate. Same
 * for the "opponent's cell refuses it" ruling -- physical containment does not check whose
 * alliance a body is (plan section 3.6, owner decision 5: realism, then the rulebook), so
 * whichever cell an element comes to rest in is the one it counts for. hiveDeflect's "a miss
 * bounces off the structure" is also unnecessary: the tray's own solid walls already do that.
 *
 * Aim Assist's LANDING PREDICTION (bbFlightEnters run against a pretend-up copy of the hive) is
 * also NOT reproduced. It is a pure ballistic heuristic gating WHEN a held fire button releases,
 * not a correctness requirement -- the plan explicitly allows keeping or dropping it ("a pure
 * ballistic heuristic"). Day 1 keeps the SHAPE (a turret still slews to its solution and a
 * dumper still turns to face its target) but gates release on ALIGNMENT (is the mechanism
 * actually pointed at its solution right now) rather than a forward-simulated landing check,
 * which needs a pretend hive state that has no 3D meaning. Reported as a DEVIATION, not a
 * silent cut: a driver holding fire may see a slightly less precise "wait for it" than 2D's.
 */

const ALLIANCES: readonly Alliance[] = ['red', 'blue'];

/**
 * CAPTURE: for each robot (ascending id) with intake held/auto and hopper room, for each
 * `bbMouths(spec)` rect, an eligible ground/slow-flight element whose BOTTOM is below
 * `BB3_INTAKE_Z` for `BB3_CAPTURE_TICKS` consecutive ticks is taken via the SAME `capturePollen`
 * the 2D `interact()` calls (same kind/eligibility rules, same hopper cap). The body disappears
 * on the next sync once its state flips to `held`.
 */
export function elements3dCapture(
  world: World,
  engine: Engine3d,
  cmds: Map<number, RobotCommand>,
  enabled: boolean,
): void {
  const robots = [...world.robots].sort((a, b) => a.id - b.id);
  const captured = new Set<number>();
  for (const rob of robots) {
    if (rob.passive) continue;
    const cmd = cmds.get(rob.id);
    const intakeActive = enabled && (rob.autoIntake || (cmd?.intake ?? false));
    if (!intakeActive) continue;
    const mouths = bbMouths(rob.spec);
    for (const b of world.balls) {
      if (captured.has(b.id)) continue;
      if (b.state.kind !== 'ground' && b.state.kind !== 'flight') continue;
      if (b.z > BB3_INTAKE_Z) continue; // too high off the tiles for a sweeper to reach
      const local = rot({ x: b.pos.x - rob.pos.x, y: b.pos.y - rob.pos.y }, -rob.heading);
      const pad = b.r ?? BB_POLLEN_R;
      let inMouth = false;
      for (const m of mouths) {
        if (rectContains(m, local.x, local.y, pad)) {
          inMouth = true;
          break;
        }
      }
      const prev = engine.captureTicks.get(b.id) ?? 0;
      const ticks = inMouth ? prev + 1 : 0;
      engine.captureTicks.set(b.id, ticks);
      if (inMouth && ticks >= BB3_CAPTURE_TICKS && capturePollen(world, rob, b)) {
        captured.add(b.id);
        engine.captureTicks.delete(b.id);
      }
    }
  }
}

const ZERO_CMD3D: RobotCommand = Object.freeze({
  driveX: 0,
  driveY: 0,
  rotate: 0,
  leftDrive: 0,
  rightDrive: 0,
  intake: false,
  fire: false,
});

/**
 * AIM + LAUNCH: slew each robot's mechanism toward its own hive (`bbAimTarget`, the nearer own
 * cell, exactly as 2D picks it), gate release on ALIGNMENT rather than a ballistic landing
 * prediction (see this file's header), and fire through the SAME `bbLaunch` the 2D pipeline
 * calls -- `releasePollen` writes the new flight element's JSON, and the very next sync creates
 * its body at the muzzle with that velocity, CCD on once its speed clears `BB3_CCD_SPEED`.
 */
export function elements3dAimAndLaunch(
  world: World,
  dt: number,
  cmds: Map<number, RobotCommand>,
  enabled: boolean,
): void {
  const shots = new Map<number, BbShot>();
  for (const rob of world.robots) {
    if (rob.passive) continue;
    const launcher = bbLauncherOf(rob.spec, BB_HOOD_DEFAULT_DEG);
    const target = bbAimTarget(world, rob);
    if (bbIsTurreted(launcher)) {
      const speed: (number | undefined)[] = [];
      const lands: boolean[] = [];
      const exits: readonly (0 | 1)[] = launcher.kind === 'twinturret' ? [0, 1] : [0];
      for (const which of exits) {
        const sol = bbTurretSolution(rob, target, which);
        bbSlewTurret(rob, sol?.yaw ?? null, sol?.pitch ?? null, dt, which);
        speed[which] = sol?.speed;
        const heading = which === 1 ? (rob.bbTurret2Heading ?? rob.turretHeading) : rob.turretHeading;
        const pitch = which === 1 ? (rob.bbTurret2Pitch ?? 0) : (rob.bbTurretPitch ?? 0);
        const aligned =
          !!sol &&
          sol.reachable &&
          Math.abs(wrapAngle(sol.yaw - heading)) < BB_AIM_TOL &&
          Math.abs(sol.pitch - pitch) < BB_AIM_TOL;
        lands[which] = aligned;
      }
      shots.set(rob.id, { target, speed, lands });
    } else {
      // a dumper's own chassis-aim hook lives in step3d.ts (mirroring step.ts's stage 2 for the
      // 2D pipeline); here it only needs somewhere to fire once it is on target, which
      // `bbLaunch` itself re-checks via `bbDumpSolution`.
      shots.set(rob.id, { target, speed: [], lands: [true] });
    }
  }
  for (const rob of world.robots) {
    if (rob.passive) continue;
    bbLaunch(world, rob, cmds.get(rob.id) ?? ZERO_CMD3D, enabled, shots.get(rob.id));
  }
}

/**
 * PLACE (the Box Tube) and RETRIEVE (off a FLOWER's bottom opening) -- both reused outright from
 * `flower3d.ts`'s thin wrappers over the 2D `play.ts` functions. Edge-triggered exactly as 2D's
 * `placeLatch` is; this reimplements that tiny latch rather than importing a `play.ts`-private
 * function, since the latch convention (`bb.held[id]['placeP'/'placeN']`, a TRUE key or none) is
 * public via `BiobuzzState.held`'s own documented shape.
 */
export function elements3dPlaceAndRetrieve(
  world: World,
  cmds: Map<number, RobotCommand>,
  enabled: boolean,
): void {
  const bb = world.biobuzz;
  if (!bb) return;
  const ballById = new Map<number, Artifact>();
  for (const b of world.balls) ballById.set(b.id, b);
  const kindOf = bbKindIndex(world);

  for (const rob of world.robots) {
    if (rob.passive) continue;
    flowerRetrieve3d(world, bb, rob, cmds.get(rob.id), enabled, ballById, kindOf);
  }

  for (const rob of world.robots) {
    if (rob.passive) continue;
    const c = cmds.get(rob.id);
    placeLatch3d(world, bb, rob, 'placeP', enabled && !!c?.bbPlace, false, kindOf);
    placeLatch3d(world, bb, rob, 'placeN', enabled && !!c?.bbPlaceNectar, true, kindOf);
  }
}

function heldFlags3d(bb: BiobuzzState, id: number): Record<string, boolean> | null {
  const f = bb.held[id] as unknown;
  return typeof f === 'object' && f !== null ? (f as Record<string, boolean>) : null;
}

function placeLatch3d(
  world: World,
  bb: BiobuzzState,
  rob: RobotState,
  key: 'placeP' | 'placeN',
  pressed: boolean,
  nectar: boolean,
  kindOf: (id: number) => Alliance | 'pollen',
): void {
  const was = heldFlags3d(bb, rob.id)?.[key] === true;
  if (pressed && !was) flowerPlace3d(world, bb, rob, nectar, kindOf);
  if (pressed) {
    let f = heldFlags3d(bb, rob.id);
    if (!f) {
      f = {};
      bb.held[rob.id] = f;
    }
    f[key] = true;
  } else {
    const f = heldFlags3d(bb, rob.id);
    if (f && key in f) delete f[key];
  }
}

/**
 * HUMAN PLAYER: the SAME bookkeeping the 2D pipeline runs (`bbHumanPlayerTick`, extracted from
 * `play.ts`'s stage 7 -- see that function's header), plus the one 3D-only adjustment its return
 * value exists for: an entered NECTAR falls from the human player's hand rather than appearing
 * already resting, so its `z` is bumped to a short drop height. The next sync creates a falling
 * body from that JSON; gravity and `derive.ts` do the rest.
 */
const NECTAR_DROP_Z = 6; // in -- plan section 3.8

export function elements3dHumanPlayer(world: World, cmds: Map<number, RobotCommand>, enabled: boolean): void {
  const bb = world.biobuzz;
  if (!bb) return;
  const entered = bbHumanPlayerTick(world, bb, cmds, enabled);
  for (const a of ALLIANCES) {
    const ball = entered[a];
    if (ball) ball.z = NECTAR_DROP_Z;
  }
}
