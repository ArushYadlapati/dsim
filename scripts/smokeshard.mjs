/**
 * SHARDED SMOKE RUNNER — the same checks, across cores, in a fraction of the wall clock.
 *
 * `scripts/smoke.ts` is ~1,770 checks and takes about 3m40s on one core, which is most of
 * the cost of `npm test` (the BIOBUZZ suite beside it is 16s). Three and a half minutes is
 * long enough that the suite stops being run after a change, which is the expensive failure
 * — the point of a fast suite is that it is cheap enough to always run.
 *
 * WHY SHARDING IS SAFE HERE, and this is the whole argument:
 *
 * `smoke.ts`'s top level is 360 statements, and 257 of them are BARE BLOCKS (`{ ... }`) or
 * one `for…of` — each a closed scope that declares nothing anybody else can see. The other
 * 103 are the PREAMBLE: 75 imports, `await initPhysics()`, `let failures = 0`, 13 helper
 * functions and 12 helper consts (`cmd`, `mkWorld`, `setup`, `PIN_CMDS`, …), all pure. The
 * only module-level mutable state in the file is `failures`, which every block writes and
 * none reads. So a block's behaviour depends on the preamble and on nothing else, and the
 * blocks can be dealt out across processes without changing what any of them does.
 *
 * This runner therefore does not transform any test code. It parses `smoke.ts` with the
 * TypeScript compiler's own parser, keeps every preamble statement VERBATIM in every shard,
 * gives each shard a disjoint subset of the blocks, and runs them in parallel.
 *
 * ⚠️ THE FAILURE THIS GUARDS AGAINST IS A SILENTLY DROPPED BLOCK. A shard runner that loses
 * a block still prints ALL PASS, which is worse than being slow. Two structural guards:
 * every unit is asserted to be assigned to exactly one shard (a set-equality check against
 * the parse, not a count), and the runner refuses to report success if any shard died
 * without printing its own verdict. The check TOTAL is printed on every run and compared
 * against `--expect=N` when given, so drift is visible rather than silent.
 *
 * ORDER IS NOT A DEPENDENCY, BUT IT IS PRESERVED ANYWAY: within a shard the blocks run in
 * source order, and the preamble keeps its own relative order ahead of them. Hoisting the
 * helpers above every block is strictly safer than the original, never less safe — a block
 * that ran before a `const` helper was declared could not have used it.
 *
 * Usage:
 *   node scripts/smokeshard.mjs                 # shard across the default worker count
 *   node scripts/smokeshard.mjs --shards=8      # pick the width
 *   node scripts/smokeshard.mjs --verbose       # every PASS line, not just the summary
 *   node scripts/smokeshard.mjs --calibrate     # re-measure per-block cost for bin-packing
 *   node scripts/smokeshard.mjs --file=scripts/smoke.ts --expect=1765
 *
 * Quiet by default: a green run prints a few lines, not 1,770. Failures always print in
 * full, with the shard they came from.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const TARGET = arg('file', 'scripts/smoke.ts');
const VERBOSE = flag('verbose');
const CALIBRATE = flag('calibrate');
const EXPECT = arg('expect', '');
/**
 * Default width. Not `cpus().length`: each shard is a full `tsx` process that transpiles its own
 * copy of the preamble and initialises Rapier's WASM, so past a point another shard buys less
 * than it costs, and a dev box is not exclusively ours.
 *
 * Measured on a 32-thread machine against a 223s serial run: 4 shards 54.6s · 8 shards 28.6s ·
 * 12 shards 23.4s · 16 shards 24.5s. It stops improving at 12 because of a FLOOR that no width
 * can cross — the single most expensive block is 22.4s on its own, and a block is indivisible
 * here. Going wider past that only adds process startup. (If this suite ever needs to be faster
 * than ~22s, the lever is splitting that one block, not more shards.)
 */
const SHARDS = Math.max(1, Number(arg('shards', String(Math.min(12, Math.max(1, cpus().length - 1))))));

const COST_FILE = join(HERE, 'smoke-shard-costs.json');

// ---- parse ----------------------------------------------------------------

const srcPath = resolve(ROOT, TARGET);
const source = readFileSync(srcPath, 'utf8');
const sf = ts.createSourceFile(TARGET, source, ts.ScriptTarget.ESNext, true);

/** A statement is a WORK UNIT if it is a bare block or a top-level loop: a closed scope that
 *  runs checks. Everything else is preamble, except the trailing report/exit pair. */
const isUnit = (s) =>
  s.kind === ts.SyntaxKind.Block ||
  s.kind === ts.SyntaxKind.ForOfStatement ||
  s.kind === ts.SyntaxKind.ForStatement ||
  s.kind === ts.SyntaxKind.ForInStatement;

const statements = sf.statements;
/** the tail that reports and exits — regenerated per shard, never copied */
const epilogueFrom = (() => {
  let i = statements.length;
  while (i > 0 && !isUnit(statements[i - 1])) i--;
  return i;
})();

const preamble = [];
const units = [];
for (let i = 0; i < epilogueFrom; i++) {
  const s = statements[i];
  const text = source.slice(s.getFullStart(), s.getEnd());
  if (isUnit(s))
    units.push({
      index: units.length,
      text,
      line: sf.getLineAndCharacterOfPosition(s.getStart(sf)).line + 1,
      /* Cost is keyed by the block's own CONTENT, not its line number. Keyed by line, adding a
         check near the top of the file shifts every block below it and silently throws the whole
         table away — the run still passes, it just packs badly, which is exactly the kind of rot
         nobody notices. Keyed by content, editing one block invalidates one entry. */
      /* ⚠️ HASHED WITH LINE ENDINGS NORMALISED. Keyed on the raw text, a table calibrated in a
         CRLF checkout matched NOTHING in an LF one (and the reverse): on 2026-09-20 all 281
         blocks read "uncalibrated", every block was costed at the median, and the packer had been
         packing blind — per-shard checks 76–444 — while the run stayed green. */
      key: createHash('sha1').update(text.replace(/\r\n/g, '\n')).digest('hex').slice(0, 12),
    });
  else preamble.push(text);
}

if (units.length === 0) {
  console.error(`smokeshard: parsed no work units out of ${TARGET} — refusing to report a pass.`);
  process.exit(2);
}

/**
 * THE INDEPENDENCE GUARD, and the reason this runner can be trusted as the default.
 *
 * Everything above rests on one property of `smoke.ts`: no state crosses a block boundary. The
 * structural partition check below catches a block this runner DROPS, but it cannot catch the
 * other way of being wrong — a block that legitimately depends on something an earlier block
 * did. That dependency would simply stop holding once the two land in different processes, and
 * the suite would go green while testing something else.
 *
 * So the property is asserted rather than assumed, against the only two shapes that can carry
 * state across blocks at the top level: a mutable binding, and a bare side-effecting call. Both
 * have exactly one legitimate instance today (`failures`, `await initPhysics()`). Anything new
 * STOPS the run and says what to do about it, because a suite that quietly proves less than it
 * used to is worse than one that refuses to start.
 */
{
  const complaints = [];
  for (let i = 0; i < epilogueFrom; i++) {
    const s = statements[i];
    if (isUnit(s)) continue;
    const at = `${TARGET}:${sf.getLineAndCharacterOfPosition(s.getStart(sf)).line + 1}`;
    if (ts.isVariableStatement(s)) {
      const mutable = !(s.declarationList.flags & ts.NodeFlags.Const);
      const names = s.declarationList.declarations.map((d) => d.name.getText(sf));
      if (mutable && !names.every((n) => n === 'failures'))
        complaints.push(`${at}: top-level mutable binding \`${names.join(', ')}\`. Blocks run in separate processes, so state one block writes is invisible to the next. Move it inside the block that owns it, or make it \`const\`.`);
    } else if (ts.isExpressionStatement(s)) {
      const text = s.getText(sf).replace(/\s+/g, ' ').trim();
      if (!/^await initPhysics\(\);?$/.test(text))
        complaints.push(`${at}: top-level side effect \`${text.slice(0, 60)}\`. It will run once per shard. If that is intended (setup every shard needs) add it to the allowlist here; if it is a one-off, move it into a block.`);
    }
  }
  if (complaints.length) {
    console.error(`smokeshard: ${TARGET} no longer satisfies the independence the sharding relies on:\n`);
    for (const c of complaints) console.error(`  - ${c}`);
    console.error(`\nRun the suite serially instead (npm run test:serial) until this is resolved.`);
    process.exit(2);
  }
}

// ---- assign ---------------------------------------------------------------

/** measured per-unit milliseconds from the last `--calibrate`, keyed by block content hash */
let costs = {};
if (existsSync(COST_FILE)) {
  try {
    costs = JSON.parse(readFileSync(COST_FILE, 'utf8')).byBlock ?? {};
  } catch {
    costs = {};
  }
}
/** An unknown block is costed at the MEDIAN, not at zero. A newly added block is far more
 *  likely to be ordinary than free, and costing it zero packs every new block into one shard. */
const known = units.map((u) => costs[u.key]).filter((v) => typeof v === 'number').sort((a, b) => a - b);
const median = known.length ? known[known.length >> 1] : 1;
const costOf = (u) => costs[u.key] ?? median;

// `--costs[=N]`: WHERE THE TIME GOES. The N most expensive blocks with the line each starts on —
// the table is keyed by content hash, which says nothing to a reader. Prints and exits.
if (arg('costs', '')) {
  const n = Number(arg('costs', '')) || 25;
  const total = units.reduce((a, u) => a + costOf(u), 0);
  console.log(`${units.length} blocks, ${(total / 1000).toFixed(0)}s of CPU (last calibration); the top ${n}:`);
  for (const u of [...units].sort((a, b) => costOf(b) - costOf(a)).slice(0, n)) {
    const first = u.text.trim().split(/\r?\n/).find((l) => /\S/.test(l.replace(/^[{\s]*/, ''))) ?? '';
    console.log(`${(costOf(u) / 1000).toFixed(1).padStart(6)}s  ${TARGET}:${u.line}  ${costs[u.key] === undefined ? '(uncalibrated) ' : ''}${first.trim().slice(0, 90)}`);
  }
  process.exit(0);
}

/**
 * Calibration runs at the SAME width as an ordinary run, not serially. The greedy packer only
 * needs the blocks' cost ORDER, and running eight processes skews every block's measurement by
 * roughly the same contention factor — so a 60s calibration buys the same packing a 220s
 * serial one would, and a cost table nobody waits four minutes for is a cost table that gets
 * refreshed. Pass `--shards=1` for the unskewed measurement.
 */
const width = SHARDS;
const buckets = Array.from({ length: width }, () => ({ units: [], cost: 0 }));
if (width === 1) {
  buckets[0].units = units.slice();
} else {
  // longest-processing-time-first: the classic greedy makespan heuristic. With a calibrated
  // cost table this lands every shard within a few percent of the mean; without one it
  // degenerates to round-robin, which is still correct, just lumpier.
  for (const u of [...units].sort((a, b) => costOf(b) - costOf(a))) {
    const b = buckets.reduce((lo, x) => (x.cost < lo.cost ? x : lo), buckets[0]);
    b.units.push(u);
    b.cost += costOf(u);
  }
  for (const b of buckets) b.units.sort((x, y) => x.index - y.index);
}

// STRUCTURAL GUARD: every unit assigned exactly once. Set equality against the parse, not a
// count — a bug that dropped one unit and duplicated another would pass a count.
{
  const seen = new Set();
  let dupes = 0;
  for (const b of buckets) for (const u of b.units) (seen.has(u.index) ? dupes++ : seen.add(u.index));
  const missing = units.filter((u) => !seen.has(u.index));
  if (dupes || missing.length) {
    console.error(`smokeshard: assignment is not a partition (${missing.length} missing, ${dupes} duplicated) — refusing to run.`);
    process.exit(2);
  }
}

// ---- emit + run -----------------------------------------------------------

const work = mkdtempSync(join(tmpdir(), 'dsim-smokeshard-'));
const banner = (i) =>
  `\n/* ---- generated by scripts/smokeshard.mjs — shard ${i + 1}/${width}, ` +
  `${buckets[i].units.length} of ${units.length} blocks. Do not edit; edit ${TARGET}. ---- */\n`;

const files = buckets.map((b, i) => {
  const body = [
    preamble.join(''),
    banner(i),
    ...b.units.map((u) =>
      CALIBRATE
        ? `\n{ const __t = Date.now(); try {${u.text}\n} finally { console.error('##UNIT ${u.key} ' + (Date.now() - __t)); } }\n`
        : u.text,
    ),
    `\nconsole.log(failures === 0 ? '\\nSHARD OK' : '\\n' + failures + ' FAILURES');\n`,
    `process.exit(failures === 0 ? 0 : 1);\n`,
  ].join('');
  // The shard must sit in the same directory as the original so every relative import and
  // every `readFileSync('src/...')` in a check resolves exactly as it did before.
  const p = resolve(ROOT, `scripts/.smokeshard-${i + 1}.ts`);
  writeFileSync(p, body);
  return p;
});

const cleanup = () => {
  for (const f of files) rmSync(f, { force: true });
  rmSync(work, { recursive: true, force: true });
};
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

const tsxBin = resolve(ROOT, 'node_modules/tsx/dist/cli.mjs');
const t0 = Date.now();

const runShard = (file, i) =>
  new Promise((done) => {
    const child = spawn(process.execPath, [tsxBin, file], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    const marks = [];
    let tail = '';
    child.stdout.on('data', (d) => out.push(String(d)));
    child.stderr.on('data', (d) => {
      const s = String(d);
      tail += s;
      for (const m of s.matchAll(/##UNIT ([0-9a-f]+) (\d+)/g)) marks.push([m[1], Number(m[2])]);
    });
    child.on('close', (code) => {
      const text = out.join('');
      const lines = text.split(/\r?\n/);
      done({
        i,
        code,
        marks,
        stderr: tail,
        verdict: lines.some((l) => l === 'SHARD OK' || /^\d+ FAILURES$/.test(l)),
        pass: lines.filter((l) => l.startsWith('PASS  ')).length,
        fail: lines.filter((l) => l.startsWith('FAIL  ')),
        all: lines,
      });
    });
  });

const results = await Promise.all(files.map(runShard));
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

if (CALIBRATE) {
  const byBlock = {};
  for (const r of results) for (const [key, ms] of r.marks) byBlock[key] = ms;
  writeFileSync(COST_FILE, JSON.stringify({ measuredAt: new Date().toISOString(), file: TARGET, byBlock }, null, 1));
  console.log(`smokeshard: calibrated ${Object.keys(byBlock).length} blocks into ${COST_FILE}`);
}

// ---- report ---------------------------------------------------------------

const totalPass = results.reduce((a, r) => a + r.pass, 0);
const failures = results.flatMap((r) => r.fail.map((l) => [r.i, l]));
const total = totalPass + failures.length;
const crashed = results.filter((r) => !r.verdict);

if (VERBOSE) for (const r of results) for (const l of r.all) if (l) console.log(l);

for (const [shard, line] of failures) console.log(`[shard ${shard + 1}] ${line}`);

for (const r of crashed) {
  console.log(`\n[shard ${r.i + 1}] DIED without a verdict (exit ${r.code}). Last output:`);
  console.log(
    r.all
      .filter(Boolean)
      .slice(-4)
      .map((l) => `  ${l}`)
      .join('\n'),
  );
  const err = r.stderr.replace(/##UNIT [0-9a-f]+ \d+\n?/g, '').trim();
  if (err) console.log(err.split(/\r?\n/).slice(-25).map((l) => `  ${l}`).join('\n'));
}

const spread = results.map((r) => r.pass + r.fail.length);
console.log(
  `\n${total} checks across ${width} shard${width > 1 ? 's' : ''} in ${elapsed}s ` +
    `(blocks ${units.length}, per-shard checks ${Math.min(...spread)}–${Math.max(...spread)})`,
);

let bad = failures.length > 0 || crashed.length > 0;
if (EXPECT && total !== Number(EXPECT)) {
  console.log(`EXPECTED ${EXPECT} checks, ran ${total} — a block may have been added, removed or dropped.`);
  bad = true;
}
console.log(bad ? `${failures.length} FAILURES` : 'ALL PASS');
process.exit(bad ? 1 : 0);
