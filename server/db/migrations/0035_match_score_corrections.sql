-- 0035 — MATCH SCORE CORRECTIONS
--
-- The misscore queue (0030) can already record that the sim got a result wrong. It could not
-- do anything about it: the verdict was a note, and the wrong number stayed on the match, in
-- the history, and in front of the player who filed the claim. This is the other half — an
-- explicit, audited correction of what a finished match scored.
--
-- WHY AN AUDIT TABLE AND NOT JUST AN UPDATE. `match_participants.score` is a published fact:
-- it is in both players' match history and it is what the misscore claim is about. Two people
-- can move it (the sim at finalize, a moderator here) and "why does this match say 47?" has to
-- stay answerable afterwards — the same reasoning `supporter_grants` exists for. The row keeps
-- BOTH sides of the change, so a correction can be read back, and reversed by hand if it was
-- itself wrong.
--
-- WHAT A CORRECTION DELIBERATELY DOES NOT TOUCH: the RATING. Glicko-2 is sequential — every
-- match after this one was rated against the ratings this one produced — so re-rating one
-- match in the middle would mean re-rating every match since, for everyone in it. The result
-- is corrected, the win/loss flag follows it, and the ratings stand. The UI says so.
--
-- Purely ADDITIVE (create-if-not-exists), like every migration here.

create table if not exists match_score_corrections (
  id          bigserial   primary key,
  match_id    uuid        not null references matches(id) on delete cascade,
  -- the moderator's user id. Not a foreign key: an admin is an env id (ADMIN_USER_IDS) and
  -- need not have a profiles row, and losing the account must not erase the audit anyway.
  admin_id    text        not null,
  -- the alliance totals BEFORE and AFTER, so the change reads on its own without
  -- reconstructing it from whatever the row happens to say now
  red_before  integer     not null,
  blue_before integer     not null,
  red_after   integer     not null,
  blue_after  integer     not null,
  -- why, in the moderator's own words. Optional, but the UI asks for it.
  note        text,
  at          timestamptz not null default now()
);

-- the only read: "what has been done to this match", newest first
create index if not exists match_score_corrections_match_idx
  on match_score_corrections (match_id, at desc);
