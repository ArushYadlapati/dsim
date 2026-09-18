import type { Alliance, Vec2 } from '../../types';
import {
  BB_FLOWER_LOW_Z,
  BB_FLOWER_MID_Z as BB_FLOWER_MID_Z_CAD,
  BB_FLOWER_OPEN_R,
  BB_FLOWER_TOP_Z,
  BB_NECTAR_R,
  BB_POLLEN_R,
  BB_PTS,
} from './config';

/**
 * FLOWER logic — the stack model (§9.7 Fig 9-12, §10.5.2 Fig 10-5), PURE.
 *
 * A FLOWER is a vertical tube on the perimeter wall. Elements enter through the 4.0-in top
 * ring and stack bottom → top; POLLEN (2.8) can be pulled out of the 3.55-in retrieval opening
 * at the bottom, NECTAR (3.6) cannot. Nothing here reads or writes `World`: every function
 * takes the stack (a list of element ids, bottom first) plus the two lookups the world owns —
 * what colour an id is and how big it is — and returns a value. `play.ts` wires it after the
 * T0+2h sync; `scripts/smoke-biobuzz/field.ts` drives it directly.
 *
 * Every number the manual prints is imported from `config.ts`. The ones it does not print are
 * module-local and marked APPROX below, so the move into `config.ts` is a one-line import change.
 */

/** what an element IS, for scoring: a POLLEN, or a NECTAR of one alliance. */
export type BbElementKind = 'pollen' | Alliance;

/** the FLOWER's runtime state — field-plan §2 shape, declared locally until `state.ts` carries it. */
export interface FlowerState {
  /** element ids, BOTTOM → TOP */
  stack: number[];
}

/** radius (in) of an element by kind, §9.8 */
export function bbElementRadius(kind: BbElementKind): number {
  return kind === 'pollen' ? BB_POLLEN_R : BB_NECTAR_R;
}

/**
 * Top face of the LOWER ring, where the bottom element rests in the 2D stack model.
 *
 * ✅ CAD SINCE 2026-09-18 — `BB_FLOWER_LOW_Z` (`config.ts` ← `fieldDims.gen.ts`), the lower
 * plate's own measured top face at 0.354. It was 0.43 `APPROX`, a Fig 9-12 pixel read, 0.076
 * high. The alias stays so every existing caller and check keeps its name.
 *
 * ⚠️ The CAD's lower bore is 3.222, not Fig 9-12's 2.79, so it is the LOWER ring rather than the
 * middle one that a NECTAR (3.6) cannot pass — and a POLLEN (2.8) passes it too, which means in
 * the real tube a bottom pollen rests on the TILES inside the bore rather than on this face,
 * 0.354 in lower. Immaterial to every outcome: the scoring volume starts 3.55 in above either
 * height. `sim3d/` does not use this constant at all — a 3D flower's contents are where the
 * bodies are.
 */
export const BB_FLOWER_FLOOR_Z = BB_FLOWER_LOW_Z;

/**
 * THE MIDDLE RING IS A SORTER — its hole falls BETWEEN the two element sizes (owner ruling
 * 2026-09-12, field-plan §2.2, from the visuals chat's section drawing). A 2.8-in POLLEN passes
 * it and falls through to the lower ring; a 3.6-in NECTAR cannot and SEATS on it.
 *
 * The consequences are the whole point of the ruling: a NECTAR is never below the scoring floor
 * and therefore ALWAYS scores, a lone POLLEN resting on the lower ring (0.43 → 3.23) scores
 * nothing, and retrieving a POLLEN from UNDER a ring-seated NECTAR does not lower the NECTAR.
 *
 * ✅ CAD SINCE 2026-09-18 — `BB_FLOWER_MID_Z` (`config.ts` ← `fieldDims.gen.ts`), the middle
 * plate's own measured UNDERSIDE at 3.904. It was 3.98 `APPROX` (the retrieval opening 3.55 plus
 * a 0.43 lower ring), i.e. the same quantity 0.076 high, and the SEAT rule is exactly what made
 * that move safe: every outcome here is a consequence of "the nectar sits ON the ring" rather
 * than of 3.98 happening to land 0.05 in below where a floor-resting nectar's skin reached.
 * Re-checked after the move: capacities still 8 POLLEN / 5 NECTAR, Fig 10-5 cases A–H all equal.
 *
 * ⚠️ **AND THE CAD SAYS THE REAL MIDDLE RING DOES NOT SORT.** Its measured bore is 3.896
 * (`BB_FLOWER_MID_HOLE`) against a 3.6-in NECTAR, so the real plate passes one. The 2026-09-12
 * sorter ruling is a GAMEPLAY decision — it is what makes a nectar always score and a pollen
 * retrievable from under one — and it STANDS for this model, which is the permanent 2D pipeline.
 * The 3D tube (`sim3d/flowerTube.ts`) is the real plates with the real bores and does whatever
 * they do: a nectar falls past both upper rings and comes to rest on the LOWER one, which is
 * the ring whose 3.222 bore actually sorts. Two models, one field, and the difference is
 * measured and written down rather than fudged away at either end — audit §11.
 */
export const BB_FLOWER_MID_Z = BB_FLOWER_MID_Z_CAD;

/**
 * The SCORING VOLUME: between the top ring and the middle ring (§10.5.2, CAD 10-4), i.e. from
 * `BB_FLOWER_MID_Z` up. APPROX — field-plan §1 `BB_FLOWER_VOL_Z`, not yet in `config.ts`.
 */
export const BB_FLOWER_VOL_Z: readonly [number, number] = [BB_FLOWER_MID_Z, BB_FLOWER_TOP_Z]; // APPROX

/**
 * How far above the top ring a descending element may still be taken as "entering" — the
 * backstop is 1.25 in tall, and a lob arrives from above. APPROX.
 */
export const BB_FLOWER_ENTRY_MARGIN = 3.0; // APPROX

/**
 * Centre heights (in) of every element in the stack, bottom → top.
 *
 * Each element rests on the one below it, EXCEPT that a NECTAR can never sit lower than the
 * middle ring it cannot pass — `max(columnTop, BB_FLOWER_MID_Z) + r`. That single `max` is the
 * sorter: below the ring only POLLEN can be in the column at all, so a NECTAR arriving over an
 * empty flower or over one POLLEN lands on the ring either way, and the POLLEN under it is in a
 * space the nectar was never resting on. Everything above a seated NECTAR stacks on it as
 * before, so the rest of the column is unchanged.
 *
 * THE COLUMN TOP ADVANCES TO THE SEATED CENTRE, not past the element it skipped: a nectar on
 * the ring occupies `MID_Z … MID_Z + 2r`, and what rests on it starts there. Adding `2 * r` to
 * the OLD top instead would leave a phantom gap the size of whatever the nectar cleared.
 */
export function flowerStackZ(stack: readonly number[], kindOf: (id: number) => BbElementKind): number[] {
  const out: number[] = [];
  let top = BB_FLOWER_FLOOR_Z;
  for (const id of stack) {
    const kind = kindOf(id);
    const r = bbElementRadius(kind);
    // a NECTAR is any ALLIANCE kind; 'pollen' is the only thing that passes the ring
    const seat = kind === 'pollen' ? top : Math.max(top, BB_FLOWER_MID_Z);
    out.push(seat + r);
    top = seat + 2 * r;
  }
  return out;
}

/** is an element with centre `z` and radius `r` at least PARTIALLY inside the scoring volume? */
export function flowerInVolume(z: number, r: number): boolean {
  return z + r > BB_FLOWER_VOL_Z[0] && z - r < BB_FLOWER_VOL_Z[1];
}

/**
 * Would one more element of radius `r` FIT on this stack? Fills while the new element's centre
 * would be below `BB_FLOWER_TOP_Z + r` — i.e. while it would still be partially inside the
 * volume (field-plan §2.2; Fig 10-5 D/H — a nectar held on the backstop still counts). That
 * condition is `top + r < TOP_Z + r`, so the radius cancels: the test is whether the stack's
 * current top is below the ring. `_r` stays in the signature because a caller has it in hand
 * and a later, stricter rule (a full-diameter fit) would need it.
 */
export function flowerFits(stack: readonly number[], kindOf: (id: number) => BbElementKind, _r: number): boolean {
  const zs = flowerStackZ(stack, kindOf);
  const top = zs.length === 0 ? BB_FLOWER_FLOOR_Z : zs[zs.length - 1] + bbElementRadius(kindOf(stack[stack.length - 1]));
  return top < BB_FLOWER_TOP_Z;
}

/**
 * How TALL this stack stands — the top of its highest element, or the lower ring when empty.
 * The one place that knows a seated NECTAR raised the column, so `spawn.ts` can place a staged
 * stack's `z` values through the same function the scorer reads them from.
 */
export function flowerStackTop(stack: readonly number[], kindOf: (id: number) => BbElementKind): number {
  const zs = flowerStackZ(stack, kindOf);
  if (zs.length === 0) return BB_FLOWER_FLOOR_Z;
  return zs[zs.length - 1] + bbElementRadius(kindOf(stack[stack.length - 1]));
}

/**
 * How many SAME-KIND elements an empty FLOWER holds.
 *
 * BY KIND, NOT BY RADIUS, AND FILLED THROUGH `flowerFits` — because the column's heights are no
 * longer `floor + n * diameter` for both sizes. The middle-ring seat lifts the FIRST nectar to
 * `BB_FLOWER_MID_Z` (3.55 in above the lower ring), and that clearance costs the column a whole
 * nectar: six by the old arithmetic, five by the geometry. A capacity helper with its own copy
 * of the stacking rule would go on saying six.
 */
export function flowerCapacity(kind: BbElementKind): number {
  const kindOf = (): BbElementKind => kind;
  const r = bbElementRadius(kind);
  const stack: number[] = [];
  while (flowerFits(stack, kindOf, r) && stack.length < 64) stack.push(stack.length);
  return stack.length;
}

/**
 * GEOMETRIC entry test — TOP entry only. A flight element whose (x, y) is within
 * `BB_FLOWER_OPEN_R` of the ring centre, whose height is at the top ring (within the entry
 * margin above, one radius below) and which is DESCENDING. Capacity is `flowerFits`, checked
 * by the caller, so a full flower rejects for a reason the HUD can name.
 */
export function flowerAccepts(flower: Vec2, pos: Vec2, z: number, vz: number, r: number = BB_POLLEN_R): boolean {
  if (vz >= 0) return false;
  const dx = pos.x - flower.x;
  const dy = pos.y - flower.y;
  if (dx * dx + dy * dy > BB_FLOWER_OPEN_R * BB_FLOWER_OPEN_R) return false;
  return z >= BB_FLOWER_TOP_Z - r && z <= BB_FLOWER_TOP_Z + BB_FLOWER_ENTRY_MARGIN;
}

/**
 * RETRIEVAL (G418.B): pop the BOTTOM element, and only if it is POLLEN — a NECTAR is 3.6 in
 * and the retrieval opening is 3.55, so a nectar at the bottom LOCKS the flower. Returns the
 * new stack and the id taken (`null` ⇒ nothing came out, stack unchanged).
 */
export function flowerRetrieve(
  stack: readonly number[],
  kindOf: (id: number) => BbElementKind,
): { stack: number[]; id: number | null } {
  if (stack.length === 0 || kindOf(stack[0]) !== 'pollen') return { stack: [...stack], id: null };
  return { stack: stack.slice(1), id: stack[0] };
}

export interface FlowerScore {
  /** alliance of the TOP-MOST NECTAR inside the scoring volume; `null` ⇒ nobody owns it */
  owner: Alliance | null;
  /** `BB_PTS.owned` per element inside the volume, to the owner; 0 when unowned */
  ownerPts: number;
  /** alliance of the BOTTOM-MOST NECTAR inside the scoring volume; `null` ⇒ no bonus */
  bonusAlliance: Alliance | null;
  /** `BB_PTS.bottomNectar` when `bonusAlliance` is set */
  bonusPts: number;
  /** elements at least partially inside the scoring volume */
  inVolume: number;
}

/**
 * §10.5.2 / Fig 10-5: elements score when at least partially inside the volume. Owner = alliance
 * of the top-most scoring NECTAR, earning 2 per scoring element whoever placed it. Bottom NECTAR
 * Bonus 5 to the alliance of the bottom-most scoring NECTAR. No nectar ⇒ no owner, no bonus.
 */
export function flowerScore(stack: readonly number[], kindOf: (id: number) => BbElementKind): FlowerScore {
  return flowerScoreZ(stack, kindOf, flowerStackZ(stack, kindOf));
}

/**
 * §10.5.2 OVER HEIGHTS SOMEBODY ELSE MEASURED — the same rule, reading `zs` instead of modelling
 * them. A PURE EXTRACTION: `flowerScore` above is now a call to this with `flowerStackZ`'s own
 * answer, so the 2D pipeline is byte-for-byte what it was.
 *
 * It exists because the 3D pipeline HAS the heights. A flower's contents there are real bodies
 * in a real tube (`sim3d/flowerTube.ts`), and their z is the readback, not a model — so a scorer
 * that re-derived them from `flowerStackZ` would be scoring a picture of the stack rather than
 * the stack. That difference is not academic on this field: the CAD's middle bore is 3.896 and a
 * NECTAR is 3.6, so where the 2D model seats a lone nectar ON the middle ring the real tube lets
 * it fall to the bottom (`BB_FLOWER_MID_Z`'s own comment, audit §11), and the two answers differ
 * by five points and an ownership.
 *
 * `zs[i]` is element `stack[i]`'s CENTRE height. A short `zs` scores only what it covers.
 */
export function flowerScoreZ(
  stack: readonly number[],
  kindOf: (id: number) => BbElementKind,
  zs: readonly number[],
): FlowerScore {
  let inVolume = 0;
  let owner: Alliance | null = null;
  let bonusAlliance: Alliance | null = null;
  for (let i = 0; i < stack.length; i++) {
    const kind = kindOf(stack[i]);
    if (!flowerInVolume(zs[i], bbElementRadius(kind))) continue;
    inVolume++;
    if (kind === 'pollen') continue;
    if (bonusAlliance === null) bonusAlliance = kind;
    owner = kind; // last one seen in volume wins: the stack is bottom → top
  }
  return {
    owner,
    ownerPts: owner ? inVolume * BB_PTS.owned : 0,
    bonusAlliance,
    bonusPts: bonusAlliance ? BB_PTS.bottomNectar : 0,
    inVolume,
  };
}
