/**
 * BIOBUZZ 3D VIEW preference — 2D canvas or the 3D Three.js scene, PER DEVICE (Day 1 seam,
 * `docs/biobuzz/plan-3d.md` §2.2).
 *
 * Mirrors `src/theme.ts`'s pattern deliberately, and for the same two reasons its own header
 * gives: a preference that decides what renders on THIS screen has no business following an
 * account to a different machine with a different GPU, and a component-mounted read (React
 * mounts AFTER first paint) would cost the first frame the answer to "which renderer do I
 * build". So it lives in its own localStorage key, under the SAME `decodesim.` prefix
 * `THEME_KEY` uses, client-only, with no React import in this file.
 *
 * Defaults `'2d'`: Day 1 lands the seam, not a `GameScene` implementation, so defaulting to
 * the renderer that actually exists is the only default that draws anything.
 */

const VIEW_KEY = 'decodesim.view';

export type ViewPref = '2d' | '3d';

const isViewPref = (v: unknown): v is ViewPref => v === '2d' || v === '3d';

/** the stored preference, or `'2d'` when absent, corrupt, or storage is unavailable (private
 * browsing, a locked-down profile). Never throws. */
export function getViewPref(): ViewPref {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return isViewPref(v) ? v : '2d';
  } catch {
    return '2d';
  }
}

type ViewListener = (pref: ViewPref) => void;

/** listeners for a change made THROUGH `setViewPref`, in this tab. Not a `storage`-event
 * relay: `theme.ts` has no cross-tab listener either, and a renderer swapping under a player
 * mid-match because another tab changed its mind is a worse surprise than one that only
 * catches up on next load. */
const listeners = new Set<ViewListener>();

/** persist a preference and notify this tab's subscribers. Best-effort: a storage failure
 * (quota, private mode) still notifies, so the UI reflects the pick for this session even
 * though it will not survive a reload. */
export function setViewPref(pref: ViewPref): void {
  try {
    localStorage.setItem(VIEW_KEY, pref);
  } catch {
    /* non-fatal: the pick still applies for this session */
  }
  for (const fn of listeners) fn(pref);
}

/** subscribe to `setViewPref` calls made anywhere in this tab (a Graphics section, a lobby
 * physics/view toggle). Returns an unsubscribe function — call it on unmount. */
export function subscribeViewPref(fn: ViewListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
