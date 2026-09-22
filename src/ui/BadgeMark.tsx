import { BADGE_LABELS, BADGE_TIER, coerceEquippedBadges, isBadgeId, type BadgeId } from '../badges';

/**
 * A BADGE — the counted half of the rewards ledger (`src/badges.ts`), drawn.
 *
 * ── SHAPE CARRIES THE KIND, SO IT CANNOT BE A DISC OR A HEXAGON ─────────────────────────────
 * Beside a name there is already ★ / ◆ / ♥ in a DISC (`SupporterBadge`) and a HEXAGON for an
 * award title (`AwardBadge`), and `docs/area/accounts.md` requires every mark there to be told
 * apart by SHAPE as well as hue. So:
 *   · the ranked PODIUM is a CREST (a shield), in gold / silver / bronze by placement, with the
 *     placement's numeral on it — the prestigious one, and it looks it;
 *   · the RECORD HOLDER badge is a BOOKMARK RIBBON in the award violet with a small crown —
 *     deliberately the plainer of the two (owner: "less special and cool than the ranked one").
 * Both carry a 1px `--ds-mut` rim. That is the lesson of the lavender pastel the accounts guide
 * records: a silver fill is ~1.9:1 on the light panel and would vanish there, and the rim is
 * what separates it — the same "an edge identifies a floating surface" rule the HUD follows.
 *
 * ── THE COUNTER ─────────────────────────────────────────────────────────────────────────────
 * A pip at the corner with the times earned, from 2 up — a badge earned once needs no "1".
 * It is a fixed dark disc with light ink (`--ds-stage-bg` / `--ds-on-field`), ringed in the
 * panel colour so it lifts off whatever badge it sits on in either theme.
 */

const CREST = 'M12 1.6 20.6 4.8V11.3C20.6 16.6 17 20.4 12 22.4 7 20.4 3.4 16.6 3.4 11.3V4.8Z';
const RIBBON = 'M5.5 1.8H18.5V22.2L12 17.6 5.5 22.2Z';
/** a three-point crown, the "top of the board" mark on the record ribbon */
const CROWN = 'M8 12.6 8.6 7.8 10.6 9.8 12 6.8 13.4 9.8 15.4 7.8 16 12.6Z';

export type BadgeSize = 'sm' | 'md' | 'lg' | 'xl';

export function BadgeArt({ id, n = 1, size = 'sm' }: { id: BadgeId; n?: number; size?: BadgeSize }) {
  const tier = BADGE_TIER[id];
  const label = BADGE_LABELS[id];
  const said = n > 1 ? `${label} badge, earned ${n} times` : `${label} badge`;
  const podium = tier !== 'record';
  const numeral = tier === 'gold' ? '1' : tier === 'silver' ? '2' : tier === 'bronze' ? '3' : null;
  return (
    <span className={`badge-mark badge-${size} tier-${tier}`} role="img" aria-label={said} title={said}>
      <span className="badge-glyph" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path className="badge-body" d={podium ? CREST : RIBBON} />
          {podium ? <path className="badge-inner" d="M12 4.4 18 6.7V11.3C18 15.1 15.5 17.9 12 19.4 8.5 17.9 6 15.1 6 11.3V6.7Z" /> : <path className="badge-crown" d={CROWN} />}
        </svg>
        {numeral && <span className="badge-num">{numeral}</span>}
      </span>
      {/* beside a name the count TRAILS the glyph (`×2`) — a pip on a 16px crest covers it;
          at the large sizes it is the corner pip */}
      {n > 1 && <span className="badge-count" aria-hidden="true">×{n}</span>}
    </span>
  );
}

/**
 * THE WORN BADGES beside a name, in the order the player chose. Tolerant of whatever the wire
 * carried: an older server sends nothing, a newer build's badge is skipped (`coerceEquippedBadges`),
 * and none of it can throw inside a leaderboard row.
 */
export function BadgeMarks({ badges }: { badges?: unknown }) {
  const list = coerceEquippedBadges(badges);
  if (list.length === 0) return null;
  return (
    <>
      {list.map((b) => (isBadgeId(b.id) ? <BadgeArt key={b.id} id={b.id} n={b.n} /> : null))}
    </>
  );
}
