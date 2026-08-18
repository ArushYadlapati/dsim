import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, isValidRoomCode } from '../net/roomCode';

/**
 * Discord Activity support (Embedded App SDK). When DSIM is launched as an
 * Activity it runs inside an iframe on `<app-id>.discordsays.com`, and EVERY
 * outbound request must go through Discord's proxy via URL mappings configured
 * in the Developer Portal (see docs/discord-activity.md):
 *
 *   `/`    → the web deployment (Vercel)          — serves this app
 *   `/gs`  → the game server (dohun-sim-decode)   — WS + read APIs + token exchange
 *
 * So in activity mode the game server lives at `wss://<host>/.proxy/gs` (env.ts
 * swaps its server list to that) and Neon Auth is DISABLED (its origin isn't
 * proxied, and redirect OAuth can't run in the iframe anyway) — activity players
 * are identified by Discord instead: `initDiscordActivity()` runs the SDK's
 * authorize → server code-exchange → authenticate flow and exposes the user.
 * Everything here no-ops outside Discord; the normal web/Electron builds are
 * untouched.
 */

/** the Developer-Portal URL-mapping prefix that fronts the game server */
export const DISCORD_PROXY_PATH = '/.proxy/gs';

/** Activity rooms are hosted in ONE fixed region: the room code an instance
 * derives is region-coded (`iad-XXXXXX`) so every participant's WS upgrade
 * fly-replays to the same machine — without this, Anycast would land two
 * cross-continent players in a shared voice channel on DIFFERENT machines and
 * silently split the room. iad is the matchmaker region (always warm). */
const ACTIVITY_ROOM_REGION = 'iad';

/** true when this page is running inside a Discord Activity iframe. Sync (module
 * load) so env.ts can swap the server list before anything connects. Discord
 * launches activities with `?frame_id=…` on the proxy domain. */
export const isDiscordActivity: boolean =
  typeof location !== 'undefined' &&
  (location.hostname.endsWith('.discordsays.com') ||
    new URLSearchParams(location.search).has('frame_id'));

interface DiscordActivityUser {
  id: string;
  username: string;
  global_name?: string | null;
}

let instanceId = '';
let user: DiscordActivityUser | null = null;
// type-only import (erased at compile) — the SDK itself stays dynamically imported
let sdk: import('@discord/embedded-app-sdk').DiscordSDK | null = null;

/**
 * Boot the Embedded App SDK: handshake (`ready`), then identify the player
 * (authorize → exchange the code on OUR game server, which holds the client
 * secret → authenticate). Identity failure is NON-FATAL — the activity still
 * plays, just with the default anonymous name. No-op outside Discord.
 * Called (and awaited) in main.tsx before the first render.
 */
export async function initDiscordActivity(): Promise<void> {
  if (!isDiscordActivity) return;
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID as string | undefined;
  if (!clientId) {
    console.warn('[discord] in an activity but VITE_DISCORD_CLIENT_ID is unset — SDK handshake skipped');
    return;
  }
  try {
    // dynamic import: the SDK never loads (or weighs on) the normal web build
    const { DiscordSDK } = await import('@discord/embedded-app-sdk');
    sdk = new DiscordSDK(clientId);
    await sdk.ready();
    instanceId = sdk.instanceId;
    try {
      const { code } = await sdk.commands.authorize({
        client_id: clientId,
        response_type: 'code',
        state: '',
        prompt: 'none',
        // rpc.activities.write lets discordSetParty publish the "N of M" party
        // size that the invite card and channel presence display
        scope: ['identify', 'rpc.activities.write'],
      });
      const res = await fetch(`${DISCORD_PROXY_PATH}/api/discord/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) throw new Error(`token exchange → ${res.status}`);
      const { access_token } = (await res.json()) as { access_token: string };
      const auth = await sdk.commands.authenticate({ access_token });
      user = auth.user as DiscordActivityUser;
      console.log(`[discord] activity ready — ${user.global_name || user.username}`);
    } catch (e) {
      // declined consent / unconfigured server — play anonymous
      console.warn('[discord] identify failed (playing anonymous):', e);
    }
  } catch (e) {
    console.error('[discord] SDK handshake failed:', e);
  }
}

/** the signed-in Discord player's display name ('' when unknown/not an activity) */
export const discordDisplayName = (): string =>
  user ? user.global_name || user.username : '';

/**
 * Open Discord's invite dialog for THIS activity instance: the player picks a
 * channel/DM and Discord posts the rich invite card (cover image, party size,
 * a Join button that launches the activity into the same instance — which
 * auto-joins the same DSIM lobby via discordInstanceRoomCode). No-op outside
 * an activity; failure is non-fatal.
 */
export async function discordOpenInvite(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.commands.openInviteDialog();
  } catch (e) {
    console.warn('[discord] invite dialog failed:', e);
  }
}

/**
 * Publish the lobby's fill as rich presence — the "3 of 6" bar on the invite
 * card and the member-list activity row. Fire-and-forget (requires the
 * rpc.activities.write scope granted at authorize; a decline just means no
 * party bar, never an error surfaced to the player).
 */
export function discordSetParty(current: number, max: number): void {
  if (!sdk || !instanceId) return;
  void sdk.commands
    .setActivity({
      activity: {
        type: 0,
        state: 'In lobby',
        party: { id: instanceId, size: [current, max] },
      },
    })
    .catch((e) => console.warn('[discord] setActivity failed:', e));
}

/**
 * The room code THIS activity instance shares: everyone who launches the
 * activity in the same voice channel derives the SAME code (a deterministic
 * hash of the SDK's instanceId — no coordination needed) and lands in one
 * lobby. `scope` keeps room KINDS apart (the server refuses a code reuse
 * across kinds), and the region prefix routes every joiner to one machine
 * (see ACTIVITY_ROOM_REGION). '' when not in an activity / before init.
 */
export function discordInstanceRoomCode(scope: string): string {
  if (!instanceId) return '';
  // FNV-1a, re-salted until the 6-char code clears the appropriateness check
  for (let salt = 0; salt < 50; salt++) {
    let h = 0x811c9dc5;
    const s = `${instanceId}:${scope}:${salt}`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_ALPHABET[h % ROOM_CODE_ALPHABET.length];
      h = Math.imul(h ^ (h >>> 15), 0x01000193) >>> 0;
    }
    if (isValidRoomCode(code)) return `${ACTIVITY_ROOM_REGION}-${code}`;
  }
  return `${ACTIVITY_ROOM_REGION}-PLAY42`; // unreachable in practice (see roomCode.ts)
}
