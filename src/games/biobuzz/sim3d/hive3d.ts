import type { Alliance, World } from '../../../types';
import { BB_HIVE_TILT_DEG } from '../config';
import { BB_TIP_SWING_S, hiveTimerStep } from '../hive';
import { bbKindIndex } from '../score';

/**
 * BIOBUZZ 3D PHYSICS -- the hive TIMER over a KINEMATIC tray (Day 1, `docs/biobuzz/plan-3d.md`
 * section 3.6's fallback: `BB3_HIVE_DYNAMIC = false`).
 *
 * The TIP is still a TIMER (`hiveTimerStep`, extracted from `../hive.ts`'s `hiveStep` -- see
 * that file's header for why the split is a pure extraction). The SPILL is not: there is no
 * `spillPoses` call here and no manual position write. The kinematic tray physically rotates
 * (`hiveTiltAngle` below feeds `engine.ts`'s `applyHiveTilt`), and every element resting inside
 * the cell that is now tipping is a REAL body sitting on a REAL floor that is tilting out from
 * under it -- it slides and falls out the open face because gravity says so, the same way a real
 * elements would. `derive.ts` then simply stops finding it inside the cell box and re-tags it
 * `ground`/`flight` on whatever tick it actually leaves, which is the "after a swing, derive
 * empties the cell because the bodies left it" rule this lane's brief calls for.
 */

const ALLIANCES: readonly Alliance[] = ['red', 'blue'];

/**
 * The hive's tilt, in RADIANS about the world X axis, RIGHT NOW -- `sign * rest` at either
 * stable end, sweeping through 0 (level) at the swing's midpoint. DUPLICATES the formula
 * `src/games/biobuzz/drawField.ts`'s `tipProjection(tipping)` uses for the 2D renderer's
 * foreshortening (that file is a 2D-renderer file and is not edited by this lane); the two must
 * stay in step because a 2D VIEW over a 3D-physics world (plan section 2.2) reads the SAME
 * `world.biobuzz.hives` this function reads, from a different angle on the same swing.
 *
 * `sign` is `+1` when `hive.up === 'north'`, `-1` when `'south'` -- the convention `bodies.ts`'s
 * local (v, w) frame is built against (a `north` cell lives at `v > 0`). Before the swing
 * starts and after it completes, `hive.up` already names whichever side IS up (a completed
 * swing flips it in `hiveTimerStep`), so `sign * rest` is correct at both ends without special-
 * casing "just tipped".
 */
export function hiveTiltAngle(world: World, alliance: Alliance): number {
  const rest = (BB_HIVE_TILT_DEG * Math.PI) / 180;
  const hive = world.biobuzz?.hives[alliance];
  if (!hive) return rest;
  const sign = hive.up === 'north' ? 1 : -1;
  if (!(hive.tipping > 0)) return sign * rest;
  // identical to `tipProjection`'s `p`/`tilt` -- see that function for the derivation.
  const p = Math.min(1, Math.max(0, 1 - hive.tipping / BB_TIP_SWING_S));
  const tilt = rest * (1 - 2 * p);
  return sign * tilt;
}

/**
 * The shared TIP timer, run over whatever `derive.ts` has ALREADY written into
 * `hives[a].contents` this tick (physically-derived membership, not a capture event) --
 * `step3d.ts`'s gameplay stage calls this AFTER `derive.ts` and it must stay that way, or the
 * timer reads last tick's membership.
 *
 * Unlike the 2D `hiveStep`, this NEVER writes `contents`: physics owns it (via `derive.ts`), so
 * this timer only ever touches `tipping`/`released`/`tips`/`up`/`swingRate`. The one entitlement
 * side-effect the 2D pipeline gives a TIP -- one NECTAR earned (`nectarDue`) -- lands here too,
 * since it is bookkeeping, not a position write.
 */
export function hive3dTick(world: World, dt: number): void {
  const bb = world.biobuzz;
  if (!bb) return;
  const kindOf = bbKindIndex(world);
  for (const a of ALLIANCES) {
    const hive = bb.hives[a];
    const contents = hive.contents; // this tick's DERIVED membership -- never overwritten below
    const r = hiveTimerStep(hive, dt, kindOf);
    bb.hives[a] = { ...r.hive, contents };
    if (r.releasing) {
      world.events.push(`${a.toUpperCase()} HIVE SPILLS ${contents.length}`);
    }
    if (r.tipped) {
      bb.nectarDue[a] += 1;
      world.events.push(`${a.toUpperCase()} HIVE TIP`);
    }
  }
}
