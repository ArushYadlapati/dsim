# Day 0 physics spike results (2026-09-17)

Throwaway diagnostic (`scripts/spike3d.ts`, `scripts/spike3d-browser/`), not wired into any
test or build. Gate is spec `docs/biobuzz/plan-3d.md` §10. World: z-up, inches, gravity
`{0,0,-386}`, `lengthUnit` 10. 4 robots (18in cuboids, yaw-only, 30 lb), 56 elements (40 r1.4 +
16 r1.8 spheres, 0.2 lb each, CCD on), 2 dynamic see-saw trays on revolute joints (±30° limits,
started at +30°, 6 elements loaded in each up cell), 3600 ticks at 1/60, a 600-tick scripted
push on one robot toward the nearest tray.

## Package versions (pinned, `-E`)

| package | version | where |
|---|---|---|
| `@dimforge/rapier2d-compat` | 0.19.3 | dependencies, **unchanged** |
| `@dimforge/rapier3d-deterministic-compat` | 0.20.0 | dependencies, new |
| `three` | 0.186.0 | devDependencies, new |
| `@types/three` | 0.186.0 | devDependencies, new |

`@dimforge/rapier3d-deterministic` 0.20.0 (the non-compat build) was installed with `--no-save`
for the runtime-matrix probe only; it is not in `package.json` or `package-lock.json`.

## Determinism: two Node runs (`npx tsx scripts/spike3d.ts --ticks=3600 --seed=1`)

| run | hash | medianMs | p95Ms | maxMs |
|---|---|---|---|---|
| 1 | 1971098706 | 0.0197 | 0.0457 | 0.395 |
| 2 | 1971098706 | 0.0204 | 0.0467 | 0.784 |

**Hashes equal.** Body/state check on both runs: bodies 71, sleeping 58, `spheresBelowFloor` 0,
`spheresOutside` 0, `trayAngleEndDeg` `[30.0000448913582, 30.0000448913582]`. A third run at a
different seed (`--seed=2`) produced a different hash, confirming the seed and the hasher are
actually wired in rather than the check being vacuous.

`maxMs` is high relative to the median because it is dominated by a GC/JIT-variance outlier one
or two ticks after the excluded 60-tick warmup window, not by a steady-state cost — p95 (0.046
to 0.047 ms) is the more representative worst case, both far under budget.

## Cross-runtime: Node vs. Chromium (Electron)

Served `scripts/spike3d-browser/` with `npx vite scripts/spike3d-browser --port 5199`, loaded it
in a hidden Electron `BrowserWindow` (same pattern as `scripts/shots.cjs`:
`disableHardwareAcceleration` + `CalculateNativeWinOcclusion` off), same seed and tick count.

| runtime | hash |
|---|---|
| Node (tsx) | 1971098706 |
| Chromium (Electron) | 1971098706 |

**Equal.** The deterministic build's cross-platform promise holds for this scene on this
machine.

## Runtime matrix: compat vs. non-compat package

| runtime | `-deterministic-compat` | `-deterministic` (non-compat) |
|---|---|---|
| Node / tsx | OK (hashes above) | **FAIL** |
| Browser (Vite 6.4.3 dev) | OK (hash above) | **FAIL** |
| Worker | not attempted | not attempted |

Non-compat failure causes, both confirmed directly rather than inferred:
- **Node / tsx**: the package ships no `main`/`exports` field usable by Node's ESM resolver
  (only `module`, a bundler-only convention), so a bare specifier import fails outright. The
  explicit subpath (`@dimforge/rapier3d-deterministic/rapier.js`) resolves the module graph but
  its generated glue does `import * as wasm from "./rapier_wasm3d_bg.wasm"` — the in-browser
  "ESM integration proposal for Wasm," which neither tsx's transform layer nor plain Node (even
  with `--experimental-wasm-modules`) accepts; tsx's CJS-compat path tries to parse the `.wasm`
  file as JS/CJS source and throws a syntax error on its magic bytes. There is also no `init()`
  export in this build (`init.d.ts` is empty) — nowhere to hand it raw bytes even if that were
  attempted, unlike the compat package's `init(): Promise<void>`.
- **Browser (Vite)**: Vite 6.4.3 raised its own explicit error dependency-optimizing the
  package: `"ESM integration proposal for Wasm" is not supported currently. Use
  vite-plugin-wasm or other community plugins to handle this. Alternatively, you can use
  `.wasm?init` or `.wasm?url`.` Since the package's own glue does the raw `import`, not this
  script, there is no `?init`/`?url` call site to redirect without patching the package or
  adding a plugin — both out of scope for this spike (no new dependency was added; the
  instruction was to report, not fix).
- **Worker**: not run. Vite's worker bundling goes through the same dependency-optimizer path
  that just failed for the plain browser page, so the same error is expected; skipped rather
  than spending the time to reproduce an already-explained failure.

**Conclusion for §2.5's fallback rule**: stay on `-deterministic-compat` everywhere, as
planned. The non-compat package is not a drop-in on this Vite version without adding a wasm
plugin, which was out of scope here.

## Tray (hive see-saw) behaviour

Dynamic body on a revolute joint about the x axis worked, with one correction: `JointData`'s own
`limitsEnabled`/`limits` fields, set before `createImpulseJoint`, were **not** enough — the tray
spun to ~177° (past the intended ±30°) and stopped only when it hit unrelated geometry. Calling
`.setLimits(min, max)` on the `ImpulseJoint` instance returned by `createImpulseJoint` fixed it;
every subsequent run held both trays at exactly `30.0000448913582°` for the full 3600 ticks
(joint limit acting as a hard stop, angular velocity settled to 0, body asleep by the end).

This is a stop, not a calibrated see-saw: the ballast (a small dense cuboid on the bar, offset
in y) biases the tray toward the +30° limit hard enough that the 6 elements loaded in the up
cell did not overcome it and tip the tray to the other stop. That is expected and out of scope
for Day 0 — `docs/biobuzz/plan-3d.md` §3.6 assigns detent/ballast calibration against the
manual's published tip rows to `scripts/hive-calibrate.ts` on a later day; this spike only
needed to show the joint, limits, and a loaded dynamic body are stable, which they are.

Geometry (bar, two 5-wall cells, ballast) is an approximation of §3.6's numbers for the purpose
of having something for elements to rest on and a joint to move — not the CAD-derived frame,
which is a separate pipeline.

## Step timing vs. the §3.10 budget

| quantity | budget | measured |
|---|---|---|
| step time | ≤ 1.5 ms median | 0.020 ms median, 0.046 ms p95 (both runs) |

Far under budget. This scene (4 robots, 56 elements, 2 tray bodies, ~9 statics, no CAD trimesh)
is smaller than a real 2v2 room will end up being once the CAD field and full per-tick gameplay
(intake/launch/derive/score) are added, so this number is a floor, not a prediction of the final
room cost — re-measure with `costprobe`'s `biobuzz3d-*` scenarios once `step3d` exists for real.

## Bundle chunk size (§2.5, §7's `bundleaudit` baseline)

Method: added an exported `spikeLoadPhysics3d()` to `src/games/biobuzz/index.ts` that dynamic-
imports `@dimforge/rapier3d-deterministic-compat`, built, measured, reverted (`git checkout --`),
rebuilt to confirm a byte-identical clean tree. Raw and gzip(-9, Node `zlib`) sizes:

| chunk | before (no import) | after (import added) | delta |
|---|---|---|---|
| main index chunk, raw | 2,543,019 B | 2,543,129 B | +110 B |
| main index chunk, gzip-9 | 902,671 B | 902,736 B | +65 B |
| new physics chunk, raw | — | 2,891,032 B | new |
| new physics chunk, gzip-9 | — | 1,089,268 B | new |

**Gotcha worth recording**: the first attempt — the exported function with no reference to it
anywhere, exactly as specified — produced a byte-for-byte **identical** build to the baseline
and **no** physics chunk at all. Rollup's tree-shaking removes an unused named export (and, with
it, the `import()` call inside its body) before code-splitting ever sees it; an `import()` only
forces a separate chunk if the code path containing it is actually reachable in the retained
module graph. The number above was measured after adding one line —
`(globalThis as Record<string, unknown>).__spikeLoadPhysics3d = spikeLoadPhysics3d;` — which
keeps the declaration alive (a real module-evaluation-time side effect) without calling the
loader. Both the function and that line were fully reverted before committing; the final build
is byte-identical to the pre-spike baseline (`index-DNYTf0b8.js`, 2,543,019 B, confirmed by
re-running the build after `git checkout --`).

The physics chunk (~2.76 MiB raw / ~1.04 MiB gzip) matches the plan's ~1.1 MB gzip estimate.
`hostWorker` (1,894,834 B raw, unrelated to this module) was unaffected in every build, as
expected.

## Verdict against the gate

**Pass.** Both mandatory checks hold: the two Node hashes are equal, and Node matches Chromium
too, which is more than the gate required. The step-time target (≤ 1.5 ms median) is cleared
with a wide margin (0.02 ms measured) on a scene smaller than a real room, so it is not yet
evidence the full game will clear it — re-check with `costprobe` once `step3d` and the CAD field
exist. No kill criterion was hit: no instability, no NaN, no out-of-bounds elements. The one
real course-correction was the joint-limits API (`ImpulseJoint.setLimits`, not `JointData`'s
fields alone) — worth carrying into the real `sim3d/` implementation from the start.
