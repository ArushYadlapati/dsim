// Day 0 spike step 6: does the non-compat `@dimforge/rapier3d-deterministic` package
// (bare-ESM `.wasm` import, no `init()`) initialise under Vite/browser? Throwaway probe,
// not linked from anywhere else. See docs/biobuzz/spike3d-results.md for the outcome.
const out = document.getElementById('out')!;
out.textContent = 'importing...';
import('@dimforge/rapier3d-deterministic')
  .then((RAPIER: any) => {
    const w = new RAPIER.World({ x: 0, y: 0, z: -386 });
    const msg = 'NONCOMPAT_OK gravity=' + JSON.stringify(w.gravity);
    out.textContent = msg;
    console.log(msg);
  })
  .catch((err) => {
    const msg = 'NONCOMPAT_FAIL ' + (err && err.stack ? err.stack : String(err));
    out.textContent = msg;
    console.error(msg);
  });
