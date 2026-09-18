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

// ────────────────────────────────────────────────────────────── camera preference (Day 2) ──

/**
 * WHICH 3D CAMERA this device prefers (`docs/biobuzz/plan-3d.md` §4.3) — same storage rules as
 * the view above, and per device for the same reason: "I want the chase camera" is a fact about
 * the screen you are driving in front of, not about your account.
 *
 * `'auto'` is the default and means *whatever the host asks for*: the controller already picks
 * `driver` on a mouse and `overhead` on a touch layout (`GameController.sceneCameraFor`), which
 * is the right answer for someone who has never opened this setting. Any other value OVERRIDES
 * the frame's camera, so a player who has chosen `orbit` keeps it across matches, rooms and
 * reloads until they choose something else.
 */
const CAMERA_KEY = 'decodesim.camera';

export type CameraPref = 'auto' | 'driver' | 'overhead' | 'chase' | 'orbit';

/** the cycle order the in-scene `c` key walks, starting from whatever is stored. `auto` is in
 * the ring on purpose: a player who cycled away from it must be able to get back to "let the
 * game decide" without opening a settings screen. */
export const CAMERA_PREFS: readonly CameraPref[] = ['auto', 'driver', 'overhead', 'chase', 'orbit'];

const isCameraPref = (v: unknown): v is CameraPref =>
  typeof v === 'string' && (CAMERA_PREFS as readonly string[]).includes(v);

/** the stored camera preference, or `'auto'` when absent, corrupt, or storage is unavailable.
 * Never throws. */
export function getCameraPref(): CameraPref {
  try {
    const v = localStorage.getItem(CAMERA_KEY);
    return isCameraPref(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

type CameraListener = (pref: CameraPref) => void;

const cameraListeners = new Set<CameraListener>();

/** persist a camera preference and notify this tab's subscribers. Best-effort, exactly like
 * `setViewPref`: a storage failure still notifies, so the pick applies for this session. */
export function setCameraPref(pref: CameraPref): void {
  try {
    localStorage.setItem(CAMERA_KEY, pref);
  } catch {
    /* non-fatal: the pick still applies for this session */
  }
  for (const fn of cameraListeners) fn(pref);
}

/** subscribe to `setCameraPref` calls made anywhere in this tab (the scene's own `c` key, a
 * later Graphics section). Returns an unsubscribe function — call it on unmount/dispose. */
export function subscribeCameraPref(fn: CameraListener): () => void {
  cameraListeners.add(fn);
  return () => {
    cameraListeners.delete(fn);
  };
}
