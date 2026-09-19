-- 0039 — WHICH PHYSICS A STORED RESULT WAS PRODUCED BY — a tag on every table that holds one.
--
-- BIOBUZZ gains a second deterministic solve (Rapier 3D, `src/games/biobuzz/sim3d/`, see
-- `docs/biobuzz/plan-3d.md`). It is the SAME GAME and the SAME leaderboard population — the
-- owner's standing rule is that a season is never reset, and bumping BALANCE_VERSION to split
-- the eras would archive everybody's standings over a physics change they did not ask for.
-- So the eras are told apart by a COLUMN instead: a board can badge a row, or filter to one
-- era, without anything being wiped.
--
-- ⚠️ RENUMBERED FROM 0038 (2026-09-18). `alpha` took `0038_replay_privacy.sql` from PR #74 while
-- this branch was being written, and `migrate()` keys `schema_migrations` by FILE NAME and runs
-- the directory in sorted order — so two files numbered 0038 is not a conflict the runner can
-- detect, it is two migrations that both apply in an order nobody chose. This one moved, because
-- the other one is already on alpha. The rename means a dev database that applied `0038_physics`
-- will run `0039_physics` again under its new name, which is why EVERY statement below is
-- idempotent on purpose (`add column if not exists`, `drop constraint if exists` before the
-- `add constraint`, and `comment on`, which simply overwrites). The two migrations touch
-- disjoint columns — 0038 adds `profiles.replays_public` and nothing else — so the order they
-- end up in cannot matter either.
--
-- Purely ADDITIVE (`add column if not exists`, with a DEFAULT), so rolling the server back is
-- safe: an older build never selects these columns and writes rows that take the default.
-- The default is '2d' because that is what every existing row IS — there was one solve when
-- they were written, and it was that one. A pre-0039 row therefore reads '2d' rather than
-- null, which is the property `npm run dbtest` asserts.

-- ---- 1. the four tables that hold a result ---------------------------------------------
--
-- `records` and `matches` are the boards; `replays` is the log the viewer re-simulates (it
-- needs the tag most of all — playback dispatches on it, and a '3d' log re-simulated against
-- the 2D pipeline reproduces a different match from the same inputs); `practice_runs` is the
-- offline mode's own table.
alter table records       add column if not exists physics text not null default '2d';
alter table matches       add column if not exists physics text not null default '2d';
alter table replays       add column if not exists physics text not null default '2d';
alter table practice_runs add column if not exists physics text not null default '2d';

-- ---- 2. the VIEW a practice run was rendered in ------------------------------------------
--
-- Only `practice_runs`, and only this table, because it is the only one where the renderer is
-- a property of the RUN rather than of the machine that happened to be watching: a practice
-- run is a solo session somebody sat through, and "2D canvas or 3D scene" is part of what
-- they did. A server match has four clients that may each have chosen differently, so there
-- is no single answer to record and the column would be a lie.
--
-- NULLABLE, unlike `physics`: an existing row genuinely does not know, and defaulting it to
-- '2d' would state something nobody measured. Absent means absent.
alter table practice_runs add column if not exists view text;

-- ---- 3. the drivetrain check gains `butterfly` -------------------------------------------
--
-- Unrelated to the 3D port and fixed in the same deploy because it is the same kind of bug as
-- the one 0009 fixed: the constraint is a hand-written list of drivetrain names and it never
-- learned the fifth one. `butterfly` has been a real, buildable drivetrain since the tank
-- work that gave `REPLAY_FORMAT` 2 its reason to exist (`ld`/`rd` steering) — so a record run
-- on one is refused by the database at `submitRecord`, after the match was played and scored,
-- with a constraint violation the player sees as a run that silently never reached the board.
--
-- Rewritten rather than extended because a check constraint has no ADD VALUE: drop and
-- recreate, exactly as 0009 did, with 0009's list plus the missing name.
alter table records drop constraint if exists records_drivetrain_check;
alter table records add constraint records_drivetrain_check
  check (drivetrain in ('mecanum', 'tank', 'swerve', 'xdrive', 'butterfly', 'overall'));

-- ---- 4. the two schema INVARIANTS `npm run dbtest` enforces -------------------------------
--
-- No index is added here, and that is a decision rather than an omission:
--
--  · EVERY FOREIGN KEY HAS AN INDEX LEADING WITH ITS OWN COLUMNS — this migration adds no
--    foreign key, so it cannot break that rule (0037 is what fixed the five that did).
--  · NO INDEX IS A DEAD PREFIX OF ANOTHER — likewise untouched. A `physics` index would be
--    exactly the wrong thing to add speculatively: the column has two values on a table whose
--    reads are already keyed by (game, season, …), so it could never be chosen, and it would
--    cost a write on every insert forever. The Day 3 leaderboard filter reads it as a
--    predicate on rows an existing index already found. Add one when a plan says to.

comment on column records.physics is
  'Which physics backend produced this run: ''2d'' (the shared Rapier 2D solve every game runs) or ''3d'' (BIOBUZZ''s deterministic Rapier 3D solve). Pre-0039 rows read ''2d'' because that is what they were. Not a season: BALANCE_VERSION is held.';
comment on column practice_runs.view is
  'Which renderer the player watched this offline run in: ''2d'' (canvas) or ''3d'' (Three.js scene), or null for a run recorded before the column existed. Cosmetic — it says nothing about what was simulated (see practice_runs.physics).';
