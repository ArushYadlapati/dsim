import * as THREE from 'three';
import type { MeshDetail } from '../graphics/settings';
import { BB_HALF_X, BB_TILE_SEAMS } from '../config';

/**
 * THE FIELD MAT'S SURFACE — what a FIRST Tech Challenge soft tile actually looks like, at the
 * higher graphics settings (owner, 2026-09-21: "For higher graphics settings, have proper
 * texture and the proper pattern of the field tile (where two tiles meet). More accurate colour
 * would be good too").
 *
 * ⚠️ **THIS FILE IS THE MAT'S SKIN AND NOTHING ELSE.** It moves no geometry, it is imported by
 * `renderField.ts` alone, and every number in it is painted into a texture. The field is
 * authoritative and the sim never sees any of this.
 *
 * ── WHAT THE TILE IS, MEASURED OFF THE SHA-PINNED FIELD STEP ────────────────────────────────
 * Not invented and not taken from a photograph: the same CAD `npm run field-cad` already reads
 * (`docs/biobuzz/field-cad-audit.md`). The part is **`am-2499: FIRST Tech Challenge Field Soft
 * Tiles`**, and the field carries **36 of them, in three variants** — measured over every
 * instance, plan bbox in inches:
 *
 *   | variant            | n  | plan bbox       | what that means                       |
 *   |--------------------|----|-----------------|---------------------------------------|
 *   | `am-2499-Center`   | 16 | 24.313 × 24.313 | toothed on all FOUR edges             |
 *   | `am-2499-Side`     | 16 | 24.313 × 23.986 | three toothed edges, one STRAIGHT     |
 *   | `am-2499-Corner`   |  4 | 23.986 × 23.986 | two toothed edges, two STRAIGHT       |
 *
 * — which is the whole of why the tiled field measures exactly 141.1696 in (6 × `TILE_PITCH`
 * 23.5283) with nothing poking past it: **the PERIMETER edge of the mat is straight, and only
 * the interior seams are toothed.** `tileSeamPolyline` below draws it that way.
 *
 * ⚠️ **THE INTERLOCK IS A SQUARE CASTELLATION, NOT A ROUND JIGSAW LOBE, AND THE TILES ARE ALL
 * LAID THE SAME WAY ROUND.** Measured off the tessellated top face of one tile (506 outline
 * points over one edge, half-amplitude crossings): a 50 %-duty square wave, **period 2.369 in,
 * half-amplitude 0.405 in**, ten teeth to an edge, with the corners broken by a ~0.14-in
 * fillet. Because the tabs sit on a tile's edges in a pattern that mates with its own
 * translation, every tile in the array is at the SAME orientation — there is no alternating
 * 90° lay here. That matters: a grain painted to flip tile-to-tile would be drawing a field
 * this game does not have.
 *
 * KNOWN RESIDUAL, stated rather than widened away: the CAD edge is not a perfect square wave
 * end to end. It is point-symmetric about the tile centre and the two innermost transitions
 * collapse into a short half-tooth (measured: a 0.779-in gap and a 0.779-in tooth against the
 * regular 1.185, then a 0.406-in gap, at x 11.38…13.34 of a 23.99-in edge). That is one
 * 0.4-in feature in two feet, it is invisible at any camera this game has, and reproducing it
 * would mean shipping a transition table for a mould artefact. The wave here is regular.
 *
 * ── THE COLOUR ──────────────────────────────────────────────────────────────────────────────
 * A foam tile is NEUTRAL GREY. The shipped 2D pair (`#23262b` / `#2c3038`) is a blue-grey at
 * hue ≈ 218° — that is DECODE's mat, not this one's — and it is also near-black, which a tile
 * is not. Both were corrected here; `TILE_MAT` carries the measurement that says how far.
 * The 2D tokens are UNCHANGED, and that is deliberate (see `TILE_MAT`).
 */

// ─────────────────────────────────────────────────────────────────────────── the tier ladder ──

/** `flat` is exactly what shipped before this file existed; `tiles` is the measured mat. */
export type BbTileDetail = 'flat' | 'tiles';

/**
 * WHICH LEVEL A DEVICE GETS. Same shape of answer as `bbVenueDetail`/`bbWheelDetail` — read off
 * a dial that already exists, because §4.4's table has no room for an eighteenth row and this
 * does not need one.
 *
 * ⚠️ IT READS `meshDetail` ALONE, and that is not a shortcut: `meshDetail` is the ONE value
 * `createBiobuzzScene` hands `buildBiobuzzField` (the field is built before the scene object
 * exists, so there is no `tier` to read there), and it is already resolved against the fixed
 * tier an EXPORT runs at. §4.4 has `meshDetail: 'low'` on the Low column alone, so this is the
 * same Low/everything-else split the venue makes, reached without a new argument.
 */
export function bbTileDetail(meshDetail: MeshDetail): BbTileDetail {
  return meshDetail === 'low' ? 'flat' : 'tiles';
}

/** floor-texture edge, in texels. The seam's half-amplitude is 0.405 in — at the flat tier's
 * 1024 (7.24 px/in) that is under 3 px and a castellation would read as a wobble; 2048 puts it
 * at 5.9 px and the tooth period at 34. 2048² RGBA + mips is ~22 MB, against ~5.6 at 1024. */
export const TILE_TEX_SIZE: Record<BbTileDetail, number> = { flat: 1024, tiles: 2048 };

// ──────────────────────────────────────────────────────────────── the measured tile geometry ──

/** the interlock, measured (see the header): a 50 %-duty square wave along every interior edge. */
export const BB_TILE_TOOTH = {
  /** in, crossing-to-crossing along an edge. */
  period: 2.369,
  /** in, the tab's projection past the nominal seam line (half the 0.810-in peak-to-peak). */
  amplitude: 0.4052,
  /** in — the CAD's broken corner. Delivered by the stroke's round join, not modelled. */
  fillet: 0.14,
  /** teeth on one 23.99-in edge. */
  perEdge: 10,
} as const;

/**
 * THE MAT AND ITS SEAM LINE — NEUTRAL GREY, AND LIGHT, WHICH IS WHAT A REAL TILE IS.
 *
 * SOURCED: AndyMark **am-2499**, the part this file's interlock is measured from, ships a 2 ft
 * x 2 ft x 5/8 in EVA foam tile whose published specification colour is simply **"Gray"**, and
 * FTC lays it **smooth side up** (the vendor's own setup note — which is also why the grain
 * here is a fine isotropic speckle and not a rib: the textured face is the one against the
 * floor). ⚠️ **NO HEX IS PUBLISHED ANYWHERE**, and the field CAD carries a placeholder
 * `808080`, so the HUE is sourced and the LUMINANCE is JUDGED — said plainly here rather than
 * dressed up as a measurement.
 *
 * ⚠️ **THIS USED TO BE NEAR-BLACK (`#262626`) AND THE REASON WAS THE DRIVER LABEL, NOT THE
 * TILE.** `contrast.mjs` measured the label's fill against the lightest ground it crosses, so
 * the mat was the ceiling on that pair and a single step lighter failed AA at 4.27:1. Making
 * `LABEL_STROKE` (`render/renderer.ts`) OPAQUE moved the governing pair to
 * fill-against-its-own-stroke, which does not move when the field does — and that ceiling
 * went with it.
 *
 * ⚠️ **BUT A SECOND CEILING WAS UNDERNEATH IT, AND IT IS THE ONE THAT SETS THIS VALUE.**
 * The on-field HUD tokens are canvas text over whatever the field is, and they are tuned for
 * a dark one (CLAUDE.md: “its ground is the CANVAS … the field is hardcoded dark”). MEASURED
 * against `--ds-on-field-dim` (#b9beb8) at the AA floor of 4.5:
 *
 *     mat        on-field   on-field-dim   on-field-accent
 *     #3a3a3a      10.86         6.02            4.63
 *     #454545       9.15         5.08            3.90
 *     #585858       6.79         3.77 ✗          2.89 ✗
 *
 * So **#585858 was tried and backed out**: it is closer to a real tile and it puts canvas
 * text under AA. #454545 is the lightest grey at which every on-field TEXT token still
 * clears 4.5 (`-accent` is a focus ring, non-text, and clears its own 3:1 floor at 3.90).
 * Going lighter than this is not a tile question any more — it is a re-tune of the whole
 * `--ds-on-field*` family, and it wants to be asked as that.
 *
 * ⚠️ **3D ONLY. `COLORS.mat`/`COLORS.tile` ARE UNTOUCHED**, because those are the 2D canvas
 * field for all three games (`render/drawField.ts`, `games/chain/drawField.ts`,
 * `games/biobuzz/drawField.ts`, and the builder preview). The owner asked for this "for higher
 * graphics settings"; repainting DECODE's and Chain Reaction's 2D boards is not that.
 */
export const TILE_MAT = '#454545';
/**
 * THE SEAM'S LIGHT LIP — and it takes the SAME AA FLOOR the mat does, because it is ground a
 * glyph can sit on just as much as the mat is. It is only a hairline, but `--ds-on-field-dim`
 * is unstroked canvas text and a hairline under a stem is exactly where a thin glyph goes.
 *
 * ⚠️ MEASURED, THAT IS WHAT CAPS IT, AND IT CAPS IT TIGHTER THAN THE MAT. `#565656` reads
 * **3.89:1** against `--ds-on-field-dim` and failed; `#4c4c4c` is the LIGHTEST neutral that
 * still clears 4.5 (4.55:1). The lip therefore sits only ~7 steps over the mat rather than
 * ~17, and the seam keeps its weight from the GROOVE below, which has all the headroom
 * downward.
 */
export const TILE_LINE = '#4c4c4c';
/** the groove the seam sits in: DARKER than the mat, so it can only widen a `contrast.mjs`
 * ratio — nothing measured there is ever compared against a ground below `COLORS.mat`. */
export const TILE_GROOVE = '#333333';

/**
 * Stroke widths, in INCHES (the caller converts with its own texels-per-inch).
 *
 * ⚠️ THE LIGHT LIP IS THE SEAM AND THE GROOVE IS ITS SHADOW, not the other way round. The first
 * pass had it backwards — a 0.26-in dark groove under a 0.10-in lip — and the capture is
 * unambiguous: the mat's grid, which the shipped field reads clearly at chase range, essentially
 * DISAPPEARED. A dark line on a mat at WCAG luminance 0.019 has almost nowhere to go, while the
 * lip has all the headroom up to `COLORS.tile`. So the lip keeps the weight the shipped 2-px
 * line had at 1024 (0.276 in) and the groove is a wider, softer halo under it, which is what
 * turns a drawn grid into a seam with a depth to it.
 */
export const TILE_GROOVE_W = 0.44;
export const TILE_LINE_W = 0.24;

/**
 * THE SEAM PATH between two tile corners, as world-inch points — a PURE function, so the render
 * lane measures the real polyline instead of grepping for one.
 *
 * `at` is the seam's own coordinate, `a`→`b` the run along it (one cell of `BB_TILE_SEAMS`), and
 * `axis` says which world axis `at` is on: `'x'` is a seam running along y, `'y'` one along x.
 *
 * ⚠️ THE PERIOD IS STRETCHED TO FIT THE CELL, never truncated. The CAD's seam spacings are NOT
 * uniform (23.176…23.986, `fieldDims.gen.ts`), so an absolute 2.369-in period walked from the
 * field edge would leave a part-tooth straddling a tile corner — which is the one thing that
 * reads as a mistake rather than as a tile. `n` is the nearest whole number of periods to the
 * cell's own span, and the period used is `span / n`: at the extremes that is 2.318…2.399,
 * within 1.3 % of the measurement.
 *
 * The phase is anchored so the cell's CENTRE is the centre of a gap, which is where the CAD
 * puts it (its own centre gap is measured at 11.377…12.156 of a 23.99-in edge, centred 11.766).
 */
export function tileSeamPolyline(at: number, a: number, b: number, axis: 'x' | 'y'): [number, number][] {
  const span = b - a;
  const n = Math.max(1, Math.round(span / BB_TILE_TOOTH.period));
  const p = span / n;
  const c = (a + b) / 2;
  const A = BB_TILE_TOOTH.amplitude;
  // transitions at c + p*(0.25 + k/2), clipped to the cell
  const ts: number[] = [];
  const kMin = Math.ceil(((a - c) / p - 0.25) * 2);
  const kMax = Math.floor(((b - c) / p - 0.25) * 2);
  for (let k = kMin; k <= kMax; k++) {
    const t = c + p * (0.25 + k / 2);
    if (t > a + 1e-9 && t < b - 1e-9) ts.push(t);
  }
  /** high (tab toward +at) on frac((t−c)/p + 0.75) < 0.5 — so the gap straddles the centre. */
  const high = (t: number): boolean => {
    const f = (((t - c) / p + 0.75) % 1 + 1) % 1;
    return f < 0.5;
  };
  const pt = (along: number, dev: number): [number, number] => (axis === 'x' ? [at + dev, along] : [along, at + dev]);
  const out: [number, number][] = [];
  let cursor = a;
  for (const t of ts) {
    const d = high((cursor + t) / 2) ? A : -A;
    out.push(pt(cursor, d));
    out.push(pt(t, d));
    cursor = t;
  }
  const d = high((cursor + b) / 2) ? A : -A;
  out.push(pt(cursor, d));
  out.push(pt(b, d));
  return out;
}

/** a straight seam, as the same shape of polyline — the PERIMETER edge of the mat, which the
 * `-Side`/`-Corner` variants really do cut straight (see the header's table). */
export function straightSeamPolyline(at: number, a: number, b: number, axis: 'x' | 'y'): [number, number][] {
  return axis === 'x' ? [[at, a], [at, b]] : [[a, at], [b, at]];
}

/** every seam of the mat, in draw order, as `{ points, interior }`. The two OUTER lines of
 * `BB_TILE_SEAMS` are the mat's own edge at the wall and are straight; the five interior ones
 * are the interlock. */
export function tileSeamPaths(detail: BbTileDetail): { points: [number, number][]; interior: boolean }[] {
  const seams = BB_TILE_SEAMS;
  const lo = seams[0];
  const hi = seams[seams.length - 1];
  const out: { points: [number, number][]; interior: boolean }[] = [];
  for (const axis of ['x', 'y'] as const) {
    for (let i = 0; i < seams.length; i++) {
      const interior = i > 0 && i < seams.length - 1;
      if (!interior || detail === 'flat') {
        out.push({ points: straightSeamPolyline(seams[i], lo, hi, axis), interior: false });
        continue;
      }
      // one run per CELL along the seam, so a tooth never straddles a tile corner
      for (let j = 0; j < seams.length - 1; j++) {
        out.push({ points: tileSeamPolyline(seams[i], seams[j], seams[j + 1], axis), interior: true });
      }
    }
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────── per-tile variation ──

/** DETERMINISTIC per-tile noise — the same field on every machine and in every exported frame.
 * Same hash `renderVenue.ts`'s crowd and `renderEnvironment.ts`'s stars use. */
function tRand(i: number): number {
  let t = (i * 0x9e3779b1) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * A REAL FIELD IS 36 MATS, NOT A SHEET, and the second-biggest reason it reads that way (after
 * the seam) is that no two of them are the same tone — foam takes scuffs and takes them per
 * tile. This is a 0…−8 % multiplier on the mat, deterministic in the tile's own grid index.
 *
 * ⚠️ DOWNWARD ONLY. `TILE_MAT` is the measured ceiling (see its own note) and a jitter that
 * could go UP is a jitter that could quietly walk a measured pair past its floor without
 * anything failing. Nothing this paints is ever lighter than `TILE_MAT`.
 *
 * ⚠️ AND IT LANDS ON A HANDFUL OF VALUES, NOT THIRTY-SIX — that is 8-BIT sRGB, not a weak
 * hash. The mat is `0x45`, so 0…−8 % spans 63.6…69 and every tile rounds into one of seven
 * steps; 36 tiles drawn from seven buckets will usually miss one. The RENDER lane DERIVES the
 * count from the base rather than pinning it, because it is a property of where on the ramp
 * the mat sits — at the old near-black `0x26` there were only four.
 */
export function tileTone(ix: number, iy: number): string {
  const f = 1 - 0.08 * tRand(ix * 131 + iy * 7919 + 17);
  const base = parseInt(TILE_MAT.slice(1, 3), 16);
  const v = Math.max(0, Math.min(255, Math.round(base * f)));
  const h = v.toString(16).padStart(2, '0');
  return `#${h}${h}${h}`;
}

// ───────────────────────────────────────────────────────────────────── the fine foam surface ──

/**
 * THE GRAIN, as a REPEATING normal + roughness pair rather than more albedo texels.
 *
 * ⚠️ IT IS A SEPARATE TEXTURE ON PURPOSE. The floor's `map` is ONE canvas over the whole
 * 141.35-in field — at 2048 that is 14.5 texels to the inch, which is plenty for a 2.37-in
 * tooth and nowhere near enough for the fine cell structure of a foam mat. Three gives every
 * map slot its own UV transform (r151+), so these two tile at their own, much finer, pitch:
 * `TILE_GRAIN_REPEAT` per field edge, which is four periods to a tile, 43 texels to the inch.
 *
 * ⚠️ AND IT CARRIES NO COLOUR. `MeshStandardMaterial` multiplies `color` by `map`, so a tint
 * that arrives twice comes out squared and nearly black — the venue's ground shipped exactly
 * that bug once. The albedo is the floor canvas and nothing else; this is relief and sheen.
 *
 * The CAD cannot settle what the grain looks like and this file does not pretend it can: the
 * STEP's tile is a dead-flat extrusion (measured — every one of its 3,894 top vertices is on
 * one plane, and there is not a single interior loop in the top face, so there is no rib and no
 * perforation in it at all). So this is a fine isotropic speckle, which is the honest reading of
 * a moulded EVA mat, and NOT a directional grain — a direction is exactly the thing that would
 * be a guess, and the tiles are all laid the same way round anyway, so it could not even be
 * checked against the alternation a grained field would show.
 */
export const TILE_GRAIN_TEX = 256;
/** periods across one field edge — 6 tiles × 4 = 24, i.e. a WHOLE number of periods per tile,
 * in phase on every one. That is the physical answer rather than a convenience: the 36 tiles are
 * identical translated copies of one moulding, so a repeat that did NOT divide the grid would
 * drift the grain across the field and read as a texture laid over the mat instead of as the
 * mat's own surface. */
export const TILE_GRAIN_REPEAT = 24;
/** how hard the relief reads. A mat is matte and shallow; this is not sandpaper. */
export const TILE_GRAIN_NORMAL_SCALE = 0.28;

export interface BbTileGrain {
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

/** value noise on a `TILE_GRAIN_TEX` torus — tiles seamlessly because every lattice index is
 * taken modulo the grid. */
function grainField(grid: number, seed: number): (u: number, v: number) => number {
  const at = (i: number, j: number): number => tRand((((i % grid) + grid) % grid) * 92837 + (((j % grid) + grid) % grid) * 689287 + seed);
  return (u, v) => {
    const x = u * grid;
    const y = v * grid;
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(i, j);
    const b = at(i + 1, j);
    const c = at(i, j + 1);
    const d = at(i + 1, j + 1);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  };
}

/**
 * Builds the pair. Returns `null` on the flat tier and on any environment without a real 2D
 * context (the smoke lanes' canvas stub, a browser that refuses one) — the caller then ships the
 * floor it always shipped, which is the same bargain `buildBiobuzzField`'s CAD fallback makes.
 */
export function buildTileGrain(detail: BbTileDetail): BbTileGrain | null {
  if (detail === 'flat') return null;
  try {
    const n = TILE_GRAIN_TEX;
    const canvas = document.createElement('canvas');
    canvas.width = n;
    canvas.height = n;
    const ctx = canvas.getContext('2d');
    const img = ctx?.createImageData?.(n, n);
    if (!ctx || !img || !img.data) return null;
    const rough = document.createElement('canvas');
    rough.width = n;
    rough.height = n;
    const rctx = rough.getContext('2d');
    const rimg = rctx?.createImageData?.(n, n);
    if (!rctx || !rimg || !rimg.data) return null;

    // two octaves: the coarse one is the mat's own cell structure, the fine one its sheen
    const f1 = grainField(32, 1);
    const f2 = grainField(96, 2);
    const h = (u: number, v: number): number => 0.65 * f1(u, v) + 0.35 * f2(u, v);
    const e = 1 / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const u = x / n;
        const v = y / n;
        const hx = h(u + e, v) - h(u - e, v);
        const hy = h(u, v + e) - h(u, v - e);
        // tangent-space normal, flat = (128, 128, 255). The gain is picked against the measured
        // slope of this noise — a 32-cell lattice over 256 texels runs ~0.12 of height across
        // the two-texel central difference, so 220 puts a typical face around ±26 of 128 and
        // only the steepest cell walls approach ±60. (The first spelling folded `n · e` and a
        // stray 40 into it, which is 4800 and saturates every texel to a hard black/white
        // crease — a normal map that is all cliff reads as crumpled foil, not as foam.)
        const o = (y * n + x) * 4;
        img.data[o] = Math.max(0, Math.min(255, Math.round(128 - hx * 220)));
        img.data[o + 1] = Math.max(0, Math.min(255, Math.round(128 - hy * 220)));
        img.data[o + 2] = 255;
        img.data[o + 3] = 255;
        // roughness: a mat is matte everywhere; the noise only breaks the sheen up, and it
        // MULTIPLIES the material's own `roughness`, so the map never makes anything glossier
        // than the value the material already carries.
        const r = Math.max(0, Math.min(255, Math.round(214 + h(u, v) * 41)));
        rimg.data[o] = r;
        rimg.data[o + 1] = r;
        rimg.data[o + 2] = r;
        rimg.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    rctx.putImageData(rimg, 0, 0);

    const mk = (c: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture => {
      const t = new THREE.CanvasTexture(c);
      // a normal map and a roughness map are DATA, never colour — an sRGB decode on either is
      // the classic "why is my lighting wrong" bug.
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(TILE_GRAIN_REPEAT, TILE_GRAIN_REPEAT);
      t.anisotropy = 4;
      return t;
    };
    return { normalMap: mk(canvas, false), roughnessMap: mk(rough, false) };
  } catch {
    return null;
  }
}

/** the field's own plan span, for a caller that wants the grain's world pitch in inches. */
export const TILE_GRAIN_PITCH_IN = (2 * BB_HALF_X) / TILE_GRAIN_REPEAT;
