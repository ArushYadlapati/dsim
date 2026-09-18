import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GameScene, GameSceneFactory, SceneCamera, SceneFrame } from '../../module';
import type { World } from '../../../types';
import { BB_HALF_X } from '../config';
import { CAMERA_PREFS, getCameraPref, setCameraPref, setViewPref, subscribeCameraPref, type CameraPref } from '../graphics/store';
import { buildBiobuzzField, updateBiobuzzField, type BbFieldHandles } from './renderField';
import { buildBiobuzzElements, updateBiobuzzElements, type BbElements } from './renderElements';
import { buildBiobuzzRobots, updateBiobuzzRobots, type BbRobots } from './renderRobots';
import { buildBiobuzzReticle, updateBiobuzzReticle, type BbReticle } from './renderReticle';
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

/** the letterbox backdrop's current CSS value, read via `--ds-bg` (the token
 * `COLORS.backdrop`/`backdropDark` tracks — `src/config.ts`'s own comment on `backdrop`).
 *
 * ⚠️ READ ON EVERY THEME CHANGE, not once (Day 2 fix). It used to be read once at construction,
 * so toggling light/dark while a 3D view was mounted left the old letterbox behind the field
 * until the scene was torn down and rebuilt — and on the CAD field path the backdrop is not a
 * letterbox at all but the whole surround (`glbFieldToHandles` adds no procedural room), so the
 * stale colour was most of the picture. `BiobuzzScene` now watches `documentElement`'s
 * `data-theme` attribute — the attribute `src/theme.ts`'s `applyTheme` stamps, and the same
 * signal `docs/area/ui.md` tells JS to read instead of `getComputedStyle` — and re-reads this.
 * The ROOM's own greys (`bb-room:floor`/`:backdrop`) stay fixed: they are a gym, their ground is
 * the canvas, category 3 in the theming note. */
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
  private readonly reticle: BbReticle;
  /** the element this scene's canvas was mounted in (`.game-viewport` in the app, `#host` in the
   * preview). The ORBIT pointer listeners live here, not on the canvas: the 2D overlay canvas
   * sits ON TOP of the WebGL one (`game.ts` inserts the scene canvas as `firstChild`), so a
   * mouse press lands on THAT canvas and would never reach this one — but it bubbles to their
   * shared parent, which is this. No `pointer-events` juggling, and no coupling to which canvas
   * happens to be on top. */
  private readonly host: HTMLElement;
  /** the device's camera preference, kept live by `subscribeCameraPref` — read per frame, so it
   * must not be a `localStorage` hit. */
  private cameraPref: CameraPref = getCameraPref();
  private readonly teardown: (() => void)[] = [];
  /** the canvas size the LAST frame was rendered at, for `project` (which reports CSS pixels on
   * the overlay canvas above this one). */
  private lastW = 1;
  private lastH = 1;
  /** scratch for `project`, so a projection allocates nothing per label per frame. */
  private readonly projScratch = new THREE.Vector3();
  /** the camera the LAST frame actually rendered — what the orbit pointer handlers gate on.
   * They cannot re-derive it: the DEVICE preference is only half the answer, the other half is
   * the `camera` the host asked for in the frame, which arrives per frame and nowhere else. A
   * handler that guessed the host's half swallowed every drag whenever the two disagreed. */
  private lastCamera: SceneCamera = 'driver';
  /** orbit drag state (mouse only — a touch drag belongs to the driving controls). */
  private dragging = false;
  private dragX = 0;
  private dragY = 0;

  constructor(canvas: HTMLCanvasElement, field: BbFieldHandles, host: HTMLElement) {
    this.element = canvas;
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // FIDELITY PASS (plan-3d.md §4.4): filmic tone mapping so the key light's highlights roll
    // off instead of clipping, and a shadow map so the field reads as one lit scene rather than
    // flat-shaded shapes. `SceneQuality` (below) is the one place a future graphics-settings
    // panel toggles these — defaults are the "Medium" tier the plan doc's Day 3 section expects.
    //
    // ⚠️ EXPOSURE/FILL RAISED HERE (2026-09-18 playtest: "very dark, shadows don't look good").
    // The Day 1 pass left `toneMappingExposure` at ACES's own neutral 1.0 and a hemisphere fill
    // dim enough (`0x404048` ground, 1.1 intensity) that the tile floor — already a dark albedo
    // (`COLORS.tile` #2c3038, ~0.17 linear) by DESIGN, so the HUD's on-field tokens keep their
    // contrast — rendered as near-black rather than merely dark. 1.2 (within the 1.2–1.5 target)
    // plus a brighter, lighter-grey ground term reads the tiles back close to the 2D canvas's own
    // value; a first pass at 1.35 exposure with a 1.6/2.4 hemi/sun pair over-brightened the
    // opposite way — the alliance-coloured tray panels (`tray_panel_red`/`_blue`) washed out to a
    // pastel pink/lavender under ACES's own highlight roll-off, so both were dialed back one notch.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.shadowMap.enabled = QUALITY.shadows;
    // `PCFSoftShadowMap` is deprecated in this three release (WebGLShadowMap silently substitutes
    // `PCFShadowMap` and warns) — `VSMShadowMap` is the maintained soft-shadow type and, unlike a
    // bare PCF filter, its blur radius (`shadow.radius`, below) is genuinely a BLUR rather than a
    // wider hard-edge sample pattern, which is what "shadows don't look good" was pointing at.
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    this.scene.background = new THREE.Color(readBackdropColor());

    // IMAGE-BASED LIGHTING — a `RoomEnvironment` PMREM as `scene.environment`, not a loaded HDRI
    // (plan-3d.md §4.5's HDRI sets are a Day 3, on-demand fetch; this is the free, zero-bytes-
    // over-the-wire baseline that is what actually makes a metal turret ring or a glossy chassis
    // read as a physical material instead of a flat-shaded polygon — a `MeshStandardMaterial`
    // with no environment has nothing to reflect). Generated ONCE at scene construction, a few KB
    // of GPU-side render-target memory, never touched per frame; every `MeshStandardMaterial`/
    // `MeshPhysicalMaterial` in the scene (robots, the GLB field, the fallback field) picks it up
    // automatically through `scene.environment` with no per-material wiring.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // HEMISPHERE FILL — a lighter, less blue-shifted ground term (`0x4b525c`, up from a near-navy
    // `0x404048`) at a higher intensity so light bounced off the (dark) tile floor still lifts
    // the underside of the robots and the hive trays instead of leaving them silhouetted.
    const hemi = new THREE.HemisphereLight(0xffffff, 0x4b525c, 1.3);
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
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
      // BIAS/NORMAL-BIAS/RADIUS TUNED TOGETHER (2026-09-18 playtest: "shadows don't look good").
      // `bias` alone at a value that kills acne on a flat floor peter-pans a THIN caster (a
      // wall's own frame, a flower pipe) off its own base; `normalBias` (which offsets along the
      // surface normal rather than the light direction) closes that gap without reopening the
      // acne. `radius` is `VSMShadowMap`'s own blur-kernel size in shadow-map texels — a
      // hard-edged shadow under studio-flat lighting is what read as "doesn't look good" as much
      // as the darkness did, and VSM's blur is a real gaussian over the variance map rather than
      // PCF's wider (and slower) sample pattern.
      sun.shadow.bias = -0.0012;
      sun.shadow.normalBias = 0.035;
      sun.shadow.radius = 3;
    }
    this.scene.add(hemi, sun);

    this.field = field;
    this.scene.add(this.field.group);
    this.elements = buildBiobuzzElements();
    this.scene.add(this.elements.group);
    this.robots = buildBiobuzzRobots();
    this.scene.add(this.robots.group);
    this.reticle = buildBiobuzzReticle();
    this.scene.add(this.reticle.group);

    applyShadowFlags(this.field, this.elements, this.robots);

    this.cameras = createCameras();
    this.bindTheme();
    this.bindPrefs();
    this.bindPointer();
    this.bindKeys();
  }

  // ─────────────────────────────────────────────────────────────────── live inputs (Day 2) ──

  /** THE THEME. `applyTheme` stamps `data-theme` on `<html>`, so one `MutationObserver` on that
   * one attribute is the whole subscription — and it catches an OS-driven change too, which
   * `theme.ts` resolves in JS before stamping (CSS never sees `system`). */
  private bindTheme(): void {
    if (typeof MutationObserver !== 'function' || typeof document === 'undefined') return;
    const obs = new MutationObserver(() => {
      (this.scene.background as THREE.Color | null)?.setHex(readBackdropColor());
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.teardown.push(() => obs.disconnect());
  }

  private bindPrefs(): void {
    this.teardown.push(
      subscribeCameraPref((pref) => {
        this.cameraPref = pref;
      }),
    );
  }

  /**
   * ORBIT INPUT — drag to swing the turntable, wheel to zoom. MOUSE ONLY, and only while the
   * orbit camera is the one on screen: a touch drag over the field is the driving control on a
   * phone, and a wheel that swallowed the page's scroll on every other camera would be a
   * regression for a view that has no zoom to give.
   */
  private bindPointer(): void {
    const host = this.host;
    const onMove = (e: PointerEvent): void => {
      if (!this.dragging) return;
      this.cameras.orbitDrag(e.clientX - this.dragX, e.clientY - this.dragY);
      this.dragX = e.clientX;
      this.dragY = e.clientY;
    };
    const endDrag = (): void => {
      this.dragging = false;
    };
    const onDown = (e: PointerEvent): void => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || this.lastCamera !== 'orbit') return;
      this.dragging = true;
      this.dragX = e.clientX;
      this.dragY = e.clientY;
    };
    const onWheel = (e: WheelEvent): void => {
      if (this.lastCamera !== 'orbit') return;
      e.preventDefault();
      this.cameras.orbitZoom(e.deltaY);
    };
    host.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    // `passive: false` or `preventDefault()` is ignored and the page scrolls under the zoom
    host.addEventListener('wheel', onWheel, { passive: false });
    this.teardown.push(() => {
      host.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      host.removeEventListener('wheel', onWheel);
    });
  }

  /**
   * THE CAMERA KEYS (plan §4.3: `t` view, `i`/`o` eye height, plus `c` for the camera itself).
   *
   * ⚠️ HANDLED HERE, ON `window`, RATHER THAN THROUGH `src/input/bindings.ts` — on purpose, and
   * it is the one thing in this lane that should move later. A `KeyAction` there is read by
   * `InputManager` into a `RobotCommand` and acted on by `GameController`, which is another
   * lane's file this pass may not touch; adding one would also mean a `ControlsSection` row and
   * a settings migration for a key whose only effect is on a renderer that may not even be
   * mounted. So the scene owns them while it is mounted and nothing else changes. `t`, `i` and
   * `o` are unbound in `DEFAULT_BINDINGS`; `c` is Chain Reaction's CATALYST, which BIOBUZZ has
   * no mechanism for, so it is free here too — a player who has rebound `c` onto a BIOBUZZ
   * action will cycle the camera as well, which is the cost of not owning the binding table and
   * is why the Day 3 Graphics section should adopt these.
   *
   * `t` only goes 3D → 2D: the listener exists only while a scene is mounted, so nothing here
   * can bring one back. The 2D → 3D half belongs to whoever owns the view toggle (the Day 3
   * Graphics section / the practice setup).
   */
  private bindKeys(): void {
    if (typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      // typing in a chat box, a team-name field or a rebind capture is never a camera command
      if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
      switch (e.key.toLowerCase()) {
        case 't':
          setViewPref('2d');
          break;
        case 'c': {
          const i = CAMERA_PREFS.indexOf(this.cameraPref);
          setCameraPref(CAMERA_PREFS[(i + 1) % CAMERA_PREFS.length]);
          break;
        }
        case 'i':
          this.cameras.nudgeEye(1);
          break;
        case 'o':
          this.cameras.nudgeEye(-1);
          break;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    this.teardown.push(() => window.removeEventListener('keydown', onKey));
  }

  /** the camera actually rendered this frame: the device preference WINS over the one the host
   * asked for, and `'auto'` (the default) is "whatever the host asked for". */
  private resolvedCamera(hostPick: SceneCamera): SceneCamera {
    return this.cameraPref === 'auto' ? hostPick : this.cameraPref;
  }

  render(world: World, frame: SceneFrame): void {
    updateBiobuzzField(this.field, world);
    updateBiobuzzElements(this.elements, world);
    updateBiobuzzRobots(this.robots, world);
    updateBiobuzzReticle(this.reticle, world, frame.localRobotId);
    this.lastW = Math.max(1, frame.width);
    this.lastH = Math.max(1, frame.height);
    this.lastCamera = this.resolvedCamera(frame.camera);
    const camera = this.cameras.update(frame, world, this.lastCamera);
    this.renderer.render(this.scene, camera);
  }

  /**
   * FIELD POINT → CSS PIXELS on the overlay canvas, through the camera this scene last
   * rendered (`GameScene.project`, `games/module.ts` — read its contract first).
   *
   * Projects manually rather than through `Vector3.project()` so a point BEHIND the camera can
   * be rejected: the perspective divide flips the sign of x and y behind the eye, so a robot
   * two feet behind a driver's shoulder projects to a perfectly plausible on-screen position,
   * mirrored. Camera space is checked first (`z > 0` is behind, three.js cameras look down
   * their own −z), then the projection matrix — WHICH ALREADY CARRIES `setViewOffset`, so the
   * NDC that comes out maps to the WHOLE canvas, exactly the pixels the overlay draws in.
   */
  project(x: number, y: number, z: number, out: { x: number; y: number; visible: boolean }): void {
    const cam = this.cameras.active;
    const v = this.projScratch.set(x, y, z);
    v.applyMatrix4(cam.matrixWorldInverse);
    if (v.z > -1e-3) {
      out.visible = false;
      return;
    }
    v.applyMatrix4((cam as THREE.PerspectiveCamera).projectionMatrix);
    out.x = (v.x * 0.5 + 0.5) * this.lastW;
    out.y = (-v.y * 0.5 + 0.5) * this.lastH;
    out.visible = v.x >= -1 && v.x <= 1 && v.y >= -1 && v.y <= 1 && v.z <= 1;
  }

  resize(width: number, height: number, dpr: number): void {
    this.renderer.setPixelRatio(Math.min(dpr, 2));
    this.renderer.setSize(width, height, false);
  }

  dispose(): void {
    for (const off of this.teardown) off();
    this.teardown.length = 0;
    this.reticle.dispose();
    this.scene.environment?.dispose();
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
  // `host` is handed on: the orbit camera's pointer listeners live on it (see the class's own
  // note — the 2D overlay canvas is above this one and would otherwise swallow every press).
  return new BiobuzzScene(canvas, field, host);
};
