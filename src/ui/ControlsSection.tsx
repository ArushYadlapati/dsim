import { useEffect, useRef, useState } from 'react';
import {
  KEY_ACTIONS,
  PAD_ACTIONS,
  PAD_CHORD_GRACE_MAX_MS,
  PAD_CHORD_GRACE_MIN_MS,
  PAD_CHORD_MAX,
  DEFAULT_BINDINGS,
  assignKey,
  assignPadBind,
  cloneBindings,
  keyLabel,
  padBindLabel,
  padBinds,
  removeKey,
  removePadBind,
  type ControlBindings,
  type KeyAction,
  type PadAction,
  type PadChord,
} from '../input/bindings';
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
  catalyst: 'Catalyst pick up / place (Chain Reaction)',
  fling: 'Catapult throw (Chain Reaction)',
  bbPlaceNectar: 'Place NECTAR (BIOBUZZ)',
  bbPlace: 'Place POLLEN (BIOBUZZ)',
  bbNectar: 'Human player: enter NECTAR (BIOBUZZ)',
  driveMode: 'Swap wheel set (Butterfly)',
  flipFront: 'Flip front',
  park: 'Toggle park mode',
  start: 'Start match',
  restart: 'Restart',
};

const PAD_LABELS: Record<PadAction, string> = {
  fire: 'Shoot (hold)',
  intake: 'Intake (hold)',
  catalyst: 'Catalyst pick up / place (Chain Reaction)',
  fling: 'Catapult throw (Chain Reaction)',
  bbPlaceNectar: 'Place NECTAR (BIOBUZZ)',
  bbPlace: 'Place POLLEN (BIOBUZZ)',
  bbNectar: 'Human player: enter NECTAR (BIOBUZZ)',
  driveMode: 'Swap wheel set (Butterfly)',
  flipFront: 'Flip front',
  park: 'Toggle park mode',
  start: 'Start match',
  restart: 'Restart',
};

type Capture =
  | { kind: 'key'; action: KeyAction; slot: number }
  | { kind: 'pad'; action: PadAction; slot: number };

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
        onChangeRef.current(
          capture.kind === 'key'
            ? removeKey(bindingsRef.current, capture.action, capture.slot)
            : removePadBind(bindingsRef.current, capture.action, capture.slot),
        );
        setCapture(null);
        return;
      }
      if (capture.kind === 'key') {
        onChangeRef.current(assignKey(bindingsRef.current, capture.action, capture.slot, e.key.toLowerCase()));
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
    const { action, slot } = capture;
    const alreadyDown = new Set<number>();
    let first = true;
    let done = false;
    let raf = 0;
    let chord: number[] = [];
    const commit = () => {
      done = true;
      onChangeRef.current(assignPadBind(bindingsRef.current, action, slot, chord));
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
  const anyCombo = PAD_ACTIONS.some((a) => bindings.pad.combos[a].length > 0);
  // what a capturing PAD slot reads while the combo builds
  const padLive = chordSoFar.length === 0 ? 'PRESS…' : `${padBindLabel([...chordSoFar].sort((a, b) => a - b))} + …`;

  return (
    <section className="ds-sec">
      <h2>Controls</h2>
      {/* FIRST, above the bindings: this is the screen somebody lands on when the controls are
          the thing they do not understand, and the tutorial is the answer to that. It stays here
          for EVERYONE, unlike the Modes page's first-run card — a player who skipped it, or who
          rebound half their keys and wants to practise the new map, has no other way back in. */}
      {onTutorial && (
        <div className="ds-bind-block">
          <h3>Tutorial</h3>
          <button className="ds-btn" onClick={onTutorial}>
            Run the tutorial
          </button>
          {/* same reason the Modes card prints no count: it is per game and per robot. */}
          <p className="ds-hint">
            A few steps on the real field. The hints name whichever keys and buttons you have bound.
          </p>
        </div>
      )}
      <div className="ds-bind-block">
        <h3>Touch controls</h3>
        <button className="ds-btn" onClick={onEditTouchControls}>
          Customize touch controls
        </button>
      </div>
      <div className="ds-bind-block">
        <h3>Prediction</h3>
        <div className="ds-opts">
          {PREDICTION_PREFS.map((p) => (
            <button
              key={p}
              className={`ds-opt mini ${prediction === p ? 'on' : ''}`}
              onClick={() => setPredictionPref(p)}
            >
              <span className="ot">{PREDICTION_LABELS[p]}</span>
              <span className="od">{PREDICTION_BLURBS[p]}</span>
            </button>
          ))}
        </div>
        <p className="ds-hint">
          How much your machine works out for itself while it waits for the server. Saved on this
          device, and used only in 3D-physics rooms.
        </p>
      </div>
      <div className="ds-binds">
        <div className="ds-bind-block">
          <h3>Keyboard</h3>
          <div className="ds-bind-grid">
            {KEY_ACTIONS.map((a) => (
              <div className="ds-bind-row" key={a}>
                <span className="ds-bind-label">{KEY_LABELS[a]}</span>
                <span className="ds-keys">
                  {bindings.keys[a].map((k, i) =>
                    keycap(
                      keyLabel(k),
                      capture?.kind === 'key' && capture.action === a && capture.slot === i,
                      false,
                      () => setCapture({ kind: 'key', action: a, slot: i }),
                      i,
                    ),
                  )}
                  {bindings.keys[a].length === 0
                    ? keycap(
                        'UNBOUND',
                        capture?.kind === 'key' && capture.action === a,
                        true,
                        () => setCapture({ kind: 'key', action: a, slot: 0 }),
                      )
                    : addcap(
                        capture?.kind === 'key' && capture.action === a && capture.slot >= bindings.keys[a].length,
                        () => setCapture({ kind: 'key', action: a, slot: bindings.keys[a].length }),
                        'key',
                      )}
                </span>
              </div>
            ))}
            <div className="ds-bind-row">
              <span className="ds-bind-label">Menu</span>
              <span className="ds-keys">
                <span className="ds-key fixed">ESC</span>
              </span>
            </div>
          </div>
          <p className="ds-hint">Backspace while a key is waiting removes it.</p>
        </div>

        <div className="ds-bind-block">
          <h3>Gamepad</h3>
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
            {PAD_ACTIONS.map((a) => {
              const binds = padBinds(bindings.pad, a);
              return (
                <div className="ds-bind-row" key={a}>
                  <span className="ds-bind-label">{PAD_LABELS[a]}</span>
                  <span className="ds-keys">
                    {binds.map((c, i) =>
                      keycap(
                        padBindLabel(c),
                        capture?.kind === 'pad' && capture.action === a && capture.slot === i,
                        false,
                        () => setCapture({ kind: 'pad', action: a, slot: i }),
                        i,
                        padLive,
                      ),
                    )}
                    {binds.length === 0
                      ? keycap(
                          'UNBOUND',
                          capture?.kind === 'pad' && capture.action === a,
                          true,
                          () => setCapture({ kind: 'pad', action: a, slot: 0 }),
                          undefined,
                          padLive,
                        )
                      : addcap(
                          capture?.kind === 'pad' && capture.action === a && capture.slot >= binds.length,
                          () => setCapture({ kind: 'pad', action: a, slot: binds.length }),
                          'button or combo',
                          padLive,
                        )}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="ds-hint">
            Hold two or three buttons together for a combo, the way your own drive code reads them: the
            combo wins over the buttons it is made of, and a button that is also part of a combo fires
            on its own only after the combo wait. Backspace while a slot is waiting removes it.
          </p>
        </div>
      </div>
      <div className="ds-bind-foot">
        <button className="ds-btn" onClick={() => onChange(cloneBindings(DEFAULT_BINDINGS))}>
          Reset to defaults
        </button>
      </div>
    </section>
  );
}
