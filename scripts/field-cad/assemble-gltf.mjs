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
import { readFileSync, existsSync } from 'node:fs';
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

  // ── materials: flat placeholders by class — the runtime loader assigns its own PBR
  // materials by NODE NAME (see renderFieldGlb.ts), these just make the standalone preview and
  // any consumer that skips that step render something reasonable rather than default-grey.
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
    wall: () => materialFor('wall', [0.55, 0.6, 0.66], { metallic: 0.3, roughness: 0.4 }),
    metal: () => materialFor('metal', [0.62, 0.64, 0.68], { metallic: 0.7, roughness: 0.35 }),
    plastic_red: () => materialFor('plastic_red', [0.75, 0.12, 0.1]),
    plastic_blue: () => materialFor('plastic_blue', [0.06, 0.28, 0.85]),
    plastic: () => materialFor('plastic', [0.75, 0.75, 0.78]),
    tape: () => materialFor('tape', [0.8, 0.1, 0.1], { alpha: 0.95 }),
  };

  // NO 'NORMAL' attribute here, on purpose. The STL's own per-triangle FLAT normal makes every
  // triangle edge look like a hard attribute boundary to meshoptimizer's simplifier — weld only
  // merges vertices that already match position AND normal, so a flat-shaded box (a cube has 24
  // distinct corner-normal pairs, not 8) welds down almost nothing, and simplify then has no
  // edge it can collapse without "crossing" a normal seam. The first attempt at `simplify
  // --ratio 0.12` on this data cut 25.24 MB to 25.21 MB — effectively nothing. Position-only
  // geometry welds and simplifies freely; `renderFieldGlb.ts` calls `computeVertexNormals()`
  // once after load, which is the standard, cheap way to shade a decimated background asset.
  function meshFromStl(name, filePath, material) {
    const buf = readFileSync(filePath);
    const { positions, indices, triCount } = parseBinaryStl(buf);
    const posAcc = doc.createAccessor(`${name}_pos`).setType('VEC3').setArray(positions).setBuffer(buffer);
    const idxAcc = doc.createAccessor(`${name}_idx`).setType('SCALAR').setArray(indices).setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute('POSITION', posAcc).setIndices(idxAcc);
    if (material) prim.setMaterial(material);
    const mesh = doc.createMesh(name).addPrimitive(prim);
    return { mesh, triCount, bbox: bboxOf(positions) };
  }

  function addNode(name, mesh, translation) {
    const node = doc.createNode(name).setMesh(mesh);
    if (translation) node.setTranslation(translation);
    scene.addChild(node);
    return node;
  }

  const report = [];
  function stlPath(group) {
    return path.join(stlDir, `${group}.stl`);
  }
  function loadGroup(group, material) {
    const p = stlPath(group);
    if (!existsSync(p)) return null;
    const { mesh, triCount, bbox } = meshFromStl(group, p, material);
    report.push({ group, triCount });
    return { mesh, bbox };
  }

  const tiles = loadGroup('tiles', MAT.tile());
  if (tiles) addNode('tiles', tiles.mesh);

  const walls = loadGroup('walls', MAT.wall());
  if (walls) addNode('walls', walls.mesh);

  const tape = loadGroup('tape', MAT.tape());
  if (tape) addNode('tape', tape.mesh);

  const stations = loadGroup('stations', MAT.wall());
  if (stations) addNode('stations', stations.mesh);

  const hiveRedFrame = loadGroup('hive_red_frame', MAT.metal());
  if (hiveRedFrame) addNode('hive_red/frame', hiveRedFrame.mesh);
  const hiveBlueFrame = loadGroup('hive_blue_frame', MAT.metal());
  if (hiveBlueFrame) addNode('hive_blue/frame', hiveBlueFrame.mesh);

  // trays are authored PIVOT-RELATIVE by convert.py — the node's own translation places them
  // at the live pivot, and the runtime rotates this exact node about local X for the tilt.
  const hiveRedTray = loadGroup('hive_red_tray', MAT.plastic_red());
  if (hiveRedTray) addNode('hive_red/tray', hiveRedTray.mesh, pivotRed);
  const hiveBlueTray = loadGroup('hive_blue_tray', MAT.plastic_blue());
  if (hiveBlueTray) addNode('hive_blue/tray', hiveBlueTray.mesh, pivotBlue);

  // ── FLOWERS: one mesh (F1 / flower_0, already authored at F1's true world position),
  // instanced onto 3 more nodes by a pure rotation about the FIELD ORIGIN. The mapping is
  // ANALYTIC (rotating (x,y) by θ CCW about the origin: (x cosθ − y sinθ, x sinθ + y cosθ)),
  // verified against BB_FLOWERS's own printed positions: F1=(−69.46,−24) at 0° is F1;
  // at 90° it lands on (24,−69.46) = F4; at 180° on (69.46,24) = F3; at 270° on (−24,69.46) =
  // F2. So flower_groups order [F1,F2,F3,F4] (config.ts's own BB_FLOWERS order) takes rotations
  // [0, 270, 180, 90] respectively.
  const FLOWER_ROTATION_DEG = [0, 270, 180, 90];
  const flower0 = loadGroup('flower_0', MAT.plastic());
  if (flower0) {
    for (let k = 0; k < 4; k++) {
      const node = doc.createNode(`flower_${k}`).setMesh(flower0.mesh);
      const deg = FLOWER_ROTATION_DEG[k];
      if (deg !== 0) node.setRotation(quatZ(deg));
      scene.addChild(node);
    }
    // cross-check against the ACTUAL tessellated flower_k.stl on disk, if it exists, rather
    // than trusting the analytic rotation alone — this is real CAD data, not a re-derivation.
    for (let k = 1; k < 4; k++) {
      const p = stlPath(`flower_${k}`);
      if (!existsSync(p)) continue;
      const real = parseBinaryStl(readFileSync(p));
      const realBox = bboxOf(real.positions);
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
