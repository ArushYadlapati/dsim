/**
 * UI STANDARD AUDIT — `npm run uiaudit`. Zero dependencies, same shape as
 * `contrast.mjs` and `shiftaudit.cjs`.
 *
 * Enforces docs/ui-standard.md. Deliberately NOT wired into `npm test`, for the reason
 * the repo already applies to contrast and dbtest: a red `npm test` must keep meaning
 * "physics broke".
 *
 * ── WHY A RATCHET ─────────────────────────────────────────────────────────────
 * The standard landed on a codebase with 105 inline spacing declarations and 18 font
 * sizes. A check that simply failed would have to be switched off on day one, and a
 * check that is off is not a check. So each rule carries a BASELINE: the count measured
 * when the rule was written. The audit fails if a count goes UP, and tells you to lower
 * the baseline when it goes down. New code is held to the standard immediately; the
 * existing debt is paid off in whatever order suits, and can never grow back.
 *
 * Two rules have a baseline of 0 and are hard errors, because both describe bugs that
 * shipped silently and cost real time to find:
 *
 *   • UNDEFINED CUSTOM PROPERTY — `--ds-font` was used 13 times and never defined. In a
 *     `font:` shorthand an unresolvable var() voids the WHOLE declaration, so those rules
 *     set no weight, size or line-height at all, for months, with nothing in the console.
 *     `--accent` was the same bug wearing a fallback.
 *
 *   • DUPLICATE SELECTOR — `.ds-dl` was declared twice for two unrelated components. The
 *     later block won and laid the replay export menu out as a column. Both files are one
 *     cascade; source order is the only tiebreak, and nothing warns you.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const UI = 'src/ui';
const css = readdirSync(UI).filter((f) => f.endsWith('.css')).map((f) => join(UI, f));
const tsx = readdirSync(UI).filter((f) => f.endsWith('.tsx')).map((f) => join(UI, f));
// helpers like rangeFill.ts also hand custom properties to a style object
const ts = readdirSync(UI).filter((f) => f.endsWith('.ts')).map((f) => join(UI, f));
const read = (f) => readFileSync(f, 'utf8').split('\n');

/** every finding, grouped by rule id */
const found = new Map();
const hit = (rule, file, line, text) => {
  if (!found.has(rule)) found.set(rule, []);
  found.get(rule).push({ file, line, text: text.trim().slice(0, 110) });
};

/** the counts on the day each rule was written. LOWER these as debt is paid; never raise. */
const BASELINE = {
  'undefined-token': 0,
  'duplicate-selector': 0,
  'var-literal-fallback': 0,
  'ghost-primary': 0,
  // 29 → 5, 2026-09-19: the admin console rebuild took its 24 out. `.admin-card` is a flex
  // column with a gap of its own and eleven of its children carried an inline margin too,
  // so the space between a status line and the buttons above it was the gap PLUS a number
  // somebody typed; §2's "one owner per gap" now holds there. The rest became `.adm-sub`,
  // `.adm-gap` and `.adm-sec`.
  'inline-spacing': 5,
  'fractional-font-size': 0,
  'banned-font-weight': 0,
  // 155 → 152, 2026-09-19: the three HUD read-outs became one. `.ping-graph`'s `8px 10px`
  // and `18px 0`, its `5px` margin and its `6px` gap went with the graph that opened on a
  // click that never landed; `.perf-hud` is on the token scale.
  // 152 → 149, 2026-09-21: the Configure redesign. `.ds-robot` and `.ds-subnav-body` both
  // spelled the gap between a section's cards as `22px`, and a comment in one of them pointed
  // at the other to keep them agreeing; both are `--ds-s-5` now, so they agree by construction.
  // `.ds-binds`'s own `14px` went the same way when the gamepad split gave it a sibling that
  // would otherwise have had to copy the number.
  // 149 → 146, 2026-09-21: the results screen went to a viewport-driven display scale, and
  // all three of its off-grid values were off-grid because they were sized for 15px type —
  // `.resx-roster-name` and `.resx-roster-meta`'s `6px` gaps and `.resx-breakdown`'s `3px`
  // cell padding. They are `em` now, so they scale with the row they sit in and there is no
  // number left to round.
  // 146 → 144, 2026-09-22: merging main's LAN Screen Redesign lost the `.net-corner` /
  // `.chip.net-quality.clickable` rules along with the dead ping-graph feature they served
  // (superseded by `.perf-hud`, owner ruling 2026-09-19); two of their off-grid literals
  // went with them.
  'off-grid-gap': 144,
  // measured 2026-09-16, when these three rules were written. §4's own ruling ("10px … rounds
  // to --ds-round-md") was executed in the same commit, which is why radius starts at 17 and
  // not the 31 first measured. The other two start where they stand: paying them down needs a
  // visual decision per site, and a baseline is how that gets paid off in any order without
  // being able to grow back.
  'off-scale-font-size': 46,
  // 14 → 13, 2026-09-19: `.perf-readout`'s `border-radius: 6px` went with the `?perf=1` line.
  'literal-radius': 13,
  'shadow-sprawl': 14,
  'stale-component-index': 0,
};

// ── 1. undefined custom properties ───────────────────────────────────────────
// definitions can come from either stylesheet, or from JS setting a property inline
const defined = new Set();
for (const f of [...css, ...tsx, ...ts]) {
  for (const l of read(f)) {
    for (const m of l.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) defined.add(m[1]);
    // JSX sets custom properties two ways: `'--x':` and the computed
    // `['--x' as string]:` form React needs for a typed style object
    for (const m of l.matchAll(/\[?\s*['"](--[a-zA-Z0-9-]+)['"]/g)) defined.add(m[1]);
  }
}
for (const f of css) {
  read(f).forEach((l, i) => {
    for (const m of l.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
      if (!defined.has(m[1])) hit('undefined-token', f, i + 1, `${m[1]} — ${l}`);
    }
  });
}

// ── 2. a var() fallback hides a missing token ────────────────────────────────
// `var(--accent, #6ea8ff)` looked fine and used the literal 100% of the time.
for (const f of css) {
  read(f).forEach((l, i) => {
    if (/var\(\s*--[a-zA-Z0-9-]+\s*,\s*(#|rgb|hsl)/.test(l)) hit('var-literal-fallback', f, i + 1, l);
  });
}

// ── 3. one selector, one owner ───────────────────────────────────────────────
// Only top-level blocks: a @media re-declaring a selector is the point of a @media.
const owner = new Map();
for (const f of css) {
  let depth = 0;
  // A SELECTOR LIST SPANS LINES. Matching only `^sel {` treats the LAST line of
  //   .fr-empty,
  //   .fr-note,
  //   .fr-error {
  // as a standalone rule, which is a false positive — and acting on that one is what
  // collapsed that group into a single block and turned `.fr-empty` red. So the
  // prelude is accumulated across lines and only single-selector rules own a name.
  let prelude = '';
  read(f).forEach((l, i) => {
    const code = l.replace(/\/\*.*?\*\//g, '');
    if (depth === 0) {
      const open = code.indexOf('{');
      if (open === -1) {
        prelude += ' ' + code;
      } else {
        prelude = (prelude + ' ' + code.slice(0, open)).trim();
        const sels = prelude.split(',').map((x) => x.trim()).filter(Boolean);
        // `.a, .b { }` is a shared BASE; `.a { }` after it is a per-variant override,
        // which is the normal shape, not the bug. Only a lone selector owns itself.
        if (sels.length === 1 && /^[.#]/.test(sels[0]) && !sels[0].startsWith('@')) {
          const sel = sels[0];
          const prev = owner.get(sel);
          if (prev) hit('duplicate-selector', f, i + 1, `${sel} — also at ${prev}`);
          else owner.set(sel, `${f}:${i + 1}`);
        }
        prelude = '';
      }
    }
    depth += (code.match(/\{/g) || []).length - (code.match(/\}/g) || []).length;
    if (depth < 0) depth = 0;
    if (depth === 0 && code.includes('}')) prelude = '';
  });
}

// ── 3b. `ghost` and `primary` on one button ──────────────────────────────────
// `.ds-btn.ghost` is declared AFTER `.ds-btn.primary`, so it wins on `background: none`
// while primary's white `color: var(--ds-accent-ink)` survives — a button whose label is
// white on the page's own surface. It reads as a missing control rather than a broken one,
// which is why it gets a rule rather than a fix: the two modifiers are alternatives.
for (const f of tsx) {
  read(f).forEach((l, i) => {
    for (const m of l.matchAll(/(?:className|class)=[^\n]*?['"`]([^'"`]*ds-btn[^'"`]*)['"`]/g)) {
      // a TEMPLATE literal spans the whole attribute, so test the line's ds-btn runs
      if (/\bghost\b/.test(m[1]) && /\bprimary\b/.test(m[1])) hit('ghost-primary', f, i + 1, l);
    }
    // the common template form: `ds-btn ghost ...${cond ? ' primary' : ''}`
    if (/ds-btn[^`'"]*\bghost\b/.test(l) && /'\s*primary/.test(l)) hit('ghost-primary', f, i + 1, l);
  });
}

// ── 4. spacing literals in JSX ───────────────────────────────────────────────
for (const f of tsx) {
  read(f).forEach((l, i) => {
    if (/style=\{\{/.test(l) || /^\s*(margin|padding|gap)[A-Za-z]*:\s*['"]?[0-9]/.test(l)) {
      if (/(margin|padding|gap)[A-Za-z]*:\s*['"]?[0-9]/.test(l)) hit('inline-spacing', f, i + 1, l);
    }
  });
}

// ── 5. type scale ────────────────────────────────────────────────────────────
for (const f of css) {
  read(f).forEach((l, i) => {
    if (/font-size:\s*[0-9]+\.[0-9]+px/.test(l)) hit('fractional-font-size', f, i + 1, l);
    if (/font:\s*[0-9]+\s+[0-9]+\.[0-9]+px/.test(l)) hit('fractional-font-size', f, i + 1, l);
    // both families are VARIABLE cuts (shell.css:164), so 750 and 500 are real type,
    // not drift. Guard against an EIGHTH weight appearing rather than banning three.
    const wm = l.match(/font-weight:\s*([0-9]{3})/) ?? l.match(/font:\s*([0-9]{3})\s/);
    if (wm && !/^(400|500|600|700|750|800|900)$/.test(wm[1])) hit('banned-font-weight', f, i + 1, l);
  });
}

// ── 5b. the type SCALE, not just its fractions ───────────────────────────────
// §3 declares six sizes and the audit only ever checked that a size was not FRACTIONAL, so
// 23 whole-pixel sizes accumulated against a six-step scale — 17px, 19px, 26px, 34px, 58px
// and the rest, each one invisible on its own. A live-DOM audit across five routes measured
// 12 distinct sizes actually rendering, with 19/64/10px each appearing on exactly one page.
// That is the drift the scale exists to prevent, and the reason it went unnoticed is that
// the rule enforcing it was never written.
const TYPE_SCALE = new Set([11, 12, 13, 15, 20, 28]);
/**
 * SCOPED TO THE CHROME. `styles.css` is the in-match overlay drawn over the dark field
 * canvas, and it is a different surface with different needs — its 160px countdown digits
 * are display type doing exactly their job, not drift. §3's six steps were written about the
 * `ds-` chrome. Blessing the overlay's sizes to make one rule cover both would make the rule
 * vacuous; condemning them would make it wrong. It needs a display tier of its own, decided
 * on its own terms, and until §3 has one this rule does not reach it.
 */
for (const f of css.filter((x) => x.endsWith('shell.css'))) {
  read(f).forEach((l, i) => {
    const m = l.match(/font-size:\s*([0-9]+)px/) ?? l.match(/font:\s*[0-9]{3}\s+([0-9]+)px/);
    if (m && !TYPE_SCALE.has(Number(m[1]))) hit('off-scale-font-size', f, i + 1, l);
  });
}

// ── 5c. literal radii ────────────────────────────────────────────────────────
// §4 says "No literal radius" in those words. Eight distinct literals are in use (3, 5, 6,
// 7, 8, 9, 10, 14) and only 8px coincides with a token, so seven of them are values nobody
// chose twice. 7px reaches the live DOM on exactly one route.
for (const f of css) {
  read(f).forEach((l, i) => {
    if (/border-radius:\s*[0-9]+px/.test(l) && !/var\(--ds-round/.test(l)) hit('literal-radius', f, i + 1, l);
  });
}

// ── 5d. one depth model ──────────────────────────────────────────────────────
// DESIGN.md commits to ONE: a hard offset "block" shadow with a keycap edge, explicitly not
// blurry realistic elevation. 45 distinct box-shadow declarations is not one model, and the
// live audit sees 9 of them rendering at once. Counted per DISTINCT declaration rather than
// per occurrence — reusing the same shadow is the point.
{
  // same scoping, and the same reason: the overlay's depth is drawn over a canvas.
  const seen = new Map();
  for (const f of css.filter((x) => x.endsWith('shell.css'))) {
    read(f).forEach((l, i) => {
      const m = l.match(/box-shadow:\s*([^;]+);/);
      if (!m) return;
      const decl = m[1].trim().replace(/\s+/g, ' ');
      if (decl === 'none' || decl.startsWith('var(')) return;
      // a focus/selection RING (`0 0 0 Npx …`, no offset, no blur) is not an elevation
      // model, and neither is an `inset` highlight — counting them as depth would flag
      // exactly the code that is doing the right thing
      if (/^(inset\s+)?0 0 0 /.test(decl) || decl.startsWith('inset ')) return;
      if (!seen.has(decl)) seen.set(decl, { f, i });
    });
  }
  for (const [decl, at] of seen) hit('shadow-sprawl', at.f, at.i + 1, decl);
}

// ── 6. the 4px grid ──────────────────────────────────────────────────────────
// 2px is allowed inside chips/badges only; every other off-grid value is a finding.
const ON_GRID = new Set([0, 2, 4, 8, 12, 16, 24, 32, 48]);
for (const f of css) {
  read(f).forEach((l, i) => {
    const m = l.match(/^\s*(gap|row-gap|column-gap):\s*([0-9]+)px/);
    if (m && !ON_GRID.has(Number(m[2]))) hit('off-grid-gap', f, i + 1, l);
    const p = l.match(/^\s*padding:\s*([0-9]+)px(?:\s+([0-9]+)px)?/);
    if (p) {
      for (const v of [p[1], p[2]].filter(Boolean)) {
        if (!ON_GRID.has(Number(v))) { hit('off-grid-gap', f, i + 1, l); break; }
      }
    }
  });
}

// ── 7. the component index is current ────────────────────────────────────────
// `docs/ui-components.md` is generated from the CSS by `scripts/uiindex.mjs`, and its whole
// value is answering "does a class for this already exist?". A STALE index answers that with
// a confident no, which is worse than having none — so it is regenerated here and compared.
{
  const OUT = 'docs/ui-components.md';
  const before = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  /**
   * ⚠️ COMPARE CONTENT, NOT LINE ENDINGS. `core.autocrlf` is true on Windows, so this
   * file is CHECKED OUT as CRLF while `uiindex.mjs` writes LF — which made this rule
   * fire on every run of a fresh Windows checkout, whether or not the CSS had moved. A
   * check that is always red is worse than no check: it stops meaning anything, and the
   * real staleness it exists to catch hides inside it. Same bug class as the CRLF split
   * in the BIOBUZZ smoke source guards.
   */
  const eol = (s) => s.replace(/\r\n/g, '\n');
  try {
    execFileSync(process.execPath, ['scripts/uiindex.mjs'], { stdio: 'pipe' });
    const after = readFileSync(OUT, 'utf8');
    // restore byte-for-byte whenever anything changed, EOLs included: the run is the
    // report, and it must not leave the working tree dirty either way
    if (before !== after) writeFileSync(OUT, before);
    if (eol(before) !== eol(after)) {
      hit('stale-component-index', OUT, 1, 'run `npm run uiindex` and commit the result');
    }
  } catch (e) {
    hit('stale-component-index', OUT, 1, `uiindex failed: ${String(e).slice(0, 80)}`);
  }
}

// ── report ───────────────────────────────────────────────────────────────────
const DESC = {
  'undefined-token': 'var() names a custom property that is defined nowhere',
  'duplicate-selector': 'one selector declared by two top-level blocks',
  'var-literal-fallback': 'var(--x, #literal) — the fallback hides a missing token',
  'ghost-primary': 'ghost + primary on one button — the label goes white on the page surface',
  'inline-spacing': 'spacing literal in JSX; it belongs to a class',
  'fractional-font-size': 'fractional font-size; the scale has six whole steps',
  'banned-font-weight': 'weight outside the seven the variable cuts actually use',
  'off-grid-gap': 'gap/padding off the 4px grid',
  'off-scale-font-size': 'font-size outside the six-step scale (§3)',
  'literal-radius': 'literal border-radius; §4 says use a --ds-round token',
  'shadow-sprawl': 'distinct box-shadow declarations; DESIGN.md commits to ONE depth model',
  'stale-component-index': 'docs/ui-components.md is out of date with the CSS',
};

let failed = 0;
let ratcheted = 0;
const rules = Object.keys(BASELINE);
console.log('UI STANDARD AUDIT — docs/ui-standard.md\n');
for (const rule of rules) {
  const n = (found.get(rule) ?? []).length;
  const base = BASELINE[rule];
  const state = n > base ? 'FAIL' : n < base ? 'IMPROVED' : 'ok';
  if (n > base) failed++;
  if (n < base) ratcheted++;
  const pad = rule.padEnd(21);
  console.log(`${state === 'FAIL' ? '✗' : state === 'IMPROVED' ? '↓' : '·'} ${pad} ${String(n).padStart(3)} / ${String(base).padStart(3)}  ${DESC[rule]}`);
  if (n > base || base === 0) {
    for (const v of (found.get(rule) ?? []).slice(0, 25)) {
      console.log(`    ${v.file}:${v.line}  ${v.text}`);
    }
    const extra = n - 25;
    if (extra > 0) console.log(`    … and ${extra} more`);
  }
}
console.log();
if (failed) {
  console.log(`${failed} rule(s) got WORSE than the recorded baseline. Fix them, or change`);
  console.log('the standard in docs/ui-standard.md first and say so in the commit.');
  process.exit(1);
}
if (ratcheted) {
  console.log(`${ratcheted} rule(s) IMPROVED — lower the BASELINE in scripts/uiaudit.mjs to lock it in.`);
  process.exit(1);
}
console.log('ALL RULES AT OR UNDER BASELINE');
