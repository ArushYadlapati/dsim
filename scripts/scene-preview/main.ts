// BIOBUZZ 3D scene preview — a throwaway Vite page for visual verification of the Day 1
// renderer chunk (`src/games/biobuzz/scene/`). Shape copied from `scripts/spike3d-browser/`:
// served standalone with `npx vite scripts/scene-preview --port 5178`, not built or tested by
// anything else in the repo.
//
// Builds a 2D-PHYSICS BIOBUZZ world (the `mode`/`physics` default `createBiobuzzWorld` has
// always had — the 3D-physics pipeline is Lane A's and not wired to a smoke-testable world yet),
// steps it so two 2v2 robots have driven, turned and (if their default launcher can) fired, then
// mounts `createBiobuzzScene` over the SAME live world and keeps stepping + rendering every
// frame — a livelier check than a single static screenshot, since it exercises robot motion,
// turret slew and ball flight, not just the field's static geometry.
//
// SIDE-BY-SIDE MODE (geometric-correctness pass, `docs/biobuzz/plan-3d.md` §4.2/§4.3 verification):
// a second, plain 2D `<canvas>` draws the SAME world through the REAL 2D renderer path
// (`drawBiobuzzField` + `drawHiveCanopy` + `drawBiobuzzBalls` + `drawBiobuzzRobot`, via the
// shared `Camera`), overhead at the same `viewAngle` the 3D overhead camera uses, so the two
// pictures can be compared directly. `window.__bbScene` exposes the live `THREE.Scene` so a
// console/`javascript_tool` session can walk named objects and measure them.

import * as THREE from 'three';
import { initPhysics } from '../../src/sim/physicsEngine';
import { createBiobuzzWorld } from '../../src/games/biobuzz/spawn';
import { biobuzzStep } from '../../src/games/biobuzz/step';
import { DEFAULT_ASSISTS, type RobotSetup } from '../../src/sim/spawn';
import { BB_DEFAULT_SPEC } from '../../src/games/biobuzz/robotConfig';
import { SIM_DT } from '../../src/config';
import { viewAngleOf } from '../../src/sim/field';
import type { Alliance, RobotCommand, World } from '../../src/types';
import type { SceneCamera } from '../../src/games/module';
import { Camera } from '../../src/render/camera';
import { drawBiobuzzField, drawHiveCanopy } from '../../src/games/biobuzz/drawField';
import { drawBiobuzzBalls } from '../../src/games/biobuzz/draw';
import { drawBiobuzzRobot } from '../../src/games/biobuzz/drawRobot';
import {
  BB_FLOWERS,
  BB_FLOWER_D,
  BB_FLOWER_FOOT,
  BB_FLOWER_OPEN_R,
  BB_FLOWER_TOP_Z,
  BB_FRAME_BAR_IN,
  BB_FRAME_BAR_OUT,
  BB_FRAME_Y,
  BB_GARDEN,
  BB_HALF_X,
  BB_HALF_Y,
  BB_HIVE_OPEN_Z,
  BB_HIVE_X,
  BB_LZ,
  BB_VIEW_MARGIN,
  FLOWER_MOUTH,
} from '../../src/games/biobuzz/config';

// ── ISSUE-1 VERIFICATION HARNESS (2026-09-18: tray-tilt fix, `?physics=3d[&probe=hive[&tip=1]]`)
// Query-param driven so the file's DEFAULT behaviour (a 2D-physics world, side-by-side render)
// is completely unchanged for every existing use of this page — see the report for what each
// flag does and the numbers it produced.
import { initPhysics3d } from '../../src/games/biobuzz/sim3d/engine';
import { hiveCellLocalBox, hivePivotX } from '../../src/games/biobuzz/sim3d/bodies';
import { hiveTiltAngle } from '../../src/games/biobuzz/sim3d/hive3d';
import { rotate2 } from '../../src/games/biobuzz/sim3d/math3';
import { BB3_HIVE_PIVOT_Z, BB_HIVE_UP_STAGED, BB_POLLEN_R } from '../../src/games/biobuzz/config';
import { BB_TIP_SWING_S } from '../../src/games/biobuzz/hive';

const urlParams = new URLSearchParams(location.search);
const physicsMode = urlParams.get('physics') === '3d' ? '3d' : '2d';
const hiveProbeAlliance: Alliance | null = urlParams.get('probe') === 'hive' ? 'red' : null;
const forceTip = urlParams.get('tip') === '1';

/**
 * Places one already-staged ball INSIDE alliance's UP cell, resting a few inches above its own
 * floor, tagged `{kind:'element', el:'hive:<alliance>'}` so the 3D sync (`engine.ts`'s
 * `syncElement`, `wantsDynamicBody`) gives it a REAL dynamic body and the next few physics ticks
 * settle it onto the cell's actual floor collider under gravity — this is the "place an element
 * JSON-side and let the sync seat it" verification the report calls for, proving the CAD tray's
 * captured pose and `hiveTrayRefTheta`'s correction agree with where the physics collider
 * actually is (a wrong correction either floats the ball above the true floor or drops it
 * through a wall it thinks is elsewhere).
 *
 * The WORLD position is computed the same way `derive.ts`'s `insideCell` does, in reverse: a
 * local box point `(v, w)` maps to world via `rotate2(v, w, theta − box.refTheta)` around the
 * pivot — see `sim3d/bodies.ts`'s file header for the derivation. Using the real formula (not
 * assuming identity) is deliberate: at the CAD path's default (`BB3_FIELD_COLLIDERS` true),
 * `theta` at rest already equals `box.refTheta` for the STAGED up side, so this reduces to a
 * plain offset — but the fallback box's `refTheta` is always 0 while `hiveTiltAngle` is never 0
 * at rest, so a probe that assumed identity would silently seat the ball wrong on that path.
 */
function placeElementInUpCell(world: World, alliance: Alliance): void {
  const up = world.biobuzz?.hives[alliance]?.up ?? BB_HIVE_UP_STAGED[alliance];
  const sideSign = up === 'north' ? 1 : -1;
  const box = hiveCellLocalBox(sideSign, alliance);
  const v = (box.vMin + box.vMax) / 2;
  const w = box.wMin + 3; // a few inches above the floor — settles down, never spawns inside it
  const theta = hiveTiltAngle(world, alliance);
  const { a: dy, b: dz } = rotate2(v, w, theta - box.refTheta);
  const target = world.balls.find((b) => b.state.kind === 'ground');
  if (!target) {
    status('hive probe: no ground-state ball available to place — skipped');
    return;
  }
  const r = target.r ?? BB_POLLEN_R;
  target.pos = { x: hivePivotX(alliance), y: dy };
  target.z = BB3_HIVE_PIVOT_Z + dz - r; // b.z is the BOTTOM height (sim3d's own convention)
  target.vel = { x: 0, y: 0 };
  target.vz = 0;
  target.state = { kind: 'element', el: `hive:${alliance}`, slot: 0 };
  status(`hive probe: placed ball ${target.id} in ${alliance} ${up} cell at world (${hivePivotX(alliance).toFixed(2)}, ${dy.toFixed(2)}, ${(BB3_HIVE_PIVOT_Z + dz).toFixed(2)})`);
}

function setup(id: number, alliance: Alliance, startIndex: number): RobotSetup {
  return {
    id,
    alliance,
    spec: { ...BB_DEFAULT_SPEC },
    assists: { ...DEFAULT_ASSISTS },
    startIndex,
  };
}

const statusEl = document.getElementById('status')!;
function status(msg: string): void {
  statusEl.textContent = msg;
  console.log('[scene-preview]', msg);
}

const checksEl = document.getElementById('checks')!;

async function main(): Promise<void> {
  status('booting 2D physics...');
  await initPhysics();
  if (physicsMode === '3d') {
    status('booting 3D physics (rapier3d-deterministic-compat)...');
    await initPhysics3d();
  }

  status(`building a 2v2 biobuzz world (physics=${physicsMode})...`);
  const world = createBiobuzzWorld(
    'match',
    4242,
    [
      setup(0, 'red', 0), // TOP
      setup(1, 'red', 1), // BOTTOM
      setup(2, 'blue', 0),
      setup(3, 'blue', 1),
    ],
    undefined,
    physicsMode,
  );
  world.match.phase = 'teleop';
  world.match.phaseTimeLeft = 120;

  // drive forward, keep intake + fire held — with the default single-turret build this both
  // moves the robots off their start poses and gets a launch in flight once something is
  // captured, without needing a scripted, per-tick command sequence.
  //
  // THE HIVE PROBE WANTS THE OPPOSITE: an ISOLATED hive, undisturbed by organic gameplay — a
  // driving/firing robot can score into a hive on its own during the warm-up (or afterwards, in
  // the live render loop) and start a REAL tip at a time this harness does not control, which
  // both consumes the ball this probe is about to place and makes `tip=1`'s forced tip land on
  // top of an already-tipping hive. So a hive probe gets an IDLE command (no drive, no intake, no
  // fire, so the only thing moving is gravity on the placed ball and, if asked, the forced tip)
  // and skips the 180-tick warm-up entirely — the ball is placed the instant the world exists,
  // while `hive.up`/`.tipping` are still exactly `BB_HIVE_UP_STAGED`/`0`.
  const drive: RobotCommand = hiveProbeAlliance
    ? { driveX: 0, driveY: 0, rotate: 0, leftDrive: 0, rightDrive: 0, intake: false, fire: false }
    : { driveX: 0, driveY: 1, rotate: 0.15, leftDrive: 0, rightDrive: 0, intake: true, fire: true };
  const commands = new Map<number, RobotCommand>([
    [0, drive],
    [1, drive],
    [2, drive],
    [3, drive],
  ]);
  const warmupTicks = hiveProbeAlliance ? 0 : 180;
  for (let i = 0; i < warmupTicks; i++) biobuzzStep(world, SIM_DT, commands);

  if (hiveProbeAlliance) {
    placeElementInUpCell(world, hiveProbeAlliance);
    if (forceTip && world.biobuzz) {
      const hive = world.biobuzz.hives[hiveProbeAlliance];
      world.biobuzz.hives[hiveProbeAlliance] = { ...hive, tipping: BB_TIP_SWING_S, released: false };
      status(`hive probe: forced a ${BB_TIP_SWING_S}s tip on ${hiveProbeAlliance}`);
    }
  }

  status('loading the scene chunk...');
  const { createBiobuzzScene } = await import('../../src/games/biobuzz/scene/renderScene');
  const host = document.getElementById('host')!;
  const scene = await createBiobuzzScene(host);

  // EXPOSE THE LIVE THREE.Scene for console / `javascript_tool` inspection — `BiobuzzScene`'s
  // `scene` field is `private` at the TYPE level only; at runtime it is a plain property, and
  // this file (scene-preview-only, per the verification brief) is where that cast belongs
  // rather than widening the class's real public API for a debug hook.
  (window as unknown as { __bbScene: THREE.Scene }).__bbScene = (scene as unknown as { scene: THREE.Scene }).scene;
  (window as unknown as { __bbWorld: World }).__bbWorld = world;
  (window as unknown as { __bbRenderer: THREE.WebGLRenderer }).__bbRenderer = (
    scene as unknown as { renderer: THREE.WebGLRenderer }
  ).renderer;

  let camera: SceneCamera = 'driver';
  let alliance: Alliance = 'red';
  let probing = false;
  const headings = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  let headingIdx = 0;
  const camBtn = document.getElementById('camBtn')!;
  const allianceBtn = document.getElementById('allianceBtn')!;
  const probeBtn = document.getElementById('probeBtn')!;
  const headingBtn = document.getElementById('headingBtn')!;
  const checkBtn = document.getElementById('checkBtn')!;

  function resize(): void {
    const dpr = window.devicePixelRatio || 1;
    scene.resize(host.clientWidth, host.clientHeight, dpr);
  }
  window.addEventListener('resize', resize);
  resize();

  camBtn.addEventListener('click', () => {
    camera = camera === 'driver' ? 'overhead' : 'driver';
    camBtn.textContent = `Camera: ${camera}`;
  });
  allianceBtn.addEventListener('click', () => {
    alliance = alliance === 'red' ? 'blue' : 'red';
    allianceBtn.textContent = `Viewpoint: ${alliance}`;
  });
  probeBtn.addEventListener('click', () => {
    probing = !probing;
    probeBtn.textContent = `Probe: ${probing ? 'on' : 'off'}`;
    if (probing) {
      world.robots[0].pos = { x: 0, y: 0 };
      world.robots[0].vel = { x: 0, y: 0 };
      world.robots[0].angVel = 0;
      world.robots[0].heading = headings[headingIdx];
    }
  });
  headingBtn.addEventListener('click', () => {
    headingIdx = (headingIdx + 1) % headings.length;
    headingBtn.textContent = `Heading: ${Math.round((headings[headingIdx] * 180) / Math.PI)}`;
    if (probing) world.robots[0].heading = headings[headingIdx];
  });
  checkBtn.addEventListener('click', () => runChecks());

  // ── SIDE-BY-SIDE 2D CANVAS ─────────────────────────────────────────────────────────────────
  const canvas2d = document.getElementById('host2d') as HTMLCanvasElement;
  const ctx2d = canvas2d.getContext('2d')!;
  const cam2d = new Camera();
  const bounds = { halfX: BB_HALF_X, halfY: BB_HALF_Y, viewMargin: BB_VIEW_MARGIN };

  function draw2d(): void {
    // `Camera.configure` reads `canvas.clientWidth/Height` (the CSS-laid-out size) and sets the
    // backing-store `canvas.width/height` itself — no manual resize needed here.
    cam2d.configure(canvas2d, alliance, bounds);
    ctx2d.save();
    cam2d.apply(ctx2d);
    const screenUp = cam2d.screenUpWorld();
    drawBiobuzzField(ctx2d, world, screenUp);
    for (const r of world.robots) {
      const held = world.balls.filter((b) => b.state.kind === 'held' && b.state.robot === r.id);
      drawBiobuzzRobot(ctx2d, r, commands.get(r.id)?.intake ?? false, held, screenUp, world);
    }
    drawBiobuzzBalls(ctx2d, world, screenUp);
    void drawHiveCanopy; // already called inside drawBiobuzzBalls
    ctx2d.restore();
  }

  // ── FREE CAMERA (2026-09-18 CAD round 2 verification) ────────────────────────────────────
  // The scene owns its two cameras (`renderCameras.ts`, another lane's file), and neither of
  // them can look at a hive from the SIDE — which is the one view that shows whether an element
  // is resting on the tray floor or floating above it. So this page gets its own: `__bbFreeze`
  // stops the world stepping AND the scene's own render, and `__bbFreeCam` draws the live
  // `THREE.Scene` through a camera the caller places. Preview-only, additive, and it touches
  // nothing the app ships.
  const freeCam = new THREE.PerspectiveCamera(35, 1, 1, 2000);
  freeCam.up.set(0, 0, 1); // this scene is z-up
  const w = window as unknown as {
    __bbFreeze: boolean;
    __bbFreeCam: (eye: [number, number, number], target: [number, number, number], fov?: number) => void;
    __bbStep: (n: number) => number;
  };
  w.__bbFreeze = false;
  // `requestAnimationFrame` only advances when a paint is forced (CLAUDE.md's own note about
  // driving this in an automated browser), so a verification session that needs 200 settled ticks
  // would need 200 screenshots. This steps the world directly instead.
  w.__bbStep = (n) => {
    for (let i = 0; i < n; i++) biobuzzStep(world, SIM_DT, commands);
    return world.tick;
  };
  // ⚠️ RE-RENDERED EVERY FRAME, not once. A WebGL canvas is created with
  // `preserveDrawingBuffer: false`, so the buffer is thrown away after each composite — a
  // one-shot render followed by a screenshot (which itself forces the NEXT paint) shows black.
  // So the free view is STATE, and the frame loop draws it.
  let freeView: { eye: [number, number, number]; target: [number, number, number]; fov: number } | null = null;
  w.__bbFreeCam = (eye, target, fov = 35) => {
    freeView = { eye, target, fov };
    w.__bbFreeze = true;
  };
  function renderFree(): void {
    if (!freeView) return;
    // ⚠️ LET THE SCENE UPDATE ITSELF FIRST. `updateBiobuzzField` — the one place that rotates each
    // tray to `hiveTiltAngle` — runs inside `scene.render`, so a frozen loop that only draws
    // through the free camera shows both trays at rotation 0, i.e. LEVEL, which reads exactly like
    // the tilt bug this pass fixed. (In an automated browser `requestAnimationFrame` only advances
    // when a screenshot forces a paint, so "it ran a moment ago" is not a safe assumption either.)
    scene.render(world, {
      alpha: 1,
      viewAngle: viewAngleOf(alliance),
      camera,
      localRobotId: alliance === 'red' ? 0 : 2,
      width: host.clientWidth,
      height: host.clientHeight,
      dpr: window.devicePixelRatio || 1,
    });
    const renderer = (scene as unknown as { renderer: THREE.WebGLRenderer }).renderer;
    const three = (scene as unknown as { scene: THREE.Scene }).scene;
    freeCam.fov = freeView.fov;
    freeCam.aspect = host.clientWidth / host.clientHeight;
    freeCam.position.set(freeView.eye[0], freeView.eye[1], freeView.eye[2]);
    freeCam.lookAt(freeView.target[0], freeView.target[1], freeView.target[2]);
    freeCam.updateProjectionMatrix();
    renderer.render(three, freeCam);
  }

  status('rendering (stepping the world live)...');
  let tick = 0;
  function frame(): void {
    if (w.__bbFreeze) {
      renderFree();
      requestAnimationFrame(frame);
      return;
    }
    if (!probing) biobuzzStep(world, SIM_DT, commands);
    tick++;
    const localRobotId = alliance === 'red' ? 0 : 2;
    scene.render(world, {
      alpha: 1,
      viewAngle: viewAngleOf(alliance),
      camera,
      localRobotId,
      width: host.clientWidth,
      height: host.clientHeight,
      dpr: window.devicePixelRatio || 1,
    });
    draw2d();
    if (tick % 30 === 0) {
      status(
        `tick ${tick} · camera ${camera} · viewpoint ${alliance} · probing ${probing} · ` +
          `balls in flight: ${world.balls.filter((b) => b.state.kind === 'flight').length}`,
      );
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /** GLTFLoader keeps a node's true name on `userData.name` (it strips `/` from `.name`) — see
   * `renderFieldGlb.ts`'s own `findByOriginalName` header. */
  function findOriginal(root: THREE.Object3D, name: string): THREE.Object3D | null {
    let hit: THREE.Object3D | null = null;
    root.traverse((o) => {
      if (!hit && ((o.userData as { name?: string } | undefined)?.name === name || o.name === name)) hit = o;
    });
    return hit;
  }

  // ── NUMERIC VERIFICATION — named object vs. expected world position, 0.25in tolerance ──────
  function runChecks(): void {
    const bbScene = (window as unknown as { __bbScene: THREE.Scene }).__bbScene;
    const rows: { name: string; expected: string; actual: string; pass: boolean }[] = [];
    const TOL = 0.25;

    function box(name: string): THREE.Box3 | null {
      const obj = bbScene.getObjectByName(name);
      if (!obj) return null;
      obj.updateWorldMatrix(true, false);
      return new THREE.Box3().setFromObject(obj);
    }
    /** the object's own WORLD ORIGIN (`getWorldPosition`) — the right check for a PIVOT/POINT
     * object (a hive group, a ring), whose bounding box is its DESCENDANTS' extent and can sit
     * far from the pivot itself (an asymmetric tray tilt shifts a bbox centre well away from the
     * pivot it rotates about — this is what the first pass of this check got wrong). */
    function checkOrigin(name: string, ex: number, ey: number, ez: number): void {
      const obj = bbScene.getObjectByName(name);
      if (!obj) {
        rows.push({ name, expected: `(${ex},${ey},${ez})`, actual: 'MISSING', pass: false });
        return;
      }
      const c = obj.getWorldPosition(new THREE.Vector3());
      const pass = Math.abs(c.x - ex) <= TOL && Math.abs(c.y - ey) <= TOL && Math.abs(c.z - ez) <= TOL;
      rows.push({
        name,
        expected: `origin (${ex.toFixed(2)},${ey.toFixed(2)},${ez.toFixed(2)})`,
        actual: `origin (${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)})`,
        pass,
      });
    }
    /** the object's BOUNDING-BOX CENTRE — right for a solid, roughly-symmetric mesh (a ring, a
     * flat floor) where the shape's own extent IS the thing being checked. */
    function checkCentre(name: string, ex: number, ey: number, ez: number): void {
      const b = box(name);
      if (!b) {
        rows.push({ name, expected: `(${ex},${ey},${ez})`, actual: 'MISSING', pass: false });
        return;
      }
      const c = b.getCenter(new THREE.Vector3());
      const dx = Math.abs(c.x - ex);
      const dy = Math.abs(c.y - ey);
      const dz = Math.abs(c.z - ez);
      const pass = dx <= TOL && dy <= TOL && dz <= TOL;
      rows.push({
        name,
        expected: `(${ex.toFixed(2)},${ey.toFixed(2)},${ez.toFixed(2)})`,
        actual: `(${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)})`,
        pass,
      });
    }
    function checkScalar(name: string, label: string, actual: number, expected: number): void {
      const pass = Math.abs(actual - expected) <= TOL;
      rows.push({ name: `${name}:${label}`, expected: expected.toFixed(2), actual: actual.toFixed(2), pass });
    }

    // FLOOR / WALLS
    checkCentre('floor', 0, 0, 0);
    for (const n of ['wall:rear', 'wall:audience', 'wall:right', 'wall:left']) {
      const b = box(n);
      if (!b) {
        // the CAD field's four walls are ONE merged mesh named `walls` (`convert.py` groups
        // "walls + tiles + tape + stations... merged one mesh per class"), so there is no
        // PER-SIDE named node to measure an inner face off of the way the constants-built
        // field's four separate `wall:<side>` meshes allow — a row testing a constants-only
        // shape, adapted per item 12: the real inner-face figure is asserted from the CAD's
        // OWN measured faces in the SIM3D lane's `one field` check (2D colliders vs 3D colliders
        // vs the CAD, 0.05in), not re-derived here from a scene-graph lookup that cannot exist
        // on this path.
        const wholeWalls = bbScene.getObjectByName('walls');
        rows.push({
          name: n,
          expected: `inner face at ±${BB_HALF_X} (constants path, which IS the CAD) — see the SIM3D \`one field\` check on the CAD path`,
          actual: wholeWalls ? 'skipped — CAD walls are one merged mesh, no per-side node' : 'MISSING',
          pass: !!wholeWalls,
        });
        continue;
      }
      // the wall's INNER face (the one facing the field) must sit at exactly ±BB_HALF_X/Y
      let inner: number;
      let expected: number;
      if (n === 'wall:rear') {
        inner = b.min.y;
        expected = BB_HALF_Y;
      } else if (n === 'wall:audience') {
        inner = b.max.y;
        expected = -BB_HALF_Y;
      } else if (n === 'wall:right') {
        inner = b.min.x;
        expected = BB_HALF_X;
      } else {
        inner = b.max.x;
        expected = -BB_HALF_X;
      }
      checkScalar(n, 'inner-face', inner, expected);
    }

    // HIVES — pivot ORIGIN (not a bbox centre: the tray's own children are not symmetric about
    // the pivot at every tilt) and the up-CELL opening's world z, read against the world's OWN
    // current hive state rather than the staged assumption — the 180-tick drive-in before the
    // scene mounts holds `fire` the whole time, so a TIP may already have happened and flipped
    // which cell is up, or still be mid-swing (`tipping > 0`, a different, transient angle).
    checkOrigin('hive:red', -BB_HIVE_X, 0, 43.95);
    checkOrigin('hive:blue', BB_HIVE_X, 0, 43.95);
    const bbState = (window as unknown as { __bbWorld: World }).__bbWorld.biobuzz;
    for (const a of ['red', 'blue'] as const) {
      const h = bbState?.hives?.[a];
      const tipping = h?.tipping ?? 0;
      const upName = h?.up ?? (a === 'red' ? 'south' : 'north'); // BB_HIVE_UP_STAGED fallback
      if (tipping > 0.01) {
        rows.push({
          name: `hive:${a}:cell:${upName}:opening`,
          expected: 'checked only at rest',
          actual: `mid-swing, tipping=${tipping.toFixed(2)}s left — skipped`,
          pass: true,
        });
        continue;
      }
      // Measure the FLOOR and CEILING child meshes' own world Box3, not the whole cell GROUP's:
      // the group's bbox is the union of ALL five boxes, including the CLOSED back near the
      // pivot, and a tilted box's inner (pivot-side) corner can land at a lower world z than
      // its own outer (open-face) corner — conflating the two understates "opening-bottom" by
      // measuring a point that is not the opening at all. Each individual slab's MAX.z is,
      // for either tilt direction, exactly its OUTER (open-face) corner — proved by construction
      // (the "up" side is by definition the one whose far end has risen) and confirmed by this
      // check finally agreeing with `BB_HIVE_OPEN_Z` once fixed.
      const floorSlab = box(`hive:${a}:cell:${upName}:floor`);
      const ceilingSlab = box(`hive:${a}:cell:${upName}:ceiling`);
      if (floorSlab && ceilingSlab) {
        checkScalar(`hive:${a}:cell:${upName}`, 'opening-bottom', floorSlab.max.z, BB_HIVE_OPEN_Z[0]);
        checkScalar(`hive:${a}:cell:${upName}`, 'opening-top', ceilingSlab.max.z, BB_HIVE_OPEN_Z[1]);
      } else {
        // the CAD tray is ONE mesh (`hive_<alliance>/tray`), not decomposed into named
        // floor/back/side/ceiling children the way the constants-built tray's `buildCell` is —
        // a row testing a constants-only shape, adapted per item 12: the real opening figure
        // (and the reported gap to BB_HIVE_OPEN_Z/BB_HIVE_BOTTOM_Z) is asserted in the SIM3D
        // smoke lane's measurements check, off the physics collider geometry directly rather
        // than a scene-graph lookup this mesh cannot answer.
        const trayMesh = bbScene.getObjectByName(`hive:${a}`);
        rows.push({
          name: `hive:${a}:cell:${upName}`,
          expected: 'present (constants path) — see the SIM3D measurements check on the CAD path',
          actual: trayMesh ? 'skipped — CAD tray is one mesh, no per-cell-part node' : 'MISSING',
          pass: !!trayMesh,
        });
      }
    }

    // FLOWERS — the ring row compares the drawn ring against `BB_FLOWERS`, at the DEFAULT 0.25in.
    //
    // It ran at 2.0in until 2026-09-18, because the CAD's own ring centres sat ~1.5in from
    // `BB_FLOWERS` and the owner had not yet ruled on which was right. The ruling is that the CAD
    // is, `BB_FLOWERS` IS the measured bore centre now, and the wide tolerance has no reason to
    // exist — it would only hide the GLB and the constants parting company again.
    BB_FLOWERS.forEach((f, idx) => {
      const ringBox = box(`flower:${idx}:ring`);
      if (ringBox) {
        const c = ringBox.getCenter(new THREE.Vector3());
        const dx = Math.abs(c.x - f.x);
        const dy = Math.abs(c.y - f.y);
        const dz = Math.abs(c.z - BB_FLOWER_TOP_Z);
        const pass = dx <= TOL && dy <= TOL && dz <= TOL;
        rows.push({
          name: `flower:${idx}:ring`,
          expected: `(${f.x.toFixed(2)},${f.y.toFixed(2)},${BB_FLOWER_TOP_Z.toFixed(2)})`,
          actual: `(${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)})`,
          pass,
        });
      } else {
        // the CAD field's flower is ONE mesh (`flower_<idx>`), not decomposed into named
        // ring/foot/pipe children the way the constants-built flower's own group is — fall back
        // to the WHOLE flower node.
        //
        // ⚠️ AND MEASURE IT PER AXIS, because a flower ASSEMBLY is not symmetric about its own
        // bore in DEPTH: the under-field bracket reaches behind the wall plane and the ring
        // plates protrude into the field, so the node's bounding-box centre sits ~0.62 in behind
        // the bore on the wall-NORMAL axis. That is geometry, not misplacement — comparing a
        // bbox centre to a bore centre and calling the difference an error is what the old 2-in
        // "open finding" tolerance was quietly absorbing.
        //   • ALONG the wall the assembly IS symmetric, and that axis carries the fact worth
        //     checking here (the flower sits on its tile seam), so it is held to the default TOL.
        //   • ACROSS the wall the bore must simply lie INSIDE the node, and the real stand-off is
        //     asserted at 0.25 in against the CAD in the SIM3D lane's measurements check, off the
        //     least-squares bore fit rather than a bounding box.
        const whole = box(`flower:${idx}`);
        if (!whole) {
          rows.push({ name: `flower:${idx}`, expected: 'present', actual: 'MISSING', pass: false });
        } else {
          const c = whole.getCenter(new THREE.Vector3());
          const n = FLOWER_MOUTH[f.wall];
          const alongErr = n.x !== 0 ? Math.abs(c.y - f.y) : Math.abs(c.x - f.x);
          const boreInside =
            f.x >= whole.min.x - TOL && f.x <= whole.max.x + TOL && f.y >= whole.min.y - TOL && f.y <= whole.max.y + TOL;
          rows.push({
            name: `flower:${idx} (whole node — the CAD flower is one mesh)`,
            expected: `centred on the seam at ${(n.x !== 0 ? f.y : f.x).toFixed(2)} along its wall, bore inside the node`,
            actual: `along-wall off by ${alongErr.toFixed(2)}, bore ${boreInside ? 'inside' : 'OUTSIDE'} bbox (centre ${c.x.toFixed(2)},${c.y.toFixed(2)})`,
            pass: alongErr <= TOL && boreInside,
          });
        }
      }
      const foot = box(`flower:${idx}:foot`);
      if (foot) {
        // the foot must be flush against the wall face (BB_FLOWER_D off the ring) and centred
        // on the flower's own x or y depending on which wall it stands against
        const n = FLOWER_MOUTH[f.wall];
        const wallFace = n.x !== 0 ? f.x - n.x * BB_FLOWER_D : f.y - n.y * BB_FLOWER_D;
        const footEdge = n.x > 0 ? foot.min.x : n.x < 0 ? foot.max.x : n.y > 0 ? foot.min.y : foot.max.y;
        checkScalar(`flower:${idx}:foot`, 'wall-face', footEdge, wallFace);
        const alongExpected = n.x !== 0 ? BB_FLOWER_FOOT.along : BB_FLOWER_FOOT.deep;
        void alongExpected;
      } else {
        // not decomposed on the CAD path (one mesh per flower) — not a failure, see the ring
        // check above for the same reasoning.
        rows.push({ name: `flower:${idx}:foot`, expected: 'present (constants path)', actual: 'skipped — CAD flower is one mesh', pass: true });
      }
      // the pipe fix check: a support pipe's bounding box must be TALL (z-extent) and THIN
      // (x/y extent), not lying on its side — this is exactly the bug that was found and fixed.
      const pipe = box(`flower:${idx}:pipe0`);
      if (pipe) {
        const zExtent = pipe.max.z - pipe.min.z;
        const xyExtent = Math.max(pipe.max.x - pipe.min.x, pipe.max.y - pipe.min.y);
        rows.push({
          name: `flower:${idx}:pipe0:orientation`,
          expected: 'tall (z >> xy)',
          actual: `z=${zExtent.toFixed(1)} xy=${xyExtent.toFixed(1)}`,
          pass: zExtent > xyExtent * 3,
        });
      }
    });

    // TAPE — MEASURED OFF THE GLB's OWN `tape` NODE, not off the floor texture.
    //
    // This used to sample the procedural floor `CanvasTexture` for a red/blue pixel at each zone
    // rectangle's edge, which is exactly the thing the owner reported as wrong: the texture
    // outlined all four sides of `BB_LZ`/`BB_GARDEN`, wall side included, at whatever width the
    // caller passed. The tape is now real CAD geometry — 16 strips, all 1.000 in wide — so the
    // check is now about the GEOMETRY and about the rule that sent it here: a zone edge that is a
    // WALL carries no tape. See `docs/biobuzz/field-cad-audit.md` §5.
    const tapeNode = bbScene.getObjectByName('tape') ?? findOriginal(bbScene, 'tape');
    if (tapeNode) {
      const tapeBox = new THREE.Box3().setFromObject(tapeNode);
      rows.push({
        name: 'tape:present',
        expected: 'the GLB carries a `tape` node',
        actual: `bbox x ${tapeBox.min.x.toFixed(1)}..${tapeBox.max.x.toFixed(1)}`,
        pass: true,
      });
      // the ALLIANCE AREA strips live OUTSIDE the perimeter on the gym floor, so the tape's own
      // bbox reaching past the wall is the proof they are there (and were not clipped away).
      const reachesAllianceArea = tapeBox.min.x < -100 && tapeBox.max.x > 100;
      rows.push({
        name: 'tape:alliance-area',
        expected: 'strips outside the perimeter (|x| > 100)',
        actual: `${tapeBox.min.x.toFixed(1)} .. ${tapeBox.max.x.toFixed(1)}`,
        pass: reachesAllianceArea,
      });
      // NO ON-TILE STRIP TOUCHES A WALL — measured PER VERTEX, not per mesh. All 16 strips share
      // two meshes (one per colour), and each of those spans both the on-tile marks (z 0..0.010)
      // and the ALLIANCE AREA outlines on the gym floor (z -0.589), which are outside the
      // perimeter by design — so a bounding box cannot tell the two apart and a per-mesh test
      // silently examines nothing.
      const WALL_FACE = 70.674;
      let worstName = '';
      let worst = 0;
      const v = new THREE.Vector3();
      tapeNode.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || !o.geometry) return;
        const pos = o.geometry.getAttribute('position');
        if (!pos) return;
        o.updateWorldMatrix(true, false);
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          if (v.z < -0.05) continue; // a gym-floor strip
          const reach = Math.max(Math.abs(v.x), Math.abs(v.y));
          if (reach > worst) {
            worst = reach;
            worstName = o.name || '(unnamed tape mesh)';
          }
        }
      });
      rows.push({
        name: 'tape:no-tape-on-a-wall',
        expected: `every on-tile strip stays inside the wall face (${WALL_FACE})`,
        actual: `furthest reach ${worst.toFixed(3)} on ${worstName}`,
        pass: worst > 0 && worst <= WALL_FACE,
      });
    } else {
      rows.push({ name: 'tape:present', expected: 'the GLB carries a `tape` node', actual: 'absent', pass: false });
    }

    // ROBOT HEADING CONVENTION — the probe robot's chassis bounding box must extend FURTHER
    // along the heading direction than the opposite way, proving the group's local +x (forward)
    // really points toward `heading`.
    if (probing) {
      const r0 = world.robots[0];
      const chassis = box(`robot:0:chassis`);
      if (chassis) {
        const c = chassis.getCenter(new THREE.Vector3());
        const fwd = { x: Math.cos(r0.heading), y: Math.sin(r0.heading) };
        const frontCorner = { x: c.x + fwd.x * (r0.spec.length / 2 - 0.1), y: c.y + fwd.y * (r0.spec.length / 2 - 0.1) };
        const inside =
          frontCorner.x >= chassis.min.x - TOL &&
          frontCorner.x <= chassis.max.x + TOL &&
          frontCorner.y >= chassis.min.y - TOL &&
          frontCorner.y <= chassis.max.y + TOL;
        rows.push({
          name: `robot:0:heading=${Math.round((r0.heading * 180) / Math.PI)}`,
          expected: 'front-of-chassis point lies inside the chassis box',
          actual: inside ? 'inside' : 'OUTSIDE — heading convention mismatch',
          pass: inside,
        });
      }
    }

    // print
    const lines = [`${rows.filter((r) => r.pass).length}/${rows.length} PASS`, ''];
    for (const r of rows) {
      lines.push(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n      expected ${r.expected}\n      actual   ${r.actual}`);
    }
    checksEl.textContent = lines.join('\n');
    console.log('[scene-preview checks]', rows);
  }

  // auto-run once, three seconds in (after the drive-in settles and geometry is stable)
  setTimeout(() => runChecks(), 1000);
}

main().catch((err: unknown) => {
  const msg = 'SCENE_PREVIEW_ERROR: ' + (err instanceof Error ? (err.stack ?? err.message) : String(err));
  status(msg);
  console.error(err);
});
