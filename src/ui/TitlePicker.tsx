import { useEffect, useState } from 'react';
import { fetchTitle, saveTitle } from '../net/api';
import { awardShortText, parseAwardTitleId } from '../awards';
import { titleLabel } from '../cosmetics';
import { AwardBadge } from './AwardBadge';
import { TitleChip } from './TitleChip';

/**
 * THE TITLE PICKER — equip one of the titles you have earned, or wear none.
 *
 * ⚠️ **THE LIST COMES FROM THE SERVER, NOT FROM A LOCAL GUESS.** `GET /api/user/title`
 * answers `earnedTitles`, which is the same resolver `setTitle` validates a write against,
 * so the picker can never offer something the save would then refuse. Deriving the list
 * client-side from the profile's awards would be a second opinion about what is earned, and
 * the two would disagree the first time a `title:` grant landed that was not an award.
 *
 * An account with nothing earned renders NOTHING — no empty state. This sits on the Account
 * page among panels that each describe a thing you can change, and "Titles: you have none"
 * is a row that only ever tells somebody they are not good enough yet.
 */
export function TitlePicker() {
  const [earned, setEarned] = useState<string[] | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');

  useEffect(() => {
    let live = true;
    fetchTitle()
      .then((r) => {
        if (!live) return;
        setEarned(r.earned);
        setTitle(r.title);
      })
      .catch(() => {
        if (live) setEarned([]);
      });
    return () => {
      live = false;
    };
  }, []);

  const pick = (id: string | null): void => {
    const was = title;
    setTitle(id); // optimistic: the control is a radio and a lagging one feels broken
    setStatus('saving');
    saveTitle(id)
      .then(() => setStatus('idle'))
      .catch(() => {
        // the server refused it (403 — not earned) or the network did. Put the old one
        // back rather than leaving the UI asserting something that did not happen.
        setTitle(was);
        setStatus('error');
      });
  };

  if (earned === null || earned.length === 0) return null;

  return (
    <div className="ds-panel">
      <div className="ds-panel-h">
        <span className="ds-panel-title">Title</span>
      </div>
      <div className="ds-panel-body stack start">
        <p className="ds-hint">
          A title you have earned shows beside your name on the leaderboards. You can wear one
          at a time.
        </p>
        <ul className="title-pick">
          <li>
            <label className="ds-checkline">
              <input type="radio" name="title" checked={title === null} onChange={() => pick(null)} />
              <span>No title</span>
            </label>
          </li>
          {earned.map((id) => {
            const award = parseAwardTitleId(id);
            return (
              <li key={id}>
                <label className="ds-checkline">
                  <input type="radio" name="title" checked={title === id} onChange={() => pick(id)} />
                  {award && <AwardBadge award={award} />}
                  {/* AN AWARD gets badge + words, because the badge is a RANK NUMERAL and the
                      words are the board it was won on — two different facts. A LEDGER TITLE
                      gets the chip ALONE: the chip IS the words, so rendering both printed
                      "Stargazer Stargazer" (caught in a harness against the real stylesheet).
                      Showing the chip rather than plain text also means the row previews
                      exactly what will appear beside the name.
                      ⚠️ The `?? id` is still the last resort, for a `title:` key from a NEWER
                      build that this one has no label for — the raw slug is ugly but it is
                      better than a radio button with no text at all. `npm test` asserts every
                      key this build knows has a label, so it is unreachable here. */}
                  {award ? (
                    <span>{awardShortText(award)}</span>
                  ) : titleLabel(id) ? (
                    <TitleChip id={id} />
                  ) : (
                    <span>{id}</span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
        {status === 'error' && (
          <p className="ds-hint warn">Couldn’t save that title. Check your connection and try again.</p>
        )}
      </div>
    </div>
  );
}
