import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Alliance, RobotSpec, World } from '../../../types';
import { chassisFill, INTAKE_RAIL_T } from '../../../config';
import {
  BB3_MOUTH_SLOT_Z,
  BB_BOX_TUBE_EXTEND_S,
  BB_BOX_TUBE_SECTIONS,
  BB_BOX_TUBE_STAGE_OVERLAP,
  BB_BOX_TUBE_WALL,
  BB_INTAKE_DRAW_IN,
  BB_LAUNCH_PLATE_GAP,
  BB_LAUNCH_Z0,
  BB_POLLEN_R,
  BB_TURRET_PITCH_MAX,
  bbHopperCap,
} from '../config';
import { bbIsTurreted, bbLauncherOf, bbLiftOf, type BbLauncherSpec } from '../mechs';
import { bbBoxTubeGlyph } from '../parts';
import { bbFlowerInReach, bbMouths, bbPlacePointLocal } from '../robot';
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
/** the one BIOBUZZ blue, not the shared `C.COLORS.blue` (`#3b82f6`, a DECODE/CR UI token at
 * OKLCH hue 259.8°). Owner bug 12, 2026-09-19 — `draw.ts`'s `ELEMENT_FILL` header has the
 * measurement and the reason the CAD's own rib colour was NOT taken. */
const BLUE = '#007be1';
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

/**
 * ⚠️ THE HEAD'S RHO BUDGET — the arithmetic every shooter dimension below is bounded by, and
 * the one thing nobody had written down.
 *
 * `buildTurret` puts the yaw node at world z = `BB_LAUNCH_Z0`, and `buildShooterHead` hangs the
 * whole shooter off that point, so the ELEVATION node `bb-turret-pitch` PIVOTS ABOUT THE MUZZLE.
 * That is forced, not stylistic: `bbMuzzleZ` (`robot.ts`) returns `BB_LAUNCH_Z0` at EVERY pitch,
 * so any other pivot puts the picture and the physics together at one angle only.
 *
 * The consequence is the part that was never written down. `pitch.rotation.y = −p` maps a
 * head-frame point `(x, z)` to world z = `BB_LAUNCH_Z0 + x·sin p + z·cos p`, i.e.
 * `BB_LAUNCH_Z0 + ρ·sin(p + φ)` with `ρ = hypot(x, z)`, `φ = atan2(z, x)`. Over the real
 * elevation envelope (`BB_TURRET_PITCH_MIN` 0 … `BB_TURRET_PITCH_MAX` 80°) any point whose φ
 * lies in [110°, 270°] — everything BEHIND and BELOW the muzzle — sweeps through −90° and
 * reaches world z = `BB_LAUNCH_Z0 − ρ` exactly. So:
 *
 *     NOTHING ON THE PITCHING HEAD MAY EXCEED ρ = BB_LAUNCH_Z0 − BB_DECK_Z − clearance.
 *
 * At rest pitch the old head cleared the deck by 0.45 in and looked right, which is why it
 * shipped; at ~44° of elevation its side plate's rear corner was 1.10 in INSIDE the drivetrain
 * and the feed ramp swept the deck, the belly pan and the wheels and stopped 0.04 in off the
 * tile. Hive shots want 40–80° for most of a match, so that is what the owner was looking at.
 * The 0.2 is the deck clearance. `minHeadWorldZ` below is the closed form the RENDER lane
 * re-derives; everything on the head is sized against it rather than eyeballed at rest.
 */
const BB_HEAD_RHO_MAX = BB_LAUNCH_Z0 - BB_DECK_Z - 0.2;

/**
 * The LOWEST world z a head-frame point `(x, z)` reaches over the whole elevation envelope.
 * Closed form, no sampling: the minimum of the two endpoints, or `BB_LAUNCH_Z0 − ρ` when the
 * critical pitch `−π/2 − φ` falls inside the envelope.
 */
function minHeadWorldZ(x: number, z: number): number {
  const rho = Math.hypot(x, z);
  const phi = Math.atan2(z, x);
  const crit = -Math.PI / 2 - phi;
  for (let k = -2; k <= 2; k++) {
    const p = crit + 2 * Math.PI * k;
    if (p >= 0 && p <= BB_TURRET_PITCH_MAX) return BB_LAUNCH_Z0 - rho;
  }
  return BB_LAUNCH_Z0 + rho * Math.min(Math.sin(phi), Math.sin(BB_TURRET_PITCH_MAX + phi));
}

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
/**
 * ⚠️ A POD IS 3-IN WHEELED, NOT 4-IN, AND THE DECK IS WHY (owner, 2026-09-19: swerve protrudes
 * outside the chassis and the module is a box). The whole pod has to live UNDER the deck plate —
 * `[0, BB_DECK_Z − 0.26]` = 4.34 in of headroom — and a 4-in wheel leaves 0.34 in of that for the
 * top plate, the azimuth bearing and the drive, which is why the slew ring ended up standing 1.13
 * in ABOVE the deck, through the structure it is supposed to hang from. A 3-in wheel is what COTS
 * FTC swerve modules actually run, and it makes the stack close: wheel [0, 3.00], fork plates
 * [0.40, 3.60], top plate [3.60, 3.90], slew ring [3.90, 4.34].
 */
const BB_POD_WHEEL_R = 1.5;
/** thickness of the fork plate either side of the wheel, and the clearance out to it. */
const BB_POD_FORK_T = 0.3;
/** the toothed steering ring / pulley the pod is slewed by. */
const BB_POD_RING_R = 1.25;
const BB_POD_RING_H = 0.44;
/** how far proud of the race the toothed flange stands — what makes the ring read as a pulley
 *  being driven rather than as another puck. */
const BB_POD_RING_FLANGE = 0.15;
/** the pod's top plate, UNDER the ring, which is in turn under the deck plate's own underside. */
const BB_POD_PLATE_Z = BB_DECK_Z - 0.26 - BB_POD_RING_H;
/** where each fork plate's mid-plane sits either side of the wheel. */
const BB_POD_FORK_Y = BB_WHEEL_W / 2 + 0.2;
/** the pod's drive: a pulley on the wheel axle and a second at the top plate, with a belt
 *  between them down the OUTBOARD face of one fork plate. This is the one part the pod was
 *  missing that says the wheel is DRIVEN as well as steered, and it costs one merged geometry
 *  shared by all four corners. */
const BB_POD_PULLEY_R = 0.45;
const BB_POD_DRIVE_T = 0.2;
/** the pod's box in plan — the fork's length, and the full width out to the drive belt. Both
 *  feed `BB_POD_INSET`, so a wider pod tucks itself further inside the frame automatically. */
const BB_POD_L = 3.2;
const BB_POD_W = (BB_POD_FORK_Y + BB_POD_FORK_T / 2 + BB_POD_DRIVE_T) * 2;
/**
 * ⚠️ HOW FAR IN FROM EACH FRAME FACE A POD MUST SIT, AND WHY IT IS NOT THE WHEEL CHANNEL.
 *
 * A pod slews. A box `BB_POD_L × BB_POD_W` rotated about its own centre has a worst-case
 * half-extent of `hypot(L, W) / 2` on EITHER axis, so that — or the slew ring's flange, whichever
 * is larger — is the inset from each frame face. The pods used to sit in the wheel channel at
 * `hw − 1.17` against a requirement of 1.94, which measured +0.46 in outside the frame at rest
 * (the ring) and +0.88 at 45° of steer (the fork box). A wheel may REACH the frame edge; nothing
 * may cross it, because `chassis3dShapes` gives the physics a flat frame face there and a mesh
 * claiming solid the collider does not have is this repo's recurring bug.
 */
const BB_POD_INSET = Math.max(Math.hypot(BB_POD_L, BB_POD_W) / 2, BB_POD_RING_R + BB_POD_RING_FLANGE);
/* ⚠️ NO MOTOR ON TOP OF THE POD (owner, 2026-09-19: "the motor for swerve does NOT go on top of
 * the swerve module"). A first pass stood a can on the slew ring; that is not where a swerve
 * steering motor lives. It sits on the DECK and drives the ring through the belt or gear the ring
 * is toothed for, so the pod carries the ring and nothing above it. The ring is what says the pod
 * is STEERED; the belt down the fork below is what says the wheel is also DRIVEN. */
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
  const forkY = BB_POD_FORK_Y;
  const forkZ0 = 0.4; // the fork plate's bottom, clear of the tiles
  const struct = framePart('swervePod:struct', () => {
    const parts: THREE.BufferGeometry[] = [];
    // TWIN FORK PLATES carrying the axle, one either side of the wheel — the SIDE PLATES the
    // owner asked for, and they stop below the top plate rather than running past it
    for (const s of [1, -1] as const) {
      parts.push(
        boxAt(BB_POD_L, BB_POD_FORK_T, BB_POD_PLATE_Z - forkZ0, 0, s * forkY, (BB_POD_PLATE_Z + forkZ0) / 2),
      );
    }
    // THE TOP PLATE the fork hangs off
    parts.push(boxAt(BB_POD_L, forkY * 2 + BB_POD_FORK_T, 0.3, 0, 0, BB_POD_PLATE_Z - 0.15));
    // THE KINGPIN — the vertical steering axis itself, through the contact patch. It shows in
    // the gap between the wheel's crown and the top plate, which is the only place it can.
    const pin = new THREE.CylinderGeometry(0.28, 0.28, BB_POD_PLATE_Z - 0.3 - BB_POD_WHEEL_R * 2, 8);
    pin.rotateX(Math.PI / 2);
    pin.translate(0, 0, (BB_POD_WHEEL_R * 2 + BB_POD_PLATE_Z - 0.3) / 2);
    parts.push(pin);
    return parts;
  });
  const ringZ = BB_POD_PLATE_Z + BB_POD_RING_H / 2;
  const ring = framePart('swervePod:ring', () => {
    const parts: THREE.BufferGeometry[] = [];
    const race = new THREE.CylinderGeometry(BB_POD_RING_R, BB_POD_RING_R, BB_POD_RING_H, 20);
    race.rotateX(Math.PI / 2);
    race.translate(0, 0, ringZ);
    parts.push(race);
    // the TOOTHED flange — a thin disc a little proud of the race, which is what makes the ring
    // read as a pulley being driven rather than as another puck
    const flange = new THREE.CylinderGeometry(
      BB_POD_RING_R + BB_POD_RING_FLANGE,
      BB_POD_RING_R + BB_POD_RING_FLANGE,
      0.15,
      20,
    );
    flange.rotateX(Math.PI / 2);
    flange.translate(0, 0, ringZ + BB_POD_RING_H / 2 - 0.075);
    parts.push(flange);
    return parts;
  });
  // THE BELT DRIVE, down the outboard face of one fork plate: a pulley on the wheel's own axle,
  // a second under the top plate, and the belt between them. Without it the pod is a steered
  // caster, which is not what a swerve module is.
  const driveY = forkY + BB_POD_FORK_T / 2 + BB_POD_DRIVE_T / 2;
  const topZ = BB_POD_PLATE_Z - 0.3 - BB_POD_PULLEY_R - 0.05;
  const drive = framePart('swervePod:drive', () => {
    const parts: THREE.BufferGeometry[] = [];
    for (const z of [BB_POD_WHEEL_R, topZ]) {
      const p = new THREE.CylinderGeometry(BB_POD_PULLEY_R, BB_POD_PULLEY_R, BB_POD_DRIVE_T, 12);
      p.translate(0, driveY, z);
      parts.push(p);
    }
    for (const s of [1, -1] as const) {
      parts.push(
        boxAt(0.14, BB_POD_DRIVE_T, topZ - BB_POD_WHEEL_R, s * BB_POD_PULLEY_R, driveY, (topZ + BB_POD_WHEEL_R) / 2),
      );
    }
    return parts;
  });
  return [
    cast(new THREE.Mesh(struct, solidMat(ALU, 0.45, 0.35))),
    cast(new THREE.Mesh(ring, solidMat(TURRET_RING, 0.4, 0.5))),
    cast(new THREE.Mesh(drive, solidMat(SWEEPER, 0.6, 0.2))),
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
  const hl = spec.length / 2;
  const hw = spec.width / 2;
  const dt = spec.drivetrain;
  const mat = dt === 'tank' ? solidMat(TREAD, 0.95, 0) : getRollerMat(dt === 'xdrive' ? 'omni' : 'mecanum');
  const geo = wheelGeometry(BB_WHEEL_R, BB_WHEEL_W);
  const podWheelGeo = wheelGeometry(BB_POD_WHEEL_R, BB_WHEEL_W);
  for (const x of axleXs(spec)) {
    for (const sy of [1, -1] as const) {
      // CylinderGeometry's axis is local Y by default — exactly a wheel's axle direction
      // (chassis left-right), so the flat discs already face outward with no rotation needed.
      const wheel = new THREE.Mesh(dt === 'swerve' ? podWheelGeo : geo, mat);
      cast(wheel);
      if (dt === 'swerve') {
        // ── ORDER MATTERS. `axleXs` yields [+x, −x] and the inner loop [+y, −y], so the pods
        // come out FL, FR, BL, BR — the corner order `RobotState.moduleAngles` is documented in
        // and the order `drawWheels` reads it in. Two orders would put a pod's steer on the
        // diagonally opposite corner, which is invisible driving straight and obvious in a spin.
        //
        // ⚠️ A POD DOES NOT LIVE IN THE WHEEL CHANNEL. It is inset `BB_POD_INSET` from BOTH
        // frame faces, which is the only placement that keeps every corner of a SLEWING box
        // inside the frame; `wheelY` (the channel between the two side plates) measured +0.88 in
        // outside it at 45° of steer. `buildFrame` drops the inner side plate for swerve to make
        // room, because a chassis on pods has no wheel channel to draw.
        const pod = new THREE.Group();
        pod.name = `robot:pod:${out.pods.length}`;
        pod.position.set((Math.sign(x) || 1) * (hl - BB_POD_INSET), sy * (hw - BB_POD_INSET), 0);
        wheel.position.set(0, 0, BB_POD_WHEEL_R);
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

  // ⚠️ A SWERVE CHASSIS HAS NO WHEEL CHANNEL. The pods bolt UNDER a box frame at `BB_POD_INSET`
  // from each face, and a 1.5-in-wide pod wheel there runs straight through an inner side plate
  // at `innerY` — so for swerve there is one plate a side, at the frame line, and nothing behind
  // it. The footprint is unchanged either way: the OUTER plate's outer face is still the frame.
  const plateYs = spec.drivetrain === 'swerve' ? [outerY] : [outerY, innerY];

  const skin = framePart(`skin:${key}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    for (const sy of [1, -1] as const) {
      for (const y of plateYs) {
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
/** how many compliant flaps go round the hub. */
const BB_ROLLER_FLAPS = 3;
/** the flaps' thickness (in) — half of it is what the deflection law has to clear the slot by. */
const BB_ROLLER_FLAP_T = 0.14;
/** where a flap tip has to be held to leave the collider's pocket genuinely open (in). */
const BB_ROLLER_PASS_Z = BB3_MOUTH_SLOT_Z + BB_ROLLER_FLAP_T / 2;

/**
 * HOW FAR A FLAP IS FOLDED BACK at hub angle `a` (rad, 0 = +x, CCW in the mouth's x–z plane).
 *
 * ⚠️ THIS IS WHAT MAKES "PASS UNDER" TRUE IN THE PICTURE, AND IT RUNS WHETHER OR NOT THE ROLLER
 * IS SPINNING (owner, 2026-09-19: an element must still be able to pass under the roller).
 * `chassis3dShapes` leaves the mouth's pocket open from the tiles to `BB3_MOUTH_SLOT_Z` and the
 * roller is not a collider in either backend — so the only thing that could ever block that
 * pocket is the DRAWING, and a rigid flap sweeping to `BB_ROLLER_FLAP_R` blocks it by 1.1 in.
 *
 * A flap is hinged at the hub rim, so its tip sits at `hypot`-by-cosine-rule radius
 * `√(hub² + L² + 2·hub·L·cos d)`. Solve that for the radius the slot allows and you get the
 * fold: none at all over the top of the sweep, total at bottom dead centre. That IS compliance —
 * "grip when driven, yield when not" — rather than an animation laid over a rigid part.
 */
function flapFold(a: number): number {
  const L = BB_ROLLER_FLAP_R - BB_ROLLER_HUB_R;
  // how far BELOW the roller's own axis a flap tip may reach (negative)
  const target = BB_ROLLER_PASS_Z - BB_ROLLER_Z;
  const sa = Math.sin(a);
  // the tip sits at `hub·sin a + L·sin(a − fold)`, so this is the sine the folded flap needs
  const s = (target - BB_ROLLER_HUB_R * sa) / L;
  if (sa >= s) return 0; // unfolded already clears it — no load, no yield
  // `sin φ ≥ s` holds on [asin s, π − asin s], and `s` is always negative here (the hinge alone
  // can never be `target` low), so the nearest edge going BACKWARD is the upper one
  const phi = Math.PI - Math.asin(Math.max(-1, Math.min(1, s)));
  const norm = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.max(0, norm - phi);
}

/** ONE drawn roller: the hub that spins, and the flaps that are posed from the phase. */
interface BbRoller {
  hub: THREE.Object3D;
  flaps: THREE.Object3D[];
  phase: number;
}

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
function buildIntake(spec: RobotSpec): { nodes: THREE.Object3D[]; rollers: BbRoller[] } {
  const nodes: THREE.Object3D[] = [];
  const rollers: BbRoller[] = [];
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

    // ── TWO SIDE ARMS, AS AN OPEN TRUSS ───────────────────────────────────────────────────
    // ⚠️ NOT A SOLID PLATE (owner, 2026-09-19: the intake's sides must not be solid aluminium).
    // Each arm was a `platePlane(armLen, 2.8, 0.3, 2)` — a 4.1 × 2.8 in wall standing in front of
    // the mechanism, 3D only, while the 2D sprite has always drawn open rails. It is three
    // members now (bottom rail, axle boss, diagonal) and NO member is thicker than
    // `INTAKE_RAIL_T`, which is what the COLLIDER claims for a flank rail: the drawn arm must
    // never claim more solid than the physics has.
    const armT = INTAKE_RAIL_T;
    const railZ = BB3_MOUTH_SLOT_Z + 0.25; // the rail's own centre — its underside IS the pocket
    const bossTop = BB_ROLLER_Z + 0.6;
    const armGeo = framePart(`arm:${armLen.toFixed(2)}|${(outer - armX0).toFixed(2)}`, () => {
      const parts: THREE.BufferGeometry[] = [];
      // (1) THE BOTTOM RAIL, its underside flush with the collider's open pocket
      parts.push(boxAt(armLen, armT, 0.5, armX0 + armLen / 2, 0, railZ));
      // (2) THE AXLE BOSS, where the roller shaft is carried
      const boss = new THREE.CylinderGeometry(0.55, 0.55, armT, 12);
      boss.translate(outer, 0, BB_ROLLER_Z);
      parts.push(boss);
      parts.push(boxAt(0.45, armT, bossTop - railZ, outer, 0, (bossTop + railZ) / 2));
      // (3) THE DIAGONAL, from the rail's outer end back up to where the arm is bolted on
      const dx = armX0 - (armX0 + armLen);
      const dz = bossTop - railZ;
      const diag = new THREE.BoxGeometry(Math.hypot(dx, dz), armT, 0.34);
      diag.rotateY(-Math.atan2(dz, dx));
      diag.translate(armX0 + armLen / 2, 0, (railZ + bossTop) / 2);
      parts.push(diag);
      return parts;
    });
    for (const s of [1, -1] as const) {
      const arm = new THREE.Mesh(armGeo, solidMat(ALU, 0.45, 0.35));
      arm.position.set(0, s * (f.half - armT / 2), 0);
      g.add(cast(arm));
    }

    const barrel = f.half * 2 - 0.9;
    const hubGeo = framePart(`rollerHub:${barrel.toFixed(2)}`, () => [
      new THREE.CylinderGeometry(BB_ROLLER_HUB_R, BB_ROLLER_HUB_R, barrel, 12),
    ]);
    // the flap blade runs from the HINGE at the hub rim outward, so it is built with its inner
    // end at its own origin: the flap group carries the hinge, and `flapFold` the yield
    const flapGeo = framePart(`rollerFlap:${barrel.toFixed(2)}`, () => [
      boxAt(
        BB_ROLLER_FLAP_R - BB_ROLLER_HUB_R,
        barrel,
        BB_ROLLER_FLAP_T,
        (BB_ROLLER_FLAP_R - BB_ROLLER_HUB_R) / 2,
        0,
        0,
      ),
    ]);
    const roll = new THREE.Group();
    roll.name = `robot:sweeper:${m.edge}`;
    roll.position.set(outer, 0, BB_ROLLER_Z);
    const hubMesh = cast(new THREE.Mesh(hubGeo, solidMat(SWEEPER, 0.5, 0.25)));
    roll.add(hubMesh);
    const flaps: THREE.Object3D[] = [];
    for (let i = 0; i < BB_ROLLER_FLAPS; i++) {
      const flap = new THREE.Group();
      flap.add(cast(new THREE.Mesh(flapGeo, solidMat(SWEEPER, 0.5, 0.25))));
      roll.add(flap);
      flaps.push(flap);
    }
    g.add(roll);
    rollers.push({ hub: hubMesh, flaps, phase: 0 });

    if (deep) {
      // the TRANSFER roller sits 0.9 in higher, well clear of the pocket, so it stays a plain
      // barrel — there is nothing for a flap of its to yield to
      const t = new THREE.Mesh(hubGeo, solidMat(SWEEPER, 0.5, 0.25));
      t.name = `robot:transfer:${m.edge}`;
      t.scale.set(0.62, 1, 0.62);
      t.position.set(inner, 0, BB_ROLLER_Z + 0.9);
      g.add(cast(t));
      rollers.push({ hub: t, flaps: [], phase: 0 });
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

/**
 * flywheel radius (in) — a 3-in compliant wheel pair on one axle.
 *
 * ⚠️ THIS ONE NUMBER IS THE HEAD OF THE WHOLE DIMENSION CHAIN (hood radius, path radius, axle
 * height, plate radius), and it came down from 2.0 because of `BB_HEAD_RHO_MAX`. At a 4-in wheel
 * the axle sits 3.1 in below the muzzle, which leaves 2.1 in of ρ budget under it — not enough
 * for a motor of any real size, so the motor had nowhere to go but outboard of a plate, which is
 * exactly what the owner objected to. A 3-in compliant wheel is an ordinary FTC shooter wheel,
 * not a compromise made to fit.
 */
const BB_FLYWHEEL_R = 1.5;
/** how much a POLLEN is squeezed between the wheel and the hood (in). */
const BB_HOOD_COMPRESSION = 0.3;
/** the hood's inner radius about the flywheel axle: wheel + one element diameter, less the
 * compression. A 2.8-in POLLEN (`BB_POLLEN_R` 1.4 — and `config.ts` records that 2.8 as MEASURED,
 * AndyMark am-5851, not rounded) has to fit through it, which is the whole dimension chain:
 * change the element and the hood follows. */
const BB_HOOD_R = BB_FLYWHEEL_R + BB_POLLEN_R * 2 - BB_HOOD_COMPRESSION;
/** the radius the element's CENTRE travels at, which is what puts the exit where it is. */
const BB_HOOD_PATH_R = BB_HOOD_R - BB_POLLEN_R;
/**
 * how far round the wheel the hood wraps, from the feed to the exit (rad ≈ 60°).
 *
 * ⚠️ BOUNDED TWICE OVER, AND NEITHER BOUND IS TASTE. (1) `BB_HEAD_RHO_MAX`: the hood's outer
 * corner at the feed runs out of budget first, and at the old 2.0 rad that corner sat at ρ 6.69,
 * i.e. 1.29 in inside the deck at 41° of elevation. (2) THE MOTOR: the feed mouth is where the
 * element sits at its lowest point in this frame, and the only pocket a motor fits in is behind
 * and below the axle — so the wrap has to end early enough to leave that pocket clear of it. At
 * 1.45 rad the mouth is 1.43 in from the motor against an element that is 1.4 in fat; at 1.05 it
 * is 2.40.
 */
const BB_HOOD_WRAP = 1.05;
/** the channel the element runs down — the same gap the 2D sprite draws between its plates. */
const BB_HOOD_W = BB_LAUNCH_PLATE_GAP;
/**
 * the side plate's nominal outer radius, before the ρ clip. Module-level because the BRACING and
 * the MOTOR are placed against it.
 *
 * ⚠️ `+ 0.35`, not `+ 0.5` (owner, 2026-09-19: the plate does not need to be as big as it is). It
 * still has to BRIDGE the hub to the hood or the flywheel reads as unjournalled — the failure
 * `shooterPlate` records below — so this is the smallest bridge that keeps the wheel constrained.
 */
const BB_PLATE_R_OUT = BB_HOOD_R + 0.35;
/** the band's inner radius. Inboard of the flywheel rim deliberately: a side plate is what the
 * wheel is journalled in. */
const BB_PLATE_R_IN = BB_FLYWHEEL_R * 0.52;
/**
 * THE FLAT FRONT (owner, 2026-09-19: "the front should be like flat or something").
 *
 * The band's forward boundary is a STRAIGHT horizontal cut at this height about the axle, not a
 * radial end face with a filleted corner. A radial cut always meets the outer arc in a corner —
 * which is the thing being complained about — and a fillet only rounds that corner off.
 * `BB_HOOD_PATH_R − BB_POLLEN_R − 0.15` puts the cut 0.15 in below the outgoing corridor's lower
 * edge, so the shot still leaves clean and there is no radial end left to make a corner out of.
 */
const BB_PLATE_FRONT_Z = BB_HOOD_PATH_R - BB_POLLEN_R - 0.15;
/**
 * How far the plate runs PAST the feed (rad).
 *
 * ⚠️ IT RUNS A LONG WAY PAST NOW, AND THE ρ CLIP IS WHY IT CAN. The old `0` was the right answer
 * to the wrong question: the tail was measured AT REST, where the rim's height is `axle +
 * rOut·sin θ` and anything past the feed dives under the deck. What actually binds is
 * `BB_HEAD_RHO_MAX`, and the band's outer boundary is CLIPPED to it (`plateOuterR`), so past the
 * feed the rim follows an arc centred on the MUZZLE instead of on the axle — a swept relief edge,
 * which is exactly what a real elevating plate has cut into it. That buys plate either side of
 * the rear standoff and the motor, at a radius that cannot reach the drivetrain at ANY elevation.
 */
const BB_PLATE_TAIL = 1.75;

/**
 * THE OUTER BOUNDARY OF THE SIDE PLATE at one axle-frame angle: `BB_PLATE_R_OUT`, clipped to
 * wherever the ρ budget runs out.
 *
 * Bisected against `minHeadWorldZ` ITSELF rather than against a re-derivation of it, so the clip
 * IS the invariant and the two cannot drift apart.
 */
function plateOuterR(th: number): number {
  const floor = BB_LAUNCH_Z0 - BB_HEAD_RHO_MAX; // the deck plus its clearance
  const ok = (r: number): boolean =>
    minHeadWorldZ(Math.cos(th) * r, Math.sin(th) * r - BB_HOOD_PATH_R) >= floor;
  if (ok(BB_PLATE_R_OUT)) return BB_PLATE_R_OUT;
  let lo = 0;
  let hi = BB_PLATE_R_OUT;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * THE BRACING — two STANDOFFS across the channel, tying the two side plates together. Angles are
 * about the FLYWHEEL AXLE (0 = +x, CCW, the frame `thExit`/`thFeed` are in).
 *
 * ⚠️ CLOSE TO THE FLYWHEEL (owner follow-up, 2026-09-19: the bracing must sit close to the
 * flywheels). The three ribs this replaces rode the plate RIM at radius 5.11 against a 2.0
 * flywheel — 3.1 in off the wheel — and the file argued at length that a rib could not come
 * inboard. THAT ARGUMENT HOLDS ONLY INSIDE THE WRAP. At an angle outside `[thExit, thFeed]` there
 * is no element in the channel at all, so a cross-member may sit at any radius there, hard
 * against the wheel included. Both standoffs are 0.22 in off the rim.
 *
 * A standoff must still miss three regions, and the RENDER lane re-derives all three rather than
 * trusting this: the WRAP (an annulus of `BB_HOOD_PATH_R ± BB_POLLEN_R` over `[thExit, thFeed]`),
 * the OUTGOING CORRIDOR (the same band of heights running out along +x from the muzzle) and the
 * FEED APPROACH (the last element-diameter of the run into the pinch).
 *
 * ⚠️ AND THEY STAND PROUD OF BOTH PLATE FACES (owner, 2026-09-19: "i dont see the bracing"). The
 * span is the channel plus both plate thicknesses plus 0.15 either end, so the bosses show as
 * squares on the OUTSIDE of each plate from any side view — which is how a real standoff looks
 * and, unlike the old ribs, is not something the plate can occlude.
 */
const BB_BRACE_T = 0.4;
const BB_BRACE_SPAN = BB_HOOD_W + 0.44 + 0.3;
const BB_BRACE_SITES: readonly { th: number; r: number }[] = [
  { th: 0.384, r: BB_FLYWHEEL_R + 0.5 }, // 22° — the open front-bottom, UNDER the outgoing corridor
  { th: 4.189, r: BB_FLYWHEEL_R + 0.5 }, // 240° — behind and below, clear of the run into the pinch
];

/**
 * THE FLYWHEEL MOTOR — BEHIND THE HOOD, BETWEEN THE PLATES, BELT-DRIVEN (owner, 2026-09-19: the
 * motor must move off the side of the flywheel).
 *
 * It was a can at head-frame (−2.70, +3.45, −4.10) with its axis along y: 3.28 in OUTBOARD of the
 * plate's outer face and level with the wheel, which is the complaint verbatim. The site below is
 * the one that survives all five constraints at once — the ρ budget, flywheel clearance, the
 * element's wrap, the last stretch of its run into the pinch, and staying inside the CLIPPED
 * plate rim — and it only exists at all because `BB_FLYWHEEL_R` came down to 1.5.
 *
 * APPROX: the can is 1.42 in across, an ordinary FTC motor diameter; its LENGTH is set by
 * `BB_LAUNCH_PLATE_GAP` (3.1 in of channel, 0.3 of clearance), not by any catalogue number. The
 * two pulley radii are sized for the 0.5-in gap between the two flywheel halves, which is the
 * only plane a belt can run in without crossing the element's own path.
 */
const BB_MOTOR_TH = 3.578; // 205° about the axle
const BB_MOTOR_R = 2.6;
const BB_MOTOR_BODY_R = 0.71;
const BB_MOTOR_LEN = 2.5;
const BB_FW_PULLEY_R = 0.68;
const BB_MOTOR_PULLEY_R = 0.54;
const BB_BELT_T = 0.16;
const BB_BELT_W = 0.45;

/**
 * THE FEED CHUTE, which is on the YAW node and NOT on the pitching head — see `buildTurret`.
 * Tilt in radians and the plank's size in inches.
 */
const BB_FEED_TILT = 0.6;
const BB_FEED_LEN = 4.4;
const BB_FEED_T = 0.24;

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
  // ⚠️ THE FRONT IS A FLAT CUT, NOT A RADIAL ONE (owner playtest, 2026-09-19: "this sharp corner
  // that looks ugly and serves no purpose", then "the front should be like flat or something").
  // The first answer was a square radial end face with a filleted outer corner, which is still a
  // corner — a radial cut meets the outer arc at one by construction. The forward boundary is now
  // a STRAIGHT horizontal cut at `BB_PLATE_FRONT_Z` about the axle, dropping to the inner arc on a
  // short vertical face: two flat faces meeting at a right angle, and no radial end left at all.
  //
  // ⚠️ AND THE OUTER BOUNDARY IS CLIPPED TO THE ρ BUDGET (`plateOuterR`), which is what stopped
  // the plate digging into the chassis at elevation. `BB_PLATE_TAIL` sets how far past the feed
  // it runs; the clip decides how far OUT it may be while it does.
  const plateGeo = framePart('shooterPlate', () => {
    // ⚠️ THE BAND REACHES IN PAST THE FLYWHEEL RIM, AND HAS TO. A first answer to "the plate
    // does not have to be that big" started it at `BB_FLYWHEEL_R + 0.2`, which left a bare
    // annulus between the hub disc and the band with the flywheel's own rim sitting in it —
    // owner: "the flywheel looks like it is not constrained to the plate anymore". A side plate
    // is what the flywheel is journalled in; it must bridge the hub to the hood or the wheel
    // reads as floating.
    const rIn = BB_PLATE_R_IN;
    const th0 = Math.asin(BB_PLATE_FRONT_Z / BB_PLATE_R_OUT); // where the flat cut meets the arc
    const th1 = thFeed + BB_PLATE_TAIL;
    const band = new THREE.Shape();
    // the front, as two flat faces: up the short vertical at the bore, then straight out along
    // the cut to the outer arc
    band.moveTo(rIn, 0);
    band.lineTo(rIn, BB_PLATE_FRONT_Z);
    band.lineTo(Math.cos(th0) * BB_PLATE_R_OUT, BB_PLATE_FRONT_Z);
    // the outer boundary, SAMPLED rather than arced: it is `BB_PLATE_R_OUT` over most of its run
    // and the muzzle-centred relief arc past that, and one polyline expresses both.
    const steps = 96;
    for (let i = 1; i <= steps; i++) {
      const th = th0 + ((th1 - th0) * i) / steps;
      const r = plateOuterR(th);
      band.lineTo(Math.cos(th) * r, Math.sin(th) * r);
    }
    band.lineTo(Math.cos(th1) * rIn, Math.sin(th1) * rIn); // the square end face, at the tail
    band.absarc(0, 0, rIn, th1, 0, true);
    band.closePath();
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

  // THE BRACING — two standoffs across the channel, one merged mesh. Two unsupported plates
  // holding a flywheel apart is not a machine anybody would build; these are what stops them
  // splaying. Each spans the channel, both plate thicknesses AND 0.15 proud of each outer face,
  // so its end shows as a square boss from any side view — a rib the plate hides is a rib the
  // owner reports as missing, which is what happened to the last three.
  const braceGeo = framePart('shooterBrace', () => {
    const parts: THREE.BufferGeometry[] = [];
    for (const site of BB_BRACE_SITES) {
      // square section, axis along y: no rotation to get wrong, and a standoff IS a square tube.
      parts.push(
        boxAt(BB_BRACE_T, BB_BRACE_SPAN, BB_BRACE_T, Math.cos(site.th) * site.r, 0, Math.sin(site.th) * site.r),
      );
    }
    return parts;
  });
  const braces = new THREE.Mesh(braceGeo, solidMat(ALU, 0.35, 0.55));
  braces.name = 'bb-shooter-brace';
  braces.position.z = cz;
  head.add(cast(braces));

  // THE FLYWHEEL — two stacked compliant wheels on one axle, with a 0.5-in gap down the middle.
  // The gap is not decoration: it is the only plane the BELT below can run in without crossing
  // the element's own path through the channel.
  const fwGeo = wheelGeometry(BB_FLYWHEEL_R, 1.0);
  for (const s of [1, -1] as const) {
    const w = new THREE.Mesh(fwGeo, solidMat(SWEEPER, 0.45, 0.2));
    w.position.set(0, s * 0.75, cz);
    head.add(cast(w));
  }
  const axle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.26, 0.26, BB_HOOD_W + 1.3, 8),
    solidMat(ALU, 0.3, 0.7),
  );
  axle.position.z = cz;
  head.add(axle);

  // ── THE MOTOR, BEHIND THE HOOD AND BETWEEN THE PLATES, BELTED TO THE FLYWHEEL ──────────────
  // See `BB_MOTOR_TH`'s header for why this is the one site that works. Axis along y, parallel
  // to the flywheel axle, and 2.5 in of it inside a 3.1-in channel.
  const mx = Math.cos(BB_MOTOR_TH) * BB_MOTOR_R;
  const mz = cz + Math.sin(BB_MOTOR_TH) * BB_MOTOR_R;
  const motor = new THREE.Mesh(
    new THREE.CylinderGeometry(BB_MOTOR_BODY_R, BB_MOTOR_BODY_R, BB_MOTOR_LEN, 12),
    solidMat(MOTOR, 0.5, 0.4),
  );
  motor.name = 'bb-shooter-motor';
  motor.position.set(mx, 0, mz);
  head.add(cast(motor));

  // THE BELT — two pulleys in the flywheel's centre gap and the two straight tangent runs
  // between them, merged into one part. A `TubeGeometry` over a closed spline is the obvious
  // alternative and costs ~20× the vertices for a loop 0.16 in thick; `ExtrudeGeometry` cannot
  // do it at all without hand-building the four arcs first.
  const beltGeo = framePart('shooterBelt', () => {
    const parts: THREE.BufferGeometry[] = [];
    for (const [r, x, z] of [
      [BB_FW_PULLEY_R, 0, 0],
      [BB_MOTOR_PULLEY_R, mx, mz - cz],
    ] as const) {
      const p = new THREE.CylinderGeometry(r, r, 0.3, 14);
      p.translate(x, 0, z);
      parts.push(p);
    }
    // the external tangents of two circles of radii R1, R2 a distance d apart leave each centre
    // along the SAME unit normal, offset from the centre line by asin((R1 − R2) / d)
    const d = BB_MOTOR_R;
    const off = Math.asin((BB_FW_PULLEY_R - BB_MOTOR_PULLEY_R) / d);
    const runLen = Math.sqrt(d * d - (BB_FW_PULLEY_R - BB_MOTOR_PULLEY_R) ** 2);
    for (const s of [1, -1] as const) {
      const u = BB_MOTOR_TH + s * (Math.PI / 2 + off);
      const ax = Math.cos(u) * BB_FW_PULLEY_R;
      const az = Math.sin(u) * BB_FW_PULLEY_R;
      const bx = mx + Math.cos(u) * BB_MOTOR_PULLEY_R;
      const bz = mz - cz + Math.sin(u) * BB_MOTOR_PULLEY_R;
      const g = new THREE.BoxGeometry(runLen, BB_BELT_W, BB_BELT_T);
      // same rotation idiom the standoffs used to use: `rotateY(−a)` maps the box's local +x to
      // `(cos a, sin a)` in this x–z frame, so `a` is the run's own direction.
      g.rotateY(-Math.atan2(bz - az, bx - ax));
      g.translate((ax + bx) / 2, 0, (az + bz) / 2);
      parts.push(g);
    }
    return parts;
  });
  const belt = new THREE.Mesh(beltGeo, solidMat(ALU_DK, 0.55, 0.3));
  belt.name = 'bb-shooter-belt';
  belt.position.z = cz;
  head.add(cast(belt));

  // ⚠️ THE FEED CHUTE IS NOT BUILT HERE ANY MORE. It used to hang off the pitch node at head
  // frame (−5.59, −5.97), i.e. ρ 9.96 — 1.62 in below the deck at REST and sweeping to world z
  // 0.044 at 45° of elevation, through the deck, the belly pan and the wheels. A real turret's
  // feed tube is fixed to the frame and only the hood elevates, so it is built in `buildTurret`
  // under the YAW node, standing on the deck, where pitch cannot move it at all.

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

  // ── THE FEED CHUTE — ON THE YAW NODE, WHERE PITCH CANNOT MOVE IT ──────────────────────────
  // ⚠️ THIS IS THE WORST OF THE FOUR THINGS THAT USED TO DIG INTO THE CHASSIS, AND IT WAS THE
  // ONE NOTHING MEASURED. Built on the pitch node it sat at ρ 9.96 from the muzzle, 1.62 in below
  // the deck at rest, and swept to world z 0.044 — 0.04 in off the tile — at 45° of elevation.
  // On a real shooter the feed tube is bolted to the frame and only the hood elevates, so it
  // belongs here: it turns with the turret, and its rear-bottom corner is placed ON the deck by
  // construction, which is an invariant rather than a number to keep an eye on.
  const ux = Math.cos(BB_FEED_TILT);
  const uz = Math.sin(BB_FEED_TILT);
  const deck = BB_DECK_Z - BB_LAUNCH_Z0; // the deck, in this node's own frame
  const chute = new THREE.Mesh(
    new THREE.BoxGeometry(BB_FEED_LEN, BB_HOOD_W, BB_FEED_T),
    solidMat(ALU, 0.45, 0.35),
  );
  chute.name = 'bb-turret-feed';
  chute.rotation.y = -BB_FEED_TILT; // local +x → (cos t, sin t) in this x–z frame: it rises forward
  chute.position.set(
    // ...the plank's own up-normal is (−uz, ux), which is where the two `BB_FEED_T / 2` terms
    // come from: the corner is half a thickness BELOW the mid-plane as well as half a length back
    -5.2 + (BB_FEED_LEN / 2) * ux - (BB_FEED_T / 2) * uz,
    0,
    deck + (BB_FEED_LEN / 2) * uz + (BB_FEED_T / 2) * ux,
  );
  head.add(cast(chute));

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
    const tube = buildBoxTube(spec, lift.mount, id);
    group.add(tube.node);
    group.userData.tubeStages = tube.stages;
    group.userData.tubeTravel = tube.travel;
  }

  return group;
}

/**
 * THE BOX TUBE — A TELESCOPING EXTRUSION THAT REACHES WHAT THE SIM REACHES.
 *
 * ⚠️ IT USED TO BE ONE SOLID `BoxGeometry(3, 1.4, 1.4)` AT `turretLocal(...)`, AND EVERY ONE OF
 * THOSE FOUR NUMBERS WAS WRONG (owner, 2026-09-19).
 *  1. WRONG ORIGIN — `turretLocal` is the TURRET RING's inboard pull, not the tube's mount.
 *     `bbBoxTubeGlyph` is the shared geometry for exactly this and the 3D path never called it.
 *  2. WRONG DIRECTION — a `BoxGeometry` is 3 in along LOCAL X always, so a `left` mount was
 *     drawn crosswise to the direction it works in and a corner mount was 45° off.
 *  3. IT DID NOT REACH WHAT THE SIM REACHES — the sim places at `bbPlacePointLocal`; on the
 *     default build that is x 12.88 and the drawn tube ended at 5.40, which is 2.10 in INSIDE
 *     the frame rail. The 2026-09-18 "built inside the chassis" fix landed on the turret and
 *     never reached the tube.
 *  4. IT NEVER MOVED — one solid bar, not hollow, no stages, and no handle in `userData` at all.
 *
 * The fix makes the drawn tip and the sim's placement point the SAME NUMBER by construction: the
 * assembly is aimed at `bbPlacePointLocal` and its full extension IS the distance to it, so the
 * picture cannot lie about reach — the same bargain the turret muzzle makes with `BB_LAUNCH_Z0`.
 *
 * ⚠️ AND THE EXTENSION IS RENDERER-OWNED, NOT A SIM FIELD. Placement is a PROXIMITY action
 * (`mechs.ts`): the Box Tube has no carriage, no height dial and no raise travel, so there is
 * nothing in the world to read but the reach PREDICATE. The stages ease toward
 * `bbFlowerInReach(world, r) !== null` over `BB_BOX_TUBE_EXTEND_S`, off the WORLD clock, and
 * nothing about it is written back.
 */
function buildBoxTube(
  spec: RobotSpec,
  mount: BbMountPos,
  id: number,
): { node: THREE.Group; stages: THREE.Object3D[]; travel: number } {
  const place = bbPlacePointLocal(spec);
  const glyph = bbBoxTubeGlyph(spec, mount, place);
  const reach = place ? Math.hypot(place.x - glyph.outer.x, place.y - glyph.outer.y) : 0;
  const node = new THREE.Group();
  node.name = `robot:${id}:tube`;
  node.position.set(glyph.outer.x, glyph.outer.y, BB_DECK_Z + 0.95);
  // THE ONE LINE THAT FIXES THE SIDE AND CORNER MOUNTS: the assembly is aimed along the glyph's
  // own outward unit vector, which `bbBoxTubeGlyph` has already turned toward the placement point.
  node.rotation.z = Math.atan2(glyph.uy, glyph.ux);

  // n moving stages each travel the same distance, so the tip lands at `reach` at full extension
  // and every stage keeps `BB_BOX_TUBE_STAGE_OVERLAP` captured inside the one outboard of it.
  const n = BB_BOX_TUBE_SECTIONS.length - 1;
  const travel = reach / n;
  const sectionLen = travel + BB_BOX_TUBE_STAGE_OVERLAP;
  const mat = solidMat(ALU, 0.4, 0.4);
  const stages: THREE.Object3D[] = [];
  for (let i = 0; i < BB_BOX_TUBE_SECTIONS.length; i++) {
    const w = BB_BOX_TUBE_SECTIONS[i];
    // each section spans [−sectionLen, 0] in its OWN frame, so a stage at offset d has its front
    // face at d — which is what makes the last stage's front face the tip
    const geo = framePart(`tube:${w}|${sectionLen.toFixed(3)}`, () => {
      const wall = BB_BOX_TUBE_WALL;
      const parts: THREE.BufferGeometry[] = [];
      // HOLLOW, as four walls: hollowness is what says "tube" rather than "bar", and the bore
      // of each section is the next one's outside (1.5 − 2 × 0.125 = 1.25) so the nest closes.
      for (const s of [1, -1] as const) {
        parts.push(boxAt(sectionLen, w, wall, -sectionLen / 2, 0, (s * (w - wall)) / 2));
        parts.push(boxAt(sectionLen, wall, w - wall * 2, -sectionLen / 2, (s * (w - wall)) / 2, 0));
      }
      return parts;
    });
    const mesh = cast(new THREE.Mesh(geo, mat));
    mesh.name = `robot:${id}:tube:s${i}`;
    node.add(mesh);
    if (i > 0) stages.push(mesh); // section 0 is the fixed base, bolted across the frame rail
  }
  return { node, stages, travel };
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
  /** how far the Box Tube is out, 0..1. On the ENTRY and not on `userData`, so a `bbSpecKey`
   *  rebuild (which changes the reach) resets it instead of easing from a stale fraction. */
  tubeEase: number;
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
        entry = { group: g, key, tubeEase: 0 };
        entries.set(r.id, entry);
        group.add(g);
      }
      entry.group.position.set(r.pos.x, r.pos.y, r.z ?? 0);
      entry.group.rotation.set(0, 0, r.heading);

      // THE INTAKE SPINS WHEN IT IS COLLECTING. Derived from the WORLD alone (the 3D sync never
      // sees a command): a robot on auto-intake with room in its hopper is running, and so is one
      // that took an element in the last fraction of a second, which is the driver-held case.
      const rollers = entry.group.userData.intakeRollers as BbRoller[] | undefined;
      if (rollers && rollers.length > 0) {
        const running = (r.autoIntake || world.time - r.lastIntakeAt < 0.4) && r.hopper.length < bbHopperCap(r.spec);
        for (const roller of rollers) {
          if (running) roller.phase += BB_ROLLER_SPIN * dt;
          roller.hub.rotation.y = -roller.phase;
          // ⚠️ THE FLAPS ARE POSED EVERY FRAME, RUNNING OR NOT. Pass-under is a statement about
          // the drawn envelope, not about the animation: a stopped roller whose flaps hang into
          // the collider's open pocket blocks it just as visibly as a spinning one.
          for (let k = 0; k < roller.flaps.length; k++) {
            const a = roller.phase + (k * Math.PI * 2) / roller.flaps.length;
            const fold = flapFold(a);
            roller.flaps[k].position.set(Math.cos(a) * BB_ROLLER_HUB_R, 0, Math.sin(a) * BB_ROLLER_HUB_R);
            // the flap TRAILS the hub, so the fold is subtracted from its own direction
            roller.flaps[k].rotation.y = -(a - fold);
          }
        }
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

      // THE BOX TUBE EXTENDS WHEN A FLOWER IS IN REACH. `bbFlowerInReach` is the SIM's own
      // predicate — the same one the sprite's placement marker and the HUD chip read — so the
      // three cues can never disagree about whether this robot can place. The easing is the
      // renderer's, because a rate is a function of frame history and no pure sim query can
      // answer it; it runs off the same clamped WORLD clock the roller does, which is what keeps
      // a replay scrub that jumps backwards from unwinding the tube.
      const stages = entry.group.userData.tubeStages as THREE.Object3D[] | undefined;
      if (stages && stages.length > 0) {
        const want = bbFlowerInReach(world, r) !== null ? 1 : 0;
        const step = BB_BOX_TUBE_EXTEND_S > 0 ? dt / BB_BOX_TUBE_EXTEND_S : 1;
        entry.tubeEase =
          want > entry.tubeEase
            ? Math.min(want, entry.tubeEase + step)
            : Math.max(want, entry.tubeEase - step);
        const travel = (entry.group.userData.tubeTravel as number | undefined) ?? 0;
        for (let i = 0; i < stages.length; i++) stages[i].position.x = entry.tubeEase * travel * (i + 1);
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
    /**
     * ⚠️ **FREE EVERY LIVE ROBOT GROUP THROUGH `disposeRobotGroup`, WHICH IS WHY THIS EXISTS.**
     *
     * It used to only `entries.clear()`, which left the scene's own teardown to reach these
     * meshes — and that teardown is a blanket `disposeObject3D` walk, which does not know about
     * `SHARED_GEO`/`SHARED_MAT` and would free the frame geometry, the roller texture and every
     * solid material the BUILDER PREVIEW and the next match are still holding. The module caches
     * outlive any one scene, so "the scene is going away, nothing needs them" is exactly the
     * assumption that is false here.
     */
    dispose(): void {
      for (const entry of entries.values()) {
        group.remove(entry.group);
        disposeRobotGroup(entry.group);
      }
      entries.clear();
    },
  };
}

/**
 * Free what ONE robot group owns, and nothing that is shared.
 *
 * The per-robot half is every mesh built inline in `buildRobotGroup` — the nose box, the sign
 * plane and its material (its TEXTURE is cached per id and is not touched), the turret ring,
 * posts, axle, motor and feed chute. The Box Tube's sections, the shooter's belt and the swerve
 * pod's drive all come from `framePart` and are SHARED. Anything from `solidMat`, `lineMat`,
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
