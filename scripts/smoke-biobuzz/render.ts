/**
 * RENDER lane — the 3D scene chunk's import-boundary rules (Day 1, `docs/biobuzz/plan-3d.md`
 * §2.3, §2.5, §9). Pure SOURCE checks, no DOM and no `three` import here: this lane proves the
 * CHUNK BOUNDARY is honoured by reading files as text, the same style as `scripts/smoke.ts`'s
 * own SOURCE GUARD block (~line 14474) — a grep, deliberately, because "don't write this" can
 * only be checked by reading the source, not by running it.
 *
 * Kept fast on purpose (a handful of `readFileSync` calls over a few dozen files): this lane
 * never boots physics or steps a world.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { moduleFor } from '../../src/games';
import { hiveCellTarget } from '../../src/games/biobuzz/elements';
import { bbSolveShot } from '../../src/games/biobuzz/robot';
import { BB_LAUNCH_Z0 } from '../../src/games/biobuzz/config';
import { GRAVITY } from '../../src/config';
import { ARC_MAX, arcBuffer, LANDING, solveLanding } from '../../src/games/biobuzz/scene/renderLanding';
import { CAMERA_PREFS, getCameraPref } from '../../src/games/biobuzz/graphics/store';
import {
  GFX_PIXEL_BUDGET,
  GFX_PRESETS,
  GFX_TIERS,
  getGraphics,
  resetGraphicsToAuto,
  setGraphicsTier,
  coerceGraphicsSettings,
  effectivePixelRatio,
  frameIntervalMs,
  matchesPreset,
  msaaSamples,
  shadowMapSize,
} from '../../src/games/biobuzz/graphics/settings';
import {
  SLIP_MS,
  SLIP_WINDOW_MS,
  STALL_MS,
  WARMUP_DOWN_MS,
  WARMUP_MS,
  WARMUP_UP_MS,
  createQualityGovernor,
  firstGuess,
  p95,
  stepTier,
  type GpuProbe,
} from '../../src/games/biobuzz/graphics/auto';
import { BB_ENVIRONMENTS, environmentDef, hdriEnvironments } from '../../src/games/biobuzz/graphics/environments';
import { THIRD_PARTY } from '../../src/contributors';
import { Renderer } from '../../src/render/renderer';
import type { ScoreTarget } from '../../src/games/biobuzz/state';
import type { Check } from './harness';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIOBUZZ_DIR = join(root, 'src', 'games', 'biobuzz');
const SCENE_DIR = join(BIOBUZZ_DIR, 'scene');

/** every `.ts`/`.tsx` file under `dir`, recursively, as paths relative to the repo root. */
function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...walkTs(p));
      continue;
    }
    if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** `p`, relative to the repo root, forward-slashed regardless of platform — a Windows
 * checkout must not turn a path-prefix assertion into a false negative. */
function relPosix(p: string): string {
  return relative(root, p).split('\\').join('/');
}

/** strip line and block comments the crude way `smoke.ts`'s own guard does — good enough for a
 * grep whose false positives would only be inside a comment describing the very string. */
function codeLines(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, ''));
}

export function renderChecks(check: Check): void {
  const allFiles = walkTs(BIOBUZZ_DIR);
  const sceneFiles = allFiles.filter((p) => p.startsWith(SCENE_DIR + '\\') || p.startsWith(SCENE_DIR + '/'));

  check('scene/ actually has files (else every check below is vacuous)', sceneFiles.length > 0, String(sceneFiles.length));

  // ---- every file under scene/ is named render*.ts ---------------------------------------
  const badNames = sceneFiles.filter((p) => !/^render[^/\\]*\.ts$/.test(relative(SCENE_DIR, p)));
  check(
    'every file under src/games/biobuzz/scene/ is named render*.ts',
    badNames.length === 0,
    badNames.map(relPosix).join(', '),
  );

  // ---- `from 'three'` (or `import('three')`) appears ONLY under scene/ -------------------
  const threeRx = /from\s+['"]three['"]|import\(\s*['"]three['"]\s*\)/;
  const threeOutside: string[] = [];
  const threeInside: string[] = [];
  for (const p of allFiles) {
    const inScene = sceneFiles.includes(p);
    codeLines(p).forEach((line, i) => {
      if (!threeRx.test(line)) return;
      (inScene ? threeInside : threeOutside).push(`${relPosix(p)}:${i + 1}`);
    });
  }
  check('every scene/ render file that uses three.js actually imports it (else the next check is vacuous)', threeInside.length > 0);
  check("'three' is imported ONLY by files under scene/", threeOutside.length === 0, threeOutside.join(', '));

  // ---- nothing outside index.ts imports from ./scene, and index.ts only dynamically ------
  const sceneImportRx = /from\s+['"](\.\/)?scene(\/[^'"]*)?['"]|import\(\s*['"]\.\/scene[^'"]*['"]\s*\)/;
  const staticSceneImports: string[] = [];
  const dynamicSceneImports: string[] = [];
  for (const p of allFiles) {
    if (sceneFiles.includes(p)) continue; // files inside scene/ importing each other are fine
    codeLines(p).forEach((line, i) => {
      if (!sceneImportRx.test(line)) return;
      const loc = `${relPosix(p)}:${i + 1}`;
      if (/import\(/.test(line)) dynamicSceneImports.push(loc);
      else staticSceneImports.push(loc);
    });
  }
  check(
    'nothing outside scene/ imports it STATICALLY',
    staticSceneImports.length === 0,
    staticSceneImports.join(', '),
  );
  // ⚠️ TWO SLOTS, ONE SPECIFIER. `index.ts` fills `scene` (the match view) and `previewScene`
  // (the robot-builder turntable, `docs/roadmap.md` item 1), and BOTH write
  // `import('./scene/renderScene')` — the preview factory is re-exported from there rather than
  // imported by its own path. That is not tidiness: one dynamic specifier is ONE Rollup chunk, and
  // two would hoist three.js into a shared chunk with a thin facade either side. A facade carries
  // none of the marker strings `scripts/bundleaudit.mjs` routes the `scene` budget by, so both
  // would land in `other` and fail that audit for a reason with nothing to do with size. So the
  // rule is: every dynamic scene import is in `index.ts`, and they all name the same module.
  check(
    'every dynamic import(\'./scene/...\') is in index.ts',
    dynamicSceneImports.length > 0 && dynamicSceneImports.every((l) => l.startsWith('src/games/biobuzz/index.ts:')),
    dynamicSceneImports.join(', '),
  );
  {
    const indexSrc = readFileSync(join(BIOBUZZ_DIR, 'index.ts'), 'utf8');
    const specifiers = new Set(
      [...indexSrc.matchAll(/import\(\s*['\"](\.\/scene\/[^'\"]*)['\"]\s*\)/g)].map((m) => m[1]),
    );
    check(
      'and they all name ONE module, so the chunk stays one measurable file',
      specifiers.size === 1 && specifiers.has('./scene/renderScene'),
      [...specifiers].join(', '),
    );
  }

  // ---- THE 3D PHYSICS IMPORT BOUNDARY — the other half of the same rule ------------------
  //
  // `three` is kept out of the main chunk by the checks above. THIS is the same statement about
  // `sim3d/`, and it is here because it shipped broken: `step.ts` imported `step3d` directly and
  // `scene/renderField.ts` imported two helpers out of `hive3d.ts`/`bodies.ts`, so the whole 3D
  // implementation — bodies, the CAD collider set, derive, the gameplay passes, the predictors,
  // ~225 KB of source — was statically reachable from the entry and landed in the MAIN chunk,
  // which every player of every game downloads to play a 2D match. `npm run bundleaudit` is what
  // MEASURES that (it reads a real build); this is what NAMES the file, in `npm test`, before a
  // build is run at all.
  //
  // THE RULE: only the LIGHT seam may be imported from outside `sim3d/`.
  //   engine.ts  — the loader (`initPhysics3d`/`physics3dReady`/`rapier3d`/`physics3dImpl`)
  //   tilt.ts    — `hiveTiltAngle`/`hiveTrayRefTheta`, pure JSON, for a 3D VIEW of a 2D match
  //   step3d.ts  — the one-line gate `step.ts` dispatches through
  // `scene/` gets ONE extra: `fieldColliders.ts`, the CAD geometry the GLB loader reads. That is
  // a real shared dependency of two LAZY chunks (the scene and the physics implementation), so it
  // costs the main chunk nothing — see `scripts/bundleaudit.mjs`, which routes it.
  {
    const SIM3D_DIR = join(BIOBUZZ_DIR, 'sim3d');
    const inDir = (p: string, dir: string): boolean => p.startsWith(dir + sep) || p.startsWith(dir + '/');
    const LIGHT = new Set(['engine', 'tilt', 'step3d']);
    const SCENE_EXTRA = new Set(['fieldColliders']);
    const srcFiles = walkTs(join(root, 'src'));
    const heavyImports: string[] = [];
    let lightImports = 0;
    for (const p of srcFiles) {
      if (inDir(p, SIM3D_DIR)) continue; // sim3d/ importing itself is the whole point of sim3d/
      const inScene = inDir(p, SCENE_DIR);
      codeLines(p).forEach((line, i) => {
        for (const m of line.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]*sim3d\/[A-Za-z0-9_.]+)['"]/g)) {
          const name = m[1].slice(m[1].lastIndexOf('sim3d/') + 'sim3d/'.length);
          if (LIGHT.has(name) || (inScene && SCENE_EXTRA.has(name))) {
            lightImports++;
            continue;
          }
          heavyImports.push(`${relPosix(p)}:${i + 1} (sim3d/${name})`);
        }
      });
    }
    check('the import-boundary scan sees sim3d imports at all (else the next check is vacuous)', lightImports > 0, String(lightImports));
    check(
      'nothing under src/ outside sim3d/ imports a HEAVY sim3d module (engine, tilt, step3d only)',
      heavyImports.length === 0,
      heavyImports.join(', '),
    );

    // and the seam is only light because its OWN imports are: a `from './bodies'` added to any of
    // the three would put the implementation straight back where it was, and pass the check above.
    const seamLeaks: string[] = [];
    for (const name of LIGHT) {
      codeLines(join(SIM3D_DIR, `${name}.ts`)).forEach((line, i) => {
        for (const m of line.matchAll(/from\s*['"]\.\/([A-Za-z0-9_.]+)['"]/g)) {
          if (!LIGHT.has(m[1])) seamLeaks.push(`sim3d/${name}.ts:${i + 1} -> ./${m[1]}`);
        }
      });
    }
    check('the LIGHT seam itself statically imports no other sim3d module', seamLeaks.length === 0, seamLeaks.join(', '));

    // the barrel: reached ONLY by the loader, and only through `import()`.
    const implRefs: string[] = [];
    let allDynamicInLoader = true;
    for (const p of srcFiles) {
      codeLines(p).forEach((line, i) => {
        if (!/(?:from|import)\s*\(?\s*['"](?:[^'"]*sim3d\/impl|\.\/impl)['"]/.test(line)) return;
        const loc = `${relPosix(p)}:${i + 1}`;
        implRefs.push(loc);
        if (!/import\s*\(/.test(line) || !loc.startsWith('src/games/biobuzz/sim3d/engine.ts:')) allDynamicInLoader = false;
      });
    }
    check(
      "sim3d/impl.ts is reached ONLY by engine.ts, and only through import()",
      implRefs.length > 0 && allDynamicInLoader,
      implRefs.join(', '),
    );

    // …and every heavy module is IN the barrel, so a new one cannot be orphaned outside the
    // lazy chunk (or, worse, pulled in by whoever happens to import it first).
    const starred = new Set(
      [...readFileSync(join(SIM3D_DIR, 'impl.ts'), 'utf8').matchAll(/export \* from '\.\/([A-Za-z0-9_.]+)'/g)].map((m) => m[1]),
    );
    const missing = readdirSync(SIM3D_DIR)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => f.slice(0, -3))
      .filter((n) => !LIGHT.has(n) && n !== 'impl' && n !== 'fieldColliders.gen' && !starred.has(n));
    check('sim3d/impl.ts re-exports every heavy sim3d module (a new one has to join the barrel)', missing.length === 0, missing.join(', '));
  }

  // ---- BOTH RENDERERS DRAW THE CAD'S OWN TAPE AND THE CAD'S OWN TILE SEAMS ----------------
  //
  // A SOURCE check, because the failure it guards is a renderer drawing something that is not on
  // the field, and no headless run of the sim can see a canvas. Two specific regressions, both of
  // which shipped:
  //
  //  - TAPE AS AN OUTLINE OF THE ZONE. `strokeRect(BB_LZ[a], ...)` / `strokeRectTex(...)` paints
  //    all FOUR edges of a zone rectangle, including the one that is a perimeter WALL and carries
  //    no tape on the real field, and it turns the GARDEN's solid 2-in band into a 1-in outline
  //    of a 2-in rectangle. `BB_TAPE` is the CAD's own 16 measured strips; both renderers draw it.
  //  - THE 24-IN TILE GRID. `C.TILE` is 24, which is DECODE's and Chain Reaction's nominal tile.
  //    A real FTC soft tile is 23.528 on centre (`BB_TILE_PITCH`), so a grid stepped by 24 drifts
  //    almost half an inch per tile away from the tape, the flowers and the GLB. Both renderers
  //    draw `BB_TILE_SEAMS`, the seven measured seam lines.
  {
    const renderers = ['src/games/biobuzz/drawField.ts', 'src/games/biobuzz/scene/renderField.ts'];
    for (const rel of renderers) {
      const src = readFileSync(join(root, rel), 'utf8');
      check(`${rel} draws the CAD tape strips (BB_TAPE), not an outline of a zone rectangle`, src.includes('BB_TAPE.loadingZone') && src.includes('BB_TAPE.garden'), rel);
      check(`${rel} draws the CAD tile seams (BB_TILE_SEAMS)`, src.includes('BB_TILE_SEAMS'), rel);
      const code = codeLines(join(root, rel)).map((l, i) => ({ l, i })).filter((r) => /\bC\.TILE\b/.test(r.l));
      check(
        `${rel} does NOT step a grid by the shared C.TILE (24in is not this field's tile)`,
        code.length === 0,
        code.map((r) => `${rel}:${r.i + 1}`).join(', '),
      );
    }
  }

  // ---- the seam itself: GameModule.scene is a function ------------------------------------
  const mod = moduleFor('biobuzz');
  check('biobuzz fills the GameModule.scene slot, and it is a function', typeof mod.scene === 'function');
  check('decode does NOT fill it (no 3D renderer)', moduleFor('decode').scene === undefined);
  check('chain does NOT fill it (no 3D renderer)', moduleFor('chain').scene === undefined);

  // ══ DAY 2 ═══════════════════════════════════════════════════════════════════════════════

  // ---- THE RETICLE'S BALLISTICS, IN NUMBERS ----------------------------------------------
  //
  // `renderLanding.ts` is a duplicate of `play.ts`'s `bbFlightEnters` integrator, because that
  // one answers a BOOLEAN and a ring needs a POSITION (see its header). A duplicate that drifts
  // is invisible on screen — the ring looks equally convincing wherever it is drawn, and a
  // driver aims by it — so it is checked here against closed-form ballistics and against the
  // field's own geometry instead.
  //
  // The tolerances are the EULER error the sim itself carries: both loops step at `SIM_DT` with
  // explicit Euler, so a 45° lob lands ~3% long compared with the exact parabola. That is the
  // sim's answer, and matching the sim is the whole requirement — a "more accurate" reticle
  // would be a reticle that disagrees with where the element goes.
  {
    /** a target the arc can never reach, so the solve runs to the FLOOR branch. */
    const noTarget: ScoreTarget = { id: 'none', alliance: null, pos: { x: 1e4, y: 1e4 }, z: 1e4, r: 0 };

    check(
      'reticle: a straight-up shot lands back where it left (floor branch, exact in x/y)',
      solveLanding(7, -3, 10, 0, 0, 100, noTarget) &&
        Math.abs(LANDING.x - 7) < 1e-9 &&
        Math.abs(LANDING.y + 3) < 1e-9 &&
        LANDING.z === 0,
      `${LANDING.x.toFixed(3)}, ${LANDING.y.toFixed(3)}, ${LANDING.z.toFixed(3)}`,
    );

    const v = 100;
    const ang = Math.PI / 4;
    const vh = Math.cos(ang) * v;
    const vz = Math.sin(ang) * v;
    const z0 = 6;
    solveLanding(0, 0, z0, vh, 0, vz, noTarget);
    const eulerRange = LANDING.x;
    const exact = (vh * (vz + Math.sqrt(vz * vz + 2 * GRAVITY * z0))) / GRAVITY;
    check(
      'reticle: a 45° lob lands within 5% of the closed-form range (the sim’s own Euler error)',
      LANDING.ok && Math.abs(eulerRange - exact) / exact < 0.05,
      `euler ${eulerRange.toFixed(2)} vs exact ${exact.toFixed(2)}`,
    );
    const arcAt = LANDING.arc - 1;
    check(
      'reticle: the arc’s LAST vertex is the landing point, and the count is inside the buffer',
      LANDING.arc >= 2 &&
        LANDING.arc <= ARC_MAX &&
        Math.abs(arcBuffer[arcAt * 3] - LANDING.x) < 1e-6 &&
        Math.abs(arcBuffer[arcAt * 3 + 2] - LANDING.z) < 1e-6,
      `arc ${LANDING.arc} of ${ARC_MAX}`,
    );

    solveLanding(0, 0, z0, -vh, 0, vz, noTarget);
    check(
      'reticle: the mirrored shot lands mirrored (no sign asymmetry in the integrator)',
      Math.abs(LANDING.x + eulerRange) < 1e-9,
      LANDING.x.toFixed(4),
    );

    // THE SHOT THE SIM WOULD TAKE, at the cell it would take it at: `bbSolveShot`'s minimum-speed
    // pair aimed at a real `hiveCellTarget` has to come down THROUGH that cell's opening plane,
    // inside its accept radius — this is the check that ties the ring to the game's own aiming.
    const cell = hiveCellTarget('red', 'north');
    const d = 60;
    const sol = bbSolveShot(d, cell.z - BB_LAUNCH_Z0);
    const hit = solveLanding(
      cell.pos.x + d,
      cell.pos.y,
      BB_LAUNCH_Z0,
      -Math.cos(sol.angle) * sol.speed,
      0,
      Math.sin(sol.angle) * sol.speed,
      cell,
    );
    const miss = Math.hypot(LANDING.x - cell.pos.x, LANDING.y - cell.pos.y);
    check(
      'reticle: the sim’s own solved shot lands ON the CELL’s opening plane, inside its radius',
      hit && LANDING.z === cell.z && miss <= cell.r,
      `z ${LANDING.z.toFixed(2)} vs ${cell.z.toFixed(2)}, miss ${miss.toFixed(2)} of r ${cell.r}`,
    );

    // HALF that speed cannot reach it: the ring has to fall on the FLOOR short of the hive, not
    // stay pinned to the target. A reticle that always shows the target is not a reticle.
    const short = solveLanding(
      cell.pos.x + d,
      cell.pos.y,
      BB_LAUNCH_Z0,
      -Math.cos(sol.angle) * sol.speed * 0.5,
      0,
      Math.sin(sol.angle) * sol.speed * 0.5,
      cell,
    );
    check(
      'reticle: an under-speed shot falls SHORT, on the floor, not on the target',
      short && LANDING.z === 0 && LANDING.x > cell.pos.x + 1,
      `landed x ${LANDING.x.toFixed(2)} (cell x ${cell.pos.x.toFixed(2)}), z ${LANDING.z}`,
    );

    check(
      'reticle: a shot still airborne after four seconds reports NO landing (nothing is drawn)',
      !solveLanding(0, 0, 10, 0, 0, 900, noTarget) && !LANDING.ok,
    );
  }

  // ---- the four cameras, the preference, and the projection hook --------------------------
  {
    const moduleSrc = readFileSync(join(root, 'src', 'games', 'module.ts'), 'utf8');
    check(
      "SceneCamera carries all four cameras ('driver' | 'overhead' | 'chase' | 'orbit')",
      /export type SceneCamera[^;]*'driver'[^;]*'overhead'[^;]*'chase'[^;]*'orbit'/s.test(moduleSrc),
    );
    check(
      'GameScene declares the optional project() hook (the 3D overlay’s only way to place a label)',
      /project\?\(x: number, y: number, z: number, out:/.test(moduleSrc),
    );

    const sceneSrc = readFileSync(join(SCENE_DIR, 'renderScene.ts'), 'utf8');
    check('renderScene.ts IMPLEMENTS project()', /\n {2}project\(x: number, y: number, z: number, out:/.test(sceneSrc));
    check(
      'renderScene.ts resolves the DEVICE camera preference over the frame’s camera',
      sceneSrc.includes('resolvedCamera') && sceneSrc.includes('getCameraPref'),
    );
    check(
      'renderScene.ts re-reads the backdrop on a theme change (not once at creation)',
      sceneSrc.includes("attributeFilter: ['data-theme']") && sceneSrc.includes('readBackdropColor()'),
    );

    // the 2D overlay pass must ASK the scene where a point is — the whole point of the hook
    const rendererSrc = readFileSync(join(root, 'src', 'render', 'renderer.ts'), 'utf8');
    check('Renderer takes a scene (setScene) and projects the overlay through it', typeof Renderer.prototype.setScene === 'function' && rendererSrc.includes('scene.project'));

    check(
      'the camera preference defaults to auto (no localStorage in Node ⇒ never throws)',
      getCameraPref() === 'auto',
    );
    check(
      'every non-auto camera preference is a real SceneCamera',
      CAMERA_PREFS[0] === 'auto' &&
        CAMERA_PREFS.slice(1).every((p) => moduleSrc.includes(`'${p}'`)) &&
        CAMERA_PREFS.length === 5,
      CAMERA_PREFS.join('|'),
    );
  }

  // ---- the HUD scrim's class is spelled the same in BOTH files ---------------------------
  //
  // A SOURCE check because the class name is the entire contract between `GameView.tsx` and
  // `styles.css`, and renaming it in one file leaves the other silently doing nothing — the HUD
  // would simply go back to its 2D styling over a lit 3D field, which looks like a design choice
  // rather than a break.
  {
    const css = readFileSync(join(root, 'src', 'ui', 'styles.css'), 'utf8');
    const view = readFileSync(join(root, 'src', 'ui', 'GameView.tsx'), 'utf8');
    check('styles.css scrims the HUD bands in the 3D view (.game-root.view-3d [data-hud-band])', css.includes('.game-root.view-3d [data-hud-band]'));
    check('GameView puts `view-3d` on .game-root when a scene canvas is live', view.includes("'game-root view-3d'"));
  }

  graphicsChecks(check, allFiles);
}

/**
 * THE GRAPHICS SETTINGS (Day 3, `docs/biobuzz/plan-3d.md` §4.4-§4.7).
 *
 * All of it is either PURE (the preset table, the pixel budget, Auto's policy, the HDRI
 * catalogue) or a SOURCE assertion, for the same reason the rest of this lane is: a settings
 * model that decides what a GPU is asked to do can be checked without a GPU, and the parts that
 * cannot be (does a shadow map actually reallocate) are what the manual pass is for.
 */
function graphicsChecks(check: Check, allFiles: string[]): void {
  const GRAPHICS_DIR = join(BIOBUZZ_DIR, 'graphics');
  const graphicsFiles = allFiles.filter((p) => p.startsWith(GRAPHICS_DIR + '\\') || p.startsWith(GRAPHICS_DIR + '/'));

  // ---- the settings MODEL never reaches for a renderer ------------------------------------
  //
  // `graphics/` is imported by `src/ui/GraphicsSection.tsx` and by `src/contributors.ts`, both
  // of which are ordinary main-bundle screens. One `import * as THREE` in here would put the
  // whole renderer in the bundle a DECODE player downloads - the exact regression the scene
  // boundary above exists to prevent, one directory over.
  check('graphics/ has files (else every check below is vacuous)', graphicsFiles.length > 0, String(graphicsFiles.length));
  const threeInGraphics = graphicsFiles.filter((f) => /from\s+['"]three['"]/.test(readFileSync(f, 'utf8')));
  check('nothing under graphics/ imports three.js', threeInGraphics.length === 0, threeInGraphics.map(relPosix).join(', '));
  const sceneFromGraphics = graphicsFiles.filter((f) => /from\s+['"]\.\.\/scene\//.test(readFileSync(f, 'utf8')));
  check('nothing under graphics/ imports scene/', sceneFromGraphics.length === 0, sceneFromGraphics.map(relPosix).join(', '));

  // ---- the settings table, the load-bearing cells ----------------------------------------
  //
  // Not every cell - a table transcribed twice is a table that disagrees with itself twice as
  // often. These are the ones a preset would be WRONG without: the four that define what each
  // tier is for, plus the two the plan hedges (see `GFX_NOT_OFFERED`).
  check('Low renders at 75 % and caps at 60 fps', GFX_PRESETS.low.renderScale === 75 && GFX_PRESETS.low.maxFps === 60);
  check('Low has no shadows at all', GFX_PRESETS.low.shadows === 'off' && GFX_PRESETS.low.elementShadows === 'none');
  check('Medium is the first tier with the high-detail mesh', GFX_PRESETS.medium.meshDetail === 'high' && GFX_PRESETS.low.meshDetail === 'low');
  check(
    'High is the first tier with an HDRI, env lighting and reflections',
    GFX_PRESETS.high.environment !== 'room' &&
      GFX_PRESETS.high.envLighting &&
      GFX_PRESETS.high.reflections &&
      GFX_PRESETS.medium.environment === 'room' &&
      !GFX_PRESETS.medium.envLighting,
  );
  check(
    'Ultra is soft shadows, 16x filtering and the full effects set',
    GFX_PRESETS.ultra.shadows === 'soft' && GFX_PRESETS.ultra.anisotropy === 16 && GFX_PRESETS.ultra.effects === 'full',
  );
  check(
    'the PiP minimap is ON for Low/Medium and OFF for High/Ultra (the table, and it is a second pass)',
    GFX_PRESETS.low.minimap && GFX_PRESETS.medium.minimap && !GFX_PRESETS.high.minimap && !GFX_PRESETS.ultra.minimap,
  );
  check('no preset turns on a feature this build does not implement (AO)', GFX_TIERS.every((t) => GFX_PRESETS[t].ao === 'off'));
  check(
    'every preset is exactly itself (matchesPreset is the `custom` test and must not misfire)',
    GFX_TIERS.every((t) => matchesPreset(GFX_PRESETS[t], t)) && !matchesPreset({ ...GFX_PRESETS.high, shadows: 'off' }, 'high'),
  );

  // ---- the pixel budget actually binds ---------------------------------------------------
  //
  // The whole point of the budget is the case the render-scale slider cannot reach on its own:
  // a big window on a HiDPI panel. At 2560x1440 CSS with a 2x device ratio and the slider at
  // 200 %, the naive answer is a 4x ratio - 59 megapixels a frame. Low's budget is 0.6.
  {
    const r = effectivePixelRatio({ ...GFX_PRESETS.low, renderScale: 200 }, 'low', 2560, 1440, 2);
    const px = 2560 * 1440 * r * r;
    check('the tier pixel budget caps a 200 % scale on a HiDPI panel', px <= GFX_PIXEL_BUDGET.low * 1.001, `${(px / 1e6).toFixed(2)} MP`);
    const ultra = effectivePixelRatio({ ...GFX_PRESETS.ultra }, 'ultra', 1280, 720, 1);
    check('a small window at 100 % is NOT capped (the budget is a ceiling, not a target)', Math.abs(ultra - 1) < 1e-9, String(ultra));
    check(
      'the budgets are the spec table\u2019s own four numbers',
      GFX_PIXEL_BUDGET.low === 0.6e6 && GFX_PIXEL_BUDGET.medium === 1.2e6 && GFX_PIXEL_BUDGET.high === 2.2e6 && GFX_PIXEL_BUDGET.ultra === 4.0e6,
    );
  }

  // ---- a frame cap that halves the frame rate is the classic way to make things worse -----
  check(
    'the 60 fps cap leaves slack for a 16.67 ms vsync (else every other frame is dropped)',
    frameIntervalMs(60) < 1000 / 60 && frameIntervalMs(60) > 15.5,
    frameIntervalMs(60).toFixed(2),
  );
  check('display means no cap at all', frameIntervalMs(0) === 0);
  check('MSAA maps to a real sample count, and off means no render target', msaaSamples('off') === 0 && msaaSamples('msaa2') === 2 && msaaSamples('msaa4') === 4);
  check(
    'soft shadows reuse the high map size (they are a wider blur, not a fourth resolution)',
    shadowMapSize('soft') === shadowMapSize('high') && shadowMapSize('low') === 1024,
  );

  // ---- coercion: a stored blob from another build keeps what it can ------------------------
  {
    const stored = { shadows: 'off', aa: 'smaa', renderScale: 9999, fov: 12, nonsense: true };
    const out = coerceGraphicsSettings(stored, GFX_PRESETS.high);
    check('coercion keeps a value it understands', out.shadows === 'off');
    check('coercion drops a value it does not (an `aa` from a build that offered SMAA)', out.aa === GFX_PRESETS.high.aa);
    check('coercion clamps rather than resets (render scale, FOV)', out.renderScale === 200 && out.fov === 60, `${out.renderScale}/${out.fov}`);
    check('coercion of nothing at all is the base preset', matchesPreset(coerceGraphicsSettings(undefined, GFX_PRESETS.medium), 'medium'));
  }

  // ---- the first guess, and the two steps -------------------------------------------------
  {
    const base: GpuProbe = { renderer: '', vendor: '', adapter: '', memoryGb: 16, cores: 12, dpr: 1, webgl2: true, software: false };
    check('a software renderer is Low whatever else it says', firstGuess({ ...base, renderer: 'Google SwiftShader', software: true }) === 'low');
    check('no WebGL2 is Low', firstGuess({ ...base, webgl2: false }) === 'low');
    check('a discrete GPU with memory and cores behind it starts at Ultra', firstGuess({ ...base, renderer: 'NVIDIA GeForce RTX 4070' }) === 'ultra');
    check('the same GPU on a thin machine starts at High', firstGuess({ ...base, renderer: 'NVIDIA GeForce RTX 4070', memoryGb: 4, cores: 4 }) === 'high');
    check(
      'an integrated GPU is Medium, and Low once it is pushing a HiDPI panel',
      firstGuess({ ...base, renderer: 'Intel(R) UHD Graphics 620' }) === 'medium' &&
        firstGuess({ ...base, renderer: 'Intel(R) UHD Graphics 620', dpr: 2 }) === 'low',
    );
    check(
      'an unrecognised string is not a guess, it is Medium/High by the machine around it',
      firstGuess({ ...base, renderer: '', cores: 2, memoryGb: 2 }) === 'medium' && firstGuess(base) === 'high',
    );
    check('stepping clamps at both ends', stepTier('low', -1) === 'low' && stepTier('ultra', 1) === 'ultra' && stepTier('high', -1) === 'medium');
  }

  // ---- p95 is nearest-rank, and does not reorder the caller's buffer ----------------------
  {
    const samples = [5, 5, 5, 5, 5, 5, 5, 5, 5, 40];
    const copy = [...samples];
    check('p95 of ten samples is the worst one', p95(samples) === 40, String(p95(samples)));
    check('p95 does not mutate its input', samples.every((v, i) => v === copy[i]));
    check('p95 of nothing is 0, not NaN', p95([]) === 0);
    check('the three warm-up/slip thresholds are the spec\u2019s three numbers', WARMUP_DOWN_MS === 16.7 && WARMUP_UP_MS === 6 && SLIP_MS === 25);
  }

  // ---- THE GOVERNOR, on an injected clock -------------------------------------------------
  //
  // This is the one piece of the graphics lane with real BEHAVIOUR in it, and it is also the
  // one piece that cannot be watched in a browser an agent drives: `requestAnimationFrame` only
  // fires when something forces a paint, so a scripted session never produces the steady stream
  // of frames a two-second warm-up is measuring. The clock is a parameter for exactly this
  // reason (see `createQualityGovernor`'s own note), so the policy is driven here instead:
  // frames in, preset changes out.
  //
  // ⚠️ THESE CHECKS WRITE THE SHARED SETTINGS STORE, which is module state for the process.
  // Every block restores it, and the last line of the section resets it outright.
  {
    /** feed `frames` samples of `ms` each, one per `stepMs` of simulated wall clock. */
    const drive = (gov: { sample(ms: number): void }, clock: { t: number }, frames: number, ms: number, stepMs = 16): void => {
      for (let i = 0; i < frames; i++) {
        clock.t += stepMs;
        gov.sample(ms);
      }
    };

    // a slow machine on Auto steps DOWN once the warm-up window closes
    {
      setGraphicsTier('high', true);
      const clock = { t: 0 };
      const gov = createQualityGovernor(() => clock.t);
      drive(gov, clock, 200, 30);
      check('warm-up: over the 60 Hz budget steps the preset DOWN one', getGraphics().tier === 'medium', getGraphics().tier);
      check('warm-up: and it is still Auto afterwards (a measurement is not a choice)', getGraphics().preset === 'auto');
    }

    // a fast machine steps UP
    {
      setGraphicsTier('medium', true);
      const clock = { t: 0 };
      const gov = createQualityGovernor(() => clock.t);
      drive(gov, clock, 200, 3);
      check('warm-up: comfortably inside the budget steps the preset UP one', getGraphics().tier === 'high', getGraphics().tier);
    }

    // a HAND-PICKED preset is not moved by detection
    {
      setGraphicsTier('ultra', false);
      const clock = { t: 0 };
      const gov = createQualityGovernor(() => clock.t);
      drive(gov, clock, 200, 40);
      check('warm-up: a hand-picked preset is left alone', getGraphics().tier === 'ultra' && getGraphics().preset === 'ultra');
    }

    // a warm-up with almost no frames in it decides nothing
    {
      setGraphicsTier('high', true);
      const clock = { t: 0 };
      const gov = createQualityGovernor(() => clock.t);
      drive(gov, clock, 8, 90, 300);
      check('warm-up: too few frames to be a measurement decides nothing', getGraphics().tier === 'high');
    }

    // THE SLIP RULE: sustained, once, with a line
    {
      setGraphicsTier('ultra', true);
      const clock = { t: 0 };
      const lines: string[] = [];
      const gov = createQualityGovernor(() => clock.t, (l) => lines.push(l));
      drive(gov, clock, 200, 8); // a clean warm-up first (8 ms is inside the up threshold)
      const afterWarmup = getGraphics().tier;
      drive(gov, clock, 60, 40); // ~1 s of 40 ms frames: over the threshold, not yet sustained
      const midSlip = getGraphics().tier;
      drive(gov, clock, 250, 40); // past SLIP_WINDOW_MS
      check('slip: a second of bad frames is not enough (that is a hiccup, not a machine)', midSlip === afterWarmup, `${afterWarmup} -> ${midSlip}`);
      check('slip: a sustained one lowers the preset', getGraphics().tier === stepTier(afterWarmup, -1), getGraphics().tier);
      const once = getGraphics().tier;
      drive(gov, clock, 600, 60);
      check('slip: and it fires ONCE, however bad it gets after', getGraphics().tier === once, getGraphics().tier);
      check('slip: it writes exactly one line, and the line says what happened', lines.filter((l) => /lowered/i.test(l)).length === 1, lines.join(' | '));
    }

    // A BACKGROUNDED TAB IS NOT A SLOW MACHINE (the stall guard)
    {
      setGraphicsTier('ultra', true);
      const clock = { t: 0 };
      const lines: string[] = [];
      const gov = createQualityGovernor(() => clock.t, (l) => lines.push(l));
      drive(gov, clock, 200, 8);
      const before = getGraphics().tier;
      // ten "frames" a second apart, each measuring the whole second away - what an alt-tabbed
      // or paint-gated tab hands the governor
      drive(gov, clock, 10, 1000, 1000);
      check('stall: a tab that was not being drawn does not lower anything', getGraphics().tier === before, `${before} -> ${getGraphics().tier}`);
      check('stall: and it writes no line either', lines.filter((l) => /lowered/i.test(l)).length === 0, lines.join(' | '));
      check('stall: the guard sits well past any frame a human would sit through', STALL_MS >= 250 && STALL_MS < SLIP_WINDOW_MS, String(STALL_MS));
    }

    check('the warm-up window is the spec\u2019s two seconds', WARMUP_MS === 2000);
    resetGraphicsToAuto();
  }

  // ---- the environments, and that every fetched one is credited ---------------------------
  {
    check('the procedural room is first and costs nothing', BB_ENVIRONMENTS[0].id === 'room' && !BB_ENVIRONMENTS[0].hdri);
    check('there are exactly two HDRI sets on this build', hdriEnvironments().length === 2, String(hdriEnvironments().length));
    for (const e of hdriEnvironments()) {
      const h = e.hdri!;
      check(`${e.id}: a 1k .hdr on Poly Haven\u2019s CDN, never a bundled copy`, /^https:\/\/dl\.polyhaven\.org\/.*_1k\.hdr$/.test(h.url), h.url);
      check(
        `${e.id}: CC0, with a licence link and at least one named author`,
        h.license === 'CC0 1.0' && h.licenseUrl.startsWith('https://') && h.authors.length > 0 && h.authors.every((a) => !!a.name && !!a.role),
      );
      check(`${e.id}: the picker states what the download costs`, h.bytes > 1e6 && h.bytes < 4e6 && /MB/.test(e.note), e.note);
    }
    check('an unknown environment id falls back to the room rather than throwing', environmentDef('nope' as never).id === 'room');
    // THE CREDIT IS DERIVED, so a third HDRI cannot ship uncredited
    check(
      'every fetched environment is on the Contributors page',
      THIRD_PARTY.length === hdriEnvironments().length && THIRD_PARTY.every((t) => t.license === 'CC0 1.0' && t.credits.length > 0),
    );
  }

  // ---- nothing bundles an HDRI, which is the one rule stated as a byte count ---------------
  {
    const bundled = allFiles.filter((f) => !f.endsWith('environments.ts') && /\.hdr['"]/.test(readFileSync(f, 'utf8')));
    check('no source file imports or embeds an .hdr (they are fetched, never shipped)', bundled.length === 0, bundled.map(relPosix).join(', '));
  }

  // ---- the SOURCE contracts the settings depend on ----------------------------------------
  {
    const sceneSrc = readFileSync(join(SCENE_DIR, 'renderScene.ts'), 'utf8');
    check('the scene subscribes to the settings (a change applies without a rebuild)', sceneSrc.includes('subscribeGraphics'));
    check(
      'the WebGL context is created with antialias:false - MSAA is the render target\u2019s, which is what makes it live',
      /antialias:\s*false/.test(sceneSrc) && sceneSrc.includes('WebGLRenderTarget'),
    );
    check('the shadow map is DISPOSED when its size changes (else low to high does nothing)', /this\.sun\.shadow\.map\?\.dispose\(\)/.test(sceneSrc));
    check('a software renderer selects the 2D view before it throws', sceneSrc.includes("setViewPref('2d')") && sceneSrc.includes('SceneUnsupportedError'));
    // the renderer ITSELF is built by `renderCore.ts`'s shared factory now (the builder preview
    // builds one the same way), so the attribute lives there — the `antialias: false` above is
    // still this file's own call site, which is the half that is a decision rather than plumbing.
    const coreSrc = readFileSync(join(SCENE_DIR, 'renderCore.ts'), 'utf8');
    check(
      'powerPreference high-performance on both the probe and the renderer',
      coreSrc.includes('high-performance') && readFileSync(join(GRAPHICS_DIR, 'auto.ts'), 'utf8').includes('high-performance'),
    );
    // ONE light rig, shared. The preview is not allowed to pick its own exposure or its own fill:
    // a robot lit differently in the builder than in the match is the drift roadmap item 1 names.
    check(
      'the light rig is CONSTANTS in renderCore.ts, not literals in either scene',
      /export const SCENE_EXPOSURE/.test(coreSrc) &&
        sceneSrc.includes('createSceneLights()') &&
        sceneSrc.includes('SCENE_HEMI_INTENSITY') &&
        !/new THREE\.HemisphereLight\(/.test(sceneSrc),
    );

    const moduleSrc = readFileSync(join(root, 'src', 'games', 'module.ts'), 'utf8');
    check(
      'GameSceneFactory takes OPTIONAL options (additive: an existing one-argument caller is unchanged)',
      /options\?: SceneOptions/.test(moduleSrc) && /onQualityEvent\?\(line: string\)/.test(moduleSrc),
    );

    // the view key cannot live in the scene - that is the bug it was moved out to fix
    const keySrc = readFileSync(join(GRAPHICS_DIR, 'viewKey.ts'), 'utf8');
    check('the view key is outside the scene and toggles BOTH ways', keySrc.includes("=== '3d' ? '2d' : '3d'"));
    check('the scene no longer binds `t` itself (it could only ever go 3D to 2D)', !/case 't':/.test(sceneSrc));
    check('one shared listener, reference-counted (three hosts may hold it at once)', keySrc.includes('refs++') && keySrc.includes('attachedTo'));

    const replaySrc = readFileSync(join(root, 'src', 'ui', 'ReplayView.tsx'), 'utf8');
    check('the export menu picks a view and a camera', replaySrc.includes('exportView') && replaySrc.includes('exportCam') && replaySrc.includes("'chase'"));
    check('a 3D export is fixed at High and binds no input', replaySrc.includes("quality: 'high'") && replaySrc.includes('interactive: false'));
    check(
      'the 3D export composites scene, then the overlay, then both onto the frame, then the burn-in',
      replaySrc.indexOf('scene.render(shot.world, sceneFrame)') <
        replaySrc.indexOf('rend.render(overlayCtx, shot.world, null, localId, true)') &&
        replaySrc.indexOf('rend.render(overlayCtx, shot.world, null, localId, true)') < replaySrc.indexOf('drawImage(scene.element') &&
        replaySrc.indexOf('drawImage(scene.element') < replaySrc.lastIndexOf('drawReplayHud'),
    );
    // ⚠️ THE ONE THAT SHIPPED BLACK FRAMES. `Renderer.render(..., overlayOnly)` opens with a
    // `clearRect` over the whole canvas — right for the live view, where the 2D canvas is a
    // separate sheet above the WebGL one, and fatal in an export if both aim at the same canvas.
    check(
      'the overlay pass has a canvas of its own (it CLEARS, and would wipe the 3D frame)',
      /overlayCtx\s*=\s*overlay\.getContext\('2d'\)/.test(replaySrc) && replaySrc.includes("ctx.drawImage(overlay, 0, 0)"),
    );

    const configureSrc = readFileSync(join(root, 'src', 'ui', 'Configure.tsx'), 'utf8');
    check('Configure routes a Graphics section', configureSrc.includes("'graphics'") && configureSrc.includes('GraphicsSection'));
    check(
      'the Graphics section is LAZY (16 3D settings are not in a DECODE player\u2019s bundle)',
      /lazy\(\(\) => import\('\.\/GraphicsSection'\)/.test(configureSrc),
    );

    const css = readFileSync(join(root, 'src', 'ui', 'styles.css'), 'utf8');
    check(
      'the performance overlay has a style, and takes the HUD scrim\u2019s token rather than a second literal',
      css.includes('.bb-gfxstat') && css.includes('.game-root.view-3d .bb-gfxstat'),
    );
    // THE GALLERY'S 3D STILLS share ONE scene across every cell. A browser caps live WebGL
    // contexts (Chrome at about 16) and this grid is 30-odd cells, so a scene per cell would
    // silently start dropping the oldest ones — the failure looks like "some cells went black",
    // which is exactly what a reviewer would report as a renderer bug.
    const gallerySrc = readFileSync(join(BIOBUZZ_DIR, 'Gallery.tsx'), 'utf8');
    check(
      'the gallery builds ONE 3D scene for the whole grid',
      /function use3dStillScene/.test(gallerySrc) && (gallerySrc.match(/f\(host, \{ quality/g) ?? []).length === 1,
      String((gallerySrc.match(/f\(host, \{ quality/g) ?? []).length),
    );
    check('and it reaches it through the module slot, never a direct scene import', gallerySrc.includes("moduleFor('biobuzz').scene"));
    check('a per-scene 3D camera is optional and defaults to orbit (the gallery/spectator shot)', /camera3d\?: /.test(readFileSync(join(BIOBUZZ_DIR, 'scenes.ts'), 'utf8')) && gallerySrc.includes("camera ?? 'orbit'"));

    // THE TOUCH LAYER's toggle: a button, not a `MobileLayout` key (that would be a field in
    // another lane's `src/types.ts` plus a settings migration, for a control pressed twice a
    // session), and only for the game that HAS a 3D view.
    const mobileSrc = readFileSync(join(root, 'src', 'ui', 'MobileControls.tsx'), 'utf8');
    check('the touch layer has a 2D/3D toggle, gated to BIOBUZZ', mobileSrc.includes('mobile-view-btn') && mobileSrc.includes("game === 'biobuzz'"));
    check('...and it is NOT a draggable layout key', !/['"]view['"]\s*:/.test(mobileSrc) && !mobileSrc.includes("L['view']"));
    check('the view key is armed for the whole match by the INPUT layer, not by the scene', readFileSync(join(root, 'src', 'input', 'input.ts'), 'utf8').includes('installViewKey()'));

    // ══ THE 3D ROBOT BUILDER (`docs/roadmap.md` item 1) ═══════════════════════════════════
    //
    // Item 1's stated risk is one sentence: "preview and match must not drift". Every check in
    // this block is that sentence turned into something a grep can refuse, because a preview that
    // has drifted looks exactly as convincing as one that has not — the whole point of the
    // feature is that a player trusts it, so nothing here can be left to a habit.
    {
      const previewSrc = readFileSync(join(SCENE_DIR, 'renderPreview.ts'), 'utf8');
      const robotsSrc = readFileSync(join(SCENE_DIR, 'renderRobots.ts'), 'utf8');
      const slotSrc = readFileSync(join(BIOBUZZ_DIR, 'Preview3D.tsx'), 'utf8');
      // COMMENTS STRIPPED for the two rules below: both of them are about what the file DOES, and
      // this file's headers quote the very strings they forbid while explaining why.
      const slotCode = codeLines(join(BIOBUZZ_DIR, 'Preview3D.tsx')).join('\n');
      const bbMod = moduleFor('biobuzz');
      const builderSrc = readFileSync(join(BIOBUZZ_DIR, 'Builder.tsx'), 'utf8');
      const menuSrc = readFileSync(join(root, 'src', 'ui', 'Menu.tsx'), 'utf8');

      // ── ONE GENERATOR ────────────────────────────────────────────────────────────────────
      check(
        'renderRobots.ts EXPORTS buildRobotGroup (else the preview cannot share it)',
        /export function buildRobotGroup\(/.test(robotsSrc),
      );
      check(
        'the preview builds its robot with buildRobotGroup — the match\u2019s own generator',
        /import \{[^}]*buildRobotGroup[^}]*\} from '\.\/renderRobots'/.test(previewSrc) &&
          previewSrc.includes('buildRobotGroup(spec, 1, alliance)'),
      );
      // and it draws NOTHING of its own: a `new THREE.Mesh` in here would be the second drawing
      // of a robot that this whole design exists to not have. The floor disc is the one mesh the
      // preview owns, and it is not part of the robot.
      {
        const meshes = (previewSrc.match(/new THREE\.Mesh\(/g) ?? []).length;
        check('...and it builds no robot geometry of its own (one mesh: the floor disc)', meshes === 1, String(meshes));
      }

      // ── ONE REBUILD KEY ──────────────────────────────────────────────────────────────────
      // The thumbnail cache lives in the MAIN chunk and has to key on the same identity the
      // generator rebuilds on, without loading the scene chunk to ask. Two copies is exactly how
      // a cached thumbnail ends up showing the previous build.
      check(
        'the rebuild key is bbSpecKey, in ONE place, read by the generator and the thumbnail cache',
        !/function specKey\(/.test(robotsSrc) &&
          robotsSrc.includes('bbSpecKey(r.spec)') &&
          previewSrc.includes('bbSpecKey(next)') &&
          slotSrc.includes('bbSpecKey(spec)'),
      );

      // ── THE COSMETIC CHASSIS COLOUR, AND THE ALLIANCE (the gap item 1 names) ─────────────
      // 2D has always been fill = `chassisFill(chassisColor)`, alliance = the outline. 3D filled
      // the chassis with the ALLIANCE and never rendered `chassisColor` at all, so a supporter's
      // colour vanished the moment they pressed `t`. This is the fix, pinned.
      check(
        'the 3D chassis is FILLED with chassisFill(spec.chassisColor), the 2D allowlist',
        robotsSrc.includes("import { chassisFill } from '../../../config';") &&
          robotsSrc.includes('solidMat(chassisFill(spec.chassisColor)'),
      );
      check(
        '...and the ALLIANCE is the outline plus the sign panel, never the fill',
        /LineSegments\(chassisEdges\([^)]*\), lineMat\(color\)\)/.test(robotsSrc) &&
          robotsSrc.includes('getSignTexture(id, alliance)') &&
          !/chassisGeometry\([^)]*\), solidMat\(color/.test(robotsSrc),
      );

      // ── THE IMPORT BOUNDARY, FOR THE ONE COMPONENT THAT REACHES A LAZY CHUNK ─────────────
      // `Preview3D.tsx` is in the MAIN chunk (the builder is a menu screen). A static import of
      // the scene, or of `three`, would put Three.js in a DECODE player's bundle.
      check(
        'Preview3D.tsx imports no three, and no scene/ module',
        !/from\s+['\"]three['\"]/.test(slotSrc) && !/from\s+['\"]\.\/scene/.test(slotSrc),
      );
      check(
        '...and reaches the renderer ONLY through the module slot',
        slotCode.includes("moduleFor('biobuzz').previewScene") && !/\bimport\(/.test(slotCode),
      );
      // the thumbnails are DERIVED data and are never written to storage: they would be the
      // biggest thing in localStorage and would go stale, plausibly, the day the generator changed
      check('thumbnails are cached in memory only, never persisted', !slotCode.includes('localStorage'));
      // and the preview must not rewrite the app's view preference the way the MATCH scene does —
      // a menu card quietly changing what the next match renders with would be a surprise
      check('the preview scene does not touch the view preference', !previewSrc.includes('setViewPref'));

      // ── THE SLOTS, AND THE HOSTS THAT FILL THEM ──────────────────────────────────────────
      check('biobuzz fills previewScene, and it is a function', typeof bbMod.previewScene === 'function');
      check(
        'decode and chain do NOT (no 3D generator for either)',
        moduleFor('decode').previewScene === undefined && moduleFor('chain').previewScene === undefined,
      );
      check('biobuzz fills the savedCard slot', typeof bbMod.savedCard === 'function');
      check(
        'the builder hero opts INTO a live scene; the strategy cards do not',
        menuSrc.includes('allow3d') &&
          !readFileSync(join(root, 'src', 'ui', 'MatchStrategy.tsx'), 'utf8').includes('allow3d'),
      );
      check('Menu routes the savedCard slot ahead of its own two branches', menuSrc.includes('<SavedCard spec={r}'));

      // ── THE HEIGHT PAIR (R102 / R105.A) ──────────────────────────────────────────────────
      check(
        'the builder has a heightIn dial over R105.A\u2019s own 12..29 range',
        builderSrc.includes('heightIn: Number(e.target.value)') &&
          builderSrc.includes('min={BB3_HEIGHT_MIN}') &&
          builderSrc.includes('max={BB3_HEIGHT_MAX}'),
      );
      check(
        '...and a stow declaration that appears ONLY over the 18-in cube',
        builderSrc.includes('stowHeightIn: Number(e.target.value)') &&
          builderSrc.includes('const folds = deployed > BB3_STOW_MAX;') &&
          builderSrc.includes('{folds && ('),
      );
      // the preview's stow toggle is the SAME resolver the rule reads, expressed as a spec whose
      // height IS the stow height — which is what makes the group rebuild for free
      check(
        'the preview\u2019s stow toggle shows bbStowHeightIn, and only for a folding build',
        slotSrc.includes('bbStowHeightIn(spec)') &&
          slotSrc.includes('{ ...spec, heightIn: stowHeight }') &&
          slotSrc.includes('deployed > BB3_STOW_MAX'),
      );
    }

    const statsSrc = readFileSync(join(SCENE_DIR, 'renderStats.ts'), 'utf8');
    // the ATTRIBUTE, not the word: the file's own header explains at length why it does not
    // carry one, and a grep for the bare string finds that explanation
    check(
      'the overlay is NOT a HUD band (a diagnostic must not reframe the shot)',
      !/setAttribute\(\s*['"]data-hud-band/.test(statsSrc),
    );
  }
}
