/**
 * DRIVER EYE — a real person's eye, standing where the drive team actually stands (owner,
 * 2026-09-21: "make the driver camera be perfectly accurate to a person in real life looking
 * at the field... depending on their role or starting position, it should change where they
 * are standing slightly").
 *
 * Pure math, DOM-free, no `three` — same discipline `graphics/freeCam.ts` follows and for the
 * same reason: this is read by `src/ui/GraphicsSection.tsx` (an ordinary main-bundle screen)
 * as well as by the lazy 3D scene, and the RENDER lane asserts neither `three` nor `scene/` is
 * imported from anywhere under `graphics/`. Every angle goes through `dsin`/`dcos`/`datan2`
 * (`src/math.ts`) for the same reason `freeCam.ts`'s header gives: `scripts/smoke.ts`'s source
 * guard scans every non-`draw*`/`render*` file under `src/games` for bare engine trig.
 *
 * ── THE THREE NUMBERS ───────────────────────────────────────────────────────────────────────
 * 1. **Eye height** = the player's own height, less `EYE_VERTEX_OFFSET_IN` (the mean
 *    vertex-to-eye offset — the top of the head is not where the eyes are). APPROX; nobody's
 *    own offset is on file, so this is the anatomical average.
 * 2. **Where the eye stands** — `driverEyePoint` — reads it off `ALLIANCE_AREA`
 *    (`fieldDims.gen.ts`), the CAD-measured strip of gym floor outside the perimeter on the
 *    alliance's own side. `BB_WALL_T` (`config.ts`) is documented as an oversized PHYSICS
 *    collider, not real wall geometry, and the CAD carries no separate "outer face" figure for
 *    the wall itself — so the area's own field-side edge, which is exactly where the CAD's
 *    `ALLIANCE_AREA` strip starts, is the one line this sim has for "the wall" a driver stands
 *    behind. `STAND_BACK_IN` moves the eye that far again INTO the area, away from the field.
 * 3. **Which half of the wall** — TOP or BOTTOM, the role BIOBUZZ already tracks
 *    (`config.ts`'s `bbRoleLabel`) — shifts the eye a quarter of the area's own along-wall
 *    length off its centre, the reasoning being that a real second drive team stands beside the
 *    first rather than on top of it.
 *
 * ── WHY NO MIRRORING CODE APPEARS HERE ──────────────────────────────────────────────────────
 * `ALLIANCE_AREA` already carries red's and blue's rects separately (not one canonical rect a
 * caller mirrors), and `bbRoleLabel` already resolves TOP/BOTTOM per alliance so that the label
 * always means "world y > 0" for TOP and "world y < 0" for BOTTOM on EITHER side (worked through
 * in the header of `BB_START_POSES`, `config.ts`: a canonical `close`/`far` slot flips its own
 * label, not its own sign, when point-mirrored for red). So `driverEyePoint` only ever reads
 * `ALLIANCE_AREA[alliance]` and applies the SAME `role === 'TOP' ? +quarter : -quarter` rule for
 * both alliances — the point-symmetry is already baked into the input data, not re-derived here.
 * A consequence worth stating because a check relies on it: `driverEyePoint('red', 'TOP', h)` is
 * the FIELD-CENTRE POINT MIRROR of `driverEyePoint('blue', 'BOTTOM', h)`, and vice versa — TOP
 * mirrors to BOTTOM, not to TOP, because mirroring flips the y sign the role encodes.
 */

import type { Alliance } from '../../../types';
import { datan, datan2, dcos, dsin, dtan, hyp } from '../../../math';
import { ALLIANCE_AREA, HIVE } from '../fieldDims.gen';

/** a plain field-inches point — no `Vec2`/`Vec3` import, this file has nothing else to share
 * that shape with. */
export interface Eye3 {
  x: number;
  y: number;
  z: number;
}

// ─────────────────────────────────────────────────────────────────────────────── the setting ──

/** the "Your height" field's own clamp — the owner's own envelope (48–84 in, 4 ft to 7 ft). */
export const DRIVER_HEIGHT_MIN_IN = 48;
export const DRIVER_HEIGHT_MAX_IN = 84;

/** mean vertex (top-of-head) to eye-level offset, in — APPROX, no per-player figure exists, so
 * this is the anatomical average an unmeasured population uses. */
export const EYE_VERTEX_OFFSET_IN = 4.5;

/** eye height from a height setting already known to be in range — the one line step 2 of the
 * brief is. Callers that have not validated their input should go through
 * `coerceDriverHeightIn` first. */
export function eyeHeightFromPersonHeight(heightIn: number): number {
  return heightIn - EYE_VERTEX_OFFSET_IN;
}

/** cm ⇄ inches, for the UI's unit toggle — the STORED value is always inches. */
export const IN_PER_CM = 1 / 2.54;
export const inFromCm = (cm: number): number => cm * IN_PER_CM;
export const cmFromIn = (inches: number): number => inches / IN_PER_CM;
export const inFromFtIn = (feet: number, inches: number): number => feet * 12 + inches;
/** inverse of `inFromFtIn`, rounded to the nearest whole inch — the ft/in boxes have no decimal
 * place to show one. */
export function ftInFromIn(totalIn: number): { feet: number; inches: number } {
  const t = Math.max(0, Math.round(totalIn));
  return { feet: Math.floor(t / 12), inches: t % 12 };
}

function clampNum(v: number, lo: number, hi: number): number {
  if (Number.isNaN(v)) return lo;
  if (v === Infinity) return hi;
  if (v === -Infinity) return lo;
  return Math.min(hi, Math.max(lo, v));
}

/**
 * FIELD-BY-FIELD COERCION, the same discipline every other stored setting in this repo follows
 * (`graphics/settings.ts`'s own header). `null` is not junk here — it is the explicit "Clear"
 * affordance and the file's own "unset" state, and it passes through unclamped; anything else
 * that is not a finite number falls back to whatever was already stored (never silently to
 * `null`, which would look identical to a deliberate clear). Rounded to 0.1 in: a cm entry
 * converts to a non-integer, and the setting has no use for more precision than that.
 */
export function coerceDriverHeightIn(v: unknown, fallback: number | null): number | null {
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.round(clampNum(v, DRIVER_HEIGHT_MIN_IN, DRIVER_HEIGHT_MAX_IN) * 10) / 10;
}

// ──────────────────────────────────────────────────────────────────────── where the eye stands ──

/** the role BIOBUZZ's start editor already assigns (`config.ts`'s `bbRoleLabel`) — TOP/BOTTOM
 * only; `'-'` (no locked role) is the caller's problem, not this file's, and is refused by
 * `driverEyePoint`'s own type. */
export type DriverRole = 'TOP' | 'BOTTOM';

/** how far back, in, the eye stands from the alliance area's own field-side edge — the owner's
 * own figure ("12 in back from the wall's OUTER face"). */
export const STAND_BACK_IN = 12;

/** what fraction of the alliance area's along-wall length separates the two drive teams from
 * the area's own centre — the owner's own figure ("a quarter... each way"). */
export const ROLE_ALONG_WALL_FRACTION = 0.25;

/**
 * The eye's field-absolute position for a driver of `heightIn` standing at `alliance`'s own
 * wall in the `role` half of it.
 *
 * `ALLIANCE_AREA[alliance]` is a rectangle whose SHORT axis (in this field, always x — both
 * alliance areas run along a perimeter wall that is a constant-x plane) crosses the wall the
 * driver stands behind, and whose LONG axis runs along it. Neither axis is assumed by name:
 * the field-side edge is whichever of `x0`/`x1` sits closer to the field centre (smaller
 * absolute value), and "away from the field" is the sign that increases that distance — which
 * is what lets this function ask nothing about which alliance is on which side of the origin.
 */
export function driverEyePoint(alliance: Alliance, role: DriverRole, heightIn: number): Eye3 {
  const area = ALLIANCE_AREA[alliance];
  const fieldSideX = Math.abs(area.x0) < Math.abs(area.x1) ? area.x0 : area.x1;
  const awaySign = Math.sign(fieldSideX) || 1; // moving further from x=0 is moving away from the field
  const eyeX = fieldSideX + awaySign * STAND_BACK_IN;

  const wallLen = area.y1 - area.y0;
  const wallCentreY = (area.y0 + area.y1) / 2;
  const roleSign = role === 'TOP' ? 1 : -1;
  const eyeY = wallCentreY + roleSign * wallLen * ROLE_ALONG_WALL_FRACTION;

  const clampedHeight = clampNum(heightIn, DRIVER_HEIGHT_MIN_IN, DRIVER_HEIGHT_MAX_IN);
  const eyeZ = eyeHeightFromPersonHeight(clampedHeight);

  return { x: eyeX, y: eyeY, z: eyeZ };
}

// ─────────────────────────────────────────────────────────────────────────────────── the aim ──

/** the floor-level point the aim blends TOWARD the local robot from — field centre, at ground
 * level. Not the robot's own average height: this is a fixed reference point the field itself
 * defines, so the blend is well-defined even before a robot has spawned. */
export const AIM_FIELD_CENTRE: Eye3 = { x: 0, y: 0, z: 0 };

/** how much of the aim point is pulled toward the local robot, 0 (ignore it, look at field
 * centre) .. 1 (look straight at it). An even split reads as "watching the match with one eye
 * on my own robot", which is the driver-station behaviour this camera is standing in for —
 * there is no measured figure for it, it is a named design choice rather than a literal. */
export const AIM_ROBOT_WEIGHT = 0.5;

export interface DriverEyeAim {
  /** world-frame heading, radians, `0` = +x, CCW positive — `Math.atan2` convention (via
   * `datan2`), NOT the `viewAngle`-relative `forwardOf` this file deliberately does not import. */
  yaw: number;
  /** DOWN from horizontal, radians — positive tilts the look direction toward the floor, the
   * same sign convention `scene/renderCameras.ts`'s `FitResult.pitch` already uses. */
  pitch: number;
}

/**
 * Yaw/pitch from a fixed `eye` toward a blend of field centre and `robot` (`null` when there is
 * no local robot to blend toward — the eye still looks at field centre, which is what "no local
 * robot ⇒ today's framing" degrades to if a caller ever reaches this path without one).
 */
export function driverEyeAim(eye: Eye3, robot: Eye3 | null): DriverEyeAim {
  const target = robot
    ? {
        x: AIM_FIELD_CENTRE.x + (robot.x - AIM_FIELD_CENTRE.x) * AIM_ROBOT_WEIGHT,
        y: AIM_FIELD_CENTRE.y + (robot.y - AIM_FIELD_CENTRE.y) * AIM_ROBOT_WEIGHT,
        z: AIM_FIELD_CENTRE.z + (robot.z - AIM_FIELD_CENTRE.z) * AIM_ROBOT_WEIGHT,
      }
    : AIM_FIELD_CENTRE;
  const dx = target.x - eye.x;
  const dy = target.y - eye.y;
  const dz = target.z - eye.z;
  const yaw = datan2(dy, dx);
  const pitch = datan2(-dz, hyp(dx, dy));
  return { yaw, pitch };
}

// ──────────────────────────────────────────────────────────────────────────── the HIVE in view ──

/**
 * THE HIVE HAS TO BE IN THE PICTURE (owner, 2026-09-24: "keep in mind that the hive should be
 * fully visible ideally as a driver").
 *
 * The aim above looks at a blend of field centre and the driver's own robot, which is right for
 * a person, and from 5 ft of eye height it tilts the view far enough down that the top of the
 * HIVE (66 in, above eye level) left the frame whenever the robot was near its own wall. These are
 * the corners of the box both hives stand in: the trays' outer ends across the field, their
 * tipped ends along it, the floor to the top of a tipped tray. `driverEyeAimFit` turns the aim as
 * little as it has to to keep all eight in frame.
 */
const HIVE_HALF_X = HIVE.PIVOT_X + HIVE.CELL_W / 2;
const HIVE_HALF_Y = HIVE.CELL_FAR;
/** a tipped tray's highest point, APPROX — the same 66 `scene/renderCameras.ts` fits against */
const HIVE_TOP_Z = 66;
export const HIVE_VIEW_POINTS: readonly Eye3[] = (() => {
  const pts: Eye3[] = [];
  for (const x of [-HIVE_HALF_X, HIVE_HALF_X]) {
    for (const y of [-HIVE_HALF_Y, HIVE_HALF_Y]) {
      for (const z of [0, HIVE_TOP_Z]) pts.push({ x, y, z });
    }
  }
  return pts;
})();

/** the HORIZONTAL frame margin a fitted point must clear, as a fraction of the half-FOV. The
 * vertical fit is exact (see `driverEyeAimFit`); the horizontal one reads bearings, which drift
 * off the projection for points far above or below the centre line, and this covers that. */
const FIT_MARGIN_H = 0.12;
/** the vertical margin — exact fit, so only the "a hair inside the edge" the solved camera uses */
const FIT_MARGIN_V = 0.04;

/**
 * Is every point inside the frame of a camera at `eye` looking along (`yaw`, `pitch`) — pitch
 * DOWN from horizontal — with vertical FOV `vFov` (radians) on a screen of `aspect`? The same
 * basis `scene/renderCameras.ts` builds with `lookAt` (world up is +z), projected exactly.
 */
export function pointsInFrame(
  eye: Eye3,
  yaw: number,
  pitch: number,
  vFov: number,
  aspect: number,
  points: readonly Eye3[],
  margin = 0,
): boolean {
  const cy = dcos(yaw);
  const sy = dsin(yaw);
  const cp = dcos(pitch);
  const sp = dsin(pitch);
  const f = { x: cy * cp, y: sy * cp, z: -sp };
  const r = { x: sy, y: -cy, z: 0 }; // forward × up
  const u = { x: cy * sp, y: sy * sp, z: cp }; // right × forward
  const tv = dtan(vFov / 2) * (1 - margin);
  const th = dtan(vFov / 2) * aspect * (1 - margin);
  for (const p of points) {
    const dx = p.x - eye.x;
    const dy = p.y - eye.y;
    const dz = p.z - eye.z;
    const zc = dx * f.x + dy * f.y + dz * f.z;
    if (zc <= 1e-6) return false;
    if (Math.abs((dx * r.x + dy * r.y) / zc) > th) return false;
    if (Math.abs((dx * u.x + dy * u.y + dz * u.z) / zc) > tv) return false;
  }
  return true;
}

/**
 * A FRAME THAT HOLDS EVERY POINT, from a fixed eye: the yaw and pitch that centre the set, and
 * the vertical FOV it needs there (radians, before any cap).
 *
 *  1. YAW centres the points' bearings.
 *  2. PITCH, EXACT: with the yaw fixed, a point at bearing offset `a` and elevation `e` projects
 *     at `β = atan(tan e / cos a)` in the yawed frame, and pitching the camera shifts every `β`
 *     by the same angle (the solved driver camera's own derivation, `scene/renderCameras.ts`
 *     `solveFit`), so centring the `β` span is the pitch and the span is the vertical need.
 *  3. The horizontal need reads bearings, which drift off the projection for points far above or
 *     below the centre line; `FIT_MARGIN_H` covers that.
 */
export function frameAllFrom(eye: Eye3, points: readonly Eye3[], aspect: number): DriverEyeFit {
  const toward = datan2(-eye.y, -eye.x); // field centre: the reference the bearings are read from
  const rel: { a: number; e: number }[] = [];
  let aLo = Infinity;
  let aHi = -Infinity;
  for (const p of points) {
    const dx = p.x - eye.x;
    const dy = p.y - eye.y;
    let a = datan2(dy, dx) - toward;
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    rel.push({ a, e: datan2(p.z - eye.z, hyp(dx, dy)) });
    aLo = Math.min(aLo, a);
    aHi = Math.max(aHi, a);
  }
  const mid = (aLo + aHi) / 2;
  const hHalfNeed = Math.min(1.55, (aHi - aLo) / 2 / (1 - FIT_MARGIN_H));
  const vForH = 2 * datan(dtan(hHalfNeed) / aspect);
  let bLo = Infinity;
  let bHi = -Infinity;
  for (const q of rel) {
    const c = dcos(q.a - mid);
    const b = c > 1e-6 ? datan(dtan(q.e) / c) : q.e > 0 ? Math.PI / 2 : -Math.PI / 2;
    bLo = Math.min(bLo, b);
    bHi = Math.max(bHi, b);
  }
  const vForV = (bHi - bLo) / (1 - FIT_MARGIN_V);
  return { yaw: toward + mid, pitch: -(bLo + bHi) / 2, vFov: Math.max(vForH, vForV) };
}

export interface DriverEyeFit extends DriverEyeAim {
  /** vertical FOV, radians */
  vFov: number;
}

/** the whole field — floor and wall-top corners — and both hives: what the driver view holds */
export function fieldViewPoints(halfX: number, halfY: number, wallH: number): Eye3[] {
  const pts: Eye3[] = [...HIVE_VIEW_POINTS];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      pts.push({ x: sx * halfX, y: sy * halfY, z: 0 });
      pts.push({ x: sx * halfX, y: sy * halfY, z: wallH });
    }
  }
  return pts;
}

export interface DriverEyeFrame extends DriverEyeFit {
  eye: Eye3;
  /** how much further back than `STAND_BACK_IN` the eye had to stand, in (0 when it fits) */
  extraBack: number;
}

/**
 * THE HEIGHT-ACCURATE DRIVER VIEW HOLDS THE WHOLE FIELD, ALWAYS (owner, 2026-09-24: "the whole
 * field should be visible in driver view at all times, because in real life, you can look up and
 * down or away from the robot to 'look ahead'").
 *
 * The eye is the player's own height at their role's place on the alliance wall
 * (`driverEyePoint`), and the lens is their FOV setting (`vFovCap`, vertical for this screen).
 * The field has to fit in `1 - EYE_TURN_SLACK` of the lens, not all of it: the rest is the room
 * `driverEyeFollow` turns the view in toward the robot without losing a corner (owner, same day:
 * "Not fixed driver view tho. Maybe have both"). From `STAND_BACK_IN` behind the wall the near
 * corners sit nearly beside the eye, which no human-width lens holds, so the eye steps straight
 * back from the field by the least that fits (bisection: further back only ever needs less).
 * Height and role are kept exactly.
 */
export function fitDriverEyeFrame(
  alliance: Alliance,
  role: DriverRole,
  heightIn: number,
  points: readonly Eye3[],
  aspect: number,
  vFovCap: number,
): DriverEyeFrame {
  const at = driverEyePoint(alliance, role, heightIn);
  const away = Math.sign(at.x) || 1;
  const frameAt = (back: number): DriverEyeFrame => {
    const eye = { x: at.x + away * back, y: at.y, z: at.z };
    return { ...frameAllFrom(eye, points, aspect), eye, extraBack: back };
  };
  const fitIn = vFovCap * (1 - EYE_TURN_SLACK);
  let f = frameAt(0);
  if (f.vFov > fitIn) {
    let lo = 0;
    let hi = 480;
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2;
      if (frameAt(m).vFov <= fitIn) hi = m;
      else lo = m;
    }
    f = frameAt(hi);
  }
  // the player's lens (it is their setting); wider only if the search hit its own ceiling
  return { ...f, vFov: Math.max(f.vFov, vFovCap) };
}

/** the share of the lens left over for turning toward the robot — see `fitDriverEyeFrame` */
export const EYE_TURN_SLACK = 0.2;

/**
 * WHERE THE DRIVER VIEW LOOKS THIS FRAME: toward the robot (`driverEyeAim`'s blend of field
 * centre and robot), CLAMPED into the aims that keep every `points` entry in `frame`'s lens.
 *
 * ⚠️ **A CLAMP, NOT A TEST.** Every step is continuous in the robot's position, so the view slides
 * to the edge of its room and stops there. The first version returned one aim when a projection
 * test passed and a stepped one when it failed, and those switches were the owner's "extremely
 * choppy, especially coming off the wall". The renderer also eases toward this, frame to frame.
 *
 *  1. YAW: the points' bearings, and the centres that keep them inside the horizontal half-lens
 *     (`FIT_MARGIN_H` off it, for the drift `frameAllFrom` notes).
 *  2. PITCH, exact: with that yaw, each point's `β = atan(tan e / cos a)`, and the elevations that
 *     keep every `β` inside the vertical half-lens.
 * A range that is empty (a lens too narrow even to centre on) is its midpoint, the frame's own
 * centred aim, which is where the clamp was heading anyway.
 */
export function driverEyeFollow(
  frame: DriverEyeFrame,
  points: readonly Eye3[],
  robot: Eye3 | null,
  aspect: number,
): DriverEyeAim {
  const eye = frame.eye;
  const base = driverEyeAim(eye, robot);
  const rel: { a: number; e: number }[] = [];
  let aLo = Infinity;
  let aHi = -Infinity;
  for (const p of points) {
    const dx = p.x - eye.x;
    const dy = p.y - eye.y;
    let a = datan2(dy, dx) - base.yaw;
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    rel.push({ a, e: datan2(p.z - eye.z, hyp(dx, dy)) });
    aLo = Math.min(aLo, a);
    aHi = Math.max(aHi, a);
  }
  const hHalf = datan(dtan(frame.vFov / 2) * aspect) * (1 - FIT_MARGIN_H);
  const dYaw = clampOrCentre(0, aHi - hHalf, aLo + hHalf);
  let bLo = Infinity;
  let bHi = -Infinity;
  for (const q of rel) {
    const c = dcos(q.a - dYaw);
    const b = c > 1e-6 ? datan(dtan(q.e) / c) : q.e > 0 ? Math.PI / 2 : -Math.PI / 2;
    bLo = Math.min(bLo, b);
    bHi = Math.max(bHi, b);
  }
  const vHalf = (frame.vFov / 2) * (1 - FIT_MARGIN_V);
  // the camera's own elevation is -pitch
  const el = clampOrCentre(-base.pitch, bHi - vHalf, bLo + vHalf);
  return { yaw: base.yaw + dYaw, pitch: -el };
}

/** `v` clamped into [lo, hi]; an empty range (lo > hi) is its midpoint — continuous either way */
function clampOrCentre(v: number, lo: number, hi: number): number {
  return lo <= hi ? Math.min(hi, Math.max(lo, v)) : (lo + hi) / 2;
}

