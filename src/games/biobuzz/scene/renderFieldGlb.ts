/**
 * BIOBUZZ field CAD glTF loader (`docs/biobuzz/plan-3d.md` §8). Loads `field.glb` /
 * `field-low.glb` (`public/models/biobuzz/`, produced by `scripts/field-cad/convert.py` +
 * `scripts/field-cad.mjs` — README next to the files documents the pipeline) and returns the
 * named parts as `THREE.Object3D`s, with materials assigned by part class and shadow flags set.
 *
 * NOT YET WIRED — `scene/renderField.ts` still builds the constants-based fallback field and
 * nothing calls `loadFieldGlb` yet. This file is self-contained so the switch-over (replacing
 * `buildBiobuzzField`'s bodies with these, and `sim3d/bodies.ts`'s statics with
 * `fieldColliders3d()`) can happen in one pass later — see the report's "what remains" section
 * for the exact call-site edits.
 *
 * `three` only here (and in the other `scene/render*.ts` files) — never in `sim3d/**`, per the
 * repo's determinism/bundle-chunking rule (CLAUDE.md, `docs/area/biobuzz.md` §3.9).
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Alliance } from '../../../types';
import { fieldColliders3d } from '../sim3d/fieldColliders';

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

interface MaterialSet {
  metal: THREE.Material;
  polycarbonate: THREE.Material;
  plastic: THREE.Material;
  plasticRed: THREE.Material;
  plasticBlue: THREE.Material;
  tile: THREE.Material;
}

function buildMaterials(): MaterialSet {
  return {
    metal: new THREE.MeshStandardMaterial({ color: 0x9aa1ab, metalness: 0.75, roughness: 0.35 }),
    polycarbonate: new THREE.MeshPhysicalMaterial({
      color: 0xdfe6ea,
      metalness: 0,
      roughness: 0.15,
      transmission: 0.55,
      transparent: true,
      opacity: 0.85,
    }),
    plastic: new THREE.MeshStandardMaterial({ color: 0xc2c4c8, metalness: 0.05, roughness: 0.55 }),
    plasticRed: new THREE.MeshStandardMaterial({ color: 0xbf1f1a, metalness: 0.05, roughness: 0.5 }),
    plasticBlue: new THREE.MeshStandardMaterial({ color: 0x0f4bd6, metalness: 0.05, roughness: 0.5 }),
    tile: new THREE.MeshStandardMaterial({ color: 0x2a2e33, metalness: 0, roughness: 0.9 }),
  };
}

/**
 * Assigns a material by the OWNING NAMED NODE (walking up from each mesh to the nearest
 * ancestor whose name convert.py/assemble-gltf.mjs gave meaning to) and turns on shadows.
 * The assembled glb ships NO vertex normals (see `assemble-gltf.mjs`'s header — meshoptimizer's
 * simplifier cannot collapse a flat-shaded mesh's edges, since every triangle boundary then
 * looks like a hard attribute seam), so this also computes smooth vertex normals once here —
 * the standard, cheap way to shade a decimated background asset.
 */
function styleScene(root: THREE.Object3D, materials: MaterialSet): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
    if (obj.geometry && !obj.geometry.getAttribute('normal')) {
      obj.geometry.computeVertexNormals();
    }
    let n: THREE.Object3D | null = obj;
    let material: THREE.Material = materials.plastic;
    while (n) {
      // `userData.name` first — see `findByOriginalName`'s header: `.name` has had every `/`
      // silently dropped by THREE's sanitizer, which would otherwise still coincidentally
      // substring-match "frame" but silently BREAK the "hive_red/tray" / "hive_blue/tray" match.
      const name = (n.userData?.name as string | undefined) ?? n.name;
      if (name === 'tiles') {
        material = materials.tile;
        obj.castShadow = false; // the floor never casts, only receives
        break;
      }
      if (name === 'walls' || name === 'stations') {
        material = materials.polycarbonate;
        break;
      }
      if (/frame/.test(name) || name === 'tape') {
        material = materials.metal;
        break;
      }
      if (/hive_red\/tray/.test(name)) {
        material = materials.plasticRed;
        break;
      }
      if (/hive_blue\/tray/.test(name)) {
        material = materials.plasticBlue;
        break;
      }
      if (/^flower_/.test(name)) {
        material = materials.plastic;
        break;
      }
      n = n.parent;
    }
    obj.material = material;
  });
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

  styleScene(root, buildMaterials());

  const floor = mustFind(root, 'tiles');
  const walls = mustFind(root, 'walls');
  const stations = findOptional(root, 'stations');

  const hives = {
    red: { frame: mustFind(root, 'hive_red/frame'), tray: buildTrayGroup(root, 'red') },
    blue: { frame: mustFind(root, 'hive_blue/frame'), tray: buildTrayGroup(root, 'blue') },
  };

  const flowers = [0, 1, 2, 3].map((k) => mustFind(root, `flower_${k}`));

  return { floor, walls, stations, hives, flowers, root };
}
