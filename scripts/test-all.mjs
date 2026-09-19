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
 * `npm test` still means "both games are green" and a red run still means "physics broke" —
 * the only thing that changes is that you now learn it about both suites in one run.
 *
 * Zero dependencies, and every child is spawned through `process.execPath` with an absolute
 * script path — no `shell: true`, which on Windows would put the repo path (spaces and all)
 * through `cmd.exe` quoting for nothing. `tsx` is invoked the way `smokeshard.mjs` invokes it:
 * its own `dist/cli.mjs` under this node, so there is no `.cmd` shim in the picture either.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TSX = resolve(ROOT, 'node_modules/tsx/dist/cli.mjs');

/** run one suite to completion, inheriting stdio so its own output is the run's output */
function run(label, args) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  // a child killed by a signal has a null status; that is a failure, and `1` is how it reports
  const code = r.status === null ? 1 : r.status;
  if (r.error) console.error(`[test] ${label} could not start:`, r.error.message);
  return { label, code };
}

const results = [
  run('shared', [resolve(ROOT, 'scripts/smokeshard.mjs')]),
  run('biobuzz', [TSX, resolve(ROOT, 'scripts/smoke-biobuzz/index.ts')]),
];

console.log('');
for (const { label, code } of results) {
  console.log(`${label}: ${code === 0 ? 'PASS' : 'FAIL'} (exit ${code})`);
}
process.exit(results.some((r) => r.code !== 0) ? 1 : 0);
