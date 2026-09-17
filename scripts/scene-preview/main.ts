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

import { initPhysics } from '../../src/sim/physicsEngine';
import { createBiobuzzWorld } from '../../src/games/biobuzz/spawn';
import { biobuzzStep } from '../../src/games/biobuzz/step';
import { DEFAULT_ASSISTS, type RobotSetup } from '../../src/sim/spawn';
import { BB_DEFAULT_SPEC } from '../../src/games/biobuzz/robotConfig';
import { SIM_DT } from '../../src/config';
import { viewAngleOf } from '../../src/sim/field';
import type { Alliance, RobotCommand } from '../../src/types';
import type { SceneCamera } from '../../src/games/module';

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

  let camera: SceneCamera = 'driver';
  let alliance: Alliance = 'red';
  const camBtn = document.getElementById('camBtn')!;
  const allianceBtn = document.getElementById('allianceBtn')!;

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

  status('rendering (stepping the world live)...');
  let tick = 0;
  function frame(): void {
    biobuzzStep(world, SIM_DT, commands);
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
    if (tick % 30 === 0) {
      status(
        `tick ${tick} · camera ${camera} · viewpoint ${alliance} · ` +
          `balls in flight: ${world.balls.filter((b) => b.state.kind === 'flight').length}`,
      );
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch((err: unknown) => {
  const msg = 'SCENE_PREVIEW_ERROR: ' + (err instanceof Error ? (err.stack ?? err.message) : String(err));
  status(msg);
  console.error(err);
});
