import { awardBadgeRank, awardPodiumTier, awardShortText, awardTitleText, type AwardRow } from '../awards';

/**
 * A SEASON-AWARD BADGE — a hexagon carrying the rank numeral.
 *
 * ⚠️ **IT IS A SIBLING OF `SupporterBadge`, NOT A FOURTH RUNG OF IT.** That component
 * renders exactly ONE of owner ★ > admin ◆ > supporter ♥ by precedence, because staff are
 * also supporters and two of those would be saying the same thing twice. An award is a
 * different claim entirely — a champion who also pays must show both — so it is its own
 * element beside that one, per `docs/area/ui.md`'s "a name always gets `SupporterBadge`, as
 * a SIBLING".
 *
 * SHAPE AND HUE, decided 2026-09-21 (`docs/rewards-round2-plan.md` §8.3):
 *  · a HEXAGON, because ★ ◆ ♥ are taken and the silhouette has to be unmistakable at 12 px
 *    next to all three;
 *  · ONE saturated violet (`--ds-award`) with the RANK as a numeral, rather than
 *    gold/silver/bronze — gold already means supporter, and silver and bronze are
 *    desaturated by definition, which is the exact failure `docs/area/accounts.md` records.
 *    One hue is also one `contrast.mjs` pair instead of three, and it extends to a fourth
 *    rank for free.
 *
 * INLINE SVG for the hexagon, for the reason `SupporterBadge`'s own note gives: a text
 * glyph's size and position inside the disc are decided by the FONT's metrics, it is drawn
 * on the baseline rather than centred, and not every platform has the character.
 */
export function AwardBadge({ award, size = 'sm' }: { award: AwardRow; size?: 'sm' | 'md' | 'lg' }) {
  const rank = awardBadgeRank(award);
  // an ACT podium title wears the podium's metal (0048) — see `awardPodiumTier`
  const tier = awardPodiumTier(award);
  return (
    <span
      className={`award-badge award-${size}${tier ? ` podium-${tier}` : ''}`}
      role="img"
      aria-label={awardTitleText(award)}
      title={awardShortText(award)}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 1.5 21.5 7v10L12 22.5 2.5 17V7z" />
      </svg>
      <span className="award-rank">{rank}</span>
    </span>
  );
}

/**
 * The award list on a profile — the "trophy case".
 *
 * Ordered by `compareAwards` (newest season first, then rank), which is the order somebody
 * reads their own. An account with none renders NOTHING rather than an empty state: this
 * sits inside a Career panel that already has its own, and a second "no awards yet" under
 * it would be the panel telling you twice.
 */
export function AwardList({ awards }: { awards: readonly AwardRow[] }) {
  if (awards.length === 0) return null;
  return (
    <ul className="award-list">
      {awards.map((a) => (
        <li key={`${a.game}:${a.balanceVersion}:${a.kind}:${a.mode}:${a.drivetrain ?? ''}:${a.rank}`}>
          <AwardBadge award={a} />
          <span className="award-text">{awardTitleText(a)}</span>
        </li>
      ))}
    </ul>
  );
}
