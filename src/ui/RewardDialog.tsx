import { useEffect, useRef, useState } from 'react';
import { authClient, authEnabled } from '../lib/authClient';
import { BADGE_EARN, BADGE_TIER, type BadgeId } from '../badges';
import { parseAwardTitleId } from '../awards';
import { starPoints } from '../render/drawRobot';
import {
  grantBadges,
  grantCosmetics,
  grantTitles,
  rewardBadgeText,
  rewardEyebrow,
  rewardHeadline,
  rewardTitleText,
  rewardWhy,
  type RewardGrant,
} from '../rewards';
import { AwardBadge } from './AwardBadge';
import { useDialog } from './useDialog';
import { BadgeArt } from './BadgeMark';
import { TitleChip } from './TitleChip';
import { claimPending, loadRewards, postponeRewards, reopenRewards, useRewards } from './rewardsStore';

/**
 * THE CLAIM DIALOG — every reward an account is given is shown here, once, before it is theirs
 * (owner, 2026-09-22: "Create a proper display of congratulating them for earning a title or
 * badge or decal or whatever, why, and a claim button and a equip now button").
 *
 * WHAT IT SHOWS, for the grant at the head of the queue: what was earned, DRAWN (the title as
 * it will sit beside the name, the badge with the count it is about to reach, the decal on a
 * robot-coloured disc); WHY, as concrete sentences (`rewardWhy` — "#2 in 1v1 ranked, BIOBUZZ
 * Act 2."); and two actions. CLAIM takes it into the account. EQUIP NOW claims it and wears it —
 * the title becomes the equipped one, each badge is equipped, and a decal goes on the active
 * robot. Several pending rewards queue: the next appears when this one is taken, the
 * prestigious first and the oldest first within a kind (`compareGrants`).
 *
 * WHEN: on the menu shell only. `App.tsx` mounts it inside `AppShell`, which a match, a lobby
 * and the ranked screen all replace outright — so it cannot appear over a field, per the "no
 * popups over the field" rule. It waits for everything else that is modal (the terms and
 * username gates, which wrap it; the announcements, the start guards — `blocked`), and Esc puts
 * it off until the next return to the menus, so a player is never trapped in it. There is no
 * third "dismiss" button because there is nothing to dismiss: claiming costs nothing.
 *
 * ⚠️ THE RANKED PODIUM IS THE SPECIAL ONE, AND IT LOOKS IT (owner: "the most prestigious
 * reward … make it look special"). Its card takes the metal of the placement — the card's edge
 * in the metal, a large crest, the headline a size up (no glow: design review 06-15) — while a record award is the plainer violet card, and
 * anything else is the neutral one. The difference is in the TIER class and nothing else, so
 * the three cannot drift apart structurally.
 */
export function RewardDialog({
  blocked = false,
  onEquipCosmetic,
}: {
  /** another modal is up (an announcement, a start guard) — wait for it */
  blocked?: boolean;
  /** put a claimed cosmetic on the active robot ("Equip now" on a decal) */
  onEquipCosmetic?: (id: string) => void;
}) {
  const session = authEnabled ? authClient!.useSession() : null;
  const userId = session?.data?.user?.id ?? null;
  const r = useRewards();
  const [err, setErr] = useState(false);

  // every mount is a return to the menus: bring a postponed queue back and re-read it, so a
  // reward minted while the player was in a match is waiting for them when they come out
  useEffect(() => {
    reopenRewards();
    void loadRewards(userId);
  }, [userId]);

  const grant = r.state?.pending[0] ?? null;
  const showing = !!grant && !blocked && !r.postponed && r.status === 'ready';

  // a new card is a new question — a failure on the last one says nothing about this one
  useEffect(() => setErr(false), [grant?.id]);

  if (!showing || !grant) return null;

  const take = async (equip: boolean): Promise<void> => {
    setErr(false);
    const ok = await claimPending(grant.id, equip);
    if (!ok) {
      setErr(true);
      return;
    }
    if (equip) for (const id of grantCosmetics(grant)) onEquipCosmetic?.(id);
  };

  return (
    <RewardCard
      grant={grant}
      counts={r.state?.badges ?? {}}
      position={{ at: 1, of: r.state?.pending.length ?? 1 }}
      busy={r.busy}
      error={err}
      onClaim={() => void take(false)}
      onEquip={() => void take(true)}
      onDismiss={postponeRewards}
    />
  );
}

/** the card itself, split out so it can be drawn from fixed data (the appearance page's
 *  preview of an unclaimed reward, and the screenshot harness). */
export function RewardCard({
  grant,
  counts,
  position,
  busy = false,
  error = false,
  onClaim,
  onEquip,
  onDismiss,
}: {
  grant: RewardGrant;
  /** badge id → times earned so far; the card shows the count it is ABOUT to reach */
  counts: Record<string, number>;
  position?: { at: number; of: number };
  busy?: boolean;
  error?: boolean;
  onClaim: () => void;
  onEquip: () => void;
  /** Escape: not now — the queue comes back on the next return to the menus */
  onDismiss?: () => void;
}) {
  // declared BEFORE the equip focus below, so it records the opener before focus moves
  const dialogRef = useDialog(onDismiss);
  const equipRef = useRef<HTMLButtonElement>(null);
  // focus the primary action when a card appears — a keyboard or pad user lands on it
  useEffect(() => equipRef.current?.focus(), [grant.id]);

  const badges = grantBadges(grant);
  const titles = grantTitles(grant);
  const cosmetics = grantCosmetics(grant);
  const lead = badges[0] ?? null;
  const tier = lead ? BADGE_TIER[lead] : grant.reason.kind === 'stargazer' ? 'plain' : 'record';
  const headId = `rw-h-${grant.id}`;
  const firstAward = titles.map(parseAwardTitleId).find(Boolean) ?? null;
  const hero = lead ? (
    <BadgeArt id={lead} n={(counts[lead] ?? 0) + 1} size="xl" />
  ) : firstAward ? (
    <AwardBadge award={firstAward} size="lg" />
  ) : cosmetics.includes('decal:star') ? (
    <DecalPreview id="decal:star" size="xl" />
  ) : null;
  // THE LIST ONLY WHEN IT ADDS SOMETHING (design review 06-15): a one-item grant is already
  // drawn by the hero and said by the headline, and listing it repeated the hero at small size.
  // It stays when there is no hero (a lone ledger title has no large form) so nothing goes undrawn.
  const showItems = titles.length + badges.length + cosmetics.length > 1 || !hero;

  return (
    <div className="ds-modal-backdrop rw-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className={`ds-modal rw-card tier-${tier}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headId}
        tabIndex={-1}
      >
        <div className="rw-top">
          <span className="rw-eyebrow">{rewardEyebrow(grant)}</span>
          {position && position.of > 1 && (
            <span className="rw-queue" aria-label={`Reward ${position.at} of ${position.of}`}>
              {position.at} of {position.of}
            </span>
          )}
        </div>

        {/* THE HERO — the one thing this card is about, drawn large */}
        <div className="rw-hero" aria-hidden="true">
          {hero}
        </div>

        {/* no "Reward earned" kicker: the eyebrow and the headline already say it (06-15) */}
        <h2 className="ds-dialog-title rw-h" id={headId}>
          {rewardHeadline(grant)}
        </h2>
        <ul className="rw-why">
          {rewardWhy(grant).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>

        {/* WHAT IS IN IT — every item, as it will actually appear */}
        {showItems && (
          <ul className="rw-items" aria-label="What you get">
            {titles.map((id) => {
              const award = parseAwardTitleId(id);
              return (
                <li key={id}>
                  <span className="rw-item-mark">{award ? <AwardBadge award={award} /> : <TitleChip id={id} />}</span>
                  <span className="rw-item-k">Title</span>
                  <span className="rw-item-v">{rewardTitleText(id, grant.reason)}</span>
                </li>
              );
            })}
            {badges.map((id: BadgeId) => (
              <li key={id}>
                <span className="rw-item-mark">
                  <BadgeArt id={id} n={(counts[id] ?? 0) + 1} />
                </span>
                <span className="rw-item-k">Badge</span>
                <span className="rw-item-v">
                  {rewardBadgeText(id, (counts[id] ?? 0) + 1)}
                  <span className="rw-item-sub">{BADGE_EARN[id]}</span>
                </span>
              </li>
            ))}
            {cosmetics.map((id) => (
              <li key={id}>
                <span className="rw-item-mark">
                  <DecalPreview id={id} size="sm" />
                </span>
                <span className="rw-item-k">Decal</span>
                <span className="rw-item-v">{cosmeticWords(id)}</span>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="ds-hint warn rw-err">Couldn’t claim that. Check your connection and try again.</p>}

        <div className="rw-actions">
          <button className="ds-btn" disabled={busy} onClick={onClaim}>
            Claim
          </button>
          <button ref={equipRef} className="ds-btn primary" disabled={busy} onClick={onEquip}>
            Equip now
          </button>
        </div>
      </div>
    </div>
  );
}

/** how a delivered cosmetic reads in the list — the builder section it lives under */
function cosmeticWords(id: string): string {
  if (id === 'decal:star') return 'Star decal for your robot. Pick it in the robot builder, or Equip now.';
  const [axis, key] = id.split(':');
  return `${key} ${axis === 'decal' ? 'decal' : axis}`;
}

/**
 * THE DECAL, FROM THE SPRITE'S OWN GEOMETRY (`starPoints`), on a dark disc — so the shape reads
 * as the thing that goes ON a robot rather than as another chip. The same construction the
 * builder swatch uses; a traced-by-eye path would be the one place the star being given is not
 * the star that is got.
 */
export function DecalPreview({ id, size = 'sm' }: { id: string; size?: 'sm' | 'xl' }) {
  if (id !== 'decal:star') return null;
  const d =
    starPoints(12, 12, 9, -Math.PI / 2)
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`)
      .join(' ') + ' Z';
  return (
    <span className={`rw-decal rw-decal-${size}`} role="img" aria-label="Star decal">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={d} />
      </svg>
    </span>
  );
}
