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
 * ⚠️ **`GITHUB_TOKEN` IS REQUIRED, NOT OPTIONAL, AND THIS COMMENT USED TO SAY THE OPPOSITE.**
 * MEASURED against the live API on 2026-09-21, anonymously and from a clean rate-limit budget
 * (57 of 60 remaining), on a repo that is genuinely public (`GET /repos/genius0412/dsim` → 200,
 * `"private": false`):
 *
 *     GET /repos/genius0412/dsim/stargazers        → 401 {"message":"Requires authentication"}
 *     …the same request with an `authorization` header → 200, 7 ids
 *
 * So the endpoint needs a credential even though the DATA is public, and the old note — that a
 * token buys rate limit alone — was wrong about whether this works at all.
 *
 * ⚠️ AND THE FAILURE IS SILENT BY CONSTRUCTION, which is why `runStarSweep` refuses BEFORE the
 * request rather than letting the 401 fall into the `!res.ok` path. Everything downstream is
 * built to do nothing when it cannot trust the list, so a missing token would have produced a
 * sweep that ran hourly, logged one generic status line, granted nothing, revoked nothing, and
 * looked from the outside exactly like a repo nobody had starred.
 *
 * ⚠️ **AND IT NEEDS THE `public_repo` SCOPE. "NO SCOPES" WAS TRIED AND IS WRONG** — see the
 * 404 branch in `fetchStargazers`, which carries the measurement. An unscoped classic PAT
 * authenticates, reads `/repos/<repo>` and `/contributors`, and 404s on `/stargazers`; GitHub
 * uses 404 rather than 403 there, so the one status that reads as a typo is the one that means
 * the token is too weak. `repo` is measured working; `public_repo` is its read-only subset.
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
      /**
       * ⚠️ **A 401 HERE IS A DEAD CREDENTIAL, AND IT HAS TO SAY SO IN THOSE WORDS.**
       * The missing-token refusal above only catches a token that is ABSENT. One that has
       * EXPIRED or been revoked is present, reaches this line, and without this branch prints
       * `stargazer fetch 401` — which is the same quiet no-op having no token used to be,
       * arriving a year later when nobody remembers the reward exists. A fine-grained token
       * caps out around a year, so this is the ordinary end of its life, not an edge case.
       *
       * 403 is TWO different things and they get different sentences: GitHub answers 403 for
       * rate limiting with `x-ratelimit-remaining: 0`, and 403 for a token that authenticated
       * but may not read this. Rate limiting is self-healing and the next sweep is in an hour,
       * so it is a note; the other is not.
       */
      const rl = res.headers.get('x-ratelimit-remaining');
      if (res.status === 401) {
        console.error(
          '[rewards] THE GITHUB STAR REWARD IS OFF: the GITHUB_TOKEN was REJECTED (401). It has ' +
            'expired, been revoked, or was copied wrong. No star can be seen until it is replaced. ' +
            'It needs NO scopes — it reads public data.',
        );
      } else if (res.status === 403 && rl === '0') {
        console.warn(`[rewards] stargazer fetch rate-limited (403, remaining 0) on page ${page} — retrying next sweep`);
      } else if (res.status === 403) {
        console.error(`[rewards] stargazer fetch FORBIDDEN (403) on page ${page} — the token authenticated but may not read ${repo}`);
      } else if (res.status === 404) {
        /**
         * ⚠️ **A 404 HERE IS A MISSING SCOPE, NOT A MISSING REPO, AND GITHUB WILL NOT SAY
         * SO.** It answers 404 rather than 403 on this endpoint so that an unauthorised caller
         * cannot use the status to learn a repo exists — which means the one status that reads
         * as "you typed the name wrong" is also the one that means "your token is too weak".
         *
         * MEASURED 2026-09-21. An unscoped classic PAT, authenticated (5,000/hr, `/user` 200,
         * `/repos/<repo>` 200 on the same repo):
         *
         *     /repos/genius0412/dsim/stargazers   404      /repos/.../contributors  200
         *     /repos/genius0412/dsim/subscribers  404      /users/octocat/followers 200
         *     /repos/octocat/Hello-World/stargazers 404    /repos/.../forks         200
         *
         * So it is not the repo and it is not privacy — starring and watching are simply gated
         * where the neighbouring list endpoints are not. GraphQL does not route around it: the
         * same token reads `stargazerCount: 7` and gets ZERO nodes from the connection, which
         * is a worse failure because it looks like a successful query. A token carrying `repo`
         * returns all seven by either route; `public_repo` is the read-only subset of it and is
         * the least a token needs here.
         */
        console.error(
          `[rewards] THE GITHUB STAR REWARD IS OFF: 404 on ${repo}'s stargazers WITH a token. On ` +
            'this endpoint GitHub returns 404 for a MISSING SCOPE, not a missing repo. Give ' +
            'GITHUB_TOKEN the `public_repo` scope. (An unscoped token reads /repos and ' +
            '/contributors fine, which is what makes this one look like a typo.)',
        );
      } else {
        console.error(`[rewards] stargazer fetch ${res.status} on page ${page}`);
      }
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

/** the missing-token warning, said ONCE — an hourly timer would otherwise bury the log. */
let warnedNoToken = false;
export function warnNoToken(): void {
  if (warnedNoToken) return;
  warnedNoToken = true;
  console.warn(
    '[rewards] THE GITHUB STAR REWARD IS OFF: no GITHUB_TOKEN. The stargazers endpoint answers ' +
      '401 without one even for a public repo, so no star can ever be seen. It needs the ' +
      '`public_repo` scope — an unscoped token gets a 404 here, which reads like a typo: ' +
      'fly secrets set GITHUB_TOKEN=... -a <app>',
  );
}
/** test seam — the warning is once-per-process, and a suite runs many processes' worth. */
export function resetNoTokenWarning(): void {
  warnedNoToken = false;
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
  /* ⚠️ NO TOKEN, NO SWEEP — AND IT SAYS SO, ONCE, IN WORDS THAT NAME THE FIX. The endpoint
     answers 401 without one (see the header), and every layer below this is built to do
     nothing when it cannot trust the list. Falling into the generic `!res.ok` line would
     therefore be a feature that is switched off and cannot be told apart from a feature that
     is on with nobody using it. Refusing here, by name, is the difference. */
  if (!token) {
    warnNoToken();
    return { granted: [], revoked: [], applied: false };
  }
  /* ⚠️ NO LINKS, NO REQUEST. Until somebody has linked a GitHub account the sweep has
     nobody to grant to, and hitting the API hourly to learn that is wasted traffic. This is
     also the state the server is in the whole time the provider is not enabled in the Neon
     Auth project, which is where this feature sits until the owner turns it on. */
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
