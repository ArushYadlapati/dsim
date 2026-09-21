import type { World } from '../../types';
import type { SceneOverlayView } from '../module';
import { drawBiobuzzFlowerSections } from './drawField';

/**
 * THE FLOWER CONTENTS READ-OUT, OVER THE 3D TOP-DOWN SHOT (owner, 2026-09-21: "for the top down
 * view of the 3d render, add a separate thing (like the 2d display) that shows inside the
 * flower").
 *
 * ── WHAT THE 2D DISPLAY SAYS, AND WHY THE 3D VIEW HAD NOTHING ──────────────────────────────
 * A FLOWER is a 21.5-in column and its contents are the one part of this game a plan view cannot
 * show: four discs seen from above are four discs whatever height they are at, and the HEIGHT is
 * the whole rule (a POLLEN below the middle ring scores nothing; a NECTAR seats on it and always
 * does; the bottom-most element decides whether anybody can retrieve at all). So the 2D renderer
 * draws a SECTION beside each flower, outside the perimeter, in the camera's own view margin —
 * the column cut open, at 1:1 with the field's inches, with the scoring volume shaded, the two
 * rings drawn, the top ring stroked in the owning alliance's colour, the elements at their real
 * heights and radii, and a padlock under the base when G418 has shut the gate.
 *
 * The 3D overhead camera has the SAME problem and one more: the flower's own top plate is a solid
 * disc between the camera and the column, so a driver on that shot cannot even count what is in
 * there, let alone read the order.
 *
 * ── AND IT IS THE SAME DRAWING, NOT A SECOND ONE ───────────────────────────────────────────
 * This file works out ONE affine transform and then calls `drawBiobuzzFlowerSections`, the very
 * function the 2D field renderer calls. Nothing about the section — the geometry, the ordering,
 * the ownership colour, the lock, the stacking heights — is written twice, so the two views
 * cannot drift and neither can drift from the SCORER (that function's own header carries the
 * argument: the section is driven by `flowerStackZ`/`flowerScore`/`flowerRetrieve`, the three
 * functions the points are computed through).
 *
 * ── WHY AN AFFINE TRANSFORM IS LEGITIMATE HERE, AND ONLY HERE ──────────────────────────────
 * `Renderer.drawProjectedOverlay`'s own header says the opposite in as many words — "a
 * perspective camera is not an affine map, so there is no `ctx.setTransform` that could draw this
 * correctly" — and it is right about the driver, chase, orbit and free cameras. The OVERHEAD
 * camera is not one of those: it is a `THREE.OrthographicCamera` at (0, 0, 800) looking straight
 * down, whose `up` is the driver's own screen-up (`renderCameras.ts`'s `updateOverhead`). An
 * orthographic projection of a PLANE is affine exactly, and this read-out is drawn entirely on
 * the z = 0 plane, so three projected points recover the map with nothing left over.
 *
 * It is not ASSUMED, though: a fourth point is projected and compared, and a disagreement past
 * `AFFINE_TOL` draws nothing at all. That is what makes this safe against a future overhead
 * camera that grows a perspective or a tilt — it would stop drawing rather than draw the sections
 * in the wrong places.
 *
 * ── OVERHEAD ONLY, AND WHY ─────────────────────────────────────────────────────────────────
 * On the driver, chase, orbit and free cameras the flower is a TRANSPARENT structure seen from
 * the side: its bores are open, the elements inside are visible, and their heights — the thing
 * the section exists to say — are read directly off the picture. A section panel there would be
 * four opaque cards standing on the field, covering the tiles a driver is aiming across, to
 * repeat what is already on screen. The PiP minimap is the other overhead shot in this game and
 * is deliberately left out too: it is 120–260 px across, which puts a whole 21.5-in column inside
 * about eight pixels — the discs would be sub-pixel and the lock glyph invisible, and the panels
 * would eat the corner of the frame they are inset into.
 *
 * ── REPLAYS AND THE VIDEO EXPORT ───────────────────────────────────────────────────────────
 * Nothing special. It is drawn in the overlay pass, which the export composites onto its own
 * sheet and burns in (§4.7), and it reads `World` alone — no session, no local player, no
 * clock — so a replay of somebody else's match draws exactly what the driver saw. It costs
 * NOTHING in the 2D view: `drawOverlays` is called there with no `view` at all and returns on the
 * first line.
 */

/** how far, in CSS pixels, a fourth projected point may disagree with the affine map recovered
 * from the first three before this gives up. A pixel is far tighter than any camera change that
 * would actually break the assumption (a degree of tilt across a 141-in field is tens of pixels)
 * and far looser than the float noise of two matrix multiplies. */
const AFFINE_TOL = 1;

/** the baseline the map is recovered over, in field inches. Big enough that float noise in a
 * projection is a rounding error against it, small enough to stay well inside the frustum on
 * every aspect — the field is ±70.674. */
const BASIS = 60;

/** `project`'s out-parameter shape — module scope, rewritten per call, so this allocates nothing
 * per frame (the same contract `Renderer.projOut` follows). */
const p0 = { x: 0, y: 0, visible: false };
const p1 = { x: 0, y: 0, visible: false };
const p2 = { x: 0, y: 0, visible: false };
const p3 = { x: 0, y: 0, visible: false };

export function drawBiobuzzFlowerReadout(
  ctx: CanvasRenderingContext2D,
  world: World,
  view: SceneOverlayView,
): void {
  if (view.camera !== 'overhead') return;

  // ── recover the world(x, y, 0) → CSS-pixel map from three points on the floor ─────────────
  view.project(0, 0, 0, p0);
  view.project(BASIS, 0, 0, p1);
  view.project(0, BASIS, 0, p2);
  const a = (p1.x - p0.x) / BASIS;
  const b = (p1.y - p0.y) / BASIS;
  const c = (p2.x - p0.x) / BASIS;
  const d = (p2.y - p0.y) / BASIS;
  // a degenerate basis means the camera is edge-on to the floor (or `project` refused the
  // points) — there is no map to draw through and nothing sensible to fall back to
  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return;

  // ── and CHECK it, rather than assume the projection is affine (see the header) ────────────
  view.project(-BASIS, -BASIS, 0, p3);
  const wantX = p0.x - a * BASIS - c * BASIS;
  const wantY = p0.y - b * BASIS - d * BASIS;
  if (Math.abs(p3.x - wantX) > AFFINE_TOL || Math.abs(p3.y - wantY) > AFFINE_TOL) return;

  // The overlay context arrives at the plain DPR scale and `project` answers in CSS pixels, so
  // the device-space transform is the recovered map times the ratio. Every line width, radius and
  // dash in `drawFlowerSection` is in FIELD INCHES and scales with it — which is the whole reason
  // the drawing can be shared: the section is 1:1 with the field in both views by construction,
  // not by two sets of numbers that happen to match.
  const k = view.dpr;
  ctx.setTransform(a * k, b * k, c * k, d * k, p0.x * k, p0.y * k);
  drawBiobuzzFlowerSections(ctx, world);
}
