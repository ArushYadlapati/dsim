-- Index the foreign keys that deletes walk, and the column the activity feed orders by.
--
-- Purely ADDITIVE except for two DROPs of indexes that are provably redundant (see below),
-- so rolling the server back is safe: nothing here changes a result, only how fast it is
-- reached. Every statement is `if [not] exists`.
--
-- ---- 1. the unindexed foreign keys -----------------------------------------------------
--
-- `records.replay_id` and `matches.replay_id` are both `references replays(id) on delete set
-- null` (0001_init.sql:75, :115) and neither has an index. Postgres has to find the
-- referencing rows to apply that action, so EVERY replay delete scans both tables in full.
-- That is not a rare path:
--
--   · repo.ts:1027 / :1193 — the practice and LAN prunes, which run on every upload
--   · repo.ts:186          — the season purge, thousands of replays in one statement
--   · repo.ts:1461 / :1474 / :1548 — admin record delete and account deletion
--
-- `records.partner_id` is the same shape (0001_init.sql:70, `references profiles(user_id) on
-- delete set null`) and is walked by every profile delete (repo.ts:1564).
--
-- The pattern was already known here and applied to the newer tables — `practice_replay_idx`
-- (0032:32) and `lan_replay_idx` (0033:74) exist for exactly this reason, and 0032's comment
-- names it as "the purge path, which deletes by the replay a run points at". The two oldest
-- and largest tables were the ones that missed out.
create index if not exists records_replay_idx on records (replay_id);
create index if not exists matches_replay_idx on matches (replay_id);
create index if not exists records_partner_idx on records (partner_id) where partner_id is not null;

-- `kofi_payments.claimed_by` (0018_supporter.sql:41) is the same story on a much smaller
-- table: hit by repo.ts:1561 and by the FK action on every account delete. Cheap to fix.
create index if not exists kofi_claimed_idx on kofi_payments (claimed_by) where claimed_by is not null;

-- `score_reports.match_id` (0030_score_reports.sql:19) is `references matches(id) on delete
-- set null` and is not indexed either. Nothing deletes from `matches` today, so unlike the
-- four above this one is latent rather than costing anything now — it is fixed because the
-- rule is worth being able to state without exceptions, and the check in `npm run dbtest`
-- asserts the rule. Note the unique index at 0030:38 does NOT cover it: `match_id` is its
-- third column and is wrapped in `coalesce`.
create index if not exists score_reports_match_idx on score_reports (match_id) where match_id is not null;

-- ---- 2. the activity feed --------------------------------------------------------------
--
-- `recentMatches` (repo.ts:3225) unions the whole of `matches` and the whole of `records`
-- and then `order by created_at desc limit $1`, to return 40 rows. No index on either table
-- leads with `created_at`: `records_board_idx` is (game, balance_version, mode, drivetrain,
-- score desc, created_at) — sixth column, unusable for ordering — and `matches` has only
-- (game, balance_version). So both branches seq-scan and the union is sorted in full, at a
-- cost that grows with total site history forever.
--
-- ONE index each, on `created_at` alone rather than `(game, created_at)`. The endpoint's
-- `game` filter is optional (server/index.ts:897) and a composite leading with `game` cannot
-- serve the unfiltered call at all, while `created_at desc` serves both: with only three
-- games, the filtered variant walks a small constant factor more index entries before it
-- reaches `limit`. Two indexes per table to shave that factor would cost a write on every
-- match for nothing.
create index if not exists matches_recent_idx on matches (created_at desc);
create index if not exists records_recent_idx on records (created_at desc);

-- ---- 3. the rated-challenge lookup -----------------------------------------------------
--
-- `challengeParty` (repo.ts:4309) filters `room_invites` on `room = $2 and format = $3 and
-- created_at > …`, and `room_invites` is indexed only on `to_user_id` (0017:26) and
-- `from_user_id` (0019:27) — nothing on `room`. This query gates every rated friend match,
-- and `room` is the selective term: the token IS the match.
create index if not exists room_invites_room_idx on room_invites (room, format, created_at desc);

-- ---- 4. two indexes that can never be read ---------------------------------------------
--
-- Both are a strict prefix of an existing unique constraint's index, so the planner has a
-- better option for every query they could serve, and all they do is cost a write on each
-- insert and update.
--
--   · `user_activity_user_idx on user_activity (user_id)` (0028:34) — the table's PRIMARY KEY
--     is `(user_id, game)` (0028:30), whose leading column is already `user_id`.
--   · `friend_requests_from_idx on friend_requests(from_user_id)` (0016:20) — the table
--     already declares `unique (from_user_id, to_user_id)` (0016:15).
--
-- `friend_requests_to_idx` is NOT redundant and stays: `to_user_id` is the unique index's
-- SECOND column, which cannot serve a lookup by it.
drop index if exists user_activity_user_idx;
drop index if exists friend_requests_from_idx;
