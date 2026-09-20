# HANDOFF — 2026-09-20a (alpha: third playtest pass — phantom hive corner, phantom hive tip, the hive's pivot hardware, Box Tube reach, disabled-robot prediction, intake in the transition, spent friend challenges)

**READ FIRST.** Seven owner items. Gates on the final tree: `npm test` ALL PASS (3,143 biobuzz +
shared), `build`, `server:check`, `uiaudit`, `docaudit`, `bundleaudit`, `test:mm` (200), `dbtest`.
Not run: `shiftaudit`, `test:ai`. `dsim-alpha` was redeployed (server code moved: the challenge
clear and the 3D collider set). Production untouched.

- **The hive foot bar is ONE box** (`sim3d/fieldColliders.ts`, `squareFootBars`). The exporter's
  bar plus two feet buried 0.11 in behind its face left an internal edge; a pressed chassis sits
  0.09 in in and its leading corner stopped dead on the foot's side face (mecanum, 0.8 push / 0.5
  strafe, stuck at y 9.14, blue bar, +y only). The 8-point decimation had also made the bar a
  wedge (24.73 → 24.62). Same class of bug to look for anywhere two CAD hulls are near-coplanar.
- **Parts bolted to the TRAY are tray colliders** (`cadTrayRiders`, `buildHiveTray3d`): the eight
  Churro braces and, per hive, two pivot brackets, two damper holders, two dampers. They ship under
  the static frame in both the GLB and the collider JSON. The renderer now carries all of them on
  the tilting group (`renderFieldGlb.ts`, selected per welded COMPONENT within 1.25 in of the tray
  centreline — per-triangle slices the A-frame top corner); physics had them frozen at the captured
  pose. Zero density, so the see-saw's calibration does not move.
- **Only the UP cell loads the tip** (`sim3d/derive.ts`). Both cells went into `contents`, which the
  tip pin, the HUD and Table 10-2 read as the up cell's load; a miss through the open down cell
  counted. 7 up + 1 down tipped at tick 330. Both cells are still TAGGED `hive:<a>`. A physical
  knock was ruled out: 480 shots at 260 in/s never moved a pinned tray.
- **The 3D predictors zero the command while robots are disabled** (`sim3d/predict.ts`, `liveCmd`).
  They re-stepped the raw stick through `pre`, the transition and `post`. The phase read is the
  last snapshot's, so the local robot wakes one snapshot after the server enables it.
- **The drawn intake is gated on `robotsEnabled`** in `render/renderer.ts` (all games),
  `biobuzz/drawRobot.ts` and the 3D roller.
- **The Box Tube reaches the flower's opening** (`scene/renderRobots.ts`, `bbBoxTubeStages` /
  `bbBoxTubeAim` in `config.ts`). Shoulder on the frame rail (an inboard pivot rose through a centre
  turret), fixed cradle + four pitching stages, pose solved per frame from the flower
  `bbFlowerInReach` returns, 0.12 s. Render only.
- **A friend challenge is cleared when it is used** (`clearRoomInvitesTo` on the recipient's join,
  `clearRoomInvites` when the matchmaker stages a rated party token, plus the client's own dismiss
  in `onJoinInvite`). It only ever aged out at `INVITE_TTL_S`. The join clear is scoped to the
  recipient on purpose: a host reconnect must not delete an unanswered invite. No WS-level test
  exists for the two call sites; `dbtest` covers the repo half.

Open: the AI lane's `bot-driven 2v2 step3d p95 <= 1.5ms` flickers under load on the dev box
(1.41–1.61); it passed in the full run. An element can still come to REST in the down cell — it is
excluded from the load and counted when that cell comes up, which is right, but nothing evicts it.

---

# HANDOFF — 2026-09-19e (alpha: THE FLOWER LANE FINISHED, plus the owner's second playtest pass — intake front, shooter head, turret lead, catapult dumper, tape, hive sheets, G417 out / G407 per the manual, FPS slider, game-specific keybinds on top of PR 81)

Twelve owner items, run as parallel lanes and merged here. Every gate below was run
on the MERGED tree. The one thing that needed the coordinator rather than a lane is the first
section: the lanes each wrote a real 2x room-tick regression off as "machine load".

## ⚠️ A RESTING ELEMENT NEVER SLEPT, AND SCATTER IS WHAT MADE THAT EXPENSIVE

`perf: a 2v2 BIOBUZZ ROOM tick costs <= 1.2x a 2v2 Chain Reaction room tick` read **1.41–1.92 in
ISOLATION** on the merged tree against 0.77–0.96 at `f17395f` on the same machine, same hour (bb
0.29 → 0.55 ms). Three lanes saw it, and each blamed contention — because this file says that
check is load-sensitive. It is; and it was also really broken. **If it fails, run the same check
in isolation on a baseline worktree before believing either story.**

Bisected by toggling: not the flower cage, not the chassis contact skin, not the pocket filler
(each removed alone: no change). It was the STAGED SCATTER — but only as the trigger. The cause is
older: every element at rest in a FLOWER or a CELL was woken EVERY TICK, by two zeroing writes with
`wakeUp: true` (`groundRoll3d`'s floor-band branch, which the BOTTOM element of a flower column
sits in, and `syncElement`'s diff-teleport, which fired on every `derive.ts` rest snap). Measured,
idle 3D world, tick 900: 16/16 FLOWER and 6/6 CELL elements awake at `vmax` 0, against 0/16 on the
tiles. Nearly free while a column stood dead on the bore axis (an element touches two neighbours);
scattered, every leaning element is a standing wall contact: idle step 0.168 → 0.302 ms.

Fixed in `sim3d/engineImpl.ts`, three edits, each with its measurement in the comment: a rest snap
zeroes WITHOUT waking; the floor-band write wakes only what is moving; and READBACK calls
`wakeUp()` on any element whose rounded position moved more than `RELAX_EPS` (5e-4 in) that tick —
without that last one a scattered column fell asleep MID-SEPARATION (interpenetration 0.13 → 0.69
in). `RELAX_EPS` is a measured knee (table on the constant). After: idle step **0.124 ms** (below
the pre-scatter 0.168), room tick back to bb 0.29–0.33 ms; CELL elements stay awake (they touch the
jointed tray). The SIM3D "relaxation DECAYS" check now accepts all-zero drift, which is the
expected reading; its comment says why.

## What landed

- **THE FLOWER LANE (the item this branch was opened for).** The jam was the TUBE, not the balls:
  between the mid plate (5.254) and the top plate (20.254) a flower has NO WALL, only four round
  pipes with open gaps — a POLLEN centre reaches 0.53 in toward a pipe and 1.05 in into a gap, so
  two shoulder and the column arches (stranded 10/24 at n=4, 22–24/24 at n=7). `buildFlowerCage3d`
  (`flowerTube.ts`) is ONE circumscribed trimesh prism per flower on the middle bore's own CAD
  radius (1.948) — the 12-cuboid fan failed the AI lane's p95 (1.86–1.95 ms vs 1.5), the prism
  does not (1.25–1.44); fewer than 10 sides puts a vertex past the pipes. Jam 0/360, drain 0/64
  (n = 1..8 × 8 seeds, real retrieval), NECTAR still locks. SCATTER: `flowerPlace3d` and, in 3D
  worlds only, the pre-match STAGED columns, offset by a hash of `(tick, id, flower, rngState)` —
  `rngState` READ, never advanced; the bound is `bbFlowerDropSlack` × `BB3_FLOWER_SCATTER_FRAC`
  (the tightest BORE, not the cage — against the cage a drop landed inside the peanut supports
  and was ejected 8–28 in). **2D is byte-identical, proven**: 30 worlds built through today's and
  `f17395f`'s spawn code, whole-JSON + `worldHash`, 0 divergences. The old "DO NOT JITTER IT"
  table was re-measured flat once the wall existed; both headers say so.
- **THE INTAKE FRONT IS A RECTANGLE (owner: "the intake plates stick out further than the rollers
  so the hitboxes are weird").** Two earlier passes answered the wrong question (arms end at
  `uOut`; true, irrelevant). The compound's outer prism had exactly ONE hole — between the arm
  tips, floor to `BB3_MOUTH_SLOT_Z` — and eight statics fit under the lintel (six hive base
  bars/feet at 2.13–2.15 in, two flower base plates; never a robot, `BB3_HEIGHT_MIN` is 12). A
  hive bar's end sat **2.03 in inside the robot's own `robotExtents` box** and yawed it 128°.
  `chassis3dPocketShapes` adds one FILLER per mouth that everything meets EXCEPT elements
  (`GROUP_ELEMENT` / `GROUP_POCKET`; the masks table is in `bodies.ts`). After: 0.15 in. Capture
  counts, flat-wall rest, start legality, no-climb: unchanged. Cost 1.049x step (8 paired rounds;
  an earlier "+20 %" was contention; lifting the filler off the floor bought nothing and would
  have re-opened the hole — the shortest reachable static is 0.24 in). Also kept: a 0.125-in edge
  break as a CONTACT SKIN (`chassisBoxDesc`; a `roundCuboid` cost 1.065x), mirrored in
  `predict.ts`. Drawn: a front BRACE across the tips + rounded plate noses, 3D and the 2D sprite.
  ⚠️ **Every corner probe the stopped lane left in `scratch/` drove `driveX: 1`, which is STRAFE.**
- **THE SHOOTER HEAD (owner: "the parallel plates became ugly … the arc does not need to be big";
  "the flywheel looks like two wheels").** The fixed plate is the compact pre-`f17395f` outline
  again; the HOOD carries its own sector CHEEKS on `bb-turret-pitch` (boss on the axle, span =
  `BB_HOOD_WRAP`, inboard of the plates), so it is one hinged assembly at every pitch and nothing
  is left standing at the 80° cap. ONE flywheel mesh at y = 0 with bare shaft and collars (it was
  two meshes at ±0.7). Muzzle chain BYTE-IDENTICAL: sha256 over 62,447 rows of `bbMuzzleLocal` +
  `bbTurretSolution` equals `f17395f`'s.
- **SHOOTING ON THE MOVE (`feat/bb-turret-lead`).** A release leaves with `v + ω×r` at the muzzle
  (turret AND dumper, both pipelines — there was NO inheritance before, so nothing to lead).
  `bbTurretSolution` leads inside the same fixed `BB_TURRET_SOLVE_PASSES`; parked it is
  byte-identical (289 poses, deviation 0). `bbSlewTurret` is rate + ACCELERATION (`BB_TURRET_ACCEL`
  70, `BB_TURRET_PITCH_ACCEL` 12): 90° in 0.333 s, overshoot 0. `turretHeading` is WORLD-frame and
  the rate window is centred on `r.angVel`. Flat out past the hive 75–100 % of released shots
  score; a hard reversal leaves it 22–24° behind for 0.60–0.75 s and the gate releases NOTHING
  meanwhile. New optional `bbTurret*Vel` fields: +2.5 % snapshot (7,826 → 8,021 B of 10,000).
  ⚠️ **3D's release gate is now the ballistic landing check, not alignment — an outcome change in
  every server match, owner-authorised by the instruction.**
- **THE DOTTED PATH.** Six causes of a path with no score, closed: empty hopper, wrong phase,
  passive robot, a dumper mid re-arm, 3D gating on alignment while the path ran a landing
  prediction (ONE predicate now: `bbTurretShotEnters` / `bbDumpShotEnters`), and a MID-SWING hive
  (28 of the last 28). Before 24.6 % (2D) / 53.8 % (3D) false paths over 1,600 cases; after 0.
  ⚠️ **THEN THE OWNER RULED ON THE LAST ONE, THE SAME DAY: the path is drawn "in the case that we
  can make the shot assuming that the hive is completely up on the side that we are aiming for".**
  So `solveShotPath` asks `bbPretendHive` — the fire gate's own copy — and a cell that is DOWN or
  MID-SWING still draws a path; the `hive.tipping > 0` refusal is gone, and so is "against the
  REAL hive". Path and gate are one verdict with no exception (a RENDER check re-asks the gate by
  hand over a pose spread: 0 disagreements). The "0 false paths" figure above was measured with
  the refusal in, and no longer holds for a down/swinging cell BY DESIGN.
- **THE DUMPER IS A CATAPULT.** `bbDumpCluster`: four seats, two across × two high, ONE velocity,
  parallel arcs; the whole hopper on one tick. The 3D stagger (`perDump`, `BB_DUMP_STAGGER_S`) is
  deleted; 2D keeps the converging solve (`BbShot.cluster` is the switch). 20/28 poses score
  (equals the stagger), 16/28 all four. At 22 in the bottom row clips the structure — pinned.
  `bb-dump-arm` snaps off `lastFireAt`; no wire field.
- **TAPE WIDTHS — THE FIFTH REPORT, AND IT WAS NEVER THE DATA.** All 16 strips are 1.000 in. The
  map draws at 2–6 device px/in, so where a 3.1-px strip's edges fell inside a pixel decided its
  look. `snapTapeGroup` (`drawField.ts`) snaps a zone's strips as a GROUP to one whole-pixel
  width, corners exact; the fallback floor texture uses it too. The recorder ctx (no `canvas`)
  still gets world rects, so the CAD-strip check is intact. The GARDEN is two 1-in tapes BY THE
  MANUAL (Fig 9-3); it is drawn as one band of exactly two widths.
- **THE HIVE'S CLEAR SHEETS WERE BACK-FACE CULLED.** Three shading passes moved the owner's view by
  under 0.1 of a level because the back of a cell was not being rasterised from behind. NO clear
  surface in `field.glb` is a closed slab — single-sided sheets wound INWARD (two-faced area 0.0 %
  walls, 0.4 % trays). The earlier "not culling" proof binned ±x/±y normals only; a cell's back is
  a gable at (0.54, 0, ±0.84). `DoubleSide` draws a SHEET once from either side, so the layer
  count does not double (the old header assumed slabs). Back skin alone from behind 12 → 35;
  `PANEL_VEIL` 0.018, alphas unchanged (0.08 / 0.13). The RENDER lane parses the real GLB and
  fails on a side/geometry mismatch. The perimeter walls had it too (culled from outside).
- **G417 IS GONE, G407 FOLLOWS THE MANUAL.** Hive-ramming billing, `frameRam`, `bb.hiveRam`,
  `BB_FRAME_RAM_SPEED` deleted in both pipelines; a check rams the frame under both physics and
  asserts nothing is awarded. G407: warning at 5+, and ONE MAJOR per robot per match when 6+ is
  held past MOMENTARY (3 s, manual §10.6) or on the second >MOMENTARY instance of 5+. New line
  `G407 STRATEGIC CONTROL of 5+ elements` — **a foul STRING, so this is a SERVER change.**
- **X-DRIVE.** A 45° omni reaches 1.945 in on both axes and sat in the mecanum channel (1.17 in
  inside the frame): 0.78 in proud. Inset by its own reach; the inner side plate drops, as swerve.
- **MAX FRAME RATE** is a slider (24–360) + number box (to 1000); the top stop is "Display rate"
  on the web (Unlimited is never offered there — rAF is the ceiling) and VSync/Unlimited on
  desktop. A stored `-1` on the web displays as Display rate and is not rewritten.
- **GAME-SPECIFIC KEYBINDS, ON TOP OF PR 81** (`ArushYadlapati/gamepad-combo-keybinds`, merged
  here via `feat/game-keybinds`). `ControlBindings.perGame` is a SIBLING field (old clients keep
  working); an action present there is CUSTOM for that season, absent = SYNCED; `effectiveBindings`
  is the one resolver. Two actions conflict only if some season uses both (`ACTION_GAMES`). A
  main edit that collides with an override: the override loses the bind. `BIND_SLOTS_MAX` 8.
  PR 81's rule-4 TAP lasted one rAF frame and was lost ~2 in 3 at 165 Hz; `PAD_TAP_HOLD_MS` 34.

## Gates (merged tree)

`npm test` **ALL PASS** (shared PASS; biobuzz 3,095) · `build` 0 · `server:check` 0 · `uiaudit`
at/under · `docaudit` ALL PASS · `contrast` ALL PASS · `bundleaudit` ALL ROUTES AT/UNDER ·
`test:mm` PASS. `dbtest` not run (nothing under `server/db` moved). `shiftaudit` not run.
`test:ai`: **ALL PASS** (150 matches, 535 s) — HARD beats EASY 95/100, mean margin 52.5; idle means easy 33.2 / medium 79.1 / hard 101.9. It notes the plan's 90 % is now met and `BB_AI_WIN_RATE_FLOOR` could be raised; left alone, one run.

## Open, and owner decisions pending

- Keybinds: owner, same day — "keybinds should stay the same across seasons for sure". Read as:
  shared is the default. Reset wiping per-season overrides and the scope switch opening on All
  games are therefore right as built; nothing changed.
- AI: owner — ignore the bots for now, they get an overall pass later. `BB_AI_WIN_RATE_FLOOR`
  was NOT raised.
- 3D still slides past a tall post at 0.4 in of overlap where 2D manages 1.0 — a box chassis in
  the 3D solve; no corner treatment closes it (a cylinder does 1.6).
- **NAME MODERATION IS TWO LAYERS NOW, AND THE WORD LIST IS NOT IN THIS REPO.** The owner's key
  works (42/42 names really checked) and is set: DEPLOYED on `dsim-alpha`, STAGED on production
  (`dohun-sim-decode` — takes effect on its next deploy; nothing was restarted). Measured with it,
  the hosted model refuses slurs and threats and ALLOWS most bare obscenities (it classifies
  hate/harassment; it is not a profanity filter). So `server/blocklist.ts` is a local matcher in
  FRONT of it, fed by the `MODERATION_BLOCKLIST` secret — ⚠️ **owner ruling: no profanity in the
  repo and no published list; the checks in `smoke.ts` use a NONSENSE vocabulary on purpose, do
  not paste a real word into one.** The real list lives at `D:/Projects/2ddecodesim/.env.blocklist`
  (git-ignored there by `.env.*`), same secret on both Fly apps, same alpha-now / production-staged
  split. Both layers together: 35/35 should-block, 21/22 should-allow; the one false positive
  ("Assassins …") is the HOSTED model's and no list can fix it — an allowlist secret would.
  Whole-word entries by default (the Scunthorpe problem is real: it was the first false positive
  the real list produced), `*` for substring; CamelCase is a word boundary.
- The models README records the single-sided clear sheets as an asset defect for `field-cad`.

## Next steps

1. Push `alpha`; redeploy `dsim-alpha` (`./scripts/fly-deploy.sh --alpha`) — the sim, a foul
   string and `RobotState` fields all moved.
2. Production (`main`, `dohun-sim-decode`) untouched; promotion is the owner's call.

---

# HANDOFF — 2026-09-19d (branch `ArushYadlapati/gamepad-combo-keybinds` off alpha: GAMEPAD COMBOS + add/remove binding slots, PR into alpha)

**(Previously READ FIRST.)** One commit on the owner's fork, rebased onto alpha `f17395f` and opened as a PR
into `alpha` with the owner's go-ahead (the only conflicts on the rebase were this file and the
generated class inventory). `npm run build` is green, `npm test`'s shared suite is green
(51 new checks in the `gamepad COMBOS` block), `uiaudit`, `docaudit`, `contrast` and
`server:check` are green. An independent review pass (2026-09-19) found two real gaps, both
fixed and pinned: a prefix TAPPED inside the combo wait fired nothing (now rule 4, below), and
the pad capture effect restarted on every App re-render (the 8 s presence poll), dropping a
half-built chord (the effects now depend on `capture` alone, values in refs). The BIOBUZZ
suite has ONE failure that predates this branch and is not touched by it: `fieldDims.gen.ts is
exactly what emit-dims.mjs renders from field-measurements.json`. Its own message says to run
`npm run field-cad`; **do not, on a Mac** — it drops a 92 MB `C:/` tree into the repo root.

## What was built (the owner's request, verbatim intent)

"Combo keybinds for the gamepad, like the multiple keybinds people use IRL … chain keybinds
together once the other keybinds run out, e.g. a lift on D-UP and RT" — and the complaint under
it: changing one binding "messed up everything else", because the screen could only REPLACE a
slot, never ADD one, so every rebind on a full pad cascaded into an UNBOUND somewhere else.

- **Every action takes any number of alternatives**, keyboard and pad: a `+` keycap at the end
  of each row captures into a new slot; Backspace or Delete while a slot is waiting removes it.
- **Gamepad COMBOS**: hold two or three buttons during a capture and the bind is the chord
  (`RT + D-UP`). Capture commits on the first RELEASE so a second button can join; a lone press
  is still a single. `PAD_CHORD_MAX` is 3.
- **The model** (`src/input/bindings.ts`): `PadBindings.combos: Record<PadAction, PadChord[]>`,
  a SEPARATE field from `buttons` — a settings blob is persisted and account-synced verbatim,
  and an older client reading arrays inside `buttons` would reject every pad binding and save
  the defaults back over them. `padBinds(pad, action)` (singles then combos) is the one view
  the resolver, the keycaps, the start overlay and the tutorial hints read. The edit helpers
  (`assignKey` / `removeKey` / `assignPadBind` / `removePadBind`) moved here from the screen so
  the steal policy is pinned by smoke: **stealing is exact** — a single steals that single and
  touches no combo, a combo steals the identical combo and touches no single.
- **The resolver** (`src/input/padChords.ts`, DOM-free, clock-injected): (1) longest satisfied
  chord wins and masks the singles it is made of; (2) a satisfied chord that is a strict prefix
  of a bound, unsatisfied chord waits `PAD_CHORD_GRACE_MS` (80 ms) — nobody presses two buttons
  on one frame, and DECODE's first shot is instant — the wait is the player's own
  `chordGraceMs` (the "Combo wait" slider under Trigger threshold, 20..200 ms, greyed until a
  combo is bound); (3) a fired combo consumes its buttons until released, so letting go of
  D-UP with RT still down does not start shooting; (4) a prefix let go INSIDE the wait fires
  once on release, so a quick tap still counts. Rule 3 is tested before rule 2 so a blocked
  chord is never a waiting one. With no combo bound it takes an explicit fast path: the old
  any-button test, no state. `docs/area/ui.md` lists the two things the rules deliberately do
  not do (non-nested overlapping chords all fire; masking reads satisfied, not fired).
- `gamepad.ts` builds the held set (triggers past `triggerThreshold`) and asks the resolver;
  edge detection for start/restart/flip/park is unchanged. `GameView`'s start overlay and
  `tutorial/hints.ts` print the first bind's label (`padBindLabel`). `.ds-key.add` is the one
  new class (`uiindex` regenerated). `docs/area/ui.md` carries the rules.

## Verified at the surface (hidden offscreen Electron, `scratch/verify-combos.cjs`)

Fake `navigator.getGamepads` stub, DOM assertions: the `+` captures; the keycap reads
`D-UP + …` then `RT + D-UP + …` while the chord builds; releasing binds `RT + D-UP` on the
catapult throw with Shoot's RT and Place POLLEN's D-UP untouched; an identical combo bound to
Park is stolen from the throw; Backspace removes it; keyboard `+`/steal/UNBOUND/Backspace all
behave; the saved blob carries `combos.fling = [[7,12]]` beside untouched singles. In a Solo
Practice AUTO with auto-fire off: holding RT + D-UP for 1.5 s leaves the hopper at 3 of 3
(Shoot masked); with the wait at 200 ms, RT held 100 ms fires nothing and RT held on empties it.
A capture held across the 8 s presence re-render still binds. Screenshots in
`scratch/shots-combos/` (gitignored).

⚠️ **The owner does not want a test window on their desktop.** The driver runs
`show: false` + `offscreen: true`; the verify skill now says so. Do not go back to `show: true`.

## Next steps

1. PR review on `genius0412/dsim` (base `alpha`). Nothing server-side to deploy.
2. Feel-test the default combo wait with a real pad; 80 ms is a judgment call, not a measurement,
   and the slider's 20..200 bounds are the same kind of call.
3. Not built, deliberately: keyboard chords (the request was the pad), and a touch-only way to
   remove a slot (Backspace needs a keyboard; a phone with a pad is rare).

# HANDOFF — 2026-09-19c (alpha: THE OWNER'S PLAYTEST PASS — two launch bugs, the hive registration delay, the robot signs, the frame-rate row; FLOWER LANE STOPPED AND NOT LANDED)

**(Previously READ FIRST.)** Six lanes ran off `d64cf19`. Five landed and are in this commit. **The SIXTH — the
FLOWER lane — was STOPPED mid-work on owner instruction and its source edits were REVERTED**; what
it learned is written down below and its probes survive in `scratch/`. Read "THE FLOWER LANE"
before picking that up, because the expensive half (the measurement harnesses) is already done.

## What landed

- ⚠️ **TWO LAUNCH BUGS, ONE ROOT SHAPE: a Rapier body created or teleported INSIDE a solid, which
  penetration recovery then ejects along the contact normal.** `birthClear`
  (`sim3d/engineImpl.ts`) is the guard, and there were two doors into it.
  1. **Walls and corners.** It built its solid list from `world.robots` ONLY — no walls, no frame
     bars, no flower feet — and its escape marches FORWARD along the arc, which walks a release
     deeper INTO a wall rather than out of it. ⚠️ **Measured NOT reachable on the normal path:**
     576 real shots flush at every wall and corner, 8 headings by 3 mounts, gave **0** bad births,
     because aim assist is forced on by `coerceAssists` and only releases a shot its landing gate
     says enters the CELL, which is always inboard. On MANUAL aim (`r.aimAssist = false`, a branch
     the sim still has) it is severe: birth 2.86–3.84 in PAST the wall's inner face, and five ticks
     later the element was dead and buried in 12 of 21 poses, or 136–176 degrees off in the
     corners. `fieldClamp` now pushes a birth point the shortest way out along that wall's own
     normal with the solved velocity untouched, and the arc march STOPS at the first sample that
     leaves the field. Identity in the open field; the old dumper behaviour is byte-for-byte
     unchanged.
  2. ⚠️ **INTAKE WHILE SHOOTING — this is the one that bit in production.** `birthClear` was gated
     on `!existing`, i.e. it guarded body CREATION and not the transition INTO flight. An element
     normally has no body while `held` (`wantsDynamicBody` is true only for `ground`/`flight`/
     `element`), but bodies are removed only inside `syncElement`, and stage 11 runs capture then
     launch **with no sync between them** (`step3dImpl.ts:148-149`). So on any tick where the
     intake takes something and the turret's beat is ready — the ordinary feed-and-shoot loop, with
     `autoIntake`/`autoFire` on — the element went ground to held to flight keeping its live ground
     body, the guard was skipped, and the body was teleported to the muzzle, a point on the
     mechanism INSIDE the chassis compound. A dumper's lob came out **101 degrees off, apexing at
     10 in instead of 63**; a turret's 2.4–3.6 degrees, born 7.3 in inside the chassis. After:
     **2.1 degrees, apex 63.2**, born 0.00 in inside.
     ⚠️ **THE GUARD IS KEYED ON "TELEPORTED SINCE THE LAST READBACK **AND** `by` STAMPED", NOT ON
     "kind changed to flight".** `derive.ts` re-tags every bouncing GROUND element as `flight`, so
     the obvious rule would teleport a ball in mid-flight clear of a robot it is supposed to hit.
     Only `releasePollen` stamps `by`. An intake pull edits velocity only, so it never qualifies.
- ⚠️ **THE HIVE REGISTRATION DELAY — a rest timer where the physics wanted a depth test.**
  `deriveTick` required `BB3_REST_TICKS` (6) consecutive ticks under `BB3_REST_SPEED` before a ball
  counted as being in a CELL, and `hives[a].contents` — which the tip threshold, `cellCount`, the
  HUD and G410 all read — was built from that. Measured over **1,500 randomized arrivals**, centre
  entering the interior to `contents` holding it: **mean 95.3 ticks / 1,588 ms, p50 75, p90 205,
  max 264, and 1 in 100 never registered at all.** The settling was 84–90% of it. TIP latency
  48–76 ticks (0.80–1.27 s). **After: mean 0.3 ticks / 6 ms, 0 misses; TIP 11–15 ticks
  (0.18–0.25 s).** No animation duration and no tip threshold was touched.
  ⚠️ **THE REST GATE'S STATED REASON WAS FALSE, AND THAT IS WHAT MADE THE FIX CHEAP.** It was
  defended as "a shot crossing the mouth is not yet in it". Of 209 arrivals that put a centre
  inside, 92 left again — and **every one stayed within 2.75 in of the open rim**. Nothing enters a
  one-opening box and comes back. The shallowest a really-landed element ever RESTS is 4.33 in
  down. So `BB3_CELL_SEAT_DEPTH` (3.5 in, mid-window) separates them outright, with a LATCH read
  off `b.state.el` so a counted ball cannot flicker. 0 grazes counted, 0 landings missed.
- **The settle clock asks about MOTION again** (`settle.ts`). The hive fix left a hole: an element
  bouncing in a cell used to be tagged `flight` and held the clock open, and is now tagged
  `element` from the tick it is deep, so it held nothing — and a tray over its load is a TIP **when
  the match is called**, so a clock that can close mid-bounce can miss one. Reproduced at `vz`
  83.57 in/s reading `settled = true`. The gate is inverted now: skip `held`/`stock`, motion-test
  everything else. ⚠️ **The opposite failure is on record in that file** (elements parked on the
  frame are permanently `flight`, and refusing on the TAG held the clock for the whole 10 s cap —
  the owner's "takes forever when nothing is moving"), so this was measured before it was changed:
  across nine end-of-match states, every `element`-tagged ball read max planar `v` **0.0000** and
  max `|vz|` **0.0000**, 0 ticks above threshold, because `derive.ts`'s REST SNAP has no tag gate
  and holds a rested element at exactly zero. Eight bot-driven matches finalize at identical ticks
  with identical scores and **0** predicate disagreements; 51,857 `element` readings in 2D agree.
- **ROBOT SIGNS, to the actual rules.** R401/R402/R403 were fetched from Competition Manual V1
  section 12.4 (pp127–129) rather than guessed. Two signs on opposite surfaces, **6.5 x 2.75 in**
  (2.75 is the only height at which R403.A and R403.B both hold and it still clears R401.C's 2.5),
  solid alliance fill, white Arabic numerals. Two bugs found on the way: the old sign printed the
  robot's **slot index** and not `spec.teamNumber`, and its white border is **prohibited** by R402.
  `-` when the number is 0/unset, matching the 2D team card.
  ⚠️ **`bbSpecKey` NOW CARRIES `teamNumber`** even though it moves no vertex: the number is
  rasterised into the sign texture at BUILD time, so without it a changed number would keep the old
  one on both plates AND in the cached thumbnail.
- **The hive's own surfaces.** AprilTag bleed on the upper face — undecodable by RASTER RESOLUTION
  (1.4 px/in against 0.325-in tag cells, 2.2 cells per pixel), not by opacity, so the bits are gone
  before the texture exists. The sticker label is the manual's two-line form. The back panel was
  never a culling problem: `transparent` with a constant `opacity` multiplies the SPECULAR too, so
  a more see-through sheet got a fainter reflection — backwards; it is polycarbonate IOR 1.586 with
  a Fresnel-weighted alpha now, face-on unchanged at the measured 0.08/0.13.
- ⚠️ **THE BANNER IS BLANK ON PURPOSE, AND IT IS NOT A COMPROMISE.** The CAD's `am-5883 Panel
  Sticker` ships BLANK (`decal#ffffff`); the old `bannerTexture` invented "FIRST TECH CHALLENGE /
  BIOBUZZ / amber rule" and painted it onto blank source data, which is why it read as wrong.
  FIRST's IP policy (rev 04/19/25) restricts LOGOS to registered teams identifying their own teams,
  to written agreement, or to nobody — field DESIGNS are copyrighted material in a different, more
  permissive tier, which is what the rest of this sim relies on. Redrawing the wordmark by hand is
  not a loophole: the brand guidelines say use only the versions provided and forbid altered ones.
  The manual also notes the panel "may not be present at all events". The no-logo assertion is
  STRENGTHENED — the banner body may now contain no `fillText`/`strokeText`/`.font`.
- **Intake plate meshing with the chassis.** `bbMouths` makes every mouth EXACTLY chassis-width —
  `f.half - chassisHalf = 0.0000` at all 20 mouth sites — so the arm's outer face sat precisely on
  the side plate's, with `armX0 = f.rail - 1.1` running 1.1 in of overlapping solids behind it.
- **The hood reads as one assembly.** `BB_SIDE_PLATE_TOP_Z` (+0.967, BELOW the flywheel crown at
  +1.417) was applied over the WHOLE upper hemisphere, including behind the exit lip where the
  hood, its tail and the feed shoe are — so the hood floated 2.95 in above anything fixed, carried
  by two 0.26-in arms. ⚠️ **The VALUE did not move and nothing in the muzzle chain reads it**
  (`sidePlateR` is its only reader); what changed is the ANGULAR RANGE it binds over — a forward
  cut, then a 22-degree relief ramp, then the hood's own arc. Gap **3.23 to 0.566 in**.
- **Chassis colour actually shows.** The file header CLAIMED the deck carried `chassisFill`; the
  code had the deck in the STRUCTURAL mesh, and the cosmetic mesh was four VERTICAL plates
  presenting a 0.22-in edge from above. The deck is cosmetic now, plus a top cap on each side
  plate, with the lane measuring upward-facing cosmetic area (>60 sq in, >25% and <75% of
  footprint).
- **The frame-rate row** (`graphics/settings.ts`, `GraphicsSection.tsx`, `electron/`).
  `30 / 60 / 120 / 144 / 240 / Custom / VSync / Unlimited`. `MaxFps` is a `number` with two
  sentinels (`0` VSync, `-1` Unlimited) and a typed range `[24, 1000]`; `coerceMaxFps` matches the
  sentinels FIRST and exactly so no clamp can produce one, and rejects `NaN`, the infinities,
  `'60'` and `59.5` via `Number.isInteger`. ⚠️ **`0` ALWAYS WAS UNCAPPED** — it was called
  "Display", which is what made it read as a cap; rAF is paced by the compositor, so in a browser
  it IS the ceiling. Unlimited is real only in the desktop shell (`disable-frame-rate-limit` plus
  `disable-gpu-vsync`, appended before `app.whenReady()`, hence a restart), shown on the web anyway
  with the truth on its face. ⚠️ **`update-pref.json` was written by REPLACING the whole
  document**, so adding a second key would have silently destroyed the update auto-check
  preference; it is read-modify-write now.

## THE FLOWER LANE — stopped, reverted, and how to finish it cheaply

Owner instruction, mid-work. **Its source edits are GONE** (`sim3d/flower3d.ts`, `sim3d/bodies.ts`
and `scripts/smoke-biobuzz/flower3d.ts` reverted to `d64cf19`; `BB3_INTAKE_CORNER_*` and
`BB3_FLOWER_CAGE_*` stripped from `config.ts`) — roughly 756 insertions. **Its PROBES SURVIVE in
`scratch/` and are the expensive half**: `flowerstuck{,2,3,4,5}.ts`, `flowersweep.ts`,
`flowerthresh.ts`, `flowerperturb.ts`, `flowerplace.ts`, `flowermissing.ts`, `cageperf.ts`,
`corner{,2,3}.ts`, `cornerfinal.ts`, `intakebox.ts`, `bbintake.ts`, `rapiercaps.ts`.

Three items, none landed:

1. **Placing balls in a flower is too uniform** (owner). `placeFlower3d` drops every element on the
   flower's exact centreline with zero velocity, so a column is a perfect stack. Needs
   deterministic scatter — from `world.rngState` (mulberry32) or from settling the element, NEVER
   `Math.random`, and the draw has to happen where every peer makes it identically.
2. **POLLEN get stuck in a flower instead of dropping.** The lane reached a jam between a PAIR of
   elements across the bore and was probing contact NORMALS (`flowerstuck5.ts`). Its proposed fix
   was a **CAGE WALL**: a fan of tangent cuboid slabs inside the bore, `BB3_FLOWER_CAGE_SEGMENTS`
   12 and `BB3_FLOWER_CAGE_T` 0.5 in, because a trimesh measured WORSE on the SIM3D room-tick
   budget. Inscribed shave at 12 rays is `r * (1 - cos(pi/12))` = 0.066 in on the 1.948-in bore —
   tighter than CAD, which is the safe direction — against 1.02 in of slack for a 2.8-in POLLEN.
3. **The intake corner catch** (owner: "I can get stuck on a corner"). ⚠️ **MEASURED: the side
   plates are NOT longer than the rollers.** Arms end exactly at the mouth's `uOut` for every
   preset — sloped 10.250, vector 10.750, triangle 12.250 — and are flush with the frame laterally
   (+/-8.250 = `hw`). What catches is that the LINTEL spans the same depth across the full mouth
   width from z -5.40 to +9.00, so for anything taller than an element the robot's whole front face
   is `reach` (3–5 in) ahead of the frame, with perfect 90-degree corners. **Do NOT shorten the
   arms or the lintel** — `chassis3dShapes`'s header records that the tips end exactly where
   `robotExtents` ended so flat-wall contact, wall-flush starts and start legality do not move, and
   that thin arms alone let a robot climb a low static (parked 2.14 in in the air, stalled).
   The approach was an EDGE BREAK, not a shorter box: `ColliderDesc.roundCuboid` **is available in
   `@dimforge/rapier3d-deterministic-compat`** (probed at runtime — `scratch/rapiercaps.ts` also
   confirms `convexHull`, `roundConvexHull`, `roundCylinder`), so half-extents reduced by `r` keep
   every flat face in its own plane. At `r = 0.125` the two-edge corner pulls in by
   `(1 - 1/sqrt 2) * r` = 0.037 in and the three-edge vertex by `(1 - 1/sqrt 3) * r` = 0.053 in —
   both under the 0.1 in of resting penetration the solver allows anyway, so no contact distance
   anybody measures can tell the difference.
   ⚠️ **ITS LAST FINDING, UNRESOLVED:** "a 45-degree chamfer still has lockable edges (and locks
   harder at depth) — try a multi-segment arc." Start there.

## Two follow-ups the lanes raised and left

- **`scene/renderField.ts`** (the constants fallback path) did NOT get the Fresnel panel treatment
  the GLB path did, so its panels will look flatter. The three cross-path constants the RENDER lane
  compares are unchanged, so nothing fails — it is a fidelity gap, not a break.
- **The CAD statics gap in `fieldClamp` is open and documented in the code.** It covers the four
  perimeter walls and the tile plane analytically; the rest of the field's statics are CAD convex
  hulls and trimeshes with no analytic sphere-vs-hull escape, and an AABB stand-in would teleport
  an element several inches out of a box that is mostly air a robot legally drives through. No
  reachable launch puts a birth point inside one, which is why it was left.

## Gates

Run on a QUIET tree, after the flower lane was stopped and reverted.

`npm test` **2918 checks, ALL PASS** (shared PASS, biobuzz PASS) - `build` exit 0 -
`server:check` exit 0 - `dbtest` ALL PASS - `test:mm` 197 - `contrast` ALL PASS (221) -
`uiaudit` at/under baseline - `docaudit` ALL PASS - `bundleaudit` ALL ROUTES AT/UNDER -
`shiftaudit` 576 state changes, 0 layout shifts.

⚠️ **`perf: a 2v2 BIOBUZZ ROOM tick costs <= 1.2x a 2v2 Chain Reaction room tick` IS LOAD
SENSITIVE, NOT FLAKY LOGIC.** Three separate lanes hit it while five agents were running; it reads
1.20–1.42 under contention and 0.79–0.86 in isolation, and it passes on a quiet tree. If it fails,
check what else is running before believing it.

## Next steps

1. Merge to `alpha`, push, redeploy `dsim-alpha` (the server moved: nothing here, but the previous
   commit's analytics/admin/suspension did).
2. Production (`main`, `dohun-sim-decode`) is untouched; promotion is the owner's call.
3. The flower lane above is the only owner item from this pass that is not done.

---

# HANDOFF — 2026-09-19b (alpha: THE OWNER'S 25-ITEM PASS, RECOVERED FROM A HALTED SESSION AND FINISHED)

**(Previously READ FIRST.)** A previous session ran out of usage mid-pass over the owner's 25-item list and
left its whole tree UNCOMMITTED in `.claude/worktrees/shooter-simulation-fixes-c916ec` — ~70 files,
7.7k insertions, never committed and never gated. That work is now commit `9162190` (checkpoint,
verbatim) plus the lanes below. **All 25 items are closed.** Every gate is green.

## Where the work actually was (the archaeology, so nobody repeats it)

Ten worktrees exist. Only ONE held live work:

| worktree | state |
|---|---|
| `shooter-simulation-fixes-c916ec` | **the live one** — ~70 files uncommitted at `4a48038`, the tip of every other branch's lineage. Now `9162190`. |
| `alpha-main-divergence-7a6134` | 60 files uncommitted at `56e5836`, superseded — its `shotPath.ts` / `drawShot.ts` / `Results.tsx` are committed in `9b4478a`, an ancestor of `4a48038`. |
| `nice-morse-09b59a` | clean, same commit as the live one. |
| `alpha-ui` | 5 files uncommitted, last commit 2026-09-12. Long superseded. |
| `main-deploy` | ⚠️ leftover UNMERGED index entries from an aborted operation (no `MERGE_HEAD`), local `main` 62 commits behind `origin/main`. Its staged work (`src/net/stagedMatch.ts`, `src/ui/copyText.ts`) is already in `origin/main`, so the leftovers are discardable — NOT discarded here, because that worktree holds production's branch. |
| `biobuzz-3d`, `biobuzz-3d-worktree-*`, `pr-alpha` | clean, all ancestors. |

`origin/alpha` was already at `4a48038` — so the alpha BRANCH was never behind. Item 9's complaint
was about the deployed `dsim-alpha` machine, not about code.

## The checkpoint (`9162190`) — what the halted session had already finished

Items 1, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 25. Audited
item-by-item against the diff rather than taken on trust, and the claims hold: each carries a
measurement or a regression check, not a renamed constant. The load-bearing ones:

- **Item 1, the shooter** (five previous passes rejected). `bbHeadDims(elemR)` in `config.ts` is the
  whole dimension chain: motor at θ = 180°, dead behind the wheel and outboard of the hood's swept
  disc (a); `axleX = pathR`, so the element pinches on the rotation axis it came up (b); the back
  flap is now `bb-turret-throat`, the channel's rear wall and the rear tie (c); `BB_HEAD_POLLEN` vs
  `BB_HEAD_NECTAR` are genuinely different heads — 9.635 in muzzle against 10.035 (d). The RENDER
  lane proves the motor can's front face is behind the hood's rear-most point over the WHOLE pitch
  sweep, rather than asserting an angle.
- **Items 6 and 12, the tape.** The manual (p65) says 1-in or 2-in ProGaff; `docs/biobuzz/manual-distilled.md:510`
  shows the 2-in zones drawn as two 1-in strips, which is why `BB_TAPE` is 16 measured 1.000-in
  strips and `BB_TAPE_2` is gone. No centre cross exists on the real field — the HIVE structure is
  what stands at the centre — so the fake 8-in white cross was removed. **`BB_TAPE_W` is not a line
  width**: every mark is a filled rectangle.
- **Items 11 and 13.** Gated on `quality === 'high'`. The AprilTag check decodes `apriltag36h11Cells`
  against the real `tag36h11.c` payloads for ids 30 and 45 — it is not a picture of a tag.
- **Item 21.** The restitution combine rule was picking Min, so a 30-in drop rebounded 0.9 in once.
  Measured now over eight elements: 1–4 bounces, up to 12.7 in of rebound, ~38 in of scatter.

## What this session added

- **Item 2 — the swerve pod's check was wrong, not its renderer.** `podParts()` merges the fork
  plates, the TOP PLATE and the kingpin into one unnamed `swervePod:struct` geometry, and the check
  took the union bbox of every unnamed mesh — so it picked up the 3.2-in top plate sitting at
  z 3.60–3.90, clear above the wheel's 3.00 crown, and called the 2.1-in fork "3.20 long over a 2.92
  tyre". Both checks now walk the struct's own world-space triangles, keep what reaches the crown or
  below, and RASTERISE the silhouette onto the tyre's bounding square on a 200×200 grid: **74% left
  clear against a 55% floor**. ⚠️ The companion "fork length" metric reads 0.90, not ~1.76, because
  three.js's `CurvePath.getPoints` does not subdivide straight `LineCurve` segments — the only
  below-crown VERTICES are the boss arc's. The rasterised coverage is the real assertion; the length
  metric is a weaker sanity bound than it looks.
- **Item 23 — the replay export camera.** It was `useState<SceneCamera>('driver')`, a literal. The
  live camera is not scene state: it is the device preference in `graphics/store.ts` that the scene
  reads at construction and writes when `c` cycles it. `openMenu()` now seeds the default through
  the same `resolveSceneCamera(interactive, hostPick, pref)` the render loop resolves with, so there
  is no second copy of the cycling logic. `exportView` was already seeded this way; no other export
  default carried the bug.
- **Item 9 — nothing to fix.** `eaf5a71` is in `origin/alpha`. Redeploy `dsim-alpha`.

## Gotchas found while verifying at the surface

- ⚠️ **The perf HUD needs 30 frames before it draws anything** (`getPerfStats` returns null under
  `frames.count < 30`). In an automated browser the Browser pane only paints when a screenshot forces
  one, so the card looks BROKEN at every level until ~30 forced paints have gone by — and then the
  frame times read 100007 ms, which is the harness, not the game. This cost a false bug report here;
  do not file it again. Same root cause as the `world.tick` note in `docs/area/biobuzz.md`.
- `GraphicsSettings.perfOverlay` is deliberately INERT — `GameSettings.perfDisplay` is the one
  setting, and it is four levels (`off` / `simple` / `detailed` / `graphs`), not a boolean. There is
  no UI control bound to `perfOverlay`; do not add one back.

## The admin console (items 24 and 25) — verified at the surface, and it was broken at the door

The checkpoint's admin work compiled and passed `dbtest`, but nobody had ever WATCHED it run. Driven
through `scratch/admin/boot.ts` (the real `server/index.ts` on PGlite with a local JWKS) it turned
out the front door did not work at all:

- ⚠️ **`/admin#tab=users&user=…` ALWAYS OPENED ON LIVE.** `App.tsx` canonicalizes `/admin` →
  `/decode/admin` with `replaceState(canonical)`, and `pathFor` emits no fragment — so the hash was
  destroyed before `Admin` mounted. Every tab link, every account link pasted between moderators,
  and the whole `#tab=`/`#user=` design added in `9162190` had never worked once. `replaceState`
  now carries `location.hash`; the QUERY is still stripped, which is what that call is for
  (`?token=`).
- ⚠️ **`bundleaudit` HAD BEEN RED SINCE `9162190`** — `other` 9.12 KB against a 1.00 baseline, and
  `main` grown to 938.59 KB, because `App.tsx` imported `Admin` STATICALLY and dragged six panels
  into the chunk every player downloads. `lazy(() => import('./Admin'))` puts it behind its own
  route: **main 938.59 → 923.89 KB**, `other` 1.66, a new `admin` route at 25.21. The static import
  predated the checkpoint; what made it fail was the checkpoint's ~1000 new lines behind it.
- **The 30d and 90d analytics ranges rendered a dashboard of zeros.** `from` is computed in the
  browser and floored on the server, so the 30-day preset was ALWAYS microseconds past the
  raw-retention boundary and fell through to `analytics_daily`, which is empty on a service younger
  than the range. A 1-hour boundary grace fixes it (series 0 → 186 points), and an empty aggregate
  tier now says so instead of printing zeros under "read from the daily rollups".
- Four smaller ones: `ds-btn ghost smallall danger` (`smallall` is declared nowhere, so two
  destructive buttons rendered full-size — same bug class as `--ds-font`), a keyless fragment in
  `EventsPanel`, `AccountName` printing "no username yet" beside accounts that HAVE one (it treated
  an unprojected `undefined` as a never-claimed `null` — the same three-state bug as `(no profile)`,
  one level down), a 7-day suspension reading "168 hours", and Refresh disabled exactly when the
  report queue is empty.

All 7 tabs render, 22 read routes return 200, and all 18 mutating routes round-trip AND write an
audit row — verified by diffing `listAudit` across every call, not by reading the code.

**Five moderation gaps closed** (migration `0043`): suspend/lift (a DEADLINE, not a flag, so it ends
by arriving; enforced at BOTH `join` and the ranked `queue`, read from the DB rather than a cache
because it matters most one second after the button); clear an abusive @username (CLEARED, so the
account re-runs `UsernameGate` and no moderator picks somebody's permanent name); delete an account
(the player's own tested cascade, refused for a staff id because `syncStaffRoles` would resurrect
it, audit row written BEFORE the delete since afterwards there is no profile row to join); reports
filed AND received on the account panel; and flagging a Ko-fi payment charged back (it does not
revoke — that stays a second decision). ⚠️ `player_reports` cascades on BOTH parties, so the "filed"
count a moderator judges somebody on is a FLOOR, not a total.

**Deliberately not done: kicking a live session.** Sockets live on the machine serving the request
and one Fly app runs several regions, so a kick from the console would silently miss sessions
elsewhere. The suspension is the cross-region lever; a real kick needs a cross-machine signal.
Also left: events on an aggregate range still read the raw tier (labelled in the banner);
`adminSupporterHistory` in `src/net/api.ts` is now a dead client function.

## Design pass on three left-border accents (the `impeccable` hook, owner asked for a real fix)

The hook flags `border-left: Npx solid <colour>` on a card as the side-tab tell. All three sites
predate this work. The test applied was **does the colour carry anything a reader who cannot see it
would lose** — and it split them three ways:

- **`.eventlog-line`** — carried NOTHING. Identical accent on every line whatever the event was.
  Removed; the 1px full edge was always what separated it from the letterbox.
- **`.ann-item`** — carried nothing EITHER, and the comment that defended it was wrong.
  `Announcements.tsx` renders `<KindBadge kind={a.kind} />` at the top of every item, so the edge
  restated in colour what the header already says in words. Removed, with `.ann-item.season` and
  `.ann-item.act` (which existed only to recolour it).
- **`.intro-card`** — the ONLY one that had to keep its colour. Nothing else in that card says red
  or blue: it prints a team number, a name, a team name, a drivetrain and an ELO. So the SHAPE
  changed instead — 1px frame + 4px left slab became a 2px border all round, and `.red`/`.blue`
  set `border-color` rather than `border-left-color`. Symmetric weight is not a side-tab, and it
  reads better over the intro's dark scrim. `box-sizing` is border-box globally, so it moves no
  layout — `shiftaudit` agrees (576 state changes, 0 shifts).

⚠️ **The hook also reports ~31 `design-system-color` / `-radius` / `-font` findings in
`src/ui/styles.css` that are PRE-EXISTING palette drift**, untouched by any of this work. They are
not addressed here — that is a separate, whole-file pass, and mixing it into this one would bury
the 25 items in unrelated churn.

## The admin harness is real tooling now, not scratch

`scratch/admin/boot.ts` (gitignored) is promoted to **`scripts/adminharness.ts`** / `npm run
adminharness`, and `.claude/launch.json` gains an `admin-harness` entry on port 5189 plus
`"autoPort": false` on `dev` (the owner wants `dev` pinned to 5173). The reason is the trap: the
admin console is the one surface with no automated UI coverage, the harness is how you verify it,
and a launch config pointing at a gitignored file is a dead end on a fresh clone. It touches no
real database and no Fly machine — PGlite in memory, a local JWKS, bound to localhost, gone when
the process is. Same `setPoolForTests` seam `scripts/dbtest.ts` already uses.

⚠️ **It binds 8798/8799 and the client wants 5189.** A harness left running from a previous session
will silently answer your `curl` and make a FAILED boot look green — that happened here. Kill the
old PID before trusting a health check.

## Gates on the merged tree

`npm test` **shared PASS + biobuzz PASS** (2713 checks) · `build` exit 0 · `server:check` exit 0 ·
`dbtest` ALL PASS · `test:mm` 197 · `contrast` ALL PASS (221) · `uiaudit` at/under baseline ·
`uiindex` 251 classes, 0 unreferenced · `docaudit` ALL PASS · `bundleaudit` ALL ROUTES AT/UNDER
(main 923.89, admin 25.21, other 1.66) · `shiftaudit` **576 state changes, 0 layout shifts**.

## Next steps

1. Merge to `alpha`, push, and **redeploy `dsim-alpha`** — that is item 9, and the server moved
   (analytics, admin routes, suspension enforcement at `join`/`queue`, migrations 0041–0043).
2. Production (`main`, `dohun-sim-decode`) is untouched; promotion is the owner's call.
3. `main-deploy`'s stale unmerged entries are still sitting there — see the table at the top.

---

# HANDOFF — 2026-09-19 (alpha: THE SHOOTER REBUILT — hood-only elevation, a 72 mm flywheel on a
turret plate, and the sim's release following the hood lip)

**(Previously READ FIRST.)** The sixth pass at this one mechanism, and the first that changed the machine rather
than a constant. Gates: `npm test` (**2538** — shared and BIOBUZZ both green) · `build` ·
`server:check` · `docaudit` · `uiaudit` · `contrast` (221) · `test:mm` (197) · `bundleaudit`
(scene 201.81 against a 201.44 baseline, inside the 4 KB tolerance and the 250 ceiling) ·
**`test:ai`** (150 matches, 9.5 min: HARD beats EASY 74/100, mean margin 26.2; tiers ordered
66.1 / 113.3 / 127.8 against idle).

## Why five passes failed

Each one moved a constant to answer the last complaint and produced the next: a flat front cut
(accepted); `rIn` raised until the flywheel's rim sat in a bare annulus ("the flywheel looks like it
is not constrained to the plate anymore"); the tail zeroed after measuring AT REST ("the plate is
meshing with the chassis"); `BB_FLYWHEEL_R` cut 2.0 → 1.5 to buy ρ for a motor pocket under the axle.

⚠️ **THE ROOT CAUSE WAS OWNERSHIP, NOT GEOMETRY.** `scene/renderRobots.ts` owned the shooter's
dimension chain privately while the sim owned a flat `BB_LAUNCH_Z0 = 10`. Two sources, no check
between them, so the picture and the physics could disagree indefinitely — and did, for five rounds.
The chain lives in `config.ts` now and the renderer imports it.

## The four owner rulings this implements

| | ruling | what it forced |
|---|---|---|
| (b) | the hood extends above the plates | the plate's outer arc IS `BB_HOOD_R`, so the hood's own 0.28 of material is the proud part, by construction |
| (c) | the flywheel sits right above the turret plate | a real turret plate exists now; the wheel bottom is 0.300 above it |
| (d) | only the hood moves | `bb-turret-pitch` carries the hood arc and two arms and nothing else |
| (e) | a standard flywheel is 72 mm | `BB_FLYWHEEL_D_MM = 72`, never a rounded decimal |

⚠️ **(d) IS WHAT MADE THE REST POSSIBLE.** The pitch node used to carry the whole head, pivoting
about the muzzle, which is the only reason a ρ budget ever existed — the entire assembly swept
through the drivetrain at elevation and everything had to be squeezed inside it. Fixed parts need
static deck clearance and nothing more, so `BB_HEAD_RHO_MAX`, `minHeadWorldZ` and `plateOuterR` are
gone rather than re-tuned.

## The release follows the hood (owner-authorised, it changes shot outcomes)

A hood pivoting on the axle moves its own lip, so the release is no longer flat: **9.634 in level,
8.466 at 57.6°, 7.554 at the 80° cap**, retreating along the heading as it drops. `bbMuzzleLocal`
(`robot.ts`) is the one muzzle and `scene/renderRobots.ts` imports it — the RENDER lane proves the
drawn lip is on the sim's muzzle at every pitch rather than assuming it.

⚠️ **`bbTurretSolution` IS A FIXED POINT**: the elevation moves the release and the release moves
the elevation. `BB_TURRET_SOLVE_PASSES` (4) runs ALWAYS — no early exit, no tolerance — because a
trip count resting on a float comparison can differ between a client's prediction and the server's
authority. A fifth pass moves the pitch by at most 1.76e-9 rad over 7,688 field poses.

Measured consequence, authorised knowingly: scoreable field cells **1359 → 1382** north and
1417 → 1439 south, pitch-capped cells 255 → 211, nothing speed-capped, worst required muzzle speed
253.26 → 256.37 against a 260 cap. The lower release costs a little speed and unblocks more of the
field than it loses. **No version was bumped** — replays from before this re-simulate slightly
differently under the same `SIM_VERSION`, which the owner was told and has not asked to change.

⚠️ **A DUMPER HAS NO HOOD AND ITS RELEASE IS STILL FLAT.** `bbLobThrow`, `bbDumpSolution` and
`bbLaunch`'s dumper branch all still read `BB_LAUNCH_Z0`, and the ROBOT lane carries a leak guard: a
dumper's release stays flat at every pitch while a turret on the same chassis follows its hood down.

## The feed shoe, which is what answered "a weird flap in the back"

A hood on an axle pivot carries its own feed mouth round with it — at 80° of pitch the mouth has
gone 80° round the wheel and the feed no longer lines up. So the wrap shrank 1.05 → 0.556 rad and a
FIXED shoe at `BB_FEED_SHOE_R` 4.397 spans 146°–202° and takes over the entry. It bolts to both side
plates, so it is also the rear tie. The loose plank is gone because something real replaced it.

## What the adversarial check measured, not what the builders claimed

An independent agent built the real `buildTurret()` group and measured world positions:

- meshes under the pitch node: `hood`, `hood-arm`, `hood-arm` — nothing else;
- wheel, plates, braces, motor and feed shoe all diff **0.000000** between pitch 0 and the cap;
- hood-minus-plate gap **+0.280 worst** over 3600 samples, +3.230 at rest, never negative;
- wheel lowest 5.700 against a turret plate top of 5.400;
- sim muzzle vs drawn lip: **0.000000** at pitch 0/20/40/60/80.

It also found a defect neither builder caught: the plate's full-radius arc was documented as
θ ∈ [14.30°, 206.00°] when it is actually **[165.70°, 206.00°] — 40.3°, at the back, and nowhere
else**. Everything from 15° to 166° is governed by the flat top. Corrected in `config.ts`, with the
reason the hood-proud figure is 3.23 at rest and 0.280 at full elevation rather than one number: at
rest the hood rides its arms well above the flat top, and at 80° it has swung round to exactly the
arc stretch.

## Two bugs the build found in the CHECKS themselves

Both had been hiding real geometry, and both are why the RENDER lane passed five times on work the
owner rejected:

1. `radialBar` returned an INDEXED `BoxGeometry`. `mergeGeometries` refuses a mixed indexed and
   non-indexed list, returns null, and `framePart` falls back to `parts[0]` — so each hood arm was
   silently its rim alone.
2. The corridor sweep filtered on the nearest VERTEX's `|y|`. A `CylinderGeometry` standoff has
   vertices only at its end caps, so every brace, the motor and the belt read `|y| ≥ 1.92` and
   dropped out of the sweep unmeasured. It tests the part's y INTERVAL now.

The lane no longer greps source text for the shooter: it imports `buildTurret`, BUILDS the group,
poses `bb-turret-pitch` at 41 elevations and measures vertices.

## Open

- The `+20°` brace leaves **0.133** of exit-corridor clearance. It stands: the side plate's own flat
  top is the binding part there and clears by 0.150 by definition, so nothing fixed at that height
  can do better.
- Far-corner speed headroom is **3.63** against the 260 cap, down from 6.74. A ratchet check fails
  if it drops below 3.6. Raising `BB_LAUNCH_SPEED_MAX` is a balance decision nobody has made.
- `BB_AI_WIN_RATE_FLOOR` stays at 55%. `test:ai` measured 74% and its own footer suggests raising
  the ratchet, but the PRE-change rate was never measured, so there is no way to say whether 74 is
  an improvement or where it always sat. Measure a baseline before tightening it.

# HANDOFF — 2026-09-19 (alpha: THE OWNER'S TWELVE-ITEM PASS — the hive tip, scoring instants, flower
and tile contact, the shooter/swerve/box-tube rebuild, intake cadence, one alliance blue)

Eight commits plus the merge of `origin/alpha` they sit on. Twelve items, all
from playing the running 3D game. Nine were diagnosed read-only first and then implemented under
one-owner-per-file, which is what kept nine concurrent agents off each other.

⚠️ **THIS LANDED ON TOP OF THE PRE-PUBLISH MERGE BELOW, AND THAT SECTION'S PUBLISH STILL HOLDS.**
`alpha` still contains `main`, so `git checkout main && git merge --ff-only alpha` is still a
fast-forward, and the deploy ORDER that section gives — Vercel builds `main` and serves it FIRST,
`./scripts/fly-deploy.sh` from a `main` worktree SECOND — is unchanged and still load-bearing.
Nothing here was deployed.

Four files conflicted with what had landed on alpha meanwhile. Three were mine to keep; the fourth
was not: **`scene/renderElements.ts` took the upstream resolution whole.** That lane found the same
bug from the other end and its answer is a superset of mine — one `bottom = biobuzzPhysics(world)
=== '3d'` deciding whether `b.z` is an underside, applied to the FLOWER branch as well as the hive
one, and it also catches that my earlier "lift by `r` unconditionally" fix had leaked into the 2D
pipeline it was never about.

## 1 · The HIVE tips on the table it promises

⚠️ **THE DYNAMIC TRAY'S TRIGGER IS `BB_TIP_POLLEN`, NOT A TORQUE** (`sim3d/hive3d.ts`). The owner's
report was "it says 0 more to tip and it does not tip", staged as 1 POLLEN + 4 NECTAR: the load
weighed 5701 against a hold of 5915 and the tray sat on its stop for the rest of the match.

No calibration could have fixed it, and that is the part worth keeping. **ONE COUNT DOES NOT
DETERMINE ONE TORQUE.** Measured in one cell at the shipped hold, staging the same count four ways:

| load | crammed 2-wide up the back | guide staging | 2-wide line down the tray |
|---|---|---|---|
| 8 POLLEN | 4560 (no tip) | 7284 | 8051 |
| 7 POLLEN | 4146 (no tip) | 5647 | 6769 (tips) |
| 3P + 3N | 4933 (no tip) | 6869 | 8407 |

The two counts' ranges overlap over most of their length, so no value of `BB3_HIVE_DETENT` separates
them — and both halves of field guide §12.3 were being violated at once on the shipped numbers. The
lane never saw it because every fixture staged one packing. The detent is a PIN THE TABLE LIFTS now;
everything after the release is still the free see-saw. `hiveContentsTorque`/`hiveRestoringTorque`
stay exported because they are how the lane and `scripts/hive-calibrate.ts` MEASURE the tray.

⚠️ **`BB3_HIVE_DYNAMIC = false` IS NOT A ONE-WORD REVERT, AND HAS NOT BEEN SINCE G409 LANDED.**
`bb.spill` — G409's whole tag — is written in exactly one place, inside `hiveDynamicTick`. The
kinematic path never writes it, and all four G409 checks live inside `if (BB3_HIVE_DYNAMIC)` blocks,
so flipping the word kills G409 in 3D **and the lane stays green**. The comments that claimed
otherwise are corrected.

## 2 · A scored line waits for the instant §10.5 assesses it at

⚠️ **AN INSTANT LINE IS WORTH ZERO UNTIL ITS INSTANT HAS PASSED.** Measured before the fix: the
score bar read 4 before the match started and 9 one second into AUTO, 29 s before anything on it had
been assessed.

| line | instant | §10.5 |
|---|---|---|
| LEAVE, AUTO PARK | end of AUTO | F |
| TELEOP PARK | end of the MATCH | G |
| POLLEN/NECTAR in the up-CELL | everything at rest, end of MATCH | C |
| POLLEN/NECTAR in a GARDEN | end of TELEOP, all at rest | E |
| the HIVE TIP, both FLOWER lines | continuous | A, D |

The COUNT stays live — a driver still sees the achievement land — and `BbAllianceScore.pendingPts`
carries what the instants still owe, shown as a `+N PENDING` chip in the muted row, deliberately not
in the panel. `total + pendingPts` is invariant for a field that stops changing. **The FINAL score is
unchanged**: every harvest happens at or after `post`. This is shared rules code, so it moved the 2D
pipeline too — correct for a rules bug, and no version was bumped.

## 3 · The shooter, the swerve pods and the box tube

The shooter plate had been "fixed" twice and kept digging into the chassis, because both fixes
measured the plate AT REST. ⚠️ **THE CONSTRAINT IS THE SWEPT ENVELOPE, NOT THE POSE.** Elevation
rotates the whole pitching head, so `BB_HEAD_RHO_MAX` is the new invariant: nothing on the head may
exceed ρ = `BB_LAUNCH_Z0 − BB_DECK_Z − 0.2`. At rest the old head cleared the deck by 0.45 in and
looked right; at 45° of elevation the feed ramp swept the deck, the belly pan and the wheels and
stopped 0.04 in off the tile. `minHeadWorldZ` is the closed form the RENDER lane samples.

- **Swerve is a pod**: top plate, azimuth ring, fork, 3-in wheel, belt drive, all of it under the
  deck plate's 4.34 in of headroom and inside the frame (`BB_POD_INSET`). A 4-in wheel does not fit
  — it leaves 0.34 in for plate, ring and bearing — which is why COTS FTC pods are 3-in.
- **The flywheel motor** is behind the hood at 205° about the axle, between the plates, driving a
  belt over a 0.68/0.54 pulley pair. It is not beside the flywheel any more.
- **The box tube** telescopes over `BB_BOX_TUBE_EXTEND_S`, off `bbFlowerInReach` — the SIM's own
  predicate, not a second reach model.
- **The in-reach cue** is one predicate and two drawings, the rule the shot path already follows:
  `scene/renderReticle.ts` in 3D and `drawShot.ts`'s `drawBiobuzzReachCue` in 2D, both reading
  `bbFlowerInReach`. The 2D call site is in `draw.ts`, under the shot path, matching the 3D render
  order.

## 4 · Flower and tile contact

A FLOWER column is a physical pile now, not computed heights: four POLLEN settle at gaps
2.735/2.757/2.778 against an ideal 2.8, and a dropped POLLEN's bottom lands at −0.011 in at all four
tubes with `containmentFixes` still 0. A NECTAR is still stopped by the 3.222 bore, so G418 holds.
`BB3_CONTACT_FREQ` 30 (the shared default is 12) is what stopped elements sinking into the tray
floor. The tiles bounce slightly more: `TILE_RESTITUTION` 0.05, which under Rapier's Average rule
makes the element/tile coefficient 0.25 rather than 0.225. `sim3d/predict.ts` took the same number,
or the drawn shot path would lie.

## 5 · The intake

The cadence gate is 0.06–0.12 s per element (was 0.15–0.3). ⚠️ **AND THE GRIP WAS A UNITS BUG**:
`approach(from, to, maxDelta)` was being handed `BB_INTAKE_DRAW_IN` — a SPEED — as a per-TICK
displacement cap, i.e. 3120 in/s² of effective acceleration, so an element reached full draw-in
speed from rest in one tick. `BB_INTAKE_GRIP_ACCEL` (1200 in/s², APPROX) times `dt` replaces it, and
`BB_INTAKE_DRAW_IN` is 84 (was 52).

## 6 · One alliance blue, and it is not the CAD's

⚠️ **THE CAD IS AUTHORITATIVE FOR DIMENSIONS AND IS NOT AUTHORITATIVE FOR THIS COLOUR.** The STEP
gives the hive Goal Ribs `plastic#0000ff`. Pure `#0000ff` is OKLCH hue 264.1° — 1.7° off the most
violet blue sRGB can express, and the worst available answer to "it looks too purple". An assembly
carrying pure `#ff0000` AND pure `#0000ff` is carrying placeholder part colours, the same way its
`#e6e6e6` "white plastic" is one, which `renderFieldGlb.ts` has overridden since the clear-panel
pass.

Every BIOBUZZ blue is **`#007be1`** now — tape, NECTAR, hive accents, the constants-built fallback
scene, the GLB's ribs and the robot silhouette. Hue 252.9°, the least violet a saturated blue gets
before it reads cyan, at the most chroma sRGB has there, and L 0.583, within 0.002 of the red tape's
own lightness. APPROX: **no authoritative AndyMark blue was found**, so this is a perceptual
correction and not a sourced value. RED is untouched — a pure red still reads as red, and the owner
named only blue.

## Open, and deliberately so

- **`BB_INTAKE_LANE_W` stays at 9.** Moving it to 8 gives the default 17-in build a second feed lane
  — a balance change rather than a feel change, and the owner has not ruled on it.
- **`src/config.ts`'s `COLORS.blue` (`#3b82f6`, hue 259.8°) is unchanged.** It is DECODE's and Chain
  Reaction's too; BIOBUZZ no longer reaches for it.
- A staged FLOWER column is born one radius high in 3D — `spawn.ts` writes `flowerStackZ`, which
  returns CENTRES (the one exception to `b.z` being a bottom), and `syncElement` adds another
  radius. It settles correctly on tick 1 now that the column is physical, so it is a first-tick
  drop rather than a wrong resting height.
- A vz −200 shot still peaks at 0.154 in of penetration into the tray floor on the landing tick at
  30 Hz. Settled penetration is what item 3 was about and that is fixed; the transient is not, and
  no check pins it.
# HANDOFF — 2026-09-19 (alpha: PRE-PUBLISH AUDIT — main merged INTO alpha, so alpha → main is a fast-forward)

`alpha` was ready to publish at this commit. `origin/main` has been merged into it here, with the
five conflicts resolved (below), so the publish is a **fast-forward**, no hand-merge:

```
git checkout main
git merge --ff-only alpha
git push origin main
```

Then deploy **in this order and no other**: let Vercel build `main` and confirm the site serves
it, THEN `./scripts/fly-deploy.sh` from a `main` worktree. `docs/deploy.md` → "Deploy ORDER when
the wire protocol moved" says why: the new server refuses every pre-`bb3d` client from every
BIOBUZZ room, and the reverse order locks production BIOBUZZ players out until Vercel catches up.

Gates on the tree this merge commit carries: `build` · `server:check` · `docaudit` · `uiaudit` ·
`contrast` (221) · `test:mm` (197) · `dbtest` · `bundleaudit` (re-measured: `main` DOWN 6 KB gz, a
new `gallery` route) all green; `npm test` is **1878** shared, all green, and **2380** BIOBUZZ with
**three wall-clock `step3d` perf checks red on the audit machine** — the same three are red on the
PRE-fix tree there (A/B, alternated), and green in the 2026-09-19 render-pass HANDOFF below on the
owner's. Every other BIOBUZZ check passes. `npm test` now runs BOTH suites unconditionally
(`scripts/test-all.mjs`). `shiftaudit` was not run this round.

## What the audit was

Eight read-only audits of the alpha-vs-main delta (202 commits, 245 files) by lane — main-only
drift, server/net, security, sim core + versioning, BIOBUZZ 3D, UI, docs/hygiene, tests — then
the findings triaged and fixed in four disjoint batches. Findings the owner has to rule on are
listed at the end; nothing there was decided silently.

## Fixed — things main had and alpha lacked (cherry-picked: `63bc806` `882fda6` `eaf5a71`)

- `applyBallDelta` returns COPIES — a spectator's stationary elements (flower stacks, hive
  cells) were never corrected again. `f52b175`.
- A reconnecting spectator re-spectates instead of claiming a driver slot. `747dae0`, hand-merged
  so the rejoin frame keeps alpha's `caps: CLIENT_CAPS` (a `'3d'` room re-gates a reclaim).
- Restarting a solo record run works — `releaseSeatLock` / `abandonSlot` /
  `releaseSoloRecordHold`. `aca358e`; this was the regression main's 2026-09-17b section is about,
  and alpha never had the fix.

Everything else on main was already on alpha by content. Main's `ff5044c` (revert of the
HIVE-feel batch) is the ONE intentional divergence and the merge resolved it to alpha — see the
versioning entry below for why that is now safe.

## Fixed — replay fidelity

- **`SIM_VERSION` 2 → 3.** Main and alpha both stamped 2 over DIFFERENT `step()` behaviour for a
  BIOBUZZ world (six-draw spill, `hiveDeflect`, load-driven swing rate, CAD geometry, the 2D
  intake rewrite, `bbSnapSize`). The ledger in `src/config.ts` now lists all of it under 3, and
  says plainly that replays recorded 2026-09-13→17 are mis-stamped 2 and will play as `behaviour`
  DRIFT on a v3 build, which is the correct label. A bump is a drift, not a refusal.
- Main's spill draw-count tripwire is ported to the FIELD lane, retargeted to **6**. The next
  change to that number comes with another bump, in the same commit.

## Fixed — server

- `verifiedFromSession` (the email-verified fallback) is deduplicated per token and has a 2 s
  timeout; it was an unbounded, un-timed HTTP call on the join hot path, made even when the gate
  it feeds is off.
- A ranked / matchmade room cannot start before the 3D wasm has resolved
  (`physicsReadyForRoom`): custom rooms waited, `startRankedImmediate` / `beginRanked` did not.
- `Room.stop()` frees the match's Rapier 3D world (`disposePhysics3dFor`). The engine map is a
  `WeakMap`, so dropping the World dropped the only handle without `free()`, and wasm linear
  memory never shrinks — a few hundred 3D matches would have held every one.
- `addBot` mints unique seat ids (`bot-<seq>-<code>`); remove-then-add reused an id.
- `caps` off the wire is coerced (`coerceCaps`: strings only, ≤16) at all eight sites.
- `lanRateOk` / `exportRateOk` sweep unconditionally; `POST /api/user/settings` body capped at
  64 KB (was 512 KB, unlimited calls); `accept-terms` short-circuits when the version is already
  accepted.

## Fixed — client / UI

- `TermsGate` and `UsernameGate` STAND DOWN on `/terms` and `/privacy` (`suspended`). They are
  full-viewport backdrops beside the routed screen, so the gate's own "read the terms" link opened
  a tab with the same gate over the document. The acceptance fetch still runs.
- Results: `solo` is "no opposing roster", not "no session" — a BIOBUZZ practice against bots
  showed a one-sided screen for a match that had an opponent and a winner. The eyebrow still says
  SOLO PRACTICE for any local run. The record run's net score is animated once (it was tweened
  twice, and the inner tween restarted every frame).
- `AuthPanel` is a real dialog (`role="dialog"`, labelled, Escape closes); auth errors are
  described, not dumped (`describeAuthError`). The prediction picker has group semantics and a
  focus ring; Results overlay buttons have a visible focus ring on the field surface.
- The analytics beacon strips the QUERY STRING, and URL canonicalization compares
  `pathname + search` — a reset / verification `?token=` on an already-canonical path was never
  cleaned and left the device inside a pageview.
- `safeHref` no longer admits protocol-relative (`//evil`) links in admin markdown.
- `vercel.json` sends `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `Referrer-Policy`,
  `nosniff` — the one-click consent controls were frameable.

## Fixed — BIOBUZZ 3D

- `renderElements.ts` branches the parked-element z convention on the PHYSICS
  (`biobuzzPhysics(world)`), never on `state.kind`: 3D writes a bottom for every ball, 2D writes a
  centre for a parked one. Both mistakes had shipped, one per branch (hive floating 1.4 in in 2D,
  flower sunk a radius in 3D). Pinned numerically in the FLOWER3D lane against the real body.
- The FULL predictor stands its robots at `bbHeightNow` (stowed before the match, deployed after)
  and re-fits across the R102 deploy edge, reading back against the height it actually built. It
  used `robotHeightIn` — deployed whatever the phase. **Its chassis stays ONE `robotExtents`
  cuboid, deliberately**: giving it the authority's open-mouth compound was built, measured
  (forty-tick reconcile 3–6 ms → 9–11 ms on the local robot alone, 16–17 ms on all four, A/B
  alternated against the tree without it) and taken back out, because Auto reads that probe
  against `PREDICT_FULL_BUDGET_MS = 8` and would have picked LIGHT everywhere. Written down above
  `makeRobotBody` in `predict.ts`; owner decision 11.
- `GameController.adoptWorld` frees the outgoing world's 3D solve on every swap (five sites) and
  on `dispose`; `bufferSnapshot` reads the physics off `snap.world`, not the previous world (the
  first snapshot of a 3D room dropped its ball poses); both `initPhysics3d()` continuations check
  `disposed`.
- WebGL context loss is watched (`watchContextLoss`): the match scene falls back to the 2D view
  with an event-log line, the builder preview tears itself down. Without it a lost context is a
  frozen field that still takes input.
- `renderScene.dispose()` frees robots through `BbRobots.dispose()` BEFORE the blanket walk, which
  was freeing `SHARED_GEO`/`SHARED_MAT` out from under the builder preview.
- The scene gallery is `React.lazy` (`GalleryRoute.tsx`) — a gated dev route was still a static
  import, 6 KB gz in `main` for every player of every game.
- The RENDER lane's `three` boundary check now catches subpath imports and scans all of `src/`.

## Fixed — docs and hygiene

- `CLAUDE.md`: BIOBUZZ is a full scored ranked game, not alpha-only; the repo map gains
  `src/tutorial`, `src/lib`, `src/lan`, `src/games/biobuzz`, `api/`, `electron/`; counts current.
  26,896 of the 27,000-byte docaudit budget — the next addition must cut something first.
- `README.md` rewritten: DSIM, three games, playdsim.com. It described a DECODE-only 2D sim.
- `src/seasons.ts` header said "DohunSim, only DECODE is playable". Fixed.
- `docs/area/netcode.md` governs `api/**` (the `api/download.ts` Vercel function had no owner and
  was invisible to `docaudit`). `docs/multiplayer.md` carries a HISTORICAL banner.
- `docs/area/biobuzz.md`: the alpha-only paragraph and the "kinematic tray, `BB3_HIVE_DYNAMIC =
  false`" sentence rewritten to the shipped config.
- `docs/deploy.md`: the deploy-order section above.

## The merge of main into alpha — how the five conflicts went

| file | resolution |
|---|---|
| `HANDOFF.md` | alpha's sections on top; main's 2026-09-17b and 2026-09-17 sections kept verbatim in their date order (the 17b one is the only record of the record-restart cause AND of the still-open "account in a live versus is admitted to a new solo record room" gap) |
| `src/games/biobuzz/hive.ts`, `state.ts` | **alpha** — the physics-agnostic `hiveTimerStep` the 3D pipeline depends on; `angle`/`angVel` are the dynamic-tray readback |
| `src/net/serverSession.ts` | **alpha** — it already carries main's `if (!spectator)` guard (cherry-pick `882fda6`) plus `caps` on the rejoin frame |
| `scripts/smoke-biobuzz/field.ts` | **alpha** — its 12 hive-feel checks plus main's draw-count tripwire at 6 |
| `src/games/biobuzz/play.ts` | NOT flagged by git, auto-merged to main's REVERTED text; restored to alpha's (`hiveDeflect` in the flight loop). A merge algorithm was making a gameplay decision |

`SIM_VERSION = 3` is what makes "take alpha" honest here: main's replays at 2 play as drift on
3, labelled.

## Owner decisions — nothing below was decided for you

1. **Deploy order** is the mitigation for the `bb3d` lockout; the zero-window alternative is an
   env flag in front of `serverPhysics`/`boardPhysics`/`stagedPhysics`. Not built. Say so if wanted.
2. **Every production BIOBUZZ record row is `'2d'` and vanishes from the boards** the moment the
   new server boots (`boardPhysics`). Filtered, not deleted. Your ruling of 2026-09-18 implies it;
   confirm you want it, or change the one predicate before deploying.
3. `jwtVerify` (`server/auth.ts`) is called with no `issuer` / `audience` / `algorithms`. Pinning
   them needs a live Neon Auth token to read the claims off; not done blind.
4. `ADMIN_SECRET` is accepted as a URL query parameter (pre-existing). Header-only would be a
   one-line change plus your own bookmarks.
5. `cm.pdf` (9.2 MB, the competition manual) is tracked with no licence; the FIRST courtesy note
   for the field CAD is unsent. Both are yours.
6. `LEGAL_UPDATED` (`src/legalText.ts`) drives `LEGAL_VERSION`. The privacy text changed (CCPA
   paragraph, Your-data panel); if that is a material change, move the date so everyone
   re-accepts. If not, leave it.
7. `flowerScoreZ` ships unused — 3D flower scoring runs on the 2D stacking model. Ruling needed.
8. `package.json` is `0.1.3`; this publish is the largest since it was set.
9. `migrate()` (`server/index.ts`) is not awaited before `listen`, and a migration failure is
   non-fatal while the new code hard-depends on 0037–0040's columns. Worth an `await` and a
   fatal exit — but that reverses a deliberate "a DB failure must not take the game server down".
10. Neon Auth `trustedOrigins` — confirm no wildcard on the production project (dashboard only).
11. **The FULL predictor's mouth is solid where the authority's is open.** A predicted element
    can bounce off a mouth the real one rolls into, and the reconcile snaps it. Fixing it costs
    2× the reconcile (numbers above). Options: accept as is; raise `PREDICT_FULL_BUDGET_MS` and
    accept Full on fewer machines; or make the compound cheaper (fewer boxes: arms only, no
    lintel, for the predictor). Not decided here.
12. Follow-ups, not blockers: a golden `worldHash` table so cross-build sim drift fails a test;
    `.gitattributes` (`* text=auto eol=lf`) for the CRLF checkout; dead `spike3d` / `scene-preview`
    scripts; no 404 route.

## Gotchas found on the way

- `rg` is not on the Bash PATH under the rtk hook; `git grep` is.
- Three BIOBUZZ perf checks (`PREDICT_FULL_BUDGET_MS`, `step3d p95`, room-tick ratio) are
  wall-clock and fail under CPU contention from parallel agents. They pass on an idle machine;
  do not "fix" them by widening the budget.
- The CLAUDE.md byte ratchet is at 99.6%.

---

# HANDOFF — 2026-09-19 (alpha: THREE ABANDONED LANES FINISHED, plus the owner's render pass)

Four commits on top of `8d3cde4`, every gate green:
`build` · `server:check` · `docaudit` · `uiaudit` · `contrast` (221) · `dbtest` · `test:mm` (197) ·
`bundleaudit` (re-measured) · `npm test` (**2375** BIOBUZZ + **1861** shared) · **`shiftaudit`**
(576 state changes, 0 shifts — the first run in three rounds, and its route list now covers
`/privacy`, `/terms` and `/contributors`).

Three lanes had been left UNCOMMITTED in the worktree `.claude/worktrees/alpha-main-divergence-7a6134`
(branch `claude/3d-field-visuals-855bd5`, sitting on `56e5836`, two commits behind alpha). They were
replayed onto alpha's tip with `git apply --3way` and finished here. **The originating worktree was not
touched** — it still holds the abandoned copy, so it is safe to delete once these land.

Two other dirty worktrees were left alone on the owner's instruction:
- `.claude/worktrees/alpha-ui` (detached at `dada8a0`, **396 commits behind**) holds a home-menu
  redesign — the eyebrow merged into one subtitle, the season moved onto the cards that pick it, the
  outbound links moved below the menu. It was applied here by mistake and then **fully reverted**. The
  owner does not want it.
- `.claude/worktrees/main-deploy` (branch `main`) holds staged-match / `copyText.ts` / contributors work
  with **two files still carrying unresolved index entries** (`src/ui/App.tsx`, `src/ui/Matchmaking.tsx`).

## The three lanes

**1. BIOBUZZ field visuals + one shot-path predictor.** `src/games/biobuzz/shotPath.ts` is the one
predictor; `drawShot.ts` (2D) and `scene/renderReticle.ts` (3D) are two drawings of it, and neither
works anything out for itself. It is NOT under `scene/`, because nothing outside `scene/` may import
from there. A path is drawn only for a shot that is MADE, dotted, no landing ring; "made" is
`hiveAccepts` against the REAL hive, not Aim Assist's pretend-up copy. `bbFlightEnters` gained an
optional `BbFlightTrace` out-parameter, which is what retired `scene/renderLanding.ts` — that file
carried a COPY of the integrator and its own header said the copy would drift.
⚠️ **A TURRET'S YAW AND ELEVATION ARE SEPARATE NODES** (`bb-turret-head` → `bb-turret-pitch`). Both on
one node is what "the shooter is not automatically aiming" looked like: a `THREE.Euler` defaults to
order `XYZ`, so elevation was applied about the UN-yawed axis, and at the 160° yaw / 80° elevation hive
range asks for, the barrel came out 67.7° BELOW horizontal and 44.5° off in azimuth while the SIM's
turret was dead on target.

**2. One board is one physics (owner ruling 2026-09-18).** Every server-connected match of a 3D-capable
game runs 3D; nobody picks. `Room.physics` is one line (`serverPhysics`); `RoomConfig.physics` still
rides the wire and is still sanitized but no current server reads it, and the lobby's 3D/2D picker is
gone. `boardPhysics` (`server/db/repo.ts`) is the single predicate, applied by the DATA LAYER and read
by `recordLeaderboard`, `personalBest`, `recordRank` and `getUserStats`; it sits INSIDE the per-player
`best` CTE, because filtering after it would find a player's 2D personal best, reject it, and leave them
off a board they have a legitimate 3D score on. Pre-ruling 2D rows are KEPT, not deleted; no season was
reset. An old client without the `'bb3d'` cap is REFUSED (`BB3D_REFUSAL`), not silently downgraded.

**3. The broadcast Results screen.** `src/ui/Results.tsx`, 1,064 lines, split out of `GameView.tsx`
(which loses ~700). ⚠️ **FIXED-DARK, like the field canvas**: `--ds-stage-bg` (new) and the
`--ds-on-field*` family are CANVAS-GROUND tokens, never re-valued in the dark block.

## What the lanes had left broken, and what fixed it

| where | what was wrong |
|---|---|
| `scene/renderFieldGlb.ts` | three type errors from a half-done refactor; `addPanelEdges` written and never wired |
| `scene/renderField.ts` | the clear-panel re-tune reached the CAD path only, so the fallback kept the rejected 0.22 / 0.3 / `DoubleSide` while its comments claimed parity |
| `sim3d/elements3d.ts` | a dumper fired on the first tick fire was held, at any heading — the 2D pipeline has gated this since stage 5b existed |
| `sim3d/contacts3d.ts` | G409's spill tag died while the element was still riding the tray it was leaving (seed 871: 8 tags at tick 13, all gone by tick 16 at z≈48) |
| `scripts/smoke.ts` | four `recycle/biobuzz` checks measured NOTHING — a BIOBUZZ room will not tick until `physics3dReady()`, and the shared suite never called `initPhysics3d()` |
| `scene/renderElements.ts` | every hive element drew one radius LOW. `syncElement` puts the body at `b.z + r`, so `b.z` is the BOTTOM for every ball the sim solves; the hive branch alone read it as a centre. Visible as a drop the tick `derive.ts` retags a landing shot from `flight` to `element` |

⚠️ **The settle check no longer pins a magic tick count.** It settles 3,600 ticks and asserts BIT
equality plus exactly-zero velocity, and a sibling check asserts the residual contact relaxation DECAYS
(each 600-tick window drifts at most half the last). The old 900-tick / 1e-3 form reported the machine.

## FIXED — a 3D dumper could not score into a hive cell

`drive: shoot (3d, blue|red, box tube)` in the TUTORIAL lane. Measured over 28 stationary firing poses
(dx 0/3/6/9 in, dy 14–38 in from the cell): a clean HEAD tree scores from **13**, this tree from **0**.

⚠️ **THE FIX IS IN TWO PARTS AND BOTH HAD TO BE 3D-ONLY** (the 2D pipeline is permanent): a
`flight` body is born CLEAR of the robot that threw it, walked out along its own parabola at
body-creation time in `sim3d/engineImpl.ts`; and a 3D dump is STAGGERED one element at a time
(`BbShot.perDump`, set only by `sim3d/elements3d.ts`), because `bbDumpSolution` converges every
element on one point — free in 2D, a four-way pile-up at the mouth in 3D. **0/28 → 20/28**, 2D
byte-identical at 28/28. A shared `launchClearance()` in `robot.ts` was tried first and reverted:
3/28, and it broke two 2D checks. A straight-ray nudge was also tried and measured at 3/28 — a
dumper's lob leaves at 80.6°, so raising the release without advancing the solved `vz` overshoots
the opening. The eight remaining misses are the two CLOSEST rows, where the lob clips the hive
underside; that is the CAD ruling's own documented consequence, and 2D scores there only because
a 2D flight element passes through the hive.

The cause was NOT the tutorial. `bbLaunch` throws the hopper from the release line at the bare FRAME face
(`mountOrigin` = `spec.length/2`). Until this lane the 3D chassis collider was `robotExtents(r)` — the
footprint, 3 in wider on a mouthed edge — so a dumped element was **born inside its own robot's
collider** and depenetration flung the four arcs apart; one happened to settle in the cell. The collider
is now `chassis3dShapes`, whose base box is the bare frame, so the release sits on the collider face and,
on a mouthed edge, inside the `BB3_MOUTH_SLOT_Z` lintel, where the four elements jam and rest on the
roof. **The old behaviour was an accident and the new collider is correct; do not restore the accident.**
Pushing the release out to `bbFootprint` was tried: 2/28. The deeper cause is that `bbLobThrow` /
`bbDumpSolution` throw a near-vertical lob at a cell whose mouth normal is HORIZONTAL, so the element
arrives dropping onto the lip rather than travelling into the opening.

## The owner's render pass (2026-09-19, from looking at the running game)

Landed or in flight, in order received:

1. the human player's nectar container should be the STANDARD HOLDING BOX, on the GROUND — not the
   bespoke shelf-on-legs at `RACK_SHELF_Z = 30`;
2. the shooter's side plates end in a sharp radial point — the front should terminate flat, and there
   should be BRACING between the two plates. ⚠️ **Follow-up: the bracing must sit CLOSE TO THE
   FLYWHEELS, and the plate does not need to be as big as it is;**
3. swerve is not rendered at all — one squat cylinder per corner at deck height, not a module.
   ⚠️ **Follow-up: NO MOTOR ON TOP of the swerve module;**
4. the intake wants a much faster draw-in and a real force model; its sides must not be solid aluminium
   plate; the roller stays but elements must pass UNDER it; and the roller is too low.
   ⚠️ **Measured: `BB_ROLLER_R` 1.0 at `BB_ROLLER_Z` 1.15 puts the roller's bottom 0.15 in off the
   floor, against a 2.8 in pollen and a 3.6 in nectar — while `BB3_MOUTH_SLOT_Z` (= `2 * BB_NECTAR_R`)
   says the collider leaves a 3.6 in clear slot under that same intake. The picture blocks a gap the
   physics says is open, by 3.45 in.**

### The intake design (measured 2026-09-19; NOT yet implemented)

⚠️ **GRIP AND PASS-UNDER CANNOT BOTH HOLD FOR A RIGID ROLLER.** Gripping a POLLEN needs the roller
bottom below its 2.8 in crown; letting a NECTAR through needs it at or above 3.6. One roller still
does both if the low part is the COMPLIANT part: a rigid HUB that clears the slot, and flaps that
reach into it and yield. Compliance IS "grip when driven, yield when not", which is both requirements
in one part. Put these in `config.ts` beside `BB_INTAKES` — they are hardware geometry, and the RENDER
lane already forbids `renderRobots.ts` owning intake constants:

    BB_ROLLER_HUB_R  = 0.75                                   // 1.5-in hub on a 0.5-in hex shaft
    BB_ROLLER_FLAP_R = 2.0                                    // a 4-in compliant wheel
    BB_ROLLER_Z      = BB3_MOUTH_SLOT_Z + BB_ROLLER_HUB_R + 0.15   // = 4.50; hub bottom 3.75
    BB_ROLLER_SPIN   = BB_INTAKE_DRAW_IN / BB_ROLLER_FLAP_R        // the picture ran at HALF the
                                                              // sim's speed: 26 rad/s x 1.0 in
                                                              // = 26 in/s against a 52 in/s draw-in

⚠️ **THE "UNREALISTIC INTAKE" IS A UNITS BUG, NOT AN ANIMATION ONE.** `robot.ts` calls
`approach(from, to, maxDelta)` with `BB_INTAKE_DRAW_IN` as `maxDelta`. `approach` caps the per-CALL
change and it is called once per tick, so the cap is 52 in/s PER TICK = 3120 in/s²: an element at
rest reaches full draw-in in ONE tick. It reads as a teleport in velocity space because it is one.
The fix is an acceleration — `BB_INTAKE_GRIP_ACCEL` (APPROX, ~1200 in/s²) times `dt` — shared by both
backends. The measurement that would settle the number: weigh a POLLEN and a NECTAR (`BB3_ELEMENT_MASS`
is already flagged APPROX, plan-3d §3.6, owner action).

⚠️ **TWO HARD CEILINGS ON `BB_INTAKE_DRAW_IN`, both of which must become smoke arithmetic.**
(1) `C.BALL_MAX_SPEED` is 90 and the 2D solve clamps every ground artifact to it; the 3D pipeline does
not, so a draw-in above 90 is clipped in 2D ONLY and the backends diverge. (2)
`BB_INTAKE_DRAW_IN * BB_INTAKE_CENTRE_FRAC < BB_INTAKE_CROSS_MAX`, or the intake's own funnelling trips
its own grip test and it drops every element it funnels — the failure `bbIntakeAct`'s header already
records ("0/1 captured, 66 in of plow"). And do NOT raise `CROSS_MAX` to buy margin: a robot-lane check
stages `vel.y = CROSS_MAX + 40`, which the 2D solve clamps to 90.

Proposed speed set (owner asked for "WAY faster"; the LANE_W change is the one with real balance
weight, because the default 17-in build goes from ONE feed lane to two): `PERIOD_MIN` 0.15 → 0.06,
`PERIOD_MAX` 0.3 → 0.12, `LANE_W` 9 → 8, `DRAW_IN` 52 → 84, `CENTRE_FRAC` 0.5 → 0.6, `THROAT_FRAC`
0.72 → 0.85, `SEAT` 1.1 → 1.4, `CROSS_MAX` unchanged.

**PASS-UNDER NEEDS NO SIM CHANGE.** `chassis3dShapes` puts nothing between the floor and 3.6 in
between the mouth's two arms, and the sim3d lane already asserts that pocket is open. The roller is not
a collider in either backend. It is the PICTURE that intersects, so flap deflection in the renderer is
what makes pass-under true — and it must run whether or not the roller is spinning.

**THE SIDES** are two `platePlane(armLen, 2.8, 0.3, 2)` solid plates per mouth — a 4.1 x 2.8 in wall in
front of the mechanism, 3D only (the 2D sprite already draws open rails). Replace each with a
three-member open truss (bottom rail, axle boss, diagonal), no member thicker than `INTAKE_RAIL_T` 0.5,
which is what the COLLIDER claims — the drawn arm must never claim more solid than the collider has.

**ONE MORE CONTRADICTION IN THE SAME AREA:** `BB3_INTAKE_Z` is 5 (an element-BOTTOM ceiling for
capture) while the proposed flap tip is 2.50, so an element at 4.9 would be eligible in the sim and
untouchable in the picture. `BB3_INTAKE_Z = BB_ROLLER_Z` closes it; it is a 0.5-in tightening that only
bites on 3D low-flight captures.

### The shooter bracing constraint (owner follow-up)
The ribs sit at radius ~4.9 against a flywheel radius of 2.0, so "way too far out" is right. But a rib
CANNOT move in to the flywheel: the annulus between `BB_FLYWHEEL_R` and `BB_HOOD_R` IS the element's
channel through the hood, and the brace angles all lie inside the wrap. What can be done is shrink the
plate (`rOut = BB_HOOD_R + 0.5` today) and keep the ribs flush on the hood face. Both are pinned by
checks in `scripts/smoke-biobuzz/render.ts`, so they move together.
5. elements teleported slightly downwards on landing in the hive — FIXED, see the table above.

## Gates

`build` · `server:check` · `docaudit` · `uiaudit` (baseline: `off-grid-gap` 155) · `contrast` (221) ·
`dbtest` · `test:mm` (197) · shared `npm test` — all green. `bundleaudit` needs its `scene` baseline
re-measured (192.28 → ~199 KB gz, inside the 250 KB spec ceiling). **`shiftaudit` was RUN** — the first
time in three rounds — 576 state changes, 0 shifts, and its route list now covers `/privacy`, `/terms`
and `/contributors`, which rounds 1–2 added without ever adding them here.

`.impeccable`'s design hook reports 38 findings in `src/ui/styles.css`; **every one is on a
pre-existing line** and none on anything this work added. Two that WERE this work's are fixed: the
Results screen's win-banner and total-punch keyframes already overshoot and settle, so an overshooting
timing function on top rubber-banded each segment — both are ease-out-quint now.

---

# HANDOFF — 2026-09-19 (alpha: ROADMAP ROUND 2 LANDED — privacy & cookie settings, the 3D robot creator; alpha server redeployed for the export route)

**(Previously READ FIRST.)** Branch **`alpha`** (worktree `.claude/worktrees/pr-alpha`), pushed; every gate green on the
merged tree (counts in the log). `dsim-alpha` was redeployed after the privacy merge (`GET /api/user/export`
is a server route). The section directly below is the 3D builder's own handoff from `biobuzz-3d`; the
ones after it are round 1 (auth, tutorial, contributors, plans) and the BIOBUZZ 3D days. All eight
roadmap items are now either landed or a plan awaiting the owner's decisions:

| # | item | state |
|---|---|---|
| 1 | 3D robot creator | landed (`feat/3d-builder` → `biobuzz-3d` → alpha): `Preview3D.tsx` on the `Preview` slot, `scene/renderPreview.ts` turntable built by the match's own `buildRobotGroup`, height + stow controls, saved-robot thumbnails; the chassis colour finally draws in 3D (fill = `chassisFill`, alliance = edge silhouette + sign panel), which also fixed the live match; three match render bugs fixed (mechanisms built inside the chassis, `specKey` missing `drivetrain`, group disposal) |
| 2 | replay download 2D/3D | landed with BIOBUZZ Day 3 |
| 3 | cosmetics | PLAN `docs/cosmetics-plan.md` — owner decisions pending |
| 4 | rewards | PLAN `docs/rewards-plan.md` — owner decisions pending |
| 5 | auth: reset, verification, terms | landed round 1; server gate off until `REQUIRE_VERIFIED_EMAIL=1` (`docs/deploy.md` §4) |
| 6 | tutorial | landed round 1 (BIOBUZZ + DECODE) |
| 7 | contributors | landed round 1; owner fills the `TODO` handles |
| 8 | privacy & cookies | landed round 2: `src/storageKeys.ts` registry (17 keys; the privacy page renders from it; a smoke check forbids unregistered keys — the old prose listed four keys that never existed), analytics opt-out incl. the pageview beacon (`src/analyticsPref.ts`, `beforeSend`), `GET /api/user/export` (authed, one per minute, own rows only, ids-only for replays, no email column; 404 after deletion; 24 dbtest checks), the Your-data panel on `/privacy` with the existing typed-`DELETE` account deletion surfaced, a footer consent link that explains itself when the CMP offers no revocation entry; legal text changes (CCPA/CPRA paragraph, Poly Haven added to the processors, storage prose by category) with `LEGAL_VERSION` deliberately NOT bumped — bumping re-prompts every account; the owner decides |

## Owner actions (consolidated)
- Legal: review the round-1/round-2 wording (terms acceptance, CCPA line, Poly Haven processor, storage
  categories); decide whether to bump `LEGAL_VERSION`.
- Neon Auth: sender domain, "require email verification", then `REQUIRE_VERIFIED_EMAIL=1`.
- Contributors' handles/avatars; the cosmetics and rewards decisions; test the 3D builder, the privacy
  panel (export needs a signed-in session) and the tutorial on `alpha.playdsim.com`.
- BIOBUZZ 3D rulings still open: lone-nectar flower scoring; weigh an element set; AI 59/100.

## Gotchas (new)
- An OLD server answers `/api/user/export` with a 200 from its `/api/user/<id>` profile route — guard
  on the payload, not the status. `analytics.ts` reads `import.meta.env` at module scope, so the
  pref lives in `analyticsPref.ts` (importable by `smoke.ts`).
- `index.ts` fills `scene` and `previewScene` from ONE dynamic specifier on purpose: two would hoist
  three.js into a shared chunk behind two facades that carry none of `bundleaudit`'s marker strings.
  `specKey` moved out of the scene chunk (`src/games/biobuzz/specKey.ts`) so the thumbnail cache can
  key on it without loading `three`. Thumbnails follow the device quality tier on purpose (pinning
  High fetched a 1.7 MB HDRI to draw three 96-px cards).
- Merging `biobuzz-3d` into `alpha` conflicts on `scripts/bundleaudit.mjs` (baselines) and
  `scripts/vercel-prune.mjs` (alpha's has the rate-limit fix): take alpha's, then re-measure.

---

# HANDOFF — 2026-09-18 (feat/3d-builder: roadmap item 1, A PROPER 3D ROBOT CREATOR MENU — landed, not merged)

**(Previously READ FIRST.)** Branch **`feat/3d-builder`**, off `biobuzz-3d` at `cf794b6`, five commits, **not
pushed and not merged**. Every gate green: `build` · `bundleaudit` · `npm test` (both suites) ·
`uiindex`+`uiaudit` · `docaudit` · `server:check`. The section below is the whole of it; the
Day 3 handoff it sits on top of follows underneath.

## What landed (`docs/roadmap.md` item 1)

- **`scene/renderPreview.ts`** — `createRobotPreviewScene(host, opts)` → `{ element, setSpec(spec,
  alliance), setQuality(tier|null), resize, capture(size), dispose }`. A turntable over ONE robot on
  a disc of field tile: slow auto-rotate (0.28 rad/s, off under `prefers-reduced-motion`), drag to
  swing and wheel to zoom at the match orbit camera's own rates and signs, the shared light rig, the
  same environment map at the device's own quality, transparent buffer so the card's themed surface
  is the background.
- **`scene/renderCore.ts`** — factored OUT of `renderScene.ts`: the renderer factory, the light-rig
  constants (`SCENE_EXPOSURE`, the hemisphere pair, the sun, the shadow bias pair), the
  once-per-document WebGL2 probe, `readBackdropColor`, `SceneUnsupportedError`, `disposeObject3D`.
  Both scenes build a renderer through it, so the same robot cannot come out two colours.
  `antialias: false` stays at `renderScene`'s own call site (a decision, not plumbing); the preview
  passes `true` — a 190px card recreated on every mount does not earn a render target and a blit.
- **`Preview3D.tsx`** (main chunk, no `three`, no `scene/` import) — the `Preview` slot. Without the
  host's `allow3d` it IS the 2D schematic, unchanged, which is what the four strategy cards get.
  The builder hero passes it and gets the turntable, a 2D/3D segmented toggle on the device's own
  `decodesim.view`, a `Stowed` toggle for a build over the cube, and a one-line fallback to the
  schematic when the scene cannot start (the 3D button doubles as the retry). It reaches the chunk
  through `moduleFor('biobuzz').previewScene()`.
- **Chassis colour in 3D** — fill = `chassisFill(spec.chassisColor)`, alliance = the silhouette
  `LineSegments` plus the sign panel. **This fixes the live match too**: the 3D chassis was
  alliance-filled and `chassisColor` was not rendered in 3D at all.
- **Height pair in the Frame section** — `heightIn` 12–29, and (only over the 18-in cube) the
  declared `stowHeightIn`, beside the R102 note that was already there.
- **Saved-robot thumbnails** — rendered once per build+alliance through the same scene, in place of
  the summary line on the 3D view, cached in memory and never persisted.

## The three bugs the preview exposed, all fixed in `renderRobots.ts`

Looking at a BIOBUZZ robot from close up for the first time found three things the match view had
been hiding at driver range. All three are fixed for the MATCH, not only the preview.

1. **The turret and the Box Tube were built INSIDE the chassis box** (z 1 and 0.6·height). Every
   robot in the 3D view was a featureless slab whatever launcher it carried. Both sit on the deck.
2. **`specKey` left out `drivetrain`**, so swapping mecanum for tank never rebuilt the wheels.
3. **A group thrown away on a rebuild was never disposed** — and a blanket traverse would have
   freed the module caches every other robot is still using. `SHARED_GEO`/`SHARED_MAT` register what
   is shared and `disposeRobotGroup` frees the rest; the match's own sync uses it too.

## Decisions worth knowing before touching this

- ⚠️ **BOTH module slots write `import('./scene/renderScene')`.** `previewScene` resolves the
  preview factory through a re-export rather than importing `./scene/renderPreview` by its own path.
  One dynamic specifier is ONE Rollup chunk; two would hoist three.js into a shared chunk behind two
  facades, and a facade carries none of the marker strings `bundleaudit` routes the `scene` budget
  by — both would land in `other` and fail that audit for a reason unrelated to size.
- **`bbSpecKey` (`src/games/biobuzz/specKey.ts`) is the one rebuild key.** It has readers on both
  sides of the lazy boundary: the generator, and the thumbnail cache in the main chunk, which cannot
  load the scene chunk to ask. Two copies is how a cached thumbnail shows the previous build.
- **The camera frames a bounding sphere MEASURED off the built group** (`Box3.setFromObject`), not
  one derived from `length × width × heightIn`: a turret stands above the deck and its barrel
  reaches past the frame rail, and the spec-derived fit cropped it off the top of the card. The
  distance is aspect-aware — a `PerspectiveCamera`'s `fov` is the VERTICAL one and the builder's
  220px column is taller than it is wide.
- **Thumbnails follow the DEVICE tier and are deliberately not pinned to High**, which is the
  opposite of what a replay export does. Two reasons pointing the same way: a thumbnail sits on the
  same screen as the live turntable, so one drawn at another tier is a second picture that does not
  match the first; and High selects the `school-hall` HDRI, so pinning it would fetch 1.7 MB to draw
  three 96px cards for somebody whose own setting asked for the procedural room.
- **The preview does NOT set the view preference to 2D when it fails.** `createBiobuzzScene` does,
  because there the fallback has to stick or the scene is retried on every remount. A menu card with
  a toggle directly above it is not that.
- **One WebGL context per thumbnail BATCH**, drained on a microtask and disposed immediately —
  not one per card (`Gallery.tsx` shares one scene across thirty cells for the same reason).

## Deviations from the roadmap's design, and what was not done

- The roadmap said "a `BiobuzzPreview3D` component fills the `Preview` slot" and left the loader
  unspecified; it is a new `GameModule.previewScene` slot so that ALL of a game's dynamic renderer
  imports stay in its `index.ts` (the property the RENDER lane asserts).
- The saved-robot card needed a second new slot, `GameModule.savedCard`: what belongs under the name
  is no longer always a sentence, and the choice between a thumbnail and a summary is the GAME's,
  not the shared menu's.
- `buildRobotGroup` now takes `(spec, id, alliance)` rather than a `RobotState` — a preview has no
  pose, no hopper and no world.
- **Not done: a Gallery still of the preview.** The Gallery's robot cells still draw the 2D
  schematic. The anti-drift claim is covered structurally instead (one generator, one rebuild key,
  both asserted in the RENDER lane), which is stronger than a picture.
- **Not done: `shiftaudit`.** It needs a build plus `vite preview` in a second shell; the new
  controls are `.ds-seg` (weight constant across states by design) and a fixed-size preview box, so
  there is nothing new that moves layout — but it has not been RUN on this tree.

## Numbers

- `npm test` — both suites green; the BIOBUZZ suite is 1800+ checks with the new RENDER-lane block
  (one generator, one rebuild key, the colour split, the import boundary, the height pair).
- `bundleaudit` — main 918.72 → **919.99 KB gz** (+1.27: the toggle, the thumbnail batcher, the two
  dials, the Menu wiring — inside §10's "+≤ 2 KB" because the component holds no renderer); scene
  192.28 → **194.67 KB gz** (+2.39: the turntable plus `renderCore`, which is a MOVE), 55 KB inside
  the §2.5 ceiling.
- Browser (dev server, this machine): the toggle, wheels by drivetrain, the two deck turrets, the
  sign panel, live follow on preset / height / colour changes, drag-to-orbit, the stow toggle, a
  saved thumbnail, back to 2D (zero canvases left mounted), both themes, 375px with no horizontal
  overflow, console clean of anything but the pre-existing AdSense 403s. A solo practice in View 3D
  shows the same rust chassis with the same blue outline as the card.

---

# HANDOFF — 2026-09-19 (alpha: ROADMAP ROUND 1 LANDED — auth flows, tutorial, contributors, cosmetics/rewards plans, Vercel policy; alpha server redeployed)

**(Previously READ FIRST.)** Branch **`alpha`** (worktree `.claude/worktrees/pr-alpha`), pushed, every gate green on
the merged tree: `build` · `bundleaudit` · `server:check` · `docaudit` · `uiaudit` · `contrast` ·
`test:mm` · `dbtest` · `npm test` (counts in the log). The ALPHA game server (`dsim-alpha`) was redeployed
from this tree (`./scripts/fly-deploy.sh --alpha`) because auth adds migration `0040` and server routes.
The four sections below this one are each branch's own handoff, written by the agent that built it;
their "NOT merged / NOT pushed" lines are stale — all four ARE merged here. Production is untouched.

## What landed on alpha (each on its own branch, merged in this order)
- `feat/plans-cosmetics-rewards` → `docs/cosmetics-plan.md`, `docs/rewards-plan.md` (roadmap items 3–4;
  the owner approves before code). Two code facts they surfaced: the 3D chassis ignores `chassisColor`
  (paints alliance fill), and `coerceSpec` checks only that a colour KEY is legal, never that the account
  is entitled — enforcement is UI-only today.
- `feat/contributors` → real sections (core team, contributors from `CONTRIBUTORS.md` incl. a missing
  signer, presented-by via `sponsorLink`, third-party credits with versions baked from `package.json`
  at build time, get involved). Owner still fills the `TODO(fill in)` handles/avatars.
- `feat/tutorial` → `src/tutorial/` engine (DOM-free runner, `GameModule.tutorial` slot), BIOBUZZ six
  steps + DECODE four, the step card in the HUD band, a first-run offer on Modes and a Controls entry,
  per-device flag `decodesim.tutorial.v1`; TUTORIAL lane 318 checks (non-vacuous AND completable, both
  physics, both alliances). Runs as FREE DRIVE so nothing is recorded (a staged world is not
  reconstructible from `{seed, setups}`); `startMatch` refuses while a tutorial is live.
- `feat/auth-flows` → `src/lib/authFlows.ts` (one wrapper over the Neon/Better-Auth SDK, pinned exactly
  at 0.4.2-beta): forgot password (`/account/reset`), email verification (banner, resend,
  `/account/verify`), terms acceptance (`LEGAL_VERSION`, migration `0040_terms_acceptance.sql`,
  `POST /api/user/accept-terms`, a blocking `TermsGate` on version mismatch incl. OAuth first sessions).
  ⚠️ The email-verification SERVER GATE (ranked queue, record-room join, `/api/practice`) is OFF until
  `REQUIRE_VERIFIED_EMAIL=1` — every existing password account is unverified and no sender domain is
  configured; the owner's Neon dashboard steps are in `docs/deploy.md` §4. Also fixed in passing:
  `uiaudit`'s component-index staleness check compared CRLF against LF (failed on every fresh Windows
  checkout).
- Vercel: `vercel.json` builds ONLY `main` and `alpha` (`ignoreCommand`) and disables auto-deploy for the
  feature branches; `scripts/vercel-prune.mjs` (owner-run, token via env, dry run by default, waits out
  the 200-deletions-per-10-minutes limit) took the project from 501 to 113 deployments on 2026-09-18.
  Feature-branch pushes had been queueing previews ahead of the alpha build.

## Owner actions
- Neon Auth: sender domain + "require email verification", then `REQUIRE_VERIFIED_EMAIL=1` on the alpha
  app (`docs/deploy.md` §4). Review the terms/privacy copy touched by the acceptance flow.
- Fill the contributors' handles; decide the cosmetics and rewards plans' numbered decisions.
- Test on alpha: sign-up with the terms box, forgot-password screen, the tutorial from Modes, Contributors.

## Next (roadmap)
`feat/privacy-cookies` (item 8; shares `LEGAL_VERSION`), the 3D robot creator (item 1, on
`biobuzz-3d`), replay 2D/3D export is DONE (Day 3), cosmetics/rewards builds after approval. BIOBUZZ 3D
follow-ups are in the Day 3 section: nectar-in-flower scoring ruling, weigh an element set, AI 59/100.

## Gotchas (new)
- The Neon adapter THROWS on any non-2xx (`AuthApiError` with lower_snake codes); the `{data,error}`
  union's `error` is essentially never populated — classify the throw.
- Read the emailed `?token=` at module load (`src/ui/entryToken.ts`): App canonicalises the address bar
  before any screen renders. Spend a verification token once (a ref, not state — StrictMode).
- A tutorial predicate that is already true on the staged world is invisible; the lane's non-vacuity
  check is the only guard. A hand-written `held` ball state without `lx/ly/side` is a NaN into Rapier —
  stage through `capturePollen`. `TutorialRunner.abandon()` is not `finish()` (the recorder check counts
  `.finish()` calls in `game.ts`).
- Vite's dev server refuses to serve files whose real path is outside the worktree (junctioned
  `node_modules` → font 403s in dev only); builds are fine.

---

# HANDOFF — 2026-09-18 (`feat/auth-flows`: password reset, email verification, terms acceptance — roadmap item 5, BUILT, NOT PUSHED)

**(Previously READ FIRST.)** Branch **`feat/auth-flows`**, off `alpha` at `76034a9`. Seven commits, not pushed
and not merged. Gates green on the branch: `build` · `server:check` · `npm test` (1840 shared +
1780 BIOBUZZ) · `dbtest` (ALL PASS, +12 for migration 0040) · `uiindex` then `uiaudit` (all rules
at baseline) · `docaudit` · `contrast` (223, unchanged — no new colour, the banner's tint is
`color-mix` over `--ds-warn`) · `bundleaudit` (main +0.9 KB gz, hostWorker unchanged).

⚠️ **NOTHING IS LIVE UNTIL THE OWNER DOES THE NEON DASHBOARD WORK.** `docs/deploy.md` §4 is the
checklist. The terms half works the moment the game server is deployed (migration 0040 applies at
boot); the two email flows send nothing until a sender domain is configured, and that failure is
SILENT — the forms answer 200 and no mail leaves. Send yourself one before believing it works.

## What is on the branch

- **`src/lib/authFlows.ts`** — the ONE module that calls the SDK. Four functions, each returning a
  discriminated `AuthFlowResult` and never throwing at a component:
  `requestPasswordReset(email)`, `completePasswordReset(token, pw)`,
  `requestEmailVerification(email)`, `completeEmailVerification(token)`. `@neondatabase/auth` is
  pinned to the exact installed `0.4.2-beta` (no `^`).
- **Forgot password** — a `.ds-linkbtn` under the sign-in password field opens a third form in the
  same modal; `/account/reset` handles the emailed link (and offers the request form when it
  arrives without a token).
- **Email verification** — sign-up asks for the email; a per-session banner on Profile with Resend;
  `/account/verify` spends the token on mount, exactly once, and clears the cached JWT.
- **Terms** — `LEGAL_VERSION` derived from `LEGAL_UPDATED`, migration `0040_terms_acceptance.sql`,
  `POST /api/user/accept-terms`, a required checkbox on sign-up and a blocking `TermsGate` that
  WRAPS `UsernameGate`.
- **`REQUIRE_VERIFIED_EMAIL`** gates ranked queueing, joining a record room, and `POST /api/practice`.

## The five things worth knowing before touching any of it

1. ⚠️ **THE SDK THROWS ITS FAILURES.** The Neon adapter installs its own `customFetchImpl` which
   throws a normalized `AuthApiError` on any non-2xx, so the `{data, error}` union the `.d.mts`
   advertises is real but `error` is essentially never populated. The first cut classified every
   throw as `network` and told somebody with an expired reset link to check their connection. The
   throw carries `status` and a lower_snake `code` (`bad_jwt`, `weak_password`,
   `over_email_send_rate_limit` — the adapter's own vocabulary, NOT Better Auth's SCREAMING_SNAKE),
   and `classifySdkError` now speaks both. Rate limiting is tested before the address, because
   EMAIL is a substring of that last code.
2. ⚠️ **`forgetPassword` IS NOT A TOP-LEVEL METHOD** on this build — only `forgetPassword.emailOtp`
   is, and that is a different flow. The top-level request is `requestPasswordReset`. The roadmap
   named the old one; the wrapper's header cites all four real `.d.mts` signatures with line
   numbers.
3. ⚠️ **THE EMAILED TOKEN IS READ AT MODULE LOAD** (`src/ui/entryToken.ts`). `App`'s mount effect
   canonicalizes the address bar with `history.replaceState(pathFor(...))`, and `pathFor` builds a
   path with NO query string on it — so `?token=` is gone before any screen component renders.
4. ⚠️ **THE RECORD-RUN GATE IS AT THE JOIN DOOR IN `server/index.ts`**, not in `Room.startMatch`
   beside the duo-record "both drivers must be signed in" guard it otherwise belongs with.
   `server/room.ts` is bundled into the LAN host worker (`src/lan/hostWorker`) and must not import
   `jose` or read `process.env` — that is why it goes through `./runtimeEnv` for everything.
5. ⚠️ **`REQUIRE_VERIFIED_EMAIL` IS OFF BY DEFAULT AND MUST STAY OFF UNTIL MAIL WORKS.** Every
   email/password account on the live site is unverified today, and the Resend button cannot help
   until the sender domain exists. Deploy → mail works → let people verify → set the secret.
   `emailGateRefusal` is the single predicate; extend it rather than adding a second check.
   `null` (nobody told us) counts as VERIFIED, deliberately — a gate whose unknown case refuses
   would take ranked down silently the first time an upstream stopped sending a field.

## Open, for the owner

- **The dashboard steps are `docs/deploy.md` §4**: sender domain + DNS, the redirect allow-list
  (every origin: prod, alpha, beta, `localhost:5173`), the provider's "require email verification"
  switch, then the Fly secret LAST.
- **Confirm the JWT carries `email_verified` before trusting the gate.** The server reads that
  claim (or `emailVerified`) off the verified token and falls back to ONE cached
  `GET /get-session` per token; if neither answers, the state is `null` and the gate PASSES. Sign
  in as a test account and read `/token`'s payload once.
- **The legal wording is the owner's to review.** One line was added to the Terms' `## Changes`
  section, because continued use after a change now genuinely does require re-acceptance and the
  document did not say so.
- **The three email flows are NOT end-to-end tested** — no mail can be sent from here. What was
  driven in a browser against a stub auth endpoint: the link and the checkbox, the refusal copy,
  the neutral confirmation, `/account/reset?token=fake` and `/account/verify?token=fake` on their
  error paths, the banner and both variants of the terms dialog (forced locally, reverted), light
  and dark, 375px.

## Next

Roadmap item 8 (`feat/privacy-cookies`) shares `LEGAL_VERSION` and should pick it up from here
rather than re-deriving it. If the terms text moves, `LEGAL_UPDATED` is the only line to change —
and moving it prompts every signed-in account once, so it is a deploy of BOTH halves (Vercel for
the dialog, Fly for the route that records the server's own constant).

---

# HANDOFF — 2026-09-18 (feat/tutorial: ROADMAP ITEM 6 LANDED — the game tutorial, engine + BIOBUZZ + DECODE)

**(Previously READ FIRST.)** Branch **`feat/tutorial`**, off `origin/alpha` at 76034a9. NOT pushed, NOT merged.
Every gate green: `build` · `npm test` (1806 shared across 12 shards + 2098 in the BIOBUZZ suite,
which now includes the new `TUTORIAL` lane) · `uiindex` then `uiaudit` (all rules at or under
baseline) · `docaudit` (CLAUDE.md 26,855 / 27,000 bytes) · `server:check`. `shiftaudit` was NOT run
(it needs Electron + a `vite preview` in another shell) — the card's pressables move by
`transform` / `box-shadow` only, which is the rule it enforces.

## What a tutorial IS here

A scripted SOLO PRACTICE. `src/tutorial/` is the shared, DOM-free engine; the CONTENT is per game
on the new `GameModule.tutorial` slot (`src/games/biobuzz/tutorial.ts`, `src/games/decode/tutorial.ts`).
`docs/area/ui.md` carries the rules — read that section before touching any of it. The one that
shapes everything:

⚠️ **A STEP'S SITUATION IS STAGED AT WORLD CONSTRUCTION, NEVER INTO A RUNNING WORLD.** Solo practice
is recorded and a replay rebuilds from `{seed, setups, commands}` alone (`docs/area/netcode.md`), so
`TutorialStep.stage(world)` runs at tick 0 on a freshly built world and moving to the next step
REBUILDS it (`GameController.rebuildForTutorial`, which is `restart()` minus the abort cue and the
harvest). The tutorial runs as FREE DRIVE, which is drivable from tick 0, bills no BIOBUZZ fouls,
and is **never recorded** — the honest answer to "could a replay reproduce a staged world": it
could not, so none is kept.

## Files

- `src/tutorial/{types,runner,hints,flag,index}.ts` — the engine. `TutorialRunner` is a state
  machine the caller drives: `stage` → `tick` per sim tick → `advance` (the caller rebuilds).
  `hints.ts` composes every hint from the player's LIVE `ControlBindings`, naming a pad button when
  a pad is connected and an on-screen button on a coarse pointer. `flag.ts` is
  `decodesim.tutorial.v1`, per device, fail-open both ways (the `chainDisclaimer.ts` pattern).
- `src/ui/TutorialCard.tsx` + `src/ui/tutorial.css` (imported from `main.tsx`, its own file for the
  reason `predict.css` is) — the step card. A `data-hud-band` element at bottom centre, so the 3D
  camera reframes the field above it and it gets the 3D view's dark scrim.
- `src/game.ts` — `tutorial` constructor option, `getTutorial()` on the HUD snapshot, `tutorialSkip`
  / `tutorialReplay` / `tutorialExit`, the per-tick predicate inside `stepSolo`, and the `startMatch`
  guard.
- Surfaces: the first-run card on `/modes` (hidden once the flag is set), a permanent
  "Run the tutorial" block at the top of Controls, and `GameView`'s `tutorial` prop.
- `scripts/smoke-biobuzz/tutorial.ts` — the `TUTORIAL` lane, 318 checks, 1.4 s.

## The content

**BIOBUZZ, six steps** (five for a build without the hardware for the NECTAR one): drive to your
garden · pick up a pollen · shoot into your hive · tip the hive (the cell is staged with the three
NECTAR the field gives it plus two POLLEN, so the measured table's third POLLEN is the shot the
player takes) · place a nectar in a flower **or** take a pollen from a flower · park in your loading
zone. **DECODE, four steps**: drive into your launch zone · pick up an artifact · score in your goal
· return to your base.

⚠️ **THE TWO FLOWER STEPS ARE A PARTITION, and the lane asserts it.** `TutorialStep.applies(spec)`
is resolved once when the runner is built. Placing a NECTAR needs a Box Tube **and** a launcher that
carries NECTAR (`bbCarriesNectar` — a single turret feeds POLLEN only, so **no shipped preset can do
it**); every other build is asked to retrieve a POLLEN instead. Every build is offered exactly one.

## Gotchas this shipped against

- ⚠️ **A PREDICATE THAT IS TRUE ON THE STAGED WORLD TEACHES NOTHING, AND IT IS INVISIBLE** — the card
  flashes past. The SHOOT step shipped as `contents.length > 0`; the field stages three NECTAR in
  every up CELL, so it was true at tick 0 for both alliances. It is `cellPollen(...) > 0` now, and
  the lane asserts non-vacuity for every step of both games under both physics and both alliances.
- ⚠️ **A hand-written `held` ball state is a NaN that reaches Rapier.** `{ kind:'held', robot, slot }`
  omits `lx/ly/side`, `positionHeldBalls` puts `undefined` through `rot()`, and the collider
  translation throws out of the solve. Staging goes through `capturePollen`, which is also what
  enforces the hopper cap, G408 and the NECTAR-capacity rule.
- ⚠️ **A staged pose derived from the CHASSIS is wrong for half the builds.** Both FLOWER steps act
  through a mechanism whose edge is a builder choice, so the pose is derived from
  `bbPlacePointLocal` / `bbMouths` and the robot is turned until that offset points along the wall.
  A front-assumed pose put a relocated Box Tube 10 in off the ring, pointing at open floor.
- ⚠️ **`TutorialRunner.abandon()` is not called `finish()`** — `npm test` counts `.finish()` calls in
  `src/game.ts` and requires exactly one, because the replay RECORDER may only be closed inside
  `harvestPracticeRun`. A second `.finish()` in that file reads as a second save policy to the grep,
  and the grep is the check.
- **Hive frame bars are at x = ±24…25, y = ±19.4.** Three staged poses had to move off them; a pose
  overlapping a static does not throw, it explodes the solve and reads as a position in the hundreds.
- **DECODE's penalty engine runs in `freeplay`** (BIOBUZZ's does not), so a DECODE step staged near
  the gate can bill the player in the one mode where nothing is meant to count against them. The lane
  asserts every scripted DECODE run ends with zero fouls.

## Next steps

- Push and merge to `alpha` (not done — the branch is local).
- Chain Reaction has no tutorial and registers none; the slot is there when somebody wants one.
- `shiftaudit` on the card, from an Electron shell with `npx vite preview --port 4173` running.
- Worth considering: an in-match entry point (the tutorial is currently only reachable before a run),
  and a step that teaches the human-player NECTAR entry, which free drive cannot host (`bbHumanPlayerTick`
  is gated to TELEOP).

---

# HANDOFF — 2026-09-18/19 (biobuzz-3d: DAY 3 LANDED — bots, graphics settings, HDRI, 3D export, prediction modes, cutover; merged to ALPHA and the alpha server deployed)

**READ FIRST.** Branch **`biobuzz-3d`** was merged into **`alpha`** at the merge commit named in the
log and the ALPHA game server (`dsim-alpha`, `fly.alpha.toml`, one machine) was deployed from the
alpha worktree with `./scripts/fly-deploy.sh --alpha` for proper testing (owner instruction). Every
gate green on the merged tree: `build` · `bundleaudit` · `server:check` · `docaudit` · `uiaudit` ·
`test:mm` (197) · `dbtest` (266) · `npm test` (1798 shared + the BIOBUZZ suite, count in the log).
Production (`main`, `dohun-sim-decode`) is untouched; promotion is the owner's call (spec §12 q7).

## Day 3 (spec §10) — landed, three OPUS lanes
- **Lane A, bots** (`src/games/biobuzz/ai/`): `GameSimModule.bot = { tiers, defaultTier, coerceTier,
  create(world, robotId, tier, seed) → { step(world): RobotCommand; dispose?() } }` — the caller owns
  the memory, steps a seat once per tick BEFORE the sim step, records the (already quantized) command
  like a driver's; nothing is written to `World`; reads positions and the derived lists only (a Proxy
  check forbids `rngState`; source greps forbid DOM, clocks, `process.`, `import.meta`, `sim3d/` except
  `tilt`). Tiers easy/medium/hard differ in execution only (hesitation, speed cap, aim tolerance, verdict
  strictness, placing, defending, patience, park time). AI lane 47 checks in `npm test` (determinism
  over 3,600 ticks under both physics with equal hashes AND command logs). `npm run test:ai` (150
  matches, ~8 min, outside `npm test`): hard vs idle 102 pts mean (1.93× easy); **hard beats easy 59/100
  head-to-head, NOT the plan's 90** — a BIOBUZZ 1v1 is decided in 20-point tip lumps from one shared
  element pool; the check is a ratchet at the measured rate (`BB_AI_WIN_RATE_FLOOR` 0.55) with the target
  named; levers: fouls (~6 pts/match), element denial, the 99-in drive after a hive flip. Perf with four
  bots: `step3d` 2v2 median 0.345 ms, p95 0.498 — no tuning needed; bots cost 0.004 ms. R102: `bbStowHeightIn`
  (declared `stowHeightIn` or `min(heightIn, 18)`), refused at `startLegal`, deploy = a read of
  `world.match`, the collider rebuilt at the edge with `z` continuous.
- **Lane B, graphics** (`graphics/{settings,auto,environments,viewKey}.ts`, `scene/renderEnvironment.ts`,
  `renderStats.ts`, Configure's Graphics section): presets Auto/Low/Medium/High/Ultra/Custom over the
  sixteen settings, per device (`decodesim.graphics`), 14 live, mesh detail needs a rebuild, SMAA and
  SSAO NOT offered (chunk cost; the UI says why). AA is a scene-owned MSAA target (the renderer is created
  `antialias:false`). Auto: GPU string + cores/memory/DPR → first guess, 2 s warm-up p95 (down > 16.7,
  up < 6), slip ≥ 25 ms sustained 3 s lowers once with one event line; `STALL_MS` 500 discards samples
  after a throttled gap (an alt-tabbed player must not come back to Low). This machine: Ultra. Two CC0
  Poly Haven HDRIs (School Hall; Monochrome Studio 02), 1k `.hdr` on demand via `HDRLoader` + PMREM,
  never bundled; `src/contributors.ts` DERIVES the credits from `BB_ENVIRONMENTS` (a check pins the
  count). Replay export View 2D/3D + camera (roadmap item 2): scene → its own overlay sheet → export
  canvas → burn-in; 3D costs 1.96× the 2D export at 1920; insets = the bottom band. Gallery draws 2D | 3D
  per cell with ONE shared scene (Chrome caps contexts). Phone: overhead default, a 2D/3D button; the
  view key `t` is armed by `InputManager.attach/detach` (`installViewKey`). Scene chunk 192 KB gz; a
  `graphics` route (5.6 KB) in bundleaudit.
- **Lane C, integration**: prediction Off/Light/Full/Auto (`src/net/predictionPref.ts`, Controls
  section + in-match panel): in a 3D online room the client no longer steps the world — the local robot
  advances through the predictor and the reconcile replays through it; measured Light 0.9 in / Full 0.16 in
  headless, Full reconcile p95 0.3–0.4 ms live; Auto picked LIGHT on the dev build (a 45.8 ms cold probe
  vs 0.3 ms steady — re-measure on a production build before tuning `PREDICT_FULL_BUDGET_MS`). Bot seats:
  solo practice (`GameSettings.practiceBots`, "Opponents"), custom lobbies (host `addBot`/`removeBot`,
  roster rows with `bot: tier`, refused in staged/ranked/record rooms, `unrated` latched), LAN via the
  same `Room`; `SERVER_CAPS` `bb3d` + `bots`; the online "Loading 3D physics" panel via
  `onPhysicsPending`; leaderboard era chip + All/3D/2D filter (`/api/records?physics=`), practice runs
  carry `physics`/`view` with the comparability note; the client refuses BIOBUZZ ranked on a server
  without `bb3d`. Migration renumbered **`0039_physics.sql`** (alpha took 0038 for replay privacy;
  idempotent, disjoint). Two Day 2 rejoin bugs fixed (caps and `physics` on `rejoin`). costprobe 2v2 with
  bots: 0.047 cores/room, 7,556 B/snapshot.
- Coordinator: `game.ts` routes `SceneOptions.onQualityEvent` into `world.events`; `RobotSpec.stowHeightIn`
  + its `coerceSpec` carry-across; the main-chunk bundleaudit baseline re-measured (the `ai/` policy is
  in the main chunk by design — a tier is offered before any physics loads).

## Owner actions and rulings pending
- Test on alpha: online 3D rooms (custom lobby, physics 3D, both views), bots in a lobby and in practice,
  prediction modes, the Graphics section, a 3D replay export (one human MP4 export closes the only
  unexercised path), ranked BIOBUZZ (3D) on the alpha server.
- Rulings: the lone-nectar flower score (CAD 3.597 vs floor 3.904); the CAD lower bore 3.222 vs the
  manual's 2.79; weigh a real element set; the AI head-to-head target (59/100 measured vs 90).
- Production promotion when satisfied (`main` from a main worktree; `./scripts/fly-deploy.sh`).

## Next (roadmap) — `docs/roadmap.md`
Own branches off `alpha`: `feat/auth-flows` (password reset, email verification, terms acceptance —
the SDK already exposes the calls), `feat/privacy-cookies`, `feat/contributors`, `feat/tutorial`; on
`biobuzz-3d`: the 3D robot creator (item 1); plans for cosmetics and rewards (items 3–4) for approval.
BIOBUZZ 3D days 4–14: play-testing, tuning, weighing a set, `MAX_SAVED_ROBOTS` 3 → 4, promotion.

## Gotchas (new)
- `setViewport`/`setScissor` take CSS pixels (they multiply by the pixel ratio); `shadow.map` must be
  disposed and nulled for a live map-size change; `renderer.info.render` resets at the START of `render()`.
- A `process.env` read in `ai/` is green in Node and fatal in a browser (the first bot decision unmounts
  the game screen) — the AI lane now greps for it.
- `coerceSettings` must not fold `practiceBots` to `'off'` for a game with no driver (a DECODE visit
  erased a BIOBUZZ tier); coerce at the point of use.
- `Renderer.render(overlayOnly)` clears the whole canvas — right for the live view, fatal for a
  composite export (every frame black); the export draws the overlay on its own sheet.
- A perf watch pinned at 0.75 ms failed at 0.778 the moment the suite ran beside anything else —
  thresholds that close to the measurement report the machine's load, not the code (gate at 1.5 ms).
- `git merge-tree --write-tree` previews conflicts read-only; alpha and a feature branch both prepending
  HANDOFF always conflict there — keep the feature sections on top; regenerate `docs/ui-components.md`.

---

# HANDOFF — 2026-09-18, night (biobuzz-3d: CAD-authoritative dimensions + DAY 2 LANDED — 3D rooms online, dynamic hive, flower tubes, prediction, cameras)

**(Previously READ FIRST.)** Branch **`biobuzz-3d`**, worktree `.claude/worktrees/biobuzz-3d`, clean at the merge
commit named in the log; every gate green there: `build` · `bundleaudit` · `server:check` ·
`docaudit` · `uiaudit` · `test:mm` (197) · `dbtest` (263) · `npm test` (1798 shared + 1615 BIOBUZZ;
lanes CORE/SIM3D/HIVE3D/FLOWER3D/PREDICT/NET3D/RENDER + the 2D lanes).

⚠️ **THE OWNER MUST DEPLOY THE ALPHA APP before anyone joins a 3D room online**: this day adds a
migration (`0038_physics.sql`), a protocol field (`RoomConfig.physics`, `matchStart.physics`, the
`'bb3d'` cap) and a replay header field — three server changes. `./scripts/fly-deploy.sh` (the
owner's wrapper; NEVER a bare `flyctl deploy`), then verify `/health` and `fly machine list`.
Production later from a `main` worktree. Backward compatibility held: `physics` is omitted (never
written as `'2d'`) on the wire and in containers; old clients still join 2D rooms; pre-0038 rows
read `'2d'`; no version bumped.

## Owner rulings this day
- **"The CAD is authoritative for dimensions."** `BB_*` geometry is GENERATED: `npm run field-cad` →
  `scripts/field-cad/emit-dims.mjs` → `src/games/biobuzz/fieldDims.gen.ts` (STEP version + sha, the
  derivation and residual of every value); `config.ts` imports it under the old names. The field is
  141.35 in inside the walls (`BB_HALF_X` 70.674), tiles 23.528 in on centre (`BB_TILE_PITCH`,
  `BB_TILE_SEAMS`), flowers at their bore-fit centres, hive `BB_HIVE_BOTTOM_Z` 31.981, opening
  [53.375, 65.497], tape as 16 CAD strips (`BB_TAPE`). 2D collider = 3D collider = GLB wall to
  0.0000 in (asserted). The manual's figures are history where they differ
  (`docs/biobuzz-reference.md` carries the dated note). `C.TILE`/`src/config.ts` untouched.
  Pre-2026-09-18 BIOBUZZ replays diverge on re-sim (alpha-only, unranked; no version bump).
- Better agents: rounds after the first play-test ran on OPUS with an analysis phase first.

## Day 2 (spec §10) — landed
- **Lane C, online** (`6ac687c`…`4ae3663`): `await initPhysics3d()` at server boot and lazily in
  the LAN host worker (`vite.config.ts` `worker.format = 'es'` was REQUIRED — an IIFE worker cannot
  code-split, and `initPhysics3d` had been tree-shaken out of the worker); `createWorld` gains a
  FIFTH optional `physics` parameter (a room is not a practice); `Room.physics` decided once
  (ranked/record/staged → `'3d'`, host option in the lobby, absent → `'2d'`); `'bb3d'` cap refused
  at `join`/`spectate`/`rejoin`/BIOBUZZ `queue` with "Update DSIM to play this room."; matchmaking
  stages BIOBUZZ `'3d'`; migration 0038 (`physics` on records/matches/replays/practice_runs, `view`
  on practice_runs, `butterfly` in the drivetrain check); recorder/player stamp and honour `physics`
  (`ReplayView` awaits the wasm); `displayWorld` interpolates elements and remote `z` in 3D worlds
  only; `costprobe` `biobuzz3d-*`: 2v2 0.026 cores/room, 7,231 B/snapshot (72 % of budget; 3D is
  cheaper than 2D). Verified locally: two clients, one 2D-view one 3D-view, same room, identical
  scores/positions at the same tick, the replay re-simulated to the server's score exactly.
- **Lane A, sim** (`366e3ce`…`506a890`): **dynamic see-saw ON** (`BB3_HIVE_DYNAMIC = true`): CAD
  tray hulls on a revolute joint (limits via `.setLimits` on the instance), mass 13 lb APPROX with
  the CoM 5.53 in above the pivot (that is the bi-stability), the detent is a HOLD at the stop
  released when the contents' torque beats `restoring + BB3_HIVE_DETENT` (Rapier has no joint
  friction; a capped motor keeps pulling), `npm run hive-calibrate` swept it: detent 3041, ballast
  6 lb at w −9.5, damping 4.466 → 4.00 s swing; all four §12.3 target rows hold with ±0.31
  element-weights of margin (the whole window is 0.60 wide at nectar ratio 1.6 — weighing a real
  set is what widens it); validation 4/7 (no linear weighting fits the owner-measured rows, as the
  reference already says). `hives[a].angle`/`angVel` ride the JSON; `hiveTiltAngle` reads them.
  **Flower tubes** from the CAD plates (lower bore 3.222 at z −0.2…0.35, mid 3.896 at 3.90…5.25,
  top 4.171 at 20.25…21.40; retrieval opening derives to 3.550 = Fig 9-12); elements fall to the
  tiles inside the bottom bore (nothing seats on a ring); G418's intent holds (only pollen exits
  the bottom). G409 (`bb.spill`) and G417 (`bb.hiveRam`, 3D only; the 2D "no robot can move the
  hive" ruling stands) bill from real contacts. **Predictors** in `sim3d/predict.ts`:
  `createLightPredictor(world, localId)` / `createFullPredictor(world, localId)` with
  `reset/step/dispose`, `probeFullReconcileMs(world, id, now)`; convergence 0.57/0.22 in open
  floor, 2.12/0.19 in on a push; Light < 1 ms, Full 2 ms (budget 8). `step3d` 2v2 median 0.255 ms.
- **Lane B, render** (`a0557e1`…`5ec9d40`): reticle at the sim's own landing (`renderLanding.ts`
  duplicates `bbFlightEnters`'s integrator on purpose — matching the sim beats being "accurate");
  fixed dark HUD scrim in 3D (`.game-root.view-3d`, tracks a LIVE scene via a MutationObserver);
  chase and orbit cameras (drag/wheel on the host; pref `decodesim.camera`, keys `c`/`i`/`o`/`t`
  handled inside the scene while mounted); `GameScene.project` + `Renderer.setScene` so labels and
  auto paths project through the scene camera (wired in `game.ts` by the coordinator, `8f7300b`);
  theme change followed live. Scene chunk 187 KB gz.
- Roadmap: `docs/roadmap.md` now leads with the owner's eight priorities (auth, privacy, contributors,
  tutorial, replay 2D/3D export, 3D builder, cosmetics plan, rewards plan) with branches and order.

## Owner rulings PENDING (raised by this day's measurements; nothing moved)
1. **A lone NECTAR in a flower does not reach the scoring floor by the CAD geometry** (tops out at
   3.597 vs `BB_FLOWER_VOL_Z` floor 3.904): by the 2D model it always scored. 0.30 in, worth 7
   points and an ownership. `flowerScoreZ` is the extraction that measures it. The 2026-09-12
   sorter ruling is what a change would overturn.
2. The CAD lower bore is 3.222, the manual's Fig 9-12 says 2.79 — CAD wins by the standing ruling;
   noted because the manual's sorting story (nectar seats on the middle ring) is not what the CAD
   does.
3. Weigh a real element set: `BB3_ELEMENT_MASS` 0.2 and the nectar ratio 1.6 are APPROX and the
   tip margin depends on them.

## Next: Day 3 (spec §10) — not started
A: perf tuning, heights in coercion, AI policy and tiers (`GameSimModule.bot`), bots in practice and
lobbies. B: Graphics section with presets and Auto detection (`SceneQuality` is ready), HDRI
environments, export compositing (roadmap item 2), gallery 3D stills, the mobile overhead default,
the 2D→3D key. C: wire the predictors into `game.ts`'s reconcile with the Off/Light/Full/Auto
setting (Lane A's API above), the online-room "Loading 3D physics" panel (`GameView` `need3d` is
`!session && …`; the controller latches `physicsPending` meanwhile), leaderboard `physics` badge and
filter, ranked cutover on the alpha server, smoke lanes filled, docs. Then the alpha ship.
DONE at the end of Day 2 (`20d0194`, `634d749`): `sim3d/` loads ONLY through `initPhysics3d()` —
`sim3d/engine.ts` is the light loader, `sim3d/tilt.ts` the light `hiveTiltAngle`/`hiveTrayRefTheta`
seam the scene imports, `sim3d/step3d.ts` a thin gate over `step3dImpl`, and `sim3d/impl.ts` the
heavy re-export the loader `import()`s (predictors included: `physics3dImpl().createFullPredictor`
after init). Main chunk 917 → 907.88 KB gz (seam 904.17 + the loader/tilt), hostWorker 700.84,
physics3d 1123 (the impl rides with the wasm), scene 187.27; bundleaudit baselines re-measured; a
CORE check forbids static imports of heavy sim3d modules outside `sim3d/` (only `engine` and `tilt`).

## Gotchas (new)
- `setAdditionalMassProperties` on a BODY is discarded by the collider mass recompute — set it on
  the desc; `body.mass()` is stale until the first step. A pinned tray SLEEPS and gravity does not
  wake it: `wakeUp()` at breakaway. The tray and its frame overlap at the bearing: separate
  collision groups; the joint limits are the damper.
- `atan2` is (−π, π]: wrap corner rays into [0, 2π) before sorting an annulus, or the ring closes
  across its bore. A convex hull of a C-bracket fills the C (visual-only parts stay visual-only).
- A `Date.now` DEFAULT PARAMETER trips the sim source guard, and should.
- `Client.send` hands out a live view of the world (`slimWorld` spreads one level): a test sink
  must encode/decode as the transport does. `physics: cond ? '3d' : undefined` CREATES the key:
  test "absent" on `JSON.stringify`, not `in`.
- `w.balls.length = 0` does not clear `rob.hopper`; a fired-out robot ends with an EMPTY hopper
  (measure the peak).
- `npm run dev` was broken by a Day 0 spike file importing an uninstalled package (`scripts/
  spike3d-browser/noncompat.*`, deleted). Orphaned `esbuild.exe`/`node.exe` from a dead Vite lock
  `npm ci` (taskkill first). Never `Remove-Item -Recurse` a directory containing a junction.

---

# HANDOFF — 2026-09-18, later (biobuzz-3d: play-test round 2 — true CAD geometry, CAD colours and tape, HUD-safe framing)

**(Previously READ FIRST.)** Branch **`biobuzz-3d`**, worktree `.claude/worktrees/biobuzz-3d`, clean at the merge
commit named in the log; all gates green there (`npm test` 1798 + the BIOBUZZ suite with a 105-check
SIM3D lane). This round was done by OPUS agents with an analysis phase first, at the owner's request;
the audit is `docs/biobuzz/field-cad-audit.md` — read it before touching the field pipeline.

## The owner's five sentences → root cause → fix (all verified)
1. *Balls on a different plane than the hive bottom* — `convert.py` exported tray hulls as WORLD-frame
   bounding boxes at the 30° tilt and the sim read them as tray-LOCAL; the collider floor sat 3.26 in
   above the mesh floor. Now every tray point is un-tilted about the pivot before export
   (`captureTheta` ±30.000° exactly), `hiveTrayRefTheta` is 0, the body rotation is plain
   `hiveTiltAngle`, and a headless check plus a dev-only raycast at GLB load assert the mesh and
   collider floors coincide (Δ ≤ 0.017 in) with a resting element 1.275 in above the plane.
2. *Hive back gone* — `convert.py`'s `other` group (25 parts: ACM logo panel, A-frame top bar, top
   corners, axle holders, feet, AprilTag plates) was never emitted. Unknown parts now go to a `misc`
   node and are printed; `assemble-gltf.mjs` refuses to finish with an unclaimed STL.
3. *Support structures missing* — the fastener regex matched the word "rivet" and dropped the 24
   perimeter rails and 16 corner hinges. `RE_FASTENER` is an explicit list of fastener families.
4. *Flowers wrong colour* — `XCAFDoc_ColorTool` returns nothing on this STEP; the colours live in the
   styled-item chain, now parsed from the STEP text and carried in the glTF material name
   `<finish>#<rrggbb>` (flowers: amber top ring, green HIPS pipes, purple backstop; the hive's
   alliance colour is the RIBS, not the white skins). Runtime overrides only surface params, forces
   `glass` transparent, and forces `tile` to `COLORS.mat` (the CAD tile grey is a placeholder).
5. *Tape wrong* — the GLB's 16 real tape strips were hidden behind procedural `strokeRect` outlines.
   The CAD tape is shown: all strips 1.000 in wide; loading zones taped on three edges (wall edge
   bare), gardens are two side-by-side 1-in strips, alliance areas on the gym floor; every on-tile
   strip stops 0.573 in clear of the wall face (asserted).
Also: the scoreboard/field overlap — `GameController.refreshHudInsets()` measures every
`data-hud-band` element (score bar, breakdown, status, buttons, BIOBUZZ's own score bar) into
`SceneFrame.insets`; both 3D cameras fit the field into the safe rect via `setViewOffset`; the 2D
camera already reserved matching bands (unchanged). A game that fills the `scoreBar` slot must mark
it `data-hud-band` or it gets the old overlapping fit.

## Physics now
Statics are true per-part convex hulls incl. the frame's diagonal legs, uprights, dampers and
crossbar (73 hulls); tray colliders are planar-facet oriented boxes (a hull of an open shell fills
the cell; the perforated Goal Rib gets none). 18-in AND 29-in robots pass under the down cell (CAD
floor 31.98; a 34.98-in robot is stopped); retention 20/20 at 24/48/72 in; the load table matches;
containment 0; two-run hash equal; perf median 0 ms / p95 1 ms. Sizes: `field.glb` 474 KB br,
`field-low.glb` 137 KB, colliders 31 KB; scene chunk 184 KB gz.

## OPEN findings (owner ruling pending; in the coordinator's memory) — now TWO facts, not four
- The real field is **141.35 in inside the walls** (tiles 23.528 in on centre): that one fact is the
  wall delta (±70.67 vs 72) AND the flower delta (~1.54 in vs `BB_FLOWERS`; `BB_FLOWER_D` itself is
  right to 0.09 in). Deciding the sim's field size is a 2D gameplay change — the owner's call.
- `BB_HIVE_BOTTOM_Z` 25.5 vs the CAD's 31.98.
- CLOSED: the up-cell opening matches the manual within 0.13 in (the old delta was the bbox artifact).

## Gotchas (new)
- **Never `Remove-Item -Recurse` a directory that contains a junction** — it follows the junction; an
  agent deleted 12 entries of this worktree's `node_modules` that way and restored them by copy;
  `npm ci` was re-run afterwards.
- A flat CAD face tessellates to its corners only: measure meshes by triangle/raycast, never by
  vertex scan. `MeshoptSimplifier.compactMesh` rewrites indices in place and returns `[remap, n]`.
  The LOW LOD needs `simplifySloppy` (honeycomb plates plateau). The determinism guard greps
  `sim3d/` by TEXT — do not name a trig function even in a comment.
- The scene preview's `scene.render` is what rotates the trays; a frozen frame loop draws them
  level, which looks exactly like the tilt bug.
- The near wall-top corners pin the driver FOV at 95° below ~21:9; the field fills the safe rect
  horizontally and leaves vertical slack at 16:9 (inherent).

---

# HANDOFF — 2026-09-18 (biobuzz-3d: owner's first 3D play-test fixes — hive tilt/spill, visuals, driver POV)

**(Previously READ FIRST.)** Branch **`biobuzz-3d`**, worktree `.claude/worktrees/biobuzz-3d`, clean at the merge
commit named in the log; all gates green there (`npm test` 1798 + 1413, SIM3D lane 83). The owner
reported four things after playing the Day 1 build; all four are fixed and verified:

1. **Hive visually tilted more than the physics.** The GLB tray node is captured at its rest pose, and
   the scene applied the ABSOLUTE tilt on top of it (double tilt). The scene now imports the physics'
   `hiveTiltAngle(world, a)` (`sim3d/hive3d.ts`) and `hiveTrayRefTheta(a)` (`sim3d/bodies.ts`) and
   rotates the tray by `hiveTiltAngle − hiveTrayRefTheta` — 0 at rest, 60° after a tip — the same
   expression `engine.ts`'s `applyHiveTilt` gives the kinematic body. ONE angle authority; never
   re-derive it in a renderer.
2. **Elements spilled out of the up cell.** Root cause in the PHYSICS: the CAD-sized tray collider was
   built from the box captured at the tray's own tilt without re-inclining it, so at rest the up-cell
   floor was FLAT (mouth and divider at the same z) and every landed element rolled out. Fix:
   `obliqueBoxCollider` bakes the capture angle into each collider's fixed local rotation (never a
   per-tick collider rotation — that destabilises the kinematic body); tray colliders use a `Min`
   restitution combine rule (floor/sides 0.15, back 0). Retention 20/20 at 24/48/72 in; the load table
   (3, 7, 3+2 stay; 8, 3+3 tip) now matches the manual in physics; an unchanged kinematic target does
   not wake resting elements. Consequence: the down-cell clearance is now ~22.7–29.8 in (mid 26.2, vs
   the manual's 25.5) so a 29-in robot IS stopped; the up-cell opening top reads 68.85 vs the manual's
   65.6 — a new OPEN finding beside the bottom one (see below).
3. **Rendering too dark, bad shadows, opaque panels, grey flowers.** ACES exposure 1.2, hemisphere
   1.3 + key 1.9, `RoomEnvironment` IBL via PMREM, `VSMShadowMap` (PCFSoft is deprecated in three
   0.186) with a shadow camera fitted to ±92 in, bias −0.0012 / normalBias 0.035 / radius 3; walls and
   station panels are transparent polycarbonate (opacity 0.22, depthWrite off, DoubleSide, renderOrder
   10); room backdrop lightened to gym grey. The GLB now carries one primitive PER PART CLASS with a
   named material (`flower_ring/pipe/base`, `hive_frame_metal`, `tray_metal`, `tray_panel_red/blue`,
   `wall_panel/extrusion`, `tile`, `tape_*`); `renderFieldGlb.ts` assigns PBR by material NAME.
   `convert.py` writes one STL per class per node; `assemble-gltf.mjs` builds the primitives.
   Colliders/measurements stayed byte-identical through the regeneration.
4. **Driver POV missed the near edge.** `fitDriverCamera(alliance, viewAngle, aspect)` in
   `renderCameras.ts` solves pitch analytically and the setback by search so all four corners, both
   wall tops and the hive tops fit with a 4 % margin: 16:9 → eye 72 in, setback 24 in, pitch 37.5°,
   FOV 95° (the near corners pin the FOV at `DRIVER_FOV_MAX`; raising the eye is preferred over
   pulling back). If it reads too wide in play, `DRIVER_EYE_H_*`/`DRIVER_SETBACK_*`/`DRIVER_FOV_MAX`
   are the knobs.

**OPEN findings (owner ruling pending, move nothing; in the coordinator's memory):** flower ring
centres ~1.4 in off `BB_FLOWERS`/`BB_FLOWER_D`; wall inner faces ±70.67 vs 72 (3D walls stay at 72);
hive up-cell opening [47.05, 68.85] vs `BB_HIVE_OPEN_Z` [53.5, 65.6] and down-cell clearance ~26.2
vs 25.5. The measurements check prints them under wide, commented tolerances.

**Gotchas added:** `PCFSoftShadowMap` is gone in three 0.186 (use `VSMShadowMap`); in the app the
`computer` tool's key presses may not reach the game's listeners (dispatch a synthetic
`KeyboardEvent`); `coerceAssists` forces `aimAssist` on, so a synthetic firing test sets
`r.aimAssist = false` on the spawned robot; `releasePollen`/`takeHeld` need a matching `held` ball
in `world.balls`, not just a hopper entry; the "Goal Rib" parts are treated as tray metal and only
the Top/Back/Bottom skins as the alliance panel (a judgement from part names, unverified against a
photo). Day 2 (spec §10) remains next; see the section below for the plan.

**Owner re-test 2026-09-18, after these fixes: STILL WRONG.** Elements sit on a different plane than the
tray floor; the hive's back and some support structures are missing from the GLB; flower colours still
wrong; tape layout and widths incorrect (wall-bounded zones carry no tape on the wall side; tape widths
are documented); the scoreboard overlaps the field. Diagnosis: the collider export used per-part AABB
corners (so the physics tray floor is not the mesh floor and the frame legs were dropped), the GLB
assembly drops/mis-classes structural parts, and colours/tape/tiles were procedural guesses. Round 2 is
running on OPUS agents (owner asked for better agents and more thorough analysis): a CAD audit doc,
true per-part hull colliders in each tray's un-tilted local frame, CAD (XCAF) colours and CAD tape,
and HUD-safe camera framing.

---

# HANDOFF — 2026-09-17, night (biobuzz-3d: Day 1 LANDED — 3D physics, 3D renderer, CAD field)

**(Previously READ FIRST.)** Branch **`biobuzz-3d`**, worktree `.claude/worktrees/biobuzz-3d`. Tree clean at the
merge commit named in the log; every gate green at that commit: `build` · `server:check` · `docaudit`
(CLAUDE.md 26,850 / 27,000 bytes) · `uiaudit` · `bundleaudit` · `npm test` (1798 shared + the
BIOBUZZ suite incl. the SIM3D and RENDER lanes, count in the log). The owner play-tested the first
3D view mid-day, found field parts misplaced and the graphics too plain, and ruled "the field should be
CAD derived" — both are addressed below. Day 2 (spec §10) is next; nothing of it is started.

## What Day 1 delivered (spec `docs/biobuzz/plan-3d.md` §10, all three lanes, merged)

- **Seam** (`941a598`): `Physics` type; `World.biobuzz.physics` + `biobuzzPhysics()`; `step2d`/`step3d`
  dispatch; `RobotState.z/vz`; `RobotSpec.heightIn` (+ the `coerceSpec` carry-across fix in
  `src/sim/spawn.ts`); `GameSettings.practicePhysics` (default `'3d'`); `GameModule.scene` and the
  `GameScene`/`SceneFrame` contract; `GameSimModule.bot?`/`physicsOptions`; `sim3d/engine.ts` loader
  (`initPhysics3d()`, dynamic import of the wasm); `graphics/store.ts` view pref; `worldHash` mixes `r.z`.
- **Lane A, sim** (`src/games/biobuzz/sim3d/`): persistent Rapier 3D world per `World` (WeakMap),
  id-ordered bodies, sync-before/readback-after, robots on the SHARED wrench (parity 1.000 in open
  field), elements with CCD, capture/launch/place/human player reusing the 2D bookkeeping (pure
  extractions: `hiveTimerStep`, `bbHumanPlayerTick`, exported `placeInFlower`/`biobuzzStepMatch`),
  KINEMATIC tray on the shared timer with PHYSICAL spill, `derive.ts` (contents/stacks/tags), containment
  net with `containmentFixes === 0` asserted. SIM3D lane: 34+ checks incl. two-run hash and perf
  (`step3d` 2v2 median ≈ 0 ms, p95 1 ms vs the 1.5 ms gate).
- **Lane B, renderer** (`scene/render*.ts`, lazy chunk 182 KB gz of 250): field, robots generated from
  spec (chamfered chassis, drivetrain wheels, sweepers, mechanisms, team sign), 56 instanced spheres
  with rolling spin, driver-station + overhead cameras, ACES + sRGB, PCF-soft 2048 shadows, procedural
  room. Geometry proven against `drawField.ts` with a side-by-side page (`scripts/scene-preview`, in-page
  named-object check) — four real errors fixed (flower pipes sideways, up-cell 3 in high, wall
  thickness, flower-parked element height); conventions (y direction, heading, alliance walls) were right.
- **Lane C, client**: Practice setup gains **Physics 2D/3D** (`practicePhysics`) and **View 2D/3D**
  (per device); `GameView` awaits `initPhysics3d()` before a 3D practice (fallback to 2D with an
  event-log line); the scene mounts UNDER the 2D canvas (`renderer.ts` `overlayOnly`), created/disposed
  live on view switch; `scripts/bundleaudit.mjs` ratchet (main, hostWorker, physics3d, scene).
- **CAD field** (owner decision): `npm run field-cad` → `public/models/biobuzz/` (`field.glb` 359 KB br,
  `field-low.glb` 242 KB, `field-colliders.json` 23 KB, `field-measurements.json`, README with source,
  sha256 and node names). Scene draws the CAD walls, hive frames, trays and flowers over the procedural
  tile/tape floor (constants fallback on any load failure). Physics: floor and walls analytic at the
  CONSTANTS; tray cells sized from the CAD cell; flower supports CAD trimesh (`FIX_INTERNAL_EDGES`);
  hive-frame legs/uprights EXCLUDED (their hulls are loose AABBs that sealed the drive-under). Twelve
  probe points agree between the CAD and constants engines.
- **Verified in the real app** (Physics 3D): drive, capture (HUD pips), a real parabolic shot, tray tip
  with physical spill, View 2D↔3D mid-match, resize; console clean.

## OPEN findings — owner ruling pending; MOVE NOTHING (also in the coordinator's memory)

CAD vs constants: flower ring centres ~1.4 in off `BB_FLOWERS`/`BB_FLOWER_D` (pipe-centroid proxy;
a bore fit would settle it); wall inner faces ±70.67 vs `BB_HALF_X` 72 (3D walls kept at 72 for
parity with the 2D pipeline and the staging); hive up-cell opening [47.05, 65.65] vs `BB_HIVE_OPEN_Z`
[53.5, 65.6] and down-cell lowest point 31.96 vs `BB_HIVE_BOTTOM_Z` 25.5 (one rigid bar cannot meet
both manual figures; the CAD says 25.5 is not the tray floor). The measurements check prints all of
them under wide, commented tolerances.

## Next: Day 2 (spec §10)

A: dynamic see-saw on a revolute joint + `scripts/hive-calibrate.ts` against the field-guide rows
(`BB3_HIVE_DYNAMIC` flips to true; kinematic stays the fallback); flower TUBES (the CAD rings are
excluded from the collider file because a hull of an annulus fills its hole — export ring trimeshes
from `convert.py`); derived flower stacks by z; G409/G417 tags; Light/Full prediction worlds + Auto
probe. B: reticle, HUD scrim, chase/orbit cameras, interpolation of balls and remotes (the scene
ignores `frame.alpha` today), labels through the scene camera, theme change mid-scene (backdrop read
once). C: `await initPhysics3d()` at server boot, `RoomConfig.physics`, `'bb3d'` cap gate, matchmaking
`3d`, the `physics` migration, `costprobe` scenarios, replay header + re-sim check, LAN lazy init.
Cleanups queued: move `sim3d/` behind `initPhysics3d()` (it is statically imported by `step.ts`, so
the main chunk carries ≈ +4.5 KB gz); tight per-part hulls for the hive frame in `convert.py`; Aim
Assist's landing prediction is an alignment gate under 3D; elements can marginally perturb a robot
(collision groups); the GLB's tiles/tape node is unused (no per-region colour); courtesy note to FIRST
(owner sends). Days 4-14: weigh a real element set (`BB3_ELEMENT_MASS` is APPROX).

## Gotchas (new this day)

- **Sonnet subagents obey the session's cwd over the prompt** when the Edit/Write tools refuse
  cross-worktree paths: two of six lanes worked in the session's own worktree. State the path in every
  command and check `git log` for where a commit landed. Lane worktrees shared ONE `node_modules`
  through junctions (`New-Item -ItemType Junction`; remove with `cmd /c rmdir`, never `rm -rf`).
- **Never route base64 image data through a tool call** (a `toDataURL` write blew the 64k output
  limit twice). Describe screenshots; the browser pane is visible to the owner anyway.
- **The in-app browser pane**: `requestAnimationFrame` only advances when a paint is forced
  (alternate `wait` and `screenshot`); the pane is shared between concurrent agents (always
  `tabs_create` and pass `tabId`); Enter does advance the countdown. Fastest way to drive the game
  from a script: walk the React fiber from the canvas to `GameView`'s third ref (the `GameController`)
  and edit `world` JSON directly — the next tick reconciles the bodies.
- **Rapier 3D**: forces persist across steps (`resetForces`/`resetTorques` per tick); a collider's
  `setTranslation` offset rotates with the BODY, so a per-collider rotation offset needs its
  translation rotated too; `RigidBodyDesc.enabledRotations`; `TriMeshFlags.FIX_INTERNAL_EDGES`.
- **CAD pipeline**: `BRepMesh_IncrementalMesh` caches on the shape (call `BRepTools.Clean_s`
  first); flat STL normals block meshoptimizer's simplifier (drop normals, recompute in the loader);
  GLTFLoader strips `/` from node names (use `userData.name`); `.cmd` shims cannot be `execFileSync`'d
  on Windows (call `node <cli.js>`); the standalone `scene-preview` needed its own `vite.config.ts`
  (`publicDir`) to serve `/models/biobuzz/*`.
- Pre-existing: `uiaudit` `stale-component-index` after a merge — `npm run uiindex`; `smoke.ts` is 1798
  checks, not the 1765 CLAUDE.md still says; a dev-only "Invalid hook call" cascade in `AdsProvider`
  on cold loads (both physics; not investigated).

---

# HANDOFF — 2026-09-17, later (biobuzz-3d: Day 0 physics spike results)

**(Previously READ FIRST.)** Branch **`biobuzz-3d`**, worktree `.claude/worktrees/biobuzz-3d`. Tree is clean
except for the files this session adds/commits: `scripts/spike3d.ts` (new, throwaway CLI),
`scripts/spike3d-browser/` (new, throwaway browser+Electron harness), `docs/biobuzz/spike3d-
results.md` (new), this HANDOFF section, and `package.json`/`package-lock.json` (three new
pinned installs, `src/` and `docs/area/` untouched). `npm ci` ran clean (560 packages). `npm run
docaudit` passes (CLAUDE.md 26,670 / 27,000 bytes, unchanged).

## Installed this session (all pinned `-E`, `@dimforge/rapier2d-compat` untouched at 0.19.3)

`@dimforge/rapier3d-deterministic-compat@0.20.0` (dependencies), `three@0.186.0` +
`@types/three@0.186.0` (devDependencies). `@dimforge/rapier3d-deterministic@0.20.0` (the
non-compat build) was installed once with `--no-save` to probe it and is **not** in
`package.json`/`package-lock.json` — confirmed by grep after the probe.

## Results: the Day 0 spike PASSED the gate

Full numbers, the runtime matrix, and the tray/joint gotcha are in
`docs/biobuzz/spike3d-results.md`. Summary:

- **Hashes equal across two Node runs** (`1971098706` both times) — the mandatory check.
  **Also equal in Chromium (Electron)** — `1971098706` there too, which the gate did not
  require but the plan hoped for. The deterministic build's cross-platform promise held on
  this scene, this machine.
- **Step time far under budget**: 0.020 ms median, 0.046 ms p95 against a ≤ 1.5 ms target — but
  this scene (4 robots, 56 elements, 2 tray bodies, no CAD trimesh, no real gameplay reads) is
  smaller than a real 2v2 room will be, so treat this as a floor, not a prediction; re-run with
  `costprobe`'s `biobuzz3d-*` scenarios once `step3d` is real.
- **Runtime matrix**: `-deterministic-compat` initialises and matches hashes in both Node/tsx
  and browser (Vite dev + Electron). The non-compat `-deterministic` package **fails in both**
  Node/tsx and Vite/browser as published on this Vite version (6.4.3) — it has no `init()` and
  its glue does a bare `import * as wasm from "*.wasm"`, which Vite explicitly rejects without
  `vite-plugin-wasm` and Node's ESM resolver rejects on the extensionless imports before it even
  gets that far. **Stay on compat, as the plan already defaults to** — do not spend Day 1/2 time
  trying to swap packages without adding a wasm plugin, which is a separate decision.
- **Tray/joint gotcha, worth remembering for the real `sim3d/`**: `JointData.limitsEnabled` /
  `.limits` set before `createImpulseJoint` were **not enough** — the tray span past the
  intended ±30° to ~177° before something else stopped it. Fix: call `.setLimits(min, max)` on
  the `ImpulseJoint` **instance** `createImpulseJoint` returns. With that, both trays sat
  exactly at `30.0000448913582°` for the full run (the ballast pins the empty/lightly-loaded
  tray at one stop, matching the intended start condition) — not a calibrated see-saw yet,
  which is `hive-calibrate.ts`'s job on a later day per plan §3.6.
- **Chunk size**: the physics chunk is 2,891,032 B raw / 1,089,268 B gzip-9 (matches the plan's
  ~1.1 MB gzip estimate); the main chunk grows by a noise-level 110 B raw when the loader is
  merely reachable. **Methodology gotcha**: an exported-but-never-referenced function is
  tree-shaken away entirely before Rollup code-splits it — the first attempt (exactly what the
  spec asked for) produced a byte-identical build and no new chunk at all. Had to add one
  module-scope side-effecting reference (`globalThis.__x = theFn`) to keep the declaration alive
  for the measurement, then revert everything (`git checkout --`) and rebuild to confirm the
  tree was clean again (it was — byte-identical to the pre-spike baseline). Worth remembering
  for whoever writes `bundleaudit` (spec §2.5/§7): it needs the same trick, or a real call site,
  to measure an as-yet-unused dynamic import honestly.

## Next: Day 1 (spec §10) — the whole game on 3D physics in the 2D view

Not started. Per the spec: `sim3d/engine.ts` (persistent Rapier world, `initPhysics3d()` behind
a dynamic import), `step3d` (§3.1's nine-step tick), `derive.ts` (§3.5, fills
`hives[a].contents`/`flowers[i].stack` from body positions so `score.ts`/`hud.ts`/the 2D
renderers work unchanged), the real hive frame + tray (§3.6, starting from this spike's geometry
but calibrated against the manual's two published tip rows via `hive-calibrate.ts`), flowers
(§3.7), and the `World.biobuzz.physics: '2d' | '3d'` dispatch in `biobuzzStep`. Also queued at
Day 0 but not run by this session: the CAD pipeline (`scripts/field-cad.mjs` +
`scripts/field-cad/convert.py`) and the courtesy note to FIRST (owner sends it; draft is in the
demoted section below).

## Gotchas (carried forward + new)

- **`JointData`'s `limitsEnabled`/`limits` fields alone did not clamp a revolute joint** in
  `@dimforge/rapier3d-deterministic-compat` 0.20.0 — call `.setLimits(min, max)` on the created
  `ImpulseJoint` instance too. Untested whether this is a compat-wrapper quirk or true of raw
  Rapier 0.35; did not have time to check upstream, and it does not block Day 1 since the
  workaround is one line.
- **An exported function with no call site or reference is dead-code-eliminated**, `import()`
  inside it and all — do not trust "add an unused export, build, measure" for a chunk-size
  check without also keeping the declaration reachable (see above).
- Two Rapier packages coexist on purpose: 2D on `rapier2d-compat` 0.19.3, 3D on
  `rapier3d-deterministic-compat` 0.20.0. Never upgrade the 2D package as a side effect.
- The 3D wasm must load through a **dynamic import** inside `initPhysics3d()`, same reasoning
  as before — this spike's own chunk-size measurement is the number that makes that concrete
  (≈1.09 MB gzip if it ever leaked into a chunk every player loads).
- Other sessions have worktrees here (`main-merge`, `alpha-ui`, `nice-morse-…`, a
  `claude/biobuzz-3d-worktree-…` that is unrelated). Do not `cd` into them; the stash stack is
  shared.
- CLAUDE.md still has headroom (26,670 / 27,000 bytes) — unchanged this session, nothing here
  touched it.

---

# HANDOFF — 2026-09-17, late (biobuzz-3d: Day 0 begun, alpha carries the split, PAUSED before the physics spike)

**(Previously READ FIRST.)** Branch **`biobuzz-3d`**, worktree `.claude/worktrees/biobuzz-3d`, now based on
**`alpha` 7e268dd**. The branch carries `docs/biobuzz/plan-3d.md` (draft 3 with the owner's eleven
decisions, §12) and this HANDOFF. **No code has been written.** The owner asked for cheap
subagents and a pause with a detailed handoff before any step that could use a whole session;
this is that pause.

## Done this session (Day 0, part 1)

- **`efficiency-audit` merged into `alpha`** (1ecc3f2; the owner's Q10). No conflicts: the two
  branches touched disjoint files (`git merge-tree` preview, then the merge). `npm run uiindex`
  regenerated the component index alpha's six UI commits had outdated (7e268dd). **Every gate on
  the merged alpha is green**: `build` · `docaudit` (CLAUDE.md 26,670 / 27,000 bytes) · `uiaudit`
  · `npm test` **1765 + 1321 ALL PASS**. Pushed to `origin/alpha`.
  ⚠️ **Migration 0037 is a SERVER change**: until the alpha app is redeployed (owner's wrapper,
  `fly-deploy.sh --alpha`), its six indexes do not exist in production. Same for main later.
- `biobuzz-3d` merged with the new alpha. HANDOFF conflict resolved by keeping the biobuzz-3d
  sections on top of alpha's log. The spec's status line records the base.
- `npm ci` ran in `.claude/worktrees/pr-alpha` (it has `node_modules` now); **the biobuzz-3d
  worktree still has none**, and neither do the other worktrees.

## PAUSED HERE: the next step is the Day 0 physics spike (spec §10)

Run it as **one sonnet subagent** in the biobuzz-3d worktree. Estimated: 30 to 60 minutes wall,
moderate tokens, no shared-file edits. The plan, in order, with the acceptance it must report:

1. `npm ci` in the worktree (a few minutes; Electron is a dependency).
2. Install, pinned exactly like the 2D physics: `npm i -E @dimforge/rapier3d-deterministic-compat@0.20.0`
   (in `dependencies`: the server needs it) and `npm i -D -E three@0.186.0 @types/three@0.186.0`.
   Nothing imports them yet except the spike. (Registry checked 2026-09-17: all three at those
   versions; the compat package unpacks to 10.3 MB, wasm about 2.05 MB / 767 KB gz.)
3. `scripts/spike3d.ts` (throwaway, run with `tsx`, never in `npm test`): `await import(...)` the
   compat module and `init()`; build a z-up world (gravity `{x:0, y:0, z:-386}` in inches);
   statics: floor, four walls at ±72, two frame base bars (x in [24,25] and [-25,-24], y ±19.4);
   four dynamic 18-in boxes with yaw-only rotation (`setEnabledRotations(false,false,true)`),
   z free; 56 dynamic spheres (40 × r 1.4, 16 × r 1.8, mass 0.2 lb, CCD on); one dynamic tray per
   hive on a revolute joint about x at (±12.75, 0, 43.95) with limits ±30° and a trial ballast
   (or kinematic first if the joint fights); a scripted push on one box for 600 ticks; step 3,600
   ticks at 1/60. Every 60 ticks hash all positions rounded to 1e-4 (FNV-1a, the `worldHash`
   shape). Print: median and p95 ms/step, body count, sleeping count, the final hash.
4. **Run it twice in Node**: the two final hashes must be equal (the deterministic build's whole
   promise). If they differ, stop and report; do not tune.
5. Cross-runtime: run the same spike in Chromium (a throwaway Vite page or the Electron shot
   runner) and compare the final hash with Node's. Report equal / not equal.
6. Try the non-compat `@dimforge/rapier3d-deterministic@0.20.0` with the raw `.wasm` (Vite `?url`
   in browser and worker; `fs.readFileSync` in Node and `tsx`). Record which of the four runtimes
   initialise; if all four, it saves about 300 KB gzipped per §2.5. Do not switch packages in
   this spike; just report.
7. Add a dynamic `import()` of the compat module behind an unused function, `npm run build`, and
   record the emitted chunk sizes (`dist/assets`), then remove it. `bundleaudit` does not exist
   yet; this is the baseline number for it.
8. Commit the spike script and a `docs/biobuzz/spike3d-results.md` (numbers only, the runtime
   matrix, the hash outcome) on `biobuzz-3d`; prepend a HANDOFF section.

**Gate (spec §10 Day 0):** hashes equal across two runs; median step at or under 1.5 ms for the
2v2-equivalent world. **Kill/adjust:** step over 3 ms after enabling sleeping and limiting CCD to
fast bodies → the "freeze far elements" fallback in spec §11; hashes unequal on the deterministic
build → stop, the vendor's promise failed, report before anything else is written.

Also on Day 0, as separate cheap agents once the spike passes: **the CAD pipeline**
(`scripts/field-cad.mjs` + `scripts/field-cad/convert.py`; needs Python and `pip install cadquery`,
a heavy install: run it in its own agent and report the measurements file first, the GLB second),
and the **courtesy note to FIRST** (the owner sends it; draft below).

## Draft note to FIRST (for the owner to send)

> Hello. I run DSIM (playdsim.com), a free driver-practice simulator for FTC teams. For the
> BIOBUZZ season I am building a 3D mode and would like to use the published field CAD (the STEP
> release on ftc-resources) as the source for a simplified, decimated field mesh and collision
> geometry, served from the site and committed to the project's public repository, with
> attribution to FIRST and the manual's CAD credit. Your terms of use grant personal use; could
> you confirm this use is acceptable, or tell me what attribution or limits you would want?
> Thank you for publishing the CAD; it is what makes an accurate simulator possible.

## Gotchas

- **Two Rapier packages coexist**: 2D on `rapier2d-compat` 0.19.3, 3D on
  `rapier3d-deterministic-compat` 0.20.0 (Rapier 0.35: new sleeping, sweep CCD on for fixed
  colliders, changed contact defaults). Never upgrade the 2D package as a side effect.
- The 3D wasm must load through a **dynamic import** inside `initPhysics3d()`; a static import
  anywhere reachable from `src/games/index.ts` or the LAN `hostWorker` puts about 1.1 MB gzipped
  into chunks every player pays for. `bundleaudit` (to write) is the ratchet.
- CLAUDE.md has **330 bytes of headroom**: the spec's two sentences (game table row, the
  client-bundle rule) must fit or the rule moves to `docs/area/biobuzz.md` with a pointer.
- Other sessions have worktrees here (`main-merge`, `alpha-ui`, `nice-morse-…`, a
  `claude/biobuzz-3d-worktree-…` that is a main-merge branch unrelated to this work). Do not
  `cd` into them; the stash stack is shared.
- The spec compares against a comparable third-party 3D sim only generically; keep it that way.
- The CAD-derived field files SHIP by owner decision (Q9); keep the constants fallback complete.

---

# HANDOFF — 2026-09-17, night (biobuzz-3d: draft 3 of the spec, ONE game with a 3D deterministic authority)

**(Previously READ FIRST.)** Branch **`biobuzz-3d`**, a worktree at `.claude/worktrees/biobuzz-3d`, based on
`alpha` **1ecc3f2** (`efficiency-audit` merged into alpha on 2026-09-17, the first Day 0 step). The branch carries only **`docs/biobuzz/plan-3d.md`** and this HANDOFF. No
code has been written. Every gate is alpha's, unchanged.

⚠️ **Drafts 1 and 2 were REJECTED by the owner.** Draft 1 kept the 2D sim authoritative under a
3D view; draft 2 made 3D a separate `biobuzz3d` game. The owner's direction (2026-09-17, verbatim
in spirit): BIOBUZZ stays ONE game; every ranked or record match runs on a 3D deterministic
server; players render in 2D or 3D and the 2D path stays very fast; practice offers the old 2D
physics, 3D physics with a 2D view, or 3D physics with 3D rendering, each with or without AI;
prediction is a player option; graphics have presets and detailed settings; GPU acceleration is
on automatically. Draft 3 is that. Read it, not the commit history.

## What draft 3 decides

- **One game id.** `World.biobuzz.physics: '2d' | '3d'` (absent `'2d'`); `biobuzzStep` dispatches.
  The 2D pipeline is untouched and stays selectable for practice and casual rooms; deleting it
  later is one branch of one function (owner Q11).
- **Rapier 3D, deterministic build** (`@dimforge/rapier3d-deterministic-compat` 0.20) in
  `src/games/biobuzz/sim3d/`, authoritative for ranked, record and matchmade rooms and their
  replays. Persistent server world, JSON readback each tick, spill and flower stacking from
  physics, the manual's tip table kept.
- **Derived lists** (`sim3d/derive.ts`) fill `hives[a].contents` and `flowers[i].stack` from body
  positions, so the shared `score.ts`, HUD, results and the 2D renderers work under both physics.
- **Same wire for 2D and 3D clients** (robots gain `z/vz`; elements already carry them). Two
  renderers over one world: the canvas (no WebGL, no wasm) and a lazy Three.js chunk.
- **Prediction: Off / Light / Full** (Light = drive model + walls, no wasm, the 2D default).
- **Graphics: Auto / Low / Medium / High / Ultra / Custom** over sixteen settings, per device;
  Auto = GPU detection + a 2 s warm-up; software GL → 2D view; `high-performance` power
  preference; hardware acceleration never disabled in the app.
- **Practice**: physics 2D/3D, view 2D/3D, AI opponents off or a tier. Runs upload with
  `physics` + `view` tags. One migration adds `physics` to records/matches/replays/practice_runs
  (default `'2d'`), no season reset (owner rule).
- **CAD import**: `scripts/field-cad.mjs` (STEP → CadQuery → glTF + collider meshes +
  measurements); constants fallback; licence unresolved (ask FIRST, owner Q9).
- **Build plan in days**: Day 0 spike gate (hash equal across runtimes, 2v2 step ≤ 1.5 ms);
  Day 1 the whole game on 3D physics in the 2D view; Day 2 3D rooms online; Day 3 the 3D
  renderer, graphics settings and the alpha ranked cutover. Three lanes.

## Owner decisions (2026-09-17, recorded in §12)

Lobbies/LAN default 3D with a host 2D option · deterministic build everywhere (Day 0 speed gate) ·
robots yaw-only now, pitch/roll designed for later (3.3) · **dynamic see-saw calibrated to the
field-guide rows** (3.6; kinematic fallback) · realism then rulebook for opponent shots · prediction
Auto-calibrated (5) · ranked cutover on alpha Day 3, production when the owner says · Force-GPU
toggle offered, off by default, auto-cleared after a GPU crash · **ship the CAD-derived field files**
(owner accepts the licence risk; courtesy note to FIRST) · merge `efficiency-audit` first · **the 2D
physics is a permanent light practice option, never deleted**.

## Next steps

1. Merge `efficiency-audit` into `alpha` (a real merge, +14/+6), rebase `biobuzz-3d`.
2. Day 0 per §10: deterministic 3D package spike (hash across runtimes, 2v2 step ≤ 1.5 ms),
   CAD pipeline run, courtesy note to FIRST.
3. Weigh a real element set when possible; mass and the nectar ratio are APPROX until then.

## Gotchas

- The base now carries the CLAUDE.md split: `docs/area/` guides, `npm run docaudit`, the sharded
  `npm test` and migration 0037. CLAUDE.md is at 26,670 of its 27,000-byte budget, so the spec's
  two sentences must fit or move to a guide. Spec line refs are as of `efficiency-audit` e0ce598.
- The spec compares against a comparable third-party 3D sim only generically; keep it that way.
- The CAD-derived field files SHIP by owner decision (Q9); keep the constants fallback complete so they can be pulled in one commit.
- `V` is Chain Reaction's `fling`; the view-cycle key is `t`.
- Under 3D physics, `state.kind === 'element'` means "a body inside a structure", not "not
  solved": the 2D readers only read the tag; do not port the 2D assumption into `sim3d/`.

---

# HANDOFF — 2026-09-17b (main: the record-restart regression, fixed and deployed)

**READ FIRST.** The alpha merge (below) shipped a regression: **restarting a record run was
refused** with "You already have a game in progress - rejoin or leave it first". Fixed,
deployed, `/health` ok, one image across all 8 machines.

**The cause is worth knowing, because it was latent for months.** `startLoop` used to open
with `stop()`, which releases every single-game lock `startMatch` had just taken — so the
one-game-per-user guard bound NOTHING. `0857745` split `stopLoop()` out and made the guard
real, and the restart path had always quietly depended on it being inert: restarting is a
full teardown (dispose the session, join a BRAND-NEW `rec-` room), so the new run arrives
while the old room still holds the account's lock.

**⚠️ IT ONLY APPEARS ON AN AUTHENTICATED JOIN** (`if (user && activeElsewhere(...))`), which
is why nothing caught it. Every ad-hoc socket test run against it was anonymous — the join
field is `authToken`, not `token`, and a wrong field name reads as a signed-out player and
passes vacuously. If you are testing a lock, assert the lock was TAKEN first.

**The fix**: a solo record run yields at the door and is the only room kind that does — no
opponent, no alliance, no rating, so the only person it can be in the way of is its owner.
Versus, duo and ranked still refuse. Only the LOCK is released (`releaseSeatLock`), never the
room, because a run decided at the buzzer is kept alive by `finishing` until the field settles
and its score is written. Client half: `restartRun` sends `abandon` on the live socket before
disposing, and clears `activeGame` (which still named the abandoned run, so Home went on
offering to rejoin a match that no longer existed). 8 checks in `npm test`.

## Still open

- **A REJOIN COMPLAINT I COULD NOT REPRODUCE** ("can't move, can't see anyone else move").
  Driven end to end against the real server — 2-player versus, one player dropped with a 1006,
  rejoined, both drove: the rejoined player moved exactly as far as the one who never dropped,
  both saw the same positions, snapshots kept flowing. `reattach` is fine on this evidence.
  Needs specifics before it can be chased: which mode (ranked / custom / record duo), and which
  "rejoin" — the Home card, a page refresh, or a network drop that recovered by itself.
- **A PRE-EXISTING GAP, found while testing and NOT fixed**: an account in a LIVE VERSUS match
  is admitted into a new solo record room. It reproduces with the fix reverted, so it predates
  all of this — the guard simply does not fire on that path. Worth a look; it is the same guard
  the record restart was tripping over, pointed the other way.
- The season-4 drift from the merge below is unchanged and still the owner's call.

# HANDOFF — 2026-09-17 (main: alpha merged whole and deployed, season HELD at 4)

**Superseded by the section above.** `alpha` is merged into `main` as a single merge commit and deployed to Fly.
The branches are level: everything that was on alpha is on main, and main's two spectator
fixes (`applyBallDelta` COPIES, a reconnecting spectator re-spectating) survived the merge —
their four smoke checks are asserted present in the merged tree.

**⚠️ NO VERSION BUMP WAS TAKEN.** `BALANCE_VERSION` stays **4** and `SIM_VERSION` stays **2**
(both were already equal on the two branches, so the merge moved neither). The owner declined
the owed bump to 5 on 2026-09-17: the batch does move scores — settle-based finalize, and the
BIOBUZZ buzzer-TIP — but bumping archives the standings for everyone on the one Fly app, and
holding the season was the call. The consequence is on the record in `src/config.ts`: records
set before and after this deploy share a board although the scoring moved under them. That is
accepted, not an oversight. Do not "fix" it by bumping later without asking.

## The five conflicts and how they went

| file | hunks | resolution |
|---|---|---|
| `src/standing.ts` | 1 | **alpha's `card: 5`** — main's `20` contradicted the docstring directly above it, and the 2026-09-16 backport HANDOFF had already written down that alpha's side wins here next time |
| `server/room.ts` | 2 | alpha's — `passCrown` on a host leaving a finished match, and `stopLoop()`, which alpha split out of `stop()` and main never had |
| `scripts/smoke.ts` | 1 | alpha's — the HEAD side was empty; purely additive room-recycle tests |
| `src/ui/Matchmaking.tsx` | 6 | alpha's — all six HEAD sides empty (`saveStagedMatch`/`clearStagedMatch` calls) |
| `HANDOFF.md` | 1 | alpha's, then this section prepended |

None of the five needed a judgement the repo had not already recorded.

## Gates, all green on the merge commit

`npm test` **ALL PASS twice** (shared + BIOBUZZ 1321) · `npm run test:mm` 186 ·
`npm run dbtest` ALL PASS · `build` · `server:check` · `uiaudit` at/under baseline ·
`contrast` 223.

No new migrations — the admin-panel pair (0035/0036) was already on main from the backport,
so this deploy needed no schema step.

## Next

- `alpha` is now behind `main` by this merge commit. Fast-forward it before doing more work
  there, or the branches re-diverge immediately.
- The season-4 drift above is the open question, not a task. It gets settled the next time
  someone is willing to reset standings.

# HANDOFF — 2026-09-16, later (efficiency audit: the test loop, the indexes, the render path)

**READ FIRST.** Branch **`efficiency-audit`** off `alpha`, 12 commits, **not merged and not
deployed**. Every gate green: `npm test` ALL PASS ×2 (1765 + 1321) · `test:mm` 186 · `dbtest`
ALL PASS · `build` · `server:check` · `uiaudit` · `contrast` · **`docaudit`** (new).

⚠️ **The DB migration (0037) is a SERVER change and needs a deploy** to take effect, like
0035/0036 before it. Until then the indexes do not exist in production.

## What landed

| # | commit | what |
|---|---|---|
| 1 | `test:` | **`npm test` 237s → 39s.** `smoke.ts` sharded across 12 processes by `scripts/smokeshard.mjs`. |
| 2 | `db:` | migration **0037**: six missing indexes, two dead ones dropped, and the two RULES asserted in `dbtest`. |
| 3 | `render:` | held-artifact grouping, the per-ball highlight hoisted, `useCoarsePointer`. |
| 4 | `docs:` | HANDOFF archived, and the check counts in CLAUDE.md corrected. |
| 5 | `server:` | LAN roster moderation parallelised, `/api/stats` memoized. |
| 6 | `docs:` | HANDOFF entry for the session. |
| 7 | `docs:` | search with `rg`, not `grep -r` — `.claude/worktrees/` is 810 MB of repo copies. |
| 8 | `docs:` | **CLAUDE.md split: 43.7k tokens → 6.6k**, plus `docaudit` and the area hook. |

### 0. CLAUDE.md is now a routed core, and the routing is enforced

It was 2,206 lines (~43,700 tokens) and it is loaded into EVERY session, so a session fixing a
button paid in full for DECODE's gate-lever geometry and the Ko-fi webhook policy. It is now
~6,600 tokens: what is true everywhere, plus a routing table to ten guides in `docs/area/`
read on demand.

**Nothing was rewritten.** 2,035 of the original 2,042 non-trivial lines are byte-identical in
their new homes; the 7 that differ are the reworded opening blockquote and five
cross-references that pointed at sections now in another file. Verified by a line-level diff
against git HEAD, not by assertion.

⚠️ **The risk here is not size, it is SILENCE** — a rule in a guide nobody opens has been
deleted, not relocated. Two defences:
- **`npm run docaudit`** — every guide routed, every link resolving, every `governs:` glob
  still matching real files (catches a RENAME, which otherwise leaves a guide governing
  nothing), every source file owned, and CLAUDE.md inside a token budget that is a **RATCHET**
  (only ever lowered, so the file cannot grow back). All five rules were tested by breaking
  them. Writing it found a `governs:` line already wrong and sixteen unowned top-level modules.
- **`scripts/areahook.mjs`** — a PostToolUse hook naming the guide for the file just edited,
  once per area per session. Reminder, never a block; always exit 0.

**If you add a rule to CLAUDE.md, the test is whether a session working somewhere else needs
it.** If not, it belongs in the guide for the path it governs.

### 1. The test loop was the single biggest thing wrong with this repo to work in

`scripts/smoke.ts` was **220s** of the 237s `npm test` took, and CLAUDE.md called it "fast".
Everything else combined is 12.5s (`tsc` 6.3 · `vite build` 3.8 · `server:check` 2.3 ·
`uiaudit` 0.1 · `contrast` 0.07). The memory note "don't run full npm test" is what that had
already cost.

It turned out to be trivially parallel. `smoke.ts`'s top level is 360 statements, **257 of them
bare blocks** — closed scopes declaring nothing anyone else sees — over a 103-statement
preamble whose only mutable is `failures`, which every block writes and none reads.
`smokeshard.mjs` parses it with the TypeScript parser, copies the preamble verbatim into each
shard, deals the blocks out, and bin-packs them longest-first from a measured cost table keyed
by block CONTENT. **smoke.ts is untouched.**

Proved rather than assumed: serial and sharded produce **the same 1765 check names with the
same outcomes**. The only three textual differences are a UUID and two world hashes that
`Room` seeds from `Date.now() ^ Math.random()` (room.ts:1281) — different on every run either
way.

⚠️ **The guard matters more than the speed.** A shard runner that loses a block still prints
ALL PASS. So: the assignment is asserted to be a partition (set equality, not a count), a shard
that dies without a verdict fails the run, and an **independence guard** refuses to shard at
all if smoke.ts grows a top-level `let` or a stray side effect. `npm run test:serial` is the
way out; `npm run test:calibrate` re-measures.

**~22s is the floor at any width** — one block costs 22.4s alone and a block cannot be split.
4 shards 54.6s · 8 28.6s · 12 23.4s · 16 24.5s.

### 2. The indexes, and the rule that found one the sweep had missed

`records.replay_id` and `matches.replay_id` are `references replays(id) on delete set null`
and **neither was indexed since 0001**, so every replay delete scanned both tables in full —
and the practice/LAN prunes that delete replays run on **every upload**. Same for
`records.partner_id` and `kofi_payments.claimed_by`. The pattern was already understood here:
`practice_replay_idx` (0032) and `lan_replay_idx` (0033) exist for exactly this reason. The two
oldest tables missed out.

Also: `recentMatches` unions all of `matches` and all of `records` and orders by `created_at`
with nothing indexed on it; `challengeParty` filters `room_invites` on an unindexed `room`,
and that gates every rated friend match. Dropped two indexes that can never be chosen
(`user_activity(user_id)` and `friend_requests(from_user_id)`, each already a prefix of a
constraint's index).

**`dbtest` now asserts the RULES, not the columns** — every FK indexed, no index a dead prefix
of another — against the live schema after every migration. That is not decoration: **the FK
rule found a fifth unindexed key on its first run** (`score_reports.match_id`) that the manual
sweep had missed.

### 3. Render, server, docs

`renderer.ts` filtered `world.balls` for held artifacts **inside** the per-robot loop —
O(robots × balls) per frame, ~173,000 predicate calls/s in a 2v2 CR room at 144 Hz. Grouped
once. `drawBalls` rebuilt an `rgb(...)` string per artifact per frame for one of two possible
colours. `GameView` called `matchMedia('(pointer: coarse)')` five times per render at the 10 Hz
poll — and reading a media query during render is **not subscribing to it**, so a 2-in-1 that
changed pointer kept whichever controls it booted with. `useCoarsePointer` fixes both; verified
live in both layouts.

Server: the LAN roster moderated names **one at a time** against a hosted API with a 4s timeout
— up to 16 sequential calls per upload. `/api/stats` is public and ran three unbounded
aggregates per homepage load; memoized 60s, with dbtest asserting it is a memo and not a
freeze.

Docs: HANDOFF.md was **5,888 lines (~97k tokens)** with "read at session start" beside it. The
29 oldest sections moved **unedited** to `docs/handoff-archive.md`; all 37 survive. CLAUDE.md
said smoke was "~1240 checks" (1765), `test:mm` 36 (186), `dbtest` ~61 and elsewhere 36 (232).

## Next steps

1. **Merge to `alpha`**, then promote + deploy from a `main` worktree — 0037 applies at boot.
2. `npm run test:calibrate` after adding or deleting an expensive block.

## Found and NOT fixed — ranked, all verified, none started

1. **The client bundle is 2.54 MB and 1.57 MB of it is base64-inlined WASM** (62%), duplicated
   again in `hostWorker` (1.89 MB). `@dimforge/rapier2d-compat` inlines its wasm, and base64
   costs 33% over the raw binary. The non-compat `@dimforge/rapier2d` loads a separate,
   cacheable `.wasm`. ⚠️ **But Rapier is pinned EXACTLY on purpose** — a different physics
   build changes `step()` with no version bump, making every replay stamp a lie — so this is a
   SIM_VERSION-bump decision, not a dependency swap. And note `main.tsx` awaits `initPhysics()`
   before the first render, so code-splitting alone buys nothing without reordering boot.
2. ~~`persistVersusMatch` is 16 sequential round trips~~ — **FIXED.** Batched to about four.
3. ~~`getStanding` is a write transaction on a read path~~ — **FIXED** with a read-only fast
   path. Note the SURROUNDING item is still open: `chargeStanding` is still ~7 round trips per
   offender and still serialized ACROSS offenders in `persist.ts:220`.
4. **`broadcastSnapshot` stringifies every ball individually just to detect change** (30×/s per
   room, 300 balls in CR), then stringifies the changed ones again into the body. A dirty
   epoch stamped by the sim would remove the first pass. The broadcast itself is already well
   optimized — this is the remaining hot allocation.
5. **`matchStart` and `strategyStart` are encoded per recipient** though they vary only in
   `yourRobotId` — the shared-prefix trick `broadcastSnapshot` already uses.
6. **`MobileControls` re-renders at touch-event rate** (60–120 Hz while a thumb is on a stick,
   on the device class with the least headroom) and has no `memo`/`useCallback` anywhere:
   every render rebuilds the button array and 4 fresh closures per button.
7. **`useCountUp` drives React state at rAF** for ~1s after every match, three concurrently,
   each re-render rebuilding the whole `sections` structure in `Results`.
8. **`GameView.tsx:259` builds a full `HudSnapshot` 4×/s to read two booleans**, and the timer
   is created even in solo where its body can never do anything.
9. **`App.tsx:740` creates a 400ms interval outside an effect** — the only timer in `src/ui/`
   or `src/net/` with no unmount cleanup. Self-limiting at 30s.
10. **`profileEnsured` (repo.ts:288) is never pruned** — bounded only by Fly's scale-to-zero
    restarting the process, which is not a bound on a machine that stays warm.
11. **Correlated per-row subqueries in both moderation queues** (repo.ts:2138, :2421); the
    second aggregates the entire `player_reports` table with no `WHERE` at all.
12. **47 exports with zero importers and zero string references**, incl. `simGameOf`,
    `adminRefundPayment` (a whole HTTP client call), `useAnyoneQueued` (a whole React hook),
    and the `listPresets`/`savePreset`/`deletePreset` trio with no route. `chain/config.ts:633`
    says outright "Nothing reads these at runtime any more".
13. **Large duplication between `chain/` and `biobuzz/`**: `parts.ts` (120 identical lines, doc
    comments included), `mounts.ts` (9 same-named functions), `drawRobot.ts`,
    `RobotPreview.tsx`. Three near-identical start editors; `specKey` defined 4 times with 4
    different field sets.
14. ⚠️ **Four m:ss formatters, and two disagree** — `replayOverlay.ts:67` uses `Math.ceil`,
    `ReplayView.tsx:52` uses `Math.round`. The clock burned into an exported video and the one
    in the viewer header can therefore read a second apart for the same frame. Smallest real
    bug in this list.
15. **`ago()` is byte-identical in three files** (`AdminLive`, `AdminReports`, `StandingCard`)
    while `src/ui/fmtDate.ts` exists and is the obvious owner.
16. **`scripts/zz-accept.ts` is superseded by `zz-accept-clean.ts`** by its own header — the
    original measures against artifacts it thinks it removed. Both say "throwaway".
    `zz-mm-quality.ts:4` references a `zz-mm-marginal.ts` that does not exist.

### The game engine: measured, and deliberately left alone

Profiled per game and then actually tried an optimization, which is how I know not to ship
one. Inside `step()`: Rapier's rebuild-per-tick is ~23% of CPU, `separateParticles` (CR only)
7.6%, the possession/control penalty passes ~4.4%, everything else diffuse.

The 23% is the stateless Rapier world, which is a deliberate architecture choice — rebuilt
every tick so reconcile and determinism hold — so it is not available without the port CLAUDE.md
already has on the roadmap.

`separateParticles` rebuilds its whole spatial grid (a `Map` plus one array per occupied cell)
twice a tick for 300 particles, so pooling the memory looked free. **It was bit-identical and
21% SLOWER** — 0.222 → 0.267 ms/tick for CR, three runs each, low variance, verified
bit-identical by `worldHash` over 3,000 ticks across all three games before the timing was
even taken. V8's nursery beats manual pooling for short-lived small objects. Reverted.

The conclusion to carry forward: **the sim has no cheap safe win left.** Its allocation
pattern is not the bottleneck, and the thing that is, is deliberate.

⚠️ **Snapshot change detection was measured and deliberately NOT changed.** The per-ball
`JSON.stringify` in `broadcastSnapshot` is 45% of a Chain Reaction snapshot's cost (0.093 of
0.208 ms), but that is only ~0.28% of a core per room, and the alternative — a hand-written
field comparator — fails by MISSING a change, which is a silent client desync. The payoff does
not cover that failure mode.

Measured for reference, per-tick `step()` cost (32-thread box, 2v2): DECODE 0.50ms
(cores/room 0.030) · CR 0.28ms (0.017) · BIOBUZZ 0.37ms (0.022). Inside `step`, Rapier's
rebuild-per-tick is ~23% of CPU, `separateParticles` (CR only) 7.6%, the possession/control
penalty passes ~4.4%.

---

# HANDOFF — 2026-09-16 (alpha: the admin panel merged, five PRs merged, main backported)

**(Superseded as READ FIRST by the efficiency-audit session above; still the state of
`alpha` itself, which that branch has not been merged into.)** `alpha` and `main` are both
green and both pushed. **NOTHING IS DEPLOYED.**

`npm test` prints **ALL PASS twice** for the first time in a while — PR #69 fixed the stale
lan-gate asserts that had been failing on a clean tree since LAN went on in production on
2026-09-13, which (because the suites chain with `&&`) meant the BIOBUZZ suite had not been
running at all.

## Merged into alpha

| PR | what |
|---|---|
| #69 | the lan-gate asserts follow the config that moved under them — **this is what unblocked the second suite** |
| #58 | `stageBiobuzz` is idempotent: the hopper is cleared with the ball array, so a re-stage stops refusing its own preloads |
| #61 | a lossy LAN guest's snapshot delta is keyed to its **ACK**, not the last broadcast — **server** |
| #68 | a rematch cannot field a seat nobody is in; the format comes from the room, not a head count — **server** |
| #67 | a backgrounded ranked queue cannot lose the match it was given — client only |

Plus the **admin-panel** batch (its own section below).

Gates on alpha: `npm test` ALL PASS ×2 (BIOBUZZ 1317) · `test:mm` 186 · `dbtest` ALL PASS ·
`build` · `server:check` · `uiaudit` · `contrast`.

## main was CHERRY-PICKED, not promoted

`main` took those six changes only and is still **~28 commits behind alpha** (settle-based
finalize, the standing repricing, room recycle, the LAN tab host, the BIOBUZZ hive work). Same
gates, all green there (BIOBUZZ 1299 — fewer checks because main lacks the alpha-only features
those checks cover).

⚠️ **`src/standing.ts` conflicted and the two branches now price behaviour DIFFERENTLY ON
PURPOSE.** main keeps `afk: 12` / `leave: 15` / `card: 20`; alpha has the repricing (8 / 8,
yellow 5 with `RED_CARD_MULT` for red). Only the new `adjustment` kind was backported. **On the
next promotion this file will conflict again and ALPHA should win** — the repricing is the later
decision.

## Next steps

1. **Deploy the game server** from a **main** worktree (`./scripts/fly-deploy.sh`, never a bare
   `flyctl deploy`). Migrations 0035/0036 apply at boot; until then the admin panel's two new
   endpoints 404 and #61/#68 are inert.
2. Vercel picks up the client half on push (#67, the replay penalties).
3. Still outstanding: clear every infraction on `018fdc59-4e80-4a16-908c-682be86bfee8` —
   after the deploy, one press of CLEAR ALL INFRACTIONS in Admin → Moderation.
4. Neither #61's LAN path nor #68's rematch gate has been exercised against a live server; both
   are covered by driven smoke checks only.

---

# HANDOFF — 2026-09-15 (the admin-panel batch: misscore replays, score editing, replay penalties, standing edits)

**(MERGED into `alpha` and cherry-picked onto `main` on 2026-09-16 — see the section above.
Still NOT deployed.)** It is a SERVER change AND a MIGRATION change — two new migrations
(0035, 0036) that apply at game-server boot, so nothing here works until the Fly server is
redeployed.

Build green: `npm run build`, `npm run server:check`, `npm run contrast`, `npm run uiaudit`,
`npm run dbtest` (ALL PASS, +29 checks). `scripts/smoke.ts` passes +23 new checks.

⚠️ ~~**`npm test` is RED on alpha already, and not from this work.**~~ **FIXED by PR #69**,
merged 2026-09-16. Left below because the reasoning is why it mattered. Two stale checks —
`lan gate: alpha opens it; production does not mention it at all` and `lan gate: and
production still opens neither door` — assert that production's `fly.toml` mentions neither
`LAN_UPLOADS` nor `LAN_SIGNALLING`. Both were deliberately turned ON in production on
2026-09-13 (see that section below), and nobody updated the checks. They fail on `alpha` with
no changes at all. **The consequence is the one CLAUDE.md warns about: while the first suite
is red the BIOBUZZ suite never runs.** Either update the two checks to the fleet as deployed
or revert the config; it is a policy call, not a bug fix, so it was left alone here.

## What landed

1. **The misscore queue's WATCH button 404'd on every claim.** `listScoreReports` returned a
   MATCH id and the button passed it to `/api/replay/<id>`, which serves `replays.id`. It now
   carries `replayId`, joined through `matches.replay_id`; a claim with no stored match says
   "no replay" rather than offering a dead button. `onWatchReplay` is
   `(replayId, matchId?) => void` everywhere (`WatchReplay` in `AdminReports.tsx`).
2. **Score correction** — `GET/POST /api/admin/match`, `correctMatchScore`, migration
   **0035** (`match_score_corrections`). `won` is re-derived; **ratings are deliberately not**
   (Glicko-2 is sequential). The editor is `ScoreEditor` in `src/ui/ReplayRail.tsx`, offered
   only when `ReplayView` gets an `adminMatchId`, which only ever comes from the admin panel
   via in-memory state in `App.tsx` — never from the URL, which is shareable.
3. **Penalties on every replay, for everyone.** `src/sim/penaltyLog.ts` is the ONE place a
   sanction line is written and read (`awardFoul`/`awardCard` and BIOBUZZ's tariff wrapper
   both format through it); `ReplayPlayer.log` stamps each line with its tick and phase clock.
   The viewer has an always-on summary row and a seekable timeline in the rail. A solo record
   run shows one chip and reads its fouls as a deduction.
4. **Standing editing** — `GET/POST /api/admin/standing`, `adminEditStanding`, migration
   **0036** (`voided_at`/`voided_by`/`admin_id`/`note` on `standing_events`). A pardon VOIDS:
   `recentStandingCount` filters voided rows so escalation forgets them, and the row stays on
   the record. `src/standing.ts` gained an `adjustment` kind with a SIGNED cost — render every
   ledger row through `standingDelta`, never a hard-coded minus.

## Next steps

- **Nothing is deployed.** Merge to `alpha`, then promote and deploy the Fly server from a
  **main** worktree (see the 2026-09-13 note). The migrations run at boot.
- **Not yet exercised against a live server**: the two new admin endpoints have unit coverage
  in `dbtest` and typecheck against the server, but no request has been made to a running
  instance. First deploy, then open `/admin` → Moderation → search a player → STANDING.
- The owner asked to clear every infraction on `018fdc59-4e80-4a16-908c-682be86bfee8`. **Not
  done** — production DB and production HTTP reads are blocked in this environment, and the
  admin endpoint that would do it is on this undeployed branch. Once deployed it is one press
  of CLEAR ALL INFRACTIONS on that uuid.

## Gotchas found on the way

- **`ghost` + `primary` on one `.ds-btn` makes the label white on the page's own surface.**
  `.ds-btn.ghost` is declared after `.ds-btn.primary`, so it wins on `background: none` while
  primary's `color: var(--ds-accent-ink)` survives. It reads as a missing control. There is a
  `uiaudit` rule for it now at baseline 0.
- A replay's penalty list is built from `world.events`, so **the foul strings are now parsed,
  not just displayed** — changing one is still a server change, and now also breaks a reader.
  `npm test` round-trips the formatter against the parser.
- The default robot's start anchor faces its own goal: a full-throttle `driveX: 1` holds it
  flush against the goal for the whole match. Crossing the field from anchor 0 is `driveX: -1`.
  Cost several throwaway scenes before it was noticed; worth knowing when writing any headless
  scene that needs the robot to actually go somewhere.

---

# HANDOFF — 2026-09-14, later (account standing: behaviour charges WIRED, repriced — alpha only)

**(superseded as READ FIRST by the 2026-09-15 section above; still current for its own subject.)** On `alpha`, NOT deployed, NOT on `main`. It is a SERVER change: it does nothing
until the Fly game server is redeployed (from a main worktree — see below).

- **`persistBehaviour` was never wired into production rooms** (`server/index.ts` passed 7 of
  `Room`'s 8 args; `docs/multiplayer-architecture.md` §17.1 had flagged it). So in production
  the clean-match heal (+2), AFK, leave and card standing charges had NEVER fired — only dodges
  did. Now wired. ⚠️ Deploying it turns ALL of those on at once, for the first time against real
  matches.
- **Repriced (owner):** AFK 8 (was 12), leave 8 (was 15), yellow card 5 (was 20), red card 15
  (was a flat 40 override). A red is now `severity: RED_CARD_MULT` (3) through the ladder, so it
  rides the repeat multiplier like every other kind (a 2nd red in the week costs 23, a 2nd
  yellow 8). Cooldown/rating ladders unchanged.
- **Leaving a 1v1 is not charged** (`chargedForParticipation`, `src/standing.ts`); leaving a 2v2
  is. AFK is charged in both. An excused 1v1 leaver is NOT credited clean either. The 1v1 match
  is still rated, so the leaver still takes the loss.
- Verified: `server:check` and client `tsc` clean; the changed standing checks run green through
  the real functions in a scratch script. Full `npm test` NOT run (owner preference); the smoke
  checks in `scripts/smoke.ts` were updated to the new values.

---

# HANDOFF — 2026-09-14, early (settle-based finalize LIVE, PR 65 landed, all night fixes shipped)

**What production is running.** Fly release **v111** = `main` @ `b09f12e`, deployed
from a main WORKTREE (never this alpha tree — `fly-deploy.sh` builds whatever tree it runs in).
Everything below the line is on BOTH `main` and `alpha`.

- **LIVE: a match is finalized when the field comes to rest, and the score is shown only then**
  (`34bf3a2` main / `6326a6b` alpha). New `src/sim/settle.ts`: `settleStep` finalizes once the
  game's `GameSimModule.settled` has held for `MATCH_SETTLE_HOLD_S` 0.5 s, capped at
  `MATCH_SETTLE_MAX_S` **10 s — the owner's absolute maximum, do not raise it**. DECODE
  (`decodeSettled`): nothing in flight, nothing pending or moving on a rail, ground/basin
  artifacts and robots at rest. CR (`chainSettled`): no non-staged particle in flight, ground
  particles and robots at rest. BIOBUZZ (`bbSettled`, `src/games/biobuzz/settle.ts`): nothing in
  flight, no hive swinging or loaded past its tip, ground elements and robots at rest. The server
  (`room.ts` `stepOnce`) and solo practice (`game.ts`) share the clock, in ticks.
  `MATCH_SETTLE_S` / `MATCH_RESULT_REVEAL_MS` are DELETED. Client: the results screen reveals only
  on `HudSnapshot.resultFinal` (online = the server's `matchResult` arrived; practice = its own
  settle) and shows the SERVER's totals; the live HUD, replay viewer and burned-in video say
  MATCH OVER until then and FINAL only on the finalized score; `resultLost` says so if the result
  never comes. `maxMatchTicks` carries the 10 s cap. Measured: an idle DECODE or CR run finalizes
  on the 0.5 s hold (no jitter); a rolling artifact held it to 116 ticks.
  ⚠️ **Known to bind:** a BIOBUZZ tip that sets off a SECOND tip can outlast 10 s; PR 65's rule
  (below) still pays a swing the cap cuts off.
- **LIVE: PR 65, a BIOBUZZ tip caught by the buzzer scores and its load is not deducted**
  (`7d0331c` main / `04ce456` alpha; its check moved onto the settle clock in `b09f12e` /
  `41865e7`). Landed as CLEAN commits and the PR CLOSED, not merged: its own commits were
  authored `Claude <noreply@anthropic.com>` with `Co-Authored-By`/`Claude-Session` trailers, and
  the owner wants no attribution anywhere. No `BALANCE_VERSION` bump (owner's call).
- **LIVE (since v110): a cancelled ranked match cannot be cancelled again** — no longer held; see
  the section below. **LIVE: a solo record run left after the buzzer is still saved** (the room
  keeps stepping with nobody connected until it finalizes).
- ⚠️ **A gated shell chain lied once tonight:** `grep -c` exits 1 on a count of 0, so
  `X=$(… | grep -c …) && cd worktree && …` stopped before the `cd` and the "main" tests ran on
  alpha. The push gate caught it. Use `|| true` on counts and guard every `cd`.
- `npm test`'s shared suite still ends at the 2 pre-existing `lan gate` failures. Alpha still
  carries unreviewed BIOBUZZ commits that are not on main (see the review note below).

# HANDOFF — 2026-09-13, night (production hotfixes: record-room reap LIVE, dodge double-cancel shipped in v110)

Superseded by the section above. Deploys go from a MAIN worktree, never this alpha tree; killing
a background deploy does NOT kill its `flyctl` child, so run deploys in the foreground. (v108,
built from alpha by mistake, was live for about 5 minutes around 01:19Z and was replaced.)

- **LIVE: a solo record run closed on purpose frees its room at once** (`f0e0430` main /
  `df5872d` alpha, `server/room.ts` `detach(id, conn, clean)`, `server/index.ts` close code).
  Record-run restarts used to hold the old `rec-` room for the 45 s reconnect grace, still
  simulating. At the BIOBUZZ launch spike iad sat at 24/24 with 8-12 real runs and refused new
  ones as `region_full`, which the Record Run screen shows as "Couldn’t start". A close with
  code 1000/1005 on a solo record room now reaps immediately. 1006 (network) and 1001 (tab)
  keep the grace, and so does every room with a second driver.
- **SHIPPED in v110 (was held earlier that night): a cancelled ranked match can no longer be
  cancelled a second time** (`28575be` on alpha, `406f506` on main).
  `cancelPending` left `pendingMatch`/`phase` set, and a socket's `room` is never cleared. So
  the first player to leave the cancelled screen re-ran the cancel from `detach` and was billed
  a STRATEGY BAIL. The innocent driver was shown "Nothing was charged to you" and then lost
  standing anyway; the player who never readied was billed twice. Smoke reproduces it: 3
  charges without the fix, 1 with it. **Standing already lost this way is not refunded:** the
  false rows are `standing_events` kind `dodge` whose `room_code` also carries a legitimate
  charge to the other player.
- `npm test`'s shared suite still ends at the 2 pre-existing `lan gate` failures (below).
- Unreviewed alpha content not on main (review summary): BIOBUZZ hive tip rate / spill / miss
  bounce and LEAVE-from-start-wall change scoring and RNG draw counts with no `SIM_VERSION`
  bump; `startWalls` is read without a guard, so an alpha client against a main server throws in
  online BIOBUZZ. Deploy the server before clients, or guard it, before promoting.

# HANDOFF — 2026-09-13, later (BIOBUZZ hive feel: tip rate, spill scatter, miss bounce, canopy)

Branch **`claude/hive-physics-rendering-tjz7mj`**. Four owner-reported HIVE items, all inside
`src/games/biobuzz/` (nothing shared touched). Gates: `npx tsc --noEmit -p .` clean,
`server:check` clean, `test:bb` **1289 ALL PASS**, `npm run build` ok. Full `npm test` run to the
end: the shared suite reports **2 FAILURES, both PRE-EXISTING and not this branch's** — `lan gate:
alpha opens it; production does not mention it at all` and `lan gate: and production still opens
neither door`. They assert `fly.toml` carries no `LAN_UPLOADS` / `LAN_SIGNALLING`, and the
2026-09-13 promotion (below) deliberately put both in `fly.toml [env]` to turn LAN on for
production. The check is stale against that owner decision; the files it reads are untouched by
this commit. Whoever owns the LAN policy should either retire those two checks or drop the flags.

**MERGED INTO `alpha`** (`f3f74dc`), no conflicts: alpha's own `state.ts` change adds `startWalls`
to `BiobuzzState` while this one adds `swingRate` to `BbHiveState`, and alpha's HUD change only
moves the `tipping > 0` readout from a chip to the score bar's `cellLine`, which this preserves.
Gates on the MERGED tree: `tsc` / `server:check` / `build` / `uiaudit` clean, `test:bb` **1294 ALL
PASS**.

⚠️ **A SEPARATE ALPHA BUG WAS FIXED TO GET A GATE AT ALL** (`scripts/smoke.ts`, own commit). Alpha's
LAN commit `d14895b` added a check reading `roomSrc` ~126 lines ABOVE the `const roomSrc` in the same
block, so it threw `ReferenceError: Cannot access 'roomSrc' before initialization` and **aborted the
whole shared suite** — which, being `&&`-chained, also meant the BIOBUZZ suite never ran under
`npm test` at all. The read is hoisted to its first use. The two checks involved now run and pass,
and the shared suite completes at its 2 pre-existing LAN gate failures. Nothing else moved.

- **A heavier tray tips faster** (`hive.ts` `hiveSwingRate`, `hiveSurplus`). The 4 s swing is
  the swing of a tray at EXACTLY its tip-table threshold; each element over the threshold adds
  `BB_TIP_RATE_PER_EXTRA` 0.35 to the rate, capped at `BB_TIP_RATE_MAX` 3. The surplus is
  measured against `BB_TIP_POLLEN`, so every row's threshold load still takes 4.0 s and every
  existing timing check is untouched. Pre-release the rate reads the live contents (the cell
  keeps taking, so feeding a swinging tray speeds it up — measured: 2 pollen dropped in at
  0.5 s settle it at 2.57 s instead of 4.0); post-release the rate is carried in the NEW
  optional `BbHiveState.swingRate` (absent when settled and on old snapshots = nominal).
  `tipping` stays in nominal seconds, so `tipProjection` / `tipProgress` are unchanged.
- **Spill scatter** (`hive.ts`): `BB_SPILL_SPEED` [35,62] → **[30,62]**, `BB_SPILL_FAN` 18° →
  **40°**, plus a new all-directions **`BB_SPILL_KICK`** 12 in/s. Every pose still leaves
  outboard by construction (23 in/s outboard minimum vs a 12 kick). `spillPoses` now draws SIX
  rng values per pose. `docs/biobuzz/feedback/001-spill-kinematics.md` has the addendum.
- **A miss bounces off the structure** (`hive.ts` `hiveDeflect`, called from `play.ts` after
  the capture loop for BOTH hives). The assembly is an APPROX box (`BB_HIVE_W` × `BB_HIVE_LEN`,
  `BB_HIVE_BOTTOM_Z`..`BB_HIVE_OPEN_Z[1]`) with: the two long sides, the DOWN cell's outer end
  and the underside solid; an interior PIVOT PLANE (y = 0) solid; **no top** (a descent from
  above is the capture test's business, and a top is a shelf a ball could rest on); and the
  **TAKING cell's outer end OPEN at every height** (`hiveTakingSide`, so it follows the
  release). ⚠️ That mouth exemption is load-bearing: with the face solid, the dumper parked at
  the lip and Aim Assist's flat lobs (which cross the lip a hair before apex, still climbing)
  were ALL refused — 8 checks red. Bounce is `BB_HIVE_MISS_REST` 0.3 on the normal,
  `BB_HIVE_MISS_TANGENT` 0.5 on the rest, vz kept on a side hit. Measured: a 150 in/s shot into
  the red hive's flank lands 18.8 in short of the face on the side it came from; the same shot
  at 70 in clears the top and lands downrange.
- **Translucent canopy** (`drawField.ts` `drawHiveCanopy`, called from `draw.ts` between the
  low and high element passes). The renderer draws field → robots → elements, so a robot under
  the hive was painted OVER it. The canopy repaints the body, the up cell's fill and its
  contents row at `CANOPY_A` 0.42 over the assembly's own footprint, after the robots and the
  ground/low-flight elements and before the airborne ones (split at `BB_HIVE_BOTTOM_Z`). The
  contents row is now `drawCellContents`, shared by the field pass and the canopy. Not a
  `globalAlpha` on the sprite — the ruling is the PORTION under the hive, not the robot.
- No `SIM_VERSION` bump was made (owner's standing call on this branch); spill RNG draw count
  and the miss bounce both change sim output for the same inputs.

---

# HANDOFF — 2026-09-13, late (DEPLOYED: alpha is production, BIOBUZZ is public)

- **`main` is `088addb`** (alpha fast-forwarded onto it and pushed; this handoff note is on alpha
  only, so a docs commit does not rebuild the site). Vercel production serves it
  (`https://www.playdsim.com/version.json` → `088addb`, `/biobuzz` in the sitemap).
- **BIOBUZZ is public**: `src/seasons.ts` has no `channels` for it. The crawler files were edited to
  match (`public/sitemap.xml`, `public/robots.txt`, the static nav and the four home-description
  copies in `index.html`), as the BIOBUZZ suite requires. `test:bb` 1272 PASS, `npm run build` ok.
- **Production game server deployed** with `./scripts/fly-deploy.sh` (the owner said to skip the
  in-game warning; the countdown was cancelled before it deployed anything). Verified after:
  every machine on one image; iad `performance-2x`/4096; ord, sjc, lhr `performance-1x`/2048;
  gru, jnb, syd, nrt `shared-cpu-4x`/1024 (stopped until someone connects); `/health` ok;
  `/api/perf` `admitting:true` on every started machine; `/api/presence` caps `party,lan`;
  `/api/seasons`: DECODE Act 2 · S1 (bv 7), Chain Reaction Act 2 · S1 (bv 5), BIOBUZZ Act 1 · S1 (bv 4).
- **Alpha preview deployed** too (`--alpha`), healthy, caps `party,lan`.
- **Announcements published** from `docs/announcements/biobuzz-act1-season1.md`: a `season` reveal
  and the `patch` notes.
- The room-leak fix (`8e2ea2b`) is now live in production, so `iad` should no longer need restarts.
- `ADMIN_SECRET` lives in `D:\Projects\2ddecodesim\.env`; load it into one command, never print it.

---

# HANDOFF — 2026-09-13 (preparing the alpha → production promotion)

Branch **alpha**, pushed. `npm run server:check` clean; the new room-leak smoke check was run in
isolation and mutation-checked (fails without the fix). The full `npm test` was NOT run (owner).
**Nothing deployed to production — the owner said not to until the promotion is ready.**

## (was READ FIRST) — production `iad` was refusing every new room

`/api/perf` on the always-warm primary read `rooms: 0, admitting: false`, and its log was a wall
of `[admit] refused room rec-…: at cap (24/24)` from at least 04:53 UTC. US-East players could not
start a record run or a custom room at all.

**Cause:** `finalizeMatch` stops the room's loop and keeps the room for the results screen, but
the reconnect grace is only ever checked BY that loop. A driver who closed the tab from the
results screen was held forever and the room never deleted — one leaked room per finished match
someone walked away from. Satellites auto-stop and start clean; `iad` never does, so only it
filled up.

- **Mitigated:** `iad` (6836e6dc0e2348) restarted 2026-09-13 with the owner's go; it read
  `admitting: true` 43 s later.
- **Fixed on alpha only:** `8e2ea2b` (`Room.armGraceReap`). The owner chose to ship it WITH the
  promotion, so **production will leak again until then.** If `/api/perf` on `iad` shows
  `admitting: false` with few live `rooms`, restart that machine (ask first). The scheduled
  checkup below flags exactly this as URGENT.

## Update, later the same day: PRs merged, main merged, LAN on, launch fleet sized

All on alpha, **still not deployed**.

- **main merged into alpha** (`a335bb0`). One conflict, the HUD chip block in `GameView.tsx`,
  kept as alpha had it. `fly-deploy.sh`, `fly.toml` and `.env.example` now carry main's fleet.
- **PRs #45, #60 and #57 merged** (`a4dd082`, `7d301f5`, `3b1d3c9`). #57's three conflicts kept
  both sides. Its replay start-pose snap was gated on `startLegality`, which BIOBUZZ sets too, so
  it became a per-game hook, **`GameSimModule.startSnap`**: DECODE fills it with the same G304
  snap; BIOBUZZ and Chain Reaction keep their field-clamped pose. **No `SIM_VERSION` bump**
  (owner): some pre-deploy replays may play back differently from what happened.
- **LAN is ON for production**: `LAN_UPLOADS` and `LAN_SIGNALLING` in `fly.toml [env]`. The client
  lights LAN from the server's `lan` capability, so Vercel needs nothing. Migration
  **`0034_lan_runs_biobuzz.sql`** widens `lan_runs.game` to accept BIOBUZZ, which 0033 refused.
- **Launch fleet, from `docs/capacity.md`** (one machine per region is a hard rule, and one
  process uses about one core, so a dedicated core is the only size step that adds rooms):

  | region | size | why | $/mo if never stopped |
  |---|---|---|---|
  | iad (primary, matchmaker, API) | `performance-2x` / 4096 | dedicated core for the loop; 2nd core for GC and every socket's deflate | 64.39 |
  | ord, sjc, lhr | `performance-1x` / 2048 | real traffic; ~8–10 driven rooms, never throttled | 32.19 each |
  | gru, jnb, syd, nrt | `shared-cpu-4x` / 1024 | rarely host; 4x's baseline held 2 rooms / 8 players | 8.08 each |

  Satellites auto-stop and bill only rootfs while stopped, so their real cost is only while
  someone plays. Worst case, all eight never stopping: **~$193/mo** (today's worst case ~$31).
  Rough ceiling with margin: ~60 driven rooms fleet-wide, roughly 90 concurrent players at the
  real solo/1v1/2v2 mix, ~130 at redline. Past that, the fix is `SIM_WORKERS`
  (`docs/scaling-multicore.md`), not bigger VMs or a second machine per region.
  `fly.toml [[vm]]` is the primary's size; `scripts/fly-deploy.sh` `SATELLITE_SIZES` puts each
  satellite on its own after the deploy. Checked with `bash -n` and a dry run of the lookup.
- ⚠️ **gru and jnb still do not host CROSS-region matches** (`DEPLOY_REGIONS` unchanged). Adding
  them failed 8 `test:mm` checks: their real distances to syd/nrt and to each other (315–395 ms)
  are above `RTT_UNKNOWN` (300), so a real far pair looked like a missing row. They do host every
  room their own players open.
- Gates run for this: `npx tsc --noEmit -p .` clean, `server:check` clean, `test:bb` 1270 PASS,
  `test:mm` 186 PASS, `uiaudit` at baseline, `dbtest` ALL PASS (0034 applied). Full `npm test` NOT run (owner).

## Promotion checklist

1. **BIOBUZZ is still hidden on stable.** `src/seasons.ts` has `channels: ['alpha']` and the blurb
   "Rules land at kickoff on 2026-09-12." Both must change for it to appear in production. The
   CLAUDE.md BIOBUZZ section still describes a placeholder, alpha-only, unscored shell — stale.
2. **Open PRs to alpha** (reviewed 2026-09-13, nothing merged):
   | PR | verdict | why |
   |---|---|---|
   | #45 | **URGENT** | any socket can send a malformed `input` (NaN, `ld: 1e9`) into the authoritative world broadcast to the room. Server-only, merges clean, `test:mm` 186 pass on a trial merge |
   | #57 | recommended | real client/sim fixes (auto-path waits, replay `coerceSetup`); CONFLICTS in 3 files (trivial). Changes sim output for two narrow inputs without a `SIM_VERSION` bump — decide. Its `coerceSetup` gate keys on `startLegality`, which BIOBUZZ now sets, so BIOBUZZ replays still get DECODE's snap |
   | #60 | recommended | solo practice saves its score before the 2.8 s settle; practice-only, clean |
   | #58 | defer | `stageBiobuzz` idempotency; no shipped path calls it twice |
   | #61 | defer | LAN guest ack-keyed deltas; LAN is off in production; the shared WebSocket path measured byte-identical |
3. **Merge `origin/main` into alpha before promoting.** main has 10 commits alpha lacks (the
   ord/gru/jnb fleet, satellites at 512 MB, `fly-deploy.sh` re-shrinking all 7 satellites, fly.toml
   notes, the 8-region `.env.example`, a replay fix, controls copy). ⚠️ Deploying production from
   alpha's current `scripts/fly-deploy.sh` would re-shrink only 4 satellites, leaving ord/gru/jnb on
   fly.toml's `shared-cpu-4x`, and put the rest back on 1024 MB. A trial merge has ONE conflict:
   the HUD chip block in `src/ui/GameView.tsx` (both sides removed the pose readout) — take alpha's.
4. **Seasons.** Production: DECODE Act 2 · Season 1 (bv 7), Chain Reaction Act 2 · Season 1 (bv 5).
   `BALANCE_VERSION` is 4 on both branches and `currentSeasonNumber` returns each game's existing
   max, so **the deploy does not advance DECODE or Chain Reaction.** BIOBUZZ has no production rows
   (today's prod server coerces `biobuzz` to DECODE, so `/api/seasons?game=biobuzz` shows DECODE's
   list); the new server seeds `(biobuzz, 4, act 1)` on first use — alpha's database already holds
   exactly that. **Do not use the admin season/act roll for this launch.**
5. **Migrations:** none differ between main and alpha. `lan_runs` has `check (game in ('decode',
   'chain'))`, harmless while LAN is off in production, but it refuses a BIOBUZZ LAN upload on alpha.
6. **Announcements:** `docs/announcements/biobuzz-act1-season1.md` (a `season` reveal + `patch`
   notes), with a pre-publish checklist. Publish only after the deploy is verified.
7. **Order:** merge #45 (and any other chosen PRs) → merge main into alpha → full gates (`npm test`,
   `test:mm`, `dbtest`, `build`, `server:check`, `uiaudit`) → alpha into main →
   `scripts/announce-deploy.sh` (players are online) → verify `/health`, `fly machine list` sizes,
   `/api/perf` `admitting` on every started machine, `/api/seasons` per game → Vercel production →
   publish the announcements.

## Capacity — recommendation, NOT applied

Load today is tiny: 3 online; `iad` 0.02–0.04 cores; alpha ran 2 rooms / 8 players at 0.17 cores.
`npm run costprobe` (sim-only, laptop): a BIOBUZZ solo room costs 0.0245 cores (same as DECODE), a
2v2 0.0345; 10.2 / 38.4 KiB/s per client on the wire. Size on `docs/capacity.md`'s driven 0.075.

- **`iad`: `shared-cpu-4x`/1024 ($8.08/mo) → `performance-1x`/2048 ($32.19/mo).** The only size step
  that adds rooms: a dedicated core never throttles (~8–10 driven rooms against 5–8), and two rooms
  with 8 players already sat on the 4x sustained baseline (0.244 of ~0.25 cores, 2026-09-06).
  `shared-cpu-8x` buys nothing — one process uses one core.
- **`ord` and `sjc`: `shared-cpu-1x`/512 → `shared-cpu-4x`/1024 for the launch.** A 1x baseline is
  about one busy room. They auto-stop, so the extra ~$4.76/mo each is only paid while awake.
  Needs per-region sizes in `scripts/fly-deploy.sh` (today one `SATELLITE_SIZE` for all seven).
- Everything else stays `shared-cpu-1x`/512. Never a second machine in a region (room codes route
  by region); past `performance-2x` the fix is `SIM_WORKERS` (`docs/scaling-multicore.md`).

**Scheduled checkup:** the Claude desktop task `dsim-capacity-checkup` runs every 3 hours while the
app is open. It is read-only (machine list, `/api/perf` per started machine via
`fly-force-instance-id`, presence, log signals), recommends only, and keeps a history in
`C:\Users\geniu\.claude\scheduled-tasks\dsim-capacity-checkup\history.jsonl` so a downscale is only
ever suggested after 7 days of low readings.

---


---

# Older sessions

Sessions before 2026-09-12g are in **`docs/handoff-archive.md`** — moved there on
2026-09-16, unedited. This file had reached 5,888 lines and is read at the start of every
session; the archive keeps the history without charging every session for it.
