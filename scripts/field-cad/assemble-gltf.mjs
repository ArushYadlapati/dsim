#!/usr/bin/env node
// scripts/field-cad/assemble-gltf.mjs — assembles the per-group binary STL files convert.py
// wrote (`<cache>/stl/<level>/<node>__<finish>_<hex>.stl`) into ONE glTF document, with the
// node names/hierarchy the runtime loader (`src/games/biobuzz/scene/renderFieldGlb.ts`)
// expects: `tiles`, `walls`, `tape`, `stations`, `misc`, `hive_red/frame`, `hive_blue/frame`,
// `hive_shared/frame`, `hive_red/tray`, `hive_blue/tray`, `flower_0`..`flower_3`.
//
// ── MATERIALS CARRY THE CAD'S OWN COLOUR ────────────────────────────────────────────────
// Each STL file name ends in `<finish>_<hex>`, and this script makes ONE glTF material per
// distinct pair, NAMED `<finish>#<hex>` with `baseColorFactor` set from that hex. So the
// asset itself carries the colour FIRST measured out of the STEP's styled-item chain
// (`convert.py`'s `read_step_colours`, `docs/biobuzz/field-cad-audit.md` §3) instead of a
// placeholder picked here — which is the whole of the owner's "flowers are still the wrong
// color": the flower's amber top ring (#ffba52), green HIPS pipes (#5fa73d) and purple
// backstop (#641c65) were being painted three hand-chosen greys, in this file and again in
// the loader. `renderFieldGlb.ts` now reads the FINISH for the PBR parameters and the HEX for
// the colour, so a colour change in the CAD reaches the screen with no code edit at all.
//
// `FINISH` below is therefore about SURFACE, never about hue: roughness/metalness/alpha only.
//
// ── INSTANCING ──────────────────────────────────────────────────────────────────────────
// The four FLOWERS are related by an exact 90° rotation about the FIELD ORIGIN (verified
// against `BB_FLOWERS` — see `FLOWER_ROTATION_DEG` and the runtime cross-check against each
// flower's own tessellated bbox), so only `flower_0` (F1) is ever loaded; F2/F3/F4 are the
// SAME mesh referenced from three more nodes with a rotation transform. Hive red/blue are NOT
// instanced (their ribs carry genuinely different CAD colours).
//
// Deliberately zero manual vertex welding here: this script hands gltf-transform's own `weld`
// transform (invoked by the caller right after this writes the raw assembly) the STL's natural
// triangle-soup layout — every vertex duplicated per triangle, flat per-triangle normals —
// which is exactly the shape `weld` is designed to dedupe.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { MeshoptSimplifier } from 'meshoptimizer';

function parseBinaryStl(buf) {
  const triCount = buf.readUInt32LE(80);
  const positions = new Float32Array(triCount * 9);
  let offset = 84;
  for (let t = 0; t < triCount; t++) {
    offset += 12; // the STL's own flat facet normal — deliberately not kept, see the header
    for (let v = 0; v < 3; v++) {
      const vi = t * 3 + v;
      positions[vi * 3 + 0] = buf.readFloatLE(offset + 0);
      positions[vi * 3 + 1] = buf.readFloatLE(offset + 4);
      positions[vi * 3 + 2] = buf.readFloatLE(offset + 8);
      offset += 12;
    }
    offset += 2;
  }
  const indices = new Uint32Array(triCount * 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return { positions, indices, triCount };
}

function bboxOf(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

function quatZ(deg) {
  const half = (deg * Math.PI) / 360;
  return [0, 0, Math.sin(half), Math.cos(half)];
}

function rotateZ(p, deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
}

/** sRGB hex -> linear-light float triple. glTF's `baseColorFactor` is LINEAR; the CAD colours
 * (and every hex anyone reads off the audit) are sRGB, so skipping this makes every surface
 * read visibly washed out. */
function srgbHexToLinear(hex) {
  const n = parseInt(hex, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  return ch.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
}

/** SURFACE ONLY — no hue. `alpha < 1` also sets BLEND. `glass` is the polycarbonate perimeter
 * and any future driver-station panel; `decal` is a printed sticker or AprilTag plate (flat,
 * matte, no metal); `misc` is the loud default a part `convert.py` could not classify gets, so
 * an unknown part renders as an obviously-untuned surface rather than disappearing. */
const FINISH = {
  tile: { roughness: 0.92, metallic: 0.0 },
  glass: { roughness: 0.12, metallic: 0.0, alpha: 0.3 },
  metal: { roughness: 0.35, metallic: 0.7 },
  plastic: { roughness: 0.5, metallic: 0.05 },
  decal: { roughness: 0.85, metallic: 0.0 },
  tape: { roughness: 0.8, metallic: 0.0 },
  misc: { roughness: 0.6, metallic: 0.2 },
};

// ── DECIMATION HAPPENS HERE, PER PRIMITIVE, AGAINST AN ERROR BUDGET IN INCHES ────────────
// The caller used to run `gltf-transform simplify --ratio 0.06 --error 0.01` over the WHOLE
// document. A global ratio is the wrong instrument for an asset whose primitives span four
// orders of magnitude in triangle count: measured on the shipped `field.glb`, the 12-triangle
// tile box came out at FOUR triangles, and the 16 tape strips (192 tris) at 120. A 1-in gaffer
// line cannot survive a decimator whose error tolerance is a fraction of a 250-in mesh.
//
// So each primitive is simplified on its own, with an ABSOLUTE tolerance chosen for what that
// surface is: 0.004 in for tape (the strip is 1 in wide but only 0.010 in THICK, and a looser
// budget lets the decimator flatten it to a zero-thickness sheet — measured, 192 triangles went
// to 120 at a 0.05-in budget), 0.5 in for the tile slab, 0.25 in for the rest of the
// structure. meshoptimizer stops at whichever of {ratio, error} binds first, so a box that
// cannot be decimated within its budget simply stays a box — which is the whole point.
// `docs/biobuzz/field-cad-audit.md` §2.3 has the before/after triangle counts.
const SIMPLIFY_ERROR_IN = {
  tape: 0.004,
  decal: 0.1,
  glass: 0.1,
  tile: 0.5,
  metal: 0.25,
  plastic: 0.25,
  misc: 0.25,
};
/** target triangle fraction per LOD; the error budget above (scaled by `errorScale`) is what
 * actually binds on anything small. The LOW LOD is the distant/cheap one — `errorScale` 10 is
 * what brings the two Goal Ribs (the single heaviest thing on the field, 55k source
 * triangles apiece) inside the 250 KB budget; at 4 it stopped at 30k and the file came out at
 * 298 KB brotli. */
const LOD = {
  high: { ratio: 0.3, errorScale: 1 },
  low: { ratio: 0.2, errorScale: 10 },
};
/** finishes the LOW LOD does NOT get to blur: a 0.010-in-thick tape strip and a printed decal
 * are FLAT, so any tolerance above their own thickness collapses them to a zero-area sheet, and
 * "the tape looks wrong on a low-detail device" is the same bug report this pass exists to fix. */
const NO_LOD_ERROR_SCALE = new Set(['tape', 'decal']);

/** positions-only weld: the STL is a triangle soup (3 unique vertices per triangle) and this
 * asset carries NO normals by design, so co-located vertices are genuinely identical and an
 * exact dedupe on the rounded position is both correct and the only thing a simplifier needs
 * before it can collapse an edge. Rounded to 1e-4 in — the same quantum `convert.py` rounds
 * its own collider points to. */
function weldPositions(positions, indices) {
  const map = new Map();
  const outPos = [];
  const remap = new Uint32Array(positions.length / 3);
  for (let i = 0; i < positions.length; i += 3) {
    const key = `${Math.round(positions[i] * 1e4)},${Math.round(positions[i + 1] * 1e4)},${Math.round(positions[i + 2] * 1e4)}`;
    let idx = map.get(key);
    if (idx === undefined) {
      idx = outPos.length / 3;
      outPos.push(positions[i], positions[i + 1], positions[i + 2]);
      map.set(key, idx);
    }
    remap[i / 3] = idx;
  }
  const outIdx = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) outIdx[i] = remap[indices[i]];
  return { positions: new Float32Array(outPos), indices: outIdx };
}

function simplifyPrimitive(positions, indices, finish, lod) {
  const budget = SIMPLIFY_ERROR_IN[finish] ?? 0.25;
  const scale = MeshoptSimplifier.getScale(positions, 3) || 1;
  const errorScale = NO_LOD_ERROR_SCALE.has(finish) ? 1 : LOD[lod].errorScale;
  const targetError = Math.min(1, (budget * errorScale) / scale);
  const target = Math.max(3, Math.floor((indices.length * LOD[lod].ratio) / 3) * 3);
  if (target >= indices.length) return { positions, indices };
  let [simplified] = MeshoptSimplifier.simplify(indices, positions, 3, target, targetError, ['LockBorder']);
  // ⚠️ THE TOPOLOGY PLATEAU, AND WHY THE LOW LOD NEEDS `simplifySloppy`. meshoptimizer's normal
  // simplifier preserves TOPOLOGY: it will not collapse an edge that would close a hole. The two
  // Goal Ribs are perforated honeycomb plates with ~100 hexagonal holes apiece, so they bottom
  // out at "every hole reduced to its minimal loop" — measured, 55k source triangles stopped at
  // 30k however far the ratio or the error budget was pushed, and `field-low.glb` sat at 296 KB
  // brotli against a 250 KB budget. `simplifySloppy` ignores topology (it is the tool meshopt
  // ships for exactly this: a distant LOD where a hole closing up is invisible) and is used ONLY
  // for the LOW level, ONLY on primitives the topology-preserving pass could not bring within 2x
  // of their target. The HIGH level never takes this path, so the detail a driver actually sees
  // is always the topology-preserving result.
  if (lod === 'low' && simplified.length > 2 * target && !NO_LOD_ERROR_SCALE.has(finish)) {
    const [sloppy] = MeshoptSimplifier.simplifySloppy(indices, positions, 3, null, target, Math.min(1, targetError * 4));
    if (sloppy && sloppy.length >= 3 && sloppy.length < simplified.length) simplified = sloppy;
  }
  // Drop the vertices the collapse orphaned, so meshopt/quantize do not pay for them.
  // ⚠️ `compactMesh` returns `[remap, uniqueCount]` AND REWRITES `simplified` IN PLACE through
  // that remap (meshoptimizer's own `reorder()` does both). Treating the return value as a bare
  // remap array, and then remapping the already-remapped indices a second time, produced a
  // primitive with 8 vertices and 30k degenerate triangles — visible as a `field.glb` that
  // brotli'd to 3 KB because the buffer was nearly all zeros, and as a flower instancing
  // cross-check that suddenly reported a 67-in residual (the zeroed positions dragged the bbox
  // to the origin). Both were the same line.
  const [remap, unique] = MeshoptSimplifier.compactMesh(simplified);
  const outPos = new Float32Array(unique * 3);
  for (let i = 0; i < remap.length; i++) {
    const dst = remap[i];
    if (dst === 0xffffffff) continue;
    outPos[dst * 3 + 0] = positions[i * 3 + 0];
    outPos[dst * 3 + 1] = positions[i * 3 + 1];
    outPos[dst * 3 + 2] = positions[i * 3 + 2];
  }
  return { positions: outPos, indices: simplified };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      out[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stlDir = args.stl;
  const collidersPath = args.colliders;
  const outPath = args.out;
  const lod = args.lod ?? 'high';
  if (!stlDir || !collidersPath || !outPath || !LOD[lod]) {
    console.error('usage: assemble-gltf.mjs --stl <dir> --colliders <field-colliders.json> --out <field.glb> [--lod high|low]');
    process.exit(1);
  }
  await MeshoptSimplifier.ready;

  const colliders = JSON.parse(readFileSync(collidersPath, 'utf8'));
  const pivotRed = colliders.trays.red.pivot;
  const pivotBlue = colliders.trays.blue.pivot;

  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('biobuzz-field');

  const matCache = new Map();
  function materialFor(finish, hex) {
    const key = `${finish}#${hex}`;
    if (matCache.has(key)) return matCache.get(key);
    const spec = FINISH[finish];
    if (!spec) {
      throw new Error(
        `assemble-gltf: unknown finish "${finish}" (from an STL named <node>__${finish}_${hex}.stl) — ` +
          `add it to FINISH in this file and to FINISHES in src/games/biobuzz/scene/renderFieldGlb.ts.`,
      );
    }
    const m = doc
      .createMaterial(key)
      .setBaseColorFactor([...srgbHexToLinear(hex), spec.alpha ?? 1])
      .setRoughnessFactor(spec.roughness)
      .setMetallicFactor(spec.metallic);
    if (spec.alpha !== undefined && spec.alpha < 1) m.setAlphaMode('BLEND');
    matCache.set(key, m);
    return m;
  }

  // NO 'NORMAL' attribute here, on purpose. The STL's own per-triangle FLAT normal makes every
  // triangle edge look like a hard attribute boundary to meshoptimizer's simplifier — weld only
  // merges vertices that already match position AND normal, so a flat-shaded box (a cube has 24
  // distinct corner-normal pairs, not 8) welds down almost nothing, and simplify then has no
  // edge it can collapse without "crossing" a normal seam. The first attempt at `simplify
  // --ratio 0.12` on this data cut 25.24 MB to 25.21 MB — effectively nothing. Position-only
  // geometry welds and simplifies freely; `renderFieldGlb.ts` calls `computeVertexNormals()`
  // once after load, which is the standard, cheap way to shade a decimated background asset.

  const allFiles = readdirSync(stlDir).filter((f) => f.endsWith('.stl'));
  const claimed = new Set();

  /** every `<node>__<finish>_<hex>.stl` file for a given node, as `{finish, hex, file}`. */
  function classFilesFor(node) {
    const prefix = `${node}__`;
    return allFiles
      .filter((f) => f.startsWith(prefix))
      .map((f) => {
        const rest = f.slice(prefix.length, -'.stl'.length);
        const cut = rest.lastIndexOf('_');
        if (cut < 0) throw new Error(`assemble-gltf: STL "${f}" is not <node>__<finish>_<hex>.stl`);
        claimed.add(f);
        return { finish: rest.slice(0, cut), hex: rest.slice(cut + 1), file: path.join(stlDir, f) };
      })
      .sort((a, b) => (a.finish + a.hex).localeCompare(b.finish + b.hex)); // determinism
  }

  function mergeBbox(a, b) {
    return {
      min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
      max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
    };
  }

  const report = [];

  /** ONE mesh per NODE, with one PRIMITIVE per (finish, CAD colour) pair. Returns `null` when
   * `convert.py` wrote nothing for this node (an absent optional part, e.g. `stations` on this
   * STEP revision, or `misc` when every part classified cleanly). */
  function loadNodeParts(node) {
    const parts = classFilesFor(node);
    if (parts.length === 0) return null;
    const mesh = doc.createMesh(node);
    let triCount = 0;
    let bbox = null;
    for (const { finish, hex, file } of parts) {
      const raw = parseBinaryStl(readFileSync(file));
      if (raw.triCount === 0) continue;
      const welded = weldPositions(raw.positions, raw.indices);
      const { positions, indices } = simplifyPrimitive(welded.positions, welded.indices, finish, lod);
      const tc = indices.length / 3;
      const posAcc = doc.createAccessor(`${node}_${finish}_${hex}_pos`).setType('VEC3').setArray(positions).setBuffer(buffer);
      const idxAcc = doc.createAccessor(`${node}_${finish}_${hex}_idx`).setType('SCALAR').setArray(indices).setBuffer(buffer);
      const prim = doc.createPrimitive().setAttribute('POSITION', posAcc).setIndices(idxAcc).setMaterial(materialFor(finish, hex));
      mesh.addPrimitive(prim);
      triCount += tc;
      bbox = bbox ? mergeBbox(bbox, bboxOf(positions)) : bboxOf(positions);
      report.push({ group: `${node}__${finish}_${hex}`, triCount: tc, from: raw.triCount });
    }
    if (mesh.listPrimitives().length === 0) return null;
    return { mesh, triCount, bbox };
  }

  /** the merged bbox of every class file for `node`, WITHOUT building any glTF resources — used
   * only for the flower instancing cross-check below. */
  function mergedBboxOf(node) {
    let bbox = null;
    for (const { file } of classFilesFor(node)) {
      const { positions } = parseBinaryStl(readFileSync(file));
      if (positions.length === 0) continue;
      bbox = bbox ? mergeBbox(bbox, bboxOf(positions)) : bboxOf(positions);
    }
    return bbox;
  }

  function addNode(name, mesh, translation) {
    const node = doc.createNode(name).setMesh(mesh);
    if (translation) node.setTranslation(translation);
    scene.addChild(node);
    return node;
  }

  for (const [stem, glName] of [
    ['tiles', 'tiles'],
    ['walls', 'walls'],
    ['tape', 'tape'],
    ['stations', 'stations'],
    ['misc', 'misc'],
    ['hive_red_frame', 'hive_red/frame'],
    ['hive_blue_frame', 'hive_blue/frame'],
    ['hive_shared_frame', 'hive_shared/frame'],
  ]) {
    const loaded = loadNodeParts(stem);
    if (loaded) addNode(glName, loaded.mesh);
  }

  // TRAYS are authored PIVOT-RELATIVE **AND UN-TILTED** by convert.py (it rotates every point
  // by −captureTheta about the pivot first), so the node's own translation places it at the
  // live pivot and the runtime rotates this exact node about local X by `hiveTiltAngle` —
  // the same absolute angle `engine.ts` gives the kinematic body, with no reference-angle term
  // on either side. `colliders.trays[a].refTheta` is 0 for exactly this reason.
  const hiveRedTray = loadNodeParts('hive_red_tray');
  if (hiveRedTray) addNode('hive_red/tray', hiveRedTray.mesh, pivotRed);
  const hiveBlueTray = loadNodeParts('hive_blue_tray');
  if (hiveBlueTray) addNode('hive_blue/tray', hiveBlueTray.mesh, pivotBlue);

  // ── FLOWERS: one mesh (F1 / flower_0, already authored at F1's true world position, with one
  // primitive per (finish, CAD colour) — amber ring / green pipes / purple backstop / grey
  // brackets), instanced onto 3 more nodes by a pure rotation about the FIELD ORIGIN. The
  // mapping is ANALYTIC (rotating (x,y) by θ CCW about the origin), verified against
  // BB_FLOWERS: F1=(−69.46,−24) at 90° lands on (24,−69.46) = F4; at 180° on (69.46,24) = F3;
  // at 270° on (−24,69.46) = F2. So [F1,F2,F3,F4] takes rotations [0, 270, 180, 90].
  const FLOWER_ROTATION_DEG = [0, 270, 180, 90];
  const flower0 = loadNodeParts('flower_0');
  if (flower0) {
    for (let k = 0; k < 4; k++) {
      const node = doc.createNode(`flower_${k}`).setMesh(flower0.mesh);
      const deg = FLOWER_ROTATION_DEG[k];
      if (deg !== 0) node.setRotation(quatZ(deg));
      scene.addChild(node);
    }
    // cross-check against the ACTUAL tessellated flower_k STLs on disk, rather than trusting
    // the analytic rotation alone — this is real CAD data, not a re-derivation.
    for (let k = 1; k < 4; k++) {
      const realBox = mergedBboxOf(`flower_${k}`);
      if (!realBox) continue;
      const rotatedMin = rotateZ(flower0.bbox.min, FLOWER_ROTATION_DEG[k]);
      const rotatedMax = rotateZ(flower0.bbox.max, FLOWER_ROTATION_DEG[k]);
      const dx = Math.min(
        Math.abs(rotatedMin[0] - realBox.min[0]) + Math.abs(rotatedMax[0] - realBox.max[0]),
        Math.abs(rotatedMin[0] - realBox.max[0]) + Math.abs(rotatedMax[0] - realBox.min[0]),
      );
      if (dx > 3) {
        console.error(`[assemble] WARNING: flower_${k} instancing cross-check residual ${dx.toFixed(2)}in on x — the rotation mapping may be wrong`);
      } else {
        console.error(`[assemble] flower_${k} instancing cross-check OK (residual ${dx.toFixed(3)}in)`);
      }
    }
  }

  // ⚠️ NOTHING SILENTLY UNCLAIMED. The previous version enumerated the nodes it knew and any
  // STL convert.py wrote under a name it did not list just sat on disk — which is the same
  // class of bug as convert.py's own dropped `other` bucket, one stage later. `flower_1..3` are
  // read (for the instancing cross-check) but deliberately not added as meshes.
  const unclaimed = allFiles.filter((f) => !claimed.has(f));
  if (unclaimed.length > 0) {
    throw new Error(
      `assemble-gltf: ${unclaimed.length} STL file(s) written by convert.py were never claimed by a glTF node: ` +
        `${unclaimed.join(', ')} — add the node to this file's node table (and to renderFieldGlb.ts) or stop emitting it.`,
    );
  }

  doc.getRoot().listBuffers().forEach((b) => b.setURI(''));
  const io = new NodeIO();
  await io.write(outPath, doc);

  console.error(`[assemble] wrote ${outPath}`);
  report.sort((a, b) => b.triCount - a.triCount);
  for (const r of report) console.error(`   ${r.group}: ${r.triCount} tris`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
