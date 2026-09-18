import * as THREE from 'three';
import type { RobotState, World } from '../../../types';
import { ARC_MAX, arcBuffer, LANDING, solveShotLanding } from './renderLanding';

/**
 * BIOBUZZ 3D SCENE — THE RETICLE (Day 2, `docs/biobuzz/plan-3d.md` §4.2: "a reticle at the
 * solved landing").
 *
 * WHAT IT DRAWS: a ring on the field at the point the LOCAL robot's shot would actually arrive,
 * plus a faint line along the arc that gets it there. Not a laser down the barrel and not a
 * circle on the target — the ring is where the element LANDS, so a turret still slewing sweeps
 * the ring across the tiles onto the CELL, and a robot out of range watches it fall short on the
 * floor. That is the whole point of it: the 2D view puts range in the driver's head for free (a
 * top-down map makes distance obvious) and a 3D view takes it away, because depth on a screen is
 * exactly what a perspective camera flattens.
 *
 * THE MATHS IS `renderLanding.ts`'s — read that file's header for where each number comes from
 * and what it must be kept in step with. This file is meshes only.
 *
 * ZERO PER-FRAME ALLOCATION: one ring mesh, one `BufferGeometry` wrapping `renderLanding`'s
 * preallocated arc buffer and rewritten through `setDrawRange`.
 */

const RING_INNER = 3.4;
const RING_OUTER = 4.6;
/** how far above whatever it is drawn on the ring floats. Depth testing is OFF (so the ring
 * reads through the tray's own lip and the hive frame, which is the case that matters — a shot
 * into a CELL lands inside a box), but the lift still keeps it clear of z-fighting the tiles in
 * the common floor case if a future pass ever turns depth back on. */
const RING_LIFT = 0.25;

/** the on-field accent, read ONCE. Category 3 in `docs/area/ui.md`'s theming note — its ground
 * is the CANVAS, which never themes, so unlike the scene backdrop this needs no theme
 * subscription and is deliberately absent from the dark block in `shell.css`. */
const RETICLE_FALLBACK = 0x5fb597;
function readReticleColor(): number {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--ds-on-field-accent').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return parseInt(raw.slice(1), 16);
  } catch {
    // a detached / pre-layout document — the literal is the same value
  }
  return RETICLE_FALLBACK;
}

export interface BbReticle {
  group: THREE.Group;
  dispose(): void;
}

export function buildBiobuzzReticle(): BbReticle {
  const group = new THREE.Group();
  group.name = 'bb-reticle';
  group.visible = false;
  const color = readReticleColor();

  const ringGeo = new THREE.RingGeometry(RING_INNER, RING_OUTER, 40);
  const ringMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.85,
    // ⚠️ NO DEPTH TEST (the brief's own requirement): a ring at a CELL's opening plane is INSIDE
    // the hive's tray, and a depth-tested ring would be hidden by the tray lip in front of it —
    // the one place the reticle is needed most. `depthWrite: false` keeps it from punching a
    // hole in whatever is drawn after it, and a high `renderOrder` puts it last.
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.name = 'bb-reticle:ring';
  ring.renderOrder = 10;
  group.add(ring);

  const arcGeo = new THREE.BufferGeometry();
  arcGeo.setAttribute('position', new THREE.BufferAttribute(arcBuffer, 3));
  arcGeo.setDrawRange(0, 0);
  const arcMat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.32,
    depthTest: false,
    depthWrite: false,
  });
  const arc = new THREE.Line(arcGeo, arcMat);
  arc.name = 'bb-reticle:arc';
  arc.renderOrder = 9;
  // the arc's vertices are field-absolute, so the line must never inherit a transform — and it
  // must never be frustum-culled against its bounding sphere, which was computed when the buffer
  // was empty and is never recomputed.
  arc.frustumCulled = false;
  group.add(arc);

  group.userData.ring = ring;
  group.userData.arc = arc;
  void ARC_MAX; // the buffer's own bound, owned by renderLanding.ts — named here for the reader

  return {
    group,
    dispose(): void {
      ringGeo.dispose();
      ringMat.dispose();
      arcGeo.dispose();
      arcMat.dispose();
    },
  };
}

/**
 * Pose the reticle for this frame, or hide it.
 *
 * HIDDEN when: there is no local robot (a spectator, a replay of somebody else's match), the
 * robot is a passive practice dummy, or there is no solvable shot. A reticle left on a stale
 * answer is worse than none — the driver would aim by it.
 */
export function updateBiobuzzReticle(ret: BbReticle, world: World, localRobotId: number | undefined): void {
  const group = ret.group;
  if (localRobotId === undefined) {
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
  if (!robot || robot.passive || !solveShotLanding(world, robot)) {
    group.visible = false;
    return;
  }
  const ring = group.userData.ring as THREE.Mesh;
  const arc = group.userData.arc as THREE.Line;
  ring.position.set(LANDING.x, LANDING.y, LANDING.z + RING_LIFT);
  arc.geometry.setDrawRange(0, LANDING.arc);
  (arc.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  group.visible = true;
}
