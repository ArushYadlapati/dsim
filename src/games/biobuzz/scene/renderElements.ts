import * as THREE from 'three';
import type { Artifact, ArtifactColor, World } from '../../../types';
import { BB_HIVE_W, BB_NECTAR_R, BB_POLLEN_R } from '../config';

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
 * carry a REAL, useful `pos`/`z` written by `play.ts`'s `park()` — a flower stack's z is
 * `flowerStackZ`'s own centre height, unique per element, so those are posed exactly like a
 * ground ball with no adjustment. A HIVE cell is the one case `park()` does NOT give a unique
 * position: every element parked in the same cell shares that cell's centre point and a single
 * fixed height (`CELL_MID_Z`, `play.ts`), because "a parked element is not solved and has no
 * position of its own; this is somewhere to point at" (that file's own comment). Rendered
 * verbatim, every pollen in a cell would sit inside every other one. So this file does the ONE
 * approximation the Day 1 brief calls out: it groups a hive's parked elements by their `slot`
 * and fans them out along local x (the cell's un-foreshortened width axis, `BB_HIVE_W`, which a
 * hive tilt does not move since the tilt rotates about world x) — a row, exactly like the 2D
 * renderer's `drawCellContents`, but done from the ball's own (shared) position rather than the
 * `BbHiveState.contents` array (this file never reads `world.biobuzz.hives`).
 */

/** how many instances each kind's `InstancedMesh` is sized for — the Day 1 brief's number, well
 * above the manual's per-kind counts (40 pollen, 16 nectar total) so nothing is ever dropped. */
const CAP = 56;

const POLLEN_COLOR = 0xf2d14b; // matches `draw.ts`'s ELEMENT_FILL.yellow
const NECTAR_COLORS: Record<'red' | 'blue', number> = { red: 0xe2564d, blue: 0x4d8fe2 };

const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

function isNectar(color: ArtifactColor): color is 'red' | 'blue' {
  return color === 'red' || color === 'blue';
}

export interface BbElements {
  pollen: THREE.InstancedMesh;
  nectar: THREE.InstancedMesh;
  group: THREE.Group;
}

export function buildBiobuzzElements(): BbElements {
  const pollenGeo = new THREE.SphereGeometry(BB_POLLEN_R, 12, 8);
  const nectarGeo = new THREE.SphereGeometry(BB_NECTAR_R, 12, 8);
  const pollenMat = new THREE.MeshStandardMaterial({ color: POLLEN_COLOR });
  const nectarMat = new THREE.MeshStandardMaterial({ color: 0xffffff }); // per-instance colour below

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
  const group = new THREE.Group();
  group.add(pollen, nectar);
  return { pollen, nectar, group };
}

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

export function updateBiobuzzElements(els: BbElements, world: World): void {
  let pollenN = 0;
  let nectarN = 0;

  // group hive-parked elements by `el` so a shared cell position can be fanned into a row —
  // small (a hive holds at most a handful of elements), so a per-frame Map here is not the
  // "no allocation" hot path the per-ball pose loop below is.
  const hiveGroups = new Map<string, Artifact[]>();
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
  const hiveIndex = new Map<number, { i: number; n: number }>();
  for (const arr of hiveGroups.values()) {
    arr.forEach((b, i) => hiveIndex.set(b.id, { i, n: arr.length }));
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
      poseAt(mesh, idx, b.pos.x + t * span, b.pos.y, b.z);
    } else {
      // 'ground' | 'flight' | 'element' (flower — already unique per `flowerStackZ`)
      poseAt(mesh, idx, b.pos.x, b.pos.y, b.z + r);
    }

    if (nectar) els.nectar.setColorAt(idx, new THREE.Color(NECTAR_COLORS[b.color as 'red' | 'blue']));
  }

  // whatever is left over from a previous, larger frame must be hidden, not left stale
  for (let i = pollenN; i < CAP; i++) els.pollen.setMatrixAt(i, HIDE);
  for (let i = nectarN; i < CAP; i++) els.nectar.setMatrixAt(i, HIDE);

  els.pollen.instanceMatrix.needsUpdate = true;
  els.nectar.instanceMatrix.needsUpdate = true;
  if (els.nectar.instanceColor) els.nectar.instanceColor.needsUpdate = true;
  els.pollen.count = CAP;
  els.nectar.count = CAP;
}
