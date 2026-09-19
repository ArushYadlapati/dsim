import type { Alliance, Vec2 } from '../../types';
import { BB_HALF_X, BB_TAPE, bbMirror, type BbRect } from './config';

/**
 * THE HUMAN PLAYER'S NECTAR HOLDING BOX — where it is and how big it is.
 *
 * ONE definition, because THREE renderers draw it and they must not drift: the 3D field
 * (`scene/renderField.ts`, a real tray with walls and beads), the 2D top-down field
 * (`drawField.ts`, the same footprint in plan) and anything that later wants to point at it.
 * A second copy of these numbers is a box that is in two places depending on which camera you
 * are looking through, and no check inside either renderer can see that.
 *
 * IT IS `am-5706 Artifact Tray`, the part the CAD itself ships ×2 in the GLB's `stations` node
 * (`docs/biobuzz/field-cad-audit.md`, bbox 71.650, −7.875, −0.589 → 81.900, 7.875, 2.411 →
 * 10.25 × 15.75 × 3.0 in, standing ON the floor outside the wall). The CAD's own two copies stay
 * HIDDEN because their PLACE is what the 2026-09-18 playtest rejected — parked at y = 0, the
 * middle of the wall, a third of the field from the LOADING ZONE they serve.
 *
 * WHY IT IS NOT IN `config.ts`. `config.ts` is the FIELD and the RULES; this box is furniture a
 * renderer puts on the gym floor outside the perimeter. Nothing in `sim3d/`, `play.ts` or
 * `penalties.ts` reads a single number below, and nothing should: the count it displays is read
 * off `world.balls` (`state.kind === 'stock'`) every frame, so the picture cannot drift from the
 * supply even if this file is wrong.
 */

/** the tray's own bbox, in — depth OUT from the wall, length ALONG the wall, outside height.
 * Straight off the `am-5706` measurement above; the bbox's −0.589 is the tray's foot recess
 * below the tile top, so z runs 0 → `BB_BOX_H` here. */
export const BB_BOX_DEPTH = 10.25;
export const BB_BOX_LEN = 15.75;
export const BB_BOX_H = 3.0;
/** floor slab and side-wall thickness, in — APPROX, the one number the bbox cannot give. */
export const BB_BOX_T = 0.5;

/**
 * stand-off from the perimeter face, in.
 *
 * ⚠️ THIS IS BOUNDED ABOVE BY WHAT THE 2D CAMERA SHOWS. `BB_VIEW_MARGIN` is 12 in of outboard
 * room (`config.ts`) and `Camera.configure` fits exactly `halfX + viewMargin`, so a box whose
 * outer face lands past 12 in from the wall is CUT OFF in the 2D view — and cut off at the
 * bottom of the screen, which on a driver's 2D field is where the score bar is. 1.5 + 10.25 =
 * 11.75 leaves a quarter inch. The cost is that the tray's back edge tucks half an inch under
 * the 3D wall's visual skin (`WALL_VIS_T`, a 2-in APPROX block standing in for a ~1-in real
 * perimeter), which is invisible against a 3-in tray.
 */
export const BB_BOX_GAP = 1.5;

/**
 * clear air between the ALLIANCE AREA's outer tape and the box, in.
 *
 * WHERE THE BOX GOES, AND WHY IT IS NOT BESIDE THE LOADING ZONE ANY MORE (owner, 2026-09-19:
 * "it blocks the human player box. Maybe place the human player box off to the left side of the
 * drive team box"). The box used to sit at the LOADING ZONE's own y-centre, which is directly in
 * front of the driver's eye and low in the frame — the same bottom-centre strip of screen the
 * score bar occupies (`.scorebar` is `bottom: -1px; left: 50%; translateX(-50%)`).
 *
 * So it moves ALONG the wall, to just past the ALLIANCE AREA's driver-LEFT tape. "Left" is
 * resolved from the DRIVER's own viewpoint, not the audience's: red's driver stands outside the
 * x = −`BB_HALF_X` wall looking along +x, so the camera's right vector is −y and the driver's
 * LEFT is +y (`renderCameras.ts`'s `forwardOf`, and `Camera.viewAngleOf` for the 2D field, which
 * is the same rotation). Red's LOADING ZONE is at y > 0, so the box lands just outboard of the
 * far end of the zone it serves — a couple of inches past it, not across the field from it.
 *
 * Measured against the driver camera at three aspects, the box's inboard edge moves from 24–28 %
 * of the half-frame left of centre to 38–49 %, which is what takes it out from behind the bar.
 */
export const BB_BOX_AREA_GAP = 1;

/** slots, laid out as DECODE's are (`src/render/drawField.ts`): two columns across the box's
 * depth by three rows along it, filled in reading order. Six cells hold the five `spawn.ts`
 * stages with room to spare, and at this pitch two elements clear each other on both axes — a
 * single row of five inside a 15.75-in box would overlap. A future staging of more than six
 * under-draws beads and is still correct, because the beads are a picture of the supply and the
 * supply itself is counted off `world.balls`. */
export const BB_BOX_COLS = 2;
export const BB_BOX_ROWS = 3;
export const BB_BOX_SLOTS = BB_BOX_COLS * BB_BOX_ROWS;

/** the ALLIANCE AREA's driver-left tape, OUTER face — red's is the +y strip (see above). The
 * CAD's own three gaffer strips (`BB_TAPE.allianceArea`), not a typed-in ±48.41. */
const RED_AREA_LEFT_Y = Math.max(...BB_TAPE.allianceArea.red.map((s) => s.y1));

/**
 * RED IS AUTHORED; BLUE IS `bbMirror`.
 *
 * ⚠️ THE BIOBUZZ LAYOUT IS POINT-SYMMETRIC (180° about the origin), NOT MIRRORED. Red's LOADING
 * ZONE is at y > 0 on the x < 0 wall and blue's is the DIAGONAL opposite, so the x-flip the old
 * code did (`side = a === 'red' ? -1 : 1` with a y read from `BB_LZ[a]`) only happened to land
 * right because it took y from the per-alliance rectangle as well. Written once and rotated, the
 * question cannot come up: the box is on the driver's left for BOTH alliances by construction,
 * and the projection check above lands on the identical screen rectangle for red and blue.
 */
const RED_CENTRE: Vec2 = {
  x: -(BB_HALF_X + BB_BOX_GAP + BB_BOX_DEPTH / 2),
  y: RED_AREA_LEFT_Y + BB_BOX_AREA_GAP + BB_BOX_LEN / 2,
};

/** the box's centre, in field inches. */
export function bbNectarBoxCentre(a: Alliance): Vec2 {
  const p = a === 'red' ? RED_CENTRE : bbMirror(RED_CENTRE);
  return { x: p.x, y: p.y };
}

/** the box's FOOTPRINT — what the 2D field draws, and what the 3D tray is built around. */
export function bbNectarBoxRect(a: Alliance): BbRect {
  const c = bbNectarBoxCentre(a);
  return {
    x0: c.x - BB_BOX_DEPTH / 2,
    x1: c.x + BB_BOX_DEPTH / 2,
    y0: c.y - BB_BOX_LEN / 2,
    y1: c.y + BB_BOX_LEN / 2,
  };
}

/** slot `i`'s centre, in field inches — the same grid in both views, so a 2D driver and a 3D
 * driver count the supply off beads in the same places. */
export function bbNectarBoxSlot(a: Alliance, i: number): Vec2 {
  const col = i % BB_BOX_COLS;
  const row = Math.floor(i / BB_BOX_COLS);
  const p: Vec2 = {
    x: RED_CENTRE.x + (col - (BB_BOX_COLS - 1) / 2) * (BB_BOX_DEPTH / BB_BOX_COLS),
    y: RED_CENTRE.y + (row - (BB_BOX_ROWS - 1) / 2) * (BB_BOX_LEN / BB_BOX_ROWS),
  };
  const q = a === 'red' ? p : bbMirror(p);
  return { x: q.x, y: q.y };
}
