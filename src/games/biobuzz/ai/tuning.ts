/**
 * BIOBUZZ AI — THE POLICY'S OWN MEASURED HABITS (2026-09-22 rewrite).
 *
 * `config.ts`'s `BB_AI_*` block still carries the constants the first policy was tuned with and
 * this one keeps reading (the decide cadence, the arrival radii, the wall band). What is HERE is
 * what the rewrite added, and every number is a MEASUREMENT from `scripts/aibench.ts` or one of
 * the probes it names, not a guess. None of it is a rule: nothing else in the sim reads these,
 * and changing one changes how well a bot plays and nothing else.
 *
 * Kept in `ai/` rather than `config.ts` because that file is the game's shared constant sheet
 * and several lanes edit it; a bot's habits are nobody's business but the bot's.
 */

/**
 * THE FIRING ENVELOPE — where a stationary launcher's shot actually lands in the 3D solve,
 * measured off a grid of stands around the up CELL (four POLLEN per stand, both sides of the
 * mouth normal, `hiveCellTarget`'s own geometry; distance from the robot centre to the cell
 * centre in plan, angle off the cell's mouth normal):
 *
 *   TURRET  d 30–48 at ≤ 30° off the normal: 100 %.  45°: 75 %.  60°: 25–50 %.  d ≤ 24: ≤ 50 %,
 *           and at 18 in nothing leaves at all (the verdict refuses it).
 *   DOUBLE  the same shape, 5–10 points lower at 30°.
 *   DUMPER  d 30–42 at ≤ 45°: 100 %.  d 24: 25–75 %.  past ~44 the throw is out of range.
 *
 * ⚠️ **THE SHARED VERDICT SAYS YES OVER A MUCH WIDER AREA THAN THIS.** `bbFlightEnters` is the 2D
 * ballistic model (plan footprint + inbound velocity), and a 3D shot from under 24 in or from the
 * side clips the cell's walls and the frame. The first policy fired whenever the verdict passed
 * and measured 56 % over 247 match shots — 5 of 79 from inside 24 in. The envelope is how a good
 * driver's eye stands in for the difference.
 */
export const BB_AI_TURRET_D: readonly [number, number] = [31, 49];
export const BB_AI_DUMP_D: readonly [number, number] = [30, 40];
/** how far off the mouth normal (rad) the TOP tier will stand. Lower tiers widen it. */
export const BB_AI_ENVELOPE_ANG = 0.52; // 30°

/**
 * SHOOTING ON THE MOVE — a turret's lead solve is honest for motion ACROSS the line to the cell
 * and AWAY from it, and not for motion TOWARD it. Measured (`scratch/moving.ts`, turret at 36/44
 * in, three stands): tangential at 13, 32, 46 and 65 in/s — 24/24 every time; driving away —
 * 24/24; driving IN at 16 in/s 16/18, at 40 in/s 0/6. A closing robot walks the release into
 * the too-close band during its own burst and flattens every arc by its own speed.
 */
export const BB_AI_MAX_CLOSING = 10;

/** decisions a bot must spend commanding real translation while barely moving before it calls
 * itself STUCK, and the displacement (in) over that window that counts as "barely". Measured on
 * the old policy's traces: a genuinely wedged chassis moves under 1 in per 0.5 s, a robot easing
 * onto a stand moves 3–8. */
export const BB_AI_STUCK_WINDOW = 6;
export const BB_AI_STUCK_MOVE = 2.5;
/** stick fraction below which a command is not "asking to move" for the stuck test */
export const BB_AI_STUCK_STICK = 0.12;
/** decisions an escape manoeuvre lasts */
export const BB_AI_ESCAPE_LEN = 5;

/** clearance (in) a planned pose keeps from the perimeter and every static, so a goal is never
 * a pose the solver refuses by a hair — which is what a bot pressed into a wall for ten seconds
 * looked like: a goal 0.4 in inside the wall, a command easing toward it forever. */
export const BB_AI_POSE_SLACK = 0.6;

/** the radius (in) around an element in which other candidates count toward its CLUSTER value */
export const BB_AI_CLUSTER_R = 20;

/** decisions a bot ignores a firing stand it got stuck trying to reach */
export const BB_AI_STAND_COOLDOWN = 40;

/** seconds of margin a parking bot leaves itself on top of its own travel estimate */
export const BB_AI_PARK_MARGIN = 1.6;

/** a robot is "in contact" with another when their footprint circles are within this (in) */
export const BB_AI_CONTACT = 1.5;

/** in AUTO a bot keeps its centre this far (in) inside its own half, on top of its own
 * half-diagonal, so no corner of it can cross the centre line (G402 bills a crossing). */
export const BB_AI_AUTO_MARGIN = 2;

/** below this many seconds left in the MATCH a bot stops collecting and fires what it has */
export const BB_AI_LAST_CALL_S = 4;
