// Day 0 physics spike for BIOBUZZ's 3D plan (docs/biobuzz/plan-3d.md #10).
// Throwaway diagnostic: never wired into `npm test`, `npm run build`, or any game.
// Run: npx tsx scripts/spike3d.ts [--ticks=3600] [--seed=1]
//
// Builds a z-up world in inches (gravity -386 in/s^2), four robots, 56 elements, and two
// dynamic see-saw trays on revolute joints, then steps it and reports timing + a positional
// hash so two runs (and, separately, a browser run) can be compared bit-for-bit.

interface SpikeSummary {
  ticks: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  hash: number;
  bodies: number;
  sleeping: number;
  trayAngleEndDeg: [number, number];
  spheresBelowFloor: number;
  spheresOutside: number;
  notes: string[];
}

export interface SpikeOpts {
  ticks: number;
  seed: number;
}

// mulberry32 - deterministic, seeded, used only to jitter initial sphere positions a little
// so the grid isn't perfectly axis-aligned (matches the seeded-PRNG discipline src/sim/ uses,
// even though this script lives outside src/ and isn't subject to that guard).
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a 32-bit, fed tick numbers and rounded positions as their fixed-decimal text.
function makeHasher() {
  let h = 0x811c9dc5 >>> 0;
  function byte(b: number) {
    h ^= b & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  function str(s: string) {
    for (let i = 0; i < s.length; i++) byte(s.charCodeAt(i));
  }
  return {
    feedNum(n: number) {
      str(n.toFixed(4));
      byte(0x1f); // separator
    },
    value() {
      return h >>> 0;
    },
  };
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export async function runSpike(opts: SpikeOpts): Promise<SpikeSummary> {
  const notes: string[] = [];
  const RAPIER: any = await import('@dimforge/rapier3d-deterministic-compat');
  await RAPIER.init();

  const world = new RAPIER.World({ x: 0, y: 0, z: -386 });
  world.integrationParameters.lengthUnit = 10; // matches the 2D bridge's inches convention

  const rand = mulberry32(opts.seed);

  const bodyOrder: any[] = []; // creation order, for the hash
  const dynamicBodies: any[] = []; // for the sleeping count

  function addStatic(hx: number, hy: number, hz: number, x: number, y: number, z: number, friction = 0.5) {
    const desc = RAPIER.RigidBodyDesc.newStatic().setTranslation(x, y, z);
    const body = world.createRigidBody(desc);
    const cd = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(friction);
    world.createCollider(cd, body);
    bodyOrder.push(body);
    return body;
  }

  // ---- statics: floor, four walls, two frame base bars ----
  addStatic(200, 200, 10, 0, 0, -10); // floor, top surface at z=0
  addStatic(10, 82, 20, 72, 0, 20); // wall +x
  addStatic(10, 82, 20, -72, 0, 20); // wall -x
  addStatic(82, 10, 20, 0, 72, 20); // wall +y
  addStatic(82, 10, 20, 0, -72, 20); // wall -y
  addStatic(0.5, 19.4, 0.5, 24.5, 0, 0.5); // frame base bar, x in [24,25]
  addStatic(0.5, 19.4, 0.5, -24.5, 0, 0.5); // frame base bar, x in [-25,-24]

  // ---- four robots, 18x18x18in, yaw-only, ~30 lb ----
  const robotPositions: [number, number][] = [
    [-40, -40],
    [40, -40],
    [-40, 40],
    [40, 40],
  ];
  const robots: any[] = [];
  for (const [x, y] of robotPositions) {
    const desc = RAPIER.RigidBodyDesc.newDynamic()
      .setTranslation(x, y, 9)
      .enabledRotations(false, false, true)
      .setLinearDamping(0.5)
      .setAngularDamping(2);
    const body = world.createRigidBody(desc);
    body.setAdditionalMass(30, true); // mass ~= 30 lb-equivalent, exactly rather than via density
    const cd = RAPIER.ColliderDesc.cuboid(9, 9, 9).setFriction(0.45).setRestitution(0);
    world.createCollider(cd, body);
    robots.push(body);
    bodyOrder.push(body);
    dynamicBodies.push(body);
  }

  // ---- two dynamic see-saw trays, one per hive ----
  const HIVE_PX = 12.75;
  const HIVE_Z = 43.95;
  const START_ANGLE_DEG = 30;
  const START_ANGLE_RAD = (START_ANGLE_DEG * Math.PI) / 180;
  const LIMIT_RAD = 0.5236; // ~30 deg
  const half = START_ANGLE_RAD / 2;
  const startQuat = { x: Math.sin(half), y: 0, z: 0, w: Math.cos(half) };

  type TrayRig = { body: any; px: number };
  const trays: TrayRig[] = [];

  for (const px of [-HIVE_PX, HIVE_PX]) {
    // fixed hinge anchor, exactly at the pivot
    const hingeDesc = RAPIER.RigidBodyDesc.newStatic().setTranslation(px, 0, HIVE_Z);
    const hinge = world.createRigidBody(hingeDesc);
    bodyOrder.push(hinge);

    // tray body, positioned AT the pivot so local == world for its own colliders' anchor math
    const trayDesc = RAPIER.RigidBodyDesc.newDynamic()
      .setTranslation(px, 0, HIVE_Z)
      .setRotation(startQuat)
      .setAngularDamping(3)
      .setLinearDamping(1);
    const tray = world.createRigidBody(trayDesc);

    // bar, half 1 x 21.45 x 1, along y
    world.createCollider(RAPIER.ColliderDesc.cuboid(1, 21.45, 1).setDensity(1).setFriction(0.5), tray);

    // two cells at y = +-15.44 along the bar; s = sign, north (+y) is "up" at +30deg
    for (const s of [1, -1]) {
      const cellY = s * 15.44;
      const innerY = cellY - s * 6.52; // wall toward the pivot
      // floor
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(10, 6.02, 0.5).setTranslation(0, cellY, 1.5).setDensity(1).setFriction(0.6),
        tray,
      );
      // back wall (toward the pivot)
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(10, 0.5, 7).setTranslation(0, innerY, 9).setDensity(1).setFriction(0.5),
        tray,
      );
      // side walls
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.5, 6.02, 7).setTranslation(10.5, cellY, 9).setDensity(1).setFriction(0.5),
        tray,
      );
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.5, 6.02, 7).setTranslation(-10.5, cellY, 9).setDensity(1).setFriction(0.5),
        tray,
      );
      // roof
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(10, 6.02, 0.5).setTranslation(0, cellY, 16.5).setDensity(1).setFriction(0.5),
        tray,
      );
      // outer face (y = cellY + s*6.52) deliberately open
    }

    // ballast: a small dense mass on the south (-y) side, below the bar, so the empty tray
    // is biased toward one stop rather than balancing exactly on the pivot.
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(1, 1, 1).setTranslation(0, -18, -3).setDensity(5).setFriction(0.5),
      tray,
    );

    const jointData = RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    jointData.limitsEnabled = true;
    jointData.limits = [-LIMIT_RAD, LIMIT_RAD];
    const joint = world.createImpulseJoint(jointData, hinge, tray, true);
    if (typeof joint.setLimits === 'function') {
      joint.setLimits(-LIMIT_RAD, LIMIT_RAD);
    } else {
      notes.push('joint.setLimits not available on returned joint instance');
    }

    bodyOrder.push(tray);
    dynamicBodies.push(tray);
    trays.push({ body: tray, px });
  }

  // ---- 56 elements: 40 pollen r1.4, 16 nectar r1.8, mass 0.2 each ----
  type SphereRig = { body: any; r: number };
  const spheres: SphereRig[] = [];

  function addSphere(r: number, x: number, y: number, z: number) {
    const desc = RAPIER.RigidBodyDesc.newDynamic().setTranslation(x, y, z).setCcdEnabled(true);
    const body = world.createRigidBody(desc);
    body.setAdditionalMass(0.2, true);
    const cd = RAPIER.ColliderDesc.ball(r).setFriction(0.6).setRestitution(0.45);
    world.createCollider(cd, body);
    bodyOrder.push(body);
    dynamicBodies.push(body);
    spheres.push({ body, r });
  }

  // 6 per hive (3 pollen + 3 nectar), in two rows so the cell carries load without exceeding
  // its 14in interior height.
  for (const px of [-HIVE_PX, HIVE_PX]) {
    const s = 1; // stage them in the (currently up) north cell, local y = +15.44
    const cellY = s * 15.44;
    const cosA = Math.cos(START_ANGLE_RAD);
    const sinA = Math.sin(START_ANGLE_RAD);
    const toWorld = (ly: number, lz: number): [number, number] => {
      // rotate (y,z) about x by START_ANGLE_RAD, then add the pivot
      const y = ly * cosA - lz * sinA;
      const z = ly * sinA + lz * cosA;
      return [y, z];
    };
    const xs = [-5, 0, 5];
    for (let i = 0; i < 3; i++) {
      const [wy1, wz1] = toWorld(cellY, 2 + 1.4 + 0.5);
      addSphere(1.4, px + xs[i], wy1, HIVE_Z + wz1);
    }
    for (let i = 0; i < 3; i++) {
      const [wy2, wz2] = toWorld(cellY, 2 + 1.4 * 2 + 1.8 + 1.0);
      addSphere(1.8, px + xs[i], wy2, HIVE_Z + wz2);
    }
  }

  // 44 on a deterministic floor grid between the robots (well inside +-72, clear of +-40 robots)
  let placed = 0;
  outer: for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      if (placed >= 44) break outer;
      const isNectar = placed >= 34;
      const r = isNectar ? 1.8 : 1.4;
      const x = -32 + col * 8 + (rand() - 0.5) * 0.6;
      const y = -32 + row * 8 + (rand() - 0.5) * 0.6;
      addSphere(r, x, y, r + 0.1);
      placed++;
    }
  }

  // ---- scripted input: push robot 0 toward the nearest tray for 600 ticks ----
  const r0 = robotPositions[0];
  const nearestPx = Math.abs(r0[0] - -HIVE_PX) < Math.abs(r0[0] - HIVE_PX) ? -HIVE_PX : HIVE_PX;
  const dx = nearestPx - r0[0];
  const dy = 0 - r0[1];
  const dlen = Math.hypot(dx, dy) || 1;
  const pushX = (dx / dlen) * 800;
  const pushY = (dy / dlen) * 800;

  // ---- step loop ----
  const hasher = makeHasher();
  const stepTimes: number[] = [];
  const hasPerf = typeof performance !== 'undefined' && typeof performance.now === 'function';
  const now = () => (hasPerf ? performance.now() : Date.now());

  function checkpoint(tick: number) {
    hasher.feedNum(tick);
    for (const b of bodyOrder) {
      const t = b.translation();
      hasher.feedNum(t.x);
      hasher.feedNum(t.y);
      hasher.feedNum(t.z);
    }
  }

  for (let tick = 1; tick <= opts.ticks; tick++) {
    if (tick <= 600) {
      robots[0].addForce({ x: pushX, y: pushY, z: 0 }, true);
    }
    const t0 = now();
    world.step();
    const t1 = now();
    stepTimes.push(t1 - t0);
    if (tick % 60 === 0 || tick === opts.ticks) {
      checkpoint(tick);
    }
  }

  const timed = stepTimes.length > 60 ? stepTimes.slice(60) : stepTimes;
  if (stepTimes.length <= 60) notes.push('ticks <= 60: timing stats include warmup, not excluded');

  const spheresBelowFloor = spheres.filter(({ body, r }) => body.translation().z < r - 0.5).length;
  const spheresOutside = spheres.filter(({ body }) => {
    const t = body.translation();
    return Math.abs(t.x) > 72 || Math.abs(t.y) > 72;
  }).length;
  const sleeping = dynamicBodies.filter((b) => b.isSleeping()).length;

  function trayAngleDeg(tray: any): number {
    const q = tray.rotation();
    return (2 * Math.atan2(q.x, q.w) * 180) / Math.PI;
  }

  return {
    ticks: opts.ticks,
    medianMs: percentile(timed, 50),
    p95Ms: percentile(timed, 95),
    maxMs: timed.length ? Math.max(...timed) : 0,
    hash: hasher.value(),
    bodies: bodyOrder.length,
    sleeping,
    trayAngleEndDeg: [trayAngleDeg(trays[0].body), trayAngleDeg(trays[1].body)],
    spheresBelowFloor,
    spheresOutside,
    notes,
  };
}

function parseArgs(argv: string[]): SpikeOpts {
  let ticks = 3600;
  let seed = 1;
  for (const a of argv) {
    const m = a.match(/^--(ticks|seed)=(\d+)$/);
    if (m) {
      if (m[1] === 'ticks') ticks = parseInt(m[2], 10);
      else seed = parseInt(m[2], 10);
    }
  }
  return { ticks, seed };
}

// Auto-run only when this file is the Node/tsx entry point, never when a bundler imports
// `runSpike` from it (the browser page copies the logic instead; see scripts/spike3d-browser/).
const isDirectRun =
  typeof process !== 'undefined' &&
  !!process.versions?.node &&
  !!process.argv[1] &&
  /spike3d\.ts$/.test(process.argv[1].replace(/\\/g, '/'));

if (isDirectRun) {
  const opts = parseArgs(process.argv.slice(2));
  runSpike(opts)
    .then((summary) => {
      console.log(JSON.stringify(summary));
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
