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
 * NOT YET WIRED — no game code imports `fieldColliders3d()` yet (`sim3d/bodies.ts`, still
 * constants-built, is the file that will call it once the CAD set is authoritative — see the
 * report's "what remains" section). This file and `.gen.ts` are self-contained.
 */

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
