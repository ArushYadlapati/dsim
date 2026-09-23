import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  dropQueue, elapsedLabel, exposeForTesting, peekQueue, subscribeQueue, type ParkedQueue,
} from './queueKeeper';

/** re-render on any change to the parked queue (null when nothing is parked). Lives
 *  here rather than in the keeper so that module stays React-free and its store can
 *  be exercised directly by the test suite. */
export function useParkedQueue(): ParkedQueue | null {
  return useSyncExternalStore(subscribeQueue, peekQueue, peekQueue);
}

/**
 * The standing "you are still in the ranked queue" bar.
 *
 * Only ever visible while a search is PARKED — i.e. the player queued and then went
 * somewhere else. On the matchmaking screen itself the queue is not parked (that
 * screen owns the socket), so this does not double up with the search UI there.
 *
 * It is the only thing telling someone their queue is still live while they are
 * reading a leaderboard, so it carries the two facts that matter — which bucket and
 * how long — plus the way out. Cancel drops the socket for real; there is no
 * "minimise", because a queue you cannot see and cannot leave is the thing this
 * whole feature exists to avoid.
 */
export function QueueBar({ onOpen, overlay = false }: { onOpen: () => void; overlay?: boolean }) {
  useEffect(() => exposeForTesting(import.meta.env.DEV), []);
  const q = useParkedQueue();
  const [, tick] = useState(0);

  // one repaint a second, only while the bar is up
  useEffect(() => {
    if (!q) return;
    const iv = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(iv);
  }, [q]);

  if (!q) return null;

  const found = q.found;
  // OVERLAY form, for the full-screen surfaces (a live match, a record run, a
  // lobby). Same fact, less of it: a small top-corner chip instead of a bar across
  // the bottom, where the score display lives — and no inline Cancel, because on a
  // surface you are DRIVING on, a one-click "leave the ranked queue" sitting under
  // a moving thumb is a trap. Tapping it opens the queue screen, which has Cancel.
  if (overlay && !found) {
    return (
      // the chip prints only "1V1 · 2:14", so "ranked queue" is real information —
      // but it belongs on the ACCESSIBLE NAME, not on a hover the touch users this
      // overlay exists for will never see. "tap to view" only narrates what a
      // button is.
      <button
        className="ds-queuechip"
        onClick={onOpen}
        aria-label={`In the ${q.mode.toUpperCase()} ranked queue`}
      >
        <span className="qb-dot" aria-hidden />
        <span className="qb-txt">
          {q.mode.toUpperCase()} · {elapsedLabel(q.since)}
        </span>
      </button>
    );
  }

  return (
    // NOT a live region as a whole: the elapsed clock re-renders every second and would be
    // announced every second, for as long as someone is queued. Only the found / not-found
    // phrase is live, so "Match found" is the one thing that speaks up.
    <div className={`ds-queuebar${found ? ' found' : ''}${overlay ? ' over' : ''}`}>
      <span className="qb-dot" aria-hidden />
      <span className="qb-txt">
        <span role="status">
          <b>{found ? 'Match found' : q.mode.toUpperCase()}</b>
          {!found && ' queue'}
        </span>
        {!found && (
          <>
            {' · '}
            {elapsedLabel(q.since)}
            {q.size > 0 && ` · ${q.size}/${q.need}`}
          </>
        )}
      </span>
      {q.error && (
        <span className="qb-err" role="alert">
          {q.error}
        </span>
      )}
      <button className="ds-btn small primary" onClick={onOpen}>
        {found ? 'Play →' : 'View'}
      </button>
      {!found && (
        <button className="ds-btn small ghost" onClick={dropQueue}>
          Cancel
        </button>
      )}
    </div>
  );
}
