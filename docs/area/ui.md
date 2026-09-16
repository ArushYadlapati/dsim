<!-- governs: src/ui/**, src/input/**, src/render/**, src/settings.ts, src/theme.ts, src/audio.ts, src/main.tsx, src/seo.ts, src/download.ts, src/contributors.ts, src/desktop.ts -->
# UI — controls, settings, audio, HUD, and the copy rules

Rebindable controls, assists, persisted settings, HUD product rules, and the UI COPY house rules — which were settled by a measured audit, so read them before writing any user-visible string. `docs/ui-standard.md` is the CSS half.

*Split out of `CLAUDE.md` on 2026-09-16, **verbatim** — CLAUDE.md is loaded into every
session and this is not needed by most of them. The `governs:` line above is read by
`scripts/docaudit.mjs` and by the editor hook, so keep it accurate when paths move.*

---

## Controls, settings, audio

- **Controls are fully rebindable** (`src/input/bindings.ts`, `src/ui/ControlsSection.tsx`):
  every keyboard action, gamepad buttons, AND the drive/turn stick assignment. Escape is
  reserved (menu/cancel — never bindable). Conflict policy: a rebound key is STOLEN from its
  old action (may show UNBOUND). Defaults: WASD drive, Q/E or ←/→ turn, Shift/K intake,
  Space fire, C catalyst (CR), F flip-front, P park, Enter start, R restart.
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


