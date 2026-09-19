import type { Alliance, Artifact, RobotCommand, RobotState, World } from '../../../types';
import { wrapAngle } from '../../../math';
import { BB_HOOD_DEFAULT_DEG, BB_AIM_TOL } from '../config';
import { capturePollen } from '../elements';
import { bbAimTarget, bbHumanPlayerTick } from '../play';
import { bbAimHeading, bbIntakeAct, bbLaunch, bbSlewTurret, bbTurretSolution, type BbShot } from '../robot';
import { bbIsTurreted, bbLauncherOf } from '../mechs';
import { type BiobuzzState } from '../state';
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
 * CAPTURE: the SAME roller model the 2D pipeline runs — `bbIntakeAct` (`robot.ts`) decides,
 * for each robot in id order with its intake held/auto, which elements the rollers have hold of
 * and which have been drawn to the throat, and the ones that have are taken through the SAME
 * `capturePollen` (same kind/eligibility rules, same hopper cap, same feed cadence off
 * `r.lastIntakeAt`). The body disappears on the next sync once its state flips to `held`.
 *
 * ⚠️ THE PULL IS A VELOCITY EDIT ON THE JSON, NOT A FORCE. Gameplay runs AFTER readback (stage
 * 11), so what is written here is what next tick's `syncElement` diffs — it sees the velocity
 * change and calls `setLinvel` on the body. A force would have had to be applied per tick and
 * reset per tick (forces PERSIST in Rapier 3D — `docs/area/biobuzz.md`), and a pull that is
 * really "the roller surface is moving at this speed" is a velocity in the first place.
 *
 * `lowFlight` is TRUE here and false in 2D, and it is now the ONLY difference: in 3D a shallow
 * bounce is a real body passing through the mouth, and `BB3_INTAKE_Z` is the roller's reach above
 * the tiles. The old `BB3_CAPTURE_TICKS` consecutive-overlap dwell is gone — the transit to the
 * throat and `BB_INTAKE_CROSS_MAX` do that job now, for both backends.
 *
 * ⚠️ `seat` IS THE DEFAULT (`'chassis'`) AGAIN, because the 3D chassis collider is a COMPOUND
 * with an OPEN intake mouth (`chassis3dShapes`). While it was one `robotExtents` cuboid the mouth
 * was solid, an element could never get nearer than the roller line, and this call had to pass
 * `seat: 'footprint'` to have an arrivable throat at all. Both backends now let an element ride
 * into the pocket and seat on the frame face, so both run the same geometry.
 */
export function elements3dCapture(
  world: World,
  engine: Engine3d,
  cmds: Map<number, RobotCommand>,
  enabled: boolean,
): void {
  // `engine` is kept in the signature (and unused) because this is the stage-11 slot `step3d`
  // calls; the roller model reads the WORLD's JSON and nothing else, which is what lets 2D and
  // 3D run the same function.
  void engine;
  const robots = [...world.robots].sort((a, b) => a.id - b.id);
  for (const rob of robots) {
    if (rob.passive) continue;
    const cmd = cmds.get(rob.id);
    if (!(enabled && (rob.autoIntake || (cmd?.intake ?? false)))) continue;
    const act = bbIntakeAct(world, rob, { lowFlight: true });
    for (const p of act.pull) p.ball.vel = p.vel;
    for (const b of act.take) capturePollen(world, rob, b);
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
      // ⚠️ A DUMPER IS GATED ON ITS CHASSIS HEADING, exactly as a turret is gated on its yaw and
      // pitch. `bbLaunch`'s own re-check is `bbDumpSolution`, which answers REACHABLE, not AIMED —
      // so an unconditional `lands: [true]` here let a dumper empty its whole hopper on the first
      // tick fire was held, at whatever heading it happened to be sitting at. The 2D pipeline has
      // always gated it (`play.ts` stage 5b); 3D did not, and 3D is now every server-connected
      // match. The chassis-aim hook in `step3dImpl.ts` steers it here while fire is held.
      //
      // The LANDING half of stage 5b (`bbFlightEnters` on every throw) is deliberately NOT copied:
      // this file gates on ALIGNMENT rather than a ballistic prediction -- see the header -- and
      // the 3D solve is what decides where a throw actually lands.
      //
      // ⚠️ AND IT POURS, ONE ELEMENT AT A TIME (`BbShot.perDump`, `robot.ts`). 2D throws the whole
      // hopper on one tick because a 2D flight element collides with nothing; here every one is a
      // real body and `bbDumpSolution` converges all of them on the SAME cell-centre point, so a
      // four-element dump is a four-way pile-up in the opening. Measured on the tutorial's own
      // 28-pose grid, with the birth clearance in: four at once 3/28, one every
      // `BB_DUMP_STAGGER_S` 20/28. This is the ONLY caller that sets the field, and 2D's dumper
      // branch is untouched by its existence.
      const want = bbAimHeading(rob, target);
      const aligned = want !== null && Math.abs(wrapAngle(want - rob.heading)) < BB_AIM_TOL;
      shots.set(rob.id, { target, speed: [], lands: [aligned], perDump: 1 });
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
