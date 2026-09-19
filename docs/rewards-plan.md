# Rewards for loyal and top players — plan

Roadmap item 4. A design for the owner to approve; no code ships with this document.
Build branch: `feat/rewards`, off `alpha`, after approval.

---

## 1. Goal and non-goals

**Goal.** Two server-authored ledgers: **loyalty** (server-observed play over time —
matches and a daily streak) and **top players** (per-season awards written when a ranked
period closes). Both grant titles, badge frames, and cosmetic unlocks; both surface
beside a name the way `SupporterBadge` already does.

**Non-goals:**

- **Rewards never touch rating, boards, or ELO.** A reward changes what a name *looks
  like*, never a Glicko-2 number, a board position, or a PB. Glicko-2 stays exactly as
  it is (`server/ranked.ts`); nothing here writes `elo_ratings` or `records`.
- **Paid and earned stay separate.** A supporter badge and an award badge are different
  claims about an account — one bought, one played for — and neither should imply the
  other. Recommendation in §5: supporters get no exclusive *earned* rewards.
- **No new competitive read of `user_activity`.** That table is explicitly
  documented as off-limits to anything competitive (`docs/area/netcode.md`) because it
  mixes server-observed matches with client-reported practice ticks with no way to tell
  them apart (§2). Loyalty reads different, purely server-written tables (§3).
- **Anti-farm by construction, not by a rule someone has to remember.** Loyalty counts
  only rows a server wrote at match end; awards are computed once, at archive time, off
  a frozen snapshot — never recomputed live, never re-queryable to "check if I'm close."

---

## 2. What exists today, and the gaps

| exists | citation |
|---|---|
| Paid supporter perks: badge, ads-off, 6 saved starts, chassis colours, all built | `docs/area/monetization.md` |
| Staff badges: `profiles.role`, env-reconciled at boot, folded into the one supporter predicate | `server/db/migrations/0020_staff_roles.sql`, `server/db/repo.ts:355-357` |
| `SupporterBadge`: exactly one badge, rank order owner > admin > supporter, inline SVG in a 24x24 box, three distinct SATURATED hues (`--ds-accent` owner, `--ds-blue-chip` admin, `--ds-gold` supporter), portal tooltip, `sup-sm`/`sup-md` sizes | `src/ui/SupporterBadge.tsx`, CSS at `src/ui/styles.css:2394-2483` |
| `badgeCols(alias[, prefix])` writes the badge pair once per query so a board can't silently ship badge-less | `server/db/repo.ts:371-375` |
| Every row type carries badges via `BadgeFields` (`src/net/api.ts:42-47`); badge is a CSS *sibling* of the name, never nested in it (`DriverName`, `src/ui/Leaderboard.tsx:64-102`) | — |
| Glicko-2 ranked, per-game, per-mode boards; `elo_ratings` (live) + `elo_history` (frozen per-season snapshot) | `server/ranked.ts`; `server/db/repo.ts:2895-2936` |
| An existing admin action that closes a period: `startNewSeason` bumps the season/act and marks the prior one inactive — "older periods are archived but still viewable" | `server/db/repo.ts:155-179`, route `/api/admin/season/start` (`src/net/api.ts:1335`), `src/ui/Admin.tsx:253` |
| Solo record runs: PB/WR per mode x drivetrain x season, `records` + the `record_leaderboard` view | `server/db/migrations/0001_init.sql:62-91` |
| PvP match history: `matches` + `match_participants`, versus-only, server-written at match end | `0001_init.sql:111-131` |
| `user_activity`: aggregated games+seconds per (user, game), the profile's playtime tile | `server/db/migrations/0028_user_activity.sql` |
| No achievements, streaks, or titles anywhere in the code | — |

**Gaps:**

1. **`user_activity` cannot be the loyalty source — two trust levels share one
   counter.** `persistMatch` credits it for every server-run match, versus and record
   alike (`server/persist.ts:85-101`, off the authoritative replay's tick count). But
   `/api/practice`'s upload route credits the *same table* for a client-reported solo
   practice run (`server/api.ts:602-627`, explicitly client-written per
   `docs/area/netcode.md`'s practice section). One row, one `games`/`seconds` pair, no
   column says which portion came from where — fine for "how much have I played,"
   unusable for a server-observed-only ledger. §3 reads different tables entirely
   rather than splitting this one after the fact.
2. **No day-level or streak concept exists.** Nothing records "played on day X."
3. **No per-season awards table.** `startNewSeason` archives a period (marks it
   inactive, freezes `elo_history`) but writes nothing naming *who* the period's top
   players or record holders were — only reconstructable later by re-querying
   `eloHistoryLeaderboard`/`records`, which is fragile (a later purge could change what
   "the season 3 champion" means) and carries no badge/title anywhere.
4. **BIOBUZZ is excluded from all of this by construction, not by choice.**
   `persistMatch` skips any unscored game outright (`!simModuleFor(game).scored`,
   `server/persist.ts:58-61`), and BIOBUZZ is unscored (`CLAUDE.md`'s season table) —
   today it writes no `user_activity`, `matches`, or `records`. Both ledgers below are
   DECODE/Chain Reaction only until BIOBUZZ is scored.

---

## 3. Design

### 3.1 Loyalty ledger — server-observed play

**New table**, additive migration (next free number):

```sql
create table if not exists user_days (
  user_id text not null references profiles(user_id) on delete cascade,
  game    text not null,
  day     date not null,
  primary key (user_id, game, day)
);
```

Written by `persistMatch` (`server/persist.ts`), in the same block that already calls
`addActivity` at line 97 — `insert ... on conflict do nothing`, one row per account per
game per calendar day, keyed off the **server's own clock**, not anything the client
reports. This is deliberately a *new* write, not a repurposing of `user_activity`,
for exactly the reason in gap 1: keeping it a pure, single-source table is what makes it
safe to build a reward on.

**Match-count milestones** need no new counter at all: `count(*) from match_participants
where user_id = $1` plus `count(*) from records where user_id = $1 or partner_id = $1`
are already exclusively server-written, at the same `persistMatch` call site, so a
milestone like "50 matches" is a read over tables that already exist and are already
trustworthy — no redundant write path to keep in sync.

**Streaks** (current / longest) are a window-function read over `user_days`, computed on
demand (profile view), not maintained as a running counter — cheap at this row count and
avoids a second place a number can drift from the source rows.

**Rewards**: titles and cosmetic unlocks only, checked right after the `user_days`
insert in `persistMatch` — if a threshold is newly crossed, append to
`profiles.cosmetics` (`docs/cosmetics-plan.md` §3.2) and/or a new
`profiles.titles jsonb not null default '[]'`, logging the source the way
`supporter_grants` logs `supporter_until` changes. No cron job, no background worker —
the only place a match's existence is known is the moment `persistMatch` runs.

### 3.2 Top-players ledger — season awards

**New table**:

```sql
create table if not exists season_awards (
  id              uuid primary key default gen_random_uuid(),
  game            text not null,
  balance_version integer not null,
  kind            text not null check (kind in ('elo_top', 'record_holder')),
  mode            text not null,      -- '1v1'/'2v2' for elo_top; 'solo'/'duo' for record_holder
  drivetrain      text,               -- record_holder only
  rank            integer,            -- elo_top only, 1..N
  user_id         text not null references profiles(user_id) on delete cascade,
  score           integer,            -- informational: rating or run score at close
  created_at      timestamptz not null default now()
);
create index if not exists season_awards_user_idx on season_awards (user_id, game);
```

Written **once, inside `startNewSeason`** (`server/db/repo.ts:155-179`), right before
(or as part of) marking the closing season inactive — the exact moment the codebase
already treats as "this period is now archived." Top-N per (game, mode) comes from the
same query shape `eloLeaderboard`/`eloHistoryLeaderboard` already use
(`server/db/repo.ts:2850-2936`), just run against the season being closed instead of the
live one, with `limit` = the owner's chosen N (§5). Record holders come from
`record_leaderboard` (the existing best-per-segment view) for that same closing season.
This is an **admin-triggered write, not a scheduled job** — it rides the existing "start
a new season" action (`src/ui/Admin.tsx:253`, route `/api/admin/season/start`), so no new
admin UI surface is strictly required, only a bigger transaction.

### 3.3 Surfacing

- **`AwardBadge`**, a sibling component of `SupporterBadge` (`src/ui/SupporterBadge.tsx`)
  — same inline-SVG-in-24x24-box technique, same portal tooltip, but a **distinct
  shape** (not the disc `SupporterBadge` uses) and a **new saturated hue** on both
  themes, since gold/accent-green/blue-chip are already spoken for by
  owner/admin/supporter (`styles.css:2461-2483`). Exact glyph and colour are an owner
  call (§5) but the fill/ink split rule applies here exactly as it does everywhere else
  (`CLAUDE.md`'s theming gotcha: "a colour that is both a fill and a text colour will
  fail one of the two — split it"). Shows the single highest-precedence award, mirroring
  `SupporterBadge`'s "exactly one badge" rule, so a row never carries two chips fighting
  for the same 16px.
- **Leaderboard chip**: a further sibling in `DriverName` (`src/ui/Leaderboard.tsx:64-102`),
  beside the existing `SupporterBadge` — the same badge-as-sibling-of-name rule applies
  (a badge nested in the name gets underlined/truncated with it).
- **Career "Awards" section**: a new block in `CareerPanel`'s `ds-panel-body stack`
  (`src/ui/CareerPanel.tsx:70-96`), next to the existing activity tile — lists titles and
  season awards with the period each was earned in. `UserStats`
  (`src/net/api.ts:199-216`) grows `awards?: AwardRow[]`, following the same
  "absent renders as nothing" contract every optional field there already uses.
- A new `awardCols`-style SQL helper, mirroring `badgeCols`'s lesson (`repo.ts:371-375`)
  that hand-writing badge columns per query is how a board silently ships without them.

### 3.4 Anti-farm

- **Loyalty** counts only `persistMatch`-written rows (`match_participants`, `records`,
  `user_days`) — practice is never in this path, so a client cannot self-report a
  streak or a match count.
- **Awards** are computed exactly once, when a season closes, off the same frozen
  snapshot `elo_history` already takes — there is no live "your current rank toward the
  award" number to farm against, and no way to trigger a second computation for the
  same closed season (the write is keyed on `(game, balance_version, kind, mode, rank
  or user_id)`).
- Neither ledger is reachable from anything that reads `user_activity` (gap 1) —
  keeping this rule symmetric with the standing existing rule against reading that
  table competitively.

### 3.5 Migrations, API, UI — summary

- One migration: `user_days`, `season_awards`, `profiles.titles jsonb` (or reuse
  `profiles.cosmetics` with a `title:` namespace — a call for the build, not the plan).
- `persistMatch` (`server/persist.ts`): one new insert (`user_days`) beside the
  existing `addActivity` call, plus a milestone check against the two existing
  authoritative tables.
- `startNewSeason` (`server/db/repo.ts:155-179`): grows to also snapshot top-N + record
  holders into `season_awards` for the season it is closing.
- `UserStats` (`src/net/api.ts`) and the leaderboard row types grow an award field,
  following the `BadgeFields` pattern.
- New `AwardBadge` component + CSS; a Career "Awards" section; a leaderboard chip.

---

## 4. Build plan

| step | size | verification |
|---|---|---|
| 1. Migration: `user_days`, `season_awards`, titles storage | 0.5 d | `npm run dbtest` |
| 2. `persistMatch`: write `user_days`; milestone check against `match_participants`/`records`; unlock write (titles/cosmetics) with source logging | 1 d | `npm run dbtest` |
| 3. `startNewSeason`: snapshot top-N (per game x mode) + record holders into `season_awards` at close | 1 d | `npm run dbtest`, a manual dry run against a seeded season |
| 4. `AwardBadge` component + CSS (distinct shape/hue, both themes) | 0.5 d | `npm run uiaudit`, `npm run contrast` |
| 5. Surfacing: leaderboard chip, Career "Awards" section, `UserStats`/row-type plumbing | 1 d | `npm run uiaudit`, `npm run shiftaudit`, visual pass both themes |
| 6. Smoke coverage: milestone thresholds trigger exactly once; a season close is idempotent (running it twice does not duplicate `season_awards` rows) | 0.5 d | `npm test` additions + `npm run dbtest` |

**Total:** ~4.5 d, inside the roadmap's 3-5 d estimate. Branch `feat/rewards`.

**Risks.**

- `startNewSeason` is currently a small transaction; folding a top-N + record-holder
  snapshot into it touches a path the owner runs live, in production, to roll a season
  — needs a dry run against a copied season before it runs against the real one.
- The milestone check inside `persistMatch` (already off the hot path, phase `'post'`)
  must stay cheap — two `count(*)` queries per match end, not a full scan; index
  accordingly (`match_participants_user_idx` exists at `0001_init.sql:130-131`;
  `records` needs the equivalent, per `dbtest`'s existing rule that every FK gets an
  index leading with its own columns).
- Depends on `docs/cosmetics-plan.md`'s `profiles.cosmetics` column for the cosmetic
  half of a loyalty reward — sequence cosmetics' migration first, or land both in the
  same migration if the two branches ship together.

---

## 5. Decisions for the owner

1. **Award names and art.** Titles, the `AwardBadge` glyph, and its colour token (must
   be new — gold/accent-green/blue-chip are taken, §3.3).
2. **Whether supporters get exclusive earned rewards.** Recommendation: no — keep paid
   and earned visibly distinct, per §1's goal.
3. **Milestone thresholds.** Match-count tiers (e.g. 10/50/200) and streak lengths
   (e.g. 7/30 days) that unlock a title or a cosmetic.
4. **Top-N per season.** How many players per (game, mode) get an `elo_top` award —
   the roadmap sketch suggests 10 (`docs/roadmap.md:99`).
5. **Whether a supporters roster is ever shown publicly.** A privacy question distinct
   from awards, but adjacent: the same "who gets listed" instinct applies to a top-N
   awards roster, which is public by construction (it is a leaderboard). Confirm that
   is the intended visibility before building it.
