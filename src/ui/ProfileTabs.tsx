/**
 * THE PROFILE DESTINATION'S TWO PAGES (owner, 2026-09-22: "Profile account settings should be
 * separated from like profile title and cosmetics settings").
 *
 *   Appearance  `/account/appearance` — how you appear to others: your name, title, badges,
 *               the rewards waiting to be claimed, and the robot look you have unlocked.
 *   Account     `/account`            — the account itself: sign-in, email, password, linked
 *               accounts, privacy, membership, and deletion.
 *
 * `/account` keeps the ACCOUNT page because it is a shipped URL with jobs of its own — the
 * GitHub link bounces back to `/account?link=`, the ranked refusal sends people to its
 * verify-email banner — and changing what it shows would break every one of them quietly.
 *
 * NAVIGATION, not an ARIA tablist, for the reason `Records.tsx` gives: the buttons change the
 * URL, and half a tabs pattern is worse than none.
 */
export const PROFILE_TABS = ['appearance', 'account'] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];

const LABELS: Record<ProfileTab, string> = {
  appearance: 'Appearance',
  account: 'Account',
};

export function ProfileTabs({ active, onPick }: { active: ProfileTab; onPick?: (t: ProfileTab) => void }) {
  return (
    <nav className="ds-tabs" aria-label="Profile sections">
      {PROFILE_TABS.map((t) => (
        <button
          key={t}
          className={`ds-tab${active === t ? ' on' : ''}`}
          aria-current={active === t ? 'page' : undefined}
          onClick={() => onPick?.(t)}
        >
          {LABELS[t]}
        </button>
      ))}
    </nav>
  );
}
