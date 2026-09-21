#!/usr/bin/env node
// scripts/field-cad/elements.mjs — BIOBUZZ SCORING-ELEMENT CAD pipeline (`npm run element-cad`).
//
// The sibling of `scripts/field-cad.mjs`, for the one thing that file deliberately throws away.
// `convert.py`'s `RE_ELEMENT` drops the staged POLLEN and NECTAR because they are not field
// STRUCTURE — but they are in the same STEP assembly as real perforated solids, and the 3D
// renderer drew them as smooth spheres. This driver:
//
//   (a) resolves the SAME sha-pinned STEP zip from the SAME out-of-repo cache (nothing is
//       re-downloaded when the cached zip's hash still matches `source.mjs`);
//   (b) runs `elements.py` with the cache venv's Python to measure and tessellate one Pollen
//       and one Nectar definition into inch-scale, origin-centred STL;
//   (c) assembles the two into ONE glTF with two named meshes, and runs gltf-transform's
//       weld -> meshopt chain, exactly like the field's two LODs;
//   (d) prints the measured-vs-budget table and FAILS on a triangle or size overrun.
//
// Output: `public/models/biobuzz/elements.glb` + `elements-measurements.json`. Both ship under
// the same licence decision as the field files — see that directory's README.
//
// ── NO `simplify` PASS, DELIBERATELY ────────────────────────────────────────────────────────
// A decimator's error metric is a distance, and the feature that matters here is a 0.44-in hole
// in a 2.8-in ball: any tolerance loose enough to save triangles closes hole rims first, and the
// holes are the entire point of the asset. The triangle count is controlled at the SOURCE
// instead, by the chord deflection below, which is a tolerance on the true analytic surface
// rather than on an already-tessellated one.
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { SOURCE } from './source.mjs';

const CACHE = 'C:/Users/geniu/AppData/Local/dsim/field-cad';
const VENV_PY = path.join(CACHE, 'venv', 'Scripts', 'python.exe');
const NPMTOOLS = path.join(CACHE, 'npmtools');
const GLTF_TRANSFORM = path.join(NPMTOOLS, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js');

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public', 'models', 'biobuzz');
const WORK = path.join(CACHE, 'elements');

// ── THE TESSELLATION, AND THE BUDGET IT WAS PICKED AGAINST ──────────────────────────────────
// A chord deflection in INCHES, so it means the same thing on both elements. Measured sweep
// (`elements.py --sweep`, tris pollen/nectar): 0.03 -> 2286/2542, 0.02 -> 2684/2968,
// 0.015 -> 3034/3610, 0.01 -> 3940/4786, 0.004 -> 8174/9962. 0.03 in is ~12 deg of arc on a
// 1.4-in ball (a 30-segment great circle) and ~12 segments around a 0.44-in bore, which is past
// the point where either reads as faceted at any camera distance this game has; everything
// below it buys silhouette nobody can see at the cost of triangles a full field pays 100 times.
const DEFLECTION_IN = 0.03;
const ANGULAR = 0.9;

// PER BALL, and the reason it is a ratchet: a match has up to ~100 elements on screen across two
// `InstancedMesh`es, and each one is drawn again in the sun's shadow pass on High/Ultra.
const TRI_BUDGET = 3000;
const BUDGET_BROTLI = 60 * 1024;

function log(msg) {
  console.log(`[element-cad] ${msg}`);
}

function sha256File(p) {
  return crypto.createHash('sha256').update(readFileSync(p)).digest('hex');
}

/** the same pinned zip `scripts/field-cad.mjs` resolves, in the same cache, by the same rule. */
function ensureSource() {
  mkdirSync(CACHE, { recursive: true });
  const zipPath = path.join(CACHE, 'field-cad-step.zip');
  const extractedDir = path.join(CACHE, 'extracted');
  const stepPath = path.join(extractedDir, 'field-cad-step.step');

  let needDownload = true;
  if (existsSync(zipPath)) {
    const actual = sha256File(zipPath);
    if (actual === SOURCE.sha256) {
      needDownload = false;
      log(`cached zip sha256 OK (${actual}) — skipping download`);
    } else {
      log(`WARNING: cached zip sha256 ${actual} != pinned ${SOURCE.sha256} — re-downloading`);
    }
  }
  if (needDownload) {
    log(`downloading ${SOURCE.url}`);
    execFileSync('curl', ['-sL', '-o', zipPath, SOURCE.url], { stdio: 'inherit' });
    const actual = sha256File(zipPath);
    if (actual !== SOURCE.sha256) {
      throw new Error(`sha256 mismatch: got ${actual}, pinned SOURCE.sha256 is ${SOURCE.sha256}.`);
    }
  }
  if (!existsSync(stepPath)) {
    mkdirSync(extractedDir, { recursive: true });
    log('extracting zip');
    execFileSync('tar', ['-xf', zipPath, '-C', extractedDir], { stdio: 'inherit' });
  }
  return stepPath;
}

function runExtract(stepPath) {
  if (!existsSync(VENV_PY)) {
    throw new Error(`python venv not found at ${VENV_PY}. See scripts/field-cad.mjs for the one-time setup.`);
  }
  mkdirSync(WORK, { recursive: true });
  log('running elements.py (CadQuery/OCP, headless) ...');
  execFileSync(
    VENV_PY,
    [path.join(REPO_ROOT, 'scripts', 'field-cad', 'elements.py'), stepPath, '--out', WORK, '--deflection', String(DEFLECTION_IN), '--angular', String(ANGULAR)],
    { stdio: 'inherit' },
  );
}

/** binary STL -> { positions: Float32Array, indices: Uint16Array } with vertices welded on an
 * exact position match (the STL was written from an already-deduplicated index buffer, so this
 * recovers that buffer rather than approximating it). */
function readStl(file) {
  const buf = readFileSync(file);
  const tris = buf.readUInt32LE(80);
  const map = new Map();
  const pos = [];
  const idx = [];
  for (let t = 0; t < tris; t++) {
    const base = 84 + t * 50 + 12; // skip the 80-byte header, the count, and this facet's normal
    for (let v = 0; v < 3; v++) {
      const x = buf.readFloatLE(base + v * 12);
      const y = buf.readFloatLE(base + v * 12 + 4);
      const z = buf.readFloatLE(base + v * 12 + 8);
      const key = `${x},${y},${z}`;
      let i = map.get(key);
      if (i === undefined) {
        i = pos.length / 3;
        pos.push(x, y, z);
        map.set(key, i);
      }
      idx.push(i);
    }
  }
  if (pos.length / 3 > 65535) throw new Error(`${file}: ${pos.length / 3} verts exceeds UNSIGNED_SHORT indexing`);
  return { positions: new Float32Array(pos), indices: new Uint16Array(idx), tris };
}

/**
 * Write a minimal two-mesh GLB by hand. It is a JSON chunk plus a binary chunk, and building it
 * here rather than through `@gltf-transform/core` keeps this driver runnable with nothing but
 * Node — the gltf-transform CLI is still used below for weld + meshopt, which is where the real
 * work is.
 *
 * POSITION AND INDICES ONLY, NO NORMALS — the same convention both field GLBs ship under (see
 * `public/models/biobuzz/README.md`). `renderElementsGlb.ts` runs `computeCreasedNormals` at
 * load, which is what gives a smooth sphere AND a hard rim where each bore breaks the surface;
 * baked normals would need a vertex split at every one of those rims for no visual gain.
 */
function writeGlb(outPath, meshes) {
  const json = {
    asset: { version: '2.0', generator: 'dsim scripts/field-cad/elements.mjs' },
    scene: 0,
    scenes: [{ nodes: meshes.map((_, i) => i) }],
    nodes: meshes.map((m, i) => ({ mesh: i, name: m.name })),
    meshes: meshes.map((m, i) => ({ name: m.name, primitives: [{ attributes: { POSITION: i * 2 }, indices: i * 2 + 1 }] })),
    accessors: [],
    bufferViews: [],
    buffers: [],
  };
  const blobs = [];
  let offset = 0;
  const push = (data) => {
    // 4-byte alignment: every accessor here is 4- or 2-byte and glTF requires the view's offset
    // to be a multiple of the component size.
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      blobs.push(Buffer.alloc(pad));
      offset += pad;
    }
    const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    blobs.push(b);
    const view = { buffer: 0, byteOffset: offset, byteLength: b.length };
    offset += b.length;
    return view;
  };

  for (const m of meshes) {
    const { positions, indices } = m;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      minX = Math.min(minX, positions[i]);
      maxX = Math.max(maxX, positions[i]);
      minY = Math.min(minY, positions[i + 1]);
      maxY = Math.max(maxY, positions[i + 1]);
      minZ = Math.min(minZ, positions[i + 2]);
      maxZ = Math.max(maxZ, positions[i + 2]);
    }
    json.bufferViews.push({ ...push(positions), target: 34962 });
    json.accessors.push({
      bufferView: json.bufferViews.length - 1,
      componentType: 5126,
      count: positions.length / 3,
      type: 'VEC3',
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    });
    json.bufferViews.push({ ...push(indices), target: 34963 });
    json.accessors.push({ bufferView: json.bufferViews.length - 1, componentType: 5123, count: indices.length, type: 'SCALAR' });
  }

  let bin = Buffer.concat(blobs);
  if (bin.length % 4) bin = Buffer.concat([bin, Buffer.alloc(4 - (bin.length % 4))]);
  json.buffers.push({ byteLength: bin.length });

  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  if (jsonBuf.length % 4) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(4 - (jsonBuf.length % 4), 0x20)]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4); // 'BIN'
  writeFileSync(outPath, Buffer.concat([header, jsonHeader, jsonBuf, binHeader, bin]));
}

function gltfTransform(cmd, args) {
  execFileSync('node', [GLTF_TRANSFORM, cmd, ...args], { cwd: NPMTOOLS, stdio: 'inherit' });
}

function main() {
  log(`source: ${SOURCE.url} (${SOURCE.version}, ${SOURCE.versionDate})`);
  const stepPath = ensureSource();
  runExtract(stepPath);

  const measurements = JSON.parse(readFileSync(path.join(WORK, 'elements-measurements.json'), 'utf8'));
  const kinds = ['pollen', 'nectar'];
  const meshes = kinds.map((k) => ({ name: k, ...readStl(path.join(WORK, `${k}.stl`)) }));

  const raw = path.join(WORK, 'elements-raw.glb');
  const welded = path.join(WORK, 'elements-welded.glb');
  const out = path.join(PUBLIC_DIR, 'elements.glb');
  mkdirSync(PUBLIC_DIR, { recursive: true });
  writeGlb(raw, meshes);
  gltfTransform('weld', [raw, welded]);
  gltfTransform('meshopt', [welded, out]);

  // the measurements file ships too: `renderElementsGlb.ts` never reads it (the mesh IS the
  // truth at runtime), but the smoke lane and a future session both need the CAD's own numbers
  // next to the asset they describe.
  const measOut = path.join(PUBLIC_DIR, 'elements-measurements.json');
  writeFileSync(measOut, `${JSON.stringify(measurements, null, 2)}\n`);

  const rawBytes = statSync(out).size;
  const brotli = zlib.brotliCompressSync(readFileSync(out)).length;

  console.log('');
  console.log('size table (measured vs budget):');
  for (const m of meshes) {
    const ok = m.tris <= TRI_BUDGET ? 'OK' : 'OVER';
    console.log(`  ${m.name.padEnd(7)} verts=${(m.positions.length / 3).toString().padStart(5)}  tris=${m.tris.toString().padStart(5)}  budget=${TRI_BUDGET}  ${ok}`);
  }
  console.log(`  elements.glb   raw=${rawBytes.toLocaleString()}  brotli=${brotli.toLocaleString()}  budget(brotli)=${BUDGET_BROTLI.toLocaleString()}  ${brotli <= BUDGET_BROTLI ? 'OK' : 'OVER'}`);
  for (const k of kinds) {
    const m = measurements[k];
    console.log(
      `  ${k.padEnd(7)} CAD r=${m.outerRadiusIn} in (config ${m.configRadiusIn}, delta ${m.configDeltaIn})  wall=${m.wallIn}  ${m.boreCount} bores d=${m.boreDiameterIn}`,
    );
  }
  console.log('');

  let failed = false;
  for (const m of meshes) {
    if (m.tris > TRI_BUDGET) {
      failed = true;
      console.error(`FAIL: ${m.name} is ${m.tris} triangles > budget ${TRI_BUDGET}.`);
    }
  }
  if (brotli > BUDGET_BROTLI) {
    failed = true;
    console.error(`FAIL: elements.glb is ${brotli} brotli bytes > budget ${BUDGET_BROTLI}.`);
  }
  if (failed) process.exit(1);
  log(`wrote ${out} and ${measOut} — ALL BUDGETS OK`);
}

main();
