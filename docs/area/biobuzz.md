<!-- governs: src/games/biobuzz/**, scripts/smoke-biobuzz/** -->
# GAME: BIOBUZZ

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

