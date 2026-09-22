/**
 * BIOBUZZ robot PARTS — the chassis body and the wheels.
 *
 * COPIED AND OWNED from `games/chain/parts.ts`. Nothing is imported from `chain/`, because a
 * game is its own tree: the day BIOBUZZ wants a different frame, or Chain Reaction retunes
 * its own, neither drags the other with it.
 *
 * These live in the game module rather than in `src/render/drawRobot.ts` for the reason that
 * file explains about itself: it draws the DECODE robot, and DECODE's sprite is deliberately
 * frozen to what `main` ships. The richer chassis and the treaded/butterfly wheels are not
 * DECODE's look, and keeping them out here is what lets the DECODE renderer stay
 * byte-identical while every other game keeps evolving.
 *
 * What is drawn here is the part of a robot that is NOT a game mechanism — frame and
 * drivetrain. The mechanisms themselves (sweeper, dumper, turrets, Box Tube) are
 * `drawRobot.ts`'s (canvas) and `RobotPreview.tsx`'s (SVG) job to DRAW, which keeps a mechanism
 * change out of the chassis code. The one exception is `bbBoxTubeGlyph` below: it is GEOMETRY
 * (where a fixture sits and which way it points), not drawing, and both of those renderers need
 * the identical answer — the same reason `mounts.ts` holds `turretLocal` rather than either
 * renderer computing its own.
 */
import type { RobotSpec, RobotState } from '../../types';
import * as C from '../../config';
import { roundRect, strokeInside, tintColor } from '../../render/drawRobot';
import { hyp } from '../../math';
import { MOUNT_DIR, mountOrigin, type BbMountPos } from './mounts';

/**
 * The CHASSIS — an FTC frame seen from above. Deliberately PLAIN: extruded aluminium rails
 * around a base plate, and nothing else. There are no bumpers in FTC (that is FRC), and a
 * painted-on control hub is set dressing that competes with the parts you actually configure.
 * Everything that should draw the eye here is a real subsystem — intake, drivetrain, turret,
 * launcher — so the frame's job is to stay out of their way and give them something to be
 * bolted to.
 *
 * The alliance stays in the OUTLINE, which is where it has always been.
 */
/**
 * The chassis SILHOUETTE line, drawn on the inside of the footprint and drawn LAST.
 *
 * Inside-stroking moved the line a half-width inboard, so anything reaching the true edge —
 * a sweeper bar, DECODE's gate-opener tabs — filled the sliver outside it and read as poking
 * through. Drawn over them it is the boundary of the whole object, which is what an outline
 * is for.
 */
export function drawChassisOutline(ctx: CanvasRenderingContext2D, r: RobotState, color: string): void {
  ctx.strokeStyle = color;
  strokeInside(
    ctx,
    () => roundRect(ctx, -r.spec.length / 2, -r.spec.width / 2, r.spec.length, r.spec.width, C.CHASSIS_CORNER),
    C.CHASSIS_OUTLINE,
  );
}

export function drawChassisBody(
  ctx: CanvasRenderingContext2D,
  r: RobotState,
  fill: string,
  /** draw the contact shadow? Always true in BIOBUZZ — there is no raised terrain a robot
   * could be lifted onto, so the chassis is always on the tile. Kept as a PARAMETER rather
   * than removed: a shadow drawn at a lifted chassis's position while another is drawn at its
   * true footprint on the mat reads as two robots, and that is the bug a future BIOBUZZ ramp
   * would reintroduce the moment someone forgets. */
  shadow = true,
): void {
  const L = r.spec.length;
  const W = r.spec.width;
  const hl = L / 2;
  const hw = W / 2;

  if (shadow) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    roundRect(ctx, -hl + 0.6, -hw + 0.9, L, W, C.CHASSIS_CORNER);
    ctx.fill();
    ctx.restore();
  }

  // base plate. Its OUTLINE is not drawn here — see `drawChassisOutline`, which the caller
  // runs after the mechanisms so the silhouette line sits on top of anything reaching the edge
  ctx.fillStyle = fill;
  roundRect(ctx, -hl, -hw, L, W, C.CHASSIS_CORNER);
  ctx.fill();

  // the FRAME: an inset rail line, which is what a top-down extrusion perimeter actually
  // looks like. One thin stroke — enough to say "this is a built frame, not a tile".
  ctx.strokeStyle = 'rgba(190,205,220,0.16)';
  ctx.lineWidth = 0.32;
  roundRect(ctx, -hl + 1.15, -hw + 1.15, L - 2.3, W - 2.3, 1.0);
  ctx.stroke();
}

/**
 * Draw a robot's DRIVETRAIN wheels in the chassis-local frame (already translated +
 * rotated to the robot). BIOBUZZ's own copy — DECODE draws its own wheels inside its frozen
 * sprite. Mecanum/tank point forward, SWERVE pods steer to `moduleAngles`, X-drive omnis sit
 * at ±45° (an X), and butterfly shows the set that is currently on the floor.
 */
export function drawWheels(ctx: CanvasRenderingContext2D, r: RobotState, color: string, accent: string): void {
  const hl = r.spec.length / 2;
  const hw = r.spec.width / 2;
  const wx = Math.max(hl - C.WHEEL_INSET, 1);
  const wy = Math.max(hw - C.WHEEL_INSET, 1);
  const corners = [
    [wx, wy],
    [wx, -wy],
    [-wx, wy],
    [-wx, -wy],
  ] as const;
  /**
   * ONE WHEEL, drawn as the wheel it actually is. `kind` picks the tread, which is the only
   * thing that distinguishes these from above and is exactly what the drivetrain choice buys:
   *  • traction — a rubber tyre with tread bars ACROSS the roll direction (grip, no strafe)
   *  • mecanum  — barrel rollers at 45 degrees (see drawMecanumRollers)
   *  • omni     — barrel rollers ACROSS the tyre, in a row: rolls freely sideways
   *
   * The tyre's own fill DEFAULTS to the cosmetic `accent` (closure); tread/barrel overlays keep
   * their own structural tone but TINTED toward the accent — see `docs/cosmetics-plan.md` §3.4.
   */
  const drawWheel = (
    px: number,
    py: number,
    ang: number,
    kind: 'traction' | 'omni' | 'plain' = 'plain',
    len = 4.4,
    wid = 2.2,
    fill = accent,
  ): void => {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);
    // tyre
    ctx.fillStyle = fill;
    roundRect(ctx, -len / 2, -wid / 2, len, wid, wid * 0.26);
    ctx.fill();
    ctx.strokeStyle = 'rgba(190,205,220,0.40)';
    ctx.lineWidth = 0.35;
    ctx.stroke();

    ctx.save();
    roundRect(ctx, -len / 2, -wid / 2, len, wid, wid * 0.26);
    ctx.clip(); // tread never bleeds past the rim
    if (kind === 'traction') {
      // tread bars across the roll direction — what gives a traction wheel its grip
      ctx.strokeStyle = tintColor('#cddae8', accent, 0.35, 0.3);
      ctx.lineWidth = 0.3;
      for (let o = -len / 2 + 0.55; o < len / 2; o += 0.9) {
        ctx.beginPath();
        ctx.moveTo(o, -wid / 2);
        ctx.lineTo(o, wid / 2);
        ctx.stroke();
      }
    } else if (kind === 'omni') {
      // the barrels: short rollers set across the tyre, which is what lets an omni slide
      // sideways at all. Drawn as discrete capsules, not a hatch — you can count them.
      ctx.fillStyle = tintColor('#cddae8', accent, 0.35, 0.34);
      for (let o = -len / 2 + 0.62; o < len / 2; o += 1.05) {
        roundRect(ctx, o - 0.26, -wid / 2 + 0.22, 0.52, wid - 0.44, 0.26);
        ctx.fill();
      }
    }
    ctx.restore();

    // hub + axle — a wheel from above is a rectangle, so without this it reads as a block,
    // and the hub gives the eye something to track when the robot spins
    ctx.fillStyle = 'rgba(190,205,220,0.34)';
    ctx.beginPath();
    ctx.arc(0, 0, Math.min(wid * 0.26, 0.62), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  /**
   * MECANUM ROLLERS. A mecanum wheel's rollers sit at 45 degrees to the wheel axis, and the
   * four wheels ALTERNATE by diagonal — FL and BR one way, FR and BL the other — so from above
   * the roller lines form an X. That alternation is not decoration: it is what lets the four
   * wheels' lateral force components add up instead of cancelling, i.e. what makes the drive
   * able to strafe at all. Drawing all four the same way is the classic mecanum render
   * mistake, and it depicts a robot that physically could not strafe.
   * `corners` is [FL, FR, BL, BR] with +x forward and +y left, so the sign of px*py separates
   * the two diagonals exactly (the same test the X-drive branch uses).
   */
  const drawMecanumRollers = (px: number, py: number, len = 4.4, wid = 2.2): void => {
    const s = px * py >= 0 ? 1 : -1; // FL/BR -> "/", FR/BL -> "\\"
    ctx.save();
    ctx.translate(px, py);
    ctx.beginPath();
    ctx.rect(-len / 2, -wid / 2, len, wid);
    ctx.clip(); // the hatch is the wheel's tread — never let it bleed past the rim
    ctx.strokeStyle = tintColor('#c8d6e6', accent, 0.35, 0.55);
    ctx.lineWidth = 0.34;
    const span = len + wid;
    for (let o = -span / 2; o <= span / 2; o += 1.15) {
      ctx.beginPath();
      ctx.moveTo(o - wid / 2, (-s * wid) / 2);
      ctx.lineTo(o + wid / 2, (s * wid) / 2);
      ctx.stroke();
    }
    ctx.restore();
  };

  if (r.spec.drivetrain === 'swerve') {
    // each of the four pods renders at its OWN angle — they visibly swivel + wobble
    corners.forEach(([px, py], i) => {
      const ang = r.moduleAngles[i] ?? 0;
      // steering module housing
      ctx.save();
      ctx.translate(px, py);
      ctx.fillStyle = '#0c1016';
      ctx.fillRect(-2.6, -2.6, 5.2, 5.2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.4;
      ctx.strokeRect(-2.6, -2.6, 5.2, 5.2);
      ctx.restore();
      drawWheel(px, py, ang, 'traction', 4.2, 1.8, accent);
      // a tick showing which way this pod points
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(2.4, 0);
      ctx.stroke();
      ctx.restore();
    });
  } else if (r.spec.drivetrain === 'xdrive') {
    // Omni wheels canted 45°, each one lying ACROSS its corner rather than along it, so the four
    // of them read as the four sides of a DIAMOND.
    //
    // ⚠️ **THIS COPY NEVER GOT THE FIX THE OTHER TWO DID** (found 2026-09-21, doing the wheels).
    // It drew them RADIALLY — `+45°` on the main diagonal is the direction that POINTS AT THE
    // CENTRE — and stretched them to `reach * 1.15` so the resulting X would read. DECODE's
    // `src/render/drawRobot.ts` and Chain Reaction's `src/games/chain/parts.ts` both carry the
    // correction and the reason: a wheel whose force line passes through the centre of mass has
    // no moment arm about it, so four radial omnis could translate and could never yaw. That is
    // not the drive this sim models, and BIOBUZZ — the one game with a 3D view to disagree with —
    // was the one still drawing it. The 3D scene cants by `x * sy >= 0 ? −45° : +45°`; this is now
    // the same expression, and the same 4.4 × 2.2 as every other wheel here (an omni is not a
    // longer wheel; the stretch existed only to prop up the old X).
    for (const [px, py] of corners)
      drawWheel(px, py, px * py >= 0 ? -Math.PI / 4 : Math.PI / 4, 'omni', 4.4, 2.2, accent);
  } else if (r.spec.drivetrain === 'butterfly') {
    // BUTTERFLY: draw the set that is actually DOWN, and show the other one STOWED. The
    // deployed wheels are full-size and lit; the stowed set is a thin dim bar tucked just
    // inboard of them — so a glance tells you whether you have strafe or push right now.
    const tank = r.butterflyTank;
    for (const [px, py] of corners) {
      // stowed set: a slim inboard bar (lifted off the floor, so it reads as inert)
      ctx.save();
      ctx.translate(px - Math.sign(px) * 1.5, py);
      ctx.fillStyle = 'rgba(120,134,150,0.32)';
      ctx.fillRect(-1.7, -0.7, 3.4, 1.4);
      ctx.restore();
      // deployed set: traction wheels read SOLID, the mecanum set gets the real
      // alternating 45° roller hatch (same helper the mecanum drivetrain uses)
      drawWheel(px, py, 0, tank ? 'traction' : 'plain', undefined, undefined, accent);
      if (!tank) drawMecanumRollers(px, py);
    }
  } else {
    for (const [px, py] of corners) {
      // TANK runs traction wheels (tread, no strafe); mecanum's tread is its 45 degree rollers
      drawWheel(px, py, 0, r.spec.drivetrain === 'tank' ? 'traction' : 'plain');
      // MECANUM is the only remaining drivetrain with rollers; tank's traction wheels
      // stay plain, which is now a meaningful visual difference rather than an accident.
      if (r.spec.drivetrain === 'mecanum') drawMecanumRollers(px, py);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BOX TUBE — the static glyph both renderers draw at the tube's mount
// ─────────────────────────────────────────────────────────────────────────────

/** the drawn tube's section width and length along its mount direction (in). DRAWING sizes,
 * not hardware: the Box Tube has no raise and no modelled length (`bbPlacePointLocal`,
 * `robot.ts`, is the only geometry the sim reads), so these only have to read as "a length of
 * box tube bolted to this edge" and stay clear of a turret ring at the neighbouring cell. */
export const BB_BOX_TUBE_W = 1.1;
export const BB_BOX_TUBE_LEN = 2.2;
/** how far inside the frame rail the tube's outer end sits, per axis the mount touches (in) */
const BB_BOX_TUBE_INSET = 0.7;
/** how far back over the glyph the REACH section (glyph outer end → placement ring) starts (in),
 * so the two draw as one continuous tube across the frame rail — both renderers */
export const BB_BOX_TUBE_OVERLAP = 0.3;
/** the placement-point marker's ring radius (in) — both renderers */
export const BB_PLACE_MARK_R = 1.0;

/**
 * THE BOX TUBE GLYPH, in the robot frame: a short tube lying along the mount's outward
 * direction (`MOUNT_DIR`), its OUTER end just inside the frame rail at the mount cell.
 *
 * `outer` is where the reach line to the placement point starts; `ux`/`uy` is the outward unit
 * vector (a corner mount lies along the 45° diagonal, as every corner mechanism does). Pulled
 * inboard PER AXIS the mount touches, the same rule `turretLocal` uses, so a corner tube never
 * hangs off either rail. `center` is not a tube mount; it reads as the front edge.
 *
 * `toward` is the placement point (`bbPlacePointLocal`). When given, the tube is AIMED at it, so
 * the stub inside the frame and the reach out to the ring are one straight length. On an edge
 * mount that is `MOUNT_DIR` anyway; on a corner the footprint can grow unevenly (a sweeper on one
 * axis only) and the point sits off the 45° line, which drew the tube with a bend at the rail.
 */
export function bbBoxTubeGlyph(
  spec: Pick<RobotSpec, 'length' | 'width'>,
  mount: BbMountPos,
  toward?: { x: number; y: number } | null,
): { cx: number; cy: number; ux: number; uy: number; len: number; w: number; outer: { x: number; y: number } } {
  const pos: BbMountPos = mount === 'center' ? 'front' : mount;
  const o = mountOrigin(spec, pos);
  const d = MOUNT_DIR[pos];
  const outer = { x: o.x - Math.sign(d.x) * BB_BOX_TUBE_INSET, y: o.y - Math.sign(d.y) * BB_BOX_TUBE_INSET };
  let ux = d.x;
  let uy = d.y;
  if (toward) {
    // `hyp`, not `Math.hypot`: this runs in sim code, and `Math.hypot` is one of the calls
    // whose result is engine-defined, so a host and a guest on different browsers can
    // disagree in the last bit and desync. `hyp` was already imported here.
    const k = hyp(toward.x - outer.x, toward.y - outer.y);
    if (k > 1e-6) {
      ux = (toward.x - outer.x) / k;
      uy = (toward.y - outer.y) / k;
    }
  }
  return {
    cx: outer.x - (ux * BB_BOX_TUBE_LEN) / 2,
    cy: outer.y - (uy * BB_BOX_TUBE_LEN) / 2,
    ux,
    uy,
    len: BB_BOX_TUBE_LEN,
    w: BB_BOX_TUBE_W,
    outer,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// WHICH END IS THE FRONT — the one language, read by BOTH renderers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ **A SYMMETRIC ROBOT HAS NO FRONT, AND THE PICTURE HAS TO GIVE IT ONE** (owner, 2026-09-22:
 * "somehow make it clearer fundamentally which side is front and which is back in game. This is
 * especially confusing in a symmetric robot in 3D").
 *
 * What was there: 2D drew a small chevron at the rear in the ALLIANCE colour, and 3D drew a
 * 0.7 × 22%-width white block on the front cross member. Both fail the case that prompted this —
 * a `frontback` sweeper with a `center` turret is mirror-symmetric, so the only asymmetric thing
 * on it was a 0.7-in block that is invisible at match camera distance and behind the intake from
 * the one angle you would look for it. The 2D chevron had the second problem: it was drawn in the
 * alliance colour, so "red at that end" competed with "red team" for the same cue.
 *
 * ── THE LANGUAGE ────────────────────────────────────────────────────────────
 * Three marks, the same three in both renderers, none of them in an alliance colour:
 *  1. a **LIGHT BAR** across the FULL front edge, near-white (`BB_FRONT_INK`) — headlights, the
 *     most-read "this end goes first" signal there is, and full-width so it survives being
 *     partly occluded by whatever is mounted up front;
 *  2. a **CHEVRON** on the deck pointing forward, in the same near-white, sitting just ahead of
 *     the rear bar where no mechanism is ever drawn (the front third belongs to the intake and
 *     the turret; an arrow there is under something on half the builds);
 *  3. a **HAZARD BAR** across the FULL rear edge, near-black with amber ticks — the back of a
 *     truck. The pair is what carries it: the arrow points AWAY from the striped end.
 *
 * Colours are CATEGORY 3 (CLAUDE.md THEMING: the ground is the canvas and the field is hardcoded
 * dark), so none of them themes. Amber rather than a second white because the rear has to read as
 * a different KIND of mark, not a dimmer one; it is a ticked pattern on near-black and never a
 * disc, so it does not compete with a POLLEN (`#f2d14b`).
 *
 * ── IT FOLLOWS THE SIM'S FRONT, NOT THE DRIVER'S "REVERSED" ─────────────────
 * Flip-front is an INPUT transform (`GameController`); it rotates the stick, never `r.heading`,
 * and the HUD already says REVERSED. The mark stays on the sim's +x for three reasons: the sim's
 * front is what the intake, the shooter and every collider are measured from, so a mark that
 * moved would disagree with the hardware it is drawn next to; a match has four other people
 * looking at the same robot (and a replay has any number), and only one of them pressed the
 * button; and in 3D the robot is ONE group in a shared scene graph — there is no per-viewer
 * variant of a mesh. REVERSED is a property of a driver's stick, not of the machine.
 */
export const BB_FRONT_INK = '#f8fafc';
export const BB_REAR_INK = '#11151b';
export const BB_HAZARD_INK = '#f59e0b';
/** bar thickness along the robot's own x (in), and how far in from each rail the bars stop so
 *  they never fight `C.CHASSIS_CORNER`'s rounding. DRAWING sizes. */
export const BB_END_BAR_T = 0.9;
export const BB_END_BAR_INSET = 1.0;
/** the deck chevron (in): how far ahead of the rear bar its base sits, its length and its
 *  half-width. Sized to read at the ~8 px/in the match camera gives a 2D sprite — and kept SHORT
 *  and WIDE, tucked against the rear bar, because a `center` turret's ring covers the middle of
 *  the deck on every chassis and a longer arrow disappeared under it in the first captures. */
export const BB_FRONT_ARROW_GAP = 0.6;
export const BB_FRONT_ARROW_LEN = 2.8;
export const BB_FRONT_ARROW_HALF = 3.0;
/** how many amber ticks the rear bar carries */
export const BB_HAZARD_TICKS = 5;
/** 3D ONLY: how far the two end bars stand above the deck, and how thick the extruded deck arrow
 *  is (in). The bars are deliberately TALL enough to break the chassis silhouette from a chase
 *  camera — flush with the deck they were invisible from behind, which is the view a driver
 *  spends the match in. 1.8 puts the top at 6.4, clear of the 5.3 (`BB3_CHASSIS_TOP_Z`) the whole
 *  LOW BODY is drawn under, so a sweeper roller at either end cannot hide the mark on that end —
 *  measured from offscreen captures, 1.1 sat inside the roller's own envelope and a `frontback`
 *  build, which is the symmetric case the report is about, hid BOTH marks from a chase camera.
 *  Neither is a collider; see `buildFrontMarks`. */
export const BB_END_BAR_H = 1.8;
export const BB_FRONT_ARROW_T = 0.12;
/** 3D ONLY: how far the rear bar's amber ribs stand proud of its dark core (in). The CORE is
 *  inset by it rather than the ribs raised, so the pair's envelope is exactly the bar and the
 *  ribs never poke past the rail or under the deck. */
export const BB_HAZARD_PROUD = 0.06;

/**
 * The three marks in the ROBOT frame (+x forward), as plain numbers — no canvas, no three.js.
 * ONE derivation, so the 2D sprite and the 3D chassis cannot drift apart about which end is
 * which, the same bargain `bbBoxTubeGlyph` already makes for the tube.
 *
 * `front`/`rear` are bars `[x0, x1] × [−halfY, halfY]`; `arrow` is the chevron's three points.
 */
export function bbFrontMarks(spec: Pick<RobotSpec, 'length' | 'width'>): {
  front: { x0: number; x1: number; halfY: number };
  rear: { x0: number; x1: number; halfY: number };
  arrow: { apex: number; base: number; half: number };
} {
  const hl = spec.length / 2;
  const halfY = Math.max(0.5, spec.width / 2 - BB_END_BAR_INSET);
  const base = -hl + BB_END_BAR_T + BB_FRONT_ARROW_GAP;
  return {
    front: { x0: hl - BB_END_BAR_T, x1: hl, halfY },
    rear: { x0: -hl, x1: -hl + BB_END_BAR_T, halfY },
    arrow: { apex: base + BB_FRONT_ARROW_LEN, base, half: Math.min(BB_FRONT_ARROW_HALF, halfY) },
  };
}
