/**
 * THE VIEW KEY — `viewToggle` (T by default) cycles 2D ⇄ 3D, from OUTSIDE the scene (`docs/biobuzz/plan-3d.md` §4.3).
 *
 * ── WHY IT CANNOT LIVE IN THE SCENE, WHICH IS WHERE IT STARTED ─────────────────────────────
 * `scene/renderScene.ts` bound `t` itself on Day 2 and could only ever go 3D → 2D, because the
 * listener is installed by the scene and the scene is torn down the instant the view becomes
 * 2D. There is then nothing listening, and the key is dead in exactly the direction a player
 * needs it: they are looking at the flat map and want the 3D one back. Its own header said so.
 *
 * ── WHY A REFERENCE COUNT AND ONE SHARED LISTENER ──────────────────────────────────────────
 * Several places legitimately want the key live at the same time — the mounted scene, the touch
 * controls, the Graphics section — and three independent `keydown` handlers would each toggle
 * the view on one press, which nets to no change on an odd count and chaos on an even one.
 * So: ONE window listener, installed on the first `installViewKey()` and removed when the last
 * handle is released. Calling it twice is therefore safe and is the expected case.
 *
 * ── THE KEYS ARE BINDINGS NOW (owner, 2026-09-24) ─────────────────────────────────────────
 * `t` here and `c`/`i`/`o` in the scene were hard-coded and missing from Controls, and `c`
 * also placed POLLEN, so one press did both. They are the four `VIEW_ACTIONS` in
 * `src/input/bindings.ts` now, rebindable with a row each. This module holds the player's binds
 * for them (`setViewBindings`, kept current by the App), and `viewActionOf` is the one reader,
 * for this listener and for the scene's.
 */

import { DEFAULT_BINDINGS, VIEW_ACTIONS, keyName, type KeyAction, type ViewAction } from '../../../input/bindings';
import { getViewPref, setViewPref } from './store';

let viewKeys: Record<ViewAction, readonly string[]> = pickViewKeys(DEFAULT_BINDINGS.keys);

function pickViewKeys(keys: Record<KeyAction, readonly string[]>): Record<ViewAction, readonly string[]> {
  const out = {} as Record<ViewAction, readonly string[]>;
  for (const a of VIEW_ACTIONS) out[a] = [...keys[a]];
  return out;
}

/** adopt the player's binds (the MAIN map: view actions are BIOBUZZ-only, so never overridden) */
export function setViewBindings(keys: Record<KeyAction, readonly string[]>): void {
  viewKeys = pickViewKeys(keys);
}

/** the key a player reads for `action` ("T"), or null when it is unbound — for copy that names it */
export function viewKeyName(action: ViewAction): string | null {
  const k = viewKeys[action][0];
  return k === undefined ? null : keyName(k);
}

/** which view action `e` presses, if any — null under a modifier or while typing */
export function viewActionOf(e: KeyboardEvent): ViewAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (typingInto(e.target)) return null;
  const k = e.key.toLowerCase();
  return VIEW_ACTIONS.find((a) => viewKeys[a].includes(k)) ?? null;
}

let refs = 0;
let attached: ((e: KeyboardEvent) => void) | null = null;
/** the target the ONE listener actually went on — the first caller's. A later caller naming a
 * different target still shares that listener (the key is a global command, not a per-widget
 * one), so the removal has to use this and not whatever the last release happened to pass. */
let attachedTo: EventTarget | null = null;

/** typing a team name, a chat line or a rebind capture is never a view command. */
function typingInto(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName));
}

/** flip the device's view preference. Exported because the touch button and the Graphics
 * section press the same thing the key does, and two spellings of "toggle" is how they drift. */
export function toggleViewPref(): void {
  setViewPref(getViewPref() === '3d' ? '2d' : '3d');
}

/**
 * Arm the key. Returns the RELEASE function — call it on unmount/dispose, exactly like every
 * other subscription in this directory.
 *
 * `target` defaults to `window`: a listener on the canvas would only fire while the canvas has
 * focus, and the canvas is not focusable. It is a parameter anyway so a harness (the scene
 * preview page, a test) can scope it to its own root.
 */
export function installViewKey(target: EventTarget = typeof window !== 'undefined' ? window : ({} as EventTarget)): () => void {
  if (typeof target.addEventListener !== 'function') return () => {};
  refs++;
  if (!attached) {
    attached = (e: KeyboardEvent): void => {
      if (viewActionOf(e) === 'viewToggle') toggleViewPref();
    };
    attachedTo = target;
    target.addEventListener('keydown', attached as EventListener);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    refs--;
    if (refs <= 0) {
      refs = 0;
      if (attached && attachedTo) attachedTo.removeEventListener('keydown', attached as EventListener);
      attached = null;
      attachedTo = null;
    }
  };
}
