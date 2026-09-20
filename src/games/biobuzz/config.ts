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

import type { Alliance, AssistConfig, RobotSpec, StartCat, Vec2, World } from '../../types';
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

/**
 * THE ONE TAPE WIDTH ON THIS FIELD (in) — CAD, via `fieldDims.gen.ts`: all 16 strips measure
 * 1.000, and `field-measurements.json` carries `tape.widthsIn` as a one-element list.
 *
 * The Event Field Guide V1.0 §8.1 (p13) allows the field to be taped with **either** 1 in or 2 in
 * ProGaff, "the outside perimeter of each zone should be consistent with the specifications, but
 * the tape width may vary" — §8.3's figure draws the LOADING ZONE both ways and §8.4's draws the
 * GARDEN as [2] 1-in pieces OR [1] 2-in piece. A renderer has to pick one build, and the build the
 * CAD ships is 1 in, so that is the one the sim draws.
 *
 * ⚠️ NOT `C.TAPE_W`. The shared constant of the same value is DECODE's field, arrived at
 * independently; both renderers used to reach for it and a BIOBUZZ tape width therefore had two
 * homes. There is one, it is this, and it is the CAD's.
 *
 * ⚠️ AND IT IS NOT A LINE WIDTH. Every tape mark is a FILLED rectangle out of `BB_TAPE`, which
 * already carries the measured width; this constant is the CONTRACT those rectangles are checked
 * against (the field lane proves every strip is exactly this wide, and the garden band exactly
 * two of them), not a number a renderer multiplies by. `BB_TAPE_2` is gone for the same reason.
 */
export const BB_TAPE_W = TAPE_W;

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

/**
 * ⚠️ **THE ONE INTAKE REACH** — how far past the frame the roller line sits, in inches.
 *
 * Every BIOBUZZ reader of "how far does the sweeper stick out" goes through this: `bbMouths`
 * (the capture area AND what both renderers draw), `bbFootprint` (the collision extent),
 * `bbRobotSolids` (the side plates a POLLEN meets) and the intake model in `bbIntakeAct`.
 * It is deliberately the SHARED preset's own number — 3.0 / 3.5 / 5.0 in for sloped / vector /
 * triangle, which is the 3–5 in an over-bumper intake really reaches — because
 * `footprintExtents` (`src/sim/field.ts`) grows the hitbox from that same preset, and a BIOBUZZ
 * number here would put the drawn roller and the collider an inch apart.
 *
 * Naming it anyway is the point: four files used to spell `INTAKE_PRESETS[spec.intake].reach`
 * independently, which is exactly how the drawn mouth and the capture zone drift.
 */
export function bbIntakeReach(spec: Pick<RobotSpec, 'intake'>): number {
  return INTAKE_PRESETS[spec.intake].reach;
}

/**
 * THE ROLLER MODEL — what the intake does to a loose element, rather than which rect swallows
 * one. Read only by `bbIntakeAct` (`robot.ts`), which is the single implementation for BOTH
 * physics backends.
 *
 * ⚠️ NONE OF THESE IS A GROUND-POLLEN PHYSICS CONSTANT (`docs/biobuzz-contract.md` §1). They
 * describe HARDWARE — how fast a roller surface moves, how wide its feed throat is, how many
 * elements a minute it can pass — the same class as `BB_INTAKES`' own geometry, and the same
 * class DECODE keeps in `INTAKE_PRESETS.mouth`. Friction, restitution, rest speed and mass
 * still belong to the shared solve, and nothing here touches an element's POSITION: the pull is
 * a VELOCITY contribution written before the solve (2D) or before the next sync (3D), exactly
 * as DECODE's `intakeSuction` is, and the solve is still the only writer of where a POLLEN is.
 *
 * All APPROX — there is no published intake in the manual to measure.
 */
/** roller surface speed (in/s): how fast the rollers walk an element they have hold of toward
 * the throat. Above the ~40 in/s a robot drives at, so a robot driving INTO a pile still draws
 * elements in rather than plowing them; well under a launch speed, so nothing is flung.
 * WAS 52. Raised to 84 (owner: intake cadence "way faster") — ceiling check 1: 84 <
 * `C.BALL_MAX_SPEED` (90) still holds, but the margin shrinks from 38 to 6 in/s (RULES lane
 * asserts this explicitly now, so a future bump that clips in 2D only and diverges the two
 * backends is caught rather than shipped quietly). */
export const BB_INTAKE_DRAW_IN = 84;
/** how much of the draw-in goes into CENTRING an off-centre element, as a fraction of the
 * inboard pull. A full-width sweeper takes an element mostly straight back over the bumper; the
 * compliant wheels' funnel is a secondary effect, not the main one.
 * WAS 0.5. Raised to 0.6 alongside the `BB_INTAKE_DRAW_IN` bump — ceiling check 2:
 * `DRAW_IN * CENTRE_FRAC` = 84*0.6 = 50.4, comfortably under `BB_INTAKE_CROSS_MAX` (80), same
 * margin shape as before (was 52*0.5=26/80). This is the exact self-trip class of bug the
 * funnel's own lateral pull can cause against its own `CROSS_MAX` on the next tick — keep the
 * product well clear of the ceiling whenever either constant moves again. */
export const BB_INTAKE_CENTRE_FRAC = 0.6;
/** NEW. Acceleration (in/s²) an element's grip velocity ramps toward `BB_INTAKE_DRAW_IN` at, in
 * `bbIntakeAct`. Fixes a units bug: that function used to pass `BB_INTAKE_DRAW_IN` straight into
 * `approach()`'s per-tick `maxDelta`, i.e. a velocity as if it were a per-TICK displacement cap —
 * effectively 52 in/s ÷ (1/60 s) = 3120 in/s² of acceleration, reaching full draw-in speed from
 * rest in exactly one tick (instant velocity, reads as a teleport/jerk). 1200 in/s² gives a
 * 0.043–0.07 s (2.6–4.2 tick) ramp to today's/tomorrow's `BB_INTAKE_DRAW_IN`, well under one feed
 * period, so it smooths the motion without becoming the new bottleneck. APPROX — no published
 * intake spec exists to measure the real number against, same caveat this file already carries
 * for `BB3_ELEMENT_MASS`. */
export const BB_INTAKE_GRIP_ACCEL = 1200;
/** the FEED THROAT, as a fraction of the mouth's lateral half-span. An element has to be drawn
 * into this band to be swallowed — everything else is the funnel's job, and it costs TIME. */
export const BB_INTAKE_THROAT_FRAC = 0.72;
/** how far past the roller line an element's CENTRE may be (on top of its own radius) and still
 * count as touching the rollers. A contact tolerance, not extra reach: in 3D the chassis
 * collider is `robotExtents` — the roller line itself — so an element resting on it sits within
 * a hair of the rect bound and a strict test missed it entirely (measured: 0/1 at the mouth's
 * lateral edge, and 35–70 ticks where 2D took 15). */
export const BB_INTAKE_LIP = 0.35;
/** how far INBOARD of the frame face an element must have been drawn to be swallowed — the
 * throat depth. With `BB_INTAKE_DRAW_IN` this is what makes a capture a SHORT TRANSIT (~3–6
 * ticks from the roller line) instead of a teleport out of the whole mouth rect. */
export const BB_INTAKE_SEAT = 1.1;
/** seconds per element through the feed: `MIN` dead centre on the roller, `MAX` at its lateral
 * edge or on a wall grab. One real FTC intake passes an element every 0.15–0.3 s.
 * WAS 0.15 / 0.3. Halved to 0.06 / 0.12 (owner: cadence "way faster") — MEASURED against the
 * live gate (`world.time - lastIntakeAt < period`, `bbIntakeAct`), not just the doc comment:
 * today's real cadence, driven through the actual pipeline, is 0.10–0.19 s/element parked dead
 * centre and 0.10–0.13 s driving in with the closing bonus — already close to the old MIN, so
 * halving both bounds is the direct, verified lever. New range with the closing bonus applied:
 * 0.0375 s (driving in hard) to 0.06 s (parked dead centre) per lane-burst; new worst case
 * (lateral edge / wall grab) is 0.075–0.12 s, still faster than the OLD best case (0.09375 s),
 * so the whole range strictly improves. */
export const BB_INTAKE_PERIOD_MIN = 0.06;
export const BB_INTAKE_PERIOD_MAX = 0.12;
/** inches of roller per FEED LANE. A bar wide enough for two paths into the hopper can take two
 * elements side by side in one cycle; a narrow one takes one. */
export const BB_INTAKE_LANE_W = 9;
/** driving INTO an element helps: the period is divided by up to `1 + BONUS` as the element's
 * inboard closing speed relative to the robot reaches `CLOSE_REF` in/s. */
export const BB_INTAKE_CLOSE_REF = 30;
export const BB_INTAKE_CLOSE_BONUS = 0.6;
/** an element crossing the mouth SIDEWAYS faster than this (in/s, relative to the robot) is not
 * gripped at all — the rollers spin under it and it carries on past. */
export const BB_INTAKE_CROSS_MAX = 80;
/** wall clearance (in, past the element's own skin) under which an element counts as PINNED and
 * is taken wherever it lies across the roller, at the slow end of the timing. A funnel cannot
 * centre something a wall is holding — DECODE learned this as "I can't intake a ball in the
 * corner anymore" and `INTAKE_WALL_GRAB` is the same rule. */
export const BB_INTAKE_WALL_GRAB = 1.2;

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
 * because renaming it touches Lane A's `elements.ts`; that is a separate cross-lane change.
 *
 * ⚠️ **IT IS THE DUMPER'S RELEASE NOW, AND ONLY THE DUMPER'S** (owner, 2026-09-19). A TURRET's
 * muzzle is the hood lip, which swings about the flywheel axle, so its release moves with the
 * elevation: `bbMuzzleLocal` / `bbMuzzleZ` (`robot.ts`) are the one answer, and every turret
 * consumer — the solve, `releasePollen`, stage 5b's landing prediction, the bot's verdict and
 * `shotPath.ts` — reads them. A tipping tray has no hood and no swing, so a dump still leaves
 * here, flat, at every distance. Do not re-point the dumper at the turret's function. */
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
 * sized against the FLOWER solid (`BB_FLOWER_FOOT`, CAD-regenerated `deep` 5.013, ring
 * `BB_FLOWER_D` = 2.629 off the wall): a chassis face flush on the flower is 5.013 − 2.629 =
 * 2.384 in past the ring centre. The reach is DERIVED as exactly that, so a robot pressed square
 * against a FLOWER foot has its placement point dead on the ring.
 *
 * WAS cited as 4.9 / 2.54 / 2.36 before the CAD regeneration (`fieldDims.gen.ts`); the VALUE was
 * always derived and correct, only this prose had drifted.
 */
export const BB_PLACE_REACH = BB_FLOWER_FOOT.deep - BB_FLOWER_D; // 2.384 — flush on the foot = dead centre
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
 * NEW. THE BOX TUBE'S OWN HARDWARE GEOMETRY — named here, not in the renderer, because the
 * RENDER lane forbids `renderRobots.ts` naming a mechanism constant of its own (the same rule
 * that keeps the intake's geometry here rather than in the file that draws it).
 *
 * `BB_BOX_TUBE_SECTIONS` (in, outer to inner): a real FTC box tube is 1.5×1.5 outer with a
 * 0.125-in wall, giving a 1.25-in clear bore, with a 1×1 tube nested inside that — three genuine
 * telescoping sections, measured hardware rather than APPROX. `BB_BOX_TUBE_WALL` is the wall
 * thickness that makes the nest close exactly: 1.5 − 2×0.125 = 1.25 is the next section's outer
 * dimension, and it is also how much each stage must be hollowed by in the mesh to read as a
 * tube rather than a bar.
 */
export const BB_BOX_TUBE_SECTIONS = [1.5, 1.25, 1.0] as const;
export const BB_BOX_TUBE_WALL = 0.125;
/** how much of each telescoping stage stays captured inside the one outboard of it at full
 * extension (in). APPROX — sized as one section width so a fully extended tube never draws as
 * two boxes with a visible gap between them; it sets per-stage travel,
 * `(bbTubeReach - (n-1) * BB_BOX_TUBE_STAGE_OVERLAP) / n`. */
export const BB_BOX_TUBE_STAGE_OVERLAP = 1.25;
/** seconds for the Box Tube to fully extend or retract, in the RENDERER only. APPROX — a RENDER
 * rate with NO sim consequence: the Box Tube has no sim travel (placement is a proximity action,
 * not a raise — see `BB_PLACE_REACH`'s header), so this can never change what scores. Shared by
 * both renderers so the 2D and 3D views ease identically. */
export const BB_BOX_TUBE_EXTEND_S = 0.35;

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

/**
 * how long a STAGGERED dump waits between elements (s) — the 3D pipeline only, via
 * `BbShot.perDump` (`robot.ts`). APPROX: a tray pouring, not four balls teleported out on one
 * tick.
 *
 * 2D never reads it, because 2D never sets `perDump`. In 3D the elements are real bodies and
 * `bbDumpSolution` converges ALL of them on ONE cell-centre point, so a simultaneous dump is a
 * four-way pile-up in the opening.
 *
 * ⚠️ **IT IS MEASURED, AND THE CURVE IS A KNEE, NOT A SLOPE.** Swept on the 28-pose tutorial
 * grid (`shoot`, BLUE, the Box-Tube dumper, dx 0/3/6/9 in and dy 14..38 in off the cell), with
 * the birth clearance of `syncElement` already in: 0.05 s → 3/28, 0.1 → 11, 0.2 → 17, **0.3 →
 * 20**, and 0.35/0.4/0.5/0.7 → 20. So 0.3 is the point at which the previous element is clear of
 * the opening before the next arrives, and paying more buys nothing but a slower pour. The
 * dumper's own lob is ~0.67 s in the air, which is why the knee sits where it does.
 *
 * A four-element hopper therefore takes 0.9 s to empty. That is a tray tipping, and the re-dump
 * cost a driver feels is still `BB_DUMP_RELOAD_S` — the stagger only applies while the hopper
 * still has load.
 */
export const BB_DUMP_STAGGER_S = 0.3;

/** the most BEATS of the accumulated cadence clock one tick may serve (`bbLaunch`). With
 * `BB_FIRE_INTERVAL` above a tick it is normally 1; this only bounds a pathological catch-up. A
 * DOUBLE turret releases up to one element PER EXIT per beat, so the element bound is twice this
 * for that build — and the hopper cap is well under either. APPROX. */
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
 * far corner firing at the opposite up-CELL. RE-MEASURED 2026-09-19 through the real solve, on
 * the 2-in field grid with the robot centre 9 in off the wall: the worst pose is (−61.67,
 * −61.67) at **256.37 in/s**, leaving **3.63 in/s of headroom**. It was 253.26 (6.74 of
 * headroom) while the muzzle was a flat 10 in; the hood-following release sits ~2.1 in lower at
 * the elevations a HIVE shot uses, and a lower release costs a little speed. NOTHING on the
 * field is speed-capped either way — the cap was not raised and must not be, since the same
 * change cut PITCH-capped poses from 255 to 211 and added 45 scoreable cells. The thing that
 * makes a turret miss is still the SLEW (aim is a physical state) and not the range. A target further or higher than the HIVE would fall short, which is
 * a miss the driver can see and drive out of rather than a silent skip.
 *
 * APPROX, like every launcher number here — see the risks in `docs/biobuzz/plan-mechanisms.md`.
 */
export const BB_LAUNCH_SPEED_MAX = 260;

/** the muzzle speed a launcher fires at when there is NO target to solve against (in/s) — a
 * turret or dumper with nothing on its open side still fires, into nothing in particular.
 * APPROX: the old drum's tuned speed, kept as a neutral number. */
export const BB_LAUNCH_SPEED_DEFAULT = 175;

/** how far a turretless launcher's plates reach past the flywheel (in). APPROX. (The GAP that
 * used to sit beside it is `BbHeadDims.plateGap` now — it is per HEAD, because a NECTAR channel
 * is not a POLLEN channel. `BB_LAUNCH_PLATE_GAP` below is the POLLEN one, kept for the 2D
 * sprite.) */
export const BB_LAUNCH_PLATE_OVERHANG = 1.2;

// ─────────────────────────────────────────────────────────────────────────────
// ROBOT — THE TURRET'S DIMENSION CHAIN (the hooded flywheel)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ **THIS CHAIN USED TO LIVE IN `scene/renderRobots.ts`, PRIVATELY, AND THAT IS WHY IT TOOK
 * SIX PASSES.** (owner report 2026-09-19, items a–e.)
 *
 * The renderer owned the flywheel radius, the hood radius, the plate profile and the muzzle
 * height; the sim owned `BB_LAUNCH_Z0`. Two numbers, two owners, and every round of feedback
 * moved one of them to answer the last complaint — so the picture and the physics agreed at one
 * pitch and nowhere else, and the next look found the next disagreement. The chain is here now,
 * `bbMuzzleLocal` (`robot.ts`) is the ONE function that turns it into a release, and BOTH the
 * sim and the 3D scene read that function. Same rule the shot path already follows: ONE
 * PREDICTOR, TWO DRAWINGS.
 *
 * Every length is in INCHES, every angle in RADIANS. There are TWO frames and the difference
 * matters at every line below:
 *
 *  · the **TURRET frame** — origin on the turret's ROTATION AXIS (the slew ring's bore, which is
 *    where the feed comes up), +x the shot direction at rest, +z up. `turretLocal` puts this on
 *    the chassis and `bbMuzzleLocal` answers in it.
 *  · the **AXLE frame** — the same axes, origin moved forward to the FLYWHEEL AXLE by
 *    `BbHeadDims.axleX`. θ is measured CCW from +x, so the exit is at θ = 90° (straight up over
 *    the wheel) and the feed pinch at θ = 180° (dead behind it). Every (θ, r) here is this one.
 *
 * ⚠️ **THE TWO FRAMES USED TO BE ONE, AND THE OWNER'S SECOND ITEM OF 2026-09-19 IS WHAT
 * SEPARATED THEM:** "the flywheel should come forward more so that the location where the balls
 * contact the flywheel initially as it comes up is roughly in the center of the turret". A real
 * hooded shooter is fed THROUGH the ring bearing: the element rises vertically up the rotation
 * axis, meets the wheel at its back, and is pinched between wheel and hood. That puts the
 * element's centre at the pinch on the turret axis, and the element's centre at the pinch is
 * exactly `pathR` from the axle — so `axleX = pathR`, and the whole head moved forward by it.
 */

/**
 * FLYWHEEL DIAMETER, IN MILLIMETRES — **72 mm, MEASURED HARDWARE** (owner, 2026-09-19).
 *
 * Recorded as the millimetres it actually is and converted here, once. A 72 mm wheel is
 * 2.8346 in, and writing that as a decimal literal would lose the only thing about it that is
 * not a judgement call. ONE wheel drives both heads: a bigger element does not want a bigger
 * flywheel, it wants a bigger hood.
 */
export const BB_FLYWHEEL_D_MM = 72;
export const BB_FLYWHEEL_R = BB_FLYWHEEL_D_MM / 2 / 25.4;

/** how much an element is squeezed between the wheel and the hood (in). APPROX — a compliant
 * wheel against a polycarb hood; it is what makes a shooter grip rather than jam. */
export const BB_HOOD_COMPRESSION = 0.3;

/** hood wall thickness (in). It is what makes the hood stand PROUD of the side plates: the
 * plates' outer arc is exactly the head's own `hoodR` and the hood occupies `hoodR … +BB_HOOD_T`,
 * so the hood is the outermost part BY CONSTRUCTION at every pitch, never by a tuned offset. */
export const BB_HOOD_T = 0.28;

/**
 * how far round the wheel the hood wraps, from the exit lip BACKWARD (rad ≈ 31.9°).
 *
 * ⚠️ **WAS 1.05 (60°), AND IT SHRANK BECAUSE THE HOOD MOVES NOW.** A hood that pivots on the
 * axle carries its own feed mouth round with it: at `BB_TURRET_PITCH_MAX` the mouth has gone 80°
 * round the wheel and no longer lines up with anything the chassis can feed. So the hood keeps
 * only the arc it needs to turn the element and let go of it, and the FIXED FEED THROAT (below)
 * takes over the entry.
 */
export const BB_HOOD_WRAP = 0.556;

/**
 * THE HOOD'S ARMS — how it hangs off the axle, since the side plates deliberately do not reach
 * it (the plates stop well below the hood).
 *
 * A real adjustable hood is an arc on two side arms that pivot on the shooter axle, and that is
 * what this is: `_T` is an arm's thickness in the arc's own plane, `_INSET` how far inboard of
 * each side plate's inner face the arm runs, so the pair reads as the hood's own linkage and not
 * as a third pair of plates. They go on the PITCH node with the arc — they ARE the hood — which
 * keeps the "only the hood moves" ruling exact: the flywheel and the plates never move.
 *
 * APPROX both: sized off the arc they carry and off the channel's working clearance. An arm's
 * lateral WIDTH is derived from them and comes out at 0.09 in for EITHER element, because the
 * channel and the hood both track the element by the same 0.15 a side.
 */
export const BB_HOOD_ARM_T = 0.26;
export const BB_HOOD_ARM_INSET = 0.06;

/**
 * THE FEED THROAT — the fixed channel the element rises through, and the rear tie between the
 * two side plates.
 *
 * ⚠️ **THIS IS WHAT FINALLY ANSWERS "THERE IS STILL A WEIRD FLAP IN THE BACK OF THE SHOOTER
 * THAT DOES NOTHING"** (owner, 2026-09-19 — the SECOND time it was reported). The pass before
 * this replaced a loose plank with a FEED SHOE: an arc at `hoodR + BB_HOOD_T + slide` spanning
 * 146°–202°, outboard of everything else on the machine and touching nothing you could see. It
 * was structure on paper and a floating curved flap on screen, which is why the same complaint
 * came back unchanged.
 *
 * What stands there now is the thing the element actually needs, in the place the new geometry
 * put it: the feed comes up the ROTATION AXIS, so the two side plates already ARE the throat's
 * cheeks and the only part missing is its BACK — one flat vertical wall, `BB_FEED_WALL_T` thick,
 * standing on the turret plate at the back of the rising element. It spans the whole channel and
 * both plate thicknesses, so it is also the rear tie; the motor bolts to its two rearward ears;
 * and the turret plate is cut through beneath it, which is what makes the path visible.
 *
 * `BB_FEED_SLIDE` is how far its FRONT FACE stands outboard of the hood's own outermost swept
 * radius. The hood sweeps a disc of radius `hoodR + BB_HOOD_T` about the axle, so a vertical
 * plane that clears that radius clears the hood at EVERY elevation — no angular bookkeeping, and
 * nothing to re-derive when `BB_TURRET_PITCH_MAX` moves.
 */
export const BB_FEED_SLIDE = 0.1;
export const BB_FEED_WALL_T = 0.25;

/**
 * THE DECK — the top of the drivetrain, where every mechanism is bolted (in off the tiles).
 *
 * The same 4.6 the renderer's side plates are built to (`BB_PLATE_H`); it is here because the
 * turret's whole stack is measured up from it and the stack is no longer the renderer's private
 * business. Anything that draws the drivetrain should read this rather than retyping it.
 */
export const BB_DECK_Z = 4.6;

/** the slew ring the turret stands on, and the turret plate on top of it (in). A real turret is a
 * toothed ring bearing with a plate bolted to its inner race; APPROX both, sized as ordinary FTC
 * ring-bearing hardware. Both are BORED: the feed comes up through them. */
export const BB_TURRET_RING_H = 0.55;
export const BB_TURRET_PLATE_T = 0.25;
/** the top face of the turret plate — the surface everything on the turret stands on. */
export const BB_TURRET_PLATE_TOP_Z = BB_DECK_Z + BB_TURRET_RING_H + BB_TURRET_PLATE_T; // 5.40

/**
 * clearance between the turret plate and the bottom of the flywheel (in).
 *
 * ⚠️ **THIS IS THE OWNER'S "the flywheel can be situated much lower, it just needs to be right
 * above the turret plate".** The flywheel used to hang wherever the muzzle-pivot geometry left
 * it; it now sits one bearing block above the plate, which is what a flywheel shooter looks
 * like. Everything above it follows: the axle is plate + clearance + radius, and the muzzle is
 * axle + `pathR` rotated by the hood's angle. APPROX — a pillow block's own height.
 */
export const BB_FLYWHEEL_CLEAR = 0.3;
/** the flywheel axle's HEIGHT off the tiles (in) — the pivot the hood swings about, and the
 * origin of the AXLE FRAME every θ on this page is measured in. Wheel bottom lands at 5.70, and
 * it is the same for both heads: one wheel, one bearing block, one plate. */
export const BB_TURRET_AXLE_Z = BB_TURRET_PLATE_TOP_Z + BB_FLYWHEEL_CLEAR + BB_FLYWHEEL_R; // 7.11732

/**
 * THE SIDE PLATE — three FLATS, a vertical EXIT CUT, the hood's own ARC and a raked REAR EDGE, in
 * the axle frame. `sidePlateR` (`scene/renderRobots.ts`) is the profile and the only reader these
 * three constants have; what lives here is the three flats.
 *
 * A FLAT FRONT, a FLAT TOP over the outgoing corridor, and a FLAT BOTTOM that lands on the turret
 * plate. Only the arc and the rake are per-head; the three flats are shared, and the top one is
 * the same number for either element by construction rather than by coincidence — see below.
 *
 * ⚠️ **THE FLAT TOP IS THE OWNER'S "the arc in the parallel plates reaches too high; the hood
 * extends above the supporting plates".** It is not a taste offset: it is one element radius plus
 * 0.15 below the outgoing corridor's own centre line, i.e. the highest a fixed plate can reach
 * without fouling a flat shot. `pathR − elemR` is `BB_FLYWHEEL_R − BB_HOOD_COMPRESSION` whatever
 * the element is, so the corridor floor — and therefore this cut — is the SAME height for a
 * POLLEN head and a NECTAR head. That is why the number below has no element in it.
 *
 * ⚠️ **AND IT IS A *FORWARD* CUT, NOT A HEMISPHERE ONE — see `sidePlateR` (`scene/renderRobots.ts`),
 * which is the only reader this constant has.** Applied over the whole upper half it also cut the
 * plate away BEHIND the exit lip, where there is no outgoing corridor and where the hood, its tail
 * and the motor are — leaving the hood 2.95 in above anything fixed and carried by two 0.26-in
 * arms (owner item (B), 2026-09-19). The value here is unchanged; the angular range it binds over
 * is not. Nothing in the muzzle chain reads it.
 *
 * ⚠️ **AND WHAT THE PLATE DOES PAST THE LIP IS A STEP, NOT A RAMP** (owner, same day: "the shooter
 * parallel plates became ugly. remember that the arc does not need to be big"). The first attempt
 * ramped up to the arc over 22° and then followed it round to the bottom — 64° of arc and a hump
 * behind the wheel. The profile jumps to the hood's radius at the lip instead, holds it for the
 * hood's own `BB_HOOD_WRAP` and comes down a straight rake. Again the value here did not move:
 * this is a PICTURE, and the release chain is not allowed to pay for one.
 */
export const BB_SIDE_PLATE_TOP_Z = BB_FLYWHEEL_R - BB_HOOD_COMPRESSION - 0.15; // +0.96732 above the axle
/**
 * the flat FRONT cut, in the axle frame.
 *
 * ⚠️ **IT CAME DOWN FROM 3.6, AND WHAT SETS IT IS THE FRONT BRACES.** With the axle on the turret
 * axis a 3.6-in front was free; with the axle `pathR` forward of it, every inch of front reach is
 * an inch of head hanging past the turntable, so the plate is cut back to the smallest front that
 * still carries the front standoffs — `BB_TURRET_BRACES`' own outer edge at ±20°, 2.076, plus a
 * bolt rim.
 */
export const BB_SIDE_PLATE_FRONT_X = 2.2;
export const BB_SIDE_PLATE_BOTTOM_Z = BB_TURRET_PLATE_TOP_Z - BB_TURRET_AXLE_Z; // −1.71732 = the plate

/**
 * THE CROSS BRACES, as angle/radius sites in the axle frame.
 *
 * ⚠️ **THERE IS ONLY ONE PLACE LEFT FOR THEM, AND IT IS THE FRONT.** The element now rises up the
 * rotation axis and is carried from θ = 180° round to the lip, so the whole rear and upper half of
 * the interior is swept by either the element or the hood; below the wheel there is 0.30 in to the
 * turret plate. What is left is the front quadrant between the wheel's rim and the plate's own
 * flats, and all three sites sit in it at one radius, 0.200 clear of the rim.
 *
 * The +20° site is the one near the shot. Its top lands at 0.933 against a corridor floor of
 * 1.117 — 0.184 of clearance, where the old +20° brace had 0.133 — and nothing fixed can do
 * better than the side plate's own flat top, which clears by 0.150 by definition
 * (`BB_SIDE_PLATE_TOP_Z`). The −44° site is the low one: its bottom lands 0.091 above the plate.
 */
export const BB_TURRET_BRACE_R = 0.283;
export const BB_TURRET_BRACES: readonly { th: number; r: number }[] = [
  { th: 20 * BB_DEG, r: 1.91 }, //  front-top, under the corridor: 0.161
  { th: -20 * BB_DEG, r: 1.91 }, // front, 0.148 inside the plate profile
  { th: -44 * BB_DEG, r: 1.91 }, // front-bottom: 0.084 over the turret plate
];

/**
 * THE FLYWHEEL MOTOR — its can, and the gap left between the can's front face and the feed wall
 * it bolts to.
 *
 * ⚠️ **IT IS BEHIND THE HOOD NOW, AND THAT IS OWNER ITEM (a) OF 2026-09-19: "the motor should be
 * on the other side of the flywheel, behind the hood".** It used to sit at θ = −15°, forward and
 * under the wheel. Its SITE is not a choice any more — it is the only pocket the machine has
 * left. The hood sweeps a disc of radius `hoodR + BB_HOOD_T` from θ = 90° to 202°; the element
 * sweeps the annulus inside that from θ = 90° to 180° and then straight down the rotation axis;
 * the turret plate is 0.30 in under the wheel. So a motor at the BACK has to clear the hood's
 * whole swept disc, which puts it at θ = 180° (level with the axle, dead behind it) just outboard
 * of the feed wall — and its belt has to run OUTBOARD OF A SIDE PLATE, because the hood's own
 * shell lies across every line from the axle to it.
 */
export const BB_TURRET_MOTOR_R = 0.71;
export const BB_TURRET_MOTOR_GAP = 0.05;

/** side-plate thickness, and how far every cross member stands PROUD of each plate's outer face
 * (owner, 2026-09-19: "i dont see the bracing" — a standoff the plate can occlude is a standoff
 * reported as missing). APPROX both: ordinary 1/4-in FTC plate and a washer stack. They are in
 * the chain rather than in the renderer because the TIE SPAN they add up to is what the turret
 * plate has to be wide enough to carry. */
export const BB_SHOOTER_PLATE_T = 0.22;
export const BB_BRACE_PROUD = 0.15;

/**
 * ONE HEAD'S DIMENSIONS — everything in the chain that depends on WHICH ELEMENT it throws.
 *
 * ⚠️ **OWNER ITEM (d), 2026-09-19: "the size of the shooter should be different for the pollen
 * shooter and the nectar shooter".** A hooded flywheel is sized by the thing that goes through
 * it: the hood stands one element DIAMETER off the wheel, the element's centre rides half that,
 * the channel between the plates is one element WIDE, and the axle sits forward of the rotation
 * axis by exactly the radius that centre path is drawn at. A 3.6-in NECTAR therefore gets a
 * visibly bigger head than a 2.8-in POLLEN, and so does its muzzle: 10.035 in at rest against
 * 9.635, which moves the arcs it solves.
 *
 * `bbTurretFor` (`mechs.ts`) is what decides which one a shot leaves from — turret 0 is the
 * POLLEN exit on every build, turret 1 is the DOUBLE turret's NECTAR exit and exists nowhere
 * else — so `which` is all a caller ever needs to pass.
 */
export interface BbHeadDims {
  /** the element this head is built around (in). */
  readonly elemR: number;
  /** the hood's INNER radius about the axle: wheel + one element diameter, less the compression. */
  readonly hoodR: number;
  /** the radius the element's CENTRE travels at — the one that sets the muzzle. */
  readonly pathR: number;
  /** how far FORWARD of the turret's rotation axis the flywheel axle sits. Equal to `pathR`, so
   *  the element pinches on the axis it came up. */
  readonly axleX: number;
  /** the clear width between the two side plates, one element wide plus a working clearance. */
  readonly plateGap: number;
  /** the feed wall's FRONT face, as a radius from the axle (the hood's swept disc plus slide). */
  readonly wallR: number;
  /** the flywheel motor's axis, as a radius from the axle, at θ = 180° — dead behind the wheel,
   *  level with it, and outboard of everything the hood sweeps. */
  readonly motorR: number;
  /** what every member that ties the two side plates together spans: the channel, both plate
   *  thicknesses and the proud ends. */
  readonly tieSpan: number;
  /** the turret plate, in the TURRET frame — a rounded rectangle, not a disc. It reaches from
   *  behind the motor mount to just past the wheel and is one tie span plus a rim wide, which is
   *  the shape of the thing standing on it; a disc big enough to do the same job would be 8.4 in
   *  across on a 14.5-in robot and would sweep further than the shooter itself at some yaw. */
  readonly plateBackX: number;
  readonly plateFrontX: number;
  readonly plateHalfW: number;
  /** the plate's feed slot: a rounded rectangle about the rotation axis, in the TURRET frame. */
  readonly slotBackX: number;
  readonly slotFrontX: number;
  readonly slotHalfW: number;
  /** the head's own fore-aft extent in the TURRET frame — the motor's rear face and the side
   *  plate's nose. What a mount has to find room for. */
  readonly backX: number;
  readonly frontX: number;
}

function bbHeadDims(elemR: number): BbHeadDims {
  const hoodR = BB_FLYWHEEL_R + elemR * 2 - BB_HOOD_COMPRESSION;
  const pathR = hoodR - elemR;
  const axleX = pathR;
  const wallR = hoodR + BB_HOOD_T + BB_FEED_SLIDE;
  const motorR = wallR + BB_FEED_WALL_T + BB_TURRET_MOTOR_GAP + BB_TURRET_MOTOR_R;
  const backX = axleX - motorR - BB_TURRET_MOTOR_R;
  const plateGap = elemR * 2 + 0.3;
  const tieSpan = plateGap + 2 * BB_SHOOTER_PLATE_T + 2 * BB_BRACE_PROUD;
  return {
    elemR,
    hoodR,
    pathR,
    axleX,
    plateGap,
    wallR,
    motorR,
    tieSpan,
    // it carries the motor's mount, the feed wall and the whole wheel's footprint; only the side
    // plates' NOSE cantilevers past it, and the plate's own rounded corner stays inside that nose
    // so the widest thing on a slewing head is the shooter and not its turntable
    plateBackX: backX - 0.15,
    plateFrontX: axleX + BB_FLYWHEEL_R + 0.15,
    plateHalfW: tieSpan / 2 + 0.2,
    slotBackX: axleX - wallR, // = −(elemR + BB_HOOD_T + BB_FEED_SLIDE): the wall's own front face
    slotFrontX: elemR + 0.25,
    slotHalfW: elemR + 0.25,
    backX,
    frontX: axleX + BB_SIDE_PLATE_FRONT_X,
  };
}

/** the POLLEN head — turret 0 on every turreted build. */
export const BB_HEAD_POLLEN = bbHeadDims(BB_POLLEN_R);
/** the NECTAR head — turret 1, which only a DOUBLE turret has. */
export const BB_HEAD_NECTAR = bbHeadDims(BB_NECTAR_R);
/** the head turret `which` is built to. */
export function bbHead(which: 0 | 1): BbHeadDims {
  return which === 1 ? BB_HEAD_NECTAR : BB_HEAD_POLLEN;
}

/** the POLLEN head's channel, in inches — the 2D sprite's, and the one number the rest of the
 * app means when it says "the launcher's plate gap". The 3D scene reads `BbHeadDims.plateGap`
 * per head instead, because a NECTAR channel is 0.8 in wider. */
export const BB_LAUNCH_PLATE_GAP = BB_HEAD_POLLEN.plateGap;

/** the hood's inner radius and the element's path radius, for the POLLEN head. Named exports
 * because the 2D sprite, the smoke lanes and the docs all speak of "the" hood radius, and a
 * single turret is always the POLLEN head. */
export const BB_HOOD_R = BB_HEAD_POLLEN.hoodR; // 3.91732
export const BB_HOOD_PATH_R = BB_HEAD_POLLEN.pathR; // 2.51732

/**
 * how many fixed-point passes `bbTurretSolution` makes over the pitch (see `bbMuzzleLocal`).
 *
 * ⚠️ **THE SOLVE IS A FIXED POINT NOW, AND IT IS BOUNDED RATHER THAN TOLERANCED.** The muzzle
 * FOLLOWS THE HOOD (owner, 2026-09-19, asked and answered), so the elevation sets the release —
 * height and setback both — and the release sets the elevation. A `while (err > tol)` would be a
 * loop whose trip count depends on floating point, which in a lockstep sim is a loop that can
 * run a different number of times on two machines. Four passes, always, no early exit, no
 * tolerance.
 *
 * MEASURED, sweeping the whole 2-in field grid at both HIVE cells (7,688 poses): a FIFTH pass
 * moves the pitch by at most **1.76e-9 rad** — 3.4e-6 of a degree, which at the longest shot on
 * the field is under a thousandth of an inch at the opening. The map contracts hard because the
 * release moves by well under an inch per degree of pitch at HIVE ranges. Three passes would
 * very likely do; four is one more than the measurement needs and still a fixed cost.
 */
export const BB_TURRET_SOLVE_PASSES = 4;
/** the mass floor a DOUBLE turret's second turret assembly adds (lb on the chassis mass FLOOR).
 * Its two turrets share one hopper and one cadence BEAT (`BB_FIRE_INTERVAL`), and since
 * 2026-09-19 both fire on that beat (owner item 5) — so a double CAN put two elements out where
 * a single puts one, when it is holding one of each kind. It is still not a faster stream of
 * POLLEN: turret 0's own rate is unchanged. */
export const BB_TWIN_MASS_FLOOR = 2.5;

/** shooter cadence (s between shots) — 13 elements/s PER TURRET EXIT. The clock is one beat
 * shared by both turrets of a double (one `fireReadyAt`, one wire field, one hopper), and every
 * exit that is loaded and on target releases on it. The turret ACCUMULATES this
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

/**
 * A CHASSIS SIZE ON THE SLIDER'S OWN GRID — `v` to the NEAREST `BB_SIZE_STEP`.
 *
 * ⚠️ THE 2026-09-13 FIX WAS HALF OF ONE, AND THE OWNER RE-REPORTED IT (2026-09-18). Flooring the
 * prism-derived LIMITS stopped the coercer from *creating* 16.331227996399747 — but nothing ever
 * snapped the VALUE, so a robot saved with that width before the fix keeps it forever: the
 * default build's width ceiling is 17, the clamp has nothing to do, and the builder prints all
 * fifteen digits. Measured: `coerceBiobuzzSpec({…, width: 16.331227996399747})` returned it
 * unchanged. Snapping in the coercer is what HEALS a stored spec, and because the coercer is the
 * one chokepoint every spec passes — localStorage, the wire, `createWorld`, the server's own
 * pass — the client and the server land on the same number, so `bbSpecKey` still agrees.
 *
 * Rounding, not flooring: this is a value a player chose, and the nearest legal dial position is
 * the honest repair. It is IDEMPOTENT (a grid value rounds to itself) and it cannot leave the
 * legal range, because every limit `bbSizeLimits` reports is already on this grid (smoke asserts
 * that separately) and the caller re-clamps anyway.
 */
export function bbSnapSize(v: number): number {
  return Math.round(v / BB_SIZE_STEP) * BB_SIZE_STEP;
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
 * In the manual, G407 ("A ROBOT may not CONTROL more than 4 SCORING ELEMENTS") starts at a
 * VERBAL WARNING, with MAJOR + YELLOW when STRATEGIC (Table 10-4). The sim caps the hopper at
 * 4 anyway, so a robot cannot hold a fifth element. The owner's ruling overrides the earlier
 * request to lift this cap (Lane B relay 2, field-plan §4.3). The rules lane's G407 test
 * (`penalties.ts`, `BB_CONTROL_LIMIT`) stays as written. It is a separate number, and it still
 * catches anything that reaches five without going through the hopper.
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
 * G407, G410, G421); its header lists them and says why the rest are not modelled. */
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
/**
 * `RobotSpec.heightIn` default (in) when absent.
 *
 * ⚠️ **14, NOT 18** (owner, 2026-09-18, off the 3D robot playtest: "robot is way too tall for no
 * apparent reason"). 18 was chosen as "a plausible mid-size chassis" before anything drew a robot
 * in three dimensions, and it happens to be R102's stow cube — but nothing a preset build CARRIES
 * needs it. The drivetrain is `BB_DECK_Z` 4.6 in, a dumper releases at `BB_LAUNCH_Z0` = 10 and a
 * turret between 7.55 and 9.63 depending on its elevation (`bbMuzzleLocal`, the hood rebuild of
 * 2026-09-19 — a turret's release came DOWN, so nothing here got tighter), and the tallest
 * mechanism geometry on any preset tops out around 12.1 in. 14 clears the
 * whole shooter with an inch or two of air, stays legal at stow (`BB3_STOW_MAX` is 18, so a
 * default build still folds inside the cube by construction) and still drives under the HIVE
 * (`BB_HIVE_BOTTOM_Z` 31.98). It is the 3D COLLIDER height for a spec that names none, so it
 * matters to the sim, not to the picture — which is why it is a number here and not a mast.
 */
export const BB3_HEIGHT_DEFAULT = 14;
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

/**
 * Day 1's kinematic tray vs. Day 2's DYNAMIC SEE-SAW on a revolute joint (plan §3.6, §11).
 *
 * ✅ **STILL TRUE — 2026-09-19, RELEASE PREDICATE REPLACED, NOT THE TRAY.** The tray body, the
 * joint, the CAD geometry, the damping-fitted ~4 s swing, the physical spill and G409's
 * `bb.spill` tag all work and all depend on this being `true`.
 *
 * ⚠️ **WHAT CHANGED: THE TRIGGER IS NOW THE TABLE, NOT A TORQUE.** A torque threshold was fit
 * against the Event Field Setup Guide's §12.3 rows and looked right at one packing per row —
 * but one COUNT does not determine one TORQUE. MEASURED at the fitted hold (5915): 8 POLLEN in
 * the same cell spans torque 4644 (piled at the back wall) to 9355 (a two-wide line), and 7
 * POLLEN spans 4204 to 7769 — the two counts' torque ranges overlap almost entirely, so no
 * `BB3_HIVE_DETENT`/`BB3_HIVE_BALLAST` pair can separate them. Worse, the guide's own rows were
 * violated in BOTH directions under the torque trigger: 8 POLLEN piled at the back wall did not
 * tip, and 7 POLLEN in a two-wide line did. `sim3d/hive3d.ts`'s `hiveDetentHold` now releases on
 * `hiveWillTip(hiveLoad(hives[a].contents, kindOf))` — the SAME `BB_TIP_POLLEN` list the HUD
 * counts — so the HUD's "0 more to tip" and the tray's own release agree BY CONSTRUCTION on every
 * row and every packing, which a torque number could not promise. `BB3_HIVE_DETENT` is
 * unchanged and still reported (see its header) — it is a diagnostic now, not the release.
 *
 * Setting it back to `false` is **NOT** "a one-word change that stays proven" (that used to be
 * true and no longer is): `bb.spill` — G409's whole tag — is written in exactly one place,
 * `hiveDynamicTick`, on the DYNAMIC path only. The kinematic path never writes it, so flipping
 * this word silently turns G409 off in 3D. If it is ever flipped, the HIVE3D lane's four G409
 * blocks must move out from under `if (BB3_HIVE_DYNAMIC)` first, or the lane stays green while
 * G409 stops firing.
 */
export const BB3_HIVE_DYNAMIC = true;

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
/**
 * ⚠️ **IT IS THE ELEMENT/TILE PAIR NOW, NOT HALF OF IT** (owner report 2026-09-19: "in real life
 * the balls bounce and disperse a lot more after the hive tips and it hits the field tiles").
 *
 * The tiles carry a MULTIPLY rule at the identity (`sim3d/bodies.ts` `TILE_RESTITUTION`), so this
 * number IS what an element bounces off the floor at, instead of being averaged with a floor
 * coefficient into `(0.45 + 0.05)/2 = 0.25`. A hard plastic ball on FTC foam is ~0.5–0.6; 0.55 is
 * the middle of that band. Still APPROX — no element has been dropped on a real tile with an
 * instrument — but the band is a real one rather than a number sized to a screenshot.
 *
 * MEASURED, a staged 8-POLLEN tip, the elements arriving at ~160 in/s off the ~30-in tray:
 * first rebound 1.0–2.1 in BEFORE, 8.6–11.0 in AFTER, and the spread about the pile's own
 * centroid went from a 17.8-in cluster to a 33.9-in one — inside the 2D pipeline's own 28–32 in,
 * which is what keeps a record set on one solve comparable with a record set on the other.
 *
 * It is also the element/element coefficient (both sides Average, so `(0.55+0.55)/2`), which was
 * 0.45 and is part of why a landing pile now scatters instead of pooling. The element/TRAY pair
 * is UNCHANGED — the tray's `Min` rule outranks Average and still hands back the tray's own 0/0.15,
 * which is what keeps a shot in the cell.
 */
export const BB3_ELEMENT_RESTITUTION = 0.55;
export const BB3_ELEMENT_ROLL_DAMP = 0.4;

/**
 * NEW. Contact stiffness (`contact_natural_frequency`, Hz) for the whole BIOBUZZ 3D world
 * (`sim3d/engineImpl.ts` and `sim3d/predict.ts` — BOTH must read this constant, or the client's
 * predicted world and the authoritative one solve contacts at different stiffness and reconcile-
 * snap on every landed shot). Was: absent — the 3D world inherited the shared `PHYS_CONTACT_FREQ`
 * (12 Hz, `src/config.ts`), which is tuned for the 2D DECODE robot world and is explicitly NOT
 * higher there because 15 Hz broke the classifier-jitter ratchet and 25 Hz broke two G408
 * possession checks and the wall-ram torque bound — none of which exists in this world, so the
 * shared constant cannot move and BIOBUZZ 3D needs its own.
 *
 * MEASURED, two independent overlap problems the same stiffness governs, both improving with
 * frequency per the closed-form soft-contact sag `g/(2·π·f)²`:
 *  • a settled element's penetration into the HIVE cell floor: 0.061–0.067 in at 12 Hz, 0.025–
 *    0.030 in at 25 Hz (closed form 0.068 / 0.0157 in — the measurement is the model).
 *  • a stacked POLLEN column's worst pollen-pollen overlap in a FLOWER tube (4-stack / 8-stack,
 *    the FLOWER's own POLLEN capacity): 12→0.406/0.948 in, 20→0.146/0.341, 30→0.065/0.152,
 *    45→0.029/0.068, 60→0.016/0.038 (bare-Rapier control).
 * 30 is the first value where an 8-high FLOWER column overlaps by less than a 16th of a diameter,
 * and it is 1.5× the shared robot-world value rather than 4×, which keeps robot-robot/robot-wall
 * contacts near where the drive-parity checks measured them. It also improves the HIVE floor case
 * beyond what 25 Hz gave it (closed-form sag at 30 Hz ≈ 0.0109 in, better than 25 Hz's 0.0157),
 * so one value serves both measurements — a separate diagnosis proposed 25 Hz (parity with the
 * 2D pipeline's `PHYS_BALL_CONTACT_FREQ`) for the HIVE case alone; 30 Hz is taken instead because
 * it is evidenced across both hive-floor and flower-stack measurements and dominates 25 Hz on
 * both. `normalizedAllowedLinearError` and `numSolverIterations` were swept and ruled out as
 * levers for either problem (bit-identical / very slightly worse) — see `sim3d/engineImpl.ts`.
 */
export const BB3_CONTACT_FREQ = 30;

/** CCD switches on above this speed (in/s) — APPROX, sized so a full-speed launch
 * (`BB_LAUNCH_SPEED_MAX` 260) never tunnels a 0.25-in cell wall. */
export const BB3_CCD_SPEED = 60;

/** how close an element's BOTTOM must be to the tiles (in) to count as rolling ON them —
 * the floor-contact test `groundRoll3d` applies the shared Coulomb rolling law through. Above
 * it the element is on structure or in the air and gets no rolling law at all. APPROX: a hair
 * over the readback rounding and the solver's own resting penetration. */
export const BB3_ROLL_FLOOR_Z = 0.25;

/**
 * THE ROLLING DECELERATION `groundRoll3d` ADDS (in/s²) — and it is DELIBERATELY NOT the 2D
 * pipeline's `BALL_ROLL_FRICTION` (32), because in 3D it is not the whole of the law.
 *
 * A 2D ground artifact is solved in a plane with no gravity and no floor, so `stepGroundBall`'s
 * 32 in/s² IS its entire rolling resistance. A 3D element is a real sphere resting on a real
 * floor with `BB3_ELEMENT_FRICTION` and `BB3_ELEMENT_ROLL_DAMP` already taking speed out of it
 * every step; adding 32 on top stopped it in half the distance. Measured roll-out at 20/40/60
 * in/s — 2D 6.9 / 28.2 / 63.7 in against 3D 3.8 / 15.1 / 33.8 at a deceleration of 32, and
 * 7.9 / 29.3 / 61.2 at 12, which is inside 15% of 2D across the range. The SIM3D lane asserts
 * that agreement rather than the constant, so re-tuning Rapier's own element friction or roll
 * damping fails there rather than silently drifting the two pipelines apart.
 */
export const BB3_ROLL_DECEL = 12;

/** an element counts as AT REST below this speed (in/s), for `BB3_REST_TICKS` consecutive
 * ticks — `sim3d/derive.ts`'s REST SNAP and `sim3d/engineImpl.ts`'s off-floor twin. APPROX.
 *
 * ⚠️ It is NOT the cell-membership test any more (2026-09-19) — see `BB3_CELL_SEAT_DEPTH`. */
export const BB3_REST_SPEED = 2;
export const BB3_REST_TICKS = 6;

/**
 * HOW FAR BELOW A CELL'S RIM AN ELEMENT'S CENTRE HAS TO BE BEFORE THE CELL COUNTS IT (in), in
 * the tray's own tilted frame. `sim3d/derive.ts`'s cell-membership test, and the whole of it:
 * no rest requirement, no dwell.
 *
 * ⚠️ **IT REPLACED A REST TIMER, AND THE REST TIMER WAS THE OWNER'S BUG** (2026-09-19: "a lot of
 * delay registering when the balls land in the hive... a significant amount of lengthened tipping
 * time due to the registration time"). Membership used to need `BB3_REST_TICKS` of stillness,
 * which is a proxy for "landed in it" that costs whatever the element's own settling costs.
 * MEASURED over 1,500 randomized arrivals at a real cell, entry of the centre to
 * `hives[a].contents`: **mean 95 ticks (1,588 ms), p50 75, p90 205, max 264**, and one arrival in
 * a hundred never registered at all inside five seconds. A real HIVE is a see-saw: an element's
 * weight is on the tray the moment it is in the tray, and it does not wait until it has stopped
 * rolling.
 *
 * **THE ONLY THING THE REST GATE WAS REALLY BUYING** was a filter against a shot that GRAZES the
 * open top of the cell and carries on — "a shot crossing the mouth is not yet in it". That is a
 * real case and the same sweep measured it exactly: of 209 arrivals that put a centre inside the
 * interior, 92 left again, and **every one of them stayed in the top 2.75 in of a 14-in cell**.
 * None entered the mouth and came back out; the cell is a box with one opening and what gets
 * properly inside it stays. So DEPTH separates the two populations outright, where "has it
 * stopped moving" only separates them by waiting:
 *
 *   deepest any grazing shot ever reached   2.75 in below the rim
 *   ─────────── 3.5, here ───────────
 *   shallowest a landed element ever RESTS  4.33 in below the rim  (a 4-high stacked pile;
 *                                                                   an ordinary load rests 10+)
 *
 * 0.75 in of margin below, 0.83 in above, and at this value the sweep records **0 grazes counted
 * and 0 landed shots missed**. What it costs is nothing: entry to depth is **mean 0.2 ticks,
 * max 7** across the same 1,500 arrivals, against the 95 the rest gate cost.
 *
 * Re-measure it (`scripts/smoke-biobuzz/hive3d.ts` prints both bounds) if the cell box, the
 * element radii or the tray restitution move — it is a window, not a threshold, and it is the
 * only tuned number in the membership test.
 */
export const BB3_CELL_SEAT_DEPTH = 3.5;

/* `BB3_CAPTURE_TICKS` (a 3-tick consecutive-overlap dwell before a 3D capture) is GONE. The
 * roller model (`bbIntakeAct`) is shared by both backends now and does that job better and in
 * both of them: a fast pass-through is refused by `BB_INTAKE_CROSS_MAX` rather than by a dwell,
 * and the delay before a swallow is the feed cadence plus the transit to the throat. A constant
 * with no reader is a number documenting an intention nothing implements. */

/** the intake's reach above the tiles (in) — an element whose BOTTOM is below this height,
 * inside a mouth rect, is eligible for capture. APPROX: a sweeper roller sits low enough to
 * catch a resting element and a shallow bounce, not a lobbed one passing overhead. */
export const BB3_INTAKE_Z = 5;

/**
 * THE INTAKE MOUTH'S SLOT HEIGHT (in) — how far up the 3D chassis compound's mouth pocket is
 * OPEN (`chassis3dShapes`, `sim3d/bodies.ts`). One NECTAR diameter, the tallest element there
 * is, so every element rolls in under the roller bar and nothing else does: a wall, a robot,
 * the HIVE and a FLOWER all meet the lintel above it at exactly the distance the old
 * single-cuboid collider put them at.
 */
export const BB3_MOUTH_SLOT_Z = 2 * BB_NECTAR_R;

/**
 * ⚠️ **THE CHASSIS EDGE BREAK (in)** — every box of the 3D chassis compound is SHRUNK by this
 * on every axis and given a CONTACT SKIN of this, which Rapier defines as an outward skin of
 * that width, so every FLAT FACE stays in exactly the plane it was in and only the EDGES are
 * broken (`chassisBoxDesc`, `sim3d/bodies.ts`, whose header has the A/B that chose a skin over
 * a `roundCuboid`). APPROX: a measured threshold, not a dimension.
 *
 * ⚠️ **THE OWNER'S "I can get stuck on a corner" IS A GRAZE, NOT A HEAD-ON STOP**, and it is
 * NOT the intake compound. Measured by driving a robot at full stick past the LEFT FLOWER's
 * support column with its flank a given overlap past the column's field-side face, travel over
 * 4 s against the same 4 s unobstructed:
 *
 *   largest overlap it still slides past (>=90% of a free run)  shipped   with this
 *     the intake compound (frame + arms + lintel)                 0.2 in     0.4 in
 *     one `robotExtents` cuboid (the FULL predictor's shape)      0.2 in     0.4 in
 *     the bare chassis box, no intake reach at all                0.2 in      —
 *     the 2D pipeline, same manoeuvre                             1.0 in      —
 *
 * The compound and the single cuboid catch at the SAME overlap to two decimals, so the arms and
 * the lintel are not what hooks — a square chassis corner in the 3D solve is. Past the
 * threshold the robot does not merely slow: it keeps **0.32** of a free run, yaws **107°** about
 * the corner and crawls at 8 in/s, which is the report. It is still escapable (reverse frees it
 * in 24 in, a strafe in 76), so it is lost momentum and a spin-out, not a lock.
 *
 * Three other suspects were measured and RULED OUT, each by making it not matter:
 *   - FRICTION. The statics' µ set to 0 leaves the threshold at 0.25 in (yaw 77° instead of
 *     107°), so the yaw comes from the NORMAL impulse at a corner far ahead of the centre of
 *     mass, not from Coulomb drag.
 *   - CONTACT STIFFNESS. `contact_natural_frequency` at 30 (shipped), 20 and the 2D robot
 *     world's 12 give bit-identical rows.
 *   - THE FIELD. Rebuilt with `__setFieldCollidersOverrideForTests(false)`, i.e. the 3D solve
 *     against the 2D pipeline's OWN flower-foot box, it slides past 0.3 in where the 2D
 *     pipeline manages 1.0 — same geometry, both solvers, so what is left is the solve.
 *
 * **0.125 IS WHERE THE BENEFIT SATURATES, AND THE ARM IS WHAT CAPS IT.** Swept against three
 * different corners — the FLOWER column, a parked ROBOT's corner, the HIVE frame bar's end —
 * with the invariants measured at every step:
 *
 *   r      flower  robot  hive   yaw@hook   flat-wall delta   start drift   no-climb max z
 *   0      0.2 in  2.4    0.6    105 deg    —                 0.0000        0.0000
 *   0.125  0.4 in  2.4    0.6    101 deg    0.00000/0.00000   0.0000        0.0000
 *   0.25   0.4 in  2.4    0.6    100 deg    0.00000/0.00000   0.0000        0.0000
 *   0.375  0.4 in  2.4    0.6     98 deg    0.00000/0.00000   0.0000        0.0000
 *   0.5    0.4 in  2.4    0.6     97 deg    0.00000/0.00000   0.0000        0.0000
 *   0.75   0.4 in  2.4    0.6     94 deg    0.00000/0.00000   0.0000        0.0000
 *   1.0    0.4 in  2.4    0.6     92 deg    0.00000/0.00010   0.0000        0.0000
 *
 * Nothing above 0.125 moves a single graze number, and capture is flat across the whole sweep
 * (a six-element cluster 12/18, a strafe past a line 4/4, an element riding the mouth's lateral
 * edge 3/4, identical at r = 0, 0.125, 0.25, 0.5 and 1.0), so the smallest radius that buys the
 * whole effect is taken.
 *
 * ⚠️ **AND THE CEILING IS THE ARM, NOT THE CLAMP.** The radius is clamped per box to
 * `BB3_INTAKE_CORNER_CLAMP × min(hx, hy, hz)` so no core can go degenerate, and the arm is
 * `INTAKE_RAIL_T` = 0.5 in thick (half-extent 0.25), so its own fillet can never exceed 0.25 in
 * by geometry. Rebuild the compound WITHOUT the arms and the limit keeps climbing with r —
 * 0.4 / 0.5 / 0.7 / 1.2 in at r = 0.125 / 0.25 / 0.5 / 1.0 — because the frame box's half-extent
 * is 7.5 and can carry any of them; with the arms present it is 0.4 at every radius. A right
 * CYLINDER of the chassis width slides past EVERY overlap out to 1.6 in. So a bigger break is
 * not available to this mouth without thickening the arm, and that is `bbRobotSolids`' geometry
 * and the 2D pipeline's.
 *
 * ⚠️ **NOTHING ANY INVARIANT MEASURES MOVES.** A skinned box is the Minkowski sum of a
 * smaller box with a ball: the six faces sit in their original planes, so flat-wall rest
 * distance, wall-flush starts and `startLegal` are untouched. Only the corners pull in — a
 * two-edge (vertical) corner by `(1 − 1/√2)r` = **0.037 in** and a three-edge vertex by
 * `(1 − 1/√3)r` = **0.053 in**, both under the ≈0.1 in of resting penetration the solver allows
 * anyway (`PHYS_ALLOWED_ERROR` × `PHYS_LENGTH_UNIT`).
 *
 * ⚠️ **THERE IS NO SEGMENT COUNT, AND THAT IS THE ANSWER TO THE OPEN QUESTION, NOT A SHORTCUT.**
 * The previous pass at this left a note that "a 45-degree chamfer still has lockable edges (and
 * locks harder at depth) — try a multi-segment arc". A swept ball IS the arc: no facets, no
 * segment count to pick, so a chamfer's own edges never exist to be caught on.
 */
export const BB3_INTAKE_CORNER_R = 0.125;

/**
 * How much of a chassis box's SMALLEST half-extent the edge break above may consume. APPROX.
 *
 * A `roundCuboid`'s core is the box shrunk by `r` on every axis, and a core half-extent at or
 * below zero is a collider Rapier will not build — the same reason `chassis3dShapes` already
 * clamps the arm thickness. 0.8 leaves a fifth of the thinnest box as core (the arm: 0.25 →
 * 0.05 in) and is not a tuned number in its own right: every radius from 0.125 to 0.375 gives
 * the same measured threshold under it, so it binds only as a floor on the core.
 */
export const BB3_INTAKE_CORNER_CLAMP = 0.8;


/**
 * ⚠️ **HOW FAR CLEAR OF A CHASSIS SOLID A FLIGHT BODY IS BORN (in)** — `syncElement`
 * (`sim3d/engineImpl.ts`), 3D only.
 *
 * A launch point is a point on the MECHANISM, and a mechanism is inside the robot. On the default
 * 15x17 frame with a `frontback` mount, `launchLine` releases a dump at `mountOrigin('back')`
 * x = −7.50, z = `BB_LAUNCH_Z0` = 10 — which straddles both the frame box (x[−7.50,7.50],
 * z[0,18]) and the back mouth LINTEL (x[−10.50,−7.50], z[3.60,18.00]). In 2D that is harmless: a
 * flight element collides with nothing. In 3D it is a body created inside a closed 3-inch pocket,
 * and the measurement is unambiguous — all four elements of a dump rose ~2 in, jammed, and rode
 * the chassis at z≈12 without ever entering flight. 0/28 on the tutorial pose grid.
 *
 * ⚠️ **SIZED OFF `BB_NECTAR_R`, NOT `BB_POLLEN_R`.** The clearance a body needs is its OWN radius
 * plus this margin, and the march that finds it has to be able to cross the widest pocket the
 * biggest element can be born in. A margin cut to the POLLEN radius is one a NECTAR-carrying build
 * (a twin turret, a Box Tube dumper) sits inside of — the same bug, surviving in exactly the
 * builds that carry the bigger ball.
 */
export const BB3_LAUNCH_CLEAR_SLOP = BB_NECTAR_R / 2;

/** how far `syncElement` will march a newly created FLIGHT body along its own velocity looking
 * for clear air (in), and the step it marches in. The bound is generous — the deepest pocket on a
 * legal build is an intake reach plus two NECTAR diameters — and a body that finds no clear point
 * inside it is left exactly where the release put it rather than teleported somewhere arbitrary. */
export const BB3_LAUNCH_CLEAR_MAX = 24;
export const BB3_LAUNCH_CLEAR_STEP = BB_NECTAR_R / 4;

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

/**
 * ⚠️ **THE FLOWER CAGE — THE TUBE HAS NO WALL BETWEEN ITS MIDDLE AND TOP PLATES, AND THAT IS
 * WHAT JAMS A COLUMN** (owner report: "POLLEN get stuck in a flower instead of dropping").
 *
 * MEASURED off the CAD hulls themselves (`scratch/flowercage.ts`: every static projected onto
 * the xy plane in the band, 2D-hulled, then a 1.4-in sphere centre marched out along 360
 * directions). Between the MID plate's top face (5.254) and the TOP plate's underside (20.254)
 * — 15.0 in, which is where elements 3 through 8 of a column live — the only solids are the four
 * HIPS pipes, round posts tangent to a cylinder of radius **1.929** at the four DIAGONALS. The
 * four gaps between them are open:
 *
 *   direction        a POLLEN centre can reach   a NECTAR centre can reach
 *   toward a pipe    0.530 in                    0.130 in
 *   into a gap       **1.046 in**                0.316 in
 *
 * Two POLLEN at opposite extremes are 2.09 in apart laterally and need 2.80 to pass each other,
 * so they SHOULDER and the column ARCHES: measured over 24 seeds of a settled column given a
 * seeded lateral kick, **10/24 (n=4) and 22–24/24 (n=7)** left an element hanging above an empty
 * tube, at centres 9.07 / 10.59 / 12.80 with 1.52 in between the lowest pair where 2.80 is the
 * touching pitch. The retrieval then refuses forever, because the bottom of the stack is nowhere
 * near the opening. Nothing was frozen and nothing was asleep — it is a friction arch.
 *
 * THE CAGE IS THE MIDDLE BORE, EXTENDED UPWARD: an `BB3_FLOWER_CAGE_SEGMENTS`-sided prism whose
 * FACES lie on the cylinder of radius `BB_FLOWER_MID_HOLE / 2` (1.948), spanning exactly that
 * plate-to-plate gap (`sim3d/flowerTube.ts`). It invents no dimension and it cannot stop
 * anything: **every element above the mid plate got there by passing that same 3.896-in bore**,
 * so a wall at that radius is an aperture it has already cleared, and it stands within 0.019 in
 * of where the pipes' own inner tangent circle already is. What it removes is the four gaps — a
 * POLLEN centre is capped at 0.548 in, a pair at 1.096, well under the 2.80 they would need to
 * shoulder past one another.
 *
 * ⚠️ **THE COUNT IS BOUNDED BELOW BY THE PIPES, NOT BY TASTE.** The prism is CIRCUMSCRIBED (see
 * `buildFlowerCage3d`), so its vertices sit at `1.948 / cos(π/N)` and its outermost point at that
 * plus `BB3_FLOWER_CAGE_T`, which has to clear the pipes' own 2.205: N = 6 is 2.375, N = 8 is
 * 2.233, N = 10 is 2.173 and **N = 12 is 2.142**. 10 would fit; 12 is taken because it costs
 * nothing — the cage is ONE trimesh collider per flower, so the segment count is vertices, not
 * broad-phase proxies. `buildFlowerCage3d`'s header carries the measurement that made a PRISM
 * the build rather than a fan of 48 cuboid slabs, and the short version is that the two cost the
 * same at the MEDIAN (~+13 % of `step3d`) and only the fan fails the AI lane's p95.
 */
export const BB3_FLOWER_CAGE_SEGMENTS = 12;

/**
 * how thick each cage slab is (in). APPROX, and the ONE thing it is sized against is the
 * OUTSIDE: the cage must not present the field a surface the four HIPS pipes do not already
 * present, or a robot's reach onto a flower moves. MEASURED over all four flowers, the tightest
 * pipe's own outermost face sits **2.205** in from the tube axis and a chassis flush on the
 * flower foot is `BB_PLACE_REACH` = 2.384 out.
 *
 * ⚠️ **AND THE NUMBER THAT HAS TO CLEAR THEM IS THE POLYGON'S VERTEX, NOT ITS FACE.** The cage
 * is circumscribed, so its furthest point is `1.948/cos(π/N) + t` = **2.142**, against a face
 * distance of 1.948 that looks far safer than the thing actually is. The build this started as
 * (a fan of 0.25-in cuboid slabs) read 2.198 at the face and **2.330** at the corner — 0.125 in
 * PAST the pipe a robot meets today, so a robot pressing on a flower would have stopped early,
 * and no check looking at the face would ever have said so. Tunnelling is not the constraint it
 * looks like: a 2.8-in sphere has to travel 2 r + t = 2.93 in in one tick (176 in/s) to skip the
 * wall, and CCD is already on above `BB3_CCD_SPEED` (60).
 *
*/
export const BB3_FLOWER_CAGE_T = 0.125;

/**
 * ⚠️ **HOW FAR OFF THE BORE AXIS A PLACED ELEMENT'S CENTRE IS SCATTERED (in)** — owner report:
 * "placing balls in a flower is too uniform". `flowerPlace3d` used to drop every element dead on
 * the axis at zero velocity, which produces a mathematically perfect stack (every POLLEN settled
 * at dxy 0.0000).
 *
 * APPROX, and it is a FRACTION OF THE TIGHTEST BORE THE ELEMENT FITS THROUGH, not a free number
 * and NOT a fraction of the cage: `sim3d/flowerTube.ts`'s `flowerDropSlack` answers 0.211 in for
 * a POLLEN (the 3.222 lower bore) and 0.148 for a NECTAR (the 3.896 middle one, because the
 * lower bore is what locks a nectar), so the offset is 0.158 and 0.111. Its header carries the
 * EJECTION that settled this: sized against the cage instead, at 0.411, a POLLEN dropped toward
 * the wall arrived 0.09 in inside the peanut supports and was thrown 8–28 in clear of the
 * flower. A radius drawn as `slack · sqrt(u)` at a uniform azimuth is uniform over the DISC,
 * which is what makes a column read as dropped rather than as a sine wave.
 *
 * ⚠️ **THE MEASUREMENT THAT USED TO SAY "DO NOT JITTER IT" WAS TRUE AND IS NOW OBSOLETE, AND
 * THE CAGE IS THE ENTIRE DIFFERENCE.** Before the cage, an offset of 0.032 in toppled a column
 * (worst pollen-pollen overlap 0.065 → 0.795 in, max dxy 1.015) because above the mid plate
 * nothing held the column vertical; the response was not proportional, so there was no small
 * safe value. With the cage the same sweep is FLAT at every offset from 0 to the full 0.548 of
 * slack — see `flower3d.ts`'s header for the re-run table.
 *
 * ⚠️ **AND THE FRACTION IS NOT WHAT DECIDES WHERE AN ELEMENT COMES TO REST.** Measured over
 * n = 1…8 × 8 seeds through the real place-and-settle, a column's elements end up at dxy
 * 0.54–0.67 whatever they were dropped at: a ball rolls off the one under it and the cage stops
 * it. The fraction decides the AZIMUTH SPREAD, which is the part that reads as natural (0.025 to
 * 1.224 in between the extremes of one column), and 1 is avoided only so a birth is never
 * exactly on the cage face.
 */
export const BB3_FLOWER_SCATTER_FRAC = 0.75;

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
 *  • **DETENT** `BB3_HIVE_DETENT` (torque, lb·in²/s²) — ⚠️ AS OF 2026-09-19 THIS IS A PIN THE
 *    TABLE LIFTS, NOT A BREAKAWAY THE LOAD BEATS. The release predicate is `BB_TIP_POLLEN` now
 *    (see `BB3_HIVE_DYNAMIC`'s header: one COUNT does not determine one TORQUE, measured across
 *    packings). This constant is still live as a DIAGNOSTIC — `hiveHoldTorque` and the HIVE3D
 *    lane still report it, and it is the measurement of how far the see-saw's own torque sits
 *    from the published table — but nothing releases on it any more.
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
// Written by `npm run hive-calibrate`. DO NOT HAND-EDIT the four values below — edit the
// sweep, or the targets, and re-run. Everything outside these two markers is hand-written.
//
// DERIVATION. Every row was WEIGHED on the real tray — staged against the back wall in a line
//   per the field guide, four seconds to settle, the tray pinned at its stop so nothing tipped
//   while it was being weighed — and its settled contents' torque about the pivot read off the
//   bodies. One POLLEN is worth 909 of torque at the arm those rows settle at (8p minus 7p).
//   The rows that must NOT tip topped out at 5635; the rows that MUST tip bottomed out at 6197;
//   the threshold is that window's midpoint, 5916, i.e. ±0.31 element-weights of margin.
//   At a stop the ballast and the detent are DEGENERATE (both are terms in that one threshold),
//   so the lever arm was swept over w ∈ [-24, 0] and a 49/51 split taken: restoring
//   2874, detent 3041. The damping was fitted by bisection against a REAL 8-POLLEN
//   tip, stop to stop, at 4.00s against BB_TIP_SWING_S 4s.
//   Rows, through the real step3d pipeline (MISS = an owner-measured row a torque model cannot
//   reach at one nectar mass; see VALIDATION in the script for why that is expected):
//     OK   7p+0n   expect NO TIP got NO TIP margin +0.31 element-weights  [field guide §12.3]
//     OK   8p+0n   expect TIP    got TIP    margin +0.69 element-weights  [field guide §12.3]
//     OK   2p+3n   expect NO TIP got NO TIP margin +0.75 element-weights  [field guide §12.3]
//     OK   3p+3n   expect TIP    got TIP    margin +0.31 element-weights  [field guide §12.3]
//     MISS 6p+1n   expect NO TIP got TIP    margin -0.24 element-weights  [owner 2026-09-12 (1n needs 7p)]
//     OK   7p+1n   expect TIP    got TIP    margin +1.24 element-weights  [owner 2026-09-12]
//     MISS 5p+2n   expect NO TIP got TIP    margin -0.79 element-weights  [owner 2026-09-12 (2n needs 6p)]
//     OK   6p+2n   expect TIP    got TIP    margin +1.79 element-weights  [owner 2026-09-12]
//     OK   0p+4n   expect NO TIP got NO TIP margin +1.30 element-weights  [owner 2026-09-12 (4n needs 1p)]
//     MISS 1p+4n   expect TIP    got NO TIP margin -0.24 element-weights  [owner 2026-09-12]
//     OK   0p+5n   expect TIP    got TIP    margin +0.41 element-weights  [owner 2026-09-12 (5n tips alone)]
export const BB3_HIVE_BALLAST = 6;
export const BB3_HIVE_BALLAST_AT: readonly [number, number] = [0, -9.5];
export const BB3_HIVE_DETENT = 3041;
export const BB3_HIVE_DAMPING = 4.466;
// ── END GENERATED: hive-calibrate ───────────────────────────────────────────────────────────

// ── CLIENT-SIDE PREDICTION (plan §5) ─────────────────────────────────────────────────────────

/**
 * How far from the LOCAL robot a FULL prediction world carries elements as dynamic bodies (in).
 *
 * APPROX, and sized by what prediction is FOR: the thing a driver feels through the stick is
 * their own chassis meeting something, and at 82 in/s a 40-tick (0.67 s) reconcile window is
 * about 55 in of travel. Anything further away cannot reach the robot inside the window, so
 * carrying it would be paying wasm for a body that changes nothing. Elements outside the radius
 * are simply absent from the prediction world; the server's own snapshot corrects anything the
 * omission got wrong, which is the whole contract prediction runs under.
 */
export const PREDICT_ELEMENT_RADIUS = 36;

/**
 * The budget one FULL reconcile of 40 ticks may cost (ms) — plan §3.10 and §5's Auto decision.
 *
 * It is a DECISION THRESHOLD, not an assertion: `probeFullReconcileMs` times one real reconcile
 * during the pre-match countdown and Auto picks Full when the measurement lands under this and
 * Light when it does not. 8 ms is a sixth of a 60 Hz frame on the phone the plan sizes against,
 * which leaves the rest of the frame for the renderer.
 */
export const PREDICT_FULL_BUDGET_MS = 8;

/** the budget one LIGHT reconcile of 40 ticks may cost (ms). It has no wasm, no contacts and one
 * body, so this is a sanity floor rather than a threshold anything chooses on. */
export const PREDICT_LIGHT_BUDGET_MS = 1;

/** how many ticks a reconcile re-steps at most — `MAX_PREDICT_LEAD` in `src/game.ts`, named here
 * because both predictors and the Auto probe are sized against it and neither may import the
 * controller (it is DOM-adjacent and Lane C's). */
export const PREDICT_MAX_TICKS = 40;

// ─────────────────────────────────────────────────────────────────────────────
// R102: THE STARTING CUBE, AND THE DEPLOY LATCH (Day 3, `docs/biobuzz/plan-3d.md` §3.3)
//
// `BB3_HEIGHT_MAX` above is R105.A's EXPANDED 29 in. R102 is the other half of the same pair:
// the STARTING CONFIGURATION is an 18-inch cube, so a build that stands taller than 18 in has
// to fold to get under it and unfold once the match starts. Nothing in the 2D pipeline has ever
// asked; the 3D robot is a cuboid `length × width × heightIn`, so the day the height became
// real the start height became real with it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * R102's starting cube, vertical dimension (in) — the height a ROBOT must be inside at the
 * start of the MATCH. `ROBOT_MAX_SIZE` is the same 18 the two horizontal dimensions are capped
 * at (`BB_EXPANSION` is written against it), so this NAMES the vertical one rather than
 * declaring a second 18 that could drift from it.
 */
export const BB3_STOW_MAX = ROBOT_MAX_SIZE;

/** the height this build stands at once it has DEPLOYED (in) — `heightIn`, with the absent
 * default spelled once. */
export function bbDeployedHeightIn(spec: RobotSpec): number {
  return spec.heightIn ?? BB3_HEIGHT_DEFAULT;
}

/**
 * THE HEIGHT THIS BUILD STARTS THE MATCH AT (in) — its STOWED height.
 *
 * ⚠️ **IT IS DERIVED, AND THAT IS A DECISION WITH A DATE ON IT.** `RobotSpec` carries no
 * `stowHeightIn` field: adding one is a `src/types.ts` edit plus a carry-across in the shared
 * `coerceSpec` (`src/sim/spawn.ts`), both of which are outside this game's tree. So until that
 * field lands, a build is MODELLED as folding to exactly R102's cube — which is the honest
 * default for this game, because every BIOBUZZ build carries a DEPLOYING sweeper (see
 * `bbSizeLimits`' header: the sweeper is the reason chassis + reach is judged against R105's
 * prism and not against R102's cube) and a tall mechanism folds onto the deck the same way.
 *
 * A DECLARED stow WINS, and it is read STRUCTURALLY — `spec.stowHeightIn` if it is a finite
 * number — so the rule binds the day the field exists without a second edit here. That is also
 * what makes `bbStowLegal` REFUSABLE today rather than true by construction: a spec off the
 * wire that declares a 22-in stow on a 29-in robot is refused, and the smoke lane pins it.
 *
 * Never above the deployed height: a robot cannot stow TALLER than it stands.
 */
export function bbStowHeightIn(spec: RobotSpec): number {
  const deployed = bbDeployedHeightIn(spec);
  const declared = (spec as { stowHeightIn?: unknown }).stowHeightIn;
  if (typeof declared === 'number' && Number.isFinite(declared)) return Math.min(declared, deployed);
  return Math.min(deployed, BB3_STOW_MAX);
}

/** R102: does this build start inside the 18-in cube? The BUILD half of start legality — it is
 * a property of the robot, not of the pose, which is why `startLegal` answers it for an absent
 * pose too (a named anchor seats a legal POSE; it cannot seat a legal HEIGHT). */
export function bbStowLegal(spec: RobotSpec): boolean {
  return bbStowHeightIn(spec) <= BB3_STOW_MAX + 1e-9;
}

/**
 * IS THE ROBOT DEPLOYED RIGHT NOW — a READ of `world.match`, not a latch (plan §3.3).
 *
 * A latch would be a fourth thing that can disagree with the phase clock, and it would have to
 * ride `BiobuzzState` onto the wire, into every snapshot and into every replay to say something
 * the phase already says. Deployment happens once, at the edge out of `pre`, and never comes
 * back — so "has the match started" IS "is the robot deployed", and `freeplay` (free drive,
 * which never has a `pre`) is deployed by the same reading.
 */
export function bbDeployed(world: World): boolean {
  return world.match.phase !== 'pre';
}

/** the height the 3D chassis collider is built to RIGHT NOW: stowed before the match, deployed
 * after. The one reader is `sim3d/`, which rebuilds the collider at the edge. */
export function bbHeightNow(world: World, spec: RobotSpec): number {
  return bbDeployed(world) ? bbDeployedHeightIn(spec) : bbStowHeightIn(spec);
}

// ─────────────────────────────────────────────────────────────────────────────
// AI DRIVERS (Day 3, `docs/biobuzz/plan-3d.md` §6) — the tuning `src/games/biobuzz/ai/` reads.
//
// EVERY NUMBER HERE IS `APPROX` AND NONE OF IT IS A RULE. These are a scripted driver's habits:
// how often it re-decides, how far off a wall it squares up, where it stands to shoot. Nothing
// in the manual constrains any of them, nothing else in the sim reads them, and changing one
// changes how well a bot plays and NOTHING ELSE — no score, no foul, no geometry. They live in
// this file rather than in `ai/` so the whole game's tuning is greppable in one place.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How often a bot RE-DECIDES, in ticks (plan §6: "re-decides every 6 ticks").
 *
 * Between decisions it HOLDS the command it last returned, which is what makes a bot seat's
 * recorded track hold-last friendly: a replay's command array compresses runs, and a driver
 * that emitted a fresh float every tick would be many times the bytes of a human's for no
 * benefit. It is also the right time constant for the job — 100 ms is about a human driver's
 * reaction, and a policy that re-solved a ballistic arc 60 times a second would chatter its
 * own aim.
 */
export const BB_AI_DECIDE_TICKS = 6;

/** how close to a perimeter wall (in) a bot squares its chassis up to it instead of steering
 * freely. Inside this band a diagonal approach catches a corner and wedges; square to the wall
 * it slides. APPROX. */
export const BB_AI_WALL_NEAR = 10;

/** how near the goal (in) counts as arrived — the bot stops translating and works the
 * mechanism. APPROX. */
export const BB_AI_ARRIVE_TOL = 2.5;

/**
 * ARRIVAL: inside this radius (in) a bot eases off the stick, down to `BB_AI_SLOW_FLOOR` of its
 * tier's cap at the goal itself.
 *
 * ⚠️ **WITHOUT IT, THE FASTEST TIER IS THE WORST ONE.** A bot holds one command for
 * `BB_AI_DECIDE_TICKS`, which at a legal top speed is about 8 in of travel — more than the 2.5-in
 * arrival tolerance — so a bot that drives at full stick right up to its firing spot sails past
 * it, turns around, and sails past it again, and never spends a decision window lined up. It was
 * measured: HARD (cap 1.0) scored 50.8 mean against an idle opponent while MEDIUM (cap 0.8)
 * scored 68.7, purely on overshoot. APPROX.
 */
export const BB_AI_SLOW_RADIUS = 12;
export const BB_AI_SLOW_FLOOR = 0.3;

/**
 * How near the COLLECT goal (in) counts as arrived — far tighter than `BB_AI_ARRIVE_TOL`,
 * because the collect goal is not a place, it is an ALIGNMENT.
 *
 * ⚠️ **THE ORDINARY TOLERANCE DEADLOCKS THE INTAKE.** The goal is the pose that puts the mouth
 * RECT's centre on the element, and the rect is only a few inches deep (`bbMouths`: `depth`
 * inside the frame, `reach` outside it). Stop 2.5 in short of that and the element is outside
 * the rect, `rectContains` says no, the bot reports "arrived", stops driving, and both sit there
 * — measured, for 140 seconds of one match, with the hopper at 2 and an element 2.5 in from the
 * roller. APPROX.
 */
export const BB_AI_GRAB_TOL = 0.5;

/**
 * How many DECISIONS a bot ignores an element it has given up on.
 *
 * A COOLDOWN rather than a permanent ban, because the field moves: a spill, a shove or the
 * opponent driving through can free what was wedged. How LONG a bot tries before giving up is a
 * TIER knob (`BbAiTierSpec.patience`) — it is the most expensive habit a weak driver has — but
 * how long it then stays away is the same for everyone. APPROX.
 */
export const BB_AI_TARGET_COOLDOWN = 120;

/**
 * How far around a given-up element (in) the bot writes off its NEIGHBOURS too.
 *
 * ⚠️ **WITHOUT IT, GIVING UP ON ONE ELEMENT IS GIVING UP ON NOTHING.** Elements that cannot be
 * reached are almost never alone — they are a PILE, in a corner, behind a FLOWER foot, against
 * the perimeter, because whatever put one there put its neighbours there too. A bot that writes
 * off exactly one then picks the element six inches to its left and spends the same patience on
 * it, and the one after that. Measured: a HARD bot ground through a corner pile for 90 seconds
 * of a 150-second match — pressed against the wall the whole time, never captured anything,
 * finished on 34 points against its own 110-point solo average. APPROX.
 */
export const BB_AI_GIVEUP_RADIUS = 8;

/**
 * COMMITMENT: how much closer a NEW element has to be, as a fraction of the distance to the one
 * the bot is already going for, before it is worth switching.
 *
 * ⚠️ **A GREEDY NEAREST-ELEMENT RULE RE-EVALUATED EVERY DECISION DOES NOT CONVERGE.** Halfway to
 * an element, the nearest one is usually a DIFFERENT element — the bot has moved, the field has
 * moved, and whichever it now turns toward will be beaten by a third a moment later. The bot
 * arrives nowhere, and the effect is WORST for the tier that re-decides most, which is the tier
 * that is meant to be best: the same policy with hesitation (a tier that skips most decisions and
 * therefore keeps last window's plan) out-collected the one without it. Hysteresis is the fix,
 * and it belongs in the policy rather than in a tier's hands. APPROX.
 */
export const BB_AI_SWITCH_FRAC = 0.6;

/** P gain on a bot's heading error, per radian, before the ±1 clamp. 2.2 settles a chassis
 * inside a decision window without overshooting into a hunt. APPROX. */
export const BB_AI_TURN_GAIN = 2.2;

/**
 * VERTICAL CLEARANCE a bot keeps under the HIVE (in), on top of its own height.
 *
 * `BB_HIVE_LOWEST_Z` (30.652, CAD) is the lowest structure on the assembly, so a 29-in robot
 * clears it by 1.65 in on paper and by nothing at all once its mechanism, its held elements or
 * a tilted tray are in the way. A bot that is `heightIn + this` or taller stays out of the
 * footprint entirely — plan §6's "stay clear of the hive footprint when tall". APPROX.
 */
export const BB_AI_HIVE_CLEARANCE = 2;

/** how far outside the HIVE's own footprint (in) the keep-out reaches for a tall bot. APPROX. */
export const BB_AI_HIVE_KEEPOUT_PAD = 6;

/**
 * Where a bot STANDS to shoot, measured OUTBOARD of the up CELL's mouth (in).
 *
 * Outboard, not anywhere: `hiveAccepts` takes an element only over the cell's open outer lip
 * (`hiveApproachSign`), so a stand-off on the pivot side is a shot that bounces off the closed
 * back. Two numbers because the two launchers have opposite failure modes — a TURRET too CLOSE
 * runs out of elevation (the arc to a 59-in cell from 15 in away wants 81°, past
 * `BB_TURRET_PITCH_MAX`), a DUMPER too FAR runs out of `BB_DUMP_MAX_DIST`. Both APPROX.
 */
export const BB_AI_TURRET_STANDOFF = 36;
export const BB_AI_DUMP_STANDOFF = 20;

/** how close to its own LOADING ZONE (in) a bot has to be before it spends a NECTAR entry
 * (`bbNectar`). A NECTAR sitting in the zone is one the opponent can drive to, so the entry is
 * spent when the robot is there to collect it — the same thing a drive team does. APPROX. */
export const BB_AI_LZ_GUARD = 42;

/**
 * How much room (in) a bot keeps around ANOTHER ROBOT, on top of the two half-diagonals.
 *
 * ⚠️ **THIS IS A FOUL AVOIDANCE NUMBER, NOT A DRIVING STYLE.** Measured before it existed: a
 * full-speed bot routing straight through an opponent parked on the same line collected G421
 * PINNING majors four times in one match (80 points, handed to the opponent) while shouldering
 * the HIVE on the way through, and LOST head-to-head to a tier that drove at half speed and
 * therefore never reached anybody. The faster tier has to be the cleaner one or "harder" just
 * means "gives away more points". (The measurement also predates G417's removal, 2026-09-19 —
 * the HIVE contact itself no longer costs anything, but the PINNING alone made the case.)
 * APPROX.
 */
export const BB_AI_ROBOT_CLEAR = 6;

/**
 * How many DECISIONS of sustained contact with another ROBOT before a bot backs off — the
 * G421 clock, read from the bot's side.
 *
 * ⚠️ **A FAST BOT THAT DOES NOT DO THIS LOSES TO A SLOW ONE.** G421 bills a MAJOR (20 points, to
 * the robot being leaned on) for PINNING an opponent for more than 3 seconds, and it re-bills
 * every three seconds after that. Measured before this existed: the HARD tier — 2.5x the EASY
 * tier's solo score — LOST 12 of 20 head-to-heads, because the matches it lost were the ones
 * where EASY's total ran to 83, 88, 112 and 123 points, almost all of it fouls HARD had handed
 * it. 12 decisions is 1.2 s, comfortably inside the rule's 3. APPROX.
 */
export const BB_AI_PIN_DECISIONS = 12;

/**
 * The speed cap (fraction of stick) a bot uses inside the HIVE footprint.
 *
 * ⚠️ **G417 (STRATEGIC ramming of the HIVE) IS REMOVED, 2026-09-19** — there is no longer a
 * closing-speed test this creep needs to stay under. The value is kept as MEASURED TUNING
 * rather than reverted: it was set when the fix for a bot driving under the assembly (the
 * space under the trays is the shortest path across the field, and G409's drive-under is
 * legal) was to arrive slowly, and undoing it is a behaviour change to a bot that currently
 * passes `test:ai`'s win-rate ratchet, not a correctness fix. Leave it until that ~9-minute
 * lane is re-run and shows the cap can move without cost. APPROX.
 */
export const BB_AI_HIVE_CREEP = 0.45;

/** speed (in/s) under which a bot that is COMMANDING full drive counts as stuck, and how many
 * consecutive decisions of it before the bot backs out. APPROX. */
export const BB_AI_STUCK_SPEED = 4;
export const BB_AI_STUCK_DECISIONS = 5;
/** how many decisions a stuck bot spends reversing and turning before it re-plans. APPROX. */
export const BB_AI_ESCAPE_DECISIONS = 3;
