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
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { moduleFor } from '../../src/games';
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
}
