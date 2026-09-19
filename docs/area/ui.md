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
  a review caught). Two things the rules deliberately do NOT do, so nobody rediscovers them:
  overlapping chords that are not nested all fire (`LB + RT` and `RB + D-UP` held together
  also satisfies an `RT + D-UP` bound elsewhere, exactly as `&&` on the real pad would), and
  masking reads SATISFIED rather than fired, so under a three-chord the two-chord's wait also
  silences the single for its length. With no combo bound, none of this runs: the fast path is
  the old any-button test with no state. All of it is pinned in `npm test`.
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

## HUD / UX product rules

- HUD mimics the FTC live scoring display: red|timer|blue bar at the BOTTOM.
- **No popup toasts over the field** — events go to the muted left-edge log; zone status lives
  in the top-right chips.
- Visible MENU/RESET buttons on the game screen (don't rely on Esc/R knowledge); "MATCH
  BEGINS IN" text lead-in before the 3-2-1 digits.
- END GAME at 20 s left (`ENDGAME_START` / `CHAIN_ENDGAME_S`): warning cue + HUD label/tint.
- Games opt into chrome via `GameModule.ui` (`showScoreHud`, `startEditor`, `intakes`).
- ⚠️ **`.hud` IS `pointer-events: none`** so the canvas keeps a drag. Anything in it meant to
  be clicked re-enables them ON ITSELF (`.game-btn`, `.sponsor-chip`, `.mobile-btn`,
  `.pred-panel`). The connection chip did not, for months: its `onClick` opened a ping graph
  and the click never arrived. **Before adding a control to the HUD, add the rule.**
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
- **A name always gets `SupporterBadge`, as a SIBLING** — see the badge rules above.
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


