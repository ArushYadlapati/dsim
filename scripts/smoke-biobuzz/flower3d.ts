import type { Check } from './harness';
import { cmd, mkWorld3d, setup } from './harness';
import { step3d } from '../../src/games/biobuzz/sim3d/step3d';
import { createBiobuzzWorld } from '../../src/games/biobuzz/spawn';
import { engineFor } from '../../src/games/biobuzz/sim3d/engineImpl';
import { cadFlowerRings } from '../../src/games/biobuzz/sim3d/fieldColliders';
import { ringTrimesh, flowerTubeOf, flowerAtRetrieval } from '../../src/games/biobuzz/sim3d/flowerTube';
import { flowerPlace3d, flowerRetrieve3d } from '../../src/games/biobuzz/sim3d/flower3d';
import { engineFor } from '../../src/games/biobuzz/sim3d/engineImpl';
import { bbPlacePointLocal } from '../../src/games/biobuzz/robot';
import { PHYS_ALLOWED_ERROR, PHYS_LENGTH_UNIT } from '../../src/config';
import {
  BB3_FLOWER_RING_SEGMENTS,
  BB_FLOWERS,
  BB_FLOWER_LOW_HOLE,
  BB_FLOWER_LOW_Z,
  BB_FLOWER_MID_HOLE,
  BB_FLOWER_MID_Z,
  BB_FLOWER_RETRIEVE_Z,
  BB_FLOWER_TOP_Z,
  BB_NECTAR_R,
  BB_POLLEN_R,
  FLOWER_RING_Z,
} from '../../src/games/biobuzz/config';
import { flowerCapacity, flowerScore, flowerScoreZ, flowerStackZ, type BbElementKind } from '../../src/games/biobuzz/flower';
import type { Artifact, World } from '../../src/types';

/**
 * FLOWER3D — the real TUBE (Day 2 lane A, `docs/biobuzz/plan-3d.md` §9).
 *
 * The plan's lane spec: "pollen through the middle ring, nectar seats; owner and bottom bonus by
 * z equal the shared `flowerScore` over the derived stack; retrieval pops the lowest pollen;
 * G410 on entry" — plus this brief's own "a 0.25-in ring plate stops a dropped element".
 *
 * ⚠️ **ONE OF THOSE SENTENCES IS NOT WHAT THE CAD SAYS, AND THE LANE ASSERTS THE CAD.** "Pollen
 * through the middle ring, nectar seats" is the 2D pipeline's SORTER RULING (owner, 2026-09-12),
 * written before anyone had measured the plate: the real middle bore is 3.896 against a 3.6-in
 * NECTAR, so it passes, and the real LOWER bore is 3.222 against Fig 9-12's printed 2.79, so a
 * POLLEN passes that too. Both kinds end up on the tiles inside the bottom bore. The manual's
 * INTENT survives — G418's "POLLEN out of the bottom and nothing else" holds, because a nectar
 * clears neither the lower bore nor the 3.550-in retrieval opening — but the ring that delivers
 * it is the bottom one. The checks below pin the MEASURED outcome and print the divergence from
 * the model; `docs/biobuzz/field-cad-audit.md` §11 is the write-up.
 */

const F = 0; // F1, the left wall — every flower is the same geometry, point-symmetric

function drop(w: World, i: number, kind: 'pollen' | 'nectar', id: number, color?: Artifact['color']): Artifact {
  const f = BB_FLOWERS[i];
  const r = kind === 'pollen' ? BB_POLLEN_R : BB_NECTAR_R;
  const el = {
    id,
    color: color ?? (kind === 'pollen' ? 'yellow' : 'blue'),
    state: { kind: 'element', el: `flower:${i}`, slot: 0 },
    pos: { x: f.x, y: f.y },
    vel: { x: 0, y: 0 },
    z: FLOWER_RING_Z.top[0] - r,
    vz: 0,
    r,
  } as Artifact;
  w.balls.push(el);
  return el;
}

const kindOfIn = (w: World) => (id: number): BbElementKind => {
  const b = w.balls.find((x) => x.id === id);
  if (!b) return 'pollen';
  return b.color === 'red' || b.color === 'blue' ? b.color : 'pollen';
};
const realZ = (w: World, ids: readonly number[]): number[] =>
  ids.map((id) => {
    const b = w.balls.find((x) => x.id === id);
    return b ? b.z + (b.r ?? BB_POLLEN_R) : 0;
  });

export function flower3dChecks(check: Check): void {
  // ---- the plates the CAD exported, and what fits through each -------------------------------
  {
    const rings = cadFlowerRings(F);
    check('the CAD exports three ring plates per FLOWER', rings.length === 3, `${rings.length}: ${rings.map((r) => r.id).join(',')}`);
    for (const ring of rings) {
      const mesh = ringTrimesh(ring);
      check(
        `ring ${ring.id}: the rectangle-minus-disc trimesh tessellates (bore ${(ring.hole * 2).toFixed(3)} at z ${ring.z[0]}..${ring.z[1]})`,
        mesh !== null && mesh.indices.length / 3 === 8 * (BB3_FLOWER_RING_SEGMENTS + 4),
        mesh ? `${mesh.vertices.length / 3} verts, ${mesh.indices.length / 3} tris` : 'NULL (the bore is not inside its own plate)',
      );
    }
    console.log(
      `[smoke-bb flower3d] bores: top ${(cadFlowerRings(F)[2].hole * 2).toFixed(3)} · mid ${BB_FLOWER_MID_HOLE} · lower ${BB_FLOWER_LOW_HOLE}; ` +
        `POLLEN 2.8, NECTAR 3.6; retrieval opening ${(BB_FLOWER_RETRIEVE_Z[1] - BB_FLOWER_RETRIEVE_Z[0]).toFixed(3)} tall (Fig 9-12 prints 3.55)`,
    );
    /**
     * THE MEASUREMENT THE WHOLE LANE TURNS ON, asserted as arithmetic rather than as behaviour so
     * a re-measured CAD breaks it here, with both numbers in the message, instead of three checks
     * further down as "the nectar ended up somewhere else".
     */
    check(
      'the CAD middle bore PASSES a NECTAR — the 2D sorter ruling is a model, not this geometry',
      BB_FLOWER_MID_HOLE > 2 * BB_NECTAR_R,
      `mid bore ${BB_FLOWER_MID_HOLE} vs a ${2 * BB_NECTAR_R}in NECTAR (clearance ${(BB_FLOWER_MID_HOLE - 2 * BB_NECTAR_R).toFixed(3)})`,
    );
    check(
      'the CAD lower bore STOPS a NECTAR and passes a POLLEN — it is the ring that sorts',
      BB_FLOWER_LOW_HOLE < 2 * BB_NECTAR_R && BB_FLOWER_LOW_HOLE > 2 * BB_POLLEN_R,
      `lower bore ${BB_FLOWER_LOW_HOLE}: NECTAR ${2 * BB_NECTAR_R} stopped, POLLEN ${2 * BB_POLLEN_R} passes`,
    );
    check(
      "the retrieval opening is Fig 9-12's 3.55 in, derived from two independently measured plates",
      Math.abs(BB_FLOWER_RETRIEVE_Z[1] - BB_FLOWER_RETRIEVE_Z[0] - 3.55) < 0.005,
      `${(BB_FLOWER_RETRIEVE_Z[1] - BB_FLOWER_RETRIEVE_Z[0]).toFixed(4)} = mid underside ${BB_FLOWER_MID_Z} − lower top ${BB_FLOWER_LOW_Z}`,
    );
  }

  // ---- what an element DOES in the tube, by kind ---------------------------------------------
  for (const kind of ['pollen', 'nectar'] as const) {
    const w = mkWorld3d('free', kind === 'pollen' ? 900 : 901);
    w.balls.length = 0;
    const el = drop(w, F, kind, 1);
    for (let t = 0; t < 400; t++) step3d(w, 1 / 60, new Map());
    const r = el.r ?? BB_POLLEN_R;
    const centre = el.z + r;
    const lateral = Math.hypot(el.pos.x - BB_FLOWERS[F].x, el.pos.y - BB_FLOWERS[F].y);
    console.log(
      `[smoke-bb flower3d] a lone ${kind} dropped at the top ring settles at centre ${centre.toFixed(3)} ` +
        `(spans ${el.z.toFixed(3)}..${(el.z + 2 * r).toFixed(3)}), ${lateral.toFixed(3)} off the axis`,
    );
    check(
      `a dropped ${kind} falls to the TILES inside the bottom bore — both kinds clear all three plates`,
      Math.abs(centre - r) < 0.3,
      `centre ${centre.toFixed(3)}, expected ~${r}`,
    );
    check(
      `a dropped ${kind} is in the FLOWER's derived stack`,
      w.biobuzz!.flowers[F].stack.length === 1 && w.biobuzz!.flowers[F].stack[0] === 1,
      `stack ${JSON.stringify(w.biobuzz!.flowers[F].stack)}`,
    );
    check(
      `flowerTubeOf agrees the ${kind} is in tube ${F}`,
      flowerTubeOf(el.pos.x, el.pos.y, centre) === F,
      `got ${flowerTubeOf(el.pos.x, el.pos.y, centre)}`,
    );
  }

  // ---- the 2D model and the 3D column, compared ON PURPOSE ----------------------------------
  //
  // `flowerScore` is the shared rule over the MODEL's heights and stays the scoring authority for
  // both pipelines ("one scoring, one HUD, two physics", plan §3.5). `flowerScoreZ` is the same
  // rule over the heights the bodies actually have. Where they agree, that is one less thing to
  // worry about; where they disagree, the disagreement is a MEASUREMENT and is printed.
  {
    const rows: { what: string; kinds: ('pollen' | 'nectar')[]; colors: Artifact['color'][] }[] = [
      { what: '4 staged POLLEN', kinds: ['pollen', 'pollen', 'pollen', 'pollen'], colors: ['yellow', 'yellow', 'yellow', 'yellow'] },
      { what: '4 POLLEN + a blue NECTAR', kinds: ['pollen', 'pollen', 'pollen', 'pollen', 'nectar'], colors: ['yellow', 'yellow', 'yellow', 'yellow', 'blue'] },
      { what: 'a lone blue NECTAR', kinds: ['nectar'], colors: ['blue'] },
    ];
    for (const [ri, row] of rows.entries()) {
      const w = mkWorld3d('free', 910 + ri);
      w.balls.length = 0;
      for (const [i, kind] of row.kinds.entries()) {
        drop(w, F, kind, i + 1, row.colors[i]);
        for (let t = 0; t < 90; t++) step3d(w, 1 / 60, new Map()); // one at a time, as a robot places them
      }
      for (let t = 0; t < 300; t++) step3d(w, 1 / 60, new Map());
      const stack = w.biobuzz!.flowers[F].stack;
      const kindOf = kindOfIn(w);
      const zs = realZ(w, stack);
      const model = flowerScore(stack, kindOf);
      const real = flowerScoreZ(stack, kindOf, zs);
      console.log(
        `[smoke-bb flower3d] ${row.what}: stack ${JSON.stringify(stack)} real z [${zs.map((z) => z.toFixed(2)).join(', ')}] · ` +
          `model owner=${model.owner} inVol=${model.inVolume} · real owner=${real.owner} inVol=${real.inVolume}`,
      );
      check(
        `${row.what}: every element that went in is in the derived stack, ordered bottom to top`,
        stack.length === row.kinds.length && zs.every((z, i) => i === 0 || z >= zs[i - 1] - 1e-6),
        `${stack.length}/${row.kinds.length}, z [${zs.map((z) => z.toFixed(2)).join(', ')}]`,
      );
      if (ri < 2) {
        check(
          `${row.what}: the MODEL and the real column agree on owner, bonus and count`,
          model.owner === real.owner && model.bonusAlliance === real.bonusAlliance && model.inVolume === real.inVolume,
          `model ${model.owner}/${model.bonusAlliance}/${model.inVolume} vs real ${real.owner}/${real.bonusAlliance}/${real.inVolume}`,
        );
      } else {
        /**
         * ⚠️ THE ONE ROW WHERE THEY DIVERGE, PINNED AS A MEASUREMENT. A lone NECTAR tops out at
         * 3.60 on the tiles against a scoring floor of 3.904, so by the real geometry it does not
         * score; the 2D model seats it ON the middle ring at 3.904…7.504 and it always does. The
         * divergence is 0.30 in and it is worth 2 + 5 points and an ownership.
         *
         * `score.ts` reads `flowerScore`, so BOTH pipelines score it the model's way and a 2D and
         * a 3D match are worth the same — which is the plan's "one scoring, one HUD, two physics"
         * and the reason this is a measurement rather than a bug. Changing it is an owner ruling
         * (the 2026-09-12 sorter ruling is what would be overturned), and this check is what will
         * fail the day somebody does.
         */
        check(
          'a lone NECTAR is where the 2D MODEL and the real tube disagree — measured, not fudged',
          model.inVolume === 1 && real.inVolume === 0,
          `model ${model.inVolume} in volume (seated on the middle ring), real ${real.inVolume} ` +
            `(tops out at ${(zs[0] + BB_NECTAR_R).toFixed(3)} against a floor of ${BB_FLOWER_MID_Z})`,
        );
      }
    }
  }

  // ---- no tunnelling: a 260 in/s shot onto the SOLID plate is stopped ------------------------
  //
  // `BB3_CCD_SPEED` turns CCD on above 60 in/s, and the plates are 0.55 to 1.35 in thick. The
  // shot is aimed 3.6 in off the axis — the ball's NEAREST point is 2.2 from the axis, outside
  // the 2.086 top bore, so every part of it is over solid plate and there is no hole to slip into.
  {
    for (const speed of [120, 260]) {
      const w = mkWorld3d('free', 920 + speed);
      w.balls.length = 0;
      const f = BB_FLOWERS[F];
      w.balls.push({
        id: 1,
        color: 'yellow',
        state: { kind: 'flight', target: 'blue' },
        pos: { x: f.x + 3.6, y: f.y },
        vel: { x: 0, y: 0 },
        z: 40,
        vz: -speed,
        r: BB_POLLEN_R,
      } as Artifact);
      for (let t = 0; t < 400; t++) step3d(w, 1 / 60, new Map());
      const b = w.balls[0];
      const lateral = Math.hypot(b.pos.x - f.x, b.pos.y - f.y);
      check(
        `no tunnelling: a ${speed} in/s POLLEN onto the solid top plate is DEFLECTED, not passed`,
        lateral > 4,
        `ended ${lateral.toFixed(1)}in from the axis at z ${(b.z + BB_POLLEN_R).toFixed(2)} (plate top ${BB_FLOWER_TOP_Z})`,
      );
    }
  }

  // ---- retrieval: the lowest POLLEN, and only when it is at the opening ----------------------
  {
    const w = mkWorld3d('free', 930);
    w.balls.length = 0;
    drop(w, F, 'pollen', 1);
    for (let t = 0; t < 90; t++) step3d(w, 1 / 60, new Map());
    drop(w, F, 'pollen', 2);
    for (let t = 0; t < 300; t++) step3d(w, 1 / 60, new Map());
    const stack = [...w.biobuzz!.flowers[F].stack];
    const zs = realZ(w, stack);
    check('retrieval fixture: two POLLEN are stacked in the tube', stack.length === 2, `${stack.length}`);
    check(
      'the LOWEST element is the one at the retrieval opening',
      stack.length === 2 && flowerAtRetrieval(zs[0]) && !flowerAtRetrieval(zs[1]),
      `z [${zs.map((z) => z.toFixed(2)).join(', ')}] against the opening ${BB_FLOWER_RETRIEVE_Z[0]}..${BB_FLOWER_RETRIEVE_Z[1]}`,
    );
    // drive the real gameplay path: the same gates the 2D pipeline uses, through `flower3d.ts`
    const rob = w.robots[0];
    const ballById = new Map(w.balls.map((b) => [b.id, b] as const));
    // ⚠️ AND THE HOPPER HAS TO BE EMPTIED. `w.balls.length = 0` clears the FIELD but not the
    // robot's own `hopper` array, which G304.G stages with four preloaded POLLEN — and
    // `bbHopperCap` is 4, so the retrieval refused on "no room" while every geometric gate it is
    // actually testing passed. The colours and the balls are two mirrors of one multiset
    // (`elements.ts`), so a fixture that clears one has to clear the other.
    rob.hopper.length = 0;
    rob.lastIntakeAt = -99;
    // park the robot's mouth on the retrieval opening: the foot's field-side face, square on
    const f = BB_FLOWERS[F];
    // the opening's own point is `BB_FLOWER_FOOT.deep - BB_FLOWER_D` (2.384) out from the ring,
    // and `bbFlowerAtIntake` wants it INSIDE a mouth rect — which begins at the footprint's front
    // face, not behind it. Parking flush put the point 0.1 in short of the roller and read as
    // "no flower at the intake"; 1.5 in further out puts it in the middle of the rect.
    rob.pos.x = f.x + 2.384 + rob.spec.length / 2 + 1.5;
    rob.pos.y = f.y;
    rob.heading = Math.PI;
    const took = flowerRetrieve3d(w, w.biobuzz!, rob, cmd({ intake: true }), true, ballById, kindOfIn(w));
    check(
      'retrieval pops the LOWEST POLLEN off the bottom (G418.B)',
      took && w.biobuzz!.flowers[F].stack.length === 1 && w.biobuzz!.flowers[F].stack[0] === stack[1],
      `took=${took} stack ${JSON.stringify(w.biobuzz!.flowers[F].stack)} (was ${JSON.stringify(stack)})`,
    );
  }
  {
    // ...and a NECTAR at the bottom LOCKS the flower, which is the whole of G418's asymmetry.
    const w = mkWorld3d('free', 931);
    w.balls.length = 0;
    drop(w, F, 'nectar', 1);
    for (let t = 0; t < 300; t++) step3d(w, 1 / 60, new Map());
    const rob = w.robots[0];
    // ⚠️ AND THE HOPPER HAS TO BE EMPTIED. `w.balls.length = 0` clears the FIELD but not the
    // robot's own `hopper` array, which G304.G stages with four preloaded POLLEN — and
    // `bbHopperCap` is 4, so the retrieval refused on "no room" while every geometric gate it is
    // actually testing passed. The colours and the balls are two mirrors of one multiset
    // (`elements.ts`), so a fixture that clears one has to clear the other.
    rob.hopper.length = 0;
    rob.lastIntakeAt = -99;
    const f = BB_FLOWERS[F];
    rob.pos.x = f.x + 2.384 + rob.spec.length / 2 + 1.5;
    rob.pos.y = f.y;
    rob.heading = Math.PI;
    const ballById = new Map(w.balls.map((b) => [b.id, b] as const));
    const took = flowerRetrieve3d(w, w.biobuzz!, rob, cmd({ intake: true }), true, ballById, kindOfIn(w));
    check(
      'a NECTAR at the bottom LOCKS the FLOWER — 3.6 in passes neither the 3.222 bore nor the 3.550 opening',
      !took && w.biobuzz!.flowers[F].stack.length === 1,
      `took=${took} stack ${JSON.stringify(w.biobuzz!.flowers[F].stack)}`,
    );
  }

  // ---- G410: a NECTAR entering while entry is locked is a MAJOR, per NECTAR -------------------
  //
  // The rule is a STATE predicate over `flowers[i].stack` (`penalties.ts`), so under the 3D tube
  // it fires on the tick `derive.ts` first reads the nectar as being in the tube — which IS
  // "entry into the scoring cylinder", asked of a real body rather than of a bookkeeping event.
  {
    const w = mkWorld3d('match', 940);
    w.balls.length = 0;
    // TELEOP with more than BB_FLOWER_UNLOCK_S left is exactly `bbNectarLocked` -- and it has to
    // be a LIVE phase, because `updateBiobuzzPenalties` clears its edge map and returns outside
    // one. A 'free' or pre-match world bills nothing at all, which is not the same as passing.
    w.match.phase = 'teleop';
    w.match.phaseTimeLeft = 90;
    const before = w.events.length;
    drop(w, F, 'nectar', 1);
    for (let t = 0; t < 200; t++) {
      w.match.phase = 'teleop';
      w.match.phaseTimeLeft = 90;
      step3d(w, 1 / 60, new Map());
    }
    const lines = w.events.slice(before).filter((e) => e.includes('G410'));
    check(
      'G410: a NECTAR entering a FLOWER before the 1:00 cue is billed, once, on entry',
      lines.length === 1,
      `${lines.length} lines: ${JSON.stringify(lines)}`,
    );
    check(
      'G410: the FLOWER still SCORES it — §10.5.2 says so and the penalty engine does not un-score',
      w.biobuzz!.flowers[F].stack.length === 1,
      `stack ${JSON.stringify(w.biobuzz!.flowers[F].stack)}`,
    );
  }

  // ---- placement: the Box Tube drops at the top ring, and nothing else changes -----------------
  {
    const w = mkWorld3d('free', 950);
    w.balls.length = 0;
    const rob = w.robots[0];
    // the Box Tube rides `spec.bbMech.lift`, the CONTAINER -- there is no flat `bbLift` field
    // (`mechs.ts`: "an absent container means no lift"), and setting one silently gives a robot
    // with no tube, which `placeInFlower` refuses on its first line.
    rob.spec = { ...rob.spec, bbMech: { ...rob.spec.bbMech!, lift: { kind: 'boxtube', mount: 'front' } } };
    const f = BB_FLOWERS[F];
    const local = bbPlacePointLocal(rob.spec)!;
    rob.heading = Math.PI;
    // put the PLACEMENT POINT on the ring: at heading pi the local +x offset lands at -x.
    rob.pos.x = f.x + local.x;
    rob.pos.y = f.y - local.y;
    rob.hopper = ['yellow'];
    w.balls.push({
      id: 1,
      color: 'yellow',
      state: { kind: 'held', robot: rob.id, slot: 0 },
      pos: { x: rob.pos.x, y: rob.pos.y },
      vel: { x: 0, y: 0 },
      z: 0,
      vz: 0,
      r: BB_POLLEN_R,
    } as Artifact);
    const placed = flowerPlace3d(w, w.biobuzz!, rob, false, kindOfIn(w));
    const el = w.balls[0];
    check(
      'placement drops the element AT THE TOP RING with zero velocity (plan §3.7)',
      placed && Math.abs(el.z + BB_POLLEN_R - FLOWER_RING_Z.top[0]) < 1e-6 && el.vz === 0,
      `placed=${placed} centre ${(el.z + BB_POLLEN_R).toFixed(4)} vs the top plate's underside ${FLOWER_RING_Z.top[0]}, vz ${el.vz}`,
    );
    for (let t = 0; t < 300; t++) step3d(w, 1 / 60, new Map());
    check(
      'a placed element then FALLS and seats where the bores let it — nothing parks it',
      w.biobuzz!.flowers[F].stack.length === 1 && el.z < 1,
      `stack ${JSON.stringify(w.biobuzz!.flowers[F].stack)}, z ${el.z.toFixed(3)}`,
    );

    /**
     * ⚠️ UNDER 3D, `b.z` IS THE BODY'S UNDERSIDE — INCLUDING FOR A FLOWER ELEMENT.
     *
     * `scene/renderElements.ts` draws a ball's CENTRE, and it gets it from `b.z + r` for every
     * ball a 3D world solves. It cannot be read headlessly (it poses an `InstancedMesh`), so the
     * convention is pinned here, at the data level, against the authority: the Rapier body's own
     * `translation().z`. The hazard is specifically the PARKED kinds, because the 2D pipeline
     * writes a CENTRE there (`play.ts` parks at `CELL_MID_Z`, `flowerStackZ` returns centre
     * heights) — so a renderer that branches on `state.kind` instead of on the PHYSICS draws one
     * of the two solves a radius wrong, and did: a flower element sunk 1.4–1.8 in into its stack.
     *
     * The tolerance is the READBACK's own quantum, not a fudge: `readback` writes
     * `b.z = round4(t.z - r)`, so the pair can legitimately disagree by half of 1e-4 and by
     * nothing more. A residual larger than that is a different convention, which is the failure
     * this check exists to catch.
     */
    {
      const engine = engineFor(w);
      const body = engine.elements.get(el.id);
      const t = body?.translation();
      const drawn = el.z + (el.r ?? BB_POLLEN_R);
      const resid = t ? Math.abs(drawn - t.z) : Infinity;
      check(
        'a 3D flower element: the DRAWN centre (b.z + r) is the body centre — one z convention per solve',
        !!t && resid <= 5e-5 + 1e-6,
        `drawn ${drawn.toFixed(6)} vs body ${t ? t.z.toFixed(6) : 'NO BODY'} — residual ${resid.toExponential(2)} (readback rounds to 1e-4)`,
      );
    }
  }

  // ---- THE COLUMN IS A PILE, NOT A COMPUTED STACK (owner item 9) ------------------------------
  //
  // The owner's requirement is that elements in a FLOWER "rest on whatever is below them at
  // whatever height that turns out to be, with real contact" — so these checks ask about the
  // heights the bodies ARRIVE at, not about a rule. Everything below is one tube, filled one
  // element at a time the way a Box Tube fills it, then left to settle.
  {
    const cols = (i: number, n: number, seed: number): { w: World; ids: number[]; cs: number[]; gaps: number[] } => {
      const w = mkWorld3d('free', seed);
      w.balls.length = 0;
      for (let k = 0; k < n; k++) {
        drop(w, i, 'pollen', k + 1);
        for (let t = 0; t < 90; t++) step3d(w, 1 / 60, new Map()); // one at a time, as a robot places them
      }
      for (let t = 0; t < 600; t++) step3d(w, 1 / 60, new Map());
      const ids = [...w.biobuzz!.flowers[i].stack];
      const cs = realZ(w, ids);
      return { w, ids, cs, gaps: cs.slice(1).map((z, k) => z - cs[k]) };
    };
    const PITCH = 2 * BB_POLLEN_R; // the ideal centre-to-centre of two touching POLLEN, 2.800

    {
      const { ids, cs, gaps } = cols(F, 4, 960);
      const worst = PITCH - Math.min(...gaps);
      const spread = Math.max(...gaps) - Math.min(...gaps);
      const model = flowerStackZ(ids, () => 'pollen');
      console.log(
        `[smoke-bb flower3d] 4 POLLEN settle at centres [${cs.map((z) => z.toFixed(4)).join(', ')}] · ` +
          `gaps [${gaps.map((z) => z.toFixed(4)).join(', ')}] against the ideal ${PITCH} · worst overlap ${worst.toFixed(4)}in · ` +
          `the 2D MODEL would put them at [${model.map((z) => z.toFixed(4)).join(', ')}]`,
      );
      /**
       * A PILE has UNEQUAL gaps and a computed stack has identical ones, and that is the
       * cheapest honest way to tell them apart. Penetration under a soft contact is
       * load-proportional — the bottom pair carries three balls, the top pair carries one — so
       * the gaps widen going up by construction. Measured today: 2.7355 / 2.7565 / 2.7784, a
       * spread of 0.043 in. Raising the contact stiffness shrinks the spread along with the
       * overlap (at the old shared 12 Hz the same column spread 0.270 in), so the bound is
       * deliberately small — 0.005 in, ~50x the readback's own 1e-4 rounding and well under
       * anything a further stiffening would plausibly leave. It is asking "did anything COMPUTE
       * these", not "is the solver still as soft as it was".
       */
      check(
        'a 4-POLLEN column is a PHYSICAL pile — the gaps are load-proportional, not one pitch',
        gaps.length === 3 && spread > 0.005,
        `gaps [${gaps.map((z) => z.toFixed(4)).join(', ')}], spread ${spread.toFixed(4)}in`,
      );
      check(
        'no element FLOATS: every gap is at or under the touching pitch, and the column is ordered',
        gaps.every((g) => g <= PITCH + 1e-3) && gaps.every((g) => g > 0),
        `gaps [${gaps.map((z) => z.toFixed(4)).join(', ')}] against ${PITCH}`,
      );
      /**
       * ⚠️ AND IT IS NOT THE 2D MODEL'S COLUMN. This is the check that fails the day somebody
       * re-seats a 3D flower element from `flowerStackZ` — the Day 1 behaviour the tube replaced,
       * and the one the owner's item 9 is about.
       *
       * The bound is on the BOTTOM element, because that difference is STRUCTURAL and does not
       * move with the contact stiffness: the 2D model seats its column on a 0.43-in floor
       * constant and puts the first POLLEN's centre at 1.754, while the real tube drops it
       * through the 3.222 lower bore onto the TILES at 1.389. Measured 0.365 in, at 12 Hz and at
       * 30 Hz alike. The differences higher up the column DO shrink as the contacts stiffen
       * (1.177 in at the top at 12 Hz, 0.495 at 30), which is why they are not what is asserted.
       */
      check(
        'the 3D column does NOT sit at the 2D model heights — no path re-seats it (owner item 9)',
        cs.length === model.length && Math.abs(cs[0] - model[0]) > 0.2,
        `real [${cs.map((z) => z.toFixed(3)).join(', ')}] vs model [${model.map((z) => z.toFixed(3)).join(', ')}] ` +
          `(bottom differs by ${Math.abs(cs[0] - model[0]).toFixed(4)}in: the model's 0.43 floor against the tiles)`,
      );
    }

    {
      /**
       * AT CAPACITY, because penetration is load-proportional and a 4-stack hides two thirds of
       * it. `flowerCapacity('pollen')` is the FLOWER's own POLLEN limit.
       *
       * ⚠️ **THE BOUND IS A RATCHET ON `BB3_CONTACT_FREQ`, WHICH IS WHAT FIXED THIS.** The 3D
       * world used to inherit the shared `PHYS_CONTACT_FREQ` (12 Hz) — the 2D DECODE robot
       * world's value, and far too compliant for a stacked column: an 8-high column's worst gap
       * was 1.939, i.e. 0.948 in of overlap, a THIRD of a diameter, and that is what the owner
       * was looking at. Measured sweep of that one parameter, worst overlap 4-stack / 8-stack:
       * 12 → 0.406 / 0.948; 20 → 0.146 / 0.341; 30 → 0.065 / 0.152; 45 → 0.029 / 0.068. At the
       * 30 Hz now in `config.ts` an 8-high column overlaps by less than a SIXTEENTH of a
       * diameter. The bound is set just above that, so a regression of the constant — or a
       * second solver parameter quietly undoing it — fails here with the number in the message.
       */
      const OVERLAP_MAX = 0.2;
      const cap = flowerCapacity('pollen');
      const { w, ids, cs, gaps } = cols(F, cap, 961);
      const worst = PITCH - Math.min(...gaps);
      const top = cs.length > 0 ? cs[cs.length - 1] + BB_POLLEN_R : 0;
      console.log(
        `[smoke-bb flower3d] ${cap} POLLEN (the FLOWER's POLLEN capacity) settle at gaps ` +
          `[${gaps.map((z) => z.toFixed(4)).join(', ')}] · worst overlap ${worst.toFixed(4)}in of ${PITCH} · ` +
          `column tops out at ${top.toFixed(3)} against the top plate's ${BB_FLOWER_TOP_Z}`,
      );
      check(
        `a column at CAPACITY (${cap} POLLEN) is stacked, not interpenetrating — worst overlap under ${OVERLAP_MAX}in`,
        ids.length === cap && worst < OVERLAP_MAX,
        `${ids.length}/${cap} in the stack, worst gap ${Math.min(...gaps).toFixed(4)} of ${PITCH} (overlap ${worst.toFixed(4)}in)`,
      );
      check(
        `a column at CAPACITY stays in the tube and stays ordered bottom to top`,
        ids.every((id, k) => flowerTubeOf(w.balls.find((b) => b.id === id)!.pos.x, w.balls.find((b) => b.id === id)!.pos.y, cs[k]) === F) &&
          cs.every((z, k) => k === 0 || z > cs[k - 1]),
        `centres [${cs.map((z) => z.toFixed(3)).join(', ')}]`,
      );
    }

    /**
     * THE PHYSICS HALF OF OWNER ITEM 2 — "near the flower, the pollen sometimes digs into the
     * ground". It does not: nothing here sinks and nothing is being quietly put back. The bound
     * is the solver's own resting allowance, `PHYS_ALLOWED_ERROR * PHYS_LENGTH_UNIT` = 0.1 in,
     * the same one the 2D robot world lets a resting contact sit inside. Measured today: a lone
     * POLLEN bottoms at −0.0027 in every one of the four tubes, the bottom of a 4-column at
     * −0.0109, the bottom of an 8-column at −0.0217, and `containmentFixes` is 0 throughout — so
     * the safety net is not hiding this either. The DRAWING is where the inch and a half went
     * (`scene/renderElements.ts`), and this check is what pins the physics under that fix.
     */
    {
      const FLOOR = -PHYS_ALLOWED_ERROR * PHYS_LENGTH_UNIT;
      let ok = true;
      let fixes = 0;
      const detail: string[] = [];
      for (let i = 0; i < BB_FLOWERS.length; i++) {
        const { w, ids } = cols(i, 4, 970 + i);
        fixes += engineFor(w).containmentFixes;
        for (const id of ids) {
          const b = w.balls.find((x) => x.id === id)!;
          if (b.z < FLOOR) ok = false;
        }
        detail.push(`F${i} bottom ${w.balls.find((x) => x.id === ids[0])!.z.toFixed(4)}`);
      }
      check(
        `a settled FLOWER element never goes under the tiles, in any of the four tubes (owner item 2)`,
        ok && fixes === 0,
        `${detail.join(' · ')} against a floor of ${FLOOR}; containmentFixes ${fixes}`,
      );
    }

    /**
     * G418's INTENT, asked of the real bodies: a NECTAR cannot leave through the bottom.
     *
     * ⚠️ **AND THE THING THAT STOPS IT IS THE FLOOR, NOT THE RIM.** Seating a 3.6-in sphere in
     * the 3.222-in lower bore would put its centre `sqrt(1.8² − 1.611²)` = 0.803 above the
     * plate's top face (0.354), i.e. its BOTTOM at −0.643 — below the tiles. So the tiles catch
     * it first and it settles at bottom 0 with its equator wedged in the bore. Either way it is
     * not through: it never reaches a height from which there is anywhere further down to go,
     * and `flowerRetrieve3d` refuses it on G418.B's POLLEN-only gate. Worth writing down because
     * "the lower bore stops a NECTAR" is true of the INTENT and not of the contact.
     */
    {
      const seatInBore = BB_FLOWER_LOW_Z + Math.sqrt(BB_NECTAR_R * BB_NECTAR_R - (BB_FLOWER_LOW_HOLE / 2) ** 2);
      const w = mkWorld3d('free', 980);
      w.balls.length = 0;
      const el = drop(w, F, 'nectar', 1);
      for (let t = 0; t < 600; t++) step3d(w, 1 / 60, new Map());
      const centre = el.z + BB_NECTAR_R;
      check(
        'a NECTAR is still stopped at the bottom of the tube — it never passes the lower bore (G418)',
        el.z >= -PHYS_ALLOWED_ERROR * PHYS_LENGTH_UNIT && centre < BB_FLOWER_RETRIEVE_Z[1],
        `bottom ${el.z.toFixed(4)}, centre ${centre.toFixed(4)}; a bore seat would want centre ${seatInBore.toFixed(3)} ` +
          `(bottom ${(seatInBore - BB_NECTAR_R).toFixed(3)}, under the tiles), so the FLOOR is the stop`,
      );
    }
  }

  // ---- the STAGED column, and the one line of it that the 2D pipeline owns ---------------------
  //
  // `spawn.ts`'s `flowerStack()` seeds four POLLEN per FLOWER through `flowerStackZ`, which
  // returns CENTRE heights — the documented exception to "`b.z` is the element's BOTTOM". That is
  // correct for the 2D pipeline and it is PERMANENT, so the 2D half below is a byte-identity
  // guard, not a measurement.
  {
    const w2 = createBiobuzzWorld('free', 7, [setup(0, 'blue')]);
    const staged2 = w2.balls.filter((b) => b.state.kind === 'element' && b.state.el === `flower:${F}`);
    const model = flowerStackZ(staged2.map((b) => b.id), () => 'pollen');
    check(
      "a 2D world still seeds the staged column at exactly `flowerStackZ` — the permanent pipeline",
      staged2.length === model.length && staged2.every((b, k) => b.z === model[k]),
      `seeded [${staged2.map((b) => b.z.toFixed(4)).join(', ')}] vs flowerStackZ [${model.map((z) => z.toFixed(4)).join(', ')}]`,
    );

    const w3 = createBiobuzzWorld('free', 7, [setup(0, 'blue')], undefined, '3d');
    const born = w3.balls
      .filter((b) => b.state.kind === 'element' && b.state.el === `flower:${F}`)
      .map((b) => b.z + (b.r ?? BB_POLLEN_R));
    for (let t = 0; t < 600; t++) step3d(w3, 1 / 60, new Map());
    const ids = [...w3.biobuzz!.flowers[F].stack];
    const cs = realZ(w3, ids);
    console.log(
      `[smoke-bb flower3d] the STAGED column in 3D is BORN at centres [${born.map((z) => z.toFixed(4)).join(', ')}] ` +
        `and settles at [${cs.map((z) => z.toFixed(4)).join(', ')}] — a ${(born[0] - cs[0]).toFixed(3)}in fall over the first second ` +
        `of every 3D match, because the seed is a 2D CENTRE and \`syncElement\` builds the body at \`b.z + r\``,
    );
    /**
     * The 3D half asserts the OUTCOME rather than the seed, because the seed is `spawn.ts`'s and
     * the fix for it (a 3D-only `b.z -= r` re-seat inside `createBiobuzzWorld`'s existing
     * `physics === '3d'` gate) belongs in that file. Whatever height they are born at, the
     * staged column has to end up a settled physical pile inside the tube like any other — which
     * is what makes the birth height a cosmetic problem rather than a scoring one.
     */
    check(
      'the STAGED column settles into a physical pile inside the tube, whatever height it is born at',
      ids.length === 4 &&
        cs.every((z, k) => k === 0 || z > cs[k - 1]) &&
        w3.balls.find((b) => b.id === ids[0])!.z >= -PHYS_ALLOWED_ERROR * PHYS_LENGTH_UNIT &&
        cs.slice(1).some((z, k) => Math.abs(z - cs[k] - 2 * BB_POLLEN_R) > 0.005),
      `settled [${cs.map((z) => z.toFixed(4)).join(', ')}], bottom ${w3.balls.find((b) => b.id === ids[0])!.z.toFixed(4)}`,
    );
  }
}
