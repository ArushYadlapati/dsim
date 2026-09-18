/**
 * BIOBUZZ field colliders — DOM-free, server-safe reader over the CAD-derived collider set
 * (`docs/biobuzz/plan-3d.md` §8; `public/models/biobuzz/field-colliders.json`, produced by
 * `scripts/field-cad/convert.py`, README next to it documents the schema and how to
 * regenerate).
 *
 * NOT a JSON import: `tsconfig.json` has no `resolveJsonModule`, and its `include: ["src"]`
 * makes every file under `src/` a compilation ROOT rather than only files reachable from an
 * entry point, so a bare JSON import here would fail `npm run build`'s `tsc` step. Instead this
 * reads the GENERATED `fieldColliders.gen.ts` (a plain typed module `scripts/field-cad.mjs`
 * writes from the same JSON every `npm run field-cad`), which needs no compiler flag at all.
 *
 * WIRED (the CAD switch-over pass): `sim3d/bodies.ts`'s `buildStatics3d`/`buildHiveTray3d` and
 * `hiveCellLocalBox` read `cadWallExtents()`/`cadTrayHulls()`/`cadCellBox()` (below) behind the
 * `BB3_FIELD_COLLIDERS` switch (`config.ts`), falling back to the Day 1 analytic geometry per
 * part when the CAD set is missing it.
 */

import type { Alliance } from '../../../types';
import { BB_HIVE_TILT_DEG, BB_HIVE_UP_STAGED } from '../config';
import { FIELD_COLLIDERS_JSON } from './fieldColliders.gen';

export type FieldStaticKind = 'trimesh';

export interface FieldStatic {
  readonly name: string;
  readonly kind: FieldStaticKind;
  /** flat [x0,y0,z0, x1,y1,z1, ...], inches, sim frame */
  readonly vertices: readonly number[];
  /** flat [a0,b0,c0, a1,b1,c1, ...] triangle indices into `vertices` */
  readonly indices: readonly number[];
}

export interface FieldTrayHull {
  readonly name: string;
  /** flat [x0,y0,z0, ...], inches, RELATIVE TO THE TRAY'S OWN PIVOT (see `FieldTray.pivot`) */
  readonly points: readonly number[];
}

export interface FieldTray {
  /** [x, y, z] in inches, sim frame — the hive's pivot, world-absolute */
  readonly pivot: readonly [number, number, number];
  /** the tilt axis, in the tray's own (pivot-relative) frame */
  readonly axis: readonly [number, number, number];
  readonly hulls: readonly FieldTrayHull[];
}

export interface FieldFlowerDesc {
  readonly id: string;
  readonly wall: 'left' | 'rear' | 'right' | 'audience';
  /** [x, y] in inches, sim frame — matches `BB_FLOWERS` */
  readonly pos: readonly [number, number];
  /** the `statics[].name` entries that are this flower's SOLID support (backstop/pipes/
   * brackets/base) — the ring plates are visual-only, see convert.py's `RE_FLOWER_RING`. */
  readonly staticNames: readonly string[];
  /** the glTF node name for this flower's visual mesh (`field.glb` / `field-low.glb`) */
  readonly visualNode: string;
}

export interface FieldColliders {
  readonly units: 'in';
  readonly frame: 'sim';
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

/** signed-ish distance from `p` to an AABB: 0 (or negative-feeling, but clamped to 0) when
 * inside, the Euclidean distance to the nearest face/edge/corner otherwise. */
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
  /** the nearest static's name, or a tray hull's `hive_red`/`hive_blue` id, or null if the
   * collider set has nothing at all (e.g. the CAD import never ran) */
  readonly nearestName: string | null;
  /** APPROXIMATE distance (inches) to that static's/tray's AXIS-ALIGNED BOUNDING BOX — a
   * deliberate simplification (see the header): a true point-to-trimesh distance needs a BVH
   * this DOM-free, dependency-free module does not carry, and an AABB is exactly conservative
   * enough for the smoke check this feeds (`docs/biobuzz/plan-3d.md` §8/§9: comparing the CAD
   * and constants-built collider sets within 0.5 in at twelve probe points is a coarse
   * agreement check, not a collision-accuracy one). A probe point genuinely embedded in a
   * concave static's real geometry but outside its AABB is impossible by construction, so
   * this never UNDER-reports "outside"; it can only be more generous than the true surface. */
  readonly distance: number;
}

/**
 * For each `points` triple, the nearest static (by AABB) or tray hull, and the (approximate,
 * see `ProbeResult`) distance to it. Pure, DOM-free — the smoke lane that compares this
 * collider set against the constants-built one calls this directly.
 */
export function probeColliders(points: readonly (readonly [number, number, number])[]): ProbeResult[] {
  const fc = fieldColliders3d();
  const named: { name: string; box: Aabb }[] = [];
  for (const s of fc.statics) named.push({ name: s.name, box: aabbOfFlat(s.vertices) });
  for (const [alliance, tray] of [
    ['hive_red_tray', fc.trays.red],
    ['hive_blue_tray', fc.trays.blue],
  ] as const) {
    for (const h of tray.hulls) {
      // hull points are pivot-relative; shift to world/sim frame before boxing
      const world = h.points.map((v, i) => v + tray.pivot[i % 3]);
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
// THE CAD SWITCH-OVER (`docs/biobuzz/plan-3d.md` §8, this pass): the tray hull frame, the cell
// interior box derived from it, and the wall extents used by `sim3d/bodies.ts`. Everything below
// is new; `fieldColliders3d()`/`probeColliders()` above are unchanged.
// ---------------------------------------------------------------------------------------------

/**
 * THE TRAY HULLS' CAPTURE POSE.
 *
 * `field-colliders.json`'s `trays[a].hulls[].points` are pivot-relative but are NOT true tight
 * oriented hulls of the tray's parts: `scripts/field-cad/convert.py`'s `tray_hulls()` builds each
 * one from `bbox_corners_sim(inst)`, an AXIS-ALIGNED bounding box of the part IN THE FINAL SIM
 * FRAME — i.e. already flattened to whatever pose the STEP assembly's tray happens to sit at, not
 * a rotation-invariant local shape. Checked against the sign of each cell's z relative to the
 * pivot (red: `cell_south_*` reads POSITIVE by about `2·BB3_HIVE_ARM·sin(30°)`, `cell_north_*`
 * NEGATIVE by the same amount; blue: the opposite), that pose is the STAGED tilt
 * (`BB_HIVE_UP_STAGED`, ±`BB_HIVE_TILT_DEG`) for THAT alliance — the pose `createBiobuzzWorld`
 * starts a match in.
 *
 * BECAUSE THE HULLS ARE AABBs, NOT ORIENTED SHAPES, ROTATING THEIR POINTS TO A DIFFERENT
 * REFERENCE ANGLE ONLY INFLATES THEM (an AABB rotated by any nonzero angle bounds a strictly
 * larger region than the AABB itself) — an early version of this file pre-rotated every point
 * into a hoped-for "canonical, un-rotated" frame and made every cell box materially bigger than
 * the raw CAD data (measured: a cell's own `v`-span grew from ~18 to ~26 for no physical reason).
 * So the points are used EXACTLY AS CAPTURED — tight at the one pose the CAD actually describes —
 * and the CAPTURE TILT is applied as a fixed ROTATION ON THE COLLIDER ITSELF (`buildHiveTray3d`
 * sets each CAD hull collider's own local rotation to `tiltQuatX(-cadCaptureTheta(alliance))`),
 * so that composing it with the kinematic BODY's live rotation (`tiltQuatX(hiveTiltAngle(...))`)
 * reproduces the true captured pose exactly when the body is at its staged tilt, and rotates the
 * same (now slightly loose, since it is still an AABB) hull the rest of the way for any other
 * tilt. `derive.ts`'s cell-membership test does the matching inverse (`hiveCellLocalBox`'s
 * `refTheta` field) — see that function's own comment.
 */
export function cadCaptureTheta(alliance: Alliance): number {
  const sign = BB_HIVE_UP_STAGED[alliance] === 'north' ? 1 : -1;
  return sign * ((BB_HIVE_TILT_DEG * Math.PI) / 180);
}

/**
 * ⚠️ THE "SIDE" HULLS ARE EXCLUDED, HERE, FOR EVERY CALLER (both the physics collider and the
 * cell-membership box below) — found by measurement, not assumed: `cell_north_side_pos` (this
 * dataset has only a `_pos` bucket per cell, not the "two ribs, split by +/-x" pair
 * `scripts/field-cad/convert.py`'s own comment describes, so it is not "one side wall" either)
 * spans the CELL'S FULL WIDTH in x (not one edge) and reaches ~3.5 in PAST the floor's own outer
 * (open-face) edge in v -- i.e. it is bracing/gusset hardware bundled into one hull bucket, not a
 * clean side-wall panel. Built as a real collider, that overreach sits exactly in a shot's
 * arrival path at the cell mouth: a shot staged just outside the floor's own opening (the
 * geometrically correct "just outside the cell" position) lands INSIDE this hull instead,
 * and Rapier's contact solver, resolving a deep initial penetration, hands it a spurious
 * ~600 in/s vertical velocity on the very first tick -- the SIM3D lane's launch check never
 * settled because of exactly this. `back`/`floor`/`ceiling`/`bar` show no such overreach (each
 * is a clean box matching its own named part) and are unaffected.
 */
function usableHulls(alliance: Alliance): readonly FieldTrayHull[] {
  return fieldColliders3d().trays[alliance].hulls.filter((h) => !/_side_/.test(h.name));
}

/** every CAD hull for one hive's tray, AS CAPTURED (see `cadCaptureTheta`'s comment on why these
 * are not pre-rotated), minus the "side" buckets (`usableHulls`'s own comment) — ready for
 * `RAPIER.ColliderDesc.convexHull` once the collider itself carries the
 * `-cadCaptureTheta(alliance)` rotation offset. Empty when the collider set carries no hulls for
 * this alliance (defensive; the committed file always has both today). */
export function cadTrayHulls(alliance: Alliance): readonly FieldTrayHull[] {
  return usableHulls(alliance);
}

export interface CadHiveBox {
  readonly xHalf: number;
  readonly vMin: number;
  readonly vMax: number;
  readonly wMin: number;
  readonly wMax: number;
  /** the angle (radians) `hiveTiltAngle` reads AT WHICH this box's `(vMin..wMax)` numbers are
   * the true world-relative-to-pivot extent — 0 for the Day 1 algebraic fallback (whose numbers
   * are already defined in the theta-independent local frame), `cadCaptureTheta(alliance)` for a
   * CAD box (captured at that specific tilt; see the module header). `insideCell` (`derive.ts`)
   * reads it to convert a WORLD point into this box's own frame: `rotate2(dy, dz, refTheta -
   * theta)` rather than the fixed `rotate2(dy, dz, -theta)` a theta-independent box would use. */
  readonly refTheta: number;
}

function hullExtent(h: FieldTrayHull): { xAbs: number; vMin: number; vMax: number; wMin: number; wMax: number } {
  let xAbs = 0;
  let vMin = Infinity;
  let vMax = -Infinity;
  let wMin = Infinity;
  let wMax = -Infinity;
  for (let i = 0; i < h.points.length; i += 3) {
    const x = h.points[i];
    const v = h.points[i + 1];
    const w = h.points[i + 2];
    if (Math.abs(x) > xAbs) xAbs = Math.abs(x);
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
    if (w < wMin) wMin = w;
    if (w > wMax) wMax = w;
  }
  return { xAbs, vMin, vMax, wMin, wMax };
}

/**
 * The CAD cell interior for one hive's cell, in the canonical (un-rotated) local frame.
 * `null` when the collider set has no `floor` hull for this cell (the box-based fallback then
 * applies — see `sim3d/bodies.ts`'s `hiveCellLocalBox`).
 *
 * `vMin`/`vMax` (the cell's DEPTH — where an element can actually come to rest along the arm)
 * COME FROM THE `floor` HULL ALONE, not the union of every part named for this cell. Found by
 * measurement: the `back` hull's own v-extent reaches ~3.5 in closer to the pivot than the floor
 * plate's real inner edge (it bundles the back panel with adjoining bracket hardware, the same
 * "AABB of more than one part" issue `cadTrayHulls`'s header describes for `side` — just smaller
 * here), and a `back`-driven `vMin` sends the pivot-side few inches of the box into a region with
 * NO floor beneath it — a shot deliberately dropped there in the SIM3D lane's hive-tip check
 * rolled straight through and never settled, because there was nothing physical to settle on.
 * `wMin`/`wMax` (the height — floor to ceiling) and `xHalf` (the width) still union
 * floor+back+ceiling, since a wall or ceiling genuinely reaching a little further than the floor
 * in THOSE axes does not create an unsupported gap the same way an inflated `back` does in `v`.
 */
export function cadCellBox(alliance: Alliance, sideSign: 1 | -1): CadHiveBox | null {
  const side = sideSign > 0 ? 'north' : 'south';
  const prefix = `cell_${side}_`;
  const hulls = cadTrayHulls(alliance).filter((h) => h.name.startsWith(prefix));
  const floor = hulls.find((h) => h.name.endsWith('_floor'));
  if (!floor) return null;
  const floorExtent = hullExtent(floor);
  let xHalf = 0;
  let wMin = Infinity;
  let wMax = -Infinity;
  for (const h of hulls) {
    const e = hullExtent(h);
    if (e.xAbs > xHalf) xHalf = e.xAbs;
    if (e.wMin < wMin) wMin = e.wMin;
    if (e.wMax > wMax) wMax = e.wMax;
  }
  return { xHalf, vMin: floorExtent.vMin, vMax: floorExtent.vMax, wMin, wMax, refTheta: cadCaptureTheta(alliance) };
}

interface Aabb3 {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

function staticAabb(name: string): Aabb3 | null {
  const s = fieldColliders3d().statics.find((x) => x.name === name);
  if (!s) return null;
  return aabbOfFlat(s.vertices) as Aabb3;
}

export interface CadWallExtents {
  /** inner-face (field-facing) coordinate of each wall, world/sim frame, inches. */
  readonly left: number;
  readonly right: number;
  readonly rear: number;
  readonly audience: number;
  /** wall height (in), averaged over the four walls' own trimesh extent. */
  readonly height: number;
  /** the lowest z of any wall's own geometry (in) — the floor line the collider's height is
   * built up from, which is not exactly 0 in the raw CAD data (the tile top has its own small
   * offset — see `field-measurements.json`'s `tiles_extent_in.z`). */
  readonly z0: number;
}

/** the four perimeter walls' inner faces and height, straight off their own trimesh vertices —
 * more precise than `field-measurements.json`'s `walls_extent_in` (that field averages each
 * wall PART's own centroid, not its true surface, so it reads the walls' approximate
 * CENTRELINE rather than a face). `null` when any of the four is missing from the collider set
 * (`sim3d/bodies.ts` falls back to `BB_HALF_X`/`BB_HALF_Y`/`BB3_WALL_H` in that case). */
export function cadWallExtents(): CadWallExtents | null {
  const l = staticAabb('wall_left');
  const r = staticAabb('wall_right');
  const rear = staticAabb('wall_rear');
  const aud = staticAabb('wall_audience');
  if (!l || !r || !rear || !aud) return null;
  const heights = [l, r, rear, aud].map((b) => b.max[2] - b.min[2]);
  const z0s = [l, r, rear, aud].map((b) => b.min[2]);
  return {
    left: l.max[0], // the face closer to x = 0 (the field side)
    right: r.min[0],
    rear: rear.min[1],
    audience: aud.max[1],
    height: heights.reduce((a, b) => a + b, 0) / heights.length,
    z0: z0s.reduce((a, b) => a + b, 0) / z0s.length,
  };
}
