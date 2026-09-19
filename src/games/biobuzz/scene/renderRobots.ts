import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Alliance, RobotSpec, World } from '../../../types';
import { chassisFill } from '../../../config';
import {
  BB3_MOUTH_SLOT_Z,
  BB_INTAKE_DRAW_IN,
  BB_LAUNCH_PLATE_GAP,
  BB_LAUNCH_Z0,
  BB_POLLEN_R,
  bbHopperCap,
} from '../config';
import { bbIsTurreted, bbLauncherOf, bbLiftOf, type BbLauncherSpec } from '../mechs';
import { bbMouths } from '../robot';
import { bbSpecKey } from '../specKey';
import {
  bbMouthFrame,
  bbShooterEdgeOf,
  EDGE_ANGLE,
  edgeGeom,
  turretLocal,
  turretRadius,
  type BbMountPos,
} from '../mounts';

/**
 * BIOBUZZ 3D SCENE — generated robots (Day 1, `docs/biobuzz/plan-3d.md` §3.3, §4.2).
 *
 * One `THREE.Group` per robot id, built from the spec ONCE and rebuilt only when the spec
 * identity changes (`bbSpecKey`). Posed every frame at `(pos.x, pos.y, r.z ?? 0)` —
 * `RobotState.z` is the chassis BOTTOM height (plan §2.4/§3.3; absent reads 0, exactly right
 * for a 2D-physics world) — with yaw `heading`.
 *
 * HEADING CONVENTION: `RobotState.heading` is field-frame radians, 0 = +x, CCW positive
 * (`types.ts`), and the robot's own local frame is +x forward / +y left (`mounts.ts`'s header).
 * A `Group.rotation.z = heading` maps local +x to world `(cos, sin)`, which is exactly that
 * convention — no sign flip needed, unlike the DECODE bird's-eye mirroring gotcha in CLAUDE.md
 * (that one is a SCREEN-space schematic; this is a plain world-frame yaw).
 *
 * ── WHAT A ROBOT IS, AND WHAT IT IS NOT (owner playtest, 2026-09-18) ────────────────────────
 * It used to be a SOLID BOX `length × width × heightIn` with a stick on top, which drew three
 * complaints at once: "way too tall for no apparent reason", "the drivetrain should not be a
 * box", "the launcher looks horrible". All three are the same mistake — the collider was being
 * drawn instead of the robot. `heightIn` is a PHYSICS extent (R105.A's sizing volume, and what
 * `sim3d` builds its cuboid from); nothing on a real FTC robot is solid to that height.
 *
 * So the picture is built the way the machine is:
 *  · a LOW DRIVETRAIN — two parallel side plates per side with the wheels BETWEEN them, cross
 *    members front and rear, a belly pan and a partial deck, all inside `BB_PLATE_H`;
 *  · an OPEN TOWER — four thin uprights and a top rail carrying the declared height, so a tall
 *    build still reads as tall without reading as a brick;
 *  · the MECHANISMS standing on the deck: a hooded flywheel on its turntable (or a dumper's
 *    pivoted tray) and an over-the-bumper intake reaching the sim's own footprint.
 *
 * The footprint is still exactly `spec.length × spec.width` — the outer face of each side plate
 * IS the frame — and the intake still reaches exactly `bbMouths`, which is `footprintExtents`.
 */

/**
 * EVERY GEOMETRY AND MATERIAL THIS MODULE SHARES BETWEEN ROBOTS, registered as it is created.
 *
 * `disposeRobotGroup` (bottom of the file) is what reads them, and the reason it has to exist
 * at all: a group is thrown away and rebuilt whenever `bbSpecKey` changes, which in a match is
 * rare and in the BUILDER is every drag of a slider. A blanket `traverse` + `dispose()` over a
 * discarded group would free the frame geometry, the roller texture and every solid material
 * that the next group — and every other robot on the field — is still using, so three would
 * re-upload the buffers and recompile the programs on the next frame. Disposing NOTHING leaks
 * the per-robot meshes instead. These sets are how the walk tells the two apart.
 */
const SHARED_GEO = new Set<THREE.BufferGeometry>();
const SHARED_MAT = new Set<THREE.Material>();

const BODY_MAT_CACHE = new Map<string, THREE.MeshStandardMaterial>();
function solidMat(color: string, roughness = 0.6, metalness = 0.1): THREE.MeshStandardMaterial {
  const key = `${color}|${roughness}|${metalness}`;
  let m = BODY_MAT_CACHE.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    BODY_MAT_CACHE.set(key, m);
    SHARED_MAT.add(m);
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
const TREAD = '#262c35';
const ALU = '#98a3b2';
const ALU_DK = '#39414f';
const TURRET_RING = '#39414f';
const TURRET_BARREL = '#5c6676';
const SWEEPER = '#12161c';
const DUMPER_BUCKET = '#8a94a3';
const MOTOR = '#2b313a';

// ─────────────────────────────────────────────────────────────────────────────
// DRIVETRAIN DIMENSIONS — inches. GEOMETRY, not physics: nothing below is read by the sim, and
// none of it changes a collider. APPROX, sized off ordinary FTC hardware, and deliberately
// INDEPENDENT of `spec.heightIn`: a drivetrain does not get taller because the robot above it
// does, which is the whole of complaint #9.
// ─────────────────────────────────────────────────────────────────────────────

/** side-plate height — a real drivetrain is a 4-ish inch channel, and this is the number that
 * decides how much of a robot reads as "chassis". */
const BB_PLATE_H = 4.6;
/** plate thickness. The OUTER plate's outer face is the frame line, so the footprint of the
 * built group is exactly `spec.length × spec.width`. */
const BB_PLATE_T = 0.22;
/** wheel radius / width — a 4-in wheel, the FTC default. */
const BB_WHEEL_R = 2.0;
const BB_WHEEL_W = 1.5;
/** clear gap between the inner and outer plate: the wheel lives in it, protected. */
const BB_PLATE_GAP = BB_WHEEL_W + 0.4;
/** square section of the cross members, the belly pan and the tower uprights. */
const BB_RAIL_T = 0.95;
/** the DECK — where every mechanism is bolted. */
const BB_DECK_Z = BB_PLATE_H;

/** the drivetrain's inner clear width (between the two inner plates) for a given chassis. */
function innerHalfWidth(spec: Pick<RobotSpec, 'width'>): number {
  return Math.max(0.6, spec.width / 2 - BB_PLATE_T * 2 - BB_PLATE_GAP);
}

/**
 * ⚠️ NOTHING HERE DRAWS `heightIn`, AND THAT IS THE POINT (owner, 2026-09-18).
 *
 * The first pass at complaint #9 carried the declared height as an open two-post mast on a free
 * chassis edge. It answered the wrong question: a bare goalpost standing on the deck IS "tall for
 * no apparent reason", just in a thinner shape. A ROBOT'S VISUAL HEIGHT IS WHATEVER ITS
 * MECHANISMS REACH. `heightIn` is a collider extent (R105.A's sizing volume, and what `sim3d`
 * builds its cuboid from); the match view does not indicate it at all, and the one place it is
 * shown is the BUILDER turntable, as a dashed measurement outline that is visibly not hardware
 * (`renderPreview.ts`). Do not reintroduce a height indicator here.
 */

/**
 * A FLAT PLATE WITH LIGHTENING HOLES, in the chassis's x–z plane (thickness along y).
 *
 * `ExtrudeGeometry` with `Path` holes is core three.js, so a plate that looks milled costs one
 * extrusion and no dependency. Built in shape space `(u = along, v = up)` and rotated once:
 * `rotateX(+π/2)` maps shape `v → world z` and the extrusion depth `→ world −y`, which is the
 * orientation every caller wants (a side plate standing up along the chassis).
 */
function platePlane(along: number, up: number, t: number, holes: number): THREE.ExtrudeGeometry {
  const hu = along / 2;
  const hv = up / 2;
  const r = Math.min(0.6, up * 0.18);
  const shape = new THREE.Shape();
  shape.moveTo(-hu + r, -hv);
  shape.lineTo(hu - r, -hv);
  shape.quadraticCurveTo(hu, -hv, hu, -hv + r);
  shape.lineTo(hu, hv - r);
  shape.quadraticCurveTo(hu, hv, hu - r, hv);
  shape.lineTo(-hu + r, hv);
  shape.quadraticCurveTo(-hu, hv, -hu, hv - r);
  shape.lineTo(-hu, -hv + r);
  shape.quadraticCurveTo(-hu, -hv, -hu + r, -hv);
  const holeR = Math.min(up * 0.26, along / (holes * 2.6));
  if (holes > 0 && holeR > 0.25) {
    for (let i = 0; i < holes; i++) {
      const u = -hu + ((i + 0.5) * along) / holes;
      const path = new THREE.Path();
      path.absarc(u, 0, holeR, 0, Math.PI * 2, true);
      shape.holes.push(path);
    }
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 8 });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, t / 2, 0); // extrusion runs into −y; centre it on the plate's own plane
  return geo;
}

/** a box, pre-placed — the merge below wants world-space geometry, not meshes. */
function boxAt(sx: number, sy: number, sz: number, x: number, y: number, z: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(x, y, z);
  return g;
}

/**
 * ONE MERGED, CACHED MESH per (key, material) — the draw-call budget, and the reason the new
 * drivetrain does not cost four times what the box did.
 *
 * A robot's frame is ~16 separate boxes and plates, all static relative to the chassis and all
 * one material. Merged they are ONE draw call (two with the shadow pass) instead of sixteen, and
 * because the merge is keyed on the dimensions that produced it, four robots on the same build
 * share the buffer. The source geometries are temporaries and are disposed the moment the merge
 * has copied them; only the merged result is registered as SHARED.
 */
const FRAME_CACHE = new Map<string, THREE.BufferGeometry>();
function framePart(key: string, build: () => THREE.BufferGeometry[]): THREE.BufferGeometry {
  const hit = FRAME_CACHE.get(key);
  if (hit) return hit;
  const parts = build();
  const merged = mergeGeometries(parts, false) ?? parts[0];
  for (const p of parts) if (p !== merged) p.dispose();
  FRAME_CACHE.set(key, merged);
  SHARED_GEO.add(merged);
  return merged;
}

/**
 * THE CHASSIS SILHOUETTE, as line geometry — this is what carries the ALLIANCE in 3D, and it
 * traces the BUMPER band (the drivetrain), which is where an alliance colour lives on a real
 * robot. It used to trace a full-height box, which is the slab complaint #9 is about.
 */
const CHASSIS_EDGE_CACHE = new Map<string, THREE.EdgesGeometry>();
function chassisEdges(length: number, width: number, height: number): THREE.EdgesGeometry {
  const key = `${length}|${width}|${height}`;
  const cached = CHASSIS_EDGE_CACHE.get(key);
  if (cached) return cached;
  const box = new THREE.BoxGeometry(length, width, height);
  const geo = new THREE.EdgesGeometry(box, 30);
  box.dispose();
  CHASSIS_EDGE_CACHE.set(key, geo);
  SHARED_GEO.add(geo);
  return geo;
}

const LINE_MAT_CACHE = new Map<string, THREE.LineBasicMaterial>();
function lineMat(color: string): THREE.LineBasicMaterial {
  let m = LINE_MAT_CACHE.get(color);
  if (!m) {
    m = new THREE.LineBasicMaterial({ color });
    LINE_MAT_CACHE.set(color, m);
    SHARED_MAT.add(m);
  }
  return m;
}

/**
 * A SHARED ROLLER-STRIPE TEXTURE for the two roller-wheeled drivetrains — one canvas per kind,
 * reused by every wheel on every robot.
 *
 * The two kinds are not the same wheel and are not drawn the same: a MECANUM roller sits at 45°
 * to the wheel plane (which is what gives it a sideways force component and the whole
 * drivetrain its strafe), and an OMNI roller sits at 90° to it (which is why an X-drive has to
 * cant the WHEELS instead — see `buildWheels`). Diagonal stripes vs. transverse bands is that
 * difference, and it is the only thing that distinguishes a mecanum corner from an X-drive
 * corner once you are close enough to see a roller at all.
 */
const ROLLER_TEX_CACHE = new Map<string, THREE.CanvasTexture>();
function getRollerTexture(kind: 'mecanum' | 'omni'): THREE.CanvasTexture {
  const hit = ROLLER_TEX_CACHE.get(kind);
  if (hit) return hit;
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
    ctx.lineTo(kind === 'mecanum' ? i - size : i, size);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  ROLLER_TEX_CACHE.set(kind, tex);
  return tex;
}
const ROLLER_MAT_CACHE = new Map<string, THREE.MeshStandardMaterial>();
function getRollerMat(kind: 'mecanum' | 'omni'): THREE.MeshStandardMaterial {
  let m = ROLLER_MAT_CACHE.get(kind);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: getRollerTexture(kind), roughness: 0.8 });
    ROLLER_MAT_CACHE.set(kind, m);
    SHARED_MAT.add(m);
  }
  return m;
}

/** shared wheel geometry, one per (radius, width, segments) — four to six per robot, identical. */
const WHEEL_GEO_CACHE = new Map<string, THREE.CylinderGeometry>();
function wheelGeometry(r: number, w: number): THREE.CylinderGeometry {
  const key = `${r}|${w}`;
  const hit = WHEEL_GEO_CACHE.get(key);
  if (hit) return hit;
  const geo = new THREE.CylinderGeometry(r, r, w, 14);
  WHEEL_GEO_CACHE.set(key, geo);
  SHARED_GEO.add(geo);
  return geo;
}

/**
 * WHEEL AXLE POSITIONS along the chassis, by drivetrain. TANK is a six-wheel drop-centre — the
 * shape every kit builds and the one `presets.ts` describes in words — so it gets three axles a
 * side; everything else gets the four corners.
 */
function axleXs(spec: RobotSpec): number[] {
  const end = spec.length / 2 - BB_WHEEL_R - 0.7;
  if (spec.drivetrain === 'tank') return [end, 0, -end];
  return [end, -end];
}

// ── SWERVE POD DIMENSIONS (in). GEOMETRY, not physics: the sim has no pod. ───────────────────
/** thickness of the fork plate either side of the wheel, and the clearance out to it. */
const BB_POD_FORK_T = 0.3;
/** the pod's top plate — level with the deck, because that is the structure it hangs from. */
const BB_POD_PLATE_Z = BB_DECK_Z;
/** the toothed steering ring / pulley the pod is slewed by, sitting on the top plate. */
const BB_POD_RING_R = 1.45;
const BB_POD_RING_H = 0.75;
/* ⚠️ NO MOTOR ON TOP OF THE POD (owner, 2026-09-19: "the motor for swerve does NOT go on top of
 * the swerve module"). A first pass stood a can on the slew ring; that is not where a swerve
 * steering motor lives. It sits on the DECK and drives the ring through the belt or gear the ring
 * is toothed for, so the pod carries the ring and nothing above it. The ring is what says the pod
 * is driven. */
/** how far a BUTTERFLY lifts the set that is off the ground (in). */
const BB_BUTTERFLY_LIFT = 0.6;

/**
 * ONE SWERVE POD'S HARDWARE, in the pod's own frame: origin at the wheel's contact patch, +x the
 * rolling direction, +z up. Three merged geometries because they are three materials; every pod
 * on every robot shares all three, so four corners cost six draw calls and not twenty-four.
 *
 * ⚠️ THE POD'S ORIGIN IS THE CONTACT PATCH, WHICH IS THE STEERING AXIS. That is the whole reason
 * this is a group and not four loose meshes: a swerve module slews about a vertical kingpin
 * through the patch (zero scrub radius), so `group.rotation.z = steer` is the real motion and
 * the wheel, the fork, the ring and the motor all go round together. The old drawing was a
 * 2.2-in puck floating at deck height with the wheel left behind pointing forward — it could not
 * turn, and nothing about it said "module".
 */
function podParts(): THREE.Object3D[] {
  const forkY = BB_WHEEL_W / 2 + 0.2;
  const struct = framePart('swervePod:struct', () => {
    const parts: THREE.BufferGeometry[] = [];
    // TWIN FORK PLATES carrying the axle, one either side of the wheel
    for (const s of [1, -1] as const) {
      parts.push(boxAt(3.6, BB_POD_FORK_T, BB_POD_PLATE_Z - 0.6, 0, s * forkY, (BB_POD_PLATE_Z + 0.6) / 2));
    }
    // THE TOP PLATE the fork hangs off
    parts.push(boxAt(3.6, forkY * 2 + BB_POD_FORK_T, 0.3, 0, 0, BB_POD_PLATE_Z + 0.15));
    // THE KINGPIN — the vertical steering axis itself, through the contact patch
    const pin = new THREE.CylinderGeometry(0.3, 0.3, 0.9, 8);
    pin.rotateX(Math.PI / 2);
    pin.translate(0, 0, BB_POD_PLATE_Z + 0.6);
    parts.push(pin);
    return parts;
  });
  const ringZ = BB_POD_PLATE_Z + 0.3 + BB_POD_RING_H / 2;
  const ring = framePart('swervePod:ring', () => {
    const parts: THREE.BufferGeometry[] = [];
    const race = new THREE.CylinderGeometry(BB_POD_RING_R, BB_POD_RING_R, BB_POD_RING_H, 20);
    race.rotateX(Math.PI / 2);
    race.translate(0, 0, ringZ);
    parts.push(race);
    // the TOOTHED flange — a thin disc a little proud of the race, which is what makes the ring
    // read as a pulley being driven rather than as another puck
    const flange = new THREE.CylinderGeometry(BB_POD_RING_R + 0.18, BB_POD_RING_R + 0.18, 0.16, 20);
    flange.rotateX(Math.PI / 2);
    flange.translate(0, 0, ringZ + BB_POD_RING_H / 2);
    parts.push(flange);
    return parts;
  });
  return [
    cast(new THREE.Mesh(struct, solidMat(ALU, 0.45, 0.35))),
    cast(new THREE.Mesh(ring, solidMat(TURRET_RING, 0.4, 0.5))),
  ];
}

/** what `buildWheels` hands back to `buildRobotGroup`: the meshes to add, plus the handles the
 * per-frame sync needs to POSE a drivetrain that moves. */
interface BbWheels {
  nodes: THREE.Object3D[];
  /** SWERVE: the four pod groups in `moduleAngles` order — [FL, FR, BL, BR]. */
  pods: THREE.Group[];
  /** BUTTERFLY: the two wheel sets, so the sync can drop whichever one is down. */
  traction: THREE.Object3D[];
  roller: THREE.Object3D[];
}

/**
 * DRIVETRAIN-STYLED WHEELS, BETWEEN THE PLATES (owner playtest #16, and swerve 2026-09-19).
 *
 * `RobotSpec.drivetrain` is one of `mecanum | tank | swerve | xdrive | butterfly` (`types.ts`) —
 * geometry only, no physics consequence — and ALL FIVE are drawn differently now:
 *  • TANK — six traction wheels, three a side, plain dark rubber.
 *  • MECANUM — four wheels with the 45° roller stripe.
 *  • X-DRIVE — four OMNIS, canted ±45° ACROSS their corners, with the 90° roller stripe.
 *  • SWERVE — four full modules: wheel in a twin-plate fork, kingpin, toothed slew ring, motor.
 *  • BUTTERFLY — BOTH sets on each side, mecanum at the corners and traction inboard, with the
 *    one that is up visibly lifted.
 *
 * ⚠️ X-DRIVE AND BUTTERFLY USED TO FALL THROUGH TO THE MECANUM WHEEL, AND ONE OF THOSE WAS A
 * BUG WHILE THE OTHER WAS ONLY THIN. X-drive was wrong in a way the 2D map already disagreed
 * with: `drawWheels` cants its omnis `px * py >= 0 ? -45° : +45°`, so the four of them read as
 * the sides of a DIAMOND, and its header explains why (a wheel whose force line passes through
 * the centre of mass has no moment arm about it, so a radial X could never yaw). Drawing them
 * pointing forward in 3D made the same robot a different machine depending on which key you had
 * pressed. THE CANT RULE HERE IS THAT SAME EXPRESSION, deliberately. Butterfly was merely
 * under-drawn: it really does carry a mecanum set, and `RobotState.butterflyTank` — runtime
 * state that nothing in 3D was reading — says which set is on the ground.
 *
 * Every wheel sits at `y = ±(width/2 − plate − gap/2)`, i.e. in the channel between the inner
 * and outer side plate, which is what "wheels protected between parallel plates" means.
 */
function buildWheels(spec: RobotSpec): BbWheels {
  const out: BbWheels = { nodes: [], pods: [], traction: [], roller: [] };
  const wheelY = spec.width / 2 - BB_PLATE_T - BB_PLATE_GAP / 2;
  const dt = spec.drivetrain;
  const mat = dt === 'tank' ? solidMat(TREAD, 0.95, 0) : getRollerMat(dt === 'xdrive' ? 'omni' : 'mecanum');
  const geo = wheelGeometry(BB_WHEEL_R, BB_WHEEL_W);
  for (const x of axleXs(spec)) {
    for (const sy of [1, -1] as const) {
      // CylinderGeometry's axis is local Y by default — exactly a wheel's axle direction
      // (chassis left-right), so the flat discs already face outward with no rotation needed.
      const wheel = new THREE.Mesh(geo, mat);
      cast(wheel);
      if (dt === 'swerve') {
        // ── ORDER MATTERS. `axleXs` yields [+x, −x] and the inner loop [+y, −y], so the pods
        // come out FL, FR, BL, BR — the corner order `RobotState.moduleAngles` is documented in
        // and the order `drawWheels` reads it in. Two orders would put a pod's steer on the
        // diagonally opposite corner, which is invisible driving straight and obvious in a spin.
        const pod = new THREE.Group();
        pod.name = `robot:pod:${out.pods.length}`;
        pod.position.set(x, sy * wheelY, 0);
        wheel.position.set(0, 0, BB_WHEEL_R);
        pod.add(wheel);
        for (const p of podParts()) pod.add(p);
        out.nodes.push(pod);
        out.pods.push(pod);
        continue;
      }
      wheel.position.set(x, sy * wheelY, BB_WHEEL_R);
      if (dt === 'xdrive') wheel.rotation.z = x * sy >= 0 ? -Math.PI / 4 : Math.PI / 4;
      out.nodes.push(wheel);
      if (dt === 'butterfly') {
        // the MECANUM set is the corner set; the TRACTION set is inboard on its own axle, narrow
        // so the two read as two sets rather than as one fat wheel. `butterflyTank` decides which
        // one is down — the sync does that, so a preview shows the spawn default (mecanum down).
        out.roller.push(wheel);
        const tx = x - Math.sign(x) * (BB_WHEEL_R * 2 + 0.5);
        const tw = new THREE.Mesh(wheelGeometry(BB_WHEEL_R, BB_WHEEL_W * 0.7), solidMat(TREAD, 0.95, 0));
        tw.position.set(tx, sy * wheelY, BB_WHEEL_R + BB_BUTTERFLY_LIFT);
        out.nodes.push(cast(tw));
        out.traction.push(tw);
      }
    }
  }
  return out;
}

/**
 * THE FRAME — side plates, cross members, belly pan, deck, tower. Two merged meshes: the
 * cosmetic one (the plates and the deck, which carry `chassisFill`) and the structural one (the
 * darker extrusion). Open TOP by construction: the deck is inset from the frame on every side,
 * so the mechanisms above it are seen against daylight rather than against a lid.
 */
function buildFrame(spec: RobotSpec): THREE.Object3D[] {
  const hl = spec.length / 2;
  const hw = spec.width / 2;
  const innerHW = innerHalfWidth(spec);
  const outerY = hw - BB_PLATE_T / 2;
  const innerY = hw - BB_PLATE_T * 1.5 - BB_PLATE_GAP;
  const holes = Math.max(2, Math.round(spec.length / 4.5));
  // NOT KEYED ON `heightIn`: nothing in the frame depends on it any more, so two builds that
  // differ only in declared height share this buffer.
  const key = `${spec.length}|${spec.width}|${spec.drivetrain}`;

  const skin = framePart(`skin:${key}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    for (const sy of [1, -1] as const) {
      for (const y of [outerY, innerY]) {
        const p = platePlane(spec.length, BB_PLATE_H, BB_PLATE_T, holes);
        p.translate(0, sy * y, BB_PLATE_H / 2);
        parts.push(p);
      }
    }
    return parts;
  });
  const frame = framePart(`frame:${key}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    // CROSS MEMBERS, front and rear, tying the two side assemblies together at deck level
    for (const sx of [1, -1] as const) {
      parts.push(boxAt(BB_RAIL_T, hw * 2 - BB_PLATE_T * 2, BB_RAIL_T, sx * (hl - BB_RAIL_T / 2), 0, BB_DECK_Z - BB_RAIL_T / 2));
    }
    // BELLY PAN — thin, low, spanning the inner channel
    parts.push(boxAt(spec.length - BB_RAIL_T * 2.6, innerHW * 2, 0.22, 0, 0, 0.85));
    // THE DECK — the polycarb floor mechanisms bolt to. Inset on every side so the side plates
    // and the channel read past it, and in the STRUCTURAL colour rather than the cosmetic one:
    // the player's chassis colour is the PLATES (that is the surface a bumper-height view sees),
    // and a deck in the same colour turned the top of the robot back into one flat slab.
    parts.push(boxAt(spec.length - BB_RAIL_T * 2.6, innerHW * 2, 0.26, 0, 0, BB_DECK_Z - 0.13));
    return parts;
  });

  const skinMesh = new THREE.Mesh(skin, solidMat(chassisFill(spec.chassisColor), 0.55, 0.15));
  skinMesh.name = 'robot:frame:skin';
  const frameMesh = new THREE.Mesh(frame, solidMat(ALU_DK, 0.45, 0.4));
  frameMesh.name = 'robot:frame:rails';
  return [cast(skinMesh), cast(frameMesh)];
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

// ⚠️ THE GROUP'S REBUILD KEY IS `bbSpecKey` (`../specKey.ts`), NOT A COPY OF IT HERE. This
// file used to carry its own `specKey`, and the saved-robot THUMBNAIL cache in the main chunk
// needs the same answer without loading this chunk at all — two copies is the exact way a
// thumbnail ends up showing the previous build. (The local copy also left `drivetrain` out, so
// swapping mecanum for tank never rebuilt the wheels.)

/**
 * THE INTAKE ROLLER — A RIGID HUB THAT CLEARS THE SLOT, AND COMPLIANT FLAPS THAT REACH INTO IT.
 *
 * ⚠️ IT USED TO BE A 1-IN BARREL AT z 1.15, i.e. a rigid cylinder whose bottom sat 0.15 in off
 * the floor. A POLLEN is 2.8 in across and a NECTAR 3.6, so the drawn roller passed clean THROUGH
 * every element in the mouth — and `chassis3dShapes` leaves the pocket open from the floor to
 * `BB3_MOUTH_SLOT_Z` (= one NECTAR diameter) with no roller collider at all, so the PICTURE was
 * blocking a gap the PHYSICS says is clear, by 3.45 in. Owner, 2026-09-19: "the intake roller
 * seems way too low for it to intake pollen and nectar realistically", and "it should still allow
 * for pollen and nectar to pass under".
 *
 * Those two asks — GRIP it, and let it PASS UNDER — cannot both hold for a rigid part: gripping a
 * POLLEN needs the bottom below 2.8 and clearing a NECTAR needs it at 3.6 or more. They hold for
 * a real over-the-bumper intake because its low part is the COMPLIANT part, which is exactly
 * "grip when driven, yield when not". So the hub clears the slot and the flaps reach down into
 * it.
 *
 * ⚠️ `BB_ROLLER_Z` IS DERIVED FROM THE COLLIDER, NOT TYPED. If the mouth slot ever moves, the
 * picture follows it instead of drifting — which is the whole failure this replaces.
 */
const BB_ROLLER_HUB_R = 0.75;
/** the compliant flaps' tip radius — a 4-in wheel. They reach 0.30 in below a POLLEN's crown and
 *  1.10 below a NECTAR's; that overlap IS the compression that makes the roller grip. */
const BB_ROLLER_FLAP_R = 2.0;
/** hub bottom `BB3_MOUTH_SLOT_Z + 0.15`, i.e. a bolt's clearance above the open pocket. */
const BB_ROLLER_Z = BB3_MOUTH_SLOT_Z + BB_ROLLER_HUB_R + 0.15;

/**
 * THE OVER-THE-BUMPER INTAKE (owner playtest #14), one assembly per mounted edge.
 *
 * ⚠️ THE REACH IS `bbMouths`, NEVER A LITERAL. The mouth rects are the sim's own capture areas
 * and `footprintExtents` grows the collider by the same `INTAKE_PRESETS[…].reach`, so reading
 * them here is what makes "the drawn intake is the grab area" true in 3D the way `drawRobot.ts`
 * already makes it true in 2D. It is also what makes this lane survive the intake sim changing
 * underneath it: lengthen the reach constant and the model gets longer for free.
 *
 * Built in the MOUTH's own frame (`bbMouthFrame`: origin at the mouth's inner edge, +x OUTWARD,
 * +y along the edge) for the same reason the sprite is — one orientation, no sign-juggling, and
 * no chance of a flank intake being drawn where a front one acts. `rail` is where the frame
 * line falls in that frame, so everything outboard of it is genuinely outside the robot.
 */
function buildIntake(spec: RobotSpec): { nodes: THREE.Object3D[]; rollers: THREE.Mesh[] } {
  const nodes: THREE.Object3D[] = [];
  const rollers: THREE.Mesh[] = [];
  const hl = spec.length / 2;
  const hw = spec.width / 2;
  for (const m of bbMouths(spec)) {
    const f = bbMouthFrame(m, hl, hw);
    const g = new THREE.Group();
    g.name = `robot:intake:${m.edge}`;
    g.position.set(f.ox, f.oy, 0);
    g.rotation.z = f.rot;

    const tip = f.depth; // the mouth's outer edge = the collision footprint of this edge
    const armX0 = f.rail - 1.1; // the arms start INSIDE the frame, where they are bolted
    const armLen = tip - armX0;
    // the axle stands back by the FLAP radius, not the hub's: it is the compliant tips that
    // sweep the collision extent, which is what reaches an element sitting against the mouth.
    const outer = tip - BB_ROLLER_FLAP_R;
    const inner = f.rail - 0.2; // the transfer roller, at the frame line
    const deep = outer - inner > 1.8;

    // TWO SIDE ARMS — the plates everything else hangs between, on the mouth's own lateral edges
    const armGeo = framePart(`arm:${armLen.toFixed(2)}`, () => [platePlane(armLen, 2.8, 0.3, 2)]);
    for (const s of [1, -1] as const) {
      const arm = new THREE.Mesh(armGeo, solidMat(ALU, 0.45, 0.35));
      arm.position.set(armX0 + armLen / 2, s * (f.half - 0.16), BB_ROLLER_Z + 0.5);
      g.add(cast(arm));
    }

    const barrel = f.half * 2 - 0.9;
    const rollerGeo = framePart(`roller:${barrel.toFixed(2)}`, () => {
      const c = new THREE.CylinderGeometry(BB_ROLLER_HUB_R, BB_ROLLER_HUB_R, barrel, 12);
      // compliant flaps: three thin blades down the barrel, which is what makes a spinning
      // roller legible as a roller rather than as a rotating cylinder of one colour
      const parts: THREE.BufferGeometry[] = [c];
      for (let i = 0; i < 3; i++) {
        // the flaps span tip to tip, so each reaches `BB_ROLLER_FLAP_R` from the axle
        const blade = new THREE.BoxGeometry(BB_ROLLER_FLAP_R * 2, barrel, 0.14);
        blade.rotateY((i * Math.PI) / 3);
        parts.push(blade);
      }
      return parts;
    });
    const roll = new THREE.Mesh(rollerGeo, solidMat(SWEEPER, 0.5, 0.25));
    roll.name = `robot:sweeper:${m.edge}`;
    roll.position.set(outer, 0, BB_ROLLER_Z);
    g.add(cast(roll));
    rollers.push(roll);

    if (deep) {
      const t = new THREE.Mesh(rollerGeo, solidMat(SWEEPER, 0.5, 0.25));
      t.name = `robot:transfer:${m.edge}`;
      t.scale.set(0.62, 1, 0.62);
      t.position.set(inner, 0, BB_ROLLER_Z + 0.9);
      g.add(cast(t));
      rollers.push(t);
      // the BELTS down the inside of each arm, linking the two shafts
      for (const s of [1, -1] as const) {
        const belt = new THREE.Mesh(
          new THREE.BoxGeometry(outer - inner, 0.12, 0.5),
          solidMat(SWEEPER, 0.8, 0),
        );
        belt.position.set((outer + inner) / 2, s * (f.half - 0.45), BB_ROLLER_Z + 0.45);
        g.add(belt);
      }
    }
    nodes.push(g);
  }
  return { nodes, rollers };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE HOODED FLYWHEEL (owner playtest #10)
// ─────────────────────────────────────────────────────────────────────────────

/** flywheel radius (in) — a 4-in compliant wheel pair on one axle. */
const BB_FLYWHEEL_R = 2.0;
/** how much a POLLEN is squeezed between the wheel and the hood (in). */
const BB_HOOD_COMPRESSION = 0.3;
/** the hood's inner radius about the flywheel axle: wheel + one element diameter, less the
 * compression. A 3-in POLLEN (`BB_POLLEN_R` 1.5) has to fit through it, which is the whole
 * dimension chain — change the element and the hood follows. */
const BB_HOOD_R = BB_FLYWHEEL_R + BB_POLLEN_R * 2 - BB_HOOD_COMPRESSION;
/** the radius the element's CENTRE travels at, which is what puts the exit where it is. */
const BB_HOOD_PATH_R = BB_HOOD_R - BB_POLLEN_R;
/** how far round the wheel the hood wraps, from the feed to the exit (rad ≈ 115°). */
const BB_HOOD_WRAP = 2.0;
/** the channel the element runs down — the same gap the 2D sprite draws between its plates. */
const BB_HOOD_W = BB_LAUNCH_PLATE_GAP;
/** the radius the side plate's open ends are filleted to (in). See `shooterPlate`. */
const BB_PLATE_END_R = 0.8;
/** the side plate's outer radius. Module-level because the BRACING is placed off it. */
const BB_PLATE_R_OUT = BB_HOOD_R + 0.5;
/**
 * How far the plate runs PAST the feed (rad).
 *
 * ⚠️ ZERO, AND THE DECK IS WHY (owner, 2026-09-19: "the plate is meshing with the chassis, the
 * plate should not be going downwards"). The head hangs off its MUZZLE at `BB_LAUNCH_Z0` = 10
 * with the axle `BB_HOOD_PATH_R` = 3.1 below it, so the axle sits at z 6.9 and the plate's rim
 * at angle θ sits at `6.9 + BB_PLATE_R_OUT·sin θ`. Past `thFeed` that term goes sharply
 * negative: the old 0.55 tail put the rim at **2.75**, which is 1.85 in BELOW the 4.6-in deck —
 * the plate was drawn THROUGH the chassis it stands on. The largest tail that keeps the rim on
 * the deck is 0.049 rad, i.e. none worth having; at 0 the rim sits at 4.82, a fifth of an inch
 * clear. The feed ramp is unaffected — it is built in the head's own frame and does not need
 * plate behind it to exist.
 */
const BB_PLATE_TAIL = 0;
/**
 * THE BRACING — three ribs strapped ACROSS the back of the hood, tying the two side plates
 * together. Angles about the FLYWHEEL AXLE (0 = +x, CCW, the frame `thExit`/`thFeed` are in).
 *
 * ⚠️ THE RIBS RIDE ON THE HOOD'S OUTER FACE, AND THAT IS THE ONLY PLACE ANYTHING MAY CROSS THE
 * CHANNEL. The element's path is three regions and a brace may enter none of them: the WRAP, an
 * annulus of `BB_HOOD_PATH_R ± BB_POLLEN_R` over `[thExit, thFeed]`; the OUTGOING CORRIDOR, the
 * same band of heights running out along +x from the muzzle; and the FEED APPROACH, the run up
 * the ramp into the wrap's far end. Work through what is left and the answer is forced:
 *  · the plate's forward end sits at z ≈ 3.9 about the axle with x > 0, INSIDE the corridor, so
 *    the obvious nose standoff is out;
 *  · a standoff inboard of the wrap goes through the flywheel, which spins in the same channel;
 *  · the tail behind the feed is clear, but the whole of it hangs BELOW the deck — a brace there
 *    is a brace buried in the chassis, which answers the complaint with something nobody sees.
 * OUTBOARD of the hood shell is clear by construction, because the hood IS what holds the
 * element in. The RENDER lane re-derives all of it rather than trusting this.
 *
 * ⚠️ AND THE RIBS SIT PROUD OF THE PLATE RIM, NOT FLUSH INSIDE IT (owner, 2026-09-19: "i dont
 * see the bracing"). Tucked at `BB_HOOD_R + 0.28` their outer face landed at exactly
 * `BB_PLATE_R_OUT`, so the plate occluded them from every side view and they only ever showed
 * from behind. A strap that ties two plates together belongs OVER them anyway, which is both
 * what a builder would do and what can be seen.
 */
const BB_BRACE_T = 0.22;
const BB_BRACE_LEN = 0.9;
const BB_BRACE_RADIUS = BB_PLATE_R_OUT + BB_BRACE_T / 2;
const BB_BRACE_ANGLES: readonly number[] = [1.85, 2.45, 3.05];

/**
 * ONE SHOOTER ASSEMBLY, WITH ITS EXIT AT THE ORIGIN.
 *
 * ⚠️ THE ORIGIN IS THE MUZZLE, and that is not a stylistic choice: the sim releases every
 * element at `bbMuzzleZ` = `BB_LAUNCH_Z0` from `bbTurretOrigin`, at the turret's yaw and pitch,
 * whatever the pitch is (`robot.ts`). Hanging the assembly off its exit is the only arrangement
 * where the visible muzzle is at that exact point and pointing that exact way at EVERY
 * elevation — pivot anywhere else and the picture and the physics agree at one angle only.
 *
 * Local frame: +x is the shot direction, +z up, the axle along y. The element enters at the
 * bottom rear, is pinched between the flywheel and the hood, climbs the back of the wheel and
 * leaves over the top along +x. The hood is a real arc — `Shape.absarc` twice and an extrusion —
 * at `BB_HOOD_R` about the axle, so the gap it leaves is one POLLEN diameter less the
 * compression, which is the thing a hood IS.
 */
function buildShooterHead(): THREE.Group {
  const head = new THREE.Group();
  const cz = -BB_HOOD_PATH_R; // the flywheel axle, directly below the exit
  const thExit = Math.PI / 2;
  const thFeed = thExit + BB_HOOD_WRAP;

  // THE HOOD — an annular sector, extruded across the channel
  const hoodGeo = framePart('hood', () => {
    const t = 0.28;
    const shape = new THREE.Shape();
    shape.absarc(0, 0, BB_HOOD_R, thExit, thFeed, false);
    shape.absarc(0, 0, BB_HOOD_R + t, thFeed, thExit, true);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: BB_HOOD_W, bevelEnabled: false, curveSegments: 20 });
    geo.rotateX(Math.PI / 2);
    geo.translate(0, BB_HOOD_W / 2, 0);
    return [geo];
  });
  const hood = new THREE.Mesh(hoodGeo, solidMat(TURRET_BARREL, 0.35, 0.55));
  hood.name = 'bb-turret-hood';
  hood.position.z = cz;
  head.add(cast(hood));

  // TWO SIDE PLATES. A "C" following the hood, plus a hub at the axle — NOT a full disc. A disc
  // was the first attempt and it hid the whole mechanism: from any angle the shooter read as a
  // spool, because the only things visible were two circles. The band leaves the front-bottom
  // quadrant open, which is where the flywheel, the muzzle and the hood's gap actually show.
  //
  // ⚠️ THE OPEN ENDS ARE SQUARE, NOT POINTED (owner playtest, 2026-09-19: "this sharp corner
  // that looks ugly and serves no purpose"). The band used to terminate in a bare radial cut,
  // which meets the outer arc at a hard corner sticking a full `BB_PLATE_END_R` proud of
  // everything around it — nothing on a milled plate ends like that. Each end is now a FLAT,
  // SQUARE end face down the radial line with its outer corner radiused. The fillet only ever
  // REMOVES material, so the open sector cannot shrink: a rounded cap over the whole 4-in plate
  // depth would have bulged ~38° back into the opening at each end, and at the exit end that
  // lobe lands squarely in the element's outgoing corridor.
  const plateGeo = framePart('shooterPlate', () => {
    // ⚠️ THE BAND REACHES IN PAST THE FLYWHEEL RIM, AND HAS TO. A first answer to "the plate
    // does not have to be that big" started it at `BB_FLYWHEEL_R + 0.2` = 2.20, which left a
    // bare annulus between the hub disc (1.05) and the band with the flywheel's own 2.00 rim
    // sitting in it — owner: "the flywheel looks like it is not constrained to the plate
    // anymore". A side plate is what the flywheel is journalled in; it must bridge the hub to
    // the hood or the wheel reads as floating. The plate got smaller the way it should have in
    // the first place, by not hanging below the deck — see `BB_PLATE_TAIL`.
    const rIn = BB_FLYWHEEL_R * 0.52;
    const rOut = BB_PLATE_R_OUT;
    const th0 = thExit - 0.5;
    const th1 = thFeed + BB_PLATE_TAIL;
    const dth = BB_PLATE_END_R / rOut; // the angle the fillet eats out of the outer arc
    const cx = (r: number, th: number): number => Math.cos(th) * r;
    const cy = (r: number, th: number): number => Math.sin(th) * r;
    const band = new THREE.Shape();
    // start on the th0 end face, one fillet radius in from the outer arc...
    band.moveTo(cx(rOut - BB_PLATE_END_R, th0), cy(rOut - BB_PLATE_END_R, th0));
    // ...round that corner onto the outer arc (the true corner is the control point, the same
    // rounded-corner idiom `platePlane` uses)...
    band.quadraticCurveTo(cx(rOut, th0), cy(rOut, th0), cx(rOut, th0 + dth), cy(rOut, th0 + dth));
    band.absarc(0, 0, rOut, th0 + dth, th1 - dth, false);
    // ...and off it again at the far end
    band.quadraticCurveTo(cx(rOut, th1), cy(rOut, th1), cx(rOut - BB_PLATE_END_R, th1), cy(rOut - BB_PLATE_END_R, th1));
    band.lineTo(cx(rIn, th1), cy(rIn, th1)); // THE SQUARE END FACE
    band.absarc(0, 0, rIn, th1, th0, true);
    band.closePath(); // the other square end face
    const hub = new THREE.Shape();
    hub.absarc(0, 0, 1.05, 0, Math.PI * 2, false);
    const extrude = (s: THREE.Shape): THREE.ExtrudeGeometry => {
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.22, bevelEnabled: false, curveSegments: 20 });
      g.rotateX(Math.PI / 2);
      g.translate(0, 0.11, 0);
      return g;
    };
    return [extrude(band), extrude(hub)];
  });
  for (const s of [1, -1] as const) {
    const plate = new THREE.Mesh(plateGeo, solidMat(ALU, 0.4, 0.45));
    plate.position.set(0, s * (BB_HOOD_W / 2 + 0.11), cz);
    head.add(cast(plate));
  }

  // THE BRACING — three ribs over the hood's back, one merged mesh. Two unsupported plates
  // holding a flywheel apart is not a machine anybody would build; these are what stops them
  // splaying, and they hold the hood down at the same time. Each spans the full channel plus
  // both plate thicknesses, so it ends FLUSH with a plate's outer face (`BB_HOOD_W / 2 + 0.11`
  // is the plate's mid-plane and 0.22 is its thickness) — a rib that stops short of the plate is
  // a rib that braces nothing.
  const braceGeo = framePart('shooterBrace', () => {
    const parts: THREE.BufferGeometry[] = [];
    for (const th of BB_BRACE_ANGLES) {
      const g = new THREE.BoxGeometry(BB_BRACE_LEN, BB_HOOD_W + 0.44, BB_BRACE_T);
      // lay the rib's long axis TANGENTIAL to the hood: a rotation about y maps the box's local
      // +x to `(cos a, −sin a)` in this x–z frame, and the tangent at `th` is `(−sin th, cos th)`,
      // which is `a = −(th + π/2)`. Radial and it would stand off the hood like a fin.
      g.rotateY(-(th + Math.PI / 2));
      g.translate(Math.cos(th) * BB_BRACE_RADIUS, 0, Math.sin(th) * BB_BRACE_RADIUS);
      parts.push(g);
    }
    return parts;
  });
  const braces = new THREE.Mesh(braceGeo, solidMat(ALU, 0.35, 0.55));
  braces.name = 'bb-shooter-brace';
  braces.position.z = cz;
  head.add(cast(braces));

  // THE FLYWHEEL — two stacked compliant wheels on one axle
  const fwGeo = wheelGeometry(BB_FLYWHEEL_R, 1.15);
  for (const s of [1, -1] as const) {
    const w = new THREE.Mesh(fwGeo, solidMat(SWEEPER, 0.45, 0.2));
    w.position.set(0, s * 0.62, cz);
    head.add(cast(w));
  }
  const axle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.26, 0.26, BB_HOOD_W + 1.3, 8),
    solidMat(ALU, 0.3, 0.7),
  );
  axle.position.z = cz;
  head.add(axle);

  // THE MOTOR AND ITS PULLEY, outboard of the left plate — the part that says it is driven. The
  // motor's axis is the AXLE's (local y): a shooter motor hangs alongside the wheel it belts to,
  // and standing it vertically (the first attempt) read as a bottle bolted to the plate.
  const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 3.2, 10), solidMat(MOTOR, 0.5, 0.4));
  motor.position.set(-BB_HOOD_R * 0.6, BB_HOOD_W / 2 + 1.9, cz - BB_FLYWHEEL_R * 0.5);
  head.add(cast(motor));
  const pulley = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.3, 10), solidMat(ALU_DK, 0.4, 0.5));
  pulley.position.set(0, BB_HOOD_W / 2 + 0.55, cz);
  head.add(cast(pulley));
  const belt = new THREE.Mesh(
    new THREE.BoxGeometry(BB_HOOD_R * 0.6, 0.14, 0.42),
    solidMat(SWEEPER, 0.85, 0),
  );
  belt.position.set(-BB_HOOD_R * 0.3, BB_HOOD_W / 2 + 0.55, cz - BB_FLYWHEEL_R * 0.25);
  head.add(belt);

  // THE FEED RAMP — where an element arrives from the hopper, under the back of the wheel
  const entry = new THREE.Vector3(Math.cos(thFeed) * BB_HOOD_R, 0, cz + Math.sin(thFeed) * BB_HOOD_R);
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(3.6, BB_HOOD_W, 0.24), solidMat(ALU, 0.45, 0.35));
  ramp.position.set(entry.x - 1.5, 0, entry.z - 1.0);
  ramp.rotation.y = -0.55;
  head.add(cast(ramp));

  // THE MUZZLE, as a named empty at the origin: the one node a caller can read the world-space
  // exit off, and what the RENDER lane measures against `BB_LAUNCH_Z0`.
  const exit = new THREE.Object3D();
  exit.name = 'bb-turret-exit';
  head.add(exit);
  return head;
}

/**
 * ONE TURRET, BOLTED TO THE DECK.
 *
 * ⚠️ `BB_DECK_Z`, NOT 0 AND NOT `heightIn` — and both mistakes have shipped. Day 1 put the ring
 * at z = 1, INSIDE the chassis box, so every robot was a featureless slab; the fix then raised it
 * to the top of the full-height box, which stood the shooter a foot and a half up in the air for
 * no reason anything could see. It is bolted to the DECK, like the real thing.
 *
 * THE NODE NAMES ARE AN INTERFACE. `bb-turret-head` is the YAW pivot (it carries the turret's own
 * world heading minus the chassis's), `bb-turret-pitch` is the ELEVATION pivot under it, and
 * `bb-turret-exit` is the muzzle. Anything that wants to aim this turret — the per-frame sync
 * below, the reticle, a future auto-aim — rotates those two and reads that one.
 */
function buildTurret(spec: RobotSpec, mountPos: BbMountPos): THREE.Group {
  const group = new THREE.Group();
  const ring = turretRadius(spec);
  const local = turretLocal(spec, mountPos);
  group.name = 'bb-turret';
  group.position.set(local.x, local.y, BB_DECK_Z);

  // THE SLEW RING STAYS WITH THE CHASSIS — the toothed outer race is bolted to the frame and the
  // head turns on it, which is the same statement `drawRobot.ts` makes in 2D.
  const ringMesh = new THREE.Mesh(new THREE.CylinderGeometry(ring, ring, 1.1, 18), solidMat(TURRET_RING, 0.4, 0.5));
  ringMesh.rotation.x = Math.PI / 2;
  ringMesh.position.z = 0.55;
  group.add(cast(ringMesh));

  const head = new THREE.Group();
  head.name = 'bb-turret-head';
  head.position.z = BB_LAUNCH_Z0 - BB_DECK_Z; // the yaw axis meets the muzzle height here
  // THE TOWER — two posts from the ring up to the shooter, turning with the head
  const postH = BB_LAUNCH_Z0 - BB_DECK_Z - 1.0;
  for (const s of [1, -1] as const) {
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.7, postH),
      solidMat(ALU_DK, 0.45, 0.4),
    );
    post.position.set(-ring * 0.45, s * (BB_HOOD_W / 2 + 0.5), -BB_LAUNCH_Z0 + BB_DECK_Z + postH / 2 + 0.55);
    head.add(cast(post));
  }

  const pitch = buildShooterHead();
  pitch.name = 'bb-turret-pitch';
  head.add(pitch);
  group.add(head);
  group.userData.head = head;
  group.userData.pitch = pitch;
  return group;
}

/**
 * THE DUMPER — a pivoted tray, not a flywheel (`bbLaunch` throws its whole hopper over one edge
 * as a lob). Two throwing arms off a shaft well inside the frame, a tray floor between them and
 * the release lip at the mounted edge, `BB_LAUNCH_Z0` off the tile so the elements leave where
 * the sim says they do. APPROX size: BIOBUZZ publishes no dumper hardware.
 */
function buildDumper(spec: RobotSpec, launcher: BbLauncherSpec): THREE.Group {
  const edge = bbShooterEdgeOf({ shooterMount: launcher.mount });
  const { dist, span } = edgeGeom(spec, edge);
  const group = new THREE.Group();
  group.name = 'robot:dumper';
  group.rotation.z = EDGE_ANGLE[edge];
  const half = span * 0.86;
  const pivot = dist - Math.min(8, dist * 0.8);
  const lip = dist - 0.7;
  const len = lip - pivot;
  const mat = solidMat(DUMPER_BUCKET, 0.5, 0.3);

  const tray = framePart(`dumper:${len.toFixed(2)}|${half.toFixed(2)}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    // floor, tilted up toward the lip
    const floor = new THREE.BoxGeometry(len, half * 2, 0.22);
    floor.rotateY(-0.22);
    floor.translate(pivot + len / 2, 0, BB_LAUNCH_Z0 - 1.5);
    parts.push(floor);
    // the two throwing arms, and the lip they end in
    for (const s of [1, -1] as const) {
      const arm = new THREE.BoxGeometry(len, 0.3, 1.9);
      arm.rotateY(-0.22);
      arm.translate(pivot + len / 2, s * (half - 0.15), BB_LAUNCH_Z0 - 1.1);
      parts.push(arm);
    }
    parts.push(boxAt(0.6, half * 2, 0.5, lip, 0, BB_LAUNCH_Z0 - 0.25));
    // the BACK WALL over the pivot — without it the tray reads as a plank rather than a bucket
    parts.push(boxAt(0.3, half * 2, 2.6, pivot + 0.4, 0, BB_LAUNCH_Z0 - 2.4));
    // the pivot shaft, and the two posts that hold it over the deck
    const shaft = new THREE.CylinderGeometry(0.34, 0.34, half * 2, 8);
    shaft.translate(pivot, 0, BB_LAUNCH_Z0 - 2.3);
    parts.push(shaft);
    for (const s of [1, -1] as const) {
      parts.push(boxAt(0.6, 0.6, BB_LAUNCH_Z0 - 2.3 - BB_DECK_Z, pivot, s * (half - 0.3), (BB_LAUNCH_Z0 - 2.3 + BB_DECK_Z) / 2));
    }
    return parts;
  });
  group.add(cast(new THREE.Mesh(tray, mat)));
  return group;
}

/**
 * ONE ROBOT'S `THREE.Group`, BUILT FROM ITS SPEC — and the ONLY generator there is.
 *
 * The builder's 3D preview (`renderPreview.ts`) and the saved-robot thumbnails call THIS
 * function, not a second drawing of the same robot: that is roadmap item 1's stated risk
 * ("preview and match must not drift") answered structurally rather than by a habit. It takes a
 * spec, an id and an alliance rather than a `RobotState` for exactly that reason — a preview has
 * no pose, no hopper and no world, and asking it to fake one would have been the seam where the
 * two pictures started to differ.
 *
 * ── THE ALLIANCE AND THE COSMETIC COLOUR (roadmap item 1) ──────────────────────────────────
 * The chassis FILL is the supporter cosmetic (`chassisFill`, the 7-key allowlist in
 * `src/config.ts`) — it goes on the drivetrain side plates and the deck — and the ALLIANCE is
 * the silhouette line plus the sign panel, the same split the 2D sprite has always made
 * (`drawRobot.ts`). Scoping the cosmetic to the FILL is what keeps it from ever making a red
 * robot read as blue, which is the one thing a cosmetic may not do here.
 */
export function buildRobotGroup(spec: RobotSpec, id: number, alliance: Alliance): THREE.Group {
  const group = new THREE.Group();
  group.name = `robot:${id}`;
  const color = alliance === 'blue' ? BLUE : RED;
  const launcher = bbLauncherOf(spec, 0);
  const lift = bbLiftOf(spec);

  for (const part of buildFrame(spec)) group.add(part);
  const wheels = buildWheels(spec);
  for (const w of wheels.nodes) group.add(w);
  // the handles the per-frame sync poses a MOVING drivetrain with. Absent for the three that do
  // not move (a preview has no `RobotState` at all, so both lists are simply empty there).
  group.userData.swervePods = wheels.pods;
  group.userData.butterflySets = { traction: wheels.traction, roller: wheels.roller };

  // THE ALLIANCE LINE, round the BUMPER BAND (the drivetrain) — where an alliance colour sits on
  // a real robot. Scaled out by a whisker so it cannot z-fight with the faces it traces: a
  // co-planar line and surface flicker per pixel per frame, which reads as a rendering fault
  // rather than as an outline.
  const edges = new THREE.LineSegments(chassisEdges(spec.length, spec.width, BB_PLATE_H), lineMat(color));
  edges.name = `robot:${id}:outline`;
  edges.position.z = BB_PLATE_H / 2;
  edges.scale.set(1.004, 1.004, 1.002);
  group.add(edges);

  // the NOSE — a small white block on the front cross member, so the forward end of a symmetric
  // drivetrain is readable from any angle
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.7, spec.width * 0.22, 0.5), solidMat(NOSE, 0.3, 0));
  nose.name = `robot:${id}:nose`;
  nose.position.set(spec.length / 2 - 0.55, 0, BB_DECK_Z + 0.25);
  group.add(cast(nose));

  // ALLIANCE SIGN PANEL — a placard on the robot's LEFT side plate (a real pit sign's usual
  // spot), textured once per id via `getSignTexture`.
  const signSize = Math.min(3.6, spec.length * 0.3);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(signSize, signSize),
    new THREE.MeshStandardMaterial({ map: getSignTexture(id, alliance), roughness: 0.6 }),
  );
  sign.name = `robot:${id}:sign`;
  sign.position.set(0, spec.width / 2 + 0.05, BB_PLATE_H * 0.5);
  // a PlaneGeometry's default normal/up (+Z/+Y) cannot be rotated to face outward (+Y) with
  // "up" vertical (+Z) AND "right" un-mirrored in one proper (determinant +1) rotation — normal
  // × up fixes handedness. This orientation is the one that gets normal and up right; the
  // canvas is drawn pre-mirrored (`getSignTexture`) to cancel the resulting left-right flip.
  sign.rotation.set(Math.PI / 2, Math.PI, 0);
  group.add(sign);

  const intake = buildIntake(spec);
  for (const n of intake.nodes) group.add(n);
  group.userData.intakeRollers = intake.rollers;

  const heads: THREE.Group[] = [];
  const pitches: THREE.Group[] = [];
  if (bbIsTurreted(launcher)) {
    const t0 = buildTurret(spec, launcher.mount);
    group.add(t0);
    heads.push(t0.userData.head as THREE.Group);
    pitches.push(t0.userData.pitch as THREE.Group);
    if (launcher.kind === 'twinturret' && launcher.mount2) {
      const t1 = buildTurret(spec, launcher.mount2);
      group.add(t1);
      heads.push(t1.userData.head as THREE.Group);
      pitches.push(t1.userData.pitch as THREE.Group);
    }
  } else if (launcher.kind === 'dumper') {
    group.add(buildDumper(spec, launcher));
  }
  group.userData.turretHeads = heads;
  group.userData.turretPitches = pitches;
  group.userData.launcher = launcher;

  if (lift) {
    const tubeMat = solidMat('#98a3b2', 0.4, 0.4);
    const local = turretLocal(spec, lift.mount);
    const tube = new THREE.Mesh(new THREE.BoxGeometry(3, 1.4, 1.4), tubeMat);
    tube.name = `robot:${id}:tube`;
    // ON the deck, for the reason `buildTurret` explains at length: below it, the Box Tube is
    // inside the frame, where nothing can see it.
    tube.position.set(local.x, local.y, BB_DECK_Z + 0.95);
    group.add(cast(tube));
  }

  return group;
}

/** THE VISUAL HEIGHT OF THE DRIVETRAIN — where the DECK is, for anything that has to reason
 * about it without importing three.js. `BB_DECK_Z` is this number. */
export const BB_DRIVETRAIN_H = BB_PLATE_H;
/** where the hooded flywheel's muzzle sits, by construction — the sim's own release height. The
 * construction that has to keep this true (turret group at the deck, `bb-turret-head` one
 * `BB_LAUNCH_Z0 - BB_DECK_Z` above it, `bb-turret-exit` at the head's local origin) is walked and
 * added up by the RENDER lane, `scripts/smoke-biobuzz/render.ts`. */
export const BB_SHOOTER_MUZZLE_Z = BB_LAUNCH_Z0;

interface RobotEntry {
  group: THREE.Group;
  key: string;
}

export interface BbRobots {
  group: THREE.Group;
  dispose(): void;
}

/** intake roller speed (rad/s at the drawn radius) while it is running. Cosmetic. */
/** ⚠️ THE SIM'S OWN DRAW-IN, AT THE FLAP TIP — not a typed rate. A roller drawn at a surface
 *  speed other than the one the sim walks an element in at is a picture of a different
 *  machine, and at the old 26 rad/s x a 1.0-in barrel it was running at exactly HALF
 *  `BB_INTAKE_DRAW_IN`. Derived, so it cannot fall out of step again. */
const BB_ROLLER_SPIN = BB_INTAKE_DRAW_IN / BB_ROLLER_FLAP_R;

export function buildBiobuzzRobots(): BbRobots {
  const group = new THREE.Group();
  group.name = 'bb-robots';
  const entries = new Map<number, RobotEntry>();
  let lastTime = 0;

  function sync(world: World): void {
    const seen = new Set<number>();
    // the world clock, not a wall clock: this module has no business owning one, and a replay
    // scrub that jumps backwards must not spin a roller a thousand turns to catch up
    const dt = Math.max(0, Math.min(0.2, world.time - lastTime));
    lastTime = world.time;
    for (const r of world.robots) {
      seen.add(r.id);
      const key = bbSpecKey(r.spec);
      let entry = entries.get(r.id);
      if (!entry || entry.key !== key) {
        if (entry) {
          group.remove(entry.group);
          disposeRobotGroup(entry.group);
        }
        const g = buildRobotGroup(r.spec, r.id, r.alliance);
        entry = { group: g, key };
        entries.set(r.id, entry);
        group.add(g);
      }
      entry.group.position.set(r.pos.x, r.pos.y, r.z ?? 0);
      entry.group.rotation.set(0, 0, r.heading);

      // THE INTAKE SPINS WHEN IT IS COLLECTING. Derived from the WORLD alone (the 3D sync never
      // sees a command): a robot on auto-intake with room in its hopper is running, and so is one
      // that took an element in the last fraction of a second, which is the driver-held case.
      const rollers = entry.group.userData.intakeRollers as THREE.Mesh[] | undefined;
      if (rollers && rollers.length > 0) {
        const running = (r.autoIntake || world.time - r.lastIntakeAt < 0.4) && r.hopper.length < bbHopperCap(r.spec);
        if (running) for (const m of rollers) m.rotation.y -= BB_ROLLER_SPIN * dt;
      }

      // THE DRIVETRAIN POSE. Both of these are state the sim already writes and the 3D view was
      // throwing away: a swerve's four pods each slew on their OWN imperfect steering loop
      // (`moduleAngles`, corner order [FL, FR, BL, BR]) and a butterfly's driver drops one of two
      // wheel sets mid-match (`butterflyTank`). Nothing is added to the sim to feed either one.
      const pods = entry.group.userData.swervePods as THREE.Group[] | undefined;
      if (pods) for (let i = 0; i < pods.length; i++) pods[i].rotation.z = r.moduleAngles[i] ?? 0;
      const sets = entry.group.userData.butterflySets as
        | { traction: THREE.Object3D[]; roller: THREE.Object3D[] }
        | undefined;
      if (sets && sets.traction.length > 0) {
        for (const m of sets.traction) m.position.z = BB_WHEEL_R + (r.butterflyTank ? 0 : BB_BUTTERFLY_LIFT);
        for (const m of sets.roller) m.position.z = BB_WHEEL_R + (r.butterflyTank ? BB_BUTTERFLY_LIFT : 0);
      }

      const heads = entry.group.userData.turretHeads as THREE.Group[] | undefined;
      const pitches = entry.group.userData.turretPitches as THREE.Group[] | undefined;
      const launcher = entry.group.userData.launcher as BbLauncherSpec | undefined;
      if (heads && heads.length > 0 && pitches && launcher) {
        // the turret's WORLD yaw is independent of the chassis (`turretHeading`); this group is
        // a child of the chassis group, which already carries `r.heading`, so the child's own
        // rotation only needs the DIFFERENCE. ELEVATION is a separate node under it, because the
        // hood pivots about the muzzle and the tower under it does not.
        heads[0].rotation.z = r.turretHeading - r.heading;
        pitches[0].rotation.y = -(r.bbTurretPitch ?? 0);
        if (heads.length > 1) {
          heads[1].rotation.z = (r.bbTurret2Heading ?? r.turretHeading) - r.heading;
          pitches[1].rotation.y = -(r.bbTurret2Pitch ?? 0);
        }
      }
    }
    for (const [id, entry] of entries) {
      if (!seen.has(id)) {
        group.remove(entry.group);
        disposeRobotGroup(entry.group);
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

/**
 * Free what ONE robot group owns, and nothing that is shared.
 *
 * The per-robot half is every mesh built inline in `buildRobotGroup` — the nose box, the sign
 * plane and its material (its TEXTURE is cached per id and is not touched), the turret ring,
 * posts, axle, motor, pulley, belts and the Box Tube. Anything from `solidMat`, `lineMat`,
 * `getRollerMat`, `wheelGeometry`, `framePart` or `chassisEdges` is left alone: see
 * `SHARED_GEO`'s header. The SWERVE POD is entirely shared — its three merged geometries come
 * from `framePart` and its materials from `solidMat` — so a builder session dragging the
 * drivetrain picker back and forth frees the group and re-uses every buffer in it.
 */
export function disposeRobotGroup(group: THREE.Group): void {
  group.traverse((child) => {
    const mesh = child as Partial<THREE.Mesh>;
    const geo = mesh.geometry;
    if (geo && !SHARED_GEO.has(geo)) geo.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of mats) if (!SHARED_MAT.has(m)) m.dispose();
  });
}

export function updateBiobuzzRobots(robots: BbRobots, world: World): void {
  (robots.group.userData.sync as (w: World) => void)(world);
}
