/**
 * THE LOCAL NAME BLOCKLIST — the matcher, and deliberately NOT the words.
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────
 * The hosted moderation model (`server/moderation.ts`) classifies by CATEGORY — hate, threats,
 * harassment, sexual content — and it is good at that: measured 2026-09-19 with the production
 * key, it refused every slur and threat it was shown, spaced-out and misspelt ones included. It
 * is not a profanity filter, and it said so with the same key: a bare four-letter obscenity, the
 * slang a teenager would pick for a robot name, and most plain anatomical and sexual words all
 * came back ALLOWED, because a word on its own is neither hateful nor threatening. This sim's
 * public names sit on leaderboards read by school teams, so those words need a second, dumber
 * layer in FRONT of the model: an exact list, matched locally, for free, with no round trip.
 *
 * ── ⚠️ THE LIST IS NOT IN THIS REPOSITORY, AND MUST NEVER BE ────────────────
 * Owner ruling, 2026-09-19: no profanity in the repo, and no published list for somebody to read
 * and route around. The words arrive at RUNTIME, as the `MODERATION_BLOCKLIST` secret; this file
 * is only the machine that reads them. Every check in `scripts/dbtest.ts` runs against a made-up
 * fixture vocabulary for the same reason — do not "improve" a test by pasting a real word in.
 *
 * ── THE LIST'S FORMAT ───────────────────────────────────────────────────────
 * Entries separated by commas and/or newlines; case and surrounding space ignored; `#` starts a
 * comment to the end of the line. Two kinds:
 *
 *   word     a WHOLE-WORD entry. Matches a token of the name, with the common English endings
 *            tolerated (`BLOCK_SUFFIXES`). This is the default because most short obscenities
 *            are also the inside of an innocent word — a place name, a bird, a profession — and
 *            a substring match on them is the classic false positive every such filter ships.
 *   *word    a SUBSTRING entry. Matches anywhere in the name with the separators squeezed out.
 *            Only for a word with no innocent superstring; the star is the author's promise.
 *
 * ── WHAT A NAME IS NORMALISED TO BEFORE IT IS COMPARED ──────────────────────
 * Lower case; accents stripped (NFKD); the usual digit-and-symbol substitutions read back as the
 * letters they stand for, but ONLY inside a token that has a letter in it, so a team number is
 * never turned into a word; a STRETCHED name (three or more of one letter in a row) compared
 * with every run squeezed to one, against the entries squeezed the same way (`stretched`); and
 * single letters separated by spaces or punctuation read back together. Each of those
 * is one of the evasions the 2026-09-19 measurement actually saw get through.
 *
 * DOM-free and Node-free on purpose: `server/moderation.ts` is pulled into the LAN host's browser
 * tab through `server/room.ts`, where there is no list and this is simply never consulted.
 */

/** endings a WHOLE-WORD entry still matches under. Short on purpose: every one added widens every
 * entry, and an ending that turns a blocked word into an innocent one is a false positive for the
 * whole list at once. */
const BLOCK_SUFFIXES = ['', 's', 'es', 'ed', 'er', 'ers', 'ing', 'in', 'y', 'ie', 'z'] as const;

/** the substitutions read back as letters. Digits first, then the symbols people type for them. */
const LEET: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  $: 's',
  '!': 'i',
  '+': 't',
};

export interface Blocklist {
  /** whole-word entries */
  words: ReadonlySet<string>;
  /** substring entries (the `*` ones), longest first so the report names the most specific */
  anywhere: readonly string[];
  /** the same two, with every repeated-letter run squeezed to ONE — what a STRETCHED name is
   * compared against (see `squeezed`) */
  wordsSqueezed: ReadonlySet<string>;
  anywhereSqueezed: readonly string[];
  /** how many entries were read — what the boot log prints INSTEAD of the entries */
  size: number;
}

export const EMPTY_BLOCKLIST: Blocklist = { words: new Set(), anywhere: [], wordsSqueezed: new Set(), anywhereSqueezed: [], size: 0 };

const stripAccents = (s: string): string => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

/** letters only, after the substitutions — what an ENTRY is stored as and a token is compared as */
function lettersOf(raw: string): string {
  let out = '';
  for (const ch of stripAccents(raw.toLowerCase())) {
    const c = LEET[ch] ?? ch;
    if (c >= 'a' && c <= 'z') out += c;
  }
  return out;
}

/** parse the secret. Anything that does not survive normalisation to at least two letters is
 * dropped rather than kept as an entry that would match half the alphabet. */
export function parseBlocklist(raw: string | undefined | null): Blocklist {
  if (!raw) return EMPTY_BLOCKLIST;
  const words = new Set<string>();
  const anywhere = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const live = line.split('#')[0];
    for (const part of live.split(',')) {
      const entry = part.trim();
      if (!entry) continue;
      const star = entry.startsWith('*');
      const w = lettersOf(star ? entry.slice(1) : entry);
      if (w.length < 2) continue;
      (star ? anywhere : words).add(w);
    }
  }
  const size = words.size + anywhere.size;
  if (size === 0) return EMPTY_BLOCKLIST;
  const byLength = (a: string, b: string): number => b.length - a.length;
  return {
    words,
    anywhere: [...anywhere].sort(byLength),
    wordsSqueezed: new Set([...words].map(squeeze)),
    anywhereSqueezed: [...new Set([...anywhere].map(squeeze))].sort(byLength),
    size,
  };
}

/** every repeated-letter run squeezed to one letter */
const squeeze = (t: string): string => t.replace(/(.)\1+/g, '$1');

/**
 * IS THIS TOKEN STRETCHED — a run of three or more of one letter, which English does not do?
 *
 * A stretched token is compared SQUEEZED against the squeezed entries, because that is the only
 * comparison that survives an entry with a double letter of its own: stretch one vowel of a
 * word spelt with a double consonant and no amount of shortening the vowel brings the consonants
 * back. ⚠️ And ONLY a stretched token is: squeezing everything would make a two-letter word match
 * a three-letter entry that ends in a double, which is a false positive on a very common word.
 */
const stretched = (t: string): boolean => /(.)\1{2,}/.test(t);

/**
 * The tokens a name offers up for a WHOLE-WORD comparison.
 *
 * Split twice — once on everything that is not a letter or digit, once treating the substitution
 * SYMBOLS as part of the word — because `!` and `$` are both punctuation and letters, and only
 * the name's author knows which. A token with no letter in it (a team number) is dropped BEFORE
 * the digits are read back, which is the whole of why "Team 16236" is not five letters.
 * A lower-to-UPPER case change inside a word is a boundary too (measured 2026-09-19: the first
 * real list missed a CamelCase name and nothing else).
 */
function tokensOf(name: string): string[] {
  // a CamelCase join is a word boundary its author typed: "ZorpSquad" is "Zorp" and "Squad". Split
  // BEFORE the case is thrown away, which is the only moment the boundary exists.
  const base = stripAccents(name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
  const out = new Set<string>();
  for (const splitter of [/[^a-z0-9]+/, /[^a-z0-9@$!+]+/]) {
    const parts = base.split(splitter).filter(Boolean);
    // single characters in a row read back together: "b a d" is "bad"
    const joined: string[] = [];
    let run = '';
    for (const p of parts) {
      if (p.length === 1) {
        run += p;
        continue;
      }
      if (run) joined.push(run);
      run = '';
      joined.push(p);
    }
    if (run) joined.push(run);
    for (const p of joined) {
      if (!/[a-z]/.test(p)) continue; // all digits/symbols: a number, not a word
      const w = lettersOf(p);
      if (w.length >= 2) out.add(w);
    }
  }
  return [...out];
}

/** does `name` hit the list? Pure; the caller decides what a hit means. */
export function blocklistHit(list: Blocklist, name: string): boolean {
  if (list.size === 0 || !name) return false;
  const wordHit = (t: string, words: ReadonlySet<string>): boolean => {
    for (const suffix of BLOCK_SUFFIXES) {
      if (suffix && !t.endsWith(suffix)) continue;
      const stem = suffix ? t.slice(0, t.length - suffix.length) : t;
      if (stem.length >= 2 && words.has(stem)) return true;
    }
    return false;
  };
  if (list.words.size > 0) {
    for (const t of tokensOf(name)) {
      if (wordHit(t, list.words)) return true;
      if (stretched(t) && wordHit(squeeze(t), list.wordsSqueezed)) return true;
    }
  }
  if (list.anywhere.length > 0) {
    // squeezed from the WORD tokens only — a bare number contributes nothing, or "Team 455" reads
    // back as three letters on the end of "team" and a starred entry finds a word nobody typed
    const whole = lettersOf(
      stripAccents(name.toLowerCase())
        .split(/[^a-z0-9@$!+]+/)
        .filter((p) => /[a-z]/.test(p))
        .join(''),
    );
    for (const w of list.anywhere) if (whole.includes(w)) return true;
    if (stretched(whole)) {
      const sq = squeeze(whole);
      for (const w of list.anywhereSqueezed) if (sq.includes(w)) return true;
    }
  }
  return false;
}
