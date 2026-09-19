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

**It is ALPHA-ONLY** (`channels: ['alpha']` in `SEASONS`). The repo is public and the
season is private until further notice: on a stable build it is absent from the home
picker and the queue counts, invisible to the SEO surfaces, and its URL prefix falls back
to the saved game. Nothing about it may be pushed to a public branch or deployed to the
stable site.

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
`step3d`. Solo practice picks via `GameSettings.practicePhysics` (default `'3d'`; Practice setup
has the control); online rooms, LAN and replays are still 2D until Day 2 (`RoomConfig.physics`).
The 2D pipeline is PERMANENT (owner rule): every existing check must stay byte-identical.

- ⚠️ **The "BIOBUZZ owns no ground-pollen physics" rule above is the 2D pipeline's.** `sim3d/`
  OWNS its own solve: one persistent Rapier 3D world per `World` object (`WeakMap` in
  `engine.ts`, rebuilt when `tick` goes backwards or the robot set changes), bodies created in id
  order, JSON→body SYNC before each step (a body is teleported only when its JSON differs from
  what the last readback wrote — no thresholds), READBACK rounded to 1e-4 after. Robots are
  cuboids `length × width × heightIn` (yaw-only, z free; `RobotState.z` = chassis BOTTOM height,
  0 while driving); elements are spheres with CCD when fast; `held`/`stock` have no body; an
  `element` in a flower is a fixed body at its 2D-parked position (tubes are Day 2). The hive
  tray is a KINEMATIC body swung by the shared timer (`hiveTimerStep`, split out of `hiveStep`
  with no 2D change; `BB3_HIVE_DYNAMIC = false` until Day 2 calibrates the see-saw) and the spill
  is PHYSICAL. `derive.ts` fills `hives[a].contents` / `flowers[i].stack` and the `element` tags
  from body positions every tick, so `score.ts`, `hud.ts` and the 2D renderers run unchanged.
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
  an outline of a zone rectangle. A `fieldDims.gen.ts` that drifts from the measurements JSON
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
  has been leaning on, `BB_AI_HIVE_CREEP` slows it under the HIVE so a legal drive-under is not a
  G417 ram, and `BB_AI_ROBOT_CLEAR` keeps it out of contact it does not need.
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
