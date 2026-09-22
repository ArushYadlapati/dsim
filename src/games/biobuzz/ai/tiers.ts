/**
 * BIOBUZZ AI — THE TIER TABLE (Day 3, `docs/biobuzz/plan-3d.md` §6; rewritten 2026-09-22).
 *
 * Three difficulties, ONE policy. `policy.ts` is a single state machine and every tier runs the
 * same one; what a tier changes is a handful of numbers it reads out of here. That is deliberate
 * and it is the difference between "Easy is a worse driver" and "Easy is a different program" —
 * the second one is three policies to debug, three ways to desync, and three sets of behaviour
 * a smoke lane has to pin. It also makes the Hard-beats-Easy claim mean something: the two are
 * the same driver with different hands.
 *
 * ⚠️ **NO TIER MAY READ ANYTHING A LOWER TIER CANNOT.** Difficulty is EXECUTION — how fast it
 * drives, how late it reacts, how carefully it picks a shot and a target — never information. A
 * Hard bot that read the opponent's hopper while Easy did not would be cheating at a game the
 * player cannot see into either, and "the AI knows things" is the complaint that kills a
 * practice mode. The policy reads exactly one set of fields for every tier (see `policy.ts`).
 *
 * ⚠️ **AND NO TIER IS ALLOWED TO BE BROKEN.** Every tier gets the same stuck detection, the same
 * reachability test, the same pin back-off and the same G402 discipline — a weak driver is slow,
 * late and sloppy, not wedged in a corner for a minute. The first tier table made Easy weak by
 * making it idle (113 s of a 150-s match standing still, measured by `scripts/aibench.ts`), which
 * is a bot nobody learns anything from.
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
   * Chance, per decision, that the bot SKIPS this decision and holds what it was already doing —
   * a slow driver keeps doing the last thing a beat too long. Drawn from the bot's OWN chain.
   * Never applied to a safety manoeuvre (an escape or a pin back-off already in progress).
   */
  hesitate: number;
  /** REACTION DELAY, in decisions: how long a change of plan (collect → score → park, a new
   * target) takes to be acted on. The honest version of "reacts late" — the bot keeps working
   * the old plan while it notices. */
  react: number;
  /** ceiling on every translation command, as a fraction of full stick */
  speedCap: number;
  /** how close to its wanted heading (rad) the bot calls itself lined up */
  aimTol: number;
  /**
   * THE SHOT DISCIPLINE — how far outside the measured firing envelope (`tuning.ts`) the bot
   * will still take a shot. `envAng` is the half-angle off the cell's mouth normal it stands
   * inside (rad); `envPad` widens the distance band on both ends (in). A sloppy driver shoots
   * from the side and from too close, and misses; that is the aim error the tiers differ by —
   * the turret aims itself in every tier, so where the bot SHOOTS FROM is the only aim a bot has.
   */
  envAng: number;
  envPad: number;
  /** does a turret keep firing while it drives (across the line to the cell or away from it)? */
  moveFire: boolean;
  /**
   * How many elements the bot collects before it goes to shoot, when nothing else sends it
   * sooner. A full hopper is the efficient answer (a volley per trip is the whole cycle); a
   * nervous driver goes with two and drives to the envelope twice as often.
   */
  volleyAt: number;
  /**
   * Does the bot COUNT toward the TIP — hold the elements a cell does not need, not fire into a
   * swing that will spill them, and walk to the far cell while the tray is still moving? A
   * driver who does not simply empties the hopper into whatever is up.
   */
  tipSense: boolean;
  /** TARGET CHOICE NOISE, in seconds of travel added to each candidate's cost at random — the
   * "worse choices" knob. 0 is the planner's own ranking. */
  choice: number;
  /** does the bot weigh where it will SHOOT FROM when it picks an element to collect? */
  lookahead: boolean;
  /**
   * Does the bot stay on its OWN HALF for the whole MATCH? Every tier stays home during AUTO
   * (G402). A cautious driver never stops.
   */
  homeOnly: boolean;
  /** does the bot PLACE NECTAR into a FLOWER once the 1:00 window opens (a Box Tube build)? */
  places: boolean;
  /** does the bot spend the alliance's NECTAR entries (`bbNectar`) at its own LOADING ZONE? */
  entersNectar: boolean;
  /** does the bot DEFEND — stand on the opponent's firing stand — when it has nothing of its
   * own to do? */
  defends: boolean;
  /** decisions collecting with the hopper not growing before the bot writes the element (and its
   * neighbours) off — the patience clock */
  patience: number;
  /** does the bot PARK in its LOADING ZONE at the end of the MATCH? */
  parks: boolean;
  /** …and at the end of AUTO (5 points, and LEAVE's 3 with it, for a few seconds' drive)? */
  autoPark: boolean;
  /** in a 2v2, does the bot leave its PARTNER's elements and stand to the partner, and take the
   * opposite side of the firing envelope? */
  coordinates: boolean;
}

/**
 * THE TABLE. Read it as a column per tier, and note what does NOT change across it: the decide
 * cadence (`BB_AI_DECIDE_TICKS`), the stuck test, the reachability test, the pin back-off, and
 * every geometric constant.
 */
export const BB_AI_TIER_SPECS: Readonly<Record<BbAiTier, BbAiTierSpec>> = {
  easy: {
    hesitate: 0.35,
    react: 8,
    speedCap: 0.42,
    aimTol: 0.3,
    envAng: 1.1,
    envPad: 10,
    moveFire: false,
    volleyAt: 2,
    tipSense: false,
    choice: 3,
    lookahead: false,
    homeOnly: false,
    places: false,
    entersNectar: false,
    defends: false,
    patience: 150,
    parks: false,
    autoPark: false,
    coordinates: false,
  },
  medium: {
    hesitate: 0.15,
    react: 3,
    speedCap: 0.62,
    aimTol: 0.18,
    envAng: 0.8,
    envPad: 5,
    moveFire: true,
    volleyAt: 3,
    tipSense: true,
    choice: 1.2,
    lookahead: false,
    homeOnly: false,
    places: true,
    entersNectar: true,
    defends: false,
    patience: 90,
    parks: true,
    autoPark: false,
    coordinates: true,
  },
  hard: {
    hesitate: 0,
    react: 0,
    speedCap: 0.95,
    aimTol: 0.1,
    envAng: 0.52,
    envPad: 0,
    moveFire: true,
    volleyAt: 4,
    tipSense: true,
    choice: 0,
    lookahead: true,
    homeOnly: false,
    places: true,
    entersNectar: true,
    defends: true,
    patience: 60,
    parks: true,
    autoPark: true,
    coordinates: true,
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
