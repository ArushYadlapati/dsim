-- 0046 — THE EQUIPPED TITLE. `docs/rewards-round2-plan.md` §2.3.
--
-- One nullable id naming which of the account's earned titles it is currently wearing.
-- Additive with a null default, like every `profiles` addition since 0003: an older server
-- never selects it, a brand-new profile reads as "no title", and a rollback leaves one
-- unread column.
--
-- ⚠️ WHAT IS DELIBERATELY *NOT* HERE IS THE LIST OF TITLES AN ACCOUNT HAS EARNED, because
-- both sources already know it and neither wants a third copy:
--   · AWARD titles are derived from `season_awards` (0045) — a deterministic key per
--     (game, balance_version, kind, mode, drivetrain, rank);
--   · GRANTED titles (the GitHub reward, loyalty milestones later) are a `title:` axis in
--     `profiles.cosmetics` (0044), which brings grantCosmetic's idempotency, its
--     admin_audit row, revokeCosmetic, the entitlements payload and the admin console with
--     it — no new table, no second grant path.
-- `earnedTitles()` (repo.ts) unions the two, and it is the ONLY thing that decides what is
-- wearable. Writing an award's title into `profiles.cosmetics` as well was the alternative
-- and is worse: COSMETIC_AXES is a CLOSED COMPILE-TIME REGISTRY, so it would need a source
-- change every time a season rolls. Season titles are DATA; fixed titles are registry keys.
--
-- ⚠️ THE COLUMN IS BARE `text`, SO THE WRITE PATH IS THE VALIDATION. `setTitle` checks the
-- id against `earnedTitles` and refuses anything else, and every removal path — an award
-- reversal, `revokeCosmetic` — must CLEAR this column when it matches, the same way
-- `clearUsername` does (docs/area/accounts.md): the moderator takes the thing away, they do
-- not leave a dangling reference for a render path to discover.
alter table profiles add column if not exists title text;

comment on column profiles.title is
  'The equipped title id, or null. Validated on WRITE by setTitle (server/db/repo.ts) against earnedTitles(), which unions season_awards (0045) with the title: axis of profiles.cosmetics (0044) — the column itself has no check constraint, so nothing else may write it. Cleared by any path that takes the underlying title away.';
