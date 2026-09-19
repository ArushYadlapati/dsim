// BIOBUZZ field CAD preview — a throwaway Vite page (shape copied from
// `scripts/scene-preview/`) that loads the real `field.glb`/`field-low.glb` through the actual
// runtime loader (`renderFieldGlb.ts`) — exercising it end to end, not just eyeballing the glb
// in a generic viewer — with an orbit camera, a 144-in tile-seam grid at z = 0, and markers at
// the CONFIG-CONSTANT hive/flower positions, so the CAD geometry's alignment with the sim's own
// frame is visible at a glance. Served with `npx vite scripts/field-cad/preview --port 5179`;
// not built or tested by anything else in the repo.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadFieldGlb, type FieldGroups } from '../../../src/games/biobuzz/scene/renderFieldGlb';
import { createEnvironment } from '../../../src/games/biobuzz/scene/renderEnvironment';
import { SCENE_EXPOSURE, createSceneLights } from '../../../src/games/biobuzz/scene/renderCore';
import { cadCaptureTheta } from '../../../src/games/biobuzz/sim3d/fieldColliders';
import { BB_FLOWERS, BB_HALF_X, BB_HALF_Y, BB_HIVE_X } from '../../../src/games/biobuzz/config';
import type { EnvironmentId } from '../../../src/games/biobuzz/graphics/settings';

// ── URL PARAMS (added 2026-09-19 for the printed-markings + shading pass) ────────────────────
// The page used to be a hand-driven orbit viewer with two lights of its own, which is exactly
// the wrong instrument for "does this black bracket sparkle under the HDRI" — the artifact is a
// SPECULAR one and the preview had no environment map at all. It now renders with the SCENE's
// own renderer settings (`renderCore.ts`: ACES at `SCENE_EXPOSURE`, the hemi/sun pair) and the
// SCENE's own environment (`renderEnvironment.ts`), and takes every knob off the query string so
// a headless capture can ask for one named view:
//
//   ?q=high|low          which LOD to load (default high)
//   &env=room|school-hall|monochrome-studio   image-based lighting (default room; the two HDRIs
//                        are fetched from Poly Haven and fall back to the room offline)
//   &tilt=1              park both trays at their CAD rest pose (±30°). The GLB tray node is
//                        exported UN-tilted, so without this the hive is in a pose the real
//                        field is never in — and the AprilTag clusters face straight down.
//   &cam=<preset>        one of CAM_PRESETS below
//   &eye=x,y,z&at=x,y,z  an explicit camera, if no preset fits
const params = new URLSearchParams(location.search);

/** eye + target, in field inches. Each one frames a thing that had a bug in it. */
const CAM_PRESETS: Record<string, { eye: [number, number, number]; at: [number, number, number] }> = {
  overhead: { eye: [0, -10, 220], at: [0, 0, 0] },
  driver: { eye: [-90, -140, 24], at: [0, 0, 20] },
  /** a hive cell's clear skins, close, from where a driver sees them */
  panel: { eye: [-34, -46, 62], at: [-13, -16, 50] },
  /** the black connectors at the A-frame apex — the "white artifacts" */
  connector: { eye: [-30, -14, 52], at: [-13, 0, 42] },
  /** the same castings tight: `am-5874 A-Frame Top Corner` (x −13.80…−10.51, z 39.49…44.22) and
   * `am-5863 Axle Holder` beside it, both CAD #303030 */
  apex: { eye: [-21, -11, 47], at: [-12.3, 0, 42.4] },
  /** `am-5879-A/B Frame Foot`, the other #303030 casting */
  foot: { eye: [-32, -26, 9], at: [-23.7, -18.3, 1.1] },
  /** the flower's purple top guard and the standoffs under it */
  flower: { eye: [-60, -32, 26], at: [-68.5, -23.4, 22] },
  /** the AprilTag cluster on the underside of the red DOWN cell (needs `&tilt=1`). The plate
   * lands at (−12.74, 11.39, 35.65) facing (0, −0.5, −0.866) once the tray is at its −30° rest
   * pose; the eye is 30 in out along that normal. */
  tags: { eye: [-12.74, -3.6, 9.6], at: [-12.74, 11.39, 35.65] },
  /** and the red UP cell's, which a shooter looks straight into */
  tagsup: { eye: [-12.74, -27.9, 36.7], at: [-12.74, -12.89, 49.67] },
  /** the BIOBUZZ banner on the shared ACM panel */
  banner: { eye: [0, -46, 40], at: [0, -4, 37] },
};

const statusEl = document.getElementById('status')!;
function status(msg: string): void {
  statusEl.textContent = msg;
  console.log('[field-cad-preview]', msg);
}

const host = document.getElementById('host')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
// the SCENE's own colour pipeline — a shading bug that only shows under ACES + an env map is
// invisible in a viewer that has neither
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = SCENE_EXPOSURE;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14171c);

const camera = new THREE.PerspectiveCamera(50, 1, 1, 2000);
camera.position.set(0, -160, 160);
camera.up.set(0, 0, 1); // z-up, matching the sim frame

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 20);
controls.update();

const { hemi, sun } = createSceneLights();
sun.position.set(80, -120, 200);
sun.castShadow = true;
scene.add(hemi, sun);

const environment = createEnvironment(renderer, scene, 0x14171c);
const envId = (params.get('env') ?? 'room') as EnvironmentId;
void environment.apply(envId, (line) => console.warn('[field-cad-preview]', line));

function applyCamera(): void {
  const preset = CAM_PRESETS[params.get('cam') ?? ''];
  const parse = (s: string | null): [number, number, number] | null => {
    const n = (s ?? '').split(',').map(Number);
    return n.length === 3 && n.every(Number.isFinite) ? [n[0], n[1], n[2]] : null;
  };
  const eye = parse(params.get('eye')) ?? preset?.eye;
  const at = parse(params.get('at')) ?? preset?.at;
  if (eye) camera.position.set(eye[0], eye[1], eye[2]);
  if (at) controls.target.set(at[0], at[1], at[2]);
  controls.update();
}
applyCamera();

/** 144-in field grid on z = 0, one line per 24-in tile seam — the same module `config.ts`'s
 * `C.TILE` uses, so this overlay lines up with the CAD floor if (and only if) the axis mapping
 * convert.py fit is correct. */
function buildGrid(): THREE.Object3D {
  const group = new THREE.Group();
  const half = BB_HALF_X; // === BB_HALF_Y, 72
  const grid = new THREE.GridHelper(2 * half, 6, 0xffcc66, 0x556070);
  grid.rotation.x = Math.PI / 2; // GridHelper is authored in the XZ plane; rotate onto sim's XY (z up)
  grid.position.z = 0.05; // a hair above the tiles so it z-fights less
  group.add(grid);
  return group;
}

function marker(color: number, size: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(size, 16, 12), new THREE.MeshBasicMaterial({ color }));
}

function buildMarkers(): THREE.Object3D {
  const group = new THREE.Group();
  const hiveRed = marker(0xff3b3b, 1.5);
  hiveRed.position.set(-BB_HIVE_X, 0, 44);
  group.add(hiveRed);
  const hiveBlue = marker(0x3b7bff, 1.5);
  hiveBlue.position.set(BB_HIVE_X, 0, 44);
  group.add(hiveBlue);
  for (const f of BB_FLOWERS) {
    const m = marker(0xffe066, 1.2);
    m.position.set(f.x, f.y, 21.5);
    group.add(m);
  }
  return group;
}

scene.add(buildGrid());
scene.add(buildMarkers());

function resize(): void {
  const w = host.clientWidth;
  const h = host.clientHeight;
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let currentField: FieldGroups | null = null;
let quality: 'high' | 'low' = 'high';

async function loadQuality(q: 'high' | 'low'): Promise<void> {
  status(`loading field.glb (${q}) via renderFieldGlb.loadFieldGlb()...`);
  if (currentField) {
    scene.remove(currentField.root);
    currentField = null;
  }
  const t0 = performance.now();
  const field = await loadFieldGlb('models/biobuzz', q);
  const ms = (performance.now() - t0).toFixed(0);
  currentField = field;
  scene.add(field.root);
  // the CAD tray node is exported at `refTheta` 0; the REAL rest pose is the capture tilt, and
  // the underside of a cell (where the AprilTag cluster lives) is only visible at it.
  if (params.get('tilt') === '1') {
    for (const a of ['red', 'blue'] as const) field.hives[a].tray.rotation.set(cadCaptureTheta(a), 0, 0);
  }
  status(
    `loaded (${q}) in ${ms}ms — env=${environment.current} markings=` +
      `${field.markings.tagPlates}tag/${field.markings.banners}banner/${field.markings.standoffs}standoff — ` +
      `nodes: floor=${field.floor.name} walls=${field.walls.name} ` +
      `stations=${field.stations ? field.stations.name : 'none'} ` +
      `hives=[${field.hives.red.frame.name},${field.hives.red.tray.name},${field.hives.blue.frame.name},${field.hives.blue.tray.name}] ` +
      `flowers=${field.flowers.map((f) => f.name).join(',')}`,
  );
  (window as any).__fieldGroups = field;
  (window as any).__fieldReady = true;
}

const qualityBtn = document.getElementById('qualityBtn')!;
qualityBtn.addEventListener('click', () => {
  quality = quality === 'high' ? 'low' : 'high';
  qualityBtn.textContent = `Quality: ${quality}`;
  loadQuality(quality).catch((err) => status('LOAD_ERROR: ' + (err instanceof Error ? err.stack ?? err.message : String(err))));
});

const viewBtn = document.getElementById('viewBtn')!;
let overhead = true;
viewBtn.addEventListener('click', () => {
  overhead = !overhead;
  viewBtn.textContent = `View: ${overhead ? 'overhead' : "driver's eye"}`;
  if (overhead) {
    camera.position.set(0, -10, 220);
    controls.target.set(0, 0, 0);
  } else {
    camera.position.set(-90, -140, 24);
    controls.target.set(0, 0, 20);
  }
  controls.update();
});

function frame(): void {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

quality = params.get('q') === 'low' ? 'low' : 'high';
qualityBtn.textContent = `Quality: ${quality}`;
loadQuality(quality).catch((err) => {
  const msg = 'FIELD_CAD_PREVIEW_ERROR: ' + (err instanceof Error ? err.stack ?? err.message : String(err));
  status(msg);
  console.error(err);
});
