/** user-customizable control bindings: keyboard keys per action, gamepad
 * button indices per action, and which stick drives. Escape is reserved
 * (menu / cancel capture) and never bindable. */

import { GAME_IDS, type GameId } from '../games/types';
import { PAD_MENU_BUTTON } from './padNav';

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
  | 'bbRamp'
  | 'bbPass'
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
  | 'bbRamp'
  | 'bbPass'
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
  /**
   * THE IN-MATCH MENU BUTTON, and the two reasons it is a bare field rather than a thirteenth
   * `PadAction`. It is not an action: the sim never reads it, there is no `RobotCommand` bit for
   * it, and `ACTION_GAMES` is keyed on `KeyAction` with `PadAction` a strict subset — so adding
   * one would ripple a UI affordance through the command table. And it is a NEW SIBLING FIELD
   * for the reason `combos` is: an older client ignores it and keeps its old Esc-only exit.
   * Default `PAD_MENU_BUTTON` (15, D-RIGHT), the one index no default bind uses.
   */
  menuButton: number;
  /**
   * Is the pad allowed to drive the MENUS as well as the robot? On by default; the toggle
   * exists for a player who wants a connected pad to be the robot's and nothing else.
   * Validated like every other field, so an older blob without it reads as on.
   */
  navEnabled: boolean;
}

/**
 * ONE GAME'S OVERRIDE of the main map. An action PRESENT here is DESYNCED for that game —
 * its binds in that game are exactly what is written here, and main no longer reaches it.
 * An action ABSENT inherits main, which is the SYNCED state and the default for everything.
 * "Sync back" is the deletion of the entry, and nothing else.
 *
 * `padButtons` and `padCombos` are ONE UNIT: "the binds of Shoot on a pad in BIOBUZZ" is a
 * single thing a player desyncs or syncs, not two, so every writer here writes both and every
 * reader treats either one's presence as "this action is desynced". They are still two FIELDS
 * for the same reason `PadBindings` keeps them apart — see `PadBindings.combos`.
 *
 * Stick role, deadzone, curve, trigger threshold and the combo wait are deliberately NOT here.
 * They are how a player's hand works, not what a button means, and nobody wants a different
 * deadzone per season.
 */
export interface GameBindingOverride {
  keys?: Partial<Record<KeyAction, string[]>>;
  padButtons?: Partial<Record<PadAction, number[]>>;
  padCombos?: Partial<Record<PadAction, PadChord[]>>;
}

/**
 * THE MOST BINDS ONE ACTION MAY CARRY, per device — keys, or `padBinds` (singles and combos
 * together). The `+` slot could grow a list without bound before this existed, and the settings
 * blob is capped at 64 KB by the server: a player leaning on `+` could have written a blob the
 * account sync then rejected, silently, forever. Eight alternatives for one action is already
 * past anything a drive team uses.
 */
export const BIND_SLOTS_MAX = 8;

export interface ControlBindings {
  /** `KeyboardEvent.key.toLowerCase()` values per action */
  keys: Record<KeyAction, string[]>;
  pad: PadBindings;
  /**
   * PER-GAME OVERRIDES of the map above (see `GameBindingOverride`). A NEW SIBLING FIELD, never
   * a change to the shape of `keys` / `pad.buttons` / `pad.combos` — for exactly the reason
   * `pad.combos` is its own field: a settings blob is persisted and account-synced VERBATIM,
   * and the stable site runs older code against the same accounts. An older client ignores this
   * field entirely and keeps playing on the main map, which is the correct degradation.
   *
   * ABSENT on a blob that has never used the feature, and pruned back to absent when the last
   * override is synced away — so a player who never opens a game scope round-trips byte for
   * byte through the old shape.
   */
  perGame?: Partial<Record<GameId, GameBindingOverride>>;
}

// ---- WHICH GAMES USE WHICH ACTION -------------------------------------------------
// The table that makes a duplicate LEGAL. Two actions conflict only if some game uses BOTH, so
// `catalyst` (Chain Reaction) and `bbPlace` (BIOBUZZ) may share a key or a button in the main
// map — no game ever offers both, so nothing is ambiguous — while `fire`, which every game
// reads, still steals from whatever had its key.
//
// It is a plain table keyed by `GameId` rather than a `GameModule.ui` slot on purpose: it is
// DOM-free, the headless smoke can pin every row, and a game module would have to be imported
// by the input layer to ask. Each row below was checked against the SIM, not against intent —
// which `RobotCommand` bit that game's `step` actually reads:
//   catalyst → `src/games/chain/play.ts` (the claw's grab/place); no other game reads it
//   fling    → `src/games/chain/play.ts` (the catapult throw)
//   bbPlace / bbPlaceNectar → `src/games/biobuzz/play.ts` + `sim3d/elements3d.ts`
//   bbNectar → `src/games/biobuzz/play.ts` (`bbHumanPlayerTick`, shared by the 2D and 3D paths)
//   bbRamp → `src/games/biobuzz/robot.ts` (the `ramp` intake archetype only)
//   intake / fire → all three, through three unrelated sites each
//   driveMode → `src/sim/robot.ts`, which every game's step routes through (`updateRobot`)
//   the drive/rotate/tank actions → every game, through `updateRobot`
// `PadAction` is a strict subset of `KeyAction`, so one table answers for both devices.

const ALL: readonly GameId[] = GAME_IDS;

export const ACTION_GAMES: Readonly<Record<KeyAction, readonly GameId[]>> = {
  driveUp: ALL,
  driveDown: ALL,
  tankRightUp: ALL,
  tankRightDown: ALL,
  driveLeft: ALL,
  driveRight: ALL,
  rotateCCW: ALL,
  rotateCW: ALL,
  intake: ALL,
  fire: ALL,
  catalyst: ['chain'],
  fling: ['chain'],
  bbPlaceNectar: ['biobuzz'],
  bbPlace: ['biobuzz'],
  bbNectar: ['biobuzz'],
  bbRamp: ['biobuzz'],
  bbPass: ['biobuzz'],
  driveMode: ALL,
  flipFront: ALL,
  park: ALL,
  start: ALL,
  restart: ALL,
};

/** does `game` use `action` at all? An action it does not use can never fire in it. */
export function actionUsedBy(action: KeyAction, game: GameId): boolean {
  return ACTION_GAMES[action].includes(game);
}

/** the keyboard actions `game` uses, in `KEY_ACTIONS` order */
export function keyActionsFor(game: GameId): KeyAction[] {
  return KEY_ACTIONS.filter((a) => actionUsedBy(a, game));
}

/** the pad actions `game` uses, in `PAD_ACTIONS` order */
export function padActionsFor(game: GameId): PadAction[] {
  return PAD_ACTIONS.filter((a) => actionUsedBy(a, game));
}

/**
 * DO TWO ACTIONS CONFLICT? Only if some game uses both — which is the whole feature. An action
 * always conflicts with itself (every action belongs to at least one game), which is what lets
 * the assign helpers use this as their one filter.
 */
export function actionsConflict(a: KeyAction, b: KeyAction): boolean {
  return ACTION_GAMES[a].some((g) => actionUsedBy(b, g));
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
  'bbRamp',
  'bbPass',
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
  'bbRamp',
  'bbPass',
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
    // BIOBUZZ, the `ramp` intake: drop / fold the deployable ramp. 'l' for "lower"; free on the
    // default map. NOT 'g', 'h', 'j' or 'y' — every one of those is a stock "assumed free key"
    // fixture the bindings smoke lane reuses across independent tests, and a real default there
    // makes an unrelated conflict test grow a stray per-game override.
    bbRamp: ['l'],
    // BIOBUZZ: PASS to your partner — launch the held element at a field POINT rather than at
    // your own hive. 't' for toss; free on the default map, and NOT 'g'/'h'/'j'/'y' for the
    // reason the ramp's own comment above gives.
    bbPass: ['t'],
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
      // face button was already taken.
      bbPlaceNectar: [13],
      // D-UP — place a POLLEN.
      bbPlace: [12],
      // D-LEFT. It is NOT on D-DOWN, which this lane originally took: Lane B's placement pair
      // landed on D-UP/D-DOWN in the same round, and two actions on one index is a silent
      // double-fire, not a conflict the rebinder reports. The d-pad is still the right home —
      // a MOMENTARY press can afford the drive thumb leaving its stick for an instant — and
      // this button keeps its own direction, one step away from the pair it must not be
      // confused with.
      bbNectar: [14],
      // RS (11) — the right-stick click was the last free button; a ramp toggle is a MOMENTARY
      // press like the d-pad pair above, so costing the stick for an instant is the same trade.
      bbRamp: [11],
      /**
       * ⚠️ PASS SHIPS UNBOUND ON THE PAD, because there is no button left to give it. The
       * standard mapping's 0..15 are all spoken for — fire 7/0, intake 6/1, catalyst 4, fling
       * 10, place 13/12, nectar 14, ramp 11, driveMode 5, flip 3, park 2, start 9, restart 8,
       * and 15 is the in-match MENU button (`PAD_MENU_BUTTON`). 16 is the guide button, which
       * a browser often does not report at all.
       *
       * A default COMBO was the other option and is deliberately NOT taken: `padChords.ts`'s
       * fast path is “no combo bound ⇒ the old any-button test, no state”, so shipping the
       * first default combo would move EVERY player onto the resolver's stateful path to give
       * one season one button. Binding it is one row in Controls, and the keyboard default
       * ('t') means the action is never unreachable.
       */
      bbPass: [],
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
    menuButton: PAD_MENU_BUTTON,
    navEnabled: true,
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
  const out: ControlBindings = {
    keys,
    pad: {
      driveStick: b.pad.driveStick,
      buttons,
      combos,
      deadzone: b.pad.deadzone,
      curve: b.pad.curve,
      triggerThreshold: b.pad.triggerThreshold,
      chordGraceMs: b.pad.chordGraceMs,
      menuButton: b.pad.menuButton,
      navEnabled: b.pad.navEnabled,
    },
  };
  const pg = clonePerGame(b.perGame);
  if (pg) out.perGame = pg;
  return out;
}

/** deep-copy the override map, or `undefined` when there is nothing to copy (which is what
 *  keeps a never-overridden blob identical to the old shape). */
function clonePerGame(
  pg: ControlBindings['perGame'],
): ControlBindings['perGame'] | undefined {
  if (!pg) return undefined;
  const out: Partial<Record<GameId, GameBindingOverride>> = {};
  let any = false;
  for (const g of GAME_IDS) {
    const ov = pg[g];
    if (!ov) continue;
    const copy: GameBindingOverride = {};
    if (ov.keys) {
      const keys: Partial<Record<KeyAction, string[]>> = {};
      for (const a of KEY_ACTIONS) if (ov.keys[a]) keys[a] = [...ov.keys[a]!];
      if (Object.keys(keys).length) copy.keys = keys;
    }
    if (ov.padButtons) {
      const bt: Partial<Record<PadAction, number[]>> = {};
      for (const a of PAD_ACTIONS) if (ov.padButtons[a]) bt[a] = [...ov.padButtons[a]!];
      if (Object.keys(bt).length) copy.padButtons = bt;
    }
    if (ov.padCombos) {
      const cb: Partial<Record<PadAction, PadChord[]>> = {};
      for (const a of PAD_ACTIONS) if (ov.padCombos[a]) cb[a] = ov.padCombos[a]!.map((c) => [...c]);
      if (Object.keys(cb).length) copy.padCombos = cb;
    }
    if (copy.keys || copy.padButtons || copy.padCombos) {
      out[g] = copy;
      any = true;
    }
  }
  return any ? out : undefined;
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
        out.keys[a] = v.map((k: string) => k.toLowerCase()).slice(0, BIND_SLOTS_MAX);
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
      menuButton?: unknown;
      navEnabled?: unknown;
    };
    if (isButtonIndex(pad.menuButton)) out.pad.menuButton = pad.menuButton;
    if (typeof pad.navEnabled === 'boolean') out.pad.navEnabled = pad.navEnabled;
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
    // the per-action cap (`BIND_SLOTS_MAX`) is on the COMBINED list a player sees, so it is
    // applied once both halves are loaded. Combos go first because a single is the plainer bind.
    for (const a of PAD_ACTIONS) {
      const over = out.pad.buttons[a].length + out.pad.combos[a].length - BIND_SLOTS_MAX;
      if (over <= 0) continue;
      out.pad.combos[a] = out.pad.combos[a].slice(0, Math.max(0, out.pad.combos[a].length - over));
      out.pad.buttons[a] = out.pad.buttons[a].slice(0, BIND_SLOTS_MAX - out.pad.combos[a].length);
    }
  }
  const pg = mergePerGame((saved as { perGame?: unknown }).perGame, out);
  if (pg) out.perGame = pg;
  return out;
}

/**
 * Validate a stored `perGame` ENTRY BY ENTRY against an already-validated main map, the same
 * way combos are: one bad row must not cost a player the rest of their overrides. Unknown game
 * ids, unknown actions, and actions the game does not USE are dropped outright — an override
 * for `catalyst` under BIOBUZZ can never fire, so keeping it would only be a trap for the
 * conflict rules. Every list goes through the same validators as main and the same cap.
 */
function mergePerGame(saved: unknown, main: ControlBindings): ControlBindings['perGame'] | undefined {
  if (typeof saved !== 'object' || saved === null) return undefined;
  const pg = saved as Record<string, unknown>;
  const out: Partial<Record<GameId, GameBindingOverride>> = {};
  let any = false;
  for (const g of GAME_IDS) {
    const raw = pg[g];
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as { keys?: unknown; padButtons?: unknown; padCombos?: unknown };
    const ov: GameBindingOverride = {};

    if (typeof r.keys === 'object' && r.keys !== null) {
      const src = r.keys as Record<string, unknown>;
      const keys: Partial<Record<KeyAction, string[]>> = {};
      for (const a of KEY_ACTIONS) {
        if (!actionUsedBy(a, g)) continue;
        const v = src[a];
        if (Array.isArray(v) && v.every((k) => typeof k === 'string' && k !== 'escape')) {
          keys[a] = (v as string[]).map((k) => k.toLowerCase()).slice(0, BIND_SLOTS_MAX);
        }
      }
      if (Object.keys(keys).length) ov.keys = keys;
    }

    // PAD: the two halves are one unit, so an action named by EITHER of them is desynced and
    // BOTH halves are written — the missing one taken from main, once, and frozen there.
    const btSrc = typeof r.padButtons === 'object' && r.padButtons !== null ? (r.padButtons as Record<string, unknown>) : {};
    const cbSrc = typeof r.padCombos === 'object' && r.padCombos !== null ? (r.padCombos as Record<string, unknown>) : {};
    const buttons: Partial<Record<PadAction, number[]>> = {};
    const combos: Partial<Record<PadAction, PadChord[]>> = {};
    for (const a of PAD_ACTIONS) {
      if (!actionUsedBy(a, g)) continue;
      const rawBt = btSrc[a];
      const rawCb = cbSrc[a];
      if (rawBt === undefined && rawCb === undefined) continue;
      const bt = Array.isArray(rawBt) && rawBt.every(isButtonIndex) ? (rawBt as number[]) : [...main.pad.buttons[a]];
      const cb: PadChord[] = [];
      if (Array.isArray(rawCb)) {
        const seen = new Set<string>();
        for (const c of rawCb) {
          const n = normalizeChord(c);
          if (!n || seen.has(chordKey(n))) continue;
          seen.add(chordKey(n));
          cb.push(n);
        }
      } else {
        cb.push(...main.pad.combos[a].map((c) => [...c]));
      }
      const over = bt.length + cb.length - BIND_SLOTS_MAX;
      const keptCb = over > 0 ? cb.slice(0, Math.max(0, cb.length - over)) : cb;
      buttons[a] = over > 0 ? bt.slice(0, BIND_SLOTS_MAX - keptCb.length) : bt;
      combos[a] = keptCb;
    }
    if (Object.keys(buttons).length) {
      ov.padButtons = buttons;
      ov.padCombos = combos;
    }

    if (ov.keys || ov.padButtons) {
      out[g] = ov;
      any = true;
    }
  }
  return any ? out : undefined;
}

// ---- THE EFFECTIVE MAP ------------------------------------------------------------
// What a game actually plays on: main, with that game's overrides applied, and every action
// the game does not use EMPTIED. Emptying is not cosmetic — it is what stops a Chain Reaction
// catalyst bind firing, masking or consuming inside BIOBUZZ's chord resolver, which reads a
// `PadBindings` and has no idea what a game is.

/** is `action`'s keyboard bind desynced (overridden) in `game`? */
export function keyDesynced(b: ControlBindings, game: GameId, action: KeyAction): boolean {
  return b.perGame?.[game]?.keys?.[action] !== undefined;
}

/** is `action`'s pad bind desynced in `game`? Singles and combos are one unit, so either half
 *  being present is the answer. */
export function padDesynced(b: ControlBindings, game: GameId, action: PadAction): boolean {
  const ov = b.perGame?.[game];
  return ov?.padButtons?.[action] !== undefined || ov?.padCombos?.[action] !== undefined;
}

/** does `game` override anything at all? (what the UI's "Sync all" is offered for) */
export function gameHasOverrides(b: ControlBindings, game: GameId): boolean {
  const ov = b.perGame?.[game];
  if (!ov) return false;
  return (
    Object.keys(ov.keys ?? {}).length > 0 ||
    Object.keys(ov.padButtons ?? {}).length > 0 ||
    Object.keys(ov.padCombos ?? {}).length > 0
  );
}

/**
 * THE ONE RESOLVER. A plain main-shaped `ControlBindings` for `game`, with `perGame` stripped —
 * it is already applied, and a second application would be a bug looking for somewhere to
 * happen. Everything that reads a binding to DRIVE or to NAME a control reads this, never
 * `settings.bindings`: `InputManager`, the start overlay, and the tutorial hints.
 */
export function effectiveBindings(b: ControlBindings, game: GameId): ControlBindings {
  const out = cloneBindings(b);
  delete out.perGame;
  const ov = b.perGame?.[game];
  for (const a of KEY_ACTIONS) {
    if (!actionUsedBy(a, game)) {
      out.keys[a] = [];
      continue;
    }
    const v = ov?.keys?.[a];
    if (v) out.keys[a] = [...v];
  }
  for (const a of PAD_ACTIONS) {
    if (!actionUsedBy(a, game)) {
      out.pad.buttons[a] = [];
      out.pad.combos[a] = [];
      continue;
    }
    if (!padDesynced(b, game, a)) continue;
    out.pad.buttons[a] = [...(ov?.padButtons?.[a] ?? b.pad.buttons[a])];
    out.pad.combos[a] = (ov?.padCombos?.[a] ?? b.pad.combos[a]).map((c) => [...c]);
  }
  return out;
}

// ---- editing ----------------------------------------------------------------------
// The controls screen's own operations, kept DOM-free here so `npm test` can pin the steal
// policy: a rebound key or button is taken from whatever CONFLICTING action had it, and the
// slot it is dropped on is replaced. STEALING IS EXACT — a single steals that single and
// touches no combo; a combo steals the identical combo and touches no single. RT can be Shoot
// and half of a lift combo at once, which is the whole reason combos exist.
//
// TWO ACTIONS CONFLICT ONLY IF SOME GAME USES BOTH (`actionsConflict`). In the MAIN map that
// makes `catalyst` (Chain Reaction) and `bbPlace` (BIOBUZZ) able to share a key or a button —
// no session ever offers both, so the duplicate is not one. `fire` is in every game and still
// steals from everything.
//
// THE GAME-SCOPE EDITS ARE THE SAME FUNCTIONS, APPLIED TO THE EFFECTIVE MAP. That is not a
// shortcut, it is the definition: inside game G the steal scope is G's effective map, and in
// that map every action G does not use is already empty, so the very same filter reaches
// exactly the actions G uses. See `editInGame`.

/** the number of binds `action` carries on a device — the list `BIND_SLOTS_MAX` caps */
const atCap = (list: readonly unknown[]): boolean => list.length >= BIND_SLOTS_MAX;

/** put `key` on `action` at `slot` (past the end appends), taking it from every CONFLICTING
 *  action. An append past `BIND_SLOTS_MAX` is refused rather than silently dropped later. */
export function assignKey(b: ControlBindings, action: KeyAction, slot: number, key: string): ControlBindings {
  if (slot >= b.keys[action].length && atCap(b.keys[action])) return cloneBindings(b);
  const next = cloneBindings(b);
  for (const a of KEY_ACTIONS) {
    if (!actionsConflict(a, action)) continue;
    next.keys[a] = next.keys[a].filter((k) => k !== key);
  }
  // filtering above may have shortened this list, so re-clamp the slot to it
  const list = next.keys[action];
  if (slot < list.length) list[slot] = key;
  else list.push(key);
  return scrubKeyFromOverrides(next, action, key);
}

/**
 * MAIN-EDIT vs OVERRIDE — the one collision the two scopes can produce, and its rule.
 *
 * A main edit steals `key` from every conflicting action IN MAIN, but an action that is
 * DESYNCED in game G does not read main there: it could keep `key` in its override while
 * `action` — synced in G, so inheriting main — now also has it. Inside G that is a genuine
 * duplicate, of exactly the kind the whole steal policy exists to prevent, arrived at without
 * anyone editing G.
 *
 * THE OVERRIDE LOSES THE BIND. It is the simplest rule and the predictable one: the edit the
 * player just made is the one that survives, everywhere, and a main edit never silently fails
 * to take effect. The alternative (main loses) would mean an edit under "All games" quietly
 * doing nothing because of a season the player is not looking at.
 *
 * Only games where `action` is SYNCED are touched — where it is desynced, main's new bind
 * never reaches that game's effective map and there is nothing to collide with.
 */
function scrubKeyFromOverrides(b: ControlBindings, action: KeyAction, key: string): ControlBindings {
  if (!b.perGame) return b;
  const next = cloneBindings(b);
  for (const g of GAME_IDS) {
    const ov = next.perGame?.[g];
    if (!ov?.keys) continue;
    if (!actionUsedBy(action, g) || keyDesynced(next, g, action)) continue;
    for (const other of keyActionsFor(g)) {
      if (other === action) continue;
      const v = ov.keys[other];
      if (!v || !v.includes(key)) continue;
      ov.keys[other] = v.filter((k) => k !== key);
    }
  }
  return prunePerGame(next);
}

/** the pad twin of `scrubKeyFromOverrides`. Exactness is kept: a single scrubs that single out
 *  of `padButtons` and leaves every combo alone; a combo scrubs the identical combo. */
function scrubPadFromOverrides(b: ControlBindings, action: PadAction, chord: PadChord): ControlBindings {
  if (!b.perGame) return b;
  const next = cloneBindings(b);
  const single = chord.length === 1 ? chord[0] : null;
  const key = single === null ? chordKey(chord) : null;
  for (const g of GAME_IDS) {
    const ov = next.perGame?.[g];
    if (!ov) continue;
    if (!actionUsedBy(action, g) || padDesynced(next, g, action)) continue;
    for (const other of padActionsFor(g)) {
      if (other === action) continue;
      if (single !== null && ov.padButtons?.[other]) {
        ov.padButtons[other] = ov.padButtons[other]!.filter((i) => i !== single);
      }
      if (key !== null && ov.padCombos?.[other]) {
        ov.padCombos[other] = ov.padCombos[other]!.filter((c) => chordKey(c) !== key);
      }
    }
  }
  return prunePerGame(next);
}

/** drop empty override objects, and `perGame` itself once the last one goes — so a blob that
 *  has been synced all the way back is byte-identical to one that never had an override. */
function prunePerGame(b: ControlBindings): ControlBindings {
  const pg = clonePerGame(b.perGame);
  if (pg) b.perGame = pg;
  else delete b.perGame;
  return b;
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
  const have = padBinds(b.pad, action);
  if (slot >= have.length && atCap(have)) return cloneBindings(b);
  const next = removePadBind(b, action, slot);
  const combo = chord.length > 1 ? normalizeChord(chord) : null;
  if (chord.length > 1 && !combo) return cloneBindings(b);
  if (combo) {
    const key = chordKey(combo);
    for (const a of PAD_ACTIONS) {
      if (!actionsConflict(a, action)) continue;
      next.pad.combos[a] = next.pad.combos[a].filter((c) => chordKey(c) !== key);
    }
    const singles = next.pad.buttons[action].length;
    const at = Math.min(Math.max(0, slot - singles), next.pad.combos[action].length);
    next.pad.combos[action].splice(at, 0, combo);
  } else {
    const idx = chord[0];
    if (!isButtonIndex(idx)) return cloneBindings(b);
    for (const a of PAD_ACTIONS) {
      if (!actionsConflict(a, action)) continue;
      next.pad.buttons[a] = next.pad.buttons[a].filter((i) => i !== idx);
    }
    const at = Math.min(slot, next.pad.buttons[action].length);
    next.pad.buttons[action].splice(at, 0, idx);
  }
  return scrubPadFromOverrides(next, action, combo ?? chord);
}

/** drop the bind at `slot` of `padBinds(action)`; a slot that does not exist is a no-op */
export function removePadBind(b: ControlBindings, action: PadAction, slot: number): ControlBindings {
  const next = cloneBindings(b);
  const singles = next.pad.buttons[action].length;
  if (slot < singles) next.pad.buttons[action].splice(slot, 1);
  else next.pad.combos[action].splice(slot - singles, 1);
  return next;
}

// ---- editing INSIDE ONE GAME'S SCOPE ------------------------------------------------
// Every one of these is the SAME main-shaped editor run against the game's EFFECTIVE map, and
// then diffed back into that game's override. Two properties fall out of doing it that way
// rather than writing a second steal policy:
//
//  · THE STEAL SCOPE IS AUTOMATICALLY RIGHT. In the effective map every action the game does
//    not use is already empty, so `assignKey`'s filter reaches exactly the actions the game
//    uses and nothing else. Binding X to A in game G takes X off every other action G uses.
//  · MAIN IS NEVER TOUCHED. The edit happens on a copy; only the override is written back.
//    A victim of the steal is DESYNCED in G to record its loss — which is the only honest way
//    to say "this action has different binds here", and it is undone by Sync like any other.

/** run `edit` on `game`'s effective map and write the result back as `game`'s override. */
function editInGame(
  b: ControlBindings,
  game: GameId,
  edit: (eff: ControlBindings) => ControlBindings,
): ControlBindings {
  const before = effectiveBindings(b, game);
  const after = edit(before);
  const next = cloneBindings(b);
  const ov: GameBindingOverride = next.perGame?.[game] ?? {};
  const same = (x: readonly unknown[], y: readonly unknown[]): boolean => JSON.stringify(x) === JSON.stringify(y);
  for (const a of keyActionsFor(game)) {
    // an action that was ALREADY desynced stays desynced even if this edit did not move it —
    // the player said "these are mine here", and only Sync takes that back.
    if (!same(after.keys[a], before.keys[a]) || keyDesynced(b, game, a)) {
      (ov.keys ??= {})[a] = [...after.keys[a]];
    }
  }
  for (const a of padActionsFor(game)) {
    if (
      !same(after.pad.buttons[a], before.pad.buttons[a]) ||
      !same(after.pad.combos[a], before.pad.combos[a]) ||
      padDesynced(b, game, a)
    ) {
      (ov.padButtons ??= {})[a] = [...after.pad.buttons[a]];
      (ov.padCombos ??= {})[a] = after.pad.combos[a].map((c) => [...c]);
    }
  }
  next.perGame = { ...next.perGame, [game]: ov };
  return prunePerGame(next);
}

/** put `key` on `action` at `slot` within `game` only — desyncing `action` there, and
 *  desyncing whatever action of that game it was stolen from. Main is untouched. */
export function assignKeyInGame(
  b: ControlBindings,
  game: GameId,
  action: KeyAction,
  slot: number,
  key: string,
): ControlBindings {
  if (!actionUsedBy(action, game)) return cloneBindings(b);
  return editInGame(b, game, (eff) => assignKey(eff, action, slot, key));
}

/** drop the key at `slot` of `action` within `game` only */
export function removeKeyInGame(b: ControlBindings, game: GameId, action: KeyAction, slot: number): ControlBindings {
  if (!actionUsedBy(action, game)) return cloneBindings(b);
  return editInGame(b, game, (eff) => removeKey(eff, action, slot));
}

/** put `chord` on `action` at `slot` within `game` only */
export function assignPadBindInGame(
  b: ControlBindings,
  game: GameId,
  action: PadAction,
  slot: number,
  chord: PadChord,
): ControlBindings {
  if (!actionUsedBy(action, game)) return cloneBindings(b);
  return editInGame(b, game, (eff) => assignPadBind(eff, action, slot, chord));
}

/** drop the bind at `slot` of `action` within `game` only */
export function removePadBindInGame(b: ControlBindings, game: GameId, action: PadAction, slot: number): ControlBindings {
  if (!actionUsedBy(action, game)) return cloneBindings(b);
  return editInGame(b, game, (eff) => removePadBind(eff, action, slot));
}

/** SYNC BACK one keyboard action in one game: delete its override, so it inherits main again. */
export function syncKeyInGame(b: ControlBindings, game: GameId, action: KeyAction): ControlBindings {
  const next = cloneBindings(b);
  delete next.perGame?.[game]?.keys?.[action];
  return prunePerGame(next);
}

/** SYNC BACK one pad action in one game. Singles and combos go together — they are one unit. */
export function syncPadInGame(b: ControlBindings, game: GameId, action: PadAction): ControlBindings {
  const next = cloneBindings(b);
  delete next.perGame?.[game]?.padButtons?.[action];
  delete next.perGame?.[game]?.padCombos?.[action];
  return prunePerGame(next);
}

/** SYNC BACK everything in one game — the scope's "Sync all". */
export function syncGame(b: ControlBindings, game: GameId): ControlBindings {
  const next = cloneBindings(b);
  delete next.perGame?.[game];
  return prunePerGame(next);
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
