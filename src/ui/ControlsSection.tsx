import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BIND_SLOTS_MAX,
  DEFAULT_BINDINGS,
  PAD_ACTIONS,
  PAD_CHORD_GRACE_MAX_MS,
  PAD_CHORD_GRACE_MIN_MS,
  PAD_CHORD_MAX,
  actionOverridable,
  assignKey,
  assignKeyInGame,
  assignPadBind,
  assignPadBindInGame,
  cloneBindings,
  effectiveBindings,
  keyDesynced,
  keyLabel,
  padBindLabel,
  padBinds,
  padButtonLabel,
  padDesynced,
  removeKey,
  removeKeyInGame,
  removePadBind,
  removePadBindInGame,
  resetGame,
  seasonKeyActions,
  seasonPadActions,
  seasonUnbound,
  sharedKeyHolder,
  sharedPadHolder,
  syncKeyInGame,
  syncPadInGame,
  type ControlBindings,
  type KeyAction,
  type PadAction,
  type PadChord,
  type PadBindings,
} from '../input/bindings';
import { resumePadNav, suspendPadNav } from '../input/padNav';
import type { GameId } from '../games/types';
import { seasonFor, type Season } from '../seasons';
import { visibleSeasons } from '../seasonVisibility';
import { OptRow, ToggleRow } from './OptRow';
import { rangeFill } from './rangeFill';
import { ACTION_LABELS, ALL_GAMES_PANELS, seasonPanel, type BindPanel } from './controlsLayout';

/**
 * WHICH MAP IS BEING EDITED. `all` is the MAIN setting — the shared controls, and the Intake and
 * Shoot every season starts from — and it is the default, with nothing remembered: a player who
 * comes back to rebind Shoot should land on the row that changes Shoot everywhere (owner,
 * 2026-09-19: "keybinds should stay the same across seasons for sure").
 *
 * A season scope lists THAT SEASON'S OWN ACTIONS and nothing else (`controlsLayout.ts` holds the
 * split, `npm test` holds it to the model). Its Intake and Shoot are overrides of main, with a
 * Sync on a row only while it differs; its season-only mechanisms are simply its binds.
 */
type Scope = GameId | 'all';

/** the game a capture commits into — `null` is the main map */
type Capture =
  | { kind: 'key'; action: KeyAction; slot: number; game: GameId | null }
  | { kind: 'pad'; action: PadAction; slot: number; game: GameId | null };

/**
 * A CAPTURE is one slot of one action waiting for input. `slot` indexes the action's list —
 * `bindings.keys[a]` for a key, `padBinds(pad, a)` (singles then combos) for the pad — and a
 * slot PAST THE END is the add slot, which is how every action can carry as many alternatives
 * as the player has buttons. The steal policy lives with the model (`assignKey` /
 * `assignPadBind` in `bindings.ts`), where `npm test` pins it.
 */
interface Props {
  bindings: ControlBindings;
  onChange: (b: ControlBindings) => void;
  /** launch Free Drive with the on-screen touch-control layout editor open */
  onEditTouchControls: () => void;
  /** run the tutorial (roadmap item 6) — absent when the active game has no tutorial, and the
   *  panel is then not rendered at all rather than shown disabled. */
  onTutorial?: () => void;
}

const REMOVE_HINT = 'Backspace while a bind is waiting removes it.';

/** "A", "A and B", "A, B and C" */
const joinAnd = (xs: readonly string[]): string =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/**
 * WHAT A MAIN EDIT TOOK FROM A ROW THE ALL GAMES SCOPE DOES NOT SHOW. Putting Shoot on C takes C
 * off Catalyst and off Place POLLEN, and neither is on this screen — they are in their seasons'
 * scopes. The steal is right (they would fire together otherwise); doing it silently is not, so
 * the line under the scope switch names every row that lost the bind, and the season buttons
 * carry a mark while a row of theirs has none.
 */
function lossNotice(
  before: ControlBindings,
  after: ControlBindings,
  device: 'key' | 'pad',
  label: string,
  seasons: readonly Season[],
): string | null {
  const lost: string[] = [];
  for (const s of seasons) {
    const e0 = effectiveBindings(before, s.key);
    const e1 = effectiveBindings(after, s.key);
    const rows: readonly KeyAction[] = device === 'key' ? seasonKeyActions(s.key) : seasonPadActions(s.key);
    for (const a of rows) {
      // Intake and Shoot on the main map ARE on this screen; only a season's own copy is not
      const desynced = device === 'key' ? keyDesynced(before, s.key, a) : padDesynced(before, s.key, a as PadAction);
      if (actionOverridable(a) && !desynced) continue;
      const n0 = device === 'key' ? e0.keys[a].length : padBinds(e0.pad, a as PadAction).length;
      const n1 = device === 'key' ? e1.keys[a].length : padBinds(e1.pad, a as PadAction).length;
      if (n1 < n0) lost.push(`${ACTION_LABELS[a]} (${s.name})`);
    }
  }
  return lost.length ? `Took ${label} from ${joinAnd(lost)}.` : null;
}

/** a season scope may not take a bind from a shared control — the one line that says so */
const refusal = (label: string, holder: KeyAction, device: 'key' | 'pad'): string =>
  `Couldn’t bind ${label}: every season uses it for ${ACTION_LABELS[holder]}. Pick another ${device === 'key' ? 'key' : 'button'}.`;

/** one pad slider row, the `.ds-field` shape Audio and Graphics use */
function PadSlider({
  label,
  shown,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string;
  shown: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className="ds-field">
      <span className="cap">
        {label} <span className="val">{shown}</span>
      </span>
      <input
        className="ds-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={shown}
        style={rangeFill(value, min, max)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function ControlsSection({ bindings, onChange, onEditTouchControls, onTutorial }: Props) {
  const [scope, setScope] = useState<Scope>('all');
  const [capture, setCapture] = useState<Capture | null>(null);
  /** the one status line under the scope switch: a refused bind, or what a main edit took from
   *  a row this scope does not show. `null` shows the Backspace hint, so the line is always there
   *  and a message never pushes the panels down. */
  const [notice, setNotice] = useState<string | null>(null);
  /** the buttons held so far while a PAD slot is capturing, in the order they went down —
   *  shown live on the keycap so a driver sees the combo build (`RT + …`) */
  const [chordSoFar, setChordSoFar] = useState<PadChord>([]);
  /**
   * THE CAPTURE EFFECTS DEPEND ON `capture` ALONE. `onChange` arrives as a fresh arrow from
   * `Configure` on every render, and the App re-renders every few seconds on its own (the
   * presence poll, among others) — with `bindings`/`onChange` in the deps, every one of those
   * restarted the pad effect mid-capture: its cleanup ran, `first` went back to true, the
   * buttons the driver was still holding were swept into `alreadyDown`, and the release then
   * committed nothing. A single-press capture was a one-frame window, so it never showed;
   * commit-on-release made it a real one. Refs give the effects the live values without
   * making them dependencies.
   */
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const seasons = useMemo(() => visibleSeasons(), []);
  const seasonsRef = useRef(seasons);
  seasonsRef.current = seasons;

  /**
   * ⚠️ PAD NAVIGATION STANDS DOWN WHILE A CAPTURE IS ARMED.
   *
   * The pad capture below takes EVERY button that goes down, which is exactly what the
   * navigation layer's A-to-activate reads — so without this, opening a pad slot with A binds A
   * to that action and then to the next one, and the screen becomes unusable with the device it
   * configures. Keyed on `capture` alone, like the two effects under it and for the same reason.
   */
  useEffect(() => {
    if (!capture) return;
    suspendPadNav('capture');
    return () => resumePadNav('capture');
  }, [capture]);

  /**
   * THE MATCH-MENU BUTTON's own capture, and it is a separate one on purpose: `menuButton` is not
   * a `PadAction` (see `PadBindings.menuButton`), so it has no slot, no combo and no steal — it
   * is one index. Commit on the first button DOWN, unlike the action capture beside it, because
   * there is no combo to wait for; Escape cancels.
   */
  const [menuCapture, setMenuCapture] = useState(false);
  useEffect(() => {
    if (!menuCapture) return;
    suspendPadNav('capture');
    let raf = 0;
    const alreadyDown = new Set<number>();
    let first = true;
    const poll = (): void => {
      raf = requestAnimationFrame(poll);
      const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
      const pad = pads.find((p) => p && p.connected);
      if (!pad) return;
      const thr = bindingsRef.current.pad.triggerThreshold;
      for (let i = 0; i < pad.buttons.length; i++) {
        const b = pad.buttons[i];
        const down = !!b && (b.pressed || b.value > thr);
        if (first) {
          if (down) alreadyDown.add(i);
          continue;
        }
        if (!down || alreadyDown.has(i)) {
          if (!down) alreadyDown.delete(i);
          continue;
        }
        const b0 = cloneBindings(bindingsRef.current);
        onChangeRef.current({ ...b0, pad: { ...b0.pad, menuButton: i } });
        setMenuCapture(false);
        return;
      }
      first = false;
    };
    raf = requestAnimationFrame(poll);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuCapture(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      resumePadNav('capture');
    };
  }, [menuCapture]);

  // keyboard capture: next keydown becomes the binding; Escape cancels. Backspace and Delete
  // REMOVE the slot instead, for either device: it is the only way to shrink a list that `+`
  // can grow, and neither key is anywhere a driving hand goes, so nothing bindable is lost.
  useEffect(() => {
    if (!capture) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapture(null);
        return;
      }
      const b = bindingsRef.current;
      const g = capture.game;
      if (e.key === 'Backspace' || e.key === 'Delete') {
        onChangeRef.current(
          capture.kind === 'key'
            ? g
              ? removeKeyInGame(b, g, capture.action, capture.slot)
              : removeKey(b, capture.action, capture.slot)
            : g
              ? removePadBindInGame(b, g, capture.action, capture.slot)
              : removePadBind(b, capture.action, capture.slot),
        );
        setCapture(null);
        return;
      }
      if (capture.kind !== 'key') return;
      const k = e.key.toLowerCase();
      if (g) {
        // REFUSED, AND STILL ARMED: the next key the player tries lands on the same slot
        const holder = sharedKeyHolder(b, k);
        if (holder) {
          setNotice(refusal(keyLabel(k), holder, 'key'));
          return;
        }
        onChangeRef.current(assignKeyInGame(b, g, capture.action, capture.slot, k));
      } else {
        const next = assignKey(b, capture.action, capture.slot, k);
        setNotice(lossNotice(b, next, 'key', keyLabel(k), seasonsRef.current));
        onChangeRef.current(next);
      }
      setCapture(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capture]);

  // gamepad capture: everything that goes down AFTER capture starts, and is still down, is the
  // bind. It COMMITS when any of those buttons is released (one button → a single, two or
  // three → a combo) or the instant it reaches `PAD_CHORD_MAX`. Committing on release rather
  // than on press is what lets a second button join; a single press costs the driver nothing
  // but the release they were going to make anyway.
  useEffect(() => {
    if (!capture || capture.kind !== 'pad') return;
    const { action, slot, game } = capture;
    const alreadyDown = new Set<number>();
    let first = true;
    let done = false;
    let raf = 0;
    let chord: number[] = [];
    /** true when the capture is over; false when it was refused and stays armed */
    const commit = (): boolean => {
      const b = bindingsRef.current;
      const sorted = [...chord].sort((x, y) => x - y);
      if (game) {
        const holder = sharedPadHolder(b, sorted);
        if (holder) {
          setNotice(refusal(padBindLabel(sorted), holder, 'pad'));
          // re-arm: whatever is still held is swept into `alreadyDown` on the next frame, so
          // only a fresh press can start the next attempt
          chord = [];
          first = true;
          setChordSoFar([]);
          return false;
        }
        onChangeRef.current(assignPadBindInGame(b, game, action, slot, chord));
      } else {
        const next = assignPadBind(b, action, slot, chord);
        setNotice(lossNotice(b, next, 'pad', padBindLabel(sorted), seasonsRef.current));
        onChangeRef.current(next);
      }
      done = true;
      setCapture(null);
      return true;
    };
    const poll = () => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const pad = Array.from(pads).find((p) => p && p.connected);
      if (pad) {
        // the same press test the game uses, so a trigger that counts as held in play (past the
        // player's own threshold) is the same trigger the capture sees
        const threshold = bindingsRef.current.pad.triggerThreshold;
        const down = new Set<number>();
        for (let i = 0; i < pad.buttons.length; i++) {
          if (pad.buttons[i].pressed || pad.buttons[i].value > threshold) down.add(i);
        }
        if (first) {
          for (const i of down) alreadyDown.add(i);
          first = false;
        } else {
          for (const i of alreadyDown) if (!down.has(i)) alreadyDown.delete(i);
          if (chord.length > 0 && chord.some((i) => !down.has(i)) && !done) {
            if (commit()) return;
          } else {
            const before = chord.length;
            for (const i of down) if (!alreadyDown.has(i) && !chord.includes(i)) chord.push(i);
            if (chord.length !== before) setChordSoFar([...chord]);
            if (chord.length >= PAD_CHORD_MAX && !done && commit()) return;
          }
        }
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => {
      cancelAnimationFrame(raf);
      setChordSoFar([]);
    };
  }, [capture]);

  const begin = (c: Capture): void => {
    setNotice(null);
    setCapture(c);
  };

  const keycap = (
    label: string,
    active: boolean,
    unbound: boolean,
    onClick: () => void,
    key?: number,
    activeLabel = 'PRESS…',
  ) => (
    <button
      key={key}
      className={`ds-key ${active ? 'capturing' : ''} ${unbound ? 'unbound' : ''}`}
      onClick={onClick}
    >
      {active ? activeLabel : label}
    </button>
  );
  /** the ADD slot: one past the end of a list that has something in it (an empty list shows
   *  UNBOUND instead, which already captures into slot 0) */
  const addcap = (active: boolean, onClick: () => void, what: string, activeLabel = 'PRESS…') => (
    <button
      key="add"
      className={`ds-key add ${active ? 'capturing' : ''}`}
      aria-label={`Add another ${what}`}
      title={`Add another ${what}`}
      onClick={onClick}
    >
      {active ? activeLabel : '+'}
    </button>
  );
  /**
   * SYNC, ON A ROW THAT DIFFERS AND NOWHERE ELSE. The old screen put SYNCED or CUSTOM beside every
   * row of a season scope and a Sync button on each, disabled on all but the ones that differed —
   * the drive keys included, which a season could not usefully change. Now only Intake and Shoot
   * can differ at all, and a row that matches All games shows nothing.
   *
   * ⚠️ ABSENT, NOT MERELY HIDDEN, while the row matches. A reserved invisible slot was tried: on a
   * phone it pushed Intake's third keycap onto a second line in EVERY season, for a button that is
   * almost never there. The button arrives with the edit that makes it mean something, and that
   * edit has already changed the row's keycaps — the row was never going to hold still through it.
   */
  const syncBtn = (label: string, onClick: () => void) => (
    <button key="sync" className="ds-btn small" title={`Use the All games bind for ${label}`} onClick={onClick}>
      Sync
    </button>
  );

  /** a combo ANYWHERE — main or any season's override. The combo wait is global, so the slider
   *  is live as soon as one map has a combo in it. */
  const anyCombo =
    PAD_ACTIONS.some((a) => bindings.pad.combos[a].length > 0) ||
    (bindings.perGame !== undefined &&
      Object.values(bindings.perGame).some((ov) =>
        Object.values(ov?.padCombos ?? {}).some((list) => (list as PadChord[]).length > 0),
      ));
  // what a capturing PAD slot reads while the combo builds
  const padLive = chordSoFar.length === 0 ? 'PRESS…' : `${padBindLabel([...chordSoFar].sort((a, b) => a - b))} + …`;

  const game: GameId | null = scope === 'all' ? null : scope;
  /** THE MAP ON SCREEN: main itself, or the season's effective map (its overrides applied and
   *  the actions it does not use already gone). Editing routes by `game`, not by this. */
  const view = game ? effectiveBindings(bindings, game) : bindings;

  const pad = bindings.pad;
  const setPad = (patch: Partial<PadBindings>): void => {
    const b = cloneBindings(bindings);
    onChange({ ...b, pad: { ...b.pad, ...patch } });
  };

  const switchScope = (s: Scope): void => {
    setScope(s);
    setNotice(null);
    // a capture belongs to the row it started on, and that row may not exist in the new scope
    setCapture(null);
  };

  const keyRow = (a: KeyAction) => {
    const list = view.keys[a];
    const armed = capture?.kind === 'key' && capture.action === a ? capture : null;
    return (
      <div className="ds-bind-row" key={a}>
        <span className="ds-bind-label">{ACTION_LABELS[a]}</span>
        {/* a keycap's own name is only its key ("W"), so the group carries the action */}
        <span className="ds-keys" role="group" aria-label={`${ACTION_LABELS[a]}, keyboard`}>
          {game &&
            keyDesynced(bindings, game, a) &&
            syncBtn(ACTION_LABELS[a], () => onChange(syncKeyInGame(bindings, game, a)))}
          {list.map((k, i) =>
            keycap(keyLabel(k), armed?.slot === i, false, () => begin({ kind: 'key', action: a, slot: i, game }), i),
          )}
          {list.length === 0
            ? keycap('UNBOUND', !!armed, true, () => begin({ kind: 'key', action: a, slot: 0, game }))
            : list.length < BIND_SLOTS_MAX &&
              addcap(!!armed && armed.slot >= list.length, () => begin({ kind: 'key', action: a, slot: list.length, game }), 'key')}
        </span>
      </div>
    );
  };

  const padRow = (a: PadAction) => {
    const binds = padBinds(view.pad, a);
    const armed = capture?.kind === 'pad' && capture.action === a ? capture : null;
    return (
      <div className="ds-bind-row" key={a}>
        <span className="ds-bind-label">{ACTION_LABELS[a]}</span>
        <span className="ds-keys" role="group" aria-label={`${ACTION_LABELS[a]}, gamepad`}>
          {game &&
            padDesynced(bindings, game, a) &&
            syncBtn(ACTION_LABELS[a], () => onChange(syncPadInGame(bindings, game, a)))}
          {binds.map((c, i) =>
            keycap(padBindLabel(c), armed?.slot === i, false, () => begin({ kind: 'pad', action: a, slot: i, game }), i, padLive),
          )}
          {binds.length === 0
            ? keycap('UNBOUND', !!armed, true, () => begin({ kind: 'pad', action: a, slot: 0, game }), undefined, padLive)
            : binds.length < BIND_SLOTS_MAX &&
              addcap(
                !!armed && armed.slot >= binds.length,
                () => begin({ kind: 'pad', action: a, slot: binds.length, game }),
                'button or combo',
                padLive,
              )}
        </span>
      </div>
    );
  };

  /** a bind panel: the keyboard and the gamepad side by side, one column each (stacked on a
   *  phone, where `.ds-binds` drops to one track) */
  const bindPanel = (p: BindPanel) => (
    <section className="ds-panel" key={`${p.id}-${game ?? 'all'}`}>
      <div className="ds-panel-h">
        <span className="ds-panel-title">{p.title}</span>
      </div>
      <div className="ds-panel-body">
        <div className="ds-binds">
          <div className="ds-bind-col">
            <h3>Keyboard</h3>
            {p.keys.map(keyRow)}
            {p.id === 'match' && (
              <div className="ds-bind-row">
                <span className="ds-bind-label">Menu</span>
                <span className="ds-keys">
                  <span className="ds-key fixed">ESC</span>
                </span>
              </div>
            )}
          </div>
          <div className="ds-bind-col">
            <h3>Gamepad</h3>
            {/* HOW A PAD DRIVES, at the head of its column, level with the drive keys: the stick
                role and the two settings that shape it are the pad's half of this panel, and they
                left the right-hand column two-thirds empty while they lived a panel further down. */}
            {p.id === 'driving' && (
              <>
                <OptRow<PadBindings['driveStick']>
                  label="Drive stick"
                  hint={`${pad.driveStick === 'left' ? 'right' : 'left'} stick turns`}
                  value={pad.driveStick}
                  cols="two"
                  mini
                  onPick={(driveStick) => setPad({ driveStick })}
                  options={[
                    { v: 'left', t: 'Left' },
                    { v: 'right', t: 'Right' },
                  ]}
                />
                <PadSlider
                  label="Stick deadzone"
                  shown={`${Math.round(pad.deadzone * 100)}%`}
                  value={pad.deadzone}
                  min={0}
                  max={0.4}
                  step={0.01}
                  onChange={(deadzone) => setPad({ deadzone })}
                />
                <PadSlider
                  label="Sensitivity curve"
                  shown={pad.curve === 1 ? '1.0 · linear' : pad.curve.toFixed(1)}
                  value={pad.curve}
                  min={1}
                  max={3}
                  step={0.1}
                  onChange={(curve) => setPad({ curve })}
                />
              </>
            )}
            {p.pads.map(padRow)}
            {p.id === 'match' && (
              <div className="ds-bind-row">
                <span className="ds-bind-label">Menu</span>
                <span className="ds-keys">
                  <button
                    className={`ds-key${menuCapture ? ' capturing' : ''}`}
                    aria-label={`Menu button, ${padButtonLabel(bindings.pad.menuButton)}. Press to rebind`}
                    onClick={() => {
                      setNotice(null);
                      setMenuCapture(true);
                    }}
                  >
                    {menuCapture ? 'PRESS…' : padButtonLabel(bindings.pad.menuButton)}
                  </button>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );

  return (
    <>
      {/* THE SCOPE SWITCH, first, because it decides what everything under it is. A season's
          button carries a mark while one of its own rows has no bind — see `lossNotice` for how
          that happens without the player ever opening that season. */}
      <div className="ds-bind-scope">
        <div className="ds-segs" role="group" aria-label="Which games these binds are for">
          <button
            className={`ds-seg ${scope === 'all' ? 'on' : ''}`}
            aria-pressed={scope === 'all'}
            onClick={() => switchScope('all')}
          >
            All games
          </button>
          {seasons.map((s) => {
            const unbound = seasonUnbound(bindings, s.key).length;
            return (
              <button
                key={s.key}
                className={`ds-seg ${scope === s.key ? 'on' : ''}`}
                aria-pressed={scope === s.key}
                aria-label={unbound ? `${s.name}, ${unbound} without a bind` : undefined}
                onClick={() => switchScope(s.key)}
              >
                {s.name}
                <span className={`ds-seg-dot${unbound ? ' lit' : ''}`} aria-hidden="true" />
              </button>
            );
          })}
        </div>
        <p className="ds-hint" role="status">
          {notice ?? REMOVE_HINT}
        </p>
      </div>

      {game === null ? (
        <>
          {/* TOUCH CONTROLS AT THE TOP (owner, 2026-09-22). It sat in a "More" fold under the
              whole keyboard map, which on a phone — the one device it is for — was the last
              thing on the page. One row: it leaves Configure for Free Drive with the layout
              editor open, so there is nothing else to put in it. */}
          <section className="ds-panel">
            <div className="ds-panel-h">
              <span className="ds-panel-title">Touch controls</span>
              <button className="ds-btn small" onClick={onEditTouchControls}>
                Customize
              </button>
            </div>
          </section>
          {/* THE TUTORIAL STAYS ON THIS SCREEN: it is where somebody lands when the controls are
              what they do not understand, and the only way back in for a player who skipped the
              Modes page's first-run card or has just rebound half their keys. */}
          {onTutorial && (
            <section className="ds-panel">
              <div className="ds-panel-h">
                <span className="ds-panel-title">Tutorial</span>
                <button className="ds-btn small" onClick={onTutorial}>
                  Start
                </button>
              </div>
            </section>
          )}

          {ALL_GAMES_PANELS.map(bindPanel)}

          {/* THE PAD'S BUTTONS — when a trigger counts as pressed, how long a combo's buttons wait,
              and whether the pad drives the menus. How a hand works, not what a button means, so
              every one is the same in every season. The `.ds-field` rows Audio and Graphics use:
              these were the only sliders in Configure drawn a different way. */}
          <section className="ds-panel">
            <div className="ds-panel-h">
              <span className="ds-panel-title">Gamepad</span>
            </div>
            <div className="ds-panel-body stack">
              <PadSlider
                label="Trigger threshold"
                shown={`${Math.round(pad.triggerThreshold * 100)}%`}
                value={pad.triggerThreshold}
                min={0.1}
                max={0.9}
                step={0.05}
                onChange={(triggerThreshold) => setPad({ triggerThreshold })}
              />
              {/* THE COMBO WAIT. Disabled rather than hidden while no combo is bound: it does
                  nothing then, and a row that appears when the first combo lands would move every
                  row under it (§1.4 of the UI standard), whereas a greyed slider says it exists. */}
              <PadSlider
                label="Combo wait"
                shown={`${Math.round(pad.chordGraceMs)} ms`}
                value={pad.chordGraceMs}
                min={PAD_CHORD_GRACE_MIN_MS}
                max={PAD_CHORD_GRACE_MAX_MS}
                step={10}
                disabled={!anyCombo}
                onChange={(chordGraceMs) => setPad({ chordGraceMs })}
              />
              {/* the one rule a player cannot work out from the keycaps: how to make a combo, and
                  that it beats its own buttons at a price */}
              <p className="ds-hint">
                Hold two or three buttons together while binding to make a combo. It wins over the
                buttons it is made of, which then fire on their own only after the combo wait.
              </p>
              <ToggleRow
                label="Controller menu navigation"
                value={pad.navEnabled}
                onPick={(navEnabled) => setPad({ navEnabled })}
              />
            </div>
          </section>
        </>
      ) : (
        bindPanel(seasonPanel(game))
      )}

      <div className="ds-actions">
        {game === null ? (
          <button
            className="ds-btn"
            onClick={() => {
              setNotice(null);
              onChange(cloneBindings(DEFAULT_BINDINGS));
            }}
          >
            Reset to defaults
          </button>
        ) : (
          <button
            className="ds-btn"
            title={`${seasonFor(game).name}’s own binds back to their defaults, and Intake and Shoot back on All games`}
            onClick={() => {
              setNotice(null);
              onChange(resetGame(bindings, game));
            }}
          >
            Reset {seasonFor(game).name}
          </button>
        )}
      </div>
    </>
  );
}
