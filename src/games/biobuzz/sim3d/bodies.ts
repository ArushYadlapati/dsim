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
  BB_HIVE_BOTTOM_Z,
  BB_HIVE_TILT_DEG,
  BB_HIVE_X,
  BB_WALL_T,
} from '../config';
import { biobuzzColliders, BB_WALL_COUNT } from '../colliders';
import { cadCellBox, cadStatics, cadTrayHulls, cadTrayRefTheta } from './fieldColliders';
import { buildFlowerTubes3d } from './flowerTube';
import { yawQuat } from './math3';

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
 * THE OPENING VS. THE CLEARANCE, TWO FEATURES, ONE RESIDUAL -- RESOLVED BY THE CAD (§8), AND
 * THEN BY THE OWNER'S RULING.
 * The Day 1 analytic CELL BOX (`hiveCellLocalBox`'s fallback branch, still here for when
 * `BB3_FIELD_COLLIDERS` is off or a part is missing) was calibrated to the LAUNCH OPENING and
 * could not ALSO put its down-side floor at the manual's robot-clearance figure of 25.5, because
 * a rigid bar whose up-side opening matches Fig 9-10 does not: the same box mirrored to the down
 * side sat 7 in high. The Day 1 fix was a SEPARATE, EXPLICIT clearance bracket (`HIVE_BRACKET_W`
 * below) solved to read exactly 25.5 in when that cell is down -- flagged APPROX, because a real
 * CAD assembly delivers both figures from ONE shape.
 * It does, and the answer is that the 25.5 was the figure at fault: the CAD's up-cell opening
 * matches the manual to 0.13 in and its down-cell floor is 31.981, which the owner ruled
 * authoritative on 2026-09-18. `BB_HIVE_BOTTOM_Z` is now that number, so the bracket lands where
 * the CAD tray's own floor does and the two paths agree instead of trading one figure for the
 * other. With `BB3_FIELD_COLLIDERS` on, `cadCellBox`/`cadTrayHulls` (`fieldColliders.ts`) ARE
 * that one shape -- the CAD tray's own floor/back/side/ceiling hulls, un-rotated into this same
 * (x, v, w) frame -- and the bracket is dropped outright (see `buildHiveTray3d`).
 */

// ---- STATICS -----------------------------------------------------------------
// floor (always analytic) and walls (always analytic cuboids at the shared BB_HALF_X/Y/
// BB3_WALL_H constants, which ARE the CAD's own measured inner faces since the 2026-09-18
// ruling -- see buildStatics3d's own comment for why the analytic plane and not the CAD's
// stepped wall trimesh), and everything
// else (flower supports) as CAD trimesh statics -- falling back to the 2D field's own
// frame-bar/flower-foot boxes (`biobuzzColliders`, extruded) when the CAD set is off or empty.

/** the 2D field's static count breakdown -- `biobuzzColliders.statics` is built as
 * `[...walls, ...frameBars, ...flowerFeet]` (see `colliders.ts`), and `BB_WALL_COUNT` (4) is
 * exported from there; the frame count (2) is not, so it is named here once rather than as a
 * bare `2` at the slice site. Only used by the fallback branch below. */
const FRAME_COUNT = 2;

/** floor half-thickness (in) -- deliberately thick for the same reason the 2D perimeter walls
 * are: a thin static under a fast-falling sphere can tunnel through in one 1/60s step without
 * CCD, and the floor is the one static every dynamic body rests against every tick. */
const FLOOR_HALF_T = 10;

/**
 * THE HIVE FRAME IS A REAL COLLIDER AGAIN (2026-09-18 CAD round 2).
 *
 * It was excluded outright before, and the reason was a defect in the EXPORTER, not a property
 * of the geometry: every static used to be a hull of the part's AXIS-ALIGNED BOUNDING BOX, and
 * an AABB of a LEANING part is the whole box it sweeps through. `hive_red_frame_a_frame_leg`
 * measured x ∈ [-24.28, -12.24], z ∈ [0.22, 41.40] -- floor to nearly the pivot, reaching almost
 * to the hive's centreline -- so as a solid it turned "a robot drives under the hive" (G409,
 * `colliders.ts`'s own header) into "a robot cannot enter the space under the hive at all":
 * measured, the parity check's robot stopped dead at x ≈ 1.75. The same defect made
 * `frame_upright`'s AABB a near-full-size box between the base and the pivot, which ejected the
 * staged up-cell nectar at ~700 in/s on tick one.
 *
 * `convert.py` now exports a TRUE convex hull of each part instance's own tessellated surface,
 * so the A-frame leg is the thin diagonal strut it actually is (foot at ±(24.30, 19.07, 0.22),
 * apex at ±(12.26, 0, 41.40)), the Churro braces are 0.37-in tubes, and the space between the
 * two legs -- the drive-under -- is empty because nothing is in it. See
 * `docs/biobuzz/field-cad-audit.md` §4.6.
 *
 * WHICH classes become solids is `PHYSICAL_STATIC_CLASSES` in `fieldColliders.ts`, with the
 * reason for every exclusion written next to it (walls and floor stay analytic at the constants
 * by owner rule; tape/decals/under-tile hardware cannot be touched; a flower RING plate's hull
 * would fill the hole a POLLEN passes through).
 */

/**
 * Build every BIOBUZZ static collider into `world3d`: the floor, the four perimeter walls, the
 * hive frames (legs, feet, foot bars, top corners, crossbar, uprights, dampers, brackets, logo
 * panel) and the four flower supports -- named order, fixed every call (determinism: plan
 * section 2.1's "statics (named, fixed order)").
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

  // ---- WALLS: four thick cuboids at the shared constants (BB_HALF_X/Y inner face, BB3_WALL_H
  // height), which ARE the CAD's own measured inner faces now -- `BB_HALF_X/Y` is `FIELD_HALF`
  // from `fieldDims.gen.ts` (owner ruling, 2026-09-18: "the CAD is authoritative for
  // dimensions"). The "stay at 72 for parity" exception this comment used to carry is GONE,
  // because there is nothing left for it to be an exception to: the 2D pipeline, the staging and
  // every gameplay rule are keyed to the same ±70.674 these cuboids are built at, so building
  // from the constants and building from the CAD are the same act.
  //
  // ⚠️ THEY ARE STILL BUILT FROM THE CONSTANTS, NOT FROM `cadWallExtents()`. The CAD's wall
  // TRIMESH is the real panels, links and rails -- a stepped, gappy surface with the glass only
  // 11 in tall -- and what the physics wants is one flat plane per side, tall enough that nothing
  // legal clears it. The constants express that plane; the measurement is what the SIM3D lane
  // checks the plane AGAINST (0.05 in, both pipelines and the GLB), which is the useful direction
  // for that comparison.
  const wallHeight = BB3_WALL_H;
  const wallHalf = wallHeight / 2;
  const wallCentreZ = wallHalf;
  const span = 2 * Math.max(BB_HALF_X, BB_HALF_Y) + 4 * BB_WALL_T; // long enough the four overlap at the corners
  const faces: readonly { readonly inner: number; readonly axis: 'x' | 'y'; readonly sign: 1 | -1 }[] = [
    { inner: BB_HALF_X, axis: 'x', sign: 1 },
    { inner: -BB_HALF_X, axis: 'x', sign: -1 },
    { inner: BB_HALF_Y, axis: 'y', sign: 1 },
    { inner: -BB_HALF_Y, axis: 'y', sign: -1 },
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

  // ---- THE HIVE FRAMES AND THE FLOWER SUPPORTS, as CAD CONVEX HULLS: one fixed body + one
  // `ColliderDesc.convexHull` per named part instance, in the collider file's own array order
  // (determinism). Per INSTANCE, never merged per part TYPE -- one hull over both A-frame legs
  // is a solid wedge filling the gap between them, and that gap is the drive-under.
  const cad = useFieldColliders() ? cadStatics() : [];
  if (cad.length > 0) {
    for (const s of cad) {
      const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(s.points));
      if (!desc) continue; // a degenerate point set -- Rapier returns null rather than throwing
      const body = world3d.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      world3d.createCollider(desc.setFriction(wallFriction).setRestitution(0), body);
    }
  } else {
    // legacy Day 1 fallback, used only when `BB3_FIELD_COLLIDERS` is off or the collider file is
    // absent: the 2D field's own frame-bar and flower-foot boxes (`colliders.ts`), extruded.
    const frameBars = biobuzzColliders.statics.slice(BB_WALL_COUNT, BB_WALL_COUNT + FRAME_COUNT);
    for (const s of frameBars) {
      const half = BB3_HIVE_PIVOT_Z / 2; // floor to the pivot
      const body = world3d.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(s.tx, s.ty, half).setRotation(yawQuat(s.rot)),
      );
      world3d.createCollider(
        RAPIER.ColliderDesc.cuboid(s.hx, s.hy, half).setFriction(wallFriction).setRestitution(0),
        body,
      );
    }
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

  // ---- THE FLOWER RING PLATES, as rectangle-minus-disc TRIMESHES (Day 2, §3.7). LAST, after
  // every hull, and that ORDER is load-bearing -- see `buildFlowerTubes3d`'s own comment.
  // They are not in `cadStatics()` and never will be: their class is `flower_ring`, which
  // `convert.py` exports no hull for, because a hull of an annulus fills the bore an element
  // passes through. Nothing here on the FALLBACK path: the Day 1 constants field has no per-ring
  // geometry to build from, and the flower foot box it does build stands in for the whole column.
  if (useFieldColliders()) buildFlowerTubes3d(RAPIER, world3d, wallFriction);
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
  /** which tilt angle this box's `vMin..wMax` numbers are true AT — **0 on BOTH paths now**.
   * The algebraic fallback has always been theta-independent by construction; the CAD path is
   * exported UN-TILTED (`convert.py` rotates every tray point by `−captureTheta` about the
   * pivot before writing it), which is the fix for the owner's "balls are on a different plane
   * than the actual bottom of the hive". The field stays in the shape, and
   * `hiveTrayRefTheta`/`applyHiveTilt`/`updateBiobuzzField` keep subtracting it, so that a
   * future field revision exported at some other pose has exactly one place to say so and every
   * consumer already honours it. `world = pivot + Rotate(theta) * (v, w)` holds for these
   * numbers directly. */
  refTheta: number;
}

/**
 * The CELL interior -- the launch opening AND the physical container a resting element sits in,
 * ONE box for both. `sideSign` is `1` (north, `v > 0`) or `-1` (south); `alliance` picks whose
 * tray (the CAD cells are alliance-specific real geometry, not assumed symmetric, even though
 * this STEP's four cells measure identically to 0.001 in).
 *
 * Prefers `cadCellBox` — the interior `convert.py` measured off the cell's own structural facet
 * PLANES (the floor plate's top surface at local w = −1.4682, the gable apex, the side walls,
 * the back plate), which is the same surface the GLB mesh draws. Falls back to the Day 1
 * algebraic box, calibrated to the manual's launch-opening figure alone, when the CAD set is off
 * or has no cell for this side.
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
 * The reference angle `applyHiveTilt` (`engine.ts`) and `scene/renderField.ts`'s
 * `updateBiobuzzField` subtract from `hiveTiltAngle`'s absolute tilt before driving the tray
 * body's kinematic rotation and the GLB tray node's rotation respectively.
 *
 * **0 ON BOTH PATHS NOW** — the CAD tray is exported in its UN-TILTED pivot-local frame, so the
 * physics body, the GLB node and the cell box all take the plain absolute `hiveTiltAngle`. The
 * function stays because it is the ONE place that answers "what pose is the exported tray true
 * at", and because both the collider and the renderer read it: if a future field revision is
 * exported at some other pose, this is the only number that changes and both stay in step.
 * Reads the CAD path's own `refTheta` when the collider set is on, so a nonzero value in the
 * data is honoured rather than assumed away.
 */
export function hiveTrayRefTheta(alliance: Alliance): number {
  return useFieldColliders() ? cadTrayRefTheta(alliance) : 0;
}

/**
 * The DOWN-CLEARANCE bracket for one cell -- a local point `(v, w)` calibrated so that, WHEN
 * THIS CELL IS DOWN (its own rest tilt), the bracket's world z is exactly `BB_HIVE_BOTTOM_Z`
 * (31.981 -- the CAD's, since the 2026-09-18 ruling; it was the manual's 25.5 when this was
 * written). Solved once, algebraically, from the rest-tilt geometry (see the file header): at
 * `theta = BB_HIVE_TILT_DEG` and `v = -BB3_HIVE_ARM` (the DOWN side's own centre, sign already
 * folded in), `BB3_HIVE_PIVOT_Z + v*sin(theta) + w*cos(theta) = BB_HIVE_BOTTOM_Z` solves for
 * `w`. The bracket sits at `v = sideSign * BB3_HIVE_ARM` (its own cell's centre) and this SAME
 * `w`, because both cells are mirror images of one another about the pivot.
 */
export const HIVE_BRACKET_W = (() => {
  const rad = (BB_HIVE_TILT_DEG * Math.PI) / 180;
  // solved for the DOWN side (v = -ARM): PIVOT_Z - ARM*sin(rad) + w*cos(rad) = BOTTOM_Z
  const BOTTOM_Z = BB_HIVE_BOTTOM_Z; // CAD (31.981) -- see `BB_HIVE_BOTTOM_Z` in config.ts
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
 * ONE SHAPE, TWO SOURCES. With `BB3_FIELD_COLLIDERS` on this builds the CAD tray's own PLANAR
 * FACET SLABS (`cadTrayHulls`) as `ColliderDesc.convexHull` shapes, directly, with no rotation
 * offset -- they are already in the tray's UN-TILTED pivot-local frame, which is the frame this
 * body's own rotation (`hiveTiltAngle`) is defined in. With it off (or with no hulls in the
 * file) it builds the Day 1 thin-walled box from `hiveCellLocalBox`'s algebraic fallback.
 *
 * ⚠️ WHY FACET SLABS AND NOT ONE HULL PER CAD PART -- the trap this replaces, twice over:
 *  - `Hive Goal Bottom Skin` is an OPEN U CHANNEL (a flat floor at local w = -1.4884 with two
 *    side walls rising to w = 6.33) and `Hive Goal Top Skin` is a GABLE ROOF. A convex hull of
 *    either FILLS the cell: an element would rest ~7.8 in above the floor it is drawn on.
 *  - `Goal Rib` is a perforated hexagonal FRAME plate at each end of the cell. Its hull fills
 *    its own opening -- and at the mouth end that opening IS the cell's aperture, so a shot
 *    could never get in. It is VISUAL-ONLY, exactly like the flower ring plates, and
 *    `convert.py` exports no hull for it.
 * `convert.py` therefore decomposes each shell into PLANAR FACETS and exports one thin oriented
 * box per structural plane -- `cell_<side>_{floor,side_pos,side_neg,roof_pos,roof_neg,back}` --
 * each sitting exactly ON its CAD surface and extruded 1.5 in OUTWARD. The padding is the same
 * anti-tunnelling allowance the hand-built walls used (a 0.25-in wall meeting a 260 in/s sphere
 * is at the edge of what one narrow-phase substep resolves); putting all of it on the outside is
 * the difference between a collider that agrees with the picture and one that does not.
 *  `bar_<side>` (`Basket Base Tube`) is a real solid rod and keeps a whole-part hull.
 *
 * NO CLEARANCE BRACKET, ON EITHER PATH: the Day 1 fallback used one (`HIVE_BRACKET_W`, still
 * exported below and read nowhere here -- kept because the SIM3D lane's measurements check
 * reports it as a historical reference point) precisely because its algebraic box could not put
 * a down cell's floor at the manual's 25.5 and its up cell's opening at the manual's [53.5, 65.6]
 * at the same time. That tension is RESOLVED rather than traded now: the CAD's up-cell opening
 * agrees with the manual to 0.13 in and its down-cell floor is 31.981, so `BB_HIVE_BOTTOM_Z` is
 * the CAD figure and the fallback's bracket lands where the CAD tray's own floor does.
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
  // TRAY-WALL RESTITUTION IS GOVERNED BY THE TRAY, NOT AVERAGED WITH THE ELEMENT'S OWN 0.45 --
  // `Min` combine (owner playtest fix, "balls spill out too easily"): every tray collider below
  // sets a LOW restitution and `CoefficientCombineRule.Min`, so `min(elementRestitution 0.45,
  // trayRestitution)` -- the LOWER number -- governs every element/tray contact, the same
  // direction `engine.ts`'s floor already takes for FRICTION (a `Min` rule there keeps a
  // 0-friction floor from fighting the drivetrain model). Before this fix no restitution combine
  // rule was set on any tray collider, so Rapier's own default (`Average`) applied: an element
  // landing on the 0.2-restitution floor bounced at `(0.45+0.2)/2 = 0.325`, which, combined with
  // the flat-floor bug of the same pass, was enough height and roll time for a resting element to
  // wander back out the always-open mouth.
  const TRAY_RESTITUTION_COMBINE = RAPIER.CoefficientCombineRule.Min;

  /** per-hull surface, by the class `convert.py` stamped on it. The FLOOR is the one an element
   * rests on and rolls along, so it keeps the higher friction; the BACK is a dead stop (a POLLEN
   * meeting a padded cell wall, not a superball -- measured: at 0.2 restitution a shot that
   * reached the back wall bounced and rolled for 3+ seconds, long enough to drift back out the
   * open mouth it came in through). */
  const trayFriction = (name: string): number => (name.includes('_floor') ? 0.6 : 0.5);
  const trayRestitution = (name: string): number => (name.includes('_back') ? 0 : 0.15);

  const hulls = useFieldColliders() ? cadTrayHulls(alliance) : [];
  if (hulls.length > 0) {
    // THE CAD PATH: each hull is already a thin oriented slab sitting on its own CAD surface, in
    // this body's own un-tilted local frame. Straight to `convexHull`, no translation, no
    // rotation, no re-boxing -- which is the whole point: the collider the element rests on and
    // the triangle the GLB draws are the same plane.
    for (const h of hulls) {
      const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(h.points));
      if (!desc) continue; // degenerate point set -- Rapier returns null rather than throwing
      world3d.createCollider(
        desc
          .setFriction(trayFriction(h.name))
          .setRestitution(trayRestitution(h.name))
          .setRestitutionCombineRule(TRAY_RESTITUTION_COMBINE),
        body,
      );
    }
    return body;
  }

  // THE FALLBACK PATH (CAD off, or an empty collider file): the Day 1 thin-walled box per cell --
  // floor, back, two sides, outer face open (the launch mouth / spill exit).
  for (const sideSign of [1, -1] as const) {
    const box = hiveCellLocalBox(sideSign, alliance);
    const cuboid = (xLo: number, xHi: number, vLo: number, vHi: number, wLo: number, wHi: number) =>
      RAPIER.ColliderDesc.cuboid((xHi - xLo) / 2, (vHi - vLo) / 2, (wHi - wLo) / 2).setTranslation(
        (xLo + xHi) / 2,
        (vLo + vHi) / 2,
        (wLo + wHi) / 2,
      );
    world3d.createCollider(
      cuboid(-box.xHalf, box.xHalf, box.vMin, box.vMax, box.wMin, box.wMin + 2 * wallHalf)
        .setFriction(0.6)
        .setRestitution(0.15)
        .setRestitutionCombineRule(TRAY_RESTITUTION_COMBINE),
      body,
    );
    const innerV = sideSign > 0 ? box.vMin : box.vMax;
    const backA = innerV;
    const backB = innerV - sideSign * 2 * wallHalf;
    world3d.createCollider(
      cuboid(-box.xHalf, box.xHalf, Math.min(backA, backB), Math.max(backA, backB), box.wMin, box.wMax)
        .setFriction(0.5)
        .setRestitution(0)
        .setRestitutionCombineRule(TRAY_RESTITUTION_COMBINE),
      body,
    );
    for (const s of [1, -1] as const) {
      const xA = s * box.xHalf;
      const xB = s * (box.xHalf - 2 * wallHalf);
      world3d.createCollider(
        cuboid(Math.min(xA, xB), Math.max(xA, xB), box.vMin, box.vMax, box.wMin, box.wMax)
          .setFriction(0.5)
          .setRestitution(0.15)
          .setRestitutionCombineRule(TRAY_RESTITUTION_COMBINE),
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
