import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ACTION_GAMES,
  BIND_SLOTS_MAX,
  KEY_ACTIONS,
  PAD_ACTIONS,
  PAD_CHORD_GRACE_MAX_MS,
  PAD_CHORD_GRACE_MIN_MS,
  PAD_CHORD_MAX,
  DEFAULT_BINDINGS,
  assignKey,
  assignKeyInGame,
  assignPadBind,
  assignPadBindInGame,
  cloneBindings,
  effectiveBindings,
  gameHasOverrides,
  keyActionsFor,
  keyDesynced,
  keyLabel,
  padActionsFor,
  padBindLabel,
  padBinds,
  padDesynced,
  removeKey,
  removeKeyInGame,
  removePadBind,
  removePadBindInGame,
  syncGame,
  syncKeyInGame,
  syncPadInGame,
  type ControlBindings,
  type KeyAction,
  type PadAction,
  type PadChord,
} from '../input/bindings';
import type { GameId } from '../games/types';
import { seasonFor } from '../seasons';
import { visibleSeasons } from '../seasonVisibility';
import { OptRow } from './OptRow';
import { rangeFill } from './rangeFill';
import {
  PREDICTION_BLURBS,
  PREDICTION_LABELS,
  PREDICTION_PREFS,
  getPredictionPref,
  setPredictionPref,
  subscribePredictionPref,
  type PredictionPref,
} from '../net/predictionPref';

// The season a season-specific action belongs to is NOT written into its label any more — the
// tag beside the row carries it, derived from `ACTION_GAMES`, so it cannot go stale and it is
// not repeated on every row inside that season's own scope.
const KEY_LABELS: Record<KeyAction, string> = {
  driveUp: 'Drive forward (Tank: left side)',
  driveDown: 'Drive back (Tank: left side)',
  tankRightUp: 'Tank right side forward',
  tankRightDown: 'Tank right side back',
  driveLeft: 'Strafe left',
  driveRight: 'Strafe right',
  rotateCCW: 'Turn left',
  rotateCW: 'Turn right',
  intake: 'Intake (hold)',
  fire: 'Shoot (hold)',
  catalyst: 'Catalyst pick up / place',
  fling: 'Catapult throw',
  bbPlaceNectar: 'Place NECTAR',
  bbPlace: 'Place POLLEN',
  bbNectar: 'Human player: enter NECTAR',
  bbRamp: 'Deploy ramp',
  driveMode: 'Swap wheel set (Butterfly)',
  flipFront: 'Flip front',
  park: 'Toggle park mode',
  start: 'Start match',
  restart: 'Restart',
};

const PAD_LABELS: Record<PadAction, string> = {
  fire: 'Shoot (hold)',
  intake: 'Intake (hold)',
  catalyst: 'Catalyst pick up / place',
  fling: 'Catapult throw',
  bbPlaceNectar: 'Place NECTAR',
  bbPlace: 'Place POLLEN',
  bbNectar: 'Human player: enter NECTAR',
  bbRamp: 'Deploy ramp',
  driveMode: 'Swap wheel set (Butterfly)',
  flipFront: 'Flip front',
  park: 'Toggle park mode',
  start: 'Start match',
  restart: 'Restart',
};

/**
 * WHICH MAP IS BEING EDITED. `all` is the MAIN setting — what every season inherits and where
 * most edits belong, which is why it is the default and why nothing is remembered: a player who
 * comes back to rebind Shoot should land on the row that changes Shoot everywhere.
 *
 * A season scope edits that season's OVERRIDE of main. An action edited there is DESYNCED (its
 * binds in that season are exactly the override), an action never edited there inherits main,
 * and Sync deletes the override. Main is never written from a season scope.
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
   *  block below is then not rendered at all rather than shown disabled. */
  onTutorial?: () => void;
}

export function ControlsSection({ bindings, onChange, onEditTouchControls, onTutorial }: Props) {
  const [scope, setScope] = useState<Scope>('all');
  const [capture, setCapture] = useState<Capture | null>(null);
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
  /**
   * CLIENT PREDICTION (`docs/biobuzz/plan-3d.md` §5). Per DEVICE, so it is NOT a `GameSettings`
   * field and does not arrive through `props` — it has its own store and its own subscription,
   * the same shape the view preference uses, because a machine's speed is not a property of an
   * account (`src/net/predictionPref.ts`).
   *
   * Shown unconditionally rather than gated on the active game. It is a NETCODE setting, and
   * the screen it lives on is not in a match: the room whose physics decides whether it does
   * anything has not been joined yet, and hiding a control that will matter in five minutes is
   * how a player never finds it. The blurbs say where it applies.
   */
  const [prediction, setPrediction] = useState<PredictionPref>(() => getPredictionPref());
  useEffect(() => subscribePredictionPref(setPrediction), []);

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
      if (e.key === 'Backspace' || e.key === 'Delete') {
        const b = bindingsRef.current;
        const g = capture.game;
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
      if (capture.kind === 'key') {
        const b = bindingsRef.current;
        const k = e.key.toLowerCase();
        onChangeRef.current(
          capture.game
            ? assignKeyInGame(b, capture.game, capture.action, capture.slot, k)
            : assignKey(b, capture.action, capture.slot, k),
        );
        setCapture(null);
      }
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
    const commit = () => {
      done = true;
      const b = bindingsRef.current;
      onChangeRef.current(
        game ? assignPadBindInGame(b, game, action, slot, chord) : assignPadBind(b, action, slot, chord),
      );
      setCapture(null);
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
            commit();
            return;
          }
          const before = chord.length;
          for (const i of down) if (!alreadyDown.has(i) && !chord.includes(i)) chord.push(i);
          if (chord.length !== before) setChordSoFar([...chord]);
          if (chord.length >= PAD_CHORD_MAX && !done) {
            commit();
            return;
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
  /** a combo ANYWHERE — main or any season's override. The combo wait is global, so the slider
   *  is live as soon as one map has a combo in it, whichever scope is open. */
  const anyCombo =
    PAD_ACTIONS.some((a) => bindings.pad.combos[a].length > 0) ||
    (bindings.perGame !== undefined &&
      Object.values(bindings.perGame).some((ov) =>
        Object.values(ov?.padCombos ?? {}).some((list) => (list as PadChord[]).length > 0),
      ));
  // what a capturing PAD slot reads while the combo builds
  const padLive = chordSoFar.length === 0 ? 'PRESS…' : `${padBindLabel([...chordSoFar].sort((a, b) => a - b))} + …`;

  const seasons = useMemo(() => visibleSeasons(), []);
  const game: GameId | null = scope === 'all' ? null : scope;
  /** THE MAP ON SCREEN: main itself, or the season's effective map (its overrides applied and
   *  the actions it does not use already gone). Editing routes by `game`, not by this. */
  const view = game ? effectiveBindings(bindings, game) : bindings;
  const keyRows = game ? keyActionsFor(game) : KEY_ACTIONS;
  const padRows = game ? padActionsFor(game) : PAD_ACTIONS;

  /**
   * THE MARKER BESIDE A ROW. In a season scope it is the row's SYNCED / CUSTOM state, and it is
   * present in BOTH states on purpose — a marker that appeared only when a row went custom would
   * change the row's height at the moment of the edit (§1.4 of the UI standard). In the main
   * scope it names the seasons an action applies to, when that is not all of them, so a key
   * shared between Catalyst and Place POLLEN reads as the deliberate thing it is rather than as
   * a bug in the rebinder.
   */
  const seasonTag = (a: KeyAction): string | null => {
    const ids = ACTION_GAMES[a].filter((id) => seasons.some((s) => s.key === id));
    if (ids.length === 0 || ids.length === seasons.length) return null;
    return ids.map((id) => seasonFor(id).name).join(' · ');
  };
  const rowTag = (a: KeyAction, desynced: boolean): string | null =>
    game ? (desynced ? 'CUSTOM' : 'SYNCED') : seasonTag(a);

  const switchScope = (s: Scope): void => {
    setScope(s);
    // a capture belongs to the row it started on, and that row may not exist in the new scope
    setCapture(null);
  };

  return (
    <section className="ds-sec">
      <h2>Controls</h2>
      {/* THE SCOPE SWITCH, first, because everything under it means something different
          depending on which one is lit. */}
      <div className="ds-bind-block">
        <h3>Which map</h3>
        <div className="ds-segs" role="group" aria-label="Which control map to edit">
          <button
            className={`ds-seg ${scope === 'all' ? 'on' : ''}`}
            aria-pressed={scope === 'all'}
            onClick={() => switchScope('all')}
          >
            All games
          </button>
          {seasons.map((s) => (
            <button
              key={s.key}
              className={`ds-seg ${scope === s.key ? 'on' : ''}`}
              aria-pressed={scope === s.key}
              onClick={() => switchScope(s.key)}
            >
              {s.name}
            </button>
          ))}
        </div>
        <p className="ds-hint">
          {game
            ? `Rebinding here changes ${seasonFor(game).name} alone. Sync puts a row back on the shared bind.`
            : 'The shared map every season starts from.'}
        </p>
      </div>
      {/* THE TUTORIAL STAYS VISIBLE, and first. This is the screen somebody lands on when the
          controls are the thing they do not understand, and it is the only way back in for a
          player who skipped the Modes page's first-run card or who has just rebound half their
          keys. The sentence that used to sit under it said the button's own name back to it. */}
      {onTutorial && (
        <div className="ds-bind-block">
          <h3>Tutorial</h3>
          <button className="ds-btn" onClick={onTutorial}>
            Run the tutorial
          </button>
        </div>
      )}
      <div className="ds-binds">
        <div className="ds-bind-block">
          <h3>Keyboard</h3>
          <div className="ds-bind-grid">
            {keyRows.map((a) => {
              const list = view.keys[a];
              const desynced = !!game && keyDesynced(bindings, game, a);
              const tag = rowTag(a, desynced);
              return (
                <div className="ds-bind-row" key={a}>
                  <span className="ds-bind-label">{KEY_LABELS[a]}</span>
                  {tag && <span className="ds-note">{tag}</span>}
                  <span className="ds-keys">
                    {game && (
                      <button
                        className="ds-btn small"
                        disabled={!desynced}
                        title={`Use the shared bind for ${KEY_LABELS[a]}`}
                        onClick={() => onChange(syncKeyInGame(bindings, game, a))}
                      >
                        Sync
                      </button>
                    )}
                    {list.map((k, i) =>
                      keycap(
                        keyLabel(k),
                        capture?.kind === 'key' && capture.action === a && capture.slot === i,
                        false,
                        () => setCapture({ kind: 'key', action: a, slot: i, game }),
                        i,
                      ),
                    )}
                    {list.length === 0
                      ? keycap(
                          'UNBOUND',
                          capture?.kind === 'key' && capture.action === a,
                          true,
                          () => setCapture({ kind: 'key', action: a, slot: 0, game }),
                        )
                      : list.length < BIND_SLOTS_MAX &&
                        addcap(
                          capture?.kind === 'key' && capture.action === a && capture.slot >= list.length,
                          () => setCapture({ kind: 'key', action: a, slot: list.length, game }),
                          'key',
                        )}
                  </span>
                </div>
              );
            })}
            <div className="ds-bind-row">
              <span className="ds-bind-label">Menu</span>
              <span className="ds-keys">
                <span className="ds-key fixed">ESC</span>
              </span>
            </div>
          </div>
          <p className="ds-hint">Backspace while a key is waiting removes it.</p>
        </div>

        {/* TWO BLOCKS, NOT ONE, IN ONE COLUMN. "How the sticks feel" and "what this button
            does" were seventeen undifferentiated `.ds-bind-row`s in one grid — the six sliders
            and stick roles are GLOBAL (they are how a hand works), the rows under them are
            per-season binds, and the layout said nothing about either. `.ds-bind-col` keeps
            `.ds-binds` at two children; see its rule for what three did. */}
        <div className="ds-bind-col">
        <div className="ds-bind-block">
          <h3>Gamepad sticks</h3>
          <div className="ds-bind-grid">
            <div className="ds-bind-row">
              <span className="ds-bind-label">Drive stick</span>
              <span className="ds-keys">
                <button
                  className={`ds-key ${bindings.pad.driveStick === 'left' ? 'selected' : ''}`}
                  onClick={() =>
                    onChange({ ...cloneBindings(bindings), pad: { ...bindings.pad, driveStick: 'left' } })
                  }
                >
                  LEFT
                </button>
                <button
                  className={`ds-key ${bindings.pad.driveStick === 'right' ? 'selected' : ''}`}
                  onClick={() =>
                    onChange({ ...cloneBindings(bindings), pad: { ...bindings.pad, driveStick: 'right' } })
                  }
                >
                  RIGHT
                </button>
              </span>
            </div>
            <div className="ds-bind-row">
              <span className="ds-bind-label">Turn stick</span>
              <span className="ds-keys">
                <span className="ds-key fixed">
                  {bindings.pad.driveStick === 'left' ? 'RIGHT (X axis)' : 'LEFT (X axis)'}
                </span>
              </span>
            </div>
            <div className="ds-bind-row">
              <span className="ds-bind-label">Stick deadzone {Math.round(bindings.pad.deadzone * 100)}%</span>
              <input
                type="range"
                min={0}
                max={0.4}
                step={0.01}
                value={bindings.pad.deadzone}
                style={rangeFill(bindings.pad.deadzone, 0, 0.4)}
                onChange={(e) =>
                  onChange({ ...cloneBindings(bindings), pad: { ...bindings.pad, deadzone: Number(e.target.value) } })
                }
              />
            </div>
            <div className="ds-bind-row">
              <span className="ds-bind-label">
                Sensitivity curve {bindings.pad.curve.toFixed(1)}
                {bindings.pad.curve === 1 ? ' (linear)' : ''}
              </span>
              <input
                type="range"
                min={1}
                max={3}
                step={0.1}
                value={bindings.pad.curve}
                style={rangeFill(bindings.pad.curve, 1, 3)}
                onChange={(e) =>
                  onChange({ ...cloneBindings(bindings), pad: { ...bindings.pad, curve: Number(e.target.value) } })
                }
              />
            </div>
            <div className="ds-bind-row">
              <span className="ds-bind-label">
                Trigger threshold {Math.round(bindings.pad.triggerThreshold * 100)}%
              </span>
              <input
                type="range"
                min={0.1}
                max={0.9}
                step={0.05}
                value={bindings.pad.triggerThreshold}
                style={rangeFill(bindings.pad.triggerThreshold, 0.1, 0.9)}
                onChange={(e) =>
                  onChange({
                    ...cloneBindings(bindings),
                    pad: { ...bindings.pad, triggerThreshold: Number(e.target.value) },
                  })
                }
              />
            </div>
            {/* THE COMBO WAIT. Disabled rather than hidden while no combo is bound: it does nothing
                then, and a row that appears when the first combo lands would move every row under
                it (§1.4 of the UI standard), whereas a greyed slider says the setting exists. */}
            <div className="ds-bind-row">
              <span className="ds-bind-label">Combo wait {Math.round(bindings.pad.chordGraceMs)} ms</span>
              <input
                type="range"
                min={PAD_CHORD_GRACE_MIN_MS}
                max={PAD_CHORD_GRACE_MAX_MS}
                step={10}
                value={bindings.pad.chordGraceMs}
                disabled={!anyCombo}
                aria-label="Combo wait"
                style={rangeFill(bindings.pad.chordGraceMs, PAD_CHORD_GRACE_MIN_MS, PAD_CHORD_GRACE_MAX_MS)}
                onChange={(e) =>
                  onChange({
                    ...cloneBindings(bindings),
                    pad: { ...bindings.pad, chordGraceMs: Number(e.target.value) },
                  })
                }
              />
            </div>
          </div>
          <p className="ds-hint">The stick roles and these five sliders are the same in every season.</p>
        </div>

        <div className="ds-bind-block">
          <h3>Gamepad buttons</h3>
          <div className="ds-bind-grid">
            {padRows.map((a) => {
              const binds = padBinds(view.pad, a);
              // singles and combos are ONE unit here — "the binds of Shoot on a pad in BIOBUZZ"
              // is one thing to desync and one thing to sync back.
              const desynced = !!game && padDesynced(bindings, game, a);
              const tag = rowTag(a, desynced);
              return (
                <div className="ds-bind-row" key={a}>
                  <span className="ds-bind-label">{PAD_LABELS[a]}</span>
                  {tag && <span className="ds-note">{tag}</span>}
                  <span className="ds-keys">
                    {game && (
                      <button
                        className="ds-btn small"
                        disabled={!desynced}
                        title={`Use the shared binds for ${PAD_LABELS[a]}`}
                        onClick={() => onChange(syncPadInGame(bindings, game, a))}
                      >
                        Sync
                      </button>
                    )}
                    {binds.map((c, i) =>
                      keycap(
                        padBindLabel(c),
                        capture?.kind === 'pad' && capture.action === a && capture.slot === i,
                        false,
                        () => setCapture({ kind: 'pad', action: a, slot: i, game }),
                        i,
                        padLive,
                      ),
                    )}
                    {binds.length === 0
                      ? keycap(
                          'UNBOUND',
                          capture?.kind === 'pad' && capture.action === a,
                          true,
                          () => setCapture({ kind: 'pad', action: a, slot: 0, game }),
                          undefined,
                          padLive,
                        )
                      : binds.length < BIND_SLOTS_MAX &&
                        addcap(
                          capture?.kind === 'pad' && capture.action === a && capture.slot >= binds.length,
                          () => setCapture({ kind: 'pad', action: a, slot: binds.length, game }),
                          'button or combo',
                          padLive,
                        )}
                  </span>
                </div>
              );
            })}
          </div>
          {/* ONE SENTENCE. This was four, and two of them restated the other blocks: the
              Backspace line is already under the keyboard grid, and the stick sliders now say
              for themselves that they are global. What is left is the one rule a player cannot
              work out from the keycaps — that a combo beats its own buttons, at a price. */}
          <p className="ds-hint">
            Hold two or three buttons together for a combo. It wins over the buttons it is made of,
            which then fire on their own only after the combo wait.
          </p>
        </div>
        </div>
      </div>
      <div className="ds-bind-foot">
        <button className="ds-btn" onClick={() => onChange(cloneBindings(DEFAULT_BINDINGS))}>
          Reset to defaults
        </button>
        {/* DISABLED RATHER THAN HIDDEN while a season has nothing custom — the same reason the
            combo-wait slider is: a button that appeared on the first custom row would move the
            foot under it, and a greyed control says the way back exists. */}
        {game && (
          <button
            className="ds-btn"
            disabled={!gameHasOverrides(bindings, game)}
            onClick={() => onChange(syncGame(bindings, game))}
          >
            Sync all to shared
          </button>
        )}
      </div>
      {/* ── THE TWO THINGS THAT ARE NOT A BINDING ────────────────────────────────────────
          Touch controls leaves Configure entirely (it launches Free Drive with the layout
          editor open) and prediction is a NETCODE setting. Both used to sit above the
          bindings with the same weight as the whole keyboard map, pushing the rows somebody
          came for off the first screen. Folded, they cost one row; open, they are exactly
          where they were.

          PREDICTION IS STILL NOT GATED ON THE ACTIVE GAME, for the reason it never was: the
          room whose physics decides whether it does anything has not been joined yet, and
          hiding a control that will matter in five minutes is how a player never finds it. */}
      <details className="ds-fold">
        <summary>More</summary>
        <div className="ds-fold-body">
          <div className="ds-bind-block">
            <h3>Touch controls</h3>
            <button className="ds-btn" onClick={onEditTouchControls}>
              Customize touch controls
            </button>
          </div>
          <div className="ds-bind-block">
            <h3>Network prediction</h3>
            <OptRow<PredictionPref>
              value={prediction}
              onPick={setPredictionPref}
              options={PREDICTION_PREFS.map((p) => ({
                v: p,
                t: PREDICTION_LABELS[p],
                d: PREDICTION_BLURBS[p],
              }))}
            />
            <p className="ds-hint">Saved on this device. Used only in 3D-physics rooms.</p>
          </div>
        </div>
      </details>
    </section>
  );
}
