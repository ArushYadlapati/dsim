import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import {
  coerceMaxFps,
  fpsFromSliderPos,
  GFX_FOV_MAX,
  GFX_FOV_MIN,
  GFX_FPS_MAX,
  GFX_FPS_MIN,
  GFX_FPS_SLIDER_NO_CAP,
  GFX_FPS_STEPS,
  GFX_NOT_OFFERED,
  GFX_PIXEL_BUDGET,
  GFX_PRESET_LABEL,
  GFX_RENDER_SCALE_MAX,
  GFX_RENDER_SCALE_MIN,
  getGraphics,
  MAX_FPS_UNLIMITED,
  MAX_FPS_VSYNC,
  resetGraphicsToAuto,
  setGraphicsPreset,
  setGraphicsSetting,
  sliderPosFromFps,
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
  getDriverHeightIn,
  getFreeCamNav,
  getViewPref,
  setCameraPref,
  setDriverHeightIn,
  setFreeCamNav,
  setViewPref,
  subscribeCameraPref,
  subscribeDriverHeightIn,
  subscribeFreeCamNav,
  subscribeViewPref,
  type CameraPref,
} from '../games/biobuzz/graphics/store';
import {
  cmFromIn,
  coerceDriverHeightIn,
  DRIVER_HEIGHT_MAX_IN,
  DRIVER_HEIGHT_MIN_IN,
  ftInFromIn,
  inFromCm,
  inFromFtIn,
} from '../games/biobuzz/graphics/driverEye';
import {
  FREE_CAM_PRESET_HINT,
  FREE_CAM_PRESET_LABEL,
  FREE_CAM_PRESETS,
  type FreeCamPreset,
} from '../games/biobuzz/graphics/freeCam';
import { installViewKey } from '../games/biobuzz/graphics/viewKey';
import { rangeFill } from './rangeFill';
import { useCoarsePointer } from './useCoarsePointer';

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
 * whose effect is not entirely inside this process. A slider plus a typed rate, the way most
 * PC games present a frame-rate cap, rather than a row of tiles — it gets its own component for
 * three reasons `OptRow` cannot carry:
 *
 *  1. **THE TOP OF THE SLIDER IS NOT A NUMBER.** Dragging to `GFX_FPS_SLIDER_NO_CAP` asks for
 *     the absence of a cap, not a bigger one — `fpsFromSliderPos` is what turns that position
 *     into a sentinel, and it is the one place the platform rule is enforced: the web can only
 *     ever land on VSync there, never Unlimited (owner ruling 2026-09-19 — hide what does not
 *     apply, rather than show a control that does nothing in a browser tab).
 *  2. **A RATE YOU TYPE.** The slider covers the common panels up to `GFX_FPS_SLIDER_MAX`; the
 *     box beside it reaches `GFX_FPS_MAX` for the rest. It commits on blur or Enter rather than
 *     per keystroke, because clamping mid-type turns `144` into `24` the moment you have
 *     deleted two digits, and it CANNOT reach either sentinel: a minus sign is a slip, not a
 *     choice — the uncapped state is reached by the slider (or the desktop's own VSync/
 *     Unlimited pair below), never by typing.
 *  3. **UNLIMITED IS A SETTING IN TWO PLACES, DESKTOP ONLY.** The value lives here; the
 *     Chromium switches live in the desktop shell's own store and are read before the app is
 *     ready. So this row reconciles the two, and says plainly which of the two situations the
 *     desktop player is in — needing a restart, or already running with the limit off. Nothing
 *     about Unlimited is shown on the web at all, including this reconciliation.
 */
function MaxFpsRow({ value, onPick }: { value: MaxFps; onPick: (v: MaxFps) => void }) {
  const bridge = desktop();
  const isDesktop = !!bridge;
  /** what the shell reports. `null` until it answers, and on the web for ever. */
  const [perf, setPerf] = useState<DesktopPerfState | null>(null);
  /** a desktop shell older than this feature — the app loads the live site, so a new client
   *  in last month's shell is ordinary. `bridge.perf` is optional for exactly this. */
  const [shellTooOld, setShellTooOld] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const ticksId = useId();

  // `uncapped` folds BOTH sentinels together for every purpose except the desktop's own
  // VSync/Unlimited pair below: a stored `-1` reaching the web (this device's own pick from
  // before this row was a slider, or a rare account synced from `GameSettings` — it is not,
  // but a corrupt blob is still a blob) reads and behaves exactly like `0` here. Nothing on
  // this path REWRITES that stored value; it only ever changes if the player moves the slider
  // or (on desktop) picks a mode explicitly, same as any other setting.
  const unlimited = value === MAX_FPS_UNLIMITED;
  const uncapped = unlimited || value === MAX_FPS_VSYNC;
  const [draft, setDraft] = useState(uncapped ? '' : String(value));

  useEffect(() => {
    setDraft(uncapped ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  /**
   * RECONCILE, then report. Runs on mount and after every change to the value, and the
   * renderer's value always wins: it is the thing the player last clicked, while the shell's
   * copy can be left over from an install whose `localStorage` has since been cleared. The
   * store's own `commit` writes the same thing for the writers that never open this screen —
   * both are idempotent, so the double write costs one no-op IPC. Web has no bridge at all, so
   * this never runs there.
   */
  useEffect(() => {
    if (!bridge) return;
    const p = bridge.perf;
    if (!p) {
      setShellTooOld(true);
      return;
    }
    let alive = true;
    const want = unlimited;
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
  }, [bridge, unlimited]);

  const commitDraft = () => {
    const n = Number.parseInt(draft, 10);
    // Not `coerceMaxFps` alone: that accepts both sentinels, because they are legal values of
    // the field. Typing your way into one is an accident, so anything that is not a positive
    // integer snaps the box back to what is actually set.
    if (!Number.isInteger(n) || n < 1) {
      setDraft(uncapped ? '' : String(value));
      return;
    }
    const next = coerceMaxFps(n, value);
    setDraft(String(next));
    setDismissed(false);
    onPick(next);
  };

  const needsRestart = !!perf && perf.unlimitedFps !== perf.active;

  // the one word this row ever shows for "no cap" — "Display rate" everywhere the web can see
  // it (the honest name for rAF paced by the compositor), "VSync"/"Unlimited" only once the
  // desktop shell can tell them apart.
  const capWord = !isDesktop ? 'Display rate' : unlimited ? 'Unlimited' : 'VSync';
  const ariaValueText = uncapped ? capWord : `${value} fps`;
  const sliderPos = sliderPosFromFps(value);

  return (
    <div className="ds-field">
      <label className="ds-field">
        <span className="cap">
          Max frame rate <span className="val">{ariaValueText}</span>
        </span>
        <input
          className="ds-range"
          type="range"
          min={GFX_FPS_MIN}
          max={GFX_FPS_SLIDER_NO_CAP}
          step={1}
          list={ticksId}
          value={sliderPos}
          style={rangeFill(sliderPos, GFX_FPS_MIN, GFX_FPS_SLIDER_NO_CAP)}
          aria-label="Max frame rate"
          aria-valuetext={ariaValueText}
          onChange={(e) => {
            setDismissed(false);
            onPick(fpsFromSliderPos(Number(e.target.value), isDesktop, unlimited));
          }}
        />
        {/* native tick marks at the recognizable rates — a shortcut a drag can feel for,
            never the domain (typing still reaches anything in range). */}
        <datalist id={ticksId}>
          {GFX_FPS_STEPS.map((f) => (
            <option key={f} value={f} label={String(f)} />
          ))}
          <option value={GFX_FPS_SLIDER_NO_CAP} label={capWord} />
        </datalist>
      </label>

      <label className="ds-field">
        <span className="cap">
          Type a rate{' '}
          <span className="val">
            {GFX_FPS_MIN}–{GFX_FPS_MAX} fps
          </span>
        </span>
        <input
          className="ds-input"
          type="number"
          min={GFX_FPS_MIN}
          max={GFX_FPS_MAX}
          step={1}
          inputMode="numeric"
          placeholder={capWord}
          aria-label="Max frame rate, typed"
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

      {/* THE DESKTOP'S OWN CHOICE OF WHAT "NO CAP" MEANS. Only once the slider is already at
          the top — it is what that stop is choosing between, not a second way to reach it —
          and only on the desktop, where the two behave differently. The web never renders
          either word. */}
      {isDesktop && uncapped && (
        <OptRow
          label="At the top of the range"
          value={unlimited}
          cols="two"
          onPick={(v: boolean) => {
            setDismissed(false);
            onPick(v ? MAX_FPS_UNLIMITED : MAX_FPS_VSYNC);
          }}
          options={[
            { v: false, t: 'VSync', d: 'Paced by your display' },
            { v: true, t: 'Unlimited', d: 'Needs a restart' },
          ]}
        />
      )}

      {/* THE TRUTHS ABOUT UNLIMITED, one per situation, desktop only. */}
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

/**
 * "YOUR HEIGHT" (owner, 2026-09-21) — beside the Camera row, because it only ever changes the
 * `driver` camera: set it and the eye stands at your own real eye level, at the wall your own
 * alliance and role stand behind (`graphics/driverEye.ts`). Per device, same as Camera — see
 * that file's own header for why.
 *
 * Two units, one stored value: the field always holds INCHES (`coerceDriverHeightIn`'s own
 * domain), and `ft/in` vs `cm` is a display toggle with no memory of its own — reopening this
 * screen always starts on `ft/in`, which is harmless because switching costs one tap and the
 * unit never changes what is actually stored.
 */
function DriverHeightRow({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const [unit, setUnit] = useState<'ftin' | 'cm'>('ftin');

  const parts = value != null ? ftInFromIn(value) : null;
  const [draftFeet, setDraftFeet] = useState(parts ? String(parts.feet) : '');
  const [draftInches, setDraftInches] = useState(parts ? String(parts.inches) : '');
  const [draftCm, setDraftCm] = useState(value != null ? String(Math.round(cmFromIn(value))) : '');

  useEffect(() => {
    const p = value != null ? ftInFromIn(value) : null;
    setDraftFeet(p ? String(p.feet) : '');
    setDraftInches(p ? String(p.inches) : '');
    setDraftCm(value != null ? String(Math.round(cmFromIn(value))) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // BOTH BOXES BLANK IS "CLEAR", not "zero" — a height of 0 is not in the clamp's own range
  // (`DRIVER_HEIGHT_MIN_IN`), so there is no legal value this could be confused with.
  const commitFtIn = (): void => {
    const f = Number.parseInt(draftFeet, 10);
    const i = Number.parseInt(draftInches, 10);
    if (!Number.isFinite(f) && !Number.isFinite(i)) {
      onChange(null);
      return;
    }
    onChange(coerceDriverHeightIn(inFromFtIn(Number.isFinite(f) ? f : 0, Number.isFinite(i) ? i : 0), value));
  };
  const commitCm = (): void => {
    const c = Number.parseFloat(draftCm);
    if (!Number.isFinite(c)) {
      onChange(null);
      return;
    }
    onChange(coerceDriverHeightIn(inFromCm(c), value));
  };
  const onEnter = (commit: () => void) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
  };

  return (
    <div className="ds-field">
      <span className="cap">
        Your height <span className="val">{value != null ? `${value.toFixed(1)} in eye level` : 'Not set'}</span>
      </span>
      <div className="ds-opts two">
        <button className={`ds-opt ${unit === 'ftin' ? 'on' : ''}`} aria-pressed={unit === 'ftin'} onClick={() => setUnit('ftin')}>
          <span className="ot">ft / in</span>
        </button>
        <button className={`ds-opt ${unit === 'cm' ? 'on' : ''}`} aria-pressed={unit === 'cm'} onClick={() => setUnit('cm')}>
          <span className="ot">cm</span>
        </button>
      </div>
      {unit === 'ftin' ? (
        <div className="ds-field-row">
          <input
            className="ds-input"
            type="number"
            inputMode="numeric"
            min={Math.floor(DRIVER_HEIGHT_MIN_IN / 12)}
            max={Math.floor(DRIVER_HEIGHT_MAX_IN / 12)}
            placeholder="ft"
            aria-label="Height, feet"
            value={draftFeet}
            onChange={(e) => setDraftFeet(e.target.value)}
            onBlur={commitFtIn}
            onKeyDown={onEnter(commitFtIn)}
          />
          <input
            className="ds-input"
            type="number"
            inputMode="numeric"
            min={0}
            max={11}
            placeholder="in"
            aria-label="Height, inches"
            value={draftInches}
            onChange={(e) => setDraftInches(e.target.value)}
            onBlur={commitFtIn}
            onKeyDown={onEnter(commitFtIn)}
          />
        </div>
      ) : (
        <input
          className="ds-input"
          type="number"
          inputMode="numeric"
          min={Math.round(cmFromIn(DRIVER_HEIGHT_MIN_IN))}
          max={Math.round(cmFromIn(DRIVER_HEIGHT_MAX_IN))}
          placeholder="cm"
          aria-label="Height, centimetres"
          value={draftCm}
          onChange={(e) => setDraftCm(e.target.value)}
          onBlur={commitCm}
          onKeyDown={onEnter(commitCm)}
        />
      )}
      {value != null && (
        <button className="ds-btn small ghost" onClick={() => onChange(null)}>
          Clear
        </button>
      )}
      <p className="ds-hint">Sets the driver camera to your real eye level, standing where your drive team stands.</p>
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

  const [driverHeight, setDriverHeight] = useState<number | null>(() => getDriverHeightIn());
  useEffect(() => subscribeDriverHeightIn(setDriverHeight), []);

  const [freeNav, setFreeNav] = useState(() => getFreeCamNav());
  useEffect(() => subscribeFreeCamNav(setFreeNav), []);
  /** FREE CAM (owner, 2026-09-21) is MOUSE-ONLY — two-finger orbit/pinch dolly would collide
   * with the on-screen drive sticks (`MobileControls`) reliably enough that it is left out
   * rather than shipped half-working, so the picker hides the option on a touch surface rather
   * than offering a camera that cannot be aimed there. */
  const touch = useCoarsePointer();
  const cameraOptions = touch ? CAMERA_PREFS.filter((c) => c !== 'free') : CAMERA_PREFS;

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
            options={cameraOptions.map((c) => ({
              v: c,
              t: c === 'auto' ? 'Auto' : c[0].toUpperCase() + c.slice(1),
            }))}
          />
          {/* the free camera's mouse layout — only while it is the pick, and never on touch (the
              option itself is hidden there). Named after the CAD packages whose layout each one
              copies, because that is how a player already knows which one their hands want. */}
          {camera === 'free' && !touch && (
            <>
              <OptRow
                label="Free camera mouse"
                value={freeNav.preset}
                cols="three"
                onPick={(preset: FreeCamPreset) => setFreeCamNav({ ...freeNav, preset })}
                options={FREE_CAM_PRESETS.map((v) => ({ v, t: FREE_CAM_PRESET_LABEL[v] }))}
              />
              <p className="ds-hint">{FREE_CAM_PRESET_HINT[freeNav.preset]} · double-click to reset</p>
              <OptRow
                label="Scroll zoom"
                value={freeNav.invertZoom}
                cols="two"
                onPick={(invertZoom: boolean) => setFreeCamNav({ ...freeNav, invertZoom })}
                options={[
                  { v: false, t: 'Forward zooms in' },
                  { v: true, t: 'Forward zooms out' },
                ]}
              />
            </>
          )}
          <DriverHeightRow value={driverHeight} onChange={setDriverHeightIn} />
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
