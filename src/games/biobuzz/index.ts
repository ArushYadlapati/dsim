import type { GameModule } from '../module';
import { BiobuzzGallery } from './Gallery';
import { BiobuzzPreview3D, BiobuzzSavedCard } from './Preview3D';
import {
  BiobuzzBuilderSlot,
  BiobuzzHudChips,
  BiobuzzScoreBar,
  biobuzzResultsRows,
} from './HudSlots';
import { drawBiobuzzBalls } from './draw';
import { drawBiobuzzField } from './drawField';
import { drawBiobuzzRobot } from './drawRobot';
import { bbConfigSummary, bbStatTiles } from './labels';
import { BB_PRESET_LIST, BB_REAL_PRESETS, bbPresetLines, bbSpecMatches } from './presets';
import { BIOBUZZ_SIM } from './sim';
import { BiobuzzStartEditor } from './StartEditor';
import { BIOBUZZ_TUTORIAL } from './tutorial';

/**
 * BIOBUZZ as a full (CLIENT) `GameModule` — the DOM-free `BIOBUZZ_SIM` plus every
 * browser-owned slot: the three renderers, the builder, the robot schematic, the two live-HUD
 * slots, the results breakdown, the config summary and the scene gallery's dev route.
 *
 * FILLING the slots rather than threading `game === 'biobuzz'` through the shared screens is
 * the whole point of them, and `src/games/module.ts` carries the argument: before they
 * existed, `Menu.tsx` alone had ~16 `isDecode` gates and a third game had to be hand-threaded
 * into every one, in files two other people edit at the same time. DECODE's and CR's inline
 * branches stay untouched — each consumer wires a slot as
 * `mod.X ? <the slot> : <the existing branch, unchanged>`.
 *
 * WHAT IS DELIBERATELY NOT FILLED, each an absence rather than an omission:
 *  • `drawOverlays` — the slot draws between the field and the robots (DECODE's ramp strips).
 *    BIOBUZZ has no published structure to underlay: Section 9 (ARENA) is a Kickoff
 *    placeholder, so the field is four walls and a tile grid. A no-op costs a call per frame
 *    and tells the next reader there is something to see. It lands with the geometry.
 */
export const BIOBUZZ_MODULE: GameModule = {
  ...BIOBUZZ_SIM,
  // ---- renderers. The scene gallery draws through these same three functions, which is what
  // makes a gallery cell evidence about the real game screen rather than about a second
  // drawing kept in sync by hand.
  drawField: drawBiobuzzField,
  drawRobot: drawBiobuzzRobot,
  drawBalls: drawBiobuzzBalls,
  // ---- UI slots ----
  Builder: BiobuzzBuilderSlot,
  /**
   * THE ROBOT SCHEMATIC — and, where the host allows it, the live 3D turntable
   * (`docs/roadmap.md` item 1). `BiobuzzPreview3D` wraps `BiobuzzRobotPreview`: without the
   * host's `allow3d` it IS the schematic, byte for byte what this slot was before.
   */
  Preview: BiobuzzPreview3D,
  /** the saved-robot card's body: a 3D thumbnail on the 3D view, the build summary on the 2D
   * one. See `GameModule.savedCard` for why the GAME makes that choice and not the menu. */
  savedCard: BiobuzzSavedCard,
  hudChips: BiobuzzHudChips,
  scoreBar: BiobuzzScoreBar,
  resultsRows: biobuzzResultsRows,
  labels: { configSummary: bbConfigSummary },
  // THE START EDITOR. Empty, Configure fell into Chain Reaction's editor and the 2v2 lobby and
  // strategy screens into DECODE's; this one draws the BIOBUZZ field and judges G304 with
  // `bbEvalStart`, with TOP / BOTTOM roles.
  startEditor: BiobuzzStartEditor,
  // no auto-fire: the driver fires, and Aim Assist only releases a shot that would land
  offersAutoFire: false,
  /**
   * THE BUILDER HERO'S PER-GAME TILES. The second instance of the preset bug, and the same
   * shape of fix: the hero picked its mechanism tiles with `isDecode ? … : …`, so BIOBUZZ fell
   * into the CHAIN arm and showed a **CATALYST** — Chain Reaction's mechanism, off a field
   * `coerceBiobuzzSpec` deletes. This says launcher and lift, which is what a BIOBUZZ robot has.
   */
  statTiles: bbStatTiles,
  /**
   * THE HUMAN PLAYER BUTTON on a touch screen (G426) — this slot's first filler.
   *
   * It was listed above as deliberately EMPTY, on the grounds that the shell's only actions
   * were intake and fire. That stopped being true twice: the lift and the place button are
   * held/edge mechanisms with their own keybinds, and NECTAR entry became a driver action
   * rather than a timer. The note also said a new action needs a `GameSettings.mobileLayout`
   * key and a protocol bit — it does, and `bbNectar` now has both (`MobileLayout.bbNectar`,
   * `BTN_BBNECTAR`), which is what makes this a slot fill rather than a cross-lane request.
   *
   * NO `present` PREDICATE, and that is a statement rather than an oversight. Every other
   * conditional button on this pad asks "does this BUILD have the mechanism" — a claw-only
   * catalyst has nothing to throw. The human player is not hardware: every BIOBUZZ robot's
   * alliance has one, so there is no build that should be missing the button. Whether a press
   * would DO anything right now (stock left, an entry owed, the field live) changes several
   * times a match and is answered in the HUD by `nectarWhy`, not by a button appearing and
   * vanishing under the driver's thumb.
   *
   * ONE BUTTON FOR THE ALLIANCE, pressed through whichever robot this phone is driving: the
   * rule is per-alliance and `play.ts` takes the first rising edge among the alliance's robots
   * each tick.
   */
  mobileButtons: [
    {
      name: 'bbNectar',
      label: 'NECTAR',
      glyph: '⬗',
      cls: 'bbnectar',
      primary: false,
      field: 'bbNectar',
    },
  ],
  /**
   * THE PRESET CARDS. Filling this slot is what makes `BB_PRESETS` reachable at all: the
   * builder's `Presets` section chose its list with `isDecode ? ROBOT_PRESETS : CHAIN_PRESETS`,
   * so BIOBUZZ did not fall through to "no presets" — it fell into the CHAIN arm and offered
   * Chain Reaction's nine robots, described in Chain Reaction's words, while this game's own
   * four were reachable only as `BB_PRESETS[0]` inside `BB_DEFAULT_SPEC`.
   */
  presets: {
    list: BB_PRESET_LIST,
    matches: bbSpecMatches,
    lines: bbPresetLines,
    realCount: BB_REAL_PRESETS,
  },
  /**
   * THE SCENE GALLERY, alpha-only — `devRoutesEnabled()` gates it inside `devRouteFor`, so a
   * stable build neither routes to it nor renders it.
   *
   * `/gallery/*`, not `/gallery`: every grid cell links to `/biobuzz/gallery/<scene>` for the
   * drivable view of one scene, and `devRouteFor` matches a route's `path` against the
   * game-stripped remainder of the URL. A bare `/gallery` entry would drop every sub-path
   * through to `parseScreen`, which sends an unknown path home — so the trailing `/*` is what
   * makes a pasted scene link actually open. Seventy scenes is not seventy route entries.
   */
  devRoutes: [{ path: '/gallery/*', Component: BiobuzzGallery }],
  // no score HUD (nothing is scored) and no start editor (no legality model). `intakes` is the
  // SHARED preset list, which is what the shared builder would offer; BIOBUZZ's own sweeper
  // dials live in `Builder` and the slot above is what actually renders.
  ui: { showScoreHud: false, startEditor: false, intakes: ['sloped', 'vector'] },
  // THE TUTORIAL (roadmap item 6). Content only — the engine is `src/tutorial/` and the thing
  // that drives it is `GameController`. Read `./tutorial.ts`'s header before editing a step:
  // every `stage` runs at WORLD CONSTRUCTION, which is what keeps the replay invariant intact.
  tutorial: BIOBUZZ_TUTORIAL,
  /**
   * THE LAZY 3D SCENE (Day 1 seam, `docs/biobuzz/plan-3d.md` §2.3/§2.5/§10). A FUNCTION that
   * resolves to the factory — never the factory itself — so `scene/renderScene.ts` (and the
   * `three` it imports) is only ever pulled into a chunk the moment a player actually mounts a
   * 3D BIOBUZZ view; a player who stays on the 2D view, or plays DECODE/Chain Reaction, never
   * downloads it. `scene/` is reachable ONLY through this one dynamic `import()` — see
   * `scripts/smoke-biobuzz/render.ts`'s import-boundary checks.
   */
  scene: () => import('./scene/renderScene').then((m) => m.createBiobuzzScene),
  /**
   * THE ROBOT-BUILDER TURNTABLE, out of the SAME chunk (`docs/roadmap.md` item 1).
   *
   * ⚠️ THE SPECIFIER IS `./scene/renderScene`, NOT `./scene/renderPreview`, AND THAT IS THE
   * POINT. One dynamic specifier is one Rollup chunk. Two would make three.js a hoisted shared
   * chunk with a thin facade either side — and a facade contains none of the marker strings
   * `scripts/bundleaudit.mjs` routes the `scene` budget by, so both would land in `other` and
   * fail the audit for a reason that has nothing to do with size. `renderScene.ts` re-exports
   * the preview factory; its header carries the same note.
   */
  previewScene: () => import('./scene/renderScene').then((m) => m.createRobotPreviewScene),
};
