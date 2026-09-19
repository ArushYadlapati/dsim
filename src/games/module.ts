import type { ComponentType } from 'react';
import type {
  Alliance,
  Artifact,
  MobileLayout,
  RobotSpec,
  RobotState,
  StartCat,
  StartPose,
  Vec2,
  World,
} from '../types';
import type { HudSnapshot } from '../game';
import type { GameId, GameSimModule, GameUiSpec } from './types';

/**
 * The FULL (client) game module: the DOM-free `GameSimModule` plus the browser
 * canvas renderers + builder metadata. Kept separate from `./types.ts` so the
 * server (no DOM lib) never imports `CanvasRenderingContext2D`. React types are
 * fine here for the same reason.
 *
 * ---
 * ## UI SLOTS
 *
 * Every `ComponentType` / function field below is OPTIONAL, and every consumer
 * wires it as `mod.X ? <the slot> : <the existing branch, unchanged>`. That shape
 * is the whole point:
 *
 * - DECODE's and Chain Reaction's inline `isDecode` / `hud.game === 'chain'`
 *   branches are NOT refactored. They work, they are the two games people are
 *   playing, and rewriting them to route through the slots would put a behaviour
 *   change inside a commit whose only job is to make room for a third game. A game
 *   that fills no slot behaves exactly as it did.
 * - A THIRD game therefore adds no arm to any of those branches. Before the slots
 *   existed there were ~16 `isDecode` gates in `Menu.tsx` alone, plus the
 *   `GameView` / `MobileControls` / start-editor pairs — every one of which a new
 *   game had to be threaded into by hand, in files two other people are editing
 *   at the same time.
 * - `GameUiSpec` (`ui`, below) is the earlier attempt at this and has never had a
 *   reader. It is left alone deliberately: removing it is a separate change, and
 *   it is not in anybody's way.
 */
export interface GameModule extends GameSimModule {
  /** `screenUp` is world-space "up" for z-lift — CR raises the beams into extruded tubes. */
  drawField(ctx: CanvasRenderingContext2D, world: World, screenUp?: Vec2): void;
  /** extra overlays drawn after the field, before robots (DECODE: ramp strips) */
  drawOverlays?(ctx: CanvasRenderingContext2D, world: World): void;
  /** per-robot sprite. DECODE omits it (the shared `drawRobot` is used); CR provides its
   * own so the archetype launcher + intake design read correctly. `screenUp` lets CR bob the
   * chassis up onto a beam it's crossing. `world` is optional and read-only — CR's rail-turret
   * claw TRACKS a live target, so its sprite needs to see where the loose rings are. */
  drawRobot?(
    ctx: CanvasRenderingContext2D,
    r: RobotState,
    intakeOn: boolean,
    held: readonly Artifact[],
    screenUp?: Vec2,
    world?: World,
  ): void;
  /** scoring-elements renderer, drawn after the robots (DECODE: balls; CR: particles
   * + catalysts + endgame badges). `screenUp` is world-space "up" for z-lift. */
  drawBalls(ctx: CanvasRenderingContext2D, world: World, screenUp: Vec2): void;
  ui: GameUiSpec;
  /**
   * THE LAZY 3D SCENE (Day 1 seam, `docs/biobuzz/plan-3d.md` §2.3/§2.5) — absent ⇒ this game
   * has no 3D renderer, which is DECODE and Chain Reaction today. A FUNCTION rather than the
   * factory itself, so the Three.js chunk is only ever `import()`-ed the moment a 3D view is
   * actually mounted: a player who never opens a 3D BIOBUZZ view never downloads it, exactly
   * like `sim3d/engine.ts`'s `initPhysics3d()` on the physics side.
   */
  scene?: () => Promise<GameSceneFactory>;
  /**
   * THE ROBOT PREVIEW'S 3D SCENE (`docs/roadmap.md` item 1) — absent ⇒ this game's builder has
   * only its 2D schematic, which is DECODE and Chain Reaction today.
   *
   * A SECOND loader beside `scene` rather than a field on it, for the reason `scene` is a
   * function at all: a player who never opens the 3D preview never downloads Three.js. It is
   * declared here, and filled in the game's own `index.ts`, so that ALL of a game's dynamic
   * `import()`s of its renderer live in one file — which is the property `scripts/smoke-biobuzz/
   * render.ts` asserts, and the reason a builder component can reach the chunk without an import
   * that would drag it into the main bundle.
   */
  previewScene?: () => Promise<RobotPreviewFactory>;

  // ---------------------------------------------------------------- UI slots --

  /** the game's own builder panel, rendered by `Menu` in place of the per-game
   * inline block. It gets ONE patch callback rather than a settings setter: a
   * builder must not know where a spec is stored. */
  Builder?: ComponentType<GameBuilderProps>;
  /** the robot schematic (the builder hero + the pre-match strategy card). One
   * component per game on purpose — work on one game's mechanisms must never
   * change how another game's robot looks. */
  Preview?: ComponentType<GamePreviewProps>;
  /** extra chips in the live HUD's `.robot-status` row (hopper, mechanism state,
   * action prompts). Rendered INSIDE the existing row, so it inherits the chip
   * styles and the touch-layout suppression. */
  hudChips?: ComponentType<GameHudProps>;
  /** the whole bottom red|timer|blue bar, for a game that needs a different one.
   * Absent means the shared bar, which is what both current games use. */
  scoreBar?: ComponentType<GameHudProps>;
  /**
   * The score BREAKDOWN sections for the results screens.
   *
   * Rows are ALLIANCE-RELATIVE (`[label, mine, opp]`, "mine" being `hud.alliance`)
   * because the two screens want different things from the same numbers: the versus
   * results print red | blue, and a solo record run has no opponent column at all.
   * Only the game knows which of its own numbers is which, so it hands over the pair
   * and each screen arranges it.
   */
  resultsRows?(hud: HudSnapshot): readonly ResultsSection[];
  /** extra touch action buttons. Each one's POSITION comes from
   * `GameSettings.mobileLayout`, so a genuinely new action needs a key there too. */
  mobileButtons?: readonly GameMobileButton[];
  /** `false` when this game has no auto-fire assist, which hides `Menu`'s Auto fire toggle. The
   * game's sim must also ignore the flag (BIOBUZZ forces it false at spawn). Absent means the
   * toggle is offered, as it is for DECODE and Chain Reaction. */
  offersAutoFire?: boolean;
  /** the game's start-position editor, used in place of the
   * `isDecode ? StartPositionEditor : ChainStartEditor` branch. */
  startEditor?: ComponentType<StartEditorProps>;
  /** display strings a non-game screen needs. `configSummary` is the ONE line that
   * says what a build is — printed by the leaderboard, the lobby roster and the
   * strategy screen. */
  labels?: {
    configSummary(spec: RobotSpec): string;
  };
  /**
   * The PER-GAME tiles in the builder hero's stat grid — the summary of what
   * MECHANISMS this build carries, beside the shared speed / mass / drivetrain tiles.
   *
   * ── WHY THIS IS A SLOT, AND A SIBLING OF `labels` RATHER THAN A MEMBER OF IT ──
   * `Menu.tsx` picked these tiles with `isDecode ? <intake tile> : <scoring + catalyst
   * tiles>` — the same two-valued shape `presets` was built to replace, and with the
   * same result: a third game did not fall back to "no per-game tile", it fell into the
   * CHAIN arm. BIOBUZZ therefore advertised a "Claw arm · CATALYST" chip, a Chain
   * Reaction mechanism, off a field (`catalystType`) its own coercer DELETES — so the
   * tile was printing `CHAIN_CATALYST_LABELS[CHAIN_DEFAULT_CATALYST]`, a default label
   * for a field the spec does not have. Confident, populated, and about another game.
   *
   * It is a SIBLING of `labels` because the slot table is a map from slot to CONSUMER,
   * and these have different ones: `labels.configSummary` is a SENTENCE for screens that
   * are not the builder (`robotLabels.buildSummary` → the leaderboard, the lobby roster,
   * the strategy card), while this is the builder hero's own tile grid and its shape is
   * structured, not a line. Folding a tile list into a bag named `labels` would turn that
   * bag into a catch-all with two unrelated readers, which is the point at which a slot
   * stops saying where it is rendered. A game that wants both still writes them off ONE
   * vocabulary module, which is what keeps the two from describing a robot differently.
   *
   * Returns DATA, not markup, for the reason `presets.lines` and `resultsRows` do: the
   * `.ds-stat` tile (and its CSS) has one owner, and a game contributing a tile cannot
   * drift it.
   */
  statTiles?(spec: RobotSpec): readonly GameStatTile[];
  /**
   * THE BODY OF ONE SAVED-ROBOT CARD — under the name and team, where `Menu.tsx` prints the
   * one-line build summary.
   *
   * It is a COMPONENT rather than a second string slot because what belongs there is no longer
   * always a string: BIOBUZZ shows a 3D thumbnail of the saved build when the device is on the 3D
   * view and the summary sentence when it is not (`docs/roadmap.md` item 1). The choice is the
   * GAME's, not the menu's — the menu does not know what a 3D view is, and a `showThumbnail`
   * boolean threaded through it would be the shared screen learning one game's rendering model.
   *
   * A game that fills it also owns printing its own summary, which it already has: the slot's
   * filler and `labels.configSummary` read the same vocabulary module.
   */
  savedCard?: ComponentType<GameSavedCardProps>;
  /**
   * The game's PRESET ROBOTS — the cards the builder's `Presets` section offers.
   *
   * ── WHY THIS IS A SLOT ──────────────────────────────────────────────────
   * `Menu.tsx` picked the list with `isDecode ? ROBOT_PRESETS : CHAIN_PRESETS`, and the
   * card BODY under each name with a second two-valued branch. A third game therefore
   * did not fall back to "no presets" — it fell into the CHAIN arm and was offered
   * Chain Reaction's robots, described in Chain Reaction's words. Not a missing feature:
   * a wrong one, and invisible, because the section still rendered nine plausible cards.
   *
   * A game fills this and gets its own list, its own match test and its own card body;
   * a game that does not is routed through the unchanged branch exactly as before.
   *
   * `matches` is a BUILD comparison and deliberately not a deep equality: the player's
   * name / team / number are theirs and are copied across when a card is applied, so a
   * card must still read as selected afterwards. Each game supplies its own because
   * each game's build is a different set of fields — DECODE ignores the mount fields,
   * Chain Reaction ignores flywheel inertia.
   */
  presets?: {
    /** the shipped builds, in display order. */
    list: readonly RobotSpec[];
    /** does `spec` carry this preset's BUILD? Identity fields are excluded — see above. */
    matches(spec: RobotSpec, preset: RobotSpec): boolean;
    /** the detail lines under the preset's name. `meta` is the build; `zone` is the
     * one-line "what it is for", rendered with the same emphasis DECODE gives its
     * optimised-range line. Absent `zone` simply renders nothing. */
    lines(preset: RobotSpec): { meta: string; zone?: string };
    /** how many LEADING entries are real, documented robots rather than archetype
     * demos. The builder rules off after them so a player can tell "this is a real
     * team's robot" from "this is what a drum shooter feels like". Absent ⇒ all demos.
     * Mirrors Chain Reaction's `CHAIN_REAL_PRESETS`. */
    realCount?: number;
  };
  /**
   * DEV-ONLY routes this game mounts under `/<id>/...` (the BIOBUZZ scene gallery).
   *
   * Rendered only on the ALPHA channel: they are development instruments, they draw
   * through the real renderers with no auth or session behind them, and a stable
   * build must not carry a URL that opens one.
   */
  devRoutes?: readonly GameDevRoute[];
}

/** props for `GameModule.Builder` */
export interface GameBuilderProps {
  spec: RobotSpec;
  /** apply a PARTIAL spec change (the caller owns storage + coercion) */
  onChange(patch: Partial<RobotSpec>): void;
  game: GameId;
}

/** props for `GameModule.Preview` — matches `RobotPreview` / `ChainRobotPreview` */
export interface GamePreviewProps {
  spec: RobotSpec;
  /** rendered edge length in px */
  size?: number;
  /**
   * Whose robot this is. A 2D schematic has no use for it (both current ones draw in neutral
   * `ds-*` tokens), but a 3D preview does: the alliance is the chassis outline and the sign
   * panel, so a preview without one would be the only place this game draws a robot with no
   * alliance at all. Absent ⇒ the game's own default.
   */
  alliance?: Alliance;
  /**
   * MAY this host mount a live 3D scene? Opt-IN, and it is a statement about the HOST, not a
   * preference: the builder hero is one preview on screen at a time and can afford a WebGL
   * context, while the 2v2 strategy screen renders FOUR preview cards at once and a context each
   * would put it near the browser's own cap for no gain — that screen wants a picture of a robot,
   * not a turntable. Absent ⇒ no live scene, which is every host that existed before this.
   */
  allow3d?: boolean;
}

/**
 * props for `GameModule.savedCard` — the BODY of one saved-robot card in the builder's garage.
 */
export interface GameSavedCardProps {
  spec: RobotSpec;
  alliance: Alliance;
}

/** props for the live-HUD slots (`hudChips`, `scoreBar`) */
export interface GameHudProps {
  hud: HudSnapshot;
}

/**
 * One tile in the builder hero's stat grid (`GameModule.statTiles`).
 *
 * `label` and `sub` are written in SENTENCE CASE and rendered uppercase by `.ds-stat .sl`
 * — the caption is a category, not a heading, so the CSS owns the casing and a caller
 * that shouted its own would be the only one on the row that did.
 */
export interface GameStatTile {
  /** the tile's value. A WORD here rather than a number — the consumer renders it with
   * the repo's `.sv.sm` bare-word modifier, same as the drivetrain tile beside it. */
  value: string;
  /** the caption under the value ("launcher"). */
  label: string;
  /** an optional SECOND caption line, for a fact the value has no room for: where the
   * mechanism is mounted, what it is dialled to. Absent renders nothing. */
  sub?: string;
}

/** one results-screen section: a heading and its rows, each `[label, mine, opp]`. */
export type ResultsSection = readonly [string, readonly (readonly [string, number, number])[]];

/** which `RobotCommand` action a touch button holds down. A genuinely new game
 * action needs a protocol bit as well — see the netcode section of CLAUDE.md. */
export type MobileActionField = 'intake' | 'fire' | 'catalyst' | 'fling' | 'bbNectar';

/** one extra touch action button contributed by a game */
export interface GameMobileButton {
  /** which `mobileLayout` entry positions it (the editor drags THAT key) */
  name: keyof MobileLayout;
  /** ARIA label — never drawn (it does not fit inside an 82px circle) */
  label: string;
  /** the drawn glyph */
  glyph: string;
  /** style class on the button */
  cls: string;
  /** the big primary button (at most one per game) */
  primary: boolean;
  field: MobileActionField;
  /**
   * Does THIS build have the mechanism right now? Absent means always.
   *
   * It reads `HudSnapshot.gameHud` — the game's own HUD slice — rather than the
   * spec, because that is the shape the live HUD already carries to the touch
   * layer (CR's inline `hasFling` prop is the same fact by hand). A button that
   * does nothing is worse than no button on a phone-sized screen.
   */
  present?(gameHud: unknown): boolean;
}

/**
 * Props every start editor takes. DECODE's `StartPositionEditor` and CR's
 * `ChainStartEditor` already agree on all of these. `onChange` is typed with the
 * NULL (clear the custom pose, fall back to the named anchor) because DECODE
 * accepts it, and a component that only ever handles a real pose still satisfies
 * the slot.
 */
export interface StartEditorProps {
  spec: RobotSpec;
  alliance: Alliance;
  /** the active CUSTOM pose (canonical frame), or null to use the `startIndex` anchor */
  value: StartPose | null | undefined;
  startIndex: number;
  category: StartCat;
  saved: { close: StartPose[]; far: StartPose[] };
  /** a 2v2 role: fixes the category and hides the tabs */
  lockedCategory?: StartCat;
  onChange: (pose: StartPose | null) => void;
  /** the parent MUST set `startIndex` AND clear `startPose` in ONE update */
  onPickPreset: (i: number) => void;
  onCategory: (cat: StartCat) => void;
  onSave: (pose: StartPose) => void;
  onDeleteSaved: (cat: StartCat, i: number) => void;
  /**
   * how many saved poses per role this player may keep (`savedStartCap`, the supporter perk).
   * Passed in by the HOST screen rather than read in the editor: the perk comes from the ads
   * context, and `src/ads/adsense.ts` reads `import.meta.env` at load, which a game module's
   * editor must not drag into the headless test suites. Absent ⇒ the free cap.
   */
  maxSaved?: number;
  size?: number;
}

/** one alpha-only dev route mounted under this game's URL prefix */
export interface GameDevRoute {
  /**
   * The path UNDER the game prefix, leading slash included: `/gallery`.
   *
   * A trailing `/*` matches the base AND every path beneath it (`/gallery/*` takes
   * `/gallery` and `/gallery/pile-fast`), for an instrument that routes its own
   * sub-paths — the component reads the remainder off `window.location` itself.
   * `devRouteFor` in `App.tsx` is the matcher.
   */
  path: string;
  Component: ComponentType;
}

// ---------------------------------------------------------------- 3D scene contract --
//
// The CLIENT-SIDE half of the 3D renderer seam (Day 1, `docs/biobuzz/plan-3d.md` §2.3):
// declared additively here so a later renderer lane can fill `GameModule.scene` and a
// later controller lane can drive it, without either waiting on the other. DECODE and
// Chain Reaction register no `scene` and are untouched by any of this.

/**
 * Which camera a 3D scene renders for (`docs/biobuzz/plan-3d.md` §4.3).
 *
 * `driver` is the driver's own station view and `overhead` the fixed orthographic shot (the 2D
 * fit) — the two the controller itself picks between. `chase` and `orbit` are DAY 2 additions
 * and the controller never names them: they are reached through the device's own camera
 * preference (`src/games/biobuzz/graphics/store.ts`), which the scene resolves against the
 * `camera` the frame carries. Adding them here rather than keeping them scene-private is what
 * lets a host (the scene gallery, a replay screen, a later Graphics section) ask for one
 * directly without a second vocabulary for the same four cameras.
 *
 * A scene that cannot honour one falls back rather than throwing — `chase` with no
 * `localRobotId` (a spectator, a replay of someone else's match) has nothing to chase, and
 * BIOBUZZ's scene renders `overhead` instead.
 */
export type SceneCamera = 'driver' | 'overhead' | 'chase' | 'orbit';

/**
 * The HUD's OCCUPIED BANDS over the render surface, in CSS pixels, measured off the live DOM
 * (`GameController.refreshHudInsets`).
 *
 * The 3D canvas fills the whole `.game-viewport`, but the score bar, the breakdown chips, the
 * status chips and the MENU/RESET buttons are absolutely positioned ON TOP of it — so "fit the
 * field to the canvas" frames part of the field underneath chrome that hides it. That is the
 * owner's report of 2026-09-18 ("the scoreboard overlaps the field"). These four numbers are how
 * much of each edge is spoken for; the SAFE RECT the field must fit into is
 * `[left, width − right] × [top, height − bottom]`.
 *
 * ABSENT (or all-zero) READS AS NO CHROME, which is what keeps this additive: a scene written
 * before this existed, or a host that does not measure (the scene gallery, a preview harness),
 * fits to the full canvas exactly as it did.
 *
 * ⚠️ These are bands, NOT a per-element occlusion map. An element in a CORNER reserves a band
 * across the whole edge it is nearest — cheap, stable, and it cannot leave a gap the way a
 * per-element solve would when the HUD relayouts mid-frame.
 */
export interface SceneInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * One frame's render inputs — everything a `GameScene` needs that is not already on `world`.
 * `alpha` is the interpolation fraction between the last two authoritative ticks (the same
 * fixed-timestep smoothing the 2D renderer does); `localRobotId` is absent for a spectator.
 */
export interface SceneFrame {
  alpha: number;
  viewAngle: number;
  camera: SceneCamera;
  localRobotId?: number;
  width: number;
  height: number;
  dpr: number;
  /**
   * The HUD's occupied bands (see `SceneInsets`) — absent ⇒ none, fit to the whole canvas.
   *
   * The OBJECT IS REUSED across frames by the controller (zero per-frame allocation at 144 Hz),
   * so a scene must read the four numbers during `render` and never retain the reference.
   */
  insets?: SceneInsets;
}

/**
 * A persistent 3D scene over one canvas, owned by the controller for as long as a 3D view is
 * mounted. The renderer lane fills an implementation (Three.js); the controller lane calls
 * `render`/`resize`/`dispose` from its own loop. It reads `World`, it never writes it.
 */
export interface GameScene {
  readonly element: HTMLCanvasElement;
  render(world: World, frame: SceneFrame): void;
  resize(width: number, height: number, dpr: number): void;
  dispose(): void;
  /**
   * PROJECT a field point through the scene's ACTIVE camera, into CSS pixels on the 2D overlay
   * canvas above it (Day 2, `docs/biobuzz/plan-3d.md` §4.7).
   *
   * The 2D canvas stays mounted over a live scene and keeps drawing the cheap overlays — the
   * name/team labels, an auto path, the replay burn-in — but its own `Camera` is the TOP-DOWN
   * one, so in a 3D view every one of those lands where the robot would have been on the flat
   * map: metres away from the robot on screen, and with no notion of "behind the camera" at
   * all. This is the one number the overlay pass cannot work out for itself, because only the
   * scene knows the live camera, its `setViewOffset` window and which of its four cameras is
   * currently active.
   *
   * `x`/`y` are field inches, `z` is height above the tiles (the same frame `World` uses).
   * `out` is written IN PLACE and is the caller's own object, reused across every label in a
   * frame — a projection that allocated a vector per call would allocate one per robot per
   * frame at up to 144 Hz. `visible` is false when the point is behind the camera or outside
   * the frustum, and `x`/`y` are then meaningless (the caller skips the draw).
   *
   * OPTIONAL, so this stays additive: a scene that does not implement it leaves the overlay
   * drawing exactly what it drew before, through the 2D camera.
   */
  project?(x: number, y: number, z: number, out: { x: number; y: number; visible: boolean }): void;
}

/**
 * What a HOST can tell a scene at construction (Day 3, additive — every field is optional and a
 * factory called with no options behaves exactly as it did before this existed).
 *
 * There are three hosts and they want different things: the live game view wants a scene that
 * takes the keyboard and reports quality changes into the match's event log; a replay export
 * wants a fixed quality and no input at all; the gallery wants a still.
 */
export interface SceneOptions {
  /**
   * ONE LINE for the player, from the renderer.
   *
   * The scene has no access to `world.events` — it takes a `World` and never writes it, which
   * is the contract that keeps a renderer out of the simulation — but §4.6 asks for an
   * event-log line in three situations it is the only thing that can detect: Auto picking a
   * preset, the in-match slip rule lowering one, and a software renderer or a failed HDRI
   * sending the view back to 2D. So it hands the line OUT and the host decides where a line
   * goes. Absent ⇒ the scene stays silent (and still logs a real failure to the console).
   */
  onQualityEvent?(line: string): void;
  /**
   * FIX the quality tier, ignoring (and not subscribing to) the device's own graphics
   * preference. A video export is the case this exists for: §4.7 fixes exports at High so the
   * file does not come out at whatever the machine that made it happened to be set to, and so
   * that a settings change mid-encode cannot change the resolution of a video halfway through.
   */
  quality?: 'low' | 'medium' | 'high' | 'ultra';
  /**
   * `false` for a scene nobody is driving — an export, a still, a thumbnail. It binds no keys
   * and no pointer handlers, which matters because those are WINDOW-level: an off-screen export
   * scene that installed the view key would have the player's `t` press swap a view they cannot
   * see while their video encoded.
   */
  interactive?: boolean;
}

/** builds a `GameScene` inside `host` (the DOM node the controller mounts it in). May be
 * async because a real implementation loads the Three.js chunk + HDRI on first use.
 *
 * `options` is ADDITIVE (Day 3): an existing caller passing only `host` is unchanged. */
export type GameSceneFactory = (host: HTMLElement, options?: SceneOptions) => GameScene | Promise<GameScene>;

/**
 * What a HOST can tell a ROBOT PREVIEW scene at construction. Same additive rule as
 * `SceneOptions`: a factory called with only `host` behaves as it did before any of this existed.
 */
export interface RobotPreviewOptions {
  /** FIX the quality tier, ignoring the device's graphics preference — a cached thumbnail must
   * not change because a settings screen was opened somewhere else. */
  quality?: 'low' | 'medium' | 'high' | 'ultra';
  /** `false` binds no pointer handlers: a scene nobody is driving (a thumbnail). */
  interactive?: boolean;
  /** `false` runs no frame loop at all — the scene draws only when `capture()` asks it to. */
  animate?: boolean;
}

/**
 * A persistent preview of ONE robot over one canvas, owned by the component that mounted it.
 *
 * It takes a SPEC, never a `World`: a builder has no match, and the point of the seam is that the
 * same generator draws the same robot in both places (`scene/renderPreview.ts`'s header).
 */
export interface RobotPreviewScene {
  readonly element: HTMLCanvasElement;
  /** show this build. Cheap to call on every render — an unchanged build rebuilds nothing. */
  setSpec(spec: RobotSpec, alliance: Alliance): void;
  /** fix or release the quality tier (`null` follows the device preference again). */
  setQuality(tier: 'low' | 'medium' | 'high' | 'ultra' | null): void;
  resize(width: number, height: number, dpr: number): void;
  /** ONE frame at `size`x`size` CSS pixels, synchronously, as a PNG data URL. */
  capture(size: number): string;
  dispose(): void;
}

/** builds a `RobotPreviewScene` inside `host`. Synchronous: unlike the match scene it loads no
 * GLB, so once the chunk is here there is nothing left to await. */
export type RobotPreviewFactory = (host: HTMLElement, options?: RobotPreviewOptions) => RobotPreviewScene;
