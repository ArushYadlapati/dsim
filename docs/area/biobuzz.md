<!-- governs: src/games/biobuzz/**, scripts/smoke-biobuzz/** -->
# GAME: BIOBUZZ

> **Status 2026-09-17:** the placeholder wording below predates kickoff; the 2D game is a full scored
> match, and the 3D physics + renderer are described in the last section, "BIOBUZZ 3D".


Read `docs/biobuzz-contract.md` FIRST — it is the lane contract. ⚠️ BIOBUZZ owns no ground-pollen physics: that is the shared solver, so a pollen that looks wrong is a question about `src/sim/`, not a fix to make here.

*Split out of `CLAUDE.md` on 2026-09-16, **verbatim** — CLAUDE.md is loaded into every
session and this is not needed by most of them. The `governs:` line above is read by
`scripts/docaudit.mjs` and by the editor hook, so keep it accurate when paths move.*

---

# GAME: BIOBUZZ (`biobuzz`)

The FTC 2026–27 season. **Rules land at kickoff on 2026-09-12**, so what is in the repo
today is a PLACEHOLDER: an empty 12 ft square with four walls and drivable robots,
`scored: false`, `startLegality: false`, two start anchors. `src/games/biobuzz/{sim,index,
state}.ts` say so at the top and the P0-shell chat replaces all three.

**It is PUBLIC on every channel, since 2026-09-13** (the promotion to production). Its
entry in `SEASONS` (`src/seasons.ts`) carries NO `channels` key, so `seasonVisible` returns
true everywhere: it is in the home picker and the queue counts, visible to the SEO surfaces,
and `/biobuzz/...` resolves on a stable build. It ships to `main` and it deploys to the
stable site like any other season.

This paragraph used to say the opposite — alpha-only, `channels: ['alpha']`, "nothing about
it may be pushed to a public branch" — which was true while the game was built before
kickoff and has been false since the promotion. The `channels` SWITCH is still there and
still works; it is simply not set for this season, and it is what a future unannounced
season would use. What remains alpha-only is the DEV ROUTES (the scene gallery,
`GameModule.devRoutes`), gated by `devRoutesEnabled()` in `App.tsx`'s `devRouteFor` — a
different gate on a different thing.

**Read `docs/biobuzz-contract.md` FIRST** — it is the lane contract: who owns which file
(Lane A the field, Lane B the robot, the integration chat everything outside
`src/games/biobuzz/`), the `elements.ts` interface between them, and the workflow.
`docs/biobuzz-plan.md` is the why; `docs/biobuzz-reference.md` will be the manual
distilled, written on kickoff day.

Everything BIOBUZZ lives in `src/games/biobuzz/`. Nothing BIOBUZZ goes into `src/sim/` or
`src/config.ts` — the same rule Chain Reaction follows. Game state is plain JSON on
`world.biobuzz`, and the sim half obeys the shared determinism rule (no DOM, no clock, no
`Math.random`, no `Date`).

⚠️ **Do not invent geometry before the manual.** CR flags values approximated from
description as `APPROX` and that convention carries over; an unflagged guess is worse than
an empty field.

⚠️ **POLLEN PHYSICS IS THE SHARED ARTIFACT SOLVER WITH `BB_POLLEN_RADIUS`; NOTHING IN
THIS DIRECTORY INTEGRATES OR SEPARATES BALLS.** (The constant is spelled `BB_POLLEN_R`.)
A ground pollen's position is written by `solveArtifacts` and by nothing else — the same ONE
POSITION AUTHORITY rule DECODE's artifacts were rebuilt to. `solveArtifacts` and `robotSolids`
take a trailing optional artifact RADIUS defaulting to `C.BALL_RADIUS`, so BIOBUZZ passes 1.5"
(a 3" pollen) where DECODE passes its default 2.5" and every DECODE call site stays
byte-identical. The SHAPES a pollen meets are this game's own — `bbRobotSolids` (`robot.ts`),
wired through the `GameSimModule.artifactSolids` slot — because the shared `robotSolids` builds
DECODE's front funnel and a BIOBUZZ sweeper is a roller bar on whichever edge `intakeMount`
names. That is GEOMETRY, which Lane B owns; it is not a physics constant, and none is added.
`play.ts` therefore has no ground integrator, no separation pass and no
eviction pass; it calls the shared solve, the shared rolling-friction pass (`stepGroundBall`,
which is the only thing that brings a pollen to rest — the solve has no gravity and no floor),
and a containment clamp, and `interact()` only CAPTURES. BIOBUZZ owns NO ground-pollen physics
constant: `BB_POLLEN_WALL_REST` is FLIGHT-only and `BB_POLLEN_R` is a size, not a dial. So a
pollen behaviour that looks wrong is a question about SHARED physics — write it into
`docs/biobuzz/feedback/` naming the gallery cell, do not fix it here.
`docs/biobuzz/feedback/000-solver-observations.md` is the standing list (no pin/round loop in
BIOBUZZ, a persistent 2.1" overlap under a pressing chassis, a struck pollen reaching
`C.BALL_MAX_SPEED` while the robot that hit it is slower, 5"-artifact rolling constants).

---


# BIOBUZZ 3D (`sim3d/`, `scene/`, `graphics/`, `public/models/biobuzz/`) — Day 1 landed 2026-09-17

Spec: `docs/biobuzz/plan-3d.md` (owner decisions in §12). **One game, two physics.**
`World.biobuzz.physics` is `'2d' | '3d'` (absent reads `'2d'`; read it ONLY through
`biobuzzPhysics(world)`); `biobuzzStep` dispatches to `step2d` (the untouched pipeline above) or
`step3d`. The 2D pipeline is PERMANENT (owner rule): every existing check must stay
byte-identical.

⚠️ **EVERY SERVER-CONNECTED MATCH IS 3D — nobody picks** (owner ruling, 2026-09-18). Record runs,
ranked, matchmade, custom code rooms, spectators and LAN all run `'3d'` for a game whose
`physicsOptions` include it. `Room.physics` is that one line (`serverPhysics`,
`src/games/types.ts`); `RoomConfig.physics` still exists on the wire but no current server reads
it, and the custom lobby's 3D/2D picker is gone. The reason is the RECORD BOARD: two solves
feeding one board is two boards, so `recordLeaderboard`, `personalBest`, `recordRank` and the
career panel all filter to `'3d'` server-side (`boardPhysics`, `server/db/repo.ts`) and
`submitRecord` refuses a 2D container outright. Pre-ruling 2D rows are kept, not deleted — they
simply stop appearing on a board; no season was reset. An old client without the `'bb3d'` cap is
now REFUSED (`BB3D_REFUSAL`) rather than downgraded to a silent 2D room.

**2D survives exactly where nothing reaches a board:** solo practice and free drive, via
`GameSettings.practicePhysics` (default `'3d'`; Practice setup has the control). A record run
whose 3D chunk fails to load REFUSES (`RecordRun.tsx` preflights it); only a practice falls back
(`GameView`). Practice-run history (`practice_runs`) keeps its own `physics` tag and is listed
newest-first — it is never ranked, which is what keeps the two eras from meeting there.

- ⚠️ **The "BIOBUZZ owns no ground-pollen physics" rule above is the 2D pipeline's.** `sim3d/`
  OWNS its own solve: one persistent Rapier 3D world per `World` object (`WeakMap` in
  `engine.ts`, rebuilt when `tick` goes backwards or the robot set changes), bodies created in id
  order, JSON→body SYNC before each step (a body is teleported only when its JSON differs from
  what the last readback wrote — no thresholds), READBACK rounded to 1e-4 after. Robots are
  cuboids `length × width × heightIn` (yaw-only, z free; `RobotState.z` = chassis BOTTOM height,
  0 while driving); elements are spheres with CCD when fast; `held`/`stock` have no body; an
  `element` in a flower FALLS and seats where the real bores let it (`flowerTube.ts`, Day 2) —
  it is not parked at a computed height and it is not a fixed body. The hive tray is a JOINTED
  DYNAMIC body — a real see-saw on a revolute joint, held at each stop by a DETENT
  (`applyHiveTilt` / `hiveDetentHold`) rather than driven to an angle; `hiveTiltAngle`
  (`sim3d/tilt.ts`) reads `hive.angle` back off the body. `BB3_HIVE_DYNAMIC` is **`true`**
  (`config.ts`) — the Day 1 line here said `false` "until Day 2 calibrates the see-saw", and the
  KINEMATIC path it described survives as the fallback that constant switches to, which is also
  the shape the PREDICTORS build (`buildKinematicTray`). The shared timer (`hiveTimerStep`, split
  out of `hiveStep` with no 2D change) still runs the 2D pipeline. The spill is PHYSICAL.
  `derive.ts` fills `hives[a].contents` / `flowers[i].stack` and the `element` tags from body
  positions every tick, so `score.ts`, `hud.ts` and the 2D renderers run unchanged.
- ⚠️ **THE HIVE TIPS ON `BB_TIP_POLLEN`, NOT ON THE CONTENTS' WEIGHT** (owner report 2026-09-19:
  "it says 0 more to tip and it does not tip"). The detent used to be a breakaway the load had to
  out-torque, and no calibration can make that agree with a COUNT: measured at the shipped hold,
  8 POLLEN weigh 4560 crammed against the back wall and 8051 in a two-wide line, 7 POLLEN weigh
  4146 to 6769 — the ranges OVERLAP, so no detent value separates the rows, and field guide §12.3
  was being violated in both directions at once. The published table is the rule, `hud.ts` and
  `HudSlots.tsx` promise it to the driver in as many words, so `hiveDetentHold` is a PIN THE
  TABLE LIFTS. Everything after the release is still the free see-saw. `hiveContentsTorque` /
  `hiveRestoringTorque` remain exported: they are how the HIVE3D lane and `hive-calibrate.ts`
  MEASURE the tray, not what triggers it.
- ⚠️ **A CELL COUNTS WHAT IS IN IT, NOT WHAT HAS STOPPED MOVING** (owner report 2026-09-19: "a lot
  of delay registering when the balls land in the hive... a significant amount of lengthened
  tipping time due to the registration time"). `derive.ts` needed `BB3_REST_TICKS` of stillness
  before an element joined `hives[a].contents`, which measured **mean 95 ticks (1.59 s), p90 205,
  max 264** from the tick its centre entered the cell, with 8 of 75 landings never registering at
  all — and `contents` is what the tip trigger, the HUD's "N MORE TO TIP" and §10.5 C all read, so
  the TIP inherited every millisecond of it. Membership is GEOMETRY now: inside the interior AND
  `BB3_CELL_SEAT_DEPTH` below the cell's open rim, which is **mean 0.2 ticks** after entry. The
  depth is what the rest gate was really buying — of 209 arrivals that got a centre inside the
  interior, 92 left again and every one stayed within 2.75 in of the rim (they SKIM the open top;
  nothing crosses the mouth and comes back), against 4.33 in for the shallowest a landed element
  ever rests. Once counted, an element is held by a LATCH read off `b.state` — plain world JSON the
  wire already round-trips, so a peer that rebuilds its engine mid-match agrees — for as long as it
  is anywhere inside the interior; that hysteresis is in `derive.ts` and NOT at the score, because
  `contents` being one list with one reader-set is the whole of why the HUD's promise and the tray
  cannot come apart.
- ⚠️ **AND IT COUNTS ONE CELL — THE ONE `hiveTakingSide` NAMES** (owner report 2026-09-20: "the hive
  tips with nothing inside sometimes... could be when balls are shot towards the hive that is
  actively moving upwards"). `derive.ts` TAGS an element in either cell `hive:<alliance>` — it is in
  the structure, not loose on the tiles, and the AI and the capture read that — but it used to put
  BOTH cells into `hives[a].contents`, which is not a tag list: it is the UP CELL'S LOAD, and the tip
  pin, the HUD's "N MORE TO TIP" and Table 10-2's "remaining in an UPWARD-FACING CELL" all read it as
  one. The down cell's outer face is open at every height, so a MISS dropping past the structure is
  inside that interior for a handful of ticks — and was one more element toward the up cell's tip.
  Measured: 7 POLLEN in the up cell (one short of the table) plus ONE element in the down cell lifts
  the pin, and the freed see-saw then goes over on the seven at tick 330, where seven alone never
  moves; over 28 randomized volleys, 3 counted ids sat outside the up cell across 6 tips and 2 of
  those tips began under-seated. The HIVE3D lane's "DOWN cell" block is the repro. `hiveTakingSide`
  rather than `up` because it is already the game's one answer to which cell is taking, so a driver
  filling the rising tray through the second half of a swing is counted as he fires.
- ⚠️ **`BB3_HIVE_DYNAMIC = false` IS NOT THE ONE-WORD REVERT IT IS DOCUMENTED AS.** `bb.spill` —
  G409's entire tag — is written only inside `hiveDynamicTick`; the kinematic path never writes
  it, and all four G409 checks sit inside `if (BB3_HIVE_DYNAMIC)` blocks, so flipping the word
  kills G409 in 3D **and leaves the lane green**. Restoring the kinematic tray means porting the
  spill tagging and un-gating those checks first.
- ⚠️ **A LINE §10.5 ASSESSES AT AN INSTANT IS WORTH ZERO UNTIL THAT INSTANT PASSES** (owner
  ruling, 2026-09-19; shared rules code, so it binds both pipelines). LEAVE and AUTO PARK at the
  end of AUTO (F), TELEOP PARK at the end of the MATCH (G), the up-CELL contents at rest at the
  conclusion (C), the GARDEN at the end of TELEOP at rest (E). The TIP and both FLOWER lines are
  continuous (A, D) and are paid live. The COUNT stays live either way — that is the driver's
  readout — and `BbAllianceScore.pendingPts` carries what the instants still owe, shown as its
  own chip and never inside `total`. Before this, the bar read 9 one second into AUTO.
- **Determinism:** the source guard in `scripts/smoke.ts` scans `sim3d/`; `dsin/dcos/datan2/hyp`
  only; the SIM3D lane hashes two runs. Renderer files MUST be `scene/render*.ts` (the guard
  exempts `draw*`/`render*`, and the RENDER lane asserts `three` is imported nowhere else).
- **Rapier 3D gotchas, each shipped as a bug once:** forces and torques PERSIST across steps —
  `resetForces`/`resetTorques` every tick before applying the wrench (the 2D world is rebuilt per
  step, so it never had to); the robot collider footprint is `robotExtents` (intake reach), not
  the bare chassis (a wall-flush start position touched the wall in 2D only, which read as a 30×
  yaw gap); wall friction `PHYS_WALL_FRICTION` and the solver iteration parameters must be SET
  (the 3D defaults differ from the 2D solve); `RigidBodyDesc` uses `enabledRotations`;
  `JointData.limits` do not clamp — call `setLimits` on the joint; a 0.25-in kinematic plate needs
  a 0.75-in collision skin or a 260 in/s shot tunnels; `src/sim/spawn.ts` `coerceSpec` must carry
  `heightIn` across the way it carries `bbMech`; the rest-speed snap must run EVERY tick under
  the threshold (a one-shot edge let contact bias walk a settled line 2 in).
- **Drive feel is the shared wrench.** Parity checks measure in OPEN FIELD: two solvers' wall
  contact legitimately differs; the drive model itself matches 2D to four decimals.
- **Field geometry is CAD-derived** (owner decision 2026-09-17, licence risk accepted).
  `npm run field-cad` (cache OUTSIDE the repo at `%LOCALAPPDATA%/dsim/field-cad/`: the sha-pinned
  STEP v26-27.2 zip, a CadQuery venv) writes `public/models/biobuzz/{field.glb, field-low.glb,
  field-colliders.json, field-measurements.json}` and `sim3d/fieldColliders.gen.ts`; the README
  there has the source, node names and schema. The scene loads the GLB (constants-built fallback
  in `renderField.ts`, kept geometrically right against `drawField.ts`); the physics takes the
  collider hulls/trimeshes with the floor and walls analytic. GLTFLoader strips `/` from node
  names — look them up by `userData.name`. Read `docs/biobuzz/field-cad-audit.md` before touching
  the pipeline.
- ✅ **RESOLVED 2026-09-18 — THE CAD IS AUTHORITATIVE FOR DIMENSIONS (owner ruling).** The two
  OPEN findings are closed by moving the CONSTANTS, not by widening a tolerance. **Nothing types a
  BIOBUZZ field dimension any more:** `scripts/field-cad/emit-dims.mjs` turns
  `field-measurements.json` into `src/games/biobuzz/fieldDims.gen.ts` (`FIELD_HALF`, `TILE_PITCH`,
  `TILE_SEAMS`, `FLOWERS`, `FLOWER_D`, `HIVE`, `TAPE`, `LZ`, `GARDEN`, `ALLIANCE_AREA`), with the
  derivation and the four-instance residual of every value in its header, and `config.ts` reads
  it. The field is **±70.674** (141.35 inside, not 144), the tile pitch is **23.528** (`C.TILE`'s
  24 is DECODE's and CR's; BIOBUZZ draws `BB_TILE_SEAMS`, the seven measured seam lines), the four
  flower positions are the CAD's own least-squares ring-bore centres, and `BB_HIVE_BOTTOM_Z` is
  **31.981** — the one figure where the CAD and Fig 9-10 genuinely disagree. A legal 29-in robot
  still clears the lowest structure (30.652), so G409's drive-under survives; a dumper standing 6
  in off its own cell no longer does, because its lob clips the higher underside. The 3D walls'
  "stay at 72 for parity" exception is GONE — the constants ARE the CAD — and the SIM3D lane's
  `one field` check asserts the 2D collider faces, the 3D collider faces and the CAD/GLB faces
  agree within 0.05 in. Tape is the CAD's 16 measured strips in BOTH renderers (`BB_TAPE`), never
  an outline of a zone rectangle, all of them **one width, `BB_TAPE_W`** (the CAD's 1.000 in, NOT
  the shared `C.TAPE_W`, which is DECODE's field and equal by coincidence) — and **there is no
  centre mark**: Event Field Guide V1.0 §8 tapes the LOADING ZONES, the GARDENS and the ALLIANCE
  AREAS and nothing else, and guide §9.1 has the four centre tiles come OUT for the frame, so the
  origin is bare tile under the HIVE. Both renderers drew a white cross there at tape width; the
  RENDER lane now runs `drawBiobuzzField` against a recording context and fails on any white line
  inside the perimeter. A `fieldDims.gen.ts` that drifts from the measurements JSON
  fails the SIM3D lane, which re-renders it and diffs byte for byte. `docs/biobuzz-reference.md`
  carries the ruling and the full before/after table.
- **GRAPHICS SETTINGS ARE PER DEVICE, AND THE SCENE SUBSCRIBES TO THEM** (Day 3, plan §4.4–§4.6).
  `graphics/settings.ts` is the model — the sixteen dials, the four preset columns, the
  0.6/1.2/2.2/4.0 MP pixel budgets, `localStorage['decodesim.graphics']` with field-by-field
  coercion. `graphics/auto.ts` is the POLICY (first guess → two-second warm-up → the in-match
  slip rule) and takes its clock as a PARAMETER, because `smoke.ts`'s determinism guard greps
  this whole directory for `performance.now()`. Nothing under `graphics/` may import `three` or
  `scene/` — it is read by `src/ui/GraphicsSection.tsx` and `src/contributors.ts`, both ordinary
  main-bundle files, and the RENDER lane asserts it. Fourteen settings apply LIVE; mesh detail
  needs the next 3D view (it picks the GLB) and SSAO/SMAA are **not offered on this build**
  (`GFX_NOT_OFFERED` carries the reason, and the UI prints it).
  - ⚠️ **MSAA is a render target this scene owns, not the canvas's `antialias`.** The context is
    created with `antialias: false` always: WebGL cannot be asked for a particular sample count
    on the default framebuffer and the attribute is fixed for the life of the context, so that
    is the only way "2x" and a live change are both possible. The target is half-float, and the
    BLIT is where tone mapping and the sRGB conversion happen.
  - ⚠️ `WebGLRenderer.setViewport`/`setScissor` take CSS pixels and multiply by the pixel ratio
    THEMSELVES. The PiP minimap passed drawing-buffer pixels once and squared the ratio — at 75 %
    render scale the whole scene drew into 56 % of the canvas, which reads as a camera bug.
  - **Environments** (plan §4.5) are two CC0 Poly Haven HDRIs fetched on demand as 1k `.hdr`,
    never bundled, listed in `graphics/environments.ts` — which `src/contributors.ts` DERIVES its
    Third-party credits from, so a new one cannot ship uncredited. Use `HDRLoader`, not
    `RGBELoader` (renamed in three 0.186; the old name warns on every load).
  - **The view key `t` is armed by `InputManager.attach`/`detach`** (`graphics/viewKey.ts`,
    reference-counted). It CANNOT live in the scene: the listener dies with the scene, so from
    the 2D map there is nothing left to press. It is not a `KeyAction` — it changes which
    renderer is mounted, not the robot.
  - ⚠️ **`Renderer.render(…, overlayOnly)` CLEARS the whole canvas.** Right for the live view
    (the 2D canvas is a separate sheet above the WebGL one); fatal anywhere both passes share a
    canvas. The replay export draws the overlay onto a sheet of its own and composites — without
    that, every exported 3D frame is black. Measured 1920×1080: 2D 0.44 ms/frame, 3D 0.85 ms.
- **Client:** `graphics/store.ts` holds the per-device view pref (`localStorage['decodesim.view']`);
  `GameView`/`game.ts` await `initPhysics3d()` before a 3D practice (fallback to 2D with an
  event-log line) and mount the lazily imported `scene` under the 2D canvas (`overlayOnly`).
  LAZY chunks — physics ≈ 1.12 MB gz (the wasm glue plus the implementation), scene ≤ 250 KB gz —
  ratcheted by `npm run bundleaudit` (needs a build; not in `npm test`).
- ⚠️ **`sim3d/` IS LAZY, AND ONLY TWO OF ITS MODULES MAY BE IMPORTED FROM OUTSIDE IT** (done
  2026-09-18; it used to be otherwise, and the implementation sat in the main chunk). `engine.ts`
  is the LOADER — `initPhysics3d` / `physics3dReady` / `rapier3d` / `physics3dImpl` — and
  `tilt.ts` is `hiveTiltAngle` + `hiveTrayRefTheta`, pure JSON, because the 3D SCENE reads the
  tray angle on a frame where no 3D physics is loaded (a 2D-physics match in the 3D view).
  Everything else hangs off `sim3d/impl.ts`, a re-export barrel that `initPhysics3d()` alone
  imports, dynamically, beside the wasm; reach it with `physics3dImpl().<name>` after the await,
  which is how the PREDICTORS (`predict.ts`) will be wired. `sim3d/step3d.ts` is a one-line gate
  doing exactly that, so `step.ts` can dispatch without pulling a byte of physics in. Node callers
  (smoke lanes, `hive-calibrate`, `costprobe`) still import the modules directly — there is no
  bundle to protect there. The RENDER lane fails on a static import of anything else.
- **THE 3D ROBOT CREATOR (`docs/roadmap.md` item 1)** — `scene/renderPreview.ts` is a second,
  small scene in the SAME chunk, and `Preview3D.tsx` (main chunk, no `three`) is the builder's
  2D/3D toggle, the `Stowed` toggle and the saved-robot thumbnails. Three rules hold it together,
  and each is asserted by the RENDER lane rather than left to a habit:
  - **ONE GENERATOR.** The preview calls `buildRobotGroup(spec, id, alliance)` — the function the
    live match calls for every robot on the field — and builds exactly one mesh of its own (the
    floor disc). The renderer, the tone mapping and the light rig come from `scene/renderCore.ts`,
    which both scenes share, because those are per-RENDERER settings and every one of them changes
    the pixels. A preview drawn a second way would be a preview that lies.
  - **ONE REBUILD KEY.** `bbSpecKey` (`specKey.ts`, NOT under `scene/`) is the build's geometry
    identity, read by the generator inside the chunk and by the thumbnail cache outside it — the
    main chunk has to key a cache on it without loading the scene chunk to ask.
  - ⚠️ **ONE DYNAMIC SPECIFIER.** `index.ts` fills TWO slots (`scene`, `previewScene`) and both
    write `import('./scene/renderScene')`; the preview factory is re-exported from there. Two
    specifiers would hoist three.js into a shared chunk behind two facades, and a facade carries
    none of the marker strings `bundleaudit` routes the `scene` budget by — both would land in
    `other` and fail that audit for a reason that has nothing to do with size.
  The COSMETIC CHASSIS COLOUR is rendered in 3D now (fill = `chassisFill(spec.chassisColor)`,
  alliance = the silhouette line plus the sign panel, the split the 2D sprite has always made);
  it was alliance-filled and the colour was not drawn at all, so it vanished when a player pressed
  `t`. Looking at a robot close up also found the TURRET and the BOX TUBE built INSIDE the chassis
  box, `specKey` missing `drivetrain`, and a discarded group never disposed — all three were the
  MATCH's bugs and all three are fixed there.
- **THE SHOT PATH IS ONE PREDICTOR AND TWO DRAWINGS** (owner playtest feedback 2026-09-18, items
  5–6). `src/games/biobuzz/shotPath.ts` — NOT under `scene/`, because nothing outside `scene/` may
  import from it — answers "would this shot go in, and what does it fly through". `drawShot.ts`
  draws it on the 2D map and `scene/renderReticle.ts` in 3D, and neither works anything out for
  itself. The rules: a path ONLY for a shot that is MADE, drawn DOTTED, with no landing ring at the
  end. "Made" is `hiveAccepts` with the AIMED cell ASSUMED FULLY UP (`bbPretendHive`, the copy stage
  5b's fire gate asks — owner ruling 2026-09-19, reversing "against the REAL hive"), so the path
  is drawn exactly when holding fire would release, and a cell that is down or mid-swing still
  draws one. `bbFlightEnters` now takes an optional `BbFlightTrace`
  out-parameter and records the arc into a caller-owned buffer, which is what retired
  `scene/renderLanding.ts` — that file carried a COPY of the integrator, and its own header said
  the copy would drift.
  - ⚠️ **A TURRET'S YAW AND ELEVATION ARE SEPARATE NODES** (`bb-turret-head` → `bb-turret-pitch`).
    Both on ONE node is what "the shooter is not automatically aiming" looked like: a `THREE.Euler`
    defaults to order `XYZ`, so the elevation was applied about the UN-yawed axis, and at the 160°
    turret yaw and 80° elevation hive range actually asks for, the barrel came out 67.7° BELOW
    horizontal and 44.5° off in azimuth while the SIM's turret was dead on target. The sim aims
    correctly under both physics — measured, converging in 41–52 ticks with no button held.
  - ⚠️ **ONLY THE HOOD ELEVATES, AND THE RELEASE FOLLOWS IT** (owner ruling, 2026-09-19, after five
    rejected passes at this one mechanism). `bb-turret-pitch` used to carry the WHOLE head — plates,
    flywheel, hood, motor, braces — pivoting about the muzzle, which is the only reason a ρ budget
    ever existed: the entire assembly swept through the drivetrain at elevation. It now carries the
    hood arc and its two arms and NOTHING else, pivoting about the FLYWHEEL AXLE, which is the one
    pivot that holds the wheel-to-hood gap constant. The wheel, both side plates, the braces, the
    motor, the belt and the feed are fixed and need static deck clearance only.
  - ⚠️ **`bbMuzzleLocal(pitch)` (`robot.ts`) IS THE ONE MUZZLE, AND `scene/renderRobots.ts` IMPORTS
    IT.** The shooter's whole dimension chain lives in `config.ts` now — it used to be private to
    the renderer, which is exactly how the picture and the physics disagreed for five rounds. A hood
    on an axle pivot moves its own lip, so the release is no longer a flat `BB_LAUNCH_Z0`: it is
    9.634 in level, 8.466 at 57.6° and 7.554 at the 80° cap, and it retreats along the heading as it
    drops. Same "one predictor, two drawings" rule the shot path follows, and the RENDER lane proves
    the drawn lip sits on the sim's muzzle at every pitch rather than assuming it.
  - ⚠️ **`bbTurretSolution` IS A FIXED POINT** — the elevation moves the release and the release
    moves the elevation. `BB_TURRET_SOLVE_PASSES` (4) passes ALWAYS, with no early exit and no
    tolerance, because a trip count that depends on a float comparison can differ between a client's
    prediction and the server's authority. Measured over 7,688 field poses, a fifth pass moves the
    pitch by at most 1.76e-9 rad. The outcome change was authorised: scoreable field cells 1359 →
    1382 north and 1417 → 1439 south, pitch-capped cells 255 → 211, nothing speed-capped, worst
    required muzzle speed 253.26 → 256.37 against a 260 cap.
  - ⚠️ **A LAUNCH INHERITS THE MUZZLE'S OWN VELOCITY, AND THE TURRET LEADS** (owner, 2026-09-19:
    "animate the turret properly so that it has a 'shooting on the move' correction algorithm built
    in its animation... this does mean that perfect tracking is not possible"). A release leaves
    with `speed` along the barrel PLUS `v + ω × r` at the muzzle (`bbPointVel`) — before this a shot
    fired at full drive flew as if the robot were parked — so `bbTurretSolution` solves against a
    target displaced by `−v·t_flight`, folded into the SAME `BB_TURRET_SOLVE_PASSES` loop. A PARKED
    robot is byte-identical (every lead term is multiplied by zero, and the ROBOT lane pins it), so
    the 1382/1439 scoreable-cell counts do not move. Measured residual at 89 in/s: mean 0.14 in,
    worst 1.75; the pre-lead pair fired from the same pose misses by a mean of 53 in. A DUMPER's
    lead is exact in one step, because a lob's flight time is a closed form in the height alone.
  - ⚠️ **THE TURRET HAS AN ACCELERATION, NOT ONLY A RATE.** `bbSlewTurret` runs a discrete
    bang-bang profile (`slewAxis`) that decelerates into its target and never overshoots or rings;
    the per-axis angular velocity is carried on `RobotState` (`bbTurretYawVel` and its three
    siblings — optional, absent reads 0, quantized to 1e-4). `BB_TURRET_ACCEL` 70 rad/s² with the
    unchanged 7 rad/s rate puts a 90° swing at **0.333 s**; driving flat out past the HIVE the
    steady-state yaw error is 0.5–1.3° and 75–100% of released shots score, while a HARD REVERSAL
    leaves the barrel **22–24°** behind for 0.6–0.75 s — during which the landing gate releases
    **nothing**. The motor's rate window is centred on the CHASSIS yaw rate, so `turretHeading`
    being a WORLD angle costs the ring its own rate to hold, and a chassis spinning faster than the
    ring DRAGS the bearing.
  - ⚠️ **THE DRAWN PATH AND THE FIRE GATE ARE ONE PREDICATE** (owner, 2026-09-19: "the dotted
    lines still appear when the shot is not able to be made"). `bbTurretShotEnters` /
    `bbDumpShotEnters` (`play.ts`) are what stage 5b, `sim3d/elements3d.ts` and `shotPath.ts` all
    call — which closes 3D's Day 1 deviation, where release was gated on ALIGNMENT and the path on
    a landing prediction, so each could say yes while the other said no. The path is additionally
    gated on there being a shot to TAKE (`bbCanFire`: a live phase, a loaded hopper, not a passive
    dummy, and a dumper's 0.75 s re-arm — but NOT a turret's 77 ms beat, which would strobe it).
    The one deliberate difference stays: the gate asks Aim Assist's pretend-up hive and the path
    asks the REAL one, which is one-directional, so a drawn path is never a shot the gate refuses.
    A cell that is MID-SWING now draws nothing either — `hiveTakingSide` names one all through a
    tip, which is right for the capture and wrong for a promise, and it was the ENTIRE residual of
    "a path was drawn and the shot did not score" (28 of 28 in 3D). Measured after, over 1,152
    pose/velocity/hive cases in both physics and both mechanisms: **P(path drawn AND the shot would
    not score) = 0**, 113 paths drawn.
  - ⚠️ **A DUMPER IS A CATAPULT: ONE FLING, THE WHOLE BUCKET** (owner, 2026-09-19: "a dumper
    should not shoot one at a time. It holds four in a small 'hopper' and it would fling it like a
    catapult"). 3D used to POUR — one element every 0.3 s — because `bbDumpSolution` CONVERGES every
    throw on the cell centre and four real spheres meeting there knock each other off the arc. The
    stagger treated the symptom. `bbDumpCluster` is the 3D solve: `BB_DUMP_BUCKET` (4) seats, two
    ACROSS by two HIGH at `BB_DUMP_SEAT_PITCH`, sitting on the firing edge's own collision
    footprint, all leaving on ONE velocity so the cluster flies PARALLEL and arrives with the
    bucket's footprint. The 2D pipeline is permanent and keeps the converging solve (`BbShot.
    cluster` is the switch, and 2D never sets it) — a 2D flight element collides with nothing, so
    convergence is free there. Measured on the 28-pose tutorial grid: **20 of 28 poses score, 16 of
    them all four, 70 of 112 elements**, against the stagger's 20 of 28 poses. The row at 22 in is
    the honest near edge — the bottom row's arc clips the HIVE structure below the opening while
    the top row goes over it.
  - ⚠️ **A DUMPER HAS NO HOOD AND ITS RELEASE IS STILL FLAT.** `BB_LAUNCH_Z0` is a tipping tray's
    lip; it does not swing about a flywheel axle. `bbLobThrow`, `bbDumpSolution` and `bbLaunch`'s
    dumper branch all still read it directly, and the ROBOT lane has a leak guard: a dumper's release
    stays flat at every pitch while a turret on the same chassis follows its hood down.
  - ⚠️ **THE BOX TUBE REACHES THE FLOWER'S OPENING, AND IT PIVOTS AT THE FRAME RAIL** (owner,
    2026-09-20: "the boxtube extension should be reaching towards the opening in the flower, not
    extending horizontally. It should also be a lot faster"). Placement is still a PROXIMITY action
    with no sim travel, so this is entirely `scene/renderRobots.ts` — but it was sliding flat to
    `bbPlacePointLocal`, a point on the TILES, while the hole it places into is `BB_FLOWER_TOP_Z`
    21.404 in up. The arm now solves its pose per frame against the flower `bbFlowerInReach`
    returned (`bbBoxTubeAim`), which asks for **64.5°–86.2° of pitch**, a base swivel of at most
    **39°** (the ring may sit `BB_PLACE_TOL` off the mount's aim line) and **16.9–18.7 in** of arm.
    Two rules hold it up, and both are measured in the RENDER lane rather than assumed: the stage
    table is DERIVED from the worst in-reach pose (`bbBoxTubeStages`, five nested sections 1.5 →
    0.5 at one `BB_BOX_TUBE_WALL` per step, giving 17.6–18.7 in) so the tip lands on the opening to
    4e-8 in and no stage ever leaves its parent; and the **SHOULDER IS AT `glyph.outer`**, the
    frame rail. Pivoting the whole stack about its INBOARD end instead — the obvious reading of
    "the arm pivots at its base" — puts the pivot 4.9–5.3 in inside the rail, under a `center`
    turret's ring on every legal chassis, and the mast then rose straight through the head: its
    axis came within **0.000 in** of the drawn turret belt. Section 0 is a CRADLE bolted to the base
    node and never posed, so the retracted arm is byte-identical to the drawing that shipped.
  - **The hood's own feed mouth rotates away from the feed at elevation**, which is why the wrap is
    0.556 rad and not the 1.05 it was: a FIXED feed shoe at `BB_FEED_SHOE_R` spans 146°–202° and
    takes over the entry. It bolts to both side plates, so it is also the rear tie.
  - ⚠️ **INTAKING FROM A FLOWER IS ARCHETYPE-AWARE** (owner, 2026-09-20: "intaking from the flower
    should now only be done if it is physically possible"). `BB_INTAKE_KINDS` — `sweeper` /
    `siderollers` / `ramp` (`RobotSpec.bbMech.intake`, `bbIntakeKindOf`) — are three hardware
    variants on the SAME sweeper mouth (`bbMouths`, `bbRobotSolids` stay archetype-blind; a ground
    POLLEN is taken identically by every build). What differs is whether the hardware can reach
    the retrieval opening measured off the CAD: the bottom POLLEN sits on the tiles inside the
    lower bore, 3.55 in tall and open from the plate's field edge back 3.57 in to the peanut
    supports (§9.7 Fig 9-12; the numbers are `config.ts`'s "ROBOT — intake ARCHETYPES" section
    header). A `sweeper`'s roller rides at ~4.5 in, two inches behind the tip line at the tip
    line itself — it never passes the plate edge and its reach (`bbFlowerReachOf`) is `null`,
    always. `siderollers` straddle the POLLEN (reach `[1.15, 2.65]` past the tip line, z
    `[0.5, 2.5]`); a `ramp` (`bbRamp`, an edge-triggered toggle — `RobotState.bbRampOut`/
    `bbRampAt`) wedges under it once DEPLOYED and SETTLED (`bbRampSettled`,
    `BB_RAMP_DEPLOY_S` after the toggle; reach `[0, 2.17]`, z `[0.5, 1.38]`).
    `bbFlowerAtIntake` (`play.ts`) puts the FLOWER's ring centre into the mouth's own frame
    (`mouthAxes`) and asks a BITE — `bbBites` (`flower.ts`), one helper for both axes — of at
    least `BB_FLOWER_BITE` (0.5 in) between the archetype's box and the POLLEN's own extent, in x
    (`reach.out` against `[u−r, u+r]`) and in z (`reach.z` against the bottom element's own
    centre height, read from `ball.z` in 2D — already a centre, `flowerStackZ` — and `ball.z + r`
    in 3D, where `ball.z` is the bottom). At flush (`u = BB_PLACE_REACH`, 2.384 in): side rollers
    bite 1.5 in in x and 2.0 in in z; the ramp bites 1.18 in and 0.88 in; the standoff tolerance
    past flush is ≈1.17 in for side rollers and ≈0.68 in for the ramp.
    ⚠️ **`u` IS MEASURED FROM THE MOUTH'S OWN OUTWARD BOUND (`uOut`, the roller line — the
    collision footprint's edge on this side), NOT THE BARE CHASSIS FRAME.** The frame sits
    `bbIntakeReach` (3–5 in) further BACK than that, which is where `footprintExtents` actually
    stops the chassis in a real match — measuring from the frame instead left the opening
    physically unreachable by any archetype (a robot driven flush settled ~5.2–5.4 in from the
    ring) and the RETRIEVE tutorial step never completed. `uOut` is where a robot driven flush
    against the foot actually rests, so `u ≈ BB_PLACE_REACH` there — the design intent, reached
    by the collision the field enforces rather than by a pose only a test can teleport to.
    ⚠️ **THE REACH HARDWARE IS A COLLIDER IN 3D NOW** (owner, 2026-09-20: "It should be a
    collider."). It used to be drawing + capture-gate only, on purpose, the same as the Box
    Tube's placement point above — that is GONE for 3D: `chassis3dReachShapes` (`sim3d/bodies.ts`)
    builds side rollers and a SETTLED ramp (`bbRampSettled`; folded, a ramp contributes nothing)
    as real boxes in `GROUP_POCKET` — statics, walls and robots meet them, an ELEMENT does not, the
    same group the intake pocket filler uses — in the AUTHORITY (`addChassis3dColliders`) and in
    BOTH predictors (`predict.ts`'s `fitChassis`; the FULL predictor keeps its own single
    `robotExtents` cuboid for the bare chassis but adds these small boxes on top of it — cheap
    enough that it did not move the 40-tick reconcile budget, measured: baseline 3.0 ms, with side
    rollers live 2.0 ms, with a deployed ramp live 2.0 ms, against an 8 ms budget). A side-roller
    build now stands off a wall by `bbIntakeReach + BB_SIDE_ROLLER_OUT + BB_SIDE_ROLLER_R`
    (measured 13.15 in against a bare-footprint 10.50), not the bare footprint; a wall-flush FULL
    prediction agrees with the authority to within half an inch (measured 0.25 in for side
    rollers, 0.42 in for a deployed ramp, both server-corrected trivially under the 16-in
    `SMOOTH_MAX_DIST` snap threshold). The ramp's collider set is rebuilt at the same SETTLE edge
    `bbRampReady` already gated the flower credit on — `BB_RAMP_DEPLOY_S` after the press going
    in, and immediately (no settle wait) coming out, because a fold only removes solid, nothing has
    to arrive (measured: the collider count changes at exactly tick 18 = `BB_RAMP_DEPLOY_S`·60
    deploying, and on the very next sync folding, and at no other tick). Two of the ramp's parts —
    the crossbar and the two rails — tilt at `BB_RAMP_ANGLE`, which for a FLANK mount is a genuine
    3D rotation (the mount's own yaw composed with the local pitch,
    `quatMul(yawQuat(EDGE_ANGLE[edge]), pitchQuatY(BB_RAMP_ANGLE))`, `math3.ts`) — a bare "rotate
    about Y" cannot say a flank mount's tilt, which is about world X.
    ⚠️ **A WALL-FLUSH SPAWN NEEDED A FIX ON THE SPAWN SIDE, AND THE FAILURE WAS WORSE THAN SLOW.**
    `bbSnapStart` seats an anchor at the bare footprint, so a side-roller build's wheels started
    embedded 2.65 in in the wall on every real anchor whose intake edge faced it — and MEASURED,
    that never resolved: a wheel box sitting low near the floor gives Rapier's own SAT a SHORTER
    escape through the floor (its own 2.5-in height) than sideways (2.65 in), so the correction
    went into the floor collider and the two cancelled every tick — 300 ticks / 5 s, exactly zero
    drift on every axis, not merely slow. `spawn.ts`'s `bb3dStartFootprint` (3D worlds only; `2d`
    calls `bbFootprint` exactly as before) grows the containment footprint `bbFitPose` already
    clamps against by `bbArchetypeWallExtra(kind)` (`config.ts`, a plain scalar so `spawn.ts` —
    main-bundle — need not import the lazy `sim3d/` chunk) on whichever edge the archetype's mount
    already grows, so the SAME clamp that keeps a robot inside the field also backs a
    reach-equipped anchor off before the engine ever builds a collider: MEASURED, zero protrusion
    now on every real anchor × mount × alliance (32 combos), and the settled pose drifts nothing
    (< 0.00001 in) with no yaw over a 90-tick window.
    **2D stays DRAWING-ONLY, and stays that way on purpose**: `bbFootprint`/`footprintExtents` are
    UNCHANGED in both pipelines (2D has no z, the foot is a solid rect there, so a reach part
    cannot be solid without also being solid to a ball it should let pass under) — a wall-flush 2D
    pose still draws the side rollers or the ramp INSIDE the wall, exactly as before; only 3D's
    collision changed. The wire widened for the ramp toggle: `QCommand.buttons` is 16 bits now
    (`BTN_BBRAMP` = 256, `src/net/protocol.ts`), and `packKey` (`src/sim/replay.ts`) carries the
    buttons ALONGSIDE the packed axes rather than inside them — packed in, bit 256 masked to 0 and
    a ramp press was invisible to the replay recorder.
  - ⚠️ **THE RAMP IS SOLID TO AN ELEMENT NOW, NOT JUST TO A ROBOT** (owner report 2026-09-20: "the
    pollen should be getting intaked from the deployable ramp BECAUSE it collides with the ramp
    and slides down... right now, it just looks like the pollen is passing through the ramp").
    The crossbar and rails `chassis3dReachShapes` builds (above) carried `GROUP_POCKET`
    unconditionally, which is the group an ELEMENT never meets — so a deployed ramp was solid to
    a robot and a wall and invisible to the one thing it exists to catch. `Chassis3dShape` grew an
    `elementSolid` flag (`bodies.ts`): the ramp's crossbar and rails set it (default groups, meets
    an element, plus the chassis boxes' own edge break via `chassisBoxDesc` so a ball meeting the
    bar behaves like meeting the frame); side rollers do not (still `GROUP_POCKET` — compliant
    wheels a POLLEN passes BETWEEN, not a bar it meets square on). `reachColliderDesc` (shared by
    the authority and the FULL predictor) picks the group and the collider builder off that one
    flag. **MEASURED**: a ground POLLEN fired at 30 in/s into the deployed bar's plane stops/
    bounces, never crosses it, across the whole tested lateral spread.
  - ⚠️ **THE INTAKE'S OWN PULL REACHES `BB_RAMP_OUT` FURTHER OUT, ONCE DEPLOYED AND SETTLED.**
    `bbIntakeAct` (`robot.ts`) gained `BbIntakeOpts.extraReach`, added only to the eligibility
    bound (`g.uOut + extraReach + er + BB_INTAKE_LIP`) — an element sitting anywhere inside the
    ramp's U, on the tiles or resting on the crossbar, is now something the rollers can grip and
    draw in, not just something the bar can shove. `bbIntakeExtraReach(r, time)` is the ONE
    predicate both `play.ts`'s `step2d` and `sim3d/elements3d.ts`'s `elements3dCapture` compute it
    from (`bbIntakeKindOf(spec) === 'ramp' && bbRampSettled(r, time) ? BB_RAMP_OUT : 0`), so 2D and
    3D cannot disagree about how far the pull reaches. **2D has no ramp collider at all** ("2D
    stays DRAWING-ONLY" above still holds) — nothing is solid there, so the extended reach simply
    pulls a ground POLLEN in from further out; a real bar's PUSH is 3D-only.
  - ⚠️ **A `ramp` BUILD'S FLOWER RETRIEVAL IS A TWO-STEP RELEASE IN 3D, NOT A TELEPORT INTO THE
    HOPPER.** MEASURED (10 runs, seeds 5001–5010, standoff 10–25 in, stick 0.35–1.0): driving a
    real `ramp` build into a FLOWER's foot with the intake held, the PROXIMITY GATE
    (`bbFlowerAtIntakeMouth` + the Z-bite) always fires before the physical push has a tick to act
    — the ball's centre moves under 0.6 in before the old code would have swallowed it whole. So
    `flowerRetrieve3d` (`sim3d/flower3d.ts`) does not `capturePollen` for a `ramp`: it releases the
    bottom POLLEN as a `ground` element under the crossbar — position `ax.uOut + BB_RAMP_OUT −
    0.3 − r` outward (just behind the bar's inner face) and `BB_RAMP_RELEASE_V` sideways
    (`config.ts`), `z` at the lower plate's own rim, a small nudge inward — tags it `ground`,
    splices it off `flowers[i].stack`, and lets the extended pull (above) sweep it the rest of the
    way in. **THE LATERAL OFFSET IS LOAD-BEARING, NOT COSMETIC**: `derive.ts`'s tube-membership
    test (`flowerTubeOf`) is a bare radius from the FLOWER's own axis (`BB_FLOWER_OPEN_R`, 2.086
    in) — a release dead on the flower's own y sits only ≈1.06 in from that axis (the ramp's own
    reach past the POLLEN's centre is only 0.64 in) and gets re-tagged `element`/`flower:i` on the
    very next `deriveTick`, before gameplay ever sees `ground`. `BB_RAMP_RELEASE_V` solves for the
    sideways distance (under the crossbar, which spans the whole mouth width) that clears the
    radius, plus margin. MEASURED transit (release tick to swallow): 8–13 ticks (0.13–0.22 s),
    never instant, never a second tunnel through the bar. Every other archetype (`siderollers`,
    and the direct proximity path in general) is unchanged: still a straight `capturePollen`.
  - ⚠️ **THE RAMP SWING GUARD: A DEPLOY OR FOLD THAT WOULD CARRY THE RAMP INTO A STATIC REVERSES**
    (owner, 2026-09-20: deploying into a FLOWER should be refused, "same with un-deploying").
    `bbRampSwingProgress(r, time)` (`robot.ts`) is the ONE eased curve (smoothstep,
    `t²(3−2t)` over `t = elapsed / BB_RAMP_DEPLOY_S`) both the guard and the renderer's own ease
    read, `e ∈ [0,1]` (0 folded, 1 deployed) — `null` when no swing is in flight. **3D**:
    `bbRampSwingShapes(spec, heightIn, e)` (`sim3d/bodies.ts`) builds the crossbar + rails at ANY
    progress `e` about the FIXED PIVOT (`φ(e) = e·(π/2 + BB_RAMP_ANGLE)` from straight up),
    verified to reduce EXACTLY to `chassis3dReachShapes`'s own deployed numbers at `e = 1`;
    `rampSwingHitsStatic` is a free-floating Rapier shape-intersection query (never a collider on
    any body) filtered to `collider.parent()?.isFixed()` — walls, flower plates/supports and the
    hive FRAME, never the hive tray, a robot or an element. **2D** (`bbRampSwingStep2d`, `play.ts`)
    has no z or partial-swing geometry, so it tests the FULL DEPLOYED FOOTPRINT rect (SAT) against
    the 2D field's own static rects (`biobuzzColliders.statics`, all `rot: 0`) every tick a swing
    is in flight — which covers "at the press" for free. A hit calls `bbRampReverse`: flips
    `bbRampOut` and re-stamps `bbRampAt` so the SAME curve runs backward from the CURRENT angle
    (symmetric — no snap), and sets `RobotState.bbRampBlocked` so the guard does not re-test for
    the REST of that one swing (it can only retrace ground already proven clear); a fresh press
    clears the flag. ⚠️ **A RIGID ARM ROTATING PAST 90° OVERSHOOTS ITS OWN FINAL REACH MID-SWING**:
    `sin(φ)` peaks at `φ = 90°`, which is BEFORE the arm's resting angle (`90° + BB_RAMP_ANGLE`),
    so the swing's outward reach exceeds the settled footprint's by
    `BB_RAMP_L·(1 − cos(BB_RAMP_ANGLE))` at the peak — MEASURED, a standoff that clears the
    SETTLED footprint's own clearance margin (0 in flush) can still be caught mid-swing (3 in off
    the foot still refused; 4 in and up settle clean). The guard is catching a real transient
    collision a final-pose-only check cannot see.
  - ⚠️ **SIDE ROLLERS RELOCATED TO THE MOUTH'S OWN EDGES** (owner, 2026-09-20: "situated on the
    edges of the robot, not near the center. It is to funnel things from the edge"). A wheel's
    axis is `bbSideRollerY(mouthHalf)` = `mouthHalf − BB_SIDE_ROLLER_EDGE_INSET`, not the old fixed
    `BB_SIDE_ROLLER_Y` — `chassis3dReachShapes` places the pair at `±bbSideRollerY(axes.half)`.
    `BbFlowerReach` grew `edgeGrip` (`BB_SIDE_ROLLER_REACH` sets `half: null, edgeGrip:
    BB_SIDE_ROLLER_GRIP`): the pair is 12+ in apart on a real chassis and cannot straddle a 2.8-in
    POLLEN, so `bbFlowerAtIntake`'s lateral test becomes "is the POLLEN within `edgeGrip` of
    EITHER wheel's own axis" (`min(|v−wy|, |v+wy|) ≤ edgeGrip`) instead of a centreline band — a
    driver lines an END of the intake up on the opening, never the middle. **A wide (realistic)
    chassis's wheel sits far outside a FLOWER's own plate half-width** (measured: `bbSideRollerY`
    ≈6.4–7.65 in against a 2.976-in plate half-width, at every buildable chassis width) — reaching
    one still works because the ROBOT, not the wheel, is what gets driven off-centre to line it up
    (the flush pose's HEADING absorbs the offset — see `mouthPoint`, `tutorial.ts` — never the
    stage position's `y`), but a few CAD-derived numbers that assumed the wheel sat near the
    chassis centreline (drive-in standoff, the FULL-predictor wall-standoff comparison) now read a
    wider but still-passing tolerance; their own comments carry the measurement.
- **Verification:** `scripts/smoke-biobuzz/sim3d.ts` (SIM3D lane: seam, drive parity, two-run
  hash, conservation, containment with `containmentFixes === 0`, CCD, capture, launch into either
  up cell, 18/29-in clearance, tip/spill, perf ≤ 1.5 ms, CAD probe agreement) and `render.ts`
  (RENDER lane); `scripts/scene-preview` (side-by-side 2D/3D page with a named-object check);
  `scripts/field-cad/preview` (GLB viewer). In an automated browser, drive the game through the
  live `GameController` (React fiber from the canvas) and judge progress by `world.tick`, since
  `requestAnimationFrame` only advances when a paint is forced.

---

# AI DRIVERS (`src/games/biobuzz/ai/`) — Day 3, plan §6

`GameSimModule.bot` is filled for BIOBUZZ and absent for DECODE and Chain Reaction. Three tiers
(`easy` / `medium` / `hard`), ONE policy: `tiers.ts` is a table of numbers the single state machine
in `policy.ts` multiplies or branches on, so "Easy is a worse driver" never becomes "Easy is a
different program". **No tier may read anything a lower tier cannot** — difficulty is execution
(speed, hesitation, patience, how strict it is about taking a shot), never information.

- **The memory is the CALLER's.** `bot.create(world, robotId, tier, seed)` returns a `BotSeat`; the
  caller (the controller in practice, `Room` on the server, the LAN host worker) calls
  `seat.step(world)` ONCE per tick before `biobuzzStep`, puts the result in the command map, and
  **records it exactly like a driver's** — so a replay of a match with a bot in it re-simulates with
  no bot at all. Nothing about the bot is written to the `World`. There is deliberately **no
  memoryless `drive`**: a policy with hysteresis cannot answer one honestly, and a server calling it
  while a client predicted with `create` would disagree about what the bot did.
- ⚠️ **`ai/` IS SIM CODE AND IT IS IN THE MAIN CHUNK.** No DOM, no clock, no `Math.random`, no
  `process` (a `process.env` debug hook threw on the first decision in a browser and took the render
  loop down — green in Node, fatal on the page), no `import.meta`, and nothing from `sim3d/` but
  `tilt`. The AI lane greps for all of it.
- ⚠️ **It never reads `world.rngState`.** Its randomness is its own mulberry32 chain seeded
  `(matchSeed, seat)`. The world's chain is CONSUMED, so a bot drawing from it would move every
  later draw in the match and a client predicting a tick without the bot would diverge. The lane
  proves the absence with a `Proxy` that records any access.
- Commands leave through `localizeCommand` (the wire round-trip), so what is recorded and what is
  simulated are the same bytes. The bot re-decides every `BB_AI_DECIDE_TICKS` (6) and holds in
  between, which is what keeps a recorded bot track hold-last friendly.
- **Tuning lives in `config.ts` under `BB_AI_*`**, all `APPROX`, and each constant's header carries
  the measurement that fixed it. Four of them are bugs that shipped in a morning's tuning and are
  worth knowing before touching the policy: a bot that drives at full stick right up to its goal
  OVERSHOOTS it every decision window (`BB_AI_SLOW_RADIUS`); a purely radial obstacle push parks the
  robot at the balance point instead of going round (the tangential term in `route`); patience
  counted against an element ID never fires, because two elements in a corner take turns being the
  nearest one (`BbBotMemory.noProgress` counts against the HOPPER); and giving up on one unreachable
  element without its neighbours is giving up on nothing (`BB_AI_GIVEUP_RADIUS`).
- **Fouls are the tier table's real constraint.** A faster bot that drives through an opponent
  collects G421 PINNING majors and hands them 20 points each; the first tuning that made HARD
  genuinely faster also made it LOSE to EASY. `BB_AI_PIN_DECISIONS` backs a bot off an opponent it
  has been leaning on, and `BB_AI_ROBOT_CLEAR` keeps it out of contact it does not need.
  `BB_AI_HIVE_CREEP` slows it under the HIVE — it used to be there so a legal drive-under was not
  a G417 ram; G417 is REMOVED (owner ruling, 2026-09-19) and the creep is kept as measured tuning
  pending a `test:ai` re-measure, not because the rule still needs it.
- **Verification:** the `AI` lane in `npm test` (the seam, determinism over 3,600 ticks under BOTH
  physics, the read list, quantization, R102's stow/deploy, `step3d` perf with bots driving, and
  that a bot can actually score) and `npm run test:ai` (`scripts/aismoke.ts`, ~9 min, OUTSIDE
  `npm test`) for the statistical claim. The head-to-head win rate is a **RATCHET**, currently
  under plan §6's 90% target — read the comment on `BB_AI_WIN_RATE_FLOOR` before changing it.

**R102, the STOW HEIGHT and the DEPLOY LATCH** (plan §3.3). R105.A's 29 in is the EXPANDED height
(`BB3_HEIGHT_MAX`); R102 limits the STARTING CONFIGURATION to an 18-in cube (`BB3_STOW_MAX`). A
build over the cube is modelled as folding to exactly it (`bbStowHeightIn`), because `RobotSpec`
carries no `stowHeightIn` field yet — adding one is a `src/types.ts` edit plus a carry-across in the
shared `coerceSpec`, and until then a DECLARED value is read structurally so the rule binds the day
the field lands. `coerceBiobuzzSpec` normalizes a declared stow to `[BB3_HEIGHT_MIN, heightIn]` and
**deliberately does not clamp it to 18** — that would make `bbStowLegal` true by construction.
The RULE refuses, at `GameSimModule.startLegal`; the builder says so first. Deployment is a READ of
`world.match` (`bbDeployed`), never a stored latch, and `sim3d/engineImpl.ts` rebuilds the chassis
collider at that edge, recording the height it built (`Engine3d.robotHeights`) so READBACK subtracts
the same half-height it added — get that wrong and the robot's `z` jumps on the deploy tick.
