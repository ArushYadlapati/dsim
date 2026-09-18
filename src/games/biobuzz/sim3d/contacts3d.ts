import type { Alliance, World } from '../../../types';
import { BB3_REST_SPEED } from '../config';
import { BB_FRAME_RAM_SPEED, bbBillG409 } from '../penalties';
import { GROUP_FRAME, GROUP_TRAY } from './bodies';
import type { Engine3d } from './engine';
import type { Rapier3d } from './engine';

/**
 * BIOBUZZ 3D PHYSICS — THE TWO RULES THAT ARE ABOUT TOUCHING SOMETHING (Day 2, plan §3.6).
 *
 * G409 and G417 are the only BIOBUZZ rules whose subject is a CONTACT rather than a position,
 * and neither of them could be asked in the 2D pipeline at all:
 *
 *  · **G409** — "a ROBOT may not catch SCORING ELEMENTS spilling from a TIPPED HIVE". The 2D
 *    spill is `spillPoses`, a scatter of positions the tray HANDS to the tiles; nothing flies,
 *    so there is no "first thing it touched" to catch. `penalties.ts` has always recorded it as
 *    "not modelled (spill lands on tiles)".
 *  · **G417** — "ROBOTS may not manipulate the motion of the HIVE in any way other than by
 *    LAUNCHING". It is OFF in 2D by owner ruling (2026-09-13) for a reason that was true and no
 *    longer is: no robot could move the hive, so every award was a major charged for an outcome
 *    the simulation could not produce. Under the DYNAMIC see-saw the tray is a body a 29-in
 *    chassis reaches, so the rule comes back — for this pipeline only.
 *
 * ⚠️ **BOTH ARE 3D-ONLY, AND THE 2D PIPELINE IS BYTE-IDENTICAL BECAUSE OF HOW.** Neither rule is
 * implemented here in terms of "the offence happened"; each writes a PLAIN JSON FACT onto
 * `world.biobuzz` (`spill`, `hiveRam`) and `penalties.ts` bills from it. A 2D world never gets
 * those fields written, so the same penalty loop finds nothing and does nothing, exactly the way
 * it already treats an absent `physics` tag.
 *
 * ── DETERMINISM ─────────────────────────────────────────────────────────────────────────────
 * Rapier's contact pairs come back in whatever order the narrow phase holds them, which is a
 * solver-internal ordering this lane does not get to assume anything about. Everything below is
 * therefore ORDER-INSENSITIVE by construction: G417 keeps the LARGEST closing speed per robot
 * (a max, not a first), and G409 iterates the SPILLED ELEMENTS in ascending id and takes the
 * first robot contact each one has, which is a question with one answer however the pairs are
 * enumerated. Nothing here appends to a list whose order could differ between two peers.
 */

/** which collider group a collider belongs to — the discriminator `bodies.ts` already had to
 * introduce so a dynamic tray would not wedge in its own frame, reused here rather than a second
 * handle set kept in step with it. */
function groupsOf(collider: { collisionGroups(): number }): number {
  return collider.collisionGroups();
}

/** is this collider part of a HIVE (either tray or frame)? The two are the whole of "the HIVE"
 * for G417: Table 10-4's example A is "ramming into the HIVE frame at high-speed", and the tray
 * is the half a tall robot can actually move. */
function isHiveCollider(groups: number): boolean {
  return groups === GROUP_TRAY || groups === GROUP_FRAME;
}

/**
 * ONE PASS over the 3D solve's contact pairs, after the step, filling `bb.spill` and
 * `bb.hiveRam` and billing G409 where a robot caught a spilling element.
 *
 * Runs in `step3d.ts` between the readback and the gameplay stage: the contact set is the one
 * the step just resolved, and the JSON positions it is read against are the ones the readback
 * just wrote, so the two halves of every judgement are from the same instant.
 */
export function hiveContactPass(world: World, engine: Engine3d): void {
  const bb = world.biobuzz;
  if (!bb) return;

  // ── G417: which robots hit a HIVE, and how hard ───────────────────────────────────────────
  // Rebuilt from scratch every tick — it is a read of what is touching right now, and the
  // "once per MATCH per ROBOT" half of the rule is `bb.held[robot].g417billed`, where it has
  // always lived. A latch here would be a second, redundant memory of the same fact.
  const ram: Record<number, number> = {};
  for (const r of world.robots) {
    if (r.passive) continue;
    const body = engine.robots.get(r.id);
    if (!body) continue;
    let worst = 0;
    for (let i = 0; i < body.numColliders(); i++) {
      const own = body.collider(i);
      engine.world3d.contactPairsWith(own, (other) => {
        if (!isHiveCollider(groupsOf(other))) return;
        /**
         * CLOSING SPEED ALONG THE CONTACT NORMAL, not the robot's speed — the same distinction
         * the 2D `frameRam` makes and for the same reason: "a robot driving fast ALONG the
         * structure is not ramming it, and a slow deliberate shove would fail a plain speed test
         * while being exactly the thing the rule is about" (`penalties.ts`). In 3D the normal is
         * the manifold's own, which is the honest version of the 2D detector's guess at which
         * bar FACE the robot was against.
         */
        engine.world3d.contactPair(own, other, (manifold, flipped) => {
          if (manifold.numContacts() === 0) return;
          const n = manifold.normal();
          // `normal` points out of the FIRST shape; `flipped` says the pair was stored the other
          // way round. Either way we want it pointing out of the ROBOT, so a robot moving ALONG
          // it is moving away and scores zero.
          const s = flipped ? -1 : 1;
          const closing = -(r.vel.x * n.x * s + r.vel.y * n.y * s);
          if (closing > worst) worst = closing;
        });
      });
    }
    if (worst >= BB_FRAME_RAM_SPEED) ram[r.id] = Math.round(worst * 10000) / 10000;
  }
  if (Object.keys(ram).length > 0) bb.hiveRam = ram;
  else if (bb.hiveRam) delete bb.hiveRam;

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
    let caughtBy: number | null = null;
    for (let i = 0; i < body.numColliders(); i++) {
      const own = body.collider(i);
      engine.world3d.contactPairsWith(own, (other) => {
        // the TRAY is not a "first contact": the element is still in the cell it is leaving.
        if (groupsOf(other) === GROUP_TRAY) return;
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
     */
    const el = world.balls.find((b) => b.id === key);
    const atRest = el ? Math.abs(el.vel.x) + Math.abs(el.vel.y) + Math.abs(el.vz) < BB3_REST_SPEED : true;
    if (!touched && !atRest) continue;
    if (caughtBy !== null) bbBillG409(world, alliance, caughtBy);
    delete spill[key];
  }
  if (Object.keys(spill).length === 0) delete bb.spill;
}

/** the collider type, narrowed for the callbacks above — `contactPairsWith` hands back a
 * `Collider` and nothing here needs more of it than its groups and its parent body. */
export type Collider3d = InstanceType<Rapier3d['Collider']>;
