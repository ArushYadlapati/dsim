<!-- governs: server/db/**, server/ranked.ts, server/matchmaking.ts, server/persist.ts, server/standing.ts, src/lib/**, src/standing.ts, src/dodge.ts, src/report.ts, src/playtime.ts, src/ui/Leaderboard.tsx, src/ui/Admin.tsx -->
# Accounts, ranked, leaderboards, records, staff roles

Glicko-2, per-game boards and periods, the badge rules, challenges and the party token, and the background ranked queue.

*Split out of `CLAUDE.md` on 2026-09-16, **verbatim** — CLAUDE.md is loaded into every
session and this is not needed by most of them. The `governs:` line above is read by
`scripts/docaudit.mjs` and by the editor hook, so keep it accurate when paths move.*

---

## Accounts / ranked / leaderboards / records

Neon Postgres via `server/db/` (`repo.ts` + `migrations/`), written at match end OFF the hot
path. **Ranked is Glicko-2** (`server/ranked.ts`: rating + RD + volatility, `SCALE 173.7178`,
`CENTER 1500`, provisional RD shown with "?"), decided AFTER the score SETTLES
(the match finalizes only once the field has come to REST — `src/sim/settle.ts`, each game's
`GameSimModule.settled`, a 0.5 s hold and a 10 s cap — and the results screen reveals only on
that finalized score); an opponent who
LEAVES mid-match is retained (`departed`) so the match still rates. **SOLO RECORD RUNS**
(score-attack): results show NET score (earned − own penalties), no opponent/winner, and
PB / WR / global rank per **mode × drivetrain × season**. Boards, records, and Act→Season
periods are **keyed per game**, so DECODE and CR never share a leaderboard.
**ADMIN MENU** (`src/ui/Admin.tsx`, `/admin`) gated on the signed-in UUID (`ADMIN_USER_IDS`;
the server enforces every action independently). **VERSION GATE**: a new build is detected
(`__BUILD_ID__` → `/version.json` poll) and forces a refresh when a player STARTS a run
(never mid-run) — no "play anyway", everyone must be on the same version for multiplayer.

**STAFF ROLES — owner + admin badges, and perks, DONE.** `profiles.role`
(`0020_staff_roles.sql`) is null | 'owner' | 'admin'. It is a **PROJECTION** of
`ADMIN_USER_IDS` / `OWNER_USER_ID` (`OWNER_USER_ID` defaults to the FIRST id in
`ADMIN_USER_IDS`), reconciled by `syncStaffRoles` once per boot after `migrate()` — the
env stays the source of truth; the column exists so the badge can be JOINED by the
leaderboard/roster queries instead of post-processed row by row (or the admin list
leaked to clients). **The sweep is SYMMETRIC** — an id removed from the env loses the
badge and the perks. **THE PERK IS ONE PREDICATE**: `SUPPORTER_COL` in repo.ts is read
by the ad gate, the cosmetic chassis colours, the saved-start cap, `/api/user/
entitlements` AND the badge, so `role in ('owner','admin')` is folded into that single
expression — never add a second "is staff entitled" check, extend that one. TWO places
deliberately keep the PAID predicate instead, because the entitled one would mislead
there: `searchProfiles` (the admin console's grant/revoke row — a colleague must not
read as a supporter with no expiry when you are deciding whether to comp months) and
the Donate page (staff get their own panel; the supporter one would say "through -"
and nag them to link a Ko-fi account that will never pay). `getSupporter` returns
`supporter: true` with `supporterUntil: null` for staff — that shape is intentional.
`LobbyPlayer.role` is **server-authored** exactly like `supporter` (a self-declared
"owner" beside a driver's name is an impersonation primitive). UI: ONE
`SupporterBadge` renders owner ★ > admin ◆ > supporter ♥ — exactly one, since staff are
also `supporter: true`. **Badge colours must be SATURATED IN BOTH THEMES**: the audit
checks the glyph against its own fill, NOT the badge against the card behind it, so the
lavender pastel (#34305c in dark) passed contrast while being invisible on the dark
panel. Distinguish by SHAPE as well as hue.
**THE BADGE GOES ON EVERY NAME**, and the failure mode is SILENT — a query that just
doesn't project the two columns still compiles and still renders, only bare, which is how
the ranked board sat badge-less next to a record board that was fine. So: `badgeCols(alias
[, prefix])` in repo.ts writes the pair once (the `prefix` form names a SECOND person in
the same row — a duo partner — as `partnerRole`/`partnerSupporter`, and `coalesce(…,false)`
is load-bearing on the LEFT JOIN a solo run takes), and client-side every row type
`extends BadgeFields` (`src/net/api.ts`) instead of re-declaring the fields. Surfaces
covered: both leaderboards (records incl. the duo partner + ranked, live AND archived),
career/profile (the `CareerPanel` name chip — the ONLY place My Stats prints who you are),
match history (every participant + record-run partners), friends/requests/challenges (both
directions), and username search. The friends poll used to skip the columns deliberately;
it no longer does — same already-joined row, and a badge that shows on the leaderboard but
not beside the same person in your friends list reads as a bug.
**A BADGE IS DECORATION BESIDE A NAME, NEVER PART OF ONE**: render it as a SIBLING of the
name element, because the name carries the hover underline (`.lb-name-h`, `.mh-player.link`)
and the ellipsis (`.fr-name`) — nested inside, it gets underlined with the name or
truncated with it. `.fr-nameline` exists for the stacked name-over-subline rows.
Tests: covered in `npm run dbtest` (which prints its own count — an exact number written
into this file goes stale the first time anyone adds a check, as the three that said 36 and
~61 had).

**BACKGROUND RANKED QUEUE, LIVE (no flag).** The queue used to die when you left the
matchmaking screen — that screen owned the socket (`useEffect(() => teardown, [])`),
so queueing locked you out of the rest of the app, which is what stopped people
queueing at all. Now `Matchmaking` PARKS the live `LobbyClient` in `queueKeeper.ts`
(a module singleton — it must outlive the tree that made it) on unmount mid-search,
and ADOPTS it back on remount. **Nothing about how the socket is opened, queued or
handed to a match changed — only how long it lives**; that was the design constraint,
because this path costs real ELO when it breaks. `LobbyClient.on()` REPLACES, so both
hand-overs are plain re-registration. Two cases still tear down for real rather than
park: a match that already STARTED (the session owns the transport) and an in-flight
reconnect to the host region (`assigning`). `QueueBar` shows bucket/elapsed/cancel
while parked; match-found takes the screen back WITHOUT asking (the server forfeits
the slot after `RANKED_JOIN_GRACE_MS`, so a dialog is just a slower way to lose) and
DISCARDS any run in progress. An assignment arriving while parked is remembered on
the parked state — its event has already fired and won't fire again for the adopting
screen. **`updateQueue` must return a NEW object**: it mutated in place at first, so
`useSyncExternalStore` re-read an identical snapshot, skipped the render, and the
takeover silently never fired (the bar still looked right — it repaints on its own
1s timer). A smoke check asserts snapshot IDENTITY changes. `exposeForTesting` is
`import.meta.env.DEV`-only; a shipped bundle must never carry a handle that can
cancel a stranger's queue. **NOT yet validated end-to-end** — that needs two
signed-in accounts completing a rated match.

**PLAY A FRIEND — challenges (chess.com's model), DONE.** A challenge (`room_invites` +
migration `0019`) carries a **`format`**: `casual1v1`/`casual2v2` (a `versus` room),
`duorecord` (a `record`/`duo` room), or the two RATED ones. Rating is only ever applied to a
matchmaker-STAGED room (`Room.ranked` ← `pending_matches`), so a code-joined room can NEVER
rate — the rated formats therefore resolve through the MATCHMAKER, not through a room code.
The challenge's `room` column doubles as a **party token** both sides send on `queue`
(`party`/`partyOnly`/`partyFormat`; `RATED_FORMATS` in protocol.ts maps format → mode +
partyOnly). The matchmaker pairs on **UNITS** (`groupUnits`), never individual entries:
`rated1v1` is a CLOSED party (the token IS the match — no strangers, and the search radius is
skipped since they chose each other; the channel+build bucket still applies), `ranked2v2` is a
PREMADE that queues into the OPEN pool and is kept on one alliance by `allianceOrder`. That
same ordering needs NO 1v1 exception: there the party is the two opponents and half=1 splits
them correctly. **`partySize` (2) is load-bearing** — the members enqueue seconds apart, and
without it the first arrival reads as a complete unit and is swallowed by an open group.
**The token is VERIFIED, never trusted** (`challengeParty` → `verifyParty`): it resolves
against the real challenge row and only answers for an account named on it, so two clients
can't agree on a string and stage themselves a rated match, and a guessed token can't join a
pair. A token that fails is REFUSED, never downgraded to an open queue. Rated formats are
gated on **`SERVER_CAPS`** (`/api/presence` `caps`, read via `serverCaps()`) — the first
server→client capability, and NOT optional: an older server IGNORES the party fields rather
than rejecting them, silently matching two friends against strangers. Lifecycle is
Accept/**Decline** (decline MARKS `declined` so the sender is told once, then their client
cancels the row; dismiss stays a silent clear), the sender SEES their outgoing challenge
(`listFriends`'s `snt` CTE → `sent`) and can cancel it, and one live challenge per direction
(`inviteToRoom` replaces — stacked rated rows would let someone accept an abandoned token).
`src/ui/challenge.ts` `challengeOf` is the ONE place deciding lobby-vs-queue. Tests:
**`npm run test:mm`** (`scripts/mmsmoke.ts`, 186 checks, injected clock + `stage`, no DB) —
party pairing fails SILENTLY, so it is covered there rather than by a live two-account run.
NOTE `enqueue` matches synchronously but STAGES asynchronously; assertions must await a
microtask flush. Rated friend games are farmable by a colluding pair and deliberately
unmitigated (as chess.com); damp repeat-opponent deltas in `ranked.ts` if it shows up.


---

