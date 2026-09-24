import { parseAwardTitleId } from '../awards';
import { titleLabel } from '../cosmetics';
import { AwardBadge } from './AwardBadge';
import { BadgeMarks } from './BadgeMark';
import { BadgeIcon } from './SupporterBadge';

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
 * ── STARGAZER IS AN ICON, THE REST A TEXT CHIP ──────────────────────────────────────────────
 * `title:stargazer` renders as a disc badge (`BadgeIcon`, the same 128×128 SVG as owner/admin/
 * supporter): an outlined yellow ★ on the award violet. The owner asked for it by name
 * (2026-09-24); hue and the outline tell it from the owner's white star. Its hover tip
 * carries the words. Any OTHER ledger title stays a text chip, because its NAME is the message.
 *
 * The text chip takes `--ds-award`/`--ds-award-ink`, the award family's one hue, for the reason
 * `AwardBadge` gives for having a single hue at all: it is ONE measured `contrast.mjs` pair
 * rather than a new one per reward, and the two things are the same KIND of claim — something
 * earned, as against something paid for.
 */
export function TitleChip({ id }: { id: string }) {
  if (id === 'title:stargazer') return <BadgeIcon kind="stargazer" />;
  const label = titleLabel(id);
  if (!label) return null;
  return (
    <span className="title-chip" role="img" aria-label={`Title: ${label}`}>
      {label}
    </span>
  );
}

/**
 * THE ONE-OF-TWO, in one place.
 *
 * An equipped title is a single id and it renders as EITHER an `AwardBadge` (a season award,
 * whose id encodes its own board and rank) or a `TitleChip` (everything the rewards ledger
 * grants) — never both, and never neither when the id is set. Every surface that prints a
 * name has to make that choice, and `Leaderboard.tsx` made it inline in two places while the
 * other seven surfaces did not make it at all.
 *
 * That is the `badgeCols` failure mode one layer up (`docs/area/accounts.md`): a surface that
 * simply omits the chip still compiles and still renders, only bare — so the rule is a
 * component, the way the badge itself is, rather than three lines copied per row type.
 *
 * It is a SIBLING of `SupporterBadge`, never nested in it: a champion who also pays shows
 * both, and a badge is decoration beside a name rather than part of one.
 */
export function TitleMark({ title, badges }: { title?: string | null; badges?: unknown }) {
  /* ⚠️ THE WORN BADGES RIDE HERE TOO (0048), before the title, for the reason this component
     exists at all: every surface that prints a name already calls it, so the badges reach all
     of them by passing one more prop — rather than by a second component each surface would
     have to remember. Badges first, because they are the counted, rarer claim; the title is
     the words, and it reads last. */
  const award = title ? parseAwardTitleId(title) : null;
  return (
    <>
      <BadgeMarks badges={badges} />
      {title ? award ? <AwardBadge award={award} /> : <TitleChip id={title} /> : null}
    </>
  );
}
