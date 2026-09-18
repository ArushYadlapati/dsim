// scripts/field-cad/source.mjs — THE PINNED FIELD CAD SOURCE, in one place.
//
// It lives in its own module because THREE things need the same identity string and none of
// them may carry a second copy of it: `scripts/field-cad.mjs` (which downloads and sha-checks
// the zip), `scripts/field-cad/emit-dims.mjs` (which stamps it into the header of the generated
// `src/games/biobuzz/fieldDims.gen.ts`), and the SIM3D smoke check that re-renders that file and
// diffs it byte for byte. Importing `field-cad.mjs` for the constant is not an option — that
// module runs the whole pipeline on import.
//
// FIRST publishes the field as a STEP zip (docs/biobuzz/plan-3d.md §8): "STEP v26-27.2 of
// 2026-09-15". This URL and hash were captured 2026-09-17 (see the field-cad README for the
// full licence note this pipeline ships under).
//
// TO PICK UP A NEW FIELD REVISION: fetch the field page, find the new "Field CAD (STEP, .ZIP)"
// link and version string, update URL/VERSION here, delete the cached zip (or just let the sha
// check in `field-cad.mjs` fail and read the printed actual hash), run once, and PASTE the new
// sha256 here too — that check is what stops a stale, silently-different field being used from
// cache.
export const SOURCE = {
  url: 'https://ftc-resources.firstinspires.org/ftc/archive/2027/field/field-cad-step',
  version: 'v26-27.2',
  versionDate: '2026-09-15',
  sha256: '5e768b731f1ec8dcd14debba53225c43718877923c351ce08504305f68f7fe00',
  capturedOn: '2026-09-17',
};
