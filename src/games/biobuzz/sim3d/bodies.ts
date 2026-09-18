import type { Rapier3d } from './engine';
import type { Alliance, RobotSpec } from '../../../types';
import { dcos, dsin } from '../../../math';
import {
  BB3_ELEMENT_FRICTION,
  BB3_ELEMENT_MASS,
  BB3_ELEMENT_RESTITUTION,
  BB3_ELEMENT_ROLL_DAMP,
  BB3_FIELD_COLLIDERS,
  BB3_HIVE_ARM,
  BB3_HIVE_CELL,
  BB3_HIVE_CELL_WALL,
  BB3_HIVE_PIVOT_Z,
  BB3_NECTAR_MASS_RATIO,
  BB3_WALL_H,
  BB_FLOWER_TOP_Z,
  BB_HALF_X,
  BB_HALF_Y,
  BB_HIVE_TILT_DEG,
  BB_HIVE_X,
  BB_WALL_T,
} from '../config';
import { biobuzzColliders, BB_WALL_COUNT } from '../colliders';
import { cadCellBox, cadWallExtents, fieldColliders3d } from './fieldColliders';
import { rotate2, tiltQuatX, yawQuat } from './math3';

/**
 * TEST-ONLY OVERRIDE for `BB3_FIELD_COLLIDERS`, read by every CAD-vs-fallback branch in this
 * file through `useFieldColliders()` below instead of the raw constant. `null` (the default)
 * means "use the constant, as production does"; the SIM3D smoke lane's twelve-probe agreement
 * check (`docs/biobuzz/plan-3d.md` §9) sets it to `false` to build a second, fallback-only
 * engine on the SAME world for comparison, then resets it to `null` — never left set, so a
 * forgotten reset cannot leak into a later check or into production (nothing outside a test
 * calls the setter at all).
 */
let fieldCollidersOverride: boolean | null = null;

/** test-only: force every CAD-vs-fallback branch below to `value` regardless of
 * `BB3_FIELD_COLLIDERS`, or pass `null` to restore the constant. */
export function __setFieldCollidersOverrideForTests(value: boolean | null): void {
  fieldCollidersOverride = value;
}

function useFieldColliders(): boolean {
  return fieldCollidersOverride ?? BB3_FIELD_COLLIDERS;
}

/**
 * BIOBUZZ 3D PHYSICS -- body and collider specs (Day 1, docs/biobuzz/plan-3d.md section 3).
 *
 * THE Z / HEIGHT CONVENTION, ONE PLACE.
 * World/Artifact numbers are all in the 2D pipeline's own convention, which this port keeps
 * rather than inventing a second one: Artifact.z is the height of the ball's BOTTOM above the
 * tile plane (z = 0 means resting on the floor), matching how play.ts's flight integrator and
 * spawn.ts's staged elements already use it (a resting ground ball is always z = 0; a flown
 * one lands the instant z <= 0). So a Rapier BODY, whose translation is its CENTRE, sits at
 * z_body = b.z + r on the way IN (sync), and readback reverses it: b.z = round4(centre.z - r).
 * RobotState.z is the SAME convention one level up -- the height of the chassis BOTTOM, so a
 * robot driving on the tiles reads z = 0 and the body's centre sits at z + heightIn/2.
 *
 * THE HIVE TRAY'S LOCAL (v, w) FRAME.
 * Each hive is ONE kinematic body, translated once at its pivot (pivotX(a), 0,
 * BB3_HIVE_PIVOT_Z) and never moved again -- only its ROTATION (about the body's local X axis,
 * which stays aligned with world X since the body's own yaw/roll are never touched) changes,
 * via setNextKinematicRotation. Every collider hung off that body is placed in the body's OWN
 * local frame, which Rapier then carries into world space by the body's translation + rotation
 * automatically -- so nothing in this file has to apply rotate2 to PLACE a tray collider; that
 * helper is for the one thing that is NOT automatic, testing a WORLD-SPACE point (an element's
 * position) against a LOCAL-SPACE box (derive.ts's cell-membership test), which has to undo the
 * rotation by hand because the point does not live on the tray body.
 *
 * The local axes: X is world X unchanged (the hinge axis; a cell's WIDTH lives here). Y is v,
 * signed distance from the pivot ALONG the bar -- a cell at v > 0 is north, v < 0 is south,
 * matching BbCellSide. Z is w, height above the tray's OWN floor (the cell interior spans
 * w in [0, BB3_HIVE_CELL.h]) -- so at REST (world X unrotated), a local point (x, v, w) maps to
 * world (pivotX + x, v*cos(theta) - w*sin(theta), BB3_HIVE_PIVOT_Z + v*sin(theta) +
 * w*cos(theta)), exactly rotate2(v, w, theta) for the last two.
 *
 * THE OPENING VS. THE CLEARANCE, TWO FEATURES, ONE RESIDUAL -- RESOLVED BY THE CAD (§8).
 * The Day 1 analytic CELL BOX (`hiveCellLocalBox`'s fallback branch, still here for when
 * `BB3_FIELD_COLLIDERS` is off or a part is missing) was calibrated to the LAUNCH OPENING: at
 * v = arm + d/2 (its open outer face) and the REST tilt (30 degrees), it spans world z =
 * [55.17, 65.60] against the manual's BB_HIVE_OPEN_Z [53.5, 65.6] -- exact at the top, +1.67in
 * at the bottom. The SAME box, mirrored to the DOWN side, spans [32.73, 43.16] -- nowhere near
 * BB_HIVE_BOTTOM_Z 25.5, because a rigid bar whose up-side opening matches the manual does not
 * also put its down-side floor where the manual's ROBOT-CLEARANCE figure says, on this box
 * geometry. The Day 1 fix was a SEPARATE, EXPLICIT clearance bracket (`HIVE_BRACKET_W` below),
 * added per cell at a w solved to read exactly 25.5in when that cell is down -- flagged APPROX
 * and reported as a residual, because a real CAD assembly delivers both figures from ONE shape.
 * With `BB3_FIELD_COLLIDERS` on, `cadCellBox`/`cadTrayHulls` (`fieldColliders.ts`) ARE that one
 * shape -- the CAD tray's own floor/back/side/ceiling hulls, un-rotated into this same (x, v, w)
 * frame -- so the bracket is dropped outright (see `buildHiveTray3d`) and whatever the CAD
 * actually gives for the down-cell clearance is what the sim uses; the smoke lane's measurements
 * check (`docs/biobuzz/plan-3d.md` §9/§10) prints that figure against 25.5 rather than assuming
 * agreement.
 */

// ---- STATICS -----------------------------------------------------------------
// floor (always analytic), walls (analytic cuboids, inner face + height from the CAD field when
// `BB3_FIELD_COLLIDERS` is on), and everything else (hive frame legs, flower supports) as CAD
// trimesh statics -- falling back to the 2D field's own frame-bar/flower-foot boxes
// (`biobuzzColliders`, extruded) when the CAD set is off or empty.

/** the 2D field's static count breakdown -- `biobuzzColliders.statics` is built as
 * `[...walls, ...frameBars, ...flowerFeet]` (see `colliders.ts`), and `BB_WALL_COUNT` (4) is
 * exported from there; the frame count (2) is not, so it is named here once rather than as a
 * bare `2` at the slice site. Only used by the fallback branch below. */
const FRAME_COUNT = 2;

/** floor half-thickness (in) -- deliberately thick for the same reason the 2D perimeter walls
 * are: a thin static under a fast-falling sphere can tunnel through in one 1/60s step without
 * CCD, and the floor is the one static every dynamic body rests against every tick. */
const FLOOR_HALF_T = 10;

/** the CAD field's static names for the FLOOR and the four WALLS -- built as separate, thick
 * analytic shapes below (a plane and four cuboids), never as the CAD's own thin trimesh: a
 * fast-falling sphere or a robot slamming a wall can tunnel a single 1/60s step through a
 * thin static without CCD, which is exactly why `FLOOR_HALF_T`/`BB_WALL_T` are oversized in the
 * first place -- the CAD wall trimesh is ~1in thick, matching the real structure, which is too
 * thin for the same reason. */
const FLOOR_AND_WALL_STATICS = new Set(['tiles', 'wall_left', 'wall_right', 'wall_rear', 'wall_audience']);

/**
 * ⚠️ EVERY "hive_<alliance>_frame_*" CAD STATIC IS EXCLUDED FROM THE TRIMESH LOOP, PERMANENTLY,
 * NOT BEHIND `BB3_FIELD_COLLIDERS`.
 *
 * `scripts/field-cad/convert.py`'s static-collider builder makes every entry (`hull_bucket_
 * static`, this file's own header) from `bbox_corners_sim(inst)` -- an AXIS-ALIGNED BOUNDING BOX
 * of the part in the FINAL SIM FRAME, not its true tessellated (and, for a leaning strut, DIAGONAL)
 * surface. That is a fine approximation for a genuinely box-shaped, axis-aligned part (a flower
 * bracket) but a bad one for anything angled: `hive_red_frame_a_frame_leg`'s own AABB measures
 * x ∈ [-24.28, -12.24], z ∈ [0.22, 41.40] -- floor to nearly the pivot, and reaching almost to
 * the hive's own centreline -- because the true leg is a thin diagonal beam whose AABB, being
 * axis-aligned, has to cover the full box the beam sweeps through end to end. Built as a SOLID
 * collider, that turns "a robot drives under the hive" (`colliders.ts`'s own header: "the
 * triangles ... lean inward and upward out of a robot's way ... a robot between the bars is
 * under the hives and free to move") into "a robot cannot enter the space under the hive at
 * all" -- found by measurement: the drive-feel parity check's robot, driven from the field
 * centre, stopped dead at x ≈ 1.75, its extended intake footprint still 10+ inches short of the
 * pivot.
 *
 * `hive_<alliance>_frame_upright` has the SAME issue one level up, and it is NOT harmless just
 * because its own z-range (checked: 38.80–59.88) sits above `BB3_HEIGHT_MAX` (29) -- that
 * reasoning only rules out a ROBOT hitting it. The hive's own CELLS sit in that same z-band
 * (the up-cell's opening is `BB_HIVE_OPEN_Z` 53.5–65.6), because the upright is precisely the
 * strut carrying the frame up to the pivot the cells hang from -- so its AABB (a near-full-size
 * box between the base and the pivot, covering most of the x/y/z the tray itself occupies)
 * physically collides with anything resting in the cell. Found the same way: the staged
 * up-cell nectar `createBiobuzzWorld` places on EVERY match start landed inside this box and
 * was ejected at a solver-resolved ~700+ in/s on the very first tick. `damper`/`damper_holder`/
 * `pivot_bracket` are smaller versions of the same class of part (off-axis hardware bundled into
 * one AABB) sitting in the same neighbourhood, so the whole `frame_*` family is excluded here,
 * not case by case -- this port's floor-level and cell geometry come from the LEGACY frame-bar
 * box (unconditional, below) and the thin-walled cells (`buildHiveTray3d`) respectively; nothing
 * currently needs the frame's own upper hardware modelled as a physics solid.
 */
const CAD_STATIC_EXCLUDE_PREFIX = /^hive_(red|blue)_frame_/;
const CAD_STATIC_EXCLUDE = new Set(FLOOR_AND_WALL_STATICS);

/**
 * Build every BIOBUZZ static collider into `world3d`: the floor, the four perimeter walls, the
 * two hive frame legs, and the four flower supports -- named order, fixed every call
 * (determinism: plan section 2.1's "statics (named, fixed order)").
 */
export function buildStatics3d(
  RAPIER: Rapier3d,
  world3d: InstanceType<Rapier3d['World']>,
  wallFriction: number,
): void {
  const ground = world3d.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, -FLOOR_HALF_T));
  // FRICTION 0, DELIBERATELY. The shared `updateRobot` wrench is already the traction-limited,
  // motor-modelled FINAL force (`docs/area/physics.md`) -- the 2D solve has no floor at all, so
  // that force is the whole story there. This chassis DOES rest on a real floor for vertical
  // support, and a nonzero floor friction would be a SECOND, uncalibrated resistive term on
  // top of the drivetrain model's own answer -- measured, at the old 0.6 it visibly slowed the
  // drive-feel parity check below the 5% band. Elements still get real floor friction: their
  // collider (`engine.ts`) sets a MAX combine rule, so a 0-friction floor does not touch them.
  // MIN COMBINE RULE: with the floor's own friction already 0, MIN(anything, 0) is always 0
  // for a pair that does not itself specify a stronger rule -- exactly the robot's case (its
  // collider sets no rule, i.e. Average, which MIN beats). An element's own collider sets MAX
  // (`engine.ts`), and MAX outranks MIN in Rapier's own precedence, so an element resting on
  // this same floor still reads its own friction, not this 0.
  world3d.createCollider(
    RAPIER.ColliderDesc.cuboid(1000, 1000, FLOOR_HALF_T)
      .setFriction(0)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setRestitution(0),
    ground,
  );

  // ---- WALLS: four thick cuboids, inner face + height from the CAD field's own wall trimesh
  // vertices (`cadWallExtents`, more precise than `field-measurements.json`'s centroid-based
  // `walls_extent_in` -- see that function's own comment), constants when the CAD set is off or
  // any of the four is missing.
  const cadWalls = useFieldColliders() ? cadWallExtents() : null;
  const wallHeight = cadWalls?.height ?? BB3_WALL_H;
  const wallHalf = wallHeight / 2;
  const wallCentreZ = (cadWalls?.z0 ?? 0) + wallHalf;
  const span = 2 * Math.max(BB_HALF_X, BB_HALF_Y) + 4 * BB_WALL_T; // long enough the four overlap at the corners
  const faces: readonly { readonly inner: number; readonly axis: 'x' | 'y'; readonly sign: 1 | -1 }[] = [
    { inner: cadWalls?.right ?? BB_HALF_X, axis: 'x', sign: 1 },
    { inner: cadWalls?.left ?? -BB_HALF_X, axis: 'x', sign: -1 },
    { inner: cadWalls?.rear ?? BB_HALF_Y, axis: 'y', sign: 1 },
    { inner: cadWalls?.audience ?? -BB_HALF_Y, axis: 'y', sign: -1 },
  ];
  for (const f of faces) {
    const centre = f.inner + f.sign * BB_WALL_T;
    const hx = f.axis === 'x' ? BB_WALL_T : span / 2;
    const hy = f.axis === 'x' ? span / 2 : BB_WALL_T;
    const tx = f.axis === 'x' ? centre : 0;
    const ty = f.axis === 'x' ? 0 : centre;
    const body = world3d.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(tx, ty, wallCentreZ));
    // WALL FRICTION MATCHES THE 2D SOLVE'S -- see the historical note this replaced: a
    // hardcoded 0.5 here undershot `PHYS_WALL_FRICTION` (0.65) enough to fail the drive-feel
    // parity checks on a wall-flush start (measured ratio 2.317 before this fix landed).
    world3d.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, wallHalf).setFriction(wallFriction).setRestitution(0),
      body,
    );
  }

  // ---- THE HIVE FRAME'S GROUND-LEVEL SUPPORT -- always the 2D field's own thin foot-bar box
  // (`colliders.ts`), never the CAD "a_frame_leg" static -- see `CAD_STATIC_EXCLUDE`'s comment
  // for why that CAD entry would wrongly seal off the space under the hive. Unconditional (not
  // gated by `BB3_FIELD_COLLIDERS`): this is the one static this port never takes from the CAD.
  const frameBars = biobuzzColliders.statics.slice(BB_WALL_COUNT, BB_WALL_COUNT + FRAME_COUNT);
  for (const s of frameBars) {
    const half = BB3_HIVE_PIVOT_Z / 2; // floor to the pivot -- see the Day 1 comment this replaced
    const body = world3d.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(s.tx, s.ty, half).setRotation(yawQuat(s.rot)),
    );
    world3d.createCollider(
      RAPIER.ColliderDesc.cuboid(s.hx, s.hy, half).setFriction(wallFriction).setRestitution(0),
      body,
    );
  }

  // ---- EVERYTHING ELSE: the flower solid supports (brackets/pipes/backstops/under-brackets),
  // as CAD trimesh statics (one fixed body + collider per named part, in the collider file's own
  // array order -- determinism). The hive's own upper frame hardware is excluded outright, not
  // just gated -- see `CAD_STATIC_EXCLUDE_PREFIX`'s comment. Falls back to the 2D field's own
  // flower-foot boxes when the CAD set is off or carries nothing beyond the floor/walls/legs (an
  // empty or absent collider file).
  const cadRest = useFieldColliders()
    ? fieldColliders3d().statics.filter((s) => !CAD_STATIC_EXCLUDE.has(s.name) && !CAD_STATIC_EXCLUDE_PREFIX.test(s.name))
    : [];
  if (cadRest.length > 0) {
    for (const s of cadRest) {
      const body = world3d.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      const desc = RAPIER.ColliderDesc.trimesh(
        new Float32Array(s.vertices),
        new Uint32Array(s.indices),
        RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
      );
      world3d.createCollider(desc.setFriction(wallFriction).setRestitution(0), body);
    }
  } else {
    // legacy Day 1 fallback: the 2D field's own flower feet (`colliders.ts`), extruded to a flat
    // height (the frame bars are already built above, unconditionally).
    const flowerFeet = biobuzzColliders.statics.slice(BB_WALL_COUNT + FRAME_COUNT);
    for (const s of flowerFeet) {
      const half = BB_FLOWER_TOP_Z / 2; // floor to the ring's top -- the MEASURED rectangle
      const body = world3d.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(s.tx, s.ty, half).setRotation(yawQuat(s.rot)),
      );
      world3d.createCollider(
        RAPIER.ColliderDesc.cuboid(s.hx, s.hy, half).setFriction(wallFriction).setRestitution(0),
        body,
      );
    }
  }
}

// ---- HIVE TRAY -----------------------------------------------------------------
// the Day 1 KINEMATIC fallback (`BB3_HIVE_DYNAMIC = false`). One body per hive, translated
// once at the pivot; its ROTATION is set every tick from `hive3d.ts`'s `hiveTiltAngle`.
// Colliders are placed in the body's own LOCAL (x, v, w) frame -- see the file header -- so
// Rapier's own transform carries them into world space; nothing here rotates by hand.

export function hivePivotX(alliance: 'red' | 'blue'): number {
  return alliance === 'red' ? -BB_HIVE_X : BB_HIVE_X;
}

/** an axis-aligned box in the tray's own LOCAL (v, w) plane (x is a separate half-extent,
 * since the box is centred on x = 0 for both cells). */
export interface HiveLocalBox {
  xHalf: number;
  vMin: number;
  vMax: number;
  wMin: number;
  wMax: number;
  /** which tilt angle this box's numbers are true AT — 0 for the theta-independent algebraic
   * fallback, `cadCaptureTheta(alliance)` for a CAD box (see `fieldColliders.ts`'s own comment
   * on why the CAD hulls are not pre-rotated). `derive.ts`'s `insideCell` reads this. */
  refTheta: number;
}

/**
 * The CELL interior -- the launch opening AND the physical container a resting element sits in,
 * ONE box for both (see the file header's residual note, now resolved by the CAD when
 * `BB3_FIELD_COLLIDERS` is on). `sideSign` is `1` (north, `v > 0`) or `-1` (south); `alliance`
 * picks whose tray (the CAD hulls are alliance-specific real geometry, not assumed symmetric).
 *
 * Prefers `cadCellBox` (the CAD tray's own floor/back/side/ceiling hulls, AS CAPTURED --
 * `fieldColliders.ts`); falls back to the Day 1 algebraic box, calibrated to the manual's
 * launch-opening figure alone, when the CAD set is off or has no hulls for this cell.
 */
export function hiveCellLocalBox(sideSign: 1 | -1, alliance: Alliance): HiveLocalBox {
  if (useFieldColliders()) {
    const cad = cadCellBox(alliance, sideSign);
    if (cad) return cad;
  }
  const half = BB3_HIVE_CELL.d / 2;
  const centre = sideSign * BB3_HIVE_ARM;
  return {
    xHalf: BB3_HIVE_CELL.w / 2,
    vMin: Math.min(centre - half, centre + half),
    vMax: Math.max(centre - half, centre + half),
    wMin: 0,
    wMax: BB3_HIVE_CELL.h,
    refTheta: 0,
  };
}

/**
 * The DOWN-CLEARANCE bracket for one cell -- a local point `(v, w)` calibrated so that, WHEN
 * THIS CELL IS DOWN (its own rest tilt), the bracket's world z is exactly `BB_HIVE_BOTTOM_Z`
 * (25.5). Solved once, algebraically, from the rest-tilt geometry (see the file header): at
 * `theta = BB_HIVE_TILT_DEG` and `v = -BB3_HIVE_ARM` (the DOWN side's own centre, sign already
 * folded in), `BB3_HIVE_PIVOT_Z + v*sin(theta) + w*cos(theta) = BB_HIVE_BOTTOM_Z` solves for
 * `w`. The bracket sits at `v = sideSign * BB3_HIVE_ARM` (its own cell's centre) and this SAME
 * `w`, because both cells are mirror images of one another about the pivot.
 */
export const HIVE_BRACKET_W = (() => {
  const rad = (BB_HIVE_TILT_DEG * Math.PI) / 180;
  // solved for the DOWN side (v = -ARM): PIVOT_Z - ARM*sin(rad) + w*cos(rad) = BOTTOM_Z
  const BOTTOM_Z = 25.5; // manual, Fig 9-10 -- see `BB_HIVE_BOTTOM_Z` in config.ts
  // dsin/dcos, NOT Math.sin/cos -- this file is scanned by the sim source guard (deterministic
  // trig everywhere the sim can reach), and this constant is computed once at module load, on
  // every peer, so it has to be bit-identical everywhere too.
  const sinT = dsin(rad);
  const cosT = dcos(rad);
  return (BOTTOM_Z - BB3_HIVE_PIVOT_Z + BB3_HIVE_ARM * sinT) / cosT;
})();

/** thickness of the clearance bracket (in) -- APPROX, thin enough not to eat into the up-side
 * opening's own clearance test. */
export const HIVE_BRACKET_T = 1.5;

/**
 * Build one hive's tray body and its colliders (two cells of thin walls: floor, back, two
 * sides). Returns the body so `engine.ts` can key it and drive its rotation every tick.
 *
 * THE SAME THIN-WALLED BOX SHAPE FOR BOTH THE CAD AND THE FALLBACK PATH -- `hiveCellLocalBox`
 * (`box`, below) already resolves to the CAD's own measured dimensions when `BB3_FIELD_COLLIDERS`
 * is on (`fieldColliders.ts`'s `cadCellBox`) or the Day 1 algebraic box otherwise, and `box.
 * refTheta` already carries which tilt those numbers are true AT (0 for the fallback, the CAD's
 * `cadCaptureTheta(alliance)` for a CAD box) -- see `HiveLocalBox`'s own comment. So the ONE
 * construction below, parametrized by `box` and a matching per-collider rotation offset of
 * `tiltQuatX(-box.refTheta)`, produces the Day 1 geometry when the switch is off and the CAD
 * geometry when it is on, with no separate code path to keep in sync.
 *
 * ⚠️ WHY NOT ONE CONVEX HULL PER CAD PART (an earlier version of this function): each of the
 * CAD's own `floor`/`back`/`side`/`ceiling` hulls (`cadTrayHulls`) is an AXIS-ALIGNED BOUNDING BOX
 * of that PART, not a thin shell -- `floor`'s own `w`-extent alone spans ~12.6 in, most of the
 * cell's own height, because the named bucket collects more than a flat plate (see
 * `fieldColliders.ts`'s header on `side` for the same issue elsewhere). Built as a solid
 * collider, an element placed "just above the floor" is placed INSIDE it, and Rapier's shallow-
 * contact resolution pushed it out through whichever face happened to be nearest -- measured, a
 * pollen staged in the up cell this way fell straight through to the tiles below, because the
 * nearest face from a shallow position inside a ~12-in-thick "floor" is often the BOTTOM one.
 * Building a THIN wall AT the CAD's OWN MEASURED EXTENT (this function) keeps the real dimensions
 * without inheriting that instability. The CAD's own `bar` hull (a real connecting rod, not a
 * bucket of several parts) is not built as a collider either, for the same caution: it overlaps
 * both cells' own `v` ranges near the pivot, which is exactly where the thin BACK wall already
 * sits -- a robot reaching the very base of the frame near the pivot does not feel it, a
 * documented scope limit rather than a silent gap.
 *
 * NO CLEARANCE BRACKET, ON EITHER PATH TODAY: the Day 1 fallback used one (`HIVE_BRACKET_W`,
 * still exported below and read nowhere in this function — kept because the SIM3D smoke lane's
 * measurements check reports it as a historical reference point) precisely because its algebraic
 * box could not put a down cell's own floor at the manual's `BB_HIVE_BOTTOM_Z` (25.5) at the same
 * time as its up cell's opening matched `BB_HIVE_OPEN_Z` — see the file header. On the CAD path
 * the FLOOR wall built here, at `box.wMin`, already IS that one shape's own answer for both
 * cells; whatever the CAD supports for the down cell's clearance is what this measures, reported
 * (not assumed) by the SIM3D lane's measurements check.
 */
export function buildHiveTray3d(
  RAPIER: Rapier3d,
  world3d: InstanceType<Rapier3d['World']>,
  alliance: Alliance,
): InstanceType<Rapier3d['RigidBody']> {
  const px = hivePivotX(alliance);
  const body = world3d.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(px, 0, BB3_HIVE_PIVOT_Z)
      .setRotation({ x: 0, y: 0, z: 0, w: 1 }),
  );
  // rotation is set through `setNextKinematicRotation` immediately after creation (engine.ts),
  // not baked into the desc, so the very first sync's "did the pose change outside the solve"
  // check has a real previous value to compare against.

  // COLLISION half-thickness is a hair thicker than the DOCUMENTED `BB3_HIVE_CELL_WALL` --
  // a 0.25-in wall meeting a 260 in/s sphere for CCD to catch is right at the edge of what a
  // single narrow-phase substep reliably resolves (measured: a bare 0.25in wall let a
  // full-speed shot straight through, wall and cell interior both, out the open far end).
  // The wall reads as 0.25in everywhere else in the sim (docs, the config constant, the
  // DERIVE containment box, which is unaffected -- see `hiveCellLocalBox`); only the
  // COLLIDER'S OWN skin is padded, which is a standard mitigation for a thin fast contact and
  // not a change to the hive's modelled geometry.
  const wallHalf = Math.max(BB3_HIVE_CELL_WALL / 2, 0.75);
  for (const sideSign of [1, -1] as const) {
    const box = hiveCellLocalBox(sideSign, alliance);
    // the per-collider rotation offset that makes the composed (body * this) rotation
    // reproduce `box`'s own reference pose -- identity when `box.refTheta` is 0 (the fallback
    // box's numbers are already theta-independent), the CAD's capture-tilt undo otherwise. See
    // this function's own header and `HiveLocalBox.refTheta`'s comment (`fieldColliders.ts`).
    const offset = tiltQuatX(-box.refTheta);
    // ⚠️ THE TRANSLATION OFFSET NEEDS THE SAME ROTATION, SEPARATELY -- a collider's own
    // `setRotation` only orients its SHAPE (which face points which way); its `setTranslation`
    // is an offset in the BODY's frame and is carried by the BODY's rotation alone, not by the
    // collider's own additional one. A `(v, w)` centre meant to read as "this box's true extent
    // AT `refTheta`" therefore has to be rotated into the body's frame by hand here, by the same
    // `-refTheta`, or the composed pose is only right for the SHAPE's axes and wrong for where
    // it sits -- found by measurement: an element staged to rest on the CAD floor's own surface
    // fell straight through it, because the floor collider's centre was placed as if `refTheta`
    // were 0 while its face normal was correctly tilted by `-refTheta`, splitting the two.
    const at = (v: number, w: number): { y: number; z: number } => {
      const p = rotate2(v, w, -box.refTheta);
      return { y: p.a, z: p.b };
    };
    const vCentre = (box.vMin + box.vMax) / 2;
    const vHalf = (box.vMax - box.vMin) / 2;
    const wCentre = (box.wMin + box.wMax) / 2;
    const wHalf = (box.wMax - box.wMin) / 2;
    // FLOOR (w = wMin): the surface a resting element sits on -- on the CAD path, THIS is the
    // one shape's own answer for the down-cell clearance (see this function's header).
    const floorAt = at(vCentre, box.wMin + wallHalf);
    world3d.createCollider(
      RAPIER.ColliderDesc.cuboid(box.xHalf, vHalf, wallHalf)
        .setTranslation(0, floorAt.y, floorAt.z)
        .setRotation(offset)
        .setFriction(0.6)
        .setRestitution(0.2),
      body,
    );
    // BACK WALL (the INNER end, toward the pivot) -- closed. The OUTER end (away from the
    // pivot) is deliberately left open: that is the launch mouth / spill exit.
    //
    // RESTITUTION 0, NOT 0.2 -- found by measurement: the CAD box's floor is a FLAT plate at a
    // single local `w` (`box.wMin`), which is the same flattening the Day 1 box always made, but
    // the CAD box's own `v`/`w` extent is bigger (a real measured cell, not a figure-calibrated
    // one), so a shot entering fast enough to reach the back wall at 0.2 restitution had enough
    // room to bounce off it and roll for 3+ seconds before friction caught it -- long enough to
    // drift back out through the open (outer) face it had just come in through, never settling.
    // A dead-stop back wall is the more physically honest choice anyway (a POLLEN meeting a
    // padded cell wall, not a superball).
    const innerV = sideSign > 0 ? box.vMin : box.vMax;
    const backAt = at(innerV - sideSign * wallHalf, wCentre);
    world3d.createCollider(
      RAPIER.ColliderDesc.cuboid(box.xHalf, wallHalf, wHalf)
        .setTranslation(0, backAt.y, backAt.z)
        .setRotation(offset)
        .setFriction(0.5)
        .setRestitution(0),
      body,
    );
    // TWO SIDE WALLS (along x = +-xHalf). Top is left open (plan section 3.6's "two open-top
    // cells") -- nothing above a cell but air.
    const sideAt = at(vCentre, wCentre);
    for (const s of [1, -1] as const) {
      world3d.createCollider(
        RAPIER.ColliderDesc.cuboid(wallHalf, vHalf, wHalf)
          .setTranslation(s * (box.xHalf - wallHalf), sideAt.y, sideAt.z)
          .setRotation(offset)
          .setFriction(0.5)
          .setRestitution(0.2),
        body,
      );
    }
  }
  return body;
}

// ---- ROBOTS -----------------------------------------------------------------
// a dynamic cuboid, `length x width x heightIn`, yaw-only.

export function robotHeightIn(spec: RobotSpec): number {
  return spec.heightIn ?? 18;
}

// ---- ELEMENTS -----------------------------------------------------------------
// a dynamic sphere per ground/flight/hive-cell element. A flower-parked element is FIXED (see
// `engine.ts`'s sync rule) and is built with `RAPIER.RigidBodyDesc.fixed()` instead.

export function elementMass(isNectar: boolean): number {
  return BB3_ELEMENT_MASS * (isNectar ? BB3_NECTAR_MASS_RATIO : 1);
}

export const ELEMENT_FRICTION = BB3_ELEMENT_FRICTION;
export const ELEMENT_RESTITUTION = BB3_ELEMENT_RESTITUTION;
export const ELEMENT_ROLL_DAMP = BB3_ELEMENT_ROLL_DAMP;
