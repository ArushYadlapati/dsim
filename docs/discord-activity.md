# DSIM as a Discord Activity

DSIM runs as a [Discord Activity](https://discord.com/developers/docs/activities/overview)
(Embedded App SDK): players launch it from a voice channel and everyone in that
channel lands in the **same multiplayer lobby automatically** — the room code is
derived deterministically from the activity `instanceId`, so no code sharing is
needed. The code integration is done (`src/lib/discordActivity.ts`); this doc is
the one-time Discord/Deploy configuration.

## How it works

- Activities are iframes served through Discord's proxy at
  `https://<APP_ID>.discordsays.com`. A strict CSP means **every** outbound
  request must go through **URL mappings** (Developer Portal → Activities):
  the root mapping serves the web app, and a second mapping fronts the game
  server for the WebSocket + read APIs.
- `isDiscordActivity` (sync, detected from `?frame_id` / the discordsays host)
  flips three things at boot, all no-ops on the normal web build:
  - `src/net/env.ts` swaps the server list to `wss://<host>/.proxy/gs`.
  - `src/lib/authClient.ts` disables Neon Auth (its origin isn't proxied, and
    redirect OAuth can't run in an iframe). Activity runs are **anonymous** —
    no records/ELO writes — but players get their **Discord display name** via
    the SDK identity flow.
  - `main.tsx` awaits `initDiscordActivity()` (SDK `ready()` → `authorize()` →
    server code exchange → `authenticate()`) before mounting.
- The Lobby auto-joins the per-instance room. Activity room codes are
  **region-coded `iad-XXXXXX`** and passed as the `?room=` fly-replay hint, so
  every participant lands on the same machine regardless of which Fly region
  Anycast picked for them (activity matches always host in `iad`).
- The one-time authorize `code` is exchanged for an `access_token` at
  `POST /api/discord/token` on the game server (the client secret never ships
  to the browser; the refresh token never leaves the server).
- The lobby's **✉ Invite** chip (activity only) calls the SDK's
  `openInviteDialog()` — Discord posts the rich invite card (cover image +
  Join button) to a channel/DM the player picks; Join launches the SAME
  activity instance, which auto-joins the same lobby. `discordSetParty`
  mirrors the lobby fill into rich presence (the card's "N of M" bar) via
  `setActivity`, which is why `rpc.activities.write` is in the authorize
  scopes.

## One-time setup

### 1. Discord Developer Portal

1. <https://discord.com/developers/applications> → **New Application** (e.g. "DSIM").
2. Note the **Application ID** (= client id) and, under **OAuth2**, the
   **Client Secret**. No OAuth2 redirect URL is needed (activities exchange the
   code directly, without `redirect_uri`).
3. **Activities → Enable Activities.**
4. **Activities → URL Mappings:**

   | Prefix | Target |
   |--------|--------|
   | `/`    | `<your web deployment host>` (the Vercel domain, no scheme) |
   | `/gs`  | `dohun-sim-decode.fly.dev` |

   The `/gs` prefix is `DISCORD_PROXY_PATH` in `src/lib/discordActivity.ts` —
   keep them in sync if you ever rename it. Mappings support only ports 80/443
   (both fine here).
5. **Activities → Settings**: enable the platforms you want (web/iOS/Android)
   and set max participants (a DSIM room is 4 players + spectators).
6. **Art assets**: the **Cover Image** (Rich Presence → 1024×576, 16:9) is the
   tile shown in the Activities shelf AND the image on chat invite cards — until
   it's uploaded the shelf shows a broken-image placeholder. The small round
   icon is the separate **App Icon** (General Information). The Discord client
   caches these; Ctrl+R Discord after uploading.

### 2. Environment

- **Vercel (client build):** `VITE_DISCORD_CLIENT_ID=<Application ID>` — then
  redeploy (Vite bakes it in at build time).
- **Fly (game server):**

  ```sh
  fly secrets set DISCORD_CLIENT_ID=<Application ID> DISCORD_CLIENT_SECRET=<Client Secret> -a dohun-sim-decode
  ```

  (Secrets-set restarts the machines; deploy with `./scripts/fly-deploy.sh` as
  usual — never a bare `flyctl deploy`.)

Until these are set everything degrades gracefully: the SDK handshake is
skipped without a client id, and `/api/discord/token` answers 503 — players
would just be anonymous "Player"s.

### 3. Try it

1. Discord → **User Settings → Advanced → Developer Mode** ON.
2. Join a voice channel → the rocket/controller **Activities** button → your
   app appears (as an in-development activity, visible to the app's team).
3. Two accounts launching it in the same channel should land in one lobby
   with their Discord names pre-filled.

### Local development against a tunnel

To iterate without deploying, map the mappings at a tunnel instead:

```sh
npm run dev              # client on :5173
npm run server           # game server on :8787
cloudflared tunnel --url http://localhost:5173   # → https://<rand1>.trycloudflare.com
cloudflared tunnel --url http://localhost:8787   # → https://<rand2>.trycloudflare.com
```

Point the URL mappings `/` → `<rand1>.trycloudflare.com` and `/gs` →
`<rand2>.trycloudflare.com` (Developer Portal changes apply live), and set
`VITE_DISCORD_CLIENT_ID` in `.env` + `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET`
in the server shell. Note Vite may need the tunnel host allowed
(`server.allowedHosts` in `vite.config.ts`) if it refuses the proxied Host
header.

## Constraints & deliberate scope (v1)

- **Anonymous inside Discord**: Neon Auth is off in the iframe, so no ranked,
  records, or leaderboard writes from activity sessions (ranked already
  requires sign-in, so those screens self-gate). A future "parallel Discord
  identity" (server-minted JWTs for `discord:<id>` users) would lift this —
  the token-exchange endpoint added here is the first half of that work.
- **Activity rooms host in `iad`** (see `ACTIVITY_ROOM_REGION`) — the
  deterministic shared code can't know participants' regions in advance, and a
  fixed region guarantees one machine. Fine for v1; revisit if EU/Asia voice
  channels report lag.
- **Same room kind per instance**: the instance code is scoped by room kind
  (versus vs duo-record), and the first joiner's game (DECODE/Chain Reaction)
  wins — a joiner on the other game gets the standard "different game mode"
  error.
