// Throwaway Vite config for the field CAD preview (`npx vite scripts/field-cad/preview --port
// 5179`, `.claude/launch.json`'s "field-cad-preview" configuration). Only reason this file
// exists at all: the preview needs to fetch `/models/biobuzz/*.glb` from the REPO's
// `public/`, but Vite's default `publicDir` is relative to ITS OWN root
// (`scripts/field-cad/preview`), which has no `public/` of its own.
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  publicDir: path.resolve(here, '../../../public'),
});
