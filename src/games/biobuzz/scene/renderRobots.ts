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
  BB_DECK_Z,
  BB_FEED_WALL_T,
  BB_FLYWHEEL_R,
  bbHead,
  BB_HOOD_ARM_INSET,
  BB_HOOD_ARM_T,
  BB_HOOD_T,
  BB_HOOD_WRAP,
  BB_INTAKE_DRAW_IN,
  BB_LAUNCH_Z0,
  BB_SIDE_PLATE_BOTTOM_Z,
  BB_SIDE_PLATE_FRONT_X,
  BB_SIDE_PLATE_TOP_Z,
  BB_TURRET_AXLE_Z,
  BB_TURRET_BRACE_R,
  BB_TURRET_BRACES,
  BB_SHOOTER_PLATE_T,
  BB_TURRET_MOTOR_R,
  BB_TURRET_PITCH_MIN,
  BB_TURRET_PLATE_T,
  BB_TURRET_PLATE_TOP_Z,
  BB_TURRET_RING_H,
  bbHopperCap,
  type BbHeadDims,
} from '../config';
import { bbIsTurreted, bbLauncherOf, bbLiftOf, type BbLauncherSpec } from '../mechs';
import { bbBoxTubeGlyph } from '../parts';
import { bbFlowerInReach, bbMouths, bbMuzzleLocal, bbPlacePointLocal } from '../robot';
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

/**
 * side-plate height — a real drivetrain is a 4-ish inch channel, and this is the number that
 * decides how much of a robot reads as "chassis".
 *
 * ⚠️ IT IS `BB_DECK_Z`, IMPORTED, NOT A LOCAL 4.6. The whole turret stack is measured up from the
 * deck (`BB_TURRET_RING_H`, `BB_TURRET_PLATE_TOP_Z`, `BB_TURRET_AXLE_Z`) and that stack is in
 * `config.ts` now, so the deck cannot be a second number typed here. The drivetrain's side plate
 * IS the deck's height by construction, which is the statement this line makes.
 */
const BB_PLATE_H = BB_DECK_Z;
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
  const built = build();
  // ⚠️ **EVERY PART IS FLATTENED TO NON-INDEXED FIRST, AND THAT IS NOT TIDINESS.**
  // `mergeGeometries` refuses a list that mixes indexed and non-indexed buffers — it logs and
  // returns `null`, and the fallback below then hands back `parts[0]`, so the merge SILENTLY
  // DROPS EVERY PART AFTER THE FIRST. A `BoxGeometry` is indexed and an `ExtrudeGeometry` is not,
  // so any part built from both came out as whichever piece happened to be first: a hood arm as
  // its bare rim, a swerve pod as one fork plate. It has cost two rounds of owner feedback, both
  // times on a build whose whole point was the piece that vanished. Normalizing here makes the
  // mistake unmakeable instead of leaving each caller to remember.
  const parts = built.map((p) => (p.index ? p.toNonIndexed() : p));
  const merged = mergeGeometries(parts, false) ?? parts[0];
  for (const p of new Set([...built, ...parts])) if (p !== merged) p.dispose();
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

/**
 * ⚠️ AN X-DRIVE OMNI DOES NOT LIVE IN THE WHEEL CHANNEL EITHER (owner, 2026-09-19: "selecting x
 * drive makes the wheels stick out of the robot"). Canted 45°, a wheel `2R` long and `W` wide
 * reaches `(2R + W) / (2·√2)` = 1.945 in along BOTH chassis axes, and the channel's centre-line is
 * only 1.17 in inside the frame — so every wheel stood 0.78 in proud of its side plate. Same fix
 * as the swerve pod: inset the wheel from both faces by its own canted reach, past the side plate
 * laterally and past the cross member fore-and-aft (the rail's underside is below the wheel's
 * crown), and `buildFrame` drops the inner side plate, which would otherwise run through it.
 */
const BB_XDRIVE_REACH = (2 * BB_WHEEL_R + BB_WHEEL_W) / (2 * Math.SQRT2);
const BB_XDRIVE_CLEAR = 0.15;
export const BB_XDRIVE_INSET_X = BB_XDRIVE_REACH + BB_RAIL_T + BB_XDRIVE_CLEAR;
export const BB_XDRIVE_INSET_Y = BB_XDRIVE_REACH + BB_PLATE_T + BB_XDRIVE_CLEAR;

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
const BB_POD_FORK_T = 0.22;
/**
 * ⚠️ **THE FORK PLATE IS SHORTER THAN THE WHEEL, AND IT NARROWS TO A BOSS AT THE AXLE** (owner,
 * 2026-09-19: "the swerve wheel has two rectangular plates blocking the wheel, so it looks like it
 * is just a rectangular cylinder as the wheel — remove those plates or make it smaller").
 *
 * It was a 3.2 × 3.5 rectangle standing either side of a 3.0-in wheel, from 0.40 up to the top
 * plate: in side view it covered the wheel completely, top to bottom and end to end, so the only
 * thing left of the wheel was a dark band under the plate's bottom edge. That is the "rectangular
 * cylinder". A real fork is a bearing carrier, not a shroud — it hangs off the top plate and
 * tapers to a boss around the axle — so it is one now: `BB_POD_FORK_L` long at the top and
 * `BB_POD_FORK_BOSS_R` at the bottom, which leaves the tyre's whole lower half and both ends of
 * its circle in plain sight, with the hub showing as a ring around the boss.
 */
const BB_POD_FORK_L = 2.1;
const BB_POD_FORK_BOSS_R = 0.45;
/** the wheel's own hub, drawn a whisker proud of the tyre on both faces so it reads through the
 *  gap the fork's boss leaves. Bigger than the boss, or there would be nothing to see. */
const BB_POD_HUB_R = 0.72;
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
  const struct = framePart('swervePod:struct', () => {
    const parts: THREE.BufferGeometry[] = [];
    // TWIN FORK PLATES carrying the axle, one either side of the wheel. Each is a plate hanging
    // off the top plate and TAPERING to a boss around the axle — see `BB_POD_FORK_L`. Built in
    // shape space (u = along, v = up) and rotated once, the same way `platePlane` is.
    const halfL = BB_POD_FORK_L / 2;
    const topZ = BB_POD_PLATE_Z - 0.3;
    for (const s of [1, -1] as const) {
      // wound CCW, like `platePlane`'s: a reversed outline extrudes with its caps facing inward
      // and a single-sided material then draws nothing at all where the plate should be
      const shape = new THREE.Shape();
      shape.moveTo(halfL, topZ);
      shape.lineTo(-halfL, topZ);
      // down the leading edge to the boss, round its underside, and back up the trailing edge
      shape.absarc(0, BB_POD_WHEEL_R, BB_POD_FORK_BOSS_R, Math.PI, 0, false);
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: BB_POD_FORK_T, bevelEnabled: false, curveSegments: 12 });
      g.rotateX(Math.PI / 2);
      g.translate(0, s * forkY + BB_POD_FORK_T / 2, 0);
      parts.push(g);
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

/**
 * ONE WHOLE SWERVE POD — the wheel, its hub and the hardware above them, in the pod's own frame.
 *
 * ⚠️ THE WHEEL IS PLAIN TRACTION, NOT A ROLLER WHEEL. Every pod used to take the shared MECANUM
 * material because the wheel loop picks one material for the whole drivetrain, so a swerve robot
 * drove on four 45°-striped mecanums inside its four modules. A swerve pod runs a traction wheel;
 * the stripes were also most of what made the tyre hard to read as a circle.
 *
 * EXPORTED for `scripts/smoke-biobuzz/render.ts`, which builds one and MEASURES it — the same
 * bargain `buildTurret` makes, and for the same reason: the complaint this answers ("it looks like
 * a rectangular cylinder") is about a silhouette, and a lane that greps cannot see one.
 */
export function buildSwervePod(): THREE.Group {
  const pod = new THREE.Group();
  const wheel = new THREE.Mesh(wheelGeometry(BB_POD_WHEEL_R, BB_WHEEL_W), solidMat(TREAD, 0.95, 0));
  wheel.name = 'bb-pod-wheel';
  wheel.position.set(0, 0, BB_POD_WHEEL_R);
  pod.add(cast(wheel));
  // the HUB, a whisker proud of the tyre on both faces so it reads as a ring around the fork's
  // boss rather than disappearing behind it
  const hub = new THREE.Mesh(wheelGeometry(BB_POD_HUB_R, BB_WHEEL_W + 0.14), solidMat(ALU, 0.4, 0.5));
  hub.name = 'bb-pod-hub';
  hub.position.set(0, 0, BB_POD_WHEEL_R);
  pod.add(cast(hub));
  for (const p of podParts()) pod.add(p);
  return pod;
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
  for (const x of axleXs(spec)) {
    for (const sy of [1, -1] as const) {
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
        const pod = buildSwervePod();
        pod.name = `robot:pod:${out.pods.length}`;
        pod.position.set((Math.sign(x) || 1) * (hl - BB_POD_INSET), sy * (hw - BB_POD_INSET), 0);
        out.nodes.push(pod);
        out.pods.push(pod);
        continue;
      }
      // CylinderGeometry's axis is local Y by default — exactly a wheel's axle direction
      // (chassis left-right), so the flat discs already face outward with no rotation needed.
      const wheel = cast(new THREE.Mesh(geo, mat));
      wheel.position.set(x, sy * wheelY, BB_WHEEL_R);
      if (dt === 'xdrive') {
        // at the CORNER, inset by the canted wheel's own reach — see `BB_XDRIVE_INSET_X`
        wheel.position.x = (Math.sign(x) || 1) * Math.max(0.5, hl - BB_XDRIVE_INSET_X);
        wheel.position.y = sy * Math.max(0.5, hw - BB_XDRIVE_INSET_Y);
        wheel.rotation.z = x * sy >= 0 ? -Math.PI / 4 : Math.PI / 4;
      }
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

/** the cosmetic TOP CAP over each side plate — thickness, and how far inboard of the frame line
 *  it reaches. Deliberately narrow: it covers the outer plate and a 0.5-in lip, so the wheels are
 *  still visible from straight above through the pocket it does not cover. See `buildFrame`. */
const BB_TOP_CAP_T = 0.2;
const BB_TOP_CAP_W = BB_PLATE_T + 0.5;

/**
 * THE FRAME — side plates, cross members, belly pan, deck, tower. Two merged meshes: the
 * cosmetic one (`chassisFill`) and the structural one (the darker extrusion). Open TOP by
 * construction: the deck is inset from the frame on every side, so the mechanisms above it are
 * seen against daylight rather than against a lid.
 *
 * ── ⚠️ WHAT CARRIES THE COSMETIC COLOUR, AND WHY IT CHANGED ────────────────────────────────
 * It used to be the SIDE PLATES ALONE, which are four VERTICAL surfaces. From straight above —
 * the angle a top-down driver camera and the builder preview's orbit spend most of their time at
 * — a supporter's chosen colour presented an edge 0.22 in wide and nothing else, so it read as
 * not applied at all (owner, 2026-09-19: "chassis color change is not noticeable enough. The top
 * needs to change"). The header here CLAIMED the deck carried it; the code put the deck in the
 * structural part, and the comment on that line said so explicitly.
 *
 * That line's reason was real: a full-width coloured deck plus coloured plates "turned the top of
 * the robot back into one flat slab". What answers BOTH is that the deck is INSET — it is
 * `length − 2.47` by `innerHW × 2` (12.32 in on a 17-in chassis), framed on every side by the
 * dark cross members, the dark rails and the wheel pockets. A coloured panel inside a dark frame
 * is not a slab. The TOP CAPS add the rest: a narrow cosmetic strip lying on each side plate's
 * top edge, which is the one perimeter surface no mechanism stands on, so the colour survives
 * whatever the player bolts to the deck.
 *
 * The ALLIANCE is untouched by all of it and must stay that way — it is the outline round the
 * bumper band and the two ROBOT SIGNS, which is a RULES matter (G414, R401–R403), not a style
 * one. `chassisFill`'s 7-key allowlist is what keeps a cosmetic from ever reading as an alliance.
 */
export function buildFrame(spec: RobotSpec): THREE.Object3D[] {
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
  // X-DRIVE is the same case for the same reason: a 45° omni inset by its own reach spans the
  // inner plate's line (`BB_XDRIVE_INSET_Y`).
  const dropInner = spec.drivetrain === 'swerve' || spec.drivetrain === 'xdrive';
  const plateYs = dropInner ? [outerY] : [outerY, innerY];

  const skin = framePart(`skin:${key}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    for (const sy of [1, -1] as const) {
      for (const y of plateYs) {
        const p = platePlane(spec.length, BB_PLATE_H, BB_PLATE_T, holes);
        p.translate(0, sy * y, BB_PLATE_H / 2);
        parts.push(p);
      }
      // THE TOP CAP — lying ON that side's plate, the one perimeter surface a mechanism never
      // stands on, so a top-down view always has the colour somewhere even on a robot whose deck
      // is covered end to end.
      parts.push(
        boxAt(spec.length, BB_TOP_CAP_W, BB_TOP_CAP_T, 0, sy * (hw - BB_TOP_CAP_W / 2), BB_PLATE_H + BB_TOP_CAP_T / 2),
      );
    }
    // THE DECK — the polycarb floor mechanisms bolt to, and the biggest surface a top-down camera
    // sees. COSMETIC (see the header): it is inset from the frame line on every side, so it reads
    // as a coloured panel inside a dark frame rather than as the one flat slab the full-width
    // version was.
    parts.push(boxAt(spec.length - BB_RAIL_T * 2.6, innerHW * 2, 0.26, 0, 0, BB_DECK_Z - 0.13));
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
    return parts;
  });

  const skinMesh = new THREE.Mesh(skin, solidMat(chassisFill(spec.chassisColor), 0.55, 0.15));
  skinMesh.name = 'robot:frame:skin';
  const frameMesh = new THREE.Mesh(frame, solidMat(ALU_DK, 0.45, 0.4));
  frameMesh.name = 'robot:frame:rails';
  return [cast(skinMesh), cast(frameMesh)];
}

/**
 * ── THE ROBOT SIGN (§12.4, R401 / R402 / R403) ──────────────────────────────────────────────
 *
 * ⚠️ THIS IS A RULED ASSEMBLY, NOT A DECORATION, AND EVERY NUMBER BELOW IS THE MANUAL'S.
 * Competition Manual V1 §12.4 p127: "A ROBOT SIGN is a required assembly which attaches to the
 * ROBOT. A ROBOT SIGN simultaneously identifies a ROBOT'S team number as well as its ALLIANCE
 * affiliation for FIELD STAFF." Three rules bind what is drawn:
 *
 *  - **R401 (p127) — MINIMUM OF TWO PER ROBOT**, "in at least 2 separate locations … on opposite
 *    or adjacent surfaces of the ROBOT, 90 degrees apart", minimally 6.5 in wide and 2.5 in tall,
 *    supported by the robot's structure. Intent: readable by FIELD STAFF from 12 ft away. This
 *    file drew ONE, on the left side plate only — owner, 2026-09-19: "the number plates should be
 *    on both sides of the robot". Both side plates is the OPPOSITE-surfaces case.
 *  - **R402 (p128) — the ALLIANCE rectangle** is "a solid red or blue opaque background at least
 *    6.5 in. by 2.5 in.", and "visible markings on ROBOT SIGNS when installed on the ROBOT, other
 *    than the following, are prohibited" — the R403 team number, fasteners, narrow colour slivers
 *    at corners/folds/cutouts, and narrow template marks. ⚠️ **THAT IS WHY THERE IS NO LONGER A
 *    WHITE BORDER.** The old panel stroked a 6-px white frame round itself, which is none of the
 *    four and is therefore a prohibited marking. The colour is the MATCH SCHEDULE's alliance,
 *    which is the `alliance` argument, never anything off the spec.
 *  - **R403 (pp128–129) — the team number**: "solid opaque white Arabic numbers … approximately
 *    2.25 in. (5.70 cm) tall", with "a minimum of approximately 0.25 in. (0.60 cm) of background
 *    surrounding the numbers", and they "may not be vertically stacked" (Fig 12-10, which also
 *    rules mirrored text NOT OK). One line, upright, un-mirrored, white on the alliance fill.
 *
 * The plate is therefore **6.5 × 2.75 in**: 6.5 is R401.B/R402 exactly, and 2.75 is the only
 * height at which R403.A's 2.25-in digits and R403.B's 0.25-in margin both hold (2.25 + 2×0.25),
 * which is ≥ R401.C's 2.5 minimum. It does NOT scale with the chassis — the rule is an absolute
 * size in inches, and the old `min(3.6, length × 0.3)` square was under the legal minimum on
 * every build in the game. The smallest legal BIOBUZZ chassis is 11 × 10 in (`lengthLimits` /
 * `widthLimits`), so a 6.5-in sign fits on any side plate this builder can make.
 */
export const BB_SIGN_W = 6.5;
/** R403.A — cap height of the numerals. */
export const BB_SIGN_DIGIT_H = 2.25;
/** R403.B — background clear of the numerals, on every side. */
export const BB_SIGN_MARGIN = 0.25;
export const BB_SIGN_H = BB_SIGN_DIGIT_H + BB_SIGN_MARGIN * 2;
/** R401.B/R402 — the width floor. R401.C/R402 — the height floor. Exported so the RENDER lane
 *  checks the plate against the RULE rather than against a literal copied out of this file. */
export const BB_SIGN_MIN_W = 6.5;
export const BB_SIGN_MIN_H = 2.5;

/**
 * What R403 puts on the plate for a given spec. `teamNumber` 0 is "no team declared" — the 2D
 * team card renders `-` there (`GameView.tsx`, `HomeMenu.tsx`) and this matches that intent
 * rather than printing a literal `0`, which would read as a real team number.
 *
 * DOM-free and exported so the RENDER lane can check the string without a canvas.
 */
export function bbRobotSignText(spec: Pick<RobotSpec, 'teamNumber'>): string {
  const n = Math.round(spec.teamNumber);
  return Number.isFinite(n) && n > 0 ? String(n) : '-';
}

/** px per inch the sign canvas is rasterized at — 2.25-in digits land at 108 px. */
const SIGN_PX_PER_IN = 48;

/**
 * The plate's artwork, cached by (text, alliance): TWO signs on one robot are the SAME texture,
 * and a robot's team number and alliance do not change inside a `bbSpecKey` rebuild.
 *
 * ⚠️ IT IS NOT PRE-MIRRORED ANY MORE. The old comment here claimed no proper rotation could get
 * the outward normal, a vertical "up" AND un-mirrored text at once, so the canvas was drawn
 * flipped to cancel a flip. That is false — it is true of `Euler` triples, not of rotations:
 * `makeBasis(up × n, up, n)` is right-handed by construction for either side plate (see
 * `bbRobotSignOrientation`). Fig 12-10 rules mirrored text NOT OK, so one un-mirrored canvas
 * serving both signs is both the legal answer and the cheap one.
 */
const SIGN_TEXTURE_CACHE = new Map<string, THREE.CanvasTexture>();
function getSignTexture(text: string, alliance: 'red' | 'blue'): THREE.CanvasTexture {
  const key = `${text}|${alliance}`;
  const cached = SIGN_TEXTURE_CACHE.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(BB_SIGN_W * SIGN_PX_PER_IN);
  canvas.height = Math.round(BB_SIGN_H * SIGN_PX_PER_IN);
  const ctx = canvas.getContext('2d')!;
  // R402 — the whole plate is the solid, opaque alliance rectangle, and nothing else is on it.
  ctx.fillStyle = alliance === 'blue' ? BLUE : RED;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // R403.A — solid opaque WHITE Arabic numerals at a 2.25-in cap height, on ONE line (R403.C
  // forbids stacking them). `system-ui` reports a cap height near 0.72 em, so the em size that
  // puts the caps at 2.25 in is 2.25 / 0.72.
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${Math.round((BB_SIGN_DIGIT_H / 0.72) * SIGN_PX_PER_IN)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // R403.B — the numerals stay inside the 0.25-in background margin. A five-digit team number is
  // wider than 6.0 in at natural proportions, so it is CONDENSED rather than allowed to run into
  // the margin: R403 fixes the height and the margin and specifies no font or width.
  const inner = (BB_SIGN_W - BB_SIGN_MARGIN * 2) * SIGN_PX_PER_IN;
  const natural = ctx.measureText(text).width;
  const squeeze = natural > inner ? inner / natural : 1;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(squeeze, 1);
  ctx.fillText(text, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  SIGN_TEXTURE_CACHE.set(key, tex);
  return tex;
}

/**
 * The orientation of the sign on the side plate whose outward normal is `+y * side`.
 *
 * Built as an explicit BASIS rather than an `Euler`: a plane's texture "right" is its +x, so the
 * only basis that reads un-mirrored from outside is `x = y × n` with `n` the outward normal and
 * `y` vertical — right-handed by construction (det +1) on both sides, which an Euler triple
 * cannot express without flipping one axis. Fig 12-10: mirrored text is NOT OK.
 *
 * Exported for the RENDER lane, which checks the BASIS (outward, upright, determinant +1) rather
 * than a rotation triple — a mirrored sign is a rule violation the old spelling made invisible.
 */
export function bbRobotSignOrientation(side: 1 | -1): THREE.Quaternion {
  const n = new THREE.Vector3(0, side, 0);
  const up = new THREE.Vector3(0, 0, 1);
  const right = new THREE.Vector3().crossVectors(up, n);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, n));
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
/** how far inboard of the frame line an intake side arm is set — the outer plate's own thickness
 *  plus a clearance, so the arm bolts to that plate's inner face instead of sharing its outer
 *  one. Exported for the RENDER lane, which checks it against the measured coplanarity hazard. */
export const BB_INTAKE_ARM_INSET = BB_PLATE_T + 0.06;

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
    // ⚠️ **THE ARM IS SET INBOARD OF THE FRAME LINE, AND THAT IS NOT A STYLE CHOICE** (owner,
    // 2026-09-19: "the intake side plate is meshing with chassis"). `bbMouths` makes the mouth
    // EXACTLY as wide as the chassis — measured across all three intake presets and all four
    // mounts, `f.half` equals the chassis half-width/half-length to 0.0000 in, every time — so an
    // arm at `f.half − armT/2` puts its outer face precisely ON the side plate's outer face. And
    // `armX0 = f.rail − 1.1` runs the arm 1.1 in back INSIDE the frame, by design ("where they are
    // bolted"). Two solids overlapping for 1.1 in with co-planar outer faces is per-pixel
    // z-fighting along that whole seam — the same failure the alliance line round the bumper band
    // is scaled out by a whisker to avoid, at a far bigger scale.
    //
    // `BB_PLATE_T` is the outer plate's thickness, so this lands the arm's outer face against
    // that plate's INNER face, plus a clearance: which is where a real over-the-bumper intake's
    // arm bolts anyway. The arm's own visible reach is unchanged outboard of the frame — it loses
    // 0.28 in a side on a mouth that is 17 in wide.
    for (const s of [1, -1] as const) {
      const arm = new THREE.Mesh(armGeo, solidMat(ALU, 0.45, 0.35));
      arm.position.set(0, s * (f.half - BB_INTAKE_ARM_INSET - armT / 2), 0);
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
// THE HOODED FLYWHEEL — AND EVERY DIMENSION IN IT COMES OUT OF `config.ts`
//
// ⚠️ **THIS SECTION USED TO OWN THE SHOOTER'S DIMENSION CHAIN PRIVATELY, AND THAT IS WHY IT TOOK
// SIX PASSES.** The flywheel radius, the hood radius, the side-plate profile and the muzzle
// height were local `const`s in this file; the sim owned `BB_LAUNCH_Z0`. Two numbers, two owners,
// and every round of feedback moved one of them to answer the last complaint — so the picture and
// the physics agreed at ONE elevation and nowhere else, and the next look found the next
// disagreement.
//
// The chain lives in `config.ts` now and `bbMuzzleLocal` (`robot.ts`) is the ONE function that
// turns an elevation into a release; both are IMPORTED at the top of this file. **Nothing below
// re-derives a length the sim also knows.** What is still declared here is what exists only in
// the picture — material thicknesses, the belt, the pulleys — and even those are derived wherever
// the chain already fixes them.
//
// THE THREE NODES, AND THE TWO FRAMES THEY MAKE:
//  · `bb-turret-head` (YAW) has its origin on the turret's ROTATION AXIS, at deck height. That is
//    the TURRET frame, and the turret plate — the one part centred on the axis — is built in it.
//  · `bb-turret-axle` (FIXED) hangs under it at `(axleX, 0, BB_TURRET_AXLE_Z)`. That is the AXLE
//    frame every θ in `config.ts` is measured in: +x the shot direction at rest, +z up, θ CCW
//    from +x, the exit at θ = 90° and the feed pinch at θ = 180°.
//  · `bb-turret-pitch` (ELEVATION) sits at the axle node's own origin and carries the hood arc and
//    its two arms and NOTHING ELSE — the flywheel, both side plates, the braces, the motor, the
//    belt and the feed throat are all on the fixed node, so no number can make them move.
//
// ⚠️ **THE AXLE NODE IS NEW, AND IT IS THE OWNER'S SECOND ITEM OF 2026-09-19**: "the flywheel
// should come forward more so that the location where the balls contact the flywheel initially as
// it comes up is roughly in the center of the turret". The axle used to sit ON the rotation axis,
// which meant the element had to be fed in from somewhere off to the back. It is fed THROUGH THE
// RING BEARING now, straight up the rotation axis, and the wheel moved forward by `axleX` to meet
// it there.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * the flywheel as DRAWN: **ONE compliant wheel, centred on the channel.**
 *
 * ⚠️ **OWNER, 2026-09-19: "the flywheel on the shooter looks like there are two wheels stacked
 * next to each other. there should just be one in the center."** It was exactly that — two
 * 0.9-in wheels at y = ±0.7 with a 0.5-in gap between them, a stack 2.3 in wide in a 3.1-in
 * channel, which from any angle reads as two discs and leaves no shaft showing. There was no
 * seam and no groove to fix: the cause was two meshes, and one mesh is the fix.
 *
 * The RADIUS and the axle are the sim's (72 mm, `BB_FLYWHEEL_D_MM`, and `BbHeadDims.axleX`) and
 * nothing here may touch them. The WIDTH is the picture's, and it is DERIVED: half an element
 * diameter, i.e. one element RADIUS, which is 1.40 in on a POLLEN head and 1.80 on a NECTAR one.
 * That grips the middle half of the ball it pinches — a real FTC shooter's single compliant wheel
 * — and leaves `(plateGap − w) / 2` of bare shaft to each side plate (0.85 and 1.05), so the
 * through-axle and its spacers are visible rather than buried in tyre.
 */
const BB_FLYWHEEL_W_FRAC = 0.5;
/** the wheel's HUB, as a fraction of its radius: the boss the shaft keys into, drawn so the tyre
 *  reads as a tyre on a hub and not as a solid puck. */
const BB_FLYWHEEL_HUB_FRAC = 0.42;
/** the spacer collars either side of the wheel, which are what keep it centred on the shaft. */
const BB_FLYWHEEL_SPACER_R = 0.38;

/** the two pulleys and the belt between them. The SITE of the motor is `BbHeadDims.motorR`
 * (derived, in `config.ts`); the pulley radii and the belt section are the picture's. APPROX. */
const BB_FW_PULLEY_R = 0.68;
const BB_MOTOR_PULLEY_R = 0.54;
const BB_BELT_T = 0.16;
const BB_BELT_W = 0.35;
/**
 * ⚠️ **THE BELT RUNS OUTBOARD OF A SIDE PLATE, AND IT HAS TO.** It used to run in the flywheel's
 * own centre gap, which worked while the motor sat in front of the wheel. The motor is BEHIND the
 * hood now (owner item a), and the hood's shell — a disc of radius `hoodR + BB_HOOD_T` sweeping
 * from θ = 90° to 202° — lies across every straight line from the axle to it. So the flywheel
 * axle carries its pulley OUTSIDE the plate, the motor's shaft reaches out to meet it, and the
 * belt runs down the plate's outer face, which is where an FTC shooter's belt usually is anyway.
 * This is how far outboard of that face it sits.
 */
const BB_BELT_CLEAR = 0.25;

/** the AXLE-FRAME angle of the hood's exit lip: straight up over the wheel, at every pitch,
 * because the hood's own frame elevates with it. */
const TH_EXIT = Math.PI / 2;

/**
 * THE FIXED SIDE PLATE'S OUTER BOUNDARY at one axle-frame angle — an ARC INTERSECTED WITH A BOX,
 * and nothing else:
 *
 *     r(θ) = min( hoodR,
 *                 BB_SIDE_PLATE_TOP_Z    / sin θ   (sin θ > 0),
 *                 BB_SIDE_PLATE_BOTTOM_Z / sin θ   (sin θ < 0),
 *                 BB_SIDE_PLATE_FRONT_X  / cos θ   (cos θ > 0) )
 *
 * A flat TOP at the outgoing corridor's ceiling, a flat FRONT, a flat BOTTOM on the turret plate,
 * and the arc at `hoodR` closing the rear. It hugs the wheel, and on a 17-in chassis it is 16.2
 * sq in of plate (NECTAR 18.4). `hoodR` is the only per-head term.
 *
 * ── ⚠️ A FIXED PLATE MUST NOT BE SIZED TO A PART THAT MOVES AWAY FROM IT ─────────────────────
 * Two passes tried to answer "the hood floats 3 in above anything fixed" by GROWING this plate up
 * to the hood — first a 22° relief ramp and a 64° arc (a teardrop with a hump over the feed), then
 * an exit cut and a raked tail (cleaner, still wrong). Both are the same mistake, and the 80° pose
 * is where it shows: the hood swings down behind the wheel and leaves two bare fins standing at
 * `hoodR` with nothing on top of them. The owner said so twice — "the arc in the parallel plates
 * reaches too high", then "the shooter parallel plates became ugly. remember that the arc does not
 * need to be big."
 *
 * **Nobody ever complained about THIS shape.** What was wrong was never the plate: it was that the
 * hood hung off two 0.26-in spokes. So the plate is back to the compact outline and the hood
 * carries its own CHEEKS instead — see `buildHoodNode`. The thing that has to reach the hood is
 * the thing that moves with it.
 *
 * ⚠️ **AND THE WHEEL-TO-HOOD GAP IS NOT WHAT MOVED — IT NEVER IS.** That gap is one element
 * diameter less the compression; it is the channel the element travels up, and `bbMuzzleLocal` is
 * measured off it. Nothing about `hoodR`, the release, or any constant in `config.ts` changes for
 * a picture fix. What changes is how much PLATE is left, which `BB_SIDE_PLATE_TOP_Z` is the only
 * reader of: grep it — it appears in this file and in its own doc comment, never in `robot.ts`.
 */
function sidePlateR(th: number, hoodR: number): number {
  const st = Math.sin(th);
  const ct = Math.cos(th);
  let r = hoodR;
  if (st > 1e-9) r = Math.min(r, BB_SIDE_PLATE_TOP_Z / st);
  if (st < -1e-9) r = Math.min(r, BB_SIDE_PLATE_BOTTOM_Z / st);
  if (ct > 1e-9) r = Math.min(r, BB_SIDE_PLATE_FRONT_X / ct);
  return r;
}

/**
 * The four angles where the profile above CHANGES WHICH CONSTRAINT BINDS. Sampling alone rounds a
 * corner off; these go into the sample set so every corner is an exact vertex and every flat face
 * is genuinely flat rather than a 0.75° chord.
 */
function sidePlateCorners(hoodR: number): number[] {
  return [
    Math.atan2(BB_SIDE_PLATE_TOP_Z, BB_SIDE_PLATE_FRONT_X), //                   front ↔ top
    Math.PI - Math.asin(BB_SIDE_PLATE_TOP_Z / hoodR), //                         top ↔ arc
    Math.PI - Math.asin(BB_SIDE_PLATE_BOTTOM_Z / hoodR), //                      arc ↔ bottom
    Math.PI * 2 + Math.atan2(BB_SIDE_PLATE_BOTTOM_Z, BB_SIDE_PLATE_FRONT_X), //  bottom ↔ front
  ];
}

/**
 * An ANNULAR SECTOR in the axle frame (the x–z plane), extruded across the channel.
 *
 * `THREE.ExtrudeGeometry` runs its depth along +z and `rotateX(π/2)` maps the shape's own y to
 * world z and the depth to −y, so the band lands in y ∈ [−depth, 0]; `y0` re-centres it. Every
 * arc part in this section is built through here, so the frame convention is stated once — and
 * the hood cheek's own sector, which needs a bored hole `arcBand` has no argument for, restates
 * those three lines rather than inventing a fourth convention.
 *
 * ⚠️ **A `framePart` LIST MUST NOT MIX INDEXED AND NON-INDEXED BUFFERS.** `mergeGeometries`
 * refuses one — it logs and returns `null`, and `framePart` then falls back to `parts[0]`, so the
 * merge SILENTLY drops every part after the first. An `ExtrudeGeometry` is non-indexed and a
 * `BoxGeometry`/`CylinderGeometry` is indexed, so a hood arm built of both once came out as its
 * rim alone — a hood arc floating on nothing, in a build whose whole point was that the hood has
 * something to hang from (2 of 4 parts survived, measured). Every list in this section is one
 * kind or the other; `toNonIndexed()` is the way across if one ever has to mix.
 */
function arcBand(rIn: number, rOut: number, th0: number, th1: number, depth: number, y0: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, rOut, th0, th1, false);
  if (rIn > 0) shape.absarc(0, 0, rIn, th1, th0, true);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 24 });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, y0 + depth / 2, 0);
  return geo;
}

/**
 * a rounded rectangle in a plate's own PLAN (x fore-aft, y lateral), wound CCW.
 *
 * The turret plate is one of these and its FEED SLOT is another, used as a hole. The slot is a
 * rectangle and not a bore because the hood's tail sweeps down into it at full elevation on the
 * NECTAR head, out at a |y| no circle big enough to pass the element would reach.
 */
function roundedRect<T extends THREE.Path>(p: T, x0: number, x1: number, halfW: number, r: number, cw = false): T {
  // `s` flips the traversal. `ExtrudeGeometry` normalizes an outline it finds counter-clockwise
  // and the holes under it, but NOT the other way round, so the outline is built CCW and each
  // hole CW — the same pairing `platePlane`'s lightening holes use.
  const s = cw ? -1 : 1;
  p.moveTo(x0 + r, -s * halfW);
  p.lineTo(x1 - r, -s * halfW);
  p.quadraticCurveTo(x1, -s * halfW, x1, -s * (halfW - r));
  p.lineTo(x1, s * (halfW - r));
  p.quadraticCurveTo(x1, s * halfW, x1 - r, s * halfW);
  p.lineTo(x0 + r, s * halfW);
  p.quadraticCurveTo(x0, s * halfW, x0, s * (halfW - r));
  p.lineTo(x0, -s * (halfW - r));
  p.quadraticCurveTo(x0, -s * halfW, x0 + r, -s * halfW);
  return p;
}

/**
 * THE HOOD, AND THE ONLY THING THAT ELEVATES WITH IT.
 *
 * ⚠️ **OWNER RULING, VERBATIM: "when the hood is initialising/changing angle, the flywheel should
 * be fixed and the parallel plates should be fixed. Only the hood, a central arc in the back,
 * should be moving up and down."** This group IS that sentence. It pivots on the AXLE (it sits at
 * the axle node's own origin) and it holds the arc, its two CHEEKS and the muzzle node.
 *
 * ── ⚠️ THE HOOD CARRIES ITS OWN CHEEKS, AND THAT IS WHAT REPLACED TWO FAILED ANSWERS ─────────
 * The hood's arc lives at `hoodR … +BB_HOOD_T` and it ELEVATES, so it can never bolt to anything
 * fixed. Two passes tried to solve that by growing the FIXED side plates up to `hoodR` — a relief
 * ramp and a 64° arc, then an exit cut and a raked tail — and both left the 80° pose with two bare
 * fins standing where the hood used to be, because at full elevation the hood has swung down
 * behind the wheel and the plate it was sized to is chasing nothing. See `sidePlateR`.
 *
 * What a real adjustable hood has is a pair of CHEEK PLATES that are part of the hood: a pivot
 * boss on the shooter axle and a solid sector out to the hood's own outer face, spanning the
 * hood's own wrap. Swinging the boss swings the whole bracket, so hood + cheeks read as ONE rigid
 * assembly hinged on the axle at EVERY pitch, and there is no elevation at which anything floats.
 * "The arc does not need to be big" is the sector's size rule: it spans `BB_HOOD_WRAP` and not one
 * degree more, because that is the arc it carries.
 *
 * They run INBOARD, in the lateral band between the element and each side plate, which is where
 * the clearance is: outboard on the drive side the belt and the flywheel pulley own everything
 * past 1.98 in. So a cheek meets exactly two things — the hood, which it IS, and the shaft it is
 * journalled on.
 */
function buildHoodNode(H: BbHeadDims, which: 0 | 1): THREE.Group {
  const pitch = new THREE.Group();
  const halfW = H.elemR;
  // a cheek's lateral width is DERIVED, not chosen: the channel's half, less the inset from the
  // side plate's inner face, less the hood. 0.09 in on EITHER head — a sheet-metal cheek.
  //
  // ⚠️ **THE CHEEK'S INBOARD FACE IS THE CHANNEL WALL, AND THAT IS WHY IT MAY CROSS THE ELEMENT'S
  // PATH.** An element is a SPHERE: at lateral offset `elemR` its cross-section is a point, so a
  // member that starts there sweeps no volume the element occupies, at any radius and any angle.
  // That is the only reason a SOLID sector can run from the axle out to the hood — in the x–z
  // PROJECTION there is no such path, because the element fills it.
  const armW = H.plateGap / 2 - BB_HOOD_ARM_INSET - halfW;
  const armHubR = 0.75;
  const thFeed = TH_EXIT + BB_HOOD_WRAP;

  // THE ARC — one element diameter clear of the wheel, less the compression, and `BB_HOOD_T`
  // thick, which is what stands it proud of the plates at every elevation.
  const hoodGeo = framePart(`hood:${which}`, () => [
    arcBand(H.hoodR, H.hoodR + BB_HOOD_T, TH_EXIT, thFeed, halfW * 2, 0),
  ]);
  const hood = new THREE.Mesh(hoodGeo, solidMat(TURRET_BARREL, 0.35, 0.55));
  hood.name = 'bb-turret-hood';
  pitch.add(cast(hood));

  // THE TWO CHEEKS — see the header. One merged part per side; the key carries the side, because
  // the two are mirror images and a shared buffer would put both on one.
  //
  // The LIGHTENING BORE is what keeps a solid sector reading as a machined bracket rather than a
  // slab. It sits half way out the sector and is sized off the sector's OWN half-chord there less
  // one `BB_HOOD_ARM_T`, so whatever the head, the web left at each radial edge is exactly an
  // arm's thickness and the rim and the apex come out the same width as each other.
  for (const s of [1, -1] as const) {
    const y0 = s * (halfW + armW / 2);
    const cheekGeo = framePart(`hoodCheek:${which}:${s}`, () => {
      const rOut = H.hoodR + BB_HOOD_T;
      const holeR = (rOut + armHubR) / 2;
      const shape = new THREE.Shape();
      shape.absarc(0, 0, rOut, TH_EXIT, thFeed, false);
      shape.lineTo(0, 0);
      shape.closePath();
      const bore = new THREE.Path();
      bore.absarc(
        Math.cos(TH_EXIT + BB_HOOD_WRAP / 2) * holeR,
        Math.sin(TH_EXIT + BB_HOOD_WRAP / 2) * holeR,
        holeR * Math.sin(BB_HOOD_WRAP / 2) - BB_HOOD_ARM_T,
        0,
        Math.PI * 2,
        true,
      );
      shape.holes.push(bore);
      const sector = new THREE.ExtrudeGeometry(shape, { depth: armW, bevelEnabled: false, curveSegments: 24 });
      sector.rotateX(Math.PI / 2);
      sector.translate(0, y0 + armW / 2, 0);
      // ...and the boss it pivots on, which is what closes the sector's own apex over the shaft
      return [sector, arcBand(0, armHubR, 0, Math.PI * 2, armW, y0)];
    });
    // ⚠️ THE HOOD'S MATERIAL, NOT THE PLATE'S. A cheek in `ALU` is the same grey as the fixed
    // side plate it sits behind, so the eye groups it with the structure it slides past instead
    // of with the arc it carries — which is the whole claim this bracket exists to make.
    const cheek = new THREE.Mesh(cheekGeo, solidMat(TURRET_BARREL, 0.4, 0.45));
    cheek.name = 'bb-turret-hood-cheek';
    pitch.add(cast(cheek));
  }

  // THE MUZZLE, as a named empty at the hood's LIP — `pathR` straight up from the axle in this
  // node's own frame, which becomes `bbMuzzleLocal(pitch, which)` once the node has turned.
  //
  // ⚠️ IT IS READ OFF `bbMuzzleLocal` ITSELF at the rest pose, where this node's frame and the
  // axle frame coincide, and then shifted by the axle's own forward offset because the sim
  // answers in the TURRET frame. Placing it at a locally written `pathR` would be the same number
  // by a second route, and a second route is how the last five passes disagreed.
  const exit = new THREE.Object3D();
  exit.name = 'bb-turret-exit';
  const rest = bbMuzzleLocal(BB_TURRET_PITCH_MIN, which);
  exit.position.set(-rest.back - H.axleX, 0, rest.z - BB_TURRET_AXLE_Z);
  pitch.add(exit);
  return pitch;
}

/**
 * EVERYTHING ELSE THE SHOOTER IS — and none of it elevates.
 *
 * `axle` is the fixed node at the flywheel axle, so every position added to it is a `config.ts`
 * (θ, r) read off as (cos θ · r, sin θ · r) with no frame shift to get wrong. `head` is the YAW
 * node on the rotation axis, and the only things built in it are the two parts centred on that
 * axis: the turret plate and its feed slot.
 */
function addFixedShooter(head: THREE.Group, axle: THREE.Group, H: BbHeadDims, which: 0 | 1): void {
  // ── THE TURRET PLATE, ON THE SLEW RING, CUT THROUGH FOR THE FEED ──────────────────────────
  // ⚠️ THE SLOT IS THE POINT. The element comes up the rotation axis, through the ring bearing's
  // bore and through this plate, which is what makes the feed path something you can see rather
  // than something a comment claims. It is a rounded RECTANGLE, not a bore: on the NECTAR head
  // the hood's tail dips 0.14 in below the plate at full elevation, at a radius a circle big
  // enough to pass the element would not reach.
  const plateGeo = framePart(`turretPlate:${which}`, () => {
    const shape = roundedRect(new THREE.Shape(), H.plateBackX, H.plateFrontX, H.plateHalfW, 0.5);
    shape.holes.push(roundedRect(new THREE.Path(), H.slotBackX, H.slotFrontX, H.slotHalfW, 0.25, true));
    const g = new THREE.ExtrudeGeometry(shape, { depth: BB_TURRET_PLATE_T, bevelEnabled: false, curveSegments: 8 });
    g.translate(0, 0, BB_TURRET_PLATE_TOP_Z - BB_DECK_Z - BB_TURRET_PLATE_T);
    return [g];
  });
  const turretPlate = new THREE.Mesh(plateGeo, solidMat(ALU_DK, 0.45, 0.4));
  turretPlate.name = 'bb-turret-plate';
  head.add(cast(turretPlate));

  // ── THE TWO SIDE PLATES — `sidePlateR`, sampled, with its four corners exact ───────────────
  // SOLID, not a band with a bore: a side plate is what the flywheel is JOURNALLED in, and the
  // bare annulus an earlier band left between its hub and its rim is what made the wheel read as
  // unconstrained. Everywhere the flat top does not cut it, the plate is behind the wheel's rim.
  const sideGeo = framePart(`shooterSidePlate:${which}`, () => {
    const angles: number[] = [];
    const N = 480;
    for (let i = 0; i < N; i++) angles.push((Math.PI * 2 * i) / N);
    for (const c of sidePlateCorners(H.hoodR)) angles.push(((c % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
    angles.sort((a, b) => a - b);
    const shape = new THREE.Shape();
    angles.forEach((th, i) => {
      const r = sidePlateR(th, H.hoodR);
      const x = Math.cos(th) * r;
      const y = Math.sin(th) * r;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: BB_SHOOTER_PLATE_T, bevelEnabled: false });
    geo.rotateX(Math.PI / 2);
    return [geo];
  });
  for (const s of [1, -1] as const) {
    const plate = new THREE.Mesh(sideGeo, solidMat(ALU, 0.4, 0.45));
    plate.name = 'bb-turret-side-plate';
    // the geometry runs y ∈ [−t, 0], so this puts each plate's INNER face on the channel wall
    plate.position.y = s > 0 ? H.plateGap / 2 + BB_SHOOTER_PLATE_T : -H.plateGap / 2;
    axle.add(cast(plate));
  }

  // ── THE FLYWHEEL — ONE WHEEL, CENTRED, ONE BEARING BLOCK ABOVE THE TURRET PLATE ───────────
  // Its height is not this file's to choose: `BB_TURRET_AXLE_Z` is the turret plate plus
  // `BB_FLYWHEEL_CLEAR` plus the radius, so the wheel sits where a flywheel shooter's wheel sits,
  // and the hood, the muzzle and the release all follow it. Its FORWARD position is not this
  // file's either — the axle node carries `axleX`, and that is what puts the first contact on the
  // turret's own rotation axis. Its LATERAL position is y = 0, dead centre of the channel: see
  // `BB_FLYWHEEL_W_FRAC` for the owner report that is.
  const fwW = H.elemR * 2 * BB_FLYWHEEL_W_FRAC;
  const wheel = new THREE.Mesh(wheelGeometry(BB_FLYWHEEL_R, fwW), solidMat(SWEEPER, 0.45, 0.2));
  wheel.name = 'bb-turret-flywheel';
  axle.add(cast(wheel));
  // the HUB inside it, and a spacer collar each side — a wheel on a shaft rather than a puck
  const hubGeo = framePart(`flywheelHub:${which}`, () => {
    const parts: THREE.BufferGeometry[] = [
      new THREE.CylinderGeometry(BB_FLYWHEEL_R * BB_FLYWHEEL_HUB_FRAC, BB_FLYWHEEL_R * BB_FLYWHEEL_HUB_FRAC, fwW + 0.06, 12),
    ];
    for (const s of [1, -1] as const) {
      parts.push(new THREE.CylinderGeometry(BB_FLYWHEEL_SPACER_R, BB_FLYWHEEL_SPACER_R, 0.3, 10).translate(0, s * (fwW / 2 + 0.15), 0));
    }
    return parts;
  });
  const hub = new THREE.Mesh(hubGeo, solidMat(ALU_DK, 0.35, 0.6));
  hub.name = 'bb-turret-flywheel-hub';
  axle.add(cast(hub));
  const beltY = H.plateGap / 2 + BB_SHOOTER_PLATE_T + BB_BELT_CLEAR + BB_BELT_W / 2;
  const shaftIn = -(H.plateGap / 2 + BB_SHOOTER_PLATE_T + 0.15);
  const shaftOut = beltY + BB_BELT_W / 2 + 0.1;

  // ── THE CROSS BRACES — `BB_TURRET_BRACES`, which is a MEASURED site list ───────────────────
  // All three are in the FRONT quadrant, because that is the only interior the machine has left:
  // the element rises up the rotation axis and is carried from θ = 180° round to the lip, and the
  // hood sweeps everything outside that. Nothing is adjusted here — this draws the list.
  const braceGeo = framePart(`shooterBrace:${which}`, () =>
    BB_TURRET_BRACES.map((site) => {
      const g = new THREE.CylinderGeometry(BB_TURRET_BRACE_R, BB_TURRET_BRACE_R, H.tieSpan, 10);
      g.translate(Math.cos(site.th) * site.r, 0, Math.sin(site.th) * site.r);
      return g;
    }),
  );
  const braces = new THREE.Mesh(braceGeo, solidMat(ALU, 0.35, 0.55));
  braces.name = 'bb-turret-brace';
  axle.add(cast(braces));

  // ── THE FEED THROAT — THE BACK OF THE CHANNEL THE ELEMENT COMES UP, AND THE REAR TIE ──────
  // ⚠️ **THIS IS WHAT REPLACES THE "WEIRD FLAP IN THE BACK", REPORTED TWICE.** The first answer
  // was a loose plank and the second was a FEED SHOE — an arc hanging outboard of the hood,
  // bolted to the plates on paper and touching nothing you could see on screen. The feed comes up
  // the rotation axis now, so the two side plates ARE the throat's cheeks and the only missing
  // part is its BACK: one flat vertical wall standing on the turret plate, `BB_FEED_SLIDE` clear
  // of the hood's outermost swept radius (a plane outside that radius clears the hood at every
  // elevation, with no angular bookkeeping). It spans the channel and both plates, so it is the
  // rear tie; its two rearward EARS carry the motor.
  const wallX = -(H.wallR + BB_FEED_WALL_T / 2);
  const earX0 = -(H.wallR + BB_FEED_WALL_T);
  const earX1 = -(H.motorR + BB_TURRET_MOTOR_R);
  const earH = 2 * (BB_TURRET_MOTOR_R + 0.15);
  const throatGeo = framePart(`feedThroat:${which}`, () => {
    const parts: THREE.BufferGeometry[] = [
      boxAt(
        BB_FEED_WALL_T,
        H.tieSpan,
        BB_SIDE_PLATE_TOP_Z - BB_SIDE_PLATE_BOTTOM_Z,
        wallX,
        0,
        (BB_SIDE_PLATE_TOP_Z + BB_SIDE_PLATE_BOTTOM_Z) / 2,
      ),
    ];
    for (const s of [1, -1] as const) {
      parts.push(
        boxAt(
          earX0 - earX1,
          BB_SHOOTER_PLATE_T,
          earH,
          (earX0 + earX1) / 2,
          s * (H.plateGap / 2 + BB_SHOOTER_PLATE_T / 2),
          0,
        ),
      );
    }
    return parts;
  });
  const throat = new THREE.Mesh(throatGeo, solidMat(ALU, 0.4, 0.45));
  throat.name = 'bb-turret-throat';
  axle.add(cast(throat));

  // ── THE MOTOR, BEHIND THE HOOD, BOLTED TO THE FEED WALL'S EARS ────────────────────────────
  // ⚠️ OWNER ITEM (a): "the motor should be on the other side of the flywheel, behind the hood."
  // It sat at θ = −15°, in front of and under the wheel. `BbHeadDims.motorR` puts it at θ = 180°
  // — dead behind the axle and level with it — just clear of the feed wall, which is the only
  // pocket left once the hood sweeps 90°…202° and the element owns everything inside that.
  const mx = -H.motorR;
  // ⚠️ THE CAN AND NOTHING ELSE. Its output SHAFT is part of `bb-turret-shaft` below: the lane's
  // "between the plates" measurement is about the can, and a shaft merged in here would put the
  // motor's own vertices out at the belt's plane and make that reading a lie.
  const motorGeo = framePart(`shooterMotor:${which}`, () => [
    new THREE.CylinderGeometry(BB_TURRET_MOTOR_R, BB_TURRET_MOTOR_R, H.plateGap - 0.1, 12).translate(mx, 0, 0),
  ]);
  const motor = new THREE.Mesh(motorGeo, solidMat(MOTOR, 0.5, 0.4));
  motor.name = 'bb-turret-motor';
  axle.add(cast(motor));

  // ── THE TWO SHAFTS — the flywheel's, which runs right through and out the belt side to carry
  // its pulley, and the motor's output, which reaches out to meet it. Both cross a side plate
  // because the belt has to run outboard of one.
  const shaftGeo = framePart(`shooterShaft:${which}`, () => [
    new THREE.CylinderGeometry(0.26, 0.26, shaftOut - shaftIn, 8).translate(0, (shaftIn + shaftOut) / 2, 0),
    new THREE.CylinderGeometry(0.16, 0.16, shaftOut - (H.plateGap / 2 - 0.05), 8).translate(
      mx,
      (shaftOut + H.plateGap / 2 - 0.05) / 2,
      0,
    ),
  ]);
  const shaft = new THREE.Mesh(shaftGeo, solidMat(ALU, 0.3, 0.7));
  shaft.name = 'bb-turret-shaft';
  axle.add(cast(shaft));

  // THE BELT — two pulleys and the two straight tangent runs between them, merged into one part,
  // in a plane `BB_BELT_CLEAR` outboard of the side plate's outer face. A `TubeGeometry` over a
  // closed spline is the obvious alternative and costs ~20× the vertices for a loop 0.16 thick.
  const beltGeo = framePart(`shooterBelt:${which}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    for (const [r, x] of [
      [BB_FW_PULLEY_R, 0],
      [BB_MOTOR_PULLEY_R, mx],
    ] as const) {
      const p = new THREE.CylinderGeometry(r, r, BB_BELT_W + 0.08, 14);
      p.translate(x, beltY, 0);
      parts.push(p);
    }
    // the external tangents of two circles of radii R1, R2 a distance d apart leave each centre
    // along the SAME unit normal, offset from the centre line by asin((R1 − R2) / d)
    const d = H.motorR;
    const off = Math.asin((BB_FW_PULLEY_R - BB_MOTOR_PULLEY_R) / d);
    const runLen = Math.sqrt(d * d - (BB_FW_PULLEY_R - BB_MOTOR_PULLEY_R) ** 2);
    for (const s of [1, -1] as const) {
      const u = Math.PI + s * (Math.PI / 2 + off);
      const ax = Math.cos(u) * BB_FW_PULLEY_R;
      const az = Math.sin(u) * BB_FW_PULLEY_R;
      const bx = mx + Math.cos(u) * BB_MOTOR_PULLEY_R;
      const bz = Math.sin(u) * BB_MOTOR_PULLEY_R;
      const g = new THREE.BoxGeometry(runLen, BB_BELT_W, BB_BELT_T);
      g.rotateY(-Math.atan2(bz - az, bx - ax));
      g.translate((ax + bx) / 2, beltY, (az + bz) / 2);
      parts.push(g);
    }
    return parts;
  });
  const belt = new THREE.Mesh(beltGeo, solidMat(ALU_DK, 0.55, 0.3));
  belt.name = 'bb-turret-belt';
  axle.add(cast(belt));
}

/**
 * ONE TURRET, BOLTED TO THE DECK.
 *
 * ⚠️ `BB_DECK_Z`, NOT 0 AND NOT `heightIn` — and both mistakes have shipped. Day 1 put the ring
 * at z = 1, INSIDE the chassis box, so every robot was a featureless slab; the fix then raised it
 * to the top of the full-height box, which stood the shooter a foot and a half up in the air for
 * no reason anything could see. It is bolted to the DECK, like the real thing.
 *
 * `which` is the exit this head is: 0 is the POLLEN turret every turreted build has, 1 the DOUBLE
 * turret's NECTAR turret. It picks the head's whole dimension set (`bbHead`), so a NECTAR head is
 * visibly the bigger machine — bigger hood, wider channel, axle further forward, muzzle 0.4 in
 * higher. Every `framePart` key below carries it, or the two would share one buffer.
 *
 * THE NODE NAMES ARE AN INTERFACE. `bb-turret-head` is the YAW pivot (it carries the turret's own
 * world heading minus the chassis's) and `bb-turret-pitch` is the ELEVATION pivot, with
 * `bb-turret-exit` the muzzle under it. `bb-turret-axle` is the fixed node BETWEEN them, and it is
 * what moved the wheel forward of the rotation axis; the per-frame sync writes the same two
 * rotations, in the same order, with the same signs.
 *
 * EXPORTED for `scripts/smoke-biobuzz/render.ts`, which BUILDS this group and MEASURES it at
 * sampled elevations rather than reading the source and trusting it. Five passes were signed off
 * by a lane that only ever grepped for literals; a check that cannot see the geometry cannot see
 * the bug. It is not imported anywhere in `src/` — `buildRobotGroup` below is still the one
 * generator the match and the builder share.
 */
export function buildTurret(spec: RobotSpec, mountPos: BbMountPos, which: 0 | 1 = 0): THREE.Group {
  const group = new THREE.Group();
  const H = bbHead(which);
  const ring = turretRadius(spec);
  const local = turretLocal(spec, mountPos);
  group.name = 'bb-turret';
  group.position.set(local.x, local.y, BB_DECK_Z);

  // THE SLEW RING STAYS WITH THE CHASSIS — the toothed outer race is bolted to the frame and the
  // head turns on it, which is the same statement `drawRobot.ts` makes in 2D. It is BORED, because
  // the feed comes up through it; the bore passes the element and stops short of the race.
  const ringBore = Math.min(H.elemR + 0.25, Math.max(0.2, ring - 0.45));
  const ringGeo = framePart(`turretRing:${ring.toFixed(4)}:${which}`, () => {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, ring, 0, Math.PI * 2, false);
    const bore = new THREE.Path();
    bore.absarc(0, 0, ringBore, 0, Math.PI * 2, true);
    shape.holes.push(bore);
    return [new THREE.ExtrudeGeometry(shape, { depth: BB_TURRET_RING_H, bevelEnabled: false, curveSegments: 24 })];
  });
  const ringMesh = new THREE.Mesh(ringGeo, solidMat(TURRET_RING, 0.4, 0.5));
  ringMesh.name = 'bb-turret-ring';
  group.add(cast(ringMesh));

  // ⚠️ THE YAW NODE'S ORIGIN IS THE ROTATION AXIS, AT DECK HEIGHT, AND IT USED TO BE THE AXLE.
  // It has to be the axis: `rotation.z` turns this node's children about its own origin, so with
  // the axle offset forward the axle has to ORBIT the axis, which only happens if the offset is
  // inside the node rather than on it.
  const head = new THREE.Group();
  head.name = 'bb-turret-head';

  // THE FIXED NODE AT THE FLYWHEEL AXLE — the AXLE FRAME, `axleX` forward and `BB_TURRET_AXLE_Z`
  // up. Everything but the turret plate hangs off it, and the PITCH node sits at its origin,
  // which is what makes the hood pivot about the axle for free.
  const axle = new THREE.Group();
  axle.name = 'bb-turret-axle';
  axle.position.set(H.axleX, 0, BB_TURRET_AXLE_Z - BB_DECK_Z);
  addFixedShooter(head, axle, H, which);

  const pitch = buildHoodNode(H, which);
  pitch.name = 'bb-turret-pitch';
  axle.add(pitch);
  head.add(axle);
  group.add(head);
  group.userData.head = head;
  group.userData.axle = axle;
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

  // THE TWO ROBOT SIGNS (R401: "Minimum of two ROBOT SIGNS per ROBOT … on opposite or adjacent
  // surfaces"). Both side plates is the OPPOSITE case, and it is the one that reads from either
  // side of the FIELD — the header above has the rule text and every dimension's citation. ONE
  // texture and ONE geometry serve both; only the orientation differs, and neither is mirrored.
  const signTex = getSignTexture(bbRobotSignText(spec), alliance);
  const signGeo = new THREE.PlaneGeometry(BB_SIGN_W, BB_SIGN_H);
  const signMat = new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.6 });
  for (const [side, where] of [[1, 'left'], [-1, 'right']] as const) {
    const sign = new THREE.Mesh(signGeo, signMat);
    sign.name = `robot:${id}:sign:${where}`;
    // R401.D — supported by the structure of the ROBOT: it sits ON the side plate, a hair proud
    // of it, and centred on the drivetrain band. `BB_PLATE_H` is 4.6 in, so a 2.75-in plate has
    // clearance top and bottom on every chassis this builder can make.
    sign.position.set(0, side * (spec.width / 2 + 0.05), BB_PLATE_H * 0.5);
    sign.quaternion.copy(bbRobotSignOrientation(side));
    group.add(sign);
  }

  const intake = buildIntake(spec);
  for (const n of intake.nodes) group.add(n);
  group.userData.intakeRollers = intake.rollers;

  const heads: THREE.Group[] = [];
  const pitches: THREE.Group[] = [];
  if (bbIsTurreted(launcher)) {
    const t0 = buildTurret(spec, launcher.mount, 0);
    group.add(t0);
    heads.push(t0.userData.head as THREE.Group);
    pitches.push(t0.userData.pitch as THREE.Group);
    if (launcher.kind === 'twinturret' && launcher.mount2) {
      // ⚠️ `1`, AND IT IS NOT A LABEL. Turret 1 is the NECTAR exit (`bbTurretFor`), and a NECTAR
      // is 3.6 in where a POLLEN is 2.8 — so this head is built to a different dimension set and
      // releases from a different muzzle, which is the sim's own answer too.
      const t1 = buildTurret(spec, launcher.mount2, 1);
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
/**
 * ⚠️ `BB_SHOOTER_MUZZLE_Z` IS RETIRED, AND SO IS THE IDEA BEHIND IT. It exported `BB_LAUNCH_Z0`
 * as "where the muzzle sits", which was true only while the muzzle was a CONSTANT. The release
 * follows the hood now (owner, 2026-09-19), so the muzzle is a FUNCTION of elevation and the one
 * that answers it is `bbMuzzleLocal(pitch)` in `robot.ts` — read by the sim, by the shot-path
 * predictor and by the `bb-turret-exit` node this file places. A second export here would be the
 * second number that started all of this.
 */

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
        // rotation only needs the DIFFERENCE. ELEVATION is a separate node under it, because only
        // the HOOD elevates — the flywheel, the plates and everything bolted between them are on
        // the yaw node and do not move with pitch at all (owner item d, 2026-09-19).
        //
        // ⚠️ NOTHING HERE CHANGED WHEN THE ASSEMBLY DID, AND THAT IS THE TEST OF THE RESTRUCTURE.
        // Same two node names, same two rotations, same signs; what moved is where `bb-turret-
        // pitch` pivots (the AXLE) and what hangs off it (the hood and its arms).
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
 * The per-robot half is every mesh built inline in `buildRobotGroup` — the nose box, the two
 * ROBOT SIGN planes and their one shared material (their TEXTURE is cached per team number and
 * alliance, is shared with every other robot carrying it, and is not touched), the turret ring,
 * axle, motor and feed chute. The Box Tube's sections, the shooter's belt and the swerve
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
