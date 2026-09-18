import * as THREE from 'three';
import type { Alliance, World } from '../../../types';
import * as C from '../../../config';
import {
  BB_FLOWERS,
  BB_FLOWER_D,
  BB_FLOWER_FOOT,
  BB_FLOWER_OPEN_R,
  BB_FLOWER_TOP_Z,
  BB_FRAME_BAR_IN,
  BB_FRAME_BAR_OUT,
  BB_FRAME_Y,
  BB_GARDEN,
  BB_HALF_X,
  BB_HALF_Y,
  BB_HIVE_OPEN_Z,
  BB_HIVE_TILT_DEG,
  BB_HIVE_UP_STAGED,
  BB_HIVE_X,
  BB_LZ,
  BB_WALL_T,
  BB_TAPE_1,
  FLOWER_MOUTH,
  type BbRect,
} from '../config';
import { BB_FLOWER_FLOOR_Z, BB_FLOWER_MID_Z } from '../flower';
import { BB_TIP_SWING_S } from '../hive';
import type { BbCellSide, BbHiveState } from '../state';

/**
 * BIOBUZZ 3D SCENE — the field: floor, walls, the two hives (frame + tilting tray) and the four
 * flowers (Day 1, `docs/biobuzz/plan-3d.md` §4.2, §13.1).
 *
 * Coordinates: field inches, z UP. Every dimension not printed in the manual (walls, uprights,
 * flower pipes, ring tube thickness) is flagged `APPROX` at its declaration, same convention as
 * `src/games/biobuzz/config.ts`. Values the plan doc's own §13.1 table gives (`BB3_HIVE_PIVOT_Z`
 * etc.) are cited by name even though they are not (yet) exported constants anywhere — Lane A's
 * `sim3d/bodies.ts` is the only other place they would need to agree with this file, and neither
 * lane has landed a shared home for them yet (see the report's gotchas).
 */

// ── HIVE — 3D-only constants (plan-3d.md §13.1; not exported anywhere in the 2D config) ───────
/** pivot height above the tiles, in — `BB3_HIVE_PIVOT_Z`. */
const HIVE_PIVOT_Z = 43.95;
/** true (unprojected) distance from the pivot to a cell's centre along the arm, in —
 * `BB3_HIVE_ARM`. The 2D `BB_HIVE_CELL_DY` (13.37) is this value's PLAN projection
 * (`15.44 * cos 30°`); the tray's own local geometry below uses the true length because it is
 * built in the tray's un-rotated local frame and Three.js applies the tilt itself. */
const HIVE_ARM = 15.44;
/** true cell depth along the arm, in — `BB3_HIVE_CELL_LEN` (12.04, the manual/CAD length; NOT
 * the same-named 2D `BB_HIVE_CELL_LEN`, which is this value's plan projection, 10.43). */
const HIVE_CELL_DEPTH = 12.04;
/** cell width across the hive (x, unforeshortened) and height (z, local, before tilt) —
 * `BB3_HIVE_CELL`'s 20 × 14 × 12.04. The 14 is the plan doc's own figure for this box; nothing
 * in `config.ts` names it, so it is APPROX here exactly as it is there. */
const HIVE_CELL_W = 20;
const HIVE_CELL_H = 14; // APPROX — plan-3d.md §13.1
/** true bar length end to end, in — the 2D `BB_HIVE_LEN` (37.16) is this value's cos 30°
 * projection; 37.16 / cos(30°) ≈ 42.91, the figure the plan doc's prose gives directly. */
const HIVE_BAR_LEN = 42.91;
const HIVE_TILT_REST = (BB_HIVE_TILT_DEG * Math.PI) / 180; // ±30°, shared with the 2D renderer

/** `BB3_HIVE_CELL_WALL` (plan-3d.md §13.1): the cell shell thickness, in. APPROX, CAD settles. */
const HIVE_CELL_WALL = 0.25;

/** local y (before tilt), measured from the pivot along the arm, of the cell's OUTER (open)
 * face — the plane the manual's opening heights (`BB_HIVE_OPEN_Z`) are measured at. */
const HIVE_CELL_OUTER_Y = HIVE_ARM + HIVE_CELL_DEPTH / 2;

/**
 * THE CELL BOX'S OWN LOCAL Z-CENTRE (before tilt), SOLVED rather than guessed, so the built
 * geometry reproduces `BB_HIVE_OPEN_Z` (53.5 / 65.6, Fig 9-10) at the true 30° stable state
 * instead of merely resembling it.
 *
 * A point at local `(x, HIVE_ARM ± HIVE_CELL_DEPTH/2, z)` on a tray tilted `HIVE_TILT_REST`
 * about the pivot lands at world height `HIVE_PIVOT_Z + y·sin(tilt) + z·cos(tilt)`. The
 * manual's BOTTOM-of-opening figure is exactly that, evaluated at the OUTER face
 * (`HIVE_CELL_OUTER_Y`) and at the box's own bottom (`z = HIVE_CELL_Z0 − HIVE_CELL_H/2`).
 * Solving for `HIVE_CELL_Z0` there (rather than centring the box at an arbitrary local z, which
 * the first pass did and which landed the opening about 3 in high) is what makes the TOP come
 * out within a few hundredths of an inch of 65.6 on its own — one equation fixes both ends
 * because `HIVE_CELL_H` (14) already matches `BB_HIVE_OPEN_Z`'s own span (12.1) to within
 * rounding.
 *
 * ⚠️ THE DOWN CELL'S OWN FLOOR DOES NOT COME OUT AT `BB_HIVE_BOTTOM_Z` (25.5) under this same
 * rigid-bar model — it lands around 32 in. The two manual figures cannot both be hit by one
 * cell box rotating rigidly about one pivot at `HIVE_ARM`: solving the up-cell's opening (this
 * constant) trades away the down-cell's floor height, and centring the box in between trades
 * away the up-cell's opening instead. This is reported as a real, unresolved discrepancy for
 * the SIM lane (`docs/biobuzz/plan-3d.md` §3.6's dynamic tray, or a future two-part CAD tray),
 * not something a fallback constants box can also get right — see the report's item (f)/(g).
 */
const HIVE_CELL_Z0 =
  (BB_HIVE_OPEN_Z[0] - HIVE_PIVOT_Z - HIVE_CELL_OUTER_Y * Math.sin(HIVE_TILT_REST)) / Math.cos(HIVE_TILT_REST) +
  HIVE_CELL_H / 2;

/** wall visual thickness and height, in — APPROX (`BB_WALL_T` is the oversized PHYSICS collider
 * half-thickness, deliberately far thicker than any real wall; this is what a driver should
 * actually see). "12 in high APPROX" per the Day 1 brief. */
const WALL_VIS_T = 2;
const WALL_VIS_H = 12; // APPROX

/** flower APPROX dimensions not named in `config.ts` (see `flower.ts`'s own APPROX comments for
 * the two heights reused here: `BB_FLOWER_FLOOR_Z`, `BB_FLOWER_MID_Z`). */
const FLOWER_LOWER_RING_R = 2.79 / 2; // APPROX — flower.ts's own comment: "2.79-in hole"
const FLOWER_MID_RING_R = 3.2 / 2; // APPROX — `BB3_FLOWER_MID_HOLE` (plan-3d.md §13.1)
const FLOWER_TUBE_R = 0.3; // APPROX — ring material thickness, undocumented
const FLOWER_PIPE_R = 0.35; // APPROX — support pipe radius, undocumented
const FLOWER_FOOT_H = 2; // APPROX — foot slab height, undocumented

const ALLIANCES: readonly Alliance[] = ['red', 'blue'];

// ── materials (flat colours, MeshStandardMaterial only — no textures beyond the floor) ────────
function mat(color: string, opacity = 1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    side: opacity < 1 ? THREE.DoubleSide : THREE.FrontSide,
  });
}

// ── the floor texture: 6×6 tiles of 24 in, tape/garden/loading-zone marks, drawField.ts's own
// colour tokens. Generated ONCE at scene creation, never per frame. ───────────────────────────
const TEX_SIZE = 1024;
const TEX_SCALE = TEX_SIZE / (2 * BB_HALF_X);

/** world (x,y) → floor-texture canvas pixel. The canvas's row 0 is world +y (the far wall from
 * a driver standing at -y) because a `CanvasTexture`'s default `flipY` already corrects a
 * not-rotated `PlaneGeometry`'s V axis to run the same way — the same reason a ground texture
 * drawn "right side up" in 2D canvas code needs no extra flip here. */
function toTex(x: number, y: number): [number, number] {
  return [(x + BB_HALF_X) * TEX_SCALE, (BB_HALF_Y - y) * TEX_SCALE];
}

/** the tape colours `drawField.ts`'s `TAPE_GAFFER` uses — NOT a theme token there either (the
 * tape colour is the marking, per that file's own header), so copying the literals is exactly
 * as stable as importing them would be. */
const TAPE_GAFFER: Record<Alliance, string> = { red: '#e02020', blue: '#0a5cff' };

function strokeRectTex(ctx: CanvasRenderingContext2D, r: BbRect, color: string, widthIn: number): void {
  const [x0, y0] = toTex(r.x0, r.y1);
  const [x1, y1] = toTex(r.x1, r.y0);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, widthIn * TEX_SCALE);
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
}

function buildFloorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  ctx.fillStyle = C.COLORS.mat;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // tile grid — one line per 24-in seam, matching drawBiobuzzField's own grid exactly
  ctx.strokeStyle = C.COLORS.tile;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = -BB_HALF_X; x <= BB_HALF_X + 0.01; x += C.TILE) {
    const [px] = toTex(x, 0);
    ctx.moveTo(px, 0);
    ctx.lineTo(px, TEX_SIZE);
  }
  for (let y = -BB_HALF_Y; y <= BB_HALF_Y + 0.01; y += C.TILE) {
    const [, py] = toTex(0, y);
    ctx.moveTo(0, py);
    ctx.lineTo(TEX_SIZE, py);
  }
  ctx.stroke();

  // centre mark, same purpose as the 2D renderer's: a still that is off-centre should be
  // visible as such rather than indistinguishable from five other tile crossings
  const [cx, cy] = toTex(0, 0);
  const mark = 4 * TEX_SCALE;
  ctx.strokeStyle = C.COLORS.white;
  ctx.lineWidth = Math.max(1, C.TAPE_W * TEX_SCALE);
  ctx.beginPath();
  ctx.moveTo(cx - mark, cy);
  ctx.lineTo(cx + mark, cy);
  ctx.moveTo(cx, cy - mark);
  ctx.lineTo(cx, cy + mark);
  ctx.stroke();

  // loading zones + gardens: TAPE outlines, never a filled bar (owner ruling — see
  // drawBiobuzzField's header on both)
  for (const a of ALLIANCES) {
    strokeRectTex(ctx, BB_LZ[a], TAPE_GAFFER[a], BB_TAPE_1);
    strokeRectTex(ctx, BB_GARDEN[a], TAPE_GAFFER[a], BB_TAPE_1);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildFloor(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(2 * BB_HALF_X, 2 * BB_HALF_Y);
  const material = new THREE.MeshStandardMaterial({ map: buildFloorTexture() });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'floor';
  return mesh;
}

function buildWalls(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'walls';
  const material = mat(C.COLORS.wall, 0.35);
  const span = 2 * BB_HALF_X + 2 * WALL_VIS_T;
  const specs: { x: number; y: number; w: number; d: number }[] = [
    { x: 0, y: BB_HALF_Y + WALL_VIS_T / 2, w: span, d: WALL_VIS_T },
    { x: 0, y: -BB_HALF_Y - WALL_VIS_T / 2, w: span, d: WALL_VIS_T },
    { x: BB_HALF_X + WALL_VIS_T / 2, y: 0, w: WALL_VIS_T, d: span },
    { x: -BB_HALF_X - WALL_VIS_T / 2, y: 0, w: WALL_VIS_T, d: span },
  ];
  const names = ['wall:rear', 'wall:audience', 'wall:right', 'wall:left'] as const;
  specs.forEach((s, i) => {
    const geo = new THREE.BoxGeometry(s.w, s.d, WALL_VIS_H);
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = names[i];
    mesh.position.set(s.x, s.y, WALL_VIS_H / 2);
    group.add(mesh);
  });
  void BB_WALL_T; // physics-only constant; visual thickness is its own, smaller, number
  return group;
}

/** a box spanning two points, `radius` thick on both cross-axes — the frame's uprights and
 * crossbar, which are slanted segments rather than axis-aligned boxes. */
function segmentMesh(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(radius, radius, Math.max(len, 1e-3), 8);
  const meshMesh = new THREE.Mesh(geo, material);
  meshMesh.position.copy(a).addScaledVector(dir, 0.5);
  meshMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return meshMesh;
}

/** the HIVE frame: one triangular base bar (§9.6.1, Fig 9-8) plus uprights converging on the
 * pivot. The base bar's x-range is the manual measurement (`BB_FRAME_BAR_IN/OUT`); the uprights
 * and their count are this renderer's own reading of "triangular structure" — APPROX, same as
 * the 2D renderer's dashed crossbar is its own reading of "joins at the apex". */
function buildHiveFrame(alliance: Alliance): THREE.Group {
  const group = new THREE.Group();
  group.name = `hive:${alliance}:frame`;
  const barMat = mat(C.COLORS.wall);
  const sign = alliance === 'red' ? -1 : 1;
  const barX = sign < 0 ? -(BB_FRAME_BAR_IN + BB_FRAME_BAR_OUT) / 2 : (BB_FRAME_BAR_IN + BB_FRAME_BAR_OUT) / 2;
  const barW = BB_FRAME_BAR_OUT - BB_FRAME_BAR_IN;

  const baseBar = new THREE.Mesh(new THREE.BoxGeometry(barW, 2 * BB_FRAME_Y, 1), barMat);
  baseBar.name = `hive:${alliance}:frame:base`;
  baseBar.position.set(barX, 0, 0.5);
  group.add(baseBar);

  const pivot = new THREE.Vector3(sign * BB_HIVE_X, 0, HIVE_PIVOT_Z);
  for (const s of [1, -1] as const) {
    const base = new THREE.Vector3(barX, s * BB_FRAME_Y, 1);
    const upright = segmentMesh(base, pivot, 0.5, barMat);
    upright.name = `hive:${alliance}:frame:upright${s > 0 ? 'N' : 'S'}`;
    group.add(upright);
  }
  return group;
}

/** the crossbar joining the two hives' pivots — solid here (no dash pattern in 3D geometry; the
 * 2D renderer's dash exists to say "this is overhead, not on the tile", which the actual height
 * already says on its own in a 3D view). */
function buildCrossbar(): THREE.Mesh {
  const a = new THREE.Vector3(-BB_HIVE_X, 0, HIVE_PIVOT_Z);
  const b = new THREE.Vector3(BB_HIVE_X, 0, HIVE_PIVOT_Z);
  const bar = segmentMesh(a, b, 0.5, mat(C.COLORS.wall));
  bar.name = 'hive:crossbar';
  return bar;
}

/** one CELL, in the TRAY's own local (un-rotated) frame: floor, back wall, two side walls, and a
 * ceiling — OPEN at the outer face (away from the pivot), five `HIVE_CELL_WALL`-thick boxes
 * (`BB3_HIVE_CELL_WALL`, plan-3d.md §13.1) exactly as `scripts/spike3d-browser/main.ts`'s Day-0
 * physics spike built them (the geometry the plan doc's "fallback five boxes per cell"
 * describes). `s` is +1 for the north cell, −1 south.
 *
 * Z placement is `HIVE_CELL_Z0 ± HIVE_CELL_H/2`, SOLVED (see that constant's own comment) so the
 * built box reproduces `BB_HIVE_OPEN_Z` at the true 30° tilt rather than a value that merely
 * looks plausible — the first pass centred the box at local z 9 (an arbitrary choice) and the
 * up-CELL opening came out roughly 3 in high of the manual figure. */
function buildCell(s: 1 | -1, accent: string, alliance: Alliance): THREE.Group {
  const group = new THREE.Group();
  group.name = `hive:${alliance}:cell:${s > 0 ? 'north' : 'south'}`;
  const structure = mat('#5c6676');
  const accentMat = mat(accent, 0.85);
  const cellY = s * HIVE_ARM;
  const w = HIVE_CELL_WALL;
  const zBot = HIVE_CELL_Z0 - HIVE_CELL_H / 2;
  const zTop = HIVE_CELL_Z0 + HIVE_CELL_H / 2;
  const innerY = cellY - s * (HIVE_CELL_DEPTH / 2 + w / 2); // back wall, just inside the true inner face
  const half = HIVE_CELL_W / 2;

  const floor = new THREE.Mesh(new THREE.BoxGeometry(HIVE_CELL_W, HIVE_CELL_DEPTH, w), accentMat);
  floor.name = `${group.name}:floor`;
  floor.position.set(0, cellY, zBot + w / 2);
  group.add(floor);

  const back = new THREE.Mesh(new THREE.BoxGeometry(HIVE_CELL_W, w, HIVE_CELL_H), structure);
  back.name = `${group.name}:back`;
  back.position.set(0, innerY, HIVE_CELL_Z0);
  group.add(back);

  for (const sx of [1, -1] as const) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(w, HIVE_CELL_DEPTH, HIVE_CELL_H), structure);
    side.name = `${group.name}:side${sx > 0 ? 'X+' : 'X-'}`;
    side.position.set(sx * (half + w / 2), cellY, HIVE_CELL_Z0);
    group.add(side);
  }

  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(HIVE_CELL_W, HIVE_CELL_DEPTH, w), structure);
  ceiling.name = `${group.name}:ceiling`;
  ceiling.position.set(0, cellY, zTop - w / 2);
  group.add(ceiling);

  return group;
}

/** the whole TRAY — the dynamic see-saw's visual half. A single `THREE.Group` so ONE rotation
 * (`updateBiobuzzField`, about local x) tilts both cells together, matching the real hive: they
 * ride one rigid bar (plan-3d.md §3.6). */
function buildTray(alliance: Alliance): THREE.Group {
  const tray = new THREE.Group();
  tray.name = `hive:${alliance}:tray`;
  const accent = alliance === 'blue' ? C.COLORS.blue : C.COLORS.red;
  tray.add(buildCell(1, accent, alliance));
  tray.add(buildCell(-1, accent, alliance));
  // CylinderGeometry's axis is local Y by default — exactly the arm direction the two cells
  // sit along (`cellY = s * HIVE_ARM` in `buildCell`), so no rotation is needed here at all.
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, HIVE_BAR_LEN, 8), mat(accent));
  bar.name = `hive:${alliance}:tray:bar`;
  tray.add(bar);
  return tray;
}

function buildFlowerFoot(f: (typeof BB_FLOWERS)[number], name: string): THREE.Mesh {
  const n = FLOWER_MOUTH[f.wall];
  const onY = f.wall === 'left' || f.wall === 'right';
  const wx = f.x - n.x * BB_FLOWER_D;
  const wy = f.y - n.y * BB_FLOWER_D;
  const cx = wx + (n.x * BB_FLOWER_FOOT.deep) / 2;
  const cy = wy + (n.y * BB_FLOWER_FOOT.deep) / 2;
  const w = onY ? BB_FLOWER_FOOT.deep : BB_FLOWER_FOOT.along;
  const d = onY ? BB_FLOWER_FOOT.along : BB_FLOWER_FOOT.deep;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, d, FLOWER_FOOT_H), mat(C.COLORS.wall));
  mesh.name = name;
  mesh.position.set(cx, cy, FLOWER_FOOT_H / 2);
  return mesh;
}

/** one FLOWER: a foot, four support pipes, the lower/middle/top rings — a fallback compound
 * shape (plan-3d.md §3.7, §13.1); the CAD-derived GLB replaces this when it lands (§8). */
function buildFlower(f: (typeof BB_FLOWERS)[number], idx: number): THREE.Group {
  const group = new THREE.Group();
  const base = `flower:${idx}`;
  group.name = base;
  group.add(buildFlowerFoot(f, `${base}:foot`));

  const ringMat = mat(C.COLORS.white, 0.9);
  const topRing = new THREE.Mesh(new THREE.TorusGeometry(BB_FLOWER_OPEN_R, FLOWER_TUBE_R, 8, 24), ringMat);
  topRing.name = `${base}:ring`;
  topRing.position.set(f.x, f.y, BB_FLOWER_TOP_Z);
  group.add(topRing);

  const midRing = new THREE.Mesh(new THREE.TorusGeometry(FLOWER_MID_RING_R, FLOWER_TUBE_R * 0.8, 8, 24), ringMat);
  midRing.name = `${base}:midring`;
  midRing.position.set(f.x, f.y, BB_FLOWER_MID_Z);
  group.add(midRing);

  const lowerRing = new THREE.Mesh(new THREE.CylinderGeometry(FLOWER_LOWER_RING_R + 0.3, FLOWER_LOWER_RING_R + 0.3, 0.5, 16), mat(C.COLORS.wall));
  lowerRing.name = `${base}:lowerring`;
  // default CylinderGeometry axis is local Y; rotate its axis onto Z so the ring lies FLAT
  // (a thin disc on the tiles), not standing on edge.
  lowerRing.rotation.x = Math.PI / 2;
  lowerRing.position.set(f.x, f.y, BB_FLOWER_FLOOR_Z);
  group.add(lowerRing);

  // the four HIPS support pipes, standing VERTICALLY from the tiles to the top ring.
  //
  // ⚠️ BUG FOUND AND FIXED HERE: a `CylinderGeometry`'s axis is local Y by default, and the
  // first pass never rotated it, so all four pipes were lying on their SIDES (each one's axis
  // pointing along world Y, the same "sideways pole" for every flower regardless of which wall
  // it stood against) instead of standing up from the foot to the ring. `rotation.x = PI/2`
  // is the same axis-onto-Z trick `lowerRing` above already uses.
  const pipeR = BB_FLOWER_OPEN_R + 0.3;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const px = f.x + Math.cos(a) * pipeR;
    const py = f.y + Math.sin(a) * pipeR;
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(FLOWER_PIPE_R, FLOWER_PIPE_R, BB_FLOWER_TOP_Z, 6), mat(C.COLORS.wall));
    pipe.name = `${base}:pipe${i}`;
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(px, py, BB_FLOWER_TOP_Z / 2);
    group.add(pipe);
  }
  return group;
}

/**
 * A PROCEDURAL ROOM around the field — a wide dark floor beyond the perimeter and a backdrop
 * cylinder, so the driver camera (`BB3_DRIVER_SETBACK` = 12 in outside the wall) does not look
 * into the WebGL clear colour when it pans off the field. APPROX, no CAD reference: this is
 * stagecraft, not a measured space, and is deliberately cheap (two meshes, one shared material).
 */
const ROOM_R = BB_HALF_X * 6;

function buildRoom(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'bb-room';
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 1 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(ROOM_R, 32), floorMat);
  floor.name = 'bb-room:floor';
  floor.position.z = -0.5; // just under the field floor so it never z-fights
  floor.receiveShadow = true;
  group.add(floor);

  const backdropMat = new THREE.MeshStandardMaterial({ color: 0x20262c, side: THREE.BackSide, roughness: 1 });
  const backdrop = new THREE.Mesh(new THREE.CylinderGeometry(ROOM_R, ROOM_R, 260, 24, 1, true), backdropMat);
  backdrop.name = 'bb-room:backdrop';
  backdrop.position.z = 130;
  group.add(backdrop);

  return group;
}

/**
 * ONE HIVE — the pivot group named `hive:<alliance>` (per the field-import seam, plan-3d.md §8:
 * the CAD `field.glb` will hand back a node under this same name), holding the static frame and
 * the tilting `tray` child. Position is the pivot itself (`±BB_HIVE_X, 0, HIVE_PIVOT_Z`), so
 * every child is authored in the pivot's own local frame — the tray's rotation is exactly the
 * see-saw's revolute joint.
 */
function buildHive(alliance: Alliance): { group: THREE.Group; tray: THREE.Group } {
  const group = new THREE.Group();
  group.name = `hive:${alliance}`;
  group.position.set(alliance === 'red' ? -BB_HIVE_X : BB_HIVE_X, 0, HIVE_PIVOT_Z);
  group.add(buildHiveFrame(alliance));
  const tray = buildTray(alliance);
  group.add(tray);
  return { group, tray };
}

export interface BbFieldHandles {
  /** everything, for a single `scene.add()`. */
  group: THREE.Group;
  /** named `floor` / `walls` — the flat, non-animated field furniture. */
  floor: THREE.Object3D;
  walls: THREE.Object3D;
  /** named `hive:red` / `hive:blue`, each with a `tray` child (`updateBiobuzzField` rotates it). */
  hives: Record<Alliance, THREE.Group>;
  /** named `flower:0`..`flower:3`, in `BB_FLOWERS` order. */
  flowers: THREE.Group[];
  /** the two tray groups, keyed by alliance — kept as its own map (rather than making callers
   * dig `hives[a].getObjectByName('tray')` out every frame) because `updateBiobuzzField` sets a
   * rotation on it every tick and that is a hot, tiny lookup worth keeping direct. */
  trays: Record<Alliance, THREE.Group>;
}

/**
 * Builds the WHOLE field as one group of NAMED sub-groups — `floor`, `walls`, `hive:<alliance>`
 * (each with a `tray` child), `flower:<index>` — so a CAD-derived `field.glb` (plan-3d.md §8,
 * "the derived files ship") can later hand back the identical shape (`BbFieldHandles`) by
 * resolving the same names out of the loaded scene graph instead of this constants-built one.
 * Nothing downstream (`renderScene.ts`, `updateBiobuzzField`) reaches into this function's
 * internals; it only ever touches the returned handles.
 */
export function buildBiobuzzField(): BbFieldHandles {
  const group = new THREE.Group();
  group.name = 'bb-field';

  const room = buildRoom();
  const floor = buildFloor();
  const walls = buildWalls();
  group.add(room, floor, walls, buildCrossbar());

  const hives = {} as Record<Alliance, THREE.Group>;
  const trays = {} as Record<Alliance, THREE.Group>;
  for (const a of ALLIANCES) {
    const { group: hiveGroup, tray } = buildHive(a);
    group.add(hiveGroup);
    hives[a] = hiveGroup;
    trays[a] = tray;
  }

  const flowers = BB_FLOWERS.map((f, idx) => {
    const g = buildFlower(f, idx);
    group.add(g);
    return g;
  });

  return { group, floor, walls, hives, flowers, trays };
}

/** the tray's tilt angle, RIGHT-HAND rule about the shared local x axis: positive raises the
 * NORTH cell (local/world +y), negative raises south. Same `tipping`/`up` reading as
 * `drawField.ts`'s `tipProjection`, reproduced here rather than imported because that function
 * returns a foreshortening FACTOR for a plan-view drawing, not the angle a 3D tilt needs — see
 * that function's own header for the swing's shape (reaches out, brightness swaps hardest at
 * level). At rest (`tipping` 0) this is exactly ±`HIVE_TILT_REST`. */
function hiveTiltAngle(up: BbCellSide, tipping: number): number {
  let rel = HIVE_TILT_REST; // steady state: the `up` cell is fully high
  if (tipping > 0) {
    const p = Math.min(1, Math.max(0, 1 - tipping / BB_TIP_SWING_S));
    rel = HIVE_TILT_REST * (1 - 2 * p); // +REST (still up) → 0 (level) → −REST (now down)
  }
  return up === 'north' ? rel : -rel;
}

/** per-frame update: only the two trays' rotations change (everything else in the field group
 * is static geometry built once at scene creation). */
export function updateBiobuzzField(handles: BbFieldHandles, world: World): void {
  const bb = world.biobuzz;
  for (const a of ALLIANCES) {
    const h: BbHiveState | undefined = bb?.hives?.[a];
    const up = h?.up ?? BB_HIVE_UP_STAGED[a];
    const angle = hiveTiltAngle(up, h?.tipping ?? 0);
    handles.trays[a].rotation.set(angle, 0, 0);
  }
}
