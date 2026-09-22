import type { RobotSpec, Vec2 } from '../../../types';
import { clamp, datan2, dcos, dsin, hyp, rot, wrapAngle } from '../../../math';
import { BB_HALF_X, BB_HALF_Y } from '../config';
import { BB_WALL_COUNT, biobuzzColliders } from '../colliders';
import { bbFootprint } from '../robot';
import { BB_AI_POSE_SLACK } from './tuning';

/**
 * BIOBUZZ AI — GEOMETRY THE POLICY PLANS WITH (2026-09-22 rewrite).
 *
 * Everything here is a PURE function of a spec and a few positions. It exists because the first
 * policy steered at goals it never asked the field about, and the two most expensive habits the
 * bench measured were both that: a bot pressing its intake into a corner for twelve seconds
 * because the pose that put its mouth on a corner POLLEN was a pose with the chassis inside two
 * walls, and a bot routing straight through a HIVE foot bar. So a goal is now CHECKED
 * (`poseClear`) and a route is PLANNED (`nextWaypoint`) against the same static list the 2D
 * solve uses (`biobuzzColliders`, walls excluded — the perimeter is a bounds test).
 *
 * NO ENGINE MATH: `dsin`/`dcos`/`datan2`/`hyp` only, like the rest of `ai/`.
 */

/** an axis-aligned static, in plan: the frame's two foot bars and the four FLOWER feet. Every
 * `StaticSpec` BIOBUZZ builds has `rot: 0`, which is what lets this be an AABB list. */
export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export const OBSTACLES: readonly Box[] = biobuzzColliders.statics.slice(BB_WALL_COUNT).map((s) => ({
  x0: s.tx - s.hx,
  x1: s.tx + s.hx,
  y0: s.ty - s.hy,
  y1: s.ty + s.hy,
}));

/** the robot's collision footprint in its own frame — the sweeper reach included on the edges
 * that carry one, which is exactly the box the solver collides (`bbFootprint`). */
export interface Footprint {
  front: number;
  rear: number;
  half: number;
  /** the circumscribed radius — what a robot turning on the spot sweeps */
  circ: number;
  /** the smaller of its two half-extents plus a hair — the half-width it presents to a
   * corridor it drives along lengthways */
  narrow: number;
}

export function footprintOf(spec: RobotSpec): Footprint {
  const f = bbFootprint(spec);
  return {
    front: f.front,
    rear: f.rear,
    half: f.half,
    circ: hyp(Math.max(f.front, f.rear), f.half),
    narrow: Math.min(f.half, (f.front + f.rear) / 2),
  };
}

/** the four corners of a footprint at a pose, world frame */
function corners(fp: Footprint, x: number, y: number, h: number): Vec2[] {
  const c = dcos(h);
  const s = dsin(h);
  const pts: [number, number][] = [
    [fp.front, fp.half],
    [fp.front, -fp.half],
    [-fp.rear, -fp.half],
    [-fp.rear, fp.half],
  ];
  return pts.map(([lx, ly]) => ({ x: x + lx * c - ly * s, y: y + lx * s + ly * c }));
}

/** does an oriented footprint overlap an axis-aligned box (grown by `pad`)? Separating axes:
 * the box's two and the footprint's two. */
function overlapsBox(cs: readonly Vec2[], h: number, b: Box, pad: number): boolean {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of cs) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (maxX < b.x0 - pad || minX > b.x1 + pad || maxY < b.y0 - pad || minY > b.y1 + pad) return false;
  // the footprint's own axes
  const axes: Vec2[] = [
    { x: dcos(h), y: dsin(h) },
    { x: -dsin(h), y: dcos(h) },
  ];
  const bc: Vec2[] = [
    { x: b.x0 - pad, y: b.y0 - pad },
    { x: b.x1 + pad, y: b.y0 - pad },
    { x: b.x1 + pad, y: b.y1 + pad },
    { x: b.x0 - pad, y: b.y1 + pad },
  ];
  for (const a of axes) {
    let fa = Infinity;
    let fb = -Infinity;
    for (const p of cs) {
      const d = p.x * a.x + p.y * a.y;
      if (d < fa) fa = d;
      if (d > fb) fb = d;
    }
    let ba = Infinity;
    let bb = -Infinity;
    for (const p of bc) {
      const d = p.x * a.x + p.y * a.y;
      if (d < ba) ba = d;
      if (d > bb) bb = d;
    }
    if (fb < ba || bb < fa) return false;
  }
  return true;
}

/**
 * IS THIS A POSE THE ROBOT CAN ACTUALLY BE IN — every corner of its footprint inside the
 * perimeter by `slack`, and the footprint clear of every static by `slack`.
 */
export function poseClear(fp: Footprint, x: number, y: number, h: number, slack: number = BB_AI_POSE_SLACK): boolean {
  const cs = corners(fp, x, y, h);
  for (const p of cs) {
    if (Math.abs(p.x) > BB_HALF_X - slack || Math.abs(p.y) > BB_HALF_Y - slack) return false;
  }
  for (const b of OBSTACLES) if (overlapsBox(cs, h, b, slack)) return false;
  return true;
}

/** clamp a centre point so a robot of circumscribed radius `r` fits inside the perimeter */
export function insideFor(p: Vec2, r: number): Vec2 {
  return { x: clamp(p.x, -BB_HALF_X + r, BB_HALF_X - r), y: clamp(p.y, -BB_HALF_Y + r, BB_HALF_Y - r) };
}

/** does the segment a→b pass through box `b` grown by `m`? (slab test) */
function segmentHits(a: Vec2, b: Vec2, box: Box, m: number): boolean {
  const x0 = box.x0 - m;
  const x1 = box.x1 + m;
  const y0 = box.y0 - m;
  const y1 = box.y1 + m;
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-dx, a.x - x0)) return false;
  if (!clip(dx, x1 - a.x)) return false;
  if (!clip(-dy, a.y - y0)) return false;
  if (!clip(dy, y1 - a.y)) return false;
  return t1 > t0;
}

function inBox(p: Vec2, box: Box, m: number): boolean {
  return p.x > box.x0 - m && p.x < box.x1 + m && p.y > box.y0 - m && p.y < box.y1 + m;
}

/** is the straight line from `a` to `b` clear for a robot presenting half-width `m`? An obstacle
 * that already CONTAINS either end is ignored — that is a robot starting against a foot, or a
 * goal (a FLOWER stand, a wall element) that is next to one on purpose. */
export function lineClear(a: Vec2, b: Vec2, m: number): boolean {
  for (const box of OBSTACLES) {
    if (inBox(a, box, m) || inBox(b, box, m)) continue;
    if (segmentHits(a, b, box, m)) return false;
  }
  return true;
}

/**
 * THE NEXT POINT TO STEER AT on the way from `from` to `to` — a shortest path over the corners
 * of the grown obstacles (a visibility graph with at most 26 nodes), so a robot goes ROUND a foot
 * bar instead of into it. Returns `to` itself when the line is clear, which is almost always.
 *
 * The HIVE is not an obstacle here: every build a bot drives is short enough to pass under it
 * (`bbDeployedHeightIn` ≤ 18 on the whole roster, the lowest structure is 30.65 in), so the space
 * between the two foot bars is a corridor — and after every TIP it is the shortest way to the cell
 * that just came up.
 */
export function nextWaypoint(from: Vec2, to: Vec2, m: number): Vec2 {
  if (lineClear(from, to, m)) return to;
  const g = m + 0.75;
  const nodes: Vec2[] = [];
  for (const b of OBSTACLES) {
    for (const p of [
      { x: b.x0 - g, y: b.y0 - g },
      { x: b.x1 + g, y: b.y0 - g },
      { x: b.x1 + g, y: b.y1 + g },
      { x: b.x0 - g, y: b.y1 + g },
    ]) {
      if (Math.abs(p.x) > BB_HALF_X - m || Math.abs(p.y) > BB_HALF_Y - m) continue;
      nodes.push(p);
    }
  }
  // Dijkstra over [from, ...nodes, to]
  const all = [from, ...nodes, to];
  const n = all.length;
  const dist = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  dist[0] = 0;
  for (let it = 0; it < n; it++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity) break;
    done[u] = true;
    if (u === n - 1) break;
    for (let v = 1; v < n; v++) {
      if (done[v]) continue;
      const d = dist[u] + hyp(all[v].x - all[u].x, all[v].y - all[u].y);
      if (d >= dist[v]) continue;
      if (!lineClear(all[u], all[v], m)) continue;
      dist[v] = d;
      prev[v] = u;
    }
  }
  if (dist[n - 1] === Infinity) return to; // no route found: steer straight and let the escape handle it
  let v = n - 1;
  while (prev[v] !== 0 && prev[v] !== -1) v = prev[v];
  return all[v];
}

/** the length of the planned route (straight line when clear), for travel-time estimates */
export function routeLength(from: Vec2, to: Vec2, m: number): number {
  const w = nextWaypoint(from, to, m);
  if (w === to) return hyp(to.x - from.x, to.y - from.y);
  return hyp(w.x - from.x, w.y - from.y) + hyp(to.x - w.x, to.y - w.y);
}

/**
 * THE NEAREST STAND INSIDE A FIRING ENVELOPE — the annular sector `d ∈ [d0, d1]`, `|θ| ≤ ang`
 * about the cell centre `c`, measured off its mouth normal `n` — to the robot at `p`, pulled a
 * little inside the band on both axes so a robot settling on it is not on the edge of it.
 * `bias` (−1..1) leans the angle one way, which is how two partners take different stands.
 */
export function envelopeStand(
  p: Vec2,
  c: Vec2,
  n: Vec2,
  d0: number,
  d1: number,
  ang: number,
  bias = 0,
): Vec2 {
  const vx = p.x - c.x;
  const vy = p.y - c.y;
  const d = hyp(vx, vy);
  const base = datan2(n.y, n.x);
  let th = d > 1e-6 ? wrapAngle(datan2(vy, vx) - base) : 0;
  const inner = Math.max(0.05, ang - 0.2);
  th = clamp(th + bias * inner * 0.5, -inner, inner);
  const dd = clamp(d, d0 + 4, d1 - 4);
  const dir = rot({ x: 1, y: 0 }, base + th);
  return { x: c.x + dir.x * dd, y: c.y + dir.y * dd };
}

/** where `p` sits in an envelope's polar frame: distance to the cell and angle off its normal */
export function polarOf(p: Vec2, c: Vec2, n: Vec2): { d: number; th: number } {
  const vx = p.x - c.x;
  const vy = p.y - c.y;
  return { d: hyp(vx, vy), th: wrapAngle(datan2(vy, vx) - datan2(n.y, n.x)) };
}
