/**
 * BIOBUZZ AI — THE TIER TABLE (Day 3, `docs/biobuzz/plan-3d.md` §6).
 *
 * Three difficulties, ONE policy. `policy.ts` is a single state machine and every tier runs the
 * same one; what a tier changes is a handful of numbers it reads out of here. That is deliberate
 * and it is the difference between "Easy is a worse driver" and "Easy is a different program" —
 * the second one is three policies to debug, three ways to desync, and three sets of behaviour
 * a smoke lane has to pin. It also makes the Hard-beats-Easy claim mean something: the two are
 * the same driver with different hands.
 *
 * ⚠️ **NO TIER MAY READ ANYTHING A LOWER TIER CANNOT.** Difficulty is EXECUTION — how fast it
 * drives, how long it dithers, how strict it is about taking a shot — never information. A Hard
 * bot that read the opponent's hopper while Easy did not would be cheating at a game the player
 * cannot see into either, and "the AI knows things" is the complaint that kills a practice mode.
 * The policy reads exactly one set of fields for every tier (see `policy.ts`'s header).
 *
 * The strings are OPAQUE to the seam (`BotDriver.tiers` is `readonly string[]`), so a fourth
 * tier is a row here and a label in the UI — no shared type edit.
 */

/** the tier ids, in difficulty order. `BotDriver.tiers` is this list. */
export const BB_AI_TIERS = ['easy', 'medium', 'hard'] as const;
export type BbAiTier = (typeof BB_AI_TIERS)[number];

/** what a UI preselects, and what an absent or unknown wire value folds to. MEDIUM rather than
 * EASY: a practice opponent that cannot reach the HIVE teaches nothing, and a player who wants
 * one can pick it. */
export const BB_AI_DEFAULT_TIER: BbAiTier = 'medium';

/**
 * ONE TIER'S HANDS. Every field is a number or a flag the policy multiplies or branches on;
 * none of them is a different code path.
 */
export interface BbAiTierSpec {
  /**
   * Chance, per decision, that the bot SKIPS this decision and holds what it was already doing.
   *
   * This is the reaction model, and it is a hold rather than a delay queue because a hold is
   * what a slow driver actually looks like: they keep doing the last thing a beat too long.
   * A queue would make the bot react late to everything equally, including to things it never
   * had to react to. Drawn from the bot's OWN chain, never the world's.
   */
  hesitate: number;
  /** ceiling on every translation command, as a fraction of full stick. The single biggest
   * difference between the tiers: an EASY bot crosses the field in most of two seconds longer,
   * which is two fewer volleys in a MATCH. */
  speedCap: number;
  /** how close to its wanted heading (rad) the bot calls itself lined up. A DUMPER cannot score
   * at all until it is inside `BB_AIM_TOL` (0.14), so a loose tolerance here is a bot that
   * squeezes the trigger early and waits for the sim to refuse it. */
  aimTol: number;
  /**
   * Does the bot require the SHARED SHOT VERDICT before holding fire?
   *
   * `true` — it runs `bbFlightEnters` over the release it would actually make and holds fire
   * only when the arc lands, which is what a good driver's eye does. `false` — it holds fire
   * whenever it is roughly pointed and roughly in range, and lets `bbLaunch`'s own verdict
   * refuse it. Both are SAFE (the sim gates the release either way, so a loose bot wastes
   * nothing but time); the difference is that a loose bot stands at the wrong range holding a
   * trigger that will never fire, because nothing told it the arc was short.
   */
  strictVerdict: boolean;
  /**
   * Does the bot stay on its OWN HALF for the whole MATCH?
   *
   * Every tier stays home during AUTO (plan §6). A cautious driver never stops: they work the
   * half they started on, collect what is in front of them, and leave the middle alone. It costs
   * half the field's elements, which is the biggest single handicap available that is still a
   * HABIT rather than a disability — the bot is running the identical policy over a smaller set
   * of targets.
   */
  homeOnly: boolean;
  /** does the bot PLACE NECTAR into a FLOWER once the 1:00 window opens? */
  places: boolean;
  /** does the bot spend the alliance's NECTAR entries (`bbNectar`) at its own LOADING ZONE? */
  entersNectar: boolean;
  /** does the bot DEFEND — shadow the nearest opponent between them and their own up CELL —
   * when it has nothing of its own to do? */
  defends: boolean;
  /**
   * How many DECISIONS the bot spends trying to collect, with the HOPPER not growing, before it
   * writes the element it is going for (and its neighbours) off for `BB_AI_TARGET_COOLDOWN`.
   *
   * The single most EXPENSIVE habit a weak driver has, and the reason it is a tier knob rather
   * than one constant: some elements are unreachable, nothing a position read says which, and a
   * driver finds out by trying. A patient one keeps trying — for seconds, then tens of seconds,
   * while the field empties around them. It is execution, not information: every tier learns the
   * same thing the same way, they just take different amounts of a two-minute match to do it.
   */
  patience: number;
  /** does the bot PARK in its own LOADING ZONE, and with how many seconds of TELEOP left?
   * 0 ⇒ it never parks. PARK is 3 points and costs the last few seconds of collection, so the
   * tiers disagree about whether it is worth it and about how early to leave. */
  parkAtS: number;
}

/**
 * THE TABLE. Read it as a column per tier, and note what does NOT change across it: the decide
 * cadence (`BB_AI_DECIDE_TICKS`, one number for every tier — plan §6 fixes it at 6 so every
 * bot's recorded track compresses the same way) and every geometric constant in `config.ts`.
 */
export const BB_AI_TIER_SPECS: Readonly<Record<BbAiTier, BbAiTierSpec>> = {
  easy: {
    hesitate: 0.6,
    speedCap: 0.35,
    aimTol: 0.35,
    strictVerdict: false,
    homeOnly: false,
    places: false,
    entersNectar: false,
    defends: false,
    patience: 300,
    parkAtS: 0,
  },
  medium: {
    hesitate: 0.25,
    speedCap: 0.7,
    aimTol: 0.16,
    strictVerdict: true,
    homeOnly: false,
    places: true,
    entersNectar: true,
    defends: false,
    patience: 120,
    parkAtS: 6,
  },
  hard: {
    hesitate: 0,
    speedCap: 0.85,
    aimTol: 0.14,
    strictVerdict: true,
    homeOnly: false,
    places: true,
    entersNectar: true,
    defends: true,
    patience: 120,
    parkAtS: 8,
  },
};

/** force an untrusted tier (localStorage, the wire, a URL, a lobby row) onto the table. The
 * DOWNGRADE form, like `coerceGameId`: an unknown value becomes the default rather than an
 * error, because a bot seat with a typo'd tier must still play. */
export function bbCoerceTier(x: unknown): BbAiTier {
  return typeof x === 'string' && (BB_AI_TIERS as readonly string[]).includes(x)
    ? (x as BbAiTier)
    : BB_AI_DEFAULT_TIER;
}

/** the hands for a tier, coercing on the way in so no caller can hand the policy a hole. */
export function bbTierSpec(tier: string): BbAiTierSpec {
  return BB_AI_TIER_SPECS[bbCoerceTier(tier)];
}
