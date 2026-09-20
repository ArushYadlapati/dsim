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
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { moduleFor } from '../../src/games';
import { hiveCellTarget } from '../../src/games/biobuzz/elements';
import { bbAimHeading, bbTurretSolution } from '../../src/games/biobuzz/robot';
import { bbAimTarget, bbCellSideOf, bbPretendHive, bbTurretShotEnters } from '../../src/games/biobuzz/play';
import { BB_AIM_TOL, BB_CELL_OPEN, BB_HIVE_OPEN_Z, BB_HOOD_DEFAULT_DEG } from '../../src/games/biobuzz/config';
// -- LANE A (FIELD RENDER) imports, kept in their own block beside lane B's --------------
import {
  BB_GARDEN,
  BB_HALF_X,
  BB_HALF_Y,
  BB_LZ,
  BB_NECTAR_R,
  BB_TAPE,
  BB_TAPE_W,
  BB_VIEW_MARGIN,
} from '../../src/games/biobuzz/config';
import { drawBiobuzzField, snapTapeGroup } from '../../src/games/biobuzz/drawField';
// the CAD loader's own DOM-free exports — the AprilTag bitmap, the ID table the manual sets, and
// the creased-normal pass. Importing a `scene/` module here is fine: this is a script, not the
// bundle, and the chunk-boundary checks above read the SOURCE rather than the module graph.
import {
  CREASE_ANGLE_DEG,
  TAG_CELL_IN,
  TAG_IDS as BB_TAG_IDS,
  TAG_SIZE_IN,
  apriltag36h11Cells,
  clearPanelAlphaAt,
  clearPanelLightIndependent,
  clearPanelPresence,
  clearPanelSheenGain,
  clearPanelVeilAt,
  computeCreasedNormals,
  sheetFacingBalance,
  CLEAR_SHEETS_ARE_SINGLE_SIDED,
  assembleFieldGroups,
  hiveFrameComponents,
} from '../../src/games/biobuzz/scene/renderFieldGlb';
import { cadCaptureTheta, fieldColliders3d } from '../../src/games/biobuzz/sim3d/fieldColliders';
import { COLORS as SHARED_COLORS } from '../../src/config';
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
import type { RobotSpec, RobotState } from '../../src/types';
import { bbFlowerInReach, bbFootprint, bbMouths, bbPlacePointLocal } from '../../src/games/biobuzz/robot';
import { bbBoxTubeGlyph } from '../../src/games/biobuzz/parts';
import { BB_INTAKE_KINDS, bbIntakeKindOf, bbLiftOf } from '../../src/games/biobuzz/mechs';
import { drawBiobuzzIntakeReach } from '../../src/games/biobuzz/drawRobot';
import {
  BB_BOX_TUBE_EXTEND_S,
  BB_BOX_TUBE_SECTIONS,
  BB_BOX_TUBE_STAGE_OVERLAP,
  BB_BOX_TUBE_TIP_CLEAR,
  BB_BOX_TUBE_WALL,
  BB_BOX_TUBE_Z,
  bbBoxTubeAim,
  bbBoxTubeStages,
  BB_BRACE_PROUD,
  BB_DECK_Z,
  BB_FLOWERS,
  BB_FLOWER_OPEN_R,
  BB_FLOWER_TOP_Z,
  BB_PLACE_TOL,
  BB_FEED_WALL_T,
  BB_FLYWHEEL_CLEAR,
  BB_FLYWHEEL_D_MM,
  BB_FLYWHEEL_R,
  bbHead,
  BB_HOOD_ARM_INSET,
  BB_HOOD_ARM_T,
  BB_HOOD_T,
  BB_HOOD_WRAP,
  BB_LAUNCH_Z0,
  BB_RAMP_ANGLE,
  BB_RAMP_DEPLOY_S,
  BB_RAMP_L,
  BB_RAMP_OUT,
  BB_RAMP_PIVOT_BACK,
  BB_RAMP_TIP_Z,
  BB_SHOOTER_PLATE_T,
  BB_SIDE_PLATE_BOTTOM_Z,
  BB_SIDE_PLATE_FRONT_X,
  BB_SIDE_PLATE_TOP_Z,
  BB_SIDE_ROLLER_REACH,
  BB_SIDE_ROLLER_Y,
  BB_TURRET_AXLE_Z,
  BB_TURRET_BRACE_R,
  BB_TURRET_BRACES,
  BB_TURRET_MOTOR_R,
  BB_TURRET_PITCH_MAX,
  BB_TURRET_PITCH_MIN,
  BB_TURRET_PLATE_TOP_Z,
  BB3_HEIGHT_DEFAULT,
  BB3_HEIGHT_MIN,
  BB3_MOUTH_SLOT_Z,
} from '../../src/games/biobuzz/config';
// ⚠️ THE ONE PLACE IN THIS LANE THAT REACHES INTO `scene/`, AND THE ONLY SCRIPT THAT IMPORTS
// `three`. The chunk-boundary rules this file enforces are about `src/`; a Node smoke script is
// not bundled, and `buildTurret` touches no DOM. It is here because five passes of shooter
// geometry were signed off by a lane that could only grep the source — see its own header, and
// the SHOOTER block below.
import {
  BB_INTAKE_ARM_INSET,
  BB_SIGN_DIGIT_H,
  BB_SIGN_H,
  BB_SIGN_MARGIN,
  BB_SIGN_MIN_H,
  BB_SIGN_MIN_W,
  BB_SIGN_W,
  bbRobotSignOrientation,
  bbRobotSignText,
  buildFrame,
  buildIntake,
  buildSwervePod,
  buildTurret,
  disposeRobotGroup,
} from '../../src/games/biobuzz/scene/renderRobots';
import { lengthLimits } from '../../src/sim/drivetrain';
import { bbMouthFrame } from '../../src/games/biobuzz/mounts';
import { bbMuzzleLocal } from '../../src/games/biobuzz/robot';
import { INTAKE_RAIL_T } from '../../src/config';
import { BB_DEFAULT_SPEC } from '../../src/games/biobuzz/coerce';
import { bbCoerceSpec } from '../../src/games/biobuzz/robotConfig';
import { bbSpecKey } from '../../src/games/biobuzz/specKey';
import { SHOT, SHOT_ARC_MAX, shotArc, solveShotPath } from '../../src/games/biobuzz/shotPath';
import { drawBiobuzzShotPath } from '../../src/games/biobuzz/drawShot';
import { CAMERA_PREFS, getCameraPref, resolveSceneCamera } from '../../src/games/biobuzz/graphics/store';
import {
  GFX_PIXEL_BUDGET,
  GFX_PRESETS,
  GFX_TIERS,
  getGraphics,
  resetGraphicsToAuto,
  setGraphicsTier,
  coerceGraphicsSettings,
  coerceMaxFps,
  effectivePixelRatio,
  fpsFromSliderPos,
  frameIntervalMs,
  GFX_FPS_MAX,
  GFX_FPS_MIN,
  GFX_FPS_SLIDER_MAX,
  GFX_FPS_SLIDER_NO_CAP,
  GFX_FPS_STEPS,
  isCustomFps,
  matchesPreset,
  MAX_FPS_UNLIMITED,
  MAX_FPS_VSYNC,
  msaaSamples,
  shadowMapSize,
  sliderPosFromFps,
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
/**
 * THE SHIPPED FIELD ASSET, DECODED ONCE AT MODULE LOAD — GL-free, in Node, through the very
 * loader the app uses. It is a TOP-LEVEL await because a lane function is synchronous and
 * `GLTFLoader.parse` is not: `EXT_meshopt_compression` is required by this file, so the decoder's
 * wasm has to come up before a single triangle exists. ~1 s, once, and it is what lets the
 * back-face check below measure the REAL geometry instead of a belief about it.
 */
async function parseShippedGlb(file: string): Promise<THREE.Group | null> {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const buf = readFileSync(join(here, '..', '..', 'public', 'models', 'biobuzz', file));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    return await new Promise<THREE.Group | null>((resolve) => {
      loader.parse(ab, '', (g) => resolve(g.scene), () => resolve(null));
    });
  } catch {
    return null;
  }
}
const FIELD_GLB_SCENE: THREE.Object3D | null = await parseShippedGlb('field.glb');
/** the LOW LOD too — the hive's mis-filed parts have to be found on BOTH, and it is the one the
 *  `assembleFieldGroups` check can run end to end, because only the HIGH path wants a canvas. */
const FIELD_LOW_GLB_SCENE: THREE.Group | null = await parseShippedGlb('field-low.glb');

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

  // ---- `three` (bare OR a subpath) appears ONLY under scene/, anywhere in src/ -----------
  /**
   * ⚠️ TWO HOLES, BOTH OF WHICH LET A THREE.JS IMPORT INTO THE MAIN CHUNK UNSEEN.
   *
   * It matched the BARE specifier only, so `import { GLTFLoader } from 'three/examples/jsm/...'`
   * — which is how three's loaders and controls are actually reached, and which pulls three
   * itself in as a dependency — read as not an import of three at all. And it scanned only
   * `src/games/biobuzz/**`, so the same line in `src/ui/`, `src/render/` or `src/lib/` was
   * outside the scan entirely; those are ordinary MAIN-chunk files, which is the worst place for
   * it and the only place this check exists to protect. The sim3d boundary scan three blocks
   * below has always walked all of `src/` — this is the same statement about the other chunk.
   */
  const threeRx = /from\s+['"]three(\/[^'"]*)?['"]|import\(\s*['"]three(\/[^'"]*)?['"]\s*\)/;
  const isSceneFile = (p: string): boolean => p.startsWith(SCENE_DIR + sep) || p.startsWith(SCENE_DIR + '/');
  const threeOutside: string[] = [];
  const threeInside: string[] = [];
  for (const p of walkTs(join(root, 'src'))) {
    codeLines(p).forEach((line, i) => {
      if (!threeRx.test(line)) return;
      (isSceneFile(p) ? threeInside : threeOutside).push(`${relPosix(p)}:${i + 1}`);
    });
  }
  check('every scene/ render file that uses three.js actually imports it (else the next check is vacuous)', threeInside.length > 0);
  check("'three' (bare or a subpath) is imported ONLY by files under scene/, across all of src/", threeOutside.length === 0, threeOutside.join(', '));

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
      // ...and it does not reach for DECODE's tape width either. `C.TAPE_W` and `BB_TAPE_W` are
      // both 1 in by coincidence -- one is DECODE's field, one is the BIOBUZZ CAD's -- and a
      // BIOBUZZ width with two homes is a width that can drift in one of them (owner, 2026-09-19:
      // "tape mark widths are inconsistent").
      const tapeW = codeLines(join(root, rel)).map((l, i) => ({ l, i })).filter((r) => /\bC\.TAPE_W\b/.test(r.l));
      check(
        `${rel} does NOT read the shared C.TAPE_W (this field's width is BB_TAPE_W, from the CAD)`,
        tapeW.length === 0,
        tapeW.map((r) => `${rel}:${r.i + 1}`).join(', '),
      );
    }

    // THE TWO RENDERERS DRAW THE SAME LIST OF MARKS. Derived from the source rather than stated,
    // so a group added to one and not the other fails here instead of in a screenshot.
    const groupsOf = (rel: string): string =>
      [...new Set([...codeLines(join(root, rel)).join('\n').matchAll(/BB_TAPE\.([A-Za-z]+)/g)].map((m) => m[1]))]
        .sort()
        .join(',');
    const twoD = groupsOf('src/games/biobuzz/drawField.ts');
    const threeD = groupsOf('src/games/biobuzz/scene/renderField.ts');
    check('the 2D and 3D renderers draw the SAME tape groups', twoD === threeD, `2D=${twoD} 3D=${threeD}`);
    check(
      'and that list is the field guide\'s: the LOADING ZONES, the GARDENS, and the corner supplement',
      twoD === 'garden,gardenSupplement,loadingZone',
      twoD,
    );
  }

  // ---- ONE TAPE WIDTH, AND IT IS THE CAD'S --------------------------------------------------
  //
  // Event Field Guide V1.0 §8.1 (p13): the field may be taped with EITHER 1 in or 2 in ProGaff,
  // "the outside perimeter of each zone should be consistent with the specifications, but the tape
  // width may vary". §8.3's figure draws the LOADING ZONE both ways; §8.4's draws the GARDEN as
  // [2] 1-in pieces OR [1] 2-in piece. The CAD ships the 1-in build -- `tape.widthsIn` is a
  // ONE-element list -- so that is the build the sim draws, and `BB_TAPE_W` is the one name for it.
  //
  // This is the data half of the owner's "tape mark widths are inconsistent": every rectangle a
  // renderer fills has to BE that width, not merely come from the same file.
  {
    for (const group of ['loadingZone', 'garden', 'allianceArea'] as const) {
      for (const a of ['red', 'blue'] as const) {
        const strips = BB_TAPE[group][a];
        const wrong = strips.filter((s) => Math.abs(Math.min(s.x1 - s.x0, s.y1 - s.y0) - BB_TAPE_W) > 1e-6);
        check(
          `${group}/${a}: every strip is exactly BB_TAPE_W across`,
          strips.length > 0 && wrong.length === 0,
          `${strips.length} strips, ${wrong.length} off ${BB_TAPE_W}in`,
        );
      }
    }
    // the GARDEN's "approximately 2 in." (§8.4) is TWO of them laid side by side with no mat
    // between -- the band is solid, which is the difference between a band and an outline.
    for (const a of ['red', 'blue'] as const) {
      const band = BB_TAPE.garden[a];
      const lo = Math.min(...band.map((s) => s.y0));
      const hi = Math.max(...band.map((s) => s.y1));
      const edges = [...band.map((s) => s.y0), ...band.map((s) => s.y1)].sort((p, q) => p - q);
      check(`garden/${a}: the band is exactly 2 x BB_TAPE_W deep`, Math.abs(hi - lo - 2 * BB_TAPE_W) < 1e-6, `${(hi - lo).toFixed(3)}in`);
      check(`garden/${a}: ...and the two tapes TOUCH, so the band is solid`, band.length === 2 && Math.abs(edges[1] - edges[2]) < 1e-6, edges.join(','));
    }
  }

  // ---- NO CENTRE CROSS: THE FIELD HAS NO MARKING AT THE ORIGIN ------------------------------
  //
  // Owner, 2026-09-19: "centre cross tape mark does not exist, I think. Check manual." It does
  // not. Event Field Guide V1.0 §8 "Tape Placement" installs exactly three things -- §8.3 LOADING
  // ZONES, §8.4 GARDENS, §8.5 ALLIANCE AREAS -- and manual Fig 9-2 (p65) shows no marking at the
  // centre. It could not have one: guide §9.1 has you REMOVE the four centre tiles for the
  // frame's under-tile strips, so the origin is bare tile under the HIVE structure.
  //
  // Both renderers drew a white cross 8 in across at tape width there, for the gallery's benefit.
  // The 2D half is checked by RUNNING it (the calls are the behaviour, the same way the shot path
  // is checked below): every tape-coloured rectangle has to be one of the CAD's strips, and the
  // only WHITE line inside the perimeter has to be the perimeter itself.
  {
    interface Rect { x: number; y: number; w: number; h: number; fill: string }
    interface Seg { x0: number; y0: number; x1: number; y1: number; stroke: string }
    const rects: Rect[] = [];
    const segs: Seg[] = [];
    let fillStyle = '';
    let strokeStyle = '';
    let tx = 0;
    let ty = 0;
    let scale = 1;
    let rotated = false;
    const stack: [number, number, number, boolean][] = [];
    let cur: [number, number] | null = null;
    const pending: Seg[] = [];
    const ctx = {
      save() { stack.push([tx, ty, scale, rotated]); },
      restore() { const p = stack.pop(); if (p) { [tx, ty, scale, rotated] = p; } },
      translate(x: number, y: number) { tx += scale * x; ty += scale * y; },
      scale(sx: number) { scale *= sx; },
      rotate() { rotated = true; },
      transform() { rotated = true; },
      setTransform() { rotated = true; },
      getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
      fillRect(x: number, y: number, w: number, h: number) {
        if (!rotated) rects.push({ x: tx + scale * x, y: ty + scale * y, w: scale * w, h: scale * h, fill: fillStyle });
      },
      strokeRect() {},
      beginPath() { cur = null; pending.length = 0; },
      moveTo(x: number, y: number) { cur = [tx + scale * x, ty + scale * y]; },
      lineTo(x: number, y: number) {
        const p: [number, number] = [tx + scale * x, ty + scale * y];
        if (cur && !rotated) pending.push({ x0: cur[0], y0: cur[1], x1: p[0], y1: p[1], stroke: strokeStyle });
        cur = p;
      },
      stroke() { for (const s of pending) segs.push({ ...s, stroke: strokeStyle }); pending.length = 0; },
      closePath() { cur = null; },
      fill() { pending.length = 0; },
      clip() {}, rect() {}, arc() {}, arcTo() {}, ellipse() {}, setLineDash() {}, drawImage() {},
      fillText() {}, strokeText() {}, measureText() { return { width: 0 }; },
      set fillStyle(v: string) { fillStyle = v; },
      get fillStyle() { return fillStyle; },
      set strokeStyle(v: string) { strokeStyle = v; },
      get strokeStyle() { return strokeStyle; },
      set lineWidth(_v: number) {}, set lineCap(_v: string) {}, set lineJoin(_v: string) {},
      set font(_v: string) {}, set textAlign(_v: string) {}, set textBaseline(_v: string) {},
      set globalAlpha(_v: number) {},
    } as unknown as CanvasRenderingContext2D;

    drawBiobuzzField(ctx, mkWorld('solo', 7), { x: 0, y: 1 });

    // the two gaffer colours this renderer uses -- read off the source rather than re-typed, so a
    // palette edit cannot make this check blind instead of red.
    const drawSrcTape = readFileSync(join(root, 'src/games/biobuzz/drawField.ts'), 'utf8');
    const gaffer = [...drawSrcTape.matchAll(/TAPE_GAFFER[^=]*=\s*\{[^}]*\}/g)]
      .flatMap((m) => [...m[0].matchAll(/'(#[0-9a-fA-F]{6})'/g)].map((c) => c[1].toLowerCase()));
    const blueTape = /const ALLIANCE_BLUE = '(#[0-9a-fA-F]{6})'/.exec(drawSrcTape)?.[1].toLowerCase();
    if (blueTape) gaffer.push(blueTape);
    check('the 2D renderer names two gaffer colours', new Set(gaffer).size === 2, gaffer.join(','));

    const expected = (['loadingZone', 'garden', 'gardenSupplement'] as const).flatMap((g) =>
      (['red', 'blue'] as const).flatMap((a) => BB_TAPE[g][a].map((s) => `${s.x0.toFixed(3)},${s.y0.toFixed(3)},${(s.x1 - s.x0).toFixed(3)},${(s.y1 - s.y0).toFixed(3)}`)),
    );
    const painted = rects
      .filter((r) => gaffer.includes(String(r.fill).toLowerCase()))
      .map((r) => `${r.x.toFixed(3)},${r.y.toFixed(3)},${r.w.toFixed(3)},${r.h.toFixed(3)}`);
    check(
      'the 2D field paints exactly the CAD strips it claims, and nothing else in a tape colour',
      painted.length === expected.length && [...painted].sort().join('|') === [...expected].sort().join('|'),
      `${painted.length} painted vs ${expected.length} expected`,
    );

    // ══ EVERY TAPE ON SCREEN IS ONE WIDTH, IN PIXELS ═════════════════════════════════════════
    // Owner, 2026-09-19, the FIFTH report of "tape widths look inconsistent" — and the data was
    // never wrong (the check above; every strip is 1.000 in). The map draws at 2–6 device px per
    // inch, so a 1-in strip is ~3.1 px and where its edges fall inside a pixel decided whether it
    // came out as three solid columns or two solid and two half-lit. `snapTapeGroup` gives every
    // strip of a zone the same whole-pixel width on a real canvas. Swept over scales, sub-pixel
    // offsets, both y senses and both axis-aligned rotations: one width, the LOADING ZONE's U
    // closed with no pixel painted twice and none missed, the GARDEN band exactly two widths.
    {
      let cases = 0;
      let badWidth = 0;
      let badJoin = 0;
      let badBand = 0;
      for (let sc = 1.3; sc < 9; sc += 0.137) {
        for (let off = 0; off < 1; off += 0.23) {
          for (const flip of [1, -1]) {
            for (const quarter of [false, true]) {
              const m = quarter
                ? { a: 0, b: sc, c: -sc * flip, d: 0, e: 400.3 + off, f: 300.7 + off * 2 }
                : { a: sc, b: 0, c: 0, d: -sc * flip, e: 400.3 + off, f: 300.7 + off * 2 };
              const w = Math.max(1, Math.round(sc * BB_TAPE_W));
              for (const a of ['red', 'blue'] as const) {
                cases++;
                const lz = snapTapeGroup(m, BB_TAPE.loadingZone[a]);
                if (!lz || lz.some(([, , ww, hh]) => Math.min(ww, hh) !== w)) badWidth++;
                if (lz) {
                  const x0 = Math.min(...lz.map((r) => r[0]));
                  const y0 = Math.min(...lz.map((r) => r[1]));
                  const W = Math.max(...lz.map((r) => r[0] + r[2])) - x0;
                  const H = Math.max(...lz.map((r) => r[1] + r[3])) - y0;
                  const grid = new Uint8Array(W * H);
                  for (const [x, y, ww, hh] of lz) {
                    for (let j = y; j < y + hh; j++) for (let i = x; i < x + ww; i++) grid[(j - y0) * W + (i - x0)]++;
                  }
                  // a closed U of thickness w on three sides of a W×H box covers exactly this many
                  // pixels once each: the two full-depth strips plus the span between them
                  const depth = lz.map((r) => Math.max(r[2], r[3])).sort((p, q) => p - q);
                  const want = 2 * w * depth[0] + w * (depth[2] - 0) ;
                  let painted = 0;
                  let twice = 0;
                  for (const v of grid) {
                    if (v) painted++;
                    if (v > 1) twice++;
                  }
                  const area = lz.reduce((acc, r) => acc + r[2] * r[3], 0);
                  const spans = Math.max(W, H) === depth[2] + 2 * w; // the inner strip reaches both depth strips exactly
                  if (twice !== 0 || painted !== area || !spans || !(want > 0)) badJoin++;
                }
                const garden = [...BB_TAPE.garden[a], ...BB_TAPE.gardenSupplement[a]];
                const band = {
                  x0: Math.min(...garden.map((r) => r.x0)),
                  y0: Math.min(...garden.map((r) => r.y0)),
                  x1: Math.max(...garden.map((r) => r.x1)),
                  y1: Math.max(...garden.map((r) => r.y1)),
                };
                const gd = snapTapeGroup(m, [band]);
                if (!gd || Math.min(gd[0][2], gd[0][3]) !== 2 * w) badBand++;
              }
            }
          }
        }
      }
      check('tape: every LOADING ZONE strip is the same whole-pixel width at every scale and offset', badWidth === 0, `${badWidth} of ${cases}`);
      check('tape: the LOADING ZONE’s U closes exactly — no pixel twice, none missed, the inner strip meets both', badJoin === 0, `${badJoin} of ${cases}`);
      check('tape: the GARDEN band is exactly two tape widths (Fig 9-3: two 1-in tapes side by side)', badBand === 0, `${badBand} of ${cases}`);
      check(
        'tape: a rotated view is left to the rasteriser (there is no pixel grid to snap to)',
        snapTapeGroup({ a: 0.7, b: 0.7, c: -0.7, d: 0.7, e: 0, f: 0 }, BB_TAPE.loadingZone.red) === null,
      );
      const garden = [...BB_TAPE.garden.red, ...BB_TAPE.gardenSupplement.red];
      const bandArea =
        (Math.max(...garden.map((r) => r.x1)) - Math.min(...garden.map((r) => r.x0))) *
        (Math.max(...garden.map((r) => r.y1)) - Math.min(...garden.map((r) => r.y0)));
      const sum = garden.reduce((acc, r) => acc + (r.x1 - r.x0) * (r.y1 - r.y0), 0);
      check('tape: the GARDEN’s two strips and its corner patch TILE their band (so it may be drawn as one)', Math.abs(bandArea - sum) < 1e-6, `${bandArea.toFixed(4)} vs ${sum.toFixed(4)}`);
      const drawSrc2 = readFileSync(join(root, 'src/games/biobuzz/drawField.ts'), 'utf8');
      check(
        'tape: the 2D map paints each zone through the snapped group, never strip by strip',
        drawSrc2.includes('fillTapeGroup(ctx, BB_TAPE.loadingZone[a], TAPE_GAFFER[a]);') &&
          drawSrc2.includes('fillTapeGroup(ctx, garden, TAPE_GAFFER[a], [bandOf(garden)]);') &&
          !/for \(const strip of BB_TAPE\.\w+\[a\]\) fillStrip\(/.test(drawSrc2),
      );
    }
    // every painted mark is BB_TAPE_W across -- the same statement as the data check above, but
    // made against what actually reached the canvas.
    const tapeRects = rects.filter((r) => gaffer.includes(String(r.fill).toLowerCase()));
    const offWidth = tapeRects.filter((r) => Math.abs(Math.min(Math.abs(r.w), Math.abs(r.h)) - BB_TAPE_W) > 1e-6);
    check(
      'every painted STRIP is exactly one tape wide',
      tapeRects.length > 0 && offWidth.length === 2,
      `${tapeRects.length} marks, ${offWidth.length} not one tape across`,
    );
    // the two exceptions are the garden corner PATCHES, and they are the band's own 2 x depth by a
    // length shorter than a tape -- a bridge to the wall, not a marking with a width of its own.
    check(
      '...and the two that are not are the garden corner patches: 2 x deep, under a tape long',
      offWidth.length === 2 &&
        offWidth.every(
          (r) => Math.abs(Math.max(Math.abs(r.w), Math.abs(r.h)) - 2 * BB_TAPE_W) < 1e-6 && Math.min(Math.abs(r.w), Math.abs(r.h)) < BB_TAPE_W,
        ),
      offWidth.map((r) => `${r.w.toFixed(3)}x${r.h.toFixed(3)}`).join(' '),
    );

    // THE CENTRE CROSS ITSELF: no white line anywhere inside the perimeter. The cross was two
    // 8-in white segments through the origin; the perimeter, the only other white line on this
    // canvas, sits ON the wall.
    const inside = segs.filter(
      (s) =>
        String(s.stroke).toLowerCase() === SHARED_COLORS.white.toLowerCase() &&
        Math.max(Math.abs(s.x0), Math.abs(s.x1)) < BB_HALF_X - 1e-6 &&
        Math.max(Math.abs(s.y0), Math.abs(s.y1)) < BB_HALF_Y - 1e-6,
    );
    check(
      'the 2D field draws NO white line inside the perimeter (there is no centre mark on this field)',
      inside.length === 0,
      inside.map((s) => `(${s.x0.toFixed(1)},${s.y0.toFixed(1)})->(${s.x1.toFixed(1)},${s.y1.toFixed(1)})`).join(' '),
    );
    check('...and the probe was not vacuous -- the renderer did stroke and fill', segs.length > 0 && rects.length > 0, `${segs.length} segs, ${rects.length} rects`);

    // the 3D half is a source check, because the floor texture needs a DOM canvas.
    const floorSrc = readFileSync(join(root, 'src/games/biobuzz/scene/renderField.ts'), 'utf8');
    const at = floorSrc.indexOf('function buildFloorTexture(');
    const body = at < 0 ? '' : floorSrc.slice(at, floorSrc.indexOf('function buildFloor(', at));
    const originAnchored = /toTex\(0,\s*0\)/.test(body.replace(/\/\/.*$/gm, ''));
    check(
      'the 3D floor texture paints the seam grid and the tape, and nothing at the origin',
      body.length > 0 && !originAnchored,
      body.length === 0 ? 'buildFloorTexture not found' : originAnchored ? 'toTex(0, 0) is back' : `${body.length} chars scanned`,
    );
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

    // ⚠️ THE PATH'S VERDICT IS THE FIRE GATE'S, POSE FOR POSE (owner ruling, 2026-09-19: the path
    // is drawn "in the case that we can make the shot assuming that the hive is completely up on
    // the side that we are aiming for"). Stage 5b's gate asks `bbTurretShotEnters` of
    // `bbPretendHive(hive, bbCellSideOf(target))`; so does the path, and this re-asks it by hand
    // over a spread of poses — the far corner included, which used to read NOT MADE only because
    // the REAL hive had the nearer cell down.
    {
      let disagree = 0;
      let mades = 0;
      const poses: [number, number][] = [[-60, -60], [-60, 60], [60, -60], [60, 60], [0, -50], [0, 50], [-40, 0], [40, 0], [cell.pos.x, cell.pos.y + 40], [cell.pos.x, 5]];
      for (const [px, py] of poses) {
        const wp = aimed(px, py);
        const rp = wp.robots[0];
        const tp = bbAimTarget(wp, rp);
        const solp = bbTurretSolution(rp, tp, 0);
        const gate =
          !!solp && solp.reachable && bbTurretShotEnters(bbPretendHive(wp.biobuzz!.hives[rp.alliance], bbCellSideOf(tp)), rp, 0, solp.speed, 1 / 60);
        const path = solveShotPath(wp, rp);
        if (path) mades++;
        if (path !== gate) disagree++;
      }
      check('shot path: over a spread of poses the path is drawn EXACTLY when the fire gate would release', disagree === 0 && mades > 0 && mades < poses.length, `${disagree} disagreements, ${mades}/${poses.length} made`);
    }

    // AND THE CLOSED SIDE: parked between the two cells, the nearer one is the one facing away.
    const w3b = aimed(cell.pos.x, 5);
    check(
      'shot path: from between the cells (the nearer one faces away) reports NOT MADE',
      !solveShotPath(w3b, w3b.robots[0]) && !SHOT.made,
    );

    // THE AIMED CELL IS ASSUMED FULLY UP (owner ruling, 2026-09-19). Flip it DOWN and the path is
    // still drawn: what the path promises is the SHOT, not the tray's timing, and a driver lining
    // up on the cell that is about to come up is exactly who needs it. This check used to assert
    // the opposite ("the REAL hive is read").
    const w4 = aimed(cell.pos.x, cell.pos.y + 40);
    w4.biobuzz!.hives.blue.up = 'south';
    check(
      'shot path: the same shot at a cell that is DOWN is still MADE (the aimed cell is assumed up)',
      solveShotPath(w4, w4.robots[0]) && SHOT.made && SHOT.points >= 2,
      `points=${SHOT.points}`,
    );

    // ⚠️ **A SHOT THAT CANNOT BE TAKEN IS AS UN-MADE AS ONE THAT FALLS SHORT** (owner,
    // 2026-09-19: "the dotted lines still appear when the shot is not able to be made").
    // `bbCanFire` is the non-ballistic half of the gate and these are its three clauses.
    {
      const wEmpty = aimed(cell.pos.x, cell.pos.y + 40);
      wEmpty.robots[0].hopper.length = 0;
      check(
        'shot path: an EMPTY hopper reports NOT MADE (there is no shot to promise)',
        !solveShotPath(wEmpty, wEmpty.robots[0]) && !SHOT.made && SHOT.points === 0,
        `points=${SHOT.points}`,
      );
      const wPre = aimed(cell.pos.x, cell.pos.y + 40);
      wPre.match = { ...wPre.match, phase: 'pre' };
      check(
        'shot path: outside a LIVE phase reports NOT MADE (nothing fires in `pre`)',
        !solveShotPath(wPre, wPre.robots[0]) && !SHOT.made,
        `phase=${wPre.match.phase}`,
      );
      const wPassive = aimed(cell.pos.x, cell.pos.y + 40);
      wPassive.robots[0].passive = true;
      check('shot path: a PASSIVE practice dummy reports NOT MADE', !solveShotPath(wPassive, wPassive.robots[0]) && !SHOT.made);
      // A SWINGING HIVE DOES NOT DARKEN THE PATH EITHER — same ruling. For one afternoon this
      // refused outright (`hive.tipping > 0`), because a mid-swing cell was the whole residual of
      // "a path was drawn and the shot did not score" (28 of 28 in 3D). The owner's rule is that
      // the path answers for the shot with the aimed side assumed up; whether the tray is there
      // when the element arrives is the driver's call, off the HUD's cell state.
      const wTip = aimed(cell.pos.x, cell.pos.y + 40);
      wTip.biobuzz!.hives.blue.tipping = 1.5;
      check(
        'shot path: a cell MID-SWING is still MADE (the aimed cell is assumed up and settled)',
        solveShotPath(wTip, wTip.robots[0]) && SHOT.made && SHOT.points >= 2,
        `tipping=${wTip.biobuzz!.hives.blue.tipping}`,
      );
    }

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

      // the same ruling as the turret — the aimed cell is assumed up — and the one negative that
      // is about RANGE: the far corner is a dump that cannot arrive at all.
      const wd3 = dumper(cell.pos.x, cell.pos.y + 30);
      wd3.biobuzz!.hives.blue.up = 'south';
      check(
        'shot path (dumper): the same dump at a cell that is DOWN is still MADE (assumed up)',
        solveShotPath(wd3, wd3.robots[0]) && SHOT.made,
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
    /**
     * A NON-INTERACTIVE SCENE IS FULLY HOST-CONTROLLED (owner report: picking Chase in the
     * replay download menu exported Driver instead). `resolveSceneCamera` is what
     * `resolvedCamera` above delegates to — an INTERACTIVE scene (the live match, a Graphics
     * preview) still defers to the device's own camera preference except when it is `'auto'`,
     * but an export or a still (`interactive: false` — `ReplayView`'s `startCapture`,
     * `Gallery.tsx`'s stills) ignores the stored preference entirely and renders exactly the
     * camera its host asked for, whatever a player last cycled to while driving.
     */
    check(
      'resolveSceneCamera: an interactive scene defers to the device pref, except auto',
      resolveSceneCamera(true, 'chase', 'driver') === 'driver' &&
        resolveSceneCamera(true, 'chase', 'auto') === 'chase' &&
        resolveSceneCamera(true, 'orbit', 'orbit') === 'orbit',
    );
    check(
      'resolveSceneCamera: a non-interactive scene (an export, a still) ignores the device pref',
      resolveSceneCamera(false, 'chase', 'driver') === 'chase' &&
        resolveSceneCamera(false, 'orbit', 'chase') === 'orbit' &&
        resolveSceneCamera(false, 'driver', 'orbit') === 'driver' &&
        // even 'auto' does not fall through to anything but the host's own pick here
        resolveSceneCamera(false, 'overhead', 'auto') === 'overhead',
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

  // ---- the two sentinels, and the rate you type -------------------------------------------
  //
  // `maxFps` stopped being a union of literals when the owner asked for a typed rate
  // (2026-09-19), which makes it the one field in this settings object whose value arrives
  // from a TEXT BOX. Everything below is a shape the box can produce.
  {
    // Unlimited and VSync are the SAME instruction to the draw loop — skip nothing. The
    // difference is entirely whether the Electron shell was launched with
    // `disable-frame-rate-limit`, which nothing in this process can see or change.
    check(
      'both sentinels mean no cap at all in the loop (VSync and Unlimited)',
      frameIntervalMs(MAX_FPS_VSYNC) === 0 && frameIntervalMs(MAX_FPS_UNLIMITED) === 0,
    );
    check('the two sentinels cannot collide with a real rate', MAX_FPS_VSYNC === 0 && MAX_FPS_UNLIMITED === -1 && GFX_FPS_MIN > 0);
    check(
      'a typed rate keeps the same 0.5 ms of slack as a tile',
      Math.abs(frameIntervalMs(165) - (1000 / 165 - 0.5)) < 1e-12 && frameIntervalMs(165) > 0,
      frameIntervalMs(165).toFixed(3),
    );
  }
  {
    // A preset shipping Unlimited would turn vsync off on a machine nobody asked, and (on the
    // desktop) leave it off until somebody found this row again.
    check('no preset ships Unlimited', GFX_TIERS.every((t) => GFX_PRESETS[t].maxFps !== MAX_FPS_UNLIMITED));
    check(
      'every preset ships a value the picker can show as selected (a tile or a sentinel)',
      GFX_TIERS.every((t) => {
        const f = GFX_PRESETS[t].maxFps;
        return f === MAX_FPS_VSYNC || f === MAX_FPS_UNLIMITED || GFX_FPS_STEPS.includes(f);
      }),
    );
    check('the tiles are inside the typed range, so the two controls agree', GFX_FPS_STEPS.every((f) => f >= GFX_FPS_MIN && f <= GFX_FPS_MAX));
    check(
      'isCustomFps is exactly "a positive rate that is not a tile"',
      !isCustomFps(MAX_FPS_VSYNC) && !isCustomFps(MAX_FPS_UNLIMITED) && !isCustomFps(144) && isCustomFps(165),
    );
  }
  {
    // COERCION. The sentinels are matched exactly and first, so no clamp can ever produce one.
    const base = GFX_PRESETS.high.maxFps;
    check('coercion accepts both sentinels unchanged', coerceMaxFps(MAX_FPS_VSYNC, base) === MAX_FPS_VSYNC && coerceMaxFps(MAX_FPS_UNLIMITED, base) === MAX_FPS_UNLIMITED);
    check('a custom rate round-trips', coerceMaxFps(165, base) === 165);
    check(
      'out of range CLAMPS to the bound rather than reverting',
      coerceMaxFps(5, base) === GFX_FPS_MIN && coerceMaxFps(9999, base) === GFX_FPS_MAX,
      `${coerceMaxFps(5, base)}/${coerceMaxFps(9999, base)}`,
    );
    const junk: unknown[] = [NaN, Infinity, -Infinity, '60', 59.5, null, undefined, {}, true, -5];
    check('junk falls back to the base, every shape of it', junk.every((v) => coerceMaxFps(v, base) === base), String(junk.length));
    // -5 is in that list on purpose: an integer below zero that is not the sentinel is not a
    // cap under the floor, it is a corrupt value, and clamping it up to 24 would hand the
    // player a working cap they never chose.
    check('a negative that is not the sentinel does not clamp up into a real cap', coerceMaxFps(-5, base) === base);
  }
  {
    // the whole-object coercer routes through it, and an old stored blob still loads
    const out = coerceGraphicsSettings({ maxFps: 165 }, GFX_PRESETS.medium);
    check('the settings coercer takes a custom rate', out.maxFps === 165);
    check('a stored blob from the fixed-ladder build still loads', coerceGraphicsSettings({ maxFps: 240 }, GFX_PRESETS.medium).maxFps === 240);
    check('a stored blob with junk in it keeps the base rate', coerceGraphicsSettings({ maxFps: 'fast' }, GFX_PRESETS.low).maxFps === GFX_PRESETS.low.maxFps);
  }
  // ---- the slider, since the tile row is gone (owner ruling 2026-09-19) -------------------
  {
    check(
      'the slider round-trips every numeric stop, both directions',
      Array.from({ length: GFX_FPS_SLIDER_MAX - GFX_FPS_MIN + 1 }, (_, i) => GFX_FPS_MIN + i).every(
        (fps) => fpsFromSliderPos(sliderPosFromFps(fps), true, false) === fps,
      ),
    );
    check(
      'a typed rate past the slider ceiling still shows pinned at the top numeric stop, not off the track',
      sliderPosFromFps(GFX_FPS_MAX) === GFX_FPS_SLIDER_MAX && sliderPosFromFps(500) === GFX_FPS_SLIDER_MAX,
    );
    check('either sentinel draws the puck at the one no-cap stop', sliderPosFromFps(MAX_FPS_VSYNC) === GFX_FPS_SLIDER_NO_CAP && sliderPosFromFps(MAX_FPS_UNLIMITED) === GFX_FPS_SLIDER_NO_CAP);
    check(
      'the web can never drag its way to Unlimited — the no-cap stop is always VSync there, whatever it was asked to prefer',
      fpsFromSliderPos(GFX_FPS_SLIDER_NO_CAP, false, false) === MAX_FPS_VSYNC && fpsFromSliderPos(GFX_FPS_SLIDER_NO_CAP, false, true) === MAX_FPS_VSYNC,
    );
    check(
      'the desktop reaches Unlimited only by asking for it, and reaches VSync by not',
      fpsFromSliderPos(GFX_FPS_SLIDER_NO_CAP, true, true) === MAX_FPS_UNLIMITED && fpsFromSliderPos(GFX_FPS_SLIDER_NO_CAP, true, false) === MAX_FPS_VSYNC,
    );
    check(
      'a position below the no-cap stop never yields a sentinel, on either platform',
      [true, false].every(
        (isDesktop) => fpsFromSliderPos(GFX_FPS_SLIDER_MAX, isDesktop, true) !== MAX_FPS_VSYNC && fpsFromSliderPos(GFX_FPS_SLIDER_MAX, isDesktop, true) !== MAX_FPS_UNLIMITED,
      ),
    );
    check('the slider ceiling sits inside the typed range, so a drag and a typed value can agree', GFX_FPS_SLIDER_MAX >= GFX_FPS_MIN && GFX_FPS_SLIDER_MAX < GFX_FPS_MAX);
  }
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
    // THE 3D OVERLAY IS NOT A SECOND READ-OUT ANY MORE. `.bb-gfxstat` sat at `top: 48px;
    // left: 12px` \u2014 on top of the event log at `top: 52px; left: 14px` \u2014 so the scene's
    // counters now go to `src/perfStats.ts` and are printed by the ONE display, `.perf-hud`,
    // in the opposite corner. The scrim clause is still the point of the check: this card
    // floats over a lit 3D background and takes the bands' own token rather than a literal.
    check(
      'the performance read-out has a style, and takes the HUD scrim\u2019s token rather than a second literal',
      css.includes('.perf-hud') && css.includes('.game-root.view-3d .status-wrap') && !css.includes('.bb-gfxstat {'),
    );
    check(
      'the 3D scene publishes its counters instead of drawing its own corner div over the event log',
      readFileSync(join(BIOBUZZ_DIR, 'scene', 'renderStats.ts'), 'utf8').includes('publishRenderStats') &&
        !readFileSync(join(BIOBUZZ_DIR, 'scene', 'renderStats.ts'), 'utf8').includes('createElement'),
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
      // ⚠️ AND IT KEYS ON `teamNumber`, WHICH IS NOT A SHAPE. The ROBOT SIGNS rasterise the number
      // into their texture at BUILD time (R403), so from the day the signs started printing
      // `spec.teamNumber` it became part of the built geometry's identity: without it, editing
      // only the team number leaves the old number on both plates AND in the cached thumbnail.
      // Measured as a behaviour, not grepped — two specs differing in nothing else must not
      // collide.
      {
        const keyFor = (teamNumber: number): string =>
          bbSpecKey(bbCoerceSpec({ ...BB_DEFAULT_SPEC, teamNumber } as RobotSpec));
        const a = keyFor(19745);
        const b = keyFor(12345);
        const same = keyFor(19745);
        check('the rebuild key separates two builds that differ only in team number', a !== b, `${a} vs ${b}`);
        check('...and is stable for the same team number', a === same);
      }

      // ── THE COSMETIC CHASSIS COLOUR, AND THE ALLIANCE (the gap item 1 names) ─────────────
      // 2D has always been fill = `chassisFill(chassisColor)`, alliance = the outline. 3D filled
      // the chassis with the ALLIANCE and never rendered `chassisColor` at all, so a supporter's
      // colour vanished the moment they pressed `t`. This is the fix, pinned.
      check(
        'the 3D chassis is FILLED with chassisFill(spec.chassisColor), the 2D allowlist',
        // the named import, not the whole line: `INTAKE_RAIL_T` joined it when the intake arms
        // became a truss, and pinning the line spelling made this fail for an unrelated reason
        /import \{[^}]*\bchassisFill\b[^}]*\} from '\.\.\/\.\.\/\.\.\/config';/.test(robotsSrc) &&
          robotsSrc.includes('solidMat(chassisFill(spec.chassisColor)'),
      );
      check(
        '...and the ALLIANCE is the outline plus the ROBOT SIGNS, never the fill',
        /LineSegments\(chassisEdges\([^)]*\), lineMat\(color\)\)/.test(robotsSrc) &&
          robotsSrc.includes('getSignTexture(bbRobotSignText(spec), alliance)') &&
          !/chassisGeometry\([^)]*\), solidMat\(color/.test(robotsSrc),
      );

      // ══ THE ROBOT SIGN (§12.4 — R401, R402, R403) ════════════════════════════════════════
      //
      // Owner, 2026-09-19, items 1-3: two signs, not one; follow the real ROBOT SIGN rules; and
      // the number on the plate must be the ROBOT'S team number. The rule text is quoted in
      // `renderRobots.ts`'s own header and every number below is the manual's, not a taste call:
      //
      //   R401  minimum TWO per ROBOT, in >= 2 separate locations on opposite or adjacent
      //         surfaces; minimally 6.5 in wide and 2.5 in tall; supported by the structure.
      //   R402  a SOLID red or blue opaque rectangle >= 6.5 x 2.5 in, and visible markings other
      //         than the R403 number, fasteners, corner/fold/cutout slivers and template marks
      //         are PROHIBITED -- which is why the old white border is gone.
      //   R403  solid opaque WHITE Arabic numerals approx 2.25 in tall, >= 0.25 in of background
      //         round them, never vertically stacked (Fig 12-10 also rules mirrored text out).
      //
      // What shipped before: ONE square placard `min(3.6, length * 0.3)` on the LEFT plate only,
      // with a white stroked frame, printing the robot's SLOT INDEX (`String(id)`, 0..3). Every
      // one of the three rules was broken, and the number was not the team's.
      {
        // -- (1) TWO SIGNS, ONE PER SIDE ------------------------------------------------------
        check(
          'R401: the robot carries TWO ROBOT SIGNS, named left and right',
          robotsSrc.includes("[[1, 'left'], [-1, 'right']] as const") &&
            robotsSrc.includes('sign.name = `robot:${id}:sign:${where}`'),
        );
        check(
          '...on OPPOSITE surfaces, mirrored across the chassis centreline',
          robotsSrc.includes('sign.position.set(0, side * (spec.width / 2 + 0.05), BB_PLATE_H * 0.5)'),
        );
        check('...and the single-placard spelling is gone', !/robot:\$\{id\}:sign`/.test(robotsSrc));

        // -- (2) THE RULED DIMENSIONS ---------------------------------------------------------
        // Against the RULE's floors, which are exported beside the plate, not against a literal
        // copied out of the renderer -- the same reason the tape and plate rectangles are.
        check(`R401.B/R402: the plate is at least 6.5 in wide (${BB_SIGN_W})`, BB_SIGN_W >= BB_SIGN_MIN_W, `${BB_SIGN_W}`);
        check(`R401.C/R402: ...and at least 2.5 in tall (${BB_SIGN_H})`, BB_SIGN_H >= BB_SIGN_MIN_H, `${BB_SIGN_H}`);
        check(
          'R403.A+B: the height is EXACTLY the 2.25-in digits plus 0.25 in of background top and bottom',
          Math.abs(BB_SIGN_H - (BB_SIGN_DIGIT_H + 2 * BB_SIGN_MARGIN)) < 1e-9 && BB_SIGN_DIGIT_H === 2.25 && BB_SIGN_MARGIN === 0.25,
          `${BB_SIGN_H} = ${BB_SIGN_DIGIT_H} + 2 x ${BB_SIGN_MARGIN}`,
        );
        // the rule is an ABSOLUTE size in inches. A sign that scaled with the chassis was under
        // the legal minimum on every build in the game, and would go on being under it.
        check(
          '...and the plate does NOT scale with the chassis (the old `min(3.6, spec.length * 0.3)`)',
          !robotsSrc.includes('spec.length * 0.3') && robotsSrc.includes('new THREE.PlaneGeometry(BB_SIGN_W, BB_SIGN_H)'),
        );
        // and it FITS: the smallest chassis this builder can make is 11 x 10 in, and the side
        // plate it mounts on is `BB_PLATE_H` tall.
        {
          const minLen = Math.min(...(['sloped', 'vector', 'triangle'] as const).map((s) => lengthLimits(s).min));
          check(
            'a 6.5 x 2.75 sign fits the SMALLEST legal chassis side plate',
            BB_SIGN_W <= minLen && BB_SIGN_H <= BB_DECK_Z,
            `${BB_SIGN_W} <= ${minLen} long, ${BB_SIGN_H} <= ${BB_DECK_Z} tall`,
          );
        }

        // -- R402: NOTHING ON THE PLATE BUT THE NUMBER ----------------------------------------
        // The old 6-px white `strokeRect` is not one of R402's four permitted markings. Scoped
        // to the texture builder, because the file legitimately strokes other things.
        {
          const at = robotsSrc.indexOf('function getSignTexture(');
          const body = at < 0 ? '' : robotsSrc.slice(at, robotsSrc.indexOf('\n}', at));
          check('R402: the sign texture strokes nothing (the white border was a prohibited marking)', body.length > 0 && !/stroke/i.test(body));
          check('R402: ...and the whole plate is the solid alliance fill', body.includes("alliance === 'blue' ? BLUE : RED") && body.includes('ctx.fillRect(0, 0, canvas.width, canvas.height)'));
          check('R403.A: ...with WHITE numerals on it', body.includes("ctx.fillStyle = '#ffffff'"));
          check('R403.C: ...on ONE line, never stacked', (body.match(/fillText\(/g) ?? []).length === 1);
        }

        // -- Fig 12-10: NOT MIRRORED ----------------------------------------------------------
        // Measured on the BASIS, not grepped: a mirrored sign is a rule violation the old Euler
        // spelling (`rotation.set(PI/2, PI, 0)` plus a pre-flipped canvas) made invisible.
        for (const side of [1, -1] as const) {
          const m = new THREE.Matrix4().makeRotationFromQuaternion(bbRobotSignOrientation(side));
          const x = new THREE.Vector3().setFromMatrixColumn(m, 0);
          const y = new THREE.Vector3().setFromMatrixColumn(m, 1);
          const z = new THREE.Vector3().setFromMatrixColumn(m, 2);
          const det = new THREE.Vector3().crossVectors(x, y).dot(z);
          const tag = side > 0 ? 'left' : 'right';
          check(`Fig 12-10 (${tag}): the sign basis is a PROPER rotation, so the digits are not mirrored`, Math.abs(det - 1) < 1e-9, `det ${det.toFixed(6)}`);
          check(`R401 (${tag}): ...it faces outward`, Math.abs(z.y - side) < 1e-9 && Math.abs(z.x) < 1e-9 && Math.abs(z.z) < 1e-9, `n=(${z.x},${z.y},${z.z})`);
          check(`R403 (${tag}): ...and it is upright, so the number is not on its side`, Math.abs(y.z - 1) < 1e-9, `up=(${y.x},${y.y},${y.z})`);
        }
        check('the pre-mirrored canvas hack is gone with it', !/ctx\.scale\(-1, 1\)/.test(robotsSrc));

        // -- (3) THE NUMBER IS THE TEAM'S -----------------------------------------------------
        // It printed `String(id)`, the robot's SLOT in the match (0..3). §12.4: a ROBOT SIGN
        // "identifies a ROBOT'S team number".
        check('the sign no longer prints the robot slot index', !robotsSrc.includes('getSignTexture(id,'));
        for (const [n, want] of [[19745, '19745'], [1, '1'], [186033, '186033']] as const) {
          check(`the sign prints spec.teamNumber (${n})`, bbRobotSignText({ teamNumber: n }) === want, bbRobotSignText({ teamNumber: n }));
        }
        // and the unset case matches what the 2D team card does rather than printing a literal 0,
        // which would read as a real team number
        for (const n of [0, -3, Number.NaN] as const) {
          check(`teamNumber ${n} renders the 2D card's '-', not a digit`, bbRobotSignText({ teamNumber: n }) === '-', bbRobotSignText({ teamNumber: n }));
        }
        check(
          "...and that is the same test the 2D card makes (`teamNumber ? '#'+n : '-'`)",
          readFileSync(join(root, 'src', 'ui', 'GameView.tsx'), 'utf8').includes("{p.teamNumber ? `#${p.teamNumber}` : '-'}"),
        );
      }

      // ══ ITEM A -- "THE INTAKE SIDE PLATE IS MESHING WITH CHASSIS" ════════════════════════
      //
      // MEASURED, not guessed: `bbMouths` makes every mouth EXACTLY as wide as the chassis, at
      // every intake preset and every mount. So an arm mounted at `f.half - armT/2` puts its
      // outer face precisely ON the side plate's outer face -- and `armX0 = f.rail - 1.1` runs it
      // 1.1 in back inside the frame, so the two solids overlap for 1.1 in with co-planar outer
      // faces. That is the repo's own documented z-fight ("a co-planar line and surface flicker
      // per pixel per frame, which reads as a rendering fault"), at 1.1 in instead of a line.
      {
        let sites = 0;
        let flush = 0;
        for (const intake of ['sloped', 'vector', 'triangle'] as const) {
          for (const mount of ['front', 'back', 'left', 'right'] as const) {
            const base = BB_DEFAULT_SPEC as unknown as { bbMech: Record<string, unknown> };
            const spec = bbCoerceSpec({ ...BB_DEFAULT_SPEC, intake, bbMech: { ...base.bbMech, intakeMount: mount } } as never);
            for (const m of bbMouths(spec)) {
              const f = bbMouthFrame(m, spec.length / 2, spec.width / 2);
              const chassisHalf = m.edge === 'front' || m.edge === 'back' ? spec.width / 2 : spec.length / 2;
              sites++;
              if (Math.abs(f.half - chassisHalf) < 1e-9) flush++;
            }
          }
        }
        check('the mouth is exactly as wide as the chassis at EVERY preset and mount (the hazard)', sites > 0 && flush === sites, `${flush}/${sites}`);
        check(
          '...so the arm is set inboard of the frame line rather than sharing its outer face',
          robotsSrc.includes('arm.position.set(0, s * (f.half - BB_INTAKE_ARM_INSET - armT / 2), 0)') &&
            !robotsSrc.includes('arm.position.set(0, s * (f.half - armT / 2), 0)'),
        );
        // the inset has to CLEAR the plate, not merely be non-zero: flush against the plate's
        // inner face is still two coincident faces.
        check(
          '...by more than the outer plate is thick, so the two faces are genuinely apart',
          BB_INTAKE_ARM_INSET > 0.22,
          `${BB_INTAKE_ARM_INSET.toFixed(3)} in vs a 0.22-in plate`,
        );
        // ...and not so far that the arm stops reading as the mouth's own side
        check('...and by less than half an inch, so the mouth still reads its own width', BB_INTAKE_ARM_INSET < 0.5, `${BB_INTAKE_ARM_INSET}`);
      }

      // ══ ITEM B -- THE HOOD IS CARRIED, NOT FLOATING ══════════════════════════════════════
      //
      // Owner: "the hood is way too high up and it looks disconnected from the shooter."
      //
      // FIRST, IT IS NOT A PREVIEW ARTIFACT. `pitches[0].rotation.y` is written ONLY by the match
      // sync, so the preview's pitch node sits at its BUILD value of 0 -- which is
      // `BB_TURRET_PITCH_MIN`, i.e. the resting match pose. The preview and a resting match robot
      // are the same picture, so what the close-up found is real geometry.
      {
        check('the preview shows the RESTING match pose (its pitch node is never written)', BB_TURRET_PITCH_MIN === 0, `${BB_TURRET_PITCH_MIN}`);
        check(
          '...because only the match sync writes it',
          (robotsSrc.match(/pitches\[\d\]\.rotation\.y = -\(r\./g) ?? []).length === 2 && !previewSrc.includes('rotation.y'),
        );

        // THE GEOMETRY, run rather than grepped. `sidePlateR` is not exported (it is an internal
        // profile), so this measures the BUILT parts.
        //
        // ⚠️ **AND WHAT REACHES THE HOOD IS THE HOOD'S OWN CHEEK, NOT THE FIXED PLATE.** Two
        // passes grew the fixed plate up to `hoodR` to close this gap, and the owner rejected both
        // ("the shooter parallel plates became ugly. remember that the arc does not need to be
        // big") — because a plate sized to the hood is sized to a part that swings away from it,
        // and at the 80° cap it is left standing as a bare fin. The cheeks are on the PITCH node,
        // so they close the gap at EVERY elevation instead of at one.
        const H = bbHead(0);
        const hoodInner = H.hoodR;
        // the plate's reach, sampled round the profile off the built turret
        const turret = buildTurret(BB_DEFAULT_SPEC, 'front', 0);
        turret.updateMatrixWorld(true);
        let plate: THREE.Mesh | null = null;
        let hood: THREE.Mesh | null = null;
        let cheek: THREE.Mesh | null = null;
        turret.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          if (o.name === 'bb-turret-side-plate' && !plate) plate = o;
          if (o.name === 'bb-turret-hood' && !hood) hood = o;
          if (o.name === 'bb-turret-hood-cheek' && !cheek) cheek = o;
        });
        check('the turret builds a side plate, a hood and a cheek (else the next checks are vacuous)', plate !== null && hood !== null && cheek !== null);
        if (plate && hood && cheek) {
          const pBox = new THREE.Box3().setFromObject(plate);
          const hBox = new THREE.Box3().setFromObject(hood);
          const cBox = new THREE.Box3().setFromObject(cheek);
          check(
            'the CHEEK reaches the hood — the gap the owner saw is closed by the thing that moves',
            cBox.max.z >= hBox.max.z - 1e-3 && cBox.min.z <= BB_TURRET_AXLE_Z,
            `cheek z ${cBox.min.z.toFixed(3)}…${cBox.max.z.toFixed(3)} spans the axle ${BB_TURRET_AXLE_Z.toFixed(3)} to the hood top ${hBox.max.z.toFixed(3)}`,
          );
          check(
            '...and the FIXED plate went back to hugging the wheel rather than chasing the hood',
            Math.abs(pBox.max.z - (BB_TURRET_AXLE_Z + BB_SIDE_PLATE_TOP_Z)) < 1e-3,
            `plate top ${(pBox.max.z - BB_TURRET_AXLE_Z).toFixed(3)} above the axle — the cut, not hoodR ${hoodInner.toFixed(3)}`,
          );
          // THE EXIT IS STILL RELIEVED. The plate must not climb in FRONT of the lip, which is
          // what the flat top was for: forward of the axle it stays at the corridor cut.
          const forwardTop = Math.max(
            ...[0, 10, 20, 30, 45, 60, 80].map((deg) => {
              const th = (deg * Math.PI) / 180;
              // the profile's own forward branch, restated: min(hoodR, TOP/sin, FRONT/cos)
              let r = hoodInner;
              if (Math.sin(th) > 1e-9) r = Math.min(r, 0.96732 / Math.sin(th));
              if (Math.cos(th) > 1e-9) r = Math.min(r, 2.2 / Math.cos(th));
              return Math.sin(th) * r;
            }),
          );
          check(
            'forward of the axle the plate is still cut to the outgoing corridor',
            forwardTop < 1.0,
            `${forwardTop.toFixed(3)} in above the axle`,
          );
        }
        disposeRobotGroup(turret);

        // ⚠️ BOTH ATTEMPTS AT GROWING THE FIXED PLATE ARE GONE BY NAME, so neither can come back
        // as a "small" edit: the 22° relief ramp of the first, and the rear rake of the second.
        check('no BB_HOOD_RELIEF ramp is left to tune', !robotsSrc.includes('BB_HOOD_RELIEF'));
        check('...and no rear rake either — the fixed profile is the arc-and-box it always was', !robotsSrc.includes('rearRake'));
        check(
          'the hood hangs on SOLID cheeks, not on spokes — no radialBar left in the file',
          !robotsSrc.includes('radialBar') && robotsSrc.includes("cheek.name = 'bb-turret-hood-cheek'"),
        );
        // ⚠️ AND THE MUZZLE CONTRACT IS UNTOUCHED -- the SHOOTER block above proves the drawn lip
        // sits on `bbMuzzleLocal` at every pitch. These two say the constants it reads did not
        // move to get this picture.
        check('the release chain did not move for this (BB_LAUNCH_Z0)', BB_LAUNCH_Z0 === 10, `${BB_LAUNCH_Z0}`);
        check(
          '...and `BB_SIDE_PLATE_TOP_Z` is still the corridor cut it always was',
          Math.abs(BB_SIDE_PLATE_TOP_Z - (BB_FLYWHEEL_R - 0.3 - 0.15)) < 1e-9,
          `${BB_SIDE_PLATE_TOP_Z.toFixed(5)}`,
        );
        check('...and nothing outside this renderer reads it', !readFileSync(join(BIOBUZZ_DIR, 'robot.ts'), 'utf8').includes('BB_SIDE_PLATE_TOP_Z'));
      }

      // ══ ITEM C -- THE CHASSIS COLOUR HAS TO BE THERE FROM ABOVE ══════════════════════════
      //
      // Owner: "chassis color change is not noticeable enough. The top needs to change." The
      // cosmetic mesh was the four side plates -- VERTICAL surfaces, presenting a 0.22-in edge
      // from straight above and nothing else. The file header CLAIMED the deck carried the
      // colour; the code put the deck in the structural part and said so on the line.
      //
      // Measured on the built frame: the UPWARD-FACING area of the cosmetic mesh. That is the
      // invariant, not "the deck is in the skin now" -- a future rearrangement is free, as long
      // as a top-down camera still sees the colour.
      {
        const upArea = (spec: RobotSpec, cosmetic: boolean): number => {
          const parts = buildFrame(spec);
          const mesh = parts.find((p) => p.name === (cosmetic ? 'robot:frame:skin' : 'robot:frame:rails')) as THREE.Mesh | undefined;
          if (!mesh) return 0;
          const pos = mesh.geometry.getAttribute('position');
          const idx = mesh.geometry.getIndex();
          const n = idx ? idx.count : pos.count;
          const a = new THREE.Vector3();
          const b = new THREE.Vector3();
          const c = new THREE.Vector3();
          const e1 = new THREE.Vector3();
          const e2 = new THREE.Vector3();
          const nn = new THREE.Vector3();
          let area = 0;
          for (let t = 0; t < n; t += 3) {
            const ia = idx ? idx.getX(t) : t;
            const ib = idx ? idx.getX(t + 1) : t + 1;
            const ic = idx ? idx.getX(t + 2) : t + 2;
            a.fromBufferAttribute(pos, ia);
            b.fromBufferAttribute(pos, ib);
            c.fromBufferAttribute(pos, ic);
            e1.subVectors(c, b);
            e2.subVectors(a, b);
            nn.crossVectors(e1, e2);
            const len = nn.length();
            if (len <= 0) continue;
            if (nn.z / len > 0.9) area += len / 2; // faces up
          }
          return area;
        };
        for (const dt of ['mecanum', 'swerve'] as const) {
          const spec = bbCoerceSpec({ ...BB_DEFAULT_SPEC, drivetrain: dt } as never);
          const up = upArea(spec, true);
          const foot = spec.length * spec.width;
          check(
            `${dt}: the chassis colour presents real upward-facing area (it was ~0)`,
            up > 60,
            `${up.toFixed(1)} sq in of ${foot.toFixed(0)} footprint`,
          );
          check(`${dt}: ...at least a quarter of the footprint`, up / foot > 0.25, `${((up / foot) * 100).toFixed(0)} %`);
          // ...but NOT a lid: the frame is still open, so the deck stays inset and the structure
          // reads past it. A cosmetic top covering the whole footprint is the "one flat slab" the
          // previous arrangement was avoiding, and it is still forbidden.
          check(`${dt}: ...and not the whole top (the frame stays open, not a slab)`, up / foot < 0.75, `${((up / foot) * 100).toFixed(0)} %`);
        }
        check('the deck is cosmetic now, and the header says why', robotsSrc.includes('WHAT CARRIES THE COSMETIC COLOUR, AND WHY IT CHANGED'));
        check('there is a cosmetic top cap on each side plate', /const BB_TOP_CAP_W = /.test(robotsSrc) && robotsSrc.includes('sy * (hw - BB_TOP_CAP_W / 2), BB_PLATE_H + BB_TOP_CAP_T / 2'));
        // and the ALLIANCE must not have moved into the cosmetic path -- G414 is a rules matter
        check(
          'the ALLIANCE is still the outline and the signs, never the fill',
          !/lineMat\(chassisFill/.test(robotsSrc) && !/getSignTexture\([^)]*chassisColor/.test(robotsSrc),
        );
      }

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
      // ⚠️ `BB_DECK_Z`, NOT A LITERAL SCRAPED OUT OF THE RENDERER. The deck moved into
      // `config.ts` with the rest of the turret's stack (2026-09-19), and `BB_PLATE_H` is now an
      // alias for it — a regex for `= 4.6;` reads NaN and every number below it comes out NaN,
      // which is how a check quietly stops checking.
      const plateH = BB_DECK_Z;
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
        // ⚠️ MEASURED OFF THE BUILT GROUP, NOT RE-DERIVED FROM SCRAPED LITERALS. The version this
        // replaces reconstructed the chain (`BB_FLYWHEEL_R` + `BB_HOOD_COMPRESSION` +
        // `BB_PLATE_R_OUT`) out of the renderer's source with three regexes, and when that chain
        // moved into `config.ts` every one of them read NaN — a check that stops checking without
        // ever going red. It also named the wrong part: the tallest thing at rest is the HOOD now,
        // not the side plate, because the plate deliberately stops below it (owner item b).
        const probe = buildTurret({ ...BB_DEFAULT_SPEC }, 'center');
        probe.updateMatrixWorld(true);
        const shooterTop = new THREE.Box3().setFromObject(probe).max.z;
        disposeRobotGroup(probe);
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

      // ── THE SHOOTER: BUILT, POSED AND MEASURED — NOT GREPPED ────────────────────────────
      //
      // ⚠️ **EVERYTHING BELOW USED TO BE A STRING CHECK OVER `renderRobots.ts`, AND IT PASSED
      // FIVE TIMES ON GEOMETRY THE OWNER REJECTED.** It asserted three literals that were all
      // present, all consistent with each other, and all describing a machine with the flywheel
      // hung three inches in the air, side plates reaching over the hood, and a flap on the back.
      // A lane that greps cannot see a shape. This one BUILDS the real `buildTurret` group, poses
      // `bb-turret-pitch` through the whole elevation envelope, and measures VERTICES.
      //
      // ⚠️ AND IT MEASURES **BOTH HEADS**. Owner item (d) of 2026-09-19 is that a NECTAR shooter
      // is a different size from a POLLEN one, so every measurement here runs twice against the
      // head's own `bbHead(which)` rather than once against a single set of constants. A check
      // that only ever sees turret 0 cannot see a NECTAR head at all.
      //
      // That is why this file imports `three` — the only script in the lane that does. The
      // chunk-boundary rules at the top of this function are about `src/`; a Node smoke script is
      // not bundled, and `buildTurret` touches no DOM (the sign texture, which does, is in
      // `buildRobotGroup` and is not on this path).
      for (const which of [0, 1] as const) {
        const H = bbHead(which);
        const tag = which === 1 ? 'nectar' : 'pollen';
        const turret = buildTurret({ ...BB_DEFAULT_SPEC }, 'center', which);
        const root = new THREE.Group();
        root.add(turret);
        const axleNode = turret.userData.axle as THREE.Group;
        const pitchNode = turret.userData.pitch as THREE.Group;
        const exitNode = pitchNode.getObjectByName('bb-turret-exit');
        const axleInv = new THREE.Matrix4();
        /** put the turret at elevation `p` and refresh both frames we measure in. */
        const pose = (p: number): void => {
          pitchNode.rotation.y = -p;
          root.updateMatrixWorld(true);
          axleInv.copy(axleNode.matrixWorld).invert();
        };
        const meshes: THREE.Mesh[] = [];
        turret.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
        });
        const named = (n: string): THREE.Mesh[] => meshes.filter((m) => m.name === n);
        const scratch = new THREE.Vector3();
        /** every vertex of `m`, in the ROBOT frame — z is height off the tiles, x is measured from
         *  the turret's own ROTATION AXIS (the group is built at `turretLocal('center')`). */
        const robotVerts = (m: THREE.Mesh): THREE.Vector3[] => {
          const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute;
          const out: THREE.Vector3[] = [];
          for (let i = 0; i < pos.count; i++) out.push(scratch.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).clone());
          return out;
        };
        /** …and in the AXLE frame, which is the fixed node's own frame and the one every θ in
         *  `config.ts` is measured in. It is NOT the yaw node's any more — the axle sits `axleX`
         *  forward of the rotation axis, which is the whole of owner item (b). */
        const axleVerts = (m: THREE.Mesh): THREE.Vector3[] =>
          robotVerts(m).map((v) => v.clone().applyMatrix4(axleInv));
        /**
         * ⚠️ THE TOLERANCE EVERY MEASUREMENT BELOW IS PAID AT, AND WHY IT IS NOT 1e-9. A
         * `BufferAttribute`'s positions are FLOAT32 — that is what goes to the GPU, so it is what
         * the picture actually is — and at these radii that is ~5e-7 of absolute error. Anything
         * tighter would be a check on double arithmetic the renderer never performs. The node
         * POSITIONS (the muzzle) are doubles and are held to 1e-9; only vertex readings pay this.
         */
        const F32 = 1e-4;
        /** the elevations every sweep below samples: the whole envelope, ends included. */
        const PITCHES = 41;
        const pitchAt = (i: number): number =>
          BB_TURRET_PITCH_MIN + ((BB_TURRET_PITCH_MAX - BB_TURRET_PITCH_MIN) * i) / (PITCHES - 1);

        pose(BB_TURRET_PITCH_MIN);
        /**
         * ⚠️ **AN EXACT LIST, NOT A SUBSET.** Owner item (c) of 2026-09-19 was "there is still a
         * weird flap in the back of the shooter that does nothing" — reported for the SECOND time,
         * against a part (the feed shoe) a previous pass had added on purpose. A check that only
         * asks "is every part I expect present" cannot see a part nobody can explain, so this one
         * also asks the other way round: every mesh on the shooter is on this list, and each name
         * says what the thing is for.
         */
        const PARTS = [
          'bb-turret-ring',
          'bb-turret-plate',
          'bb-turret-side-plate',
          'bb-turret-flywheel',
          'bb-turret-flywheel-hub',
          'bb-turret-shaft',
          'bb-turret-brace',
          'bb-turret-throat',
          'bb-turret-motor',
          'bb-turret-belt',
          'bb-turret-hood',
          'bb-turret-hood-cheek',
        ] as const;
        check(
          `${tag}: the shooter is an ASSEMBLY of named parts, and every one of them was built`,
          PARTS.every((n) => named(n).length > 0) && named('bb-turret-side-plate').length === 2 && named('bb-turret-hood-cheek').length === 2,
          PARTS.map((n) => `${n}×${named(n).length}`).join(' '),
        );
        check(
          `${tag}: ...and NOTHING ELSE is on it — no part without a job (the "weird flap", twice reported)`,
          meshes.every((m) => (PARTS as readonly string[]).includes(m.name)),
          [...new Set(meshes.map((m) => m.name).filter((n) => !(PARTS as readonly string[]).includes(n)))].join(', ') || 'clean',
        );

        // ══ ONLY THE HOOD AND ITS ARMS MOVE WITH PITCH ══════════════════════════════════════
        //
        // ⚠️ **THIS IS THE OWNER RULING THE LANE NEVER HAD.** "When the hood is changing angle,
        // the flywheel should be fixed and the parallel plates should be fixed. Only the hood, a
        // central arc in the back, should be moving up and down." Before the restructure
        // `bb-turret-pitch` carried the WHOLE shooter, and nothing said otherwise because the only
        // thing ever checked was where the pivot was written down.
        //
        // A part's fingerprint is its vertex extent in the ROBOT frame. Sampled over 41 pitches:
        // everything but the hood must not move by so much as a float, and the hood must.
        {
          const MOVES = ['bb-turret-hood', 'bb-turret-hood-cheek'];
          const print = (m: THREE.Mesh): THREE.Box3 => new THREE.Box3().setFromPoints(robotVerts(m));
          pose(BB_TURRET_PITCH_MIN);
          const base = new Map<THREE.Mesh, THREE.Box3>(meshes.map((m) => [m, print(m)]));
          const drift = new Map<THREE.Mesh, number>(meshes.map((m) => [m, 0]));
          for (let i = 1; i < PITCHES; i++) {
            pose(pitchAt(i));
            for (const m of meshes) {
              const b = print(m);
              const b0 = base.get(m) as THREE.Box3;
              drift.set(m, Math.max(drift.get(m) ?? 0, b.min.distanceTo(b0.min) + b.max.distanceTo(b0.max)));
            }
          }
          const worstFixed = Math.max(...meshes.filter((m) => !MOVES.includes(m.name)).map((m) => drift.get(m) ?? 0));
          const leastMoved = Math.min(...meshes.filter((m) => MOVES.includes(m.name)).map((m) => drift.get(m) ?? 0));
          check(
            `${tag}: ONLY the hood moves with elevation — wheel, plates, braces, motor, belt and throat do not`,
            worstFixed === 0,
            `worst drift ${worstFixed.toFixed(6)} in over ${PITCHES} pitches`,
          );
          check(
            `${tag}: ...and the hood and its two cheeks DO — they are on the pitch node, so this is not vacuous`,
            leastMoved > 1,
            `least-moved hood part travels ${leastMoved.toFixed(3)} in`,
          );
          check(
            `${tag}: ...and the pitch node carries NOTHING ELSE (three meshes: the arc and its two cheeks)`,
            pitchNode.children.filter((c) => (c as THREE.Mesh).isMesh).length === 3,
            pitchNode.children.map((c) => c.name || c.type).join(', '),
          );
        }

        // ══ THE CONTRACT: THE DRAWN LIP IS THE SIM'S MUZZLE, AT EVERY ELEVATION ═════════════
        //
        // ⚠️ THE WHOLE POINT OF THE DIMENSION CHAIN LIVING IN `config.ts`. `bbMuzzleLocal` is the
        // ONE function; the sim releases from it and this node is placed by it, so the picture and
        // the physics agree by construction rather than by two people keeping two numbers in step.
        // The old arrangement agreed at ONE pitch — which is exactly what the check it replaces
        // asserted, and why five rounds of disagreement got through.
        {
          let worst = 0;
          let where = '';
          for (let i = 0; i < PITCHES; i++) {
            const p = pitchAt(i);
            pose(p);
            const w = new THREE.Vector3();
            (exitNode as THREE.Object3D).getWorldPosition(w);
            const m = bbMuzzleLocal(p, which);
            // `back` is measured along the turret's heading from the ROTATION AXIS, which at zero
            // yaw is +x, so the drawn lip's x must be exactly `−back`
            const err = Math.hypot(w.x - -m.back, w.y, w.z - m.z);
            if (err > worst) {
              worst = err;
              where = `${((p * 180) / Math.PI).toFixed(1)}° drawn (${w.x.toFixed(4)}, ${w.z.toFixed(4)}) vs sim (${(-m.back).toFixed(4)}, ${m.z.toFixed(4)})`;
            }
          }
          check(`${tag}: the DRAWN hood lip is at bbMuzzleLocal(pitch) at EVERY elevation, not just at rest`, worst < 1e-9, `worst ${worst.toExponential(2)} in — ${where}`);
          pose(BB_TURRET_PITCH_MIN);
          const rest = new THREE.Vector3();
          (exitNode as THREE.Object3D).getWorldPosition(rest);
          pose(BB_TURRET_PITCH_MAX);
          const top = new THREE.Vector3();
          (exitNode as THREE.Object3D).getWorldPosition(top);
          check(
            `${tag}: ...and it is not a constant — the lip DROPS and comes BACK toward the axis as the hood elevates`,
            rest.z - top.z > 2 && rest.x > 2 && top.x < rest.x && top.x > -F32,
            `(${rest.x.toFixed(3)}, ${rest.z.toFixed(3)}) → (${top.x.toFixed(3)}, ${top.z.toFixed(3)}) — it was a flat ${BB_LAUNCH_Z0} over the mount at every pitch, which is what a DUMPER still has`,
          );
        }

        // ══ (b) THE ELEMENT COMES UP THE ROTATION AXIS AND MEETS THE WHEEL THERE ════════════
        //
        // ⚠️ **OWNER ITEM (b), 2026-09-19: "the flywheel should come forward more so that the
        // location where the balls contact the flywheel initially as it comes up is roughly in the
        // center of the turret".** Measured off the DRAWN wheel, not off the constant: the axle's
        // own x in the robot frame, and the pinch it puts on the axis.
        {
          pose(BB_TURRET_PITCH_MIN);
          const wheelVs = named('bb-turret-flywheel').flatMap((m) => robotVerts(m));
          const axleX = (Math.min(...wheelVs.map((v) => v.x)) + Math.max(...wheelVs.map((v) => v.x))) / 2;
          check(
            `${tag}: the DRAWN flywheel's axle is pathR FORWARD of the rotation axis`,
            Math.abs(axleX - H.axleX) < F32 && Math.abs(H.axleX - H.pathR) < 1e-12 && H.axleX > 2,
            `drawn axle x ${axleX.toFixed(4)} vs pathR ${H.pathR.toFixed(4)}`,
          );
          check(
            `${tag}: ...so the element, rising on x = 0, pinches on the axis and first touches the rim below it`,
            Math.abs(H.axleX - H.pathR) < 1e-12 && (BB_FLYWHEEL_R + H.elemR) ** 2 > H.axleX ** 2,
            `first contact ${(BB_TURRET_AXLE_Z - Math.sqrt((BB_FLYWHEEL_R + H.elemR) ** 2 - H.axleX ** 2)).toFixed(3)} in off the tiles, pinch at ${BB_TURRET_AXLE_Z.toFixed(3)}`,
          );
          // ...and the plate under it is CUT THROUGH, or the feed path is a claim and not a shape
          const plateVs = robotVerts(named('bb-turret-plate')[0]);
          const holeMin = Math.min(...plateVs.filter((v) => Math.abs(v.y) < H.slotHalfW - 0.3).map((v) => Math.hypot(v.x, v.y)));
          check(
            `${tag}: the turret plate is CUT THROUGH on the axis — the feed is a hole, not a claim`,
            holeMin > 0.5 && plateVs.some((v) => Math.abs(v.x - H.slotBackX) < F32) && plateVs.some((v) => Math.abs(v.x - H.slotFrontX) < F32),
            `nearest plate material to the axis ${holeMin.toFixed(3)}, slot x [${H.slotBackX.toFixed(2)}, ${H.slotFrontX.toFixed(2)}] ±${H.slotHalfW.toFixed(2)}`,
          );
        }

        // ══ THE HOOD IS PROUD OF THE SIDE PLATES, BY CONSTRUCTION ══════════════════════════
        //
        // "The arc in the parallel plates of the shooter reaches too high. The hood extends above
        // the supporting parallel plates." The plate's outer boundary is `config.ts`'s profile —
        // an arc at the head's own `hoodR` cut by a flat top, a flat front and a flat bottom — and
        // the hood occupies `hoodR … +BB_HOOD_T`, so the hood is the outermost part at every angle
        // in the wrap and at every elevation, with no offset anybody can drift.
        //
        // ⚠️ AND THE FIXED PLATE IS THE COMPACT ARC-AND-BOX, which is where it started and where
        // it is back. Two passes grew it up to `hoodR` to reach the hood — a 22° relief ramp with
        // a 64° arc, then an exit cut with a raked tail — and the owner rejected both ("the
        // shooter parallel plates became ugly. remember that the arc does not need to be big").
        // A fixed plate sized to a part that swings away from it is a fin at the 80° cap whatever
        // its outline; what reaches the hood is the hood's own CHEEK, measured further down.
        // Restated here rather than imported, the way this lane always restates the profile, so
        // the two copies have to agree.
        const TH_EXIT = Math.PI / 2;
        const plateR = (th: number): number => {
          const st = Math.sin(th);
          const ct = Math.cos(th);
          let r = H.hoodR;
          if (st > 1e-9) r = Math.min(r, BB_SIDE_PLATE_TOP_Z / st);
          if (st < -1e-9) r = Math.min(r, BB_SIDE_PLATE_BOTTOM_Z / st);
          if (ct > 1e-9) r = Math.min(r, BB_SIDE_PLATE_FRONT_X / ct);
          return r;
        };
        {
          let worst = Infinity;
          let worstAt = '';
          let rest = Infinity;
          let top = Infinity;
          const NA = 24;
          for (let i = 0; i < PITCHES; i++) {
            const p = pitchAt(i);
            for (let j = 0; j <= NA; j++) {
              const th = Math.PI / 2 + (BB_HOOD_WRAP * j) / NA;
              const proud = H.hoodR + BB_HOOD_T - plateR(th + p);
              if (proud < worst) {
                worst = proud;
                worstAt = `p=${((p * 180) / Math.PI).toFixed(1)}° θ=${(((th + p) * 180) / Math.PI).toFixed(1)}°`;
              }
              if (i === 0) rest = Math.min(rest, proud);
              if (i === PITCHES - 1) top = Math.min(top, proud);
            }
          }
          check(
            `${tag}: the hood stands PROUD of the plate at every angle in the wrap, at rest AND at full elevation`,
            worst >= BB_HOOD_T - 1e-9 && top >= BB_HOOD_T - 1e-9,
            `worst +${worst.toFixed(4)} (${worstAt}); rest +${rest.toFixed(3)}, 80° +${top.toFixed(3)}`,
          );
          // ⚠️ AND THE FIXED PLATE IS *NOT* WHAT CLOSES THE GAP. The clause that sat here for one
          // pass was `rest <= BB_HOOD_T`, i.e. "somewhere in the wrap the fixed plate comes right
          // up under the hood" — which is what grew the plate into a fin. The hood is carried by
          // its CHEEKS (measured below, at every elevation rather than at rest); the fixed plate
          // is free to stay compact, and this says it does.
          check(
            `${tag}: ...and the fixed plate does NOT chase it — at rest it stays below the corridor cut`,
            rest > 2.5,
            `the plate is +${rest.toFixed(3)} clear of the hood through the whole wrap; a plate grown to meet it reads +${BB_HOOD_T}`,
          );
          pose(BB_TURRET_PITCH_MIN);
          // the DRAWN hood: its vertices live in exactly the band the arithmetic above assumes
          const hoodR = axleVerts(named('bb-turret-hood')[0]).map((v) => Math.hypot(v.x, v.z));
          check(
            `${tag}: ...and the DRAWN hood really does occupy hoodR … +BB_HOOD_T (the arithmetic is about this mesh)`,
            Math.min(...hoodR) > H.hoodR - 1e-6 && Math.max(...hoodR) < H.hoodR + BB_HOOD_T + 1e-6,
            `${Math.min(...hoodR).toFixed(4)} … ${Math.max(...hoodR).toFixed(4)}`,
          );
          // the DRAWN plate: no vertex outside the profile, and the profile is actually reached
          let over = 0;
          let reach = 0;
          for (const v of axleVerts(named('bb-turret-side-plate')[0])) {
            const r = Math.hypot(v.x, v.z);
            const lim = plateR(Math.atan2(v.z, v.x));
            over = Math.max(over, r - lim);
            reach = Math.max(reach, r);
          }
          check(
            `${tag}: ...and the DRAWN side plate IS that profile: nothing outside it, and its arc is reached`,
            over < 1e-6 && Math.abs(reach - H.hoodR) < 1e-6,
            `worst overshoot ${over.toExponential(2)}, max r ${reach.toFixed(4)} vs hoodR ${H.hoodR.toFixed(4)}`,
          );
        }

        // ══ THE PLATE'S TOP: UNDER THE HOOD, AND CUT AWAY IN FRONT OF THE EXIT ═════════════
        // The rest pose, deliberately: that is the configuration the ruling is about and the one a
        // robot sits in between shots. At full elevation the hood has swung BACK and DOWN, so the
        // fixed plate is legitimately the taller of the two — the all-elevation statement is the
        // RADIAL one above, which holds at every pitch.
        {
          pose(BB_TURRET_PITCH_MIN);
          const plateTop = Math.max(...robotVerts(named('bb-turret-side-plate')[0]).map((v) => v.z));
          const hoodTop = Math.max(...robotVerts(named('bb-turret-hood')[0]).map((v) => v.z));
          // ⚠️ THESE HAVE NOW PINNED THE BUG IN BOTH DIRECTIONS, AND THAT IS WHY THEY READ AS
          // THEY DO. First they asserted `plateTop < hoodTop - 3` — the plate stopping 3 in short
          // of the hood everywhere, i.e. owner item (B) written down as a requirement. Then they
          // asserted the opposite, `hoodTop - plateTop < 1` — which is the plate grown into a fin,
          // the thing the owner called ugly. Neither is the rule. The rule is that the FIXED plate
          // is the compact cut and the CHEEK is what reaches the hood, so what is pinned here is
          // the plate's own top being exactly `BB_SIDE_PLATE_TOP_Z` and nothing else.
          check(
            `${tag}: the fixed plate's top IS the corridor cut, at every angle — it is not sized to the hood`,
            Math.abs(plateTop - (BB_TURRET_AXLE_Z + BB_SIDE_PLATE_TOP_Z)) < 1e-3,
            `plate top ${(plateTop - BB_TURRET_AXLE_Z).toFixed(4)} above the axle vs the cut ${BB_SIDE_PLATE_TOP_Z.toFixed(4)}; the hood is up at ${(hoodTop - BB_TURRET_AXLE_Z).toFixed(3)}`,
          );
          check(
            `${tag}: ...and the hood is the topmost part of the assembly, well above it`,
            plateTop < hoodTop - BB_HOOD_T,
            `plate ${plateTop.toFixed(3)} vs hood ${hoodTop.toFixed(3)}`,
          );
          const fwdTop = Math.max(...axleVerts(named('bb-turret-side-plate')[0]).filter((v) => v.x > 0.05).map((v) => v.z));
          check(
            `${tag}: ...while forward of the axle it is still the flat cut BB_SIDE_PLATE_TOP_Z`,
            Math.abs(fwdTop - BB_SIDE_PLATE_TOP_Z) < 1e-3,
            `${fwdTop.toFixed(4)} vs ${BB_SIDE_PLATE_TOP_Z.toFixed(4)}`,
          );
        }

        // ══ AND THE FIXED PLATE STAYS COMPACT — A RATCHET ON ITS REACH ═════════════════════
        //
        // ⚠️ **OWNER, 2026-09-19, ON THE PASS THAT FIXED THE FLOATING HOOD: "the shooter parallel
        // plates became ugly. remember that the arc does not need to be big."** Two passes grew
        // this plate to reach the hood, and the 80° pose is where both showed: the hood swings
        // down behind the wheel and leaves the plate standing as a bare fin at `hoodR`. The
        // checks above pin the plate's TOP; this pins its REACH over the whole upper hemisphere,
        // which is the number a relief ramp, a raked tail or any other clever outline would have
        // to raise. It may get smaller, never bigger.
        {
          let reach = 0;
          let reachAt = 0;
          for (let i = 0; i <= 18000; i++) {
            const th = (Math.PI * i) / 18000;
            const r = plateR(th);
            if (r > reach) {
              reach = r;
              reachAt = th;
            }
          }
          // the arc at `hoodR` legitimately closes the REAR of the plate, where it is behind the
          // wheel and below the corridor — the bound is on how high that reach gets, which is the
          // flat top's own cut plus the chord a 0.75° sample can miss it by.
          check(
            `${tag}: over the upper hemisphere the fixed plate never reaches higher than the corridor cut`,
            reach * Math.sin(reachAt) <= BB_SIDE_PLATE_TOP_Z + 1e-6,
            `highest ${(reach * Math.sin(reachAt)).toFixed(4)} at θ=${((reachAt * 180) / Math.PI).toFixed(1)}° vs the cut ${BB_SIDE_PLATE_TOP_Z.toFixed(4)} (the ramp read 3.632, the rake 3.917)`,
          );
          const NS = 36000;
          const dth = (Math.PI * 2) / NS;
          let area = 0;
          for (let i = 0; i < NS; i++) {
            const r = plateR(i * dth);
            area += ((r * r) / 2) * dth;
          }
          // ½∮r²dθ is exact for a profile single-valued about the axle, which this one is by
          // construction. The teardrop measured 22.80 (POLLEN) / 28.80 (NECTAR) and the raked cut
          // 20.83 / 26.80; this is the compact plate's own area plus a working margin.
          const AREA_MAX = which === 1 ? 18.8 : 16.6;
          check(
            `${tag}: ...and its silhouette stays under ${AREA_MAX} sq in`,
            area <= AREA_MAX,
            `${area.toFixed(2)} sq in (the ramp was ${which === 1 ? '28.80' : '22.80'}, the rake ${which === 1 ? '26.80' : '20.83'})`,
          );
        }

        // ══ THE HOOD AND ITS CHEEKS ARE ONE RIGID ASSEMBLY ON THE AXLE ═════════════════════
        //
        // ⚠️ **THIS IS WHAT REPLACED "grow the fixed plate".** The hood's arc cannot bolt to
        // anything fixed, because it elevates; what a real adjustable hood has is a pair of CHEEK
        // plates that are part of it — a pivot boss on the shooter axle and a solid sector out to
        // the hood's own outer face. Because they are on `bb-turret-pitch`, the hood is carried at
        // EVERY elevation rather than at rest, which is the failure both plate-growing passes had
        // at the 80° cap. "The arc does not need to be big" is the sector's own size rule.
        {
          pose(BB_TURRET_PITCH_MIN);
          const cheeks = named('bb-turret-hood-cheek');
          const cv = cheeks.map((m) => axleVerts(m));
          const rs = cv.flat().map((v) => Math.hypot(v.x, v.z));
          check(
            `${tag}: each cheek runs from a boss ON the axle out to the hood's own outer face`,
            cheeks.length === 2 && Math.min(...rs) <= 0.05 && Math.abs(Math.max(...rs) - (H.hoodR + BB_HOOD_T)) < F32,
            `r ${Math.min(...rs).toFixed(4)} … ${Math.max(...rs).toFixed(4)} vs the hood's outer face ${(H.hoodR + BB_HOOD_T).toFixed(4)}`,
          );
          // THE SECTOR IS NO WIDER THAN THE ARC IT CARRIES. Everything past the boss — the radius
          // at which a sector is a sector rather than a hub — must lie inside the hood's own wrap.
          const hub = 0.75;
          let span = 0;
          let spanAt = '';
          for (const v of cv.flat()) {
            const r = Math.hypot(v.x, v.z);
            if (r <= hub + F32) continue;
            const th = Math.atan2(v.z, v.x);
            const off = Math.max(TH_EXIT - th, th - (TH_EXIT + BB_HOOD_WRAP));
            if (off > span) {
              span = off;
              spanAt = `θ=${((th * 180) / Math.PI).toFixed(1)}° at r=${r.toFixed(2)}`;
            }
          }
          check(
            `${tag}: ...and the sector is no wider than the wrap it carries — "the arc does not need to be big"`,
            span <= 1e-3,
            span <= 1e-3 ? `inside [90°, ${(((TH_EXIT + BB_HOOD_WRAP) * 180) / Math.PI).toFixed(1)}°] everywhere past the boss` : `${((span * 180) / Math.PI).toFixed(2)}° outside it — ${spanAt}`,
          );
          // ONE ASSEMBLY: the cheek's inner face IS the hood's side face, so the two are flush
          // rather than two parts near each other. Lateral, because that is the only axis on
          // which they are separable at all — they share the arc in the other two.
          const hoodY = Math.max(...axleVerts(named('bb-turret-hood')[0]).map((v) => Math.abs(v.y)));
          const cheekInner = Math.min(...cv.flat().map((v) => Math.abs(v.y)));
          check(
            `${tag}: ...and hood and cheek are FLUSH across the channel — one assembly, not two parts`,
            Math.abs(cheekInner - hoodY) <= F32,
            `hood side face ±${hoodY.toFixed(4)}, cheek inner face ±${cheekInner.toFixed(4)}`,
          );
          // ⚠️ AND NOTHING FIXED IS IN THE VOLUME THE CHEEK SWEEPS. The sweep is stated rather
          // than sampled: the cheek lives in the lateral band [elemR, plateGap/2 − inset], and
          // over 0…80° it covers r ≤ hoodR + BB_HOOD_T for θ ∈ [90°, 90° + cap + wrap] (plus its
          // boss at every θ). So a fixed vertex inside ALL THREE is an interpenetration, and the
          // SHAFT is the one exemption — a pivot boss and the shaft it is journalled on share an
          // axis by definition. The band is the whole reason the cheeks are inboard: outboard,
          // the belt and the flywheel pulley own everything past ±1.98.
          const bandIn = H.elemR;
          const bandOut = H.plateGap / 2 - BB_HOOD_ARM_INSET;
          const sweptTo = TH_EXIT + BB_TURRET_PITCH_MAX + BB_HOOD_WRAP;
          let intruder = '';
          let nearest = Infinity;
          for (const m of meshes) {
            if (m.name === 'bb-turret-hood' || m.name === 'bb-turret-hood-cheek' || m.name === 'bb-turret-shaft') continue;
            for (const v of axleVerts(m)) {
              const ay = Math.abs(v.y);
              if (ay < bandIn - F32 || ay > bandOut + F32) continue;
              const r = Math.hypot(v.x, v.z);
              const th = Math.atan2(v.z, v.x);
              const thn = th < -1e-9 ? th + Math.PI * 2 : th;
              if (thn < TH_EXIT - F32 || thn > sweptTo + F32) continue;
              nearest = Math.min(nearest, r - (H.hoodR + BB_HOOD_T));
              if (r <= H.hoodR + BB_HOOD_T + F32) intruder = `${m.name} at r=${r.toFixed(2)} θ=${((thn * 180) / Math.PI).toFixed(0)}° |y|=${ay.toFixed(2)}`;
            }
          }
          check(
            `${tag}: ...and nothing fixed is inside the volume a cheek sweeps over 0…80°, bar the shaft it pivots on`,
            intruder === '',
            intruder || `nearest fixed part in the cheeks' lane (±${bandIn.toFixed(2)}…${bandOut.toFixed(2)}) clears the sector by ${Number.isFinite(nearest) ? nearest.toFixed(3) : 'the whole band is empty'}`,
          );
        }

        // ══ THE FLYWHEEL IS 72 mm, IT SITS ON THE TURRET PLATE, AND THERE IS ONE OF IT ═════
        // "The flywheel can be situated much lower. It just needs to be right above the turret
        // plate." — and "a standard flywheel is 72 mm diameter". Both are measurements now, and
        // the radius is checked by converting it BACK: a decimal literal that had drifted would
        // not come out at 72. It is the SAME wheel on both heads.
        //
        // ⚠️ **AND IT IS ONE WHEEL, CENTRED** (owner, 2026-09-19: "the flywheel on the shooter
        // looks like there are two wheels stacked next to each other. there should just be one in
        // the center"). It was two 0.9-in meshes at y = ±0.7. There was no seam and no groove to
        // blame — two meshes is what two wheels look like — so this counts the meshes, puts the
        // one that is left on the centreline, and holds its width off the ELEMENT rather than off
        // a literal, since a NECTAR head grips a bigger ball with a wider tyre.
        {
          pose(BB_TURRET_PITCH_MIN);
          const wheel = named('bb-turret-flywheel');
          const vs = wheel.flatMap((m) => axleVerts(m));
          const rim = Math.max(...vs.map((v) => Math.hypot(v.x, v.z)));
          const bottom = Math.min(...wheel.flatMap((m) => robotVerts(m)).map((v) => v.z));
          const ys = vs.map((v) => v.y);
          const centre = (Math.min(...ys) + Math.max(...ys)) / 2;
          const width = Math.max(...ys) - Math.min(...ys);
          check(
            `${tag}: there is exactly ONE flywheel mesh and it is centred on the channel`,
            wheel.length === 1 && Math.abs(centre) < F32,
            `${wheel.length} wheel(s), centre y ${centre.toFixed(5)} (it was two, at ±0.700)`,
          );
          check(
            `${tag}: ...its width is half an element diameter — enough tyre to grip the ball it pinches`,
            Math.abs(width - H.elemR) < F32,
            `${width.toFixed(3)} in on an element of radius ${H.elemR}`,
          );
          check(
            `${tag}: ...and the shaft shows between the tyre and each plate, rather than the gap being filled`,
            H.plateGap / 2 - width / 2 > 0.5 && width < H.plateGap - 1.0,
            `${(H.plateGap / 2 - width / 2).toFixed(3)} in of bare shaft each side of a ${width.toFixed(2)}-in wheel in a ${H.plateGap.toFixed(2)} channel`,
          );
          check(
            `${tag}: the flywheel’s drawn radius back-converts to 72 mm`,
            Math.abs(rim * 25.4 * 2 - BB_FLYWHEEL_D_MM) < 0.5,
            `${(rim * 25.4 * 2).toFixed(2)} mm (drawn as a 14-segment wheel, so the rim reads a hair under)`,
          );
          check(
            `${tag}: ...and its lowest point is BB_FLYWHEEL_CLEAR above the turret plate, not hung in the air`,
            Math.abs(bottom - (BB_TURRET_PLATE_TOP_Z + BB_FLYWHEEL_CLEAR)) < 1e-6,
            `${bottom.toFixed(3)} vs plate top ${BB_TURRET_PLATE_TOP_Z.toFixed(3)} + ${BB_FLYWHEEL_CLEAR}`,
          );
          // ...and it is JOURNALLED: everywhere the plate's flat top does not cut across it, the
          // plate is behind the wheel's rim. An earlier band left a bare annulus between its hub
          // and its rim with the rim sitting in it — owner: "the flywheel looks like it is not
          // constrained to the plate anymore".
          let gaps = 0;
          for (let i = 0; i < 720; i++) {
            const th = (Math.PI * 2 * i) / 720;
            if (Math.sin(th) * BB_FLYWHEEL_R > BB_SIDE_PLATE_TOP_Z) continue; // the flat top, where the hood is
            if (plateR(th) < BB_FLYWHEEL_R) gaps++;
          }
          check(`${tag}: ...and the plate covers the wheel’s rim everywhere its flat top does not cut it`, gaps === 0, `${gaps} of 720 sampled angles uncovered`);
          // …which needs the plate SOLID. A bore would show as drawn material stopping at some
          // radius INSIDE the profile's own smallest value; with no bore the closest the plate
          // ever comes to the axle is the profile itself, which is its flat top at θ = 90°.
          let profileMin = Infinity;
          for (let i = 0; i < 3600; i++) profileMin = Math.min(profileMin, plateR((Math.PI * 2 * i) / 3600));
          const bore = Math.min(...axleVerts(named('bb-turret-side-plate')[0]).map((v) => Math.hypot(v.x, v.z)));
          check(`${tag}: ...which needs the plate SOLID, with no bore for the rim to show through`, bore >= profileMin - F32, `closest drawn radius ${bore.toFixed(4)} vs the profile's own minimum ${profileMin.toFixed(4)}`);
        }

        // ══ NOTHING SWEEPS BELOW THE DECK, AND NOTHING THROUGH THE TURRET PLATE ════════════
        //
        // ⚠️ THE FAILURE THIS REPLACES WAS REAL AND IT WAS INVISIBLE AT REST: with the whole head
        // on the pitch node, the side plate's rear corner went 1.10 in INSIDE the drivetrain at
        // ~44° and the feed ramp swept to 0.04 in off the tile.
        //
        // The second half is new and it is the NECTAR head's: a bigger hood dips 0.26 in below the
        // turret plate at full elevation. That is allowed only because it happens inside the FEED
        // SLOT, which is a rounded rectangle and not a bore for exactly this reason — so the rule
        // is not "nothing goes below the plate" but "nothing goes below it anywhere but through
        // the hole", and it is measured per vertex.
        {
          let lowest = Infinity;
          let who = '';
          let throughPlate = 0;
          let worstThrough = '';
          for (let i = 0; i < PITCHES; i++) {
            pose(pitchAt(i));
            for (const m of meshes) {
              if (m.name === 'bb-turret-plate' || m.name === 'bb-turret-ring') continue;
              for (const v of robotVerts(m)) {
                if (v.z < lowest) {
                  lowest = v.z;
                  who = `${m.name} @${((pitchAt(i) * 180) / Math.PI).toFixed(0)}°`;
                }
                if (v.z >= BB_TURRET_PLATE_TOP_Z - F32) continue;
                const inSlot =
                  v.x >= H.slotBackX - F32 && v.x <= H.slotFrontX + F32 && Math.abs(v.y) <= H.slotHalfW + F32;
                if (!inSlot) {
                  throughPlate++;
                  worstThrough = `${m.name} (${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}) @${((pitchAt(i) * 180) / Math.PI).toFixed(0)}°`;
                }
              }
            }
          }
          check(`${tag}: NOTHING on the turret reaches below the deck, at any elevation`, lowest >= BB_DECK_Z - F32, `lowest ${lowest.toFixed(4)} (${who}) vs deck ${BB_DECK_Z}`);
          check(
            `${tag}: ...and whatever goes below the turret plate goes through its SLOT and nowhere else`,
            throughPlate === 0,
            worstThrough || `slot x [${H.slotBackX.toFixed(2)}, ${H.slotFrontX.toFixed(2)}] ±${H.slotHalfW.toFixed(2)}`,
          );
          // …and the things that ELEVATE keep a real margin over the drivetrain, not a rounding one
          let swept = Infinity;
          for (let i = 0; i < PITCHES; i++) {
            pose(pitchAt(i));
            for (const n of ['bb-turret-hood', 'bb-turret-hood-cheek']) {
              for (const m of named(n)) for (const v of robotVerts(m)) swept = Math.min(swept, v.z);
            }
          }
          check(`${tag}: ...and the hood and its arms clear the deck by the design’s own 0.2 in margin`, swept >= BB_DECK_Z + 0.2, `hood sweep bottoms out at ${swept.toFixed(3)}`);
        }

        // ══ THE BRACES, THE MOTOR AND THE BELT ═════════════════════════════════════════════
        //
        // Sites come from `BB_TURRET_BRACES` and `BbHeadDims.motorR`, both derived in `config.ts`.
        // ⚠️ **OWNER ITEM (a) IS THE MOTOR ONE: "the motor should be on the other side of the
        // flywheel, behind the hood."** It sat at θ = −15°, forward and under the wheel. "Behind
        // the hood" is measured here as a fact about the DRAWN meshes — the can's front face is
        // behind the rear-most point the hood reaches at ANY elevation — rather than as an angular
        // window, because the hood sweeps a whole disc over the pitch envelope.
        {
          pose(BB_TURRET_PITCH_MIN);
          const braceVs = robotVerts(named('bb-turret-brace')[0]);
          const plateOuterY = H.plateGap / 2 + BB_SHOOTER_PLATE_T;
          check(
            `${tag}: the two plates are TIED together: the braces span the channel and stand proud of both outer faces`,
            BB_TURRET_BRACES.length >= 2 && Math.max(...braceVs.map((v) => v.y)) > plateOuterY && Math.min(...braceVs.map((v) => v.y)) < -plateOuterY,
            `${BB_TURRET_BRACES.length} standoffs, y ±${Math.max(...braceVs.map((v) => v.y)).toFixed(3)} vs plate face ±${plateOuterY.toFixed(3)}`,
          );
          check(
            `${tag}: ...and every one of them stands ABOVE the turret plate it is bolted over`,
            Math.min(...braceVs.map((v) => v.z)) >= BB_TURRET_PLATE_TOP_Z - 1e-9,
            `lowest ${Math.min(...braceVs.map((v) => v.z)).toFixed(4)} vs plate top ${BB_TURRET_PLATE_TOP_Z.toFixed(3)}`,
          );
          for (const site of BB_TURRET_BRACES) {
            const deg = ((site.th * 180) / Math.PI).toFixed(0);
            const inside = plateR(site.th) - (site.r + BB_TURRET_BRACE_R);
            const rim = site.r - BB_TURRET_BRACE_R - BB_FLYWHEEL_R;
            check(`${tag}: brace @${deg}°: inside the plate profile it bolts to, and clear of the wheel it sits beside`, inside > 0 && rim >= 0.2 - 1e-9 && rim <= 1.0, `inside ${inside.toFixed(3)}, off the rim ${rim.toFixed(3)}`);
          }
          const mv = robotVerts(named('bb-turret-motor')[0]);
          check(
            `${tag}: the flywheel motor's can is BETWEEN the plates, not outboard of one`,
            Math.max(...mv.map((v) => Math.abs(v.y))) <= H.plateGap / 2 + F32,
            `±${Math.max(...mv.map((v) => Math.abs(v.y))).toFixed(2)} in a ±${(H.plateGap / 2).toFixed(2)} channel`,
          );
          let hoodBack = Infinity;
          for (let i = 0; i < PITCHES; i++) {
            pose(pitchAt(i));
            for (const n of ['bb-turret-hood', 'bb-turret-hood-cheek']) {
              for (const m of named(n)) for (const v of robotVerts(m)) hoodBack = Math.min(hoodBack, v.x);
            }
          }
          pose(BB_TURRET_PITCH_MIN);
          const motorFront = Math.max(...mv.map((v) => v.x));
          check(
            `${tag}: ...and it is BEHIND THE HOOD (owner item a) — its whole can is past the hood's rear-most sweep`,
            motorFront < hoodBack - 0.2 && motorFront < 0,
            `can front ${motorFront.toFixed(3)} vs hood rear-most over the sweep ${hoodBack.toFixed(3)}`,
          );
          check(
            `${tag}: ...bolted to the feed wall's ears rather than floating, and over the turret plate`,
            Math.min(...mv.map((v) => v.z)) >= BB_TURRET_PLATE_TOP_Z - F32 &&
              Math.abs(motorFront - (H.axleX - H.wallR - BB_FEED_WALL_T - 0.05)) < F32,
            `can front ${motorFront.toFixed(3)} vs wall rear face ${(H.axleX - H.wallR - BB_FEED_WALL_T).toFixed(3)}, bottom ${Math.min(...mv.map((v) => v.z)).toFixed(3)}`,
          );
          const bv = robotVerts(named('bb-turret-belt')[0]);
          check(
            `${tag}: the drive is a BELT, and it runs OUTBOARD of a side plate — the hood's shell crosses every line inside`,
            Math.min(...bv.map((v) => Math.abs(v.y))) >= H.plateGap / 2 + BB_SHOOTER_PLATE_T &&
              Math.min(...bv.map((v) => Math.abs(v.y))) > H.plateGap / 2 + BB_SHOOTER_PLATE_T + BB_BRACE_PROUD - 0.06,
            `belt inner face ${Math.min(...bv.map((v) => Math.abs(v.y))).toFixed(3)} vs plate face ${(H.plateGap / 2 + BB_SHOOTER_PLATE_T).toFixed(3)} and brace ends ${(H.plateGap / 2 + BB_SHOOTER_PLATE_T + BB_BRACE_PROUD).toFixed(3)}`,
          );
          check(
            `${tag}: ...and it reaches BOTH pulleys, so it is a drive and not a decal`,
            Math.abs(Math.min(...bv.map((v) => v.x)) - (H.axleX - H.motorR - 0.54)) < 0.1 &&
              Math.max(...bv.map((v) => v.x)) > H.axleX + 0.6,
            `belt x [${Math.min(...bv.map((v) => v.x)).toFixed(2)}, ${Math.max(...bv.map((v) => v.x)).toFixed(2)}]`,
          );
        }

        // ══ (c) THE FEED THROAT IS FIXED, AND IT IS THE REAR TIE ═══════════════════════════
        //
        // "There is still a weird flap in the back of the shooter that does nothing." — reported
        // TWICE, the second time against the FEED SHOE a previous pass had put there. What stands
        // there now is the back of the channel the element rises through: a flat vertical wall on
        // the turret plate, one hood-sweep radius plus a slide behind the rising element, spanning
        // the whole channel and both plates. Its invariance under pitch is proved by the block
        // above; what is proved here is that it is the tie, that it stands on the plate, and that
        // the hood clears it at every elevation.
        {
          pose(BB_TURRET_PITCH_MIN);
          const throat = named('bb-turret-throat')[0];
          const tv = robotVerts(throat);
          const plateOuterY = H.plateGap / 2 + BB_SHOOTER_PLATE_T;
          check(
            `${tag}: the FEED THROAT ties both plates — it spans the channel and both plate thicknesses`,
            Math.max(...tv.map((v) => v.y)) > plateOuterY && Math.min(...tv.map((v) => v.y)) < -plateOuterY,
            `y ±${Math.max(...tv.map((v) => v.y)).toFixed(3)} vs plate face ±${plateOuterY.toFixed(3)}`,
          );
          check(
            `${tag}: ...and it STANDS ON the turret plate, at the back of the rising element`,
            Math.abs(Math.min(...tv.map((v) => v.z)) - BB_TURRET_PLATE_TOP_Z) < F32 &&
              Math.max(...tv.map((v) => v.x)) < -H.elemR,
            `bottom ${Math.min(...tv.map((v) => v.z)).toFixed(3)} on a plate at ${BB_TURRET_PLATE_TOP_Z}, front face ${Math.max(...tv.map((v) => v.x)).toFixed(3)} behind an element of radius ${H.elemR}`,
          );
          // the hood sweeps a DISC about the axle, so a vertical plane outside that radius clears
          // it at EVERY elevation — measured rather than reasoned about
          let hoodBack = Infinity;
          for (let i = 0; i < PITCHES; i++) {
            pose(pitchAt(i));
            for (const n of ['bb-turret-hood', 'bb-turret-hood-cheek']) {
              for (const m of named(n)) for (const v of robotVerts(m)) hoodBack = Math.min(hoodBack, v.x);
            }
          }
          pose(BB_TURRET_PITCH_MIN);
          check(
            `${tag}: ...and the hood sweeps INSIDE it, so the two never touch at any elevation`,
            Math.max(...tv.map((v) => v.x)) <= hoodBack - 0.05,
            `wall front ${Math.max(...tv.map((v) => v.x)).toFixed(3)}, hood rear-most ${hoodBack.toFixed(3)} — ${(hoodBack - Math.max(...tv.map((v) => v.x))).toFixed(3)} of slide`,
          );
          check(
            `${tag}: ...and the hood’s wrap is the SHORT one a fixed entry made possible`,
            BB_HOOD_WRAP < 0.6,
            `${((BB_HOOD_WRAP * 180) / Math.PI).toFixed(1)}° (was 60°, and a 60° hood’s mouth is 80° out of line at full elevation)`,
          );
        }

        // ══ WHERE THE CHEEKS LIVE ══════════════════════════════════════════════════════════
        //
        // The lateral strip between the element and the side plate is the only place they CAN be:
        // in the x–z PROJECTION the element fills every path from the axle to the hood, and an
        // element is a sphere, so at lateral offset `elemR` it has no cross-section left to foul.
        // It is also where the clearance is — outboard, the belt and the flywheel pulley own
        // everything past ±1.98 on the drive side.
        {
          pose(BB_TURRET_PITCH_MIN);
          const ys = named('bb-turret-hood-cheek').flatMap((m) => axleVerts(m)).map((v) => Math.abs(v.y));
          check(
            `${tag}: a cheek is inboard of the side plate by BB_HOOD_ARM_INSET, and never inside the element’s own width`,
            Math.min(...ys) >= H.elemR - F32 && Math.abs(Math.max(...ys) - (H.plateGap / 2 - BB_HOOD_ARM_INSET)) < F32,
            `|y| ${Math.min(...ys).toFixed(3)} … ${Math.max(...ys).toFixed(3)}; element ±${H.elemR}, plate face ${(H.plateGap / 2).toFixed(3)}`,
          );
          check(
            `${tag}: ...so they do not read as a third plate: both are inside the plates they hide between`,
            Math.max(...ys) < H.plateGap / 2,
            `${Math.max(...ys).toFixed(3)} vs ${(H.plateGap / 2).toFixed(3)}`,
          );
          const fwY = Math.max(...named('bb-turret-flywheel').flatMap((m) => axleVerts(m)).map((v) => Math.abs(v.y)));
          check(
            `${tag}: ...and they clear the flywheel they straddle`,
            Math.min(...ys) - fwY > 0.1,
            `${(Math.min(...ys) - fwY).toFixed(3)} in`,
          );
        }

        // ══ THE EXIT CORRIDOR IS UNOBSTRUCTED, AT EVERY ELEVATION ══════════════════════════
        //
        // The element leaves the lip along the hood's own tangent and flies an element-wide tube
        // out of the machine. Every member that SPANS THE CHANNEL has to stay out of it.
        //
        // ⚠️ MEASURED ON THE DRAWN MESHES, projected into the axle plane. A part whose lateral
        // extent never reaches the element (the side plates, the hood arms, the belt) cannot
        // obstruct it at all and is excluded by that test rather than by a list; the hood and the
        // wheel ARE the mechanism that throws it, so they are excluded too. `CHORD` is the sagitta
        // a 10-segment standoff loses to its own faceting — this is a clearance measurement, so it
        // is paid.
        {
          const CHORD = 0.02;
          const EXCLUDE = ['bb-turret-hood', 'bb-turret-hood-cheek', 'bb-turret-flywheel', 'bb-turret-side-plate'];
          let worst = Infinity;
          let who = '';
          for (let i = 0; i < PITCHES; i++) {
            const p = pitchAt(i);
            pose(p);
            const m = bbMuzzleLocal(p, which);
            const ox = -m.back - H.axleX; // the lip, in the AXLE frame
            const oz = m.z - BB_TURRET_AXLE_Z;
            const dx = Math.cos(p);
            const dz = Math.sin(p);
            for (const mesh of meshes) {
              if (EXCLUDE.includes(mesh.name)) continue;
              const vs = axleVerts(mesh);
              // ⚠️ THE LATERAL TEST IS ON THE PART'S y INTERVAL, NOT ON ITS NEAREST VERTEX. A
              // `CylinderGeometry` standoff has vertices at its two END CAPS and nowhere in
              // between, so "nearest vertex to the centreline" reads ±1.92 for a member that runs
              // straight through y = 0 — and the braces, the motor and the belt all dropped out of
              // this sweep unmeasured. The interval is what spans the channel.
              const ys = vs.map((v) => v.y);
              if (Math.min(...ys) >= H.elemR - F32 || Math.max(...ys) <= -H.elemR + F32) continue;
              for (const v of vs) {
                const s = (v.x - ox) * dx + (v.z - oz) * dz;
                if (s < 0 || s > 8) continue;
                const perp = Math.abs((v.x - ox) * dz - (v.z - oz) * dx) - H.elemR - CHORD;
                if (perp < worst) {
                  worst = perp;
                  who = `${mesh.name || 'slew ring'} @${((p * 180) / Math.PI).toFixed(0)}°`;
                }
              }
            }
          }
          check(`${tag}: the EXIT CORRIDOR is unobstructed at every elevation`, worst > 0, `worst clearance ${worst.toFixed(3)} in (${who})`);
          // A RATCHET. The +20° brace leaves 0.164 and it stays: the side plate's own flat top is
          // the binding part at that height and clears the corridor by 0.150 BY DEFINITION
          // (`BB_SIDE_PLATE_TOP_Z` is one element radius plus 0.15 under the corridor's centre
          // line), so nothing fixed up there can do better. What must not happen is the margin
          // shrinking, and this is what says so.
          check(
            `${tag}: ...with the margin the design measured, not less`,
            worst >= 0.15,
            `${worst.toFixed(3)} after the ${CHORD} chord pad — the binding part is the +20° brace at 0.164`,
          );
          check(
            `${tag}: ...and the plate’s flat top is the ceiling anything fixed can reach`,
            Math.abs(H.pathR - H.elemR - BB_SIDE_PLATE_TOP_Z - 0.15) < 1e-9,
            `${(H.pathR - H.elemR - BB_SIDE_PLATE_TOP_Z).toFixed(3)} in under the corridor floor`,
          );
        }
        disposeRobotGroup(turret);
      }

      // ══ THE CHAIN IS NOT DUPLICATED IN THE RENDERER ═════════════════════════════════════
      //
      // ⚠️ THE ORIGINAL SIN, ASSERTED GONE. The renderer owned `BB_FLYWHEEL_R`, `BB_HOOD_R`,
      // `BB_HOOD_PATH_R`, `BB_HOOD_WRAP` and the plate profile as local `const`s and the sim owned
      // `BB_LAUNCH_Z0`; six passes of feedback each moved one of them. A second copy of any of
      // them is the bug, so it is named.
      {
        const dupes = ['BB_FLYWHEEL_R', 'BB_HOOD_R', 'BB_HOOD_PATH_R', 'BB_HOOD_COMPRESSION', 'BB_HOOD_WRAP', 'BB_HOOD_T', 'BB_TURRET_AXLE_Z', 'BB_DECK_Z', 'BB_TURRET_BRACE_R', 'BB_SHOOTER_PLATE_T', 'BB_BRACE_PROUD']
          .filter((n) => new RegExp(`^const ${n}\\b`, 'm').test(robotsCode));
        check('renderRobots.ts declares NO second copy of a shooter dimension', dupes.length === 0, dupes.join(', '));
        check(
          '...and the retired pieces of the muzzle-pivot and feed-shoe eras are gone with them',
          !/BB_HEAD_RHO_MAX|minHeadWorldZ|plateOuterR|BB_PLATE_R_OUT|BB_PLATE_TAIL|BB_SHOOTER_MUZZLE_Z|BB_FEED_SHOE|BB_FEED_TILT/.test(robotsCode),
        );
        check(
          'the muzzle node is placed by the SIM’s own function, imported, not by a local formula',
          robotsCode.includes('bbMuzzleLocal') &&
            robotsCode.includes('const rest = bbMuzzleLocal(BB_TURRET_PITCH_MIN, which);') &&
            robotsCode.includes('exit.position.set(-rest.back - H.axleX, 0, rest.z - BB_TURRET_AXLE_Z);'),
          'the lip is read off bbMuzzleLocal at rest; the node’s own rotation carries it to every other pitch',
        );
        check(
          'the node names are still the interface the sync writes to',
          robotsCode.includes("head.name = 'bb-turret-head'") &&
            robotsCode.includes("pitch.name = 'bb-turret-pitch'") &&
            robotsCode.includes("exit.name = 'bb-turret-exit'") &&
            robotsCode.includes('pitches[0].rotation.y = -(r.bbTurretPitch ?? 0);') &&
            robotsCode.includes('heads[0].rotation.z = r.turretHeading - r.heading;'),
        );
        check(
          '...and the YAW node is on the ROTATION AXIS with the axle offset INSIDE it, which is what lets the axle orbit',
          robotsCode.includes("axle.position.set(H.axleX, 0, BB_TURRET_AXLE_Z - BB_DECK_Z);") &&
            !/head\.position\.z = BB_TURRET_AXLE_Z/.test(robotsCode) &&
            !/head\.position\.z = BB_LAUNCH_Z0/.test(robotsCode),
        );
        check(
          'a DOUBLE turret builds its NECTAR head as turret 1, so the picture and bbMuzzleLocal pick the same one',
          robotsCode.includes('buildTurret(spec, launcher.mount, 0)') && robotsCode.includes('buildTurret(spec, launcher.mount2, 1)'),
        );
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
          'a swerve pod is a real assembly: fork + kingpin, slew ring, belt drive',
          robotsCode.includes("framePart('swervePod:struct'") &&
            robotsCode.includes("framePart('swervePod:ring'") &&
            robotsCode.includes("framePart('swervePod:drive'") &&
            /TWIN FORK PLATES/.test(robotsSrc) &&
            /THE KINGPIN/.test(robotsSrc) &&
            /THE BELT DRIVE/.test(robotsSrc),
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
          robotsCode.includes('pod.position.set((Math.sign(x) || 1) * (hl - BB_POD_INSET), sy * (hw - BB_POD_INSET), 0);') &&
            robotsCode.includes('wheel.position.set(0, 0, BB_POD_WHEEL_R);'),
        );
        // ══ (2) THE WHEEL READS AS A WHEEL — BUILT AND MEASURED, NOT GREPPED ═══════════════
        //
        // ⚠️ **OWNER, 2026-09-19: "the swerve wheel has two rectangular plates blocking the wheel,
        // so it looks like it is just a rectangular cylinder as the wheel. Fix this. Remove those
        // plates or make it smaller."** The fork was a 3.2 × 3.5 rectangle either side of a 3.0-in
        // wheel, from z 0.40 up to the top plate — in side view it covered the tyre completely,
        // end to end and top to bottom, so all that was left of the wheel was a dark band under
        // the plate's lower edge.
        //
        // The rule that answers it is a SILHOUETTE rule, so it is measured on the built pod: at
        // the fork's own lateral plane, what fraction of the wheel's circle does the fork cover?
        // The fork is shorter than the wheel and stops at a boss around the axle, so the tyre's
        // whole lower half and both ends of its circle are in plain sight.
        //
        // ⚠️ A BOUNDING BOX OVER THE WHOLE STRUCT MESH MEASURES THE WRONG THING, AND DID. `podParts()`
        // merges the two fork plates, the TOP PLATE (`BB_POD_L` = 3.2 long, sitting at
        // `BB_POD_PLATE_Z` − 0.3 to `BB_POD_PLATE_Z`, i.e. z 3.60–3.90 — entirely ABOVE the wheel's
        // own crown at z 3.00) and the kingpin into one unnamed geometry, so a box around all of it
        // reported the TOP PLATE's own length as "the fork" and multiplied it by the full height down
        // to the boss, when the top plate stands over the tyre and obstructs nothing. So this instead
        // walks the struct mesh's own WORLD-SPACE TRIANGLES, keeps only the ones that reach the
        // wheel's crown or below it (the only geometry that can stand in front of the tyre at all),
        // and RASTERISES that subset onto the wheel's own x-z plane to measure the silhouette
        // directly — a fixed grid and a deterministic point-in-triangle test, no randomness.
        {
          const pod = buildSwervePod();
          pod.updateMatrixWorld(true);
          const podMeshes: THREE.Mesh[] = [];
          pod.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) podMeshes.push(o as THREE.Mesh);
          });
          const box = (m: THREE.Mesh): THREE.Box3 => new THREE.Box3().setFromObject(m);
          const wheelBox = box(podMeshes.find((m) => m.name === 'bb-pod-wheel') as THREE.Mesh);
          const hubBox = box(podMeshes.find((m) => m.name === 'bb-pod-hub') as THREE.Mesh);
          // `podParts()` pushes struct, then ring, then drive, in that order, and only the struct
          // reaches anywhere near the wheel (the ring sits up at the top plate and the drive's
          // pulleys sit outboard of the fork) — none of the three carries a `.name`, so the first
          // of them in traversal order is the struct.
          const structMesh = podMeshes.filter((m) => !m.name)[0];
          const wheelR = (wheelBox.max.z - wheelBox.min.z) / 2;
          const crownZ = wheelBox.max.z;
          // the struct's geometry is guaranteed non-indexed (`framePart` flattens every input
          // first — see its own comment), so every run of 3 position entries is one triangle
          const pos = structMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
          const tris: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [];
          for (let i = 0; i + 2 < pos.count; i += 3) {
            const a = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(structMesh.matrixWorld);
            const b = new THREE.Vector3().fromBufferAttribute(pos, i + 1).applyMatrix4(structMesh.matrixWorld);
            const c = new THREE.Vector3().fromBufferAttribute(pos, i + 2).applyMatrix4(structMesh.matrixWorld);
            // keep a triangle if any corner reaches the crown or below it — a straddling triangle
            // still occupies some of the space in front of the tyre
            if (a.z <= crownZ || b.z <= crownZ || c.z <= crownZ) tris.push([a, b, c]);
          }
          const belowVerts = tris.flat().filter((v) => v.z <= crownZ);
          const forkMinX = Math.min(...belowVerts.map((v) => v.x));
          const forkMaxX = Math.max(...belowVerts.map((v) => v.x));
          const forkMinZ = Math.min(...belowVerts.map((v) => v.z));
          const forkLen = forkMaxX - forkMinX;
          check(
            'a swerve POD WHEEL is a wheel: the fork is shorter than the tyre and stops at a boss, not a shroud',
            forkLen < wheelBox.max.x - wheelBox.min.x - 0.6 && forkMinZ > wheelR * 0.6,
            `fork ${forkLen.toFixed(2)} long over a ${(wheelBox.max.x - wheelBox.min.x).toFixed(2)} tyre, bottom ${forkMinZ.toFixed(2)} vs an axle at ${wheelR.toFixed(2)}`,
          );
          // project the below-crown triangles onto the x-z plane and sample a fixed grid over the
          // wheel's own bounding square; a per-triangle bounding box skips most of the point-in-
          // triangle tests, but changes no result, since it is only ever a cheap reject before it.
          const sameSide = (px: number, pz: number, ax: number, az: number, bx: number, bz: number): number =>
            (px - bx) * (az - bz) - (ax - bx) * (pz - bz);
          const inTri = (px: number, pz: number, t: [THREE.Vector3, THREE.Vector3, THREE.Vector3]): boolean => {
            const [a, b, c] = t;
            const d1 = sameSide(px, pz, a.x, a.z, b.x, b.z);
            const d2 = sameSide(px, pz, b.x, b.z, c.x, c.z);
            const d3 = sameSide(px, pz, c.x, c.z, a.x, a.z);
            const neg = d1 < 0 || d2 < 0 || d3 < 0;
            const pos2 = d1 > 0 || d2 > 0 || d3 > 0;
            return !(neg && pos2);
          };
          const candidates = tris.map((t) => ({
            t,
            minX: Math.min(t[0].x, t[1].x, t[2].x),
            maxX: Math.max(t[0].x, t[1].x, t[2].x),
            minZ: Math.min(t[0].z, t[1].z, t[2].z),
            maxZ: Math.max(t[0].z, t[1].z, t[2].z),
          }));
          const GRID = 200;
          let coveredCells = 0;
          for (let gx = 0; gx < GRID; gx++) {
            const px = wheelBox.min.x + ((wheelBox.max.x - wheelBox.min.x) * (gx + 0.5)) / GRID;
            for (let gz = 0; gz < GRID; gz++) {
              const pz = wheelBox.min.z + ((wheelBox.max.z - wheelBox.min.z) * (gz + 0.5)) / GRID;
              if (
                candidates.some(
                  (c) => px >= c.minX && px <= c.maxX && pz >= c.minZ && pz <= c.maxZ && inTri(px, pz, c.t),
                )
              )
                coveredCells++;
            }
          }
          const clearFraction = 1 - coveredCells / (GRID * GRID);
          check(
            '...so most of the tyre’s own circle is unobstructed — it was 0% of it before',
            clearFraction > 0.55,
            `${(clearFraction * 100).toFixed(0)}% of the tyre’s square left clear`,
          );
          check(
            '...and the HUB shows through the gap the boss leaves, so it reads as a hub and not a disc',
            hubBox.max.x - hubBox.min.x > 1.2 && hubBox.max.x - hubBox.min.x < wheelR * 2 - 0.6 && hubBox.max.y > wheelBox.max.y,
            `hub ${(hubBox.max.x - hubBox.min.x).toFixed(2)} across, ${(hubBox.max.y - wheelBox.max.y).toFixed(3)} proud of each tyre face`,
          );
          check(
            '...and the pod’s wheel is plain TRACTION, not one of the mecanum rollers the loop hands every other drivetrain',
            robotsCode.includes("new THREE.Mesh(wheelGeometry(BB_POD_WHEEL_R, BB_WHEEL_W), solidMat(TREAD, 0.95, 0))"),
          );
          disposeRobotGroup(pod);
        }
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
        // ══ THE POD FITS UNDER THE DECK, AND INSIDE THE FRAME AT EVERY STEER ANGLE ═══════════
        //
        // ⚠️ THE CHECK THAT WAS HERE MEASURED THE WRONG CEILING. It computed a pod top of 5.81
        // and asserted it was under `BB3_HEIGHT_MIN` (12), which it comfortably was — while the
        // slew ring stood 1.13 in ABOVE the 4.6-in deck, through the structure the pod hangs
        // from. The ceiling for a pod is the DECK PLATE'S UNDERSIDE, not the robot's legal
        // height, and the FOOTPRINT was never checked at all.
        const num = (name: string): number => Number(new RegExp(`const ${name} = ([\\d.]+);`).exec(robotsSrc)?.[1] ?? NaN);
        const deck = BB_DECK_Z;
        const ringH = num('BB_POD_RING_H');
        const podPlateZ = deck - 0.26 - ringH;
        const podTop = podPlateZ + ringH;
        check(
          'the pod top plate is derived from the deck plate, not typed',
          /const BB_POD_PLATE_Z = BB_DECK_Z - 0\.26 - BB_POD_RING_H;/.test(robotsCode),
          `${podPlateZ.toFixed(2)}`,
        );
        check(
          'THE WHOLE POD LIVES UNDER THE DECK PLATE (it used to stand 1.13 in through it)',
          Number.isFinite(podTop) && podTop <= deck - 0.26 + 1e-9,
          `${podTop.toFixed(2)} in vs the deck's underside ${(deck - 0.26).toFixed(2)}`,
        );
        const podWheelR = num('BB_POD_WHEEL_R');
        check(
          '...which is only possible on a 3-in pod wheel — a 4-in one does not fit under 4.6 in',
          podWheelR * 2 + 0.3 + ringH <= deck - 0.26 + 1e-9,
          `wheel ${(podWheelR * 2).toFixed(2)} + plate + ring vs ${(deck - 0.26).toFixed(2)}`,
        );

        // THE FOOTPRINT. A pod SLEWS, so a box `L × W` rotated about its own centre has a
        // worst-case half-extent of `hypot(L, W) / 2` on either axis — that, or the slew ring's
        // flange, is the inset. Measured before this rule: +0.46 in outside the frame at rest
        // (the ring) and +0.88 at 45° of steer (the fork box), on every chassis size, because
        // the old inset was the constant wheel-channel offset.
        const wheelW = num('BB_WHEEL_W');
        const forkT = num('BB_POD_FORK_T');
        const podDriveT = num('BB_POD_DRIVE_T');
        const podL = num('BB_POD_L');
        const podW = (wheelW / 2 + 0.2 + forkT / 2 + podDriveT) * 2;
        const ringR = num('BB_POD_RING_R');
        const flange = num('BB_POD_RING_FLANGE');
        const inset = Math.max(Math.hypot(podL, podW) / 2, ringR + flange);
        check(
          'BB_POD_INSET is the slewing box’s own half-diagonal, re-derived here',
          /const BB_POD_INSET = Math\.max\(Math\.hypot\(BB_POD_L, BB_POD_W\) \/ 2, BB_POD_RING_R \+ BB_POD_RING_FLANGE\);/.test(robotsCode) &&
            Number.isFinite(inset),
          `${inset.toFixed(3)} in`,
        );
        for (const [L, W] of [
          [12, 12],
          [14.5, 16.5],
          [18, 18],
        ] as const) {
          const hl = L / 2;
          const hw = W / 2;
          // NOTHING the pod carries — a slewing corner, the ring's flange or the wheel itself —
          // may reach further from the pod's centre than the inset, so a pod centred at
          // `(hl − inset, hw − inset)` touches each frame face and never crosses it.
          const worst = Math.max(Math.hypot(podL, podW) / 2, ringR + flange, podWheelR);
          check(
            `swerve ${L}x${W}: every pod corner stays inside the frame at every steer angle`,
            hl - inset > 0 && hw - inset > 0 && worst <= inset + 1e-9,
            `centre ±${(hl - inset).toFixed(2)},±${(hw - inset).toFixed(2)}, worst reach ${worst.toFixed(3)} vs inset ${inset.toFixed(3)}`,
          );
          // ...and the four pods cannot overlap each other, even on the smallest legal chassis
          check(
            `swerve ${L}x${W}: the four pods clear each other`,
            2 * (hw - inset) > Math.hypot(podL, podW) && 2 * (hl - inset) > Math.hypot(podL, podW),
            `${(2 * Math.min(hl, hw) - 2 * inset).toFixed(2)} apart vs ${Math.hypot(podL, podW).toFixed(2)}`,
          );
        }
        // ...and the frame must stop drawing a channel the pod would be built through
        check(
          'buildFrame drops the inner side plate for swerve (a pod at the new inset runs through it)',
          robotsCode.includes("const dropInner = spec.drivetrain === 'swerve' || spec.drivetrain === 'xdrive';") &&
            robotsCode.includes('const plateYs = dropInner ? [outerY] : [outerY, innerY];') &&
            robotsCode.includes('for (const y of plateYs) {'),
        );

        // ══ AN X-DRIVE OMNI STAYS INSIDE THE FRAME TOO ══════════════════════════════════════
        // Owner, 2026-09-19: "selecting x drive makes the wheels stick out of the robot". A wheel
        // `2R × W` canted 45° reaches `(2R + W) / (2√2)` along BOTH axes; in the mecanum channel
        // (centre-line `plate + gap/2` = 1.17 in inside the frame) that stood 0.78 in proud of the
        // side plate on every chassis. The inset is the canted reach plus what it has to clear:
        // the side plate laterally, the cross member fore-and-aft.
        const wheelR = num('BB_WHEEL_R');
        const reach = (2 * wheelR + wheelW) / (2 * Math.SQRT2);
        const insetX = reach + num('BB_RAIL_T') + 0.15;
        const insetY = reach + num('BB_PLATE_T') + 0.15;
        check(
          'the X-drive insets are the canted wheel’s own reach, re-derived here',
          robotsCode.includes('const BB_XDRIVE_REACH = (2 * BB_WHEEL_R + BB_WHEEL_W) / (2 * Math.SQRT2);') &&
            robotsCode.includes('export const BB_XDRIVE_INSET_X = BB_XDRIVE_REACH + BB_RAIL_T + BB_XDRIVE_CLEAR;') &&
            robotsCode.includes('export const BB_XDRIVE_INSET_Y = BB_XDRIVE_REACH + BB_PLATE_T + BB_XDRIVE_CLEAR;') &&
            /const BB_XDRIVE_CLEAR = 0\.15;/.test(robotsCode),
          `reach ${reach.toFixed(3)}, inset x ${insetX.toFixed(3)} / y ${insetY.toFixed(3)}`,
        );
        check(
          '...and buildWheels places an X-drive wheel by them, not in the mecanum channel',
          robotsCode.includes('Math.max(0.5, hl - BB_XDRIVE_INSET_X)') && robotsCode.includes('Math.max(0.5, hw - BB_XDRIVE_INSET_Y)'),
        );
        for (const [L, W] of [
          [12, 12],
          [14.5, 16.5],
          [18, 18],
        ] as const) {
          const cx = L / 2 - insetX;
          const cy = W / 2 - insetY;
          check(
            `xdrive ${L}x${W}: every wheel clears the side plate and the cross member, inside the frame`,
            cx > 0.5 && cy > 0.5 && cx + reach <= L / 2 - num('BB_RAIL_T') && cy + reach <= W / 2 - num('BB_PLATE_T'),
            `centre ±${cx.toFixed(2)},±${cy.toFixed(2)}, outermost ${(cx + reach).toFixed(2)} of ${L / 2}, ${(cy + reach).toFixed(2)} of ${W / 2}`,
          );
          check(
            `xdrive ${L}x${W}: the four wheels clear each other`,
            2 * cx > 2 * reach && 2 * cy > 2 * reach,
            `${(2 * Math.min(cx, cy)).toFixed(2)} apart vs ${(2 * reach).toFixed(2)}`,
          );
        }
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

      /**
       * ── 2026-09-19 OWNER: THE FRONT BRACE ────────────────────────────────────────────────
       * *"The intake plates stick out further than the intake rollers so the hitboxes are
       * weird... add a bracing across the two intake plates in the front"*, and then *"let's do
       * a bracing in the front then, to make the collision hitbox a long rectangle across in the
       * front"*. The solve's half is `chassis3dPocketShapes`; this is the PICTURE's half, and
       * the two must say the same thing: a bar the full mouth width, ending on the tip line, its
       * underside one NECTAR diameter up so an element still passes under into the mouth.
       *
       * Measured on the built GROUP, not grepped: every vertex of every intake node, in the
       * mouth's own frame, against the tip line. A plate that grows back past the roller, or a
       * brace that slips down into the element's path, fails here.
       */
      {
        const mk = (over: Partial<RobotSpec>): RobotSpec => bbCoerceSpec({ ...BB_DEFAULT_SPEC, ...over } as RobotSpec);
        for (const mount of ['front', 'back', 'side', 'frontback'] as const) {
          for (const chainIntake of ['sloped', 'vector', 'triangle'] as const) {
            const spec = mk({ intakeMount: mount, chainIntake } as Partial<RobotSpec>);
            const group = new THREE.Group();
            for (const n of buildIntake(spec).nodes) group.add(n);
            group.updateMatrixWorld(true);
            const hl = spec.length / 2;
            const hw = spec.width / 2;
            for (const m of bbMouths(spec)) {
              const f = bbMouthFrame(m, hl, hw);
              const node = group.getObjectByName(`robot:intake:${m.edge}`);
              const brace = group.getObjectByName(`robot:intake:brace:${m.edge}`);
              if (!node || !brace) {
                check(`intake ${mount}/${chainIntake}/${m.edge}: the front brace exists`, false, 'no node');
                continue;
              }
              /**
               * every vertex, carried into the MOUTH's own frame (+x OUTWARD from its origin).
               * ⚠️ The tolerance is 0.06 in and it is MEASURED, not chosen: the arm's DIAGONAL
               * member is a rotated box, so half its 0.34-in thickness projects 0.0496 in past
               * the line its centre ends on. That predates this pass and is a rotated member's
               * corner, not a plate reaching past the roller — which is what the check is for.
               */
              const OVERHANG = 0.06;
              const along = (o: THREE.Object3D): number => {
                let best = -Infinity;
                const v = new THREE.Vector3();
                o.traverse((n) => {
                  const g3 = (n as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
                  const pos = g3?.getAttribute?.('position');
                  if (!pos) return;
                  for (let i = 0; i < pos.count; i++) {
                    v.fromBufferAttribute(pos as THREE.BufferAttribute, i).applyMatrix4(n.matrixWorld);
                    best = Math.max(best, (v.x - f.ox) * Math.cos(f.rot) + (v.y - f.oy) * Math.sin(f.rot));
                  }
                });
                return best;
              };
              const outer = along(node);
              const braceOut = along(brace);
              const bb = new THREE.Box3().setFromObject(brace);
              const span = m.edge === 'front' || m.edge === 'back' ? bb.max.y - bb.min.y : bb.max.x - bb.min.x;
              check(
                `intake ${mount}/${chainIntake}/${m.edge}: nothing drawn reaches past the collision tip`,
                outer <= f.depth + OVERHANG,
                `outermost vertex ${outer.toFixed(4)} vs tip ${f.depth.toFixed(4)}`,
              );
              check(
                `intake ${mount}/${chainIntake}/${m.edge}: the front brace spans the mouth and ends on the tip`,
                span > f.half * 2 - 1.5 && Math.abs(braceOut - f.depth) < 1e-6,
                `span ${span.toFixed(2)} of ${(f.half * 2).toFixed(2)}, brace face ${braceOut.toFixed(4)} vs tip ${f.depth.toFixed(4)}`,
              );
              check(
                `intake ${mount}/${chainIntake}/${m.edge}: an element still passes under the brace`,
                bb.min.z >= 2 * BB_NECTAR_R - 1e-6,
                `underside ${bb.min.z.toFixed(3)} vs a NECTAR's ${(2 * BB_NECTAR_R).toFixed(3)}`,
              );
            }
          }
        }
      }

      // ── 2026-09-19 OWNER PLAYTEST: THE INTAKE'S SIDES, AND PASSING UNDER THE ROLLER ───────
      // "its sides must not be solid aluminium plate" and "it should still allow for pollen and
      // nectar to pass under". Both were the picture claiming solid the COLLIDER does not have:
      // `chassis3dShapes` gives the mouth a bare rail and leaves the pocket open from the tiles
      // to `BB3_MOUTH_SLOT_Z`, and the roller is not a collider in either backend.
      {
        const num = (name: string): number => Number(new RegExp(`const ${name} = ([\\d.]+);`).exec(robotsSrc)?.[1] ?? NaN);
        check(
          'the intake arm is an OPEN TRUSS, not a solid plate',
          // the members are named in COMMENTS, so this reads the raw source: `codeLines` strips
          // them, which is right for the arithmetic greps and wrong for this one
          !/platePlane\(armLen/.test(robotsCode) &&
            robotsSrc.includes('THE BOTTOM RAIL') &&
            robotsSrc.includes('THE AXLE BOSS') &&
            robotsSrc.includes('THE DIAGONAL'),
        );
        check(
          '...and no member of it is thicker than the flank rail the COLLIDER claims',
          robotsCode.includes('const armT = INTAKE_RAIL_T;') && INTAKE_RAIL_T > 0,
          `${INTAKE_RAIL_T} in`,
        );
        // PASS-UNDER, as arithmetic over the deflection law itself. The rigid flap swept to
        // `BB_ROLLER_FLAP_R` and blocked the pocket by 1.10 in; a hinged flap folds back as it
        // reaches the floor of the sweep, which is what a compliant flap physically does.
        const hubR = num('BB_ROLLER_HUB_R');
        const flapR = num('BB_ROLLER_FLAP_R');
        const flapT = num('BB_ROLLER_FLAP_T');
        const rollerZ = BB3_MOUTH_SLOT_Z + hubR + 0.15;
        const passZ = BB3_MOUTH_SLOT_Z + flapT / 2;
        const L = flapR - hubR;
        check(
          'the roller HUB still clears the collider’s open pocket on its own',
          rollerZ - hubR >= BB3_MOUTH_SLOT_Z,
          `hub bottom ${(rollerZ - hubR).toFixed(2)} vs slot ${BB3_MOUTH_SLOT_Z}`,
        );
        check(
          'a RIGID flap of this length would block it — which is the bug being fixed',
          rollerZ - flapR < BB3_MOUTH_SLOT_Z,
          `${(BB3_MOUTH_SLOT_Z - (rollerZ - flapR)).toFixed(2)} in of intrusion`,
        );
        {
          // walk a full turn, re-deriving the fold law rather than importing it: a flap is a
          // straight segment from its hinge on the hub rim to its tip, so the segment's lowest
          // point is one of its two ends and the envelope is the minimum over both
          const target = passZ - rollerZ;
          const foldAt = (a: number): number => {
            const s = (target - hubR * Math.sin(a)) / L;
            if (Math.sin(a) >= s) return 0;
            return Math.max(0, a - (Math.PI - Math.asin(Math.max(-1, Math.min(1, s)))));
          };
          let lowest = Infinity;
          let foldMax = 0;
          for (let i = 0; i < 1440; i++) {
            const a = (i * Math.PI * 2) / 1440;
            const fold = foldAt(a);
            foldMax = Math.max(foldMax, fold);
            const hz = Math.sin(a) * hubR;
            const tz = hz + Math.sin(a - fold) * L;
            lowest = Math.min(lowest, rollerZ + Math.min(hz, tz) - flapT / 2);
          }
          check(
            'AN ELEMENT PASSES UNDER: the drawn flap envelope never enters the collider’s pocket',
            lowest >= BB3_MOUTH_SLOT_Z - 1e-9,
            `lowest ${lowest.toFixed(3)} vs slot ${BB3_MOUTH_SLOT_Z}`,
          );
          check(
            '...and it yields only where it has to — no fold at all over the top of the sweep',
            foldMax > 1 && foldAt(Math.PI / 2) === 0 && foldAt(0) === 0,
            `max fold ${((foldMax * 180) / Math.PI).toFixed(0)}°`,
          );
        }
        check(
          '...and the flaps are posed every frame, running or not (a stopped roller blocks too)',
          robotsCode.includes('for (let k = 0; k < roller.flaps.length; k++)') &&
            !/if \(running\) \{?\s*for \(let k/.test(robotsCode),
        );
        check(
          '...off ONE deflection law, so the check above is measuring the drawn part',
          /function flapFold\(a: number\): number/.test(robotsCode) &&
            robotsCode.includes('const fold = flapFold(a);'),
        );
      }

      // ── 2026-09-20 OWNER: "INTAKING FROM THE FLOWER SHOULD NOW ONLY BE DONE IF IT IS
      // PHYSICALLY POSSIBLE" — THE THREE INTAKE ARCHETYPES ────────────────────────────────────
      // `siderollers` and `ramp` are extra hardware on the SAME sweeper every build already
      // carries (`bbIntakeKindOf`); the sweeper's own drawing must not move a vertex — every
      // check above this one already re-runs on the sweeper path (it is `mk`'s default, no
      // `bbMech.intake` override), so it is already the byte-identical proof. What is new here
      // is measured on the BUILT group, the same style as the front brace above: "the drawn part
      // that reaches is the part `bbFlowerReachOf` credits" (`config.ts`'s own header).
      {
        const mk = (over: Partial<RobotSpec>): RobotSpec => bbCoerceSpec({ ...BB_DEFAULT_SPEC, ...over } as RobotSpec);
        const num = (name: string): number => Number(new RegExp(`const ${name} = ([\\d.]+);`).exec(robotsSrc)?.[1] ?? NaN);
        const flapR = num('BB_ROLLER_FLAP_R');
        const hubR = num('BB_ROLLER_HUB_R');
        const rollerZ = BB3_MOUTH_SLOT_Z + hubR + 0.15;

        check(
          'the ramp pivots on the sweeper’s own axle line — BB_RAMP_PIVOT_BACK is BB_ROLLER_FLAP_R',
          Number.isFinite(flapR) && Math.abs(BB_RAMP_PIVOT_BACK - flapR) < 1e-9,
          `${BB_RAMP_PIVOT_BACK} vs ${flapR}`,
        );
        check(
          'the archetype vocabulary is exactly the three kinds this lane tests',
          BB_INTAKE_KINDS.length === 3 && BB_INTAKE_KINDS.includes('siderollers') && BB_INTAKE_KINDS.includes('ramp'),
          BB_INTAKE_KINDS.join(','),
        );

        // a vertex → (u, v, z) in the MOUTH's own frame: u outward past the tip, v across the
        // mouth, z off the tiles. The same projection the front-brace check above uses for u
        // alone, generalised to all three axes so the ramp's deployed pose can be measured too.
        const mouthExtent = (o: THREE.Object3D, f: { ox: number; oy: number; rot: number }) => {
          let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity, zMin = Infinity, zMax = -Infinity;
          const v3 = new THREE.Vector3();
          o.traverse((n) => {
            const g3 = (n as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
            const pos = g3?.getAttribute?.('position');
            if (!pos) return;
            for (let i = 0; i < pos.count; i++) {
              v3.fromBufferAttribute(pos as THREE.BufferAttribute, i).applyMatrix4(n.matrixWorld);
              const dx = v3.x - f.ox;
              const dy = v3.y - f.oy;
              const u = dx * Math.cos(f.rot) + dy * Math.sin(f.rot);
              const v = -dx * Math.sin(f.rot) + dy * Math.cos(f.rot);
              uMin = Math.min(uMin, u); uMax = Math.max(uMax, u);
              vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
              zMin = Math.min(zMin, v3.z); zMax = Math.max(zMax, v3.z);
            }
          });
          return { uMin, uMax, vMin, vMax, zMin, zMax };
        };

        for (const mount of ['front', 'back', 'side', 'frontback'] as const) {
          for (const kind of BB_INTAKE_KINDS) {
            const spec = mk({ intakeMount: mount, bbMech: { intake: { kind } } } as Partial<RobotSpec>);
            const built = buildIntake(spec);
            const group = new THREE.Group();
            for (const n of built.nodes) group.add(n);
            group.updateMatrixWorld(true);
            const hl = spec.length / 2;
            const hw = spec.width / 2;
            const mouths = bbMouths(spec);
            const label = `intake ${mount}/${kind}`;

            if (kind === 'sweeper') {
              check(
                `${label}: builds no side-roller or ramp hardware`,
                built.sideRollers.length === 0 && built.rampPivots.length === 0,
                `${built.sideRollers.length} rollers, ${built.rampPivots.length} pivots`,
              );
              check(
                `${label}: and no such node is anywhere in the group`,
                group.getObjectByName(`robot:sideroller:${mouths[0].edge}:l`) === undefined &&
                  group.getObjectByName(`robot:ramp:${mouths[0].edge}`) === undefined,
              );
              continue;
            }

            if (kind === 'siderollers') {
              check(
                `${label}: one wheel pair per mouth`,
                built.sideRollers.length === mouths.length * 2,
                `${built.sideRollers.length} vs ${mouths.length * 2}`,
              );
              for (const m of mouths) {
                const f = bbMouthFrame(m, hl, hw);
                for (const side of ['l', 'r'] as const) {
                  const wheel = group.getObjectByName(`robot:sideroller:${m.edge}:${side}`);
                  if (!wheel) {
                    check(`${label}/${m.edge}/${side}: the wheel node exists`, false);
                    continue;
                  }
                  const ext = mouthExtent(wheel, f);
                  // `BB_SIDE_ROLLER_REACH.out` is measured FROM THE TIP LINE (`config.ts`'s own
                  // header); the built wheel sits at absolute mouth-local u = tip + that reach.
                  const outMin = ext.uMin - f.depth;
                  const outMax = ext.uMax - f.depth;
                  check(
                    `${label}/${m.edge}/${side}: reaches exactly BB_SIDE_ROLLER_REACH.out past the tip`,
                    Math.abs(outMin - BB_SIDE_ROLLER_REACH.out[0]) < 1e-6 &&
                      Math.abs(outMax - BB_SIDE_ROLLER_REACH.out[1]) < 1e-6,
                    `[${outMin.toFixed(6)}, ${outMax.toFixed(6)}] vs [${BB_SIDE_ROLLER_REACH.out[0]}, ${BB_SIDE_ROLLER_REACH.out[1]}]`,
                  );
                  check(
                    `${label}/${m.edge}/${side}: and BB_SIDE_ROLLER_REACH.z`,
                    Math.abs(ext.zMin - BB_SIDE_ROLLER_REACH.z[0]) < 1e-6 &&
                      Math.abs(ext.zMax - BB_SIDE_ROLLER_REACH.z[1]) < 1e-6,
                    `[${ext.zMin.toFixed(6)}, ${ext.zMax.toFixed(6)}] vs [${BB_SIDE_ROLLER_REACH.z[0]}, ${BB_SIDE_ROLLER_REACH.z[1]}]`,
                  );
                  const wantV = side === 'l' ? BB_SIDE_ROLLER_Y : -BB_SIDE_ROLLER_Y;
                  const centreV = (ext.vMin + ext.vMax) / 2;
                  check(
                    `${label}/${m.edge}/${side}: centred at ±BB_SIDE_ROLLER_Y off the mouth centreline`,
                    Math.abs(centreV - wantV) < 1e-6,
                    `${centreV.toFixed(6)} vs ${wantV}`,
                  );
                }
              }
            }

            if (kind === 'ramp') {
              check(
                `${label}: one pivot per mouth`,
                built.rampPivots.length === mouths.length,
                `${built.rampPivots.length} vs ${mouths.length}`,
              );
              for (const m of mouths) {
                const f = bbMouthFrame(m, hl, hw);
                const pivot = group.getObjectByName(`robot:ramp:${m.edge}`);
                const bar = group.getObjectByName(`robot:ramp:bar:${m.edge}`);
                const railL = group.getObjectByName(`robot:ramp:rail:${m.edge}:l`);
                const railR = group.getObjectByName(`robot:ramp:rail:${m.edge}:r`);
                const roller = group.getObjectByName(`robot:sweeper:${m.edge}`);
                if (!pivot || !bar || !railL || !railR || !roller) {
                  check(`${label}/${m.edge}: every ramp node exists`, false, `pivot=${!!pivot} bar=${!!bar} rails=${!!railL}/${!!railR} roller=${!!roller}`);
                  continue;
                }
                group.updateMatrixWorld(true);

                // ── FOLDED (the built default: `pivot.rotation.y` starts at 0) ──────────────
                const barFolded = mouthExtent(bar, f);
                check(
                  `${label}/${m.edge}: folded, the crossbar top clears the flap sweep`,
                  barFolded.zMax > rollerZ + flapR,
                  `${barFolded.zMax.toFixed(3)} vs sweep top ${(rollerZ + flapR).toFixed(3)}`,
                );
                // MOUTH-LOCAL (u, v, z), not world Box3: a `back`/`right` mouth is itself
                // rotated (`f.rot`), which flips which WORLD side "l" lands on — `mouthExtent`
                // undoes that rotation, so "l" reads as the +v side on every edge.
                const rollerExt = mouthExtent(roller, f);
                const railLExt = mouthExtent(railL, f);
                const railRExt = mouthExtent(railR, f);
                check(
                  `${label}/${m.edge}: the rails clear the (shortened) barrel, one each side`,
                  railLExt.vMin >= rollerExt.vMax - 1e-6 && railRExt.vMax <= rollerExt.vMin + 1e-6,
                  `barrel v [${rollerExt.vMin.toFixed(3)}, ${rollerExt.vMax.toFixed(3)}], rails v [${railRExt.vMax.toFixed(3)}, ${railLExt.vMin.toFixed(3)}]`,
                );

                // ── DEPLOYED — posed by hand, off the SAME angle `config.ts` derives its own
                // reach from, so this measures the BUILT geometry against that derivation
                // rather than re-deriving it a second time. A specific REFERENCE POINT, not a
                // bounding-box extreme: the crossbar box has its own thickness, so its axis-
                // aligned corners are not the rail-tip centreline once the pivot is rotated.
                pivot.rotation.y = Math.PI / 2 + BB_RAMP_ANGLE;
                group.updateMatrixWorld(true);
                const tipWorld = new THREE.Vector3(0, 0, BB_RAMP_L).applyMatrix4(pivot.matrixWorld);
                const dxTip = tipWorld.x - f.ox;
                const dyTip = tipWorld.y - f.oy;
                const tipU = dxTip * Math.cos(f.rot) + dyTip * Math.sin(f.rot);
                check(
                  `${label}/${m.edge}: deployed, the rail tip (and the crossbar's outer face) lands at (tip + BB_RAMP_OUT, BB_RAMP_TIP_Z)`,
                  Math.abs(tipU - (f.depth + BB_RAMP_OUT)) < 1e-3 && Math.abs(tipWorld.z - BB_RAMP_TIP_Z) < 1e-3,
                  `u ${tipU.toFixed(4)} vs ${(f.depth + BB_RAMP_OUT).toFixed(4)}, z ${tipWorld.z.toFixed(4)} vs ${BB_RAMP_TIP_Z.toFixed(4)}`,
                );
                const baseWorld = new THREE.Vector3(0, 0, 0).applyMatrix4(pivot.matrixWorld);
                const dxBase = baseWorld.x - f.ox;
                const dyBase = baseWorld.y - f.oy;
                const baseU = dxBase * Math.cos(f.rot) + dyBase * Math.sin(f.rot);
                const railAngle = Math.atan2(tipWorld.z - baseWorld.z, tipU - baseU);
                check(
                  `${label}/${m.edge}: deployed, the rails lie BB_RAMP_ANGLE below level`,
                  Math.abs(railAngle + BB_RAMP_ANGLE) < 1e-6,
                  `${railAngle.toFixed(6)} rad vs ${(-BB_RAMP_ANGLE).toFixed(6)}`,
                );
                pivot.rotation.y = 0; // leave it as `buildIntake` built it
              }
            }
          }
        }

        // ── THE EASE — the same smoothstep the Box Tube uses, wired the same way (`bbRampAt` /
        // `world.time`, clamped to [0, 1]) and re-derived standalone here (the RENDER lane has no
        // `World` to run `sync` against — see the file header). At t0 the robot is still FOLDED
        // (frac 0); a `BB_RAMP_DEPLOY_S` later it is fully DEPLOYED (frac 1).
        check(
          'the sync code eases the ramp off `bbRampAt`/`world.time`, clamped and smoothstepped',
          robotsCode.includes('r.bbRampAt ?? -Infinity') &&
            robotsCode.includes('BB_RAMP_DEPLOY_S') &&
            robotsCode.includes('smoothstep01(t)'),
        );
        check(
          'the side rollers spin off the SAME running gate as the sweeper, opposite senses',
          robotsCode.includes('sr.phase += BB_ROLLER_SPIN * dt * sr.sign;'),
        );
        {
          const ease = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - c * 2); };
          const deployedAngle = Math.PI / 2 + BB_RAMP_ANGLE;
          const poseAt = (raw: number, out: boolean) => {
            const frac = ease(raw);
            return out ? deployedAngle * frac : deployedAngle * (1 - frac);
          };
          check(
            'ease: at t0 (deploying) the pose is FOLDED',
            Math.abs(poseAt(0, true) - 0) < 1e-9,
          );
          check(
            'ease: a BB_RAMP_DEPLOY_S later (deploying) the pose is DEPLOYED',
            Math.abs(poseAt(1, true) - deployedAngle) < 1e-9,
          );
          check(
            'ease: at t0 (retracting) the pose is still DEPLOYED, and a BB_RAMP_DEPLOY_S later it is FOLDED',
            Math.abs(poseAt(0, false) - deployedAngle) < 1e-9 && Math.abs(poseAt(1, false) - 0) < 1e-9,
          );
          check(
            'BB_RAMP_DEPLOY_S is a positive, finite window (else the ease divides by zero or never arrives)',
            Number.isFinite(BB_RAMP_DEPLOY_S) && BB_RAMP_DEPLOY_S > 0,
            `${BB_RAMP_DEPLOY_S}s`,
          );
        }

        // ── THE 2D SPRITE: same archetypes, drawn OUTSIDE the footprint clip (`drawRobot.ts`'s
        // header on `drawBiobuzzIntakeReach`). Behavioural, not a string match — the calls ARE
        // the behaviour, same as the shot path above.
        interface ReachOp { op: string }
        const reachOps = (kind: (typeof BB_INTAKE_KINDS)[number]): ReachOp[] => {
          const ops: ReachOp[] = [];
          const rec = (op: string) => () => { ops.push({ op }); };
          const ctx = {
            save: rec('save'), restore: rec('restore'), beginPath: rec('beginPath'),
            moveTo: rec('moveTo'), lineTo: rec('lineTo'), stroke: rec('stroke'), fill: rec('fill'),
            arc: rec('arc'), translate: rec('translate'), rotate: rec('rotate'),
            set strokeStyle(_v: string) {}, set fillStyle(_v: string) {}, set lineWidth(_v: number) {},
          } as unknown as CanvasRenderingContext2D;
          const spec = mk({ bbMech: { intake: { kind } } } as Partial<RobotSpec>);
          const r = { spec, bbRampOut: false } as unknown as RobotState;
          drawBiobuzzIntakeReach(ctx, r, false, undefined);
          return ops;
        };
        check(
          '2D: the sweeper kind draws NOTHING extra past the footprint (byte-identical sprite)',
          reachOps('sweeper').length === 0,
        );
        check('2D: the siderollers kind draws its wheels', reachOps('siderollers').length > 0);
        check('2D: the ramp kind draws its rest-pose outline', reachOps('ramp').length > 0);
      }

      // ── 2026-09-19 OWNER PLAYTEST: "THE BOX TUBE MUST RENDER PROPERLY" ───────────────────
      // It was ONE solid `BoxGeometry(3, 1.4, 1.4)` at `turretLocal(...)`: the turret ring's
      // inboard pull rather than the tube's own mount, 3 in along LOCAL X whatever direction the
      // mount faced, ending 2.10 in INSIDE the frame rail on the default build while the sim
      // placed at x 12.88 — and never touched by `sync` at all.
      {
        check(
          'the 3D tube is built from the SHARED glyph and the sim’s own placement point',
          robotsCode.includes('bbBoxTubeGlyph(spec, mount, place)') &&
            robotsCode.includes('const place = bbPlacePointLocal(spec);') &&
            !/BoxGeometry\(3, 1\.4, 1\.4\)/.test(robotsCode),
        );
        check(
          '...and AIMED, which is the one line that fixes a side or corner mount',
          robotsCode.includes('node.rotation.z = Math.atan2(glyph.uy, glyph.ux);'),
        );
        check(
          '...and it names no box-tube constant of its own (they are hardware, so they live in config.ts)',
          !/const BB_BOX_TUBE_[A-Z_]+ =/.test(robotsCode) && robotsCode.includes('BB_BOX_TUBE_SECTIONS'),
        );
        check(
          '...and it is HOLLOW — hollowness is what says "tube" rather than "bar"',
          robotsCode.includes('BB_BOX_TUBE_WALL') && /const wall = BB_BOX_TUBE_WALL;/.test(robotsCode),
        );
        check(
          'the sections nest exactly: each bore is the next section’s outside',
          BB_BOX_TUBE_SECTIONS.every(
            (w, i) => i === 0 || Math.abs(BB_BOX_TUBE_SECTIONS[i - 1] - 2 * BB_BOX_TUBE_WALL - w) < 1e-9,
          ),
          BB_BOX_TUBE_SECTIONS.join(' / '),
        );
        // ARITHMETIC over every mount the builder can produce: the fully extended TIP is the
        // sim's placement point, exactly. This is the check that would have caught all of
        // items 1–3 at once.
        const mk = (over: Partial<RobotSpec>): RobotSpec => bbCoerceSpec({ ...BB_DEFAULT_SPEC, ...over } as RobotSpec);
        const mounts = ['front', 'back', 'left', 'right', 'frontleft', 'frontright', 'backleft', 'backright'] as const;
        for (const mount of mounts) {
          for (const intakeMount of ['front', 'side'] as const) {
            const spec = mk({ bbMech: { lift: { kind: 'boxtube', mount } }, intakeMount } as Partial<RobotSpec>);
            const lift = bbLiftOf(spec);
            const place = bbPlacePointLocal(spec);
            if (!lift || !place) {
              check(`box tube ${mount}/${intakeMount}: the build carries a tube at all`, false, 'no lift on the coerced spec');
              continue;
            }
            const glyph = bbBoxTubeGlyph(spec, lift.mount, place);
            const reach = Math.hypot(place.x - glyph.outer.x, place.y - glyph.outer.y);
            const tipX = glyph.outer.x + glyph.ux * reach;
            const tipY = glyph.outer.y + glyph.uy * reach;
            check(
              `box tube ${mount}/${intakeMount}: the arm's own AIM LINE runs through the sim's placement point`,
              Math.abs(tipX - place.x) < 1e-9 && Math.abs(tipY - place.y) < 1e-9,
              `(${tipX.toFixed(3)}, ${tipY.toFixed(3)}) vs (${place.x.toFixed(3)}, ${place.y.toFixed(3)})`,
            );
            // ...and it CLEARS THE FRAME, which is the "built inside the chassis" bug recurring
            // on the one mechanism the 2026-09-18 pass did not reach
            const fx = bbFootprint(spec);
            const beyond = Math.max(Math.abs(tipX) - (Math.abs(place.x) > 1e-9 ? spec.length / 2 : 0), Math.abs(tipY) - (Math.abs(place.y) > 1e-9 ? spec.width / 2 : 0));
            check(
              `box tube ${mount}/${intakeMount}: the tip reaches PAST the frame`,
              beyond > 0.5,
              `${beyond.toFixed(2)} in past the rail (footprint front ${fx.front.toFixed(2)})`,
            );
            // and the stage table is physical: n equal travels, each stage keeping one overlap
            // captured inside the one outboard of it, and nothing poking out when retracted
            const st = bbBoxTubeStages(reach);
            check(
              `box tube ${mount}/${intakeMount}: the stages nest, and n travels sum to the full arm`,
              st.moving === BB_BOX_TUBE_SECTIONS.length - 1 &&
                Math.abs(st.moving * st.travel - st.full) < 1e-9 &&
                st.sectionLen - st.travel >= BB_BOX_TUBE_STAGE_OVERLAP - 1e-9 &&
                st.travel > 0,
              `${st.moving} × ${st.travel.toFixed(2)} = ${st.full.toFixed(2)}, section ${st.sectionLen.toFixed(2)}`,
            );
          }
        }
        check(
          'the tube EXTENDS off the sim’s own reach predicate, and eases on the WORLD clock',
          robotsCode.includes('const flower = bbFlowerInReach(world, r);') &&
            robotsCode.includes('dt / BB_BOX_TUBE_EXTEND_S') &&
            robotsCode.includes('const dt = Math.max(0, Math.min(0.2, world.time - lastTime));'),
        );
        check(
          '...and the ease is on the ENTRY, so a specKey rebuild resets it rather than easing from a stale reach',
          /tubeEase: number;/.test(robotsCode) && /entry = \{ group: g, key, tubeEase: 0[,}]/.test(robotsCode),
        );
        check(
          '...and NOTHING about it is written back to the world (placement has no sim travel)',
          !/r\.(bbTube|tubeEase)/.test(robotsCode),
        );
      }

      // ── 2026-09-20 OWNER: "REACHING TOWARDS THE OPENING IN THE FLOWER, NOT EXTENDING
      //    HORIZONTALLY. IT SHOULD ALSO BE A LOT FASTER." ────────────────────────────────────
      //
      // The arm used to slide flat along the mount direction to `bbPlacePointLocal` — a point on
      // the TILES — while the thing it places into is a hole 21.404 in up. The pose is solved per
      // frame now (`bbBoxTubeAim` against the flower `bbFlowerInReach` returned), so this block
      // sweeps every in-reach pose of every legal build and asserts the DRAWN tip lands on the
      // opening, that no stage leaves its parent doing it, and that the retracted arm is still
      // the segment the old drawing occupied.
      {
        check(
          `the deploy is ${BB_BOX_TUBE_EXTEND_S} s, not the 0.35 the owner called slow`,
          BB_BOX_TUBE_EXTEND_S >= 0.1 && BB_BOX_TUBE_EXTEND_S <= 0.15,
          `${BB_BOX_TUBE_EXTEND_S}`,
        );
        check(
          'the arm is posed from the SIM’s flower, not a canned angle — one solver, two drawings',
          robotsCode.includes('const aim = bbBoxTubeAim(') &&
            robotsCode.includes('const f = BB_FLOWERS[flower];') &&
            robotsCode.includes('BB_FLOWER_TOP_Z + BB_BOX_TUBE_TIP_CLEAR'),
        );
        check(
          '...pitching about a SHOULDER at the frame rail, with a drawn bracket on it',
          /node\.position\.set\(glyph\.outer\.x, glyph\.outer\.y, BB_BOX_TUBE_Z\);/.test(robotsCode) &&
            robotsCode.includes('`robot:${id}:tube:pivot`') &&
            robotsCode.includes('`robot:${id}:tube:pitch`') &&
            robotsCode.includes('`robot:${id}:tube:swivel`'),
        );
        check(
          '...and the CRADLE (section 0) hangs off the base node, so no pose can move it',
          robotsCode.includes('(i === 0 ? node : pitch).add(mesh);'),
        );
        check(
          '...and ONE ease drives pitch, swivel and extension together',
          /rig\.swivel\.rotation\.z = e \* entry\.tubeYaw;/.test(robotsCode) &&
            /rig\.pitch\.rotation\.y = -e \* entry\.tubePitch;/.test(robotsCode) &&
            /stages\[i\]\.position\.x = e \* entry\.tubeExt \* \(i \+ 1\);/.test(robotsCode),
        );

        // ARITHMETIC, over the whole legal build space and a grid of in-reach poses.
        const TIP_Z = BB_FLOWER_TOP_Z + BB_BOX_TUBE_TIP_CLEAR;
        const tubeMounts = ['front', 'back', 'left', 'right', 'frontleft', 'frontright', 'backleft', 'backright'] as const;
        let poses = 0;
        let worstTip = 0;
        let worstOverlap = Infinity;
        let pitchLo = Infinity;
        let pitchHi = -Infinity;
        let swivelHi = 0;
        let short = 0;
        let restOff = 0;
        let lowTail = Infinity;
        for (const mount of tubeMounts) {
          for (const intakeMount of ['front', 'side', 'frontback'] as const) {
            const spec = bbCoerceSpec({
              ...BB_DEFAULT_SPEC,
              bbMech: { lift: { kind: 'boxtube', mount } },
              intakeMount,
            } as unknown as RobotSpec);
            const lift = bbLiftOf(spec);
            const place = bbPlacePointLocal(spec);
            if (!lift || !place) continue;
            const glyph = bbBoxTubeGlyph(spec, lift.mount, place);
            const reach = Math.hypot(place.x - glyph.outer.x, place.y - glyph.outer.y);
            const st = bbBoxTubeStages(reach);
            // THE RETRACTED ARM IS THE OLD REST POSE: every section spans [−sectionLen, 0] from
            // `glyph.outer` along the glyph's own unit vector, which is where the pre-2026-09-20
            // stack sat. Nothing pokes past the rail and nothing leaves the frame.
            const tail = { x: glyph.outer.x - glyph.ux * st.sectionLen, y: glyph.outer.y - glyph.uy * st.sectionLen };
            if (Math.abs(tail.x) > spec.length / 2 + 1e-9 || Math.abs(tail.y) > spec.width / 2 + 1e-9) restOff++;

            const world = mkWorld('match', 11, spec);
            const r = world.robots[0];
            const pivot = { x: glyph.outer.x, y: glyph.outer.y, z: BB_BOX_TUBE_Z };
            const baseYaw = Math.atan2(glyph.uy, glyph.ux);
            for (let fi = 0; fi < BB_FLOWERS.length; fi++) {
              const f = BB_FLOWERS[fi];
              for (let h = 0; h < 12; h++) {
                const heading = (h * Math.PI * 2) / 12;
                const c = Math.cos(heading);
                const s = Math.sin(heading);
                const px = place.x * c - place.y * s;
                const py = place.x * s + place.y * c;
                for (const off of [0, 0.9, 1.9]) {
                  for (let a = 0; a < 6; a++) {
                    const th = (a * Math.PI * 2) / 6;
                    r.heading = heading;
                    r.pos.x = f.x + Math.cos(th) * off - px;
                    r.pos.y = f.y + Math.sin(th) * off - py;
                    if (bbFlowerInReach(world, r) !== fi) continue;
                    poses++;
                    // the opening in the ROBOT's frame — the frame the drawn nodes live in
                    const dx = f.x - r.pos.x;
                    const dy = f.y - r.pos.y;
                    const ci = Math.cos(-heading);
                    const si = Math.sin(-heading);
                    const target = { x: dx * ci - dy * si, y: dx * si + dy * ci, z: TIP_Z - (r.z ?? 0) };
                    const aim = bbBoxTubeAim(pivot, target, st);
                    const need = Math.hypot(target.x - pivot.x, target.y - pivot.y, target.z - pivot.z);
                    if (aim.len < need - 1e-9) short++;
                    pitchLo = Math.min(pitchLo, aim.pitch);
                    pitchHi = Math.max(pitchHi, aim.pitch);
                    swivelHi = Math.max(swivelHi, Math.abs(((aim.yaw - baseYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI));
                    // the DRAWN tip at full ease: the last stage's front face, `moving · ext` out
                    const L = st.moving * aim.ext;
                    const tip = {
                      x: pivot.x + Math.cos(aim.pitch) * Math.cos(aim.yaw) * L,
                      y: pivot.y + Math.cos(aim.pitch) * Math.sin(aim.yaw) * L,
                      z: pivot.z + Math.sin(aim.pitch) * L,
                    };
                    worstTip = Math.max(worstTip, Math.hypot(tip.x - target.x, tip.y - target.y, tip.z - target.z));
                    // NO STAGE LEAVES ITS PARENT, at any ease: consecutive stages are one `ext`
                    // apart and each is `sectionLen` long, so the capture is `sectionLen − ext`.
                    // The same walk measures the TAIL DIP — stage 1's back end is behind the
                    // shoulder while it is still retracted, so it swings down toward the deck.
                    for (let e = 0; e <= 1.0001; e += 0.05) {
                      worstOverlap = Math.min(worstOverlap, st.sectionLen - e * aim.ext);
                      lowTail = Math.min(lowTail, BB_BOX_TUBE_Z + (e * aim.ext - st.sectionLen) * Math.sin(e * aim.pitch));
                    }
                  }
                }
              }
            }
          }
        }
        check('box tube pose sweep: it found in-reach poses to measure at all', poses > 2000, `${poses} poses`);
        check(
          'box tube: at full ease the drawn TIP is the flower opening, for every in-reach pose',
          worstTip < 1e-6,
          `worst ${worstTip.toExponential(2)} in over ${poses} poses`,
        );
        check(
          '...and the arm is never asked for more length than the stages have',
          short === 0,
          `${short} poses short`,
        );
        check(
          '...and no stage ever leaves its parent (capture never drops below one overlap)',
          worstOverlap >= BB_BOX_TUBE_STAGE_OVERLAP - 1e-9,
          `worst capture ${worstOverlap.toFixed(3)} vs overlap ${BB_BOX_TUBE_STAGE_OVERLAP}`,
        );
        check(
          '...and the retracted arm still sits inside the frame, where the old rest pose was',
          restOff === 0,
          `${restOff} builds stow outside the chassis`,
        );
        check(
          'box tube: the arm REACHES UP — every in-reach pose asks for a steep pitch, never a flat one',
          pitchLo > Math.PI / 4,
          `${((pitchLo * 180) / Math.PI).toFixed(1)}° … ${((pitchHi * 180) / Math.PI).toFixed(1)}°`,
        );
        check(
          '...and the base SWIVEL stays small — the ring is at most BB_PLACE_TOL off the mount line',
          swivelHi < Math.PI / 4,
          `worst ${((swivelHi * 180) / Math.PI).toFixed(2)}° (tol ${BB_PLACE_TOL}, opening r ${BB_FLOWER_OPEN_R.toFixed(2)})`,
        );
        // ⚠️ THE ONE COST OF PIVOTING AT THE RAIL: stage 1's tail is still behind the shoulder
        // while the arm is mostly retracted, so mid-deploy it swings DOWN. It is bounded, it is
        // inside the frame behind the rail, and it never reaches the belly pan (0.85) — a RATCHET,
        // so a change that makes the arm dig deeper has to move this number on purpose.
        check(
          'box tube: the mid-deploy TAIL DIP is bounded and stays inside the frame',
          lowTail > 3.0,
          `lowest tail z ${lowTail.toFixed(3)} (deck top ${BB_DECK_Z}, belly pan 0.96)`,
        );
      }

      // ── #15: THE DECK IS ONE NUMBER, AND IT IS THE SIM'S ───────────────────────────────
      //
      // ⚠️ THIS BLOCK USED TO ADD UP THE MUZZLE FROM SOURCE LITERALS — deck + head lift + an exit
      // left at the head's own origin — and compare the total to `BB_LAUNCH_Z0`. It passed every
      // time, because all three literals were there and they did add up. What it could not see is
      // that the total was only right AT ONE ELEVATION, which is the whole of the 2026-09-19
      // report. The muzzle is measured off the built mesh now, at 41 pitches, in the block above.
      // What is left here is the one statement that is still a statement about SOURCE: the deck
      // is not a second number.
      {
        check(
          'the drivetrain’s side plate IS the sim’s deck — imported, not a local 4.6',
          /const BB_PLATE_H = BB_DECK_Z;/.test(robotsCode) &&
            /export const BB_DRIVETRAIN_H = BB_PLATE_H;/.test(robotsCode) &&
            /\bBB_DECK_Z,/.test(robotsCode.slice(0, robotsCode.indexOf("} from '../config'"))),
          `BB_DECK_Z=${BB_DECK_Z}`,
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
    {
      const body = panelMat(glbSrc);
      // a clear panel is four things, not just a low opacity -- see the policy header
      check('a clear panel damps the environment map (what made these read as solid white)', body.includes('CLEAR_ENV_INTENSITY'));
      // ⚠️ `depthWrite: false` STAYS and `FrontSide` is GONE -- the second is the 2026-09-19
      // culling fix and the two are unrelated: depth-writing would let one clear panel occlude
      // another drawn after it, while the SIDE decides whether a sheet exists from behind at all.
      check('a clear panel still never writes depth', /depthWrite: false/.test(body));
    }
    // ⚠️ AND THERE IS ONLY ONE OF THEM NOW (2026-09-19, the owner's SECOND back-panel report).
    // This used to be a pair of checks comparing TWO `clearPanelMaterial`s -- one per path -- on
    // the two numbers a regex could reach, which is how the fallback field came to agree about
    // its opacities and about nothing else: the Fresnel alpha, the un-attenuated reflection and
    // the restored mirror all landed on the CAD path alone. A constants-path driver was looking
    // at the material from before the fix. The fallback imports this one instead, so the two
    // paths cannot drift at all rather than cannot drift in two places.
    {
      check(
        'the fallback field builds NO clear-panel material of its own',
        !fieldSrc.includes('function clearPanelMaterial'),
      );
      check(
        '...it imports the CAD path’s two clear surfaces by name',
        /import \{[^}]*\bcellPanelMaterial\b/s.test(fieldSrc) && /import \{[^}]*\bwallPanelMaterial\b/s.test(fieldSrc),
      );
      check(
        '...and keeps no second opacity of its own to drift',
        !/const (CELL|WALL)_OPACITY =/.test(fieldSrc),
      );
      // ⚠️ AND A CELL SKIN AND A WALL ARE NOT THE SAME CALL. They differ in two numbers and both
      // matter: the skin is denser AND it carries the veil. A `clearPanelMaterial(...)` written
      // out longhand anywhere else is how one of the two would quietly get the other's answer.
      check(
        'the two clear surfaces are built in exactly one place each',
        /export function cellPanelMaterial\(\): THREE\.Material \{\s*return clearPanelMaterial\(CELL_PANEL_OPACITY, PANEL_VEIL\);/.test(glbSrc) &&
          /export function wallPanelMaterial\(\): THREE\.Material \{\s*return clearPanelMaterial\(WALL_PANEL_OPACITY\);/.test(glbSrc),
      );
      check(
        '...and the perimeter wall takes NO veil (the 2026-09-18 white-board report stands)',
        !/wallPanelMaterial\(\)[\s\S]{0,120}PANEL_VEIL/.test(glbSrc) && clearPanelVeilAt(0, 0.08, 0.9) === 0,
      );
      const num = (src: string, name: string): number => {
        const m = new RegExp(`const ${name} = ([\\d.]+);`).exec(src);
        return m ? Number(m[1]) : NaN;
      };
      // the re-tune's DIRECTION, so nobody walks the file back to the first pass: a cell skin is
      // denser than the perimeter, and both are far below the rejected 0.22.
      //
      // ⚠️ AND THE CELL SKIN IS BACK AT 0.13, ON PURPOSE. Raising it to 0.18 was tried and
      // MEASURED on 2026-09-19: it moved the back view by 0.1 of a level, because alpha is a
      // multiplier on `bg - tint` and the ground behind a hive IS the tint's own value. What
      // answers that report is the VEIL, which adds; the opacity went back to where the
      // white-board re-tune had put it.
      const cell = num(glbSrc, 'CELL_PANEL_OPACITY');
      const wall = num(glbSrc, 'WALL_PANEL_OPACITY');
      check(
        'a clear panel is nearly invisible face-on, and a cell skin is the denser of the two',
        wall > 0 && wall <= 0.12 && cell > wall && cell <= 0.15,
        `wall ${wall}, cell ${cell}`,
      );
      check('the perimeter wall is UNCHANGED by the cell re-tune (0.08, measured)', wall === 0.08, `${wall}`);
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

    // == THE 2026-09-19 PLAYTEST, OWNER ITEMS 3, 4, 11 AND 13 ==============================

    // ITEM 3 -- NO OUTLINE PASS ON A CLEAR PANEL. `addPanelEdges` ran `EdgesGeometry(geo, 25)`
    // over a tray's merged, welded, per-primitive-decimated `plastic#e6e6e6` soup and drew 3,552
    // segments, 2,811 of them 0.01in or shorter and the LONGEST 0.84in -- on skins 20in wide.
    // Every one of them was a tessellation crease, which is the owner's "stray lines on the
    // transparent panels of the hives". Nothing replaces it: the CELL's shape is drawn by its two
    // opaque alliance-coloured GOAL RIBS, at both ends.
    // ⚠️ AGAINST THE CODE, NOT THE FILE. Both headers below NAME the thing they forbid, at
    // length, because the measurement that killed it is the reason it is forbidden — a file-wide
    // grep would fail on its own explanation.
    const glbCode = codeLines(join(SCENE_DIR, 'renderFieldGlb.ts')).join('\n');
    const fieldCode = codeLines(join(SCENE_DIR, 'renderField.ts')).join('\n');
    check('the loader runs no edge/outline pass at all', !/EdgesGeometry|LineSegments/.test(glbCode));
    check('and the constants fallback does not either', !/EdgesGeometry|LineSegments/.test(fieldCode));
    check(
      'the CAD asset still files the goal ribs as tray parts (they are what draws the cell now)',
      /PartRule\(r"goal rib", "hive_tray"/.test(readFileSync(join(root, 'scripts', 'field-cad', 'convert.py'), 'utf8')),
    );

    // ITEM 4 -- CREASED, NEVER SMOOTH. Neither GLB carries a NORMAL attribute, so the loader
    // computes one; computing it SMOOTH over a soup of merged hard-edged CAD parts put 63-75% of
    // triangles more than 45 degrees off their own face and left 15 normals at length zero, which
    // on a `metalness: 0.7` near-black bracket reads as the owner's "white artifacts".
    check('the loader computes CREASED normals', glbSrc.includes('computeCreasedNormals(obj.geometry, CREASE_ANGLE_DEG)'));
    check(
      'and never the smooth pass on a loaded mesh (the plain call survives only as the un-indexed fallback)',
      (glbCode.match(/computeVertexNormals\(\)/g) ?? []).length === 1,
      `${(glbCode.match(/computeVertexNormals\(\)/g) ?? []).length}`,
    );
    {
      // A WELDED CUBE. 8 shared vertices, 12 triangles: the split has to hand every corner three
      // normals and every triangle its own exact face normal.
      const cube = new THREE.BufferGeometry();
      const P: number[] = [];
      for (const z of [-1, 1]) for (const y of [-1, 1]) for (const x of [-1, 1]) P.push(x, y, z);
      cube.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
      // faces, wound outward: -x +x -y +y -z +z
      cube.setIndex([
        0, 4, 6, 0, 6, 2, 1, 3, 7, 1, 7, 5, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3, 0, 2, 3, 0, 3, 1, 4, 5, 7, 4, 7, 6,
      ]);
      computeCreasedNormals(cube, CREASE_ANGLE_DEG);
      const cn = cube.getAttribute('normal');
      check('a welded cube splits into 3 normals per corner', cn.count === 24, `${cn.count}`);
      let axisAligned = 0;
      const v = new THREE.Vector3();
      for (let i = 0; i < cn.count; i++) {
        v.fromBufferAttribute(cn, i);
        const s = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)].sort((a, b) => b - a);
        if (Math.abs(s[0] - 1) < 1e-5 && s[1] < 1e-5) axisAligned++;
      }
      check('every one of them is an exact face normal, not an average', axisAligned === cn.count, `${axisAligned}/${cn.count}`);
    }
    {
      // ⚠️ THE REGRESSION THAT COSTS THE MOST TO REDISCOVER. The first version grouped a vertex's
      // faces by UNION-FIND, which is transitive: on a finely tessellated cone every face is
      // within the crease angle of its neighbour, so one group spans 360 degrees and its
      // area-weighted average is the ZERO VECTOR. This fixture is a NEEDLE cone -- 24 faces whose
      // normals sweep the full turn nearly perpendicular to the axis -- and it is the shape that
      // separates the two: per corner the apex normal follows the cone's surface, per group it
      // collapses onto the axis (or to nothing).
      const N = 24;
      const cone = new THREE.BufferGeometry();
      const pos: number[] = [0, 0, 20];
      for (let i = 0; i < N; i++) pos.push(Math.cos((2 * Math.PI * i) / N), Math.sin((2 * Math.PI * i) / N), 0);
      cone.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      const idx: number[] = [];
      for (let i = 0; i < N; i++) idx.push(0, 1 + i, 1 + ((i + 1) % N));
      cone.setIndex(idx);
      computeCreasedNormals(cone, CREASE_ANGLE_DEG);
      const nn = cone.getAttribute('normal');
      let short = 0;
      let axial = 0;
      const v = new THREE.Vector3();
      for (let i = 0; i < nn.count; i++) {
        v.fromBufferAttribute(nn, i);
        if (Math.abs(v.length() - 1) > 1e-4) short++;
        if (Math.abs(v.z) > 0.5) axial++;
      }
      check('a needle cone leaves no degenerate normal (the union-find version left the apex at zero)', short === 0, `${short}`);
      check('and its apex normals follow the surface rather than collapsing onto the axis', axial === 0, `${axial}/${nn.count}`);
    }

    // ITEM 11 -- THE FLOWER STANDOFFS. `am-1696: Nylon Spacer ... 1.000in Long` x2 per flower is
    // in the STEP and is swallowed by `convert.py`'s RE_FASTENER, which matches the bare words
    // `nylon spacer` -- the same defect audit section 2.2 records for the 24 perimeter rails
    // ("FTC Rail with Rivet Holes"). The loader rebuilds them at the CAD's own dimensions, and
    // the gap it stands them in is measurable straight off the measurements file.
    {
      const measurements = JSON.parse(readFileSync(join(root, 'public', 'models', 'biobuzz', 'field-measurements.json'), 'utf8')) as {
        flowers: { id: string; rings: { top: { z: [number, number] } }; backstopZ: [number, number] }[];
      };
      check('the measurements carry all four flowers', measurements.flowers.length === 4, `${measurements.flowers.length}`);
      for (const f of measurements.flowers) {
        const gap = f.backstopZ[0] - f.rings.top.z[1];
        check(
          `${f.id}: the purple backstop stands exactly one 1.000-in spacer off the top ring`,
          Math.abs(gap - 1) < 0.01,
          `${gap.toFixed(4)}in`,
        );
      }
      check(
        'the CAD still drops the spacer as a fastener (the defect this works around)',
        /nylon spacer/.test(readFileSync(join(root, 'scripts', 'field-cad', 'convert.py'), 'utf8')),
      );
      check('the standoff is built at the part number own OD', /STANDOFF_OD_IN = 0\.375/.test(glbSrc));
      check('its length is MEASURED between the two plates, not typed', /const height = plate\.min\.z - ring\.max\.z;/.test(glbSrc));
    }

    // ITEM 13 -- THE APRILTAG CLUSTERS AND THE BANNER. Both plates are already in the GLB as
    // `decal#ffffff` -- blank white, because a STEP carries no artwork. The IDs are section 9.9
    // p76, read off the page raster (that page's text layer drops the digits -- see
    // `docs/biobuzz/manual-distilled.md`'s own defect list), and the code table is
    // AprilRobotics/apriltag's `tag36h11.c`.
    {
      const seen = new Set<number>();
      for (const a of ['red', 'blue'] as const) {
        for (const side of ['north', 'south'] as const) {
          for (const id of BB_TAG_IDS[a][side]) seen.add(id);
        }
      }
      check('sixteen distinct tags, one cluster of four per CELL', seen.size === 16, `${seen.size}`);
      check('and every one of them is in the manual 30..45', [...seen].every((id) => id >= 30 && id <= 45));
      // the AUDIENCE is at -y (F4 is on the audience wall), so "opposite the audience" is +y
      check('red FAR (opposite the audience) is 30 31 32 33', BB_TAG_IDS.red.north.join(' ') === '30 31 32 33');
      check('red AUDIENCE is 34 35 36 37', BB_TAG_IDS.red.south.join(' ') === '34 35 36 37');
      check('blue AUDIENCE is 38 39 40 41', BB_TAG_IDS.blue.south.join(' ') === '38 39 40 41');
      check('blue FAR is 42 43 44 45', BB_TAG_IDS.blue.north.join(' ') === '42 43 44 45');

      // THE BITMAP, round-tripped. A tag is 10 cells including a 1-cell white quiet zone around
      // an 8-cell black border; the inner 6x6 carries the 36 code bits MSB first. Reading them
      // back out of the rendered grid has to reproduce `codedata[id]` exactly -- a mirrored or
      // transposed layout would still LOOK like a tag and would detect as nothing.
      const cells = [...seen].map((id) => ({ id, grid: apriltag36h11Cells(id) }));
      let wellFormed = 0;
      for (const { grid } of cells) {
        let ok = true;
        for (let k = 0; k < 10; k++) {
          if (grid[k] !== 1 || grid[90 + k] !== 1 || grid[k * 10] !== 1 || grid[k * 10 + 9] !== 1) ok = false;
        }
        // the black border ring, inside the quiet zone: row 1, row 8, col 1, col 8
        for (let k = 1; k < 9; k++) {
          if (grid[10 + k] !== 0 || grid[80 + k] !== 0 || grid[k * 10 + 1] !== 0 || grid[k * 10 + 8] !== 0) ok = false;
        }
        if (ok) wellFormed++;
      }
      check('every tag has a white quiet zone and a closed black border', wellFormed === 16, `${wellFormed}/16`);
      check(
        'and its 36 data bits read back as `tag36h11.c` own codedata (ID 30 = 0x0e2cfda160)',
        readTagCode(apriltag36h11Cells(30)) === 0x0e2cfda160 && readTagCode(apriltag36h11Cells(45)) === 0x0fbb59375d,
        `${readTagCode(apriltag36h11Cells(30)).toString(16)}`,
      );
      const keys = new Set(cells.map((c) => c.grid.join('')));
      check('the sixteen bitmaps are all different', keys.size === 16, `${keys.size}`);

      // the manual's own figures, and the one place this pass could not honour Fig 9-15
      check('a tag is the 3.25in square section 9.9 states', /TAG_SIZE_IN = 3\.25/.test(glbSrc));
      check(
        'the row pitch clears a tag (Fig 9-15 distilled 2.75in centres would overlap two by half an inch)',
        /TAG_PITCH_IN = 3\.5/.test(glbSrc),
      );
      check('and the pitch is flagged APPROX with the reason', /APPROX -- THE MANUAL'S OWN PITCH CANNOT BE RIGHT|APPROX — THE MANUAL/.test(glbSrc));

      // the PLATES are measured, not typed -- the CAD is authoritative for dimensions
      check('the plate rectangles come off the CAD mesh (`facetFrame`), not out of this file', /function facetFrame\(/.test(glbSrc));
      check('no plate rectangle is hard-coded', !/17\.0005|5\.0009/.test(glbCode));
      check('the banner is TEXT, with no FIRST or RTX logo artwork fetched or embedded', !/data:image|logo|\.svg|\.png/i.test(glbCode));

      // THE TIER GATE. Nothing above is built, no canvas is allocated and no texture is uploaded
      // on the LOW LOD, which is the `meshDetail` row of the preset table and therefore the LOW
      // tier alone.
      check('the markings are built on the HIGH LOD only', /quality === 'high' \? buildFieldMarkings\(/.test(glbSrc));
      check('...and the low LOD gets a zeroed record rather than a partial one', /: NO_MARKINGS;/.test(glbSrc));
      check('mesh detail is `low` on the LOW tier alone', GFX_PRESETS.low.meshDetail === 'low' && (['medium', 'high', 'ultra'] as const).every((t) => GFX_PRESETS[t].meshDetail === 'high'));
    }

    // == THE 2026-09-19 OWNER PASS, ITEMS 6 AND 8, AND THE STICKER LABEL ===================

    // ITEM 13a -- THE LABEL IS FIG 9-16'S, NOT A CAPTION. `manual-distilled.md` §9.9: "The
    // cluster sticker in Fig 9-16 is labelled per cell, e.g. 'RED AUDIENCE / Tag family: 36h11'."
    // It was drawn as one line with the four IDs appended, which the real sticker does not carry.
    {
      check(
        'the sticker label is the CELL name over `Tag family: 36h11`, on two lines',
        glbCode.includes('ctx.fillText(label,') && glbCode.includes('ctx.fillText(`Tag family: ${TAG_FAMILY}`'),
      );
      check('...and the IDs are no longer lettered beside it', !glbCode.includes("${ids.join(' ')}"));
      check('the four cell names are the manual own', Object.values(TAG_LABEL_EXPECTED).join('|') === 'RED FAR|RED AUDIENCE|BLUE FAR|BLUE AUDIENCE');
      for (const [a, side, want] of TAG_LABEL_ROWS) {
        check(`Fig 9-16 labels the ${a} ${side} cell "${want}"`, glbSrc.includes(`${side}: '${want}'`), want);
      }
      // the tag BITMAPS are untouched -- they are real 36h11 and the block above round-trips them
      check('the label change did not touch the tag raster', glbSrc.includes('TAG_CELL_PX = 12') && glbSrc.includes('magFilter = THREE.NearestFilter'));
    }

    // ITEM 6 -- THE STICKER BLEEDS THROUGH FROM ABOVE, AND CANNOT BE READ FROM THERE.
    //
    // §9.9 keeps the cluster on the BOTTOM face of each CELL facing DOWN -- that is unchanged and
    // checked first, because the fix must not move the real sticker. What is ADDED is the white
    // vinyl coming through the translucent floor when you look down at it (owner, 2026-09-19).
    //
    // ⚠️ THE UNDECODABILITY IS A RASTER PROPERTY, NOT AN OPACITY. A faint but CRISP copy still
    // carries all 36 bits; a detector thresholds and does not care how grey the ink is. So the
    // check is on the PITCH: the bleed canvas is rasterized coarser than a tag CELL, so the
    // rasterizer averages the bits away before the texture exists.
    {
      check(
        '§9.9 is intact: the crisp cluster still faces DOWN off the cell floor',
        glbSrc.includes('const DOWN = new THREE.Vector3(0, 0, -1)') &&
          glbSrc.includes('facetFrame(mesh, (_cx, cy) => Math.sign(cy) === sideSign, DOWN,') &&
          glbSrc.includes('quad.position.copy(frame.centre).addScaledVector(DOWN, MARKING_LIFT_IN)'),
      );
      check(
        'and a SECOND, faint quad is built on the UPPER face of the same plate',
        glbSrc.includes('bleed.name = `bb-apriltag-bleed:${alliance}:${side}`') &&
          glbSrc.includes('bleed.position.set(frame.centre.x, frame.centre.y, topZ + MARKING_LIFT_IN)'),
      );
      // ⚠️ IT IS THE STICKER'S OWN RECTANGLE, LIFTED AND MIRRORED, NOT A SECOND MEASUREMENT.
      // Measured on the shipped `field.glb`: `facetFrame(..., UP, ...)` over the same plate
      // returns a 14.434 x 0.123-in STRIP, because the decimator kept almost none of the face
      // the plate is pressed against. A bleed built on that sits 2.3 in off the sticker and is
      // 40x too thin. Both statements are checked, so nobody "simplifies" it back.
      check(
        '...on the SAME rectangle the sticker uses (a second facetFrame measures a lip)',
        /new THREE\.PlaneGeometry\(frame\.width, frame\.height\),\s*bleedMaterial\(tagBleedTexture\(ids, frame\.width, frame\.height\)\),/.test(glbSrc),
      );
      check(
        '...at the CAD plate own top face, not a typed thickness',
        glbSrc.includes('const topZ = new THREE.Box3().setFromObject(mesh).max.z;'),
      );
      check(
        '...and MIRRORED, which is what looking through a translucent panel does',
        glbSrc.includes('makeBasis(new THREE.Vector3(sideSign, 0, 0), new THREE.Vector3(0, sideSign, 0), UP)'),
      );
      check('one per CELL, counted beside the stickers', /tagBleeds: number;/.test(glbSrc) && glbSrc.includes('out.tagBleeds++'));
      check('...and the low LOD still zeroes every marking', glbSrc.includes('const NO_MARKINGS: FieldMarkings = { tagPlates: 0, tagBleeds: 0, banners: 0, standoffs: 0 }'));

      // the four tuning values below are restated in this file rather than imported, so the
      // checks test a VALUE and not the same symbol the renderer reads. That only works if the
      // two copies agree, which is this check.
      check(
        'the bleed tuning this lane checks against is the renderer own',
        glbSrc.includes(`const TAG_BLEED_PX_PER_IN = ${TAG_BLEED_PX_PER_IN};`) &&
          glbSrc.includes(`const TAG_BLEED_OPACITY = ${TAG_BLEED_OPACITY_EXPECTED};`) &&
          glbSrc.includes(`const TAG_BLEED_WHITE = '${TAG_BLEED_WHITE_EXPECTED}';`) &&
          glbSrc.includes(`const TAG_BLEED_INK = '${TAG_BLEED_INK_EXPECTED}';`),
      );

      // THE GUARANTEE. A 36h11 decoder samples one bit per tag CELL; a bleed pixel that spans
      // more than one cell cannot hold one.
      const pitchIn = 1 / TAG_BLEED_PX_PER_IN;
      check(
        'the bleed raster is COARSER than a 36h11 cell, so no pixel can hold one bit',
        pitchIn > TAG_CELL_IN,
        `${pitchIn.toFixed(3)}in per pixel vs a ${TAG_CELL_IN.toFixed(3)}in cell`,
      );
      check(
        '...and coarser by a margin, not by a hair (>= 2 cells per pixel)',
        pitchIn >= 2 * TAG_CELL_IN,
        `${(pitchIn / TAG_CELL_IN).toFixed(2)} cells per pixel`,
      );
      // a whole 3.25-in tag lands on ~4.5 px, so a cluster of four is a smudge and not a grid
      check(
        'a whole tag lands on a handful of pixels',
        TAG_SIZE_IN * TAG_BLEED_PX_PER_IN < 6,
        `${(TAG_SIZE_IN * TAG_BLEED_PX_PER_IN).toFixed(2)} px across`,
      );
      check(
        'the bleed is SMEARED on the way back up, never `NearestFilter` (which would give hard blocks)',
        /function tagBleedTexture[\s\S]*?magFilter = THREE\.LinearFilter/.test(glbSrc),
      );
      // and it is a stain, not a sticker: translucent, low contrast, no shadow, not `decalMaterial`
      check('the bleed material is translucent and writes no depth', /function bleedMaterial[\s\S]*?transparent: true,[\s\S]*?depthWrite: false,/.test(glbSrc));
      check('the bleed is much fainter than the sticker below it', TAG_BLEED_OPACITY_EXPECTED <= 0.35, `${TAG_BLEED_OPACITY_EXPECTED}`);
      check('...and casts no shadow', glbSrc.includes('bleed.castShadow = false'));
      // LOW contrast: the two tones it paints are near each other and near white, so even the
      // blocks the raster leaves are a suggestion rather than a black-and-white pattern
      {
        const lum = (hex: string): number => {
          const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
          return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
        };
        const ratio = (lum(TAG_BLEED_WHITE_EXPECTED) + 0.05) / (lum(TAG_BLEED_INK_EXPECTED) + 0.05);
        check(
          'the bleed pair is LOW contrast (the sticker itself is 21:1 black on white)',
          ratio < 2,
          `${ratio.toFixed(2)}:1`,
        );
      }
    }

    // ⚠️ IT WAS BACK-FACE CULLING, AND THIS IS THE CHECK THAT WOULD HAVE SAID SO.
    //
    // The 2026-09-19 header said "it is NOT back-face culling -- 0 boundary edges, face normals in
    // matched opposite pairs (+-y 1,203/1,233, +-x 204/192), so every skin is a closed slab". That
    // count binned only AXIS-ALIGNED normals and a cell's back is a GABLE: its two sheets are
    // diagonal, normal ~ (0.54, 0, +-0.84) in the tray frame, so they were in neither bin. Three
    // passes of SHADING fixes followed, on faces that were not being rasterised from behind.
    //
    // So this measures the asset PER PLANE, with the loader's own exported function: a closed slab
    // puts its two faces in one plane cluster and splits the area both ways, an open sheet puts all
    // of it one way. Run over the shipped `.glb` in Node -- no GL context, no camera, no opinion.
    {
      const scene = FIELD_GLB_SCENE;
      check('field.glb parses headlessly, so the asset itself can be measured here', scene !== null);
      if (scene) {
        scene.updateMatrixWorld(true);
        const clear: { name: string; frac: number; area: number; planes: number }[] = [];
        scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh || !mesh.geometry) return;
          const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
          const mn = mat?.name ?? '';
          const node = String((o.parent?.userData as { name?: string })?.name ?? o.parent?.name ?? '');
          const isTraySkin = mn === 'plastic#e6e6e6' && /^hive_(red|blue)[/]?tray$/.test(node);
          const isWallGlass = mn.startsWith('glass#');
          if (!isTraySkin && !isWallGlass) return;
          const r = sheetFacingBalance(mesh.geometry, mesh.matrixWorld);
          clear.push({ name: `${node || 'walls'} ${mn}`, frac: r.twoFacedFraction, area: r.totalArea, planes: r.planes });
        });
        check('the GLB carries the clear tray skins and the perimeter glass', clear.length >= 3, `${clear.length} primitives`);
        for (const c of clear) {
          check(
            `EVERY clear surface is open SHEETING, not a closed slab -- ${c.name}`,
            c.frac < 0.1,
            `two-faced ${(c.frac * 100).toFixed(1)}% of ${c.area.toFixed(0)} sq in over ${c.planes} planes`,
          );
        }
        // ...which is exactly why the material may not cull a face. The two travel together.
        check(
          'so the clear material is DoubleSide, keyed on that measurement',
          CLEAR_SHEETS_ARE_SINGLE_SIDED &&
            glbSrc.includes('side: CLEAR_SHEETS_ARE_SINGLE_SIDED ? THREE.DoubleSide : THREE.FrontSide'),
        );
      }
      // THE FUNCTION ITSELF, against geometry whose answer is known -- a lane check that only ever
      // sees one asset cannot tell "measured" from "always returns 0".
      const slab = new THREE.BoxGeometry(20, 12, 0.02).toNonIndexed();
      const sheet = new THREE.PlaneGeometry(20, 12).toNonIndexed();
      check('a closed SLAB measures two-faced', sheetFacingBalance(slab).twoFacedFraction > 0.9, `${sheetFacingBalance(slab).twoFacedFraction.toFixed(3)}`);
      check('...and a single SHEET measures single-sided', sheetFacingBalance(sheet).twoFacedFraction < 0.01, `${sheetFacingBalance(sheet).twoFacedFraction.toFixed(3)}`);
    }

    // ITEM 8 -- A CLEAR PANEL IS A DIELECTRIC, NOT A CONSTANT ALPHA.
    //
    // Owner, 2026-09-19, and the fix above is the one that answered it. What follows is the
    // SHADING half, which stands on its own: a constant alpha divides a panel's own reflection by
    // that alpha, and a reflection
    // does not pass through the sheet. See `clearPanelMaterial`'s header.
    //
    // ⚠️ AND THE ANSWER MUST NOT BRING BACK THE STRAY DASHES. `addPanelEdges` is what was removed
    // to fix owner bug 3, and the "no edge/outline pass at all" check above is what keeps it out.
    // These add the second half of that guard: the fix is a per-pixel SHADER term, so it builds
    // no geometry and no mesh either.
    {
      check(
        'the panel takes polycarbonate own IOR, and every other number derives from it',
        /const PANEL_IOR = 1\.586;/.test(glbSrc) && /ior: PANEL_IOR/.test(glbSrc),
      );
      check(
        'the alpha is FRESNEL-weighted, in the shader, on |N.V| (so behind behaves like in front)',
        glbSrc.includes('mat.onBeforeCompile = (shader)') &&
          glbSrc.includes('abs( dot( normalize( normal ), normalize( vViewPosition ) ) )') &&
          glbSrc.includes('float bbFresnel = mix( diffuseColor.a,'),
      );
      check(
        '...and the SHEET HAS THICKNESS, which is the term that carries an ordinary look',
        glbSrc.includes('float bbPath = 1.0 - pow( 1.0 - diffuseColor.a, 1.0 / bbCos );') &&
          glbSrc.includes('diffuseColor.a = min( max( bbPath, bbFresnel ),'),
      );
      check(
        '...and the injected program is CACHE-KEYED, or three hands every panel the first one',
        glbSrc.includes('mat.customProgramCacheKey = () =>'),
      );
      check(
        'the reflected term is added back un-attenuated, capped',
        glbSrc.includes('reflectedLight.directSpecular + reflectedLight.indirectSpecular') &&
          glbSrc.includes('outgoingLight += bbSpec * min( 1.0 / max( diffuseColor.a, 0.02 ) - 1.0,'),
      );
      // ⚠️ AND THE MIRROR IS NOT DAMPED WITH THE DIFFUSE. `envMapIntensity` scales BOTH the
      // environment's irradiance and its radiance, and 0.15 was set to stop a near-white
      // placeholder base soaking up a warm HDRI -- it took the REFLECTION down with it, so a sheet
      // whose own `PANEL_F0` says 5.1% was mirroring 0.8% of the room. That is the one term that
      // is both light-rig-independent and background-independent, and it was the missing half of
      // the first back-panel fix.
      check(
        'the env damper is DIFFUSE-only: the mirror is restored to 1.0 in the shader',
        /const PANEL_ENV_SPEC_RESTORE = 1 \/ CLEAR_ENV_INTENSITY;/.test(glbSrc) &&
          glbSrc.includes('reflectedLight.indirectSpecular * ${PANEL_ENV_SPEC_RESTORE.toFixed(4)}'),
      );

      // THE CURVE, run rather than grepped -- the shader's own `pow(1-c,5)` is this reduced.
      for (const base of [0.08, 0.13] as const) {
        check(
          `face-on, a ${base} panel is still EXACTLY ${base} (the white-board re-tune is untouched)`,
          Math.abs(clearPanelAlphaAt(base, 1) - base) < 1e-12,
          `${clearPanelAlphaAt(base, 1)}`,
        );
        check(
          `...and at grazing it reaches the panel graze alpha, from ${base}`,
          Math.abs(clearPanelAlphaAt(base, 0) - 0.55) < 1e-12,
          `${clearPanelAlphaAt(base, 0)}`,
        );
        // MONOTONE, and symmetric in the sign of N.V: a panel seen from behind is the same panel
        let prev = clearPanelAlphaAt(base, 1);
        let monotone = true;
        let symmetric = true;
        for (let k = 20; k >= 0; k--) {
          const c = k / 20;
          const a = clearPanelAlphaAt(base, c);
          if (a < prev - 1e-12) monotone = false;
          if (Math.abs(a - clearPanelAlphaAt(base, -c)) > 1e-12) symmetric = false;
          prev = a;
        }
        check(`the ${base} panel alpha rises monotonically off normal`, monotone);
        check(`...and is identical for a NEGATIVE N.V (the whole of "from behind")`, symmetric);
        // ⚠️ THE FIRST PASS'S CLAIM HERE WAS THE BUG, AND THE CHECK THAT PINNED IT PASSED.
        // Schlick's fifth power moves nothing until the last 20 deg (at 45 deg the excess is
        // 0.010), and the header defended that as "the term buys the EDGE: a slab's 0.020-in side
        // face is at grazing from almost everywhere". At 78 in, a driver's distance from a hive,
        // that face is 0.03 px wide. It draws nothing, which is why the owner reported the same
        // panel twice. What a sheet at an angle actually shows is MORE SHEET -- Beer-Lambert over
        // the path length -- and that is now the term that carries an ordinary off-normal look,
        // while the face-on value stays exactly where it was measured.
        {
          const at = (deg: number): number => clearPanelAlphaAt(base, Math.cos((deg * Math.PI) / 180));
          check(
            `${base}: a 45 deg look is THICKER than face-on, by a visible margin`,
            at(45) > base * 1.25,
            `${at(45).toFixed(4)} vs ${base}`,
          );
          check(
            `${base}: ...and the rise starts early -- 30 deg is already above face-on`,
            at(30) > base * 1.08,
            `${at(30).toFixed(4)} vs ${base}`,
          );
          check(
            `${base}: ...and at 80 deg the edge is real (more than double)`,
            at(80) > base * 2,
            `${at(80).toFixed(4)} vs ${base}`,
          );
          check(
            `${base}: ...and nothing ever exceeds the graze ceiling`,
            at(1) <= 0.55 + 1e-12 && at(89) <= 0.55 + 1e-12,
            `${at(89).toFixed(4)}`,
          );
        }
      }
      // THE SHEEN GAIN: face-on is exactly where the panel needs it most, and the cap does not
      // bind on either shipped opacity (it exists so a future lower one cannot divide by ~0).
      check('the sheen gain restores the reflection face-on', clearPanelSheenGain(0.13) > 6, `${clearPanelSheenGain(0.13).toFixed(2)}x`);
      check('...more so on the thinner perimeter panel', clearPanelSheenGain(0.08) > clearPanelSheenGain(0.13));
      check('...and the cap never binds on a shipped value', clearPanelSheenGain(0.08) < 12, `${clearPanelSheenGain(0.08).toFixed(2)}`);
      check('...but does bind on an absurd one', clearPanelSheenGain(0.001) === 12);

      // ⚠️ THE CLAIM THIS PASS IS ACTUALLY MAKING, AS A NUMBER RATHER THAN AS SHADER TEXT.
      // The first fix passed every text check it had while being invisible from behind, because
      // what it restored was the SPECULAR -- and the measurement that followed showed the key
      // light is exactly what a face pointing away from it does not get. Moving the sun through
      // four positions swung the back view 3.0% -> 13.1% and left the mouth-side view flat, so
      // the panel needs a floor that no light position can take away. These pin it.
      for (const base of [0.08, 0.13] as const) {
        // a face turned right away from the rig still has the mirror AND its own body
        const away = clearPanelLightIndependent(base, 0.85);
        check(
          `${base}: a face pointing away from every light still contributes`,
          away.total >= base && away.mirror > 0 && away.body > 0,
          `mirror ${away.mirror.toFixed(4)} + body ${away.body.toFixed(4)} = ${away.total.toFixed(4)}`,
        );
        // the mirror is at the dielectric's own strength, not at 15% of it
        const damped = away.mirror / (1 + clearPanelSheenGain(clearPanelAlphaAt(base, 0.85)));
        check(
          `${base}: ...and the mirror is the restored one, several times the damped term`,
          away.mirror > damped * 4,
          `${away.mirror.toFixed(5)} vs damped ${damped.toFixed(5)}`,
        );
        // and it never runs away: the light-independent floor stays well under an opaque sheet
        check(`${base}: ...and it is a floor, not a white board`, away.total < 0.5, `${away.total.toFixed(4)}`);
      }
      // a CELL skin carries more of that floor than a perimeter panel, the same way its alpha does
      check(
        'a cell skin has more body from behind than a wall panel',
        clearPanelLightIndependent(0.13, 0.85).total > clearPanelLightIndependent(0.08, 0.85).total,
      );

      // ⚠️ THE VEIL -- THE TERM THAT ADDS, AND THE ONLY ONE THAT SURVIVES A MID-TONE GROUND.
      //
      // Three passes at this bug were spent on terms that MULTIPLY `bg - tint`: a Fresnel alpha, a
      // restored mirror, a damped ambient, and finally the alpha itself at 0.18. Every one of them
      // moved the owner's view by under 0.1 of a level, because `CLEAR_PANEL_TINT` is a mid grey
      // and the lit room behind a hive is its own value -- the difference they were scaling was
      // already zero. These checks are about the term that does not multiply anything.
      {
        const veilSrc = /const PANEL_VEIL = ([\d.]+);/.exec(glbSrc);
        const veil = veilSrc ? Number(veilSrc[1]) : NaN;
        check('the cell skins carry a veil, and it is a real number', Number.isFinite(veil) && veil > 0, `${veil}`);
        check(
          'it is ADDED in the shader, un-attenuated, and not blended toward the tint',
          glbSrc.includes('float bbVeilG = min( 1.0 / max( diffuseColor.a, 0.02 ),') &&
            /outgoingLight \+= vec3\( \$\{veilRgb\.r/.test(glbSrc),
        );
        check(
          '...in its own COOL NEAR-WHITE, not the transmission tint',
          /const PANEL_VEIL_TINT = 0xdfe6ec;/.test(glbSrc) && glbSrc.includes('setHex(PANEL_VEIL_TINT, THREE.SRGBColorSpace)'),
        );
        // IT DOES NOT DEPEND ON THE LIGHT OR ON THE VIEW. The JS mirror takes neither, and the
        // shader's own expression names no light term -- that is the whole of the owner's report.
        check(
          '...and it is LIGHT-INDEPENDENT: the veil expression names no light term',
          (() => {
            const at = glbSrc.indexOf('float bbVeilT =');
            const end = glbSrc.indexOf('#include <opaque_fragment>', at);
            const body = at < 0 ? '' : glbSrc.slice(at, end);
            return body.length > 0 && !/reflectedLight|directLight|irradiance|hemisphere/i.test(body);
          })(),
        );
        // ONE SKIN, in the band the measurement asked for, against ANY ground -- the value is the
        // same number three times because an added term does not care what is behind it.
        // ⚠️ IT IS SMALL, AND IT WAS NOT ALWAYS. 0.075 was tuned while two thirds of the clear
        // surface was being back-face culled from behind, so the veil was standing in for sheets
        // that were simply not drawn. With the sheets back it is 0.018 -- a floor under the
        // geometry, not a substitute for it.
        const one = clearPanelVeilAt(veil, 0.13, 0.9);
        check('one cell skin adds a real, background-independent amount', one > 0.01 && one < 0.06, `${one.toFixed(4)}`);
        check(
          '...and it is the same amount whichever way the skin faces (|N.V| is symmetric)',
          Math.abs(clearPanelVeilAt(veil, 0.13, 0.9) - clearPanelVeilAt(veil, 0.13, -0.9)) < 1e-12,
        );
        // THE STACK. `FrontSide` leaves three of these between the eye and an element through the
        // mouth, and each ADDS -- so the per-skin value is sized against the stack, not on its own.
        const stack = 3 * clearPanelVeilAt(veil, 0.13, 0.55);
        check('the worst stack is capped well short of an opaque sheet', stack < 0.55, `${stack.toFixed(4)} over 3 skins`);
        check(
          '...because the graze growth is bounded, not free',
          /const PANEL_VEIL_GRAZE_MAX = [\d.]+;/.test(glbSrc) &&
            clearPanelVeilAt(veil, 0.13, 0.05) < clearPanelVeilAt(veil, 0.13, 1) * 2,
          `${clearPanelVeilAt(veil, 0.13, 0.05).toFixed(4)} vs ${clearPanelVeilAt(veil, 0.13, 1).toFixed(4)}`,
        );
        // AND THE PERIMETER WALLS GET NONE OF IT. The 2026-09-18 report about those was that they
        // read as solid beige bands; they measure present from every camera the probe checks.
        check('a wall panel has no veil at all', clearPanelVeilAt(0, 0.08, 0.9) === 0);
        check(
          '...and `clearPanelPresence` splits the three terms so the lane can name which moved',
          (() => {
            const p = clearPanelPresence(veil, 0.13, 0.9);
            return p.veil > 0 && p.mirror > 0 && p.body > 0;
          })(),
        );
      }

      // THE ROUGHNESS -- the half of the fix that does not depend on the viewing angle
      check('a season-old panel is not showroom acrylic', /const PANEL_ROUGHNESS = 0\.18;/.test(glbSrc) && !/roughness: 0\.08/.test(glbCode));

      // ⚠️ AND NO STRAY DASHES CAME BACK WITH IT. Three statements, all over the CODE:
      check('ITEM 8 adds no edge pass (the file-wide guard, restated against THIS change)', !/EdgesGeometry|LineSegments/.test(glbCode));
      {
        const at = glbCode.indexOf('function clearPanelMaterial');
        const body = at < 0 ? '' : glbCode.slice(at, glbCode.indexOf('\n}', glbCode.indexOf('onBeforeCompile', at)));
        check(
          '...and the panel material builds no geometry and no mesh of its own',
          body.length > 0 && !/new THREE\.Mesh\(|Geometry\(|new THREE\.Line/.test(body),
          `${body.length} chars`,
        );
        check('...it is one material, whose only addition is a fragment-shader replace', body.includes('shader.fragmentShader = shader.fragmentShader.replace('));
        // the FrontSide / depthWrite policy the 2026-09-19 re-tune set is unchanged by all this
        check('...and depthWrite:false survives it', /depthWrite: false/.test(body));
      }
    }

    // ITEM 13b -- THE ACM PANEL IS BLANK, BECAUSE THE CAD SHIPS IT BLANK.
    //
    // `am-5883: Panel Sticker` x2 arrives as `decal#ffffff` with no artwork (the blank-decal
    // inventory above records it). The renderer used to letter "F I R S T  T E C H  C H A L L E
    // N G E" / "BIOBUZZ" / an amber rule onto it -- invented artwork on blank source data.
    // A hand-redrawn wordmark is not the alternative either: FIRST's trademark policy restricts
    // the LOGO marks to registered teams, committees/partners and written agreements, and the
    // brand guidelines forbid altered versions. So: a blank panel, shaded to read as a physical
    // sheet. §9 notes the logo panel may not be present at all events, so this is a real field.
    {
      check('the banner embeds or fetches NO logo artwork (unchanged, and it stays)', !/data:image|logo|\.svg|\.png/i.test(glbCode));
      {
        const at = glbCode.indexOf('function bannerTexture(');
        const body = at < 0 ? '' : glbCode.slice(at, glbCode.indexOf('\n}', at));
        check('the banner letters NOTHING -- no wordmark, no season name, no invented text', body.length > 0 && !/fillText|strokeText|\.font\s*=/.test(body), `${body.length} chars`);
        check('...and the three invented marks are gone by name', !/F I R S T|BIOBUZZ.*fillText|#ffba52/.test(body));
        check('it draws a SHEET instead: a gradient face and a soft wrapped edge', body.includes('createLinearGradient') && body.includes('PANEL_STICKER_EDGE'));
        // ...as a filled band, not a stroked outline -- a 1-px stroke on a quad leaning 24 deg
        // aliases into exactly the dashes owner bug 3 was about
        check('...with no stroked outline anywhere in it', !/stroke/i.test(body));
      }
      check('the panel face is semi-gloss composite, not a matt floor decal', glbSrc.includes('function panelStickerMaterial(') && glbSrc.includes('panelStickerMaterial(bannerTexture('));
      check('and the reasoning is recorded where the next session will read it', /Policy on the Use of FIRST\s+\*?\s*Trademarks/.test(glbSrc) || /Trademarks and Copyrighted Materials/.test(glbSrc));
      check('...including that the CAD sticker is the source of truth for it being blank', /am-5883/.test(glbSrc));
    }
  }
}

/** Fig 9-16's four cell names, written out here rather than imported, so the renderer's own
 *  table is checked against a second copy. */
const TAG_LABEL_EXPECTED = { redNorth: 'RED FAR', redSouth: 'RED AUDIENCE', blueNorth: 'BLUE FAR', blueSouth: 'BLUE AUDIENCE' } as const;
const TAG_LABEL_ROWS = [
  ['red', 'north', 'RED FAR'],
  ['red', 'south', 'RED AUDIENCE'],
  ['blue', 'north', 'BLUE FAR'],
  ['blue', 'south', 'BLUE AUDIENCE'],
] as const;
/** the bleed's shipped tuning, restated here so the checks above test the VALUE rather than
 *  reading the same symbol the renderer does. */
const TAG_BLEED_PX_PER_IN = 1.4;
const TAG_BLEED_OPACITY_EXPECTED = 0.3;
const TAG_BLEED_WHITE_EXPECTED = '#f2f4f6';
const TAG_BLEED_INK_EXPECTED = '#a8b2bc';

/** read the 36 code bits back out of a rendered 36h11 grid, MSB first at the published
 * `bit_x`/`bit_y` offsets — the inverse of `apriltag36h11Cells`, written out longhand here so the
 * round-trip is not checked against the same table that produced it. */
function readTagCode(grid: Uint8Array): number {
  const bitX = [1, 2, 3, 4, 5, 2, 3, 4, 3, 6, 6, 6, 6, 6, 5, 5, 5, 4, 6, 5, 4, 3, 2, 5, 4, 3, 4, 1, 1, 1, 1, 1, 2, 2, 2, 3];
  const bitY = [1, 1, 1, 1, 1, 2, 2, 2, 3, 1, 2, 3, 4, 5, 2, 3, 4, 3, 6, 6, 6, 6, 6, 5, 5, 5, 4, 6, 5, 4, 3, 2, 5, 4, 3, 4];
  let code = 0;
  for (let i = 0; i < 36; i++) code += grid[(bitY[i] + 1) * 10 + (bitX[i] + 1)] * 2 ** (35 - i);
  return code;
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

  /**
   * ⚠️ **A PARKED ELEMENT'S `z` CONVENTION BRANCHES ON THE PHYSICS, NEVER ON `state.kind`.**
   *
   * 3D writes a BOTTOM for every ball it solves, parked or loose: `readback` is `b.z = t.z - r`
   * and a placed flower element is seated `PLACE_CENTRE_Z - r`. 2D writes a CENTRE for a parked
   * one and only for a parked one: `play.ts`'s `park()` uses `CELL_MID_Z` and `flowerStackZ`
   * returns "Centre heights (in) of every element in the stack".
   *
   * Both mistakes have shipped, one per branch, and both came from keying on the KIND:
   *  · the HIVE branch drew a bare `b.z`, one radius LOW under 3D — visible on a landing shot,
   *    because it arrives tagged `flight` (drawn at `b.z + r`) and `derive.ts` retags it
   *    `element` the tick it settles (owner, 2026-09-19: "once balls land inside the HIVE, they
   *    teleport slightly downwards"). It was then fixed to lift ALWAYS, which floats the same
   *    element 1.4 in high under 2D;
   *  · the FLOWER branch drew raw ALWAYS, which sinks a 3D element a radius into its own stack.
   *
   * A 2D-physics world in the 3D VIEW is reachable — `GameView.tsx` falls back to
   * `practicePhysics: '2d'` on a 3D chunk-load failure without changing the view — so neither
   * branch may assume its own solve. These checks pin the branch itself; the FLOWER3D lane
   * asserts the 3D half numerically, against a real body.
   */
  {
    const els = readFileSync(join(root, 'src', 'games', 'biobuzz', 'scene', 'renderElements.ts'), 'utf8');
    const engine = readFileSync(join(root, 'src', 'games', 'biobuzz', 'sim3d', 'engineImpl.ts'), 'utf8');
    check(
      'the parked-element height is read off the PHYSICS, not off `state.kind`',
      /const bottom = biobuzzPhysics\(world\) === '3d';/.test(els),
    );
    check(
      'the HIVE branch lifts by the radius under 3D and draws raw under 2D',
      /poseAt\(mesh, idx, b\.pos\.x \+ t \* span, b\.pos\.y, bottom \? b\.z \+ r : b\.z\)/.test(els),
    );
    check(
      'the FLOWER branch takes the SAME branch, not the opposite one',
      /poseAt\(mesh, idx, b\.pos\.x, b\.pos\.y, bottom \? b\.z \+ r : b\.z\)/.test(els),
    );
    check(
      '...and 3D really does write a BOTTOM — `syncElement` places the body at `b.z + r`',
      /const centreZ = b\.z \+ r;/.test(engine) && /setTranslation\(b\.pos\.x, b\.pos\.y, centreZ\)/.test(engine),
    );
    check(
      '...while 2D really does write a CENTRE — `flowerStackZ` returns seat + r',
      /out\.push\(seat \+ r\);/.test(readFileSync(join(root, 'src', 'games', 'biobuzz', 'flower.ts'), 'utf8')),
    );
  }

  /**
   * ── THE HIVE'S PIVOT ROCKER RIDES THE TRAY ─────────────────────────────────────────────────
   *
   * Owner, 2026-09-20: "Support bracket for the hive is artifacting & is behind/desynced
   * sometimes (does not tip with the hive)." The six parts per alliance that bolt to the tray's
   * spine — the two Goal Pivot Bracket plates, the two damper holders and the two dampers — ship
   * inside `hive_<a>/frame`, which is STATIC, so they sat still while the see-saw swung. The
   * autopsy is in `renderFieldGlb.ts`'s own THE PIVOT ROCKER THE PIPELINE ALSO FILED AS FRAME.
   *
   * Two things are pinned here, because the bug needed both to be true to ship:
   *  · the SELECTOR still separates. A whole connected component that reaches no further than
   *    `ROCKER_HALF_SPAN_IN` from a tray's centreline plane is rocker hardware; measured, the six
   *    reach 0.60 in and the nearest STATIC component (`axle_holder` / `a_frame_top_corner`)
   *    reaches 2.26, on both LODs. A field revision that closes that gap fails here rather than
   *    silently freezing a part again — or silently tipping the A-frame.
   *  · the reparented geometry is RIGID on the tray. At every tilt its world position is the
   *    rotation about the pivot of where the CAD captured it. That is what "does not tip with
   *    the hive" failed at, by up to 7.28 in at the opposite rest and 0.00 at the captured one —
   *    the whole of the owner's "sometimes", because `|captureTheta|` IS `BB_HIVE_TILT_DEG`.
   */
  {
    const ROCKER_PER_ALLIANCE = 6;
    const SELECTOR_FLOOR_IN = 2.2; // the nearest STATIC component; measured 2.26
    const SELECTOR_CEIL_IN = 0.65; // the furthest ROCKER component; measured 0.60
    for (const [file, scene] of [
      ['field.glb', FIELD_GLB_SCENE],
      ['field-low.glb', FIELD_LOW_GLB_SCENE],
    ] as const) {
      check(`${file} parses, so the rocker checks below are not vacuous`, scene !== null);
      if (!scene) continue;
      const comps = hiveFrameComponents(scene);
      for (const a of ['red', 'blue'] as const) {
        const rides = comps.filter((c) => c.rides && c.alliance === a);
        check(
          `${file}: ${a}'s tray carries all ${ROCKER_PER_ALLIANCE} pivot-rocker parts (2 brackets, 2 damper holders, 2 dampers)`,
          rides.length === ROCKER_PER_ALLIANCE,
          `${rides.length}: ${rides.map((c) => `${c.tris}t@${c.spanFromPivot.toFixed(2)}`).join(' ')}`,
        );
        check(`${file}: ...and every one of them is real geometry`, rides.every((c) => c.tris > 0));
      }
      const worstRocker = Math.max(...comps.filter((c) => c.rides).map((c) => c.spanFromPivot));
      const nearestStatic = Math.min(...comps.filter((c) => !c.rides).map((c) => c.spanFromPivot));
      check(
        `${file}: the rocker/frame split has room to be wrong in — rocker reaches ${worstRocker.toFixed(2)} in, the nearest static ${nearestStatic.toFixed(2)}`,
        worstRocker <= SELECTOR_CEIL_IN && nearestStatic >= SELECTOR_FLOOR_IN,
        `${worstRocker.toFixed(3)} / ${nearestStatic.toFixed(3)}`,
      );
    }

    if (FIELD_LOW_GLB_SCENE) {
      const fg = assembleFieldGroups(FIELD_LOW_GLB_SCENE, 'low');
      check('the loader moves the braces AND the rocker off the static frame nodes', fg.braceTris > 0 && fg.rockerTris > 0, `${fg.braceTris} brace / ${fg.rockerTris} rocker tris`);
      // nothing rocker-shaped may be LEFT behind in a frame node, or half of it would still freeze
      const leftBehind = hiveFrameComponents(fg.root).filter((c) => c.rides);
      check(
        'nothing within the rocker span is left in a hive FRAME node after the reparent',
        leftBehind.length === 0,
        leftBehind.map((c) => `${c.node}:${c.tris}t`).join(', '),
      );
      for (const a of ['red', 'blue'] as const) {
        const tray = fg.hives[a].tray;
        const moved: THREE.Mesh[] = [];
        tray.traverse((o) => {
          if (o instanceof THREE.Mesh && /tray-(rocker|brace)$/.test(o.name)) moved.push(o);
        });
        check(`${a}: every reparented part hangs off the TILTING group, not the frame`, moved.length > 0, `${moved.length} meshes`);
        const pivot = fieldColliders3d().trays[a].pivot;
        // the reference pose is the one the CAD captured — the single tilt at which the frozen
        // rocker used to look right.
        const rest = cadCaptureTheta(a);
        const sample = (theta: number): THREE.Vector3[] => {
          tray.rotation.set(theta, 0, 0);
          tray.updateMatrixWorld(true);
          const out: THREE.Vector3[] = [];
          for (const m of moved) {
            const pos = m.geometry.getAttribute('position');
            const step = Math.max(1, Math.floor(pos.count / 40));
            for (let i = 0; i < pos.count; i += step) out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld));
          }
          return out;
        };
        const at0 = sample(rest);
        let worst = 0;
        let spread = 0;
        for (const theta of [-0.5236, -0.2618, 0, 0.2618, 0.5236]) {
          const now = sample(theta);
          const rot = new THREE.Matrix4()
            .makeTranslation(pivot[0], pivot[1], pivot[2])
            .multiply(new THREE.Matrix4().makeRotationX(theta - rest))
            .multiply(new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]));
          for (let i = 0; i < now.length; i++) {
            const want = at0[i].clone().applyMatrix4(rot);
            worst = Math.max(worst, now[i].distanceTo(want));
            spread = Math.max(spread, now[i].distanceTo(at0[i]));
          }
        }
        check(`${a}: the rocker is RIGID on the tray — its pose at any tilt is the captured pose rotated about the pivot`, worst < 1e-3, `${worst.toFixed(5)} in`);
        check(`${a}: ...and it really does move (a frozen part would pass the line above trivially)`, spread > 6, `${spread.toFixed(2)} in over the full swing`);
        tray.rotation.set(rest, 0, 0);
      }
    }
  }
}
