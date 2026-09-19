-- 0042 — FIRST-PARTY, COOKIELESS SITE ANALYTICS (the admin console's Analytics tab).
--
-- DSIM measured itself through a third party's dashboard, which answered "how many people
-- reached the Support page" and could not answer a single product question: how many DECODE
-- matches ran yesterday, what the ranked distribution looks like, whether anybody who signs up
-- comes back on day 7. Those numbers are all sitting in tables this database already has. What
-- was missing was the traffic half — pages, referrers, countries, devices — and somewhere to
-- put the two side by side.
--
-- ⚠️ THE PRIVACY DESIGN IS THE DESIGN. Everything below is shaped by one rule, which
-- `src/legalText.ts` states to every visitor: **no cookie, no client-side identifier, no IP
-- address and no user agent is ever stored**, and a visitor cannot be followed from one day to
-- the next. Concretely:
--
--   · A pageview carries a VISITOR HASH, not an identity. It is
--     `sha256(daily_salt || ip || user-agent || site)` truncated to 16 hex characters. The IP
--     and the user agent are used to compute it and then dropped on the floor — they are never
--     written anywhere, not to a row and not to a log.
--   · THE SALT ROTATES DAILY AND THE OLD ONE IS DESTROYED (`analytics_salt`, swept to two days
--     by the same job that prunes everything else). Once yesterday's salt is gone, yesterday's
--     hashes cannot be recomputed from an IP even by us, so the same person is a different
--     visitor every day by construction rather than by policy. The cost is stated on the
--     dashboard rather than hidden: a visitor count over a range is a SUM OF DAILY UNIQUES.
--   · NO `user_id` COLUMN EXISTS on any table here, and that is a schema-level guarantee
--     rather than a discipline. Product metrics about accounts come from the account tables
--     (`profiles`, `matches`, `records`, …) in aggregate; they are never joined to traffic,
--     because there is nothing to join them ON.
--
-- ⚠️ THE ENDPOINT IS PUBLIC, so storage has to be BOUNDED BY CONSTRUCTION and not by hoping.
-- Three tiers, pruned by `server/analytics.ts`'s maintenance job under an advisory lock so
-- exactly one Fly machine ever does it:
--
--   raw (`analytics_pageviews`, `analytics_events`)  — 30 days. Exact, and the only tier that
--       can answer a CROSS-FILTERED question ("Germany, on mobile, on /decode/records"),
--       because a cube over eleven dimensions is not a table anyone should write.
--   hourly (`analytics_hourly`)                       — 35 days. The 24h/7d charts.
--   daily (`analytics_daily`)                         — kept. The long history.
--
-- Purely ADDITIVE — every statement is `if not exists`, no existing table is touched, and an
-- older server simply never selects any of it. Safe to apply to a live database at boot.

-- ---------------------------------------------------------------------- salt ----
-- One row per UTC day. Shared across machines (whoever gets there first inserts; the rest
-- read that row), so two regions compute the same hash for the same visitor.
--
-- `day` is the primary key and the retention key at once. The maintenance job deletes
-- anything older than two days — two rather than one so a machine mid-request at the rollover
-- still finds yesterday's, and no more than two so the window in which a hash is reversible is
-- measured in hours.
create table if not exists analytics_salt (
  day        date        primary key,
  salt       text        not null,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------- pageviews ----
-- The raw tier. NARROW on purpose: every column is either an enum with a handful of values or
-- a short, already-scrubbed string. Nothing here is free text from a client.
--
-- What each column is NOT:
--   `visitor`  — not a user id, not stable past midnight UTC, not derivable back to an IP once
--                the day's salt is gone.
--   `path`     — the route with its query string removed and every id-like segment replaced by
--                a placeholder (`/decode/replay/:id`), done on the CLIENT before it is sent, so
--                a replay id or a room code never leaves the browser in the first place.
--   `ref_host` — the referrer's HOST only. A full referrer URL is somebody else's page, with
--                somebody else's query string on it.
--   `country`  — two letters, from a platform header when the edge provides one, else from the
--                browser's coarse IANA timezone mapped server-side. The timezone string itself
--                is used and discarded; no third-party geo-IP service is ever called.
--   `screen`   — a BUCKET (`sm`/`md`/`lg`/`xl`), never a pixel size. Exact viewport dimensions
--                are one of the strongest fingerprinting signals there is, and "is the layout
--                being used on a phone" is the only question anyone asks of it.
create table if not exists analytics_pageviews (
  id           bigserial   primary key,
  at           timestamptz not null default now(),
  visitor      text        not null,
  path         text        not null,
  -- 'decode' | 'chain' | 'biobuzz' | '' when the route carries no game prefix
  game         text        not null default '',
  ref_host     text        not null default '',
  utm_source   text        not null default '',
  utm_medium   text        not null default '',
  utm_campaign text        not null default '',
  country      text        not null default '',
  -- desktop | mobile | tablet | bot-is-never-stored
  device       text        not null default '',
  os           text        not null default '',
  browser      text        not null default '',
  screen       text        not null default '',
  -- primary language subtag only ('en', 'de'), from Accept-Language. Never the full list.
  lang         text        not null default '',
  -- web | electron
  surface      text        not null default 'web',
  -- stable | alpha — which client build is talking to us
  channel      text        not null default 'stable',
  build        text        not null default ''
);

-- The rollup and every raw-tier dashboard query are a range on `at`; the retention sweep is a
-- delete on the same column.
create index if not exists analytics_pv_at_idx on analytics_pageviews (at);
-- Sessions are derived, not stored: a visitor's consecutive views with gaps under 30 minutes.
-- The window function that does it reads (visitor, at) in order, which is this index.
create index if not exists analytics_pv_visitor_idx on analytics_pageviews (visitor, at);

-- -------------------------------------------------------------------- events ----
-- The named events `src/analytics.ts` already fires (support_view, sponsor_click, …), landing
-- here as well as at the host's own dashboard so the funnel sits beside the traffic it came
-- from.
--
-- `props` is jsonb and is BOUNDED AT THE BOUNDARY, not by the column type: at most four keys,
-- each a short lowercase name, each value coerced to a string of at most 32 characters. The
-- rule that has always governed these payloads — counts and enums, never an identifier — is
-- enforced by `server/analytics.ts` rather than trusted.
create table if not exists analytics_events (
  id      bigserial   primary key,
  at      timestamptz not null default now(),
  visitor text        not null,
  name    text        not null,
  game    text        not null default '',
  path    text        not null default '',
  props   jsonb       not null default '{}'::jsonb
);
create index if not exists analytics_ev_at_idx on analytics_events (at);

-- ------------------------------------------------------------------ rollups ----
-- ONE SHAPE, TWO GRAINS. `dim`/`val` is a long table rather than a column per dimension,
-- because the dashboard asks the same four questions of eleven different breakdowns and a
-- wide table would mean eleven near-identical queries that drift.
--
--   dim = 'total'  val = '*'    the headline tiles
--   dim = 'path'   val = '/decode/records'
--   dim = 'country' val = 'DE'   … and so on for ref/utm_*/device/os/browser/screen/lang/
--                                surface/channel/build/event
--
-- `game` is part of the key, and the rollup writes a `'*'` row ALONGSIDE the per-game rows
-- rather than expecting a reader to sum them. Views and sessions would sum correctly;
-- VISITORS WOULD NOT — one person who played DECODE and Chain Reaction on the same day is one
-- visitor, not two — and a table you must not sum in one column and must sum in another is a
-- table somebody sums wrong. Same reasoning as the `'*'` day-total row.
--
-- `bounces` and `seconds` are SESSION facts, so they are filled only for dimensions a session
-- has exactly one of (country, device, browser, …) plus the session's ENTRY path under
-- dim = 'entry'. For dim = 'path' they stay zero: a session visits many pages, and splitting
-- its duration across them would invent a number.
create table if not exists analytics_hourly (
  hour     timestamptz not null,
  game     text        not null,
  dim      text        not null,
  val      text        not null,
  views    integer     not null default 0,
  visitors integer     not null default 0,
  sessions integer     not null default 0,
  bounces  integer     not null default 0,
  seconds  bigint      not null default 0,
  primary key (hour, game, dim, val)
);

create table if not exists analytics_daily (
  day      date    not null,
  game     text    not null,
  dim      text    not null,
  val      text    not null,
  views    integer not null default 0,
  visitors integer not null default 0,
  sessions integer not null default 0,
  bounces  integer not null default 0,
  seconds  bigint  not null default 0,
  primary key (day, game, dim, val)
);

-- -------------------------------------------------------------- concurrency ----
-- HOW MANY PEOPLE WERE ON THE SERVICE, over time and by region — the one operational number
-- that exists nowhere else. `presence` (0015) holds the live snapshot and is OVERWRITTEN every
-- five seconds by design, so it can answer "now" and nothing else; this is a five-minute
-- sample of it, kept.
--
-- Sampled only when there is something to say (see the "IDLE MEANS SILENT" rule in
-- `server/index.ts`): an empty service writes no rows, so the gap in the chart is the answer.
create table if not exists analytics_concurrency (
  at     timestamptz not null,
  region text        not null default '',
  online integer     not null default 0,
  authed integer     not null default 0,
  rooms  integer     not null default 0,
  q1v1   integer     not null default 0,
  q2v2   integer     not null default 0,
  primary key (at, region)
);

-- ------------------------------------------------- the two schema invariants ----
-- `npm run dbtest` asserts both against the live schema after every migration:
--
--  · EVERY FOREIGN KEY HAS AN INDEX LEADING WITH ITS OWN COLUMNS — no table here declares a
--    foreign key at all. That is not an oversight: a `user_id` on a pageview row is exactly
--    the column this whole design exists not to have, and a foreign key is how it would get
--    added by someone with a good reason.
--  · NO INDEX IS A DEAD PREFIX OF ANOTHER — `analytics_pv_at_idx` is `(at)` and
--    `analytics_pv_visitor_idx` is `(visitor, at)`. Different leading columns, so neither
--    covers the other: the first serves the range scan and the retention delete, the second
--    serves the per-visitor ordering the session derivation needs. The rollup tables carry
--    nothing but their primary keys.

comment on table analytics_pageviews is
  'Cookieless pageviews. `visitor` is sha256(daily rotating salt || ip || user-agent || site) truncated to 16 hex; the salt is destroyed after two days (analytics_salt), so a visitor cannot be linked across days and a hash cannot be reversed to an IP. No IP, no user agent and no account id is stored on any row of this table. Raw rows are deleted after 30 days; analytics_hourly and analytics_daily keep the aggregates.';
comment on table analytics_salt is
  'One random salt per UTC day, shared by every machine so they agree on a visitor hash. Deleted at two days old by the maintenance job — that deletion is what makes yesterday''s hashes permanently unlinkable, so nothing may retain a copy of it.';
