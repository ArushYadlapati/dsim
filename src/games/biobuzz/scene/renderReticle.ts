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

/**
 * BIOBUZZ 3D SCENE — THE SHOT PATH.
 *
 * WHAT IT DRAWS: a DOTTED line along the arc the local robot's next shot would fly, and ONLY when
 * that shot goes in. Nothing else — no landing ring, no marker, no faint line for a shot that
 * misses (owner playtest feedback 2026-09-18, items 5 and 6).
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
 */

/** how far above the arc's own height the line floats, so it never z-fights the tiles at the two
 * ends where the flight is near the floor. */
const PATH_LIFT = 0.25;

function readPathColor(): number {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--ds-on-field-accent').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return parseInt(raw.slice(1), 16);
  } catch {
    // a detached / pre-layout document — the literal is the same value
  }
  return parseInt(SHOT_PATH_COLOR.slice(1), 16);
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
    color: readPathColor(),
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
  group.add(line);
  group.userData.path = line;
  group.userData.dists = dists;

  return {
    group,
    dispose(): void {
      geo.dispose();
      mat.dispose();
    },
  };
}

/**
 * Pose the shot path for this frame, or hide it.
 *
 * HIDDEN when: `effects` is `minimal`, there is no local robot (a spectator, a replay of somebody
 * else's match), the robot is a passive practice dummy, or the shot would not be made.
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
  if (!robot || robot.passive || !solveShotPath(world, robot) || SHOT.points < 2) {
    group.visible = false;
    return;
  }
  const line = group.userData.path as THREE.Line;
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
  group.visible = true;
}
