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
 * See the paragraphs below; each names the run that found it.
 */
export function bbSettled(world: World): boolean {
  for (const b of world.balls) {
    /**
     * ⚠️ **THE TAG DECIDES NOTHING; THE VELOCITY DOES.** Both directions of getting this wrong
     * have shipped, and the pair of them is why the test is shaped exactly like this.
     *
     * 1. **DO NOT `return false` ON A TAG.** Under 3D physics `flight` is DERIVED every tick
     *    (`sim3d/derive.ts`), and it used to mean "not in a cell or a tube, and off the tiles"
     *    — so an element at rest on the hive frame, a tray's outer face or a spilled pile was
     *    permanently `flight`, and refusing on the tag alone held the clock open for the whole
     *    10 s cap with the field visibly still (seed 7: eight elements parked at z 43.9,
     *    unchanged for 600 ticks). That is the owner's "takes forever when nothing is moving".
     *    `derive.ts` calls a rested off-the-tiles element `ground` now, but the rule stands on
     *    its own: this function must never read a tag as a claim about motion.
     *
     * 2. **DO NOT SKIP A TAG EITHER.** The test used to run only for `flight` and `ground`,
     *    which was harmless while an element bouncing in a CELL was tagged `flight` the whole
     *    way down. Since cell membership became GEOMETRY (`BB3_CELL_SEAT_DEPTH`, 2026-09-19) it
     *    is tagged `element` from the tick its centre is seated, so a ball still bouncing in a
     *    tray was skipped entirely and held nothing — measured, `vz` 83.6 in/s inside the cell
     *    with the old test answering "settled". That is a SCORING outcome: the settle clock is
     *    when the match is called, and "a tray over its calibrated load is a TIP when the match
     *    is called", so a tip that was one bounce away could be missed; a latched element that
     *    bounces back out of the interior would also change `contents` after the call.
     *
     * So: MOTION, for every element that has a position on the field. `held` and `stock` are
     * the two that do not — a held element is inside a robot and a stock element is off the
     * field, neither is solved, and **nothing writes either one a velocity**, so their `vel`
     * is a leftover rather than a reading. Measured across 4 seeds × 165 s of four HARD bots
     * under BOTH pipelines: every `held` and every `stock` ball read exactly 0.000, so the
     * exemption changes no outcome today — it is here so that a future capture path that
     * forgets to zero `vel` cannot hang the clock on a number that means nothing. It is the
     * same exemption, for the same reason, that `decodeSettled` spells out.
     *
     * WHY DROPPING THE GATE DOES NOT BRING (1) BACK: `derive.ts`'s REST SNAP holds a settled
     * element's velocity at EXACTLY zero for as long as it keeps reading at rest, and it has
     * no tag gate of its own. Sampled 400 ticks past visual stillness over nine end-of-match
     * states — a loaded tray in three packings (7 POLLEN guide, 7 POLLEN crammed up the back
     * wall, 2 POLLEN + 3 NECTAR two-wide), a crammed flower column, elements dropped onto the
     * hive frame, a landed spill, the default seated field, and across a swing — every
     * `element`-tagged ball read maxV 0.0000 and max|vz| 0.0000. Nothing jitters, because the
     * snap re-zeroes it every qualifying tick rather than once. Post-buzzer finalize over
     * eight full bot-driven 3D matches was tick-for-tick identical before and after (31–35
     * ticks, 0.52–0.58 s), and the nine staged states above likewise (31–452 ticks, the 452
     * being the swing the clock is supposed to wait for); the cap is 600.
     *
     * A ball genuinely in the air is above this threshold except within a tick of its apex, and
     * the clock needs `MATCH_SETTLE_HOLD_S` of unbroken quiet, so a lob still holds it open.
     */
    if (b.state.kind === 'held' || b.state.kind === 'stock') continue;
    if (movingFaster(b.vel, BALL_REST_SPEED)) return false;
    if (Math.abs(b.vz) >= BALL_REST_SPEED) return false;
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
       * THE DYNAMIC TRAY IS ASKED ITS ANGULAR SPEED AND NOTHING ELSE, and it stays that way even
       * though it now tips on the SAME table (`sim3d/hive3d.ts`, 2026-09-19 — the trigger moved
       * from a torque balance to `BB_TIP_POLLEN` so the HUD's "N MORE TO TIP" cannot be a lie).
       * Re-asking the table here would look right and would reintroduce the hang. The original
       * measurement is what this test exists for: a cell the physics did not tip answered "a tip
       * is due" on every tick forever and the match
       * finalized on the cap every time a cell was loaded at the buzzer (seed 99: 601 ticks of
       * it, `tipping` flat at 0). A tray at rest on a stop HAS come to rest in the only state it
       * has — §10.5 A is satisfied — so the test is motion, like every other test in this file.
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
