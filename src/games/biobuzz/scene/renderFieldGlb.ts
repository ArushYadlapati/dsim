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

/**
 * PART-CLASS MATERIALS — one entry PER NAMED glTF MATERIAL `convert.py`/`assemble-gltf.mjs` can
 * write (2026-09-18 fidelity pass, owner playtest: "the flower has lost its colour", "the field
 * wall should be transparent"). The Day 1 version of this file assigned materials by WALKING UP
 * each mesh's ancestor chain looking for a node name it recognised (`/^flower_/` → one flat
 * "plastic" for the WHOLE flower) — that was fine as long as a flower was one merged STL with one
 * material, which is exactly the bug: a flower's ring, its HIPS pipe and its backstop are three
 * different real materials, and merging them into one node made "assign by node" and "assign by
 * part" the same operation. `convert.py` now writes one glTF PRIMITIVE per part class inside each
 * node (`flower_0` is a ring + a pipe + a base primitive, not one blob), so the loader can and
 * does assign BY THE PRIMITIVE'S OWN MATERIAL NAME — the name `assemble-gltf.mjs`'s `MAT` table
 * gave it, preserved by GLTFLoader on `Material.name` — which is a strictly finer-grained (and
 * simpler: no ancestor walk) lookup than the old node-name heuristic.
 */
const MATERIAL_CLASSES = [
  'tile',
  'wall_panel',
  'wall_extrusion',
  'hive_frame_metal',
  'tray_panel_red',
  'tray_panel_blue',
  'tray_metal',
  'flower_ring',
  'flower_pipe',
  'flower_base',
  'tape_red',
  'tape_blue',
  'tape_white',
] as const;
type MaterialClass = (typeof MATERIAL_CLASSES)[number];
type MaterialSet = Record<MaterialClass, THREE.Material>;

/**
 * TRANSPARENT POLYCARBONATE WALL — the SAME optical policy as `renderField.ts`'s `wallMaterial()`
 * (the constants-built fallback), duplicated rather than imported: importing it here would make
 * this file depend on `renderField.ts`, which already depends on THIS file (`loadFieldGlb`) —
 * a cycle. Keep the two numbers in step by hand if the policy changes; the report calls out the
 * exact values (opacity 0.22, roughness 0.1) so a future edit greps for them in both files.
 */
const WALL_PANEL_OPACITY = 0.22;
/** matches `renderField.ts`'s `WALL_RENDER_ORDER` — drawn after every opaque object so two
 * transparent walls (or a wall and a robot) never fight over which one occludes the other. */
const WALL_RENDER_ORDER = 10;

function buildMaterials(): MaterialSet {
  const metal = (color: number): THREE.Material => new THREE.MeshStandardMaterial({ color, metalness: 0.7, roughness: 0.35 });
  return {
    tile: new THREE.MeshStandardMaterial({ color: 0x2a2e33, metalness: 0, roughness: 0.9 }),
    wall_panel: new THREE.MeshPhysicalMaterial({
      color: 0xdfe6ea,
      metalness: 0,
      roughness: 0.1,
      transparent: true,
      opacity: WALL_PANEL_OPACITY,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    wall_extrusion: metal(0x9aa1ab),
    hive_frame_metal: metal(0x9aa1ab),
    tray_panel_red: new THREE.MeshStandardMaterial({ color: 0xbf1f1a, metalness: 0.05, roughness: 0.5 }),
    tray_panel_blue: new THREE.MeshStandardMaterial({ color: 0x0f4bd6, metalness: 0.05, roughness: 0.5 }),
    tray_metal: metal(0x8b929c),
    // the ring plates — the 2D renderer's own flower-ring token (`C.COLORS.white`, `drawField.ts`'s
    // `buildFlower`'s `ringMat`), so the two views agree on what a flower's ring looks like.
    flower_ring: new THREE.MeshStandardMaterial({ color: 0xe5e7eb, metalness: 0, roughness: 0.4 }),
    // the HIPS support pipes — light grey, undecorated hardware.
    flower_pipe: new THREE.MeshStandardMaterial({ color: 0xc2c4c8, metalness: 0.05, roughness: 0.55 }),
    // backstop / field bracket / under-field bracket — the flower's solid structural hardware.
    flower_base: new THREE.MeshStandardMaterial({ color: 0x8c929c, metalness: 0.3, roughness: 0.5 }),
    tape_red: new THREE.MeshStandardMaterial({ color: 0xe02020, metalness: 0, roughness: 0.8 }),
    tape_blue: new THREE.MeshStandardMaterial({ color: 0x0a5cff, metalness: 0, roughness: 0.8 }),
    tape_white: new THREE.MeshStandardMaterial({ color: 0xe5e7eb, metalness: 0, roughness: 0.8 }),
  };
}

/**
 * Assigns each mesh's runtime PBR material BY ITS OWN GLTF MATERIAL NAME (`obj.material.name`,
 * preserved by GLTFLoader from `assemble-gltf.mjs`'s `doc.createMaterial(key)`) and turns on
 * shadows. The assembled glb ships NO vertex normals (see `assemble-gltf.mjs`'s header —
 * meshoptimizer's simplifier cannot collapse a flat-shaded mesh's edges, since every triangle
 * boundary then looks like a hard attribute seam), so this also computes smooth vertex normals
 * once here — the standard, cheap way to shade a decimated background asset.
 */
function styleScene(root: THREE.Object3D, materials: MaterialSet): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
    if (obj.geometry && !obj.geometry.getAttribute('normal')) {
      obj.geometry.computeVertexNormals();
    }
    const srcMaterial = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    const cls = srcMaterial?.name as MaterialClass | undefined;
    const resolved = cls && materials[cls] ? materials[cls] : materials.flower_base; // safe grey default
    if (!cls || !materials[cls]) {
      // eslint-disable-next-line no-console
      console.warn(`renderFieldGlb: mesh "${obj.name}" has no recognised material class ("${cls}") — using a default grey.`);
    }
    obj.material = resolved;
    if (cls === 'tile') obj.castShadow = false; // the floor never casts, only receives
    if (cls === 'wall_panel') obj.renderOrder = WALL_RENDER_ORDER;
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
