import { liveLinks, sweepStargazers, type StarSweepResult } from './db/repo';

/**
 * THE GITHUB STAR REWARD's fetch half (`docs/rewards-round2-plan.md` §3.1).
 *
 * ⚠️ **IT ASKS ABOUT THE REPO, NEVER ABOUT THE PERSON.** `GET /repos/<owner>/<repo>/
 * stargazers` is public data and ONE request cycle answers for every linked account at
 * once. The alternative — `GET /user/starred/<owner>/<repo>` per user — needs a stored
 * user token, and a secret at rest is not a thing to take on for a reward worth one decal.
 * That single property is why `provider_links` holds no token, and it is the reason to
 * resist any future reward that would need one.
 *
 * A `GITHUB_TOKEN` is OPTIONAL and buys only rate limit: unauthenticated is 60 requests an
 * hour per IP, authenticated is 5,000. At any plausible star count the sweep is a handful
 * of pages, so the token matters for how OFTEN this can run, not for whether it works.
 */

/** ~how often to sweep. Hourly is plenty: a star is not time-critical and the reward is a decal. */
export const STAR_SWEEP_MS = 60 * 60 * 1000;

const PER_PAGE = 100;
/** a hard stop, so a pagination bug cannot walk the API forever. 100 pages = 10,000 stars. */
const MAX_PAGES = 100;

export interface StargazerFetch {
  ids: string[];
  /**
   * ⚠️ FALSE MEANS "DO NOT ACT ON THIS", AND EVERY FAILURE PATH MUST SET IT. A non-2xx, a
   * timeout, a throw, or a page loop that hit `MAX_PAGES` all produce an INCOMPLETE list,
   * and `sweepStargazers` refuses to revoke on one — because with revocation switched on
   * (owner, 2026-09-21) the same failure that used to mean "no grants this cycle" would
   * otherwise strip the title from every holder at once.
   */
  complete: boolean;
}

/**
 * Every stargazer id for one repo, paginated.
 *
 * ⚠️ AN EMPTY LIST AND A FAILED FETCH ARE DIFFERENT THINGS and this is the boundary where
 * they are still distinguishable — after it, both are `[]`. A repo really can have zero
 * stars; a 502 is not that. So the result carries `complete` rather than letting the caller
 * infer health from length.
 */
export async function fetchStargazers(
  repo: string,
  token?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StargazerFetch> {
  const ids: string[] = [];
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'dsim-rewards',
    'x-github-api-version': '2022-11-28',
  };
  if (token) headers.authorization = `Bearer ${token}`;

  for (let page = 1; page <= MAX_PAGES; page++) {
    let res: Response;
    try {
      res = await fetchImpl(`https://api.github.com/repos/${repo}/stargazers?per_page=${PER_PAGE}&page=${page}`, { headers });
    } catch (e) {
      console.error('[rewards] stargazer fetch threw:', e);
      return { ids, complete: false };
    }
    if (!res.ok) {
      console.error(`[rewards] stargazer fetch ${res.status} on page ${page}`);
      return { ids, complete: false };
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch (e) {
      console.error('[rewards] stargazer body was not json:', e);
      return { ids, complete: false };
    }
    if (!Array.isArray(body)) {
      console.error('[rewards] stargazer body was not an array');
      return { ids, complete: false };
    }
    for (const row of body) {
      const id = (row as { id?: unknown }).id;
      // the numeric account id, as a string — it is what `provider_links` stores, and the
      // LOGIN deliberately is not: a login is re-fetchable and changes, an id does not.
      if (typeof id === 'number' || typeof id === 'string') ids.push(String(id));
    }
    // a short page is the last page
    if (body.length < PER_PAGE) return { ids, complete: true };
  }
  console.error(`[rewards] stargazer fetch hit MAX_PAGES (${MAX_PAGES}) — treating as incomplete`);
  return { ids, complete: false };
}

/**
 * ONE SWEEP: fetch, then hand the set to `sweepStargazers`, which owns the algebra and the
 * fail-safe. Split this way so the interesting half is testable without a network.
 */
export async function runStarSweep(
  repo: string,
  token?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StarSweepResult> {
  /* ⚠️ NO LINKS, NO REQUEST. Until somebody has linked a GitHub account the sweep has
     nobody to grant to, and hitting the API hourly to learn that is wasted traffic against
     a 60-per-hour unauthenticated budget. This is also the state the server is in the
     whole time the provider is not enabled in the Neon Auth project, which is where this
     feature sits until the owner turns it on. */
  if ((await liveLinks('github')).length === 0) return { granted: [], revoked: [], applied: false };
  const got = await fetchStargazers(repo, token, fetchImpl);
  const out = await sweepStargazers(got.ids, got.complete);
  if (!out.applied) {
    console.warn('[rewards] star sweep skipped — the stargazer list could not be trusted');
  } else if (out.granted.length || out.revoked.length) {
    console.log(`[rewards] star sweep: +${out.granted.length} -${out.revoked.length} of ${got.ids.length} stargazers`);
  }
  return out;
}
