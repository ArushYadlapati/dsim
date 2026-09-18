import * as THREE from 'three';
import type { SceneFrame } from '../../module';
import type { Alliance } from '../../../types';
import { BB3_WALL_H, BB_HALF_X, BB_HALF_Y, BB_HIVE_X, BB_VIEW_MARGIN } from '../config';

/**
 * BIOBUZZ 3D SCENE — cameras (Day 1, `docs/biobuzz/plan-3d.md` §4.3, §13.1).
 *
 * Coordinates throughout `scene/`: field INCHES, z UP (x right, y up-field, z up) — there is no
 * axis conversion anywhere in this directory. Every camera's `up` is (0,0,1).
 *
 * Both cameras are driven ENTIRELY by `frame.viewAngle`, the same angle the shared 2D camera
 * (`src/render/camera.ts`'s `Camera.worldToScreen`) rotates the world by so a driver's own wall
 * reads at the bottom of the screen: `rot(p, viewAngle)` then a y-flip, `screenUpWorld()` =
 * `rot({x:0,y:1}, -viewAngle)`. Re-deriving "which wall does this alliance's driver stand at"
 * from `frame.localRobotId`'s alliance would have to agree with that rotation anyway (BIOBUZZ's
 * 2D field renders under the exact same `Camera`), so this file takes the angle as its one input
 * and never looks up a robot — see `renderScene.ts`'s header for the consequence: a caller that
 * ever wants a viewAngle that is not a clean per-alliance one (a free spectator orbit, say) has
 * nowhere to plug that into a `SceneFrame` today. Noted as a gotcha for the integration lane.
 */

/** unit world-space (x,y) direction "into the field" for a given screen orientation — inlined
 * copy of `Camera.screenUpWorld()`'s `rot({x:0,y:1}, -viewAngle)` (standard CCW rotation), so
 * this file needs no import from the 2D camera (which is built around a canvas context this
 * scene does not have). */
function forwardOf(viewAngle: number): { x: number; y: number } {
  const theta = -viewAngle;
  return { x: -Math.sin(theta), y: Math.cos(theta) };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// DRIVER CAMERA FIT (issue 4, 2026-09-18 playtest: "driver POV is not showing the close edge of
// the field; make sure the whole field is visible"). The Day 1 camera used a FIXED eye height,
// setback and FOV (62 / 12 / 70) and simply `lookAt` the field centre — nothing checked that the
// near edge (the wall right behind the robot, and the floor in front of it) actually landed
// inside the frustum, and at a 12-in setback it does not: the near corners of the field sit only
// a foot or so in front of the eye but 72+ in off to the side, which is a near-90° angle off the
// forward axis. `fitDriverCamera` SOLVES for a pitch + vertical FOV (and, when the geometry
// demands it, a taller eye and/or a bigger setback) that gets every corner inside the frame,
// instead of guessing a constant and hoping.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** driver eye height, in — the STARTING point of the search (a stand-height view "keeps the
 * driver feel," owner brief). Raised toward `DRIVER_EYE_H_MAX` first, before the setback is ever
 * touched, because moving the eye up costs nothing gameplay-wise and a taller eye alone is often
 * enough at a wide-enough aspect (see the report: 21:9 fits at the DEFAULT setback once the eye
 * is raised, no setback change needed at all). */
const DRIVER_EYE_H_DEFAULT = 62;
/** plan-3d.md §4.3's own range for the eye-height key (`i`/`o`) — the search never leaves it. */
const DRIVER_EYE_H_MIN = 44;
const DRIVER_EYE_H_MAX = 72;
void DRIVER_EYE_H_MIN; // the search's lower bound never comes up (it only ever raises the eye
// above `DRIVER_EYE_H_DEFAULT`) — kept as a named constant documenting plan-3d.md §4.3's full
// `i`/`o` eye-height range this camera can be manually driven to, not a value this fit ever picks.
/** how far outside the field wall the driver's eye starts, in — the plan doc's original figure.
 * Kept as the default for a wide-enough aspect (16:9 and wider commonly fit here once the eye is
 * raised); a narrower aspect (4:3, portrait, a phone) needs more room and the search grows this,
 * never shrinks it below the default. */
const DRIVER_SETBACK_DEFAULT = 12;
/** the search's own ceiling — a generous "stagecraft" cap (20 ft) so a pathological aspect (a
 * folded phone, near-square) cannot spin the binary search forever chasing an unreachable fit;
 * past this, the fit reports its best effort rather than an ever-growing setback. Every aspect
 * this scene is actually tested at (16:9, 4:3, 9:16, a real phone's ~390:844) resolves well
 * inside this cap — see the report's measured setbacks. */
const DRIVER_SETBACK_MAX = 240;
/** vertical FOV bounds, degrees — plan-3d.md §4.3/§4.4's own range for this camera. */
const DRIVER_FOV_MIN = 60;
const DRIVER_FOV_MAX = 95;
/** the frame margin every fitted point must clear, as a fraction of the half-FOV — "a 4% margin"
 * (the brief), so a corner lands just inside the edge rather than exactly on it (where a rounding
 * error or a resize mid-frame could clip it). */
const DRIVER_MARGIN = 0.04;

const FOV_MIN_RAD = (DRIVER_FOV_MIN * Math.PI) / 180;
const FOV_MAX_RAD = (DRIVER_FOV_MAX * Math.PI) / 180;

/** the tray's own peak height during a tip, APPROX — the manual's up-cell opening tops out at
 * `BB_HIVE_OPEN_Z[1]` (65.6), and the brief's own figure for "the hive tops" is "z ≈ 66"; this is
 * that same APPROX carried as a named constant rather than a bare literal in the point list
 * below. Not `BB3_HIVE_PIVOT_Z` (43.95, the HINGE, not the tray's highest point). */
const HIVE_TOP_Z_APPROX = 66;

/** every point the driver camera's frustum must contain, in field-absolute inches — the four
 * ground corners, the four wall-top corners (near AND far; the brief calls out the near wall by
 * name, but nothing distinguishes "near" from "far" analytically here, so both are fitted and
 * whichever the camera actually stands behind is automatically the tighter constraint), and the
 * two hive tops. Built ONCE at module load — this is field geometry, not per-frame state. */
interface FitPoint {
  x: number;
  y: number;
  z: number;
}
const FIT_POINTS: readonly FitPoint[] = (() => {
  const pts: FitPoint[] = [];
  for (const sx of [1, -1] as const) {
    for (const sy of [1, -1] as const) {
      pts.push({ x: sx * BB_HALF_X, y: sy * BB_HALF_Y, z: 0 });
      pts.push({ x: sx * BB_HALF_X, y: sy * BB_HALF_Y, z: BB3_WALL_H });
    }
  }
  pts.push({ x: BB_HIVE_X, y: 0, z: HIVE_TOP_Z_APPROX });
  pts.push({ x: -BB_HIVE_X, y: 0, z: HIVE_TOP_Z_APPROX });
  return pts;
})();

interface FitResult {
  /** pitch DOWN from horizontal, radians — positive tilts the look direction toward the floor. */
  pitch: number;
  /** the vertical FOV this pitch needs to clear every `FIT_POINTS` entry at `DRIVER_MARGIN`,
   * BEFORE clamping to `[DRIVER_FOV_MIN, DRIVER_FOV_MAX]` — the caller clamps and, separately,
   * uses the unclamped value to decide whether the search must keep growing the setback. */
  vFov: number;
  /** true iff `vFov <= DRIVER_FOV_MAX` (in radians) AND every point is genuinely in front of the
   * camera (a pathological eye position — inside the field, say — could put a point behind it,
   * where an angle comparison alone would falsely read as "fits"). */
  fits: boolean;
}

/**
 * Solve the pitch and required vertical FOV for one candidate (eye height, setback, aspect).
 *
 * THE MATH, ONE PARAGRAPH. Build the camera's UN-PITCHED basis at the given yaw: forward `F0`
 * (horizontal, `forwardOf(viewAngle)`), up `Z = (0,0,1)`, right `R = F0 × Z`... — actually `R`
 * is built directly as `(F0.y, -F0.x)` (equivalent, no `Z` needed since both are horizontal/
 * vertical respectively). For any point, its offset from the eye decomposes as `x0` (along `R`,
 * UNCHANGED by pitch), `y0` (along world `Z`) and `z0` (along `F0`) — and pitching the camera
 * down by `θ` about `R` is EXACTLY a 2D rotation of `(z0, y0)` by `θ`: `zc = z0·cosθ − y0·sinθ`,
 * `yc = z0·sinθ + y0·cosθ`, `xc = x0`. So a point's ELEVATION angle `atan2(yc, zc)` is simply
 * `atan2(y0, z0) + θ` for every point — independent of `xc` — which means the pitch that
 * CENTRES the vertical spread (and so minimises the vertical FOV the fit needs) is a closed
 * form: `θ = −(βMin + βMax) / 2` where `β = atan2(y0, z0)` is each point's UN-PITCHED elevation.
 * The vertical FOV that clears the centred spread, and the horizontal FOV that clears the widest
 * `|xc/zc|` at the given `aspect` (via `hFov = 2·atan(tan(vFov/2)·aspect)`, so `vFov` is solved
 * for from the horizontal requirement too), both fold `DRIVER_MARGIN` in as a shrink on the
 * available half-angle, matching "a 4% margin" — a bigger REQUIRED fov, not a smaller one, is
 * what leaves room for the margin.
 */
function solveFit(eyeH: number, setback: number, aspect: number, viewAngle: number): FitResult {
  const fwd = forwardOf(viewAngle);
  const eyeDist = BB_HALF_X + setback; // the field is square — see `updateDriver`'s own note
  const eyeX = -fwd.x * eyeDist;
  const eyeY = -fwd.y * eyeDist;
  const rx = fwd.y;
  const ry = -fwd.x;

  let betaMin = Infinity;
  let betaMax = -Infinity;
  // pass 1: the UN-PITCHED elevation of every point, to solve the centring pitch.
  const z0s: number[] = new Array(FIT_POINTS.length);
  const y0s: number[] = new Array(FIT_POINTS.length);
  const x0s: number[] = new Array(FIT_POINTS.length);
  for (let i = 0; i < FIT_POINTS.length; i++) {
    const p = FIT_POINTS[i];
    const vx = p.x - eyeX;
    const vy = p.y - eyeY;
    const z0 = vx * fwd.x + vy * fwd.y;
    const y0 = p.z - eyeH;
    const x0 = vx * rx + vy * ry;
    z0s[i] = z0;
    y0s[i] = y0;
    x0s[i] = x0;
    const beta = Math.atan2(y0, z0);
    if (beta < betaMin) betaMin = beta;
    if (beta > betaMax) betaMax = beta;
  }
  const pitch = -(betaMin + betaMax) / 2;
  const marginScale = 1 - DRIVER_MARGIN;

  const vertHalf = Math.max(Math.abs(betaMin + pitch), Math.abs(betaMax + pitch));
  const vFovForVertical = (2 * vertHalf) / marginScale;

  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  let maxHorizRatio = 0;
  let minZc = Infinity;
  for (let i = 0; i < FIT_POINTS.length; i++) {
    const zc = z0s[i] * cosP - y0s[i] * sinP;
    if (zc < minZc) minZc = zc;
    const ratio = zc > 1e-6 ? Math.abs(x0s[i]) / zc : Infinity;
    if (ratio > maxHorizRatio) maxHorizRatio = ratio;
  }
  const vFovForHorizontal = 2 * Math.atan(maxHorizRatio / (aspect * marginScale));

  const vFov = Math.max(vFovForVertical, vFovForHorizontal);
  const fits = vFov <= FOV_MAX_RAD + 1e-9 && minZc > 1e-3 && Number.isFinite(vFov);
  return { pitch, vFov, fits };
}

export interface DriverFit {
  eyeH: number;
  setback: number;
  pitch: number;
  vFov: number;
}

/**
 * `fitDriverCamera(alliance, viewAngle, aspect)` — the eye sits behind the ALLIANCE wall centre
 * (the `alliance` the contract names), but the fit itself only ever needs `viewAngle`: the field
 * is square and every `FIT_POINTS` entry is field-absolute, so "which wall" is already fully
 * carried by the yaw `forwardOf(viewAngle)` resolves to (see `updateDriver`'s own comment on the
 * square-field shortcut this already relied on). `alliance` is kept in the signature per the
 * contract — and for a future asymmetric-field revision where it would stop being redundant —
 * but is not read here.
 *
 * THE SEARCH (the brief's own order): try the default eye height and setback; if that overshoots
 * `DRIVER_FOV_MAX`, raise the eye to `DRIVER_EYE_H_MAX` (free — no gameplay cost, and often
 * enough on its own for a wide-enough aspect); if it STILL overshoots, binary-search the setback
 * upward (monotonic: a bigger setback only ever shrinks the required FOV, so bisection is exact)
 * up to `DRIVER_SETBACK_MAX`, and use the best the search reaches even if that cap itself cannot
 * fit (reported as `!fits`, never thrown — a slightly-cropped corner beats a broken camera).
 *
 * `aspect` IS THE SAFE RECT'S, not the canvas's (see the safe-rect block below `DriverFit`): the
 * field has to fit the part of the viewport the HUD does not cover, so every number this returns
 * is solved against that, and the canvas is then rendered as a wider window onto it.
 *
 * CACHED, not recomputed every frame: `updateDriver` calls this once per render, but the search
 * only has to re-run when `viewAngle` or `aspect` actually changes (an alliance switch, a
 * resize, a HUD band appearing) — the common case (same match, same window) is two `!==`
 * comparisons against the raw numbers (no string key, no allocation at all), which is what
 * keeps this a zero-per-frame-
 * allocation camera despite the search itself allocating a small scratch array per solve.
 */
let cachedViewAngle = NaN;
let cachedAspect = NaN;
const cached: DriverFit = { eyeH: DRIVER_EYE_H_DEFAULT, setback: DRIVER_SETBACK_DEFAULT, pitch: 0, vFov: FOV_MAX_RAD };

export function fitDriverCamera(_alliance: Alliance, viewAngle: number, aspect: number): DriverFit {
  if (viewAngle === cachedViewAngle && aspect === cachedAspect) return cached;
  cachedViewAngle = viewAngle;
  cachedAspect = aspect;

  let eyeH = DRIVER_EYE_H_DEFAULT;
  let setback = DRIVER_SETBACK_DEFAULT;
  let r = solveFit(eyeH, setback, aspect, viewAngle);

  if (!r.fits) {
    eyeH = DRIVER_EYE_H_MAX;
    r = solveFit(eyeH, setback, aspect, viewAngle);
  }

  if (!r.fits) {
    const atCap = solveFit(eyeH, DRIVER_SETBACK_MAX, aspect, viewAngle);
    if (atCap.fits) {
      let lo = setback;
      let hi = DRIVER_SETBACK_MAX;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (solveFit(eyeH, mid, aspect, viewAngle).fits) hi = mid;
        else lo = mid;
      }
      setback = hi;
    } else {
      setback = DRIVER_SETBACK_MAX; // best effort — see this function's own header
    }
    r = solveFit(eyeH, setback, aspect, viewAngle);
  }

  const vFov = Math.min(FOV_MAX_RAD, Math.max(FOV_MIN_RAD, r.vFov));
  cached.eyeH = eyeH;
  cached.setback = setback;
  cached.pitch = r.pitch;
  cached.vFov = vFov;
  return cached;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE SAFE RECT (owner's re-test, 2026-09-18: "make sure that the scoreboard and the field can
// both fit in the screen without overlap"). The WebGL canvas fills the whole `.game-viewport`,
// and the score bar, the breakdown chips and the status/menu clusters are absolutely positioned
// ON TOP of it — so a camera fitted to the canvas puts part of the field under chrome that hides
// it. `SceneFrame.insets` (measured off the live DOM by `GameController.refreshHudInsets`) says
// how much of each edge is spoken for; the field is fitted to what is LEFT.
//
// THE TRICK IS `setViewOffset`, not a smaller viewport. Rendering into a sub-viewport would
// leave the HUD sitting on empty backdrop and waste the pixels behind it; instead the camera
// solves for a VIRTUAL IMAGE the size of the safe rect, and then renders a WINDOW onto that
// virtual image which is the whole canvas — offset so the safe rect lands exactly under the
// uncovered area. The field fills the safe rect; what spills past it is the parts of the scene
// that were always going to be behind the HUD anyway (backdrop, the near floor), drawn rather
// than blanked. Both three.js cameras implement the same `view` carve-out, so the driver
// (perspective) and the overhead (orthographic) take identical arguments.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** the resolved safe rect for THIS frame — one module-scope object, rewritten per frame and
 * never reallocated (this camera file allocates nothing per frame; see `fitDriverCamera`'s
 * cache note). `left`/`top` are the CSS-px insets, `w`/`h` the safe rect's size, `fullW`/`fullH`
 * the canvas's, and `offset` is false when there is no chrome at all (the gallery, a preview
 * harness, a `SceneFrame` from before `insets` existed) — in which case the cameras run exactly
 * as they did before this existed. */
const safe = { left: 0, top: 0, w: 1, h: 1, fullW: 1, fullH: 1, offset: false };

function resolveSafeRect(frame: SceneFrame): void {
  const fullW = Math.max(1, frame.width);
  const fullH = Math.max(1, frame.height);
  const ins = frame.insets;
  let left = ins ? Math.max(0, ins.left) : 0;
  let right = ins ? Math.max(0, ins.right) : 0;
  let top = ins ? Math.max(0, ins.top) : 0;
  let bottom = ins ? Math.max(0, ins.bottom) : 0;
  // A DEGENERATE SAFE RECT IS A BROKEN CAMERA, not a tight one: a zero or negative width hands
  // the fit an infinite aspect and `setViewOffset` a division by zero. The controller caps each
  // band at 45 % already, but this scene takes its insets from whoever hands it a `SceneFrame`
  // and must not trust them — an axis that has been over-claimed drops its chrome allowance
  // entirely rather than produce a rect nothing can be fitted into.
  if (left + right > fullW * 0.9) left = right = 0;
  if (top + bottom > fullH * 0.9) top = bottom = 0;
  safe.left = left;
  safe.top = top;
  safe.w = fullW - left - right;
  safe.h = fullH - top - bottom;
  safe.fullW = fullW;
  safe.fullH = fullH;
  safe.offset = left > 0.5 || right > 0.5 || top > 0.5 || bottom > 0.5;
}

/** apply (or clear) this frame's safe-rect window on either camera. `setViewOffset`'s first two
 * arguments are the VIRTUAL image — the safe rect — and the last four the window rendered onto
 * it, which is the whole canvas shifted back by the top/left insets. On a `PerspectiveCamera`
 * this also sets `aspect` to the safe rect's, which is exactly the aspect the fit solved for. */
function applyViewOffset(cam: THREE.PerspectiveCamera | THREE.OrthographicCamera): void {
  if (safe.offset) cam.setViewOffset(safe.w, safe.h, -safe.left, -safe.top, safe.fullW, safe.fullH);
  else if (cam.view?.enabled) cam.clearViewOffset();
}

export interface BbCameras {
  driver: THREE.PerspectiveCamera;
  overhead: THREE.OrthographicCamera;
  /** update both cameras for this frame and return the one `frame.camera` names. */
  update(frame: SceneFrame): THREE.Camera;
}

/** scratch target for `driver.lookAt` — one object, mutated every frame, never reallocated. */
const scratchTarget = new THREE.Vector3();

export function createCameras(): BbCameras {
  const driver = new THREE.PerspectiveCamera(DRIVER_FOV_MIN, 1, 1, 4000);
  driver.up.set(0, 0, 1);
  const overhead = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
  overhead.up.set(0, 0, 1);

  function updateDriver(frame: SceneFrame): void {
    const fwd = forwardOf(frame.viewAngle);
    // THE FIT IS AGAINST THE SAFE RECT, not the canvas — the field has to land inside the part
    // of the viewport the HUD is not covering, so that is the aspect (and the virtual image)
    // every number below is solved for.
    resolveSafeRect(frame);
    const aspect = Math.max(1e-3, safe.w / safe.h);
    // the field is square (BB_HALF_X === BB_HALF_Y), so one half-extent is the wall distance on
    // every side regardless of which alliance's viewAngle this frame carries
    const fit = fitDriverCamera('red', frame.viewAngle, aspect);
    const eyeDist = BB_HALF_X + fit.setback;
    driver.aspect = aspect;
    driver.fov = (fit.vFov * 180) / Math.PI;
    applyViewOffset(driver);
    const eyeX = -fwd.x * eyeDist;
    const eyeY = -fwd.y * eyeDist;
    driver.position.set(eyeX, eyeY, fit.eyeH);
    driver.up.set(0, 0, 1);
    // look along the pitched forward direction F(θ) = F0·cosθ − Z·sinθ — see `solveFit`'s header
    // for the derivation; any positive distance along that ray is a valid look-at target.
    const cosP = Math.cos(fit.pitch);
    const sinP = Math.sin(fit.pitch);
    const lookDist = 100;
    scratchTarget.set(eyeX + fwd.x * cosP * lookDist, eyeY + fwd.y * cosP * lookDist, fit.eyeH - sinP * lookDist);
    driver.lookAt(scratchTarget);
    driver.updateProjectionMatrix();
  }

  function updateOverhead(frame: SceneFrame): void {
    const fwd = forwardOf(frame.viewAngle);
    // the SAFE rect's aspect, same as the driver camera — this is the phone/touch default
    // (`sceneCameraFor`), where the score bar and the chip row take the largest share of a
    // small viewport and an unfitted overhead shot puts the far wall straight under the bar
    resolveSafeRect(frame);
    const aspect = Math.max(1e-3, safe.w / safe.h);
    // fit the field plus the same view margin the 2D bounds use (`bounds.viewMargin`), in BOTH
    // screen axes — the square field means a screen-aligned fit needs no rotation-dependent math
    const half = BB_HALF_X + BB_VIEW_MARGIN;
    const halfH = aspect >= 1 ? half : half / aspect;
    const halfW = aspect >= 1 ? half * aspect : half;
    overhead.left = -halfW;
    overhead.right = halfW;
    overhead.top = halfH;
    overhead.bottom = -halfH;
    overhead.near = 1;
    overhead.far = 4000;
    // the ortho box just set IS the virtual image; the window onto it is the whole canvas
    applyViewOffset(overhead);
    overhead.position.set(0, 0, 800);
    // screen-up on the overhead view is world "forward" (into the field from the driver's own
    // wall), matching `worldToScreen`'s rotation for the 2D view
    overhead.up.set(fwd.x, fwd.y, 0);
    overhead.lookAt(0, 0, 0);
    overhead.updateProjectionMatrix();
  }

  return {
    driver,
    overhead,
    update(frame: SceneFrame): THREE.Camera {
      updateDriver(frame);
      updateOverhead(frame);
      return frame.camera === 'driver' ? driver : overhead;
    },
  };
}
