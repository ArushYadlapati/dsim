import { useState } from 'react';
import { APP_NAME } from '../seasons';
import { QueueCounts } from './QueueCounts';
import { useLanEnabled } from './useLanEnabled';
import { markTutorialSeen, tutorialSeen } from '../tutorial/flag';
import type { GameId } from '../games/types';

/**
 * Game-mode select — reached from PLAY. These are the tiles that used to live on
 * Home. Every start action is still wrapped in App's `guardStart()` (stale-build
 * refresh + scheduled-restart block) by the caller, so nothing here bypasses it.
 */
export function ModeSelect({
  multiplayer,
  signedIn,
  onLan,
  activeGame,
  onRejoin,
  onFreeDrive,
  onSoloMatch,
  onRecordRun,
  onDuoRecord,
  onRanked,
  onCustomRoom,
  onWatch,
  compete = true,
  onTutorial,
  game,
}: {
  multiplayer: boolean;
  signedIn: boolean;
  /** show the "Compete · online" tileset (ranked + records). Off inside a Discord
   * Activity, which has no account (auth is CSP-blocked in the embed) and is meant
   * as a drop-in casual lobby — so ranked/records would only show as dead tiles. */
  compete?: boolean;
  /** a multiplayer game this browser is mid-way through (offer to rejoin it), or null */
  activeGame: { kind: 'ranked' | 'custom' | 'record' } | null;
  onRejoin: () => void;
  onFreeDrive: () => void;
  onSoloMatch: () => void;
  onRecordRun: () => void;
  onDuoRecord: () => void;
  onRanked: () => void;
  onCustomRoom: () => void;
  onWatch: () => void;
  /** host or join a game on this network (docs/lan-selfhost.md) */
  onLan: () => void;
  /**
   * START THE TUTORIAL — absent when the active game has no tutorial, in which case this page
   * shows nothing about one.
   *
   * The CARD below is offered only to a device that has not been through it (`tutorialSeen`,
   * per-device and fail-open like `chainDisclaimer`). It is not a permanent tile: once you have
   * played, an offer to be taught is clutter on the page you go through to start every run, and
   * Controls keeps an entry that runs it again for anybody who wants it.
   */
  onTutorial?: () => void;
  /** the season the offer is for: the seen flag is kept PER GAME (design review 12-12).
   *  Absent ⇒ the legacy reading, "has this device been through any tutorial". */
  game?: GameId;
}) {
  const lanOn = useLanEnabled();
  /**
   * READ ONCE, at mount. A lazy initializer rather than a call in the render body: the flag is
   * set by the tutorial itself, so re-reading it on every render would make the card vanish
   * mid-interaction if this page happened to re-render while a run was finishing elsewhere.
   */
  const [seen, setSeen] = useState(() => tutorialSeen(game));
  return (
    <>
      <h1 className="ds-h1">Pick a mode</h1>

      {activeGame && (
        <div className="ds-rejoin" role="alert">
          <b>You’re already in a game.</b>
          <button className="ds-btn primary" onClick={onRejoin}>
            Rejoin match →
          </button>
        </div>
      )}

      {/* THE FIRST-RUN TUTORIAL OFFER, above the modes and below the rejoin banner.
          Above them because it is the thing a new player should do first and the modes are what
          they would otherwise guess at; a single card rather than a tile in the Practice set,
          because it disappears for good once the device has been through it and a grid that
          changes shape is harder to learn than a banner that goes away. */}
      {onTutorial && !seen && (
        <div className="ds-tut-offer">
          {/* NO SUB-LINE. "Learn the controls on the real field." said what the button under it
              says, and NO STEP COUNT either: it was "Six steps", which is BIOBUZZ’s number —
              DECODE’s tutorial has four, and a build with no Box Tube is asked five. The count is
              resolved per game and per ROBOT (`TutorialStep.applies`), so the only honest place it
              can be printed is the card itself, which does print it. */}
          <b>New to {APP_NAME}?</b>
          {/* NOT NOW sets the flag that finishing or exiting a run sets (design review 12-13): an
              experienced driver on a new device should not have to start the tutorial to get
              rid of the offer for it. */}
          <span className="ds-tut-offer-acts">
            <button
              className="ds-btn ghost"
              onClick={() => {
                markTutorialSeen(game);
                setSeen(true);
              }}
            >
              Not now
            </button>
            <button className="ds-btn primary" onClick={onTutorial}>
              Start the tutorial →
            </button>
          </span>
        </div>
      )}

      {/* Offline, always available — the safe default (Solo Practice is primary).
          A TILE IS ITS TITLE: the mono kicker over each one (SOLO, RECORDS, LIVE …) repeated the
          title or the set's own label, so it is gone. */}
      <section className="ds-tileset">
        <p className="ds-tileset-label">Practice · offline</p>
        <div className="ds-tiles">
          <button className="ds-tile primary" onClick={onSoloMatch}>
            <span>
              <span className="t">Solo Practice</span>
            </span>
          </button>

          <button className="ds-tile" onClick={onFreeDrive}>
            <span>
              <span className="t">Free Drive</span>
            </span>
          </button>
        </div>
      </section>

      {/* Online — ranked + score-attack records (need the game server / sign-in) */}
      {compete && (
      <section className="ds-tileset">
        <p className="ds-tileset-label">Compete · online</p>
        <div className="ds-tiles">
          <button className="ds-tile" onClick={onRanked} disabled={!multiplayer || !signedIn}>
            <span>
              <span className="t">
                Find Match
                <QueueCounts className="tile" />
              </span>
              {/* ⚠️ CONDITIONAL, and it must stay that way. A previous pass rendered
                  this line ALWAYS, with a non-breaking space when there was nothing to
                  say, to stop the tile growing when `signedIn` resolves asynchronously.
                  That trade is backwards: `.ds-tiles` is a grid, so the reserved line
                  made Find Match, Solo Record AND Duo Record permanently a line taller
                  for everyone, to spare signed-in users one shrink at first paint —
                  and most visitors are signed out, where the line is there from the
                  start and never moves at all. If the shift is worth fixing, thread an
                  `authReady` flag down from AccountSync; do not reserve the line. */}
              {(!multiplayer || !signedIn) && (
                <span className="d">
                  {!multiplayer ? 'Needs the game server' : 'Sign in to play ranked'}
                </span>
              )}
            </span>
          </button>

          <button className="ds-tile" onClick={onRecordRun} disabled={!multiplayer}>
            <span>
              <span className="t">Solo Record</span>
              {!multiplayer && <span className="d">Needs the game server</span>}
            </span>
          </button>

          <button className="ds-tile" onClick={onDuoRecord} disabled={!multiplayer}>
            <span>
              <span className="t">Duo Record</span>
              {!multiplayer && <span className="d">Needs the game server</span>}
            </span>
          </button>
        </div>
      </section>
      )}

      {/* Custom room */}
      <section className="ds-tileset">
        <p className="ds-tileset-label">Custom · online</p>
        <div className="ds-tiles">
          <button className="ds-tile" onClick={onCustomRoom} disabled={!multiplayer}>
            <span>
              <span className="t">Custom Room</span>
              {!multiplayer && <span className="d">Needs the game server</span>}
            </span>
          </button>
          <button className="ds-tile" onClick={onWatch} disabled={!multiplayer}>
            <span>
              <span className="t">Watch Live</span>
              {!multiplayer && <span className="d">Needs the game server</span>}
            </span>
          </button>
        </div>
      </section>

      {/* LAN — LAST on the page (owner, 2026-09-13). Never disabled on `multiplayer`: not
          needing our servers is the point of it.

          Hidden entirely where `LAN_ENABLED` is off, rather than shown disabled: a greyed tile
          advertises a mode this build will not play, and the reason it is off is that the
          feature is being held back, not that the player is missing a prerequisite. */}
      {lanOn && (
        <section className="ds-tileset">
          <p className="ds-tileset-label">LAN · same network</p>
          <div className="ds-tiles">
            <button className="ds-tile" onClick={onLan}>
              <span>
                <span className="t">Host or Join</span>
              </span>
            </button>
          </div>
        </section>
      )}
    </>
  );
}
