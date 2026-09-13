-- LAN runs for BIOBUZZ.
--
-- 0033 pinned `lan_runs.game` to ('decode', 'chain') with an inline CHECK, and said to widen it in
-- the migration that adds the third game. BIOBUZZ is that game, and LAN is being switched on in
-- production alongside it, so a BIOBUZZ match hosted on a LAN would otherwise be refused at the
-- upload with a constraint violation — after the match was played, which is the worst moment.
--
-- An inline column CHECK is named `<table>_<column>_check` by Postgres. Both statements are
-- guarded so this is safe on a database where the constraint was renamed or already widened.
-- A new game means a new migration here, same as this one.

do $$ begin
  if exists (
    select 1 from pg_constraint
    where conname = 'lan_runs_game_check' and conrelid = 'lan_runs'::regclass
  ) then
    alter table lan_runs drop constraint lan_runs_game_check;
  end if;
end $$;

alter table lan_runs add constraint lan_runs_game_check
  check (game in ('decode', 'chain', 'biobuzz'));
