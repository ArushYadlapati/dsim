/**
 * `npm test` — BOTH suites, ALWAYS, and a verdict for each.
 *
 * This file exists because of one shape of failure, not because chaining two commands is hard.
 * The script used to be `node scripts/smokeshard.mjs && tsx scripts/smoke-biobuzz/index.ts`, and
 * `&&` means the BIOBUZZ suite does not run at all when the shared suite is red. So a session
 * that broke something in `src/sim/` saw the shared failures, fixed them, and only then found
 * out whether BIOBUZZ was green — and a session that decided the shared failure was unrelated
 * to its change shipped without the BIOBUZZ suite ever having executed. (Commit `b30a3ef` on
 * main is that failure, written up.) The suites are independent: there is no reason the second
 * one's result should be hidden by the first one's.
 *
 * So: run both, unconditionally, print a line per suite, and exit non-zero if EITHER failed.
 * `npm test` still means "both games are green" and a red run still means "physics broke".
 *
 * ── AND AT THE SAME TIME (2026-09-20) ───────────────────────────────────────────────────────
 * They used to run one after the other — 39 s of shared shards, then 69 s of BIOBUZZ in a single
 * process, 110 s of wall for work that shares nothing. BIOBUZZ is sharded by lane now
 * (`bbshard.mjs`) and both runners start together; each buffers its own output, and the two are
 * printed whole, shared first, so a log reads exactly as it did. `--serial` runs them back to
 * back for a box that cannot spare the cores (the perf checks in both suites are measured on a
 * loaded machine either way — `smokeshard.mjs` has always run twelve processes at once).
 *
 * Zero dependencies, and every child is spawned through `process.execPath` with an absolute
 * script path — no `shell: true`, which on Windows would put the repo path (spaces and all)
 * through `cmd.exe` quoting for nothing.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { cpus } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERIAL = process.argv.includes('--serial');

/** run one suite to completion, buffering its output so two suites do not interleave */
function run(label, script, args) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => chunks.push(d));
    // a child killed by a signal has a null status; that is a failure, and `1` is how it reports
    child.on('close', (code) => done({ label, code: code === null ? 1 : code, out: Buffer.concat(chunks) }));
    child.on('error', (e) => done({ label, code: 1, out: Buffer.from(`[test] ${label} could not start: ${e.message}\n`) }));
  });
}

const t0 = Date.now();
/**
 * ONE CORE BUDGET FOR BOTH RUNNERS. Each sizes itself as if it had the box to itself (12 and 6
 * processes, each capped at cores - 1), so together they ask for 18. That fits a 32-thread box
 * and nothing smaller: on 8 threads it was 13 processes, and the timing checks in both suites
 * are the first thing an oversubscribed box fails. Below 18 the budget is split 2:1, the ratio
 * of the defaults. `--serial` runs one at a time, so each keeps its own default.
 */
const BUDGET = Math.max(2, cpus().length - 1);
const split = SERIAL || BUDGET >= 18 ? 0 : Math.max(1, Math.round((BUDGET * 2) / 3));
const suites = [
  ['shared', resolve(ROOT, 'scripts/smokeshard.mjs'), split ? [`--shards=${split}`] : []],
  ['biobuzz', resolve(ROOT, 'scripts/bbshard.mjs'), split ? [`--shards=${Math.max(1, BUDGET - split)}`] : []],
];
const results = [];
if (SERIAL) for (const [label, script, args] of suites) results.push(await run(label, script, args));
else results.push(...(await Promise.all(suites.map(([label, script, args]) => run(label, script, args)))));

for (const r of results) process.stdout.write(r.out);

console.log('');
for (const { label, code } of results) {
  console.log(`${label}: ${code === 0 ? 'PASS' : 'FAIL'} (exit ${code})`);
}
console.log(`[test] wall ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(results.some((r) => r.code !== 0) ? 1 : 0);
