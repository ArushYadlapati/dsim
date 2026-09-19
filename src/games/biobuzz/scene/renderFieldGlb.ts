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
import { cadCaptureTheta, cadCellBox, fieldColliders3d } from '../sim3d/fieldColliders';

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
  /** how many triangles `reparentTrayBraces` moved out of the static frame nodes and into the
   * two trays — see that function's header. Non-zero on the shipped asset; zero once the pipeline
   * files the braces as tray parts itself. */
  braceTris: number;
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
 * The rib BLUE is the one CAD colour this file overrides — see `ALLIANCE_BLUE_TINT` below.
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
 * ⚠️ CLEAR PLASTIC IS A POLICY, NOT A COLOUR — and the CAD cannot tell you which parts want it.
 *
 * The STEP paints every clear polycarbonate panel on this field the same placeholder white
 * (`#e6e6e6`) it paints the solid white parts, so "is this see-through?" has to be decided PART
 * BY PART, here, against the real field. 2026-09-18 playtest: "many completely transparent /
 * semi-transparent panels are rendered as white or opaque white that is too strong."
 *
 * The classification, made from the GLB's own node × material inventory
 * (`docs/biobuzz/field-cad-audit.md` §3 has the measured CAD colour of every part):
 *
 *  CLEAR  `glass#*`  in `walls`                — `FTC Field Side Glass`, the perimeter panels.
 *  CLEAR  `plastic#e6e6e6` in a `hive_<a>` tray    — `Hive Goal {Top,Back,Bottom} Skin`, the three
 *                                                polycarbonate skins that make a CELL. They are
 *                                                the ONLY `plastic#e6e6e6` in a tray node (the
 *                                                `Basket Base Tube` is the `metal` finish and
 *                                                the ribs are `plastic#ff0000`/`#0000ff`), so
 *                                                the node+material pair names them exactly.
 *  OPAQUE `plastic#e6e6e6` in `hive_shared/frame` — `am-5877 ACM Panel`, an aluminium-composite
 *                                                logo board. Same material name, opposite answer:
 *                                                this is why the rule is keyed on the NODE too.
 *  OPAQUE `plastic#641c65` (flower backstop), `#5fa73d` (HIPS pipes), `#ffba52` (top ring),
 *         `#303030`, every `metal#*`, `decal#*`, `tape#*` — solid parts with a real CAD colour.
 *
 * ⚠️ AND A CLEAR PANEL IS NOT A PER-MATERIAL NUMBER — IT IS WHAT THE LAYERS SUM TO.
 *
 * The first pass set a "reasonable" 0.22 / 0.3 and looked right on a single panel from four feet
 * away. From the DRIVER camera it was not (2026-09-19 re-test: "the HIVE cell skins still read as
 * WHITE BOARDS… the far and side walls read as solid beige bands"), because four things stack:
 *  - LAYER COUNT. A cell puts floor + roof + back between the eye and a ball, a look across the
 *    field puts the near wall and the far wall in the way, and `DoubleSide` doubled every one of
 *    them. At 0.22 each, six surfaces sum to 1 − 0.78⁶ = **78 % opaque**. `FrontSide` is right for
 *    every one of these parts — each is a closed SOLID (the 0.020-in skins tessellate as a slab;
 *    the raycast in `checkTrayFloorAgreement` hits both of a floor's faces), so the near surface
 *    is always front-facing whichever side the camera is on, and the count halves.
 *  - ALPHA. 0.08 for a wall panel, 0.10 for a cell skin. Through the worst stack that is still
 *    only ~27 %, which is what clear polycarbonate actually does: near-invisible face-on.
 *  - BASE COLOUR. `#e6e6e6` is the STEP's placeholder for "white plastic", and a near-white base
 *    under any lighting is a white haze however low the alpha goes. Overridden to a cool neutral
 *    (`CLEAR_PANEL_TINT`) — the third deliberate CAD override in this file, for the same reason as
 *    the other two: the value is a placeholder, not intent.
 *  - `envMapIntensity`. At 1.0 a glossy panel mirrors the environment; the warm practice HDRI is
 *    exactly where the "beige" came from. 0.15 keeps a glancing highlight and nothing else.
 * What is LEFT to read the shape off is the EDGE — `addPanelEdges` draws a faint outline on the
 * cell skins, which is how a real clear panel reads. The perimeter needs none: its own rails and
 * link plates are opaque and already draw the frame.
 *
 * `depthWrite: false` + a `renderOrder` past every opaque object stays: three.js sorts transparent
 * objects by render order, not per triangle, so two clear panels must never fight over a pixel.
 */
const WALL_PANEL_OPACITY = 0.08;
/** the hive CELL skins sit a hair denser than the perimeter — they are what a driver reads the
 * cell's shape off, and there are fewer of them in any one line of sight. */
const CELL_PANEL_OPACITY = 0.1;
/** how much of the environment map a clear panel gathers. */
const CLEAR_ENV_INTENSITY = 0.15;
/** the tone every clear panel is forced to, overriding the STEP's `#e6e6e6` placeholder: a cool
 * neutral that disappears into whatever is behind it instead of hazing it white. */
const CLEAR_PANEL_TINT = 0x7d8b96;
/** the faint outline that makes a nearly-invisible panel's shape readable. */
const PANEL_EDGE_TINT = 0xb9c6d2;

/**
 * ⚠️ THE FOURTH DELIBERATE CAD OVERRIDE (owner bug 12, 2026-09-19: "the blue alliance looks too
 * purple — are you sure that is the exact colour AndyMark uses?").
 *
 * The STEP gives the hive Goal Ribs `plastic#0000ff`, and pure `#0000ff` is OKLCH hue 264.1° —
 * 1.7° off the most violet blue sRGB can express. An assembly carrying pure `#ff0000` AND pure
 * `#0000ff` is carrying placeholder part colours, the same way its `#e6e6e6` "white plastic" is a
 * placeholder rather than a paint (see `CLEAR_PANEL_TINT` above, which overrides it for that
 * reason). So the CAD is authoritative for DIMENSIONS — the owner's 2026-09-18 ruling, and
 * nothing here touches one — and is NOT authoritative for this colour.
 *
 * `ALLIANCE_BLUE_TINT` is the one BIOBUZZ blue every other surface takes (`draw.ts`'s
 * `ELEMENT_FILL` header carries the measurement): hue 252.9°, the least violet a saturated blue
 * gets, at the most chroma sRGB has there. APPROX — no authoritative AndyMark blue was found.
 * RED is left at the CAD's `#ff0000`: a pure red still reads as red, and the owner named only
 * blue.
 */
const CAD_ALLIANCE_BLUE = 0x0000ff;
const ALLIANCE_BLUE_TINT = 0x007be1;
const PANEL_EDGE_OPACITY = 0.3;
/** matches `renderField.ts`'s `WALL_RENDER_ORDER` — drawn after every opaque object so two
 * transparent walls (or a wall and a robot) never fight over which one occludes the other. */
const WALL_RENDER_ORDER = 10;
/** the cell skins are INSIDE the field, so they draw before the perimeter and after everything
 * opaque. Matches `renderField.ts`'s `CELL_RENDER_ORDER`. */
const CELL_RENDER_ORDER = 5;

/** the one clear-plastic material this file builds, for both the perimeter and the cell skins. */
function clearPanelMaterial(opacity: number): THREE.Material {
  return new THREE.MeshPhysicalMaterial({
    color: CLEAR_PANEL_TINT,
    metalness: 0,
    roughness: 0.08,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.FrontSide,
    envMapIntensity: CLEAR_ENV_INTENSITY,
  });
}

/** the outline pass — a child of the panel mesh, so it inherits every transform for free (a cell
 * skin rides the tray, which swings). `thresholdAngle` 25° keeps the panel boundaries and the
 * brake-formed chamfers and drops the tessellation's own interior triangulation. */
function addPanelEdges(mesh: THREE.Mesh, renderOrder: number): void {
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry, 25),
    new THREE.LineBasicMaterial({
      color: PANEL_EDGE_TINT,
      transparent: true,
      opacity: PANEL_EDGE_OPACITY,
      depthWrite: false,
    }),
  );
  edges.name = `${mesh.name || 'panel'}:edges`;
  edges.renderOrder = renderOrder;
  mesh.add(edges);
}

/** the tape and the AprilTag/sticker decals are painted ON a surface that is already there (the
 * tiles, the hive's skins), 0.010 in proud of it. At a driver camera's depth precision that is
 * inside the z-fighting band, so they are drawn with a polygon offset instead of being nudged
 * geometrically — moving the geometry would put the picture and the CAD out of step, which is
 * the whole class of bug this pass exists to remove. */
const DECAL_POLYGON_OFFSET = -2;

/** the top-level GLB node a mesh hangs off — the second half of the clear-plastic key above. */
type NodeFamily = 'tiles' | 'walls' | 'tape' | 'stations' | 'hive_tray' | 'hive_frame' | 'flower' | 'other';

function nodeFamilyOf(name: string | undefined): NodeFamily | null {
  if (!name) return null;
  if (name === 'tiles' || name === 'walls' || name === 'tape' || name === 'stations') return name;
  if (/^hive_(red|blue)\/tray$/.test(name)) return 'hive_tray';
  if (/^hive_(red|blue|shared)\/frame$/.test(name)) return 'hive_frame';
  if (/^flower_\d+$/.test(name)) return 'flower';
  return null;
}

/** TRUE for the parts that are clear polycarbonate on the real field — see the policy header. */
function isClearPanel(finish: Finish, colorHex: number, family: NodeFamily): boolean {
  if (finish === 'glass') return true;
  return finish === 'plastic' && colorHex === 0xe6e6e6 && family === 'hive_tray';
}

function materialFor(finish: Finish, rawHex: number, family: NodeFamily): THREE.Material {
  if (isClearPanel(finish, rawHex, family)) {
    return clearPanelMaterial(finish === 'glass' ? WALL_PANEL_OPACITY : CELL_PANEL_OPACITY);
  }
  // the clear-panel test reads the CAD's own value; everything painted below reads the corrected
  // one — see `ALLIANCE_BLUE_TINT`.
  const colorHex = rawHex === CAD_ALLIANCE_BLUE ? ALLIANCE_BLUE_TINT : rawHex;
  switch (finish) {
    case 'glass':
      // unreachable while `isClearPanel` claims every `glass`; kept so the switch stays total
      return clearPanelMaterial(WALL_PANEL_OPACITY);
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
 *
 * ⚠️ THE CACHE KEY IS `<material>@<node family>`, NOT THE MATERIAL NAME. One glTF material name
 * can want two different surfaces — `plastic#e6e6e6` is a clear CELL skin in a tray node and an
 * opaque ACM logo board in the shared frame — so keying on the name alone hands whichever node
 * loads first its answer to both. See the clear-plastic policy header.
 */
function styleScene(root: THREE.Object3D): void {
  const cache = new Map<string, THREE.Material>();
  const unknown = new Set<string>();
  const walk = (obj: THREE.Object3D, family: NodeFamily): void => {
    const own = nodeFamilyOf((obj.userData as { name?: string } | undefined)?.name ?? obj.name);
    const here = own ?? family;
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      if (obj.geometry && !obj.geometry.getAttribute('normal')) {
        obj.geometry.computeVertexNormals();
      }
      const src = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      const name = src?.name;
      const parsed = parseMaterialName(name);
      const key = `${parsed ? name : '__unrecognised__'}@${here}`;
      let mat = cache.get(key);
      if (!mat) {
        if (!parsed) unknown.add(String(name));
        mat = parsed ? materialFor(parsed.finish, parsed.colorHex, here) : materialFor('misc', 0x9aa1ab, here);
        mat.name = key; // debuggable from a console walk of the live scene; nothing reads it
        cache.set(key, mat);
      }
      obj.material = mat;
      if (parsed?.finish === 'tile') obj.castShadow = false; // the floor never casts, only receives
      if (parsed && isClearPanel(parsed.finish, parsed.colorHex, here)) {
        // a clear panel casts no shadow: a see-through sheet that throws a solid black shadow is
        // the single most obvious way to say "this is not actually transparent".
        obj.castShadow = false;
        obj.renderOrder = parsed.finish === 'glass' ? WALL_RENDER_ORDER : CELL_RENDER_ORDER;
        // the outline goes on the CELL SKINS only. The perimeter draws its own frame with
        // opaque rails and link plates, so a second outline there just doubles every edge.
        if (parsed.finish !== 'glass') addPanelEdges(obj, CELL_RENDER_ORDER);
      }
    }
    for (const child of obj.children) walk(child, here);
  };
  walk(root, 'other');
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

// ── THE TRAY BRACES THE PIPELINE FILED AS FRAME ───────────────────────────────────────────────
//
// 2026-09-18 playtest: "some weird lines remain after the HIVE is tipped."
//
// `convert.py`'s PART_RULES sends `am-5867: 10.5in Churro Lite` to `hive_frame` (STATIC), but all
// EIGHT of them ride the TRAY: un-tilting each one by its alliance's own `captureTheta` about the
// pivot collapses it to a segment at a constant tray-local `w ≈ 6.2` (the floor/roof seam) and
// `|x_local| ≈ 9.5` (the cell's two sides), running the cell's full depth `|v| 10.05 … 20.84` —
// measured off `field-colliders.json`'s own per-instance hulls. A static part could not sit at
// ±30° in a mirrored pair like that. So the GLB bakes them into the frame node at the captured
// pose, and when the tray swings they stay: four 10.5-in tubes 0.37 in wide, left hanging in the
// air. They are exactly the "weird lines".
//
// THE REAL FIX IS ONE LINE IN `PART_RULES`, and it is not made here: re-running `npm run field-cad`
// rewrites the GLBs, `field-colliders.json` and `fieldColliders.gen.ts`, which moves a physics
// static into the kinematic tray. That is a sim change and it is not this lane's. This reparents
// them at load instead, and is a no-op on a future asset that files them correctly (the selector
// simply finds nothing).
//
// THE SELECTOR is world-space and stated as measurements, because the braces are merged into one
// triangle soup per material and there is no name left to ask:
//  - nothing else in a hive FRAME node reaches z 46: the tallest static part is the Goal Pivot
//    Bracket at 45.70, and the raised pair of braces spans 54.27 … 59.85.
//  - the lowered pair spans z 38.83 … 44.40 at |y| 11.85 … 21.11, and at |y| ≥ 11.5 the only other
//    frame part with any material is the A-Frame Leg — a diagonal strut from its foot (|y| 19.07,
//    z 0.22) to the apex (y 0, z 41.40), which at |y| = 11.5 is down at z ≈ 16.
const BRACE_HIGH_Z = 46;
const BRACE_MIN_ABS_Y = 11.5;
const BRACE_MIN_Z = 36;

function isTrayBracePoint(y: number, z: number): boolean {
  return z >= BRACE_HIGH_Z || (Math.abs(y) >= BRACE_MIN_ABS_Y && z >= BRACE_MIN_Z);
}

/**
 * Partitions `mesh`'s triangles by a WORLD-space test on each triangle's centroid: each labelled
 * group comes back as a new geometry already baked into WORLD coordinates, and `mesh` is left
 * with everything `classify` returned `null` for. One pass, not one per label — a second pass
 * over a mesh this has already rewritten would read back what it wrote, which is how the first
 * version of this produced coordinates in the millions.
 *
 * ⚠️ EVERY ATTRIBUTE IS COPIED THROUGH `getX/getY/getZ/getW`, NEVER OFF `.array`. The field GLB
 * uses `KHR_mesh_quantization`, so a position attribute is a NORMALIZED Int16Array and its raw
 * array holds counts, not inches: copying the buffer verbatim into a plain Float32Array is the
 * bug just described, and it is silent until you look at a bounding box.
 */
function partitionTrianglesWorld(
  mesh: THREE.Mesh,
  classify: (cx: number, cy: number, cz: number) => string | null,
): Map<string, THREE.BufferGeometry> {
  const out = new Map<string, THREE.BufferGeometry>();
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position');
  if (!pos) return out;
  mesh.updateWorldMatrix(true, false);
  const v = new THREE.Vector3();
  const worldPos = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    worldPos[i * 3] = v.x;
    worldPos[i * 3 + 1] = v.y;
    worldPos[i * 3 + 2] = v.z;
  }
  const idx = geo.getIndex();
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const groups = new Map<string, number[]>();
  const kept: number[] = [];
  for (let t = 0; t < triCount; t++) {
    const a = idx ? idx.getX(t * 3) : t * 3;
    const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    const cx = (worldPos[a * 3] + worldPos[b * 3] + worldPos[c * 3]) / 3;
    const cy = (worldPos[a * 3 + 1] + worldPos[b * 3 + 1] + worldPos[c * 3 + 1]) / 3;
    const cz = (worldPos[a * 3 + 2] + worldPos[b * 3 + 2] + worldPos[c * 3 + 2]) / 3;
    const label = classify(cx, cy, cz);
    if (label === null) {
      kept.push(a, b, c);
    } else {
      const bucket = groups.get(label);
      if (bucket) bucket.push(a, b, c);
      else groups.set(label, [a, b, c]);
    }
  }
  if (groups.size === 0) return out;

  const names = Object.keys(geo.attributes);
  const get = (src: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number, k: number): number =>
    k === 0 ? src.getX(i) : k === 1 ? src.getY(i) : k === 2 ? src.getZ(i) : src.getW(i);
  const rebuild = (order: number[], world: boolean): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    for (const name of names) {
      const src = geo.getAttribute(name);
      const size = src.itemSize;
      const dst = new Float32Array(order.length * size);
      for (let i = 0; i < order.length; i++) {
        const s = order[i];
        if (world && name === 'position') {
          dst[i * 3] = worldPos[s * 3];
          dst[i * 3 + 1] = worldPos[s * 3 + 1];
          dst[i * 3 + 2] = worldPos[s * 3 + 2];
        } else {
          for (let k = 0; k < size; k++) dst[i * size + k] = get(src, s, k);
        }
      }
      g.setAttribute(name, new THREE.BufferAttribute(dst, size));
    }
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    return g;
  };

  for (const [label, order] of groups) out.set(label, rebuild(order, true));
  const keptGeo = rebuild(kept, false);
  geo.dispose();
  mesh.geometry = keptGeo;
  return out;
}

/**
 * Moves the eight tray braces out of the three hive FRAME nodes and into the alliance's own tray
 * pivot group, so they swing with the cell they belong to. Returns how many triangles moved,
 * which the RENDER lane asserts is not zero on the shipped asset.
 */
function reparentTrayBraces(root: THREE.Object3D, hives: { red: FieldHiveGroup; blue: FieldHiveGroup }): number {
  const pivots: Record<Alliance, number> = {
    red: fieldColliders3d().trays.red.pivot[0],
    blue: fieldColliders3d().trays.blue.pivot[0],
  };
  let moved = 0;
  for (const nodeName of ['hive_red/frame', 'hive_blue/frame', 'hive_shared/frame']) {
    const node = findOptional(root, nodeName);
    if (!node) continue;
    const meshes: THREE.Mesh[] = [];
    node.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes.push(o);
    });
    for (const mesh of meshes) {
      // ONE pass, labelled by alliance — `hive_shared/frame` holds two of red's braces and two of
      // blue's, so the split has to name both in the same sweep. A brace belongs to whichever
      // pivot it is nearer: they sit at the cell's own |x_local| ≈ 9.5, half the hive spacing.
      const parts = partitionTrianglesWorld(mesh, (cx, cy, cz) => {
        if (!isTrayBracePoint(cy, cz)) return null;
        return Math.abs(cx - pivots.red) < Math.abs(cx - pivots.blue) ? 'red' : 'blue';
      });
      for (const [label, geo] of parts) {
        const alliance = label as Alliance;
        // ⚠️ UN-TILT BEFORE PARENTING, or the brace is rotated TWICE. The tray MESH is exported in
        // the pivot-local UN-TILTED frame (`convert.py` rotates every tray point out of the STEP's
        // capture pose, which is why `refTheta` is 0 and `updateBiobuzzField` applies the absolute
        // `hiveTiltAngle`) — but a FRAME node is world-absolute, so these braces come off the disc
        // already sitting at ±30°. Parenting them as-is and then applying the tilt puts them at
        // `captureTheta + hiveTiltAngle`: they swing, at double the angle, which looks worse than
        // the bug being fixed. `world = pivot + Rot_x(captureTheta)·(x, v, w)`, so the inverse is
        // exactly this.
        const tray = fieldColliders3d().trays[alliance];
        const toLocal = new THREE.Matrix4()
          .makeRotationX(-cadCaptureTheta(alliance))
          .multiply(new THREE.Matrix4().makeTranslation(-tray.pivot[0], -tray.pivot[1], -tray.pivot[2]));
        geo.applyMatrix4(toLocal);
        const braces = new THREE.Mesh(geo, mesh.material);
        braces.name = `hive_${alliance}/tray-brace`;
        braces.castShadow = true;
        braces.receiveShadow = true;
        moved += geo.getAttribute('position').count / 3;
        hives[alliance].tray.add(braces);
      }
    }
  }
  return moved;
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

  const braceTris = reparentTrayBraces(root, hives);

  checkTrayFloorAgreement(hives);

  return { floor, walls, tape, sharedFrame, stations, hives, flowers, root, braceTris };
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
 * It RAYCASTS the mesh: a ray dropped down the tray's own local -w axis from inside the cell,
 * and the first surface it meets is compared to `cadCellBox(...).wMin`, the plane the collider's
 * floor slab presents.
 *
 * ⚠️ IT HAS TO BE A RAYCAST, NOT A VERTEX SCAN. A flat CAD face tessellates to its CORNER
 * vertices only — there is not one vertex in the middle of a cell's floor plate — so a "lowest
 * vertex in a window" probe finds the Goal Ribs standing at each END of the cell (they hang
 * 1.5 in below the floor) and reports a ~1-in disagreement that is entirely its own sampling.
 * That is measured, not hypothetical: this check's first version did exactly that, in the app,
 * four times over.
 *
 * `console.warn` only, and only in dev: a wrong floor is a fidelity bug, not a crash, and a
 * player mid-match is not helped by a thrown error.
 */
function checkTrayFloorAgreement(hives: { red: FieldHiveGroup; blue: FieldHiveGroup }): void {
  if (!import.meta.env?.DEV) return;
  const ray = new THREE.Raycaster();
  for (const alliance of ['red', 'blue'] as const) {
    const pivotGroup = hives[alliance].tray;
    pivotGroup.updateWorldMatrix(true, true);
    const toLocal = pivotGroup.matrixWorld.clone().invert();
    for (const sideSign of [1, -1] as const) {
      const box = cadCellBox(alliance, sideSign);
      if (!box) continue;
      const vMid = (box.vMin + box.vMax) / 2;
      // start well inside the cell, off the centreline so the `Basket Base Tube` (a solid rod
      // under the floor at |x| < 0.51) is not what the ray finds first, and drop along local -w.
      const origin = new THREE.Vector3(4, vMid, box.wMin + 6).applyMatrix4(pivotGroup.matrixWorld);
      const down = new THREE.Vector3(0, 0, -1).transformDirection(pivotGroup.matrixWorld).normalize();
      ray.set(origin, down);
      ray.far = 12;
      const hit = ray.intersectObject(pivotGroup, true)[0];
      const side = sideSign > 0 ? 'north' : 'south';
      if (!hit) {
        // eslint-disable-next-line no-console
        console.warn(
          `renderFieldGlb: ${alliance} ${side} cell — nothing under the ray at local (4, ${vMid.toFixed(2)}); ` +
            `the tray mesh may be missing its floor skin.`,
        );
        continue;
      }
      const meshFloorW = hit.point.clone().applyMatrix4(toLocal).z;
      const delta = Math.abs(meshFloorW - box.wMin);
      if (delta > TRAY_FLOOR_TOLERANCE_IN) {
        // eslint-disable-next-line no-console
        console.warn(
          `renderFieldGlb: ${alliance} ${side} cell — the DRAWN floor (local w ${meshFloorW.toFixed(3)}) and the ` +
            `COLLIDER floor (w ${box.wMin.toFixed(3)}) differ by ${delta.toFixed(3)} in, past the ` +
            `${TRAY_FLOOR_TOLERANCE_IN} in tolerance. An element will look like it is floating or sunk. ` +
            `Regenerate with \`npm run field-cad\`; see docs/biobuzz/field-cad-audit.md section 4.`,
        );
      }
    }
  }
}
