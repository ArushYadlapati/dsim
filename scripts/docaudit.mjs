/**
 * DOC ROUTING AUDIT — `npm run docaudit`. Zero dependencies, same shape as `uiaudit.mjs`
 * and `contrast.mjs`, and deliberately NOT wired into `npm test` for the same reason: a red
 * `npm test` must keep meaning "physics broke".
 *
 * ── WHAT IT IS PROTECTING ─────────────────────────────────────────────────────
 * On 2026-09-16 `CLAUDE.md` was split. It had reached 2,206 lines (~43,700 tokens) and it is
 * loaded into EVERY session, so every session paid for DECODE's gate-lever geometry whether
 * it went near a gate or not. The deep rules moved into `docs/area/*.md`, read on demand, and
 * the core kept what is true everywhere plus a routing table.
 *
 * That trade is only safe while the routing is TRUE. A rule that has moved into a guide
 * nobody is told to read has not been relocated, it has been deleted — silently, and with no
 * symptom until something that was written down because it shipped once ships again. So the
 * things that would make the routing a lie are all checked here:
 *
 *   1. every guide is reachable from CLAUDE.md, and every link in CLAUDE.md resolves;
 *   2. every guide says which paths it governs, and those globs still match real files —
 *      this is what catches a directory RENAME, which otherwise leaves a guide silently
 *      governing nothing;
 *   3. no source directory has fallen through the gaps, so a NEW area cannot quietly end up
 *      with no guide at all;
 *   4. CLAUDE.md stays inside a token budget.
 *
 * ── WHY (4) IS A RATCHET ──────────────────────────────────────────────────────
 * The same reasoning `uiaudit` uses. A fixed budget is either so tight it has to be raised
 * (and a check that gets raised is not a check) or so loose it never fires. So the budget is
 * the size measured when it was last lowered: the audit fails if CLAUDE.md grows past it, and
 * tells you to lower it when it shrinks. The file can only get leaner.
 *
 * Nothing here reads the PROSE. It cannot tell you a guide is wrong, only that it is
 * unreachable, unowned, stale in its paths, or that the core is growing back.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * TOKEN BUDGET for CLAUDE.md, in bytes. ~4 bytes/token, so this is ~6.75k tokens against the
 * ~43.7k the file was before the split. LOWER IT when the file shrinks; do not raise it — if a
 * rule genuinely has to live in the core, something else in the core is no longer core.
 *
 * Set ~700 bytes above the measured size, not flush against it. A budget with no headroom
 * fails on the next one-line correction and gets raised the first time it fires, and a check
 * that gets raised is not a check — the same trap `uiaudit`'s baselines are written to avoid.
 * 700 bytes is a couple of lines of genuine core rule; the SMALLEST section that was moved out
 * is 2.3 KB, so nothing section-sized can come back without tripping this.
 */
const CLAUDE_BUDGET_BYTES = 27_000;

/** directories whose contents need no area guide, with the reason. */
const UNGOVERNED = {
  'src/vite-env.d.ts': 'ambient Vite types, no rules',
  'src/assets': 'binary artwork; sponsor.md covers the pieces under contract',
};

const AREA_DIR = 'docs/area';
const CLAUDE = 'CLAUDE.md';

let failures = 0;
const fail = (rule, msg) => {
  console.log(`FAIL  ${rule}\n      ${msg}`);
  failures++;
};
const pass = (rule, detail = '') => console.log(`PASS  ${rule}${detail ? ` — ${detail}` : ''}`);

const claude = readFileSync(CLAUDE, 'utf8');
const guides = readdirSync(AREA_DIR)
  .filter((f) => f.endsWith('.md'))
  .map((f) => join(AREA_DIR, f).replace(/\\/g, '/'));

// ---- 1. every guide declares what it governs -------------------------------
/** guide -> globs */
const governs = new Map();
for (const g of guides) {
  const first = readFileSync(g, 'utf8').split('\n')[0];
  const m = /^<!--\s*governs:\s*(.+?)\s*-->$/.exec(first.trim());
  if (!m) {
    fail('governs: every area guide declares the paths it governs on line 1', `${g} has no \`<!-- governs: … -->\` line`);
    continue;
  }
  governs.set(g, m[1].split(',').map((s) => s.trim()).filter(Boolean));
}
if (governs.size === guides.length) pass('governs: every area guide declares the paths it governs', `${guides.length} guides`);

// ---- 2. every guide is routed from CLAUDE.md, and every link resolves -------
{
  const unrouted = guides.filter((g) => !claude.includes(g));
  if (unrouted.length)
    fail('routing: every area guide is linked from CLAUDE.md', `not linked: ${unrouted.join(', ')} — a guide nobody is sent to is a deleted rule`);
  else pass('routing: every area guide is linked from CLAUDE.md', `${guides.length} routed`);
}
{
  // markdown links + inline-code paths that look like repo files
  const targets = new Set();
  for (const m of claude.matchAll(/\]\((docs\/[^)#]+)\)/g)) targets.add(m[1]);
  for (const m of claude.matchAll(/`(docs\/[A-Za-z0-9._/-]+\.md)`/g)) targets.add(m[1]);
  const dead = [...targets].filter((t) => !existsSync(t));
  if (dead.length) fail('routing: every doc CLAUDE.md points at exists', `missing: ${dead.join(', ')}`);
  else pass('routing: every doc CLAUDE.md points at exists', `${targets.size} checked`);
}

// ---- 3. the globs still match something, and nothing is unowned ------------
/** minimal glob -> RegExp: ** = any depth, * = one segment */
const rx = (glob) =>
  new RegExp(
    '^' +
      glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        // ONE pass rather than a placeholder round-trip: the obvious placeholder is a NUL,
        // and a NUL byte is how a text file talks git into treating it as binary.
        .replace(/\*\*|\*/g, (m) => (m === '**' ? '.*' : '[^/]*')) +
      '$',
  );

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
/** every file a `governs:` glob could name. NOT extension-filtered and NOT limited to
 *  src+server: guides legitimately govern `scripts/smoke-biobuzz/**`, `electron/**` and the
 *  sponsor artwork, and an extension filter made those globs unmatchable — which the audit
 *  then reported as a stale path. */
const universe = ['src', 'server', 'scripts', 'electron'].filter(existsSync).flatMap((d) => walk(d));
/** the subset that is CODE, which is what coverage is asked about */
const sources = universe.filter((f) => /\.(ts|tsx)$/.test(f) && (f.startsWith('src/') || f.startsWith('server/')));

{
  const empty = [];
  for (const [g, globs] of governs) {
    for (const glob of globs) {
      if (!glob.startsWith('src/') && !glob.startsWith('server/') && !glob.startsWith('scripts/') && !glob.startsWith('electron/')) continue;
      const r = rx(glob);
      const hits = glob.includes('*') ? universe.some((f) => r.test(f)) : existsSync(glob);
      if (!hits) empty.push(`${g} → ${glob}`);
    }
  }
  if (empty.length)
    fail('governs: every declared path still exists', `${empty.join('; ')} — a renamed directory leaves its guide governing nothing, which reads exactly like having no rules`);
  else pass('governs: every declared path still exists');
}

{
  /* Asked per FILE, not per directory. A directory-level question cannot see a loose
     top-level module — `src/standing.ts` and `src/dodge.ts` carry real rules and belonged to
     accounts.md, and a check that grouped by directory would have called `src/` covered
     because `src/ui/` is. */
  const all = [...governs.values()].flat().map(rx);
  const unowned = sources.filter(
    (f) => !Object.keys(UNGOVERNED).some((u) => f === u || f.startsWith(u + '/')) && !all.some((r) => r.test(f)),
  );
  if (unowned.length)
    fail(
      'coverage: every source file is governed by an area guide',
      `${unowned.length} unowned: ${unowned.slice(0, 12).join(', ')}${unowned.length > 12 ? ' …' : ''}
      Add the path to the guide that owns it, or list it in UNGOVERNED here with the reason.`,
    );
  else pass('coverage: every source file is governed by an area guide', `${sources.length} files`);
}

// ---- 4. the core stays lean ------------------------------------------------
{
  const n = statSync(CLAUDE).size;
  const tok = Math.round(n / 4);
  if (n > CLAUDE_BUDGET_BYTES)
    fail(
      'budget: CLAUDE.md stays inside its token budget',
      `${n} bytes (~${tok} tok) over the ${CLAUDE_BUDGET_BYTES}-byte budget. Move the new rule into the guide for the path it governs — the test is whether a session working somewhere ELSE needs to know it.`,
    );
  else {
    pass('budget: CLAUDE.md stays inside its token budget', `${n} / ${CLAUDE_BUDGET_BYTES} bytes (~${tok} tok)`);
    if (n < CLAUDE_BUDGET_BYTES - 1500)
      console.log(`      ↓ it is well under — lower CLAUDE_BUDGET_BYTES to ${Math.ceil((n + 500) / 100) * 100} to keep the ratchet tight.`);
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
