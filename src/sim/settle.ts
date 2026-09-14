import { BALL_REST_SPEED, SIM_DT } from '../config';
import type { World } from '../types';

/**
 * WHEN IS A MATCH OVER — the one answer the server, solo practice and the tests all share.
 *
 * The buzzer ends DRIVING, not SCORING. After it an artifact can still be in the air, draining
 * the ramp, or rolling into the depot; a BIOBUZZ tray can still be swinging; a Chain Reaction
 * particle can still be on its way into the accelerator. The manual assesses all of those "after
 * all SCORING ELEMENTS and ROBOTS have come to rest" (BIOBUZZ §10.5 A/C says it in so many words,
 * and DECODE's resting-position rules — pattern, depot, base — only make sense the same way).
 *
 * It used to be a fixed 2.8 s (`MATCH_SETTLE_S`): the server finalized on that timer whatever was
 * still moving, and the results screen revealed on its own wall-clock copy of it off the client's
 * PREDICTED world. So a score could be saved before it was done, and the number a driver watched
 * land was not necessarily the one that was saved. A BIOBUZZ tip, whose swing alone is 4 s, could
 * not fit inside the window at all.
 *
 * Now a match is FINALIZED — captured, saved, broadcast — once the game says nothing left on the
 * field can change the score (`GameSimModule.settled`), and that has stayed true for
 * `MATCH_SETTLE_HOLD_S`. The results screen reveals only on that finalized result.
 *
 * DETERMINISTIC: every input is world state and the tick counter, never a clock, so the same
 * match finalizes on the same tick on every machine and in a re-simulation.
 */

/**
 * How long "settled" must hold before the match is finalized. A single quiet tick is not rest:
 * a rail artifact can read zero speed at the top of a bounce, and a pile can go still for a tick
 * between two contacts.
 */
export const MATCH_SETTLE_HOLD_S = 0.5;

/**
 * THE CAP — 10 s, and that is the owner's ABSOLUTE maximum (2026-09-13): nobody waits longer
 * than this for a result. Something can fail to come to rest for reasons that have nothing to do
 * with scoring — a pile jittering against a chassis, an artifact wedged under a gate paddle the
 * solver keeps nudging — and a match must not stay open because of it.
 *
 * Known to bind: a BIOBUZZ tip that sets off a SECOND tip (two 4 s swings plus the spill landing)
 * can outlast it, and the score is then captured mid-swing — where PR 65's buzzer rule (a swing
 * in progress is paid as the tip it becomes) still counts it correctly. Do not raise this
 * without the owner.
 */
export const MATCH_SETTLE_MAX_S = 10;

/** a robot moving slower than this (in/s) and turning slower than `ROBOT_REST_TURN` is at rest */
export const ROBOT_REST_SPEED = 2;
/** rad/s */
export const ROBOT_REST_TURN = 0.1;

/** where a match is in its post-buzzer settle. Plain data; tick numbers, not times. */
export interface SettleClock {
  /** the first `post` tick seen, or null before the buzzer */
  postTick: number | null;
  /** the tick the field was first seen settled in an unbroken run, or null */
  restTick: number | null;
}

export function newSettleClock(): SettleClock {
  return { postTick: null, restTick: null };
}

/**
 * Advance the settle clock by what the world looks like now. Returns true on the tick the match
 * should be FINALIZED. Call it once per simulated tick (the server does); calling it less often
 * only ever finalizes later, never earlier, because both windows are measured in ticks elapsed.
 *
 * `settled` is the game's own predicate; absent, the field counts as settled at once and the
 * match finalizes after the hold alone.
 */
export function settleStep(
  clock: SettleClock,
  world: World,
  settled: ((w: World) => boolean) | undefined,
): boolean {
  if (world.match.phase !== 'post') {
    clock.postTick = null;
    clock.restTick = null;
    return false;
  }
  if (clock.postTick === null) clock.postTick = world.tick;
  if ((world.tick - clock.postTick) * SIM_DT >= MATCH_SETTLE_MAX_S - 1e-9) return true;
  if (settled && !settled(world)) {
    clock.restTick = null;
    return false;
  }
  if (clock.restTick === null) clock.restTick = world.tick;
  return (world.tick - clock.restTick) * SIM_DT >= MATCH_SETTLE_HOLD_S - 1e-9;
}

/** is this velocity at or above `speed`? Squared, not `Math.hypot`: the sim may not use
 *  engine-defined Math (`npm test` greps for it), and a comparison needs no square root. */
export function movingFaster(v: { x: number; y: number }, speed: number): boolean {
  return v.x * v.x + v.y * v.y >= speed * speed;
}

/** every robot is at rest (see `ROBOT_REST_SPEED`) — a parked robot's pose is what BASE, PARK
 *  and ASCEND are assessed on, so a robot still coasting after the buzzer can change the score */
export function robotsAtRest(world: World): boolean {
  for (const r of world.robots) {
    if (movingFaster(r.vel, ROBOT_REST_SPEED)) return false;
    if (Math.abs(r.angVel) >= ROBOT_REST_TURN) return false;
  }
  return true;
}

/**
 * DECODE: nothing left that can score.
 *   · no artifact in FLIGHT (it can still enter a goal);
 *   · no rail artifact still PENDING (classified vs overflow is decided when it meets the stack)
 *     or still MOVING (it can still drain out, or reach a pattern slot);
 *   · every GROUND and BASIN artifact at rest (depot is a resting-position rule, and a basin
 *     artifact that is still moving can still board the rail);
 *   · every robot at rest (BASE).
 * An artifact held by a robot, in the human player's stock, or parked in an element scores
 * nothing further after the buzzer and is ignored.
 */
export function decodeSettled(world: World): boolean {
  for (const b of world.balls) {
    const s = b.state;
    if (s.kind === 'flight') return false;
    if (s.kind === 'rail' && (s.pending || Math.abs(s.v) >= BALL_REST_SPEED)) return false;
    if ((s.kind === 'ground' || s.kind === 'basin') && movingFaster(b.vel, BALL_REST_SPEED)) {
      return false;
    }
  }
  return robotsAtRest(world);
}
