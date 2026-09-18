<!-- governs: src/ads/**, server/kofi.ts, src/legalText.ts, src/analytics.ts -->
# Monetization — ads and the supporter tier

Perks are cosmetic or convenience ONLY — never anything affecting how a robot drives or scores.

*Split out of `CLAUDE.md` on 2026-09-16, **verbatim** — CLAUDE.md is loaded into every
session and this is not needed by most of them. The `governs:` line above is read by
`scripts/docaudit.mjs` and by the editor hook, so keep it accurate when paths move.*

---

## Monetization (branch `monetization`) — ads + supporter tier

Not yet deployed. `HANDOFF.md` has the full write-up; the load-bearing rules:

- **`src/ads/adsense.ts` is the single gate.** Ads are OFF unless `VITE_ADSENSE_CLIENT`
  is set, and are suppressed unconditionally in the Electron build (AdSense forbids app
  wrappers), on touch, and for supporters. `AdsProvider` FAILS CLOSED — ads stay off
  until the entitlement check settles, so a supporter never sees a flash of them.
- **Ads are NON-PERSONALIZED by default and tagged TFUAC.** DSIM simulates FTC
  (grades 7–12) and the sim is fully playable SIGNED OUT, so most impressions carry no
  age signal. `VITE_ADSENSE_PERSONALIZED=1` is a deliberate opt-in. TFCD (COPPA) stays
  off: the terms set 13+, so asserting child-directed would be inaccurate, not cautious.
- **A CMP (Google Funding Choices) is REQUIRED, not optional** — without a certified CMP
  Google serves EEA/UK/CH users no ads at all. It loads with the client id; the message
  itself is authored in the AdSense dashboard. The footer "Privacy & cookie settings"
  link must keep existing (consent you can't withdraw isn't consent).
- **Three ad units, each with its own slot id**: `menu` (shell pages) and `results`
  (post-match) are SAFE; `game` (columns flanking the live field) is the risky one —
  60 Hz canvas + AdSense's 150px game-clearance rule. **Do not enable
  `VITE_ADSENSE_SLOT_GAME` without first comparing p95 frame time via `?perf=1`**
  (`GameController.getFrameStats`).
- **`/ads.txt` is GENERATED** from `VITE_ADSENSE_CLIENT` in `vite.config.ts` — never
  commit one, it would drift.
- **Supporter tier is Ko-fi.** `server/kofi.ts` is a PURE policy module (no DB, no
  import-time env) deciding what a payment buys: a subscription payment is always
  exactly 1 month; a one-off buys `floor(amount/price)` months, capped; a foreign
  currency buys nothing. Months are priced ONCE at webhook time and stored on the row.
- **`profiles.kofi_email` is what makes a membership RENEW.** The first manual claim
  links the payer address; every later webhook from it grants automatically. The UNIQUE
  index is also the only thing stopping one subscription covering many accounts.
- **Every write to `supporter_until` logs a `supporter_grants` audit row** (source =
  kofi/admin/revoke). Two actors can move that column; "why does this account have a
  membership?" has to stay answerable.
- **Perks are cosmetic/convenience ONLY** — never anything affecting how a robot drives
  or scores. That is a product rule AND a statement in the terms. All four advertised
  perks are BUILT (badge, ads-off, 6 saved starts, chassis colours); **do not list a
  perk on the Donate page before it exists.**
- **The saved-start PERSIST cap is the SUPPORTER ceiling**
  (`MAX_SAVED_STARTS_SUPPORTER`), in `coerceSettings` AND `saveStart`. Only the editor's
  Save button applies the free cap. Sanitizing to the free cap would DELETE a supporter's
  poses before the entitlement resolved, and on every lapse.
- **The chassis colour is an ALLOWLIST key** (`CHASSIS_COLORS`), never a free colour
  string on the wire, and it recolours only the FILL — alliance identity is the OUTLINE.
- **`LobbyPlayer.supporter` is SERVER-AUTHORED** (set at join). `sanitizePlayer` is an
  allowlist and `PlayerPatch` is a `Pick`, so a client cannot self-declare a paid badge.
- **`LEGAL_VERSION` is DERIVED from `LEGAL_UPDATED`** (`legalVersionOf`), not written beside it:
  two hand-kept spellings of one date is how the version everybody re-accepts ends up disagreeing
  with the date on the page they are accepting. ⚠️ **Moving `LEGAL_UPDATED` prompts EVERY
  signed-in account to accept again, once** (`termsGateState`, `src/ui/TermsGate.tsx`) — that is
  the point of it, so move it for a material change and not for a typo. It is a CLIENT change AND
  a SERVER change (the accept route records the server’s own constant), so deploy both.
- ⚠️ **`LEGAL_OPERATOR`/`LEGAL_JURISDICTION` in `src/legalText.ts` are PLACEHOLDERS.**
  Until filled, the Terms page shows a visible warning to every visitor. Fill them
  before taking a payment; do not guess them from a timezone or an email domain.
- Analytics (`src/analytics.ts`, `VITE_ANALYTICS=1`, Vercel Web Analytics — cookieless).
  **Rule: no identifiers in any event payload** — counts and enums only.

---

