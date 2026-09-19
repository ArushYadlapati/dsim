import type { RobotState, Vec2, World } from '../../types';
import { SHOT, SHOT_DASH, SHOT_GAP, SHOT_PATH_COLOR, shotArc, solveShotPath } from './shotPath';
import { BB_FLOWERS, BB_FLOWER_OPEN_R } from './config';
import { bbFlowerInReach } from './robot';

/**
 * THE SHOT PATH, ON THE 2D MAP — the top-down half of what `scene/renderReticle.ts` draws in 3D
 * (owner playtest feedback 2026-09-18, items 5 and 6).
 *
 * The VERDICT and the ARC are `shotPath.ts`'s, shared with the 3D scene: a path is drawn only
 * when the shot is MADE, and nothing at all when it is not. No landing marker in either view.
 *
 * ── WHAT A TOP-DOWN VIEW HAS TO ADD ─────────────────────────────────────────────────────────
 * The arc's points carry a HEIGHT, and a flat map that ignored it would draw the path as a
 * straight line from the muzzle to the cell — which is the one thing it must not look like, since
 * the element visibly rises and falls. So every point is lifted along `screenUp` by the SAME
 * `z * 0.12` the flight elements themselves are lifted by (`draw.ts`), and the path therefore
 * lands exactly where the drawn element will.
 *
 * Drawn LAST, over everything including the hive canopy: it is an instrument, not scenery.
 *
 * `drawBiobuzzReachCue` below is a SECOND, unrelated instrument in this same file (2026-09-19,
 * owner bug report item 6: "a clearer in-field indicator when the flower is in reach") — the 2D
 * half of `scene/renderReticle.ts`'s reach collar, same predicate, same "one predictor, two
 * drawings" rule (`docs/area/biobuzz.md`).
 */

/** the same `z → screen` lift `drawBiobuzzBalls` gives a flight element. One number, two readers:
 * a path drawn at a different lift would not pass through its own element. */
const Z_LIFT = 0.12;

/**
 * The reach collar's radii, in field inches — the SAME pad `scene/renderReticle.ts`'s 3D twin
 * uses, so the cue is one physical size in both views. APPROX: sized off the flower's own
 * measured top-ring opening (`BB_FLOWER_OPEN_R`) with enough pad to clear its rim and read as a
 * distinct band rather than tracing the opening's own edge.
 */
const REACH_COLLAR_IN = BB_FLOWER_OPEN_R + 0.4; // APPROX
const REACH_COLLAR_OUT = BB_FLOWER_OPEN_R + 1.6; // APPROX

/** the pulse rate (Hz) and the alpha range it drives — the SAME numbers `renderReticle.ts` uses,
 * tuned so the collar reads as ACTIVE at match distance (the owner's complaint: today's cue, the
 * HUD chip, is "too subtle") without reading as flicker. APPROX, cosmetic only —
 * `world.time`-driven, so it costs nothing to determinism or a replay. */
const REACH_PULSE_HZ = 1.6; // APPROX
const REACH_ALPHA_MIN = 0.42; // APPROX
const REACH_ALPHA_MAX = 0.88; // APPROX

/** the on-field accent, resolved ONCE. It is category 3 in `docs/area/ui.md` — its ground is the
 * canvas, which never themes — so there is nothing to re-read on a theme change. */
let PATH_COLOR: string | null = null;
function pathColor(): string {
  if (PATH_COLOR === null) {
    PATH_COLOR = SHOT_PATH_COLOR;
    try {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--ds-on-field-accent').trim();
      if (/^#[0-9a-fA-F]{6}$/.test(raw)) PATH_COLOR = raw;
    } catch {
      // a detached / pre-layout document — the literal is the same value
    }
  }
  return PATH_COLOR;
}

/**
 * Draw the local robot's shot path, or nothing.
 *
 * `localRobotId` is absent for a spectator or somebody else's replay, and there is then no robot
 * whose shot this would be.
 */
export function drawBiobuzzShotPath(
  ctx: CanvasRenderingContext2D,
  world: World,
  screenUp: Vec2,
  localRobotId: number | undefined,
): void {
  if (localRobotId === undefined) return;
  let robot: RobotState | null = null;
  for (const r of world.robots) {
    if (r.id === localRobotId) {
      robot = r;
      break;
    }
  }
  if (!robot || robot.passive) return;
  if (!solveShotPath(world, robot) || SHOT.points < 2) return;

  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < SHOT.points; i++) {
    const k = i * 3;
    const lift = shotArc[k + 2] * Z_LIFT;
    const x = shotArc[k] + screenUp.x * lift;
    const y = shotArc[k + 1] + screenUp.y * lift;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.setLineDash([SHOT_DASH, SHOT_GAP]);
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = pathColor();
  ctx.globalAlpha = 0.92;
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw a PULSING collar around the flower the local robot's Box Tube can currently place into,
 * or nothing.
 *
 * `bbFlowerInReach` (`./robot.ts`) is the ONE predictor — this reads it and works out no distance
 * of its own, exactly as `drawBiobuzzShotPath` above reads `solveShotPath` rather than solving a
 * shot itself. `scene/renderReticle.ts` is the 3D twin, same predicate, same radii, same pulse
 * rate. A filled annulus (not a stroke, and never `RingGeometry`'s 2D-canvas equivalent of a bare
 * outline) so it reads at a glance and does not compete with the dotted shot-path line above,
 * which targets a different field element (the hive, not a flower) entirely.
 *
 * `localRobotId` is absent for a spectator or somebody else's replay, and a PASSIVE practice
 * dummy is never driven, so neither has a "reach" to show.
 */
export function drawBiobuzzReachCue(ctx: CanvasRenderingContext2D, world: World, localRobotId: number | undefined): void {
  if (localRobotId === undefined) return;
  let robot: RobotState | null = null;
  for (const r of world.robots) {
    if (r.id === localRobotId) {
      robot = r;
      break;
    }
  }
  if (!robot || robot.passive) return;
  const idx = bbFlowerInReach(world, robot);
  if (idx === null) return;
  const f = BB_FLOWERS[idx];

  const pulse = 0.5 + 0.5 * Math.sin(world.time * REACH_PULSE_HZ * Math.PI * 2);
  ctx.save();
  ctx.beginPath();
  ctx.arc(f.x, f.y, REACH_COLLAR_OUT, 0, Math.PI * 2);
  ctx.arc(f.x, f.y, REACH_COLLAR_IN, 0, Math.PI * 2, true);
  ctx.closePath();
  ctx.fillStyle = pathColor();
  ctx.globalAlpha = REACH_ALPHA_MIN + pulse * (REACH_ALPHA_MAX - REACH_ALPHA_MIN);
  ctx.fill('evenodd');
  ctx.restore();
}
