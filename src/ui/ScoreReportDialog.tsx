import { useId, useState } from 'react';
import { REPORT_DETAIL_MAX } from '../report';

/**
 * Report a MISSCORE — a claim that the match's final score was wrong.
 *
 * A SEPARATE dialog from `ReportDialog`, not a seventh reason inside it, because it is not
 * the same kind of claim. A player report names a person and says they misbehaved; a
 * misscore names nobody — the score is the server's own arithmetic, so if it is wrong the
 * fault is the sim's, and asking the reporter to pick a culprit off the roster would be
 * asking them to invent one.
 *
 * That is also why this asks for one thing and asks for it plainly: what the score should
 * have been, and what happened that the sim got wrong. A moderator settles it by opening the
 * replay the match already stored, and the only thing a category would add is a taxonomy
 * nobody can act on.
 *
 * FREE TEXT IS REQUIRED here, where it is optional on a player report. "The score was wrong"
 * with nothing after it cannot be checked against anything, and the queue this feeds is one
 * where an unfounded claim costs the filer standing — so the form should make it hard to
 * file one by accident and easy to file a real one well.
 */
export function ScoreReportDialog({
  onSubmit,
  onClose,
}: {
  onSubmit: (detail: string) => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState('');
  const ready = detail.trim().length >= 12;
  const id = useId();

  return (
    // inline, like ReportDialog: focus goes into it on open (the textarea's autoFocus), Escape
    // closes it, and the results screen hands focus back to the link that opened it (06-03)
    <div
      className="ds-report"
      role="group"
      aria-labelledby={`${id}-h`}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <h3 className="ds-report-h" id={`${id}-h`}>Report a misscore</h3>
      <p className="ds-hint">
        Only for a score that changed the outcome. A moderator checks it against the replay.
      </p>

      <label className="ds-field col">
        <span className="cap">
          What went wrong <b>(required)</b>
        </span>
        <textarea
          className="ds-input"
          autoFocus
          rows={3}
          maxLength={REPORT_DETAIL_MAX}
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="What the score should have been, and what the sim missed"
        />
        <span className="ds-hint">
          {detail.length}/{REPORT_DETAIL_MAX}
        </span>
      </label>

      {/* Said plainly, on the form, BEFORE it is filed. The smite exists so this queue cannot
          be used as a weapon, and a penalty nobody was warned about is a trap rather than a
          deterrent — the point is that people do not file false claims, not that they are
          punished for it afterwards. */}
      <p className="ds-hint">
        Filing a claim a moderator finds to be false costs account standing.
      </p>

      <div className="ds-report-actions">
        <button className="ds-btn ghost" onClick={onClose}>
          CANCEL
        </button>
        <button
          className="ds-btn"
          disabled={!ready}
          onClick={() => {
            if (!ready) return;
            onSubmit(detail.trim());
          }}
        >
          SUBMIT
        </button>
      </div>
    </div>
  );
}
