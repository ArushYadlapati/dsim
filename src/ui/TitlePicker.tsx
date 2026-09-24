import { useState } from 'react';
import { awardShortText, awardTitleId, awardTitleText, parseAwardTitleId, type AwardRow } from '../awards';
import { titleLabel } from '../cosmetics';
import { AwardBadge } from './AwardBadge';
import { TitleChip } from './TitleChip';
import { equipTitle, useRewards } from './rewardsStore';

/**
 * THE TITLE PICKER — wear one of the titles you have CLAIMED, or none.
 *
 * ⚠️ **THE LIST COMES FROM THE SERVER, NOT FROM A LOCAL GUESS.** It is `earnedTitles` (via
 * the shared reward store, `GET /api/user/rewards`), the same resolver `setTitle` validates a
 * write against, so the picker can never offer something the save would then refuse. A
 * pending reward is not on it: it is not yours until the claim dialog has shown it to you.
 * Sharing the store with that dialog is what makes a title claimed there appear here at once.
 *
 * Each tile is the mark itself (a hexagon for an award, the chip for a ledger title) with the
 * words, and — for an award — the full sentence under it, because "Record Champion" is the
 * same two words every season and the tile has to say WHICH one.
 */
/** where a LEDGER title came from — the sub-line an award gets from its own sentence */
const LEDGER_FROM: Record<string, string> = {
  'title:stargazer': 'For starring DSIM on GitHub',
};

export function TitlePicker() {
  const r = useRewards();
  const [error, setError] = useState(false);
  const earned = r.state?.earnedTitles ?? null;
  const title = r.state?.title ?? null;

  if (earned === null) return null;

  // the act and season of each award title, off the trophy case — its id carries only the key
  const rows = new Map<string, AwardRow>();
  for (const a of r.state?.awards ?? []) rows.set(awardTitleId(a), a);

  const pick = (id: string | null): void => {
    setError(false);
    void equipTitle(id).then((ok) => setError(!ok));
  };

  return (
    <div className="ds-panel">
      <div className="ds-panel-h">
        <span className="ds-panel-title">Title</span>
        <span className="ds-count">{earned.length}</span>
      </div>
      {earned.length === 0 ? (
        <div className="ds-empty">
          <div className="big">No titles yet</div>
          Finish on a ranked podium when an act ends, or on a record board when a season ends.
        </div>
      ) : (
        <div className="ds-panel-body stack start">
          {/* ONE SPELLING OF A PICK (docs/area/ui.md): `.ds-opt` tiles, not a radio list. */}
          <div className="ds-opts two" role="group" aria-label="Title">
            <button className={`ds-opt${title === null ? ' on' : ''}`} aria-pressed={title === null} onClick={() => pick(null)}>
              <span className="ot">No title</span>
              <span className="od">Nothing beside your name</span>
            </button>
            {earned.map((id) => {
              const award = parseAwardTitleId(id);
              const row = rows.get(id);
              return (
                <button key={id} className={`ds-opt${title === id ? ' on' : ''}`} aria-pressed={title === id} onClick={() => pick(id)}>
                  <span className="ot title-pick-ot">
                    {award ? <AwardBadge award={award} /> : id === 'title:stargazer' && <TitleChip id={id} />}
                    {award ? awardShortText(award) : titleLabel(id) ?? id}
                  </span>
                  <span className="od">{row ? awardTitleText(row) : award ? '' : LEDGER_FROM[id] ?? ''}</span>
                </button>
              );
            })}
          </div>
          {error && <p className="ds-hint warn">Couldn’t save that title. Check your connection and try again.</p>}
        </div>
      )}
    </div>
  );
}
