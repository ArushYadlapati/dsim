import { BALL_REST_SPEED } from '../../config';
import { movingFaster, robotsAtRest } from '../../sim/settle';
import type { World } from '../../types';
import { BB3_HIVE_REST_W } from './config';
import { hiveLoad, hiveWillTip } from './hive';
import { bbKindIndex } from './score';

/**
 * BIOBUZZ: nothing left on the field that can change the score — the `GameSimModule.settled`
 * slot, read by the shared settle clock (`src/sim/settle.ts`).
 *
 * §10.5 A: TIPS are assessed "until all SCORING ELEMENTS and ROBOTS have come to rest at the
 * conclusion of the MATCH"; §10.5 C: what REMAINS in a CELL is assessed after that. So:
 *   · no element still MOVING — one in the air can still reach a cell (`play.ts`, no phase
 *     gate), and a spill is still rolling for a beat after it lands;
 *   · no HIVE swinging, and none with a TIP still owed;
 *   · every ROBOT at rest.
 *
 * ⚠️ **EVERY TEST HERE IS ABOUT MOTION, NEVER ABOUT A DERIVED TAG OR A LOOKUP TABLE**, and both
 * halves of that shipped the other way round (owner report, 2026-09-18: "takes forever when
 * nothing is moving" — measured, a bot-driven 3D match hit the 10 s cap on two seeds in three).
 * See the two paragraphs below; each names the run that found it.
 */
export function bbSettled(world: World): boolean {
  for (const b of world.balls) {
    /**
     * ⚠️ `flight` IS A TAG, NOT A FACT ABOUT MOTION — under 3D physics it is DERIVED, every
     * tick, as "not in a cell or a tube, and off the tiles" (`sim3d/derive.ts`). An element at
     * rest on any structure there is — the hive frame, a spilled pile, a tray's outer face — is
     * 44 in up and therefore permanently `flight`, and `return false` on the tag alone held the
     * clock open for the whole 10 s cap with the field visibly still (seed 7: eight elements
     * parked at z 43.9, unchanged for 600 ticks). So an off-the-tiles element holds the clock
     * only while it is actually moving, which is the same question the ground row below asks.
     * A ball genuinely in the air is above this threshold except within a tick of its apex, and
     * the clock needs `MATCH_SETTLE_HOLD_S` of unbroken quiet, so a lob still holds it open.
     */
    if (b.state.kind === 'flight' || b.state.kind === 'ground') {
      if (movingFaster(b.vel, BALL_REST_SPEED)) return false;
      if (Math.abs(b.vz) >= BALL_REST_SPEED) return false;
    }
  }
  const bb = world.biobuzz;
  if (bb) {
    const kindOf = bbKindIndex(world);
    for (const a of ['red', 'blue'] as const) {
      const hive = bb.hives[a];
      if (hive.tipping > 0) return false;
      /**
       * ⚠️ WHICH TRAY IS THIS? `angle` is written by READBACK and ONLY on the DYNAMIC see-saw
       * (`sim3d/engineImpl.ts` says so in as many words), so its presence is the discriminator
       * — no import out of `sim3d/`, and a 2D world, a 2D-era replay and a snapshot all read as
       * the timer tray, which is what they are.
       *
       * THE TIMER TRAY owes a tip when the calibrated LOAD TABLE says so: `hiveTimerStep` will
       * start the swing on the next tick, so the clock has to wait for it.
       *
       * THE DYNAMIC TRAY OWES ONE WHEN ITS OWN TORQUE BALANCE SAYS SO, and that is not a table
       * — it is whether the detent broke. Asking `hiveWillTip` of a see-saw resting on its stop
       * was asking the wrong model: a cell holding 8 POLLEN that the physics did NOT tip
       * answered "a tip is due" on every tick forever, and the match finalized on the cap every
       * single time a cell was loaded at the buzzer (measured, seed 99: 601 ticks of it, with
       * `tipping` flat at 0). A tray at rest on a stop HAS come to rest in the only state it
       * has — §10.5 A is satisfied — so the test is its angular speed and nothing else.
       */
      if (hive.angle === undefined) {
        if (hiveWillTip(hiveLoad(hive.contents, kindOf))) return false;
      } else if (Math.abs(hive.angVel ?? 0) >= BB3_HIVE_REST_W) {
        return false;
      }
    }
  }
  return robotsAtRest(world);
}
