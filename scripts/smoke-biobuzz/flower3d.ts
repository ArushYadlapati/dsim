import type { Check } from './harness';
import { cmd, mkWorld3d } from './harness';
import { step3d } from '../../src/games/biobuzz/sim3d/step3d';
import { cadFlowerRings } from '../../src/games/biobuzz/sim3d/fieldColliders';
import { ringTrimesh, flowerTubeOf, flowerAtRetrieval } from '../../src/games/biobuzz/sim3d/flowerTube';
import { flowerPlace3d, flowerRetrieve3d } from '../../src/games/biobuzz/sim3d/flower3d';
import { engineFor } from '../../src/games/biobuzz/sim3d/engineImpl';
import { bbPlacePointLocal } from '../../src/games/biobuzz/robot';
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
import { flowerScore, flowerScoreZ, type BbElementKind } from '../../src/games/biobuzz/flower';
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
}
