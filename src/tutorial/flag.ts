/**
 * "This device has been through the tutorial" — the per-device, PER-GAME seen flag.
 *
 * Local-only, and deliberately NOT a `GameSettings` field, for the reason `chainDisclaimer.ts`
 * spells out for its own flag and `theme.ts` for the theme: it is an acknowledgement made by
 * whoever is sitting at this machine. It should not require signing in, it should not follow
 * the account to a friend's laptop, and it must never ride the account blob to Postgres.
 *
 * PER GAME (design review 12-12): finishing DECODE's four steps said nothing about BIOBUZZ's,
 * which teach five controls DECODE does not have, yet one flag hid both offers. The value is now
 * the comma-separated ids of the games whose tutorial this device has been through. The OLD value
 * `'1'` is read as "every game" rather than as "decode": it was written by whichever tutorial ran,
 * which cannot be recovered, and re-offering a tutorial to somebody who has done one is the
 * nag this flag exists to stop. A call with no `game` keeps the old meaning in both directions.
 *
 * FAIL-OPEN, both ways, and that asymmetry is on purpose. A read that throws (private mode,
 * storage disabled, a locked-down kiosk) answers "not seen", so the offer appears — showing a
 * card to somebody who has already played is a small annoyance; hiding the tutorial from
 * somebody who has never played is the failure this exists to prevent. A write that throws is
 * swallowed, so the tutorial simply offers itself again next session.
 */
import type { GameId } from '../games/types';
import { TUTORIAL_SEEN_KEY as KEY } from '../storageKeys';

/** the legacy value — seen, for every game */
const ALL = '1';

const idsIn = (v: string | null): string[] => (v ? v.split(',').filter(Boolean) : []);

/** has this device finished (or dismissed) `game`'s tutorial? No game ⇒ any tutorial. */
export function tutorialSeen(game?: GameId): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (v === ALL) return true;
    const ids = idsIn(v);
    return game ? ids.includes(game) : ids.length > 0;
  } catch {
    return false; // storage disabled ⇒ treat as unseen, and offer it
  }
}

/** remember that `game`'s tutorial was finished, skipped to the end, exited, or turned down.
 *  No game ⇒ every game (the legacy write). */
export function markTutorialSeen(game?: GameId): void {
  try {
    const v = localStorage.getItem(KEY);
    if (v === ALL) return;
    const ids = idsIn(v);
    if (!game) localStorage.setItem(KEY, ALL);
    else if (!ids.includes(game)) localStorage.setItem(KEY, [...ids, game].join(','));
  } catch {
    /* non-fatal: the offer simply appears again next session */
  }
}

/** forget it, for every game — the "Run it again" path from Controls does not need this, but a
 *  player who wants the first-run offer back has no other way to get it. Exported for that one caller. */
export function clearTutorialSeen(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* non-fatal */
  }
}
