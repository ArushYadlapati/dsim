# Roadmap — next up (not started)

Split out of `CLAUDE.md` on 2026-09-16. Orientation, not a rule: nothing here binds a change
you are making today, which is why it is no longer loaded into every session. `CLAUDE.md`'s
**State of play** section is the short version and stays there.

---

## Next up (not started)

1. **Rapier slice 3 — the AUTO-PATH robot as a DYNAMIC body** driven toward its path target,
   so a chassis crushed between a kinematic path robot and a wall has somewhere to go (today
   the perimeter invariant is what saves it, and it saves it by refusing the push). Then **CR
   particles** to Rapier if 300 bodies a tick is affordable, KEEPING the scripted accelerator
   loop. ONLY after that: drop the `dsin/dcos/datan2` discipline.
2. **DECODE penalty hitbox audit** — G408 and G422 have now been rewritten against the manual's
   own text; what is left is the ZONE GEOMETRY each of the OTHER rules tests
   (`gateZone`/`gateTapeSegments`, `tunnelStrip`, `allianceArea`, `pinnedAgainstWall` slop, the
   SAT `rrContacts` test) versus the manual figures. Tighten with smoke cases.
   **Get the rule text from `/ftc/archive/2026/game/manual-NN`** — the live `/ftc/game/manual`
   now serves the 2026-27 pre-season manual and `manual-11` 404s there. WebFetch's own PDF
   extractor returns binary garbage on these; download the PDF and run `pdftotext -layout`
   (`pdftotext` without `-layout` for the glossary, whose two columns interleave otherwise).
   **Check every quoted definition against the real glossary before trusting it** — G408 shipped
   for months against two definitions that are not in this manual at all.
3. **Chain Reaction manual refinement** — replace the `APPROX` constants (ring-stand inset,
   Lab-Area size/geometry, exact zone coordinates) with measured manual values. This is the
   last real gap in CR; everything else there is feature-complete.
4. **Multi-core — DESIGNED, NOT BUILT (`docs/scaling-multicore.md`).** One server process is
   capped at about one core, because Node runs JavaScript on one thread; a 16-vCPU machine runs
   the same single thread as a 1-vCPU one, which is why the VM sweep found `shared-cpu-1x`
   through `8x` barely differ. Profiled, **~75% of a busy server is simulation that can leave
   the socket thread and ~6% is socket work that cannot**, and `server/room.ts` imports no `ws`
   and no `pg` — every way out of a room is already a callback — so the seam a worker needs
   exists. Recommended: `worker_threads` behind **`SIM_WORKERS`, default 0**, taking a machine
   from ~13 driven rooms to ~100 and 1,000 concurrent from 70–90 machines to single digits.
   ⚠️ **`UV_THREADPOOL_SIZE` must be raised with it** — `permessage-deflate` runs zlib on the
   libuv threadpool, that pool is PER PROCESS and defaults to 4, and left alone it becomes the
   new bottleneck and presents as LATENCY rather than as CPU. Sequence: Linux baseline first,
   then `SIM_WORKERS=1` (slower than none, on purpose — it prices the hop in isolation), then
   sweep 2/4/8. **Until a prototype exists, do not buy multi-core hardware for DSIM: nothing
   in the repo uses a second core.** `grep SIM_WORKERS` finds nothing today.
5. Deferred: WebTransport (needs TLS-deploy validation + an ACK-keyed delta), full-reload
   reconnect, obelisk AprilTag visuals, DECODE deferred fouls (G408 possession>3 / plowing),
   matchmaking polish, replay UI, leaderboard tiers.

