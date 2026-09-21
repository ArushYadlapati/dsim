/**
 * FREE CAMERA — the state, owner 2026-09-21 ("add free cam"). Mouse-driven orbit/pan/dolly over
 * the BIOBUZZ 3D field, reached the same way `chase`/`orbit` are (`SceneCamera`, `CameraPref`).
 *
 * ── WHY THE STATE LIVES HERE, AND NOT AS THREE.JS OBJECTS IN `scene/renderCameras.ts` ─────────
 * Orbit's own yaw/elevation/radius live as closure variables inside `createCameras()` because
 * nothing outside that file ever needed to read or unit-test them. Free cam is bigger (a pan
 * target the field bounds must clamp, a dolly that must never invert past the target, a reset
 * that has to agree with itself for both alliances) and the spec asks for it to be checked with
 * no GPU — so it is a plain, DOM-free, `three`-free module: a `FreeCamState`, the functions that
 * move it, and the pure trig that turns it into an eye/target pair. `renderCameras.ts` is the
 * only reader; it owns the `THREE.PerspectiveCamera`, the smoothing clock, and every DOM listener.
 *
 * ⚠️ NOTHING HERE IMPORTS `three` OR `scene/` — the RENDER lane asserts it, the same rule
 * `graphics/settings.ts` and `graphics/auto.ts` already follow (this file is reached from
 * `src/ui/GraphicsSection.tsx`, an ordinary main-bundle screen, same as those two).
 *
 * ⚠️ NO ENGINE TRIG OR EXP/POW EITHER. `scripts/smoke.ts`'s source guard scans every `.ts` under
 * `src/games` that is not named `draw*`/`render*` for a bare `Math.sin/cos/atan2/pow/exp/…` —
 * broader than "the deterministic sim", but a blanket rule over the whole tree it is not worth
 * carving an exception into (`docs/area/physics.md`'s determinism section: "new sim code … uses
 * them"). So every angle here goes through `dsin`/`dcos`/`datan2` (`src/math.ts`), and the ONE
 * genuinely exponential thing free cam needs — the dolly's multiplicative zoom — is computed by
 * the CALLER (`scene/renderCameras.ts`, a `render*`-named file the guard already exempts) and
 * handed in as a plain `factor`; `dollyFreeCam` only multiplies and clamps.
 */

import { dcos, datan2, dsin } from '../../../math';
import { BB_HALF_X, BB_HALF_Y, BB_VIEW_MARGIN } from '../config';

/** yaw/pitch about the look-at TARGET, a distance from it, and the target itself — on the FLOOR
 * plane (z = 0), per the owner's own spec ("pan the look-at point across the floor plane"). A
 * plain object, not a class: it is copied and clamped by value everywhere below. */
export interface FreeCamState {
  /** azimuth, radians, unbounded — the direction FROM the target TO the eye, measured the same
   * way `orbitYaw` is in `renderCameras.ts` (world +x at 0, CCW toward +y). */
  yaw: number;
  /** elevation above the floor, radians — clamped so the eye can never reach the horizon (a
   * pitch-black silhouette shot) or the pole (where yaw stops meaning anything). */
  pitch: number;
  /** eye-to-target distance, inches. */
  dist: number;
  /** the look-at point, field-absolute inches, ON the floor. */
  target: [number, number];
}

// ─────────────────────────────────────────────────────────────────────────────────── clamps ──

const PITCH_MIN_DEG = 8;
const PITCH_MAX_DEG = 89;
export const FREE_CAM_PITCH_MIN = (PITCH_MIN_DEG * Math.PI) / 180;
export const FREE_CAM_PITCH_MAX = (PITCH_MAX_DEG * Math.PI) / 180;

/** owner's own envelope: "dolly ... clamped ~20...420 in". */
export const FREE_CAM_DIST_MIN = 20;
export const FREE_CAM_DIST_MAX = 420;

/** the reset framing's own numbers — comfortably inside both bounds above, and close to
 * `ORBIT_RADIUS_DEFAULT`/`ORBIT_ELEV_DEFAULT` (`renderCameras.ts`) because both are "show me the
 * whole field from a spectator's height" shots. */
export const FREE_CAM_DIST_DEFAULT = 250;
export const FREE_CAM_PITCH_DEFAULT = (32 * Math.PI) / 180;

/** how far past the field's own half-extent the look-at point may pan — the owner's "clamped to
 * the field bounds + a margin", reusing the same margin the 2D/overhead fit already draws by. */
const PAN_MARGIN = BB_VIEW_MARGIN;

/** a non-finite input clamps rather than propagating — `Math.min`/`Math.max` both return NaN
 * when either operand is NaN, so an unguarded clamp is not a clamp at all against a bad number.
 * `+Infinity`/`-Infinity` (a dolly or pan whose rate math overflows) clamp to the bound they are
 * already headed toward, same as an ordinary huge-but-finite value would; a bare `NaN` (the one
 * shape with no direction) falls back to the low bound rather than the high one, arbitrarily but
 * consistently. */
function clampNum(v: number, lo: number, hi: number): number {
  if (Number.isNaN(v)) return lo;
  if (v === Infinity) return hi;
  if (v === -Infinity) return lo;
  return Math.min(hi, Math.max(lo, v));
}

/** every FIELD (not `yaw`, which is a free angle) clamped into its own legal range. Every
 * mutator below routes its result through this, so "clamps hold" is a property of ONE function
 * rather than of every call site remembering to apply them. */
export function clampFreeCam(s: FreeCamState): FreeCamState {
  return {
    yaw: Number.isFinite(s.yaw) ? s.yaw : 0,
    pitch: clampNum(s.pitch, FREE_CAM_PITCH_MIN, FREE_CAM_PITCH_MAX),
    dist: clampNum(s.dist, FREE_CAM_DIST_MIN, FREE_CAM_DIST_MAX),
    target: [
      clampNum(s.target[0], -BB_HALF_X - PAN_MARGIN, BB_HALF_X + PAN_MARGIN),
      clampNum(s.target[1], -BB_HALF_Y - PAN_MARGIN, BB_HALF_Y + PAN_MARGIN),
    ],
  };
}

// ────────────────────────────────────────────────────────────────────────────── the default ──

/** inlined copy of `renderCameras.ts`'s own `forwardOf` (itself an inlined copy of
 * `Camera.screenUpWorld()`) — `graphics/` may not import from `scene/`, and the reset framing
 * needs exactly this one piece of coordinate math: which way "into the field" is for a given
 * `viewAngle`. Keep the two in sync if either changes; the RENDER lane's `one field` discipline
 * does not reach this pairing because neither file imports the other. */
function forwardOf(viewAngle: number): { x: number; y: number } {
  const theta = -viewAngle;
  return { x: -dsin(theta), y: dcos(theta) };
}

/**
 * The reset framing (double-click, the HUD's "Reset view" chip, and the initial pose the first
 * frame ever renders): the whole field, from a spectator's height, standing OUTSIDE the LOCAL
 * driver's own wall and looking in — so "reset" always answers "show me my own side" rather than
 * a fixed, alliance-blind default. A pure function of `viewAngle` (never of the state it is
 * resetting), which is what makes it produce byte-identical results for red and blue.
 */
export function defaultFreeCam(viewAngle: number): FreeCamState {
  const fwd = forwardOf(viewAngle);
  // `yaw` is FROM the target TO the eye, i.e. the direction OPPOSITE "into the field".
  const yaw = datan2(-fwd.y, -fwd.x);
  return clampFreeCam({ yaw, pitch: FREE_CAM_PITCH_DEFAULT, dist: FREE_CAM_DIST_DEFAULT, target: [0, 0] });
}

// ──────────────────────────────────────────────────────────────────────── the three gestures ──

/** left-drag: orbit. `dYaw`/`dPitch` are already-scaled radians (the caller applies its own
 * px-to-radian rate, the same way `renderCameras.ts`'s `orbitDrag` does for the orbit camera). */
export function orbitFreeCam(s: FreeCamState, dYaw: number, dPitch: number): FreeCamState {
  return clampFreeCam({ ...s, yaw: s.yaw + dYaw, pitch: s.pitch + dPitch });
}

/** right-drag (or shift+left-drag): pan the look-at point across the floor plane, in SCREEN-
 * relative directions — `dxPx` positive is "drag right", `dyPx` positive is "drag down" (the DOM
 * convention). Scaled by the CURRENT distance so the ground tracks the cursor at any zoom level,
 * the same reasoning `OrbitControls`-style pan uses; pitch does not tilt a FLOOR-plane pan. */
const PAN_RATE = 0.0022;

export function panFreeCam(s: FreeCamState, dxPx: number, dyPx: number): FreeCamState {
  const scale = s.dist * PAN_RATE;
  const cy = dcos(s.yaw);
  const sy = dsin(s.yaw);
  // `right`: perpendicular to the eye→target azimuth. `intoScreen`: the azimuth itself, i.e. the
  // direction FROM the eye TOWARD the target projected onto the floor — dragging "up" (negative
  // `dyPx`) pulls the ground away from the eye, exactly like pushing a map away from you.
  const rightX = -sy;
  const rightY = cy;
  const intoX = -cy;
  const intoY = -sy;
  const dRight = dxPx * scale;
  const dInto = -dyPx * scale;
  return clampFreeCam({
    ...s,
    target: [s.target[0] + dRight * rightX + dInto * intoX, s.target[1] + dRight * rightY + dInto * intoY],
  });
}

/**
 * wheel: dolly toward/away from the look-at point. `factor` is already computed by the CALLER
 * (`scene/renderCameras.ts`'s `freeDolly`, the same `Math.exp(deltaY * rate)` shape `orbitZoom`
 * uses inline) — the engine-specific exponential has to live in a `render*`-named file (see this
 * file's own header), so this function only ever multiplies and clamps. Multiplicative because
 * the same wheel gesture should move the same FRACTION of the current distance at every zoom
 * level, never crawling far out or lurching up close; `clampFreeCam`'s own `FREE_CAM_DIST_MIN`
 * floor is what keeps a dolly from ever reaching, let alone crossing, the target.
 */
export function dollyFreeCam(s: FreeCamState, factor: number): FreeCamState {
  return clampFreeCam({ ...s, dist: s.dist * factor });
}

// ─────────────────────────────────────────────────────────────────────────────────── the pose ──

export interface FreeCamPose {
  eye: [number, number, number];
  target: [number, number, number];
}

/**
 * The closed-form eye/target pair a `THREE.PerspectiveCamera` needs — spherical coordinates
 * about `target`, in the same z-up field frame every `scene/` file uses (`docs/area/biobuzz.md`'s
 * "BIOBUZZ 3D" section: "field inches, z up"). By construction this ALWAYS looks at `target`
 * from exactly `dist` along `(yaw, pitch)` — there is no rounding or search here to drift from
 * that, which is what the RENDER lane's tolerance-1e-6 check is pinning.
 */
export function freeCamPose(s: FreeCamState): FreeCamPose {
  const cp = dcos(s.pitch);
  const sp = dsin(s.pitch);
  const cy = dcos(s.yaw);
  const sy = dsin(s.yaw);
  const [tx, ty] = s.target;
  return {
    eye: [tx + s.dist * cp * cy, ty + s.dist * cp * sy, s.dist * sp],
    target: [tx, ty, 0],
  };
}

// ───────────────────────────────────────────────────────────────────────── the reset request ──

/**
 * THE "RESET VIEW" HUD CHIP AND THE DOUBLE-CLICK GESTURE SHARE ONE SIGNAL. Both live outside the
 * mounted `GameScene` (a React button in `GameView.tsx`; a DOM listener in `renderScene.ts`), so
 * this is the same reference-counted-free pub/sub shape `graphics/viewKey.ts` uses for `t`,
 * minus the reference counting — nothing here owns a DOM listener to leak, it is just a signal.
 */
type ResetListener = () => void;
const resetListeners = new Set<ResetListener>();

/** ask every subscribed scene to reset its free camera. Fire-and-forget: a scene not currently
 * showing the free camera (or no 3D scene mounted at all) simply has no listener registered. */
export function requestFreeCamReset(): void {
  for (const fn of resetListeners) fn();
}

/** subscribe to `requestFreeCamReset()` calls. Returns the unsubscribe function — call it on
 * scene disposal, exactly like every other subscription in `graphics/`. */
export function subscribeFreeCamReset(fn: ResetListener): () => void {
  resetListeners.add(fn);
  return () => {
    resetListeners.delete(fn);
  };
}
