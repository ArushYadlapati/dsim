-- 0036 — STANDING, EDITABLE BY A MODERATOR
--
-- Standing (0027) is charged entirely by the server: it watches a dodge, an AFK, a walk-out,
-- and writes the ledger. Every one of those is a guess about a person made from a socket, and
-- some of them are wrong — a router died mid-match, a room crashed and billed everyone in it,
-- a brigade pushed someone two tiers before a moderator read the reports. There was no way to
-- put any of that right, which made the honest answer to "this penalty was not mine" a shrug.
--
-- VOIDED, NOT DELETED. A pardon nulls out what an infraction DOES without erasing that it
-- happened: `recentStandingCount` skips voided rows, so escalation genuinely forgets it and
-- the next offence of that kind is priced as a first one — while the row stays in the ledger,
-- struck through, with who voided it and when. Deleting would leave the moderation history
-- lying about a player in both directions: nothing to show the pardoned player their appeal
-- was acted on, and nothing to show the next moderator that this account has been pardoned
-- three times already.
--
-- The MANUAL ADJUSTMENT itself is not a table. It is an ordinary `standing_events` row of kind
-- 'adjustment' (src/standing.ts), so the player reads it in the same list as every other
-- penalty, in the same words — a punishment invented in its own table is one nobody is ever
-- shown, which is exactly what 0027 set out not to build.
--
-- Purely ADDITIVE (add-column-if-not-exists), like every migration here: rolling the server
-- back leaves two unread columns behind and nothing else.

alter table standing_events add column if not exists voided_at timestamptz;
alter table standing_events add column if not exists voided_by text;
-- who made a manual adjustment. Its own column rather than reusing `voided_by`: an adjustment
-- is not a voiding, and a column that means two things is a column the next query gets wrong.
alter table standing_events add column if not exists admin_id text;
-- ...and WHY, in the moderator's own words. Also its own column, for the same reason and one
-- more: the note is READ BACK TO THE PLAYER, and the obvious place to squat was `room_code`,
-- which every other kind of row uses for an actual room. A ledger that showed "room crashed,
-- not their fault" in the room column would be a ledger the next query renders as a room.
alter table standing_events add column if not exists note text;

-- the escalation read (`standing_events_user_kind_at_idx`) now filters on voided_at; a partial
-- index over the live rows keeps that lookup exactly as cheap as it was before the column.
create index if not exists standing_events_live_idx
  on standing_events (user_id, kind, at desc) where voided_at is null;
