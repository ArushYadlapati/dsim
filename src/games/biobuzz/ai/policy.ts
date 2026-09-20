import type { Alliance, Artifact, RobotCommand, RobotState, Vec2, World } from '../../../types';
import type { BotSeat } from '../../types';
import { SIM_DT } from '../../../config';
import { clamp, datan2, dcos, dsin, hyp, nextRandom, rot, wrapAngle } from '../../../math';
import { localizeCommand } from '../../../net/protocol';
import { driveParams } from '../../../sim/drivetrain';
import { viewAngleOf } from '../../../sim/field';
import {
  BB_AIM_TOL,
  BB_AI_ARRIVE_TOL,
  BB_AI_DECIDE_TICKS,
  BB_AI_DUMP_STANDOFF,
  BB_AI_ESCAPE_DECISIONS,
  BB_AI_GIVEUP_RADIUS,
  BB_AI_GRAB_TOL,
  BB_AI_HIVE_CLEARANCE,
  BB_AI_HIVE_CREEP,
  BB_AI_HIVE_KEEPOUT_PAD,
  BB_AI_ROBOT_CLEAR,
  BB_AI_SLOW_FLOOR,
  BB_AI_SLOW_RADIUS,
  BB_AI_LZ_GUARD,
  BB_AI_PIN_DECISIONS,
  BB_AI_STUCK_DECISIONS,
  BB_AI_STUCK_SPEED,
  BB_AI_SWITCH_FRAC,
  BB_AI_TARGET_COOLDOWN,
  BB_AI_TURN_GAIN,
  BB_AI_TURRET_STANDOFF,
  BB_AI_WALL_NEAR,
  BB_FLOWERS,
  BB_FLOWER_UNLOCK_S,
  BB_HALF_X,
  BB_HALF_Y,
  BB_HIVE_LEN,
  BB_HIVE_LOWEST_Z,
  BB_HIVE_X,
  BB_HOOD_DEFAULT_DEG,
  BB_LAUNCH_Z0,
  bbDeployedHeightIn,
  bbHopperCap,
  bbLoadingZoneSpot,
  BB3_INTAKE_Z,
} from '../config';
import { hiveCellTarget } from '../elements';
import { bbElementRadius, flowerFits } from '../flower';
import { bbCarriesNectar, bbIntakeAccepts, bbIsTurreted, bbLauncherOf, bbLiftOf } from '../mechs';
import { EDGE_ANGLE, MOUNT_ANGLE, bbIntakeEdges, bbIntakeMountOf, type BbEdge } from '../mounts';
import { bbAimTarget, bbCellSideOf, bbFlightEnters } from '../play';
import {
  bbAimHeading,
  bbDumpSolution,
  bbFlowerInReach,
  bbMouths,
  bbPlacePointLocal,
  bbTurretRelease,
  bbTurretSolution,
} from '../robot';
import { bbKindIndex, bbParkedNow } from '../score';
import { bbOwnSide } from '../start';
import type { BiobuzzState, ScoreTarget } from '../state';
import { bbTierSpec, type BbAiTierSpec } from './tiers';

/**
 * BIOBUZZ AI — THE POLICY (Day 3, `docs/biobuzz/plan-3d.md` §6).
 *
 * ── WHAT IT IS ──────────────────────────────────────────────────────────────
 * A deterministic, DOM-free state machine that returns one `RobotCommand` per tick for one
 * seat: collect → route → fire → place → defend → park. It is a DRIVER, not a cheat: it holds
 * the same seven sticks and buttons a human holds, and everything it does goes through the
 * ordinary pipeline — `bbLaunch` still decides whether its shot goes, `capturePollen` still
 * decides whether its intake takes, `penalties.ts` still bills it.
 *
 * ── THE READ LIST, AND WHY IT IS SHORT ──────────────────────────────────────
 * Positions and the DERIVED lists, and nothing else:
 *   `world.match.phase` / `.phaseTimeLeft`      the clock every driver can see
 *   `world.robots[*]`  pos, heading, vel, alliance, spec, hopper, turret yaw/pitch, passive
 *   `world.balls[*]`   pos, state.kind, color
 *   `world.biobuzz`    `hives[a].up/tipping/contents`, `flowers[i].stack`, `nectarDue`
 *
 * That list is what lets ONE policy drive under BOTH physics. `derive.ts` fills the same
 * `contents`/`stack` fields under the 3D solve that `play.ts` fills under the 2D one, and a
 * ball's `pos` means the same thing in both — so nothing here asks which pipeline it is in, and
 * nothing here would have to change if a third one appeared.
 *
 * ⚠️ **IT NEVER READS `world.rngState`.** Its randomness is its OWN mulberry32 chain, seeded
 * `(matchSeed, seat)` by the caller. Drawing from the world's chain would move every LATER draw
 * in the match — a spill's scatter, a human player's entry jitter — so a client predicting a
 * tick the bot also ran would diverge from the server, and a replay would not re-simulate. The
 * AI smoke lane proves the absence with a `Proxy` that throws on the property.
 *
 * ⚠️ **NO CLOCK, NO `Math.random`, NO DOM, NO `sim3d/`.** The first three are the shared
 * determinism rule (`scripts/smoke.ts`'s source guard scans `src/games/`). The fourth is this
 * game's own: `sim3d/` is a LAZY chunk and a static import of it from here would drag 1.1 MB of
 * wasm glue into the main bundle for every player of every game. The AI lane checks it.
 *
 * ── THE MEMORY IS THE CALLER'S ──────────────────────────────────────────────
 * `createBiobuzzBot` returns a `BotSeat` the caller owns for the match. Nothing about the bot is
 * written to the `World`: see `BotSeat`'s own header in `src/games/types.ts` for why.
 *
 * ── HOLD-LAST ───────────────────────────────────────────────────────────────
 * The bot RE-DECIDES every `BB_AI_DECIDE_TICKS` and repeats the last command in between, so a
 * recorded bot track is runs of identical commands — which is what a replay's per-seat command
 * array compresses. The decision tick is staggered by `robotId` so four bots in a room do not
 * all solve an arc on the same tick.
 *
 * ── THE COMMAND IS QUANTIZED ────────────────────────────────────────────────
 * Every command leaves through `localizeCommand`, i.e. the wire round-trip. A bot seat's command
 * is recorded and broadcast like a driver's, so if it emitted a raw float the recorded value and
 * the simulated value would differ in the last bits and a replay would not re-simulate exactly.
 * `localizeCommand` is idempotent, so the lane's check is literally `localizeCommand(c)` deep-
 * equals `c`.
 */

/** the modes, in the order the decision considers them. (ESCAPE is not one: it returns before
 * the mode is chosen, because a bot backing out of something is not doing a job.) */
type BbAiMode = 'park' | 'place' | 'score' | 'defend' | 'collect';

/** one bot's private memory — the thing that must never be on the `World`. */
interface BbBotMemory {
  rngState: number;
  /** the command repeated between decisions. */
  last: RobotCommand;
  /** stagger, so two seats do not decide on the same tick. */
  phase: number;
  first: boolean;
  /** consecutive decisions spent commanding drive while barely moving. */
  stuck: number;
  /** decisions of reverse-and-turn left to spend. */
  escape: number;
  /** consecutive decisions spent in contact with another ROBOT — the G421 clock, see
   * `BB_AI_PIN_DECISIONS`. */
  leaning: number;
  /** which way the escape turns — drawn once per escape so it does not dither. */
  escapeTurn: number;
  /** was the last command asking for translation? (the stuck test's other half: a bot that is
   * deliberately holding still is not stuck.) */
  driving: boolean;
  /** the element this bot is currently going for. */
  target: number | null;
  /**
   * Decisions spent COLLECTING with nothing to show for it — the patience clock, measured
   * against the one thing that says the bot is getting anywhere: the HOPPER COUNT.
   *
   * ⚠️ **NOT "decisions spent on the same element id".** That was the first version and it never
   * fired: two elements resting against each other in a corner are alternately the nearest one,
   * so the id flipped every decision, the counter reset every decision, and a bot pressed into
   * the perimeter stayed there for a hundred seconds with its patience permanently at 1. The
   * hopper cannot be gamed that way — it goes up when the bot collects something and it does not
   * otherwise, whichever element it happened to be aiming at.
   */
  noProgress: number;
  /** `r.hopper.length` as of the previous decision — what `noProgress` is measured against. */
  lastHopper: number;
  /** element id -> the decision count at which it becomes interesting again. A plain map rather
   * than a set with a timer, so one entry expires without touching the others. */
  giveUp: Map<number, number>;
  /** decisions since this bot was seated — the clock `giveUp` is written against. It is the
   * BOT's own count, not `world.tick`, so a cooldown means the same number of decisions however
   * often the caller happens to step it. */
  decisions: number;
}

/** a full zero command, already quantized (every axis is exactly 0/127). */
const ZERO: RobotCommand = localizeCommand({
  driveX: 0,
  driveY: 0,
  rotate: 0,
  leftDrive: 0,
  rightDrive: 0,
  intake: false,
  fire: false,
});

/** the buttons a decision may press, gathered so `command()` has one parameter rather than six. */
interface BbAiButtons {
  intake: boolean;
  fire: boolean;
  place: boolean;
  placeNectar: boolean;
  nectar: boolean;
}

const NO_BUTTONS: BbAiButtons = {
  intake: false,
  fire: false,
  place: false,
  placeNectar: false,
  nectar: false,
};

/**
 * SEAT A BOT. `seed` is the caller's `(matchSeed, seat)` — see `BotDriver.create`.
 *
 * `world` is read once, for nothing but the stagger; the seat re-finds its robot every tick, so
 * a robot that leaves and comes back (a reconnect, a scene rebuild) is picked up again rather
 * than held as a stale reference.
 */
export function createBiobuzzBot(world: World, robotId: number, tier: string, seed: number): BotSeat {
  void world;
  const t = bbTierSpec(tier);
  const mem: BbBotMemory = {
    // MIX THE SEAT INTO THE SEED. Two bots in one match are handed the same `matchSeed` by a
    // caller that seeds per match, so without this both seats would draw the identical
    // hesitation stream and dither in lockstep. `Math.imul` is IEEE-exact and allowed.
    rngState: (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(robotId + 1, 0x85ebca6b)) | 0,
    last: ZERO,
    phase: ((robotId % BB_AI_DECIDE_TICKS) + BB_AI_DECIDE_TICKS) % BB_AI_DECIDE_TICKS,
    first: true,
    stuck: 0,
    escape: 0,
    leaning: 0,
    escapeTurn: 1,
    driving: false,
    target: null,
    noProgress: 0,
    lastHopper: 0,
    giveUp: new Map(),
    decisions: 0,
  };

  return {
    step(w: World): RobotCommand {
      const r = w.robots.find((x) => x.id === robotId);
      // NO ROBOT, NO COMMAND. A seat whose robot left mid-match holds zero rather than throwing:
      // the room still has to produce a command for the tick it is on.
      if (!r) return ZERO;
      const decide = mem.first || w.tick % BB_AI_DECIDE_TICKS === mem.phase;
      if (decide) {
        mem.first = false;
        mem.last = decideCommand(w, r, t, mem);
      }
      return mem.last;
    },
  };
}

/** one draw off the bot's OWN chain, in [0, 1). */
function roll(mem: BbBotMemory): number {
  const n = nextRandom(mem.rngState);
  mem.rngState = n.state;
  return n.value;
}

/** THE DECISION — run once per `BB_AI_DECIDE_TICKS`, and the whole of the policy. */
function decideCommand(world: World, r: RobotState, t: BbAiTierSpec, mem: BbBotMemory): RobotCommand {
  const bb = world.biobuzz as BiobuzzState | undefined;
  const phase = world.match.phase;
  // DISABLED IS ZERO, not "hold the last command". `step.ts` zeroes a disabled robot's command
  // anyway, so this changes nothing the sim sees — but it changes what is RECORDED, and a
  // recorded track that shows a bot holding full stick through the auto→teleop transition is a
  // replay that reads like a bug.
  if (!bb || (phase !== 'auto' && phase !== 'teleop' && phase !== 'freeplay')) {
    mem.driving = false;
    mem.stuck = 0;
    return ZERO;
  }

  // HESITATION — the reaction model. Skipping a decision holds the last command for another
  // window; it is not a delay queue. See `BbAiTierSpec.hesitate`.
  if (t.hesitate > 0 && roll(mem) < t.hesitate) return mem.last;

  const a = r.alliance;
  const auto = phase === 'auto';
  const hive = bb.hives[a];
  const cap = bbHopperCap(r.spec);
  const launcher = bbLauncherOf(r.spec, BB_HOOD_DEFAULT_DEG);
  const turreted = bbIsTurreted(launcher);
  const tall = bbDeployedHeightIn(r.spec) + BB_AI_HIVE_CLEARANCE > BB_HIVE_LOWEST_Z;

  // ---- STUCK: measured, not guessed --------------------------------------------------------
  // A bot that COMMANDED translation last window and is barely moving is against something. The
  // "commanded" half matters: a bot sitting at its firing spot on purpose is stationary and is
  // not stuck, and without that half it would reverse out of every shot it lined up.
  if (mem.escape > 0) {
    mem.escape--;
    return escapeCommand(r, t, mem);
  }
  if (mem.driving && hyp(r.vel.x, r.vel.y) < BB_AI_STUCK_SPEED) mem.stuck++;
  else mem.stuck = 0;

  /**
   * G421, FROM THE BOT'S SIDE — back off an opponent it has been leaning on.
   *
   * PINNING is billed in SECONDS (a MAJOR past three, and again every three after that), so the
   * only thing that avoids it is noticing the clock. Contact is read as distance rather than off
   * `world.rrContacts`: the two are the same fact and a distance is a position read, which is all
   * this policy is allowed. Backing off is the SAME escape a wedged bot runs, because from the
   * bot's point of view it is the same situation — something it is pressed against that it should
   * stop pressing against.
   */
  let leaning = false;
  for (const o of world.robots) {
    if (o.id === r.id || o.alliance === r.alliance) continue;
    const touch = (hyp(r.spec.length, r.spec.width) + hyp(o.spec.length, o.spec.width)) / 2;
    if (hyp(o.pos.x - r.pos.x, o.pos.y - r.pos.y) < touch) leaning = true;
  }
  mem.leaning = leaning ? mem.leaning + 1 : 0;
  if (mem.leaning >= BB_AI_PIN_DECISIONS) {
    mem.leaning = 0;
    mem.escape = BB_AI_ESCAPE_DECISIONS;
    mem.escapeTurn = roll(mem) < 0.5 ? -1 : 1;
    return escapeCommand(r, t, mem);
  }
  if (mem.stuck >= BB_AI_STUCK_DECISIONS) {
    mem.stuck = 0;
    mem.escape = BB_AI_ESCAPE_DECISIONS;
    mem.escapeTurn = roll(mem) < 0.5 ? -1 : 1;
    // WHATEVER IT WAS GOING FOR IS WHAT IT IS STUCK ON. Backing out and then driving straight
    // back at the same element is the loop this escape exists to break, so the target goes on
    // the give-up list at the same moment the reverse starts.
    if (mem.target !== null) giveUpOn(world, mem, mem.target);
    return escapeCommand(r, t, mem);
  }

  // ---- WHAT IS AVAILABLE --------------------------------------------------------------------
  const carriesNectar = bbCarriesNectar(launcher);
  const wantNectar = t.places && carriesNectar && bbLiftOf(r.spec) !== null;
  mem.decisions++;
  let ball = nearestElement(world, r, auto || t.homeOnly, wantNectar, tall, mem);
  /**
   * NOTHING LEFT? THEN THE GIVE-UP LIST IS WRONG. — the safety valve on `mem.giveUp`.
   *
   * The list is a HEURISTIC about reachability, and a heuristic that has eliminated every
   * element on the field has plainly over-fired: the field moves, a spill or a shove frees what
   * was wedged, and an empty candidate set is the one situation in which re-trying costs nothing.
   * Without it the bot's own memory is what starves it — measured, the tier with the SHORTEST
   * patience wrote off the field fastest and therefore finished LAST, losing 20 of 20 to the
   * tier below it.
   */
  if (ball === null && mem.giveUp.size > 0) {
    mem.giveUp.clear();
    ball = nearestElement(world, r, auto || t.homeOnly, wantNectar, tall, mem);
  }
  const holdingNectar = r.hopper.some((c) => c === 'red' || c === 'blue');
  const placeWindow = phase === 'teleop' && world.match.phaseTimeLeft <= BB_FLOWER_UNLOCK_S;
  const flower = wantNectar && holdingNectar && placeWindow ? nearestFlower(world, bb, r, auto) : null;

  // ---- THE MODE, first match wins -----------------------------------------------------------
  let mode: BbAiMode;
  if (t.parkAtS > 0 && phase === 'teleop' && world.match.phaseTimeLeft <= t.parkAtS) mode = 'park';
  else if (flower !== null) mode = 'place';
  else if (r.hopper.length >= cap || (r.hopper.length > 0 && ball === null)) mode = 'score';
  else if (ball !== null) mode = 'collect';
  else if (t.defends && r.hopper.length === 0) mode = 'defend';
  else mode = 'collect';
  // the patience clock, which only runs while the bot is actually trying to pick something up
  trackTarget(world, mem, t, r, ball, mode === 'collect');

  // ---- THE HUMAN PLAYER'S BUTTON ------------------------------------------------------------
  // Spent at the ZONE, not the instant it is earned — a NECTAR sitting in the LOADING ZONE is
  // one the opponent can also drive to, which is exactly why `bbNectar` is a driver action and
  // not a drip (see `bbHumanPlayerTick`). `nectarDue > 0` is the whole entitlement test the bot
  // needs: the sim zeroes the debt itself when the stock runs out.
  const lz = bbLoadingZoneSpot(a);
  /**
   * ⚠️ **AN ENTRY IS ONLY SPENT BY A BOT THAT CAN USE THE NECTAR.**
   *
   * `wantNectar` is "this build can carry one AND this tier places" — a single turret feeds
   * POLLEN only (`bbCarriesNectar`), so for most builds a NECTAR on the tiles is an element the
   * robot cannot pick up, cannot score and will shove around the field. Measured before this
   * gate: a turret bot that spent its entitlement on principle pushed its own NECTAR into a
   * FLOWER before the 1:00 cue and was billed THREE G410 MAJORS for it — 60 points, to the
   * opponent, for an element it never wanted.
   *
   * The `placeWindow` half is the same rule seen from the clock: the FLOWERS do not unlock until
   * 1:00, so an entry spent before then buys nothing even for a build that can place.
   */
  const nectarPress =
    t.entersNectar &&
    wantNectar &&
    placeWindow &&
    bb.nectarDue[a] > 0 &&
    hyp(r.pos.x - lz.x, r.pos.y - lz.y) <= BB_AI_LZ_GUARD;

  const buttons: BbAiButtons = { ...NO_BUTTONS, nectar: nectarPress };

  switch (mode) {
    case 'park':
      return route(world, r, t, mem, lz, null, { ...buttons, intake: r.hopper.length < cap }, tall, bbParkedNow(r));
    case 'place':
      return placeRoute(world, r, t, mem, flower as number, buttons, tall);
    case 'score':
      return scoreRoute(world, r, t, mem, bb, hive, turreted, buttons, tall);
    case 'defend':
      return defendRoute(world, r, t, mem, buttons, tall);
    default:
      return collectRoute(world, r, t, mem, ball, buttons, cap, tall);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// THE MODES
// ─────────────────────────────────────────────────────────────────────────────

/** REVERSE AND TURN — the only mode that ignores the field entirely. */
function escapeCommand(r: RobotState, t: BbAiTierSpec, mem: BbBotMemory): RobotCommand {
  const back = { x: -dcos(r.heading), y: -dsin(r.heading) };
  mem.driving = true;
  return command(r, back, t.speedCap, mem.escapeTurn * 0.7, NO_BUTTONS);
}

/**
 * COLLECT — drive the chosen MOUTH onto the element, intake running.
 *
 * The goal is not the element: it is the point at which THIS ROBOT'S MOUTH is on the element,
 * which is the mouth rect's own centre pulled back through the wanted heading. `bbMouths` is the
 * same geometry `interact()` captures through, so the bot cannot aim an intake it does not have
 * at a place the capture test does not look.
 */
function collectRoute(
  world: World,
  r: RobotState,
  t: BbAiTierSpec,
  mem: BbBotMemory,
  ball: Artifact | null,
  buttons: BbAiButtons,
  cap: number,
  tall: boolean,
): RobotCommand {
  const intake = r.hopper.length < cap;
  if (!ball) {
    // NOTHING TO COLLECT AND NOTHING ELSE TO DO — hold position with the intake running rather
    // than wander. Wandering is what makes a bot look broken; a robot parked with its roller on
    // looks like it is waiting, which is what it is doing.
    mem.driving = false;
    return command(r, { x: 0, y: 0 }, 0, 0, { ...buttons, intake });
  }
  const ap = approach(r, ball.pos);
  return route(world, r, t, mem, ap.goal, ap.heading, { ...buttons, intake }, tall, false, BB_AI_GRAB_TOL);
}

/**
 * SCORE — stand OUTBOARD of the up CELL and hold fire when the arc lands.
 *
 * ⚠️ **OUTBOARD IS NOT A PREFERENCE.** `hiveAccepts` takes an element only over the up cell's
 * open outer lip (`hiveApproachSign`); a shot from the pivot side meets the closed back and
 * bounces off it. So the stand-off is measured along the target's own `mouth` normal, and the
 * bot's whole job in this mode is to be on that side of it.
 *
 * ⚠️ **THE SIM AIMS AT THE NEARER CELL, NOT AT THE UP ONE** (`bbAimTarget` — Aim Assist cannot
 * know which way the HIVE will be tilted when the shot arrives, and neither can a real robot).
 * So the bot does not get to choose its own target: it ROUTES to the up cell, which is what makes
 * the nearer cell BE the up cell, and it computes its verdict against the target the sim will
 * actually use. Until those agree it simply does not fire.
 */
function scoreRoute(
  world: World,
  r: RobotState,
  t: BbAiTierSpec,
  mem: BbBotMemory,
  bb: BiobuzzState,
  hive: BiobuzzState['hives'][Alliance],
  turreted: boolean,
  buttons: BbAiButtons,
  tall: boolean,
): RobotCommand {
  const a = r.alliance;
  const upTarget = hiveCellTarget(a, hive.up);
  const standoff = turreted ? BB_AI_TURRET_STANDOFF : BB_AI_DUMP_STANDOFF;
  const mouth = upTarget.mouth ?? { x: 0, y: 1 };
  const spot = insideField({
    x: upTarget.pos.x + mouth.x * standoff,
    y: upTarget.pos.y + mouth.y * standoff,
  });

  // the target the SIM will aim at, and whether it is the cell that actually scores
  const simTarget = bbAimTarget(world, r);
  const aligned = bbCellSideOf(simTarget) === hive.up;
  /**
   * DO NOT FIRE INTO A SWING THAT HAS ALREADY RELEASED — every tier, not a tier knob.
   *
   * Through the first half of a swing the taking side is still `up` (`hiveTakingSide`), so a shot
   * launched then arrives at the cell the aim solved for and goes in: refusing those is how a
   * driver watches a volley he had already fired pass through the tray. After the RELEASE the
   * taking side is the OTHER cell, rising on the far side of the pivot, and the solved arc is
   * aimed at a hole that is no longer there.
   */
  const mayFire = r.hopper.length > 0 && aligned && !(hive.tipping > 0 && hive.released);
  const fire = mayFire && wantsFire(r, bb, simTarget, t, turreted, standoff);

  // A DUMPER TURNS THE WHOLE ROBOT (`bbAimHeading`); a turret slews itself and the chassis is
  // free, so it keeps pointing at the cell, which is the heading a tank needs to drive there.
  const want = turreted
    ? datan2(upTarget.pos.y - r.pos.y, upTarget.pos.x - r.pos.x)
    : (bbAimHeading(r, simTarget) ?? r.heading);
  // INTAKE OFF WHILE SCORING: a running roller is power draw (`shoveMass` reads `powerDraw`) for
  // a hopper the bot is emptying on purpose.
  return route(world, r, t, mem, spot, want, { ...buttons, fire }, tall, false);
}

/** PLACE — put the Box Tube's placement point on the FLOWER ring and press once. */
function placeRoute(
  world: World,
  r: RobotState,
  t: BbAiTierSpec,
  mem: BbBotMemory,
  index: number,
  buttons: BbAiButtons,
  tall: boolean,
): RobotCommand {
  const lift = bbLiftOf(r.spec);
  const local = bbPlacePointLocal(r.spec);
  const f = BB_FLOWERS[index];
  if (!lift || !local) return collectRoute(world, r, t, mem, null, buttons, bbHopperCap(r.spec), tall);
  const bearing = datan2(f.y - r.pos.y, f.x - r.pos.x);
  const want = wrapAngle(bearing - MOUNT_ANGLE[lift.mount]);
  const off = rot(local, want);
  const goal = { x: f.x - off.x, y: f.y - off.y };
  // THE PRESS IS EDGE-TRIGGERED (`placeLatch`), and the command is held for a whole decision
  // window — so a window in reach places exactly one NECTAR and the rest of the window is a held
  // button doing nothing, which is what a driver's thumb does too.
  const press = bbFlowerInReach(world, r) === index;
  return route(world, r, t, mem, goal, want, { ...buttons, placeNectar: press }, tall, press);
}

/**
 * DEFEND (HARD only) — stand where the opponent wants to stand.
 *
 * It takes the OPPONENT'S own firing spot, which is a position, not a robot: a bot that chased a
 * chassis would end up driving into it, and G421 bills PINNING in seconds. Occupying the spot
 * costs the opponent their range without ever requiring contact, and it is what a real defender
 * does.
 */
function defendRoute(
  world: World,
  r: RobotState,
  t: BbAiTierSpec,
  mem: BbBotMemory,
  buttons: BbAiButtons,
  tall: boolean,
): RobotCommand {
  const bb = world.biobuzz as BiobuzzState;
  const foe: Alliance = r.alliance === 'red' ? 'blue' : 'red';
  const theirs = hiveCellTarget(foe, bb.hives[foe].up);
  const mouth = theirs.mouth ?? { x: 0, y: 1 };
  const spot = insideField({
    x: theirs.pos.x + mouth.x * BB_AI_DUMP_STANDOFF,
    y: theirs.pos.y + mouth.y * BB_AI_DUMP_STANDOFF,
  });
  const want = datan2(theirs.pos.y - r.pos.y, theirs.pos.x - r.pos.x);
  return route(world, r, t, mem, spot, want, { ...buttons, intake: true }, tall, false);
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE POTENTIAL-FIELD STEER (plan §6): straight at the goal, pushed off the HIVE footprint when
 * the robot is too tall to drive under it, squared up to a wall when it is hugging one.
 *
 * `stop` is for a mode that has ARRIVED in its own sense (parked, in reach of a flower): it keeps
 * the heading and drops the translation, so the robot does not keep pressing into whatever it is
 * working on.
 */
function route(
  world: World,
  r: RobotState,
  t: BbAiTierSpec,
  mem: BbBotMemory,
  goal: Vec2,
  wantHeading: number | null,
  buttons: BbAiButtons,
  tall: boolean,
  stop: boolean,
  arriveTol: number = BB_AI_ARRIVE_TOL,
): RobotCommand {
  const dx = goal.x - r.pos.x;
  const dy = goal.y - r.pos.y;
  const dist = hyp(dx, dy);
  const arrived = stop || dist <= arriveTol;
  /**
  /**
   * THE STUCK TEST ONLY WATCHES A BOT THAT IS ASKING FOR REAL SPEED. Inside the arrival radius
   * the command is deliberately eased down (`BB_AI_SLOW_RADIUS`), so a bot settling onto its
   * firing spot is slow ON PURPOSE and must not be reversed out of the shot it just lined up —
   * measured, watching any not-yet-arrived bot instead cost the HARD tier half its head-to-head
   * wins, because every approach ended in a spurious escape.
   *
   * The failure this does NOT catch — a robot pressed against the perimeter a few inches short
   * of an element it can never reach — is prevented earlier and better, by not choosing that
   * element at all: see `reachable` in `nearestElement`.
   */
  mem.driving = !arrived && dist > BB_AI_SLOW_RADIUS;
  if (arrived) return command(r, { x: 0, y: 0 }, 0, turnFor(r, wantHeading, t), buttons);

  let dirX = dx / dist;
  let dirY = dy / dist;
  /**
   * ONE REPULSIVE TERM — push away from `(cx, cy)` while inside `rad`, linear falloff, PLUS a
   * tangential component that slides around it.
   *
   * ⚠️ **THE TANGENT IS THE WHOLE TERM, NOT A REFINEMENT.** A purely radial push cannot get a
   * robot PAST an obstacle that lies between it and its goal: the push and the pull cancel and
   * the robot parks at the balance point. Measured before this existed — after its HIVE tipped,
   * a bot whose firing spot moved to the far side of the assembly sat at (11, 19.7) for the
   * remaining 140 seconds of the match, commanding full drive the whole time, and finished on
   * 28 points. The tangent is picked per obstacle as whichever perpendicular points more toward
   * the goal, so the robot goes round the short way and the equilibrium disappears.
   */
  const push = (cx: number, cy: number, rad: number, radial: number, tangent: number): void => {
    const ox = r.pos.x - cx;
    const oy = r.pos.y - cy;
    const d = hyp(ox, oy);
    if (d >= rad) return;
    const w = clamp((rad - d) / rad, 0, 1);
    const nx = d > 1e-6 ? ox / d : 1;
    const ny = d > 1e-6 ? oy / d : 0;
    dirX += nx * w * radial;
    dirY += ny * w * radial;
    // the perpendicular with the larger component along the goal direction
    const sign = -ny * (dx / dist) + nx * (dy / dist) >= 0 ? 1 : -1;
    dirX += -ny * sign * w * tangent;
    dirY += nx * sign * w * tangent;
  };

  /**
   * THE HIVE — and ONLY for a robot too TALL to pass under it.
   *
   * ⚠️ **A SHORT ROBOT DOES NOT AVOID THE HIVE, ON PURPOSE.** G409's drive-under survives the CAD
   * ruling (`docs/area/biobuzz.md`): the lowest structure is at 30.652 in and a legal 29-in robot
   * clears it, so for most builds the space under the assembly is the SHORTEST PATH between the
   * two halves of the field — and the two CELLS are on opposite sides of the pivot, so a bot
   * whose HIVE has just tipped has to cross it. Repelling a short robot from the middle of its
   * own field turns the one path it needs into the one place it will not go.
   */
  if (tall) {
    const hiveRad = (BB_HIVE_LEN / 2 + BB_AI_HIVE_KEEPOUT_PAD) * 2;
    push(-BB_HIVE_X, 0, hiveRad, 1.5, 1.5);
    push(BB_HIVE_X, 0, hiveRad, 1.5, 1.5);
  }

  /**
   * OTHER ROBOTS — the term that stopped the harder tiers from beating the easier ones.
   *
   * A bot that drives THROUGH an opponent does not get through it: it gets G421 (PINNING, a
   * MAJOR every three seconds it keeps leaning) and hands the points to the robot it is stuck
   * against. Measured before this existed, at full speed, four PINNING majors in one match — 80
   * points, which is most of a BIOBUZZ score. The clearance is the two half-diagonals plus
   * `BB_AI_ROBOT_CLEAR`, so it scales with both chassis rather than assuming a size.
   */
  for (const o of world.robots) {
    if (o.id === r.id) continue;
    const clear =
      hyp(r.spec.length, r.spec.width) / 2 + hyp(o.spec.length, o.spec.width) / 2 + BB_AI_ROBOT_CLEAR;
    // RADIAL-HEAVY, TANGENT-LIGHT. An opponent is a small obstacle in an open field, not a wall
    // to be walked around: a strong tangent turns every pass into a swerve, and two bots swerving
    // off each other spend the match orbiting instead of collecting. Measured: at equal weights
    // the faster tier's head-to-head margin was 8 points against a 2.8x solo advantage.
    push(o.pos.x, o.pos.y, clear, 1.4, 0.5);
  }

  const n = hyp(dirX, dirY);
  if (n > 1e-6) {
    dirX /= n;
    dirY /= n;
  }

  // WALL SQUARE-UP. Only while TRAVELLING and only near a wall: a chassis crossing a perimeter
  // at an angle catches a corner and wedges, and squaring it makes the same path a slide. Once
  // the robot is close to its goal the TASK heading wins again — a mouth or a dumper aimed 45°
  // off because the robot happens to be near a wall is a shot that never lands.
  let heading = wantHeading;
  if (heading !== null && dist > BB_AI_ARRIVE_TOL * 4 && nearWall(r.pos)) {
    heading = Math.round(heading / (Math.PI / 2)) * (Math.PI / 2);
  }

  // EASE OFF ON ARRIVAL — see `BB_AI_SLOW_RADIUS` for the measurement that made this mandatory.
  const ease = clamp(dist / BB_AI_SLOW_RADIUS, BB_AI_SLOW_FLOOR, 1);
  // …and CREEP under the HIVE, whatever the tier's cap. G417 (which used to read the closing
  // speed of a contact with the structure) was removed 2026-09-19; the creep is kept as
  // measured tuning (`BB_AI_HIVE_CREEP`) pending a `test:ai` re-measure, not as a rule dodge.
  const creep = underHive(r.pos, BB_HIVE_LEN / 2) ? Math.min(t.speedCap, BB_AI_HIVE_CREEP) : t.speedCap;
  return command(r, { x: dirX, y: dirY }, creep * ease, turnFor(r, heading, t), buttons);
}

/** the rotate demand (-1..1) that closes the heading error, dead-banded by the tier's tolerance
 * so a lined-up chassis holds still instead of hunting — the same shape `bbAimAssist` uses. */
function turnFor(r: RobotState, wantHeading: number | null, t: BbAiTierSpec): number {
  if (wantHeading === null) return 0;
  const err = wrapAngle(wantHeading - r.heading);
  if (Math.abs(err) < t.aimTol) return 0;
  return clamp(err * BB_AI_TURN_GAIN, -1, 1);
}

/**
 * BUILD THE COMMAND — the one place a wanted WORLD direction becomes sticks, and the one place
 * the quantizer runs.
 *
 * ⚠️ **THE STICK FRAME IS THE ROBOT'S, NOT THE BOT'S.** `updateRobot` interprets `driveX/driveY`
 * through `r.fieldCentric` (and through `viewAngleOf(alliance)` when it is on), so a bot that
 * assumed one frame would drive a red seat the opposite way from a blue one at ±90°. The wanted
 * direction is resolved into the ROBOT frame first and converted back out through whichever
 * frame this seat is actually in, so both are exact inverses of what the sim will do.
 *
 * ⚠️ **A TANK STEERS ONLY FROM ITS SIDE DRIVES.** `updateRobot` takes a tank's yaw from
 * `rightDrive − leftDrive` and IGNORES `rotate` — the same trap `step.ts` documents for the aim
 * override. The turn is trimmed out of the forward demand first (`room`), so the turn always
 * gets its share instead of saturating away.
 */
function command(
  r: RobotState,
  dir: Vec2,
  speed: number,
  turn: number,
  buttons: BbAiButtons,
): RobotCommand {
  const dp = driveParams(r.spec, r.butterflyTank);
  const base = {
    intake: buttons.intake,
    fire: buttons.fire,
    bbPlace: buttons.place,
    bbPlaceNectar: buttons.placeNectar,
    bbNectar: buttons.nectar,
  };
  // the wanted direction in the ROBOT frame: +x forward, +y left
  const robotVec = rot({ x: dir.x * speed, y: dir.y * speed }, -r.heading);
  if (dp.saturation === 'tank') {
    const room = 1 - Math.abs(turn);
    const f = clamp(robotVec.x, -room, room);
    return localizeCommand({
      driveX: 0,
      driveY: 0,
      rotate: 0,
      leftDrive: clamp(f - turn, -1, 1),
      rightDrive: clamp(f + turn, -1, 1),
      ...base,
    });
  }
  // a drivetrain with no strafe is steered, not slid — drop the lateral demand rather than ask
  // for a motion the model will silently zero
  if (dp.strafeMult === 0) robotVec.y = 0;
  let stick: Vec2;
  if (r.fieldCentric) {
    // `updateRobot`: robotVec = rot(rot(stick, −viewAngle), −heading). Inverted, exactly.
    stick = rot(rot(robotVec, r.heading), viewAngleOf(r.alliance));
  } else {
    // `updateRobot`: robotVec = { x: stick.y, y: −stick.x }
    stick = { x: -robotVec.y, y: robotVec.x };
  }
  return localizeCommand({
    driveX: clamp(stick.x, -1, 1),
    driveY: clamp(stick.y, -1, 1),
    rotate: turn,
    leftDrive: 0,
    rightDrive: 0,
    ...base,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// THE SHOT VERDICT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SHOULD THE TRIGGER BE HELD — the SHARED verdict, run the way stage 5b runs it.
 *
 * It is the same three calls in the same order (`bbTurretSolution` → `bbTurretRelease` →
 * `bbFlightEnters`, or `bbAimHeading` → `bbDumpSolution` → `bbFlightEnters`) against the same
 * PRETEND hive stage 5b builds, so a `true` here means `bbLaunch` will release this tick. A
 * second opinion about whether a shot goes in would make the bot hold a trigger that never
 * fires — the exact failure `bbFlightEnters`' own header warns about for Aim Assist.
 *
 * A LOOSE tier skips it and squeezes on range alone. That is safe (the sim still refuses the
 * release) and it is the difference the tier table is for: a loose bot stands at the wrong range
 * holding a trigger, because nothing told it the arc was short.
 */
function wantsFire(
  r: RobotState,
  bb: BiobuzzState,
  target: ScoreTarget,
  t: BbAiTierSpec,
  turreted: boolean,
  standoff: number,
): boolean {
  const a = r.alliance;
  if (!t.strictVerdict) {
    const d = hyp(target.pos.x - r.pos.x, target.pos.y - r.pos.y);
    if (d > standoff * 1.6) return false;
    if (turreted) return true;
    const want = bbAimHeading(r, target);
    return want !== null && Math.abs(wrapAngle(want - r.heading)) < t.aimTol;
  }

  // stage 5b's pretend hive, verbatim: the aimed cell up, settled, nothing already in the air
  const pretend: BiobuzzState['hives'][Alliance] = {
    ...bb.hives[a],
    up: bbCellSideOf(target),
    tipping: 0,
    released: false,
  };
  const launcher = bbLauncherOf(r.spec, BB_HOOD_DEFAULT_DEG);
  if (turreted) {
    const exits: readonly (0 | 1)[] = launcher.kind === 'twinturret' ? [0, 1] : [0];
    for (const which of exits) {
      const sol = bbTurretSolution(r, target, which);
      if (!sol || !sol.reachable) continue;
      const rel = bbTurretRelease(r, which, sol.speed);
      // `rel.z` — stage 5b's own release height, so the bot's verdict and the sim's agree.
      if (bbFlightEnters(pretend, a, rel.origin, rel.z, rel.vel, SIM_DT)) return true;
    }
    return false;
  }
  const want = bbAimHeading(r, target);
  if (want === null || Math.abs(wrapAngle(want - r.heading)) >= BB_AIM_TOL) return false;
  const throws = bbDumpSolution(r, target, r.hopper.length);
  return (
    throws !== null &&
    // the DUMPER's lip is flat (no hood) — `BB_LAUNCH_Z0` unchanged.
    throws.every((th) => bbFlightEnters(pretend, a, th.origin, BB_LAUNCH_Z0, th.vel, SIM_DT))
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOOKUPS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE NEAREST GROUND ELEMENT THIS ROBOT MAY ACTUALLY TAKE.
 *
 * `bbIntakeAccepts` is the sim's own predicate (G408, plus a single turret's POLLEN-only feed),
 * asked here rather than re-spelled — a bot that drove across the field for a NECTAR its
 * launcher cannot carry would look broken and would be right to.
 *
 * ⚠️ **NO AUTO TARGET PAST THE FIELD'S OWN HALF** (plan §6). During AUTO every tier stays on its
 * own side: the opposite half is where the other alliance is working, and a bot crossing it in
 * AUTO is a collision the driver of a practice match did not ask for — and G402 bills it as a
 * MAJOR. An EASY bot keeps the habit all match (`BbAiTierSpec.homeOnly`).
 */
function nearestElement(
  world: World,
  r: RobotState,
  homeOnly: boolean,
  wantNectar: boolean,
  tall: boolean,
  mem: BbBotMemory,
): Artifact | null {
  const side = bbOwnSide(r.alliance);
  const keepOut = BB_HIVE_LEN / 2 + BB_AI_HIVE_KEEPOUT_PAD;
  let best: Artifact | null = null;
  let bestD = Infinity;
  let held: Artifact | null = null;
  let heldD = Infinity;
  for (const b of world.balls) {
    if (b.state.kind !== 'ground') continue;
    // ...AND LOW ENOUGH TO REACH. `ground` means "loose on the field, at rest", which under 3D
    // physics includes an element sitting on the HIVE frame 39 in up (`sim3d/derive.ts`). The
    // sweeper's reach is `BB3_INTAKE_Z`; anything above it is scenery, and a bot that routes to
    // one spends the match parked under it.
    if (b.z > BB3_INTAKE_Z) continue;
    const nectar = b.color === 'red' || b.color === 'blue';
    if (nectar && !wantNectar) continue;
    if (!bbIntakeAccepts(r.spec, r.alliance, b.color)) continue;
    if (homeOnly && side * b.pos.x < 0) continue;
    if (tall && underHive(b.pos, keepOut)) continue;
    // an element this bot has already failed to reach, still inside its cooldown
    const until = mem.giveUp.get(b.id);
    if (until !== undefined && mem.decisions < until) continue;
    const d = hyp(b.pos.x - r.pos.x, b.pos.y - r.pos.y);
    if (b.id === mem.target) {
      held = b;
      heldD = d;
    }
    // ties broken by the LOWER id, never by array order: `world.balls` order is stable but is
    // not a promise, and two elements at the same distance must resolve the same way on every
    // peer and in every replay.
    if (d < bestD - 1e-9 || (d < bestD + 1e-9 && best !== null && b.id < best.id)) {
      bestD = Math.min(bestD, d);
      best = b;
    }
  }
  // COMMITMENT (see `BB_AI_SWITCH_FRAC`): the element the bot was already going for wins unless
  // the new one is substantially closer. `held` is null when the old target has been captured,
  // launched, blacklisted or has left the allowed half, so a finished target never sticks.
  if (held && bestD > heldD * BB_AI_SWITCH_FRAC) return held;
  return best;
}

/**
 * PATIENCE — notice when the bot has been going for one element for too long and give up on it.
 *
 * The give-up is the point: `nearestElement` is a greedy rule, and a greedy rule with no memory
 * of its own failures will pick the same unreachable element every decision for the rest of the
 * match. What "unreachable" means is not something a position read can answer (wedged behind a
 * FLOWER foot, pinned under a frame bar, sitting inside another chassis), so the bot answers it
 * empirically: it tries for its tier's `patience` in decisions and, if nothing reached the hopper,
 * ignores that element for `BB_AI_TARGET_COOLDOWN` and goes and does something else. A COOLDOWN
 * rather than a permanent ban because the field moves — a spill or a shove can free it.
 */
function trackTarget(
  world: World,
  mem: BbBotMemory,
  t: BbAiTierSpec,
  r: RobotState,
  ball: Artifact | null,
  collecting: boolean,
): void {
  const id = ball?.id ?? null;
  mem.target = id;
  const grew = r.hopper.length > mem.lastHopper;
  mem.lastHopper = r.hopper.length;
  if (!collecting || grew || id === null) {
    mem.noProgress = 0;
    return;
  }
  mem.noProgress++;
  if (mem.noProgress < t.patience) return;
  giveUpOn(world, mem, id);
  mem.noProgress = 0;
}

/**
 * WRITE OFF an element AND ITS NEIGHBOURS for `BB_AI_TARGET_COOLDOWN` decisions — see
 * `BB_AI_GIVEUP_RADIUS` for why the neighbours are the point.
 */
function giveUpOn(world: World, mem: BbBotMemory, id: number): void {
  const until = mem.decisions + BB_AI_TARGET_COOLDOWN;
  const at = world.balls.find((b) => b.id === id);
  mem.giveUp.set(id, until);
  if (at) {
    for (const b of world.balls) {
      if (b.state.kind !== 'ground') continue;
      if (hyp(b.pos.x - at.pos.x, b.pos.y - at.pos.y) <= BB_AI_GIVEUP_RADIUS) mem.giveUp.set(b.id, until);
    }
  }
  mem.target = null;
}

/** the nearest FLOWER with room for a NECTAR, or `null`. */
function nearestFlower(world: World, bb: BiobuzzState, r: RobotState, auto: boolean): number | null {
  const kindOf = bbKindIndex(world);
  const side = bbOwnSide(r.alliance);
  let best: number | null = null;
  let bestD = Infinity;
  for (let i = 0; i < BB_FLOWERS.length; i++) {
    const f = BB_FLOWERS[i];
    if (auto && side * f.x < 0) continue;
    if (!flowerFits(bb.flowers[i].stack, kindOf, bbElementRadius(r.alliance))) continue;
    const d = hyp(f.x - r.pos.x, f.y - r.pos.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * THE POSE THAT PUTS THIS ROBOT'S MOUTH ON `at` — the chassis position and heading, together.
 *
 * ONE function because two callers need the same answer and a disagreement between them is the
 * bug: `collectRoute` drives to it, and `nearestElement` asks whether it is somewhere a chassis
 * can legally be before it picks the element at all.
 */
function approach(r: RobotState, at: Vec2): { heading: number; goal: Vec2 } {
  const edge = bestMouthEdge(r, at);
  const bearing = datan2(at.y - r.pos.y, at.x - r.pos.x);
  const heading = wrapAngle(bearing - EDGE_ANGLE[edge]);
  const off = rot(mouthCentre(r, edge), heading);
  return { heading, goal: { x: at.x - off.x, y: at.y - off.y } };
}

/** which mounted intake edge is the cheapest to bring onto `at` — the one whose required heading
 * is the smallest turn from here. A `frontback` or `side` build has two, and picking the far one
 * is a wasted 180°. */
function bestMouthEdge(r: RobotState, at: Vec2): BbEdge {
  const edges = bbIntakeEdges(bbIntakeMountOf(r.spec));
  const bearing = datan2(at.y - r.pos.y, at.x - r.pos.x);
  let best = edges[0];
  let bestErr = Infinity;
  for (const e of edges) {
    const err = Math.abs(wrapAngle(bearing - EDGE_ANGLE[e] - r.heading));
    if (err < bestErr) {
      bestErr = err;
      best = e;
    }
  }
  return best;
}

/** the robot-local centre of `edge`'s mouth rect, off `bbMouths` — the same rects the capture
 * test reads, so "where the roller is" has one answer. */
function mouthCentre(r: RobotState, edge: BbEdge): Vec2 {
  for (const m of bbMouths(r.spec)) {
    if (m.edge === edge) return { x: (m.x0 + m.x1) / 2, y: (m.y0 + m.y1) / 2 };
  }
  return { x: 0, y: 0 };
}

/** is this point inside a HIVE's footprint circle? Both hives — see `route`. */
function underHive(p: Vec2, rad: number): boolean {
  return hyp(p.x - BB_HIVE_X, p.y) < rad || hyp(p.x + BB_HIVE_X, p.y) < rad;
}

/** is the robot hugging a perimeter wall? */
function nearWall(p: Vec2): boolean {
  return (
    Math.abs(p.x) > BB_HALF_X - BB_AI_WALL_NEAR || Math.abs(p.y) > BB_HALF_Y - BB_AI_WALL_NEAR
  );
}

/** pull a goal point inside the perimeter, so a stand-off solved off a CELL that sits near a
 * wall is somewhere a chassis can actually be. */
function insideField(p: Vec2): Vec2 {
  const m = BB_AI_WALL_NEAR;
  return {
    x: clamp(p.x, -BB_HALF_X + m, BB_HALF_X - m),
    y: clamp(p.y, -BB_HALF_Y + m, BB_HALF_Y - m),
  };
}
