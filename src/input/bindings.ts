/** user-customizable control bindings: keyboard keys per action, gamepad
 * button indices per action, and which stick drives. Escape is reserved
 * (menu / cancel capture) and never bindable. */

export type KeyAction =
  | 'driveUp'
  | 'driveDown'
  | 'tankRightUp'
  | 'tankRightDown'
  | 'driveLeft'
  | 'driveRight'
  | 'rotateCCW'
  | 'rotateCW'
  | 'intake'
  | 'fire'
  | 'catalyst'
  | 'fling'
  | 'bbPlaceNectar'
  | 'bbPlace'
  | 'bbNectar'
  | 'driveMode'
  | 'flipFront'
  | 'park'
  | 'start'
  | 'restart';

export type PadAction =
  | 'fire'
  | 'intake'
  | 'catalyst'
  | 'fling'
  | 'bbPlaceNectar'
  | 'bbPlace'
  | 'bbNectar'
  | 'driveMode'
  | 'flipFront'
  | 'park'
  | 'start'
  | 'restart';

/**
 * A COMBO: several standard-mapping buttons that must ALL be held to fire the action, the
 * way real drive-team code reads `gamepad.dpad_up && gamepad.right_trigger > 0.5`. Stored
 * CANONICAL — ascending, unique, `2..PAD_CHORD_MAX` long — so two combos compare by
 * `chordKey` and a label reads the same wherever it is printed. A single button is NOT a
 * one-long combo: it lives in `PadBindings.buttons`, exactly where it always has.
 */
export type PadChord = number[];

/** the most buttons one combo may hold. Three is what a hand can press together while the
 * other thumb keeps driving; a wider chord is a party trick, not a control. */
export const PAD_CHORD_MAX = 3;

/**
 * THE COMBO WAIT (`PadBindings.chordGraceMs`): how long a button that is also part of a combo
 * is held back before it fires on its own, so the second button of the combo has time to
 * land (`padChords.ts` rule 2). 80 ms is a comfortable margin for a thumb, not a measurement;
 * the slider bounds it because both ends are failures — under ~20 ms the lift fires a shot
 * again for anyone who presses slowly, and past 200 ms Shoot has visible lag for everyone
 * who bound RT into a combo.
 */
export const PAD_CHORD_GRACE_MS = 80;
export const PAD_CHORD_GRACE_MIN_MS = 20;
export const PAD_CHORD_GRACE_MAX_MS = 200;

export interface PadBindings {
  /** which stick translates the robot — the other stick's X axis turns */
  driveStick: 'left' | 'right';
  /** standard-mapping button indices per action */
  buttons: Record<PadAction, number[]>;
  /**
   * combos per action (see `PadChord`). SEPARATE from `buttons` on purpose, and not the
   * obvious `number[][]` in its place: a settings blob is persisted and account-synced
   * VERBATIM, so an older client reading `buttons` full of arrays would reject every pad
   * binding and, on its next save, write the defaults back over them. Kept apart, an older
   * client ignores this field and the singles keep working; only a combo is beyond it.
   */
  combos: Record<PadAction, PadChord[]>;
  /** radial stick deadzone, 0-0.4 (fraction of full travel ignored near center) */
  deadzone: number;
  /** sensitivity curve exponent applied to stick input past the deadzone: 1 =
   * linear, higher = softer/more precise near center, ramping to full at the
   * stick's edge (classic RC/gaming "expo" curve) */
  curve: number;
  /** analog trigger press threshold, 0.1-0.9 (LT/RT register as "held" past this) */
  triggerThreshold: number;
  /** the combo wait in ms, `PAD_CHORD_GRACE_MIN_MS..PAD_CHORD_GRACE_MAX_MS` (see the constant) */
  chordGraceMs: number;
}

export interface ControlBindings {
  /** `KeyboardEvent.key.toLowerCase()` values per action */
  keys: Record<KeyAction, string[]>;
  pad: PadBindings;
}

export const KEY_ACTIONS: KeyAction[] = [
  'driveUp',
  'driveDown',
  'tankRightUp',
  'tankRightDown',
  'driveLeft',
  'driveRight',
  'rotateCCW',
  'rotateCW',
  'intake',
  'fire',
  'catalyst',
  'fling',
  'bbPlaceNectar',
  'bbPlace',
  'bbNectar',
  'driveMode',
  'flipFront',
  'park',
  'start',
  'restart',
];

export const PAD_ACTIONS: PadAction[] = [
  'fire',
  'intake',
  'catalyst',
  'fling',
  'bbPlaceNectar',
  'bbPlace',
  'bbNectar',
  'driveMode',
  'flipFront',
  'park',
  'start',
  'restart',
];

const NO_COMBOS = (): Record<PadAction, PadChord[]> => {
  const out = {} as Record<PadAction, PadChord[]>;
  for (const a of PAD_ACTIONS) out[a] = [];
  return out;
};

export const DEFAULT_BINDINGS: ControlBindings = {
  keys: {
    driveUp: ['w'],
    driveDown: ['s'],
    // TANK steers as two sides: `driveUp`/`driveDown` are the LEFT track and these are the
    // RIGHT one. They exist as actions because the right side used to read `arrowup`/
    // `arrowdown` straight off the keyboard — the one pair of controls in the game that
    // ignored the rebinder, so reassigning the arrows left them driving half the chassis AND
    // firing whatever they had been moved to. The defaults are the keys that were hard-coded.
    tankRightUp: ['arrowup'],
    tankRightDown: ['arrowdown'],
    driveLeft: ['a'],
    driveRight: ['d'],
    rotateCCW: ['arrowleft', 'q'],
    rotateCW: ['arrowright', 'e'],
    intake: ['shift', 'k'],
    fire: [' '],
    catalyst: ['c'],
    // CATAPULT throw (launcher catalyst mechanism) — its OWN button, so it is never
    // ambiguous with the claw's grab/place on the same press.
    fling: ['v'],
    // BIOBUZZ Box Tube: place a held NECTAR into the FLOWER in reach. 'x' and 'z' extend the
    // bottom-row mechanism cluster (c / v / b) leftward, so every mechanism button sits on one
    // row under the drive hand; both were free on the default map.
    bbPlaceNectar: ['x'],
    // BIOBUZZ Box Tube: place a held POLLEN into the FLOWER in reach.
    bbPlace: ['z'],
    // BIOBUZZ HUMAN PLAYER: enter one NECTAR into the alliance's own LOADING ZONE. 'n' for
    // nectar, and deliberately NOT on the c/v/b/x/z mechanism row: this is the one button that
    // does something to the ALLIANCE rather than to the robot, and it is pressed at a cue
    // rather than in the drive rhythm, so it sits away from the cluster a thumb sweeps.
    bbNectar: ['n'],
    // BUTTERFLY: drop the other wheel set. 'b' for butterfly; free on the default map.
    driveMode: ['b'],
    flipFront: ['f'],
    park: ['p'],
    start: ['enter'],
    restart: ['r'],
  },
  pad: {
    driveStick: 'left',
    buttons: {
      fire: [7, 0], // RT or A
      intake: [6, 1], // LT or B
      catalyst: [4], // LB
      fling: [10], // L3 (left stick click)
      // D-DOWN — place a NECTAR. The pair sits on the d-pad because placement is a MOMENTARY
      // press, which can afford to cost the drive thumb its stick; every trigger, bumper and
      // face button was already taken. RS (11) is free again.
      bbPlaceNectar: [13],
      // D-UP — place a POLLEN.
      bbPlace: [12],
      // D-LEFT. It is NOT on D-DOWN, which this lane originally took: Lane B's placement pair
      // landed on D-UP/D-DOWN in the same round, and two actions on one index is a silent
      // double-fire, not a conflict the rebinder reports. The d-pad is still the right home —
      // a MOMENTARY press can afford the drive thumb leaving its stick for an instant — and
      // this button keeps its own direction, one step away from the pair it must not be
      // confused with. RS (11) stays free.
      bbNectar: [14],
      driveMode: [5], // RB — the only unused face/shoulder button
      flipFront: [3], // Y
      park: [2], // X
      start: [9],
      restart: [8], // Back / Select / View
    },
    // NO DEFAULT COMBO. The pad has sixteen buttons and twelve actions, so the default map
    // fits without one; combos are for the player who has run out, or who wants the layout
    // their real drive-team code uses.
    combos: NO_COMBOS(),
    deadzone: 0.12,
    curve: 1,
    triggerThreshold: 0.35,
    chordGraceMs: PAD_CHORD_GRACE_MS,
  },
};

export function cloneBindings(b: ControlBindings): ControlBindings {
  const keys = {} as Record<KeyAction, string[]>;
  for (const a of KEY_ACTIONS) keys[a] = [...b.keys[a]];
  const buttons = {} as Record<PadAction, number[]>;
  const combos = {} as Record<PadAction, PadChord[]>;
  for (const a of PAD_ACTIONS) {
    buttons[a] = [...b.pad.buttons[a]];
    combos[a] = b.pad.combos[a].map((c) => [...c]);
  }
  return {
    keys,
    pad: {
      driveStick: b.pad.driveStick,
      buttons,
      combos,
      deadzone: b.pad.deadzone,
      curve: b.pad.curve,
      triggerThreshold: b.pad.triggerThreshold,
      chordGraceMs: b.pad.chordGraceMs,
    },
  };
}

const isButtonIndex = (i: unknown): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < 32;

/**
 * A combo from untrusted input — a stored blob, or the capture screen's own set — in its
 * canonical form, or `null` for anything that is not two to `PAD_CHORD_MAX` distinct buttons.
 * Duplicates are folded BEFORE the length test, so `[7, 7]` is a single and not a combo.
 */
export function normalizeChord(raw: unknown): PadChord | null {
  if (!Array.isArray(raw) || !raw.every(isButtonIndex)) return null;
  const sorted = [...new Set(raw as number[])].sort((a, b) => a - b);
  if (sorted.length < 2 || sorted.length > PAD_CHORD_MAX) return null;
  return sorted;
}

/** identity of a chord — what "the same combo" means to the steal policy */
export function chordKey(c: PadChord): string {
  return c.join('+');
}

/**
 * EVERYTHING that fires an action, singles first and then combos, each as a chord — the one
 * view the resolver, the labels and the tutorial hints read, so none of them has to know that
 * singles and combos are stored apart. A slot index on the controls screen indexes THIS list.
 */
export function padBinds(pad: PadBindings, action: PadAction): PadChord[] {
  return [...pad.buttons[action].map((i) => [i]), ...pad.combos[action]];
}

/** validate a possibly-stale/corrupt saved value field by field; anything
 * that doesn't check out falls back to the default for that action */
export function mergeBindings(saved: unknown): ControlBindings {
  const out = cloneBindings(DEFAULT_BINDINGS);
  if (typeof saved !== 'object' || saved === null) return out;
  const s = saved as { keys?: unknown; pad?: unknown };
  if (typeof s.keys === 'object' && s.keys !== null) {
    const keys = s.keys as Record<string, unknown>;
    for (const a of KEY_ACTIONS) {
      const v = keys[a];
      if (Array.isArray(v) && v.every((k) => typeof k === 'string' && k !== 'escape')) {
        out.keys[a] = v.map((k: string) => k.toLowerCase());
      }
    }
  }
  if (typeof s.pad === 'object' && s.pad !== null) {
    const pad = s.pad as {
      driveStick?: unknown;
      buttons?: unknown;
      combos?: unknown;
      deadzone?: unknown;
      curve?: unknown;
      triggerThreshold?: unknown;
      chordGraceMs?: unknown;
    };
    if (pad.driveStick === 'left' || pad.driveStick === 'right') {
      out.pad.driveStick = pad.driveStick;
    }
    if (typeof pad.buttons === 'object' && pad.buttons !== null) {
      const buttons = pad.buttons as Record<string, unknown>;
      for (const a of PAD_ACTIONS) {
        const v = buttons[a];
        if (Array.isArray(v) && v.every(isButtonIndex)) {
          out.pad.buttons[a] = v as number[];
        }
      }
    }
    // Combos are validated ENTRY BY ENTRY rather than list-or-nothing like the singles: a
    // list is a list of independent choices, and one corrupt chord should not take a player's
    // other combos with it. A list that is not a list keeps the default (none).
    if (typeof pad.combos === 'object' && pad.combos !== null) {
      const combos = pad.combos as Record<string, unknown>;
      for (const a of PAD_ACTIONS) {
        const v = combos[a];
        if (!Array.isArray(v)) continue;
        const seen = new Set<string>();
        const clean: PadChord[] = [];
        for (const raw of v) {
          const c = normalizeChord(raw);
          if (!c || seen.has(chordKey(c))) continue;
          seen.add(chordKey(c));
          clean.push(c);
        }
        out.pad.combos[a] = clean;
      }
    }
    if (typeof pad.deadzone === 'number' && Number.isFinite(pad.deadzone)) {
      out.pad.deadzone = Math.min(0.4, Math.max(0, pad.deadzone));
    }
    if (typeof pad.curve === 'number' && Number.isFinite(pad.curve)) {
      out.pad.curve = Math.min(3, Math.max(1, pad.curve));
    }
    if (typeof pad.triggerThreshold === 'number' && Number.isFinite(pad.triggerThreshold)) {
      out.pad.triggerThreshold = Math.min(0.9, Math.max(0.1, pad.triggerThreshold));
    }
    if (typeof pad.chordGraceMs === 'number' && Number.isFinite(pad.chordGraceMs)) {
      out.pad.chordGraceMs = Math.min(PAD_CHORD_GRACE_MAX_MS, Math.max(PAD_CHORD_GRACE_MIN_MS, pad.chordGraceMs));
    }
  }
  return out;
}

// ---- editing ----------------------------------------------------------------------
// The controls screen's own operations, kept DOM-free here so `npm test` can pin the steal
// policy: a rebound key or button is taken from whatever action had it, and the slot it is
// dropped on is replaced. STEALING IS EXACT — a single steals that single and touches no
// combo; a combo steals the identical combo and touches no single. RT can be Shoot and half
// of a lift combo at once, which is the whole reason combos exist.

/** put `key` on `action` at `slot` (past the end appends), taking it from every other action */
export function assignKey(b: ControlBindings, action: KeyAction, slot: number, key: string): ControlBindings {
  const next = cloneBindings(b);
  for (const a of KEY_ACTIONS) next.keys[a] = next.keys[a].filter((k) => k !== key);
  // filtering above may have shortened this list, so re-clamp the slot to it
  const list = next.keys[action];
  if (slot < list.length) list[slot] = key;
  else list.push(key);
  return next;
}

/** drop the key at `slot` from `action`; a slot that does not exist is a no-op */
export function removeKey(b: ControlBindings, action: KeyAction, slot: number): ControlBindings {
  const next = cloneBindings(b);
  next.keys[action].splice(slot, 1);
  return next;
}

/**
 * put `chord` (a single as `[i]`, or a combo) on `action` at `slot`, taking it from every
 * other action. `slot` indexes `padBinds(action)` — singles then combos — and the bind that
 * was there is replaced, moving between the two lists when the kind changes.
 */
export function assignPadBind(b: ControlBindings, action: PadAction, slot: number, chord: PadChord): ControlBindings {
  const next = removePadBind(b, action, slot);
  const combo = chord.length > 1 ? normalizeChord(chord) : null;
  if (chord.length > 1 && !combo) return cloneBindings(b);
  if (combo) {
    const key = chordKey(combo);
    for (const a of PAD_ACTIONS) next.pad.combos[a] = next.pad.combos[a].filter((c) => chordKey(c) !== key);
    const singles = next.pad.buttons[action].length;
    const at = Math.min(Math.max(0, slot - singles), next.pad.combos[action].length);
    next.pad.combos[action].splice(at, 0, combo);
  } else {
    const idx = chord[0];
    if (!isButtonIndex(idx)) return cloneBindings(b);
    for (const a of PAD_ACTIONS) next.pad.buttons[a] = next.pad.buttons[a].filter((i) => i !== idx);
    const at = Math.min(slot, next.pad.buttons[action].length);
    next.pad.buttons[action].splice(at, 0, idx);
  }
  return next;
}

/** drop the bind at `slot` of `padBinds(action)`; a slot that does not exist is a no-op */
export function removePadBind(b: ControlBindings, action: PadAction, slot: number): ControlBindings {
  const next = cloneBindings(b);
  const singles = next.pad.buttons[action].length;
  if (slot < singles) next.pad.buttons[action].splice(slot, 1);
  else next.pad.combos[action].splice(slot - singles, 1);
  return next;
}

/** display label for a bound key */
export function keyLabel(k: string): string {
  const special: Record<string, string> = {
    ' ': 'SPACE',
    arrowleft: '◄',
    arrowright: '►',
    arrowup: '▲',
    arrowdown: '▼',
    shift: 'SHIFT',
    control: 'CTRL',
    alt: 'ALT',
    enter: 'ENTER',
    tab: 'TAB',
    backspace: 'BKSP',
  };
  return special[k] ?? k.toUpperCase();
}

const PAD_BUTTON_LABELS = [
  'A',
  'B',
  'X',
  'Y',
  'LB',
  'RB',
  'LT',
  'RT',
  'BACK',
  'START',
  'LS',
  'RS',
  'D-UP',
  'D-DOWN',
  'D-LEFT',
  'D-RIGHT',
];

/** display label for a standard-mapping gamepad button index */
export function padButtonLabel(i: number): string {
  return PAD_BUTTON_LABELS[i] ?? `B${i}`;
}

/** display label for one bind: a single's face label, or a combo's buttons joined by `+` */
export function padBindLabel(c: PadChord): string {
  return c.map(padButtonLabel).join(' + ');
}
