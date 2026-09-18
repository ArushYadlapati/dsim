import type { Artifact, RobotCommand, RobotState, World } from '../../../types';
import type { BiobuzzState } from '../state';
import type { BbElementKind } from '../flower';
import { bbElementRadius } from '../flower';
import { BB_FLOWERS, BB_FLOWER_RETRIEVE_S, FLOWER_RING_Z, bbHopperCap } from '../config';
import { capturePollen, takeHeld } from '../elements';
import { bbLiftOf } from '../mechs';
import { bbFlowerAtIntake } from '../play';
import { bbFlowerInReach } from '../robot';
import { flowerAtRetrieval } from './flowerTube';

/**
 * BIOBUZZ 3D PHYSICS — FLOWERS (Day 2, `docs/biobuzz/plan-3d.md` §3.7).
 *
 * THE STATICS are not here: the supports are CAD hulls built with every other static
 * (`bodies.ts`) and the three RING PLATES are trimeshes built by `flowerTube.ts`. This file
 * owns the GAMEPLAY half — placement and retrieval — and the whole of it is now different from
 * Day 1 in one way:
 *
 * ⚠️ **THE COLUMN IS PHYSICS, NOT BOOKKEEPING.** Day 1 called the 2D `placeInFlower` and
 * `retrieveFromFlower` outright, because a flower element was a FIXED body parked at whatever
 * height `flowerStackZ` modelled, and those two functions owned that height. The tube is real
 * now, so:
 *
 *  • **PLACE** drops the element at the top ring with zero velocity and lets it fall. Where it
 *    stops is the bores' business, and on this field's measurements that is NOT where the 2D
 *    model says (a NECTAR clears the 3.896 middle bore and lands on the lower plate — see
 *    `flowerTube.ts`'s header). Nothing here re-seats it afterwards.
 *  • **RETRIEVE** pops the element `derive.ts` has ordered LOWEST, if it is a POLLEN and if it
 *    is actually down at the retrieval opening. Nothing re-seats the column either: the elements
 *    above simply fall, which is what happens when you pull the bottom one out of a tube.
 *
 * What is REUSED, deliberately, is every gate that is a rule rather than a height: the Box Tube
 * reach test (`bbFlowerInReach`), the intake-mouth test (`bbFlowerAtIntake`), the hopper cap,
 * G418.B's "POLLEN only", and the `BB_FLOWER_RETRIEVE_S` pacing. Those are the same in both
 * pipelines because they are the same rules.
 */

export { bbFlowerAtIntake };

/**
 * THE DROP POINT: the element's CENTRE starts at the top plate's own UNDERSIDE, on the bore
 * axis, at rest. §3.7's words are "dropped at the top ring with zero velocity", and this is the
 * highest point that is honestly inside the ring.
 *
 * ⚠️ **NOT ABOVE THE PLATE, AND THE BACKSTOP IS WHY.** `Flower Backstop` is a real part and a
 * real collider: measured, its hull is a 0.25-in plate at z 22.40 … 22.65 whose field-side face
 * passes **0.375 in from the tube's axis**. An element created resting ON the top plate has its
 * centre at 21.4 + r and its own cross-section at the backstop's height is wider than that 0.375,
 * so it starts INTERPENETRATING the backstop and the solver's first act is to shove it sideways
 * — measured, 0.94 in for a POLLEN and 1.36 in for a NECTAR, which is enough to wedge it on the
 * ring's rim instead of dropping it down the bore. Starting one radius lower puts the whole
 * element inside the bore, clear of everything, which is also what a Box Tube depositing into a
 * tube actually does.
 *
 * The highest centre that clears the backstop is 21.05 for a POLLEN and 20.64 for a NECTAR
 * (`sqrt(r² − 0.375²)` below 22.40); the top plate's underside, 20.254, is below both with room
 * to spare and is a MEASURED feature rather than a number tuned against that arithmetic.
 */
const PLACE_CENTRE_Z = FLOWER_RING_Z.top[0];

/**
 * Is there ROOM in flower `i` for one more element of radius `r`?
 *
 * A PHYSICAL test, not `flowerFits`: that helper answers the question against the 2D stacking
 * MODEL, and the 3D column's heights are the bodies' own. The column is full when something
 * already occupies the space the new element would be created in — i.e. when any element in the
 * tube reaches above the drop point's underside. That is the same rule `flowerFits` expresses
 * ("does the stack's top clear the ring"), asked of the stack that actually exists.
 */
function flowerHasRoom3d(world: World, bb: BiobuzzState, i: number, r: number, kindOf: (id: number) => BbElementKind): boolean {
  const dropBottom = PLACE_CENTRE_Z - r;
  for (const id of bb.flowers[i].stack) {
    const b = world.balls.find((x) => x.id === id);
    if (!b) continue;
    const top = b.z + 2 * (b.r ?? bbElementRadius(kindOf(id)));
    if (top > dropBottom) return false;
  }
  return true;
}

/**
 * PLACE one held element of the named kind into the FLOWER this robot's Box Tube is in reach of,
 * by DROPPING it at the top ring. Returns whether it happened; every refusal is an ordinary
 * outcome (no Box Tube, no flower in reach, nothing of that kind in the hopper, the column
 * already reaches the ring).
 *
 * The element is tagged `element`/`flower:i` immediately so `engine.ts` keeps its body and
 * `derive.ts` reads it as part of that tube from the next tick; the `slot` written here is a
 * placeholder that `derive.ts` overwrites by height on that same tick.
 */
export function flowerPlace3d(
  world: World,
  bb: BiobuzzState,
  rob: RobotState,
  nectar: boolean,
  kindOf: (id: number) => BbElementKind,
): boolean {
  if (!bbLiftOf(rob.spec)) return false;
  const i = bbFlowerInReach(world, rob);
  if (i === null) return false;
  let color: Artifact['color'] | null = null;
  for (let j = rob.hopper.length - 1; j >= 0; j--) {
    const c = rob.hopper[j];
    if ((c === 'red' || c === 'blue') === nectar) {
      color = c;
      break;
    }
  }
  if (color === null) return false;
  const kind: BbElementKind = color === 'red' || color === 'blue' ? color : 'pollen';
  const r = bbElementRadius(kind);
  if (!flowerHasRoom3d(world, bb, i, r, kindOf)) return false;
  const ball = takeHeld(world, rob, color);
  if (!ball) return false;
  const f = BB_FLOWERS[i];
  ball.state = { kind: 'element', el: `flower:${i}`, slot: 0 };
  ball.pos.x = f.x;
  ball.pos.y = f.y;
  ball.z = PLACE_CENTRE_Z - r;
  ball.vel.x = 0;
  ball.vel.y = 0;
  ball.vz = 0;
  return true;
}

/**
 * RETRIEVE off a FLOWER's bottom opening — G418.B: a ROBOT may "only remove POLLEN from the
 * bottom of a FLOWER".
 *
 * Same gates as the 2D pipeline (a running intake, a mouth on the retrieval opening, hopper
 * room, one per `BB_FLOWER_RETRIEVE_S` off `lastIntakeAt`), and one extra that only a physical
 * column can ask: the candidate has to BE at the opening (`flowerAtRetrieval`, the 0.354 … 3.904
 * band the plates leave between them). In the 2D model "bottom of the stack" and "at the
 * opening" are the same statement; here they are not, because a column of two can have its
 * lowest element halfway up the tube while the one under it is still falling.
 *
 * A NECTAR at the bottom LOCKS the flower exactly as it does in 2D, and for the same reason
 * measured rather than assumed: a 3.6-in nectar passes neither the 3.222-in lower bore nor the
 * 3.550-in opening.
 */
export function flowerRetrieve3d(
  world: World,
  bb: BiobuzzState,
  rob: RobotState,
  cmd: RobotCommand | undefined,
  enabled: boolean,
  ballById: ReadonlyMap<number, Artifact>,
  kindOf: (id: number) => BbElementKind,
): boolean {
  if (!enabled || !(rob.autoIntake || (cmd?.intake ?? false))) return false;
  if (world.time - rob.lastIntakeAt < BB_FLOWER_RETRIEVE_S) return false;
  if (rob.hopper.length >= bbHopperCap(rob.spec)) return false;
  const i = bbFlowerAtIntake(rob);
  if (i === null) return false;
  const stack = bb.flowers[i].stack;
  if (stack.length === 0) return false;
  const id = stack[0]; // `derive.ts` orders the stack bottom to top by the bodies' own heights
  if (kindOf(id) !== 'pollen') return false;
  const ball = ballById.get(id);
  if (!ball) return false;
  if (!flowerAtRetrieval(ball.z + (ball.r ?? bbElementRadius('pollen')))) return false;
  const was = ball.state;
  ball.state = { kind: 'ground' };
  if (!capturePollen(world, rob, ball)) {
    ball.state = was; // refused (an intake rule said no): the element never left the FLOWER
    return false;
  }
  // NOTHING RE-SEATS THE COLUMN. `retrieveFromFlower`'s 2D twin re-slots and re-computes every
  // remaining element's `z` from `flowerStackZ`, because in that model the stack IS the column.
  // Here the elements above are real bodies that were resting on this one: they fall, and
  // `derive.ts` re-reads the order next tick.
  bb.flowers[i].stack = stack.slice(1);
  return true;
}
