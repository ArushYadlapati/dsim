import { useEffect, useRef, useState } from 'react';
import type { Hint, TutorialView } from '../tutorial/types';

/** how long the counter holds "Step N done" after a step completes — real time, UI only, so the
 *  sim (which has already rebuilt the field for the next step) is untouched. */
const ACK_MS = 800;

/**
 * THE TUTORIAL STEP CARD — the one surface a tutorial adds to the game screen.
 *
 * ── WHERE IT SITS, AND WHY IT IS NOT AN OVERLAY ───────────────────────────────
 * `docs/area/ui.md` rules out popups over the field, and this is the reason the rule exists: a
 * step card is up for the whole of a step, so anything drawn on top of the field would hide the
 * exact thing the step is asking the player to look at. It is a HUD BAND instead — bottom
 * centre, above the score bar, in the same band family as the chip rows.
 *
 * `data-hud-band` is load-bearing and not decorative. `GameController.refreshHudInsets`
 * measures every `[data-hud-band]` element and hands the rectangle to the 3D scene as
 * `SceneInsets`, so in the 3D view the camera reframes the field ABOVE this card instead of
 * putting the far wall underneath it. It is also what gives the card the fixed dark scrim a 3D
 * background needs (`.game-root.view-3d [data-hud-band]` in styles.css). A card without the
 * attribute would look right in 2D and be unreadable over a lit wall in 3D.
 *
 * ── THE COPY ──────────────────────────────────────────────────────────────────
 * Sentence case, typographic punctuation, no padding words (`docs/area/ui.md`). The hint is
 * composed by the step itself against the player's LIVE bindings, so nothing here spells a key;
 * the controls in it arrive as parts and are drawn as the app's keycap (design review 12-10).
 */
export function TutorialCard({
  view,
  onSkip,
  onReplay,
  onExit,
}: {
  view: TutorialView;
  onSkip: () => void;
  onReplay: () => void;
  onExit: () => void;
}) {
  /**
   * THE STEP ACKNOWLEDGEMENT (design review 12-06). A completed step rebuilds the field on the
   * same tick, and with only the counter's text changing a new driver reads the jump as a reset.
   * So the counter holds "Step N done" for a beat and the pip row fills. A SKIP is not a success,
   * so it is marked here — the runner deliberately does not tell the two apart.
   */
  const [ack, setAck] = useState<number | null>(null);
  const prev = useRef(view.index);
  const skipped = useRef(false);
  useEffect(() => {
    const was = prev.current;
    prev.current = view.index;
    const byHand = skipped.current;
    skipped.current = false;
    if (view.index <= was || byHand) {
      setAck(null);
      return;
    }
    setAck(was);
    const t = setTimeout(() => setAck(null), ACK_MS);
    return () => clearTimeout(t);
  }, [view.index]);

  if (view.finished) {
    return (
      <div className="ds-tut" data-hud-band role="status">
        <div className="ds-tut-body">
          <p className="ds-tut-step">Done</p>
          <p className="ds-tut-title">{view.title}</p>
          <HintLine hint={view.hint} />
        </div>
        <div className="ds-tut-acts">
          <button className="game-btn primary" onClick={onExit}>
            Keep driving
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="ds-tut" data-hud-band>
      <div className="ds-tut-body">
        {/* ONE ATOMIC LIVE REGION: the counter AND the title, which change together once per
            step — about six times a tutorial, the cadence a live region is for — so a screen
            reader hears what to do next, not just that a step changed. The
            hint and nudge stay OUT: the hint is rebuilt when a pad connects, and the whole card
            on every 10 Hz poll would flood. Wears `ds-tut-body` itself so the column's gap
            between its lines is unchanged. */}
        <div className="ds-tut-body" role="status" aria-atomic="true">
          <div className="ds-tut-head">
            <p className="ds-tut-step">
              {ack !== null ? `✓ Step ${ack + 1} done` : `Step ${view.index + 1} of ${view.count}`}
            </p>
            {/* the counter already says it in words, so the pips are for the eye only */}
            <span className="ds-tut-pips" aria-hidden="true">
              {Array.from({ length: view.count }, (_, i) => (
                <span key={i} className={i < view.index ? 'on' : i === view.index ? 'cur' : undefined} />
              ))}
            </span>
          </div>
          <p className="ds-tut-title">{view.title}</p>
        </div>
        <HintLine hint={view.hint} />
        {/* THE NUDGE, after the step's own `nudgeS`. It appears rather than replacing anything,
            and it never skips on its own — a tutorial that moved on while somebody was still
            trying would be a tutorial that decided they had failed. */}
        {view.stuck && (
          <p className="ds-tut-nudge">Stuck? Replay puts the field back, Skip moves on.</p>
        )}
      </div>
      <div className="ds-tut-acts">
        <button className="game-btn" onClick={onReplay} title="Put this step back the way it started">
          Replay
        </button>
        <button
          className="game-btn"
          onClick={() => {
            skipped.current = true;
            onSkip();
          }}
          title="Move on to the next step"
        >
          Skip
        </button>
        <button className="game-btn" onClick={onExit} title="Leave the tutorial and keep driving">
          Exit
        </button>
      </div>
    </div>
  );
}

/** the hint line: prose as text, each control as a non-interactive keycap (`.ds-key.fixed`). */
function HintLine({ hint }: { hint: Hint }) {
  return (
    <p className="ds-tut-hint">
      {hint.map((p, i) =>
        typeof p === 'string' ? (
          p
        ) : (
          // a <kbd> has no role, so an aria-label on it may be ignored: the spoken name is text
          <kbd key={i} className="ds-key fixed">
            <span aria-hidden={p.name ? true : undefined}>{p.key}</span>
            {p.name && <span className="ds-sr">{p.name}</span>}
          </kbd>
        ),
      )}
    </p>
  );
}
