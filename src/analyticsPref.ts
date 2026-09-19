import { ANALYTICS_KEY } from './storageKeys';

/**
 * THE ANALYTICS OFF SWITCH (`decodesim.analytics`), on its own leaf module.
 *
 * Split out of `src/analytics.ts` rather than living beside `trackEvent`, for one concrete
 * reason: that file reads `import.meta.env.VITE_ANALYTICS` at module scope, which is a Vite
 * transform and `undefined` under plain Node — so importing it from `scripts/smoke.ts` throws at
 * load. A privacy control that could not be tested headlessly would be a privacy control
 * verified by reading, and this one has four behaviours worth actually exercising. Same shape as
 * `src/net/predictionPref.ts` and `src/chainDisclaimer.ts`: no React, no DOM beyond storage,
 * guarded against storage being unavailable.
 *
 * DEFAULT ON, and that is a considered position rather than a convenient one. What is measured
 * is cookieless and carries no identifier of any kind — the rule at the top of `analytics.ts` —
 * so it cannot be joined to a person or to an earlier visit, which is why it needs no consent
 * banner. A banner for it would be theatre, and theatre is what trains people to click through
 * the banners that matter. The switch exists anyway, on the privacy page: "we do not think you
 * need a choice here" is not the same as not offering one, and somebody who wants no beacons
 * leaving their machine should not need a browser extension to get that.
 */

/**
 * READ FRESH ON EVERY CALL, deliberately not cached in module state. This is an opt-OUT, so if a
 * second tab switches it off the tab that is mid-session has to stop too, and a cached value
 * would keep firing until a reload. Every event is a user action — a click, a match ending, an
 * ad rendering — so this is a handful of synchronous reads per session, not a per-frame cost.
 *
 * ⚠️ STORAGE THAT THROWS (private mode, blocked site data) answers ON, matching the absent case.
 * Failing closed would silently switch analytics off for every locked-down browser and bias every
 * number the sponsor report is built from; failing to READ a preference is not being told no.
 */
export function analyticsAllowed(): boolean {
  try {
    return localStorage.getItem(ANALYTICS_KEY) !== '0';
  } catch {
    return true;
  }
}

/**
 * Persist the choice.
 *
 * `true` REMOVES the key rather than writing `'1'`: on is the default, so opting back in should
 * leave nothing at all behind on the device. An opt-out you cannot fully undo is a worse privacy
 * story than no opt-out.
 */
export function setAnalyticsAllowed(on: boolean): void {
  try {
    if (on) localStorage.removeItem(ANALYTICS_KEY);
    else localStorage.setItem(ANALYTICS_KEY, '0');
  } catch {
    /* nothing to persist to. The live session still honours it through the read above. */
  }
}
