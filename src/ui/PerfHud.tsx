import { memo } from 'react';
import type { PerfSnapshot } from '../game';
import type { NetStatus } from '../net/session';
import type { PerfDisplay } from '../types';

/**
 * THE IN-MATCH PERFORMANCE READ-OUT — one display, one setting, nothing to click.
 *
 * ── WHAT IT REPLACED, AND WHY THERE IS ONLY ONE NOW ────────────────────────────────────────
 * Three separate things used to show some of this, and none of them could see the others'
 * numbers:
 *   · `.perf-readout`, a frame-time line behind `?perf=1`, pinned top-left OVER the MENU row;
 *   · `.bb-gfxstat`, a 3D-only corner overlay behind a Graphics row, pinned top-left OVER the
 *     event log (`scene/renderStats.ts` records that collision);
 *   · the connection chip, whose ping graph opened on a CLICK — a click that never landed,
 *     because `.hud` is `pointer-events: none` and nothing re-enabled them on the chip.
 * So the level is a LEVEL: what is drawn follows `GameSettings.perfDisplay` and nothing else
 * (owner, 2026-09-19: "click to open graph … should not be a thing. It should be decided based
 * on which display option we choose").
 *
 * ── IT IS NOT A HUD BAND, AND IT IS NOT CLICKABLE ──────────────────────────────────────────
 * No `data-hud-band`: a band reserves an edge of the canvas and the 3D camera reframes the
 * field around it, so a diagnostic that carried one would change the shot somebody turned it on
 * to measure. And `pointer-events: none` (inherited from `.hud`, restated on `.perf-hud` so it
 * survives a future ancestor that re-enables them), so it can never eat a drag meant for the
 * field. That is the whole of its interaction model.
 *
 * ── ONLY ROWS WHOSE DATA EXISTS ────────────────────────────────────────────────────────────
 * Every row here is a measurement something already takes: the frame/sim/draw rings in
 * `GameController`, the scene's own `info.render` counters through `src/perfStats.ts`, and the
 * connection numbers `ServerSession` keeps for the quality bucket. A null is drawn as NOTHING,
 * never as a zero — an unmeasured ping and a 0 ms ping look identical on screen, and a
 * plausible wrong number is worse than a missing one.
 */

/** how a number is printed. One decimal under 10 ms, none above: at 40 ms nobody reads the
 * tenth, and at 1.4 ms the tenth is the whole signal. */
const ms = (n: number): string => (n < 10 ? n.toFixed(1) : Math.round(n).toString());

/** 128000 → 128k. Triangle counts run to six digits and the exact figure is never the point. */
const big = (n: number): string => (n >= 10000 ? `${Math.round(n / 1000)}k` : n.toLocaleString());

/** the connection-quality bucket as a class, so the dot and the ping figure agree. Null (still
 * measuring) gets the neutral one. */
const qualityClass = (q: NetStatus['quality']): string =>
  q === 'good' ? 'ok' : q === 'fair' ? 'warn' : q === 'poor' ? 'bad' : '';

/** one label/value line. The label is a short word in the muted mono the rest of the HUD uses;
 * the value is tabular so a changing digit never re-flows the card. */
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="perf-row">
      <span className="perf-k">{k}</span>
      <span className="perf-v">{v}</span>
    </div>
  );
}

/**
 * A SPARKLINE, hand-rolled.
 *
 * No chart library: this bundle is React + Rapier 2D and nothing else (CLAUDE.md), and the
 * whole shape is one `<path>`. It scales to the card's width through the viewBox, so the card
 * can be 232px on a desktop and 150px at 375px with no second size to maintain.
 *
 * The scale is PINNED AT THE BOTTOM and floats at the top: a frame-time trace that rescaled its
 * baseline every poll would draw a healthy 16.7 ms line as a mountain range. `hi` is the
 * window's own peak against a floor, so a flat trace stays flat.
 */
function Spark({ label, data, floor, unit }: { label: string; data: readonly number[]; floor: number; unit: string }) {
  if (data.length < 2) return null;
  const W = 100;
  const H = 22;
  let hi = floor;
  for (const v of data) if (v > hi) hi = v;
  const step = W / (data.length - 1);
  let d = '';
  for (let i = 0; i < data.length; i++) {
    d += `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)} ${(H - (data[i] / hi) * H).toFixed(1)}`;
  }
  return (
    <div className="perf-spark">
      <div className="perf-row">
        <span className="perf-k">{label}</span>
        <span className="perf-v">
          {ms(hi)} {unit} peak
        </span>
      </div>
      {/* `preserveAspectRatio: none` — the card's width is what varies and the shape is a
          trend, not a diagram; `vector-effect` keeps the stroke 1px however it is squashed. */}
      <svg className="perf-spark-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={d} />
      </svg>
    </div>
  );
}

export const PerfHud = memo(function PerfHud({
  level,
  stats,
}: {
  level: PerfDisplay;
  /** null until the frame window has enough samples for a percentile to mean anything */
  stats: PerfSnapshot | null;
}) {
  if (level === 'off' || !stats) return null;
  const net = stats.net;
  // ONLINE means "there is a session AND it has answered". A room that has not measured a
  // round trip yet prints the frame rate alone rather than a dash beside it.
  const ping = net && net.rttMs !== null ? net.rttMs : null;
  const detail = level === 'detailed' || level === 'graphs';
  const scene = stats.scene;
  const pred = stats.prediction;
  return (
    /* A labelled GROUP, not `role="status"`: status is an implicit polite live region, so the
       numbers — changing four times a second — would be announced four times a second. A
       group is a read-out a screen reader can go and read, and says nothing on its own. */
    <div className="perf-hud" role="group" aria-label="Performance">
      <div className="perf-head">
        <span className="perf-fps">{Math.round(stats.fps)} fps</span>
        {ping !== null && (
          <span className={`perf-ping ${qualityClass(net!.quality)}`}>
            {/* the dot's colour IS the quality, so the word has to exist for anyone not seeing it */}
            <span className="perf-dot" aria-hidden />
            {net!.quality && <span className="ds-sr">{net!.quality} connection, </span>}
            {ping} ms
          </span>
        )}
      </div>
      {detail && (
        <div className="perf-rows">
          <Row k="FRAME" v={`${ms(stats.p50)} · ${ms(stats.p95)} · ${ms(stats.p99)} ms`} />
          <Row k="WORST" v={`${ms(stats.worst)} ms`} />
          {/* ONE FACT PER ROW, and that is a WIDTH decision, not a taste one: at 375px the
              cluster may be 167px wide, a combined `0.9 ms · 0.9 steps/frame` is ~200px of
              `nowrap`, and the overflow goes LEFTWARD onto the event log. */}
          <Row k="SIM" v={`${ms(stats.simMs)} ms`} />
          <Row k="STEPS" v={`${stats.stepsPerFrame.toFixed(1)} / frame`} />
          <Row k="DRAW" v={`${ms(stats.renderMs)} ms`} />
          {scene && <Row k="SCENE" v={`${scene.calls} draws · ${big(scene.tris)} tris`} />}
          <Row
            k="VIEW"
            v={`${stats.view3d ? '3D' : '2D'} · ${stats.physics.toUpperCase()} physics`}
          />
          <Row k="SIZE" v={`${stats.width}×${stats.height} @${stats.dpr.toFixed(stats.dpr % 1 ? 1 : 0)}×`} />
          {net && (
            <Row
              k="LINK"
              v={
                `${net.jitterMs === null ? '' : `±${net.jitterMs} ms · `}` +
                `${net.snapHz === null ? '—' : `${net.snapHz} Hz`}`
              }
            />
          )}
          {stats.interpMs !== null && (
            <Row
              k="DELAY"
              v={`${Math.round(stats.interpMs)} ms${stats.behindTicks === null ? '' : ` · ${stats.behindTicks} behind`}`}
            />
          )}
          {stats.reconciles !== null && (
            <Row
              k="SYNC"
              v={`${stats.reconciles} fixes${stats.correctionIn === null ? '' : ` · ${stats.correctionIn.toFixed(2)} in`}`}
            />
          )}
          {/* the prediction READ-OUT, not the control — the picker is its own panel below this
              one, because a control cannot live on a `pointer-events: none` card. */}
          {pred && (
            <Row
              k="PREDICT"
              v={`${pred.mode}${pred.reconcileP95 === null ? '' : ` · ${ms(pred.reconcileP95)} ms p95`}`}
            />
          )}
          {net?.server && <Row k="SERVER" v={net.server} />}
        </div>
      )}
      {level === 'graphs' && (
        <div className="perf-sparks">
          {/* the floor is a 60 Hz frame: a trace that never leaves the bottom of the box IS the
              good outcome, and that only reads as good if the box does not rescale to it. */}
          <Spark label="FRAME" data={stats.frameSeries} floor={16.7} unit="ms" />
          {net?.rttHistory && <Spark label="PING" data={net.rttHistory} floor={40} unit="ms" />}
        </div>
      )}
    </div>
  );
});
