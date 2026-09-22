import { useSyncExternalStore } from 'react';
import {
  claimReward,
  ENTITLEMENTS_CHANGED,
  fetchRewards,
  fetchTitle,
  FriendsUnavailableError,
  saveBadges,
  saveTitle,
  type RewardStateDto,
} from '../net/api';
import { compareGrants, grantCosmetics } from '../rewards';

/**
 * THE ACCOUNT'S REWARD STATE, ONE COPY FOR THE WHOLE SHELL — pending grants, badge counts,
 * what is worn, what is wearable (`GET /api/user/rewards`).
 *
 * A module store rather than per-component fetches because three things read it and must
 * agree the instant one of them changes it: the claim dialog (`RewardDialog`), the title
 * picker and the badge picker (`Appearance`). A title claimed in the dialog has to be in the
 * picker behind it without a reload, and a picker that fetched its own copy would be a second
 * opinion about what the account holds — the failure `TitlePicker`'s own header warns about.
 *
 * `useSyncExternalStore` needs a NEW snapshot object on every change (the queue bar learned
 * that the hard way — `docs/area/accounts.md`), so `set` always replaces it.
 */
export interface RewardsSnapshot {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** null until the first load lands */
  state: RewardStateDto | null;
  /** the dialog was put off for this visit to the menus (Esc) */
  postponed: boolean;
  /** a claim or equip is in flight */
  busy: boolean;
  /** the user this state belongs to — a sign-out or account switch must not show the last one's */
  userId: string | null;
}

let snap: RewardsSnapshot = { status: 'idle', state: null, postponed: false, busy: false, userId: null };
const subs = new Set<() => void>();
function set(next: Partial<RewardsSnapshot>): void {
  snap = { ...snap, ...next };
  for (const f of subs) f();
}
const subscribe = (f: () => void): (() => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

export function useRewards(): RewardsSnapshot {
  return useSyncExternalStore(subscribe, () => snap, () => snap);
}

/** keep the queue in the order `compareGrants` states: the prestigious first, oldest first */
const sorted = (s: RewardStateDto): RewardStateDto => ({ ...s, pending: [...(s.pending ?? [])].sort(compareGrants) });

let seq = 0;
/**
 * LOAD (or reload) for `userId`. Null clears — signed out.
 *
 * ⚠️ AN OLDER SERVER HAS NO REWARD ROUTE, and answers 404 (`FriendsUnavailableError`). That is
 * "nothing pending", and the titles half falls back to `/api/user/title`, which every server
 * with titles has — so the pickers still work against a server that predates the ledger.
 */
export async function loadRewards(userId: string | null): Promise<void> {
  const mine = ++seq;
  if (!userId) {
    set({ status: 'idle', state: null, postponed: false, busy: false, userId: null });
    return;
  }
  if (snap.userId !== userId) set({ state: null, postponed: false, userId });
  set({ status: 'loading' });
  try {
    const s = await fetchRewards();
    if (mine !== seq) return;
    set({ status: 'ready', state: sorted(s) });
  } catch (e) {
    if (mine !== seq) return;
    if (e instanceof FriendsUnavailableError) {
      const t = await fetchTitle().catch(() => ({ title: null, earned: [] as string[] }));
      if (mine !== seq) return;
      set({ status: 'ready', state: { pending: [], badges: {}, equippedBadges: [], title: t.title, earnedTitles: t.earned } });
      return;
    }
    set({ status: 'error' });
  }
}

/** load unless this user's state is already here or on its way — for a page that reads the
 *  store and must not depend on the dialog having mounted first */
export function ensureRewards(userId: string | null): void {
  if (userId && snap.userId === userId && (snap.status === 'loading' || snap.status === 'ready')) return;
  void loadRewards(userId);
}

/** put the dialog off for the rest of this visit to the menus */
export function postponeRewards(): void {
  set({ postponed: true });
}

/** bring it back — the appearance page's "Show" button, and every return to the menus */
export function reopenRewards(): void {
  set({ postponed: false });
}

/**
 * CLAIM a grant, and with `equip` wear it. Answers whether it landed.
 *
 * A claim that delivered a COSMETIC tells the entitlement provider to re-read, so the builder's
 * swatch unlocks without a reload (`ENTITLEMENTS_CHANGED`, `src/ads/AdsProvider.tsx`).
 */
export async function claimPending(id: string, equip: boolean): Promise<boolean> {
  if (snap.busy) return false;
  const grant = snap.state?.pending.find((p) => p.id === id);
  set({ busy: true });
  try {
    const s = await claimReward(id, equip);
    set({ state: sorted(s), busy: false });
    if (grant && grantCosmetics(grant).length > 0) window.dispatchEvent(new Event(ENTITLEMENTS_CHANGED));
    return true;
  } catch {
    set({ busy: false });
    return false;
  }
}

/** WEAR these badges (the picker). Optimistic, rolled back on refusal. */
export async function equipBadges(ids: string[]): Promise<boolean> {
  const prev = snap.state;
  if (!prev) return false;
  const counts = prev.badges;
  set({ state: { ...prev, equippedBadges: ids.map((id) => ({ id, n: counts[id] ?? 1 })) } });
  try {
    const r = await saveBadges(ids);
    if (snap.state) set({ state: { ...snap.state, equippedBadges: r.equippedBadges } });
    return true;
  } catch {
    set({ state: prev });
    return false;
  }
}

/** WEAR a title, or none (the picker). Optimistic, rolled back on refusal. */
export async function equipTitle(id: string | null): Promise<boolean> {
  const prev = snap.state;
  if (!prev) return false;
  set({ state: { ...prev, title: id } });
  try {
    await saveTitle(id);
    return true;
  } catch {
    set({ state: prev });
    return false;
  }
}
