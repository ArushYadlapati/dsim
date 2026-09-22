import type { GameId } from './games/types';
import { seasonFor } from './seasons';
import { DRIVETRAIN_LABELS } from './ui/labelData';
import type { DrivetrainType } from './types';
import { awardRankWord, awardTitleText, parseAwardTitleId } from './awards';
import { BADGE_LABELS, isBadgeId, type BadgeId } from './badges';
import { titleLabel } from './cosmetics';

/**
 * THE REWARD LEDGER'S SHARED SHAPES, and the words for them.
 *
 * The server mints `reward_grants` rows (migration 0048, `server/db/repo.ts`) as structured
 * data — WHAT is delivered (`items`) and WHY (`reason`) — and this file turns one into the
 * sentences the claim dialog shows. Same split `src/awards.ts` makes for a title: an id and a
 * reason are stable things that go in a database, a sentence is a thing a designer rewrites.
 *
 * DOM-free, so `scripts/smoke.ts` drives it directly.
 */

/** one thing a grant delivers when it is claimed. */
export type RewardItem =
  | { kind: 'title'; id: string }
  | { kind: 'badge'; id: BadgeId }
  | { kind: 'cosmetic'; id: string };

/** one placement a record award is for. `board` is `overall` or a drivetrain. */
export interface RecordPlacement {
  board: 'overall' | DrivetrainType;
  rank: number;
  /** the run's score at close — informational, the award never re-derives from it */
  score: number | null;
  /** the DUO board, when one is ever awarded (`RECORD_AWARD_MODES`); absent means solo */
  mode?: 'duo';
}

/** WHY a grant exists — the structured half of the sentence. */
export type RewardReason =
  | {
      kind: 'ranked_act';
      game: GameId;
      act: number;
      mode: '1v1' | '2v2';
      rank: number;
      /** the rating the ladder closed on */
      rating: number | null;
      /** the act's last season, so a trophy case can sort an act award beside season ones */
      balanceVersion?: number;
    }
  | {
      kind: 'record_season';
      game: GameId;
      act: number;
      seasonNo: number;
      balanceVersion: number;
      placements: RecordPlacement[];
    }
  | { kind: 'stargazer' }
  | { kind: 'other'; note?: string };

/** where a grant came from. `SOURCES` in `server/db/repo.ts` says which of these are silent. */
export type RewardSource = 'ranked_act' | 'record_season' | 'stargazer' | 'legacy';

/** a grant as the API sends it. */
export interface RewardGrant {
  id: string;
  source: RewardSource;
  reason: RewardReason;
  items: RewardItem[];
  createdAt: string;
  claimedAt: string | null;
}

/** the badge ids a grant delivers, in item order. */
export function grantBadges(g: Pick<RewardGrant, 'items'>): BadgeId[] {
  return g.items.flatMap((i) => (i.kind === 'badge' && isBadgeId(i.id) ? [i.id] : []));
}

/** the title ids a grant delivers, best first (the order the server wrote them in). */
export function grantTitles(g: Pick<RewardGrant, 'items'>): string[] {
  return g.items.flatMap((i) => (i.kind === 'title' ? [i.id] : []));
}

/** the cosmetic ids a grant delivers. */
export function grantCosmetics(g: Pick<RewardGrant, 'items'>): string[] {
  return g.items.flatMap((i) => (i.kind === 'cosmetic' ? [i.id] : []));
}

/** the words for a record board — `overall record board`, `Mecanum record board`. */
function boardWords(p: Pick<RecordPlacement, 'board' | 'mode'>): string {
  const duo = p.mode === 'duo' ? 'duo ' : '';
  return p.board === 'overall' ? `overall ${duo}record board` : `${DRIVETRAIN_LABELS[p.board] ?? p.board} ${duo}record board`;
}

/** "BIOBUZZ Act 2", "DECODE Act 1 Season 3" — the period a competitive reward closed on. */
export function rewardPeriod(r: RewardReason): string {
  if (r.kind === 'ranked_act') return `${seasonFor(r.game).name} Act ${r.act}`;
  if (r.kind === 'record_season') return `${seasonFor(r.game).name} Act ${r.act} Season ${r.seasonNo}`;
  return '';
}

/**
 * THE HEADLINE — the name of the best thing in the grant, as a player would say it.
 * An act podium is its title's words (`1v1 Champion`), a record award is its best placement's
 * (`Record Champion`, `Mecanum Record Champion`), anything else is its title's label.
 */
export function rewardHeadline(g: Pick<RewardGrant, 'reason' | 'items'>): string {
  const r = g.reason;
  if (r.kind === 'ranked_act') return `${r.mode} ${awardRankWord('ranked_act', r.rank)}`;
  if (r.kind === 'record_season') {
    const best = r.placements[0];
    if (!best) return 'Record Holder';
    const kind = best.board === 'overall' ? 'record_overall' : 'record_drivetrain';
    const dt = best.board === 'overall' ? '' : `${DRIVETRAIN_LABELS[best.board] ?? best.board} `;
    return `${dt}Record ${awardRankWord(kind, best.rank)}`;
  }
  const t = grantTitles(g)[0];
  return (t && titleLabel(t)) || 'Reward';
}

/** the eyebrow over the headline — what ended, or where the reward came from. */
export function rewardEyebrow(g: Pick<RewardGrant, 'reason'>): string {
  const r = g.reason;
  if (r.kind === 'ranked_act' || r.kind === 'record_season') return `${rewardPeriod(r)} ended`;
  if (r.kind === 'stargazer') return 'GitHub';
  return 'Reward';
}

/**
 * WHY, CONCRETELY — one line per fact (owner, 2026-09-22: "why"). `#2 in 1v1 ranked, BIOBUZZ
 * Act 2` is the shape the owner gave, so it is the shape every competitive line takes: the
 * placement, the board, the period. The closing number follows as its own short sentence.
 */
export function rewardWhy(g: Pick<RewardGrant, 'reason'>): string[] {
  const r = g.reason;
  if (r.kind === 'ranked_act') {
    const lines = [`#${r.rank} in ${r.mode} ranked, ${rewardPeriod(r)}.`];
    if (r.rating != null) lines.push(`Final rating ${Math.round(r.rating)}.`);
    return lines;
  }
  if (r.kind === 'record_season') {
    const period = rewardPeriod(r);
    return r.placements.map(
      (p) => `#${p.rank} on the ${boardWords(p)}, ${period}.${p.score != null ? ` Best run ${Math.round(p.score)}.` : ''}`,
    );
  }
  if (r.kind === 'stargazer') return ['You starred DSIM on GitHub. It stays while the star does.'];
  return r.note ? [r.note] : [];
}

/** a title item as words — the full sentence for an award, the label for a ledger title. The
 *  act/season a parsed award id cannot carry are filled from the grant's own reason. */
export function rewardTitleText(id: string, reason?: RewardReason): string {
  const a = parseAwardTitleId(id);
  if (a) {
    if (reason && (reason.kind === 'record_season' || reason.kind === 'ranked_act')) {
      a.act = reason.act;
      if (reason.kind === 'record_season') a.seasonNo = reason.seasonNo;
    }
    return awardTitleText(a);
  }
  return titleLabel(id) ?? id;
}

/** a badge item as words, with the count it reaches once this grant is claimed. */
export function rewardBadgeText(id: BadgeId, countAfter: number): string {
  const name = `${BADGE_LABELS[id]} badge`;
  return countAfter > 1 ? `${name} · earned ${countAfter} times` : name;
}

/**
 * THE ORDER A QUEUE OF GRANTS IS SHOWN IN. The prestigious one first — an act podium, then a
 * record award, then everything else — and OLDEST first within a kind, so a backfill that
 * pays out three past acts at once counts a badge up 1, 2, 3 in the order they were won
 * rather than showing ×3 on the first card.
 */
export function compareGrants(a: RewardGrant, b: RewardGrant): number {
  const rank = (g: RewardGrant): number => (g.reason.kind === 'ranked_act' ? 0 : g.reason.kind === 'record_season' ? 1 : 2);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  const period = (g: RewardGrant): number =>
    g.reason.kind === 'ranked_act' ? g.reason.act : g.reason.kind === 'record_season' ? g.reason.balanceVersion : 0;
  if (period(a) !== period(b)) return period(a) - period(b);
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}
