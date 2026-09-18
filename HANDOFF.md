# HANDOFF — 2026-09-17, night (biobuzz-3d: Day 1 LANDED — 3D physics, 3D renderer, CAD field)

**READ FIRST.** Branch **`biobuzz-3d`**, worktree `.claude/worktrees/biobuzz-3d`. Tree clean at the
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
