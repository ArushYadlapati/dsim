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

// ──────────────────────────────────────────────────────────────── THE DIRECTION SENSES ───────
//
// ⚠️ ORBIT DRAGS THE FIELD, IT DOES NOT FLY THE CAMERA (owner report, 2026-09-21: "Onshape orbit
// is right drag but it is reversed"). The gesture every CAD package implements is "put your
// finger on the model and turn it": a drag to the RIGHT swings the model right, which means the
// EYE goes left. `yaw` is the azimuth of the eye about the target, and d(eye)/d(yaw) is exactly
// the camera's own screen-RIGHT vector (`freeCamPose` below; `(-sin yaw, cos yaw)`), so the eye
// follows the cursor when yaw INCREASES with `dx` — which is what shipped, and is backwards.
// `freeCamOrbitDelta` negates it. Two independent confirmations that this, not the other, is the
// house sense: `renderCameras.ts`'s own spectator `orbitDrag` has always done `orbitYaw -= dx`,
// so free cam was the one camera in the app that turned the other way; and three.js's
// `OrbitControls`, which is the de-facto spelling of this gesture on the web, rotates by
// `-dx` too.
//
// The PITCH axis was already right and is NOT flipped: grab the front of a ball and pull DOWN
// and its top rolls toward you, i.e. you end up looking from HIGHER — elevation increases with
// `dy`. (`OrbitControls` agrees: a positive `dy` decreases its polar angle, which raises the
// eye.) Both senses are pinned with explicit geometry in the RENDER lane.
//
// PAN is the same "the ground follows the cursor" rule, and it was already right: drag right and
// the field slides right, so the look-at point moves screen-LEFT. That one was measured with
// real mouse input on 2026-09-21 after shipping backwards once, and the vendors agree by
// construction — a pan that moved the camera with the cursor would send the model the other way
// from an orbit in the same hand.
//
// NO VENDOR DOCUMENTS EITHER SENSE. Onshape, SOLIDWORKS, Fusion and Blender all publish which
// BUTTON does what (see the table below, and `docs/biobuzz/free-cam-presets.md` for the URLs)
// and none of them states which way the model turns; this is the owner's report plus the app's
// own orbit camera, written down so the next pass does not re-derive it.

// ──────────────────────────────────────────────────────────────────────── the three gestures ──

/** orbit: `dYaw`/`dPitch` are already-scaled radians. Use `freeCamOrbitDelta` to turn a screen
 * drag into them — it owns the direction sense and the player's own inversions. */
export function orbitFreeCam(s: FreeCamState, dYaw: number, dPitch: number): FreeCamState {
  return clampFreeCam({ ...s, yaw: s.yaw + dYaw, pitch: s.pitch + dPitch });
}

/** pan: move the look-at point across the floor plane, in SCREEN-relative directions — `dxPx`
 * positive is "drag right", `dyPx` positive is "drag down" (the DOM convention). Scaled by the
 * CURRENT distance so the ground tracks the cursor at any zoom level; pitch does not tilt a
 * FLOOR-plane pan. `gain` is the player's pan sensitivity, negated when they have inverted it. */
const PAN_RATE = 0.0022;

export function panFreeCam(s: FreeCamState, dxPx: number, dyPx: number, gain = 1): FreeCamState {
  const scale = s.dist * PAN_RATE * gain;
  const cy = dcos(s.yaw);
  const sy = dsin(s.yaw);
  // `right`: screen-right on the floor. `into`: FROM the eye TOWARD the target on the floor.
  // THE GROUND FOLLOWS THE CURSOR — see THE DIRECTION SENSES above.
  const rightX = -sy;
  const rightY = cy;
  const intoX = -cy;
  const intoY = -sy;
  const dRight = -dxPx * scale;
  const dInto = dyPx * scale;
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

/**
 * ZOOM TOWARD THE CURSOR — the same dolly, plus the look-at point sliding so that the floor
 * point the cursor is over stays exactly under the cursor.
 *
 * THE MATH IS ONE LINE AND IT IS EXACT. Scaling the whole camera about a fixed point `P` —
 * `eye' = P + (eye − P)·f`, `target' = P + (target − P)·f` — leaves every direction from the eye
 * to `P` unchanged (the eye only slides along the line through `P`) and leaves the eye→target
 * direction unchanged too, so `P` keeps its screen position and the scene grows about it. In
 * this parametrisation `eye − target` scales by `f`, so `dist' = dist·f` with yaw and pitch
 * untouched, and `target'` is the lerp above. `P` is on the floor and so is `target`, so the
 * target never leaves the floor plane and the state stays a `FreeCamState`.
 *
 * The CLAMPS still bind, and where one bites the point under the cursor does move — a dolly that
 * has hit `FREE_CAM_DIST_MIN`, or a target pushed past the field margin, is a bounded camera
 * rather than a broken one, and the alternative (letting the target chase the cursor off the
 * field) is the bug the margin exists to prevent.
 */
export function dollyFreeCamToward(s: FreeCamState, factor: number, floorX: number, floorY: number): FreeCamState {
  if (!Number.isFinite(floorX) || !Number.isFinite(floorY)) return dollyFreeCam(s, factor);
  const f = Number.isFinite(factor) ? factor : 1;
  return clampFreeCam({
    ...s,
    dist: s.dist * factor,
    target: [floorX + (s.target[0] - floorX) * f, floorY + (s.target[1] - floorY) * f],
  });
}

// ───────────────────────────────────────────────────────────────── mouse navigation presets ──

/**
 * WHICH MOUSE BUTTON DOES WHAT (owner, 2026-09-21: "scroll wheel click to slide around ... presets
 * for popular cad software", then "the presets for free camera are incorrect ... review them
 * thoroughly and make it absolutely accurate"). A CAD user's hands already know one of these by
 * heart, and the packages disagree on every button, so the mapping is a per-device pick.
 *
 * EVERY ROW BELOW IS OFF THE VENDOR'S OWN CURRENT HELP PAGE. `docs/biobuzz/free-cam-presets.md`
 * carries the URLs, the quoted wording and what each vendor does NOT state.
 *
 *   preset       orbit                pan                        zoom (drag)          wheel fwd
 *   dsim         right · left         middle · ctrl+right ·      —                    in
 *                                     shift+left
 *   onshape      right                middle · ctrl+right        —                    in
 *   solidworks   middle               ctrl+middle                shift+middle         in *
 *   fusion       shift+middle         middle                     ctrl+shift+middle    in *
 *   blender      middle               shift+middle               ctrl+middle          in
 *   custom       whatever the player bound                                            in
 *
 * `*` = the vendor publishes the buttons but not the wheel's default direction; ours matches the
 * two that DO publish it (Onshape "Scroll wheel up: Zoom in", Blender's default keymap binds
 * `WHEELINMOUSE` to `view3d.zoom` with `delta 1`). The player can override it per device.
 *
 * ALT IS NOT PART OF ANY PRESET, and is ignored when one is matched — so Onshape's own
 * `Alt + right-drag` constrained rotate lands on a plain orbit here rather than on nothing. A
 * CUSTOM bind matches Alt exactly, because there it is the player's own choice.
 *
 * A CAD preset leaves the LEFT button unbound on purpose — it is "select" in all of them, and
 * here that keeps it free for the start-position editor. `dsim` is the exception and it is
 * deliberate: it is ONSHAPE's mapping (owner: "DSIM default should also be very close to how the
 * onshape one works") plus left-drag orbit and shift+left pan, because this app's OTHER
 * spectator camera has always orbited on a left-drag and a player who cycles `orbit` → `free`
 * should not have the gesture disappear under their hand.
 */
export const FREE_CAM_PRESETS = ['dsim', 'onshape', 'solidworks', 'fusion', 'blender', 'custom'] as const;
export type FreeCamPreset = (typeof FREE_CAM_PRESETS)[number];

export type FreeCamGesture = 'orbit' | 'pan' | 'zoom';

export interface FreeCamMods {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

/** one mouse chord. `button` is `PointerEvent.button`: 0 left, 1 middle, 2 right. `ctrl` is ctrl
 * OR meta at the call site, so a Mac's ⌘ works wherever a PC's ctrl does. */
export interface FreeCamBind {
  button: 0 | 1 | 2;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

/** the CUSTOM preset's three assignments. `null` is UNBOUND — the same state the key binder
 * leaves a victim in when a chord is stolen from it. */
export interface FreeCamCustom {
  orbit: FreeCamBind | null;
  pan: FreeCamBind | null;
  zoom: FreeCamBind | null;
}

const bind = (button: 0 | 1 | 2, shift = false, ctrl = false, alt = false): FreeCamBind => ({ button, shift, ctrl, alt });

interface PresetRow {
  b: 0 | 1 | 2;
  shift?: true;
  ctrl?: true;
  g: FreeCamGesture;
}

const PRESET_TABLE: Record<Exclude<FreeCamPreset, 'custom'>, readonly PresetRow[]> = {
  dsim: [
    { b: 2, g: 'orbit' },
    { b: 0, g: 'orbit' },
    { b: 1, g: 'pan' },
    { b: 2, ctrl: true, g: 'pan' },
    { b: 0, shift: true, g: 'pan' },
  ],
  onshape: [
    { b: 2, g: 'orbit' },
    { b: 1, g: 'pan' },
    { b: 2, ctrl: true, g: 'pan' },
  ],
  solidworks: [
    { b: 1, g: 'orbit' },
    { b: 1, ctrl: true, g: 'pan' },
    { b: 1, shift: true, g: 'zoom' },
  ],
  fusion: [
    { b: 1, g: 'pan' },
    { b: 1, shift: true, g: 'orbit' },
    { b: 1, shift: true, ctrl: true, g: 'zoom' },
  ],
  blender: [
    { b: 1, g: 'orbit' },
    { b: 1, shift: true, g: 'pan' },
    { b: 1, ctrl: true, g: 'zoom' },
  ],
};

/** which way a preset's WHEEL goes by default: `'in'` = pushing the wheel forward (away from the
 * hand, `deltaY < 0`) moves the camera closer. See the table above for which two are the
 * vendor's published default and which two are ours. */
export const FREE_CAM_PRESET_WHEEL: Record<FreeCamPreset, 'in' | 'out'> = {
  dsim: 'in',
  onshape: 'in',
  solidworks: 'in',
  fusion: 'in',
  blender: 'in',
  custom: 'in',
};

/** the persisted navigation pick (`graphics/store.ts`, `FREE_CAM_NAV_KEY`) — ONE object in ONE
 * key, field-by-field coerced, so an older stored blob (which carried `preset` + `invertZoom`
 * and nothing else) still loads and simply picks up the defaults for everything added since. */
export interface FreeCamNav {
  preset: FreeCamPreset;
  /** `'preset'` follows `FREE_CAM_PRESET_WHEEL`; the other two are the player overriding it. */
  wheel: 'preset' | 'in' | 'out';
  invertOrbitX: boolean;
  invertOrbitY: boolean;
  invertPan: boolean;
  /** zoom toward the floor point under the cursor rather than toward the look-at point. OFF by
   * default: of the four packages, only Blender documents the behaviour at all, and it documents
   * it as an option you ENABLE ("instead of the 2D window center"). */
  zoomToCursor: boolean;
  /** ease the camera toward its goal (`renderCameras.ts`'s `FREE_CAM_HALFLIFE`), or snap. */
  smoothing: boolean;
  orbitSpeed: number;
  panSpeed: number;
  zoomSpeed: number;
  custom: FreeCamCustom;
}

export const FREE_CAM_SPEED_MIN = 0.25;
export const FREE_CAM_SPEED_MAX = 4;

export const FREE_CAM_NAV_DEFAULT: FreeCamNav = {
  preset: 'dsim',
  wheel: 'preset',
  invertOrbitX: false,
  invertOrbitY: false,
  invertPan: false,
  zoomToCursor: false,
  smoothing: true,
  orbitSpeed: 1,
  panSpeed: 1,
  zoomSpeed: 1,
  // a CUSTOM layout nobody has edited yet is Onshape's, which is also `dsim`'s three primaries —
  // starting from "unbound" would hand the player a camera that cannot move.
  custom: { orbit: bind(2), pan: bind(1), zoom: bind(1, true) },
};

/** the nav a bare preset name means — for the checks, and for anywhere a preset has to be
 * evaluated without a stored blob in hand. */
export function freeCamNavFor(preset: FreeCamPreset): FreeCamNav {
  return { ...FREE_CAM_NAV_DEFAULT, preset, custom: { ...FREE_CAM_NAV_DEFAULT.custom } };
}

function coerceBind(raw: unknown): FreeCamBind | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const b = r.button;
  if (b !== 0 && b !== 1 && b !== 2) return null;
  return { button: b, shift: r.shift === true, ctrl: r.ctrl === true, alt: r.alt === true };
}

function coerceSpeed(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? clampNum(raw, FREE_CAM_SPEED_MIN, FREE_CAM_SPEED_MAX) : 1;
}

/** field-by-field, so a corrupt or older stored value degrades to the default per field.
 * ⚠️ `invertZoom` is the field the FIRST version of this setting shipped with; a blob written by
 * that build still means "forward zooms out", so it is read as `wheel: 'out'` rather than
 * dropped. An unknown preset — including a `custom` written by some future build — falls back to
 * `dsim`, which is the one preset guaranteed to exist. */
export function coerceFreeCamNav(raw: unknown): FreeCamNav {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const preset = (FREE_CAM_PRESETS as readonly unknown[]).includes(r.preset) ? (r.preset as FreeCamPreset) : FREE_CAM_NAV_DEFAULT.preset;
  const wheel = r.wheel === 'in' || r.wheel === 'out' || r.wheel === 'preset' ? r.wheel : r.invertZoom === true ? 'out' : 'preset';
  const rc = (r.custom && typeof r.custom === 'object' ? r.custom : {}) as Record<string, unknown>;
  const custom: FreeCamCustom = {
    orbit: 'orbit' in rc ? coerceBind(rc.orbit) : FREE_CAM_NAV_DEFAULT.custom.orbit,
    pan: 'pan' in rc ? coerceBind(rc.pan) : FREE_CAM_NAV_DEFAULT.custom.pan,
    zoom: 'zoom' in rc ? coerceBind(rc.zoom) : FREE_CAM_NAV_DEFAULT.custom.zoom,
  };
  return {
    preset,
    wheel,
    invertOrbitX: r.invertOrbitX === true,
    invertOrbitY: r.invertOrbitY === true,
    invertPan: r.invertPan === true,
    zoomToCursor: r.zoomToCursor === true,
    smoothing: r.smoothing !== false,
    orbitSpeed: coerceSpeed(r.orbitSpeed),
    panSpeed: coerceSpeed(r.panSpeed),
    zoomSpeed: coerceSpeed(r.zoomSpeed),
    custom,
  };
}

/** assign `b` to `gesture`, STEALING it from whichever other gesture held the identical chord —
 * the same conflict policy the key binder uses (`docs/area/ui.md`: "a rebound key is STOLEN from
 * its old action (may show UNBOUND)"), because the alternative is two gestures on one chord and
 * an arbitrary winner. */
export function bindFreeCamCustom(custom: FreeCamCustom, gesture: FreeCamGesture, b: FreeCamBind): FreeCamCustom {
  const next: FreeCamCustom = { ...custom };
  for (const g of ['orbit', 'pan', 'zoom'] as const) {
    if (g !== gesture && next[g] && sameBind(next[g] as FreeCamBind, b)) next[g] = null;
  }
  next[gesture] = { ...b };
  return next;
}

export function sameBind(a: FreeCamBind, b: FreeCamBind): boolean {
  return a.button === b.button && a.shift === b.shift && a.ctrl === b.ctrl && a.alt === b.alt;
}

/**
 * WHAT THIS PRESS MEANS. `null` = not a camera gesture, and the listener must leave it alone
 * (a right-click keeps its context menu, the start-position editor keeps its left-click).
 *
 * A PRESET matches button + shift + ctrl and IGNORES alt; CUSTOM matches all four, because there
 * the modifiers are the player's own choice and an ignored one would make two of their bindings
 * indistinguishable.
 */
export function freeCamGesture(nav: FreeCamNav, button: number, mods: FreeCamMods): FreeCamGesture | null {
  if (button !== 0 && button !== 1 && button !== 2) return null;
  if (nav.preset === 'custom') {
    const probe: FreeCamBind = { button, shift: mods.shift, ctrl: mods.ctrl, alt: mods.alt };
    for (const g of ['orbit', 'pan', 'zoom'] as const) {
      const b = nav.custom[g];
      if (b && sameBind(b, probe)) return g;
    }
    return null;
  }
  for (const row of PRESET_TABLE[nav.preset]) {
    if (row.b === button && (row.shift === true) === mods.shift && (row.ctrl === true) === mods.ctrl) return row.g;
  }
  return null;
}

/** which way the wheel goes for this nav — the preset's own default unless the player overrode
 * it. `'in'` means a forward push (`deltaY < 0`) moves the camera closer. */
export function freeCamWheelDir(nav: FreeCamNav): 'in' | 'out' {
  return nav.wheel === 'preset' ? FREE_CAM_PRESET_WHEEL[nav.preset] : nav.wheel;
}

/** `+1` when the wheel's raw `deltaY` may be used as-is (a positive delta — scrolling toward the
 * hand — pushes the camera OUT), `-1` when the player has asked for the other way round. */
export function freeCamWheelSign(nav: FreeCamNav): 1 | -1 {
  return freeCamWheelDir(nav) === 'in' ? 1 : -1;
}

/**
 * A SCREEN DRAG → the orbit's two angle deltas, with the CAD direction sense (see THE DIRECTION
 * SENSES above), the player's own inversions and their sensitivity all applied in ONE place.
 * `yawRate`/`pitchRate` are the caller's radians-per-pixel (`renderCameras.ts` owns them, beside
 * the spectator orbit's identical pair).
 */
export function freeCamOrbitDelta(
  nav: FreeCamNav,
  dxPx: number,
  dyPx: number,
  yawRate: number,
  pitchRate: number,
): { dYaw: number; dPitch: number } {
  const speed = nav.orbitSpeed;
  return {
    dYaw: -dxPx * yawRate * speed * (nav.invertOrbitX ? -1 : 1),
    dPitch: dyPx * pitchRate * speed * (nav.invertOrbitY ? -1 : 1),
  };
}

/** the multiplier `panFreeCam` takes — sensitivity, negated when the player inverts the pan. */
export function freeCamPanGain(nav: FreeCamNav): number {
  return nav.panSpeed * (nav.invertPan ? -1 : 1);
}

/** the one-line reminder the Graphics section prints under the picker — each states the TRUE
 * mapping of its own preset, which is the only thing the label cannot say. */
export const FREE_CAM_PRESET_HINT: Record<FreeCamPreset, string> = {
  dsim: 'Right or left-drag to orbit · middle-drag, Ctrl+right or Shift+left to pan · scroll to zoom',
  onshape: 'Right-drag to orbit · middle-drag or Ctrl+right-drag to pan · scroll to zoom',
  solidworks: 'Middle-drag to orbit · Ctrl+middle to pan · Shift+middle or scroll to zoom',
  fusion: 'Middle-drag to pan · Shift+middle to orbit · Ctrl+Shift+middle or scroll to zoom',
  blender: 'Middle-drag to orbit · Shift+middle to pan · Ctrl+middle or scroll to zoom',
  custom: 'Your own buttons, below · scroll to zoom',
};

export const FREE_CAM_PRESET_LABEL: Record<FreeCamPreset, string> = {
  dsim: 'DSIM',
  onshape: 'Onshape',
  solidworks: 'SolidWorks',
  fusion: 'Fusion',
  blender: 'Blender',
  custom: 'Custom',
};

/** a chord as the UI prints it on a keycap — `Ctrl` covers ⌘ too, which is what the listener
 * does with `metaKey`. */
export function freeCamBindLabel(b: FreeCamBind | null): string {
  if (!b) return 'Unbound';
  const parts: string[] = [];
  if (b.ctrl) parts.push('Ctrl');
  if (b.shift) parts.push('Shift');
  if (b.alt) parts.push('Alt');
  parts.push(b.button === 0 ? 'Left' : b.button === 1 ? 'Middle' : 'Right');
  return parts.join('+');
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
