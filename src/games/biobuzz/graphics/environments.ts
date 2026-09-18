/**
 * ENVIRONMENTS — the procedural room plus the two CC0 HDRI sets (`docs/biobuzz/plan-3d.md`
 * §4.5), as DATA. No three.js here: `scene/renderEnvironment.ts` is what loads one, and the
 * Graphics section and the Contributors page both read this list, neither of which may pull the
 * renderer chunk in.
 *
 * ── THE RULES §4.5 SETS, AND HOW EACH IS KEPT ──────────────────────────────────────────────
 * "fetched on demand as a 1k `.hdr`"          — `url` is Poly Haven's own CDN, hit by
 *                                               `RGBELoader` the first time an id is selected.
 * "browser-cached"                            — `dl.polyhaven.org` answers with
 *                                               `Cache-Control: max-age=14400`, so a second
 *                                               pick inside four hours is a memory-cache hit
 *                                               and no request at all. Measured 2026-09-18.
 * "never in any chunk"                        — nothing under `public/`, no `import`, no
 *                                               base64. The bytes only ever exist in the
 *                                               browser's HTTP cache.
 * "attribution on the Contributors page"      — `src/contributors.ts` renders `THIRD_PARTY`,
 *                                               which is built from this list, so an entry
 *                                               added here is credited by construction rather
 *                                               than by somebody remembering.
 *
 * ── LICENCE ────────────────────────────────────────────────────────────────────────────────
 * Every Poly Haven asset is CC0 1.0 (public domain dedication): no attribution is REQUIRED.
 * It is given anyway, in full, with the author split the API reports — photography and
 * processing are often different people and crediting only the first is the usual way that
 * gets wrong.
 */

import type { EnvironmentId } from './settings';

export interface EnvironmentDef {
  id: EnvironmentId;
  /** the picker's label. */
  name: string;
  /** what it does to the picture, in the one line the picker has room for. Present only where
   * it names a real trade-off — `docs/ui-standard.md` §8 deletes a description that restates
   * its own label, and "Gym" does not need a sentence about gyms. */
  note: string;
  /** absent for the procedural room: it is generated, it has no author and it costs nothing. */
  hdri?: {
    /** the 1k `.hdr` on Poly Haven's CDN. Verified 2026-09-18: 200, `Access-Control-Allow-Origin: *`. */
    url: string;
    /** bytes, from the Poly Haven files API — printed in the picker so a player on a phone
     * plan knows what a pick costs before making it. */
    bytes: number;
    /** the asset's own page, for the credit line. */
    page: string;
    /** as the API reports them, role and all. */
    authors: readonly { name: string; role: string }[];
    license: 'CC0 1.0';
    licenseUrl: string;
  };
}

/** Poly Haven's 1k HDR path. One template rather than three literals, so a mistyped slug is a
 * 404 on one asset instead of a URL that points at somebody else's file. */
const PH_HDR = (slug: string): string => `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/${slug}_1k.hdr`;
const PH_PAGE = (slug: string): string => `https://polyhaven.com/a/${slug}`;
const PH_LICENSE = 'https://polyhaven.com/license';

export const BB_ENVIRONMENTS: readonly EnvironmentDef[] = [
  {
    id: 'room',
    name: 'Practice room',
    note: 'Generated, nothing to download',
  },
  {
    /**
     * A SCHOOL HALL WITH A WOODEN FLOOR AND A STAGE — chosen over the two fitness-gym sets
     * (`gym_01`, `crossfit_gym`) and the climbing gym because it is the room an FTC event is
     * actually held in: a high ceiling, overhead fluorescents, and a floor bright enough to
     * bounce light back under a chassis. A weights room lights a robot from one wall.
     */
    id: 'school-hall',
    name: 'School hall',
    note: 'Overhead hall lighting, 1.7 MB',
    hdri: {
      url: PH_HDR('school_hall'),
      bytes: 1_693_261,
      page: PH_PAGE('school_hall'),
      authors: [
        { name: 'Dimitrios Savva', role: 'Photography' },
        { name: 'Jarod Guest', role: 'Processing' },
      ],
      license: 'CC0 1.0',
      licenseUrl: PH_LICENSE,
    },
  },
  {
    /**
     * A NEUTRAL STUDIO, and neutral is the requirement rather than a preference: the tiles and
     * the tape keep fixed on-field colours so the HUD's contrast pairs hold (§4.5), and a
     * warm- or blue-cast studio would push every one of them without any of the tokens
     * changing. `monochrome_studio_02` is white softboxes over a dark ceiling — the light is
     * colourless by construction, so what it adds is shape, not a tint.
     */
    id: 'monochrome-studio',
    name: 'Studio',
    note: 'Neutral softboxes, 1.6 MB',
    hdri: {
      url: PH_HDR('monochrome_studio_02'),
      bytes: 1_562_415,
      page: PH_PAGE('monochrome_studio_02'),
      authors: [{ name: 'Grzegorz Wronkowski', role: 'All' }],
      license: 'CC0 1.0',
      licenseUrl: PH_LICENSE,
    },
  },
];

export function environmentDef(id: EnvironmentId): EnvironmentDef {
  return BB_ENVIRONMENTS.find((e) => e.id === id) ?? BB_ENVIRONMENTS[0];
}

/** every environment that costs a download — what the Contributors page credits. */
export function hdriEnvironments(): EnvironmentDef[] {
  return BB_ENVIRONMENTS.filter((e) => e.hdri);
}
