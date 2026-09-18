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
    .split('\n')
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
  check(
    'exactly one dynamic import(\'./scene/...\'), in index.ts',
    dynamicSceneImports.length === 1 && dynamicSceneImports[0].startsWith('src/games/biobuzz/index.ts:'),
    dynamicSceneImports.join(', '),
  );

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
}
