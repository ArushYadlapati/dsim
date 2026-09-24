import type { ViewPref } from '../games/biobuzz/graphics/store';

/**
 * WHICH RENDERER A REPLAY OPENS IN.
 *
 * A replay is a match somebody is WATCHING, exactly like the live game — so it should open in
 * the same device preference the live game reads (`decodesim.view.v2`, `GameController.syncScene`)
 * rather than defaulting to the 2D map and making the player ask for 3D on every replay they
 * open. `viewable` folds together the two reasons 3D might not be reachable regardless of the
 * preference: this game has no 3D scene at all (DECODE, Chain Reaction), or — for the export
 * menu's own use of this function — this browser can't give us WebGL2 either. Both cap the same
 * way: stay on 2D, the one renderer guaranteed to draw something.
 *
 * Pure, so the whole table (both prefs × both `viewable` values) is a `npm test` check with no
 * canvas, no WebGL probe and no replay container — see `scripts/smoke.ts`.
 */
export function resolveReplayView(pref: ViewPref, viewable: boolean): '2d' | '3d' {
  return viewable && pref === '3d' ? '3d' : '2d';
}
