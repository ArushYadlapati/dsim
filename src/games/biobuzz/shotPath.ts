import type { RobotState, World } from '../../types';
import { SIM_DT } from '../../config';
import { wrapAngle } from '../../math';
import { BB_AIM_TOL, BB_HOOD_DEFAULT_DEG, BB_LAUNCH_Z0 } from './config';
import { bbIsTurreted, bbLauncherOf, bbTurretFor } from './mechs';
import { bbAimHeading, bbDumpSolution, bbTurretRelease, bbTurretSolution } from './robot';
import { bbAimTarget, bbFlightEnters, type BbFlightTrace } from './play';

/**
 * THE SHOT PATH — will the local robot's next shot go in, and what does it fly through on the way
 * (owner playtest feedback 2026-09-18, items 5 and 6).
 *
 * ── ONE PREDICTOR, TWO VIEWS ────────────────────────────────────────────────────────────────
 * The 2D map (`drawShot.ts`) and the 3D scene (`scene/renderReticle.ts`) both call THIS function
 * and draw what it leaves behind. Neither works anything out for itself. It lives OUTSIDE
 * `scene/` for a mechanical reason as well as a design one: nothing outside `scene/` may import
 * from it statically (the RENDER lane asserts that), so a predictor that lived there could never
 * have had a second reader.
 *
 * ── AND IT IS THE SIM'S OWN BALLISTICS, NOT A COPY OF THEM ──────────────────────────────────
 * The release comes from the sim's own solvers (`bbTurretSolution` + `bbTurretRelease` for a
 * turret, `bbDumpSolution` for a dumper) and the flight from `play.ts`'s `bbFlightEnters`, which
 * now records the arc it flew into a caller-owned buffer (`BbFlightTrace`). This file used to be
 * `scene/renderLanding.ts` and it carried its own copy of that integrator; its own header warned
 * that a copy which drifts is invisible on screen, because a drawn arc looks equally convincing
 * wherever it goes and a driver aims by it. There is one loop now.
 *
 * ── WHAT "MADE" MEANS, EXACTLY ──────────────────────────────────────────────────────────────
 * The predicted flight enters the robot's OWN HIVE CELL — `hiveAccepts`, the same predicate the
 * capture pass uses: inside the taking cell's opening footprint, within the opening-height band,
 * descending, and travelling inboard. Against the REAL hive state, not Aim Assist's pretend-up
 * copy (`play.ts` stage 5b): the assist aims at the nearer cell whichever way the HIVE is tilted,
 * and a path drawn off that belief would promise a shot at a cell that is down. Anything else —
 * out of range, a barrel that cannot make the arc (`reachable`), a swing that has taken the cell
 * away, a dumper off its aim heading, a dump where any one element would fall short — is NOT made,
 * and NOTHING is drawn.
 *
 * A turret's shot is the one it would take RIGHT NOW, at its CURRENT yaw and pitch (not at its
 * solution), so a turret still slewing shows nothing until it is actually on target. A dumper's
 * is the whole hopper: the chassis has to be inside `BB_AIM_TOL` of `bbAimHeading` (stage 5b's own
 * gate — a dumper turns the whole robot and will not fire until it has) and every element has to
 * land; the arc drawn is the middle one.
 *
 * ZERO ALLOCATION PER SOLVE in the buffer that matters: `shotArc` and `TRACE` are module scope
 * and rewritten in place. (The two sim solvers allocate their own small result objects — one
 * shot's worth per frame, not one per integration step.)
 */

/** how many integration steps per stored arc point. The path is a hint, not a measurement; every
 * second tick is a smooth curve at every flight time a legal launch speed can produce. */
export const SHOT_ARC_EVERY = 2;

/** the path's fixed point budget — the four-second flight bound `bbFlightEnters` uses, divided by
 * `SHOT_ARC_EVERY`, plus room for the terminal point. */
export const SHOT_ARC_MAX = Math.ceil(4 / SIM_DT / SHOT_ARC_EVERY) + 2;

/** the path's points, `[x, y, z]` each, valid up to `SHOT.points`. A `Float32Array` because the
 * 3D renderer wraps it in a `THREE.BufferAttribute` ONCE and it must outlive every solve. */
export const shotArc = new Float32Array(SHOT_ARC_MAX * 3);

/** the trace handed to the sim — module scope, never reallocated. */
const TRACE: BbFlightTrace = { pts: shotArc, every: SHOT_ARC_EVERY, n: 0 };

export interface BbShotPath {
  /** false ⇒ DRAW NOTHING. There is no shot, or it would not go in. */
  made: boolean;
  /** how many of `shotArc`'s points are valid. */
  points: number;
}

/** the solved path — module scope, rewritten in place by every solve. */
export const SHOT: BbShotPath = { made: false, points: 0 };

/**
 * Solve THIS robot's current shot into `SHOT` / `shotArc`. `false` ⇒ the renderers draw nothing.
 *
 * NOT gated on the hopper: the question a driver is asking while they line up is "if I fired from
 * here, would it go in", and the hopper count is already a HUD chip. A turret with something
 * loaded predicts the exit that element would actually leave by (a double turret sends NECTAR out
 * of turret 1), so the path matches the next shot rather than an average of two.
 */
export function solveShotPath(world: World, r: RobotState): boolean {
  SHOT.made = false;
  SHOT.points = 0;
  const bb = world.biobuzz;
  if (!bb || r.passive) return false;
  const hive = bb.hives[r.alliance];
  const launcher = bbLauncherOf(r.spec, BB_HOOD_DEFAULT_DEG);
  const target = bbAimTarget(world, r);

  if (bbIsTurreted(launcher)) {
    const top = r.hopper.length > 0 ? r.hopper[r.hopper.length - 1] : undefined;
    const which = top === undefined ? 0 : bbTurretFor(launcher, top === 'red' || top === 'blue');
    const sol = bbTurretSolution(r, target, which);
    // an arc the barrel cannot make is fired anyway (honestly, and it misses) — there is no path
    // to promise for it
    if (!sol || !sol.reachable) return false;
    const rel = bbTurretRelease(r, which, sol.speed);
    if (!bbFlightEnters(hive, r.alliance, rel.origin, BB_LAUNCH_Z0, rel.vel, SIM_DT, TRACE)) return false;
    SHOT.made = true;
    SHOT.points = TRACE.n;
    return true;
  }

  // A DUMPER throws its WHOLE hopper on converging arcs (`bbDumpSolution`). "Made" is every one of
  // them landing, which is the same verdict stage 5b reaches; the drawn arc is the MIDDLE throw,
  // the honest summary of a spread whose whole design is to converge on the cell centre.
  //
  // THE HEADING GATE IS PART OF THAT VERDICT. A dumper turns the WHOLE ROBOT, and stage 5b will
  // not fire one until the chassis is within `BB_AIM_TOL` of `bbAimHeading` — same wrap, same
  // strict `<`. Without it the path promised a made shot for a dumper pointing the wrong way,
  // which is exactly the shot that does not happen.
  const want = bbAimHeading(r, target);
  if (want === null || Math.abs(wrapAngle(want - r.heading)) >= BB_AIM_TOL) return false;
  const throws = bbDumpSolution(r, target, Math.max(1, r.hopper.length));
  if (!throws || throws.length === 0) return false;
  const mid = (throws.length - 1) >> 1;
  for (let i = 0; i < throws.length; i++) {
    const t = throws[i];
    const ok = bbFlightEnters(hive, r.alliance, t.origin, BB_LAUNCH_Z0, t.vel, SIM_DT, i === mid ? TRACE : undefined);
    if (!ok) return false;
  }
  SHOT.made = true;
  SHOT.points = TRACE.n;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// HOW IT IS DRAWN — shared by both renderers so the two views cannot drift apart
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The on-field accent, as a literal. Category 3 in `docs/area/ui.md`'s theming note — its ground
 * is the CANVAS, which is hardcoded dark and never themes — so this is the same value
 * `--ds-on-field-accent` carries in BOTH blocks of `shell.css`, and each renderer reads the token
 * once with this as its fallback for a detached or pre-layout document.
 */
export const SHOT_PATH_COLOR = '#5fb597';
/** the dash pattern, in FIELD INCHES, so the 2D map and the 3D scene dot the same path the same
 * way at the same scale. */
export const SHOT_DASH = 2.2;
export const SHOT_GAP = 2.6;
