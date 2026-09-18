import type { Alliance, World } from '../../../types';
import { BB_HIVE_TILT_DEG } from '../config';
import { BB_TIP_SWING_S } from '../hive';

/**
 * BIOBUZZ 3D PHYSICS — THE TRAY ANGLE, and nothing else.
 *
 * ⚠️ **THE SECOND (and last) LIGHT sim3d MODULE.** `engine.ts` is the loader; this is the two
 * functions the 3D SCENE needs on a frame it draws with NO 3D physics loaded at all — a
 * 2D-physics match watched in the 3D view is a supported combination, so `scene/renderField.ts`
 * cannot reach the tray angle through `initPhysics3d()`. It is PURE JSON: `world.biobuzz` and
 * two constants, no Rapier, no `Engine3d`, no CAD collider set. Keep it that way — an import of
 * anything under `sim3d/` other than types puts the whole 3D implementation back in the main
 * chunk, which is the regression `npm run bundleaudit` and the RENDER lane's import-boundary
 * check exist to catch.
 *
 * `hive3d.ts` and `bodies.ts` re-export these two names, so every existing importer (the smoke
 * lanes, `scripts/hive-calibrate.ts`, `scripts/scene-preview`) is unchanged.
 */

/** the rest tilt in radians -- `BB_HIVE_TILT_DEG` is in degrees because that is how §9.6 prints
 * it and how a drawing is read. */
const REST_RAD = (BB_HIVE_TILT_DEG * Math.PI) / 180;

/**
 * The hive's tilt, in RADIANS about the world X axis, RIGHT NOW. THE ONE AUTHORITY: the 3D scene
 * rotates the GLB tray by this (minus `hiveTrayRefTheta`), `derive.ts` tests cell membership in
 * it, and the 2D renderer's `tipProjection` draws the same swing from above.
 *
 * Under the DYNAMIC tray it is the joint's own live angle, serialised into `hives[a].angle` by
 * the readback -- nothing in the JSON could recompute it, because it is the result of a solve.
 * Under the kinematic tray (and in every 2D world, every 2D-era replay and every snapshot
 * recorded before the field existed) `angle` is absent and this falls back to the TIMER's own
 * formula, which is the function this used to be in its entirety.
 *
 * `sign` is `+1` when `hive.up === 'north'`, `-1` when `'south'` -- the convention `bodies.ts`'s
 * local (v, w) frame is built against. Before the swing starts and after it completes, `hive.up`
 * already names whichever side IS up, so `sign * rest` is correct at both ends.
 */
export function hiveTiltAngle(world: World, alliance: Alliance): number {
  const hive = world.biobuzz?.hives[alliance];
  if (!hive) return REST_RAD;
  if (typeof hive.angle === 'number' && Number.isFinite(hive.angle)) return hive.angle;
  const sign = hive.up === 'north' ? 1 : -1;
  if (!(hive.tipping > 0)) return sign * REST_RAD;
  // identical to `drawField.ts`'s `tipProjection` -- see that function for the derivation.
  const p = Math.min(1, Math.max(0, 1 - hive.tipping / BB_TIP_SWING_S));
  return sign * REST_RAD * (1 - 2 * p);
}

/**
 * The reference angle `applyHiveTilt` (`engineImpl.ts`) and `scene/renderField.ts`'s
 * `updateBiobuzzField` subtract from `hiveTiltAngle`'s absolute tilt before driving the tray
 * body's kinematic rotation and the GLB tray node's rotation respectively.
 *
 * **0 ON BOTH PATHS** — the CAD tray is exported in its UN-TILTED pivot-local frame, so the
 * physics body, the GLB node and the cell box all take the plain absolute `hiveTiltAngle`. The
 * function stays because it is the ONE place that answers "what pose is the exported tray true
 * at", and because both the collider and the renderer read it: if a future field revision is
 * exported at some other pose, this is the only number that changes and both stay in step.
 *
 * ⚠️ It is a CONSTANT rather than a read of `fieldColliders.ts`'s `cadTrayRefTheta` because this
 * module has to stay light enough for the scene to import (see the header) — and the CAD's own
 * `refTheta` is 0 on both trays. The SIM3D lane asserts the two agree, so a future export at a
 * non-zero pose fails a check here rather than silently drawing the tray at double its tilt
 * (which is exactly the bug this correction was added for).
 */
export function hiveTrayRefTheta(_alliance: Alliance): number {
  return 0;
}
