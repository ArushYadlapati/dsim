/**
 * BIOBUZZ (FTC 2026–27) — field + element constants.
 *
 * ── WHERE THE NUMBERS COME FROM: THE V1 KICKOFF MANUAL ──────────────────────
 * `BIOBUZZ_Competition_Manual_V1` (2026-09-12, 173 pages) is the source, distilled in
 * `docs/biobuzz/manual-distilled.md` and `docs/biobuzz-reference.md`. Section 9 (ARENA) gives
 * the field, the HIVES, the FLOWERS and the zones; Section 10 the elements, match periods and
 * point values; Section 11 the game rules (G304 start, the fouls `penalties.ts` enforces);
 * Section 12 the robot:
 *  • R102 — STARTING CONFIGURATION is limited to an 18-inch CUBE.
 *  • R104 — there is NO ROBOT weight limit.
 *  • R105.A — once the match starts a ROBOT may expand, but must stay within an
 *    18 × 24 × 29 in (tall) sizing volume (`BB_PRISM` / `BB_PRISM_NARROW`).
 * Some shapes are still owner CAD or figure reads rather than printed dimensions (the FLOWER
 * foot, the LOADING ZONE tape edge), and every robot MECHANISM number is the sim's own model:
 * the manual constrains robots, it does not describe one.
 *
 * ── THE APPROX CONVENTION ───────────────────────────────────────────────────
 * Every constant whose value is NOT printed in the V1 manual carries an `APPROX` comment naming
 * what it was derived from. That is not decoration: someone greps `APPROX` in this file and
 * that grep IS the work list for the next manual revision or field test. A number without the
 * marker is a number the manual gave us.
 *
 * The FIELD is the safe part: every FTC field since 2007 has been a 12 ft × 12 ft (144") soft
 * tile field inside a perimeter wall, and R102/R104 are unchanged from DECODE. Origin at the
 * centre, +x = audience right, +y = away from the audience — the same frame DECODE and Chain
 * Reaction use, so the shared camera, drivetrain and Rapier solve need no per-game handling.
 *
 * ── TERMINOLOGY (see `docs/biobuzz-contract.md` §6) ─────────────────────────
 * The scoring element is a POLLEN. Not a ball, not a particle, not an artifact — those are
 * DECODE's and Chain Reaction's words, and the user-visible strings in this game say POLLEN.
 * Pollen ride `world.balls` as `Artifact`s because that is the shared transport the physics,
 * the snapshot and the wire already speak; the TYPE is shared, the NAME is not.
 *
 * Copied and owned from `games/chain/config.ts`. Everything catalyst / hook / accelerator /
 * ring-stand / beam / lab-area / ground-clearance specific is deleted rather than carried
 * over — a shell that ships CR's field furniture under BIOBUZZ names would be worse than an
 * empty field, because it would look finished.
 */

import type { Alliance, AssistConfig, RobotSpec, StartCat, Vec2 } from '../../types';
import { INTAKE_PRESETS, ROBOT_MAX_SIZE } from '../../config';
import { dcos, wrapAngle } from '../../math';
import { lengthLimits, massLimits, widthLimits } from '../../sim/drivetrain';
import {
  BB_DEFAULT_INTAKE_MOUNT,
  type BbIntakeMount,
  type BbScoreMode,
  MOUNT_DIR,
  bbIntakeMountOf,
} from './mounts';
// `mechs.ts` is a LEAF over `types` + `mounts`, so this import adds no cycle — the same reason
// `mounts.ts` itself is safe to import here.
import { bbLauncherOf, bbLiftOf } from './mechs';
// THE FIELD'S DIMENSIONS ARE GENERATED FROM THE CAD, NOT TYPED HERE (owner ruling, 2026-09-18:
// "the CAD is authoritative for dimensions"). `fieldDims.gen.ts` is written by `npm run
// field-cad` out of `public/models/biobuzz/field-measurements.json`, and its header states the
// derivation and the residual of every value. Nothing in it is hand-editable, and the SIM3D
// smoke lane re-renders it and diffs it so it cannot drift from the measurements.
//
// The CONSTANT NAMES below are unchanged — every caller still imports `BB_HALF_X`, `BB_FLOWERS`
// and the rest — and each one's comment now cites the CAD and keeps the manual figure it
// replaced, because the figure is the history of why the number used to be what it was.
import {
  FIELD_HALF,
  FLOWERS,
  FLOWER_D,
  FLOWER_FOOT,
  FLOWER_RETRIEVAL_Z,
  FLOWER_RING_D,
  FLOWER_RING_Z,
  GARDEN,
  HIVE,
  LZ,
  TAPE,
  TAPE_W,
  TILE_PITCH,
  TILE_SEAMS,
} from './fieldDims.gen';

/** millimetres → inches (the sim's world unit). The manual dimensions arrive in mm, so this
 * is the conversion every element constant is written THROUGH rather than pre-multiplied,
 * which keeps the manual's own number visible in the source. */
export const mm = (v: number): number => v / 25.4;

// ─────────────────────────────────────────────────────────────────────────────
// FIELD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * field half-extents (in) — the perimeter wall's INNER FACE, measured off FIRST's own field CAD.
 *
 * ⚠️ **NOT 72.** A "12 ft field" is the nominal description, not the dimension: the CAD's four
 * inner faces sit at ±70.674 (residual 0.000 — they are symmetric), so the clear span is 141.35
 * in, not 144. It follows from the tiles, which are `BB_TILE_PITCH` 23.528 in on centre and not
 * 24; six of them close on 141.17 and the perimeter closes on that plus its own clearance. The
 * manual never prints an interior span, so there is nothing here the CAD contradicts — the 144
 * was inherited from DECODE's `C.TILE`-based field and was wrong by 1.87 %.
 *
 * Owner ruling, 2026-09-18: "The CAD is authoritative for dimensions." See `fieldDims.gen.ts`.
 */
export const BB_HALF_X = FIELD_HALF;
export const BB_HALF_Y = FIELD_HALF;

/**
 * soft-tile pitch on centre (in) — CAD (`fieldDims.gen.ts`), and the reason the field is not 144
 * wide. BIOBUZZ draws its own grid from this and from `BB_TILE_SEAMS`; `C.TILE` (24) stays
 * DECODE's and Chain Reaction's, because their fields are still modelled on the nominal tile.
 *
 * The seams are NOT evenly spaced — a tile body is 24.312 in with its interlock tabs, and the
 * measured gaps run 23.176…23.986 — so anything DRAWING the grid uses `BB_TILE_SEAMS`, the seven
 * measured lines, and this constant is their mean, for the places that need one number.
 */
export const BB_TILE_PITCH = TILE_PITCH;
export const BB_TILE_SEAMS = TILE_SEAMS;

/** perimeter wall collider half-thickness (in). Deliberately far thicker than a real wall:
 * these cuboids sit entirely OUTSIDE the play area, and a thick static is what stops a fast
 * robot from tunnelling through a thin one in a single 1/60 s step. */
export const BB_WALL_T = 10;

/** camera fit margin (in) — breathing room around the field so the walls are not flush with
 * the viewport edge.
 *
 * WIDENED from 8 for the FLOWER SECTION: a flower's contents are drawn OUTSIDE the perimeter
 * beside it (`drawField.ts`), as a section of the column with the scoring band shaded. It
 * reaches 10.8 in out, and the tile ruler lives in the same band, so the margin has to clear
 * both or the readout is cropped by the viewport on the two walls that carry them.
 *
 * IT IS A FIXED COST, not a per-element one — the section is as wide for an empty FLOWER as
 * for a full one, because the drawing is the COLUMN and the elements are inside it. The row of
 * discs it replaced grew with the stack, which made this number a function of capacity and
 * therefore wrong every time the capacity moved. `bbFlowerSectionBox` measures the real extent
 * and the smoke lane checks it against this. */
export const BB_VIEW_MARGIN = 12;

/** the outer x half-extent the CAMERA must show. Equal to the wall: V1's ARENA (Section 9) puts
 * the HIVES, FLOWERS and zones all inside the perimeter, so BIOBUZZ has no structure protruding
 * outside it (CR's accelerators did, which is why the shared `bounds` carries a view extent
 * distinct from the collider extent at all). The FLOWER sections drawn beside the walls are a
 * READOUT, and `BB_VIEW_MARGIN` above is what clears them. */
export const BB_VIEW_HALF_X = BB_HALF_X;

// ─────────────────────────────────────────────────────────────────────────────
// ---- FIELD GEOMETRY (manual V1)
//
// Everything below comes off the Kickoff Competition Manual V1 (2026-09-12), distilled in
// `docs/biobuzz-reference.md` §2 with the figure number for each value. A constant whose
// value the manual PRINTS carries the section or figure it came from; a constant DERIVED
// from a drawing carries `// APPROX: <figure>` in exactly the words the reference tags it
// with, because `grep APPROX src/games/biobuzz/config.ts` is the 09-14 tape-measure list.
//
// THE LAYOUT IS POINT-SYMMETRIC (180° about the origin), NOT MIRRORED. Red's LOADING ZONE is
// at y > 0 on the left wall and its GARDEN is the audience-left corner; blue's are the
// diagonal opposites. See `bbMirror` under START ANCHORS. Reflecting this field in x instead
// of rotating it produces a layout that is internally consistent and wrong.
// ─────────────────────────────────────────────────────────────────────────────

/** an axis-aligned field region, in world inches. `x0 < x1` and `y0 < y1` always. */
export interface BbRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * LOADING ZONE — 11.57 wide × 22.69 deep against the side wall, bounded by tape and the wall,
 * tape included (§9.3, Fig 9-2 p65 / Fig 9-3 p66). The zone belongs to the alliance whose
 * ALLIANCE AREA it adjoins.
 *
 * CAD (`fieldDims.gen.ts`), no longer `APPROX`: the CAD carries the three real gaffer strips, so
 * the rectangle is the union of their outer faces with the WALL edge as the fourth side — the
 * wall-bounded edge carries no tape, which is why there are three strips and not four. The old
 * figure read (x −72…−61, y 24…48) is off by 1.33 at the wall, 1.90 at the inner edge and up to
 * 1.40 in y; all of it is the field-size finding, not a misread of the drawing.
 *
 * RED IS AT y > 0. That is the half of the field an x-mirror gets wrong.
 */
export const BB_LZ: Record<Alliance, BbRect> = { red: LZ.red, blue: LZ.blue };

/**
 * WHERE AN ELEMENT ENTERS THE FIELD FROM A HUMAN PLAYER'S HAND — the centre of `a`'s LOADING
 * ZONE, pulled `r` off the side wall the zone backs onto.
 *
 * ONE definition, because three callers need the same point and they must not drift: staging
 * puts a no-show robot's preloads there (§10.3.4), the human player enters NECTAR there all
 * match (G426/G427, `play.ts`), and the smoke lane asserts both. `r` is the entering element's
 * RADIUS: "contacting the wall" is a body touching it, which for a circle solved at its centre
 * means a centre one radius clear — put the centre ON the wall line and the solve's first job
 * is to eject it.
 */
export function bbLoadingZoneSpot(a: Alliance, r: number = BB_POLLEN_R): Vec2 {
  const z = BB_LZ[a];
  return { x: a === 'red' ? -BB_HALF_X + r : BB_HALF_X - r, y: (z.y0 + z.y1) / 2 };
}

/**
 * GARDEN — a ~23 × 2 in strip in the alliance's own corner, "defined by the outside edge of
 * tape", two 1-in tapes (§9.3, §10.5.3, Fig 9-2/9-3). Red's runs along the AUDIENCE wall from
 * the red corner; blue's along the REAR wall from the blue corner. Not protected (G411 note).
 */
export const BB_GARDEN: Record<Alliance, BbRect> = { red: GARDEN.red, blue: GARDEN.blue };

/**
 * THE TAPE STRIPS THEMSELVES — what a renderer draws, as opposed to the zone rectangles above.
 *
 * CAD (`fieldDims.gen.ts`): 16 parts, every one 1.000 in wide, and the layout is the rule the
 * owner stated and the CAD confirms part for part — **a zone edge that is a WALL carries no
 * tape**. A LOADING ZONE has three strips (two depth edges and the inner, field-side edge); a
 * GARDEN has two laid side by side, which IS the 2-in band, with nothing across its ends; the
 * ALLIANCE AREA has three, on the gym floor outside the perimeter, open on the field side.
 *
 * Outlining `BB_LZ`/`BB_GARDEN` instead — which both renderers used to do — paints tape onto the
 * wall and turns the garden's solid band into two thin lines with mat between them.
 */
export const BB_TAPE = TAPE;

/** tape width (in) — CAD: 1.000 in gaffer, and there is NO other width on this field. `BB_TAPE_2`
 * is gone: the GARDEN's "2-in strip" (§9.3) is two of these laid side by side, which `BB_TAPE`
 * carries as two rectangles. Red / electric-blue — the one thing on this field that is NOT a
 * theme token, because the tape colour is what tells a driver whose zone it is. */
export const BB_TAPE_1 = TAPE_W;

// ── HIVE STRUCTURE (§9.6, Figs 9-7…9-11, pp69–73) ────────────────────────────

/** pivot x of each HIVE (in): the pair is 25.5 in centre to centre (Fig 9-10), red at −x.
 * CAD (`fieldDims.gen.ts`) — the measured pivots are ±12.750 with a 0.000 residual, which
 * CONFIRMS Fig 9-10's spacing and the `APPROX` assumption that the pair is centred on the
 * field. No longer approximate. */
export const BB_HIVE_X = HIVE.PIVOT_X;

/**
 * the BAR's tilt off level at either stable end (degrees) — the ±30° of a bi-stable see-saw
 * (§9.6, Figs 9-7…9-11; `docs/biobuzz-reference.md` §2.2). CAD-CONFIRMED to 0.000°: un-tilting
 * the tray by exactly this angle collapses the 0.020-in back skin to its own thickness, and by
 * any other angle spreads it over inches (audit §4.1). That is the one measurement that proves
 * the whole tray export is in the frame it claims to be.
 *
 * It is already baked into every PLAN length below as a cos 30° — `BB_HIVE_CELL_DY`,
 * `BB_HIVE_CELL_LEN` and `BB_HIVE_LEN` are the projected numbers, not the true ones. The
 * constant exists so the SWING can be drawn: mid-tip the bar passes LEVEL, where the
 * foreshortening is 1 and the assembly reaches its true length, and a renderer animating that
 * needs the angle the projection came from rather than a second copy of 30 typed into it.
 */
export const BB_HIVE_TILT_DEG = HIVE.TILT_DEG;

/** the plan projection at the rest tilt — every PLAN length below is a true CAD length times
 * this. Written once so the three of them cannot drift apart.
 *
 * `dcos`, not `Math.cos`: this value is baked into staged element positions and into the hive
 * footprint the scorer reads, so it is sim state, and `scripts/smoke.ts`'s source guard bans
 * engine-defined trig anywhere under `src/games` for exactly that reason. */
const HIVE_PROJ = dcos((HIVE.TILT_DEG * Math.PI) / 180);

/** horizontal projection (in) of a CELL centre from its pivot, along the HIVE axis (y) —
 * `HIVE.ARM` (15.519) · cos 30°. CAD (`fieldDims.gen.ts`); the earlier owner-CAD read was
 * 15.44 · cos 30° = 13.37, 0.07 in short. */
export const BB_HIVE_CELL_DY = HIVE.ARM * HIVE_PROJ;

/** a CELL's depth along the HIVE axis IN PLAN (in) — `HIVE.CELL_D` (11.750) projected. CAD; the
 * earlier read was 12.04 true → 10.43 in plan, 0.25 in long. */
export const BB_HIVE_CELL_LEN = HIVE.CELL_D * HIVE_PROJ;

/** the up-CELL opening's bottom and top above the tiles (in). This is the window a LAUNCH has to
 * arrive through, and what `releasePollen` solves its arc against.
 *
 * CAD (`fieldDims.gen.ts`), measured at the mouth face of whichever cell is UP at rest. Fig 9-10
 * prints [53.5, 65.6] and the CAD says [53.375, 65.497] — agreement to 0.13 in, so this one is a
 * CONFIRMATION of the figure rather than a correction of it. (The "[47.05, 68.85]" once logged as
 * an open finding was a collider-export bug, audit §4.4, and is long closed.) */
export const BB_HIVE_OPEN_Z: readonly [number, number] = HIVE.OPEN_Z;

/**
 * bottom of the DOWN hive above the tiles (in). The space under the structure is drivable, which
 * G409 assumes; the 2D sim simply puts no collider there.
 *
 * ⚠️ **CAD 31.981, NOT Fig 9-10's 25.5** — the one place the CAD and the manual genuinely
 * disagree, and the owner ruled on 2026-09-18 that the CAD wins. It is not a measurement error on
 * either side: ONE RIGID BAR at 30° cannot put the up cell's mouth at 53.4 and the down cell's
 * floor at 25.5 at the same time on this tray's own dimensions, and the CAD's up-cell opening
 * matches the manual to 0.13 in, so the figure that has to give is this one. The lowest hive
 * structure of ANY kind at rest is the Goal Rib's lower corner at 30.652, so a 29-in robot — the
 * legal maximum — still clears the whole assembly, which is what G409 actually needs.
 */
export const BB_HIVE_BOTTOM_Z = HIVE.DOWN_FLOOR_Z;

/** the lowest point of the hive assembly at rest (in) — CAD, the down-mouth Goal Rib's own lower
 * corner, which is below the down CELL's floor. The real headroom under a hive, and the number
 * that says a legal 29-in robot drives under it. */
export const BB_HIVE_LOWEST_Z = HIVE.LOWEST_Z;

/** the up-CELL's ACCEPT FOOTPRINT (in): `w` across the HIVE, `d` along it.
 *
 * MEASURED (reference §2.2). The 20-in opening WIDTH is perpendicular to the tilt axis, so it
 * is NOT foreshortened; the DEPTH is, and is `BB_HIVE_CELL_LEN` — the same 10.43 the cell is
 * drawn at, because the launch window and the cell footprint are the same rectangle. */
export const BB_CELL_OPEN = { w: HIVE.CELL_W, d: BB_HIVE_CELL_LEN };

/**
 * the CELL assembly end to end IN PLAN, along y (in) — 42.91 true · cos 30°. MEASURED
 * (reference §2.2).
 *
 * BOTH ENDS FORESHORTEN. The two CELLS ride ONE RIGID BAR at 30°, so a top-down view projects
 * the whole assembly by the same cosine and only `z` separates the up cell from the down one.
 * Drawing the up cell at full length and the down cell short says the bar bends, and it makes
 * the hive 42.91 long in a view where nothing on it is.
 */
export const BB_HIVE_LEN = HIVE.LEN * HIVE_PROJ;

/** the CELL assembly across, along x (in) — the opening width, which is PERPENDICULAR to the
 * tilt axis and so is not foreshortened. CAD 20.141 (`HIVE.CELL_W`, the mean of the four measured
 * cells); the manual's round 20 was within 0.15. */
export const BB_HIVE_W = HIVE.CELL_W;

/**
 * frame BASE BAR, inner and outer x (in) — MEASURED (owner CAD, 2026-09-12; reference §2.2):
 * bent sheet metal, effective 1 in thick, with its INNER edge ON the ±24 tile seam and the
 * other edge 1 in OUTWARD. So a bar occupies x ∈ [24, 25] and x ∈ [−25, −24].
 *
 * Two edges rather than a centre and a thickness because the edge on the seam is the measured
 * fact: a centre-plus-width pair rounds the seam away, and the seam is what a driver lines up
 * against. The COLLIDER is `colliders.ts` (biobuzz-field-staging); these are the numbers it
 * and the drawing share.
 */
export const BB_FRAME_BAR_IN = 24;
export const BB_FRAME_BAR_OUT = 25;

/** frame foot half-extent along y (in) — MEASURED 19.4 (reference §2.2; Fig 9-8 prints a
 * 38.95-in frame depth and the CAD measures 38.80). */
export const BB_FRAME_Y = 19.4;

/**
 * APRILTAG ID GROUPS — four 36h11 tags on the bottom face of every CELL (§9.9, Figs 9-15…9-17,
 * pp74–77). Keyed by the CELL's side of the pivot: `north` is y > 0 (the REAR, opposite the
 * audience), `south` is y < 0 (the AUDIENCE side).
 *
 * Drawn on the field on purpose. A published tag id is the ONE thing that pins this layout to
 * the real one, so a still that prints them can be checked against the manual without opening
 * it — the mirror test in `docs/biobuzz-reference.md` §9.
 */
export const BB_HIVE_TAGS: Record<Alliance, { north: readonly number[]; south: readonly number[] }> = {
  red: { north: [30, 31, 32, 33], south: [34, 35, 36, 37] },
  blue: { north: [42, 43, 44, 45], south: [38, 39, 40, 41] },
};

/** which CELL faces UP at staging (§10.3.1, Fig 10-2 p83): each HIVE is tilted so the cell
 * that points at a FLOWER is DOWN, which puts red's south cell and blue's north cell up. */
export const BB_HIVE_UP_STAGED: Record<Alliance, 'north' | 'south'> = { red: 'south', blue: 'north' };

// ── FLOWERS (§9.7, Fig 9-12, pp72–73) ────────────────────────────────────────

/** stand-off of a FLOWER's ring centre from its WALL FACE (in). CAD (`fieldDims.gen.ts`):
 * `FIELD_HALF` minus the least-squares centre of the top ring's own bore, 2.629, over four
 * flowers with a 0.000 residual. The earlier owner-CAD read of 2.54 was within 0.09 — this
 * figure was never the problem; the WALL it is measured from was 1.33 in out. */
export const BB_FLOWER_D = FLOWER_D;

/**
 * The four FLOWERS, one per perimeter wall, on the tile seam one tile off centre.
 *
 * CAD (`fieldDims.gen.ts`): each position is the least-squares centre of that flower's own TOP
 * RING BORE — the hole an element is deposited through — re-expressed point-symmetrically as
 * `BB_FLOWER_D` off its wall face and `FLOWER_ALONG` (23.392) along it. `nearest` is the
 * alliance whose half of the wall it sits on, NOT ownership: a FLOWER is owned at run time by
 * whoever holds the top-most NECTAR (§10.5.2).
 *
 * THE ±24 WAS THE TILE SEAM, AND THE TILE SEAM MOVED. The earlier table put each flower on the
 * ±24.000 seam of a nominal 24-in tile. Real tiles are `BB_TILE_PITCH` 23.528 on centre, so that
 * seam is really at 23.392 — one tile's worth of accumulated pitch error — and the wall it is
 * measured from is at 70.674, not 72. Both deltas are the SAME finding, and together they are
 * the ~1.5 in the CAD audit reported for these four points.
 */
export const BB_FLOWERS: readonly {
  id: string;
  wall: 'left' | 'rear' | 'right' | 'audience';
  x: number;
  y: number;
  nearest: Alliance;
}[] = FLOWERS;

/**
 * WHICH WAY A FLOWER'S MOUTH FACES — out of the wall it stands against, into the field.
 *
 * The FLOWER is a column on the perimeter, so its open top is reachable from one half-space
 * only: the field side. The wall side is the wall.
 *
 * IT LIVES IN `config.ts`, BESIDE `BB_FLOWERS`, because it is a property of that table: given
 * a wall, the inward normal is fixed geometry and nothing about it is a rule or a drawing. It
 * sat in `elements.ts` while its only readers were that file and `drawField.ts`; `start.ts`
 * became a third (G304.D measures the keep-out along this normal) and `elements.ts` in turn
 * needs `start.ts` for `evalStart`, which would have closed a two-file import cycle for the
 * sake of a four-entry map. Moving the map breaks the cycle without duplicating anything.
 */
export const FLOWER_MOUTH: Record<(typeof BB_FLOWERS)[number]['wall'], Vec2> = {
  left: { x: 1, y: 0 }, // F1 stands on −x, opens toward +x
  rear: { x: 0, y: -1 }, // F2 stands on +y, opens toward −y
  right: { x: -1, y: 0 }, // F3 stands on +x, opens toward −x
  audience: { x: 0, y: 1 }, // F4 stands on −y, opens toward +y
};

/**
 * ── THE FLOWER TUBE, BOTTOM TO TOP — five CAD bands, no APPROX left ─────────────────────────
 *
 *   `BB_FLOWER_LOW_Z`   0.354   the LOWER plate's top face: the column's floor
 *   the RETRIEVAL OPENING          0.354 → 3.904, 3.550 in of clear gap on the field side
 *   `BB_FLOWER_MID_Z`   3.904   the MID plate's underside: where the scoring volume starts
 *   the SCORING VOLUME             3.904 → 21.404 (§10.5.2, "between the top and middle rings")
 *   `BB_FLOWER_TOP_Z`  21.404   the TOP plate's top face: the z a deposit arc solves for
 *
 * All four were hand-typed manual or APPROX figures until 2026-09-18 (Day 2 lane A):
 * `field-measurements.json` carried the flower's whole assembly extent (−0.649 … 22.654, which
 * tops out at the purple backstop) but never separated the three ring PLATES, so there was
 * nothing in the generated file to read. `convert.py` measures each plate's own band now.
 *
 * ⚠️ **THE 3.550-IN RETRIEVAL OPENING IS DERIVED, NOT MEASURED, AND IT LANDS ON FIG 9-12
 * EXACTLY.** Nothing in the STEP is the hole; it is `mid[0] − lower[1]`, and the manual prints
 * "3.55 in tall". Two independently measured plate bands reproducing a printed figure to three
 * decimals is the strongest evidence in this file that the flower export is in the right frame.
 */

/** top ring height above the tiles (in) — the TOP plate's own top face, CAD
 * (`fieldDims.gen.ts`, `FLOWER_RING_Z.top`, residual 0 over four flowers). Fig 9-12's 21.5 was
 * 0.096 high; the audit's §6 hand read of 20.254…21.404 is now the generated number. */
export const BB_FLOWER_TOP_Z = FLOWER_RING_Z.top[1];

/**
 * the MIDDLE plate's UNDERSIDE (in) — where the SCORING VOLUME starts, and, in the 2D pipeline's
 * stack model, where a NECTAR seats. CAD (`FLOWER_RING_Z.mid[0]`, residual 0).
 *
 * It was 3.98 `APPROX` in `flower.ts` (the retrieval opening 3.55 plus a 0.43 lower ring), and
 * the CAD says 3.904 — the same quantity, 0.076 lower, with the same meaning, so every outcome
 * the sorter ruling produces survives the move (checked: the capacities are still 8 POLLEN and
 * 5 NECTAR, and every Fig 10-5 case A–H reads the same).
 *
 * ⚠️ **THE CAD'S MIDDLE BORE DOES NOT SORT.** `BB_FLOWER_MID_HOLE` measures 3.896 and a NECTAR
 * is 3.6, so the real plate passes one — which the 2D pipeline's own sorter ruling (owner,
 * 2026-09-12: "a NECTAR cannot pass the middle ring and SEATS on it") says it does not. The
 * ruling is a GAMEPLAY decision and it stands for the 2D model; the 3D tube is real geometry and
 * does what the geometry does. See `BB_FLOWER_LOW_HOLE` for which ring actually sorts, and
 * `docs/biobuzz/field-cad-audit.md` §11 for the measurement and the consequence.
 */
export const BB_FLOWER_MID_Z = FLOWER_RING_Z.mid[0];

/** the LOWER plate's TOP FACE (in) — the column's floor in the 2D stack model. CAD
 * (`FLOWER_RING_Z.lower[1]`); it was 0.43 `APPROX`, a Fig 9-12 pixel read, 0.076 high. */
export const BB_FLOWER_LOW_Z = FLOWER_RING_Z.lower[1];

/** the RETRIEVAL OPENING's own z span (in) — the clear gap between the lower plate's top face
 * and the mid plate's underside, on the FIELD side (the wall side is the backstop extrusion).
 * 3.550 in tall, which is Fig 9-12's printed figure to three decimals. G418.B's bottom-pop and
 * the 3D intake sensor both read this band. */
export const BB_FLOWER_RETRIEVE_Z: readonly [number, number] = FLOWER_RETRIEVAL_Z;

/**
 * the MIDDLE and LOWER bore DIAMETERS (in) — CAD least-squares fits (`FLOWER_RING_D`), residual
 * 0 over four flowers, rms 0.052 / 0.038 on the fit itself.
 *
 * ⚠️ **THE SORTER IS THE LOWER RING, NOT THE MIDDLE ONE.** A 2.8-in POLLEN passes all three
 * bores; a 3.6-in NECTAR passes the top (4.171) and the middle (3.896) and is stopped by the
 * lower (3.222). So the manual's INTENT survives — "POLLEN out of the bottom and nothing else"
 * (G418), because a nectar clears neither the lower bore nor the 3.55-in retrieval opening — but
 * the ring that delivers it is the bottom one, and a nectar dropped into a real FLOWER falls to
 * the bottom of the tube rather than seating half way up it. Measured, not assumed, and NOT
 * fudged to match the 2D model: see `BB_FLOWER_MID_Z`.
 */
export const BB_FLOWER_MID_HOLE = FLOWER_RING_D.mid;
export const BB_FLOWER_LOW_HOLE = FLOWER_RING_D.lower;

/** the three PLATE bands themselves, re-exported so `sim3d/flowerTube.ts` and the FLOWER3D lane
 * read the geometry through `config.ts` like every other BIOBUZZ constant rather than reaching
 * into the generated module. The five named `BB_FLOWER_*_Z` constants above are the faces the
 * RULES care about; this is the raw pair per plate, which is what a COLLIDER needs. */
export { FLOWER_RING_Z };

/** top ring opening RADIUS (in) — CAD (`fieldDims.gen.ts`, `FLOWER_RING_D.top` 4.171 measured by
 * a least-squares circle fit to the plate's own inner cylindrical surface, rms 0.049). Fig 9-12's
 * round 4.0 was 0.17 under. A 2.8 POLLEN and a 3.6 NECTAR both pass it; only the POLLEN passes
 * the retrieval opening at the bottom (`FLOWER_RING_D.lower` 3.222, G418). */
export const BB_FLOWER_OPEN_R = FLOWER_RING_D.top / 2;

/**
 * the FLOWER's FOOTPRINT on the tiles (in) — `along` the wall by `deep` into the field, flush
 * against the wall face. MEASURED (owner CAD, 2026-09-12; reference §2.3).
 *
 * A RECTANGLE, NOT A DISC. The first pass read Fig 9-12's ring plate as an `APPROX` 2.6-in
 * circle; the solid a robot actually meets is a 6 × 4.9 box with the ring opening inside it,
 * BB_FLOWER_D off the wall. The difference matters at both ends — it is wider along the wall
 * than a 2.6 disc (a robot running the wall hits it sooner) and shallower into the field (it
 * protrudes 4.9, not 5.2, and its corners are square).
 *
 * ✅ GENERATED SINCE 2026-09-18 (Day 2 lane A): `FLOWER_FOOT` is the union of the three ring
 * PLATES' own footprints, 5.951 × 5.013, residual 0 over four flowers. It could not be read off
 * `flowers[].extent` — that carries the under-field bracket reaching BEHIND the wall plane and
 * the backstop above the top plate — which is why the hand-typed 6 × 4.9 survived this long. It
 * was within 0.05 along and 0.11 deep, so this is a confirmation with a small correction, not a
 * move.
 *
 * The COLLIDER is `colliders.ts` (biobuzz-field-staging); this is the number it and the
 * drawing share.
 */
export const BB_FLOWER_FOOT = FLOWER_FOOT;

/**
 * THE HIVE TIP TABLE. Indexed by the number of NECTAR in the up-CELL; the value is how many
 * POLLEN also have to be in it for the CELL to tip. A cell tips when
 * `pollen >= BB_TIP_POLLEN[Math.min(nectar, 5)]`.
 *
 * ── TWO ROWS ARE OFFICIAL — the 2026-2027 EVENT FIELD SETUP GUIDE, §12 Hive Calibration ──
 * The Competition Manual prints no load, but the field guide requires every HIVE to be
 * CALIBRATED (with ballast washers) to tip at "[8] Pollen + [0] Nectar" and "[3] Pollen + [3]
 * Nectar" (§12, V1.0 p26), and its §12.3 acceptance table makes both rows exact:
 *   · 0 NECTAR — with 6 in, a TOSSED-IN 7th must NOT tip; with 7 in, a tossed-in 8th MUST tip;
 *   · 3 NECTAR — with 1 in, a tossed-in 2nd must NOT tip; with 2 in, a tossed-in 3rd MUST tip.
 * ("Gently placed" is only "preferred" to tip.) A launched element is the tossed-in case, so
 * rows 0 and 3 below are the guide's thresholds exactly.
 *
 * Rows 1, 2, 4 and 5 are NOT in the guide: MEASURED on a real HIVE (owner, 2026-09-12), once.
 *
 * **IT IS A TABLE, NOT A MASS, AND NOTHING INTERPOLATES IT.** No single linear weighting fits
 * the measured rows: 1n+7p and 2n+6p together make a NECTAR worth one POLLEN, and 3n+3p then
 * contradicts that outright. A seesaw is torque and packing, not weight. The rows are monotone
 * (more of either element still tips), so the comparison above is the whole rule.
 *
 * The STAGED row is the one that decides how a match opens: a CELL is staged with 3 NECTAR
 * (§10.3.1), so the first TIP costs **3 POLLEN** and is reachable in AUTO.
 *
 * Index 0 used to be an `APPROX` extrapolation of the 7/6 trend; the field guide confirms 8
 * (2026-09-13), so no row is a guess any more. `docs/biobuzz/feedback/002-thresholds.md` §2
 * still asks for a second reading of the owner-measured rows; the smoke lane pins this array as
 * a literal so a re-measure has to come through it.
 *
 * See `docs/biobuzz-reference.md` §4.1.
 */
export const BB_TIP_POLLEN: readonly number[] = [8, 7, 6, 3, 1, 0];

/** seconds of TELEOP remaining at which NECTAR may legally enter a FLOWER (G410). Before this
 * cue it is a MAJOR per nectar to the opponent — and the element still scores (§10.5.2). */
export const BB_FLOWER_UNLOCK_S = 60;

// ── SCORING (§10.5, Table 10-2 p91; fouls Table 10-4 p92) ────────────────────

/**
 * The points table, verbatim from Table 10-2. Everything the sim awards reads a member of this
 * object rather than a literal, so a V2 revision to the table is one edit here.
 *
 * MAJOR IS 20, not DECODE's 15. A shared `awardFoul` that assumes 15 bills this game wrong —
 * see `docs/biobuzz/field-plan.md` §6 request 4.
 */
export const BB_PTS = {
  /** no longer contacting the perimeter wall at the end of AUTO */
  leave: 3,
  /** at least partially in a LOADING ZONE, assessed at end of AUTO */
  parkAuto: 5,
  /** …and assessed again at the end of the MATCH */
  parkTele: 5,
  /** one HIVE TIP, whenever it completes (AUTO if it completes before TELEOP starts) */
  tip: 20,
  /** each element left in an upward-facing CELL, at rest after the match */
  cell: 2,
  /** bottom-most NECTAR of your colour in a FLOWER, per flower */
  bottomNectar: 5,
  /** each element in a FLOWER you OWN, whoever placed it */
  owned: 2,
  /** each element at least partially in a GARDEN, credited to the GARDEN's colour */
  garden: 1,
  /** Table 10-4 */
  foulMinor: 5,
  foulMajor: 20,
};

/** RANKING POINTS (Tables 10-2/10-3). These thresholds are the "all other events" set;
 * regionals and Championship are TBA in V1. SWARM at 16 is exactly both robots LEAVE and both
 * PARK in AUTO, which is why it is a threshold and not a checklist. */
export const BB_RP = {
  /** LEAVE + PARK points needed for the SWARM RP */
  swarm: 16,
  /** TIPS needed for POLLINATOR 1 */
  pollinator1: 4,
  /** TIPS needed for POLLINATOR 2 */
  pollinator2: 7,
  win: 3,
  tie: 1,
};

// ─────────────────────────────────────────────────────────────────────────────
// POLLEN — the scoring element
// ─────────────────────────────────────────────────────────────────────────────

/** POLLEN radius (in) — 2.8 in diameter, §9.8 (AndyMark am-5851). NOT approximate: the
 * Kickoff manual prints the size, and it retires the 1.5" pre-season guess this constant
 * carried while Section 9 was a placeholder page. */
export const BB_POLLEN_R = 1.4;

/** NECTAR radius (in) — 3.6 in diameter, §9.8 (am-5852). The second element size, and the
 * reason the shared solve grew a per-artifact radius: it is now SIMULATED at this value too,
 * not only drawn at it. Every site reads `b.r ?? radius` (field-plan §6 request 1, LANDED),
 * so a resting NECTAR sits 1.8 in off a wall instead of 1.4 and no longer puts 0.4 in of
 * itself outside the field. ⚠️ `bbRobotSolids` is the one holdout — it still builds every
 * held plug at its `radius` argument, so a CARRIED nectar collides as a POLLEN. */
export const BB_NECTAR_R = 1.8;

/** how many POLLEN are on the field at staging — §10.3.1: 16 in the four FLOWERS, 4 in each
 * GARDEN, 16 preloaded. Manual count, not a placeholder. */
export const BB_POLLEN_COUNT = 40;

/** NECTAR PER ALLIANCE — §9.8: 8 red + 8 blue. Of each alliance's 8, three are staged in its
 * up-CELL and five start in the ALLIANCE AREA as human-player stock (§10.3.1). */
export const BB_NECTAR_COUNT = 8;

/** how many POLLEN the shell scatters. APPROX: 60 is a placeholder chosen to LOOK like a
 * field worth driving on and to be cheap in the shared solve, not a manual count. It is also
 * deliberately far below CR's 300 so the shell's step cost has headroom for whatever Section
 * 10 actually asks for. */
export const BB_POLLEN_SIM = 60;

/**
 * GROUND POLLEN PHYSICS IS NOT CONFIGURED HERE, AND THERE IS NOTHING TO PUT BACK.
 *
 * A ground POLLEN is solved by the SHARED artifact solve (`solveArtifacts`), which BIOBUZZ
 * calls with `BB_POLLEN_R` and nothing else. Friction, restitution, rest speed, contact
 * stiffness and the speed cap are all the shared solve's constants in `src/config.ts`
 * (`PHYS_BALL_*`, `BALL_*`), they are the repo OWNER's to tune, and BIOBUZZ must not shadow
 * them — a second set of numbers describing the same contact is the same bug as a second
 * integrator. See `docs/biobuzz/feedback/000-solver-observations.md` for what the shared solve
 * does with a 1.5" element, and `play.ts`'s header for why it is the only one.
 *
 * Four constants used to live here (`BB_POLLEN_FRICTION`, `_REST_SPEED`, `_SEP_ITERS` and the
 * wall restitution), copied from CR's particle model for the bespoke arm that is now deleted.
 * Only the wall restitution survives, because FLIGHT pollen are still this game's own:
 */

/** how much of its speed a POLLEN keeps when a LOB hits a wall. FLIGHT ONLY — a ground pollen's
 * wall bounce is the shared solve's `BALL_WALL_RESTITUTION`. APPROX: a guess about a 3" foam
 * ball, and only a picture judges it (`launch-wall-bounce` in the gallery). */
export const BB_POLLEN_WALL_REST = 0.35;

// ─────────────────────────────────────────────────────────────────────────────
// MATCH — BIOBUZZ reuses the shared phase durations (`src/config.ts`): V1 §10.1/§10.4 give
// 30 s AUTO, an 8 s transition and 2:00 TELEOP, the same three numbers DECODE runs.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The ACT this season starts on: BIOBUZZ's records and ranked open at Act 1 · Season 1 (owner,
 * 2026-09-12). Acts are per game (`seasons` is keyed on game), so this need not differ from
 * DECODE's or Chain Reaction's. Read through the shared `initialAct` slot (`sim.ts`).
 */
export const BB_INITIAL_ACT = 1;

// ─────────────────────────────────────────────────────────────────────────────
// ROBOT — intake geometry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * INTAKE DESIGN. The only style in the shell is the SWEEPER — a full-width roller. Its MOUNT
 * (`RobotSpec.intakeMount`) picks which chassis edge(s) carry it: FRONT (default), BACK, both
 * SIDES, or FRONT+BACK.
 *
 * The geometry lives in `bbMouths` (robot.ts) — one rect per mounted edge, shared by the
 * capture logic AND both renderers, so THE DRAWN MOUTHS ARE THE CAPTURE AREAS. The same mount
 * drives `footprintExtents`, so it moves the COLLISION box with it. Open edges cost hopper
 * volume (`bbMountStoreMult`).
 *
 * `widthFrac`·chassis + `overhang` = the mouth half-width on an END edge (a flank mouth spans
 * the chassis length); `depth` = how far behind the edge it reaches, which is what lets the
 * roller catch a POLLEN before the frame would plow it.
 */
export interface BbIntakeGeom {
  widthFrac: number; // mouth half-width as a fraction of the chassis half-width
  overhang: number; // extra mouth half-width past the frame (deployed intake), inches
  depth: number; // mouth reaches this far BEHIND the edge (into the frame), inches
}
export const BB_INTAKE_STYLES = ['sweeper'] as const;
export type BbIntakeStyle = (typeof BB_INTAKE_STYLES)[number];
export const BB_INTAKES: Record<BbIntakeStyle, BbIntakeGeom> = {
  sweeper: { widthFrac: 1.0, overhang: 0, depth: 2.5 }, // full-width roller
};
export const BB_DEFAULT_INTAKE: BbIntakeStyle = 'sweeper';

// ─────────────────────────────────────────────────────────────────────────────
// ROBOT — launcher geometry (the four archetypes)
// ─────────────────────────────────────────────────────────────────────────────

export const BB_DEFAULT_SCORE_MODE: BbScoreMode = 'turret';

/** turret slew rate (rad/s). A turret does NOT snap to a heading — it swings at a finite rate,
 * which is why a turreted robot must spawn already pointed at its target rather than spending
 * the first second of auto rotating. APPROX: CR's tuned value, and turret hardware has not
 * changed. */
export const BB_TURRET_SLEW = 7;

/** heading error (rad) under which a TURNED robot counts as aimed, and the P-gain that turns
 * it. Only turretless archetypes use these: the fire button steers the chassis. APPROX. */
export const BB_AIM_TOL = 0.14;
export const BB_AIM_GAIN = 4.5;

/** fraction of the chassis width a turretless launcher's parallel launch LINE spans. Slightly
 * under 1 so the outermost POLLEN of a burst is not born exactly on the frame line. APPROX. */
export const BB_LAUNCH_LINE_FRAC = 0.92;

/** launch height (in) — how high off the tile a POLLEN leaves the mechanism.
 *
 * ⚠️ THIS IS A HEIGHT, AND IT WAS ALSO BEING USED AS A VERTICAL VELOCITY. Every launch path in
 * `robot.ts` used to pass it as the `z` of the velocity `Vec3` handed to `releasePollen`, as
 * well as `elements.ts` using it (correctly) as `held.z`. So every POLLEN left at 10 in/s
 * upward and apexed 0.13 in: there was effectively no arc in this game. The velocity use is
 * gone — a launch's vertical speed is now solved from the target's height (`bbSolveShot`) or
 * set by the hood angle — and this is a height and only a height. The name is left alone
 * because renaming it touches Lane A's `elements.ts`; that is a separate cross-lane change. */
export const BB_LAUNCH_Z0 = 10;

// ─────────────────────────────────────────────────────────────────────────────
// ROBOT — mechanism composition (launcher elevation, the lift)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE BOX TUBE'S PLACEMENT POINT — how far past the collision footprint, along the tube's mount
 * direction, the point a FLOWER must be near sits (in). APPROX.
 *
 * FLOWER scoring is a PROXIMITY action (owner ruling 2026-09-12), not a raise: there is no
 * carriage height and no travel. `bbPlacePointLocal` (`robot.ts`) is the one geometry, and it is
 * sized against the FLOWER solid (`BB_FLOWER_FOOT`, 4.9 deep, ring `BB_FLOWER_D` = 2.54 off the
 * wall): a chassis face flush on the flower is 4.9 − 2.54 = 2.36 in past the ring centre. The
 * reach is DERIVED as exactly that, so a robot pressed square against a FLOWER foot has its
 * placement point dead on the ring.
 */
export const BB_PLACE_REACH = BB_FLOWER_FOOT.deep - BB_FLOWER_D; // 2.36 — flush on the foot = dead centre
/** how close the placement point must be to a FLOWER ring centre to place (in). APPROX — the
 * slop of a real tube lining up on a 4.0-in ring; a placement should not need the pixel. */
export const BB_PLACE_TOL = 2.0;
/** how often a running intake pulls one POLLEN out of a FLOWER's retrieval opening (G418.B), in
 * seconds. APPROX — one element worked out from under the stack through a 3.55-in hole, not a
 * roller sweeping loose elements off the tiles, so it is slower than a ground pickup. */
export const BB_FLOWER_RETRIEVE_S = 0.35;
/** how far past its roller line an intake mouth can be from the FLOWER foot's field-side face and
 * still pull from the retrieval opening (in). APPROX — the contact slop of a compliant roller. */
export const BB_FLOWER_RETRIEVE_PAD = 1.0;
/** extra lb on the chassis mass FLOOR for carrying a Box Tube. APPROX. */
export const BB_LIFT_MASS_FLOOR = 2.0;

/**
 * A DUMPER'S RANGE (owner, 2026-09-13) — how far from the cell it is dumping into a dumper can
 * throw from, measured horizontally from each element's release point on the dumper's edge to
 * the cell centre (in). APPROX all three.
 *
 * A DUMP IS A LOB, NOT A FIXED-HOOD SHOT. Each element is thrown to peak `BB_DUMP_APEX_ABOVE`
 * over the cell's aim height and drop onto it (`bbLobThrow`, `robot.ts`), so it arrives
 * DESCENDING — which `hiveAccepts` requires — from any distance, and the minimum is geometry
 * alone: `BB_DUMP_MIN_DIST` is only the floor below which a throw has no direction. The fixed hood
 * this replaced made a dumper stand far off (23–71 in at the default 75°, since a flat-ish arc
 * only descends past its apex) and also reach far; the owner ruled both wrong, so the MAXIMUM is
 * a strict cap rather than whatever `BB_LAUNCH_SPEED_MAX` happens to allow (~108 in).
 */
export const BB_DUMP_MIN_DIST = 1;
export const BB_DUMP_MAX_DIST = 36;
export const BB_DUMP_APEX_ABOVE = 4;

/**
 * The hood elevation a DUMPER used to be built at, in DEGREES above level.
 *
 * ⚠️ NO LONGER READ BY THE SIM (owner, 2026-09-13). A dump is solved as a lob for its distance
 * (`BB_DUMP_MAX_DIST` above), so the builder offers no Hood dial and no label prints one. The
 * field stays on `BbLauncherSpec` and the coercer still clamps it to this range, so saved robots,
 * presets and replays keep round-tripping unchanged.
 */
export const BB_HOOD_DEFAULT_DEG = 75;
export const BB_HOOD_MIN_DEG = 70;
export const BB_HOOD_MAX_DEG = 85;

/** how long a DUMPER takes to re-arm after a dump (s). APPROX — a tray swinging back down. It is
 * what stops a held fire button re-dumping on every capture. */
export const BB_DUMP_RELOAD_S = 0.75;

/** the most elements one turret feed can release in a single tick — the burst bound on the
 * accumulated cadence clock (`bbLaunch`). With `BB_FIRE_INTERVAL` above a tick it is normally 1;
 * this only bounds a pathological catch-up. APPROX. */
export const BB_FIRE_BURST_MAX = 6;

/**
 * ⚠️ THE HOOD IS THE ONLY ANGLE IN THIS GAME MEASURED IN DEGREES, AND ONLY ON THE SPEC.
 *
 * The sim is radians throughout — `dsin`/`dcos`/`datan2` are DETERMINISTIC trig, not DEGREE
 * trig (the `d` has burned people), `BB_TURRET_SLEW` is rad/s and `BB_AIM_TOL` is rad. But a
 * hood angle is a number a player reads off a slider, and "35°" is what that player means;
 * Chain Reaction makes the same call for `catapultYaw` ("in DEGREES relative to chassis
 * forward"). So it is stored in degrees and converted HERE, once, at the boundary — never
 * passed to a trig function raw.
 */
export const BB_DEG = Math.PI / 180;

/** how fast a TURRET's pitch axis slews, in RADIANS per second (~92 deg/s). APPROX, and deliberately
 * slower than the yaw slew: elevation carries the barrel's weight where yaw turns a ring. The
 * HIVE's up-CELL is the only thing a turret aims at (launched elements never enter a FLOWER),
 * and the elevation that cell needs swings widely with range — a lob from beside the HIVE
 * against a flat shot from the far corner at a 53.5–65.6 in opening — so a turret that
 * re-elevated instantly would make close and far shots feel identical. Driving between them is
 * what the pitch axis exists to make cost something. */
export const BB_TURRET_PITCH_SLEW = 1.6;
/** the pitch envelope a turret can actually reach, in RADIANS — level to ~80 deg. A barrel
 * cannot depress below level (it would fire into the robot's own deck) and cannot go fully
 * vertical (the feed path is in the way). APPROX both ends. */
export const BB_TURRET_PITCH_MIN = 0;
export const BB_TURRET_PITCH_MAX = 80 * BB_DEG;

/**
 * EVERY LAUNCHER'S TOP SPEED (in/s) — a turret's flywheel ceiling AND a dumper's, and the reason
 * a launcher's range is a number rather than an infinity. (It was `BB_TURRET_SPEED_MAX` while
 * only a turret solved its speed; the dumper solves its own per shot now too, so it is shared.)
 *
 * A launcher solves its own arc (`bbTurretSolution`, `bbHoodSpeed`), so unless the speed is
 * bounded somewhere it reaches every opening on the field from everywhere and the pitch envelope
 * and the hood become decoration. A dump whose hood has no solution fires AT this cap.
 * SIZED SO IT IS NOT NORMALLY WHAT BITES: the longest legal shot at a HIVE is a robot in the
 * far corner (~66, 66) firing at the opposite up-CELL — d = 111.8 in, dh = 47.6 in above a
 * turret muzzle, which the minimum-speed solution takes at **255.5 in/s**. 260 clears that with
 * a little margin, so today the thing that makes a turret miss is the SLEW (aim is a physical
 * state) and not the range. A target further or higher than the HIVE would fall short, which is
 * a miss the driver can see and drive out of rather than a silent skip.
 *
 * APPROX, like every launcher number here — see the risks in `docs/biobuzz/plan-mechanisms.md`.
 */
export const BB_LAUNCH_SPEED_MAX = 260;

/** the muzzle speed a launcher fires at when there is NO target to solve against (in/s) — a
 * turret or dumper with nothing on its open side still fires, into nothing in particular.
 * APPROX: the old drum's tuned speed, kept as a neutral number. */
export const BB_LAUNCH_SPEED_DEFAULT = 175;

/** the launcher's plate channel, in inches — `GAP` is the clear width between the two plates
 * a POLLEN passes between, `OVERHANG` how far they reach past the flywheel. GAP is
 * `BB_POLLEN_R * 2` plus a working clearance, which is why it tracks the element size rather
 * than being an independent number. APPROX with the element. */
export const BB_LAUNCH_PLATE_GAP = BB_POLLEN_R * 2 + 0.3;
export const BB_LAUNCH_PLATE_OVERHANG = 1.2;
/** the mass floor a DOUBLE turret's second turret assembly adds (lb on the chassis mass FLOOR).
 * Its two turrets share one feed and one cadence clock (`BB_FIRE_INTERVAL`), so there is no
 * throughput bonus — the second turret is what lets it launch NECTAR, not a faster stream. */
export const BB_TWIN_MASS_FLOOR = 2.5;

/** shooter cadence (s between shots) — 13 elements/s, shared by both turrets of a double. The turret ACCUMULATES this
 * interval rather than re-anchoring to `world.time`, so the sub-tick remainder carries and
 * the long-run rate averages exactly 13/s instead of tick-quantizing to 12 or 15. APPROX. */
export const BB_FIRE_INTERVAL = 1 / 13;

// ─────────────────────────────────────────────────────────────────────────────
// ROBOT — chassis envelope
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The EXPANSION PRISM (in) a robot may grow into once the match starts — R105.A (V1, p122):
 * "at all times must remain within a 18 in. (45.70 cm) by 24 in. (61.0 cm) by 29 in. (73.65 cm)
 * tall sizing volume when fully expanded". Manual numbers, not a guess.
 *
 * TWO horizontal dimensions, and the rule does not say which chassis axis gets which: the
 * volume is oriented only in HEIGHT ("the 29 in. dimension is always the vertical height"). So
 * a robot may grow to 24 along ONE horizontal axis while staying within 18 along the other,
 * and it may pick either. `BB_PRISM` is the long side, `BB_PRISM_NARROW` the short one.
 * `BB_EXPANSION` is what the long side leaves past R102's 18" starting cube.
 */
export const BB_PRISM = 24;
export const BB_PRISM_NARROW = 18;
export const BB_EXPANSION = BB_PRISM - ROBOT_MAX_SIZE; // 6" past the starting cube

/**
 * Chassis size range (in), BOTH axes — the range BIOBUZZ itself wants.
 *
 * The CEILING is R102's 18" starting cube less a working inch for the bumper and frame slop a
 * real build has. The FLOORS are DECODE's per-intake floors, because there is no BIOBUZZ rule
 * to argue a different one from: V1 sets robot size CEILINGS (R102, R105) and no minimum, and
 * its start rule (G304) is a set of pose clauses rather than a start zone a small chassis
 * would have to fill. All four are APPROX.
 */
export const BB_MIN_LENGTH = 13.5;
export const BB_MAX_LENGTH = 17;
export const BB_MIN_WIDTH = 14.5;
export const BB_MAX_WIDTH = 17;

/**
 * CHASSIS SIZE LIMITS, per build — the INTERSECTION of two envelopes.
 *
 * 1. WHAT BIOBUZZ WANTS. The SWEEPER DEPLOYS, so it does not have to fit inside R102's 18"
 *    starting cube alongside the chassis — that is what most real FTC intakes do. But it is
 *    real structure once deployed, so chassis + sweepers must fit R105.A's 18 × 24 EXPANSION
 *    prism, and which AXIS it eats depends on the mount, which is the whole point of having
 *    mounts:
 *      • front / back → one reach off the LENGTH
 *      • front+back   → TWO reaches off the LENGTH (a sweeper on each end)
 *      • side         → TWO reaches off the WIDTH (a sweeper on each flank)
 *    THE BOX TUBE COUNTS TOO. Its placement point (`bbPlacePointLocal`) sits `BB_PLACE_REACH`
 *    past the footprint along the tube's mount direction, and the tube is the structure that
 *    reaches it, so it occupies that much of the envelope: an END mount off the length, a
 *    FLANK mount off the width, and a CORNER mount its diagonal's component off BOTH. It used
 *    to be left out, which let the builder offer a maxed chassis whose tube poked past R105.
 *    NOT floored to the minimum on purpose: when the deployed sweepers leave nothing legal
 *    the max drops BELOW the min, and `bbMountFits` is what reports that combination as
 *    impossible. Flooring here would instead hand back a robot that overruns the prism.
 *
 *    ⚠️ R105 DOES NOT SAY WHICH AXIS IS THE 24, so there are two candidate rectangles — the
 *    LENGTH axis long, or the WIDTH axis long — and the legal set is their UNION, which is not
 *    a rectangle two independent sliders can describe. One is picked PER BUILD, from the
 *    fields that do not move under the sliders (intake, intake mount, tube mount, drivetrain):
 *    a rectangle whose MINIMUM chassis fits the prism beats one whose minimum does not, then
 *    the wider pair of ranges wins, and a tie goes to the length-long one. Choosing off the
 *    size itself would make the range move as the slider moves, and a coercer that could land
 *    in a different rectangle on its second pass would not be idempotent. The price is that a
 *    few chassis legal only in the OTHER rectangle are not offered, which is the safe
 *    direction. With no tube this is byte-identical to the old single-24 envelope: every
 *    non-sweeper axis is already capped at `BB_MAX_*` 17, under the narrow side's 18.
 *
 * 2. WHAT THE SHARED COERCER CURRENTLY ALLOWS. `coerceSpec` has a `game === 'chain'` arm that
 *    swaps in CR's size envelope, and no BIOBUZZ arm yet (Lane B owns adding one — see
 *    `docs/biobuzz-contract.md`, `src/sim/spawn.ts` row). Until it lands, a BIOBUZZ spec is
 *    sized by DECODE's per-intake `lengthLimits`/`widthLimits`, and a builder that offered a
 *    dial the chokepoint then clamped back would be a slider that visibly snaps.
 *
 * Intersecting means the builder never offers a size the coercer refuses, TODAY, and the
 * range simply widens to term 1 the moment term 2 stops binding. The intersection is also
 * what keeps `BB_PRESETS` a coercer no-op, which is what makes a preset card highlight as
 * selected — smoke asserts it.
 *
 * ⚠️ THE PRISM-DERIVED MAXIMUMS ARE FLOORED TO `BB_SIZE_STEP`. A corner Box Tube reaches
 * `BB_PLACE_REACH · √½` (1.669…) along each axis, so `18 − reach` is 16.331227996399747, and the
 * coercer clamped a chassis to exactly that, which the builder printed as a 15-digit width
 * (owner report, 2026-09-13). Flooring keeps the limit inside the prism, keeps coercion
 * idempotent, lands every clamped size on the slider's own grid, and re-coerces a robot already
 * saved with the long number onto it.
 */
export function bbSizeLimits(spec: RobotSpec): {
  minLength: number;
  maxLength: number;
  minWidth: number;
  maxWidth: number;
} {
  return bbEnvelope(spec).limits;
}

/**
 * How far past the CHASSIS box this build's deployed structure reaches along each chassis
 * axis, in total over both ends of that axis (in): sweepers plus the Box Tube. The one
 * description of "what R105 has to contain besides the frame", shared by `bbSizeLimits` and
 * the smoke lane, so the envelope and the check against it cannot measure different robots.
 */
export function bbEnvelopeReach(spec: RobotSpec): { length: number; width: number } {
  const reach = INTAKE_PRESETS[spec.intake].reach;
  const mount = bbIntakeMountOf(spec);
  const ends = mount === 'front' || mount === 'back' ? 1 : mount === 'frontback' ? 2 : 0;
  const flanks = mount === 'side' ? 2 : 0;
  const lift = bbLiftOf(spec);
  // `Math.abs` of the exact unit vector: 1 on the axis an edge mount points along, 0 on the
  // other, and SQRT1_2 on both for a corner, which is where a diagonal tube's tip actually is.
  const tube = lift ? MOUNT_DIR[lift.mount] : { x: 0, y: 0 };
  return {
    length: ends * reach + Math.abs(tube.x) * BB_PLACE_REACH,
    width: flanks * reach + Math.abs(tube.y) * BB_PLACE_REACH,
  };
}

/** the Frame sliders' step (in) — and the grid a size LIMIT derived from the prism is floored to
 * (`bbSizeLimits`), so a clamped chassis is never a 15-digit number. The builder reads this. */
export const BB_SIZE_STEP = 0.5;

/** `v` floored to `BB_SIZE_STEP`, with a hair of tolerance so a limit that is already on the
 * grid (17, 16.5) is not knocked a whole step down by float noise. */
function floorToSizeStep(v: number): number {
  return Math.floor(v / BB_SIZE_STEP + 1e-9) * BB_SIZE_STEP;
}

/** the resolved envelope: which rectangle of R105.A was picked (`lengthLong` — the 24 runs along
 * the chassis LENGTH), the slider limits inside it, and whether its minimum chassis fits the
 * prism at all. See `bbSizeLimits` for the rule. */
function bbEnvelope(spec: RobotSpec): {
  limits: { minLength: number; maxLength: number; minWidth: number; maxWidth: number };
  lengthLong: boolean;
  prismFits: boolean;
} {
  const ext = bbEnvelopeReach(spec);
  const shL = lengthLimits(spec.intake);
  const shW = widthLimits(spec.intake, spec.drivetrain);
  const minLength = Math.max(BB_MIN_LENGTH, shL.min);
  const minWidth = Math.max(BB_MIN_WIDTH, shW.min);
  const candidate = (lengthLong: boolean) => {
    const capL = lengthLong ? BB_PRISM : BB_PRISM_NARROW;
    const capW = lengthLong ? BB_PRISM_NARROW : BB_PRISM;
    const limits = {
      minLength,
      maxLength: Math.min(BB_MAX_LENGTH, floorToSizeStep(capL - ext.length), shL.max),
      minWidth,
      maxWidth: Math.min(BB_MAX_WIDTH, floorToSizeStep(capW - ext.width), shW.max),
    };
    // THE MINIMUM CHASSIS, not the max: the coercer widens an inverted range UP to the floor,
    // so the floor is the size a build actually gets when nothing else fits, and it has to be
    // inside the prism for the rectangle to be honest.
    const prismFits = minLength + ext.length <= capL + 1e-9 && minWidth + ext.width <= capW + 1e-9;
    const span = (Math.max(minLength, limits.maxLength) - minLength) + (Math.max(minWidth, limits.maxWidth) - minWidth);
    return { limits, lengthLong, prismFits, span };
  };
  const a = candidate(true);
  const b = candidate(false);
  const pick = a.prismFits !== b.prismFits ? (a.prismFits ? a : b) : b.span > a.span + 1e-9 ? b : a;
  return { limits: pick.limits, lengthLong: pick.lengthLong, prismFits: pick.prismFits };
}

/**
 * Can this intake preset be mounted this way at all, with this loadout?
 *
 * FALSE when the deployed sweepers plus the Box Tube leave no chassis inside R105.A's prism
 * (a front+back triangle sweeper with a tube on an end, for one), or when the size range is
 * empty. Kept, and kept CALLED, on purpose: it is the one place that answers "is this build
 * possible" for both the coercer and the builder's greying-out, and re-deriving that at two
 * call sites is exactly how the two drift apart.
 *
 * The coercer's fallback for a mount that does not fit is `front`, and `front` is always
 * PRISM-legal at the floor: the deepest sweeper (5) plus a full end tube (2.36) on the 13.5
 * floor is 20.9 of 24, and a flank tube on the widest floor (15.5) is 17.9 of 18.
 */
export function bbMountFits(spec: RobotSpec, mount: BbIntakeMount): boolean {
  const e = bbEnvelope({ ...spec, intakeMount: mount });
  const l = e.limits;
  return e.prismFits && l.maxLength >= l.minLength && l.maxWidth >= l.minWidth;
}

// ─────────────────────────────────────────────────────────────────────────────
// ROBOT — hopper capacity
// ─────────────────────────────────────────────────────────────────────────────

/** a floor of one POLLEN; NOT scaled with the rest. */
export const BB_STORAGE_MIN = 1;
/**
 * CEILING: **4 elements, POLLEN and NECTAR together. This is an OWNER RULING (2026-09-12), final.**
 *
 * In the manual, G407 ("A ROBOT may not CONTROL more than 4 SCORING ELEMENTS") is only a
 * WARNING: Table 10-4 gives it a VERBAL WARNING, with MAJOR + YELLOW only if STRATEGIC. The
 * sim caps the hopper at 4 anyway, so a robot cannot hold a fifth element. The owner's ruling
 * overrides the earlier request to lift this cap (Lane B relay 2, field-plan §4.3). The rules
 * lane's G407 warning (`penalties.ts`, `BB_CONTROL_LIMIT`) stays as written. It is a separate
 * number, and it still catches anything that reaches five without going through the hopper.
 *
 * The staging rule agrees from the other side: §10.3.1 pre-loads exactly 4 POLLEN per ROBOT,
 * so a legal robot starts FULL.
 *
 * ── THE VOLUME LAW IS KEPT UNDERNEATH ──────────────────────────────────────
 * `bbStorageMax` still runs the one-layer packing model (~12 in² of hopper floor per 3" POLLEN)
 * and the archetype/mount multipliers. They remain the honest description of the hardware. The
 * cap binds first for every chassis in the legal envelope, and the volume law stays written
 * down so it takes over again if the ruling ever changes. The number a robot may hold is the
 * SMALLER of what fits and what the ruling allows.
 *
 * ⚠️ CONSEQUENCE: the storage slider is a 1–4 dial and every archetype reaches the same
 * ceiling, so hopper size does not tell two builds apart. Cadence, range and cycle time do.
 */
export const BB_STORAGE_MAX = 4;
/** a legal robot starts FULL: §10.3.1 stages exactly 4 pre-loaded POLLEN per ROBOT. */
export const BB_STORAGE_DEFAULT = 4;

/** square inches of footprint per stored POLLEN — the derived cap's only size term, so it is
 * the single dial for storage across every archetype, mount and chassis size. APPROX: a
 * one-layer packing model, ~12 in² of hopper floor per 3" POLLEN. */
export const BB_STORE_AREA_PER_BALL = 12;
export const BB_STORE_TURRET_MULT = 0.55; // a turret loses centre volume to the rotor + shooter
export const BB_STORE_TWIN_MULT = 0.45; // a second shooter assembly eats even more of it
export const BB_STORE_LAUNCHER_MULT = 1.0; // dumper: open hopper
/** INTAKE MOUNT storage cost — every mounted edge is an OPENING the hopper cannot use.
 * front and back are mirror images (one open end), so a rear sweeper is a free stylistic
 * choice; two mounts cost real volume. SIDE is harshest, because the flanks run the full
 * chassis LENGTH — that is the price of collecting a stream you drive alongside. */
export const BB_STORE_SIDE_MULT = 0.6;
export const BB_STORE_FRONTBACK_MULT = 0.75;

/** the hopper-volume factor an intake mount costs (1 = no cost). */
export function bbMountStoreMult(mount: BbIntakeMount): number {
  if (mount === 'side') return BB_STORE_SIDE_MULT;
  if (mount === 'frontback') return BB_STORE_FRONTBACK_MULT;
  return 1; // front / back — a single open end, mirror images of each other
}

/** the MAX POLLEN this robot can hold — footprint × an archetype factor × the intake-mount
 * factor, clamped to [MIN, MAX].
 *
 * The volume law below describes the HARDWARE and `BB_STORAGE_MAX` is the owner's 4-element cap
 * (2026-09-12). For every chassis in the legal size envelope the volume answer is larger, so the
 * cap is what actually binds and this returns 4. See the note on `BB_STORAGE_MAX` for why both
 * layers are kept. */
export function bbStorageMax(spec: RobotSpec): number {
  const area = spec.length * spec.width;
  // Through the RESOLVER, not `spec.scoreMode`: the container is authoritative and the flat
  // field only mirrors it (a legacy `drum` reads as a dumper here too).
  const kind = bbLauncherOf(spec, BB_HOOD_DEFAULT_DEG).kind;
  const mult =
    (kind === 'turret'
      ? BB_STORE_TURRET_MULT
      : kind === 'twinturret'
        ? BB_STORE_TWIN_MULT
        : BB_STORE_LAUNCHER_MULT) * bbMountStoreMult(bbIntakeMountOf(spec));
  const cap = Math.round((area / BB_STORE_AREA_PER_BALL) * mult);
  return Math.max(BB_STORAGE_MIN, Math.min(BB_STORAGE_MAX, cap));
}

/**
 * The robot's ACTIVE hopper capacity: its chosen `ballStorage`, clamped to its
 * archetype+size max. Read by the sim (the intake cap), the renderer (how full to draw the
 * hopper) and the HUD, so all three agree on one number.
 *
 * It lives HERE rather than in `robot.ts` even though the contract lists it as a robot export,
 * because `elements.ts` needs the cap to know whether a capture fits and importing `robot.ts`
 * for it would make an elements↔robot cycle. `robot.ts` re-exports it under the contract name.
 */
export function bbHopperCap(spec: RobotSpec): number {
  const want = Math.round(spec.ballStorage ?? BB_STORAGE_DEFAULT);
  return Math.max(BB_STORAGE_MIN, Math.min(bbStorageMax(spec), want));
}

/** extra lb on the chassis MASS FLOOR from the BIOBUZZ scoring mechanism. Only the twin
 * turret carries one (a whole second flywheel assembly); every other archetype is already
 * priced into the base chassis. Threaded into `massLimits` by the coercer and by the
 * builder's mass slider, so the floor the UI offers is the floor the sim enforces. */
export function bbMassFloorBump(spec: RobotSpec): number {
  const launcher = bbLauncherOf(spec, BB_HOOD_DEFAULT_DEG);
  // A SECOND FLYWHEEL ASSEMBLY, and now A MAST — both are hardware bolted to the chassis, and
  // both were previously invisible to the mass model. `BB_LIFT_MASS_FLOOR` existed as a
  // constant with no reader, which is the same shape of bug `BB_TURRET_SLEW` was: a number
  // documenting an intention nothing implemented.
  //
  // Read through `bbLauncherOf` rather than off `spec.scoreMode`: the container is authoritative.
  const twin = launcher.kind === 'twinturret' ? BB_TWIN_MASS_FLOOR : 0;
  const lift = bbLiftOf(spec) ? BB_LIFT_MASS_FLOOR : 0;
  return twin + lift;
}

// ─────────────────────────────────────────────────────────────────────────────
// START ANCHORS
// ─────────────────────────────────────────────────────────────────────────────

export interface BbStartAnchor {
  /** the anchor's name in the CANONICAL (blue) frame — see `bbAnchorName` for what a player sees */
  name: string;
  /** which perimeter wall the robot backs onto, in the canonical frame */
  wall: 'rear' | 'audience' | 'side';
  pos: { x: number; y: number };
  heading: number;
}

/**
 * The named start anchors — CANONICAL for BLUE (goal side +x); RED is the POINT mirror
 * (`bbMirror`), applied once in `spawn.ts` so no other file mirrors anything.
 *
 * TWO anchors, because a BIOBUZZ alliance is two robots and each locks one so they cannot
 * stack. There is no third or fourth because there is no known reason for one: CR's extra
 * pair existed to put a robot on a Ring Stand, and BIOBUZZ has no such structure.
 *
 * ── THEY ARE ON THE REAR AND AUDIENCE WALLS, AND THAT IS G304 ──────────────
 * G304 (manual-distilled §6.2, p104) asks a start pose for four things at once: fully on the
 * alliance's own side (A), TOUCHING the perimeter wall (C), clear of every FLOWER foot and
 * scoring volume (D), and NOT in the LOADING ZONE (E). C and E fight: a robot must be against
 * the perimeter, and the LOADING ZONE is itself against the perimeter — so the legal frontage
 * is the wall MINUS that zone. Blue's zone (`BB_LZ.blue`, x ∈ [61, 72]) eats the useful middle
 * of blue's own SIDE wall, which is exactly where both anchors used to sit.
 *
 * So they moved to the two walls an alliance shares with nobody's zone:
 *
 *   index 0  REAR wall     (34, wall−10.5) facing −y.  x = 34 keeps the footprint clear of
 *                          blue's GARDEN strip (x ≥ 47.4) and of F2, on RED's half at x = −23.4.
 *   index 1  AUDIENCE wall (46, −(wall−10.5)) facing +y. x = 46 clears F4's foot (x ∈ [20.4,
 *                          26.4]) by seven inches on one side and blue's LOADING ZONE
 *                          (x ≥ 59.1) by thirteen on the other.
 *
 * THE WALL-NORMAL COORDINATE IS WRITTEN AS `BB_HALF_* − CHASSIS_HALF`, NOT AS A LITERAL. It used
 * to be ±61.5, i.e. ±72 less a default chassis half-extent of 10.5, and the ±72 was wrong: the
 * CAD wall is at ±70.674, so a literal would now hover 1.33 in off the wall and G304.C wants the
 * robot TOUCHING it. Spec-dependent by nature — a deeper sweeper reaches further — so
 * `bbSnapStart` still re-seats per build; it has a hair to move, not a foot.
 *
 * ⚠️ **NO LONGER APPROX.** Both shapes these poses are measured against are now CAD: `BB_LZ` is
 * the union of three measured tape strips and `BB_FLOWER_FOOT` is CAD-confirmed to 0.05 in
 * (audit §6). The generous along-wall margins stay as they are — they were cover for the tape
 * slop, and the zones moving inward by ~1.9 in only widened them.
 *
 * ORDER IS LOAD-BEARING: a 2-robot alliance defaults to anchors 0 and 1, so index 0 must be
 * the TOP (y ≥ 0) anchor and index 1 the BOTTOM one (`bbAnchorCat`). They are 123 in apart —
 * opposite ends of the field — so two robots of one alliance cannot reach each other at the
 * buzzer, which is the whole reason there are two.
 */
/** the default build's chassis half-extent along its own facing axis (in) — what seats an anchor
 * against the wall it names. `bbSnapStart` re-seats per spec; this only has to be close. */
const START_CHASSIS_HALF = 10.5;
const START_SEAT_X = BB_HALF_X - START_CHASSIS_HALF;
const START_SEAT_Y = BB_HALF_Y - START_CHASSIS_HALF;
export const BB_START_POSES: readonly BbStartAnchor[] = [
  { name: 'TOP · REAR WALL', wall: 'rear', pos: { x: 34, y: START_SEAT_Y }, heading: -Math.PI / 2 },
  { name: 'BOTTOM · AUDIENCE WALL', wall: 'audience', pos: { x: 46, y: -START_SEAT_Y }, heading: Math.PI / 2 },
  // THE SIDE-WALL PAIR (owner, 2026-09-13: "come up with some default positions"). The start
  // editor offers each role two anchors, like Chain Reaction's corners. Both back onto the
  // alliance's OWN side wall (facing into the field) on either side of its LOADING ZONE
  // (y ∈ [−46.6, −23.9], G304.E): TOP at y = 45 clears the zone and F3's foot (y ∈ [20.4, 26.4]),
  // BOTTOM at y = −60 sits between the zone and the audience corner. Indices 0 and 1 are still
  // the TOP / BOTTOM defaults a 2-robot alliance spreads onto; these are the alternatives.
  { name: 'TOP · SIDE WALL', wall: 'side', pos: { x: START_SEAT_X, y: 45 }, heading: Math.PI },
  { name: 'BOTTOM · SIDE WALL', wall: 'side', pos: { x: START_SEAT_X, y: -60 }, heading: Math.PI },
];

/** how many start anchors this game offers — read by the shared per-game start-index clamp
 * (`coerceStartIndex` / `coerceSetup`) instead of DECODE's `START_POSES.length`. */
export const BB_START_POSE_COUNT = BB_START_POSES.length;

/**
 * Start ROLES are TOP / BOTTOM (which half of the start wall a robot occupies), not DECODE's
 * CLOSE / FAR. The shared `StartCat` slots carry it: close = TOP (y ≥ 0), far = BOTTOM
 * (y < 0), so a locked role limits the selector to that anchor.
 */
export const bbAnchorCat = (index: number): StartCat =>
  (BB_START_POSES[index]?.pos.y ?? 0) >= 0 ? 'close' : 'far';
export const bbDefaultIndex = (cat: StartCat): number => {
  const i = BB_START_POSES.findIndex((_, idx) => bbAnchorCat(idx) === cat);
  return i >= 0 ? i : 0;
};
/**
 * THE ROLE AS A PLAYER READS IT — TOP means the pair of anchors drawn at the TOP of the field for
 * THIS alliance.
 *
 * ⚠️ IT DEPENDS ON THE ALLIANCE, because this field is POINT-symmetric. The role slots are
 * canonical (close = the blue-frame y ≥ 0 anchors), and red's anchors are those rotated 180°, so
 * red's `close` anchors are drawn at the BOTTOM. Chain Reaction mirrors in x and never meets this;
 * labelling red by the canonical slot put "TOP · REAR WALL" on the audience wall at the bottom of
 * red's editor. Only the WORDS flip — the stored slot, the anchor indices and the 2v2 role split
 * are unchanged.
 */
export const bbRoleLabel = (cat: StartCat | undefined, alliance: Alliance = 'blue'): string => {
  if (cat !== 'close' && cat !== 'far') return '-';
  return (cat === 'close') === (alliance === 'blue') ? 'TOP' : 'BOTTOM';
};

/** an anchor's name as `alliance` sees it: its role (`bbRoleLabel`) and the wall it is really on —
 * red's rear-wall anchor is on the AUDIENCE wall once rotated, and a side wall stays a side wall. */
export function bbAnchorName(index: number, alliance: Alliance = 'blue'): string {
  const p = BB_START_POSES[index];
  if (!p) return '-';
  const wall =
    alliance === 'blue' || p.wall === 'side' ? p.wall : p.wall === 'rear' ? 'audience' : 'rear';
  return `${bbRoleLabel(bbAnchorCat(index), alliance)} · ${wall.toUpperCase()} WALL`;
}

/** a field point, optionally with a heading (radians). What `bbMirror` maps. */
export interface BbPoint {
  x: number;
  y: number;
  heading?: number;
}

/**
 * THE POINT MIRROR: `(x, y) → (−x, −y)`, `heading → heading + π`.
 *
 * The BIOBUZZ layout is POINT-SYMMETRIC (180° about the origin), NOT mirrored — red's LOADING
 * ZONE is at y > 0 and its GARDEN is the audience-left corner, and blue's are the DIAGONAL
 * opposites (`docs/biobuzz-reference.md` §2.1). The x-mirror a few lines up is a REFLECTION,
 * which is the right transform for a start anchor on a symmetric wall and the wrong one for
 * every zone on this field: reflecting a point-symmetric layout produces something internally
 * consistent and wrong, and no check inside the sim can tell the difference.
 *
 * Both live here on purpose, next to each other, so the choice is made by picking a function.
 */
export function bbMirror(p: BbPoint): BbPoint {
  return p.heading === undefined
    ? { x: -p.x, y: -p.y }
    : { x: -p.x, y: -p.y, heading: wrapAngle(p.heading + Math.PI) };
}

// ─────────────────────────────────────────────────────────────────────────────
// PENALTIES
// ─────────────────────────────────────────────────────────────────────────────

/** inches of bumper slack for the robot-robot contact test the BIOBUZZ penalty engine
 * (`penalties.ts`) reads. That engine enforces the V1 Section 11 rules a 2D sim can see (G402,
 * G407's warning, G410, G417, G421); its header lists them and says why the rest are not
 * modelled. */
export const BB_FOUL_SLOP = 1;

// ─────────────────────────────────────────────────────────────────────────────
// PRESETS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every preset drives ROBOT-CENTRIC. A sweeper collects over the edge it is mounted on and a
 * turretless launcher fires over its own edge, so for most of these builds the chassis
 * heading IS the aim, and field-centric drive hides that heading from the stick. A preset
 * default, not a rule — the assist stays a per-robot setting anyone can flip.
 *
 * Shared by reference rather than repeated, so "the presets all drive the same way" stays
 * true by construction.
 */
const BB_PRESET_ASSISTS: AssistConfig = {
  fieldCentric: false,
  aimAssist: true,
  autoIntake: true,
  autoFire: false, // BIOBUZZ has no auto-fire — Aim Assist gates the driver's own fire (robot.ts `bbLaunch`)
};

/**
 * BIOBUZZ ARCHETYPE DEMOS — one card per launcher, so a single click sets a coherent playstyle
 * and the three cards between them show every launcher, both kinds of mount and a Box Tube.
 *
 * DEMOS, and they say so. The one real kit robot (the StarterBot) is defined in `presets.ts`
 * and leads the builder's list; these follow it.
 *
 * ⚠️ `BB_PRESETS[0]` MUST STAY SNIPER, AS A LITERAL WITH NO `bbMech` CONTAINER. `coerce.ts`
 * builds `BB_DEFAULT_SPEC` from it and is a leaf of the spawn chokepoint, so the default robot
 * is whatever this first literal migrates to. Sniper's Box Tube is therefore attached at the
 * display boundary instead (`BB_DEMO_LIFT`, `presets.ts`). Skimmer carries no container either:
 * a double turret's NECTAR-turret cell resolves from the POLLEN turret's (`bbResolveMount2`),
 * so `shooterMount: 'right'` alone coerces to a right + left pair.
 *
 * All numbers stay inside the coercer's ranges, so applying a card is a no-op through the
 * coercer and the card highlights as selected — smoke asserts this.
 */
const BB_PRESET_BUILDS: readonly RobotSpec[] = [
  {
    // long-range precision: a turret aims itself, so the chassis never has to face anything —
    // which is exactly the build that can afford FRONT+BACK sweepers and collect while
    // driving in either direction. A single turret feeds POLLEN only, so its FLOWER half is the
    // Box Tube `BB_DEMO_LIFT` gives it.
    name: 'Sniper', teamName: 'Single turret · shoots and collects anywhere', teamNumber: 0,
    length: 15, width: 17, intake: 'sloped', massLb: 24, drivetrain: 'swerve',
    driveRpm: 500, flywheelInertia: 0.2, canSort: false,
    scoreMode: 'turret',
    intakeMount: 'frontback', shooterMount: 'center',
    assists: BB_PRESET_ASSISTS,
  },
  {
    // volume hauler: a REAR dumper makes the whole cycle one straight line — drive forward to
    // fill the hopper, reverse into range, unload. No turning around at either end. The hopper
    // is capped at 4 for every build, so what it offers is the cycle SHAPE, and it carries NECTAR too.
    name: 'Hauler', teamName: 'Dumper · fill forward, reverse and unload', teamNumber: 0,
    length: 15, width: 17, intake: 'sloped', massLb: 38, drivetrain: 'tank',
    driveRpm: 340, flywheelInertia: 0.2, canSort: false,
    scoreMode: 'dumper',
    intakeMount: 'front', shooterMount: 'back',
    assists: BB_PRESET_ASSISTS,
  },
  {
    // fast wall-runner: an x-drive strafes as fast as it drives, and a DOUBLE turret aims both
    // of its turrets itself — POLLEN out of the right flank, NECTAR out of the left — so it
    // scores either element on the move without ever turning. The two cells are partners
    // (grid distance 2), which is what a double turret requires.
    name: 'Skimmer', teamName: 'Double turret · both elements on the strafe', teamNumber: 0,
    length: 15, width: 16, intake: 'sloped', massLb: 26, drivetrain: 'xdrive',
    driveRpm: 520, flywheelInertia: 0.1, canSort: false,
    scoreMode: 'twinturret',
    intakeMount: 'front', shooterMount: 'right',
    assists: BB_PRESET_ASSISTS,
  },
] as const;

/**
 * The shipped builds, with MASS and HOPPER derived rather than typed out.
 *
 * Both are FUNCTIONS of the build — the mass floor of a drivetrain × inertia × mechanism, and
 * the capacity of a footprint × archetype × mount — so a hard-coded number would quietly stop
 * being "the minimum" / "the maximum" the moment any of those constants moved, and a preset
 * whose value the coercer then clamps is a card that stops highlighting as selected.
 */
export const BB_PRESETS: readonly RobotSpec[] = BB_PRESET_BUILDS.map((s) => ({
  ...s,
  massLb: Math.max(s.massLb, massLimits(s.drivetrain, s.flywheelInertia, bbMassFloorBump(s)).min),
  ballStorage: bbStorageMax(s),
}));

/** the default mount for a build that arrives without one (re-exported so the builder and the
 * coercer read the same constant the leaf module defines). */
export { BB_DEFAULT_INTAKE_MOUNT };

// ─────────────────────────────────────────────────────────────────────────────
// 3D PHYSICS (Day 1 seam, `docs/biobuzz/plan-3d.md`) — everything below is new for the 3D
// physics port and is not read by the 2D pipeline at all. NOT APPROX: R102/R105.A already
// print all three chassis dimensions (see `BB_PRISM`'s header above for the two horizontal
// ones); this is the first place BIOBUZZ names the VERTICAL one.
// ─────────────────────────────────────────────────────────────────────────────

/** `RobotSpec.heightIn` floor (in) — well under any real build; a robot has to be tall enough
 * to hold a drivetrain and a hopper at all. */
export const BB3_HEIGHT_MIN = 12;
/** `RobotSpec.heightIn` default (in) when absent — a plausible mid-size chassis, and the
 * height the 2D pipeline has always implicitly assumed by never asking. */
export const BB3_HEIGHT_DEFAULT = 18;
/** `RobotSpec.heightIn` ceiling (in) — R105.A's 29-in EXPANDED sizing volume: "a 18 in. by 24
 * in. by 29 in. tall sizing volume when fully expanded", where the manual fixes the 29 as the
 * vertical dimension (see `BB_PRISM`'s header for why the other two are not fixed to an axis
 * the same way). */
export const BB3_HEIGHT_MAX = 29;

// ─────────────────────────────────────────────────────────────────────────────
// 3D PHYSICS — DAY 1 SIM CONSTANTS (`docs/biobuzz/plan-3d.md` §10/§13.1), appended below the
// height section above. Every value not cited to the manual is `APPROX` — CAD colliders and a
// weighed element set replace these on a later day; nothing here is read by the 2D pipeline.
//
// NOTE: this file does NOT redeclare `BB_HIVE_TILT_DEG` (30°, already above, under HIVE
// STRUCTURE) for the tray's rest tilt — `sim3d/hive3d.ts` imports that one constant rather than
// carrying a second copy of the same number under a `BB3_` name.
// ─────────────────────────────────────────────────────────────────────────────

/** Day 1 kinematic tray vs. a Day 2 dynamic see-saw on a revolute joint (plan §3.6, §11) — the
 * plan's OWN fallback switch, landed early because Lane A's Day 1 scope is the kinematic tray
 * outright (a calibrated dynamic see-saw is explicitly a later day's work). `false` here is not
 * a fallback that fired; it is what Day 1 was scoped to build. */
export const BB3_HIVE_DYNAMIC = false;

/**
 * CAD-DERIVED FIELD COLLIDERS (`docs/biobuzz/plan-3d.md` §8) vs. the Day 1 constants-built
 * geometry, for the STATICS (walls' inner face/height, the hive frame legs, the flower supports)
 * and the hive TRAY (`sim3d/bodies.ts`'s `buildHiveTray3d`/`hiveCellLocalBox`).
 *
 * `true` here is the switch-over: `sim3d/bodies.ts` reads `public/models/biobuzz/field-
 * colliders.json` (via `sim3d/fieldColliders.ts`, generated into `fieldColliders.gen.ts` by
 * `npm run field-cad`) when this is `true`, falling back to the analytic box/bar/foot geometry
 * per part whenever the CAD set is missing that part (an empty hull list, an absent static) —
 * so flipping this to `false` (or the CAD files ever being pulled per their own README's
 * one-commit-revert plan) restores the Day 1 geometry exactly, with no other code change.
 */
export const BB3_FIELD_COLLIDERS = true;

/** the HIVE pivot's height above the tiles (in) — CAD (`fieldDims.gen.ts`, `hive.pivotZ`
 * 43.9497). The manual's 43.95 was exact. */
export const BB3_HIVE_PIVOT_Z = HIVE.PIVOT_Z;

/** distance from the pivot to a CELL's centre, ALONG THE BAR (in, true length, not the plan
 * projection `BB_HIVE_CELL_DY` already carries) — CAD, the midpoint of the measured cell's own
 * near and far faces. `BB3_HIVE_ARM · cos(BB_HIVE_TILT_DEG)` IS `BB_HIVE_CELL_DY`, by
 * construction now rather than by a pair of hand-typed numbers agreeing. Was 15.44. */
export const BB3_HIVE_ARM = HIVE.ARM;

/** a CELL's TRUE depth along the bar (in) — CAD (far − near over the four measured cells);
 * `BB_HIVE_CELL_LEN` is this number's plan projection at 30°. Was 12.04. */
export const BB3_HIVE_CELL_LEN = HIVE.CELL_D;

/** the CELL assembly end to end, TRUE length along the bar (in) — CAD (2 × the far face);
 * `BB_HIVE_LEN` is this number's plan projection at 30°. Was 42.91. */
export const BB3_HIVE_LEN = HIVE.LEN;

/**
 * one CELL's interior box, in the tray-local frame `sim3d/bodies.ts` defines (`w` across the
 * bar / world x, `d` along the bar, `h` floor to open top).
 *
 * CAD (`fieldDims.gen.ts`), no longer APPROX: the three numbers are the four measured cells'
 * mean width, depth and floor-to-roof height. The Day 1 guesses were `{20, 14, 12.04}` — the
 * depth was a true length "rounded up to a plausible box depth" and was 2.25 in too deep, and
 * the height reused the DEPTH figure and was 1.96 in too short.
 */
export const BB3_HIVE_CELL = { w: HIVE.CELL_W, d: HIVE.CELL_D, h: HIVE.CELL_H };

/** cell wall thickness (in) — APPROX, CAD settles it; used for the five-box kinematic tray
 * (floor, back, two sides, divider). */
export const BB3_HIVE_CELL_WALL = 0.25;

/** perimeter wall collider height (in) — APPROX, tall enough that nothing legal on this field
 * clears it (a robot tops out at `BB3_HEIGHT_MAX` 29 in). */
export const BB3_WALL_H = 40;

/** one element's mass (lb) — APPROX until a set is weighed (owner action; plan §3.6). */
export const BB3_ELEMENT_MASS = 0.2;

/** NECTAR's mass as a multiple of POLLEN's — APPROX (plan §3.6: "the field guide says three
 * pollen plus three nectar mass less than eight pollen", which rules out volume scaling). */
export const BB3_NECTAR_MASS_RATIO = 1.6;

/** ground element friction / restitution / angular (roll) damping — APPROX, tuned Day 4+.
 * `_ROLL_DAMP` is `setAngularDamping` on the sphere body: a free rolling sphere has no analogue
 * of the 2D artifact world's `BALL_ROLL_FRICTION` velocity-pass (Rapier's own rolling contact
 * would otherwise let a struck element roll forever), so this is what brings one to rest. */
export const BB3_ELEMENT_FRICTION = 0.6;
export const BB3_ELEMENT_RESTITUTION = 0.45;
export const BB3_ELEMENT_ROLL_DAMP = 0.4;

/** CCD switches on above this speed (in/s) — APPROX, sized so a full-speed launch
 * (`BB_LAUNCH_SPEED_MAX` 260) never tunnels a 0.25-in cell wall. */
export const BB3_CCD_SPEED = 60;

/** an element counts as AT REST below this speed (in/s), for `BB3_REST_TICKS` consecutive
 * ticks — `sim3d/derive.ts`'s cell-membership test. APPROX. */
export const BB3_REST_SPEED = 2;
export const BB3_REST_TICKS = 6;

/** ticks an element must sit inside an intake mouth before it is captured (`sim3d/
 * elements3d.ts`) — APPROX, long enough that a fast pass-through does not get swallowed by a
 * single-tick overlap. */
export const BB3_CAPTURE_TICKS = 3;

/** the intake's reach above the tiles (in) — an element whose BOTTOM is below this height,
 * inside a mouth rect, is eligible for capture. APPROX: a sweeper roller sits low enough to
 * catch a resting element and a shallow bounce, not a lobbed one passing overhead. */
export const BB3_INTAKE_Z = 5;

/** the readback rounding (in / rad) every dynamic body's JSON is written at (plan §3.1 step 6)
 * — see `sim3d/math3.ts`'s `round4`. */
export const BB3_ROUND = 1e-4;

/**
 * how many even angular steps a FLOWER ring plate's bore is tessellated into
 * (`sim3d/flowerTube.ts`; the four rectangle corners are inserted on top, so a plate is 36 rays
 * and 288 triangles).
 *
 * 32 is where the INSCRIBED polygon's error stops mattering: `r·(1 − cos(π/32))` is 0.010 in on
 * the 2.086-in top bore, against the 0.148-in clearance a NECTAR has through the middle bore and
 * the 0.211-in a POLLEN has through the lower one. Doubling it would buy 0.0025 in and cost 288
 * more triangles per plate across twelve plates, every one of which is in the broad phase for
 * the whole match.
 */
export const BB3_FLOWER_RING_SEGMENTS = 32;

// ── THE DYNAMIC HIVE SEE-SAW (plan §3.6) — calibrated block below ────────────────────────────

/**
 * THREE TERMS MAKE A BAR ON A HINGE BEHAVE LIKE THE REAL HIVE, and `scripts/hive-calibrate.ts`
 * solves all three against the Event Field Setup Guide's own load rows. They live in the
 * GENERATED BLOCK below so a re-run replaces the values (and their derivation) without touching
 * a word of this comment, which is the part a human wrote.
 *
 *  • **BALLAST** `BB3_HIVE_BALLAST` (lb) at `BB3_HIVE_BALLAST_AT` = `[v, w]` in the tray's own
 *    un-tilted local frame, `w` NEGATIVE (below the bar). This is what makes an EMPTY tray
 *    BI-STABLE: without it the tray is a symmetric bar on a frictionless hinge, it has no
 *    preferred pose, and the first element to land anywhere decides everything. Its sign is
 *    taken from the tray's own geometry at run time, not here (`sim3d/hive3d.ts`). The real hive
 *    is calibrated with ballast WASHERS (Event Field Setup Guide §12) — same hardware, same name.
 *  • **DETENT** `BB3_HIVE_DETENT` (torque, lb·in²/s²): the breakaway the load must overcome
 *    before the bar moves at all. Without it a single element starts the swing, because a bar at
 *    30° with anything in the raised cell already carries a net torque. It is what makes the
 *    manual's LOAD TABLE a table rather than a threshold on one number, and it is implemented as
 *    a HOLD rather than as joint friction — `sim3d/hive3d.ts`'s `hiveDynamicTick` says why that
 *    is the deterministic choice.
 *  • **DAMPING** `BB3_HIVE_DAMPING` (angular damping, 1/s): the term that sets the SWING TIME.
 *    `BB_TIP_SWING_S` (4.0 s, owner ruling) is what the kinematic tray's timer plays back and
 *    what the dynamic tray has to REPRODUCE stop to stop under gravity alone. It is not a free
 *    choice once the other two are fixed: a see-saw released at one stop accelerates under the
 *    ballast's own torque, and the damping is the only thing between "four seconds" and "half a
 *    second and a bang".
 */

/** the tray assembly's own mass (lb) — APPROX. The CAD carries no density, so this is the
 * measured part VOLUMES times the materials they are made of: the two 20.1 × 11.75 × 14.0 cells
 * are 0.020-in ACM skin (≈ 2.7 g/cm³ over ≈ 3,900 in² of sheet ⇒ ≈ 7.7 lb), the 42.8-in aluminium
 * base tube and the ribs ≈ 4 lb, the AprilTag plates and hardware ≈ 1 lb. Flagged APPROX and
 * owner-weighable, exactly like `BB3_ELEMENT_MASS`; the calibration is run AGAINST it, so a real
 * weight is a re-run of `npm run hive-calibrate`, not an edit here. */
export const BB3_HIVE_TRAY_MASS = 13;

/** the joint is AT its stop when the tilt is within this of `BB_HIVE_TILT_DEG`, and the swing
 * is OVER when the bar is that close AND turning slower than `BB3_HIVE_REST_W` (rad/s). The
 * manual scores a TIP when the damper contacts the frame (§10.5.1 B), which is this. */
export const BB3_HIVE_STOP_DEG = 29;
export const BB3_HIVE_REST_W = 0.15;

// ── BEGIN GENERATED: hive-calibrate ─────────────────────────────────────────────────────────
// Written by `npm run hive-calibrate`. DO NOT HAND-EDIT the three values below — edit the
// sweep, or the targets, and re-run. Everything outside these two markers is hand-written.
// derivation: pending — `BB3_HIVE_DYNAMIC` is false until a sweep lands every target row.
export const BB3_HIVE_BALLAST = 6;
export const BB3_HIVE_BALLAST_AT: readonly [number, number] = [8, -6];
export const BB3_HIVE_DETENT = 900;
export const BB3_HIVE_DAMPING = 1.7;
// ── END GENERATED: hive-calibrate ───────────────────────────────────────────────────────────
