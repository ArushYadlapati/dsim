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
    cachedStatics = squareFootBars(
      fieldColliders3d().statics.filter((s) => PHYSICAL_STATIC_CLASSES.has(s.class) && !ridesTray(s)),
    );
  }
  return cachedStatics;
}

let cachedStatics: readonly FieldStatic[] | null = null;

/** how far a part may poke out of a foot bar's box and still be folded into it (in). The feet
 * overhang their bar by 0.02 at most; the A-frame legs leave it by 39. */
const FOOT_FOLD_EPS = 0.05;

/**
 * ⚠️ THE HIVE'S FOOT ASSEMBLY IS ONE BOX, NOT A BAR AND TWO FEET (owner, 2026-09-20: "when I
 * strafe across while my front is flat with the support beam, I get stuck on a corner that does
 * not exist").
 *
 * The exporter emits the sheet-metal foot bar and the two frame feet bolted inside its ends as
 * three hulls, the feet's outer faces 0.11 in BEHIND the bar's. A chassis pressed against the bar
 * sits 0.09 in into it (contact skin plus the solver's allowed error), which is enough for its
 * leading corner to meet the buried foot's SIDE face — a contact whose normal is along the bar, so
 * the slide stops dead at y = 17.2 with nothing drawn there. Measured: mecanum, 0.8 push, 0.5
 * strafe, stuck at y 9.14 (leading edge 17.64) on the blue bar's +y foot. The 8-point decimation
 * also left the bar itself a wedge — its outer face 24.73 at one end and 24.62 at the other.
 *
 * So each bar becomes its own bounding box, grown to take in every frame part that lies inside it
 * (the feet), and those parts are dropped: one convex solid has no internal edge to catch on. The
 * box is what the drawn bar's silhouette is, to within the bevel on its top edge.
 */
function squareFootBars(statics: readonly FieldStatic[]): readonly FieldStatic[] {
  const bars = statics.filter((s) => s.name.endsWith('_sheet_metal_foot_bar'));
  if (bars.length === 0) return statics;
  const folded = new Set<FieldStatic>();
  const boxes = new Map<FieldStatic, Aabb>();
  for (const bar of bars) {
    const box = aabbOfFlat(bar.points);
    const min: [number, number, number] = [box.min[0], box.min[1], box.min[2]];
    const max: [number, number, number] = [box.max[0], box.max[1], box.max[2]];
    for (const s of statics) {
      if (s === bar || s.class !== bar.class || bars.includes(s)) continue;
      const b = aabbOfFlat(s.points);
      let inside = true;
      for (let k = 0; k < 3; k++) {
        if (b.min[k] < box.min[k] - FOOT_FOLD_EPS || b.max[k] > box.max[k] + FOOT_FOLD_EPS) inside = false;
      }
      if (!inside) continue;
      folded.add(s);
      for (let k = 0; k < 3; k++) {
        if (b.min[k] < min[k]) min[k] = b.min[k];
        if (b.max[k] > max[k]) max[k] = b.max[k];
      }
    }
    boxes.set(bar, { min, max });
  }
  const out: FieldStatic[] = [];
  for (const s of statics) {
    if (folded.has(s)) continue;
    const box = boxes.get(s);
    if (!box) {
      out.push(s);
      continue;
    }
    const pts: number[] = [];
    for (const x of [box.min[0], box.max[0]]) {
      for (const y of [box.min[1], box.max[1]]) {
        for (const z of [box.min[2], box.max[2]]) pts.push(x, y, z);
      }
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
