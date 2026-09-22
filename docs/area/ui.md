<!-- governs: src/ui/**, src/input/**, src/render/**, src/tutorial/**, src/settings.ts, src/theme.ts, src/audio.ts, src/main.tsx, src/seo.ts, src/download.ts, src/contributors.ts, src/desktop.ts, src/perfStats.ts -->
# UI — controls, settings, audio, HUD, and the copy rules

Rebindable controls, assists, persisted settings, HUD product rules, and the UI COPY house rules — which were settled by a measured audit, so read them before writing any user-visible string. `docs/ui-standard.md` is the CSS half.

*Split out of `CLAUDE.md` on 2026-09-16, **verbatim** — CLAUDE.md is loaded into every
session and this is not needed by most of them. The `governs:` line above is read by
`scripts/docaudit.mjs` and by the editor hook, so keep it accurate when paths move.*

## Before you add a class, look it up

`docs/ui-components.md` is the generated inventory of every `ds-` class: where it is declared
and how many times `src/**` uses it, grouped by family. There are 233 of them across 8,700
lines of CSS, which is not greppable in practice — and a new class written because the grep
was inconclusive is the mechanism by which this design system drifts.

`npm run uiindex` regenerates it; `npm run uiaudit` fails if the committed copy is stale.

The other three are not interchangeable: **`DESIGN.md`** (repo root) is the look — the
driver-station keycap language, the palette, the ONE depth model. **`docs/ui-standard.md`** is
the geometry and the scales, and it is STRICT: if a rule there is wrong, change the rule first
and then the code. **`uiaudit`** is what actually enforces both, as ratchets.

---

## Controls, settings, audio

- **Controls are fully rebindable** (`src/input/bindings.ts`, `src/ui/ControlsSection.tsx`):
  every keyboard action, gamepad buttons, AND the drive/turn stick assignment. Escape is
  reserved (menu/cancel — never bindable). Conflict policy: a rebound key is STOLEN from its
  old action (may show UNBOUND). Defaults: WASD drive, Q/E or ←/→ turn, Shift/K intake,
  Space fire, C catalyst (CR), F flip-front, P park, Enter start, R restart.
  **Every action carries as many alternatives as the player wants**: the `+` keycap at the end
  of a row captures into a new slot, and Backspace or Delete while a slot is waiting removes
  it (neither key is anywhere a driving hand goes, so nothing bindable is lost). The screen
  used to let you REPLACE a slot and never ADD one, which with sixteen buttons and twelve pad
  actions meant every rebind cascaded into an UNBOUND somewhere else.
- **GAMEPAD COMBOS** (`PadBindings.combos`, `src/input/padChords.ts`): two or three buttons
  held together fire one action (`RT + D-UP` for a lift), the way real drive-team code reads
  `gamepad.dpad_up && gamepad.right_trigger > 0.5`. Capture commits on the first RELEASE, so a
  second button can join; a chord is stored canonical (ascending, unique, `2..PAD_CHORD_MAX`)
  and `padBinds(pad, action)` is the one view — singles then combos — that the resolver, the
  keycaps, the start overlay and the tutorial hints all read.
  ⚠️ **`combos` is a SEPARATE field from `buttons`, on purpose.** A settings blob is persisted
  and account-synced VERBATIM, so an older client reading `buttons` full of arrays would reject
  every pad binding and, on its next save, write the defaults back over them. Kept apart, an
  older client ignores the field and the singles keep working.
  **Stealing is EXACT**: a single steals that single from every action and touches no combo; a
  combo steals the identical combo and touches no single. RT can be Shoot AND half of a lift
  combo at once, which is the whole point.
  **The resolver has three rules, and each one wrong is a lift that fires a shot** (DECODE's
  first shot is instant): (1) the longest satisfied chord wins, masking the singles it is made
  of; (2) a satisfied chord that is a strict prefix of a bound, unsatisfied chord WAITS
  the COMBO WAIT from the moment it completed, because nobody presses two buttons on the
  same frame — `PadBindings.chordGraceMs`, the player's own slider under the gamepad block
  (default `PAD_CHORD_GRACE_MS` 80 ms, clamped to 20..200 on load, disabled rather than
  hidden while no combo is bound so the rows under it never move); (3) a fired combo CONSUMES its buttons until they are released, so
  letting go of D-UP with RT still down does not start shooting, and one finger lifting off a
  three-chord does not fire the two-chord under it; (4) a tap INSIDE the wait still counts —
  a prefix let go before the wait runs out, with no wider chord having fired, fires once on
  the frame of the release, so a quick RT tap is still one shot and park / flip / start /
  restart still work on a button that also lives in a combo (rule 2 alone swallowed it, which
  a review caught). ⚠️ **A rule-4 tap is held asserted for `PAD_TAP_HOLD_MS` (34 ms), not one
  frame.** `resolve()` runs once per FRAME, but the HELD-level bits it produces are consumed by
  the SIM on a fixed 60 Hz accumulator, and above 60 fps most frames step ZERO ticks — so a
  one-frame pulse landed on a frame that stepped nothing about two in three at 165 Hz and the
  shot was silently lost (multiplayer has the same hole: a jittery `setInterval` at the sim
  period). With frame period `p` and sim period `T`, at most `floor(T/p)` frames in a row step
  nothing, so the gap between stepping frames is always under `2T` = 33.34 ms; 34 is that floor
  rounded up. The window is CONTINUOUS, so `gamepad.ts`'s `prev*` detectors still see exactly
  one rising edge. Two things the rules deliberately do NOT do, so nobody rediscovers them:
  overlapping chords that are not nested all fire (`LB + RT` and `RB + D-UP` held together
  also satisfies an `RT + D-UP` bound elsewhere, exactly as `&&` on the real pad would), and
  masking reads SATISFIED rather than fired, so under a three-chord the two-chord's wait also
  silences the single for its length. With no combo bound, none of this runs: the fast path is
  the old any-button test with no state. All of it is pinned in `npm test`.
- **GAME-SPECIFIC BINDS — one main map, per-season overrides** (`ControlBindings.perGame`,
  `effectiveBindings`). `ControlBindings` (keys + pad + combos) stays THE MAIN SETTING, the
  shared map every season starts from. `perGame?: Partial<Record<GameId, {keys?, padButtons?,
  padCombos?}>>` is a NEW SIBLING FIELD — same reasoning as `combos`, and it matters more here:
  an older client ignores it and plays the main map. An action PRESENT in a game's override is
  **DESYNCED** there (its binds are exactly the override); ABSENT means it inherits main
  (**SYNCED**), and "sync back" is the deletion of the entry, nothing else. `padButtons` and
  `padCombos` for one action are ONE UNIT. Stick role, deadzone, curve, trigger threshold and
  the combo wait stay GLOBAL — they are how a hand works, not what a button means.
  **`effectiveBindings(b, game)` is the one resolver**, and everything that drives or NAMES a
  control reads it, never `settings.bindings`: `InputManager` (via `GameController.bindings`,
  resolved once from `gameId`), the start overlay, and the tutorial hints. It returns a plain
  main-shaped `ControlBindings` with the overrides applied, `perGame` stripped, and the actions
  the game does not use **EMPTIED** — not ignored later. That emptying is load-bearing: the
  chord resolver reads a `PadBindings` and has no idea what a game is, so a Chain Reaction combo
  left in a BIOBUZZ map would mask a single, consume its buttons, and make a tap wait for a
  combo that can never fire.
  ⚠️ **`ACTION_GAMES` (`bindings.ts`) is the table that makes a duplicate legal**, and every row
  was checked against which `RobotCommand` bit that game's SIM reads: `catalyst`/`fling` are
  Chain Reaction only, `bbPlace`/`bbPlaceNectar`/`bbNectar` are BIOBUZZ only, everything else is
  every game (`driveMode` included — it is read in `src/sim/robot.ts`, which all three route
  through). **Two actions conflict only if some game uses both.** So MAIN may put one key on
  both `catalyst` and `bbPlace` — no session offers both — while `fire` still steals from
  everything. Inside a game scope the steal scope is that game's EFFECTIVE map, and the victim
  is DESYNCED in that game rather than edited in main; the game-scope editors are literally the
  main editors run against the effective map, where the non-actions are already empty, so the
  scope comes out right by construction. **Main-edit vs override**: when a main edit would put a
  bind on an action that is SYNCED in game G while some other action G uses holds it in a
  DESYNCED override, **the override loses that bind** — so the edit the player just made
  survives everywhere, and an edit under "All games" never silently does nothing.
  `mergeBindings` validates `perGame` entry by entry (unknown game ids, unknown actions, and
  actions a game does not use are all dropped; lists go through the same validators as main),
  and **`BIND_SLOTS_MAX` (8) caps every list, main included** — `+` could grow one without
  bound, and the server caps the settings blob at 64 KB. A blob with no `perGame` round-trips
  byte for byte, and the field is pruned back to absent when the last override is synced away.
  UI: a scope switch (`.ds-segs`) at the top of the Controls card — `All games` plus one entry
  per **visible** season. A season scope lists only that season's actions, each row marked
  SYNCED or CUSTOM (in BOTH states, so the marker never changes a row's height mid-edit) with a
  Sync control, and a "Sync all to shared" in the foot, disabled rather than hidden for the same
  reason the combo-wait slider is. The main scope tags a row with its seasons when they are not
  all of them, so a key shared by Catalyst and Place POLLEN does not read as a bug.
  ⚠️ **The capture effects on the controls screen depend on `capture` ALONE**, with
  `bindings`/`onChange` in refs: `onChange` is a fresh arrow every render and the App re-renders
  on its own every few seconds (the presence poll), which restarted the pad effect mid-capture
  and swept the buttons still held into `alreadyDown` — the release then bound nothing. A
  single-press capture never showed it; commit-on-release made it a real window.
- "Flip front" reverses robot-centric drive so the shooter side leads — applied at INPUT level
  in `GameController`, sim untouched; REVERSED chip in the HUD.
- All `GameSettings` persist to `localStorage['decodesim.settings.v1']` via `src/settings.ts`
  (validated field-by-field on load — corrupt/stale data falls back per field) and sync to
  Postgres per account.
- **Assists are menu-only** (field/robot-centric, auto intake, auto fire) — NO in-game toggle
  keybinds. Auto-fire/intake must respect match phases (no firing in `pre`/`transition`).
- **AIM ASSIST IS ALWAYS ON, in BOTH games, and is NOT configurable.** `coerceAssists`
  (sim/spawn.ts) forces `aimAssist` true — deliberately in the SHARED coercer, not the UI,
  because a stored `false` can arrive from localStorage, a synced account blob, a saved robot
  slot, or the wire, and forcing it only in the menu would strand anyone who had switched it
  off with no control to switch back. The FLAG and both sims' manual-aim branches stay
  (DECODE's chassis-locked turret in `updateRobotActions`, Chain's `chainAimAssist` guard),
  tested by setting `r.aimAssist` on the spawned robot — restoring the option is deleting one
  line in `coerceAssists` and putting the toggle back in `Menu.tsx`. A DECODE "auto align"
  assist (hold fire → steer the chassis onto the shot) was built and then REMOVED: with the
  turret always tracking there is nothing for it to do. Chain's turretless hold-to-steer is a
  different thing and STAYS — see `chainAimAssist`.
- Audio: real FIRST field sounds (`public/sounds`, from Team254/cheesy-arena) + an announcer
  VOICE via speechSynthesis. Countdown digits must interrupt in-flight speech to stay on the
  visual beat. Menu has Sounds ON/OFF (master) + Voice lines ON/OFF (falls back to beeps).
  Shoot/intake/gate SFX are SYNTHESIZED (WebAudio, `sfx*` in `audio.ts`) and triggered by
  edge-detection on world state in `GameController.handleActionAudio` — **the sim core stays
  event-free for these**.

## Controller navigation — the pad drives the MENUS too

One focus-navigation layer for the whole app (`src/input/padNav.ts` + `src/ui/PadNavLayer.tsx`).
It drives NATIVE focus and NATIVE activation on the real DOM, so everything keyboard-reachable
is pad-reachable and every fix it forces is an accessibility fix in its own right. **Nothing
here invents a parallel selection state** — a second model of "what is selected" would drift
from the one the browser already keeps, and the two would disagree first on exactly the screens
that are hardest to test.

- **The split is what makes it testable.** `padNav.ts` is DOM-free, clock-free and
  `navigator`-free: the geometry picker, the repeat clock, the glyph families, the on-screen
  keyboard's reducer, the suspend registry and the button mask. `npm test` drives all of it on
  synthetic rects and an injected clock, which is the only way to test spatial navigation
  without a browser. `PadNavLayer.tsx` is the half that touches focus, and it is the ONLY half
  that may.
- **The layer is mounted beside `<App/>` (`main.tsx`), not inside it**, for the reason the ad
  provider wraps it: the game, lobby, record and ranked screens are returned EARLY, so anything
  inside `App` would have to be remembered by each of them. It renders through a portal to
  `body`, so its position in the tree costs it nothing, and it polls nothing until a pad
  connects.
- **Focus moves by GEOMETRY, and the cross-axis term is the whole trick.** A candidate qualifies
  when its centre is strictly past the source's on that axis (strictly, or a row whose centres
  line up is a candidate for itself and a move sits still); the winner minimises
  `alongDistance + 2 × crossGap`, where `crossGap` is 0 while the two boxes overlap on the other
  axis. That is what makes a ragged grid behave — moving down out of a narrow tile picks
  whatever is actually UNDERNEATH it, not whatever is nearest by straight-line distance. With no
  candidate it scrolls, then wraps within the container, then stays put.
- ⚠️ **THE RING IS ON `:focus`, NOT `:focus-visible`.** A pad move is a synthetic `.focus()`,
  which the browser treats as programmatic — Chromium grants `:focus-visible` after keyboard-ish
  interaction but not reliably from a gamepad, so the app's own rings cannot be leaned on. The
  layer sets `data-padnav="on"` on `<html>` while a pad is the ACTIVE input (any pointer move
  clears it, so a mouse user never sees a ring), and one rule set in `shell.css` rings plain
  `:focus` underneath it. It is an `outline`, so it moves no layout. Inside `.hud`/`.game-root`
  it takes `--ds-on-field-accent` — **category 3**, because the field is hardcoded dark.

### The in-match contract

**In a match the pad is the robot's.** `GameView` calls `suspendPadNav('match')` for its whole
mount, so there are no focus moves and no synthetic clicks while somebody is driving. The
Controls screen stands the layer down the same way while a rebind is armed
(`suspendPadNav('capture')`) — without it, A-to-activate binds A to whatever row was just opened.

- **A registry, not a boolean.** The two reasons OVERLAP (Controls is reachable from a match),
  and with a boolean the second release would undo the first.
- ⚠️ **`GameView`'s effect is MOUNT-ONCE, with `onExit` in a ref.** It is a fresh arrow every
  render and `App` re-renders on its own every few seconds (the presence poll), so depending on
  it would tear the suspension down and rebuild it mid-match — the same trap the capture effects
  above document.
- **The way back in is the MENU button**, watched even while the layer is suspended because it
  is the way back out. Default `PAD_MENU_BUTTON` (15, D-RIGHT): the one standard-mapping index
  no default bind uses, and `npm test` asserts that against `DEFAULT_BINDINGS` rather than
  trusting the comment, because a future default taking it would make the button that leaves a
  match also drive the robot.
- ⚠️ **EDGE CONSUMPTION.** The press that opens the menu must not also drive, and the press that
  closes it must not fire a shot. `maskPadButtons(held)` records everything held at that instant;
  `GamepadInput.sample` runs `applyPadMask` over the held list **before the chord resolver sees
  it**, and an entry clears when its button is physically released. Same rule as the chord
  resolver's rule 3, same reason. It is module state because the two sides are different objects
  on different loops — the pad-nav rAF sets it, the sim's input manager reads it.

### Preferences, text and glyphs

- **Two new `PadBindings` fields, both NEW SIBLINGS** validated field-by-field like
  `chordGraceMs`: `menuButton` (0..31) and `navEnabled` (default true, the "Controller menu
  navigation" toggle in Controls ▸ More). Same reasoning as `combos` — an older client ignores
  them and keeps its Esc-only exit. No new storage key: both ride the settings blob that already
  persists and syncs. `App` mirrors them into `padNav.ts`'s little store because the layer is
  mounted outside it; importing `PadBindings` as a value there would close the cycle
  `bindings.ts → padNav.ts`.
- **A text field activated BY PAD gets an on-screen keyboard.** Ordinary buttons, so the same
  layer navigates it and no second input model exists. Caps is ONE-SHOT, and the cap on length
  is the field's own `maxLength` — a keyboard that let a pad user past it would write a value
  the form then rejects.
- ⚠️ **Confirm is not always index 0.** In the standard mapping 0 is the BOTTOM face button and
  1 the RIGHT one; on a Switch pad the RIGHT one is A, so `padConfirmButton`/`padBackButton`
  SWAP for `nintendo`. Relabelling alone would hand that player a legend saying A and a layer
  listening to B. An unrecognised pad stays `generic` rather than guessing Xbox — a wrong glyph
  is worse than a neutral one, because the player trusts it and presses it.
- **No keyboard view keys, and the arrows stay the driver's.** Every bind in this app is
  rebindable, so a navigation layer that ate the arrows would either steal a driving control or
  need a runtime conflict check against `effectiveBindings` on every keystroke.

## Configure — the five sections, and the three rules that hold them together

`src/ui/Configure.tsx` routes five sections at `/configure/<key>`. **The ARRAY is the order on
screen; the KEYS are shipped URLs** (`audio` is Audio and Visual), so reordering must never
rename one. Order is task order — Robot, Controls, Match, Audio and Visual, Graphics: build it,
learn to drive it, set up the session, then the two output sections.

- **ONE SPELLING OF A PICK: `OptRow` / `ToggleRow` (`src/ui/OptRow.tsx`).** There used to be
  three — a single tile whose LABEL carried the state (`Auto intake ON`), a two-tile `Off`/`On`
  row, and a segmented strip — and the first is the bad one: the tile is already filled accent
  when it is on, so the word says a second time what the fill says, and an unlit `Sorter OFF`
  beside a lit `Sorter ON` reads as two different controls. Every boolean and small enum in
  Configure goes through this component, which is also where the `aria-pressed` fourteen
  hand-rolled toggles were missing comes from. **Toggle buttons, never an ARIA radiogroup** —
  a radiogroup owes roving tabindex and arrow keys, and half that pattern is worse than none.
- **RARE CONTROLS FOLD; THEY ARE NOT ROUTED ELSEWHERE.** `<details class="ds-fold">` — Graphics
  ▸ Advanced (the sixteen overrides the Quality preset already sets), Controls ▸ More (touch
  controls, network prediction), Audio ▸ Individual sounds (the five per-emitter trims). Closed
  it is one row; open it is exactly where it was, so nothing is hidden from somebody who knows
  it exists. `.ds-fold.inset` is the variant for inside a panel body, where a second card would
  be nesting. The marker rotates and `[open]` changes a border COLOUR, never a width.
- **THE ROBOT PREVIEW STAYS ON SCREEN, AT THE TOP.** Owner ruling, 2026-09-22: the 260px rail is
  gone — it kept the robot on screen but read as a widget parked beside the build — and `.ds-hero`
  is a pinned strip again, flush under the app bar from 1100px up. ⚠️ **The strip that was reverted
  before held 26% of a 720px viewport, and the cause was `.ds-stats`**, an auto-fit grid of 96px
  two-line tiles wrapping to two rows — never the sprite. **The budget is 105px**, set by the 96px
  sprite box: the tiles are ONE-LINE chips that wrap inside that box, so another game's stat tile
  cannot grow the card. Under 1100px wide it is the ordinary stacked card at the top of the page,
  and at 720px tall or less it keeps the strip shape but stops pinning.

**Configure copy.** No decorative glyph (the `🎯` on preset cards and the `＋` on the add cards
are gone), no sentence whose content is where another screen is, and no sub-line naming a KEY —
every control in this app is rebindable, so `L-stick/W-S: Fwd/Back` is a claim that goes stale
the moment somebody opens Controls. A blurb survives only where it names a trade-off the player
is choosing between (`docs/ui-standard.md` §8): the archetype and drivetrain descriptions, the
four `PERF_DISPLAY_BLURB` lines, an option's download size, and the R102 stow note.

## HUD / UX product rules

- HUD mimics the FTC live scoring display: red|timer|blue bar at the BOTTOM.
- **No popup toasts over the field** — events go to the muted left-edge log; zone status lives
  in the top-right chips.
- Visible MENU/RESET buttons on the game screen (don't rely on Esc/R knowledge); "MATCH
  BEGINS IN" text lead-in before the 3-2-1 digits.
- END GAME at 20 s left (`ENDGAME_START` / `CHAIN_ENDGAME_S`): warning cue + HUD label/tint.
- Games opt into chrome via `GameModule.ui` (`showScoreHud`, `startEditor`, `intakes`).
- **THE LABEL OVER A ROBOT IS THE DRIVER'S USERNAME, IN THEIR ALLIANCE COLOUR**
  (`renderer.ts`, both the 2D pass and the 3D projected one). It answers "who is that", so the
  username wins over the build's `spec.name` and the team-number prefix goes with it; a seat the
  server did not name — solo, a bot before `matchStart.drivers` existed, a replay, an old server
  — falls back to the old `teamNumber + spec.name`. The LOCAL robot is still never labelled.
  The fill is `COLORS.redLabel` / `COLORS.blueLabel`, a separate pair because `COLORS.red`/`blue`
  are under 4.5:1 as 12-px type on the field; the dark stroke stays, and it is what carries the
  glyphs onto the light backdrop and onto a 3D background. Category 3 (their ground is the
  canvas), so they do not theme.
- ⚠️ **`.hud` IS `pointer-events: none`** so the canvas keeps a drag. Anything in it meant to
  be clicked re-enables them ON ITSELF (`.game-btn`, `.sponsor-chip`, `.mobile-btn`,
  `.pred-panel`). The connection chip did not, for months: its `onClick` opened a ping graph
  and the click never arrived. **Before adding a control to the HUD, add the rule.**
- ⚠️ **THE TOUCH PAD'S BUTTON SET IS DERIVED FROM `ACTION_GAMES`** (`src/ui/mobileActions.ts`
  + each game's `src/games/<id>/mobile.ts`), and `npm test` asserts the coverage per game: every
  action a season uses is either a button, a stick, on-screen chrome, or a written entry in
  `TOUCH_OTHER_ACTIONS`. It was a hand-written list of four, so BIOBUZZ shipped `bbPlace`,
  `bbPlaceNectar`, `bbRamp` and `bbPass` with a keybind, a pad button and nothing at all on a
  phone — three of its own handoffs recorded that and none of them could fail a build.
  Two rules fall out of it. **An ASSISTED action is ghosted, never hidden**: hiding them left a
  default DECODE phone with NO action buttons, because auto intake and auto fire are both on by
  default and they were the only two the pad had. And **positions are computed, not stored** —
  a `mobileLayout` fraction cannot be right in both orientations (the shipped default overlapped
  SHOOT with INTAKE in portrait and hung the drive stick off the left edge), so the pad packs
  itself into two thumb columns against the live viewport and reads a stored position only once
  the player has dragged that control. In LANDSCAPE the score bar and the breakdown chips are in
  the left and right gutters, and the packer treats both as obstacles.
- **ONE performance read-out**, `PerfHud` in the top-right under the status chips, driven by
  `GameSettings.perfDisplay` alone (off · simple · detailed · graphs, default simple = fps +
  ping). It is NOT interactive and NOT a `[data-hud-band]`: a band reserves an edge and the 3D
  camera reframes the field around it, so a diagnostic carrying one would change the shot it
  was turned on to measure. Its three ancestors each drew their own corner box and two of them
  landed on something — `?perf=1` over MENU/RESET, the 3D overlay over the event log.
- **`data-hud-band` goes on the thing that covers the field, not on its wrapper.** It is on
  `.status-row` (the chips), not on `.status-wrap`, so a panel stacked under the chips cannot
  grow the reserved inset mid-match.

### UI COPY — the house rules, settled by measurement

A seven-slice audit of every user-visible string (2026-09-06) found the voice already
strong — almost no marketing vocabulary, no "Oops!", no exclamation marks — and the real
yield in CONSISTENCY. These are the rulings, with the counts that decided them, so the
same arguments are not had again:

- **Typographic punctuation: `’` `“` `”` and `…`**, never the ASCII ones (measured 60:18
  for the apostrophe; the ellipsis was already 50:0). A file full of `’` with an ASCII
  hyphen doing an em dash's job is the actual inconsistency.
- ⚠️ **PREFER A FULL STOP OR A COLON TO A DASH.** The hyphen-vs-em-dash split was 50/50
  across the app — genuine drift, not a convention — so it had to be ruled on, and
  "normalise every ` - ` to ` — `" is the WRONG answer to a request that is explicitly
  anti-AI-slop: a dash-joined appositive is the single most-cited tell of machine-written
  prose. Almost every one of them was two sentences. Where a dash is genuinely the right
  mark, it is `—`.
- **Failures are `Couldn’t <verb the thing>.` plus a concrete next step** (`Couldn’t` beat
  `Could not` 12:5). No "Something went wrong.", ever — it tells a person nothing, and it
  was on the claim form and the sign-in form, which are the two worst places for it.
  The admin console composes its own through **`adminFail()` (`src/ui/adminCopy.ts`)**,
  which existed because five spellings of `Failed - check admin sign-in` had accumulated
  across two files, none of which said WHICH action failed.
- **Sentence case** for `ds-btn` and every heading. ALL CAPS is correct in exactly four
  places and they are all deliberate: `.overlay-buttons button` (13/13), the HUD chips (the
  FTC scoring display is uppercase), `ds-cta` (14/14), and the admin console (29/34).
- **`.ds-empty` for an empty list** (`.big` headline, no period, then one sentence with
  one), **`.ds-loading` for a loading state** (9/10 already did).
- **A name always gets `SupporterBadge`, as a SIBLING** — see the badge rules above — and,
  since 2026-09-22, **`TitleMark` beside it**: see `docs/area/accounts.md` for the surfaces.
- **Terminology.** DSIM is the app; DECODE and Chain Reaction are seasons. DECODE has
  ARTIFACTS, CR has PARTICLES, and a leak either way is a bug. CR's ring is a **CATALYST**
  — the **RING STAND** is a different object in the same game, so the HUD chips that said
  RING now say CATALYST. Teleop is **DRIVER-CONTROLLED** on all THREE surfaces that name it
  (the live HUD, `world.events`, and the burned-in video overlay); it used to be
  DRIVER-CONTROLLED on one and TELEOP on the other two, and free drive was FREE DRIVE and
  PRACTICE. `npm test` now pins the overlay to the HUD's words.
- **No padding**: simply / just / please note / be sure to / feel free to. **No helper text
  that restates its own label** — a hint under a button that already says what it does is
  the most common form of it here.
- **Foul lines name the ACT, not the place** (`G424 contact in the gate zone`, not
  `G424 gate zone`), because a driver reads them mid-match; CR's `G05`/`G06` used to be
  bare rule ids. ⚠️ Those strings live in `src/sim/` and `src/games/chain/`, so **changing
  them is a SERVER change and needs a deploy.**
- Code comments and JSDoc are OUT of this ruleset. The verbose in-code voice this file is
  written in is deliberate house style.

## The TUTORIAL (`src/tutorial/`, content in `src/games/<id>/tutorial.ts`)

A tutorial is a scripted solo practice: a list of STEPS, each a staged field, a goal predicate
over the world, a hint naming the player's own bound keys, and a step card in the HUD band. The
ENGINE is shared and DOM-free; the CONTENT is per game, on `GameModule.tutorial`.

⚠️ **STAGING IS WORLD CONSTRUCTION, NEVER A MID-RUN TELEPORT.** `docs/area/netcode.md` states the
invariant solo practice depends on: a run is fully SIM-DRIVEN so `{seed, setups, commands}` alone
reproduce it. So a step's `stage(world)` is applied to a world that has just been built, at tick 0,
before the robot may move — the same moment `stageBiobuzz` lays the field out — and moving to the
next step **REBUILDS** the world and stages that one, exactly as `startMatch`/`restart` do
(`GameController.rebuildForTutorial`). Everything else follows from that:

- **It runs as FREE DRIVE**, and all three consequences are wanted. Drivable from tick 0 (no
  countdown and no 30-second AUTO, six times over); BIOBUZZ bills **no fouls outside the played
  periods**, so the step that asks for a NECTAR in a FLOWER cannot hand out a G410 MAJOR for doing
  as it says; and free drive is **never recorded** (`startMatch` returns on a phase that is not
  `pre`), which is the honest answer to "could a replay reproduce a staged world" — it could not,
  so none is kept. ⚠️ **DECODE's penalty engine DOES run in `freeplay`** (`src/sim/penalties.ts`
  says so), so a DECODE step staged near the gate can bill the player; the TUTORIAL lane asserts
  every scripted run ends with zero fouls.
- **It is not a `GameSettings` field.** A run is not a preference: settings persist to
  localStorage and sync to Postgres per account, so a "in the tutorial right now" bit would follow
  the account to another machine and survive a reload onto a screen with no idea what was staged.
  It is a `GameView` prop and a `GameController` option, and it does not survive a refresh.
- **The seen flag is `decodesim.tutorial.v1`**, per device and FAIL-OPEN both ways
  (`src/tutorial/flag.ts`, the `chainDisclaimer.ts` pattern): a read that throws answers "not
  seen" so the offer appears, and a write that throws is swallowed. Set on completion AND on Exit.
- **Predicates are evaluated every SIM TICK**, not at the 10 Hz HUD poll: several of the things a
  step asks for are cleaned up by the ticks that follow them (an up CELL is emptied by the tip it
  caused), so a predicate read six ticks late can look at a field that has already been tidied.
- ⚠️ **A PREDICATE MUST BE FALSE ON THE STAGED WORLD.** A step that is already true when it opens
  completes instantly and teaches nothing, and the failure is invisible — the card flashes past.
  The SHOOT step shipped as `contents.length > 0` and the field stages three NECTAR in every up
  CELL, so it was true at tick 0 for both alliances. The TUTORIAL lane asserts non-vacuity for
  every step under both physics and both alliances, which is the only place that can catch it.
- **Hints are functions of `ControlBindings`**, never strings. Every control in this app is
  rebindable, and a tutorial that names a key the player has moved is worse than one with no hints:
  they press what it says, nothing happens, and the step they are stuck on is the one that was
  meant to teach them the control. A connected pad names the BUTTON instead.
- **A step may not apply to a build.** `TutorialStep.applies(spec)` is resolved once, when the
  runner is constructed, so the card numbers the steps that are actually going to be asked for.
  BIOBUZZ's two FLOWER steps are exactly complementary (place a NECTAR needs a Box Tube *and* a
  launcher that carries NECTAR; retrieve a POLLEN needs neither), and the lane asserts every build
  is offered exactly one of them.
- **The card is a `data-hud-band` element, never an overlay** — no popups over the field, per the
  HUD rules above, and a step card is up for the whole of a step. `data-hud-band` is load-bearing:
  `GameController.refreshHudInsets` measures it so the 3D camera reframes the field above it, and
  `.game-root.view-3d [data-hud-band]` is what gives it the fixed dark scrim a lit 3D background
  needs. Its CSS is `src/ui/tutorial.css`, imported from `main.tsx` for the reason
  `predict.css` is.
- **Surfaces**: the first-run card on the Modes page (hidden once the flag is set), and a
  permanent "Run the tutorial" entry in Controls — which is where somebody who skipped it, or who
  has just rebound half their keys, gets it back.
- **Verification**: the `TUTORIAL` lane in `scripts/smoke-biobuzz/` (`npm run test:bb`, also
  inside `npm test`). It drives every step of both games to completion with scripted commands
  under both physics and both alliances, and asserts non-vacuity, ball conservation, the
  hopper/held mirror, determinism of staging, the `applies` partition, and that the hints follow
  rebound keys and a connected pad.



## Dialog titles, and the phone sweep (2026-09-22)

- **A SHELL DIALOG'S TITLE IS `ds-dialog-title`.** `.overlay-panel h2` is a bare element rule
  carrying the MATCH overlay's 3px all-caps tracking, and exactly one element wants it
  (`GameView`'s `RED ALLIANCE`). The six sentence-case dialogs in `App.tsx` inherited it and
  came out as 20px of plain ink spaced like a sign — no chosen weight (the browser's `bold`
  stood in), no token colour, no line-height, and the one heading in the app that belonged to
  no design system. `.ds-dialog-title` puts them on `.ds-h2`'s type, and the same class fixes
  `.net-overlay-card h3` ("Connection lost", "Reconnecting…"), a bare `h3` for the same reason.
  It pairs with `.ds-dialog-actions`, which made exactly this split for the BUTTONS already.
- **`.ds-title h1` is `.ds-h1`'s type.** It was 26→40 against 26→38 — the same heading on two
  page shells, two clamps, visible only by navigating between them.
- **A NAME CLAMPS; IT DOES NOT BREAK ITS ROW.** `.lb-name-h` / `.lb-at` are nowrap ellipses
  with `ch` caps, and `.lb-scroll .ds-table` has a 520px floor so the board SCROLLS instead of
  squeezing the one column with prose in it (`.mh-table` has had that floor since its own
  sweep). Without both, a 24-character handle came apart one word per line and a duo row stood
  five lines tall beside one-line rank and score cells.
- **`.ds-player` WRAPS.** The lobby/strategy roster row was one non-wrapping flex line, so on a
  phone READY — the chip a driver actually watches — was off the right edge of a `.ds-panel`
  that clips. It wraps at `row-gap: --ds-s-1` now: name line, then the chips.
- **`.ds-segs.even`** is the modifier for a strip that cannot fit: under 640px it becomes an
  `auto-fit` grid, so the six drivetrain filters read as a deliberate 3 + 3 rather than a
  ragged 4 + 2. Not a scroller — a filter must not hide how many options there are.
