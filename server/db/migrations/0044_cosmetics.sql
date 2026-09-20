-- 0044 — EARNED COSMETIC UNLOCKS, the account-level ledger `docs/cosmetics-plan.md` §3.2
-- calls for.
--
-- Every cosmetic CHOICE already lives on the `RobotSpec` (chassisColor, now joined by
-- accent/decal/plate, `src/cosmetics.ts`) — this column is not that. It is what the
-- ACCOUNT has permanently unlocked, as `"<axis>:<key>"` strings ('decal:chevron'), kept
-- deliberately separate from `supporter_until`: a supporter's palette unlocks all at once
-- off that column's own predicate (SUPPORTER_COL) and never touches this one, so a lapsed
-- membership can never delete something earned, and an earned unlock can never quietly
-- become something sold (plan §1's non-goal). Written only by the server — an admin comp
-- (`grantCosmetic`/`revokeCosmetic`, repo.ts) today, a rewards-ledger unlock
-- (`docs/rewards-plan.md`) later — never by a client.
--
-- jsonb array rather than a join table because the set per account is tiny (a handful of
-- ids, ever) and the only reads are "give me this account's list" and "does this account
-- have id X" (`?` containment) — the same shape `profiles.settings` (0003) already uses
-- for a small per-account blob, not the shape a table with its own indexes earns.
--
-- Purely ADDITIVE, like every migration here: `not null default '[]'` means an older
-- server (which never selects this column) and a brand-new profile both read as "nothing
-- earned yet", and rolling back leaves one unread column behind.
alter table profiles add column if not exists cosmetics jsonb not null default '[]'::jsonb;

comment on column profiles.cosmetics is
  'Permanent, server-granted cosmetic unlocks: "<axis>:<key>" strings from src/cosmetics.ts (COSMETIC_AXES). Separate ledger from supporter_until on purpose — see the header of this migration. Written by grantCosmetic/revokeCosmetic (server/db/repo.ts), which log to admin_audit (0041); read by the server''s entitlement strip (server/index.ts join + ranked queue, server/room.ts update) and GET /api/user/entitlements as unlockedCosmetics.';
