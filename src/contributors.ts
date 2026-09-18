import { hdriEnvironments } from './games/biobuzz/graphics/environments';

/**
 * The Contributors page's roster.
 *
 * This is HAND-MAINTAINED, and deliberately so: none of it is derivable from the
 * account system. Auth is Neon Auth only — there is no Discord OAuth anywhere in
 * this codebase, so a Discord avatar or profile link can't be looked up, and a
 * contributor's game account (if they even have one) isn't linked to their GitHub
 * handle either. Keep it in step with `CONTRIBUTORS.md`, which is the CLA record;
 * this file is only what the page renders.
 *
 * EVERY field except `fallbackName` is optional, and the card degrades cleanly
 * without each one — a contributor with no game account, no Discord, or no avatar
 * still renders. That matters because the page must also work when the game server
 * is unreachable (a cold Fly machine, or a Vercel preview with no
 * `VITE_GAME_SERVER_URL`), where NO live handle resolves for anyone.
 */
export interface Contributor {
  /** Shown until (or instead of) a live game handle resolves. Required — it is the
   * only thing standing between a cold server and a page of blank cards. */
  fallbackName: string;
  /** Short role/credit line, e.g. "Project owner". */
  role?: string;
  /** In-game username (the `/profile/<username>` slug). Drives the LIVE display
   * name and the profile link. Omit for contributors with no game account: the
   * card then shows `fallbackName` and isn't clickable. */
  inGameUsername?: string;
  /** Full Discord CDN avatar URL. Omit to render initials instead. */
  discordAvatarUrl?: string;
  /** Discord profile link (`https://discord.com/users/<id>`). */
  discordUrl?: string;
  /** GitHub profile link. */
  githubUrl?: string;
}

/**
 * TODO(fill in): `discordAvatarUrl`, `discordUrl`, and `inGameUsername` have to be
 * collected from each contributor — they aren't recorded anywhere in the repo. The
 * names and GitHub handles below come straight from `CONTRIBUTORS.md`. Cards render
 * correctly with the fields still missing, so this list can be completed one person
 * at a time without breaking the page.
 */
export const CONTRIBUTORS: Contributor[] = [
  {
    fallbackName: 'Dohun Kim',
    role: 'Project owner',
    inGameUsername: 'ace',
    githubUrl: 'https://github.com/genius0412',
  },
  {
    fallbackName: 'Felix D',
    inGameUsername: 'felix',
    githubUrl: 'https://github.com/crescent',
  },
  {
    fallbackName: 'Baron',
    inGameUsername: 'Baron',
    githubUrl: 'https://github.com/BaronClaps',
  },
  {
    fallbackName: 'therealkingcob',
    githubUrl: 'https://github.com/therealkingcob',
  },
  {
    fallbackName: 'Shaan Sridhara',
  },
  {
    fallbackName: 'Aadvik G',
    inGameUsername: 'aadvikg_',
    githubUrl: 'https://github.com/alarmclock011',
  },
];

/**
 * THIRD-PARTY ASSETS the app ships or fetches — credited on the same page, in their own
 * section.
 *
 * ── WHY IT IS DERIVED AND NOT TYPED OUT ────────────────────────────────────────────────────
 * The entries are built from `BB_ENVIRONMENTS` (`src/games/biobuzz/graphics/environments.ts`),
 * which is the list the Graphics section's environment picker renders from. So adding a third
 * HDRI credits it by CONSTRUCTION: there is no second list to remember to update, and the
 * failure this prevents — a shipped asset with no credit on the credits page — is the kind
 * nobody notices until somebody outside the project does.
 *
 * Poly Haven's assets are CC0, which requires no attribution at all. It is given anyway, with
 * the author roles the API reports, because "we did not have to" is not a reason not to.
 */
export interface ThirdPartyAsset {
  /** the asset's own name, as its source calls it. */
  name: string;
  /** who made it, and at what — photography and processing are often different people. */
  credits: readonly { name: string; role: string }[];
  license: string;
  licenseUrl: string;
  /** the asset's page, for anyone who wants the original. */
  page: string;
  /** where it is used in DSIM, in one clause. */
  use: string;
  /** the library it came from. */
  source: string;
}

export const THIRD_PARTY: ThirdPartyAsset[] = hdriEnvironments().map((e) => ({
  name: e.name,
  credits: e.hdri!.authors,
  license: e.hdri!.license,
  licenseUrl: e.hdri!.licenseUrl,
  page: e.hdri!.page,
  use: 'BIOBUZZ 3D environment lighting',
  source: 'Poly Haven',
}));
