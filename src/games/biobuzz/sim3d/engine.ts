/**
 * BIOBUZZ 3D PHYSICS — engine bootstrap (Day 1 seam, `docs/biobuzz/plan-3d.md` §2.5, §3.2).
 *
 * The deterministic Rapier 3D wasm module is reached ONLY through a dynamic `import()` inside
 * `initPhysics3d()` — exactly the pattern `scripts/spike3d.ts` (the Day 0 spike) used, and the
 * same reason the shared 2D `initPhysics()` (`src/sim/physicsEngine.ts`) awaits its own module
 * before any step: a client that never steps a 3D world must never pay for the ~1.1 MB gzipped
 * chunk (`docs/biobuzz/spike3d-results.md`). Nothing else lives in this file — building a
 * world, syncing it to `World` JSON, and stepping it are Lane A's `bodies.ts` / `step3d.ts`.
 *
 * DETERMINISM (plan §2.5): `@dimforge/rapier3d-deterministic-compat` is the ONE package this
 * module may import — never the non-compat `-deterministic` build (Day 0 measured it as not a
 * drop-in on this toolchain: no Node/tsx entry point, and Vite's optimizer refuses its wasm
 * import outright) and never the 2D `@dimforge/rapier2d-compat`, which is a different engine
 * for a different solve.
 */

/** the resolved module's shape — `typeof import(...)`, so every caller gets the package's own
 * types without a second, hand-maintained copy of them. */
export type Rapier3d = typeof import('@dimforge/rapier3d-deterministic-compat');

let mod: Rapier3d | null = null;
let inFlight: Promise<void> | null = null;

/**
 * Resolve the wasm module, exactly once per process.
 *
 * IDEMPOTENT and safe to call from every site that might need to be first — the server at
 * boot (beside `initPhysics()`), the smoke suite, a solo 3D practice start, LAN hosting a 3D
 * room: a second call while the first is still in flight awaits the SAME promise rather than
 * importing (and re-initializing) the module twice.
 */
export async function initPhysics3d(): Promise<void> {
  if (mod) return;
  if (!inFlight) {
    inFlight = (async () => {
      // matches the spike's exact call: the compat build needs `init()` before any world uses it.
      const resolved: Rapier3d = await import('@dimforge/rapier3d-deterministic-compat');
      await resolved.init();
      mod = resolved;
    })();
  }
  return inFlight;
}

/** has `initPhysics3d()` resolved? */
export function physics3dReady(): boolean {
  return mod !== null;
}

/**
 * The resolved module.
 *
 * Throws rather than lazily initializing: a call before `initPhysics3d()` has resolved is a
 * bug at the CALL SITE (every step-capable entry point is supposed to await it first, exactly
 * like the 2D `initPhysics()` contract), not a state this function should paper over by
 * kicking off a second, unawaited load.
 */
export function rapier3d(): Rapier3d {
  if (!mod) throw new Error('3D physics not initialised: await initPhysics3d() first');
  return mod;
}
