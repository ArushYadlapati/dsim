import { RANKED_JOIN_GRACE_MS, STRATEGY_DURATION_MS } from './protocol';

/**
 * THE RANKED MATCH THIS BROWSER HAS BEEN ASSIGNED BUT HAS NOT STARTED YET.
 *
 * `activeGame` is the record of a match that is RUNNING, and it cannot be written until
 * `matchStart` arrives because it carries that payload. Between the assignment and the
 * first tick there was therefore nothing written down at all — and that window is twenty
 * seconds of join grace plus twenty of strategy, on a screen whose entire state lived in
 * a module singleton and a React tree. A page load took all of it: the queue keeper is
 * memory, the room code was in memory, and the player came back to a menu while the
 * server counted down a match it still expected them at and then billed them for missing.
 *
 * Which is the whole of the reported bug — "all I did was wait, and I was shown that
 * there were 2/2 people present and my match was starting". PR #70 named the reload in
 * the copy and asked before it; this is the other half, the way back afterwards. The
 * server holds the seat for a socket that closed without deciding to (`Room.detach`), and
 * this is how the browser knows which room to go and sit back down in.
 *
 * Deliberately NOT the client id: a page load loses it, and the room hands the seat back
 * on the ACCOUNT instead (`seatFor` in the join path). The room code and its region are
 * all a reload needs.
 */
export interface StagedMatchRef {
  /** the region-coded room the matchmaker assigned */
  room: string;
  savedAt: number;
}

const KEY = 'decodesim.stagedMatch.v1';

/**
 * How long the record is worth acting on. The server's own clocks bound the match this
 * points at — the join grace, then the strategy window — so a little past their sum is
 * the point after which returning can only land on a room that has already cancelled.
 * Read from the same constants the server counts on, so tuning either window moves this
 * with it rather than leaving a number here to go quietly wrong.
 */
const TTL_MS = RANKED_JOIN_GRACE_MS + STRATEGY_DURATION_MS + 15_000;

export function saveStagedMatch(room: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ room, savedAt: Date.now() } satisfies StagedMatchRef));
  } catch {
    /* storage unavailable — a reload just won't be offered the way back */
  }
}

/** the staged match worth returning to, or null if none / expired / corrupt (both of
 *  the latter are cleared as a side effect). */
export function loadStagedMatch(): StagedMatchRef | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as StagedMatchRef;
    if (!r || typeof r.room !== 'string' || typeof r.savedAt !== 'number') {
      clearStagedMatch();
      return null;
    }
    if (Date.now() - r.savedAt > TTL_MS) {
      clearStagedMatch();
      return null;
    }
    return r;
  } catch {
    clearStagedMatch();
    return null;
  }
}

export function clearStagedMatch(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
