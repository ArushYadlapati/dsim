import { keyLabel, padButtonLabel, type KeyAction, type PadAction } from '../input/bindings';
import type { TutorialHintCtx } from './types';

/**
 * HINTS NAME THE PLAYER'S OWN CONTROLS — the whole point of routing them through
 * `ControlBindings` rather than writing "press SPACE" into a string.
 *
 * Every keyboard action and every pad button in this app is rebindable
 * (`docs/area/ui.md`), and the tutorial is the first thing a new player meets. A hint that
 * names a default the player has already changed is worse than no hint: they press the key it
 * names, nothing happens, and the step they are stuck on is the one that was supposed to
 * teach them the control.
 *
 * ── WHY A PAD WINS WHEN ONE IS CONNECTED ──────────────────────────────────────
 * Somebody holding a controller is not looking at the keyboard, and the in-match overlay
 * already prints both (`GameView`'s "Press ENTER or START to start"). A step card has one
 * line, so it names the device in their hands and says the other one only for the drive
 * step, where both are worth knowing.
 */

/**
 * THE ON-SCREEN BUTTON an action has on a touch pad, where it has one.
 *
 * ⚠️ IT DUPLICATES `GameMobileButton.label` AND IT HAS TO. This module is the shared engine and
 * the TUTORIAL lane asserts that `src/tutorial/` imports no game module — content hangs off the
 * slot, the engine does not reach back through it — so the four labels a tutorial hint can name
 * are written here instead of read off `MobileControls`'s list. They are four short strings that
 * have not changed since the touch pad shipped; a fifth one going out of step shows up as a hint
 * naming a button that is not on screen, which is visible the moment anybody looks at a phone.
 *
 * An action with NO on-screen button (drive-mode, flip-front, park, start, restart) is absent
 * here, and `control` then falls back to the key — the hint that names it is expected to leave
 * that clause out on touch, which is something only the step's own copy can decide.
 */
const TOUCH_LABELS: Partial<Record<KeyAction, string>> = {
  intake: 'INTAKE',
  fire: 'SHOOT',
  catalyst: 'CATALYST',
  fling: 'THROW',
  bbNectar: 'NECTAR',
};

/** the FIRST key bound to an action, as a keycap label, or `—` when it is unbound. */
export function keyFor(ctx: TutorialHintCtx, action: KeyAction): string {
  const k = ctx.bindings.keys[action][0];
  return k === undefined ? 'unbound' : keyLabel(k);
}

/** the FIRST pad button bound to an action, as a face label, or `—` when it is unbound. */
export function padFor(ctx: TutorialHintCtx, action: PadAction): string {
  const b = ctx.bindings.pad.buttons[action][0];
  return b === undefined ? 'unbound' : padButtonLabel(b);
}

/**
 * The control to name for one action: the pad button when a pad is connected, the key
 * otherwise.
 *
 * `pad` is optional because three keyboard actions have no pad twin (the tank right-side
 * pair, and the strafe/turn keys, which a pad does with a stick).
 */
export function control(ctx: TutorialHintCtx, key: KeyAction, pad?: PadAction): string {
  if (ctx.gamepad && pad) return padFor(ctx, pad);
  // a PAD wins over touch: somebody who plugged one into a tablet is holding it, and the
  // on-screen pad is what they stopped using.
  if (ctx.touch && TOUCH_LABELS[key]) return TOUCH_LABELS[key]!;
  return keyFor(ctx, key);
}

/**
 * HOW TO DRIVE, in this player's words.
 *
 * The keyboard form lists the four translation keys and the two turn keys, in the order a
 * driver's hand sits on them, and it reads the bound values so a rebound WASD prints as
 * whatever it is now. The pad form names the stick the player picked for driving
 * (`pad.driveStick`) and says the other one turns, which is the only thing about a pad a
 * driver has to be told.
 */
export function driveHint(ctx: TutorialHintCtx): string {
  if (!ctx.gamepad && ctx.touch) return 'Left stick to drive, right stick to turn';
  if (ctx.gamepad) {
    const drive = ctx.bindings.pad.driveStick === 'left' ? 'left' : 'right';
    const turn = drive === 'left' ? 'right' : 'left';
    return `${drive} stick to drive, ${turn} stick to turn`;
  }
  const k = (a: KeyAction): string => keyFor(ctx, a);
  return `${k('driveUp')}${k('driveLeft')}${k('driveDown')}${k('driveRight')} to drive, ${k('rotateCCW')} and ${k('rotateCW')} to turn`;
}
