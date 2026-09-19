import type { RobotState, Vec2, World } from '../../types';
import { SHOT, SHOT_DASH, SHOT_GAP, SHOT_PATH_COLOR, shotArc, solveShotPath } from './shotPath';

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
 */

/** the same `z → screen` lift `drawBiobuzzBalls` gives a flight element. One number, two readers:
 * a path drawn at a different lift would not pass through its own element. */
const Z_LIFT = 0.12;

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
