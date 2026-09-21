/**
 * BIOBUZZ 3D PHYSICS — THE LAZY BARREL. Every heavy module in `sim3d/`, re-exported from one
 * place, so that the whole 3D implementation is ONE dynamic import and therefore ONE chunk.
 *
 * ⚠️ **THE ONLY IMPORTER OF THIS FILE IS `engine.ts`'s `initPhysics3d()`, and it imports it
 * dynamically.** Anything that static-imports it drags ~225 KB of source (bodies, the CAD
 * collider set, the derive/gameplay passes, the predictors) back into whatever chunk did the
 * importing — which, for anything reachable from `src/main.tsx`, is the MAIN chunk every player
 * of every game downloads. That is the regression this whole split exists to undo; `npm run
 * bundleaudit` measures it and the RENDER lane's import-boundary check names the offender.
 *
 * Reach it from the main chunk through `physics3dImpl()` (`engine.ts`) after awaiting
 * `initPhysics3d()`:
 *
 *   await initPhysics3d();
 *   const p = physics3dImpl().createFullPredictor(world, myRobotId);   // §7, still unwired
 *
 * `sim3d/step3d.ts` already does exactly that for the tick, so `step.ts` never sees this file.
 *
 * NODE CALLERS (the smoke lanes, `scripts/hive-calibrate.ts`, `scripts/costprobe.ts`) may keep
 * importing the individual modules directly — there is no bundle to protect there, they all
 * `await initPhysics3d()` before stepping anything, and a lane that asserts on
 * `hiveContentsTorque` should say so by name.
 *
 * `export *` rather than a curated list: the barrel's job is to make the graph REACHABLE, and a
 * curated list is a second place to forget something. ⚠️ A name exported by two of the modules
 * below would be dropped SILENTLY by `export *` (that is what the spec says an ambiguous star
 * re-export does), so keep the names disjoint — `hiveTiltAngle` and `hiveTrayRefTheta` come
 * through exactly one door each (`./hive3d` and `./bodies`, both re-exporting the light
 * `./tilt`), and `./tilt` itself is deliberately NOT starred here: it must stay importable
 * without the barrel.
 */
export * from './engineImpl';
export * from './step3dImpl';
export * from './bodies';
export * from './contacts3d';
export * from './derive';
export * from './elements3d';
export * from './flower3d';
export * from './flowerTube';
export * from './groups';
export * from './hive3d';
export * from './math3';
export * from './robot3d';
export * from './fieldColliders';
export * from './predict';
