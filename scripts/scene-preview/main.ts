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

  status('building a 2v2 biobuzz world...');
  const world = createBiobuzzWorld('match', 4242, [
    setup(0, 'red', 0), // TOP
    setup(1, 'red', 1), // BOTTOM
    setup(2, 'blue', 0),
    setup(3, 'blue', 1),
  ]);
  world.match.phase = 'teleop';
  world.match.phaseTimeLeft = 120;

  // drive forward, keep intake + fire held — with the default single-turret build this both
  // moves the robots off their start poses and gets a launch in flight once something is
  // captured, without needing a scripted, per-tick command sequence.
  const drive: RobotCommand = {
    driveX: 0,
    driveY: 1,
    rotate: 0.15,
    leftDrive: 0,
    rightDrive: 0,
    intake: true,
    fire: true,
  };
  const commands = new Map<number, RobotCommand>([
    [0, drive],
    [1, drive],
    [2, drive],
    [3, drive],
  ]);
  for (let i = 0; i < 180; i++) biobuzzStep(world, SIM_DT, commands);

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

  status('rendering (stepping the world live)...');
  let tick = 0;
  function frame(): void {
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
        // OWN trimesh vertices (`cadWallExtents`) in the SIM3D smoke lane's measurements check,
        // not re-derived here from a scene-graph lookup that cannot exist on this path.
        const wholeWalls = bbScene.getObjectByName('walls');
        rows.push({
          name: n,
          expected: 'inner face at ±72 (constants path) — see the SIM3D measurements check on the CAD path',
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

    // FLOWERS — the ring position row STAYS ON THE CONSTANTS (`f.x, f.y` from `BB_FLOWERS`), per
    // item 12, but with the OPEN FINDING's tolerance rather than the default 0.25in: a memory
    // note from the owner found the CAD's own ring centres sit ~1.4-1.5in from `BB_FLOWERS` (e.g.
    // F1 config (-69.46,-24.00) vs CAD (-68.04,-23.39), confirmed again by the SIM3D smoke lane's
    // measurements check) — do NOT move the constants, do NOT nudge the GLB; this wider,
    // documented tolerance is the whole adaptation.
    const FLOWER_OPEN_FINDING_TOL = 2.0;
    BB_FLOWERS.forEach((f, idx) => {
      const ringBox = box(`flower:${idx}:ring`);
      if (ringBox) {
        const c = ringBox.getCenter(new THREE.Vector3());
        const dx = Math.abs(c.x - f.x);
        const dy = Math.abs(c.y - f.y);
        const dz = Math.abs(c.z - BB_FLOWER_TOP_Z);
        const pass = dx <= FLOWER_OPEN_FINDING_TOL && dy <= FLOWER_OPEN_FINDING_TOL && dz <= FLOWER_OPEN_FINDING_TOL;
        rows.push({
          name: `flower:${idx}:ring (open finding, ${FLOWER_OPEN_FINDING_TOL}in tolerance)`,
          expected: `(${f.x.toFixed(2)},${f.y.toFixed(2)},${BB_FLOWER_TOP_Z.toFixed(2)})`,
          actual: `(${c.x.toFixed(2)},${c.y.toFixed(2)},${c.z.toFixed(2)})`,
          pass,
        });
      } else {
        // the CAD field's flower is ONE mesh (`flower_<idx>`), not decomposed into named
        // ring/foot/pipe children the way the constants-built flower's own group is — fall back
        // to the WHOLE flower node's own position, same tolerance, same reasoning.
        const whole = box(`flower:${idx}`);
        if (!whole) {
          rows.push({ name: `flower:${idx}`, expected: 'present', actual: 'MISSING', pass: false });
        } else {
          const c = whole.getCenter(new THREE.Vector3());
          const pass = Math.hypot(c.x - f.x, c.y - f.y) <= FLOWER_OPEN_FINDING_TOL;
          rows.push({
            name: `flower:${idx} (whole node, CAD is one mesh; open finding, ${FLOWER_OPEN_FINDING_TOL}in tolerance)`,
            expected: `(${f.x.toFixed(2)},${f.y.toFixed(2)})`,
            actual: `(${c.x.toFixed(2)},${c.y.toFixed(2)})`,
            pass,
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

    // LZ/GARDEN — sampled from the floor texture's own source canvas (there is no separate
    // mesh for tape; it is baked into `floor`'s CanvasTexture), not a Box3 measurement.
    const floorMesh = bbScene.getObjectByName('floor') as THREE.Mesh | undefined;
    const map = (floorMesh?.material as THREE.MeshStandardMaterial | undefined)?.map as THREE.CanvasTexture | undefined;
    const srcCanvas = map?.image as HTMLCanvasElement | undefined;
    if (srcCanvas) {
      const texCtx = srcCanvas.getContext('2d')!;
      const scale = srcCanvas.width / (2 * BB_HALF_X);
      const toPx = (x: number, y: number): [number, number] => [Math.round((x + BB_HALF_X) * scale), Math.round((BB_HALF_Y - y) * scale)];
      function sampleIsRed(x: number, y: number): boolean {
        const [px, py] = toPx(x, y);
        const [r, g, b] = texCtx.getImageData(Math.max(0, Math.min(srcCanvas.width - 1, px)), Math.max(0, Math.min(srcCanvas.height - 1, py)), 1, 1).data;
        return r > 150 && g < 100 && b < 100;
      }
      function sampleIsBlue(x: number, y: number): boolean {
        const [px, py] = toPx(x, y);
        const [r, g, b] = texCtx.getImageData(Math.max(0, Math.min(srcCanvas.width - 1, px)), Math.max(0, Math.min(srcCanvas.height - 1, py)), 1, 1).data;
        return b > 150 && r < 100;
      }
      const redLzMidX = (BB_LZ.red.x0 + BB_LZ.red.x1) / 2;
      const redLzTapeY = BB_LZ.red.y1; // top edge of the rect — tape line
      const okRedLz = sampleIsRed(redLzMidX, redLzTapeY);
      rows.push({ name: 'tape:lz:red', expected: 'red pixel at LZ tape edge', actual: okRedLz ? 'red' : 'not red', pass: okRedLz });
      const blueLzMidX = (BB_LZ.blue.x0 + BB_LZ.blue.x1) / 2;
      const blueLzTapeY = BB_LZ.blue.y0;
      const okBlueLz = sampleIsBlue(blueLzMidX, blueLzTapeY);
      rows.push({ name: 'tape:lz:blue', expected: 'blue pixel at LZ tape edge', actual: okBlueLz ? 'blue' : 'not blue', pass: okBlueLz });
      const redGardenMidX = (BB_GARDEN.red.x0 + BB_GARDEN.red.x1) / 2;
      const okRedGarden = sampleIsRed(redGardenMidX, BB_GARDEN.red.y0);
      rows.push({ name: 'tape:garden:red', expected: 'red pixel at garden edge', actual: okRedGarden ? 'red' : 'not red', pass: okRedGarden });
    } else {
      rows.push({ name: 'floor-texture', expected: 'CanvasTexture source readable', actual: 'unavailable', pass: false });
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
