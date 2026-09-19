-- 0041 — THE ADMIN AUDIT LOG, AND MODERATOR NOTES
--
-- Every destructive thing the console can do already leaves SOME trace, and no two of them
-- leave it in the same place: a supporter grant lands in `supporter_grants` (0019), a pardon
-- in `standing_events.voided_by` (0036), a re-score in `match_score_corrections` (0035), a
-- triage in `player_reports.reviewed_by` (0026). Four tables, four shapes, and the ones that
-- write nowhere at all are the ones worth watching — a forced rename, a record deleted, every
-- record a player ever set cleared, a season rolled, replays purged, the service locked down.
-- Those were `console.log` lines on a machine that auto-stops when idle, which is not an audit
-- trail, it is a hope.
--
-- So: ONE table that every mutating admin route writes to, in addition to whatever
-- domain-specific record it already keeps. The per-feature tables stay — they carry the
-- before/after a reversal needs — and this one answers the questions they cannot:
-- "what has this moderator done", "what has been done to this account", "what happened
-- on Tuesday".
--
-- NOT A FOREIGN KEY, either side. An admin is an env id (`ADMIN_USER_IDS`) and need not have
-- a profiles row at all; a target may be deleted, and losing the account must not erase the
-- record of what was done to it. `match_score_corrections.admin_id` (0035) made the same call
-- for the same reason. The cost is that the two id columns need their own indexes, which is
-- the block at the bottom.
--
-- `detail` is jsonb rather than columns because the actions genuinely differ — a rename has a
-- before and an after, a purge has a count, a lockdown has a window — and inventing a union of
-- every action's fields would produce a table that is mostly null and still wrong for the next
-- action. It is written by the SERVER from values it already holds, never echoed from a client.
--
-- Purely ADDITIVE (create-if-not-exists), like every migration here: rolling the server back
-- leaves two unread tables behind and nothing else.

create table if not exists admin_audit (
  id         bigserial   primary key,
  -- the acting admin's user id, or 'secret' for the ADMIN_SECRET curl path (which is a
  -- deploy script, and saying so is more honest than attributing it to a person)
  admin_id   text        not null,
  -- a stable dotted key: 'user.rename', 'record.delete', 'season.start', … Text and not an
  -- enum so adding an action is a code change, the same call 0027 made for `standing_events.kind`.
  action     text        not null,
  -- the ACCOUNT this was done to, when there is one. Null for service-wide actions
  -- (a season roll, a lockdown, a restart notice) — those have no target and pretending
  -- otherwise would put the acting admin in the column that means "the person affected".
  target_user text,
  -- the non-account subject, when there is one: a match id, a record id, a report id, an
  -- announcement id. Separate from `target_user` so "everything done to this account" stays
  -- one indexed lookup rather than a scan with a type tag.
  target_id  text,
  -- what changed, in whatever shape the action has. Server-authored.
  detail     jsonb       not null default '{}'::jsonb,
  -- the moderator's own words, where the action asks for a reason
  note       text,
  at         timestamptz not null default now()
);

-- the tab's default read: everything, newest first
create index if not exists admin_audit_at_idx on admin_audit (at desc);
-- "what has been done to this account" — the user detail view's own section. PARTIAL because
-- service-wide rows have no target and there are a lot of them.
create index if not exists admin_audit_target_idx
  on admin_audit (target_user, at desc) where target_user is not null;
-- the two filters the tab offers
create index if not exists admin_audit_action_idx on admin_audit (action, at desc);
create index if not exists admin_audit_admin_idx on admin_audit (admin_id, at desc);

-- ---------------------------------------------------------------- notes ----
--
-- A moderator's own note about an account: "warned in Discord", "team says this is a shared
-- laptop", "third alt of X". Not a punishment and not shown to the player — the thing a
-- standing ledger cannot hold because the ledger is read BACK to them (0036 says so), and the
-- thing that otherwise lives in somebody's head and leaves when they do.
--
-- This one IS a foreign key: a note is about an account and is meaningless without it, so it
-- cascades away with the profile exactly as `player_reports` does. `admin_notes_user_idx`
-- leads with `user_id`, which is both the read path and what keeps that cascade from scanning
-- the table (see the rule `npm run dbtest` asserts).
create table if not exists admin_notes (
  id       bigserial   primary key,
  user_id  text        not null references profiles(user_id) on delete cascade,
  admin_id text        not null,
  note     text        not null,
  at       timestamptz not null default now()
);
create index if not exists admin_notes_user_idx on admin_notes (user_id, at desc);

-- ------------------------------------------------- the admin read paths ----
--
-- "What has this person FILED" is half of telling a pattern from a grudge, and the user detail
-- view asks it on every open. `player_reports` is indexed on the reported side
-- (`player_reports_reported_idx`, 0026) and on nothing useful for the reporting side:
-- `player_reports_unique_idx` leads with `reporter_id` but its second column is `reported_id`,
-- so it cannot serve an ordering by time. Same shape as the index 0026 gave the other
-- direction, and it is NOT a prefix of the unique one (they diverge at column two).
create index if not exists player_reports_reporter_at_idx
  on player_reports (reporter_id, created_at desc);
