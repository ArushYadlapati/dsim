import type { Alliance, World } from '../../../types';
import { BB3_HIVE_PIVOT_Z, BB3_REST_SPEED, BB3_REST_TICKS, BB_POLLEN_R } from '../config';
import { hiveCellLocalBox, hivePivotX } from './bodies';
import { hiveTiltAngle } from './hive3d';
import { rotate2 } from './math3';
import type { Engine3d } from './engine';

/**
 * BIOBUZZ 3D PHYSICS -- DERIVE (Day 1, `docs/biobuzz/plan-3d.md` section 3.5), run every tick
 * right after `containmentPass` and right before the gameplay stage
 * (capture/launch/place/human player, `elements3d.ts`; the hive timer, `hive3d.ts`).
 *
 * This is the ONE place a ground/flight/hive-cell element's `BallState` is decided in the 3D
 * pipeline -- never a capture EVENT the way 2D's `park()` is, a per-tick READ of where the body
 * actually is. `held`/`stock` are untouched (they have no body to read), and a FLOWER-parked
 * `element` is untouched too (it is FIXED; `placeInFlower`/`retrieveFromFlower`, called from
 * `elements3d.ts`/`flower3d.ts`, own its tag and its stack position outright, exactly as they do
 * in 2D -- there is nothing for physics to derive about a body that never moves on its own).
 *
 * `hives[a].contents` IS DERIVED, EVERY TICK, FROM SCRATCH -- the 2D convention of appending an
 * id on capture and removing it on spill has no analogue here, because there is no capture EVENT
 * to append on. The result reads BY ID ascending rather than "arrival order": nothing that reads
 * `hives[a].contents` -- `hiveLoad` (a type count), `bbScoreWorld`'s `cellCount` (a length) --
 * is order-sensitive (unlike a FLOWER's stack, which genuinely is; see below), so an id sort is
 * exactly as correct as an arrival-order list and is the one a stateless derive can produce
 * without an extra "when did this arrive" clock. Documented as a deliberate 3D-only convention
 * change, not an oversight.
 *
 * A CELL's INTERIOR IS TESTED IN ITS OWN CURRENT (TILTED) FRAME, for BOTH cells of BOTH hives
 * every tick -- `hiveCellLocalBox`/`hiveTiltAngle`/`rotate2` -- so an element resting in EITHER
 * cell of an alliance's tray (the one currently up, or, rarely, one that flew into the currently-
 * down cell's still-open outer face) is tagged for that alliance. See `bodies.ts`'s file header
 * for the geometry and its one flagged residual.
 */

const ALLIANCES: readonly Alliance[] = ['red', 'blue'];

/** an element is AIRBORNE (`flight`) when its bottom is meaningfully off the tiles or it still
 * has real vertical speed; otherwise it is resting (`ground`, absent a cell match). APPROX
 * thresholds shared with nothing else -- this is the one place they are used. */
const AIRBORNE_Z = 0.05;
const AIRBORNE_VZ = 1;

function insideCell(px: number, py: number, pz: number, alliance: Alliance, sideSign: 1 | -1, theta: number): boolean {
  const box = hiveCellLocalBox(sideSign, alliance);
  const dx = px - hivePivotX(alliance);
  if (Math.abs(dx) > box.xHalf) return false;
  const dy = py - 0;
  const dz = pz - BB3_HIVE_PIVOT_Z;
  // world (y, z) -> the box's OWN frame: rotate2(y, z, refTheta - theta) -- see math3.ts's
  // rotate2 header and `HiveLocalBox.refTheta`'s own comment (`sim3d/bodies.ts`). `refTheta` is
  // 0 for the theta-independent algebraic fallback (reducing to the original `-theta`) and
  // `cadCaptureTheta(alliance)` for a CAD box, whose numbers are true AT that specific tilt.
  const { a: v, b: w } = rotate2(dy, dz, box.refTheta - theta);
  return v >= box.vMin && v <= box.vMax && w >= box.wMin && w <= box.wMax;
}

export function deriveTick(world: World, engine: Engine3d): void {
  const bb = world.biobuzz;
  if (!bb) return;

  const theta: Record<Alliance, number> = { red: hiveTiltAngle(world, 'red'), blue: hiveTiltAngle(world, 'blue') };
  const hiveIds: Record<Alliance, number[]> = { red: [], blue: [] };

  for (const b of world.balls) {
    if (b.state.kind === 'held' || b.state.kind === 'stock') continue;
    if (b.state.kind === 'element' && b.state.el.startsWith('flower:')) continue; // fixed, untouched

    const speed = Math.sqrt(b.vel.x * b.vel.x + b.vel.y * b.vel.y + b.vz * b.vz);
    const atRest = speed < BB3_REST_SPEED;
    const prevTicks = engine.restTicks.get(b.id) ?? 0;
    const ticks = atRest ? prevTicks + 1 : 0;
    engine.restTicks.set(b.id, ticks);
    // THE REST SNAP -- the 3D twin of the 2D artifact world's `BALL_REST_SPEED` clamp
    // (`stepGroundBall`), and it must fire EVERY tick at rest, not once. `stepGroundBall`
    // clamps sub-threshold speed to zero on EVERY tick it sees one (`if (ns <= 0 || ns <
    // BALL_REST_SPEED) { b.vel.x = 0; ... }`, unconditionally, no edge trigger) -- a one-shot
    // `ticks === BB3_REST_TICKS` fired the clamp ONCE and then left the body alone, so any
    // velocity Rapier's OWN solver re-introduced on a later tick (a persistently-touching
    // neighbor's contact bias correction, in a crowded garden line, nudges an overlapping pair
    // apart a fraction every step) was never clamped again: measured, a garden-line element
    // drifted 2.3in over 600 further ticks, sliding along a wall it was resting against, well
    // past the ~0.1in of harmless damping creep this snap was written to catch. `>=` re-snaps
    // every qualifying tick, matching `stepGroundBall`'s own continuous clamp: once an element
    // has read AT REST for `BB3_REST_TICKS`, its velocity is held at exactly zero for as long as
    // it keeps reading at rest, so the next sync teleports the body to zero velocity (position
    // untouched) the FIRST time, and every tick after that the JSON already reads zero -- but
    // if the solver hands the body a nonzero velocity again, this clamps it right back down
    // before it can accumulate into a slide.
    if (ticks >= BB3_REST_TICKS && b.state.kind !== 'flight') {
      b.vel.x = 0;
      b.vel.y = 0;
      b.vz = 0;
    }

    const r = b.r ?? BB_POLLEN_R;
    const centreZ = b.z + r;
    let tagged = false;
    if (ticks >= BB3_REST_TICKS) {
      for (const a of ALLIANCES) {
        for (const sideSign of [1, -1] as const) {
          if (insideCell(b.pos.x, b.pos.y, centreZ, a, sideSign, theta[a])) {
            b.state = { kind: 'element', el: `hive:${a}`, slot: 0 }; // `slot` is set below, by id order
            hiveIds[a].push(b.id);
            tagged = true;
            break;
          }
        }
        if (tagged) break;
      }
    }

    if (!tagged) {
      const airborne = b.z > AIRBORNE_Z || Math.abs(b.vz) > AIRBORNE_VZ;
      if (airborne) {
        // preserve `target`/`by` while a launched element stays airborne (the 2D `by` alliance
        // filter is not read in 3D -- see `elements3d.ts`'s header -- but the field is kept
        // rather than dropped, so a snapshot mid-flight still round-trips the same shape).
        b.state = b.state.kind === 'flight' ? b.state : { kind: 'flight', target: (b.color === 'red' || b.color === 'blue') ? b.color : 'red' };
      } else {
        b.state = { kind: 'ground' };
      }
    }
  }

  for (const a of ALLIANCES) {
    const ids = hiveIds[a].sort((x, y) => x - y);
    ids.forEach((id, slot) => {
      const b = world.balls.find((x) => x.id === id);
      if (b && b.state.kind === 'element') b.state = { ...b.state, slot };
    });
    bb.hives[a].contents = ids;
  }
}
