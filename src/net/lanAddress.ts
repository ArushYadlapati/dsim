/**
 * WHAT COUNTS AS A LAN SERVER ADDRESS, and whether this page is allowed to open it.
 *
 * A LEAF MODULE with no imports, for the reason `roomRegion.ts` gives: `env.ts` reads
 * `import.meta.env` at load, so the headless smoke run cannot import it at all — and both
 * rules here fail SILENTLY in the browser, which is exactly the kind that has to be testable.
 *
 * Two jobs, and the second one is the one nobody expects:
 *
 * 1. **Parse what a person typed** into a WebSocket URL. People type `192.168.1.5:8787`,
 *    `http://192.168.1.5:8787`, a trailing slash, a stray space.
 *
 * 2. **Say whether the current page can actually open it.** A browser refuses `ws://` from an
 *    `https://` page as mixed content, and it refuses it with nothing but a console line — no
 *    event, no error the app can catch, no retry that will ever work. `localhost` is exempt
 *    (it is a "potentially trustworthy" origin), which is why HOSTING and playing on your own
 *    machine works from the live site while JOINING someone else's does not. Without this
 *    check the failure presents as an ordinary connection problem and the player is told to
 *    try again forever. See docs/lan-selfhost.md.
 */

/** the port the bundled LAN server listens on unless told otherwise */
export const LAN_DEFAULT_PORT = 8787;

export type LanAddressError =
  /** nothing usable in the string at all */
  | 'empty'
  /** not a host we can parse */
  | 'malformed'
  /**
   * A routable public address. LAN hosting is deliberately scoped to networks that are NOT
   * publicly routable (docs/lan-selfhost.md): public self-hosting means port forwarding, a
   * moderation question about server lists, and a much larger promise than "play on the venue
   * wifi". Private blocks, link-local, mDNS names and the tailnet range all pass; anything a
   * stranger could dial does not — see `isPrivateHost` for why the tailnet belongs on this
   * side of the line.
   */
  | 'not-private';

export interface LanAddress {
  /** `ws://host:port` — what a transport connects to */
  url: string;
  /** `http://host:port` — the same origin for `/health` and for serving the client */
  httpUrl: string;
  host: string;
  port: number;
  /** loopback is exempt from the mixed-content rule, so it is worth knowing separately */
  loopback: boolean;
  /**
   * This host holds a REAL CERTIFICATE, so `url` is `wss://` and the mixed-content rule does
   * not apply to it. True for exactly one thing today: a Tailscale MagicDNS name typed with no
   * port — see `isTailnetName` and the scheme choice in `parseLanAddress`.
   */
  tls: boolean;
}

/**
 * A TAILSCALE MAGICDNS NAME — `machine.tailnet-name.ts.net`.
 *
 * The ONE LAN host that can hold a real certificate, which is why it gets its own predicate
 * rather than joining the mDNS suffixes above. `docs/lan-selfhost.md` opens by ruling `wss://`
 * out — "a LAN server cannot realistically hold a TLS certificate for 192.168.1.5" — and that
 * is still true of every other address here. Tailscale issues one for this name, so it is the
 * exception rather than a hole in the reasoning.
 *
 * The leading dot is load-bearing: `evilts.net` is not a tailnet and neither is the bare
 * `ts.net`. Only Tailscale hands out a label under it.
 *
 * ⚠️ THE CAVEAT, and it is the honest one: `tailscale funnel` can publish a `.ts.net` name to
 * the public internet, and serve-vs-funnel is INDISTINGUISHABLE from here — the client sees a
 * name and a certificate either way. So this suffix is the one address in this module that a
 * determined person could aim at the open internet. It stays in scope because the rest of the
 * design is what actually bounds LAN hosting: a funnelled server is still a LAN server, its
 * matches still upload from the HOST's own client (`lanRuns.ts`), and it is still untrusted by
 * `trustedFor` so it never sees an account token. What it is not is a way to run a public
 * server the app treats as a peer of the cloud one.
 */
const isTailnetName = (h: string): boolean => h.endsWith('.ts.net');

const isLoopbackHost = (h: string): boolean =>
  h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h.endsWith('.localhost');

/**
 * Is this a private / link-local address, i.e. something on the network you are sitting on?
 *
 * RFC1918 plus loopback, link-local and mDNS names. Deliberately a WHITELIST: an address that
 * cannot be recognised is refused rather than allowed, because the failure mode of guessing
 * wrong is pointing the app at a stranger's server.
 */
export function isPrivateHost(hostRaw: string): boolean {
  const host = hostRaw.toLowerCase();
  if (isLoopbackHost(host)) return true;
  // mDNS / local DNS suffixes handed out by home and venue routers
  if (host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.home')) return true;
  // a MagicDNS name resolves to the 100.64/10 address below; it is the same host by its name
  if (isTailnetName(host)) return true;
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10), with or without brackets
  const v6 = host.replace(/^\[|\]$/g, '');
  if (/^f[cd][0-9a-f]{2}:/.test(v6) || /^fe[89ab][0-9a-f]:/.test(v6)) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local, what you get with no DHCP
  if (a === 127) return true;
  /**
   * 100.64.0.0/10 — RFC 6598 shared address space, which is where a TAILNET lives.
   *
   * Asked for by a player whose router re-leases every device constantly, so the address on
   * the host's screen was stale by the time anyone finished typing it; they run Tailscale to
   * reach their own machines by a stable address instead. Without this they were told "that
   * address isn't on your local network" about a machine sitting next to them.
   *
   * ⚠️ IT IS THE SECOND OCTET THAT DECIDES, 64..127 — `100.63.x` and `100.128.x` are ordinary
   * PUBLIC addresses and stay refused. `100.` is not a prefix to match on.
   *
   * WHY THIS IS STILL NOT PUBLIC SELF-HOSTING, which is the thing the rule above exists to
   * refuse. The block is not routable on the public internet: no packet reaches one of these
   * from outside, so widening to it cannot turn the box into "point the client at any server
   * anywhere" — a public address still needs port forwarding and is still refused. And a
   * tailnet is not a server anyone can find: every device that can reach it has been
   * authenticated into the host's own private network, one at a time, by the host. That is a
   * higher bar than reading an IP off a projector, not a lower one.
   *
   * THE HONEST CAVEAT: this block is also what ISPs use for real CGNAT, so a player behind one
   * can hold a 100.x address that belongs to their ISP rather than to anything of theirs. The
   * predicate is therefore "not publicly routable" rather than literally "on the wire you are
   * on" — which is what the refusal was always protecting, and the error string still reads
   * correctly for the public addresses it now exclusively names.
   *
   * NOTHING ELSE MOVES. `trustedFor` (`credentials.ts`) is an exact-origin allowlist against
   * the configured cloud servers, so a tailnet host is untrusted exactly like a `192.168` one
   * and never receives the account token. A LAN match still reaches the cloud the same way,
   * from the HOST's own client (`lanRuns.ts`), whatever address the guests dialled.
   */
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/**
 * Turn whatever was typed into a LAN address, or say why not.
 *
 * Accepts a bare `host`, `host:port`, or a full `http://`/`https://`/`ws://`/`wss://` URL.
 *
 * THE SCHEME IS DERIVED, NEVER PRESERVED. A LAN box has no certificate, so echoing back a
 * `wss://` somebody typed at `192.168.1.5` would produce a URL that cannot connect — the answer
 * is `ws://` + `http://` for every address here except a bare tailnet name, which is the one
 * host that really does hold a certificate. See the `tls` branch below.
 */
export function parseLanAddress(raw: string): { ok: true; value: LanAddress } | { ok: false; error: LanAddressError } {
  const text = (raw ?? '').trim();
  if (!text) return { ok: false, error: 'empty' };

  // strip any scheme; everything below works on `host[:port][/path]`
  const noScheme = text.replace(/^(https?|wss?):\/\//i, '');
  const hostPort = noScheme.split('/')[0].trim();
  if (!hostPort) return { ok: false, error: 'empty' };

  let host = hostPort;
  let port = LAN_DEFAULT_PORT;
  // whether the person NAMED a port, which is not the same question as `port === 8787`
  let typedPort = false;
  // IPv6 literals are bracketed, so only split on the LAST colon and only outside brackets
  const bracket = /^\[([^\]]+)\](?::(\d+))?$/.exec(hostPort);
  if (bracket) {
    host = `[${bracket[1]}]`;
    if (bracket[2]) {
      port = Number(bracket[2]);
      typedPort = true;
    }
  } else {
    const i = hostPort.lastIndexOf(':');
    if (i > 0 && /^\d+$/.test(hostPort.slice(i + 1))) {
      host = hostPort.slice(0, i);
      port = Number(hostPort.slice(i + 1));
      typedPort = true;
    }
  }
  // SHAPE BEFORE POLICY. `isPrivateHost` answers false for a public address AND for a
  // string that is not a host at all, and the two need different things said to them: one
  // person typed a real server we decline to reach, the other made a typo. Without this
  // test, `!!!` was reported as "that isn't an address on this network".
  const shaped = bracket
    ? /^\[[0-9a-fA-F:.]+\]$/.test(host)
    : /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(host);
  if (!shaped) return { ok: false, error: 'malformed' };
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'malformed' };
  if (!isPrivateHost(host)) return { ok: false, error: 'not-private' };

  /**
   * A BARE TAILNET NAME IS THE ONE `wss://` CASE, and the bareness is the whole test.
   *
   * `tailscale serve` terminates TLS on 443 and proxies to the game server's own plain-HTTP
   * port. So the name ALONE is the certificate-backed front door, and `host:8787` is the raw
   * server behind it — which has no certificate, exactly like every other address here. Typing
   * a port therefore has to keep producing `ws://`: answering `wss://host:8787` would hand back
   * a URL that cannot connect, which is the failure this module exists to stop.
   */
  const tls = isTailnetName(host.toLowerCase()) && !typedPort;
  if (tls) port = 443;

  return {
    ok: true,
    value: {
      url: tls ? `wss://${host}` : `ws://${host}:${port}`,
      httpUrl: tls ? `https://${host}` : `http://${host}:${port}`,
      host,
      port,
      loopback: isLoopbackHost(host.toLowerCase()),
      tls,
    },
  };
}

/**
 * Will THIS page be allowed to open that socket, or will the browser drop it as mixed content?
 *
 * `pageProtocol` is `location.protocol` ('https:' / 'http:' / 'file:'). Returns null when the
 * connection is fine, or the address a guest should open in their browser instead — which is
 * the only advice that actually works, because no amount of retrying fixes this.
 */
export function mixedContentBlock(addr: LanAddress, pageProtocol: string): string | null {
  if (pageProtocol !== 'https:') return null; // http: and file: may open ws:// freely
  if (addr.tls) return null; // `wss://` is not mixed content — there is nothing to block
  if (addr.loopback) return null; // localhost is a potentially-trustworthy origin, exempt
  return addr.httpUrl;
}
