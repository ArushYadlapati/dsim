# The presenting sponsor

**DSIM is presented by Offset Robotics** (<https://offsetrobotics.com>) for the BIOBUZZ
season. This file is the whole of it: where the mark appears, how to swap the artwork for
the real files, how to take it down, and how the monthly attribution report is produced.

`src/sponsor.ts` is the single source of truth — the name, the URL, the artwork footprint,
and the term. It is DOM-free so the headless smoke suite can import it. Every placement
renders through `src/ui/Sponsor.tsx`, which is the ONE module that knows the link and fires
the events; nothing else builds a sponsor URL or a sponsor beacon.

`scripts/smoke-biobuzz/sponsor.ts` (the `SPONSOR` lane of `npm run test:bb`) asserts every
obligation below that fails silently. **It reads this file**, so a swap procedure that stops
listing all four artwork files, or a report recipe that stops naming `sponsor_click`, fails
the suite.

## What is app-level and what is not

Two different facts, and both are true on the home menu at once:

- **`Season.presenter`** (`src/seasons.ts`) is *FIRST's* sponsor of the GAME — DECODE
  presented by RTX, BIOBUZZ presented by RTX. Not ours, not for sale, untouched by any of
  this.
- **`SPONSOR`** (`src/sponsor.ts`) is the sponsor of the APP. It is app-wide across every
  season, with a term window rather than a season id.

Do not fold one into the other.

## Placements

| placement id | where | component | artwork |
|---|---|---|---|
| `home` | home menu, under the title | `SponsorPresents` | logo, h=32 |
| `footer` | the shell footer, every page | `SponsorFooterMark` | logo, h=14 |
| `game` | the live field's top-left MENU / RESET line | `SponsorGameChip` | label + logo, h=24 |
| `download` | the download page | `SponsorDownloadMark` | logo, h=28 |
| `splash` | the Electron splash window | `electron/splash.html` | logo, 158×40 |
| `replay` | burned into every exported MP4/WebM | `src/ui/replayOverlay.ts` | logo, h=20 |
| `loading` | the pre-React loading screen / no-JS page | `#seo-home` in `index.html` | text link |

Two more surfaces carry the mark as TEXT rather than artwork, deliberately:

- **The loading screen** is `#seo-home` in `index.html` — React clears `#root` on mount, so
  that static markup is what a visitor looks at while the bundle parses and the Rapier WASM
  decodes. The bundled logos are fingerprinted by Vite and an absolute `/public/...` path
  404s under Electron's `file://`, so the line is a plain link. Its href is the ONE sponsor
  URL in the repo written by hand rather than by `sponsorLink` — the markup ships before any
  bundle runs — so it is UTM-tagged literally, as the `loading` placement, and the smoke lane
  compares the hand-written string against `sponsorLink('loading')` so the two cannot drift.
  It fires no event: there is no analytics script on the page yet.
- **The Discord server** is not a repo change at all. The logo and the "presented by" line
  go on the server itself (icon, banner, or the rules channel) by hand.

One more piece of the deal is a PRODUCT NAME, not a placement: in the BIOBUZZ robot builder
the FLOWER-scoring mechanism reads **"OFFSET™ Box Tube"** (`bbLiftKindLabel`,
`src/games/biobuzz/labels.ts`), on the Builder card, the stat tile, the saved-robot line and the
preset card. It is not a link, carries no UTM tag and fires no event. It follows
`sponsorActive`, so the term and the `VITE_SPONSOR=0` kill switch take it down with everything
else, after which it reads "Box tube".

### The in-gameplay chip is NOT an ad, and must never become one

`src/ads/` renders nothing on touch, nothing under Electron and nothing for a supporter.
A sponsor chip routed through that gate would be invisible on every phone, in the desktop
app, and to the most engaged players on the service — which is exactly what the deal
excludes ("rendered independently of the ad system … same placement, separate code path").

`Sponsor.tsx` therefore imports nothing from `src/ads/`, and `GameView.tsx` renders
`<SponsorGameChip />` outside the `ads &&` branch. Both are smoke-checked, because
re-routing it through the ad gate is a one-line refactor away.

It rides `.game-buttons`, the MENU / RESET line — the one top-corner cluster the game screen
renders in EVERY layout. The status chips opposite are a fine-pointer cluster only, so a mark
living there was absent on touch unless a second floating copy existed to cover it. One
render, every device.

EVERY placement carries the words as well as the logo (the burn-in and the splash included).
"Presented by" is the claim that was bought; a bare logo is decoration.

## The term, and the kill switch

`SPONSOR.term` is `{ from, until }`, both `YYYY-MM-DD`, UTC, **`until` exclusive**. Outside
it every placement renders `null` and the burn-in draws nothing. An unparseable date fails
toward SHOWING the mark — a wrong clock must not quietly void a placement somebody paid for.

`VITE_SPONSOR=0` removes every placement immediately, without a code change. The exact
string `0`; anything else (including absent) leaves the sponsorship on, so a typo in the
deploy env cannot silently take it down.

## The artwork, and swapping it

The repo carries Offset's own two cuts, 1735×438 (≈3.96:1) each, as supplied:

1. `src/assets/sponsors/offset-on-light.png` — for a LIGHT surface. Near-black wordmark.
2. `src/assets/sponsors/offset-on-dark.png` — for a DARK surface. Near-white wordmark.
3. `electron/sponsor-on-light.png` — the same light-surface cut, again.
4. `electron/sponsor-on-dark.png` — the same dark-surface cut, again.

⚠️ **The filenames say which SURFACE, not which ink, and two conventions collide here.**
Offset ships `OffsetLogoLight.png` (a BLACK wordmark) and `OffsetLogoDark.png` (a near-white
one) — named by surface — and describes the black one as "the dark logo" — named by ink.
Both readings are reasonable and they are exact opposites, so `on-light` / `on-dark` is the
spelling in this repo, and a new file gets placed **by looking at the pixels**, never by
trusting the label on the download. Getting it backwards puts white ink on a white page.

**Replace all four, every time.** 1 and 2 go through a Vite `import`
(`src/ui/sponsorAssets.ts`) so the fingerprinted URL resolves under Electron's `base: './'`;
3 and 4 are duplicates beside the splash, which is a `file://` page and cannot reach a
fingerprinted name. Swapping one pair and forgetting the other is the obvious way to get
this half-right, so the smoke lane lists all four.

If a replacement is a different size, set `logoW` / `logoH` in `src/sponsor.ts` to its
**real** intrinsic size in the same commit. Every placement reserves its box from that ratio
before the image loads, which is what keeps `npm run shiftaudit` green; the smoke lane reads
the PNG header of all four and fails if any disagrees with `SPONSOR`.

Vector (SVG) or a 2× raster is preferable to a 1× one: the download placement draws at h=28
and the replay burn-in renders into a frame up to 1920px wide. An SVG swap also means
updating the import extensions in `sponsorAssets.ts`, the two `<img src>` values in
`electron/splash.html`, and the PNG-header check in `scripts/smoke-biobuzz/sponsor.ts`.

**Alternative, no repo change:** `VITE_SPONSOR_LOGO_LIGHT` / `VITE_SPONSOR_LOGO_DARK` take
any URL and override the bundled files. Useful to preview the real artwork on a deploy
before committing it; not a substitute for the swap, since the Electron splash reads neither.

### Which cut goes where

`--ds-hud` **inverts**: in light theme a HUD card is WHITE on the dark field. So the
in-game chip uses the ordinary light/dark swap like every other placement — it does not get
a forced dark cut. The ONE surface that always takes the dark cut is the replay burn-in,
whose plate is painted `rgba(18,21,26,0.86)` regardless of theme.

## The monthly attribution report

All of it from **Vercel Web Analytics** (`src/analytics.ts`, `VITE_ANALYTICS=1`, cookieless).
No database migration, no server change, no identifiers in any payload.

### What counts as an impression

**An impression is a VIEW, not a render.** `sponsor_shown` fires once the mark has been at
least **50% on screen for one unbroken second**, with a backgrounded tab counting as off
screen (`useSponsorExposure`, `src/ui/Sponsor.tsx`). That is the MRC display standard, and it
is the definition Offset's own ad vendor will quote back at us.

The alternative — counting mounts — was what this did first, and it is wrong in the direction
that matters. The footer mark is in the DOM of *every* shell page whether or not the visitor
ever scrolls to it, so mount-counting inflates precisely the denominator the click-through
rate is divided by. The one figure we would be overstating is the one a renewal is argued
over, so the deliberate choice here is to under-count honestly.

The one browser that cannot do this (no `IntersectionObserver`) falls back to counting the
mount. Under-reporting a placement somebody paid for is the worse failure of the two.

### The lines

| line | where it comes from |
|---|---|
| **Impressions** | Events → `sponsor_shown`. Break down by `placement` for per-surface numbers (`home` / `footer` / `game` / `download` / `replay`). This is the denominator: a click count with no scale attached to it is not a number anyone can renew on. |
| **Clicks** | Events → `sponsor_click`, same `placement` breakdown. |
| **Click-through rate** | Clicks ÷ impressions, per placement. Only meaningful because the impression is viewability-gated — divide by mounts and every rate is understated. |
| **Time on screen** | Events → `sponsor_dwell`, property `dwell` — a bucket (`<5s`, `5-15s`, `15-60s`, `1-5m`, `5m+`), broken down by `placement`. Report it as a DISTRIBUTION, never a total: one flush per mount, so the shape is the finding. This is where the in-game chip earns its keep — it is the longest-exposure placement in the app and a plain impression count cannot show that. |
| **Videos carrying the mark** | Events → `sponsor_shown` filtered to `placement=replay`, property `format` for mp4/webm. Counts FILES PRODUCED with the burn-in, not views of them — see the caveat below. |
| **Desktop downloads** | Events → `desktop_download`, property `os`. Stands in for the Electron splash, which cannot be measured at all. |
| **Sessions** | Vercel's own Visitors / Sessions for the site over the month. The mark is on the shell footer, so site sessions and sponsor-exposed sessions are the same set. |
| **New players** | Events → `player_joined`, for the month. |

Offset's own side of the funnel (landing-page sessions attributable to DSIM) is read off the
UTM tags every link carries: `utm_source=dsim`, `utm_medium=<placement>`,
`utm_campaign=biobuzz-2026`. That is the only thing in the query string — no ids, ever.

### ⚠️ The deploy has to have it switched on

`VITE_ANALYTICS=1` must be set in the Vercel project's environment, and Web Analytics enabled
for the project. If it is not, every event above silently reports **zero** — the app is
working, the placements are rendering, and the report is empty. Custom events are also a
**paid-plan** feature of Vercel Web Analytics; on the free tier the page-view lines (Sessions)
still work and every `sponsor_*` line reads zero. Check that a `sponsor_shown` row exists in
the dashboard before the first report month closes, not after.

### What the report cannot say, and must not pretend to

- **`player_joined` over-counts once, and the report must footnote it.** It fires when the
  username gate is satisfied, which is the last step of signing up — and that gate also
  catches LEGACY accounts that predate usernames, so each of those bills as a join the first
  time its owner comes back. A one-off tail, not a recurring bias. A second signal that
  avoided it would need a server change to carry, which is more machinery than a footnote is
  worth.
- **`placement=replay` is files, not views.** The burn-in is counted when an export finishes
  and lands on the user's disk. A clip posted to Discord or YouTube is then watched by people
  who never opened DSIM — real reach, and the only placement with any beyond our own traffic —
  but we cannot see it. Report the file count as a floor and say so.
- **The Electron splash is unmeasurable by construction.** The desktop build does not beacon a
  host it does not run on, which is the rule `src/analytics.ts` is gated by. `desktop_download`
  is its proxy: one download is at least one splash, and repeat launches are invisible.
- **The loading screen fires nothing.** Its markup ships before the analytics script exists.
  Its clicks are visible only to Offset, via the `utm_medium=loading` tag.
- **Sessions are not people.** Vercel Analytics is cookieless, so they are not deduplicated
  across devices.
- **A click is a click-through, not a visit.** Offset's own analytics is the authority on what
  arrived.
