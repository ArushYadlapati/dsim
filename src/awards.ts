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
 * THE TITLE ID FOR AN AWARD — derived from the slot, never stored as a string.
 *
 * ⚠️ IT LIVES HERE, BESIDE `parseAwardTitleId`, AND NOT IN `repo.ts`, so the writer and the
 * reader cannot drift. The server mints ids with it and the leaderboard reads them back;
 * two copies of this format in two languages of the stack is the shape of bug that shows up
 * as a chip that silently stops rendering.
 */
export function awardTitleId(
  a: Pick<AwardRow, 'game' | 'balanceVersion' | 'kind' | 'mode' | 'drivetrain' | 'rank'>,
): string {
  const dt = a.drivetrain ? `:${a.drivetrain}` : '';
  return `award:${a.game}:${a.balanceVersion}:${a.kind}:${a.mode}${dt}:${a.rank}`;
}

/**
 * READ A TITLE ID BACK INTO AN AWARD — `award:<game>:<version>:<kind>:<mode>[:<dt>]:<rank>`.
 *
 * ⚠️ THIS IS WHY THE ID IS DERIVED FROM THE SLOT RATHER THAN BEING A SURROGATE KEY. A
 * leaderboard prints the equipped title beside every name, and the alternative to parsing
 * is joining `season_awards` once per row on a board that already joins `profiles` — so
 * the id carrying its own meaning is what keeps the chip free. `badgeCols` ships the
 * column; this reads it.
 *
 * ⚠️ `act` AND `seasonNo` CANNOT BE RECOVERED and are returned as 0. They are denormalised
 * ON THE ROW for the sentence, and they are not in the key because they are not part of
 * what makes a slot unique — a season is identified by its `balanceVersion`. So a parsed
 * award renders correctly through `awardShortText` (which does not name the season) and
 * NOT through `awardTitleText`. Callers that need the full sentence read the row.
 *
 * Returns null for anything that is not a well-formed award id, including a `title:` grant
 * from the cosmetics ledger — those are registry keys, not awards, and a caller that
 * assumed otherwise would render "undefined Champion".
 */
export function parseAwardTitleId(id: string): AwardRow | null {
  const parts = id.split(':');
  if (parts[0] !== 'award') return null;
  if (parts.length !== 6 && parts.length !== 7) return null;
  const [, game, version, kind, mode, ...rest] = parts;
  const drivetrain = rest.length === 2 ? rest[0] : null;
  const rank = Number(rest[rest.length - 1]);
  const balanceVersion = Number(version);
  if (!Number.isFinite(rank) || !Number.isFinite(balanceVersion)) return null;
  if (kind !== 'ranked' && kind !== 'record_overall' && kind !== 'record_drivetrain') return null;
  if (mode !== '1v1' && mode !== '2v2' && mode !== 'solo' && mode !== 'duo') return null;
  // a drivetrain belongs to exactly one kind; anything else is a malformed id, not a
  // tolerable variant, and letting it through would print a board word that is a lie
  if ((kind === 'record_drivetrain') !== (drivetrain !== null)) return null;
  return { game: game as AwardRow['game'], balanceVersion, act: 0, seasonNo: 0, kind, mode, drivetrain, rank, score: null };
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
