/* Renders public/og.png — the 1200x630 card that Discord / iMessage / Slack / X
 * show when someone pastes a playdsim.com link.
 *
 *   npm run og
 *
 * The output is COMMITTED (scrapers fetch a static URL, and the web build just
 * copies public/ through), so this only needs re-running when the branding or
 * the tagline changes. Electron is already a devDependency for `shiftaudit`, so
 * this adds no install weight and no image library.
 *
 * The palette is DSIM's dark theme (see :root[data-theme='dark'] in shell.css) —
 * a link card sits on someone else's chat background, so it commits to one look
 * rather than trying to be theme-aware like the app.
 *
 * ── THE PRESENTING SPONSOR ─────────────────────────────────────────────────
 * The card carries the mark too (`docs/sponsor.md`, the `og` row). This is the
 * one surface a person sees WITHOUT opening the app: every link anyone pastes
 * into a Discord server, an iMessage thread or a Slack channel renders it, and
 * every one of those was previously a DSIM impression with the sponsor absent.
 *
 * ⚠️ IT IS A BUILD ARTIFACT, NOT A RUNTIME PLACEMENT, so `SPONSOR.term` and
 * `VITE_SPONSOR=0` cannot take it down the way they take down the other six —
 * a scraper fetches a committed PNG. The term is read HERE instead, at generate
 * time: run `npm run og` after the term lapses and the mark is gone from the
 * next card. Same reason the Discord server icon is a manual step.
 *
 * ⚠️ IT CARRIES NO UTM TAG AND IS NOT IN `SPONSOR_PLACEMENTS`. An image in a
 * link preview has no click target of its own, so there is no click to
 * attribute; adding an id that can never appear in `utm_medium` would put a
 * permanently-zero row in the monthly report.
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const W = 1200;
const H = 630;
const OUT = path.join(__dirname, '..', 'public', 'og.png');
const LOGO = path.join(__dirname, '..', 'public', 'icon-512.png');
/** the DARK-SURFACE cut — this card is #20262c, so the near-white wordmark. The
 *  filenames say which SURFACE, not which ink; see the warning in docs/sponsor.md. */
const SPONSOR_LOGO = path.join(__dirname, '..', 'src', 'assets', 'sponsors', 'offset-on-dark.png');
const SPONSOR_TS = path.join(__dirname, '..', 'src', 'sponsor.ts');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const logo = 'data:image/png;base64,' + fs.readFileSync(LOGO).toString('base64');
const font = (f) =>
  'data:font/woff2;base64,' +
  fs
    .readFileSync(
      path.join(__dirname, '..', 'node_modules', f),
    )
    .toString('base64');
const JAKARTA = font('@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2');
const GROTESK = font('@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2');

/* ── the sponsor, READ OUT OF `src/sponsor.ts` ────────────────────────────────
 * This file is CommonJS run by Electron-as-node, so it cannot import the TS
 * module the rest of the app calls the single source of truth. It reads the
 * STRINGS out of it instead, because the alternative — a second copy of the
 * name and the term in this file — is exactly the drift `src/sponsor.ts` exists
 * to prevent, and a card is regenerated months apart from any edit to it.
 * A field it cannot find is a hard failure: a silently unbranded card is a
 * breach, and this script runs rarely enough that nobody would notice. */
const sponsorSrc = fs.readFileSync(SPONSOR_TS, 'utf8');
const sponsorField = (key) => {
  const m = sponsorSrc.match(new RegExp(`\\b${key}:\\s*'([^']*)'`));
  if (!m) throw new Error(`og-image: could not read SPONSOR.${key} from src/sponsor.ts`);
  return m[1];
};
const SPONSOR_NAME = sponsorField('name');
const SPONSOR_PRESENTS = sponsorField('presents');
/** `until` is EXCLUSIVE, both dates are UTC, and an unparseable one fails toward
 *  SHOWING the mark — the same rule `sponsorActive` states, for the same reason:
 *  a wrong clock must not void a placement somebody paid for. */
const day = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? Date.parse(`${iso}T00:00:00Z`) : NaN);
const now = Date.now();
const SPONSOR_ON = !(now < day(sponsorField('from'))) && !(now >= day(sponsorField('until')));
/** height 46, width derived from the artwork's real 1735x438 so the lockup keeps
 *  the ratio every other placement reserves its box from. Taller than the app's
 *  own placements (h=14..32) because this card is 1200px wide and is READ AT
 *  THUMBNAIL SIZE in a chat list — a mark sized for a 32px in-app row disappears. */
const SPONSOR_H = 46;
const SPONSOR_W = Math.round((SPONSOR_H * 1735) / 438);
const sponsorLogo =
  'data:image/png;base64,' + fs.readFileSync(SPONSOR_LOGO).toString('base64');
/* EVERY placement carries the WORDS as well as the logo — "presented by" is the
 * claim that was bought, a bare logo is decoration (docs/sponsor.md). */
const SPONSOR_HTML = SPONSOR_ON
  ? `<div class="pres"><span>${SPONSOR_PRESENTS}</span><img src="${sponsorLogo}" alt="${SPONSOR_NAME}"></div>`
  : '';

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: 'Jakarta'; src: url('${JAKARTA}') format('woff2-variations'); font-weight: 200 800; }
  @font-face { font-family: 'Grotesk'; src: url('${GROTESK}') format('woff2-variations'); font-weight: 300 700; }
  * { margin: 0; box-sizing: border-box; }
  body {
    width: ${W}px; height: ${H}px; overflow: hidden;
    background: #20262c; color: #e8eae7;
    font-family: 'Jakarta', sans-serif;
    display: flex; flex-direction: column; justify-content: center;
    padding: 0 84px; position: relative;
  }
  /* a soft mint bloom behind the mark, so the card isn't a flat rectangle */
  .glow {
    position: absolute; right: -140px; top: -160px; width: 620px; height: 620px;
    border-radius: 50%; background: radial-gradient(circle, rgba(95,181,151,.20), transparent 62%);
  }
  .row { display: flex; align-items: center; gap: 26px; margin-bottom: 26px; }
  .row img { width: 96px; height: 96px; border-radius: 22px; }
  .row b { font-size: 92px; font-weight: 800; letter-spacing: -.03em; line-height: 1; }
  .eyebrow {
    font-family: 'Grotesk', monospace; font-size: 22px; font-weight: 700;
    letter-spacing: .17em; text-transform: uppercase; color: #5fb597; margin-bottom: 20px;
  }
  .lead { font-size: 33px; line-height: 1.42; color: #b6bcb8; max-width: 900px; }
  .lead b { color: #e8eae7; font-weight: 700; }
  .foot {
    position: absolute; left: 84px; bottom: 56px;
    font-family: 'Grotesk', monospace; font-size: 21px; letter-spacing: .07em; color: #949e98;
  }
  .bar { position: absolute; left: 0; right: 0; bottom: 0; height: 10px; background: #5fb597; }
  /* the presenting sponsor, opposite the domain and centred on the same line as
     it (foot text centre 68.5px off the bottom; this row is ${SPONSOR_H}px tall, so
     ${Math.round(68.5 - SPONSOR_H / 2)} puts the two centres together). The lead is capped at 900px and the
     card is 1200 wide, so nothing it can say reaches this corner. */
  .pres {
    position: absolute; right: 84px; bottom: ${Math.round(68.5 - SPONSOR_H / 2)}px;
    display: flex; align-items: center; gap: 16px;
  }
  .pres span {
    font-family: 'Grotesk', monospace; font-size: 19px; font-weight: 700;
    letter-spacing: .14em; text-transform: uppercase; color: #949e98;
  }
  .pres img { width: ${SPONSOR_W}px; height: ${SPONSOR_H}px; display: block; }
</style></head><body>
  <div class="glow"></div>
  <p class="eyebrow">FIRST Tech Challenge &middot; 2D Driver Practice</p>
  <div class="row"><img src="${logo}" alt=""><b>DSIM</b></div>
  <!-- APP_BLURB (src/seasons.ts) verbatim, then the three games, in SEASONS order.
       Same sentence the homepage and the meta description use — keep them identical. -->
  <p class="lead">
    An online 2D driving simulator for FIRST Tech Challenge.<br>
    <b>DECODE</b> &middot; <b>Chain Reaction</b> &middot; <b>BIOBUZZ</b>
  </p>
  <p class="foot">playdsim.com</p>
  ${SPONSOR_HTML}
  <div class="bar"></div>
</body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    useContentSize: true,
    webPreferences: { offscreen: true, deviceScaleFactor: 1 },
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HTML));
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => 1)');
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage();
  const png = img.resize({ width: W, height: H }).toPNG();
  fs.writeFileSync(OUT, png);
  console.log(`wrote ${OUT} (${W}x${H}, ${(png.length / 1024).toFixed(0)} kB)`);
  // say it out loud: the term is read at GENERATE time, so this line is the only
  // place anyone finds out the card came out without the mark on it.
  console.log(
    SPONSOR_ON
      ? `      ${SPONSOR_PRESENTS} ${SPONSOR_NAME} — on the card`
      : `      sponsor term has lapsed — card generated WITHOUT the mark`,
  );
  app.exit(0);
});
