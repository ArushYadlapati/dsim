/**
 * THE TOUCH PAD'S BUTTON SET, and where each button lands.
 *
 * DOM-free and React-free on purpose: `npm test` drives every function here, which is the
 * only way to hold the one property this module exists for —
 *
 * ⚠️ **THE BUTTON SET IS DERIVED FROM `ACTION_GAMES`, NEVER LISTED BY HAND.** The touch layer
 * used to carry a fixed four (intake, shoot, catalyst, throw) plus one slot a game could fill,
 * so every season that added a control added it for the keyboard and the pad and then silently
 * not for touch: BIOBUZZ shipped `bbPlace`, `bbPlaceNectar`, `bbRamp` and `bbPass` with no way
 * to press any of them on a phone, and its own HANDOFF recorded that as debt three times over.
 * `touchCoverageGaps(game)` is the answer: it names every action `ACTION_GAMES` says a game
 * uses that this pad can neither press nor reach another way, and `npm test` asserts it is
 * empty for every game. A season that adds an action now fails the suite until the action is
 * either given a button here or written into `TOUCH_OTHER_ACTIONS` with the reason.
 *
 * ── WHY POSITIONS ARE COMPUTED RATHER THAN STORED ─────────────────────────────
 * `GameSettings.mobileLayout` stores a centre per control as a fraction of the viewport, which
 * cannot be right in both orientations at once: the shipped default put SHOOT and INTAKE 0.16
 * apart in x, which is 130 px of a landscape phone (fine) and 60 px of a portrait one — closer
 * than the two buttons' radii, so they OVERLAPPED, and the same default put the DRIVE stick's
 * centre 49 px from the left edge with a 58 px radius, so in portrait it hung off the screen.
 *
 * So the pad ARRANGES ITSELF by default (`packTouchControls`), in px, against the live
 * viewport — two thumb columns that climb the left and right edges from the bottom corners,
 * skipping whatever a stored position already occupies. A stored position is honoured the
 * moment it differs from `DEFAULT_MOBILE_LAYOUT`, i.e. the moment the player has actually
 * dragged that control, so every customised layout keeps working exactly as it did.
 *
 * Only the controls that had a `MobileLayout` key before can be dragged. Giving every derived
 * action one would mean a new field in `src/types.ts` per action and a settings migration per
 * season, which is the coupling this file removes.
 */

import type { GameId } from '../games/types';
import { GAME_IDS } from '../games/types';
import type { KeyAction } from '../input/bindings';
import { KEY_ACTIONS, actionUsedBy } from '../input/bindings';
import type { MobileLayout, MobilePos, RobotSpec } from '../types';
import { DEFAULT_MOBILE_LAYOUT } from '../settings';
import { BB_TOUCH_BUTTONS } from '../games/biobuzz/mobile';
import { CHAIN_TOUCH_BUTTONS } from '../games/chain/mobile';

/** an action the pad HOLDS DOWN — one `VirtualInput` boolean, released on touch end. */
export type TouchHoldField =
  | 'intake'
  | 'fire'
  | 'catalyst'
  | 'fling'
  | 'bbPlaceNectar'
  | 'bbPlace'
  | 'bbNectar'
  | 'bbRamp'
  | 'bbPass'
  | 'driveMode';

/** an action the pad PULSES once per tap (`InputManager.pressVirtual`). Flip and park are
 *  edge-triggered on the manager rather than bits on the command, so they cannot be held. */
export type TouchTapField = 'flipFront' | 'park';

/** what a `present` / `auto` predicate gets to ask about. The SPEC, not the HUD: every one of
 *  these questions is "does this BUILD have the mechanism", which is a property of the robot
 *  the player assembled and not of the tick. */
export interface TouchCtx {
  spec: RobotSpec;
  /** the local robot's live assists — these GHOST a button, they never remove it (see below) */
  autoIntake: boolean;
  autoFire: boolean;
}

export interface TouchButton {
  /** the `ACTION_GAMES` row this button reaches. It is the identity: `touchCoverageGaps`
   *  matches on it, and no two buttons may carry the same one. */
  action: KeyAction;
  /** HOLD (a command bit) or TAP (a one-shot pulse) */
  hold?: TouchHoldField;
  tap?: TouchTapField;
  /** drawn inside the circle, so at most eight characters */
  label: string;
  /** the full name, for the ARIA label — `KEY_LABELS`' wording in ControlsSection */
  aria: string;
  glyph: string;
  /** style class on `.mobile-btn` */
  cls: string;
  /** the one big button (at most one per game) */
  primary?: boolean;
  /** which thumb owns it: the column it is packed into when it has no stored position */
  side: 'left' | 'right';
  /** the `MobileLayout` key that positions it, for the controls that shipped with one. A
   *  button without one is packed automatically and cannot be dragged. */
  slot?: Exclude<keyof MobileLayout, 'scale'>;
  /** does THIS build have the mechanism? Absent means always. */
  present?(ctx: TouchCtx): boolean;
  /** is the ROBOT handling this action itself right now? Such a button is GHOSTED, never
   *  removed: hiding it is what left a default DECODE phone with no action buttons at all,
   *  because auto intake and auto fire are both on by default and they were the only two. A
   *  manual press still reaches the sim with the assist on. */
  auto?(ctx: TouchCtx): boolean;
}

/**
 * The buttons every game gets. Order is thumb order — nearest the corner first — and the two
 * assisted ones stay at the front because they are the actions a driver presses most.
 */
export const SHARED_TOUCH_BUTTONS: readonly TouchButton[] = [
  {
    action: 'fire',
    hold: 'fire',
    label: 'SHOOT',
    aria: 'Shoot',
    glyph: '◎',
    cls: 'shoot',
    primary: true,
    side: 'right',
    slot: 'shoot',
    auto: (c) => c.autoFire,
  },
  {
    action: 'intake',
    hold: 'intake',
    label: 'INTAKE',
    aria: 'Intake',
    glyph: '▼',
    cls: 'intake',
    side: 'left',
    slot: 'intake',
    auto: (c) => c.autoIntake,
  },
  {
    action: 'flipFront',
    tap: 'flipFront',
    label: 'FLIP',
    aria: 'Flip front',
    glyph: '↻',
    cls: 'flip',
    side: 'left',
  },
  {
    action: 'driveMode',
    hold: 'driveMode',
    label: 'WHEELS',
    aria: 'Swap wheel set',
    glyph: '⇄',
    cls: 'drivemode',
    side: 'left',
    // BUTTERFLY only — every other drivetrain ignores the bit (`src/sim/robot.ts`)
    present: (c) => c.spec.drivetrain === 'butterfly',
  },
  {
    action: 'park',
    tap: 'park',
    label: 'PARK',
    aria: 'Toggle park mode',
    glyph: '■',
    cls: 'park',
    side: 'left',
  },
];

/** the per-game tables, one per season. A new game is a compile error until it has a row. */
const GAME_TOUCH_BUTTONS: Record<GameId, readonly TouchButton[]> = {
  // DECODE's only actions are the shared ones — its artifacts are intaken and shot, and the
  // gate, basin and rail are field mechanisms the driver pushes with the chassis.
  decode: [],
  chain: CHAIN_TOUCH_BUTTONS,
  biobuzz: BB_TOUCH_BUTTONS,
};

/**
 * The actions this pad deliberately does NOT give a button, with the surface that reaches each
 * one instead. `touchCoverageGaps` reads it, so an entry here is a signed statement rather than
 * an omission.
 */
export const TOUCH_OTHER_ACTIONS: Readonly<Record<string, string>> = {
  // the two virtual sticks ARE these eight
  driveUp: 'drive stick',
  driveDown: 'drive stick',
  driveLeft: 'drive stick',
  driveRight: 'drive stick',
  tankRightUp: 'drive stick',
  tankRightDown: 'drive stick',
  rotateCCW: 'turn stick',
  rotateCW: 'turn stick',
  // both are already on-screen chrome on a coarse pointer: START MATCH is a button in the
  // pre-match overlay panel (`GameView`), RESET is one of the two top-left `.game-btn`s.
  start: 'pre-match overlay button',
  restart: 'RESET button',
};

/** every button `game` could show, in thumb order — the shared ones interleaved with its own
 *  so the two columns stay ordered by how often a driver reaches for them. */
export function touchButtonsFor(game: GameId): TouchButton[] {
  const shared = SHARED_TOUCH_BUTTONS.filter((b) => actionUsedBy(b.action, game));
  const own = GAME_TOUCH_BUTTONS[game];
  // the game's own mechanisms sit between the two assisted buttons and the three utilities:
  // they are what the season is about, and PARK/FLIP/WHEELS are pressed a handful of times.
  const utility = new Set<KeyAction>(['flipFront', 'driveMode', 'park']);
  return [
    ...shared.filter((b) => !utility.has(b.action)),
    ...own,
    ...shared.filter((b) => utility.has(b.action)),
  ];
}

/** the buttons actually drawn for this build — `present` is the only filter, because an
 *  assisted action is ghosted rather than dropped. */
export function visibleTouchButtons(game: GameId, ctx: TouchCtx): TouchButton[] {
  return touchButtonsFor(game).filter((b) => !b.present || b.present(ctx));
}

/**
 * ⚠️ THE ANTI-DRIFT CHECK. Every action `game` uses, that has neither a button nor an entry in
 * `TOUCH_OTHER_ACTIONS`. `npm test` asserts this is empty for every game in `GAME_IDS`.
 */
export function touchCoverageGaps(game: GameId): KeyAction[] {
  const covered = new Set<KeyAction>(touchButtonsFor(game).map((b) => b.action));
  return KEY_ACTIONS.filter(
    (a) => actionUsedBy(a, game) && !covered.has(a) && TOUCH_OTHER_ACTIONS[a] === undefined,
  );
}

/** every button declared anywhere, for the tests that check the table itself */
export function allTouchButtons(): TouchButton[] {
  return GAME_IDS.flatMap((g) => GAME_TOUCH_BUTTONS[g]).concat(SHARED_TOUCH_BUTTONS);
}

// ── GEOMETRY ─────────────────────────────────────────────────────────────────────────
// px at scale 1. The joystick pair is unchanged; the secondary button grew from 62 to 64 so
// that the smallest layout scale the settings allow (0.7) still leaves a 44 px target, which
// is the smallest a finger hits reliably.

export const TOUCH_JOY_R = 58;
export const TOUCH_JOY_MAX_RADIUS = 52;
export const TOUCH_BTN_PRIMARY = 82;
export const TOUCH_BTN_SECONDARY = 64;
/** breathing room between two controls, and between a control and the viewport edge */
const TOUCH_GAP = 8;
/**
 * WHAT THE TOP STRIP ALREADY OWNS, per side, measured on a phone-width viewport: the left is
 * the MENU/RESET stack with the sponsor mark under it (102 px) and the event log below that;
 * the right is the status chip row (58 px). Two numbers rather than one because a landscape
 * phone is 360 px tall and the difference is a whole row of buttons.
 */
const TOUCH_TOP_RESERVE = { left: 116, right: 76 } as const;
/** the score bar is bottom-CENTRE, so only the safe-area strip is owed at the two corners */
const TOUCH_BOTTOM_RESERVE = 8;
/** how far inboard the thumb columns may march before giving up. Four is what a 360 px-tall
 *  landscape phone needs for the widest build BIOBUZZ can assemble (ten buttons). */
const TOUCH_COLUMNS_MAX = 4;
/**
 * ⚠️ A THUMB'S SIDE IS THE OUTER 40% OF THE WIDTH, AND NOTHING FURTHER IN. Without this the
 * packer walked a portrait phone's columns to 214 px of 390 — the middle of the screen, over
 * the score bar, and the one place on a phone neither thumb reaches without regripping. It is
 * what makes the same code give a landscape phone four columns and a portrait one two.
 */
const TOUCH_SIDE_FRACTION = 0.4;

export interface Viewport {
  w: number;
  h: number;
}

/** a placed control: CENTRE in px, and the diameter of its circle */
export interface PlacedControl {
  x: number;
  y: number;
  size: number;
}

export interface PlacedTouchButton extends PlacedControl {
  button: TouchButton;
  /** is this the player's own stored position (draggable), or one this module chose? */
  stored: boolean;
}

export interface PackedTouchControls {
  drive: PlacedControl;
  turn: PlacedControl;
  buttons: PlacedTouchButton[];
}

const px = (p: MobilePos, vp: Viewport): { x: number; y: number } => ({ x: p.x * vp.w, y: p.y * vp.h });

/** has the player moved this control off the shipped default? That, and nothing else, is what
 *  turns a stored fraction back on — see the file header. */
function moved(layout: MobileLayout, key: Exclude<keyof MobileLayout, 'scale'>): boolean {
  const a = layout[key];
  const b = DEFAULT_MOBILE_LAYOUT[key];
  return a.x !== b.x || a.y !== b.y;
}

const overlaps = (a: PlacedControl, b: PlacedControl): boolean =>
  Math.hypot(a.x - b.x, a.y - b.y) < (a.size + b.size) / 2 + TOUCH_GAP;

/** keep the whole circle on screen, clear of the top strip */
function clampOn(c: PlacedControl, vp: Viewport): PlacedControl {
  const r = c.size / 2;
  return {
    size: c.size,
    x: Math.max(r + TOUCH_GAP, Math.min(vp.w - r - TOUCH_GAP, c.x)),
    y: Math.max(TOUCH_TOP_RESERVE.left + r, Math.min(vp.h - TOUCH_BOTTOM_RESERVE - r, c.y)),
  };
}

/**
 * The candidate centres for one thumb, in the order a thumb reaches them.
 *
 * ⚠️ ROW-MAJOR, BOTTOM ROW FIRST — outward column to inward within each row, then up a row.
 * Column-major was the first attempt and it is wrong in landscape, measured: a 360 px-tall
 * phone has the stick blocking the two lowest cells of the outer columns, so the FIRST button
 * placed — SHOOT, the one pressed most — climbed to the top-right corner of the screen, as far
 * from the driving thumb as the viewport allows. Filling each row before climbing puts it
 * beside the stick instead, which is where a thumb already is.
 */
function candidates(side: 'left' | 'right', size: number, vp: Viewport, stick: PlacedControl): PlacedControl[] {
  const r = size / 2;
  const pitch = size + TOUCH_GAP;
  const out: PlacedControl[] = [];
  const bottom = vp.h - TOUCH_BOTTOM_RESERVE - r;
  const top = TOUCH_TOP_RESERVE[side] + r;
  const cols = Math.max(2, Math.min(TOUCH_COLUMNS_MAX, Math.floor((vp.w * TOUCH_SIDE_FRACTION) / pitch)));
  for (let y = bottom; y >= top; y -= pitch) {
    for (let col = 0; col < cols; col++) {
      const off = r + TOUCH_GAP + col * pitch;
      const c = { x: side === 'right' ? vp.w - off : off, y, size };
      // the stick's own cells are the one place a button may never go: the base FLOATS to the
      // finger, so a button under it is pressed by the thumb that meant to drive.
      if (overlaps(c, stick)) continue;
      out.push(c);
    }
  }
  return out;
}

/**
 * Where every control goes, this frame. Pure: the same layout, viewport and button list give
 * the same answer, which is what makes the arrangement testable without a browser.
 */
export function packTouchControls(
  buttons: readonly TouchButton[],
  layout: MobileLayout,
  vp: Viewport,
): PackedTouchControls {
  const scale = layout.scale;
  const joy = TOUCH_JOY_R * 2 * scale;
  // the sticks: the stored fraction once dragged, otherwise the bottom corners, which is where
  // a thumb already is. Clamped either way — a landscape-tuned fraction put the default drive
  // base's left edge off a portrait screen.
  const corner = (side: 'left' | 'right'): PlacedControl => ({
    size: joy,
    x: side === 'left' ? joy / 2 + TOUCH_GAP : vp.w - joy / 2 - TOUCH_GAP,
    y: vp.h - TOUCH_BOTTOM_RESERVE - joy / 2,
  });
  const drive = clampOn(moved(layout, 'drive') ? { ...px(layout.drive, vp), size: joy } : corner('left'), vp);
  const turn = clampOn(moved(layout, 'turn') ? { ...px(layout.turn, vp), size: joy } : corner('right'), vp);

  /**
   * ⚠️ IN LANDSCAPE THE HUD IS IN THE GUTTERS, WHICH IS WHERE THE THUMBS ARE.
   *
   * `styles.css`'s `(orientation: landscape) and (pointer: coarse)` block moves the score bar
   * into the LEFT gutter as a vertical stack and the breakdown chips into the RIGHT one, both
   * centred on the height — the field is square, so those columns are the only spare room and
   * the chrome above and below it moves there. A button packed into the same cell sits on the
   * score, which is the one read-out a driver glances at without looking away from the robot.
   * Two obstacles, sized to those two blocks (a ~72 px stack and a 120 px chip column).
   */
  const gutters: PlacedControl[] =
    vp.w > vp.h
      ? [
          { x: TOUCH_GAP + 36, y: vp.h / 2, size: 150 },
          { x: vp.w - TOUCH_GAP - 60, y: vp.h / 2, size: 150 },
        ]
      : [];
  const taken: PlacedControl[] = [drive, turn, ...gutters];
  const out: PlacedTouchButton[] = [];
  const auto: TouchButton[] = [];

  // PASS 1 — everything the player has dragged keeps exactly where they put it, and becomes an
  // obstacle for pass 2. Doing it in this order is what stops an arranged button landing on a
  // placed one, whichever way round the two appear in the list.
  for (const b of buttons) {
    const size = (b.primary ? TOUCH_BTN_PRIMARY : TOUCH_BTN_SECONDARY) * scale;
    if (b.slot && moved(layout, b.slot)) {
      const p = clampOn({ ...px(layout[b.slot], vp), size }, vp);
      taken.push(p);
      out.push({ ...p, button: b, stored: true });
    } else {
      auto.push(b);
    }
  }

  // PASS 2 — the rest climb their own thumb's columns. A side with no room left falls back to
  // the other one before it gives up, so a short landscape phone stacks rather than drops: a
  // button that is not on screen is the bug this whole module exists to stop.
  for (const b of auto) {
    const size = (b.primary ? TOUCH_BTN_PRIMARY : TOUCH_BTN_SECONDARY) * scale;
    const other = b.side === 'left' ? 'right' : 'left';
    const cands = [
      ...candidates(b.side, size, vp, b.side === 'left' ? drive : turn),
      ...candidates(other, size, vp, other === 'left' ? drive : turn),
    ];
    const spot = cands.find((c) => !taken.some((t) => overlaps(c, t))) ?? cands[cands.length - 1];
    const p = spot ?? clampOn({ x: vp.w / 2, y: vp.h / 2, size }, vp);
    taken.push(p);
    out.push({ ...p, button: b, stored: false });
  }

  // back into the caller's order, so the DOM order matches the declared thumb order
  const order = new Map(buttons.map((b, i) => [b.action, i]));
  out.sort((a, b) => (order.get(a.button.action) ?? 0) - (order.get(b.button.action) ?? 0));
  return { drive, turn, buttons: out };
}
