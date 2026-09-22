import type { Alliance, Vec2 } from '../../types';
import {
  BB_HALF_Y,
  BB_HIVE_CELL_DY,
  BB_HIVE_CELL_LEN,
  BB_HIVE_X,
  bbLoadingZoneSpot,
  bbMirror,
} from './config';

/**
 * WHERE A PASS GOES — the preset table, and the one place that decides it.
 *
 * Owner, 2026-09-22: "Pass should be passing towards the other side of the goal at a specific
 * point. Where to pass should also be configurable using a map and there should be presets."
 *
 * ── WHY "THE OTHER SIDE" IS A REAL PLACE AND NOT A GUESS ────────────────────────────────────
 * An alliance's two robots start at OPPOSITE ENDS of the field. `BB_START_POSES` indices 0 and
 * 1 are the TOP (y ≥ 0) and BOTTOM (y < 0) roles a 2-robot alliance defaults to, and
 * `config.ts` says why in as many words: they are "123 in apart — opposite ends of the field —
 * so two robots of one alliance cannot reach each other at the buzzer, which is the whole
 * reason there are two."
 *
 * The HIVE sits between them: pivot at (±`BB_HIVE_X`, 0), its two cells at y = ±`BB_HIVE_CELL_DY`.
 * So a pass really is a throw PAST THE GOAL to the far end, and which end that is follows from
 * the thrower's own y — not from the partner's pose, which a driver cannot know (owner,
 * 2026-09-21: "in real life, you can't know where your opponent is accurately").
 *
 * ── THE FRAME ───────────────────────────────────────────────────────────────────────────────
 * ⚠️ **EVERY POINT HERE IS WRITTEN IN BLUE'S FRAME AND MIRRORED FOR RED, THROUGH `bbMirror`.**
 * The BIOBUZZ layout is POINT-symmetric (180° about the origin), NOT reflected — red's LOADING
 * ZONE is diagonally opposite blue's, not across from it. Negating x alone would put every red
 * preset in the wrong half of the field, which is the exact bug `bbMirror` exists to prevent.
 *
 * ── DETERMINISM ─────────────────────────────────────────────────────────────────────────────
 * Pure functions of `(alliance, from)`. No clock, no world read, no live hive tilt. The tilt is
 * deliberately NOT consulted: `up` flips as the see-saw tips, so a preset that tracked it would
 * move the aim point mid-match under a driver who had not touched anything.
 */

/** the ids a spec may carry. `custom` means "use `bbPassTarget`", set on the map. */
export const BB_PASS_PRESETS = ['pastGoal', 'farEnd', 'loadingZone', 'centre'] as const;
export type BbPassPreset = (typeof BB_PASS_PRESETS)[number];

/**
 * ⚠️ THE DEFAULT IS `pastGoal`, AND IT USED TO BE THE LOADING ZONE. That earlier choice was
 * defensible on its own terms — a named spot both drivers know — but it is not what the owner
 * asked for and it is not where a partner is: the loading zone is against the alliance's own
 * side wall, so an element thrown there arrives at speed and runs on down the wall (MEASURED in
 * 3D: delivered to 0.3 in, then rolled ~34 in into the corner).
 */
export const BB_PASS_PRESET_DEFAULT: BbPassPreset = 'pastGoal';

export function isBbPassPreset(v: unknown): v is BbPassPreset {
  return typeof v === 'string' && (BB_PASS_PRESETS as readonly string[]).includes(v);
}

/**
 * HOW FAR PAST THE CELL `pastGoal` SITS.
 *
 * ⚠️ IT MUST CLEAR THE CELL, OR THE "PASS" SCORES. A pass is a delivery and is asserted to put
 * nothing in a hive (`scripts/smoke-biobuzz/robot.ts`), so the point has to be outside the
 * cell's own footprint: the cell opening is centred at `BB_HIVE_CELL_DY` and runs
 * `BB_HIVE_CELL_LEN` along the bar, so its far lip is at `DY + LEN / 2`. The clearance beyond
 * that is a chassis width or so, enough that neither the element's own radius nor a settling
 * roll walks it back into the mouth.
 */
const PAST_GOAL_CLEAR = 14;
/** ...and how far OUTBOARD of the hive's axis, so the flight never crosses the structure. See
 *  the `pastGoal` case for the scatter this was measured from. */
const PAST_GOAL_OUT = 14;

/** blue-frame preset points. `from` is the THROWER's position, which only `pastGoal` and
 *  `farEnd` read — both of them to answer "which end is the other one". */
function bluePoint(preset: BbPassPreset, from: Vec2): Vec2 {
  /* THE SIGN OF THE FAR SIDE. `from.y >= 0` ⇒ the thrower is on the TOP half, so the other side
     is −y. A robot sitting exactly on y = 0 is astride the hive pivot and has no far side worth
     the name; it gets −y, which is arbitrary but stable, and never a NaN. */
  const far = from.y >= 0 ? -1 : 1;
  switch (preset) {
    case 'pastGoal':
      /* BESIDE THE HIVE, NOT ON ITS AXIS, and that is MEASURED rather than tidy. The first
         version put this at x = BB_HIVE_X — the hive's own line — and in 3D the three elements
         of a pass scattered to (68.9, -31.4), (35.0, -13.1) and (-11.6, -39.6): the flight from
         blue's TOP anchor crosses the hive, which is a real collider there, so the shot went
         THROUGH the goal instead of past it. 2D never showed it (1.0-6.6 in) because its flight
         is scripted and meets no structure.
         `PAST_GOAL_OUT` moves the point OUTBOARD — away from the field centre, onto the
         alliance's own half — so the arc stays on the near side of the hive the whole way. */
      return {
        x: BB_HIVE_X + PAST_GOAL_OUT,
        y: far * (BB_HIVE_CELL_DY + BB_HIVE_CELL_LEN / 2 + PAST_GOAL_CLEAR),
      };
    case 'farEnd':
      /* DEEP at the far end, where the partner's anchor actually is — `BB_START_POSES` puts the
         two roles at y = ±(BB_HALF_Y − 10.5) on x = 34 and 46. Kept a chassis clear of the wall
         for the same reason `bbLoadingZoneSpot` keeps a radius clear of it: a point ON the wall
         line asks the solver to eject whatever arrives. x = 40 splits the two anchors' x. */
      return { x: 40, y: far * (BB_HALF_Y - 24) };
    case 'loadingZone':
      // WHAT THE PASS USED TO DEFAULT TO, kept as a choice because it is a spot both drivers
      // know by name and a human player is standing at it.
      return bbLoadingZoneSpot('blue');
    case 'centre':
      /* THE MIDDLE, on the thrower's own half of the x axis. Not (0, 0): the two hives straddle
         the origin at x = ±12.75, so the centre of the field is between two structures. */
      return { x: BB_HIVE_X + 24, y: 0 };
  }
}

/** the preset's point for `alliance`, mirrored out of blue's frame when needed. */
export function bbPassPresetPoint(preset: BbPassPreset, alliance: Alliance, from: Vec2): Vec2 {
  /* MIRROR THE THROWER IN, NOT JUST THE ANSWER OUT. `pastGoal` and `farEnd` read `from.y` to
     pick a side, so a red robot has to be asked the question in blue's frame or it would be
     told the side of the field it is already on. Mirroring the result alone was the first
     version of this and it aimed red's passes at red's own end. */
  const local = alliance === 'red' ? bbMirror(from) : from;
  const p = bluePoint(preset, { x: local.x, y: local.y });
  return alliance === 'red' ? { x: bbMirror(p).x, y: bbMirror(p).y } : p;
}

/** a short label for the picker. Kept beside the geometry so a new preset cannot ship nameless
 *  — `npm test` asserts every id has one. */
export const BB_PASS_PRESET_LABEL: Record<BbPassPreset, string> = {
  pastGoal: 'Past the goal',
  farEnd: 'Far end',
  loadingZone: 'Loading zone',
  centre: 'Centre',
};

/** one line of help per preset, for the picker. Same rule as the labels. */
export const BB_PASS_PRESET_HINT: Record<BbPassPreset, string> = {
  pastGoal: 'Just past your hive, on the far side from wherever you are.',
  farEnd: 'Deep at the other end of the field, where your partner starts.',
  loadingZone: 'Your own loading zone, against the side wall.',
  centre: 'The middle of your half, clear of both hives.',
};
