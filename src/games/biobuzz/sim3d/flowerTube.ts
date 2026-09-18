import type { Rapier3d } from './engine';
import { datan2, dcos, dsin } from '../../../math';
import {
  BB_FLOWERS,
  BB_FLOWER_OPEN_R,
  BB_FLOWER_RETRIEVE_Z,
  BB_FLOWER_TOP_Z,
  BB_NECTAR_R,
  BB3_FLOWER_RING_SEGMENTS,
} from '../config';
import { cadFlowerRings, type FieldFlowerRing } from './fieldColliders';

/**
 * BIOBUZZ 3D PHYSICS — THE FLOWER TUBE (Day 2, `docs/biobuzz/plan-3d.md` §3.7).
 *
 * A FLOWER is a vertical tube on the perimeter wall: three horizontal PLATES with circular
 * bores, held apart by four HIPS pipes and closed on the wall side by the backstop extrusion.
 * The pipes, the backstop and the brackets have been colliders since Day 1 (`flower_support`
 * hulls, `bodies.ts`). The PLATES were not, and the reason was written next to the rule in
 * `convert.py`: **a convex hull of an annulus fills its own centre hole**, which is exactly the
 * opening an element passes through, so exporting one would have sealed the tube.
 *
 * That is a fact about HULLS. This file stops asking for one: each plate is a
 * RECTANGLE-MINUS-DISC TRIMESH, tessellated here from the eleven numbers `convert.py` measured
 * (`FieldFlowerRing`). The rectangle is the plate's own measured footprint and the disc is its
 * own least-squares bore, so the collider an element meets is the plate the GLB draws.
 *
 * ── WHAT THE REAL BORES DO, WHICH IS NOT WHAT THE 2D MODEL SAYS ─────────────────────────────
 *
 *   plate    band (in)          bore Ø   POLLEN 2.8   NECTAR 3.6
 *   top      20.254 … 21.404    4.171    passes       passes
 *   mid       3.904 …  5.254    3.896    passes       **passes**
 *   lower    −0.199 …  0.354    3.222    passes       STOPPED
 *
 * So a dropped NECTAR falls past BOTH upper plates and comes to rest on the LOWER one; a
 * dropped POLLEN clears all three and rests on the tiles inside the lower bore. The manual's
 * INTENT survives intact — G418's "POLLEN out of the bottom and nothing else" holds, because a
 * nectar clears neither the 3.222 bore nor the 3.550-in retrieval opening — but the ring that
 * delivers it is the BOTTOM one, not the middle one. The 2D pipeline's sorter ruling (owner,
 * 2026-09-12: a nectar seats on the MIDDLE ring) is a gameplay decision and it stands for that
 * model; nothing here is fudged to agree with it. See `config.ts`'s `BB_FLOWER_MID_HOLE` and
 * `docs/biobuzz/field-cad-audit.md` §11.
 *
 * ── WHY A TRIMESH AND NOT A COMPOUND OF WEDGES ──────────────────────────────────────────────
 * A ring is genuinely non-convex, so it is either one trimesh or a fan of convex boxes. The
 * trimesh is ONE collider per plate with the true bore; a fan is N colliders per plate whose
 * inner faces are chords, i.e. a bore that is polygonal by construction AND N times the
 * broad-phase work. `TriMeshFlags.FIX_INTERNAL_EDGES` is what makes the trimesh behave as a
 * surface rather than as a bag of triangles: without it a sphere rolling across the plate's top
 * face catches on every shared edge it crosses.
 */

/** one tessellated plate, ready for `RAPIER.ColliderDesc.trimesh`. */
export interface RingMesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

/**
 * Tessellate one plate as a closed, outward-oriented rectangle-minus-disc prism.
 *
 * `BB3_FLOWER_RING_SEGMENTS` rays leave the bore centre at even angles; the four RECTANGLE
 * CORNERS are inserted as extra rays so the outer boundary is the true rectangle rather than a
 * polygon that cuts its corners off. Each ray carries four vertices (inner/outer × bottom/top)
 * and each pair of adjacent rays contributes eight triangles: top face, bottom face, bore wall,
 * outer wall.
 *
 * ⚠️ **THE BORE IS INSCRIBED, SO THE HOLE IS A HAIR SMALL, AND THAT IS THE SAFE DIRECTION.**
 * The polygon's apothem is `r·cos(π/N)`, which at N = 32 is 0.15 % — 0.010 in off the 2.086-in
 * top bore. Circumscribing instead would make every hole 0.010 in WIDE, and a hole that is
 * slightly too generous is the one failure mode this geometry cannot recover from: an element
 * that should have been stopped is through, and nothing puts it back. The clearances it has to
 * preserve are 0.148 in (a NECTAR through the mid bore) and 0.211 in (a POLLEN through the
 * lower bore), both an order of magnitude above the error.
 *
 * Returns `null` for a plate whose bore is not strictly inside its own rectangle — impossible
 * on this field's measurements (the tightest margin is 0.215 in) and a fail-safe rather than a
 * fail-open if a future revision changes that: no collider beats a wrong one.
 */
export function ringTrimesh(ring: FieldFlowerRing, segments: number = BB3_FLOWER_RING_SEGMENTS): RingMesh | null {
  const [cx, cy] = ring.bore;
  const [x0, x1] = ring.rect.x;
  const [y0, y1] = ring.rect.y;
  const [zLo, zHi] = ring.z;
  const r = ring.hole;
  const margin = Math.min(cx - x0, x1 - cx, cy - y0, y1 - cy);
  if (!(margin > r)) return null;

  // the ray angles: `segments` even steps plus the four corners, sorted, de-duplicated.
  const angles: number[] = [];
  for (let i = 0; i < segments; i++) angles.push((i * 2 * Math.PI) / segments);
  for (const [px, py] of [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ] as const) {
    // `datan2`, never the engine's own inverse trig — `scripts/smoke.ts`'s source guard scans
    // this directory for exactly that, and it is right to: an engine's transcendentals are not
    // required to be correctly-rounded, so two peers can compute different bits from one input.
    //
    // ⚠️ **WRAPPED INTO [0, 2π) FIRST, AND THAT LINE IS THE WHOLE CORRECTNESS OF THIS MESH.**
    // `atan2` answers in (−π, π] while the even steps above are in [0, 2π), so a corner in the
    // third quadrant sorts BEFORE every even step instead of between two of them. The ring then
    // closes from a ray at ~350° back to one at ~−126°, and the two triangles bridging that gap
    // sweep straight across the bore — measured, they put geometry 1.08 in from the tube's axis
    // where the nearest real surface is 2.09, so a POLLEN bounced off the middle of the hole and
    // a NECTAR jammed in the top one. Both looked exactly like "the bore is too small".
    angles.push((datan2(py - cy, px - cx) + 2 * Math.PI) % (2 * Math.PI));
  }
  angles.sort((a, b) => a - b);
  const rays = angles.filter((a, i) => i === 0 || a - angles[i - 1] > 1e-9);

  const verts: number[] = [];
  for (const a of rays) {
    const ux = dcos(a);
    const uy = dsin(a);
    // the outer point: the slab distance from the bore centre to the rectangle along this ray.
    const tx = ux > 0 ? (x1 - cx) / ux : ux < 0 ? (x0 - cx) / ux : Infinity;
    const ty = uy > 0 ? (y1 - cy) / uy : uy < 0 ? (y0 - cy) / uy : Infinity;
    const t = Math.min(tx, ty);
    verts.push(cx + ux * r, cy + uy * r, zLo); // 0 inner bottom
    verts.push(cx + ux * r, cy + uy * r, zHi); // 1 inner top
    verts.push(cx + ux * t, cy + uy * t, zLo); // 2 outer bottom
    verts.push(cx + ux * t, cy + uy * t, zHi); // 3 outer top
  }

  const n = rays.length;
  const idx: number[] = [];
  const IB = (i: number) => 4 * i;
  const IT = (i: number) => 4 * i + 1;
  const OB = (i: number) => 4 * i + 2;
  const OT = (i: number) => 4 * i + 3;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    // top face (+z outward)
    idx.push(IT(i), OT(i), OT(j), IT(i), OT(j), IT(j));
    // bottom face (−z outward): the same quad, wound the other way
    idx.push(IB(i), OB(j), OB(i), IB(i), IB(j), OB(j));
    // the BORE wall, normals pointing INTO the hole
    idx.push(IB(i), IT(i), IT(j), IB(i), IT(j), IB(j));
    // the OUTER wall, normals pointing away from the bore
    idx.push(OB(i), OB(j), OT(j), OB(i), OT(j), OT(i));
  }
  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
}

/**
 * Build every FLOWER's three ring plates into `world3d` — one fixed body per flower, three
 * trimesh colliders on it, in `BB_FLOWERS` order then bottom-to-top (determinism: the same
 * build order rule every other static follows).
 *
 * Friction is the same `PHYS_WALL_FRICTION` the supports take; restitution 0, because a plate
 * is the surface an element has to COME TO REST on and a bouncy one turns a placed nectar into
 * a ball rattling down a 21-in tube.
 */
export function buildFlowerTubes3d(
  RAPIER: Rapier3d,
  world3d: InstanceType<Rapier3d['World']>,
  friction: number,
): number {
  let built = 0;
  for (let i = 0; i < BB_FLOWERS.length; i++) {
    const rings = cadFlowerRings(i);
    if (rings.length === 0) continue;
    const body = world3d.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const ring of rings) {
      const mesh = ringTrimesh(ring);
      if (!mesh) continue;
      const desc = RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES);
      if (!desc) continue;
      world3d.createCollider(desc.setFriction(friction).setRestitution(0), body);
      built++;
    }
  }
  return built;
}

// ---------------------------------------------------------------------------------------------
// MEMBERSHIP — which FLOWER's tube an element is in, for `derive.ts`
// ---------------------------------------------------------------------------------------------

/**
 * How far ABOVE `BB_FLOWER_TOP_Z` an element's CENTRE may sit and still be read as "in the
 * tube". Fig 10-5's case D/H is a NECTAR held on the BACKSTOP above the top ring, partially
 * inside the scoring volume and therefore scoring — so a band that stopped at the top plate
 * would drop exactly the case the figure exists to name. One nectar DIAMETER is the height a
 * nectar resting on top of a full column reaches.
 */
export const FLOWER_TUBE_TOP_MARGIN = 2 * BB_NECTAR_R;

/** the bottom of the tube's membership band — the lower plate's own underside, so an element
 * resting on the TILES inside the lower bore (which is what a POLLEN does: the bore is 3.222
 * and a pollen is 2.8) is still in the flower rather than loose on the floor. */
export const FLOWER_TUBE_BOTTOM_Z = -1;

/**
 * Which FLOWER's tube contains the point `(x, y, zCentre)`, or `null`.
 *
 * The test is the BORE, not the plate: an element is in the tube when it is within the top
 * plate's own bore radius of the flower's axis and its centre is between the lower plate's
 * underside and one nectar-diameter above the top plate. `BB_FLOWER_OPEN_R` (the top bore) is
 * the widest of the three, so an element passing any plate is inside this cylinder by
 * construction, and an element on the TILES beside the flower is 2.6 in outside it.
 *
 * Deliberately NOT a read of the physics contact set: membership is a question about WHERE a
 * body is, the same way `derive.ts`'s cell test is, and a contact-based answer would flicker on
 * the tick an element is in free fall between two plates.
 */
export function flowerTubeOf(x: number, y: number, zCentre: number): number | null {
  if (zCentre < FLOWER_TUBE_BOTTOM_Z || zCentre > BB_FLOWER_TOP_Z + FLOWER_TUBE_TOP_MARGIN) return null;
  for (let i = 0; i < BB_FLOWERS.length; i++) {
    const f = BB_FLOWERS[i];
    const dx = x - f.x;
    const dy = y - f.y;
    if (dx * dx + dy * dy <= BB_FLOWER_OPEN_R * BB_FLOWER_OPEN_R) return i;
  }
  return null;
}

/** is this element's centre inside the RETRIEVAL OPENING's own z band (`BB_FLOWER_RETRIEVE_Z`,
 * 0.354 … 3.904)? G418.B's bottom-pop takes the lowest POLLEN, and "lowest" has to mean "low
 * enough to actually be at the opening" once the column is a physical stack. */
export function flowerAtRetrieval(zCentre: number): boolean {
  return zCentre >= BB_FLOWER_RETRIEVE_Z[0] && zCentre <= BB_FLOWER_RETRIEVE_Z[1];
}
