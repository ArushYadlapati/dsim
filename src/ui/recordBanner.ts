import type { RecordRankInfo } from '../net/protocol';

/**
 * WHAT THE BANNER ACROSS THE TOP OF A ONE-PANEL RESULTS SCREEN SAYS.
 *
 * The versus board puts WINNER there. A record run has no opponent to beat, so the same slot
 * carries what the run was actually worth — a world record, a personal best, or just where it
 * placed — and solo practice, which has no leaderboard at all, says so.
 *
 * ── THE BANNER HEADLINES, THE LINE UNDER IT QUALIFIES ───────────────────────
 * `RecordStanding` prints the category and the rank beneath this, so nothing here repeats a
 * fact that line already carries. A world record's banner does not also say `#1`, because the
 * words mean the same thing and the line says it anyway; a plain placing has no headline to
 * give, so the rank IS its banner and the line drops to the category alone.
 *
 * ── AN EMPTY STRING IS "RESERVED BUT BLANK", NOT "NO BANNER" ────────────────
 * The rank arrives after the score does, and for a signed-out run or an alpha build it never
 * arrives at all. The slot still has to hold its height through all of that, or the driver row
 * under it jumps when the server answers. The caller keeps the element and prints nothing in
 * it, exactly as the losing half of a versus board does.
 *
 * A LEAF MODULE, and DOM-free, for one reason: `npm run test:bb` imports it. `Results.tsx`
 * pulls in React, the ad slot and two dialogs, and `net/env`'s `appChannel` reads
 * `import.meta.env` at load — neither survives the headless `tsx` suite. Nothing here needs
 * either. The alpha / signed-in / still-computing distinction belongs to the LINE, not the
 * banner: all three are simply "no rank yet", and all three are blank here.
 */
export type BannerTone = 'gold' | 'quiet';

export interface ResultBanner {
  /** empty means the slot is reserved and prints nothing — see above. */
  text: string;
  /** absent is the ordinary light banner, the same one WINNER uses. */
  tone?: BannerTone;
}

/**
 * `info` is null until the server's `recordResult` lands, and forever for an anonymous run.
 * `practice` is a run with no leaderboard behind it at all, which is a different thing from a
 * record run whose rank has not arrived yet — hence a parameter and not `info === null`.
 */
export function recordBanner(info: RecordRankInfo | null, practice: boolean): ResultBanner {
  // GOLD is the system's one medal token and its comment says it is a FILL, which is exactly
  // how it is used here. A personal best takes the ordinary banner: it is the player's own
  // best, not the board's, and spending the loudest treatment on it leaves nothing for a WR.
  if (practice) return { text: 'PRACTICE', tone: 'quiet' };
  if (!info) return { text: '' };
  if (info.isWR) return { text: '🏆 WORLD RECORD', tone: 'gold' };
  if (info.isPB) return { text: '★ PERSONAL BEST' };
  return { text: `#${info.rank} OF ${info.total}`, tone: 'quiet' };
}
