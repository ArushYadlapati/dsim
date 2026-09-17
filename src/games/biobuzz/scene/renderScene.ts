import * as THREE from 'three';
import type { GameScene, GameSceneFactory, SceneFrame } from '../../module';
import type { World } from '../../../types';
import { buildBiobuzzField, updateBiobuzzField, type BbFieldHandles } from './renderField';
import { buildBiobuzzElements, updateBiobuzzElements, type BbElements } from './renderElements';
import { buildBiobuzzRobots, updateBiobuzzRobots, type BbRobots } from './renderRobots';
import { createCameras, type BbCameras } from './renderCameras';

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

  constructor(canvas: HTMLCanvasElement) {
    this.element = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(readBackdropColor());

    const hemi = new THREE.HemisphereLight(0xffffff, 0x404048, 1.1);
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(60, -80, 140);
    sun.castShadow = false;
    this.scene.add(hemi, sun);

    this.field = buildBiobuzzField();
    this.scene.add(this.field.group);
    this.elements = buildBiobuzzElements();
    this.scene.add(this.elements.group);
    this.robots = buildBiobuzzRobots();
    this.scene.add(this.robots.group);

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
 */
export const createBiobuzzScene: GameSceneFactory = (host: HTMLElement): GameScene => {
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  const gl2 = canvas.getContext('webgl2');
  if (!gl2) throw new SceneUnsupportedError('WebGL2 unavailable');
  host.appendChild(canvas);
  return new BiobuzzScene(canvas);
};
