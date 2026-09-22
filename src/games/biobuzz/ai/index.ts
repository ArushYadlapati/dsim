import type { Alliance, RobotSpec, World } from '../../../types';
import type { BotDriver, BotSeat } from '../../types';
import { createBiobuzzBot } from './policy';
import { BB_AI_DEFAULT_TIER, BB_AI_TIERS, bbCoerceTier } from './tiers';
import { bbBotBuild } from './builds';

/**
 * BIOBUZZ AI — the `GameSimModule.bot` registration (Day 3, `docs/biobuzz/plan-3d.md` §6).
 *
 * The whole public surface of `ai/`: three tiers, a coercer, and a factory. `policy.ts` is the
 * state machine and `tiers.ts` is its hands; neither is exported to the rest of the repo, so a
 * caller cannot reach past the seam and drive half a bot.
 *
 * ── WHO MAY SEAT ONE, AND WHAT IT COSTS A ROOM ──────────────────────────────
 * Plan §6: bots fill empty seats in SOLO PRACTICE, in CUSTOM LOBBIES and in LAN rooms. **Never a
 * matchmade room**, and **a room with a bot seat is UNRATED** — which is not a policy about
 * fairness so much as about what a rating means: Glicko-2 is a model of a population of human
 * drivers, and a scripted opponent is a fixed-strength constant that would drag every rating it
 * touched toward itself. The gate belongs to whoever creates the room (Lane C), not here; this
 * module only supplies the driver.
 *
 * ── THE DRIVING CONTRACT, IN ONE PARAGRAPH ──────────────────────────────────
 * The caller creates one `BotSeat` per bot per match, calls `seat.step(world)` ONCE per tick
 * BEFORE `biobuzzStep`, puts the returned command into the command map under that robot's id,
 * and RECORDS it exactly as it records a human's — the replay recorder writes every setup's
 * command per tick, so a replay of a match with a bot in it re-simulates with no bot at all. The
 * command is already quantized, so it can be recorded and broadcast unchanged. When the match
 * ends the caller calls `seat.dispose?.()`.
 */

export { BB_AI_TIERS, BB_AI_DEFAULT_TIER, bbCoerceTier } from './tiers';
export type { BbAiTier, BbAiTierSpec } from './tiers';
export { createBiobuzzBot } from './policy';
export { BB_BOT_BUILD_KEYS, bbBotBuild, bbBotBuildByKey } from './builds';

export const BIOBUZZ_BOT: BotDriver = {
  tiers: BB_AI_TIERS,
  defaultTier: BB_AI_DEFAULT_TIER,
  coerceTier: bbCoerceTier,
  create(world: World, robotId: number, tier: string, seed: number): BotSeat {
    return createBiobuzzBot(world, robotId, tier, seed);
  },
  // THE ROBOT: a roster build per seat, deterministic in (seed, robotId) — see `builds.ts`.
  build(opts: { seed: number; robotId: number; tier: string; alliance: Alliance }): RobotSpec {
    return bbBotBuild({ ...opts, tier: bbCoerceTier(opts.tier) });
  },
  // `drive` is DELIBERATELY ABSENT — see `BotDriver`'s header. A policy with hysteresis cannot
  // answer a memoryless one-shot with the same behaviour `create` produces, and a server calling
  // one while a client predicted with the other would disagree about what the bot did.
};
