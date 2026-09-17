import * as THREE from 'three';
import type { RobotSpec, RobotState, World } from '../../../types';
import { BB3_HEIGHT_DEFAULT, bbHopperCap } from '../config';
import { bbIsTurreted, bbLauncherOf, bbLiftOf, type BbLauncherSpec } from '../mechs';
import { bbMouths } from '../robot';
import { turretLocal, turretRadius, type BbMountPos } from '../mounts';

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
function solidMat(color: string): THREE.MeshStandardMaterial {
  let m = BODY_MAT_CACHE.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color });
    BODY_MAT_CACHE.set(color, m);
  }
  return m;
}

const RED = '#ef4444';
const BLUE = '#3b82f6';
const NOSE = '#e5e7eb';
const WHEEL = '#1f242c';
const TURRET_RING = '#39414f';
const TURRET_BARREL = '#5c6676';
const SWEEPER = '#12161c';

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
    const roller = new THREE.Mesh(geo, solidMat(SWEEPER));
    roller.position.set(cx, cy, 1.2);
    // CylinderGeometry's axis is local Y; an END mouth's roller spans the chassis WIDTH (world
    // y-ish, local y before chassis rotation), so it needs no extra rotation. A FLANK mouth's
    // roller spans the chassis LENGTH (local x), so rotate the cylinder axis onto x.
    if (!end) roller.rotation.z = Math.PI / 2;
    out.push(roller);
  }
  return out;
}

function buildTurret(spec: RobotSpec, mountPos: BbMountPos): THREE.Group {
  const group = new THREE.Group();
  const ring = turretRadius(spec);
  const local = turretLocal(spec, mountPos);
  group.position.set(local.x, local.y, 0);

  const ringMesh = new THREE.Mesh(new THREE.CylinderGeometry(ring, ring, 2, 16), solidMat(TURRET_RING));
  ringMesh.rotation.x = Math.PI / 2;
  ringMesh.position.z = 1;
  group.add(ringMesh);

  // the barrel is a CHILD of a yaw/pitch sub-group so the caller can rotate just this part
  // independently of the chassis every frame (see `updateBiobuzzRobots`)
  const head = new THREE.Group();
  head.name = 'bb-turret-head';
  head.position.z = 1.5;
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(ring * 1.8, 0.6, 0.6), solidMat(TURRET_BARREL));
  barrel.position.x = ring * 0.9;
  head.add(barrel);
  group.add(head);
  group.userData.head = head;
  return group;
}

function buildRobotGroup(r: RobotState): THREE.Group {
  const spec = r.spec;
  const group = new THREE.Group();
  group.name = `bb-robot-${r.id}`;
  const color = r.alliance === 'blue' ? BLUE : RED;
  const height = spec.heightIn ?? BB3_HEIGHT_DEFAULT;

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(spec.length, spec.width, height), solidMat(color));
  chassis.position.z = height / 2;
  group.add(chassis);

  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.2, spec.width * 0.5, height * 0.3), solidMat(NOSE));
  nose.position.set(spec.length / 2 - 0.6, 0, height * 0.75);
  group.add(nose);

  const wheelR = Math.min(2.5, height * 0.25);
  for (const sx of [1, -1] as const) {
    for (const sy of [1, -1] as const) {
      // CylinderGeometry's axis is local Y by default — exactly a wheel's axle direction
      // (chassis left-right), so the flat discs already face outward with no rotation needed.
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, 1.2, 10), solidMat(WHEEL));
      wheel.position.set(sx * (spec.length / 2 - wheelR), sy * (spec.width / 2 + 0.4), wheelR);
      group.add(wheel);
    }
  }

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
  }
  group.userData.turretHeads = heads;
  group.userData.launcher = launcher;

  const lift = bbLiftOf(spec);
  if (lift) {
    const tubeMat = solidMat('#98a3b2');
    const local = turretLocal(spec, lift.mount);
    const tube = new THREE.Mesh(new THREE.BoxGeometry(3, 1.4, 1.4), tubeMat);
    tube.position.set(local.x, local.y, height * 0.6);
    group.add(tube);
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
