# Robot customization (cosmetics) — plan

Roadmap item 3. A design for the owner to approve; no code ships with this document.
Build branch: `feat/cosmetics`, off `alpha`, after approval.

---

## 1. Goal and non-goals

**Goal.** Let every player personalize their robot's look — chassis colour (already
built), a new accent colour, a decal, and a sign-plate style — gated by three tiers
(free / supporter / earned), rendered identically in the 2D canvas and the BIOBUZZ 3D
scene, validated so a client can never grant itself something it has not unlocked, and
carried by replays so an old recording keeps the look it was made with.

**Non-goals**, stated up front because they are where a cosmetics feature drifts:

- **Never touch physics.** No cosmetic key changes a collider, mass, or anything
  `src/sim/` reads. Build step: a smoke check that `worldHash`
  (`src/net/checksum.ts:19`) is bit-identical across every cosmetic value.
- **Never override alliance identity.** The outline and the sign-panel fill stay
  red/blue; a cosmetic recolours the chassis *fill* only, exactly as `chassisColor`
  already does (`src/render/drawRobot.ts:30-33`).
- **The wire never carries colours, images or free text.** Every axis is a closed,
  allowlisted set of keys, the discipline `CHASSIS_COLORS` already uses
  (`src/config.ts:2901-2911`): no CSS/SVG parsing off the wire, every value pre-vetted
  for field contrast, no colour that means something else (artifact green).
- **Paid and earned stay separate ledgers.** A supporter's palette is a time-boxed
  entitlement (`supporter_until`); an earned unlock is permanent account state. Mixing
  them means a lapsed membership deletes something earned, or an earned unlock quietly
  becomes something sold. See section 3.2 and `docs/rewards-plan.md`.
- **No moderation surface.** No free-text plates, no uploaded images. Every axis is
  closed-set, so nothing here ever needs the name-scrub pass (`server/moderation.ts`).

---

## 2. What exists today, and the gaps

| exists | citation |
|---|---|
| `RobotSpec.chassisColor?: string`, optional so old saves/replays stay valid | `src/types.ts:114-117` |
| `CHASSIS_COLORS`, a 7-key allowlist (default/slate/plum/moss/rust/navy/cocoa), `chassisFill(key)` | `src/config.ts:2912-2929` |
| `coerceSpec` accepts the key only if in `CHASSIS_COLOR_KEYS`, else falls back to `base.chassisColor` — shape-safe, never a free string | `src/sim/spawn.ts:256-260` |
| All three games' 2D sprites fill with `chassisFill(spec.chassisColor)`, stroke with the alliance colour — correct and consistent already | `src/render/drawRobot.ts:30-33`, `src/games/chain/drawRobot.ts:197`, `src/games/biobuzz/drawRobot.ts:165` |
| `ChassisColorRow`: shown to everyone, real-hex swatches, a locked swatch is `disabled` (not hidden) with an `aria-label`/`title` of "supporter perk" | `src/ui/Menu.tsx:142-179`, used at :710, :1101 |
| `MAX_SAVED_ROBOTS = 3` — cosmetics ride per saved `RobotSpec`, not per account | `src/config.ts:2803` |
| A fuzz check that `coerceSpec` only accepts allowlisted `chassisColor` keys | `scripts/smoke.ts:510` |

**Gaps, ranked by how much they matter:**

1. **3D renders the alliance colour, not the cosmetic — a real bug.**
   `buildRobotGroup` (`src/games/biobuzz/scene/renderRobots.ts:286-298`) sets the
   chassis mesh colour to `r.alliance === 'blue' ? BLUE : RED` (line 290/295) and never
   reads `spec.chassisColor`. The perk that DECODE/Chain render correctly is invisible
   in BIOBUZZ 3D. The rebuild plumbing already works — `specKey` includes
   `chassisColor` at line 210 — only the paint step ignores it.
2. **No server-side entitlement check — only a UI gate.** `coerceSpec` validates
   *shape* (one of 7 keys) but never *entitlement* (`spawn.ts:256-260`). A hand-edited
   spec — localStorage, a saved slot, or a raw `update` message — can set any of the 7
   keys regardless of supporter status; nothing downstream ever asks whether the
   account is allowed to have it. Closing this is this plan's main server change.
3. **No account-level unlock storage.** Every cosmetic choice lives inside a
   `RobotSpec`; nothing records what an account has *unlocked*, unlike `profiles.role`
   (`server/db/migrations/0020_staff_roles.sql:29`) or `profiles.settings jsonb`
   (`0003_profile_settings.sql:5`).
4. **Only `chassisColor` exists.** No accent, decal, or plate style anywhere.
5. **Today's free tier is stricter than the roadmap sketch.** `Menu.tsx:169` disables
   every non-default swatch for a non-supporter — free is exactly one colour today. The
   sketch proposes "default + two colours" (`docs/roadmap.md:80`), a widening, not a
   restatement — flagged as decision 1 below rather than assumed.
6. **The sign panel is alliance-coloured by design and must stay that way.**
   `getSignTexture` (`renderRobots.ts:167-199`) fills the placard red/blue with the
   slot number — a "plate style" cosmetic can only be a border ornament around it.

---

## 3. Design

### 3.1 The registry — `src/cosmetics.ts`

One shared module, read by both renderers and `coerceSpec`, structured like
`CHASSIS_COLORS`:

| axis | field | values (proposed) | drawn as |
|---|---|---|---|
| chassis colour | `chassisColor` (existing) | the 7 keys, unchanged | chassis fill |
| accent | `accent` (new) | the same 7 hexes plus `'match'` (= chassis) | wheel/roller fill in `drawWheels` |
| decal | `decal` (new) | `'none'` default, `'stripe'`, `'chevron'`, plus owner picks (§5) | vector shape over the chassis fill (2D); a second material region (3D) |
| plate | `plate` (new) | `'classic'` default plus 1-2 frame styles | a border drawn around `getSignTexture`'s fixed fill |

Each is a closed enum, clamped in `coerceSpec` exactly like `chassisColor` is today
(falls back to `base.<field>` on anything unrecognised). No new numeric ranges.

Decals/plates are **drawn shapes, not images** — a `Path2D` in 2D, a baked
`CanvasTexture` in 3D (the technique `getSignTexture` already uses), selected by key.
That is what keeps this out of moderation entirely.

### 3.2 Where each piece is stored

- **The per-robot choice** lives in `RobotSpec`, exactly like `chassisColor` — three
  more optional fields beside it (`src/types.ts:114-117`), riding saved slots, live
  setups, and replay `setups` for free.
- **The account's unlocks** are new server-authored state:
  `profiles.cosmetics jsonb not null default '[]'`, an array of `"<axis>:<key>"`
  strings (e.g. `"decal:chevron"`), written only by the server — Ko-fi grant, admin
  action, or a rewards-ledger unlock (`docs/rewards-plan.md` §3) — never by a client,
  the same trust model as `profiles.role`. A supporter's palette is *not* individually
  listed here — it unlocks at once off the existing `SUPPORTER_COL` predicate
  (`server/db/repo.ts:355-357`). `profiles.cosmetics` holds only **earned, permanent**
  unlocks, so they survive a lapsed membership — keeping paid and earned separate per
  §1. Every write should log its source the way `supporter_grants` logs
  `supporter_until` changes (`0019_supporter_billing.sql:53-68`, `repo.ts:604-656`).

### 3.3 Validation: closing the entitlement gap

`coerceSpec`'s allowlist clamp stays as-is — shape safety, applied everywhere it runs,
including **replay re-simulation**, which must always coerce to something spawnable
regardless of who is watching today.

Entitlement is a **separate check at the server's live ingress points only** —
join/update in `server/room.ts` — never inside `coerceSpec`. This mirrors the
saved-start cap: "Only the editor's Save button applies the free cap. Sanitizing to the
free cap would DELETE a supporter's poses before the entitlement resolved"
(`docs/area/monetization.md`). Baking entitlement into `coerceSpec` would silently
downgrade an **old replay's** cosmetics to the *viewer's current* entitlements,
breaking "old replays keep their look" the first time a membership lapses or a decal is
re-tiered.

So: `stripUnentitledCosmetics(spec, unlocked)` runs only where a client actively
*declares* a spec to the server, after `coerceSpec` has shape-validated it, downgrading
any unowned axis to its default using the unlock set `/api/user/entitlements` already
computes (`server/api.ts:521-538`) plus `profiles.cosmetics`. Replay `createWorld` and
the local preview never call it.

### 3.4 Rendering, from one module

- **2D**: add the accent fill to `drawWheels`; draw the decal `Path2D` after the
  chassis fill, before the outline (inside the existing footprint clip,
  `drawRobot.ts:39-59`); draw the plate frame around the existing sign geometry.
- **3D** (`renderRobots.ts`): fix `buildRobotGroup` to fill the chassis with
  `chassisFill(spec.chassisColor)` and move the alliance tint onto a trim element (the
  existing `NOSE` cone at line 300 is already alliance-independent and could carry it
  instead) — the fill must stop being alliance-only. Add the accent to `buildWheels`,
  the decal as a second material region, the plate as a thin frame mesh in front of the
  sign plane (:310-321) — the sign's texture/fill stays untouched. `specKey`
  (:203-218) grows the three new fields the same way it already carries `chassisColor`.
- DECODE/Chain Reaction stay 2D-only; nothing here forces a 3D generator on them.

### 3.5 Replays and the wire

No format change: a replay is `{seed, setups, commands}` (`docs/area/netcode.md`), and
`setups` already carries full `RobotSpec`s, so the new fields ride for free — an old
replay simply has them `undefined`, defaulted like an absent `chassisColor` is today.
This is also why entitlement enforcement must stay out of `coerceSpec` (§3.3).

**Backward compatibility.** These are brand-new fields with no older equivalent to
mirror (contrast `intakeMount`/`intakeSide`). An older server's `coerceSpec` simply
drops them on join — "no accent, no decal, classic plate," a safe silent default, not a
crash. No `CLIENT_CAPS` gate needed for this alone.

### 3.6 The picker UI

One row per axis, following `ChassisColorRow` exactly (`Menu.tsx:142-179`): every
option always visible, a locked one `disabled` with an `aria-label`/`title` stating why
("supporter perk" / "earned — see Career"). Decal/plate rows need a small rendered
swatch (cached per option, the way `getSignTexture` caches per id). Follows
`docs/ui-standard.md`'s tokens; no literal spacing in JSX.

### 3.7 Tiers

| tier | grants | mechanism |
|---|---|---|
| free | default on every axis, plus whatever the owner opens up (§5) | always allowed |
| supporter | the full existing palette, except earned-only items | `SUPPORTER_COL` |
| earned | specific keys from a loyalty milestone or season award | `profiles.cosmetics`, written by `docs/rewards-plan.md`'s ledgers |

### 3.8 Migration and entitlements

New migration (next free number, `0040_cosmetics.sql`):
`alter table profiles add column if not exists cosmetics jsonb not null default '[]'`
— additive, same shape as `0003_profile_settings.sql:5`. `GET /api/user/entitlements`
(`server/api.ts:521-538`) and `Entitlements` (`src/net/api.ts:1763-1777`) grow an
optional `unlockedCosmetics?: string[]` — never trusted client-side; the server still
independently strips on join (§3.3).

---

## 4. Build plan

| step | size | verification |
|---|---|---|
| 1. `src/cosmetics.ts` registry; extend `RobotSpec` + `coerceSpec` clamps | 0.5 d | `npm run build`; extend the `smoke.ts:510` fuzz to the 3 new fields |
| 2. Migration for `profiles.cosmetics`; `stripUnentitledCosmetics` at join/update; grant/audit write path | 1 d | `npm run dbtest` |
| 3. Fix the 3D fill gap; wire accent/decal/plate into both renderers from one module | 1 d | visual pass, both themes; `npm run build` |
| 4. `worldHash` invariance smoke check across cosmetic combinations | 0.5 d | `npm test` (stays ~39s) |
| 5. Builder UI rows; entitlements payload + client type | 1 d | `npm run uiaudit`, `npm run contrast`, `npm run shiftaudit` |
| 6. Add `src/cosmetics.ts` to `docs/area/physics.md`'s `governs:` line (else `docaudit` flags it unowned) | 0.1 d | `npm run docaudit` |

**Total:** ~4.1 d, inside the roadmap's 3-4 d estimate. Branch `feat/cosmetics`.

**Risks.**

- Getting §3.3's split wrong (entitlement inside `coerceSpec`) silently breaks old
  replays the first time a tier changes — the compiler cannot catch this; only a check
  that coerces a `setups` blob with no DB access and gets the recorded cosmetics back
  unchanged can. This is the load-bearing decision in the plan.
- The 3D fill fix touches `buildRobotGroup`, which roadmap item 1 (3D robot creator
  menu) also touches this sprint — sequence, do not run in parallel on diverging
  branches.
- A decal must be defined parametrically (a fraction of the footprint), or it clips or
  floats on an odd chassis shape, the same class of bug the footprint clip in
  `drawRobot.ts:39-53` already exists to prevent.

---

## 5. Decisions for the owner

1. **Free tier width.** Keep "default only," or widen to "default + two colours" per
   the roadmap sketch (`docs/roadmap.md:80`)? If widened, which two colours?
2. **Decal set.** A first cut of 3-4 decals — names and look, needed before the
   registry can be written.
3. **Editable number plates.** Whether the team-number placard becomes
   player-editable at all (this plan keeps it fixed). If yes: numbers only, no free
   text, moderated like robot/team names (`server/persist.ts:26-34`) — bigger scope
   than the plate *frame* styling in §3.1, likely its own follow-up.
4. **Cosmetics on leaderboard rows.** Whether the spec-stats block on
   `src/ui/Leaderboard.tsx` shows the cosmetic choice, or stays as-is.
5. **Plate frame set.** How many styles, and whether any are earned-only.
