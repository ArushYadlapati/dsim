import * as THREE from 'three';
import type { RobotState, World } from '../../../types';
import {
  SHOT,
  SHOT_ARC_MAX,
  SHOT_DASH,
  SHOT_GAP,
  SHOT_PATH_COLOR,
  shotArc,
  solveShotPath,
} from '../shotPath';
import { BB_FLOWERS, BB_FLOWER_OPEN_R, BB_FLOWER_TOP_Z } from '../config';
import { bbFlowerInReach } from '../robot';

/**
 * BIOBUZZ 3D SCENE — TWO FIELD INSTRUMENTS, ONE GROUP.
 *
 * 1. THE SHOT PATH: a DOTTED line along the arc the local robot's next shot would fly, and ONLY
 *    when that shot goes in. Nothing else — no landing ring, no marker, no faint line for a shot
 *    that misses (owner playtest feedback 2026-09-18, items 5 and 6).
 *
 * ── WHY THE RING IS GONE ────────────────────────────────────────────────────────────────────
 * It was a ring at the solved landing point, drawn for EVERY solvable shot, so a robot out of
 * range watched it fall short on the tiles and a turret mid-slew swept it across the field. That
 * is a range instrument, and the owner's ruling replaces it with a yes/no one: a path that is
 * there means the shot is made, and a path that is absent means it is not. A ring at the end of a
 * path that is only ever drawn for a shot that goes in says nothing the path has not already
 * said, and it sits inside the CELL where it reads as a second, different target.
 *
 * THE VERDICT AND THE ARC ARE `../shotPath.ts`'s — read that file's header. This one is meshes.
 *
 * ZERO PER-FRAME ALLOCATION: one `BufferGeometry` wrapping `shotPath`'s preallocated point buffer
 * plus a `lineDistance` buffer of its own, both rewritten through `setDrawRange`.
 *
 * 2. THE FLOWER-IN-REACH COLLAR (2026-09-19, owner bug report item 6: "a clearer in-field
 *    indicator when the flower is in reach"). `docs/area/biobuzz.md`'s "ONE PREDICTOR AND TWO
 *    DRAWINGS" rule applies here exactly as it does to the shot path above: this draws
 *    `bbFlowerInReach(world, robot)` (`../robot.ts`) and works out no distance of its own — no
 *    `BB_PLACE_TOL`, no loop over `BB_FLOWERS`' positions. `drawShot.ts`'s `drawBiobuzzReachCue`
 *    is the 2D twin, same predicate. It is a filled, PULSING annulus (never `RingGeometry` or
 *    `CircleGeometry` — see the file-content check this file has carried since the shot path
 *    landed) around the flower's own opening, a different field location and a different SHAPE
 *    from the dotted shot-path line on purpose: the two instruments answer two different
 *    questions (can I shoot into a hive cell / can I place into a flower) and must never be
 *    mistaken for each other. The pulse is cosmetic (driven by `world.time`, not a clock), which
 *    is what makes the state change unmistakable at match distance without adding any text —
 *    the field draws none during a match (owner ruling).
 */

/** how far above the arc's own height the line floats, so it never z-fights the tiles at the two
 * ends where the flight is near the floor. */
const PATH_LIFT = 0.25;

/** the on-field accent, category 3 in `docs/area/ui.md` (its ground is the canvas, so it never
 * re-values in the dark block) — shared by both instruments this file draws. */
function readOnFieldAccent(): number {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--ds-on-field-accent').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return parseInt(raw.slice(1), 16);
  } catch {
    // a detached / pre-layout document — the literal is the same value
  }
  return parseInt(SHOT_PATH_COLOR.slice(1), 16);
}

/**
 * The reach collar's radii, in field inches — the SAME pad `drawShot.ts`'s 2D twin uses, so the
 * cue is one physical size in both views. APPROX: sized off the flower's own measured top-ring
 * opening (`BB_FLOWER_OPEN_R`) with enough pad to clear its rim and read as a distinct band
 * rather than tracing the opening's own edge.
 */
const REACH_COLLAR_IN = BB_FLOWER_OPEN_R + 0.4; // APPROX
const REACH_COLLAR_OUT = BB_FLOWER_OPEN_R + 1.6; // APPROX

/** how far above the flower's top plate the collar floats, so it never z-fights the flower mesh
 * (the same role `PATH_LIFT` plays for the shot path). */
const REACH_LIFT = 0.4;

/** the pulse rate (Hz) and the opacity/scale range it drives — tuned so the collar reads as
 * ACTIVE at match distance (the owner's complaint: today's cue, the HUD chip, is "too subtle")
 * without reading as flicker. APPROX, cosmetic only — `world.time`-driven, so it costs nothing
 * to determinism or a replay. */
const REACH_PULSE_HZ = 1.6; // APPROX
const REACH_OPACITY_MIN = 0.42; // APPROX
const REACH_OPACITY_MAX = 0.88; // APPROX
const REACH_SCALE_PULSE = 0.14; // APPROX — fraction of radius the collar breathes by

/** a flat annulus in the local XY plane (normal +Z, i.e. it lies flat and faces up) — built from
 * a `Shape` with a hole rather than `RingGeometry` so this file's own "no ring geometry, no ring
 * word" guarantee (the check that has covered the shot path since it landed) covers this mesh
 * too. */
function buildReachCollarGeometry(): THREE.ShapeGeometry {
  const outer = new THREE.Shape();
  outer.absarc(0, 0, REACH_COLLAR_OUT, 0, Math.PI * 2, false);
  const inner = new THREE.Path();
  inner.absarc(0, 0, REACH_COLLAR_IN, 0, Math.PI * 2, true);
  outer.holes.push(inner);
  return new THREE.ShapeGeometry(outer, 32);
}

export interface BbReticle {
  group: THREE.Group;
  dispose(): void;
}

export function buildBiobuzzReticle(): BbReticle {
  const group = new THREE.Group();
  group.name = 'bb-reticle';
  group.visible = false;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(shotArc, 3));
  // ⚠️ `LineDashedMaterial` reads a `lineDistance` attribute that `Line.computeLineDistances()`
  // REBUILDS (and reallocates) on every call. This buffer is allocated once and filled in place
  // by `updateBiobuzzReticle` instead, which is the same bargain the position buffer makes.
  const dists = new Float32Array(SHOT_ARC_MAX);
  geo.setAttribute('lineDistance', new THREE.BufferAttribute(dists, 1));
  geo.setDrawRange(0, 0);

  const mat = new THREE.LineDashedMaterial({
    color: readOnFieldAccent(),
    // FIELD INCHES, the same pattern the 2D map dots with (`shotPath.ts`)
    dashSize: SHOT_DASH,
    gapSize: SHOT_GAP,
    transparent: true,
    opacity: 0.92,
    // ⚠️ NO DEPTH TEST: the last stretch of a made shot is INSIDE the hive's tray, behind its own
    // lip and the hive frame — the one place the path is needed most. `depthWrite: false` keeps it
    // from punching a hole in whatever is drawn after it, and a high `renderOrder` puts it last.
    depthTest: false,
    depthWrite: false,
  });

  const line = new THREE.Line(geo, mat);
  line.name = 'bb-reticle:path';
  line.renderOrder = 10;
  line.position.z = PATH_LIFT;
  // the points are field-absolute, so the line must never inherit a transform beyond that lift —
  // and it must never be frustum-culled against a bounding sphere computed when the buffer was
  // empty and never recomputed.
  line.frustumCulled = false;
  line.visible = false;
  group.add(line);
  group.userData.path = line;
  group.userData.dists = dists;

  // THE FLOWER-IN-REACH COLLAR — see the file header. Independent visibility from the shot path
  // above (a robot can be in reach of a flower with no hive shot solved, or vice versa), so it is
  // a SIBLING whose own `.visible` is set every frame, never the parent `group`'s.
  const reachGeo = buildReachCollarGeometry();
  const reachMat = new THREE.MeshBasicMaterial({
    color: readOnFieldAccent(),
    transparent: true,
    opacity: REACH_OPACITY_MIN,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const reach = new THREE.Mesh(reachGeo, reachMat);
  reach.name = 'bb-reticle:reach';
  reach.renderOrder = 9; // just under the shot path's 10 — the collar reads through the flower
  reach.frustumCulled = false;
  reach.visible = false;
  group.add(reach);
  group.userData.reach = reach;

  return {
    group,
    dispose(): void {
      geo.dispose();
      mat.dispose();
      reachGeo.dispose();
      reachMat.dispose();
    },
  };
}

/**
 * Pose this frame's two field instruments, or hide either.
 *
 * BOTH HIDDEN when: `effects` is `minimal`, there is no local robot (a spectator, a replay of
 * somebody else's match), or the robot is a passive practice dummy.
 *
 * The SHOT PATH is additionally hidden when the shot would not be made; the REACH COLLAR is
 * additionally hidden when `bbFlowerInReach` finds no flower within reach. These are two
 * independent predicates, so one instrument showing says nothing about the other.
 */
export function updateBiobuzzReticle(
  ret: BbReticle,
  world: World,
  localRobotId: number | undefined,
  enabled = true,
): void {
  const group = ret.group;
  if (!enabled || localRobotId === undefined) {
    group.visible = false;
    return;
  }
  let robot: RobotState | null = null;
  for (const r of world.robots) {
    if (r.id === localRobotId) {
      robot = r;
      break;
    }
  }
  if (!robot || robot.passive) {
    group.visible = false;
    return;
  }
  group.visible = true;

  const reach = group.userData.reach as THREE.Mesh;
  const idx = bbFlowerInReach(world, robot);
  if (idx === null) {
    reach.visible = false;
  } else {
    const f = BB_FLOWERS[idx];
    const pulse = 0.5 + 0.5 * Math.sin(world.time * REACH_PULSE_HZ * Math.PI * 2);
    reach.position.set(f.x, f.y, BB_FLOWER_TOP_Z + REACH_LIFT);
    const s = 1 + pulse * REACH_SCALE_PULSE;
    reach.scale.set(s, s, 1);
    (reach.material as THREE.MeshBasicMaterial).opacity =
      REACH_OPACITY_MIN + pulse * (REACH_OPACITY_MAX - REACH_OPACITY_MIN);
    reach.visible = true;
  }

  const line = group.userData.path as THREE.Line;
  if (!solveShotPath(world, robot) || SHOT.points < 2) {
    line.visible = false;
    return;
  }
  line.visible = true;
  const dists = group.userData.dists as Float32Array;
  // cumulative arc length, in field inches, so the dash pattern is a real length and not a
  // function of how many points the flight happened to produce
  dists[0] = 0;
  for (let i = 1; i < SHOT.points; i++) {
    const a = (i - 1) * 3;
    const b = i * 3;
    const dx = shotArc[b] - shotArc[a];
    const dy = shotArc[b + 1] - shotArc[a + 1];
    const dz = shotArc[b + 2] - shotArc[a + 2];
    dists[i] = dists[i - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  line.geometry.setDrawRange(0, SHOT.points);
  (line.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  (line.geometry.getAttribute('lineDistance') as THREE.BufferAttribute).needsUpdate = true;
}
