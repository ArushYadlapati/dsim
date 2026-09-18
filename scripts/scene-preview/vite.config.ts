import { defineConfig } from 'vite';

/**
 * `scripts/scene-preview` is its own standalone Vite root (`npx vite scripts/scene-preview
 * --port 5178`, `.claude/launch.json`'s `scene-preview` entry) — a throwaway page, never built
 * or tested by anything else in the repo (see `main.ts`'s own header). With no config of its
 * own, Vite defaults `publicDir` to `scripts/scene-preview/public` (which does not exist), so a
 * request for `/models/biobuzz/field.glb` (the CAD field switch-over, `docs/biobuzz/plan-3d.md`
 * §8) 404s to Vite's own SPA fallback — `index.html` — and `GLTFLoader` fails trying to parse
 * that HTML as glTF JSON ("Unexpected token '<' ... is not valid JSON"). Pointing `publicDir` at
 * the REAL project root's `public/` (two levels up from this file) is the fix: it is the same
 * directory `npm run dev`'s Vite instance already serves `/models/biobuzz/*` out of.
 */
export default defineConfig({
  publicDir: '../../public',
});
