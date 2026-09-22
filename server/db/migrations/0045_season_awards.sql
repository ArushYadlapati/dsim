-- 0045 — SEASON AWARDS: what a board's top finishers keep after the season closes.
-- `docs/rewards-round2-plan.md` §2.2, which refines `docs/rewards-plan.md` §3.2.
--
-- Owner, 2026-09-21: ranked TOP 3 per mode; record board OVERALL TOP 3 and PER-DRIVETRAIN
-- TOP 1; and the DUO record board gets the same pair. `mode` therefore carries '1v1'/'2v2'
-- for ranked and 'solo'/'duo' for records, and `kind` says which of the three shapes a row
-- is, so one table answers all four boards without a column per board.
--
-- ⚠️ WRITTEN ONCE, AT SEASON CLOSE, INSIDE `startNewSeason`'s TRANSACTION. Awards are the
-- reason that function stopped being four loose statements: a roll that inserted the new
-- season row and then failed to write the awards would leave the closed season with no
-- winners and no way to notice, and the closed season's boards are exactly what a rerun
-- can no longer read once `active` has moved.
--
-- IDEMPOTENCY IS THE UNIQUE INDEX, not an application check. Closing the same season twice
-- (a retried roll, an admin pressing it again) must not mint a second set. The boards of a
-- CLOSED season no longer move — new runs and new matches are stamped with the new
-- balance_version — so a re-close recomputes exactly the same set and every insert conflicts.
-- `coalesce(drivetrain, '')` is in the index because NULLs never collide in a unique index,
-- so every ranked and overall row would otherwise be insertable forever.
--
-- ⚠️ `user_id` IS PART OF THE SLOT BECAUSE A DUO AWARD HAS TWO HOLDERS. The owner's counts
-- give the duo record board the same shape as the solo one, and a duo row is a PAIR's run:
-- rank 1 there is two people, both decorated. Keying the index on the slot alone would let
-- the first of them insert and reject the second, silently awarding one half of a team.
create table if not exists season_awards (
  id              uuid        primary key default gen_random_uuid(),
  game            text        not null,
  balance_version integer     not null,
  -- the ACT the closed season belonged to, DENORMALISED on purpose: `seasons.act` can be
  -- read back for a closed version, but the title sentence renders on every board row and
  -- a join per row to spell a season number is not worth it.
  act             integer     not null,
  -- the season's number WITHIN its act ("Act 2 Season 3"), denormalised for the same
  -- reason `act` is: it is a count over `seasons` and the title sentence renders on every
  -- board row. Storing it now is free; adding it later needs a backfill that has to
  -- reconstruct a historical count, which is exactly the migration nobody wants to write.
  season_no       integer     not null default 1,
  kind            text        not null check (kind in ('ranked', 'record_overall', 'record_drivetrain')),
  mode            text        not null check (mode in ('1v1', '2v2', 'solo', 'duo')),
  drivetrain      text,
  rank            integer     not null check (rank >= 1),
  user_id         text        not null references profiles(user_id) on delete cascade,
  -- the rating or run score AT CLOSE. Informational — the award does not re-derive from it.
  score           integer,
  created_at      timestamptz not null default now()
);

create unique index if not exists season_awards_slot_idx
  on season_awards (game, balance_version, kind, mode, coalesce(drivetrain, ''), rank, user_id);

-- ⚠️ LEADS WITH `user_id`, WHICH IS THE FOREIGN KEY'S OWN COLUMN. `npm run dbtest` asserts
-- that every FK has an index leading with its columns (0037 fixed five of these): without
-- one, deleting a profile scans this whole table. It is also the read path — "this
-- account's awards, newest season first" — so one index satisfies the invariant and the
-- query at once. It is not a prefix of the slot index above and the slot index is unique,
-- so the second dbtest invariant (no dead prefix) holds too.
create index if not exists season_awards_user_idx
  on season_awards (user_id, game, balance_version desc);

comment on table season_awards is
  'Top-finisher awards minted at season close by startNewSeason (server/db/repo.ts), inside its transaction. One row per (game, balance_version, kind, mode, drivetrain, rank) slot; the unique index is what makes a repeated close idempotent. Read by earnedTitles() and the profile/leaderboard award chip. Unlike elo_history this carries a real cascading FK — an award decorates a name, so with no name there is nothing to decorate and deleteAccount needs no line for it.';
