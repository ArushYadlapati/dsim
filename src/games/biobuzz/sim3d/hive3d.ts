import type { Alliance, World } from '../../../types';
import { dsin } from '../../../math';
import { GRAVITY } from '../../../config';
import {
  BB3_HIVE_DETENT,
  BB3_HIVE_PIVOT_Z,
  BB3_HIVE_REST_W,
  BB3_HIVE_STOP_DEG,
  BB_HIVE_TILT_DEG,
  BB_POLLEN_R,
} from '../config';
import { BB_TIP_SWING_S, hiveTimerStep, otherSide } from '../hive';
import { bbKindIndex } from '../score';
import { elementMass, hiveCellLocalBox, hivePivotX, hiveTrayMassProps, useHiveDynamic } from './bodies';
import type { Engine3d } from './engine';
import { trayTilt } from './engine';
import { rotate2, tiltQuatX } from './math3';

/**
 * BIOBUZZ 3D PHYSICS -- THE HIVE.
 *
 * Two trays, two models, one reader. `BB3_HIVE_DYNAMIC` picks between them and `hiveTiltAngle`
 * is the ONE authority both renderers and `derive.ts` read either way.
 *
 * ── THE DAY 1 FALLBACK: a KINEMATIC tray on the shared TIMER ────────────────────────────────
 * The TIP is `hiveTimerStep` (extracted from `../hive.ts`'s `hiveStep` -- a pure extraction, see
 * that file's header) run over the load table. The SPILL is not a timer: the kinematic tray
 * physically rotates and every element resting in the tipping cell is a real body on a real
 * floor that tilts out from under it, so it slides out because gravity says so and `derive.ts`
 * simply stops finding it inside the cell box.
 *
 * ── THE DAY 2 SEE-SAW: a DYNAMIC tray on a REVOLUTE JOINT (plan §3.6) ───────────────────────
 * The tray is a body. Nothing plays a swing back; the swing IS the solve. Three terms make a bar
 * on a hinge behave like the real hive, and `scripts/hive-calibrate.ts` fits all three against
 * the Event Field Setup Guide's own rows:
 *
 *  1. **the tray's own weight, above the pivot.** `hiveTrayMassProps` puts the centre of mass at
 *     the cells' mid-height, which is 5.5 in ABOVE the hinge, so the tray has an unstable
 *     equilibrium at level and a stable one at each stop. That IS §9.6's "bi-stable", and it is
 *     the tray's shape rather than a term anyone added. `BB3_HIVE_BALLAST` tunes it, the way the
 *     field guide's ballast washers tune the real one.
 *  2. **the DETENT**, `BB3_HIVE_DETENT`: a breakaway torque the load has to beat before the bar
 *     moves at all.
 *  3. **the DAMPING**, `BB3_HIVE_DAMPING`: angular damping on the body, which is what makes the
 *     stop-to-stop swing take the owner's 4.0 s instead of under two.
 *
 * ⚠️ **WHY THE DETENT IS A HOLD AND NOT JOINT FRICTION.** Rapier has no joint friction, and the
 * two things it does have are both worse here. A MOTOR with a torque cap holds the tray at its
 * stop, but it goes on pulling toward that stop after breakaway, so the swing has to fight it
 * the whole way and the released tray is no longer a free see-saw. Raising the joint's own
 * limits to bite is not a detent at all. The HOLD below is instead a plain statement of what a
 * detent IS: while the bar is at a stop and the load's torque has not beaten `hold + DETENT`,
 * the bar does not move -- pinned exactly, at exactly the stop angle. The moment it does beat
 * it, the pin is gone and nothing is left but gravity, the contents and the damping.
 *
 * It is DETERMINISTIC because it is a pure function of the JSON: the torque is computed from
 * where the element bodies actually are (read back last tick, rounded to 1e-4), through the
 * shared `dsin`/`dcos`, with no solver state and no clock in it. Two peers stepping the same
 * inputs break the detent on the same tick.
 *
 * ⚠️ **AND THE TRIGGER IS A TORQUE, NOT THE TABLE.** `BB_TIP_POLLEN` -- the measured 8/7/6/3/1/0
 * rows -- is what the 2D pipeline and the kinematic fallback trip on. The dynamic tray never
 * reads it: it tips when the elements that are really in the cell really out-torque the hold, at
 * the lever arms they really have. `scripts/hive-calibrate.ts` is what makes those two answer
 * the same on the guide's rows, and the reason the calibration is a SCRIPT rather than a
 * constant is that only the physics knows where a pile of spheres settles.
 */

const ALLIANCES: readonly Alliance[] = ['red', 'blue'];

/** the rest tilt in radians -- `BB_HIVE_TILT_DEG` is in degrees because that is how §9.6 prints
 * it and how a drawing is read. */
const REST_RAD = (BB_HIVE_TILT_DEG * Math.PI) / 180;
/** the angle at which the tray counts as AT a stop: `BB3_HIVE_STOP_DEG`, §10.5.1 B's damper
 * contact expressed as an angle. */
const STOP_RAD = (BB3_HIVE_STOP_DEG * Math.PI) / 180;

/**
 * Is a point inside one CELL's interior, IN THAT CELL'S OWN CURRENT (TILTED) FRAME?
 *
 * Lives here rather than in `derive.ts` because BOTH need it now: derive to decide membership,
 * and the detent to know whose weight is on which side of the pivot. `derive.ts` imports it from
 * this file, which it already imports `hiveTiltAngle` from, so no new edge in the graph.
 *
 * world (y, z) -> the box's OWN frame is `rotate2(y, z, -theta)` with NO `refTheta` term: the CAD
 * tray is exported UN-TILTED, so `world = pivot + Rotate(theta) · (v, w)` holds directly for
 * every box on both paths -- see `HiveLocalBox.refTheta`.
 */
export function insideCell(
  px: number,
  py: number,
  pz: number,
  alliance: Alliance,
  sideSign: 1 | -1,
  theta: number,
): boolean {
  const box = hiveCellLocalBox(sideSign, alliance);
  const dx = px - hivePivotX(alliance);
  if (Math.abs(dx) > box.xHalf) return false;
  const { a: v, b: w } = rotate2(py, pz - BB3_HIVE_PIVOT_Z, -theta);
  return v >= box.vMin && v <= box.vMax && w >= box.wMin && w <= box.wMax;
}

/**
 * The hive's tilt, in RADIANS about the world X axis, RIGHT NOW. THE ONE AUTHORITY: the 3D scene
 * rotates the GLB tray by this (minus `hiveTrayRefTheta`), `derive.ts` tests cell membership in
 * it, and the 2D renderer's `tipProjection` draws the same swing from above.
 *
 * Under the DYNAMIC tray it is the joint's own live angle, serialised into `hives[a].angle` by
 * the readback -- nothing in the JSON could recompute it, because it is the result of a solve.
 * Under the kinematic tray (and in every 2D world, every 2D-era replay and every snapshot
 * recorded before the field existed) `angle` is absent and this falls back to the TIMER's own
 * formula, which is the function this used to be in its entirety.
 *
 * `sign` is `+1` when `hive.up === 'north'`, `-1` when `'south'` -- the convention `bodies.ts`'s
 * local (v, w) frame is built against. Before the swing starts and after it completes, `hive.up`
 * already names whichever side IS up, so `sign * rest` is correct at both ends.
 */
export function hiveTiltAngle(world: World, alliance: Alliance): number {
  const hive = world.biobuzz?.hives[alliance];
  if (!hive) return REST_RAD;
  if (typeof hive.angle === 'number' && Number.isFinite(hive.angle)) return hive.angle;
  const sign = hive.up === 'north' ? 1 : -1;
  if (!(hive.tipping > 0)) return sign * REST_RAD;
  // identical to `drawField.ts`'s `tipProjection` -- see that function for the derivation.
  const p = Math.min(1, Math.max(0, 1 - hive.tipping / BB_TIP_SWING_S));
  return sign * REST_RAD * (1 - 2 * p);
}

// ---------------------------------------------------------------------------------------------
// THE DYNAMIC SEE-SAW
// ---------------------------------------------------------------------------------------------

/**
 * The torque about the pivot's x axis from everything sitting in EITHER of this hive's cells,
 * at the tray's current tilt. Signed: POSITIVE drives the north side up.
 *
 * ONE LINE OF ALGEBRA, and it is worth writing down because it looks too simple. A weight `m g`
 * acting straight down at world `(x, y, z)` has torque `r × F` about the pivot, whose x
 * component is `r_y·F_z − r_z·F_y = y·(−mg) − z·0`. The pivot is at `y = 0`, so the arm is the
 * element's own world y and nothing else: `τ = −m g y`. The tilt enters only through where the
 * element has ended up.
 *
 * It reads the BODIES' positions (via the JSON the readback wrote), not the derived `contents`
 * list, for two reasons: this runs at stage 6, BEFORE `derive.ts`, so `contents` would be a tick
 * stale; and an element that is bouncing rather than resting still presses on the tray, so the
 * rest requirement membership needs would be wrong here.
 */
export function hiveContentsTorque(world: World, alliance: Alliance, theta: number): number {
  let tau = 0;
  for (const b of world.balls) {
    if (b.state.kind === 'held' || b.state.kind === 'stock') continue;
    const r = b.r ?? BB_POLLEN_R;
    const z = b.z + r;
    if (!insideCell(b.pos.x, b.pos.y, z, alliance, 1, theta) && !insideCell(b.pos.x, b.pos.y, z, alliance, -1, theta)) {
      continue;
    }
    const m = elementMass(b.color === 'red' || b.color === 'blue');
    tau += -m * GRAVITY * b.pos.y;
  }
  return tau;
}

/**
 * The tray's OWN restoring torque at tilt `theta`, positive toward +x rotation.
 *
 * The centre of mass sits at local `(v = 0, w = comW)` with `comW > 0`, which rotates to world
 * `y = −comW·sin(theta)`. By the same `τ = −m g y` as above, `τ = +M g comW sin(theta)` — the
 * same SIGN as `theta`, which is what "above the pivot" means and why the tray holds a stop
 * instead of falling to level.
 */
export function hiveRestoringTorque(alliance: Alliance, theta: number): number {
  const props = hiveTrayMassProps(alliance);
  return props.mass * GRAVITY * props.comW * dsin(theta);
}

/**
 * CALIBRATION-ONLY DETENT OVERRIDE. `scripts/hive-calibrate.ts` sweeps the breakaway torque to
 * find the one that makes the field guide's rows come out right, and it cannot do that by
 * rewriting `config.ts` between candidates — the module is already loaded. `null` (the default)
 * means "use `BB3_HIVE_DETENT`, as production does"; nothing outside that script and the HIVE3D
 * lane calls the setter, and neither leaves it set.
 */
let detentOverride: number | null = null;

export function __setDetentForCalibration(value: number | null): void {
  detentOverride = value;
}

/** how hard the tray resists leaving its stop, in torque: its own weight plus the detent. The
 * two are ADDITIVE and, at a stop, degenerate — see `scripts/hive-calibrate.ts`'s report. */
export function hiveHoldTorque(alliance: Alliance, theta: number): number {
  return Math.abs(hiveRestoringTorque(alliance, theta)) + (detentOverride ?? BB3_HIVE_DETENT);
}

/** the angle a tray at `stop` sign should be pinned to. */
function stopAngle(sign: number): number {
  return sign >= 0 ? REST_RAD : -REST_RAD;
}

/**
 * THE DETENT, applied every tick before the solve (`engine.ts`'s `applyHiveTilt`).
 *
 * While a tray is AT a stop and the load has not out-torqued `hiveHoldTorque`, it is pinned
 * there exactly: rotation set to the stop, angular velocity zeroed. The moment the load wins,
 * the pin is not applied and the body is an ordinary dynamic one for the rest of the swing —
 * gravity, the contents sliding out, the damping and the joint's far limit, and nothing else.
 *
 * ⚠️ **THE PIN IS SKIPPED WHEN IT WOULD BE A NO-OP**, and that guard is not an optimisation. A
 * `setRotation`/`setAngvel` pair is a WRITE even when the values are unchanged, and (measured on
 * the kinematic tray, `engine.ts`'s own CCD note) writing to a body every tick resets its sleep
 * timer, so a settled tray never sleeps and the elements resting in it jitter against a surface
 * that is being re-woken sixty times a second.
 */
export function hiveDetentHold(world: World, engine: Engine3d): void {
  for (const a of ALLIANCES) {
    const body = engine.hiveTrays[a];
    const theta = trayTilt(body);
    const sign = theta >= 0 ? 1 : -1;
    const atStop = Math.abs(theta) >= STOP_RAD;
    if (!atStop) {
      engine.hiveHeld[a] = false;
      continue;
    }
    // the load pulls AWAY from this stop when its torque opposes the stop's own sign
    const pull = -sign * hiveContentsTorque(world, a, theta);
    if (pull > hiveHoldTorque(a, theta)) {
      /**
       * ⚠️ **THE BREAKAWAY HAS TO WAKE THE BODY, AND FORGETTING THAT LOOKS EXACTLY LIKE A TRAY
       * THAT WILL NOT TIP.** A pinned tray stops moving, so Rapier puts it to sleep — correctly:
       * a sleeping body is the whole reason a settled hive costs nothing per tick. But a sleeping
       * body is not integrated, so GRAVITY DOES NOT WAKE IT, and the elements resting on it are
       * asleep too and cannot nudge it. The detent then releases into total silence. Measured
       * before this line existed: every row of the load table, including 6 POLLEN + 2 NECTAR at
       * 28 % over the threshold, read NO TIP, and the damping bisection reported "never reached
       * the far stop" at every value from 0 to 60.
       */
      if (engine.hiveHeld[a]) {
        body.wakeUp();
        for (const id of world.biobuzz?.hives[a].contents ?? []) {
          const el = engine.elements.get(id);
          if (el) el.wakeUp();
        }
      }
      engine.hiveHeld[a] = false;
      continue;
    }
    engine.hiveHeld[a] = true;
    const target = stopAngle(sign);
    const av = body.angvel();
    if (Math.abs(theta - target) > 1e-6) body.setRotation(tiltQuatX(target), false);
    if (av.x !== 0 || av.y !== 0 || av.z !== 0) body.setAngvel({ x: 0, y: 0, z: 0 }, false);
  }
}

/**
 * Derive the shared HIVE bookkeeping from the joint — the dynamic twin of `hiveTimerStep`.
 *
 * `up`, `tipping`, `released` and `tips` are COMPATIBILITY VALUES here: the tray's real state is
 * one number, its angle, and everything downstream (`score.ts`'s TIP count, `hud.ts`, the 2D
 * renderer's `tipProjection`, `hiveTakingSide`) was written against the timer's vocabulary. So
 * this translates rather than duplicates:
 *
 *  · **the swing STARTS** when the tray has left its stop — the detent broke, which is the one
 *    event this function cannot see directly and does not need to.
 *  · **`tipping`** is the timer's own countdown solved backwards out of the live angle, so
 *    `tipProjection` draws the picture the tray is actually in rather than a replay of a
 *    nominal 4 s.
 *  · **`released`** latches when the bar passes LEVEL, which is where the contents leave — and
 *    they leave because the floor tilted out from under them, not because this said so.
 *  · **the TIP scores** when the far stop is reached and the bar has stopped moving
 *    (`BB3_HIVE_REST_W`): §10.5.1's "the damper that was not contacting the frame begins to
 *    contact it", which is exactly a stop with the swing spent.
 */
function hiveDynamicTick(world: World, engine: Engine3d): void {
  const bb = world.biobuzz;
  if (!bb) return;
  for (const a of ALLIANCES) {
    const hive = bb.hives[a];
    const theta = hive.angle ?? trayTilt(engine.hiveTrays[a]);
    const omega = hive.angVel ?? 0;
    const upSign = hive.up === 'north' ? 1 : -1;
    const settledAtFarStop = Math.abs(theta) >= STOP_RAD && Math.sign(theta) === -upSign && Math.abs(omega) < BB3_HIVE_REST_W;

    if (hive.tipping > 0) {
      if (settledAtFarStop) {
        bb.hives[a] = {
          up: otherSide(hive.up),
          contents: hive.contents,
          tips: hive.tips + 1,
          tipping: 0,
          released: false,
          angle: hive.angle,
          angVel: hive.angVel,
        };
        bb.nectarDue[a] += 1;
        world.events.push(`${a.toUpperCase()} HIVE TIP`);
        continue;
      }
      const wasReleased = hive.released;
      const released = wasReleased || Math.sign(theta) !== upSign;
      if (released && !wasReleased) {
        // THE SPILL TAG'S OWN COUNT, not `contents.length`: membership waits `BB3_REST_TICKS`
        // and a tray loaded past its threshold in one volley is already swinging before anything
        // has settled, so `contents` reads 0 there and the event said "SPILLS 0" over eight
        // elements visibly leaving the cell. The tag was written from the POSITION test at the
        // breakaway and is what the spill actually is.
        const n = Object.values(bb.spill ?? {}).filter((x) => x === a).length;
        world.events.push(`${a.toUpperCase()} HIVE SPILLS ${n || hive.contents.length}`);
      }
      bb.hives[a] = { ...hive, tipping: tippingFromAngle(theta, upSign), released };
      continue;
    }

    // settled. Has the detent broken? The tray leaving its stop is the only evidence there is.
    if (Math.abs(theta) < STOP_RAD) {
      /**
       * Every element in the cell is tagged NOW, at the top of the swing, rather than on the
       * tick each one crosses the lip: while it is still in the tray the only thing it touches
       * IS the tray, so `contacts3d.ts`'s "first NON-TRAY contact" rule gives the identical
       * answer from a rule that needs no per-element lip test. See `BiobuzzState.spill`.
       *
       * ⚠️ IT IS THE POSITION TEST, NOT `hive.contents`. Membership needs `BB3_REST_TICKS` of
       * stillness before it will call an element part of the cell, which is right for SCORING —
       * a shot crossing the mouth is not yet in it — and wrong here: a tray loaded past its
       * threshold in one volley starts swinging before anything has settled, and reading
       * `contents` then tags an empty set. Measured on a staged 8-POLLEN tip, which broke away
       * on tick 2 with `contents` still reading 0.
       */
      const spill = (bb.spill ??= {});
      for (const b of world.balls) {
        if (b.state.kind === 'held' || b.state.kind === 'stock') continue;
        const z = b.z + (b.r ?? BB_POLLEN_R);
        if (insideCell(b.pos.x, b.pos.y, z, a, 1, theta) || insideCell(b.pos.x, b.pos.y, z, a, -1, theta)) {
          spill[b.id] = a;
        }
      }
      bb.hives[a] = { ...hive, tipping: tippingFromAngle(theta, upSign), released: false };
    }
  }
}

/** the timer's countdown that corresponds to a live angle — the inverse of `hiveTiltAngle`'s own
 * formula, so a 2D renderer reading `tipping` draws the tray where it really is. */
function tippingFromAngle(theta: number, upSign: number): number {
  const p = Math.min(1, Math.max(0, (1 - (upSign * theta) / REST_RAD) / 2));
  return Math.max(1e-4, BB_TIP_SWING_S * (1 - p));
}

/**
 * The shared TIP bookkeeping, run over whatever `derive.ts` has ALREADY written into
 * `hives[a].contents` this tick (physically-derived membership, not a capture event) --
 * `step3d.ts`'s gameplay stage calls this AFTER `derive.ts` and it must stay that way, or the
 * timer reads last tick's membership.
 *
 * Unlike the 2D `hiveStep`, this NEVER writes `contents`: physics owns it (via `derive.ts`).
 */
export function hive3dTick(world: World, dt: number): void {
  const bb = world.biobuzz;
  if (!bb) return;
  if (useHiveDynamic()) return; // the dynamic tray's bookkeeping runs in `hive3dJointTick`
  const kindOf = bbKindIndex(world);
  for (const a of ALLIANCES) {
    const hive = bb.hives[a];
    const contents = hive.contents; // this tick's DERIVED membership -- never overwritten below
    const r = hiveTimerStep(hive, dt, kindOf);
    bb.hives[a] = { ...r.hive, contents };
    if (r.releasing) {
      world.events.push(`${a.toUpperCase()} HIVE SPILLS ${contents.length}`);
    }
    if (r.tipped) {
      bb.nectarDue[a] += 1;
      world.events.push(`${a.toUpperCase()} HIVE TIP`);
    }
  }
}

/** the dynamic tray's own bookkeeping pass, called from `step3d.ts` in place of the timer. Split
 * from `hive3dTick` so each path reads as one function rather than as two branches. */
export function hive3dJointTick(world: World, engine: Engine3d): void {
  if (!useHiveDynamic()) return;
  hiveDynamicTick(world, engine);
}
