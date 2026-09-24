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
 * Defaults `'3d'` (owner, 2026-09-23). It defaulted `'2d'` while the scene did not exist yet.
 * A device the scene cannot run on still lands on 2D, for the TAB only: `renderScene` calls
 * `fallBackTo2d` when WebGL is unsupported or the context is lost (see `sessionFallback2d`).
 */

import { VIEW_KEY, CAMERA_KEY, DRIVER_HEIGHT_KEY, FREE_CAM_NAV_KEY } from '../../../storageKeys';
import type { SceneCamera } from '../../module';
import { coerceDriverHeightIn } from './driverEye';
import { coerceFreeCamNav, FREE_CAM_NAV_DEFAULT, type FreeCamNav } from './freeCam';

export type ViewPref = '2d' | '3d';

const isViewPref = (v: unknown): v is ViewPref => v === '2d' || v === '3d';

/**
 * THIS TAB FELL BACK TO 2D — a lost GPU context, no WebGL2, or a software renderer.
 *
 * In memory, NEVER in storage. It used to be written to `VIEW_KEY`, so one lost context (a GPU
 * driver reset, Chrome dropping the oldest of too many contexts, a GPU-process crash that leaves
 * Chrome on its software rasteriser) put the device on 2D for good, and players reported being
 * "stuck on 2D". A reload tries 3D again; so does picking 3D (`setViewPref` clears it).
 */
let sessionFallback2d = false;

/** fall back to 2D for this tab only, and tell the subscribers. See `sessionFallback2d`. */
export function fallBackTo2d(): void {
  if (sessionFallback2d) return;
  sessionFallback2d = true;
  for (const fn of listeners) fn('2d');
}

/** the stored preference, or `'3d'` when absent, corrupt, or storage is unavailable (private
 * browsing, a locked-down profile). `'2d'` while this tab has fallen back. Never throws. */
export function getViewPref(): ViewPref {
  if (sessionFallback2d) return '2d';
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return isViewPref(v) ? v : '3d';
  } catch {
    return '3d';
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
  // a pick is a pick: choosing 3D after a fallback is the retry
  sessionFallback2d = false;
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
// CAMERA_KEY is imported at the top, beside VIEW_KEY (src/storageKeys.ts)

export type CameraPref = 'auto' | 'driver' | 'overhead' | 'chase' | 'orbit' | 'free';

/** the cycle order the in-scene `c` key walks, starting from whatever is stored. `auto` is in
 * the ring on purpose: a player who cycled away from it must be able to get back to "let the
 * game decide" without opening a settings screen. `free` (owner, 2026-09-21) is last: it is a
 * mouse-only camera (see `graphics/freeCam.ts`), so cycling past it on a keyboard-only pass
 * costs nothing and a touch device that hides the picker option still reaches every other
 * camera by pressing `c`. */
export const CAMERA_PREFS: readonly CameraPref[] = ['auto', 'driver', 'overhead', 'chase', 'orbit', 'free'];

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

/**
 * WHICH CAMERA A SCENE ACTUALLY RENDERS, given what the host asked for and (only for an
 * INTERACTIVE scene) the device's own persisted preference.
 *
 * The stored preference is "the way I like to watch a match", and it is right that it wins
 * over whatever `driver`/`overhead` the live controller or the gallery asked for — that is
 * what lets a player who cycled to `chase` keep it across matches and reloads. But an EXPORT
 * or a STILL is not a match somebody is watching: the download menu's own Camera row IS the
 * ask, and honouring a `decodesim.camera` the player set while driving weeks ago is why
 * picking Chase in that menu produced a Driver video instead. `interactive: false` is already
 * how a host says "nobody is driving this" (it also skips binding pointer/keys, see
 * `SceneOptions`) — the same flag is the right gate here, so a non-interactive scene is fully
 * host-controlled and a live one keeps deferring to the device.
 */
export function resolveSceneCamera(
  interactive: boolean,
  hostPick: SceneCamera,
  devicePref: CameraPref,
): SceneCamera {
  if (!interactive) return hostPick;
  return devicePref === 'auto' ? hostPick : devicePref;
}

// ────────────────────────────────────────────────────────── "your height" (Day 4/owner spec) ──

/**
 * THE DRIVER'S OWN HEIGHT — per device, same reasoning as everything else in this file: how
 * tall the person in front of THIS screen is has nothing to do with which account is signed in.
 * `null` (absent, corrupt, or storage unavailable) means unset, which is what keeps the driver
 * camera at its ORIGINAL solved framing — `graphics/driverEye.ts`'s own header. Coercion goes
 * through `coerceDriverHeightIn` so a corrupt value falls back to unset rather than to a made-up
 * height, and `DRIVER_HEIGHT_KEY` is the one storage literal this repo allows for it
 * (`src/storageKeys.ts`).
 */
export function getDriverHeightIn(): number | null {
  try {
    const raw = localStorage.getItem(DRIVER_HEIGHT_KEY);
    if (raw === null) return null;
    return coerceDriverHeightIn(JSON.parse(raw), null);
  } catch {
    return null;
  }
}

type DriverHeightListener = (heightIn: number | null) => void;

const driverHeightListeners = new Set<DriverHeightListener>();

/** persist a height (or `null` to clear it — the settings row's "Clear" affordance) and notify
 * this tab's subscribers. Best-effort, exactly like every other pref here. */
export function setDriverHeightIn(heightIn: number | null): void {
  try {
    if (heightIn === null) localStorage.removeItem(DRIVER_HEIGHT_KEY);
    else localStorage.setItem(DRIVER_HEIGHT_KEY, JSON.stringify(heightIn));
  } catch {
    /* non-fatal: the pick still applies for this session */
  }
  for (const fn of driverHeightListeners) fn(heightIn);
}

/** subscribe to `setDriverHeightIn` calls made anywhere in this tab (the Graphics section; the
 * scene's own module-scope camera tuning, `scene/renderCameras.ts`'s `setDriverHeightIn`).
 * Returns an unsubscribe function — call it on unmount/dispose. */
export function subscribeDriverHeightIn(fn: DriverHeightListener): () => void {
  driverHeightListeners.add(fn);
  return () => {
    driverHeightListeners.delete(fn);
  };
}

// ─────────────────────────────────────────────────────────── free cam mouse layout (owner spec) ──

/**
 * THE FREE CAMERA'S MOUSE LAYOUT — per device like everything else here: which CAD package a
 * hand was trained on is a fact about the person at this mouse, not the account.
 */
export function getFreeCamNav(): FreeCamNav {
  try {
    const raw = localStorage.getItem(FREE_CAM_NAV_KEY);
    return raw === null ? FREE_CAM_NAV_DEFAULT : coerceFreeCamNav(JSON.parse(raw));
  } catch {
    return FREE_CAM_NAV_DEFAULT;
  }
}

type FreeCamNavListener = (nav: FreeCamNav) => void;

const freeCamNavListeners = new Set<FreeCamNavListener>();

/** persist and notify this tab's subscribers. Best-effort, exactly like every other pref here. */
export function setFreeCamNav(nav: FreeCamNav): void {
  const clean = coerceFreeCamNav(nav);
  try {
    localStorage.setItem(FREE_CAM_NAV_KEY, JSON.stringify(clean));
  } catch {
    /* non-fatal: the pick still applies for this session */
  }
  for (const fn of freeCamNavListeners) fn(clean);
}

/** subscribe to `setFreeCamNav`. Returns an unsubscribe function — call it on unmount/dispose. */
export function subscribeFreeCamNav(fn: FreeCamNavListener): () => void {
  freeCamNavListeners.add(fn);
  return () => {
    freeCamNavListeners.delete(fn);
  };
}
