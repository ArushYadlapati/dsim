import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { LinkProvider } from './db/repo';

/**
 * LINKING AN EXTERNAL ACCOUNT — one authorization-code flow, two providers.
 *
 * ⚠️ **THE SERVER DOES THE CODE EXCHANGE, AND THAT IS THE WHOLE POINT OF THIS FILE.** The
 * obvious shortcut is to let the CLIENT link through the auth SDK and then POST "my GitHub
 * id is 1001" for the server to record. That is unforgeable-looking and completely
 * forgeable: anybody could post a stargazer's id and collect the reward for a star somebody
 * else gave. `LobbyPlayer.role` is server-authored for exactly this reason
 * (`docs/area/accounts.md` — "a self-declared 'owner' beside a driver's name is an
 * impersonation primitive"), and a self-declared LINK is the same primitive one step back.
 * Here the id arrives from the PROVIDER, over the back channel, in response to a code the
 * provider itself issued. The client never names it.
 *
 * ⚠️ **AND NO TOKEN IS EVER STORED.** The access token exists for the length of one identity
 * fetch and is dropped; `provider_links` (0047) holds the immutable id and two timestamps.
 * Everything downstream asks the platform about its OWN resource — the repo's stargazers,
 * the guild's members — so the server never needs to act as the user again. Requesting
 * `offline_access` or keeping a refresh token would break that property, and the only reason
 * to do it is a reward that cannot be checked any other way.
 *
 * It also means **neither provider depends on the auth SDK**. Discord could not use it at
 * all (Neon Auth offers Google, GitHub and Vercel only), and once the flow exists for
 * Discord, routing GitHub through the same one costs nothing and removes a dependency on a
 * dashboard setting rather than adding one.
 */

/** the scopes each provider is asked for — the minimum that yields a stable account id. */
interface ProviderCfg {
  authorizeUrl: string;
  tokenUrl: string;
  identityUrl: string;
  /** ⚠️ IDENTITY ONLY. Nothing here asks to act on the user's behalf. */
  scope: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  /** pull the immutable account id out of the identity response. */
  readId(body: unknown): string | null;
}

const PROVIDERS: Record<LinkProvider, ProviderCfg> = {
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    identityUrl: 'https://api.github.com/user',
    // GitHub needs no scope at all to read the authenticated user's own public id.
    scope: '',
    clientIdEnv: 'GITHUB_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GITHUB_OAUTH_CLIENT_SECRET',
    readId: (b) => idOf(b),
  },
  discord: {
    authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    identityUrl: 'https://discord.com/api/users/@me',
    // `identify` and nothing more: the BOT reads the guild, so this never needs
    // `guilds.members.read` and never needs to be replayed later.
    scope: 'identify',
    clientIdEnv: 'DISCORD_OAUTH_CLIENT_ID',
    clientSecretEnv: 'DISCORD_OAUTH_CLIENT_SECRET',
    readId: (b) => idOf(b),
  },
};

function idOf(b: unknown): string | null {
  const id = (b as { id?: unknown } | null)?.id;
  return typeof id === 'number' || typeof id === 'string' ? String(id) : null;
}

export function linkConfigured(provider: LinkProvider): boolean {
  const c = PROVIDERS[provider];
  return !!process.env[c.clientIdEnv] && !!process.env[c.clientSecretEnv];
}

/**
 * THE STATE SECRET IS PER BOOT, ON PURPOSE.
 *
 * A stateless signed `state` is what carries the DSIM user id across the redirect without a
 * server-side session table. It needs a key, and a per-boot random one is better here than
 * another env var for the owner to manage and rotate: the only cost is that a link in flight
 * across a deploy has to be started again, and the failure direction is a refusal rather
 * than an accepted forgery. There is nothing to leak in a restart.
 */
const STATE_KEY = randomBytes(32);
/** a link has to be completed promptly; a stale `state` is refused. */
const STATE_TTL_MS = 10 * 60 * 1000;

function sign(payload: string): string {
  return createHmac('sha256', STATE_KEY).update(payload).digest('base64url');
}

export function makeState(provider: LinkProvider, userId: string, now = Date.now()): string {
  const payload = `${provider}.${Buffer.from(userId).toString('base64url')}.${now}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * Verify a returned `state` and recover the user it was issued to.
 *
 * ⚠️ CONSTANT-TIME COMPARISON, and the length check before it. A `===` on a signature is a
 * timing oracle; `timingSafeEqual` throws on a length mismatch, which is why the lengths are
 * compared first rather than letting it throw into the request handler.
 */
export function readState(state: string, now = Date.now()): { provider: LinkProvider; userId: string } | null {
  const parts = state.split('.');
  if (parts.length !== 4) return null;
  const [provider, user64, issued, sig] = parts;
  if (provider !== 'github' && provider !== 'discord') return null;
  const expect = sign(`${provider}.${user64}.${issued}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const at = Number(issued);
  if (!Number.isFinite(at) || now - at > STATE_TTL_MS || now - at < -60_000) return null;
  let userId: string;
  try {
    userId = Buffer.from(user64, 'base64url').toString();
  } catch {
    return null;
  }
  return userId ? { provider, userId } : null;
}

/** where the provider sends the browser back. One route, the provider in the path. */
export function redirectUri(origin: string, provider: LinkProvider): string {
  return `${origin.replace(/\/$/, '')}/api/link/${provider}/callback`;
}

/** the URL to send the browser to. Null when the provider has no credentials configured. */
export function authorizeUrl(provider: LinkProvider, origin: string, userId: string): string | null {
  const c = PROVIDERS[provider];
  const clientId = process.env[c.clientIdEnv];
  if (!clientId || !process.env[c.clientSecretEnv]) return null;
  const u = new URL(c.authorizeUrl);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri(origin, provider));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('state', makeState(provider, userId));
  if (c.scope) u.searchParams.set('scope', c.scope);
  return u.toString();
}

/**
 * Exchange the code and read the account id back. Returns null on ANY failure — a provider
 * that did not cooperate must not produce a link, and there is nothing a partial answer here
 * could usefully mean.
 */
export async function exchangeForId(
  provider: LinkProvider,
  code: string,
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const c = PROVIDERS[provider];
  const clientId = process.env[c.clientIdEnv];
  const clientSecret = process.env[c.clientSecretEnv];
  if (!clientId || !clientSecret) return null;
  try {
    const res = await fetchImpl(c.tokenUrl, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri(origin, provider),
      }).toString(),
    });
    if (!res.ok) return null;
    const tok = (await res.json()) as { access_token?: unknown };
    const token = typeof tok.access_token === 'string' ? tok.access_token : null;
    if (!token) return null;

    const who = await fetchImpl(c.identityUrl, {
      headers: {
        accept: 'application/json',
        'user-agent': 'dsim-rewards',
        authorization: provider === 'github' ? `Bearer ${token}` : `Bearer ${token}`,
      },
    });
    if (!who.ok) return null;
    return c.readId(await who.json());
    // the token goes out of scope here and is never written anywhere — see the header.
  } catch {
    return null;
  }
}
