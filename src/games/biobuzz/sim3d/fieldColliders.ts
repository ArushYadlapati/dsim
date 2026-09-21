/**
 * BIOBUZZ field colliders — DOM-free, server-safe reader over the CAD-derived collider set
 * (`docs/biobuzz/plan-3d.md` §8; `public/models/biobuzz/field-colliders.json`, produced by
 * `scripts/field-cad/convert.py`, README next to it documents the schema and how to
 * regenerate). The measured audit behind the current shape of this data is
 * `docs/biobuzz/field-cad-audit.md`.
 *
 * NOT a JSON import: `tsconfig.json` has no `resolveJsonModule`, and its `include: ["src"]`
 * makes every file under `src/` a compilation ROOT rather than only files reachable from an
 * entry point, so a bare JSON import here would fail `npm run build`'s `tsc` step. Instead this
 * reads the GENERATED `fieldColliders.gen.ts` (a plain typed module `scripts/field-cad.mjs`
 * writes from the same JSON every `npm run field-cad`), which needs no compiler flag at all.
 *
 * ── WHAT CHANGED, AND WHY IT MATTERS ────────────────────────────────────────────────────
 * Every entry here used to be a convex hull of a part's AXIS-ALIGNED BOUNDING BOX, taken in the
 * final SIM frame. Two consequences, both shipped as bugs and both now gone:
 *
 *  - a LEANING part's AABB is the whole box it sweeps through, so `hive_*_frame_a_frame_leg`
 *    measured a solid slab from the floor to the pivot and the entire hive frame had to be
 *    excluded from physics to keep the drive-under drivable. Statics are now TRUE convex hulls
 *    of each part instance's own tessellated surface, and the frame is a real collider again.
 *  - the TRAY sits at ±30° in the STEP, so a world-frame AABB minus the pivot is NOT the tray's
 *    local (v, w) — it is that box smeared by the tilt. Read as local, it put the up-cell floor
 *    collider 3.26 in above the mesh floor (the owner's "balls are on a different plane than the
 *    actual bottom of the hive"). `convert.py` now rotates every tray point by `−captureTheta`
 *    about the pivot BEFORE exporting, so `trays[a].hulls` are in the tray's UN-TILTED local
 *    frame, `trays[a].refTheta` is 0, and the runtime rotation is plain `hiveTiltAngle`.
 *
 * WIRED: `sim3d/bodies.ts`'s `buildStatics3d`/`buildHiveTray3d` and `hiveCellLocalBox` read
 * `cadStatics()`/`cadTrayHulls()`/`cadCellBox()` behind the `BB3_FIELD_COLLIDERS` switch
 * (`config.ts`), falling back to the Day 1 analytic geometry per part when the CAD set is
 * missing it.
 */

import type { Alliance } from '../../../types';
import { dcos, dsin } from '../../../math';
import { FIELD_COLLIDERS_JSON } from './fieldColliders.gen';

/** the PHYSICS class `convert.py`'s `PART_RULES` stamped on a part — what `bodies.ts` filters
 * on. Only the values that reach this file are listed; an unknown string is simply not in
 * `PHYSICAL_STATIC_CLASSES` and is therefore ignored by the physics, never crashed on. */
export type FieldPartClass = string;

export interface FieldStatic {
  readonly name: string;
  readonly class: FieldPartClass;
  /** CONVEX HULL POINTS, flat [x0,y0,z0, x1,y1,z1, ...], inches, sim frame. Rapier rebuilds the
   * faces itself (`ColliderDesc.convexHull`), which is why no indices are carried. */
  readonly points: readonly number[];
}

export interface FieldTrayHull {
  readonly name: string;
  readonly class: FieldPartClass;
  /** flat [x0,v0,w0, ...], inches, in the tray's PIVOT-LOCAL **UN-TILTED** frame: world =
   * pivot + Rot_x(hiveTiltAngle) · (x, v, w). */
  readonly points: readonly number[];
}

/** the cell's INTERIOR, in the same un-tilted local frame — measured off the structural facet
 * planes themselves (`convert.py`'s `note_interior`), not re-derived from the hulls, which carry
 * their own outward extrusion. */
export interface FieldCellBox {
  readonly xHalf: number;
  readonly vMin: number;
  readonly vMax: number;
  readonly wMin: number;
  readonly wMax: number;
}

export interface FieldTray {
  /** [x, y, z] in inches, sim frame — the hive's pivot, world-absolute */
  readonly pivot: readonly [number, number, number];
  /** the tilt axis, in the tray's own (pivot-relative) frame */
  readonly axis: readonly [number, number, number];
  /** the angle the exported hull points are true AT. 0 by construction on the CAD path (the
   * exporter un-tilts them); kept in the schema so a future revision that exports at some other
   * pose still has one place to say so. */
  readonly refTheta: number;
  /** the tilt the STEP's own tray sits at, radians — a MEASUREMENT, reported by the smoke lane,
   * never an input to a collider. */
  readonly captureTheta: number;
  readonly cells: { readonly north?: FieldCellBox; readonly south?: FieldCellBox };
  readonly hulls: readonly FieldTrayHull[];
}

/**
 * ONE RING PLATE, as PARAMETERS rather than as a mesh (Day 2 lane A).
 *
 * The plates are the FLOWER's whole mechanism — what an element passes, what it seats on, what
 * the 3.55-in retrieval opening is the gap between — and they are the one part of this field a
 * CONVEX HULL cannot express: a hull of an annulus fills its own bore, which is exactly the
 * opening a POLLEN goes through. `sim3d/flowerTube.ts` tessellates a rectangle-minus-disc
 * TRIMESH from these eleven numbers at engine-build time.
 *
 * PARAMETRIC AND NOT BAKED VERTICES, for a measured reason: this file is compiled into
 * `fieldColliders.gen.ts` and imported STATICALLY by `step.ts`, so every vertex would ship in
 * the MAIN client bundle (`npm run bundleaudit` is what says so). Twelve plates at ~300
 * triangles each is ~100 KB of JSON; twelve plates at eleven numbers each is 1.4 KB.
 */
export interface FieldFlowerRing {
  readonly id: 'lower' | 'mid' | 'top';
  /** the plate's own z band, [underside, top face], inches, sim frame. */
  readonly z: readonly [number, number];
  /** the bore RADIUS (in) — least-squares fit to the plate's own inner cylindrical surface. */
  readonly hole: number;
  /** the bore CENTRE [x, y], sim frame. NOT the same as `pos` to the last decimal: the three
   * plates' fitted centres differ by up to 0.011 in, and each plate's own hole is the one an
   * element passing through IT has to clear. */
  readonly bore: readonly [number, number];
  /** the plate's own footprint, sim frame — the rectangle the bore is cut out of. */
  readonly rect: { readonly x: readonly [number, number]; readonly y: readonly [number, number] };
}

export interface FieldFlowerDesc {
  readonly id: string;
  readonly wall: 'left' | 'rear' | 'right' | 'audience';
  /** [x, y] in inches, sim frame — matches `BB_FLOWERS` */
  readonly pos: readonly [number, number];
  /** the `statics[].name` entries that are this flower's SOLID support (backstop/pipes/
   * brackets/base) — the ring plates are NOT among them, see `rings` and convert.py's
   * `PART_RULES`. */
  readonly staticNames: readonly string[];
  /** the three ring plates, bottom to top. Absent on a collider set predating Day 2 lane A,
   * in which case `sim3d/flowerTube.ts` builds nothing and the tube is the supports alone. */
  readonly rings?: readonly FieldFlowerRing[];
  /** the glTF node name for this flower's visual mesh (`field.glb` / `field-low.glb`) */
  readonly visualNode: string;
}

/** the 36 soft tiles' own footprint and seam pitch, carried here (not only in
 * `field-measurements.json`) because `scene/renderField.ts` needs them at RUNTIME to paint its
 * tile-seam texture where the CAD's tiles actually are. The real pitch is 23.53 in, not `C.TILE`'s
 * 24 — see `docs/biobuzz/field-cad-audit.md` §7 — so a texture drawn on the constants' grid puts
 * every seam up to an inch off the CAD tape lying on top of it. */
export interface FieldFloor {
  readonly x: readonly [number, number];
  readonly y: readonly [number, number];
  readonly z: readonly [number, number];
  readonly pitch: number;
}

export interface FieldColliders {
  readonly units: 'in';
  readonly frame: 'sim';
  readonly floor?: FieldFloor | null;
  readonly statics: readonly FieldStatic[];
  readonly trays: { readonly red: FieldTray; readonly blue: FieldTray };
  readonly flowers: readonly FieldFlowerDesc[];
}

let cached: FieldColliders | null = null;

/** the CAD-derived collider set, parsed once and cached. Pure — same object every call. */
export function fieldColliders3d(): FieldColliders {
  if (!cached) cached = FIELD_COLLIDERS_JSON as unknown as FieldColliders;
  return cached;
}

/**
 * THE CLASSES `buildStatics3d` ACTUALLY BUILDS AS SOLIDS.
 *
 * Everything else the exporter carries is either drawn-only or deliberately analytic:
 *  - `wall` / `tile`: the perimeter and the floor stay ANALYTIC cuboids at the shared
 *    `BB_HALF_X`/`BB_HALF_Y`/`BB3_WALL_H` constants (owner rule). The CAD's own inner face is
 *    ±70.674 against the constants' 72, and every other system — the 2D pipeline, the staging,
 *    the start poses flush to the wall — is keyed to 72; a 3D wall at the CAD figure is
 *    cross-physics drift, not a correction. The hulls are still exported so `cadWallExtents()`
 *    can REPORT the gap. A thin 1-in CAD wall trimesh would also tunnel, which is why
 *    `FLOOR_HALF_T`/`BB_WALL_T` are oversized in the first place.
 *  - `tape`, `decal`, `under_tile`, `furniture`: paint, stickers, hardware below the tiles, and
 *    the human-player tray outside the wall. Nothing on the field can touch them.
 *  - `flower_ring`: the annulus problem — a convex hull of a ring plate fills its own centre
 *    hole, which is exactly the opening a POLLEN passes through and a NECTAR seats on (§10.5.2).
 *    `convert.py` does not export a hull for them at all; the name is listed here so the reason
 *    lives next to the rule.
 *  - `misc`: a structural part `convert.py` could not classify. It is EMITTED visually and
 *    logged, but never silently given a collider — an unknown solid in the middle of the field
 *    is a worse failure than a missing one.
 */
export const PHYSICAL_STATIC_CLASSES: ReadonlySet<string> = new Set(['hive_frame', 'flower_support']);

/** the CAD tile footprint and seam pitch, or `null` when the collider set predates it. */
export function cadFloor(): FieldFloor | null {
  return fieldColliders3d().floor ?? null;
}

/** the three ring plates of flower `i` (the `BB_FLOWERS` index), bottom to top — empty on a
 * collider set predating Day 2 lane A. */
export function cadFlowerRings(i: number): readonly FieldFlowerRing[] {
  return fieldColliders3d().flowers[i]?.rings ?? [];
}

/** every CAD static this build should turn into a real collider, in the file's own array order
 * (determinism). Empty when the collider set is absent or carries nothing physical. */
export function cadStatics(): readonly FieldStatic[] {
  if (!cachedStatics) {
    cachedStatics = slimFootBars(
      fieldColliders3d().statics.filter((s) => PHYSICAL_STATIC_CLASSES.has(s.class) && !ridesTray(s)),
    );
  }
  return cachedStatics;
}

let cachedStatics: readonly FieldStatic[] | null = null;

/**
 * ⚠️ THE FOOT BAR IS A CHANNEL, NOT A SOLID BLOCK — the fix here used to be ONE BOX per bar at the
 * full 1.98×38.94×2.15 AABB (owner, 2026-09-20, first report: "when I strafe... I get stuck on a
 * corner that does not exist"; that catch is still fixed, see below). Owner's SECOND report, same
 * day, on that very box: "balls are able to get stuck on top of the biobuzz panel with seemingly
 * nothing actually holding it up" / the ground-beam write-up calls it "an invisible wall/bump
 * wherever the drawn bar is lower than 2.15 in" — and it is, almost everywhere.
 *
 * MEASURED off the shipped `field.glb` (`scratch/footbar-ramp-fine.ts`, `scratch/footbar-comp2.ts`
 * — whole-connected-component zMax, the same rule `GROUND_BEAM_MAX_Z`'s own header warns a
 * per-triangle test would get wrong by slicing the A-frame leg's flared foot into this bucket; that
 * foot's own x-range (`hive_*_frame_a_frame_leg[_2]`, down to x ±24.28) very nearly overlaps the
 * bar's, which is what a naive per-triangle probe finds first): the bar's cross-section, constant
 * along essentially its whole 38.94-in length, is a shallow pressed channel — a back flange that
 * ramps LINEARLY from ~0 in at the true outer face up to 2.14 in over 0.62 in of width, then drops
 * sharply (0.02 in) to a floor that sits at **0.02–0.10 in** (never above 0.11) for the remaining
 * **1.32 in of its 1.98-in width**, all the way from one foot to the other. So the old box was
 * right about the outer 0.66 in and wrong — by up to 2.13 in — about the inner two-thirds, which is
 * exactly the side a robot driving in from the field's own driving lanes meets first.
 *
 * THE FIX: the bar's own hull becomes a narrow FLANGE box (x within `FOOT_BAR_FLANGE_W` of the
 * true outer face) spanning the bar's FULL length, and the floor beside it gets NO collider at all
 * (its drawn height, 0.10 in worst case, rounds to zero the same as the flower under-field
 * brackets below). The two frame feet become their own boxes too — at the bar's FULL original
 * width, so they still fill in the true (wider) floor near their own ~2.3-in end — but **their box
 * starts exactly where the flange's ends, `flangeInner`, and does not also cover the flange's own
 * span**: flange occupies `[outer, flangeInner]`, a foot occupies `[flangeInner, fullInner]`. They
 * TOUCH, to the bit, and never overlap.
 *
 * That "never overlap" is not a tidiness preference, it is load-bearing, and it took two wrong
 * attempts to find. Attempt 1 left the feet as their own raw 8/16-point hulls (reasoning that the
 * flange's now-continuous outer face would shield them from ever being touched): MEASURED, it does
 * not — the feet's true outer face is only 0.09–0.11 in behind the flange's, well inside the ~0.09
 * in a pressed contact already sits into a solid, so a chassis strafing along the flange still
 * grazed the foot's own faceted hull as its corner's Y position entered the foot's range (slowest
 * slide 1.9 in/s at y≈9.5, the SAME symptom as the original bug this file fixes). Attempt 2 boxed
 * the feet at the bar's full width sharing the flange's outer face bit-for-bit, which is the
 * geometrically "obvious" fix and is WRONG in a different way: it makes the foot box FULLY OVERLAP
 * the flange box across the foot's own Y-range (both occupy the same volume there), and two
 * coincident static Rapier colliders — MEASURED, reproducibly, at the SAME strafe check — froze the
 * chassis dead at y≈8.8, nowhere near either foot, for the rest of the run; a bar with feet dropped
 * entirely never showed it, and shrinking the overlap to a hair's width still showed a milder
 * version of it (dip to 1.9, never a full stop). Rapier is not asked to reconcile two static
 * colliders that occupy the same space, and something in that reconciliation is unstable in a way
 * this file cannot fix from here. Non-overlapping (this version) removes the coincidence outright
 * and the strafe check is clean at every y sampled, not merely above the 3 in/s floor.
 *
 * ⚠️ AND THE TWO RESIDUALS THE PARAGRAPH ABOVE USED TO CLOSE WITH ARE THE OWNER'S "INVISIBLE
 * CORNER" — reported five times, the last on 2026-09-21: "this invisible corner in the center
 * structure is STILL not fixed". Both are the SAME mistake the wide floor was, one axis over: a
 * SQUARE-TOPPED BOX standing on a RAMP. Measured off the shipped GLB at 0.02 in
 * (`scratch/footprofile2.ts`; `scratch/hivetop.ts` is the per-cell collider-top-vs-drawn-top
 * table this is the answer to), and all four corners agree to 0.01 in:
 *
 *  - ACROSS the bar, `d` inward from the true outer face: the drawn top is **0.24 in at d = 0**
 *    and rises LINEARLY at **3.44 in per in** to the 2.15-in plateau at d = 0.56…0.68, then drops
 *    to the 0.07-in channel floor. The flange box was 2.15 in tall across its whole 0.66 in, so
 *    it stood up to **1.91 in above the drawn bar** over the outer 0.5 in of its width, the whole
 *    38.9-in length — 37 in² of solid nothing is drawn under, both bars.
 *  - ALONG it, `e` inward from the bar's own y end: the whole assembly ENDS IN A RAMP. The drawn
 *    top is **0.16 in at the end**, rising at **2.144 in per in** to full height 0.92 in in. The
 *    flange box and both foot boxes ran square to the end at full height, so each of the centre
 *    structure's **four outer corners** carried a **1.94-in-tall block** over a chamfer that is
 *    0.19 in tall where the block is 2.13.
 *
 * A chassis is a floor-to-roof prism and is stopped by a 0.16-in lip exactly as by a 2.15-in one,
 * so neither residual ever moved a ROBOT — which is why the driving probes of 2026-09-20 came back
 * clean and the report survived them. What they moved was everything with a HEIGHT: an element
 * lands on the corner and rests in mid-air, which is the owner's whole complaint and the same
 * sentence ("nothing actually holding it up") the wide floor drew.
 *
 * THE FIX: each of the six pieces is a LIP at its full plan extent — `FOOT_BAR_LIP_Z` tall, so
 * every vertical face a chassis can reach is exactly where it was and no robot behaviour moves at
 * all — plus `FOOT_BAR_STEPS` boxes stacked on it, each spanning only the plan region where the
 * DRAWN top actually reaches that step's own ceiling. The collider is therefore NEVER above the
 * drawn surface; the residual is one step (0.50 in) of collider missing UNDER a ramp, and a ramp
 * that steep holds no element anyway. Steps and not one sloped hull, which would follow the ramp
 * exactly: a slanted static face carries 0.42 of its contact normal upward, and a chassis that
 * cannot pitch reads that as a HOP — the same speculative-diagonal-normal failure the deployed
 * ramp hit on a FLOWER's ring plate (`GROUP_RAMP`, 171 of 240 drive-ins lifted). Every face here
 * is vertical or horizontal.
 */
const FOOT_BAR_FLANGE_W = 0.66;

/** the drawn nose height (in) at the bar's outer face and at either end of the assembly — the
 * height up to which every piece keeps its part's FULL plan extent, so a chassis meets exactly
 * what it always met. 0.16 is the SMALLER of the two measured noses (0.24 across, 0.16 along),
 * which is what makes that lip legal on both axes at once. */
const FOOT_BAR_LIP_Z = 0.16;

/** the bar's own plateau top and the frame foot's own pad top (in), MEASURED — they differ by
 * 0.02 and each part is built to its own. */
const FOOT_BAR_TOP_Z = 2.15;
const FOOT_PAD_TOP_Z = 2.13;

/** the drawn top's rise (in of height per in of run) going inward from the bar's outer face, and
 * its nose height there. */
const FOOT_BAR_X_RISE = 3.44;
const FOOT_BAR_X_NOSE_Z = 0.24;

/** the drawn top's rise (in per in) going inward from either END of the assembly, off
 * `FOOT_BAR_LIP_Z`. Both bars, both ends, bar and foot alike. */
const FOOT_BAR_Y_RISE = 2.144;

/**
 * ⚠️ ONE HULL PER PIECE, STILL SIX PIECES — NOT A STACK OF BOXES, AND THE COUNT IS THE REASON.
 *
 * The obvious build for a ramp with no slanted face is a stack of receding boxes, and it works:
 * measured, four steps put every piece within 0.043 in of the drawn surface. It also ADDS 24
 * static colliders, and a collider count is not a local change — every handle created after it
 * shifts, which reorders Rapier's own islands, and MEASURED that flipped one edge-of-envelope
 * case 60 in away (the ramp ground-capture sweep's −7.65 offset, the extreme corner of the mouth)
 * at 3, 4, 5 and 6 steps alike, while the same six pieces with entirely DIFFERENT heights left it
 * untouched. Geometry is local; the count is not.
 *
 * So each piece is one `convexHull` of its own true polytope instead. The solid is
 * `z <= min(TOP, NOSE_X + RISE_X·dx, NOSE_Y + RISE_Y·dy)` over its plan rect — an intersection of
 * half-spaces, hence convex, hence exactly what a hull of its vertices is. Both boundaries are
 * piecewise linear with ONE breakpoint each, so the cross-section rect sampled at
 * `{base, NOSE_Y, NOSE_X, TOP}` carries every vertex there is and the hull is EXACT, not an
 * approximation. The faces it does slant are the top ones the ramp really has; the faces a chassis
 * meets stay VERTICAL at the part's full plan extent, because the solid is at full extent all the
 * way up to the nose height and a chassis is a floor-to-roof prism.
 */
const FOOT_BAR_SECTION_Z = [FOOT_BAR_LIP_Z, FOOT_BAR_X_NOSE_Z] as const;

/** per bar: the bar's own true outer face, its true (full-width) inner face, and the flange's own
 * (narrower) inner face — all in one place so the flange box and its two foot boxes are built from
 * exactly the same numbers, never independently re-derived. */
interface BarX {
  readonly outer: number;
  readonly fullInner: number;
  readonly flangeInner: number;
}

function slimFootBars(statics: readonly FieldStatic[]): readonly FieldStatic[] {
  const bars = statics.filter((s) => s.name.endsWith('_sheet_metal_foot_bar'));
  if (bars.length === 0) return statics;
  const barX = new Map<FieldStatic, BarX>();
  for (const bar of bars) {
    const box = aabbOfFlat(bar.points);
    // whichever face sits farther from the field centreline is the bar's TRUE outer (back) face —
    // red bars are all-negative x, blue all-positive, so this is just "which bound is bigger in
    // magnitude", no per-alliance branch needed.
    const outerIsMin = Math.abs(box.min[0]) > Math.abs(box.max[0]);
    const outer = outerIsMin ? box.min[0] : box.max[0];
    const fullInner = outerIsMin ? box.max[0] : box.min[0];
    const flangeInner = outerIsMin ? outer + FOOT_BAR_FLANGE_W : outer - FOOT_BAR_FLANGE_W;
    barX.set(bar, { outer, fullInner, flangeInner });
  }
  // a foot's name is `<bar's own prefix>_frame_foot_[ab]`, e.g. `hive_red_frame_frame_foot_a` for
  // bar `hive_red_frame_sheet_metal_foot_bar` -- match on that shared prefix, not proximity, so a
  // malformed export fails loudly (via `owner` staying undefined below) instead of guessing.
  const ownerOf = (foot: FieldStatic): FieldStatic | undefined =>
    bars.find((bar) => foot.name.startsWith(bar.name.replace(/sheet_metal_foot_bar$/, '')));

  const out: FieldStatic[] = [];
  for (const s of statics) {
    const asBar = bars.includes(s);
    const asFoot = !asBar && /_frame_foot_[ab]$/.test(s.name) ? ownerOf(s) : undefined;
    if (!asBar && !asFoot) {
      out.push(s); // everything else -- the leg, the churros, the flower brackets -- untouched
      continue;
    }
    const { outer, fullInner, flangeInner } = barX.get(asBar ? s : asFoot!)!;
    const box = aabbOfFlat(s.points);
    // the flange occupies [outer, flangeInner]; a foot occupies [flangeInner, fullInner] -- they
    // touch at `flangeInner` and never overlap (see the header above for why that matters).
    const [x0, x1] = asBar ? [outer, flangeInner] : [flangeInner, fullInner];
    const inward = x1 > x0 ? 1 : -1; // which way "in from the outer face" runs on this alliance
    const topZ = asBar ? FOOT_BAR_TOP_Z : FOOT_PAD_TOP_Z;
    // which y ends ramp down to the tiles: BOTH of a bar's, and only the OUTER one of a foot --
    // a foot's inboard end is a square cut standing under the A-frame leg's own flared foot,
    // which is drawn 3-5 in tall right there and is its own collider besides.
    const rampLo = asBar || box.min[1] < -Math.abs(box.max[1]);
    const rampHi = asBar || box.max[1] > Math.abs(box.min[1]);
    /** the piece's own cross-section rect at height `z` — the plan region where the DRAWN
     * assembly still reaches that high. Full extent up to the nose heights, then receding. */
    const sectionAt = (z: number): readonly number[] => {
      const dx = asBar ? Math.max(0, (z - FOOT_BAR_X_NOSE_Z) / FOOT_BAR_X_RISE) : 0;
      const dy = Math.max(0, (z - FOOT_BAR_LIP_Z) / FOOT_BAR_Y_RISE);
      const xOuter = x0 + inward * dx; // only the OUTER face moves; the inner one is a real edge
      const y0 = box.min[1] + (rampLo ? dy : 0);
      const y1 = box.max[1] - (rampHi ? dy : 0);
      const pts: number[] = [];
      if (Math.abs(x1 - xOuter) < 1e-6 || y1 - y0 < 1e-6) return pts;
      for (const x of [xOuter, x1]) for (const y of [y0, y1]) pts.push(x, y, z);
      return pts;
    };
    // base, then each breakpoint, then the plateau. Every vertex of the polytope is a corner of
    // one of these rects, so the hull of them is the polytope exactly -- see the header.
    const pts: number[] = [];
    for (const z of [box.min[2], ...FOOT_BAR_SECTION_Z, topZ]) {
      if (z < box.min[2] || z > topZ) continue;
      pts.push(...sectionAt(z));
    }
    out.push({ name: s.name, class: s.class, points: pts });
  }
  return out;
}

interface Aabb {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

function aabbOfFlat(flat: readonly number[]): Aabb {
  let x0 = Infinity;
  let y0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < flat.length; i += 3) {
    const x = flat[i];
    const y = flat[i + 1];
    const z = flat[i + 2];
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (z < z0) z0 = z;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
    if (z > z1) z1 = z;
  }
  return { min: [x0, y0, z0], max: [x1, y1, z1] };
}

/** signed-ish distance from `p` to an AABB: 0 when inside, the Euclidean distance to the
 * nearest face/edge/corner otherwise. */
function distToAabb(p: readonly [number, number, number], box: Aabb): number {
  let d2 = 0;
  for (let k = 0; k < 3; k++) {
    const v = p[k];
    const lo = box.min[k];
    const hi = box.max[k];
    const out = v < lo ? lo - v : v > hi ? v - hi : 0;
    d2 += out * out;
  }
  return Math.sqrt(d2);
}

export interface ProbeResult {
  readonly point: readonly [number, number, number];
  /** the nearest static's name, or a tray hull's `hive_red/...` id, or null if the collider set
   * has nothing at all (e.g. the CAD import never ran) */
  readonly nearestName: string | null;
  /** APPROXIMATE distance (inches) to that static's/tray's AXIS-ALIGNED BOUNDING BOX — a
   * deliberate simplification: a true point-to-hull distance needs a BVH this DOM-free,
   * dependency-free module does not carry, and an AABB is exactly conservative enough for the
   * smoke check this feeds (`docs/biobuzz/plan-3d.md` §8/§9: comparing the CAD and
   * constants-built collider sets at twelve probe points is a coarse agreement check, not a
   * collision-accuracy one). A probe point genuinely embedded in a concave region but outside
   * its AABB is impossible by construction, so this never UNDER-reports "outside". */
  readonly distance: number;
}

/**
 * For each `points` triple, the nearest static or tray hull, and the (approximate) distance to
 * it. Pure, DOM-free — the smoke lane that compares this collider set against the
 * constants-built one calls this directly.
 *
 * Tray hulls are in the UN-TILTED local frame, so they are rotated by `captureTheta` and shifted
 * by the pivot before boxing — i.e. the probe sees the tray where the STEP actually has it, which
 * is also where `createBiobuzzWorld` stages it.
 */
export function probeColliders(points: readonly (readonly [number, number, number])[]): ProbeResult[] {
  const fc = fieldColliders3d();
  const named: { name: string; box: Aabb }[] = [];
  for (const s of fc.statics) named.push({ name: s.name, box: aabbOfFlat(s.points) });
  for (const [alliance, tray] of [
    ['hive_red', fc.trays.red],
    ['hive_blue', fc.trays.blue],
  ] as const) {
    // `dcos`/`dsin`, never the engine's own trig: `scripts/smoke.ts`'s source guard scans this
    // whole directory for engine-defined transcendentals — by TEXT, so do not name one even in a
    // comment — and it is right to: an engine's trig is not required to be correctly-rounded, so
    // two peers can compute different bits from the same input.
    const c = dcos(tray.captureTheta);
    const sn = dsin(tray.captureTheta);
    for (const h of tray.hulls) {
      const world: number[] = new Array(h.points.length);
      for (let i = 0; i < h.points.length; i += 3) {
        const x = h.points[i];
        const v = h.points[i + 1];
        const w = h.points[i + 2];
        world[i] = x + tray.pivot[0];
        world[i + 1] = v * c - w * sn + tray.pivot[1];
        world[i + 2] = v * sn + w * c + tray.pivot[2];
      }
      named.push({ name: `${alliance}/${h.name}`, box: aabbOfFlat(world) });
    }
  }
  return points.map((p) => {
    let best: { name: string; d: number } | null = null;
    for (const n of named) {
      const d = distToAabb(p, n.box);
      if (!best || d < best.d) best = { name: n.name, d };
    }
    return { point: p, nearestName: best?.name ?? null, distance: best?.d ?? Infinity };
  });
}

// ---------------------------------------------------------------------------------------------
// THE TRAY
// ---------------------------------------------------------------------------------------------

/**
 * The tilt the STEP's own tray sits at, radians, as MEASURED by the exporter (it is ±30.000° on
 * STEP v26-27.2, proven by the residual thickness of the Back Skin — a wrong angle reads as a
 * thick sheet; see `docs/biobuzz/field-cad-audit.md` §4.1). It is NOT applied to anything: the
 * exported hulls are already un-tilted by it. Read by `probeColliders` above and reported by the
 * SIM3D smoke lane's measurements check.
 */
export function cadCaptureTheta(alliance: Alliance): number {
  return fieldColliders3d().trays[alliance].captureTheta;
}

/**
 * Every CAD hull for one hive's tray, in the PIVOT-LOCAL UN-TILTED frame — ready for
 * `RAPIER.ColliderDesc.convexHull` with no rotation offset at all.
 *
 * ⚠️ NOTHING IS FILTERED OUT HERE ANY MORE, and that is the fix, not an oversight. The previous
 * version dropped every `_side_` hull because the exporter's per-part AABB for the "side" bucket
 * spanned the cell's FULL width and reached 3.5 in past the mouth, so a shot staged just outside
 * the cell started INSIDE it and the solver ejected it at ~600 in/s. The hulls are now PLANAR
 * FACET SLABS (`convert.py` §7): `cell_<side>_floor`, `_side_pos`, `_side_neg`, `_roof_pos`,
 * `_roof_neg`, `_back`, plus `bar_<side>`. Each sits exactly on its own CAD surface, extruded
 * outward, so the cell mouth is the real aperture and nothing overreaches it.
 */
export function cadTrayHulls(alliance: Alliance): readonly FieldTrayHull[] {
  return fieldColliders3d().trays[alliance].hulls;
}

/**
 * ⚠️ PARTS THE EXPORTER FILES UNDER THE FRAME THAT ARE BOLTED TO THE TRAY: the eight Churro
 * cross-braces and, per hive, the two goal pivot brackets, two damper holders and two dampers.
 * `scene/renderFieldGlb.ts` already carries all of them on the tilting group (they are
 * mirror-symmetric about the pivot only in the TRAY's frame). As fixed statics they stayed at the
 * STEP's captured pose, so after a tip an element could strike a brace that was drawn 20 in away.
 */
const TRAY_RIDER = /_(10_5in_churro_lite|goal_pivot_bracket|pivot_damper_holder|blumotion_970a_damper)(_\d+)?$/;

function ridesTray(s: FieldStatic): boolean {
  return s.class === 'hive_frame' && TRAY_RIDER.test(s.name);
}

const cachedRiders: Partial<Record<Alliance, readonly FieldTrayHull[]>> = {};

/**
 * The tray-riding frame parts of one hive, in the tray's own pivot-local UN-TILTED frame — the
 * frame `cadTrayHulls` is in, so `buildHiveTray3d` adds them to the same body. The inverse of the
 * rotation `probeColliders` applies: world = pivot + Rot(captureTheta) · local. A `shared_frame`
 * brace belongs to the hive on its own side of x = 0.
 */
export function cadTrayRiders(alliance: Alliance): readonly FieldTrayHull[] {
  const hit = cachedRiders[alliance];
  if (hit) return hit;
  const fc = fieldColliders3d();
  const tray = fc.trays[alliance];
  const other = fc.trays[alliance === 'red' ? 'blue' : 'red'];
  const c = dcos(tray.captureTheta);
  const sn = dsin(tray.captureTheta);
  const out: FieldTrayHull[] = [];
  for (const s of fc.statics) {
    if (!ridesTray(s)) continue;
    let mx = 0;
    for (let i = 0; i < s.points.length; i += 3) mx += s.points[i];
    mx /= s.points.length / 3;
    if (Math.abs(mx - tray.pivot[0]) > Math.abs(mx - other.pivot[0])) continue;
    const local: number[] = new Array(s.points.length);
    for (let i = 0; i < s.points.length; i += 3) {
      const dy = s.points[i + 1] - tray.pivot[1];
      const dz = s.points[i + 2] - tray.pivot[2];
      local[i] = s.points[i] - tray.pivot[0];
      local[i + 1] = dy * c + dz * sn;
      local[i + 2] = -dy * sn + dz * c;
    }
    out.push({ name: s.name, class: s.class, points: local });
  }
  cachedRiders[alliance] = out;
  return out;
}

/** the angle `engine.ts`'s `applyHiveTilt` and `scene/renderField.ts` subtract from the absolute
 * tilt before driving the tray. 0 on the CAD path by construction; the indirection stays so
 * there is exactly ONE place that answers the question. */
export function cadTrayRefTheta(alliance: Alliance): number {
  return fieldColliders3d().trays[alliance].refTheta ?? 0;
}

export interface CadHiveBox extends FieldCellBox {
  /** the angle at which this box's `(vMin..wMax)` numbers are the true extent relative to the
   * pivot — 0 on both paths now (the CAD tray is exported un-tilted, the algebraic fallback is
   * theta-independent by construction). Kept so `derive.ts` and the smoke lane have a named
   * thing to assert rather than an assumed zero. */
  readonly refTheta: number;
}

/**
 * The CAD cell interior for one hive's cell, in the canonical (un-rotated) local frame, straight
 * off `trays[a].cells` — which `convert.py` measured from the structural facet PLANES themselves
 * (floor top surface, gable apex, side walls, back plate), not from the exported hulls. Reading
 * it back off a hull would be wrong twice over: a slab's points carry its own 1.5-in outward
 * extrusion, and the roof is a gable whose lowest point is the eaves, not the ceiling.
 *
 * `null` when the collider set has no cell for this side (the algebraic fallback then applies —
 * see `sim3d/bodies.ts`'s `hiveCellLocalBox`).
 */
export function cadCellBox(alliance: Alliance, sideSign: 1 | -1): CadHiveBox | null {
  const cell = fieldColliders3d().trays[alliance].cells?.[sideSign > 0 ? 'north' : 'south'];
  if (!cell) return null;
  return { ...cell, refTheta: cadTrayRefTheta(alliance) };
}

// THE PERIMETER WALL IS NOT IN THIS FILE AT ALL ANY MORE.
//
// It never was a collider — the 3D walls are analytic cuboids at `BB_HALF_X`/`BB_HALF_Y`/
// `BB3_WALL_H` (owner rule; the CAD's own inner face is ±70.674 against the constants' 72, and
// every other system — the 2D pipeline, the staging, the start poses flush to the wall — is keyed
// to 72, so a 3D wall at the CAD figure would be cross-physics drift rather than a correction).
// It was exported anyway so a `cadWallExtents()` reader could REPORT the gap, and nothing at
// runtime ever called it: `field-colliders.json` is compiled into `fieldColliders.gen.ts` and
// imported STATICALLY by `step.ts`, so those four hulls were shipping in the MAIN client bundle to
// be read by a smoke check. The measurement now lives in `field-measurements.json`'s
// `walls.innerFace`, which the SIM3D lane reads directly — see `docs/biobuzz/field-cad-audit.md`
// §7 for the finding itself.
