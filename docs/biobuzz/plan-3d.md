# BIOBUZZ 3D: an authoritative 3D simulation

## 0. Status

**DRAFT 2, 2026-09-17, branch `biobuzz-3d`, `docs/biobuzz/plan-3d.md`.** Replaces draft 1, which
kept the 2D sim authoritative and added a 3D view. The owner rejected that: the game is to be a
proper 3D authoritative simulation, built fast. Line references are as of `efficiency-audit`
`e0ce598`; `alpha` (this branch's base) predates the CLAUDE.md split and `docaudit`.

Decisions, one line each:

1. **A fourth game, `biobuzz3d`**, in `src/games/biobuzz3d/`, alpha channel first. The 2D BIOBUZZ
   is untouched. Own boards, replays, queue; one `lan_runs` CHECK migration.
2. **Rapier 3D is the authoritative physics**, `@dimforge/rapier3d-deterministic-compat` 0.20, on
   the server and in every replay. Robots, all 56 elements, the tray, the flowers and the frame
   are real bodies in one world.
3. **The world persists on the server** (sleeping and warm-starting on), serialised to plain JSON
   every tick. The client predicts only its own chassis in a small world rebuilt per reconcile;
   everything else is interpolated from 30 Hz snapshots.
4. **Spill, stacking and blocked shots are physics, not scripts.** The tray is a kinematic body
   swung by the existing timer; its contents fall out because it tilts. Flower contents stack
   because they are spheres in a tube. Scoring is a pure read of positions.
5. **The tip decision stays the manual's table.** No mass model exists to replace it.
6. **Three.js r186, WebGL2, lazily loaded**, with a driver-station camera by default. Physics and
   renderer are two lazy chunks only this game's route pays for.
   **The field comes from FIRST's public CAD**: a scripted STEP-to-glTF pipeline produces the
   visual mesh, the static and tray collider meshes, and a measurements file; the constants-built
   field is the fallback when the GLB is absent (8, "Field CAD").
7. **Shared-core changes are four optional fields and one slot**: `RobotState.z/vz`, a
   `scene` slot on `GameModule`, and the game id registrations. Nothing BIOBUZZ enters `src/sim`.
8. **Playable in three days, complete in two weeks.** Three parallel lanes. A comparable 3D sim
   was built in a day from nothing; DSIM starts with the netcode, accounts, ranked, replays,
   drivetrain model and the BIOBUZZ rules already written.

---

## 1. Goals and non-goals

**Goals.** A 3D FTC BIOBUZZ match where every outcome comes from a 3D rigid-body solve: a 29-in
robot stops under the 25.5-in down cell, a tipped tray dumps its load onto the tiles and it
rolls, a shot through the closed back of a cell bounces off steel, a nectar dropped into a
flower lands on the pollen below it. Reuse everything DSIM already has: server authority,
prediction, snapshots, replays, accounts, Glicko-2, matchmaking, LAN, Electron, mobile touch,
the drivetrain model, the BIOBUZZ rules layer (tip table, points, fouls, HUD, mechanism
vocabulary, presets, start legality). Ship to alpha in days.

**Non-goals for the first ship.** No hive mass model (table stays). No launched element enters a
flower (standing ruling; placement only). No new command bits (the `buttons` byte is full;
deployment is a phase read). No mobile 3D rendering on day one (the 2D renderer over the 3D
world is the fallback, see 4.6). No cosmetics, no robot model files, no WebGPU.

**Ranked is on from the first alpha ship.** `scored: true`, `initialAct: 1`; Glicko-2, boards and
matchmaking are already game-keyed and the alpha app persists into its own database, so a
solve that still needs tuning costs nothing public. The season goes public when the owner
removes `channels: ['alpha']` (question 7).

---

## 2. Architecture

### 2.1 A fourth game

Four registrations per `docs/area/adding-a-game.md`: `GameId` + `GAME_IDS` in `src/games/types.ts`;
`GAMES` in `index.ts` (module static, renderer lazy); a **getter** in `sim.ts` (import cycle);
a `SEASONS` row (`key: 'biobuzz3d'`, name `BIOBUZZ 3D`, presenter RTX, `channels: ['alpha']`,
`initialAct: 1`). Plus `World.biobuzz3d?: Biobuzz3dState`, the `coerceSpec` arm in
`src/sim/spawn.ts` (reuse `coerceBiobuzzSpec` plus `heightIn`), migration `NNNN_lan_runs_biobuzz3d.sql`
widening the CHECK (the `0034` pattern; `records_drivetrain_check` gains `butterfly` in the same
file), and `server/api.ts:578`'s two-valued literal replaced with `coerceGameId`.

Why a new id and not a mode: a different `step()` under `biobuzz` would share one board, one
matchmaking bucket and one replay lineage with the 2D game. A new id separates all three by
construction (every table is keyed by `game`), and the live 2D game is never at risk.

### 2.2 Module layout

```
src/games/biobuzz3d/
  sim.ts, index.ts          registrations (GameSimModule / GameModule)
  config.ts                 3D constants: true hive lengths, cell prism, flower rings, robot heights,
                            physics tuning; imports the 2D game's manual constants, never copies them
  state.ts                  Biobuzz3dState (plain JSON): hives, human stock, deploy latch, spill tags
  physics/
    engine.ts               initPhysics3d() (dynamic import of the wasm), world build/sync/step/readback
    bodies.ts               body + collider specs from World: robots, elements, tray, flowers, frame, walls
    math3.ts                vec3 / quaternion helpers built on dsin/dcos/datan2/hyp
  step.ts                   the tick pipeline (see 3.1)
  robot.ts                  drive wrench → 3D body; intake sensor; muzzle; place point; deploy
  elements.ts               capture / launch / place / spill-tag; hopper (imports the 2D mechs vocabulary)
  hive.ts                   swing timer, tip table, tray angle (imports the 2D hive.ts table and timer)
  flower.ts                 tube geometry, scoring reads (owner = top-most nectar by z)
  score.ts                  Table 10-2 as pure reads of the 3D world
  penalties.ts              G402/G407/G410/G421 ported; G409 first-contact tag
  spawn.ts                  createWorld: staging positions from the 2D spawn, robots seated on the tiles
  settle.ts                 nothing in flight, nothing awake above rest speed, no swing running
  hud.ts                    HUD slice (reuses the 2D HudSlots where the shape matches)
  scene/                    Three.js renderer, every file render*.ts (renderer chunk)
  scenes.ts, Gallery.tsx    deterministic scenes + alpha-only gallery, the BIOBUZZ pattern
scripts/smoke-biobuzz3d/    own suite, third `&&` in `npm test`
scripts/field-cad.mjs       CAD pipeline orchestrator (download, verify, convert, decimate, budget)
scripts/field-cad/convert.py  CadQuery: STEP in; visual mesh, collider meshes, measurements out
public/models/biobuzz3d/    field.glb + field-colliders.json + field-measurements.json (see 8)
```

The 2D game's `mechs.ts`, `mounts.ts`, `presets.ts`, `labels.ts`, `start.ts`, `Builder.tsx`,
`RobotPreview.tsx`, `StartEditor.tsx`, `hive.ts` (table and timer) and `config.ts` (manual numbers)
are **imported**, not copied. Anything that reads `world.balls` positions or the 2D colliders is
reimplemented here against the 3D world.

### 2.3 Shared-core changes

- `src/types.ts`: `RobotState.z?: number` and `vz?: number` (absent reads 0). `pos`/`heading`/`vel`
  stay the 2D projection of the chassis, so every shared consumer (HUD, camera, labels,
  penalties helpers, `worldHash`, the protocol) works unchanged. `Artifact` already carries
  `pos`, `vel`, `z`, `vz`, `r`.
- `src/games/module.ts`: `scene?: () => Promise<GameSceneFactory>` (lazy renderer). Consumed in
  `src/game.ts` as `mod.scene ? <3D renderer> : <2D canvas>`; the 2D path is byte-identical.
- `src/games/types.ts`: the id. `GameSimModule.step` is already the game's own function; the 3D
  step never calls `solveRobots`/`solveArtifacts`.
- `src/net/checksum.ts`: `worldHash` mixes `r.z` when `world.game === 'biobuzz3d'` (stored hashes
  for other games unchanged).
- `src/game.ts`: ball interpolation for this game only (4.4); renderer choice; the physics init
  await before the first 3D step.
- `server/index.ts` and `src/lan/hostWorker.ts`: `await initPhysics3d()` when a `biobuzz3d` room
  is created (lazy, not at boot for the worker).

### 2.4 The physics package and its lifecycle

`@dimforge/rapier3d-deterministic-compat` 0.20.0 in `dependencies` (the server needs it). Wasm
2,048,139 B, about 767 KB gzipped; inlined as base64 in the compat module, about 1.08 MB gzipped.
The deterministic build is chosen up front: replays re-simulate on any machine, the server verifies
practice runs, and client prediction agrees with the server to the bit for the same inputs. Its
cost is speed (a less optimised build); the budget in 3.9 allows for it. The 2D games stay on
`rapier2d-compat` 0.19.3; the two packages coexist.

`physics/engine.ts` loads the module through a **dynamic `import()`** inside `initPhysics3d()` and
keeps it in a module variable; `step()` is synchronous against it. Vite emits the wasm chunk once,
loaded only when a 3D screen mounts (after the 2D physics init), never in the main chunk or the
LAN worker chunk unless a 3D room is hosted. The server awaits it at boot beside `initPhysics()`;
the smoke suite awaits it at the top. If the non-compat package plus a Vite `?url` wasm works in
browser, worker, Node and `tsx` alike, it saves about 300 KB gzipped; try it in the Day 0 spike,
fall back to compat.

Bundle for the `biobuzz3d` route, gzipped: main chunk 903 KB (unchanged, at most +10 KB), physics
chunk about 1.1 MB, renderer chunk at most 250 KB (engine measured 139 KB tree-shaken), game code
about 60 KB. About 2.3 MB total, against a comparable sim's 13 MB. A new `scripts/bundleaudit.mjs`
ratchets per-chunk gzip size like `uiaudit`.

---

## 3. Simulation model

### 3.1 The tick

`step(world, dt, commands)`:

1. Phase machine (shared `src/sim/match.ts`), disabled robots get the zero command.
2. Drivetrain: shared `updateRobot` produces a `DriveWrench` (force, torque) per robot from the
   2D projection; unchanged model, unchanged feel.
3. **Sync**: the persistent Rapier world is reconciled to `world` (3.2).
4. Apply wrenches as 3D forces in the floor plane and torque about the vertical; set the tray's
   next kinematic rotation from the swing timer.
5. `world3d.step()`.
6. **Readback**: every dynamic body writes `pos/z/vel/vz/heading/angVel` back into `world` (plain
   numbers, rounded to 1e-4 in and 1e-4 rad so the JSON is the truth and the readback is stable).
7. Gameplay reads: intake capture, launch, place, hive capture/tip/spill tags, human player nectar,
   flower and garden and cell membership, fouls, score.
8. Containment invariant: any element outside the perimeter or below the tiles is placed back
   inside at rest and logged (a physics escape is a bug; the clamp is the safety net, never the
   design).

Everything in 7 is a pure read of positions plus the existing counters; nothing writes a position
except the solve and the containment clamp (one position authority per body, the repo's rule).

### 3.2 Persistent world and the sync

The server keeps one Rapier world per room for the whole match. Sleeping and warm-starting stay on:
resting spheres cost nearly nothing and do not jitter. Each tick the engine **syncs** world JSON to
bodies: bodies whose JSON changed outside the solve (a capture removed a sphere, a launch added
one, a spill re-emitted one, a reconcile snapped a chassis) are created, removed or teleported; the
rest are left alone. Body handles are keyed by stable ids (`robot.id`, `artifact.id`, named
statics), so creation order is deterministic and the same on every machine.

A fresh world built from the same JSON is not bit-identical to a persisted one (no warm-start
history), so **the persisted world is the authority and JSON is its faithful serialisation**, not
the other way round. Determinism holds where it matters: the server and a replay both start at
tick 0 from the seed and step the same inputs, so they agree bit for bit (deterministic build).
The client's prediction world (3.8) is rebuilt per reconcile and is allowed to differ; server
authority corrects it.

### 3.3 Robots

Dynamic cuboid `length × width × heightIn`, mass `shoveMass`, gravity on, resting on the tile
plane. **Yaw free; pitch and roll locked** (`setEnabledRotations(false, false, true)` in z-up
terms). A driven chassis on a flat floor does not tip in this game, and a robot on its side is
not a BIOBUZZ outcome anyone wants to simulate; locking removes the one contact that jitters
(owner question 3 can unlock it). z translation is free: a robot pressed under a descending tray
is pushed down onto the tiles, not clipped. Drive: `DriveWrench` from the shared model applied as
a force and a yaw torque, plus a strong yaw damping that mirrors the 2D wheel-brake behaviour.
Contact: friction `PHYS_FRICTION` against robots, `PHYS_WALL_FRICTION` against statics, restitution
0. The robot's own solids (chassis, sweeper plates, held elements) come from `bbRobotSolids`
extruded to `heightIn`, the one geometry authority.

`RobotSpec.heightIn` (12 to 29, absent 18) is clamped in `coerceBiobuzzSpec`; `stowHeightIn` (at
most 18) is a builder check. Deployment: a robot is deployed once the match leaves pre-match
(a pure read of `world.match`); the collider is rebuilt at the phase edge. A 29-in build cannot
choose to stay stowed in v1; a toggle needs a wider command field (Phase 2 option).

### 3.4 Elements

56 dynamic spheres (40 pollen r 1.4, 8 + 8 nectar r 1.8), mass `BB_ELEMENT_MASS` (APPROX 0.2 lb
until a set is weighed), gravity 386 in/s², rolling friction and restitution from `BALL_*` as the
starting point, CCD on while `|v| > 60 in/s` so a 260 in/s shot never tunnels through a 1-in
plate. Rotation unlocked (they roll; the renderer spins them from the solver's angular velocity,
which is not serialised: the readback keeps only `pos/z/vel/vz`, and the next sync leaves a
resting body's rotation alone). An element inside a hopper is `held` and removed from the world;
inside the human player's stock, `stock`; everything else, including elements sitting in a cell
or a flower, is a **body** with `state.kind: 'ground'` and a position. The 2D game's
`'element'` (parked in a structure) state is gone: membership in a cell or flower is a read.

### 3.5 Hive

Frame: the two triangular members and the crossbar as **static trimesh colliders from the CAD
pipeline** (8), falling back to compound boxes from the manual's dimensions (base bars x in
[24,25] and [-25,-24], y ±19.4, apex at z 43.95, crossbar along x) when the GLB is absent.
Tray: **one kinematic position-based body per hive**, a compound of **convex hulls per cell part**
from the CAD (floor, back, two sides, roof, open at the outer face; fallback: five 0.25-in APPROX
boxes per cell, 20 × 14 × 12.04) on a 42.91-in bar, pivoted at (±12.75, 0, 43.95) about the
x axis. Convex hulls, not a trimesh, because a kinematic trimesh against 56 dynamic spheres is
the expensive contact case and a cell wall is a slab. Its rotation each tick is
`hiveTiltAngle(tipping)` from the swing timer (+30° settled up, 0 at half swing, -30° settled
down); the solver moves whatever is inside it.

**Tip.** Each tick, count the elements whose centre is inside the up cell's interior volume and at
rest (`|v| < BB_REST_SPEED` for `BB_REST_TICKS`); the table `BB_TIP_POLLEN[min(nectar, 5)]` decides
(`pollen >= needed`). When it fires, the timer starts and the tray swings over 4.0 s (faster with
surplus, as today). **Spill is physics**: as the tray passes level its floor becomes a ramp and
the contents roll out of the open face and fall from about 42 in. No `spillPoses`, no RNG draws,
no re-emission; the spilled elements were bodies the whole time. The TIP scores when the swing
settles (damper contact), as today. Elements that leave the tray during a swing carry a `spilled`
tag (`Biobuzz3dState.spilled: Record<id, robotId | 0>`) until their first non-tray contact; a
robot as first contact writes a G409 verbal event line. Contact detection uses the solver's
contact events for spilled ids only.

**Shots** are real bodies: an element launched at the taking cell enters through the open face at
the true angle or bounces off the roof, back, sides or the frame. A shot from the other alliance
that lands in a cell is inside that cell's volume and counts toward its load: the manual counts
what is in the cell, so the 2D ruling that "the up cell takes only its own alliance's element" is
dropped for 3D (owner question 5 confirms).

### 3.6 Flowers

Four static bodies flush to their walls, **trimesh colliders from the CAD** (the rings' holes and
the retrieval opening come out exact), falling back to a compound of a top ring (4.0-in hole at
21.5), four pipes, a middle ring (hole diameter `BB_FLOWER_MID_HOLE` between 2.8 and 3.6, APPROX
3.2, top face at `BB_FLOWER_MID_Z` APPROX 3.98), a square extrusion with the retrieval opening
(3.55 tall × 3.57 deep) and a lower ring (2.79 hole). A nectar seats on the middle ring; a pollen falls through to
the lower ring, because of the diameters and nothing else. **Scoring reads positions**: elements
with centre inside the cylinder between the middle ring top and the top ring; owner is the
alliance of the top-most nectar by z; bottom nectar bonus to the bottom-most nectar by z. Retrieval
is a robot's intake sensor overlapping the bottom opening: the lowest pollen is captured; nectar
cannot fit (it is seated above the opening). No stack arrays.

Placement: the Box Tube's place action drops a held element at the tube's top with zero velocity
when the place point is within reach of the top ring; it falls and stacks. G410 (nectar into a
flower before 1:00) fires on entry into the scoring cylinder.

### 3.7 Intake, launch, human player, gardens, park, leave

Intake: a sensor collider at each sweeper mouth (`bbMouths` extruded to the roller height);
while `intake` is held and the hopper has room, an element overlapping the sensor for
`BB_CAPTURE_TICKS` (APPROX 3) becomes `held` (G407 hopper cap 4). Launch: `bbTurretSolution` /
`bbDumpSolution` give speed and pitch; the body is spawned at the muzzle (mount cell height plus
mechanism rise, `zIn`) with that velocity and CCD on. Human player: `bbNectar` drops a stock nectar
at the loading-zone spot from 6 in. Gardens, PARK and LEAVE are position reads as today, with the
robot's footprint from its 3D pose.

### 3.8 Prediction and interpolation on the client

The full world is not predicted. On each snapshot the client adopts the server world, then
rebuilds a **prediction world**: statics, the tray at its snapshot angle, every other robot as a
kinematic body at its snapshot pose, the local robot dynamic, and elements within
`PREDICT_ELEMENT_RADIUS` (APPROX 36 in) of the local robot as dynamic bodies. It re-steps the
buffered local inputs (at most 40) in that world. The local chassis feels instant; a push against
an element or a robot is predicted approximately and corrected by the next snapshot; everything
farther away renders from interpolated snapshots. Cost per reconcile: a world of about 15 bodies,
a fraction of the 2D game's full-world re-step.

Elements and remote robots **are interpolated** in this game (the 2D game does not lerp balls):
ids are stable, count is conserved, and a sphere lerped between two 30 Hz poses reads smoothly at
any frame rate. A kind change (captured, launched, spilled) snaps. `snapBuf` gains per-ball
`x, y, z` and per-robot `z` for this game only.

### 3.9 Budgets

| quantity | budget | today (2D BIOBUZZ) |
|---|---|---|
| server 2v2 `step()` | ≤ 1.5 ms on the dev box, persistent world | 0.37 ms |
| cores per driven room | ≤ 0.10 | 0.032 (2v2), 0.075 DECODE planning figure |
| bytes per snapshot, 2v2 | ≤ 10,000 raw (elements already carry z/vz; robots add z/vz) | 7,670 |
| client reconcile, 40 ticks, prediction world | ≤ 8 ms on a 2023 mid-range phone | n/a |
| elements at rest after a spill | within `MATCH_SETTLE_S` 2.8 s | n/a |

All measured by `costprobe` (new scenarios with a primed tip), the smoke perf lane (paired ratio
against a CR 2v2), and `?perf=1`. If cores per room exceed 0.10 the lever is `worker_threads`
(`docs/scaling-multicore.md`), never a bigger VM.

### 3.10 Determinism

Deterministic wasm build, same version on server and client, bodies created in id order, all
math through `dsin/dcos/datan2/hyp` and the seeded PRNG (the source guard in `scripts/smoke.ts`
scans `src/games/biobuzz3d/` automatically; renderer files are named `render*`). A replay is
`{seed, setups, commands}` and re-simulates from a fresh world at tick 0, bit-identical to the
server's run. Two-run hash checks on every scene, plus a Node-versus-Chromium hash of one scene
in the gallery (the LAN host runs the same wasm in a worker).

---

## 4. Rendering

### 4.1 Engine and chunk

Three.js 0.186.0, `WebGLRenderer`, WebGL2 only, `three` and `@types/three` in `devDependencies`,
imported by exactly one file (`scene/renderLoad.ts`) behind the `scene` slot's dynamic import.
No post-processing; HDRIs only as on-demand environments (4.2b). **The field, frame, tray and
flowers are the CAD-derived GLB**
(decimated, instanced, meshopt-compressed, budget 600 KB brotli; loaded with `GLTFLoader` and the
7.7 KB meshopt decoder), the same source the colliders come from, so the picture and the physics
agree by construction. Robots and elements are generated from the spec and the constants. When
the GLB is absent (fallback build, or before permission to serve it), the field is generated from
the constants too. Budget 250 KB gzipped for the renderer chunk, excluding the GLB.

### 4.2 Scene

Tiles and tape (unlit, the on-field tokens), walls, frame and crossbar, two tray groups rotated
by `hiveTiltAngle`, four flower cages, 56 instanced spheres (two `InstancedMesh`) posed from the
interpolated world and spun from velocity, robots as generated meshes (chassis box at
`heightIn`, drivetrain from `moduleAngles` and velocity, mechanisms from `bbMech`/mounts, alliance
sign panels), a reticle at the solved landing point. One directional light with a 1024 shadow map
on the high tier, hemisphere fill, a themed surround (`COLORS.backdrop`/`backdropDark`). Draw calls
under 120.

### 4.2b Environments (scene changer)

A per-device pick in `localStorage['decodesim.env']`: the default **procedural room** (0 bytes,
themed surround, three lights) plus a short list of **CC0 HDRIs from a public library** (a gym,
a hall, an outdoor field, a night set), each fetched on demand as a 1k `.hdr` (about 1 to 2 MB),
run once through `PMREMGenerator`, cached by the browser, never in any chunk. Attribution on the
Contributors page, per the CC0 courtesy line. The HDRI lights the robots and the field mesh; the
tiles and tape keep their fixed on-field colours so the HUD contrast pairs hold. Selectable from
the in-match VIEW menu and Audio and Visual. Day 3 for the picker with two sets; more sets are a
data change. Low tier keeps the procedural room.

### 4.3 Cameras

Client-only, in `localStorage['decodesim.view']`. **Driver station** (default): eye 12 in behind
the alliance wall centre, height 62 in (44 to 72), FOV 70, yaw fixed to `viewAngleOf(alliance)`
so field-centric sticks match the view, optional soft look-at-robot. **Overhead** (orthographic,
the 2D fit; phone default). **Chase** (60 in back, 40 up, robot-centric). **Orbit** (spectators,
replays, gallery). Cycle key `t`, eye height `i`/`o`, pad R3; a `view` key in `MobileLayout`.

### 4.4 Frame composition

WebGL canvas under the existing 2D canvas, which becomes a transparent overlay drawing labels
(projected through the scene camera), auto paths and the replay burn-in. The HUD stays React at
10 Hz through the existing slots with a fixed dark scrim behind the bands. Video export draws the
WebGL frame onto the offscreen export canvas before the burn-in; the `MediaRecorder` fallback
captures a composited canvas.

### 4.5 Renderer chunk failure

WebGL2 probe on a throwaway canvas; on failure, on context loss without restore, or on a rejected
`import()` (a stale build after a redeploy), the client uses the 2D renderer over the 3D world
(4.6) and writes one event-log line. A rejected import also triggers the stale-build reload prompt.

### 4.6 The 2D renderer over the 3D world

The 2D BIOBUZZ renderers read `world.balls` and robot poses; a `biobuzz3d` world has both. The
game's `drawField`/`drawRobot`/`drawBalls` slots point at the 2D renderers with a thin adapter
(cell contents drawn from the membership read instead of a stack). This is the phone path on day
one and the fallback everywhere: the same authoritative match, top-down.

---

## 5. Controls, HUD, workshop

**Controls:** unchanged bindings; `bbPlace`/`bbPlaceNectar`/`bbNectar` keep their bits; view keys
are client-only and never reach the sim. **HUD:** the 2D game's chips (controlled n/4, mechanism,
alliance hive card, feed nectar) plus, behind a Telemetry toggle, speed, turret yaw/pitch, shot
solution, fired/landed. **Workshop:** the 2D `Builder` and `Preview` slots plus a height dial
(`heightIn`), a stowed height, per-mechanism `zIn`, the 18-in cube check in the stowed pose and
the 18 × 24 × 29 check deployed, with the offending part named. The three presets carry heights.
`MAX_SAVED_ROBOTS` rises 3 to 4. The 3D `Preview` (orbiting generated robot through one shared
offscreen renderer) is Phase 2.

---

## 6. Netcode, replay, server

- **Wire:** `RobotState.z/vz` are the only new per-tick robot fields (about 36 B raw per field per
  robot per snapshot by `costprobe`'s method). Elements already ship `z/vz`. `Biobuzz3dState` is
  small (hive timers, stock, spill tags, deploy latch). Priced by new `costprobe` scenarios.
- **Caps:** none needed. An older client cannot select a game it does not know; an unknown id falls
  back to DECODE in both registries, and the season row is alpha-only.
- **Replays:** `game: 'biobuzz3d'`, `REPLAY_FORMAT` unchanged (no new command bits). The container
  is exact under the deterministic build.
- **Server:** `simModuleFor('biobuzz3d')` in the room, `await initPhysics3d()` at boot,
  `persistMatch` keyed by game, `ensureSeason` at Act 1, `records_drivetrain_check` widened. Deploy
  the alpha app after each server change; production from a `main` worktree only, via the wrapper.
- **LAN:** the host worker imports the 3D physics lazily when it hosts a 3D room.

---

## 7. Verification

`scripts/smoke-biobuzz3d/` (own process, `check()` contract, lanes CORE/PHYSICS/HIVE/FLOWER/ROBOT/
RULES/SERVER/PERF), chained as the third `&&` in `npm test`; whole `npm test` at most 55 s.

| lane | checks |
|---|---|
| CORE | four registrations; `import` of the 3D wasm only in `physics/engine.ts`; `three` only in `renderLoad.ts`; renderer files named `render*`; no `Math.random`/clock |
| PHYSICS | two-run hash on every scene; Node-vs-worker hash on one scene; 56 conserved every tick; no element outside the perimeter or below the tiles; a sphere at rest stays at rest 600 ticks (no jitter); a 260 in/s shot does not tunnel a 0.25-in plate |
| HIVE | tray angle matches manual heights at ±30°; a shot through the open face is captured, through each closed face bounces; table rows tip at 8/0 and 3/3 and not at 7/0; a swing empties the tray and every element lands within 1.0 s; G409 tag correct with and without a robot under |
| FLOWER | pollen falls through the middle ring, nectar seats; owner and bottom bonus by z; retrieval pops the lowest pollen only; G410 fires on entry |
| ROBOT | 18-in passes under the down cell, 29-in stops; drive feel ratio against the 2D game within 5 percent (top speed, 0-to-95 time); muzzle height per preset; every preset renders from spec |
| RULES | Table 10-2 totals on hand-built worlds; LEAVE/PARK latches; G402/G407/G410/G421 |
| SERVER | a real `Room` hosts a 2v2 with a primed tip; snapshot round-trip; replay re-simulates hash-equal |
| PERF | paired ratio against a CR 2v2; step ≤ 1.5 ms; prediction-world reconcile time |

Gallery: `/biobuzz3d/gallery/*` (alpha-only) draws every scene through one WebGL context; the shot
runner gets a software-GL flag; pixels are read by a human. `bundleaudit`, `costprobe`, `contrast`
stay outside `npm test`.

---

## 8. Build plan: days, three lanes

Lanes run as three Claude sessions from three worktrees off `biobuzz-3d`, merging into it daily.
**Lane A sim** owns `physics/`, `step.ts`, `robot.ts`, `elements.ts`, `hive.ts`, `flower.ts`,
`score.ts`, `penalties.ts`, `spawn.ts`, `settle.ts`, `config.ts`, `state.ts`. **Lane B renderer**
owns `scene/`, cameras, the canvas stack, `GameView`/`ReplayView` wiring, the gallery. **Lane C
integration** owns the four registrations, `src/types.ts`, `src/game.ts`, server and worker init,
the migration, `bundleaudit`, `costprobe`, the smoke suite skeleton, HANDOFF.

**Day 0 (half a day, lane A + C).** Install the deterministic 3D package; `initPhysics3d()` via
dynamic import works in browser, worker, Node and `tsx`; a throwaway scene of 4 boxes, 56 spheres,
statics and one kinematic tray steps 3,600 ticks with a two-run hash match and a measured step
time. Try the non-compat package with a `?url` wasm. *Gate:* hash equal; step under 1.5 ms 2v2.
If the step is over budget, sleeping and CCD settings are tuned before anything else is built.

**Day 1 (all lanes).** A: field statics from the CAD collider file (constants fallback), robots
driving with the shared drivetrain wrench, elements staged from the 2D spawn, intake and launch,
containment clamp, readback. B: renderer chunk, the CAD field GLB (constants fallback), elements
and robots generated, driver-station and overhead cameras, the 2D-over-3D fallback. C: the CAD
pipeline run end to end (Day 0 evening if the Python toolchain installs cleanly), registrations,
`World.biobuzz3d`, `RobotState.z/vz`, `scene` slot, `game.ts` renderer choice, smoke skeleton,
`bundleaudit`, and the permission request to FIRST. *End of day:* solo free drive in 3D on `alpha`'s dev server,
robots push elements around, shots fly and bounce.

**Day 2.** A: tray kinematics with the swing timer, tip table read, spill from physics, flower
cages with ring sorting, scoring reads, gardens/park/leave, human player, settle. B: tray and flower
meshes, reticle, HUD scrim, chase and orbit, interpolation of balls and remotes. C: server init,
room hosting a 2v2, `costprobe` scenarios, migration, replay re-sim check. *End of day:* a full
scored 2v2 online on `dsim-alpha`, replays play back.

**Day 3.** A: penalties, G409 tags, deploy read, heights in coercion, perf tuning. B: labels,
export compositing, gallery, mobile overhead default, the environment picker with two HDRI sets.
C: smoke lanes filled, `npm test` green, ranked queue live on the alpha app, HANDOFF, docs
sections. *Ship to alpha:* playable, scored, ranked, replayable 3D BIOBUZZ.

**Days 4 to 14.** Play-test with the owner daily; tune friction, restitution, element mass,
capture ticks, camera; workshop heights and 3D preview; weigh a real element set and run the field
CAD measurement script (below); decide ranked and the public channel. Every tuning change goes
through a gallery scene and a smoke check the same day.

**Field CAD: direct import.** FIRST publishes the field as a STEP zip and an Onshape document
(`ftc-resources.firstinspires.org/ftc/archive/2027/field`, STEP v26-27.2 of 2026-09-15, plus a
separate FLOWER scoring-volume document). The manual calls this CAD the official representation
of the field. It is imported directly, offline, by `scripts/field-cad.mjs`:

1. Download the pinned zip and verify a committed sha256 (a silent FIRST revision fails loudly).
2. `scripts/field-cad/convert.py` (CadQuery/OCP, headless Python with Windows wheels) reads the
   STEP, walks the named bodies, and writes three things in inches, field frame: a visual mesh per
   part, a collider mesh per part (a trimesh for every static part; one convex hull per tray cell
   wall and per bar), and `field-measurements.json` (bounding boxes and the derived numbers: cell
   section, middle-ring height and hole, wall height, frame profile, pivot height).
3. `gltf-transform` welds, quantizes, simplifies and instances the repeats (four flowers, two
   hives, six by six tiles); `gltfpack` applies meshopt. Output `field.glb` under 600 KB brotli,
   `field-colliders.json` under 200 KB (indexed triangles, decimated harder than the visual mesh),
   the measurements file. Over budget, the script fails and names the heaviest part.

At runtime the physics bridge builds static `trimesh` colliders and the tray's convex hulls from
`field-colliders.json`, and the renderer loads `field.glb`; when either file is absent, both fall
back to the constants-built geometry, so the game runs either way and a smoke check asserts the
two collider sets agree within 0.5 in at twelve probe points. The measurements file settles the
APPROX constants and is asserted against `config.ts`. An in-browser STEP importer (about 10 MB of
wasm) is excluded; the import happens in the pipeline, once per CAD version.

**Licence.** FIRST's website terms of use grant the content for personal, non-commercial use and
forbid redistribution without written permission; whether a decimated derived mesh in a public
repo and on the site is covered is unresolved. Owner question 10: the default is to ask FIRST on
Day 0 and keep the GLB and collider file local (gitignored under `public/models/biobuzz3d/`,
loaded from disk in dev) until they answer; the constants-built fallback is what ships to alpha in
the meantime. The owner may decide to commit and serve them earlier; the pipeline and the loader
are the same either way.

---

## 9. Risks and kill criteria

| risk | mitigation | kill |
|---|---|---|
| Step cost over budget with 56 live spheres | persistent world with sleeping; hopper/stock bodies removed; CCD only when fast | Day 0 step over 3 ms after tuning: reduce to elements-near-robots dynamic, far elements frozen kinematic between contacts |
| Deterministic build too slow | it is the same solver with pinned math; measured Day 0 | over 2× the default build: default build on the server and client with drift accepted for prediction, deterministic only for replay verification |
| Prediction corrections feel like rubber-banding when pushing elements | prediction world includes nearby elements; smoothing offset as today | visible snaps in play-testing: widen `PREDICT_ELEMENT_RADIUS`, then predict remote robots' held inputs |
| Elements escape the field or settle outside 2.8 s | containment clamp; rest-speed park; settle reads awake bodies | a settle over 6 s in a scene: raise damping, mark the constant APPROX |
| Tray pushes a robot into the floor | z free, robot slides out; eviction if wedged 0.5 s | a robot stuck under the tray in play-testing: kinematic tray gets a robot-exclusion collision group and the robot is evicted outboard |
| Bundle route 2.3 MB gz | lazy chunks; non-compat wasm if it works | none; 6× under the comparable sim |
| Two Rapier versions in one repo | different packages, different import paths | none |
| CAD trimesh colliders make sphere contacts expensive or noisy | statics only as trimesh; the tray as convex hulls; colliders decimated harder than the visual mesh; measured Day 1 | step over budget with the CAD colliders: constants-built boxes for physics, CAD for the picture only |
| CAD licence | ask FIRST Day 0; local-only until answered; constants fallback ships | none; the fallback is complete |
| Determinism across Node/Chromium | deterministic build; hash check in the suite | a mismatch: the vendor's claim is wrong for this build; server authority still holds, replays verify server-side only |

**What kills this design:** nothing short of the solver failing its own promise (a resting sphere
that will not rest, or a hash that differs across runtimes on the deterministic build). Both are
measured on Day 0 before anything else is written.

---

## 10. Owner questions

| # | question | needed by |
|---|---|---|
| 1 | New game id `biobuzz3d` alongside the 2D game (assumed), or replace the 2D BIOBUZZ outright? | Day 0 |
| 2 | Deterministic build on the server and client (assumed), accepting its speed cost, or default build with replay verification server-side only? | Day 0 |
| 3 | Robots yaw-only (assumed) or free to pitch and roll? | Day 1 |
| 4 | Tray kinematic with the table trigger (assumed) or a dynamic see-saw with calibrated ballast (needs a weighed element set)? | Day 2 |
| 5 | An opponent's shot landing in your up cell counts toward its load (physical reading, assumed), or is rejected as the 2D game rules? | Day 2 |
| 6 | Mobile: 2D renderer over the 3D world on phones for the first ship (assumed), 3D later? | Day 3 |
| 7 | Ranked is on from the first alpha ship (assumed; alpha persists to its own database). When does the season go public: after the two play-test weeks, or earlier? | Day 14 |
| 8 | Weigh an element set and run the CAD measurement script; otherwise mass and the cell section stay APPROX. | Day 4 |
| 9 | Merge `efficiency-audit` into `alpha` before Day 1, so the guides, `docaudit` and the sharded suite exist on the working base (assumed yes). | Day 0 |
| 10 | Commit and serve the CAD-derived `field.glb` and collider file now, or keep them local until FIRST grants permission (assumed: ask FIRST Day 0, local until then, constants fallback ships)? | Day 0 |

---

## 11. Appendix

### 11.1 New constants (APPROX unless a manual cite is given)

| constant | value | source |
|---|---|---|
| `BB3_HIVE_PIVOT_Z` | 43.95 in | manual |
| `BB3_HIVE_ARM`, `BB3_HIVE_CELL_LEN`, `BB3_HIVE_LEN` | 15.44, 12.04, 42.91 in | manual (true lengths) |
| `BB3_HIVE_CELL` | 20 × 14 × 12.04 in, open outer face | manual + owner ruling |
| `BB3_HIVE_CELL_WALL` | 0.25 in | APPROX, CAD settles |
| `BB3_HIVE_TILT` | 30° | manual |
| `BB3_FRAME_APEX_Z`, base bars, crossbar | 43.95; x in [24,25]; along x | manual |
| `BB3_FLOWER_TOP_Z`, top hole | 21.5 in, 4.0 in | manual |
| `BB3_FLOWER_MID_Z`, mid hole | 3.98 in, 3.2 in | APPROX, CAD settles |
| `BB3_FLOWER_LOW_HOLE`, retrieval opening | 2.79 in; 3.55 × 3.57 in | manual |
| `BB3_ELEMENT_MASS` | 0.2 lb | APPROX, weigh a set |
| `BB3_ELEMENT_FRICTION`, `_RESTITUTION`, `_ROLL_DAMP` | 0.6, 0.45, 0.4 | APPROX, tuned Day 4+ |
| `BB3_CCD_SPEED` | 60 in/s | APPROX |
| `BB3_REST_SPEED`, `BB3_REST_TICKS` | 2 in/s, 6 | APPROX |
| `BB3_CAPTURE_TICKS` | 3 | APPROX |
| `BB3_HEIGHT_MIN/DEFAULT/MAX` | 12 / 18 / 29 in | rules |
| `BB3_MECH_Z` turret/dumper/tube | 14 / 12 / 10 in | APPROX |
| `PREDICT_ELEMENT_RADIUS` | 36 in | APPROX |
| `BB3_EYE_DEFAULT/MIN/MAX`, `BB3_DRIVER_SETBACK`, `BB3_CAM_FOV` | 62/44/72 in, 12 in, 70° | APPROX |
| budgets | step 1.5 ms; cores/room 0.10; snapshot 10,000 B; reconcile 8 ms; renderer 250 KB gz; main +10 KB gz | this document |

### 11.2 Shared files touched

`src/games/types.ts` (id), `index.ts`, `sim.ts`, `module.ts` (`scene`), `src/seasons.ts`,
`src/types.ts` (`World.biobuzz3d`, `RobotState.z/vz`), `src/sim/spawn.ts` (coerce arm),
`src/net/checksum.ts` (z for this game), `src/game.ts` (renderer choice, ball interpolation for
this game, physics init), `src/ui/GameView.tsx` (canvas stack), `src/ui/ReplayView.tsx`,
`server/index.ts`, `server/api.ts:578`, `src/lan/hostWorker.ts`, `scripts/costprobe.ts`,
`package.json`, one migration, `CLAUDE.md` game table row and the client-bundle sentence
(amended to allow per-game lazy chunks budgeted by `bundleaudit`), `docs/area/biobuzz.md` or a
new `docs/area/biobuzz3d.md` once the split is on the base.
