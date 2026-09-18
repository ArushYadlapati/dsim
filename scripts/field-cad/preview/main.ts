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
import { BB_FLOWERS, BB_HALF_X, BB_HALF_Y, BB_HIVE_X } from '../../../src/games/biobuzz/config';

const statusEl = document.getElementById('status')!;
function status(msg: string): void {
  statusEl.textContent = msg;
  console.log('[field-cad-preview]', msg);
}

const host = document.getElementById('host')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14171c);

const camera = new THREE.PerspectiveCamera(50, 1, 1, 2000);
camera.position.set(0, -160, 160);
camera.up.set(0, 0, 1); // z-up, matching the sim frame

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 20);
controls.update();

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(80, -120, 200);
sun.castShadow = true;
scene.add(sun);

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
  status(
    `loaded (${q}) in ${ms}ms — nodes: floor=${field.floor.name} walls=${field.walls.name} ` +
      `stations=${field.stations ? field.stations.name : 'none'} ` +
      `hives=[${field.hives.red.frame.name},${field.hives.red.tray.name},${field.hives.blue.frame.name},${field.hives.blue.tray.name}] ` +
      `flowers=${field.flowers.map((f) => f.name).join(',')}`,
  );
  (window as any).__fieldGroups = field;
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

loadQuality('high').catch((err) => {
  const msg = 'FIELD_CAD_PREVIEW_ERROR: ' + (err instanceof Error ? err.stack ?? err.message : String(err));
  status(msg);
  console.error(err);
});
