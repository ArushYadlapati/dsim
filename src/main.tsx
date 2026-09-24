import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { ServerNoticeBanner } from './ui/ServerNoticeBanner';
import { NoticePoller } from './ui/NoticePoller';
import { PadNavLayer } from './ui/PadNavLayer';
import { initPhysics } from './sim/physicsEngine';
import { initTheme } from './theme';
import { AdsProvider } from './ads/AdsProvider';
import { loadCmp } from './ads/adsense';
import { Analytics } from '@vercel/analytics/react';
import { analyticsEnabled } from './analytics';
import { analyticsAllowed } from './analyticsPref';
import { adoptLanFromOrigin } from './net/lanAdopt';
// Self-hosted (not a CDN <link>): the Electron build runs from file:// with
// vite `base: './'`, so fingerprinted woff2 must be bundled to resolve offline.
// Variable cuts, because shell.css asks for weights off the 100 grid (750).
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/space-grotesk';
import './ui/styles.css';
import './ui/shell.css';
// the tutorial step card (roadmap item 6). Its own file, LAST: `styles.css`/`shell.css` are one
// large, actively-edited cascade and these rules are additive.
import './ui/tutorial.css';

// The inline script in index.html already stamped data-theme for the first paint.
// This re-stamps from the same key and, when the pref is 'system', arms the
// prefers-color-scheme listener so an OS switch is picked up live.
initTheme();

// Consent BEFORE the auction. index.html hardcodes the adsbygoogle tag so the
// AdSense crawler finds it on every route, which means the tag is already parsing
// by the time React mounts - a CMP that waited for the first ad slot would arrive
// far too late to gate anything. No-ops without a publisher id, and under Electron.
loadCmp();

// Init the Rapier physics WASM (shared src/sim) before the first sim step. It
// inlines its WASM as base64 (no separate asset), so this is a fast local
// decode — block the initial render on it so no GameController steps early.
// If this page was served BY a LAN host, play on that host. Runs alongside the physics
// init rather than after it, so a guest at a venue never waits on it; it resolves in
// milliseconds on a LAN and is skipped outright on https. See src/net/lanAdopt.ts.
const lanReady = adoptLanFromOrigin().catch(() => false);

Promise.all([initPhysics(), lanReady]).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {/* Wraps everything because the game screen renders OUTSIDE the app shell
          (App returns it early), and that is where the ad columns live. */}
      <AdsProvider>
        <App />
      </AdsProvider>
      <ServerNoticeBanner />
      <NoticePoller />
      {/* CONTROLLER NAVIGATION. Beside `<App/>` rather than inside it, for the reason the ad
          provider wraps it: the game, lobby, record and ranked screens are returned EARLY and
          would each have to remember to mount this. It renders through a portal to `body`, so
          its position here costs it nothing, and it polls nothing until a pad connects. */}
      <PadNavLayer />
      {/* Cookieless page views. Gated on VITE_ANALYTICS so a self-hosted or
          Electron build never beacons a host it does not run on.

          ⚠️ `beforeSend` IS WHAT MAKES THE OPT-OUT TRUE. This component sends its own page
          views; they do not go through `trackEvent`, so guarding only that function left the
          privacy page's switch claiming "stops every beacon" while the pageview beacon carried
          on — which is the kind of false statement a privacy control must not make. `beforeSend`
          is consulted per send, so `analyticsAllowed()` is read fresh and the switch takes
          effect with no reload, exactly as it does for events. Returning null drops the beacon
          before it leaves the page.

          ⚠️ IT ALSO STRIPS THE QUERY STRING. A password-reset or email-verification link
          arrives as `/account/reset?token=…`, and the first pageview fires on that URL — so
          without this the one-time token leaves the device inside an analytics beacon. Nothing
          this app measures is keyed on a query parameter, so there is no route detail to lose:
          the path alone is the page. */}
      {analyticsEnabled() && (
        <Analytics
          beforeSend={(e) => (analyticsAllowed() ? { ...e, url: e.url.split('?')[0] } : null)}
        />
      )}
    </StrictMode>,
  );
});
