import { BALL_REST_SPEED } from '../../config';
import { movingFaster, robotsAtRest } from '../../sim/settle';
import type { World } from '../../types';
import { hiveLoad, hiveWillTip } from './hive';
import { bbKindIndex } from './score';

/**
 * BIOBUZZ: nothing left on the field that can change the score — the `GameSimModule.settled`
 * slot, read by the shared settle clock (`src/sim/settle.ts`).
 *
 * §10.5 A: TIPS are assessed "until all SCORING ELEMENTS and ROBOTS have come to rest at the
 * conclusion of the MATCH"; §10.5 C: what REMAINS in a CELL is assessed after that. So:
 *   · no element in FLIGHT — a cell can still capture it (`play.ts`, no phase gate);
 *   · no HIVE swinging, and none loaded past its tip threshold — an over-damper tray starts a
 *     swing in `post` as readily as in teleop (`hive.ts`), and a swing ends in +20 and an empty
 *     tray;
 *   · every GROUND element at rest — a GARDEN counts live ground positions, and a spill is
 *     still rolling for a beat after it lands;
 *   · every ROBOT at rest.
 */
export function bbSettled(world: World): boolean {
  for (const b of world.balls) {
    if (b.state.kind === 'flight') return false;
    if (b.state.kind === 'ground' && movingFaster(b.vel, BALL_REST_SPEED)) return false;
  }
  const bb = world.biobuzz;
  if (bb) {
    const kindOf = bbKindIndex(world);
    for (const a of ['red', 'blue'] as const) {
      const hive = bb.hives[a];
      if (hive.tipping > 0) return false;
      if (hiveWillTip(hiveLoad(hive.contents, kindOf))) return false;
    }
  }
  return robotsAtRest(world);
}
