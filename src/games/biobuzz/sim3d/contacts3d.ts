import type { Alliance, World } from '../../../types';
import { BB3_REST_SPEED } from '../config';
import { bbBillG409 } from '../penalties';
import { GROUP_TRAY } from './bodies';
import type { Engine3d } from './engineImpl';
import type { Rapier3d } from './engine';

/**
 * BIOBUZZ 3D PHYSICS — THE ONE RULE THAT IS ABOUT TOUCHING SOMETHING (Day 2, plan §3.6).
 *
 * **G409** — "a ROBOT may not catch SCORING ELEMENTS spilling from a TIPPED HIVE" — is a
 * CONTACT rather than a position, and it could not be asked in the 2D pipeline at all: the 2D
 * spill is `spillPoses`, a scatter of positions the tray HANDS to the tiles; nothing flies, so
 * there is no "first thing it touched" to catch. `penalties.ts` has always recorded it as "not
 * modelled (spill lands on tiles)".
 *
 * ⚠️ **3D-ONLY, AND THE 2D PIPELINE IS BYTE-IDENTICAL BECAUSE OF HOW.** The rule is not
 * implemented here in terms of "the offence happened"; it writes a PLAIN JSON FACT onto
 * `world.biobuzz` (`spill`) and `penalties.ts` bills from it. A 2D world never gets that field
 * written, so the same penalty loop finds nothing and does nothing, exactly the way it already
 * treats an absent `physics` tag.
 *
 * **G417** (meddling with the HIVE, including ramming its frame) used to live here too — this
 * file wrote `bb.hiveRam` from the solve's own contact pairs, and `penalties.ts` billed a MAJOR
 * from it. It is REMOVED entirely (owner ruling, 2026-09-19: every HIVE-ramming penalty is gone
 * from both pipelines), so `hiveRam` no longer exists on `world.biobuzz` and this file no
 * longer reads a HIVE FRAME collider at all — the group discriminator below is the TRAY alone.
 *
 * ── DETERMINISM ─────────────────────────────────────────────────────────────────────────────
 * Rapier's contact pairs come back in whatever order the narrow phase holds them, which is a
 * solver-internal ordering this lane does not get to assume anything about. G409 iterates the
 * SPILLED ELEMENTS in ascending id and takes the first robot contact each one has, which is a
 * question with one answer however the pairs are enumerated. Nothing here appends to a list
 * whose order could differ between two peers.
 */

/** which collider group a collider belongs to — the discriminator `bodies.ts` already had to
 * introduce so a dynamic tray would not wedge in its own frame, reused here rather than a second
 * handle set kept in step with it. */
function groupsOf(collider: { collisionGroups(): number }): number {
  return collider.collisionGroups();
}

/**
 * ONE PASS over the 3D solve's contact pairs, after the step, filling `bb.spill` and billing
 * G409 where a robot caught a spilling element.
 *
 * Runs in `step3d.ts` between the readback and the gameplay stage: the contact set is the one
 * the step just resolved, and the JSON positions it is read against are the ones the readback
 * just wrote, so the two halves of every judgement are from the same instant.
 */
export function hiveContactPass(world: World, engine: Engine3d): void {
  const bb = world.biobuzz;
  if (!bb) return;

  // ── G409: a spilled element's FIRST non-tray contact ──────────────────────────────────────
  const spill = bb.spill;
  if (!spill) return;
  const byBody = new Map<number, number>();
  for (const [id, body] of engine.robots) byBody.set(body.handle, id);
  const elementBodies = new Set<number>();
  for (const body of engine.elements.values()) elementBodies.add(body.handle);
  for (const key of Object.keys(spill).map(Number).sort((a, b) => a - b)) {
    const alliance: Alliance = spill[key];
    const body = engine.elements.get(key);
    if (!body) {
      delete spill[key]; // captured, or gone: the tag has nothing left to describe
      continue;
    }
    let touched = false;
    let onTray = false;
    let caughtBy: number | null = null;
    for (let i = 0; i < body.numColliders(); i++) {
      const own = body.collider(i);
      engine.world3d.contactPairsWith(own, (other) => {
        // the TRAY is not a "first contact": the element is still in the cell it is leaving.
        if (groupsOf(other) === GROUP_TRAY) {
          onTray = true;
          return;
        }
        const parent = other.parent();
        const robot = parent ? byBody.get(parent.handle) : undefined;
        if (robot !== undefined) {
          touched = true;
          if (caughtBy === null || robot < caughtBy) caughtBy = robot;
          return;
        }
        /**
         * ⚠️ **ANOTHER ELEMENT IS NOT A FIRST CONTACT EITHER**, and leaving that out made the
         * whole rule unobservable. A cell holds its load as a PILE — the eight POLLEN of the
         * field guide's own calibration row are stacked two deep and touching — so on the very
         * tick the detent breaks, every tagged element is already in contact with its
         * neighbours. Counting those cleared all eight tags before anything had moved, and a
         * robot parked directly under the mouth caught four of them to a score of zero.
         * A spill is one event; its own members are part of it.
         */
        if (parent && elementBodies.has(parent.handle)) return;
        touched = true;
      });
    }
    /**
     * AND A TAG EXPIRES WHEN THE ELEMENT COMES TO REST, whatever it is resting on. Without that
     * an element that lands on a PILE of untagged ground elements and never quite reaches a
     * static keeps its tag for the rest of the match, and a robot that drives into it a minute
     * later is billed for catching a spill that finished falling long ago. "Spilling" is a
     * moment, and this is where the moment ends.
     *
     * ⚠️ **EXCEPT WHILE IT IS STILL ON THE TRAY** — the same fact that makes the tray not a
     * first contact makes it not a resting place: an element sitting in the cell it is leaving
     * has not finished spilling, it has not started. And it reads AT REST there, twice over:
     * the tag is written on the tick the detent breaks, when the load is still stacked against
     * the back wall at a dead stop, and `groundRoll3d`'s off-floor snap then pins anything that
     * dips under `BB3_REST_SPEED` mid-swing to exactly zero in the WORLD frame while the tray
     * rotates under it. Measured on seed 871 (8 POLLEN, dynamic tray): all eight tags were
     * written on tick 13 and every one of them was deleted by tick 16, with the elements still
     * 48 in up and ~35 ticks from the tiles — so G409 could not be billed by any robot, wherever
     * it parked. Tray contact holds the moment open until the element is actually clear of it.
     */
    const el = world.balls.find((b) => b.id === key);
    const atRest = el ? Math.abs(el.vel.x) + Math.abs(el.vel.y) + Math.abs(el.vz) < BB3_REST_SPEED : true;
    if (!touched && (onTray || !atRest)) continue;
    if (caughtBy !== null) bbBillG409(world, alliance, caughtBy);
    delete spill[key];
  }
  if (Object.keys(spill).length === 0) delete bb.spill;
}

/** the collider type, narrowed for the callbacks above — `contactPairsWith` hands back a
 * `Collider` and nothing here needs more of it than its groups and its parent body. */
export type Collider3d = InstanceType<Rapier3d['Collider']>;
