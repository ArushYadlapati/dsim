import { PAD_ACTIONS, PAD_CHORD_GRACE_MS, chordKey, padBinds, type PadAction, type PadBindings, type PadChord } from './bindings';

/**
 * WHICH PAD ACTIONS ARE ON, given which buttons are held — the one place a combo means
 * anything. DOM-free and clock-injected (`nowMs`), so `npm test` drives it frame by frame.
 *
 * With no combo bound the answer is the old one: an action is on when any of its buttons is
 * held, on the frame it is pressed, with nothing remembered between frames. That path is
 * taken explicitly, so a player who never bound a combo cannot be touched by the three rules
 * below — every one of which exists only because two binds can share a button.
 *
 * 1. THE LONGEST SATISFIED CHORD WINS. RT + D-UP held masks bare RT (Shoot) and bare D-UP
 *    (Place POLLEN): a combo that also fired everything it is made of would be useless, and
 *    the reason a driver binds one is that the buttons have run out.
 * 2. A PREFIX WAITS. Nobody presses two buttons on the same frame; the first one lands a few
 *    tens of milliseconds early and, alone, it IS bare RT. DECODE's first shot is instant, so
 *    without a wait every lift would fire a shot first. A satisfied chord that is a strict
 *    subset of some bound chord that is NOT yet satisfied is held back for the COMBO WAIT
 *    (`pad.chordGraceMs`, the player's own setting, `PAD_CHORD_GRACE_MS` by default) from the
 *    moment it completed; if the wider chord lands inside that window it fires instead (rule
 *    1), and if not, the prefix fires late by the wait and stays on while held. Only buttons
 *    that are part of some combo pay it.
 * 3. A FIRED COMBO CONSUMES ITS BUTTONS. Letting go of D-UP while RT is still down must not
 *    start shooting: the buttons a fired combo was made of fire nothing ELSE until they are
 *    released and pressed again. The combo itself keeps firing, and re-completing it fires it
 *    again — the consumption blocks a chord only when every button of it was consumed by a
 *    DIFFERENT chord, which is also what stops one finger lifting off a three-chord from
 *    firing the two-chord underneath. It is tested BEFORE rule 2, so a blocked chord is never
 *    also a waiting one (or lifting a finger off a three-chord would fire the two-chord under it
 *    as a tap).
 * 4. A TAP INSIDE THE WAIT STILL COUNTS. Rule 2 defers a prefix; it must not swallow it. A
 *    button that is part of a combo, pressed and released before the wait runs out with no
 *    wider chord having fired, fires ONCE on the frame it is let go — a quick RT tap is still
 *    one shot, and park / flip / start / restart, which are tapped by nature, still work on a
 *    button that also lives in a combo. A tapped COMBO (a two-chord under a three-chord)
 *    consumes whatever of it is still held, per rule 3.
 *
 * Two things these rules deliberately do NOT do. Overlapping chords that are not nested —
 * `LB + RT` and `RB + D-UP` both held also satisfies an `RT + D-UP` bound elsewhere — all
 * fire, which is what `&&` on the real gamepad would do too. And masking (rule 1) reads
 * SATISFIED, not fired: with a three-chord bound over a two-chord, pressing the third button's
 * partner while the single is firing silences the single for the length of the wait before the
 * two-chord fires, since the two-chord is satisfied (and waiting) the whole time.
 */
export { PAD_CHORD_GRACE_MS };

interface Bind {
  action: PadAction;
  chord: PadChord;
  key: string;
}

const isSubset = (a: PadChord, b: PadChord): boolean => a.every((i) => b.includes(i));
const isStrictSubset = (a: PadChord, b: PadChord): boolean => a.length < b.length && isSubset(a, b);

export type PadActive = Record<PadAction, boolean>;

const noneActive = (): PadActive => {
  const out = {} as PadActive;
  for (const a of PAD_ACTIONS) out[a] = false;
  return out;
};

export class PadChordResolver {
  /** when each held button went down — the clock rule 2 measures from */
  private downSince = new Map<number, number>();
  /** which fired combo each held button belongs to, until it is released (rule 3) */
  private consumedBy = new Map<number, string>();
  /** the chords rule 2 held back on the previous frame — a release before the wait ran out
   *  is a TAP (rule 4) */
  private waiting = new Map<string, Bind>();

  /** forget everything held — on a disconnect, so nothing is consumed or timed across it */
  reset(): void {
    this.downSince.clear();
    this.consumedBy.clear();
    this.waiting.clear();
  }

  resolve(heldButtons: Iterable<number>, pad: PadBindings, nowMs: number): PadActive {
    const held = new Set(heldButtons);
    const out = noneActive();

    // THE FAST PATH — no combo anywhere: the plain any-button test, and no state kept.
    let anyCombo = false;
    for (const a of PAD_ACTIONS) if (pad.combos[a].length > 0) { anyCombo = true; break; }
    if (!anyCombo) {
      this.reset();
      for (const a of PAD_ACTIONS) out[a] = pad.buttons[a].some((i) => held.has(i));
      return out;
    }

    for (const i of held) if (!this.downSince.has(i)) this.downSince.set(i, nowMs);
    for (const i of [...this.downSince.keys()]) if (!held.has(i)) this.downSince.delete(i);
    for (const i of [...this.consumedBy.keys()]) if (!held.has(i)) this.consumedBy.delete(i);

    const binds: Bind[] = [];
    for (const action of PAD_ACTIONS) {
      for (const chord of padBinds(pad, action)) binds.push({ action, chord, key: chordKey(chord) });
    }
    const allHeld = (c: PadChord): boolean => c.every((i) => held.has(i));
    const grace = pad.chordGraceMs ?? PAD_CHORD_GRACE_MS;
    // rule 4: what was waiting last frame and has been let go fires now, once
    const taps = [...this.waiting.values()].filter((b) => !allHeld(b.chord));
    this.waiting.clear();
    const satisfied = binds.filter((b) => allHeld(b.chord));
    const fired: Bind[] = [];
    for (const b of satisfied) {
      // rule 1
      if (satisfied.some((o) => isStrictSubset(b.chord, o.chord))) continue;
      // rule 3 (before rule 2, so a blocked chord never becomes a waiting one)
      const blocked = b.chord.every((i) => {
        const by = this.consumedBy.get(i);
        return by !== undefined && by !== b.key;
      });
      if (blocked) continue;
      // rule 2
      const completedAt = Math.max(...b.chord.map((i) => this.downSince.get(i) ?? nowMs));
      const widerPending = binds.some(
        (o) => isStrictSubset(b.chord, o.chord) && !allHeld(o.chord),
      );
      if (widerPending && nowMs - completedAt < grace) {
        this.waiting.set(b.key, b);
        continue;
      }
      fired.push(b);
    }
    for (const b of taps) if (!fired.some((f) => f.key === b.key)) fired.push(b);
    for (const b of fired) {
      out[b.action] = true;
      // only what is still held can be consumed; a released button's entry is already gone
      if (b.chord.length > 1) for (const i of b.chord) if (held.has(i)) this.consumedBy.set(i, b.key);
    }
    return out;
  }
}
