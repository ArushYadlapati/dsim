import type { Artifact, RobotCommand, RobotSpec, RobotState, Vec2, World } from '../../types';
import { INTAKE_RAIL_T, SIM_DT } from '../../config';
import type { RobotSolids, SolidShape } from '../../sim/artifactSolids';
import { clamp, datan2, dcos, dsin, hyp, rot, wrapAngle } from '../../math';
import { GRAVITY } from '../../config';
import {
  BB3_INTAKE_Z,
  BB_DEFAULT_INTAKE,
  BB_DUMP_APEX_ABOVE,
  BB_DUMP_MAX_DIST,
  BB_DUMP_MIN_DIST,
  BB_DUMP_RELOAD_S,
  BB_DUMP_STAGGER_S,
  BB_FIRE_BURST_MAX,
  BB_FIRE_INTERVAL,
  BB_FLOWERS,
  bbHead,
  BB_INTAKES,
  BB_LAUNCH_LINE_FRAC,
  BB_LAUNCH_SPEED_DEFAULT,
  BB_LAUNCH_SPEED_MAX,
  BB_LAUNCH_Z0,
  BB_PLACE_REACH,
  BB_TURRET_AXLE_Z,
  BB_TURRET_SOLVE_PASSES,
  BB_PLACE_TOL,
  BB_POLLEN_R,
  bbHopperCap,
  BB_HALF_X,
  BB_HALF_Y,
  BB_INTAKE_CENTRE_FRAC,
  BB_INTAKE_CLOSE_BONUS,
  BB_INTAKE_CLOSE_REF,
  BB_INTAKE_CROSS_MAX,
  BB_INTAKE_DRAW_IN,
  BB_INTAKE_GRIP_ACCEL,
  BB_INTAKE_LANE_W,
  BB_INTAKE_LIP,
  BB_INTAKE_PERIOD_MAX,
  BB_INTAKE_PERIOD_MIN,
  BB_INTAKE_SEAT,
  BB_INTAKE_THROAT_FRAC,
  BB_INTAKE_WALL_GRAB,
  bbIntakeReach,
} from './config';
import {
  EDGE_DIR,
  EDGE_PERP,
  MOUNT_DIR,
  type BbEdge,
  bbIntakeEdges,
  bbIntakeMountOf,
  bbShooterEdgeOf,
  edgeGeom,
  mountOrigin,
  turretLocal,
} from './mounts';
import { releasePollen } from './elements';
import type { LocalRect, ScoreTarget, Vec3 } from './state';
import {
  BB_HOOD_DEFAULT_DEG,
  BB_TURRET_PITCH_MAX,
  BB_TURRET_PITCH_MIN,
  BB_TURRET_PITCH_SLEW,
  BB_TURRET_SLEW,
} from './config';
import { bbIntakeAccepts, bbIsTurreted, bbLauncherOf, bbLiftOf, bbTurretFor } from './mechs';
import { approach } from '../../math';

/**
 * BIOBUZZ ROBOT GEOMETRY — the Lane B contract surface (`docs/biobuzz-contract.md` §4).
 *
 * Every question of the form "where does this robot capture / collide / launch" is answered
 * HERE and only here. The sim reads it, the canvas sprite reads it, and the builder's SVG
 * preview reads it, which is the invariant the whole file exists to protect:
 *
 *     THE DRAWN MOUTHS ARE THE CAPTURE AREAS.
 *
 * In Chain Reaction that was learned the hard way — the renderer and the capture test each
 * derived the intake band from the spec independently, and they disagreed by an inch, so
 * balls were swallowed from outside the visible roller. One geometry, three readers.
 *
 * THERE IS A TARGET NOW. This header used to say there was not — that Sections 9 and 10 were
 * Kickoff placeholders, `scoreTargets()` returned `[]`, and a launch therefore LOBBED into the
 * field rather than at anything. Lane A has filled the field in, and `ScoreTarget` carries a
 * `mouth`, so the aim path in this file is live code rather than a written-ahead shape: a
 * turret SOLVES (`bbTurretSolution`), SLEWS onto the solution on both axes (`bbSlewTurret`) and
 * fires the matched speed/elevation pair; a turretless launcher turns its whole chassis
 * (`bbAimHeading`) and lives with the hood it was built with.
 *
 * SCORING is still Lane A's and still absent — `play.ts`'s score pass writes zeroes and the
 * module declares `scored: false` — so a POLLEN that arrives dead centre in a CELL today counts
 * for nothing. Aiming and scoring are separate landings on purpose: this half is robot
 * hardware, and R102 pins the envelope it lives in.
 */

// ─────────────────────────────────────────────────────────────────────────────
// CAPTURE + COLLISION GEOMETRY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The intake MOUTHS in the robot-local frame — one axis-aligned rect per mounted edge, so
 * `frontback` and `side` are simply two rects.
 *
 * Each mouth reaches OUT to the collision extent of its edge (`bbFootprint`, which the same
 * mount drives) and takes a shallow `depth` bite back INSIDE the frame. That bite is the whole
 * trick: a POLLEN sitting at the roller is captured BEFORE the frame would plow it, so driving
 * into a pile collects instead of scattering.
 *  • END edges (front/back) span the chassis WIDTH: `widthFrac`·chassis + `overhang`
 *  • FLANK edges (left/right) span the chassis LENGTH
 */
export function bbMouths(spec: RobotSpec): LocalRect[] {
  const it = BB_INTAKES[BB_DEFAULT_INTAKE];
  const reach = bbIntakeReach(spec);
  const hl = spec.length / 2;
  const hw = spec.width / 2;
  const endHalf = hw * it.widthFrac + it.overhang; // mouth half-width across an END edge
  // a flank roller bites `depth` into the frame; never past the centreline on a narrow chassis
  const flankInner = Math.max(0.5, hw - it.depth);

  return bbIntakeEdges(bbIntakeMountOf(spec)).map((edge): LocalRect => {
    switch (edge) {
      case 'front':
        return { edge, x0: hl - it.depth, x1: hl + reach, y0: -endHalf, y1: endHalf };
      case 'back':
        return { edge, x0: -hl - reach, x1: -hl + it.depth, y0: -endHalf, y1: endHalf };
      case 'left':
        return { edge, x0: -hl, x1: hl, y0: flankInner, y1: hw + reach };
      case 'right':
        return { edge, x0: -hl, x1: hl, y0: -hw - reach, y1: -flankInner };
    }
  });
}

/**
 * The robot's COLLISION FOOTPRINT — chassis plus whatever the sweeper sticks out, per edge.
 *
 * This must agree with the shared `footprintExtents` (`src/sim/field.ts`), which is what
 * Rapier actually collides on. It does, and not by luck: BIOBUZZ rides the shared
 * `intakeMount` field, and `footprintExtents` already grows the box from that same mount by
 * the same intake reach. Keeping a BIOBUZZ-named accessor anyway is what lets the sprite and
 * the preview ask this game for its own footprint instead of reaching into `sim/field.ts`,
 * and it is the seam the plan's escape hatch needs on the day BIOBUZZ grows a mechanism
 * whose collision box is not a rectangle.
 */
export function bbFootprint(spec: RobotSpec): { front: number; rear: number; half: number } {
  const reach = bbIntakeReach(spec);
  const mount = bbIntakeMountOf(spec);
  const ends = mount === 'front' || mount === 'frontback';
  const rear = mount === 'back' || mount === 'frontback';
  return {
    front: spec.length / 2 + (ends ? reach : 0),
    rear: spec.length / 2 + (rear ? reach : 0),
    half: spec.width / 2 + (mount === 'side' ? reach : 0),
  };
}

/**
 * WHAT ON A BIOBUZZ ROBOT IS SOLID TO A GROUND POLLEN — this game's `GameSimModule.
 * artifactSolids`, and the fourth reader of the ONE mount.
 *
 * The shared `robotSolids` (`src/sim/artifactSolids.ts`) describes DECODE'S HARDWARE: a
 * chassis box plus either the funnel wedges of the sloped/triangle presets or the vector
 * preset's flank rails, always on the FRONT, because in DECODE the intake is always on the
 * front and `INTAKE_PRESETS` is the whole catalogue. A BIOBUZZ robot is a chassis with a
 * SWEEPER BAR on whichever edge(s) `intakeMount` names, so run through the shared geometry it
 * collided with pollen through a funnel it does not have, bolted to an edge its roller is not
 * on — a back sweeper had wedges at the front and open air where the roller is.
 *
 * WHAT IS ACTUALLY SOLID, and nothing beyond it, because the season has no manual yet:
 *  · the CHASSIS box `[-hl, hl] × [-hw, hw]`, always;
 *  · per mounted edge, the sweeper's two SIDE PLATES — thin rails along the lateral edges of
 *    that edge's MOUTH (`bbMouths`, so the drawn mouth and the solid agree), spanning only the
 *    OUTBOARD band between the frame and the roller line. Thickness is the shared
 *    `INTAKE_RAIL_T`: the same plate DECODE's vector preset has, reused rather than invented,
 *    since a BIOBUZZ number here would be a guess with no figure behind it;
 *  · the POLLEN it is carrying, as circles at their storage slots — a full hopper is a
 *    physical plug in the mouth, which is why the radius is the caller's and not DECODE's.
 *
 * THE MOUTH ITSELF IS OPEN, exactly as DECODE's is (product decision #10): a sweeper roller
 * rides above pollen height and a POLLEN rolls in under it to the frame. That is also what
 * makes `interact()`'s capture-before-the-frame-arrives honest — a solid mouth would plow
 * what the roller is supposed to pick up.
 *
 * NOT A PHYSICS CONSTANT IN SIGHT, per `docs/biobuzz-contract.md`: this is hardware geometry
 * (Lane B's, §4), the same class as `bbMouths` and `bbFootprint`. Friction, restitution and
 * mass still belong to the shared solve.
 */
export function bbRobotSolids(
  r: RobotState,
  heldBalls: readonly Artifact[],
  radius: number = BB_POLLEN_R,
): RobotSolids {
  const hl = r.spec.length / 2;
  const hw = r.spec.width / 2;
  const reach = bbIntakeReach(r.spec);
  // never thicker than the frame it is bolted to — a degenerate or inverted box is a collider
  // Rapier cannot hull
  const t = Math.max(1e-3, Math.min(INTAKE_RAIL_T, hw / 2, hl / 2));
  const structure: SolidShape[] = [];
  if (reach > 1e-6) {
    for (const m of bbMouths(r.spec)) {
      if (m.edge === 'front' || m.edge === 'back') {
        // the band from the frame out to the roller line, on this end
        const cx = (m.edge === 'front' ? 1 : -1) * (hl + reach / 2);
        for (const s of [1, -1]) {
          const outer = s > 0 ? m.y1 : m.y0; // the mouth's own lateral edge
          structure.push({ kind: 'box', cx, cy: outer - (s * t) / 2, hx: reach / 2, hy: t / 2 });
        }
      } else {
        const cy = (m.edge === 'left' ? 1 : -1) * (hw + reach / 2);
        for (const s of [1, -1]) {
          const outer = s > 0 ? m.x1 : m.x0; // ±hl, the ends of a flank mouth
          structure.push({ kind: 'box', cx: outer - (s * t) / 2, cy, hx: t / 2, hy: reach / 2 });
        }
      }
    }
  }
  const held: SolidShape[] = [];
  for (const b of heldBalls) {
    if (b.state.kind !== 'held' || b.state.robot !== r.id) continue;
    held.push({ kind: 'circle', cx: b.state.lx, cy: b.state.ly, r: radius });
  }
  return { chassis: { kind: 'box', cx: 0, cy: 0, hx: hl, hy: hw }, structure, held };
}

/** the robot's active hopper capacity in POLLEN. Re-exported under the contract name; the
 * derivation lives in `config.ts` so `elements.ts` can ask without importing this file (which
 * imports `elements.ts` for the release path — a cycle nobody needs). */
export { bbHopperCap };

// ─────────────────────────────────────────────────────────────────────────────
// THE ROLLER — what the intake does to a loose element
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ONE MOUTH, MEASURED ALONG ITS OWN AXES — the frame every test below is written in, so the
 * four edges are ONE branch instead of four sign-juggling copies (the bug `bbMouthFrame`
 * already exists to prevent on the drawing side).
 *
 *   `u` = distance OUTWARD from the chassis centre along the edge's normal. The frame face is
 *         at `dist`, the roller line at `uOut`, and the mouth's bite back inside the frame
 *         reaches `uIn`.
 *   `v` = position ACROSS the roller, 0 at the edge's mid-point, `±half` at its ends.
 *
 * Derived from the rect `bbMouths` published, never re-derived from the spec: the drawn mouth
 * IS the capture area, and a second derivation is how those two drift apart.
 */
interface BbMouthAxes {
  n: Vec2;
  p: Vec2;
  /** the chassis face on this edge (`hl` for an end, `hw` for a flank) */
  dist: number;
  uIn: number;
  uOut: number;
  half: number;
}

function mouthAxes(m: LocalRect, hl: number, hw: number): BbMouthAxes {
  const n = EDGE_DIR[m.edge];
  const p = EDGE_PERP[m.edge];
  const uA = m.x0 * n.x + m.y0 * n.y;
  const uB = m.x1 * n.x + m.y1 * n.y;
  const vA = m.x0 * p.x + m.y0 * p.y;
  const vB = m.x1 * p.x + m.y1 * p.y;
  return {
    n,
    p,
    dist: m.edge === 'front' || m.edge === 'back' ? hl : hw,
    uIn: Math.min(uA, uB),
    uOut: Math.max(uA, uB),
    half: Math.abs(vB - vA) / 2,
  };
}

/** one element the rollers have hold of, and the world-frame velocity they want it at. */
export interface BbIntakePull {
  ball: Artifact;
  vel: Vec2;
}

/** what the intake does this tick: which elements it is DRAWING IN, and which have arrived at
 * the throat and may be swallowed (in order — the caller takes them through `capturePollen`,
 * which is what still enforces the hopper cap and G408). */
export interface BbIntakeAct {
  pull: BbIntakePull[];
  take: Artifact[];
}

const NO_ACT: BbIntakeAct = { pull: [], take: [] };

/**
 * THE INTAKE, AS A ROLLER RATHER THAN AS A TRIGGER RECT — the ONE implementation, called by
 * `play.ts` (2D) and `sim3d/elements3d.ts` (3D) so the two backends cannot disagree about what
 * an intake does.
 *
 * ── WHAT IT REPLACED, AND WHY ──────────────────────────────────────────────
 * `interact()` was a one-tick rect test: an element whose centre fell anywhere inside a
 * `bbMouths` rect teleported into the hopper, at unlimited rate, with no pull, no transit and
 * no relative-velocity term. Measured against it, the model below is better on every scenario
 * that was failing and no worse on the ones that were not — the numbers are in this lane's
 * report. The three things it could not do at all:
 *  · an element just OUTSIDE the rect was bulldozed rather than collected (a turn onto a
 *    POLLEN plowed it 59 in and never took it; a strafe past a line plowed 74 in);
 *  · a 3D capture is a body resting on the chassis collider, which in 3D IS the roller line
 *    (`robotExtents`), so the element sat within a hair of the rect's own bound and a strict
 *    test missed it — 35–70 ticks where 2D took 15, and misses at the mouth's lateral edge;
 *  · a hopper with room swallowed a whole pile in ONE tick, which no intake does.
 *
 * ── THE MODEL ──────────────────────────────────────────────────────────────
 *  1. ELIGIBLE: a ground element (a low FLIGHT one too, in 3D) under the roller's reach in z,
 *     of a colour this build takes (`bbIntakeAccepts`), inside a mouth — out to the roller line
 *     plus its own radius plus `BB_INTAKE_LIP` of contact tolerance, and no further. A FULL
 *     hopper returns nothing at all: the element is not pulled, and the chassis pushes it.
 *  2. GRIP: the rollers cannot hold something crossing them sideways faster than
 *     `BB_INTAKE_CROSS_MAX` relative to the robot — it carries on past.
 *  3. PULL: everything gripped is drawn toward the SEAT — its skin flush on the frame face,
 *     `BB_INTAKE_CENTRE_FRAC` of the pull spent walking it toward the throat. This is a
 *     VELOCITY the caller hands to the solve, never a position: the shared solve is still the
 *     only writer of where a ground element is (`docs/biobuzz-contract.md` §1), and this is the
 *     same shape as DECODE's `intakeSuction`, which is applied at the same point in the tick
 *     and for the same reason.
 *  4. SWALLOW: only once it has arrived — inside the throat band AND drawn back to within
 *     `BB_INTAKE_SEAT` of the frame face — which is a short transit rather than a teleport.
 *     An element PINNED on a wall is taken where it lies instead, at the slow end of the
 *     timing, because a funnel cannot centre something a wall is holding (DECODE's
 *     `INTAKE_WALL_GRAB`, and the reason its corner pickups work).
 *  5. CADENCE: one element per `BB_INTAKE_PERIOD_*` through the feed — fast dead centre, slow
 *     at the roller's ends, faster still when the robot is driving INTO it — and as many as the
 *     bar has FEED LANES (`BB_INTAKE_LANE_W`) side by side, so a wide sweeper eats a cluster
 *     two at a time and a narrow one does not.
 *
 * PURE. It reads the world and writes nothing; the caller applies both halves.
 */
export interface BbIntakeOpts {
  /** may a low FLIGHT element be taken? TRUE in 3D, where a shallow bounce is a real body
   * passing through the mouth; false in 2D, where a flight element is scripted and a ground one
   * is the only thing a roller can meet. */
  lowFlight?: boolean;
  /**
   * ⚠️ WHICH SOLID AN ELEMENT ACTUALLY COMES TO REST AGAINST IN THIS BACKEND — and the two
   * backends genuinely differ, so this is a parameter rather than a constant.
   *
   * 2D: `bbRobotSolids`' chassis box is the bare frame (`hl × hw`), the mouth is OPEN, and an
   * element pressed by the rollers ends up with its skin flush on the frame face — so the
   * throat is at `dist`. 3D: the robot's collider footprint is `robotExtents`, intake reach
   * INCLUDED (`docs/area/biobuzz.md` — a wall-flush start position needed it), so the mouth
   * region is solid and an element can never get nearer than the roller line — the throat is at
   * `uOut`. Seating a 3D element against a face 3 in inside its own collider is un-arrivable,
   * and measured that way nothing was EVER captured in 3D.
   */
  seat?: 'chassis' | 'footprint';
  /**
   * The tick length the grip ramp (`BB_INTAKE_GRIP_ACCEL`) integrates over. Optional and
   * defaulted to `SIM_DT` because neither caller (`play.ts`'s `step2d`, `sim3d/elements3d.ts`'s
   * `step3d`) steps at any other rate today — this exists so a future variable-rate caller (or a
   * lane's own dt-sweep check) does not have to fork the function to pass one in.
   */
  dt?: number;
}

export function bbIntakeAct(world: World, r: RobotState, opts: BbIntakeOpts = {}): BbIntakeAct {
  const lowFlight = opts.lowFlight ?? false;
  const atRoller = opts.seat === 'footprint';
  const dt = opts.dt ?? SIM_DT;
  const cap = bbHopperCap(r.spec);
  const room = cap - r.hopper.length;
  // A FULL HOPPER DOES NOT PULL. The element is left to the solve and the chassis pushes it,
  // which is what a plugged intake actually does — and `bbRobotSolids` has already made the
  // held elements a physical plug in the mouth.
  if (room <= 0) return NO_ACT;
  const mouths = bbMouths(r.spec);
  if (mouths.length === 0) return NO_ACT;
  const hl = r.spec.length / 2;
  const hw = r.spec.width / 2;
  const axes = mouths.map((m) => mouthAxes(m, hl, hw));
  const velRobot = rot(r.vel, -r.heading);

  interface Cand {
    ball: Artifact;
    v: number;
    half: number;
    seated: boolean;
    period: number;
  }
  const cands: Cand[] = [];
  const pull: BbIntakePull[] = [];

  for (const b of world.balls) {
    const ground = b.state.kind === 'ground';
    if (!ground && !(lowFlight && b.state.kind === 'flight')) continue;
    // too high off the tiles for a sweeper to reach. A 2D ground element is always at z = 0,
    // so this only ever bites in 3D.
    if (b.z > BB3_INTAKE_Z) continue;
    if (!bbIntakeAccepts(r.spec, r.alliance, b.color)) continue;
    const er = b.r ?? BB_POLLEN_R;
    const local = rot({ x: b.pos.x - r.pos.x, y: b.pos.y - r.pos.y }, -r.heading);
    const vLocal = rot(b.vel, -r.heading);

    for (let i = 0; i < axes.length; i++) {
      const g = axes[i];
      const u = local.x * g.n.x + local.y * g.n.y;
      const v = local.x * g.p.x + local.y * g.p.y;
      // INSIDE THE MOUTH, and no further. The outward bound is the roller line plus the
      // element's OWN radius (a NECTAR is 1.8 where a POLLEN is 1.4) plus the contact lip; the
      // inboard and lateral bounds stay the drawn rect's, so no edge can ever swallow something
      // behind or beside the chassis.
      if (!(u > g.uIn && u < g.uOut + er + BB_INTAKE_LIP)) continue;
      // ...and LATERALLY, the element's CENTRE has to be UNDER THE BAR — `|v| < half`, the
      // roller's own span and not an inch more.
      //
      // ⚠️ IT USED TO BE `half + er`, AND THAT IS WHERE "IT TOUCHED THE SIDE OF MY INTAKE AND
      // THE ROBOT SPUN" CAME FROM (owner report 2026-09-19, item 7). `bbRobotSolids` puts a
      // SIDE PLATE at each lateral end of the mouth, so an element whose centre is outboard of
      // `half` is on the far side of a solid the roller cannot reach through. The old bound
      // gripped it anyway and commanded it `DRAW_IN * CENTRE_FRAC` (50.4 in/s) straight INTO
      // that plate, every tick, for as long as the intake ran. In 2D the element simply sat
      // there fighting the clamp; in 3D — every server match — it is a real body against a real
      // collider, so the injected momentum was delivered to the chassis at an off-centre point:
      // a free force and a free torque with no command. MEASURED, robot parked, intake held, a
      // POLLEN resting against the plate: heading drifted 0.335 rad (19.2°) in 6.7 s at a steady
      // −0.035 rad/s and the robot walked 1.6 in, dragging the element with it. With the intake
      // OFF the same scene drifts 0.001 rad. An element the bar cannot reach is now just an
      // obstacle, which is what it is.
      //
      // The bound is the mouth's OWN half-span, so it moves with the geometry: the sweeper is
      // `widthFrac` 1.0, which puts it on the chassis sides — exactly where the plates are.
      if (!(Math.abs(v) < g.half)) continue;
      // GRIP: the relative motion across the rollers. Too fast and they spin under it.
      const relU = (vLocal.x - velRobot.x) * g.n.x + (vLocal.y - velRobot.y) * g.n.y;
      const relV = (vLocal.x - velRobot.x) * g.p.x + (vLocal.y - velRobot.y) * g.p.y;
      if (Math.abs(relV) > BB_INTAKE_CROSS_MAX) break;

      // THE FEED THROAT. ⚠️ THE WHOLE ROLLER, in the backend whose mouth is SOLID: with the
      // chassis collider out at `robotExtents` there is no open mouth for a funnel to walk an
      // element across — whatever the roller line is touching is what goes in, and the transit
      // is the cadence. Measured with a `THROAT_FRAC` band in 3D as well, elements near the
      // mouth's lateral edge were deflected by the collider corner before the funnel could
      // centre them and a six-element cluster lost one that the old model took.
      const throatHalf = atRoller ? g.half : g.half * BB_INTAKE_THROAT_FRAC;
      // THE SEAT: skin flush on whichever face this backend lets it reach (see `BbIntakeOpts`).
      const face = atRoller ? g.uOut : g.dist;
      const tu = face + er;
      const tv = clamp(v, -throatHalf, throatHalf);
      const du = tu - u;
      const dv = tv - v;
      const dl = hyp(du, dv);
      // THE ROLLERS MOVE WITH THE ROBOT, so the target is the robot's own velocity plus the
      // draw-in along the seat direction. Without that term an element in the mouth of a
      // driving robot is simply left behind and bulldozed by the frame it is sitting on — which
      // is the whole of the "it should perform better" complaint, measured at 59 in of plow.
      //
      // ⚠️ THE LATERAL TERM IS SCALED AFTER NORMALISING, NOT BEFORE. Scaled before, an element
      // already at the right depth (which in 3D is EVERY element, because it rests on the
      // roller line) had `du ≈ 0`, so the unit vector was all lateral and the funnel fired the
      // full `BB_INTAKE_DRAW_IN` sideways — which then read as an element crossing the rollers
      // at 52 in/s, tripped `BB_INTAKE_CROSS_MAX`, and dropped it out of the mouth on the next
      // tick. Measured: 0/1 captured and 66 in of plow on a POLLEN 0.7 in off the throat.
      const wu = velRobot.x * g.n.x + velRobot.y * g.n.y + (dl > 0.05 ? (du / dl) * BB_INTAKE_DRAW_IN : 0);
      const wv =
        velRobot.x * g.p.x +
        velRobot.y * g.p.y +
        (dl > 0.05 ? (dv / dl) * BB_INTAKE_DRAW_IN * BB_INTAKE_CENTRE_FRAC : 0);
      // ⚠️ THE RAMP IS AN ACCELERATION TIMES `dt`, NOT THE TARGET SPEED ITSELF. This used to pass
      // `BB_INTAKE_DRAW_IN` — a speed — straight in as `approach`'s per-TICK `maxDelta`, which
      // reached the full draw-in speed from rest in exactly one tick (52 in/s ÷ (1/60 s) = 3120
      // in/s² of effective acceleration — an instant-velocity teleport, not a grip). `approach`'s
      // `maxDelta` is a displacement, so a real acceleration cap is `BB_INTAKE_GRIP_ACCEL * dt`:
      // an element now ramps to `wu`/`wv` over several ticks instead of arriving there whole.
      const grip = BB_INTAKE_GRIP_ACCEL * dt;
      const cu = approach(vLocal.x * g.n.x + vLocal.y * g.n.y, wu, grip);
      const cv = approach(vLocal.x * g.p.x + vLocal.y * g.p.y, wv, grip);
      pull.push({
        ball: b,
        vel: rot({ x: cu * g.n.x + cv * g.p.x, y: cu * g.n.y + cv * g.p.y }, r.heading),
      });

      // PINNED: a wall is holding it, so the funnel has nothing to work with — take it where
      // it lies, at the slow end of the timing.
      const wallClear = Math.min(BB_HALF_X - Math.abs(b.pos.x), BB_HALF_Y - Math.abs(b.pos.y));
      const pinned = wallClear <= er + BB_INTAKE_WALL_GRAB;
      const arrived = u < face + er + BB_INTAKE_SEAT;
      const seated = arrived && (Math.abs(v) < throatHalf || pinned);
      const t = pinned ? 1 : clamp(Math.abs(v) / g.half, 0, 1);
      const closing = clamp(-relU / BB_INTAKE_CLOSE_REF, 0, 1);
      const period =
        (BB_INTAKE_PERIOD_MIN + (BB_INTAKE_PERIOD_MAX - BB_INTAKE_PERIOD_MIN) * t) /
        (1 + BB_INTAKE_CLOSE_BONUS * closing);
      cands.push({ ball: b, v, half: g.half, seated, period });
      break; // an element is in at most one mouth: opposite edges cannot both hold it
    }
  }

  const seated = cands.filter((c) => c.seated);
  if (seated.length === 0) return { pull, take: [] };
  // most central first, id as the deterministic tie-break — the same ordering rule DECODE's
  // `updateIntake` sorts its candidates by.
  seated.sort((a, b) => Math.abs(a.v) - Math.abs(b.v) || a.ball.id - b.ball.id);
  if (world.time - r.lastIntakeAt < seated[0].period) return { pull, take: [] };

  const lanes = Math.max(1, Math.floor((2 * seated[0].half) / BB_INTAKE_LANE_W));
  const laneW = (2 * seated[0].half) / lanes;
  const used = new Set<number>();
  const take: Artifact[] = [];
  for (const c of seated) {
    if (take.length >= Math.min(room, lanes)) break;
    const lane = clamp(Math.floor((c.v + c.half) / laneW), 0, lanes - 1);
    if (used.has(lane)) continue; // two elements in one lane queue; they do not both fit
    used.add(lane);
    take.push(c.ball);
  }
  return { pull, take };
}

// ─────────────────────────────────────────────────────────────────────────────
// AIM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The heading a TURRETLESS robot must turn to in order to point its firing edge at `target`,
 * or `null` when there is nothing to aim (the launcher is turreted, so it aims itself).
 *
 * A dumper fires over ONE chassis edge, so aiming means turning the whole robot — and the
 * answer is not simply "the bearing to the target", it is that bearing MINUS the edge's own
 * outward angle. Get that subtraction wrong and a broadside launcher aims 90° off, which is
 * exactly the class of bug the single `EDGE_*` table exists to prevent.
 *
 * Read through `bbLauncherOf`, never the flat `scoreMode` mirror. The callers are `bbAimAssist`
 * (`play.ts`), which applies the result as a rotate override while fire is held, and stage 5b,
 * which only calls a dumper ON TARGET once the chassis is within `BB_AIM_TOL` of it.
 */
export function bbAimHeading(r: RobotState, target: ScoreTarget): number | null {
  const launcher = bbLauncherOf(r.spec, BB_HOOD_DEFAULT_DEG);
  if (bbIsTurreted(launcher)) return null; // the turret slews to it; the chassis is free
  const edge = bbShooterEdgeOf({ shooterMount: launcher.mount });
  const bearing = datan2(target.pos.y - r.pos.y, target.pos.x - r.pos.x);
  // heading + EDGE_ANGLE[edge] === bearing  ⇒  heading = bearing − EDGE_ANGLE[edge]
  return wrapAngle(bearing - datan2(EDGE_DIR[edge].y, EDGE_DIR[edge].x));
}

/**
 * WHERE A TURRET IS BOLTED, in world space — the point an element is actually born at, so a
 * back-mounted turret visibly shoots off the back and a corner-mounted one off that corner.
 * The AIM solution and the LAUNCH both read this: solving a lead from the chassis centre while
 * firing from an offset muzzle leaves a systematic miss that grows with the offset.
 *
 * `which` names the turret: 0 is the launcher's `mount` (a DOUBLE turret's POLLEN turret), 1 is
 * a double turret's `mount2` (its NECTAR turret). A build with one turret reads 1 as 0.
 */
export function bbTurretOrigin(r: RobotState, which: 0 | 1 = 0): Vec2 {
  const launcher = bbLauncherOf(r.spec, BB_HOOD_DEFAULT_DEG);
  const pos = which === 1 ? (launcher.mount2 ?? launcher.mount) : launcher.mount;
  const off = rot(turretLocal(r.spec, pos), r.heading);
  return { x: r.pos.x + off.x, y: r.pos.y + off.y };
}

/** the ELEVATION of turret `which` right now (rad) — 0 for a turret this build does not have. */
function turretPitchOf(r: RobotState, which: 0 | 1): number {
  return which === 1 ? (r.bbTurret2Pitch ?? 0) : (r.bbTurretPitch ?? 0);
}

/**
 * THE RELEASE turret `which` makes RIGHT NOW at `speed`: where the element is born — in the
 * plane AND in height — and the velocity it leaves with, along that turret's current heading and
 * pitch (not its solution — a turret still swinging fires where it points). ONE function because
 * three readers need the same answer: `bbLaunch` releases it, stage 5b runs it forward to ask
 * whether it will score, and `shotPath.ts` draws it.
 *
 * ⚠️ **`origin` IS NOT THE TURRET'S BOLT POINT AND `z` IS NOT A CONSTANT.** The muzzle FOLLOWS
 * THE HOOD (owner, 2026-09-19): the hood lip swings about the flywheel axle, which itself sits
 * `axleX` in FRONT of the turret's rotation axis, so the release starts well ahead of the bolt
 * point and creeps back toward it as the barrel elevates, dropping as it goes. Both halves come
 * out of `bbMuzzleLocal`, which is the one place the dimension chain is read — and it is read
 * with `which`, because a DOUBLE turret's NECTAR head is a bigger machine than its POLLEN one.
 */
export function bbTurretRelease(
  r: RobotState,
  which: 0 | 1,
  speed: number,
): { origin: Vec2; z: number; vel: Vec3 } {
  const h = which === 1 ? (r.bbTurret2Heading ?? r.turretHeading) : r.turretHeading;
  const pitch = turretPitchOf(r, which);
  const m = bbMuzzleLocal(pitch, which);
  const o = bbTurretOrigin(r, which);
  const vh = dcos(pitch);
  return {
    origin: { x: o.x - dcos(h) * m.back, y: o.y - dsin(h) * m.back },
    z: bbMuzzleZ(r.spec, pitch, which),
    vel: { x: dcos(h) * speed * vh, y: dsin(h) * speed * vh, z: speed * dsin(pitch) },
  };
}

/** the mid-point of a turretless launcher's firing EDGE, in world space, plus that edge's
 * outward direction and the half-span a launch LINE spreads its release points across. */
function launchLine(r: RobotState, edge: BbEdge): { origin: Vec2; dir: Vec2; perp: Vec2; half: number } {
  const g = edgeGeom(r.spec, edge);
  const local = mountOrigin(r.spec, edge);
  const o = rot(local, r.heading);
  return {
    origin: { x: r.pos.x + o.x, y: r.pos.y + o.y },
    dir: rot(EDGE_DIR[edge], r.heading),
    perp: rot(EDGE_PERP[edge], r.heading),
    half: g.span * BB_LAUNCH_LINE_FRAC,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LAUNCH
// ─────────────────────────────────────────────────────────────────────────────

/** is a hopper colour a NECTAR? POLLEN are yellow; NECTAR carry their alliance colour (§9.8). */
function isNectarColour(c: string): boolean {
  return c === 'red' || c === 'blue';
}

/**
 * WHAT STAGE 5b WORKED OUT ABOUT A SHOT, handed to `bbLaunch` in the same tick.
 *
 * Carried as a local, never as a `RobotState` field: it is read one stage after it is written,
 * and a per-tick robot field ships 30 times a second to every client in the room.
 */
export interface BbShot {
  /** the cell Aim Assist is on (`bbAimTarget`): the nearer cell of the own HIVE, as if it were up */
  target: ScoreTarget;
  /** solved muzzle speed per turret exit — [0] a turret / a double turret's POLLEN turret,
   * [1] a double turret's NECTAR turret. `undefined` fires at `BB_LAUNCH_SPEED_DEFAULT`. A
   * dumper solves per element (`bbDumpSolution`) and leaves this empty. */
  speed: readonly (number | undefined)[];
  /** WILL LAND per exit (same indexing): the release this exit would make now, run forward through
   * the flight stage (`bbFlightEnters`), enters `target` PRETENDING THAT CELL IS UP AND SETTLED.
   * A dumper additionally has to be within `BB_AIM_TOL` of its aim heading. Only predicted while
   * the driver holds fire; `false` otherwise. This is the whole of Aim Assist's firing gate. */
  lands: readonly boolean[];
  /**
   * ⚠️ **3D ONLY, AND ABSENT EVERYWHERE ELSE** — the most elements ONE dump tick releases.
   *
   * A 2D flight element collides with nothing, so throwing the whole hopper on one tick is free
   * there and the 2D pipeline never sets this. In 3D every one of those elements is a real body,
   * and `bbDumpSolution` converges ALL of them on the single cell-centre point: four spheres born
   * a couple of inches apart, aimed at the same place, meet each other in the opening and knock
   * one another off the arc. Measured on the 28-pose tutorial grid, with the birth clearance of
   * `syncElement` already in: a simultaneous four-element dump scored 3/28, and one element every
   * `BB_DUMP_STAGGER_S` scores 20/28 — every pose from 22 in out. (The four that still miss are
   * the two closest rows, where the lob clips the HIVE underside; that is the CAD ruling's own
   * documented consequence, not this bug.)
   *
   * So `sim3d/elements3d.ts` sets it to 1 and the dump STAGGERS — `BB_DUMP_STAGGER_S` between
   * elements while the hopper still has some, the full `BB_DUMP_RELOAD_S` once it empties. It is
   * also the more honest picture: a tipping tray pours, it does not teleport four balls out on
   * one tick.
   *
   * **With the field absent the dumper branch below runs byte-identically to before it existed**,
   * which is the 2D pipeline's permanence rule.
   */
  perDump?: number;
}

/**
 * FIRE, if this mechanism wants to this tick.
 *
 *  • turret      — one element every `BB_FIRE_INTERVAL`, from the turret ring, along
 *                  `turretHeading`. A SINGLE turret only ever holds POLLEN (its intake refuses
 *                  NECTAR — `bbIntakeAccepts`).
 *  • twinturret  — TWO INDIVIDUAL turrets, each with its OWN feed off the shared hopper and
 *                  BOTH FIRING ON THE SAME BEAT. A POLLEN leaves turret 0 (`mount`,
 *                  `turretHeading`, `bbTurretPitch`) and a NECTAR leaves turret 1 (`mount2`,
 *                  `bbTurret2Heading`, `bbTurret2Pitch`), each at its own solved speed.
 *                  ⚠️ IT USED TO ALTERNATE (owner report 2026-09-19, item 5: "double turret
 *                  shooter should start shooting pollen and nectar at the same time"). One LIFO
 *                  `r.hopper` top chose ONE exit per beat, so with two POLLEN and two NECTAR
 *                  loaded the measured release order was NECTAR at tick 0, POLLEN at tick 4,
 *                  NECTAR at 9, POLLEN at 13 — the second turret's first shot always a whole
 *                  cadence interval behind the first's. Worse, the gate read the top element's
 *                  exit ALONE: a NECTAR on top with turret 1 still slewing refused the fire
 *                  outright and the loaded, aimed POLLEN turret sat idle behind it. Each turret
 *                  now takes the LIFO-top element OF ITS OWN KIND, and an exit that is empty or
 *                  off target is simply skipped rather than blocking the other one.
 *  • dumper      — the WHOLE hopper at once, each element thrown from its own point across the
 *                  firing edge along its own CONVERGING arc into the target cell
 *                  (`bbDumpSolution`), then `BB_DUMP_RELOAD_S` to re-arm.
 *
 * ── WHEN IT FIRES — AIM ASSIST (owner, 2026-09-13) ─────────────────────────
 * ONLY ON THE DRIVER'S FIRE BUTTON. BIOBUZZ has no auto-fire: `r.autoFire` is never read here
 * (spawn forces it false), because the auto-fire it replaced fired whenever the real up cell
 * would take a shot and held back once the elements in the air would tip it — sensing no robot
 * has. With aim assist on (always, `coerceAssists`), a held fire is released only when stage 5b
 * says this exit's shot would LAND in the cell the assist is on, pretending that cell is up
 * (`BbShot.lands`). So a turret still slewing waits, a robot out of range does nothing, and a
 * shot at a cell that is actually down — or that tips before the shot arrives — is released and
 * misses, which is what the driver would get on a real field. With aim assist off, fire is fire.
 *
 * CADENCE IS ACCUMULATED, not re-anchored (`fireReadyAt += interval`), so the long-run turret
 * rate is exactly 13/s. The BEAT is shared — one `fireReadyAt`, one wire field, and a shared
 * feed is what a shared hopper physically is — but every exit that is loaded and on target
 * fires on it, so the two turrets of a double start together and each keeps its own 13/s
 * afterwards. The idle guard (clamp forward when the hopper is empty) stops a burst catch-up on
 * refill; `BB_FIRE_BURST_MAX` bounds any that remains. DETERMINISM: no jitter.
 */
export function bbLaunch(world: World, r: RobotState, cmd: RobotCommand, enabled: boolean, shot?: BbShot): void {
  const launcher = bbLauncherOf(r.spec, BB_HOOD_DEFAULT_DEG);
  const dumper = launcher.kind === 'dumper';
  /** the exits this launcher has: both turrets of a double, one for everything else. */
  const exits: readonly (0 | 1)[] = launcher.kind === 'twinturret' ? [0, 1] : [0];
  /**
   * THE LIFO-TOP ELEMENT `which` IS FED, or `undefined` when that exit has nothing to fire.
   *
   * For a single turret and a dumper `bbTurretFor` answers 0 for every colour, so this is the
   * hopper's top and every line below is what it always was. For a DOUBLE it is the top POLLEN
   * for turret 0 and the top NECTAR for turret 1 — two feeds off one hopper, which is what lets
   * both fire on one beat.
   */
  const feed = (which: 0 | 1): (typeof r.hopper)[number] | undefined => {
    for (let i = r.hopper.length - 1; i >= 0; i--) {
      const c = r.hopper[i];
      if (bbTurretFor(launcher, isNectarColour(c)) === which) return c;
    }
    return undefined;
  };
  const lands = (which: number): boolean => !r.aimAssist || (shot?.lands[which] ?? false);
  // ARMED IF *ANY* EXIT IS. A dumper heaves the whole hopper out of exit 0, so it asks about
  // that one; a launcher with two turrets is not blocked by the one that is empty or still
  // slewing.
  const armed = dumper ? lands(0) : exits.some((w) => feed(w) !== undefined && lands(w));
  const want = enabled && cmd.fire && armed;
  if (!want || r.hopper.length === 0) {
    // IDLE GUARD: hold the cadence clock at "now" while there is nothing to fire, so a robot
    // that sat empty for ten seconds does not empty its hopper in one tick on refill.
    if (r.fireReadyAt < world.time) r.fireReadyAt = world.time;
    return;
  }

  if (dumper) {
    // RE-ARM, and the aim gate. Respecting `fireReadyAt` is what stops a held fire button
    // re-dumping on every capture.
    if (r.fireReadyAt > world.time) return;
    const target = shot?.target ?? null;
    // STAGGERED ONLY WHEN THE CALLER ASKS (3D — see `BbShot.perDump`). Absent, `n` is the whole
    // hopper and every line below is what it always was.
    const cap = shot?.perDump;
    const n = cap === undefined ? r.hopper.length : Math.min(r.hopper.length, Math.max(1, Math.trunc(cap)));
    const throws = target ? bbDumpSolution(r, target, n) : null;
    if (throws) {
      // LIFO, each element onto its own converging arc
      for (const t of throws) releasePollen(world, r, t.vel, target ?? undefined, t.origin);
    } else {
      // aim assist off and out of range: straight over the edge, a parallel line, lobbed as far
      // as a dumper throws
      const lob = bbLobThrow(BB_DUMP_MAX_DIST, (target?.z ?? BB_LAUNCH_Z0) - BB_LAUNCH_Z0) ?? { vh: 0, vz: 0 };
      const { origin, dir, perp, half } = launchLine(r, bbShooterEdgeOf({ shooterMount: launcher.mount }));
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
        releasePollen(
          world,
          r,
          { x: dir.x * lob.vh, y: dir.y * lob.vh, z: lob.vz },
          undefined,
          { x: origin.x + perp.x * t * half, y: origin.y + perp.y * t * half },
        );
      }
    }
    r.lastFireAt = world.time;
    // A STAGGERED DUMP RE-ARMS SHORT WHILE IT STILL HAS LOAD, and takes the full reload on the
    // tick that empties it — so the tray pours over `BB_DUMP_STAGGER_S` intervals and the
    // re-dump cost a driver feels is unchanged.
    const more = cap !== undefined && r.hopper.length > 0;
    r.fireReadyAt = world.time + (more ? BB_DUMP_STAGGER_S : BB_DUMP_RELOAD_S);
    return;
  }

  // TURRETS: from the ring, along that turret's own heading and pitch, at the speed its arc
  // solution asked for. Speed and elevation travel TOGETHER — `bbSolveShot` returns a matched
  // pair — so a turret still swinging fires the stale pair and misses.
  //
  // EVERY LOADED, ON-TARGET EXIT FIRES ON THE BEAT. `beats` counts BEATS of the cadence clock,
  // not elements: a double turret releases up to two on one beat and that is the point. An exit
  // with nothing of its kind in the hopper, or one still slewing, is SKIPPED — never a `break`,
  // which is what used to stall a loaded turret behind its partner.
  let beats = 0;
  while (r.fireReadyAt <= world.time && beats < BB_FIRE_BURST_MAX) {
    let released = false;
    for (const which of exits) {
      const colour = feed(which);
      if (colour === undefined || !lands(which)) continue;
      const rel = bbTurretRelease(r, which, shot?.speed[which] ?? BB_LAUNCH_SPEED_DEFAULT);
      // THE HEIGHT TRAVELS WITH THE POINT. `rel.z` is the hood lip at this turret's CURRENT
      // pitch, not `BB_LAUNCH_Z0` — a turret at full elevation releases ~2.1 in lower than one
      // at rest.
      releasePollen(world, r, rel.vel, undefined, rel.origin, colour, rel.z);
      released = true;
    }
    if (!released) break; // nothing left either exit can fire: stop, and leave the clock alone
    r.fireReadyAt += BB_FIRE_INTERVAL;
    beats++;
  }
  if (beats > 0) r.lastFireAt = world.time;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE ARC — solving a launch against a target that has a HEIGHT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The minimum-speed ballistic solution to a target `d` inches away and `dh` inches ABOVE the
 * muzzle. Returns the launch speed and the elevation, both of which a turret then has to be
 * able to produce.
 *
 * DECODE's `solveShot` is the same mathematics with a CONSTANT height difference (one goal);
 * `dh` is a parameter here, and nothing BIOBUZZ may go into the shared tree.
 *
 *   v_min^2 = g * (dh + sqrt(d^2 + dh^2)),   angle = atan2(dh + sqrt(d^2 + dh^2), d)
 */
export function bbSolveShot(d: number, dh: number): { speed: number; angle: number } {
  const dd = Math.max(d, 0.5);
  const reach = hyp(dd, dh);
  return { speed: Math.sqrt(GRAVITY * (dh + reach)), angle: datan2(dh + reach, dd) };
}

/**
 * A DUMP IS A LOB (owner, 2026-09-13) — the horizontal and vertical launch speed that throws an
 * element up to `BB_DUMP_APEX_ABOVE` over a target `dh` inches above the release and down onto it
 * `d` inches away, or `null` when `d` is outside the dumper's range (`BB_DUMP_MIN_DIST` ..
 * `BB_DUMP_MAX_DIST`) or the throw would exceed `BB_LAUNCH_SPEED_MAX`.
 *
 *   rise h = dh + apex:   vz = √(2·g·h),   t = vz/g + √(2·apex/g),   vh = d / t
 *
 * The apex is always ABOVE the target, so the element always arrives descending — the thing
 * `hiveAccepts` needs, and the thing a fixed hood only managed past its own apex distance. That is
 * why the minimum is geometry alone and a dumper scores from right under the opening's outer lip.
 */
export function bbLobThrow(d: number, dh: number): { vh: number; vz: number } | null {
  if (!(d >= BB_DUMP_MIN_DIST) || d > BB_DUMP_MAX_DIST) return null;
  const rise = dh + BB_DUMP_APEX_ABOVE;
  if (!(rise > 0)) return null;
  const vz = Math.sqrt(2 * GRAVITY * rise);
  const vh = d / (vz / GRAVITY + Math.sqrt((2 * BB_DUMP_APEX_ABOVE) / GRAVITY));
  if (hyp(vh, vz) > BB_LAUNCH_SPEED_MAX) return null;
  return { vh, vz };
}

/** one element's throw out of a dump: where it leaves and the velocity it leaves with. */
export interface BbThrow {
  origin: Vec2;
  vel: Vec3;
}

/**
 * THE DUMP, SOLVED — `n` release points spread across the dumper's firing edge, each with its
 * own velocity CONVERGING on `target`'s centre, or `null` when this build is not a dumper or ANY
 * element has no accepted arc.
 *
 * ── WHY CONVERGE, NOT A PARALLEL LINE ───────────────────────────────────────
 * The cell's accept footprint is 20 in wide and the release points span up to ~16 in, but an
 * element thrown parallel to the chassis heading also carries that heading's error, and the
 * lateral tolerance left at range is only a couple of inches. Aiming each element from its OWN
 * release point at the cell centre removes both.
 *
 * ── THE RANGE ───────────────────────────────────────────────────────────────
 * Each element is thrown from the actual release height `BB_LAUNCH_Z0` (that is where
 * `releasePollen` puts it) as a LOB (`bbLobThrow`). It has a throw only inside the dumper's range,
 * `BB_DUMP_MIN_DIST`..`BB_DUMP_MAX_DIST` from its own release point; outside it there is no dump to
 * solve, and Aim Assist does not let the dump go.
 */
export function bbDumpSolution(r: RobotState, target: ScoreTarget, n: number): BbThrow[] | null {
  const launcher = bbLauncherOf(r.spec, BB_HOOD_DEFAULT_DEG);
  if (launcher.kind !== 'dumper') return null;
  const dh = target.z - BB_LAUNCH_Z0;
  const { origin, perp, half } = launchLine(r, bbShooterEdgeOf({ shooterMount: launcher.mount }));
  const out: BbThrow[] = [];
  const count = Math.max(1, n);
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
    const o = { x: origin.x + perp.x * t * half, y: origin.y + perp.y * t * half };
    const dx = target.pos.x - o.x;
    const dy = target.pos.y - o.y;
    const d = hyp(dx, dy);
    const lob = bbLobThrow(d, dh);
    if (!lob) return null;
    out.push({ origin: o, vel: { x: (dx / d) * lob.vh, y: (dy / d) * lob.vh, z: lob.vz } });
  }
  return out;
}

/**
 * ⚠️ **THE MUZZLE — THE ONE FUNCTION THE PICTURE AND THE PHYSICS BOTH READ.**
 *
 * Where the hood lip is at elevation `pitch`, in the TURRET FRAME (origin on the turret's
 * ROTATION AXIS): `z` off the tiles, and `back` how far BEHIND that axis the lip sits along the
 * turret's own heading. The lip rides the element's path circle about the FLYWHEEL AXLE, and the
 * axle is `axleX` FORWARD of the rotation axis, so it is one rotation of `pathR` less that
 * offset:
 *
 *     back = pathR · sin p − axleX        z = BB_TURRET_AXLE_Z + pathR · cos p
 *
 * ⚠️ **`back` IS NORMALLY NEGATIVE, AND THAT IS THE CHANGE.** `axleX = pathR` (the element comes
 * up the rotation axis and pinches there), so the lip is a full `pathR` FORWARD of the axis at
 * rest and creeps back toward it as the hood elevates — it never gets behind it. POLLEN: (−2.517,
 * 9.635) level, (−0.038, 7.554) at the 80° cap. NECTAR is a bigger head and a higher one:
 * (−2.917, 10.035) and (−0.044, 7.624).
 *
 * ⚠️ **AND `which` PICKS THE HEAD.** Turret 0 throws POLLEN on every build and turret 1 is the
 * DOUBLE turret's NECTAR exit; a 3.6-in element wants a bigger hood, a wider channel and a
 * further-forward axle than a 2.8-in one (`BbHeadDims`, `config.ts`), so the two muzzles differ.
 *
 * ⚠️ **IT LIVES HERE, NOT IN THE RENDERER.** Nothing outside `scene/` may import from `scene/`,
 * so a formula that lived there could only ever have had one reader — which is exactly how the
 * shooter reached a sixth review pass with the drawing and the ballistics disagreeing. The 3D
 * scene builds `bb-turret-pitch` about the AXLE and reads this for the muzzle; the sim releases
 * here and solves against here. Same rule as `shotPath.ts`: ONE PREDICTOR, TWO DRAWINGS.
 *
 * Deterministic trig (`dsin`/`dcos`), because this is sim code on the release path.
 */
export function bbMuzzleLocal(pitch: number, which: 0 | 1 = 0): { back: number; z: number } {
  const h = bbHead(which);
  const p = clamp(pitch, BB_TURRET_PITCH_MIN, BB_TURRET_PITCH_MAX);
  return { back: h.pathR * dsin(p) - h.axleX, z: BB_TURRET_AXLE_Z + h.pathR * dcos(p) };
}

/**
 * how high above the tiles this build's element leaves the mechanism at elevation `pitch` (in).
 *
 * ⚠️ IT IS THE RELEASE HEIGHT, AND THE RELEASE READS IT. `releasePollen` (`elements.ts`) is
 * handed this for a turret shot, so the height the arc was solved from and the height the element
 * is actually born at cannot drift: the turret once solved from 2 in above the release and every
 * turret shot arrived 2 in low, which is the bug this function exists to make impossible.
 *
 * ⚠️ **A DUMPER HAS NO HOOD, SO ITS RELEASE IS STILL FLAT.** `BB_LAUNCH_Z0` is a tipping tray's
 * lip, it does not swing about a flywheel axle, and the turret's change must not leak into it —
 * `bbLobThrow`, `bbDumpSolution` and `bbLaunch`'s dumper branch all still use `BB_LAUNCH_Z0`
 * directly, and this returns it unchanged for a turretless build whatever `pitch` says.
 *
 * `pitch` defaults to the rest pose (`BB_TURRET_PITCH_MIN`), which is the muzzle a caller with no
 * elevation in hand means; `which` defaults to the POLLEN turret, which every turreted build has.
 */
export function bbMuzzleZ(spec: RobotSpec, pitch: number = BB_TURRET_PITCH_MIN, which: 0 | 1 = 0): number {
  if (!bbIsTurreted(bbLauncherOf(spec, BB_HOOD_DEFAULT_DEG))) return BB_LAUNCH_Z0;
  return bbMuzzleLocal(pitch, which).z;
}

/**
 * THE WHOLE TURRET SOLUTION — yaw, elevation and muzzle speed — to put an element into `target`
 * from turret `which`, or `null` when this build has no such turret (a dumper, or turret 1 on a
 * single turret).
 *
 * ⚠️ ALL THREE, TOGETHER, BECAUSE THE ARC IS ONE ANSWER AND NOT THREE. `bbSolveShot` returns a
 * MATCHED (speed, angle) pair. The pitch is clamped into the barrel's real envelope and the speed
 * into `BB_LAUNCH_SPEED_MAX`, so a solution the hardware cannot reach comes back as the nearest
 * one it can — which then MISSES, honestly — and says so in `reachable`, which stage 5b reads before
 * running Aim Assist's landing prediction.
 *
 * ── ⚠️ AND IT IS A FIXED POINT, BECAUSE THE MUZZLE FOLLOWS THE HOOD ─────────
 * The elevation moves the release (`bbMuzzleLocal`: lower, and further back along the heading),
 * and the release moves the elevation the arc asks for. That circularity is the hardware's, not
 * a modelling choice, so the solve iterates it: start level, solve, re-read the muzzle at the
 * pitch that came out, solve again. `BB_TURRET_SOLVE_PASSES` passes, ALWAYS — no early exit and
 * no tolerance, because a trip count that depends on a float comparison is a trip count that can
 * differ between a client's prediction and the server's authority. The map converges
 * geometrically (the release moves by well under an inch for a degree of pitch at the ranges a
 * HIVE shot lives at): MEASURED over 7,688 field poses, a fifth pass moves the pitch by at most
 * 1.76e-9 rad.
 *
 * MEASURED CONSEQUENCE, over the whole 2-in field grid at both cells: scoreable cells go
 * 1359 → 1382 (north) and 1417 → 1439 (south), pitch-capped cells 255 → 211, nothing is
 * speed-capped, and the worst required muzzle speed rises from 253.26 to 256.37 against a 260
 * cap. The release is ~2.1 in lower at hive elevations, which costs a little speed and unblocks
 * more of the field than it loses — the owner authorised the outcome change knowingly.
 */
export function bbTurretSolution(
  r: RobotState,
  target: ScoreTarget,
  which: 0 | 1 = 0,
): { yaw: number; pitch: number; speed: number; reachable: boolean } | null {
  const launcher = bbLauncherOf(r.spec, BB_HOOD_DEFAULT_DEG);
  if (!bbIsTurreted(launcher)) return null;
  if (which === 1 && launcher.kind !== 'twinturret') return null;
  // FROM THE TURRET'S BOLT POINT, NOT THE CHASSIS CENTRE — see `bbTurretOrigin`. The muzzle's own
  // SETBACK from that point is the `back` term inside the loop, and it grows with elevation.
  const o = bbTurretOrigin(r, which);
  const dx = target.pos.x - o.x;
  const dy = target.pos.y - o.y;
  const d0 = hyp(dx, dy);
  // PASS 1 starts from the LEVEL muzzle and every later pass re-reads it at the pitch the
  // previous one produced. It used to skip the `back` term on the first pass, on the grounds
  // that a level lip sat exactly over the bolt point; it does not any more — the lip is a full
  // `axleX` in FRONT of the rotation axis at rest — so the first pass reads the muzzle like the
  // rest and the loop is one shape.
  let pitch = BB_TURRET_PITCH_MIN;
  let sol = bbSolveShot(d0 + bbMuzzleLocal(pitch, which).back, target.z - bbMuzzleZ(r.spec, pitch, which));
  for (let i = 1; i < BB_TURRET_SOLVE_PASSES; i++) {
    pitch = clamp(sol.angle, BB_TURRET_PITCH_MIN, BB_TURRET_PITCH_MAX);
    const m = bbMuzzleLocal(pitch, which);
    sol = bbSolveShot(d0 + m.back, target.z - bbMuzzleZ(r.spec, pitch, which));
  }
  pitch = clamp(sol.angle, BB_TURRET_PITCH_MIN, BB_TURRET_PITCH_MAX);
  return {
    yaw: datan2(dy, dx),
    pitch,
    speed: Math.min(sol.speed, BB_LAUNCH_SPEED_MAX),
    reachable: sol.speed <= BB_LAUNCH_SPEED_MAX && pitch === sol.angle,
  };
}

/** The ELEVATION turret 0 must be at to put an element into `target`, in RADIANS, or `null` when
 * this build has no turret to elevate. The pitch half of `bbTurretSolution`. */
export function bbAimPitch(r: RobotState, target: ScoreTarget): number | null {
  return bbTurretSolution(r, target)?.pitch ?? null;
}

/**
 * Ease turret `which`'s yaw and pitch toward a solution, one tick's worth. BOTH AXES SLEW, and
 * neither snaps; pitch is deliberately the slower axis. Turret 1 (a double turret's NECTAR
 * turret) writes `bbTurret2Heading` / `bbTurret2Pitch`, so only a caller that has a second
 * turret should name it.
 */
export function bbSlewTurret(
  r: RobotState,
  wantYaw: number | null,
  wantPitch: number | null,
  dt: number,
  which: 0 | 1 = 0,
): void {
  const yawStep = BB_TURRET_SLEW * dt; // rad/s * s
  const pitchStep = BB_TURRET_PITCH_SLEW * dt;
  if (which === 1) {
    if (wantYaw !== null) {
      const now = r.bbTurret2Heading ?? r.turretHeading;
      r.bbTurret2Heading = wrapAngle(now + clamp(wrapAngle(wantYaw - now), -yawStep, yawStep));
    }
    if (wantPitch !== null) {
      const now = r.bbTurret2Pitch ?? 0;
      r.bbTurret2Pitch = clamp(now + clamp(wantPitch - now, -pitchStep, pitchStep), BB_TURRET_PITCH_MIN, BB_TURRET_PITCH_MAX);
    }
    return;
  }
  if (wantYaw !== null) {
    const err = wrapAngle(wantYaw - r.turretHeading);
    r.turretHeading = wrapAngle(r.turretHeading + clamp(err, -yawStep, yawStep));
  }
  if (wantPitch !== null) {
    const now = r.bbTurretPitch ?? 0;
    r.bbTurretPitch = clamp(now + clamp(wantPitch - now, -pitchStep, pitchStep), BB_TURRET_PITCH_MIN, BB_TURRET_PITCH_MAX);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// THE BOX TUBE — proximity placement into a FLOWER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE PLACEMENT POINT, in the robot frame — the ONE geometry for "where does this robot place
 * into a FLOWER". The sim's reach test reads it, and the sprite and the builder preview are to
 * draw their marker at it, so the marker can never sit somewhere placement does not act from.
 * (Drawing note: the marker lies OUTSIDE the collision footprint by construction, so a sprite
 * must draw it outside its footprint clip, and the preview's viewBox must grow to include it.)
 *
 * `null` without a Box Tube. Otherwise the tube's mount origin PUSHED OUT to the collision
 * footprint on that side (`bbFootprint`, so a sweeper on the same edge counts — the robot cannot
 * get its frame any closer to a FLOWER than its sweeper allows), plus `BB_PLACE_REACH` along
 * `MOUNT_DIR` (a corner mount reaches along the diagonal). An axis the mount does not touch keeps
 * the mount origin's coordinate (0 for an edge mid-point). `center` is never a tube mount.
 */
export function bbPlacePointLocal(spec: RobotSpec): Vec2 | null {
  const lift = bbLiftOf(spec);
  if (!lift) return null;
  const d = MOUNT_DIR[lift.mount];
  const f = bbFootprint(spec);
  const o = mountOrigin(spec, lift.mount);
  const x = d.x > 0 ? f.front : d.x < 0 ? -f.rear : o.x;
  const y = d.y > 0 ? f.half : d.y < 0 ? -f.half : o.y;
  return { x: x + d.x * BB_PLACE_REACH, y: y + d.y * BB_PLACE_REACH };
}

/** `bbPlacePointLocal` in world space, or `null` without a Box Tube. */
export function bbPlacePoint(r: RobotState): Vec2 | null {
  const local = bbPlacePointLocal(r.spec);
  if (!local) return null;
  const off = rot(local, r.heading);
  return { x: r.pos.x + off.x, y: r.pos.y + off.y };
}

/**
 * The index (into `BB_FLOWERS`) of the FLOWER ring nearest this robot's placement point, if one
 * is within `BB_PLACE_TOL` — else `null`. Always `null` for a build with no Box Tube, and in a
 * world that is not a BIOBUZZ match (no `world.biobuzz` bag, so no FLOWER state to place into).
 */
export function bbFlowerInReach(world: World, r: RobotState): number | null {
  if (!world.biobuzz) return null;
  const p = bbPlacePoint(r);
  if (!p) return null;
  let best: number | null = null;
  let bestD = BB_PLACE_TOL * BB_PLACE_TOL;
  for (let i = 0; i < BB_FLOWERS.length; i++) {
    const f = BB_FLOWERS[i];
    const d = (f.x - p.x) ** 2 + (f.y - p.y) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
