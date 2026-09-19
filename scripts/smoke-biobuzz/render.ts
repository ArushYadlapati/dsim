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
import { bbAimHeading, bbTurretSolution } from '../../src/games/biobuzz/robot';
import { bbAimTarget } from '../../src/games/biobuzz/play';
import { BB_AIM_TOL, BB_CELL_OPEN, BB_HIVE_OPEN_Z, BB_HOOD_DEFAULT_DEG } from '../../src/games/biobuzz/config';
// -- LANE A (FIELD RENDER) imports, kept in their own block beside lane B's --------------
import {
  BB_GARDEN,
  BB_HALF_X,
  BB_HALF_Y,
  BB_LZ,
  BB_NECTAR_R,
  BB_TAPE,
  BB_VIEW_MARGIN,
} from '../../src/games/biobuzz/config';
import {
  BB_BOX_DEPTH,
  BB_BOX_H,
  BB_BOX_LEN,
  BB_BOX_SLOTS,
  bbNectarBoxRect,
  bbNectarBoxSlot,
} from '../../src/games/biobuzz/nectarBox';
// ── LANE B (ROBOT RENDER) imports — the 3D robot model's own checks, kept in their own block so
// they are easy to see and easy to move. ───────────────────────────────────────────────────────
import type { RobotSpec } from '../../src/types';
import { bbFootprint, bbMouths } from '../../src/games/biobuzz/robot';
import { BB_LAUNCH_Z0, BB_POLLEN_R, BB3_HEIGHT_DEFAULT, BB3_HEIGHT_MIN } from '../../src/games/biobuzz/config';
import { BB_DEFAULT_SPEC } from '../../src/games/biobuzz/coerce';
import { bbCoerceSpec } from '../../src/games/biobuzz/robotConfig';
import { SHOT, SHOT_ARC_MAX, shotArc, solveShotPath } from '../../src/games/biobuzz/shotPath';
import { drawBiobuzzShotPath } from '../../src/games/biobuzz/drawShot';
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
import type { World } from '../../src/types';
import { mkWorld, type Check } from './harness';

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

  // ---- THE SHOT PATH (Lane C, owner playtest feedback 2026-09-18 items 5 + 6) -------------
  //
  // ⚠️ THIS BLOCK REPLACES THE DAY 2 "RETICLE'S BALLISTICS" CHECKS, and the seven that went are
  // not a coverage loss — they pinned a LANDING RING that no longer exists, and the integrator
  // they were guarding against drift is gone too. `scene/renderLanding.ts` carried a COPY of
  // `play.ts`'s `bbFlightEnters` loop (a boolean cannot be asked for a position), and its own
  // header said the copy would drift; `bbFlightEnters` now records its arc into a caller-owned
  // buffer, so there is ONE loop and `src/games/biobuzz/shotPath.ts` is the only predictor. What
  // is worth checking therefore changed shape: not "where does the ring go" but "is the verdict
  // right, and does the drawn path end where the element does".
  //
  // THE CONTRACT: a path is produced ONLY for a shot that goes in. Out of range, aimed away,
  // barrel short of the arc, cell mid-swing ⇒ `false`, and BOTH renderers then draw nothing.
  {
    const cell = hiveCellTarget('blue', 'north');

    /** a blue turret parked at `(x, y)` with its turret and pitch already ON the solution — i.e.
     * a robot that is lined up and ready, which is the only state a path is ever drawn in.
     *
     * ⚠️ A CELL OPENS ALONG ±y, so a shot has to ARRIVE along y (`hiveAccepts` refuses anything
     * not travelling inboard). Parking the fixture out along +x from the north cell instead was
     * the first version of these checks and every shot correctly reported NOT MADE. */
    const aimed = (x: number, y: number): World => {
      const w = mkWorld('practice', 11);
      const r = w.robots[0];
      r.pos.x = x;
      r.pos.y = y;
      r.heading = 0.4;
      w.biobuzz!.hives.blue.up = 'north';
      w.biobuzz!.hives.blue.tipping = 0;
      const sol = bbTurretSolution(r, bbAimTarget(w, r), 0)!;
      r.turretHeading = sol.yaw;
      r.bbTurretPitch = sol.pitch;
      r.hopper.push('yellow');
      return w;
    };

    // 40 in OUT along +y from the north cell, so the arc comes back down the way the cell opens
    const w = aimed(cell.pos.x, cell.pos.y + 40);
    const made = solveShotPath(w, w.robots[0]);
    check(
      'shot path: a lined-up turret in range reports MADE, with a drawable path',
      made && SHOT.made && SHOT.points >= 2 && SHOT.points <= SHOT_ARC_MAX,
      `made=${made} points=${SHOT.points} of ${SHOT_ARC_MAX}`,
    );
    // the LAST point is where the element is accepted — inside the cell's opening footprint, at
    // opening height. This is what ties the drawn line to `hiveAccepts` rather than to a radius
    // the renderer invented.
    const k = (SHOT.points - 1) * 3;
    const endDx = Math.abs(shotArc[k] - cell.pos.x);
    const endDy = Math.abs(shotArc[k + 1] - cell.pos.y);
    const endZ = shotArc[k + 2];
    check(
      'shot path: it ENDS inside the CELL’s opening footprint, at opening height',
      endDx <= BB_CELL_OPEN.w / 2 && endDy <= BB_CELL_OPEN.d / 2 && endZ >= BB_HIVE_OPEN_Z[0],
      `end (${shotArc[k].toFixed(2)}, ${shotArc[k + 1].toFixed(2)}, ${endZ.toFixed(2)}) vs cell (${cell.pos.x.toFixed(2)}, ${cell.pos.y.toFixed(2)}, ${BB_HIVE_OPEN_Z[0]})`,
    );
    check(
      'shot path: the FIRST point is one tick out of the muzzle, not at the target',
      Math.hypot(shotArc[0] - w.robots[0].pos.x, shotArc[1] - w.robots[0].pos.y) < 12,
      `${shotArc[0].toFixed(2)}, ${shotArc[1].toFixed(2)}`,
    );

    // A TURRET STILL SLEWING IS NOT A SHOT. Swing the barrel 40° off its solution and the path has
    // to vanish — this is item 5, and it is the half that is easy to get wrong, because the arc
    // still integrates perfectly well, it just does not arrive.
    const w2 = aimed(cell.pos.x, cell.pos.y + 40);
    w2.robots[0].turretHeading += 0.7;
    check(
      'shot path: a turret 40° off its solution reports NOT MADE (nothing is drawn)',
      !solveShotPath(w2, w2.robots[0]) && !SHOT.made && SHOT.points === 0,
      `points=${SHOT.points}`,
    );

    // THE FAR CORNER: the turret has the range (`reachable`), and the shot still does not arrive —
    // it crosses the hive axis from the wrong side, so it never comes down INBOARD through the
    // opening. The verdict is the sim's own `hiveAccepts`, not a distance test, and this is the
    // case that tells the two apart.
    const w3 = aimed(-60, -60);
    const far = solveShotPath(w3, w3.robots[0]);
    check(
      'shot path: a reachable arc that still misses the opening reports NOT MADE',
      !far && !SHOT.made,
      `reachable=${bbTurretSolution(w3.robots[0], bbAimTarget(w3, w3.robots[0]), 0)?.reachable}, made=${far}`,
    );

    // AND THE CLOSED SIDE: parked between the two cells, the nearer one is the one facing away.
    const w3b = aimed(cell.pos.x, 5);
    check(
      'shot path: from between the cells (the nearer one faces away) reports NOT MADE',
      !solveShotPath(w3b, w3b.robots[0]) && !SHOT.made,
    );

    // THE REAL HIVE, NOT AIM ASSIST'S PRETEND-UP COPY: flip the aimed cell DOWN and the same shot
    // that was made a moment ago is not made any more.
    const w4 = aimed(cell.pos.x, cell.pos.y + 40);
    w4.biobuzz!.hives.blue.up = 'south';
    check(
      'shot path: the same shot at a cell that is DOWN reports NOT MADE (the REAL hive is read)',
      !solveShotPath(w4, w4.robots[0]) && !SHOT.made,
    );

    // ---- THE OTHER MECHANISM: A DUMPER ---------------------------------------------------
    //
    // `solveShotPath` has two arms and everything above exercises one of them. A dumper does not
    // slew: it throws its WHOLE hopper on converging arcs and it turns the CHASSIS to aim, so its
    // "still lining up" case is a heading outside `BB_AIM_TOL` rather than a barrel off its
    // solution, and its verdict is EVERY throw landing rather than one. Same three questions as
    // the turret — made, where the drawn arc ends, where it starts — plus that gate.
    {
      /** a blue DUMPER at `(x, y)` with the chassis already ON `bbAimHeading` and three elements
       * loaded: a dumper that is lined up and ready, the only state a path is drawn in. The arc
       * drawn for a dump is the MIDDLE throw of the spread. */
      const dumper = (x: number, y: number): World => {
        const w = mkWorld('practice', 11, {
          scoreMode: 'dumper',
          shooterMount: 'back',
          bbMech: { launcher: { kind: 'dumper', mount: 'back', hoodDeg: BB_HOOD_DEFAULT_DEG }, lift: null },
        });
        const r = w.robots[0];
        r.pos.x = x;
        r.pos.y = y;
        w.biobuzz!.hives.blue.up = 'north';
        w.biobuzz!.hives.blue.tipping = 0;
        r.hopper.push('yellow', 'yellow', 'yellow');
        // a dumper's aim IS its heading — `bbTurretSolution` returns nothing for one
        r.heading = bbAimHeading(r, bbAimTarget(w, r))!;
        return w;
      };

      // 30 in out along +y, inside a dumper's much shorter reach (the turret fixture's 40 is past
      // it — a lob is not a flywheel)
      const wd = dumper(cell.pos.x, cell.pos.y + 30);
      const dMade = solveShotPath(wd, wd.robots[0]);
      check(
        'shot path: a lined-up DUMPER in range reports MADE, with a drawable path',
        dMade && SHOT.made && SHOT.points >= 2 && SHOT.points <= SHOT_ARC_MAX,
        `made=${dMade} points=${SHOT.points} of ${SHOT_ARC_MAX}`,
      );
      const dk = (SHOT.points - 1) * 3;
      check(
        'shot path (dumper): it ENDS inside the CELL’s opening footprint, at opening height',
        Math.abs(shotArc[dk] - cell.pos.x) <= BB_CELL_OPEN.w / 2 &&
          Math.abs(shotArc[dk + 1] - cell.pos.y) <= BB_CELL_OPEN.d / 2 &&
          shotArc[dk + 2] >= BB_HIVE_OPEN_Z[0],
        `end (${shotArc[dk].toFixed(2)}, ${shotArc[dk + 1].toFixed(2)}, ${shotArc[dk + 2].toFixed(2)}) vs cell (${cell.pos.x.toFixed(2)}, ${cell.pos.y.toFixed(2)}, ${BB_HIVE_OPEN_Z[0]})`,
      );
      check(
        'shot path (dumper): the FIRST point is one tick off the LIP, not at the target',
        Math.hypot(shotArc[0] - wd.robots[0].pos.x, shotArc[1] - wd.robots[0].pos.y) < 12,
        `${shotArc[0].toFixed(2)}, ${shotArc[1].toFixed(2)}`,
      );

      // THE HEADING GATE — the dumper's own "still lining up". Stage 5b will not fire a dumper
      // whose chassis is outside `BB_AIM_TOL` of its aim heading, so a path promised for one
      // would be a promise about a shot that does not happen. 0.7 rad is well outside 0.14.
      const wd2 = dumper(cell.pos.x, cell.pos.y + 30);
      wd2.robots[0].heading += 0.7;
      check(
        'shot path: a DUMPER turned off its aim heading reports NOT MADE (nothing is drawn)',
        !solveShotPath(wd2, wd2.robots[0]) && !SHOT.made && SHOT.points === 0 && 0.7 > BB_AIM_TOL,
        `points=${SHOT.points}, tol=${BB_AIM_TOL}`,
      );

      // and the same two negatives the turret has: the REAL hive is read, and range is not the
      // test — the far corner is a dump that cannot arrive at all.
      const wd3 = dumper(cell.pos.x, cell.pos.y + 30);
      wd3.biobuzz!.hives.blue.up = 'south';
      check(
        'shot path (dumper): the same dump at a cell that is DOWN reports NOT MADE',
        !solveShotPath(wd3, wd3.robots[0]) && !SHOT.made,
      );
      const wd4 = dumper(-60, -60);
      check('shot path (dumper): from the far corner, out of a lob’s reach, reports NOT MADE', !solveShotPath(wd4, wd4.robots[0]) && !SHOT.made);
    }

    // and the buffer is never grown by a solve — the 3D line wraps it ONCE
    check(
      'shot path: the arc buffer is exactly SHOT_ARC_MAX points and is never reallocated',
      shotArc.length === SHOT_ARC_MAX * 3,
      `${shotArc.length} floats`,
    );

    // ---- WHAT EACH RENDERER ACTUALLY DRAWS (items 5 + 6) ---------------------------------
    //
    // The verdict is checked above; this is the other half of the owner's two rules — NOTHING for
    // a shot that is not made, and a DOTTED line with no end marker for one that is. The 2D half
    // is exercised through a stub context (the calls ARE the behaviour); the 3D half is a source
    // check, because a `three` import is not allowed in this lane.
    interface Op { op: string; arg?: unknown }
    const stubCtx = (ops: Op[]): CanvasRenderingContext2D => {
      const rec = (op: string) => (arg?: unknown) => { ops.push({ op, arg }); };
      return {
        save: rec('save'),
        restore: rec('restore'),
        beginPath: rec('beginPath'),
        moveTo: rec('moveTo'),
        lineTo: rec('lineTo'),
        setLineDash: rec('setLineDash'),
        stroke: rec('stroke'),
        fill: rec('fill'),
        arc: rec('arc'),
      } as unknown as CanvasRenderingContext2D;
    };
    const up = { x: 0, y: 1 };

    const madeOps: Op[] = [];
    const wm = aimed(cell.pos.x, cell.pos.y + 40);
    drawBiobuzzShotPath(stubCtx(madeOps), wm, up, 0);
    const dash = madeOps.find((o) => o.op === 'setLineDash');
    check(
      'shot path (2D): a MADE shot strokes a DOTTED polyline',
      madeOps.filter((o) => o.op === 'lineTo').length >= 1 &&
        madeOps.some((o) => o.op === 'stroke') &&
        Array.isArray(dash?.arg) &&
        (dash!.arg as number[]).length === 2 &&
        (dash!.arg as number[])[0] > 0,
      `lineTo=${madeOps.filter((o) => o.op === 'lineTo').length} dash=${JSON.stringify(dash?.arg)}`,
    );
    check(
      'shot path (2D): ...and NO end marker — the renderer draws no arc and fills nothing',
      !madeOps.some((o) => o.op === 'arc' || o.op === 'fill'),
      madeOps.map((o) => o.op).join(','),
    );

    const missOps: Op[] = [];
    const wn = aimed(cell.pos.x, cell.pos.y + 40);
    wn.robots[0].turretHeading += 0.7;
    drawBiobuzzShotPath(stubCtx(missOps), wn, up, 0);
    check(
      'shot path (2D): a shot that is NOT made draws nothing at all',
      missOps.length === 0,
      missOps.map((o) => o.op).join(','),
    );

    const spectatorOps: Op[] = [];
    drawBiobuzzShotPath(stubCtx(spectatorOps), wm, up, undefined);
    check('shot path (2D): a spectator (no local robot) draws nothing', spectatorOps.length === 0);

    // comments stripped: both greps below are for words this file's own header NAMES in order to
    // explain why they are absent
    const reticleSrc = codeLines(join(SCENE_DIR, 'renderReticle.ts')).join('\n');
    check(
      'shot path (3D): the path is a LineDashedMaterial — dotted, the same pattern the 2D map uses',
      reticleSrc.includes('LineDashedMaterial') && reticleSrc.includes('SHOT_DASH') && reticleSrc.includes('SHOT_GAP'),
    );
    check(
      'shot path (3D): the landing RING is gone, mesh and geometry both (not merely hidden)',
      !/RingGeometry|CircleGeometry/.test(reticleSrc) && !/\bring\b/i.test(reticleSrc),
    );
    check(
      'shot path (3D): the line wraps shotPath.ts’s own buffer — no per-frame allocation',
      reticleSrc.includes('new THREE.BufferAttribute(shotArc, 3)') && reticleSrc.includes('setDrawRange'),
    );
    check(
      'shot path (3D): ...and it never calls computeLineDistances(), which reallocates every frame',
      !reticleSrc.includes('computeLineDistances'),
    );
  }

  // ---- THE 3D TURRET'S YAW AND ELEVATION ARE SEPARATE NODES ------------------------------
  //
  // ⚠️ THIS SHIPPED, AND IT IS WHAT "THE SHOOTER IS NOT AIMING" LOOKED LIKE (owner playtest
  // feedback 2026-09-18, item 4). The sync set BOTH `rotation.z` (yaw) and `rotation.y`
  // (elevation) on ONE node. A `THREE.Euler`'s default order is `XYZ`, which composes as
  // `Rx·Ry·Rz`, so the elevation was applied about the UN-YAWED y axis: at a turret yaw of 160°
  // off the chassis and the 80° elevation `bbSolveShot` actually asks for at hive range, the
  // barrel came out pointing 67.7° BELOW horizontal and 44.5° off in azimuth — through the deck,
  // while the sim's own turret was dead on target. Measured, both orders, in `three` itself.
  //
  // The fix is structural rather than an Euler-order flag: yaw on `bb-turret-head`, elevation on
  // `bb-turret-pitch` UNDER it, which composes in the only order a real turret can.
  {
    const robotsSrc = readFileSync(join(SCENE_DIR, 'renderRobots.ts'), 'utf8');
    check(
      'renderRobots.ts aims the 3D turret through SEPARATE yaw and elevation nodes',
      robotsSrc.includes('turretHeads') && robotsSrc.includes('turretPitches'),
      'a single node composes yaw and pitch in the wrong order — see this block’s comment',
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
  hudBandChecks(check);
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
    // THE CREDIT IS DERIVED, so a third HDRI cannot ship uncredited. THIRD_PARTY now also
    // carries code/font/CAD credits (Contributors page, "Third-party" section), so this
    // checks that every HDRI has ITS row rather than that the two lists are the same length.
    check(
      'every fetched environment is on the Contributors page',
      hdriEnvironments().every((e) =>
        THIRD_PARTY.some((t) => t.name === e.name && t.license === 'CC0 1.0' && t.credits.length > 0),
      ),
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

    // ══ LANE B — THE ROBOT MODEL (owner playtest 2026-09-18: #9 too tall, #16 the drivetrain,
    // #10 the launcher, #14 the intake reach) ═════════════════════════════════════════════════
    //
    // All four complaints were the same mistake: the COLLIDER was being drawn instead of the
    // robot. The checks below pin the four statements that stop it coming back. Three are source
    // greps (this lane has no DOM and may not import `three`); the fourth is real arithmetic over
    // the sim's own geometry, which is where the intake reach actually lives.
    {
      const robotsSrc = readFileSync(join(SCENE_DIR, 'renderRobots.ts'), 'utf8');
      const robotsCode = codeLines(join(SCENE_DIR, 'renderRobots.ts')).join('\n');

      // ── #9 / #16: A LOW DRIVETRAIN, NOT A FULL-HEIGHT SLAB ───────────────────────────────
      const plateH = Number(/const BB_PLATE_H = ([\d.]+);/.exec(robotsSrc)?.[1] ?? NaN);
      check(
        'the drivetrain has its own height, and it is a drivetrain height',
        plateH > 3 && plateH < 6 && plateH < BB3_HEIGHT_MIN / 2,
        String(plateH),
      );
      // the slab is gone: nothing extrudes or boxes a solid of `height` any more, and the wheels
      // no longer scale with it (they used to be `min(2.5, height * 0.25)`)
      check(
        '...and nothing builds a solid the height of the robot',
        !/chassisGeometry\(/.test(robotsCode) && !/height \* 0\.25/.test(robotsCode),
      );
      check(
        'buildWheels reads the SPEC only — a taller robot does not get bigger wheels',
        /function buildWheels\(spec: RobotSpec\): BbWheels/.test(robotsSrc),
      );
      // ⚠️ A ROBOT'S VISUAL HEIGHT IS WHATEVER ITS MECHANISMS REACH (owner, 2026-09-18). The first
      // answer to #9 carried `heightIn` as an open two-post mast, which is the same complaint in a
      // thinner shape — a goalpost standing on the deck for no apparent reason. The generator now
      // reads no height at all, and the ONE place the declared height is shown is the builder
      // turntable, as a dashed envelope that is visibly a measurement rather than a part.
      check(
        'the generator reads no height at all — it cannot draw one',
        !/heightIn/.test(robotsCode) && !/BB3_HEIGHT_DEFAULT/.test(robotsCode),
      );
      // ...AND THE VISUAL STILL FITS INSIDE THE COLLIDER. The tallest thing the generator builds
      // is the shooter's side plate, whose top is fixed by the muzzle height and the hood chain —
      // it does not vary with the chassis — so one sum covers every build, and it is checked
      // against the SHORTEST legal robot rather than against the default. (The built group is at
      // rest pitch, which is what this measures; a hood ELEVATED past level legitimately swings
      // above the frame, the same way real hardware does inside R105's expanded volume.)
      {
        const num = (name: string): number => Number(new RegExp(`const ${name} = ([\\d.]+);`).exec(robotsSrc)?.[1] ?? NaN);
        const fw = num('BB_FLYWHEEL_R');
        const comp = num('BB_HOOD_COMPRESSION');
        const hoodR = fw + BB_POLLEN_R * 2 - comp;
        const shooterTop = BB_LAUNCH_Z0 - (hoodR - BB_POLLEN_R) + hoodR + 0.5; // axle z + plate radius
        check(
          'the tallest drawn part still fits inside the SHORTEST legal collider',
          Number.isFinite(shooterTop) && shooterTop <= BB3_HEIGHT_MIN,
          `${shooterTop.toFixed(2)} in vs ${BB3_HEIGHT_MIN}`,
        );
        check(
          '...and the default height leaves air above it rather than being the reason for it',
          shooterTop < BB3_HEIGHT_DEFAULT,
          `${shooterTop.toFixed(2)} in vs ${BB3_HEIGHT_DEFAULT}`,
        );
      }
      {
        const previewCode = codeLines(join(SCENE_DIR, 'renderPreview.ts')).join('\n');
        check(
          'the BUILDER shows it instead, as a dashed envelope off the same resolver the rule reads',
          previewCode.includes('bbDeployedHeightIn(spec)') &&
            previewCode.includes('LineDashedMaterial') &&
            previewCode.includes("line.name = 'bb-height-envelope'"),
        );
        check(
          '...and it is framed, removed and freed with the group rather than by a second path',
          previewCode.includes('group.add(buildHeightEnvelope(spec));'),
        );
      }

      // ── #16: TWO PARALLEL PLATES A SIDE, WHEELS BETWEEN THEM, FOOTPRINT UNCHANGED ────────
      check(
        'the OUTER plate face is the frame line, so the footprint is still length x width',
        robotsCode.includes('const outerY = hw - BB_PLATE_T / 2;') &&
          robotsCode.includes('const innerY = hw - BB_PLATE_T * 1.5 - BB_PLATE_GAP;'),
      );
      check(
        'the wheels sit in the channel BETWEEN the two plates',
        robotsCode.includes('const wheelY = spec.width / 2 - BB_PLATE_T - BB_PLATE_GAP / 2;') &&
          /const BB_PLATE_GAP = BB_WHEEL_W \+ /.test(robotsCode),
      );
      check('cross members, a belly pan and a deck — a frame, not a box', /CROSS MEMBERS/.test(robotsSrc) && /BELLY PAN/.test(robotsSrc));

      // ── #10: THE HOODED FLYWHEEL LEAVES WHERE THE SIM SAYS IT DOES ───────────────────────
      // `bbMuzzleZ` is `BB_LAUNCH_Z0` at every elevation, so the visible exit has to be too. The
      // yaw node sits AT that height and the pitch node under it pivots about the exit — put the
      // pivot anywhere else and the picture and the physics agree at one angle only.
      check(
        'the turret head is placed at the sim’s own muzzle height',
        robotsCode.includes('head.position.z = BB_LAUNCH_Z0 - BB_DECK_Z;'),
      );
      check(
        '...and the muzzle is a named node at the pitch pivot',
        robotsCode.includes("exit.name = 'bb-turret-exit'") && robotsCode.includes('const cz = -BB_HOOD_PATH_R;'),
      );
      // the node names are an INTERFACE: the sync, the reticle and any auto-aim rotate these two
      check(
        'the yaw and pitch pivots are named groups (bb-turret-head / bb-turret-pitch)',
        robotsCode.includes("head.name = 'bb-turret-head'") && robotsCode.includes("pitch.name = 'bb-turret-pitch'"),
      );
      check(
        'the hood clears ONE element diameter, read from BB_POLLEN_R rather than typed',
        /const BB_HOOD_R = BB_FLYWHEEL_R \+ BB_POLLEN_R \* 2 - BB_HOOD_COMPRESSION;/.test(robotsCode),
      );
      check('the shooter is an arc hood over a flywheel, not a barrel', /absarc\(0, 0, BB_HOOD_R/.test(robotsCode) && !/TURRET_BARREL[\s\S]{0,80}BoxGeometry\(ring/.test(robotsCode));

      // ── 2026-09-19 OWNER PLAYTEST: THE SIDE PLATE'S OPEN END, AND THE BRACING ─────────────
      // "The shooter's parallel plates have this sharp corner that looks ugly and serves no
      // purpose. The front should be like flat or something and there should be bracing between
      // the two plates."
      //
      // The band stays a "C" (a full disc hid the mechanism and read as a spool — see the
      // generator's own header), so what changed is how it ENDS and what ties the two plates
      // together. Both halves are checked here, and the bracing half is ARITHMETIC over the
      // sim's own element dimensions rather than a grep, because the one thing a standoff may
      // not do is stand in the element's way.
      {
        const num = (name: string): number => Number(new RegExp(`const ${name} = ([\\d.]+);`).exec(robotsSrc)?.[1] ?? NaN);
        const flywheelR = num('BB_FLYWHEEL_R');
        const hoodR = flywheelR + BB_POLLEN_R * 2 - num('BB_HOOD_COMPRESSION');
        const pathR = hoodR - BB_POLLEN_R;
        const wrap = num('BB_HOOD_WRAP');
        const thExit = Math.PI / 2;
        const thFeed = thExit + wrap;
        const rIn = flywheelR * 0.52;
        const rOut = hoodR + 0.5; // `BB_PLATE_R_OUT`
        const endR = num('BB_PLATE_END_R');

        // ── THE END FACE. A fillet at the outer corner and a straight radial edge inboard of
        // it: a FLAT, SQUARE end, not a taper to a point. The old bare `absarc`-to-`absarc`
        // sector is what produced the corner, so its exact form is asserted GONE.
        check(
          'the side plate ends in a square face with a radiused outer corner',
          robotsCode.includes('band.lineTo(cx(rIn, th1), cy(rIn, th1));') &&
            robotsCode.includes('const dth = BB_PLATE_END_R / rOut;') &&
            /band\.quadraticCurveTo\(cx\(rOut, th1\)/.test(robotsCode),
        );
        check(
          '...and the bare radial cut that made the corner is gone',
          !/band\.absarc\(0, 0, rOut, thExit - 0\.5, thFeed \+ 0\.55, false\);/.test(robotsCode),
        );
        // THE OPENING SURVIVES. The band is still a "C" and still leaves the FRONT-BOTTOM
        // QUADRANT open, which is the constraint the generator's header sets — a full disc hid
        // the mechanism. The fillet only ever removes material; the TAIL behind the feed did
        // grow, because that is the one sector with plate and no element in it and the bracing
        // has to bolt to something. So this is arithmetic on the open sector, not a grep for
        // two literals: what matters is the quadrant, not the number that produces it.
        const th0 = thExit - 0.5;
        const th1 = thFeed + num('BB_PLATE_TAIL');
        const openFrom = ((th1 % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2); // where the plate ends
        const openTo = th0 + Math.PI * 2; // ...and where it starts again
        check(
          'the band is still a C, not a disc',
          robotsCode.includes('const th0 = thExit - 0.5;') && openTo - openFrom > Math.PI / 2,
          `${(((openTo - openFrom) * 180) / Math.PI).toFixed(1)}° open`,
        );
        check(
          '...and the whole FRONT-BOTTOM QUADRANT is inside the opening',
          openFrom <= (Math.PI * 3) / 2 + 0.02 && openTo >= Math.PI * 2,
          `open ${((openFrom * 180) / Math.PI).toFixed(1)}°..${((openTo * 180) / Math.PI).toFixed(1)}°`,
        );
        // ⚠️ AND IT MUST NOT DIP INTO THE CHASSIS IT STANDS ON (owner, 2026-09-19: "the plate
        // is meshing with the chassis, the plate should not be going downwards"). Past `thFeed`
        // the rim's height falls away fast: a 0.55-rad tail put it at 2.75 against a 4.6-in
        // deck, 1.85 in INSIDE the drivetrain. This is the arithmetic, not a pin on the tail,
        // because it is the DECK that decides how much tail there is room for.
        {
          const axleZ = BB_LAUNCH_Z0 - pathR;
          let lowest = Infinity;
          for (let i = 0; i <= 64; i++) {
            const th = th0 + ((th1 - th0) * i) / 64;
            lowest = Math.min(lowest, axleZ + Math.sin(th) * rOut);
          }
          check(
            'no part of the side plate hangs below the deck',
            lowest >= num('BB_PLATE_H'),
            `lowest rim ${lowest.toFixed(2)} vs deck ${num('BB_PLATE_H')}`,
          );
        }
        check(
          '...and the end face survives the fillet (the plate is deeper than the corner radius)',
          Number.isFinite(endR) && endR > 0.2 && endR < (rOut - rIn) / 2,
          `end radius ${endR} vs plate depth ${(rOut - rIn).toFixed(2)}`,
        );

        // ── THE BRACING. Ribs strapped over the back of the hood, listed as plain angles so
        // this lane can do the geometry the generator's comment claims. The element's path is
        // THREE regions — the WRAP (an annulus of `pathR ± BB_POLLEN_R` over `[thExit, thFeed]`),
        // the OUTGOING CORRIDOR (the same band of heights running out along +x from the muzzle)
        // and the FEED APPROACH (the run up the ramp) — and a brace may enter none of them.
        const braceT = num('BB_BRACE_T');
        const braceLen = num('BB_BRACE_LEN');
        const braceRad = rOut + braceT / 2; // the rule `BB_BRACE_RADIUS` is written as
        const anglesSrc = /const BB_BRACE_ANGLES[^=]*=\s*\[([^\]]*)\];/.exec(robotsSrc)?.[1] ?? '';
        const sites = [...anglesSrc.matchAll(/-?[\d.]+/g)].map((m) => Number(m[0]));
        // a conservative disc round each rib, for the distance tests that are not purely radial
        const eff = Math.hypot(braceLen / 2, braceT / 2);
        check('the two plates are tied together at all', sites.length >= 3 && braceT > 0 && braceLen > 0, `${sites.length} ribs`);
        check(
          '...as ONE merged, cached part rather than a mesh per rib',
          robotsCode.includes("framePart('shooterBrace'") &&
            robotsCode.includes('const BB_BRACE_RADIUS = BB_PLATE_R_OUT + BB_BRACE_T / 2;'),
        );
        check(
          '...spanning the WHOLE channel, flush with both plate outer faces',
          robotsCode.includes('BB_HOOD_W + 0.44') && robotsCode.includes('s * (BB_HOOD_W / 2 + 0.11)'),
        );
        // and VISIBLE: a brace buried in the chassis answers the complaint with nothing anyone
        // can see. The muzzle is at `BB_LAUNCH_Z0`, the axle `pathR` below it, and the deck is
        // the top of the drivetrain — so every rib has to clear that.
        const deckZ = num('BB_PLATE_H');
        for (const th of sites) {
          const z = BB_LAUNCH_Z0 - pathR + Math.sin(th) * braceRad;
          check(`brace @${th}rad: stands above the deck, where it can be seen`, z - eff > deckZ, `z ${z.toFixed(2)} vs deck ${deckZ}`);
        }
        // the FEED APPROACH, as a ray: the element runs up the ramp into the wrap's far end, so
        // the ray starts at the path's own feed point and heads back down the ramp. The ramp's
        // tilt is read from the generator rather than assumed (`rotation.y = -a` maps the box's
        // long axis to `(cos a, sin a)` in this x–z frame).
        const rampTilt = Number(/ramp\.rotation\.y = -([\d.]+);/.exec(robotsCode)?.[1] ?? NaN);
        const feed = { x: Math.cos(thFeed) * pathR, z: Math.sin(thFeed) * pathR };
        const feedDir = { x: -Math.cos(rampTilt), z: -Math.sin(rampTilt) };
        check('the feed ramp’s tilt is readable, so the approach ray is the drawn one', Number.isFinite(rampTilt), `${rampTilt}`);

        for (const th of sites) {
          const label = `brace @${th}rad`;
          const r = braceRad;
          // (a) ⚠️ SEATED ON THE PLATE RIM AND PROUD OF IT, not buried inside it. Tucked
          // under `rOut` the rib was occluded by the very plate it ties, from every side view —
          // owner, 2026-09-19: "i dont see the bracing". Its INNER face must touch the rim (so
          // it is bolted to plate, not hanging in air) and its outer face must clear it (so it
          // can be seen). RADIAL extent is half the thickness: the rib is a chord, so its
          // corners are FARTHER from the axle than its inner face, never nearer.
          check(
            `${label}: is seated on the plate rim and stands proud of it`,
            Math.abs(r - braceT / 2 - rOut) < 1e-6 && r + braceT / 2 > rOut,
            `${(r - braceT / 2).toFixed(2)}..${(r + braceT / 2).toFixed(2)} vs rim ${rOut.toFixed(2)}`,
          );
          // ...and ON it ANGULARLY, which is the half that is easy to miss: a site in the
          // OPENING has no plate to bolt to and the rib floats.
          const halfAng = braceLen / 2 / r;
          check(`${label}: ...and lands on plate ANGULARLY (not in the opening)`, th - halfAng > th0 && th + halfAng < th1, `${th} vs [${th0.toFixed(3)}, ${th1.toFixed(3)}]`);
          // (b) clear of the FLYWHEEL, which spins in the same channel
          check(`${label}: clears the flywheel`, r - braceT / 2 > flywheelR, `${(r - braceT / 2).toFixed(2)} vs ${flywheelR}`);
          // (c) outside the WRAP — the sector the element is pinched round. These ribs ARE over
          // the wrap, so this passes on the RADIAL clearance: outboard of the hood shell.
          const norm = ((th % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
          const inWrap = norm > thExit - halfAng && norm < thFeed + halfAng;
          const radialClear = r + braceT / 2 < pathR - BB_POLLEN_R || r - braceT / 2 > pathR + BB_POLLEN_R;
          check(`${label}: outside the element's wrap round the flywheel`, !inWrap || radialClear, `inner face ${(r - braceT / 2).toFixed(2)} vs element outer ${(pathR + BB_POLLEN_R).toFixed(2)}`);
          // (d) clear of the OUTGOING CORRIDOR — the muzzle fires along +x at `pathR` above the
          // axle, and an element is `BB_POLLEN_R` fat. This is the one that rules out the
          // obvious nose standoff at the plate's forward end face.
          const bx = Math.cos(th) * r;
          const bz = Math.sin(th) * r;
          const inCorridor = bx + eff > 0 && Math.abs(bz - pathR) < BB_POLLEN_R + eff;
          check(`${label}: clear of the muzzle's outgoing corridor`, !inCorridor, `(${bx.toFixed(2)}, ${bz.toFixed(2)}) vs exit z ${pathR.toFixed(2)}`);
          // (e) clear of the FEED APPROACH — the run up the ramp into the wrap's far end
          const t = Math.max(0, (bx - feed.x) * feedDir.x + (bz - feed.z) * feedDir.z);
          const near = { x: feed.x + feedDir.x * t, z: feed.z + feedDir.z * t };
          const feedGap = Math.hypot(bx - near.x, bz - near.z);
          check(`${label}: clear of the element's run up the feed ramp`, feedGap > BB_POLLEN_R + eff, `${feedGap.toFixed(2)} in vs ${(BB_POLLEN_R + eff).toFixed(2)}`);
        }
      }

      // ── 2026-09-19 OWNER PLAYTEST: "SWERVE IS NOT RENDERED PROPERLY AT ALL" ───────────────
      // It was one squat cylinder per corner floating at deck height with the wheel left behind
      // pointing forward — a puck, not a module, and unable to steer. A pod is a group whose
      // ORIGIN is the contact patch (the steering axis), carrying the wheel, a twin-plate fork,
      // a kingpin and a toothed slew ring.
      //
      // ⚠️ AND NOTHING ABOVE THE RING (owner follow-up, same day: "the motor for swerve does NOT
      // go on top of the swerve module"). The first pass stood a motor can on the slew ring. A
      // swerve steering motor lives on the DECK and drives the ring through the belt or gear the
      // ring is toothed for; the ring is already what says the pod is driven.
      {
        check(
          'a swerve pod is a real assembly: fork + kingpin, slew ring',
          robotsCode.includes("framePart('swervePod:struct'") &&
            robotsCode.includes("framePart('swervePod:ring'") &&
            /TWIN FORK PLATES/.test(robotsSrc) &&
            /THE KINGPIN/.test(robotsSrc),
        );
        check(
          '...and NOTHING is stood on top of it',
          !robotsCode.includes("framePart('swervePod:motor'") && !/BB_POD_MOTOR_/.test(robotsCode),
        );
        check(
          '...and the floating deck-height puck is gone',
          !/BB_DECK_Z \+ 1\.1/.test(robotsCode) && !/CylinderGeometry\(1\.1, 1\.1, 2\.2, 10\)/.test(robotsCode),
        );
        // THE POD TURNS ABOUT THE CONTACT PATCH. The group sits at (x, y, 0) and the wheel is at
        // the group's own origin lifted by its radius, so `rotation.z` is a zero-scrub-radius
        // steer — put the pivot anywhere else and the wheel sweeps a circle on the floor.
        check(
          'the pod pivots about the wheel’s contact patch',
          robotsCode.includes('pod.position.set(x, sy * wheelY, 0);') &&
            robotsCode.includes('wheel.position.set(0, 0, BB_WHEEL_R);'),
        );
        // ⚠️ THE STEER COMES OUT OF THE SIM, AND NOTHING WAS ADDED TO THE SIM TO FEED IT.
        // `RobotState.moduleAngles` is a REQUIRED field that has existed since the shared
        // drivetrain landed — the 2D map has always read it — and the 3D view was simply
        // ignoring it. Same for `butterflyTank`. If either ever stops being declared there, the
        // picture is being fed by a field invented for it, and this fails.
        const typesSrc = readFileSync(join(root, 'src', 'types.ts'), 'utf8');
        check(
          'the pod steers off the sim’s own moduleAngles (a pre-existing, required field)',
          /^\s*moduleAngles: number\[\];$/m.test(typesSrc) &&
            robotsCode.includes('pods[i].rotation.z = r.moduleAngles[i] ?? 0'),
        );
        check(
          '...in the SAME corner order the 2D map reads it in — [FL, FR, BL, BR]',
          /FL, FR, BL, BR/.test(robotsSrc) && /moduleAngles/.test(typesSrc),
        );
        // the pod still has to fit the collider. With the motor gone the ring's own flange is
        // the top of it, which is well clear -- the check stays because the NEXT thing anyone
        // stacks on a pod is what would break it.
        const num = (name: string): number => Number(new RegExp(`const ${name} = ([\\d.]+);`).exec(robotsSrc)?.[1] ?? NaN);
        const podTop =
          num('BB_PLATE_H') + 0.3 + num('BB_POD_RING_H') + 0.16;
        check(
          'the whole pod fits inside the SHORTEST legal collider',
          Number.isFinite(podTop) && podTop < BB3_HEIGHT_MIN,
          `${podTop.toFixed(2)} in vs ${BB3_HEIGHT_MIN}`,
        );
      }

      // ── ALL FIVE DRIVETRAINS, AND THE ONE THAT WAS ACTUALLY WRONG ────────────────────────
      // `xdrive` and `butterfly` both used to fall through to the mecanum wheel. X-DRIVE was a
      // BUG: `drawWheels` (the 2D map, shared by all three games) cants its omnis across their
      // corners so the four read as a diamond, and its header explains why that is the machine
      // this sim models — a radial X could never yaw. Drawing them pointing forward in 3D made
      // the same robot a different machine depending on which view key was pressed, so the 3D
      // cant is now THE SAME EXPRESSION. BUTTERFLY was only under-drawn, and now carries both
      // sets with `butterflyTank` deciding which is down.
      {
        const wheelsSrc = readFileSync(join(root, 'src', 'render', 'drawRobot.ts'), 'utf8');
        check(
          'the 2D map still cants its X-drive omnis across their corners',
          /px \* py >= 0 \? -Math\.PI \/ 4 : Math\.PI \/ 4/.test(wheelsSrc),
        );
        check(
          '...and the 3D view cants them by the same rule, not straight ahead',
          /x \* sy >= 0 \? -Math\.PI \/ 4 : Math\.PI \/ 4/.test(robotsCode),
        );
        check(
          'a mecanum roller and an omni roller are drawn as different wheels (45° vs 90°)',
          robotsCode.includes("getRollerMat(dt === 'xdrive' ? 'omni' : 'mecanum')") &&
            robotsCode.includes("kind === 'mecanum' ? i - size : i"),
        );
        const typesSrc = readFileSync(join(root, 'src', 'types.ts'), 'utf8');
        check(
          'butterfly draws BOTH sets and drops the one the sim says is down',
          /^\s*butterflyTank: boolean;$/m.test(typesSrc) &&
            robotsCode.includes("if (dt === 'butterfly')") &&
            robotsCode.includes('r.butterflyTank ? 0 : BB_BUTTERFLY_LIFT'),
        );
        // and none of the five is left sharing another's drawing
        for (const dt of ['mecanum', 'tank', 'swerve', 'xdrive', 'butterfly'] as const) {
          check(`buildWheels branches on ${dt}`, new RegExp(`'${dt}'`).test(robotsCode), dt);
        }
      }

      // ── #14: THE INTAKE REACHES THE SIM'S OWN FOOTPRINT ─────────────────────────────────
      // Read from `bbMouths`, never a literal and never a copy of the reach constant: Lane D may
      // lengthen the reach and the model has to follow it without an edit here.
      check(
        'the 3D intake is built from bbMouths/bbMouthFrame, the capture rects themselves',
        robotsCode.includes('for (const m of bbMouths(spec))') && robotsCode.includes('bbMouthFrame(m, hl, hw)'),
      );
      check(
        '...and renderRobots names no intake constant of its own',
        !/INTAKE_PRESETS/.test(robotsCode) && !/\.reach/.test(robotsCode),
      );
      // ARITHMETIC, not a grep: for every mount, the mouth the model is built in reaches exactly
      // the collision extent of that edge, and reaches PAST the frame — which is the complaint.
      {
        const mk = (over: Partial<RobotSpec>): RobotSpec => bbCoerceSpec({ ...BB_DEFAULT_SPEC, ...over } as RobotSpec);
        for (const mount of ['front', 'back', 'side', 'frontback'] as const) {
          const spec = mk({ intakeMount: mount });
          const fx = bbFootprint(spec);
          const hl = spec.length / 2;
          const hw = spec.width / 2;
          for (const m of bbMouths(spec)) {
            const outer =
              m.edge === 'front' ? m.x1 : m.edge === 'back' ? -m.x0 : m.edge === 'left' ? m.y1 : -m.y0;
            const want = m.edge === 'front' ? fx.front : m.edge === 'back' ? fx.rear : fx.half;
            const frame = m.edge === 'front' || m.edge === 'back' ? hl : hw;
            check(
              `intake ${mount}/${m.edge}: the drawn mouth reaches the collision extent`,
              Math.abs(outer - want) < 1e-9,
              `${outer.toFixed(3)} vs ${want.toFixed(3)}`,
            );
            check(
              `intake ${mount}/${m.edge}: and it reaches PAST the frame (else nothing sticks out)`,
              outer - frame > 1,
              `${(outer - frame).toFixed(3)} in`,
            );
          }
        }
      }
      // the 2D sprite is built from the same rects and puts its outer roller just inside the tip,
      // so the two views cannot under-draw the reach differently
      const spriteSrc = readFileSync(join(BIOBUZZ_DIR, 'drawRobot.ts'), 'utf8');
      check(
        'the 2D sprite draws the same mouths, out to the same tip',
        spriteSrc.includes('for (const m of bbMouths(r.spec))') && spriteSrc.includes('const outer = d - 0.95;'),
      );
      check('the muzzle height both renderers use is the sim’s release height', BB_LAUNCH_Z0 > 0 && robotsCode.includes('BB_LAUNCH_Z0'));

      // ── #15: THE DRAWN MUZZLE ADDS UP TO THE SIM'S RELEASE HEIGHT ──────────────────────
      // `renderRobots.ts` exports `BB_DRIVETRAIN_H` and `BB_SHOOTER_MUZZLE_Z` so anything that
      // has to reason about the deck or the exit can do it without importing `three`; the
      // invariant the exports CLAIM is that the drawn muzzle sits at `BB_LAUNCH_Z0`, and that
      // is a chain of three statements, not one constant. So walk the chain and add it up —
      // a `three` import is not allowed in this lane, so the heights come out of the source and
      // the total is compared against the sim's own number, imported for real.
      {
        const num = (re: RegExp): number => {
          const m = re.exec(robotsCode);
          return m ? Number(m[1]) : NaN;
        };
        const plateH = num(/const BB_PLATE_H = ([\d.]+);/);
        check(
          'the deck is the top of the drivetrain, and BB_DRIVETRAIN_H is that number',
          plateH > 0 && /const BB_DECK_Z = BB_PLATE_H;/.test(robotsCode) && /export const BB_DRIVETRAIN_H = BB_PLATE_H;/.test(robotsCode),
          `BB_PLATE_H=${plateH}`,
        );
        // the three links: turret bolted to the DECK, yaw head lifted to the muzzle height, and
        // the `bb-turret-exit` empty left at the head's LOCAL ORIGIN (never re-positioned — that
        // is what makes the head's own z the muzzle's z).
        const exitAt = robotsCode.indexOf("exit.name = 'bb-turret-exit'");
        const untouched = exitAt > 0 && !/exit\.position/.test(robotsCode.slice(exitAt, robotsCode.indexOf('head.add(exit)', exitAt)));
        const drawn = /group\.position\.set\(local\.x, local\.y, BB_DECK_Z\);/.test(robotsCode) && /head\.position\.z = BB_LAUNCH_Z0 - BB_DECK_Z;/.test(robotsCode)
          ? plateH + (BB_LAUNCH_Z0 - plateH)
          : NaN;
        check(
          'the DRAWN muzzle (deck + head lift + exit at the head origin) IS BB_LAUNCH_Z0',
          untouched && Math.abs(drawn - BB_LAUNCH_Z0) < 1e-9,
          `drawn ${drawn} vs BB_LAUNCH_Z0 ${BB_LAUNCH_Z0}, exit-at-origin=${untouched}`,
        );
        check(
          '...and that is what BB_SHOOTER_MUZZLE_Z exports (the exports are not a second source of truth)',
          /export const BB_SHOOTER_MUZZLE_Z = BB_LAUNCH_Z0;/.test(robotsCode),
        );
      }
    }

    const statsSrc = readFileSync(join(SCENE_DIR, 'renderStats.ts'), 'utf8');
    // the ATTRIBUTE, not the word: the file's own header explains at length why it does not
    // carry one, and a grep for the bare string finds that explanation
    check(
      'the overlay is NOT a HUD band (a diagnostic must not reframe the shot)',
      !/setAttribute\(\s*['"]data-hud-band/.test(statsSrc),
    );
  }

  // == LANE A (FIELD RENDER) -- the 2026-09-18 playtest's field items =======================
  //
  // Source + data checks only: this lane has no DOM and no `three`, and every one of these
  // guards a thing that is invisible until somebody looks at the field from the right angle.
  {
    const glbSrc = readFileSync(join(SCENE_DIR, 'renderFieldGlb.ts'), 'utf8');
    const fieldSrc = readFileSync(join(SCENE_DIR, 'renderField.ts'), 'utf8');
    const drawSrc = readFileSync(join(BIOBUZZ_DIR, 'drawField.ts'), 'utf8');

    // ITEM 1 -- CLEAR PLASTIC. The STEP paints clear polycarbonate the same placeholder white it
    // paints solid white parts, so the decision is a per-(node, material) rule in the loader. The
    // regression to catch is someone keying it on the material name alone: `plastic#e6e6e6` is a
    // clear CELL skin in a tray node and an opaque ACM logo board in the shared frame, and one
    // shared cache entry would hand both the same answer.
    check(
      'the clear-plastic rule is keyed on the NODE as well as the material (one glTF material name, two answers)',
      /function isClearPanel\([^)]*family: NodeFamily\)/.test(glbSrc) && glbSrc.includes("family === 'hive_tray'"),
    );
    check('the material cache key carries the node family', glbSrc.includes('@${here}'));
    // THE 2026-09-19 RE-TUNE. A clear panel is what the LAYERS sum to, so `FrontSide` is the
    // policy on BOTH paths — the first pass's `DoubleSide` doubled every surface in a line of
    // sight and the cell skins read as white boards. Read out of `clearPanelMaterial` ITSELF,
    // not out of the whole file: both files build opaque-ish decorations (`mat()`, the holding-box
    // sign) that are legitimately `DoubleSide`, and a file-wide grep cannot tell them apart.
    const panelMat = (src: string): string => {
      const at = src.indexOf('function clearPanelMaterial');
      const end = src.indexOf('\n}', at);
      return at < 0 || end < 0 ? '' : src.slice(at, end);
    };
    for (const [rel, src] of [
      ['scene/renderFieldGlb.ts', glbSrc],
      ['scene/renderField.ts', fieldSrc],
    ] as const) {
      const body = panelMat(src);
      // a clear panel is four things, not just a low opacity -- see the policy header
      check(`${rel}: a clear panel damps the environment map (what made these read as solid white)`, body.includes('CLEAR_ENV_INTENSITY'), rel);
      check(
        `${rel}: a clear panel is FrontSide with depthWrite off (the 2026-09-19 re-tune)`,
        /depthWrite: false/.test(body) && /side: THREE\.FrontSide/.test(body) && !/side: THREE\.DoubleSide/.test(body),
        rel,
      );
    }
    // THE TWO PATHS AGAINST EACH OTHER, not against a literal: a literal is exactly what went
    // stale here — the CAD path was re-tuned and the checks kept pinning the rejected number,
    // so they passed on the old value and failed on the new one. What matters is that a driver
    // who falls back to the constants path sees the same field.
    {
      const num = (src: string, name: string): number => {
        const m = new RegExp(`const ${name} = ([\\d.]+);`).exec(src);
        return m ? Number(m[1]) : NaN;
      };
      for (const [what, glbName, fieldName] of [
        ['cell-panel opacity', 'CELL_PANEL_OPACITY', 'CELL_OPACITY'],
        ['wall-panel opacity', 'WALL_PANEL_OPACITY', 'WALL_OPACITY'],
        ['clear-panel env intensity', 'CLEAR_ENV_INTENSITY', 'CLEAR_ENV_INTENSITY'],
      ] as const) {
        const a = num(glbSrc, glbName);
        const b = num(fieldSrc, fieldName);
        check(`the two paths use the same ${what}`, Number.isFinite(a) && a === b, `glb ${a} vs fallback ${b}`);
      }
      // and the re-tune's DIRECTION, so nobody walks both files back to the first pass together:
      // a cell skin is denser than the perimeter, and both are far below the rejected 0.22.
      const cell = num(glbSrc, 'CELL_PANEL_OPACITY');
      const wall = num(glbSrc, 'WALL_PANEL_OPACITY');
      check(
        'a clear panel is nearly invisible face-on, and a cell skin is the denser of the two',
        wall > 0 && wall <= 0.12 && cell > wall && cell <= 0.15,
        `wall ${wall}, cell ${cell}`,
      );
    }

    // ITEM 3 -- THE STALE TRAY BRACES. `convert.py` files all eight `10.5in Churro Lite` as
    // `hive_frame`, but they ride the tray: in `field-colliders.json` they sit at the tray's own
    // 30-degree capture pose in a mirrored pair, which a static part cannot do. The loader moves
    // them back onto the tray; these checks prove the CLAIM about the data, so the day the
    // pipeline files them correctly this fails loudly rather than the reparent quietly doing
    // nothing.
    check(
      'the loader reparents the tray braces onto the tray group',
      glbSrc.includes('function reparentTrayBraces') && glbSrc.includes('braceTris'),
    );
    {
      const colliders = JSON.parse(readFileSync(join(root, 'public', 'models', 'biobuzz', 'field-colliders.json'), 'utf8')) as {
        statics: { name: string; points: number[] }[];
      };
      const braces = colliders.statics.filter((s) => s.name.includes('churro'));
      check('the CAD still files the eight tray braces as hive_frame statics (the defect this works around)', braces.length === 8, `${braces.length}`);
      let inBand = 0;
      let others = 0;
      for (const s of colliders.statics) {
        if (!s.name.startsWith('hive_')) continue;
        let hit = false;
        for (let i = 0; i < s.points.length; i += 3) {
          const y = s.points[i + 1];
          const z = s.points[i + 2];
          if (z >= 46 || (Math.abs(y) >= 11.5 && z >= 36)) hit = true;
        }
        if (s.name.includes('churro')) {
          if (hit) inBand++;
        } else if (hit) others++;
      }
      check('all eight braces fall inside the loader selector band', inBand === 8, `${inBand}/8`);
      check('and no other hive_frame static does (the selector cannot take a leg or a bracket)', others === 0, `${others}`);
    }

    // ITEM 8 -- THE HUMAN PLAYER'S NECTAR HOLDING BOX. The unlabelled CAD box in the drive team
    // area is hidden and the STANDARD HOLDING BOX (`am-5706 Artifact Tray`, the same part, at its
    // own CAD dimensions, drawn the way DECODE draws its human-player box) stands ON THE FLOOR
    // outside the perimeter instead, reading its count off `world.balls` (the same balls the HUD
    // counts) rather than storing one. 2026-09-19: it replaced a bespoke shelf on legs at table
    // height -- "it should use the standard holding box instead of this table thing".
    //
    // 2026-09-19, second pass -- the owner's three: the box MOVED clear of the score bar, the 3D
    // count plate over it is GONE, and the 2D field draws the same box. The dimensions and the
    // place now live in `src/games/biobuzz/nectarBox.ts` so both renderers read one copy; these
    // checks are against THAT module's exported geometry, not against a literal in either
    // renderer, because a literal is what let the two views disagree in the first place.
    check('the unlabelled CAD `stations` tray is hidden on the GLB path', fieldSrc.includes('fg.stations.visible = false'));
    check('the NECTAR box reads its count off the world own `stock` balls', /b\.state\.kind === 'stock' && b\.state\.alliance === a/.test(fieldSrc));
    check('and it is refreshed every frame from `updateBiobuzzField`', fieldSrc.includes('updateNectarBoxes(handles.boxes, world)'));
    {
      // the CAD part's own footprint, off `docs/biobuzz/field-cad-audit.md`'s bbox for
      // `am-5706 Artifact Tray` (71.650, -7.875, -0.589 -> 81.900, 7.875, 2.411). Checked on the
      // SHARED module's exports, which is what both renderers build from.
      for (const [name, got, want] of [
        ['depth', BB_BOX_DEPTH, 10.25],
        ['length', BB_BOX_LEN, 15.75],
        ['height', BB_BOX_H, 3],
      ] as const) {
        check(`the holding box uses the CAD tray's ${name} (${want} in)`, Math.abs(got - want) < 1e-9, `${got}`);
      }
      // ON THE GROUND. The shelf sat at z = 30 on legs; the box's floor slab is half its own
      // thickness off the tiles and the beads rest on that slab, so nothing floats.
      check('the holding box floor slab sits ON the tiles', fieldSrc.includes('floorSlab.position.set(cx, cy, BB_BOX_T / 2)'));
      check('and the nectar rest on the box floor, not at table height', fieldSrc.includes('BB_BOX_T + BB_NECTAR_R'));
      for (const gone of ['RACK_SHELF_Z', 'RACK_SHELF_T', 'RACK_DEPTH', ':leg', ':lip']) {
        check(`the shelf-on-legs geometry is gone (${gone})`, !fieldSrc.includes(gone), gone);
      }
    }

    // ITEM 8a -- THE 3D "NECTAR LEFT" BILLBOARD IS GONE (owner, 2026-09-19: "Get rid of the
    // in-game 3d display"). A canvas plate hung over the box and was repainted whenever the
    // count changed. Deleting the MESH alone would have left a live `CanvasTexture` on the box
    // handle, which `disposeObject3D` never reaches because it only walks what is still in the
    // graph -- so the checks are that the plate, its canvas, its texture and the handle field
    // are all gone, not just that the mesh stopped being added.
    for (const gone of ['drawBoxSign', 'BOX_SIGN_W', 'BOX_SIGN_H', ':sign']) {
      check(`the holding box's 3D count plate is gone (${gone})`, !fieldSrc.includes(gone), gone);
    }
    {
      // scoped to the BUILDER, not the file: `buildFloorTexture` legitimately makes a canvas
      // texture for the tile seam grid, and a file-wide grep cannot tell the two apart.
      const at = fieldSrc.indexOf('function buildNectarBox(');
      const body = at < 0 ? '' : fieldSrc.slice(at, fieldSrc.indexOf('function buildNectarBoxes', at));
      check(
        'the box builder makes no canvas, no texture and no billboard at all',
        body.length > 0 && !/canvas|Texture|PlaneGeometry|lookAt/i.test(body),
      );
      check(
        'and `BbNectarBox` is the group and the beads, with nothing left to leak',
        /export interface BbNectarBox \{[^}]*beads: THREE\.Mesh\[\];\s*\}/.test(fieldSrc) && !/sign/.test(fieldSrc.slice(fieldSrc.indexOf('export interface BbNectarBox'), fieldSrc.indexOf('export interface BbNectarBox') + 400)),
      );
    }

    // ITEM 8b -- WHERE IT STANDS. Three things, all of them the reason it moved.
    {
      const area = BB_TAPE.allianceArea;
      for (const a of ['red', 'blue'] as const) {
        const r = bbNectarBoxRect(a);
        const outward = Math.min(Math.abs(r.x0), Math.abs(r.x1)); // the edge nearest the wall
        const far = Math.max(Math.abs(r.x0), Math.abs(r.x1));
        check(`the ${a} nectar box stands outside the perimeter face`, outward > BB_HALF_X, `${outward.toFixed(2)} > ${BB_HALF_X}`);
        // (1) IT FITS IN WHAT THE 2D CAMERA SHOWS. `Camera.configure` fits exactly
        // `halfX + viewMargin`, so a box past that is cut off at the BOTTOM of the driver's 2D
        // screen -- which is the strip the score bar occupies. This is the check that keeps the
        // 2D copy honest; nothing else in the renderer can see it.
        check(
          `the ${a} nectar box fits inside BB_VIEW_MARGIN, so the 2D view cannot clip it`,
          far <= BB_HALF_X + BB_VIEW_MARGIN,
          `${far.toFixed(2)} <= ${BB_HALF_X + BB_VIEW_MARGIN}`,
        );
        // (2) IT IS OUTBOARD OF THE DRIVE TEAM AREA, on the DRIVER'S LEFT -- "place the human
        // player box off to the left side of the drive team box". Driver-left is +y for red and
        // -y for blue (red's driver stands at x < 0 looking along +x, so the camera's right
        // vector is -y; blue is the 180-degree rotation of that, NOT the x-mirror). Stated as
        // "the same side of the centreline as this alliance's own LOADING ZONE", which is a
        // point-symmetric statement and therefore cannot be got right for one alliance and
        // wrong for the other.
        const lzY = (BB_LZ[a].y0 + BB_LZ[a].y1) / 2;
        const near = Math.sign(lzY) > 0 ? r.y0 : r.y1;
        const tape = Math.max(...area[a].map((s) => Math.abs(s.y1)));
        check(`the ${a} nectar box is on its own driver's LEFT`, Math.sign(near) === Math.sign(lzY), `${near.toFixed(2)} vs LZ ${lzY.toFixed(2)}`);
        check(
          `the ${a} nectar box is clear of the drive team area (it used to sit in the middle of it)`,
          Math.abs(near) >= tape,
          `${Math.abs(near).toFixed(2)} >= ${tape}`,
        );
        // and it stays inside the field's own y footprint -- a box past the corner reads as
        // furniture belonging to nothing.
        check(
          `the ${a} nectar box stays within the field's y span`,
          Math.max(Math.abs(r.y0), Math.abs(r.y1)) <= BB_HALF_Y,
          `${Math.max(Math.abs(r.y0), Math.abs(r.y1)).toFixed(2)}`,
        );
      }
      // (3) POINT SYMMETRY, not a mirror. Blue's box is red's rotated 180 degrees about the
      // origin -- which is what puts it on blue's driver's left too.
      const red = bbNectarBoxRect('red');
      const blue = bbNectarBoxRect('blue');
      check(
        'blue nectar box is the POINT mirror of red (the x-mirror lands on the wrong half)',
        Math.abs(blue.x0 + red.x1) < 1e-9 && Math.abs(blue.y0 + red.y1) < 1e-9,
        `${JSON.stringify(blue)} vs ${JSON.stringify(red)}`,
      );
      for (const a of ['red', 'blue'] as const) {
        const r = bbNectarBoxRect(a);
        for (let i = 0; i < BB_BOX_SLOTS; i++) {
          const s = bbNectarBoxSlot(a, i);
          check(
            `${a} slot ${i} sits inside the tray, a nectar clear of its walls`,
            s.x - BB_NECTAR_R >= r.x0 && s.x + BB_NECTAR_R <= r.x1 && s.y - BB_NECTAR_R >= r.y0 && s.y + BB_NECTAR_R <= r.y1,
            `${s.x.toFixed(2)},${s.y.toFixed(2)}`,
          );
        }
      }
      // the 2 x 3 slot grid is DECODE's, and at this pitch two nectar clear each other on both
      // axes -- the five `spawn.ts` stages in one row inside a 15.75-in box would overlap.
      const d = 2 * BB_NECTAR_R;
      check('the slot pitch clears a nectar across the box depth', BB_BOX_DEPTH / 2 >= d, `${(BB_BOX_DEPTH / 2).toFixed(2)} >= ${d}`);
      check('and along it', BB_BOX_LEN / 3 >= d, `${(BB_BOX_LEN / 3).toFixed(2)} >= ${d}`);
      check('six slots hold the five staged nectar', BB_BOX_SLOTS >= 5, `${BB_BOX_SLOTS}`);
    }

    // ITEM 8c -- THE 2D FIELD DRAWS THE SAME BOX (owner, 2026-09-19: "Add the same andymark box
    // in the 2d game as well"). SOURCE, because there is no canvas in this lane: what matters is
    // that it comes from the SHARED module rather than from a second copy of the numbers, and
    // that it counts the same `stock` balls the 3D box and the HUD count.
    check(
      'the 2D field draws the holding box from the shared module',
      drawSrc.includes("from './nectarBox'") && /bbNectarBoxRect\(a\)/.test(drawSrc),
    );
    check('the 2D box draws its beads at the shared slot centres', drawSrc.includes('bbNectarBoxSlot(a, i)'));
    check('the 2D box counts the same `stock` balls', /b\.state\.kind === 'stock' && b\.state\.alliance === a/.test(drawSrc));
    check('and it prints no number on the field (nothing here is a letter or a digit)', !drawSrc.includes('NECTAR LEFT'));

    // ITEM 11 -- THE GARDEN'S CORNER. The CAD band stops 0.573in clear of the wall at the
    // alliance corner while `BB_GARDEN` -- the SCORED zone -- snaps that edge onto it, so the
    // drawn band stopped short of the corner it is defined to reach.
    for (const [rel, src] of [
      ['src/games/biobuzz/drawField.ts', drawSrc],
      ['src/games/biobuzz/scene/renderField.ts', fieldSrc],
    ] as const) {
      check(`${rel} draws the garden corner supplement as well as the CAD strips`, src.includes('BB_TAPE.gardenSupplement'), rel);
    }
    check('the CAD path draws the supplement as geometry (the GLB tape is real, so a painted copy would double it)', fieldSrc.includes('buildSupplementalTape'));
    for (const a of ['red', 'blue'] as const) {
      const patches = BB_TAPE.gardenSupplement[a];
      check(`${a}: exactly one garden supplement strip`, patches.length === 1, `${patches.length}`);
      const p = patches[0];
      const band = BB_TAPE.garden[a];
      const bandY0 = Math.min(...band.map((s) => s.y0));
      const bandY1 = Math.max(...band.map((s) => s.y1));
      check(`${a}: the supplement spans the band full 2-in width`, Math.abs(p.y0 - bandY0) < 1e-6 && Math.abs(p.y1 - bandY1) < 1e-6, `${p.y0}..${p.y1} vs ${bandY0}..${bandY1}`);
      check(`${a}: it reaches the perimeter face`, Math.abs(Math.max(Math.abs(p.x0), Math.abs(p.x1)) - BB_HALF_X) < 1e-3, `${p.x0}..${p.x1} vs ${BB_HALF_X}`);
      check(`${a}: and it is short -- a bridge, not a new marking`, p.x1 - p.x0 < 1, `${(p.x1 - p.x0).toFixed(3)}in`);
      const drawnX = [...band, p].flatMap((s) => [s.x0, s.x1]);
      const gardenX = Math.max(Math.abs(BB_GARDEN[a].x0), Math.abs(BB_GARDEN[a].x1));
      check(`${a}: the drawn band now reaches BB_GARDEN own corner`, Math.abs(Math.max(...drawnX.map(Math.abs)) - gardenX) < 1e-3, `${Math.max(...drawnX.map(Math.abs))} vs ${gardenX}`);
      check(`${a}: and BB_GARDEN is unchanged by it (the zone is built from TAPE.garden alone)`, BB_GARDEN[a].y1 - BB_GARDEN[a].y0 > 2 && BB_GARDEN[a].x1 - BB_GARDEN[a].x0 > 20);
    }

    // ITEM 2 -- THE FLOWER'S BACKSTOP (section 9.7, 1.25in tall). The CAD path draws the real
    // part; the constants fallback had no backstop at all, so a fallback field and a CAD field
    // disagreed about a surface a lob comes off.
    check('the constants fallback builds the flower backstop', fieldSrc.includes(':backstop') && /FLOWER_BACKSTOP_H = 1\.25/.test(fieldSrc));
  }
}

/**
 * E1 — THE FIELD'S ON-SCREEN RECT IS A FUNCTION OF THE VIEWPORT, NEVER OF MATCH STATE.
 *
 * `GameController.refreshHudInsets` measures every `[data-hud-band]` and the 3D camera frames
 * the field into what is left, so a band that mounts, unmounts or resizes mid-match moves the
 * field under the driver. BIOBUZZ's cue row did exactly that — it was `{(nectarLocked || pin) &&
 * <div data-hud-band>…}` and vanished at the 1:00 cue. Measured in Electron at 1431×649: the
 * bottom inset fell from 98px to 73px on the unlock tick (owner report, 2026-09-18).
 *
 * SOURCE checks, like the rest of this lane: the rule is about the MARKUP, and the two things
 * that hold it are the row being unconditional and the slot being reserved in both axes (an
 * empty flex row measures 0 on one of them, and a zero-sized band is skipped).
 */
function hudBandChecks(check: Check): void {
  const hud = readFileSync(join(BIOBUZZ_DIR, 'HudSlots.tsx'), 'utf8');
  const css = readFileSync(join(root, 'src', 'ui', 'styles.css'), 'utf8');
  check(
    'E1 HUD BAND: the BIOBUZZ cue row is rendered unconditionally (its CONTENTS come and go)',
    /\n      <div className="breakdown-row" data-hud-band>/.test(hud),
  );
  check(
    'E1 HUD BAND: no `data-hud-band` in HudSlots.tsx sits behind a `&& (` guard',
    !/&&\s*\(\s*\n\s*<div[^>]*data-hud-band/.test(hud),
  );
  const rule = css.slice(css.indexOf('\n.breakdown-row {'), css.indexOf('\n.breakdown-row span'));
  check(
    'E1 HUD BAND: `.breakdown-row` reserves its slot in BOTH axes, so an empty row is still measured',
    /min-height:\s*24px/.test(rule) && /min-width:\s*24px/.test(rule),
    rule.replace(/\s+/g, ' ').slice(0, 120),
  );
  const game = readFileSync(join(root, 'src', 'game.ts'), 'utf8');
  check(
    'E1 HUD BAND: within one layout the safe rect only ever shrinks (`hudInsetsEpoch`)',
    game.includes('hudInsetsEpoch') && /ins\.bottom = Math\.min\(Math\.max\(bottom, keep \? ins\.bottom : 0\)/.test(game),
  );

  // ── 2026-09-19 OWNER REPORT: "ONCE BALLS LAND INSIDE THE HIVE, THEY TELEPORT SLIGHTLY DOWNWARDS"
  //
  // ⚠️ `b.z` IS THE BALL'S BOTTOM. THERE IS ONE EXCEPTION AND IT IS NOT THE HIVE.
  // `syncElement` (sim3d/engineImpl.ts) creates every element body at `b.z + r`, so that is the
  // sim's convention for everything it solves. `renderElements.ts`'s hive branch was drawing at a
  // bare `b.z`, which put every hive element one radius low — 1.4 in for a POLLEN, 1.8 for a
  // NECTAR. It was only VISIBLE on a landing shot, because a shot arrives tagged `flight` (drawn
  // at `b.z + r`) and `derive.ts` retags it `element` the tick it settles: one frame, one radius,
  // straight down.
  //
  // The FLOWER branch genuinely is a centre — `flowerStackZ` returns "Centre heights (in) of every
  // element in the stack" — so it alone draws raw. These two checks pin which is which, because a
  // comment in this file used to claim the hive shared the flower's convention and it did not.
  {
    const els = readFileSync(join(root, 'src', 'games', 'biobuzz', 'scene', 'renderElements.ts'), 'utf8');
    const engine = readFileSync(join(root, 'src', 'games', 'biobuzz', 'sim3d', 'engineImpl.ts'), 'utf8');
    check(
      'the hive branch lifts by the element RADIUS, like the body the sim creates',
      /poseAt\(mesh, idx, b\.pos\.x \+ t \* span, b\.pos\.y, b\.z \+ r\)/.test(els),
    );
    check(
      '...and that IS the sim convention — `syncElement` places the body at `b.z + r`',
      /const centreZ = b\.z \+ r;/.test(engine) && /setTranslation\(b\.pos\.x, b\.pos\.y, centreZ\)/.test(engine),
    );
    check(
      'the FLOWER branch stays raw, because `flowerStackZ` really does return centres',
      /out\.push\(seat \+ r\);/.test(readFileSync(join(root, 'src', 'games', 'biobuzz', 'flower.ts'), 'utf8')),
    );
  }
}
