/* Day 0 physics spike, cross-runtime check (docs/biobuzz/plan-3d.md #10). Loads the page served
 * by `npx vite scripts/spike3d-browser --port 5199` in a hidden Electron window (same pattern as
 * scripts/shots.cjs: disableHardwareAcceleration + CalculateNativeWinOcclusion off, so a hidden
 * window still runs its script), polls for `window.__spikeSummary`, and prints the JSON line.
 *
 *   npx vite scripts/spike3d-browser --port 5199     # in another shell
 *   env -u ELECTRON_RUN_AS_NODE npx electron scripts/spike3d-browser/run-electron.cjs
 *
 * Throwaway: not wired into any test or build step.
 */
const { app, BrowserWindow } = require('electron');

const PORT = process.env.SPIKE3D_PORT || '5199';
const PAGE = process.env.SPIKE3D_PAGE || '';
const BASE = `http://localhost:${PORT}/${PAGE}`;

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

setTimeout(() => {
  console.log('WATCHDOG: no summary after 60s');
  process.exit(2);
}, 60000);
process.on('unhandledRejection', (e) => {
  console.log('UNHANDLED REJECTION:', (e && e.stack) || e);
  process.exit(3);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 800, height: 600, show: false, webPreferences: { backgroundThrottling: false } });
  win.webContents.on('console-message', (_e, _level, message) => {
    if (message.startsWith('{') || message.startsWith('SPIKE_ERROR')) {
      console.log('PAGE:', message);
    }
  });
  await win.loadURL(BASE);

  let summary = null;
  let outText = '';
  for (let i = 0; i < 300; i++) {
    summary = await win.webContents.executeJavaScript('window.__spikeSummary || null');
    if (summary) break;
    outText = await win.webContents.executeJavaScript(
      "document.getElementById('out') ? document.getElementById('out').textContent : ''",
    );
    if (typeof outText === 'string' && (outText.startsWith('SPIKE_ERROR') || outText.startsWith('NONCOMPAT_'))) {
      break;
    }
    await sleep(200);
  }

  if (summary) {
    console.log('RESULT_JSON', JSON.stringify(summary));
    process.exit(0);
  }
  if (outText) {
    console.log('RESULT_TEXT', outText);
    process.exit(outText.includes('FAIL') ? 1 : 0);
  }
  console.log('RESULT_ERROR timed out waiting for a result');
  process.exit(1);
});
