-- 0037 — A MATCH REPLAY IS PRIVATE UNTIL EVERYONE IN IT SAYS OTHERWISE
--
-- `/api/replay/<id>` has always served any replay to anyone, and the public profile hands out
-- the ids: open a leaderboard, click a name, and every Watch button on that stranger's match
-- history plays their match back in full. A replay is an input log re-simulated at full
-- fidelity, so what it shows is not a score — it is the whole game plan. Where they start,
-- what they go for first, which goal they feed, when they leave for the endgame. That is
-- scouting material, and nobody agreed to publish it.
--
-- So the default flips: a versus replay is watchable by the people who PLAYED it, and by
-- nobody else unless they opt in.
--
-- UNANIMITY, NOT OWNERSHIP. The flag is per-account, but a match replay shows both alliances,
-- so one player's opt-in would publish their opponent's strategy as surely as their own. A
-- versus replay therefore goes public only when EVERY participant has the flag set. Anything
-- less and an opt-out means nothing — you would keep your replays private and still be scouted
-- out of the matches you happened to play against someone who did not care.
--
-- WHAT IS NOT GATED, and why:
--   * `records` — a record run is a leaderboard submission and its replay is the PROOF. The
--     board is self-policing precisely because anyone can re-simulate the log behind a number
--     (0001_init.sql:63-66), and a private proof is not one. Score-attack also has no opponent,
--     so there is no second party's strategy in it.
--   * `lan_runs` — a self-hosted server's own archive, already scoped to the host who uploaded
--     it, and its drivers may have no accounts at all to carry a flag.
--   * the match history LIST — results, scores, W/L and rating deltas stay public. Those are
--     the leaderboard's substance; what comes off the page is the Watch button, not the row.
--
-- ON `profiles` rather than in its own table, unlike `user_presence` (0016). That one is
-- skinny because presence is REWRITTEN on every heartbeat and because leaking it would be a
-- privacy fault in itself. This is written when somebody visits their Profile page and changes
-- their mind, and the bit is not a secret — "this account's replays are public" is exactly what
-- trying to watch one already tells you. Every public read of `profiles` projects an explicit
-- column allowlist (repo.ts `ProfileCols`), so the column cannot join a payload by accident.
--
-- DEFAULT FALSE IS RETROACTIVE, ON PURPOSE. Every replay recorded before today becomes private
-- to its participants. Opting the existing corpus in would publish matches played by people who
-- were never asked, which is the thing this migration exists to stop.
--
-- Purely additive, like every migration here: rolling the server back leaves one unread column
-- behind and restores the old behaviour exactly.

alter table profiles add column if not exists replays_public boolean not null default false;

comment on column profiles.replays_public is
  'Opt-in: may anyone watch this account''s versus match replays? A match replay is released only when EVERY participant has this set (see server/db/repo.ts replayVisibility). Does not cover record-run replays, which are public leaderboard proof.';
