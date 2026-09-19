import { publishRenderStats } from '../../../perfStats';
import type { PerfOverlay } from '../graphics/settings';

/**
 * THE 3D RENDERER'S FRAME COUNTERS (`docs/biobuzz/plan-3d.md` §4.4, last row) — fps, p95 frame
 * time and draw calls, on their way to the ONE performance read-out.
 *
 * ── IT USED TO DRAW ITS OWN CORNER DIV, AND THAT IS THE BUG THIS FIXES ─────────────────────
 * It appended a `.bb-gfxstat` element into the scene's host at `top: 48px; left: 12px`. The
 * EVENT LOG is at `top: 52px; left: 14px` (`.eventlog` in `src/ui/styles.css`) — so with the
 * overlay on, the corner where the match tells you what just scored was covered by a frame
 * counter (owner, 2026-09-19: "the performance display covers the 'messages' or game events").
 * The two could not be nudged apart either, because they are both read-outs anchored to the
 * one corner the MENU/RESET row does not already own.
 *
 * So the numbers now go where every other number a player reads goes: the React HUD, through
 * `src/perfStats.ts`, which draws ONE display in the top-right on `GameSettings.perfDisplay`.
 * The original header's reasoning against WebGL text still holds and is why the destination is
 * a `<div>` rather than a font atlas; what changed is WHICH div.
 *
 * ── WHAT IS LEFT HERE ──────────────────────────────────────────────────────────────────────
 * The averaging window, and nothing else. `frame()` is called from inside `renderScene`'s own
 * render — the one place `info.render` can be read before the blit resets it — and this turns
 * a stream of per-frame costs into the 2 Hz summary the read-out wants, so the HUD never has
 * to sample at frame rate to get a stable number.
 */

/** how often the averaged numbers are published. 2 Hz: an average over the window rather than
 * the reciprocal of one frame, which flickers by ±15 fps on a healthy machine. The read-out
 * polls at 4 Hz, so a published value is never more than one poll old. */
const REFRESH_MS = 500;

export interface BbStats {
  /**
   * One rendered frame. `ms` is that frame's own cost and `p95` comes from the governor, which
   * owns the window (this file must not keep a second, disagreeing one).
   *
   * ⚠️ `calls`/`tris` ARE PASSED IN, not read off the renderer here, and that is a bug fix
   * rather than a preference: `WebGLRenderer.info.render` is RESET at the start of every
   * `render()` call, and a frame ends with the MSAA blit (and sometimes the minimap). Reading
   * the counters from this function reported the blit's own two triangles — the read-out said
   * "1 draws · 2 tris" over a field of several hundred, which is worse than no read-out because
   * it is a plausible number.
   */
  frame(ms: number, p95: number, calls: number, tris: number): void;
  setMode(mode: PerfOverlay): void;
  dispose(): void;
}

/**
 * `host` and `mode` are still taken so `renderScene.ts` keeps its two call sites unchanged, and
 * both are now ignored: there is no element to mount and the LEVEL is decided by
 * `GameSettings.perfDisplay`, which is one setting for every game rather than a 3D-only row in
 * the Graphics section. `GraphicsSettings.perfOverlay` is inert for the same reason — it can be
 * deleted along with those two call sites whenever this file's neighbour is not being edited by
 * another lane.
 *
 * Publishing is UNCONDITIONAL. It is four number writes into one preallocated object twice a
 * second; gating it on a display level would only mean the read-out showed nothing for its
 * first half-second every time somebody turned it up.
 */
export function createStats(_host?: HTMLElement, _mode?: PerfOverlay): BbStats {
  let last = 0;
  /** frames since the last publish, and their total cost — see REFRESH_MS. */
  let frames = 0;
  let total = 0;

  return {
    frame(ms: number, p95: number, calls: number, tris: number): void {
      frames++;
      total += ms;
      const now = performance.now();
      if (now - last < REFRESH_MS) return;
      last = now;
      publishRenderStats(frames > 0 ? total / frames : ms, p95, calls, tris);
      frames = 0;
      total = 0;
    },
    setMode(): void {
      /* the level lives in `GameSettings.perfDisplay` now — see the note above */
    },
    dispose(): void {
      /* nothing to remove; `readRenderStats` drops numbers a dead scene left behind */
    },
  };
}
