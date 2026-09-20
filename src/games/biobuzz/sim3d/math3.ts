import { datan2, dcos, dsin, hyp } from '../../../math';

/**
 * BIOBUZZ 3D PHYSICS -- vec3 / quaternion helpers (Day 1, `docs/biobuzz/plan-3d.md` section 3).
 *
 * Every trig call here goes through the shared deterministic wrappers (`dsin`/`dcos`/`datan2`
 * from `src/math.ts`), never `Math.sin`/`Math.cos`/`Math.atan2` -- `scripts/smoke.ts`'s source
 * guard scans this whole directory (files not named `render*`) for exactly that, and the reason
 * is the same one the 2D sim has always had: an engine-defined transcendental is not required
 * to be correctly-rounded, so two peers (or a replay and the run that produced it) can compute
 * different bits from the same inputs. Rapier3d's OWN internals are the deterministic build's
 * job to pin, not this file's -- this file is the bridge between plain numbers/radians the sim
 * already speaks and the {x,y,z}/{x,y,z,w} shapes Rapier's API wants.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const QUAT_IDENTITY: Readonly<Quat> = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

/**
 * A yaw-only rotation (about the world Z axis) -- the pose every BIOBUZZ robot body carries,
 * since pitch/roll are locked for now (`enabledRotations(false, false, true)`, plan section
 * 3.3). `yaw` is in RADIANS, world frame, the same convention `RobotState.heading` uses.
 */
export function yawQuat(yaw: number): Quat {
  const half = yaw / 2;
  return { x: 0, y: 0, z: dsin(half), w: dcos(half) };
}

/**
 * The yaw (radians) a quaternion encodes, assuming it is a PURE Z-axis rotation (x = y = 0) --
 * true of every robot body here, since nothing else ever writes to a robot's rotation. For a
 * general quaternion this would need the full atan2(2(wz+xy), 1-2(y^2+z^2)) form; that
 * generality is not needed while pitch/roll stay locked, and adding it now would be untested
 * dead code for an axis nothing produces yet (see `RobotState.q?` in the plan for when that
 * changes).
 */
export function yawOfQuat(q: Quat): number {
  return 2 * datan2(q.z, q.w);
}

/** rotate a 2D vector (robot/world-plane) by `yaw` radians -- the 3D twin of `src/math.ts`'s
 * `rot()`, kept here rather than imported so every 3D file reaches for the same name whether
 * the vector in hand is a `Vec2` or the xy half of a `Vec3`. */
export function rotateByYaw(v: { x: number; y: number }, yaw: number): { x: number; y: number } {
  const c = dcos(yaw);
  const s = dsin(yaw);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/**
 * A rotation of `theta` radians about the world X axis -- the hive tray's tilt (plan section
 * 3.6's revolute-joint axis; Day 1's kinematic tray turns about the same axis). Kept distinct
 * from `yawQuat` rather than a generalized "quat about axis" because a tray tilt and a robot
 * yaw are never the same call site and a shared generic would need to justify its extra
 * parameter at both of them.
 */
export function tiltQuatX(theta: number): Quat {
  const half = theta / 2;
  return { x: dsin(half), y: 0, z: 0, w: dcos(half) };
}

/**
 * Rotate a 2-vector `(a, b)` by `theta` radians -- the plain rotation matrix `[[cos,-sin],
 * [sin,cos]]`, used for the hive tray's local <-> world mapping in the plane perpendicular to
 * its hinge axis (world X). `bodies.ts` documents the tray's own (v, w) convention: v = signed
 * distance from the pivot along the bar, w = height above the tray's own floor, both living in
 * the world (y, z) plane once rotated by the tray's current tilt.
 *
 * ONE FORMULA FOR BOTH DIRECTIONS: LOCAL (v, w) -> WORLD (y, z) is `rotate2(v, w, theta)`;
 * WORLD (y, z) -> LOCAL (v, w) is `rotate2(y, z, -theta)` -- a rotation matrix's inverse is its
 * transpose, which for this 2x2 form is exactly the same matrix built from `-theta` (odd/even
 * symmetry of sin/cos), so there is no second, easily-transcribed-wrong formula to keep in step
 * with this one.
 */
export function rotate2(a: number, b: number, theta: number): { a: number; b: number } {
  const c = dcos(theta);
  const s = dsin(theta);
  return { a: a * c - b * s, b: a * s + b * c };
}

/**
 * A rotation of `theta` radians about the world/body Y axis -- `tiltQuatX`'s twin for the one
 * axis neither it nor `yawQuat` covers. The one caller is `bodies.ts`'s ramp rails: a rail is
 * built in its own mouth-local frame (local +x outward, +z up) tilted about local Y, and that
 * local rotation is composed with the mouth's own yaw (`quatMul(yawQuat(edge), pitchQuatY(a))`)
 * to land it in the robot frame -- see `chassis3dReachShapes`'s own header for the derivation.
 */
export function pitchQuatY(theta: number): Quat {
  const half = theta / 2;
  return { x: 0, y: dsin(half), z: 0, w: dcos(half) };
}

/**
 * Hamilton product `a ⊗ b` -- the ACTIVE-rotation composition "apply `b`'s rotation first, then
 * `a`'s" (the convention `v' = q ⊗ v ⊗ q⁻¹` uses). The one place two of this file's quaternions
 * need to compose into a single collider rotation: `bodies.ts`'s tilted ramp rails, where a
 * mount edge's yaw and a local pitch about that mount's own lateral axis are computed once, here,
 * so `addChassis3dColliders` and `predict.ts`'s chassis builder can both apply the result blindly
 * with `ColliderDesc.setRotation` and never have to know which world axis a mouth's own "lateral"
 * direction is.
 */
export function quatMul(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/** 3D magnitude via sqrt(x^2+y^2+z^2) -- `Math.sqrt` is IEEE-correctly-rounded (unlike
 * `Math.hypot`), so this stays as safe for lockstep as the 2D `hyp` it is modelled on. */
export function hyp3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

/** the planar (xy) magnitude of a velocity/offset -- reuses the shared 2D `hyp` so there is
 * exactly one implementation of "magnitude of two numbers" in the sim. */
export function hypXY(x: number, y: number): number {
  return hyp(x, y);
}

/** round to 1e-4 (the readback precision every dynamic body's JSON is written at, plan section
 * 3.1 step 6) -- ONE helper so every writer rounds the same way and a diff between two
 * "identical" ticks is never a rounding artifact of the call site. */
export function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
