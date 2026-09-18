import type { RobotCommand, World } from '../../../types';
import { physics3dImpl } from './engine';

/**
 * BIOBUZZ 3D PHYSICS — THE GATE. One line of code, and it is the whole reason the 3D physics is
 * not in the main chunk.
 *
 * `step.ts`'s `biobuzzStep` dispatches a `'3d'` world here, and `step.ts` is statically reachable
 * from the entry (every client that plays any game imports it). So this file — not the tick —
 * is what `step.ts` gets to import: it holds NO physics, only the lookup of the implementation
 * `initPhysics3d()` loaded. The tick itself is `step3dImpl.ts`, behind `./impl`.
 *
 * THE CONTRACT IS UNCHANGED for every caller: `step3d(world, dt, commands)` with the same
 * signature and the same determinism, and the same error — `3D physics not initialised: await
 * initPhysics3d() first` — when someone steps a 3D world without awaiting the loader. That
 * error used to come from `rapier3d()` one frame deeper; it now comes from here, at the first
 * thing the tick does, which is if anything a clearer place for it.
 */
export function step3d(world: World, dt: number, commands: Map<number, RobotCommand>): void {
  physics3dImpl().step3d(world, dt, commands);
}
