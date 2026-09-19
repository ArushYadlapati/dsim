/**
 * GRAPHICS SETTINGS — the sixteen dials of `docs/biobuzz/plan-3d.md` §4.4, their four preset
 * columns, and the per-device store that holds them.
 *
 * ── WHY PER DEVICE, AND NOT IN `GameSettings` ──────────────────────────────────────────────
 * The same reason `getViewPref` and `src/theme.ts` are: `GameSettings` syncs to Postgres per
 * ACCOUNT, and a shadow resolution is a fact about the GPU in front of you, not about who you
 * are. A student who practises on a school Chromebook and at home on a desktop must not have
 * the Chromebook's preset follow them home. So: `localStorage['decodesim.graphics']`, the same
 * `decodesim.` prefix, client-only, no React import in this file.
 *
 * ── THE SHAPE, AND WHY THERE ARE THREE FIELDS AND NOT ONE ──────────────────────────────────
 * `{ preset, tier, settings }`.
 *   • `settings` is the truth — sixteen values, and the only thing the renderer ever reads.
 *   • `preset` is what the PICKER shows: one of the four named columns, `auto`, or `custom`
 *     the moment any single setting differs from the column it claims.
 *   • `tier` is one of the four columns ALWAYS, even under `custom`/`auto`, because the PIXEL
 *     BUDGET (§4.4's 0.6 / 1.2 / 2.2 / 4.0 MP) is a property of the preset COLUMN and not of
 *     any one setting — there is no setting it could be derived from. It is the column the
 *     current settings were last branched from, so a player who picks High and then turns
 *     shadows off keeps High's 2.2 MP backbuffer cap, which is what they asked for.
 *
 * Nothing here imports three.js or touches a canvas: this is the MODEL. `scene/renderScene.ts`
 * subscribes and applies; `graphics/auto.ts` writes into it after detection; `ui/
 * GraphicsSection.tsx` renders it. A headless smoke lane can import it with no DOM at all.
 */

// ─────────────────────────────────────────────────────────────────────── the sixteen values ──

/**
 * §4.4 row 2 — the draw-loop frame cap, in frames per second, with TWO SENTINELS.
 *
 * It is a plain `number` and not a union of literals because the row is no longer a fixed
 * ladder: the owner asked for a rate you type (2026-09-19), so any integer in
 * `[GFX_FPS_MIN, GFX_FPS_MAX]` is a legal cap and the five tiles in the picker are a shortcut,
 * not the domain. `coerceMaxFps` below is what keeps that honest — this is the first field in
 * the whole settings object whose value arrives from a TEXT BOX rather than from a click, so
 * it is the first one that has to reject shapes (`NaN`, `Infinity`, `'60'`, `59.5`) instead of
 * merely choosing between known ones.
 *
 * ── THE TWO SENTINELS, AND WHY THEY ARE NOT "A BIGGER NUMBER" ──────────────────────────────
 *
 * **`0` — VSync.** The draw loop is `requestAnimationFrame` (`src/game.ts`), which the
 * compositor paces at the display's refresh. `0` means "no skip, draw on every frame the
 * browser hands us" — which in a BROWSER is the ceiling, because there is no way to PRESENT
 * more frames than the panel shows. It was called "Display", which is what made it read as a
 * CAP rather than as the absence of one.
 *
 * **`-1` — Unlimited.** Negative is the one thing a frame rate can never be, so it cannot
 * collide with a real rate however the picker grows, and it survives `JSON.stringify` exactly
 * (a `null` or a `'unlimited'` string would not survive `Number` coercion anywhere this value
 * is compared). It behaves IDENTICALLY to VSync inside the loop — `frameIntervalMs` returns
 * `0` for both — because the difference is not in the loop at all: it is whether the SHELL has
 * let the compositor run free.
 *
 * ── WHY UNLIMITED IS DESKTOP-ONLY, AND WHY IT IS STILL SHOWN ON THE WEB ────────────────────
 * Genuinely exceeding vsync needs Chromium's `disable-frame-rate-limit` and
 * `disable-gpu-vsync`, which only the desktop shell can pass (`electron/main.cjs`), and which
 * must be appended BEFORE `app.whenReady()` — so changing it cannot take effect until the app
 * restarts. Neither switch exists for a web page: a browser tab cannot ask its own compositor
 * for this, at any price.
 *
 * It is NOT hidden on the web anyway. The rule this repo follows is "do not ship a control
 * that silently does nothing", and hiding it fails that in the other direction: a player who
 * has read the download page, or who practises on the desktop app at home and the web build at
 * school, would find the option missing on one of them with nothing saying why. So the tile is
 * present in both builds, says `Desktop app only` on its face, and the row prints the whole
 * truth — in a browser it behaves as VSync — when it is the selected value.
 *
 * The numeric values are caps BELOW the vsync ceiling, which is the only direction a cap could
 * go before Unlimited existed. 144 and 240 are tiles because the ladder used to stop at 120, so
 * a 144/165/240 Hz panel had nothing between "120" and "every frame" — that gap is the other
 * half of what the owner hit, and a typed rate is what covers 165 and every other panel.
 */
export type MaxFps = number;

/** `0` — draw every frame the compositor offers, i.e. the display's refresh. */
export const MAX_FPS_VSYNC = 0;
/** `-1` — ask the desktop shell to stop honouring the display's refresh at all. */
export const MAX_FPS_UNLIMITED = -1;

/**
 * The bounds a TYPED rate is clamped into. Both are deliberate, and a value outside them
 * clamps to the bound rather than being dropped — somebody who types 5000 meant "as fast as
 * possible", and answering that by silently reverting to whatever was there tells them nothing.
 *
 *   • **24** — the film rate, and the floor at which this is still a driver-practice sim. The
 *     fixed sim step is 60 Hz; a render cap under 24 means most ticks are never drawn, a shot
 *     cannot be timed by eye, and the player is breaking their own practice rather than tuning
 *     it. The lowest TILE is 30 for the same reason; 24 leaves a little room under it on
 *     purpose, for the battery-saving and thermal cases the tiles do not cover.
 *   • **1000** — past every panel that exists (the fastest shipping displays are under 600 Hz),
 *     so it is already indistinguishable from no cap, and a four-digit box reads as a frame
 *     rate rather than as a budget in some other unit. Anything genuinely uncapped is the
 *     Unlimited sentinel, which is a different control for a different reason.
 */
export const GFX_FPS_MIN = 24;
export const GFX_FPS_MAX = 1000;

/** the one-click rates in the picker. A shortcut over the range, never the range itself. */
export const GFX_FPS_STEPS: readonly number[] = [30, 60, 120, 144, 240];

/** a positive cap that is not one of the tiles — i.e. what the Custom field is showing. */
export function isCustomFps(v: MaxFps): boolean {
  return v > 0 && !GFX_FPS_STEPS.includes(v);
}

/**
 * The one coercer in this file that is not an allowlist, because its domain is a RANGE.
 *
 * Order matters: the sentinels are matched FIRST and exactly, so no arithmetic can ever produce
 * one — `-1` and `0` are reachable only by being exactly `-1` and `0`, never by clamping. A
 * negative integer that is not the sentinel is not "a cap below the floor", it is junk of the
 * wrong shape, so it falls back rather than clamping up to 24; clamping it would quietly turn a
 * corrupt value into a working cap the player never chose.
 */
export function coerceMaxFps(v: unknown, fallback: MaxFps): MaxFps {
  if (v === MAX_FPS_VSYNC || v === MAX_FPS_UNLIMITED) return v;
  // `Number.isInteger` is false for NaN, ±Infinity, 59.5 and for anything that is not a number
  // at all, which is the whole junk list in one predicate.
  if (!Number.isInteger(v) || (v as number) < 1) return fallback;
  return Math.min(GFX_FPS_MAX, Math.max(GFX_FPS_MIN, v as number));
}

/**
 * §4.4 row 3. `smaa` IS NOT OFFERED ON THIS BUILD and the type does not carry it — see
 * `GFX_NOT_OFFERED` below for the measurement that decided it. MSAA is real multisampling at
 * the sample count named, done in an offscreen render target rather than through the canvas's
 * own `antialias` context attribute: WebGL gives no way to ASK the default framebuffer for a
 * particular sample count, and the attribute is fixed for the life of the context, so an
 * `antialias`-based implementation could offer neither "2x" nor a live change.
 */
export type AntiAliasing = 'off' | 'msaa2' | 'msaa4';

/** §4.4 row 4 — the sun's shadow map. `soft` is `high` plus a wider VSM blur radius. */
export type ShadowQuality = 'off' | 'low' | 'high' | 'soft';

/**
 * §4.4 row 5. `real` is the elements' `InstancedMesh` casting into the sun's shadow map (56
 * more casters); `blob` is a flat dark disc under each one, which costs one more instanced
 * draw and no shadow-map work at all; `none` is neither.
 */
export type ElementShadows = 'none' | 'blob' | 'real';

/** §4.4 row 6. See `GFX_NOT_OFFERED`: `ssao` is accepted by the type and by the store so a
 * later build can turn it on without a stored-settings migration, but nothing implements it
 * and the UI says so rather than offering a switch that does nothing. */
export type AmbientOcclusion = 'off' | 'ssao';

/** §4.4 row 7 — `texture.anisotropy`, clamped to the GPU's own maximum at apply time. */
export type Anisotropy = 1 | 4 | 8 | 16;

/** §4.4 row 8 — which CAD GLB decimation `buildBiobuzzField` loads (`field.glb` /
 * `field-low.glb`). The ONE setting that cannot be applied without rebuilding the field. */
export type MeshDetail = 'low' | 'high';

/**
 * §4.4 row 12 — how much of the cosmetic layer runs.
 *   minimal  — no landing reticle, no rolling spin on the elements, no wheel rotation
 *   standard — reticle + rolling spin + wheels
 *   full     — the above plus the reticle's full arc trace
 */
export type EffectsLevel = 'minimal' | 'standard' | 'full';

/** §4.4 row 14 — `reduced` damps the chase/orbit smoothing and stops the turntable, the same
 * thing `prefers-reduced-motion: reduce` does. The OS preference always wins: a player who has
 * asked their system for less motion gets it whatever this says. */
export type CameraMotion = 'full' | 'reduced';

/**
 * §4.4 row 16 — what the corner read-out prints.
 *
 * ⚠️ **INERT.** The read-out is one display for all three games now, in the React HUD, on
 * `GameSettings.perfDisplay` (`src/ui/PerfHud.tsx`) — a 3D-only row could not carry the ping,
 * and the div it drew sat on top of the event log. `scene/renderStats.ts` publishes its
 * counters instead of drawing, and ignores this value; the picker for it is gone from
 * `GraphicsSection`. The field is still here only because deleting it means editing
 * `renderScene.ts`'s two call sites, which another lane is in this week — take all three out
 * together.
 */
export type PerfOverlay = 'off' | 'fps' | 'full';

/** the environment ids `graphics/environments.ts` defines, repeated here as a type so this
 * module stays the one place the settings SHAPE is written. */
export type EnvironmentId = 'room' | 'school-hall' | 'monochrome-studio';

/** THE SIXTEEN. In §4.4's own table order, so the two can be diffed by eye. */
export interface GraphicsSettings {
  /** 50–200 % of CSS pixels, before the tier's pixel budget caps the backbuffer. */
  renderScale: number;
  maxFps: MaxFps;
  aa: AntiAliasing;
  shadows: ShadowQuality;
  elementShadows: ElementShadows;
  ao: AmbientOcclusion;
  anisotropy: Anisotropy;
  meshDetail: MeshDetail;
  environment: EnvironmentId;
  /** image-based lighting: `scene.environment` set, or lights only. */
  envLighting: boolean;
  /** the environment map's SPECULAR contribution on metals (`envMapIntensity`). */
  reflections: boolean;
  effects: EffectsLevel;
  /** 60–90°, §4.3's own envelope. Caps the driver camera's solved FOV and sets chase/orbit. */
  fov: number;
  cameraMotion: CameraMotion;
  /** the picture-in-picture overhead map in a corner. */
  minimap: boolean;
  perfOverlay: PerfOverlay;
}

export type GraphicsTier = 'low' | 'medium' | 'high' | 'ultra';
export const GFX_TIERS: readonly GraphicsTier[] = ['low', 'medium', 'high', 'ultra'];

export type GraphicsPreset = 'auto' | GraphicsTier | 'custom';

/**
 * §4.4's PIXEL BUDGET, in megapixels of BACKBUFFER. The render scale multiplies the device
 * pixel ratio; this caps the product, so a 200 % scale on a 4K panel cannot ask a laptop iGPU
 * for 33 million pixels a frame. Read by `effectivePixelRatio` below, which is the only
 * consumer — the renderer never does this arithmetic itself.
 */
export const GFX_PIXEL_BUDGET: Record<GraphicsTier, number> = {
  low: 0.6e6,
  medium: 1.2e6,
  high: 2.2e6,
  ultra: 4.0e6,
};

/**
 * THE PRESET TABLE — §4.4's four columns, transcribed. If this file and that table ever
 * disagree, the table is right and this is a bug; `scripts/smoke-biobuzz/render.ts` asserts a
 * handful of the load-bearing cells so a silent edit here is caught.
 *
 * Two cells differ from the doc for a stated reason, both of them in the two rows the doc
 * itself hedges (`GFX_NOT_OFFERED`): Ultra's AA is `msaa4` rather than "MSAA 4x + SMAA", and
 * Ultra's AO is `off` rather than "on".
 */
export const GFX_PRESETS: Record<GraphicsTier, GraphicsSettings> = {
  low: {
    renderScale: 75,
    maxFps: 60,
    aa: 'off',
    shadows: 'off',
    elementShadows: 'none',
    ao: 'off',
    anisotropy: 1,
    meshDetail: 'low',
    environment: 'room',
    envLighting: false,
    reflections: false,
    effects: 'minimal',
    fov: 70,
    cameraMotion: 'reduced',
    minimap: true,
    perfOverlay: 'off',
  },
  medium: {
    renderScale: 100,
    maxFps: 0,
    aa: 'msaa2',
    shadows: 'low',
    elementShadows: 'blob',
    ao: 'off',
    anisotropy: 4,
    meshDetail: 'high',
    environment: 'room',
    envLighting: false,
    reflections: false,
    effects: 'standard',
    fov: 70,
    cameraMotion: 'full',
    minimap: true,
    perfOverlay: 'off',
  },
  high: {
    renderScale: 100,
    maxFps: 0,
    aa: 'msaa4',
    shadows: 'high',
    elementShadows: 'real',
    ao: 'off',
    anisotropy: 8,
    meshDetail: 'high',
    environment: 'school-hall',
    envLighting: true,
    reflections: true,
    effects: 'standard',
    fov: 70,
    cameraMotion: 'full',
    minimap: false,
    perfOverlay: 'off',
  },
  ultra: {
    renderScale: 100,
    maxFps: 0,
    aa: 'msaa4',
    shadows: 'soft',
    elementShadows: 'real',
    ao: 'off',
    anisotropy: 16,
    meshDetail: 'high',
    environment: 'school-hall',
    envLighting: true,
    reflections: true,
    effects: 'full',
    fov: 70,
    cameraMotion: 'full',
    minimap: false,
    perfOverlay: 'off',
  },
};

/**
 * THE TWO ROWS OF §4.4 THIS BUILD DOES NOT OFFER, with the reason each is refused rather than
 * shipped as a switch that does nothing. Rendered verbatim by the Graphics section, so the
 * answer to "where is SSAO?" is on the screen that would have had it.
 *
 * Both are POST-PROCESSING PASSES, and this renderer has no composer: it draws the scene once,
 * into either the canvas or one multisampled render target, and blits. Adding either means
 * adding `EffectComposer` + `RenderPass` + the pass itself to a chunk budgeted at 250 KB
 * gzipped that is already at 187 (`scripts/bundleaudit.mjs`).
 *
 *   • SMAA — `three/examples/jsm/postprocessing/SMAAPass.js` is 50 KB of source, most of it two
 *     base64 lookup TEXTURES, which are already-encoded data and so gzip to very nearly their
 *     own size. With `EffectComposer` (8.5 KB) and `ShaderPass`/`CopyShader` behind it, it is
 *     most of the remaining 63 KB of headroom — for a second antialiasing pass ON TOP of the
 *     MSAA 4x this build does offer, which is the cheaper and sharper of the two on the thin
 *     straight edges (tape lines, frame rails) this field is made of.
 *   • SSAO — `SSAOPass.js` is a full second geometry pass into a depth+normal target plus a
 *     blur, on a scene whose ambient term is already an HDRI or a `RoomEnvironment` PMREM.
 *     §4.4 puts it on Ultra alone and the plan's own §11 lists post-processing as the first
 *     thing to drop; it is dropped.
 */
export const GFX_NOT_OFFERED: readonly { label: string; why: string }[] = [
  {
    label: 'SMAA',
    why: 'the extra pass costs most of the 3D renderer’s remaining download budget, on top of the MSAA this build already does in hardware',
  },
  {
    label: 'Ambient occlusion',
    why: 'it needs a second full pass over the scene; the environment lighting below does the job this field needs',
  },
];

// ────────────────────────────────────────────────────────────────────────────── the store ──

import { GRAPHICS_KEY } from '../../../storageKeys';
import { desktop } from '../../../desktop';

export interface GraphicsState {
  preset: GraphicsPreset;
  /** always one of the four columns — see this file's header on why it is not derived. */
  tier: GraphicsTier;
  settings: GraphicsSettings;
}

/** what a device that has never opened this screen gets, before `graphics/auto.ts` has run.
 * MEDIUM, not High: the first frame is drawn before detection finishes, and the cost of
 * guessing low on a fast machine is two seconds of a slightly plainer picture, while the cost
 * of guessing high on a slow one is two seconds of a slideshow. */
export const GFX_DEFAULT_TIER: GraphicsTier = 'medium';

function presetState(tier: GraphicsTier, preset: GraphicsPreset = tier): GraphicsState {
  return { preset, tier, settings: { ...GFX_PRESETS[tier] } };
}

/**
 * FIELD-BY-FIELD COERCION, the same discipline `src/settings.ts` applies to `GameSettings`:
 * every value is checked against its own allowlist and a bad one falls back to the tier's,
 * never to a default for the whole object. A stored blob written by an older build (fifteen
 * settings, or an `aa: 'smaa'` from a build that offered it) therefore keeps the fourteen it
 * still understands instead of resetting the lot.
 */
const oneOf = <T>(allowed: readonly T[], v: unknown, fallback: T): T =>
  (allowed as readonly unknown[]).includes(v) ? (v as T) : fallback;

const clampNum = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;

export const GFX_RENDER_SCALE_MIN = 50;
export const GFX_RENDER_SCALE_MAX = 200;
export const GFX_FOV_MIN = 60;
export const GFX_FOV_MAX = 90;

export function coerceGraphicsSettings(raw: unknown, base: GraphicsSettings): GraphicsSettings {
  const o = (raw ?? {}) as Partial<Record<keyof GraphicsSettings, unknown>>;
  return {
    renderScale: clampNum(o.renderScale, GFX_RENDER_SCALE_MIN, GFX_RENDER_SCALE_MAX, base.renderScale),
    maxFps: coerceMaxFps(o.maxFps, base.maxFps),
    aa: oneOf<AntiAliasing>(['off', 'msaa2', 'msaa4'], o.aa, base.aa),
    shadows: oneOf<ShadowQuality>(['off', 'low', 'high', 'soft'], o.shadows, base.shadows),
    elementShadows: oneOf<ElementShadows>(['none', 'blob', 'real'], o.elementShadows, base.elementShadows),
    ao: oneOf<AmbientOcclusion>(['off', 'ssao'], o.ao, base.ao),
    anisotropy: oneOf<Anisotropy>([1, 4, 8, 16], o.anisotropy, base.anisotropy),
    meshDetail: oneOf<MeshDetail>(['low', 'high'], o.meshDetail, base.meshDetail),
    environment: oneOf<EnvironmentId>(['room', 'school-hall', 'monochrome-studio'], o.environment, base.environment),
    envLighting: typeof o.envLighting === 'boolean' ? o.envLighting : base.envLighting,
    reflections: typeof o.reflections === 'boolean' ? o.reflections : base.reflections,
    effects: oneOf<EffectsLevel>(['minimal', 'standard', 'full'], o.effects, base.effects),
    fov: clampNum(o.fov, GFX_FOV_MIN, GFX_FOV_MAX, base.fov),
    cameraMotion: oneOf<CameraMotion>(['full', 'reduced'], o.cameraMotion, base.cameraMotion),
    minimap: typeof o.minimap === 'boolean' ? o.minimap : base.minimap,
    perfOverlay: oneOf<PerfOverlay>(['off', 'fps', 'full'], o.perfOverlay, base.perfOverlay),
  };
}

/** every setting equal to the tier's column? — what decides `custom` vs a named preset. */
export function matchesPreset(settings: GraphicsSettings, tier: GraphicsTier): boolean {
  const p = GFX_PRESETS[tier];
  return (Object.keys(p) as (keyof GraphicsSettings)[]).every((k) => settings[k] === p[k]);
}

function coerceState(raw: unknown): GraphicsState {
  const o = (raw ?? {}) as { preset?: unknown; tier?: unknown; settings?: unknown };
  const tier = oneOf<GraphicsTier>(GFX_TIERS, o.tier, GFX_DEFAULT_TIER);
  const settings = coerceGraphicsSettings(o.settings, GFX_PRESETS[tier]);
  let preset = oneOf<GraphicsPreset>(['auto', 'low', 'medium', 'high', 'ultra', 'custom'], o.preset, 'auto');
  // A STORED PRESET NAME IS A CLAIM, NOT A FACT. If the settings under it no longer match the
  // column — an older build wrote a row this one coerced, or a column moved between releases —
  // the honest label is `custom`, because that is what the picker would otherwise lie about.
  if (preset !== 'custom' && preset !== 'auto' && !matchesPreset(settings, preset)) preset = 'custom';
  return { preset, tier, settings };
}

/** the live state, read synchronously by the scene on every settings change. Loaded once, on
 * first access, and never re-read from storage (this tab owns it; see `subscribeGraphics`). */
let state: GraphicsState | null = null;

export function getGraphics(): GraphicsState {
  if (state) return state;
  try {
    const raw = localStorage.getItem(GRAPHICS_KEY);
    state = raw ? coerceState(JSON.parse(raw)) : presetState(GFX_DEFAULT_TIER, 'auto');
  } catch {
    // corrupt JSON, private browsing, a locked-down profile — the default is always available
    state = presetState(GFX_DEFAULT_TIER, 'auto');
  }
  return state;
}

/** just the sixteen — the shape every renderer call site actually wants. */
export function getGraphicsSettings(): GraphicsSettings {
  return getGraphics().settings;
}

type GraphicsListener = (state: GraphicsState) => void;
const listeners = new Set<GraphicsListener>();

/**
 * Subscribe to any change made through this module IN THIS TAB. Same rule as `subscribeViewPref`
 * and for the same reason: no `storage`-event relay, because a second tab lowering its own
 * shadows must not restyle the match someone is driving in this one.
 */
export function subscribeGraphics(fn: GraphicsListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * KEEP THE DESKTOP SHELL'S PREFERENCE IN STEP WITH THIS ONE.
 *
 * Unlimited is TWO stores: the graphics setting lives here, in `localStorage`, and the
 * Chromium switches live in the main process, in `userData`, because they have to be appended
 * before the app is ready. This is the seam between them, and it is here — inside `commit` —
 * rather than in the picker, because `maxFps` has three other writers: `setGraphicsPreset`,
 * `setGraphicsTier` (which `graphics/auto.ts` calls after detection) and `resetGraphicsToAuto`.
 * A player who picks Unlimited and then drops to Low has NOT asked to keep running with vsync
 * disabled, and a sync that only ran in the picker would leave them there forever.
 *
 * Fire-and-forget, and swallowed: an older desktop shell has no `perf` bridge at all (the app
 * loads the LIVE site, so a new client inside last month's shell is the ordinary case, not an
 * edge one), and a failed IPC must not lose the pick the player just made. The renderer's value
 * is the intent; `GraphicsSection` reconciles the two on mount and reports any disagreement.
 */
function syncDesktopUnlimited(prev: MaxFps | null, next: MaxFps): void {
  const wantOn = next === MAX_FPS_UNLIMITED;
  if (prev !== null && wantOn === (prev === MAX_FPS_UNLIMITED)) return;
  desktop()?.perf?.setUnlimitedFps(wantOn).catch(() => {});
}

function commit(next: GraphicsState): void {
  const prev = state;
  state = next;
  try {
    localStorage.setItem(GRAPHICS_KEY, JSON.stringify(next));
  } catch {
    /* non-fatal: the pick still applies for this session */
  }
  syncDesktopUnlimited(prev ? prev.settings.maxFps : null, next.settings.maxFps);
  for (const fn of listeners) fn(next);
}

/** pick a named column (or `auto`, which `graphics/auto.ts` then resolves into a tier). */
export function setGraphicsPreset(preset: GraphicsPreset): void {
  if (preset === 'custom') return; // `custom` is a CONSEQUENCE of editing a setting, never a pick
  const cur = getGraphics();
  const tier = preset === 'auto' ? cur.tier : preset;
  commit({ preset, tier, settings: { ...GFX_PRESETS[tier] } });
}

/**
 * Write the tier AUTO decided. `keepAuto` is what separates the two callers: the detector and
 * the warm-up are still "Auto" and must stay labelled that way, while a player who has picked
 * a column by hand is not moved by anything.
 */
export function setGraphicsTier(tier: GraphicsTier, keepAuto: boolean): void {
  commit({ preset: keepAuto ? 'auto' : tier, tier, settings: { ...GFX_PRESETS[tier] } });
}

/** change ONE setting. The preset becomes `custom` unless the result happens to land exactly
 * back on a column, in which case it is honestly named again. */
export function setGraphicsSetting<K extends keyof GraphicsSettings>(key: K, value: GraphicsSettings[K]): void {
  const cur = getGraphics();
  const settings = { ...cur.settings, [key]: value };
  const named = GFX_TIERS.find((t) => matchesPreset(settings, t));
  commit({ preset: named ?? 'custom', tier: named ?? cur.tier, settings });
}

/** forget everything and let detection decide again (§4.4's "Reset to Auto" button). The
 * caller re-runs `graphics/auto.ts`; this only clears the stored opinion. */
export function resetGraphicsToAuto(): void {
  commit(presetState(GFX_DEFAULT_TIER, 'auto'));
}

// ───────────────────────────────────────────────────────────────────── derived, for the scene ──

/**
 * The BACKBUFFER pixel ratio for a canvas of `cssW × cssH`: the device ratio scaled by the
 * player's render scale, then capped so `cssW·cssH·r²` stays inside the tier's pixel budget.
 *
 * Returned as a RATIO rather than a size because that is what `WebGLRenderer.setPixelRatio`
 * and a render target's own sizing both take, and because the cap has to be recomputed on
 * every resize — a window dragged from a quarter of a 4K screen to full screen quadruples the
 * pixel count at an unchanged setting.
 */
export function effectivePixelRatio(
  settings: GraphicsSettings,
  tier: GraphicsTier,
  cssW: number,
  cssH: number,
  devicePixelRatio: number,
): number {
  const w = Math.max(1, cssW);
  const h = Math.max(1, cssH);
  const wanted = Math.max(0.1, devicePixelRatio * (settings.renderScale / 100));
  const cap = Math.sqrt(GFX_PIXEL_BUDGET[tier] / (w * h));
  return Math.max(0.3, Math.min(wanted, cap));
}

/** the sun shadow map's square resolution for a quality level; `off` has no map at all. */
export function shadowMapSize(q: ShadowQuality): number {
  return q === 'low' ? 1024 : q === 'high' ? 2048 : 2048;
}

/** VSM blur radius in shadow-map texels. `soft` is the same 2048 map with a wider kernel —
 * which is what makes it a separate row from `high` rather than a fourth resolution. */
export function shadowBlurRadius(q: ShadowQuality): number {
  return q === 'soft' ? 6 : 3;
}

/** how many multisamples a render target needs for `aa`; 0 means render straight to the
 * canvas with no intermediate target at all. */
export function msaaSamples(aa: AntiAliasing): number {
  return aa === 'msaa2' ? 2 : aa === 'msaa4' ? 4 : 0;
}

/**
 * The minimum wall-clock gap between two rendered frames, in ms; `0` is uncapped.
 *
 * BOTH SENTINELS RETURN 0, and that is the point: in the loop, Unlimited and VSync are the
 * same instruction — skip nothing. Whether the frames that instruction produces are actually
 * presented faster is decided by the shell, before this process had a draw loop at all.
 */
export function frameIntervalMs(fps: MaxFps): number {
  // 0.5 ms of slack: a 60 Hz display's rAF lands at 16.66 ms and a hard `>= 16.666` compare
  // drops every other frame to 30 fps, which is the classic way a frame cap makes things worse.
  return fps > 0 ? 1000 / fps - 0.5 : 0;
}

/** the human label for a preset, for the picker and for an event-log line. */
export const GFX_PRESET_LABEL: Record<GraphicsPreset, string> = {
  auto: 'Auto',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  ultra: 'Ultra',
  custom: 'Custom',
};
