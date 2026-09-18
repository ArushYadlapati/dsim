import * as THREE from 'three';
import type { GameScene, GameSceneFactory, SceneFrame } from '../../module';
import type { World } from '../../../types';
import { BB_HALF_X } from '../config';
import { buildBiobuzzField, updateBiobuzzField, type BbFieldHandles } from './renderField';
import { buildBiobuzzElements, updateBiobuzzElements, type BbElements } from './renderElements';
import { buildBiobuzzRobots, updateBiobuzzRobots, type BbRobots } from './renderRobots';
import { createCameras, type BbCameras } from './renderCameras';

/**
 * GRAPHICS SETTINGS — the one object every quality-dependent feature reads (Phase 2 brief).
 * Day 1/2 has no settings UI yet, so this is a plain module constant at sensible defaults (the
 * plan doc's "Medium" tier); the Day 3 Graphics section replaces the literal with a value read
 * from `localStorage`/`GameSettings` without touching any of this file's call sites.
 */
export interface SceneQuality {
  /** shadow map on/off — the single most expensive toggle (an extra depth pass). */
  shadows: boolean;
  /** the `DirectionalLight` shadow map's square resolution. */
  shadowMapSize: number;
  /** which GLB LOD `buildBiobuzzField` requests (`docs/biobuzz/plan-3d.md` §8's two detail
   * levels, `field.glb` / `field-low.glb`) — 'low' when `frame.camera === 'overhead'` on a
   * phone-sized viewport is a reasonable Day 3 wiring, left for that pass; this field just makes
   * the choice selectable today. Has no effect on the constants-built fallback. */
  meshDetail: 'high' | 'low';
}
export const QUALITY: SceneQuality = { shadows: true, shadowMapSize: 2048, meshDetail: 'high' };

/** `castShadow`/`receiveShadow`, set ONCE after the static field/element/robot meshes exist —
 * not per-object at construction, because a GLB-backed field builder (plan-3d.md §8) returns the
 * same `BbFieldHandles` shape but should not have to know this scene's shadow policy itself. The
 * floor and the hive trays/frames RECEIVE (things sit and drive on them); robots, the hive
 * frames/trays and the flowers CAST (the shapes plan-3d.md's Phase-2 brief lists) — the ground
 * pollen/nectar `InstancedMesh`es also cast, since `InstancedMesh` supports it directly. */
function applyShadowFlags(field: BbFieldHandles, elements: BbElements, robots: BbRobots): void {
  field.floor.receiveShadow = true;
  field.walls.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  for (const a of ['red', 'blue'] as const) {
    field.hives[a].traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }
  for (const f of field.flowers) {
    f.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
  }
  elements.pollen.castShadow = true;
  elements.nectar.castShadow = true;
  // robots are built/rebuilt lazily, one group per spec (`renderRobots.ts`'s `specKey`), on a
  // world that has not necessarily spawned any yet at scene construction — `buildRobotGroup`
  // itself sets `castShadow` on every mesh it creates, so there is nothing to do here.
  void robots;
}

/**
 * BIOBUZZ 3D SCENE — the lazily loaded renderer chunk (Day 1, `docs/biobuzz/plan-3d.md` §2.3,
 * §2.5, §4). This is the ONE file `three` is imported by that the rest of the game reaches: the
 * seam is `src/games/biobuzz/index.ts`'s `scene: () => import('./scene/renderScene').then(m =>
 * m.createBiobuzzScene)`, a dynamic `import()` so Vite emits everything under `scene/` as its
 * own chunk, never touched by a player who stays on the 2D view.
 *
 * COORDINATES, EVERYWHERE IN THIS DIRECTORY: field INCHES, z UP — x right, y up-field
 * (audience-away), z up. No axis conversion happens anywhere in `scene/`; every camera's `up`
 * is `(0,0,1)` (`renderCameras.ts`). This mirrors the field frame the rest of BIOBUZZ already
 * uses (`config.ts`'s header: "origin at the centre, +x = audience right, +y = away from the
 * audience"), so a position read straight off `World` needs no transform to become a Three.js
 * position.
 *
 * `frame.alpha` (the interpolation fraction the 2D renderer's fixed-timestep smoothing uses) is
 * NOT read here on Day 1: this scene renders the CURRENT `world` every call, exactly like the 2D
 * canvas path does before the fixed-timestep interpolation was added on top of it. Wiring alpha
 * (blending toward a target world one tick ahead) is Lane C's to add once there is an
 * interpolation source on the client side to blend against — see the report's gotchas.
 */

export class SceneUnsupportedError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`BIOBUZZ 3D scene unsupported: ${reason}`);
    this.name = 'SceneUnsupportedError';
    this.reason = reason;
  }
}

/** literal fallback for the letterbox backdrop colour — `COLORS.backdropDark` (`src/config.ts`),
 * copied rather than imported so this file's only cross-directory import stays the seam types
 * and the shared `World` shape; the CSS token is read at creation instead (see below). */
const BACKDROP_FALLBACK = 0x20262c;

/** the letterbox backdrop's current CSS value, read ONCE at scene creation via `--ds-bg` (the
 * token `COLORS.backdrop`/`backdropDark` tracks — `src/config.ts`'s own comment on `backdrop`).
 * A theme change mid-scene is NOT handled on Day 1: this scene does not watch
 * `documentElement.dataset.theme`, so a light/dark toggle while a 3D view is mounted leaves the
 * old background until the scene is torn down and rebuilt (a route change, a settings reopen).
 * Flagged as a gotcha for the graphics-settings pass (plan-3d.md §4.4) to close. */
function readBackdropColor(): number {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--ds-bg').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return parseInt(raw.slice(1), 16);
  } catch {
    // getComputedStyle can throw on a detached / pre-layout document; the literal covers it
  }
  return BACKDROP_FALLBACK;
}

function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as Partial<THREE.Mesh> & Partial<THREE.InstancedMesh>;
    if (!mesh.geometry) return;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of materials) {
      const map = (m as THREE.MeshStandardMaterial).map;
      if (map) map.dispose();
      m.dispose();
    }
  });
}

class BiobuzzScene implements GameScene {
  readonly element: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly cameras: BbCameras;
  private readonly field: BbFieldHandles;
  private readonly elements: BbElements;
  private readonly robots: BbRobots;

  constructor(canvas: HTMLCanvasElement, field: BbFieldHandles) {
    this.element = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // FIDELITY PASS (plan-3d.md §4.4): filmic tone mapping so the key light's highlights roll
    // off instead of clipping, and a shadow map so the field reads as one lit scene rather than
    // flat-shaded shapes. `SceneQuality` (below) is the one place a future graphics-settings
    // panel toggles these — defaults are the "Medium" tier the plan doc's Day 3 section expects.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = QUALITY.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color(readBackdropColor());

    const hemi = new THREE.HemisphereLight(0xffffff, 0x404048, 1.1);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(60, -80, 140);
    sun.castShadow = QUALITY.shadows;
    if (QUALITY.shadows) {
      sun.shadow.mapSize.set(QUALITY.shadowMapSize, QUALITY.shadowMapSize);
      // the shadow camera is an orthographic frustum sized to cover the field plus the hive's
      // height (43.95 pivot + a cell's own reach) — a frustum sized to the whole 260-in room
      // would waste most of its depth/texel budget on backdrop that never casts anything.
      const cam = sun.shadow.camera;
      const half = BB_HALF_X + 20;
      cam.left = -half;
      cam.right = half;
      cam.top = half;
      cam.bottom = -half;
      cam.near = 1;
      cam.far = 260;
      cam.updateProjectionMatrix();
      sun.shadow.bias = -0.0015;
    }
    this.scene.add(hemi, sun);

    this.field = field;
    this.scene.add(this.field.group);
    this.elements = buildBiobuzzElements();
    this.scene.add(this.elements.group);
    this.robots = buildBiobuzzRobots();
    this.scene.add(this.robots.group);

    applyShadowFlags(this.field, this.elements, this.robots);

    this.cameras = createCameras();
  }

  render(world: World, frame: SceneFrame): void {
    updateBiobuzzField(this.field, world);
    updateBiobuzzElements(this.elements, world);
    updateBiobuzzRobots(this.robots, world);
    const camera = this.cameras.update(frame);
    this.renderer.render(this.scene, camera);
  }

  resize(width: number, height: number, dpr: number): void {
    this.renderer.setPixelRatio(Math.min(dpr, 2));
    this.renderer.setSize(width, height, false);
  }

  dispose(): void {
    disposeObject3D(this.scene);
    this.renderer.dispose();
    this.element.parentElement?.removeChild(this.element);
  }
}

/**
 * Builds a `GameScene` inside `host`. Creates its own `<canvas>` (per the seam contract) and
 * appends it. Requires WebGL2 — probed before anything else touches the canvas — so the caller
 * can fall back to the 2D view on a software renderer or an old browser without this module
 * having thrown mid-construction.
 *
 * ASYNC (the CAD switch-over, `docs/biobuzz/plan-3d.md` §8): `buildBiobuzzField` awaits the GLB
 * (or falls back to the constants field on any failure, logging its own warning) BEFORE the
 * `BiobuzzScene` is constructed, so the scene never exists half-built. `GameSceneFactory`'s
 * return type already allows a `Promise<GameScene>` for exactly this; `game.ts`'s `syncScene`
 * awaits the factory and calls `resize` before the first `render` (its own comment says so),
 * so nothing on the controller side needed to change.
 */
export const createBiobuzzScene: GameSceneFactory = async (host: HTMLElement): Promise<GameScene> => {
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  const gl2 = canvas.getContext('webgl2');
  if (!gl2) throw new SceneUnsupportedError('WebGL2 unavailable');
  const field = await buildBiobuzzField(QUALITY.meshDetail);
  host.appendChild(canvas);
  return new BiobuzzScene(canvas, field);
};
