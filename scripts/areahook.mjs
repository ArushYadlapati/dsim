/**
 * AREA-GUIDE HOOK — the backstop for the CLAUDE.md split.
 *
 * On 2026-09-16 the deep rules moved out of `CLAUDE.md` (2,206 lines, ~43,700 tokens, loaded
 * into every session) and into `docs/area/*.md`, read on demand. The routing table in
 * CLAUDE.md is the primary mechanism and is loaded every session. This is the second one: it
 * watches what is actually being EDITED and names the guide for it, once per area per session.
 *
 * Why bother when the table is already in CLAUDE.md: the failure this is guarding against is
 * silent and expensive. A rule that has moved into a guide nobody opened has not been
 * relocated, it has been deleted — and almost every paragraph in those guides is a bug that
 * shipped once and was written down so it would not ship twice. The table asks to be
 * remembered at the moment work starts; this fires at the moment the file is touched, which is
 * when it is actually relevant.
 *
 * It is a REMINDER, never a block. PostToolUse, `additionalContext`, always exit 0: a hook
 * that can fail a turn over documentation would be a worse problem than the one it solves.
 * Registered in `.claude/settings.local.json` with the same `[ ! -f … ] ||` guard as its
 * neighbours, so deleting this file disables it cleanly.
 *
 * Dedupe is per (session, guide) via a marker directory under the OS temp dir — so a session
 * that edits twenty files under `src/sim/` is told about `physics.md` once, not twenty times.
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const AREA = join(ROOT, 'docs', 'area');

/** never let a documentation reminder be the thing that breaks a turn */
const quit = () => process.exit(0);

const readStdin = async () => {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
};

const rx = (glob) =>
  new RegExp(
    '^' +
      glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*|\*/g, (m) => (m === '**' ? '.*' : '[^/]*')) +
      '$',
  );

try {
  const raw = await readStdin();
  if (!raw.trim()) quit();
  const event = JSON.parse(raw);

  const file = event?.tool_input?.file_path;
  if (typeof file !== 'string' || !file) quit();
  if (!existsSync(AREA)) quit();

  // repo-relative, POSIX separators — the `governs:` globs are written that way
  const rel = file
    .replace(/\\/g, '/')
    .replace(ROOT.replace(/\\/g, '/') + '/', '')
    .replace(/^\.\//, '');
  if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) quit(); // outside the repo

  const hits = [];
  for (const name of readdirSync(AREA)) {
    if (!name.endsWith('.md')) continue;
    const path = join(AREA, name);
    const first = readFileSync(path, 'utf8').split('\n')[0].trim();
    const m = /^<!--\s*governs:\s*(.+?)\s*-->$/.exec(first);
    if (!m) continue;
    const globs = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    if (globs.some((g) => rx(g).test(rel))) hits.push(`docs/area/${name}`);
  }
  if (hits.length === 0) quit();

  // once per (session, guide)
  const session = String(event?.session_id ?? 'nosession');
  const markDir = join(tmpdir(), 'dsim-areahook', createHash('sha1').update(session).digest('hex').slice(0, 16));
  mkdirSync(markDir, { recursive: true });
  const fresh = [];
  for (const h of hits) {
    const mark = join(markDir, h.replace(/[^a-z0-9]+/gi, '_'));
    if (existsSync(mark)) continue;
    writeFileSync(mark, '');
    fresh.push(h);
  }
  if (fresh.length === 0) quit();

  const list = fresh.map((f) => `\`${f}\``).join(' and ');
  const context =
    `You just edited \`${rel}\`, which is governed by ${list}. ` +
    `Those are the rules for this area — they were split out of CLAUDE.md so that every session ` +
    `does not pay for them, not because they stopped binding. If you have not read ${fresh.length > 1 ? 'them' : 'it'} ` +
    `this session, read ${fresh.length > 1 ? 'them' : 'it'} now and check this change against ${fresh.length > 1 ? 'them' : 'it'}; ` +
    `most of what is in there is a bug that shipped once, with the measurement that settled it.`;

  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context } }),
  );
  process.exit(0);
} catch (err) {
  process.stderr.write(`[areahook] ${err}\n`);
  process.exit(0);
}
