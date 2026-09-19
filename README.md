# DSIM

![DSIM](./dsim-logo.png)

A 2D/3D driver-practice simulator for FIRST Tech Challenge. Vite + React +
TypeScript on Canvas 2D, with a Rapier3D + Three.js path for games that use it.

Three games ("seasons") are playable:

- **DECODE presented by RTX** (FTC 2025–26) — full solo match + free drive,
  scoring per manual, motif randomization, physical basin/rail/gate classifier.
- **Chain Reaction** (2026 Unofficial-FTC CAD-competition game) — 300-particle
  bespoke physics, three shooter archetypes, catalysts and hooks, ring-stand
  ascend/descend.
- **BIOBUZZ presented by RTX** (FTC 2026–27) — full match, scored and ranked,
  playable in 2D or 3D physics + view.

## Play online

**[playdsim.com](https://www.playdsim.com/)** — no install required.

[Discord](https://discord.gg/YB4tXnx7Pj) ·
[Instagram](https://www.instagram.com/playdsim/) ·
[Ko-fi](https://ko-fi.com/playdsim)

## Features

- **Solo practice** against AI opponents (where the game has them), plus free
  drive with no opponent.
- **Online multiplayer** through an authoritative game server (Node + `ws` on
  Fly), so all players share one authoritative simulation rather than syncing
  peer state.
- **Accounts**: Glicko-2 ranked play, leaderboards, and personal-best/world-record
  tracking, kept separately per game.
- **Replays**, recorded from real matches and exportable as video.
- **LAN / self-hosting**: a tab on your own network can host a room without the
  public game server.
- **In-app tutorial** for learning the controls and objective of a game.
- **Desktop build** (Electron) for Windows/macOS/Linux, downloadable from the
  site or built from source.

## Run it

```bash
npm install
npm run dev        # dev server at http://localhost:5173
npm test           # headless sim verification (both games)
npm run build      # tsc (strict) + vite build
npm run server     # the authoritative game server, locally
```

Deployment: the client is a static Vite build, deployed to Vercel with zero
configuration; the game server runs on Fly. See `docs/deploy.md` and
`docs/area/netcode.md` for the actual deploy protocol — it has rules that are
expensive to get wrong.

## Desktop app (Electron)

```bash
npm run electron   # run the desktop shell against the current build
npm run dist       # package a Windows installer into release/
```

## Contributing

Contributions are welcome — read [`CONTRIBUTING.md`](./CONTRIBUTING.md) first.
All contributors must agree to the [Contributor License Agreement](./CLA.md).

The engineering rules live in [`CLAUDE.md`](./CLAUDE.md) (what is true
everywhere) and `docs/area/` (the guide for whatever you're about to touch) —
read the one for your area before your first edit there.

## License

Source-available under the [PolyForm Noncommercial License 1.0.0](./LICENSE):
you may use, study, modify, and share it for **noncommercial** purposes.
Commercial use requires a separate license from the copyright holder. This is
*not* an OSI open-source license.

This project is an independent, fan-made simulator, not affiliated with,
authorized by, endorsed by, or sponsored by FIRST, FIRST Tech Challenge, or
RTX Corporation. "FIRST", "FTC", "DECODE", "DECODE presented by RTX", and
"RTX" are trademarks and/or copyrighted works of their respective owners,
referenced here only to describe, factually, the real-world games this
simulator practices for. See [`NOTICE`](./NOTICE) for the full disclaimer and
third-party software credits.
