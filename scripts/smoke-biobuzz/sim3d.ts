import type { Check } from './harness';
import { bbCoerce, cmd, mkWorld, mkWorld3d, mkWorld3dPair, run, run3d, setup } from './harness';
import { createBiobuzzWorld } from '../../src/games/biobuzz/spawn';
import { biobuzzPhysics } from '../../src/games/biobuzz/state';
import { biobuzzStep } from '../../src/games/biobuzz/step';
import { step3d } from '../../src/games/biobuzz/sim3d/step3d';
import { engineFor } from '../../src/games/biobuzz/sim3d/engineImpl';
import { cadTrayRefTheta, fieldColliders3d } from '../../src/games/biobuzz/sim3d/fieldColliders';
import { hiveCellLocalBox, hivePivotX, hiveTrayRefTheta, __setFieldCollidersOverrideForTests } from '../../src/games/biobuzz/sim3d/bodies';
import { hiveTiltAngle } from '../../src/games/biobuzz/sim3d/hive3d';
import { rotate2 } from '../../src/games/biobuzz/sim3d/math3';
import { rot } from '../../src/math';
import { worldHash } from '../../src/net/checksum';
import { bbScoreWorld } from '../../src/games/biobuzz/score';
import { bbFootprint, bbSolveShot } from '../../src/games/biobuzz/robot';
import { robotExtents } from '../../src/sim/physics';
import { chassis3dShapes } from '../../src/games/biobuzz/sim3d/bodies';
import { solveShotPath } from '../../src/games/biobuzz/shotPath';
import {
  BB3_HEIGHT_MAX,
  BB3_ROUND,
  BB3_HIVE_PIVOT_Z,
  BB3_MOUTH_SLOT_Z,
  BB_INTAKE_PERIOD_MAX,
  BB_FLOWERS,
  BB_FLOWER_D,
  BB_FLOWER_OPEN_R,
  BB_FLOWER_TOP_Z,
  BB_FRAME_BAR_IN,
  BB_FRAME_BAR_OUT,
  BB_DUMP_STAGGER_S,
  BB_GARDEN,
  BB_HALF_X,
  BB_HALF_Y,
  BB_HIVE_BOTTOM_Z,
  BB_HIVE_LOWEST_Z,
  BB_HIVE_CELL_DY,
  BB_HIVE_OPEN_Z,
  BB_HIVE_X,
  BB_POLLEN_R,
  BB_TAPE,
  BB_TILE_PITCH,
  BB_TIP_POLLEN,
} from '../../src/games/biobuzz/config';
import * as C from '../../src/config';
import { biobuzzColliders, BB_WALL_COUNT } from '../../src/games/biobuzz/colliders';
import { renderDims } from '../field-cad/emit-dims.mjs';
import { readFileSync } from 'node:fs';
import type { Artifact, RobotCommand, World } from '../../src/types';
// eslint-disable-next-line @typescript-eslint/no-var-requires -- tsx (not tsc) runs this suite;
// `scripts/` is outside tsconfig.json's `include`, so a JSON import here never reaches `tsc`.
import fieldMeasurements from '../../public/models/biobuzz/field-measurements.json';

/**
 * SIM3D -- the Day 1 lane for the 3D physics port (`docs/biobuzz/plan-3d.md`). Checks the
 * seam (physics tag, dispatch), the persistent engine (sync/readback/containment), drive-feel
 * parity against the 2D pipeline, determinism, element conservation, intake capture, launch
 * into the hive, height clearance, the tip, and step cost.
 */

function speedOf(w: World): number {
  const r = w.robots[0];
  return Math.sqrt(r.vel.x * r.vel.x + r.vel.y * r.vel.y);
}

/** run `seconds` of `stepFn` on `w`, sampling robot 0's planar speed every tick; returns the
 * final speed and the first tick (in seconds) at which it reached 95% of the LAST sample. */
function driveProfile(
  w: World,
  c: RobotCommand,
  seconds: number,
  stepFn: (w: World, dt: number, cmds: Map<number, RobotCommand>) => void,
): { topSpeed: number; t95: number } {
  const dt = 1 / 60;
  const n = Math.round(seconds / dt);
  const cmds = new Map([[0, c]]);
  let t95 = seconds;
  let found95 = false;
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    stepFn(w, dt, cmds);
    samples.push(speedOf(w));
  }
  // PEAK, not the last sample: a 2-second straight run can reach the far wall before the
  // window ends, and the resulting collision-slowed final tick is not this robot's top speed.
  const topSpeed = Math.max(...samples);
  for (let i = 0; i < samples.length; i++) {
    if (!found95 && samples[i] >= 0.95 * topSpeed) {
      t95 = i * dt;
      found95 = true;
    }
  }
  return { topSpeed, t95 };
}

function yawRateOf(w: World): number {
  return Math.abs(w.robots[0].angVel);
}

function turnProfile(
  w: World,
  c: RobotCommand,
  seconds: number,
  stepFn: (w: World, dt: number, cmds: Map<number, RobotCommand>) => void,
): { topRate: number } {
  const dt = 1 / 60;
  const n = Math.round(seconds / dt);
  const cmds = new Map([[0, c]]);
  let topRate = 0;
  for (let i = 0; i < n; i++) {
    stepFn(w, dt, cmds);
    topRate = Math.max(topRate, yawRateOf(w));
  }
  return { topRate };
}

/**
 * The world-space centre of a point at local (x, v, w) on hive `alliance`'s tray, at tilt
 * `theta` -- the smoke lane's own placement helper, built from the SAME geometry
 * `sim3d/bodies.ts`/`derive.ts` use, so a scene staged with it is staged where the engine
 * actually thinks the cell is.
 *
 * NO `refTheta` TERM -- `hiveCellLocalBox`'s `vMin..wMax` numbers (0 for the theta-independent
 * algebraic fallback box, `cadCaptureTheta(alliance)` for a CAD box, captured AT that tilt) are
 * now BAKED into the built collider's own geometry by `sim3d/bodies.ts`'s `obliqueBoxCollider`
 * (a per-collider Rapier rotation of `refTheta`, fixed once at creation -- not the live, per-tick
 * `setNextKinematicRotation` the earlier, REJECTED per-collider-rotation attempt used, which is
 * what destabilized a resting element; see that function's own comment), so `world = pivot +
 * Rotate(theta) * (v, w)` holds the same way it always did for the fallback box (`refTheta`
 * always 0) -- see `HiveLocalBox.refTheta`'s own comment. `derive.ts`'s `insideCell` does the
 * matching inverse, also with no `refTheta` term.
 */
function hiveWorldPoint(
  alliance: 'red' | 'blue',
  sideSign: 1 | -1,
  theta: number,
  x: number,
  v: number,
  w: number,
): { x: number; y: number; z: number } {
  const { a: y, b: z } = rotate2(v, w, theta);
  return { x: hivePivotX(alliance) + x, y, z: BB3_HIVE_PIVOT_Z + z };
}

export function sim3dChecks(check: Check): void {
  // ---- seam: physics tag + dispatch ------------------------------------------------------
  {
    const setups = [setup(0, 'blue')];
    const w2dA = createBiobuzzWorld('free', 7, setups);
    const w2dB = createBiobuzzWorld('free', 7, setups, undefined, '2d');
    check(
      'seam: createBiobuzzWorld with 4 args and an explicit 2d tag give identical JSON',
      JSON.stringify(w2dA) === JSON.stringify(w2dB),
    );
    const w3d = createBiobuzzWorld('free', 7, setups, undefined, '3d');
    check('seam: a 3d world carries the physics tag', w3d.biobuzz?.physics === '3d');
    check('seam: biobuzzPhysics reads it back', biobuzzPhysics(w3d) === '3d' && biobuzzPhysics(w2dA) === '2d');
    let threw = false;
    try {
      biobuzzStep(w3d, 1 / 60, new Map());
    } catch {
      threw = true;
    }
    check('seam: stepping a 3d world does not throw', !threw);
    for (const r of w3d.robots) check(`seam: robot ${r.id} reads z === 0 after one tick`, (r.z ?? -1) === 0);
    const badPos = w3d.balls.filter((b) => !Number.isFinite(b.pos.x) || !Number.isFinite(b.pos.y) || !Number.isFinite(b.z));
    check('seam: every element has a finite position after one tick', badPos.length === 0, `${badPos.length} non-finite`);
  }
  // ---- heightIn seam: coerceSpec must carry heightIn across into the biobuzz clamp --------
  //
  // `src/sim/spawn.ts`'s `coerceSpec` copies `bbMech` into `coerceBiobuzzSpec`'s input but,
  // before this lane's fix, had no matching line for `heightIn` -- so a spec's `heightIn` was
  // silently dropped for every real caller (settings load, server ingress, `createWorld`)
  // before the biobuzz clamp (`coerceBiobuzzSpec`, `BB3_HEIGHT_MIN`..`BB3_HEIGHT_MAX`) ever
  // saw it. `bbCoerce` is the exact chokepoint a real spec goes through.
  {
    const kept = bbCoerce({ heightIn: 29 });
    check('heightIn: 29 (in range) survives coerceSpec into the biobuzz clamp', kept.heightIn === 29, `got ${kept.heightIn}`);
    const clamped = bbCoerce({ heightIn: 40 });
    check('heightIn: 40 (over BB3_HEIGHT_MAX) clamps to 29', clamped.heightIn === 29, `got ${clamped.heightIn}`);
    const absent = bbCoerce({});
    check(
      'heightIn: absent stays absent (BB3_HEIGHT_DEFAULT applies downstream)',
      absent.heightIn === undefined,
      `got ${absent.heightIn}`,
    );
  }

  // ---- drive-feel parity: 2D vs 3D, same spec ---------------------------------------------
  //
  // BOTH fixtures below relocate robot 0 to the OPEN FIELD CENTRE before measuring. The
  // staged BIOBUZZ start position (`mkWorld`/`mkWorld3d`'s default) sits FLUSH against a wall
  // by design (a real start position), and a robot's `robotExtents` footprint touching a wall
  // AT TICK 0 puts a wall-contact friction term into tick 0's answer that has nothing to do
  // with the shared drivetrain model this check exists to compare. Measured (this lane's final
  // report): at the staged position, one second of `rotate: 1` gave 2D 0.298 rad/s against 3D
  // 0.298-9 rad/s depending on how closely the two engines' own wall-contact solvers agreed --
  // moved off the wall, the SAME command gives 2D 9.6495 rad/s against 3D 9.6496 (ratio
  // 1.0000), and the forward case's t95 matches to the tick (0.333s both). Rapier2D and
  // Rapier3D are separate solvers and are not required to agree on CONTACT friction bit for
  // bit -- the drivetrain model they are both fed (`updateRobot`, shared, untouched) is what
  // this check is actually for, and it is exact once nothing is touching a wall at tick 0.
  // `driveProfile`'s own PEAK-sampling already tolerates a wall hit LATER in the window (its
  // header comment says so); only the STARTING contact was the problem.
  function clearOfWalls(w: World): void {
    const r = w.robots[0];
    r.pos.x = 0;
    r.pos.y = 0;
    r.heading = 0;
    r.vel = { x: 0, y: 0 };
    r.angVel = 0;
  }
  {
    const spec = {};
    const w2d = mkWorld('free', 2, spec);
    const w3d = mkWorld3d('free', 2, spec);
    clearOfWalls(w2d);
    clearOfWalls(w3d);
    const forward = cmd({ driveY: 1 });
    const p2d = driveProfile(w2d, forward, 2, biobuzzStep);
    const p3d = driveProfile(w3d, forward, 2, step3d);
    const speedRatio = p2d.topSpeed > 0 ? p3d.topSpeed / p2d.topSpeed : 1;
    check(
      'drive-feel: top speed within 5% of the 2D pipeline',
      Math.abs(speedRatio - 1) <= 0.05,
      `2d=${p2d.topSpeed.toFixed(2)} 3d=${p3d.topSpeed.toFixed(2)} ratio=${speedRatio.toFixed(3)}`,
    );
    const t95Diff = Math.abs(p3d.t95 - p2d.t95);
    check(
      'drive-feel: time-to-95%-of-top-speed within 5% or 2 ticks of the 2D pipeline',
      t95Diff <= Math.max(2 / 60, 0.05 * p2d.t95),
      `2d=${p2d.t95.toFixed(3)}s 3d=${p3d.t95.toFixed(3)}s`,
    );
  }
  {
    const spec = {};
    const w2d = mkWorld('free', 3, spec);
    const w3d = mkWorld3d('free', 3, spec);
    clearOfWalls(w2d);
    clearOfWalls(w3d);
    const turn = cmd({ rotate: 1 });
    const r2d = turnProfile(w2d, turn, 1, biobuzzStep);
    const r3d = turnProfile(w3d, turn, 1, step3d);
    const rateRatio = r2d.topRate > 0 ? r3d.topRate / r2d.topRate : 1;
    check(
      'drive-feel: yaw rate within 5% of the 2D pipeline (pure rotate)',
      Math.abs(rateRatio - 1) <= 0.05,
      `2d=${r2d.topRate.toFixed(3)} 3d=${r3d.topRate.toFixed(3)} ratio=${rateRatio.toFixed(3)}`,
    );
  }

  // ---- two-run determinism: a scripted 600-tick sequence -----------------------------------
  {
    function scripted(t: number): RobotCommand {
      // drive, turn, intake, fire, place, nectar -- a varied but fully deterministic script,
      // keyed off the tick number alone (no RNG at the call site).
      const phase = Math.floor(t / 60) % 6;
      const base = cmd({});
      if (phase === 0) return { ...base, driveY: 1 };
      if (phase === 1) return { ...base, rotate: 1 };
      if (phase === 2) return { ...base, driveY: 1, intake: true };
      if (phase === 3) return { ...base, fire: true };
      if (phase === 4) return { ...base, bbPlace: true, bbPlaceNectar: true };
      return { ...base, bbNectar: true, driveX: 1 };
    }
    const wa = mkWorld3d('free', 11);
    const wb = mkWorld3d('free', 11);
    const hashesA: number[] = [];
    const hashesB: number[] = [];
    for (let t = 0; t < 600; t++) {
      const c = scripted(t);
      step3d(wa, 1 / 60, new Map([[0, c]]));
      step3d(wb, 1 / 60, new Map([[0, c]]));
      if (t % 60 === 0) {
        hashesA.push(worldHash(wa));
        hashesB.push(worldHash(wb));
      }
    }
    check(
      'determinism: two fresh 3D worlds, same seed and script, hash equal every 60 ticks',
      hashesA.every((h, i) => h === hashesB[i]),
      `${JSON.stringify(hashesA)} vs ${JSON.stringify(hashesB)}`,
    );
    check(
      'determinism: two fresh 3D worlds, same seed and script, final JSON identical',
      JSON.stringify(wa) === JSON.stringify(wb),
    );
  }

  // ---- conservation: 56 elements, no duplicate ids, over 1200 ticks of driving -------------
  {
    const w = mkWorld3d('free', 21);
    let ok = true;
    let detail = '';
    const drive = cmd({ driveY: 1, driveX: 0.3 });
    for (let t = 0; t < 1200 && ok; t++) {
      // sweep through the garden lines every few seconds by alternating drive direction
      const phase = Math.floor(t / 180) % 2;
      step3d(w, 1 / 60, new Map([[0, phase === 0 ? drive : cmd({ driveY: -1, driveX: -0.3 })]]));
      if (w.balls.length !== 56) {
        ok = false;
        detail = `tick ${t}: ${w.balls.length} balls`;
        break;
      }
      const ids = new Set(w.balls.map((b) => b.id));
      if (ids.size !== w.balls.length) {
        ok = false;
        detail = `tick ${t}: duplicate id in ${JSON.stringify(w.balls.map((b) => b.id))}`;
      }
    }
    check('conservation: 56 elements, no duplicate ids, over 1200 ticks of driving', ok, detail);
  }

  // ---- containment: nothing outside the perimeter or below the tiles, over 3600 ticks ------
  {
    const w = mkWorld3d('free', 22);
    let ok = true;
    let detail = '';
    for (let t = 0; t < 3600 && ok; t++) {
      // ram the garden lines and the walls: alternate corner-to-corner diagonals
      const phase = Math.floor(t / 300) % 4;
      const c =
        phase === 0
          ? cmd({ driveY: 1, driveX: 1 })
          : phase === 1
            ? cmd({ driveY: -1, driveX: 1 })
            : phase === 2
              ? cmd({ driveY: -1, driveX: -1 })
              : cmd({ driveY: 1, driveX: -1 });
      step3d(w, 1 / 60, new Map([[0, c]]));
      for (const b of w.balls) {
        if (b.state.kind === 'held' || b.state.kind === 'stock') continue;
        if (!Number.isFinite(b.pos.x) || !Number.isFinite(b.pos.y) || !Number.isFinite(b.z)) {
          ok = false;
          detail = `tick ${t}: ball ${b.id} non-finite`;
          break;
        }
        if (Math.abs(b.pos.x) > BB_HALF_X + 0.01 || Math.abs(b.pos.y) > BB_HALF_Y + 0.01) {
          ok = false;
          detail = `tick ${t}: ball ${b.id} outside perimeter at (${b.pos.x.toFixed(2)},${b.pos.y.toFixed(2)})`;
          break;
        }
        if (b.z < -0.5) {
          ok = false;
          detail = `tick ${t}: ball ${b.id} below the tiles at z=${b.z.toFixed(2)}`;
          break;
        }
      }
      for (const r of w.robots) {
        if (Math.abs(r.pos.x) > BB_HALF_X + 0.01 || Math.abs(r.pos.y) > BB_HALF_Y + 0.01) {
          ok = false;
          detail = `tick ${t}: robot ${r.id} outside perimeter`;
          break;
        }
      }
    }
    check('containment: nothing outside the perimeter or below the tiles, over 3600 ticks', ok, detail);
    const engine = engineFor(w);
    // walls are ALWAYS built at the shared BB_HALF_X/Y constants now (owner correction -- see
    // `buildStatics3d`'s own comment), so the staged loading-zone pollen (placed 1.4in clear of
    // that SAME constant) never start embedded, and this invariant holds with no safety net.
    check(
      'containment: containmentFixes stayed 0 -- the invariant held without the safety net',
      engine.containmentFixes === 0,
      `${engine.containmentFixes} fixes`,
    );
  }

  // ---- a resting element stays at rest ------------------------------------------------------
  {
    /**
     * WHAT "AT REST" MEANS UNDER A SOFT-CONTACT SOLVER, and why the tick count kept moving.
     *
     * A garden row settles into a COLUMN pressed against the audience wall — on this seed,
     * elements 29/26/30 end up at y 28.47 / 31.26 / 34.06, i.e. 2.79 in apart against a 2.80-in
     * diameter, so the column is a few thou interpenetrated. Their VELOCITY is exactly zero from
     * the moment the roll law snaps it (measured: `vel` and `vz` are hard 0 at tick 900 and stay
     * 0), and they are not translating under any dynamics. What is left is Rapier resolving that
     * residual overlap, ~2e-6 in per tick, in the POSITION channel only — invisible to every
     * gameplay predicate and to `bbSettled`, but not to an exact position compare.
     *
     * It DECAYS, and that is the load-bearing fact. Worst drift over consecutive 600-tick
     * windows, seed 23: 3.91e-2 → 4.20e-3 → 8.0e-4 → 2.0e-4 → 1.0e-4 → EXACTLY 0 from tick 3600.
     * So 900 settle ticks (the old number, raised from 600 once already when the CAD wall's
     * inner face moved ~1.33 in inward) does not buy stillness, it buys a smaller number: at 900
     * ball 26 still relaxes 4.3e-3 in y over the next 600 ticks. Chasing it with a third magic
     * constant is a treadmill, so the pair below asserts the two things that are actually true:
     * relaxation CONVERGES (the check after this one), and once it has converged the field is
     * BIT-STILL — not within a tolerance, not a single unit of the 1e-4 position quantum.
     */
    const w = mkWorld3d('free', 23);
    for (let t = 0; t < 3600; t++) step3d(w, 1 / 60, new Map());
    const ground = w.balls.filter((b) => b.state.kind === 'ground');
    const before = new Map(ground.map((b) => [b.id, { x: b.pos.x, y: b.pos.y, z: b.z }]));
    for (let t = 0; t < 600; t++) step3d(w, 1 / 60, new Map());
    let ok = true;
    let detail = '';
    let moving = '';
    for (const b of w.balls) {
      if (b.state.kind !== 'ground') continue;
      const was = before.get(b.id);
      if (!was) continue; // was not ground before settling; not part of this check
      // AND ITS VELOCITY IS EXACTLY ZERO, which is the statement `bbSettled` and the HUD read.
      if (b.vel.x !== 0 || b.vel.y !== 0 || b.vz !== 0) {
        moving = `ball ${b.id} vel (${b.vel.x},${b.vel.y},${b.vz})`;
        break;
      }
      if (was.x !== b.pos.x || was.y !== b.pos.y || was.z !== b.z) {
        ok = false;
        detail = `ball ${b.id} moved from (${was.x},${was.y},${was.z}) to (${b.pos.x},${b.pos.y},${b.z})`;
        break;
      }
    }
    check(
      'a settled resting element is BIT-still for 600 further ticks, and its velocity is exactly zero',
      ok && moving === '',
      detail || moving,
    );
  }

  // ---- and the relaxation that gets it there decays, rather than creeping forever -----------
  {
    /**
     * THE CHECK THAT DOES NOT NEED A MAGIC TICK COUNT. Contact-overlap relaxation is allowed —
     * it is how a soft solver un-jams a packed column — but it has to DIE OUT. A creep that
     * held its rate, or grew, is the signature of a jitter loop or a pair of colliders fighting
     * each other, and the fixed-tolerance check above cannot tell that apart from "needs a few
     * hundred more ticks". So: worst per-axis drift over consecutive 600-tick windows must at
     * least HALVE each window while it is still above the 1e-3 tolerance, and once under it may
     * never climb back. Measured ratios on seed 23: 0.107, 0.190, 0.250, 0.500, 0.
     */
    const w = mkWorld3d('free', 23);
    const take = (): Map<number, { x: number; y: number; z: number }> =>
      new Map(w.balls.filter((b) => b.state.kind === 'ground').map((b) => [b.id, { x: b.pos.x, y: b.pos.y, z: b.z }]));
    for (let t = 0; t < 600; t++) step3d(w, 1 / 60, new Map());
    let snap = take();
    const drifts: number[] = [];
    for (let win = 0; win < 5; win++) {
      for (let t = 0; t < 600; t++) step3d(w, 1 / 60, new Map());
      let worst = 0;
      for (const b of w.balls) {
        if (b.state.kind !== 'ground') continue;
        const was = snap.get(b.id);
        if (!was) continue;
        worst = Math.max(worst, Math.abs(was.x - b.pos.x), Math.abs(was.y - b.pos.y), Math.abs(was.z - b.z));
      }
      drifts.push(worst);
      snap = take();
    }
    let ok = true;
    for (let i = 1; i < drifts.length; i++) {
      const prev = drifts[i - 1];
      const now = drifts[i];
      if (prev > 1e-3 ? now > prev / 2 : now > 1e-3) ok = false;
    }
    check(
      'the residual contact relaxation DECAYS — each 600-tick window drifts at most half the last',
      ok && drifts[0] > 0,
      `worst drift per window: ${drifts.map((d) => d.toExponential(2)).join(' -> ')}`,
    );
  }

  // ---- CCD: a 260 in/s shot does not tunnel a 0.25-in cell wall ----------------------------
  {
    const w = mkWorld3d('free', 24);
    const theta = Math.PI / 6; // the rest tilt, BB_HIVE_TILT_DEG in radians (blue up = north)
    const box = hiveCellLocalBox(1, 'blue');
    const wCentre = (box.wMin + box.wMax) / 2;
    // START CLEAR OF THE BACK SLAB, NOT TOUCHING IT. The wall this fires at is the cell's BACK
    // plate, whose collider is a 1.5-in slab extruded from the CAD plane AWAY from the cell -- so
    // it occupies the 1.5 in of `v` immediately BEHIND `box.vMin`, which is where the old
    // `box.vMin - 3` start point put the 1.5-in-radius element: overlapping the slab on tick
    // zero, which is a deep-contact test, not a tunnelling test. Backing off by another two radii
    // gives a genuine clear sweep INTO the wall at 260 in/s (4.33 in per tick against a 1.5-in
    // slab), which is what this check is for.
    const startV = box.vMin - 3 - 2 * BB_POLLEN_R;
    const start = hiveWorldPoint('blue', 1, theta, 0, startV, wCentre);
    const velDir = rotate2(260, 0, theta);
    const id = Math.max(...w.balls.map((b) => b.id)) + 1;
    const shot: Artifact = {
      id,
      color: 'yellow',
      state: { kind: 'ground' },
      pos: { x: start.x, y: start.y },
      vel: { x: 0, y: velDir.a },
      z: start.z - BB_POLLEN_R,
      vz: velDir.b,
    };
    w.balls.push(shot);
    for (let t = 0; t < 8; t++) step3d(w, 1 / 60, new Map());
    const after = w.balls.find((b) => b.id === id)!;
    const dy = after.pos.y - 0;
    const dz = after.z + BB_POLLEN_R - BB3_HIVE_PIVOT_Z;
    const local = rotate2(dy, dz, -theta);
    check(
      'CCD: a 260 in/s shot into a 0.25-in cell wall does not tunnel through it',
      local.a <= box.vMin + 1,
      `local v=${local.a.toFixed(3)} (wall near face at v=${box.vMin.toFixed(3)})`,
    );
  }

  // ---- intake: a robot driven onto a garden pollen with intake held captures it -------------
  {
    const w = mkWorld3d('free', 25);
    const target = w.balls.find((b) => b.state.kind === 'ground');
    if (!target) {
      check('intake: a staged ground pollen exists to test capture against', false);
    } else {
      const r = w.robots[0];
      const hl = r.spec.length / 2;
      // relocate the staged garden ball to a safe, wall-clear interior spot first -- every
      // staged `ground` element sits within a pollen radius of a wall (that is what a GARDEN
      // is), and placing the robot's own chassis behind it (further from field centre, to put
      // the ball in front of the mouth) would put the chassis THROUGH the perimeter wall,
      // which explodes on the very first physics step (measured: a ~450 in/s spurious first-
      // tick velocity from the wall-penetration recovery).
      target.pos.x = 0;
      target.pos.y = 0;
      target.z = 0;
      target.vel = { x: 0, y: 0 };
      target.vz = 0;
      // put the ball ON THE ROLLER LINE -- resting against the front of the robot's own
      // collider, which in 3D is `robotExtents` (intake reach INCLUDED), so this is the
      // nearest an element can physically get. It used to be dropped at `hl + 1`, i.e. 2 in
      // INSIDE that collider, which the old instant-capture rule swallowed before the
      // penetration recovery could fire; the roller model draws it in from where it can
      // actually be instead (`bbIntakeAct`).
      r.heading = 0;
      r.pos.x = target.pos.x - (bbFootprint(r.spec).front + BB_POLLEN_R + 0.2);
      r.pos.y = target.pos.y;
      void hl;
      // EMPTY THE HOPPER FIRST -- a freshly-staged robot already carries its 4 preloaded
      // POLLEN (section 10.3.4), which is exactly `bbHopperCap`'s ceiling for this build, so
      // capture would otherwise refuse for a reason this check is not testing.
      for (const b of w.balls) {
        if (b.state.kind === 'held' && b.state.robot === r.id) b.state = { kind: 'ground' };
      }
      r.hopper = [];
      const hopperBefore = r.hopper.length;
      const engine = engineFor(w);
      const bodiesBefore = engine.elements.size;
      let capturedAtTick = -1;
      // ONE FEED CADENCE, not a fixed dwell: an intake passes one element every
      // `BB_INTAKE_PERIOD_MIN`..`_MAX` (`bbIntakeAct`), so the budget is the slow end of that
      // plus a few ticks of transit rather than a fixed dwell, which no longer exists as a
      // capture rule.
      const maxTicks = Math.ceil(BB_INTAKE_PERIOD_MAX * 60) + 6;
      for (let t = 0; t < maxTicks; t++) {
        step3d(w, 1 / 60, new Map([[0, cmd({ intake: true })]]));
        const now = w.balls.find((b) => b.id === target.id)!;
        if (now.state.kind === 'held') {
          capturedAtTick = t;
          break;
        }
      }
      check(
        `intake: captures within ${maxTicks} ticks of overlap`,
        capturedAtTick >= 0,
        capturedAtTick >= 0 ? `tick ${capturedAtTick}` : 'never captured',
      );
      const rAfter = w.robots[0];
      check('intake: hopper length increased by one', rAfter.hopper.length === hopperBefore + 1, `${hopperBefore} -> ${rAfter.hopper.length}`);
      const ballAfter = w.balls.find((b) => b.id === target.id)!;
      check('intake: the captured ball reads state held', ballAfter.state.kind === 'held');
      // the body removal itself happens on the NEXT tick's sync (it reconciles the JSON
      // state change made by THIS tick's gameplay stage), so one more tick has to run before
      // the engine's own body count reflects it.
      step3d(w, 1 / 60, new Map([[0, cmd({ intake: true })]]));
      const engineAfter = engineFor(w);
      check(
        "intake: the engine's element body count dropped by one",
        engineAfter.elements.size === bodiesBefore - (capturedAtTick >= 0 ? 1 : 0),
        `${bodiesBefore} -> ${engineAfter.elements.size}`,
      );
    }
  }

  // ---- rolling resistance, the rest snap, and the honest tag for an element on structure ---
  /**
   * `groundRoll3d` (`engineImpl.ts`) + `derive.ts`'s tagging. Three behaviours, each a bug that
   * held the post-match settle clock open or put an element permanently out of play.
   */
  {
    const roll = (phys: '2d' | '3d', v0: number): { d: number; s: number } => {
      const w = phys === '3d' ? mkWorld3d('free', 31) : mkWorld('free', 31);
      w.balls.length = 0;
      w.robots[0].hopper.length = 0;
      w.robots[0].pos = { x: 0, y: 60 };
      w.robots[0].vel = { x: 0, y: 0 };
      const b: Artifact = { id: 991, color: 'yellow', r: BB_POLLEN_R, state: { kind: 'ground' }, pos: { x: -60, y: -40 }, vel: { x: v0, y: 0 }, z: 0, vz: 0 };
      w.balls.push(b);
      let t = 0;
      for (; t < 1200; t++) {
        biobuzzStep(w, 1 / 60, new Map());
        if (Math.hypot(b.vel.x, b.vel.y) === 0) break;
      }
      return { d: b.pos.x + 60, s: t / 60 };
    };
    let worst = 0;
    let detail = '';
    for (const v0 of [20, 40, 60]) {
      const a = roll('2d', v0);
      const c = roll('3d', v0);
      const err = Math.abs(c.d - a.d) / a.d;
      if (err > worst) worst = err;
      detail += `${v0}: 2D ${a.d.toFixed(1)}in/${a.s.toFixed(2)}s vs 3D ${c.d.toFixed(1)}in/${c.s.toFixed(2)}s  `;
      // AND IT STOPS. Exponential damping never reaches zero; the 2D rest snap does, and so
      // must this — a ground element still creeping is what held the settle clock open for 8 s.
      check(`roll 3d: an element launched at ${v0} in/s comes to a HARD stop`, c.s < 20, `${c.s.toFixed(2)}s`);
    }
    check('roll 3d: the 3D roll-out matches the 2D pipeline within 15%', worst < 0.15, `worst ${(worst * 100).toFixed(1)}% — ${detail}`);

    // AT REST ON STRUCTURE IS `ground`, NOT `flight` FOREVER. `capturePollen` and the AI's
    // element scan both read `ground` only, so the old tag put such an element out of play.
    {
      const w = mkWorld3d('free', 31);
      w.balls.length = 0;
      w.robots[0].hopper.length = 0;
      w.robots[0].pos = { x: 0, y: -60 };
      const b: Artifact = { id: 992, color: 'yellow', r: BB_POLLEN_R, state: { kind: 'flight', target: 'blue' }, pos: { x: 12.3, y: -5.6 }, vel: { x: 0, y: 0 }, z: 60, vz: 0 };
      w.balls.push(b);
      run3d(w, new Map(), 5);
      check(
        'roll 3d: an element at rest ON the HIVE frame reads ground (not flight forever), and is in no cell',
        b.state.kind === 'ground' && b.z > 1 && Math.hypot(b.vel.x, b.vel.y) === 0 &&
          !w.biobuzz!.hives.blue.contents.includes(b.id) && !w.biobuzz!.hives.red.contents.includes(b.id),
        `state=${b.state.kind} z=${b.z.toFixed(2)} |v|=${Math.hypot(b.vel.x, b.vel.y).toFixed(3)}`,
      );
    }

    // ...AND AN ELEMENT AT REST INSIDE A CELL STILL COUNTS. The scoring half of the same rule:
    // membership waits for rest, so anything that breaks the rest test loses the points.
    {
      const w = mkWorld3d('free', 31);
      w.balls.length = 0;
      w.robots[0].hopper.length = 0;
      w.robots[0].pos = { x: 0, y: -60 };
      const up = w.biobuzz!.hives.blue.up;
      const sign: 1 | -1 = up === 'north' ? 1 : -1;
      const theta = hiveTiltAngle(w, 'blue');
      const box = hiveCellLocalBox(sign, 'blue');
      const p = hiveWorldPoint('blue', sign, theta, 0, (box.vMin + box.vMax) / 2, box.wMin + 2);
      const b: Artifact = { id: 993, color: 'yellow', r: BB_POLLEN_R, state: { kind: 'flight', target: 'blue' }, pos: { x: p.x, y: p.y }, vel: { x: 0, y: 0 }, z: p.z - BB_POLLEN_R + 2, vz: 0 };
      w.balls.push(b);
      run3d(w, new Map(), 3);
      check(
        'roll 3d: an element at rest INSIDE a cell is counted in that hive contents list',
        b.state.kind === 'element' && w.biobuzz!.hives.blue.contents.includes(b.id),
        `state=${b.state.kind} contents=${JSON.stringify(w.biobuzz!.hives.blue.contents)}`,
      );
    }

    // ...AND NOTHING FREEZES IN MID-AIR. The snap's discriminator is CONTACT, not speed: an
    // element at the apex of a lob is slower than any rest threshold for a tick.
    {
      const w = mkWorld3d('free', 31);
      w.balls.length = 0;
      w.robots[0].hopper.length = 0;
      w.robots[0].pos = { x: 0, y: -60 };
      const b: Artifact = { id: 994, color: 'yellow', r: BB_POLLEN_R, state: { kind: 'flight', target: 'blue' }, pos: { x: -40, y: 30 }, vel: { x: 0, y: 0 }, z: 30, vz: 0 };
      w.balls.push(b);
      run3d(w, new Map(), 2);
      check('roll 3d: an element dropped from 30 in reaches the tiles (the rest snap never freezes one in the air)', b.z < 0.5, `z=${b.z.toFixed(2)}`);
    }
  }

  // ---- the ROLLER intake, under 3D physics (`bbIntakeAct`, the SAME model 2D runs) ---------
  /**
   * The three cases the 2D lane pins, re-run here because the 3D pipeline reaches the model
   * from a different place (`elements3d.ts`, after readback) and against a chassis collider
   * that is `robotExtents` rather than the bare frame — which is exactly the difference
   * `BbIntakeOpts.seat` exists for, and the one that made every 3D capture un-arrivable when
   * it was missing.
   */
  {
    const stage = (seed: number, x: number, y: number) => {
      const w = mkWorld3d('free', seed);
      const r = w.robots[0];
      for (const b of w.balls) if (b.state.kind === 'held' && b.state.robot === r.id) b.state = { kind: 'stock', alliance: r.alliance };
      r.hopper = [];
      r.pos = { x, y };
      r.heading = 0;
      r.vel = { x: 0, y: 0 };
      r.angVel = 0;
      r.autoIntake = false;
      r.autoFire = false;
      return { w, r };
    };
    const pollen = (w: World, x: number, y: number): Artifact => {
      const id = w.balls.reduce((m, b) => Math.max(m, b.id), 0) + 1;
      const b: Artifact = { id, color: 'yellow', r: BB_POLLEN_R, state: { kind: 'ground' }, pos: { x, y }, vel: { x: 0, y: 0 }, z: 0, vz: 0 };
      w.balls.push(b);
      return b;
    };

    // THE COMPOUND'S OUTER ENVELOPE IS STILL `robotExtents`. This is the whole safety argument
    // for opening the mouth: the arm tips and the lintel end exactly where the single cuboid
    // ended, so wall contact, the wall-flush start pose and start legality cannot have moved.
    {
      let bad = '';
      for (const mount of ['front', 'back', 'side', 'frontback'] as const) {
        const w = mkWorld3d('free', 71, { intakeMount: mount });
        const r = w.robots[0];
        const h = 18;
        const boxes = chassis3dShapes(r.spec, h);
        const fe = robotExtents(r);
        const front = Math.max(...boxes.map((b) => b.cx + b.hx));
        const rear = -Math.min(...boxes.map((b) => b.cx - b.hx));
        const half = Math.max(...boxes.map((b) => Math.max(b.cy + b.hy, -(b.cy - b.hy))));
        const top = Math.max(...boxes.map((b) => b.cz + b.hz));
        const bottom = Math.min(...boxes.map((b) => b.cz - b.hz));
        const ok =
          Math.abs(front - fe.front) < 1e-9 &&
          Math.abs(rear - fe.rear) < 1e-9 &&
          Math.abs(half - fe.half) < 1e-9 &&
          Math.abs(top - h / 2) < 1e-9 &&
          Math.abs(bottom + h / 2) < 1e-9;
        if (!ok && !bad) bad = `${mount}: ${front}/${rear}/${half} vs ${fe.front}/${fe.rear}/${fe.half}, z ${bottom}..${top}`;
      }
      check('roller 3d: the chassis compound spans exactly robotExtents — the arm tips and the lintel end where the single cuboid did', bad === '', bad);
    }

    // ...AND THE POCKET IS OPEN ONLY UNDER AN ELEMENT. Nothing covers the mouth below the slot;
    // above it the lintel does, which is what keeps a wall, a robot and the HIVE where they were.
    {
      const w = mkWorld3d('free', 72, { intakeMount: 'front' });
      const r = w.robots[0];
      const boxes = chassis3dShapes(r.spec, 18);
      const probe = (x: number, z: number): boolean =>
        boxes.some((b) => Math.abs(x - b.cx) < b.hx && Math.abs(0 - b.cy) < b.hy && Math.abs(z - b.cz) < b.hz);
      const inMouth = r.spec.length / 2 + 1;
      const low = probe(inMouth, -9 + BB3_MOUTH_SLOT_Z / 2);
      const high = probe(inMouth, -9 + BB3_MOUTH_SLOT_Z + 1);
      check(
        'roller 3d: the mouth pocket is OPEN below one element height and CLOSED above it',
        !low && high,
        `low=${low} high=${high} slot=${BB3_MOUTH_SLOT_Z}`,
      );
    }

    {
      const { w } = stage(61, BB_HALF_X - bbFootprint(mkWorld3d('free', 61).robots[0].spec).front - 16, -30);
      const b = pollen(w, BB_HALF_X - BB_POLLEN_R, -30);
      run3d(w, new Map([[0, cmd({ driveY: 0.7, intake: true })]]), 3);
      check('roller 3d: a POLLEN pinned on a wall is captured, not wedged', b.state.kind === 'held', `state=${b.state.kind}`);
    }

    {
      const { w, r } = stage(62, -40, -30);
      const hl = r.spec.length / 2;
      const hw = r.spec.width / 2;
      const beside = pollen(w, -40, -30 + hw + BB_POLLEN_R + 1.5);
      const behind = pollen(w, -40 - (bbFootprint(r.spec).rear + BB_POLLEN_R + 1.5), -30);
      void hl;
      run3d(w, new Map([[0, cmd({ intake: true })]]), 2);
      check(
        'roller 3d: a parked robot takes nothing from beside or behind its mouths',
        beside.state.kind === 'ground' && behind.state.kind === 'ground' && r.hopper.length === 0,
        `beside=${beside.state.kind} behind=${behind.state.kind} hopper=${r.hopper.length}`,
      );
    }

    {
      const { w, r } = stage(63, -40, -30);
      const cap = r.hopper.length;
      void cap;
      const b0 = pollen(w, -40 + bbFootprint(r.spec).front + BB_POLLEN_R + 0.2, -30);
      // fill the hopper to its cap through the real capture path, then meet one more
      run3d(w, new Map([[0, cmd({ intake: true })]]), 0.5);
      const filler: Artifact[] = [];
      while (r.hopper.length < 4) {
        const f = pollen(w, -40 + bbFootprint(r.spec).front + BB_POLLEN_R + 0.2, -30);
        filler.push(f);
        run3d(w, new Map([[0, cmd({ intake: true })]]), 0.5);
        if (filler.length > 6) break;
      }
      const extra = pollen(w, -40 + bbFootprint(r.spec).front + BB_POLLEN_R + 0.2, -30);
      const x0 = extra.pos.x;
      run3d(w, new Map([[0, cmd({ driveY: 0.6, intake: true })]]), 0.8);
      // NOT `=== 'ground'`: `derive.ts` tags a bouncing element `flight`, and a bulldozed one
      // bounces. What this asserts is that it was never TAKEN, and that it was shoved.
      check(
        'roller 3d: a FULL hopper refuses — the extra POLLEN is pushed, not pulled in',
        b0.state.kind === 'held' && r.hopper.length === 4 && extra.state.kind !== 'held' && extra.pos.x - x0 > 3,
        `first=${b0.state.kind} hopper=${r.hopper.length} extra=${extra.state.kind} pushed=${(extra.pos.x - x0).toFixed(1)}in`,
      );
    }
  }

  // ---- launch into the hive: own cell scores for the owner; the other alliance's for it -----
  //
  // `speed`/`xOffset` are additive parameters (both default to the ORIGINAL fixed values, so
  // every existing call site below is byte-identical) -- the retention lane further down reuses
  // this exact, already-correct entry geometry (staged just outside the mouth, moving inboard
  // along the tray's own v axis) at DISTANCE-SCALED entry speeds instead of re-deriving a
  // full-field ballistic approach, which measurably runs into two things outside this lane's
  // scope: a straight shot from far across the x axis crosses the OPPONENT alliance's own hive
  // frame, and the cell's closed back wall (full height) stops anything approaching from behind
  // the pivot well short of the aim point even on a steep arc -- both real, but ROBOT-AIMING
  // questions (`robot.ts`'s own turret geometry), not hive-tray ones.
  function fireIntoCell(w: World, alliance: 'red' | 'blue', color: Artifact['color'], speed = 55, xOffset = 0): number {
    // the REAL tilt for THIS alliance's hive -- red's up cell is `south` at staging, which is
    // `theta = -rest`, not `+rest`; a hardcoded sign-agnostic angle here was the bug that sent
    // an earlier version of this shot falling to the tiles well short of the cell (see this
    // lane's final report).
    const theta = hiveTiltAngle(w, alliance);
    const sideSign: 1 | -1 = w.biobuzz!.hives[alliance].up === 'north' ? 1 : -1;
    const box = hiveCellLocalBox(sideSign, alliance);
    const wCentre = (box.wMin + box.wMax) / 2;
    const startV = sideSign > 0 ? box.vMax + 2 : box.vMin - 2;
    const start = hiveWorldPoint(alliance, sideSign, theta, xOffset, startV, wCentre);
    const inward = rotate2(-sideSign * speed, 0, theta);
    const id = Math.max(...w.balls.map((b) => b.id)) + 1;
    const shot: Artifact = {
      id,
      color,
      state: { kind: 'flight', target: alliance },
      pos: { x: start.x, y: start.y },
      vel: { x: 0, y: inward.a },
      z: start.z - BB_POLLEN_R,
      vz: inward.b,
    };
    w.balls.push(shot);
    return id;
  }
  {
    const w = mkWorld3d('free', 26);
    const id = fireIntoCell(w, 'blue', 'yellow'); // blue's own up cell (north)
    for (let t = 0; t < 300; t++) step3d(w, 1 / 60, new Map());
    const settled = w.balls.find((b) => b.id === id)!;
    check(
      "launch: an element fired into the alliance's own up cell is in hives.blue.contents after settling",
      w.biobuzz!.hives.blue.contents.includes(id),
      `state=${JSON.stringify(settled.state)} contents=${JSON.stringify(w.biobuzz!.hives.blue.contents)}`,
    );
    const score = bbScoreWorld(w);
    check('launch: bbScoreWorld counts it toward blue (cellCount)', score.blue.cellCount >= 1, `cellCount=${score.blue.cellCount}`);
  }
  {
    const w = mkWorld3dPair('free', 27);
    // red's up cell is its SOUTH side (BB_HIVE_UP_STAGED.red === 'south')
    const id = fireIntoCell(w, 'red', 'yellow'); // red's own up cell (south)
    for (let t = 0; t < 300; t++) step3d(w, 1 / 60, new Map());
    check(
      "launch: an element resting in the OPPONENT's up cell counts for the opponent (realism, then the rulebook)",
      w.biobuzz!.hives.red.contents.includes(id),
      `contents=${JSON.stringify(w.biobuzz!.hives.red.contents)}`,
    );
  }

  // ---- LANE C: A ROBOT'S OWN SOLVED SHOT LANDS IN THE CELL, UNDER 3D PHYSICS -----------------
  //
  // The two checks above stage an element at the mouth on purpose, to keep the tray's own
  // geometry separate from robot aiming. THESE close the other half: no injected artifact, no
  // hand-built velocity -- a real turret build parked on the field, left to aim ITSELF (no button
  // held), then fire held. Owner playtest feedback 2026-09-18 item 4 was "the shooter is not
  // automatically aiming"; this is the 3D end of the measurement that answered it.
  //
  // ONE element in the hopper, deliberately: a full hopper tips the cell and empties it, and a
  // check reading `contents` would then see nothing and call a perfect volley a miss.
  {
    const TURRET_C = { bbMech: { launcher: { kind: 'turret' as const, mount: 'center' as const, hoodDeg: 75 }, lift: null } };
    // out along +y from blue's north cell, which is the side that cell OPENS on
    for (const [x, y] of [[BB_HIVE_X, 53.4], [BB_HIVE_X, 38.4], [BB_HIVE_X + 25, 48.4], [-30, 55]] as const) {
      const w = createBiobuzzWorld('free', 41, [setup(0, 'blue', TURRET_C)], undefined, '3d');
      const r = w.robots[0];
      r.pos.x = x;
      r.pos.y = y;
      r.heading = 0.7;
      r.vel = { x: 0, y: 0 };
      r.hopper.length = 1;
      const shot = r.hopper.length;
      const idle = new Map([[0, cmd({})]]);
      for (let t = 0; t < 90; t++) step3d(w, 1 / 60, idle); // the turret slews onto its solution
      // WHAT THE DRIVER IS SHOWN, on the tick before the trigger (items 5 + 6). The path is
      // predicted with the 2D ballistic model; the flight below is RAPIER 3D. The two agreeing is
      // what makes the preview honest in the 3D view, and it is not free — so it is measured here
      // rather than assumed, in the same worlds that measure the shot.
      const preview = solveShotPath(w, r);
      const fire = new Map([[0, cmd({ fire: true })]]);
      for (let t = 0; t < 60; t++) step3d(w, 1 / 60, fire);
      for (let t = 0; t < 240; t++) step3d(w, 1 / 60, idle); // ...and the flight lands
      const cell = w.biobuzz!.hives.blue;
      const landed = shot === 1 && r.hopper.length === 0 && cell.contents.length >= 4;
      check(
        `aim: a self-aimed turret shot from (${x.toFixed(1)}, ${y}) lands in the own CELL under 3D physics`,
        landed,
        `hopper=${r.hopper.length} contents=${JSON.stringify(cell.contents)} up=${cell.up} tipping=${cell.tipping.toFixed(2)}`,
      );
      check(
        `shot path: ...and the preview promised that shot from (${x.toFixed(1)}, ${y})`,
        preview === landed,
        `preview=${preview} landed=${landed}`,
      );
    }
  }

  // ---- LANE D: A DUMPER SCORES UNDER 3D PHYSICS ----------------------------------------------
  //
  // ⚠️ **THIS LANE HAD NO DUMPER COVERAGE AT ALL, WHICH IS WHY A DUMPER THAT COULD NOT SCORE
  // SHIPPED.** Every check above fires a TURRET, or stages an element at the cell mouth by hand.
  // A dumper fails in two ways neither of those can see, and both were live in 3D — which is
  // every server-connected match:
  //
  //   (a) its release point is INSIDE its own chassis. `launchLine` releases at
  //       `mountOrigin('back')` (x = −7.50 on a 15-in frame) at `BB_LAUNCH_Z0` = 10, which on the
  //       default `frontback` mount straddles the frame box AND the back mouth lintel — a closed
  //       3-in pocket. A 2D flight element collides with nothing, so 2D never noticed; in 3D all
  //       four elements rose ~2 in, jammed, and rode the chassis. `syncElement`'s `birthClear`
  //       fixes it, along the element's own arc so the solved trajectory survives.
  //   (b) `bbDumpSolution` converges EVERY element on ONE cell-centre point, so a simultaneous
  //       dump is a four-way pile-up in the opening. `BbShot.perDump` staggers it in 3D only.
  //
  // Measured on the 28-pose tutorial grid (`shoot`, dx 0/3/6/9 in, dy 14..38 in off the cell):
  // 0/28 before, 20/28 after — every pose from 22 in out. The four that still miss are the two
  // closest rows, where the lob clips the HIVE underside; that is the 2026-09-18 CAD ruling's own
  // documented consequence and not this bug, so this lane stands the robot back.
  {
    const DUMPER = { bbMech: { launcher: { kind: 'dumper' as const, mount: 'back' as const, hoodDeg: 45 }, lift: null } };
    /** the element's clearance from every chassis solid of every robot, in inches; < 0 is inside. */
    function chassisGap(w: World, b: Artifact): number {
      let worst = Infinity;
      const radius = b.r ?? BB_POLLEN_R;
      for (const rob of w.robots) {
        const h = rob.spec.heightIn ?? 18;
        const l = rot({ x: b.pos.x - rob.pos.x, y: b.pos.y - rob.pos.y }, -rob.heading);
        const lz = b.z + radius - ((rob.z ?? 0) + h / 2);
        for (const s of chassis3dShapes(rob.spec, h)) {
          const dx = Math.max(Math.abs(l.x - s.cx) - s.hx, 0);
          const dy = Math.max(Math.abs(l.y - s.cy) - s.hy, 0);
          const dz = Math.max(Math.abs(lz - s.cz) - s.hz, 0);
          worst = Math.min(worst, Math.sqrt(dx * dx + dy * dy + dz * dz) - radius);
        }
      }
      return worst;
    }

    // Parked on the open side of blue's up (north) CELL, back edge to the hive, hopper full.
    // Three standoffs across the range the grid says a dumper owns.
    for (const dy of [22, 30, 38]) {
      const w = createBiobuzzWorld('free', 44, [setup(0, 'blue', DUMPER)], undefined, '3d');
      const r = w.robots[0];
      r.pos = { x: BB_HIVE_X, y: BB_HIVE_CELL_DY + dy };
      r.heading = Math.PI / 2; // back edge (−x robot) faces the hive
      r.vel = { x: 0, y: 0 };
      r.angVel = 0;
      const load = r.hopper.length;
      // ONLY THIS ROBOT'S OWN LOAD is measured. `world.balls` also carries the field's elements
      // and the SPILL a tipping cell drops, and both pass through `flight` next to the chassis —
      // counting those would make every number here about somebody else's element.
      const mine = new Set(
        w.balls.filter((b) => b.state.kind === 'held' && b.state.robot === 0).map((b) => b.id),
      );
      const fire = new Map([[0, cmd({ fire: true })]]);
      const born = new Set<number>();
      const pending = new Set<number>();
      const peak = new Map<number, number>();
      let minGap = Infinity;
      let bestPollen = 0;
      const releaseTicks: number[] = [];
      let hopper = load;
      for (let t = 0; t < 420; t++) {
        step3d(w, 1 / 60, fire);
        if (r.hopper.length < hopper) {
          releaseTicks.push(t);
          hopper = r.hopper.length;
        }
        for (const b of w.balls) {
          if (b.state.kind !== 'flight' || !mine.has(b.id)) continue;
          // ⚠️ MEASURED ONE TICK LATE, ON PURPOSE. `bbLaunch` runs in the GAMEPLAY stage at the
          // end of a tick, so the tick an element first reads `flight` is the tick its JSON was
          // written and BEFORE any body exists for it; `birthClear` runs in the NEXT tick's sync.
          // Sampling the release tick would measure the raw muzzle point, which is inside the
          // chassis by construction and is the thing being fixed rather than the thing to assert.
          if (pending.has(b.id)) {
            minGap = Math.min(minGap, chassisGap(w, b));
            pending.delete(b.id);
          } else if (!born.has(b.id)) pending.add(b.id);
          born.add(b.id);
          peak.set(b.id, Math.max(peak.get(b.id) ?? 0, b.z));
        }
        // LIVE, not at the end: the CELL empties itself when it tips, so a run that scored
        // perfectly reads zero afterwards.
        const kinds = new Map(w.balls.map((b) => [b.id, b.color]));
        bestPollen = Math.max(
          bestPollen,
          w.biobuzz!.hives.blue.contents.filter((id) => kinds.get(id) === 'yellow').length,
        );
      }
      const cell = w.biobuzz!.hives.blue;
      check(
        `dump 3d: a dumper parked ${dy} in off its own CELL empties its hopper`,
        load >= 1 && r.hopper.length === 0 && born.size === load,
        `load=${load} hopper=${r.hopper.length} flew=${born.size}`,
      );
      check(
        `dump 3d: ...and every element is BORN CLEAR of the chassis that threw it (${dy} in)`,
        minGap > 0,
        `worst gap ${minGap === Infinity ? 'n/a' : `${minGap.toFixed(2)}in`}`,
      );
      // THE BUG'S OWN SIGNATURE, and the reason this is a height and not a score: an element born
      // in the pocket apexed at z ≈ 12 and rode the chassis. Reaching the bottom of the opening
      // band means it genuinely flew.
      const apex = Math.min(...[...peak.values()]);
      check(
        `dump 3d: ...and every one of them reaches the CELL opening band (${dy} in)`,
        apex >= BB_HIVE_OPEN_Z[0],
        `lowest apex ${apex.toFixed(1)}in, band starts ${BB_HIVE_OPEN_Z[0].toFixed(1)}in`,
      );
      // ONE ELEMENT PER RELEASE, `BB_DUMP_STAGGER_S` apart — `perDump`. Simultaneous releases
      // would show up here as a single tick in `releaseTicks`.
      const gaps = releaseTicks.slice(1).map((t, i) => t - releaseTicks[i]);
      check(
        `dump 3d: ...released ONE at a time, ${BB_DUMP_STAGGER_S}s apart (${dy} in)`,
        releaseTicks.length === load && gaps.every((g) => g >= Math.round(BB_DUMP_STAGGER_S * 60) - 1),
        `ticks=${JSON.stringify(releaseTicks)}`,
      );
      check(
        `dump 3d: ...and POLLEN lands in blue's own CELL (${dy} in)`,
        bestPollen > 0,
        `most POLLEN held at once=${bestPollen} tips=${cell.tips}`,
      );
    }

    // ⚠️ THE 2D PIPELINE IS PERMANENT, AND `perDump` IS WHAT COULD HAVE BROKEN IT. Nothing in 2D
    // sets the field, so the dumper branch must still throw the WHOLE hopper on ONE tick. A
    // shared `launchClearance()` was tried for (a) and reverted for exactly this reason (it took
    // 3D to 3/28 and 2D to 24/28), so the claim is asserted rather than remembered.
    {
      const w = createBiobuzzWorld('free', 44, [setup(0, 'blue', DUMPER)], undefined, '2d');
      const r = w.robots[0];
      r.pos = { x: BB_HIVE_X, y: BB_HIVE_CELL_DY + 30 };
      r.heading = Math.PI / 2;
      r.vel = { x: 0, y: 0 };
      const load = r.hopper.length;
      check('dump 2d: the fixture is really the 2D pipeline', biobuzzPhysics(w) === '2d', biobuzzPhysics(w));
      biobuzzStep(w, 1 / 60, new Map([[0, cmd({ fire: true })]]));
      check(
        'dump 2d: with no perDump the WHOLE hopper still leaves on one tick',
        load >= 2 && r.hopper.length === 0,
        `load=${load} → ${r.hopper.length}`,
      );
    }
  }

  // ---- height clearance under the down cell, against the CAD's OWN measured clearance --------
  {
    const theta = Math.PI / 6;
    // the reference landmark is the CAD tray's OWN floor hull for the down cell (whatever local
    // height the one rigid CAD shape actually puts it at), not the Day 1 algebraic bracket
    // calibrated to 25.5in by hand -- see `hiveCellLocalBox`'s and `buildHiveTray3d`'s comments
    // on dropping that bracket once the CAD hulls give the real clearance.
    //
    // THE WORST-CASE (LOWEST) CORNER ALONG THE DOWN CELL'S OWN v-SPAN, not its midpoint -- a
    // robot driving THROUGH the down cell crosses the whole span, so the binding obstruction is
    // whichever end sits lower, and a robot's actual headroom is set by the LOWER of the two,
    // not their average. It measures 31.98, which is `BB_HIVE_BOTTOM_Z` itself: since the
    // 2026-09-18 ruling that constant IS the CAD's own down-cell floor, so the landmark and the
    // constant are the same number by construction rather than by coincidence.
    const downBox = hiveCellLocalBox(-1, 'blue');
    const cornerOuter = hiveWorldPoint('blue', -1, theta, 0, downBox.vMin, downBox.wMin);
    const cornerInner = hiveWorldPoint('blue', -1, theta, 0, downBox.vMax, downBox.wMin);
    const bracket = cornerOuter.z <= cornerInner.z ? cornerOuter : cornerInner;
    // ⚠️ THIS USED TO BE A DISAGREEMENT AND IS NOT ANY MORE. The CAD's down-cell clearance
    // (bracket.z) did not match the manual's BB_HIVE_BOTTOM_Z of 25.5, and the gap was the story:
    // one rigid tilting bar cannot put the up-cell opening at BB_HIVE_OPEN_Z and the down-cell
    // floor at 25.5 at the same time on this hive's own measured dimensions. The owner ruled the
    // CAD authoritative on 2026-09-18, so BB_HIVE_BOTTOM_Z IS 31.981 and the two agree. The
    // MEASUREMENTS check below asserts that strictly; this test asserts what the built collider
    // does about robots.
    //
    // ⚠️ THIS NUMBER HAS MOVED BEFORE, WHEN `obliqueBoxCollider` (`sim3d/bodies.ts`) FIXED
    // THE HIVE-TILT BUG THE OWNER PLAYTEST REPORTED ("visually tilted more than where the balls
    // end up", "spill out too easily"): the CAD box's `vMin..wMax` are captured AT the tray's
    // OWN tilt, and the PRE-FIX code built an axis-aligned collider straight from them with NO
    // rotation baked in, which is exactly flat (untilted) in world space the instant the body's
    // own kinematic rotation is 0 -- which is AT REST, the one moment the tilt matters most. That
    // bug flattened BOTH cells: the up cell's floor read the same world z at its inner and outer
    // edge (no slope to hold a landed element against the divider -- the actual GAMEPLAY bug),
    // and the down cell's clearance came out ~32in, comfortably over `BB3_HEIGHT_MAX` (29),
    // purely because the true CAD tilt was never applied to it either. The fix makes BOTH cells
    // genuinely tilted at rest. What the correctly-tilted CAD tray then says is 31.98 -- ABOVE
    // BB3_HEIGHT_MAX (29) -- so a legal max-height robot DOES clear the down cell, which is what
    // G409's drive-under assumes and what the measurements check asserts against the lowest hive
    // structure of any kind (the Goal Rib, 30.65). The third check below is the non-vacuity
    // proof: at 34.98in the same robot IS stopped, so the collider is real and not a no-op.
    function driveAtBracket(heightIn: number): number {
      const w = mkWorld3d('free', 28);
      const r = w.robots[0];
      // set directly on the coerced spec, bypassing `coerceSpec` -- this test wants an exact
      // heightIn without depending on `BB3_HEIGHT_MIN`/`MAX` clamping it, and `coerceSpec`'s
      // own heightIn carry-across (the fix for the `heightIn` seam bug this lane's final
      // report describes) is exercised separately by the `heightIn:` checks above.
      r.spec = { ...r.spec, heightIn };
      // ⚠️ 30, NOT 40, AND THE FLOWER IS WHY (Day 2 lane A). `bracket.y` is −17.79, so a 40-in
      // run-up starts the robot at y = −57.79 — and its collider is `robotExtents` (the 2D
      // solve's footprint, intake reach included, 12 in behind the centre), so its rear corner
      // sat at y = −69.79, INSIDE flower F4's own on-tile footprint (x 20.42…26.37,
      // y −70.64…−65.63). It always did: the pipes' hulls were already touching it at tick 0,
      // and this check passed anyway because a vertical hull is something a robot slides along.
      // The ring PLATES are horizontal, so the same overlap became a 0.354-in step the robot
      // CLIMBED — measured, z rose to 0.337 in ten ticks and the run never recovered, stopping
      // 5.5 in short of the hive. The obstacle is real and correctly placed (the plate rect IS
      // `BB_FLOWER_FOOT`, the same box the 2D collider set uses); the START POSE was the bug.
      // 30 in of run-up clears F4 by 3.8 in and still reaches 80 in/s well before the hive.
      const startY = bracket.y - 30;
      r.pos.x = bracket.x;
      r.pos.y = startY;
      r.heading = Math.atan2(bracket.y - startY, bracket.x - r.pos.x);
      r.vel.x = 0;
      r.vel.y = 0;
      const forward = cmd({ driveY: 1 });
      for (let t = 0; t < 180; t++) step3d(w, 1 / 60, new Map([[0, forward]]));
      return w.robots[0].pos.y;
    }
    const y18 = driveAtBracket(18);
    const y29 = driveAtBracket(29);
    // a height comfortably PAST the CAD's own measured clearance (bracket.z - the pivot height,
    // in `hiveCellLocalBox`'s frame this is just `bracket.z` itself since chassis bottom sits at
    // z 0) -- an illegal height for a real robot, but the point of this check is proving the
    // collider is a REAL, working obstruction, not testing a legal build.
    const yTooTall = driveAtBracket(bracket.z + 3);
    check(
      'height: an 18-in robot drives past the down-cell clearance point',
      y18 > bracket.y + 5,
      `18in final y=${y18.toFixed(2)}, bracket y=${bracket.y.toFixed(2)}`,
    );
    check(
      'height: a 29-in (legal max) robot CLEARS the down cell -- the CAD tray puts its floor at ' +
        `BB_HIVE_BOTTOM_Z ${BB_HIVE_BOTTOM_Z}, above BB3_HEIGHT_MAX (${BB3_HEIGHT_MAX})`,
      y29 > bracket.y + 5,
      `29in final y=${y29.toFixed(2)}, bracket y=${bracket.y.toFixed(2)}, clearance z=${bracket.z.toFixed(2)}`,
    );
    check(
      'height: a robot taller than the CAD-measured clearance IS stopped by it -- the collider is real, not a no-op',
      yTooTall < bracket.y - 2,
      `height=${(bracket.z + 3).toFixed(2)}in final y=${yTooTall.toFixed(2)}, bracket y=${bracket.y.toFixed(2)}`,
    );
  }

  // ---- tip: a preloaded up cell trips the shared timer, the tray swings, contents empty ----
  {
    const w = mkWorld3d('free', 29);
    const theta = Math.PI / 6;
    let nextId = Math.max(...w.balls.map((b) => b.id)) + 1;
    const placedIds: number[] = [];
    const n = BB_TIP_POLLEN[0] + 1; // one over the 0-nectar threshold (8) -- guaranteed to tip
    for (let i = 0; i < n; i++) {
      const box = hiveCellLocalBox(1, 'blue');
      const v = box.vMin + 2 + (i % 4) * 2.2;
      const x = -6 + Math.floor(i / 4) * 4;
      const w0 = box.wMin + BB_POLLEN_R + 0.3;
      const p = hiveWorldPoint('blue', 1, theta, x, v, w0);
      const id = nextId++;
      placedIds.push(id);
      w.balls.push({
        id,
        color: 'yellow',
        state: { kind: 'ground' },
        pos: { x: p.x, y: p.y },
        vel: { x: 0, y: 0 },
        z: p.z - BB_POLLEN_R,
        vz: 0,
      });
    }
    // let the pile settle and derive tag it into the cell (BB3_REST_TICKS worth, generously).
    let tipTick = -1;
    for (let t = 0; t < 600 && tipTick < 0; t++) {
      step3d(w, 1 / 60, new Map());
      if (w.biobuzz!.hives.blue.tipping > 0 || w.biobuzz!.hives.blue.up !== 'north') tipTick = t;
    }
    check('tip: the shared timer trips once the up cell is loaded past its threshold', tipTick >= 0, `never tripped by tick 600`);
    // run past the whole swing (4s = 240 ticks) plus slack, then check every placed id has left
    // the cell and the tray flipped.
    for (let t = 0; t < 300; t++) step3d(w, 1 / 60, new Map());
    check('tip: the tray completed its swing (up flipped to south)', w.biobuzz!.hives.blue.up === 'south');
    const stillIn = placedIds.filter((id) => w.biobuzz!.hives.blue.contents.includes(id));
    check('tip: every previously-contained element left the cell', stillIn.length === 0, `${stillIn.length} still listed: ${JSON.stringify(stillIn)}`);
    check('tip: the up cell reads empty after the swing', w.biobuzz!.hives.blue.contents.length === 0);
    check('tip: element count is unchanged (56 + the ones this check added)', w.balls.length === 56 + n);
  }

  // ---- rest-pose: the tray's tilt convention, per alliance -- the hive-tilt fix itself --------
  //
  // The owner's playtest reported two hive bugs: the SCENE visually tilts more than where balls
  // end up, and landed elements spill out too easily. Both traced to ONE bug in the CAD-collider
  // path: `hiveCellLocalBox`'s `vMin..wMax` are captured AT the tray's own tilt (`refTheta`), and
  // the PRE-FIX code built an axis-aligned collider straight from those numbers with no further
  // rotation baked in -- exactly FLAT (untilted) in world space the instant the body's own
  // kinematic rotation (`hiveTiltAngle - hiveTrayRefTheta`) is 0, which is AT REST, the one moment
  // the tilt matters most. `obliqueBoxCollider` (`sim3d/bodies.ts`) fixes it by baking `refTheta`
  // into the collider's own geometry (a FIXED Rapier collider-local rotation, set once at
  // creation -- never a live `setNextKinematicRotation` on the collider itself, which is the
  // documented, measured source of an earlier attempt's kinematic instability). These checks
  // assert the fixed geometry directly, so a regression here fails loudly rather than only
  // showing up as a gameplay symptom three steps removed. Worked example, both alliances, per
  // `BB_HIVE_UP_STAGED`: red's up cell is `south` (theta = -30deg at rest), blue's is `north`
  // (theta = +30deg) -- `hiveTiltAngle`'s own JSDoc carries the same two cases.
  for (const a of ['red', 'blue'] as const) {
    const w = mkWorld3d('free', a === 'red' ? 460 : 461);
    step3d(w, 1 / 60, new Map()); // one tick: builds the engine and runs applyHiveTilt once
    const theta = hiveTiltAngle(w, a);
    const refTheta = hiveTrayRefTheta(a);
    const rest = (a === 'red' ? -1 : 1) * (Math.PI / 6); // BB_HIVE_UP_STAGED: red south up, blue north up
    // ⚠️ AND THE CAD'S OWN `refTheta` IS READ HERE, not only the constant. `hiveTrayRefTheta`
    // lives in the LIGHT `sim3d/tilt.ts` now (the 3D scene subtracts it on a frame where no 3D
    // physics is loaded, so it may not touch the CAD collider set) and returns a plain 0. That is
    // only true as long as the export really is un-tilted, which is what `cadTrayRefTheta` says —
    // so this check is what keeps the two in step. A future field revision exported at some other
    // pose fails HERE, loudly, instead of silently drawing the tray at double its tilt.
    check(
      `rest-pose: ${a}'s exported tray needs NO reference-angle correction (refTheta === 0)`,
      refTheta === 0 && cadTrayRefTheta(a) === refTheta,
      `refTheta=${refTheta} cad=${cadTrayRefTheta(a)}`,
    );
    check(
      `rest-pose: ${a}'s hive body rotation IS the absolute tilt at rest (CAD colliders on; up='${w.biobuzz!.hives[a].up}')`,
      // 1e-4, NOT 1e-9, SINCE DAY 2, AND THE TOLERANCE IS THE POINT RATHER THAN A CONCESSION.
      // Under the DYNAMIC tray `hiveTiltAngle` no longer computes an angle, it READS ONE BACK:
      // `hives[a].angle`, written by the readback at `BB3_ROUND` like every other solved number,
      // because "the JSON is the truth" is what makes a snapshot, a replay and a prediction world
      // seat the tray identically. A rounded number cannot agree to 1e-9 with an exact one, and
      // demanding that it does would be demanding that the tray's pose NOT be serialised.
      // (On the kinematic path the value is still the timer's own exact formula and the residual
      // is 0, so this tolerance costs that path nothing.)
      Math.abs(theta - refTheta - rest) <= BB3_ROUND,
      `theta - refTheta=${(theta - refTheta).toFixed(6)} expected=${rest.toFixed(6)}`,
    );
    const upSide: 1 | -1 = w.biobuzz!.hives[a].up === 'north' ? 1 : -1;
    const box = hiveCellLocalBox(upSide, a);
    // the OUTER (open/mouth) end of the cell is whichever v-extreme sits farther from the pivot
    const outerV = Math.abs(box.vMax) > Math.abs(box.vMin) ? box.vMax : box.vMin;
    const innerV = outerV === box.vMax ? box.vMin : box.vMax;
    const outerZ = BB3_HIVE_PIVOT_Z + rotate2(outerV, box.wMin, theta).b;
    const innerZ = BB3_HIVE_PIVOT_Z + rotate2(innerV, box.wMin, theta).b;
    check(
      `rest-pose: ${a}'s up cell (${w.biobuzz!.hives[a].up}) floor slopes DOWN toward the divider -- the open (mouth) edge reads HIGHER than the inner (divider) wall base`,
      outerZ > innerZ,
      `outer(mouth) z=${outerZ.toFixed(2)} inner(divider) z=${innerZ.toFixed(2)}`,
    );
  }

  // ---- retention: realistic shots at typical distances stay in the up cell ------------------
  //
  // A shot fired along `fireIntoCell`'s own (already-correct) entry geometry, at the entry speed
  // a REAL turret shot would carry from `d` inches out (`bbSolveShot`, `robot.ts`, zero elevation
  // gain: `sqrt(g*d)`) -- see `fireIntoCell`'s own header for why a full-field ballistic
  // reproduction from an actual muzzle position is a ROBOT-AIMING question (crosses the opponent's
  // hive frame; the cell's own closed back wall stops an approach from behind the pivot), not a
  // hive-tray one, and is deliberately not what this measures. Retention under ~90% at any of
  // these distances is the owner-reported "spills out too easily" bug; the fix
  // (`obliqueBoxCollider`'s true incline, the tray's restitution now governing under a `Min`
  // combine rule) measures 100% at all three.
  for (const d of [24, 48, 72]) {
    const speed = bbSolveShot(d, 0).speed;
    let retained = 0;
    const total = 20;
    for (let shot = 0; shot < total; shot++) {
      const w = mkWorld3d('free', 470 + shot);
      w.balls.length = 0; // isolate: only this one shot's element exists
      const xJitter = ((shot % 5) - 2) * 3; // deterministic spread across the mouth's own width
      const id = fireIntoCell(w, 'blue', 'yellow', speed, xJitter);
      for (let t = 0; t < 300; t++) step3d(w, 1 / 60, new Map());
      if (w.biobuzz!.hives.blue.contents.includes(id)) retained++;
    }
    check(
      `retention: a ${d}in shot (entry speed ${speed.toFixed(0)}in/s) into the own up cell stays put -- >= 90% of ${total}`,
      retained / total >= 0.9,
      `${retained}/${total} retained`,
    );
  }

  // ---- load table: what tips and what doesn't, and no spill before the tip ------------------
  //
  // The manual's own load table (Event Field Setup Guide §12.3, `config.ts`'s `BB_TIP_POLLEN`):
  // 8 pollen tips, 7 does not; 3 pollen + 3 nectar tips, 3 + 2 does not. Each row runs 10s (600
  // ticks) so a tipping tray completes its whole swing and a non-tipping one proves it never
  // starts one -- this is the OTHER half of the owner's "spills out too easily" report: a load
  // UNDER the table's threshold must not spill either, which the pre-fix flat floor (no downhill
  // slope holding anything against the divider) put at real risk.
  {
    function loadCell(pollen: number, nectar: number): { tipped: boolean; stillIn: number; tripLoad: string } {
      const w = mkWorld3d('free', 480 + pollen * 10 + nectar);
      w.balls.length = 0; // isolate: only this row's elements exist
      const alliance = 'blue' as const;
      const theta = hiveTiltAngle(w, alliance);
      const sideSign: 1 | -1 = w.biobuzz!.hives[alliance].up === 'north' ? 1 : -1;
      const box = hiveCellLocalBox(sideSign, alliance);
      const n = pollen + nectar;
      const cols = 4;
      const wLocal = box.wMin + BB_POLLEN_R + 0.5; // one row, a small (x, v) grid; physics stacks
      const ids: number[] = [];
      for (let i = 0; i < n; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = (col - (cols - 1) / 2) * 4;
        const v = box.vMin + 2 + row * 3;
        const p = hiveWorldPoint(alliance, sideSign, theta, x, v, wLocal);
        const id = i + 1;
        ids.push(id);
        const el: Artifact = {
          id,
          color: i < pollen ? 'yellow' : 'blue',
          state: { kind: 'ground' },
          pos: { x: p.x, y: p.y },
          vel: { x: 0, y: 0 },
          z: p.z - BB_POLLEN_R,
          vz: 0,
        };
        w.balls.push(el);
      }
      const startUp = w.biobuzz!.hives[alliance].up;
      let tripLoad = '';
      for (let t = 0; t < 600; t++) {
        step3d(w, 1 / 60, new Map());
        if (tripLoad === '' && w.biobuzz!.hives[alliance].tipping > 0) {
          tripLoad = `${w.biobuzz!.hives[alliance].contents.length} elements`;
        }
      }
      const tipped = w.biobuzz!.hives[alliance].up !== startUp;
      const stillIn = ids.filter((id) => w.biobuzz!.hives[alliance].contents.includes(id)).length;
      return { tipped, stillIn, tripLoad };
    }

    const rows: readonly [number, number, boolean][] = [
      [3, 0, false],
      [7, 0, false],
      [8, 0, true],
      [3, 2, false],
      [3, 3, true],
    ];
    for (const [pollen, nectar, expectTip] of rows) {
      const r = loadCell(pollen, nectar);
      const label = `${pollen}p+${nectar}n`;
      console.log(`[smoke-bb sim3d] load table: ${label} tipped=${r.tipped} trip-load=${r.tripLoad || 'n/a'}`);
      check(`load table: ${label} ${expectTip ? 'TIPS' : 'does NOT tip'} (manual, BB_TIP_POLLEN)`, r.tipped === expectTip, `tipped=${r.tipped}`);
      if (expectTip) {
        check(`load table: ${label} -- every element left the (now down) cell within the swing`, r.stillIn === 0, `${r.stillIn} still in`);
      } else {
        check(
          `load table: ${label} -- every element stayed for 10s, nothing spilled, tray did not move`,
          r.stillIn === pollen + nectar,
          `${r.stillIn}/${pollen + nectar} stayed`,
        );
      }
    }
  }

  // ---- kinematic inertness: a resting element is not kicked by an unchanged tray rotation ----
  //
  // `applyHiveTilt` (`engine.ts`) calls `setNextKinematicRotation` every tick, unconditionally,
  // including on a settled tray whose angle has not changed since the last tick. A resting
  // element's velocity must stay EXACTLY 0 through that -- confirming Rapier is inert on a
  // repeated, unchanged kinematic target rather than re-waking or perturbing the body underneath.
  {
    const w = mkWorld3d('free', 490);
    w.balls.length = 0;
    const alliance = 'blue' as const;
    const theta = hiveTiltAngle(w, alliance);
    const sideSign: 1 | -1 = w.biobuzz!.hives[alliance].up === 'north' ? 1 : -1;
    const box = hiveCellLocalBox(sideSign, alliance);
    const wLocal = box.wMin + BB_POLLEN_R + 0.5;
    const ids = [1, 2, 3];
    for (const [i, id] of ids.entries()) {
      const p = hiveWorldPoint(alliance, sideSign, theta, (i - 1) * 4, box.vMin + 2, wLocal);
      const el: Artifact = {
        id,
        color: 'yellow',
        state: { kind: 'ground' },
        pos: { x: p.x, y: p.y },
        vel: { x: 0, y: 0 },
        z: p.z - BB_POLLEN_R,
        vz: 0,
      };
      w.balls.push(el);
    }
    for (let t = 0; t < 60; t++) step3d(w, 1 / 60, new Map()); // settle + tag into the cell
    const settledIn = ids.filter((id) => w.biobuzz!.hives[alliance].contents.includes(id)).length;
    let maxSpeed = 0;
    for (let t = 0; t < 600; t++) {
      step3d(w, 1 / 60, new Map());
      for (const id of ids) {
        const b = w.balls.find((x) => x.id === id);
        if (!b) continue;
        const speed = Math.sqrt(b.vel.x * b.vel.x + b.vel.y * b.vel.y + b.vz * b.vz);
        if (speed > maxSpeed) maxSpeed = speed;
      }
    }
    check('kinematic inertness: 3 staged elements settle into the up cell', settledIn === 3, `${settledIn}/3`);
    check(
      'kinematic inertness: a resting element stays at exactly 0 velocity over 600 further ticks of an unchanged tray target',
      maxSpeed === 0,
      `max speed observed ${maxSpeed}`,
    );
  }

  // ---- twelve-probe agreement: the CAD colliders vs the Day 1 fallback, same world ---------
  //
  // `__setFieldCollidersOverrideForTests` (`sim3d/bodies.ts`) forces every CAD-vs-fallback
  // branch in `buildStatics3d`/`hiveCellLocalBox` to one side regardless of `BB3_FIELD_
  // COLLIDERS`, so two engines can be built from the SAME staged world -- one CAD, one
  // fallback -- and compared directly. `world3d.projectPoint(p, false)` gives the nearest
  // collider surface REGARDLESS of which side of it `p` sits on, so "distance to nearest
  // static" is well-defined even for a probe that ends up just inside one engine's geometry.
  {
    function builtEngine(cadOn: boolean, seed: number) {
      __setFieldCollidersOverrideForTests(cadOn);
      try {
        const w = mkWorld3d('free', seed);
        step3d(w, 1 / 60, new Map()); // settle the kinematic tray's REAL rotation once
        return engineFor(w);
      } finally {
        __setFieldCollidersOverrideForTests(null); // never left set -- see that function's header
      }
    }
    const cad = builtEngine(true, 40);
    const fallback = builtEngine(false, 41);

    function nearestDist(e: ReturnType<typeof builtEngine>, p: { x: number; y: number; z: number }): number {
      const proj = e.world3d.projectPoint(p, false);
      if (!proj) return Infinity;
      const dx = p.x - proj.point.x;
      const dy = p.y - proj.point.y;
      const dz = p.z - proj.point.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    const barX = (BB_FRAME_BAR_IN + BB_FRAME_BAR_OUT) / 2;
    // the fallback's own predicted position for blue's up-cell floor/back wall (theta = the
    // rest tilt, up = north at staging) -- the FIXED probe point both engines are measured
    // against; see the header on why the tray pair gets its own wide tolerance below.
    const trayTheta = Math.PI / 6;
    const fbFloorLocal = rotate2(15.44, 0, trayTheta); // BB3_HIVE_ARM, w = 0 (fallback wMin)
    const fbBackLocal = rotate2(9.42, 7, trayTheta); // near the fallback box's inner v, mid w

    const probes: { name: string; point: { x: number; y: number; z: number }; tol: number }[] = [
      // walls are now ALWAYS built at the shared constants regardless of `BB3_FIELD_COLLIDERS`
      // (owner correction, `buildStatics3d`'s own comment), so the CAD and fallback engines
      // build the IDENTICAL wall colliders here -- back to the default 0.5in tolerance.
      { name: 'wall:left', point: { x: -BB_HALF_X + 2, y: 0, z: 6 }, tol: 0.5 },
      { name: 'wall:right', point: { x: BB_HALF_X - 2, y: 0, z: 6 }, tol: 0.5 },
      { name: 'wall:rear', point: { x: 0, y: BB_HALF_Y - 2, z: 6 }, tol: 0.5 },
      { name: 'wall:audience', point: { x: 0, y: -BB_HALF_Y + 2, z: 6 }, tol: 0.5 },
      { name: 'floor:centre', point: { x: 0, y: 0, z: 3 }, tol: 0.5 },
      // ⚠️ THE THREE FRAME PROBES AND THE F1 FOOT ARE RE-BASED ON THE NEW GEOMETRY, with a wide,
      // NAMED tolerance, for the same reason the two tray probes already had one: the CAD path is
      // SUPPOSED to differ here now. The fallback still builds the 2D field's single frame-BAR box
      // (one slab from the floor to the pivot across the whole `BB_FRAME_BAR_IN..OUT` span); the
      // CAD path builds the real parts -- two diagonal A-frame legs, a foot bar, two feet, the
      // Churro braces -- which do not fill that span, because the space between them is the
      // drive-under G409 assumes. A tight tolerance here would fail on exactly the correction this
      // pass makes. Measured deltas at the time of writing: 2.375 / 1.286 / 2.375 in.
      { name: 'frame:red-bar@y0 (CAD real legs vs fallback slab -- see header)', point: { x: -barX, y: 0, z: 5 }, tol: 4.0 },
      { name: 'frame:red-bar@y15 (CAD real legs vs fallback slab -- see header)', point: { x: -barX, y: 15, z: 5 }, tol: 4.0 },
      { name: 'frame:blue-bar@y0 (CAD real legs vs fallback slab -- see header)', point: { x: barX, y: 0, z: 5 }, tol: 4.0 },
      {
        name: 'tray:blue-up-floor (CAD intentionally differs -- see header)',
        point: { x: BB_HIVE_X, y: fbFloorLocal.a, z: BB3_HIVE_PIVOT_Z + fbFloorLocal.b },
        tol: 9.0,
      },
      {
        name: 'tray:blue-up-back (CAD intentionally differs -- see header)',
        point: { x: BB_HIVE_X, y: fbBackLocal.a, z: BB3_HIVE_PIVOT_Z + fbBackLocal.b },
        tol: 9.0,
      },
      // the flower feet: the CAD path now carries a true hull per SUPPORT PART (four HIPS pipes, a
      // backstop, two peanut supports, two brackets) instead of one AABB per part TYPE, and the
      // bore itself sits ~1.4in from `BB_FLOWERS` (the field-size open finding, audit §7), so a
      // sub-inch agreement with the fallback's single foot box is not the right bar. Measured
      // delta at the time of writing: 0.759 in at F1, 0.000 at F3.
      { name: 'flower:F1-foot (CAD per-part hulls vs fallback foot box)', point: { x: BB_FLOWERS[0].x - BB_FLOWER_D + 2, y: BB_FLOWERS[0].y, z: 1 }, tol: 1.5 },
      { name: 'flower:F3-foot (CAD per-part hulls vs fallback foot box)', point: { x: BB_FLOWERS[2].x - BB_FLOWER_D - 2, y: BB_FLOWERS[2].y, z: 1 }, tol: 1.5 },
    ];
    check('twelve-probe agreement: exactly twelve probes defined', probes.length === 12, `${probes.length}`);

    const rows = probes.map((p) => {
      const dCad = nearestDist(cad, p.point);
      const dFallback = nearestDist(fallback, p.point);
      const delta = Math.abs(dCad - dFallback);
      return { ...p, dCad, dFallback, delta };
    });
    console.log('[smoke-bb sim3d] twelve-probe agreement (CAD vs Day 1 fallback):');
    for (const r of rows) {
      console.log(
        `  ${r.name.padEnd(48)} cad=${r.dCad.toFixed(3)}in fallback=${r.dFallback.toFixed(3)}in delta=${r.delta.toFixed(3)}in (tol ${r.tol}in)`,
      );
    }
    for (const r of rows) {
      check(
        `twelve-probe: ${r.name} agrees within ${r.tol}in`,
        r.delta <= r.tol,
        `cad=${r.dCad.toFixed(3)} fallback=${r.dFallback.toFixed(3)} delta=${r.delta.toFixed(3)}`,
      );
    }
    // WALL PROBES ARE BACK AT THE DEFAULT 0.5in TOLERANCE: the 3D physics wall collider is now
    // ALWAYS built at the shared BB_HALF_X/Y constants regardless of `BB3_FIELD_COLLIDERS`
    // (owner correction -- `buildStatics3d`'s own comment), so the CAD and fallback engines
    // agree exactly here. The CAD's own MEASURED wall trimesh (~70.674in vs the constants' 72)
    // is a separate, printed-only open finding in the measurements-vs-config check below; it was
    // never a candidate for the 3D collider itself, which every other system is keyed to 72 for.
    //
    // ⚠️ THE TWO TRAY PROBES USE A 9.0in TOLERANCE, NOT 0.5in, ON PURPOSE: the CAD tray is
    // SUPPOSED to differ from the Day 1 algebraic box here -- that difference is the entire
    // point of this switch-over (the file header on `hiveCellLocalBox`/`buildHiveTray3d`: the
    // Day 1 box's up-cell opening bottom read ~55in against the manual's 53.5, and its down-cell
    // floor read ~32in against 25.5, both APPROX; the CAD's own equivalents read 47.05 and
    // 31.96 -- see the measurements check). A TIGHT tolerance here would either fail on the
    // intended correction or (worse) silently pass because both sides happened to be close by
    // coincidence; a wide, named, printed tolerance is the honest version of this probe pair.
  }

  // ---- measurements vs config, and the ONE-GEOMETRY check ----------------------------------
  //
  // Two different jobs in one block. (1) Assert that every geometry constant IS what the CAD
  // measures -- owner ruling, 2026-09-18: "the CAD is authoritative for dimensions". (2) Assert
  // that the PICTURE and the PHYSICS are the same geometry -- the owner's "the balls are on a
  // different plane than the actual bottom of the hive", turned into a check.
  //
  // WARNING: THESE ROWS WERE WIDE, PRINT-ONLY AND LABELLED "OPEN FINDING", AND ARE NOT ANY MORE.
  // The field size (+-70.674, not 72), the tile pitch (23.528, not 24), the four flower bores and
  // the down-cell floor (31.981, not 25.5) were all reported under tolerances between 0.6 and 7
  // inches while the owner decided what to do about them. The ruling moved the constants, so the
  // tolerance is `TOL` below -- tight enough that a re-run of `npm run field-cad` which moves any
  // of them and does NOT regenerate `fieldDims.gen.ts` fails here.
  //
  // Nothing was loosened to make this pass: the deltas these rows measure went to 0.000, because
  // `config.ts` now reads the generated file the measurements themselves produce.
  {
    const m = fieldMeasurements;
    /** the one tolerance every CAD-vs-config row is held to now (in). Not zero, because the
     * generated file rounds to 1e-3 and `config.ts` projects some of it through a cosine. */
    const TOL = 0.25;
    function checkClose(name: string, actual: number, expected: number, tol: number): void {
      const delta = Math.abs(actual - expected);
      check(`measurements: ${name}`, delta <= tol, `CAD=${actual.toFixed(3)} config=${expected.toFixed(3)} delta=${delta.toFixed(3)} (tol ${tol})`);
    }

    checkClose('hive pivot z', m.hive.pivotZ, BB3_HIVE_PIVOT_Z, TOL);
    for (const a of ['red', 'blue'] as const) {
      const t = m.hive.trays[a];
      checkClose(`${a} tray capture tilt is exactly the manual's 30deg`, Math.abs(t.captureThetaDeg), 30, 0.01);
      // A WRONG CAPTURE ANGLE READS AS A THICK SHEET. `Hive Goal Back Skin` is a flat 0.020-in
      // plate; un-tilting the tray by the right angle leaves it 0.020 in thick in the local `v`
      // axis, and by any other angle spreads it over inches. This is the one number that proves
      // the whole tray export is in the frame it claims to be.
      check(
        `measurements: ${a} tray back-skin residual thickness proves the un-tilt (a wrong angle reads THICK)`,
        t.backSkinThicknessIn !== null && t.backSkinThicknessIn <= 0.1,
        `thickness=${t.backSkinThicknessIn}in`,
      );
      checkClose(`${a} pivot x`, Math.abs(t.pivot[0]), BB_HIVE_X, TOL);
    }

    // THE UP-CELL OPENING -- the CAD and the MANUAL agree here to 0.13 in ([53.375, 65.497]
    // against Fig 9-10's [53.5, 65.6]), so the ruling moved this constant by a tenth of an inch
    // and CONFIRMED the figure rather than overturning it. The earlier "[47.05, 68.85], OPEN
    // FINDING" reading was an artifact of the collider export treating a WORLD-frame AABB as a
    // tray-LOCAL extent (`docs/biobuzz/field-cad-audit.md` section 4.4) and is long closed.
    for (const a of ['red', 'blue'] as const) {
      const open = m.hive.openingZ[a];
      checkClose(`${a} up-cell opening BOTTOM vs BB_HIVE_OPEN_Z[0]`, open[0], BB_HIVE_OPEN_Z[0], TOL);
      checkClose(`${a} up-cell opening TOP vs BB_HIVE_OPEN_Z[1]`, open[1], BB_HIVE_OPEN_Z[1], TOL);
    }

    // THE DOWN-CELL CLEARANCE -- the one figure where the CAD and the manual genuinely disagree,
    // and the one the owner ruled on. `BB_HIVE_BOTTOM_Z` IS the CAD's 31.981 now; Fig 9-10's 25.5
    // is 6.48 in low, and it has to be, because one rigid bar at 30 degrees cannot put the up
    // mouth where the manual says AND the down floor where the manual says on this tray's own
    // measured dimensions. Strict from here: a CAD revision that moves it fails loudly.
    for (const a of ['red', 'blue'] as const) {
      checkClose(`${a} down-cell clearance vs BB_HIVE_BOTTOM_Z`, m.hive.downCellFloorZ[a], BB_HIVE_BOTTOM_Z, TOL);
    }
    // ...and the LOWEST structure of any kind, which is what G409's drive-under actually needs.
    // ASSERTED, not merely printed: the whole reason the 25.5 could be let go is that a legal
    // 29-in robot still clears the real assembly, and that is a claim, so it is a check.
    const lowest = m.hive.lowestStructureZAtRest;
    checkClose('lowest hive structure at rest vs BB_HIVE_LOWEST_Z', lowest.z, BB_HIVE_LOWEST_Z, TOL);
    check(
      'measurements: a legal 29-in robot clears the LOWEST hive structure at rest (G409 drive-under survives the taller hive)',
      lowest.z > BB3_HEIGHT_MAX,
      `lowest=${lowest.z.toFixed(3)}in ("${lowest.part}") vs BB3_HEIGHT_MAX ${BB3_HEIGHT_MAX}`,
    );

    // THE FIELD SIZE. Real FTC soft tiles are 23.528 in on centre, not 24, so the perimeter closes
    // on 141.35 in inside the walls and not 144, and a flower on the real seam sits 1.5 in from
    // where a 24-in tile would put it. That was three "OPEN FINDING" rows under 0.6-to-2-inch
    // tolerances; it is one ruling and a set of strict rows now. All FOUR faces, not just the
    // right one: the generated `FIELD_HALF` is their mean, so checking one face would not catch
    // a future field that is no longer square.
    for (const [name, cad] of [
      ['left', m.walls.innerFace.left],
      ['right', m.walls.innerFace.right],
      ['rear', m.walls.innerFace.rear],
      ['audience', m.walls.innerFace.audience],
    ] as const) {
      const cfg = name === 'left' || name === 'right' ? BB_HALF_X : BB_HALF_Y;
      checkClose(`${name} wall inner face vs BB_HALF_*`, Math.abs(cad), cfg, TOL);
    }
    checkClose('tile pitch vs BB_TILE_PITCH', m.tiles.pitch, BB_TILE_PITCH, TOL);
    check(
      'measurements: BIOBUZZ does NOT draw the shared C.TILE -- 24 is DECODE and CR nominal tile, and this field is not built on it',
      Math.abs(BB_TILE_PITCH - C.TILE) > 0.4,
      `BB_TILE_PITCH=${BB_TILE_PITCH} C.TILE=${C.TILE}`,
    );
    for (const f of m.flowers) {
      const cfg = BB_FLOWERS.find((x) => x.id === f.id)!;
      const c = f.bore.top.centre;
      const dist = Math.hypot(c[0] - cfg.x, c[1] - cfg.y);
      check(
        `measurements: flower ${f.id} TOP-RING BORE centre IS its BB_FLOWERS position`,
        dist <= TOL,
        `CAD bore=(${c[0].toFixed(3)},${c[1].toFixed(3)}) d=${f.bore.top.diameter.toFixed(3)} rms=${f.bore.top.rms.toFixed(4)} config=(${cfg.x},${cfg.y}) dist=${dist.toFixed(3)}`,
      );
      // the stand-off from the flower's OWN wall is the figure `BB_FLOWER_D` actually names.
      const wallFaceAbs = Math.abs(m.walls.innerFace.right);
      const standoff = Math.min(Math.abs(wallFaceAbs - Math.abs(c[0])), Math.abs(wallFaceAbs - Math.abs(c[1])));
      checkClose(`flower ${f.id} bore stand-off from the CAD wall vs BB_FLOWER_D`, standoff, BB_FLOWER_D, TOL);
      checkClose(`flower ${f.id} top-ring bore RADIUS vs BB_FLOWER_OPEN_R`, f.bore.top.diameter / 2, BB_FLOWER_OPEN_R, TOL);
      // WARNING: THE ONE ROW STILL WIDE, AND NAMED FOR IT. `extent.z[1]` is the flower's HIGHEST
      // point, which is the purple BACKSTOP at 22.654 -- not the top RING plate, whose own z band
      // the measurements file does not carry (the audit measures it by hand at 20.254...21.404,
      // section 6). `BB_FLOWER_TOP_Z` is therefore still the manual's 21.5, flagged in
      // `config.ts`, and this row asserts only that the two stay consistent with a ~1.2-in
      // backstop standing over the ring. Emitting the per-ring bands is a `convert.py` change.
      checkClose(
        `flower ${f.id} assembly top (the BACKSTOP) stands over BB_FLOWER_TOP_Z -- NOT a ring measurement, see the note`,
        f.extent.z[1],
        BB_FLOWER_TOP_Z,
        1.5,
      );
    }

    // TAPE: every strip is 1.000 in wide, and there is no other width on this field.
    check(
      'measurements: every CAD gaffer tape strip is 1.000in wide (the documented width, and the only one)',
      m.tape.widthsIn.length === 1 && Math.abs(m.tape.widthsIn[0] - 1) < 0.01,
      `widths=${JSON.stringify(m.tape.widthsIn)} across ${m.tape.parts.length} parts`,
    );
    check('measurements: the CAD carries all 16 tape strips', m.tape.parts.length === 16, `${m.tape.parts.length}`);
    // ...and every one of them stays CLEAR of the wall it borders. This is the owner's rule --
    // "zones bounded with the wall usually do not have tape on the wall" -- asserted against the
    // CAD rather than trusted: no on-tile strip may reach the wall's inner face.
    const wallFace = Math.abs(m.walls.innerFace.right);
    const onTile = m.tape.parts.filter((t) => t.plane === 'tiles');
    const touching = onTile.filter(
      (t) => Math.max(Math.abs(t.x[0]), Math.abs(t.x[1]), Math.abs(t.y[0]), Math.abs(t.y[1])) >= wallFace - 1e-3,
    );
    check(
      'measurements: no on-tile tape strip runs onto a perimeter wall (the wall-bounded edge carries none)',
      touching.length === 0,
      `${touching.length} of ${onTile.length} strips reach x/y ${wallFace.toFixed(3)}: ${touching.map((t) => t.part).join(', ')}`,
    );
  }

  // ---- ONE FIELD: the 2D wall colliders, the 3D wall colliders and the CAD all coincide ------
  //
  // The 2D and the 3D pipelines are two independent solvers over one field, and until the
  // 2026-09-18 ruling they DISAGREED about where that field's edge was on purpose -- the 3D walls
  // were pinned to the constants' 72 "for parity with the 2D pipeline and the staging" while the
  // CAD measured 70.674, and the gap was reported rather than fixed. It is fixed, and this is the
  // check that says so: three independently-reached numbers per side, 0.05 in apart.
  //
  //   1. the 2D collider set (`biobuzzColliders.statics`, the first `BB_WALL_COUNT` boxes), read
  //      as `|tx| - hx` -- the inner face of the cuboid the 2D solve actually pushes against;
  //   2. the 3D collider set, read by PROJECTING a point 2 in inside each wall onto the nearest
  //      surface in a REAL built engine -- not by re-reading the constant the builder read, which
  //      would prove nothing about the builder;
  //   3. `field-measurements.json`'s `walls.innerFace`, which is the CAD, and therefore the GLB:
  //      the `walls` node the scene draws is the tessellation of these same faces.
  {
    const wallEngine = (() => {
      const w = mkWorld3d('free', 71);
      step3d(w, 1 / 60, new Map());
      return engineFor(w);
    })();
    const faces = [
      { name: 'right', axis: 'x' as const, sign: 1, cad: fieldMeasurements.walls.innerFace.right, cfg: BB_HALF_X },
      { name: 'left', axis: 'x' as const, sign: -1, cad: fieldMeasurements.walls.innerFace.left, cfg: -BB_HALF_X },
      { name: 'rear', axis: 'y' as const, sign: 1, cad: fieldMeasurements.walls.innerFace.rear, cfg: BB_HALF_Y },
      { name: 'audience', axis: 'y' as const, sign: -1, cad: fieldMeasurements.walls.innerFace.audience, cfg: -BB_HALF_Y },
    ];
    const TOL_FIELD = 0.05;
    for (const f of faces) {
      // (1) the 2D box whose inner face is nearest this side
      const boxes = biobuzzColliders.statics.slice(0, BB_WALL_COUNT);
      let face2d = NaN;
      for (const b of boxes) {
        const centre = f.axis === 'x' ? b.tx : b.ty;
        const half = f.axis === 'x' ? b.hx : b.hy;
        if (Math.sign(centre) !== f.sign || centre === 0) continue;
        const inner = centre - f.sign * half;
        if (Number.isNaN(face2d) || Math.abs(inner - f.cfg) < Math.abs(face2d - f.cfg)) face2d = inner;
      }
      // (2) the 3D collider, measured rather than assumed
      const probe = {
        x: f.axis === 'x' ? f.cfg - f.sign * 2 : 0,
        y: f.axis === 'y' ? f.cfg - f.sign * 2 : 0,
        z: 6,
      };
      const proj = wallEngine.world3d.projectPoint(probe, false);
      const face3d = proj ? (f.axis === 'x' ? proj.point.x : proj.point.y) : NaN;
      const spread = Math.max(
        Math.abs(face2d - f.cad),
        Math.abs(face3d - f.cad),
        Math.abs(face2d - face3d),
      );
      check(
        `one field: the ${f.name} wall is the same plane in the 2D colliders, the 3D colliders and the CAD (within ${TOL_FIELD}in)`,
        spread <= TOL_FIELD,
        `2D=${face2d.toFixed(3)} 3D=${face3d.toFixed(3)} CAD/GLB=${f.cad.toFixed(3)} spread=${spread.toFixed(4)}`,
      );
    }
  }

  // ---- ONE FIELD, PART TWO: the tape the renderers draw IS the CAD's own 16 strips -----------
  //
  // `BB_TAPE` is generated from `field-measurements.json`, so this is not a re-derivation -- it
  // is a check that the generated table still describes the SAME rectangles the measurements do,
  // which is what catches a hand-edit of the gen file or a mis-classification in the emitter (the
  // strips are grouped by the nominal length in their STEP part names, and a future field that
  // renames a part would silently drop one into the wrong zone).
  //
  // The renderers are covered separately, by source: both of them draw `BB_TAPE` rather than an
  // outline of `BB_LZ`/`BB_GARDEN`, which is what the owner's "zones bounded with the wall don't
  // have tape on the wall" actually required.
  {
    const onTile = fieldMeasurements.tape.parts.filter((t) => t.plane === 'tiles');
    const drawn = [
      ...BB_TAPE.loadingZone.red,
      ...BB_TAPE.loadingZone.blue,
      ...BB_TAPE.garden.red,
      ...BB_TAPE.garden.blue,
    ];
    check(
      'one field: the drawn tape is exactly the CAD\'s on-tile strip count',
      drawn.length === onTile.length,
      `drawn=${drawn.length} cad=${onTile.length}`,
    );
    let worst = 0;
    let worstName = '';
    for (const t of onTile) {
      let best = Infinity;
      for (const d of drawn) {
        const e = Math.max(
          Math.abs(d.x0 - t.x[0]),
          Math.abs(d.x1 - t.x[1]),
          Math.abs(d.y0 - t.y[0]),
          Math.abs(d.y1 - t.y[1]),
        );
        if (e < best) best = e;
      }
      if (best > worst) {
        worst = best;
        worstName = t.part;
      }
    }
    check(
      'one field: every CAD on-tile tape strip has a drawn rectangle at the same place (within 0.002in, the gen file\'s own rounding)',
      worst <= 0.002,
      `worst ${worst.toFixed(4)}in on "${worstName}"`,
    );
    // ...and the strips stop clear of the wall, which is the rule the whole tape fix is about.
    const wallFaceAbs = Math.abs(fieldMeasurements.walls.innerFace.right);
    const touching = drawn.filter(
      (d) => Math.max(Math.abs(d.x0), Math.abs(d.x1), Math.abs(d.y0), Math.abs(d.y1)) >= wallFaceAbs - 1e-3,
    );
    check(
      'one field: no DRAWN tape strip runs onto a perimeter wall',
      touching.length === 0,
      `${touching.length} of ${drawn.length} reach ${wallFaceAbs.toFixed(3)}`,
    );
  }

  // ---- THE GENERATED FILE IS THE MEASUREMENTS, still --------------------------------------
  //
  // `src/games/biobuzz/fieldDims.gen.ts` is what `config.ts` reads, and it is written by
  // `npm run field-cad`, which is a heavyweight pipeline nobody runs on a whim: a STEP download,
  // a CadQuery venv and a glTF toolchain. So the file in the repo could drift from the JSON in
  // the repo in either direction -- a measurements re-run committed without the emitter, or a
  // hand-edit of the generated constants -- and NOTHING else would notice, because every other
  // check in this file reads the generated file for both sides of its comparison.
  //
  // RE-RENDER AND DIFF, character for character. The emitter is deterministic (its header stamps
  // the pinned STEP's identity and the sha256 of the measurements file, never a clock), so this
  // is exact.
  //
  // LINE ENDINGS ARE NORMALISED FIRST, and that is not a loosened comparison. This repo has no
  // `.gitattributes` and `core.autocrlf` is true on Windows, so a FRESH CLONE gets the committed
  // file back with CRLF while `emit-dims.mjs` writes LF -- the file is identical and every line
  // would differ. The check is about the CONTENT the emitter produced; the checkout's EOL policy
  // is git's business.
  {
    const genPath = 'src/games/biobuzz/fieldDims.gen.ts';
    const lf = (t: string): string => t.split('\r\n').join('\n');
    const onDisk = lf(readFileSync(genPath, 'utf8'));
    const rendered = lf(renderDims(readFileSync('public/models/biobuzz/field-measurements.json', 'utf8')));
    let firstDiff = -1;
    for (let i = 0; i < Math.max(onDisk.length, rendered.length); i++) {
      if (onDisk[i] !== rendered[i]) {
        firstDiff = i;
        break;
      }
    }
    check(
      'fieldDims.gen.ts is exactly what emit-dims.mjs renders from field-measurements.json (run `npm run field-cad` if this fails)',
      firstDiff === -1,
      firstDiff === -1
        ? `${onDisk.length} bytes`
        : `first difference at byte ${firstDiff}: disk ${JSON.stringify(onDisk.slice(firstDiff, firstDiff + 60))} vs rendered ${JSON.stringify(rendered.slice(firstDiff, firstDiff + 60))}`,
    );
  }

  // ---- ONE GEOMETRY: the drawn tray floor and the collider tray floor are the same plane -----
  //
  // THE OWNER'S FIRST SENTENCE, AS A CHECK. `field-measurements.json`'s `hive.trays[a].cells` is
  // measured off the tray skins' own PLANAR FACETS -- i.e. the surface the GLB mesh draws -- and
  // `field-colliders.json`'s `cell_<side>_floor` hull is what Rapier stands an element on. Two
  // independent derivations in two files; if they part company, the picture and the physics are
  // telling a driver different things, which is exactly what shipped twice.
  {
    const m = fieldMeasurements;
    const fc = fieldColliders3d();
    for (const a of ['red', 'blue'] as const) {
      for (const side of ['north', 'south'] as const) {
        const meshW = m.hive.trays[a].cells[side].wMin;
        const hull = fc.trays[a].hulls.find((h) => h.name === `cell_${side}_floor`);
        if (!hull) {
          check(`one-geometry: ${a}/${side} has a floor hull to compare against`, false);
          continue;
        }
        // the floor slab is extruded DOWNWARD from its own CAD plane, so its MAX w is the
        // load-bearing surface.
        let colliderW = -Infinity;
        for (let i = 2; i < hull.points.length; i += 3) colliderW = Math.max(colliderW, hull.points[i]);
        check(
          `one-geometry: ${a}/${side} drawn floor plane and collider floor plane coincide within 0.25in`,
          Math.abs(meshW - colliderW) <= 0.25,
          `mesh w=${meshW.toFixed(4)} collider w=${colliderW.toFixed(4)} delta=${Math.abs(meshW - colliderW).toFixed(4)}`,
        );
      }
    }
  }

  // ---- ...and a resting element sits exactly one radius above that plane ---------------------
  {
    for (const a of ['red', 'blue'] as const) {
      const w = mkWorld3dPair('free', a === 'red' ? 512 : 513);
      w.balls.length = 0;
      const theta = hiveTiltAngle(w, a);
      const sideSign: 1 | -1 = w.biobuzz!.hives[a].up === 'north' ? 1 : -1;
      const box = hiveCellLocalBox(sideSign, a);
      const vMid = (box.vMin + box.vMax) / 2;
      const drop = hiveWorldPoint(a, sideSign, theta, 0, vMid, box.wMin + BB_POLLEN_R + 3);
      const id = 900;
      const dropped: Artifact = {
        id,
        color: 'yellow',
        state: { kind: 'ground' },
        pos: { x: drop.x, y: drop.y },
        z: drop.z - BB_POLLEN_R,
        vel: { x: 0, y: 0 },
        vz: 0,
      };
      w.balls.push(dropped);
      for (let t = 0; t < 240; t++) step3d(w, 1 / 60, new Map());
      const b = w.balls.find((x) => x.id === id)!;
      // back into the tray's own frame and read the height above the floor plane
      const local = rotate2(b.pos.y, b.z + BB_POLLEN_R - BB3_HIVE_PIVOT_Z, -theta);
      const above = local.b - box.wMin;
      check(
        `one-geometry: a settled element's centre sits one radius (${BB_POLLEN_R}in) above ${a}'s drawn cell floor`,
        Math.abs(above - BB_POLLEN_R) <= 0.25,
        `centre is ${above.toFixed(3)}in above the floor plane (w=${box.wMin.toFixed(3)}), world z=${b.z.toFixed(3)}`,
      );
    }
  }

  // ---- perf: 2v2 (4 robots), median/p95 step3d cost ----------------------------------------
  {
    const w = createBiobuzzWorld(
      'free',
      31,
      [setup(0, 'blue', {}, 0), setup(1, 'blue', {}, 1), setup(2, 'red', {}, 0), setup(3, 'red', {}, 1)],
      undefined,
      '3d',
    );
    const cmds = new Map([
      [0, cmd({ driveY: 1, intake: true })],
      [1, cmd({ rotate: 1, fire: true })],
      [2, cmd({ driveY: -1, intake: true })],
      [3, cmd({ driveX: 1, fire: true })],
    ]);
    for (let t = 0; t < 60; t++) step3d(w, 1 / 60, cmds); // warm-up, excluded
    const times: number[] = [];
    for (let t = 0; t < 600; t++) {
      const t0 = Date.now();
      step3d(w, 1 / 60, cmds);
      times.push(Date.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    const p95 = times[Math.floor(times.length * 0.95)];
    console.log(`[smoke-bb sim3d] step3d 2v2: median ${median}ms, p95 ${p95}ms (Date.now() resolution -- see detail on failure)`);
    check(
      'perf: 2v2 step3d median <= 1.5ms',
      median <= 1.5,
      `median=${median}ms p95=${p95}ms (${times.length} samples)`,
    );
  }
}
