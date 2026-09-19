/**
 * "This device has been through the tutorial" — the per-device seen flag.
 *
 * Local-only, and deliberately NOT a `GameSettings` field, for the reason `chainDisclaimer.ts`
 * spells out for its own flag and `theme.ts` for the theme: it is an acknowledgement made by
 * whoever is sitting at this machine. It should not require signing in, it should not follow
 * the account to a friend's laptop, and it must never ride the account blob to Postgres.
 *
 * FAIL-OPEN, both ways, and that asymmetry is on purpose. A read that throws (private mode,
 * storage disabled, a locked-down kiosk) answers "not seen", so the offer appears — showing a
 * card to somebody who has already played is a small annoyance; hiding the tutorial from
 * somebody who has never played is the failure this exists to prevent. A write that throws is
 * swallowed, so the tutorial simply offers itself again next session.
 */
import { TUTORIAL_SEEN_KEY as KEY } from '../storageKeys';

/** has this device finished (or dismissed) the tutorial? */
export function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false; // storage disabled ⇒ treat as unseen, and offer it
  }
}

/** remember that the tutorial was finished, skipped to the end, or exited. */
export function markTutorialSeen(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* non-fatal: the offer simply appears again next session */
  }
}

/** forget it — the "Run it again" path from Controls does not need this, but a player who
 *  wants the first-run offer back has no other way to get it. Exported for that one caller. */
export function clearTutorialSeen(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* non-fatal */
  }
}
