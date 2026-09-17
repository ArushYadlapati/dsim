# BIOBUZZ 3D in DSIM: full specification

## 0. Status

**FINAL DRAFT, 2026-09-17, branch `biobuzz-3d`, committed at `docs/biobuzz/plan-3d.md`. Line references are as of `efficiency-audit` `e0ce598`.**

Planning document. No code has been written against it. Every APPROX number carries its derivation; every MEASURE number names the script or spike that settles it.

**Branch note.** The CLAUDE.md split (`docs/area/*.md`), `scripts/docaudit.mjs`, the sharded `npm test` (39 s), and migration `0037` exist only on `efficiency-audit`: 14 commits ahead of `alpha`, and `alpha` carries 6 commits `efficiency-audit` does not, so landing it is a real merge, not a fast-forward. Every guide path, byte figure, and migration number here assumes `efficiency-audit` merges into `alpha` before Phase 0 (owner question 0). Until then, `alpha`/`main` carry the unsplit 171,394-byte CLAUDE.md and end at migration `0036`.

Decisions, one line each:

1. 3D BIOBUZZ is a **render mode of the existing `biobuzz` GameId**: same `step()`, boards, ranked pool, replays.
2. **Rapier 2D stays authoritative** for chassis x/y and ground elements. No rapier3d, no second wasm; 3D adds one height-banded collision group.
3. Everything above the floor is a **game-owned elements layer** in `src/games/biobuzz/`: spec height, a tray tested in its own tilted frame, spill as a fall from the level tray's lip (about 42.6 in), decks that always shed, real muzzle heights.
4. The renderer is **`three` r186 (`WebGLRenderer`, WebGL2 only), lazily loaded**: budget 250 KB gz (engine measured 139 KB gz tree-shaken), 0 model bytes in v1. `three` and `@types/three` (type-only, 0 bundle bytes) join `devDependencies`. DECODE/CR's main chunk grows at most 10 KB gz.
5. **Zero new per-tick `RobotState` fields.** Height is spec; tray angle derives from `tipping`; element height is `Artifact.z`. Acceptance: `costprobe` raw B/snap and wire KiB/s both within 3 percent of the day's `biobuzz-2v2` baseline, primed tip.
6. **SIM_VERSION stays HOLD at 2** through Phase 3 and promotion, per the owner's standing rule against season resets. Every `step()`-changing commit lands behind `rules >= 1`, checked against a rules-0 golden hash, so the residual re-simulation risk is zero by construction. A bump to 3 is an optional owner decision with a stated cost, never a default.
7. A **`world.biobuzz.rules` key** (absent reads 0) tells a client and a replay which rule set applies, so prediction never fights reconcile across mixed versions.
8. **AI drivers** are a DOM-free policy behind a `GameSimModule.bot` slot, memory owned by `Room`/`GameController`, never the `World`; recorded in replays, never rated. **Batch simulation** runs inside the LAN `hostWorker` and posts only to `practice_runs`.
9. The **workshop** is the existing `bbMech`/mount vocabulary plus height dials, per-mechanism stowed state, and the size/volume check; no free-form part hierarchy in v1.
10. Every budget is enforced by a named script: `bundleaudit.mjs` (new), `costprobe` (new `prime` hook), `?perf=1`, `npm run test:ai` (new), the biobuzz smoke footer time, scene hashes, and the rules-0 golden hash.

Where the review split, the resolution is inline as **Decision**.

---

## 1. Goals and non-goals

### Goals

**Better than the comparable 3D sim where it matters, parity elsewhere, deliberately narrower in one place.**

| comparable advertises | DSIM v1 position | where |
|---|---|---|
| driver-station camera with eye height, other views | **better**: four cameras, pitch solved from the field, seat offset, FOV slider, reduced-motion mode, PiP minimap | 4.7, 11.5 |
| robot-centric vs field-centric drive | **parity**, already server-side | 5.2 |
| three robot presets | **parity** (turret, twin turret + lift, dumper), all simulated | 6.6 |
| free-placement workshop, up to 24 cosmetic parts | **deliberately narrower**: mount cells + `zIn`, no free placement, no cosmetic parts. Every part in DSIM is simulated; an unmodelled part would be a lie in the box check and on the field | 6.1, 6.2 |
| 18-in starting-box check with stow/deploy | **better**: per-mechanism stowed state, refusal names the part, deployed-envelope check too | 6.3, 6.4 |
| ball-routing validity | **parity** over the sim's own transfer geometry | 6.5 |
| 4 cloud slots | **parity**, `MAX_SAVED_ROBOTS` raised 3 to 4 | 6.6 |
| copy a robot from a top run | **parity** (`setups[i].spec` already stored) | 6.6 |
| AI drivers, tiers and sliders | **parity**, deterministic, recorded, replayable | 7 |
| AI-vs-AI batch, JSON export | **parity**, plus a `practice_runs` post | 7.5 |
| online lobbies up to 4 | **better**: server-authoritative rooms across regions, ranked, matchmaking, LAN | existing |
| HUD chip set | **parity**, tiered so the always-on set stays legible | 5.4 |
| leaderboard of client-reported runs | **better**: server-computed records, Glicko-2 ranked, `practice_runs` for self-reported | existing |
| cosmetics | **later** (Phase 7 `bbTrim[]`, "not simulated") | 12 |
| progression | **parity by mapping**: career panel, ranked standing, supporter badges | existing |
| selectable environments, model imports | **not in v1** (procedural room, 0 model bytes); a CAD field preview and cosmetic robot import are Phase 7 | 4.12 |
| sound toggle | **better**: synthesized SFX panned from the driver's eye (Phase 5) | 4.9 |
| about 13 MB of scene JS | **better**: 3D chunk under 250 KB gz; whole route about 1.15 MB gz | 4.1 |

**Reuse every DSIM system**: netcode, reconcile, replays, accounts, Glicko-2, matchmaking, `practice_runs`, LAN host worker, Electron shell, mobile touch, the UI standard and its audits, the sharded suite, the gallery and shot runner. Nothing is forked.

**Rule truth the 2D encoding flattens becomes enforceable**: a 29-in robot cannot pass under the 25.5-in down cell; a spilled element falls from the tray lip with a known first contact (G409); shots meet the tray at its true 30-degree angle, pass under the raised lip, and are blocked by the closed back and sides; a shot into the exterior of the opponent's tipping cell is recorded (G417); release height is the mechanism's own height, not a flat 10 in.

**One geometry authority.** The mesh the renderer draws is built from the constants the sim tests (`config.ts`, `mechs.ts`, `mounts.ts`, `robot.ts`, `hive.ts`). A constant change moves both. The tray angle has one sim-side definition (`hiveTiltAngle`, 3.4) the renderer reads, never the reverse.

**Nothing BIOBUZZ-specific lands in `src/sim/` or `src/config.ts`.** The shared core gains only the generic seams in 2.4, landed as one additive commit.

### Non-goals

No 3D physics engine: robots do not pitch, roll, or leave the tiles; the hive cannot be moved; elements never rest on decks. No mass model for the hive: the tip decision stays the table and the swing (nominal 4.0 s, up to 3x faster with surplus). No launched element enters a FLOWER (standing owner ruling); flower scoring stays proximity placement. No new `RobotCommand` bits (the `buttons` byte is full). No HDRI, model files, or third-party scripts in v1: a procedural room. No WebGPU: WebGL2 is the floor and ceiling. No fourth season row, no new-GameId migration, no `BALANCE_VERSION` change. No bots in matchmade rooms: solo, code lobbies, and LAN only.

---

## 2. Architecture

### 2.1 Registration: a render mode of `biobuzz`

**Decision: same GameId.** A fourth GameId, and a full 3D engine under its own id, were both considered and rejected.

- The room builds its world with `simModuleFor(this.game).createWorld` and steps with `.step`; the matchmaker buckets on `game|channel|build`; every board is keyed by `game`. A render mode costs zero server change.
- A new id costs four registrations, a migration, a fifth arm in roughly 76 hand-written game-id branches, a `SEASONS` row, and a parameterised `createBiobuzzWorld`: a split ranked population before there is one.
- Height, spill, and tray are BIOBUZZ rules. Making them depend on the camera would say the rules change with the view; they land for 2D and 3D players alike.

| system | effect |
|---|---|
| boards, periods, records | unchanged, one population |
| matchmaking | unchanged; 2D and 3D pair on the same build sha |
| replays | input logs, so 3D playback is a view over the same log; SIM_VERSION marks pre-Phase-3 replays `drift`, still playable; `rules` lets the viewer re-simulate under the recorded rules (8.5) |
| ranked fairness | unknown; measured from the first alpha build by a `view_mode` column and a `match_end` event, both in Phase 0 |
| fallback | if the data says the pools must split, a later `biobuzz3d` GameId spreads `BIOBUZZ_SIM` under a new id |

The view preference is **device-bound**, `localStorage['decodesim.view']` beside the theme key, never in `GameSettings`. GPU capability, quality tier, eye height, and FOV belong to the machine. The touch `view` button's position is layout, in `MobileLayout` like any other button (5.5).

### 2.2 Module layout

Shared, client-only renderer, governed by `docs/area/ui.md`:

```
src/render/
  fieldRenderer.ts     FieldRenderer interface + Renderer2DAdapter (imports NO three)
  labels.ts            drawLabels(ctx, world, project, localId): shared by 2D and 3D
  webgl2Probe.ts       throwaway-canvas WebGL2 probe (imports NO three)
  three/
    load.ts            the single dynamic import() entry; the ONLY file that imports 'three'
    renderer3d.ts      WebGL canvas, scene root, frame loop, context-loss handling
    camera3d.ts        camera modes, eye height, pitch solve, follow, projection (DOM-free)
    robotMesh.ts       chassis + drivetrain meshes from RobotSpec
    theme3d.ts         reads data-theme per frame; surround colours; on-field tokens
    quality.ts         tier selection, warm-up p95
    previewPool.ts     shared offscreen WebGLRenderer for builder/strategy previews (6.2)
```

`interp.ts` lives at `src/net/interp.ts` (netcode), imported statically by `src/game.ts` (2.4.4). Nothing under `src/render/three/` may be imported statically from outside it (4.2).

Game-owned scene builders, every file named `render*` or `.tsx`:

```
src/games/biobuzz/scene/
  renderScene.ts       GameScene factory: mount/sync/setCamera/project/dispose
  renderField.ts       tiles, walls, tape, frame triangles + crossbar, merged geometry
  renderHive.ts        pivot group, two closed cell prisms open at the outer face
  renderFlower.ts      cage: rings, pipes, extrusion, contents
  renderElements.ts    two InstancedMesh (pollen, nectar)
  renderRobotBb.ts     mechanism sub-groups (turret, dumper, tube, sweepers, signs)
  renderOverlay.ts     reticle, taking-cell mouth outline
```

Game-owned sim additions (DOM-free, guard-bound, plain JSON):

```
src/games/biobuzz/
  tray.ts              tilted-frame accept/deflect + frame/crossbar flight contacts
  height.ts            deployed/stowed reads, volume checks, dynamic() footprint
  deck.ts              flight element vs robot top (always sheds)
  ai/policy.ts         deterministic driver policy (7)
  ai/tiers.ts          difficulty tiers and sliders
  batch.ts             batch runner (clock-free; caller paces)
```

The `tipping -> angle` mapping moves from `drawField.ts` into `hive.ts` as `hiveTiltAngle(tipping)`; the renderer's `tipProjection` and `tray.ts` both read it. A CORE check asserts no file under `src/games/biobuzz/` outside `draw*`/`render*`/`scene/` imports a `draw*`/`render*` module.

### 2.3 The seam

Additive only; DECODE and Chain Reaction stay byte-identical.

`src/games/module.ts`:

```ts
scene?: () => Promise<GameSceneFactory>;   // absent: no 3D view, 2D path runs

export interface GameSceneFactory {
  create(canvas: HTMLCanvasElement, bounds: FieldBounds, alliance: Alliance): GameScene;
}
export interface GameScene {
  sync(predicted: World, display: World, localId: number, cmd: RobotCommand | null): void;
  setCamera(mode: CameraMode, opts: CameraOpts): void;
  resize(w: number, h: number, dpr: number): void;
  project(x: number, y: number, z: number): { sx: number; sy: number; visible: boolean };
  captureFrame(): CanvasImageSource;   // video export compositing
  dispose(): void;
}
```

`src/games/types.ts` (DOM-free, server-safe):

```ts
export interface StaticSpec {
  hx: number; hy: number; tx: number; ty: number; rot: number;
  zLo?: number;   // solid only to a chassis whose height exceeds this. Absent: solid to all.
}

export interface FieldColliders {
  // ... existing statics()/dynamic()/bounds
  /** Optional per-robot height in inches. Absent: this game's robots are never "tall";
   *  src/sim never names heightIn or any other BIOBUZZ field, only this generic slot. */
  robotHeight?(spec: RobotSpec): number | undefined;
}

export interface GameSimModule {
  // ...
  /** Optional AI driver for an empty seat. Memory owned by the caller, never the World.
   *  Absent (DECODE, CR): no bots offered. */
  bot?: {
    init(matchSeed: number, seat: number, tier: string): BotState;
    command(world: World, seat: number, state: BotState): RobotCommand;
  };
}
```

`FieldColliders` is already threaded into `solveRobots` as the `colliders` parameter (a type-only import), so `robotHeight` reaches the shared solver the way `dynamic()` already does, no new import from `src/sim/`. An earlier draft had `solveRobots` compare `spec.heightIn` against `zLo` directly, naming a BIOBUZZ field inside shared physics; this generic slot fixes that.

`src/render/fieldRenderer.ts` (no `three`):

```ts
export interface FieldRenderer {
  configure(canvas: HTMLCanvasElement, alliance: Alliance, bounds: FieldBounds): void;
  render(predicted: World, display: World, cmd: RobotCommand | null, localId: number): void;
  dispose(): void;
}
```

Widened from one `world` argument to `(predicted, display, ...)`: `GameScene.sync` needs both, and the 2D adapter and the replay viewer (8.5) call the same interface. The existing 2D `Renderer` exposes `camera` and `render(ctx, world, cmd, localId)` only, so a thin `Renderer2DAdapter` wraps it, owning the `2d` context and passing `predicted` through unchanged. `GameController` stops opening a `2d` context in its constructor and picks `Renderer3D` when `mod.scene && view.mode !== '2d' && webgl2Available()`, the adapter otherwise.

`src/types.ts`, the only shared-type additions:

```ts
export interface RobotSpec {
  heightIn?: number;      // deployed height, in. Absent 18. Clamped [12, 29].
  stowHeightIn?: number;  // stowed height for the start check. Absent min(heightIn, 18).
}
// BallState.flight gains: spilled?: true
// Artifact gains: hit?: number   // G409: first robot a spilled element touched
```

`BiobuzzState` gains `rules?: number`. `bots` is NOT world state (7.4).

`heightIn`, `stowHeightIn`, and `bbMech[].zIn` are BIOBUZZ-only spec fields; a field-by-field rebuild in the shared spawn path would drop them before the game coercer runs. **The carry-across is the one legitimate shared touch:** in the `biobuzz` arm of `src/sim/spawn.ts`, copy `heightIn`/`stowHeightIn` onto `out` unvalidated; `zIn` rides inside `bbMech`, already carried. The clamp lives in `coerceBiobuzzSpec`, never `src/sim/`. These fields, plus `zInStowed`, `folded`, `retracted` (3.5), are registered in `docs/biobuzz-contract.md` section 4. A HEIGHT check round-trips `heightIn: 29` through every sanitizer and `createWorld`.

`src/sim/penalties.ts`: `PinSolid` gains an optional second argument, the pinned `RobotState`: `type PinSolid = (p: Vec2, pinned?: RobotState) => boolean`. The call site becomes `solid(p, pinned)`. The shared core never reads `spec.heightIn`; `bbPinSolid` reads it itself.

### 2.4 Shared-core generalisations

Each is a seam any game could use. All land together as the **seam commit** (Phase 0), gated on DECODE/CR replay-hash identity, a costprobe delta of zero on both, and DECODE/CR gallery and shot output unchanged in both themes before/after the 2D adapter extraction.

1. **Height-banded statics.** A cuboid carrying `zLo` builds with a new group `R_TALL`. A chassis whose `colliders.robotHeight?.(spec)` exceeds a static's `zLo` gets that chassis's filter widened; every other chassis is unchanged to the digit. DECODE/CR supply no `robotHeight` and emit no `zLo`, so their worlds build byte-identically. **Gate:** DECODE/CR two-run replay hashes and CR scene hashes byte-identical before/after. The down-cell footprint is **APPROX: lowest point of a sloped underside**, valid because the cell is enterable only from outboard (true underside rises from 25.5 at the outer lip to about 31.5 inboard, 3.4), so it ships as two strips.
2. **`FieldColliders.dynamic(world)`** already receives the world and is built only in the robot solve; `solveArtifacts` builds from `colliders.statics` alone, so the pollen solve and `bbPinSolid` never see the hive underside as a floor-level solid. A static in the plain array would leak into both.
3. **`PinSolid(p, pinned?)`**, as in 2.3. `bbPinSolid` tests the settled down cell's footprint only when `pinned.spec.heightIn > BB_HIVE_BOTTOM_Z`.
4. **Declared interpolated fields.** `displayWorld` today lerps only `x, y, heading`; every other field spreads from the predicted world, so the turret renders several ticks ahead of the chassis and snaps at each reconcile, visible from a driver-station perspective. Fix: `src/net/interp.ts` exports `INTERP_FIELDS` (turret/pitch angle fields) and `lerpRobotView(p, q, a)`; `displayWorld` calls it. Lands Phase 2, fixes 2D too.
5. **`FieldRenderer`** interface and the `scene` slot (2.3).
6. **World rules key.** `World.biobuzz.rules?: number` (absent 0), set from `BB_RULES`. The step reads `rules >= 1` before enforcing the height footprint, spill fall, tray test, deck, frame contacts, and muzzle height (`hoodDeg` too). A newer client adopting an older server's world on reconcile lacks the key and predicts the older rules, so reconcile never fights. About 10 B raw/frame.
7. **`GameSimModule.bot`** slot, consumed at the two command-assembly sites (7.2).

Nothing else in `src/sim`, `src/config.ts`, or `src/math.ts` changes.

---

## 3. Simulation model

### 3.1 What is authoritative

The server and every predicted world run the same `biobuzzStep`. Authoritative: chassis x/y/heading/vel (`solveRobots`); ground elements (`solveArtifacts`, no pins); element flight (hand integration against the new contact set, 3.4); the hive swing timer, taking side, tip table, spill fan RNG order, and `hiveTiltAngle(tipping)`; flower id stacks; deployment state (3.3), robot height, the rules key.

Derived at render time only: tray mesh pose from `hiveTiltAngle`, element pose from `pos`/`z`, turret pose, swerve pods, roller spin, the 0.4 s stow-to-deploy ease, flower contents, sky and lights. **Decision:** no display-only spill fall before the rules land; the renderer draws the element exactly where the sim puts it, avoiding the visual-divergence bug class the repo has already removed elsewhere.

### 3.2 Round-loop integration

BIOBUZZ does not run the pin/round loop. `step.ts`'s stages keep their order; new work slots into `play.ts`:

- Pass **FLIGHT**: the contact set changes (tray prism, frame/crossbar, decks, walls, floor); a `spilled` element skips the capture loop and lands through `landSpilled` (3.4).
- Pass **THE HIVES**: on release, contents leave as `spilled` flight elements at the release pose (3.4).
- Robot solve: `biobuzzColliders.dynamic(world)` returns the down cell's underside as two `zLo` strips, plus the arriving cell's footprint under the appearance rule (3.5).
- The frame is not a new static: its ground footprint already exists as `frameBars`. Above-ground members are flight-only contacts in `tray.ts`. `BB_SOLID_COUNT` does not move.

### 3.3 New state, with types

| field | where | per-tick wire | why it earns its cost |
|---|---|---|---|
| `RobotSpec.heightIn?: number` | spec, once | 0 | only dimension that changes an outcome (hive underside, envelope) |
| `RobotSpec.stowHeightIn?: number` | spec | 0 | start check in the builder only |
| `BbMechSpec.zIn?: number` | spec | 0 | muzzle height and volume check |
| `BiobuzzState.rules?: number` | world bag | about 10 B raw/frame | mixed-version prediction gate |
| `BallState.flight.spilled?: true` | existing variant | only while changing | capture/deflect skip it; G409 knows what it is |
| `Artifact.hit?: number` | ball delta | a few bytes, bounded by the roughly 0.47 s fall | G409 first-contact robot id |

**No new per-robot fired/scored counters.** `BiobuzzState.scored` stays per-alliance. A per-robot display, if ever shown, derives client-side from the element's `by` field at cell entry, never from world state.

The spill write is `{ kind: 'flight', target: a, by: a, spilled: true }`, `a` the spilling hive's alliance (`by` is the launching alliance, never a robot id). `spilled` short-circuits the capture loop before the `target`/`by` comparison, so a spilled element can never be re-captured by the cell it fell out of.

Deployment is a **pure read of `world.match`**, `bbDeployed(world, r)`: deployed once the match leaves pre-match. No new button or field; a 29-in build cannot choose to stay stowed under the hive (a manual toggle is Phase 7).

No new per-tick `RobotState` field. `costprobe` gains `biobuzz3d-2v2`, a **primed tip** and an **empty `fields` list**, so bytes/snap is measured with the spill in flight and a future field can't ship unpriced. Baseline: `biobuzz-2v2`, recorded in HANDOFF (8,725 B/snap raw, 34.1 KiB/s per client, double turret + Box Tube). `biobuzz3d-2v2` must sit within 3 percent on both columns, same run.

### 3.4 Hive, flower, and element 3D behaviour

**Axis convention.** Field frame: +x audience right, +y away from audience, +z up. The HIVE bar runs along y; the see-saw axis is the line parallel to field x through the pivot, theta tilting the bar in the y-z plane. `fieldToScene(x, y, z) = Vector3(x, z, -y)` (right-handed, scene Y up), so a rotation about field x is a rotation about scene X; every rotation here is written in field terms.

**Hive geometry.** `config.ts` gains true lengths beside the existing plan-projected literals (13.37/10.43/37.16). The literals stay authoritative; the ratio becomes a CHECK (`|TRUE * cos30 - literal| <= 0.01`), not a redefinition, since `worldHash` quantises at 1e-3 in and redefining would move every hive-adjacent scene hash.

```ts
export const BB_HIVE_PIVOT_Z = 43.95;                 // manual, pivot axis height
export const BB_HIVE_ARM_TRUE = 15.44;                // pivot to cell centre along the bar
export const BB_HIVE_CELL_LEN_TRUE = 12.04;           // cell length along the bar
export const BB_HIVE_LEN_TRUE = 42.91;                // assembly length along the bar
export const BB_HIVE_LIP_TRUE = BB_HIVE_ARM_TRUE + BB_HIVE_CELL_LEN_TRUE / 2; // 21.46
// bar-normal extents (p), APPROX, derived:
export const BB_HIVE_MOUTH_P: readonly [number, number] = [-1.4, 12.6];  // 20 x 14 opening
export const BB_HIVE_SHELL_P_LO = -8.9;               // exterior bottom face
```

Derived from stated numbers only: at theta +30 the bar axis at the outer face is z = 54.68 and the opening spans 53.5-65.6, so the 14-in opening spans p in [-1.4, +12.6]. At theta -30 the bar axis is at 33.22 and the hive bottom is 25.5, so the exterior face is at p about -8.9. The three manual heights overconstrain a symmetric 14-in box (the shell hangs about 7.5 in below the mouth floor; the interior is "7.61 to the roof break"), so a single box is replaced by **two prisms**: the **mouth** (accept volume, open at the outer face) and the **shell** (deflect body, closed but for the mouth face). Both p-extents are APPROX until the CAD answers the cell section (owner question 7; 4.12 is the path to a firm number).

**One definition of the tray angle.** `hiveTiltAngle(tipping)` in `hive.ts`: theta = `BB_HIVE_TILT` * (2*tipping/`BB_TIP_SWING_S` - 1). `tipping` is seconds remaining, already load-rate-scaled, so theta is deterministic from world state: +30 at swing start, 0 at release, -30 at the end; per-tick step at most 0.75 degrees at max rate. The renderer's `tipProjection` and `tray.ts` both read it; the sim never imports a renderer file.

**Tray as two closed tilted prisms (`tray.ts`).** The tray frame rotates about the pivot axis by theta (`dsin`/`dcos`). Accept/deflect tests rotate the element's `prev`/`pos` into the tray frame and run an axis-aligned segment-vs-box test there, using theta at `pos` time for both (APPROX; error below tolerance). Each cell is closed pivot-side, both sides, roof, and floor, open only at the outer face: a shot entering there at the true angle is taken throughout the swing; a shot through any closed face bounces at the unchanged miss restitution; air under the raised lip is air, so a low shot passes under and a mid-swing lip deflects. The existing AABB has no roof (an element would rest at 65.6 in with no way down), so it stays until `tray.ts` replaces it whole; a tilted prism sheds correctly. `hiveAccepts` keeps its signature and its pin to the mouth; only the geometry behind it changes. Two existing smoke checks are rewritten, with a written ruling, since they pin the spill origin to the plan-projected mouth the corrected release pose changes.

**Frame and crossbar as flight-only contacts.** One structure for the hive pair: two triangular members, base at the ground bars, apex at the pivot, joined by one crossbar along x at pivot height. Modelled as capsules; the triangle interior is APPROX open (logo panels may be absent at some events). Nothing is added to `colliders.ts` (the base bars already occupy the ground footprint; a static there would leak into the pollen solve and the pin predicate). A TRAY check asserts a lob well clear of the frame plane is untouched, one at the crossbar's height and span meets it.

**Spill as a fall from the lip of the level tray.** Contents leave as the bar passes level, unchanged. At level the emptying tray's mouth floor sits about **42.6 in**, the outer face 21.46 in from the pivot in plan, not the 18.58-in projection used before this correction (which took the down cell's settled bottom, 25.5 in, a different moment reached only at swing's end). **Release pose**: plan position from the existing fan; height about 44.0 in for POLLEN, 44.4 in for NECTAR including radius; velocity is the existing fan plus the lip's own tangential velocity (about 5.6 in/s nominal, up to 16.9 in/s at max swing rate, APPROX). Fall time from about 44 in to radius: about 0.47 s, 28 ticks (versus 0.36 s / 21 ticks from the earlier, wrong height). **If the owner rules 25.5 in is the intended number**, release moves to swing's end and the pose derives at theta -30 (owner question 5).

**The roll survives the landing.** A spill is born on the ground with its throw and rolls; the standing ruling is that the roll, not the throw, carries a spill across the field. Shared `land()` would zero velocity and stop it dead near its birth. So a `spilled` element lands through **`landSpilled`**: horizontal velocity times `BB_SPILL_LAND_DUMP` (0.6, APPROX), only `vz` zeroed, then `ground`. A SPILL check records the landing-line median and 90th percentile from the rules-0 build; the rules-1 median must sit within plus or minus 20 percent or a written ruling moves it.

**Spill counts and swing rate.** "8 elements" holds only for the zero-nectar tip-table row. The staged first tip spills 6; a tray at threshold holds more via the surplus mechanic, which also runs the swing up to 3x faster, moving the release instant and arriving-cell footprint timing. The SPILL lane is parametrised by tip-table row (5, 6, 8+) and rate (1, max).

**Verification of the birth against the tray.** A spilled element is born inside the emptying cell's mouth prism, at the lip, at the release angle, exiting through the open face while still rotating. A TRAY check confirms every scripted spill exits the prism undeflected at both rates.

**Decks (`deck.ts`), a deck always sheds.** A rule that bounced an element at 0.3/0.5 restitution, landing only at deck level, converges an element over a stationary robot to hovering forever. **Decision:** a deck contact always clears the robot. Crossing `heightIn` from above inside the footprint, the element is placed at the nearest footprint edge plus radius, given outward velocity at least `BB_DECK_SHED_V` (20 in/s, APPROX) and `vz` reversed at 0.3x, so no bounce sequence stays over the chassis; a re-catch pays another shed with less height each time. `hit` is set to the robot's id if `spilled` is still true. Resting on decks is Phase 7. Checks: grounded within 1.0 s over a parked robot; count conserved; not captured by that robot's mouth.

**G409 contact semantics.** G409 ends the moment the element contacts anything besides that robot. `spilled` clears (and `hit` stays unset) on any non-robot contact: tray shell, frame, crossbar, wall, floor. `hit` is set only on the first robot contact while `spilled` is true; a later robot writes nothing.

**Flowers.** The manual's FLOWER is a cage, not a tube: a top ring with a backstop, four pipes to a middle ring, a square extrusion down to a lower ring with a retrieval opening. The scene draws that. The sim keeps a contact cylinder to `BB_FLOWER_TOP_Z` 21.5 for launched elements, APPROX (passing between the pipes is not modelled). `BB_FLOWER_MID_Z` 3.98 is the middle ring's underside, APPROX. The id stack stays the scoring authority.

### 3.5 Robot height and expansion

- `heightIn` is deployed height, clamped [12, 29] in `coerceBiobuzzSpec`; absent reads 18. Carry-across in `src/sim/spawn.ts` (2.3).
- `stowHeightIn` (at most 18) and per-mechanism stowed state are builder-side: start check is the stowed pose inside an 18-in cube, excluding preloaded elements per the manual's carve-out; deployed check is the existing size limits plus vertical, box inside 18 x 24 x 29 with 29 always vertical. `BbMechSpec.zInStowed`, the sweeper `folded` flag, and the tube `retracted` flag join the `coerceBiobuzzSpec` clamp list beside `zIn`/`heightIn`, all registered in `docs/biobuzz-contract.md` section 4.
- **Muzzle height.** `bbMuzzleZ(spec)` returns a flat constant today; raising it is a release change, passed through `releasePollen`, never the solve alone. One commit touches every reader: `bbMuzzleZ` reads `BbMechSpec.zIn` (APPROX per kind: turret 14, dumper 12, tube 10) behind `rules >= 1`; six sites read it instead of the flat constant (birth, turret solve, dumper solve and its range probe, both flight-enters predictions). `hoodDeg`, re-read as a pitch cap, is behind the same gate. A ROBOT check per preset: a shot solved at muzzle height crosses the mouth plane inside the window it was solved for.
- **Start refusal cites the starting-configuration rule**, not the in-match expansion rule (the sim cannot violate it, a robot cannot exceed its spec); expansion becomes a builder warning on the deployed envelope.
- **The arriving cell and a tall robot under it.** The robot solve has only soft contacts plus perimeter containment, and a deeply embedded body can eject sideways once penetration flips the solver's minimum axis. So the arriving cell's footprint never emits as a whole static under a robot already inside it. **Appearance rule:** the footprint emits only when no tall chassis overlaps it; while one does, `dynamic()` emits a thin edge walking outboard at `BB_HIVE_EVICT_V` (24 in/s, APPROX) until clear. A HEIGHT check: exit speed under 2x top speed, never crossing the pivot plane. Owner question 6 asks whether that eviction should carry a foul.

### 3.6 Determinism

Unchanged in kind: same wasm version server/client, same construction order, `dsin`/`dcos`/`datan2`/`hyp` everywhere under `src/games/biobuzz/`, one seeded PRNG in `world.rngState`. Bots draw from their own mulberry32 state seeded `(matchSeed, seat)`, owned by `Room`/`GameController`, never perturbing the field's draw order or shipping on the wire. The two-run hash checks already read ball x/y/z, so spill and tray behaviour are covered without widening `worldHash`.

### 3.7 Rules that become enforceable

| rule | today | after Phase 3 |
|---|---|---|
| G409 first contact of a spilled element | not modelled | `hit` tag; a robot as first contact writes a verbal event line, no foul |
| height rule (deployed envelope) | plan-only | builder volume check and warning; a 29-in robot cannot pass under the down cell |
| starting configuration | plan-only | `startLegality` refuses a stowed pose outside the 18-in cube (preloads excluded) |
| pin against the hive | invisible for tall robots | `bbPinSolid(p, pinned)` reports the settled footprint for a robot over 25.5 in |
| G417 strategic examples | every hive hit a silent bounce | `tray.ts` knows the closed face and whose hive; an exterior hit while tipping writes a verbal line, own-cell misses stay silent, the card stays behind `BB_G417_ENABLED` |
| cell open at the outer face only | plan-rect ruling | geometry: closed back, sides, roof, floor in the tray frame |
| under-lip pass | phantom volume in the AABB | air |
| release height | 10 in for every archetype | mount cell + mechanism rise, birth and solve from one function |

### 3.8 Approximations kept

The tip table and swing; the mid-swing hand-over; the 0.3/0.5 miss restitution; spill fan constants; `BB_FLOWER_MID_Z`; placement-only flowers; the settle-harvest window; **G417 disabled by owner ruling**, behind `BB_G417_ENABLED = false`, its frame-ram detector written and gated; no yellow cards; elements never rest on decks; deployment as a phase read; the flower contact cylinder; the open triangle interior; the release pose's p-extents until the CAD answers. Every new constant carries an APPROX comment naming its derivation.

---

## 4. Rendering

### 4.1 Engine, version, budget

**`three` 0.186.0 (r186, MIT), `WebGLRenderer` only**, imported by name so the TSL node tree stays out. `three` and **`@types/three`** join **`devDependencies`** (Fly's image runs `npm ci --omit=dev`; the server never imports the client registry). `three` ships no TypeScript declarations at this version; `@types/three` supplies them, type-only, erased at build, 0 bytes. No `three/webgpu`, post-processing, or `GLTFLoader` in v1's shipped path (a loader runs offline in the CAD pipeline, and client-side in Phase 7).

**Measured:** a tree-shaken entry (`WebGLRenderer`, Standard/Basic materials, `InstancedMesh`, `Sprite`, `LineSegments`, PCF shadows) is 554,431 B raw / 139,079 B gz; the full namespace import is 745,537 B raw / 191,039 B gz.

Budgets, enforced by `scripts/bundleaudit.mjs` (new, `uiaudit`-shaped: baseline bytes per chunk, fail on growth). One compressor, `gzip -9`; Vercel serves brotli, about 18 percent smaller again.

| item | budget | how measured |
|---|---|---|
| main `index-*.js` growth | at most 10 KB gz over today's 903 KB gz | `bundleaudit`; no `three` marker in `index-*.js` |
| lazy 3D chunk | at most 250 KB gz | `bundleaudit` |
| model assets, v1 | 0 B | by construction |
| `hostWorker-*.js` | 702 KB gz today; at most +20 KB gz | `bundleaudit` |
| whole 3D route | at most 1.2 MB gz | sum |
| installer growth | at most 2 MB | `release/` size |

**Decision on 250 KB:** engine measured 139 KB gz; kill line **160 KB gz for the engine alone** (15 percent margin), decided by end of week 1. Over 250 KB total, cut features before code.

**CLAUDE.md amendment.** On `efficiency-audit`, CLAUDE.md is 26,670 of 27,000 bytes. The client-bundle sentence is replaced, not appended: "The CLIENT bundle is React + Rapier 2D; a game may lazily load a renderer chunk that only its route pays for, budgeted by `bundleaudit`." If it does not fit, the rule moves to `docs/area/ui.md` with only a pointer left in CLAUDE.md. `bundleaudit` and `npm run test:ai` (7.3) are documented in `docs/area/ui.md` and `docs/area/biobuzz.md` respectively and gain no CLAUDE.md entry: `bundleaudit` is a manual "run after any change under `src/render/three` or `scene/`" rule, like `uiaudit`, not wired into CI beyond `release.yml`.

### 4.2 Lazy-load plan

`BIOBUZZ_MODULE.scene = () => import('./scene/renderScene')` is the app's first code split. **Rule:** no module outside the lazy chunk may transitively import a module that imports `three`. `fieldRenderer.ts`, `webgl2Probe.ts`, `labels.ts`, and `src/net/interp.ts` may be static, since they import no `three`; type-only imports are erased and fine anywhere. `bundleaudit` catches the result; a CORE check catches the cause. The chunk loads only when a BIOBUZZ screen needing it mounts, after physics/LAN init; first paint is unchanged.

### 4.3 Scene graph

```
Scene (background = themed surround, no sky dome; small dome on high tier only)
  Lights            HemisphereLight + DirectionalLight (shadow map 1024 high tier, off medium/low)
  Field             ONE merged BufferGeometry per material, vertex colours:
    Tiles, Tape, Walls (height BB_WALL_H, APPROX; see am-0481, 4.12), Frame (triangles + crossbar)
  Hive[2]           pivot Group rotated by hiveTiltAngle(tipping); bar; cell[2] shell prisms; contents
  Flower[4]         cage per 3.4 + stack contents
  Elements          InstancedMesh(pollen r1.4 x40), InstancedMesh(nectar r1.8 x16)
  Robots[n]         Group per robot, static parts merged, posed per frame
  Overlay           reticle at predicted landing; taking-cell mouth outline
```

**Draw-call budget:** `renderer.info.render.calls` per frame including the shadow pass at most 120; triangles at most 150k; one shadow-casting light. Merging is what makes the budget hold on the high tier.

### 4.4 Materials and theming

1. **Surround/background** theme with `COLORS.backdrop`/`backdropDark`, read every frame.
2. **Element fills, alliance tints, chassis colours, sign panels:** fixed ink, unlit `MeshBasicMaterial`, so the 2D fills reproduce exactly with no lit-material colour drift to measure.
3. **Tiles, tape, in-scene labels:** hardcoded dark, unlit, `--ds-on-field*` tokens.

Lit materials (`MeshStandardMaterial`): robot chassis/drivetrain, hive shells and bar, and the frame only, the surfaces whose shape the light reveals.

**HUD legibility does not depend on what the camera sees.** A perspective view's ground can be the light surround, a sign, or the sky, so HUD bands get a **fixed dark scrim** in 3D. `contrast.mjs` gains three pairs. Decision: a scrim, not a fixed-dark surround, mirroring the 2D letterbox precedent.

### 4.5 Robot mesh from `RobotSpec`

`robotMesh.ts` (shared chassis/drivetrain) plus `renderRobotBb.ts` (mechanisms), reading the same authorities the sprite reads:

- Chassis: box length x width x `heightIn`. Alliance colour on robot sign panels, two faces at least; wrong/indeterminate signs are penalised by existing rules. No bumpers in this program.
- Drivetrain: mecanum, tank, swerve (pods by `moduleAngles`), x-drive, butterfly; wheel radius from `WHEEL_R`.
- Turret: ring at the mount, barrel pitched/yawed, flywheel spun. Twin turret at the second mount.
- Dumper: hinged bucket, tilt eases from the last fire command (client-side, never state).
- Box Tube: extended when held. Sweepers: spin when intake held. Hopper: instanced spheres at `zIn`.
- Stowed/deployed: mesh builds deployed; a 0.4 s ease runs once at the phase edge.
- Static parts merge per material; only articulated parts stay separate meshes.

Headless check: derived footprint equals the sim's footprint function, every preset and mount.

### 4.6 Field model source

Manual dimensions via `config.ts`, cross-checked against the CAD pipeline (4.12) where it settles a number. Unstated constants carry APPROX. No glTF ships in v1's default path.

### 4.7 Camera modes

All in `camera3d.ts`, client-only; mode, eye height, FOV, motion in `localStorage`, cycled by `view.cycle` (5.1). Every camera is offered in every drive style; a discouraged pairing (Chase with field-centric sticks) writes one event-log line the first time.

| mode | eye | look | FOV | follow | notes |
|---|---|---|---|---|---|
| **Driver station** (desktop default) | alliance area behind the wall, `BB_DRIVER_SETBACK` 12 in out (APPROX), seat offset y = +-20, height `BB_EYE_DEFAULT` 62 in (44-72) | yaw fixed to alliance view angle; pitch solved for field centre at 40 percent frame height (MEASURE Phase 1); optional soft yaw follow, off by default | 70 default, 60-90 slider | none | hive occludes far flowers, deliberately; PiP is the aid |
| **Overhead** (phone default; first 3D session, robot-centric) | orthographic | from a real `Camera` instance, matching 2D exactly | n/a | none | video export default when none chosen |
| **Chase** | 60 in behind, 40 above (APPROX) | at robot, pitched 25 down | 65 | pos half-life 0.12s, yaw 0.20s | compass chip always shown |
| **Orbit** | user-driven, 120-400 in | field centre or robot | 60 | none | spectators, replays, gallery |

**PiP minimap:** small HUD-corner canvas from the existing 2D `Renderer`, no new 3D cost, default on at low tier and first session. The driver-station eye is pinned to the alliance's view angle because field-centric stick rotation happens in a wall-fixed frame in the sim, and the server runs the same code.

### 4.8 Interpolation of remotes in 3D

Remotes render from `displayWorld` (2.4.4). Local robot: existing smoothing offset. Artifacts are not interpolated by design; flight comes from predicted z/vz. The renderer never extrapolates.

### 4.9 Effects

Blob-decal shadows per element (no shadow map low/medium); a short flight tracer (last 4 positions, client-side); a tint pulse when tipping starts; wheel/roller spin from velocity. No particles, bloom, motion blur, or full-viewport sky. **Audio (Phase 5):** existing synthesized SFX panned by `StereoPannerNode` keyed on x relative to the eye in Driver station/Chase; mono in Overhead.

### 4.10 Two canvases, one frame

The WebGL canvas and the existing 2D canvas are both absolutely positioned inside `.game-root`. The 2D canvas becomes a transparent overlay drawing only name labels, auto paths, and the replay burn-in, clearing instead of painting a backdrop. The label loop moves into `labels.ts` as `drawLabels(ctx, world, project, localId)`: 2D passes `camera.worldToScreen`, 3D passes `GameScene.project`. z-order stays canvases under `.mobile-touch` under `.hud` under `.mobile-overlay`. The canvas `aria-label` names the camera with four strings (driver's/top-down/chase/orbit view).

### 4.11 WebGL failure

The probe creates a throwaway canvas, calls `getContext('webgl2')`, releases it, never touching the game canvas. `new WebGLRenderer(...)` throws on failure, wrapped in try/catch. On `webglcontextlost` the handler prevents default and waits 2 s for restore. On probe null, a throw, or no restore, the controller builds the 2D adapter, writes one event-log line, and sets the view preference to `2d`.

**The lazy `import()` itself can also fail**, most commonly a stale `index.html` referencing a chunk hash a redeploy removed (a 404), distinct from missing WebGL2: the client is stale, not incapable. `GameController` wraps the import in try/catch; on rejection it falls back to the 2D adapter as above, and additionally triggers the existing stale-build reload prompt, since a 404'd chunk is the signature of an old build. Not permanently disabled: after a reload against the current build, 3D is offered again. `electron/main.cjs` gains no GPU switches.

### 4.12 CAD import

FIRST publishes the BIOBUZZ field CAD as an Onshape document (Version 1, 2026-09-12) at `ftc-resources.firstinspires.org/ftc/archive/2027/field`, a STEP zip (v26-27.2, 2026-09-15), a separate FLOWER Scoring Volume Onshape document, and the Event Field Setup Guide. No STL or glTF is offered directly. The manual, section 9.1 (wording to re-verify), calls the 3D CAD the official representation of the field, with a stated general tolerance of about 1 in.

**Licensing.** FIRST's website Terms of Use (`firstinspires.org/website-terms-of-use`) grant a licence "solely for your personal, non-commercial use" and forbid redistributing Content without written permission, with no carve-out found for a derived mesh. Committing or serving a decimated field mesh from this CAD is legally uncertain until permission exists. Public FTC tooling projects facing the same constraint typically transcribe dimensions rather than redistribute the model, an inference from precedent, and this plan follows it.

**Pipeline.** Onshape's export menu offers glTF/GLB/OBJ/STL at Coarse/Medium/Fine/Custom tessellation, but a manual export is not reproducible or versioned. Instead: CadQuery/OCP (headless Python, Windows wheels) imports the STEP file, tessellates it, and reads each named body's bounding box; `gltf-transform` welds, quantizes, simplifies, and instances repeats (flower cage 4x, hive cells 2x); `gltfpack` applies meshopt; brotli compresses at deploy. A raw Fine export is several megabytes; only simplification and instancing bring a whole-field GLB plausibly under 300 KB brotli. An in-browser STEP importer (LGPL, roughly 10 MB wasm) is excluded on size; this stays offline, dev-time only.

`scripts/field-cad.mjs` is the Node orchestrator: downloads the pinned STEP zip, verifies a committed sha256, runs `scripts/field-cad/convert.py`, emits `scratch/field-cad/field.glb` and `field-measurements.json`, runs compression, fails if over budget. Outputs are gitignored under `scratch/`.

Three decisions:

1. **The CAD is the geometry authority for dimensions, not bytes.** `field-measurements.json` (middle-ring height, cell floor offset, wall height, frame member section, cell prism extents, pivot height) settles this spec's APPROX constants; `config.ts` cites the file and STEP version beside each. A smoke check compares `config.ts` against the committed JSON. The numbers are ours to commit; the mesh is not, until permission exists.
2. **The shipped v1 field mesh stays procedural**, from `config.ts` alone: no CAD bytes, no licence exposure. The pipeline's GLB can replace it behind a dev-only `?fieldGlb=1` flag on alpha, loaded from a local path, so the owner can preview the true field early. Serving it publicly is owner question 15, default no until FIRST grants written permission.
3. **Robot model import stays Phase 7**, local only (IndexedDB, never uploaded), cosmetic only (sim geometry always stays the spec): `GLTFLoader`/`OBJLoader`/`STLLoader`, stripped of lights/cameras/animations, external URIs refused, size capped in the low single-digit megabytes, triangles capped in the tens of thousands, rescaled to the 18-in cube. Onshape's own export-to-glTF is the on-ramp. The loader budget is measured before scheduling.

**Phase placement:** the measurement pipeline runs Phase 0/1, since it settles constants Phase 0's true-length work already touches; the `?fieldGlb=1` flag lands in Phase 1.

---

## 5. Controls and HUD

### 5.1 Bindings

No new `RobotCommand` bits. New bindings: `view.cycle` (default `t`, pad 11 RS click), `view.eyeUp` (`o`), `view.eyeDown` (`i`), all confirmed free against `DEFAULT_BINDINGS`. `[`/`]` are a documented alternative only (AltGr on some layouts). `V` was already Chain Reaction's `fling`; a free default was chosen instead of stealing it: letters free on the default map are `t g h y u i o l m j`. Bindings appear in `KEY_ACTIONS`/`PAD_ACTIONS` so `ControlsSection` shows them, consumed before `quantizeCommand`, never reaching the sim. A smoke check asserts no key or pad index appears under two actions. Eye height is also a dial in Audio and Visual. Drive style stays the existing toggle; its copy gains a line about the driver's view facing the field from the wall.

### 5.2 Field-centric in 3D

Unchanged in the sim: the stick frame is the alliance wall, not the camera. Driver station and Overhead face the field from that wall, so stick-forward and screen-forward agree; the optional "Look toward robot" follow may turn the head up to 35 degrees while the stick frame does not move, which is why it defaults off. Chase is robot-centric and reads best with robot-centric sticks; the compass chip covers the other case.

### 5.3 Aim assist in 3D

`bbSlewTurret`/`bbAimAssist` and the hold-to-fire gate are unchanged. The shot verdict is extracted into a pure `bbShotVerdict(world, r): { landing: Vec2; lands: boolean; inRange: boolean }` that the step calls (checked equal to what it stored) and the client calls speculatively at 10 Hz regardless of the fire button. The reticle draws a green ring when the arc enters the mouth, an amber diamond when in range but not accepted, a grey dot when out of range. The bot policy (7.3) calls the same function before holding fire.

### 5.4 HUD chips

React at 10 Hz; all values are pure reads or client-side counters, so nothing new ships. Tiered, since the status row already overflows narrow phones and a 10 Hz live number is unreadable while driving:

| tier | chip | source |
|---|---|---|
| always on | controlled | hopper plus herded count |
| always on | mechanism state | mode plus deployed/stowed |
| always on | alliance HIVE card | existing HUD-slice read |
| always on | envelope | static result: ok / expanded / too tall |
| always on (Chase) | compass | heading relative to alliance view angle |
| Telemetry (off default) | speed, turn rate | predicted local robot |
| Telemetry | turret yaw/pitch | existing fields |
| Telemetry | shot solution | range, elevation, speed; in-window from `bbShotVerdict` |
| Telemetry | fired / landed | client-side edge-detector counters; no per-robot counter exists or is added (3.3) |
| Telemetry | cycle time | seconds between last two hive entries (coach mode, 5.7) |
| always on (desktop hint) | feed nectar | existing key/touch button; no new desktop HUD button |

Phone layout: new always-on chips join the wrapping status row; Telemetry hides on coarse pointers. New chip selectors join `shiftaudit`.

### 5.5 Mobile layout

Joysticks/buttons unchanged. One new `MobileLayout` key `view`, editable in layout mode, with a default position and a `coerceSettings` fallback for stored layouts lacking it. The view mode it cycles stays device-bound. Overhead is the phone default; perspective modes are offered when the quality tier allows (11).

### 5.6 Onboarding

First 3D session defaults to Overhead if the stored drive style is robot-centric, Driver station otherwise; from the second session, Driver station unless changed. The pre-match hint line gains the view key. A one-time event-log card on first 3D launch explains the view, the key, and, in robot-centric drive, that the sticks are the robot's. A hint on the BIOBUZZ home tab appears the first time 3D is available. The View group (Top-down/Driver station/Overhead/Chase), quality tier, FOV, eye height, camera motion, and PiP toggles live in Audio and Visual; a VIEW button sits beside MENU/RESET.

### 5.7 Coach mode (Phase 5)

A spectator may pick any seat's Driver station, not only Orbit; the cycle-time chip; a post-match shot table on the replay viewer (fired/landed/missed, re-simulated client-side, no wire cost); video export renders from the viewer's current camera and eye height (8.5).

---

## 6. Robot workshop

### 6.1 Parts vocabulary

| comparable-sim part | DSIM mapping |
|---|---|
| chassis W/L/H | `length`, `width`, `heightIn` (+ `stowHeightIn`) |
| drivetrain | `DrivetrainType`: swerve, mecanum, tank, x-drive, butterfly |
| turret, hood | `launcher.kind`, `mount`, `mount2`, `hoodDeg` (re-read), `zIn` |
| indexer / spindexer | `hopper` capacity and mode |
| intake | four sweeper mounts |
| slide, claw | a lift mount with the Box Tube as end effector |
| geometry (cosmetic) | not in v1; Phase 7 `bbTrim[]`, "not simulated" |

### 6.2 3D placement

Parts are placed by mount cell and by `zIn` (rise above the deck). No free X/Y/Z/yaw. Two editing views: the existing top grid and a new side elevation (`SideElevation.tsx`) showing heights against the 18-in and 29-in lines.

**3D Preview.** The hero preview slot becomes an orbiting 3D robot from `robotMesh.ts`. **One WebGL context for all previews:** `previewPool.ts` owns a single shared offscreen `WebGLRenderer`, rendering each preview on demand onto its own 2D canvas; browsers cap contexts around 16 and a 2v2 strategy screen can show four robots plus the live canvas. Rendering happens on spec change and while orbiting only. Sprite and canvas share one fixed-size container so the swap is shift-free (added to `shiftaudit`); the sprite is the fallback when WebGL is absent or unloaded.

### 6.3 Volume checks

Live, builder-side: stowed pose against the 18-in cube (wireframe in the preview), excluding preloads; deployed pose against 18 x 24 x 29 with 29 vertical. The offending part is tinted and named in the refusal. `coerceSpec` clamps but does not refuse; `startLegality` refuses at the start line; deployed-envelope failure is a builder warning.

### 6.4 Stow / deploy

Two pose tabs, Stowed and Deployed. **The Stowed tab edits real geometry**, otherwise the start check would pass every build untouched: per mechanism, `BbMechSpec.zInStowed?` (default `min(zIn, 18 - mechanism rise)`), the sweeper `folded` flag, the tube `retracted` flag; `stowHeightIn` is the chassis's own stowed height. The sim reads only deployed geometry after pre-match; stowed geometry is builder-side, and the render-only 0.4 s ease interpolates between poses.

### 6.5 Ball routing

A validator over the sim's own transfer geometry: mouth to hopper to launcher origin or place point, using the existing clash rules as authority. Reports when a sweeper mount and launcher cell cannot both be reached.

### 6.6 Presets and cloud slots

The three archetypes exist as presets and gallery sheets. **Cloud slots are `GameLoadout.savedRobots`**, capped by `MAX_SAVED_ROBOTS` in shared `src/config.ts:2803`, account-synced (`loadouts` is a separate, non-active-game archive). **Decision: raise `MAX_SAVED_ROBOTS` 3 to 4 in Phase 2b**, parity with the reference's four slots; `coerceSettings` slices to the new cap (raising is safe, lowering would not be), and the supporter-tier slot-bonus interaction is checked in the same change. "Copy a robot from a top run" reads the already-stored, already-coerced `setups[i].spec` into a slot.

---

## 7. AI drivers and batch simulation

### 7.1 Scope

**v1: solo, code lobbies, and LAN rooms.** Bots do not fill matchmade rooms in v1, deferred to Phase 7 as its own lane of matchmaker and room-setup work. Bots are never rated and never rate opponents; a room with a bot seat is scored only if the owner enables it (default off).

### 7.2 Where they run

`ai/policy.ts` is DOM-free and fills `GameSimModule.bot`; nothing outside `src/games/biobuzz/` names it. Consumed at **two sites**: `Room.frameCommands` (the LAN `hostWorker` instantiates the same `Room`, so LAN and online are one site) and `GameController` for solo. Each caller keeps a `Map<seat, BotState>` seeded `(matchSeed, seat, tier)`, calling `mod.bot.command(world, seat, state)` for every bot seat before quantizing; DECODE/CR have no `bot` and are untouched. The command goes through the same quantize path as a human's and into the recorder, so a bot match's replay re-simulates from recorded commands without running the policy.

**Online, a bot seat is a remote robot to every client:** predicted from the snapshot's commands like any human remote; only the server runs the policy. Solo and LAN-host run it locally.

**Bot-seat plumbing (Phase 4):** a socketless roster entry in `Room`, a spec source per tier, lobby/match-setup "Add a bot" controls with a tier picker (gated on a server capability), LAN roster display, scored gating, a bot marker on replay setups. Acceptance: a code lobby with one human and one bot starts, records, and replays without the policy.

### 7.3 Difficulty model

Tiers Easy/Medium/Hard, four sliders (aggression, accuracy, cycle focus pollen-to-nectar, reaction time). A tier is a slider preset. **The policy is new code**: DECODE has no bots, and auto paths are player-authored, not a waypoint helper. Reusable: the auto-path follower (if the policy emits waypoints) and the dummy spawn path for seating.

State machine: **collect** (nearest reachable element by footprint and mouth, excluding opponent NECTAR); **route** (straight-line steer, wall square-up); **fire** (when `bbShotVerdict` reports in range and landing, accuracy as a heading offset from the bot's own RNG); **place** (nectar at a flower when the window allows); **defend** (park on the opponent's shot line, Hard only, teleop only); **stay clear of the hive footprint** above 25.5 in. During AUTO no target lies past the field's own half, since crossing draws a foul that would bill a human partner.

**Hold-last friendly.** Replay tracks are hold-last compressed; a jittering policy would write several times a human's track. The policy re-decides every 6 ticks (reaction slider permitting), holds between decisions, quantizes before emitting. `costprobe biobuzz3d-bots` prices the replay row; acceptance at most 5 percent over a human 2v2's row.

### 7.4 Determinism and replayability

Bot memory (seat, tier, sliders, rng, target, phase, timers) is plain JSON owned by `Room`/`GameController`, **never the `World`**, so bots add **0 B/snap**. The bot RNG is a separate mulberry32 seeded `(matchSeed, seat)`, never touching `world.rngState`. Checks: same seed gives the same command log over 3,600 ticks (`npm test`); Hard beats Easy at least 90/100 and 100 bot-vs-bot AUTO periods award zero cross-field fouls (`npm run test:ai`); the policy reads only `world` and its own state (a smoke check forbids reading `rngState`, `Math.random`, or another seat's commands). **Verified:** the recorder records every setup's command, so a bot's commands are stored like a human's and a replay never runs the policy.

### 7.5 Batch simulation

`batch.ts` runs N matches headless with the same `createWorld`/`step`, a seed per match, returning per-match results. Clock-free; the caller paces. **Runs inside the existing LAN `hostWorker`** (a new worker would be a third wasm copy, since the LAN worker already inlines wasm and owns `Room`): `HostIn`/`HostOut` gain a `batch` message pair; `bundleaudit` allows at most +20 KB gz for the handler. The batch route offers "as fast as possible" and 1x speeds, a progress bar, JSON export, and an optional post to `practice_runs` with `view_mode = 'batch'`, never `records`.

**Posting pacing.** A batch run can exceed 100 rows. The client posts one `POST` per run, sequentially, honouring 429 like the existing LAN uploader, rather than adding a batch endpoint. Budget: 100 solo-vs-bot matches under 60 s on the dev box (MEASURE).

---

## 8. Netcode, replay, and back-compat

### 8.1 New wire fields

| field | kind | absent meaning | cost method |
|---|---|---|---|
| `RobotSpec.heightIn`, `stowHeightIn`, `bbMech[].zIn`, `zInStowed`, `folded`, `retracted` | spec, once | 18 / 18 / per-kind default / derived / false / false | none per tick |
| `BiobuzzState.rules` | world bag, every frame | 0 | `costprobe` (about 10 B raw) |
| `flight.spilled`, `Artifact.hit` | ball delta, only while changing | not spilled / no contact | `costprobe biobuzz3d-2v2` primed |
| bots | none | - | 0 B/snap by construction |

Zero new per-tick `RobotState` fields. The `biobuzz3d-2v2` scenario lists an empty `fields` array on purpose.

**Reconnect and the lossy lane.** Nothing new needed: a reconnect keyframe carries the full bag (with `rules`) and all 56 elements, well below Chain Reaction's own keyframe; `spilled`/`hit` ride the ack-keyed ball delta. The LAN lossy channel behaves the same way.

### 8.2 Caps

No new `CLIENT_CAPS` entry for a render mode.

- **Mid-match: the `rules` world key** (2.4.6). An older server drops `heightIn`; the client re-injects the server-sanitised spec from match-start setups.
- **Before joining: `SERVER_CAPS`** gains `'party', 'bots', 'bbrules'`. Bot controls gate on `'bots'`; height dials and the alpha entry gate on `'bbrules'` online, so a 29-in build is never offered against a server that would drop it.

### 8.3 SIM_VERSION policy

**The facts.** `src/config.ts` says alpha holds at 2 with a stale "MAIN is here at 1" comment; both branches stamp 2, and BIOBUZZ is scored and live. A SIM mismatch reads as playable `drift`, not a refusal, the same stamp reading `ok`. So holding 2 while shipping rules that change `step()` output would make a stored replay re-simulate into a different match under an `ok` label, the exact silent failure the constant exists to prevent.

**The policy.** The owner's standing instruction forbids changing the season, including the SIM version, without being asked. So the default through Phase 3 and promotion is to **hold SIM_VERSION at 2**. The protection is the **`rules` stamp** on the world and replay header (2.4.6, 8.1), plus a **rules-0 golden hash** proving a rules-0 replay re-simulates exactly. Every `step()`-changing commit is written **behind `rules >= 1`**, so the residual risk (a change shipping outside the gates under an `ok` label) is zero by construction as long as that discipline holds, and the golden hash checks that it does.

A bump to SIM_VERSION 3 is an **optional decision with its cost stated**, never a default: every stored replay would need to be understood as pre-3D once it lands (it already reads `drift` under a mismatch, so little changes behaviourally; the narrower value is catching a `step()` change that slipped outside `rules` by accident). If the owner bumps anyway, `src/config.ts` records that score-moving rules landed under SIM_VERSION 2 by owner decision; the stale comment is corrected either way.

**Belt and braces.** The recorder and `sanitizeReplay` carry `rules` in the replay header (optional, no format bump). Playback stamps the world with the replay's own rules, not the current `BB_RULES`, so a rules-0 replay re-simulates under rules 0 exactly, a path that must exist anyway for mixed-version prediction. The golden hash guards it; a TRAY check asserts a `rules`-less replay re-simulates byte-identically to it on a rules-1 build.

**Practice runs during deploy lag.** A new client's solo run carries `heightIn`; an older server drops it, so a stored replay would re-simulate a 29-in robot as 18-in under `ok`. So the server deploy carrying `heightIn` precedes the client release, and height dials stay off until `SERVER_CAPS` includes `'bbrules'`.

### 8.4 Interpolation

The declared list (2.4.4) lives in `src/net/interp.ts` and ships to 2D too. Since the headless suite cannot construct a full `GameController`, the check tests `lerpRobotView(p, q, a)` directly: continuous across a snapshot boundary, angle fields take the short arc.

### 8.5 Replays and export

Replays stay `{seed, setups, command log}` plus the `rules` header. **The live playback path acquires a scene the same way `GameView` does.** Today `ReplayView.tsx` constructs its own `Renderer` directly (line 220), holds it in a ref (254), and calls `rend.render(ctx, p.world, null, localId)` every frame (302), all against the 2D camera only. This is replaced with the same choice `GameController` makes: the viewer picks a `FieldRenderer` (2D adapter, or a `GameScene` behind `Renderer3D` when available), calls `.configure(...)` once, and `.render(predicted, display, null, localId)` each frame; a replay has no predicted/display split, so both arguments are the same stepped world. Labels draw through `drawLabels`, using `GameScene.project` under a perspective camera and `camera.worldToScreen` under Overhead. A **camera picker** (the same View group as in-match) lets a viewer choose any mode while scrubbing; the burn-in is unaffected.

**Export renders from the viewer's current camera and eye height, Overhead when none chosen.** Fast export renders through the shared offscreen renderer (6.2) resized to export size, draws it onto the offscreen 2D export canvas in the same task, then burns the scoreboard and sponsor mark; muxers untouched. The `MediaRecorder` fallback captures a third, composited canvas drawing both layers each frame, since the 2D canvas alone would be a transparent overlay in 3D. `preserveDrawingBuffer` stays off everywhere: a same-task draw after render reads the buffer before the compositor clears it.

### 8.6 Mixed versions

A newer client on an older server adopts a world without `rules` and predicts the old step; an older client on a newer server ignores `rules`/`spilled`/`hit` as unknown fields, rendering a spilled element as an ordinary lift, harmless. No new numeric `RobotState` field exists, so a newer server never produces an invalid number on an older client. A stale client on a newly promoted server predicts rules 0 until it reloads; the build gate prompts the reload, and the reconcile in between is a correction, not a fight, since the client adopts the server's world whole.

---

## 9. Server, DB, ranked

- **Queues and boards:** unchanged. 2D and 3D pair on the same build sha. No matchmade bots in v1.
- **Alpha gating:** BIOBUZZ stays public; the 3D view is alpha-only until Phase 6, online only when `SERVER_CAPS` includes `'bbrules'`.
- **One migration, Phase 0:** `practice_runs.view_mode text` (nullable, small enum including `batch`); the repo save function, practice API, `dbtest`, and the client posting site all update together. The migration applies at server boot, so the alpha deploy precedes the posting client.
- **Ranked fairness telemetry:** `view_mode` on practice runs and a `match_end` event with the view mode, from the first alpha build, so the fairness question has eight weeks of data before Phase 6.
- **Per-room CPU budget.** Two instruments, not comparable: `costprobe` (dev box, one process) and the Fly load test (driven rooms). Phase 3 gate: `costprobe biobuzz3d-2v2` cores/room at most 1.05x its own baseline, 2v2 `step()` at most 0.40 ms; bots at most 0.05 ms/seat (MEASURE); then a live perf read on alpha after a real 2v2 with a tip. If Fly approaches its ceiling, the lever is worker threads, never a VM size.
- **Fly deploy, by phase.** Phases 3-5 deploy the alpha app after every server change. Phase 6 alone deploys production from a `main` worktree with the plain deploy script, never a bare `flyctl deploy`.

---

## 10. Verification

### 10.1 Headless checks per behaviour

New lanes in `scripts/smoke-biobuzz/`, one unsharded process: `trayChecks()`, `heightChecks()`, `spillChecks()`, `deckChecks()`, `aiChecks()`, `sceneChecks()`.

| lane | checks |
|---|---|
| CORE | `import 'three'` only in the loader; no static import of `three/*` elsewhere; scene files named `render*`; no sim file imports `draw*`/`render*`; solid count unchanged; plan literals equal true-times-cos30 to 0.01; no key/pad index under two actions |
| TRAY | tray frame reproduces manual heights within +-1 in at both swing extremes; cell centre projects correctly; accept/reject through each face; under-lip pass; pivot-side shot hits steel; frame lob tests pass; AABB phantom-volume cases now pass; mouth pin unchanged; spill exits the prism undeflected at both rates; exterior-hit event line correct; rules-less replay matches the golden hash |
| HEIGHT | 18-in robot passes under; 29-in stops at the outer strip and the inner strip's higher band; arriving-cell eviction under 2x top speed, never crosses the pivot plane; clamp holds [12,29]; `heightIn:29` round-trips every sanitizer; pin predicate correct; `rules` absent means no footprint |
| SPILL | per tip-table row and rate: lip release pose; land within 0.7 s; count conserved; landing-line median/p90 within +-20 percent of rules-0; `hit` semantics correct; frame-bounce-then-deck writes no G409 line; golden hash holds |
| DECK | grounded within 1.0 s over a parked robot; not captured by that robot's mouth; a chasing robot still lands a shed element |
| AI (`npm test`) | seed determinism over 3,600 ticks; no forbidden reads; never enters the hive footprint tall; no AUTO waypoint past the field's own half; at most one track entry per 6 ticks |
| AI (`test:ai`) | ladder 90/100; 100 bot-vs-bot AUTO periods, zero cross-field fouls; 100 matches under 60 s |
| SCENE | driver-station yaw and pitch-solve correct; Overhead frustum matches the real camera; derived footprint equals the sim's, every preset; hive boxes match plan geometry; field-to-scene mapping is right-handed |
| SERVER | a real room hosts a 2v2 with a primed tip and a bot seat; snapshot round-trip of `rules`/`spilled`/`hit`; keyframe carries the bag and all 56 elements; capabilities include `bots`/`bbrules` |
| PERF | paired ratio against a CR 2v2 with a primed tip; biobuzz footer time at most Phase 0 baseline + 10 s |

Shared `smoke.ts` gains two closed-block checks: DECODE/CR replay hashes byte-identical after the `R_TALL` edit, and the `lerpRobotView` continuity check.

**`npm test` stays what it is.** The AI ladder and batch timing move to `npm run test:ai` (the `test:mm` pattern: no DB, no sockets, so a red `npm test` still means physics broke and a stochastic 90/100 never reddens it). Whole `npm test` budget: at most 50 s (39 s today).

### 10.2 Hash coverage

`worldHash` already reads ball x/y/z, so spill and tray behaviour are covered without widening it. Every new scene steps to its last still twice and compares. `hit` is asserted by full-world JSON equality in the SERVER lane. One golden hash guards the rules-0 scripted 2v2.

### 10.3 3D scene gallery and shots

`Scene` gains a per-still camera descriptor so one scene hashes headless and photographs from the driver-station eye height. The gallery draws every cell through one WebGL context with scissored viewports and the real scene code only. The shot runner gains a software-GL flag for the 3D pass; Phase 0 verifies a triangle renders that way. **The fallback is defined now:** if software GL fails, the runner falls back to hardware acceleration in a visible window. Pixels are read by a human; no byte comparison.

### 10.4 Audits

- `bundleaudit.mjs` (new, ratchet, `gzip -9`).
- `uiaudit`'s file list widens to BIOBUZZ's `.tsx` files under `src/games/**`, new baselines measured and recorded in the same commit.
- `contrast` gains the three HUD-scrim pairs.
- `shiftaudit` excludes the 3D gallery and live canvas; it audits the new 2D-route chrome (VIEW button, View group, new chips, preview container, batch route).
- `docaudit` stays green: existing guides already govern the new paths. `docs/area/biobuzz.md`'s header, which still calls the game an alpha-only unscored placeholder, is corrected in Phase 0.

### 10.5 `npm test` meaning preserved

Nothing new joins `npm test` except the BIOBUZZ lanes and the two `smoke.ts` blocks. `bundleaudit`, `costprobe`, `contrast`, `shots`, `test:ai`, `test:mm`, `dbtest` stay outside it.

### 10.6 costprobe

`Scenario` gains **`prime?: (world: World, tick: number) => void`**, so 3D scenarios can fill the taking cell to threshold at a fixed tick and let `hive.ts` release on its own; the probe asserts a nonzero tip count for a priming scenario, or fails loudly. Scenarios: `biobuzz3d-solo`, `biobuzz3d-2v2` (primed, empty fields list), `biobuzz3d-bots` (two bot seats). Acceptance: raw B/snap and wire KiB/s both at most baseline + 3 percent, same run; cores/room at most 1.05x baseline; replay KiB at most a human 2v2 + 5 percent for the bots scenario.

---

## 11. Mobile, Electron, accessibility, performance budgets

### 11.1 Performance budgets

Stated at 60 Hz; a 120/144 Hz display draws proportionally more, and the quality tier offers a render cap. Every acceptance is a delta against a 2D baseline recorded on the owner's named test machines (owner question 14), plus an absolute cap.

| device class | target | measured by |
|---|---|---|
| 2018-class laptop, integrated GPU, 1080p, Driver station, 2v2 | 3D p95 at most 2D p95 + 4 ms, and at most 16.7 ms | `?perf=1` |
| 2023 mid-range phone, Overhead, low tier | median at least 30 fps, p95 at most 40 ms | `?perf=1` |
| same phone, Driver station | offered only if warm-up p95 at most 33 ms | quality tier |
| 40-tick reconcile with a spill in flight, mid-range phone | at most 1.1x today's alpha reconcile | Phase 3 |
| first paint | unchanged | before/after page-load audit |
| in-game ad unit on the 3D layout | off until laptop p95 is recorded with the columns on and off | monetization guide |

### 11.2 Quality tiers

`low | medium | high`, chosen once per device from core count, DPR, and a 30-frame warm-up p95, overridable in Audio and Visual. Backbuffer pixels are budgeted, not DPR: high at most 2.2 MP, medium at most 1.2 MP, low at most 0.6 MP. Antialiasing on high only; `powerPreference: 'high-performance'` for dual-GPU laptops. Low: one light, no shadow, no blob shadows, Overhead default, PiP on. Medium: shadow off. High: shadow map 1024, optional small dome.

### 11.3 Mobile

WebGL2 only; touch layers unchanged; a `view` key; Overhead default; the 2D renderer is one tap away and auto-selected if warm-up p95 exceeds 40 ms. 3D on touch is a goal with a measured gate, not a promise.

### 11.4 Electron

No GPU/ANGLE/WebGPU switches. The lazy chunk is Vite-emitted, resolves under `file://`, ships in the installer (growth at most 2 MB). Offline fallback plays 3D from the bundled chunk.

### 11.5 Accessibility

The canvas aria-label names the view; every camera/eye-height/FOV control is a keyboard binding and a focusable control. A FOV slider and a Camera Motion (full/reduced) control live in Audio and Visual, defaulted from the reduced-motion preference where exposed: reduced disables the yaw follow, tracer, tint pulse, and Chase smoothing, and caps animation iteration counts. Eye-height minimum is 44 in for a seated driver. The event log stays the text surface for match state; colour is never the only reticle cue.

---

## 12. Delivery plan

**Horizon: 13 weeks, first alpha ship at week 5.** Phases 0-2 put a playable driver-station 3D view with derived robots on alpha; rules, AI, and public release follow. Lanes follow `docs/biobuzz-contract.md`'s shape: each owns named files, states its own acceptance checks, and does not edit another lane's files without a HANDOFF note. **Shared files have exactly one owner: lane I.**

| lane | owns | acceptance authority |
|---|---|---|
| **I** integration | shared core, seams, bindings, CLAUDE.md, `docs/area/*` | DECODE/CR hash identity, costprobe delta zero, `docaudit` |
| **R** renderer | `src/render/**`, `scene/**`, canvas stack, replay export path | `bundleaudit`, `?perf=1`, shots |
| **S** sim rules | `tray.ts`, `height.ts`, `deck.ts`, `hive.ts`, `play.ts` spill write, `colliders.ts`, `coerce.ts`, `config.ts`, muzzle readers | TRAY/HEIGHT/SPILL/DECK, golden hash, `costprobe` |
| **P** product | builder dials, HUD chips, `ai/**`, `batch.ts`, bot seats, migration, telemetry | AI/SERVER lanes, `test:ai`, `uiaudit`, `shiftaudit`, `dbtest` |
| **V** verification | `bundleaudit.mjs`, shot runner flags, gallery route, costprobe scenarios, guide sections | all of the above green |

**Phase 0, spike, seam, budgets (week 1).** Merge `efficiency-audit` into `alpha` first (owner question 0), then rebase `biobuzz-3d`. Lane I: seam commit (`FieldRenderer` + adapter, `scene`/`bot` slots, `robotHeight`, `zLo`, `heightIn`/`stowHeightIn` carry-across, `PinSolid(p, pinned?)`, `R_TALL`, `BiobuzzState.rules`, `interp.ts`, no-op for DECODE/CR). Lane R: empty lazy chunk, WebGL2 probe, 2D fallback, `bundleaudit.mjs`. Lane S: true-length constants with the ratio check, `hiveTiltAngle`. Lane P: `view_mode` migration and companions, `match_end` event, `SERVER_CAPS` scaffolding. Lane V: `costprobe`'s `prime` hook and scenarios, shot runner 3D flags, `biobuzz.md` header fix, the `docs/deploy.md` promotion checklist, and the CAD measurement pipeline. *Accept:* engine size recorded (139 KB gz); index delta at most +10 KB gz, no `three` marker; fallback demonstrated with WebGL disabled; a triangle renders or the hardware fallback is documented; `npm test` green, no scene hash moved; a 2D run posts `view_mode='2d'`; `docaudit` green; **DECODE/CR gallery and shots identical before/after the adapter extraction, both themes.** *Kill:* engine over 160 KB gz triggers the owner budget decision by end of week 1.

**Phase 1, the field (weeks 2-3).** Field with merged geometry, hive, flowers as cages, frame + crossbar, elements, Driver station and Overhead cameras, two-canvas stack, theming and the HUD scrim, PiP, 3D gallery, alpha-only entry, the `?fieldGlb=1` dev flag. *Accept:* chunk at most 250 KB gz, 0 model bytes; laptop 3D p95 at most 2D p95 + 4 ms; scenes photographed both themes; `contrast` green; pitch-solve MEASURE recorded. *Late by over a week:* drop PiP and gallery cameras to Phase 5.

**Phase 2a, robots (week 4).** Robot mesh with sign panels and mechanisms, the interpolation fix wired into `displayWorld` (2D too), 3D Preview through the shared pool, Chase and Orbit, new bindings, VIEW button, onboarding. *Accept:* every preset/mount renders from spec with no per-preset code; footprint and interpolation checks green; one WebGL context on the strategy screen.

**Phase 2b, workshop v1 and HUD (week 5).** Height dials, stow/deploy tabs, volume checks (cosmetic height until Phase 3), side elevation, tiered HUD chips, mobile view key, `uiaudit` widening with re-baselining, `MAX_SAVED_ROBOTS` raised to 4. *Accept:* `uiaudit`/`shiftaudit` green with the new chrome.

**Ships to alpha at week 5:** a playable 3D BIOBUZZ with the 2D rules.

**Phase 3, the rules (weeks 6-8).** `heightIn` clamp, two-strip footprint with the appearance rule, height-aware pin, frame/crossbar flight contacts, spill from the lip with `landSpilled`/`hit`, `tray.ts` replacing the AABB, decks that shed, muzzle height through every reader, `hoodDeg`, the exterior-hit event line, the `rules` replay header and golden hash, all behind `rules >= 1`. *Accept:* DECODE/CR hashes byte-identical; TRAY/HEIGHT/SPILL/DECK green; rewritten checks carry a written ruling; 2v2 step at most 0.40 ms; costprobe within budget; phone reconcile within budget; owner review of the new 2D depiction. *Kill:* any scene's outcome changes without a written ruling, revert `tray.ts` and ship the rest.

**Phase 4, AI and batch (weeks 9-10, one week slack).** Policy behind `bot`, tiers, sliders, roster/lobby plumbing, `test:ai`, batch inside `hostWorker`, batch route, JSON export, the `practice_runs` post. *Accept:* AI lane green in `npm test`; `test:ai` green; a code lobby with one human and one bot starts, records, replays without the policy; bots add 0 B/snap and at most 5 percent replay KiB; never rated. *Kill:* if Hard cannot beat Easy 90/100 by week 10, tiers ship as speed/accuracy caps only.

**Phase 5, surfaces, mobile, coach mode (weeks 11-12).** Quality tiers, touch view key, mobile Overhead default, positional SFX, spectator seat cameras, shot table, export from the viewer's camera, Electron offline check, accessibility pass, telemetry dashboards. *Accept:* mid-range phone median at least 30 fps Overhead; installer growth at most 2 MB; reduced-motion honoured; export carries scoreboard and sponsor mark on both encoder paths.

**Phase 6, promotion (week 13).** Merge alpha to main; deploy production first from a `main` worktree; announce; then Vercel main; open the 3D view to stable; update "2D" copy to "2D and 3D"; correct guide sections; refresh HANDOFF.

**Phase 7, options (owner call, not scheduled).** Manual stow/deploy behind a second command byte; elements resting on decks; bots in matchmade rooms; a cosmetic `bbTrim[]`; a meshopt glTF for hive/flower detail if permission exists; WebGPU opt-in with WebGL2 fallback; robot model import (4.12); the LAN `hostWorker` wasm de-duplication, noted, not claimed.

---

## 13. Risks and kill criteria

| risk | mitigation | kill criterion |
|---|---|---|
| Engine does not tree-shake to budget | measured 139 KB gz before Phase 0 | over 160 KB gz and the owner declines a new budget by end of week 1 |
| `R_TALL` perturbs DECODE/CR | groups only on `zLo` statics and tall chassis; hash-gated | any non-identical hash: move the footprint to a per-game exclusion path |
| WebGL2 fails on blocklisted school fleets | 2D fallback in Phase 1 | none; caps reach, does not kill the plan |
| The lazy chunk 404s after a redeploy | catch, fall back to 2D, plus the stale-build reload prompt | none; self-healing after reload |
| Spill-as-flight raises wire cost | bounded per tip; measured on the wire column | over 5 percent: shorten the spill or re-open the design |
| Spill landing line moves | `landSpilled` keeps the roll; median/p90 from rules 0 | outside +-20 percent without a written ruling: tune the dump constant first |
| Tray-frame rewrite disturbs tuned shots | mouth pin kept; every aim-assist scene re-run | any scene's outcome changes without a written ruling: revert `tray.ts` |
| Arriving cell ejects a tall robot sideways | appearance rule, measured exit speed | exit over 2x top speed or a pivot-plane crossing: footprint waits until the swing ends |
| Software-GL shots unstable | hardware-accelerated fallback; human-read | never kills; gallery verified on hardware |
| Ranked fairness of the driver view | telemetry from the first alpha build | outcomes differ materially after 500 runs: owner decides on a population split |
| Mixed-version prediction fights | `rules` world key; the `'bbrules'` capability gates entry | a reconcile storm with mixed builds: hide 3D behind the cap until promotion |
| Stored replays re-simulate differently | `rules` replay header; golden hash; SIM_VERSION held by default | none unless a `step()` change ships outside `rules`, caught by the golden hash |
| A derived field mesh is served without permission | shipped field stays procedural; CAD mesh is dev-only, gitignored | never kills; ships procedural until permission |
| Phone frame rate | tiers with a pixel budget and automatic 2D fallback | none; 3D on touch is gated, not promised |
| Bots consume server CPU or replay rows | at most 0.05 ms/seat; 6-tick cadence | bots exceed either: stay solo/LAN only |
| Schedule | per-phase "late by over a week" lines in section 12 | Phase 1 past week 4: drop PiP/gallery cameras; Phase 2 past week 5: ship 2a only; Phase 4 past week 10: tiers as caps |

**The one thing that kills the whole design:** a requirement that 3D be physically authoritative (robots that tilt or are lifted, a hive a robot can move, elements solved in a 3D engine). That needs a second wasm, a 3D pin-loop port, re-measured tolerances, per-tick pose fields, and an unresolved cross-platform determinism story. Every budget breaks at once; the right response is a different document, not a bent version of this one.

---

## 14. Open questions for the owner

| # | question | needed by |
|---|---|---|
| 0 | **Merge `efficiency-audit` into `alpha` before Phase 0?** Default: yes, already the next step in that branch's own HANDOFF. Every CLAUDE.md byte figure, `docaudit` result, sharded-test number, and migration number here assumes it; lane I owns the merge and rebase. | Phase 0 (blocking) |
| 1 | Approve the CLAUDE.md sentence swap, and `three` plus `@types/three` in `devDependencies`? | Phase 0 |
| 2 | SIM_VERSION: default holds at 2, protected by the `rules` header and golden hash. Bump to 3 anyway, accepting the stated cost? | Phase 3 (only if a bump is wanted; no action needed to hold) |
| 3 | Are 2D and 3D drivers one ranked pool for the alpha period, with `view_mode` telemetry deciding a later split? | Phase 6 |
| 4 | Deployment as a phase read for v1, manual toggle deferred to Phase 7? | Phase 3 |
| 5 | **Release height:** this spec derives the spill from the level tray's lip (about 42.6 in, about 0.47 s fall). If 25.5 in is the intended number, release moves to the end of the swing. Which? | Phase 3 |
| 6 | Should a tall robot struck by the descending arriving cell mid-swing be billed under G417, or evicted with no foul (assumed here)? Should the exterior-hit event line fire for own-cell misses during a swing too? | Phase 3 |
| 7 | **Cell section from the CAD:** mouth floor and exterior bottom-face offsets, roof break, middle ring dimensions, so the two p-extents and `BB_FLOWER_MID_Z` stop being APPROX. The CAD pipeline (4.12) is the path to a firm number once run. | Phase 3 |
| 8 | Batch results to `practice_runs` with `view_mode='batch'`: keep, or export-only? | Phase 4 |
| 9 | Element mass, spill exit speed, and roll distance remain unmeasured. Is a measured value available, or do the feel constants stand? | Phase 3 |
| 10 | Is the `hostWorker` wasm duplication (about 700 KB gz) worth a separate task now, or after promotion? | not phase-blocking |
| 11 | Wall height and frame member profile for the mesh: confirm the cited kit/figure, or supply a better one once the CAD pipeline's measurements are in hand. | Phase 1 |
| 12 | Does the 3D Preview also replace the smaller strategy-card preview, or stay 2D there? | Phase 2a |
| 13 | Which physical machines are the Phase 0 baseline devices (a 2018-class laptop, a 2023 mid-range phone)? | Phase 0 |
| 14 | Raise `MAX_SAVED_ROBOTS` 3 to 4 in Phase 2b. Default: yes, parity with the reference's four slots; flag if supporter tiering should change this. | Phase 2b |
| 15 | **Ship the CAD-derived field GLB publicly**, replacing the procedural mesh? Default: no, until FIRST grants written permission (fallback: ask FIRST). The dev-only `?fieldGlb=1` flag ships regardless. | not phase-blocking (before any public ship) |

---

## 15. Appendix

### 15.1 Glossary

| term | meaning |
|---|---|
| render mode | a per-device view preference over the same authoritative sim; never changes `step()` output |
| elements layer | game-owned deterministic code for everything above the floor: tray, decks, frame/crossbar contacts |
| tray frame | the frame rotated about the hive pivot axis by the swing angle, cell prisms axis-aligned in it |
| mouth / shell | the accept prism and the deflect prism in the tray frame |
| height band | a `zLo` on a static: solid only to a chassis taller than it |
| `R_TALL` | the Rapier collision group for height-banded statics |
| `robotHeight` | the generic `FieldColliders` slot a game supplies to report robot height; absent means never tall |
| rules key | `BiobuzzState.rules`, the integer telling a client, and a replay, which rule set applies |
| spilled element | a flight element released by a tip, tagged so capture skips it and G409 can see it |
| deck | the top face of a chassis at `heightIn`; a flight contact surface that always sheds |
| bot seat | a robot slot driven by the deterministic policy; memory owned by `Room`/`GameController`; never rated |
| quality tier | `low | medium | high`, device-bound, with a backbuffer pixel budget |
| geometry authority | the source a dimension is settled from: the manual, or the CAD measurement file once run |
| golden hash | the stored `worldHash` of the rules-0 scripted 2v2, guarding that path from moving |

### 15.2 New constants

| constant | value | unit | marker | derivation |
|---|---|---|---|---|
| `BB_HIVE_PIVOT_Z` | 43.95 | in | manual | pivot axis height |
| `BB_HIVE_ARM_TRUE` | 15.44 | in | manual | pivot to cell centre along the bar |
| `BB_HIVE_CELL_LEN_TRUE` | 12.04 | in | manual | cell length along the bar |
| `BB_HIVE_LEN_TRUE` | 42.91 | in | manual | assembly length along the bar |
| `BB_HIVE_LIP_TRUE` | 21.46 | in | derived | arm plus half cell length |
| `BB_HIVE_MOUTH_P` | [-1.4, 12.6] | in | APPROX | manual heights at +30; owner Q7 |
| `BB_HIVE_SHELL_P_LO` | -8.9 | in | APPROX | hive bottom at -30; owner Q7 |
| `BB_HIVE_CELL_H` | 14 | in | manual | opening height; interior APPROX |
| `BB_HIVE_CELL_WALL` | 0.25 | in | APPROX | sheet thickness from figures |
| `BB_FRAME_MEMBER_W` | 1.0 | in | APPROX | base bar's measured thickness |
| `BB_WALL_H` | 12 | in | APPROX | perimeter kit am-0481; ratio off a figure; MEASURE via CAD |
| `BB_SPILL_LAND_DUMP` | 0.6 | ratio | APPROX | plastic ball meeting foam tile |
| `BB_SPILL_LIP_OMEGA` | 0.26 | rad/s | derived | 60 degrees over the swing time |
| `BB_DECK_SHED_V` | 20 | in/s | APPROX | a ball rolling off a chassis top |
| `BB_HIVE_EVICT_V` | 24 | in/s | APPROX | a slow drive |
| `BB_DRIVER_SETBACK` | 12 | in | APPROX | inside the alliance area's depth |
| `BB_DRIVER_SEAT_DY` | +-20 | in | APPROX | two drivers a shoulder apart |
| `BB_EYE_DEFAULT` / `_MIN` / `_MAX` | 62 / 44 / 72 | in | APPROX | standing eye height; 44 is seated |
| `BB_CAM_DRIVER_FOV` | 70 | deg | APPROX | slider 60-90 |
| `BB_CAM_DRIVER_AIM` | 0.40 | frame fraction | APPROX | MEASURE Phase 1 |
| `BB_CAM_YAW_FOLLOW_HL` | 0.25 | s | APPROX | off by default |
| `BB_CAM_YAW_CLAMP` | 35 | deg | APPROX | keeps the wall in peripheral view |
| `BB_CAM_CHASE_BACK` / `_UP` | 60 / 40 | in | APPROX | tuned Phase 1 |
| `BB_CAM_CHASE_POS_HL` / `_YAW_HL` | 0.12 / 0.20 | s | APPROX | tuned Phase 1 |
| `BB_DEPLOY_EASE_S` | 0.4 | s | APPROX | render-only |
| `BB_HEIGHT_DEFAULT` | 18 | in | rule | absent `heightIn` |
| `BB_HEIGHT_MIN` / `_MAX` | 12 / 29 | in | rule | `coerceBiobuzzSpec` clamp |
| `BB_MECH_Z_DEFAULT` turret/dumper/tube | 14 / 12 / 10 | in | APPROX | release height per kind |
| `BB_RULES` | 1 | int | | rules key value after Phase 3 |
| `BB_BOT_STEP_BUDGET_MS` | 0.05 | ms | MEASURE | per seat |
| `BB_BOT_DECIDE_TICKS` | 6 | ticks | APPROX | hold-last cadence |
| `BUNDLE_3D_CHUNK_GZ` | 250 | KB | budget | engine prior 139 KB gz |
| `BUNDLE_ENGINE_KILL_GZ` | 160 | KB | kill | 139 x 1.15 |
| `BUNDLE_INDEX_DELTA_GZ` | 10 | KB | budget | over 903 KB gz |
| `FIELD_GLB_BUDGET_BR` | 300 | KB | budget | brotli, whole field, simplified/instanced |
| `PERF_LAPTOP_P95_MS` | 16.7 | ms | budget | and at most 2D p95 + 4 |
| `PERF_PHONE_P95_MS` | 40 | ms | budget | Overhead |
| `PIXELS_HIGH` / `_MEDIUM` / `_LOW` | 2.2 / 1.2 / 0.6 | MP | budget | backbuffer |
| `COST_TOL` | 3 | percent | budget | raw and wire |
| `STEP_2V2_MS` | 0.40 | ms | budget | today 0.37 |
| `TEST_WALL_S` | 50 | s | budget | today 39 |

### 15.3 New files

| path | lane | purpose |
|---|---|---|
| `src/render/fieldRenderer.ts` | I | `FieldRenderer` interface + `Renderer2DAdapter` |
| `src/render/labels.ts` | R | `drawLabels` shared by 2D and 3D |
| `src/render/webgl2Probe.ts` | R | throwaway-canvas probe |
| `src/render/three/load.ts` | R | the only `import 'three'` |
| `src/render/three/renderer3d.ts` | R | WebGL renderer, context-loss handling |
| `src/render/three/camera3d.ts` | R | camera modes and DOM-free projection math |
| `src/render/three/robotMesh.ts` | R | chassis and drivetrain meshes from spec |
| `src/render/three/theme3d.ts` | R | theme reads for the surround |
| `src/render/three/quality.ts` | R | tiers, pixel budget, warm-up p95 |
| `src/render/three/previewPool.ts` | R | shared offscreen preview renderer |
| `src/net/interp.ts` | I | declared interpolated fields + `lerpRobotView` |
| `src/games/biobuzz/scene/renderScene.ts` | R | `GameSceneFactory`, `project` |
| `src/games/biobuzz/scene/renderField.ts` | R | tiles, walls, tape, frame, merged |
| `src/games/biobuzz/scene/renderHive.ts` | R | pivot group, cells, contents |
| `src/games/biobuzz/scene/renderFlower.ts` | R | cage, stack |
| `src/games/biobuzz/scene/renderElements.ts` | R | instanced spheres |
| `src/games/biobuzz/scene/renderRobotBb.ts` | R | mechanism meshes, signs |
| `src/games/biobuzz/scene/renderOverlay.ts` | R | reticle, mouth outline |
| `src/games/biobuzz/tray.ts` | S | tilted-frame accept/deflect, frame and crossbar contacts |
| `src/games/biobuzz/height.ts` | S | deployment read, volume checks, `dynamic()` footprint |
| `src/games/biobuzz/deck.ts` | S | flight vs robot top |
| `src/games/biobuzz/ai/policy.ts` | P | deterministic driver (fills `GameSimModule.bot`) |
| `src/games/biobuzz/ai/tiers.ts` | P | presets and sliders |
| `src/games/biobuzz/batch.ts` | P | headless, clock-free batch runner |
| `src/games/biobuzz/Batch.tsx` | P | batch devRoute, drives `hostWorker` batch messages |
| `src/games/biobuzz/SideElevation.tsx` | P | builder side view |
| `scripts/bundleaudit.mjs` | V | chunk size ratchet |
| `scripts/smoke-biobuzz/tray.ts`, `height.ts`, `spill.ts`, `deck.ts`, `ai.ts`, `scene.ts` | V | new lanes |
| `scripts/aismoke.ts` (`npm run test:ai`) | P | ladder, AUTO fouls, batch timing |
| `scripts/field-cad.mjs` | V | CAD orchestrator: download, verify, convert, compress, budget-check |
| `scripts/field-cad/convert.py` | V | CadQuery/OCP: STEP in, tessellate, named-body bounding boxes out |
| `docs/biobuzz/field-measurements.json` | V | committed measured dimensions (numbers only, no mesh) |
| `server/db/migrations/NNNN_practice_runs_view_mode.sql` | P | `view_mode` (next free number) |
| `docs/biobuzz/plan-3d.md` | V | this spec |

Modified shared files: `src/games/module.ts` (`scene`), `src/games/types.ts` (`zLo`, `robotHeight`, `bot`), `src/types.ts` (`heightIn`, `stowHeightIn`, `spilled`, `hit`), `src/games/biobuzz/state.ts` (`rules`), `src/sim/physicsEngine.ts` (`R_TALL` via `robotHeight`), `src/sim/penalties.ts` (`PinSolid` pinned arg), `src/sim/spawn.ts` (carry-across), `src/games/biobuzz/coerce.ts` (clamps), `src/games/biobuzz/hive.ts` (`hiveTiltAngle`, release pose), `drawField.ts`, `play.ts`, `robot.ts`, `elements.ts`, `colliders.ts`, `config.ts` (true lengths, CAD citations), `src/render/renderer.ts` (adapter), `src/game.ts` (renderer choice, interpolation, bot memory, HUD counters), `src/ui/GameView.tsx` (canvas stack, VIEW button), `src/ui/ReplayView.tsx` (scene acquisition, camera picker, export), `src/ui/AudioSection.tsx` (View group, tier, FOV, motion, PiP), `src/ui/MobileControls.tsx`, `src/settings.ts` (`view` default, `MAX_SAVED_ROBOTS`), `src/input/bindings.ts`, `src/seasonVisibility.ts`, `src/net/protocol.ts` (`SERVER_CAPS`), `src/net/sanitize.ts` (`rules` header), `src/sim/replay.ts` (`rules` header), `src/lan/hostWorker.ts` (batch messages), `server/room.ts` (bot seats), `server/api.ts` (`view_mode`), `server/db/repo.ts`, `scripts/costprobe.ts` (`prime`), `scripts/shots.cjs`, `scripts/shiftaudit.cjs`, `scripts/uiaudit.mjs`, `scripts/dbtest.ts`, `scripts/contrast.mjs`, `CLAUDE.md`, `docs/deploy.md`, `docs/biobuzz-contract.md` section 4, `docs/area/biobuzz.md`, `ui.md`, `netcode.md`, `docs/biobuzz-reference.md`; `package.json` (`three`, `@types/three`); `src/config.ts` (`MAX_SAVED_ROBOTS`).
