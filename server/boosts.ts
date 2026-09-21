import { ensureSupporterFloor, liveLinks } from './db/repo';

/**
 * THE DISCORD BOOST PERK (`docs/rewards-round2-plan.md` §3.2).
 *
 * A booster gets the supporter entitlement while they are boosting, as a rolling FLOOR on
 * `supporter_until` — never an extension. The bot reads the guild once per sweep and the
 * server never holds a user token, the same property the star reward has.
 */

/** ~how often to sweep. */
export const BOOST_SWEEP_MS = 60 * 60 * 1000;
/** how far ahead each sweep pushes the floor. A lapsed boost expires by ARRIVING. */
export const BOOST_GRACE_DAYS = 7;

const PER_PAGE = 1000;
const MAX_PAGES = 50;

export interface BoosterFetch {
  /** Discord user ids with a non-null `premium_since`. */
  ids: string[];
  /** false ⇒ do not act on this. Every failure path sets it. */
  complete: boolean;
}

/**
 * Every BOOSTING member of one guild.
 *
 * ⚠️ **AN EMPTY LIST IS THE DANGEROUS ANSWER HERE, AND IT IS ALSO WHAT DISCORD RETURNS WHEN
 * THE `GUILD_MEMBERS` INTENT IS OFF — with a 200 and no error.** So "no members came back"
 * is treated as SUSPECT rather than as "nobody is boosting". The consequence of getting this
 * wrong is quieter than the star reward's and therefore easier to miss: the perk is a floor
 * that expires by arriving, so a wrong empty list revokes nothing outright — it just stops
 * extending, and every booster lapses at the end of the grace window with nothing in the log
 * to say why.
 *
 * A guild with genuinely zero members is not a thing (the bot is in it), so treating an
 * empty member page as a failure costs nothing real and closes the silent hole.
 */
export async function fetchBoosters(
  guildId: string,
  botToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BoosterFetch> {
  const ids: string[] = [];
  let after = '0';
  let sawAnyMember = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    let res: Response;
    try {
      res = await fetchImpl(`https://discord.com/api/v10/guilds/${guildId}/members?limit=${PER_PAGE}&after=${after}`, {
        headers: { authorization: `Bot ${botToken}`, 'user-agent': 'dsim-rewards' },
      });
    } catch (e) {
      console.error('[rewards] boost fetch threw:', e);
      return { ids, complete: false };
    }
    if (!res.ok) {
      console.error(`[rewards] boost fetch ${res.status}`);
      return { ids, complete: false };
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ids, complete: false };
    }
    if (!Array.isArray(body)) return { ids, complete: false };
    if (body.length === 0) {
      // ⚠️ see the header: a guild the bot is in always has members, so ZERO of them is
      // the intent-is-off signature rather than a fact about the guild. Not a MAX_PAGES
      // case — saying so would send whoever reads the log looking at pagination.
      return { ids, complete: sawAnyMember };
    }
    sawAnyMember = true;
    for (const m of body) {
      const row = m as { premium_since?: unknown; user?: { id?: unknown } };
      const id = row.user?.id;
      if (row.premium_since && (typeof id === 'string' || typeof id === 'number')) ids.push(String(id));
      if (typeof id === 'string' || typeof id === 'number') after = String(id);
    }
    if (body.length < PER_PAGE) {
      // ⚠️ see the header: a guild the bot is in always has members, so zero of them is the
      // INTENT-IS-OFF signature and not a fact about the guild.
      return { ids, complete: sawAnyMember };
    }
  }
  console.error('[rewards] boost fetch hit MAX_PAGES — treating as incomplete');
  return { ids, complete: false };
}

export interface BoostSweepResult {
  floored: string[];
  applied: boolean;
}

/**
 * Push the supporter floor for every linked booster. The set algebra half, so it is testable
 * without a network — exactly the split `sweepStargazers` uses.
 *
 * ⚠️ NOTHING IS REVOKED HERE, EVER. The floor is a DEADLINE and a lapsed boost expires by
 * arriving; there is no revocation job and no un-granting, which is `0018`'s own argument for
 * an instant over a boolean applied a third time. So an incomplete fetch is still refused —
 * not because it would revoke, but because silently ceasing to extend is the same outage
 * with a week's delay and no log line.
 */
export async function sweepBoosters(boosters: readonly string[], complete: boolean): Promise<BoostSweepResult> {
  if (!complete) return { floored: [], applied: false };
  const boosting = new Set(boosters);
  const links = await liveLinks('discord');
  const floored: string[] = [];
  for (const l of links) {
    if (!boosting.has(l.providerUserId)) continue;
    if (await ensureSupporterFloor(l.userId, BOOST_GRACE_DAYS)) floored.push(l.userId);
  }
  return { floored, applied: true };
}

/** one sweep: read the guild, then apply the floors. */
export async function runBoostSweep(
  guildId: string,
  botToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BoostSweepResult> {
  // no links, no request — the same reason the star sweep skips (and the state this sits in
  // until the owner creates the Discord application at all).
  if ((await liveLinks('discord')).length === 0) return { floored: [], applied: false };
  const got = await fetchBoosters(guildId, botToken, fetchImpl);
  const out = await sweepBoosters(got.ids, got.complete);
  if (!out.applied) console.warn('[rewards] boost sweep skipped — the member list could not be trusted');
  else if (out.floored.length) console.log(`[rewards] boost sweep: ${out.floored.length} floors pushed`);
  return out;
}
