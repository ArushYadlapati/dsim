import type { GameId } from './games/types';
import { seasonFor } from './seasons';
import { DRIVETRAIN_LABELS } from './ui/labelData';
import type { DrivetrainType } from './types';

/**
 * SEASON AWARDS, the client's half — the TITLE SENTENCE and the badge's rank.
 *
 * The server mints the rows (`season_awards`, migration 0045) and derives the KEY
 * (`awardTitleId`, `server/db/repo.ts`); this file turns one into words. The split is
 * deliberate and it is the same one `labelData.ts` exists for: an id is a stable thing that
 * goes in a database and a URL, a sentence is a thing a designer rewrites. Storing the
 * sentence would have frozen every past award's wording at the moment it was minted.
 *
 * DOM-free and dependency-light so `scripts/smoke.ts` can drive it directly.
 */

/** the public shape of an award row — what the API sends, mirroring `SeasonAward`. */
export interface AwardRow {
  game: GameId;
  balanceVersion: number;
  act: number;
  /** the season's number within its act — "Act 2 Season 3" */
  seasonNo: number;
  kind: 'ranked' | 'record_overall' | 'record_drivetrain';
  mode: '1v1' | '2v2' | 'solo' | 'duo';
  drivetrain: string | null;
  rank: number;
  score: number | null;
}

/**
 * RANK 1..3 AS A WORD (owner, 2026-09-21: "Finalist, Semifinalist sounds good").
 *
 * ⚠️ A PER-DRIVETRAIN AWARD IS ALWAYS `Champion`, whatever its rank says, because that
 * board's award depth is ONE (`AWARD_DEPTH`, repo.ts) and there is no 2nd or 3rd there for
 * the word to be relative to. "Finalist" on a field of one is a lie, and the rank column
 * being 1 on every such row is exactly what would make that lie easy to ship.
 */
export function awardRankWord(kind: AwardRow['kind'], rank: number): string {
  if (kind === 'record_drivetrain') return 'Champion';
  if (rank === 1) return 'Champion';
  if (rank === 2) return 'Finalist';
  if (rank === 3) return 'Semifinalist';
  return `#${rank}`;
}

/** what the award is OF — the board, in the fewest words that stay unambiguous. */
export function awardBoardWord(a: Pick<AwardRow, 'kind' | 'mode' | 'drivetrain'>): string {
  if (a.kind === 'ranked') return a.mode; // '1v1' | '2v2'
  const dt = a.drivetrain ? (DRIVETRAIN_LABELS[a.drivetrain as DrivetrainType] ?? a.drivetrain) : null;
  const solo = a.mode === 'duo' ? 'Duo ' : '';
  // "Record" is the board's own name on the site, so a record award says so rather than
  // inventing a synonym the player would have to map back to a page they know.
  return dt ? `${solo}${dt} Record` : `${solo}Record`;
}

/**
 * THE FULL SENTENCE — `DECODE · Act 2 Season 3 · 1v1 Champion`.
 *
 * The separator is ` · `, which is what `seasons.ts` already uses for a period label, so an
 * award reads like the rest of the site rather than like a new kind of string.
 */
export function awardTitleText(a: AwardRow): string {
  const season = seasonFor(a.game).name;
  return `${season} · Act ${a.act} Season ${a.seasonNo} · ${awardBoardWord(a)} ${awardRankWord(a.kind, a.rank)}`;
}

/** the SHORT form for a chip beside a name, where the season is already context. */
export function awardShortText(a: AwardRow): string {
  return `${awardBoardWord(a)} ${awardRankWord(a.kind, a.rank)}`;
}

/**
 * WHICH RANK THE BADGE SHOWS — 1, 2 or 3, and nothing else.
 *
 * A per-drivetrain award is rank 1 of its own board, so it shows a 1. Anything past 3 is
 * not a thing any current board mints (`AWARD_DEPTH` caps at 3) and would not fit the chip;
 * it degrades to 3 rather than overflowing a 12-px hexagon with "#11".
 */
export function awardBadgeRank(a: Pick<AwardRow, 'rank'>): 1 | 2 | 3 {
  return a.rank <= 1 ? 1 : a.rank === 2 ? 2 : 3;
}

/**
 * SORT for a profile's award list: newest season first, then the most impressive.
 *
 * Rank ascends before board, so a player's 1st places group ahead of their 3rds within a
 * season — which is the order somebody reads their own trophy case in.
 */
export function compareAwards(a: AwardRow, b: AwardRow): number {
  if (a.balanceVersion !== b.balanceVersion) return b.balanceVersion - a.balanceVersion;
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  if (a.mode !== b.mode) return a.mode < b.mode ? -1 : 1;
  return (a.drivetrain ?? '') < (b.drivetrain ?? '') ? -1 : 1;
}
