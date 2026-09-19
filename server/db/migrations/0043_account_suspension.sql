-- 0043 — ACCOUNT SUSPENSION: the moderation lever the console did not have.
--
-- Everything the panel could do to a confirmed cheater stopped short of stopping them.
-- A forced rename takes a word off them; clearing their records takes the scores off the
-- boards; a standing charge (0036) locks RANKED and nothing else, by design — it is an
-- automatic penalty for leaving matches, sized to heal on its own. None of the three keeps
-- somebody out of the custom rooms other players are in, which is what "this account is
-- being used to grief people" actually needs.
--
-- ⚠️ IT IS A DEADLINE, NOT A FLAG. `suspended_until` is a timestamp and a suspension ends by
-- arriving rather than by somebody remembering to lift it: a boolean would mean every
-- temporary suspension is permanent until a second human action that nothing schedules, and
-- the shape of the mistake is that it goes unnoticed for weeks. A permanent ban is still
-- expressible — a far-future date — and is then visibly a decision rather than an omission.
-- `null` is "not suspended", the same unknown-case-is-permissive rule the email gate states.
--
-- ⚠️ NO INDEX, DELIBERATELY. The only query is `where user_id = $1` on the way through a
-- socket join, which is the primary key. An index on `suspended_until` would serve no read
-- this code makes, and `npm run dbtest` asserts no index is a dead prefix of another —
-- a column with one reader and no range scan should not carry one.
--
-- Purely ADDITIVE and `if not exists`: an older server never selects either column and a
-- profile that has never been suspended carries two nulls.
alter table profiles add column if not exists suspended_until  timestamptz;
alter table profiles add column if not exists suspended_reason text;

comment on column profiles.suspended_until is
  'When an account regains online play. NULL means not suspended. A deadline rather than a flag so a temporary suspension ends by arriving; a permanent ban is a far-future date, which reads as a decision. Enforced at the room-join and ranked-queue doors in server/index.ts and written only by POST /api/admin/user/suspend, which also writes admin_audit.';
comment on column profiles.suspended_reason is
  'What the player is told at the door, in the moderator''s own words. Shown to them — so it is not the place for a private note (admin_notes, 0041) and the console says so beside the box.';
