import { useEffect, useState } from 'react';
import {
  KEY_ACTIONS,
  PAD_ACTIONS,
  DEFAULT_BINDINGS,
  cloneBindings,
  keyLabel,
  padButtonLabel,
  type ControlBindings,
  type KeyAction,
  type PadAction,
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

/** a rebound key is removed from every other action it was assigned to */
function assignKey(b: ControlBindings, action: KeyAction, slot: number, key: string): ControlBindings {
  const next = cloneBindings(b);
  for (const a of KEY_ACTIONS) next.keys[a] = next.keys[a].filter((k) => k !== key);
  const list = next.keys[action];
  if (slot < list.length) list[slot] = key;
  else list.push(key);
  return next;
}

function assignPadButton(b: ControlBindings, action: PadAction, slot: number, idx: number): ControlBindings {
  const next = cloneBindings(b);
  for (const a of PAD_ACTIONS) next.pad.buttons[a] = next.pad.buttons[a].filter((i) => i !== idx);
  const list = next.pad.buttons[action];
  if (slot < list.length) list[slot] = idx;
  else list.push(idx);
  return next;
}

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

  // keyboard capture: next keydown becomes the binding; Escape cancels
  useEffect(() => {
    if (!capture) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapture(null);
        return;
      }
      if (capture.kind === 'key') {
        onChange(assignKey(bindings, capture.action, capture.slot, e.key.toLowerCase()));
        setCapture(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capture, bindings, onChange]);

  // gamepad capture: poll for a button that goes down AFTER capture starts
  useEffect(() => {
    if (!capture || capture.kind !== 'pad') return;
    const { action, slot } = capture;
    const alreadyDown = new Set<number>();
    let first = true;
    let done = false;
    let raf = 0;
    const poll = () => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const pad = Array.from(pads).find((p) => p && p.connected);
      if (pad) {
        for (let i = 0; i < pad.buttons.length; i++) {
          const pressed = pad.buttons[i].pressed || pad.buttons[i].value > 0.5;
          if (pressed && first) alreadyDown.add(i);
          else if (pressed && !alreadyDown.has(i) && !done) {
            done = true;
            onChange(assignPadButton(bindings, action, slot, i));
            setCapture(null);
            return;
          } else if (!pressed) alreadyDown.delete(i);
        }
        first = false;
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [capture, bindings, onChange]);

  const keycap = (
    label: string,
    active: boolean,
    unbound: boolean,
    onClick: () => void,
    key?: number,
  ) => (
    <button
      key={key}
      className={`ds-key ${active ? 'capturing' : ''} ${unbound ? 'unbound' : ''}`}
      onClick={onClick}
    >
      {active ? 'PRESS…' : label}
    </button>
  );

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
                  {bindings.keys[a].length === 0 &&
                    keycap(
                      'UNBOUND',
                      capture?.kind === 'key' && capture.action === a,
                      true,
                      () => setCapture({ kind: 'key', action: a, slot: 0 }),
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
            {PAD_ACTIONS.map((a) => (
              <div className="ds-bind-row" key={a}>
                <span className="ds-bind-label">{PAD_LABELS[a]}</span>
                <span className="ds-keys">
                  {bindings.pad.buttons[a].map((idx, i) =>
                    keycap(
                      padButtonLabel(idx),
                      capture?.kind === 'pad' && capture.action === a && capture.slot === i,
                      false,
                      () => setCapture({ kind: 'pad', action: a, slot: i }),
                      i,
                    ),
                  )}
                  {bindings.pad.buttons[a].length === 0 &&
                    keycap(
                      'UNBOUND',
                      capture?.kind === 'pad' && capture.action === a,
                      true,
                      () => setCapture({ kind: 'pad', action: a, slot: 0 }),
                    )}
                </span>
              </div>
            ))}
          </div>
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
