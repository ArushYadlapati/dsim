-- 0048 — THE REWARD LEDGER: every title, badge and cosmetic an account is given arrives as a
-- GRANT that the player CLAIMS, never as a silent write (owner, 2026-09-22: "do not just give
-- it to them without them getting anything … a claim button and an equip now button").
--
-- ── reward_grants ─────────────────────────────────────────────────────────────────────────
-- One row per (account, reward, period). `grant_key` names the reward AND its period —
-- `ranked:<game>:act<N>:<mode>`, `record:<game>:bv<N>`, `stargazer` — so the unique index
-- below is the whole idempotency story: a re-run of the award job, a retried season roll, a
-- second boot on another Fly machine all insert the same key and conflict.
--
-- `items` is WHAT the grant delivers, as `[{kind:'title'|'badge'|'cosmetic', id}]`; `reason`
-- is WHY, as structured data the client turns into a sentence (`src/rewards.ts`). Storing the
-- sentence would freeze its wording at the moment it was minted, the argument `src/awards.ts`
-- already makes for titles.
--
-- PENDING is `claimed_at is null`. A pending grant has delivered NOTHING: its title is not
-- wearable, its badge is not counted and its cosmetic is not unlocked until the claim, which
-- is what makes the Claim button mean something. `silent` marks a grant that was applied on
-- creation and never shown — only a source flagged silent in CODE (`REWARD_SOURCES`,
-- server/db/repo.ts) may create one, and the only such source today is this migration's own
-- import of rewards that were handed out before the ledger existed.
--
-- `revoked_at` is how a revocable reward (the GitHub star) is withdrawn. The ROW STAYS, for
-- the reason `provider_links` keeps its unlinked rows: the key is spoken for, and a re-star
-- re-opens the same grant as pending rather than minting a second one.
create table if not exists reward_grants (
  id          uuid        primary key default gen_random_uuid(),
  user_id     text        not null references profiles(user_id) on delete cascade,
  grant_key   text        not null,
  source      text        not null,
  reason      jsonb       not null default '{}'::jsonb,
  items       jsonb       not null default '[]'::jsonb,
  silent      boolean     not null default false,
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  revoked_at  timestamptz
);

-- ⚠️ LEADS WITH `user_id`, THE FOREIGN KEY'S OWN COLUMN, so `npm run dbtest`'s first schema
-- invariant holds without a second index — and it is also every read path this table has
-- ("this account's pending grants", "this account's badge counts"). Unique, so the second
-- invariant (no dead prefix) exempts it.
create unique index if not exists reward_grants_key_idx on reward_grants (user_id, grant_key);

comment on table reward_grants is
  'Every reward an account is given, pending until claimed (docs/area/accounts.md, REWARDS). grant_key names the reward and its period; the unique (user_id, grant_key) index is what makes the award job, a season roll and a boot on every machine idempotent. items = [{kind,id}] delivered on claim; reason = the structured why. Only a source marked silent in code (REWARD_SOURCES) may insert a row already claimed.';

-- ── reward_periods ────────────────────────────────────────────────────────────────────────
-- Which closed period the competitive award job has already paid out. The grant key alone
-- would make a re-run insert nothing for the SAME winners, but it would still mint a grant for
-- a DIFFERENT one — a record deleted by a moderator promotes #4 to #3, an account deletion
-- promotes everybody below it — and an award is a thing that happened at close, not a thing
-- that is recomputed every boot. So a period is claimed once, in the same transaction as its
-- grants, and never read again.
--
-- `period` is the ACT number for `ranked_act` and the BALANCE_VERSION (the season key) for
-- `record_season`. No foreign key and nothing references it.
create table if not exists reward_periods (
  game        text        not null,
  board       text        not null check (board in ('ranked_act', 'record_season')),
  period      integer     not null,
  winners     integer     not null default 0,
  awarded_at  timestamptz not null default now(),
  primary key (game, board, period)
);

comment on table reward_periods is
  'Closed periods the competitive award job (runRewardJob, server/db/repo.ts) has paid out, one row per (game, board, period). Claimed inside the same transaction as the period''s grants, so a period is awarded exactly once whatever its boards later become.';

-- ── profiles.equipped_badges ──────────────────────────────────────────────────────────────
-- The badges an account WEARS beside its name, with their counters: `[{id, n}]`, at most
-- MAX_EQUIPPED_BADGES (src/badges.ts). A PROJECTION of the ledger, in the same spirit as
-- `profiles.role` (0020): the count is `reward_grants`' to decide, and it is copied here so
-- `badgeCols` can ship it off the `profiles` row every board already joins, instead of each
-- board row aggregating the ledger. Rewritten by `refreshEquippedBadges` on every equip,
-- claim and revoke, so it cannot drift from the thing it projects.
alter table profiles add column if not exists equipped_badges jsonb not null default '[]'::jsonb;

comment on column profiles.equipped_badges is
  'The equipped badges and their counters, [{id, n}] — a projection of claimed reward_grants rewritten by refreshEquippedBadges (server/db/repo.ts). Projected by badgeCols so every name surface can draw them without touching the ledger.';

-- ── what was handed out before the ledger existed ─────────────────────────────────────────
-- The GitHub star reward (0047) wrote `title:stargazer` + `decal:star` straight into
-- `profiles.cosmetics`. Those accounts HAVE the reward already, so they are imported as
-- grants that are claimed and SILENT: showing somebody a "you earned this" for a thing they
-- have been wearing for a day would be the dialog lying in the other direction. The row is
-- what lets the sweep revoke it through the one path, and what makes the ledger the complete
-- answer to "why does this account have this?".
insert into reward_grants (user_id, grant_key, source, reason, items, silent, claimed_at)
select user_id,
       'stargazer',
       'stargazer',
       '{"kind":"stargazer"}'::jsonb,
       '[{"kind":"title","id":"title:stargazer"},{"kind":"cosmetic","id":"decal:star"}]'::jsonb,
       true,
       now()
  from profiles
 where cosmetics ? 'title:stargazer'
on conflict (user_id, grant_key) do nothing;

-- `season_awards` (0045) is NOT dropped and NOT migrated: nothing writes it any more (the
-- award job replaced its criteria — ranked by ACT, records by season, Act 0 excluded), but a
-- title it already minted stays wearable (`earnedTitles` still reads it), because taking back
-- something a person was given is worse than a retired table.
comment on table season_awards is
  'RETIRED 0048: no longer written. Its rows keep their titles wearable (earnedTitles still reads them). New competitive awards are reward_grants rows minted by runRewardJob.';
