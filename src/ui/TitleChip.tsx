import { titleLabel } from '../cosmetics';

/**
 * A LEDGER TITLE beside a name — `title:stargazer` and whatever the rewards ledger grants
 * next. The sibling of `AwardBadge`, which handles the OTHER kind of title: a season award,
 * whose id encodes its own board and rank.
 *
 * ⚠️ **THIS EXISTS BECAUSE A LEDGER TITLE USED TO RENDER NOWHERE AT ALL.** `Leaderboard.tsx`
 * ran every equipped title through `parseAwardTitleId`, which answers null for anything that
 * is not an award — and a null award drew nothing. So the GitHub star's title was granted,
 * was equippable, and was invisible on the only surface the title picker promises it appears
 * on ("A title you have earned shows beside your name on the leaderboards"). The picker was
 * no better: it fell back to `id.replace(/^title:/, '')` and printed the raw slug, lowercase.
 *
 * ── WHY A TEXT CHIP AND NOT A GLYPH ─────────────────────────────────────────────────────────
 * An award badge can be a bare hexagon with a numeral because the RANK is the whole message
 * and a shape carries it. A ledger title's message is its NAME, so there is nothing for a
 * silhouette to say and the word has to be on screen.
 *
 * ⚠️ AND IT DELIBERATELY DOES NOT CARRY A STAR. ★ beside a name already means OWNER
 * (`SupporterBadge`, precedence owner ★ > admin ◆ > supporter ♥), and a stargazer chip
 * wearing the same glyph in the same row would read as staff at a glance. The mockup this was
 * agreed from had one; it does not survive contact with the badge that is already there.
 *
 * It takes `--ds-award`/`--ds-award-ink`, the award family's one hue, for the reason
 * `AwardBadge` gives for having a single hue at all: it is ONE measured `contrast.mjs` pair
 * rather than a new one per reward, and the two things are the same KIND of claim — something
 * earned, as against something paid for.
 */
export function TitleChip({ id }: { id: string }) {
  const label = titleLabel(id);
  if (!label) return null;
  return (
    <span className="title-chip" role="img" aria-label={`Title: ${label}`}>
      {label}
    </span>
  );
}
