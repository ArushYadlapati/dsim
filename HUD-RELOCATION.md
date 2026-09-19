# Top-right HUD (`.robot-status`) — elements left to place

The icon/pip clusters (DECODE's `.dec-hud`, Chain Reaction's `.cr-hud`, BIOBUZZ's
`.bb-hud`) are done and stay as-is. Everything below is the plain-text/chip stuff still
sitting in the same corner (`src/ui/GameView.tsx` ~L722-816) that hasn't been redesigned
or relocated yet. Write a replacement/destination next to each line; delete rows you want
left where they are.

## Universal (any game, online or offline)

- [x] **REVERSED** chip — shown when "flip front" is toggled (shooter/back-end leads).
  Replacement/destination: Make a new HUD underneath the existing one that appears when certain things are toggled, such as reversed. it will have a double area circle icon to show that it's reversed. the hud should expand vertically downward.
  DONE — new `.sub-hud` card below `.robot-status`, `.reversed-icon` (two overlapping rings).

- [x] **TRACTION** / **MECANUM** chip — which wheel set is down, butterfly drivetrain
  only (shown only for a robot built with `drivetrain: 'butterfly'`).
  Replacement/destination: Add a butterfly icon and have it appear in the new hud when toggled
  DONE — `.butterfly-icon` in `.sub-hud`, recolours `.tank`/`.mecanum`.

- [x] **CARD** chip (`■ YELLOW CARD` / `■ RED CARD`) — currently only ever fires for
  DECODE (G408 is the only rule that calls `awardCard`), but the JSX itself isn't gated
  to a game, so it'd fire for any game a card rule is added to later.
  Replacement/destination: have it appear in the new hud
  DONE — `.card-icon` in `.sub-hud`, `.yellow`/`.red`.

- [x] **🌐 `<server>`** chip — net/region indicator, online matches only.
  Replacement/destination: in the bottom right corner, add a new box with design based on design.md. the server will appear there.
  DONE — new `.net-corner` cluster, bottom-right, mirroring `.status-wrap`'s own
  corner-anchor idiom. The server chip is the corner box itself (unchanged `.chip on`).

- [x] **👁 `<count>`** chip — spectator count, shown only when > 0, online only.
  Replacement/destination: "spec: #" caps or not caps, left of the new bottom right corner box. appears to the left side of the server.
  DONE — `SPEC <n>` (text, not the eye emoji), leftmost in `.net-corner-row`.

- [x] **`<NetQuality>`** — the SMOOTH/OK/CHOPPY connection dot (+ its expandable ping
  graph), online only.
  Replacement/destination: in the bottom right corner box. appears as it's own box to the right of the left of right box. when pressed, it expands. between the spectator count and bottom right box.
  DONE — moved into `.net-corner-row` between SPEC and the server chip, unchanged
  otherwise. Also fixed a real bug found while moving it: `.chip.net-quality.clickable`
  never had `pointer-events: auto`, and it sits under `.hud` (`pointer-events: none`) —
  the click-to-expand never actually reached the chip. Added the missing declaration.
  The ping graph now renders ABOVE the row (the cluster is anchored by `bottom`, not
  `top`, so it grows upward when opened instead of running off the bottom edge).

- [x] **WAITING · `<name>`** chip — waiting on a peer to (re)join, online only.
  Replacement/destination: put it pinned in the nofications instead
  DONE — pinned line in `.eventlog` (`.eventlog-pinned`, same treatment as the
  per-game pinned notices), above the toast list.

- [x] **⚠ DESYNC** chip — connection desync warning, online only.
  Replacement/destination: flashing box that replaces the netquality box when desynced
  DONE — new `.chip.desync` (red-ink, blinking via the existing `.timer-panel.urgent`
  keyframe), rendered in NetQuality's slot in `.net-corner-row` instead of it.

## DECODE

- [x] **FOULS `n MIN · n MAJ`** chip — this alliance's foul tally so far this match
  (match mode only, only shown once > 0).
  Replacement/destination: pinned in notifications
  DONE — pinned line in `.eventlog`, same as WAITING above.

## Chain Reaction

- [x] **`<MODE>`** chip — the match-mode label (e.g. "MATCH", from `CHAIN_MODE_LABELS`),
  uppercased plain text.
  Replacement/destination: not needed — REMOVED (`GameView.tsx`, the unused
  `CHAIN_MODE_LABELS` import went with it)

- [x] **▲ ASCENDED** / **■ PARKED** chip — endgame ring-stand/lab-area status.
  Replacement/destination: have a new gui box underneath the topright one that says "park" whenever endgame begins. it will be a yellow border for parked, and green for ascended, red at all other times
  DONE, then revised — new `.park-status` box under `.status-wrap` (below `.sub-hud`),
  rendered ONLY once `hud.chain.endgame` is `'ascended'` or `'parked'` (the sim already
  reads `'none'` outside endgame, so no separate box for "endgame started but neither
  yet" and nothing to gate on the clock). Border colour matches the existing on-canvas
  badge drawn over the robot itself (`drawChain.ts`: ascended gold, parked white) rather
  than the original yellow/green/red scheme: `--ds-warn` (gold-adjacent) for ascended,
  `--ds-ink` (the dual-theme read of "white" — near-white on the dark card) for parked.
  Both already have AA pairs against the HUD card in `contrast.mjs`, so no new ones
  were needed.

- [ ] *(no FOULS chip exists for CR today — the DECODE one above is gated to DECODE only,
  so CR's own G05/G06 tally currently has no HUD chip at all. Worth deciding whether it
  needs one here.)*

## BIOBUZZ

Already went through this same icon redesign (`.bb-hud`, storage/nectar dot columns +
the flower icon) — nothing further to pull out of that cluster. The only things that'd
still land on BIOBUZZ from this corner are the **Universal** items above (mainly
REVERSED, TRACTION/MECANUM if built with butterfly, and the online-only net/spectator
chips — CARD and FOULS don't currently fire for this game at all).

---

**All items above are wired.** `npm run build`, `npm run uiaudit`, `npm run contrast`
(225/225) and `npm test` are all green. The one open item is the CR-FOULS note right
above — a scope decision (does CR's G05/G06 tally get a HUD chip at all?), not a
relocation, so it's left for a call rather than guessed at.
