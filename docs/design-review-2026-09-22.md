# DSIM frontend design review · 2026-09-22

Branch `alpha` at 4a1d7ee (preview build). This review changed no code. The report records findings only; **every decision is the owner's.**

**Method.** 22 reviewers ran in parallel, each one read-only:
- 12 screen lanes and 10 cross-cutting lenses.
- They measured against `DESIGN.md`, `docs/ui-standard.md`, `docs/area/ui.md` and the frontend-consistency design guide.
- They had screenshots of 12 routes (desktop and 375px, light and dark), the `audit.cjs` DOM audit, and the `uiaudit` and `contrast` ratchets.

The reviewers produced **471 findings**. The 190 P0/P1 findings were merged into **70 clusters**. Three skeptic agents then re-checked every cluster against the code and tried to disprove it. **No cluster was a false positive.** Most were downgraded, because the skeptics applied a stricter bar: P0 means a user is blocked or something is unreadable or unreachable. The P2/P3 findings (282) are listed unverified and not deduplicated in §5.

Severity key:
- **P0**: fails the accessibility floor, or blocks a user.
- **P1**: a visible inconsistency, a real WCAG or contract miss that has a workaround, or a functional bug.
- **P2**: polish.
- **P3**: nit.

Not captured as screenshots: the in-match HUD, results, replays, admin, profile, the tutorial and dialogs. Findings on those come from reading the code; their evidence lines say so.

---

## 1. Summary

### After verification (70 clusters)
| | P0 | P1 | P2 | contested (whole cluster) |
|---|---|---|---|---|
| clusters | **3** | **42** | **25** | 1 (C40), plus 9 contested sub-points |

### Raw, by lane (before dedupe and verification)
| lane | P0 | P1 | P2 | P3 | | lane | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|---|---|---|---|---|
| 01 home/shell | 0 | 9 | 10 | 3 | | 12 tutorial | 3 | 6 | 9 | 3 |
| 02 play flow | 0 | 10 | 11 | 3 | | 13 tokens | 1 | 5 | 8 | 1 |
| 03 robot builder | 3 | 9 | 10 | 3 | | 14 type/spacing | 0 | 10 | 9 | 3 |
| 04 settings | 1 | 6 | 9 | 5 | | 15 colour/theme | 2 | 8 | 8 | 2 |
| 05 HUD | 4 | 7 | 8 | 2 | | 16 components | 0 | 7 | 9 | 7 |
| 06 post-match | 3 | 9 | 8 | 3 | | 17 a11y | 3 | 7 | 9 | 3 |
| 07 records | 3 | 9 | 9 | 4 | | 18 mobile | 1 | 8 | 8 | 4 |
| 08 profile/account | 3 | 8 | 10 | 4 | | 19 copy | 0 | 6 | 13 | 5 |
| 09 replays | 2 | 11 | 10 | 2 | | 20 AI tells | 0 | 2 | 8 | 4 |
| 10 admin | 0 | 2 | 13 | 5 | | 21 interaction/motion | 1 | 5 | 9 | 3 |
| 11 peripheral | 1 | 9 | 10 | 4 | | 22 cross-game | 0 | 5 | 8 | 3 |
| | | | | | | **total 471** | **36** | **154** | **206** | **75** |

### Top 10 (orchestrator's pick: impact against effort; not binding)
1. **C10 · P0 · S**: a leaderboard replay can only be opened by clicking a `<tr>`, so keyboard users cannot open it. The Watch button pattern already exists in MatchHistory.
2. **C20 · P0 · S**: `index.html:7` sets `user-scalable=no`, which blocks pinch-zoom in every menu. `GameView.tsx:576` already guards pinch during a match.
3. **C07 · P0 · M–L**: six shell dialogs, two in-match overlays and both blocking gates have no dialog role, don't move focus, don't trap Tab, don't restore focus and don't close on Escape.
4. **C01 · P1 · S (five lanes)**: every `.ds-range` slider shows the native blue thumb in an 8px box. `shell.css:4527` shares the input's selector with the track rule; a one-line fix.
5. **C59 · P1 · S**: this is a functional bug. Admin moderation of records can only reach DECODE boards, because `api.ts:1550` never sends `game`.
6. **C03 · P1 · S (three lanes)**: `.chip.desync` strobes under reduced motion. This is the exact trap CLAUDE.md describes; add `animation-iteration-count:1` to the global `*` rule.
7. **C23 · P1 · S (three lanes)**: five `font: … inherit` shorthands are invalid, the same silent-drop class as the `--ds-font` gotcha. uiaudit could get a rule for it.
8. **C62 · P1 · S**: two global key listeners ignore local handling. Enter in "What's new" closes the dialog even when a link is focused, and Escape in a Select also leaves the Lobby.
9. **C38 · P1 · S–M**: BIOBUZZ's copy of the score bar has lost the END GAME and MATCH OVER states and shows FINAL before the score has settled.
10. **C60 · P1 · S**: the footer's legal links are `<button>`s. `Legal.tsx:14` says `/privacy` must be reachable without JavaScript routing, which is an AdSense prerequisite.

### Accessibility floor
- **Blocking (P0):** C07, C10, C20.
- **WCAG fails with a workaround (P1):**
  - contrast: C02, C04, C05, C06, C21, C32 (the 2.7:1 award hexagon), the light-theme focus ring in C14, C15.
  - semantics: C08, C09, C11, C12, C13, C18, C19, C37.
  - reduced motion and timing: C03, C69.
  - touch: C22 (tutorial buttons).
- `npm run contrast` passes all 269 of its pairs, but it cannot see alpha-mixed colours, opacity stacks, or the 3D scrim and prediction panel surfaces. **C02, C04, C05, C06 and C21 all sit in that blind spot.**

### Items that correct the repo's own docs
- `docs/ui-standard.md:39` says the app suppresses the browser's default focus ring. It does not: the only `outline:none` is `shell.css:3769`.
- ui-standard §3 allows font weights 500, 750 and 900, but §9 says a grep for them must return nothing.
- `DESIGN.md` still calls Space Grotesk monospace, says "175 pairs" (contrast now checks 269), and describes a 14/18/22 spacing rhythm that ui-standard bans (see C40).
- The comment at `predict.css:13-18` says `--ds-hud` does not invert. It does, which is the cause of C05.
- `.fr-error` is declared twice (`shell.css:1070` and `1080`). This is the `.ds-dl` class of bug from CLAUDE.md, found by the skeptic for C66.
- `docs/ui-components.md` is stale after 4a1d7ee. That commit also removed `.lb-standing`'s radius; see C44.

---

## 2. Decision table: verified P0/P1 clusters

Verdict is the skeptic's: **conf** = confirmed, **over** = overstated and downgraded, **cont** = contested. Sev shows *final (was)*. The lane IDs point to the full text in the appendix. Effort is S (under an hour), M (up to a day) or L (larger).

| ID | Sev | Verdict | Finding | Lanes | Evidence (skeptic-checked) | Recommendation | Eff | Decision |
|---|---|---|---|---|---|---|---|---|
| C07 | **P0** | conf (split) | Dialogs have no role, focus move, trap, restore or Escape | 17-01 17-08 08-01 06-03 · split: 06-04 16-07 | App.tsx:1895–2004, GameView.tsx:647/784 bare `div.overlay`; TermsGate:125, UsernameGate:99 no role; only Select.tsx handles Tab | One shared dialog primitive: role, aria-modal, labelledby, focus in/trap/restore, useEscape. Treat 06-04 and 16-07 (three dialog looks, legacy tokens) as a separate P1 consistency item | M–L | ☐ accept ☐ reject ☐ defer |
| C10 | **P0** | conf | Leaderboard replay only by clicking a `<tr>` | 07-01 | Leaderboard.tsx:451-455 onClick on `tr`, no tabIndex, role or key handler | Add a Watch button in the row, as MatchHistory does | S | ☐ accept ☐ reject ☐ defer |
| C20 | **P0** | conf (cont.) | Pinch-zoom disabled app-wide | 18-01 | index.html:7 `maximum-scale=1.0, user-scalable=no`; GameView.tsx:576 guards the match already | Drop the viewport clamp and keep the in-match guard. *Contested: the clamp was intentional for play* | S | ☐ accept ☐ reject ☐ defer |
| C01 | P1 (P0) | over | `.ds-range`: native blue thumb, 8px box, dead mobile puck | 03-01 04-01 15-03 16-01 18-03 | shell.css:4527 input shares the track selector; no `appearance:none`; p3 shows a blue thumb | Split the input rule from the `::-webkit-slider-runnable-track` rule | S | ☐ accept ☐ reject ☐ defer |
| C02 | P1 (P0) | over | Urgent server notice is white on red, 3.76:1, with a blur shadow | 05-02 15-01 11-05 | styles.css:3066-3088 literal `rgba(239,68,68,.97)`/#fff, `0 6px 24px` | Use `--ds-red-chip` with its ink pair plus a contrast.mjs pair; hard shadow. (Not theming it is correct, as category 2) | S | ☐ accept ☐ reject ☐ defer |
| C03 | P1 (P0) | over | `.chip.desync` strobes under reduced motion | 05-03 17-05 21-01 | styles.css:501 infinite blink; missing from the cap list 1356-1363; shell.css:5658 caps duration only | Add `animation-iteration-count:1` to the global reduced-motion rule | S | ☐ accept ☐ reject ☐ defer |
| C04 | P1 (P0) | over | 3D scrim in light theme: status inks around 2.8–3.5:1 | 05-01 12-01 | styles.css:229-237 scrim redefines only four tokens; warn 3.03, red-ink 2.83, accent 2.85 | Redefine the status inks on `.view-3d`. Note 05-01's `.park-status` and END GAME cites don't apply to BIOBUZZ | S–M | ☐ accept ☐ reject ☐ defer |
| C05 | P1 (P0) | over | Prediction panel: on-field ink on a white HUD card, 1.05–1.8:1 | 12-03 13-01 | predict.css:36/71; reachable in an online BIOBUZZ room with 3D physics, 2D view, light theme | Give the panel its own dark fill, or use themed inks; fix the header comment | S | ☐ accept ☐ reject ☐ defer |
| C06 | P1 (P0) | over (cont.) | Joystick labels 10px at 0.5 opacity (3.31:1); ghosted assist buttons at 0.45 | 05-04 18-08 | styles.css:2748/2762-2772, 2838-2841 | Put the opacity on the base fill, not the label. *Contested: ui.md wants assists "ghosted, never hidden"* | S | ☐ accept ☐ reject ☐ defer |
| C08 | P1 (P0) | over | Selection state not exposed (pick tiles, `ds-seg` filters, report options) | 03-02 07-03 06-02 | Leaderboard.tsx:362; Menu.tsx:936-947; ReportDialog.tsx:62-78 | `aria-pressed` everywhere, or route through OptRow | S–M | ☐ accept ☐ reject ☐ defer |
| C09 | P1 (P0) | over | `div role=button` wrapping a `<button>✕</button>`; Enter on ✕ also fires the card | 02-09 03-03 | Menu.tsx:733-752, MatchSetup.tsx:333-357; stopPropagation on click only | Make the card and the delete sibling buttons. Merge with C16 | S | ☐ accept ☐ reject ☐ defer |
| C11 | P1 (P0) | over | Unlabelled selects; errors not announced or linked | 07-02 08-11 17-04 | MatchHistory.tsx:211-235; AuthPanel.tsx:203/269; 0× `aria-describedby` | aria-label the selects; `role=alert` plus describedby on form errors | S | ☐ accept ☐ reject ☐ defer |
| C12 | P1 (P0) | over | Auth fields have no `autoComplete`; sign-in doesn't take focus | 17-03 | AuthPanel.tsx:231-238 | email, current-password, new-password, username; autoFocus the first field | S | ☐ accept ☐ reject ☐ defer |
| C13 | P1 (P0) | over | Live-region spam: PerfHud (4/s), QueueBar (1/s), server countdown (1/s) | 17-02 11-06 | PerfHud.tsx:117, QueueBar.tsx:34/66, ServerNoticeBanner.tsx:40 | Take the ticking text out of `role=status`; announce only state changes | S | ☐ accept ☐ reject ☐ defer |
| C14 | P1 (P0) | over | Results-stage link focus ring 2.77:1 (light) | 06-01 (08-02 02-08 → P2) | shell.css:6356 accent ring, no `.resx-linkbtn` override | On-field ring on the stage. The other two lanes get the UA default ring; house-ring consistency is P2 | S | ☐ accept ☐ reject ☐ defer |
| C15 | P1 (P0) | over | Username field border 1.69:1 | 08-03 | shell.css:3739 `--ds-line` vs `.ds-input`'s `--ds-line-strong` | Use `--ds-line-strong` | S | ☐ accept ☐ reject ☐ defer |
| C16 | P1 (P0) | over | Replay delete "✕" has no accessible name and no confirm | 09-01 | PracticeReplays.tsx:205, LanReplays.tsx:180 | aria-label plus confirm or undo; fold into C17 policy | S | ☐ accept ☐ reject ☐ defer |
| C17 | P1 | conf | Destructive actions with no confirm | 04-03 08-06 08-09 10-01 19-06 | ControlsSection:704; ProfileFriendActions:67/105; AdminLive:470 "LOCK DOWN NOW". 08-06 does have a `confirm()` (it's about style); 19-06 is copy | Choose one confirm pattern (inline or dialog, `.danger`) and apply it to reset bindings, unfriend/block and lockdown | M | ☐ accept ☐ reject ☐ defer |
| C18 | P1 (P0) | over | Colour-only: yellow and red cards, motif dots, match-history alliance | 09-02 17-06 07-10 | ReplayView.tsx:1486 `■ n` for both; GameView.tsx:791 empty motif spans | Letters or shapes (Y/R, P/G) plus aria text. The motif is the strongest case | S | ☐ accept ☐ reject ☐ defer |
| C19 | P1 (P0) | over | Heading skips: markdown `#`→h3, `##`→h4; panel titles are spans | 11-01 14-11 (04-06 → type) | markdown.tsx:134-139 | Take a heading base level in markdown.tsx; panel titles become h2 | S | ☐ accept ☐ reject ☐ defer |
| C21 | P1 (P0) | over | Home primary keycap sub-line 4.39:1 (light) | 15-02 | shell.css:1394 accent-ink at 74% mix | Raise the mix to about 80% | S | ☐ accept ☐ reject ☐ defer |
| C22 | P1 (P0) | over (split) | Tutorial buttons about 21px on touch | 12-02 (11-03 18-09 18-02 → P2) | tutorial.css:105-114, coarse block doesn't resize them | Size them in the coarse block. The sponsor mark passes the spacing exception; width-vs-pointer keying is a strategy call | S | ☐ accept ☐ reject ☐ defer |
| C23 | P1 | conf | Five invalid `font: … inherit` shorthands | 02-07 14-01 16-02 | shell.css:5795/5820/5830/5903/5917 | Replace with longhands; add a uiaudit rule | S | ☐ accept ☐ reject ☐ defer |
| C26 | P1 | conf | Blur and glow despite the No-Blur Rule | 01-05 13-04 20-01 | shell.css:466 presence dot; styles.css:3982 `blur(20px)` season reveal; ann-panel; backdrop-filter 1486/2541 | Remove from chrome (reveal, ann-panel, presence dot). Canvas-floating controls are arguably exempt. Offset tokenisation is P2 | M | ☐ accept ☐ reject ☐ defer |
| C30 | P1 | conf | Recommended tile looks selected; 5–10 "selected" treatments | 04-04 15-06 15-07 16-06 21-05 | shell.css:1832 `.ds-tile.primary` equals `.ds-seg.on` | Give "recommended" a non-fill marker (P1); consolidating the selected treatments is P2 | S / M | ☐ accept ☐ reject ☐ defer |
| C31 | P1 | conf (split) | Alliance red/blue: seven or more values; score bar not tokenised; overlay contrast; staff badge on alliance fill | 05-08 15-05 · 09-08 · 06-08 15-09 | styles.css:278-284 gradients; config.ts:2926; replayOverlay.ts:308; styles.css:3521 | Three items: token sprawl, video-overlay contrast, badge placement | M | ☐ accept ☐ reject ☐ defer |
| C32 | P1 | conf (split) | Award hexagon 2.7:1 on white; gold does six jobs | 06-12 · 15-08 06-10 15-10 06-09 | shell.css:161 `--ds-award`, 7293 no stroke; styles.css:2036 stale "only medal token" comment | Stroke the award glyph (P1); gold and award palette hygiene (P2) | S / M | ☐ accept ☐ reject ☐ defer |
| C33 | P1 | conf | Console screens are a second shell; about 11px phone gutter; Friends strip above Back | 02-01 02-02 02-10 18-07 | shell.css:3898 `min(900px,94vw)`; p6-mobile. The 4px figure is partly the Windows scrollbar | Gutter fix (S) now; unifying the shell (M–L) is optional | S / L | ☐ accept ☐ reject ☐ defer |
| C34 | P1 | conf (+C35) | About 355px of chrome before content on phones; rail and subnav clip labels; builder hero fills the screen | 18-04 01-07 04-05 + 03-04 18-05 | p1/p2-mobile; shell.css:4869 | Treat as one mobile first-screen pass: collapse the rail, wrap the subnav, compact the hero | M | ☐ accept ☐ reject ☐ defer |
| C37 | P1 | conf | Half-built ARIA patterns (season tabs, ProfileMenu `menu`, export menu, robot expander) | 01-08 01-09 09-10 07-12 | HomeMenu.tsx:101; ProfileMenu.tsx:82; ReplayView.tsx:1209; Leaderboard.tsx:492 | Finish each pattern or downgrade the roles; `aria-expanded` on the expander | S–M | ☐ accept ☐ reject ☐ defer |
| C38 | P1 | conf | BIOBUZZ score bar fork: no END GAME, FINAL shown early | 05-07 22-01 | biobuzz/HudSlots.tsx:376/457 vs GameView.tsx:964-974 | Reuse the shared bar's timer-state logic | S–M | ☐ accept ☐ reject ☐ defer |
| C39 | P1 | conf | FOULS and WAITING only in the hideable event log; Chain has no foul tally | 05-11 22-02 17-10 | GameView.tsx:948/1208; chain/HudSlots.tsx | Move actionable state out of the log into HUD chrome, one slot per game | M | ☐ accept ☐ reject ☐ defer |
| C40 | P1 | **cont** | DESIGN.md spacing (14/18/22, "no strict grid") vs the ui-standard 4px grid | 13-02 14-04 14-05 | DESIGN.md:137; ui-standard §2; uiaudit off-grid 143 | See §3; **owner call** | S (doc) | ☐ accept ☐ reject ☐ defer |
| C45 | P1 | conf (split) | Disabled `.ds-btn`/`.ds-cta`/`.ds-tile` still react to hover and press | 21-02 21-06 · 16-03 16-05 21-03 21-04 12-04 | shell.css:1578/1583 no `:disabled` guard | Add a `:disabled` guard (P1). Recipe duplication, lift vs sink and "ghost" naming are P2 | S / M | ☐ accept ☐ reject ☐ defer |
| C48 | P1 | conf | Results action row: 3–4 accent primaries; row flips between themes on the fixed-dark stage | 06-06 06-11 | Results.tsx:1009-1029; styles.css:2346 no surface | One primary; give the row a real surface or on-field tokens | S | ☐ accept ☐ reject ☐ defer |
| C53 | P1 | conf (split) | The footer reads as "BIOBUZZ … PRESENTED BY OFFSET"; the season's presenter never shows | 22-04 · 01-01 01-02 22-05 → P2 | AppShell.tsx:184-188; sponsor.ts:8-12; `Season.presenter` unused | Separate the season line from the app sponsor; render `presenter`. Home hierarchy is P2 | S | ☐ accept ☐ reject ☐ defer |
| C55 | P1 | conf (split) | Phone HUD hides the status card and net corner · `title` tooltips never show (pointer-events none) | 05-05 · 05-06 | GameView.tsx:1033/1182; styles.css:184 | Two items: a compact phone status; visible labels instead of titles | M | ☐ accept ☐ reject ☐ defer |
| C59 | P1 | conf | Admin records moderation is DECODE-only | 10-02 | api.ts:1550 no `game`; server/index.ts:1699 falls back to DECODE | Send `game` plus a picker | S | ☐ accept ☐ reject ☐ defer |
| C60 | P1 | conf | Footer legal and download destinations are buttons, not links | 11-02 | AppShell.tsx:191-228; Legal.tsx:14-15; sitemap has no /privacy | `<a href>` with a client-side intercept; add to the sitemap | S | ☐ accept ☐ reject ☐ defer |
| C62 | P1 | conf | Global key listeners ignore local handling | 11-07 17-07 | Announcements.tsx:99-104; useEscape.ts:16 | Guard `defaultPrevented` in useEscape; scope Enter to the dialog, not links | S | ☐ accept ☐ reject ☐ defer |
| C65 | P1 | conf (split) | Score column off-screen on phone · Career shows 1000/fake tiles beside its empty state | 07-05 07-06 · 07-07 07-08 07-09 07-11 → P2 | shell.css:2490/2498 min-width; CareerPanel.tsx:117/124 `?? 1000` | Scroll affordance or a sticky column; hide the tiles when empty. The rest is P2 or taste | S | ☐ accept ☐ reject ☐ defer |
| C67 | P1 | conf | The Graphics section (BIOBUZZ-3D only) shows in every season | 22-03 | Configure.tsx:33 static list; GraphicsSection imports biobuzz only | Gate the section by season (or by a game-module slot) | S | ☐ accept ☐ reject ☐ defer |
| C68 | P1 | conf | `.ds-modal` has no max-height or scroll, so it clips on phones | 18-06 | shell.css:3673-3693; only `.rw-card` caps itself | `max-height: 100dvh - gutter; overflow:auto` (from code only; unmeasured) | S | ☐ accept ☐ reject ☐ defer |
| C69 | P1 | conf | Friend and invite toasts expire at 9s with no pause and no live region | 17-09 | friendsContext.tsx:66/288/333 | Pause on hover and focus; `aria-live=polite` | S | ☐ accept ☐ reject ☐ defer |

### Downgraded to P2 by verification
| ID | Verdict | Finding | Lanes | Skeptic's note | Eff | Decision |
|---|---|---|---|---|---|---|
| C24 | conf | Pill keycaps and CTA vs the 8px shape contract | 01-03 02-05 16-04 | Consistent and deliberate: amend the doc or the code (owner call, §3) | S | ☐ accept ☐ reject ☐ defer |
| C25 | conf | Mono data face on home sub-labels and the footer brand | 01-04 | shell.css:1373, 1507; two strings | S | ☐ accept ☐ reject ☐ defer |
| C27 | conf | ALL-CAPS panel titles vs the "sentence case" rule; two field-label systems | 03-05 03-06 09-12 14-09 | App-wide and deliberate: amend §6 or drop the transform (§3). Split out the h2-tier and rr-input items | M | ☐ accept ☐ reject ☐ defer |
| C28 | conf | Mode-card kickers repeat the title or section | 02-03 19-04 20-02 | Six of eight repeat | S | ☐ accept ☐ reject ☐ defer |
| C29 | conf | Two-tone split headings ("Multi\|player") | 02-06 | Lobby.tsx:733 and others; decorative | S | ☐ accept ☐ reject ☐ defer |
| C36 | over | Env-var names and raw `e.message` in errors | 07-04 19-03 | Env-var copy is unconfigured builds only; the raw exception text is real | S | ☐ accept ☐ reject ☐ defer |
| C41 | conf | Configure panels 40px apart | 14-02 14-03 | shell.css:1904 unscoped `.ds-panel + .ds-panel` inside gap 24; a one-selector fix | S | ☐ accept ☐ reject ☐ defer |
| C42 | over | Type scale vs reality (h1/h2 render 38/24; 14px off-scale; HUD 8–10px) | 14-06 14-07 14-08 05-10 | Off-scale sizes are already ratcheted (45). New: the h1/h2 tokens are fiction. The HUD 8–9px part could stand alone at P1 | M | ☐ accept ☐ reject ☐ defer |
| C43 | conf | Contract docs stale or self-contradictory | 13-03 13-07 | Doc-only; see §1 "Items that correct the repo's own docs" | S | ☐ accept ☐ reject ☐ defer |
| C44 | conf | 4a1d7ee removed `.lb-standing` radius; index stale | 13-05 | The owner's own hand edit: **confirm intent** before reverting | S | ☐ accept ☐ reject ☐ defer |
| C46 | conf | Width shift: the arming keycap, the replay Play button | 04-02 09-05 | Breaks ui-standard §1.4, but transient | S | ☐ accept ☐ reject ☐ defer |
| C47 | over | REMATCH "voted" state has no style or aria-pressed | 05-09 06-07 | The label and tally do change | S | ☐ accept ☐ reject ☐ defer |
| C49 | over | `.ds-dialog-title` exists only compound; gates use panel titles | 06-05 08-07 | 08-07 is a contract extension, not a violation (§3) | S | ☐ accept ☐ reject ☐ defer |
| C50 | over | DECODE preview is a dark mat, Chain and BIOBUZZ themed SVG; DECODE dimension label about 6px | 03-07 15-04 03-08 | Chain and BIOBUZZ comments cite DECODE's superseded argument; two separate fixes | M | ☐ accept ☐ reject ☐ defer |
| C51 | over | Unlabelled accent stripe on real-robot preset cards | 03-10 | shell.css:4162; replace with a word | S | ☐ accept ☐ reject ☐ defer |
| C52 | over (cont.) | "Season" two meanings; "ELO" vs Glicko/"rating"; custom room has three names; "Profile" ×3 | 19-01 19-02 19-05 01-06 | ELO→rating and the room name are clear fixes; the season rename is contested (§3) | S | ☐ accept ☐ reject ☐ defer |
| C54 | over | "Needs the game server" printed five times | 02-04 | Build-time flag; production never shows it | S | ☐ accept ☐ reject ☐ defer |
| C56 | over | Replay transport: no speed, % readout, scoreboard digits not mono, no phase | 09-03 09-04 09-06 09-07 09-13 | Grab bag; the mono digits are a cheap contract fix; speed is a feature request | M | ☐ accept ☐ reject ☐ defer |
| C57 | conf | Export menu reimplements the segmented control; 2D/3D is a label-carries-state toggle | 09-09 | shell.css:3543; ReplayView.tsx:1188 | S | ☐ accept ☐ reject ☐ defer |
| C58 | over | Failed score correction shown in the success colour | 09-11 | Admin-only; trivial error variant | S | ☐ accept ☐ reject ☐ defer |
| C61 | over (split) | Three banner anatomies; DesktopUpdate label-carries-state toggle | 11-04 11-08 | The server notice is a global overlay, so a different anatomy is defensible | S | ☐ accept ☐ reject ☐ defer |
| C63 | over | Legal prose ASCII " - " (44×); dead band beside the 68ch column | 11-09 11-10 | Unrelated beyond sharing a page | S | ☐ accept ☐ reject ☐ defer |
| C64 | over | Tutorial: literal "unbound", lowercase hint, borrowed `.ds-rejoin`, no step ack, hint overlap | 12-05..12-09 | Do 12-07 (shared container class, a CLAUDE.md gotcha) first | S | ☐ accept ☐ reject ☐ defer |
| C66 | over | Five error classes; "No players found." while searching; Delete panel undistinguished; name asked twice | 08-04 08-05 08-08 08-10 | 08-08 is borderline P1; `.fr-error` duplicated | S | ☐ accept ☐ reject ☐ defer |
| C70 | over | Builder chips wrap, `.five` vs `.four`, label and height drift | 03-09 03-11 03-12 04-07 | 04-07 is the Controls page | S | ☐ accept ☐ reject ☐ defer |

---

## 3. Contested and contract gaps (no recommendation forced)

| # | Question | Side A | Side B |
|---|---|---|---|
| G1 · C40 | **Spacing: which document wins?** | ui-standard's 4px grid is the enforced rule (the uiaudit ratchet), so rewrite DESIGN.md §Spacing and its `xl: 22px`. | DESIGN.md is the look contract and describes what the chrome actually does (`.ds-bar 14px 22px`), so relax the ban for gutters. |
| G2 · C24 | **Pill shape on home keycaps and `.ds-cta`** | The contract says buttons are 8px, so square them off. | They are consistent and give the home page its identity, so document pills as the home and CTA variant. |
| G3 · C27 | **ALL-CAPS panel titles** | ui-standard §6 and ui.md say sentence case, so drop the transform. | The style is app-wide and deliberate, so add panel titles to the four sanctioned ALL-CAPS exceptions. |
| G4 · C26 | **No-Blur scope** | Everything drawn by CSS. | "The chrome" only; mobile touch controls and field text-shadows float on the canvas and are exempt. |
| G5 · C06 | **Ghosted assist buttons at 0.45** | WCAG exempts only inactive controls, and these still take presses. | ui.md: "ghosted, never hidden" is a deliberate affordance for assisted actions. |
| G6 · C20 | **Viewport zoom clamp** | Remove it; the GameView guard already covers the match. | It was set deliberately for play and may cover cases the guard misses (for example iOS double-tap). |
| G7 · C52 | **Who owns the word "Season"?** | A game is a "season" (seasons.ts, the app bar). Rename the ranked reset to "period" or "split". | Act/Season is already the ranked product scheme in admin and announcements. Call the game a "game". |
| G8 · C49 | **Dialog-title rule scope** | ui.md:460 applies to every dialog, gates included. | It was written about App.tsx's overlay dialogs; `.ds-modal-h` plus panel-title is its own consistent anatomy. |
| G9 · C65 | **Career big-number tiles; four leaderboard nav layers** | Both are AI tells and clutter. | Both are taste; the big numbers are what a stats page is for. |
| G10 · 20-12 / 13 | **Space Grotesk's role** | It is a proportional display face; DESIGN.md wrongly calls it mono, and the design guide lists it as an AI-default font. | It is the chosen data face; fix the description, keep the font. |
| G11 · 22-05 | **Season identity on home** | Add one muted line of season copy under the switcher (the data exists in seasons.ts). | Keep home deliberately brand-neutral (the DSIM vs season rule). |

---

## 4. Evidence

- **Screenshots** (scratchpad, not committed): `…/scratchpad/audit-light/` and `…/audit-dark/`, `pN-desktop.png` and `pN-mobile.png`.
  - Routes by number:

    | shot | route |
    |---|---|
    | p0 | `/decode` |
    | p1 | `/decode/modes` |
    | p2 | `/decode/configure/robot` |
    | p3 | `/decode/configure/controls` |
    | p4 | `/decode/records/leaderboard` |
    | p5 | `/decode/records/career` |
    | p6 | `/decode/lobby` |
    | p7 | `/chain` |
    | p8 | `/biobuzz` |
    | p9 | `/biobuzz/configure/robot` |
    | p10 | `/decode/download` |
    | p11 | `/terms` |

  - Scratchpad root: `C:/Users/seun/AppData/Local/Temp/claude/C--Users-seun-Documents-dsim/ac55eb41-ab40-4bec-8a7e-94ea40bc832a/scratchpad/`.
  - The preview build had no game server or auth configured, so the server-dependent states (tables, queue) render empty or offline.
- **audit.cjs (both themes): 0 FAIL, 31 WARN.**
  - Heading skips: h1→h3 on configure, h1→h4 on /terms.
  - Mobile touch targets: `a.sponsor-mark` 155×14, `input.ds-range` 282×8.
  - Cross-page drift: font sizes 24 and 17, radius 16px, the monospace face.
  - No horizontal overflow on any route.
- **uiaudit ratchets:** inline-spacing 5 · off-grid-gap 143 · off-scale-font-size 45 · literal-radius 12 · shadow-sprawl 14. It also flags ✗ stale-component-index (after 4a1d7ee).
- **contrast.mjs:** 269/269 pass. Blind spots are listed in §1.
- Raw lane files: `…/scratchpad/reviews/NN-*.md`. Skeptic verdicts: `…/scratchpad/verify-{A,B,C}.md`.

---

## 5. P2/P3 findings (282, unverified, not deduplicated)

Full text in the appendix under the same ID. Many overlap the clusters above.

| ID | Sev | Finding | Decision |
|---|---|---|---|
| 01-10 | P2 | Footer links, home social pills and the Discord join button have no themed focus ring | ☐ accept ☐ reject ☐ defer |
| 01-11 | P2 | The footer sponsor mark is a 14px-tall tap target on every phone page | ☐ accept ☐ reject ☐ defer |
| 01-12 | P2 | The app bar uses banned spacing literals and a negative-margin patch | ☐ accept ☐ reject ☐ defer |
| 01-13 | P2 | The rail and home stack are built from off-grid literals | ☐ accept ☐ reject ☐ defer |
| 01-14 | P2 | The active rail item is raised, not pressed, which inverts the keycap metaphor | ☐ accept ☐ reject ☐ defer |
| 01-15 | P2 | The brand is shown twice on home: bar wordmark plus a 64px "DSIM" h1 | ☐ accept ☐ reject ☐ defer |
| 01-16 | P2 | The home title's line-height is off the standard | ☐ accept ☐ reject ☐ defer |
| 01-17 | P2 | Hover transitions animate `color`, and keycap timings are inconsistent | ☐ accept ☐ reject ☐ defer |
| 01-18 | P2 | The mobile season strip grows while the desktop strip stays a whisper | ☐ accept ☐ reject ☐ defer |
| 01-19 | P2 | The Chain Reaction first-visit dialog sets a four-line prose block centred | ☐ accept ☐ reject ☐ defer |
| 01-20 | P3 | The Logo hardcodes an off-scale 7px radius and three off-palette hexes | ☐ accept ☐ reject ☐ defer |
| 01-21 | P3 | The homestats category line is lowercase and uses mono | ☐ accept ☐ reject ☐ defer |
| 01-22 | P3 | "← Home" uses an ASCII-arrow glyph label and a different type size from its siblings | ☐ accept ☐ reject ☐ defer |
| 02-11 | P2 | The /modes tile grid is ragged: 2, then 3, then 2 | ☐ accept ☐ reject ☐ defer |
| 02-12 | P2 | "Solo Practice" filled accent reads as selected, not as the default | ☐ accept ☐ reject ☐ defer |
| 02-13 | P2 | The roster row carries a coloured left stripe on a rounded card | ☐ accept ☐ reject ☐ defer |
| 02-14 | P2 | Matchmaking stacks four kinds of helper text in one panel | ☐ accept ☐ reject ☐ defer |
| 02-15 | P2 | "Only my region ON/OFF": the state is written into the label | ☐ accept ☐ reject ☐ defer |
| 02-16 | P2 | Lobby toggle picks have no `aria-pressed` | ☐ accept ☐ reject ☐ defer |
| 02-17 | P2 | Emoji and ornamental glyphs in lobby chips and buttons | ☐ accept ☐ reject ☐ defer |
| 02-18 | P2 | Hyphens standing in for em dashes in user-visible copy | ☐ accept ☐ reject ☐ defer |
| 02-19 | P2 | Discord lobby list: inline maxWidth, banned var fallback, loading/empty outside the list-state pattern | ☐ accept ☐ reject ☐ defer |
| 02-20 | P2 | Off-grid spacing throughout the play-flow rules | ☐ accept ☐ reject ☐ defer |
| 02-21 | P2 | Off-scale type sizes in tiles and CTAs | ☐ accept ☐ reject ☐ defer |
| 02-22 | P3 | The tutorial offer borrows `.ds-rejoin` as its container | ☐ accept ☐ reject ☐ defer |
| 02-23 | P3 | `.ds-hint-caption` is used but defined nowhere | ☐ accept ☐ reject ☐ defer |
| 02-24 | P3 | Title Case tile names | ☐ accept ☐ reject ☐ defer |
| 03-13 | P2 | Hero background is a gradient, and the preview box adds a radial accent glow | ☐ accept ☐ reject ☐ defer |
| 03-14 | P2 | Nested cards: stat tiles and sprite box inside the hero card, cards inside the Start-from panel | ☐ accept ☐ reject ☐ defer |
| 03-15 | P2 | Off-scale values and literal geometry concentrated in builder CSS | ☐ accept ☐ reject ☐ defer |
| 03-16 | P2 | Cosmetic swatches live in the in-match stylesheet, with no focus ring token and an opacity-dimmed lock | ☐ accept ☐ reject ☐ defer |
| 03-17 | P2 | Three selection vocabularies on one page | ☐ accept ☐ reject ☐ defer |
| 03-18 | P2 | Chassis-map captions and labels mix case and put game nouns in caps inside sentence-case captions | ☐ accept ☐ reject ☐ defer |
| 03-19 | P2 | Disabled chassis-map and catalyst cells explain themselves only through `title` | ☐ accept ☐ reject ☐ defer |
| 03-20 | P2 | Build panel's identity inputs look disabled in light mode, and empty fields have no placeholder | ☐ accept ☐ reject ☐ defer |
| 03-21 | P2 | Gap rhythm between builder panels is uneven | ☐ accept ☐ reject ☐ defer |
| 03-22 | P2 | BIOBUZZ hero reports DECODE-model numbers | ☐ accept ☐ reject ☐ defer |
| 03-23 | P3 | `Start from` panel contains a single caption "Presets" when no robots are saved | ☐ accept ☐ reject ☐ defer |
| 03-24 | P3 | "CUSTOM" badge is shouting and appears on a fresh default robot | ☐ accept ☐ reject ☐ defer |
| 03-25 | P3 | Stale comments misdescribe current CSS | ☐ accept ☐ reject ☐ defer |
| 04-08 | P2 | Read-only values are painted in the link/action accent | ☐ accept ☐ reject ☐ defer |
| 04-09 | P2 | "Touch controls" and "Tutorial" are two head-only cards, one button each, a section gap apart | ☐ accept ☐ reject ☐ defer |
| 04-10 | P2 | GraphicsSection hand-rolls `.ds-opt` pickers outside `OptRow`, and uses `.on`/`aria-pressed` to mean "capturing" | ☐ accept ☐ reject ☐ defer |
| 04-11 | P2 | Arrow-key caps are tiny glyphs that a screen reader reads as "black left-pointing pointer" | ☐ accept ☐ reject ☐ defer |
| 04-12 | P2 | A bind can only be removed with Backspace during capture, so pointer, pad and touch users cannot remove one | ☐ accept ☐ reject ☐ defer |
| 04-13 | P2 | Capture state is not announced | ☐ accept ☐ reject ☐ defer |
| 04-14 | P2 | Off-grid geometry in the settings chrome | ☐ accept ☐ reject ☐ defer |
| 04-15 | P2 | Mobile scope switch: unselected seasons are bare floating text in a 2x2 grid, and the unbound dot is clipped at the corner | ☐ accept ☐ reject ☐ defer |
| 04-16 | P2 | Sub-nav entries are `<button>`s with `aria-current="page"`, not links | ☐ accept ☐ reject ☐ defer |
| 04-17 | P3 | `Select` listbox lacks Home/End and typeahead, and its name is optional | ☐ accept ☐ reject ☐ defer |
| 04-18 | P3 | Inline colour in JSX | ☐ accept ☐ reject ☐ defer |
| 04-19 | P3 | Slider accessible names are spelled two ways | ☐ accept ☐ reject ☐ defer |
| 04-20 | P3 | ui-standard §10 still lists `button.ds-key` as missing `:focus-visible` | ☐ accept ☐ reject ☐ defer |
| 04-21 | P3 | Network is a whole section for a single two-tile pick, and `LABELS` is a one-field record | ☐ accept ☐ reject ☐ defer |
| 05-12 | P2 | The pre-match "RED ALLIANCE" is plain ink, while a filled alliance chip sits unused | ☐ accept ☐ reject ☐ defer |
| 05-13 | P2 | Blurred shadows and backdrop blur in the in-match chrome | ☐ accept ☐ reject ☐ defer |
| 05-14 | P2 | Chain Reaction shows the same state two or three times on desktop | ☐ accept ☐ reject ☐ defer |
| 05-15 | P2 | The mobile layout editor bar is a separate button language with no state styles | ☐ accept ☐ reject ☐ defer |
| 05-16 | P2 | `.game-btn` and `.pred-opt` break the keycap rules | ☐ accept ☐ reject ☐ defer |
| 05-17 | P2 | The net corner colours neutral facts as success and uses an emoji icon | ☐ accept ☐ reject ☐ defer |
| 05-18 | P2 | A red card, which voids the match score, is now a 12×16 swatch | ☐ accept ☐ reject ☐ defer |
| 05-19 | P2 | An assisted touch button is ghosted with opacity, which reads as disabled | ☐ accept ☐ reject ☐ defer |
| 05-20 | P3 | Dead HUD chip variants are still audited, which overstates coverage | ☐ accept ☐ reject ☐ defer |
| 05-21 | P3 | Off-grid spacing and literal radii across the HUD cards | ☐ accept ☐ reject ☐ defer |
| 06-13 | P2 | Results hierarchy: the largest words say "MATCH RESULTS", and the outcome loses to the title | ☐ accept ☐ reject ☐ defer |
| 06-14 | P2 | Celebration motion uses overshoot curves that the design guide rules out | ☐ accept ☐ reject ☐ defer |
| 06-15 | P2 | The claim dialog is a stock "achievement unlocked" modal with a radial glow | ☐ accept ☐ reject ☐ defer |
| 06-16 | P2 | Inline spacing in JSX, which the standard bans outright, in four files of this lane | ☐ accept ☐ reject ☐ defer |
| 06-17 | P2 | Off-scale values in the report and badge CSS | ☐ accept ☐ reject ☐ defer |
| 06-18 | P2 | "★ PERSONAL BEST" puts the OWNER glyph on the banner, right under a comment that bans a glyph there | ☐ accept ☐ reject ☐ defer |
| 06-19 | P2 | The total's accessible name is on a `<strong>`, which ignores `aria-label`, and the label repeats the heading | ☐ accept ☐ reject ☐ defer |
| 06-20 | P2 | Title chip spacing: a dead selector, and no leading gap | ☐ accept ☐ reject ☐ defer |
| 06-21 | P3 | Mixed case and terms on the results board | ☐ accept ☐ reject ☐ defer |
| 06-22 | P3 | RecordRun error heading puts the word "start" in accent | ☐ accept ☐ reject ☐ defer |
| 06-23 | P3 | The whole results stage is `cursor: pointer` after the sequence ends | ☐ accept ☐ reject ☐ defer |
| 07-13 | P2 | The empty-state headline has no weight, so it reads as body text | ☐ accept ☐ reject ☐ defer |
| 07-14 | P2 | The table type sits off the scale: 14px body, 10px headers and tags | ☐ accept ☐ reject ☐ defer |
| 07-15 | P2 | Your ranked standing box has square corners and an off-grid, non-mono rank | ☐ accept ☐ reject ☐ defer |
| 07-16 | P2 | Changing a filter blanks the table and the panel jumps height | ☐ accept ☐ reject ☐ defer |
| 07-17 | P2 | No sticky header on long tables | ☐ accept ☐ reject ☐ defer |
| 07-18 | P2 | The "Custom" type chip dims through opacity | ☐ accept ☐ reject ☐ defer |
| 07-19 | P2 | Keyboard focus looks different on the table's inline controls | ☐ accept ☐ reject ☐ defer |
| 07-20 | P2 | Names shift layout on hover through a border, not a transform | ☐ accept ☐ reject ☐ defer |
| 07-21 | P2 | Drivetrain spelling differs within one board | ☐ accept ☐ reject ☐ defer |
| 07-22 | P3 | Hyphen-minus used as the "no value" and negative sign | ☐ accept ☐ reject ☐ defer |
| 07-23 | P3 | CareerPanel mixes letter case in its source labels | ☐ accept ☐ reject ☐ defer |
| 07-24 | P3 | A panel-title eyebrow floats outside any panel | ☐ accept ☐ reject ☐ defer |
| 07-25 | P3 | The FINAL tag borrows the YOU tag's class | ☐ accept ☐ reject ☐ defer |
| 08-12 | P2 | Colour for the username hint is an inline `style`, in four places | ☐ accept ☐ reject ☐ defer |
| 08-13 | P2 | Two display conventions for the same "status after save" line | ☐ accept ☐ reject ☐ defer |
| 08-14 | P2 | Raw server error strings reach the page | ☐ accept ☐ reject ☐ defer |
| 08-15 | P2 | Profile page hierarchy: the Account tab puts a 12-panel stack under one heading, with the Account ID given equal weight | ☐ accept ☐ reject ☐ defer |
| 08-16 | P2 | Profile tabs: "Profile" h1, but the tabs say Appearance/Account and the URL is /account | ☐ accept ☐ reject ☐ defer |
| 08-17 | P2 | Modal chrome is off-grid and carries its own shadow and scrim | ☐ accept ☐ reject ☐ defer |
| 08-18 | P2 | Sign-in modal: no focus return, and backdrop-click discards a half-typed sign-up | ☐ accept ☐ reject ☐ defer |
| 08-19 | P2 | The "Choose your username" gate gives no context and no way out | ☐ accept ☐ reject ☐ defer |
| 08-20 | P2 | Your-data and Account copy runs long, and much of it narrates or reassures | ☐ accept ☐ reject ☐ defer |
| 08-21 | P2 | Linked accounts: each row is a label, a sentence and a button stacked in a `.ds-field` column | ☐ accept ☐ reject ☐ defer |
| 08-22 | P3 | AI-tell: glyph-as-status (`✓ Friends`, `Available ✓`, `Invited ✓`, `✕`) | ☐ accept ☐ reject ☐ defer |
| 08-23 | P3 | "Working…" is the only non-specific busy label | ☐ accept ☐ reject ☐ defer |
| 08-24 | P3 | The profile subtitle ends in "Public profile", which restates the page | ☐ accept ☐ reject ☐ defer |
| 08-25 | P3 | `AuthDisabled` and the profile "no server" state name environment variables to end users | ☐ accept ☐ reject ☐ defer |
| 09-14 | P2 | The replay header's title is not centred, and the spacer comment names the wrong button | ☐ accept ☐ reject ☐ defer |
| 09-15 | P2 | The replay screen has no page heading, and the rail's h3/h4 hang from nothing | ☐ accept ☐ reject ☐ defer |
| 09-16 | P2 | Off-grid spacing and off-scale type across the viewer's CSS | ☐ accept ☐ reject ☐ defer |
| 09-17 | P2 | Error states pass raw server or exception text through | ☐ accept ☐ reject ☐ defer |
| 09-18 | P2 | Watch Live's button labels are ALL CAPS and change width | ☐ accept ☐ reject ☐ defer |
| 09-19 | P2 | Live cards cram six facts into one prose line, with a different clock format | ☐ accept ☐ reject ☐ defer |
| 09-20 | P2 | Watch Live's panel hierarchy is inconsistent | ☐ accept ☐ reject ☐ defer |
| 09-21 | P2 | Dragging the seek bar backwards re-simulates from tick 0 on every input event | ☐ accept ☐ reject ☐ defer |
| 09-22 | P2 | The practice list's Physics column mixes two facts and uses an ASCII hyphen for "unknown" | ☐ accept ☐ reject ☐ defer |
| 09-23 | P2 | The score editor saves through `window.confirm` | ☐ accept ☐ reject ☐ defer |
| 09-24 | P3 | Glyphs stand in for icons, and there are two different "play" arrows | ☐ accept ☐ reject ☐ defer |
| 09-25 | P3 | ShareButton: the "Link copied" feedback is silent and changes width | ☐ accept ☐ reject ☐ defer |
| 10-03 | P2 | Destructive styling is inconsistent: the same action is danger in one place and ghost in another, and one mass-reset is `primary` | ☐ accept ☐ reject ☐ defer |
| 10-04 | P2 | Four confirm sites skip `confirmed()`, and the season confirm never names the season | ☐ accept ☐ reject ☐ defer |
| 10-05 | P2 | Seven list/row patterns for one console, while `.ds-table` sits unused beside them | ☐ accept ☐ reject ☐ defer |
| 10-06 | P2 | Form controls are re-implemented five times instead of using `.ds-input`/`.ds-select` | ☐ accept ☐ reject ☐ defer |
| 10-07 | P2 | The console's CSS is split across four namespaces and two stylesheets, most of it in the in-match file | ☐ accept ☐ reject ☐ defer |
| 10-08 | P2 | Status pills use brand green for alarm states and red for neutral data | ☐ accept ☐ reject ☐ defer |
| 10-09 | P2 | Three stat-tile components, and the one polled every 5 s is not monospace | ☐ accept ☐ reject ☐ defer |
| 10-10 | P2 | Button casing is split roughly half and half, often inside one toolbar | ☐ accept ☐ reject ☐ defer |
| 10-11 | P2 | Heading structure: h1 jumps to h3/h4, one tab has no heading, and one eyebrow style plays three levels | ☐ accept ☐ reject ☐ defer |
| 10-12 | P2 | List states are handled differently on almost every list | ☐ accept ☐ reject ☐ defer |
| 10-13 | P2 | Mixed button sizes (and so radii) in one row | ☐ accept ☐ reject ☐ defer |
| 10-14 | P2 | Chart and delta colours borrow text tokens and alliance hues | ☐ accept ☐ reject ☐ defer |
| 10-15 | P2 | Explanatory prose everywhere; the Live tab is a long scroll of hints | ☐ accept ☐ reject ☐ defer |
| 10-16 | P3 | Off-grid spacing and off-scale type throughout the older admin block | ☐ accept ☐ reject ☐ defer |
| 10-17 | P3 | Inline colour style in JSX for the announcement preview | ☐ accept ☐ reject ☐ defer |
| 10-18 | P3 | The lone emoji in the chrome | ☐ accept ☐ reject ☐ defer |
| 10-19 | P3 | Reasons that players will read are collected in single-line `window.prompt`s | ☐ accept ☐ reject ☐ defer |
| 10-20 | P3 | The Standing toggle is styled as an action in a row of actions | ☐ accept ☐ reject ☐ defer |
| 11-11 | P2 | Long-form type sits off the type scale and off the prose line-height | ☐ accept ☐ reject ☐ defer |
| 11-12 | P2 | On the download page the hero card sits lower than the cards it outranks | ☐ accept ☐ reject ☐ defer |
| 11-13 | P2 | The build cards are tall boxes with a stray arrow in the corner | ☐ accept ☐ reject ☐ defer |
| 11-14 | P2 | Maintenance banner uses colour emoji (⛔ / 🛠), which the download page removed for the same reason | ☐ accept ☐ reject ☐ defer |
| 11-15 | P2 | Banner and footer interactive elements lack their own :focus-visible and :active states | ☐ accept ☐ reject ☐ defer |
| 11-16 | P2 | Cinematic reveal is the app's one "AI-tell" set piece | ☐ accept ☐ reject ☐ defer |
| 11-17 | P2 | "What's new" panel uses a blurred shadow, a pop animation and an off-grid inset | ☐ accept ☐ reject ☐ defer |
| 11-18 | P2 | Changelog duplicates the announcement item markup and mislabels its offline state | ☐ accept ☐ reject ☐ defer |
| 11-19 | P2 | "Privacy" and "Privacy & cookie settings" are two footer items that usually go to the same page | ☐ accept ☐ reject ☐ defer |
| 11-20 | P2 | The footer's brand line mixes two mono treatments and wraps untidily on phones | ☐ accept ☐ reject ☐ defer |
| 11-21 | P3 | `.legal-warn` is off-grid and off-scale | ☐ accept ☐ reject ☐ defer |
| 11-22 | P3 | Contact email in the Terms/Privacy is bold text, not a mailto link | ☐ accept ☐ reject ☐ defer |
| 11-23 | P3 | Literal sizes in peripheral CSS the ratchet will keep counting | ☐ accept ☐ reject ☐ defer |
| 11-24 | P3 | Sponsor mark's accessible name reads "Presented by Offset logo", and nothing says it opens a new tab | ☐ accept ☐ reject ☐ defer |
| 12-10 | P2 | Keys and game nouns share one ALL-CAPS voice, and the hints skip the existing keycap component | ☐ accept ☐ reject ☐ defer |
| 12-11 | P2 | Chain Reaction has no tutorial, so onboarding differs by season | ☐ accept ☐ reject ☐ defer |
| 12-12 | P2 | One seen flag covers every season | ☐ accept ☐ reject ☐ defer |
| 12-13 | P2 | The first-run offer has no dismiss | ☐ accept ☐ reject ☐ defer |
| 12-14 | P2 | Screen readers hear "Step 2 of 4" but not the instruction | ☐ accept ☐ reject ☐ defer |
| 12-15 | P2 | No reduced-motion rule for the button hover transform | ☐ accept ☐ reject ☐ defer |
| 12-16 | P2 | Finished-card copy: redundant eyebrow, a dash appositive, and reassurance | ☐ accept ☐ reject ☐ defer |
| 12-17 | P2 | Hints that narrate | ☐ accept ☐ reject ☐ defer |
| 12-18 | P2 | The card may collide with the HUD bands in free drive on narrow landscape | ☐ accept ☐ reject ☐ defer |
| 12-19 | P3 | Line-heights outside the two allowed values | ☐ accept ☐ reject ☐ defer |
| 12-20 | P3 | The Controls "Tutorial" panel does not say which season it runs, and the doc names it differently | ☐ accept ☐ reject ☐ defer |
| 12-21 | P3 | predict.css: magic px values and a duplicate declaration | ☐ accept ☐ reject ☐ defer |
| 13-06 | P2 | The stale-index check fires on line numbers, so it goes red on edits that change nothing | ☐ accept ☐ reject ☐ defer |
| 13-08 | P2 | Six tokens are dead but still themed and still counted by contrast | ☐ accept ☐ reject ☐ defer |
| 13-09 | P2 | The legacy `--text`/`--muted` bridge keeps growing and is no longer a pure alias | ☐ accept ☐ reject ☐ defer |
| 13-10 | P2 | A token is defined outside the token block, and its literal is still repeated | ☐ accept ☐ reject ☐ defer |
| 13-11 | P2 | About 30 raw colours in styles.css, including an unnamed scrim family and off-palette alliance gradients | ☐ accept ☐ reject ☐ defer |
| 13-12 | P2 | The styles.css / shell.css boundary leaks both ways: 8 prefix families split across the two files | ☐ accept ☐ reject ☐ defer |
| 13-13 | P2 | Three documents still describe the rejected pastel identity | ☐ accept ☐ reject ☐ defer |
| 13-14 | P2 | Near-duplicate tokens and hand-synced copies in TS and canvas code | ☐ accept ☐ reject ☐ defer |
| 13-15 | P3 | Small type and fallback leftovers | ☐ accept ☐ reject ☐ defer |
| 14-10 | P2 | The uppercase letter-spaced kicker is overused (48 rules, 7 variants of one role) | ☐ accept ☐ reject ☐ defer |
| 14-12 | P2 | Line-height has 17 values against a documented two | ☐ accept ☐ reject ☐ defer |
| 14-13 | P2 | Off-scale sizes: group into justified (canvas/HUD/display) and drift | ☐ accept ☐ reject ☐ defer |
| 14-14 | P2 | Card padding takes six values across card types | ☐ accept ☐ reject ☐ defer |
| 14-15 | P2 | Space Grotesk ("mono") is used for prose sub-lines, which blurs the data/copy split | ☐ accept ☐ reject ☐ defer |
| 14-16 | P2 | Numbers that change sit in the body face without tabular figures | ☐ accept ☐ reject ☐ defer |
| 14-17 | P2 | uiaudit's grid and type rules have blind spots that let drift in unmeasured | ☐ accept ☐ reject ☐ defer |
| 14-18 | P2 | Two page shells with different gutters and widths | ☐ accept ☐ reject ☐ defer |
| 14-19 | P2 | Letter-spacing on headings mixes em and px and flips sign between siblings | ☐ accept ☐ reject ☐ defer |
| 14-20 | P3 | The same wordmark renders at two sizes | ☐ accept ☐ reject ☐ defer |
| 14-21 | P3 | ui-standard §3 contradicts itself on weights, and §6 names a class that does not exist | ☐ accept ☐ reject ☐ defer |
| 14-22 | P3 | `.md-code` uses a system monospace stack and a 5px literal radius | ☐ accept ☐ reject ☐ defer |
| 15-11 | P2 | The canvas editors hardcode legal/illegal hex values instead of reading tokens | ☐ accept ☐ reject ☐ defer |
| 15-12 | P2 | The announcement cinema is glow-on-dark: blurred colour shadows and gradient washes | ☐ accept ☐ reject ☐ defer |
| 15-13 | P2 | Accent-tinted gradients sit behind the page and the hero card | ☐ accept ☐ reject ☐ defer |
| 15-14 | P2 | The lobby headline paints a word in accent | ☐ accept ☐ reject ☐ defer |
| 15-15 | P2 | Two left-edge accent stripes (the design-guide tell) | ☐ accept ☐ reject ☐ defer |
| 15-16 | P2 | In dark theme, Status Green and Driver Green are nearly the same colour | ☐ accept ☐ reject ☐ defer |
| 15-17 | P2 | The mobile edit bar's primary ink is a one-off literal | ☐ accept ☐ reject ☐ defer |
| 15-18 | P2 | The per-game identity changes no colour, but the game label is only grey text | ☐ accept ☐ reject ☐ defer |
| 15-19 | P3 | DESIGN.md's colour facts have drifted from the code | ☐ accept ☐ reject ☐ defer |
| 15-20 | P3 | Literal `rgba(…)` HUD scrims bypass the `--ds-hud` tokens | ☐ accept ☐ reject ☐ defer |
| 16-08 | P2 | The same chip component exists twice: HUD `.chip` and `.ds-chip` | ☐ accept ☐ reject ☐ defer |
| 16-09 | P2 | Badge sprawl: 11 one-off badges and no contract component, several below the type floor | ☐ accept ☐ reject ☐ defer |
| 16-10 | P2 | Seven tab/segmented/subnav controls, including near-duplicate twins | ☐ accept ☐ reject ☐ defer |
| 16-11 | P2 | Four banner treatments, and the rejoin banner reused for the tutorial offer | ☐ accept ☐ reject ☐ defer |
| 16-12 | P2 | Cards: `.ds-panelbox` duplicates `.ds-panel`, and `.ds-dl-hero` is a gradient card | ☐ accept ☐ reject ☐ defer |
| 16-13 | P2 | Two table components | ☐ accept ☐ reject ☐ defer |
| 16-14 | P2 | Lift-up hovers invert the keycap language, and one hover uses a blur glow | ☐ accept ☐ reject ☐ defer |
| 16-15 | P2 | The shared focus list omits several pressables | ☐ accept ☐ reject ☐ defer |
| 16-16 | P2 | `.ds-btn.danger` is an undocumented variant defined in the admin section of the legacy stylesheet | ☐ accept ☐ reject ☐ defer |
| 16-17 | P3 | `.ds-input` focus ring contradicts the contract | ☐ accept ☐ reject ☐ defer |
| 16-18 | P3 | No error list state, off-grid empty/loading padding, and the leaderboard error exposes an env var | ☐ accept ☐ reject ☐ defer |
| 16-19 | P3 | `.ds-username-input` border is inconsistent with other inputs | ☐ accept ☐ reject ☐ defer |
| 16-20 | P3 | docs/ui-components.md is stale and cannot see modifiers | ☐ accept ☐ reject ☐ defer |
| 16-21 | P3 | `.ds-opt.real` uses an inset accent left edge | ☐ accept ☐ reject ☐ defer |
| 16-22 | P3 | Small off-token values in the dialog and option chrome | ☐ accept ☐ reject ☐ defer |
| 16-23 | P3 | The lobby still uses the legacy page shell | ☐ accept ☐ reject ☐ defer |
| 17-11 | P2 | The home game switcher and the Admin tabs are half-built ARIA tablists | ☐ accept ☐ reject ☐ defer |
| 17-12 | P2 | The chassis-map disabled cells hide their reason, and which cells are occupied is visual-only | ☐ accept ☐ reject ☐ defer |
| 17-13 | P2 | Select's `aria-label` replaces the current value in the trigger's accessible name | ☐ accept ☐ reject ☐ defer |
| 17-14 | P2 | The alliance score panels are told apart by colour and position only | ☐ accept ☐ reject ☐ defer |
| 17-15 | P2 | The heading outline skips levels on Configure, Controls, the BIOBUZZ builder and all Markdown pages | ☐ accept ☐ reject ☐ defer |
| 17-16 | P2 | Range inputs are 8 px tall hit boxes | ☐ accept ☐ reject ☐ defer |
| 17-17 | P2 | The sponsor mark is a 14 px-tall standalone link on nearly every page | ☐ accept ☐ reject ☐ defer |
| 17-18 | P2 | Infinite decorative motion with no pause for users who have not set reduced motion | ☐ accept ☐ reject ☐ defer |
| 17-19 | P2 | The connection-quality dot in the PerfHud is colour-only | ☐ accept ☐ reject ☐ defer |
| 17-20 | P3 | The docs claim "the app suppresses the UA ring app-wide", but nothing does | ☐ accept ☐ reject ☐ defer |
| 17-21 | P3 | Sliders announce bare numbers without units | ☐ accept ☐ reject ☐ defer |
| 17-22 | P3 | The HUD button glyphs are read aloud | ☐ accept ☐ reject ☐ defer |
| 18-10 | P2 | Eleven width breakpoints and four height breakpoints, with no documented set | ☐ accept ☐ reject ☐ defer |
| 18-11 | P2 | Hover styles are not gated on `(hover: hover)`, so keycaps stay "sunk" after a tap | ☐ accept ☐ reject ☐ defer |
| 18-12 | P2 | Rail and subnav strips show a full classic scrollbar under the nav on narrow desktop windows, with no scroll affordance on phones | ☐ accept ☐ reject ☐ defer |
| 18-13 | P2 | On-field touch controls use a themed token for their ring | ☐ accept ☐ reject ☐ defer |
| 18-14 | P2 | Five copies of the same one-line table scroller, with no horizontal-scroll affordance or sticky key column | ☐ accept ☐ reject ☐ defer |
| 18-15 | P2 | The Controls page leads with keyboard binding on a phone | ☐ accept ☐ reject ☐ defer |
| 18-16 | P2 | In-match MENU/RESET shrink to ~28px on touch, top-left, beside the notch | ☐ accept ☐ reject ☐ defer |
| 18-17 | P2 | The home page puts social links above the primary action on a phone | ☐ accept ☐ reject ☐ defer |
| 18-18 | P3 | Duplicate media blocks for the same width, side by side | ☐ accept ☐ reject ☐ defer |
| 18-19 | P3 | The FriendsPanel squeeze breakpoint is duplicated in TS | ☐ accept ☐ reject ☐ defer |
| 18-20 | P3 | `theme-color` follows the OS scheme, not the app theme | ☐ accept ☐ reject ☐ defer |
| 18-21 | P3 | The pad's fallback placement drops a button at screen centre | ☐ accept ☐ reject ☐ defer |
| 19-07 | P2 | "Records" means four different things | ☐ accept ☐ reject ☐ defer |
| 19-08 | P2 | "Profile" vs "Account" vs "Stats" vs "Career" drift | ☐ accept ☐ reject ☐ defer |
| 19-09 | P2 | ASCII hyphen used as a dash in the legal text and a live hint | ☐ accept ☐ reject ☐ defer |
| 19-10 | P2 | Room screens are covered in decorative glyphs (▶ ✎ ★ ＋ － 🤖 ⟲) | ☐ accept ☐ reject ☐ defer |
| 19-11 | P2 | Custom room entry: segment and CTA say the same thing | ☐ accept ☐ reject ☐ defer |
| 19-12 | P2 | "Both players must pick the same region": custom rooms hold four | ☐ accept ☐ reject ☐ defer |
| 19-13 | P2 | "Sign in from the top bar" points to an unlabelled "?" avatar | ☐ accept ☐ reject ☐ defer |
| 19-14 | P2 | "Needs the game server" x5 is jargon with no next step | ☐ accept ☐ reject ☐ defer |
| 19-15 | P2 | Preset cards say "0.7 inertia" and "one-click NSIS setup" | ☐ accept ☐ reject ☐ defer |
| 19-16 | P2 | Download subline says "offline", but the desktop app is a thin online shell | ☐ accept ☐ reject ☐ defer |
| 19-17 | P2 | Chain Reaction disclaimer names the product three ways | ☐ accept ☐ reject ☐ defer |
| 19-18 | P2 | Sponsor trademark inside a build chip: "OFFSET™ BOX TUBE" | ☐ accept ☐ reject ☐ defer |
| 19-19 | P2 | Hero stat units mix abbreviation styles and read as labels, not units | ☐ accept ☐ reject ☐ defer |
| 19-20 | P3 | Title Case headings on console pages, against the sentence-case rule | ☐ accept ☐ reject ☐ defer |
| 19-21 | P3 | "&" vs "and" drift in labels | ☐ accept ☐ reject ☐ defer |
| 19-22 | P3 | "OK" and "Got it" dismiss dialogs that could name their outcome | ☐ accept ☐ reject ☐ defer |
| 19-23 | P3 | "Start position invalid" uses "chassis", a word the builder never uses | ☐ accept ☐ reject ☐ defer |
| 19-24 | P3 | Tutorial hint casing: DECODE says "ARTIFACT"/"LAUNCH ZONE", but the builder and presets write "pollen", "the HIVE" | ☐ accept ☐ reject ☐ defer |
| 20-03 | P2 | Uppercase-tracked panel headers everywhere, contradicting the standard's own "sentence case" | ☐ accept ☐ reject ☐ defer |
| 20-04 | P2 | Blurred diffuse shadows despite the No-Blur Rule; one of them is also hairline + diffuse | ☐ accept ☐ reject ☐ defer |
| 20-05 | P2 | Thick one-side accent borders used as a cue in six places, and alliance shown as an edge instead of a fill | ☐ accept ☐ reject ☐ defer |
| 20-06 | P2 | Soft gradient washes and accent glows on surfaces the contract calls flat | ☐ accept ☐ reject ☐ defer |
| 20-07 | P2 | "Multi**player**" two-tone headline | ☐ accept ☐ reject ☐ defer |
| 20-08 | P2 | On mobile the robot spec chips turn into a big-number metric-tile grid | ☐ accept ☐ reject ☐ defer |
| 20-09 | P3 | Nested containers on configure | ☐ accept ☐ reject ☐ defer |
| 20-10 | P2 | The home screen is a centred wordmark plus a pill CTA stack, the one generic-looking screen | ☐ accept ☐ reject ☐ defer |
| 20-11 | P3 | Two CTA voices: "CREATE ROOM ▶" in tracked caps against sentence-case actions elsewhere | ☐ accept ☐ reject ☐ defer |
| 20-12 | P2 | Space Grotesk is the guide's own "by default" face, DESIGN.md calls it monospace, and it leaks into copy | ☐ accept ☐ reject ☐ defer |
| 20-13 | P3 | Overshoot keyframes on the results screen are bounce easing by another name | ☐ accept ☐ reject ☐ defer |
| 20-14 | P3 | Muted grey text on the accent-tinted tutorial banner | ☐ accept ☐ reject ☐ defer |
| 21-07 | P2 | Card press loses 1px of its base | ☐ accept ☐ reject ☐ defer |
| 21-08 | P2 | Hover and selection erase the "real robot" marker on `.ds-opt.real` | ☐ accept ☐ reject ☐ defer |
| 21-09 | P2 | 11 transition durations and no motion tokens | ☐ accept ☐ reject ☐ defer |
| 21-10 | P2 | Transitions on layout properties | ☐ accept ☐ reject ☐ defer |
| 21-11 | P2 | Several keycaps are missing from the reduced-motion hold | ☐ accept ☐ reject ☐ defer |
| 21-12 | P2 | Hover sticks on touch | ☐ accept ☐ reject ☐ defer |
| 21-13 | P2 | Blurred glow on the cinematic announcement | ☐ accept ☐ reject ☐ defer |
| 21-14 | P2 | Pending buttons change width when their label swaps | ☐ accept ☐ reject ☐ defer |
| 21-15 | P2 | Custom focus rings are missing on about 15 pressables, and ui-standard misstates why it matters | ☐ accept ☐ reject ☐ defer |
| 21-16 | P3 | Nav and segment controls have mixed transitions | ☐ accept ☐ reject ☐ defer |
| 21-17 | P3 | Overshoot scales in the results and countdown keyframes | ☐ accept ☐ reject ☐ defer |
| 21-18 | P3 | `.net-spinner` uses legacy tokens and is the only spinner | ☐ accept ☐ reject ☐ defer |
| 22-06 | P2 | Chain Reaction greets a season switch with a blocking modal; the other seasons get nothing | ☐ accept ☐ reject ☐ defer |
| 22-07 | P2 | The season switcher only exists on home; the header season label looks like a control and is not one | ☐ accept ☐ reject ☐ defer |
| 22-08 | P2 | The "real robot" marker means different things per season, and DECODE and Chain lose it | ☐ accept ☐ reject ☐ defer |
| 22-09 | P2 | The builder hero preview is a different medium in DECODE (dark canvas and pixel-mono caption) than in Chain and BIOBUZZ (themed SVG) | ☐ accept ☐ reject ☐ defer |
| 22-10 | P2 | In a 3D view the event log is the one HUD card that does not get the dark scrim | ☐ accept ☐ reject ☐ defer |
| 22-11 | P2 | Chain's HUD prints the same facts twice, in two notations | ☐ accept ☐ reject ☐ defer |
| 22-12 | P2 | DECODE's HUD card is the only one of the three with no spoken label | ☐ accept ☐ reject ☐ defer |
| 22-13 | P2 | Only DECODE's pre-match overlay tells the driver anything about the game | ☐ accept ☐ reject ☐ defer |
| 22-14 | P3 | Three near-identical start editors (~1,230 lines) with byte-identical markup | ☐ accept ☐ reject ☐ defer |
| 22-15 | P3 | Chain Reaction has no tutorial, so its Modes and Controls pages are missing a section the other two have | ☐ accept ☐ reject ☐ defer |
| 22-16 | P3 | The BIOBUZZ 3D robot renderer hardcodes the alliance red instead of reading `COLORS.red` | ☐ accept ☐ reject ☐ defer |

---

## 6. Appendix: raw lane findings (unedited)

### 01 — Home / app shell · src/ui/HomeMenu.tsx, NavRail.tsx, AppShell.tsx, ProfileMenu.tsx, Logo.tsx, Sponsor.tsx (home/footer marks), App.tsx:1753-1775, shell.css (:356-715 bar/profile/rail, :1159-1405 home, :1483-1525 footer, :1620-1636 focus, :1734-1752 homestats, :2139-2186 segs, :5030-5199 narrow) · screenshots audit-{light,dark}/p0, p1, p7, p8 (desktop + mobile)

##### 01-01 · P1 · The season switcher is the smallest control on the home page
- where: shell.css:2166-2186 (`.ds-seg`), HomeMenu.tsx:100-114; audit-light/p0-desktop.png, audit-dark/p8-desktop.png
- what: Picking the season changes every screen after it (field, builder, leaderboards, records). On home it still renders as a 12px text strip with no border (`DECODE · Chain Reaction · BIOBUZZ` at y≈313). It sits above three 14px social pills and four 19px keycaps, so the page ranks Discord/Instagram/GitHub above the game choice. The unselected seasons are bare `--ds-mut` text with a transparent border, so they don't look pressable.
- evidence: `.ds-seg { font-size: 12px; padding: 4px 10px; border: 1px solid transparent; background: none }`, versus `.ds-home-link { font-size: 14px; padding: 8px 16px; border: 1px solid var(--ds-line); box-shadow: var(--ds-edge-soft) }`. In p0-desktop the seg strip measures about 24px tall and the social pills about 38px.
- recommendation: Add a home-scoped modifier (`.ds-home-games .ds-seg`) at `--ds-t-md`/`--ds-t-lg` with `--ds-s-2 --ds-s-4` padding. Give the unselected tabs a visible `--ds-line` edge, or put the strip in a recessed `--ds-tile` well. Then move it directly above the menu so the order reads choose season → act.
- contract: DESIGN.md Overview ("Every interactive surface reads as a keycap"); design-guide §4.3
- effort: S

##### 01-02 · P1 · Social links sit between the season choice and Play
- where: HomeMenu.tsx:116-147; audit-light/p0-mobile.png, audit-dark/p0-mobile.png
- what: The three outbound social pills sit between the season switcher and the primary CTA. On a 375px phone they wrap 2 + 1, leaving GitHub orphaned on its own row, and they push Play down to y≈397, about half the viewport. Three identical icon+label pills above the main action is the "hero with extra CTAs" pattern. On a product whose landing page is its menu, outbound links belong after the destinations.
- evidence: `.ds-home-links { flex-wrap: wrap; gap: 10px; margin: 0 0 var(--ds-s-5) }`, placed before `<nav className="ds-menu">` in the JSX. p0-mobile: Discord and Instagram on row 1, GitHub centred alone on row 2.
- recommendation: Move `.ds-home-links` below `.ds-menu`, next to where `.ds-homestats` renders, and demote them to icon-only or `ghost` links. The footer already carries secondary destinations.
- contract: design-guide §3 (hero + multiple CTAs), ui-standard §6 (anatomy is fixed)
- effort: S

##### 01-03 · P1 · Home keycaps are pills, off the shape contract, so home and the rail look like two systems
- where: shell.css:1352-1366 (`.ds-menu-btn { border-radius: var(--ds-round-full) }`); audit-light/p0-desktop.png vs audit-light/p1-desktop.png
- what: DESIGN.md says rectangular components (buttons, panels, tiles) use 8px and pills are for chips and badges. The four home keycaps are 460×76 full pills. The same four destinations one click later (`.ds-rail-btn`, radius 8), and every mode card on /modes (8px), are rectangles. Home and every other screen look like two different design systems.
- evidence: `.ds-menu-btn { border-radius: var(--ds-round-full); padding: 16px 18px }` vs `.ds-rail-btn { border-radius: var(--ds-round) }`. The same applies to `.ds-home-link` (full) vs `.ds-btn` (8px): the social pills are buttons, not chips.
- recommendation: Put `.ds-menu-btn` and `.ds-home-link` on `--ds-round` (or `--ds-round-md` for the big caps) so home shares its button shape with the rest of the shell.
- contract: DESIGN.md Shapes ("Rectangular components (buttons…) use the 8px default… chips and high-identity status pills go full pill")
- effort: S

##### 01-04 · P1 · Home keycap sub-labels use the mono data face for prose
- where: shell.css:1373-1378 (`.ds-menu-btn .mh { font-family: var(--ds-font-mono); letter-spacing: 0.06em }`); audit-dark/p0-desktop.png
- what: "Practice & compete", "Robot & match setup" and the other hints are menu copy, but they render in Space Grotesk with 0.06em tracking. DESIGN.md reserves the mono face for data a driver glances at (scores, timers, ping). The same prose-in-mono shows up in `.ds-foot-brand` (shell.css:1508, "DSIM · DECODE 2025-26"). Mono on non-data weakens the one signal that makes live numbers read as telemetry.
- evidence: `.mh { font-family: var(--ds-font-mono); font-size: 12px; letter-spacing: 0.06em }`, and `.ds-foot-brand { font-family: var(--ds-font-mono) }`.
- recommendation: Drop the mono family and tracking from `.mh` and `.ds-foot-brand` so they use `--ds-font-ui`. Keep mono for the season years only if they are treated as data.
- contract: DESIGN.md Typography ("everything else — labels, menu copy, prose — is set in a rounded-geometric sans")
- effort: S

##### 01-05 · P1 · The presence dot uses a blurred glow
- where: shell.css:461-468
- what: The online dot in the top bar (visible whenever presence lands, on every shell screen) draws a soft blurred halo. That breaks the one absolute depth rule in the contract.
- evidence: `.ds-presence-dot { … box-shadow: 0 0 var(--ds-s-2) var(--ds-ok); }` has an 8px blur radius.
- recommendation: Remove the glow. If it needs emphasis, use a hard ring (`0 0 0 2px color-mix(in srgb, var(--ds-ok) 30%, transparent)`, as `.ds-avatar-btn:hover` does) or a flat 1px `--ds-panel` outline.
- contract: DESIGN.md Elevation, The No-Blur Rule ("never `box-shadow` blur radius > 0")
- effort: S

##### 01-06 · P1 · "Profile" appears three times in the no-auth shell
- where: App.tsx:1767-1775 (no-auth `right` = `<button className="ds-btn">Profile</button>`), NavRail.tsx:14 (`RAIL_ITEMS` profile); audit-light/p0-desktop.png, audit-light/p1-desktop.png
- what: On home, "Profile" is both the top-right bar button and the fourth keycap. On rail screens it is the bar button and the rail item. Both go to the same destination. The bar slot is meant for the avatar/account control (ProfileMenu), and its no-auth fallback just repeats a nav destination.
- evidence: p0 shows "Profile" at (1204,32) and the keycap "Profile / Appearance & account" at (632,704). p1 shows the bar "Profile" plus the rail "Profile" at (50,308).
- recommendation: In the no-auth build, drop the bar button (the rail and menu already cover it), or render a neutral avatar glyph so the bar slot means "you" in both builds.
- contract: contract silent (information-architecture duplication)
- effort: S

##### 01-07 · P1 · The mobile rail is a native scroller that clips "Profile" and shows a Windows scrollbar with arrows
- where: shell.css:5035-5056 (`.ds-rail { overflow-x: auto }` under 900px); audit-dark/p1-mobile.png, audit-light/p1-mobile.png
- what: At 375px the rail becomes a horizontal strip. The fourth destination, Profile, is off-screen with no affordance except a full native scrollbar (with arrow buttons on Windows) drawn under the tabs. That scrollbar reads as a broken layout. Friends then takes a whole second strip underneath, so two strips of chrome sit before the h1. ui.md's own `.ds-segs.even` ruling says "a filter must not hide how many options there are". The same reasoning applies to primary navigation, and here there are only four items.
- evidence: p1-mobile shows "← Home · Play · Configure · Records" with Profile cut off, a grey scrollbar track with ◀ ▶ at y≈127, and the Friends chip alone at y≈162.
- recommendation: Under 640px, fold "← Home" into the logo (it already goes home) and lay the four items out as a `grid-template-columns: repeat(4, 1fr)` strip. Add `scrollbar-width: none` as a backstop. Consider putting the Friends chip at the right end of that strip instead of on its own row.
- contract: docs/area/ui.md (`.ds-segs.even`: "Not a scroller — a filter must not hide how many options there are"), by analogy
- effort: M

##### 01-08 · P1 · The season tabs claim the ARIA tab pattern but implement only half of it
- where: HomeMenu.tsx:101-112
- what: `role="tablist"` / `role="tab"` / `aria-selected` promise a tabpanel (`aria-controls`), roving tabindex and arrow-key movement. None of these exist: every tab is in the tab order and arrows do nothing. The repo has already ruled on this exact half-pattern for OptRow: "a radiogroup owes roving tabindex and arrow keys, and half that pattern is worse than none."
- evidence: `<div className="ds-segs ds-home-games" role="tablist" aria-label="Game">` … `<button role="tab" aria-selected={…}>`, with no `aria-controls`, no `tabIndex`, and no `onKeyDown`.
- recommendation: Use plain toggle buttons with `aria-pressed`, matching `OptRow`/`ToggleRow`, inside a `role="group" aria-label="Season"`.
- contract: docs/area/ui.md Configure ("Toggle buttons, never an ARIA radiogroup — … half that pattern is worse than none")
- effort: S

##### 01-09 · P1 · ProfileMenu declares `role="menu"` without menu items or menu keyboard behaviour
- where: ProfileMenu.tsx:82 (`<div className="ds-profile-pop" role="menu">`), :74 `aria-haspopup="menu"`
- what: The popover mixes a button, a `<p>`, a listbox (ServerMenu) and ghost buttons under `role="menu"`, with no `role="menuitem"`, no arrow-key handling, and no focus moved into the popover on open. Screen readers switch to menu mode and then find no items. Focus also stays on the trigger, so keyboard users have to tab past it into an unannounced region.
- evidence: Lines 82-147 contain no `menuitem` role, and the only key handling is Escape at line 52.
- recommendation: Drop `role="menu"` / `aria-haspopup="menu"`. Use a disclosure (`aria-expanded` + `aria-controls` pointing at a plain `div`, or `role="dialog"` with a label), and move focus to the first control on open.
- contract: ui-standard §1.3 (spirit: every control reachable and explained), otherwise contract silent
- effort: S

##### 01-10 · P2 · Footer links, home social pills and the Discord join button have no themed focus ring
- where: shell.css:1483-1494 (`.ds-foot-link`), :1317-1345 (`.ds-home-link`), :1201-1230 (`.ds-discord-join`); list at :1621-1634
- what: None of these three is in the shared `:focus-visible` list, and none has its own rule. They fall back to the UA ring (black/blue auto outline). That ring doesn't match the accent ring every neighbouring control shows, and it can be low-contrast on the dark `--ds-bar` footer. None of them has an `:active` state either (except the pills).
- evidence: `rg ':focus-visible' shell.css` finds no match for `ds-foot-link`, `ds-home-link` or `ds-discord-join`. No global `outline` reset exists, so the UA ring is what shows.
- recommendation: Add `.ds-foot-link:focus-visible, .ds-home-link:focus-visible, .ds-discord-join:focus-visible` to the selector list at shell.css:1621.
- contract: ui-standard §1.3 ("Every interactive element has `:hover`, `:active`, `:focus-visible` and `:disabled`")
- effort: S

##### 01-11 · P2 · The footer sponsor mark is a 14px-tall tap target on every phone page
- where: Sponsor.tsx:259 (`h={14}`), shell.css:6544-6552, :5194-5196; audit report MOBILE "a.sponsor-mark 155x14" on 9/12 pages
- what: The 640px touch sweep gave `.ds-foot-link` `padding: 8px 2px` ("17px of ink → 33px of tap"). The sponsor link in the same footer row got nothing, so it is the one sub-24px target on almost every page.
- evidence: The audit flags `a.sponsor-mark 155x14` on /decode, /modes, /controls, leaderboard, career, /chain, /biobuzz, /download and /terms.
- recommendation: Inside the existing `@media (max-width: 640px)` touch block, add `.ds-foot-sponsor .sponsor-mark { padding-block: var(--ds-s-2) }`. It is padding only, so the row does not move.
- contract: ui-standard §1 (touch sweep at shell.css:5180 "sized so the TAP AREA clears 32px"); WCAG 2.5.8
- effort: S

##### 01-12 · P2 · The app bar uses banned spacing literals and a negative-margin patch
- where: shell.css:389-417
- what: The bar that frames every screen is built from values §2 bans, plus a negative margin to undo its own gap. `.ds-mark` is `gap: 10px; font-size: 18px`, which is off both scales.
- evidence: `.ds-bar { gap: 20px; padding: 14px 22px }`; `.ds-bar-season { gap: 12px; margin-left: -8px; /* pulls the dot toward the mark; the bar's own gap is 20px */ font-size: 13px }`; `.ds-mark { gap: 10px; font-size: 18px; font-weight: 900 }`; `.ds-bar-right { gap: 12px }` (literal, not `--ds-s-3`).
- recommendation: `.ds-bar { gap: var(--ds-s-3); padding: var(--ds-s-3) var(--ds-s-5) }` and drop the -8px. Set `.ds-mark { gap: var(--ds-s-2); font-size: var(--ds-t-lg) }` (or promote 18 into the scale as a documented brand size) and `.ds-bar-season` to `--ds-t-md`. Keep `--ds-bar-h` via `min-height` as now.
- contract: ui-standard §2 ("BANNED: 3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 18, 20px"), §3 (six sizes)
- effort: S

##### 01-13 · P2 · The rail and home stack are built from off-grid literals
- where: shell.css:654-715, :1164-1195, :1352-1378, :1496-1525
- what: The two main navigation surfaces carry most of the lane's off-grid debt. It is visible as slightly different insets between the rail (14px), bar (22px), footer (22px) and main (22px). The left edges of the logo (x=22), the rail items (x=14+12=26) and the "← Home" label (x=24) don't line up in p1-desktop.
- evidence: `.ds-rail { width: 214px; padding: 24px 14px 40px }`, `.ds-rail-btn { padding: 10px 12px } .rl { font-size: 15px }`, `.ds-rail-home { padding: 8px 10px }`, `.ds-home-links { gap: 10px }`, `.ds-menu-btn { padding: 16px 18px } .ml { font-size: 19px }`, `.ds-foot { padding: 16px 22px }`, `.ds-foot-links { gap: 8px 18px }`. In p1-desktop the logo is at x≈22, "← Home" at x≈26 and the rail labels at x≈27.
- recommendation: Pick one horizontal page inset token (`--ds-s-5`, 24px) for bar, rail, footer and main. Snap rail item padding to `--ds-s-2 --ds-s-3`, `.ml` to `--ds-t-xl`, and link gaps to `--ds-s-2`/`--ds-s-4`. This lowers the `off-grid-gap` / `off-scale-font-size` ratchets.
- contract: ui-standard §2 and §3; ratchet counts off-grid-gap 143 / off-scale-font-size 45
- effort: M

##### 01-14 · P2 · The active rail item is raised, not pressed, which inverts the keycap metaphor
- where: shell.css:710-715; audit-light/p1-desktop.png
- what: The selected destination gets a block shadow (`--ds-block-sm`) plus an accent border and a mint fill, so the current page looks like the most raised, most clickable item. In the keycap language a selected/latched key sits pressed and flush. The mint `accent-soft` pill also differs from how selection reads elsewhere: `.ds-seg.on` and the home Play cap use a solid accent fill.
- evidence: `.ds-rail-btn.on { background: var(--ds-accent-soft); border-color: var(--ds-accent); box-shadow: var(--ds-block-sm) }`. In p1-desktop the Play rail item shows a 2px offset shadow the other items lack.
- recommendation: Drop the `box-shadow` on `.on`, so it is fill and border only, flush. Optionally add `inset 0 2px 0 var(--ds-inset)` so it reads as a latched key.
- contract: DESIGN.md Overview ("sinking on hover and pressing flush on click"); Components › Buttons
- effort: S

##### 01-15 · P2 · The brand is shown twice on home: bar wordmark plus a 64px "DSIM" h1
- where: HomeMenu.tsx:93, shell.css:1174-1180; audit-light/p0-desktop.png
- what: Home stacks the bar mark "DSIM · DECODE" 130px above a 64px "DSIM" h1. The h1 repeats the brand and does not name the loaded season, which is what the page is switching between. The only season cue in the hero is the 12px seg strip (see 01-01). The brand rule wants the app to stay DSIM and the season to be visible as state, but the most prominent thing on the page is the one fact the bar already states.
- evidence: `<h1 className="ds-home-title">{APP_NAME}</h1>`, `font-size: clamp(44px, 7vw, 64px)`. The bar shows `DSIM` + `· DECODE` at 13px `--ds-mut`.
- recommendation: Keep the DSIM h1 (it is also the crawler landing page), but put a season line directly under it, e.g. the season name + years at `--ds-t-lg`, taken from `seasonFor(game)`. Alternatively, make the switcher itself the prominent season display.
- contract: CLAUDE.md brand rule ("DSIM is the app; a game is a season"), ui-standard §6 Page anatomy (h1 → sub)
- effort: S

##### 01-16 · P2 · The home title's line-height is off the standard
- where: shell.css:1174-1180
- what: `.ds-home-title` uses `line-height: 1.05`. The standard allows only 1 (single-line UI) or 1.45 (prose). It is also a third h1 clamp (44→64) beside `.ds-h1`, which the 2026-09-22 sweep unified with `.ds-title h1` for exactly this "same heading, two clamps" reason.
- evidence: `font-size: clamp(44px, 7vw, 64px); font-weight: 800; line-height: 1.05`.
- recommendation: Set `line-height: 1`. Document the home title as the one deliberate display size, or add a `--ds-t-display` token, so it is a decision and not drift.
- contract: ui-standard §3 ("Line height: 1 for single-line UI, 1.45 for prose. No other values.")
- effort: S

##### 01-17 · P2 · Hover transitions animate `color`, and keycap timings are inconsistent
- where: shell.css:699 (`.ds-rail-btn` transition `color 0.14s`), :1331 (`.ds-home-link` `color 0.15s`), :6551 (`.sponsor-mark` `color 0.15s`)
- what: §7 limits transitions to transform/opacity/background/border-color/box-shadow. Three shell controls also animate `color`. The press timing differs too: home keycaps are 0.06s transform, the rail is 0.14s, links are 0.15s.
- evidence: See the quoted `transition:` declarations.
- recommendation: Remove `color` from those transition lists and define one `--ds-press` duration for keycaps.
- contract: ui-standard §7
- effort: S

##### 01-18 · P2 · The mobile season strip grows while the desktop strip stays a whisper
- where: shell.css:5190-5193 (`.ds-seg { min-height: 34px; padding: 6px 12px }` under 640px); audit-light/p0-mobile.png vs p0-desktop.png
- what: The touch bump makes the phone strip (34px, visibly a control) look clearer than the desktop one (about 24px), so the two layouts disagree about how important the switcher is. The bump also leaves `padding: 6px 12px`, and 6 is a banned value.
- evidence: p0-mobile shows the DECODE tab ~78×34 with a solid fill. p0-desktop shows it ~74×24.
- recommendation: Fold into 01-01: size the home seg once at a desktop size that already clears 32px, and use `--ds-s-2` rather than 6px in the touch rule.
- contract: ui-standard §2
- effort: S

##### 01-19 · P2 · The Chain Reaction first-visit dialog sets a four-line prose block centred
- where: audit-light/p7-desktop.png, audit-dark/p7-mobile.png (dialog raised over HomeMenu on /chain)
- what: The disclaimer is prose (4 lines on desktop, 9 on mobile), centre-aligned, in a card with no block shadow. Centred multi-line prose has a ragged left edge and is hard to scan. It is also the one surface on home that drops the `--ds-block` depth model (plain flat white card at 16px radius, the audit's single "radius 16px" drift).
- evidence: p7-mobile shows each line starting at a different x ("Unofficial FTC Discord’s CAD / Competition. This simulator is a …"). p7-desktop shows a plain white card with rounded corners about 16px and no offset shadow.
- recommendation: Left-align the body (`text-align: start`) and keep the title and actions as they are. Put the card on `.ds-panel` depth (`--ds-block`, `--ds-round` or `--ds-round-md`).
- contract: DESIGN.md Cards/Panels (8px, `--ds-block`), ui-standard §3 (prose at 1.45)
- effort: S

##### 01-20 · P3 · The Logo hardcodes an off-scale 7px radius and three off-palette hexes
- where: Logo.tsx:8, :11-12, :15, :20
- what: `radius = 7` default and `#8fdcc2` / `#14332a` are deliberate: the favicon can't read vars, and the file documents this. But `#8fdcc2` is also the dark theme's text colour (audit text list) and 7px matches the 94 uses of 7px radius the audit counts. The logo is anchoring a near-duplicate radius. Not a bug; flagged so the favicon exemption doesn't spread as precedent.
- evidence: `export function Logo({ size = 24, radius = 7 })`, `stopColor="#8fdcc2"`.
- recommendation: Default `radius` to 8 so the mark matches `--ds-round`, and add a line in DESIGN.md recording the logo as the sanctioned literal-colour exception.
- contract: DESIGN.md Shapes (4/8/12/16/24 scale); ui-standard §5 (hex literals documented as debt)
- effort: S

##### 01-21 · P3 · The homestats category line is lowercase and uses mono
- where: HomeMenu.tsx:175-178, shell.css:1748-1752
- what: "solo 12 · duo 3 · 1v1 …" starts lowercase, which goes against the sentence-case house rule, and it is set in mono at 12px while the two stat tiles above it use the ds-stat treatment. Not captured in screenshots (no server), code only.
- evidence: `solo {stats.byCategory.solo} · duo {…} · 1v1 …`
- recommendation: Use "Solo 12 · Duo 3 · 1v1 4 · 2v2 1" and keep mono only on the numbers (tabular-nums), or render them as four small `.ds-stat`s.
- contract: docs/area/ui.md UI COPY (sentence case); DESIGN.md Digits-Are-Mono (numbers, not labels)
- effort: S

##### 01-22 · P3 · "← Home" uses an ASCII-arrow glyph label and a different type size from its siblings
- where: NavRail.tsx:36-38, shell.css:665-676
- what: The rail's first item is 13px/600 `--ds-mut` with a text arrow, above 15px/700 items, so it reads as a breadcrumb stuck onto a nav list. The logo in the bar already goes home (`.ds-mark` onClick home), so on desktop this is a second home control 40px below the first.
- evidence: `<button className="ds-rail-home">← Home</button>`, `.ds-rail-home { font-size: 13px; font-weight: 600; padding: 8px 10px }`.
- recommendation: Either make it a peer rail item ("Home", same `.ds-rail-btn` styling, first in the list) or remove it and rely on the mark. The narrow-viewport strip gains the width (see 01-07).
- contract: ui-standard §4 ("One radius per component … two buttons in the same row may not [differ]"), by extension to type
- effort: S

#### Strengths (keep)
- One source of truth for navigation: `RAIL_ITEMS` feeds both the home keycaps and the rail, so labels and order cannot drift. The "a hint names what is behind the label" comment (NavRail.tsx:4-8) is the right copy rule.
- Light/dark parity is genuinely good. p0/p8 in both themes keep the same hierarchy, the primary cap inverts correctly (deep green / mint with dark ink), and contrast passes all 269 pairs.
- Shift discipline in the shell: `.ds-bar-live` reserves the async presence cluster (min-width 168px), `--ds-bar-h` fixes the bar height against the font swap, and `.ds-seg` holds its weight constant across states. Keep these even while re-spacing the bar.
- The brand/season split in the bar (`DSIM · DECODE`, season muted and separated, AppShell.tsx:112-119) is correct and matches the footer (`DSIM · BIOBUZZ 2026-27`). The fix in 01-15 adds to it and should not replace it.
- The home page has none of the classic AI tells: no gradients, no icon-tile feature grid, no eyebrow-pill hero, no blurred card shadows. The keycap edge shadows are the site's own vocabulary.

### 02 · Play flow: ModeSelect, MatchSetup, Matchmaking, QueueBar, QueueCounts, Lobby, LanPanel, DiscordLobbyList, ChallengePicker, RoleSwapBar, plus related shell.css/styles.css/tutorial.css rules. Screenshots: p1 and p6, light and dark, desktop and mobile.

##### 02-01 · P1 · The Lobby, Ranked, LAN and Discord screens are a second app shell
- where: src/ui/Lobby.tsx:719-737, Matchmaking.tsx:951-974, LanPanel.tsx:437-452, DiscordLobbyList.tsx:77-93; shell.css:3861-3905 (`.ds-console`); p6-desktop vs p1-desktop
- what: /modes renders inside AppShell (bar, rail, footer, `.ds-h1`). One click later, "Custom Room" lands on a separate scaffold. It has no app bar and no rail, a radial accent wash (shell.css:3868-3870), a `← Back` keycap beside a second DSIM wordmark, and a centred 520px column. The header block (back, mark, `.ds-title`) is hand-copied into 4 files, and Matchmaking's `page()` helper is not shared with the others.
- evidence: in p6 the top-left DSIM mark sits at a different x/size from p1's (17px `.ds-head .ds-mark` vs the bar mark). The footer and the rail are gone, and the friends rail floats as a 64px box at the right edge.
- recommendation: pull the console header into one `<ConsoleHead back=… title=…/>` component and use it in all four screens. Longer term, render these routes inside AppShell with the rail collapsed, so the brand stays in one place.
- contract: ui-standard §6 "These skeletons are fixed. A screen that needs something else needs a discussion, not a variant" (Page = eyebrow → h1 → sub → panels)
- effort: M

##### 02-02 · P1 · The console gutter collapses to 4px on a phone
- where: shell.css:3898-3901 (`.ds-console-in { width: min(900px, 94vw) }`), `.ds-console` `overflow-y: scroll` at 3867; p6-mobile (light and dark)
- what: `94vw` counts the always-on scrollbar, so at 375px the column is 352px inside a 360px scroll box. That leaves about 4px of gutter each side. The Back keycap, the "Multiplayer" h1 and the panel's block shadow all sit on the screen edge.
- evidence: p6-mobile shows Back at x≈4, the h1 at x≈4 and the panel border at x≈4. p1-mobile (AppShell) uses a 22px gutter.
- recommendation: `width: min(900px, 100% - 2 * var(--ds-s-4))` (or `padding-inline: var(--ds-s-4)`) so the gutter is measured against the scroll box, not the viewport.
- contract: ui-standard §2 (spacing from tokens; page margins); contract silent on mobile gutter width
- effort: S

##### 02-03 · P1 · Every card on /modes has a kicker that repeats its title or its section
- where: ModeSelect.tsx:103,110,124,149,156,171,178,198; shell.css:1813-1819 (`.ds-tile .k`); p1-desktop
- what: each tile opens with an uppercase mono kicker that restates something already on screen. SOLO sits over "Solo Practice", PRACTICE over "Free Drive" under a "PRACTICE · OFFLINE" label, RECORDS appears twice over "Solo Record"/"Duo Record", CUSTOM over "Custom Room", LIVE over "Watch Live", LAN over "Host or Join" under "LAN · SAME NETWORK". Stacked under the uppercase section labels, that gives three levels of small caps per tile.
- evidence: p1 has 4 section labels plus 7 kickers, 11 uppercase tracked labels above the fold, and none of the kickers adds information.
- recommendation: delete `.k` from every tile. Keep the section label and the title. The tile's 78px min-height then fits a title and one reason line.
- contract: design-guide §3 "Numbered section markers … and repeated uppercase kickers"; ui-standard §8 "Descriptions are deleted, not shortened… If it restates the label… it goes"
- effort: S

##### 02-04 · P1 · The server-offline state is printed five times, not stated once
- where: ModeSelect.tsx:139-183; p1-desktop, p1-mobile
- what: with no game server, all five online tiles carry the same sub-line, "Needs the game server". Their titles go `--ds-mut` (shell.css:1848) while the fill stays `--ds-tile`, the same fill as the enabled Free Drive tile. The disabled state is therefore carried almost entirely by a title colour and a repeated sentence. The page never says why the server is unavailable or what to do.
- evidence: in p1-desktop light, Free Drive (enabled) and Find Match (disabled) share background #edeeec and border. The only difference is the title ink (#191c1b vs #5c645f) and the shadow size.
- recommendation: make the state a property of the section. Put one `.ds-hint warn` under "Compete · online" (e.g. "Online play is unavailable. Couldn’t reach the game server.") and drop the per-tile `.d`. Give `.ds-tile:disabled` a recessed or flat treatment (no block shadow, `--ds-bg` fill) so it clearly differs from an enabled tile.
- contract: ui-standard §6 list states (one error state, not per-item); §8 copy
- effort: S

##### 02-05 · P1 · The pill CTA fights the 8px keycap system, and its label repeats the toggle above it
- where: Lobby.tsx:778-835; shell.css:5249-5262 (`.ds-cta` radius full, 16px/800/0.16em caps); p6-desktop
- what: the entry panel stacks a "Create room | Join room" segmented pick (8px, sentence case) above a full-width pill reading "CREATE ROOM ▶" (9999px, caps, 0.16em tracking). The same words appear twice in two spellings and two shapes, 14px apart. DESIGN.md gives buttons an 8px radius and keeps "full pill" for chips and status pills. The CTA is also the only 16px text in the panel.
- evidence: p6 shows "Create room" (tile, on) directly above "CREATE ROOM ▶" (pill).
- recommendation: make the CTA say only the verb ("Create" / "Join", or "Go ▶"), or drop the toggle and show two CTAs. Bring `.ds-cta` onto `--ds-round` unless DESIGN.md is amended to name the pill CTA as a component. The all-caps spelling is sanctioned (ui.md), the shape is not written anywhere.
- contract: DESIGN.md Shapes ("buttons … use the 8px default; chips and high-identity status pills go full pill"); Components/Buttons "8px radius"
- effort: S (label) / M (radius, touches every console screen)

##### 02-06 · P1 · Two-tone split headings ("Multi|player", "Ranked Match")
- where: Lobby.tsx:733-735,915; Matchmaking.tsx:981,1037,1058,1089,1123; LanPanel.tsx:450; DiscordLobbyList.tsx:91; shell.css:3966-3968; p6-desktop/mobile
- what: every console title colours half of itself `--ds-accent`, sometimes mid-word ("Multi" + "player"). The accent is the one brand colour, reserved in DESIGN.md for primary buttons, links, focus and active states. Here it is spent as ornament on headings. AppShell pages ("Pick a mode") use solid ink, so the same heading level has two looks.
- evidence: p6 light, "Multiplayer" with "player" in #366758. In dark, the mint half is brighter than any control on the page.
- recommendation: delete `.ds-title .accent` and the `<span className="accent">` wrappers so titles render in solid `--ds-ink`. Where the room code needs emphasis ("Room ABC123"), put it in the mono data face instead.
- contract: design-guide §3 "Gradient text on headings → Solid ink from the palette" (same tell, flat-colour form); DESIGN.md Colors "color is spent deliberately, not decoratively"
- effort: S

##### 02-07 · P1 · Invalid `font:` shorthands silently void the RoleSwapBar (and start-position) type
- where: shell.css:5903 and 5917 (`.ds-roleswap-role`, `.ds-roleswap-note`: `font: 500 12px/1.3 inherit;`); also 5795, 5820, 5830 (start-position toggle/tab/role, rendered in the Lobby and MatchSetup start sections)
- what: `inherit` is a CSS-wide keyword and cannot appear inside the `font` shorthand. The whole declaration is invalid and dropped, so these elements set no weight, size or line-height at all. This is the same bug class CLAUDE.md records for `--ds-font`. The "12px" role line renders at the inherited size.
- evidence: `grep "font: [^;]*inherit;"` finds 5 hits, all 5 in these rules.
- recommendation: replace each with longhands (`font-size: var(--ds-t-sm); font-weight: 500; line-height: 1;`). Add a uiaudit rule that fails on `font:` shorthands containing `inherit`.
- contract: ui-standard §3 "Prefer the longhands. `font:` shorthand … is how that bug stayed invisible"; CLAUDE.md Gotcha on `font:` shorthand
- effort: S

##### 02-08 · P1 · Play-flow controls with no `:focus-visible`, no `:active`, or both
- where: shell.css:1260-1300 (`.ds-lobby-row`, DiscordLobbyList.tsx:124); shell.css:4178-4199 (`.ds-opt-del`, MatchSetup.tsx:343); styles.css:4099-4130 (`.ds-lan-url`, LanPanel.tsx:525,653); shell.css:1529 (`button.ds-chip`, Lobby copy-code at Lobby.tsx:927); shell.css:6121 (`.ds-queuechip` has no `:active`)
- what: these are interactive buttons that are missing from the shared focus-visible list at shell.css:1621-1634, and several lack `:active`/`:disabled` too. They fall back to the UA ring, which does not match the accent ring used everywhere else. `.ds-lobby-row` has no press state, and its hover moves it down 1px with no shadow to sink into.
- evidence: `rg "(ds-lobby-row|ds-opt-del|ds-lan-url|ds-queuebar|ds-chip)[^{]*:focus"` returns no matches.
- recommendation: add all five selectors to the shared `:focus-visible` block, and give each an `:active` that follows the keycap rule.
- contract: ui-standard §1.3 "Every interactive element has :hover, :active, :focus-visible and :disabled"
- effort: S

##### 02-09 · P1 · The auto-path tile is a `div role=button` with a nested `<button>`
- where: MatchSetup.tsx:333-357
- what: the saved-auto card is a focusable `div role="button"` that contains a real `<button>` (✕ delete). Nested interactive content breaks screen-reader naming, and a Space keypress on the div does not `preventDefault`, so the page scrolls. `.ds-opt:focus-visible` does apply, but the ✕ is a 22px target on the card's corner.
- evidence: code as cited; `.ds-opt-del` is 22×22 (shell.css:4183-4184).
- recommendation: make the card a `<button>` and put the delete as a sibling, positioned over the corner, outside the button. Raise the ✕ hit area to at least 24px (WCAG 2.5.8).
- contract: ui-standard §1.3; WCAG 4.1.2 / 2.5.8 (contract silent on nesting)
- effort: S

##### 02-10 · P1 · On mobile, the friends strip comes before the page's own Back
- where: shell.css:5122-5134 (`.ds-room-layout` column, `.ds-friends` `order: 1`); p6-mobile
- what: under the breakpoint, the Friends chip is the first thing on a room screen, above `← Back` and the page title, with a divider line between. The way out of the screen is the second control on it, and the first thing read is an unrelated social panel.
- evidence: p6-mobile light/dark: Friends at y≈26, Back at y≈98.
- recommendation: move friends to `order: 3` (after the console), or into the `.ds-head` row as a trailing icon button (the `.ds-head-spacer` slot already exists).
- contract: contract silent (hierarchy)
- effort: S

##### 02-11 · P2 · The /modes tile grid is ragged: 2, then 3, then 2
- where: ModeSelect.tsx:99-185; shell.css:1768-1772 (`auto-fit minmax(210px,1fr)`); p1-desktop
- what: auto-fit stretches each section to its own item count, so Practice tiles are 455px wide, Compete 298px and Custom 455px. Tile widths change from row to row and the column edges line up with nothing. At 1280 the page reads as three unrelated strips.
- evidence: p1-desktop, x-edges at 236/694/707 (row 1), 236/536/550/849/863 (row 2).
- recommendation: fix the track at `repeat(auto-fill, minmax(210px, 1fr))` (like `.ds-opts.fill`) so every section shares one 3-column rhythm, with Practice keeping an empty third slot. Alternatively, give Solo Practice a deliberate 2-column span.
- contract: design-guide §4.3 "spacing follows one rhythm"; ui-standard §6 option grid
- effort: S

##### 02-12 · P2 · "Solo Practice" filled accent reads as selected, not as the default
- where: ModeSelect.tsx:102; shell.css:1832-1847; p1 light/dark
- what: `.ds-tile.primary` is a solid accent block, the same visual vocabulary as a selected `.ds-opt.on` or the active rail item (p1: Play is mint and highlighted). On a page where nothing is being selected, the accent tile looks like a current choice. In dark mode it is the brightest object on screen and outweighs the h1.
- evidence: p1-dark, a mint #5fb597 tile next to a mint "Play" rail item.
- recommendation: keep primary emphasis through the `--ds-edge` keycap and an accent border, or an accent-ink title on the panel fill. Leave the solid fill to CTAs.
- contract: DESIGN.md Colors "accent … primary buttons, links, focus rings, active states"
- effort: S

##### 02-13 · P2 · The roster row carries a coloured left stripe on a rounded card
- where: shell.css:5486-5503 (`.ds-player { border-left: 3px solid … }`, `.red/.blue` tint it); Lobby.tsx:953
- what: each roster row has a 3px coloured left border on an 8px-rounded card. The same row already carries a filled RED/BLUE `.ds-chip` (Lobby.tsx:975), which is the contract's sanctioned alliance marker, so the stripe is redundant. It is also a border-width asymmetry.
- evidence: code as cited.
- recommendation: drop the stripe (1px `--ds-line` all round). The filled chip carries alliance.
- contract: design-guide §3 "Thick colored accent border on one side of a rounded card"; ui-standard §4 "Borders are 1px"
- effort: S

##### 02-14 · P2 · Matchmaking stacks four kinds of helper text in one panel
- where: Matchmaking.tsx:1092-1117 (searching) and 1126-1178 (idle)
- what: the searching state renders up to four blocks between the title and the buttons: a `.ds-hint` (widen), a `.ds-tip` card (tile fill, border, 12px/1.5), another `.ds-hint` (READY_WINDOW_NOTE), then `.ds-form-err`. Four text treatments for one screen's status. READY_WINDOW_NOTE is also repeated on the idle, found and searching states.
- evidence: code; `.ds-tip` styles.css:3137 vs `.ds-hint` shell.css:5322 (line-height 1.5 vs 1.45; ui-standard allows only 1.45 for prose).
- recommendation: one hint stack per state, with the queue tip folded into the hint. Show READY_WINDOW_NOTE on the idle screen only, where the decision is made. Set `.ds-tip` line-height to 1.45.
- contract: ui-standard §3 "Line height: 1 … 1.45 for prose. No other values"; §8
- effort: S

##### 02-15 · P2 · "Only my region ON/OFF": the state is written into the label
- where: Matchmaking.tsx:1157-1159
- what: a single `.ds-opt` whose label changes to "Only my region ON"/"OFF" while also taking the `.on` fill. ui.md names exactly this as the bad spelling, and it also changes the label width on toggle.
- evidence: code as cited.
- recommendation: `<ToggleRow label="Only my region" …/>` from OptRow.tsx, which also supplies `aria-pressed`.
- contract: docs/area/ui.md "ONE SPELLING OF A PICK: OptRow / ToggleRow … a single tile whose LABEL carried the state … is the bad one"
- effort: S

##### 02-16 · P2 · Lobby toggle picks have no `aria-pressed`
- where: Lobby.tsx:779-790, 997-1006, 1071-1082, 1177-1184; Matchmaking.tsx:1128-1133; LanPanel.tsx:482-493
- what: create/join, alliance, bot tier, robot and 1v1/2v2 picks carry `.on` for sighted users only. MatchSetup.tsx:209 does set `aria-pressed` on the identical RED/BLUE pair, so the two screens differ.
- evidence: `aria-pressed` appears in MatchSetup.tsx and in none of Lobby/Matchmaking/LanPanel.
- recommendation: add `aria-pressed={…}` to each, or route them through `OptRow`.
- contract: docs/area/ui.md OptRow note ("the aria-pressed fourteen hand-rolled toggles were missing")
- effort: S

##### 02-17 · P2 · Emoji and ornamental glyphs in lobby chips and buttons
- where: Lobby.tsx:971 (`🤖 BOT`), 973 (`★ HOST`), 943 (`⧉ Copy code`), 1012/1024 (`＋`/`－`, full-width forms), 1188 (`Edit build ✎`); RoleSwapBar.tsx:68 (`⇄`); DiscordLobbyList.tsx:145 (`+ Create`)
- what: a colour emoji inside a mono chip renders differently on every OS. The full-width ＋/－ were removed from Configure for the same reason ("the `＋` on the add cards are gone"). Discord uses an ASCII `+` for the same action, so even the plus sign has two spellings.
- evidence: code as cited.
- recommendation: plain text ("Bot", "Host", "Copy code", "Add a bot"), or one SVG icon set.
- contract: docs/area/ui.md Configure copy "No decorative glyph (… the `＋` on the add cards are gone)"
- effort: S

##### 02-18 · P2 · Hyphens standing in for em dashes in user-visible copy
- where: Lobby.tsx:1221 ("restarting shortly - starting is paused"); ChallengePicker.tsx:94 (aria-label "Play a friend - @user"); RoleSwapBar.tsx:14 and Lobby.tsx:965 (`'-'` placeholders)
- what: an ASCII dash joins two sentences. Matchmaking.tsx:1172 already words the same restart notice correctly ("Server is restarting shortly. Queueing is paused…"), so two screens phrase one event differently.
- evidence: code as cited.
- recommendation: "Server is restarting shortly. Starting is paused for a moment." Use "Play @user" for the aria-label and `—` for empty cells.
- contract: docs/area/ui.md UI COPY "PREFER A FULL STOP OR A COLON TO A DASH"
- effort: S

##### 02-19 · P2 · Discord lobby list: inline maxWidth, banned var fallback, loading/empty outside the list-state pattern
- where: DiscordLobbyList.tsx:78 (`style={{ maxWidth: 520 }}`), 115-118; shell.css:1265 (`border-radius: var(--ds-round-lg, 12px)`)
- what: (a) this re-types the width that `.ds-console-in.narrow` exists to own. (b) `var(--x, literal)` is banned, and the fallback is wrong anyway: 12 vs the token's 16px. (c) "Loading…" and "No other lobbies open." are bare `.ds-hint` lines rather than `.ds-loading` and `.ds-empty .big`, so the section jumps height when rows land.
- evidence: code as cited.
- recommendation: add `className="ds-console-in narrow"`, use `var(--ds-round)` (match `.ds-opt`), and use the `.ds-loading`/`.ds-empty` pair.
- contract: ui-standard §1.1 (no literal in JSX), §5 "No var(--token, #fallback)", §6 list states
- effort: S

##### 02-20 · P2 · Off-grid spacing throughout the play-flow rules
- where: shell.css:1759-1762 (`.ds-rejoin` gap 16, `margin: 2px 0 24px`, `padding: 14px 18px`), 1771 (`.ds-tiles` gap 14), 1781 (`.ds-tile` padding 16px 18px), 1824/1830 (`margin-top: 10px/3px`), 1854 (20px), 1863 (`0 0 10px 2px`), 1871 (28px), 3901-3904 (`26px 0 72px`, gap 22), 3910 (14), 4481 (`.ds-panelbox` gap 14), 5608 (`.ds-actions` gap 10), 5895-5897 (`.ds-roleswap` 10 / `8px 10px`)
- what: the screens in this lane account for a large share of the 143 off-grid gaps. 14/18/22/10/3/2/28/26 are all on the banned list, and together they are why p1's vertical rhythm (label→tiles 10, tiles→next label 20+4 shadow) and p6's panel (14 between every field) look slightly loose.
- evidence: uiaudit off-grid-gap 143; the live audit reports 68% 4px-grid adherence.
- recommendation: 14→12, 18→16, 22→24, 10→8/12, 3/2→4, 28/26→24. Lower the uiaudit baseline in the same commit.
- contract: ui-standard §2 "BANNED: 3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 18, 20px"
- effort: M

##### 02-21 · P2 · Off-scale type sizes in tiles and CTAs
- where: shell.css:1822 (`.ds-tile .t` 18px / 750), 5251 (`.ds-cta` 16px), 3946 (`.ds-head .ds-mark` 17px); p1 and p6
- what: the tile title (18), the CTA (16) and the console brand mark (17) sit between `--ds-t-lg` 15 and `--ds-t-xl` 20. The live audit's "one-off 17" is this mark.
- evidence: live audit, "cross-page drift incl. one-off font sizes 24/17".
- recommendation: tile title → `--ds-t-xl`, or `--ds-t-lg` with weight 800. CTA → `--ds-t-lg`. Mark → the bar mark's size.
- contract: ui-standard §3 "six sizes"
- effort: S

##### 02-22 · P3 · The tutorial offer borrows `.ds-rejoin` as its container
- where: ModeSelect.tsx:69,83; tutorial.css:145-170
- what: two banners with different meanings (you are mid-game with `role="alert"`, versus an optional first-run offer) share one accent-bordered style. If both show, they look identical, even though the rejoin one is urgent. The CLAUDE.md gotcha warns against two components sharing a container class.
- evidence: code as cited.
- recommendation: `.ds-banner` as the base, with `.ds-banner.urgent` for rejoin. Give the offer a quieter panel fill so the urgent banner outranks it.
- contract: CLAUDE.md Gotcha "TWO COMPONENTS MUST NOT SHARE A CONTAINER CLASS"
- effort: S

##### 02-23 · P3 · `.ds-hint-caption` is used but defined nowhere
- where: Matchmaking.tsx:1138
- what: the JSX comment there says the class makes the queue-depth line a caption of the mode picker, sitting tighter than the panelbox gap. No CSS rule matches it (`rg "ds-hint-caption" src/ui/*.css` returns nothing), so the line sits at the plain 14px gap, the exact placement the comment says was fixed.
- evidence: grep, zero matches.
- recommendation: add `.ds-panelbox > .ds-hint-caption { margin-top: calc(-1 * var(--ds-s-1)); }`, or delete the class and the comment.
- contract: contract silent (dead reference; same class of bug as the undefined `--ds-font`)
- effort: S

##### 02-24 · P3 · Title Case tile names
- where: ModeSelect.tsx:105,112,127,150,157,173,180,200; Matchmaking.tsx:986 ("Custom Rooms")
- what: "Host or Join", "Watch Live", "Find Match" are Title Case among sentence-case headings and buttons ("Pick a mode", "Start the tutorial"). "Host or Join" is plainly not a product name.
- evidence: p1.
- recommendation: sentence case ("Watch live", "Host or join"). Keep mode names that are real features only if they are treated as proper nouns everywhere.
- contract: docs/area/ui.md "Sentence case for ds-btn and every heading"
- effort: S

#### Strengths (keep)
- Disabled and offline tiles give a reason in text rather than silently greying out, and ModeSelect.tsx:130-138 records why the reason line is conditional, not reserved. The approach is right. Only the repetition needs fixing (02-04).
- QueueBar and QueueChip are well considered: the chip is anchored top on full-screen surfaces so it never covers the score bar, carries no one-tap cancel under a driving thumb, has an accessible name instead of a hover tooltip, and uses `--ds-hud-line` on the field.
- QueueCounts omits zero counts rather than printing "0 waiting", and scopes counts to the selected game from one shared poller.
- Alliance identity follows the contract: filled `.ds-chip.red/.blue` with fixed ink, `-ink` siblings for tinted text on `.ds-opt.red/.blue`, and `.ds-chip.off` receding through border and fill rather than opacity.
- Light/dark parity on p1 and p6 is solid. Every surface themes, the keycap edges hold in both, and contrast is all-pass.

### 03 — Robot builder · reviewed: src/ui/Menu.tsx, src/ui/RobotPreview.tsx, src/games/biobuzz/Builder.tsx (BbChassisMap), src/ui/OptRow.tsx, src/ui/StartPositionEditor.tsx (skim), src/ui/shell.css 2097-2112, 3714-3728, 3971-4080, 4083-4470, 4491-4585, 4591-5025, 5156-5226; styles.css 3386-3405 · screenshots p2 + p9, light + dark, desktop + mobile

Owner decisions respected (HANDOFF 2026-09-22e): the pinned top strip (105px budget, off under 1100), BbChassisMap replacing the mount pickers, the OFFSET™ sponsor label. Tensions with those are noted, not reversed.

##### 03-01 · P0 · Every builder slider is an 8px-tall hit target
- where: src/ui/shell.css:4527-4541 (the selector list opens with `input[type='range'].ds-range` itself, not only its track); shell.css:5215-5226; Menu.tsx:953, 1007, 1291-1375, 1462; Builder.tsx:515-619
- what: `height: 8px`, the border and the gradient apply to the INPUT element as well as to `::-webkit-slider-runnable-track`, so the input's box is 8px tall. Chromium hit-tests that box, so the 18px (26px on mobile) puck paints outside the area that takes pointer input. The mobile block's comment ("the slider PUCK is the target, not the 22px track") describes a track that no longer exists.
- evidence: live audit WARN `input.ds-range` 282x8 on the configure pages (evidence.md). A DECODE build has 6-7 of these sliders and a BIOBUZZ build has 6-8, all of them primary controls.
- recommendation: take the input out of the track selector. Give `input[type='range'].ds-range` `appearance: none; height: 24px` (32px under 640px) with a transparent background, and keep the 8px drawing on the pseudo-elements only. Fix the stale comment. Re-run shiftaudit, because the row height changes once.
- contract: WCAG 2.5.8 target size (accessibility floor); ui-standard §1.3 (the control must be operable)
- effort: S

##### 03-02 · P0 · Hand-rolled pick tiles have no `aria-pressed`, although OptRow exists to supply it
- where: Menu.tsx:938-946 (drivetrain), 797-859 (presets), 1033-1041, 1053-1074, 1083-1091, 1105-1116, 1126-1135, 1150-1175, 1199-1221, 1249-1261; Builder.tsx:368-377, 449-456, 484-505
- what: about fourteen mutually exclusive `.ds-opt` groups signal selection by fill colour alone. A screen reader hears a plain button with no state. docs/area/ui.md says every small enum in Configure goes through `OptRow`/`ToggleRow` precisely because 14 hand-rolled toggles lacked `aria-pressed`. The builder is the largest remaining pocket of them. BbChassisMap (Builder.tsx:246) is the one picker in the lane that sets it.
- evidence: grep for `aria-pressed` in Menu.tsx returns only the CosmeticSwatch (line 201).
- recommendation: route the label-only groups (drivetrain, DECODE intake, Flower scoring, intake mounts, CR mounts) through `OptRow` with `mini`. For the card groups that carry blurbs (presets, launcher, archetype, catalyst), add `aria-pressed={on}` in place.
- contract: docs/area/ui.md "ONE SPELLING OF A PICK: OptRow / ToggleRow"; WCAG 4.1.2
- effort: M

##### 03-03 · P0 · Saved-robot card is a `div role=button` with a real `<button>` nested inside it
- where: Menu.tsx:733-752; shell.css:4178-4199 (`.ds-opt-del`)
- what: interactive content is nested inside interactive content. The delete button is 22x22 (under the mobile size rules, which never enlarge it) and has no `:focus-visible` rule. It carries only `title`, so its accessible name is the glyph "✕". The card's keydown handler fires on Space without `preventDefault`, so pressing Space also scrolls the page.
- evidence: `.ds-opt-del` is missing from the shared focus-visible list at shell.css:1621-1637.
- recommendation: make the card a `<button>` sibling of the delete button inside a wrapper, give the delete button `aria-label="Delete {name}"`, add it to the focus-visible list, and give it a 32px minimum under 640px.
- contract: ui-standard §1.3 (`:focus-visible` is not optional); WCAG 4.1.2 / 2.5.8
- effort: S

##### 03-04 · P1 · On mobile the hero card fills the whole first screen and no build control is visible
- where: p2-mobile, p9-mobile (light + dark); shell.css:4591-4600, 4829-4862, 5156-5159
- what: under 1100px `.ds-hero` falls back to the old stacked card: a roughly 190px sprite box over a 2-column grid of two-line `.ds-stat` tiles with offset shadows. At 375px the fold holds the page title, the sprite and three rows of stat tiles. The first preset card sits below it, and nine tiles plus the name make the card about 700px tall. This is the "26% of the viewport" failure HANDOFF describes, carried down to the width where it hurts most.
- evidence: p2-mobile shows the hero from y≈360 to beyond 812 with only 6 of 9 stats visible. p9-mobile is the same.
- recommendation: reuse the one-line chip treatment (the `.ds-hero .ds-stat` rules at 4982-5008) at every width, not only in the ≥1100 block. Cap the sprite box at 120px on phones. The owner ruling covers the desktop strip; this is its missing narrow case.
- contract: docs/area/ui.md "THE ROBOT PREVIEW STAYS ON SCREEN, AT THE TOP … The budget is 105px" (the mobile card has no budget); contract silent on phones specifically
- effort: S

##### 03-05 · P1 · Two field-label systems in one form: mono uppercase `.ds-subh` vs sentence-case `.cap`
- where: Menu.tsx:936, 999, 1080, 1124, 1285; Builder.tsx:365, 447, 479, 509; shell.css:4072-4080 vs 4508-4515; p2/p9 desktop ("DRIVETRAIN" under "Robot name / Team name / Team #")
- what: the Build panel mixes 10px tracked mono UPPERCASE subheads (DRIVETRAIN, LAUNCHER, FRAME) with 12px sentence-case captions (Robot name, Drive RPM, Turret position). Under a panel title that is itself 12px mono uppercase (START FROM, BUILD), the subhead reads as a smaller copy of the panel title. 10px is also off the type scale (xs = 11), and the `margin: 4px 0 -4px` negative margin fights the parent gap.
- evidence: shell.css:4074 `font-size: 10px`; 4079 negative margin. Visible on p2 at y=863.
- recommendation: choose one. Either make `.ds-subh` sentence-case `--ds-t-md` 700 ink (a group heading, one level above `.cap`), or keep mono but at `--ds-t-xs` with no negative margin. Remove the margin and let `.stack` own the gap.
- contract: ui-standard §3 (six sizes; 10px not on the scale), §2 ("One owner per gap"), §6 Panel title "sentence case"
- effort: S

##### 03-06 · P1 · Panel titles are ALL CAPS mono, against the "sentence case" anatomy rule
- where: shell.css:2106-2112; Menu.tsx:720, 872, 1393, 1409; p2/p9 "START FROM", "BUILD"
- what: ui-standard §6 says a panel title is a short noun phrase in sentence case. docs/area/ui.md limits ALL CAPS to four places (overlay buttons, HUD chips, ds-cta, admin), and `.ds-panel-title` is not one of them. The JSX strings are already sentence case, so only the CSS makes them uppercase. Combined with 03-05, the builder has three tiers of mono uppercase labels (panel title, subh, `.oz` chip, plus stat `.sl`), which is the "repeated uppercase kickers" tell in design-guide §3.
- evidence: `text-transform: uppercase` at shell.css:2110.
- recommendation: this is app-wide, so raise it for the owner rather than patching the builder: either amend §6 to allow the mono eyebrow panel title, or drop the transform. The builder is where the stacking is worst.
- contract: ui-standard §6; docs/area/ui.md UI COPY "Sentence case … ALL CAPS is correct in exactly four places"; design-guide §3 "repeated uppercase kickers"
- effort: S (CSS) / owner call

##### 03-07 · P1 · DECODE and BIOBUZZ previews are two different visual idioms in the same slot
- where: p2 vs p9 (all four); RobotPreview.tsx:110-115; shell.css:4604-4627, 4911-4922
- what: DECODE draws a dark field-mat canvas tile with a green outline and the dimension caption burned INTO the bitmap. BIOBUZZ draws a light line schematic on the themed tile with an HTML caption under it, plus a 2D/3D segmented control beside it. In dark mode (p9-mobile dark) the BIOBUZZ schematic is a pale plate on a dark hero, while DECODE's stays canvas-dark. Moving between seasons changes what "the robot" looks like on the same screen.
- evidence: the DECODE sprite is a boxed dark square at 88px; the BIOBUZZ sprite is an unboxed light drawing at 88px.
- recommendation: settle on one frame, either both on the category-3 dark mat (DESIGN.md three-zone rule: a robot drawing belongs to the canvas zone) or both schematic. Captions go outside the bitmap in both cases (see 03-08).
- contract: design-guide §4.3 "One decision, everywhere"; DESIGN.md Three-Zone Rule
- effort: M

##### 03-08 · P1 · The DECODE sprite's dimension label renders at about 6px, illegible
- where: RobotPreview.tsx:12, 110-115 (`DIM_FONT = 11` on a 160px canvas); shell.css:4918-4922 (scaled to 88px); p2-desktop hero
- what: the strip scales a 160px bitmap to 88px (×0.55), so 11px canvas text lands at about 6px, and it is pixel-rendered into the image. The desktop screenshot shows an unreadable smudge at the bottom of the sprite. It is also invisible to assistive technology.
- evidence: p2-desktop at x≈490, y≈270.
- recommendation: drop the caption from the canvas when size < ~120 and show the dimensions as an HTML chip (`Size 16.5 × 14.5"`) in `.ds-stats`, which also gives BIOBUZZ parity. Alternatively, render the canvas at 88px device size so text is not downscaled.
- contract: ui-standard §3 (no size below 11px); WCAG 1.4.4
- effort: S

##### 03-09 · P1 · Hero stat chips use body-font numbers in places and word values next to numbers, all at the same weight
- where: Menu.tsx:627-708; shell.css:4837-4839, 4995-4997; p9 hero ("No box tube FLOWER SCORING", "Single turret LAUNCHER · CENTER")
- what: the strip gives numbers (94 IN/S TOP) and words (Mecanum DRIVETRAIN, No box tube) the same chip shape. On BIOBUZZ the word chips fill a whole fourth row. A negative ("No box tube") gets a chip as loud as a stat, and the caption after it is in UPPERCASE mono, so the chip reads "No box tube FLOWER SCORING", which parses as a sentence. The DECODE summary also says "Sloped INTAKE" but omits the sorter unless it is on.
- evidence: p9-desktop hero rows at y=244 and 267.
- recommendation: split the strip into numeric telemetry chips and one plain `buildSummary` sentence (the same `labels.configSummary` the saved card and leaderboard use) under the name, in place of the team line when it would read "No team". That removes a row and puts every game on one vocabulary.
- contract: DESIGN.md Digits-Are-Mono (numbers only); design-guide §3 "Big-number metric + small label ×N"
- effort: M

##### 03-10 · P1 · "Accent inset left edge" on real-robot preset cards is the one-side accent border tell
- where: shell.css:4162-4164 (`.ds-opt.real`); Menu.tsx:803-805; p9 StarterBot card (thick green left edge, light + dark)
- what: a 3px coloured inset on the left of a rounded card is design-guide §3's first "structure" tell, verbatim. On BIOBUZZ only one card has it, so it reads as a selection or an error highlight. The fill colour is `--ds-accent` and the selected state is also accent. With no legend on screen, nobody can decode "real robot vs archetype" from it.
- evidence: p9-desktop StarterBot at x=466-470. DECODE shows no `.real` cards at all, so the mark exists in one season.
- recommendation: replace it with words. The card's `.od` line already has room for "Real robot · Kit" (StarterBot's sub-line says "Kit robot"), or add a trailing `.oz` chip "Real robot". Then delete `.ds-opt.real`.
- contract: design-guide §3 "Thick colored accent border on one side of a rounded card"; ui-standard §1.5 (a control explains itself)
- effort: S

##### 03-11 · P1 · Preset cards: zone chips wrap to two lines inside a pill, and card heights drift per row
- where: shell.css:4376-4388 (`.oz`: radius-full, 10px uppercase, no nowrap); p9 Pollinator card ("SINGLE TURRET · OFFSET™ BOX TUBE · BACK" on two lines); p2 row 2 (Rohan card has 16px of dead space under Ditto's two-line team name)
- what: a pill with two text lines becomes a lozenge. The BIOBUZZ `zone` string is a full loadout, not a zone. `.oz` also uses 10px (off scale) and `margin-top: 3px` (banned value). The option-grid rule says tiles are the same height whether or not they have a sub-line. Rows equalise through grid stretch, but content floats top-aligned, so chips sit at different y positions across one row (p9 row 1: chips at y=490 vs 506 vs 506).
- evidence: screenshots as cited; shell.css:4377-4380.
- recommendation: make `.oz` `white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis`, set 11px, and use `margin-top: auto` so chips bottom-align across a row. Keep the BIOBUZZ zone to the launcher only and move mounts into `.om`. The OFFSET™ string is a sponsor term (labels.ts:85-98), so keep it and let the ellipsis or the `.om` line carry it.
- contract: ui-standard §6 Option grid; §2 banned 3px; §3 scale
- effort: S

##### 03-12 · P1 · Drivetrain row uses `.ds-opts.five` chips while every other small enum in the builder uses a different size
- where: Menu.tsx:937-946 (`.five` + `.mini`, centred); Menu.tsx:1082-1091 (DECODE intake: full `.ds-opt` 62px floor, left-aligned, 200px auto-fit); Builder.tsx:448-456 (Flower scoring: full-height `.two`, no sub-line); Builder.tsx:495-505 (`.four` mini, left-aligned via 4167-4170); OptRow `mini` for Drive style
- what: four spellings of "pick one label" appear in one panel: centred mini, left mini, 62px left slab, and a two-up slab. The Intake row of three 62px slabs with no sub-line sits directly under the 36px drivetrain chips. The comment at shell.css:4165 still calls `.four` "the drivetrain grid", which is no longer true (the drivetrain uses `.five`).
- evidence: the code cited. The drivetrain row is cut off at the bottom of p2/p9 but visibly chip-height.
- recommendation: every label-only pick goes through `OptRow mini` (see 03-02), which fixes the size and the aria state in one move. Correct the stale comment.
- contract: docs/area/ui.md "ONE SPELLING OF A PICK"; ui-standard §4 "two buttons in the same row may not [differ]"
- effort: S

##### 03-13 · P2 · Hero background is a gradient, and the preview box adds a radial accent glow
- where: shell.css:4597 (`linear-gradient(160deg, tile, panel)`), 4612-4614 (radial accent 8%); p2/p9 light hero (left bright, right grey)
- what: every other panel is flat `--ds-panel`. The hero is the one surface with a gradient fill plus a glow behind the sprite. That is decorative and reads as the "hero glow" tell. It also makes the pinned strip look different from the panels it scrolls over. In dark mode the gradient is nearly invisible, so the two themes do not match.
- evidence: p2-desktop light, hero right side visibly greyer than the left.
- recommendation: flat `--ds-panel` and flat `--ds-bg` for the view box.
- contract: DESIGN.md "Flat by default"; design-guide §3 gradients
- effort: S

##### 03-14 · P2 · Nested cards: stat tiles and sprite box inside the hero card, cards inside the Start-from panel
- where: shell.css:4840-4846 (`.ds-stat` border + block shadow on the mobile/narrow card), 4609-4618; p2-mobile / p9-mobile
- what: on narrow widths there are three levels of boxed surface with offset shadows: hero card > sprite box > nine shadowed stat tiles. The desktop strip already removes the tile shadow ("nine offset shadows … is noise", 4992). That reasoning applies equally below 1100.
- evidence: p2-mobile stat tiles each have `--ds-block-sm`.
- recommendation: fold into 03-04. Use chips at all widths and no tile shadow.
- contract: design-guide §3 "Nested cards"
- effort: S

##### 03-15 · P2 · Off-scale values and literal geometry concentrated in builder CSS
- where: shell.css:3975 (`margin-top: 18px`), 4074 (10px), 4086 (gap 12 ok) / 4493 (`gap: 18px`), 4591-4599 (gap 18, padding 18), 4803 (24px, one-off size), 4810/4380 (10px), 4817 (`margin-left: 10px`), 4844 (`8px 10px`), 4850 (16px), 4861 (1px margin), 4186 (radius 6px); styles.css:3386-3390 (gap 6, radius 7)
- what: the builder carries a large share of the ratchet debt. 18px and 10px are explicitly banned, and 24px/16px/10px are off the type scale (the audit's "one-off font sizes 24/17" WARN includes the hero name at 24px on narrow widths).
- evidence: evidence.md uiaudit counts (off-grid-gap 143, off-scale-font-size 45, literal-radius 12).
- recommendation: one sweep: 18→`--ds-s-4`, 10→8/12 per §2, hero name → `--ds-t-xl`, 10px labels → `--ds-t-xs`, radius 6/7 → `--ds-round-sm`/`--ds-round`. Lower the baselines afterwards.
- contract: ui-standard §2, §3, §4
- effort: S

##### 03-16 · P2 · Cosmetic swatches live in the in-match stylesheet, with no focus ring token and an opacity-dimmed lock
- where: styles.css:3386-3405; Menu.tsx:174-208
- what: `.chassis-sw` is shell UI declared in styles.css (a split namespace, per ui-standard §10). It has no `:focus-visible`, so it falls back to the UA ring while every other control has the accent outline. Locked swatches use `opacity: 0.4`, while the BbChassisMap in the same page deliberately uses dashed + muted "not an opacity fade". The selected ring `0 0 0 2px var(--ds-ink)` is a third selection language beside `.ds-opt.on` mint and `.bb-cell.on` solid accent.
- evidence: code cited.
- recommendation: move to shell.css, add to the focus-visible list at 1621, use the dashed-edge treatment plus a small lock glyph for locked, and use an accent ring for selected.
- contract: ui-standard §1.3, §10; DESIGN.md chips "not opacity-fade"
- effort: S

##### 03-17 · P2 · Three selection vocabularies on one page
- where: shell.css:4226-4231 (`.ds-opt.on` accent-soft fill), 4748-4752 (`.bb-cell.on` solid accent + accent-ink), styles.css:3399 (swatch ink ring); p9 hero 2D/3D segment (solid accent)
- what: "selected" is soft mint on option cards, solid green on chassis-map cells and the 2D/3D toggle, and a black ring on swatches. On BIOBUZZ all three appear within one scroll.
- evidence: code cited; p9 2D chip is solid accent while the Robot sub-nav and option tiles use soft mint.
- recommendation: pick soft-mint `.on` for all pick controls (`.bb-cell.on` → accent-soft + accent-edge shadow, the same as `.ds-opt.on`). Swatches keep a ring, but in accent.
- contract: design-guide §4.3 "the same button is the same button"
- effort: S

##### 03-18 · P2 · Chassis-map captions and labels mix case and put game nouns in caps inside sentence-case captions
- where: Builder.tsx:404, 412 ("POLLEN turret", "NECTAR turret"), 119-121 titles; Menu.tsx:444-452 (`F·LEFT`, `B·RIGHT`), 1173 ("FIXED", "SWING ↕"); p9 preset `.om` lines ("FRONT sweeper", "FRONT+BACK")
- what: game element names are uppercase by house rule (POLLEN, NECTAR, FLOWER), but mount positions ("FRONT sweeper") and states ("FIXED") are not game elements, and they appear uppercase inside sentence-case lines. The CR swing tiles read "FIXED / SWING ↕" while every neighbour is sentence case.
- evidence: p9 preset cards: "Tank · 18 lb · 286 rpm · FRONT sweeper".
- recommendation: sentence-case the positions and states ("Front sweeper", "Fixed", "Swing ↕"). Keep POLLEN/NECTAR/FLOWER in caps.
- contract: docs/area/ui.md UI COPY "Sentence case for ds-btn and every heading"
- effort: S

##### 03-19 · P2 · Disabled chassis-map and catalyst cells explain themselves only through `title`
- where: Builder.tsx:237-245; Menu.tsx:1199-1218
- what: the reason a cell is blocked ("Too close to the NECTAR turret", "The shooter is mounted here") exists only in the `title` attribute of a `disabled` button. Disabled buttons do not receive hover on many browsers, never get focus, and have no title on touch. So on a phone, and for keyboard users, the reason is unreachable. HANDOFF records this pattern as intended, so this is a tension with that choice rather than a reversal.
- evidence: CSS comment 4756-4758 admits "the `title` on a disabled cell is the only place the reason lives".
- recommendation: use `aria-disabled="true"` (still focusable) with the reason in `aria-describedby`, or a single status line under the map ("Centre: a double turret neighbours every cell") updated on tap or focus.
- contract: ui-standard §1.5; WCAG 1.3.1 / 4.1.2
- effort: M

##### 03-20 · P2 · Build panel's identity inputs look disabled in light mode, and empty fields have no placeholder
- where: shell.css:3714-3722 (`background: var(--ds-tile)`); p2/p9 light "Team name" / "Team #" (grey filled boxes)
- what: in light mode a recessed tile-grey input with no text reads as a disabled field, most visibly for the empty Team name and Team #. In dark mode the same inputs read as editable. The hero also says "No team", so an empty field and a status line say the same thing twice.
- evidence: p2-desktop light vs dark at y=810-845.
- recommendation: short example placeholders ("Team name", "12345") in `--ds-mut`, or `--ds-panel` fill with the inset kept. This is an app-wide token call, so flag it to the forms lane.
- contract: DESIGN.md Inputs (recessed, not disabled-looking); contract silent on placeholders
- effort: S

##### 03-21 · P2 · Gap rhythm between builder panels is uneven
- where: p2 desktop (hero→Start from ≈24px, Start from→Build ≈40px); p9 same; shell.css:3974 (`gap: --ds-s-5`) plus `.ds-panel` margins
- what: the stack gap is 24px, yet the Start-from and Build panels are about 40px apart, so something (likely a `.ds-panel + .ds-panel` margin or the sticky strip's box) adds a second owner of the gap. The Build panel reads as detached from the presets.
- evidence: screenshot pixel measurement (Start-from bottom y≈679, Build top y≈719).
- recommendation: find the extra margin and let `.ds-robot`'s gap own it (one owner per gap).
- contract: ui-standard §2 "One owner per gap"
- effort: S

##### 03-22 · P2 · BIOBUZZ hero reports DECODE-model numbers
- where: Menu.tsx:541, 645 (`driveParams(spec)`, `spec.massLb`); p9 hero (23.5 lb, 94 in/s, 16.5×14.5 caption, identical to p2 DECODE)
- what: on a fresh session the BIOBUZZ strip shows exactly DECODE's stats and size, while HANDOFF says the BIOBUZZ default is 21×17 at 24.5 lb (Pollinator). Either the fresh BIOBUZZ spec is not the module default, or the hero reads the shared model. Unverified from here, but the screenshots show identical values across seasons, which a user would read as the builder not updating.
- evidence: p2 vs p9 hero chips byte-identical for the first six stats.
- recommendation: confirm which spec the audit session held. If it is the default, have the hero read the module's resolvers (the `bbMassLimits`/`bbDials` path) the way `statTiles` does.
- contract: contract silent (correctness)
- effort: S (investigate)

##### 03-23 · P3 · `Start from` panel contains a single caption "Presets" when no robots are saved
- where: Menu.tsx:793-795; p2/p9 "Presets" line under START FROM
- what: with nothing saved the panel is title "Start from", then caption "Presets", then cards, which is two labels for one group. The caption only earns its place once "Your robots" appears above it.
- recommendation: render the "Presets" cap only when `savedRobots.length > 0`.
- contract: ui-standard §8 (descriptions are deleted)
- effort: S

##### 03-24 · P3 · "CUSTOM" badge is shouting and appears on a fresh default robot
- where: Menu.tsx:620; shell.css:4808-4819 (10px mono uppercase, `margin-left: 10px`); p2/p9 hero
- what: the untouched default build is flagged CUSTOM on both seasons, because the default does not equal a preset. A solid accent pill beside the name competes with the name, and it is the third accent-filled element in the strip.
- recommendation: show it only when the build diverges from a preset the player loaded, and use the outline `.ds-chip` style at `--ds-t-xs`.
- contract: ui-standard §3 (10px); §2 (10px margin)
- effort: S

##### 03-25 · P3 · Stale comments misdescribe current CSS
- where: shell.css:4165-4166 (`.four` "the only … drivetrain grid"), 5215 ("22px track"), 4836 ("128px tile"), 4124-4126 (`.ds-panelbox` as the ground; the builder uses `.ds-panel`)
- what: the house style leans on comments as the specification, so a wrong comment misleads the next edit (03-01 exists partly because the "22px track" comment made the target look solved).
- recommendation: correct them in the same sweep as 03-15.
- contract: contract silent
- effort: S

#### Strengths (keep)
- BbChassisMap (Builder.tsx:184-257, shell.css:4673-4774): a picture instead of nine words, front-up and robot-left-on-screen-left, mechanisms drawn in place, `aria-pressed`, 44px cells, dashed rather than faded for taken cells, a `:focus-visible` rule, and transform-only press. This is the best control in the lane. Extend it to the CR mount pickers still using a bare 3x3 of `.ds-opt.mini` (Menu.tsx:1052-1062, 1179-1224, 1248-1263).
- The desktop pinned strip holds its 96-105px budget in both games and both themes (p2/p9 desktop), and chips scroll rather than grow the card. The height reasoning is written down where the next editor will read it.
- Build order (mechanisms first, Frame last because everything clamps it) and sliders whose envelopes come from the same limit functions as the coercer, so the UI never offers an illegal value.
- `ToggleRow`/`OptRow` in the Driving panel: sentence-case labels, no restating sub-lines, no key names.
- Light/dark parity of the form body is good (p2/p9 dark): borders on `--ds-line-strong`, the `.on .od` ink swapped to `--ds-accent-soft-mut`, alliance tints using the `-ink` siblings.
- Cosmetics shown to everyone with locked options disabled and a concrete earn hint (`EARN_HINT`), which is the honest design.

### 04 · Configure settings sections — reviewed: src/ui/Configure.tsx, ControlsSection.tsx, controlsLayout.ts, GraphicsSection.tsx, AudioSection.tsx, NetworkSection.tsx, OptRow.tsx, Select.tsx, rangeFill.ts, Appearance.tsx (skimmed; it is Profile, not Configure), shell.css (.ds-range, .ds-subnav*, .ds-seg*, .ds-key*, .ds-bind-*, .ds-field, .ds-opt*, .ds-panel-title); styles.css:1355. Screenshots p3 + p2, light/dark, desktop/mobile.

##### 04-01 · P0 · Every `.ds-range` slider renders the browser's native blue thumb on an 8px-tall input; the custom puck and the mobile touch-target bump do nothing
- where: src/ui/shell.css:4527-4553 (and 4567), 5216-5225; audit-light/p3-desktop.png and audit-dark/p3-desktop.png (Stick deadzone, Sensitivity curve)
- what: The base rule for the input is gone. `input[type='range'].ds-range,` is now the first selector of the **track** rule, so the input itself gets `height: 8px`, the gradient and the border, but never `appearance: none`. In Chromium, `::-webkit-slider-thumb { -webkit-appearance: none }` only takes effect when the host input is also `appearance: none`, so the styled 18px accent puck is ignored and the UA's default blue thumb (#0075ff-ish) is drawn instead. That thumb is off-palette in both themes and sits on the Driver-Green fill. The ≤640px rule that grows the puck to 26px ("the slider PUCK is the target", 5215) is dead for the same reason, so on a phone the hit target is the native ~16px thumb on an 8px box.
- evidence: Both p3 desktop shots show a saturated blue circle on a green track. The live audit reports `input.ds-range` at 282x8 on mobile, below the 24px floor. `git show 23906fe:src/ui/shell.css` has the missing block: `input[type='range'].ds-range, .ds-bind-row input[type='range'], .ds-replay-seek { width:100%; appearance:none; -webkit-appearance:none; background:transparent; height:22px }`. Only `.ds-replay-seek` kept its copy (shell.css:2937-2945). Every Configure and builder slider is affected: Audio, Graphics, Controls, and the 13 in Menu.tsx.
- recommendation: Restore a standalone `input[type='range'].ds-range { width:100%; appearance:none; -webkit-appearance:none; background:transparent; height:22px; cursor:pointer }` and take the input out of the track selector list. Add `.ds-range` to shiftaudit/uiaudit, or add a smoke screenshot assertion, so a lost `appearance` gets caught.
- contract: WCAG 2.5.8 target size (accessibility floor). DESIGN.md "Driver Green … focus rings, active states" (the thumb is off-palette). shell.css:4522 comment "large circular puck"
- effort: S

##### 04-02 · P1 · Arming a keycap changes its width ("W" → "PRESS…") and pushes its row-mates sideways
- where: src/ui/ControlsSection.tsx:386-407, 436; shell.css:5411-5427 (`.ds-keys` justify-end, `.ds-key` min-width 34px)
- what: A capture swaps the label for `PRESS…`, or `RT + …` for a pad chord. At 12px/700 mono plus 20px padding that is about 70px, against a 34px cap. `.ds-keys` is `justify-content:flex-end`, so every keycap to the LEFT of the armed one moves, and a long row (Intake: 3 caps + Sync) can wrap to a second line mid-capture.
- evidence: `activeLabel = 'PRESS…'` and `.ds-key { min-width: 34px }`. shiftaudit forces only `:hover`, `:active`, `.on` and `.primary`, not `.capturing`, which is why this was never caught.
- recommendation: Keep the cap's box constant while it captures. Either reserve the width (`min-width` sized for "PRESS…"), or keep the bound label and show the armed state with the existing pulse, the accent ring and a single glyph. Add `.capturing` to shiftaudit's forced classes.
- contract: ui-standard §1.4 "No state change may move layout … Pressed, hovered, selected, loading…"
- effort: S

##### 04-03 · P1 · "Reset to defaults" wipes every binding, per-game overrides included, in one click with no confirm
- where: src/ui/ControlsSection.tsx:704-722
- what: `onChange(cloneBindings(DEFAULT_BINDINGS))` runs straight from a plain `.ds-btn`. It discards all keyboard, pad, combo and `perGame` binds, and the settings blob syncs to the account, so the loss reaches every device. `Reset <season>` behaves the same way.
- evidence: There is no dialog and no undo. It is styled like any neutral button, sitting beside no other action.
- recommendation: Confirm with a dialog that names the target and effect ("Reset all controls? Your keyboard and gamepad binds for every game go back to defaults."), put the destructive button in `danger` style, or give a one-shot Undo in the existing status line.
- contract: ui-standard §6 Dialog "Destructive actions are `danger` and confirm; a confirm must name the target and the effect."
- effort: S

##### 04-04 · P1 · Four different "selected" treatments on one screen, and the sub-nav's active pill copies the app rail's
- where: shell.css:710 (`.ds-rail-btn.on`), 1441 (`.ds-subnav-btn.on`), 2183 (`.ds-seg.on`), `.ds-opt.on` (4127ff); p3-desktop both themes
- what: The Controls page has four selected states. Rail "Configure" is soft mint with an edge and block shadow. Sub-nav "Controls" is soft mint with a 1px accent border. Scope "All games" is a solid dark-green fill. Drive stick "Left" is soft mint with a block shadow. The rail and sub-nav pills sit in adjacent columns and read as the same level, so it is not obvious which column is primary navigation. The solid `.ds-seg.on` is the heaviest mark on the page, and it belongs to the least important choice.
- evidence: In the p3 desktop screenshot, three mint pills stack left to right at y≈200 plus a solid green chip at y≈174. The same happens in dark.
- recommendation: Pick one "you are here" treatment for navigation, used by both rail and sub-nav. The sub-nav could drop the fill and use accent ink plus a left edge or underline, one step quieter than the rail. Keep the fill for form picks (`.ds-opt`, `.ds-seg`). Record the rule in DESIGN.md Components.
- contract: design-guide §4.3 "the same button is the same button on every page". DESIGN.md is silent on nav selected state.
- effort: M

##### 04-05 · P1 · On mobile the section sub-nav is a horizontal scroller that clips "Audio and Visual" and hides Graphics and Network
- where: shell.css:5144-5153; audit-light/p3-mobile.png, audit-dark/p2-mobile.png
- what: Below the breakpoint `.ds-subnav` becomes `flex-direction:row; overflow-x:auto`. At 375px it shows Robot, Controls, Match and "Audio and…" cut mid-word. Graphics and Network are off-screen with no fade or chevron, apart from a desktop-style scrollbar.
- evidence: The file argues against this pattern for `.ds-segs` at shell.css:2142-2147: "a horizontal scroller hides options from somebody who does not know the set is six". This sub-nav also has six entries.
- recommendation: Apply the same fix as `.ds-segs.even`: a 3x2 or 2x3 grid (`repeat(auto-fit,minmax(100px,1fr))`), or a native `<select>` for the section on phones. Do not leave a clipped scroller.
- contract: The repo's own ruling at shell.css:2139-2150. ui-standard is silent on mobile nav.
- effort: S

##### 04-06 · P1 · Panel titles are the weakest text on the page, are not headings, and stack with more uppercase kickers
- where: shell.css:2106-2112 (`.ds-panel-title` 12px mono uppercase `--ds-mut`), 5388-5395 (`.ds-bind-col > h3` 11px uppercase); ControlsSection.tsx:509-528; p3/p2 desktop
- what: "DRIVING", "TOUCH CONTROLS" and "START FROM" are 12px muted tracked caps. They are smaller and fainter than the 13px ink-dim row labels they head, so the hierarchy runs backwards. Directly under them sit "KEYBOARD"/"GAMEPAD" (and "DRIVETRAIN" on p2) in the same kicker style, which makes a kicker-on-kicker stack. The title is a `<span>` while the column heads are `<h3>`, which produces the audit's h1→h3 skip and leaves the page with no h2.
- evidence: The live audit warns about the heading skip on configure. The p3 screenshot shows the panel title and column head nearly identical in weight.
- recommendation: Render panel titles as `<h2>` in sentence case, ink, at `--ds-t-lg` 15px/700 in the UI font. Keep a single mono kicker level, for the column heads only. This is one CSS rule and a tag swap across the `ds-panel-title` sites.
- contract: ui-standard §6 Panel "title is a short noun phrase, sentence case" (text-transform overrides it). design-guide §3 "repeated uppercase kickers" tell. WCAG 1.3.1 heading structure.
- effort: M

##### 04-07 · P1 · Two label styles and three control heights inside the Driving panel's gamepad column
- where: shell.css:4508-4514 (`.ds-field > .cap` 12px `--ds-mut`, label above) vs 5400-5410 (`.ds-bind-label` 13px `--ds-ink-dim`, label left); p3-desktop right column
- what: "Stick deadzone" and "Sensitivity curve" are 12px grey captions above full-width sliders. "Swap wheel set", "Flip front" and "Park mode" directly below are 13px darker labels to the left of keycaps. "Drive stick" uses the caption style over 38px `.ds-opt` tiles with block shadows. The column reads as three forms glued together, and the tall tiles outweigh the keycaps they share the column with.
- evidence: In the p3 desktop screenshot the label size and colour visibly change between y=615 and y=662.
- recommendation: Give `.ds-field > .cap` and `.ds-bind-label` one label token (13px ink-dim). Use `mini` tiles for the stick choice, since `OptRow` already has the prop, so it sits near keycap height. Or move the stick and slider group into its own sub-block with a divider.
- contract: ui-standard §6 Row "label left, value right … Values in one column share an alignment and a format."
- effort: S

##### 04-08 · P2 · Read-only values are painted in the link/action accent
- where: shell.css:4516-4521 (`.ds-field > .cap .val { color: var(--ds-accent) }`); OptRow.tsx:78 (hint rendered as `.val`); p3 "12%", "1.0 · linear", "right stick turns"
- what: Every slider readout and every OptRow hint is accent green, including "right stick turns", which is prose rather than a value. In this system accent means "you can press this", so the readouts look like links, and a mono-green prose hint breaks the Digits-Are-Mono split.
- evidence: DESIGN.md: accent is for "primary buttons, links, focus rings, active states".
- recommendation: Give `.val` `--ds-ink` in mono with tabular numerals. Render a prose `hint` in `--ds-mut` in the UI font, not through `.val`.
- contract: DESIGN.md Colors › Primary. The Digits-Are-Mono Rule.
- effort: S

##### 04-09 · P2 · "Touch controls" and "Tutorial" are two head-only cards, one button each, a section gap apart
- where: ControlsSection.tsx:631-652; shell.css:2113 (`.ds-panel > .ds-panel-h:last-child` exists just for this); p3 both widths
- what: Two full cards with shadows, 24px apart, each holding one label and one button. On desktop they take about 160px above the fold before the first bind, and the uppercase title/button pairing reads like placeholder scaffolding.
- evidence: A dedicated CSS rule was written to make a "panel that is only its head" look right.
- recommendation: Put both in one panel as two rows (`label · button`), or a single row of two `ds-btn`s under the scope switch. Keep the owner's "touch first" order.
- contract: design-guide §3 "Nested/identical cards → flatten". ui-standard §6 Panel anatomy (a panel has a body).
- effort: S

##### 04-10 · P2 · GraphicsSection hand-rolls `.ds-opt` pickers outside `OptRow`, and uses `.on`/`aria-pressed` to mean "capturing"
- where: src/ui/GraphicsSection.tsx:374-381 (height unit), 584-598 (Custom buttons)
- what: The unit toggle is a hand-copied two-tile row, which is the thing `OptRow` exists to prevent. The Custom-buttons grid lights `.on` (the accent "selected" fill) and sets `aria-pressed=true` while a tile is waiting for a mouse button, so "armed" looks and announces exactly like "chosen". At GraphicsSection.tsx:206-207 a `.ds-field` div wraps a `label.ds-field`, which nests the flex column rules.
- evidence: area/ui.md: "ONE SPELLING OF A PICK … Every boolean and small enum in Configure goes through this component."
- recommendation: Route the unit row through `OptRow`. For capture, reuse the `.ds-key.capturing` language (pulse plus accent ring) and drop `aria-pressed`. Remove the outer wrapper at 206.
- contract: docs/area/ui.md Configure rule 1. ui-standard §6.
- effort: S

##### 04-11 · P2 · Arrow-key caps are tiny glyphs that a screen reader reads as "black left-pointing pointer"
- where: src/input/bindings.ts:1227-1230; p3 "Turn left/right", "Tank: right side forward/back"
- what: `◄ ► ▲ ▼` at 12px mono render at roughly 5px, visibly smaller than the letter caps beside them. As the button's accessible name they are announced by their Unicode names.
- evidence: The p3 screenshot shows the caps at y=656-764. The keycap has no `aria-label`, only the row group label.
- recommendation: Either draw an SVG arrow sized to cap-height, or use `←→↑↓` at the ink size. Give each keycap `aria-label={keyName}` ("Left arrow"). The keyboard keycaps also lack a "press to rebind" name, which the pad Menu cap has (ControlsSection.tsx:573).
- contract: WCAG 1.1.1/4.1.2 (name). DESIGN.md "keycap" component.
- effort: S

##### 04-12 · P2 · A bind can only be removed with Backspace during capture, so pointer, pad and touch users cannot remove one
- where: ControlsSection.tsx:82, 255-280, 620-622
- what: Removal is a hidden keyboard chord, taught by a permanent grey sentence under the scope switch. A gamepad-only player driving the menu with padNav, which area/ui.md says drives everything, has no way to delete a pad bind.
- evidence: `REMOVE_HINT = 'Backspace while a bind is waiting removes it.'` is the only path. ui-standard §1.5 says "Helper text is not a fix for an unclear label."
- recommendation: While a slot is capturing, show a small "Remove" affordance next to it (a ghost `×` button). It appears only in the capture state, so nothing shifts at rest. After that the always-on hint can go.
- contract: ui-standard §1.5. area/ui.md controller navigation ("everything keyboard-reachable is pad-reachable").
- effort: M

##### 04-13 · P2 · Capture state is not announced
- where: ControlsSection.tsx:388-394, 620
- what: Arming a slot only changes the button's text to "PRESS…". The `role="status"` line shows the Backspace hint, not "Press a key for Forward". A screen-reader user gets no prompt and no confirmation of what was bound. The keycap has no `aria-pressed` or `aria-describedby` for the armed state.
- evidence: `notice ?? REMOVE_HINT`, and `notice` is set only on refusal or steal.
- recommendation: While capturing, set the status line to "Press a key for <action>. Esc cancels, Backspace removes", and after commit "<action>: W". The line already exists and is live.
- contract: WCAG 4.1.3 Status messages.
- effort: S

##### 04-14 · P2 · Off-grid geometry in the settings chrome
- where: shell.css:1408 `gap:22px`, 1410 `margin-top:20px`, 1415 `gap:6px`, 1425 subnav `gap:1px`, 1433 `.sl font-size:14px`, 2169 `.ds-seg padding:4px 10px`, 5147 `gap:6px`, 5142 `gap:14px`, 5190 `padding:6px 12px`, 5423 `.ds-key padding:4px 10px`, 4131-4144 `.ds-opt` shadow and radius fine but `gap:12px` on `.ds-opts` is on-grid
- what: The sub-nav label is 14px, off the six-size scale and between `md` 13 and `lg` 15. The sub-nav, segment and keycap spacing uses banned 6/10/14/20/22 values.
- evidence: ui-standard §2 "BANNED: 3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 18, 20px"; §3 six sizes. uiaudit already ratchets off-grid-gap 143 and off-scale-font 45.
- recommendation: 22→24 (`--ds-s-5`), 20→24, 6→8, 14→12 or 16, 10→8 or 12, subnav `.sl` → `--ds-t-lg`. Lower the uiaudit baselines to match.
- contract: ui-standard §2, §3
- effort: S

##### 04-15 · P2 · Mobile scope switch: unselected seasons are bare floating text in a 2x2 grid, and the unbound dot is clipped at the corner
- where: shell.css:5365-5372, 2166-2186 (`.ds-seg` transparent border, no fill), 5345-5354 (`.ds-seg-dot` top:0 right:0); p3-mobile both themes
- what: At 375px "All games" is a solid pill and "DECODE", "Chain Reaction" and "BIOBUZZ" are centred text with no boundary, so they look like labels rather than buttons. The 8px danger dot sits on the button's rounded corner, half outside the shape.
- evidence: The p3-mobile screenshot at y=340-410.
- recommendation: Inside `.ds-bind-scope` give `.ds-seg` a `--ds-line-strong` 1px border (the colour `.ds-opt` uses for the same 1.4.11 reason). Inset the dot to 4px/4px.
- contract: WCAG 1.4.11 non-text contrast (the control boundary). ui-standard §4.
- effort: S

##### 04-16 · P2 · Sub-nav entries are `<button>`s with `aria-current="page"`, not links
- where: src/ui/Configure.tsx:94-104
- what: The sections are real routes (`/configure/<key>`, "deep-linkable"), but they cannot be middle-clicked, opened in a new tab or copied as links, and `aria-current=page` on a button is announced ambiguously.
- evidence: The Configure.tsx:65 comment calls the sections deep-linkable routes.
- recommendation: Render `<a href="/…/configure/<key>">` with an onClick that calls `preventDefault` and routes. The styling is unchanged.
- contract: contract silent. WCAG 4.1.2 role.
- effort: S

##### 04-17 · P3 · `Select` listbox lacks Home/End and typeahead, and its name is optional
- where: src/ui/Select.tsx:21-26, 69-87
- what: The ARIA listbox pattern the doc comment claims includes Home/End and first-letter typeahead. `ariaLabel?` is optional, and without it the trigger's name is just the current value.
- evidence: `onListKeyDown` handles only arrows, Enter/Space, Esc and Tab.
- recommendation: Add Home/End, make `ariaLabel` required (or add `aria-labelledby`).
- contract: WAI-ARIA APG listbox. Contract silent.
- effort: S

##### 04-18 · P3 · Inline colour in JSX
- where: src/ui/AudioSection.tsx:34 (`style={muted ? { color: 'var(--ds-mut)' } : undefined}`)
- what: The muted volume readout is coloured by an inline style.
- evidence: ui-standard §1.1 "No spacing, size or colour literal in JSX."
- recommendation: Use a `.val.muted` class (a sibling of the existing `.val.over`, shell.css:2023).
- contract: ui-standard §1.1
- effort: S

##### 04-19 · P3 · Slider accessible names are spelled two ways
- where: ControlsSection.tsx:144-159 (PadSlider: no aria-label, so the `<label>` text "Trigger threshold 50%" is the name); AudioSection.tsx:46, GraphicsSection.tsx:220 (explicit `aria-label`)
- what: A Controls slider announces its value twice (in the name and in `aria-valuetext`). Audio and Graphics sliders announce it once.
- evidence: The `.val` span sits inside the wrapping `<label>`.
- recommendation: Add `aria-label={label}` to PadSlider, or pull the three into one shared `RangeField` component. There are four near-identical slider rows today: PadSlider, VolumeSlider, SpeedRow and the render-scale/FOV blocks.
- contract: contract silent.
- effort: S

##### 04-20 · P3 · ui-standard §10 still lists `button.ds-key` as missing `:focus-visible`
- where: docs/ui-standard.md §10; shell.css:1634 (now covered)
- what: The debt list is stale for this item, so a reader may "fix" something that is already fixed.
- evidence: `button.ds-key:focus-visible` appears in the shared focus rule.
- recommendation: Strike it from §10.
- contract: ui-standard §10
- effort: S

##### 04-21 · P3 · Network is a whole section for a single two-tile pick, and `LABELS` is a one-field record
- where: src/ui/NetworkSection.tsx:40-54; Configure.tsx:51-59
- what: A sixth nav entry opens one panel with one control and one hint. Separately, `LABELS: Record<…, { label: string }>` wraps a single string in an object, a leftover from the hints that were removed.
- evidence: See the code at those lines.
- recommendation: This is an owner ruling and can stay, but consider a Network row in Graphics' device-only group if more sections appear. Flatten `LABELS` to `Record<ConfigureSection, string>`.
- contract: contract silent.
- effort: S

#### Strengths (keep)
- `OptRow`/`ToggleRow` as the one spelling of a pick. It uses toggle buttons with `aria-pressed` and deliberately not a half-built radiogroup, and `mini` stops boolean pairs from becoming 62px slabs.
- The keycap language (`.ds-key`) with a `+` add slot, dashed red `UNBOUND` and a pulsing capture ring is legible and on-brand. The reduced-motion cap covers `animation-iteration-count` (styles.css:1355-1362).
- The Combo wait slider is disabled rather than hidden, and the status line is always present, so rows do not move. That is the right instinct and it is documented in place.
- Rare controls use `<details class="ds-fold">` (Graphics ▸ Advanced, Audio ▸ Individual sounds) instead of routing them elsewhere, and `[open]` changes colour, not width.
- `rangeFill` is small and clamped, and the track carries a `--ds-line-strong` border for 1.4.11. Once 04-01's base rule is restored, the slider design itself is sound.
- Light/dark parity in this lane is good. Every surface in p3/p2 inverts cleanly, and the only off-theme element is the native thumb in 04-01.
- The All-games / per-season scope model (controlsLayout.ts) lists each bind once, and the season's red unbound dot is out of flow.

### 05 · In-match HUD and overlays (code-only review: the evidence pack has no HUD screenshots)

Files reviewed: src/ui/GameView.tsx, src/ui/PerfHud.tsx, src/ui/MobileControls.tsx, src/ui/styles.css (HUD, overlay, intro, mobile, net-overlay and server-notice blocks, lines 140–1630, 2530–3125, 4199+), src/ui/predict.css, src/games/chain/HudSlots.tsx, src/games/biobuzz/HudSlots.tsx, the shell.css token blocks (lines 100–353, 5657), scripts/contrast.mjs (HUD pairs). TutorialCard/tutorial.css were only skimmed. Contrast ratios below are hand-computed from the token hexes. Nothing was rendered.

##### 05-01 · P0 · The 3D HUD scrim goes dark but leaves every status colour on its light-theme value
- where: src/ui/styles.css:229-237 (the scrim), plus the rules it misses: :383 `.timer-panel.warning`, :390 `.timer-panel.urgent`, :444 `.breakdown-row span.warn`, :653-660 `.perf-ping.*`, :501 `.chip.desync`, :1273-1291 `.park-status`, :866ff `.hopper-pip` rings (`--ds-mut`), :1334 `.game-btn:hover` border
- what: `.game-root.view-3d` sets `--ds-hud` to a fixed near-black (rgba(14,18,22,.82)) and moves only `--text`, `--muted` and `--ds-ink-dim` to the on-field family. `--ds-warn`, `--ds-red-ink`, `--ds-ok-ink`, `--ds-mut`, `--ds-ink`, `--ds-accent` and `--ds-line` keep their themed values. In the LIGHT theme those values were picked to read against a near-white card, and now they sit on a near-black one.
- evidence: against the scrim over the 3D mat (about #181c1f): END GAME timer `#8f5400` ≈ 2.8:1; last-ten-seconds timer `#b3261e` ≈ 2.6:1; ping "good" `#1f7a46` ≈ 3.2:1; hopper empty-slot ring `--ds-mut #5c645f` ≈ 2.8:1, which fails even the 3:1 non-text rule. `.park-status.parked` borders with `--ds-ink #191c1b`, so it is invisible. `scripts/contrast.mjs` hudPairs (:249-290) audits only the themed card, not the scrim, so "ALL PASS" never looks at these pairs. BIOBUZZ (the 3D game) is also the only game whose timer has no END GAME tint (05-07), which hides the timer case for now. The urgent timer, PIN warn chip and ping dot are all live today.
- recommendation: in the scrim block, remap every status token a band uses to an on-field sibling (`--ds-warn: #e0a437`, `--ds-red-ink: #ff9d96`, `--ds-ok-ink: #4ec27f`, `--ds-mut: var(--ds-on-field-dim)`, `--ds-ink: var(--ds-on-field)`, `--ds-line: var(--ds-hud-line)`). These are the dark-theme values, which already pass on dark. Then add a `hud3dPairs` group to contrast.mjs that composites the scrim over `TILE3D` in both themes.
- contract: CLAUDE.md THEMING, "its ground is the CANVAS ⇒ does NOT [invert]"; DESIGN.md Three-Zone Rule; ui-standard §5 ("A new colour pair means a new entry in scripts/contrast.mjs")
- effort: S

##### 05-02 · P0 · Urgent server notice is white on red at about 3.8:1, and it sits over the live match
- where: src/ui/styles.css:3085-3088 (`.server-notice.urgent`), :3066-3084
- what: The scheduled-restart banner is `position: fixed; z-index: 2000`, so it shows mid-match. The urgent variant puts `#fff` 13px/700 text on `rgba(239,68,68,.97)`. The fill is a literal, not a token, and contrast.mjs never checks it.
- evidence: #ef4444 has luminance ≈ 0.229, so white on it is ≈ 3.76:1. 13px bold is not large text, so AA needs 4.5. `--ds-red-chip` (#d32020) with white is already audited and passes. The non-urgent amber is also a literal (`rgba(251,191,36,.96)`), and its blurred shadow `0 6px 24px` breaks the No-Blur Rule.
- recommendation: `.server-notice.urgent { background: var(--ds-red-chip); color: var(--ds-red-chip-ink) }`. Put the amber variant on `--ds-gold` with its fixed dark ink. Replace the shadow with `--ds-block`.
- contract: WCAG 1.4.3; ui-standard §5 ("No hex, rgb() or hsl() literal"); DESIGN.md No-Blur Rule
- effort: S

##### 05-03 · P0 · The DESYNC chip blinks forever, and reduced-motion turns that into a flicker
- where: src/ui/styles.css:501-505 (`.chip.desync { animation: blink 1s steps(2) infinite }`), :1346-1364 (the reduced-motion cap list), src/ui/shell.css:5657-5661 (global `* { animation-duration: 0.001ms }`)
- what: The reduced-motion block caps `animation-iteration-count` for `.timer-panel.urgent .timer-time`, `.net-spinner`, `.rec-dot` and `.ds-key.capturing`, but not for `.chip.desync`. The global rule cuts its duration to 0.001ms, so for a reduced-motion user an infinite `steps(2)` opacity blink now loops about a thousand times per millisecond. The opacity each frame lands on is effectively random, so the chip strobes. This is the exact bug the house rule describes.
- evidence: ui-standard §7 and CLAUDE.md both say "capping only the duration makes an infinite animation loop faster". `.chip.desync` was added after the list was written (its comment borrows the timer's keyframe).
- recommendation: add `.chip.desync` to the `animation-iteration-count: 1 !important` list. Better, add one blanket `* { animation-iteration-count: 1 !important }` next to the global duration rule in shell.css:5658, so a new infinite animation cannot miss the list again.
- contract: ui-standard §7; WCAG 2.2.2 / 2.3.3
- effort: S

##### 05-04 · P0 · Idle joystick labels are 10px text at 50% opacity, about 3.3:1
- where: src/ui/styles.css:2739-2751 (`.mobile-joystick-base { opacity: .5 }`), :2762-2772 (`.mobile-joystick-label`, 10px, `--ds-on-field-dim`)
- what: The DRIVE/TURN label is a child of the base, so it inherits the base's 0.5 opacity. It sits 18px above the ring, directly on the field. Every idle moment of a phone match shows these labels.
- evidence: `#b9beb8` at alpha .5 over the 2D field `#14161a` comes out near #676a69, ≈ 3.3:1 for 10px/800 text. On the lighter 3D mat (#454545) it is under 2:1. It is also below the type scale floor (05-10).
- recommendation: fade the ring, not the label. Put the idle opacity on a `::before` ring layer (or on `.mobile-joystick-handle` and the border colour) and give the label full-opacity `--ds-on-field-dim` at `--ds-t-xs`. Add a contrast pair for it on the 2D field and on `TILE3D`.
- contract: WCAG 1.4.3; ui-standard §3
- effort: S

##### 05-05 · P1 · On a phone, the whole top-right card and the net corner disappear
- where: src/ui/GameView.tsx:1033 (`{(!coarsePointer) && <div className="status-wrap">…`), :1182 (`net-corner` gated the same way); styles.css:2939-2955 and :3054-3062 (compact-block rules sizing `.status-wrap` for coarse pointers)
- what: A coarse pointer loses DECODE's hopper, gate lever and power gauge, Chain Reaction's storage gauge and its "catalyst in reach" prompt pip, BIOBUZZ's held-element column, FLOWER lock and NECTAR supply, the red/yellow card icon, reversed-drive state, the PerfHud read-out (whose default `simple` level exists precisely to show fps and ping), the prediction picker, and the DESYNC chip. BIOBUZZ's own comments (HudSlots.tsx:26-27) say "A chip removed from this file is a number a driver cannot get any other way", and the same comments (:424-428) admit the chip row is suppressed on phones. Meanwhile styles.css still carries two media blocks that carefully size `.status-wrap` for `pointer: coarse`. That CSS is now dead for touch, which suggests the TSX gate came later and the layout work was abandoned rather than finished.
- evidence: GameView.tsx:776-777 ("the status chips opposite are fine-pointer only"); styles.css:2933-2938 (the compact block's own note about fixing this row on a 320px phone).
- recommendation: render `.status-wrap` on touch as well. The compact and landscape blocks already cap it to the gutter. If width really is the constraint, drop only the PerfHud rows past `simple` on coarse pointers, and keep the game card, the card icon and DESYNC. Otherwise, delete the dead coarse-pointer `.status-wrap` CSS and record which facts a phone player cannot see.
- contract: docs/area/ui.md HUD rules ("zone status lives in the top-right chips"); contract silent on phone parity
- effort: M

##### 05-06 · P1 · Icon-only indicators explain themselves through `title`, which never shows
- where: GameView.tsx:1067-1084 (gate icon), :1112-1138 (reversed / butterfly / card icons), :125-128 (power gauge); chain/HudSlots.tsx:36-60; biobuzz/HudSlots.tsx:260-308; styles.css:181-187 (`.hud { pointer-events: none }`)
- what: The HUD-relocation pass turned the text chips into unlabelled glyphs: two rings, two triangles, a lever, a 12×16 rectangle, pip columns. The only sighted explanation of each glyph is a `title=` tooltip. Tooltips need hover, and `.hud` is `pointer-events: none`. Only `.game-btn`, `.sponsor-chip`, `.mobile-btn` and `.pred-panel` turn pointer events back on, so none of these tooltips can ever appear. A new player cannot learn what the purple double triangle or the pair of amber rings means. ui.md records this exact trap for the connection chip's `onClick`.
- evidence: docs/area/ui.md:322-325; GameView.tsx:47-53 (the same failure, already diagnosed once).
- recommendation: teach the glyphs somewhere that is reachable: a HUD legend in the Controls or Tutorial screen, or a first-appearance event-log line ("REVERSED DRIVE ON"). Drop the dead `title`s, or keep them only for the screen-reader `aria-label`, which does work. Do not re-enable pointer events on the cards.
- contract: ui-standard §1.5 ("A control explains itself or it is redesigned"); docs/area/ui.md:322
- effort: M

##### 05-07 · P1 · BIOBUZZ's score bar is a fork of the shared one and has drifted from it
- where: src/games/biobuzz/HudSlots.tsx:371-378 (a copy of `PHASE_LABEL`), :98-101 (a copy of `fmtTime`), :457-464 (timer panel); compare GameView.tsx:932-978
- what: The shared bar shows `END GAME` with the `.warning` tint at 20s, and shows `MATCH OVER` until `hud.resultFinal`, because "between the buzzer and the field coming to rest it can still change". The BIOBUZZ copy does neither. It jumps straight to `FINAL` at the buzzer, and BIOBUZZ is the one game whose score explicitly settles after the buzzer (`pendingPts`, §10.5 C/E "once everything has come to rest", HudSlots.tsx:146-167). So the bar can say FINAL beside a number that is about to change. It also never gets the END GAME cue that docs/area/ui.md:311 requires on the HUD. The file says the layout is shared "so a driver who plays two games reads the same bar in both", but the behaviour is not.
- evidence: GameView.tsx:968-974 vs HudSlots.tsx:460-462.
- recommendation: extract `<TimerPanel hud motif?>` (phase label, END GAME, MATCH OVER, urgent, warning) from GameView and have `BiobuzzScoreBar` render it between its own alliance panels. Delete the duplicate `PHASE_LABEL` and `fmtTime`.
- contract: docs/area/ui.md:311 (END GAME label and tint); game-seam rule of thumb in CLAUDE.md ("match phases, HUD chrome … belongs in the shared core")
- effort: S

##### 05-08 · P1 · The live score bar's red and blue are not the alliance tokens, so the colour changes at the buzzer
- where: styles.css:278-284 (`linear-gradient(180deg, #7f1d1d, #991b1b)` / `#1e3a8a, #1d4ed8`); compare :1907-1918 (`.resx-half.red { background: var(--ds-red-chip) }`)
- what: During the match the alliance panels are dark maroon and navy gradients. The results screen that replaces them uses the `--ds-red-chip` / `--ds-blue-chip` tokens (#d32020 / #1f6fe0), and robots on the canvas use `--ds-red` / `--ds-blue`. So one alliance shows three different reds within one match. The gradients are also the only gradient fills in the HUD, against DESIGN's flat keycap language.
- evidence: DESIGN.md "Alliance Red (`red-chip` #d32020) … an alliance's color must mean the same thing in both themes".
- recommendation: `background: var(--ds-red-chip)` / `var(--ds-blue-chip)`, flat, with `-chip-ink` for `.panel-score`, `.you-tag` and `.bb-tip`. Keep the `.mine` inset ring as the identity cue.
- contract: DESIGN.md Colors, State / Alliance; ui-standard §5 (no literals)
- effort: S

##### 05-09 · P1 · A REMATCH vote has no visual "voted" state
- where: GameView.tsx:743-753 (`className={`game-btn${hud.rematch.mine ? ' on' : ''}`}`); styles.css has no `.game-btn.on` rule
- what: The co-op duo-record rematch toggle adds `.on` when the player has voted, but nothing styles it. The only feedback is the tally digits and a `title` that cannot show (05-06). A driver cannot see whether their press counted or whether a second press took it back.
- evidence: `rg "game-btn\.on" src` finds nothing.
- recommendation: add `.game-btn.on { color: var(--ds-ok-ink); border-color: var(--ds-ok-ink) }` (remapped in the 3D scrim per 05-01), or the pressed keycap look (`transform: translateY(3px); box-shadow: none`). Add `aria-pressed={hud.rematch.mine}`.
- contract: DESIGN.md Components, Buttons (states); ui-standard §1.3
- effort: S

##### 05-10 · P1 · HUD type goes well below the 11px floor exactly where glanceability matters
- where: styles.css:322 `.you-tag` 9px (8px at :2913 on touch); :368 `.timer-phase` 10px (8px at :2924 on touch); :2930 breakdown chips 10px, :3042 9px in landscape; :2767 joystick label 10px; :2637 `.intro-you` 9px; :2669 `.intro-dt` 10px; predict.css `.pred-head` / `.pred-foot` 10px
- what: The phase label (AUTONOMOUS / END GAME), the YOU tag and the breakdown chips are the things a driver reads at a glance. On a phone they are 8–9px with 1–2.5px tracking, and the timer phase is also muted. The standard's floor is `--ds-t-xs` 11px.
- evidence: ui-standard §3 six-size scale; uiaudit's `off-scale-font-size` ratchet is at 45, and these account for several.
- recommendation: floor HUD labels at `--ds-t-xs`. To save space on touch, remove letter-spacing and shorten copy (`DRIVER` for DRIVER-CONTROLLED on compact) rather than shrink glyphs. Put `.you-tag` on `--ds-t-xs` and let the `.mine` ring carry identity.
- contract: ui-standard §3
- effort: S

##### 05-11 · P1 · DECODE's FOULS and every WAITING notice live only in the event log, which the player can hide
- where: GameView.tsx:1208-1228 (`{showEventLog && (<div className="eventlog">…`), :1213-1221
- what: The relocation moved FOULS n MIN · n MAJ and `WAITING · <name>` into pinned event-log lines because they are "a call to action rather than a standing fact" (GameView.tsx:1096-1097). But the log is gated on `settings.showEventLog`, and the comment on that gate says "nothing here is actionable". With the log off, a DECODE driver has no running foul count anywhere in the HUD, and online play loses the waiting-for-player notice. BIOBUZZ covered its PIN by also putting it on the always-mounted breakdown row. DECODE has no equivalent.
- evidence: GameView.tsx:1205-1207 vs :1096-1098 contradict each other.
- recommendation: render `eventlog-pinned` lines whatever `showEventLog` says, and let the setting hide only the fading toasts. Alternatively, put DECODE fouls in its `.breakdown-row` the way BIOBUZZ does with PIN.
- contract: docs/area/ui.md:307 ("events go to the muted left-edge log"); contract silent on hideability
- effort: S

##### 05-12 · P2 · The pre-match "RED ALLIANCE" is plain ink, while a filled alliance chip sits unused
- where: GameView.tsx:786 (`<h2>{hud.alliance.toUpperCase()} ALLIANCE</h2>`); styles.css:1525-1528 (bare `h2` rule: size and tracking only, no weight or colour); :470-480 (`.chip.alliance-red/blue`, no call sites)
- what: The single most important pre-match fact, which side you are on, is uncoloured charcoal text. DESIGN reserves filled alliance chips for exactly this. The ranked intro does the opposite and tints the text instead (`.intro-side-label.red { color: var(--red) }`, :2580), which DESIGN's Don'ts also forbid.
- recommendation: `<h2><span className="chip alliance-red">RED ALLIANCE</span></h2>`, or a `.ds-chip` alliance variant at a larger size. Apply the same fill to `.intro-side-label`. Give `.overlay-panel h2` a weight and a colour token.
- contract: DESIGN.md Don'ts ("Don't tint alliance identity with text color alone")
- effort: S

##### 05-13 · P2 · Blurred shadows and backdrop blur in the in-match chrome
- where: styles.css:2776 (joystick handle `0 4px 12px`), :2797 (`.mobile-btn`), :2864 (`.mobile-edit-bar` `0 6px 20px`), :3082 (`.server-notice`), :1486 and :2541 (`backdrop-filter: blur(3px/4px)` on `.overlay` and `.intro-overlay`)
- what: The mobile pad and edit bar use soft drop shadows, which is the generic-web depth DESIGN rejects. The overlays blur the field behind them.
- recommendation: give the pad buttons and edit bar the keycap edge (`--ds-edge` / `--ds-block-sm`). Drop `backdrop-filter`, since the 0.55/0.72 scrim already does the dimming. uiaudit's shadow-sprawl count should drop by 3–4.
- contract: DESIGN.md No-Blur Rule
- effort: S

##### 05-14 · P2 · Chain Reaction shows the same state two or three times on desktop
- where: GameView.tsx:1022-1031 (breakdown row: `MULT ×n`, `CATALYSTS n/4`, `ASCENDED|PARKED`); chain/HudSlots.tsx:36-43 (mult badge and catalyst pips); GameView.tsx:1145-1149 (`.park-status` card, also ASCENDED/PARKED)
- what: Multiplier and catalyst count appear in both the bottom chips and the top-right card. The endgame state appears in both the bottom chips and a third top-right card. The relocation note (GameView.tsx:1100-1101) says the park status moved to `.park-status`, but the breakdown-row copy was never removed.
- recommendation: keep ASCENDED/PARKED in one place (the breakdown row, which also renders on phones). Once 05-05 lands, decide whether MULT and CATALYSTS belong in the bar or the card, not both.
- contract: contract silent (hierarchy)
- effort: S

##### 05-15 · P2 · The mobile layout editor bar is a separate button language with no state styles
- where: styles.css:2850-2887; GameView.tsx:665-675
- what: Reset and Done are pill-shaped (`--ds-round-full`), flat and transparent, with no `:hover`, `:active`, `:focus-visible` or `:disabled`. The bar's fill is a literal `rgba(20,24,30,.92)`, and the primary ink is a literal `#10241b`, the same value predict.css defines as `--ds-on-field-accent-ink` inside a component file (predict.css:32-34) instead of the shell token block. Off-grid 10px/14px spacing.
- recommendation: reuse `.overlay-buttons button` (the same caps keycap as the other in-match overlays), or `.game-btn`. Move `--ds-on-field-accent-ink` into shell.css's token block and reference it from both places.
- contract: ui-standard §1.3, §2, §5; DESIGN.md Buttons (8px radius)
- effort: S

##### 05-16 · P2 · `.game-btn` and `.pred-opt` break the keycap rules
- where: styles.css:1319-1344 (`.game-btn`: no `:focus-visible` or `:disabled`, hover shadow `0 2px 0 var(--ds-line)`); predict.css `.pred-opt:hover { transform: translateY(-1px) }`, no `:active`
- what: MENU/RESET/NEW RUN can be tabbed to but have no focus ring (listed as known debt in §10, and still the most-used in-match button). Their hover and active edges use the shell `--ds-line`, not `--ds-hud-line`. `.pred-opt` LIFTS on hover, which is the opposite direction to every other keycap.
- recommendation: add `.game-btn:focus-visible { outline: 2px solid var(--ds-on-field-accent); outline-offset: 2px }`, with the colour chosen against the field. Switch the hover and active edges to `--ds-hud-line`. Make `.pred-opt` sink 1px on hover and add a 3px `:active`.
- contract: ui-standard §1.3; DESIGN.md "sinks 1px on hover, 3px … on press"
- effort: S

##### 05-17 · P2 · The net corner colours neutral facts as success and uses an emoji icon
- where: GameView.tsx:1189 (`chip on` for `SPEC n`), :1200 (`chip on` with `🌐 {server}`); styles.css:482-484
- what: `.chip.on` means ready/on (`--ds-ok-ink` green). Spectator count and server region are neutral facts, so painting them green borrows a status meaning they don't have. The 🌐 emoji renders in the OS colour-emoji face inside a mono chip and themes with nothing.
- recommendation: use plain `.chip` for both. Replace 🌐 with a text label or a CSS-drawn glyph, as the HUD icons already do.
- contract: DESIGN.md "Status Green … distinct from the brand accent"; Chips (status variants)
- effort: S

##### 05-18 · P2 · A red card, which voids the match score, is now a 12×16 swatch
- where: GameView.tsx:1130-1137; styles.css:840-854; compare :507-517 (the dead `.chip.bad`, whose comment says "the worst thing that can happen to a score, so it is filled")
- what: The red card used to be a filled text chip. After the relocation it is an unlabelled rectangle in a second card, desktop only (05-05), and it can only be explained by a tooltip that never shows (05-06).
- recommendation: keep the icon for the yellow card, but show a red card as the filled `.chip.bad` "RED CARD · VOID", and pin it in the event log so phones get it too.
- contract: contract silent (hierarchy); DESIGN.md "spend them like an alarm"
- effort: S

##### 05-19 · P2 · An assisted touch button is ghosted with opacity, which reads as disabled
- where: styles.css:2838-2840 (`.mobile-btn.auto { opacity: .45 }`), :2844-2847 (`.fixed` .55)
- what: DESIGN's chip rule rejects opacity dimming for exactly this reason. An assisted button still works (the comment says "a manual press still reaches the sim"), but at 45% opacity its `--ds-on-field-dim` label drops to about 3:1.
- recommendation: show the assist state through the edge instead (dashed `--ds-on-field-dim` border, or a small "AUTO" sub-label) and keep label opacity at 1.
- contract: DESIGN.md Chips ("text-carries-the-meaning, not opacity-fade")
- effort: S

##### 05-20 · P3 · Dead HUD chip variants are still audited, which overstates coverage
- where: styles.css:470-526 (`.chip.alliance-red/blue`, `.off`, `.warn`, `.bad`, `.prompt`); scripts/contrast.mjs:257-262, 278-279
- what: Only `chip on` and `chip desync` have call sites in src. The rest are left over from the relocation, and contrast.mjs still counts them as passing HUD pairs while real HUD pairs (05-01, 05-04) go unaudited.
- recommendation: delete the dead variants (unless 05-12 and 05-18 reuse them) and their contrast entries. Add the scrim and joystick pairs.
- contract: ui-standard §10 ("dead rule families … are debt")
- effort: S

##### 05-21 · P3 · Off-grid spacing and literal radii across the HUD cards
- where: styles.css:274 `.score-panel` 10px 20px; :360 `.timer-panel` 8px 26px; :363 gap 2px; :533 `.motif-dot` margin 3px; :1442 `.eventlog-line` 2px 8px; :1567/:1576 `.overlay-buttons` gap 10px, padding 10px 22px; :1425 `left: 14px`; :2608 `.intro-card` 12px 14px; :2674 `border-radius: 5px`; :1502 overlay gap 14px
- recommendation: snap to `--ds-s-*` (10→8 or 12, 14→12 or 16, 22/26→24) and `--ds-round-sm` when the next pass touches each block. PerfHud already shows how it should look.
- contract: ui-standard §2, §4
- effort: M

#### Strengths (keep)
- **Band discipline.** `data-hud-band` sits only on boxes whose size depends on the viewport, never on match state. The breakdown row's reserved min-extent, PerfHud and the net corner deliberately not being bands, and the measured notes explaining each choice are the right way to keep a 3D camera from jumping.
- **PerfHud** (PerfHud.tsx, styles.css:604-739) is the model HUD component: all tokens, on the type scale, tabular mono, one fact per row with a narrow-viewport stack, a null drawn as nothing and never as a zero, `role="status"` without live announcements, and a 4 Hz ceiling.
- **Digits-Are-Mono is followed everywhere.** Score, timer, chips and the event log all use `--ds-font-mono` with `tabular-nums`. The accessibility semantics are right: `role="status"` on the phase label only, not the ticking digits, and a polite event log.
- **Canvas-ground text uses the on-field family correctly.** Countdown, intro eyebrow/VS and the joystick all use `--ds-on-field*`, with comments explaining why, and the HUD cards are edged with `--ds-hud-line` as the THEMING gotcha requires.
- **The touch button set is derived and packed, not hand-listed.** Buttons come from `ACTION_GAMES`, assisted actions are ghosted rather than hidden, and positions are computed per orientation, with the landscape gutter re-docking of the score bar and breakdown row.
- **No toasts over the field, and MENU/RESET are always visible.** The HUD product rules are held consistently, and the scorebar's inset-outline fix for the clipped corner is careful work.

### Lane 06: Post-match (code-only review, no screenshots for this lane)

Files reviewed: src/ui/Results.tsx, RewardDialog.tsx, StarReward.tsx, rewardsStore.ts, recordBanner.ts, RecordRun.tsx, ScoreReportDialog.tsx, ReportDialog.tsx, AwardBadge.tsx, BadgeMark.tsx, TitleChip.tsx, TitlePicker.tsx, SupporterBadge.tsx. CSS: styles.css (overlay-panel/overlay-buttons 1480–1630, `.resx-*` 1630–2520, `.sup-badge` 3405–3525), shell.css (`.ds-modal` 3673–3700, `.ds-linkbtn` 6342–6360, `.ds-report` 6399–6442, award/badge/title/`.rw-*` 7270–7733, tokens 149–209). Checked against DESIGN.md, docs/ui-standard.md, docs/area/ui.md, docs/area/accounts.md (badge rules), scripts/contrast.mjs.

Contrast ratios below are computed by hand from the token hexes in shell.css. Treat them as measurements to confirm with `npm run contrast`, not as audited results.

---

##### 06-01 · P0 · Focus ring on the results-stage link buttons is `--ds-accent`, which almost vanishes on the stage and on both alliance fills
- where: shell.css:6356 (`.ds-linkbtn:focus-visible { outline: 2px solid var(--ds-accent) }`). Used at Results.tsx:1037, 1053 (report links on the stage) and Results.tsx:1127 (the "Sign in to save this run" button, which sits on the alliance fill). styles.css:1687 fixes the ring token only for `.overlay-buttons button`.
- what: The stage override covers the action buttons and misses every `.ds-linkbtn` on the stage. The link buttons keep the themed accent ring on a fixed-dark ground. The sign-in button is worse, because it sits on the red or blue fill. Record runs are always blue, so that button always sits on blue.
- evidence: Light-theme accent #366758 against stage #14171c is about 2.8:1. Against `--ds-red-chip` #d32020 it is about 1.2:1, and against `--ds-blue-chip` #1f6fe0 about 1.4:1. Dark-theme accent #5fb597 against red is about 2.1:1. All of these fail the 3:1 floor for a focus indicator (WCAG 1.4.11).
- recommendation: Add `.resx-stage .ds-linkbtn:focus-visible { outline-color: var(--ds-on-field) }`. For the button on the fill, use `outline-color: currentColor`, which is the chip ink. That is one more selector on the existing override at styles.css:1687. Add the pairs to contrast.mjs.
- contract: ui-standard §1.3 (a visible focus-visible state is required); CLAUDE.md THEMING category 3 (anything on the canvas-ground stage takes `on-field*`).
- effort: S

##### 06-02 · P0 · Report dialog: the selected option is never exposed to assistive tech, and the option groups have no name
- where: ReportDialog.tsx:64–78 ("Who") and 84–95 ("Why"): `ds-opt` buttons with no `aria-pressed`. The captions at :64 and :82 are bare `<span className="ds-report-cap">`.
- what: Choosing a driver or a reason only adds `.on`. A screen reader hears a list of plain buttons with no selected state, and "Who"/"Why" are not tied to the groups they caption. Submit stays disabled until both are chosen, so a screen-reader user cannot tell why it is disabled.
- evidence: TitlePicker.tsx:61/66 does it correctly: `role="group" aria-label` on the grid and `aria-pressed` on each tile. That is the house pattern ("ONE SPELLING OF A PICK").
- recommendation: Add `role="group" aria-labelledby` pointing at the caption, and `aria-pressed={selected}` on each option, the same as TitlePicker.
- contract: WCAG 4.1.2; docs/area/ui.md (`.ds-opt` pick pattern).
- effort: S

##### 06-03 · P0 · Opening "Report a player" or "Report a misscore" drops keyboard focus to `<body>`
- where: Results.tsx:1035 (`!reporting &&` unmounts the trigger), :1051 (`!scoreReporting && !scoreReported`), :1063–1079 (the form renders inline with no focus call).
- what: Activating the link removes the element that had focus. The form that replaces it takes no focus, has no `role="dialog"` and no heading link, and Escape does not close it. A keyboard or switch user ends up at the top of the document, and inside the stage, which is `role="dialog"`. Submitting the misscore claim does the same thing again, because the form unmounts and a `<p>` takes its place.
- evidence: RewardDialog.tsx:124 focuses its primary action on mount, and Results.tsx:630 does the same for the actions row. The report forms are the only post-match surface without focus handling.
- recommendation: On mount, focus the form's first control or its heading (`tabIndex={-1}`). On close, send focus back to the link. Keeping the trigger mounted and toggling `aria-expanded` would also work.
- contract: WCAG 2.4.3 focus order; ui-standard §6 dialog anatomy.
- effort: S

##### 06-04 · P1 · Three dialog patterns in one lane, and the report forms follow none of the house rules
- where: RewardDialog.tsx:141 (`.ds-modal`: 12px radius, `--ds-line` border, `6px 6px 0` shadow, sentence-case `.ds-btn`, primary on the right). App.tsx dialogs (`.overlay-panel`: 16px radius, `--ds-hud-line` border, no block shadow, all-caps tracked `.overlay-buttons`). ReportDialog/ScoreReportDialog (`.ds-report` at shell.css:6411: an inline tile, 8px radius, h3 at 15px).
- what: Three looks for "a dialog". The report forms break the standard directly:
  - Buttons are ALL CAPS `.ds-btn` ("CANCEL", "SUBMIT REPORT", "SUBMIT", "CLOSE"). The house rule is sentence case for `ds-btn`.
  - Submit is a plain `.ds-btn` with no `.primary`, so neither button reads as the main action.
  - The headings are `.ds-report-h`, not `.ds-dialog-title`.
- evidence: ReportDialog.tsx:49, 117, 119–129; ScoreReportDialog.tsx:70–80. docs/area/ui.md UI COPY: "Sentence case for ds-btn and every heading." ui-standard §6: "Primary action is rightmost, always."
- recommendation: Make the report forms sentence case ("Cancel" / "Submit report") with `.ds-btn.primary` on submit. Choose one dialog skeleton (title class, radius, edge, action row) and write it into ui-standard §6 as the only one.
- contract: ui-standard §6 Dialog; docs/area/ui.md dialog titles + UI COPY.
- effort: M

##### 06-05 · P1 · `.ds-dialog-title` does nothing in the claim dialog: the selector only exists in compound form
- where: styles.css:1550–1551 (`.overlay-panel h2.ds-dialog-title, .net-overlay-card h3.ds-dialog-title`); RewardDialog.tsx:165 (`className="ds-dialog-title rw-h"` inside `.ds-modal`).
- what: The class was added so every shell dialog heading shares one type spec. There is no bare `.ds-dialog-title` rule, so in a `.ds-modal` the class matches nothing, and `.rw-h` (shell.css:7631) restates the spec with its own values. `line-height` is 1 here and 1.2 on `ds-dialog-title`. On a podium card the headline is 28px with `text-wrap: balance`, so a two-line headline sets solid at line-height 1.
- evidence: rg finds `.ds-dialog-title` only at those two compound selectors. The class is not doing the job docs/area/ui.md says it does.
- recommendation: Add a bare `.ds-dialog-title` at `(0,1,0)`, keep the compound one to beat `.overlay-panel h2`, and remove the duplicated declarations from `.rw-h`, keeping only the tier size step.
- contract: docs/area/ui.md "A SHELL DIALOG'S TITLE IS ds-dialog-title".
- effort: S

##### 06-06 · P1 · Up to four accent-filled "primary" buttons in the results action row
- where: Results.tsx:1008–1029; styles.css:1571 (every `.overlay-buttons button` is filled with `--ds-accent` unless it is `.ghost`).
- what: After a ranked match the row can hold WATCH REPLAY, REMATCH n/n, QUEUE AGAIN and BACK TO LOBBY, all identical accent keycaps. Only MENU is set apart. The code comment at :1024 says MENU was made ghost so it would not be "a fourth primary". But the three or four buttons beside it are all primary, so nothing tells the player which action the screen expects. Autofocus goes to the first button, which is WATCH REPLAY, not the obvious next step (REMATCH or QUEUE AGAIN).
- evidence: `useFocusPrimaryAction` focuses `querySelector('button')`, which is the first button in DOM order.
- recommendation: One filled button per context: REMATCH/RUN AGAIN for solo, QUEUE AGAIN for ranked, BACK TO LOBBY for custom. Make the rest ghost. Move the primary to the rightmost position (ui-standard §6) and focus it explicitly.
- contract: ui-standard §6 ("Primary action is rightmost, always"); DESIGN.md Buttons (one primary per context).
- effort: S

##### 06-07 · P1 · The REMATCH vote's pressed state is invisible: `.primary` has no rule, and there is no `aria-pressed`
- where: Results.tsx:622 (`className={vote.mine ? 'primary' : ''}`); no `.overlay-buttons button.primary` rule exists in either stylesheet.
- what: Voting changes nothing visually beyond the label changing to "WAITING…", because every overlay button is already filled with accent. It is a toggle, and the toggled state is not exposed programmatically.
- evidence: rg for `overlay-buttons button.primary` returns nothing.
- recommendation: Add `aria-pressed={vote.mine}` and give the "mine" state a pressed look, for example the flush `:active` transform plus the `--ds-on-field` ring. Otherwise delete the dead class.
- contract: WCAG 4.1.2; ui-standard §1.3 (every state styled).
- effort: S

##### 06-08 · P1 · Admin badge disappears on the blue alliance half; staff discs sit on the alliance hues
- where: Results.tsx:385 (`SupporterBadge` in the roster row on the alliance fill); styles.css:3521–3524 (`.sup-badge.admin { background: var(--ds-blue-chip) }`).
- what: On the results board an admin's disc is `#1f6fe0` on a `#1f6fe0` half, so only the white diamond is left. The owner disc is accent green on the red or blue fill, about 1.2–1.5:1 in light theme. The accounts rule says a badge must read as an object against the ground BEHIND it. contrast.mjs only checks glyph against fill, and against the themed panel, never against the alliance fills this screen puts the badge on.
- evidence: styles.css:3510 admits "The blue is the alliance-blue chip colour… the collision is worth the legibility". The results roster is exactly the place where that collision happens.
- recommendation: On `.resx-half`, give `.sup-badge` a 1px `--ds-on-field` ring (`box-shadow: 0 0 0 1px`), or put the badge on a light plate. Add contrast pairs for the badge fills against `--ds-red-chip`/`--ds-blue-chip`.
- contract: docs/area/accounts.md "Badge colours must be SATURATED IN BOTH THEMES… distinguish by SHAPE as well as hue"; DESIGN.md (alliance hues reserved for alliance identity).
- effort: S

##### 06-09 · P1 · The reward marks do not form one family: five shapes, four sizes, six fills, and conflicting reasoning
- where: SupporterBadge (disc, `0.92em`, styles.css:3460), AwardBadge (hexagon, `1.05em`, shell.css:7309), BadgeMark (crest/ribbon, `1.1em`, shell.css:7452), TitleChip (text chip, fixed `11px`/`18px`, 4px radius, shell.css:7363). Fills: `--ds-gold`, `--ds-accent`, `--ds-blue-chip`, `--ds-award`, `--ds-podium-gold/silver/bronze`.
- what: A single name can carry a disc, up to three crests or ribbons, and a hexagon or chip. Each has a different em size, and the chip is the only one on a fixed pixel size. The reasoning also contradicts itself:
  - AwardBadge.tsx:14–19 rejects gold/silver/bronze ("gold already means supporter, silver and bronze are desaturated"), yet `.podium-*` (shell.css:7402) and every crest now use exactly those metals.
  - There are now two golds 5° of hue apart (`--ds-gold` #f5a623 supporter, `--ds-podium-gold` #e8b730), and the results WR banner uses the SUPPORTER one (next finding).
  - TitleChip is square-cornered (4px) while every other mark is round or shaped. DESIGN.md Shapes says badges go full pill.
- evidence: See the files above. DESIGN.md's palette lists `gold` as "staff/supporter badges only" and has no award or podium entries at all.
- recommendation: Write the family into DESIGN.md as one table: kind, shape, hue, size. Put the three sibling marks on one base size (for example `1em` glyph with a `0.42em` leading gap). Give TitleChip `--ds-round-full` and `var(--ds-t-xs)`. Update the AwardBadge comment to match what shipped.
- contract: DESIGN.md Colors ("Signal Gold: staff/supporter badges only") and Shapes; design-guide §2 ("amend the contract in the same commit").
- effort: M

##### 06-10 · P1 · The WORLD RECORD banner uses the supporter's gold, not the podium gold
- where: styles.css:2036–2039 (`.resx-winbanner.gold { background: var(--ds-gold) }`), comment at :2029–2035; recordBanner.ts:44–46 comment.
- what: Both comments say "GOLD is the design system's only medal token". That stopped being true when `--ds-podium-gold` was added (shell.css:164–171, whose own comment ends "Not --ds-gold, which means SUPPORTER"). So the loudest achievement on the results screen is painted in the paid-membership colour.
- evidence: shell.css:170 against styles.css:2032.
- recommendation: Switch to `--ds-podium-gold`/`--ds-podium-ink` (already an audited pair) and correct both comments.
- contract: DESIGN.md "Signal Gold… staff/supporter badges only".
- effort: S

##### 06-11 · P1 · The action row flips hierarchy between themes on a stage that is meant to be fixed-dark
- where: Results.tsx:32–40 (the actions keep the THEMED `.overlay-buttons`); styles.css:1609 (`.ghost` = `--panel-2` fill, `--border` edge).
- what: The stage never inverts, but its buttons do.
  - Light theme: MENU is a near-white keycap on near-black and becomes the loudest thing in the row. The accent buttons (#366758) sit at about 2.8:1 against the stage.
  - Dark theme: MENU is `#1a2026` on `#14171c`, about 1.1:1 by fill and about 1.9:1 by its `--ds-line` edge, so it nearly disappears.
  - The same happens to `.ds-report` (tile fill), which renders on the stage as a light slab in light theme and an almost invisible one in dark.
- evidence: Token values are at shell.css:26–49 (light) and 251–271 (dark). contrast.mjs has no pairs for button fill against `--ds-stage-bg`.
- recommendation: Scope the stage's buttons to fixed tokens: primary gets an `on-field-accent` fill with dark ink; ghost gets a transparent fill with a 1px `--ds-on-field-dim` edge and `--ds-on-field` ink. Do the same for the inline report form, or move it onto a real `.ds-modal`. Add the pairs to contrast.mjs.
- contract: CLAUDE.md THEMING (three categories; "its ground is the CANVAS ⇒ does NOT [invert]"); DESIGN.md Three-Zone Rule.
- effort: M

##### 06-12 · P1 · The plain award hexagon is about 2.7:1 against the light panel with no rim
- where: shell.css:7289–7294 (`.award-badge svg { fill: var(--ds-award) }`, no stroke); `--ds-award` #a78bfa at shell.css:161.
- what: The hexagon silhouette is what tells an award apart from the other marks at 12–16px. On the white panel, violet #a78bfa is about 2.7:1, under the 1.4.11 floor for a meaningful graphic. The podium variants and every BadgeMark carry a `--ds-mut` rim precisely because of this (shell.css:7400, 7469). The plain violet hexagon was left out.
- evidence: contrast.mjs:385 checks the rim against the panel, but only for the elements that have a rim. There is no violet-against-panel pair.
- recommendation: Apply the same `stroke: var(--ds-mut); stroke-width: 1.2` to `.award-badge svg` (and `.title-chip`'s edge), and add the pair.
- contract: docs/area/accounts.md (a badge must read against the card behind it); WCAG 1.4.11.
- effort: S

##### 06-13 · P2 · Results hierarchy: the largest words say "MATCH RESULTS", and the outcome loses to the title
- where: Results.tsx:906–908 (sting "MATCH RESULTS"), :923 (h2 "MATCH RESULTS"); styles.css:1740 (`.resx-title` 5.4u), :2002 (`.resx-winbanner` 5.2u), :2179 (`.resx-total-num` 11u).
- what: The screen reads, in size order: two equal totals, then the title (5.4u), then WINNER (5.2u, the same size as the alliance label). The words "MATCH RESULTS" appear twice in succession (sting, then header), and the header adds an eyebrow and a season line. Who won is carried by a pill that arrives last, at the far top edge of the panel, away from the numbers the eye is already on. Nothing tells the local driver whether they won. The only link is a small YOU chip in the roster.
- evidence: See the size multipliers above. `versusBanner` gives the loser an empty slot and the loser's half keeps its full-strength fill and total.
- recommendation: Demote the header title to eyebrow size (the sting already announced it) and make WINNER the largest text after the totals. Consider a local-perspective line ("You won by 14") next to the actions. Optionally drop the losing total's weight (for example 700 instead of 800) so the winning number reads first without changing either alliance fill.
- contract: design-guide §3 ("big-number metric" tell: the numbers need a presentation specific to what they mean); lane brief (what matters first).
- effort: S

##### 06-14 · P2 · Celebration motion uses overshoot curves that the design guide rules out
- where: styles.css:2450–2461 (`resx-winbanner-in`, scale 0.6 to 1.08 to 1), :2462–2476 (`resx-total-punch`, 0.7 to 1.15 to 1 plus `brightness(1.5)`), :2400 (`resx-sting-in` from scale 2.6).
- what: Three overshoot or "punch" keyframes plus two brightness flashes (`resx-cell-land` at 1.9 on every breakdown value) make up a stock game-show reveal. The design guide lists "bounce/elastic easing" as a tell, and the North Star is field-control hardware, not a slot machine. ui-standard §7 also says "No animation on first paint of a list or panel", and the row cascade is exactly that, with no written exception.
- evidence: The comment at :2020 moved the overshoot out of the easing curve and into the keyframes. It is still an overshoot.
- recommendation: Settle with ease-out and no scale past 1.0. Keep the stagger, since it carries information (sections landing in order), but record the results reveal as a named exception in ui-standard §7. Drop the per-cell brightness flash.
- contract: design-guide §3 Motion; ui-standard §7.
- effort: S

##### 06-15 · P2 · The claim dialog is a stock "achievement unlocked" modal with a radial glow
- where: RewardDialog.tsx:150–173; shell.css:7580–7594 (radial-gradient glows), :7682 `.ds-modal` shadow `6px 6px 0`.
- what: The layout is: eyebrow ("BIOBUZZ Act 2 ended"), a 96px hero icon centred above a kicker ("Reward earned"), then the headline, then centred bullet lines, then a recessed list that repeats the hero badge at small size. The structure is two stacked kickers plus an icon above the heading, and the hero appears twice. The radial glow is the only gradient behind a shell card other than two page backdrops. DESIGN.md describes depth as flat. The `6px` modal shadow is a third block size next to `--ds-block` (4px) and `--ds-block-sm` (2px).
- evidence: design-guide §3: "Icon-in-rounded-tile stacked above heading"; "repeated uppercase kickers". DESIGN.md Elevation lists only block, edge and inset.
- recommendation: Remove the "Reward earned" kicker, since the eyebrow and headline already say it. Show the list only when a grant holds more than one item. Carry the tier with the existing 1px border colour plus the crest, not a glow. Use `--ds-block` for `.ds-modal`.
- contract: DESIGN.md Elevation ("Flat by default"); design-guide §3.
- effort: S

##### 06-16 · P2 · Inline spacing in JSX, which the standard bans outright, in four files of this lane
- where: ReportDialog.tsx:112 (`style={{ margin: 0 }}`); ScoreReportDialog.tsx:38, 57, 66 (`style={{ margin: 0 }}` ×3); RecordRun.tsx:217 (`maxWidth: 520`), :230 (`marginTop: -10`).
- what: Six of the literals ui-standard §1.1 bans. The negative margin exists to cancel a gap the parent owns.
- evidence: ui-standard §1.1: "`style={{ marginTop: 12 }}` is banned outright."
- recommendation: Add `.ds-report .ds-hint { margin: 0 }` (the `.star-reward .ds-hint` precedent). Fix `.ds-sub` spacing inside `.ds-title` at the parent, and give the console a width modifier class.
- contract: ui-standard §1.1, §2 ("one owner per gap").
- effort: S

##### 06-17 · P2 · Off-scale values in the report and badge CSS
- where: shell.css:6429 (`.ds-report-cap` `font: 700 10px`, below the 11px floor), :6411–6418 (`gap: 10px`, `padding: 14px`), :7373 (`.title-chip` `padding: 0 6px`, literal `font-size: 11px`), :7719 (`.rw-decal` `padding: 4px`, xl `16px`), :7545/7552 (40px/96px glyph literals), styles.css:3523 (`.sup-badge.admin { color: #ffffff }`, a hex literal).
- what: The report form sits at 10/14/10 in a system on a 4px grid with 11px as the smallest type size. The title chip uses a banned 6px, and the admin badge uses a raw hex while every sibling uses a token.
- evidence: ui-standard §2 banned list (6, 10, 14); §3 type scale; §5 "No hex literal".
- recommendation: 10 becomes `--ds-t-xs`; gap 10 becomes `--ds-s-2`; padding 14 becomes `--ds-s-4`; 6px becomes `--ds-s-1`/`--ds-s-2`; `#ffffff` becomes `--ds-blue-chip-ink`.
- contract: ui-standard §2, §3, §5.
- effort: S

##### 06-18 · P2 · "★ PERSONAL BEST" puts the OWNER glyph on the banner, right under a comment that bans a glyph there
- where: recordBanner.ts:51 (`'★ PERSONAL BEST'`), with the comment two lines above: "no glyph: … an emoji beside it says the same thing twice, in a face that is not the UI's."
- what: ★ is the owner mark (TitleChip.tsx:25 and shell.css:7361 both refuse it for exactly that reason). It is also a font glyph, which SupporterBadge.tsx:124 documents as rendering differently per platform. The same glyph-as-text problem shows up in `▶ WATCH REPLAY`, `⟲ REMATCH` (vote only; solo REMATCH has none), `⚑`, `⚖`, and `⚠` in RecordRun.
- evidence: Results.tsx:623 against :1014. The same action is written two ways.
- recommendation: Remove the ★ from PB, and remove the ⟲ so both REMATCH buttons match. Keep ▶ if you want, but use an inline SVG as SupporterBadge does.
- contract: docs/area/accounts.md (★ means owner); SupporterBadge's own inline-SVG rule.
- effort: S

##### 06-19 · P2 · The total's accessible name is on a `<strong>`, which ignores `aria-label`, and the label repeats the heading
- where: Results.tsx:566–572.
- what: `aria-label` on a generic element (`strong` has no role) is prohibited by ARIA 1.2, and most screen readers drop it. When it is read, "Red: 123" duplicates the `<h3>Red</h3>` beside it. During `totals` the visible text counts up, and before that it shows an en dash.
- evidence: ARIA in HTML: `aria-label` is not permitted on a `strong` without a role.
- recommendation: Delete the `aria-label`. The h3 plus the visible number already read "Red, 123". For a screen-reader announcement of the outcome, add one visually hidden `aria-live="polite"` line at `done` ("Red wins 123 to 97").
- contract: WCAG 4.1.2 / 1.3.1.
- effort: S

##### 06-20 · P2 · Title chip spacing: a dead selector, and no leading gap
- where: shell.css:7387 (`.title-pick > li > .title-chip`: no `.title-pick` class exists anywhere; TitlePicker uses `.title-pick-ot`), :7363 (`.title-chip` has no `margin-left`).
- what: `.sup-badge`, `.award-badge` and `.badge-mark` all carry `margin-left: 0.42em` with per-container `0` overrides. `.title-chip` carries none, so in a non-gap row it sits right against the badge before it. The one override written for it targets a class that does not exist.
- evidence: rg for `title-pick\b` finds only the CSS selector.
- recommendation: Delete the dead rule. Give `.title-chip` the family's `margin-left: 0.42em` and add it to the existing `margin-left: 0` override lists (`.lb-name >`, `.appr-preview >`).
- contract: ui-standard §2 ("one owner per gap"); §10 dead-rule debt.
- effort: S

##### 06-21 · P3 · Mixed case and terms on the results board
- where: Results.tsx:501 (totals labelled `Red` / `Blue`, sentence case), :1294 (`TOTAL` / `NET SCORE`, caps, on the same element); :289 ("Updating ELO…" next to "No rating change this match."); :976 ("RED CARD — BLUE has forfeited…").
- what: The same `.resx-total-label` is written in two cases depending on the mode. ELO and "rating" are both used for one thing. The void line uses an em dash that the copy rule prefers as a full stop, and puts the words RED and BLUE, meaning alliances, right after "RED CARD", meaning the penalty.
- evidence: docs/area/ui.md UI COPY ("PREFER A FULL STOP OR A COLON TO A DASH").
- recommendation: Use `Net score` / `Total`; pick "rating" everywhere; write "Red card. The blue alliance forfeits the match. Points are shown but do not count."
- contract: docs/area/ui.md UI COPY.
- effort: S

##### 06-22 · P3 · RecordRun error heading puts the word "start" in accent
- where: RecordRun.tsx:257 (`Couldn’t <span className="accent">start</span>`), :289–291.
- what: A two-tone headline that highlights a verb in the brand accent reads as decoration on a failure state. Separately, "Loading 3D physics…" appears twice on the loading card, in the sub (`${kind} · ${status}`) and again in the body.
- evidence: design-guide §3 (decorative emphasis); ui-standard §8 (don't restate).
- recommendation: Use plain ink for the error h1, and use the sub for `kind` only.
- contract: ui-standard §8.
- effort: S

##### 06-23 · P3 · The whole results stage is `cursor: pointer` after the sequence ends
- where: styles.css:1669 (`cursor: pointer` on `.resx-stage`); Results.tsx:901 (`onClick={skip}`, which does nothing at `done`).
- what: Once the reveal finishes, the pointer cursor promises a click that does nothing, everywhere except the button row.
- recommendation: Apply `cursor: pointer` only while `phase !== 'done'` (a `.skippable` class).
- contract: ui-standard §1.5 (a control explains itself).
- effort: S

#### Strengths (keep)
- Reduced motion is handled properly on the results screen. JS skips straight to `done` (`usePhase`, `useCountUp`, `RowVal`), and the CSS turns every entrance into a single 200ms fade, turns the infinite marquee off rather than speeding it up, and hides the sting (styles.css:2496–2520). This is the reference implementation of the ui-standard §7 iteration-count rule.
- The totals shown are the saved ones (Results.tsx:725–734), and the note separating a practice run from the server's record is honest.
- Layout stability is designed in rather than patched: the loser keeps a reserved banner slot (`min-height` tied to padding), grid tracks are percentages so the halves don't narrow at `done`, and names marquee instead of wrapping, so both halves stay level.
- The results stage follows the three-zone discipline: a fixed-dark ground with `on-field*` text, the alliance-chip ink pairs audited, and the focus-ring override for the autofocused buttons (styles.css:1687) documented with its reason.
- Badges are shape-coded as well as hue-coded (disc, hexagon, crest, ribbon), drawn as inline SVG instead of font glyphs, and rendered as siblings of the name, never inside it. `TitleMark` makes "badge + title beside every name" one component, so a surface can't quietly forget it.
- The claim dialog gets the fundamentals right: `aria-modal`, `aria-labelledby`, primary action on the right and focused, Esc postpones rather than traps, and it never mounts over a live field.
- The copy is specific and says what actually happened ("Saved on this computer. It goes to your account next time you're online."; the warning about false misscore claims shown before filing).

### 07 · Records — src/ui/Records.tsx, Leaderboard.tsx, Stats.tsx, CareerPanel.tsx, CareerView.tsx, MatchHistory.tsx, PeriodPicker.tsx, StandingCard.tsx; shell.css (1457-1481 tabs, 2041-2186 table mods/period/segs, 2388-2825 table/mh/lb/states, 4829-4862 stats, 5190-5241 touch, 6180-6321 standing); screenshots p4/p5 light+dark, desktop+mobile

##### 07-01 · P0 · The only way to watch a leaderboard replay is clicking a `<tr>`, which keyboard users cannot do
- where: Leaderboard.tsx:451-455, 511; shell.css:2459-2468
- what: A watchable record row gets `onClick` on the `<tr>` and a decorative 11px ` ▶`. The row is not focusable, has no role, and has no key handler. Match history (MatchHistory.tsx:310) does the same job with a real `Watch ▶` ghost button, so the two tables disagree about how you watch.
- evidence: the `<tr>` gets `className="ds-clickable"` and `title="Watch replay"` and nothing else. The name and robot buttons inside the row call `stopPropagation` to avoid triggering it.
- recommendation: Make the score cell's ▶ a real `<button className="ds-btn ghost mh-watch" aria-label="Watch replay, score N">`, as match history does. Keep the row hover only as a mouse convenience, or drop it.
- contract: ui-standard §1.3 (every interactive element has focus-visible); WCAG 2.1.1
- effort: S

##### 07-02 · P0 · Match history's three filter selects have no accessible name
- where: MatchHistory.tsx:211-235
- what: The Type, Result and page-size `<select>`s have no `aria-label` and no `<label>`, so a screen reader announces "combo box, All types". PeriodPicker labels its own selects correctly (`aria-label="Act"` / `"Season"`), so this panel is the odd one out.
- evidence: none of the three `ds-select` elements carries a label attribute.
- recommendation: Add `aria-label="Match type"`, `"Result"` and `"Rows per page"`.
- contract: WCAG 4.1.2 / axe `select-name`
- effort: S

##### 07-03 · P0 · The leaderboard's segmented filters do not expose which option is selected
- where: Leaderboard.tsx:362-404 (Records/Ranked, Solo/Duo or 1v1/2v2, and the six drivetrains)
- what: 12 `ds-seg` buttons show selection through `.on` colour alone, with no `aria-pressed`. The rest of the app's toggles do carry it (OptRow.tsx:65, GameView.tsx:104, Appearance.tsx:238, ControlsSection.tsx:599). There is also no group label: "Drivetrain" is a sibling span, not tied to its strip.
- evidence: rg `aria-pressed` returns 25 sites and none of them is in Leaderboard.tsx.
- recommendation: Add `aria-pressed={on}` to each seg and wrap each strip in `role="group" aria-label="Board type | Mode | Drivetrain"`. Better still, move the leaderboard onto the existing OptRow/seg helper so every segmented control gets this for free.
- contract: WCAG 4.1.2; the repo's own OptRow convention
- effort: S

##### 07-04 · P1 · Developer copy and raw error messages reach end users in every error and offline state
- where: Leaderboard.tsx:304, 335, 414; Stats.tsx:37, 101; CareerPanel.tsx:218; MatchHistory.tsx:178, 242; screenshots p4/p5 (all four)
- what: The live build tells a player to "set VITE_GAME_SERVER_URL" and "Set `VITE_NEON_AUTH_URL` to sign in". On a real failure, the body line is `e.message` verbatim ("Failed to fetch", "HTTP 500").
- evidence: p4-desktop reads "Leaderboards need the game server (set VITE_GAME_SERVER_URL)." p5 shows the monospace env var inside the empty card.
- recommendation: Follow the house rule and write "Couldn’t load the board. Check your connection and try again." Add a Retry `ds-btn`. Log `e.message` to the console. Show the env-var hint only when `import.meta.env.DEV` is true.
- contract: docs/area/ui.md UI COPY: failures are "Couldn’t <verb> + a concrete next step"
- effort: S

##### 07-05 · P1 · On a phone, the Score column starts off-screen in both tables
- where: shell.css:2490-2500 (`.mh-table` min-width 640, `.lb-scroll .ds-table` 520); p4-mobile
- what: The 520/640px floors stop the Driver cell from squeezing, but in a ~330px panel the leaderboard shows Rank, Driver and part of Robot, and match history shows When, Type and Players. Score, the column people came for, sits behind a horizontal scroll with no affordance: no fade, no sticky first column.
- evidence: at 375px the viewport is 343px, and 520 − 343 = 177px of the table is hidden, which is the whole value column.
- recommendation: Under 640px, hide the Robot column (the config is already in the expandable detail row), and in match history hide Type and When, folding the date into Players as a sub-line. Score should always be visible without scrolling. If the scroller stays, add an edge-fade mask.
- contract: ui.md phone-sweep rules (the "a name clamps" section fixed wrapping but not priority)
- effort: M

##### 07-06 · P1 · Career shows made-up numbers next to its own empty state
- where: CareerPanel.tsx:261-293 and 301-307
- what: With no games played, the five tiles still render "1000 · 1V1 ELO · Unranked · 0 games", "1000 · 2V2 ELO", "- Solo best", "- Duo best" and "0–0". Then, below them, "No games played yet this period". The 1000 is a fallback, not a rating the player holds. The panel both states the data and says there is none.
- evidence: `elo1?.rating ?? 1000`, `solo?.best ?? '-'`, and the empty `.ds-empty` is a sibling that is not an alternative to the tiles.
- recommendation: When the empty condition holds, render the `.ds-empty` in place of the tile grid. Once there is data, show absent values as "—" with "Unplaced", never as 1000.
- contract: ui-standard §6 List states (four states, one at a time)
- effort: S

##### 07-07 · P1 · The Career stats are the "big-number metric + small label ×N" AI tell
- where: CareerPanel.tsx:228-293; shell.css:4829-4862
- what: The panel is two identical `.ds-stats` grids of 7 same-size tiles, each with a 16px mono number, a 10px uppercase label and a sub-line. Lifetime values (games, playtime) and season values (ELO, bests, W–L) look the same, and the code comment even has to explain that they differ. Ranked ELO, a record best and W–L are different kinds of number that get equal weight, so nothing leads.
- evidence: the comment at 224-227 says playtime is "lifetime, not season-scoped like the tiles below", and nothing visual carries that difference.
- recommendation: Present it as a ranked-standing row list in the §6 Row anatomy (mode on the left; rating, rank and games in right-aligned tabular columns), as a small table matching the leaderboard. Solo and duo bests become a second two-row block. Move lifetime activity into the panel header or a muted line ("412 games · 31 h played, all time").
- contract: design-guide §3 (metric tile tell); ui-standard §6 Row
- effort: M

##### 07-08 · P1 · The period heading differs between the two Records tabs
- where: Leaderboard.tsx:353-358; CareerView.tsx:413; CareerPanel.tsx:194-197; p4 vs p5
- what: Leaderboard prints a 20px `h2` ("Current period · archived") and then a separate PeriodPicker labelled "Period". Career has no heading: the period sits in a mono uppercase panel title ("ACT 1 · SEASON 2 · FINAL"), and an accent-filled `FINAL` tag repeats the word next to it. When the seasons fetch fails, both fall back to the phrase "Current period", which then shows up mid-sentence in match history's empty copy ("Nothing here for Current period.").
- evidence: p4 shows the "Current period" h2. The Career screenshot has no h2. CareerPanel.tsx:195 and 197 print "Final" twice.
- recommendation: Build one period header component for both tabs: the h2 with the picker inline on the right. Drop the duplicate FINAL tag. Make the fallback label lowercase or rephrase it ("this period").
- contract: ui-standard §6 Page anatomy; "one decision, everywhere"
- effort: M

##### 07-09 · P1 · The leaderboard stacks four navigation layers in three different visual styles
- where: Records.tsx:47-65; Leaderboard.tsx:360-406; p4-desktop/mobile
- what: The screen runs search bar, underline tabs (Leaderboard/Career), h2, PeriodPicker, then pill segs for Records/Ranked, pill segs for Solo/Duo, and a pill-seg drivetrain row. Board type and mode sit in the same `ds-panel-h` with identical styling, so "Records | Ranked" and "Solo | Duo" read as one strip of four. The search bar sits above the tabs but belongs to neither.
- evidence: p4 shows two filled accent pills side by side in one header row, which look like peers.
- recommendation: Records vs Ranked is a board, not a filter, so promote it into the tab strip (Records · Ranked · Career). That leaves mode and drivetrain as the panel's filters. Move the user search into the NavRail or Profile, or beside the h1.
- contract: design-guide §4 "one decision, everywhere"; hierarchy
- effort: M

##### 07-10 · P1 · Alliance identity is carried by text colour alone in match history
- where: shell.css:2536-2541, 2569-2574; MatchHistory.tsx:48, 119-121
- what: Red and blue player names and the red/blue score halves use `--ds-red-ink`/`--ds-blue-ink` text colour with no fill or marker. The contract forbids exactly this. The winning score is shown only by weight 800 against 700.
- evidence: DESIGN.md Don'ts: "Don't tint alliance identity with text color alone — red/blue alliance meaning is carried by a filled chip". The DESIGN Chips section says the same.
- recommendation: Put a small filled `ds-chip red`/`blue` swatch or dot before each alliance group, and keep names in ink. For the score, use alliance-filled mini chips, or a W marker on the winner.
- contract: DESIGN.md Do's/Don'ts, Alliance colours
- effort: S

##### 07-11 · P1 · The ranked Games column is left-aligned proportional text next to a right-aligned mono ELO
- where: Leaderboard.tsx:438, 508
- what: `<th>Games</th>` / `<td>{games}</td>` carry no `.num`/`.r` class, so the counts use the body font, left-aligned, and the digits do not line up. The `.num` rule exists precisely for this (shell.css:2418-2425 comment).
- evidence: compare with `th.r` / `td.sc` on the value column two cells over.
- recommendation: Use `<th className="r">` and `<td className="num">`.
- contract: DESIGN.md Digits-Are-Mono; ui-standard §6 Row ("values in one column share an alignment and a format")
- effort: S

##### 07-12 · P1 · The robot expander does not announce its state, and the detail row is not associated with it
- where: Leaderboard.tsx:492-502, 514-520
- what: `.lb-robot` toggles the config row, but it has no `aria-expanded` and no `aria-controls`. The ▾/▴ glyph is read aloud as "black down-pointing small triangle".
- recommendation: Add `aria-expanded={isOpen}` and `aria-controls={detailId}`, and put `aria-hidden` on `.tw`.
- contract: WCAG 4.1.2
- effort: S

##### 07-13 · P2 · The empty-state headline has no weight, so it reads as body text
- where: shell.css:2814-2818; every screenshot in p4/p5
- what: `.ds-empty .big` sets 16px and ink-dim but no weight, so it renders at 400. "Couldn’t load the board" and "No practice runs yet" read as slightly larger body text, not as a headline, and neither is a heading element. The sizes 16/14 and padding 30/20 are also off-scale.
- evidence: in p4/p5 the headline stroke weight matches the sub-line.
- recommendation: Use `font-size: var(--ds-t-lg); font-weight: 600; color: var(--ds-ink)`, body `--ds-t-md`, and padding `var(--ds-s-6) var(--ds-s-4)`. Apply the same padding to `.ds-loading`.
- contract: ui-standard §2 and §3; §6 List states
- effort: S

##### 07-14 · P2 · The table type sits off the scale: 14px body, 10px headers and tags
- where: shell.css:2391 (`.ds-table` 14px), 2400 (th 10px), 2451 (`.ds-dt` 10px), 4857 (`.sl` 10px), 2698 (`.lb-standing-rank` 22px), 6273 (`.ds-standing-name` 17px), 6287 (cap 10px), 6246 (8px gauge marks)
- what: Every core records surface uses sizes outside the six-step scale, and 10px uppercase mono at `--ds-mut` is the smallest text in the app. These rules feed the uiaudit `off-scale-font-size` ratchet of 45.
- recommendation: Use `--ds-t-md` for body cells, `--ds-t-xs` for th, `.ds-dt` and `.sl`, `--ds-t-lg` for the standing name, and `--ds-t-xl` for the rank.
- contract: ui-standard §3
- effort: S

##### 07-15 · P2 · Your ranked standing box has square corners and an off-grid, non-mono rank
- where: shell.css:2679-2747; Leaderboard.tsx:203-232
- what: `.lb-standing` has a border but no `border-radius`, making it the only 0px-corner box in the chrome. It sits inside the panel with a full border on all four sides next to the panel's own edge. Padding is 10/14 and the rank is 22px/800 in the UI font with -0.5px tracking. The progress bar uses a literal 3px radius and a 5px height.
- evidence: DESIGN.md Shapes: "No sharp (0px) corners anywhere in the chrome"
- recommendation: Make it a full-bleed band (border-bottom only, no side borders), since it lives inside a panel. Set the rank in `--ds-font-mono` tabular, and put the padding on the grid.
- contract: DESIGN.md Shapes, Digits-Are-Mono; ui-standard §2/§4
- effort: S

##### 07-16 · P2 · Changing a filter blanks the table and the panel jumps height
- where: Leaderboard.tsx:308, 410; MatchHistory.tsx:169, 238
- what: Every seg click, page turn or filter change sets `status='loading'`, which unmounts a 25-50 row table and puts up a 30px "Loading…" line. The panel collapses and re-expands on every click. Paging makes it worse, because Prev/Next move with it and lose your pointer position.
- recommendation: Keep the previous rows mounted and fade them (opacity 0.5, `aria-busy`) while the fetch is in flight. Show `.ds-loading` only on first load.
- contract: ui-standard §1.4 (no state change may move layout), §6 List states
- effort: S

##### 07-17 · P2 · No sticky header on long tables
- where: shell.css:2398-2406
- what: The match history can show 50 rows and the leaderboard a full page, and the column headers (Score vs ELO Δ, both right-aligned numbers side by side) scroll away. In match history two adjacent unlabelled numeric columns are easy to misread.
- recommendation: Use `th { position: sticky; top: 0; background: var(--ds-panel); }`. The `overflow-x` wrapper blocks vertical sticky against the page, so either give the wrapper a max-height or drop the wrapper on desktop, where it is not needed.
- contract: table design / polish
- effort: M

##### 07-18 · P2 · The "Custom" type chip dims through opacity
- where: shell.css:2518-2520
- what: `.mh-type.custom { opacity: 0.85 }`. The contract says chips recede through border and fill, not opacity-fade, because dimming reads as disabled. The comment at MatchHistory.tsx:276-279 describes custom as "dimmed".
- recommendation: Remove the opacity. Ranked already stands out through the accent colour, so custom can stay neutral.
- contract: DESIGN.md Chips, Status variants
- effort: S

##### 07-19 · P2 · Keyboard focus looks different on the table's inline controls
- where: shell.css:1621-1637 (focus-visible list) vs `.lb-name`, `.lb-robot`, `.mh-player.link`
- what: These buttons are missing from the shared `outline: 2px accent` list, so they fall back to the UA ring. In a single row, a name, the robot chip and Watch ▶ each show a different focus ring.
- recommendation: Add `.lb-name`, `.lb-robot` and `.mh-player.link` to the shared focus-visible selector.
- contract: ui-standard §1.3; §10 debt
- effort: S

##### 07-20 · P2 · Names shift layout on hover through a border, not a transform
- where: shell.css:2542-2548, 2641-2647
- what: The dotted underline is a `border-bottom` present in both states, transparent at rest, so it takes no extra space. That part is fine. But `.mh-player.link` has no `padding-bottom` or `line-height` control, so inside `.mh-players` (baseline-aligned, gap 2px) the 1px border makes buttons 1px taller than the plain `<span>` names beside them. Linked and unlinked names in one cell sit on different baselines.
- recommendation: Use `text-decoration: underline dotted; text-underline-offset` in place of the border, on both classes.
- contract: ui-standard §1.4
- effort: S

##### 07-21 · P2 · Drivetrain spelling differs within one board
- where: Leaderboard.tsx:47 (`'X-Drive'`) vs 55 (`'X-drive'`)
- what: The filter pill says "X-Drive" and the Robot chip in the same table says "X-drive".
- recommendation: Pick one label map. `DT_LABEL` should be the shared source (it likely duplicates a builder label map, so reuse that one).
- contract: UI COPY consistency
- effort: S

##### 07-22 · P3 · Hyphen-minus used as the "no value" and negative sign
- where: Leaderboard.tsx:504; MatchHistory.tsx:291, 306, 314; CareerPanel.tsx:277, 283
- what: Empty cells print `-`, and a negative ELO Δ prints `-12` against `+12`. The house rule prefers `—`, and a real minus `−` keeps the sign the same width as `+` in tabular numerals. StandingCard already uses `−` (StandingCard.tsx:561).
- recommendation: Use `—` for none and `−` for negative.
- contract: ui.md UI COPY (dash rule)
- effort: S

##### 07-23 · P3 · CareerPanel mixes letter case in its source labels
- where: CareerPanel.tsx:232, 241, 264, 271 (`GAMES PLAYED`, `PLAYTIME`, `1V1 ELO`) vs 278, 284, 290 (`Solo best`, `Duo best`, `Ranked W–L`)
- what: `.sl` uppercases everything, so this is invisible today, but the source text is half shouted. It will show as soon as the label moves out of `.sl`, which 07-07 recommends.
- recommendation: Use sentence case throughout and let CSS transform it.
- contract: ui.md sentence case
- effort: S

##### 07-24 · P3 · A panel-title eyebrow floats outside any panel
- where: PeriodPicker.tsx:116
- what: The label "Period" uses `.ds-panel-title` (a mono uppercase panel-head style) as a free-standing form label, and nothing ties it to the selects.
- recommendation: Use a `<label>`/`.cap`, or drop it once 07-08 puts the picker in the heading row.
- contract: two components must not share a container class (CLAUDE.md gotcha, same spirit)
- effort: S

##### 07-25 · P3 · The FINAL tag borrows the YOU tag's class
- where: CareerPanel.tsx:197 (`ds-dt lb-you-tag`)
- what: The Career panel reuses the leaderboard's "this row is you" accent tag to mean "archived period". Restyling YOU would silently restyle FINAL.
- recommendation: Delete the tag (see 07-08), or give it its own modifier.
- contract: CLAUDE.md "two components must not share a container class"
- effort: S

#### Strengths (keep)
- Name clamping (`.lb-name-h`/`.lb-at` ch caps with badges as siblings) and `.sc { white-space: nowrap }`. Each is backed by a measured bug in its comment.
- The `.ds-segs.even` 3+3 grid on mobile is a deliberate, well-argued choice. The drivetrain filter never hides options behind a scroller.
- The Records tabs are honest navigation (`<nav>` + `aria-current`), not a half-built tablist.
- The loading, empty and error states exist everywhere and share one anatomy (`.ds-empty` + `.big`, `.ds-loading`). Signed-out Career still surfaces local practice replays (p5).
- Light/dark parity in p4/p5 is clean: the accent inverts correctly, and the block shadows and panel edges read in both themes. Contrast passes.
- StandingCard's design stance (the quiet single line when clean, voided events kept with a strike-through, signed deltas, the reason shown) is strong and specific to the product. The gauge has a real `role="img"` label.
- `.num`/`.sc` right-aligned tabular mono and the `.r` header/body pairing are the right primitives. They just need applying consistently (07-11).

### 08 — Profile, social, account (CODE-ONLY review: these screens need auth, so none were screenshotted)

Files reviewed: src/ui/Profile.tsx, ProfileTabs.tsx, ProfileName.tsx, ProfileFriendActions.tsx, FriendsPanel.tsx, UserSearchBar.tsx, Account.tsx, AccountReset.tsx, AccountSync.tsx, AccountVerify.tsx, AuthPanel.tsx, AuthDisabled.tsx, LinkedAccounts.tsx, YourData.tsx, TermsGate.tsx, UsernameGate.tsx, UsernameField.tsx, VerifyEmailBanner.tsx; CSS excerpts from shell.css (auth modal + forms 3672–3850, status hints 1960–2040, friends 724–1150, claim row 5946–5965, yd-* 6628–6660, focus group 1621–1637) and styles.css 3560 (`.ds-btn.danger`).

##### 08-01 · P0 · The two blocking gates are not dialogs: no role, no name, no focus containment
- where: src/ui/UsernameGate.tsx:99-100, src/ui/TermsGate.tsx:125-126 (compare AuthPanel.tsx:171-176, RewardDialog.tsx:143)
- what: `UsernameGate` and `TermsGate` render a bare `div.ds-modal` inside a full-viewport backdrop. Neither has `role="dialog"`, `aria-modal`, or `aria-labelledby`, and the title is a `span.ds-panel-title` with no id. Both are non-dismissible by design, but Tab still walks into the app behind the scrim. A screen reader gets no dialog boundary and no announced title. TermsGate has no initial focus either, so a keyboard user starts behind the scrim.
- evidence: AuthPanel and RewardDialog already use `role="dialog" aria-modal="true" aria-labelledby`. The two gates, which are the ones that block the whole app, skip it.
- recommendation: Add `role="dialog" aria-modal="true" aria-labelledby` pointing at an id on the title. Put `inert` on the app root while a gate is up, or add a small focus trap and use it in all three auth modals. Autofocus Accept in TermsGate.
- contract: ui-standard §1.3 (keyboard reachability), WCAG 2.4.3 and 4.1.2; ui.md pad-nav note ("every fix it forces is an accessibility fix").
- effort: M

##### 08-02 · P0 · Several friends-panel and account controls have no focus ring
- where: shell.css:878 `.fr-collapse`, :961 `.fr-who`, :1039 `.fr-menu > summary`, :817 `.fr-toggle`, :927 `.fr-fold > summary`; Account.tsx:412-416 `code.ds-acct-uuid` with onClick
- what: None of these selectors is in the shared `:focus-visible` group (shell.css:1621-1637), and none has a rule of its own. They are custom-styled buttons and summaries, so whatever the UA ring gives them is inconsistent at best. The `⋯` row menu is the only way to reach Unfriend or Block, and the profile-link row is the panel's main action. On top of that, `code.ds-acct-uuid` has a click handler but is neither focusable nor a button, so "click to copy" is mouse-only. The Copy button next to it covers the function, but the clickable code is a trap for anyone who tries it.
- evidence: grep of `focus-visible` in shell.css returns nothing for `fr-` or `acct`. §10 already lists "~20 interactive elements with :hover and no :focus-visible" as debt, and these rules are newer than that list.
- recommendation: Add the five `fr-*` selectors to the shared focus group. Drop the onClick and `cursor: pointer` from `.ds-acct-uuid`, since the Copy button is the control.
- contract: ui-standard §1.3 ("`:focus-visible` is not optional").
- effort: S

##### 08-03 · P0 · The username field's border fails 1.4.11; `.ds-input` fixed this for its own border
- where: shell.css:3739-3746 `.ds-username-input { border: 1px solid var(--ds-line) }` vs :3718 `.ds-input { border: 1px solid var(--ds-line-strong) }`
- what: `.ds-input` switched to `--ds-line-strong` with the comment "1.4.11: the border IS the control (tile-on-panel is 1.16:1)". The @-prefixed username wrapper strips the inner input's border and draws its own in `--ds-line`, which is about 1.6:1 against the white panel. The username box on sign-up, the blocking gate and Appearance ends up visibly fainter than the Email and Password boxes in the same form.
- evidence: the file's own comment at 3718, and `--ds-line: #c0c9c4` (shell.css:36).
- recommendation: Change `.ds-username-input` to `border-color: var(--ds-line-strong)`, and on `:focus-within` match `.ds-input:focus-visible` (transparent border plus outline).
- contract: DESIGN.md Inputs; WCAG 1.4.11; ui-standard §5.
- effort: S

##### 08-04 · P1 · Four error-text classes and two error colours for one idea
- where: shell.css:3729 `.ds-form-err` (--ds-danger, 13px), :3784 `.ds-form-hint.err` (--ds-danger, 12px), :1977 `.ds-hint.err` (--ds-red-ink), :2015 `.ds-hint .err` (--ds-danger), :5965 `.ds-claim-msg.err` (--ds-red-ink, 14px), :1080 `.fr-error` (--ds-red-ink)
- what: A form error renders in a different colour and size depending on which screen it is on. AuthPanel uses `.ds-form-err`, a 13px line that appears and disappears, while AccountReset and TermsGate use `.ds-form-hint.err`, which reserves its line. AccountVerify uses `.ds-hint.err` (red-ink). DeleteAccount uses `.ds-claim-msg.err` at 14px with a 10px margin, borrowed from the Ko-fi claim form. Light-mode `--ds-danger` is #ba1a1a and `--ds-red-ink` is #b3261e, and in dark mode they are #f2857f and #ff9d96. The difference is small, but two tokens for one meaning is exactly how this kind of thing drifts. Only `.ds-form-hint` keeps the form from jumping when an error lands, so AuthPanel's sign-in form grows by one line on every failed attempt.
- evidence: AuthPanel.tsx:203,269 vs AccountReset.tsx:423,513 vs Account.tsx:365 vs AccountVerify.tsx:207.
- recommendation: Make `.ds-form-hint(.err)` the one field/form status line and `.ds-hint.err` the one in-panel status. Retire `.ds-form-err`, and move DeleteAccount off `.ds-claim-msg`. Pick one error token (`--ds-danger` is already the "text token" per UsernameField.tsx:83).
- contract: ui-standard §1.4 (no layout move on an error state), ui.md "before you add a class, look it up".
- effort: M

##### 08-05 · P1 · The "Delete account" panel reads like every other panel
- where: Account.tsx:333-371; styles.css:3560 `.ds-btn.danger`
- what: The typed-DELETE guard is sound. Visually, though, the panel is a plain `.ds-panel` with the same header as "Reset" and "Membership", and it sits at the bottom of a long page. `.ds-btn.danger` only tints the text and a 40% border, and while disabled (which it is until DELETE is typed) it drops to 0.5 opacity, so the destructive control reads as a faded ghost button. Nothing in the panel frame (edge, title colour) marks it as the danger zone. The body is two dense `ds-hint` paragraphs, so the key sentence, "This cannot be undone.", sits at the end of an 11-item list.
- evidence: `.ds-btn.danger` is defined in styles.css (the in-match stylesheet) inside the admin block, not with `.ds-btn` in shell.css.
- recommendation: Add a `.ds-panel.danger` modifier (danger-coloured border colour and title, no width change). Lead the body with "This cannot be undone." as its own line. Move `.ds-btn.danger` into shell.css next to `.ds-btn`.
- contract: ui-standard §6 Dialog ("Destructive actions are `danger` and confirm; a confirm must name the target and the effect").
- effort: S

##### 08-06 · P1 · "Reset all settings" is a destructive action behind `window.confirm` and a neutral button
- where: Account.tsx:92-113
- what: It wipes the robot build, saved robots, autos, start positions and bindings, which is arguably more loss than account deletion for a local-only player. It is a default `.ds-btn`, not `danger`, and it confirms through the browser's native `confirm()`. That dialog is unstyled, ignores theme, gets suppressed by some embedded browsers, and is exactly the OK/Cancel "anyone can dismiss by muscle memory" pattern that DeleteAccount's own comment (Account.tsx:285-287) rejects. The panel title is just "Reset".
- evidence: two destructive actions on one page with two different confirmation models.
- recommendation: Use `ds-btn danger` plus the app's own modal (`.ds-modal` with `.ds-dialog-title` and `.ds-dialog-actions`), with the effect named and the danger action rightmost. Retitle the panel "Reset settings".
- contract: ui-standard §6 Dialog.
- effort: M

##### 08-07 · P1 · Gate and auth-modal titles are panel titles, not `ds-dialog-title`
- where: AuthPanel.tsx:179, UsernameGate.tsx:102, TermsGate.tsx:128-130
- what: The 2026-09-22 ruling (ui.md "Dialog titles") says a shell dialog's title is `.ds-dialog-title`, meaning `.ds-h2` type. All three account modals use `span.ds-panel-title`, the 15px card-header style, so the app's most consequential dialogs ("Our terms have changed") have the smallest dialog titles and are not headings at all. In the same way, their actions use `.ds-actions` (a 10px gap, off-grid, left-aligned) instead of `.ds-dialog-actions`.
- evidence: App.tsx:1897-2010 uses `h2.ds-dialog-title` and `.ds-dialog-actions` for all six shell dialogs.
- recommendation: Change the titles to `<h2 className="ds-dialog-title" id=…>` (this also covers 08-01's labelling) and TermsGate's buttons to `.ds-dialog-actions`.
- contract: docs/area/ui.md "A SHELL DIALOG'S TITLE IS ds-dialog-title"; ui-standard §6.
- effort: S

##### 08-08 · P1 · Friend search says "No players found." while it is still searching
- where: FriendsPanel.tsx:737-751, 794-796; UserSearchBar.tsx:16-29, 51-55
- what: `results` is only cleared or filled when a response lands, and there is no pending state. From the second character, "No players found." shows for the whole 250 ms debounce plus the round trip. On a cold Fly machine the comment mentions (FriendsPanel.tsx:721), that is seconds of a false negative. A rejected `searchUsers` is also swallowed (no `.catch`), so a server error reads as "no players" forever. The empty state then flips to results, which is the list-state jump §6 forbids.
- evidence: `void searchUsers(q).then(...)` with no pending flag and no catch, in both files, which duplicate each other (UserSearchBar's own doc says it copies AddFriend).
- recommendation: Share one `useUserSearch(query)` hook that returns `{status: 'idle'|'loading'|'error'|'done', results}`. Render `.ds-loading` "Searching…" and an error line. Both boxes then show the four list states.
- contract: ui-standard §6 List states (loading/empty/error/populated, same padding).
- effort: S

##### 08-09 · P1 · Unfriend and Block fire instantly, and Block has no explanation anywhere
- where: FriendsPanel.tsx:670-690 (RowMenu), ProfileFriendActions.tsx:67-72, 105-110
- what: The RowMenu comment says the destructive actions sit behind a disclosure "so a destructive action is never one stray click away". On the profile header, though, Unfriend and Block are top-level ghost buttons at full size next to Challenge, one click each, with no confirm and no undo. Block (which also unfriends and hides presence) looks identical to Unfriend. The "what blocking does" paragraph was removed from the panel (FriendsPanel.tsx:366-370), so nothing in the UI now says what Block does.
- evidence: profile header branch `isFriend`: `[✓ Friends] [Challenge] [Unfriend] [Block]`, all the same height and weight except the primary.
- recommendation: On the profile, put Unfriend and Block behind the same `⋯` menu the panel uses. Give Block a confirm that names the effect ("Block @x? They're removed from your friends and can't challenge or see you online.").
- contract: ui-standard §6 ("Destructive actions are danger and confirm; a confirm must name the target and the effect").
- effort: S

##### 08-10 · P1 · The sign-up form's first two fields ask for a name twice without saying why
- where: AuthPanel.tsx:216-229
- what: "Display name" (placeholder "On the leaderboard", optional, defaults to the email) and "Username" (required, @-prefixed) sit stacked with no visible difference between the two. The distinction (a display name can repeat, the username is the unique URL slug) lives in code comments only. Display name also has no validation, while `DisplayName` on Appearance enforces 2–24 characters (ProfileName.tsx:47). Sign-up can store a 1-character or 60-character name that the edit screen then calls invalid. The `name || email` fallback (AuthPanel.tsx:84) publishes the email's full address as the display name if the field is left blank.
- evidence: AuthPanel.tsx:84 `name: name || email`.
- recommendation: Drop Display name from sign-up (Appearance edits it, and the username can seed it), or apply the same 2–24 rule plus `maxLength={24}`. Never fall back to the email.
- contract: ui-standard §1.5 ("A control explains itself or it is redesigned").
- effort: S

##### 08-11 · P1 · Required fields and failures are not associated with their inputs
- where: AuthPanel.tsx:222-228 and 269; UsernameGate.tsx:105-111; AccountReset.tsx:490-513; ProfileName.tsx:143-173
- what: The live username status (`Available ✓` or `That username is taken.`) and the reset form's "Those two don't match." are sibling text with no `aria-describedby`, no `aria-invalid` on the input, and no `aria-live`. A screen-reader user hears none of the checker's verdicts, and the submit is just disabled. Only the sign-up checkbox gets `aria-invalid`. Colour also carries the state: `usernameHintColor` is the only signal for "Checking…" versus a verdict, except that ✓ appears on success only.
- evidence: `<span className="ds-form-hint" style={{ color: … }}>` with no id or role, in three files.
- recommendation: Give the hint an id with `aria-live="polite"`, point `aria-describedby` at it, and set `aria-invalid` for invalid/taken/blocked/mismatch. That belongs in `UsernameInput`, since it already owns the field.
- contract: WCAG 1.3.1, 3.3.1, 4.1.3; ui-standard §1.5.
- effort: S

##### 08-12 · P2 · Colour for the username hint is an inline `style`, in four places
- where: AuthPanel.tsx:225, UsernameGate.tsx:109, ProfileName.tsx:170 (`usernameHintColor` in UsernameField.tsx:84-89); also AuthPanel.tsx:279 `style={{ minHeight: 0 }}`, :285 `style={{ width: '100%', marginTop: 8 }}`, :292 `style={{ width: '100%' }}`
- what: Token colours and spacing are passed through JSX `style`. `marginTop: 8` is banned outright, and the colour strings are a JS switch over CSS tokens that should be a class (`.ds-form-hint.ok|.err`, which already exist in part).
- evidence: ui-standard §1.1 "No spacing, size or colour literal in JSX"; §9 grep `style=\{\{[^}]*(margin|padding|gap)` hits AuthPanel.tsx:285.
- recommendation: Replace `usernameHintColor` with a `usernameHintClass(status)` that returns `ok`/`err`. Add `.ds-form .ds-btn.block { width: 100% }` for the Google button and handle the embedded-browser block with a class.
- contract: ui-standard §1.1, §1.2.
- effort: S

##### 08-13 · P2 · Two display conventions for the same "status after save" line
- where: ProfileName.tsx:89-93, 154-173; shell.css:2012-2021 (`.ds-hint .ok::before, .err::before { content: ' · ' }`)
- what: `.ds-hint .ok/.err` prepends " · " for use after a leading sentence. In DisplayName the span is usually the only content, so the line reads "· Saved." or "· Couldn't …" with an orphan dot at the start. Elsewhere (AccountVerify, ExportRow) the whole paragraph is coloured instead (`.ds-hint.ok`). These are two patterns for one message, one of which shows a stray glyph.
- evidence: DisplayName hint: `{!configured && '…'}{status === 'ok' && <span className="ok">Saved.</span>}`, where `configured` is normally true, so the span leads.
- recommendation: Remove the `::before` and put the separator in JSX where a leading sentence exists (Username only), or use `.ds-hint.ok` on the paragraph.
- contract: design-guide §3 (inconsistent patterns); ui-standard §6 Row ("share an alignment and a format").
- effort: S

##### 08-14 · P2 · Raw server error strings reach the page
- where: UsernameGate.tsx:93, ProfileName.tsx:61 and 136, Account.tsx:322-326, YourData.tsx:318
- what: AuthPanel deliberately routes everything through `describeAuthError`, because "Failed to fetch" once printed under a sign-in button (AuthPanel.tsx:121-124). The username gate, both Appearance editors, Delete account and Export all `setErr(e.message)`, so the same "Failed to fetch" or an HTTP status line lands on the blocking gate and the delete panel, which are the worst places for it.
- evidence: `setErr(e2 instanceof Error ? e2.message : String(e2))` (UsernameGate.tsx:93).
- recommendation: Wrap these in the `Couldn't <verb>. <next step>` pattern (e.g. "Couldn't save your username. Check your connection and try again."), with a known-message allowlist the same way `describeAuthError` does.
- contract: ui.md UI COPY ("Failures are Couldn't <verb the thing>. plus a concrete next step").
- effort: S

##### 08-15 · P2 · Profile page hierarchy: the Account tab puts a 12-panel stack under one heading, with the Account ID given equal weight
- where: Account.tsx:53-116, 393-430
- what: The order is Verify banner, Account (email, sign out, password, UUID), Server, Desktop update, Star reward, Linked accounts, Privacy, Membership, Reset, Delete. The raw 36-character UUID with Copy sits in the first panel at the same level as the email. That is a support-only identifier getting prime space. The Account panel's rows also mix three row shapes: the email in bold ink, "Password" as a `ds-hint` label, and "Account ID" as a `p.ds-hint` over a code line. Membership shows "No membership." as a sentence and then a ghost CTA. Privacy prints two hint paragraphs around one toggle.
- evidence: §6 Row asks for "label left, value right … share an alignment and a format".
- recommendation: Make the identity panel two uniform rows (Email / Password), each label, value, action. Move the Account ID into a `.ds-fold.inset` "Support details". Group Reset and Delete under one "Danger zone" heading at the bottom.
- contract: ui-standard §6 Row and Panel; ui.md "RARE CONTROLS FOLD".
- effort: M

##### 08-16 · P2 · Profile tabs: "Profile" h1, but the tabs say Appearance/Account and the URL is /account
- where: Account.tsx:55-56, ProfileTabs.tsx:20-23; shell.css:1457-1482 `.ds-tabs`
- what: This is a naming problem more than a bug: the destination is "Profile", its public page is `/profile/<username>` (Profile.tsx), and its private settings page is also titled "Profile". A player who clicks their own name lands on a different "Profile" from the one in the rail. Separately, `.ds-tabs`/`.ds-tab` break the grid and type scale: gap 6, margin 18, padding 8/14, font 14, and a 3px border that changes the underline width. The last is colour-only, so it passes §4, but none of those values are tokens.
- evidence: the shell.css values quoted above.
- recommendation: Rename the h1 to "Settings" or "Your account" and keep "Profile" for the public page. Tokenise `.ds-tabs` (gap s-2, padding s-2 s-3, `--ds-t-md`/`lg`).
- contract: ui-standard §2, §3.
- effort: S

##### 08-17 · P2 · Modal chrome is off-grid and carries its own shadow and scrim
- where: shell.css:3673-3698
- what: The backdrop is a literal `rgba(6, 10, 15, 0.68)`, and the backdrop and modal padding is 20px (banned). The modal shadow is `6px 6px 0`, which is neither `--ds-block` (4px) nor `-sm`, so it adds one to the 14-shadow sprawl count. `.ds-form label` is a literal 12px, `.ds-input` a literal 14px (not on the 13/15 scale), and `.ds-claim-row` gap 8 / margin-top 12 are literals. The close button is a text `✕` glyph in a full-size ghost button, while the verify banner uses a `small` ghost `✕`: two sizes for one dismiss.
- evidence: evidence.md ratchets (shadow-sprawl 14, off-grid-gap 143, off-scale-font-size 45).
- recommendation: `padding: var(--ds-s-5)`, `box-shadow: var(--ds-block)`, a `--ds-scrim` token, `font-size: var(--ds-t-sm)` on labels. Decide the input size once (`--ds-t-lg` or md) and write it down.
- contract: ui-standard §2, §3, §5; DESIGN.md Elevation (one block vocabulary).
- effort: S

##### 08-18 · P2 · Sign-in modal: no focus return, and backdrop-click discards a half-typed sign-up
- where: AuthPanel.tsx:168, 44
- what: The backdrop `onClick={onClose}` plus Esc close the modal and wipe the email, username, password and ticked box, with no guard. A stray click outside a 380px card on a phone loses the whole sign-up. On close, focus is not returned to the "Sign in" button that opened it, so keyboard and pad users land on `body`. The pad-nav layer then has to find its way back from there.
- evidence: no `useRef` to the opener, and no dirty check.
- recommendation: Close on backdrop click only when the form is untouched. Restore focus to the opener on unmount.
- contract: WCAG 2.4.3; ui.md controller-navigation section.
- effort: S

##### 08-19 · P2 · The "Choose your username" gate gives no context and no way out
- where: UsernameGate.tsx:98-117
- what: The gate interrupts every session with a bare "Username" field. It does not say why it blocks, and it has no sign-out, even though TermsGate's comment argues that a required step with one option is not a choice (TermsGate.tsx:54-56). A user who signed in with the wrong Google account is stuck until they pick a username on it. The auto-suggested value is also not marked as a suggestion.
- evidence: compare TermsGate.tsx:143-150 (ghost Sign out + primary Accept).
- recommendation: Add one line saying the username is your profile address (`/profile/<name>`, not changeable by others), plus a ghost "Sign out" to the left of Save.
- contract: ui-standard §6 Dialog (actions last, primary rightmost); consistency between the two gates.
- effort: S

##### 08-20 · P2 · Your-data and Account copy runs long, and much of it narrates or reassures
- where: YourData.tsx:169-188, 232-241, 334-344; Account.tsx:182-201, 338-347
- what: The Analytics row has three paragraphs (about 140 words) for one checkbox. Export has two paragraphs before its button. Privacy has two hints around one toggle. Some of this is legally load-bearing (what survives deletion, the unanimous-consent rule), but a lot of it narrates ("Turning it off stops every beacon from this browser immediately", "this table is generated from the list the app actually uses"). §8 says descriptions are deleted, not shortened. The legal text belongs to the policy above, and the control rows should say only what the label cannot.
- evidence: ui-standard §8, ui.md UI COPY "No helper text that restates its own label".
- recommendation: Keep the consent-rule and survives-deletion sentences. Fold the analytics mechanism paragraph into the policy or a `.ds-fold.inset` "How it's counted". Cut the Export list to "Everything the servers hold for your account, as one JSON file."
- contract: ui-standard §8.
- effort: S

##### 08-21 · P2 · Linked accounts: each row is a label, a sentence and a button stacked in a `.ds-field` column
- where: LinkedAccounts.tsx:352-367
- what: Each provider renders as a caption, a hint sentence and then a small button on its own line, left-aligned under the text. That is three lines per provider, and the "Connected" state is only implied by the button reading "Disconnect". Nothing shows the linked status (a `ds-chip on` "Connected" would). The connected button turns ghost and the unconnected one is default, so the stronger button is on the row that does less. The warning "Disconnecting GitHub also removes…" is a separate paragraph below the list, away from the button it qualifies.
- evidence: §6 Row (label left, value right).
- recommendation: Use one row per provider: label, then a status chip (`Connected`/nothing), then the action on the right. Show the disconnect consequence in the row's hint only while connected.
- contract: ui-standard §6 Row.
- effort: S

##### 08-22 · P3 · AI-tell: glyph-as-status (`✓ Friends`, `Available ✓`, `Invited ✓`, `✕`)
- where: ProfileFriendActions.tsx:57, UsernameField.tsx:74, FriendsPanel.tsx:663, AuthPanel.tsx:180, FriendsPanel.tsx:194, VerifyEmailBanner.tsx:480
- what: Unicode check and cross glyphs stand in for icons and state. Configure removed decorative glyphs in the same way (ui.md "Configure copy"). The `✕` renders in the UI font at inconsistent optical sizes, and FriendsPanel already has an SVG `PeopleGlyph` for exactly this reason (its comment: "avoid platform emoji").
- recommendation: Drop the ✓ in text: the `.on` chip fill and `--ds-ok-ink` already say it. Use one small SVG close glyph for every dismiss.
- contract: ui.md Configure copy (no decorative glyph); design-guide §3.
- effort: S

##### 08-23 · P3 · "Working…" is the only non-specific busy label
- where: AuthPanel.tsx:275
- what: Every other busy label names the action: Sending…, Saving…, Deleting…, Building…, Inviting…. The sign-in and sign-up button says "Working…".
- recommendation: "Signing in…" / "Creating account…".
- contract: ui.md UI COPY (consistency ruling).
- effort: S

##### 08-24 · P3 · The profile subtitle ends in "Public profile", which restates the page
- where: Profile.tsx:63-76
- what: The sub reads `@name · Supporter · Public profile`. "Public profile" is what every visitor already knows from the URL. The role word also duplicates the `SupporterBadge` sitting in the h1 directly above.
- recommendation: Keep `@name` and drop the other two parts.
- contract: ui-standard §8.
- effort: S

##### 08-25 · P3 · `AuthDisabled` and the profile "no server" state name environment variables to end users
- where: AuthDisabled.tsx:22-24, Profile.tsx:86-87
- what: "Set `VITE_NEON_AUTH_URL` to enable sign-in…" is developer copy that shows in any build without auth, including a desktop offline fallback that a player could see. "ranked ELO" is also inconsistent with Glicko-2 and "rating" everywhere else.
- recommendation: Show a player-facing line ("Accounts aren't available in this build.") and keep the env-var hint to `import.meta.env.DEV`. Say "ranked rating".
- contract: ui.md UI COPY terminology.
- effort: S

#### Strengths (keep)
- Typed-DELETE confirmation plus an explicit "what survives" paragraph, and ONE `DeleteAccount` component shared between Account and Your Data so the copy cannot drift. The 404 fallback that points to a human mailbox is a good design.
- Password reset and forgot-password are properly enumeration-neutral, and the no-token `/account/reset` falls back to the request form instead of an error.
- `.ds-form-hint` reserves its line (AccountReset, TermsGate), so those forms do not jump. It is the right primitive, so extend it (08-04).
- `PersonRow` and `Section` are single constructions for every friend, search and suggestion row, with the badge and title as siblings of the ellipsising name. The status dot is pinned to the row start, and presence is spelled out in text, not hue alone.
- The two gates nest structurally (terms before username) and stand down on `/terms` and `/privacy`. The `TermsAgreement` sentence is shared with the sign-up checkbox.
- The verify banner uses `--ds-warn` via `color-mix` (category 1, no new palette pair), wraps on phones, and dismisses per session.
- AuthPanel routes SDK errors through `describeAuthError`, the one place that already follows the "Couldn't <verb>" rule. The sign-up consent checkbox refuses in the app's own words rather than through a native tooltip.
- Replay privacy toggle: optimistic with rollback, and its copy honestly states the unanimous-consent rule.

### 09 · Replays and spectating (code-only review: no screenshots were captured for this lane)

Files reviewed: src/ui/ReplayView.tsx, src/ui/ReplayRail.tsx, src/ui/replayOverlay.ts, src/ui/replayViewMode.ts, src/ui/PracticeReplays.tsx, src/ui/LanReplays.tsx, src/ui/WatchLive.tsx, src/ui/ShareButton.tsx; CSS in src/ui/shell.css (replay viewer 2827-2953, pen/rail 3120-3432, export menu `.ds-dl` 3434-3589, recording bar 3591-3670, seek track 4525-4580, `.ds-empty`/`.ds-loading` 2803-2825), styles.css:1346-1363 (reduced motion).
Contracts: DESIGN.md, docs/ui-standard.md, docs/area/ui.md, design-guide.md §3, docs/ui-components.md.

##### 09-01 · P0 · The delete button on replay rows is a bare "✕" with no accessible name, and it deletes on one click
- where: src/ui/PracticeReplays.tsx:205-214, src/ui/LanReplays.tsx:180-189
- what: This is an icon-only ghost button. Its only label is `title="Remove from this device"`, and it deletes the local replay log straight away, with no confirm and no undo.
- evidence: A screen reader announces the glyph ("multiplication x"). A `title` is not a reliable accessible name, and it never shows on touch. ui-standard §6 Dialog says "Destructive actions are `danger` and confirm". This button is `ghost`, sits 8px from `▶ Watch` in a table cell, and a local-only run (never uploaded) is lost for good.
- recommendation: Add `aria-label="Remove this run from this device"`. Use a text button ("Remove") or a `danger` variant. Either confirm with the shell dialog, or keep the row for about 5 s with an Undo button.
- contract: ui-standard §6 (Dialog), §1.5; WCAG 4.1.2
- effort: S

##### 09-02 · P0 · Yellow and red cards are told apart by colour alone
- where: src/ui/ReplayView.tsx:1486-1487; shell.css:3158-3166
- what: The foul chip shows a card as `■ {n}`, coloured `--ds-warn` for yellow and `--ds-danger` for red. The only difference between the two is the glyph's colour.
- evidence: `<span className="pen-card yellow">■ {t.yellow}</span>` and `<span className="pen-card red">■ {t.red}</span>`. A screen reader hears "black square 1" for both. In light theme `--ds-warn` is burnt amber (#8f5400) and `--ds-danger` is #ba1a1a, which are close for protan/deutan viewers at 11px. The rail itself spells these out ("YELLOW CARD", ReplayRail.tsx:116), so the summary row contradicts its own detail view.
- recommendation: Put the word on the chip (`YC 1` / `RC 1`, or `1 yellow`). Better: render the card as a small filled swatch (a fixed-ink chip, zone 2) with a text label next to it.
- contract: WCAG 1.4.1; DESIGN.md "Don't tint … identity with text colour alone"
- effort: S

##### 09-03 · P1 · There is no playback speed control and no transport keyboard shortcuts
- where: src/ui/ReplayView.tsx:1435-1451 (transport), 443-465 (loop runs at a fixed 1×)
- what: The transport is Play/Pause, Restart and a seek slider. It has no 0.25×/0.5×/2×/4×, no frame step, and no Space/←/→/J/K/L keys (the only key bound is T for the 2D/3D view, line 569). This is a driver-practice tool, and the main reason to rewatch is to study a moment slowly.
- evidence: `acc += dt` is used without a rate multiplier. The slider has no `step`, so the arrow keys move it 1 tick (1/60 s): a 9,000-tick match cannot be scrubbed by keyboard in practice. Space works only while the Play button happens to have focus.
- recommendation: Add a `.ds-segs` speed strip (0.25 / 0.5 / 1 / 2 / 4) and multiply `dt`. Set `step` to 1 s worth of ticks (60). Bind Space = play/pause and ←/→ = ±5 s at the viewer level (the menu's Escape handler shows the pattern). Only bind them while focus is not in an input.
- contract: product fitness (driver practice); ui-standard §1.3
- effort: M

##### 09-04 · P1 · The transport readout is a percentage, not match time, and the seek bar has no landmarks
- where: src/ui/ReplayView.tsx:1450, 661; shell.css:2946-2953
- what: The right end of the transport shows `{pct}%`. A watcher thinks in match time ("AUTO 0:12", "END GAME"), which the rail uses (ReplayRail.tsx:45-51). "37%" does not tell anyone where AUTO ends. The track has no markers for the AUTO/TRANSITION/END GAME boundaries or for penalty ticks, even though the rail already knows every penalty tick.
- evidence: `<span className="ds-replay-time">{pct}%</span>`. The seek input also has no `aria-valuetext`, so assistive tech reads the raw tick ("4312 of 9001").
- recommendation: Show `elapsed / total` in m:ss, and phase + clock if there is room. Set `aria-valuetext` to the same string. Draw phase boundaries and penalty ticks as notches in the `rangeFill` gradient, or as absolutely positioned ticks under the track.
- contract: DESIGN.md Digits-Are-Mono (already mono, which is good); WCAG 4.1.2 for valuetext
- effort: M

##### 09-05 · P1 · The Play button changes width with its state, which resizes the seek bar
- where: src/ui/ReplayView.tsx:1436-1438; shell.css:2924-2944
- what: The label cycles `❚❚ Pause` → `▶ Play` → `▶ Play again`. The button is content-sized and `.ds-replay-seek` is `flex: 1`, so every state change resizes the slider under the user's pointer. At the end of the match ("Play again", the widest label) the thumb jumps sideways.
- evidence: ui-standard §1.4 says "No state change may move layout." The `.ds-replay-controls` row also wraps, so on a phone the label change can move the slider onto a different line.
- recommendation: Give the play button a fixed `min-width` sized to its longest label. Or drop "again" (the handler already restarts from the end) so both states are the same width.
- contract: ui-standard §1.4; DESIGN.md Transform-Only Press Rule
- effort: S

##### 09-06 · P1 · The replay scoreboard's numbers are not in the mono font
- where: shell.css:2881-2907 (`.rs-num`, `.rs-mid`); shell.css:3152-3157 (`.pen-count`, `.pen-awarded`); ReplayRail `.rr-cmp-num` shell.css:3310
- what: The live score (22px) and the phase clock update 10×/s during playback. They set `tabular-nums` but no `font-family: var(--ds-font-mono)`, so they render in Plus Jakarta Sans. The penalty counts and the score editor's comparison numbers have the same problem.
- evidence: `.ds-replay-score .rs-num { font-size: 22px; font-weight: 700; … }` has no family. DESIGN.md: "Any number that updates during a match (score, clock, RTT) renders in `--ds-font-mono`." The in-match HUD and `.ds-replay-time` (shell.css:2947) both use mono, so the same viewer mixes the two faces.
- recommendation: Add `font-family: var(--ds-font-mono)` to `.rs-num`, `.rs-mid`, `.pen-count`, `.pen-awarded` and `.rr-cmp-num`. Replace the 22px with a scale step (`--ds-t-xl` 20px).
- contract: DESIGN.md Digits-Are-Mono Rule; ui-standard §3
- effort: S

##### 09-07 · P1 · The on-screen scoreboard never names the phase, and the three replay surfaces use three vocabularies
- where: src/ui/ReplayView.tsx:1344/1349 (middle shows only `clock`); ReplayRail.tsx:36-43 (`AUTO`); replayOverlay.ts:112-123 (`AUTONOMOUS`, `END GAME`); WatchLive.tsx:201-210 (`Autonomous`, `Final`)
- what: The on-screen viewer shows a bare `1:47` with no word for which period it belongs to, and no END GAME cue. The burned-in video says `AUTONOMOUS` and `END GAME`, the rail says `AUTO`, and Watch Live says `Autonomous`/`Final`. ui.md pins the overlay to the HUD's words so that a phase is spelled one way everywhere. This screen has drifted in two directions.
- evidence: `<span className="rs-mid">{done ? 'FINAL' : phase === 'post' ? 'MATCH OVER' : clock}</span>`. `hudLabels()` already computes the right phase word and is DOM-free.
- recommendation: Make the viewer's `.rs-mid` a two-line block (phase over clock) fed by `hudLabels()`, so the screen and the file cannot disagree. Point the rail's `PHASE_LABEL` and WatchLive's `phaseLabel` at one shared map.
- contract: docs/area/ui.md UI COPY › Terminology; the HUD product rule (END GAME label)
- effort: S

##### 09-08 · P1 · The burned-in video scoreboard uses the alliance fills that ui.md says fail as small type, and contrast.mjs never checks it
- where: src/ui/replayOverlay.ts:308, 336 (`COLORS.red` / `COLORS.blue`), 297/241 (`rgba(18,21,26,0.86)` plate)
- what: The 12px `RED`/`BLUE` labels and the `RED WINS`/`BLUE WINS` result are drawn in `COLORS.red` (#ef4444) and `COLORS.blue` (#3b82f6). ui.md: "`COLORS.red`/`blue` are under 4.5:1 as 12-px type on the field", which is exactly why `COLORS.redLabel`/`blueLabel` exist. Over an opaque dark field they only just pass (about 4.7:1). The plate is 86% alpha, though, and a 3D export puts it over a lit scene. Over a light background the plate becomes about #333, and blue drops to roughly 3:1.
- evidence: `scripts/contrast.mjs` has no entry for the replay overlay (it only matches the results-screen forfeit line). The two rgba literals are repeated, not tokenised.
- recommendation: Use `COLORS.redLabel`/`blueLabel` for the labels and the result. Make the plate opaque, or raise its alpha to ≥0.94 for 3D exports. Add the plate/label pairs to contrast.mjs.
- contract: docs/area/ui.md (robot-label rule); ui-standard §5 (new colour pair means a contrast.mjs entry)
- effort: S

##### 09-09 · P1 · The export menu re-implements the segmented control, and the header's 2D/3D toggle spells the same choice a third way
- where: src/ui/ReplayView.tsx:1188-1196 (header toggle) vs 1220-1262 (`.ds-dl-seg`); shell.css:3543-3580
- what: 1) `.ds-dl-seg` is a bespoke segmented strip (its own padding, radius, `.on` state and focus offset of +2px against `.ds-dl-opt`'s -2px), even though `.ds-seg`/`.ds-segs` (17 and 10 uses in docs/ui-components.md) and `OptRow` exist. 2) In the header, the SAME 2D/3D choice is a single button whose label is the current state and whose fill flips ghost↔primary with `aria-pressed`. ui.md rules this pattern out ("the word says a second time what the fill says"). A screen reader hears "2D, toggle button, not pressed", which reads as the opposite of what is on screen.
- evidence: `className={view === '3d' ? 'ds-btn small primary' : 'ds-btn ghost small'}` … `{view === '3d' ? '3D' : '2D'}`.
- recommendation: Use one component, `.ds-segs` with two `.ds-seg` buttons (2D | 3D), both in the header and in the menu's View/Camera rows. Delete `.ds-dl-seg`.
- contract: docs/area/ui.md "ONE SPELLING OF A PICK"; ui.md "Before you add a class, look it up"
- effort: S

##### 09-10 · P1 · The export popover claims ARIA `menu` semantics but only half-implements the pattern
- where: src/ui/ReplayView.tsx:1203-1209, 1269, 1279; 574-588
- what: `role="menu"` holds `role="menuitem"` options, but also `aria-pressed` toggle buttons and `<p>` notes, which are invalid children of a menu. Nothing moves focus into the menu on open, there is no arrow-key roving, and Escape closes it without returning focus to the trigger. Screen readers switch to menu mode and expect arrow keys that do nothing.
- evidence: The only keyboard handling is `if (e.key === 'Escape') setMenuOpen(false)`. ui.md makes the same argument about radiogroups: "half that pattern is worse than none."
- recommendation: Drop `role="menu"`/`menuitem`. Make it a disclosure (`aria-expanded` + `aria-controls` on the trigger, and a plain group of buttons). On Escape, return focus to the trigger.
- contract: docs/area/ui.md (ARIA pattern ruling); WCAG 4.1.2
- effort: S

##### 09-11 · P1 · A failed score correction is shown in the success colour
- where: src/ui/ReplayRail.tsx:219-222, 326; shell.css:3378-3382
- what: `setStatus(adminFail('correct the score'))` and the success message both render in `.rr-status`, which is `color: var(--ds-ok-ink)`. A moderator whose save failed sees the failure in green.
- evidence: There is one status slot with one colour, and no error variant.
- recommendation: Keep `{kind, text}`, render errors with `--ds-danger`, and add `role="status"` / `aria-live="polite"` so the result is announced.
- contract: DESIGN.md Status colours; ui-standard §6 List states (error)
- effort: S

##### 09-12 · P1 · The rail headings are ALL CAPS and the rail uses its own bespoke inputs
- where: shell.css:3191-3218 (`.rr-h`, `.rr-h4`, `.rr-cap`, all `text-transform: uppercase`); 3342-3362 (`.rr-field input`)
- what: "PENALTIES", "SCORE", "WHO PLAYED" and "ALREADY CORRECTED" are uppercase headings. ui.md allows ALL CAPS in exactly four places, and a replay rail is not one of them: "Sentence case for `ds-btn` and every heading." The score inputs are hand-styled, with no inset recess (DESIGN.md Inputs) and no focus style on the `wide` "Why" field. They are not `.ds-input`.
- evidence: `.rr-h { … text-transform: uppercase; }`. `.rr-field input { padding: 8px; border: 1px solid var(--ds-line); … }` has no `box-shadow: inset 0 2px 0 var(--ds-inset)`, and there is no `.rr-field.wide input:focus-visible` rule.
- recommendation: Put the headings on `.ds-panel-title` type in sentence case. Use `.ds-input` for all three fields and keep the red/blue focus tint as a modifier.
- contract: docs/area/ui.md UI COPY (sentence case); DESIGN.md Components › Inputs
- effort: S

##### 09-13 · P1 · The real-time recording bar is taller than the transport row it replaces, and the refit is skipped exactly then
- where: src/ui/ReplayView.tsx:529-532, 1410-1432; shell.css:3591-3604, 3664-3670
- what: `.ds-replay-rec` adds a full-width `.rec-note` paragraph (two lines at 12px), so it is roughly 40px taller than `.ds-replay-controls`. The CSS comment says "same padding, so the swap does not move the canvas". It does move it: the stage shrinks. The refit effect bails out while `recorder.current` is set, and that ref is assigned before `setRecording(true)` (line 1020). So the backing store stays at the old size and the on-screen field is squashed for the whole recording, which is the exact bug the effect's comment describes. Needs a live check, but the code path is unambiguous.
- evidence: `useEffect(() => { if (recorder.current) return; refit.current?.(); }, [recording, status, railOpen]);`
- recommendation: Keep the recording bar the same height as the transport row by moving the note into a `title` or a tooltip. Or run the refit once before `rec.start()` (resize first, then capture). Fix the CSS comment either way.
- contract: ui-standard §1.4; the code's own documented invariant
- effort: S

##### 09-14 · P2 · The replay header's title is not centred, and the spacer comment names the wrong button
- where: shell.css:2852-2859, 3441-3447; ReplayView.tsx:1148, 1181-1207, 1300
- what: The header is `space-between` with `← Back` (ghost) on the left and `[2D] [↓ Download]` on the right. `.ds-dl` has `min-width: 90px` "matches the ← Leaderboard button opposite it", but the button is "← Back" and the right group is about 170px wide for BIOBUZZ. So "Replay" sits visibly left of centre, and it moves when the save progress replaces it.
- evidence: `.ds-dl { min-width: 90px; }` with the comment "matches the ← Leaderboard button".
- recommendation: Make the header a 3-column grid (`1fr auto 1fr`, right column `justify-self: end`), and delete the spacer span and the magic 90px.
- contract: ui-standard §2 (one owner per gap, no magic literals); design coherence
- effort: S

##### 09-15 · P2 · The replay screen has no page heading, and the rail's h3/h4 hang from nothing
- where: ReplayView.tsx:1174 (`<span className="ds-panel-title">Replay</span>`); ReplayRail.tsx:83, 192, 230, 328
- what: A full-screen `position: fixed` view has no h1. The rail starts at h3. The live audit already flags heading skips elsewhere, and this screen was not captured.
- recommendation: Make the title `<h1 className="ds-panel-title">`, or give it a visually hidden h1. Make the rail headings h2 and h3.
- contract: ui-standard §6 Page anatomy; WCAG 1.3.1
- effort: S

##### 09-16 · P2 · Off-grid spacing and off-scale type across the viewer's CSS
- where: shell.css:2856, 2875-2876, 2882, 2933, 3450, 3457, 3470, 3507, 3586, 3601, 3629, 3641, 3651; `.ds-empty` 2809-2817; `.ds-replay-drift` 2840/2848
- what: 18px padding in three bars (banned). `gap: 14px` and `10px` (banned). Popover `padding: 10px`, `top: 6px`. Option `padding: 10px 12px` at `font-size: 14px`. `border-radius: 3px` literal on `.rec-track`. `line-height: 1.5` on the drift note and `.rr-note` (the standard allows 1 or 1.45). The shared `.ds-empty` is itself 30px/20px padding with 14/16px type, so every replay empty state inherits off-scale values.
- recommendation: Swap to `--ds-s-*` / `--ds-t-*` / `--ds-round-*` tokens in one pass. The replay block is self-contained, so the ratchet counts can come down in the same commit.
- contract: ui-standard §2, §3, §4
- effort: S

##### 09-17 · P2 · Error states pass raw server or exception text through
- where: ReplayView.tsx:1305-1309, 342; WatchLive.tsx:75-79, 46
- what: "Couldn’t load the replay" is followed by `{error}`, which is whatever the fetch threw (for example "Server returned 404"). Watch Live does the same. Neither gives a next step, and neither offers a retry control. The body text is a bare text node, not a sentence element.
- evidence: `setError(e instanceof Error ? e.message : String(e))`.
- recommendation: Map the known statuses (404 → "This replay was deleted or the link is wrong.", network → "Check your connection and try again.") and add a `Try again` button. Wrap the body in `<p>`.
- contract: docs/area/ui.md "Failures are `Couldn’t <verb>.` plus a concrete next step"
- effort: S

##### 09-18 · P2 · Watch Live's button labels are ALL CAPS and change width
- where: WatchLive.tsx:159-161
- what: `{status === 'looking' ? 'LOOKING…' : 'WATCH'}` on a `.ds-btn`. Buttons are sentence case. The width change also resizes the flex input beside it.
- recommendation: Use `Watch` / `Looking…` with a `min-width`, or keep the label as "Watch" and show busy state with `aria-busy` and `disabled`.
- contract: docs/area/ui.md sentence case; ui-standard §1.4
- effort: S

##### 09-19 · P2 · Live cards cram six facts into one prose line, with a different clock format
- where: WatchLive.tsx:92-97
- what: `.od` reads "DECODE · Ranked 2v2 · Driver-Controlled · 87s · 12–4 · 3 watching". The score and the seconds-left are polled live but sit in body-font prose. Time is `87s` here and m:ss everywhere else. When `timeLeft` is 0 the template leaves a double space. Driver names get no `SupporterBadge`/`TitleMark`, even though "A name always gets SupporterBadge".
- recommendation: Put the score on its own mono line (red–blue, fixed-ink chips) and the phase + m:ss clock under the title. Render names through the shared name component.
- contract: DESIGN.md Digits-Are-Mono; docs/area/ui.md (names get badges); ui-standard §6 Row
- effort: M

##### 09-20 · P2 · Watch Live's panel hierarchy is inconsistent
- where: WatchLive.tsx:62-104, 136-139
- what: The page is `ds-back` → `ds-h1 "Watch Live"` (title case) → an untitled panel → a second panel whose title is an `h2` inside `.ds-panel-body` rather than a `.ds-panel-h`. The empty state "Nothing live right now" is a headline only, with no sentence, so it misses its chance to say what shows up here (ranked and record runs) and when.
- recommendation: Rename to "Watch live". Give both panels `.ds-panel-h` titles ("Live now", "Watch a custom game"). Add the one-sentence empty body.
- contract: ui-standard §6 Page/Panel/List states; ui.md `.ds-empty` rule
- effort: S

##### 09-21 · P2 · Dragging the seek bar backwards re-simulates from tick 0 on every input event
- where: ReplayView.tsx:649-659, 1447
- what: Each `onChange` while dragging left builds a new `ReplayPlayer` and steps synchronously to the target, up to several thousand physics ticks per event. On a long match or a 3D container, scrubbing feels stuck. This is a control-feel problem, not just a performance one: the thumb lags the pointer.
- recommendation: Keep periodic snapshots (every ~5 s of ticks) and restore the nearest one. At minimum, preview on `input` and commit the seek on `pointerup`/`change`.
- contract: player-control design
- effort: M

##### 09-22 · P2 · The practice list's Physics column mixes two facts and uses an ASCII hyphen for "unknown"
- where: PracticeReplays.tsx:158-184
- what: The "Physics" header covers a cell holding both `3D` (physics) and `3D view` (renderer). They are two chips in the same `.ds-dt` style, so a row reads "2D 3D VIEW". The unknown placeholder is `-`, while the LAN list uses `—` (LanReplays.tsx:163). `.ds-dt` is `font-size: 10px`, which is off the type scale (minimum 11).
- recommendation: Split into "Physics" and "View" columns, or drop View (the footer says it does not affect comparability). Use `—` for unknown and set `.ds-dt` to `--ds-t-xs`.
- contract: ui-standard §3, §6 Row ("values in one column share a format"); ui.md typographic punctuation
- effort: S

##### 09-23 · P2 · The score editor saves through `window.confirm`
- where: ReplayRail.tsx:209-215
- what: The one irreversible admin action in the viewer uses the browser's native dialog. It is unthemed, ignores dark mode, and has no `danger` styling. The shell already has `.ds-dialog-title` / `.ds-dialog-actions`.
- recommendation: Use the shell confirm dialog, name the target and the effect (the copy already does), with a `danger` primary on the right.
- contract: ui-standard §6 Dialog; CLAUDE.md "everything themes"
- effort: S

##### 09-24 · P3 · Glyphs stand in for icons, and there are two different "play" arrows
- where: ReplayView.tsx:1148, 1206, 1437, 1439; PracticeReplays.tsx:202; ShareButton.tsx:50
- what: The viewer uses `←`, `↓`, `❚❚`, `▶`, `⟲` and `■` as text, and ShareButton uses `↗` and `✓`. `❚❚` and `⟲` render at different weights and baselines across Windows and macOS system fonts, and `↗` reads as "external link" on a share button. Screen readers speak them out ("heavy vertical bar heavy vertical bar Pause").
- recommendation: Wrap each glyph in `<span aria-hidden="true">`, or move them to a small inline SVG set used across the shell.
- contract: design-guide §3 (decisions over defaults); WCAG 1.1.1 for the spoken glyphs
- effort: S

##### 09-25 · P3 · ShareButton: the "Link copied" feedback is silent and changes width
- where: ShareButton.tsx:40-51
- what: The button toggles between `Share ↗` and `Link copied ✓` for 1.8 s. There is no live region, the width changes in a panel header, and the fallback is `window.prompt`. The `title` repeats the visible label.
- recommendation: Keep the button width fixed, announce through `aria-live="polite"`, and drop the redundant `title`.
- contract: ui-standard §1.4, §8
- effort: S

#### Strengths (keep)
- The screen is built on the shell system and themed by token. The scoreboard, pen row, rail and transport all sit on `--ds-bar` with `--ds-line`, and the alliance text uses the `-ink` siblings with a comment saying why (shell.css:2893, 3145). This follows the Three-Zone Rule.
- The burned-in overlay is deliberately separate from the chrome. It uses a fixed dark plate, the canvas-zone `COLORS`, is centred and width-capped, reserves height so it never covers the field, and `hudLabels` is pure and tested.
- The export menu gives each option's cost ("~24s", "2:31", "18 KB"), explains why 3D is disabled (the button is disabled rather than hidden, with a reason in its title), and closes on Escape or an outside press.
- Recording REPLACES the transport row instead of greying it out, and background saves report from the header so they do not reflow the canvas. Both decisions are right and documented.
- The empty and refusal states are carefully worded. They separate private, stale, future and drift cases, each with its own honest sentence, and a clean match says "No fouls" instead of hiding the row.
- The penalty timeline rows are seek buttons, the rail narrows the canvas rather than shortening it, and under 860px it moves below the field.
- The replay seek slider shares `.ds-range`'s track and thumb, including the 1.4.11 track border and the 26px coarse-pointer thumb.
- `.rec-dot` is in the reduced-motion iteration cap (styles.css:1360).

### Lane 10 · Admin suite. CODE-ONLY REVIEW (no screenshots: the lane needs auth)

Files reviewed: src/ui/Admin.tsx, AdminAnalytics.tsx, AdminAudit.tsx, adminBits.tsx, adminCharts.tsx, adminCopy.ts, AdminLive.tsx, AdminReports.tsx, AdminStanding.tsx, AdminUser.tsx; CSS in src/ui/styles.css (~3160–3820, the `adm-`/`admin-`/`ann-` block) and src/ui/shell.css (`as-` ~2980, `adm-pill.standing` 6325, `an-` ~6790–7060). Checked one server route (server/index.ts:1695) to confirm finding 10-02.

Severity is weighted for an internal tool. Two findings are P1 because they touch players (a lockout) or leave a moderation job unreachable, not because of polish.

##### 10-01 · P1 · "LOCK DOWN NOW" locks out every player on one click, with no confirm and an ordinary button
- where: src/ui/AdminLive.tsx:470-475 (and :434-440 `schedule`); Admin.tsx:503-516 (restart announce/cancel)
- what: When "Starts in" is 0, the button label changes to `LOCK DOWN NOW` and calling `apply()` at once blocks new matches, queueing and custom rooms for everyone. It is a default `ds-btn` keycap with no `window.confirm`/`confirmed()`. It is also the FIRST control on the Live tab, the tab the code itself calls "what you open during an incident". Nearly every other consequential action in the console goes through `confirmed()`, including deleting a private note (AdminUser.tsx:466). ANNOUNCE RESTART also broadcasts a banner to every connected player without a confirm.
- evidence: `<button className="ds-btn" disabled={busy} onClick={schedule}>{mins > 0 ? 'SCHEDULE LOCKDOWN' : 'LOCK DOWN NOW'}</button>`; `schedule` calls `apply` directly.
- recommendation: Put the immediate lockdown behind `confirmed('Lock down', 'every region now', 'New matches, queueing and custom rooms stop for everyone except admins.')` and style it `danger`. Keep SCHEDULE LOCKDOWN as the default action. Also think about collapsing the maintenance form to a status line plus a "Change…" disclosure, so that a destructive form is not the first thing on the incident view.
- contract: ui-standard §6 Dialog ("Destructive actions are `danger` and confirm; a confirm must name the target and the effect"); DESIGN.md Danger/Warn.
- effort: S

##### 10-02 · P1 · Moderation · records can only reach DECODE boards
- where: src/ui/Admin.tsx:662-675; src/net/api.ts:1542-1550; server/index.ts:1699
- what: The board picker is Solo/Duo × drivetrain only. `adminFetchRecords` never sends `game`, but the server reads `coerceGameId(searchParams.get('game'))`, which falls back to DECODE. So a moderator cannot inspect or delete Chain Reaction or BIOBUZZ leaderboard runs from Moderation. The only other path is one account at a time, from the user panel. Nothing on screen says which game is shown. The drivetrain `<option>`s show raw ids (`xdrive`, `overall`), and BIOBUZZ's drivetrain set may not match this hardcoded list.
- evidence: `const q = new URLSearchParams({ mode, drivetrain, limit: String(limit) });` has no `game`. The server already supports it and returns `game` in the payload.
- recommendation: Add a Game `<select>` driven by `SEASONS` (as AdminAnalytics.tsx:461 does), pass it through, and name the game in the status line ("12 entries · Chain Reaction · Solo · Mecanum"). Use display labels for drivetrains.
- contract: CLAUDE.md game-abstraction seam ("DB rows, leaderboards, records … are keyed per game").
- effort: S

##### 10-03 · P2 · Destructive styling is inconsistent: the same action is danger in one place and ghost in another, and one mass-reset is `primary`
- where: Admin.tsx:710 (record DELETE, `ghost`) vs AdminUser.tsx:606 (the identical record delete, `danger`); Admin.tsx:639 (PURGE ARCHIVED REPLAYS, `ghost`, irreversible); Admin.tsx:633-638 (START NEW SEASON/ACT, default keycaps right beside purge); AdminStanding.tsx:126 (`Clear all infractions` is `ds-btn primary`, i.e. the green brand CTA); AdminUser.tsx:383 (`Clear all records` is in the "everyday" row, even though the comment at :388 says enforcement actions are kept apart from it)
- what: A moderator cannot learn from colour which buttons are irreversible. The most sweeping reset in the standing editor gets the most inviting style in the system.
- evidence: see the lines listed.
- recommendation: One rule: irreversible or player-affecting means `danger`; reversible means ghost/default; `primary` is only for the single constructive action of a form. Move Clear all records into the enforcement row. Separate Purge from the season buttons, or give it `danger`.
- contract: ui-standard §6 Dialog; DESIGN.md "Danger / Warn: destructive actions".
- effort: S

##### 10-04 · P2 · Four confirm sites skip `confirmed()`, and the season confirm never names the season
- where: Admin.tsx:264 (start season/act), :281 (purge), :327 (retire announcement); AdminStanding.tsx:130 (clear infractions)
- what: `adminBits.confirmed(action, target, consequence)` exists so that every confirm names its target (its own doc comment says half the call sites did not). These four still build `window.confirm` strings by hand. The start-season prompt never mentions the custom title typed in the field or which Act/Season comes next, so the moderator confirms blind.
- evidence: `window.confirm(\`Archive the live leaderboards and start a fresh ${what}? …\`)`. `seasonName` is not interpolated.
- recommendation: Route all four through `confirmed()`. For seasons, name the resulting period ("Start Act 2 · Season 1 “Spring Showdown”?").
- contract: ui-standard §6 ("a confirm must name the target and the effect").
- effort: S

##### 10-05 · P2 · Seven list/row patterns for one console, while `.ds-table` sits unused beside them
- where: `.adm-table` (Admin.tsx:409, AdminLive.tsx:349, AdminAudit.tsx:149); `.admin-list/.admin-row` (Admin.tsx:596, :694); `.adm-report-list/.adm-report-item(.row)` (AdminUser.tsx:492-626, AdminReports.tsx:240-281); `.adm-notes` li (AdminUser.tsx:455, 631, 657, 716); `.sr-list/.sr-row` (AdminReports.tsx:375); `.adm-rooms/.adm-room` (AdminLive.tsx:214, 279); `.ds-table.an-table` (AdminAnalytics.tsx:524). Shared `.ds-table` is at shell.css:2388.
- what: The same object, a leaderboard record run with Watch and Delete, is an `admin-row` tile in Moderation and an `adm-report-item row` in the user panel, with different button styles (see 10-03). Recent matches look different under Live (`adm-room` card), under Reports and under the user panel. Row padding, radius (`--ds-round` vs `--ds-round-md`) and fill (`--ds-tile` vs `--ds-panel`) all differ between these families.
- evidence: styles.css:3359 `.admin-row { background: var(--ds-tile); border-radius: var(--ds-round); padding: 8px 10px }` vs :3288 `.adm-room { background: var(--ds-panel); border-radius: var(--ds-round-md); padding: 10px 14px }`.
- recommendation: Standardise on two: `.ds-table` (with `.adm-table-wrap` for scroll) for tabular data, and one card-row component (`.adm-row`) for "summary line + actions". Build a `RecordRow` and a `MatchRow` component once and reuse them in Moderation, Reports, Live and User.
- contract: frontend-consistency guide §4.3 ("the same button is the same button on every page"); ui-standard §6 Row.
- effort: M

##### 10-06 · P2 · Form controls are re-implemented five times instead of using `.ds-input`/`.ds-select`
- where: styles.css:3328 `.admin-field input`, :3339 `.admin-field select`, `.admin-textarea`, `.adm-filter` (~3240), :3372 `.admin-row input.admin-grow` (literal `border-radius: 6px`), :3597 `.adm-toolbar input`, :3744 `.adm-noteadd input`. `as-field` in shell.css. By contrast AdminAnalytics.tsx:449/461 uses `.ds-input`/`.ds-select`.
- what: Each copy sets its own background, border and padding. None has the DESIGN.md recessed inset (`inset 0 2px 0 var(--ds-inset)`) or the in-recess focus ring. `.admin-field input/select/textarea` and `.adm-filter` have NO `:focus-visible` rule (grep finds one only for `.adm-toolbar` and `.adm-noteadd`), so with the UA ring suppressed, focus on the restart, maintenance, announcement and season forms is invisible or relies on browser defaults. The Live filter (AdminLive.tsx:129) and user search (Admin.tsx:369) have a placeholder but no label or aria-label.
- evidence: see the selectors above. `.admin-row input.admin-grow { border-radius: 6px }` is a radius that is not a token.
- recommendation: Delete the bespoke input rules and put `ds-input`/`ds-select` (and a `ds-textarea`, if missing) on the elements. Keep `.admin-field` for layout only. Add `aria-label` to both search boxes.
- contract: ui-standard §1.3 (every interactive element has `:focus-visible`), §4 (no literal radius); DESIGN.md Inputs.
- effort: M

##### 10-07 · P2 · The console's CSS is split across four namespaces and two stylesheets, most of it in the in-match file
- where: styles.css has 82 `.adm-` + 26 `.admin-` + 31 `.ann-` rule lines; shell.css has 23 `.adm-` + 25 `.as-` + 5 `.sr-` + 80 `.an-`. styles.css:3127 admits "ADMIN + .ds-btn.danger are the ONLY rules in this file that are NOT in-match".
- what: `adm-` and `admin-` name the same concept (`.admin-card + .adm-stats`, `.admin-field` inside `.adm-actions`). `.adm-pill` has a base in styles.css and variants in shell.css:6325, so which rule wins depends on stylesheet load order (the `p.adm-privacy` comment at ~3300 already records one such bug). `.ds-btn.danger`, a shared variant, lives in the in-match file.
- evidence: `.adm-pill.standing` shell.css:6325 vs `.adm-pill` styles.css:3270; `p.adm-privacy` specificity workaround.
- recommendation: Move the admin block into shell.css (or its own `admin.css` imported with the lazy chunk). Rename `admin-*` to `adm-*`. Move `.ds-btn.danger` next to `.ds-btn.primary` (shell.css:1587).
- contract: ui-standard §10 (styles.css claims in-match-only; namespaces split across both sheets); ui.md "look it up in ui-components.md before adding a class".
- effort: M

##### 10-08 · P2 · Status pills use brand green for alarm states and red for neutral data
- where: styles.css:3282 `.adm-pill.queued { color: var(--ds-accent) }`, used for `LOCKED — only admins can start` (AdminLive.tsx:449), `suspended` (AdminUser.tsx:267), `charged back` (:675) and `N open` reports (AdminReports.tsx:214). shell.css:6325 `.adm-pill.standing` (red), used for the neutral `no profile row` (AdminUser.tsx:269) and a game-labelled misscore pill (AdminReports.tsx:388).
- what: A suspended account and a player waiting in a queue get the same green pill as the primary button. Meanwhile a data-state note ("no profile row") is painted alarm red. The class names describe the first use (`queued`, `standing`), not the meaning, and so drifted. `.adm-pill.standing` also uses `--ds-red`, the ALLIANCE red, as the "bad" tint.
- evidence: see lines above.
- recommendation: Rename to meaning-based variants: `.adm-pill.danger` (`--ds-danger`: suspended, locked, charged back), `.adm-pill.warn` (open reports, scheduled), `.adm-pill.ok`, and plain for neutral. Stop using `--ds-red` outside alliance identity. Where a shared status chip fits, use `.ds-chip.on/.off`.
- contract: DESIGN.md "Alliance red/blue are the only saturated accent — spend them like an alarm", Status Green distinct from accent, Three-Zone Rule.
- effort: S

##### 10-09 · P2 · Three stat-tile components, and the one polled every 5 s is not monospace
- where: `.adm-stat` (styles.css:3207; AdminLive.tsx:487, AdminUser.tsx:762), `.an-tile` (adminCharts.tsx:111; shell.css ~6790), shared `.ds-stat` (shell.css:4840, 23 uses)
- what: The Live tiles refresh every 5 s, yet `.adm-stat b` sets no family and no `tabular-nums`, so digits reflow as counts tick. Its 24px (and 18px in `.small`) is not on the type scale (xl = 20, 2xl = 28). `Tile` and `Stat` are two local components in two files rendering the same class with different props.
- evidence: styles.css:3217 `.adm-stat b { font-size: 24px; line-height: 1.1; color: var(--ds-ink); }`. `line-height: 1.1` also breaks §3 ("1 for single-line UI").
- recommendation: Reuse `.ds-stat` (or `.an-tile`) with `--ds-font-mono` + tabular-nums and `--ds-t-xl`, and move the one `StatTile` into adminBits.tsx.
- contract: DESIGN.md Digits-Are-Mono Rule; ui-standard §3.
- effort: S

##### 10-10 · P2 · Button casing is split roughly half and half, often inside one toolbar
- where: ALL CAPS: Admin.tsx:508 ANNOUNCE RESTART, :591 PUBLISH, :605 RETIRE, :634-640 START NEW SEASON / PURGE…, :674 LOAD, :707-714 WATCH/DELETE/CLEAR ALL; AdminLive.tsx:471-474; AdminReports.tsx:416-433 UPHELD/REJECT/SMITE. Sentence case: Admin.tsx:378 Search, :398/:689 Export CSV, :445 Open; all of AdminUser, AdminAudit, AdminAnalytics, AdminStanding, Reports triage.
- what: ui.md records "the admin console (29/34)" as a deliberate ALL CAPS exception. The newer panels (User, Audit, Analytics, Standing) are all sentence case, so the exception no longer describes the console. The Moderation board toolbar puts `LOAD` beside `Export CSV`.
- evidence: Admin.tsx:673-690.
- recommendation: Rule sentence case for the console (the newer majority, and the house rule), convert the older caps, and update the ui.md line to match.
- contract: ui.md UI COPY ("Sentence case for ds-btn … the admin console (29/34)"), which is now stale.
- effort: S

##### 10-11 · P2 · Heading structure: h1 jumps to h3/h4, one tab has no heading, and one eyebrow style plays three levels
- where: AdminLive.tsx:113-269 (`<h3 className="adm-h3">` straight under the page h1); AdminUser.tsx:258 (account name is an h3, sections are `<h4 className="adm-h3">`); AdminStanding.tsx:184 `as-h4`; Admin.tsx:481 (Server tab opens on a `ds-sub` paragraph with no h2); styles.css:3186 `.adm-h3` (13px/800 uppercase, mut)
- what: Section titles on Live, sub-sections of an account, and titles inside a report all look identical: a small muted uppercase eyebrow. The account's name, the most important heading on the Users tab, is a bespoke `adm-user-name` rather than `ds-h2`. Analytics uses `ds-panel-title`, a fourth system. The live audit already flags heading skips as a class.
- evidence: see lines above.
- recommendation: Every tab gets `ds-h2` (add "Server restart" to Server). Live sections and account sub-sections become `ds-h3`-level, or `.ds-panel` with `.ds-panel-h` as Analytics does. Keep `.adm-h3` only as an eyebrow, not as a heading. Make the account name `ds-h2`.
- contract: ui-standard §6 Page/Panel anatomy; the audit's heading-level WARN.
- effort: S

##### 10-12 · P2 · List states are handled differently on almost every list
- where: `ds-empty` in Admin.tsx:403, AdminAudit.tsx:134/141, AdminReports.tsx:131/138, AdminLive.tsx:63; bare `ds-hint` for empty AND error in AdminLive.tsx:212, :273 (Recent games error), :277, :346 (SessionTable empty), AdminUser.tsx:453/566/591/714. `adminCharts.tsx:184/293/357` puts `ds-empty` on a `<p>` with a `<span className="big">`.
- what: The presence error is a full `ds-empty` block. The Recent-games error one screen lower is a one-line hint in different wording ("no database, or not an admin" vs `adminFail`'s sentence). §6 requires four states with the same padding so the panel does not jump when data lands.
- evidence: AdminLive.tsx:273 `<p className="ds-hint">Couldn’t read match history (no database, or not an admin).</p>`
- recommendation: A small `ListState` helper in adminBits (loading, empty, error) that renders `ds-loading`/`ds-empty` and uses `adminFail` wording for errors.
- contract: ui-standard §6 List states; ui.md ("`.ds-empty` for an empty list").
- effort: S

##### 10-13 · P2 · Mixed button sizes (and so radii) in one row
- where: Admin.tsx:673 (`ds-btn` LOAD) beside :678 (`ds-btn ghost small` Export); AdminReports.tsx:403-433 (misscore actions full-size) vs :305-308 (report triage `small`) on the same Moderation tab; AdminStanding.tsx:126-166 (full-size) rendered inside AdminUser, whose own action rows are all `small`
- what: `.small` is the 4px radius and full-size is 8px, so neighbouring rows and even one toolbar break "two buttons in the same row may not [differ]". The standing editor visibly changes density inside the account panel.
- evidence: see lines above.
- recommendation: The console is dense, so use `.small` for every in-row and toolbar action, and full size only for a form's single submit.
- contract: ui-standard §4 ("One radius per component … two buttons in the same row may not").
- effort: S

##### 10-14 · P2 · Chart and delta colours borrow text tokens and alliance hues
- where: adminCharts.tsx:334 `SERIES = ['var(--ds-accent)', 'var(--ds-blue-ink)', 'var(--ds-purple-ink)', 'var(--ds-warn)']`, used as FILLS for stacked columns (:377) and swatches (:397); shell.css:6863 `.an-line.visitors { stroke: var(--ds-purple-ink) }`; shell.css:6823 `.an-delta.down { color: var(--ds-red-ink) }`
- what: `-ink` tokens are tuned as text on a panel, and using them as solid fills breaks the Fill-Is-Not-Text Rule. They flip lightness in dark mode (blue-ink #175cd3 → #8cb8ff), so a stacked bar changes relative weight between themes. Blue-ink reads as alliance blue on a "matches by game" chart. Purple is a hue DESIGN.md does not define. A falling metric uses alliance red. Stacked segments have no separator, so adjacent series (accent/warn in dark) touch with no gap. Credit where due: the dashed second line, `role="img"` + aria-label, the live readout and the single shared scale are all good (see Strengths).
- evidence: see lines above.
- recommendation: Define a small `--ds-viz-1..4` categorical set (fixed-ink zone, checked in `npm run contrast` against both panels) and use it for fills, strokes and swatches. Add a 1px `--ds-panel` gap between stacked parts. Use `--ds-danger`/`--ds-ok-ink` for deltas.
- contract: DESIGN.md Fill-Is-Not-Text Rule, Three-Zone Rule, alliance-red reservation; ui-standard §5 (new colour pair needs a contrast.mjs entry).
- effort: M

##### 10-15 · P2 · Explanatory prose everywhere; the Live tab is a long scroll of hints
- where: Admin.tsx:364-367, 481-484, 520-523, 530-534, 614-620 (five sentences), 656-660; AdminLive.tsx:105-111 (an arithmetic sentence under the tiles), 201-206, 236-239, 243-250 (bordered privacy box), 477-481; AdminUser.tsx:423-427
- what: Almost every section opens or closes with a paragraph that narrates what the control does. Live stacks maintenance form, 6 tiles, a formula sentence, regions, filter, two tables, guest-id essay, live rooms, a hint, 40 recent games and a privacy box: about ten blocks before the page ends, with no panels to scan by.
- evidence: e.g. AdminLive.tsx:109 "(the rest are sockets that have not identified themselves yet, still connecting)".
- recommendation: Keep the privacy scope note, since that is a real policy statement, and delete or tooltip the rest (the session maths belongs in the tile `title`s, which already exist). Wrap Live's sections in `.ds-panel` as Analytics does, and collapse Recent games by default.
- contract: ui-standard §8 ("Descriptions are deleted, not shortened").
- effort: S

##### 10-16 · P3 · Off-grid spacing and off-scale type throughout the older admin block
- where: styles.css:3186 `.adm-h3 { font-size: 13px; margin: 28px 0 12px }`; :3313 `.admin-card { padding: 18px; gap: 14px }`; :3327 `gap: 5px`; :3267 `.adm-table td { padding: 9px 10px 9px 0 }`; :3207 `.adm-stat { padding: 12px 14px; gap: 2px }`; `p.adm-privacy margin-top: 28px`; `.adm-maint-h gap: 10px`; `.admin-buttons gap: 10px`
- what: Banned values (5, 9, 10, 14, 18, 28) and literal px sizes where tokens exist. The CSS comment at styles.css:3565 already calls these "older debt". Listed so the migration in 10-06/10-07 clears them rather than copying them.
- evidence: see lines above.
- recommendation: Tokenise when the block moves (10-07). `.admin-card` should simply be `.ds-panel` with `.ds-panel-body` (`--ds-s-4`).
- contract: ui-standard §2, §3.
- effort: S

##### 10-17 · P3 · Inline colour style in JSX for the announcement preview
- where: Admin.tsx:584 `<div className="ann-item" style={{ borderLeftColor: 'var(--ds-accent)' }}>`
- what: Inline style in JSX. It is also the "thick coloured accent border on one side" pattern the design guide lists as a generic tell.
- evidence: see line.
- recommendation: A `.ann-item.preview` class, or drop the side stripe.
- contract: ui-standard §1.1; design-guide §3 tells table.
- effort: S

##### 10-18 · P3 · The lone emoji in the chrome
- where: AdminLive.tsx:223 `` ` · 👁 ${r.spectators}` ``
- what: The only emoji in the console. It renders differently per OS and is not in the mono/sans data language.
- evidence: see line.
- recommendation: `· ${n} watching`.
- contract: DESIGN.md typography split; ui.md copy voice.
- effort: S

##### 10-19 · P3 · Reasons that players will read are collected in single-line `window.prompt`s
- where: AdminUser.tsx:131 (grant), :141 (revoke, prefilled "chargeback"), :179 (suspend: "This reason is shown to them at the door"), :227+:238 (delete: typed confirm, then a second prompt for the reason)
- what: The suspension reason is the sentence a player sees at the door, yet it is typed into a native one-line prompt with no length hint, no preview and no way to edit after an error. Delete asks two prompts in a row, and cancelling the second still deletes, with an empty reason (`?? ''`).
- evidence: :238 `const why = window.prompt('Why is this account being deleted?', '') ?? '';`
- recommendation: Keep native confirm for yes/no (as adminBits argues). Put reason fields inline in the action row, as "Suspend for N days" already is, so the reason is visible, has a `maxLength`, and is required before the button enables. A cancel on the delete reason should abort.
- contract: ui-standard §6 Dialog; §1.5.
- effort: M

##### 10-20 · P3 · The Standing toggle is styled as an action in a row of actions
- where: AdminUser.tsx:377-382
- what: `Standing` flips between `ghost small` and `small primary` to show that its panel is open. In a row of Rename/Grant/Revoke/Clear, a green primary reads as "the recommended action", not "expanded". It has no `aria-expanded`.
- evidence: `className={showStanding ? 'ds-btn small primary' : 'ds-btn ghost small'}`
- recommendation: A disclosure (`aria-expanded`, caret) under the Standing tile, or the shared `on` state class used by `.ds-tab`/`.ds-seg`.
- contract: DESIGN.md Buttons (primary = the one CTA); ui-standard §1.3 state.
- effort: S

#### Strengths (keep)
- `adminBits.tsx` is well designed shared infrastructure: `usePolled` (pauses while the tab is hidden, keeps the last good data), `When` (relative on the page, absolute in the tooltip), `CopyId` with a fixed width so the label swap causes no shift, `AccountName` as the one answer to "who is this", and `confirmed()`. Finish the migration onto it (10-04) rather than adding parallel helpers.
- `adminFail()` gives the console one failure sentence that names the action, in house voice.
- The typed-confirmation guard on Delete account, and the SMITE confirm that names the target. The confirm discipline is mostly present, and 10-01/10-04 are gaps in it, not its absence.
- The analytics charts are honest and accessible: one shared scale (no dual-axis lie), the second series dashed rather than colour-only, `role="img"` with a data-bearing `aria-label`, a `role="status"` readout, axis text in mono at `--ds-t-xs`, and a lazy chunk so admin weight stays out of the client bundle. AdminAnalytics is also the one panel on the shared `ds-panel`/`ds-input`/`ds-select`/`ds-table` components, which makes it the template for the rest (10-05, 10-06, 10-11).
- The tabs reuse `.ds-tabs/.ds-tab` with correct `role="tab"`/`aria-selected`, and hash-based URL state makes a tab plus an account pasteable.
- The account panel is read-heavy first and actions after, and the suspension line sits above the ranked lock. That is the right hierarchy for a decision screen.

### Lane 11 · Peripheral pages and banners

Reviewed: src/ui/Download.tsx, Donate.tsx, Sponsor.tsx, Legal.tsx, Changelog.tsx, Contributors.tsx, Announcements.tsx, MaintenanceBanner.tsx, ServerNoticeBanner.tsx, LanBanner.tsx, DesktopUpdate.tsx, AdSlot.tsx, markdown.tsx, AppShell.tsx (footer); CSS in shell.css (footer 1483-1525, 5166-5196, download 5617-5655, sponsor 6544-6622, ds-perks 5924) and styles.css (legal-warn 104, server-notice 3066, ds-maint 3156, md/legal-md 3879-3950, ann-* 3787-4075, ds-lan-banner 4160). Screenshots: p10 and p11 (light/dark, desktop/mobile), p0 (light desktop/mobile) for the footer and the home sponsor lockup. Audit reports (light and dark).

##### 11-01 · P0 · The Markdown renderer hard-codes heading levels, so /terms and /privacy go h1 → h4
- where: src/ui/markdown.tsx:134-139 (`heading()`); src/ui/Legal.tsx:20,34; audit `/terms — headings [1,4,4,4…]`
- what: `#` always renders as `<h3>`, `##` as `<h4>`, and `###+` as `<h5>`, whatever page hosts it. The offset was tuned for announcement cards, where the card title is an `h2` (Announcements.tsx:120, Changelog.tsx:74). Legal pages have only an `h1` above the document, so every section heading skips two levels. The CSS comment at styles.css:3939 says the renderer "downshifts a level so these sit under the page's own .ds-h1". It actually downshifts two.
- evidence: the audit flags h1→h4 on /terms in both themes. Screen-reader heading navigation on the longest document in the app lands on thirteen level-4 headings with no parent.
- recommendation: give `Markdown` a `baseLevel` prop (the level `#` maps to). Legal passes 2, so `##` becomes h3 (or rewrite TERMS_MD/PRIVACY_MD so `##` becomes h2). Announcements and Changelog keep 3. Map the class from the level that is emitted, not from the source level.
- contract: WCAG 1.3.1 / 2.4.6. docs/ui-standard.md §6 Page anatomy (`ds-h1` → panels).
- effort: S

##### 11-02 · P1 · The footer's legal and download destinations are `<button>`s, not links
- where: src/ui/AppShell.tsx:191-228 (`.ds-foot-link` buttons with `onClick={onPrivacy}` etc.)
- what: Download, Contributors, Privacy, Terms and Changes navigate by React state from buttons. They have no `href`, so you can't middle-click or open them in a new tab, no URL shows on hover, and a crawler or an AdSense reviewer sees no link to /privacy or /terms from any page. The current page gets no `aria-current` either (on /download the footer's "Download" looks the same as every other item).
- evidence: Legal.tsx:14-15 says "this page must stay reachable without an account and without JavaScript-gated routing". The footer, which is the only way to reach it, is JS-gated.
- recommendation: render `<a href="/terms">` (etc.) with an onClick that calls `preventDefault` and routes. Add `aria-current="page"` plus an ink-colour state for the active item. The consent link stays a button because it performs an action.
- contract: docs/area/monetization.md (live privacy policy is an AdSense prerequisite). HTML semantics: navigation is a link.
- effort: S

##### 11-03 · P1 · Footer sponsor mark is a 14px-tall tap target, left out of the phone touch sweep
- where: src/ui/Sponsor.tsx:257-263 (`h={14}`); shell.css:5188-5196 (mobile touch-target block bumps `.ds-foot-link` to 33px, but not `.sponsor-mark`); audit `a.sponsor-mark 155x14` on 11 of 12 pages
- what: the phone touch sweep deliberately gives footer links 33px of tap height ("a thumb does not hit a 17px link"). The sponsor mark sits beside them in the same footer at 14px. That is the contracted `footer` placement, and each missed tap is a lost `sponsor_click`.
- evidence: audit touch-target WARN in both themes. The WCAG 2.5.8 spacing exception probably saves it on paper, because nothing else tappable is within 24px, but it is inconsistent with the app's own 32px rule for this breakpoint.
- recommendation: inside the same `@media` block add `.ds-foot-sponsor .sponsor-mark { padding: 8px 0; }`. Padding only, so the logo box and shiftaudit are unaffected.
- contract: shell.css touch-target sweep comment (5178-5186). WCAG 2.5.8.
- effort: S

##### 11-04 · P1 · The three banners are three components with three anatomies
- where: MaintenanceBanner.tsx:66-71 + styles.css:3159-3172; LanBanner.tsx:137-152 + styles.css:4160-4187; ServerNoticeBanner.tsx:113-116 + styles.css:3066-3091
- what: 
  - `.ds-maint`: 10px/14px padding and gap 10 (both off-grid), `font-size: 13px` literal, border `--ds-warn`, emoji icons.
  - `.ds-lan-banner`: 8px/12px padding and gap `--ds-s-2` (on-grid), `--ds-t-md`, border `--ds-line-strong`, a `⇄` glyph.
  - `.server-notice`: a floating fixed pill at z-2000 with 8px/18px padding, a saturated amber/red fill, and a blurred drop shadow.

  Maintenance and LAN sit in the same slot and both claim "same anatomy" (styles.css:4156), yet their height, inset and icon treatment all differ.
- evidence: styles.css lines cited. Side by side, a scheduled-maintenance strip is 4px taller than the LAN strip.
- recommendation: one `.ds-banner` block (padding `--ds-s-2 --ds-s-3`, gap `--ds-s-2`, `--ds-t-md`/600, `--ds-round-md`, tile ground) with tone modifiers `.warn`, `.danger`, `.info` that change only the border colour. Maintenance, LAN and the server notice all render through it. Keep the separate class names as aliases if the "don't fold them" reasoning at 4156 matters, but share the geometry.
- contract: docs/ui-standard.md §2 (banned 10/14/18), §1.2 tokens. design-guide §4.3 "one decision, everywhere".
- effort: M

##### 11-05 · P1 · ServerNoticeBanner ignores the theme system and the no-blur rule
- where: styles.css:3066-3091
- what: `background: rgba(251,191,36,.96)`, `color: #14161a`, `.urgent` `rgba(239,68,68,.97)` with `#fff`, and `box-shadow: 0 6px 24px rgba(0,0,0,.45)`. These are hex/rgb literals, a blurred shadow, and colours outside the token set and outside `scripts/contrast.mjs`. White on `#ef4444` is about 3.8:1, which fails AA for 13px bold text.
- evidence: DESIGN.md "No-Blur Rule". ui-standard §5 "No hex, rgb() … literal". The contrast audit reports ALL PASS only because this pair is not in it.
- recommendation: use `--ds-gold` with its fixed ink for the info state and `--ds-red`/`--ds-danger` with `--ds-accent-ink` for the urgent one, replace the blur with `--ds-block`, and add both pairs to contrast.mjs. Better still, fold it into 11-04's `.ds-banner` as a fixed-position variant.
- contract: DESIGN.md No-Blur Rule, Three-Zone Rule. ui-standard §5.
- effort: S

##### 11-06 · P1 · The server-notice countdown is a live region that re-announces every second
- where: ServerNoticeBanner.tsx:85-88, 113 (`role="status"` whose text changes on a 1s interval)
- what: `role="status"` is `aria-live="polite"`, and the text is rewritten every second ("… in 4:59", "… in 4:58"). Screen readers queue an announcement per tick for the whole countdown. The `⚠` icon is also not `aria-hidden`, so it is read as "warning sign" each time.
- evidence: code as cited. MaintenanceBanner avoids this only because its minute count changes when the presence poll lands.
- recommendation: put the live region on a stable sentence ("Server restart scheduled at 21:40") and render the ticking `m:ss` in an `aria-hidden` span, or announce only at a few thresholds. Mark the icon `aria-hidden`.
- contract: WCAG 4.1.3 (status messages) used responsibly. 2.2.2.
- effort: S

##### 11-07 · P1 · "What's new": Enter closes the dialog from anywhere, including a focused link in the notes
- where: Announcements.tsx:99-108 (window keydown: `Escape` or `Enter` → `preventDefault(); onClose()`), :112 (`role="dialog"`, no `aria-modal`, no initial focus); CinematicReveal :66-74 (Space and Enter do the same)
- what: patch notes are Markdown with `[links](…)`. Tabbing to one and pressing Enter cancels its activation and dismisses the modal. That dismissal also marks everything seen, so the notes never come back. The dialog doesn't take focus or trap it, so focus stays on the page underneath.
- evidence: code as cited. `md-link` has no keydown guard.
- recommendation: close only on Escape and on the "Got it" button (autoFocus that button). Set `aria-modal="true"` and `aria-labelledby` on the first title, and trap focus the same way the shell dialogs do. Space and Enter on the cinematic reveal are redundant with its autoFocused CONTINUE button, so drop the window listener except for Escape.
- contract: WAI-ARIA dialog pattern. ui-standard §6 Dialog.
- effort: S

##### 11-08 · P1 · DesktopUpdate uses the banned "label carries the state" toggle
- where: src/ui/DesktopUpdate.tsx:208-212 (`<button class="ds-opt …">Auto-check for updates {ON|OFF}</button>`)
- what: this is exactly the pattern docs/area/ui.md rules out: "a single tile whose LABEL carried the state (`Auto intake ON`) … the bad one". Configure moved to `ToggleRow`, and this panel was missed. It is also a one-item `.ds-opts` grid, and the "Desktop app" panel mixes a chip, an opt tile, and keycap buttons.
- evidence: ui.md "ONE SPELLING OF A PICK: OptRow / ToggleRow".
- recommendation: `<ToggleRow label="Auto-check for updates" value={autoCheck} onChange={toggleAuto} />`.
- contract: docs/area/ui.md Configure rule 1.
- effort: S

##### 11-09 · P1 · Legal prose breaks the house punctuation rule: 46 ASCII " - " dashes
- where: src/legalText.ts (46 occurrences of ` - ` vs 14 of `—`), e.g. :153, :167-203 (every definition bullet), :442 "DSIM - the website"; :321 ASCII `"` beside curly `“Your data”`; p11 screenshots, first line
- what: the first sentence a visitor reads on /terms is "use of DSIM - the website, the multiplayer service…". The copy rules say typographic punctuation, and prefer a full stop or colon over a dash. The bullets (`**Identity** - your email…`) want a colon.
- evidence: rg counts above. Visible in all four p11 screenshots.
- recommendation: bullets `**Identity**: …`; appositives become sentences or `—`; `"…"` becomes `“…”`. Editing the copy does not require moving `LEGAL_UPDATED` (monetization.md: move it only for a material change).
- contract: docs/area/ui.md UI COPY (typographic punctuation; prefer full stop/colon to a dash).
- effort: S

##### 11-10 · P1 · The legal document's measure is capped but its card is not, leaving a dead 220px band
- where: styles.css:3933-3937 (`.legal-md { max-width: 68ch }`) inside a `.ds-panel` that stretches to ~927px; p11-desktop (both themes)
- what: the text stops around 690px and the bordered panel runs another ~220px of empty surface to its right edge. The card reads as unfilled rather than as a composed reading column. On mobile it is fine.
- evidence: p11-desktop light/dark: the right quarter of the card is empty for its whole height.
- recommendation: cap the container instead of the text, e.g. `.legal-page .ds-panel { max-width: calc(68ch + 2 * var(--ds-s-4)); }`, or drop the panel for legal pages and let the prose sit on the page ground under the h1. Documents rarely need a card.
- contract: design-guide §3 (nested/decorative containers). ui-standard §6.
- effort: S

##### 11-11 · P2 · Long-form type sits off the type scale and off the prose line-height
- where: styles.css:3879-3950
- what: `.md` is 14px / line-height 1.55. `.legal-md` is 14px / 1.65 and its comment says it "enlarges" the base, but the size is the same. Headings are 16px and 14px, `.ann-item-title` is 17px, `.md-code` uses a 5px radius and a raw font stack instead of `--ds-font-mono`, and margins are 26/14/10/6/5px. The standard says six sizes (11/12/13/15/20/28) and line-height 1.45 for prose. The audit's one-off 17px comes from here.
- evidence: audit "one-off font sizes 24/17". ui-standard §3, §4.
- recommendation: body `--ds-t-md` or `--ds-t-lg` for legal; section heads `--ds-t-lg`/800; `.ann-item-title` `--ds-t-lg`; line-height 1.45, or amend §3 to allow a legal-reading exception in writing; `.md-code` `--ds-font-mono`/`--ds-round-sm`; margins on `--ds-s-*`.
- contract: docs/ui-standard.md §3, §4, §2.
- effort: S

##### 11-12 · P2 · On the download page the hero card sits lower than the cards it outranks
- where: shell.css:5628-5636 (`.ds-dl-hero`: 1px border, `linear-gradient(160deg, tile, panel)`, no shadow) vs `.ds-opt` cards below (block shadow); p10-desktop and mobile
- what: the four secondary build cards carry the hard offset shadow and look raised. The featured card has no shadow, a gradient fill, and a lighter border, so it reads as recessed. It is also the only gradient surface in the chrome, and the featured build shows up twice (hero button plus "Windows · Installer" first in the grid).
- evidence: p10 screenshots in both themes: the hero is flat and grey-washed while the cards below cast shadows.
- recommendation: flat `--ds-panel` ground with `--ds-block` (or an accent-tinted edge) on the hero. Drop the gradient. Either leave the featured build out of the grid or mark its card as `.on`. Padding 22 → `--ds-s-5` and gaps 18/6 → `--ds-s-4`/`--ds-s-1`.
- contract: DESIGN.md Elevation (one depth model, block/edge). ui-standard §2.
- effort: S

##### 11-13 · P2 · The build cards are tall boxes with a stray arrow in the corner
- where: Download.tsx:35-41; shell.css:4459-4463 (`.go` 15px accent `↓`); p10-desktop
- what: each card is ~86px tall for two short lines. The 15px `↓` is pushed to the bottom-right by the tile's min-height, far from the label it belongs to. On mobile (p10-mobile) "Windows · Installer" wraps to two lines at 375px and the cards go ragged. The `.go` font-size 15 is a literal.
- evidence: p10-desktop / p10-mobile.
- recommendation: use a list of rows (label left, format and size right, arrow inline) per ui-standard §6 Row, or `.ds-opts` single-column under 480px. Shorten the labels to "Installer"/"Portable" under a "Windows" group so nothing wraps.
- contract: ui-standard §6 Row / Option grid.
- effort: M

##### 11-14 · P2 · Maintenance banner uses colour emoji (⛔ / 🛠), which the download page removed for the same reason
- where: MaintenanceBanner.tsx:68
- what: Download.tsx:79-85 records why the 🖥️ went: an emoji renders in the OS font, ignores the theme and `currentColor`, and differs per platform. The banner on every menu screen still leads with two. LAN uses a text glyph and ServerNotice uses `⚠`, so there are three icon approaches in one family.
- evidence: code as cited.
- recommendation: no icon (the border tone and the copy carry it), or one monochrome inline SVG shared by the banner family in `currentColor`.
- contract: the Download.tsx precedent. design-guide §4.3.
- effort: S

##### 11-15 · P2 · Banner and footer interactive elements lack their own :focus-visible and :active states
- where: `.ds-lan-leave` (styles.css:4173-4187: hover only), `.ds-foot-link` (shell.css:1483-1494: hover only), `.md-link` (styles.css:3925-3926: hover only), `.ann-cinema-btn` (no focus-visible)
- what: they fall back to the UA ring (no global outline reset exists, so nothing is invisible), but they don't match the accent 2px ring every `.ds-btn`/`.sponsor-mark` uses. `.ds-lan-leave` is also 4px/8px on 12px type, about 22px tall and under 24px on touch.
- evidence: grep finds no `:focus-visible` rule for these selectors.
- recommendation: add them to the shared focus list at shell.css:1621-1634. Give `.ds-lan-leave` min-height 32px on the phone breakpoint, or reuse `.ds-btn.small`.
- contract: ui-standard §1.3 (all four states).
- effort: S

##### 11-16 · P2 · Cinematic reveal is the app's one "AI-tell" set piece
- where: Announcements.tsx:81-91; styles.css:3960-4050
- what: `✦ A NEW SEASON ✦` letter-spaced eyebrow, a radial glow with `filter: blur(20px)` breathing infinitely, a title with `text-shadow` glow and blur-in, a gradient sweep line looping forever, and a pill CTA with a glow shadow. That is the "glowing accents on dark" pattern design-guide §3 names, and it breaks DESIGN.md's No-Blur rule and keycap language (the CONTINUE button is a glowing pill, not a keycap). Literal `#05070b` appears four times.
- evidence: CSS lines cited.
- recommendation: keep the moment and make it DSIM's. Use the field-control display vocabulary: dark scrim (`--ds-on-field` family), season name set big in the UI face, a keycap `.ds-btn.primary`, and one reveal transform with no looping glow or sweep. If a loop stays, cap `animation-iteration-count` outside reduced-motion too.
- contract: design-guide §3 Color & type / Motion. DESIGN.md No-Blur Rule, Buttons.
- effort: M

##### 11-17 · P2 · "What's new" panel uses a blurred shadow, a pop animation and an off-grid inset
- where: styles.css:3822-3836 (`box-shadow: 0 24px 60px rgba(0,0,0,.35)`, `padding: 22px 24px 20px`, `animation: ann-pop … cubic-bezier(0.2,1,0.3,1)` overshoot, `background: var(--panel)` alias)
- what: every other shell dialog uses `.overlay-panel` + `ds-dialog-title` + `.ds-dialog-actions`. This one invents its own chrome: blur, spring overshoot, asymmetric padding, and the legacy `--panel` alias. Its only button is a secondary "Got it" with no primary.
- evidence: docs/area/ui.md "A SHELL DIALOG'S TITLE IS ds-dialog-title".
- recommendation: rebuild on the shared dialog classes: `--ds-block`, `--ds-s-5` padding, ease-out fade only, and "Got it" as `.ds-btn.primary`, rightmost.
- contract: DESIGN.md No-Blur. ui-standard §6 Dialog, §7 Motion.
- effort: S

##### 11-18 · P2 · Changelog duplicates the announcement item markup and mislabels its offline state
- where: Changelog.tsx:7-11, 69-78 vs Announcements.tsx:14-18, 115-123; Changelog.tsx:57-60
- what: `KIND_LABEL` and the whole `<article class="ann-item">` block are copied verbatim in both files and will drift. With no game server configured, the page says "No changelog yet", which is false (the changelog exists, it just isn't reachable here), and both empty states omit the required one-sentence line.
- evidence: ui.md "`.ds-empty` … `.big` headline … then one sentence".
- recommendation: export an `AnnouncementItem` from Announcements.tsx and use it in both places. Offline copy: "Changelog unavailable" plus "It loads from the game server, which this build isn't connected to." and a link to GitHub releases.
- contract: ui.md UI COPY (.ds-empty). ui-standard §6 List states.
- effort: S

##### 11-19 · P2 · "Privacy" and "Privacy & cookie settings" are two footer items that usually go to the same page
- where: AppShell.tsx:205-212, 245-258
- what: outside the EEA/UK/CH (most visitors), the consent link falls back to `/privacy#your-data`, one item after a "Privacy" link to `/privacy`. Six links at equal weight with a duplicate make the footer read as legal boilerplate. The label is fixed by the policy text, which the comment acknowledges.
- evidence: p0/p10/p11 footers.
- recommendation: keep both (it is legally named), but group them: legal links (Privacy · Privacy & cookie settings · Terms) set at `--ds-t-sm` `--ds-mut`, product links (Download · Contributors · Changes) at the current weight. Hierarchy by weight and position, per the comment's own "promote it by POSITION".
- contract: design-guide §4.3. The footer comment at AppShell.tsx:218-225.
- effort: S

##### 11-20 · P2 · The footer's brand line mixes two mono treatments and wraps untidily on phones
- where: AppShell.tsx:183-189; shell.css:1508-1511 (`.ds-foot-brand` mono 13px mixed case) + 6575-6585 (`.sponsor-pre` mono 11px 700 caps 0.12em); shell.css:5170-5178
- what: "DSIM · DECODE 2025–26" (13px regular mut) runs straight into "PRESENTED BY" (11px bold tracked caps) on one baseline with an 8px gap. It reads as one run in two sizes. On mobile the centred wrapped stack puts the sponsor mark alone on a line, and p0-mobile shows the footer cut off at the fold.
- evidence: p0/p10/p11 desktop footers.
- recommendation: separate the credit with a `·` or `--ds-s-4`, or put it in its own flex item so it wraps as a unit. Align the caps treatment to `--ds-t-xs` for both parts.
- contract: ui-standard §3.
- effort: S

##### 11-21 · P3 · `.legal-warn` is off-grid and off-scale
- where: styles.css:104-113 (`padding: 10px 14px; font-size: 13px; line-height: 1.5; margin: 0 0 16px`)
- what: the unfinished-terms warning (visible to every visitor while the placeholders are unfilled) doesn't match the banner family or the tokens.
- recommendation: `.ds-banner.warn` from 11-04, or `--ds-s-2 --ds-s-3` / `--ds-t-md` / line-height 1.45.
- contract: ui-standard §2/§3.
- effort: S

##### 11-22 · P3 · Contact email in the Terms/Privacy is bold text, not a mailto link
- where: src/legalText.ts:438, :448, :541 (`**${LEGAL_CONTACT}**`); p11 "you can reach a human at genius0412.tech@gmail.com"
- what: the one action the page invites is a copy-paste job, and on mobile the address is a long, unbreakable bold word. The renderer supports `[x](mailto:)` (markdown.tsx:25-27).
- recommendation: `[${LEGAL_CONTACT}](mailto:${LEGAL_CONTACT})`. Also, `md-link` forces `target="_blank"` on every link, including mailto and same-origin; open only `https?://` links in a new tab.
- contract: markdown.tsx safeHref subset.
- effort: S

##### 11-23 · P3 · Literal sizes in peripheral CSS the ratchet will keep counting
- where: `.ds-perks` 14px and gap 8 (shell.css:5924-5931); `.ad-slot-label` 10px and 1.2px tracking (styles.css:126-132); `.ann-badge` 10px (styles.css:3803); `.menu-ad` margin 32/8 (fine); `.cl-list` gap 14; `.ann-item` 12px 16px
- what: small individual drift that adds to the `off-scale-font-size 45` / `off-grid-gap 143` ratchet counts.
- recommendation: move to `--ds-t-xs`/`--ds-t-md` and `--ds-s-3`/`--ds-s-4`. Lower the uiaudit baselines in the same commit.
- contract: ui-standard §2/§3. uiaudit ratchet.
- effort: S

##### 11-24 · P3 · Sponsor mark's accessible name reads "Presented by Offset logo", and nothing says it opens a new tab
- where: Sponsor.tsx:168-183, 321-347
- what: the name is caption text plus `alt="{name} logo"`, so screen readers hear "PRESENTED BY Offset Robotics logo, link". "logo" is noise in a link name, and `target="_blank"` has no cue. The `title` duplicates the name as a hover tooltip.
- recommendation: `alt={SPONSOR.name}`, drop `title`, and add a visually hidden "(opens in new tab)". Leave the events and UTM untouched.
- contract: WCAG 2.4.4 / G201.
- effort: S

#### Strengths (keep)
- Sponsor placement is disciplined. It sits under the builds on /download, not above them (Download.tsx:111-115). There's no sponsor on the home screen's ad slot and no home ad at all (AppShell.tsx comment). Logo boxes are reserved from `logoW/logoH` so nothing shifts, a dual-img swap handles the theme, the dark cut gets `alt=""` so the logo isn't announced twice, and hover/press state is colour and opacity only. Impressions are counted on MRC-viewable, not on mount. That is honest measurement.
- Ads fail closed and reserve exact boxes, including the label (AdSlot.tsx). `MenuAd` removes its own margin when inactive, so an ad-blocked page shows no telltale gap.
- The Markdown renderer emits React elements only, with a `safeHref` that rejects protocol-relative URLs. `overflow-wrap: anywhere` keeps long URLs inside the panel on 320px.
- Copy is lean and specific throughout: Download's removed emoji and chips, Donate's refusal to list unbuilt perks or splice a placeholder price into a sentence, Contributors' "rows not cards" for third-party credits. The comments are an unusually good record of why things were cut.
- Light/dark parity on p10/p11 is clean: the same structure, legible edges on the dark panel, and the accent inverts correctly on the primary button.
- The unfinished-terms warning is deliberately visible to everyone rather than dev-only. That is the right call.
- Footer links wrap and grow to 33px tap height on phones. The horizontal-overflow bug is fixed and documented.

### Lane 12 · Tutorial and onboarding — CODE-ONLY review (no screenshots captured for the tutorial, in-match HUD or 3D view)

Files reviewed: src/tutorial/{types,runner,hints,flag,index}.ts · src/ui/TutorialCard.tsx · src/ui/tutorial.css · src/ui/predict.css · src/ui/MatchStrategy.tsx (class usage only) · src/ui/ModeSelect.tsx (first-run offer) · src/ui/ControlsSection.tsx:639-650 (Tutorial panel) · src/ui/GameView.tsx:707-718, 556-627, 1150-1160 · src/games/decode/tutorial.ts · src/games/biobuzz/tutorial.ts (steps) · styles.css:205-236 (3D scrim), 1319-1360 (.game-btn) · scripts/contrast.mjs hudPairs · src/input/bindings.ts keyLabel.

Contrast figures below are computed by hand with the WCAG formula from the token hexes. Nothing was rendered.

##### 12-01 · P0 · Step counter, nudge and focus ring go under AA on the 3D scrim in the light theme
- where: src/ui/tutorial.css:68 (`.ds-tut-step` color `--ds-accent`), :95 (`.ds-tut-nudge` color `--ds-warn`), :141 (focus outline `--ds-accent`); scrim at src/ui/styles.css:229-236
- what: The card carries `data-hud-band`, so in a 3D view `.game-root.view-3d [data-hud-band]` turns its fill into a fixed dark scrim (`rgba(14,18,22,.82)`). That rule redefines `--text` and `--muted` only, so `--ds-accent` and `--ds-warn` keep their LIGHT-theme values: #366758 and #8f5400, both dark inks.
- evidence: On the scrim over a dark background, #366758 comes to about 2.9:1 and #8f5400 to about 3.1:1. Over a lit 3D background the composite scrim gets lighter (≈#393d40) and the accent drops to about 1.8:1. Both are 11px text, which needs 4.5:1. The 2px focus ring is also under the 3:1 non-text floor. BIOBUZZ, which has a tutorial, defaults `practicePhysics: '3d'`. styles.css:716 already records this exact trap for `.perf-spark-svg` ("`--text`, not `--ds-accent`: … the accent is not [redefined]"). `scripts/contrast.mjs` has no 3D-scrim pairs at all, so nothing catches it.
- recommendation: In the scrim block, add `--ds-accent: var(--ds-on-field-accent)` and a warn equivalent, or have the card use `--text`/`--muted` for the counter and the nudge. Add a "3D scrim" pair group to contrast.mjs (accent, warn and focus against INTRO_SCRIM-like grounds).
- contract: DESIGN.md Three-Zone Rule; CLAUDE.md THEMING category 3; WCAG 1.4.3 / 1.4.11
- effort: S

##### 12-02 · P0 · Tutorial buttons are about 21px tall on touch
- where: src/ui/tutorial.css:105-114 (padding `--ds-s-1 --ds-s-2`, font `--ds-t-xs`); the coarse-pointer block at :178-192 does not resize them
- what: Replay / Skip / Exit come out at roughly 11px × 1 line-height + 8px padding + 2px border, about 21px tall. On a phone they sit in one row with a 4px gap. Exit is irreversible (it sets the seen flag and drops the run) and sits 4px from Skip.
- evidence: The WCAG 2.5.8 floor is 24px. The evidence pack already flags sub-24px targets on mobile. The `@media (pointer: coarse)` block narrows the card and changes nothing about the targets.
- recommendation: In the coarse block, give `.ds-tut-btn` `min-height: 32px` (or 44px) and `--ds-s-2 --ds-s-3` padding. Consider moving Exit away from Skip, or giving it a confirm.
- contract: WCAG 2.5.8; ui-standard §1
- effort: S

##### 12-03 · P0 (conditional) · Prediction panel puts on-field ink on a themed, light HUD card
- where: src/ui/predict.css:36 (`.pred-panel` background `--ds-hud`), :71 (`.pred-opt` color `--ds-on-field-dim`), :86 (hover `--ds-on-field`), :92 (focus `--ds-on-field`)
- what: The file header says this panel's "ground is the CANVAS … do not invert". But its fill is `--ds-hud`, which IS themed: `rgba(255,255,255,.94)` in light. It only turns dark under `.game-root.view-3d .status-wrap`. `view-3d` follows a LIVE 3D scene (GameView.tsx:555-627), not the physics mode. So a 3D-physics room shown in the 2D view (the view pref is 2D, or WebGL fell back) draws the panel white.
- evidence: #b9beb8 on about #fbfbfb is roughly 1.9:1, and the #f9faf7 hover text and focus ring are about 1.0:1, so the picker would be unreadable. I did not render this to confirm that `hud.prediction` is non-null in 2D view plus 3D physics, hence the conditional.
- recommendation: Use `--text`/`--muted` for the option ink, as `.pred-head`/`.pred-foot` already do, and `--ds-accent` for the ring. Keep the `on-field` set out of any element whose fill is `--ds-hud`.
- contract: DESIGN.md Three-Zone Rule; WCAG 1.4.3
- effort: S

##### 12-04 · P1 · Tutorial buttons are a private component that rises on hover while every keycap sinks
- where: src/ui/tutorial.css:105-143; compare styles.css:1334-1344 (`.game-btn`) and DESIGN.md "Buttons"
- what: `.ds-tut-btn` is a fourth button spelling next to `.ds-btn`, `.game-btn` and `.pred-opt`. Its hover is `translateY(-1px)` with the shadow below, so it lifts up. The house keycap sinks on hover (`.game-btn:hover translateY(1px)`, press 3px). It has no edge shadow at rest, so it reads as a ghost button that pops up.
- evidence: DESIGN.md: "sinks 1px on hover, 3px (flush with its own edge) on press". The `.game-btn` MENU/RESET buttons sit a few hundred px away on the same screen and move the opposite way.
- recommendation: Reuse `.game-btn` (the HUD-band button family, which already has hud-line, reduced-motion and sink behaviour). Keep `.game-btn`-style `primary` for "Keep driving". Delete `.ds-tut-btn`.
- contract: DESIGN.md Components/Buttons; ui-standard §6 ("needs a discussion, not a variant")
- effort: S

##### 12-05 · P1 · The long hint grows the card into the joysticks on a phone
- where: src/games/biobuzz/tutorial.ts:389 (`retrieve` hint); tutorial.css:178-186 (mobile `bottom: 64px; max-width: 420px`)
- what: The retrieve hint is about 55 words across four sentences. At 12px in a card no wider than 343px on a 375px phone, it wraps to about 7 lines. Add the counter, the title, the button row and the nudge, and the bottom-anchored card grows to about 190px. That puts it at roughly 64-254px from the bottom, across the joystick row that the CSS comment itself places "74% down" (about 175px up on a 667px screen). The card is `pointer-events: auto`, so it swallows touches on the sticks it covers.
- evidence: tutorial.css comment at :173-177 ("stays bottom-CENTRE … between the two sticks"). That holds for a two-line hint, not for this one.
- recommendation: Cap hints at about 20 words. Move the side-roller explanation into the step's title or split it into two steps. Add a smoke check on hint length per step. Or give the card a `max-height` and let the hint clamp.
- contract: ui-standard §8 (descriptions are deleted, not shortened); ui.md HUD rules (no cover over the field)
- effort: S

##### 12-06 · P1 · Finishing a step gets no acknowledgement
- where: src/tutorial/runner.ts:108-121 (advance); TutorialCard.tsx:57-61
- what: When the predicate goes true, the world is REBUILT on the same tick and the card text swaps. The only progress cue is the text "Step 2 of 4". There is no "done" moment and no visual progress. The field teleports under the player, which a new driver will read as a reset or a bug rather than a success.
- evidence: The only feedback on step completion is the text change, and the rebuild is instant (ui.md "moving to the next step REBUILDS the world").
- recommendation: Add a step-pip row (n segments, filled up to index, following the `.hopper-pip` pattern that is already audited in contrast.mjs) and a short "Done" state. For example, hold the counter on "Step 2 done" for about 0.8s of real time, which is a UI-only delay and keeps the sim unchanged. Under reduced motion, no animation: just the pip fill.
- contract: design-guide §3 (motion communicates state); ui-standard §7
- effort: M

##### 12-07 · P1 · The first-run offer borrows the rejoin alert's container class
- where: src/ui/ModeSelect.tsx:83 (`ds-rejoin ds-tut-offer`); tutorial.css:157-170
- what: The offer reuses `.ds-rejoin`, the "You're already in a game" banner (which is `role="alert"`), and patches its layout with `.ds-tut-offer` overrides. It is the same accent banner, and the two can stack on top of each other (ModeSelect.tsx:68-96), where they read as two alerts of equal weight.
- evidence: CLAUDE.md Gotcha: "TWO COMPONENTS MUST NOT SHARE A CONTAINER CLASS" (the `.ds-dl` incident). Any future edit to `.ds-rejoin` silently re-lays out the tutorial offer.
- recommendation: Give the offer its own `.ds-tut-offer` block (or a generic `.ds-banner` both extend, documented in ui-components.md). Also make it visually quieter than the rejoin alert: panel fill with an accent edge, not an accent fill.
- contract: CLAUDE.md Gotchas; ui-standard §6
- effort: S

##### 12-08 · P1 · Pad drive hint opens in lowercase
- where: src/tutorial/hints.ts:82-86
- what: The gamepad branch returns `` `${drive} stick to drive, …` ``, so a card reads "left stick to drive, right stick to turn. Your GARDEN is…". The touch branch on the line above is capitalised ("Left stick…").
- evidence: `drive` is `'left' | 'right'`. Every step whose hint starts with `driveHint(c)` is hit: DECODE drive and return, BIOBUZZ drive and park.
- recommendation: Capitalise the first letter (`Left`/`Right`). Add a smoke check that every hint starts with an uppercase letter under all three ctx variants.
- contract: ui.md UI COPY (sentence case)
- effort: S

##### 12-09 · P1 · An unbound control prints as the literal word "unbound"
- where: src/tutorial/hints.ts:43-55
- what: `keyFor`/`padFor` return `'unbound'`, and the doc comment says `—`. The hint then reads "Hold unbound. The turret tracks the goal for you." or "Drive onto the ARTIFACT with unbound held." Unbound actions are a real state: steals produce UNBOUND (ui.md). The tutorial is also the surface that Controls offers to somebody "who has just rebound half their keys".
- evidence: ControlsSection shows the state as an `UNBOUND` keycap (ControlsSection.tsx:471). The tutorial composes it into a sentence.
- recommendation: When the action a step needs is unbound, replace the hint with "Shoot has no key. Bind one in Controls." and consider linking to it. Fix the comment's `—`.
- contract: ui.md tutorial rule ("a tutorial that names a key the player has moved is worse than one with no hints")
- effort: S

##### 12-10 · P2 · Keys and game nouns share one ALL-CAPS voice, and the hints skip the existing keycap component
- where: src/games/decode/tutorial.ts:121,129,142,160; src/games/biobuzz/tutorial.ts:284-419; hints.ts:31-37, 88-89
- what: The hints are flat strings. Key labels ("SHIFT", "SPACE", "INTAKE" on touch) and manual terms ("LAUNCH ZONE", "ARTIFACT", "POLLEN", "CELL") are both uppercase, so "hold SHIFT near the POLLEN" gives the reader no way to tell which word is a key. The keyboard drive hint concatenates keys with no separator ("WASD", or "▲◄▼►" once rebound to arrows, or "NUM8NUM4…" for multi-char labels).
- evidence: `.ds-key` (shell.css:5418) is the app's keybinding readout and is not used here. `driveHint` joins labels with `''`.
- recommendation: Have `hint()` return segments (`{key: 'SHIFT'}` / text) and render keys as `.ds-key` chips on the card, using the HUD token set. Join drive keys with thin spaces or chips. Keep manual nouns in caps.
- contract: design-guide §2 (one decision per component); ui-standard §8
- effort: M

##### 12-11 · P2 · Chain Reaction has no tutorial, so onboarding differs by season
- where: src/games/chain/ (no tutorial.ts); App.tsx:1890, 2027 (`moduleFor(...).tutorial ? startTutorial : undefined`)
- what: DECODE and BIOBUZZ offer the first-run card and a Controls ▸ Tutorial panel. Chain Reaction shows neither, even though CR has the most unusual controls (catalyst, fling, turretless hold-to-steer). A new player who picks CR first gets no onboarding.
- evidence: CLAUDE.md lists CR as "complete and scored". There is no `tutorial` slot in the chain module.
- recommendation: Add a three- or four-step CR spec (drive, intake PARTICLES, shoot the accelerator, catalyst). Until then, state the gap somewhere (docs/roadmap) so it is not read as intended.
- contract: CLAUDE.md game seam (consistency across games)
- effort: M

##### 12-12 · P2 · One seen flag covers every season
- where: src/tutorial/flag.ts:17-33; storage key `decodesim.tutorial.v1`
- what: Finishing or exiting DECODE's tutorial hides BIOBUZZ's first-run offer, and the other way round. BIOBUZZ adds five season-only actions (bbPlace, bbNectar, …) that DECODE's run never teaches.
- evidence: `tutorialSeen()` is one key, and ModeSelect reads it with no game argument (ModeSelect.tsx:63).
- recommendation: Key the flag per game (`…tutorial.v1.<gameId>`, or a JSON set). Migrate the old '1' to "seen for decode", or to "seen for all" to avoid re-nagging.
- contract: ui.md tutorial rules (seen flag); CLAUDE.md "keyed per game"
- effort: S

##### 12-13 · P2 · The first-run offer has no dismiss
- where: src/ui/ModeSelect.tsx:82-96
- what: The flag is set only on completion or Exit inside a run. An experienced driver on a new device has to start the tutorial and exit it to get rid of the banner. It sits above the modes on the page used to start every run.
- evidence: No close control, and no call to `markTutorialSeen` from ModeSelect.
- recommendation: Add a ghost "Not now" / close button that calls `markTutorialSeen()` and hides the card in local state.
- contract: ui-standard §6 (the page anatomy should not carry a permanent nag)
- effort: S

##### 12-14 · P2 · Screen readers hear "Step 2 of 4" but not the instruction
- where: src/ui/TutorialCard.tsx:51-61
- what: Only the counter is `role="status"`. The title and hint change on the same render and are not in a live region, so a screen-reader user is told a step changed and not what to do. The finished card, by contrast, makes the whole card the region.
- evidence: The rationale in the comment (avoid flooding at the 10 Hz poll) holds only for text that changes. The title changes once per step. The hint changes per step, plus when a pad connects.
- recommendation: Wrap the counter and the title in one `role="status" aria-atomic="true"` element and leave the hint and nudge out, or add the hint to the region with `aria-describedby`.
- contract: WCAG 4.1.3
- effort: S

##### 12-15 · P2 · No reduced-motion rule for the button hover transform
- where: src/ui/tutorial.css:117-132
- what: `.ds-tut-btn` moves by transform on hover and press, and tutorial.css has no `prefers-reduced-motion` block. Siblings `.game-btn` (styles.css:1346) and `.pred-opt` (predict.css:112) both cancel the transform.
- evidence: See the lines above. Small motion, but the sibling components already set the precedent.
- recommendation: This goes away if 12-04 is taken, since `.game-btn` already handles it. Otherwise mirror predict.css:112-119.
- contract: ui-standard §7; CLAUDE.md reduced-motion gotcha
- effort: S

##### 12-16 · P2 · Finished-card copy: redundant eyebrow, a dash appositive, and reassurance
- where: src/tutorial/runner.ts:137-139; TutorialCard.tsx:38
- what: The eyebrow says "Done", the title "Tutorial complete", and the hint "Free drive from here — the field is yours." That is three lines saying one thing. The hint uses the dash appositive that ui.md calls "the single most-cited tell of machine-written prose", and "the field is yours" is reassurance.
- evidence: ui.md UI COPY: "PREFER A FULL STOP OR A COLON TO A DASH"; ui-standard §8: reassurance is deleted.
- recommendation: Eyebrow "Tutorial complete", title something useful ("Try a Solo Practice match"), and no hint, or a real next action (a button to Solo Practice next to "Keep driving").
- contract: ui.md UI COPY; ui-standard §8
- effort: S

##### 12-17 · P2 · Hints that narrate
- where: biobuzz/tutorial.ts:300 ("The hopper pips fill as it goes in."), :342 ("…the CELL swings over and drops its load."), :364 ("Your NECTAR on top makes the FLOWER yours."); decode/tutorial.ts:142 ("The turret tracks the goal for you.") against biobuzz :324 ("The turret aims for you.")
- what: The second sentences narrate what the player is about to see rather than teach a control. The one shared idea (aim assist) is worded differently in each game.
- evidence: ui-standard §8: a hint must teach something the label cannot. If it "narrates what will happen", it goes.
- recommendation: Keep the rule-bearing sentences (launch zone legality, hopper holds three, "all four wheels is worth more") and drop the narration. Use one shared wording for aim assist, possibly from hints.ts.
- contract: ui-standard §8
- effort: S

##### 12-18 · P2 · The card may collide with the HUD bands in free drive on narrow landscape
- where: tutorial.css:36 (`bottom: 76px`), :183 (`64px`)
- what: The bottom offsets are magic numbers copied from `.breakdown-row`, not derived from the score bar's measured height. ui.md says the score bar and breakdown chips move to the side gutters in landscape on touch, and the card is centred and does not account for that layout. A stated px offset breaks the next time the bar's height changes.
- evidence: The comment at :28-30 depends on "the breakdown row is not rendered" in free drive, which is a cross-file assumption that no check enforces.
- recommendation: Expose the bar height as a custom property (for example `--hud-bottom`) set where the score bar is laid out, and use `calc(var(--hud-bottom) + var(--ds-s-2))`.
- contract: ui-standard §1.2 (raw px only with a documented one-off reason)
- effort: M

##### 12-19 · P3 · Line-heights outside the two allowed values
- where: tutorial.css:76 (`1.2`), :84 (`1.35`)
- what: ui-standard §3 allows line-height 1 or 1.45 only.
- evidence: See the lines above.
- recommendation: Title 1, hint 1.45.
- contract: ui-standard §3
- effort: S

##### 12-20 · P3 · The Controls "Tutorial" panel does not say which season it runs, and the doc names it differently
- where: src/ui/ControlsSection.tsx:642-650; docs/area/ui.md:643 ("Run the tutorial")
- what: The panel sits in the All games scope but runs the ACTIVE season's tutorial. The button says "Start" and the title "Tutorial", with no season named. The doc calls the entry "Run the tutorial".
- evidence: See the lines above.
- recommendation: Title "{Season} tutorial" (or move it into the season scope), and bring the doc in line with the code.
- contract: ui.md terminology (a season is named, not implied)
- effort: S

##### 12-21 · P3 · predict.css: magic px values and a duplicate declaration
- where: src/ui/predict.css:33 (hex token defined in a component file), :39-42 (`padding: 8px; width: 260px; margin-top: 4px`), :50/:98 (`font-size: 10px`, off-scale), :76 (`11px` literal rather than `--ds-t-xs`), :57-60 (`.pred-mode` declares `color` twice)
- what: The file writes literal px and colours where tokens exist. 10px is below the type scale's smallest step (11px).
- evidence: ui-standard §2/§3: every value from a token, and six sizes only.
- recommendation: Tokenise (`--ds-s-2`, `--ds-s-1`, `--ds-t-xs`). Move `--ds-on-field-accent-ink` into shell.css next to the other -ink tokens, as its own comment says it should be. Drop the dead first `color`.
- contract: ui-standard §2, §3, §5
- effort: S

#### Strengths (keep)
- The engine/content split is right: DOM-free runner, per-game `TutorialSpec` on `GameModule.tutorial`, `applies(spec)` resolved once so "Step n of m" is honest per build, and a smoke lane that checks non-vacuity, zero fouls and hint rebinding.
- Hints are functions of the live `ControlBindings`, with pad and then touch fallback, and they drop the PARK clause on touch where no button exists. This is the right model; 12-08, 12-09 and 12-10 are finish-work on it.
- The card is a `data-hud-band` rather than an overlay, so the 3D camera reframes above it and it gets the scrim. It uses `--ds-hud`/`--ds-hud-line`/`--text`/`--muted` and spacing tokens throughout, and it is bottom-anchored so the nudge grows upward without moving the buttons.
- The nudge never auto-skips. Replay and Skip are always available. Exit and completion both set the seen flag, fail-open.
- The first-run offer prints no step count (the count really does vary per game and per build) and is hidden, not disabled, for a season with no tutorial.
- MatchStrategy.tsx is built entirely from shell classes (`ds-sec`, `ds-chip`, `ds-opts`/`ds-opt`, `ds-players`, `ds-actions`), with no inline styles and no colour literals.

### 13 · Token and CSS architecture: what I examined

I compared the `:root` and dark token blocks (shell.css:22-353) with the DESIGN.md frontmatter. I counted every `--*` definition against every `var()` or string use across `src/**` with a script (scratchpad/tok.cjs). I read all of predict.css, the styles.css token and scrim block, every `box-shadow` and `text-shadow`, and every raw colour outside the token blocks in all four stylesheets. I also checked TSX and canvas colour literals, the diff for `4a1d7ee`, uiaudit.mjs's stale-index check, and scripts/contrast.mjs coverage. I ran `npm run uiaudit`, and its result matches the evidence pack.

Housekeeping: probing `node scripts/uiindex.mjs --help` regenerated docs/ui-components.md. It ignores its arguments. I restored it with `git checkout -- docs/ui-components.md`, and the tree is clean again.

##### 13-01 · P0 · The prediction panel puts near-white text on a white card in light theme
- where: src/ui/predict.css:14-18, 37, 52, 59, 71, 108; src/ui/styles.css:229-237; src/ui/GameView.tsx:627, 1158
- what: predict.css's header says the panel's ground is the canvas, so it "takes `--ds-hud` … which do not invert". That is false. `--ds-hud` is a themed token: `rgba(255,255,255,0.94)` in light (shell.css:192). The panel's text uses `--ds-on-field` (#f9faf7) and `--ds-on-field-dim` (#b9beb8), which never invert. The only thing that makes the card dark is the `.game-root.view-3d .status-wrap` scrim, and `view-3d` is set only while a live 3D scene is drawing (`scene3d`, GameView.tsx:627). The panel renders for any 3D-physics room (`hud.prediction`). BIOBUZZ lets a 3D-physics room use the 2D view.
- evidence: In light theme with the 2D view, `.pred-mode` is #f9faf7 on a ~#fff composite, about 1.05:1. The unselected buttons are #b9beb8 on white, about 1.9:1. `.pred-head` and `.pred-foot` use `--muted` → `--ds-mut`, which does pass, so the panel looks half-rendered. scripts/contrast.mjs has no `pred-` pair, so "ALL PASS 269" never tested this.
- recommendation: Use category-1 tokens (`--ds-ink`, `--ds-mut`, `--ds-accent` with `--ds-accent-ink`) like every other HUD card, and let the 3D scrim redefine them as it already does for `--text` and `--muted`. Or wrap the panel in a band that always gets the scrim. Add the pairs to contrast.mjs. First confirm in the browser that a 3D-physics room with the 2D view is reachable.
- contract: CLAUDE.md THEMING (HUD cards theme; category 3 is only for glyphs painted straight on the canvas); DESIGN.md Three-Zone Rule; ui-standard §5 ("a new colour pair means a new entry in contrast.mjs").
- effort: S

##### 13-02 · P1 · DESIGN.md's spacing contract contradicts ui-standard's 4px grid
- where: DESIGN.md:45-51 (frontmatter `spacing`), DESIGN.md "Layout" section; docs/ui-standard.md §2; shell.css:74-81
- what: The frontmatter lists `xl: 22px` and no 24/32/48. The Layout prose says "No strict spacing grid — … 2/4/6/8/10/12/14px … 16–22px … 20–30px". ui-standard §2 says the opposite: 4px grid, `--ds-s-0..7` = 2/4/8/12/16/24/32/48, and it BANS 6, 10, 14, 18 and 20. The code implements ui-standard. So the "look" contract DESIGN.md calls authoritative still approves the 143 off-grid values the ratchet counts.
- evidence: `.ds-bar`, the most visible chrome, is `padding: 14px 22px; gap: 20px` (shell.css:392-393), which is exactly DESIGN.md's rhythm and illegal under ui-standard. `.lb-standing` uses `padding: 10px 14px` (shell.css:2684).
- recommendation: Rewrite DESIGN.md's `spacing:` as `s-0..s-7` with the CSS values, delete the "No strict spacing grid" paragraph, and point to ui-standard §2.
- contract: design-guide §2 ("when a change conflicts with the contract, amend it in the same commit — never silently diverge").
- effort: S

##### 13-03 · P1 · The DESIGN.md frontmatter covers only half the palette and has no dark theme or type roles
- where: DESIGN.md:4-43; shell.css:22-312
- what: All 29 light colours in the YAML match the CSS exactly. The YAML is still not the token set:
  - **CSS tokens missing from the YAML (about 35):** `accent-soft-ink`, `accent-soft-mut`, `red`, `blue`, `green`, `purple`, `pollen`, the `red-ink`/`blue-ink`/`purple-ink` set, `red-chip-ink`, `blue-chip-ink`, `gold-ink`, `award`, `award-ink`, the four `podium-*`, `blurple`, `blurple-ink`, `hud-soft`, `stage-bg`, `inset`, `you`, `on-field-accent-ink`, and the pastels. Also absent: the `s-*` spacing tokens as named in CSS, and the type scale `t-xs..t-2xl`.
  - **The dark block has no machine-readable counterpart.** The only dark values are prose for accent, ink and mut, and those match. Yet the product is "explicitly dual-theme". `line-soft`, `warn`, `danger` and `hud-line` all change meaning in dark with nothing written down.
  - **`typography:` gives families only.** It has no size, weight or line-height roles, although design-guide §2 requires roles "so the set stays closed". The closed six-step scale lives only in ui-standard §3.
  - **Stale counts:** DESIGN.md says "175 pairs"; contrast now runs 269.
- recommendation: Generate the frontmatter from shell.css the way uiindex generates the class index, with a `colors-dark:` map and `typography:` roles bound to `--ds-t-*`. Add a uiaudit rule that diffs the two.
- contract: design-guide §2 (the frontmatter is the machine-checkable token set).
- effort: M

##### 13-04 · P1 · There are 14 box-shadows but no single depth model, and blur ships despite the No-Blur Rule
- where: blur in styles.css:2776, 2797 (`.mobile-joystick-handle`, `.mobile-btn`), 2864 (`.mobile-edit-bar`), 3082 (`.server-notice`), 3834 (`.ann-panel`: `0 24px 60px`), 4052/4055 (`.ann-cinema-btn` glow at 30/44px); shell.css:466 (`.ds-presence-dot` glow); text-shadow blur at styles.css:315, 1381, 1399, 4008
- what: DESIGN.md's Named Rule says "never `box-shadow` blur radius > 0". Seven box-shadows and four text-shadows break it. The hard-offset shadows that do follow the model use six offsets (1, 2, 3, 4, 5, 6px) against two block tokens:
  - The `.ds-tile` hover uses 5px/1px (shell.css:1802, 1806).
  - 6px appears at shell.css:3692, 3px at 4218, and 2px accent blocks at 4230 and 4420.
  - Alliance-tinted blocks use `color-mix` at 4451 and 4457.
  - The most common pressable edge, `0 2px 0 var(--ds-line)`, is not a token (shell.css:1225, 1340, 1382, 1581, 3487, 3936; styles.css:1338, 1617, 4221; tutorial.css:126 with `--ds-hud-line`). It is a de facto third edge beside `--ds-edge` and `--ds-edge-soft` (both 3px). Only 4 sites use `--ds-edge`.
- recommendation:
  - Add `--ds-edge-sm` (`0 2px 0 var(--ds-line)`) and `--ds-edge-sm-accent`.
  - Define hover and press as derived tokens: `--ds-block-hover` at 5px and `--ds-block-press` at 1px.
  - Replace the blurs with the block model. For the canvas-floating mobile controls and the announcer panel, either document a scoped "canvas lift" exception in DESIGN.md or use a `--ds-hud-line` edge like other HUD cards.
  - Split shadow-sprawl into "blurred" (target 0) and "untokenized offset".
- contract: DESIGN.md "Elevation & Depth", No-Blur Rule, and "Don't add a blurred box-shadow"; design-guide §3 ("hairline border + wide diffuse shadow → commit to ONE").
- effort: M

##### 13-05 · P1 · The last commit `4a1d7ee Update shell.css` gave a card square corners and made the index stale
- where: shell.css:2679-2687 (`.lb-standing`); docs/ui-components.md
- what: The whole diff deletes one line, `border-radius: var(--ds-round-md);`, from `.lb-standing`. The ranked-standing card on the Leaderboard is now a bordered, tinted box with 0px corners. It sits among 8px `ds-panel` cards and next to `.lb-standing-badge` pills.
- evidence: DESIGN.md Shapes says "No sharp (0px) corners anywhere in the chrome". The deletion shifts every declared line after 2683 by −1. The index records `declared` line numbers for about 130 classes below that point, so `stale-component-index` goes red. The commit message ("Update shell.css") gives no reason. If the square corner is deliberate (maybe to butt against a table?), neither the commit nor a comment says so.
- recommendation: Restore `var(--ds-round)` (8px, the card radius). `--ds-round-md` was already inconsistent with panels. Or document why it is square. Then run `npm run uiindex`.
- contract: DESIGN.md Shapes; ui-standard §4 ("one radius per component"); docs/area/ui.md ("uiaudit fails if the committed copy is stale").
- effort: S

##### 13-06 · P2 · The stale-index check fires on line numbers, so it goes red on edits that change nothing
- where: scripts/uiaudit.mjs:274-300; scripts/uiindex.mjs (the `declared` column)
- what: The index answers "does a class for this already exist?". But it embeds `file:line` for every class, so any CSS line insertion or deletion anywhere makes it stale. 4a1d7ee removed a non-`ds-` property and changed no class, yet uiaudit fails. This is the same always-red failure mode the CRLF comment at uiaudit.mjs:281-287 warns against.
- recommendation: Drop the line number (keep the file) or compare only the class, file and count tuples. Better still, have uiaudit print the diff instead of just "run uiindex".
- contract: uiaudit.mjs's own rationale ("a check that is always red is worse than no check").
- effort: S

##### 13-07 · P1 · ui-standard allows weights 500, 750 and 900, then says a grep for them must return nothing
- where: docs/ui-standard.md §3 (weights list) and §9 (`grep -rnE "font-weight: *(500|750|900)"` "must all return nothing")
- what: §3 was revised to allow all seven variable-cut weights. §9 still names 500, 750 and 900 as violations. Anyone following §9 would "fix" deliberate weights.
- recommendation: Delete the weight grep from §9 (`banned-font-weight` in uiaudit already guards against an eighth weight). While there, delete the §9 `var(--x, #` grep, which uiaudit also covers.
- contract: ui-standard intro ("if a rule is wrong, change the rule here first").
- effort: S

##### 13-08 · P2 · Six tokens are dead but still themed and still counted by contrast
- where: shell.css:60-65, 93, 297-300; scripts/contrast.mjs:159, 197-199
- what: No `var()` anywhere in `src/**` uses these: `--ds-blush`, `--ds-sage`, `--ds-lavender` (its only hit is a comment at styles.css:3505), `--ds-sky`, `--ds-sky-ink` and `--ds-round-xl`. The first five still get dark values, and contrast.mjs still asserts four pairs for them, which pads "ALL PASS" with tests of nothing. DESIGN.md names only the first three as vestigial. `sky` and `sky-ink` are equally dead, and the comment "readable ink for the sky family" suggests they are live.
- recommendation: Delete all six, their dark values and their contrast pairs. Update ui-standard §10's "6 palette tokens with no call sites" and DESIGN.md's Don'ts.
- contract: DESIGN.md Don'ts; ui-standard §10.
- effort: S

##### 13-09 · P2 · The legacy `--text`/`--muted` bridge keeps growing and is no longer a pure alias
- where: shell.css:341-353; styles.css:229-237; predict.css:52, 108; tutorial.css:77-124
- what: shell.css says the bridge exists only for old styles.css rules and that "new rules should reach for --ds-* directly". It has 58 uses: 52 in styles.css, 4 in tutorial.css, and 2 in predict.css, which is new this month. The 3D scrim redefines `--text` and `--muted` to `--ds-on-field*` inside HUD bands, so `--muted` and `--ds-mut` now resolve differently in the same element. The bridge is now load-bearing, so deleting it would break the scrim. `--green`, `--purple`, `--ds-green` and `--ds-purple` exist only to feed each other: `--ds-green` and `--ds-purple` have exactly 1 use each, in the alias.
- recommendation: Have the scrim redefine `--ds-ink` and `--ds-mut` (it already does `--ds-ink-dim`), then mechanically replace `var(--text|--muted|--panel|--border|--panel-2)` with the `--ds-*` names and drop the bridge. Replace `--amber` → `--ds-accent` in place; the name lies.
- contract: shell.css:329-330's own comment; DESIGN.md "Dual-theme by design token, not by override".
- effort: M

##### 13-10 · P2 · A token is defined outside the token block, and its literal is still repeated
- where: predict.css:32-34 (`--ds-on-field-accent-ink: #10241b`); styles.css:2885 (`.mobile-edit-bar … color: #10241b`)
- what: predict.css declares a palette token with the comment "declared here … only because another lane is editing that file this week; it belongs beside the other -ink tokens". The follow-up never happened, and the literal it names is still inline. uiindex and a reader of shell.css's token block will not find it.
- recommendation: Move it into shell.css beside `--ds-on-field-accent`, note it as category 3, and point `.mobile-edit-bar` at it.
- contract: ui-standard §5 (no hex literal); DESIGN.md Do's ("name which zone it's in when you add it").
- effort: S

##### 13-11 · P2 · About 30 raw colours in styles.css, including an unnamed scrim family and off-palette alliance gradients
- where: styles.css:279, 283 (`.score-panel` gradients `#7f1d1d→#991b1b`, `#1e3a8a→#1d4ed8`); 287, 325, 346, 352, 473, 479, 513 (`#2b0b0b`), 522 (`#1a1206`); scrims at 1485 and 3099 (`rgba(10,12,16,.55)` ×2), 2540 (`rgba(8,10,14,.72)`), 2742/2790/2812 (`rgba(28,32,39,.55/.62/.85)`), 2861, 3677 (in shell.css); `.server-notice` at 3078/3086 (`rgba(251,191,36,.96)`, `rgba(239,68,68,.97)`); 3971/4044 (`#05070b`); 3523 (`#ffffff`)
- what: The alliance score gradients use Tailwind red-900/800 and blue-900/700 values that are none of `--ds-red`, `--ds-red-chip`, `--ds-blue` or `--ds-blue-chip`. shell.css:112-113 warns that ".score-panel gradients depend on [--ds-red/--ds-blue's] exact values", which is false: they don't reference them. The server notice's amber is neither `--ds-gold` nor `--ds-warn`. Six dark scrims pick six unrelated near-blacks. By contrast, shell.css outside its token block is nearly clean (1 literal, at 3677).
- recommendation: Add category-3 tokens `--ds-scrim` and `--ds-scrim-strong` (plus `--ds-canvas-btn` for the mobile controls) and alliance gradient stops derived from the chip tokens. Add a `raw-colour` ratchet to uiaudit (its baseline is roughly 30 today, and 0 in shell.css).
- contract: ui-standard §1.2 and §5 ("No hex, rgb() or hsl() literal in CSS").
- effort: M

##### 13-12 · P2 · The styles.css / shell.css boundary leaks both ways: 8 prefix families split across the two files
- where: styles.css:3560 (`.ds-btn.danger`), plus styles.css `.ds-lan-*`, `.ds-maint*`, `.ds-section`, `.ds-tip`; shell.css has 57 top-level `.lb-`/`.adm-` rules while styles.css also has `.adm-*` (3174-3186) and `.lb-*`
- what: The `.ds-btn` base, hover and active states live in shell.css:1562-1583, but its `danger` variant lives in the "in-match" stylesheet 2,000 lines into another file. Families declared in both files: `adm-`, `bb-`, `cl-`, `ds-`, `lb-`, `overlay-`, `server-`, `sponsor-`. ui-standard §10 already records this, but predict.css shows the split is still used as a merge-conflict tool rather than a boundary.
- recommendation: Move `.ds-btn.danger` beside `.ds-btn`. Move all `ds-`, `adm-` and `lb-` rules to shell.css (or a new admin.css) and leave styles.css with `.hud`, `.game-*`, `.score*` and overlays. Have uiaudit fail when a `ds-` selector is declared outside shell.css.
- contract: styles.css's stated role (in-match); ui-standard §10.
- effort: M

##### 13-13 · P2 · Three documents still describe the rejected pastel identity
- where: shell.css:1-6 ("'Low-Poly' design system … desaturated pastels … isometric toy world"), shell.css:45 (`/* primary: soft mint */` above `#366758`, a deep green), shell.css:40 ("the pastel look depends on it"); .claude/skills/frontend-consistency/design-guide.md §2 ("DSIM: pastels everywhere", "Space Grotesk only for technical labels") and §4 ("tactile keycaps and pastel play (DSIM)")
- what: DESIGN.md calls the pastel direction "superseded" and "rejected". The CSS header, the token comment and the skill guide (which every design session reads) still describe it as current. The skill guide also lists "Space-Grotesk-by-default" as an AI tell while DSIM uses it for all data, with no note that this is a deliberate choice.
- recommendation: Rewrite shell.css:1-10 to the Driver Station north star and fix the accent comment. Update design-guide §2 and §4's DSIM examples, and add one line there saying Space Grotesk is a deliberate choice for data.
- contract: DESIGN.md Overview ("Rejected direction").
- effort: S

##### 13-14 · P2 · Near-duplicate tokens and hand-synced copies in TS and canvas code
- where:
  - shell.css:194 vs 36 (`--ds-hud-line` = `--ds-line` = #c0c9c4 in light); 202 vs 24 (`--ds-on-field` = light `--ds-bg`); 204 vs 269 (`--ds-on-field-accent` = dark `--ds-accent`); 47/143/144/180 (four separate `#ffffff` inks)
  - src/config.ts:2921-2922 (`COLORS.backdrop` and `backdropDark` copy `--ds-bg`, "keep the three in sync")
  - src/ui/RobotPreview.tsx:140-144 (literal `'#5fb597'` fallback)
  - src/ui/StartPositionEditor.tsx:148, 170 and ChainStartEditor.tsx:188, 216 (`'#37d67a'`/`'#ff4d4d'` = `--ds-green`/`--ds-red`, plus `'#0d1720'`)
- what: The value duplicates in the token block are mostly intentional, because each token owns a different job. The tokens should reference each other instead of repeating literals: `--ds-on-field-accent: #5fb597` will not follow a retune of the dark accent it borrows. The TS copies are hand-synced with nothing checking them.
- recommendation: Write intentional equalities as `var()` references where the zone allows it, or leave a one-line comment saying they are deliberately separate. Have `npm test` or uiaudit assert `COLORS.backdrop*` equals the parsed `--ds-bg` values. Point the editors' legal/illegal colours at a shared constant.
- contract: ui-standard §5; DESIGN.md Three-Zone Rule.
- effort: S

##### 13-15 · P3 · Small type and fallback leftovers
- where: predict.css:50, 107 (`font-size: 10px`); styles.css:128 (`.ad-slot-label` 10px); styles.css:35 (`font-family: var(--ds-font-ui, system-ui, sans-serif)`); styles.css:111 (`line-height: 1.5`)
- what: 10px is off the six-step scale, and predict.css is newer than the standard. The body font has a `var()` fallback. uiaudit ignores it because it is not a `#` literal, but it is the same "hide a missing token" pattern §5 bans. `1.5` breaks the "1 or 1.45 only" line-height rule.
- recommendation: Use `--ds-t-xs`, drop the fallback, and use 1.45.
- contract: ui-standard §3 and §5.
- effort: S

#### Strengths (keep)
- The three-zone model is written down in the token block itself, with measured ratios next to values (for example shell.css:243-265 and 302-309). This is the best token documentation I have seen in a repo this size.
- Fill and ink are split consistently (`-ink` and `-chip-ink` siblings), and the reason is written beside each pair.
- The light palette matches the DESIGN.md frontmatter exactly, all 29 of them, and the radius scale matches too.
- Zero undefined tokens, zero duplicate selectors and zero `var(--x,#)` fallbacks, all enforced as hard zero-baseline ratchets. The `--ds-font` class of bug cannot come back.
- Outside its token block, shell.css has only one raw colour. The debt is concentrated in styles.css, where a ratchet can find it.
- The 3D scrim works by redefining tokens inside a scope rather than restyling components, which is the right architecture. It only needs to cover the `--ds-*` names too (13-09) and the prediction panel (13-01).

### 14 · Typography and spacing (cross-cutting)
Examined: DESIGN.md, docs/ui-standard.md §2/§3/§6, docs/area/ui.md (copy + dialog sections), design-guide §3; live audit report.txt/json (light); screenshots p0/p2/p3/p4/p10/p11 (light, plus dark p2, mobile p2); `src/ui/shell.css`, `styles.css`, `markdown.tsx`, `ControlsSection.tsx`, `Menu.tsx`, `Download.tsx`; `scripts/uiaudit.mjs` rules 6 (grid) and off-scale; `npm run uiaudit` (143 off-grid / 45 off-scale, stale component index).

##### 14-01 · P1 · Five `font:` shorthands are invalid CSS and set nothing (the `--ds-font` bug class, again)
- where: src/ui/shell.css:5795 `.ds-startpos-toggle`, :5820 `.ds-startpos-tab`, :5830 `.ds-startpos-role`, :5903 `.ds-roleswap-role`, :5917 `.ds-roleswap-note`
- what: `font: 600 12px/1 inherit;`. `inherit` is a CSS-wide keyword, and it is only valid when it stands alone, so the parser drops the whole declaration. The weight, size and line-height the author wrote are never applied, and the start-position editor and role-swap text inherit whatever surrounds them.
- evidence: `rg -n "font:[^;]*\binherit\s*;" src/ui/*.css` shows 44 correct bare `font: inherit;` and these 5 broken ones. The uiaudit off-scale regex (`font:\s*[0-9]{3}\s+([0-9]+)px`) reads "12px" and passes them. ui-standard §3 ("Prefer the longhands… that is how that bug stayed invisible") names exactly this failure.
- recommendation: replace each with longhands (`font-weight: 600; font-size: var(--ds-t-sm); line-height: 1;`). Add a uiaudit rule that fails any `font:` shorthand containing `inherit` together with other tokens, and ideally any `font:` shorthand at all.
- contract: ui-standard §3 (longhands, tokens); CLAUDE.md gotcha on voided `font:` shorthands.
- effort: S

##### 14-02 · P1 · Configure stacks panels 40px apart: the unscoped `.ds-panel + .ds-panel` margin adds to the parent's gap
- where: src/ui/shell.css:1903 (`.ds-panel + .ds-panel { margin-top: var(--ds-s-4) }`) combined with :1450 `.ds-subnav-body { gap: var(--ds-s-5) }`. Screenshots p2 (Start from→Build) and p3 (Touch controls→Tutorial→Driving).
- what: in a flex column, margins do not collapse into `gap`, so consecutive panels on Configure sit about 24+16 = 40px apart. Hero→first panel (hero is not a `.ds-panel`) is 24px, so one page shows two rhythms. The comment directly above the rule says a nested panel "must NOT also get a margin, or the two gaps would add". The other three selectors are scoped to `.ds-main >`, but this first one is not.
- evidence: p3 shows the Touch controls card ending at about y=287 and Tutorial starting at about y=327. p2 shows Start from ending at about y=680 and Build starting at about y=720. The hero→Start from gap is about 24px.
- recommendation: scope it to `.ds-main > .ds-panel + .ds-panel`, or delete it and let parents own the gap (§2 "one owner per gap").
- contract: ui-standard §2 one-owner-per-gap; §6 "`--ds-s-5` between panels".
- effort: S

##### 14-03 · P1 · Section rhythm differs on every page shell: 16 / 18 / 22 / 24 / 40
- where: `.ds-main > .ds-panel` margin 16 (shell.css:1903–1918), `.ds-dlpage` gap 18 (:5622, p10), `.ds-console-in` gap 22 (:3904), `.ds-subnav-body`/`.ds-robot` 24 (:1454, :3974), Configure's effective 40 (14-02)
- what: the standard fixes panel↔panel at `--ds-s-5` (24px). In practice the value depends on which wrapper a page happens to use. Records/Career stack at 16, Download at 18 (p10: hero→build grid about 18px), lobby/strategy consoles at 22, Configure at 24 or 40.
- evidence: the rules above, plus the p4 vs p10 vs p2 screenshots.
- recommendation: pick one value (24, per the standard) and make it a single `.ds-stack` or `.ds-main` gap rule. Delete the per-wrapper gaps and the sibling margins.
- contract: ui-standard §6 Page anatomy.
- effort: M

##### 14-04 · P1 · The two contracts disagree on spacing, so both "follow the contract" and "break the contract" are defensible
- where: DESIGN.md:137 ("No strict spacing grid… 2/4/6/8/10/12/14px… 16–22px… 20–30px"), frontmatter `spacing.xl: 22px`, `button padding 9px 16px`, `chip padding 5px 11px`, DESIGN.md:178 panel "15px padding, 14px gap", versus ui-standard §2 ("4px grid… BANNED: 3,5,6,7,9,10,11,13,14,15,18,20px")
- what: DESIGN.md is the file the design guide treats as the site's contract, yet it documents exactly the values the standard bans. Much of the 143 off-grid count (14-05, group C) matches DESIGN.md's description. DESIGN.md also still calls Space Grotesk "monospace" and describes a 175-pair contrast audit, where the audit now checks 269.
- evidence: the quoted lines. `.ds-panelbox { padding:16px; gap:14px }` (shell.css:4478) is half one contract and half the other.
- recommendation: rewrite DESIGN.md's Layout section and its `spacing:`/`components:` frontmatter to the `--ds-s-*` scale, in the same commit that states which document wins. The frontmatter should mirror `--ds-s-0..7` and `--ds-t-*`.
- contract: design-guide §2 ("amend the contract in the same commit — never silently diverge").
- effort: S

##### 14-05 · P1 · The 143 off-grid gaps fall into five causes, and two tokens would clear most of them
- where: shell.css / styles.css (counted: 10px ×21, `10px 12px` ×9, `10px 14px` ×3, 6px ×16, 14px ×12, 18px ×5, 22px ×4, 20px ×3, `30px 20px` ×2, 1px ×6)
- what, grouped by cause:
  - **A. Control padding `10px 12px` (≈35 hits):** `.ds-rail-btn` 693, `.ds-table td` 2396 (`10px 16px`), `.fr-toast`, `.server-row`, `.ds-dl-opt` 3470, `.ds-opt.mini` 4423, `.ds-strat-card` 5580, `.ds-dodge`, `.lb-standing` (`10px 14px`). This is a real, consistent de-facto step (a 40px-tall row) with no token behind it.
  - **B. 6px intra-row gaps (≈17):** `.ds-subnav`, `.ds-tabs`, `.ds-rail-items`, `.lb-name`, `.lb-robot`, `.contrib-icons`, `.ds-startpos-*`, `.fr-row`. These fall between s-1 and s-2 and should round to s-2.
  - **C. The pre-standard layout rhythm 14/18/22/28 (≈25):** `.ds-bar` `14px 22px` 393, `.ds-main` `28px 22px 48px` 636, `.ds-rail` `24px 14px 40px` 657, `.ds-subnav-layout` 22 (and 14 at mobile, 5142), `.ds-panelbox` gap 14, `.ds-fields` 18, `.ds-hero` 18/18, `.ds-dl-hero` 22, `.ds-console-in` 22, `.ds-foot` `14px 16px`. These are the page gutters themselves, so the most visible spacing in the app is off-grid.
  - **D. State padding `30px 20px` / `20px`:** `.ds-empty`, `.ds-loading` (2809/2820), `.ds-modal`, `.ds-modal-backdrop`.
  - **E. 1px name/sub stacks:** `.ds-profile-who`, `.fr-who`, `.ds-subnav-btn`, `.fr-toast-who`. These are micro-adjustments standing in for line-height.
- evidence: `npm run uiaudit` reports off-grid-gap 143/143. Live spacing: 10px is the fifth most-used value (377), and 22/18/14 add up to 216 more uses.
- recommendation: A → a documented `--ds-pad-row: 10px 12px`, or retune to `8px 12px` plus min-height (one decision, applied to all ~12 rows). B → `--ds-s-2`. C → `.ds-main` `var(--ds-s-6) var(--ds-s-5) var(--ds-s-7)`, bar and foot `var(--ds-s-3) var(--ds-s-5)`, cards `--ds-s-4`. D → `var(--ds-s-6) var(--ds-s-5)`. E → allow 0 or 2 (s-0) in name stacks. Ratchet down after each group.
- contract: ui-standard §2.
- effort: M

##### 14-06 · P1 · The h1/h2 tokens are fiction: `.ds-h1`/`.ds-h2` render 38/24px, the scale says 28/20
- where: shell.css:1660 `.ds-h1 { font-size: clamp(26px, 4vw, 38px) }`, :1667 `.ds-h2 { clamp(19px, 2.4vw, 24px) }`, :3961 `.ds-title h1` (same clamp). The tokens are at :87–88.
- what: at every desktop width above about 950px, h1 renders at 38px (live: 38px ×10, one per page) and h2 at 24px. `--ds-t-2xl` has 2 call sites and `--ds-t-xl` has 9. The documented top of the scale is what nothing important uses. `.ds-dialog-title` (styles.css:1552) is fixed at `--ds-t-xl` 20px, although docs/area/ui.md:465 says it "puts them on `.ds-h2`'s type". A dialog title is therefore 20px while the section h2 behind it is 24px.
- evidence: the live sizes table lists 38 on 11/12 pages and 24 only on leaderboard. The token counts come from `rg -c "var\(--ds-t-2xl\)"`.
- recommendation: make the clamps the tokens (`--ds-t-2xl: clamp(26px,4vw,38px)`, `--ds-t-xl: clamp(19px,2.4vw,24px)`), or pin the headings to the tokens. Put `.ds-dialog-title` on the same token as `.ds-h2`. Update §3's comments.
- contract: ui-standard §3; docs/area/ui.md:465–469.
- effort: S

##### 14-07 · P1 · 14px is the real control and body size, and it is off the scale; the scale's bottom four steps are 1px apart
- where: `.ds-btn` 1567, `.ds-input` 3716, `.ds-table` 2391, `.ds-tab` 1465, `.ds-empty` 2812, `.ds-subnav-btn .sl` 1433, `.ds-home-link`, `.ds-opt .ot`, `.legal-md` (styles.css:3934), plus about 20 declarations in total
- what: the live audit counts 14px 110 times, the third most-used size, and it covers every button, input and table cell. The scale jumps 13→15. Meanwhile 11/12/13/15 are four steps within 4px (13 and 15 are unlikely to register as distinct levels), so the visible hierarchy is carried by weight, case and family rather than by size. "Six steps" is really three perceptual tiers plus two headings.
- evidence: live sizes 13px(168) 12px(163) 14px(110) 11px(57) 15px(32).
- recommendation: redefine the scale around usage: 11 / 12 / 14 / 16 / 24 / 38 (or clamps), with 13 folded into 12 or 14 and 15 into 14 or 16. Then tokenise the 20 literal 14px declarations. It is cheaper to do this now than to keep ratcheting 45 exceptions against a scale the core controls do not use.
- contract: ui-standard §3 ("each scale keeps the value the codebase already uses most": 14 is that value for controls).
- effort: M

##### 14-08 · P1 · 10px is a seventh size below the scale floor, carrying uppercase mono labels (40 live uses)
- where: `.ds-table th` 2400, `.ds-dt` 2451, `.ds-subh` 4074, `.ds-stat .sl` 4857, `.ds-hero-name .cust` 4810, `.ds-opt .oz` 4379, `.ds-note` 4467, `.ds-profile-label` 614, `.fr-badge`, `.lb-robot .tw`, `.ds-startpos-*` (5766, via `font:`), predict.css:50/107
- what: `--ds-t-xs` (11px) is documented for "eyebrows, mono labels", but the most common eyebrow treatment is 10px, muted, uppercase and letter-spaced. On configure pages it is the fourth most common size (18–22 uses per page: stat units "IN/S TOP", "DRIVETRAIN", table headers). 10px muted caps is the least legible text in the app and it labels the data a user is choosing between.
- evidence: live 10px(40), concentrated on /configure/robot pages. Mobile p2 stat tiles show "IN/S TOP" and "RAD/S TURN" at 10px.
- recommendation: move all of them to `--ds-t-xs` (11px). Keep sub-11 sizes to the canvas/HUD only, and add 10 to the uiaudit hard-fail list for shell.css.
- contract: ui-standard §3.
- effort: S

##### 14-09 · P1 · Section headings have three unrelated treatments depending on the page
- where: Configure/Controls: `.ds-panel-title`, a 12px mono uppercase 0.12em muted `<span>` (shell.css:2106; p2 "START FROM", "BUILD", p3 "TOUCH CONTROLS"). Records: `.ds-h2`, 24px/800 sentence case ("Current period", p4). Terms: `.legal-md .md-h2`, 16px/800 ink (p11). Account/Career `.ds-sec > h2`: 12px mono 0.16em caps (:4065).
- what: the same structural level ("a section of this page") is a 24px bold headline on one route and a 12px grey kicker on the next. On Configure there is nothing between the 38px h1 and 12px caps, a 3:1 jump with no h2 tier, so a panel title reads as a label, not a heading. Presets then adds a second, sentence-case 13px label ("Presets") directly under "START FROM", which gives two heading levels for one section.
- evidence: p2 / p4 / p11 side by side.
- recommendation: one section-heading role (sentence case, 15–16px, 700, ink) used by `.ds-panel-title`, `.ds-sec > h2` and the Markdown h2. Reserve the caps kicker for true metadata labels (14-10).
- contract: ui-standard §6 ("Panel title is a short noun phrase, sentence case"); docs/area/ui.md:372 (sentence case for every heading, with the caps whitelist limited to four places).
- effort: M

##### 14-10 · P2 · The uppercase letter-spaced kicker is overused (48 rules, 7 variants of one role)
- where: 36 `text-transform: uppercase` in shell.css and 12 in styles.css. The kicker variants: `.ds-panel-title` 12px/0.12em/400, `.ds-sec > h2` 12px/0.16em/600, `.ds-tileset-label` 12px/0.16em/600, `.ds-subh` 10px/0.14em/600, `.ds-table th` 10px/0.1em/600, `.ds-stat .sl` 10px/0.08em, `.ds-dt` 10px/0.04em, `.sponsor-pre` 11px/0.12em/700, `.md-h3` 13px/0.6px
- what: the p2 viewport above the fold shows about 20 all-caps strings (panel titles, subh, CUSTOM badge, 8 stat units, 5 range chips). Design-guide §3 lists "repeated uppercase kickers" as a tell. The variants also differ in size (10/11/12/13), tracking (0.04–0.16em plus px values) and weight (400–700), so even the tell is inconsistent. ui.md's "ALL CAPS is correct in exactly four places" list does not include any of these.
- evidence: `rg -c "text-transform:\s*uppercase" src/ui/*.css` → 36/12/1. There are 20+ distinct letter-spacing values across the CSS, mixing em and px (1px ×13, 3px ×4, 1.5px ×4, 0.2px ×3).
- recommendation: keep one `.ds-label` kicker token set (11px, 600, 0.08em, mono) for table headers and stat units only. Make panel and section titles sentence case (14-09) and range chips sentence case. Add the kicker sites to ui.md's caps whitelist or remove them.
- contract: design-guide §3; docs/area/ui.md:372.
- effort: M

##### 14-11 · P1 · Heading-level skips: section headings are spans, subsections are h3, and legal Markdown jumps to h4
- where: `.ds-panel-title` is a `<span>` (e.g. AccountVerify.tsx:71, AdminAnalytics.tsx:352). `Menu.tsx:936/999/1080/1124/1285` `<h3 className="ds-subh">`. `ControlsSection.tsx:516/528` `<h3>Keyboard/Gamepad`. `markdown.tsx:136–137` maps `#`→h3 and `##`→h4. Admin: `AdminUser.tsx`/`AdminReports.tsx` `<h4 className="adm-h3">` under an h2.
- what: live audit reports [1,3,3,3,3] on configure, [1,3,…] on controls/biobuzz configure and [1,4,4,…] on /terms. The real sections ("Start from", "Build") are not in the outline at all, while the sub-labels are. Terms' CSS comment (styles.css:3938) says the renderer "downshifts a level", but it downshifts two because the legal docs start at `##`. An admin class named `adm-h3` sits on an `<h4>`.
- evidence: report.txt STATES section; the files and lines above.
- recommendation: render `.ds-panel-title` as `<h2>` (a `PanelTitle` component or the `as` pattern). Keep `ds-subh`/Keyboard/Gamepad at h3. Give `heading()` a `base` level (announcements base 3, legal base 2), so `##` in legal becomes h2 or h3. Fix the admin h2→h4 skips to h3.
- contract: WCAG 1.3.1 (info and relationships). Not a hard floor fail, but screen-reader navigation by heading currently skips every Configure section.
- effort: S

##### 14-12 · P2 · Line-height has 17 values against a documented two
- where: `rg "line-height"`: 1 ×28, 1.45 ×9, 1.5 ×7, 1.2 ×4, 1.35 ×3, 1.3 ×2, 1.65, 1.55, 1.1, 1.05, 1.02, 16px, 18px, plus `/1.4`, `/1.3`, `/1.15`, `/1.2` inside `font:` shorthands (shell.css:3044, 3241, 3349, 5720, 6273)
- what: §3 says "1 for single-line UI, 1.45 for prose. No other values." The live audit finds 10px, 12px and 13px each rendered with two line-heights on the configure pages. `.legal-md` 1.65 and `.md-h` 1.3 are defensible prose and heading values, but the rest is drift. uiaudit does not check line-height at all.
- evidence: the grep counts above; report.txt "sizes with >1 line-height: 10px×2 13px×2 12px×2".
- recommendation: add `--ds-lh-tight: 1`, `--ds-lh-heading: 1.2`, `--ds-lh-prose: 1.45` (legal can keep a named `--ds-lh-long: 1.65`). Add a ratcheted uiaudit rule.
- contract: ui-standard §3.
- effort: M

##### 14-13 · P2 · Off-scale sizes: group into justified (canvas/HUD/display) and drift
- where: 45 uiaudit hits, of which:
  - **Justified (in-match or display):** styles.css 160px countdown (1396), `clamp(32px,8vw,96px)` match overlay (1716), score readouts 44/34/30 (1377/311/376), results clamps (3993–4013), `.ds-home-title clamp(44px,7vw,64px)` (shell 1175), HUD chips at 8–9px inside mobile media (styles 2913/2924/3042). These deserve a documented `--ds-t-display-*` and HUD-exception block rather than ratchet slack.
  - **Drift (shell chrome):** 14px ×20 (14-07); 10px ×19 (14-08); 16px (`.ds-stat .sv`, `.ds-empty .big`, `.ds-cta`, `.md-h1`, `.legal-md .md-h2`); 17px (`.ds-head .ds-mark` 3946, `.ann-item-title` styles 3864, `font: 750 17px` 6265/6273); 18px (`.ds-mark` 424, `.ds-tile .t` 1822, `.adm-stats.small`); 19px (`.ds-menu-btn .ml` 1369); 22px (`.ds-homestats .sv` 1746, `.lb-standing-rank` 2698, `.rs-num` 2882); 24px (`.ds-hero-name` 4803, `.adm-stat b`); 26px (styles 2589).
- what: the drift clusters at 16–24px, the headline tier the scale leaves empty between 15 and 20. It is also where stat and number displays live: 16, 22 and 24 for the same "big number" role on three screens.
- evidence: the live cross-page drift flags 17px (lobby) and 24px (leaderboard) as single-page values.
- recommendation: add one `--ds-t-num` (22px) for stat values and one `--ds-t-title` (18px) for tile and menu titles, and collapse 16/17/19 into them. Move the justified set to named display tokens outside the ratchet.
- contract: ui-standard §3.
- effort: M

##### 14-14 · P2 · Card padding takes six values across card types
- where: `.ds-panel-body` 16 (1923), `.ds-panel-h` `12px 16px` (2102), `.ds-panelbox` 16 + gap 14 (4478), `.ds-hero` 18 (4598), `.ds-dl-hero` 22 (5635), `.ds-dl-opt` `10px 12px` (3470), `.lb-config` `14px 16px` (2788), `.lb-standing` `10px 14px`, `.ds-empty` `30px 20px`, `.ds-modal` 20
- what: §2 says "Panel body padding is `--ds-s-4`, always". Visible on p10: the hero card's inset (22) differs from the build cards' inset beneath it (about 16), so their text left edges do not line up. p2: the hero card (18) and the Start-from panel body (16) are misaligned by 2px.
- evidence: the rules above; p10 left edges at x≈259 vs x≈253.
- recommendation: `--ds-s-4` for every card body. Compact option tiles get a single documented `--ds-s-3` exception.
- contract: ui-standard §2, §6.
- effort: S

##### 14-15 · P2 · Space Grotesk ("mono") is used for prose sub-lines, which blurs the data/copy split
- where: `.ds-menu-btn .mh` (shell.css:1373, p0 "Practice & compete", "Robot & match setup" in letter-spaced Space Grotesk), `.ds-panel-title`, `.ds-sec > h2`, `.ds-subh`, `.sponsor-pre`
- what: DESIGN.md's split is "mono for everything they read as a number", and the design guide says Space Grotesk is "only for technical labels". Home menu descriptions are marketing copy, not telemetry, yet they are the most prominent Space Grotesk text on the landing page. Space Grotesk is also a proportional grotesk, not a monospace: the token is `--ds-font-mono` and DESIGN.md calls it "monospace", so any "digits line up" guarantee depends entirely on `tabular-nums` being set (23 sites in shell.css).
- evidence: p0; DESIGN.md:75, :124, :133.
- recommendation: menu sub-lines in `--ds-font-ui` at `--ds-t-sm` with no tracking. Rename or document `--ds-font-mono` as the "data" face, and require `tabular-nums` wherever it sets digits.
- contract: DESIGN.md Typography, Digits-Are-Mono rule.
- effort: S

##### 14-16 · P2 · Numbers that change sit in the body face without tabular figures
- where: `.ds-replay-score .rs-num` 22px/700 body font (shell.css:2882; tabular only inherited from the parent), `.lb-standing-rank` 22px/800 body font with no `tabular-nums` (:2698), `.adm-stat b` 24px (styles 3217)
- what: the replay score ticks during playback, which is exactly the case the Digits-Are-Mono rule covers. The rank and admin stats are static, but they sit beside mono stat values elsewhere, so "big number" has two faces.
- evidence: the rules above versus `.ds-stat .sv` (mono and tabular, :4848).
- recommendation: one `.ds-num` utility (mono, tabular, 700) used by all big-number displays.
- contract: DESIGN.md Digits-Are-Mono.
- effort: S

##### 14-17 · P2 · uiaudit's grid and type rules have blind spots that let drift in unmeasured
- where: scripts/uiaudit.mjs:258–270 (grid), :218 (font size)
- what: the grid rule checks only `gap` and the first two `padding` values. It never checks `margin` (off-grid margins: 6px ×7, 10px ×7, 3px ×6, 18/20/26/28px, negative −4/−6/−7/−8/−10, e.g. `.ds-subh margin: 4px 0 -4px`, `.md-h margin: 14px 0 6px`, `.legal-md .md-h2 26px`, `.ds-robot margin-top: 18px`). It also misses 3–4-value paddings (`22px 24px 20px` passes on its first two), line-height (14-12), letter-spacing, and whether a `font:` shorthand is valid (14-01). Negative margins are the telltale of two owners fighting over one gap.
- evidence: `grep -hE "^\s*margin…"` tally; the regex source.
- recommendation: extend rule 6 to margins and all padding values, and add line-height and letter-spacing to the ratchets at their current counts. The counts will jump, but that reflects the actual debt more accurately.
- contract: ui-standard §2, §9.
- effort: S

##### 14-18 · P2 · Two page shells with different gutters and widths
- where: `.ds-main` `padding: 28px 22px 48px; max-width: 1080px` (shell.css:636) versus `.ds-console-in` `width: min(900px, 94vw); padding: 26px 0 72px` (:3899)
- what: the top offset differs (28 vs 26), the bottom differs (48 vs 72), the horizontal gutter is either 22px or 3vw, and the max width is 1080 or 900. The standard's page margin is `--ds-s-7` (48) top and bottom, but neither shell uses it on top. docs/area/ui.md:468 already fixed the "same h1 on two shells" drift, and the containers still diverge.
- evidence: the rules above.
- recommendation: one page-container token set (`--ds-page-max`, gutter `--ds-s-5`, top `--ds-s-6`, bottom `--ds-s-7`) shared by both shells.
- contract: ui-standard §2 (`--ds-s-7` page margin), §6.
- effort: S

##### 14-19 · P2 · Letter-spacing on headings mixes em and px and flips sign between siblings
- where: `.ds-h1` −0.02em, `.ds-h2` −0.015em, `.lb-standing-rank` −0.5px, `.ds-menu-btn .ml` +0.04em (19px/800 menu labels, p0 "Play/Configure"), `.ann-item-title` +0.2px, `.md-h` +0.2px
- what: display headings are tightened, but the home menu's large labels are loosened by 0.04em and Markdown headings by 0.2px. Positive tracking on 19px bold sentence-case text makes the home's biggest words read looser than the h1 above them (p0).
- evidence: the rules above; p0.
- recommendation: headings ≥18px get `-0.015em`, body 0, caps labels one positive value. Tokenise as `--ds-track-tight/0/caps`.
- contract: ui-standard §3 (every value from a token).
- effort: S

##### 14-20 · P3 · The same wordmark renders at two sizes
- where: `.ds-mark` 18px/900 (shell.css:424, the app bar), `.ds-head .ds-mark` 17px (:3946, the console shell)
- what: a 1px difference in the brand mark between shells. It is the same kind of drift ui.md:468 fixed for `.ds-title h1`.
- evidence: the rules above.
- recommendation: delete the `.ds-head .ds-mark` size override.
- contract: docs/area/ui.md dialog/page shell sweep.
- effort: S

##### 14-21 · P3 · ui-standard §3 contradicts itself on weights, and §6 names a class that does not exist
- where: docs/ui-standard.md:73 heading "six sizes, four weights" versus the body "400, 500, 600, 700, 750, 800, 900"; §6 Page anatomy "`ds-eyebrow` → `ds-h1`". `.ds-eyebrow` has no CSS rule (only a comment in Sponsor.tsx:233), and §9's grep still bans `font-weight: (500|750|900)`.
- what: the heading and the §9 enforcement grep describe the rejected four-weight draft, while the body permits seven. Live, 750 appears on one page (modes, 7 uses) and 900 appears only on the mark (12), so seven weights are in play for one type ramp. Kicker weights alone span 400–700 (14-10).
- evidence: the lines quoted above.
- recommendation: retitle §3, fix the §9 grep, and remove `ds-eyebrow` from §6 or create it. Consider documenting which role owns each weight (400 body, 600 label, 700 control, 800 heading, 900 mark), so 500 and 750 get a named owner or are removed.
- contract: ui-standard §3/§6/§9.
- effort: S

##### 14-22 · P3 · `.md-code` uses a system monospace stack and a 5px literal radius
- where: styles.css (`.md-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; border-radius: 5px; padding: 1px 4px }`)
- what: this is the one place the app renders the OS monospace font (the audit's lone "monospace(1)" family and cross-page-drift entry). It bypasses both family tokens and the radius scale.
- evidence: report.txt families "monospace(1)"; the drift list.
- recommendation: `font-family: var(--ds-font-mono)` (or document a code-face token), `border-radius: var(--ds-round-sm)`, `padding: var(--ds-s-0) var(--ds-s-1)`.
- contract: ui-standard §3 families, §4.
- effort: S

#### Strengths (keep)
- Real tokens exist and are defined in one place (`--ds-s-0..7`, `--ds-t-xs..2xl`, `--ds-font-ui/mono`, shell.css:74–88, 213–214). The ratchet model (uiaudit) turns debt into a number that can only go down, and the comment history in uiaudit.mjs explains each decrement.
- Zero fractional font sizes, zero banned weights and zero undefined tokens: the hard-error rules have held.
- `.ds-panel-body` / `.stack` / `.row` gave the inline `padding:16` sprawl a class-based owner. Only 5 inline-spacing hits remain.
- `.legal-md` gives long-form text a proper measure (68ch) and prose leading (1.65). p11 reads well.
- Data chips and stat values use mono with `tabular-nums` (`.ds-chip` 1546, `.ds-stat .sv` 4848), so the telemetry split is visibly real on the robot hero (p2).
- Contrast is ALL PASS in both themes, and every kicker stays on `--ds-mut`, not a lighter grey.

### 15 · Colour and theming (cross-cutting): screenshots p0–p10 light vs dark (desktop), the shell.css token blocks (22–360), theme.ts, the range/menu/tile/selection rules, styles.css HUD literals, the game RobotPreviews, config.ts COLORS, contrast.mjs coverage

##### 15-01 · P0 · The urgent server notice is white on red-500 at 13px, which is 3.76:1
- where: src/ui/styles.css:3085-3088 (`.server-notice.urgent`)
- what: `background: rgba(239,68,68,.97); color:#fff` at 13px/700. White on #ef4444 is about 3.76:1. That fails AA for text this size (4.5 is required: bold text only counts as large at 18.66px and up). This is the "server restarting now" banner, the one message that must be read at a glance.
- evidence: I computed it by hand from the WCAG luminance formula. `scripts/contrast.mjs` has no entry for `.server-notice`, so "ALL PASS, 269" never tests this pair. Same block: the amber variant uses a literal `rgba(251,191,36,.96)` and a blurred `0 6px 24px` shadow instead of tokens.
- recommendation: Use `--ds-red-chip` with `--ds-red-chip-ink` (already audited). Use `--ds-gold` with `--ds-gold-ink` for the non-urgent variant. Add both pairs to contrast.mjs.
- contract: ui-standard §5 (no literals; a new pair means a contrast.mjs entry); DESIGN No-Blur rule.
- effort: S

##### 15-02 · P0 · The sub-line on the primary home keycap is 4.40:1 in light theme
- where: src/ui/shell.css:1394-1396 (`.ds-menu-btn.primary .mh`); audit-light/p0-desktop.png ("Practice & compete")
- what: `color-mix(accent-ink 74%, transparent)` over `--ds-accent` #366758 blends to about #cbd8d4. That is 4.40:1 at 12px mono, just under AA. Dark theme passes (about 4.8:1), so this only fails in light. It is the first thing a player reads on the first screen.
- evidence: Hand-computed composite. contrast.mjs has no `menu-btn`/`.mh` entry. The alpha-mix is how the gap stayed invisible.
- recommendation: Use solid `--ds-accent-ink`, or a token such as `--ds-accent-ink-dim` (about 85%) registered in contrast.mjs for both themes. Do not dim ink with alpha over a fill.
- contract: DESIGN Fill-Is-Not-Text; ui-standard §5.
- effort: S

##### 15-03 · P1 · The slider thumb renders as the browser's native blue in both themes
- where: src/ui/shell.css:4527-4553; audit-light/p3-desktop.png and audit-dark/p3-desktop.png (Stick deadzone / Sensitivity curve)
- what: The puck is Chromium's default blue (saturated blue in light, pale blue in dark) sitting on a green-filled track. The `::-webkit-slider-thumb` rule is written in accent, but it is not taking effect. The likely cause: the `input[type=range].ds-range` host rule never sets `appearance:none` / `-webkit-appearance:none`, and Chromium only honours a custom thumb when the input itself has it. The green fill you see is the host element's own gradient background.
- evidence: Both screenshots show a blue disc. The only `-webkit-appearance:none` in the block is on the thumb pseudo-element (line 4545).
- recommendation: Add `appearance:none; -webkit-appearance:none;` to the host `input[type='range'].ds-range` (and `.ds-replay-seek`). Blue is reserved for the alliance, so a blue control in the builder is exactly the collision the system forbids.
- contract: DESIGN "Alliance red/blue are the only saturated… accent"; the slider comment's own intent (mint puck).
- effort: S

##### 15-04 · P1 · The robot preview is a dark field in DECODE but a themed panel in Chain and BIOBUZZ
- where: src/ui/RobotPreview.tsx:20-41 (DECODE: dark mat, `--ds-on-field-accent`) vs src/games/biobuzz/RobotPreview.tsx:123-124,406-430 and src/games/chain/RobotPreview.tsx:93-94,436-461 (`--ds-panel`/`--ds-accent`/`--ds-ink-dim`); audit-light/p2 vs p9
- what: In light theme, the DECODE hero shows a black canvas card with a mint outline. The BIOBUZZ hero, in the same slot, shows a white card with a dark green outline. The same component slot follows two different theming philosophies depending on the game. DECODE's file even documents why it moved to the mat ("the sprite is in the environment it was designed for"), and the other two games never followed.
- evidence: p2-desktop light (dark thumbnail) vs p9-desktop light (white thumbnail). In dark theme they look alike only by coincidence.
- recommendation: Pick one. Given the DECODE rationale, move the Chain and BIOBUZZ previews to the field mat plus the category-3 tokens. Either way, remove the fork.
- contract: THEMING gotcha category 3; design-guide §4.3 "same component the same everywhere".
- effort: M

##### 15-05 · P1 · At least seven different reds and blues express alliance identity
- where: --ds-red #ff4d4d / --ds-red-chip #d32020 / --ds-red-ink (shell.css:94-123); COLORS.red #ef4444, redLabel #f87171, blue #3b82f6, blueLabel #60a5fa (src/config.ts:2926-2946); `.score-panel.red` gradient #7f1d1d→#991b1b and `.blue` #1e3a8a→#1d4ed8 (styles.css:278-284)
- what: The HUD score bar, the one place a driver reads their alliance colour every second, uses Tailwind red-900/800 and blue-900/700 literals that appear nowhere in the token set. The field uses Tailwind 500s, and the chrome uses a third pair. The dark block's own comment says `--ds-red` is "painted by src/render/", but render reads COLORS, a different hex. So the "one meaning per colour" claim for red/blue has no single source.
- evidence: Grep; `var(--ds-red)` is not referenced anywhere under src/render.
- recommendation: Define the score-panel fills as tokens (`--ds-red-deep`/`--ds-blue-deep`) next to the chips. Either make COLORS.red/blue the same values as `--ds-red`/`--ds-blue` or delete one side. Document which roles each shade is for (fill, text, field, label).
- contract: DESIGN "an alliance's color must mean the same thing"; ui-standard §5 no literals.
- effort: M

##### 15-06 · P1 · A recommended tile looks exactly like a selected tile
- where: src/ui/shell.css:1832 (`.ds-tile.primary`); audit-*/p1-desktop.png ("Solo Practice")
- what: Solo Practice is filled solid accent because it is the *primary* mode, not because it is chosen. The same solid-accent fill means "selected" on `.ds-seg.on`, `.ds-listbox-opt.on`, `.ds-startpos-tab.on`, `.ds-dl-seg .on` and `.bb-cell.on`. Next to four greyed tiles, a player reads Solo Practice as the current selection.
- evidence: p1 light and dark. It is the only saturated tile on the page, and it uses the same fill as the segmented "Records / Solo / Overall" selections on p4.
- recommendation: Show primary on a tile with the keycap edge, a `--ds-accent` border and title ink, not a solid fill. Keep solid fill for one meaning (selected / CTA button).
- contract: DESIGN "Driver Green… primary buttons, links, focus rings, active states" (it already covers four jobs; tiles make five).
- effort: S

##### 15-07 · P1 · Selection has three different visual idioms, all in green
- where: shell.css:710 (`.ds-rail-btn.on`: soft fill + accent border), 1441 (`.ds-subnav-btn.on`: same), 1478 (`.ds-tab.on`: accent underline plus accent TEXT), 2183 (`.ds-seg.on`: solid fill), 4226 (`.ds-opt.on`: soft fill plus accent-edge shadow)
- what: On /configure/controls (p3) one viewport shows a soft-mint rail item, a soft-mint subnav item, a solid-green "All games" segment and a soft-mint "Left" option. On p4 there is also a green underline tab. Each idiom is defensible alone, but together "on" has no single look. Accent is also the link colour, the focus ring, the primary CTA, the tutorial banner tint, the `.ds-opt.real` marker, the `CUSTOM`/range tags, the lobby headline word and the leaderboard "ranked" type (148 `var(--ds-accent)` uses plus 32 accent color-mixes).
- evidence: Screenshots p3/p4; the grep counts above.
- recommendation: Two idioms at most: solid for segmented controls (one of N inline) and soft fill for navigation and cards. Move the preset range tags (`MID RANGE`, `LONG RANGE`) and the `CUSTOM` tag to neutral chips (`--ds-tile` + `--ds-ink-dim`). They are categories, not state.
- contract: DESIGN Primary "the one brand accent"; design-guide §4.3.
- effort: M

##### 15-08 · P1 · Gold is documented for staff badges only, but it carries six jobs
- where: DESIGN.md Signal Gold; uses at styles.css:523 (CR action prompt chip), 849 (card icon), 1258 (catalyst pip prompt), 2037 (world-record banner), 3439 (supporter badge), 3960 (season cinema); shell.css:2694-2746 (provisional standing); plus a second gold `--ds-podium-gold` #e8b730 (shell.css:171)
- what: The same fill means "you are a supporter", "act now", "provisional rank", "world record" and "this season". Two golds that differ by a few degrees of hue sit side by side as distinct tokens.
- evidence: Grep for `var(--ds-gold)`: 11 sites.
- recommendation: Update DESIGN.md to say what gold means ("attention / achievement"). Drop the "staff only" claim, or move the prompt/provisional cases to `--ds-warn`. Merge `--ds-podium-gold` into `--ds-gold`, or document why it differs.
- contract: DESIGN Signal Gold; the Three-Zone "name its zone" Do.
- effort: S

##### 15-09 · P1 · The admin staff badge is alliance-blue with a literal white
- where: src/ui/styles.css:3521-3524
- what: `.sup-badge.admin { background: var(--ds-blue-chip); color:#ffffff }`. It uses a literal instead of `--ds-blue-chip-ink`, and it reuses alliance blue beside names in lobby rosters. The comment admits the collision.
- evidence: Code; DESIGN "red/blue reserved for alliance identity".
- recommendation: Use the `-ink` token at minimum. Better, give staff their own token (e.g. a desaturated `--ds-sky-ink`-family fill), and keep blue meaning an alliance.
- contract: ui-standard §5; DESIGN State/Alliance.
- effort: S

##### 15-10 · P1 · Pre-redesign pastel tokens live on as new ones: `--ds-award` is a lavender
- where: shell.css:39-44 (`--ds-blush/sage/lavender/sky` plus dark siblings 297-300), 161 (`--ds-award: #a78bfa`), 7593
- what: DESIGN.md says the pastels are deprecated and have zero call sites (a `var(--ds-blush|sage|lavender|sky)` grep finds none). Yet they are still defined in both theme blocks and still audited by contrast.mjs. Meanwhile `--ds-award` reintroduces a lavender (Tailwind violet-400) as a new tint for awards, next to `--ds-purple` #a96bff, which is a different purple.
- evidence: Grep results.
- recommendation: Delete the four pastels and their dark overrides and contrast entries. Fold `--ds-award` into `--ds-purple`, or name its zone in DESIGN.md.
- contract: DESIGN Don't (pastels); ui-standard §10 dead tokens.
- effort: S

##### 15-11 · P2 · The canvas editors hardcode legal/illegal hex values instead of reading tokens
- where: src/ui/StartPositionEditor.tsx:148,152,170; src/ui/ChainStartEditor.tsx:188,197,216
- what: `'#37d67a' : '#ff4d4d'` copies the `--ds-green`/`--ds-red` values. `#0d1720` is an unexplained backdrop that is neither the field `#14161a` nor any token. RobotPreview.tsx already has the `getComputedStyle` read pattern (line 140).
- evidence: Grep.
- recommendation: Read `--ds-green`/`--ds-red` through the existing helper. Replace `#0d1720` with the field constant from `COLORS`.
- contract: ui-standard §5.
- effort: S

##### 15-12 · P2 · The announcement cinema is glow-on-dark: blurred colour shadows and gradient washes
- where: src/ui/styles.css:3960-4055 (`.ann-cinema`: `text-shadow: 0 0 40px`, `box-shadow: 0 0 30px/44px color-mix(--cin …)`, radial halo, `#05070b` literals)
- what: This is the only surface with coloured glow. It breaks the No-Blur rule, and it is the design-guide's "cyan-glow-on-dark" tell, in gold and mint.
- evidence: Code; design-guide §3 Color table.
- recommendation: Replace the glows with the block/edge vocabulary: a solid `--cin` keycap and a flat scrim.
- contract: DESIGN No-Blur; design-guide §3.
- effort: M

##### 15-13 · P2 · Accent-tinted gradients sit behind the page and the hero card
- where: shell.css:3869 and 4613 (radial accent 8-10% wash), 4597 and 5634 (`.ds-hero` tile→panel 160° gradient); audit-light/p6 (lobby, green haze at top), p2/p9 (hero card)
- what: A soft gradient atmosphere doesn't fit a system that claims "flat keycap". In light theme the hero's grey-to-white sheen reads as skeuomorphic chrome next to flat panels. In dark it vanishes (tile→panel is under 1.1:1), so it is decoration only one theme can see.
- evidence: Screenshots p2 light vs dark.
- recommendation: Flat `--ds-panel` for `.ds-hero`, and no accent wash on page backgrounds.
- contract: DESIGN Elevation "Flat by default".
- effort: S

##### 15-14 · P2 · The lobby headline paints a word in accent
- where: src/ui/Lobby.tsx:735 (`Multi<span className="accent">player</span>`); audit-*/p6-desktop.png
- what: This is the only h1 in the app with a two-tone wordmark. Here accent is decoration, not state, and it competes with the solid-green CTA right below it. No other page does it (Pick a mode, Configure, Records, Download).
- evidence: p6 vs p1/p2/p4/p10.
- recommendation: Plain `--ds-ink` "Multiplayer".
- contract: ui-standard §6 page anatomy; DESIGN "color is spent deliberately".
- effort: S

##### 15-15 · P2 · Two left-edge accent stripes (the design-guide tell)
- where: shell.css:1109 (`.fr-toast { border-left: 3px solid var(--ds-accent) }`), 4163 (`.ds-opt.real` inset 3px accent); audit-*/p9 (StarterBot card); plus `.ds-player`/`.ds-strat-card` border-left in alliance colours (5500, 5583)
- what: In p9 the one preset with a green left bar reads as selected or recommended, not "a real team's build". The comment even worries it could be "mistaken for a selection state". The toast uses the same stripe.
- evidence: p9 light and dark.
- recommendation: Mark real robots with a text chip ("Real team") in neutral ink, and drop the stripe. Keep alliance stripes only where the alliance is the content.
- contract: design-guide §3 "Thick colored accent border on one side".
- effort: S

##### 15-16 · P2 · In dark theme, Status Green and Driver Green are nearly the same colour
- where: shell.css dark block: `--ds-accent #5fb597` vs `--ds-ok-ink #4ec27f`
- what: DESIGN.md says `ok` exists "so a ready-chip and a primary button are never visually confused". In light the two are well apart (#366758 vs #1f7a46). In dark they are two mid-mints only a few degrees of hue apart, and `.mh-result.win` next to `.mh-type.ranked` would read as the same colour.
- evidence: Token values; DESIGN Status Green.
- recommendation: Push dark `--ds-ok-ink` toward a yellower green (about #7bd35a), or give win/ready a glyph as well as colour.
- contract: DESIGN Status Green.
- effort: S

##### 15-17 · P2 · The mobile edit bar's primary ink is a one-off literal
- where: src/ui/styles.css:2883-2886 (`color:#10241b` on `--ds-on-field-accent`)
- what: Category-3 fill with an ad-hoc ink. The pair is not in contrast.mjs, and there is no `--ds-on-field-accent-ink` token, so the next person will invent a third value.
- evidence: Code; contrast.mjs grep.
- recommendation: Add `--ds-on-field-accent-ink` (category 3, no dark override) and register it.
- contract: THEMING categories; ui-standard §5.
- effort: S

##### 15-18 · P2 · The per-game identity changes no colour, but the game label is only grey text
- where: audit-*/p0, p7, p8 (home per game); `src/seasons.ts`; styles.css:3815 `.ann-badge.season`
- what: DECODE, Chain Reaction and BIOBUZZ render identical chrome. The only cue is a grey "DECODE"/"BIOBUZZ" in the bar and a selected pill. That is correct for DSIM-the-brand (CLAUDE.md: keep brand and season separate). But the in-match field art already carries each season's colour (biobuzz scenes.ts:276, yellow pollen). Chrome should NOT re-accent per game (it would break every audited pair three times over). A single season swatch (a fixed-ink dot beside the bar's season name, sourced from each game's field palette) would make "which game am I configuring" legible on /configure, where p2 and p9 are otherwise indistinguishable above the fold.
- evidence: p2 vs p9 differ only by the robot sprite and the grey bar label.
- recommendation: Add one category-2 `--season-dot` per game, used in the bar and on the season pills only. Do not theme accents per game.
- contract: CLAUDE.md brand/season separation; Three-Zone rule.
- effort: S

##### 15-19 · P3 · DESIGN.md's colour facts have drifted from the code
- where: DESIGN.md frontmatter and Do's
- what: It says "175 pairs" (contrast now runs 269). The frontmatter omits `--ds-red`/`--ds-blue` (the field identity pair), `--ds-podium-*`, `--ds-award`, `--ds-pollen`, `--ds-sky-ink` and all dark values. "Signal Gold… staff/supporter badges only" is false (15-08).
- evidence: shell.css:22-175 vs DESIGN.md.
- recommendation: Regenerate the frontmatter from the token block, with light and dark columns and a zone for each token.
- contract: design-guide §2 "amend it in the same commit".
- effort: S

##### 15-20 · P3 · Literal `rgba(…)` HUD scrims bypass the `--ds-hud` tokens
- where: styles.css:1485, 2540, 2742, 2790, 2812, 2861, 3099 (five slightly different dark scrims: 10,12,16 / 8,10,14 / 28,32,39 / 20,24,30)
- what: Near-duplicate category-3 scrims, each tuned by hand, with blurred shadows at 2776/2797/2864/3834.
- evidence: Grep.
- recommendation: Two tokens (`--ds-scrim`, `--ds-scrim-strong`) in category 3.
- contract: ui-standard §5.
- effort: S

#### Strengths (keep)
- The three-zone token model is real and well commented. The dark block explains each non-obvious value (why #20262c: shadow headroom; why `--ds-line-strong` is tuned to the panel; the accent-ink inversion warning).
- Dark theme is designed, not merely tolerated. In p0–p10 the surface ladder, the block shadows and the keycap edges all survive the swap, and hierarchy holds (tile recessed below panel in both themes).
- `--ds-hud-line`, the `-ink` fill/text splits (`ok`/`ok-ink`, `gold`/`gold-ink`, `red-chip-ink`) and the `on-field*` family close real, previously shipped bugs.
- The legacy HUD alias bridge (`--text: var(--ds-ink)` and so on) themes about 90 old rules with no second palette.
- DECODE's RobotPreview correctly uses `--ds-on-field-accent` on the mat and documents why. It is the model the other two games should copy.
- `color-scheme: dark` is set, so scrollbars and native popups follow the theme.

### 16 · Component variant census (cross-cutting): buttons, chips/badges, inputs/sliders, cards, tabs/segs, dialogs, tables, banners, empty states. Sources: src/ui/shell.css, src/styles.css, tutorial.css, predict.css, the TSX call sites, DESIGN.md, docs/ui-standard.md, docs/area/ui.md, docs/ui-components.md, report.json and the p0-p10 screenshots

| family | intended (DESIGN.md / ui-standard) | actual distinct looks | worst offenders |
|---|---|---|---|
| Buttons | 4 (`.ds-btn` default/primary/ghost/small) | ~20 | `.ds-menu-btn`, `.ds-home-link`, `.ds-cta`, `.ds-discord-join`, `.overlay-buttons button`, `.ds-back`, `.game-btn`, `.ds-tut-btn`, undocumented `.danger` |
| Pills/chips/badges | 1 (`.ds-chip` + red/blue/on/off) | ~14 | HUD `.chip` duplicates `.ds-chip`; 11 ad-hoc badges at 9-10px |
| Inputs/selects/sliders | 1 (`.ds-input`, recessed) | 6 | `.ds-range` base rule lost, so the native blue thumb shows; `.ds-input` focus ring differs from the contract |
| Cards/panels | 2 (`.ds-panel`, `.ds-panelbox`) | ~8 | `.ds-panelbox` near-duplicate; gradient `.ds-dl-hero` |
| Tabs/segmented/subnav | 0 documented (ui.md names `.ds-segs`) | 7 | `.ds-startpos-tabs` (literal 9/7px radii, dropped font), `.ds-dl-seg`, rail vs subnav twins |
| Dialogs | 1 (ui-standard §6 anatomy) | 4 | shell dialogs built on the match `.overlay-panel` with legacy tokens |
| Tables | 1 | 3 | `.adm-table` vs `.ds-table` |
| Toasts/banners | 0 documented | 4 | `.ds-rejoin` reused as the tutorial offer |
| Empty states | 4 list states | 2 (no error state) | Leaderboard error reuses `.ds-empty` and shows an env var |

##### 16-01 · P1 · Slider base rule lost: every `.ds-range` renders the native blue thumb on an 8px-tall control
- where: src/ui/shell.css:4527-4553 (Controls p3, Graphics, bind rows, replay seek)
- what: The selector list `input[type='range'].ds-range,` runs straight into a comment and then into `::-webkit-slider-runnable-track`. The base rule's body (`appearance:none; width:100%; background:transparent`) is gone, so the input element itself inherits the track block (height 8px, gradient, border). Because appearance is never reset, the 18px accent puck thumb rules at 4543-4553 never apply in Chromium, Electron or WebKit.
- evidence: The p3 screenshot shows the OS-blue thumb. report.json has a WARN for "input.ds-range 282x8 touch target". Commit 23906fe still has the intact base rule `input[type='range'].ds-range, .ds-bind-row input[type='range'], .ds-replay-seek { width:100%; ... }`.
- recommendation: Restore a separate base block: `input[type='range'].ds-range, .ds-bind-row input[type='range'], .ds-replay-seek { -webkit-appearance:none; appearance:none; width:100%; height:24px; background:transparent; }`, and keep the track and thumb blocks separate. Check Firefox, whose -moz rules at 4554-4574 are independent.
- contract: DESIGN.md inputs (accent puck, recessed track); 44px/24px target minimum.
- effort: S

##### 16-02 · P1 · Five `font: … inherit` shorthands are invalid, so the whole declaration is dropped
- where: src/ui/shell.css:5795 (.ds-startpos-toggle), 5820 (.ds-startpos-tab), 5830 (.ds-startpos-role), 5903 (.ds-roleswap-role), 5917 (.ds-roleswap-note). Used by StartPositionEditor.tsx:320-325, ChainStartEditor.tsx:396-401 and RoleSwapBar.tsx:43-61.
- what: `inherit` is a CSS-wide keyword and cannot appear inside a shorthand, so `font: 700 12px/1 inherit` is a parse error. Weight, size and line-height all fall back to inherited or UA values. This is the same silent bug class as the `--ds-font` gotcha in CLAUDE.md, but uiaudit does not catch it.
- evidence: e.g. `font: 700 12px/1 inherit;` at 5820. The tab labels render at the button UA default instead of 12/700.
- recommendation: Use `font: 700 12px/1 var(--ds-font-ui)`, or longhands plus `font-family: inherit`. Add a uiaudit rule that flags `font:` shorthands ending in a CSS-wide keyword, at a baseline of 0.
- contract: ui-standard type scale; CLAUDE.md font-shorthand gotcha.
- effort: S

##### 16-03 · P1 · The keycap button recipe is copy-pasted into about 10 classes instead of being one component
- where: `.ds-btn` shell.css:1562, `.ds-menu-btn` 1352, `.ds-home-link` 1317, `.ds-discord-join` 1201, `.ds-cta` 5249, `.ds-back` 3919, `.ds-linkbtn` 6342, `.overlay-buttons button` styles.css:1571, `.game-btn` styles.css:1319, `.ds-tut-btn` tutorial.css:105
- what: Each class re-declares border, radius, edge shadow, hover `0 2px 0` and the pressed translate, with its own padding (8/16, 16/18, 12/16, 10/22, 6/12, 8/12, 4/10) and its own type (12-19px, weights 600-800). The hover shadow line appears 16 times (12 in shell.css, 4 in styles.css). The page clusters count 7 button looks on home, 10 on modes, 12 on configure, 12 on controls and 11 on leaderboard.
- evidence: `.ds-back` (13/700, 8px 12px) is a `.ds-btn.small` with a margin. `.ds-menu-btn` uses 18px padding (banned) and 19px `.ml` (off-scale).
- recommendation: Keep one `.ds-btn` that owns the keycap mechanics. Express size as `.small`/`.large` and shape as `.pill`, and let the others compose it (`ds-btn large pill` for the menu, `ds-btn pill` for socials, `ds-btn primary large pill caps` for the CTA). Delete `.ds-back` and move `.overlay-buttons` onto `.ds-btn`.
- contract: DESIGN.md Buttons; Transform-Only Press; ui-standard 4px grid and type scale.
- effort: L

##### 16-04 · P1 · The three home-page "pill" treatments are really two families, and the pill shape is undocumented
- where: season switcher `.ds-segs/.ds-seg` shell.css:2139/2166; socials `.ds-home-link` 1317; Play/Configure/Records/Profile `.ds-menu-btn` 1352 (+`.primary` 1388); also `.ds-discord-join` 1201 and `.ds-cta` 5249. Seen on p0.
- what: `.ds-home-link` and `.ds-menu-btn` are the same keycap at two sizes: full pill, panel fill, edge-soft shadow, same press. They should be one component. The season switcher is correctly a different family (a segmented one-of-N), but it sits at an 8px radius, borderless, inside a column of pills, so it reads as the odd one out. The header "Profile" `.ds-btn` (8px) and the menu "Profile" pill both appear on the same screen. DESIGN.md says buttons are 8px and "pill only for chips/high-identity", so none of the pill buttons are sanctioned.
- evidence: p0 screenshot: four radii (8px header button, 8px segments, pill socials, pill menu) in one viewport.
- recommendation: Decide once. Either document `.ds-btn.pill` as the high-identity hero shape (menu, socials, CTA, Discord) and give the season switcher a pill tray to match, or square the menu and socials to 8px. Drop the duplicate Profile entry.
- contract: DESIGN.md Buttons radius; "pill only for chips/high-identity".
- effort: M

##### 16-05 · P1 · "ghost" means three opposite things
- where: `.ds-btn.ghost` shell.css:1601 (about 108 uses); `.ds-cta.ghost` 5284; `.overlay-buttons button.ghost` styles.css:1609
- what: `.ds-btn.ghost` keeps its 1px border and drops the shadow, so at rest it looks like a pressed default button (e.g. "All releases" on p10). `.ds-cta.ghost` is a panel-filled keycap with a shadow, the opposite. The overlay ghost is a neutral keycap on legacy `--panel-2`/`--text`/`--border`.
- evidence: DESIGN.md says ghost has no fill, no shadow and no press. Only one of the three follows that, and even it keeps a border that makes it look depressed.
- recommendation: One meaning: `ghost` = text-only (no border, no shadow, underline or tint on hover). Rename `.ds-cta.ghost` to a secondary size of `.ds-btn`.
- contract: DESIGN.md Buttons (ghost).
- effort: M

##### 16-06 · P1 · Five selected-state vocabularies, mixed on one screen, and a primary tile that reads as selected
- where: filled accent `.ds-seg.on` 2183, `.ds-startpos-tab.on` 5825, `.ds-dl-seg button.on` 3572; mint accent-soft `.ds-opt.on` 4226, `.ds-rail-btn.on` 710, `.ds-subnav-btn.on` 1441; underline `.ds-tab.on` 1478; outline `.ds-key.selected` 5418; ink ring `.chassis-sw.on` styles.css:3398
- what: p3 (Controls) puts the scope switch (filled `.ds-seg`) next to the Drive stick Left/Right choice (mint `.ds-opt.mini`), so one-of-N has two looks on one screen. On p1, `ds-tile primary` (ModeSelect.tsx:102, its only use, shell.css:1832) is filled accent, which is identical to a selected seg, but it is not a selection. On p6 (Lobby), a mint "Create room" `.ds-opt.on` sits beside the "CREATE ROOM" `.ds-cta`.
- recommendation: Fix one rule: one-of-N selection = mint accent-soft plus accent edge (the OptRow language ui.md already mandates), and filled accent = primary action only. Move `.ds-seg.on` and `.ds-startpos-tab.on` to mint, and drop `.ds-tile.primary`, or restyle it as a CTA, not as a selection.
- contract: docs/area/ui.md (OptRow is the one spelling of a pick); DESIGN.md primary.
- effort: M

##### 16-07 · P1 · Two dialog systems: shell dialogs are built on the match overlay with legacy tokens
- where: `.ds-modal` shell.css:3683 (AuthPanel, ChallengePicker, TermsGate, UsernameGate, RewardDialog); `.overlay-panel` styles.css:1492 used by six shell dialogs in App.tsx:1895, 1926, 1951, 1964, 1988, 2004 plus GameView.tsx:647/784; `.net-overlay-card` styles.css:3102; `.ann-overlay` (Announcements.tsx:111)
- what: `.ds-modal` is 380px, 12px radius, 20px padding and a 6px block shadow. `.overlay-panel` uses legacy `var(--panel)`, a 16px radius, no block shadow, centred text and a banned 14px gap. It is patched with `.ds-dialog-title/.ds-dialog-actions`, and its buttons are `.overlay-buttons` keycaps, not `.ds-btn`. The Chain disclaimer (p7) is a shell dialog wearing HUD chrome. `.net-overlay-card` uses legacy `--muted` and 13/14px margins.
- recommendation: One `.ds-dialog` (title, body, actions with the primary rightmost) on `--ds-*` tokens. Move the six App.tsx dialogs onto it first, and keep `.overlay-panel` for in-match overlays only.
- contract: ui-standard §6 dialog anatomy; ui.md.
- effort: M

##### 16-08 · P2 · The same chip component exists twice: HUD `.chip` and `.ds-chip`
- where: `.ds-chip` shell.css:1532 (+`.red/.blue` 5544, `.on` 5554, `.off` 5561); `.chip` styles.css:449
- what: The HUD `.chip` re-implements alliance-red/blue, on and off, adds warn, desync (infinite blink), bad (`#2b0b0b` literal) and prompt (`#1a1206` literal), and reads legacy `--text`/`--muted`. `.ds-chip.red/.blue` uses a `color:#fff` literal instead of the `-ink` tokens.
- recommendation: Make the HUD use `.ds-chip` plus the HUD-only states (`.warn`, `.desync`, `.bad`, `.prompt`) as modifiers on it, on tokens. Check that the blink is capped under reduced motion.
- contract: DESIGN.md Chips; theming categories (CLAUDE.md).
- effort: M

##### 16-09 · P2 · Badge sprawl: 11 one-off badges and no contract component, several below the type floor
- where: `.ds-hero-name .cust` shell.css:4808 (10px); `.ds-opt .oz` 4376 (10px); `.ann-badge` styles.css:3802 (10px/800); `.adm-pill` styles.css:3270; `.fr-badge` shell.css:851 (10px); `.lb-you-tag` 2753; `.sup-badge` styles.css:3435; `.award-badge` shell.css:7275; `.lb-standing-badge` 2703 (26px circle); `.mult-badge` styles.css:1208; `.you-tag` styles.css:318 (9px, rgba literal)
- what: Each badge chooses its own size, padding, radius and fill. The 9px and 10px sizes are below the 11px xs step.
- recommendation: Add `.ds-badge` (11px mono caps, 2px 8px, pill) with tone modifiers (accent/gold/warn/tint) and a count-dot variant, then migrate these.
- contract: ui-standard type scale (11 min), 4px grid.
- effort: M

##### 16-10 · P2 · Seven tab/segmented/subnav controls, including near-duplicate twins
- where: `.ds-segs/.ds-seg` 2139/2166 (borderless, 8px, 4px 10px); `.ds-dl-seg button` 3549 (bordered, round-sm); `.ds-startpos-tabs/.ds-startpos-tab` 5805/5814 (tray with literal 9px and 7px radii, uppercase); `.ds-tabs/.ds-tab` 1457/1463 (underline, 6px gap, 18px margin, 14px padding); `.ds-subnav-btn` 1419 and `.ds-rail-btn` 687 (15px `.rl`)
- what: Rail and subnav are the same mint "current section" item at two paddings, and both show side by side on Configure. The startpos tray is a third segmented control with literal radii, on top of the dropped font (16-02).
- recommendation: Keep `.ds-segs` (one-of-N values) and `.ds-tabs` (sections), and merge rail and subnav into one nav-item with a density modifier. Delete `.ds-dl-seg` and `.ds-startpos-tabs` in favour of `.ds-segs`.
- contract: ui-standard no literal radius, 4px grid; ui.md `.ds-segs.even`.
- effort: M

##### 16-11 · P2 · Four banner treatments, and the rejoin banner reused for the tutorial offer
- where: `.ds-rejoin` shell.css:1755; `.ds-verifybar` 3822; `.ds-maint` styles.css:3159; `.ds-lan-banner` styles.css:4160; ModeSelect.tsx:83 `ds-rejoin ds-tut-offer`
- what: Accent tint, warn tint, tile with warn border, and tile with line-strong, each with different padding (14px 18px, 10px 14px, and so on, all off-grid). The "New to DSIM?" tutorial card borrows the accent "you have a match to rejoin" banner, so an invitation looks like an urgent status.
- recommendation: Add `.ds-banner` with `.info/.warn/.accent` tones and one padding (12px 16px), and give the tutorial offer the info tone.
- contract: 4px grid; variants must match their meaning.
- effort: S

##### 16-12 · P2 · Cards: `.ds-panelbox` duplicates `.ds-panel`, and `.ds-dl-hero` is a gradient card
- where: `.ds-panel` shell.css:1888 (342 uses); `.ds-panelbox` 4474 (10 uses, 14px gap); `.ds-dl-hero` 5628 (`linear-gradient(160deg, tile, panel)`, 22px padding); `.ds-strat-card` 5573; `.ds-stat` 4840 (a tile that turns into a chip inside `.ds-hero` 4982)
- recommendation: Fold `.ds-panelbox` into `ds-panel` plus `ds-panel-body`. Make `.ds-dl-hero` flat, using `--ds-tile` and 24px padding. Split `.ds-stat` into a tile and a chip rather than restyling it by context.
- contract: DESIGN.md Cards (flat, `--ds-block`); 4px grid.
- effort: S

##### 16-13 · P2 · Two table components
- where: `.ds-table` shell.css:2388 (Leaderboard, LanReplays, MatchHistory, PracticeReplays, YourData, AdminAnalytics); `.adm-table` styles.css:3256 (Admin.tsx:409, AdminAudit:149, AdminLive:349); `.resx-breakdown` (Results.tsx:432/464)
- what: `.adm-table` is 13px with 9px/10px cell padding (banned) and 11px/800 caps headers. `.ds-table` is 14px with 10px 16px padding. AdminAnalytics already uses `.ds-table`, so admin has both.
- recommendation: Make `.adm-table` a `.ds-table.dense` modifier (12px, 8px 12px).
- contract: 4px grid, type scale.
- effort: S

##### 16-14 · P2 · Lift-up hovers invert the keycap language, and one hover uses a blur glow
- where: `.ds-tut-btn` tutorial.css:105; `.chassis-sw` styles.css:3398 (also a 7px literal radius); `button.bb-cell` shell.css:4737; `.pred-opt` predict.css:84; `.contrib-icon` shell.css:4338; `.ds-tile` 1773 (−1,−1); `.ann-cinema-btn` styles.css:4055 (`0 0 44px` glow)
- what: Keycaps press down and in on hover. These lift up with `translateY(-1px)`, so identical-looking surfaces respond in opposite directions. The cinema button adds a blurred glow.
- recommendation: Use the `.ds-btn` press mechanics. Remove the glow and use an edge shadow instead.
- contract: Transform-Only Press; No-Blur rule.
- effort: S

##### 16-15 · P2 · The shared focus list omits several pressables
- where: shell.css:1621-1637
- what: `.ds-home-link`, `.ds-discord-join`, `.ds-foot-link`, `.ds-startpos-tab`, `.chassis-sw`, `.game-btn`, `.fr-toggle` and `.ds-opt-del` get the UA focus ring rather than the brand ring. It is visible but inconsistent. Every new class has to remember to join the list, which is how these fell out.
- recommendation: This goes away with 16-03, because composing `.ds-btn` inherits the focus rule. Until then, add them to the list.
- contract: ui-standard (every interactive element has :focus-visible).
- effort: S

##### 16-16 · P2 · `.ds-btn.danger` is an undocumented variant defined in the admin section of the legacy stylesheet
- where: styles.css:3560; used in Account.tsx:357 (account deletion), AdminReports.tsx:432, AdminUser.tsx:383/410/419/606, Admin.tsx:604/713 ("ghost small danger")
- what: A user-facing destructive button is styled from the admin block of styles.css, and neither DESIGN.md nor the generated class index knows about it.
- recommendation: Move it next to `.ds-btn` in shell.css and document it in DESIGN.md as the fifth variant.
- contract: DESIGN.md Buttons.
- effort: S

##### 16-17 · P3 · `.ds-input` focus ring contradicts the contract
- where: shell.css:3714-3724
- what: The focus state is an outer 2px accent outline. DESIGN.md specifies a recessed input with `inset 0 0 0 1px accent`. `.ds-select` (2135) and `.ds-listbox-btn` (2241) are 32px/13px while `.ds-input` is 14px, so a form row mixes two type sizes.
- recommendation: Choose one ring, either updating the doc to the (more visible) outline or changing the CSS, and align the select and listbox to the input's type size.
- contract: DESIGN.md Inputs.
- effort: S

##### 16-18 · P3 · No error list state, off-grid empty/loading padding, and the leaderboard error exposes an env var
- where: `.ds-empty` shell.css:2808 (30px 20px, `.big` 16px); `.ds-loading` 2819; Leaderboard.tsx:411-413
- what: ui-standard §6 requires four list states. The error state reuses `.ds-empty`, and its copy tells players to "set VITE_GAME_SERVER_URL" (seen on p4).
- recommendation: Add `.ds-empty.error`, use 32px 24px padding and a 15px `.big`, and replace the copy with player-facing text.
- contract: ui-standard §6 list states; 4px grid, type scale.
- effort: S

##### 16-19 · P3 · `.ds-username-input` border is inconsistent with other inputs
- where: shell.css:3739 (border `--ds-line`), with the inner outline removed at 3769
- what: Every other input uses `--ds-line-strong` for 1.4.11 non-text contrast. This one drops to `--ds-line`.
- recommendation: Use `--ds-line-strong`, and put the focus ring on the wrapper with `:focus-within`.
- contract: WCAG 1.4.11; DESIGN.md Inputs.
- effort: S

##### 16-20 · P3 · docs/ui-components.md is stale and cannot see modifiers
- where: docs/ui-components.md
- what: The line numbers are wrong (`.ds-btn` is listed at 627 but is actually at 1562; `.ds-panel` 1870 vs 1888; `.ds-input` 1701 vs 3714). Because it indexes classes only, `.primary/.ghost/.danger/.on` are invisible, and those are exactly where the variant drift in this report lives.
- recommendation: Regenerate it in docaudit and index compound selectors (`.ds-btn.danger`) too.
- contract: docs/area/ui.md.
- effort: S

##### 16-21 · P3 · `.ds-opt.real` uses an inset accent left edge
- where: shell.css:4162
- what: A 3px inset accent stripe down the left side is the side-border tell, a fourth selection-like signal alongside the ones in 16-06.
- recommendation: Use a `.ds-badge` ("REAL") or the mint tint instead.
- contract: DESIGN.md Cards.
- effort: S

##### 16-22 · P3 · Small off-token values in the dialog and option chrome
- where: `.ds-modal` shell.css:3683 (`6px 6px 0` block); `.ds-modal-backdrop` 3674 (rgba literal); `.ds-opt-del` 4178 (6px literal radius, 22px size); `.ds-panelbox` gap 14
- recommendation: Use `--ds-block`, a scrim token, `--ds-round-sm` and a 24px size.
- contract: ui-standard (no literal radius, tokens only).
- effort: S

##### 16-23 · P3 · The lobby still uses the legacy page shell
- where: Lobby (p6): `.ds-back` shell.css:3919 plus the two-colour `.ds-title` "Multiplayer"
- what: Other pages use the rail/subnav shell. The lobby keeps a back button and a display title of its own.
- recommendation: Move it onto the standard page header when 16-03 deletes `.ds-back`.
- contract: ui-standard page anatomy.
- effort: S

#### Strengths (keep)
- A single shared `:focus-visible` list (shell.css:1621) rather than per-component rings. Extend it instead of replacing it.
- The OptRow/ToggleRow rule in ui.md already gives one spelling of a pick. 16-06 just applies it to segs and tabs.
- The `.ds-chip.off` full-alpha reasoning and the alliance `-ink` tokens on `.ds-opt.red/.blue` are correct theme-category work.
- `.ds-seg` holds font weight constant across on/off, so selecting a segment causes no layout shift.
- Presses are transform/box-shadow only across the keycap family, and shiftaudit enforces it.
- Shared `.ds-empty`/`.ds-loading` exist and are widely reused, so adding an error state is a one-class change.
- `.ds-dialog-title/.ds-dialog-actions` form a workable bridge for migrating the overlay-panel dialogs.
- The HUD's `--ds-hud-line` edge discipline on floating cards.

### Lens 17 · Accessibility (cross-cutting). What I looked at: focus rules in shell.css, styles.css, tutorial.css and predict.css; every `role="dialog"` and `.overlay` surface (App.tsx, GameView.tsx, AuthPanel, Announcements, Results, RewardDialog); useEscape.ts, Select.tsx and the PadNavLayer trap; live regions (PerfHud, QueueBar, the event log, the countdown, friend toasts); the auth forms; every `@keyframes` user and each reduced-motion block; the colour-only HUD glyphs; the chassis map (Builder.tsx); heading levels; the audit's touch-target warnings.

##### 17-01 · P0 · Six shell dialogs and the in-match overlays have no dialog semantics, no focus move, no trap and no Escape
- where: src/ui/App.tsx:1895, 1926, 1951, 1964, 1988, 2004; src/ui/GameView.tsx:647, 677, 784
- what: Each one is a bare `<div className="overlay"><div className="overlay-panel">`. None has `role="dialog"`, `aria-modal` or `aria-labelledby`, even though every one already has a `.ds-dialog-title` heading it could point at. Opening one does not move focus into it, so focus stays on the page behind the scrim, and Tab walks the obscured page. None of the App.tsx six closes on Escape. "You're already in a game" (Rejoin/Abandon) and "Update required" are blocking decisions that a screen reader user is never told have appeared.
- evidence: `rg 'role="dialog"'` finds these only in AuthPanel, ChallengePicker, RewardDialog, Announcements and Results. None of the six App.tsx overlays is among them. PadNavLayer.tsx:56 traps GAMEPAD focus in `.overlay` (`TRAP = '.ds-osk, .ds-modal-backdrop, .overlay, …'`), so a pad player is contained but a keyboard player is not.
- recommendation: Build one `<Dialog titleId onClose>` wrapper, or use native `<dialog>` with `showModal()`, which gives the top layer, inert background, Escape and focus restore for free. Route all nine surfaces through it.
- contract: WCAG 4.1.2 Name, Role, Value (A), 2.4.3 Focus Order (A), 1.3.1 (A); ui-standard §6 "Dialog".
- effort: M

##### 17-02 · P0 · PerfHud and QueueBar are `role="status"` regions whose text changes every 250 ms and every 1 s
- where: src/ui/PerfHud.tsx:117; src/ui/QueueBar.tsx:66 (tick at :34)
- what: `role="status"` carries an IMPLICIT `aria-live="polite"` plus `aria-atomic="true"`. The PerfHud comment says the opposite ("`role="status"` and not `aria-live`: … never one that should announce itself — the numbers change four times a second"). That is a misreading of ARIA: the region re-announces the whole fps/ping block about four times a second for the entire match. QueueBar re-renders `elapsedLabel(q.since)` every second inside its status region, and it contains two buttons, so a queued screen reader user hears "RANKED queue · 0:14 · View Cancel" every second.
- evidence: `setInterval(() => tick(n => n + 1), 1000)` at QueueBar.tsx:34. The PerfHud comment is at :115-116.
- recommendation: PerfHud: drop the role and use `role="group" aria-label="Performance"`, which is readable on demand and silent. QueueBar: wrap only the found/not-found phrase in a `role="status"` span and leave the elapsed clock outside it (or `aria-hidden`).
- contract: WCAG 4.1.3 Status Messages (AA), 2.2.2 (A) (auto-updating content that cannot be paused).
- effort: S

##### 17-03 · P0 · The sign-in and sign-up forms have no `autocomplete` on email, password or username, and the modal does not take focus
- where: src/ui/AuthPanel.tsx:220, 224, 233, 237; src/ui/UsernameField.tsx:107
- what: The primary Email and Password inputs carry no `autoComplete`, so password managers cannot reliably offer `current-password` for sign-in or generate a `new-password` on sign-up. Only the forgot-password email (:198) and AccountReset.tsx have it. The display-name and username fields also lack `autoComplete="nickname"` / `"username"`. The sign-in form has no `autoFocus` (only the forgot branch at :197 does), so opening this `aria-modal` dialog leaves focus on the button behind the backdrop.
- evidence: `rg autoComplete src/ui` → AccountReset.tsx ×3, AuthPanel.tsx ×2 (both in the forgot/reset branch).
- recommendation: `autoComplete={mode === 'up' ? 'new-password' : 'current-password'}`, `autoComplete="email"`, `autoComplete="username"` on UsernameInput, and `autoComplete="nickname"` on display name. Put `autoFocus` on the first field of each mode, or focus the dialog heading.
- contract: WCAG 1.3.5 Identify Input Purpose (AA), 2.4.3 (A).
- effort: S

##### 17-04 · P1 · Form errors are never announced or linked to their field
- where: src/ui/AuthPanel.tsx:203, 269, 225; the pattern is app-wide (`.ds-form-err` / `.ds-form-hint` in 10 files)
- what: `{error && <div className="ds-form-err">{error}</div>}` appears after submit with no `role="alert"` and no live region, so a failed sign-in is silent to a screen reader. The username availability hint (:225) sits inside the `<label>` but is not connected with `aria-describedby`, and the input gets no `aria-invalid`. `aria-describedby` has zero uses in src/ui.
- evidence: `rg aria-describedby src/ui` → 0 hits. `aria-invalid` appears once, on the terms checkbox (:258).
- recommendation: Give `.ds-form-err` `role="alert"`. Give the hint an id, point the input's `aria-describedby` at it, and set `aria-invalid` when status is taken or invalid. Fixing it in AuthPanel and UsernameGate covers the auth path.
- contract: WCAG 3.3.1 Error Identification (A), 4.1.3 (AA), 1.3.1 (A).
- effort: S

##### 17-05 · P1 · The global reduced-motion cap zeroes the duration but not the iteration count, so `.chip.desync` flickers at frame rate
- where: src/ui/shell.css:5657-5661 (the `*` block); src/ui/styles.css:504 (`.chip.desync { animation: blink 1s steps(2) infinite }`); the cap list at styles.css:1356-1362
- what: The `*` rule sets `animation-duration: 0.001ms !important` with no `animation-iteration-count`. That is exactly the omission CLAUDE.md and ui-standard §7 name. styles.css patches the count for four selectors (`.timer-panel.urgent .timer-time`, `.net-spinner`, `.rec-dot`, `.ds-key.capturing`) but misses `.chip.desync`. A `steps(2)` infinite animation at 0.001 ms is sampled at a random phase every frame, so the DESYNC chip shows as an irregular 1.0/0.55 opacity strobe, the opposite of what the user opted into. Any future infinite animation falls into the same trap.
- evidence: `.chip.desync` is absent from styles.css:1356-1362. The `*` block has no iteration-count line.
- recommendation: Add `animation-iteration-count: 1 !important;` to the `*` rule at shell.css:5658. The four per-selector patches then become redundant.
- contract: CLAUDE.md Gotchas ("must cap animation-iteration-count, not just duration"); ui-standard §7; WCAG 2.3.3 (AAA) / 2.2.2 (A).
- effort: S

##### 17-06 · P1 · The DECODE motif is conveyed only by coloured dots, with no text alternative
- where: src/ui/GameView.tsx:791, 982, 999; styles.css:528-545
- what: The motif (the scoring pattern the whole DECODE match depends on) renders as empty `<span class="motif-dot purple|green">` elements, 10 px circles told apart by hue alone. They have no text, no `aria-label` and no shape difference. A screen reader reads "MOTIF" and nothing after it. A colour-blind driver has only purple-vs-green luminance to go on, at 10 px, on the HUD.
- evidence: `<span key={i} className={`motif-dot ${c}`} />` with no children or label, in three places.
- recommendation: Give the wrapper `aria-label={`Motif: ${motif.join(', ')}`}` and `aria-hidden` on the dots. Add a letter (P/G) inside each dot, or a shape distinction (for example, green as a rounded square).
- contract: WCAG 1.4.1 Use of Color (A), 1.1.1 Non-text Content (A).
- effort: S

##### 17-07 · P1 · Escape in an open Select also fires the screen's `useEscape` exit (Lobby)
- where: src/ui/Select.tsx:79-82; src/ui/useEscape.ts:15-16; src/ui/Lobby.tsx:127 (renders FriendsPanel → StatusPicker `<Select>`, FriendsPanel.tsx:710) with Lobby.tsx:290 `useEscape(onCancel)`
- what: Select handles Escape in a React `onKeyDown` with `preventDefault()` only. useEscape listens on `window`, ignores `defaultPrevented`, and runs `fn()`. Pressing Escape to close the Status dropdown in a lobby therefore also leaves the lobby. It is the same class of bug the `enabled` flag was added to prevent for MatchStrategy.
- evidence: useEscape.ts:16 `if (e.key === 'Escape') fn();`, with no `defaultPrevented` check.
- recommendation: Make useEscape skip events that are `e.defaultPrevented`, a one-line fix in the shared hook that every caller benefits from. Select already calls `preventDefault`.
- contract: WCAG 3.2.2 On Input (A) (unexpected context change); useEscape.ts's own docstring ("can't reach past it").
- effort: S

##### 17-08 · P1 · The dialogs that do have `role="dialog"` still have no focus trap and no focus restore
- where: src/ui/AuthPanel.tsx:171, ChallengePicker.tsx:92, RewardDialog.tsx:143, Announcements.tsx:78/112, Results.tsx:902/1253
- what: There is no Tab containment anywhere. `rg "'Tab'" src/ui` finds only Select. Nothing records `document.activeElement` on open to restore on close. `aria-modal="true"` does not stop Tab from leaving, so Tab from AuthPanel's last button walks into the page behind the scrim. On close, focus drops to `<body>` and the keyboard user starts again at the top of the document. Announcements' two dialogs and the Results stages also lack `aria-modal`.
- evidence: See the grep. RewardDialog.tsx:131 focuses the equip button on open (good) but never restores.
- recommendation: Fold this into the 17-01 wrapper (native `<dialog>.showModal()` handles trap and restore). Add `aria-modal` to Announcements.
- contract: WCAG 2.4.3 Focus Order (A), 2.1.2 (A) spirit.
- effort: M

##### 17-09 · P1 · The friend/invite toasts auto-expire after 9 s with no pause, and live in a non-live region
- where: src/ui/friendsContext.tsx:66, 284-290, 333
- what: A toast carrying a Join/Accept action is removed after `TOAST_MS = 9000`, and the timer does not pause on hover or focus. If a keyboard user has tabbed into the toast when it expires, focus is destroyed and lands on `<body>`. The container is `role="region"`, not a live region, and it returns `null` when empty, so even adding `aria-live` there would miss the first toast (a live region must exist before content is injected).
- evidence: `setTimeout(() => setToasts(cur => cur.slice(1)), TOAST_MS)` with no hover or focus guard. `if (toasts.length === 0) return null`.
- recommendation: Keep an always-mounted `<div aria-live="polite">` for toasts. Pause the expiry timer while the toast has `:hover` or `:focus-within`.
- contract: WCAG 2.2.1 Timing Adjustable (A), 4.1.3 (AA).
- effort: S

##### 17-10 · P1 · Switching the event log off removes the only non-visual match channel, and the canvas label still points at it
- where: src/ui/GameView.tsx:640, 1208-1209
- what: The canvas `aria-label` says "Match state is announced in the event log", and the comment at :1205 says the log is "the only non-visual channel for scoring/gate/penalty state". The whole `aria-live` region is still gated on `showEventLog`, a visual-clutter preference. A driver who hides it for field space silently loses every announcement, and the label keeps promising them. The pre-match countdown (:826-832) is not in any live region either, so "3, 2, 1" is never announced.
- evidence: `{showEventLog && (<div className="eventlog" aria-live="polite">`.
- recommendation: When the log is hidden, keep the region mounted and visually hidden (`.sr-only`) rather than unmounting it. Push countdown ticks into the same region.
- contract: WCAG 4.1.3 (AA), 1.3.1 (A).
- effort: S

##### 17-11 · P2 · The home game switcher and the Admin tabs are half-built ARIA tablists
- where: src/ui/HomeMenu.tsx:101-111; src/ui/Admin.tsx:81-91
- what: They use `role="tablist"`/`role="tab"` with `aria-selected`, but there is no `aria-controls`, no `role="tabpanel"`, no roving tabindex and no arrow-key handling. docs/area/ui.md itself rules "a radiogroup owes roving tabindex and arrow keys, and half that pattern is worse than none", and Records.tsx:50 already removed a tablist for this reason. The HomeMenu switch changes the season (a navigation), so it is not a tab.
- evidence: No `onKeyDown` in either block, and `tabpanel` has no hits in src.
- recommendation: HomeMenu: plain buttons with `aria-pressed` (the OptRow spelling) or `aria-current`. Admin: finish the pattern (arrow keys, `tabIndex` roving, panel ids) or drop the roles.
- contract: WAI-ARIA APG Tabs; docs/area/ui.md Configure rule 1.
- effort: S

##### 17-12 · P2 · The chassis-map disabled cells hide their reason, and which cells are occupied is visual-only
- where: src/games/biobuzz/Builder.tsx:226, 244-245
- what: A blocked cell is `disabled` with `title={why}`. A disabled button is not focusable and `title` is not exposed on touch, so a keyboard or phone user never learns why a slot is refused. `BbMountGlyph` is `aria-hidden`, so a screen reader hears only the position label, with no word for what is mounted there.
- evidence: `disabled={why !== undefined} title={why}`, and the glyph at :139 is `aria-hidden="true"`.
- recommendation: Use `aria-disabled="true"` (keeps focus) plus a visually-hidden reason, or `aria-describedby`. Add the mark's name to the accessible label (`aria-label={`${label}${mark ? `, ${markName}` : ''}`}`).
- contract: WCAG 1.3.1 (A), 4.1.2 (A).
- effort: S

##### 17-13 · P2 · Select's `aria-label` replaces the current value in the trigger's accessible name
- where: src/ui/Select.tsx:96
- what: An `aria-label` on the trigger button overrides its content, so a screen reader announces "Status, collapsed" and never the selected value ("Away"). The visible value is lost to the accessible name.
- evidence: `aria-label={ariaLabel}` sits on a button whose only content is `{current.label}`.
- recommendation: `aria-label={ariaLabel ? `${ariaLabel}: ${current?.label}` : undefined}`, or point `aria-labelledby` at a caption id plus the value span.
- contract: WCAG 4.1.2 (A), 2.5.3 Label in Name (A).
- effort: S

##### 17-14 · P2 · The alliance score panels are told apart by colour and position only
- where: src/ui/GameView.tsx:~960-990 (`score-panel red|blue`, `panel-score`)
- what: Red and blue scores are bare numbers in filled red/blue panels. Only the local side gets a "YOU" tag. Nothing tells a screen reader, or a monochrome view, which number is red and which is blue.
- evidence: `<span className="panel-score">{blueScore}</span>`, with no alliance text or label.
- recommendation: Add `aria-label="Red alliance score"` / `"Blue …"` to each panel. Optionally add a small "RED"/"BLUE" caption, which DESIGN.md's alliance chip pattern already uses.
- contract: WCAG 1.4.1 (A), 1.3.1 (A).
- effort: S

##### 17-15 · P2 · The heading outline skips levels on Configure, Controls, the BIOBUZZ builder and all Markdown pages
- where: src/ui/markdown.tsx:136-137 (`#` → h3, `##` → h4); Configure.tsx:91 (h1) → ControlsSection.tsx:516/528 (h3)
- what: The live audit reports [1,3,3…] on three configure routes and [1,4,4…] on /terms. The Markdown renderer hard-codes a two-level demotion, so every legal page and every announcement body skips. It also puts `<h3>` beside the Announcements `<h2 class="ann-item-title">` at the wrong depth.
- evidence: audit-light/report.txt "headings: 1 h1, 1 skipped level(s)" on four routes.
- recommendation: Give `Markdown` a `baseLevel` prop (Legal = 2, announcements = 3). Make configure panel titles h2.
- contract: WCAG 1.3.1 (A) (best practice), 2.4.6 (AA).
- effort: S

##### 17-16 · P2 · Range inputs are 8 px tall hit boxes
- where: src/ui/shell.css:4527-4560 (`input[type='range'].ds-range`, track `height: 8px`)
- what: The audit measures the input box at 282×8 on every configure page. The 18 px thumb draws outside it, but the input's own box, which is where a tap on the track registers, is 8 px. On a phone a slider row is hard to grab without moving the adjacent one.
- evidence: audit-light MOBILE: `input.ds-range 282x8` ×7 on /decode/configure/robot and ×8 on /biobuzz/configure/robot.
- recommendation: `input[type='range'].ds-range { min-height: 24px; }` (44 px under `(pointer: coarse)`). The track stays 8 px, so the look is unchanged.
- contract: WCAG 2.5.8 Target Size (Minimum) (AA).
- effort: S

##### 17-17 · P2 · The sponsor mark is a 14 px-tall standalone link on nearly every page
- where: src/ui/shell.css:6544 (`.sponsor-mark`), rendered by src/ui/Sponsor.tsx
- what: The mark is a 155×14 target on a phone (audit: 10 of 12 routes). It is a standalone link, not inline in a sentence, so the inline exception does not apply. It likely scrapes by on 2.5.8's spacing exception only because nothing else sits within 24 px.
- evidence: audit-light MOBILE `a.sponsor-mark 155x14`.
- recommendation: `padding-block: var(--ds-s-1)` plus `min-height: 24px`, which is layout-stable because it applies in every state.
- contract: WCAG 2.5.8 (AA).
- effort: S

##### 17-18 · P2 · Infinite decorative motion with no pause for users who have not set reduced motion
- where: src/ui/styles.css:2136 (`resx-marquee 14s linear infinite` on long results names); :4037 (`ann-cin-sweep … infinite`); :3984 (`ann-cin-glow … infinite alternate`)
- what: A name marquee that scrolls indefinitely on the results screen is moving content that lasts more than 5 s beside other content, with no pause control. It is handled for reduced-motion users (styles.css:2513-2520) but not for everyone else.
- evidence: See the lines above.
- recommendation: Pause the marquee on hover and focus, or run it a limited number of times (for example, 2) and then settle on the ellipsis.
- contract: WCAG 2.2.2 Pause, Stop, Hide (A).
- effort: S

##### 17-19 · P2 · The connection-quality dot in the PerfHud is colour-only
- where: src/ui/PerfHud.tsx:121-124
- what: `perf-ping ${qualityClass}` with a `.perf-dot` encodes good/fair/poor in hue alone. The ms number is there, but the quality verdict is not in text.
- evidence: `<span className="perf-dot" />`, with no label.
- recommendation: Add a visually-hidden quality word, or a `title`/`aria-label` on the ping span.
- contract: WCAG 1.4.1 (A).
- effort: S

##### 17-20 · P3 · The docs claim "the app suppresses the UA ring app-wide", but nothing does
- where: docs/ui-standard.md §1.3; src/ui/styles.css:1598-1599
- what: `rg "outline:\s*(none|0)" src` finds exactly one hit, the username inner input (shell.css:3769), and that one is correctly replaced by `.ds-username-input:focus-within` (:3748). The UA ring is therefore NOT suppressed. Unstyled controls fall back to Chromium's default ring, which is fine for accessibility, but the rule's rationale is false and could lead someone to add a global `outline: none` "to match the docs".
- evidence: See the grep.
- recommendation: Correct the sentence: ":focus-visible is required for brand consistency; the UA ring is the fallback, never remove it".
- contract: ui-standard §1.3.
- effort: S

##### 17-21 · P3 · Sliders announce bare numbers without units
- where: src/games/biobuzz/Builder.tsx:515-612; AudioSection.tsx:38; ControlsSection.tsx:144
- what: The label includes the value text, but the input announces `valuenow` as a raw number (for example "18"), not "18 inches" or "70 percent". There is no `aria-valuetext`.
- evidence: No `aria-valuetext` in src.
- recommendation: `aria-valuetext={`${dialText(v)} inches`}` and similar.
- contract: WCAG 1.3.1 (A) (best practice).
- effort: S

##### 17-22 · P3 · The HUD button glyphs are read aloud
- where: src/ui/GameView.tsx:725, 735, 752, 759, 768 (`◄ MENU`, `⟲ RESET`, …); :1197 `⚠ DESYNC`, :1200 `🌐 {server}`
- what: A screen reader speaks "black left-pointing pointer MENU", "anticlockwise gapped circle arrow RESET", and so on. The rest of the app already wraps glyphs in `aria-hidden` (Announcements.tsx:82, AdminAnalytics.tsx:298).
- evidence: The glyphs are plain text inside the button labels.
- recommendation: Change each to `<span aria-hidden="true">◄</span> MENU`.
- contract: WCAG 1.1.1 (A) (best practice).
- effort: S

#### Strengths (keep)
- **Gamepad menu navigation is a real accessibility layer.** It drives NATIVE focus and activation (PadNavLayer.tsx), traps inside overlays (:56), rings plain `:focus` when a pad is active (shell.css:7129) because `:focus-visible` is unreliable from a gamepad, gives a text field an on-screen keyboard, and swaps confirm/back for Nintendo pads.
- **Consistent 2 px `:focus-visible` rings** across ~30 control families, and a category-3 `--ds-on-field` ring on the dark results/HUD scrim (styles.css:1687). The one `outline: none` is correctly replaced by `:focus-within`.
- **OptRow uses `aria-pressed` toggles** and explicitly refuses a half-built radiogroup. Records swapped a fake tablist for `nav` + `aria-current`. That is the right instinct; extend it to 17-11.
- **AuthPanel, ChallengePicker and RewardDialog** have `role="dialog"`, `aria-modal`, and `aria-labelledby` pointing at a visible title. The dialog sits on the panel, not the backdrop (AuthPanel.tsx:169 comment).
- **The event log is `aria-live="polite"`** and the canvas has a descriptive `aria-label`. `timer-phase`, TutorialCard's step counter, and the banners use `role="status"` correctly.
- **The Results sequence honours reduced motion in JS** (skips to `done`) and in CSS (one cross-fade, the marquee off). The ann-cinema block caps iteration count. Contrast is 269/269 AA in both themes, and `--ds-red-ink` was chosen specifically so the urgent timer clears 3:1.
- **Range tracks carry a `--ds-line-strong` border** citing 1.4.11. Every slider is wrapped in a real `<label>`.

### 18 · Mobile and responsive (cross-cutting): the 375px screenshots (light and dark, p0–p11) against their desktop counterparts, every @media query in src/**/*.css, index.html viewport, useCoarsePointer.ts, MobileControls.tsx, mobileActions.ts, the table scrollers, and the modal scaffold

##### 18-01 · P0 · Pinch-zoom is disabled app-wide, legal and leaderboard pages included
- where: index.html:5-8 (`maximum-scale=1.0, user-scalable=no`)
- what: The viewport meta blocks zoom on every route, not just in-match. That includes /terms (long 13–15px prose, p11), the leaderboard, and the 10–11px mono labels on the builder stat tiles (p2/p9: "IN/S TOP", "RAD/S² ANG. ACCEL").
- evidence: iOS Safari ignores this since iOS 10, but Android Chrome honours it unless the user has turned on "force enable zoom". This fails WCAG 1.4.4 (Resize Text) for exactly the pages that have the smallest type.
- recommendation: Ship `width=device-width, initial-scale=1, viewport-fit=cover`. The canvas already sets `touch-action: none` (`.mobile-touch`, `.mobile-overlay`, styles.css:2720-2737), which is what actually stops pinch-zoom during a match. If a gesture still leaks through, add `user-scalable=no` from GameView on mount and remove it on unmount.
- contract: WCAG 1.4.4; the ui-standard accessibility floor.
- effort: S

##### 18-02 · P1 · Touch sizing is keyed to viewport WIDTH, not to the pointer, so tablets and landscape phones get mouse-sized targets
- where: src/ui/shell.css:5156 onward (`@media (max-width: 640px)` "TOUCH TARGETS" block: `.ds-seg` min-height 34, `.ds-foot-link`, `.chassis-sw`, slider puck 26px at 5216-5225)
- what: An iPad (768–1024px wide) or a landscape phone (667–932px) with a coarse pointer never enters this block. It gets the ~25px `.ds-seg`, the 18px slider puck and the 17px footer links. A 600px desktop window with a mouse does get the enlarged sizes.
- evidence: The comment itself says "POINTER-SIZE only". tutorial.css:178 already uses the correct form, `@media (pointer: coarse), (max-width: 620px)`, and the HUD uses `(pointer: coarse), (max-height: 520px)` at styles.css:2892. The shell is the one place that does not.
- recommendation: Change the touch-target block to `@media (pointer: coarse), (max-width: 640px)`. It holds sizes only, so desktop mouse layouts stay byte-identical, and shiftaudit keeps guarding.
- contract: docs/ui-standard.md §1 (states and targets); WCAG 2.5.8.
- effort: S

##### 18-03 · P1 · Range inputs are an 8px-tall element box
- where: src/ui/shell.css:4527-4541. `input[type='range'].ds-range` is grouped with the `::-webkit-slider-runnable-track` selector, so the INPUT itself gets `height: 8px`. Screenshots p2/p3/p9.
- what: The audit measured every builder and controls slider at 282x8 (7 on /decode/configure/robot, 8 on /biobuzz/configure/robot). The phone block enlarges only the puck (26px). Tapping the track to jump a value, the usual thumb gesture, has an 8px band to hit.
- evidence: audit-light/report.txt MOBILE: `input.ds-range 282x8` ×5+ per configure page.
- recommendation: Split the selector. The input gets `height: 28px; background: transparent`, and only the pseudo-element track stays 8px. Firefox already draws its track separately (`::-moz-range-track`). The same fix covers `.ds-replay-seek`.
- contract: WCAG 2.5.8 (24px minimum); the audit's mobile target rule.
- effort: S

##### 18-04 · P1 · Up to 355px of chrome before content on every inner page at 375px
- where: p1/p2/p3/p4/p9/p10 mobile; shell.css:5030-5118 (the rail becomes a row, `.ds-friends` becomes a strip)
- what: The app bar (62px), the rail strip (~72px including its scrollbar), and the Friends strip (~52px, holding one small chip) stack to ~188px before the h1. On Configure, the h1 and subnav strip add ~120px more, so the first control sits at ~355px, about 44% of an 812px screen. Desktop spends 0px vertically on nav, because the rail and Friends are side columns.
- evidence: p2-mobile: the robot preview starts at y≈380. p1-mobile: "Pick a mode" at y≈235 with only one card visible above the fold.
- recommendation: Move the Friends chip into the app bar as an icon button beside Profile (the bar has ~120px free at 375), which removes a whole row. Consider folding "← Home" into the DSIM mark, since the mark already routes home. Target 120px of chrome or less.
- contract: DESIGN.md "the field gets the room" principle; ui.md's own note about the pinned strip that "held the top 74px of every page".
- effort: M

##### 18-05 · P1 · The builder's robot card does not collapse on a phone; it just stacks
- where: shell.css:4869-4876 (`max-width: 1099px` one-column `.ds-hero`) and 4892+ (the compact chip strip only at ≥1100px); p2/p9 mobile against p2-desktop
- what: At ≥1100px the hero is a measured 105px strip with one-line stat chips. Under 1100px it falls back to the old card: a ~200px sprite box and eight two-line tiles in a 2-column grid (four rows, ~250px). At 375px the card fills the first screen and a half. Presets and Build, the actual controls, start below y≈900.
- evidence: p2-mobile shows sprite plus 6 of 8 tiles and still no controls. p9 (BIOBUZZ) is the same plus the 2D/3D toggle.
- recommendation: Reuse the ≥1100px chip treatment at phone width: a 72px sprite beside wrapped one-line chips, not pinned. The comment at 4880-4890 rules it out between 900 and 1100 because both rails are present there. Under 900 both rails are gone, so the strip shape fits again.
- contract: The 2026-09-22 owner ruling (robot at the TOP, height budgeted), whose budget is only enforced at one width.
- effort: M

##### 18-06 · P1 · Generic `.ds-modal` has no max-height or scroll, so tall dialogs clip on phones
- where: src/ui/shell.css:3673-3693 (`.ds-modal-backdrop` is fixed, `place-items: center`, no overflow; `.ds-modal` has no max-height). Used by AuthPanel.tsx:168, TermsGate.tsx:125, ChallengePicker.tsx:91, UsernameGate.
- what: A centred fixed dialog taller than the viewport overflows top and bottom, and the backdrop cannot scroll, so the header or the submit button becomes unreachable. That happens with AuthPanel sign-up when the soft keyboard takes ~45% of the height. Only `.rw-card` caps itself (7575: `max-height: calc(100dvh - 40px)`).
- evidence: Code only; dialogs were not captured. `.ds-chal` (4390) sets max-width only.
- recommendation: Put `max-height: calc(100dvh - 40px); overflow-y: auto; overscroll-behavior: contain` on `.ds-modal` itself (the rw-card rule becomes redundant). Optionally add `align-items: start` on the backdrop under 520px of height.
- contract: ui-standard "no clipped content"; WCAG 1.4.10 Reflow.
- effort: S

##### 18-07 · P1 · Console screens (Lobby, Ranked queue, Record Run) break the page gutter and drop the app shell on phones
- where: p6-mobile against p6-desktop; shell.css:3861-3872 (`.ds-console` `overflow-y: scroll`), 3897 (`.ds-console-in { width: min(900px, 94vw) }`)
- what: At 375px the lobby card sits 4px from the left edge and ~20px from the right. `94vw` includes the always-on scrollbar, so the column is off-centre, and even without a scrollbar the gutter is ~11px against the 22px every `.ds-main` page uses. The Friends strip renders ABOVE "← Back". There is no app bar, so the only way out is Back.
- evidence: p6-mobile: the card's left border at x≈4; "Multiplayer" h1 flush at x≈4. Every other mobile screenshot has a 22px gutter.
- recommendation: Change `.ds-console-in` to `width: min(900px, 100% - 2 * var(--ds-s-5))` (percent of the container, scrollbar-aware), and include `env(safe-area-inset-*)`. On narrow screens put Back above the Friends strip (`order`), or move Friends into a header as in 18-04.
- contract: DESIGN.md spacing rhythm (22px section gutter); cross-page consistency.
- effort: S

##### 18-08 · P1 · The joystick label and handle render at half opacity; ghosted buttons drop to 0.45
- where: styles.css:2739-2771 (`.mobile-joystick-base { opacity: 0.5 }` with the `.mobile-joystick-label` INSIDE it, MobileControls.tsx:332); 2838-2841 (`.mobile-btn.auto { opacity: 0.45 }`); 2844-2848 (`.fixed` 0.55)
- what: The 10px/800 "DRIVE"/"TURN" label is `--ds-on-field-dim` inheriting the base's 0.5 opacity. Composited on the dark field, that lands around 3:1 for 10px type. The ghosted SHOOT/INTAKE (auto-assist) labels are fainter still, and they are still live controls ("a manual press still reaches the sim").
- evidence: Arithmetic from the tokens (#b9beb8 at 50% over the field ≈ #6c7172). `npm run contrast` checks token pairs, not opacity stacks, so it cannot see this.
- recommendation: Keep the resting dimming on the base's background and border (rgba), not on `opacity`, so the label stays full strength. For `.auto`, dim the fill and border, keep the label ≥4.5:1, and signal "automatic" with a dashed ring or a small "AUTO" pip.
- contract: WCAG 1.4.3 for text and 1.4.11 for the control boundary; ui.md "an ASSISTED action is ghosted, never hidden" (ghosted must still be legible).
- effort: S

##### 18-09 · P1 · The footer sponsor mark is a 14px-tall target, next to footer links that were padded to 33px
- where: shell.css:6544-6570 (`.sponsor-mark`), absent from the 640px touch block (5176-5230), which pads `.ds-foot-link` to 33px; every mobile page except the lobby
- what: The one footer link left unpadded is the paid sponsor link, 155x14. It sits beside links the same block grew for thumbs.
- evidence: audit-light MOBILE: `a.sponsor-mark 155x14` on 10 of 12 pages.
- recommendation: Add `.sponsor-mark { padding-block: 8px }` inside the touch block (padding only, so no reflow; shiftaudit stays green).
- contract: WCAG 2.5.8; consistency with the block's own rule.
- effort: S

##### 18-10 · P2 · Eleven width breakpoints and four height breakpoints, with no documented set
- where: every @media in src/**/*.css plus src/ui/FriendsPanel.tsx:65
- what: Widths: 460, 480, 560, 620, 640, 720/721, 860, 900 (plus a JS 901–1100 squeeze), 1099/1100, 1280. Heights: 460, 520, 640, 721. Pointer: coarse (tutorial, HUD) and fine (ads). Near-duplicates: 460/480, 560/620/640, 860/900. DESIGN.md:137 says layouts wrap "rather than named breakpoints", but 30 queries exist, and nothing in ui-standard names them.
- evidence: `rg "@media" src --glob "*.css"` lists 23 width/height queries across shell.css, styles.css and tutorial.css.
- recommendation: Name four in docs/ui-standard.md: 480 (small phone), 640 (phone), 900 (rails collapse), 1100 (both rails plus strip). Fold 460→480, 560/620→640, 720/860→900, and have uiaudit ratchet the count of distinct widths the way it ratchets font sizes. Custom properties cannot go in media queries, so a doc table plus an audit rule is the contract.
- contract: docs/ui-standard.md (has no breakpoint section); DESIGN.md:137 is inaccurate.
- effort: M

##### 18-11 · P2 · Hover styles are not gated on `(hover: hover)`, so keycaps stay "sunk" after a tap
- where: 67 `:hover` rules in shell.css and none behind `@media (hover: hover)` (rg found zero)
- what: The keycap hover (`translateY(1px)` plus a reduced shadow, per DESIGN.md:164) sticks on touch browsers after a tap until the user taps elsewhere. A just-tapped segment or menu keycap reads as half-pressed, and on the home menu (p0) that looks like a stuck state.
- evidence: Code search. DESIGN.md defines hover as a physical sink, which is the state that is misleading when it sticks.
- recommendation: Wrap the translate/shadow part of the hover rules in `@media (hover: hover)`. Colour-only hovers can stay. One wrapper per component block.
- contract: DESIGN.md "Hover / Press"; ui-standard §1.3 (states must mean what they say).
- effort: M

##### 18-12 · P2 · Rail and subnav strips show a full classic scrollbar under the nav on narrow desktop windows, with no scroll affordance on phones
- where: shell.css:5044 (`.ds-rail` `overflow-x: auto`), 5148 (`.ds-subnav`); p1/p2/p3/p4/p9/p10 mobile (thick grey bar with arrow buttons under "Home Play Configure Records" and under "Robot Controls Match Audio and…")
- what: Under 900px on Windows/Linux Chromium, each strip carries a ~17px scrollbar, two per Configure page, which reads as broken. On real phones the bar is an overlay, so the only hint that "Profile" (5th rail item) and "Graphics/Network" exist is a word clipped mid-string ("Audio and").
- evidence: Screenshots. `scrollbar-width: thin` is already used once at 4980, for the hero chips.
- recommendation: Add `scrollbar-width: none` on both strips plus an edge fade (a `mask-image` gradient on the scroll container), and `scroll-snap-type: x proximity`. Scroll the active item into view on route change so "Network" is not selected off-screen.
- contract: Cross-page visual consistency; discoverability.
- effort: S

##### 18-13 · P2 · On-field touch controls use a themed token for their ring
- where: styles.css:2743 (`.mobile-joystick-base`) and 2790 (`.mobile-btn`): `border: 2px solid var(--ds-hud-line)`
- what: The joystick and buttons are drawn on the canvas, which is category 3 (does not theme). `--ds-hud-line` is tuned for a HUD card edge and changes between themes, so the pad's ring changes with the app theme while the field under it does not. Everything else on them already uses `--ds-on-field*`.
- evidence: The CLAUDE.md theming rule ("Use category 3 for anything drawn straight on the field").
- recommendation: Use `--ds-on-field-dim` for the resting ring (it is already used for `.fling/.flip/.park`), or add an `--ds-on-field-line` token.
- contract: CLAUDE.md Gotchas: THEMING, category 3.
- effort: S

##### 18-14 · P2 · Five copies of the same one-line table scroller, with no horizontal-scroll affordance or sticky key column
- where: shell.css:2486-2488 (`.mh-scroll, .lb-scroll`), 6647 (`.yd-scroll`), 7060 (`.an-scroll`), styles.css:3255 (`.adm-table-wrap`)
- what: Each was added after a phone sweep found a clipped table, and the comments cross-reference each other ("the fix `.mh-scroll` and `.yd-scroll` already carry"). The leaderboard (`.lb-scroll .ds-table` has a floor, 2498) scrolls sideways at 375px, with nothing showing that more columns exist, and the rank/driver columns scroll away from the score.
- evidence: Code only (the leaderboard rendered its empty state in p4). Leaderboard.tsx:425-432.
- recommendation: Replace all five with one `.ds-table-scroll` (overflow-x auto, an edge-fade shadow). Make the `.rk` and Driver columns `position: sticky; left: 0` with a panel background. Delete the per-feature classes.
- contract: ui-standard "one component, one class" (the `.ds-dl` lesson in reverse: one intent, five names).
- effort: S

##### 18-15 · P2 · The Controls page leads with keyboard binding on a phone
- where: p3-mobile; `.ds-binds` (shell.css:5373+) and the bind scope segs
- what: On a touch device, the Touch Controls panel is correctly first, but the scope picker, "Backspace while a bind is waiting removes it", and the full keyboard/gamepad bind grid (with `.ds-key` deliberately left unenlarged) take the rest of the page. None of it can be used without a keyboard.
- evidence: p3-mobile: after TOUCH CONTROLS and TUTORIAL comes DRIVING › KEYBOARD, W/S/A rows with 24px "+" buttons.
- recommendation: Under `useCoarsePointer()`, collapse the bind panels behind a "Keyboard & gamepad bindings" disclosure and hide the Backspace hint. The hook already exists and is subscribed.
- contract: ui.md (touch is the first panel "because it is the one control a phone needs").
- effort: S

##### 18-16 · P2 · In-match MENU/RESET shrink to ~28px on touch, top-left, beside the notch
- where: styles.css:2963-2966 (`.game-btn { padding: 6px 12px; font-size: 12px }` in the coarse block)
- what: The block shrinks the one exit control for a touch user to about 12px text plus 12px padding. That clears the 24px floor but not 44px, and it sits in the hardest thumb zone (top-left, away from the drive thumb). A mis-tap on RESET mid-match restarts the run.
- evidence: Code; `mobileActions.ts:228-235` holds the action buttons to ≥44px at the minimum scale. The chrome buttons get no such floor.
- recommendation: `min-height: 36px; min-width: 44px` while keeping the compact type. Space RESET away from MENU (a gap of 12px or more), or require a confirm on touch.
- contract: The pad's own 44px rule, applied consistently to HUD chrome.
- effort: S

##### 18-17 · P2 · The home page puts social links above the primary action on a phone
- where: p0-mobile (Discord/Instagram wrap 2+1 with GitHub, ~110px, between the season picker and Play)
- what: On desktop the row is minor. At 375 it wraps to two rows and pushes Play down, so the menu's fourth keycap (Profile) falls to the fold line.
- evidence: p0-mobile: Play at y≈400, socials at y≈290-375.
- recommendation: Under 640px, move `.ds-home` socials below the menu, or make them three icon-only 44px buttons in one row.
- contract: DESIGN.md primary-action hierarchy.
- effort: S

##### 18-18 · P3 · Duplicate media blocks for the same width, side by side
- where: shell.css 640px at 442, 508, 2155, 5156, 5364, 7097; styles.css 720px at 1865, 1930, 1937 (within 75 lines); 560px ×3 in shell.css
- what: The same query is re-opened next to its desktop rule. That is fine for locality, but three consecutive 720px blocks in styles.css (1930 and 1937 are 7 lines apart) are one block split for no reason.
- evidence: rg output above.
- recommendation: Merge adjacent same-width blocks. Keep co-location elsewhere.
- contract: ui-standard duplicate-selector spirit.
- effort: S

##### 18-19 · P3 · The FriendsPanel squeeze breakpoint is duplicated in TS
- where: src/ui/FriendsPanel.tsx:65 (`'(max-width: 1100px) and (min-width: 901px)'`) against shell.css 900/1099/1100
- what: The JS hard-codes the CSS rail breakpoints, and it uses 1100 where the CSS uses 1099/1100 (1100 itself matches both). If the rail breakpoint changes, the panel squeeze silently disagrees.
- evidence: Code.
- recommendation: Export the named breakpoints from one TS module (see 18-10), use them here, and cite them in the CSS comment.
- contract: Single source of truth.
- effort: S

##### 18-20 · P3 · `theme-color` follows the OS scheme, not the app theme
- where: index.html:18-19; no update in src/theme.ts (`rg theme-color src` returns nothing)
- what: A phone in OS-light mode with DSIM set to dark gets a light #f9faf7 browser toolbar over a dark app, and vice versa.
- evidence: Code.
- recommendation: In theme.ts's apply step, set the `theme-color` meta content from the resolved theme (one line).
- contract: CLAUDE.md "EVERYTHING THEMES".
- effort: S

##### 18-21 · P3 · The pad's fallback placement drops a button at screen centre
- where: src/ui/mobileActions.ts:403 (`spot ?? clampOn({ x: vp.w / 2, y: vp.h / 2, size }, vp)`)
- what: When no candidate slot fits (a small landscape phone at a large layout scale, with gutters taken), the button lands on the middle of the field, over the robot.
- evidence: Code.
- recommendation: Fall back to shrinking the button (down to the 44px floor) before centring, or stack the button at the top of its side column.
- contract: ui.md "positions are computed".
- effort: S

#### Strengths (keep)
- No horizontal overflow on any of the 12 routes at 375px, in either theme (audit). The past sweeps (lb-scroll, status-wrap cap, results stacking) show.
- `useCoarsePointer` is a proper `useSyncExternalStore` subscription, so a 2-in-1 that gains or loses a mouse switches control sets live.
- The touch pad is derived rather than stored: the button set comes from `ACTION_GAMES` with a smoke-tested coverage check, placement is packed against the live viewport per orientation, landscape gutters are treated as obstacles, secondary buttons were sized to stay ≥44px at the minimum 0.7 scale, and `env(safe-area-inset-*)` is honoured on the HUD, buttons and edit bar.
- Assisted actions are ghosted, never hidden (fix the legibility, keep the rule).
- The touch-target block is sizes-only and padding-driven, so it can never shift layout, which is the right pattern. It needs only the pointer condition (18-02).
- The rail→strip and Friends→strip degradation comments record why each undo exists (sticky strip, card chrome), and `.ds-body > …` order scoping fixed the footer-at-top bug.
- `100dvh` is used consistently for full-height surfaces, and the results screen restacks red/breakdown/blue with a width-driven `--resx-u` instead of shrinking.

### 19 · Copy and microcopy (cross-cutting)
Examined: screenshots p0–p11 (light, desktop + p8 mobile); strings in src/ui/*.tsx (ModeSelect, NavRail, Lobby, Matchmaking, Leaderboard, Stats, CareerPanel, ProfileMenu, Account/Appearance, App.tsx dialogs, GameView overlays, Results, Menu hero stats, Download, TutorialCard, Announcements, PeriodPicker), src/download.ts, src/legalText.ts, src/games/{decode,biobuzz}/tutorial.ts, biobuzz/labels.ts, index.html meta. Measured against docs/area/ui.md §"UI COPY — the house rules", the CLAUDE.md brand rule, and design-guide §3.

##### 19-01 · P1 · "Season" means two different things in the same UI
- where: src/ui/AppShell.tsx:116 (`aria-label={`Season: ${season.name}`}` → "Season: DECODE"); src/ui/DiscordLobbyList.tsx:147; src/ui/Announcements.tsx:16-17,82; src/ui/PeriodPicker.tsx:56-62; src/ui/CareerPanel.tsx:30; src/ui/Leaderboard.tsx:347,358; src/ui/Appearance.tsx:93; src/ui/Results.tsx:924
- what: The game is a season ("Season: DECODE", "To run a different season, pick it on the home page first."). The ranked reset period is also a season ("A NEW SEASON", "Act X · Season Y", "when an act or season ends"). The leaderboard adds a third word for the period: "Current period", and the picker is labelled "Period".
- evidence: CLAUDE.md defines a game as a "season". The Act/Season ladder reuses that word for a board reset. So "Season 2 of DECODE" and "the DECODE season" name different things, and the leaderboard's "Current period" heading (p4) is the only place that avoids the clash.
- recommendation: Keep "season" for the game, which is what the codebase and the season picker already mean. Rename the reset unit in user copy only: "Act 2 · Round 3" (or "Split 3"), "A NEW ROUND", "when an act or round ends". Use one fallback label everywhere: "Current round". If the owner would rather keep Act/Season for ranked, then drop "season" from the game side instead ("Game: DECODE", "To play a different game, pick it on the home page first.").
- contract: ui.md Terminology rule; CLAUDE.md brand rule
- effort: M (string-only, but it touches admin, announcements and the period picker)

##### 19-02 · P1 · The rating is called "ELO", but the system is Glicko-2, and other pages say "rating"
- where: src/ui/Leaderboard.tsx:210 ("Your rank · <strong>1234</strong> ELO"), :344 (column "ELO"); src/ui/CareerPanel.tsx:118,125 ("1V1 ELO", "2V2 ELO"); src/ui/Stats.tsx:37,86; src/ui/AuthDisabled.tsx:18 ("ranked ELO"); src/ui/GameView.tsx:1249; src/ui/Results.tsx:392 (title "ELO 1000 → 1012"); vs src/ui/Account.tsx:184,340 ("rating", "ranked rating"), src/ui/AdminStanding.tsx:198 ("−N rating")
- what: The same number goes by "ELO" in the leaderboard, career, intro and results, and by "rating" in the account and admin pages.
- evidence: CLAUDE.md says ranked is Glicko-2, so "ELO" is technically wrong. "Your rank · 1234 ELO" also prints a rating after the word "rank", right next to the "#12" that is the actual rank.
- recommendation: Use "Rating" everywhere: column "Rating"; "#12 · rating 1234"; career tiles "1v1 rating" / "2v2 rating"; results tooltip "Rating 1000 → 1012"; "Sign in to track your rating and records."
- contract: ui.md Terminology (one concept, one name)
- effort: S

##### 19-03 · P1 · Leaderboard and career errors show raw exception text, and the unconfigured states show env-var names
- where: src/ui/Leaderboard.tsx:335 + :413-414 (`setError(e.message)` under "Couldn’t load the board"); src/ui/CareerPanel.tsx:71-72 (`{error}`); src/ui/Leaderboard.tsx:304 ("Leaderboards need the game server (set VITE_GAME_SERVER_URL)."); Stats.tsx:37,101; Profile.tsx:87; WatchLive.tsx:73; AuthDisabled.tsx:18; screenshots p4 and p5
- what: A real fetch failure prints whatever the browser threw ("Failed to fetch", "HTTP 502") as the entire body text. When the build has no server configured, players see "Set `VITE_NEON_AUTH_URL` to sign in and track ELO…".
- evidence: The house rule says a failure is "Couldn’t <verb>." followed by a concrete next step. Neither the exception text nor an env-var name is a next step a player can take. The desktop app's offline fallback and self-hosted/LAN builds are the builds where real players land on these screens.
- recommendation: Map the thrown error to "Couldn’t reach the game server. Check your connection and reload." (keep e.message in a `title` or console for debugging). Change the unconfigured body to "This build isn’t connected to a game server. Leaderboards, ranked and profiles are online-only. Solo Practice and Free Drive still work." Move the env-var name into a `<details>` or dev-only branch.
- contract: ui.md "Failures are Couldn’t … plus a concrete next step"
- effort: S

##### 19-04 · P1 · Mode tiles say the same word two or three times
- where: src/ui/ModeSelect.tsx:100-181; screenshot p1
- what: Group "PRACTICE · OFFLINE" → eyebrow "SOLO" → title "Solo Practice"; eyebrow "PRACTICE" → "Free Drive"; group "COMPETE · ONLINE" → eyebrow "RECORDS" → "Solo Record", "RECORDS" → "Duo Record"; group "CUSTOM · ONLINE" → eyebrow "CUSTOM" → "Custom Room"; "LIVE" → "Watch Live".
- evidence: Five of the seven eyebrows repeat either their group label or their own title. This is the "helper text that restates its own label" the house rules ban, one level up. The one eyebrow that adds information, "RANKED" over "Find Match", becomes noise because the rest of the grid is redundant.
- recommendation: Remove the `.k` eyebrow entirely and keep the group labels. If a line is wanted, make it say what the mode does: Solo Practice "Full match vs. bots"; Free Drive "No clock, no fouls"; Find Match "Ranked 1v1 or 2v2"; Solo Record "Best score, ranked board"; Custom Room "Invite by code"; Watch Live "Spectate a match".
- contract: ui.md "No helper text that restates its own label"; design-guide §3
- effort: S

##### 19-05 · P1 · One custom room goes by three names: "Custom Room", "Multiplayer" and "Watch a custom game"
- where: src/ui/ModeSelect.tsx:173 ("Custom Room"); src/ui/Lobby.tsx:735 (h1 "Multi<accent>player</accent>"), :380 ("Multiplayer needs the game server."); src/ui/WatchLive.tsx:139 ("Watch a custom game"); src/ui/Matchmaking.tsx:986 ("Custom Rooms are open to everyone."); screenshot p6
- what: The player clicks "Custom Room" and arrives at a page titled "Multiplayer". Ranked is also multiplayer, so the heading describes nothing that sets this page apart.
- evidence: A tile label that doesn't match the page it opens is the classic terminology drift the lens targets. The heading also has no season on it: p6 shows "DSIM" with no DECODE, although the room is DECODE-specific.
- recommendation: Use the h1 "Custom room" (sentence case, as `Duo Record` should become "Duo record"). Change the error to "Couldn’t open a custom room: this build has no game server." Change WatchLive to "Watch a custom room".
- contract: ui.md Terminology; Sentence case for headings
- effort: S

##### 19-06 · P1 · "You’re already in a game" dialog: "Abandon" doesn't say what it costs
- where: src/ui/App.tsx:1928-1943
- what: Title "You’re already in a game", no body, buttons "Rejoin" / "Abandon".
- evidence: If the active game is ranked, abandoning is a forfeit (the standing system charges for it, Matchmaking.tsx:734 "−N standing"). The dialog doesn't say whether abandoning costs anything, and it doesn't name the game. The Modes-page banner for the same state says "Rejoin match →", a second label for the same action.
- recommendation: Add a body: "Your {Ranked 1v1 / custom room} match is still running. Leaving it counts as a forfeit." (drop the second sentence for unranked). Buttons "Rejoin match" / "Forfeit and continue" (ranked) or "Leave match" (custom).
- contract: ui.md failures and dialogs rules; specific verb + noun (design-guide §3)
- effort: S

##### 19-07 · P2 · "Records" means four different things
- where: NavRail.tsx:13 (page "Records"); Records.tsx:45 (h1 "Records"); Leaderboard.tsx:364 (segment "Records" vs "Ranked" inside the Leaderboard tab); ModeSelect.tsx:148,156 (eyebrow "RECORDS", modes "Solo Record"/"Duo Record"); Results.tsx:1246 ("SOLO RECORD RUN"); screenshot p4
- what: On p4 the page title "Records" sits above a segmented control whose first option is also "Records". Inside it, "Records" means score-attack boards, while the page covers both boards and the career tab.
- evidence: A player can't tell whether the "Records" page shows their records, the record-run boards, or both.
- recommendation: Rename the leaderboard segment to "High scores" | "Ranked". Rename the modes "Solo score attack" / "Duo score attack", or keep "Solo record run" / "Duo record run" to match Results. Leave the nav page as "Records".
- contract: ui.md Terminology
- effort: S

##### 19-08 · P2 · "Profile" vs "Account" vs "Stats" vs "Career" drift
- where: NavRail.tsx:14 ("Profile" · "Appearance & account"); Account.tsx:55 and Appearance.tsx:46 (both h1 "Profile"); ProfileTabs.tsx:21-22 ("Appearance", "Account"); ProfileMenu.tsx:77,94,122 (tooltip "Account", sub "Profile and badges" / "Account settings", button "Account settings"); Profile.tsx (a public /profile/<username> page, a different thing); Records tab "Career" vs Stats.tsx:85,100 ("Sign in to see your stats", "Stats need the game server"), CareerPanel.tsx:71 ("Couldn’t load stats")
- what: Your own settings page is called "Profile", but its menu entry says "Account settings". "Profile" also names other players' public pages. The "Career" tab calls itself "stats" in its own empty and error states.
- evidence: A player reading "Sign in to see your stats" is sitting on a tab labelled "Career".
- recommendation: Use "Career" throughout that tab ("Sign in to see your career", "Couldn’t load your career"). In the avatar menu, "Account settings" → "Account" to match the tab. The identity row sub "Profile and badges" → "Appearance", to match its destination tab.
- contract: ui.md Terminology
- effort: S

##### 19-09 · P2 · ASCII hyphen used as a dash in the legal text and a live hint
- where: src/legalText.ts (21 occurrences of `word - word`, e.g. "These terms cover your use of DSIM - the website…", "they never will - that is a deliberate design rule", the privacy list "**Needed to play** - the match you are in"); src/ui/Lobby.tsx:1221 ("Server is restarting shortly - starting is paused for a moment."); screenshot p11
- what: A spaced hyphen stands in for a dash.
- evidence: The house rule: prefer a full stop or colon, and where a dash is right it is "—". /terms is a long-form page where this shows on every screen (p11). Lobby.tsx:1221 also duplicates App.tsx:1995's correct wording "Server is restarting shortly. New games are paused for a moment."
- recommendation: Lobby: "Server is restarting shortly. Starting is paused for a moment." Legal: rewrite each as two sentences or a colon ("These terms cover your use of DSIM: the website, the multiplayer service, and the desktop app."; list items "**Needed to play:** the match you are in…").
- contract: ui.md "PREFER A FULL STOP OR A COLON TO A DASH"
- effort: S (legal) / S

##### 19-10 · P2 · Room screens are covered in decorative glyphs (▶ ✎ ★ ＋ － 🤖 ⟲)
- where: Lobby.tsx:834,842,884,973,1012,1024,1188,1204 ("CREATE ROOM ▶", "JOIN ▶", "DONE ▶", "★ HOST", "＋ Add a bot", "－ Remove a bot", "Edit build ✎", "START MATCH ▶"), :971 ("🤖 BOT"); MatchStrategy.tsx:212,449; Matchmaking.tsx:990,1176; Results.tsx:623 ("⟲ REMATCH"), 1011 ("▶ WATCH REPLAY"); DiscordLobbyList.tsx:104
- what: Almost every CTA carries a trailing ▶, and the roster chips carry emoji and stars.
- evidence: ui.md records that the `＋` on the Configure add cards and the `🎯` were removed as decorative glyphs. The same `＋` survives in Lobby. When every button has a ▶, the glyph stops marking anything.
- recommendation: Remove the ▶ from ds-cta labels ("CREATE ROOM", "JOIN", "START MATCH"), and "DONE ▶" next to "← Done" becomes one "Done". "Add a bot" / "Remove a bot" / "Edit build". Chips "HOST", "BOT". Keep ← on back links only, which is the one directional convention the app actually has.
- contract: ui.md Configure copy (no decorative glyph); design-guide §3
- effort: S

##### 19-11 · P2 · Custom room entry: segment and CTA say the same thing
- where: Lobby.tsx:783-842; screenshot p6
- what: A segmented control "Create room | Join room", then a full-width CTA "CREATE ROOM ▶" directly under it.
- evidence: One action is labelled twice, in two casings, 20px apart.
- recommendation: Name the segments by the choice ("New room" | "Have a code"), and keep the CTA as the verb ("Create room" / "Join room").
- contract: ui.md "no helper text that restates its own label"
- effort: S

##### 19-12 · P2 · "Both players must pick the same region": custom rooms hold four
- where: Lobby.tsx:847
- what: "Both players must pick the same region."
- evidence: Custom rooms support up to four drivers plus bots (the roster heading is "Drivers", Lobby.tsx:948). "Both" is only right for a duo record.
- recommendation: "Everyone in the room must pick the same region." (or "Your partner must…" when isRecord)
- contract: accuracy
- effort: S

##### 19-13 · P2 · "Sign in from the top bar" points to an unlabelled "?" avatar
- where: Stats.tsx:86; ProfileMenu.tsx:77-80 (signed-out trigger is a `?` avatar with a title-only "Sign in"); Results.tsx:1136 ("Sign in to save this run to the leaderboard.", the variant with no button)
- what: The copy sends the player to a control that has no visible words on it.
- evidence: The house rule is that a sentence shouldn't point to another screen, and here even the pointer is to something unlabelled. The screen shows no Sign in button.
- recommendation: Put the action on the empty state itself: a `ds-btn primary` "Sign in", with the body "Track your rating, records and match history."
- contract: ui.md "no sentence whose content is where another screen is"
- effort: S

##### 19-14 · P2 · "Needs the game server" x5 is jargon with no next step
- where: ModeSelect.tsx:141,151,159,174,181; screenshot p1
- what: Every online tile says "Needs the game server".
- evidence: A new FTC driver doesn't know what "the game server" is or whether it's on their side. It appears five times on one screen. In production it reads as broken.
- recommendation: Say it once, at the group label: "COMPETE · ONLINE: unavailable in this build". Or, if the cause is connectivity: "Offline. Online modes return when you reconnect." Remove the per-tile repetition.
- contract: ui.md failures rule (what happened + what to do)
- effort: S

##### 19-15 · P2 · Preset cards say "0.7 inertia" and "one-click NSIS setup"
- where: src/ui/Menu.tsx:777,838 (`{flywheelInertia} inertia`); src/download.ts:41,47 (".exe · one-click NSIS setup", ".exe · no install, run anywhere"); screenshots p2, p10
- what: A unitless 0–1 "inertia" on the preset card, next to a range chip. Installer jargon on the download page.
- evidence: The slider these values come from is labelled "Flywheel inertia" (Menu.tsx:1005). "0.7 inertia" drops the noun, and the "MID RANGE" chip beside it already gives the meaning. "NSIS" means nothing to a student. "Run anywhere" is false for a Windows .exe.
- recommendation: Preset line: remove the inertia number and keep the range chip, or write "0.7 flywheel". Download: ".exe · installs with Start-menu shortcut" / ".exe · no install, runs from a folder or USB stick".
- contract: design-guide §3 (jargon); ui.md blurbs must name a trade-off
- effort: S

##### 19-16 · P2 · Download subline says "offline", but the desktop app is a thin online shell
- where: src/ui/Download.tsx:72; screenshot p10
- what: "The full offline sim in a native window."
- evidence: CLAUDE.md: "The desktop shell is a THIN SHELL: online it loads the live site, offline it falls back to the bundled dist." It isn't "the offline sim". Ranked and records still need a connection. "sim" is also a lowercase product noun where the brand is DSIM.
- recommendation: "DSIM in its own window. Plays offline when you have no connection."
- contract: CLAUDE.md brand rule; accuracy
- effort: S

##### 19-17 · P2 · Chain Reaction disclaimer names the product three ways
- where: App.tsx:1897-1902; screenshot p7
- what: Title "About this simulation"; body "This simulator is…", "The simulation is not realistic", "not for this sim."
- evidence: "simulation", "simulator" and "sim" all appear in one 60-word dialog, and DSIM appears nowhere. "drive your … design decisions" is also a pun on "drive" right after robots "drive".
- recommendation: Title "Chain Reaction in DSIM". Body: "Chain Reaction is the Unofficial FTC Discord’s CAD Competition game. DSIM’s version is a rough, for-fun approximation: robots here don’t drive, shoot or score like the real ones will, so don’t base CAD decisions on it."
- contract: CLAUDE.md brand rule
- effort: S

##### 19-18 · P2 · Sponsor trademark inside a build chip: "OFFSET™ BOX TUBE"
- where: src/games/biobuzz/labels.ts:98; screenshot p9 (Pollinator chip "SINGLE TURRET · OFFSET™ BOX TUBE · BACK", which wraps to two lines)
- what: The ™ and brand name sit in a spec chip, and "Box Tube" / "box tube" / "No box tube" switch casing across the same card (p9 hero "No box tube FLOWER SCORING").
- evidence: This is the only chip on the page that wraps, and the only one with a mark. Its text changes with `sponsorActive`, so the part's name itself depends on the sponsorship.
- recommendation: In chips and hero tiles, use "Box tube". Keep the sponsor attribution in the builder's part picker row: "Box tube (OFFSET™ slide kit)".
- contract: ui.md Terminology; DESIGN.md chip rules
- effort: S

##### 19-19 · P2 · Hero stat units mix abbreviation styles and read as labels, not units
- where: src/ui/Menu.tsx:630-656; screenshots p2, p9
- what: "94 IN/S TOP", "259 IN/S² ACCEL", "9.6 RAD/S TURN", "37.0 RAD/S² ANG. ACCEL", "23.5 LB MASS", "500 DRIVE RPM", "Mecanum DRIVETRAIN".
- evidence: The unit and the quantity are fused in the order unit-then-noun, and the CSS upper-cases them, so "IN/S" and "RAD/S²" are shouted. "ANG. ACCEL" is the only one abbreviated with a period. "rad/s" means nothing to most drivers. Values like "37.0" carry a decimal that 94 and 259 don't.
- recommendation: Label first, unit small: "Top speed 94 in/s", "Accel 259 in/s²", "Turn 9.6 rad/s" (or convert to "550°/s"), "Turn accel 37 rad/s²", "Mass 23.5 lb", "Motor 500 rpm". Keep units in lowercase (no text-transform on units).
- contract: DESIGN.md Digits-Are-Mono; ui.md sentence case
- effort: S

##### 19-20 · P3 · Title Case headings on console pages, against the sentence-case rule
- where: Lobby.tsx:733 ("Duo Record"); Matchmaking.tsx:981 ("Ranked Match"); WatchLive.tsx:62 ("Watch Live"); Admin.tsx:77 ("Control Panel"), :613 ("Acts & Seasons"); Legal "Terms of Use" (p11) vs "Download for desktop", "Pick a mode"
- what: Some headings are Title Case and others sentence case.
- evidence: ui.md: "Sentence case for ds-btn and every heading." The admin console is exempt only for ALL CAPS. The console heads also split a word into two colours ("Multi|player", "Ranked |Match").
- recommendation: "Duo record", "Ranked match", "Watch live", "Control panel", "Acts and seasons", "Terms of use". Mode names used as proper nouns on tiles (Solo Practice, Free Drive) may stay capitalised if that's a ruling; write it down in ui.md.
- contract: ui.md Sentence case
- effort: S

##### 19-21 · P3 · "&" vs "and" drift in labels
- where: NavRail.tsx:11-14 ("Practice & compete", "Robot & match setup", "Leaderboard & career", "Appearance & account"); Configure.tsx:56 ("Audio and Visual"); ProfileMenu.tsx:94 ("Profile and badges"); footer "Privacy & cookie settings"; App.tsx:2011 ("Refresh &amp; update"); Results.tsx:1133 ("Sign in to save this run & see your rank →")
- what: Both conjunctions are used in UI labels, sometimes on the same screen.
- evidence: Configure's side nav says "Audio and Visual", and the home sub-labels next to it use "&". Results puts "&" inside a full sentence.
- recommendation: Use "&" only in terse nav sub-labels and "and" in sentences and buttons: "Audio and visual" (sentence case too), "Refresh and update", "Sign in to save this run and see your rank".
- contract: ui.md voice consistency
- effort: S

##### 19-22 · P3 · "OK" and "Got it" dismiss dialogs that could name their outcome
- where: App.tsx:1998 ("OK" on "Server restarting soon"); App.tsx:1958 ("Got it" on "That match is over")
- what: Vague acknowledgements.
- evidence: The dialog next to them does it well ("Fix start position", "Refresh & update", "Not now"). "OK" is the only bare OK in the shell.
- recommendation: "Back to menu" for both, or "Play offline instead" on the restart dialog if solo practice is still allowed.
- contract: design-guide §3 specific verb + noun
- effort: S

##### 19-23 · P3 · "Start position invalid" uses "chassis", a word the builder never uses
- where: App.tsx:1966-1969
- what: "Your saved start position isn’t legal for the selected chassis. Fix it (or pick a preset) before starting."
- evidence: The builder calls it "robot" or "build". "Chassis" appears nowhere else in the UI copy. The parenthetical is a second sentence in disguise.
- recommendation: Title "Start position doesn’t fit this robot". Body: "Your saved start position isn’t legal for this build. Move it, or pick a preset position."
- contract: ui.md Terminology; full stop over aside
- effort: S

##### 19-24 · P3 · Tutorial hint casing: DECODE says "ARTIFACT"/"LAUNCH ZONE", but the builder and presets write "pollen", "the HIVE"
- where: src/games/decode/tutorial.ts:95,111,149; src/games/biobuzz/tutorial.ts titles ("Pick up a pollen", "Shoot into your hive"); preset lines on p9 ("4 pollen", "the HIVE and the FLOWERS")
- what: Game-element nouns are upper-cased in hints but lowercase in the step titles and preset text right beside them.
- evidence: Within one BIOBUZZ preset card, "HIVE"/"FLOWERS" are caps and "pollen" is lower. The tutorial card shows the title "Pick up a pollen" over a hint that caps POLLEN.
- recommendation: Pick one: lowercase game nouns in all prose ("the hive", "an artifact", "your launch zone"), and let the HUD chips carry the caps as the FTC display does.
- contract: ui.md ALL CAPS is correct in four places only
- effort: S

#### Strengths (keep)
- The failure voice is well kept outside Leaderboard and Career: "Couldn’t reach the game server.", "Couldn’t finish linking. Try again.", "Couldn’t copy. Long-press the address bar to copy this link." These follow the rule and give a next step.
- Typographic ’ and … are near-universal in rendered strings, and I found no "Something went wrong", no "Oops", no exclamation marks, and no marketing buzzwords (design-guide §3 is clean).
- Empty states are specific and actionable: "No practice runs yet / Finish a Solo Practice match and it is kept here.", "No placed players yet / Players appear here after N ranked matches.", "Be the first to set a score on this board."
- Tutorial hints are functions of the player's bindings and say what each key does and why ("You can only shoot from inside a LAUNCH ZONE", "All four is worth more"). The nudge "Stuck? Replay puts the field back, Skip moves on." is excellent microcopy.
- The brand/season split holds in the chrome: "DSIM · DECODE" app bar, "DSIM · DECODE 2025–26" footer, the <title> "DSIM: Online FTC Driving Simulator" and a meta description that names the seasons as games.
- Dialogs with real choices name them well: "Fix start position" / "Cancel", "Refresh & update" / "Not now", and "Reconnecting… / Your run keeps going."

### 20 · AI-generated-design tell hunt (cross-cutting): checked design-guide §3 against DESIGN.md / ui-standard.md. Examined all 48 screenshots (p0–p11, light and dark, desktop and mobile) plus src/ui/shell.css, src/ui/styles.css, Announcements.tsx, ModeSelect.tsx, Lobby.tsx and main.tsx

#### Checklist

| tell | verdict | where |
|---|---|---|
| Icon-in-tile feature cards ×3 | absent | the mode cards and presets carry no icon tiles |
| One-side accent border | **FOUND** (20-05) | shell.css:1109, 4163, 5495, 5578, 7761; styles.css:1457/1466; p9 StarterBot card |
| Hairline + diffuse shadow on the same card | **FOUND** (20-04) | styles.css:3824-3834 `.ann-panel` |
| Nested cards | **FOUND**, mild (20-09) | configure: panel > preset cards; hero > hero-view > stat tiles (p2/p9 mobile) |
| Eyebrow-pill hero + sentence headline + 2 CTAs | absent | home leads with the "DSIM" wordmark; the "PRESENTED BY" line is a sponsor credit, not a pill. See 20-10 for the home's other template issues |
| Numbered markers / repeated uppercase kickers | **FOUND** (20-02, 20-03) | ModeSelect.tsx:103-198; 49 `text-transform: uppercase` in src/ui |
| Big-number metric tiles | **FOUND** (20-08) | mobile `.ds-hero .ds-stat` grid (p2/p9 mobile); `.ds-homestats` shell.css:1742 |
| Purple/indigo gradient, cyan glow on dark | **FOUND** as glow on dark (20-01); no purple | styles.css:3960-4066 cinematic reveal |
| Gradient text | absent | no `background-clip: text` anywhere |
| Default font, one family everywhere | partial (20-12) | two families as contracted, but Space Grotesk is on the guide's own "by default" list, is mislabelled "monospace", and leaks into copy |
| Every element pill-rounded | partial (20-10) | `.ds-menu-btn` is `--ds-round-full` (shell.css:1360); everywhere else follows the scale |
| Dark mode as reflex | absent | both themes are contracted and contrast-audited, the user toggles; light is first-class (p0 light) |
| Grey text on coloured fills | minor (20-14) | tutorial banner sub-line (p1) |
| Fade-in-on-scroll | absent | the only IntersectionObserver is sponsor impressions (Sponsor.tsx:162) |
| Bounce / elastic easing | minor (20-13) | no overshoot bezier, but keyframed overshoot in styles.css:2451-2476 |
| Buzzword copy | absent | copy is literal: "Learn the controls on the real field", "The full offline sim in a native window" |
| Plastic / placeholder imagery | absent | robot previews are real sprites on the field mat |

#### Findings

##### 20-01 · P1 · The season/act cinematic reveal is textbook glow-on-dark AI styling
- where: src/ui/styles.css:3960-4066 (`.ann-cinema*`), src/ui/Announcements.tsx:78-91. Not captured in screenshots (shows once per new season/act).
- what: a full-screen near-black scrim, a `filter: blur(20px)` radial orb breathing on an infinite loop, a title with `text-shadow: 0 0 40px` glow that animates in from `filter: blur(10px)`, an eyebrow reading "✦ A NEW SEASON ✦" at `letter-spacing: 8px`, a gradient light-sweep across a hairline rule, and an all-caps letterspaced "CONTINUE" button.
- evidence: styles.css:3982 `filter: blur(20px)`; :4008 glow text-shadow; :4036 sweep gradient; :4063 the eyebrow's letter-spacing animates 2→8px; Announcements.tsx:82 the ✦ glyphs. Every ingredient comes from the generic "product launch" template, and none of it is keycap, block shadow or driver station. It is also the only place in the app that breaks the No-Blur Rule three ways at once.
- recommendation: rebuild it in DSIM's own vocabulary. A field-control-style reveal fits: the season name on a solid `--ds-panel` keycap slab with a `--ds-block` shadow, set against the dark field mat or the season's field render, with one transform-only drop-in. Delete the orb, the glow, the sweep and the ✦ glyphs. Keep the audio cue.
- contract: DESIGN.md No-Blur Rule, "Don't add a blurred box-shadow"; design-guide §3 "cyan-glow-on-dark", uppercase kickers.
- effort: M

##### 20-02 · P1 · Mode cards stack a second uppercase kicker that repeats the section or the title
- where: src/ui/ModeSelect.tsx:103-198 (`<span className="k">`); p1 desktop/mobile, both themes.
- what: each group has an uppercase section kicker (PRACTICE · OFFLINE), and then every card inside it gets its own uppercase kicker: "SOLO" over *Solo Practice*, "PRACTICE" over *Free Drive* (inside the PRACTICE group), "RECORDS" over both *Solo Record* and *Duo Record*, "CUSTOM" over *Custom Room*, "LIVE" over *Watch Live*.
- evidence: of the eight kickers, five repeat a word already in the card title or the section heading. This is the "repeated uppercase kickers" tell almost exactly: labels on top of labels, applied the same way whatever the content.
- recommendation: delete `.k` from the mode cards. The section header already classifies them. If any meta line is needed, use it for real information, e.g. "2v2 · Glicko" on Find Match or "no timer" on Free Drive.
- contract: ui-standard §8 "Descriptions are deleted… If it restates the label… it goes"; design-guide §3.
- effort: S

##### 20-03 · P2 · Uppercase-tracked panel headers everywhere, contradicting the standard's own "sentence case"
- where: p2/p9 (START FROM, BUILD, DRIVETRAIN), p3 (TOUCH CONTROLS, TUTORIAL, DRIVING, KEYBOARD, GAMEPAD), p4 (DRIVETRAIN), p5 (PRACTICE REPLAYS); 49 `text-transform: uppercase` rules (shell.css 36, styles.css 12, tutorial.css 1).
- what: every panel title renders as small, widely tracked caps. With the mode-card kickers, the eyebrows, the spec-chip units (IN/S TOP) and the "PRESENTED BY" lines, most secondary text on a page ends up the same letterspaced caps. When everything is shouting quietly, nothing ranks above anything else.
- evidence: ui-standard §6 "Panel… The title is a **short noun phrase, sentence case**". The rendered headers are uppercase, so either the CSS or the standard is wrong.
- recommendation: reserve tracked caps for one role, either the page eyebrow or the mono data units. Render `.ds-panel-h` titles in sentence case at `--ds-t-lg` weight 700, as the standard already says. It is a single CSS rule.
- contract: ui-standard §6; design-guide §3 "repeated uppercase kickers".
- effort: S

##### 20-04 · P2 · Blurred diffuse shadows despite the No-Blur Rule; one of them is also hairline + diffuse
- where: styles.css:3834 `.ann-panel` (1px `--ds-hud-line` border at :3826 AND `0 24px 60px rgba(0,0,0,.35)`); :2776, :2797, :2864, :3082 (mobile joystick, thumb buttons, edit bar: `0 4-6px 12-24px`); text-shadow :315, :1381, :1399.
- what: the "What's New" modal stacks a defined edge and a soft elevation on one card, which is exactly the tell §3 names. The touch-control shadows are blurred too.
- evidence: DESIGN.md: "Nothing in this system uses a soft/blurred shadow… blur radius > 0 reads as generic-web." The live chrome otherwise obeys it perfectly (`--ds-block` 4px 4px 0, `--ds-edge` 0 3px 0, shell.css:97-102), so these sites stand out.
- recommendation: `.ann-panel` → `box-shadow: var(--ds-block)`. On-canvas touch controls → a hard `0 3px 0` edge in a dark on-field tone, which also makes them read as keycaps. The in-HUD text-shadows can stay only if DESIGN.md is amended to allow canvas-legibility shadows (category 3) explicitly.
- contract: DESIGN.md Elevation & Depth / No-Blur Rule; design-guide §3 "hairline + diffuse".
- effort: S

##### 20-05 · P2 · Thick one-side accent borders used as a cue in six places, and alliance shown as an edge instead of a fill
- where: shell.css:1109 `.fr-toast` (3px accent left); :5495/:5500 `.ds-player.red|blue`; :5578/:5583 `.ds-strat-card.red|blue`; :7761 `.ds-panel.appr-unclaimed`; :4163 `.ds-opt.real` (inset 3px, visible on p9 as the StarterBot card's green left edge); styles.css:1457/1466.
- what: the classic "coloured stripe on one side of a rounded card". On p9 it is unexplained: StarterBot looks half-selected, and nothing tells the player that the stripe means "real documented robot".
- evidence: the comment at shell.css:4153-4161 explains the choice thoughtfully, but the result still needs a legend the UI doesn't provide. For alliance, DESIGN.md says "identity is the FILL, not a tint", and the lobby row already has a filled `.ds-chip.red/.blue` (shell.css:5544), so the red/blue left edge repeats it in the weaker form.
- recommendation: `.ds-opt.real` → a literal tag chip ("Real team" / "Kit") in the existing tag row, which teaches what the stripe can't. Alliance rows/cards → drop the edge and rely on the filled chip. Toast/unclaimed → use the depth model, e.g. an accent `--ds-edge` under the card, or nothing.
- contract: design-guide §3 "accent border on one side"; DESIGN.md Chips "Alliance variants: filled solid".
- effort: S

##### 20-06 · P2 · Soft gradient washes and accent glows on surfaces the contract calls flat
- where: shell.css:3869 `.ds-console` radial accent glow at page top (visible on p6 lobby, both themes); :4597 `.ds-hero` `linear-gradient(160deg, tile, panel)` (p2/p9 hero card); :5634 `.ds-dl-hero` same gradient (p10); :4613 `.ds-hero-view` radial accent; styles.css:279/283 alliance score panels as hex-literal gradients.
- what: a faint diagonal sheen on "hero" cards and a glow at the top of the page are stock SaaS-landing moves. Every other DSIM surface is a flat fill with a hard block shadow, so these few cards look imported from a different system.
- evidence: DESIGN.md Overview: "a flat colored cap sitting on a slightly darker edge"; Elevation: "Flat by default". The lobby (p6) is the only page whose background visibly varies, so it doesn't match the sidebar pages.
- recommendation: flat `--ds-panel` (or `--ds-tile` for the recessed preview) on all four. Delete the console glow. Score panels → flat `--ds-red-chip`/`--ds-blue-chip`, which also clears two hex literals from the ui-standard §5 debt.
- contract: DESIGN.md Elevation & Depth; ui-standard §5 (no hex literals).
- effort: S

##### 20-07 · P2 · "Multi**player**" two-tone headline
- where: src/ui/Lobby.tsx:735; p6 both themes.
- what: half of one word is painted in the accent. The accent-word-in-headline is a signature AI hero move, and here it splits a single word, which reads as a stylistic accident. No other h1 does it ("Pick a mode", "Configure", "Records" are solid ink).
- evidence: `<>Multi<span className="accent">player</span></>`.
- recommendation: solid `--ds-ink` "Multiplayer", matching every other page h1.
- contract: design-guide §3 "Gradient text on headings → solid ink" (same intent); ui-standard §6 page anatomy.
- effort: S

##### 20-08 · P2 · On mobile the robot spec chips turn into a big-number metric-tile grid
- where: p2-mobile, p9-mobile (both themes); shell.css:4829-4840 `.ds-stats/.ds-stat` (the desktop chip override lives at :4970-4994 inside the ≥1100px query); `.ds-homestats .ds-stat .sv { font-size: 22px }` shell.css:1742-1746.
- what: on desktop the stats are compact, well-judged chips ("94 IN/S TOP"). Under 1100px they become a 2-column grid of bordered tiles, each with a big number over a small caps label, at least 5 rows tall and nested inside the hero card. On a phone that pushes the presets several screens down.
- evidence: the mobile screenshot shows 94 / 259 / 9.6 / 37.0 / 23.5 / 500 as six identical tiles, the "big-number + small label ×N" pattern. The home-stats variant repeats it at 22px, which is also off the type scale.
- recommendation: keep the desktop chip treatment at every width. It is already the distinctive version: mono value, unit label, wrapping row. If space is the concern, show the top three (speed, accel, turn) and fold the rest.
- contract: design-guide §3 "Big-number metric"; ui-standard §3 (22px is off-scale).
- effort: S

##### 20-09 · P3 · Nested containers on configure
- where: p2/p9 desktop and mobile: `.ds-panel` "START FROM" > "Presets" label > bordered, shadowed `.ds-opt` cards > bordered tag pills. On mobile: panel > `.ds-hero` > `.ds-hero-view` bordered box > sprite canvas with its own border.
- what: three or four nested edges, each carrying a border and some also a block shadow, so the hierarchy is carried by boxes rather than by type and space.
- evidence: the preset card (border + `--ds-block-sm`) sits inside a panel (border + `--ds-block`), so two offset shadows stack. The mobile hero shows four concentric rounded rectangles around one robot.
- recommendation: drop the redundant "Presets" sub-label, and give `.ds-opt` inside a panel only its border (no block shadow; `.on` keeps its edge). On mobile, remove the `.ds-hero-view` border so the sprite's own mat is the only frame.
- contract: design-guide §3 "Nested cards"; DESIGN.md depth model (one block per surface).
- effort: S

##### 20-10 · P2 · The home screen is a centred wordmark plus a pill CTA stack, the one generic-looking screen
- where: p0/p7/p8, all themes and widths; shell.css:1352-1366 `.ds-menu-btn` (`border-radius: var(--ds-round-full)`, 16px 18px padding).
- what: a centred brand wordmark, a row of social pills (Discord/Instagram/GitHub) placed ABOVE the primary action, and then four 460px capsule buttons. It is the "landing page with a CTA stack" template. Nothing on the screen shows the product: no field, no robot, no score strip. The capsule radius also breaks the shape contract. Every other rectangular button in the app is 8px, and pill is supposed to be for chips.
- evidence: DESIGN.md Shapes: "Rectangular components (buttons…) use the 8px default… chips… go full pill"; design-guide §3 "Lead with the product itself". Switching seasons (p0 → p8) changes only a 12px header label and the segmented control, so DECODE and BIOBUZZ homes are otherwise pixel-identical.
- recommendation: square the menu buttons to `--ds-round` so they read as the same keycaps as the rest of the app. Move the social links into the footer. Let the season carry the screen: a static render of that season's field (the renderer already exists) or its robot sprite beside or behind the menu, so /decode and /biobuzz look like different games.
- contract: DESIGN.md Shapes, Overview ("not a generic web app shell"); design-guide §3 hero row.
- effort: M

##### 20-11 · P3 · Two CTA voices: "CREATE ROOM ▶" in tracked caps against sentence-case actions elsewhere
- where: p6 lobby (both themes); in-match `.ann-cinema-btn` "CONTINUE" (styles.css:4040).
- what: the lobby's primary action is a full-width capsule in letterspaced caps with a ▶ glyph. Everywhere else a primary action is sentence case with an arrow ("Start the tutorial →", "Download for Windows ↓").
- evidence: compare p1 and p6. The lobby looks like it came from an earlier generation of the UI, and it also keeps its own back-button header instead of the sidebar shell.
- recommendation: `.ds-btn.primary` in sentence case: "Create room".
- contract: DESIGN.md Components/Buttons (one primary look); ui-standard §6.
- effort: S

##### 20-12 · P2 · Space Grotesk is the guide's own "by default" face, DESIGN.md calls it monospace, and it leaks into copy
- where: DESIGN.md typography.data + Typography section; src/main.tsx:18-19; p0 (menu sub-lines "Practice & compete", "Robot & match setup"), footer "DSIM · DECODE 2025-26".
- what: (a) design-guide §3 names "Space-Grotesk-by-default" as a tell. It is defensible here only because of the telemetry-split rationale, and (b) undermines that rationale: Space Grotesk is a proportional grotesk, not a monospace, yet the contract calls it monospace in three places and backs it with a monospace fallback stack (ui-monospace/Consolas), so the offline fallback has different metrics and character. (c) The home menu sub-lines and the footer credit are prose set in the data face, which breaks the Digits-Are-Mono split in reverse.
- evidence: DESIGN.md:35 fallback `ui-monospace, SF Mono, Menlo, Consolas`; :124 "a squared-off mono". The p0 sub-lines render with Space Grotesk's distinctive "&" and wide tracking.
- recommendation: fix the contract's wording ("Space Grotesk, tabular figures"), give it a grotesk fallback stack, and set the menu sub-lines and footer in `--ds-font-ui`. If the team wants a true telemetry face, a real mono (e.g. JetBrains Mono / IBM Plex Mono) would be more distinctive than the most common "technical" pick. That's optional.
- contract: DESIGN.md Typography / Digits-Are-Mono Rule; design-guide §3 font row.
- effort: S (the wording and the sub-line fix) / M (a face swap)

##### 20-13 · P3 · Overshoot keyframes on the results screen are bounce easing by another name
- where: styles.css:2451-2463 `resx-winbanner-in` (0.6 → 1.08 → 1); :2464-2476 `resx-total-punch` (0.7 → 1.15 → 1 plus a brightness 1.5 flash); :2398 `resx-sting-in` (from scale 2.6).
- what: the bezier curves are all clean ease-outs, but the keyframes overshoot. In a match-results celebration this is defensible (it's a game), so this is a note, not a demand.
- evidence: as above. Transform/opacity only, so it is cheap. The brightness filter is the one non-contract property.
- recommendation: keep one punch, the total, and drop the 1.08 banner overshoot and the brightness filter. Confirm reduced-motion caps the iteration count, per CLAUDE.md.
- contract: design-guide §3 motion; ui-standard §7.
- effort: S

##### 20-14 · P3 · Muted grey text on the accent-tinted tutorial banner
- where: p1 light/dark: "Learn the controls on the real field." inside the `New to DSIM?` banner.
- what: `--ds-mut` grey on a green-tinted fill, where the grey was tuned against `--ds-panel`, not against this tint. It is legible, but it is the "grey text on coloured fill" pattern, and the sub-line is also 11–12px beside a 15px title.
- evidence: screenshot. Contrast passes the audit only if this pair is in scripts/contrast.mjs; it's worth confirming.
- recommendation: use `--ds-ink-dim` (or the accent's paired ink) for text on accent-tinted fills, and add the pair to contrast.mjs.
- contract: design-guide §3 "Gray text on colored fills → the paired on-* ink"; DESIGN.md Fill-Is-Not-Text Rule.
- effort: S

#### Strengths (keep)

- **Keycaps are real, not a metaphor.** The controls page (p3) renders bindings as actual key caps (W / S / A / D / RB) with the `0 3px 0` edge. It is the single most distinctly DSIM screen, and it should be the reference for 20-01 and 20-10.
- **Hard block and edge shadows everywhere in the live chrome** (shell.css:97-102): `4px 4px 0` with zero blur, carried consistently across panels, buttons, tabs and the Friends tab. No AI template produces this by default.
- **Content that could only belong here:** preset cards naming real teams ("19745 · Turtle Walkers", "22489 · Galactic Narwhal Chicken Effect"), spec chips with physical units (IN/S TOP, RAD/S² ANG. ACCEL, LB MASS), and range tags. It is specific, domain-true data, not lorem ipsum.
- **The robot sprite drawn on the field's own dark mat** inside a light-themed card (the deliberate three-zone rule) reads as a telemetry thumbnail rather than an illustration.
- **Driver Green instead of indigo, alliance red/blue held in reserve.** On the screenshotted pages the saturated colour is almost entirely the green accent, which is exactly the "spend colour like an alarm" rule.
- **Plain, literal copy** with no buzzwords: "Pick a mode", "Needs the game server", "The full offline sim in a native window", and the Terms page written in first person ("you can reach a human at…").
- **Dark mode is a decision, not a reflex:** both themes are first-class and contrast-audited. The dark palette is warm charcoal plus mint, not black with a cyan glow.

### 21 · Interaction states and motion (cross-cutting)
Examined: every `:hover`/`:active`/`:focus-visible`/`:disabled`/`.on` rule, every `transition` (43) and `@keyframes` (~40), and all four `prefers-reduced-motion` blocks in src/ui/{shell,styles,predict,tutorial}.css. Also loading/pending markup in src/ui/*.tsx, and screenshots p0/p2 in both themes. Measured against DESIGN.md (Elevation, Buttons), ui-standard §1.3/§1.4/§7, and design-guide §3.

##### 21-01 · P0 · `.chip.desync` strobes under reduced motion
- where: src/ui/styles.css:501-505 (`animation: blink 1s steps(2) infinite`), src/ui/shell.css:5657-5661 (global `*` cap), src/ui/styles.css:1346-1364 (iteration-count list)
- what: With reduced motion on, the global `*` rule in shell.css cuts every animation to 0.001ms but leaves the iteration count alone. Only styles.css caps the count, and only for four named selectors (`.timer-panel.urgent .timer-time`, `.net-spinner`, `.rec-dot`, `.ds-key.capturing`). `.chip.desync` uses the same `blink` keyframe but is not on that list. So it keeps looping forever at 0.001ms, and each frame samples a random `steps(2)` phase. The result is a 1.0/0.55 opacity flicker at frame rate on a red HUD chip. That is exactly the bug the comment at styles.css:1357 says was fixed.
- evidence: `rg "infinite" src/ui/*.css` finds 8 infinite animations. Seven are capped or killed. `.chip.desync` is the one that isn't.
- recommendation: Put `animation-iteration-count: 1 !important` in the global `*` rule at shell.css:5658. The per-selector lists then become redundant and no future infinite animation can slip past.
- contract: ui-standard §7 bullet 2; CLAUDE.md Gotchas ("must cap animation-iteration-count").
- effort: S

##### 21-02 · P1 · Disabled `.ds-btn` and `.ds-cta` still react to hover and press
- where: src/ui/shell.css:1578-1599 and 1610-1614 (`.ds-btn`); 5270-5283 (`.ds-cta`)
- what: `:disabled` resets only `transform`. Because `.ds-btn:hover`/`:active` come earlier at equal specificity, hovering a disabled button still turns its border accent and shrinks its edge from 3px to 2px, and pressing drops the edge to 0. Without the translate, the cap looks like it gets thinner rather than sinking. On `.ds-btn.primary:hover` (0,3,0) the rule beats `:disabled` (0,2,0) outright, so a disabled primary also lightens its fill on hover. DESIGN.md says a disabled button "never presses".
- evidence: `.ds-dl-opt` (3498), `.ds-opt` (4405) and `.bb-cell` (4771) each have a `:disabled:hover` reset. `.ds-btn`, `.ds-cta` and `.ds-menu-btn` do not.
- recommendation: Guard the state rules with `:not(:disabled)` (`.ds-btn:not(:disabled):hover` and so on), or add `.ds-btn:disabled:is(:hover,:active){box-shadow:var(--ds-edge-soft);border-color:var(--ds-line)}` plus the primary variant. Do the same for `.ds-cta`.
- contract: DESIGN.md Buttons ("disabled … never presses"); ui-standard §1.3.
- effort: S

##### 21-03 · P1 · Hover moves in two opposite directions
- where: sink on hover: `.ds-btn` 1578, `.ds-menu-btn` 1379, `.ds-home-link` 1337, `.ds-discord-join` 1223, `.ds-back` 3933, `.ds-dl-opt` 3484, `.ds-cta` 5270, `button.ds-key` 5434, `.game-btn` styles 1334, `.overlay-buttons button` styles 1587, `.sponsor-chip` styles 4218. Lift on hover: `.ds-tile` 1799, `.ds-opt` 4214, `.contrib-icon` 4339, `button.bb-cell` 4737, `.chassis-sw` styles 3398, `.pred-opt` predict 84, `.ds-tut-btn` tutorial 123, `.ann-cinema-btn` styles 4055.
- what: DESIGN.md's North Star describes one gesture: every pressable is a keycap that "sinks on hover". Eight pressables rise on hover instead. Some are defensible, like the Level-1 cards whose comment says "lifts on hover", but that exception is not written into DESIGN.md. The small controls (`.contrib-icon`, `.bb-cell`, `.chassis-sw`, `.pred-opt`, `.ds-tut-btn`) have no documented reason. On p2 the drivetrain `.ds-opt.mini` chips sit beside `.ds-btn` "Save this robot", so the two neighbours move in opposite directions under the cursor.
- recommendation: Write two models into DESIGN.md: keycap (sink 1, press 3 onto `edge`) and card (lift -1,-1, press into `block`). Move every small control onto the keycap model.
- contract: DESIGN.md Overview + Elevation ("Every interactive surface reads as a keycap … sinking on hover").
- effort: M

##### 21-04 · P1 · Four "mini-press" dialects with no edge to press into
- where: `.ds-lobby-row` shell.css:1274 (hover +1px, no box-shadow, no `:active`); `.ds-dl-seg button` 3564 (no hover move, active +1px, no shadow); `.ds-osk-key` 7227 (active +1px, no shadow); `.adm-copy` styles 3631 (active +1px); `.contrib-icon` 4339 (hover -1, active 0); `.ds-tut-btn` tutorial 123-131 (hover -1 with a 2px shadow appearing, active 0)
- what: These elements translate but have no hard edge to meet, which the Elevation section relies on. `.ds-lobby-row` is the worst: a bordered panel-filled row that drops 1px on hover, has no press state, and has no custom focus ring. That reads as jitter, not a keycap. Distances are 1px/1px/1px/1px/-1→0/-1→0, where the canonical model is 1/3.
- recommendation: Either give them `--ds-edge-soft` and the canonical 1/3 sink, or make them flat colour-only controls like `.ds-rail-btn` and `.ds-subnav-btn`. A translate with nothing under it should not be an option.
- contract: DESIGN.md Elevation ("Edge … a solid-color rim that a pressable sinks into on click").
- effort: M

##### 21-05 · P1 · "Selected" looks different on almost every control
- where: `.ds-rail-btn.on` 710 (accent-soft + accent border + `block-sm`); `.ds-subnav-btn.on` 1441 (accent-soft + accent border, no shadow); `.ds-opt.on` 4226 (accent-soft + 2px `accent-edge`); `.ds-seg.on` 2183 (solid accent, borderless); `.ds-dl-seg button.on` 3571 (solid accent + border); `.bb-cell.on` 4747 (solid accent + `accent-edge` border); `.ds-tab.on` 1478 (3px underline); `.ds-key.on` 5443 (inset 1px accent ring, accent text); `.chassis-sw.on` styles 3399 (2px ink ring); `.ds-osk-key.on` 7240 (accent-soft)
- what: That is 10 selected states in 5 visual families. On p2 the rail "Configure" and subnav "Robot" sit side by side: same fill, but one has a block shadow and one doesn't, so they look like two different components. Segmented controls come in three forms: `.ds-seg` is flat with no keycap and no transition (home game picker, p0), `.ds-dl-seg` has a border and a press, and `.ds-opt.mini` is a card.
- recommendation: Settle on two selected treatments: soft (accent-soft + accent border, for nav and option cards) and solid (accent fill, for segments). Remove `box-shadow` from `.ds-rail-btn.on` or add it to `.ds-subnav-btn.on`. Merge `.ds-dl-seg` into `.ds-seg`.
- contract: design-guide §4.3 ("the same button is the same button on every page").
- effort: M

##### 21-06 · P1 · Disabled opacity varies, and some disabled states barely show
- where: opacity 0.5 (`.ds-btn` 1611, `.ds-cta` 5280, `.ds-opt-add`, `.ds-osk-key`); 0.55 (`.ds-opt` 4241, `.ds-lobby-row` 1279, `.ds-dl-opt`, `.ds-dl-seg`); 0.4 (`.chassis-sw` styles 3400, plus one more); 0.6 (one); `grayscale(1)` shell.css:7801; `.ds-tile:disabled` 1807 changes only its shadow to `block-sm`, with no fade and no ink change
- what: DESIGN.md says disabled means 0.5 opacity. The code uses four opacity values plus one grayscale. A disabled `.ds-tile` looks almost exactly like an enabled one: same fill, same ink, same border, 2px less shadow, and it still gets the accent border on hover because `.ds-tile:hover` is unguarded. `.bb-cell` is the only control that states a principled disabled treatment (dashed edge + muted ink, "a faded control reads as loading", 4757), and it contradicts the 0.5 rule.
- recommendation: Pick one disabled treatment and put it in a token (`--ds-disabled-opacity: 0.5`), or adopt the `.bb-cell` dashed-and-muted rule everywhere and amend DESIGN.md. Give `.ds-tile:disabled` a real visual change.
- contract: DESIGN.md Buttons; the task's "distinct and not just faded".
- effort: S

##### 21-07 · P2 · Card press loses 1px of its base
- where: `.ds-tile` shell.css:1799-1806; `.ds-opt` 4214-4225; `.ds-opt.on:active` 4236
- what: A keycap's shadow base should stay fixed, so that offset plus shadow is constant. `.ds-btn` gets this right: 0+3, 1+2, 3+0. `.ds-tile` goes 0+4 at rest, -1+5 on hover, then +2+1 = 3 when pressed. `.ds-opt` goes 0+2, -1+3, then +1+0 = 1. Both cards' shadow base jumps up 1px at the moment of press, so the card never lands flush on its own shadow. Pressed `.ds-tile` also keeps 1px of shadow.
- recommendation: Press `.ds-tile` to `translate(4px,4px)` with shadow `0 0 0`, or `(3px,3px)` with `1px 1px 0`. Press `.ds-opt` to `translate(2px,2px)` with shadow 0.
- contract: DESIGN.md Buttons ("3px (flush with its own edge) on press").
- effort: S

##### 21-08 · P2 · Hover and selection erase the "real robot" marker on `.ds-opt.real`
- where: shell.css:4162 (`.ds-opt.real { box-shadow: block-sm, inset 3px … }`) vs 4214 `.ds-opt:hover` and 4226 `.ds-opt.on`
- what: All three rules are (0,2,0) and the hover/on rules come later, so each replaces the whole `box-shadow`. The inset accent stripe that tells a real team build from an archetype disappears whenever the card is hovered or selected, which is exactly when the user is choosing.
- recommendation: Add `.ds-opt.real:hover`, `.ds-opt.real.on` and `.ds-opt.real.on:hover` rules that append the inset, or move the marker to `::before` so it isn't part of the shadow stack.
- contract: ui-standard §1.4 (state must not lose meaning); the intent in the comment at 4153-4161.
- effort: S

##### 21-09 · P2 · 11 transition durations and no motion tokens
- where: 43 `transition` declarations across 4 files
- what: Durations in use: 0.06s, 0.08s, 0.1s, 0.12s/120ms, 0.14s, 0.15s/150ms, 0.2s, 0.25s, 420ms. Press transforms run at 0.06 (ds-btn family), 0.08 (tile/opt/tut/pred/contrib), 0.12 (chassis-sw, fold chevrons) and 120ms (bb-cell). Colour fades run at 0.08, 0.14, 0.15 and 120ms, and 0.14 vs 0.15 is a pure typo split. Three declarations exceed the §7 150ms ceiling: `.v-gauge-fill` background 0.2s (styles 1048), `.gate-icon` transform 0.25s (styles 1136), `.ds-gauge-fill` 420ms (shell 6253). The first two are HUD telemetry and arguably fine; either way, ui-standard should record them as exceptions. No token like `--ds-dur-*` or `--ds-ease-*` exists.
- recommendation: Add `--ds-dur-press: 60ms`, `--ds-dur-fade: 150ms` and `--ds-ease: ease-out`, and make it a uiaudit ratchet (count distinct durations, baseline 11).
- contract: ui-standard §7 bullet 1; design-guide §3 Motion ("ease-out").
- effort: M

##### 21-10 · P2 · Transitions on layout properties
- where: `.rec-fill` width 0.1s (shell 3636); `.an-bar-fill` width 150ms (shell 6986); `@keyframes ann-cin-eyebrow` animates `letter-spacing` 2px→8px (styles 4063); `ann-cin-title` animates `filter: blur(10px)` (styles 4064); `.v-gauge-fill` clip-path (styles 1048)
- what: §7 allows transitions only on transform, opacity, background, border-color and box-shadow. Width and letter-spacing force layout on every frame, and letter-spacing also re-wraps the eyebrow text. The fills sit inside fixed tracks, so the shift audit doesn't catch them, but they still break the rule. Only `.v-gauge-fill` documents why it chose clip-path.
- recommendation: Make the fills `transform: scaleX(var(--p))` with `transform-origin: left`. Replace the letter-spacing entrance with opacity+translate.
- contract: ui-standard §7.
- effort: S

##### 21-11 · P2 · Several keycaps are missing from the reduced-motion hold
- where: shell.css:5662-5678 (hold list), styles.css:1347-1353, predict.css:112
- what: The shell block's own comment says a zero-duration snap is still the motion reduced-motion users opted out of, so it holds pressables flush. Its list covers `.ds-btn/.ds-cta/.ds-tile/.ds-opt/button.ds-key/.ds-menu-btn`. Still missing, and still snapping 1-3px: `.ds-home-link` and `.ds-discord-join` (both on the home page, p0), `.ds-back`, `.ds-dl-opt`, `.ds-dl-seg button`, `.ds-lobby-row`, `.contrib-icon`, `button.bb-cell`, `.chassis-sw`, `.ds-osk-key`, `.adm-copy`, `.ds-tut-btn` and `.ann-cinema-btn`.
- recommendation: One rule: `@media (prefers-reduced-motion: reduce){ :is(button,a,summary,[role=button]):is(:hover,:active){transform:none!important} }`. Delete the three per-file lists.
- contract: CLAUDE.md Gotchas; shell.css:5662 comment.
- effort: S

##### 21-12 · P2 · Hover sticks on touch
- where: every `:hover` rule (67 in shell.css, 16 in styles.css); no `@media (hover: hover)` anywhere in src/ui
- what: On a phone, the last-tapped keycap stays sunk 1px with an accent border until the user taps elsewhere. Mobile is a real audience (MobileControls, 375px captures), and the in-match `.game-btn` and `.overlay-buttons` are tapped mid-game.
- recommendation: Wrap hover transforms and border tints in `@media (hover: hover)` and keep `:active` unconditional. Start with the keycap families.
- contract: DESIGN.md Transform-Only Press intent (the state should show the current interaction).
- effort: M

##### 21-13 · P2 · Blurred glow on the cinematic announcement
- where: styles.css:4052 (`.ann-cinema-btn` `box-shadow: 0 0 30px`), 4055 (hover `0 0 44px`), 3983 (`.ann-cinema-glow` `filter: blur(20px)` radial glow, looping `ann-cin-glow` scale 0.92↔1.06 infinite), 4064 (title blur-in)
- what: DESIGN.md's No-Blur Rule says "nothing in this system uses a soft/blurred shadow". This modal uses three kinds of blur, a hover that lifts instead of sinks, and a slow infinite breathing glow. It also matches the "cyan-glow-on-dark" AI tell in design-guide §3.
- recommendation: Rebuild the CTA as a `.ds-cta` keycap. Drop the glow loop, or make it static.
- contract: DESIGN.md No-Blur Rule; design-guide §3.
- effort: S

##### 21-14 · P2 · Pending buttons change width when their label swaps
- where: e.g. src/ui/Account.tsx:361 (`Delete my account` → `Deleting…`), AccountReset.tsx:97/187, Account.tsx:472, AccountVerify.tsx:80/135, Admin.tsx:457, AdminAnalytics.tsx:478, AdminAudit.tsx:216
- what: The pending state is text-only. `.ds-btn` is `inline-block`, so the button resizes when "Send reset link" becomes "Sending…", and its row neighbours shift. Nothing marks the button as busy (`aria-busy` appears 0 times in src), and there is no shared pending style. List-level loading is consistent (`.ds-loading` at ~25 sites), with one stray: DiscordLobbyList.tsx:116 uses `<p className="ds-hint">Loading…</p>`.
- recommendation: Add `.ds-btn.busy`, which keeps the label box (for example `min-inline-size` from the idle label, or a hidden idle label stacked in a grid) and sets `aria-busy`. Move DiscordLobbyList onto `.ds-loading`.
- contract: ui-standard §1.4 ("loading … states must not change an element's box"); §6 list states.
- effort: M

##### 21-15 · P2 · Custom focus rings are missing on about 15 pressables, and ui-standard misstates why it matters
- where: `.ds-home-link` 1318, `.ds-discord-join` 1205, `.ds-lobby-row` 1262, `.contrib-icon` 4327, `.ds-opt-del` 4180, `.ds-startpos-del`, `.chassis-sw` styles 3387, `.game-btn` styles 1319, `.ann-cinema-btn`, `.ds-foot-link`, `.fr-who/.fr-toggle/.fr-collapse`, `.lb-name/.lb-robot`, `.ds-table tr.ds-clickable` 2459, `.rr-pen-row`, `.ds-lan-leave`
- what: These have `:hover` but no `:focus-visible`. The UA ring is not actually suppressed (the only `outline: none` in src/ui is shell.css:3769, scoped to one input), so these still show the browser's default ring. That keeps them usable, but they look different from the 2px accent ring with 2px offset used everywhere else. ui-standard §1.3 and the comments at predict.css:88 and styles.css:1599 all say "the app suppresses the UA ring app-wide", which is no longer true. `tr.ds-clickable` can only get focus if the TSX sets a tabindex, so check that it is reachable at all.
- recommendation: Add one base rule, `:where(button,a,summary,[tabindex]):focus-visible{outline:2px solid var(--ds-accent);outline-offset:2px}`, and delete about 20 per-class copies. Correct the §1.3 wording.
- contract: ui-standard §1.3.
- effort: S

##### 21-16 · P3 · Nav and segment controls have mixed transitions
- where: `.ds-rail-btn` 699 (0.14s) vs `.ds-subnav-btn` 1419, `.ds-tab` 1463, `.ds-seg` 2166 (no transition)
- what: The rail cross-fades its hover and selection, while the subnav beside it (p2), the tabs, and the home game picker (p0) snap. It is a small difference, but a visible one on one screen.
- recommendation: Give all four `transition: background var(--ds-dur-fade), color …, border-color …`.
- contract: design-guide §4.3.
- effort: S

##### 21-17 · P3 · Overshoot scales in the results and countdown keyframes
- where: styles.css:2451-2476 (`resx-winbanner-in` 0.6→1.08→1, `resx-total-punch` 0.7→1.15→1), 2398 (`resx-sting-in` scale 2.6→1), 1405 (`count-pop` 1.5→1), 4059 (`ann-pop`)
- what: These are bounce-style keyframes, which design-guide §3 lists as a tell. The results screen is the one earned celebratory moment, and reduced motion is handled well there (21-S3), so this is a nit: keep the overshoots to that screen and don't spread them further.
- recommendation: Note in DESIGN.md that overshoot is reserved for the results reveal, so it doesn't spread.
- contract: design-guide §3 Motion.
- effort: S

##### 21-18 · P3 · `.net-spinner` uses legacy tokens and is the only spinner
- where: styles.css:3114-3123 (`border: 3px solid var(--border)`, `border-top-color: var(--amber)`)
- what: The only animated loading indicator uses pre-redesign aliases (`--border`, `--amber`) instead of `--ds-*`. Under reduced motion it freezes after one turn (acceptable). Every other pending state is text. That is not wrong, but the spinner's look belongs to no documented component.
- recommendation: Re-token it to `--ds-hud-line` and `--ds-warn` (or `--ds-accent`), or replace it with the `.ds-loading` text treatment for consistency.
- contract: DESIGN.md tokens; ui-standard §1.2.
- effort: S

#### Strengths (keep)
- **21-S1** The canonical keycap (`.ds-btn`, `.ds-cta`, `.ds-menu-btn`, `.ds-back`, `.ds-dl-opt`, `.ds-key`, `.game-btn`, `.overlay-buttons`, `.sponsor-chip`) is exact and identical across all of them: rest `edge`, hover +1/shadow 2, press +3/shadow 0, 0.06s, transform/box-shadow only. p0 shows the result: the Discord/Instagram/GitHub pills and the menu stack read as one physical keyboard in both themes.
- **21-S2** No layout-shifting press anywhere. `.ds-seg` keeps a constant font weight on purpose (2168), fold chevrons rotate in place, and `.chassis-sw` explains why it uses shadow and not border. The `shiftaudit` discipline shows.
- **21-S3** Reduced motion on the results screen is exemplary (styles.css:2490-2529). JS skips the sequence, every entrance collapses to one 200ms fade, the infinite marquee is switched off rather than sped up, and the comment explains why.
- **21-S4** `.bb-cell:disabled` (4755) is a principled disabled design: dashed edge plus muted ink, with the reason in `title`, and it deliberately avoids an opacity fade. It is the best candidate to generalise (21-06).
- **21-S5** `.ds-chip.on/.off` and `.eventlog-pinned` carry their state through text and fill, not dimming, as DESIGN.md asks.
- **21-S6** List loading is uniform: about 25 sites use `.ds-loading` with specific copy ("Reading the audit log…", "Checking your link…").

### 22 · Cross-game consistency and identity — examined: p0/p7/p8 home + p2/p9 builder (light + dark, desktop + mobile), src/seasons.ts, src/games/module.ts, src/games/{decode,chain,biobuzz}/index.ts slot fills, src/ui/GameView.tsx Hud(), src/games/biobuzz/HudSlots.tsx, src/games/chain/HudSlots.tsx, src/ui/Menu.tsx builder branches, the three start editors, HomeMenu/AppShell season surfaces, Configure/GraphicsSection, styles.css `.view-3d` scrim.

Slot fill matrix (the root of most findings): DECODE fills only `tutorial`. Chain fills `drawRobot` + `hudChips`. BIOBUZZ fills 17 slots, including `scoreBar`, `pinnedNotice`, `presets`, `statTiles`, `startEditor`, `Builder`. So every shared concept exists in up to three implementations: DECODE's inline branch, Chain's inline branch, and BIOBUZZ's slot. They have already drifted.

##### 22-01 · P1 · BIOBUZZ's score bar has lost two timer states the shared bar has: END GAME and MATCH OVER
- where: src/games/biobuzz/HudSlots.tsx:407, 457-463 compared with src/ui/GameView.tsx:932-975
- what: the shared bar has three timer-panel states. `urgent` (≤10 s), `warning` + the "END GAME" label once `timeLeft <= ENDGAME_START` in teleop, and "MATCH OVER" in place of "FINAL" until `hud.resultFinal`. BIOBUZZ's copy of the bar keeps only `urgent`. A BIOBUZZ driver never gets the endgame colour or label. Worse, the bar says FINAL next to a score that can still change while the field settles, which is the exact bug the shared bar's comment (GameView.tsx:968-969) documents fixing.
- evidence: BB `className={\`timer-panel ${urgent ? 'urgent' : ''}\`}` and `PHASE_LABEL[hud.phase]` straight through. The file comment says "The LAYOUT is the shared one on purpose… a driver who plays two games reads the same bar in both." It is the same layout but not the same behaviour.
- recommendation: pull the timer panel out as one shared `<TimerPanel hud>` with urgent, warning, END GAME, MATCH OVER and an optional motif child. Render it from both the shared bar and `BiobuzzScoreBar`. Delete BB's duplicated `PHASE_LABEL`/`fmtTime`.
- contract: CLAUDE.md seam rule ("match phases, HUD chrome… belongs in the shared core"); adding-a-game.md ("If it does, that is a seam bug: generalize the shared file").
- effort: S

##### 22-02 · P1 · The running foul count is a different surface in each of the three games (and Chain has none)
- where: src/ui/GameView.tsx:1216-1221 (`dec &&` FOULS pin); src/games/biobuzz/HudSlots.tsx:337-369 (CONTROL 5+ / PIN only); Chain: nothing
- what: DECODE pins `FOULS n MIN · n MAJ` in the event log. Chain Reaction has a penalty engine (G05/G06) but the FOULS line is gated on `dec`, so a CR driver gets no standing foul count. BIOBUZZ pins its game-specific CONTROL/PIN lines but no MIN/MAJ tally. One concept, three answers. The only one that is actually absent is Chain's, and that comes from the same `!cr` → `dec` narrowing that GameView.tsx:938-947 describes.
- evidence: `{dec && hud.mode === 'match' && (hud.fouls[hud.alliance].minor > 0 …`. `hud.fouls` is a shared HudSnapshot field.
- recommendation: make the FOULS line shared (gate on `hud.mode === 'match'` only, since `hud.fouls` exists for every game). Leave BIOBUZZ's game-specific CONTROL/PIN lines in its `pinnedNotice`, rendered above the shared line.
- contract: CLAUDE.md "if it would be true of any FTC-style game… it belongs in the shared core"
- effort: S

##### 22-03 · P1 · The Graphics section appears in every season, but every row in it is BIOBUZZ-3D-only
- where: src/ui/Configure.tsx:33,119-122; src/ui/GraphicsSection.tsx:27-68,661; p2 (DECODE Configure rail shows "Graphics")
- what: `CONFIGURE_SECTIONS` is static. DECODE and Chain players get a Graphics page of roughly 17 settings (quality, environment, camera, free-cam layout, and so on) that do nothing in their game, and its first row reads "3D: BIOBUZZ only". The shared UI also imports `../games/biobuzz/graphics/*` directly (as do `game.ts:27`, `net/api.ts:14` and `net/practiceRuns.ts:3`). That is a seam leak: a fourth game with 3D would have to edit shared files.
- evidence: `{ v: '3d', t: '3D', d: 'BIOBUZZ only. Press T in a match to switch' }`. The Perf overlay row was already moved out (GraphicsSection.tsx:912), so nothing game-agnostic is left in the section.
- recommendation: show the `graphics` sub-nav entry only when `moduleFor(settings.game).scene` exists, and keep the route resolving (redirect to `robot`) for bookmarked links. Longer term, add a `GameModule.Graphics?` slot and move the section under `src/games/biobuzz/`.
- contract: adding-a-game.md "Nothing outside `src/games/<id>/` should need editing"; seam rule (a thing that names one game belongs to that game)
- effort: S (hide) / M (slot)

##### 22-04 · P1 · The season's official "presented by" never appears; the footer reads as OFFSET presenting the game
- where: src/ui/AppShell.tsx:184-188; p0/p8 footer "DSIM · BIOBUZZ 2026-27 PRESENTED BY [OFFSET]"; src/seasons.ts:81,90,100 (`presenter`)
- what: `Season.presenter` (RTX, goBILDA) is read only by `seo.ts`. No UI surface names it. The footer puts the season name and years directly before the app sponsor's "PRESENTED BY OFFSET" mark, so it parses as "BIOBUZZ 2026-27 presented by OFFSET". sponsor.ts:4 and HomeMenu.tsx:95-97 both say the two sponsors "must never be" confused. The layout confuses them anyway.
- evidence: the p0 and p8 footer screenshots, where the season name and "PRESENTED BY" sit on one baseline.
- recommendation: separate the two in the footer: `DSIM · presented by OFFSET` as the brand credit, with `BIOBUZZ presented by RTX · FTC 2026–27` as its own span or line (`fullNameOf` already exists). Also see 22-05.
- contract: sponsor.ts header rule; CLAUDE.md brand rule (app and season kept separate)
- effort: S

##### 22-05 · P1 · Switching seasons on home changes one pill and one header word; the season has no identity at the point of choice
- where: src/ui/HomeMenu.tsx:100-114; p0 vs p8 (pixel-identical apart from the active pill and the header/footer text)
- what: the brand rule correctly keeps DSIM as the product. But the season registry carries `blurb`, `program`, `years` and `presenter`, and home renders none of them. A first-time visitor cannot tell what BIOBUZZ is, which season is the current FTC one, or that Chain Reaction is an unofficial CAD-competition game. That last fact arrives only as a blocking modal after the click (22-06). Chrome identity per season is not wanted (DESIGN.md: one accent, alliance colours reserved). A single line of season copy is wanted, and it breaks no rule.
- evidence: `rg "\.blurb"` in src finds only seo.ts:170. `program` and `years` appear only in the footer (years).
- recommendation: under the switcher, render one muted line from the registry: `{fullNameOf(s)} · {s.program} {s.years}`, plus `s.blurb` as a second line if it fits. No per-season colour, logo or theme; the field art is the season's identity and it already differs strongly.
- contract: CLAUDE.md brand rule; DESIGN.md single-accent rule (this recommendation stays within both)
- effort: S

##### 22-06 · P2 · Chain Reaction greets a season switch with a blocking modal; the other seasons get nothing
- where: src/ui/App.tsx:574-577, 1893-1920; p7-desktop (light and dark: the modal covers home on the first switch)
- what: the only season-specific content on home is a one-time "not realistic" overlay that fires from a `useEffect` on `settings.game`, including on the home screen itself, before the player has done anything. BIOBUZZ is also an approximation (2D or 3D physics) and gets no equivalent. The copy disagrees with the registry: seasons.ts:93 still says "a new shooter (rules to come)", and CLAUDE.md lists the game as "complete and scored". That stale blurb is the meta description on every `/chain` page.
- evidence: `setShowChainDisclaimer(settings.game === 'chain' && !chainDisclaimerSeen())`
- recommendation: fold the disclaimer into the season line from 22-05 (for example "Unofficial · approximate, for fun"), or show it on the first Play press instead of on switch. Fix the Chain `blurb`.
- contract: design-guide §3 (interrupting modal for non-blocking info); seasons.ts is the SEO source of truth (its own comment)
- effort: S

##### 22-07 · P2 · The season switcher only exists on home; the header season label looks like a control and is not one
- where: src/ui/AppShell.tsx:112-119 ("Plain text, not a control: the game is switched on the home page"); src/ui/HomeMenu.tsx:100
- what: from Configure, Records or Modes, changing game means going Home first. The header `DSIM · DECODE` sits exactly where a context switcher conventionally lives (next to the brand, on every screen) but is inert text. On home the switcher is 13px segmented pills below the sponsor lockup, lighter than the social buttons beneath it (p0, p8-mobile). It is `role="tablist"` with no tabpanel, so it announces as tabs but acts as a global context change.
- evidence: p2/p9 headers; HomeMenu.tsx:101-111
- recommendation: make `.ds-bar-season` a small menu button listing `visibleGames()`, calling the same `onGame` + `pathFor` logic App.tsx:1848 uses and keeping the current route. Drop `role="tab"` in favour of `aria-pressed` buttons (a radio group) on home.
- contract: docs/area/ui.md shell nav; WAI-ARIA tabs pattern
- effort: M

##### 22-08 · P2 · The "real robot" marker means different things per season, and DECODE and Chain lose it
- where: src/ui/Menu.tsx:552,803-805; src/ui/shell.css:4162; src/games/biobuzz/presets.ts:130; src/games/chain/config.ts:1162; p9 (StarterBot card with an inset accent stripe) compared with p2 (none)
- what: `realPresets` is read only from the `presets` slot, so only BIOBUZZ marks cards. Chain declares `CHAIN_REAL_PRESETS = 5` (five real team robots), but it does not fill the slot, so they are unmarked. All five DECODE presets are real teams (TW 19745, Dugtrio 6417…) and none is marked. BIOBUZZ marks a kit StarterBot as "real". Nothing explains the unlabelled 3px stripe, and on p9 it reads as a half-selection next to the CUSTOM badge.
- evidence: `const realPresets = gamePresets?.realCount ?? 0;`
- recommendation: either give it a legible label (a "Real team" / "Kit" tag in `.oz`) and feed it for all three seasons (`CHAIN_REAL_PRESETS`, and all of `ROBOT_PRESETS.length`), or delete the marker. An unlabelled stripe on one season out of three is noise.
- contract: DESIGN.md (state carried by labelled chips, not bare colour); cross-season consistency
- effort: S

##### 22-09 · P2 · The builder hero preview is a different medium in DECODE (dark canvas and pixel-mono caption) than in Chain and BIOBUZZ (themed SVG)
- where: src/ui/RobotPreview.tsx:80 (`COLORS.mat` canvas fill) compared with src/games/chain/RobotPreview.tsx:93-116 and src/games/biobuzz/RobotPreview.tsx:123-145 (`var(--ds-*)` SVG); p2-light compared with p9-light
- what: in light theme the DECODE hero sprite is a black tile with a bitmap-font dimension caption. Chain and BIOBUZZ draw on the themed panel with sans captions. The same hero slot looks like two different products depending on season.
- evidence: the p2 and p9 desktop screenshots in light theme, side by side.
- recommendation: redraw DECODE's schematic onto the themed ground (tokens `--ds-bg`/`--ds-ink-dim`/`--ds-accent`, as the other two do) and set the caption in the UI font. The field mat colour belongs to the canvas zone, not to a builder chip.
- contract: DESIGN.md Three-Zone Rule (canvas-only colours are for the game canvas, not builder chrome)
- effort: M

##### 22-10 · P2 · In a 3D view the event log is the one HUD card that does not get the dark scrim
- where: src/ui/styles.css:212-237 (scrim scoped to `[data-hud-band]`, `.status-wrap` and `.net-corner`); styles.css:1433-1440 (`.eventlog-line` comment: "the log sits in the left letterbox")
- what: in 2D the log sits in the themed letterbox. In 3D the scene fills the whole viewport, so there is no letterbox and the log sits on the lit field. In light theme every other HUD card turns dark while the log (including BIOBUZZ's PIN / CONTROL 5+ pinned lines, the calls to action) stays a white card. The same chrome renders two ways in one frame, and only in the game that has 3D.
- evidence: the comment at styles.css:217 excludes "the event log" explicitly; the comment at 1435 assumes a letterbox that 3D does not have.
- recommendation: add `.game-root.view-3d .eventlog` to the scrim selector list. It carries no band, so it does not move the camera fit.
- contract: CLAUDE.md theming category 3 ("its ground is the CANVAS ⇒ does NOT invert")
- effort: S

##### 22-11 · P2 · Chain's HUD prints the same facts twice, in two notations
- where: src/ui/GameView.tsx:1022-1031 (breakdown row) and 1145-1149 (`.park-status`); src/games/chain/HudSlots.tsx:36-45
- what: MULT is shown as `MULT ×2` in the breakdown row and as a `2x` badge in the chip card. CATALYSTS `n/4` appears as text and as four pips. ASCENDED/PARKED appears in the breakdown row and again as its own card. DECODE's row shows counts that no other HUD element duplicates, and BIOBUZZ's row shows only facts drawn nowhere else (its own comment, HudSlots.tsx:437-441). Chain is the outlier.
- evidence: `<span>MULT ×{hud.chain.mult}</span>` compared with `{chain.mult}x`
- recommendation: drop MULT, CATALYSTS and ASCENDED/PARKED from Chain's breakdown row (keep PARTICLES) and use `×` in the badge. The HUD-RELOCATION pass already gave each chip one home.
- contract: HUD-RELOCATION rule ("names a destination per chip"), cited at GameView.tsx:1091-1106
- effort: S

##### 22-12 · P2 · DECODE's HUD card is the only one of the three with no spoken label
- where: src/ui/GameView.tsx:1060-1064 compared with src/games/chain/HudSlots.tsx:38 and src/games/biobuzz/HudSlots.tsx:260
- what: Chain and BIOBUZZ put `role="img"` + `aria-label` + `title` on their hopper/pip columns ("Storage 3 of 5"). DECODE's `.hopper.vertical` is three bare spans. Hover gives nothing and a screen reader gets nothing.
- evidence: `<div className="hopper vertical">{[0,1,2].map(… <span className={\`hopper-pip …\`} />)}`
- recommendation: add the same `role="img" aria-label={\`Hopper: …\`}` idiom the other two use.
- contract: design-guide a11y basics; consistency with the sibling slots
- effort: S

##### 22-13 · P2 · Only DECODE's pre-match overlay tells the driver anything about the game
- where: src/ui/GameView.tsx:783-822
- what: DECODE shows the MOTIF under "RED ALLIANCE". Chain and BIOBUZZ show only the alliance and a key hint. There is no slot for this, so a season cannot put its one pre-match fact there (BIOBUZZ's start role TOP/BOTTOM, say, or CR's Lab corner).
- evidence: `{hud.game === 'decode' && (<p>MOTIF …`. That is a name-the-game branch in shared UI.
- recommendation: add a small `preMatchLine?: ComponentType<GameHudProps>` slot and move the motif into DECODE's module (it has none of its own today). BIOBUZZ and Chain can fill it or not.
- contract: adding-a-game.md slot pattern
- effort: S

##### 22-14 · P3 · Three near-identical start editors (~1,230 lines) with byte-identical markup
- where: src/ui/StartPositionEditor.tsx (397), src/ui/ChainStartEditor.tsx (473), src/games/biobuzz/StartEditor.tsx (357)
- what: all three render the same `ds-startpos-*` class tree, the same "Snap to legal", "＋ Save", "Heading°" and "(far +)/(right +)" copy. They differ only in field bounds, anchor list and role labels (CLOSE/FAR, Chain's `chainRoleLabel`, BB's alliance-relative TOP/BOTTOM). They are consistent today by copy-paste, so a label or a11y fix has to land three times.
- evidence: the class inventory from rg is identical across the three files.
- recommendation: one shared `<StartEditorShell>` taking `{bounds, anchors, roleLabel, drawField}`, with the three becoming thin configs. Do it the next time any of the three needs a UI change, not as a standalone refactor.
- contract: adding-a-game.md "generalize the shared file"
- effort: M

##### 22-15 · P3 · Chain Reaction has no tutorial, so its Modes and Controls pages are missing a section the other two have
- where: src/games/chain/index.ts (no `tutorial`); App.tsx:1890; Configure.tsx:86
- what: this is handled correctly (the section hides rather than disabling). The effect is that Chain's Play page has a different shape. That is acceptable, but it is the one structural difference a player moving between seasons will notice in menus.
- recommendation: none required. If Chain gets a tutorial later, reuse the DECODE step shapes.
- contract: n/a
- effort: M

##### 22-16 · P3 · The BIOBUZZ 3D robot renderer hardcodes the alliance red instead of reading `COLORS.red`
- where: src/games/biobuzz/scene/renderRobots.ts:206 (`const RED = '#ef4444'`)
- what: every other canvas renderer (DECODE, Chain, BB 2D) reads `COLORS.red/blue`. If the alliance hue is ever retuned, 3D BIOBUZZ robots drift from the 2D view of the same match.
- recommendation: import from `src/config.ts` COLORS.
- contract: DESIGN.md alliance colours are fixed, single-source
- effort: S

#### Strengths (keep)
- **One shell, genuinely.** The header, rail, Configure sub-nav, home menu, footer and every panel are identical across the three seasons in both themes (p0/p7/p8, p2/p9). The brand rule holds: DSIM stays the product and the season is a word beside it (`.ds-bar-season`, AppShell.tsx:112-119).
- **Per-season loadouts.** `switchGame` (settings.ts:203) archives and restores the robot, saved robots, starts and assists per game, so switching never bleeds a DECODE build into BIOBUZZ.
- **The slot seam works where it is used.** `statTiles`, `presets` and `labels.configSummary` exist because the two-valued `else` branches were leaking Chain labels into BIOBUZZ. Those fixes are real and documented in module.ts.
- **The `data-hud-band` + token-redefinition scrim** gives every banded HUD cluster, including a game's own `scoreBar`, correct 3D contrast without per-component overrides (styles.css:212-237).
- **The shared bar classes are reused by BIOBUZZ** (`scorebar`/`score-panel`/`timer-panel`), so it themes identically. Only the behaviour drifted (22-01).
- **Controls scope "All games" + per-game overrides** with per-row sync buttons (ControlsSection.tsx:414-466) is the right model for shared plus season-specific bindings.


## 7. Resolution (2026-09-23)

Every one of the 471 IDs is resolved: **fixed** (file:line) or **closed** (with a reason: false positive, duplicate of a cluster, stale, or by owner decision). Commits on `alpha`: W1 `5f814ea`, W2 `916c726`, W3 `293a019`, W4 `318237a`, W5 `9b9a0fc`, W6 `28543e8`, W7 `8104901`, W7x+W8 `17d8149` (gap wave and contract docs). The upstream merge `4469a55` sits between W5 and W6.

Owner decisions: docs follow code (pill keycaps, ALL-CAPS mono panel titles, the 14/18/22 rhythm are sanctioned; C24/C27/C40/G1–G3 closed by amending DESIGN.md and ui-standard); pinch-zoom lock removed (C20); no "Season" rename, only ELO→rating and one custom-room name (C52). Defaults applied: G4 No-Blur covers chrome only; G5 ghosted assists kept, opacity off the label; G8 dialog-title rule extends to `.ds-modal`; G9 career tiles hidden when empty; G10 Space Grotesk kept; G11 one muted season line; C44 owner radius edit kept.

Stale reference: the 07-25 evidence (§6, CareerPanel `lb-you-tag`) names a class removed in W4c; the YOU chip is `.ds-badge` now.

### 7.1 Fix ledger, by wave

#### W1 · commit 5f814ea
C01 (03-01 04-01 15-03 16-01 18-03) · fixed · src/ui/shell.css:4538
C03 (05-03 17-05 21-01) · fixed · src/ui/shell.css:5680
C23 (02-07 14-01 16-02) · fixed · src/ui/shell.css:~5806-5940; scripts/uiaudit.mjs font-inherit-mix (baseline 0)
C41 (14-02 14-03) · fixed · src/ui/shell.css:1913
C68 (18-06) · fixed · src/ui/shell.css:3686
C20 (18-01) · fixed · index.html:7
C59 (10-02) · fixed · src/net/api.ts:1542; src/ui/Admin.tsx records game picker
C10 (07-01) · fixed · src/ui/Leaderboard.tsx:509-525
C60 (11-02) · fixed · src/ui/AppShell.tsx FootLink; public/sitemap.xml
C62 (11-07 17-07) · fixed · src/ui/useEscape.ts:18; src/ui/Announcements.tsx:100
C38 (05-07 22-01) · fixed · src/ui/timerPanel.ts; src/games/biobuzz/HudSlots.tsx; src/ui/GameView.tsx
C67 (22-03) · fixed · src/ui/Configure.tsx:~88-94
C44 (13-05) · closed(owner's own radius edit in 4a1d7ee kept; index regenerated) · docs/ui-components.md
fr-error dup · closed(base-group + colour override is the intended shape; duplicate-selector count 0)

#### W2
08-01 · fixed · src/ui/TermsGate.tsx:43 GateDialog (TermsGate:147, UsernameGate:100)
17-08 (AuthPanel) · fixed · src/ui/AuthPanel.tsx:186
08-07 · fixed · AuthPanel.tsx:195, UsernameGate.tsx:102, TermsGate.tsx:149
08-11 · fixed · UsernameField.tsx:84/126, AuthPanel.tsx:240-250, UsernameGate.tsx:112-122, AccountReset.tsx:92-97/173-198, ProfileName.tsx:147-163
17-04 · fixed · AuthPanel.tsx:218/298, TermsGate.tsx:161, UsernameGate.tsx:118
17-03 · fixed · AuthPanel.tsx:213/235/255/263, UsernameField.tsx:126
08-06 · fixed · src/ui/Account.tsx:94-100
08-18 · fixed · src/ui/AuthPanel.tsx:182
06-03 · fixed · src/ui/Results.tsx ~1066/1083; ReportDialog.tsx ~40-55; ScoreReportDialog.tsx ~33-46
17-08 (Results) · fixed · src/ui/Results.tsx ~912/~1283
06-02 · fixed · src/ui/ReportDialog.tsx ~76-107
09-01 · fixed · src/ui/PracticeReplays.tsx:205-222; LanReplays.tsx:179-196
09-02 · fixed · src/ui/ReplayView.tsx:1494-1495
09-10 · fixed · src/ui/ReplayView.tsx export disclosure ~581-586
06-19 · fixed · src/ui/Results.tsx:566/~921
09-15 · fixed · src/ui/ReplayView.tsx ~1181; ReplayRail.tsx:83/192/230/328/346
09-24 · fixed · ReplayView.tsx, PracticeReplays.tsx:202, LanReplays.tsx, ShareButton.tsx, Results.tsx
09-25 · fixed · src/ui/ShareButton.tsx; shell.css .ds-share ~2619
17-02 · fixed · src/ui/PerfHud.tsx:117; QueueBar.tsx:72/85
11-06 · fixed · src/ui/ServerNoticeBanner.tsx:43-57
17-09 · fixed · src/ui/friendsContext.tsx:298-305, 340-360
08-09 · fixed · src/ui/friendsContext.tsx:64-73; FriendsPanel.tsx:686/689; ProfileFriendActions.tsx:68/71/109
10-01 · fixed · src/ui/AdminLive.tsx:433-446; Admin.tsx ~536
10-04 · fixed · src/ui/Admin.tsx ~266-290/300/351; AdminStanding.tsx:131
10-11 · fixed · Admin.tsx:370/507; AdminUser.tsx:263; AdminLive.tsx:461
10-19 · fixed · src/ui/AdminUser.tsx ~355-370
10-20 · fixed · src/ui/AdminUser.tsx ~396-404
17-19 · fixed · src/ui/PerfHud.tsx ~121-126
02-15 · fixed · src/ui/Matchmaking.tsx:1161
02-16 · fixed · Matchmaking.tsx:1129; Lobby.tsx:781/788/1004/1076/1083/1185; LanPanel.tsx:484/491
C19 (admin part, 14-11) · fixed · src/ui/AdminAnalytics.tsx:352-790 panel titles h2/h3; AdminReports.tsx:239/272/275 h3
17-01 · fixed · src/ui/App.tsx:424 OverlayDialog (~1925+); GameView.tsx:171 MatchOverlay
17-08 (shell) · fixed · Announcements.tsx:66/110; ChallengePicker.tsx:71; RewardDialog.tsx:126
06-04 · closed(visual convergence .overlay-panel vs .ds-modal → W4) · styles.css:1495
16-07 · closed(visual convergence → W4) · styles.css:1495
06-05 · fixed · src/ui/styles.css:1563; shell.css:7720 .rw-h
19-06 · fixed · src/ui/App.tsx:1956
17-06 · fixed · GameView.tsx:155 MotifDots, :1142; styles.css:546/844
17-14 · fixed · src/ui/GameView.tsx:983/996
17-22 · fixed · src/ui/GameView.tsx:768
03-02 · fixed · src/ui/Menu.tsx (11 pickers, aria-pressed); src/games/biobuzz/Builder.tsx:394-528
02-09 · fixed · src/ui/MatchSetup.tsx:335 .ds-opt-slot
03-03 · fixed · src/ui/Menu.tsx:735; shell.css:4216-4260
01-08 · fixed · src/ui/HomeMenu.tsx:103
01-09 · fixed · src/ui/ProfileMenu.tsx:52/88
03-19 · fixed · src/games/biobuzz/Builder.tsx:212-277; Menu.tsx:1192-1248
17-12 · fixed · src/games/biobuzz/Builder.tsx:129/263
17-21 · fixed · src/games/biobuzz/Builder.tsx:551+; Menu.tsx sliders
04-17 · fixed · src/ui/Select.tsx:78
17-13 · fixed · src/ui/Select.tsx:104
C19 (builder part) · fixed · Menu.tsx:720/870/1427/1443; MatchSetup.tsx:197
07-03 · fixed · src/ui/Leaderboard.tsx:363/400
07-12 · fixed · src/ui/Leaderboard.tsx:494
07-02 · fixed · src/ui/MatchHistory.tsx:214
07-10 · fixed · src/ui/MatchHistory.tsx:103; shell.css:2574 .mh-al
11-01 · fixed · src/ui/markdown.tsx:137 baseLevel; Legal.tsx:35
14-11 · fixed · AudioSection:134/212, GraphicsSection:651-876, NetworkSection:42, ControlsSection:526/655/667/683, MatchHistory:211
04-06 · closed(owner decision: ALL-CAPS mono panel titles stay; heading tags fixed under 14-11)
04-03 · fixed · src/ui/ControlsSection.tsx:732/749
04-11 · fixed · src/input/bindings.ts:1229/1245; ControlsSection.tsx:406
04-13 · fixed · src/ui/ControlsSection.tsx:640
04-16 · fixed · src/ui/Configure.tsx:109
04-19 · fixed · src/ui/ControlsSection.tsx:157
01-10 · fixed · src/ui/shell.css:1637-1639
07-19 · fixed · src/ui/shell.css:1640-1642
11-24 · fixed · src/ui/Sponsor.tsx:52/225
12-14 · fixed · src/ui/TutorialCard.tsx:59
W2 skeptic fixes · useDialog document listener + body-focus recovery + Shift+Tab from container; What's-new autoFocus Got it; toast pause re-arm; Results stage tabIndex -1; [role=dialog][tabindex=-1]:focus outline none

#### W3
06-01 · fixed · src/ui/styles.css ~2412 resx-linkbtn focus
08-02 · fixed · src/ui/shell.css ~1650 ring block; Account.tsx:414
02-08 · fixed · shell.css ring block (.ds-lobby-row, button.ds-chip); styles.css .ds-lan-url
08-03 · fixed · shell.css .ds-username-input
15-02 · fixed · shell.css .ds-menu-btn.primary .mh
04-04 · fixed · shell.css .ds-rail-btn.on
15-06 · fixed · shell.css .ds-tile.primary
15-07 · fixed · shell.css ~720 selected-state vocabulary comment
16-06 · fixed · shell.css .ds-tile.primary (segmented stays solid by two-idiom rule)
21-05 · fixed · rail/subnav unified; dead .ds-key.on/.selected removed
01-16 · fixed · shell.css .ds-home-title
03-20 · fixed · shell.css .ds-input/.ds-username-input
04-08 · fixed · shell.css .ds-field .val; OptRow.tsx:81
04-18 · fixed · AudioSection.tsx:34; shell.css .val.muted
08-12 · fixed · UsernameField.tsx:88 usernameHintClass; AuthPanel/UsernameGate/ProfileName no inline styles
14-20 · fixed · shell.css .ds-head .ds-mark override deleted
15-11 · fixed · StartPositionEditor.tsx:148/170; ChainStartEditor.tsx:189/217
05-02 15-01 11-05 · fixed · src/ui/styles.css .server-notice (.urgent → --ds-red-chip/-ink, --ds-block)
05-01 12-01 · fixed · src/ui/styles.css ~229 3D scrim redefines status inks
12-03 13-01 · fixed · src/ui/predict.css themed HUD card, tokenised
05-04 18-08 · fixed · src/ui/styles.css .mobile-joystick*, .mobile-btn.auto
05-08 · fixed · src/ui/styles.css .score-panel chip tokens
09-08 · fixed · src/ui/replayOverlay.ts ~66
15-05 · fixed(partial: CSS gradients, renderRobots) · remainder config.ts COLORS vs --ds-red/blue → closed(canvas palette is category 3, deliberately separate from themed chips; unify is a render change outside design scope)
05-17 · fixed · src/ui/GameView.tsx ~1196/1207
12-19 · fixed · src/ui/tutorial.css:76/84
12-21 · fixed · src/ui/predict.css
13-10 · fixed · src/ui/shell.css ~205 --ds-on-field-accent-ink
13-15 · fixed(predict part); styles.css:35/111/128 → W3d typography pass
18-13 · fixed · styles.css joystick label
21-18 · closed(already re-tokened) · styles.css .net-spinner
22-16 · fixed · renderRobots.ts:207
22-10 · fixed · styles.css scrim selector .eventlog
06-12 · fixed · shell.css:7431 award stroke, :172 --ds-award
15-08 · fixed · shell.css:144 three reward hues
06-10 · fixed · styles.css:2080 resx-winbanner.gold podium
15-10 · fixed · shell.css:172; AwardBadge.tsx:13
06-09 · fixed · shell.css:7431-7509; styles.css .sup-badge.sup-sm
06-08 15-09 · fixed · styles.css:3606/3613 --ds-staff
13-08 · fixed · shell.css dead tokens + contrast pairs removed
13-09 · fixed · styles.css 52 bridge uses; shell.css bridge cut
13-11 · fixed · uiaudit raw-colour ratchet; --ds-scrim tokens
15-16 · fixed · shell.css:314 dark --ds-ok-ink #7bd35a
15-13 · fixed · shell.css .ds-hero/.ds-dl-hero/.ds-console flat
16-22 · fixed · shell.css:3748/3758/4286
18-20 · fixed · src/theme.ts:52
20-14 · fixed · contrast pair + tutorial.css (gate)
07-18 · fixed · shell.css .mh-type.custom
10-08 · fixed · styles.css:3360 adm-pill variants; AdminLive/AdminUser/AdminReports
10-14 · fixed · adminCharts.tsx:334; shell.css viz tokens
10-16 · fixed · styles.css admin block tokenised
10-17 · fixed · Admin.tsx:619
W3 follow-ups (orchestrator) · fixed · styles.css:1526/2593/3175 scrim tokens, :254 ok-ink #7bd35a; predict/tutorial --text/--muted → --ds-*; shell.css bridge block deleted; tutorial.css .ds-tut-offer-sub ink-dim
06-17 · fixed · shell.css:6590
09-16 · fixed · shell.css:2893-2910, 3535-3610, 3712
11-11 · fixed · styles.css:3955-4040
14-22 · fixed · styles.css:4010
11-21 · fixed · styles.css:104
11-23 · fixed · styles.css:126, 3897
13-15 · fixed · styles.css:35/111/128
14-12 · fixed · shell.css:98 lh tokens; uiaudit literal-line-height rule
14-16 10-09 · fixed · shell.css:5003 .ds-num
14-19 · fixed · shell.css:104-105 tracking tokens
13-14 · fixed · shell.css:221/233 comments; smoke.ts:25476 backdrop assertion (editor hex copies → W4)
14-06 14-07 14-08 05-10 (C42) · fixed · shell.css:90-95 --ds-t-control/h1/h2; 10px→--ds-t-xs; ui-standard §3

#### W4
09-05 · fixed · ReplayView.tsx:1466, shell.css:3057
09-09 (C57) · fixed · ReplayView.tsx:1207/1249/1277, shell.css:3657 (.ds-dl-seg deleted)
11-04 · fixed · styles.css:3240 (maint+lan one anatomy); server notice closed(by design, global overlay)
11-08 · fixed · DesktopUpdate.tsx:56 ToggleRow
11-14 · fixed · MaintenanceBanner.tsx:66
09-18 · fixed · WatchLive.tsx:158-167
09-21 · fixed · ReplayView.tsx:200, ~1480
16-10 · fixed · StartPositionEditor.tsx:323, ChainStartEditor.tsx:400, shell.css:5946
10-03 · fixed · Admin.tsx:687, AdminStanding.tsx, AdminUser.tsx:411
10-06 · fixed · Admin*.tsx ds-input/ds-select + aria-labels; styles.css admin field rules layout-only
10-12 · fixed · adminBits.tsx:274 ListState; adminCopy.ts ADMIN_FAIL_WHY
10-13 · fixed · Admin.tsx:726, AdminReports.tsx:435
21-14 (admin) · fixed · Admin.tsx:489, AdminAudit.tsx:215, AdminAnalytics.tsx:484
05-09 06-07 (C47) · fixed · styles.css:1415/~1830, GameView.tsx:791, Results.tsx:614-622
06-06 06-11 (C48) · fixed · Results.tsx:645 primaryAction, styles.css:1805-1835
05-15 · fixed · styles.css:2977, GameView.tsx:~713
05-16 · fixed · styles.css:1371-1410, predict.css:77
06-14 · fixed · styles.css:~2440/2566-2585, Results.tsx:~111
06-15 · fixed · RewardDialog.tsx:148-175, shell.css:7695-7735
06-20 · fixed · shell.css:7502-7536
06-23 · fixed · Results.tsx:162, styles.css:1758
12-04 · fixed · tutorial.css:105-160 (TutorialCard className swap → W4b)
01-14 · closed(already fixed in W3) · shell.css:720
01-19 · fixed · shell.css:1707, styles.css:1573
01-22 · fixed · NavRail.tsx:38
02-13 · fixed · shell.css:5735/5816
02-19 · fixed · DiscordLobbyList.tsx:78/117, shell.css:1272
07-13 · fixed · shell.css:2936
07-16 · fixed · Leaderboard.tsx:354, MatchHistory.tsx:210, shell.css:2589
07-20 · fixed · shell.css:2644/2761
08-13 · fixed · shell.css:2101, ProfileName.tsx:95
08-17 · fixed · shell.css:3777/3787 (AuthPanel ✕ → W4b)
08-21 · fixed · LinkedAccounts.tsx:89, shell.css:2033
21-14 · fixed · shell.css:1639 .ds-btn.busy; Account/AccountReset/AccountVerify/ProfileName/TermsGate/LinkedAccounts
06-04 16-07 · fixed · styles.css:1573, shell.css:3787 (surface convergence)
02-08 · fixed · shell.css:6368 queuechip :active
followups dialog-actions/ChallengePicker · fixed · shell.css:5856, TermsGate.tsx:166, App.tsx:1964, ChallengePicker.tsx:124
04-02 (C46) · fixed · ControlsSection.tsx:402/616/676
04-10 · fixed · GraphicsSection.tsx:205/376/592, shell.css:4391
04-12 · fixed(pad-only removal needs remove-mode design; noted) · ControlsSection.tsx:260/514/538, shell.css:5726
03-13 · closed(fixed in W3 293a019) · shell.css:~4718
03-16 · fixed · shell.css:4958-5012, Menu.tsx:209
21-07 · fixed · shell.css:1869/4368
20-09 · fixed(partial: .ds-opt keeps edge as a pressable, by design) · Menu.tsx:807, shell.css:5411
15-07 (builder part) · fixed · shell.css:4532/5048
followups bb-cell.on / comment / Save reason · fixed · shell.css:4921/4930, Menu.tsx:586/892
16-03 16-05 21-02 21-03 21-04 21-06 (C45) · fixed · shell.css ~1600 KEYCAP block, ~95 --ds-disabled-opacity; ghost→secondary TSX renames
12-04 · fixed · TutorialCard.tsx → .game-btn; .ds-tut-btn deleted
01-05 13-04 20-01 (C26) · fixed · shell.css:491, styles.css ~3915-4010; canvas controls exempt (G4)
18-11 21-12 · fixed · @media (hover:hover) on all keycap/card hovers
01-17 21-09 21-16 · fixed · --ds-dur-press/-fade/--ds-ease; uiaudit literal-duration
21-15 · fixed · shell.css ~1714 base focus ring; ui-standard §1.3
21-10 21-11 17-18 11-15 · fixed · shell.css ~3735/~5870, styles.css ~2217
13-12 · fixed(partial: .ds-* moved + ds-outside-shell ratchet; adm-/lb- → W4c) · shell.css end
16-08 · fixed(partial: inks; chip merge → W4c)
16-09 16-12 · deferred → W4c (TSX migrations)
20-05 · fixed(.ds-opt.real → W6 C51) · shell.css ~1130/~7956
20-06 · closed(already flat since W3)
15-07 remainder · fixed · .ds-osk-key.on
W4 skeptic fixes · fixed · biobuzz/StartEditor.tsx:282 (ds-segs); ReplayView onLostPointerCapture + scrub reset; Leaderboard standing hidden while refetching; App.tsx Profile key; ControlsSection hint

#### W4c / W5
13-12 (2nd half) · fixed · shell.css:8383-8776 ADMIN CONSOLE section; ds-outside-shell 4→2
16-13 · fixed · Admin.tsx:437, AdminLive.tsx:344, AdminAudit.tsx:147, shell.css:8467
16-09 · fixed(partial) · shell.css:8347 .ds-badge; adm-pill/ann-badge/fr-badge migrated; remaining one-offs → W6 sweep
16-12 · fixed(partial) · LanPanel/ProfileName/RecordRun/Gallery → ds-panel ds-panel-body stack; Lobby/Matchmaking → W5a follow-up
16-08 · closed(HUD .chip is a category-3 on-field component with its own state set)
02-01 · fixed(gutter + order; ConsoleHead extraction → post-W5 follow-up) · shell.css:4106
02-02 18-07 · fixed · shell.css:4106
02-10 · fixed · shell.css:5468
18-04 01-07 (C34) · fixed · shell.css:5488-5540, NavRail.tsx:38
04-05 · fixed · shell.css:1388/5537
03-04 18-05 (C35) · fixed · shell.css:5214 + 640px block
12-02 · fixed · tutorial.css:114/170
11-03 18-09 18-02 (C22) · fixed · shell.css:5616-5626, 7037
02-11 · fixed · shell.css:1853
02-23 · fixed · shell.css:4089
11-13 · fixed · Download.tsx:114, shell.css:6028
11-19 · fixed · AppShell.tsx:192, shell.css:1475
11-20 · fixed · shell.css:1496/5597
18-19 · fixed · FriendsPanel.tsx:68
05-05 05-06 (C55) · fixed · GameView.tsx:1041/1129, styles.css:809/3030/3067, HudSlots titles removed
07-05 · fixed · shell.css:2685, MatchHistory.tsx:295
07-06 · fixed · CareerPanel.tsx:39
07-07 · closed(G9 keeps tiles; empty half done in 07-06)
07-08 · fixed · CareerView.tsx:103, shell.css:2252
07-09 · closed(taste/IA change per verify-C; owner call)
07-11 · fixed · Leaderboard.tsx:451
07-17 18-14 · fixed · shell.css:2619/2646 .ds-table-scroll(.tall)
04-09 · fixed · ControlsSection.tsx:636, shell.css:5777
04-15 · fixed · shell.css:5800
06-16 · fixed · RecordRun.tsx:217/230, ReportDialog/ScoreReportDialog
08-15 · fixed · Account.tsx:94/419, shell.css:2139
09-14 · fixed · shell.css:3093, ReplayView.tsx:1197
09-19 · fixed(partial: badges need LiveRoom.players server field) · WatchLive.tsx:94
09-22 · fixed · PracticeReplays.tsx:154
18-15 · fixed · ControlsSection.tsx:771
18-18 · fixed · styles.css:2005
20-08 · closed(stale after 18-05) · shell.css:1827
W5-skeptic · fixed · landscape status-wrap max-width minus view cap (styles.css landscape block); status-row data-hud-band fine-pointer only (GameView.tsx); landscape .sub-hud nowrap; coarse sponsor tap moved after base rule (shell.css); .ds-fold-body.ds-acct-id; .ds-table-scroll.tall (Leaderboard, MatchHistory) + pinned td.sc hover; .adm-table dense (16-13 now real); Download.tsx label-format comment
06-13 · fixed · Results.tsx:921-931,1028; styles.css:1848,2413,2464 (.resx-outcome "You won/lost by N", local player only)
W6-badge .lb-you-tag · fixed · Leaderboard.tsx:496 ds-badge accent; shell.css rule deleted
W6-badge .lb-standing-badge · closed(not a badge: the placing-state "?" rank glyph) · Leaderboard.tsx:218
01-01 · fixed · shell.css:1201 .ds-home-games .ds-seg (lg type, edge)
01-02 · fixed · HomeMenu.tsx:144 socials below .ds-menu
22-05 G11 · fixed · HomeMenu.tsx:120 .ds-home-season line
22-04 · fixed · AppShell.tsx:184-196 footer DSIM+sponsor vs .ds-foot-season (presenter)
22-06 · fixed · App.tsx:614 disclaimer on first Play; seasons.ts:93 blurb
22-07 · fixed · shell.css:432 .ds-bar-season caption weight; AppShell.tsx:117
03-07 15-04 · fixed · chain/RobotPreview.tsx:105,445; biobuzz/RobotPreview.tsx:129,410 (dark mat, on-field tokens)
03-08 · fixed · Menu.tsx:618-622 caption={false} (merge 4469a55)
03-10 20-05(real part) · fixed · RobotCard.tsx:58-60 "Real robot" ds-badge; .ds-opt.real stripe deleted
03-23 · fixed · Menu.tsx:686
03-24 · closed(superseded by owner rebuild 06f8971: CUSTOM chip removed) · Menu.tsx:608-644
03-22 · closed(owner call: the hero is right; a fresh BIOBUZZ loadout IS DECODE's DEFAULT_SPEC — src/settings.ts:134,174 — a gameplay default, flagged) · src/settings.ts:134
12-05 · fixed · biobuzz/tutorial.ts:391 (21 words; smoke cap 25)
12-06 · fixed · TutorialCard.tsx:6,94; tutorial.css .ds-tut-head/.ds-tut-pips (✓ Step N done + pips)
12-07 · fixed · ModeSelect.tsx:88; tutorial.css .ds-tut-offer (own block; accent stripe removed at gate)
12-08 · fixed · hints.ts:117-120 (+ smoke uppercase check)
12-09 · fixed · hints.ts:87 say(): "<Action> has no key. Bind one in Controls."
12-10 · fixed · tutorial/types.ts HintPart; hints.ts say/hintText; TutorialCard HintLine kbd.ds-key
12-12 · fixed · tutorial/flag.ts:26 per-game list; game.ts:1868,1941 markTutorialSeen(gameOf(world).id); App.tsx ModeSelect game=
12-13 · fixed · ModeSelect.tsx:106 "Not now" ds-btn ghost
12-18 · fixed(pending .hud var from W6a) · tutorial.css:41 --hud-bottom
05-11 · fixed · GameView.tsx:1270 event log always mounted (setting hides toasts visually only)
22-02 · fixed · src/ui/FoulChip.tsx; GameView.tsx:1032,1047; biobuzz/HudSlots.tsx:438 (FOULS chip per game incl. Chain)
17-10 · fixed · GameView.tsx:1270-1287, FoulChip.tsx (live region never unmounts; sr foul line)
05-12 · fixed · GameView.tsx:837; styles.css:1622,2690
05-14 · fixed · GameView.tsx:1044
22-11 · fixed · GameView.tsx:1044; chain/HudSlots.tsx:39 (×N)
22-12 · fixed · GameView.tsx:1087-1091 hopper role=img
22-10 · closed(already fixed in W3) · styles.css:239
18-16 · fixed · styles.css:3132-3137; mobileActions.ts:247
18-21 · fixed · mobileActions.ts:404-417 (+2 smoke checks)
W6-badge .you-tag/.mult-badge · closed(on-field surfaces; .ds-badge is a shell-panel tile and would fail on the dark field)
C39 C50 C51 C53 C64 · fixed (members above)
W6-skeptic · fixed · hints.ts resolveHint (nested unbound collapse) + smoke check; styles.css --hud-bottom query = compact bar; mobileActions last-resort stepping; TutorialCard kbd sr-name; shell.css .ds-foot-season
W7b · 01-21 06-18 06-21 06-22 07-21 07-22 07-23 19-13 19-07 19-10 19-21 07-04 19-03 19-02 fixed; 19-01 closed(owner: no Season rename; PeriodPicker label names the ranked period); RecordRun maxWidth closed(stale); core.ts:380 PB check updated
W7e · 12-16 12-17 12-20 19-24 fixed (runner.ts:136, TutorialCard.tsx:68, games/*/tutorial.ts, ControlsSection.tsx tutorialGame + Configure.tsx:127); 19-24 preset/blurb: config.ts:3151, seasons.ts:104; BB builder blurbs (labels.ts:54,121) closed(builder chip vocabulary — matches Builder captions "NECTAR turret")
W7d · 11-18 11-22 19-15 19-16 19-17 19-19 19-21 19-22 19-23 01-06 11-09 fixed; 11-10 fixed by me (Legal.tsx .ds-legal-card + shell.css fit-content); 03-18 fixed partly (CR swing tiles) — position cell labels closed(terse chassis-map convention shared by 3 games, pinned in smoke); 19-18 closed(owner flag: sponsor mark placement is a sponsor-terms call)
W7 misc · CareerView.tsx console.warn on load failure
W7a · 02-14 02-17 02-18 02-24 09-20 19-11 19-12 19-07 19-10 19-20 02-06 02-04 19-05 fixed; 02-03 19-04 20-02 closed(stale: kickers removed in earlier wave); shiftaudit.cjs:279 Free drive
W7c · 08-04 08-05 08-10 08-19 08-20 08-22 08-23 08-24 10-15 10-18 19-20(Admin) fixed; 08-08 fixed(loading) + error half closed(by design: api.ts searchUsers treats failure as no results for older servers); 'Control Panel' closed(owner title-case exception); api.ts env-var strings plain
W7-skeptic · fixed · runner.ts Solo practice; WatchLive Free drive; PracticeReplays; ReplayRail rating; CareerPanel copy; .ds-sec panel gap reset; .adm-filter margins; dead .adm-stats + .ds-hint removed
W7x-B · 03-09 04-07 01-04 03-12 fixed; 03-11 closed(stale: .oz removed by owner RobotCard rework; dead rule deleted); 03-05 closed(.ds-subh is a sub-section h3 tier; margin hack removed); 14-09 closed(owner: ALL-CAPS panel titles sanctioned; .ds-bind-col h3 converged to .ds-subh tier); C24 C27 C40 C43 closed(owner: docs follow code — DESIGN.md/ui-standard amended W8)
- W7x-R replay: 09-03 fixed (ReplayView SPEEDS .ds-segs + Space/←→ keys) · 09-04 fixed(time readout m:ss/m:ss) closed(landmarks: replay carries no phase-boundary data) · 09-06 fixed (phase via hudLabels) · 09-07 fixed (mono clock) · 09-13 fixed (flushSync refit in startRealtime) · 09-11 fixed (status {ok,text} as .ds-hint ok|err, .rr-status deleted) · 09-12 fixed(.ds-input fields) closed(caps: owner decision)

### 7.2 P2/P3 triage verdicts (Wave 0)

Verdict `fix` rows are resolved in the wave named; the fix is in the ledger above.

#### Triage 1: reviews 01–08, P2/P3 only

Spacing literal findings (14/18/22 and nearby values) are closed as by-design under the owner decision that the chrome rhythm stays and gets documented. That documentation is C40, in W8. Where one of those findings also names off-scale TYPE, that part rolls into C42.

| ID | sev | verdict | wave | files | fix/reason |
|---|---|---|---|---|---|
| 01-10 | P2 | fix | W2 | src/ui/shell.css (~1621 focus list) | Add .ds-foot-link, .ds-home-link, .ds-discord-join to shared :focus-visible list |
| 01-11 | P2 | closed:duplicate C22 | – | – | footer sponsor mark 14px tap target is in C22 (11-03) |
| 01-12 | P2 | closed:by-design | W8 | – | 14/18/22 chrome rhythm kept (C40 doc); 18px mark font → C42 |
| 01-13 | P2 | closed:by-design | W8 | – | chrome rhythm kept; insets documented under C40 |
| 01-14 | P2 | fix | W4 | src/ui/shell.css:710-715 | Drop box-shadow on .ds-rail-btn.on so the latched item sits flush |
| 01-15 | P2 | closed:duplicate C53 | – | – | season barely visible on home = C53 (22-05) |
| 01-16 | P2 | fix | W3 | src/ui/shell.css:1174-1180 | .ds-home-title line-height 1; record as the one display size |
| 01-17 | P2 | fix | W4 | src/ui/shell.css:699,1331,6551 | Remove `color` from transitions; one --ds-press duration |
| 01-18 | P2 | closed:duplicate 01-01 (C53) | – | – | the review itself folds this into 01-01 |
| 01-19 | P2 | fix | W4 | Chain first-visit dialog (src/games/chain or src/ui) + shell.css | Left-align body prose; card on --ds-block / --ds-round-md |
| 01-20 | P3 | fix | W8 | src/ui/Logo.tsx, DESIGN.md | Default radius 8; record logo as the literal-colour exception |
| 01-21 | P3 | fix | W7 | src/ui/HomeMenu.tsx:175-178 | "Solo 12 · Duo 3 …", mono on the numbers only |
| 01-22 | P3 | fix | W4 | src/ui/NavRail.tsx:36, shell.css:665 | Make "Home" a peer .ds-rail-btn with no arrow glyph |
| 02-11 | P2 | fix | W5 | src/ui/shell.css:1768-1772 | .ds-tiles auto-fill minmax(210px,1fr) for one shared column rhythm |
| 02-12 | P2 | closed:duplicate C30 | – | – | "recommended tile looks selected" |
| 02-13 | P2 | fix | W4 | src/ui/shell.css:5486-5503 | Drop 3px left stripe on .ds-player; the chip carries alliance |
| 02-14 | P2 | fix | W7 | src/ui/Matchmaking.tsx:1092-1178 | One hint per state; READY_WINDOW_NOTE on idle only |
| 02-15 | P2 | fix | W2 | src/ui/Matchmaking.tsx:1157-1159 | Use ToggleRow "Only my region" (aria-pressed, static label) |
| 02-16 | P2 | fix | W2 | Lobby.tsx, Matchmaking.tsx:1128, LanPanel.tsx:482 | Add aria-pressed to create/join, alliance, tier, robot, size picks |
| 02-17 | P2 | fix | W7 | Lobby.tsx, RoleSwapBar.tsx, DiscordLobbyList.tsx | Replace 🤖/★/⧉/＋/－/✎/⇄ with plain text labels |
| 02-18 | P2 | fix | W7 | Lobby.tsx:1221,965; ChallengePicker.tsx:94; RoleSwapBar.tsx:14 | Full-stop sentences, "Play @user", em dash for empty cells |
| 02-19 | P2 | fix | W4 | src/ui/DiscordLobbyList.tsx:78,115; shell.css:1265 | .ds-console-in.narrow, drop var fallback, use .ds-loading/.ds-empty |
| 02-20 | P2 | closed:by-design | W8 | – | 14/18/22 chrome rhythm kept (C40) |
| 02-21 | P2 | closed:duplicate C42 | – | – | off-scale 16/17/18 type = type-scale cluster |
| 02-22 | P3 | closed:duplicate C64 | – | – | tutorial borrowing .ds-rejoin is 12-07 in C64 |
| 02-23 | P3 | fix | W5 | src/ui/Matchmaking.tsx:1138, shell.css | Define .ds-panelbox > .ds-hint-caption (confirmed undefined) or delete the class |
| 02-24 | P3 | fix | W7 | ModeSelect.tsx, Matchmaking.tsx:986 | Sentence case: "Host or join", "Watch live", "Custom rooms" |
| 03-13 | P2 | fix | W4 | src/ui/shell.css:4597,4612 | Flat --ds-panel hero and --ds-bg view box; no radial glow |
| 03-14 | P2 | closed:duplicate C35 | – | – | the review folds this into 03-04 (builder hero card) |
| 03-15 | P2 | closed:by-design | W8 | – | spacing rhythm kept (C40); type sizes → C42 |
| 03-16 | P2 | fix | W4 | src/styles.css:3386-3405, src/ui/Menu.tsx:174 | Move .chassis-sw to shell.css, add focus-visible, dashed lock not opacity |
| 03-17 | P2 | closed:duplicate C30 | – | – | many "selected" treatments |
| 03-18 | P2 | fix | W7 | Builder.tsx, Menu.tsx:444,1173 | Sentence-case mount positions and states; keep game nouns caps |
| 03-19 | P2 | fix | W2 | src/ui/Builder.tsx:237, Menu.tsx:1199 | aria-disabled + describedby, or a status line with the block reason |
| 03-20 | P2 | fix | W3 | src/ui/shell.css:3714-3722 | Inputs get --ds-panel fill (keep inset) or example placeholders |
| 03-21 | P2 | closed:duplicate C41 | – | – | extra 40px gap from unscoped .ds-panel + .ds-panel |
| 03-22 | P2 | fix | W6 | src/ui/Menu.tsx:541,645 | Check the fresh BIOBUZZ spec; hero should use module resolvers (unverified) |
| 03-23 | P3 | fix | W6 | src/ui/Menu.tsx:793 | Show the "Presets" cap only when savedRobots.length > 0 |
| 03-24 | P3 | fix | W6 | src/ui/Menu.tsx:620, shell.css:4808 | CUSTOM only when diverged from a loaded preset; outline chip |
| 03-25 | P3 | fix | W8 | src/ui/shell.css:4165,5215,4836,4124 | Correct the stale CSS comments |
| 04-08 | P2 | fix | W3 | shell.css:4516-4521, OptRow.tsx:78 | .val uses --ds-ink mono tabular; prose hint --ds-mut in UI font |
| 04-09 | P2 | fix | W5 | src/ui/ControlsSection.tsx:631-652 | Merge Touch/Tutorial into one panel with two label·button rows |
| 04-10 | P2 | fix | W4 | src/ui/GraphicsSection.tsx:206,374,584 | Unit row via OptRow; capture uses .capturing, no aria-pressed |
| 04-11 | P2 | fix | W2 | src/input/bindings.ts:1227, ControlsSection.tsx | ←→↑↓ at ink size; keycap aria-label "Left arrow, press to rebind" |
| 04-12 | P2 | fix | W4 | src/ui/ControlsSection.tsx:255-280 | Show a "Remove" ghost button only while a slot is capturing |
| 04-13 | P2 | fix | W2 | src/ui/ControlsSection.tsx:388,620 | Status line: "Press a key for <action>…", then "<action>: W" |
| 04-14 | P2 | closed:by-design | W8 | – | chrome rhythm kept (C40); 14px .sl → C42 |
| 04-15 | P2 | fix | W5 | src/ui/shell.css:5345-5372 | .ds-bind-scope .ds-seg gets --ds-line-strong border; dot inset 4px |
| 04-16 | P2 | fix | W2 | src/ui/Configure.tsx:94-104 | Subnav as <a href> with preventDefault routing |
| 04-17 | P3 | fix | W2 | src/ui/Select.tsx | Add Home/End; make ariaLabel required |
| 04-18 | P3 | fix | W3 | src/ui/AudioSection.tsx:34, shell.css | .val.muted class instead of inline colour |
| 04-19 | P3 | fix | W2 | src/ui/ControlsSection.tsx:144-159 | aria-label={label} on PadSlider |
| 04-20 | P3 | fix | W8 | docs/ui-standard.md:189-190 | Strike button.ds-key from §10 (it is in the focus list now) |
| 04-21 | P3 | closed:wontfix | – | – | Network section is an owner ruling; LABELS flatten is not design scope |
| 05-12 | P2 | fix | W6 | src/ui/GameView.tsx:787, styles.css:1525,2580 | Pre-match side as a filled alliance chip; same for .intro-side-label |
| 05-13 | P2 | closed:duplicate C26 | – | – | blur/glow cluster; touch pad is canvas-floating, so exempt |
| 05-14 | P2 | fix | W6 | GameView.tsx:1022-1031,1145; chain/HudSlots.tsx | Show ASCENDED/PARKED and MULT/CATALYSTS once each |
| 05-15 | P2 | fix | W4 | styles.css:2850-2887, predict.css:32 | Editor bar uses .overlay-buttons keycap; move on-field-accent-ink to shell tokens |
| 05-16 | P2 | fix | W4 | styles.css:1319-1344, predict.css | .game-btn focus-visible + --ds-hud-line edges; .pred-opt sinks |
| 05-17 | P2 | fix | W3 | src/ui/GameView.tsx:1169,1177 | Plain .chip for SPEC and server; drop the 🌐 emoji |
| 05-18 | P2 | closed:duplicate C18 | – | – | red/yellow card shown by colour only |
| 05-19 | P2 | closed:by-design | – | – | assist buttons stay ghosted (owner); also C06 |
| 05-20 | P3 | fix | W8 | scripts/contrast.mjs:257-279, styles.css:470-526 | Delete dead chip variants and their pairs; add scrim/joystick pairs |
| 05-21 | P3 | closed:by-design | W8 | – | HUD spacing literals under the kept rhythm (C40) |
| 06-13 | P2 | fix | W6 | src/ui/Results.tsx:906-923, styles.css:1740,2002 | Demote the header title; WINNER largest after totals; "You won by N" |
| 06-14 | P2 | fix | W4 | styles.css:2400-2476 | Ease-out, no scale past 1, no brightness flash; §7 exception documented |
| 06-15 | P2 | fix | W4 | RewardDialog.tsx:150-173, shell.css:7580-7594,7682 | Drop kicker and radial glow; list only for multi-item grants; --ds-block |
| 06-16 | P2 | fix | W5 | ReportDialog.tsx:112, ScoreReportDialog.tsx, RecordRun.tsx:217,230 | Move inline margins/maxWidth into classes |
| 06-17 | P2 | fix | W3 | shell.css:6429,7373; styles.css:3523 | 10px→--ds-t-xs, #ffffff→token; spacing literals by-design |
| 06-18 | P2 | fix | W7 | src/ui/recordBanner.ts:51, Results.tsx | Drop ★ from PERSONAL BEST and ⟲ from vote REMATCH |
| 06-19 | P2 | fix | W2 | src/ui/Results.tsx:568 | Remove aria-label on strong; add one live "Red wins X to Y" line |
| 06-20 | P2 | fix | W4 | src/ui/shell.css:7363,7387 | Delete dead .title-pick rule; margin-left 0.42em on .title-chip |
| 06-21 | P3 | fix | W7 | src/ui/Results.tsx:501,1294,976 | Consistent "Net score"/"Total"; reword void line (ELO part → C52) |
| 06-22 | P3 | fix | W7 | src/ui/RecordRun.tsx:257,289 | Plain-ink error h1; show loading status once |
| 06-23 | P3 | fix | W4 | styles.css:1669, Results.tsx:901 | cursor:pointer only while phase !== done |
| 07-13 | P2 | fix | W4 | src/ui/shell.css:2814-2818 | .ds-empty .big: --ds-t-lg, weight 600, --ds-ink |
| 07-14 | P2 | closed:duplicate C42 | – | – | table 14/10px type = type-scale cluster |
| 07-15 | P2 | closed:duplicate C44 | – | – | .lb-standing radius/look |
| 07-16 | P2 | fix | W4 | Leaderboard.tsx:308,410; MatchHistory.tsx:169,238 | Keep old rows mounted and faded with aria-busy; loader only on first load |
| 07-17 | P2 | fix | W5 | src/ui/shell.css:2398-2406 | Sticky th with a max-height wrapper |
| 07-18 | P2 | fix | W3 | src/ui/shell.css:2518 | Remove opacity on .mh-type.custom |
| 07-19 | P2 | fix | W2 | src/ui/shell.css (focus list) | Add .lb-name, .lb-robot, .mh-player.link to the focus list |
| 07-20 | P2 | fix | W4 | src/ui/shell.css:2542,2641 | Dotted text-decoration instead of border-bottom |
| 07-21 | P2 | fix | W7 | src/ui/Leaderboard.tsx:47,55 | One label map; "X-drive" everywhere |
| 07-22 | P3 | fix | W7 | Leaderboard.tsx:504, MatchHistory.tsx, CareerPanel.tsx | — for empty, − for negatives |
| 07-23 | P3 | fix | W7 | src/ui/CareerPanel.tsx:232-290 | Sentence-case source labels |
| 07-24 | P3 | closed:duplicate C65 | – | – | period picker heading (07-08) |
| 07-25 | P3 | closed:duplicate C65 | – | – | FINAL tag removal is part of 07-08 |
| 08-12 | P2 | fix | W3 | UsernameField.tsx:84, AuthPanel.tsx:225-292, UsernameGate.tsx, ProfileName.tsx | usernameHintClass() + .ds-form-hint.ok/.err; no inline styles |
| 08-13 | P2 | fix | W4 | ProfileName.tsx:89-173, shell.css:2012-2021 | Drop the ::before " · "; separator in JSX only after a sentence |
| 08-14 | P2 | closed:duplicate C36 | – | – | raw exception text on the page |
| 08-15 | P2 | fix | W5 | src/ui/Account.tsx:53-116,393-430 | Email/Password rows; Account ID folded; Reset+Delete in a danger zone |
| 08-16 | P2 | closed:duplicate C52 | – | – | "Profile" ×3; tab spacing is the kept rhythm |
| 08-17 | P2 | fix | W4 | src/ui/shell.css:3673-3698 | --ds-block shadow, a --ds-scrim token, labels at --ds-t-sm |
| 08-18 | P2 | fix | W2 | src/ui/AuthPanel.tsx:44,168 | Backdrop closes only an untouched form; focus return is in C07 |
| 08-19 | P2 | fix | W7 | src/ui/UsernameGate.tsx:98-117 | Why-line (/profile/name) + ghost "Sign out" |
| 08-20 | P2 | fix | W7 | YourData.tsx, Account.tsx | Cut narration; keep legal sentences; fold mechanism text |
| 08-21 | P2 | fix | W4 | src/ui/LinkedAccounts.tsx:352-367 | One row per provider: label, Connected chip, action on the right |
| 08-22 | P3 | fix | W7 | ProfileFriendActions, UsernameField, FriendsPanel, AuthPanel, VerifyEmailBanner | Drop ✓ in text; one SVG close glyph |
| 08-23 | P3 | fix | W7 | src/ui/AuthPanel.tsx:275 | "Signing in…" / "Creating account…" |
| 08-24 | P3 | fix | W7 | src/ui/Profile.tsx:63-76 | Sub shows @name only |
| 08-25 | P3 | closed:duplicate C36 | – | – | env-var names shown to users; "ELO" → C52 |

##### Counts
- Total P2/P3: 102 (P2 75, P3 27)
- fix: 76 — W2 12 · W3 8 · W4 22 · W5 7 · W6 6 · W7 17 · W8 4
- closed:duplicate: 18
- closed:by-design: 7
- closed:wontfix: 1
- closed:false-positive: 0

#### Triage 2: P2/P3 findings, lanes 09 to 15

| ID | sev | verdict | wave | files | fix/reason |
|----|-----|---------|------|-------|------------|
| 09-14 | P2 | fix | W5 | src/ui/shell.css (.ds-replay-head, .ds-dl), src/ui/ReplayView.tsx | Header becomes a 1fr/auto/1fr grid; drop the spacer and the 90px min-width with its stale comment. |
| 09-15 | P2 | fix | W2 | src/ui/ReplayView.tsx, src/ui/ReplayRail.tsx | Make the replay title an h1; rail headings become h2/h3. |
| 09-16 | P2 | fix | W3 | src/ui/shell.css (replay block 2809-3670) | Tokenise the 10px gaps and paddings, 3px radius, 1.5 line-heights and .ds-empty; keep the 14/18/22 rhythm (by design). |
| 09-17 | P2 | closed:duplicate C36 | - | src/ui/ReplayView.tsx, src/ui/WatchLive.tsx | Raw exception text is C36; add these two sites to it (plus a Try again button). |
| 09-18 | P2 | fix | W4 | src/ui/WatchLive.tsx:160 | "Watch"/"Looking…" in sentence case, with a fixed min-width or aria-busy; the ui.md caps whitelist does not cover this button. |
| 09-19 | P2 | fix | W5 | src/ui/WatchLive.tsx:92-97 | Score on its own mono line, m:ss clock, no double space, names through the badge component. |
| 09-20 | P2 | fix | W7 | src/ui/WatchLive.tsx | "Watch live"; both panels get .ds-panel-h titles; one-sentence empty body. |
| 09-21 | P2 | fix | W4 | src/ui/ReplayView.tsx:649-659 | Commit the backward seek on change/pointerup, or restore from periodic snapshots. |
| 09-22 | P2 | fix | W5 | src/ui/PracticeReplays.tsx, src/ui/shell.css (.ds-dt) | Split Physics/View, or drop View; use an em dash for unknown; .ds-dt goes to --ds-t-xs. |
| 09-23 | P2 | closed:false-positive | - | src/ui/ReplayRail.tsx | adminBits.confirmed documents native window.confirm as the console's deliberate modal confirm. |
| 09-24 | P3 | fix | W2 | src/ui/ReplayView.tsx, src/ui/PracticeReplays.tsx, src/ui/ShareButton.tsx | Wrap the decorative glyphs in aria-hidden spans. |
| 09-25 | P3 | fix | W2 | src/ui/ShareButton.tsx | Announce "Link copied" politely, keep the width fixed, drop the redundant title. |
| 10-03 | P2 | fix | W4 | src/ui/Admin.tsx, src/ui/AdminStanding.tsx, src/ui/AdminUser.tsx | Irreversible actions become danger; Clear all infractions stops being primary; move Clear all records into the enforcement row. |
| 10-04 | P2 | fix | W2 | src/ui/Admin.tsx:264/281/327, src/ui/AdminStanding.tsx:130 | Route these through confirmed(); the season confirm names the resulting period. |
| 10-05 | P2 | closed:wontfix | - | src/ui/Admin*.tsx | Merging seven admin row patterns is a large internal-tool refactor; costs more than it's worth. |
| 10-06 | P2 | fix | W4 | src/ui/styles.css (admin inputs), src/ui/Admin*.tsx | Use .ds-input/.ds-select on the admin fields; aria-label on both search boxes. |
| 10-07 | P2 | closed:duplicate 13-12 | - | src/ui/styles.css, src/ui/shell.css | Same styles.css/shell.css boundary move. |
| 10-08 | P2 | fix | W3 | src/ui/styles.css:3282, src/ui/shell.css:6325, Admin*.tsx | Meaning-based pill variants (danger/warn/ok/plain); no --ds-red for neutral data. |
| 10-09 | P2 | closed:duplicate 14-16 | - | src/ui/styles.css (.adm-stat) | Same "big numbers in mono and tabular" fix. |
| 10-10 | P2 | closed:by-design | - | src/ui/Admin*.tsx | ui.md whitelists ALL CAPS in the admin console (the uppercase-labels decision; docs follow code). |
| 10-11 | P2 | fix | W2 | src/ui/AdminLive.tsx, src/ui/AdminUser.tsx, src/ui/Admin.tsx:481 | Each tab gets an h2 and sections get h3; the account name becomes h2. |
| 10-12 | P2 | fix | W4 | src/ui/adminBits.tsx, AdminLive.tsx, AdminUser.tsx | ListState helper: .ds-loading/.ds-empty, with adminFail wording for errors. |
| 10-13 | P2 | fix | W4 | src/ui/Admin.tsx:673, AdminReports.tsx, AdminStanding.tsx | .small for in-row and toolbar actions; full size only for a form's single submit. |
| 10-14 | P2 | fix | W3 | src/ui/adminCharts.tsx:334, src/ui/shell.css (.an-*) | Add --ds-viz-1..4 fills (contrast-checked); deltas use --ds-danger/--ds-ok-ink. |
| 10-15 | P2 | fix | W7 | src/ui/Admin.tsx, src/ui/AdminLive.tsx, src/ui/AdminUser.tsx | Cut the explanatory hints (keep the privacy note); wrap Live sections in panels. |
| 10-16 | P3 | fix | W3 | src/ui/styles.css (admin block) | Tokenise the 13px, 5/9/10/28px values; .admin-card becomes a .ds-panel (the 14/18 rhythm is by design). |
| 10-17 | P3 | fix | W3 | src/ui/Admin.tsx:584 | Replace the inline borderLeftColor with an .ann-item.preview class. |
| 10-18 | P3 | fix | W7 | src/ui/AdminLive.tsx:223 | "· N watching" instead of the eye emoji. |
| 10-19 | P3 | fix | W2 | src/ui/AdminUser.tsx:131-238 | Cancelling the delete-reason prompt (the `?? ''` at :238) must abort; inline, required reason fields with maxLength. |
| 10-20 | P3 | fix | W2 | src/ui/AdminUser.tsx:377-382 | Standing toggle becomes a disclosure with aria-expanded. |
| 11-11 | P2 | fix | W3 | src/ui/styles.css:3879-3950 | Move legal/markdown type onto --ds-t-* with a 1.45 line-height (or a named legal exception); .md-code tokens. |
| 11-12 | P2 | closed:duplicate 15-13 | - | src/ui/shell.css (.ds-dl-hero) | The hero gradient and flat ground are 15-13; add a --ds-block edge to the hero in the same edit. |
| 11-13 | P2 | fix | W5 | src/ui/Download.tsx:35-41, src/ui/shell.css (.go) | Build options become rows with an inline arrow; shorter labels under a Windows group. |
| 11-14 | P2 | fix | W4 | src/ui/MaintenanceBanner.tsx:68 | Drop the colour emoji; the tone and copy carry it. |
| 11-15 | P2 | fix | W4 | src/ui/shell.css focus list, src/ui/styles.css (.ds-lan-leave, .md-link, .ann-cinema-btn) | Add these to the shared :focus-visible/:active list; 32px min-height on phones. |
| 11-16 | P2 | closed:duplicate C26 | - | src/ui/Announcements.tsx, src/ui/styles.css | The season-reveal glow/loop is C26 (the iteration cap is C03). |
| 11-17 | P2 | closed:duplicate C26 | - | src/ui/styles.css:3822-3836 | The blurred ann-panel shadow is in C26; fix its padding and overshoot easing there too. |
| 11-18 | P2 | fix | W7 | src/ui/Changelog.tsx, src/ui/Announcements.tsx | Share one AnnouncementItem; honest "Changelog unavailable" offline copy. |
| 11-19 | P2 | fix | W5 | src/ui/AppShell.tsx:205-258 | Group the footer: legal links small and muted, product links at the current weight. |
| 11-20 | P2 | fix | W5 | src/ui/AppShell.tsx:183-189, src/ui/shell.css (.ds-foot-brand) | Put the sponsor credit in its own flex item so it wraps as a unit. |
| 11-21 | P3 | fix | W3 | src/ui/styles.css:104-113 | Tokenise .legal-warn padding, type and line-height (or move it onto the C61 banner). |
| 11-22 | P3 | fix | W7 | src/legalText.ts:438/448/541, src/ui/markdown.tsx:45 | Make the contact a mailto link; open only http(s) links in a new tab. |
| 11-23 | P3 | fix | W3 | src/ui/shell.css, src/ui/styles.css | Move the listed literals to --ds-t-*/--ds-s-*; lower the uiaudit baselines. |
| 11-24 | P3 | fix | W2 | src/ui/Sponsor.tsx:168-183, 321-347 | alt = sponsor name; drop the title; add hidden "(opens in new tab)". |
| 12-10 | P2 | fix | W6 | src/tutorial/hints.ts, src/ui/TutorialCard.tsx, src/games/*/tutorial.ts | Hints return key segments rendered as .ds-key chips. |
| 12-11 | P2 | fix | W8 | docs/roadmap.md, docs/area/chain.md | Record that Chain Reaction has no tutorial yet; building one is a feature, out of design scope. |
| 12-12 | P2 | fix | W6 | src/tutorial/flag.ts, src/storageKeys.ts | Key the seen flag per game; migrate the old '1'. |
| 12-13 | P2 | fix | W6 | src/ui/ModeSelect.tsx:82-96 | Add a ghost "Not now" button that calls markTutorialSeen and hides the card. |
| 12-14 | P2 | fix | W2 | src/ui/TutorialCard.tsx:36-61 | One atomic status region holding counter and title (the card is already a nested role=status). |
| 12-15 | P2 | closed:duplicate C45 | - | src/ui/tutorial.css | Goes away with 12-04 (in C45) moving the buttons onto .game-btn. |
| 12-16 | P2 | fix | W7 | src/tutorial/runner.ts:137-139, src/ui/TutorialCard.tsx | "Tutorial complete" eyebrow; a useful title and a next action, not reassurance. |
| 12-17 | P2 | fix | W7 | src/games/biobuzz/tutorial.ts, src/games/decode/tutorial.ts | Cut the narration; one shared aim-assist line. |
| 12-18 | P2 | fix | W6 | src/ui/tutorial.css:36/183 | Place the card from a --hud-bottom custom property. |
| 12-19 | P3 | fix | W3 | src/ui/tutorial.css:76/84 | Line-heights 1.2 to 1 and 1.35 to 1.45. |
| 12-20 | P3 | fix | W7 | src/ui/ControlsSection.tsx:642-650, docs/area/ui.md | "{Season} tutorial" panel title; align the doc wording. |
| 12-21 | P3 | fix | W3 | src/ui/predict.css | Tokenise the px values and 10px type; move the -ink token to shell.css; drop the duplicate color. |
| 13-06 | P2 | fix | W8 | scripts/uiaudit.mjs:274-300, scripts/uiindex.mjs | Compare the stale index without line numbers; print the diff. |
| 13-08 | P2 | fix | W3 | src/ui/shell.css, scripts/contrast.mjs | Delete the six dead tokens and their contrast pairs; update ui-standard §10. |
| 13-09 | P2 | fix | W3 | src/ui/shell.css:341-353, styles.css, predict.css, tutorial.css | Replace the --text/--muted/--panel bridge with --ds-* names; the scrim redefines --ds-ink/--ds-mut. |
| 13-10 | P2 | fix | W3 | src/ui/predict.css:33, src/ui/styles.css:2885 | Move --ds-on-field-accent-ink into shell.css; point .mobile-edit-bar at it. |
| 13-11 | P2 | fix | W3 | src/ui/styles.css, scripts/uiaudit.mjs | Add --ds-scrim/--ds-scrim-strong and alliance gradient tokens; add a raw-colour ratchet. |
| 13-12 | P2 | fix | W4 | src/ui/styles.css, src/ui/shell.css, scripts/uiaudit.mjs | Move ds-/adm-/lb- rules (and .ds-btn.danger) into shell.css; audit ds- selectors outside it. |
| 13-13 | P2 | fix | W8 | src/ui/shell.css:1-45 (comments), .claude/skills/frontend-consistency/design-guide.md | Rewrite the pastel-era comments; fix the Space Grotesk description (kept face). |
| 13-14 | P2 | fix | W3 | src/render (COLORS), src/ui/shell.css, editors | Make equalities var() refs or comment them; assert COLORS.backdrop matches --ds-bg. |
| 13-15 | P3 | fix | W3 | src/ui/predict.css:50/107, src/ui/styles.css:35/111/128 | 10px to --ds-t-xs; drop the font fallback; 1.45 line-height. |
| 14-10 | P2 | closed:by-design | - | src/ui/shell.css, src/ui/styles.css | Uppercase kicker/labels are kept; they get documented in W8. |
| 14-12 | P2 | fix | W3 | src/ui/shell.css, src/ui/styles.css, scripts/uiaudit.mjs | Add --ds-lh-tight/heading/prose (+long) tokens and a ratcheted line-height rule. |
| 14-13 | P2 | closed:duplicate C42 | - | src/ui/shell.css | Off-scale sizes are the C42 type-scale cluster. |
| 14-14 | P2 | closed:by-design | - | src/ui/shell.css | The 14/18/22 chrome spacing rhythm is kept; W8 documents it. |
| 14-15 | P2 | closed:duplicate C25 | - | src/ui/shell.css:1373 | Mono face on prose sub-lines is C25; Space Grotesk kept (description fixed in W8). |
| 14-16 | P2 | fix | W3 | src/ui/shell.css (.lb-standing-rank, .rs-num), src/ui/styles.css (.adm-stat b) | One .ds-num utility (mono, tabular, 700) for big-number displays; covers 10-09 and C56's rs-num. |
| 14-17 | P2 | fix | W8 | scripts/uiaudit.mjs:218/258-270 | Extend the grid rule to margins and all padding values; ratchet line-height and letter-spacing. |
| 14-18 | P2 | closed:duplicate C33 | - | src/ui/shell.css:636/3899 | The console second shell and its gutters are C33. |
| 14-19 | P2 | fix | W3 | src/ui/shell.css, src/ui/styles.css | Tokenise tracking (--ds-track-tight/0/caps); one em-based value per role. |
| 14-20 | P3 | fix | W3 | src/ui/shell.css:3942 | Delete the .ds-head .ds-mark 17px override. |
| 14-21 | P3 | closed:duplicate C43 | - | docs/ui-standard.md | ui-standard §3/§9 weights and the phantom ds-eyebrow are C43. |
| 14-22 | P3 | fix | W3 | src/ui/styles.css (.md-code) | Use --ds-font-mono, --ds-round-sm and --ds-s-* padding. |
| 15-11 | P2 | fix | W3 | src/ui/StartPositionEditor.tsx, src/ui/ChainStartEditor.tsx | Read the legal/illegal colours from tokens; use the COLORS field constant for #0d1720. |
| 15-12 | P2 | closed:duplicate C26 | - | src/ui/styles.css:3960-4055 | The announcement cinema glow is in C26. |
| 15-13 | P2 | fix | W3 | src/ui/shell.css:3869/4597/4613/5634 | Flat --ds-panel for .ds-hero/.ds-dl-hero; remove the accent washes on page backgrounds. |
| 15-14 | P2 | closed:duplicate C29 | - | src/ui/Lobby.tsx:735 | The two-tone "Multi/player" heading is C29. |
| 15-15 | P2 | closed:duplicate C51 | - | src/ui/shell.css:1109/4163 | The .ds-opt.real stripe is C51; fold the .fr-toast stripe into the same fix. |
| 15-16 | P2 | fix | W3 | src/ui/shell.css:282 | Move dark --ds-ok-ink yellower (about #7bd35a) so it separates from the dark accent; rerun contrast. |
| 15-17 | P2 | closed:duplicate 13-10 | - | src/ui/styles.css:2885 | Same one-off #10241b literal. |
| 15-18 | P2 | closed:duplicate C53 | - | src/seasons.ts | "Switching season changes almost nothing" is C53. |
| 15-19 | P3 | closed:duplicate C43 | - | DESIGN.md | DESIGN.md frontmatter palette drift is C43. |
| 15-20 | P3 | closed:duplicate 13-11 | - | src/ui/styles.css | Same literal-scrim token fix. |

##### Counts
- Total triaged: 87 (P2 67, P3 20)
- fix: 64 (W2 9, W3 24, W4 9, W5 6, W6 4, W7 8, W8 4)
- closed:duplicate: 18
- closed:by-design: 3
- closed:false-positive: 1
- closed:wontfix: 1

#### Triage 3 — P2/P3 findings, reviews 16–22

| ID | sev | verdict | wave | files | fix/reason |
|---|---|---|---|---|---|
| 16-08 | P2 | fix | W4 | styles.css `.chip`, shell.css `.ds-chip` | HUD chip becomes `.ds-chip` plus HUD state modifiers, on tokens; red/blue use `-ink` tokens (blink is C03) |
| 16-09 | P2 | fix | W4 | shell.css, styles.css badge classes | Add `.ds-badge` (11px, tone modifiers) and migrate the 11 one-off badges |
| 16-10 | P2 | fix | W4 | shell.css `.ds-startpos-tabs`, `.ds-dl-seg` | Fold startpos tray and dl-seg into `.ds-segs` (rail/subnav is C34, export menu is C57) |
| 16-11 | P2 | closed:duplicate C61 | — | — | Three banner anatomies; tutorial offer borrowing `.ds-rejoin` is covered there and in C64 |
| 16-12 | P2 | fix | W4 | shell.css `.ds-panelbox`, `.ds-dl-hero`, `.ds-stat` | Fold panelbox into ds-panel, flatten dl-hero, split stat tile/chip |
| 16-13 | P2 | fix | W5 | styles.css `.adm-table`, admin TSX | Make `.adm-table` a `.ds-table.dense` modifier (12px, 8px 12px) |
| 16-14 | P2 | closed:duplicate C45 | — | — | Hover lift/sink drift is C45; the cinema glow is C26 |
| 16-15 | P2 | closed:duplicate 21-15 | — | — | Same missing focus-ring list; one base `:focus-visible` rule fixes both |
| 16-16 | P2 | fix | W8 | styles.css:3560 → shell.css, DESIGN.md | Move `.ds-btn.danger` next to `.ds-btn` and document it as a variant |
| 16-17 | P3 | fix | W8 | DESIGN.md Inputs; shell.css `.ds-select`/`.ds-listbox-btn` | Docs follow code: document the outline ring; align select/listbox to 14px |
| 16-18 | P3 | closed:duplicate C36 | — | — | Env-var copy is C36; also add `.ds-empty.error` + on-grid padding during that fix |
| 16-19 | P3 | closed:duplicate C15 | — | — | Username field border |
| 16-20 | P3 | fix | W8 | docs/ui-components.md, scripts/docaudit.mjs | Regenerate the index, including compound selectors like `.ds-btn.danger` |
| 16-21 | P3 | closed:duplicate C51 | — | — | `.ds-opt.real` stripe |
| 16-22 | P3 | fix | W3 | shell.css `.ds-modal`, `.ds-modal-backdrop`, `.ds-opt-del` | Use `--ds-block`, a scrim token, `--ds-round-sm`, and a 24px size |
| 16-23 | P3 | closed:duplicate C33 | — | — | Lobby on the legacy console shell |
| 17-11 | P2 | closed:duplicate C37 | — | — | Season tablist is in C37; widen that fix to Admin.tsx:83 tabs |
| 17-12 | P2 | fix | W2 | src/games/biobuzz/Builder.tsx:226-245 | `aria-disabled` plus a hidden reason; put the mount name in the cell label |
| 17-13 | P2 | fix | W2 | src/ui/Select.tsx:96 | aria-label `${ariaLabel}: ${current.label}` so the value is in the accessible name |
| 17-14 | P2 | fix | W2 | src/ui/GameView.tsx:947/966 | aria-label "Red/Blue alliance score" on each score panel |
| 17-15 | P2 | closed:duplicate C19 | — | — | Heading skips (markdown.tsx, configure titles) |
| 17-16 | P2 | closed:duplicate C01 | — | — | `.ds-range` 8px hit box |
| 17-17 | P2 | closed:duplicate C22 | — | — | Sponsor mark 14px target |
| 17-18 | P2 | fix | W4 | src/ui/styles.css:2136, ~3984, ~4037 | Marquee runs twice then stops, or pauses on hover/focus; cap the cinema loops |
| 17-19 | P2 | fix | W2 | src/ui/PerfHud.tsx:121-124 | Visually-hidden quality word (good/fair/poor) next to the dot |
| 17-20 | P3 | closed:duplicate C43 | — | — | Wrong ui-standard claim about the focus ring |
| 17-21 | P3 | fix | W2 | src/games/biobuzz/Builder.tsx sliders (+Menu.tsx) | Add `aria-valuetext` with units; Audio/Controls/Graphics already have it |
| 17-22 | P3 | fix | W2 | src/ui/GameView.tsx:726-769, ~1197 | Wrap the HUD button glyphs in `<span aria-hidden="true">` |
| 18-10 | P2 | fix | W8 | docs/ui-standard.md, scripts/uiaudit.mjs, css @media | Name 4 breakpoints, fold the near-duplicates, and ratchet the distinct-width count |
| 18-11 | P2 | closed:duplicate 21-12 | — | — | Sticky hover on touch |
| 18-12 | P2 | closed:duplicate C34 | — | — | Rail/subnav scrollers; add scrollbar-width:none, edge fade, and scroll-into-view there |
| 18-13 | P2 | fix | W3 | src/ui/styles.css:2743, ~2790 | Joystick/button ring uses `--ds-on-field-dim`, not `--ds-hud-line` |
| 18-14 | P2 | fix | W5 | shell.css `.mh/.lb/.yd/.an-scroll`, styles.css `.adm-table-wrap` | One `.ds-table-scroll` with an edge fade; sticky rank/driver columns |
| 18-15 | P2 | fix | W5 | src/ui/ControlsSection.tsx | On a coarse pointer, put the bind panels behind a disclosure; hide the Backspace hint |
| 18-16 | P2 | fix | W6 | src/ui/styles.css:2963-2966 `.game-btn` | Coarse: min-height 36/min-width 44, with a ≥12px gap between MENU and RESET |
| 18-17 | P2 | closed:duplicate C53 | — | — | Socials between the season picker and Play |
| 18-18 | P3 | fix | W5 | src/ui/styles.css ~1865/1930/1937 | Merge the adjacent 720px media blocks |
| 18-19 | P3 | fix | W5 | src/ui/FriendsPanel.tsx:65 | Use the named breakpoint constants from 18-10; fix the 1100 overlap |
| 18-20 | P3 | fix | W3 | src/theme.ts, index.html:18-19 | Set the theme-color meta from the resolved theme in theme.ts apply |
| 18-21 | P3 | fix | W6 | src/ui/mobileActions.ts:403 | Shrink the button to the 44px floor or stack it in the side column; never centre |
| 19-07 | P2 | fix | W7 | Leaderboard.tsx:364, ModeSelect.tsx:148-156 | Rename the leaderboard segment to "High scores"; modes become "Solo/Duo record run" |
| 19-08 | P2 | closed:duplicate C52 | — | — | "Profile" ×3 vocabulary; add the Career "stats" empty-state wording to that fix |
| 19-09 | P2 | closed:duplicate C63 | — | — | Legal ASCII dashes; add Lobby.tsx:1221 to that fix |
| 19-10 | P2 | fix | W7 | Lobby.tsx, Results.tsx, MatchStrategy.tsx, Matchmaking.tsx | Remove the decorative ▶ ★ ＋ 🤖 ✎ glyphs from CTAs and chips; keep ← on back links |
| 19-11 | P2 | fix | W7 | src/ui/Lobby.tsx:783-842 | Segments become "New room" / "Have a code"; the CTA keeps the verb |
| 19-12 | P2 | fix | W7 | src/ui/Lobby.tsx:847 | "Everyone in the room must pick the same region." |
| 19-13 | P2 | fix | W7 | src/ui/Stats.tsx:86, Results.tsx:1136 | Put a "Sign in" button on the empty state instead of "from the top bar" |
| 19-14 | P2 | closed:duplicate C54 | — | — | Server-offline message printed five times |
| 19-15 | P2 | fix | W7 | src/ui/Menu.tsx:777/838, src/download.ts:41/47 | Drop the bare "inertia" number; plain installer notes, no NSIS or "run anywhere" |
| 19-16 | P2 | fix | W7 | src/ui/Download.tsx:72 | "DSIM in its own window. Plays offline when you have no connection." |
| 19-17 | P2 | fix | W7 | src/ui/App.tsx:1897-1902 | One product name in the Chain disclaimer; title "Chain Reaction in DSIM" |
| 19-18 | P2 | fix | W7 | src/games/biobuzz/labels.ts:98 | Chips and hero say "Box tube"; the sponsor mark stays in the part picker only (confirm with sponsor terms) |
| 19-19 | P2 | fix | W7 | src/ui/Menu.tsx:630-656 | Label first, then unit; drop "ANG." and the stray decimals (uppercase styling kept by decision) |
| 19-20 | P3 | fix | W7 | Lobby.tsx:733, Matchmaking.tsx:981, WatchLive.tsx:62, Admin.tsx:77/613, legal title | Sentence-case the page headings (panel-title caps are kept by decision) |
| 19-21 | P3 | fix | W7 | Configure.tsx:56, App.tsx:2011, Results.tsx:1133 | "&" only in terse nav sub-labels, "and" in sentences and buttons |
| 19-22 | P3 | fix | W7 | src/ui/App.tsx:1958, 1998 | Replace "OK"/"Got it" with "Back to menu" |
| 19-23 | P3 | fix | W7 | src/ui/App.tsx:1966-1969 | "Start position doesn't fit this robot"; no "chassis", no parenthetical |
| 19-24 | P3 | fix | W7 | src/games/decode/tutorial.ts, biobuzz tutorial.ts/presets.ts | Lowercase game nouns in all prose; caps stay on HUD chips |
| 20-03 | P2 | closed:by-design | — | — | ALL-CAPS panel titles kept; ui-standard §6 "sentence case" text gets fixed in W8 |
| 20-04 | P2 | closed:duplicate C26 | — | — | `.ann-panel` blur is in C26; touch-control shadows are exempt (No-Blur applies to chrome only) |
| 20-05 | P2 | fix | W4 | shell.css `.fr-toast`, `.ds-player/.ds-strat-card.red/.blue`, `.appr-unclaimed` | Drop the one-side edges; alliance rows rely on the filled chip (the `.real` part is C51) |
| 20-06 | P2 | fix | W4 | shell.css `.ds-console`, `.ds-hero`, `.ds-hero-view`, `.ds-dl-hero`; styles.css:279/283 | Flat fills; delete the console glow; score panels use flat alliance chip tokens |
| 20-07 | P2 | closed:duplicate C29 | — | — | Two-tone "Multi/player" |
| 20-08 | P2 | fix | W5 | shell.css `.ds-stats/.ds-stat` (<1100px) | Keep the desktop chip row at every width (this is not the career tiles) |
| 20-09 | P3 | fix | W4 | shell.css `.ds-panel .ds-opt`, `.ds-hero-view` | No block shadow on `.ds-opt` inside a panel; drop the hero-view border on mobile |
| 20-10 | P2 | closed:by-design | — | — | Pill keycaps kept; socials are C53; a field render on home is a feature request |
| 20-11 | P3 | closed:duplicate 19-10 | — | — | The ▶ CTA voice; the lobby shell is C33 |
| 20-12 | P2 | fix | W8 | DESIGN.md typography, src/main.tsx fallback | Space Grotesk kept: call it grotesk with tabular figures, grotesk fallback stack (prose leak is C25) |
| 20-13 | P3 | closed:duplicate 21-17 | — | — | Results overshoot keyframes |
| 20-14 | P3 | fix | W3 | shell.css `.ds-tut-offer` sub-line, scripts/contrast.mjs | Ink-dim text on the accent tint; add the pair to contrast.mjs |
| 21-07 | P2 | fix | W4 | shell.css `.ds-tile` 1799, `.ds-opt` 4214-4236 | Press translate equals the full shadow offset so the base does not shrink |
| 21-08 | P2 | closed:duplicate C51 | — | — | `.real` marker (lost on hover/select) |
| 21-09 | P2 | fix | W4 | shell.css tokens, scripts/uiaudit.mjs | Add `--ds-dur-press/-fade`, `--ds-ease`; ratchet distinct durations |
| 21-10 | P2 | fix | W4 | shell.css `.rec-fill`, `.an-bar-fill`; styles.css ann-cin keyframes | Animate `scaleX` for fills; replace the letter-spacing/blur entrances with opacity+translate |
| 21-11 | P2 | fix | W4 | shell.css:5662, styles.css:1347, predict.css:112 | One global reduced-motion `transform:none` rule for pressables; delete the three lists |
| 21-12 | P2 | fix | W4 | shell.css, styles.css hover rules | Gate hover transforms/tints in `@media (hover: hover)`, starting with the keycaps |
| 21-13 | P2 | closed:duplicate C26 | — | — | Cinematic announcement blur/glow |
| 21-14 | P2 | fix | W4 | Account.tsx:361/472, AccountReset.tsx, AccountVerify.tsx, admin TSX | `.ds-btn.busy` keeps the idle label width and sets `aria-busy` |
| 21-15 | P2 | fix | W4 | shell.css:1621-1637, docs/ui-standard.md §1.3 | Base `:where(button,a,summary,[tabindex]):focus-visible` ring; delete the per-class copies |
| 21-16 | P3 | fix | W4 | shell.css `.ds-subnav-btn`, `.ds-tab`, `.ds-seg` | Use the same colour transition as `.ds-rail-btn` (duration token) |
| 21-17 | P3 | fix | W8 | DESIGN.md motion | Document that overshoot is reserved for the results/countdown reveal |
| 21-18 | P3 | fix | W3 | src/ui/styles.css:3118-3119 | `.net-spinner` moves from `--border`/`--amber` to `--ds-hud-line`/`--ds-warn` |
| 22-06 | P2 | fix | W6 | src/ui/App.tsx:574-577, src/seasons.ts:93 | Show the Chain disclaimer on the first Play, not on switch; fix the stale blurb |
| 22-07 | P2 | fix | W6 | src/ui/AppShell.tsx:112-119 | Style the header season label as plain text, not a control (switcher is C53/C37) |
| 22-08 | P2 | closed:duplicate C51 | — | — | "Real robot" marker label and parity |
| 22-09 | P2 | closed:duplicate C50 | — | — | DECODE builder preview medium |
| 22-10 | P2 | fix | W6 | src/ui/styles.css:229-231 | Add `.game-root.view-3d .eventlog` to the 3D scrim selector |
| 22-11 | P2 | fix | W6 | src/ui/GameView.tsx:1022-1031, src/games/chain/HudSlots.tsx | Chain breakdown shows only PARTICLES; the badge uses × |
| 22-12 | P2 | fix | W6 | src/ui/GameView.tsx:1037 | DECODE hopper gets `role="img"` + `aria-label` like Chain and BIOBUZZ |
| 22-13 | P2 | closed:wontfix | — | — | New per-game pre-match slot is a feature request, not a design defect |
| 22-14 | P3 | closed:wontfix | — | — | Refactor deferred by the finding itself (do it on the next editor change) |
| 22-15 | P3 | closed:wontfix | — | — | No action required (Chain has no tutorial by scope) |
| 22-16 | P3 | fix | W3 | src/games/biobuzz/scene/renderRobots.ts:206 | Import COLORS.red instead of `'#ef4444'` |

##### Counts
Total 93 · fix 62 (W2 6, W3 6, W4 16, W5 6, W6 7, W7 15, W8 6) · closed: duplicate 26, by-design 2, wontfix 3, false-positive 0


### 7.3 Final evidence

`audit.cjs` over the same 12 routes as §4: **0 FAIL · 25 WARN in each theme**, down from 0 FAIL · 31 WARN. The remaining touch-target WARNs are the footer's inline text links (16px tall, spaced apart). `shiftaudit`: 646 state changes, 0 layout shift.
