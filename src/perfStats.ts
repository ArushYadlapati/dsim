/**
 * THE 3D RENDERER'S OWN COUNTERS, on their way to the performance read-out.
 *
 * ── WHY A MODULE-LEVEL BOX AND NOT A RETURN VALUE ──────────────────────────────────────────
 * Draw calls and triangles can only be read inside `WebGLRenderer.render`'s own frame (see
 * `scene/renderStats.ts` for why a read taken one call later reports the blit's two triangles),
 * and the scene that reads them lives in a LAZY CHUNK that the main bundle must not import.
 * `GameController` is in the main bundle and cannot reach into the chunk; the chunk can reach
 * out to this file, which is why the arrow points this way. Nothing here imports anything, so
 * the file is a handful of bytes in both graphs.
 *
 * ── STALENESS IS THE WHOLE CONTRACT ────────────────────────────────────────────────────────
 * A scene appears and disappears (the view key, a chunk that failed to load, a fall back to
 * 2D), and a read-out that kept printing the last numbers a dead renderer produced would be
 * worse than one that prints none — it is a plausible number for a renderer that is not
 * running. So every publish is STAMPED, and `readRenderStats` refuses anything older than one
 * slow frame's worth of grace.
 */

export interface RenderStats {
  /** what the scene's own render call cost last frame, ms */
  ms: number;
  /** p95 of that cost over the quality governor's window, ms */
  p95: number;
  /** `renderer.info.render.calls` for the SCENE pass (not the blit or the minimap) */
  calls: number;
  /** `renderer.info.render.triangles` for the same pass */
  tris: number;
  /** `performance.now()` at publish — see the header on why this is not optional */
  at: number;
}

/** the last frame a live scene published. Overwritten in place: one object, no allocation
 * per frame, and no listener list — the read-out polls at 4 Hz and nothing else reads it. */
const latest: RenderStats = { ms: 0, p95: 0, calls: 0, tris: 0, at: 0 };

/** how stale a publish may be and still count as live. 500 ms is two frames at 4 fps: a
 * machine that slow is exactly the one somebody has the read-out open for, so the window has
 * to survive it, while a scene that was torn down half a second ago is gone from the display
 * within one poll. */
const MAX_AGE_MS = 500;

export function publishRenderStats(ms: number, p95: number, calls: number, tris: number): void {
  latest.ms = ms;
  latest.p95 = p95;
  latest.calls = calls;
  latest.tris = tris;
  latest.at = performance.now();
}

/** the live scene's counters, or null when no scene has published recently. The returned
 * object is a COPY: the caller holds it across a React render and this one keeps being
 * overwritten 60 times a second. */
export function readRenderStats(): RenderStats | null {
  if (latest.at === 0 || performance.now() - latest.at > MAX_AGE_MS) return null;
  return { ...latest };
}
