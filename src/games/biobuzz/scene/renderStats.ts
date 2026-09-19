import type { PerfOverlay } from '../graphics/settings';

/**
 * THE PERFORMANCE OVERLAY (`docs/biobuzz/plan-3d.md` §4.4, last row) — fps, p95 frame time and
 * draw calls, in the corner of the 3D view.
 *
 * ── WHY IT IS DOM AND NOT DRAWN INTO THE SCENE ─────────────────────────────────────────────
 * Text in WebGL means a font atlas or a `CanvasTexture` re-uploaded every time a digit changes,
 * and this one changes twice a second. A `<div>` costs one `textContent` write at 2 Hz, themes
 * itself out of the same tokens as the rest of the HUD, and is selectable — which matters, since
 * the whole point of the read-out is that somebody reports the numbers on it.
 *
 * It goes in the scene's HOST, not in the React HUD, because the HUD is another lane's file and
 * because this must appear and disappear with the scene: an fps counter left behind after a
 * switch to the 2D view would be counting a renderer that no longer exists.
 *
 * ── IT IS NOT A HUD BAND ───────────────────────────────────────────────────────────────────
 * It deliberately does NOT carry `data-hud-band`, so `GameController.refreshHudInsets` never
 * reserves an edge for it and the camera does not reframe the field when it is switched on. A
 * diagnostic that changed the shot would make every before/after comparison useless.
 */

/** how often the text is rewritten. 2 Hz: fast enough to watch a number move, slow enough that
 * the read-out is readable rather than a blur, and it matches the HUD's own 10 Hz order of
 * magnitude rather than fighting it. */
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

export function createStats(host: HTMLElement, mode: PerfOverlay): BbStats {
  const el = document.createElement('div');
  el.className = 'bb-gfxstat';
  el.setAttribute('aria-hidden', 'true');
  el.hidden = mode === 'off';
  host.appendChild(el);

  let current = mode;
  let last = 0;
  /** frames since the last rewrite, and their total time — an average over the refresh window
   * rather than the reciprocal of one frame, which flickers by ±15 fps on a healthy machine. */
  let frames = 0;
  let total = 0;

  return {
    frame(ms: number, p95: number, calls: number, tris: number): void {
      if (current === 'off') return;
      frames++;
      total += ms;
      const now = performance.now();
      if (now - last < REFRESH_MS) return;
      last = now;
      const fps = total > 0 ? Math.round((frames * 1000) / total) : 0;
      frames = 0;
      total = 0;
      el.textContent =
        current === 'fps' ? `${fps} fps` : `${fps} fps · ${p95.toFixed(1)} ms p95 · ${calls} draws · ${tris.toLocaleString()} tris`;
    },
    setMode(next: PerfOverlay): void {
      current = next;
      el.hidden = next === 'off';
      if (next === 'off') el.textContent = '';
      // force the next frame to rewrite rather than wait out the window it was switched on in
      last = 0;
      frames = 0;
      total = 0;
    },
    dispose(): void {
      el.remove();
    },
  };
}
