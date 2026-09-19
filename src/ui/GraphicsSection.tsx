import { useEffect, useState } from 'react';
import {
  GFX_FOV_MAX,
  GFX_FOV_MIN,
  GFX_NOT_OFFERED,
  GFX_PIXEL_BUDGET,
  GFX_PRESET_LABEL,
  GFX_RENDER_SCALE_MAX,
  GFX_RENDER_SCALE_MIN,
  getGraphics,
  resetGraphicsToAuto,
  setGraphicsPreset,
  setGraphicsSetting,
  subscribeGraphics,
  type GraphicsPreset,
  type GraphicsSettings,
} from '../games/biobuzz/graphics/settings';
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
          <OptRow
            label="Max frame rate"
            value={s.maxFps}
            cols="four"
            onPick={set('maxFps')}
            options={[
              { v: 30 as const, t: '30' },
              { v: 60 as const, t: '60' },
              { v: 120 as const, t: '120' },
              { v: 0 as const, t: 'Display' },
            ]}
          />
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
