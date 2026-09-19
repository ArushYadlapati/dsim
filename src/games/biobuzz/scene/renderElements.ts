import * as THREE from 'three';
import type { Artifact, ArtifactColor, World } from '../../../types';
import { SIM_DT } from '../../../config';
import { BB_HIVE_W, BB_NECTAR_R, BB_POLLEN_R } from '../config';
import { biobuzzPhysics } from '../state';
import type { ElementShadows } from '../graphics/settings';

/**
 * BIOBUZZ 3D SCENE — the 56 scoring elements, as two `InstancedMesh`es (Day 1,
 * `docs/biobuzz/plan-3d.md` §3.4, §4.2).
 *
 * POSITIONING. `ground`/`flight` balls are posed at `(pos.x, pos.y, z + r)` — `z` is already the
 * height ABOVE the tile a resting ball's centre sits at (a resting ground ball reads `z === 0`
 * in `draw.ts`/`play.ts`, so its drawn centre has to be lifted by its own radius; a flight ball's
 * `z` is real altitude). `held`/`stock` balls are off-field and hidden (scaled to zero).
 *
 * `element` balls (parked in a HIVE cell or a FLOWER stack, `state.ts`'s `BallState`) already
 * carry a REAL, useful `pos`/`z` — but WHAT that z means depends on which solve wrote it, so
 * the height adjustment branches on `biobuzzPhysics(world)` and not on the ball's kind; the
 * comment inside `updateBiobuzzElements` has the two conventions and the two bugs. A HIVE cell
 * is the one case `park()` does NOT give a unique
 * position: every element parked in the same cell shares that cell's centre point and a single
 * fixed height (`CELL_MID_Z`, `play.ts`), because "a parked element is not solved and has no
 * position of its own; this is somewhere to point at" (that file's own comment). Rendered
 * verbatim, every pollen in a cell would sit inside every other one. So this file does the ONE
 * approximation the Day 1 brief calls out: it groups a hive's parked elements by their `slot`
 * and fans them out along local x (the cell's un-foreshortened width axis, `BB_HIVE_W`, which a
 * hive tilt does not move since the tilt rotates about world x) — a row, exactly like the 2D
 * renderer's `drawCellContents`, but done from the ball's own (shared) position rather than the
 * `BbHiveState.contents` array (this file never reads `world.biobuzz.hives`).
 *
 * Under `'3d'` every element in the cell already has its own SOLVED position from the tray's
 * Rapier body — there is nothing to fan. Adding the 2D row fan on top of an already-distinct
 * position was itself a bug: measured, it walked a drawn sphere up to ±3.00 in off the body it
 * was meant to mark (5 elements in a cell), drew two elements that physically sit at the same
 * local x 4.5 in apart, and at higher counts pushed the sphere past the floor plate's own edge
 * and through the side wall — read at a glance as "meshing with the hive". The actual small
 * (0.06–0.15 in) penetration into the tray floor is the CONTACT SOLVE's, not this file's — see
 * `sim3d/engineImpl.ts`/`predict.ts`'s `contact_natural_frequency`; this file poses at the body
 * exactly, and does not fudge the draw to hide a physics number.
 */

/** how many instances each kind's `InstancedMesh` is sized for — the Day 1 brief's number, well
 * above the manual's per-kind counts (40 pollen, 16 nectar total) so nothing is ever dropped. */
const CAP = 56;

const POLLEN_COLOR = 0xf2d14b; // matches `draw.ts`'s ELEMENT_FILL.yellow
/** the one BIOBUZZ blue (`draw.ts`'s `ELEMENT_FILL.blue`, owner bug 12 — see that header for why
 * it is NOT the CAD's `plastic#0000ff`); red still matches `draw.ts`'s own `#e2564d`. */
const NECTAR_COLORS: Record<'red' | 'blue', number> = { red: 0xe2564d, blue: 0x007be1 };

const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

function isNectar(color: ArtifactColor): color is 'red' | 'blue' {
  return color === 'red' || color === 'blue';
}

export interface BbElements {
  pollen: THREE.InstancedMesh;
  nectar: THREE.InstancedMesh;
  group: THREE.Group;
  /** per-ball-id accumulated rolling-spin orientation (Phase 2 fidelity) — persists across
   * frames so a rolling pollen keeps turning rather than resetting every tick; keyed by the
   * ball's stable `id`, not its per-frame instance index (`ground`/`flight` reassign indices
   * every frame as balls come and go). Pruned of ids no longer on the field once a frame's
   * bookkeeping is done, so a long match does not grow this map without bound. */
  spin: Map<number, THREE.Quaternion>;
  /**
   * BLOB SHADOWS — one flat disc per loose element, for `elementShadows: 'blob'`
   * (`docs/biobuzz/plan-3d.md` §4.4). It is a middle rung and not a consolation prize: the
   * thing a driver actually reads off an element's shadow is WHERE IT IS ON THE FLOOR (and,
   * for one in flight, how high), and a disc under it answers that for one instanced draw and
   * zero shadow-map work, where `'real'` costs 56 more casters in the sun's depth pass.
   */
  blobs: THREE.InstancedMesh;
  /** which of the three modes is live — read by `updateBiobuzzElements` so it only does the
   * blob bookkeeping when there are blobs. Set through `setElementShadows`, never directly. */
  shadowMode: ElementShadows;
  /** `effects: 'minimal'` turns the rolling spin off: it is a cosmetic integration per ball per
   * frame, and it is the first thing to go on a machine that is counting. */
  rollingSpin: boolean;
}

export function buildBiobuzzElements(): BbElements {
  const pollenGeo = new THREE.SphereGeometry(BB_POLLEN_R, 12, 8);
  const nectarGeo = new THREE.SphereGeometry(BB_NECTAR_R, 12, 8);
  // POLLEN/NECTAR MATERIAL (Phase 2 fidelity): a little roughness so the key light's specular
  // highlight reads as a physical bead rather than a flat-shaded disc; still bright at the
  // saturated hues `draw.ts`'s 2D `ELEMENT_FILL`/`POLLEN_FILL` use, so the two views agree.
  //
  // A SMALL EMISSIVE (2026-09-18 lighting pass): a scoring element is the one thing on the field
  // a driver must always be able to pick out at a glance, including when it is sitting in a
  // hive's own shadow or against the darker tile mat — `emissiveIntensity` this low (0.08–0.12)
  // does not read as "glowing", it reads as "never quite goes fully dark", which is the effect an
  // AO pass would otherwise fight (AO darkens exactly the crevices/contacts a resting element
  // sits in). Nectar's emissive stays a flat white at a lower intensity, since its actual hue is
  // set per-instance via `setColorAt` below and emissive is a per-MATERIAL (not per-instance)
  // property — a coloured emissive here would tint every nectar the same regardless of alliance.
  const pollenMat = new THREE.MeshStandardMaterial({
    color: POLLEN_COLOR,
    roughness: 0.55,
    metalness: 0.05,
    emissive: POLLEN_COLOR,
    emissiveIntensity: 0.12,
  });
  const nectarMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.4,
    metalness: 0.05,
    emissive: 0xffffff,
    emissiveIntensity: 0.05,
  }); // per-instance colour below

  const pollen = new THREE.InstancedMesh(pollenGeo, pollenMat, CAP);
  const nectar = new THREE.InstancedMesh(nectarGeo, nectarMat, CAP);
  pollen.name = 'bb-pollen';
  nectar.name = 'bb-nectar';
  pollen.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  nectar.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < CAP; i++) {
    pollen.setMatrixAt(i, HIDE);
    nectar.setMatrixAt(i, HIDE);
    nectar.setColorAt(i, new THREE.Color(NECTAR_COLORS.red));
  }
  // THE BLOB DISC. Unlit (`MeshBasicMaterial`) on purpose — a shadow that got brighter when the
  // sun moved would be the one object in the scene lit by the thing it is meant to be blocking.
  // `depthWrite: false` keeps it from z-fighting the tile plane it lies a sixteenth of an inch
  // above, and `renderOrder: -1` draws it before the elements so a ball never sorts behind its
  // own shadow.
  const blobGeo = new THREE.CircleGeometry(1, 16);
  const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false });
  const blobs = new THREE.InstancedMesh(blobGeo, blobMat, CAP * 2);
  blobs.name = 'bb-element-blobs';
  blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  blobs.renderOrder = -1;
  blobs.visible = false;
  for (let i = 0; i < CAP * 2; i++) blobs.setMatrixAt(i, HIDE);

  const group = new THREE.Group();
  group.add(pollen, nectar, blobs);
  return { pollen, nectar, blobs, group, spin: new Map(), shadowMode: 'real', rollingSpin: true };
}

/**
 * Switch the element-shadow mode LIVE (`docs/biobuzz/plan-3d.md` §4.4). Nothing is rebuilt: the
 * blob mesh always exists and is simply hidden, and `castShadow` is a per-object flag the
 * shadow pass reads every frame.
 */
export function setElementShadows(els: BbElements, mode: ElementShadows): void {
  els.shadowMode = mode;
  els.pollen.castShadow = mode === 'real';
  els.nectar.castShadow = mode === 'real';
  els.blobs.visible = mode === 'blob';
}

/** the tile-surface offset a blob sits at, and the height over which an airborne element's blob
 * fades and shrinks. A ball two feet up throws a shadow that is wider and fainter, not one that
 * has followed it into the air — which is the whole reason the blob is drawn at z ≈ 0 and not at
 * the element. */
const BLOB_Z = 0.06;
const BLOB_FADE_Z = 40;

/** how far a hive-cell row can fan out before it would clear the cell's own width — same idea as
 * `drawCellContents`'s pitch collapse, simplified: a fixed pitch, clamped to fit. */
const HIVE_ROW_PAD = 1.5;
const HIVE_CELL_ROW_SPAN = BB_HIVE_W - 2 * HIVE_ROW_PAD;

// scratch, reused every frame — no per-frame allocation in the hot per-ball loop
const scratchPos = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const scratchScale = new THREE.Vector3(1, 1, 1);
const scratchMatrix = new THREE.Matrix4();

function poseAt(mesh: THREE.InstancedMesh, index: number, x: number, y: number, z: number): void {
  scratchPos.set(x, y, z);
  scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
  mesh.setMatrixAt(index, scratchMatrix);
}

function poseAtQuat(mesh: THREE.InstancedMesh, index: number, x: number, y: number, z: number, quat: THREE.Quaternion): void {
  scratchPos.set(x, y, z);
  scratchMatrix.compose(scratchPos, quat, scratchScale);
  mesh.setMatrixAt(index, scratchMatrix);
}

const spinAxis = new THREE.Vector3();
const spinDelta = new THREE.Quaternion();

/**
 * A ROLLING SPIN (Phase 2 fidelity brief): `spin ≈ v / r` about the axis `up × v` — a ball
 * moving on the tiles turns as if its surface speed matched its travel, which is what actually
 * rolling (rather than sliding) looks like. Integrated over one `SIM_DT` per render call: this
 * runs once per RENDERED frame, not once per physics tick, so at a free-running frame rate the
 * spin is a hair off true rate — a cosmetic flourish, not a physical claim, so that slop is
 * fine. Orientation persists per ball id in `els.spin` (see that map's own comment) so a rolling
 * pollen keeps turning between frames instead of resetting.
 */
function rollSpin(spin: Map<number, THREE.Quaternion>, id: number, vx: number, vy: number, r: number): THREE.Quaternion {
  let q = spin.get(id);
  if (!q) {
    q = new THREE.Quaternion();
    spin.set(id, q);
  }
  const speed = Math.hypot(vx, vy);
  if (speed > 0.5 && r > 0.01) {
    // up × v, up = (0,0,1): (0,0,1) × (vx,vy,0) = (-vy, vx, 0)
    spinAxis.set(-vy, vx, 0).normalize();
    spinDelta.setFromAxisAngle(spinAxis, (speed / r) * SIM_DT);
    q.premultiply(spinDelta);
  }
  return q;
}

/** scratch for the blob's own (uniform) scale — the shared `scratchScale` is a constant 1,1,1
 * every other pose relies on, so a blob must not borrow it. */
const blobScale = new THREE.Vector3(1, 1, 1);

function poseBlob(mesh: THREE.InstancedMesh, index: number, x: number, y: number, z: number, r: number): void {
  // a rising element's shadow spreads and fades; `t` is 0 on the tiles and 1 at `BLOB_FADE_Z`
  const t = Math.min(1, Math.max(0, z / BLOB_FADE_Z));
  const s = r * (1.15 + t * 1.6);
  blobScale.set(s, s, 1);
  scratchPos.set(x, y, BLOB_Z);
  scratchMatrix.compose(scratchPos, scratchQuat, blobScale);
  mesh.setMatrixAt(index, scratchMatrix);
}

export function updateBiobuzzElements(els: BbElements, world: World): void {
  let pollenN = 0;
  let nectarN = 0;
  let blobN = 0;
  /**
   * ⚠️ A PARKED ELEMENT'S `z` MEANS DIFFERENT THINGS UNDER THE TWO PHYSICS, SO THE CONVENTION
   * BRANCHES ON THE SOLVE AND NEVER ON `state.kind`.
   *
   * 3D writes a BOTTOM: the readback is `b.z = t.z - r` (`sim3d/engineImpl.ts`) and a placed
   * flower element is seated `ball.z = PLACE_CENTRE_Z - r` (`sim3d/flower3d.ts`), so every ball
   * a 3D world solves — parked or loose — reports its underside and has to be lifted by `r`.
   * 2D writes a CENTRE for a parked element and only for a parked one: `play.ts`'s `park()`
   * puts a hive element at `CELL_MID_Z` ("where a parked element is drawn to sit") and a flower
   * element at `flowerStackZ`, which is documented as centre heights. Its loose balls still
   * report a bottom.
   *
   * Keying this off the KIND is what put one branch wrong under each solve — a hive element
   * floating 1.4 in high in 2D, a flower element sunk a radius in 3D. And a 2D-physics world in
   * the 3D VIEW is reachable, not theoretical: `GameView.tsx` falls back to `practicePhysics:
   * '2d'` when the 3D chunk fails to load WITHOUT changing the view, which is the same reason
   * `sim3d/tilt.ts` exists as a physics-free module.
   */
  // ONE CHECK, TWO JOBS, because one `World` has one physics: it decides whether `b.z` is an
  // underside (above), and it decides whether the hive row fan runs at all. The fan is a stand-in
  // for a position `park()` never gives a 2D hive element — under 3D every element already has
  // its own solved one, so the grouping pass below is dead work there, and building `hiveIndex`
  // unconditionally is exactly what let the fan apply itself to a 3D world too.
  const bottom = biobuzzPhysics(world) === '3d';
  const blobsOn = els.shadowMode === 'blob';
  const seenSpin = new Set<number>();

  // group hive-parked elements by `el` so a shared cell position can be fanned into a row —
  // small (a hive holds at most a handful of elements), so a per-frame Map here is not the
  // "no allocation" hot path the per-ball pose loop below is. 2D-only: see `bottom` above.
  const hiveGroups = new Map<string, Artifact[]>();
  if (!bottom) {
    for (const b of world.balls) {
      if (b.state.kind === 'element' && b.state.el.startsWith('hive:')) {
        const arr = hiveGroups.get(b.state.el);
        if (arr) arr.push(b);
        else hiveGroups.set(b.state.el, [b]);
      }
    }
    for (const arr of hiveGroups.values()) {
      arr.sort((a, c) => {
        const sa = a.state.kind === 'element' ? a.state.slot : 0;
        const sc = c.state.kind === 'element' ? c.state.slot : 0;
        return sa - sc;
      });
    }
  }
  const hiveIndex = new Map<number, { i: number; n: number }>();
  if (!bottom) {
    for (const arr of hiveGroups.values()) {
      arr.forEach((b, i) => hiveIndex.set(b.id, { i, n: arr.length }));
    }
  }

  for (const b of world.balls) {
    const nectar = isNectar(b.color);
    const mesh = nectar ? els.nectar : els.pollen;
    const r = b.r ?? (nectar ? BB_NECTAR_R : BB_POLLEN_R);
    let idx: number;
    if (nectar) {
      if (nectarN >= CAP) continue;
      idx = nectarN++;
    } else {
      if (pollenN >= CAP) continue;
      idx = pollenN++;
    }

    if (b.state.kind === 'held' || b.state.kind === 'stock') {
      mesh.setMatrixAt(idx, HIDE);
    } else if (b.state.kind === 'element' && b.state.el.startsWith('hive:')) {
      const row = hiveIndex.get(b.id);
      const span = row && row.n > 1 ? Math.min(HIVE_CELL_ROW_SPAN, (row.n - 1) * HIVE_ROW_PAD) : 0;
      const t = row && row.n > 1 ? row.i / (row.n - 1) - 0.5 : 0;
      // HIVE cell, fanned along local x. The height is `bottom`'s (see the top of this
      // function): under 3D `b.z` is the body's underside and is lifted by `r`, under 2D
      // `park()` has already written the cell's CENTRE height and lifting it again floats the
      // element a radius above the cell. Lifting unconditionally is how the 3D fix — a shot
      // that "teleports slightly downwards" the tick `derive.ts` retags it from `flight` to
      // `element` — leaked into the 2D pipeline it was never about.
      poseAt(mesh, idx, b.pos.x + t * span, b.pos.y, bottom ? b.z + r : b.z);
    } else if (b.state.kind === 'element') {
      // FLOWER stack (`el` is `flower:<index>`, not `hive:...`), same rule as the hive branch
      // above and for the same reason. Under 2D, `flowerStackZ` (`flower.ts`) has written a
      // CENTRE height ("Centre heights (in) of every element in the stack") and it is drawn
      // raw; under 3D the element is a real body seated at `PLACE_CENTRE_Z - r`
      // (`sim3d/flower3d.ts`) and reported as an underside, so it is lifted like any other.
      //
      // ⚠️ DRAWING THIS RAW UNCONDITIONALLY SANK EVERY 3D FLOWER ELEMENT BY ITS OWN RADIUS
      // (1.4–1.8 in) — into the stack it was supposed to be resting on. The opposite mistake
      // shipped first: it used to fall through to the `ground`/`flight` branch and get `+ r`
      // on top of a 2D centre height, which floated it by the same amount.
      poseAt(mesh, idx, b.pos.x, b.pos.y, bottom ? b.z + r : b.z);
    } else {
      // 'ground' | 'flight' — `z` is the height of the ball's BOTTOM above the tile (a resting
      // ball reads z === 0), so the centre is lifted by its own radius. Spins as it moves.
      seenSpin.add(b.id);
      if (els.rollingSpin) {
        const q = rollSpin(els.spin, b.id, b.vel.x, b.vel.y, r);
        poseAtQuat(mesh, idx, b.pos.x, b.pos.y, b.z + r, q);
      } else {
        poseAt(mesh, idx, b.pos.x, b.pos.y, b.z + r);
      }
      if (blobsOn) poseBlob(els.blobs, blobN++, b.pos.x, b.pos.y, b.z, r);
    }

    if (nectar) els.nectar.setColorAt(idx, new THREE.Color(NECTAR_COLORS[b.color as 'red' | 'blue']));
  }

  // whatever is left over from a previous, larger frame must be hidden, not left stale
  for (let i = pollenN; i < CAP; i++) els.pollen.setMatrixAt(i, HIDE);
  for (let i = nectarN; i < CAP; i++) els.nectar.setMatrixAt(i, HIDE);
  if (blobsOn) {
    for (let i = blobN; i < CAP * 2; i++) els.blobs.setMatrixAt(i, HIDE);
    els.blobs.instanceMatrix.needsUpdate = true;
  }

  // drop spin state for ids that are no longer ground/flight (parked, captured, or off-field)
  // so a long match does not grow this map without bound.
  for (const id of els.spin.keys()) if (!seenSpin.has(id)) els.spin.delete(id);

  els.pollen.instanceMatrix.needsUpdate = true;
  els.nectar.instanceMatrix.needsUpdate = true;
  if (els.nectar.instanceColor) els.nectar.instanceColor.needsUpdate = true;
  els.pollen.count = CAP;
  els.nectar.count = CAP;
}
