/**
 * BIOBUZZ field CAD glTF loader (`docs/biobuzz/plan-3d.md` §8). Loads `field.glb` /
 * `field-low.glb` (`public/models/biobuzz/`, produced by `scripts/field-cad/convert.py` +
 * `scripts/field-cad.mjs` — README next to the files documents the pipeline) and returns the
 * named parts as `THREE.Object3D`s, with materials assigned by part class and shadow flags set.
 *
 * WIRED (the CAD switch-over pass): `scene/renderField.ts`'s `buildBiobuzzField` awaits
 * `loadFieldGlb` first and only falls back to the constants-based field on any failure; the
 * physics side's `sim3d/bodies.ts` reads `fieldColliders3d()` independently (see that file).
 *
 * `three` only here (and in the other `scene/render*.ts` files) — never in `sim3d/**`, per the
 * repo's determinism/bundle-chunking rule (CLAUDE.md, `docs/area/biobuzz.md` §3.9).
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Alliance } from '../../../types';
import { cadCellBox, fieldColliders3d } from '../sim3d/fieldColliders';

export interface FieldHiveGroup {
  /** static — the triangular base + uprights + damper hardware. World-absolute pose. */
  frame: THREE.Object3D;
  /**
   * the dynamic see-saw body: a `THREE.Group` parked at the hive's PIVOT (world-absolute,
   * from `fieldColliders3d().trays[alliance].pivot` — the same number the physics uses, so the
   * visual and the collider can never disagree about where the hinge is) with the tray mesh
   * re-parented under it via `Object3D.attach` (preserves world transform on reparent, so this
   * works regardless of whatever internal offset `gltf-transform`'s quantize pass baked into
   * the loaded node — see the report's gotchas for why a plain re-position would NOT be safe
   * here). Rotate THIS object about local X to drive the live tilt, exactly like the
   * constants-built fallback's `updateBiobuzzField` already does for its own tray group.
   */
  tray: THREE.Group;
}

export interface FieldGroups {
  floor: THREE.Object3D;
  walls: THREE.Object3D;
  /** the 16 CAD gaffer-tape strips — the LOADING ZONE and GARDEN marks on the tiles and the two
   * ALLIANCE AREA outlines on the gym floor. Present on every field revision that carries tape;
   * `null` only if a future STEP drops it. */
  tape: THREE.Object3D | null;
  /** the parts of the HIVE frame that span BOTH hives — the A-Frame Top Bar (the crossbar) and
   * the ACM logo panel with its sticker. World-absolute and static, like the per-alliance frames;
   * separate only because their centroid sits at x ≈ 0 and a red/blue split by sign would hand a
   * shared part to one hive arbitrarily. */
  sharedFrame: THREE.Object3D | null;
  /** present only if the STEP assembly actually had driver-station geometry (it does not, as
   * of the 2026-09-15 field revision — see the report's part inventory) */
  stations: THREE.Object3D | null;
  hives: { red: FieldHiveGroup; blue: FieldHiveGroup };
  /** index-matched to `config.ts`'s `BB_FLOWERS` (F1..F4) */
  flowers: THREE.Object3D[];
  /** the root scene graph these were pulled out of — mount THIS if the caller wants everything
   * (including the raw hive/flower nodes before `attach()` reparenting) rather than the
   * individually-typed groups above. Most callers want the typed groups instead. */
  root: THREE.Group;
}

let sharedLoader: GLTFLoader | null = null;
function loader(): GLTFLoader {
  if (!sharedLoader) {
    sharedLoader = new GLTFLoader();
    sharedLoader.setMeshoptDecoder(MeshoptDecoder);
  }
  return sharedLoader;
}

/**
 * Resolve a base path (e.g. `models/biobuzz/field`, no extension) or a bare directory
 * (`models/biobuzz`) into the quality-specific `.glb` URL, through Vite's
 * `import.meta.env.BASE_URL` — required for the Electron build, which sets a relative `./`
 * base (`vite.config.ts`) so a bare `/models/...` 404s under `file://`. An already-absolute
 * (`http(s)://`) URL is passed through untouched.
 */
function resolveGlbUrl(base: string, quality: 'high' | 'low'): string {
  if (/^https?:\/\//i.test(base)) return base.endsWith('.glb') ? base : `${base.replace(/\/+$/, '')}/field${quality === 'low' ? '-low' : ''}.glb`;
  const filename = quality === 'low' ? 'field-low.glb' : 'field.glb';
  const trimmed = base.replace(/\/?field(-low)?\.glb$/i, '').replace(/^\/+/, '').replace(/\/+$/, '');
  const baseUrl = (import.meta.env.BASE_URL ?? '/').replace(/\/+$/, '');
  return `${baseUrl}/${trimmed}/${filename}`.replace(/\/{2,}/g, '/');
}

/**
 * ⚠️ NOT `Object3D.getObjectByName` — THREE's `GLTFLoader` runs every node name through
 * `PropertyBinding.sanitizeNodeName` (it has to: node names double as animation-track path
 * segments, where `/` is the separator), and that sanitizer does not escape a `/`, it DROPS
 * it — `"hive_red/frame"` loads as an object literally named `"hive_redframe"`. The loader
 * keeps the true original in `node.userData.name` (`GLTFLoader.js`'s `parseNode`) specifically
 * for cases like this, so lookup goes through that instead of the mangled `.name`.
 */
function findByOriginalName(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let hit: THREE.Object3D | null = null;
  root.traverse((obj) => {
    if (hit) return;
    if (obj.userData?.name === name || obj.name === name) hit = obj;
  });
  return hit;
}

function mustFind(root: THREE.Object3D, name: string): THREE.Object3D {
  const found = findByOriginalName(root, name);
  if (!found) throw new Error(`renderFieldGlb: glTF is missing expected node "${name}" — see field-cad's README for the node names convert.py writes`);
  return found;
}

function findOptional(root: THREE.Object3D, name: string): THREE.Object3D | null {
  return findByOriginalName(root, name);
}

/**
 * ⚠️ THE COLOUR COMES FROM THE CAD, NOT FROM THIS FILE.
 *
 * Every glTF material in the asset is named `<finish>#<rrggbb>` and carries that colour in its
 * own `baseColorFactor` — `convert.py` reads it out of the STEP's styled-item chain and
 * `assemble-gltf.mjs` writes one material per (finish, colour) pair. This file supplies only the
 * SURFACE (roughness / metalness / transparency), keyed by the finish.
 *
 * That split is the fix for the owner's "flowers are still the wrong color". The previous version
 * kept a hand-picked hex per part class HERE and another set of placeholders in the assembler, so
 * a flower rendered as three greys (`#e5e7eb` ring, `#c2c4c8` pipes, `#8c929c` base) when the CAD
 * says amber `#ffba52`, green `#5fa73d` and purple `#641c65`. It also had the hive backwards: the
 * alliance colour is the two RIBS (pure `#ff0000` / `#0000ff`), not the white `#e6e6e6` skins.
 * See `docs/biobuzz/field-cad-audit.md` §3 for the full measured table.
 *
 * TWO DELIBERATE OVERRIDES, both flagged in the audit as CAD placeholders rather than intent:
 *  - `glass` keeps the CAD hue but is forced transparent (the STEP has the polycarbonate panels
 *    at an opaque `#e6e6e6`; the real thing is see-through, and a solid perimeter hides the
 *    field from a driver camera outside it).
 *  - `tile` is forced to the sim's own mat token. The CAD gives the soft tiles a flat 50 % grey
 *    placeholder; a real FTC tile is near-black foam, and — more load-bearing — the HUD contrast
 *    pairs (`npm run contrast`) are tuned against `COLORS.mat`/`COLORS.tile`, so a 50 %-grey
 *    floor would quietly break them. The `tiles` node is hidden at runtime anyway
 *    (`renderField.ts` draws the seam grid on its own textured plane), so this is a fallback.
 */
const FINISHES = ['tile', 'glass', 'metal', 'plastic', 'decal', 'tape', 'misc'] as const;
type Finish = (typeof FINISHES)[number];

/** the sim's own floor token — see the `tile` override above. Matches `C.COLORS.mat`; the
 * literal rather than the import because `renderField.ts` (which owns the floor) already
 * depends on THIS file, and importing back would be a cycle. */
const TILE_TONE = 0x2a2e33;

/**
 * TRANSPARENT POLYCARBONATE WALL — the SAME optical policy as `renderField.ts`'s `wallMaterial()`
 * (the constants-built fallback), duplicated rather than imported for the same cycle reason.
 * Keep the two numbers in step by hand if the policy changes.
 */
const WALL_PANEL_OPACITY = 0.22;
/** matches `renderField.ts`'s `WALL_RENDER_ORDER` — drawn after every opaque object so two
 * transparent walls (or a wall and a robot) never fight over which one occludes the other. */
const WALL_RENDER_ORDER = 10;

/** the tape and the AprilTag/sticker decals are painted ON a surface that is already there (the
 * tiles, the hive's skins), 0.010 in proud of it. At a driver camera's depth precision that is
 * inside the z-fighting band, so they are drawn with a polygon offset instead of being nudged
 * geometrically — moving the geometry would put the picture and the CAD out of step, which is
 * the whole class of bug this pass exists to remove. */
const DECAL_POLYGON_OFFSET = -2;

function materialFor(finish: Finish, colorHex: number): THREE.Material {
  switch (finish) {
    case 'glass':
      return new THREE.MeshPhysicalMaterial({
        color: colorHex,
        metalness: 0,
        roughness: 0.1,
        transparent: true,
        opacity: WALL_PANEL_OPACITY,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    case 'metal':
      return new THREE.MeshStandardMaterial({ color: colorHex, metalness: 0.7, roughness: 0.35 });
    case 'plastic':
      return new THREE.MeshStandardMaterial({ color: colorHex, metalness: 0.05, roughness: 0.5 });
    case 'tape':
      return new THREE.MeshStandardMaterial({
        color: colorHex,
        metalness: 0,
        roughness: 0.8,
        polygonOffset: true,
        polygonOffsetFactor: DECAL_POLYGON_OFFSET,
        polygonOffsetUnits: DECAL_POLYGON_OFFSET,
      });
    case 'decal':
      return new THREE.MeshStandardMaterial({
        color: colorHex,
        metalness: 0,
        roughness: 0.85,
        polygonOffset: true,
        polygonOffsetFactor: DECAL_POLYGON_OFFSET,
        polygonOffsetUnits: DECAL_POLYGON_OFFSET,
      });
    case 'tile':
      return new THREE.MeshStandardMaterial({ color: TILE_TONE, metalness: 0, roughness: 0.9 });
    case 'misc':
    default:
      return new THREE.MeshStandardMaterial({ color: colorHex, metalness: 0.2, roughness: 0.6 });
  }
}

/** `<finish>#<rrggbb>` -> `{finish, colorHex}`; `null` for anything that is not in that shape. */
function parseMaterialName(name: string | undefined): { finish: Finish; colorHex: number } | null {
  if (!name) return null;
  const cut = name.indexOf('#');
  if (cut <= 0) return null;
  const finish = name.slice(0, cut) as Finish;
  if (!(FINISHES as readonly string[]).includes(finish)) return null;
  const hex = name.slice(cut + 1);
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return { finish, colorHex: parseInt(hex, 16) };
}

/**
 * Assigns each mesh's runtime PBR material from ITS OWN GLTF MATERIAL NAME (`obj.material.name`,
 * preserved by GLTFLoader) and turns on shadows. One THREE material per distinct name, shared
 * across every mesh that carries it.
 *
 * The assembled glb ships NO vertex normals (see `assemble-gltf.mjs`'s header — meshoptimizer's
 * simplifier cannot collapse a flat-shaded mesh's edges, since every triangle boundary then looks
 * like a hard attribute seam), so this also computes smooth vertex normals once here.
 */
function styleScene(root: THREE.Object3D): void {
  const cache = new Map<string, THREE.Material>();
  const unknown = new Set<string>();
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
    if (obj.geometry && !obj.geometry.getAttribute('normal')) {
      obj.geometry.computeVertexNormals();
    }
    const src = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    const name = src?.name;
    const parsed = parseMaterialName(name);
    const key = parsed ? name : '__unrecognised__';
    let mat = cache.get(key);
    if (!mat) {
      if (!parsed) unknown.add(String(name));
      mat = parsed ? materialFor(parsed.finish, parsed.colorHex) : materialFor('misc', 0x9aa1ab);
      cache.set(key, mat);
    }
    obj.material = mat;
    if (parsed?.finish === 'tile') obj.castShadow = false; // the floor never casts, only receives
    if (parsed?.finish === 'glass') obj.renderOrder = WALL_RENDER_ORDER;
  });
  if (unknown.size > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `renderFieldGlb: ${unknown.size} glTF material name(s) are not "<finish>#<rrggbb>" and fell back to grey: ` +
        `${[...unknown].join(', ')}. Regenerate with \`npm run field-cad\`, or add the finish to FINISHES here and to FINISH in assemble-gltf.mjs.`,
    );
  }
}

/** builds the pivot-anchored tray group for one alliance — see `FieldHiveGroup.tray`'s header. */
function buildTrayGroup(root: THREE.Object3D, alliance: Alliance): THREE.Group {
  const rawTray = mustFind(root, `hive_${alliance}/tray`);
  const pivot = fieldColliders3d().trays[alliance].pivot;
  const pivotGroup = new THREE.Group();
  pivotGroup.name = `hive_${alliance}/tray-pivot`;
  pivotGroup.position.set(pivot[0], pivot[1], pivot[2]);
  // the pivot group must share rawTray's CURRENT parent for `attach()` to compute a correct
  // relative offset (attach() reads the object's current world matrix, which needs an
  // up-to-date parent chain) — add it as a sibling first, then reparent.
  rawTray.parent?.add(pivotGroup);
  pivotGroup.attach(rawTray);
  return pivotGroup;
}

/**
 * Loads one detail level of the CAD field and returns its named parts. `quality` selects
 * `field.glb` (high) or `field-low.glb` (low) — see `docs/biobuzz/plan-3d.md` §8 for the two
 * LODs' size budgets.
 */
export async function loadFieldGlb(url: string, quality: 'high' | 'low' = 'high'): Promise<FieldGroups> {
  const resolved = resolveGlbUrl(url, quality);
  const gltf: GLTF = await loader().loadAsync(resolved);
  const root = gltf.scene;

  styleScene(root);

  const floor = mustFind(root, 'tiles');
  const walls = mustFind(root, 'walls');
  const stations = findOptional(root, 'stations');
  const tape = findOptional(root, 'tape');
  const sharedFrame = findOptional(root, 'hive_shared/frame');

  const hives = {
    red: { frame: mustFind(root, 'hive_red/frame'), tray: buildTrayGroup(root, 'red') },
    blue: { frame: mustFind(root, 'hive_blue/frame'), tray: buildTrayGroup(root, 'blue') },
  };

  const flowers = [0, 1, 2, 3].map((k) => mustFind(root, `flower_${k}`));

  checkTrayFloorAgreement(hives);

  return { floor, walls, tape, sharedFrame, stations, hives, flowers, root };
}

/** how far the drawn tray floor may sit from the collider floor before the picture and the
 * physics are telling a driver two different things. 0.25 in is the brief's own number; the CAD
 * sheet is 0.020 in thick, so anything real lands far inside it. */
const TRAY_FLOOR_TOLERANCE_IN = 0.25;

/**
 * DEV SELF-CHECK — the drawn tray floor against the collider's. This is the owner's "the balls
 * are on a different plane than the actual bottom of the hive", turned into something that
 * complains on its own the next time it drifts.
 *
 * It measures the MESH: the lowest vertex of the tray node inside a window that isolates the
 * cell floor — |x| between 2 and 8 in (outboard of the `Basket Base Tube`, which hangs BELOW the
 * floor at |x| < 0.51, and inboard of the side walls and the Goal Rib's rim) and v inside the
 * cell's own depth — and compares it to `cadCellBox(...).wMin`, the plane the collider's floor
 * slab presents. Both are in the tray's un-tilted pivot-local frame, so no tilt arithmetic is
 * involved and a frame mistake shows up as a large number rather than cancelling out.
 *
 * `console.warn` only, and only in dev: a wrong floor is a fidelity bug, not a crash, and a
 * player mid-match is not helped by a thrown error.
 */
function checkTrayFloorAgreement(hives: { red: FieldHiveGroup; blue: FieldHiveGroup }): void {
  if (!import.meta.env?.DEV) return;
  for (const alliance of ['red', 'blue'] as const) {
    for (const sideSign of [1, -1] as const) {
      const box = cadCellBox(alliance, sideSign);
      if (!box) continue;
      const pivotGroup = hives[alliance].tray;
      let meshFloorW = Infinity;
      const v = new THREE.Vector3();
      pivotGroup.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh) || !obj.geometry) return;
        const pos = obj.geometry.getAttribute('position');
        if (!pos) return;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          obj.updateWorldMatrix(true, false);
          v.applyMatrix4(obj.matrixWorld).sub(pivotGroup.position);
          const ax = Math.abs(v.x);
          if (ax < 2 || ax > 8) continue;
          if (v.y < box.vMin || v.y > box.vMax) continue;
          if (v.z < meshFloorW) meshFloorW = v.z;
        }
      });
      if (!Number.isFinite(meshFloorW)) continue;
      const delta = Math.abs(meshFloorW - box.wMin);
      if (delta > TRAY_FLOOR_TOLERANCE_IN) {
        // eslint-disable-next-line no-console
        console.warn(
          `renderFieldGlb: ${alliance} ${sideSign > 0 ? 'north' : 'south'} cell — the DRAWN floor (local w ` +
            `${meshFloorW.toFixed(3)}) and the COLLIDER floor (w ${box.wMin.toFixed(3)}) differ by ` +
            `${delta.toFixed(3)} in, past the ${TRAY_FLOOR_TOLERANCE_IN} in tolerance. An element will look like it is ` +
            `floating or sunk. Regenerate with \`npm run field-cad\`; see docs/biobuzz/field-cad-audit.md §4.`,
        );
      }
    }
  }
}
