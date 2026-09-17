/**
 * BUNDLE AUDIT — `npm run bundleaudit`. Zero dependencies, same ratchet shape as
 * `scripts/uiaudit.mjs` (see that file's header for why a ratchet rather than a hard cap).
 *
 * Needs a PRIOR `npm run build` — it reads `dist/assets/`, it does not produce it. Run
 *   npm run build && npm run bundleaudit
 * If `dist/assets` is missing this fails immediately with that instruction, rather than
 * silently reporting zero chunks as a clean bill.
 *
 * ── WHY THIS EXISTS (Day 1 seam, `docs/biobuzz/plan-3d.md` §2.5) ────────────────────────
 * BIOBUZZ's 3D physics (`@dimforge/rapier3d-deterministic-compat`, ~1.1 MB gzipped) and its
 * Three.js scene (budgeted ≤ 250 KB gzipped) are both reached only through a dynamic
 * `import()` — a 2D-view player who never steps a 3D world locally must never pay for
 * either chunk. That is a STATEMENT ABOUT THE BUNDLE GRAPH, and the only thing that can
 * check a statement about the bundle graph is something that reads the built bundle. A
 * regression here (a static import that drags the wasm into the main chunk, the way
 * `--ds-font` silently broke a `font:` shorthand for months) would not fail a single test —
 * every game still plays, every check still passes — it would just make the MAIN CHUNK,
 * the one every player of every game downloads, quietly grow by a megabyte.
 *
 * ── ROUTES, BY CONTENT NOT FILENAME ──────────────────────────────────────────────────────
 * Vite hashes every chunk's filename per build, so matching on a hash is a script that
 * breaks the day after it is written. Route by what a chunk actually contains instead:
 *   main       — the entry chunk (`index-*.js` at the top of `dist/assets`)
 *   hostWorker — the LAN host worker (`hostWorker-*.js`, its own Vite worker entry)
 *   physics3d  — a chunk (or wasm asset) whose bytes carry a rapier3d marker
 *   scene      — a chunk whose bytes carry a Three.js marker (`WebGLRenderer`)
 *   other      — everything else. In practice this is empty: `@dimforge/rapier2d-compat` is a
 *                STATIC import (`src/sim/physicsEngine.ts`), so the 2D physics engine lives
 *                inside `main` already and always has (that is existing, unchanged behavior,
 *                not something this audit needs to gate) — CSS/fonts/images are not `.js`/
 *                `.wasm` and are never read here at all.
 * A `.wasm` file's bytes are checked as a byte string (ASCII substrings survive a raw
 * buffer scan regardless of the surrounding binary), and its FILENAME is checked too —
 * wasm-pack/rapier's compat packages name their `.wasm` asset after the source module, so
 * the filename alone is already a strong (and cheap) signal before the content scan runs.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const DIST = 'dist';
const ASSETS = join(DIST, 'assets');

if (!existsSync(ASSETS)) {
  console.error(`bundleaudit: ${ASSETS} does not exist.`);
  console.error('Run `npm run build` first — this audit reads a build, it does not produce one.');
  process.exit(1);
}

/**
 * ASCII markers, matched as raw byte substrings so they survive being read out of a
 * minified/mangled JS chunk OR out of a compiled `.wasm` binary's own import/name strings.
 *
 * `rapier_wasm3d` is the deterministic compat build's own wasm-bindgen glue naming its
 * source files (`rapier_wasm3d_bg.wasm` / `.js` — found by inspecting a real built chunk,
 * `dist/assets/rapier-<hash>.js`, which Vite names after the package's own facade module and
 * NOT after "rapier3d" — so a filename match alone would miss it). `rapier3d`/`dimforge` are
 * kept as a fallback in case a future package version renames the wasm-bindgen output; they
 * did NOT fire against the build this was measured on.
 */
const MARKERS = {
  physics3d: ['rapier_wasm3d', 'rapier3d', 'RAPIER3D', 'dimforge'],
  scene: ['WebGLRenderer', 'THREE.Scene', 'three.module'],
};

/** does `buf` contain any of `needles`, scanned as raw bytes (works for text OR wasm)? */
function containsAny(buf, needles) {
  for (const needle of needles) {
    if (buf.includes(Buffer.from(needle, 'latin1'))) return true;
  }
  return false;
}

function routeFor(file, buf) {
  const base = file;
  if (/^index-[^/]*\.js$/.test(base)) return 'main';
  if (/^hostWorker-[^/]*\.js$/.test(base)) return 'hostWorker';
  // filename-first for a standalone `.wasm` asset (cheap, and a real one would be named after
  // its source module, e.g. `rapier_wasm3d_bg-<hash>.wasm`), then a content scan for both .js
  // and .wasm alike — content is what actually decided this in the measured build, where the
  // physics chunk landed as `rapier-<hash>.js` (Vite's own facade-module naming, not a
  // "rapier3d" filename at all).
  if (/rapier/i.test(base) && base.endsWith('.wasm')) return 'physics3d';
  if (containsAny(buf, MARKERS.physics3d)) return 'physics3d';
  if (containsAny(buf, MARKERS.scene)) return 'scene';
  return 'other';
}

const files = readdirSync(ASSETS).filter((f) => f.endsWith('.js') || f.endsWith('.wasm'));
if (files.length === 0) {
  console.error(`bundleaudit: no .js or .wasm files under ${ASSETS}. Run \`npm run build\` first.`);
  process.exit(1);
}

/** route -> [{file, raw, gzip}] */
const byRoute = new Map();
for (const f of files) {
  const p = join(ASSETS, f);
  const buf = readFileSync(p);
  const route = routeFor(f, buf);
  const raw = statSync(p).size;
  const gzip = gzipSync(buf, { level: 9 }).length;
  if (!byRoute.has(route)) byRoute.set(route, []);
  byRoute.get(route).push({ file: f, raw, gzip });
}

// DECIMAL kB (1000 bytes), matching Vite's own build-log units and every budget number in
// `docs/biobuzz/plan-3d.md` §2.5 ("main chunk 903 KB", "physics chunk about 1.1 MB",
// "renderer chunk at most 250 KB") — a binary KiB would silently disagree with every number
// this script is compared against by about 2.4%, which is most of a ratchet's tolerance.
const fmtKB = (bytes) => `${(bytes / 1000).toFixed(2)} KB`;

/**
 * BASELINE, gzip-9 bytes per route — a RATCHET like `uiaudit.mjs`'s: fails when a route's
 * TOTAL gzip exceeds baseline + max(2%, 4 KB), reports "lower the baseline" when it drops by
 * more than 5%.
 *
 * MEASURED on the build this Day 1 seam produces with Lane A's `sim3d/`, Lane B's `scene/`
 * (merged `a6cb4d4`) and this lane's wiring all present — `npm run build && npm run
 * bundleaudit`, 2026-09-17:
 *   main       904.40 KB — `dist/assets/index-*.js`. Matches the ~904.17 KB this lane's brief
 *              was measured against (the ~0.2 KB gap is noise between two builds of the same
 *              tree, not a regression to chase).
 *   hostWorker 699.38 KB — `dist/assets/hostWorker-*.js`. Untouched by this lane; measured
 *              here for the first time (no prior bundleaudit existed to carry a baseline).
 *   physics3d 1089.27 KB — `dist/assets/rapier-*.js` (the `@dimforge/rapier3d-deterministic-
 *              compat` chunk). Present in this build BECAUSE this lane's `GameView`/`game.ts`
 *              wiring is what makes `initPhysics3d()` reachable at all — before it, nothing
 *              called it and the chunk did not exist. ≈ 1.09 MB, exactly the plan's estimate.
 *   scene      135.77 KB — `dist/assets/renderScene-*.js` (Lane B's Three.js renderer). Well
 *              under the §2.5 spec ceiling of 250 KB; the ceiling is kept as `budgetCeiling`
 *              below for context, but the RATCHET binds to the measurement, same as every
 *              other route — a budget is not a target.
 * `other` has no route in a healthy build (all four chunks above account for every `.js`/
 * `.wasm` file) — baseline near zero, so anything landing here at all is worth a look.
 *
 * RECALIBRATE by running `npm run build && npm run bundleaudit` and copying the printed gzip
 * totals in here, the same way `uiaudit.mjs`'s header describes lowering ITS baseline.
 */
const BASELINE = {
  main: { gzip: 904.4 * 1000 },
  hostWorker: { gzip: 699.38 * 1000 },
  physics3d: { gzip: 1089.27 * 1000 },
  scene: { gzip: 135.77 * 1000, budgetCeiling: 250 * 1000 },
  other: { gzip: 1 * 1000 },
};

console.log('BUNDLE AUDIT — docs/biobuzz/plan-3d.md §2.5\n');
console.log('route        file                                              raw        gzip');
console.log('-----        ----                                              ---        ----');
for (const route of Object.keys(BASELINE)) {
  const entries = byRoute.get(route) ?? [];
  for (const e of entries) {
    console.log(
      `${route.padEnd(12)} ${e.file.padEnd(48)} ${fmtKB(e.raw).padStart(9)}  ${fmtKB(e.gzip).padStart(9)}`,
    );
  }
}
// anything that fell through to `other` beyond what BASELINE listed above is still printed —
// `other` is a bucket, not a single file, so list every member.
console.log();

let failed = 0;
let ratcheted = 0;
for (const [route, base] of Object.entries(BASELINE)) {
  const entries = byRoute.get(route) ?? [];
  const totalGzip = entries.reduce((sum, e) => sum + e.gzip, 0);
  if (entries.length === 0) {
    // ABSENT is not a failure — a route with no reachable call site in THIS build (e.g.
    // `physics3d` in any build that never reaches `initPhysics3d()`, or `scene` in a build
    // where nothing mounts a 3D view) is correctly absent, not broken. Print the SPEC ceiling
    // when there is one and no measurement to fall back on; otherwise the last baseline.
    console.log(`·  ${route.padEnd(12)} absent (budget ${fmtKB(base.budgetCeiling ?? base.gzip)})`);
    continue;
  }
  const tolerance = Math.max(base.gzip * 0.02, 4 * 1000);
  const over = totalGzip > base.gzip + tolerance;
  const under = totalGzip < base.gzip * 0.95;
  const state = over ? 'FAIL' : under ? 'IMPROVED' : 'ok';
  if (over) failed++;
  if (under) ratcheted++;
  const ceiling = base.budgetCeiling ? `  (spec ceiling ${fmtKB(base.budgetCeiling)})` : '';
  console.log(
    `${state === 'FAIL' ? '✗' : state === 'IMPROVED' ? '↓' : '·'}  ${route.padEnd(12)} ${fmtKB(totalGzip).padStart(9)} / ${fmtKB(base.gzip).padStart(9)} baseline${ceiling}`,
  );
}

console.log();
if (failed) {
  console.log(`${failed} route(s) grew past baseline + tolerance. Find what pulled it in —`);
  console.log('a static import where a dynamic one belongs is the usual cause — or, if the');
  console.log('growth is real and wanted, raise the BASELINE here and say so in the commit.');
  process.exit(1);
}
if (ratcheted) {
  console.log(`${ratcheted} route(s) shrank by more than 5% — lower the BASELINE in`);
  console.log('scripts/bundleaudit.mjs to lock it in, the same way uiaudit.mjs asks.');
  process.exit(1);
}
console.log('ALL ROUTES AT OR UNDER BASELINE');
