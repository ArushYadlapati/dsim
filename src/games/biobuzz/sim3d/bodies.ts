import type { Rapier3d } from './engine';
import type { RobotSpec } from '../../../types';
import { dcos, dsin } from '../../../math';
import {
  BB3_ELEMENT_FRICTION,
  BB3_ELEMENT_MASS,
  BB3_ELEMENT_RESTITUTION,
  BB3_ELEMENT_ROLL_DAMP,
  BB3_HIVE_ARM,
  BB3_HIVE_CELL,
  BB3_HIVE_CELL_WALL,
  BB3_HIVE_PIVOT_Z,
  BB3_NECTAR_MASS_RATIO,
  BB3_WALL_H,
  BB_FLOWER_TOP_Z,
  BB_HIVE_TILT_DEG,
  BB_HIVE_X,
} from '../config';
import { biobuzzColliders, BB_WALL_COUNT } from '../colliders';
import { yawQuat } from './math3';

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
 * THE OPENING VS. THE CLEARANCE, TWO FEATURES, ONE KNOWN RESIDUAL.
 * The CELL BOX (hiveCellLocalBox) is calibrated to the LAUNCH OPENING: at v = arm + d/2 (its
 * open outer face) and the REST tilt (30 degrees), it spans world z = [55.17, 65.60] against
 * the manual's BB_HIVE_OPEN_Z [53.5, 65.6] -- exact at the top, +1.67in at the bottom. The SAME
 * box, mirrored to the DOWN side, spans [32.73, 43.16] -- nowhere near BB_HIVE_BOTTOM_Z 25.5,
 * because a rigid bar whose up-side opening matches the manual does not also put its down-side
 * floor where the manual's ROBOT-CLEARANCE figure says, on this box geometry. Rather than fudge
 * one box to half-satisfy both (and match neither), a SEPARATE, EXPLICIT clearance bracket
 * (see HIVE_BRACKET_W below) is added per cell, at a w chosen so THAT bracket -- not the cell
 * box -- reads exactly 25.5in when its cell is down. This is flagged APPROX and reported as a
 * residual because a real CAD assembly almost certainly delivers both figures from ONE shape;
 * this is the Day 1 placeholder the plan's CAD pipeline (day 2+) replaces.
 */

// ---- STATICS -----------------------------------------------------------------
// floor, walls, hive frame legs, flower feet. Reuses the 2D `biobuzzColliders` array outright
// for every x/y number (walls, the two frame bars, the four flower feet are already MEASURED
// there) and adds only the third dimension: how tall each one stands.

/** the 2D field's static count breakdown -- `biobuzzColliders.statics` is built as
 * `[...walls, ...frameBars, ...flowerFeet]` (see `colliders.ts`), and `BB_WALL_COUNT` (4) is
 * exported from there; the frame count (2) is not, so it is named here once rather than as a
 * bare `2` at the slice site. */
const FRAME_COUNT = 2;

/** floor half-thickness (in) -- deliberately thick for the same reason the 2D perimeter walls
 * are: a thin static under a fast-falling sphere can tunnel through in one 1/60s step without
 * CCD, and the floor is the one static every dynamic body rests against every tick. */
const FLOOR_HALF_T = 10;

/**
 * Build every BIOBUZZ static collider into `world3d`: the floor, the four perimeter walls, the
 * two hive frame legs, and the four flower feet -- named order, fixed every call (determinism:
 * plan section 2.1's "statics (named, fixed order)").
 */
export function buildStatics3d(RAPIER: Rapier3d, world3d: InstanceType<Rapier3d['World']>): void {
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

  const specs = biobuzzColliders.statics;
  specs.forEach((s, i) => {
    const isWall = i < BB_WALL_COUNT;
    const isFrame = !isWall && i < BB_WALL_COUNT + FRAME_COUNT;
    // wall: floor to BB3_WALL_H. frame leg: floor to the pivot (an APPROX support post -- the
    // real triangular leg leans out of a robot's way above some height; a plain vertical post
    // is the Day 1 stand-in). flower foot: floor to the ring's top (BB_FLOWER_TOP_Z) -- the
    // MEASURED rectangle from `colliders.ts`, kept as a box rather than approximated as a
    // cylinder, since the box IS the measured footprint (reference section 2.3) and a cylinder
    // would be a fresh guess about something already known.
    const height = isWall ? BB3_WALL_H : isFrame ? BB3_HIVE_PIVOT_Z : BB_FLOWER_TOP_Z;
    const half = height / 2;
    const body = world3d.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(s.tx, s.ty, half).setRotation(yawQuat(s.rot)),
    );
    world3d.createCollider(
      RAPIER.ColliderDesc.cuboid(s.hx, s.hy, half).setFriction(0.5).setRestitution(0),
      body,
    );
  });
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
}

/** the CELL interior -- the launch opening AND the physical container a resting element sits
 * in, ONE box for both (see the file header's residual note). `sideSign` is `1` (north,
 * `v > 0`) or `-1` (south). */
export function hiveCellLocalBox(sideSign: 1 | -1): HiveLocalBox {
  const half = BB3_HIVE_CELL.d / 2;
  const centre = sideSign * BB3_HIVE_ARM;
  return {
    xHalf: BB3_HIVE_CELL.w / 2,
    vMin: Math.min(centre - half, centre + half),
    vMax: Math.max(centre - half, centre + half),
    wMin: 0,
    wMax: BB3_HIVE_CELL.h,
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
 * Build one hive's tray body and its colliders (two cells + two clearance brackets). Returns
 * the body so `engine.ts` can key it and drive its rotation every tick.
 */
export function buildHiveTray3d(
  RAPIER: Rapier3d,
  world3d: InstanceType<Rapier3d['World']>,
  alliance: 'red' | 'blue',
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
    const box = hiveCellLocalBox(sideSign);
    const vCentre = (box.vMin + box.vMax) / 2;
    const vHalf = (box.vMax - box.vMin) / 2;
    const wCentre = (box.wMin + box.wMax) / 2;
    const wHalf = (box.wMax - box.wMin) / 2;
    // FLOOR (w = wMin): the surface a resting element sits on.
    world3d.createCollider(
      RAPIER.ColliderDesc.cuboid(box.xHalf, vHalf, wallHalf)
        .setTranslation(0, vCentre, box.wMin + wallHalf)
        .setFriction(0.6)
        .setRestitution(0.2),
      body,
    );
    // BACK WALL (the INNER end, toward the pivot) -- closed. The OUTER end (away from the
    // pivot) is deliberately left open: that is the launch mouth / spill exit.
    const innerV = sideSign > 0 ? box.vMin : box.vMax;
    world3d.createCollider(
      RAPIER.ColliderDesc.cuboid(box.xHalf, wallHalf, wHalf)
        .setTranslation(0, innerV - sideSign * wallHalf, wCentre)
        .setFriction(0.5)
        .setRestitution(0.2),
      body,
    );
    // TWO SIDE WALLS (along x = +-xHalf). Top is left open (plan section 3.6's "two open-top
    // cells") -- nothing above a cell but air.
    for (const s of [1, -1] as const) {
      world3d.createCollider(
        RAPIER.ColliderDesc.cuboid(wallHalf, vHalf, wHalf)
          .setTranslation(s * (box.xHalf - wallHalf), vCentre, wCentre)
          .setFriction(0.5)
          .setRestitution(0.2),
        body,
      );
    }
    // the DOWN-clearance bracket -- see `HIVE_BRACKET_W`'s header.
    world3d.createCollider(
      RAPIER.ColliderDesc.cuboid(box.xHalf, BB3_HIVE_CELL.d / 4, HIVE_BRACKET_T / 2)
        .setTranslation(0, sideSign * BB3_HIVE_ARM, HIVE_BRACKET_W)
        .setFriction(0.5)
        .setRestitution(0),
      body,
    );
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
