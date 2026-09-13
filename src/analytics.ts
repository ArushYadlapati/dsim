/**
 * Analytics — the minimum needed to tell whether any of this monetization works.
 *
 * Without it there is no way to answer the only questions that matter after
 * launch: does anyone reach the Support page, does anyone click through to Ko-fi,
 * does a claim ever succeed, and do the ad columns shorten sessions. Shipping
 * ads and a paid tier with no measurement means tuning them by vibes.
 *
 * WHY VERCEL ANALYTICS and not something hand-rolled: the site already deploys
 * on Vercel, it is cookieless and stores no personal data (so it needs no consent
 * banner and adds nothing to the privacy policy's third-party list beyond the
 * host we already name), and the alternative — a bespoke events table on the game
 * server — would mean building session attribution, bot filtering, and a
 * dashboard, all of which are solved problems.
 *
 * IT IS ALSO THE SPONSOR REPORT. The presenting sponsor is owed monthly numbers —
 * clicks, sessions, new players — and they are what the deal renews on. Those come
 * from the `sponsor_*` / `player_joined` events below plus Vercel's own session
 * counts, i.e. from the measurement that already exists, rather than from a bespoke
 * events table that would have to be built, deployed, and then trusted. See
 * `docs/sponsor.md` for which filter produces which line of the report.
 *
 * PRIVACY RULE FOR EVERY EVENT BELOW: names and ids never leave the app. The
 * properties here are counts and enum-ish strings, never a user id, username,
 * email, or Ko-fi transaction id. An analytics payload is the easiest place in a
 * codebase to leak personal data by accident, so the rule is "no identifiers",
 * not "be careful".
 */
import { track } from '@vercel/analytics';

/** OFF unless explicitly enabled, matching how ads and auth are gated. A
 *  self-hosted or Electron build should not be firing beacons at a host it does
 *  not run on. */
const ENABLED = (import.meta.env.VITE_ANALYTICS as string | undefined)?.trim() === '1';

export function analyticsEnabled(): boolean {
  return ENABLED;
}

/** the events we care about, named so a dashboard reads as a funnel top-to-bottom */
export type AnalyticsEvent =
  | 'support_view' // reached the Support page
  | 'support_kofi_click' // clicked through to Ko-fi
  | 'support_claim_ok' // a claim succeeded
  | 'support_claim_fail' // a claim was rejected (see `reason`)
  | 'ads_shown' // an ad unit actually rendered
  | 'account_deleted'
  // ---- presenting sponsor (src/sponsor.ts) -------------------------------
  // These ARE the monthly attribution report. `docs/sponsor.md` names the
  // dashboard filter that turns each into a number, so the report is read off
  // the same events the app fires rather than assembled by hand.
  //
  // ⚠️ `sponsor_shown` MEANS VIEWABLE, NOT MOUNTED. It fires once the mark has
  // been at least half on screen for a continuous second (`src/ui/Sponsor.tsx`),
  // which is the industry definition of an impression and the only one a sponsor
  // can check. Counting mounts instead would bill the footer of every page a
  // visitor never scrolled to, i.e. inflate the denominator the click rate is
  // divided by — a number that flatters us is worse than no number, because it is
  // the one the renewal is argued over.
  //
  // `sponsor_dwell` carries a BUCKET string (`<5s`, `5-15s`, …), never raw
  // seconds: the dashboard groups by property VALUE, so a continuous number would
  // render as thousands of one-count rows and tell nobody anything.
  | 'sponsor_shown' // a sponsor placement was SEEN (`placement`) — the denominator
  | 'sponsor_click' // somebody clicked through to the sponsor (`placement`)
  | 'sponsor_dwell' // how long a placement stayed on screen (`placement`, `dwell`)
  | 'desktop_download' // a desktop build was taken (`os`) — the splash's only proxy
  | 'player_joined'; // a NEW account finished signing up — "new players"

export function trackEvent(
  event: AnalyticsEvent,
  props?: Record<string, string | number | boolean>,
): void {
  if (!ENABLED) return;
  try {
    track(event, props);
  } catch {
    /* analytics must never be able to break a page it is only observing */
  }
}
