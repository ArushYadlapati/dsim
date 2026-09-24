/**
 * FIELD OF VIEW — the slider is HORIZONTAL degrees, and a camera turns it into the VERTICAL FOV
 * `three` takes for its own screen shape (owner, 2026-09-24: "For the fov slider, keep human fov
 * in mind").
 *
 * Horizontal because that is the figure human vision and every game quote, and because it is
 * the one that means the same thing on every screen. The old slider was 60–90° VERTICAL, which is
 * 91–121° across on a 16:9 screen but 150° on a 21:9 one: past the ~120° that both human eyes see
 * together, so an ultrawide player got a fish-eye view no person has. `GFX_FOV_MAX` is that 120.
 *
 * Pure math, DOM-free, no `three` (the rule every `graphics/` file keeps), and `dtan`/`datan`
 * rather than engine trig: `scripts/smoke.ts`'s source guard scans this directory.
 */

import { datan, dtan } from '../../../math';

/** the horizontal field both human eyes see together, degrees — the slider's ceiling */
export const HUMAN_BINOCULAR_HFOV_DEG = 120;

const RAD = Math.PI / 180;

/** the VERTICAL FOV (degrees) that shows `hDeg` across a screen of `aspect` (width / height) */
export function vFovFromH(hDeg: number, aspect: number): number {
  const a = Math.max(1e-3, aspect);
  return (2 * datan(dtan((hDeg * RAD) / 2) / a)) / RAD;
}

/** the HORIZONTAL FOV (degrees) a vertical `vDeg` shows across a screen of `aspect` */
export function hFovFromV(vDeg: number, aspect: number): number {
  const a = Math.max(1e-3, aspect);
  return (2 * datan(dtan((vDeg * RAD) / 2) * a)) / RAD;
}
