/**
 * ENVIRONMENTS — the procedural surrounds plus the two CC0 HDRI sets (`docs/biobuzz/plan-3d.md`
 * §4.5), as DATA. No three.js here: `scene/renderEnvironment.ts` is what loads one, and the
 * Graphics section and the Contributors page both read this list, neither of which may pull the
 * renderer chunk in.
 *
 * ── WHY THE EIGHT ADDED ON 2026-09-21 ARE ALL PROCEDURAL ───────────────────────────────────
 * The owner asked for "more choices for the 3d field background". Every one of them is PAINTED
 * — an equirectangular canvas a few hundred pixels across, built once per id and kept — rather
 * than a ninth, tenth, eleventh photographed room. Three reasons, in order of how much they
 * bind:
 *   • A DOWNLOAD IS A COST THE PLAYER PAYS TO LOOK AT SOMETHING. The two HDRIs are 1.6 MB each
 *     and the picker prints their size for that reason; eight more would be 13 MB of scenery
 *     behind a settings row. A painted dome is a few hundred bytes of source.
 *   • THE TIER LADDER. `envLighting` is OFF on Low and Medium, and an HDRI that is not lighting
 *     anything is a download for a backdrop — so those two tiers had no surround to pick at all.
 *     A painted dome costs nothing to fetch, so `renderEnvironment.ts` still paints it with the
 *     image-based lighting off and only the light-gathering map is dropped. The whole list is
 *     live on every tier now, which it was not.
 *   • LEGIBILITY IS A SETTABLE NUMBER, NOT A PROPERTY OF A PHOTOGRAPH. Each of these carries
 *     its own `rig` — sun direction and colour, both hemisphere terms, the exposure — chosen so
 *     the alliance reds/blues, the yellow POLLEN and the blue NECTAR keep their separation and
 *     the mat never goes so dark or so bright that a shadow or the shot-path line disappears.
 *     A photographed room's cast is whatever the photographer's afternoon was.
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

/**
 * THE LIGHT RIG ONE ENVIRONMENT ASKS FOR — plain numbers, because this file may not import
 * three.js and `scene/renderEnvironment.ts`'s `applyEnvironmentRig` is what turns them into
 * light objects.
 *
 * ⚠️ **THE FIELD'S OWN COLOURS ARE FIXED AND EVERY VALUE HERE MOVES THEM.** The tiles, the tape,
 * the alliance reds/blues, the yellow POLLEN and the blue NECTAR are drawn at constants (§4.5,
 * and `draw.ts`'s note on why an element's fill does not theme), so the ONLY thing that can push
 * them out of their contrast pairs is the lighting. Hence: no rig tints the key light past a
 * warm/cool cast a camera would white-balance out, and the hemisphere GROUND term stays near
 * neutral everywhere — a saturated bounce is what turns a red NECTAR on a red tray into one
 * shape. The measured numbers are in the RENDER lane and in this session's report.
 */
export interface EnvironmentRig {
  /** hemisphere fill: the term above the horizon, and the bounce off the floor. */
  hemiSky: number;
  hemiGround: number;
  /** hemisphere intensity WITH image-based lighting, and WITHOUT — with the IBL off it is most
   * of the ambient term there is, so it has to carry more. Same split `renderCore.ts` makes for
   * the shared default. */
  hemiIbl: number;
  hemiNoIbl: number;
  /** the key light's position, field inches. Only its DIRECTION matters (a `DirectionalLight`),
   * but it is written as a position because that is what three takes and what the shadow
   * camera is sized against. */
  sun: readonly [number, number, number];
  sunColor: number;
  sunIntensity: number;
  /** ACES exposure for this place (`renderer.toneMappingExposure`). */
  exposure: number;
}

/**
 * ONE STOP of the painted dome: how far down from the zenith (0 = straight up, 0.5 = the
 * horizon, 1 = straight down) and the colour there. Linearly interpolated between stops.
 */
export type SkyStop = readonly [number, number];

/**
 * THE PAINTED SURROUND — what `renderEnvironment.ts` draws onto an equirectangular canvas, which
 * is then BOTH `scene.background` AND (when image-based lighting is on) the source the PMREM
 * mip chain is generated from. One texture for both is the point: a surround that lit the field
 * from a hall while showing a sunset would read as a compositing mistake, which is the same
 * reason the HDRI path sets the background to its own map.
 */
export interface EnvironmentLook {
  /** the vertical gradient, zenith to nadir. At least two stops. */
  sky: readonly SkyStop[];
  /** a soft bright disc — a sun, or a bank of ceiling lamps. `az` is degrees around the dome and
   * `el` degrees above the horizon; `r` is its angular radius. */
  lamp?: { az: number; el: number; r: number; color: number };
  /** a bright BAR ringing the dome at one elevation: a lighting truss, a row of strip lights, a
   * floodlight bank. `h` is its angular height in degrees. */
  truss?: { el: number; h: number; color: number };
  /** a dark toothed band below the horizon — stands, bleachers, shelving. Read as a silhouette
   * once the background's own blur is applied, which is all a surround has to do. */
  silhouette?: { top: number; bottom: number; color: number; alpha: number; teeth: number };
  /** a deterministic star field in the upper dome. */
  stars?: boolean;
  /** how far the BACKGROUND is blurred and dimmed. A painted dome is already soft, so it takes
   * less of both than a photograph does (`BG_BLUR`/`BG_INTENSITY` in the renderer are the
   * HDRI's own, unchanged). */
  blur: number;
  intensity: number;
}

export interface EnvironmentDef {
  id: EnvironmentId;
  /** the picker's label. */
  name: string;
  /** what it does to the picture, in the one line the picker has room for. Present only where
   * it names a real trade-off — `docs/ui-standard.md` §8 deletes a description that restates
   * its own label, and "Gym" does not need a sentence about gyms. */
  note: string;
  /** the light rig this place asks for. Every entry carries one; the three that predate the
   * 2026-09-21 set carry `BASE_RIG`, which IS `renderCore.ts`'s shared default, so none of them
   * changed a pixel when this field was added. */
  rig: EnvironmentRig;
  /** the painted dome. Absent means the surround comes from somewhere else: three's own
   * `RoomEnvironment` for `room` (whose background is the THEMED letterbox colour), or the
   * fetched image for an `hdri` entry. */
  look?: EnvironmentLook;
  /** absent for a procedural entry: it is generated, it has no author and it costs nothing. */
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

/**
 * THE RIG THE THREE ORIGINAL ENVIRONMENTS ARE LIT BY — the same numbers `renderCore.ts` declares
 * as `SCENE_*`, repeated here as data so a `rig` is not optional on one entry and present on the
 * others. It is a COPY on purpose, for the reason `readBackdropColor`'s fallback literal is one:
 * `graphics/` may not import anything under `scene/`, and the RENDER lane asserts the two agree
 * rather than leaving it to a habit.
 *
 * Every value was tuned against the match view in the 2026-09-18 playtest; `renderCore.ts` has
 * the reasoning on each constant, and the robot-builder preview still lights from THOSE, so a
 * build cannot come out one colour in the garage and another on the field.
 */
export const BASE_RIG: EnvironmentRig = {
  hemiSky: 0xffffff,
  hemiGround: 0x4b525c,
  hemiIbl: 1.3,
  hemiNoIbl: 2.1,
  sun: [60, -80, 140],
  sunColor: 0xffffff,
  sunIntensity: 1.9,
  exposure: 1.2,
};

export const BB_ENVIRONMENTS: readonly EnvironmentDef[] = [
  {
    id: 'room',
    name: 'Practice room',
    note: 'Generated, nothing to download',
    rig: BASE_RIG,
  },
  {
    /**
     * A COMPETITION HOUSE: the audience side dark, the light coming off a truss ring. This is the
     * one environment whose surround is DARKER than the field, and that is the whole shot — an
     * FTC division field at a championship is a bright island in a dark hall, and it is the most
     * flattering the mat ever looks. The rig has to carry all of it (the dome contributes almost
     * no ambient), so the sun is the brightest of the eleven and steeper than the default, which
     * is also what an overhead truss does.
     */
    id: 'arena',
    name: 'Competition arena',
    note: 'Dark house, truss overhead',
    rig: {
      hemiSky: 0xdfe8ff,
      hemiGround: 0x2a2f38,
      hemiIbl: 2,
      hemiNoIbl: 2.5,
      sun: [40, -60, 170],
      sunColor: 0xf2f6ff,
      sunIntensity: 2.1,
      exposure: 1.38,
    },
    look: {
      sky: [
        [0, 0x0a0d12],
        [0.34, 0x141a22],
        [0.5, 0x1d2530],
        [0.62, 0x161c25],
        [1, 0x0d1117],
      ],
      truss: { el: 22, h: 3.2, color: 0xd8e6ff },
      silhouette: { top: 0.52, bottom: 0.68, color: 0x080b10, alpha: 0.85, teeth: 26 },
      blur: 0.18,
      intensity: 0.85,
    },
  },
  {
    /**
     * THE ROOM MOST PRACTICE ACTUALLY HAPPENS IN. A wood floor is the reason it is worth having
     * as well as the school hall HDRI: the bounce is warm and it comes from BELOW, which lifts
     * the underside of a chassis and the inside of a hive cell in a way no overhead rig does.
     * The hemisphere ground term is the warmest of the eleven for exactly that, and it is still
     * well short of a saturated brown — see `EnvironmentRig`'s own warning.
     */
    id: 'gym',
    name: 'School gym',
    note: 'Warm ceiling light off a wood floor',
    rig: {
      hemiSky: 0xfff6e6,
      hemiGround: 0x6b5c45,
      hemiIbl: 1.25,
      hemiNoIbl: 2,
      sun: [50, -70, 150],
      sunColor: 0xfff4e0,
      sunIntensity: 1.85,
      exposure: 1.15,
    },
    look: {
      sky: [
        [0, 0xe8e4d8],
        [0.3, 0xd8d2c2],
        [0.5, 0xbfae8e],
        [0.6, 0xa98b60],
        [1, 0x8d7049],
      ],
      lamp: { az: 90, el: 68, r: 26, color: 0xfff8e8 },
      silhouette: { top: 0.5, bottom: 0.58, color: 0x4a3a28, alpha: 0.28, teeth: 14 },
      blur: 0.22,
      intensity: 0.8,
    },
  },
  {
    /**
     * A TEAM'S OWN SHOP — dark walls, a concrete floor and two rows of strip lights, which is
     * what the `truss` band is here. It is the darkest surround after the arena and the night
     * sky, and the one with the warmest key; the pair is deliberate, because a warm key on a
     * neutral-dark ground is where the yellow POLLEN reads at its very best.
     */
    id: 'workshop',
    name: 'Workshop',
    note: 'Strip lights over dark walls',
    rig: {
      hemiSky: 0xffeedd,
      hemiGround: 0x3a3a3e,
      hemiIbl: 1.95,
      hemiNoIbl: 2.45,
      sun: [70, -50, 130],
      sunColor: 0xffefd6,
      sunIntensity: 1.8,
      exposure: 1.35,
    },
    look: {
      sky: [
        [0, 0x2b2b2e],
        [0.36, 0x3a3a3e],
        [0.5, 0x47433d],
        [0.64, 0x2f2d2b],
        [1, 0x232326],
      ],
      truss: { el: 42, h: 4.5, color: 0xfff0d0 },
      silhouette: { top: 0.5, bottom: 0.66, color: 0x18181b, alpha: 0.62, teeth: 18 },
      blur: 0.2,
      intensity: 0.85,
    },
  },
  {
    /**
     * OUTDOORS UNDER CLOUD — the one environment with almost no key. The sun is the WEAKEST of
     * the eleven and the hemisphere the strongest, because that is what an overcast sky is: a
     * dome of light and barely a shadow. It is also the most forgiving background there is for
     * reading a field, which is why it is in the list at all.
     */
    id: 'overcast',
    name: 'Overcast day',
    note: 'Flat daylight, soft shadows',
    rig: {
      hemiSky: 0xeef4fa,
      hemiGround: 0x7c828a,
      hemiIbl: 1.5,
      hemiNoIbl: 2.3,
      sun: [30, -40, 180],
      sunColor: 0xffffff,
      sunIntensity: 1.3,
      exposure: 1.1,
    },
    look: {
      sky: [
        [0, 0xd6dee6],
        [0.36, 0xc6d0da],
        [0.5, 0xb4bcc2],
        [0.58, 0xa3a8ac],
        [1, 0x8e9296],
      ],
      blur: 0.28,
      intensity: 0.8,
    },
  },
  {
    /**
     * A WARM KEY FROM ONE SIDE, low enough to throw a long shadow and no lower — see the two
     * measurements this entry is the reason for.
     *
     * ⚠️ **THE SUN IS AT 40°, NOT AT THE 15° A SUNSET ACTUALLY IS.** The first pass put it there
     * (`[-150, -60, 42]`) and MEASURED the whole mat at a rendered luminance of **0.0018** — pure
     * black, against 0.046 for the shipping `school-hall` and 0.097 for the room. A grazing key
     * lands only `cos(15°) = 0.25` of itself on a horizontal floor, the perimeter walls then put
     * the first 40 in of every edge in shadow, and the tile grid, the element shadows and the
     * shot-path line all go with it. Raising the ambient instead does NOT fix it: hemisphere
     * intensity 1.15 → 2.6 → 3.2 moved the mat only 0.0018 → 0.0102 → 0.0110, because the floor's
     * albedo is dark and the ambient term is a small share of it. The key's own ANGLE was the
     * whole variable. At 40° the shadows are still visibly long and the mat measures in the band
     * every other environment is in.
     *
     * The other risk is the one the colour carries: a deep orange key collapses the yellow POLLEN
     * and the red NECTAR toward one hue. `sunColor` is therefore held at a light amber rather
     * than the sunset the DOME is painted as — the sky carries the mood and the key carries the
     * legibility, and they are allowed to disagree.
     */
    id: 'sunset',
    name: 'Sunset',
    note: 'Warm key, long shadows',
    rig: {
      hemiSky: 0xffd9b0,
      hemiGround: 0x3a3140,
      hemiIbl: 2.2,
      hemiNoIbl: 2.7,
      sun: [-130, -55, 120],
      sunColor: 0xffd2a0,
      sunIntensity: 2,
      exposure: 1.3,
    },
    look: {
      sky: [
        [0, 0x2a3a5e],
        [0.3, 0x55527a],
        [0.44, 0xa8705c],
        [0.5, 0xd98a52],
        [0.56, 0x9a6448],
        [1, 0x7d6253],
      ],
      lamp: { az: 200, el: 6, r: 5, color: 0xffd9a0 },
      blur: 0.2,
      intensity: 0.85,
    },
  },
  {
    /**
     * FLOODLIT UNDER A DARK SKY. Structurally the arena's twin — a dark dome and a bright ring —
     * and kept as its own entry because the two read completely differently: the arena's ring is
     * a warm-white truss close overhead and the light falls off, while this is a cool bank far
     * out and the field is evenly lit. The stars are the only decoration in the whole list that
     * does nothing for the lighting; they are what says "outdoors" rather than "a dark room".
     */
    id: 'night',
    name: 'Night',
    note: 'Floodlit under a dark sky',
    rig: {
      hemiSky: 0xc8d8ff,
      hemiGround: 0x1a1f2a,
      hemiIbl: 2.3,
      hemiNoIbl: 2.8,
      sun: [20, -50, 190],
      sunColor: 0xdfe9ff,
      sunIntensity: 2,
      exposure: 1.38,
    },
    look: {
      sky: [
        [0, 0x050912],
        [0.34, 0x0a1020],
        [0.5, 0x141c2e],
        [0.62, 0x0b101a],
        [1, 0x070a10],
      ],
      truss: { el: 30, h: 2.2, color: 0xbcd0ff },
      stars: true,
      blur: 0.16,
      intensity: 0.9,
    },
  },
  {
    /**
     * A NEUTRAL CYCLORAMA, BRIGHT — the studio the photographed one already is, generated, and
     * with no cast at all. It is the environment to pick when the question is what a BUILD looks
     * like rather than what a match feels like, and it is the brightest surround in the list:
     * the dark mat sits on a near-white ground, which is the highest contrast the field ever has
     * against its own letterbox.
     */
    id: 'cyc-light',
    name: 'Light studio',
    note: 'Bright neutral surround',
    rig: {
      hemiSky: 0xffffff,
      hemiGround: 0xa8adb4,
      hemiIbl: 1.2,
      hemiNoIbl: 2,
      sun: [60, -80, 140],
      sunColor: 0xffffff,
      sunIntensity: 1.7,
      exposure: 1.12,
    },
    look: {
      sky: [
        [0, 0xf4f5f6],
        [0.4, 0xe9eaec],
        [0.5, 0xdfe1e4],
        [0.7, 0xd4d7da],
        [1, 0xcfd2d6],
      ],
      lamp: { az: 120, el: 55, r: 30, color: 0xffffff },
      blur: 0.3,
      intensity: 0.78,
    },
  },
  {
    /**
     * THE SAME CYCLORAMA, DARK. Its own entry rather than a theme switch on the one above, for
     * the reason `src/theme.ts` keeps the field out of the theme entirely: which surround flatters
     * a field is a framing choice, not a light/dark preference, and a player on a dark UI may
     * well want the bright one. The rig is the base rig with a slightly lifted ground term, so
     * the difference between the two really is only the ground the field is standing on.
     */
    id: 'cyc-dark',
    name: 'Dark studio',
    note: 'Dark neutral surround',
    rig: {
      hemiSky: 0xffffff,
      hemiGround: 0x33373d,
      hemiIbl: 1.95,
      hemiNoIbl: 2.45,
      sun: [60, -80, 140],
      sunColor: 0xffffff,
      sunIntensity: 1.95,
      exposure: 1.35,
    },
    look: {
      sky: [
        [0, 0x24262a],
        [0.4, 0x1c1e22],
        [0.5, 0x17191c],
        [0.7, 0x141619],
        [1, 0x121417],
      ],
      lamp: { az: 120, el: 55, r: 30, color: 0xf0f4ff },
      blur: 0.3,
      intensity: 0.85,
    },
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
    // the photographed rooms keep the SHARED rig they were tuned against — a fetched HDRI is
    // already the ambient term, and giving it a second opinion about the key light would change
    // two pictures that nothing asked to change (this is also the EXPORT's environment; see
    // `GFX_PRESETS.high`).
    rig: BASE_RIG,
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
    name: 'Photo studio',
    note: 'Neutral softboxes, 1.6 MB',
    rig: BASE_RIG,
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

/** the ids in the order the picker shows them — the one place the list's ORDER is read, so the
 * settings coercer and the RENDER lane cannot fall out of step with the array above. */
export const BB_ENVIRONMENT_IDS: readonly EnvironmentId[] = BB_ENVIRONMENTS.map((e) => e.id);
