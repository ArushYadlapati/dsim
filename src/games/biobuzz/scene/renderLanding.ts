import type { RobotState, World } from '../../../types';
import { GRAVITY, SIM_DT } from '../../../config';
import { BB_HALF_X, BB_HALF_Y, BB_HOOD_DEFAULT_DEG, BB_LAUNCH_Z0, BB_POLLEN_R } from '../config';
import { bbIsTurreted, bbLauncherOf } from '../mechs';
import { bbDumpSolution, bbTurretRelease, bbTurretSolution } from '../robot';
import { bbAimTarget } from '../play';
import type { ScoreTarget } from '../state';

/**
 * WHERE THE LOCAL ROBOT'S CURRENT SHOT LANDS — the maths behind the 3D reticle
 * (`renderReticle.ts` draws it; this file works it out).
 *
 * ── WHY IT IS ITS OWN FILE ───────────────────────────────────────────────────────────────
 * It imports no `three` and touches no DOM, so `scripts/smoke-biobuzz/render.ts` can import it
 * and assert real numbers against it — a reticle that promises a landing the sim does not
 * deliver is a bug you cannot see in a screenshot (the ring looks perfectly convincing wherever
 * it is), and the only way to catch it is to check the arc against closed-form ballistics and
 * against the field's own geometry. The mesh half stays in `renderReticle.ts`, which is where
 * `three` belongs.
 *
 * ── THE MATHS IS `play.ts`'s, NOT A SECOND ANSWER ────────────────────────────────────────
 * The RELEASE comes from the sim's own functions — `bbTurretSolution` + `bbTurretRelease` for a
 * turret (the shot that turret would make RIGHT NOW, at its current yaw and pitch: exactly what
 * Aim Assist's stage 5b predicts, so a turret still slewing shows the shot it would actually
 * take), `bbDumpSolution` for a dumper. The FLIGHT is the integrator from `play.ts`'s
 * `bbFlightEnters`, step for step and in the same order: position, height, gravity, wall clamp.
 *
 * ⚠️ `bbFlightEnters` RETURNS A BOOLEAN, so it cannot be asked for a POSITION, and that is the
 * duplication this file carries. It is named here so the two can be diffed, and IF THAT
 * INTEGRATOR CHANGES THIS MUST CHANGE WITH IT — otherwise the ring and the shot disagree, which
 * is worse than no ring at all, because a driver aims by it.
 *
 * Renderer code, so `Math.*` and a non-deterministic engine are allowed (`scripts/smoke.ts`
 * exempts `render*`/`draw*` by name, and nothing here is ever stepped into a world). It still
 * integrates at `SIM_DT` with the shared `GRAVITY`: a preview drawn at a different step size
 * than the sim integrates at is a preview of a different shot.
 *
 * ZERO ALLOCATION PER SOLVE: the result is one module-scope object and one preallocated
 * `Float32Array` of arc vertices, both rewritten in place. (The two sim functions it calls do
 * allocate their own small result object — one shot's worth per frame, not one per step.)
 */

/** four seconds of flight at `SIM_DT`, the same bound `bbFlightEnters` uses ("well past any arc
 * a legal launch speed can make"). */
export const MAX_STEPS = Math.ceil(4 / SIM_DT);
/** how many integration steps per stored arc vertex. The arc is a hint, not a measurement: at
 * 60 Hz a shot is airborne for well under a second, so every third tick is a smooth curve. */
export const ARC_EVERY = 3;
/** the arc line's fixed vertex budget — `MAX_STEPS / ARC_EVERY` rounded up, so even the longest
 * survivable arc fits without a reallocation. */
export const ARC_MAX = Math.ceil(MAX_STEPS / ARC_EVERY) + 2;

/** the arc's vertices, `[x,y,z]` per point, valid up to `LANDING.arc` points. Handed straight to
 * a `THREE.BufferAttribute` by `renderReticle.ts` — hence a `Float32Array` here rather than in
 * the drawing file: the buffer must outlive every solve, since the attribute wraps it once. */
export const arcBuffer = new Float32Array(ARC_MAX * 3);

export interface BbLanding {
  /** false ⇒ there is no shot to draw (no solution, or still airborne after four seconds). */
  ok: boolean;
  x: number;
  y: number;
  z: number;
  /** how many of `arcBuffer`'s points are valid. */
  arc: number;
}

/** the solved landing — module scope, rewritten in place by every solve. */
export const LANDING: BbLanding = { ok: false, x: 0, y: 0, z: 0, arc: 0 };

/**
 * Integrate one release to its landing, into `LANDING`/`arcBuffer`.
 *
 * STOPS AT WHICHEVER COMES FIRST: the target's OPENING PLANE (descending through `target.z`
 * within its own accept radius of `target.pos` — this is the shot that scores, and the ring
 * belongs at the mouth, not on the floor under it) or the FLOOR (`z <= 0`). Both crossings are
 * linearly interpolated to the exact point, so a 60 Hz step does not bury the ring under the
 * tiles or float it an inch over them.
 */
export function solveLanding(
  ox: number,
  oy: number,
  z0: number,
  vx: number,
  vy: number,
  vz0: number,
  target: ScoreTarget,
): boolean {
  LANDING.ok = false;
  LANDING.arc = 0;
  let x = ox;
  let y = oy;
  let z = z0;
  let vz = vz0;
  const rr = target.r + BB_POLLEN_R;
  const r2 = rr * rr;
  let n = 0;
  for (let i = 0; i < MAX_STEPS; i++) {
    const px = x;
    const py = y;
    const pz = z;
    // the SAME order as `bbFlightEnters`: position, height, then gravity.
    x += vx * SIM_DT;
    y += vy * SIM_DT;
    z += vz * SIM_DT;
    vz -= GRAVITY * SIM_DT;
    // the wall clamp `bbFlightEnters` applies through `clampPollenToWalls`, inlined to the two
    // bounds that matter for a PICTURE: an element that has hit a wall is no longer on the arc
    // this reticle promised, and the ring stops where it stopped.
    if (x < -BB_HALF_X + BB_POLLEN_R) x = -BB_HALF_X + BB_POLLEN_R;
    else if (x > BB_HALF_X - BB_POLLEN_R) x = BB_HALF_X - BB_POLLEN_R;
    if (y < -BB_HALF_Y + BB_POLLEN_R) y = -BB_HALF_Y + BB_POLLEN_R;
    else if (y > BB_HALF_Y - BB_POLLEN_R) y = BB_HALF_Y - BB_POLLEN_R;

    if (i % ARC_EVERY === 0 && n < ARC_MAX - 1) {
      arcBuffer[n * 3] = x;
      arcBuffer[n * 3 + 1] = y;
      arcBuffer[n * 3 + 2] = z;
      n++;
    }

    // THE OPENING PLANE — descending across `target.z` and inside the mouth.
    if (vz < 0 && pz > target.z && z <= target.z) {
      const t = (pz - target.z) / (pz - z || 1);
      const hx = px + (x - px) * t;
      const hy = py + (y - py) * t;
      const dx = hx - target.pos.x;
      const dy = hy - target.pos.y;
      if (dx * dx + dy * dy <= r2) {
        finish(hx, hy, target.z, n);
        return true;
      }
    }

    // THE FLOOR.
    if (z <= 0) {
      const t = pz / (pz - z || 1);
      finish(px + (x - px) * t, py + (y - py) * t, 0, n);
      return true;
    }
  }
  // four seconds and still in the air is not a shot anybody took — report nothing rather than a
  // ring at an arbitrary truncation point.
  return false;
}

function finish(x: number, y: number, z: number, n: number): void {
  arcBuffer[n * 3] = x;
  arcBuffer[n * 3 + 1] = y;
  arcBuffer[n * 3 + 2] = z;
  LANDING.ok = true;
  LANDING.x = x;
  LANDING.y = y;
  LANDING.z = z;
  LANDING.arc = n + 1;
}

/**
 * Solve THIS robot's current shot into `LANDING`. False ⇒ nothing to draw: the launcher has no
 * solution (a dumper outside `BB_DUMP_MIN_DIST`..`BB_DUMP_MAX_DIST`, a turret whose arc the
 * barrel cannot make) or the arc never comes down.
 */
export function solveShotLanding(world: World, r: RobotState): boolean {
  LANDING.ok = false;
  const launcher = bbLauncherOf(r.spec, BB_HOOD_DEFAULT_DEG);
  const target = bbAimTarget(world, r);
  if (bbIsTurreted(launcher)) {
    // the solution says how fast this turret WOULD fire; the release says where it is pointing
    // NOW. Both, exactly as `play.ts` stage 5b does it.
    const sol = bbTurretSolution(r, target, 0);
    if (!sol) return false;
    const rel = bbTurretRelease(r, 0, sol.speed);
    return solveLanding(rel.origin.x, rel.origin.y, BB_LAUNCH_Z0, rel.vel.x, rel.vel.y, rel.vel.z, target);
  }
  // A DUMPER throws its whole hopper along converging arcs; the MIDDLE one is the shot the
  // chassis is aimed along, and one ring is the honest summary of a spread whose whole design is
  // to converge on the cell centre (`bbDumpSolution`'s own header).
  const throws = bbDumpSolution(r, target, 1);
  if (!throws || throws.length === 0) return false;
  const t = throws[0];
  return solveLanding(t.origin.x, t.origin.y, BB_LAUNCH_Z0, t.vel.x, t.vel.y, t.vel.z, target);
}
