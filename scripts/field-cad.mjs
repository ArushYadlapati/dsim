#!/usr/bin/env node
// scripts/field-cad.mjs — BIOBUZZ field CAD import pipeline driver (docs/biobuzz/plan-3d.md §8).
//
// (a) resolve + verify the pinned STEP zip (download + sha256-check into the OUT-OF-REPO
//     cache); (b) extract; (c) run scripts/field-cad/convert.py with the cache's Python venv;
//     (d) assemble the per-group STL into two glTF LODs and run gltf-transform's
//     weld -> simplify -> meshopt chain; (e) print a size table and FAIL, naming the heaviest
//     part, if any budget in the table below is exceeded.
//
// Everything downloaded/installed lives in the cache (never in the repo, never in
// node_modules): C:/Users/geniu/AppData/Local/dsim/field-cad/. The gltf-transform/gltfpack CLIs
// live in <cache>/npmtools (a separate npm project, installed once, outside the repo).
//
// Re-run: `npm run field-cad`. On a re-run the zip is only re-downloaded if the cached copy's
// sha256 no longer matches SOURCE.sha256 (i.e. never, unless SOURCE is edited after a real
// field revision — see the header on SOURCE below for what to do then).
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, cpSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// ── THE PINNED SOURCE ────────────────────────────────────────────────────────────────────────
// Moved to `scripts/field-cad/source.mjs` so `emit-dims.mjs` and the smoke check that re-renders
// its output can stamp the SAME identity string without importing this module (which would run
// the pipeline). That file's header has the "pick up a new revision" procedure.
import { SOURCE } from './field-cad/source.mjs';
import { emitDims } from './field-cad/emit-dims.mjs';

const CACHE = 'C:/Users/geniu/AppData/Local/dsim/field-cad';
const VENV_PY = path.join(CACHE, 'venv', 'Scripts', 'python.exe');
const NPMTOOLS = path.join(CACHE, 'npmtools');
// Invoke the CLI's own JS entry point with `node`, not the `.bin/gltf-transform(.cmd)` shim —
// spawning a `.cmd` file directly via `execFileSync` fails with EINVAL on Windows because it
// is not a native executable (Windows itself only knows how to run it through `cmd.exe`, which
// `execFileSync` does not implicitly invoke); running the underlying script through `node`
// sidesteps the whole shim question and works identically cross-platform.
const GLTF_TRANSFORM = path.join(NPMTOOLS, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js');

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public', 'models', 'biobuzz');
const SCRATCH = path.join(CACHE, 'run');

// ── budgets (docs/biobuzz/plan-3d.md §8) ────────────────────────────────────────────────────
const BUDGET_HIGH_BROTLI = 600 * 1024;
const BUDGET_LOW_BROTLI = 250 * 1024;
const BUDGET_COLLIDERS_RAW = 200 * 1024;

function log(msg) {
  console.log(`[field-cad] ${msg}`);
}

function sha256File(p) {
  return crypto.createHash('sha256').update(readFileSync(p)).digest('hex');
}

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
    const size = statSync(zipPath).size;
    log(`downloaded ${size} bytes, sha256=${actual}`);
    if (actual !== SOURCE.sha256) {
      throw new Error(
        `sha256 mismatch: got ${actual}, pinned SOURCE.sha256 is ${SOURCE.sha256}. ` +
          `If FIRST genuinely republished the field, update SOURCE in this file with the new hash/version after checking the change.`,
      );
    }
  }

  if (!existsSync(stepPath)) {
    mkdirSync(extractedDir, { recursive: true });
    log('extracting zip');
    execFileSync('tar', ['-xf', zipPath, '-C', extractedDir], { stdio: 'inherit' });
  } else {
    log('STEP already extracted — skipping');
  }
  return { zipPath, stepPath, wasCached: !needDownload };
}

function runConvert(stepPath) {
  if (!existsSync(VENV_PY)) {
    throw new Error(
      `python venv not found at ${VENV_PY}. One-time setup (outside the repo):\n` +
        `  C:/Python312/python.exe -m venv "${path.join(CACHE, 'venv')}"\n` +
        `  "${VENV_PY}" -m pip install cadquery numpy scipy`,
    );
  }
  const convertPy = path.join(REPO_ROOT, 'scripts', 'field-cad', 'convert.py');
  const cacheOut = path.join(SCRATCH, 'cache');
  mkdirSync(cacheOut, { recursive: true });
  mkdirSync(PUBLIC_DIR, { recursive: true });
  log('running convert.py (CadQuery/OCP, headless) ...');
  execFileSync(VENV_PY, [convertPy, stepPath, '--cache', cacheOut, '--public', PUBLIC_DIR], { stdio: 'inherit' });
  return cacheOut;
}

function ensureNpmTools() {
  if (existsSync(path.join(NPMTOOLS, 'node_modules', '@gltf-transform', 'core'))) {
    log('npmtools already installed — skipping');
    return;
  }
  mkdirSync(NPMTOOLS, { recursive: true });
  // `npm` itself is a `.cmd` shim on Windows (same EINVAL trap as gltf-transform's bin shim
  // above) — `shell: true` here, unlike the CLI-entry workaround above, because npm has no
  // single portable .js entry point to invoke with `node` directly.
  if (!existsSync(path.join(NPMTOOLS, 'package.json'))) {
    execFileSync('npm', ['init', '-y'], { cwd: NPMTOOLS, stdio: 'inherit', shell: true });
  }
  log('installing @gltf-transform/cli, @gltf-transform/core, @gltf-transform/extensions, meshoptimizer, gltfpack into the cache (NOT the repo) ...');
  execFileSync('npm', ['install', '@gltf-transform/cli', '@gltf-transform/core', '@gltf-transform/extensions', 'meshoptimizer', 'gltfpack'], {
    cwd: NPMTOOLS,
    stdio: 'inherit',
    shell: true,
  });
}

function gltfTransform(cmd, args) {
  execFileSync('node', [GLTF_TRANSFORM, cmd, ...args], { cwd: NPMTOOLS, stdio: 'inherit' });
}

function brotliSize(p) {
  return zlib.brotliCompressSync(readFileSync(p)).length;
}

/**
 * Build one LOD: assemble the STL groups into a glTF, then weld -> meshopt.
 *
 * ⚠️ NO GLOBAL `gltf-transform simplify` STEP ANY MORE. A document-wide `--ratio` is the wrong
 * instrument for an asset whose primitives span four orders of magnitude in triangle count:
 * measured on the shipped `field.glb`, `--ratio 0.06 --error 0.01` took the 12-triangle tile box
 * down to FOUR triangles and the 16 one-inch tape strips from 192 triangles to 120, because the
 * error tolerance is a fraction of the MESH's extent and the tape mesh spans the whole field.
 * `assemble-gltf.mjs` now decimates PER PRIMITIVE against an absolute tolerance in INCHES
 * (`SIMPLIFY_ERROR_IN` there), so a part that cannot lose 0.05 in simply keeps its triangles.
 * `weld` stays in the chain as a cheap belt-and-braces pass — `assemble-gltf.mjs` already welds
 * on position, which is exact for this normal-less asset.
 */
function buildLod(level, stlDir, collidersPath, outGlb) {
  const work = path.join(SCRATCH, `lod-${level}`);
  mkdirSync(work, { recursive: true });
  const assembled = path.join(work, 'assembled.glb');
  const assembleScript = path.join(NPMTOOLS, 'assemble-gltf.mjs');
  cpSync(path.join(REPO_ROOT, 'scripts', 'field-cad', 'assemble-gltf.mjs'), assembleScript);
  execFileSync(
    'node',
    [assembleScript, '--stl', stlDir, '--colliders', collidersPath, '--out', assembled, '--lod', level],
    { stdio: 'inherit' },
  );

  const welded = path.join(work, 'welded.glb');
  gltfTransform('weld', [assembled, welded]);
  gltfTransform('meshopt', [welded, outGlb]);

  return { rawBytes: statSync(outGlb).size, brotliBytes: brotliSize(outGlb) };
}

function heaviestStlGroup(stlDir) {
  let best = null;
  for (const f of readdirSync(stlDir)) {
    const p = path.join(stlDir, f);
    const size = statSync(p).size;
    if (!best || size > best.size) best = { name: f, size };
  }
  return best;
}

function main() {
  log(`source: ${SOURCE.url} (${SOURCE.version}, ${SOURCE.versionDate})`);
  const { stepPath, wasCached } = ensureSource();
  log(`STEP file ready at ${stepPath} (zip ${wasCached ? 'was cached' : 'freshly downloaded'})`);

  ensureNpmTools();
  const cacheOut = runConvert(stepPath);

  const collidersPath = path.join(PUBLIC_DIR, 'field-colliders.json');
  const measurementsPath = path.join(PUBLIC_DIR, 'field-measurements.json');
  if (!existsSync(collidersPath) || !existsSync(measurementsPath)) {
    throw new Error('convert.py did not produce field-colliders.json / field-measurements.json');
  }

  // `tsconfig.json` has no `resolveJsonModule`, and its `include: ["src"]` makes every file
  // under `src/` a compilation ROOT (not just files reachable from an entry point) — so a bare
  // `import colliders from '.../field-colliders.json'` inside `src/games/biobuzz/sim3d/` would
  // fail `npm run build`'s `tsc` step outright. Generate a plain typed TS module instead, the
  // fallback `docs/biobuzz/plan-3d.md` §8 names, so `src/games/biobuzz/sim3d/fieldColliders.ts`
  // never needs a JSON import at all.
  const genPath = path.join(REPO_ROOT, 'src', 'games', 'biobuzz', 'sim3d', 'fieldColliders.gen.ts');
  const collidersData = readFileSync(collidersPath, 'utf8');
  const genSource =
    `// GENERATED by scripts/field-cad.mjs from public/models/biobuzz/field-colliders.json — do not hand-edit.\n` +
    `// Re-run \`npm run field-cad\` to regenerate. See src/games/biobuzz/sim3d/fieldColliders.ts for the typed API.\n` +
    `export const FIELD_COLLIDERS_JSON = ${collidersData} as const;\n`;
  mkdirSync(path.dirname(genPath), { recursive: true });
  writeFileSync(genPath, genSource);
  log(`wrote ${genPath}`);

  // ...and the SECOND generated module: the field's DIMENSIONS, which `src/games/biobuzz/
  // config.ts` reads instead of the hand-typed manual figures it used to carry (owner ruling
  // 2026-09-18, "the CAD is authoritative for dimensions"). Separate from the collider set above
  // because it comes off `field-measurements.json`, is read by the 2D pipeline as well as the 3D
  // one, and is small enough to be worth keeping legible — see `scripts/field-cad/emit-dims.mjs`.
  const dims = emitDims();
  log(`wrote ${dims.outPath} (${dims.bytes} bytes)`);

  mkdirSync(SCRATCH, { recursive: true });
  const highGlb = path.join(PUBLIC_DIR, 'field.glb');
  const lowGlb = path.join(PUBLIC_DIR, 'field-low.glb');

  log('building HIGH detail glb (per-primitive decimation -> weld -> meshopt) ...');
  const high = buildLod('high', path.join(cacheOut, 'stl', 'high'), collidersPath, highGlb);

  log('building LOW detail glb (per-primitive decimation -> weld -> meshopt) ...');
  const low = buildLod('low', path.join(cacheOut, 'stl', 'low'), collidersPath, lowGlb);

  const collidersRaw = statSync(collidersPath).size;

  console.log('');
  console.log('size table (measured vs budget):');
  console.log(`  field.glb      high  raw=${high.rawBytes.toLocaleString()}  brotli=${high.brotliBytes.toLocaleString()}  budget(brotli)=${BUDGET_HIGH_BROTLI.toLocaleString()}  ${high.brotliBytes <= BUDGET_HIGH_BROTLI ? 'OK' : 'OVER'}`);
  console.log(`  field-low.glb  low   raw=${low.rawBytes.toLocaleString()}  brotli=${low.brotliBytes.toLocaleString()}  budget(brotli)=${BUDGET_LOW_BROTLI.toLocaleString()}  ${low.brotliBytes <= BUDGET_LOW_BROTLI ? 'OK' : 'OVER'}`);
  console.log(`  field-colliders.json  raw=${collidersRaw.toLocaleString()}  budget(raw)=${BUDGET_COLLIDERS_RAW.toLocaleString()}  ${collidersRaw <= BUDGET_COLLIDERS_RAW ? 'OK' : 'OVER'}`);
  console.log('');

  let failed = false;
  if (high.brotliBytes > BUDGET_HIGH_BROTLI) {
    failed = true;
    const heaviest = heaviestStlGroup(path.join(cacheOut, 'stl', 'high'));
    console.error(`FAIL: field.glb (high) is ${high.brotliBytes} brotli bytes > budget ${BUDGET_HIGH_BROTLI}. Heaviest source group: ${heaviest?.name} (${heaviest?.size} bytes raw STL).`);
  }
  if (low.brotliBytes > BUDGET_LOW_BROTLI) {
    failed = true;
    const heaviest = heaviestStlGroup(path.join(cacheOut, 'stl', 'low'));
    console.error(`FAIL: field-low.glb (low) is ${low.brotliBytes} brotli bytes > budget ${BUDGET_LOW_BROTLI}. Heaviest source group: ${heaviest?.name} (${heaviest?.size} bytes raw STL).`);
  }
  if (collidersRaw > BUDGET_COLLIDERS_RAW) {
    failed = true;
    console.error(`FAIL: field-colliders.json is ${collidersRaw} raw bytes > budget ${BUDGET_COLLIDERS_RAW}.`);
  }

  if (failed) process.exit(1);
  log('ALL BUDGETS OK');
}

main();
