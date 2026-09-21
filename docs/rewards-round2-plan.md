# Rewards, round 2 — linked accounts, Discord boosts, and top-player titles

A design for the owner to approve. No code ships with this document.
Build branch: `feat/rewards` (the same branch roadmap item 4 names), off `alpha`.

⚠️ **This is a SECOND rewards document and it does not replace the first.**
`docs/rewards-plan.md` is roadmap item 4 as written on 2026-09-18: a loyalty ledger
(`user_days`, match-count milestones) and a season-awards ledger. It is still unbuilt —
the last migration is `0044_cosmetics.sql`, there is no `user_days` and no
`season_awards`. This document covers the three things the owner asked for on top of it,
**refines** its §3.2 (the season-awards half, which reads the wrong ELO table), and
**leaves §3.1 (loyalty) exactly as it stands**. Where the two disagree, this one is later.

---

## 0. Where this lands against what already exists

**Cosmetics are BUILT.** `src/cosmetics.ts` (four closed axes), migration `0044`
(`profiles.cosmetics jsonb`), `grantCosmetic`/`revokeCosmetic` with `admin_audit` rows,
`stripUnentitledCosmetics` at every live ingress, `GET /api/user/entitlements` carrying
`unlockedCosmetics`. Crucially, `src/cosmetics.ts`'s header already says:

> `earned` keys are permanent account state (`profiles.cosmetics`, server-written) and
> survive a lapsed membership — **none exist yet; the slot is here so the rewards ledger
> can fill it without a schema change to this file.**

That slot is what two of the three asks below drop into. There is no new entitlement
mechanism to invent for anything permanent.

**Authentication is BUILT** (`docs/area/accounts.md`, "AUTHENTICATION FLOWS"). Roadmap
item 5 landed: `src/lib/authFlows.ts` is the one module that calls the beta Neon Auth
SDK, pinned to an exact version precisely so an SDK rename is a one-file fix. Account
linking belongs inside it. §4 argues that the "real auth" item does **not** block this.

**Two stale claims in `docs/rewards-plan.md`, worth fixing when it is next touched:**

1. Gap 4 says BIOBUZZ is unscored and therefore excluded. It is `scored: true`
   (`src/games/biobuzz/sim.ts:103`, since kickoff evening 2026-09-12), so `persistMatch`
   no longer skips it and BIOBUZZ is in scope for everything here.
2. §3.2 computes ranked top-N from `eloLeaderboard`. **That board is keyed by ACT, not
   by season** (`elo_ratings.act`, `repo.ts:3531`) — ratings persist across seasons
   inside an act and reset on an act bump. The per-SEASON board is `elo_history`
   (`0014_elo_history.sql`), read by `eloHistoryLeaderboard` (`repo.ts:3602`). An award
   for "the season" must read the second one or it names the act leader. See §3.3.

---

## 1. The recommendation on ask (3), up front

> "add proper rewards (like a badge?) for top 3 … Or maybe allow each player to equip a
> title and banner like valorant? I dont know."

**Build equippable TITLES from a closed, server-issued set, plus one `AwardBadge` chip
beside the name. No banners. No player-authored text, ever.** Four arguments, in the
order that decided it:

**a. A free-text title is a moderation bomb, and the moderation path fails open.**
`server/moderation.ts` states its policy in its own header: with no `MODERATION_API_KEY`
and no `MODERATION_BLOCKLIST`, *moderation is disabled and every name is allowed*, and
even when configured, a timeout or a provider outage allows the name. That is the right
call for a username — there is an admin forced-rename behind it and a person waiting on a
sign-up form. It is the wrong call for a decoration that renders on a public leaderboard
next to a real name, because nobody is waiting and the failure is permanent until someone
reports it. `docs/cosmetics-plan.md` §1 already took this position ("No moderation
surface… every axis is closed-set") and the owner already accepted it for the number
plate. A closed set keeps that property.

**b. The ask is about provenance, not decoration.** "Top 3 on the ranked board" is a
claim about something that happened. A title the server issues and stamps with
`(game, act, season, mode, rank)` is checkable against a row; a Valorant title is a
cosmetic you selected. Making the title *say what was won* — `DECODE · Act 2 Season 3 ·
1v1 Champion` — is what makes it worth equipping, and it costs nothing extra because the
award row already holds every field the sentence needs.

**c. A banner has nowhere to go.** The two places a name appears are a leaderboard row
and the label over a robot; neither has room for an image. A banner needs a profile hero
section that does not exist, art per award, and a bundle budget (`npm run bundleaudit`
ratchets every chunk). It is a separate item with its own design, not a line in this one.
If the owner wants one later, `season_awards` (§2.2) is already the data it would read.

**d. It costs nothing on the wire.** The title is a KEY, resolved to a sentence
client-side from a registry — the same discipline `CHASSIS_COLORS` enforces
(`src/cosmetics.ts`: "The KEY goes over the wire and into replays, never a hex, a path or
an image"). See §5 for the byte-level argument.

One more rule, borrowed wholesale: **exactly one title equipped, exactly one award
badge**, mirroring `SupporterBadge`'s existing "exactly one badge — owner ★ > admin ◆ >
supporter ♥" rule (`docs/area/accounts.md`). Two chips fighting over the same 16 px next
to a name is how a board row stops being readable.

---

## 2. Data model

Next free numbers are `0045`–`0047`. (Note the existing convention: `0003`, `0012`,
`0018` and `0019` each appear twice, from parallel branches. Duplicate numbers are
tolerated; going backwards is not.)

### 2.1 `0045_provider_links.sql` — one table, not columns on `profiles`

```sql
create table if not exists provider_links (
  provider          text        not null check (provider in ('github', 'discord')),
  provider_user_id  text        not null,
  user_id           text        not null references profiles(user_id) on delete cascade,
  linked_at         timestamptz not null default now(),
  unlinked_at       timestamptz,
  primary key (provider, provider_user_id)
);
create index if not exists provider_links_user_idx on provider_links (user_id, provider);
```

**Why a table and not `profiles.github_user_id`**, when `kofi_email` is a column
(`0019`): the Ko-fi link is 1:1 and has no history — the unique partial index on it is
"one subscription cannot feed several accounts", and that is all it needs to be. A
provider link needs the same guarantee *and* it needs to survive an unlink, because
otherwise unlink-and-relink is a free reward mint (§6). Making
`(provider, provider_user_id)` the PRIMARY KEY, and setting `unlinked_at` rather than
deleting the row, means **one GitHub account can ever earn once, on one DSIM account,
forever** — the same guarantee `profiles_kofi_email_idx` gives, extended over time.

**Stored: the provider's immutable numeric id and two timestamps. Nothing else.** No
login, no email, no avatar, no access or refresh token, no guild list. The login is
re-fetchable and changes; the id does not. §4 covers the privacy text.

**Both `dbtest` schema invariants hold.** The single foreign key is `user_id`, and
`provider_links_user_idx` leads with `user_id` → invariant 1 satisfied. The only other
index is the primary key, which leads with `provider` → neither is a prefix of the other,
and a unique index is exempt from invariant 2 by its own `where not a.uniq` clause
(`scripts/dbtest.ts:2102`) in any case.

### 2.2 `0046_season_awards.sql`

Refines `docs/rewards-plan.md` §3.2.

```sql
create table if not exists season_awards (
  id              uuid        primary key default gen_random_uuid(),
  game            text        not null,
  balance_version integer     not null,           -- the SEASON that closed
  act             integer     not null,           -- copied from `seasons` at close, for the title text
  kind            text        not null check (kind in ('ranked', 'record_overall', 'record_drivetrain')),
  mode            text        not null,           -- '1v1'|'2v2' for ranked; 'solo'|'duo' for records
  drivetrain      text,                           -- record_drivetrain only
  rank            integer     not null,
  user_id         text        not null references profiles(user_id) on delete cascade,
  score           integer,                        -- rating or run score AT CLOSE, informational
  created_at      timestamptz not null default now()
);
-- idempotency: closing the same season twice must not mint a second set
create unique index if not exists season_awards_slot_idx
  on season_awards (game, balance_version, kind, mode, coalesce(drivetrain, ''), rank);
-- the profile/board read, and the FK's index
create index if not exists season_awards_user_idx
  on season_awards (user_id, game, balance_version desc);
```

**On the foreign key**, where this differs from `elo_history`: that table deliberately
has none, and `deleteAccount` deletes from it by hand (`repo.ts:2124`, and the comment
above it explains why — it is a per-season snapshot that must outlive a season roll). An
award is not a snapshot; it is a decoration on a name, and with no name there is nothing
for it to decorate. So it takes a real `on delete cascade` FK and needs no line in
`deleteAccount`. The index above leads with `user_id`, so invariant 1 is satisfied at the
same time as the read path it exists for. Neither index is a prefix of the other, and the
slot index is unique anyway.

`act` is denormalised on purpose: `seasons.act` for a closed version can be read back,
but the title sentence is rendered on every board row and a join per row to spell a
season number is not worth it.

### 2.3 `0047_titles.sql`

```sql
alter table profiles add column if not exists title text;
```

The **equipped** title id, nullable. Additive, same shape as every other `profiles`
addition since `0003`.

**What is NOT stored is the list of titles an account has earned**, because both sources
already know it:

- **award titles** are derived from `season_awards` rows (`award:<id>` or, better, a
  deterministic key from `(game, balance_version, kind, mode, drivetrain, rank)`);
- **granted titles** — the GitHub one in §3.1, loyalty milestones later — go into
  `profiles.cosmetics` as a new `title` axis in `COSMETIC_AXES` (`src/cosmetics.ts`).
  That inherits `grantCosmetic`'s idempotency, its `admin_audit` row, `revokeCosmetic`,
  the entitlements payload and the admin console for free, with **no new table and no new
  grant path**.

One resolver, `earnedTitles(userId)`, unions the two. ⚠️ **This is the main schema
judgement call in the document.** The alternative — writing an award's title into
`profiles.cosmetics` too — would require `COSMETIC_AXES` to contain a key per season per
board, i.e. a source change every time a season rolls, which is exactly the thing a
closed compile-time registry is bad at. Season titles are therefore data; fixed titles
are registry keys.

`setTitle(userId, id)` validates against `earnedTitles` on WRITE and refuses anything
else, so the bare `text` column cannot hold an unearned value. `revokeCosmetic` and any
award reversal must also clear `profiles.title` when it matches — the same shape as
`clearUsername` (`docs/area/accounts.md`): the moderator takes the thing away, they do not
leave a dangling reference for a render path to discover.

---

## 3. Earning, and what happens when it goes away

### 3.1 A GitHub star

**Linking.** The installed adapter already exposes `linkSocial`, `listAccounts`,
`unlinkAccount` and `accountInfo`
(`node_modules/@neondatabase/auth/dist/better-auth-react-adapter-D53HN_n5.d.mts:1750`,
`:1790`, `:1825`, `:1884`). The app calls `signIn.social({ provider: 'google' })` today
(`src/ui/AuthPanel.tsx:160`) through a hand-typed `AuthClient` interface
(`src/lib/authClient.ts:39`) that omits all four — the same omission roadmap item 5 found
for the password-reset methods. **Every new call goes through `src/lib/authFlows.ts`**,
which exists for exactly this reason, and returns a discriminated result rather than
throwing at a component.

⚠️ **GUESS, VERIFY FIRST:** that the Neon Auth project can enable GitHub and Discord as
social providers at all. The SDK surface is generated from Better Auth's route table and
Better Auth supports both, but whether the Neon-hosted project exposes them is an owner
dashboard question, like the email sender domain in `docs/deploy.md` §4. If it does not,
the fallback is a plain authorization-code flow in `server/api.ts` storing only the
provider id — more code, no SDK risk, and §2.1's schema is unchanged either way.

**Noticing the star: sweep the REPO, not the user.** `GET /repos/genius0412/dsim/stargazers`
(the repo is `LINKS.repo`, `src/seasons.ts`) is public data, 100 ids per page,
ETag-conditional so an unchanged list costs one `304`. One request cycle per sweep covers
**every** linked account at once. The alternative — `GET /user/starred/{owner}/{repo}` per
user — needs a stored user token, which is a secret at rest for a reward worth one decal.
There is no reason to hold one.

**Granting.** Set-difference on each sweep: `(stargazer ids) ∩ (linked ids) − (already
granted)` → `grantCosmetic(userId, 'title:stargazer', 'github')`. That call is already
idempotent (the jsonb `?` containment check skips a duplicate write) and already writes
an `admin_audit` row whose `source` is free text — `repo.ts`'s own comment anticipates
"a ledger name like `'rewards'` once that ships".

**UNSTARRING REVOKES — owner ruling, 2026-09-21** (“unstarring should revoke the reward
honestly, unless there are significant performance hits on us”). There are none, measured
against the code rather than estimated:

- **No extra GitHub traffic at all.** The sweep already holds the full stargazer set to do
  the grant. Revocation is the same set difference read the other way —
  `(already granted) − (stargazer ids)` — so the request count per cycle is unchanged.
- **`revokeCosmetic` already exists** (`repo.ts:812`), mirrors `grantCosmetic`, and is
  guarded by `where user_id = $1 and cosmetics ? $2`. An account that did not hold the
  title takes NO write and no audit row, so the steady-state cost of a sweep where nobody
  unstarred is zero UPDATEs, not one per linked account.
- Audit volume is a non-issue here, unlike §3.2's floor: a revoke is a rare human act, not
  an hourly heartbeat.

⚠️ **THE SWEEP MUST BE FAIL-SAFE, AND THIS IS THE WHOLE COST OF THE DECISION.** Grant-only,
a failed or truncated GitHub fetch meant “no new grants this cycle” and was harmless. With
revocation the same failure would strip the title from EVERY holder at once. So:

- Revoke only after a **complete, successful pagination**. A non-2xx, a timeout, or a page
  loop that ended early aborts the whole cycle — grants included — and changes nothing.
- A `304 Not Modified` means **do nothing**, never “the stargazer list is empty”. That
  mis-reading is the same shape as the bug in §3.2 and deserves the same suspicion.
- The check to write before the code: a sweep whose fetch throws revokes nobody, and a
  sweep returning a full list minus one id revokes exactly one.

⚠️ **AND IT CAN BE REVOKED WHILE WORN.** `stripUnentitledCosmetics` runs at join and on
`update`, so a title removed mid-session lands on the next patch; the EQUIPPED title must
fall back rather than render an id the account no longer owns. That path has to exist now
— it was the main argument for permanence and the ruling overrides it, so it becomes work
in stage B rather than an argument against the stage.

**What does NOT change: the reward stays in `profiles.cosmetics`.** `0044`'s header says
that ledger is permanent (“a lapsed membership can never delete something earned”), and a
revocable entry sits awkwardly against it — but the alternative, a `supporter_until`-style
floor, is worse here: a floor is a DEADLINE that expires by arriving, and an unstar is an
EVENT with no deadline attached. The honest reading is that `0044`'s permanence is about
MEMBERSHIP lapsing, not about the grantor withdrawing the thing granted, which is exactly
what `revokeCosmetic` was already written for.

**The farm is still dead either way**: §2.1 means one GitHub id earns on one DSIM account,
ever, so star→claim→unstar→repeat buys nothing now that the claim is also withdrawn.

### 3.2 A Discord boost → the supporter perk

**The perk IS `supporter_until`, and nothing else.** `SUPPORTER_COL` (`repo.ts:389`) is
the single predicate behind the badge, ads-off, the saved-start cap, the supporter
palette and `/api/user/entitlements`, and `docs/area/accounts.md` states the rule for
extending entitlement: *"never add a second 'is staff entitled' check, extend that one."*
Staff were folded into the predicate; a booster is folded into the column it reads. Zero
new gates, and every perk surface works on day one.

**Mechanism: a rolling FLOOR, not an extension.**

```sql
-- new sibling of grantSupporter, NOT a caller of EXTEND_SQL
update profiles
   set supporter_until = greatest(coalesce(supporter_until, now()), $2::timestamptz),
       updated_at = now()
 where user_id = $1
```

with `$2 = now() + BOOST_GRACE`. Recommend **7 days**, against an hourly sweep.

- ⚠️ **It must not go through `EXTEND_SQL`** (`repo.ts`, `+ ($2 || ' months')::interval`).
  That adds months; an hourly sweep over a year would mint a decade of membership that
  nothing can expire. This is the single most expensive bug available in this document.
- `greatest` means a booster who also pays keeps the later of the two and never has paid
  time truncated — the same reasoning `EXTEND_SQL`'s own comment gives for extending
  rather than overwriting.
- **A lapsed boost expires by ARRIVING.** No revocation job, no un-granting, no second
  human action. That is `0018`'s argument for an instant over a boolean ("storing 'is a
  supporter' would need a nightly job to expire it") and suspension's "it is a DEADLINE,
  not a flag" (`docs/area/accounts.md`), applied a third time.

**Audit.** `supporter_grants` (`0019`) takes a row with `source = 'boost'`. The column is
plain `text` with no check constraint, so only the TypeScript `GrantSource` union
(`repo.ts`) widens. ⚠️ Log only when the floor actually MOVED by more than a day —
otherwise an hourly sweep writes 24 rows per booster per day into an append-only table
that exists to answer "why does this account have a membership?" and would stop answering
it. `months` is `not null integer`; write `0`, which `0019` already defines as a real,
meaningful value.

**Noticing a boost.** `GET /guilds/{id}/members?limit=1000` with a bot token, reading
`premium_since` on each member — **one request per sweep for the whole guild**,
independent of how many accounts are linked. Same shape as the stargazer sweep, same
reason: the server asks about the *resource*, never about the *person*, so no user token
is ever stored.

- ⚠️ **GUESS, VERIFY FIRST:** the bot needs to be in the guild (`LINKS.discord`,
  `src/seasons.ts`) and the members listing needs the GUILD_MEMBERS privileged intent
  enabled on the application. If that is refused, the fallback is the user-token route
  `GET /users/@me/guilds/{id}/member` with the `guilds.members.read` scope — which needs
  a stored refresh token per account and is strictly worse on privacy. Check the intent
  before committing to the design.
- **No gateway connection.** `GUILD_MEMBER_UPDATE` would give boosts in real time, but it
  needs a persistent socket, and the Fly game server auto-stops when idle — the admin
  console's polling was changed to pause on a hidden tab for exactly that reason
  (`docs/area/accounts.md`), and the analytics rollup interval is *started by the first
  beacon, never at boot*, "because Neon bills the wall-clock time the compute is awake"
  (`docs/area/monetization.md`). A socket that never closes is that cost, permanently.

**Where the sweeps run.** Both of them on one hourly interval, under
`pg_try_advisory_lock` so exactly one Fly machine does the work, and **started lazily by
the first request that observes a linked account, never at boot** — the analytics rollup's
pattern, verbatim, for the same billing reason. Worst-case staleness is one hour, which
the 7-day grace covers with a wide margin.

**Not on login.** `/api/user/entitlements` is the obvious hook — it is the one call every
signed-in session already makes — but putting an outbound HTTP request to Discord on it
puts a third party in the latency path of every page load, and fails the session when
Discord is slow. The sweep is enough.

**The read side needs one new field.** `getSupporter` returns `autoRenews: kofi_email is
not null`, so a booster reads as a supporter whose membership does not renew, and the
Donate page would nag them to link a Ko-fi account that will never pay. That is precisely
the problem staff had, solved by giving staff their own panel
(`docs/area/accounts.md`, STAFF ROLES). So `SupporterState` grows
`via: 'kofi' | 'boost' | 'role' | null` and the Donate page gets a third panel: "Your
Discord boost covers this, and it lasts as long as the boost does."

**ENV, all optional — absent means the whole feature is off**, the way `DATABASE_URL`
gates the leaderboard and `MODERATION_API_KEY` gates moderation:
`GITHUB_TOKEN` (a fine-grained read-only PAT — the unauthenticated 60/hr limit would
technically do at one sweep an hour, but not with any headroom), `DISCORD_BOT_TOKEN`,
`DISCORD_GUILD_ID`, `BOOST_GRACE_DAYS`. **All of this is a SERVER change and needs a Fly
deploy** (`CLAUDE.md`'s deploy rules).

### 3.3 Season awards — the three tiers the owner named

**When: at season close, inside `startNewSeason`** (`repo.ts:179`), the one moment the
codebase already calls archiving. Not a cron job, not live.

⚠️ **`startNewSeason` is not transactional today** — it is four sequential `q()` calls
that insert the new `seasons` row, deactivate the others, and count. Folding award
computation in means wrapping the whole thing in `tx()`, which changes an admin path the
owner runs live in production to roll a season. Dry-run it against a copied season first.

**What is computed, per closing `(game, balance_version)`:**

| kind | source | N | note |
|---|---|---|---|
| `ranked` | `eloHistoryLeaderboard({ mode, balanceVersion })`, for `1v1` and `2v2` | top **3** each | NOT `eloLeaderboard` — that one is keyed by ACT (§0) |
| `record_overall` | `recordLeaderboard({ mode: 'solo', drivetrain: 'overall', balanceVersion })` | top **3** | duo board: owner decision (§8) |
| `record_drivetrain` | `recordLeaderboard({ mode: 'solo', drivetrain: dt })` for each of `mecanum`/`tank`/`swerve`/`xdrive` (`0001_init.sql:72`) | top **1** each | "per-chassis" = per drivetrain |

Both record reads go through `recordLeaderboard` and **must not pass `physics`**, so
`boardPhysics` applies its default. An award computed across both eras would name a
holder the board itself does not display — the owner's 2026-09-18 ruling that "a record
board is also one physics" (`docs/area/accounts.md`), and the reason that filter was moved
inside the data layer in the first place. Likewise, `PLACEMENT_GAMES` already filters
unplaced players out of the ranked read; inherit it rather than reimplementing the rule.

`N` per tier lives in one server-side constant table keyed by `kind`, not in a column.

**Ties: take the board's own first N, and add nothing.** Both queries already carry a
near-total order — records `order by b.score desc, b.created_at asc` (the earliest
achiever of an equal score wins, which is also the FTC instinct), ranked
`order by h.rating desc, h.games desc`. Add `user_id` as a final term so a re-run is
deterministic. The bug worth avoiding is an award that disagrees with the board a player
is looking at; inventing a separate tiebreak is how that happens.

**Rank changes: never.** A row written at close is final. There is no "current champion"
chip on the live board either, and that is deliberate: the live board already shows rank
by position, so a chip adds nothing there, and off-board (profile, lobby roster) a
"currently #1" claim is unverifiable by the person reading it and re-queryable by the
person chasing it. Awards are a thing that happened, not a thing that is happening.

**Kept forever: yes, and the schema is what guarantees it.** `season_awards` rows are
stamped with `(game, act, balance_version)` and are never touched by a later roll, so a
season reset cannot take one away — the same promise `docs/area/accounts.md` makes about
pre-ruling 2D record rows ("KEPT… they just stop appearing"), and the owner's standing
rule against season resets points the same way. The title text names its period, so an
old title never claims to be current. A player keeps every title they have earned and
equips one.

**Re-running a close is safe** — `season_awards_slot_idx` makes the insert
`on conflict do nothing`.

---

## 4. Account linking, and whether it should wait for "real auth"

**It should not wait, because "real auth" has landed.** Roadmap item 5 is built
(`docs/area/accounts.md`): password reset, email verification and terms acceptance ship
through `src/lib/authFlows.ts`, the single module wrapping the beta SDK. Linking is three
more methods in that same module, and the beta-drift risk it was created to contain
applies to them identically. **Nothing here is blocked on auth work.**

⚠️ **NEON AUTH OFFERS GOOGLE, GITHUB AND VERCEL — AND NOT DISCORD** (owner, 2026-09-21).
The §3.1 guess is therefore half resolved, and the two asks split:

- **GitHub linking goes through the SDK** exactly as §3.1 describes: `linkSocial`, wrapped
  in `authFlows.ts`. The owner enables the provider in the Neon project; no bespoke OAuth.
- **DISCORD LINKING CANNOT.** It takes the fallback this document already named — a plain
  authorization-code flow in `server/api.ts` — and §2.1's schema is unchanged, which is
  why the fallback was worth naming. Concretely: a Discord application, an authorize
  redirect, a callback that exchanges the code, a signed `state` for CSRF, and the
  **`identify` scope and nothing more**.

  ⚠️ **AND IT STILL STORES NO TOKEN.** The callback wants ONE value — the account's
  Discord snowflake — which goes into `provider_links` while the access and refresh tokens
  are discarded on the spot. Everything after that is the BOT reading the guild
  (§3.2), so nothing here ever needs to act as the user again. That keeps the property the
  whole design is built on: the server asks about the RESOURCE, never about the PERSON.
  If the `GUILD_MEMBERS` intent were ever unavailable (§10.4 — it is a toggle here), that
  property is what is lost — the fallback
  there does need a stored refresh token per account, and at that point the boost perk is
  worth re-costing rather than building.

  Budget: **+0.5–1 day on stage C** for the flow, its state signing and its callback tests.

Stage A in §7 ships with no linking at all, so none of this gates two thirds of the work.

**Interaction with the existing auth.** A DSIM account is a Neon Auth user; GitHub and
Discord are *additional* providers linked to it, never a second way to sign in that
creates a second account. `linkSocial` is the right call for that; `signIn.social` is
not — it would create a new account for anyone who clicked it while signed out, and then
the star reward would land on the wrong profile. If the verified-email gate is ever
switched on (`REQUIRE_VERIFIED_EMAIL`, `emailGateRefusal`), it is also a free brake on
alt-farming (§6).

**Stored, minimally:** the provider's numeric id and the link/unlink timestamps (§2.1).
Not the login, not the email, not an avatar URL, not a token, not the list of guilds a
person is in. Every one of those is either re-fetchable or none of DSIM's business.

**Privacy text.** `src/legalText.ts:351-359` lists the processors (Neon, Fly, Vercel,
Ko-fi/PayPal). GitHub and Discord join it, with one sentence each saying what is sent
(nothing) and what is stored (an id). ⚠️ That is a `LEGAL_UPDATED` question: moving it
re-prompts **every** signed-in account to accept the terms again
(`docs/area/monetization.md`), and the date is already queued to move in the deploy that
turns on `VITE_ANALYTICS`. **Move it once, in that deploy, not twice.** Which means
either this ships with analytics, or its processor lines ship dark and the date moves
later — the second is fine and is what the analytics feature itself did.

**Unlinking.** `unlinkAccount` plus `unlinked_at` on the `provider_links` row. What
survives: a permanent GitHub unlock stays (permanent ledger, §3.1); the boost floor stops
being refreshed and lapses within the grace window (§3.2). Relinking the same provider id
to a *different* DSIM account is refused by the primary key — one id, one account,
forever.

---

## 5. Cosmetics: where a title renders, and what it costs

**Renders in four places**, all of them off the hot path:

- **Leaderboard rows** — as a sibling of the name in `DriverName`
  (`src/ui/Leaderboard.tsx`), never nested inside it: the name carries the hover underline
  (`.lb-name-h`) and the ellipsis (`.fr-name`), so a chip inside it gets underlined or
  truncated with the name. That rule is already written down for `SupporterBadge`
  (`docs/area/accounts.md`) and it binds here identically. The award badge and the title
  are ONE unit visually — a chip with a glyph and a sentence — not two more siblings.
- **Career / public profile** — an "Awards" block, as `docs/rewards-plan.md` §3.3 already
  designs, plus the title picker.
- **Lobby roster card and the results screen** — where a name already has room for a
  second line.
- **NOT the label over the robot.** Not for egress reasons, for legibility ones: that
  label is 12 px on a hardcoded-dark field and it exists to answer "who is that"
  (`docs/area/ui.md`). A title doubles its width and competes with the one thing a driver
  glances at it for.

**The egress arithmetic, since `npm run costprobe` exists for exactly this question.**

- The robot label is fed by `matchStart.drivers` — `MatchDriver { robotId, name }`,
  `src/net/protocol.ts:339`, sent **once per match**. A title there would cost tens of
  bytes once, not 30 times a second. So even the rejected option is not an egress problem.
- The roster (`LobbyPlayer`, `protocol.ts:242`) IS rebroadcast on every patch, which is
  why the title must ride as a **short key**, never a rendered sentence. `LobbyPlayer`
  already carries the precedent both ways: `supporter` and `role` are server-authored
  scalars, and `autoPath` was *removed* from it because "carrying a whole path on the
  roster put an unbounded object on every `roster` broadcast".
- **Nothing here adds a per-tick `RobotState` or `World` field**, which is the change
  `CLAUDE.md` says to run `costprobe` after. Say so in the PR so nobody assumes otherwise;
  egress is ~90% of the bill and the only way to protect that number is to keep the
  30 Hz snapshot boring.

**Server-authored, like every other claim beside a name.** `LobbyPlayer.supporter` and
`.role` are set at join and `sanitizePlayer` is an allowlist, because "a self-declared
'owner' beside a driver's name is an impersonation primitive" (`docs/area/accounts.md`).
A self-declared "Season 3 Champion" is the same primitive. The title key is resolved
server-side from `profiles.title`, validated against `earnedTitles`, and a client patch
carrying one is dropped.

**Moderation surface: zero, by construction.** Award titles are generated from award rows;
granted titles are keys in `COSMETIC_AXES`. No player-authored string exists anywhere in
this design. §1a is the argument for keeping it that way.

---

## 6. Abuse — what to defend, and what to let go

| vector | defence | verdict |
|---|---|---|
| Star-farming with alt GitHub accounts | `provider_links` PK: one GitHub id earns once, ever, on one DSIM account | **free** — the schema already does it |
| Star-farming with alt DSIM accounts | Each needs its own GitHub account (above) and, if `REQUIRE_VERIFIED_EMAIL` is on, its own verified address | **free** |
| Unlink → relink elsewhere | `unlinked_at` instead of a delete; the PK row stays claimed | **free**, and it is the reason §2.1 is a table |
| Star, claim, unstar | Nothing. The unlock is permanent | **not defended, on purpose** (§3.1) |
| Boost for one day, keep the perk | `BOOST_GRACE` (7 d) is the whole exposure, and it self-expires | **not worth defending** — Discord's own minimum billing is a month, so the attacker pays more than the perk is worth |
| Ko-fi + boost double-dip | `greatest`, not `+` — time does not stack | **free** (§3.2) |
| Boost, unlink, relink to a second account | Same PK row → the second account never gets a floor | **free** |
| Collusive rated pairs farming an award | Inherited from ranked: `PLACEMENT_GAMES`, standing charges, dodge tracking | **not defended here** — and honestly: `docs/area/accounts.md` records that rated friend games are farmable by a colluding pair and deliberately unmitigated, as on chess.com. An award raises the prize on that, so if it shows up, the fix is the damping in `server/ranked.ts` the same note already proposes, not a rule in the awards path |
| Sniping the board in the last hour of a season | Nothing. A season's last hour is a real hour of the season | **not defended** |

The pattern worth naming: everything cheap to defend is defended by a UNIQUE constraint or
by an expiry instant, and nothing is defended by a background job. That is not an accident
— every job is a thing that can be down when it matters.

---

## 7. Staging

| stage | ships | depends on | size |
|---|---|---|---|
| **A. Titles + season awards** | `0046`, `0047`; `startNewSeason` wrapped in `tx()` and writing awards; `earnedTitles`/`setTitle`; `AwardBadge`; the leaderboard chip, Career "Awards" and the title picker | **nothing.** No linking, no OAuth, no third party, no new env | 2–2.5 d |
| **B. GitHub link + star reward** | `0045`; `linkSocial`/`unlinkAccount` through `authFlows.ts`; the stargazer sweep; `title:stargazer` in `COSMETIC_AXES` | A (title plumbing) + the owner enabling the provider + `GITHUB_TOKEN` | 1.5 d |
| **C. Discord link + boost perk** | The boost sweep; `ensureSupporterFloor`; `supporter_grants` source `'boost'`; `SupporterState.via` and the third Donate panel | B (link plumbing) + a bot in the guild + the intent | 1.5 d |
| **D. Loyalty ledger** | `docs/rewards-plan.md` §3.1 (`user_days`, milestones) — unchanged by this document | A, for somewhere to put the titles it grants | 1.5 d |

**Stage A is the one that ships without any account linking**, and it is also the one the
owner asked the most specific question about. It should go first regardless of what
happens to B and C.

**Gates per stage**, the usual set: `npm run build` · `npm test` · `npm run dbtest` (every
stage touches a migration) · `npm run uiaudit` + `npm run uiindex` · `npm run contrast`
(the award badge needs a new SATURATED hue in both themes — gold, accent and blue-chip are
taken by supporter/owner/admin, and the contrast audit checks the glyph against its own
fill, not against the card, which is how the lavender pastel passed while being invisible)
· `npm run shiftaudit` for the new chips · `npm run docaudit` after this file is linked
from the roadmap.

**New test coverage worth writing, per stage:**

- A: closing a season twice writes one set of awards; a tie resolves to the board's own
  order; a record award is computed with the `boardPhysics` default and a 2D-era holder is
  absent; `setTitle` refuses an unearned id; `deleteAccount` takes the awards with it.
- B: the sweep is a set-difference and a second run grants nothing new; a relink to a
  second account is refused by the PK.
- C: **the floor does not accumulate** — a thousand sweeps leave `supporter_until` within
  the grace window, not a thousand months out. This is the check that catches the
  `EXTEND_SQL` mistake, and it should be written before the code is.

---

## 8. Decisions for the owner

1. ~~Confirm the counts~~ **DECIDED 2026-09-21.** Ranked **top 3 per mode**; record
   **overall top 3** and **per-drivetrain top 1**; and the **duo** record board gets the
   same pair — **overall top 3, per-drivetrain top 1**. So `season_awards` carries a
   `board` discriminator over {ranked1v1, ranked2v2, record, recordDuo} rather than a
   solo/duo boolean, and the per-drivetrain rows key on drivetrain as well.
   ⚠️ The duo boards are keyed on a PAIR; an award names **both** members, and the
   `badgeCols(alias, prefix)` partner form (`docs/area/accounts.md`) is what already
   renders a second person in one row.
2. ~~Title wording~~ **DECIDED 2026-09-21:** `Champion` / `Finalist` / `Semifinalist` for
   ranks 1–3, in the form `DECODE · Act 2 Season 3 · 1v1 Champion`. A per-drivetrain
   top-1 award is a `Champion` of its drivetrain (`… · Mecanum Champion`), since there
   is no 2nd or 3rd there to make the word relative.
3. ~~Award badge glyph and hue~~ **DECIDED 2026-09-21 (owner delegated).** ONE shape, ONE
   hue, the RANK as a numeral inside it: a **hexagon** carrying 1/2/3, in a new
   **saturated violet** (`--ds-award` + `--ds-award-ink`).
   - SHAPE: ★ owner, ◆ admin and ♥ supporter are taken, and `SupporterBadge` renders
     exactly one of those by precedence. An award is a SIBLING chip, not a fourth rung
     of that ladder — a champion who also pays must show both — so it needs a
     silhouette unmistakable at 12 px against all three. A hexagon is.
   - ⚠️ **GOLD / SILVER / BRONZE IS THE TRAP, NOT THE OBVIOUS ANSWER.** Gold already
     means supporter, and silver and bronze are desaturated BY DEFINITION — which is
     the exact failure `docs/area/accounts.md` records, where a lavender pastel passed
     `contrast` (the audit checks the glyph against its own fill) while being invisible
     on the dark panel. Three medal hues would be three ways to fail it.
   - One hue also means ONE new colour pair in `scripts/contrast.mjs` instead of three,
     and it extends to a fourth or fifth rank for free.
4. ~~Should an unstar revoke?~~ **DECIDED 2026-09-21: YES, it revokes** (§3.1). It stays
   in `profiles.cosmetics` and uses the existing `revokeCosmetic`; the cost is not
   throughput but the FAIL-SAFE rule, and the equipped-title fallback.
5. **Boost grace length.** Recommended 7 days.
6. **Does a booster keep anything after the boost ends?** Recommendation: no — that is the
   difference between a perk and an award.
7. ~~Is a banner ever wanted?~~ **DECIDED 2026-09-21: NO, not for now.** §2.2's
   `season_awards` is already the data a banner would read, so this costs nothing to
   revisit later; it simply does not gate stage A, and no art is commissioned.

## 9. What could not be verified from inside the repo

Stated plainly rather than assumed, because each one can change a stage:

- Whether the Neon Auth project can enable GitHub and Discord providers (§3.1). The SDK
  methods exist; the project configuration is an owner dashboard question.
- ~~Whether the Discord application can get the GUILD_MEMBERS privileged intent.~~
  **RESOLVED 2026-09-21 — it is a self-serve toggle at this size, see §10.4.**
- GitHub's stargazer endpoint pagination and ETag behaviour at DSIM's star count — cheap
  at any plausible number, but the sweep's cost should be measured once rather than
  assumed.
- Whether `PLACEMENT_GAMES` is the right floor for an *award* as opposed to a board
  listing. It is inherited here on the grounds that an award must agree with its board.

---

## 10. Adding more socials — the framework, then Discord and Instagram concretely

Researched 2026-09-21 against the platforms' own documentation. Read §10.1 before
costing any future provider; §10.2 and §10.3 are the two the owner asked for.

### 10.1 LINKING GENERALISES. VERIFYING DOES NOT.

Every social reward is two problems that look like one, and conflating them is how a
"just add Instagram too" lands in a sprint and stays there:

- **LINKING** — prove this DSIM account owns that social account. OAuth, near-identical
  everywhere, and §2.1's `provider_links` already holds it: one row per `(provider,
  provider_user_id)`, primary key preventing the same social account earning twice.
  Adding a provider here is a row in a table and a button.
- **VERIFYING THE ACTION** — did they actually star / boost / follow? This is entirely
  platform-specific, it is where the whole cost lives, and for some platforms **it is not
  possible at all**.

So classify the ACTION before promising the reward. Four tiers, hardest guarantee first:

| tier | the server asks… | needs a user token? | examples |
|---|---|---|---|
| **1 · resource sweep** | the platform, about ITS OWN resource | no | GitHub stargazers; Discord guild members via a bot |
| **2 · session check** | the platform, as the user, at a moment the user is present | a grant, maybe stored | Discord `guilds.members.read` |
| **3 · platform event** | nothing — the platform pushes | no | Instagram `comments` webhook |
| **4 · unverifiable** | — | — | **Instagram follows** |

**The rule: a tier-4 action does not get an automated reward.** Not a scraper, not a
best-effort guess. Offer a manual admin grant (`grantCosmetic` already exists and already
audits) or pick a different action on that platform. Shipping a reward whose condition
cannot be checked is a reward that is simply claimed, and it devalues the ones that are
real — which is the entire argument for §1's server-issued titles.

Tier 1 is the only tier that scales to an arbitrary number of linked accounts at constant
cost, because one request answers for everybody. Prefer it whenever the platform exposes
the resource.

### 10.2 Discord — two routes, and the intent is no longer a blocker

Linking is **bespoke OAuth** either way: Neon Auth offers Google, GitHub and Vercel only
(owner, 2026-09-21), so §4's fallback is the path. `identify` gives the snowflake.

**Route A — bot in the guild (tier 1).** `GET /guilds/{id}/members?limit=1000` with a bot
token, reading `premium_since`. One request per sweep for the entire guild whatever the
number of linked accounts, and no user token is stored anywhere. **Needs the
`GUILD_MEMBERS` privileged intent — which is A TOGGLE, NOT AN APPROVAL** at this app's
size. See §10.4.

**Route B — `guilds.members.read` (tier 2).** The OAuth scope returns the caller's own
member object for one guild, `premium_since` included, and **needs no privileged intent**.
`GET /users/@me/guilds/{guild_id}/member`.

⚠️ **ROUTE B'S REAL COST IS NOT THE SCOPE, IT IS THE SECOND CHECK.** The scope reads as
the USER, so a later re-check needs the user present or a stored refresh token:

- store a refresh token — the thing the rest of this design avoids. It is a much smaller
  secret than a full-account token (it can read one member record in one guild and
  nothing else), but it is still a secret at rest, with rotation and revocation to own;
- or re-check only when the user is present: at link, and behind a "Re-check my boost"
  button. No secret at all, but then the floor (§3.2) has to be long enough that a
  booster is not clicking it weekly — 30 days rather than 7 — and the perk lags reality.

**Recommendation: ask for the intent and build Route A; keep B as the fallback.** A is
tier 1, stores nothing, and its sweep is one request. If the intent is refused, B with a
stored `guilds.members.read` refresh token is the honest second choice — and the boost
perk should be re-costed at that point rather than waved through, because a token store is
a new class of thing for this codebase to own.

Either way the **floor mechanism in §3.2 is unchanged**, and so is the `EXTEND_SQL`
warning: the sweep must set a floor, never add months.

### 10.3 Instagram — a follow CANNOT be verified, and that settles it

Researched against Meta's platform documentation and the 2026 API landscape:

- The **Follower List capability and the Relationships endpoint were deprecated in 2018**.
  There is no supported endpoint that lists an account's followers.
- The **Instagram Basic Display API shut down permanently on 2024-12-04**; its endpoints
  now error.
- What remains — "Instagram API with Instagram Login" / "with Facebook Login for Business"
  — is scoped to a Business/Creator account's OWN media, comments, messaging and insights.
  `followers_count` is a NUMBER; there is no list behind it and no relationship query.
- **There is no `follows` webhook.** Instagram's webhook fields are comment-, message- and
  story-shaped (`comments`, `live_comments`, `mentions`, `messages`, `story_insights`, …).
  Nothing fires on a profile action.

⚠️ **SO "FOLLOW US ON INSTAGRAM FOR A REWARD" IS A TIER-4 ACTION AND MUST NOT SHIP AS AN
AUTOMATED ONE.** The third-party scraper services that appear to solve this (Apify and
similar) are not an option: they breach Instagram's terms, they break whenever the private
endpoints move, they are a recurring cost, and they would have DSIM handling a list of
third parties who never consented to it. That is a large liability for one decal.

**DECIDED 2026-09-21 (owner): NO INSTAGRAM FOLLOW REWARD.** Option 1 below. Nothing is
built, nothing is promised, and §10.1's rule holds its first real case: an action that
cannot be checked does not become a reward. If Instagram is wanted later, option 2 (the
comment webhook) is the only route that does not involve scraping.

**Three honest options, in the order I would take them:**

1. **Do not reward an Instagram follow.** Recommended. Nothing to build, nothing to
   mislead anybody with.
2. **Reward a VERIFIABLE Instagram action instead — a comment, which is tier 3.** The
   `comments` webhook is real and supported. DSIM shows the player a one-time code, they
   comment it on a designated post, the webhook delivers the comment with its author's IG
   id, DSIM matches the code and grants. It verifies ENGAGEMENT rather than a follow, and
   it is honest about that. Cost: an Instagram Business/Creator account linked to a
   Facebook Page, a public webhook endpoint with signature verification, app review for
   comment permissions, and a code ledger with an expiry. Call it 2–3 days plus the review
   wait — **more than the GitHub and Discord rewards combined**, for a weaker claim.
3. **Manual admin grant.** Zero build; the console already grants and audits cosmetics. It
   does not scale past a handful, which for an Instagram follow reward may be the truth.

**If more platforms come up later**, run them down §10.1's table first. As of this
research: X/Twitter's follows endpoint is behind a paid API tier; YouTube's Data API
exposes a channel's subscriber COUNT but a subscriber LIST only to the channel owner via
`subscriptions.list` with their own OAuth (tier 2); Twitch exposes follows through the
Helix API with the broadcaster's token (tier 1-ish). GitHub and Discord are unusually
friendly here, and that is not the norm.


### 10.4 The `GUILD_MEMBERS` intent is a toggle, not an approval — corrected 2026-09-21

Earlier drafts of this document treated the intent as an approval and costed stage C around
the chance of refusal. **That was wrong, and it was wrong because of a rule that changed.**

- `GUILD_MEMBERS` (the Developer Portal calls it **Server Members Intent**) is one of
  Discord's three PRIVILEGED gateway intents. It gates member events and the ability to LIST
  a guild's members — which is exactly what the boost sweep does.
- ⚠️ **THE REVIEW THRESHOLD CHANGED ON 2026-06-10.** It is no longer "100 servers". It is now
  **10,000 unique users who can see the app across every server it is in**. Below that, an
  app turns privileged intents on and off in the Developer Portal with no review at all.
- DSIM's bot would be in ONE guild. Unless that guild has ten thousand members, this is a
  checkbox: Developer Portal → the app → Bot → Privileged Gateway Intents → Server Members
  Intent → Save.

**So stage C's blocker is the bespoke OAuth (\u00a710.2), not an approval, and route A is simply
the right one.** Do not re-cost the perk around a refusal that is not going to happen.

⚠️ **WHAT THE RESEARCH DID TURN UP, AND IT IS A REAL DESIGN CONSTRAINT: WITHOUT THE INTENT,
`GET /guilds/{id}/members` RETURNS AN EMPTY ARRAY WITH NO ERROR.** It fails SILENTLY, which
is the same failure class \u00a73.1's `complete` flag exists for on the GitHub side.

For boosts the consequence is quieter than the star reward's and therefore easier to miss.
The perk is a rolling FLOOR that expires by arriving, so an empty list revokes nothing
immediately — it just stops extending, and every booster's membership lapses at the end of
the grace window with nothing in the log to say why. So the boost sweep MUST carry the same
discipline as `fetchStargazers`:

- an empty member list is treated as SUSPECT, not as "nobody is boosting";
- anything that is not a complete, successful read leaves the floors alone;
- and the check for it gets written before the code, exactly as \u00a77 says for the floor itself.
