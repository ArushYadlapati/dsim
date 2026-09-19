import { useEffect, useRef, useState } from 'react';
import {
  coerceMaxFps,
  GFX_FOV_MAX,
  GFX_FOV_MIN,
  GFX_FPS_MAX,
  GFX_FPS_MIN,
  GFX_FPS_STEPS,
  GFX_NOT_OFFERED,
  GFX_PIXEL_BUDGET,
  GFX_PRESET_LABEL,
  GFX_RENDER_SCALE_MAX,
  GFX_RENDER_SCALE_MIN,
  getGraphics,
  isCustomFps,
  MAX_FPS_UNLIMITED,
  MAX_FPS_VSYNC,
  resetGraphicsToAuto,
  setGraphicsPreset,
  setGraphicsSetting,
  subscribeGraphics,
  type GraphicsPreset,
  type GraphicsSettings,
  type MaxFps,
} from '../games/biobuzz/graphics/settings';
import { desktop, type DesktopPerfState } from '../desktop';
import { BB_ENVIRONMENTS } from '../games/biobuzz/graphics/environments';
import {
  CAMERA_PREFS,
  getCameraPref,
  getViewPref,
  setCameraPref,
  setViewPref,
  subscribeCameraPref,
  subscribeViewPref,
  type CameraPref,
} from '../games/biobuzz/graphics/store';
import { installViewKey } from '../games/biobuzz/graphics/viewKey';
import { rangeFill } from './rangeFill';

/**
 * GRAPHICS — the sixteen settings of `docs/biobuzz/plan-3d.md` §4.4, the preset that sets them
 * all at once, and the environment picker of §4.5.
 *
 * ── WHY IT IS ITS OWN SECTION AND NOT A BLOCK INSIDE "AUDIO AND VISUAL" ────────────────────
 * §4.4 asks for it "beside Audio and Visual" and the reason it is beside rather than inside is
 * the one this file's settings share and the others do not: NONE of it is `GameSettings`.
 * Audio volumes and the assists sync to Postgres per account; every control here writes
 * `localStorage['decodesim.graphics']` (or `decodesim.view`/`decodesim.camera`) and stays on
 * this machine, because a shadow resolution is a fact about the GPU in front of you. Mixing the
 * two in one panel would make "does this follow me to the other computer?" unanswerable by
 * looking at the screen.
 *
 * ── EVERY CONTROL IS A TOGGLE BUTTON, NOT AN ARIA RADIOGROUP ───────────────────────────────
 * The same ruling `AudioSection`'s theme picker records: a radiogroup owes roving tabindex and
 * arrow keys, and a partial implementation of that pattern is worse than none.
 *
 * ── NO HELPER TEXT THAT RESTATES A LABEL (`docs/ui-standard.md` §8) ────────────────────────
 * A sub-line appears only where the row names a real trade-off the player is choosing between
 * — what a setting COSTS, or what it cannot do live. "Shadows" gets none; "Mesh detail" gets
 * one, because it is the only row here that does not take effect until the next 3D view and a
 * player who changed it and saw nothing would be looking at a bug.
 */

/** one row of mutually exclusive choices, rendered as the option grid the rest of Configure
 * uses. `cols` matches `.ds-opts`'s own modifiers — there is no five-wide row here, so the two
 * the grid offers are enough. */
function OptRow<T extends string | number | boolean>({
  label,
  value,
  options,
  onPick,
  cols,
  hint,
}: {
  label: string;
  value: T;
  options: readonly { v: T; t: string; d?: string }[];
  onPick: (v: T) => void;
  cols?: 'two' | 'three' | 'four';
  hint?: string;
}) {
  return (
    <div className="ds-field">
      <span className="cap">
        {label}
        {hint && <span className="val">{hint}</span>}
      </span>
      <div className={`ds-opts${cols ? ` ${cols}` : ''}`}>
        {options.map((o) => (
          <button
            key={String(o.v)}
            className={`ds-opt ${value === o.v ? 'on' : ''}`}
            aria-pressed={value === o.v}
            onClick={() => onPick(o.v)}
          >
            <span className="ot">{o.t}</span>
            {o.d && <span className="od">{o.d}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * MAX FRAME RATE — the one row in this screen that is not a fixed set of choices, and the one
 * whose effect is not entirely inside this process. It gets its own component for three
 * reasons `OptRow` cannot carry:
 *
 *  1. **TWO OF THE EIGHT TILES ARE NOT NUMBERS.** VSync and Unlimited are the ABSENCE of a
 *     cap, not a bigger one, so they carry a sub-line saying what they are while the rates
 *     stay bare. That is also what keeps them from reading as the top of the ladder.
 *  2. **A RATE YOU TYPE.** The tiles are the common panels; the field covers 165 Hz and every
 *     other one. It commits on blur or Enter rather than per keystroke, because clamping mid-
 *     type turns `144` into `24` the moment you have deleted two digits, and it CANNOT reach
 *     either sentinel: a minus sign is a slip, not a choice.
 *  3. **UNLIMITED IS A SETTING IN TWO PLACES.** The value lives here; the Chromium switches
 *     live in the desktop shell's own store and are read before the app is ready. So this row
 *     reconciles the two, and says plainly which of the three situations the player is in —
 *     web build (it behaves as VSync), desktop needing a restart, or desktop already running
 *     with the limit off.
 *
 * ⚠️ **EIGHT TILES, SO THE GRID IS `.eight`** — a modifier that exists for this row, with the
 * measurement in `shell.css` beside it. The short version: `.three` ends in a 2-tile orphan at
 * panel width, and `.four`'s auto-fit track collapses to ONE column in a 298px panel at 375,
 * which is eight stacked tiles for one setting. `.eight` is a fixed 4, and a fixed 2 under
 * 560px.
 */
function MaxFpsRow({ value, onPick }: { value: MaxFps; onPick: (v: MaxFps) => void }) {
  const bridge = desktop();
  /** what the shell reports. `null` until it answers, and on the web for ever. */
  const [perf, setPerf] = useState<DesktopPerfState | null>(null);
  /** a desktop shell older than this feature — the app loads the live site, so a new client
   *  in last month's shell is ordinary. `bridge.perf` is optional for exactly this. */
  const [shellTooOld, setShellTooOld] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const custom = isCustomFps(value);
  const [showCustom, setShowCustom] = useState(custom);
  const [draft, setDraft] = useState(custom ? String(value) : '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (custom) setDraft(String(value));
  }, [custom, value]);
  useEffect(() => {
    if (showCustom) inputRef.current?.focus();
  }, [showCustom]);

  /**
   * RECONCILE, then report. Runs on mount and after every change to the value, and the
   * renderer's value always wins: it is the thing the player last clicked, while the shell's
   * copy can be left over from an install whose `localStorage` has since been cleared. The
   * store's own `commit` writes the same thing for the writers that never open this screen —
   * both are idempotent, so the double write costs one no-op IPC.
   */
  useEffect(() => {
    if (!bridge) return;
    const p = bridge.perf;
    if (!p) {
      setShellTooOld(true);
      return;
    }
    let alive = true;
    const want = value === MAX_FPS_UNLIMITED;
    void p
      .get()
      .then((st) => (st.unlimitedFps === want ? st : p.setUnlimitedFps(want)))
      .then((st) => {
        if (alive) setPerf(st);
      })
      .catch(() => {
        /* the row simply says nothing about restarting rather than guessing */
      });
    return () => {
      alive = false;
    };
  }, [bridge, value]);

  const pickTile = (v: MaxFps) => {
    setShowCustom(false);
    setDismissed(false);
    onPick(v);
  };

  const commitDraft = () => {
    const n = Number.parseInt(draft, 10);
    // Not `coerceMaxFps` alone: that accepts both sentinels, because they are legal values of
    // the field. Typing your way into one is an accident, so anything that is not a positive
    // integer snaps the box back to what is actually set.
    if (!Number.isInteger(n) || n < 1) {
      setDraft(isCustomFps(value) ? String(value) : '');
      return;
    }
    const next = coerceMaxFps(n, value);
    setDraft(String(next));
    setDismissed(false);
    onPick(next);
  };

  const unlimited = value === MAX_FPS_UNLIMITED;
  const needsRestart = !!perf && perf.unlimitedFps !== perf.active;

  return (
    <div className="ds-field">
      <span className="cap">Max frame rate</span>
      <div className="ds-opts eight">
        {GFX_FPS_STEPS.map((f) => (
          <button
            key={f}
            className={`ds-opt ${value === f ? 'on' : ''}`}
            aria-pressed={value === f}
            onClick={() => pickTile(f)}
          >
            <span className="ot">{f}</span>
          </button>
        ))}
        <button
          className={`ds-opt ${custom ? 'on' : ''}`}
          aria-pressed={custom}
          onClick={() => {
            setShowCustom(true);
            inputRef.current?.focus();
          }}
        >
          <span className="ot">Custom</span>
          <span className="od">{custom ? `${value} fps` : 'Type a rate'}</span>
        </button>
        <button
          className={`ds-opt ${value === MAX_FPS_VSYNC ? 'on' : ''}`}
          aria-pressed={value === MAX_FPS_VSYNC}
          onClick={() => pickTile(MAX_FPS_VSYNC)}
        >
          <span className="ot">VSync</span>
          <span className="od">Paced by your display</span>
        </button>
        <button
          className={`ds-opt ${unlimited ? 'on' : ''}`}
          aria-pressed={unlimited}
          onClick={() => pickTile(MAX_FPS_UNLIMITED)}
        >
          <span className="ot">Unlimited</span>
          <span className="od">Desktop app only</span>
        </button>
      </div>

      {(showCustom || custom) && (
        <label className="ds-field">
          <span className="cap">
            Custom rate{' '}
            <span className="val">
              {GFX_FPS_MIN}–{GFX_FPS_MAX} fps
            </span>
          </span>
          <input
            ref={inputRef}
            className="ds-input"
            type="number"
            min={GFX_FPS_MIN}
            max={GFX_FPS_MAX}
            step={1}
            inputMode="numeric"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitDraft();
              }
            }}
          />
        </label>
      )}

      {/* THE THREE TRUTHS ABOUT UNLIMITED, one per situation. Only ever shown when Unlimited
          is the selected value — the tile already says "Desktop app only" on its face, and a
          paragraph about a shell restart under a row set to 60 is noise. */}
      {unlimited && !bridge && (
        <p className="ds-hint">
          Unlimited needs the desktop app. A browser tab is drawn by the compositor at your
          display’s refresh, so here it behaves exactly as VSync.
        </p>
      )}
      {unlimited && shellTooOld && (
        <p className="ds-hint warn">
          This copy of the desktop app is older than the setting. Update it from the download
          page to draw past your display’s refresh.
        </p>
      )}
      {unlimited && !!perf && !needsRestart && perf.active && (
        <p className="ds-hint ok">The frame-rate limit is off in this session.</p>
      )}
      {needsRestart && !dismissed && (
        <>
          <p className="ds-hint warn">
            {perf?.unlimitedFps
              ? 'DSIM is still running with your display’s frame-rate limit on. The switch is set for the next launch.'
              : 'DSIM is still running with the frame-rate limit off. Restarting puts it back.'}
          </p>
          <div className="ds-field-row">
            <button className="ds-btn small" onClick={() => void bridge?.perf?.relaunch()}>
              Restart DSIM
            </button>
            <button className="ds-btn small ghost" onClick={() => setDismissed(true)}>
              Not now
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const PRESETS: readonly GraphicsPreset[] = ['auto', 'low', 'medium', 'high', 'ultra'];

/** megapixels, one decimal — the number the render-scale row is capped by, printed so the cap
 * is visible rather than mysterious when the slider stops making a difference. */
const mp = (n: number): string => `${(n / 1e6).toFixed(1)} MP`;

export function GraphicsSection() {
  const [gfx, setGfx] = useState(() => getGraphics());
  useEffect(() => subscribeGraphics(setGfx), []);

  const [view, setView] = useState(() => getViewPref());
  useEffect(() => subscribeViewPref(setView), []);
  /** `t` is live on this screen too, so the key the View row advertises can be tried where its
   * effect is visible. `installViewKey` is reference-counted, so this and a mounted scene (and
   * the touch controls) can all hold it at once without the press counting twice. */
  useEffect(() => installViewKey(), []);

  const [camera, setCamera] = useState<CameraPref>(() => getCameraPref());
  useEffect(() => subscribeCameraPref(setCamera), []);

  const s = gfx.settings;
  const set = <K extends keyof GraphicsSettings>(k: K) => (v: GraphicsSettings[K]) => setGraphicsSetting(k, v);

  /** Reset to Auto (§4.4) — clear the stored opinion, then re-probe. The detector is imported
   * DYNAMICALLY: it is only ever needed by this one button and by the scene (which has its own
   * copy in the renderer chunk), and a static import here would put GPU detection in the main
   * bundle every player of every game downloads. */
  const resetToAuto = (): void => {
    resetGraphicsToAuto();
    void import('../games/biobuzz/graphics/auto').then((m) => m.applyFirstGuess(m.probeGpu(), ''));
  };

  return (
    <>
      <section className="ds-panel">
        <div className="ds-panel-h">
          <span className="ds-panel-title">View</span>
        </div>
        <div className="ds-panel-body stack">
          <OptRow
            label="Field view"
            value={view}
            cols="two"
            onPick={setViewPref}
            options={[
              { v: '2d' as const, t: '2D', d: 'Top-down. No GPU needed' },
              { v: '3d' as const, t: '3D', d: 'BIOBUZZ only. Press T in a match to switch' },
            ]}
          />
          <OptRow
            label="Camera"
            value={camera}
            cols="three"
            onPick={setCameraPref}
            options={CAMERA_PREFS.map((c) => ({
              v: c,
              t: c === 'auto' ? 'Auto' : c[0].toUpperCase() + c.slice(1),
            }))}
          />
        </div>
      </section>

      <section className="ds-panel">
        <div className="ds-panel-h">
          <span className="ds-panel-title">Quality</span>
          <button className="ds-btn small" onClick={resetToAuto}>
            Reset to Auto
          </button>
        </div>
        <div className="ds-panel-body stack">
          <OptRow
            label="Preset"
            value={gfx.preset}
            cols="three"
            hint={gfx.preset === 'custom' ? `based on ${GFX_PRESET_LABEL[gfx.tier]}` : undefined}
            onPick={(p: GraphicsPreset) => setGraphicsPreset(p)}
            options={[
              ...PRESETS.map((p) => ({ v: p, t: GFX_PRESET_LABEL[p] })),
              // CUSTOM IS SHOWN BUT NOT PICKABLE-TO: it is what the picker says after you change
              // any single setting below, never a thing you choose. Rendered as a disabled-
              // looking `.static` tile so the row still reads as a complete set of states.
              ...(gfx.preset === 'custom' ? [{ v: 'custom' as GraphicsPreset, t: 'Custom' }] : []),
            ]}
          />
          {/* the ONE line the preset row cannot say for itself: what Auto did, and that it
              measures rather than guesses. */}
          <p className="ds-hint">
            Auto reads the GPU, then measures two seconds of real frames and moves one step. A
            match that keeps dropping below 40 fps lowers the preset once and says so in the
            match log.
          </p>
        </div>
      </section>

      <section className="ds-panel">
        <div className="ds-panel-h">
          <span className="ds-panel-title">Resolution</span>
        </div>
        <div className="ds-panel-body stack">
          <label className="ds-field">
            <span className="cap">
              Render scale <span className="val">{s.renderScale}% · capped at {mp(GFX_PIXEL_BUDGET[gfx.tier])}</span>
            </span>
            <input
              className="ds-range"
              type="range"
              min={GFX_RENDER_SCALE_MIN}
              max={GFX_RENDER_SCALE_MAX}
              step={5}
              value={s.renderScale}
              style={rangeFill(s.renderScale, GFX_RENDER_SCALE_MIN, GFX_RENDER_SCALE_MAX)}
              aria-label="Render scale"
              aria-valuetext={`${s.renderScale} percent`}
              onChange={(e) => setGraphicsSetting('renderScale', Number(e.target.value))}
            />
          </label>
          {/* `VSync` is `0`: the draw loop is `requestAnimationFrame`, so the display's refresh
              is the ceiling and nothing in a browser can present past it. It read as a cap
              while it was called "Display". `Unlimited` is `-1` and is the only control on this
              screen whose effect lives outside the page — see `MaxFpsRow`. */}
          <MaxFpsRow value={s.maxFps} onPick={set('maxFps')} />
          <OptRow
            label="Anti-aliasing"
            value={s.aa}
            cols="three"
            onPick={set('aa')}
            options={[
              { v: 'off' as const, t: 'Off' },
              { v: 'msaa2' as const, t: 'MSAA 2×' },
              { v: 'msaa4' as const, t: 'MSAA 4×' },
            ]}
          />
        </div>
      </section>

      <section className="ds-panel">
        <div className="ds-panel-h">
          <span className="ds-panel-title">Lighting</span>
        </div>
        <div className="ds-panel-body stack">
          <OptRow
            label="Shadows"
            value={s.shadows}
            cols="four"
            onPick={set('shadows')}
            options={[
              { v: 'off' as const, t: 'Off' },
              { v: 'low' as const, t: 'Low' },
              { v: 'high' as const, t: 'High' },
              { v: 'soft' as const, t: 'Soft' },
            ]}
          />
          <OptRow
            label="Element shadows"
            value={s.elementShadows}
            cols="three"
            onPick={set('elementShadows')}
            options={[
              { v: 'none' as const, t: 'None' },
              { v: 'blob' as const, t: 'Blob', d: 'A disc under each one' },
              { v: 'real' as const, t: 'Real', d: '56 more shadow casters' },
            ]}
          />
          {/* THE ENVIRONMENT PICKER (§4.5). Each HDRI states its download size, because picking
              one is the only control in this whole screen that costs bytes. */}
          <OptRow
            label="Environment"
            value={s.environment}
            cols="three"
            onPick={set('environment')}
            options={BB_ENVIRONMENTS.map((e) => ({ v: e.id, t: e.name, d: e.note }))}
          />
          <p className="ds-hint">
            The two photographed rooms are CC0 images from Poly Haven, fetched the first time you
            pick one and then cached by the browser. Credited on the Contributors page.
          </p>
          <OptRow
            label="Environment lighting"
            value={s.envLighting}
            cols="two"
            onPick={set('envLighting')}
            options={[
              { v: false, t: 'Off' },
              { v: true, t: 'On' },
            ]}
          />
          <OptRow
            label="Reflections"
            value={s.reflections}
            cols="two"
            onPick={set('reflections')}
            options={[
              { v: false, t: 'Off' },
              { v: true, t: 'On', d: 'Metal parts pick up the room' },
            ]}
          />
        </div>
      </section>

      <section className="ds-panel">
        <div className="ds-panel-h">
          <span className="ds-panel-title">Detail</span>
        </div>
        <div className="ds-panel-body stack">
          <OptRow
            label="Texture filtering"
            value={s.anisotropy}
            cols="four"
            onPick={set('anisotropy')}
            options={[
              { v: 1 as const, t: '1×' },
              { v: 4 as const, t: '4×' },
              { v: 8 as const, t: '8×' },
              { v: 16 as const, t: '16×' },
            ]}
          />
          <OptRow
            label="Mesh detail"
            value={s.meshDetail}
            cols="two"
            onPick={set('meshDetail')}
            hint="applies next time you open the 3D view"
            options={[
              { v: 'low' as const, t: 'Low' },
              { v: 'high' as const, t: 'High' },
            ]}
          />
          <OptRow
            label="Effects"
            value={s.effects}
            cols="three"
            onPick={set('effects')}
            options={[
              { v: 'minimal' as const, t: 'Minimal' },
              { v: 'standard' as const, t: 'Standard' },
              { v: 'full' as const, t: 'Full' },
            ]}
          />
        </div>
      </section>

      <section className="ds-panel">
        <div className="ds-panel-h">
          <span className="ds-panel-title">Camera and read-outs</span>
        </div>
        <div className="ds-panel-body stack">
          <label className="ds-field">
            <span className="cap">
              Field of view <span className="val">{s.fov}°</span>
            </span>
            <input
              className="ds-range"
              type="range"
              min={GFX_FOV_MIN}
              max={GFX_FOV_MAX}
              step={1}
              value={s.fov}
              style={rangeFill(s.fov, GFX_FOV_MIN, GFX_FOV_MAX)}
              aria-label="Field of view"
              aria-valuetext={`${s.fov} degrees`}
              onChange={(e) => setGraphicsSetting('fov', Number(e.target.value))}
            />
          </label>
          <OptRow
            label="Camera motion"
            value={s.cameraMotion}
            cols="two"
            onPick={set('cameraMotion')}
            options={[
              { v: 'reduced' as const, t: 'Reduced' },
              { v: 'full' as const, t: 'Full' },
            ]}
          />
          <OptRow
            label="Minimap"
            value={s.minimap}
            cols="two"
            onPick={set('minimap')}
            options={[
              { v: false, t: 'Off' },
              { v: true, t: 'On', d: 'A second pass over the field' },
            ]}
          />
          {/* THE PERFORMANCE OVERLAY ROW IS GONE FROM HERE. It was 3D-only, and it drew its
              own corner div on top of the event log; the read-out is one display for all
              three games now, under Audio and Visual, because it is a `GameSettings` field
              and nothing in this section is. The 3D renderer's draw calls and triangles are
              on it, at the Detailed level. */}
          <p className="ds-hint">The performance read-out is under Audio and Visual.</p>
          {/* §4.4 lists two rows this build does not ship. Saying so here — with the reason —
              beats a disabled switch, which reads as a bug, and beats silence, which reads as
              an oversight to anyone holding the plan doc. */}
          <p className="ds-hint">
            Not on this build:{' '}
            {GFX_NOT_OFFERED.map((n, i) => (
              <span key={n.label}>
                {i > 0 && '; '}
                <b>{n.label}</b> — {n.why}
              </span>
            ))}
            .
          </p>
        </div>
      </section>
    </>
  );
}
