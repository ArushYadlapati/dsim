import * as THREE from 'three';
import type { RobotSpec, RobotState, World } from '../../../types';
import { BB3_HEIGHT_DEFAULT, bbHopperCap } from '../config';
import { bbIsTurreted, bbLauncherOf, bbLiftOf, type BbLauncherSpec } from '../mechs';
import { bbMouths } from '../robot';
import { bbShooterEdgeOf, EDGE_ANGLE, edgeGeom, turretLocal, turretRadius, type BbMountPos } from '../mounts';

/**
 * BIOBUZZ 3D SCENE — generated robots (Day 1, `docs/biobuzz/plan-3d.md` §3.3, §4.2).
 *
 * One `THREE.Group` per robot id, built from the spec ONCE and rebuilt only when the spec
 * identity changes (`specKey`, below) — the chassis box (`length × width × heightIn`), a nose
 * marker, four wheels, a sweeper bar per mounted intake edge (from `bbMouths`, the SAME rects
 * the 2D sprite and the capture logic use), and a turret + barrel when the launcher is turreted.
 * Posed every frame at `(pos.x, pos.y, r.z ?? 0)` — `RobotState.z` is the chassis BOTTOM height
 * (plan §2.4/§3.3; absent reads 0, exactly right for a 2D-physics world) — with yaw `heading`.
 *
 * HEADING CONVENTION: `RobotState.heading` is field-frame radians, 0 = +x, CCW positive
 * (`types.ts`), and the robot's own local frame is +x forward / +y left (`mounts.ts`'s header).
 * A `Group.rotation.z = heading` maps local +x to world `(cos, sin)`, which is exactly that
 * convention — no sign flip needed, unlike the DECODE bird's-eye mirroring gotcha in CLAUDE.md
 * (that one is a SCREEN-space schematic; this is a plain world-frame yaw).
 */

const BODY_MAT_CACHE = new Map<string, THREE.MeshStandardMaterial>();
function solidMat(color: string, roughness = 0.6, metalness = 0.1): THREE.MeshStandardMaterial {
  const key = `${color}|${roughness}|${metalness}`;
  let m = BODY_MAT_CACHE.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    BODY_MAT_CACHE.set(key, m);
  }
  return m;
}

/** every mesh this module builds casts a shadow; nothing here receives one back onto itself
 * (the field floor/hive/flowers do that — see `renderScene.ts`'s `applyShadowFlags`). One call
 * per part rather than a post-hoc traversal, so a group rebuilt mid-match (`specKey` changing)
 * never has to be re-walked to pick the flag back up. */
function cast<T extends THREE.Object3D>(o: T): T {
  o.castShadow = true;
  return o;
}

const RED = '#ef4444';
const BLUE = '#3b82f6';
const NOSE = '#e5e7eb';
const WHEEL = '#1f242c';
const TURRET_RING = '#39414f';
const TURRET_BARREL = '#5c6676';
const SWEEPER = '#12161c';
const DUMPER_BUCKET = '#8a94a3';

/**
 * A CHAMFERED CHASSIS BOX — a `Shape` with rounded PLAN corners (the vertical edges), extruded
 * with a small bevel top and bottom (the horizontal edges), so a robot reads as a milled part
 * rather than a bare `BoxGeometry` slab. Cheap and dependency-free: `ExtrudeGeometry` is core
 * Three.js, no `RoundedBoxGeometry` import needed. Geometry is centred on Z (spans
 * `[-height/2, height/2]`) so the existing `chassis.position.z = height/2` placement is
 * unchanged. Cached per (length, width, height) — `specKey` already gates a rebuild to a real
 * geometry change, so the cache mostly saves repeat builds across ROBOTS sharing a size, not
 * across frames.
 */
const CHASSIS_GEO_CACHE = new Map<string, THREE.ExtrudeGeometry>();
function chassisGeometry(length: number, width: number, height: number): THREE.ExtrudeGeometry {
  const key = `${length}|${width}|${height}`;
  const cached = CHASSIS_GEO_CACHE.get(key);
  if (cached) return cached;
  const hl = length / 2;
  const hw = width / 2;
  const r = Math.min(1.2, length * 0.08, width * 0.08);
  const shape = new THREE.Shape();
  shape.moveTo(-hl + r, -hw);
  shape.lineTo(hl - r, -hw);
  shape.quadraticCurveTo(hl, -hw, hl, -hw + r);
  shape.lineTo(hl, hw - r);
  shape.quadraticCurveTo(hl, hw, hl - r, hw);
  shape.lineTo(-hl + r, hw);
  shape.quadraticCurveTo(-hl, hw, -hl, hw - r);
  shape.lineTo(-hl, -hw + r);
  shape.quadraticCurveTo(-hl, -hw, -hl + r, -hw);
  const bevel = Math.min(0.35, height * 0.1);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 6,
  });
  geo.translate(0, 0, -height / 2);
  CHASSIS_GEO_CACHE.set(key, geo);
  return geo;
}

/** a shared diagonal-roller stripe texture for MECANUM/X-DRIVE wheels — one canvas, reused by
 * every wheel on every robot (generated once at module load, not per robot). */
let mecanumTexture: THREE.CanvasTexture | null = null;
function getMecanumTexture(): THREE.CanvasTexture {
  if (mecanumTexture) return mecanumTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = WHEEL;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#3a4250';
  ctx.lineWidth = 4;
  for (let i = -size; i < size * 2; i += 10) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i - size, size);
    ctx.stroke();
  }
  mecanumTexture = new THREE.CanvasTexture(canvas);
  mecanumTexture.wrapS = THREE.RepeatWrapping;
  mecanumTexture.wrapT = THREE.RepeatWrapping;
  return mecanumTexture;
}
let mecanumMat: THREE.MeshStandardMaterial | null = null;
function getMecanumMat(): THREE.MeshStandardMaterial {
  if (!mecanumMat) mecanumMat = new THREE.MeshStandardMaterial({ map: getMecanumTexture(), roughness: 0.8 });
  return mecanumMat;
}

/**
 * DRIVETRAIN-STYLED WHEELS (Phase 2 fidelity brief). `RobotSpec.drivetrain` is one of
 * `mecanum | tank | swerve | xdrive | butterfly` (`types.ts`) — geometry only, no physics
 * consequence, so getting one "wrong" costs nothing but the picture:
 *  • TANK — two full-length tread blocks, one per side, standing in for four wheels.
 *  • SWERVE — four wheels, each topped with a short vertical "pod" cylinder (the module body a
 *    real swerve wheel steers from).
 *  • MECANUM / X-DRIVE / BUTTERFLY (roller-wheeled drivetrains) — four cylinders with a
 *    diagonal-roller texture.
 */
function buildWheels(spec: RobotSpec, height: number): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const wheelR = Math.min(2.5, height * 0.25);
  if (spec.drivetrain === 'tank') {
    const trackH = wheelR * 1.6;
    for (const sy of [1, -1] as const) {
      const track = new THREE.Mesh(new THREE.BoxGeometry(spec.length - 1, wheelR * 0.9, trackH), solidMat(WHEEL, 0.9, 0));
      track.position.set(0, sy * (spec.width / 2 + wheelR * 0.45), trackH / 2);
      out.push(cast(track));
    }
    return out;
  }
  const wheelMat = spec.drivetrain === 'swerve' ? solidMat(WHEEL, 0.5, 0.2) : getMecanumMat();
  for (const sx of [1, -1] as const) {
    for (const sy of [1, -1] as const) {
      // CylinderGeometry's axis is local Y by default — exactly a wheel's axle direction
      // (chassis left-right), so the flat discs already face outward with no rotation needed.
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, 1.2, 12), wheelMat);
      wheel.position.set(sx * (spec.length / 2 - wheelR), sy * (spec.width / 2 + 0.4), wheelR);
      out.push(cast(wheel));
      if (spec.drivetrain === 'swerve') {
        const pod = new THREE.Mesh(new THREE.CylinderGeometry(wheelR * 0.55, wheelR * 0.55, 0.8, 10), solidMat(TURRET_RING));
        pod.position.set(sx * (spec.length / 2 - wheelR), sy * (spec.width / 2 + 0.4), wheelR * 2 + 0.4);
        out.push(cast(pod));
      }
    }
  }
  return out;
}

/** a small `CanvasTexture` sign panel showing the robot's slot number on the alliance colour —
 * generated ONCE per robot id (not per frame), cached by id since a robot's `id` never changes
 * across a `specKey` rebuild. */
const SIGN_TEXTURE_CACHE = new Map<string, THREE.CanvasTexture>();
function getSignTexture(id: number, alliance: 'red' | 'blue'): THREE.CanvasTexture {
  const key = `${id}|${alliance}`;
  const cached = SIGN_TEXTURE_CACHE.get(key);
  if (cached) return cached;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  // pre-mirrored: the mesh orientation that gets this panel's outward normal and vertical "up"
  // right (`buildRobotGroup`) only achieves them with "right" flipped, so the draw is flipped
  // here to cancel it — the panel reads correctly left-to-right once mounted.
  ctx.translate(size, 0);
  ctx.scale(-1, 1);
  ctx.fillStyle = alliance === 'blue' ? BLUE : RED;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, size - 6, size - 6);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 72px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(id), size / 2, size / 2 + 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  SIGN_TEXTURE_CACHE.set(key, tex);
  return tex;
}

/** the fields that change a robot's GEOMETRY (not its pose) — a group is rebuilt only when this
 * key changes, so a driving robot never pays for a full teardown/rebuild every frame. */
function specKey(spec: RobotSpec): string {
  const launcher = bbLauncherOf(spec, 0);
  const lift = bbLiftOf(spec);
  return [
    spec.length,
    spec.width,
    spec.heightIn ?? BB3_HEIGHT_DEFAULT,
    spec.chassisColor ?? '',
    spec.intakeMount ?? '',
    spec.intake,
    launcher.kind,
    launcher.mount,
    launcher.mount2 ?? '',
    lift?.mount ?? '',
  ].join('|');
}

function buildSweeper(spec: RobotSpec): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const m of bbMouths(spec)) {
    const end = m.edge === 'front' || m.edge === 'back';
    const cx = (m.x0 + m.x1) / 2;
    const cy = (m.y0 + m.y1) / 2;
    const len = end ? m.y1 - m.y0 : m.x1 - m.x0;
    const dia = 1.5;
    const geo = new THREE.CylinderGeometry(dia / 2, dia / 2, len * 0.92, 10);
    const roller = new THREE.Mesh(geo, solidMat(SWEEPER, 0.5, 0.3));
    roller.name = `robot:sweeper:${m.edge}`;
    roller.position.set(cx, cy, 1.2);
    // CylinderGeometry's axis is local Y; an END mouth's roller spans the chassis WIDTH (world
    // y-ish, local y before chassis rotation), so it needs no extra rotation. A FLANK mouth's
    // roller spans the chassis LENGTH (local x), so rotate the cylinder axis onto x.
    if (!end) roller.rotation.z = Math.PI / 2;
    out.push(cast(roller));
  }
  return out;
}

function buildTurret(spec: RobotSpec, mountPos: BbMountPos): THREE.Group {
  const group = new THREE.Group();
  const ring = turretRadius(spec);
  const local = turretLocal(spec, mountPos);
  group.position.set(local.x, local.y, 0);

  const ringMesh = new THREE.Mesh(new THREE.CylinderGeometry(ring, ring, 2, 16), solidMat(TURRET_RING, 0.4, 0.5));
  ringMesh.rotation.x = Math.PI / 2;
  ringMesh.position.z = 1;
  group.add(cast(ringMesh));

  // the barrel is a CHILD of a yaw/pitch sub-group so the caller can rotate just this part
  // independently of the chassis every frame (see `updateBiobuzzRobots`)
  const head = new THREE.Group();
  head.name = 'bb-turret-head';
  head.position.z = 1.5;
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(ring * 1.8, 0.6, 0.6), solidMat(TURRET_BARREL, 0.35, 0.6));
  barrel.position.x = ring * 0.9;
  head.add(cast(barrel));
  // the hood: a small angled plate at the muzzle end, standing in for the launch elevation the
  // pitch axis already rotates the whole `head` group by — a bare barrel box reads as a pipe,
  // the hood plate is what makes it read as a LAUNCHER.
  const hood = new THREE.Mesh(new THREE.BoxGeometry(0.9, ring * 1.3, 0.5), solidMat(TURRET_BARREL, 0.35, 0.6));
  hood.position.set(ring * 1.7, 0, 0.5);
  hood.rotation.z = Math.PI / 10;
  head.add(cast(hood));
  group.add(head);
  group.userData.head = head;
  return group;
}

/** the DUMPER'S bucket — a chassis-wide open tray on the mounted edge (`bbShooterEdgeOf`),
 * standing in for the archetype `drawRobot.ts`'s 2D sprite draws as a tilted tray. APPROX size:
 * BIOBUZZ has no published dumper hardware, same footing as every other mechanism shape here. */
function buildDumperBucket(spec: RobotSpec): THREE.Mesh {
  const edge = bbShooterEdgeOf(spec);
  const { dist } = edgeGeom(spec, edge);
  const angle = EDGE_ANGLE[edge];
  const bucket = new THREE.Mesh(new THREE.BoxGeometry(4, spec.width * 0.72, 2.4), solidMat(DUMPER_BUCKET, 0.55, 0.2));
  bucket.name = 'robot:dumper';
  bucket.position.set(Math.cos(angle) * (dist - 1.5), Math.sin(angle) * (dist - 1.5), (spec.heightIn ?? BB3_HEIGHT_DEFAULT) * 0.55);
  bucket.rotation.z = angle;
  return bucket;
}

function buildRobotGroup(r: RobotState): THREE.Group {
  const spec = r.spec;
  const group = new THREE.Group();
  group.name = `robot:${r.id}`;
  const color = r.alliance === 'blue' ? BLUE : RED;
  const height = spec.heightIn ?? BB3_HEIGHT_DEFAULT;

  // CHAMFERED CHASSIS (Phase 2 fidelity): rounded plan corners + a bevelled top/bottom edge via
  // `ExtrudeGeometry`, replacing the bare `BoxGeometry` slab the Day 1 pass used.
  const chassis = new THREE.Mesh(chassisGeometry(spec.length, spec.width, height), solidMat(color, 0.55, 0.15));
  chassis.name = `robot:${r.id}:chassis`;
  chassis.position.z = height / 2;
  group.add(cast(chassis));

  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.2, spec.width * 0.5, height * 0.3), solidMat(NOSE, 0.3, 0));
  nose.name = `robot:${r.id}:nose`;
  nose.position.set(spec.length / 2 - 0.6, 0, height * 0.75);
  group.add(cast(nose));

  // DRIVETRAIN-STYLED WHEELS (Phase 2 fidelity) — see `buildWheels`'s own header.
  for (const w of buildWheels(spec, height)) group.add(w);

  // ALLIANCE SIGN PANEL — a small vertical placard on the robot's LEFT flank (a real pit sign's
  // usual spot), textured once per id via `getSignTexture`.
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.min(6, spec.length * 0.4), Math.min(6, spec.length * 0.4)),
    new THREE.MeshStandardMaterial({ map: getSignTexture(r.id, r.alliance), roughness: 0.6 }),
  );
  sign.name = `robot:${r.id}:sign`;
  sign.position.set(0, spec.width / 2 + 0.05, height * 0.55);
  // a PlaneGeometry's default normal/up (+Z/+Y) cannot be rotated to face outward (+Y) with
  // "up" vertical (+Z) AND "right" un-mirrored in one proper (determinant +1) rotation — normal
  // × up fixes handedness. This orientation is the one that gets normal and up right; the
  // canvas is drawn pre-mirrored (`getSignTexture`) to cancel the resulting left-right flip.
  sign.rotation.set(Math.PI / 2, Math.PI, 0);
  group.add(sign);

  for (const s of buildSweeper(spec)) group.add(s);

  const launcher = bbLauncherOf(spec, 0);
  const heads: THREE.Group[] = [];
  if (bbIsTurreted(launcher)) {
    const t0 = buildTurret(spec, launcher.mount);
    group.add(t0);
    heads.push(t0.userData.head as THREE.Group);
    if (launcher.kind === 'twinturret' && launcher.mount2) {
      const t1 = buildTurret(spec, launcher.mount2);
      group.add(t1);
      heads.push(t1.userData.head as THREE.Group);
    }
  } else if (launcher.kind === 'dumper') {
    group.add(cast(buildDumperBucket(spec)));
  }
  group.userData.turretHeads = heads;
  group.userData.launcher = launcher;

  const lift = bbLiftOf(spec);
  if (lift) {
    const tubeMat = solidMat('#98a3b2', 0.4, 0.4);
    const local = turretLocal(spec, lift.mount);
    const tube = new THREE.Mesh(new THREE.BoxGeometry(3, 1.4, 1.4), tubeMat);
    tube.name = `robot:${r.id}:tube`;
    tube.position.set(local.x, local.y, height * 0.6);
    group.add(cast(tube));
  }

  void bbHopperCap; // reserved: held-element pips are a later pass, not Day 1

  return group;
}

interface RobotEntry {
  group: THREE.Group;
  key: string;
}

export interface BbRobots {
  group: THREE.Group;
  dispose(): void;
}

export function buildBiobuzzRobots(): BbRobots {
  const group = new THREE.Group();
  group.name = 'bb-robots';
  const entries = new Map<number, RobotEntry>();

  function sync(world: World): void {
    const seen = new Set<number>();
    for (const r of world.robots) {
      seen.add(r.id);
      const key = specKey(r.spec);
      let entry = entries.get(r.id);
      if (!entry || entry.key !== key) {
        if (entry) group.remove(entry.group);
        const g = buildRobotGroup(r);
        entry = { group: g, key };
        entries.set(r.id, entry);
        group.add(g);
      }
      entry.group.position.set(r.pos.x, r.pos.y, r.z ?? 0);
      entry.group.rotation.set(0, 0, r.heading);

      const heads = entry.group.userData.turretHeads as THREE.Group[] | undefined;
      const launcher = entry.group.userData.launcher as BbLauncherSpec | undefined;
      if (heads && heads.length > 0 && launcher) {
        // the turret's WORLD yaw is independent of the chassis (`turretHeading`); this group is
        // a child of the chassis group, which already carries `r.heading`, so the child's own
        // rotation only needs the DIFFERENCE
        const h0 = heads[0];
        h0.rotation.z = r.turretHeading - r.heading;
        h0.rotation.y = -(r.bbTurretPitch ?? 0);
        if (heads.length > 1) {
          const h1 = heads[1];
          h1.rotation.z = (r.bbTurret2Heading ?? r.turretHeading) - r.heading;
          h1.rotation.y = -(r.bbTurret2Pitch ?? 0);
        }
      }
    }
    for (const [id, entry] of entries) {
      if (!seen.has(id)) {
        group.remove(entry.group);
        entries.delete(id);
      }
    }
  }

  // exposed on the group so `renderScene.ts` can call it without a second export surface
  group.userData.sync = sync;

  return {
    group,
    dispose(): void {
      entries.clear();
    },
  };
}

export function updateBiobuzzRobots(robots: BbRobots, world: World): void {
  (robots.group.userData.sync as (w: World) => void)(world);
}
