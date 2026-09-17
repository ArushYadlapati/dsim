import type { Artifact, RobotState, RobotCommand, World } from '../../../types';
import type { BiobuzzState } from '../state';
import type { BbElementKind } from '../flower';
import { bbFlowerAtIntake, retrieveFromFlower } from '../play';
import { placeInFlower } from '../play';

/**
 * BIOBUZZ 3D PHYSICS -- FLOWERS (Day 1, `docs/biobuzz/plan-3d.md` section 3.7).
 *
 * THE STATICS are NOT here. A FLOWER's physical collider (a box extruded from the MEASURED
 * `colliders.ts` foot, floor to `BB_FLOWER_TOP_Z`) is built once, with every other static, by
 * `sim3d/bodies.ts`'s `buildStatics3d` -- see that file's header for why a box beats a fresh
 * cylinder approximation here. This file owns the GAMEPLAY half: placement and retrieval.
 *
 * PLACEMENT AND RETRIEVAL ARE PHYSICS-AGNOSTIC, AND THAT IS THE WHOLE POINT. `placeInFlower`
 * (a Box Tube's proximity placement) and `retrieveFromFlower` (G418.B's bottom-pop) are pure
 * JSON bookkeeping over `world.balls`/`world.biobuzz` plus a ROBOT-POSE geometry test
 * (`bbFlowerInReach`/`bbFlowerAtIntake`) -- nothing in either function reads or writes a Rapier
 * body. So the 3D pipeline calls the SAME 2D functions outright (both are now exported from
 * `play.ts` for exactly this reason) rather than reimplementing them: a placed element is a
 * FIXED body at its JSON position and a retrieved one loses its body, and BOTH of those are
 * `sim3d/engine.ts`'s `syncElement`'s job on the very next sync, not this file's.
 */

export { bbFlowerAtIntake };

/** thin re-export under this lane's own name, so `elements3d.ts`'s gameplay stage reads
 * "flower retrieval" from `flower3d.ts` rather than reaching into `play.ts` directly. */
export function flowerRetrieve3d(
  world: World,
  bb: BiobuzzState,
  rob: RobotState,
  cmd: RobotCommand | undefined,
  enabled: boolean,
  ballById: ReadonlyMap<number, Artifact>,
  kindOf: (id: number) => BbElementKind,
): boolean {
  return retrieveFromFlower(world, bb, rob, cmd, enabled, ballById, kindOf);
}

/** thin re-export, same reasoning as `flowerRetrieve3d`. */
export function flowerPlace3d(
  world: World,
  bb: BiobuzzState,
  rob: RobotState,
  nectar: boolean,
  kindOf: (id: number) => BbElementKind,
): boolean {
  return placeInFlower(world, bb, rob, nectar, kindOf);
}
