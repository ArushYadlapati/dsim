import { useEffect, useMemo, useRef } from 'react';
import type { Alliance, RobotSpec, StartPose, Vec2, World } from '../../types';
import { DEFAULT_ASSISTS } from '../../sim/spawn';
import { BB_HALF_X, BB_HALF_Y, BB_START_POSES, BB_VIEW_MARGIN, bbDefaultIndex, bbMirror } from './config';
import { bbSnapStart } from './start';
import { BIOBUZZ_SIM } from './sim';
import { drawBiobuzzField } from './drawField';
import {
  BB_PASS_PRESETS,
  BB_PASS_PRESET_DEFAULT,
  BB_PASS_PRESET_HINT,
  BB_PASS_PRESET_LABEL,
  bbPassPresetPoint,
  isBbPassPreset,
  type BbPassPreset,
} from './passTargets';

/**
 * WHERE PASS THROWS — the builder control for `RobotSpec.bbPassTarget`/`bbPassPreset` (owner,
 * 2026-09-22: "Where to pass should also be configurable using a map and there should be
 * presets"). Lives in the BIOBUZZ builder (`Builder.tsx`), under the Launcher section — a pass
 * is thrown by the launcher hardware every build carries.
 *
 * ── THE MAP IS THE REAL FIELD RENDERER, NOT A SCHEMATIC ─────────────────────────────────────
 * `drawBiobuzzField` + the exact camera `BiobuzzStartEditor` (`StartEditor.tsx`) already uses
 * (`SPAN`, `size / SPAN` scale, `+y` up) — copied rather than imported because it is four lines
 * and importing a `const` out of a `.tsx` file that also exports a component is the kind of
 * coupling that breaks when that file's default export changes. Reusing the renderer means the
 * hives, both LOADING ZONES, the tags and the tape are ALL real geometry, for free, and they can
 * never drift from the field a match actually draws — the exact property the task asked for
 * ("every coordinate comes from the real constants") is true of the WHOLE map, not just the
 * marker. The click math is `BiobuzzStartEditor.pointerWorld`'s, copied for the same reason: it
 * is the inverse of the same four camera lines, and it is already proven correct by that
 * component's own drag interaction.
 *
 * ── WHY THE MAP IS MOUSE-ONLY, AND THE PRESETS ARE THE ACCESSIBLE PATH ───────────────────────
 * The four preset buttons are real `<button>`s — focusable, labelled, operable from a keyboard.
 * The canvas is not (same as `BiobuzzStartEditor`'s own drag surface, which leans on its numeric
 * X/Y/heading inputs beside it for the same reason): a click-to-place canvas control has no
 * accessible equivalent short of a second, numeric picker, and the presets already cover "I
 * don't care about the exact inch" for every player who cannot or would rather not click a
 * canvas. A custom point is the power-user path on top of that, not the only path to a pass.
 */

/** the SAME camera the start editor stages its field in: the field's own half-extents plus the
 * camera margin that clears the FLOWER read-out columns drawn just outside the perimeter
 * (`BB_VIEW_MARGIN`) — leaving it out crops the flower columns at the picker's edge. */
const SPAN = (Math.max(BB_HALF_X, BB_HALF_Y) + BB_VIEW_MARGIN) * 2;

/** world inches, fixed regardless of zoom — same convention `BiobuzzStartEditor` draws its
 * heading handle at (a literal inch radius, not a screen-px one divided by the camera scale). */
const THROWER_R = 2.6;
const TARGET_R = 3.4;

export interface BbPassPickerProps {
  spec: RobotSpec;
  alliance: Alliance;
  /** the ACTIVE start (mirrors `GameSettings.startIndex`/`.startPose`): a set `startPose`
   * overrides the anchor, exactly as the spawner and the start editor read it. */
  startIndex: number;
  startPose: StartPose | null | undefined;
  onChange(patch: Partial<RobotSpec>): void;
  size?: number;
}

/**
 * THE THROWER'S POSITION — the `from` `pastGoal`/`farEnd` solve against, resolved HONESTLY
 * rather than guessed. Judgment call, stated once: a CUSTOM start pose wins over the anchor
 * index, the exact contract `spawn.ts`'s `bbStartPose` and `BiobuzzStartEditor` already read
 * `GameSettings` through, so the point drawn here is not a second opinion about where the robot
 * starts — it is the same seat.
 *
 * The anchor case runs through `bbSnapStart`, the SAME re-seat the spawner applies: an anchor in
 * `BB_START_POSES` sits a hair off the wall until a build's own footprint re-seats it against
 * G304.C ("touching the perimeter"), so reading the table entry raw would be honest about the
 * wrong inch for anything but the default chassis. `bbSnapStart`'s own header: "it has a hair to
 * move, not a foot" — the point this function returns is therefore accurate to within that hair,
 * not merely in the right neighbourhood.
 */
function bbBuilderFrom(
  spec: RobotSpec,
  alliance: Alliance,
  startIndex: number,
  startPose: StartPose | null | undefined,
): Vec2 {
  if (startPose) {
    return alliance === 'blue' ? { x: startPose.x, y: startPose.y } : bbMirror({ x: startPose.x, y: startPose.y });
  }
  const anchor = BB_START_POSES[startIndex] ?? BB_START_POSES[bbDefaultIndex('close')];
  const seat = bbSnapStart(
    spec,
    { x: anchor.pos.x, y: anchor.pos.y, headingDeg: (anchor.heading * 180) / Math.PI },
    alliance,
  );
  return { x: seat.x, y: seat.y };
}

/** the on-field accent and its dim sibling, resolved ONCE per module load. Category-3 tokens
 * (`docs`/CLAUDE.md THEMING gotcha): their ground is the hardcoded-dark field canvas, which
 * never inverts, so there is nothing to re-read on a theme change — the same reasoning
 * `drawShot.ts`'s `pathColor()` already documents for the identical cache shape. */
let TARGET_COLOR: string | null = null;
let THROWER_COLOR: string | null = null;
function targetColor(): string {
  if (TARGET_COLOR === null) {
    TARGET_COLOR = '#5fb597';
    try {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--ds-on-field-accent').trim();
      if (/^#[0-9a-fA-F]{6}$/.test(raw)) TARGET_COLOR = raw;
    } catch {
      // detached / pre-layout document — the literal above is the same value
    }
  }
  return TARGET_COLOR;
}
function throwerColor(): string {
  if (THROWER_COLOR === null) {
    THROWER_COLOR = '#b9beb8';
    try {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--ds-on-field-dim').trim();
      if (/^#[0-9a-fA-F]{6}$/.test(raw)) THROWER_COLOR = raw;
    } catch {
      // detached / pre-layout document — the literal above is the same value
    }
  }
  return THROWER_COLOR;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

export function BbPassPicker({ spec, alliance, startIndex, startPose, onChange, size = 200 }: BbPassPickerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // recomputed on every build edit — `bbSnapStart` is a wall-walk over the field's three legal
  // strips (no physics solve), so re-running it per keystroke is cheap; there is no separate
  // "identity" key here the way `RobotPreview`'s world-respawn needs one.
  const from = useMemo(
    () => bbBuilderFrom(spec, alliance, startIndex, startPose),
    [spec, alliance, startIndex, startPose],
  );

  const preset: BbPassPreset = isBbPassPreset(spec.bbPassPreset) ? spec.bbPassPreset : BB_PASS_PRESET_DEFAULT;
  const custom = spec.bbPassTarget;
  const point = custom ?? bbPassPresetPoint(preset, alliance, from);

  // a world for `drawBiobuzzField` alone — the function reads `world.biobuzz` for the live hive
  // tilt and falls back to the STAGED pose when it is absent (its own header), so the one
  // template robot below never has to be the right build for the map to read correctly.
  // Rebuilt only on an ALLIANCE flip, which is the one thing that changes which half of the
  // (point-symmetric) field is drawn as "yours".
  const world: World = useMemo(
    () => BIOBUZZ_SIM.createWorld('free', 1, [{ id: 0, alliance, spec, assists: { ...DEFAULT_ASSISTS }, startIndex: 0 }]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [alliance],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);
    // camera: fit the field, +y up, world inches -> css px — byte for byte `BiobuzzStartEditor`'s.
    const s = size / SPAN;
    ctx.translate(size / 2, size / 2);
    ctx.scale(s, -s);

    drawBiobuzzField(ctx, world);

    // THE THROWER — a reference dot, not a control. Dim on purpose: it says where the point is
    // measured FROM without competing with the point itself, which is the thing a driver is
    // actually setting.
    ctx.beginPath();
    ctx.arc(from.x, from.y, THROWER_R, 0, Math.PI * 2);
    ctx.fillStyle = throwerColor();
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;

    // THE RESOLVED PASS POINT — a crosshair, so it reads as an aim rather than a second robot.
    ctx.strokeStyle = targetColor();
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(point.x - TARGET_R, point.y);
    ctx.lineTo(point.x + TARGET_R, point.y);
    ctx.moveTo(point.x, point.y - TARGET_R);
    ctx.lineTo(point.x, point.y + TARGET_R);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(point.x, point.y, TARGET_R * 0.55, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }, [world, from.x, from.y, point.x, point.y, size]);

  /** click-to-inches — the INVERSE of the camera set up above, and identical to
   * `BiobuzzStartEditor.pointerWorld`: `getBoundingClientRect` rather than the canvas's own
   * `width`/`height` attributes, because the canvas is a DPR-scaled backing store CSS-shrunk to
   * `size` px, and `rect.width` is the CSS size the click coordinates actually arrive in. */
  const onClick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const s = size / SPAN;
    const px = ((e.clientX - rect.left) / rect.width) * size;
    const py = ((e.clientY - rect.top) / rect.height) * size;
    const x = (px - size / 2) / s;
    const y = -(py - size / 2) / s;
    // NOT clamped here — `coerceBiobuzzSpec` is the one chokepoint (`Builder.tsx`'s own rule)
    // and re-clamps into the field on the host's next render. A click in the view margin
    // (outside the perimeter, inside `BB_VIEW_MARGIN`) briefly shows an out-of-field dot and
    // the coercer pulls it back in, which is the same round-trip every other dial here takes.
    onChange({ bbPassTarget: { x, y } });
  };

  /** a preset CLEARS the custom point — the one wiring mistake available here (task's own
   * words): `bbPassTarget` wins when both are set, so leaving an old map pick in place would
   * make the preset silently do nothing. */
  const pickPreset = (p: BbPassPreset): void => onChange({ bbPassPreset: p, bbPassTarget: undefined });

  return (
    <>
      <h3 className="ds-subh">Pass target</h3>
      <div className="ds-passpick">
        <div className="ds-startpos-stage">
          <canvas
            ref={canvasRef}
            className="ds-startpos-canvas"
            style={{ width: size, cursor: 'crosshair' }}
            onClick={onClick}
            role="img"
            aria-label={`Pass target field map. Current target ${round1(point.x)}, ${round1(point.y)} inches${custom ? ' (custom point)' : ` (${BB_PASS_PRESET_LABEL[preset]} preset)`}.`}
          />
        </div>
        {/* LABELS ALONE. The map beside them draws the point each one resolves to, so a sentence
            under every tile ("Your own loading zone, against the side wall") described the dot
            the player is looking at, and the coordinates line under the grid printed it a third
            time. The one fact the map cannot show — that PAST THE GOAL and FAR END follow the
            thrower — rides the tile's title; the coordinates stay in the map's aria-label. */}
        <div className="ds-passpick-presets">
          <div className="ds-opts two">
            {BB_PASS_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className={`ds-opt mini ${!custom && preset === p ? 'on' : ''}`}
                aria-pressed={!custom && preset === p}
                title={BB_PASS_PRESET_HINT[p]}
                onClick={() => pickPreset(p)}
              >
                <span className="ot">{BB_PASS_PRESET_LABEL[p]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
