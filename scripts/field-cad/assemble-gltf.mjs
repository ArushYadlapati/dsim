#!/usr/bin/env node
// scripts/field-cad/assemble-gltf.mjs — assembles the per-group binary STL files convert.py
// wrote (`<cache>/stl/<level>/*.stl`) into ONE glTF document, with the node names/hierarchy the
// runtime loader (`src/games/biobuzz/scene/renderFieldGlb.ts`) expects: `hive_red/frame`,
// `hive_red/tray`, `hive_blue/frame`, `hive_blue/tray`, `flower_0`..`flower_3`, `walls`,
// `tiles`, `tape`, `stations` (if present).
//
// INSTANCING (docs/biobuzz/plan-3d.md §8's "instance the repeated parts — four flowers, two
// hives, tiles"): the four FLOWERS are related by an exact 90° rotation about the FIELD ORIGIN
// (verified against `BB_FLOWERS` — see the header on `FLOWER_ROTATION_DEG` below and the
// runtime cross-check against each flower's own tessellated bbox), so only `flower_0.stl` (F1)
// is ever loaded; F2/F3/F4 are the SAME mesh referenced from three more nodes with a rotation
// transform. Hive red/blue are NOT instanced here (their skins carry alliance-coloured
// material intent even though the geometry is a mirror construction) — weld+quantize+meshopt
// in the caller (`scripts/field-cad.mjs`) does the rest of the compression work.
//
// Deliberately zero manual vertex welding here: this script hands gltf-transform's own `weld`
// transform (invoked by the caller right after this writes the raw assembly) the STL's natural
// triangle-soup layout — every vertex duplicated per triangle, flat per-triangle normals — which
// is exactly the shape `weld` is designed to dedupe (it merges co-located AND co-normal
// vertices, so hard edges on a box survive; a hand-rolled dedupe here would just be a worse,
// duplicate implementation of that pass).
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';

function parseBinaryStl(buf) {
  const triCount = buf.readUInt32LE(80);
  const positions = new Float32Array(triCount * 9);
  const normals = new Float32Array(triCount * 9);
  let offset = 84;
  for (let t = 0; t < triCount; t++) {
    const nx = buf.readFloatLE(offset);
    const ny = buf.readFloatLE(offset + 4);
    const nz = buf.readFloatLE(offset + 8);
    offset += 12;
    for (let v = 0; v < 3; v++) {
      const vi = t * 3 + v;
      positions[vi * 3 + 0] = buf.readFloatLE(offset + 0);
      positions[vi * 3 + 1] = buf.readFloatLE(offset + 4);
      positions[vi * 3 + 2] = buf.readFloatLE(offset + 8);
      normals[vi * 3 + 0] = nx;
      normals[vi * 3 + 1] = ny;
      normals[vi * 3 + 2] = nz;
      offset += 12;
    }
    offset += 2;
  }
  const indices = new Uint32Array(triCount * 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return { positions, normals, indices, triCount };
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
  if (!stlDir || !collidersPath || !outPath) {
    console.error('usage: assemble-gltf.mjs --stl <dir> --colliders <field-colliders.json> --out <field.glb>');
    process.exit(1);
  }

  const colliders = JSON.parse(readFileSync(collidersPath, 'utf8'));
  const pivotRed = colliders.trays.red.pivot;
  const pivotBlue = colliders.trays.blue.pivot;

  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('biobuzz-field');

  // ── materials: flat placeholders BY PART CLASS, one glTF material PER CLASS, its `name` set
  // to the class key (2026-09-18 fidelity pass, owner playtest: "the flower has lost its
  // colour"). The runtime loader (`renderFieldGlb.ts`) now assigns its own PBR materials BY THIS
  // NAME, not by walking parent node names — these placeholders just make the standalone preview
  // and any consumer that skips that step render something reasonable rather than default-grey.
  // The class vocabulary matches `convert.py`'s `add_visual` call sites exactly: every "<node>__
  // <class>.stl" this pipeline can write has an entry here, and `materialForClass` throws (rather
  // than silently defaulting) if one is ever missing, so a new class introduced in `convert.py`
  // without a matching entry here fails loudly at assemble time instead of shipping grey.
  const matCache = new Map();
  function materialFor(key, color, opts = {}) {
    if (matCache.has(key)) return matCache.get(key);
    const m = doc
      .createMaterial(key)
      .setBaseColorFactor([...color, opts.alpha ?? 1])
      .setRoughnessFactor(opts.roughness ?? 0.6)
      .setMetallicFactor(opts.metallic ?? 0.0);
    if (opts.alpha !== undefined && opts.alpha < 1) m.setAlphaMode('BLEND');
    matCache.set(key, m);
    return m;
  }
  const MAT = {
    tile: () => materialFor('tile', [0.16, 0.16, 0.18]),
    wall_panel: () => materialFor('wall_panel', [0.85, 0.9, 0.92], { alpha: 0.3, roughness: 0.15 }),
    wall_extrusion: () => materialFor('wall_extrusion', [0.6, 0.63, 0.67], { metallic: 0.6, roughness: 0.35 }),
    hive_frame_metal: () => materialFor('hive_frame_metal', [0.62, 0.64, 0.68], { metallic: 0.7, roughness: 0.35 }),
    tray_panel_red: () => materialFor('tray_panel_red', [0.75, 0.12, 0.1]),
    tray_panel_blue: () => materialFor('tray_panel_blue', [0.06, 0.28, 0.85]),
    tray_metal: () => materialFor('tray_metal', [0.6, 0.62, 0.66], { metallic: 0.65, roughness: 0.4 }),
    flower_ring: () => materialFor('flower_ring', [0.88, 0.89, 0.91], { roughness: 0.4 }),
    flower_pipe: () => materialFor('flower_pipe', [0.76, 0.76, 0.78]),
    flower_base: () => materialFor('flower_base', [0.55, 0.57, 0.6], { metallic: 0.3, roughness: 0.5 }),
    tape_red: () => materialFor('tape_red', [0.8, 0.1, 0.1], { alpha: 0.95 }),
    tape_blue: () => materialFor('tape_blue', [0.04, 0.32, 0.9], { alpha: 0.95 }),
    tape_white: () => materialFor('tape_white', [0.85, 0.85, 0.85], { alpha: 0.95 }),
  };
  function materialForClass(cls) {
    const factory = MAT[cls];
    if (!factory) {
      throw new Error(
        `assemble-gltf: no material mapping for part class "${cls}" — add one to MAT in this file (see convert.py's add_visual call sites for the class it just wrote).`,
      );
    }
    return factory();
  }

  // NO 'NORMAL' attribute here, on purpose. The STL's own per-triangle FLAT normal makes every
  // triangle edge look like a hard attribute boundary to meshoptimizer's simplifier — weld only
  // merges vertices that already match position AND normal, so a flat-shaded box (a cube has 24
  // distinct corner-normal pairs, not 8) welds down almost nothing, and simplify then has no
  // edge it can collapse without "crossing" a normal seam. The first attempt at `simplify
  // --ratio 0.12` on this data cut 25.24 MB to 25.21 MB — effectively nothing. Position-only
  // geometry welds and simplifies freely; `renderFieldGlb.ts` calls `computeVertexNormals()`
  // once after load, which is the standard, cheap way to shade a decimated background asset.

  /** every "<node>__<class>.stl" file `convert.py` wrote for a given node, `{cls, file}`. */
  function classFilesFor(node) {
    const prefix = `${node}__`;
    return readdirSync(stlDir)
      .filter((f) => f.startsWith(prefix) && f.endsWith('.stl'))
      .map((f) => ({ cls: f.slice(prefix.length, -'.stl'.length), file: path.join(stlDir, f) }));
  }

  function mergeBbox(a, b) {
    return {
      min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
      max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
    };
  }

  const report = [];

  /** ONE mesh per NODE, with one PRIMITIVE PER PART CLASS — a resting element or a rendered
   * flower can no longer be "one grey lump": each primitive carries its own named material
   * (`materialForClass`), so a mesh with a ring + a pipe + a base primitive renders as three
   * differently-coloured parts of the same object, exactly like the real assembly. Returns
   * `null` when `convert.py` wrote nothing for this node (an absent optional part, e.g.
   * `stations` on this STEP revision). */
  function loadNodeParts(node) {
    const parts = classFilesFor(node);
    if (parts.length === 0) return null;
    const mesh = doc.createMesh(node);
    let triCount = 0;
    let bbox = null;
    for (const { cls, file } of parts) {
      const buf = readFileSync(file);
      const { positions, indices, triCount: tc } = parseBinaryStl(buf);
      const posAcc = doc.createAccessor(`${node}_${cls}_pos`).setType('VEC3').setArray(positions).setBuffer(buffer);
      const idxAcc = doc.createAccessor(`${node}_${cls}_idx`).setType('SCALAR').setArray(indices).setBuffer(buffer);
      const prim = doc.createPrimitive().setAttribute('POSITION', posAcc).setIndices(idxAcc).setMaterial(materialForClass(cls));
      mesh.addPrimitive(prim);
      triCount += tc;
      const partBbox = bboxOf(positions);
      bbox = bbox ? mergeBbox(bbox, partBbox) : partBbox;
      report.push({ group: `${node}__${cls}`, triCount: tc });
    }
    return { mesh, triCount, bbox };
  }

  /** the merged bbox of every class file for `node`, WITHOUT building any glTF resources — used
   * only for the flower instancing cross-check below, which needs F2/F3/F4's own tessellated
   * extent to verify against, never their geometry (they are pure rotations of F1's mesh). */
  function mergedBboxOf(node) {
    const parts = classFilesFor(node);
    if (parts.length === 0) return null;
    let bbox = null;
    for (const { file } of parts) {
      const { positions } = parseBinaryStl(readFileSync(file));
      const partBbox = bboxOf(positions);
      bbox = bbox ? mergeBbox(bbox, partBbox) : partBbox;
    }
    return bbox;
  }

  function addNode(name, mesh, translation) {
    const node = doc.createNode(name).setMesh(mesh);
    if (translation) node.setTranslation(translation);
    scene.addChild(node);
    return node;
  }

  const tiles = loadNodeParts('tiles');
  if (tiles) addNode('tiles', tiles.mesh);

  const walls = loadNodeParts('walls');
  if (walls) addNode('walls', walls.mesh);

  const tape = loadNodeParts('tape');
  if (tape) addNode('tape', tape.mesh);

  const stations = loadNodeParts('stations');
  if (stations) addNode('stations', stations.mesh);

  const hiveRedFrame = loadNodeParts('hive_red_frame');
  if (hiveRedFrame) addNode('hive_red/frame', hiveRedFrame.mesh);
  const hiveBlueFrame = loadNodeParts('hive_blue_frame');
  if (hiveBlueFrame) addNode('hive_blue/frame', hiveBlueFrame.mesh);

  // trays are authored PIVOT-RELATIVE by convert.py — the node's own translation places them
  // at the live pivot, and the runtime rotates this exact node about local X for the tilt.
  const hiveRedTray = loadNodeParts('hive_red_tray');
  if (hiveRedTray) addNode('hive_red/tray', hiveRedTray.mesh, pivotRed);
  const hiveBlueTray = loadNodeParts('hive_blue_tray');
  if (hiveBlueTray) addNode('hive_blue/tray', hiveBlueTray.mesh, pivotBlue);

  // ── FLOWERS: one mesh (F1 / flower_0, already authored at F1's true world position, now with
  // one primitive per part class — ring/pipe/base), instanced onto 3 more nodes by a pure
  // rotation about the FIELD ORIGIN. The mapping is ANALYTIC (rotating (x,y) by θ CCW about the
  // origin: (x cosθ − y sinθ, x sinθ + y cosθ)), verified against BB_FLOWERS's own printed
  // positions: F1=(−69.46,−24) at 0° is F1; at 90° it lands on (24,−69.46) = F4; at 180° on
  // (69.46,24) = F3; at 270° on (−24,69.46) = F2. So flower_groups order [F1,F2,F3,F4]
  // (config.ts's own BB_FLOWERS order) takes rotations [0, 270, 180, 90] respectively.
  const FLOWER_ROTATION_DEG = [0, 270, 180, 90];
  const flower0 = loadNodeParts('flower_0');
  if (flower0) {
    for (let k = 0; k < 4; k++) {
      const node = doc.createNode(`flower_${k}`).setMesh(flower0.mesh);
      const deg = FLOWER_ROTATION_DEG[k];
      if (deg !== 0) node.setRotation(quatZ(deg));
      scene.addChild(node);
    }
    // cross-check against the ACTUAL tessellated flower_k STLs on disk (merged across their own
    // part classes), if they exist, rather than trusting the analytic rotation alone — this is
    // real CAD data, not a re-derivation.
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

  doc.getRoot().listBuffers().forEach((b) => b.setURI(''));
  const io = new NodeIO();
  await io.write(outPath, doc);

  console.error(`[assemble] wrote ${outPath}`);
  for (const r of report) console.error(`   ${r.group}: ${r.triCount} tris`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
