import { useEffect, useState } from 'react';
import { fetchTitle } from '../net/api';
import { titleLabel } from '../cosmetics';
import { starPoints } from '../render/drawRobot';
import { TitleChip } from './TitleChip';

/**
 * THE DECAL, AT CHIP SIZE, FROM THE SPRITE'S OWN GEOMETRY.
 *
 * ⚠️ `starPoints` rather than a hand-written `d`, on the same 24x24 box and the same
 * `-90°` start angle the builder swatch uses (`ui/Menu.tsx`). A traced-by-eye path here
 * would be the one place in the app where the star somebody is being GIVEN is not the star
 * they then get, and the gap would never show up in a test — it would just be slightly
 * wrong forever.
 */
const STAR_PATH =
  starPoints(12, 12, 9, -Math.PI / 2)
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(' ') + ' Z';

/** the title the GitHub star grants — and, per the note in the effect below, the witness for
 *  the decal too, because the two move as a unit (`STARGAZER_GRANTS`, `server/db/repo.ts`). */
const STAR_TITLE = 'title:stargazer';

type State =
  | { kind: 'loading' }
  | { kind: 'earned' }
  /** linked, but the repo is not starred — the case that used to show nothing at all. */
  | { kind: 'not-starred' };

/**
 * WHAT YOU GOT FOR STARRING — shown once, on the bounce back from the GitHub link.
 *
 * ⚠️ **THIS EXISTS BECAUSE LINKING USED TO END IN SILENCE, AND SILENCE READS AS BROKEN.**
 * Nothing granted the reward except an hourly `setInterval`, so the best case was that a
 * person connected GitHub, saw "Disconnect", and had no way to tell whether anything had
 * happened for up to an hour. The worst case was that it NEVER happened: the interval is
 * created at boot, so every deploy pushed its first fire back another hour, and after an
 * afternoon of alpha deploys the live log had no `[rewards]` line at all. The link route
 * sweeps for itself now (`server/api.ts`), which is what lets this panel state what was
 * earned as a FACT rather than a promise.
 *
 * ⚠️ **IT READS THE SERVER'S OWN STATE, NOT THE `?link=ok` IN THE URL.** The query parameter
 * says the LINK succeeded; it says nothing about whether the repo is starred, and a panel
 * that congratulated somebody on the strength of a string in their own address bar would be
 * congratulating them for editing it. So the ids are looked up — and the "you linked but you
 * have not starred" case, which previously produced no feedback whatsoever, gets a sentence.
 */
export function StarReward() {
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    // only on the bounce back from a completed link. `LinkedAccounts` strips the parameter
    // after reading it, so this has to look BEFORE that happens — hence one effect, on mount,
    // in a component mounted above it in the same tree.
    if (new URLSearchParams(window.location.search).get('link') !== 'ok') return;
    setState({ kind: 'loading' });
    let live = true;
    /**
     * ⚠️ **THE TITLE ALONE IS THE EVIDENCE, AND `fetchEntitlements` IS DELIBERATELY NOT
     * ASKED.** The obvious version of this checked both ids — the title from `fetchTitle` and
     * the decal from the entitlements payload — and it had a bug: `fetchEntitlements` NEVER
     * THROWS. It swallows every failure and answers `NO_ENTITLEMENTS`, which carries no
     * `unlockedCosmetics` at all, because it exists to decide whether to draw ads and must not
     * break a menu. So a network blip would have read as "the decal is not there" and told
     * somebody who had just earned the reward that they had not.
     *
     * One throwing call is the honest shape. Leaning on the title is not a shortcut either:
     * the two ids are granted and revoked as a UNIT on one holder set read off the title
     * (`STARGAZER_GRANTS`, `server/db/repo.ts`), and `npm run dbtest` asserts both directions
     * of that. Checking the decal separately would be asking a second question whose answer is
     * already implied — and asking it through the one client call that cannot report failure.
     */
    fetchTitle()
      .then((t) => {
        if (!live) return;
        setState({ kind: t.earned.includes(STAR_TITLE) ? 'earned' : 'not-starred' });
      })
      // a failed lookup shows NOTHING rather than a guess in either direction: claiming a
      // reward that did not land is worse than staying quiet, and so is telling somebody who
      // just earned one that they did not.
      .catch(() => live && setState(null));
    return () => {
      live = false;
    };
  }, []);

  if (!state || state.kind === 'loading') return null;

  if (state.kind === 'not-starred') {
    return (
      <div className="ds-panel star-reward">
        <div className="ds-panel-body stack start">
          <p className="ds-hint">
            GitHub connected. Star the repo to earn the Stargazer title and the star decal.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="ds-panel star-reward on">
      <div className="ds-panel-h">
        <span className="ds-panel-title">Reward unlocked</span>
      </div>
      <div className="ds-panel-body stack start">
        <p className="ds-hint">Thanks for the star. Two things are yours to keep:</p>
        <ul className="star-reward-list">
          <li>
            <TitleChip id={STAR_TITLE} />
            <span>
              The <b>{titleLabel(STAR_TITLE)}</b> title. Equip it below and it shows beside
              your name on the leaderboards.
            </span>
          </li>
          <li>
            {/* the decal drawn at chip size, from the same `starPoints` geometry the sprite
                uses — a lookalike here would be the one place the star is not the star. */}
            <span className="star-reward-decal" role="img" aria-label="Star decal">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={STAR_PATH} />
              </svg>
            </span>
            <span>
              The <b>star decal</b>. Pick it in the robot builder, under Decal.
            </span>
          </li>
        </ul>
        {/* ⚠️ SAID HERE, NOT ONLY IN THE LINKED-ACCOUNTS PANEL. Revocation is a surprise
            somebody should meet while they are being given the thing, not discover later. */}
        <p className="ds-hint">
          Both stay while the star does. Unstarring or disconnecting GitHub takes them back.
        </p>
      </div>
    </div>
  );
}
