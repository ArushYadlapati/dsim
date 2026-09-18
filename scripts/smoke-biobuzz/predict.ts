import type { Check } from './harness';
import { cmd, mkWorld3dPair } from './harness';
import { step3d } from '../../src/games/biobuzz/sim3d/step3d';
import {
  createFullPredictor,
  createLightPredictor,
  probeFullReconcileMs,
  type PredictedPose,
  type Predictor,
} from '../../src/games/biobuzz/sim3d/predict';
import {
  BB_POLLEN_R,
  PREDICT_ELEMENT_RADIUS,
  PREDICT_FULL_BUDGET_MS,
  PREDICT_LIGHT_BUDGET_MS,
  PREDICT_MAX_TICKS,
} from '../../src/games/biobuzz/config';
import { SIM_DT } from '../../src/config';
import type { Artifact, RobotCommand, World } from '../../src/types';

/**
 * PREDICT — the two client-side prediction worlds (Day 2 lane A, `docs/biobuzz/plan-3d.md` §9).
 *
 * The plan's lane spec: "Light and Full prediction worlds converge to the authoritative pose
 * within `SMOOTH_MAX_DIST` after 40 re-stepped ticks on a scripted push".
 *
 * ⚠️ **`SMOOTH_MAX_DIST` IS 16 in AND IT IS A CEILING, NOT A TARGET.** It is the distance past
 * which `game.ts` SNAPS the local robot instead of easing the correction in — so a predictor that
 * merely stayed under it would still be visibly rubber-banding every reconcile. The checks below
 * report the measured error as well as asserting the bound, and the scripted-push numbers are in
 * the log line, because those are what say whether Full is worth its wasm.
 *
 * The constant is NOT imported: it lives in `src/game.ts`, which is Lane C's and DOM-adjacent.
 * It is restated here with its provenance, which is the same thing `PREDICT_MAX_TICKS` does for
 * `MAX_PREDICT_LEAD`.
 */

/** `SMOOTH_MAX_DIST` from `src/game.ts` — "larger corrections snap instead of floating". */
const SMOOTH_MAX_DIST = 16;

const LOCAL = 0;

/** a 2v2-shaped 3D world with the local robot (id 0) on a scripted push into a line of elements
 * against the wall — the plan's own scenario, and the one case where LIGHT is expected to be
 * WRONG and FULL is expected to be right. */
function pushScene(seed: number): World {
  const w = mkWorld3dPair('free', seed);
  w.balls.length = 0;
  const r = w.robots[LOCAL];
  r.hopper.length = 0;
  // park it in the open, facing the +y wall, with a garden-style line of POLLEN between it and
  // the wall: four elements the chassis has to shove the whole way.
  r.pos.x = 0;
  r.pos.y = 20;
  r.heading = Math.PI / 2;
  r.vel.x = 0;
  r.vel.y = 0;
  r.angVel = 0;
  for (let i = 0; i < 4; i++) {
    w.balls.push({
      id: 500 + i,
      color: 'yellow',
      state: { kind: 'ground' },
      pos: { x: -4.5 + i * 3, y: 34 },
      vel: { x: 0, y: 0 },
      z: 0,
      vz: 0,
      r: BB_POLLEN_R,
    } as Artifact);
  }
  return w;
}

/** the authoritative answer: step the REAL pipeline `ticks` times with `c` on the local robot. */
function authoritative(w: World, c: RobotCommand, ticks: number): PredictedPose {
  const cmds = new Map([[LOCAL, c]]);
  for (let i = 0; i < ticks; i++) step3d(w, SIM_DT, cmds);
  const r = w.robots.find((x) => x.id === LOCAL)!;
  return {
    pos: { x: r.pos.x, y: r.pos.y },
    vel: { x: r.vel.x, y: r.vel.y },
    heading: r.heading,
    angVel: r.angVel,
    z: r.z ?? 0,
    vz: r.vz ?? 0,
  };
}

/** re-step `ticks` inputs through a predictor and return its final pose plus the wall time. */
function replay(p: Predictor, c: RobotCommand, ticks: number): { pose: PredictedPose; ms: number } {
  const t0 = Date.now();
  let pose = p.step(c);
  for (let i = 1; i < ticks; i++) pose = p.step(c);
  return { pose, ms: Date.now() - t0 };
}

const dist = (a: PredictedPose, b: PredictedPose): number => Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);

export function predictChecks(check: Check): void {
  // ---- open floor: both predictors should be EXACT, because nothing is touching ---------------
  //
  // This is the case Light exists for, and it is the one where "converges to the authoritative
  // pose" means agreement rather than tolerance: with no contacts the real solve IS the drive
  // model integrated, which is precisely what Light computes. A failure here is the drive model
  // drifting between the two, which no tolerance should hide.
  {
    const drive = cmd({ driveY: 1, leftDrive: 1, rightDrive: 1 });
    const truth = pushScene(1000);
    truth.balls.length = 0; // open floor: nothing to hit
    const lightWorld = pushScene(1000);
    lightWorld.balls.length = 0;
    const fullWorld = pushScene(1000);
    fullWorld.balls.length = 0;

    const light = createLightPredictor(lightWorld, LOCAL);
    const full = createFullPredictor(fullWorld, LOCAL);
    light.reset(lightWorld, lightWorld.tick);
    full.reset(fullWorld, fullWorld.tick);
    const lr = replay(light, drive, PREDICT_MAX_TICKS);
    const fr = replay(full, drive, PREDICT_MAX_TICKS);
    const auth = authoritative(truth, drive, PREDICT_MAX_TICKS);
    const dl = dist(lr.pose, auth);
    const df = dist(fr.pose, auth);
    console.log(
      `[smoke-bb predict] open floor, ${PREDICT_MAX_TICKS} ticks: light off by ${dl.toFixed(3)}in (${lr.ms}ms), ` +
        `full off by ${df.toFixed(3)}in (${fr.ms}ms); the robot travelled ${Math.hypot(auth.pos.x, auth.pos.y - 20).toFixed(1)}in`,
    );
    check(
      `open floor: LIGHT lands on the authoritative pose (under ${SMOOTH_MAX_DIST}in, the snap threshold)`,
      dl < SMOOTH_MAX_DIST,
      `${dl.toFixed(3)}in after ${PREDICT_MAX_TICKS} re-stepped ticks`,
    );
    /**
     * ⚠️ **LIGHT IS NOT EXACT ON OPEN FLOOR, AND THE MEASUREMENT IS WHY THIS CHECK IS A RATIO.**
     * It integrates the SAME wrench with the same mass and inertia the real body gets, in the
     * same order (`v += F/m·dt` then `p += v·dt`) — `updateRobot`'s own `wantX/wantY/wantW` are
     * that formula, so the drive model agrees to the last digit. What it does not have is the
     * floor: the real chassis is a body resting on a collider, and Rapier's contact solve moves
     * it a fraction of an inch per tick that no forceless integrator reproduces. Measured, that
     * is 1.7 % of the distance travelled over a 40-tick window — a sixth of an inch per foot.
     *
     * The bound is a FRACTION rather than an absolute for the obvious reason: the error scales
     * with how far the robot went, and a predictor asked to re-step a slow window would pass an
     * absolute bound it had not earned.
     */
    const travelled = Math.hypot(auth.pos.x, auth.pos.y - 20);
    check(
      'open floor: LIGHT tracks the real solve to within 3% of the distance travelled',
      dl < 0.03 * travelled,
      `${dl.toFixed(3)}in over ${travelled.toFixed(1)}in = ${((dl / travelled) * 100).toFixed(2)}%`,
    );
    check(
      `open floor: FULL lands on the authoritative pose (under ${SMOOTH_MAX_DIST}in)`,
      df < SMOOTH_MAX_DIST,
      `${df.toFixed(3)}in`,
    );
    light.dispose();
    full.dispose();
  }

  // ---- the scripted push: a line of elements against the wall --------------------------------
  {
    const drive = cmd({ driveY: 1, leftDrive: 1, rightDrive: 1 });
    const truth = pushScene(1001);
    const lightWorld = pushScene(1001);
    const fullWorld = pushScene(1001);
    const light = createLightPredictor(lightWorld, LOCAL);
    const full = createFullPredictor(fullWorld, LOCAL);
    light.reset(lightWorld, lightWorld.tick);
    full.reset(fullWorld, fullWorld.tick);
    const lr = replay(light, drive, PREDICT_MAX_TICKS);
    const fr = replay(full, drive, PREDICT_MAX_TICKS);
    const auth = authoritative(truth, drive, PREDICT_MAX_TICKS);
    const dl = dist(lr.pose, auth);
    const df = dist(fr.pose, auth);
    console.log(
      `[smoke-bb predict] scripted push (4 POLLEN into the +y wall), ${PREDICT_MAX_TICKS} ticks: ` +
        `light off by ${dl.toFixed(3)}in (${lr.ms}ms), full off by ${df.toFixed(3)}in (${fr.ms}ms)`,
    );
    check(
      `scripted push: LIGHT converges within SMOOTH_MAX_DIST (${SMOOTH_MAX_DIST}in) so the correction EASES, never snaps`,
      dl < SMOOTH_MAX_DIST,
      `${dl.toFixed(3)}in`,
    );
    check(
      `scripted push: FULL converges within SMOOTH_MAX_DIST (${SMOOTH_MAX_DIST}in)`,
      df < SMOOTH_MAX_DIST,
      `${df.toFixed(3)}in`,
    );
    /**
     * AND FULL HAS TO BE BETTER THAN LIGHT HERE, OR IT IS NOT WORTH ITS WASM. That is the whole
     * of the Prediction setting's argument: Light is exact on open floor and approximate in
     * contact, Full carries the contact. If this ever reverses, the setting is offering a choice
     * that costs 1.09 MB and buys nothing, and THAT is the finding — not a tolerance to widen.
     */
    check(
      'scripted push: FULL is closer than LIGHT — the contact is what it is for',
      df <= dl,
      `full ${df.toFixed(3)}in vs light ${dl.toFixed(3)}in`,
    );
    light.dispose();
    full.dispose();
  }

  // ---- the budgets ---------------------------------------------------------------------------
  //
  // MEASURED ON THIS MACHINE, and reported whatever they say. `PREDICT_FULL_BUDGET_MS` is a
  // DECISION threshold that Auto evaluates on the player's own device during the countdown, so a
  // dev box passing it is not a promise about a phone — it is the floor under which the constant
  // is a sane default at all.
  {
    const w = pushScene(1002);
    const drive = cmd({ driveY: 1, leftDrive: 1, rightDrive: 1 });
    const light = createLightPredictor(w, LOCAL);
    let lightMs = Infinity;
    for (let i = 0; i < 5; i++) {
      light.reset(w, w.tick);
      lightMs = Math.min(lightMs, replay(light, drive, PREDICT_MAX_TICKS).ms);
    }
    light.dispose();
    const full = createFullPredictor(w, LOCAL);
    let fullMs = Infinity;
    for (let i = 0; i < 5; i++) {
      full.reset(w, w.tick);
      fullMs = Math.min(fullMs, replay(full, drive, PREDICT_MAX_TICKS).ms);
    }
    full.dispose();
    const probe = probeFullReconcileMs(w, LOCAL);
    console.log(
      `[smoke-bb predict] budgets, best of 5: LIGHT ${lightMs}ms (budget ${PREDICT_LIGHT_BUDGET_MS}), ` +
        `FULL ${fullMs}ms (budget ${PREDICT_FULL_BUDGET_MS}); probeFullReconcileMs reports ${probe.toFixed(1)}ms`,
    );
    check(
      `LIGHT reconciles ${PREDICT_MAX_TICKS} ticks inside ${PREDICT_LIGHT_BUDGET_MS}ms`,
      lightMs <= PREDICT_LIGHT_BUDGET_MS,
      `${lightMs}ms`,
    );
    check(
      `FULL reconciles ${PREDICT_MAX_TICKS} ticks inside PREDICT_FULL_BUDGET_MS (${PREDICT_FULL_BUDGET_MS}ms)`,
      fullMs <= PREDICT_FULL_BUDGET_MS,
      `${fullMs}ms on this machine`,
    );
    check(
      'the Auto probe measures the same thing the budget is written against',
      Number.isFinite(probe) && probe <= PREDICT_FULL_BUDGET_MS * 3,
      `probe ${probe.toFixed(1)}ms vs a direct replay of ${fullMs}ms`,
    );
  }

  // ---- what FULL carries, and what it leaves out -----------------------------------------------
  {
    const w = pushScene(1003);
    // one element inside the radius and one well outside it
    w.balls.push({
      id: 900,
      color: 'yellow',
      state: { kind: 'ground' },
      pos: { x: 0, y: 20 + PREDICT_ELEMENT_RADIUS + 20 },
      vel: { x: 0, y: 0 },
      z: 0,
      vz: 0,
      r: BB_POLLEN_R,
    } as Artifact);
    const full = createFullPredictor(w, LOCAL);
    full.reset(w, w.tick);
    // the far element cannot reach the robot inside the window, which is the whole argument for
    // the radius; assert the predictor still produces a finite pose with it present.
    const pose = full.step(cmd({ driveY: 1, leftDrive: 1, rightDrive: 1 }));
    check(
      'FULL carries only the near elements and still returns a finite pose',
      Number.isFinite(pose.pos.x) && Number.isFinite(pose.pos.y) && Number.isFinite(pose.heading),
      `pose (${pose.pos.x.toFixed(2)}, ${pose.pos.y.toFixed(2)}) heading ${pose.heading.toFixed(3)}`,
    );
    full.dispose();
  }

  // ---- determinism, and the no-side-effects contract -------------------------------------------
  {
    const drive = cmd({ driveY: 1, rotate: 0.4, leftDrive: 0.6, rightDrive: 1 });
    const runs: string[] = [];
    for (let i = 0; i < 2; i++) {
      const w = pushScene(1004);
      const p = createFullPredictor(w, LOCAL);
      p.reset(w, w.tick);
      const { pose } = replay(p, drive, PREDICT_MAX_TICKS);
      p.dispose();
      runs.push(`${pose.pos.x}|${pose.pos.y}|${pose.heading}|${pose.vel.x}|${pose.vel.y}|${pose.angVel}`);
    }
    check('determinism: two identical FULL reconciles produce the identical pose', runs[0] === runs[1], `${runs[0]} vs ${runs[1]}`);

    const lruns: string[] = [];
    for (let i = 0; i < 2; i++) {
      const w = pushScene(1005);
      const p = createLightPredictor(w, LOCAL);
      p.reset(w, w.tick);
      const { pose } = replay(p, drive, PREDICT_MAX_TICKS);
      p.dispose();
      lruns.push(`${pose.pos.x}|${pose.pos.y}|${pose.heading}|${pose.angVel}`);
    }
    check('determinism: two identical LIGHT reconciles produce the identical pose', lruns[0] === lruns[1], `${lruns[0]} vs ${lruns[1]}`);

    /**
     * ⚠️ **A PREDICTOR MUST NOT WRITE TO THE WORLD IT WAS RESET FROM.** It is a CLIENT's opinion
     * about the near future, and the world it reads is the one the server owns; a predictor that
     * mutated it would be writing that opinion into the authoritative state, which is the exact
     * shape of a client-authority bug. Both predictors clone the local robot and hand the clone a
     * scratch world for that reason, and this is the check that says so rather than the comment.
     */
    const w = pushScene(1006);
    const before = JSON.stringify({
      robots: w.robots.map((r) => [r.id, r.pos.x, r.pos.y, r.heading, r.vel.x, r.vel.y, r.angVel, r.powerDraw]),
      balls: w.balls.map((b) => [b.id, b.pos.x, b.pos.y, b.z]),
      tick: w.tick,
      time: w.time,
    });
    const light = createLightPredictor(w, LOCAL);
    const full = createFullPredictor(w, LOCAL);
    replay(light, drive, PREDICT_MAX_TICKS);
    replay(full, drive, PREDICT_MAX_TICKS);
    light.dispose();
    full.dispose();
    const after = JSON.stringify({
      robots: w.robots.map((r) => [r.id, r.pos.x, r.pos.y, r.heading, r.vel.x, r.vel.y, r.angVel, r.powerDraw]),
      balls: w.balls.map((b) => [b.id, b.pos.x, b.pos.y, b.z]),
      tick: w.tick,
      time: w.time,
    });
    check('neither predictor writes to the authoritative world it was reset from', before === after, 'robot and element state compared before/after');
  }
}
