// Explicit locked-session alternative: real DOM capture, known fixture screenshot.
// This does not verify OS display capture or manual use of the installed app.
const path = require('node:path'),
  fs = require('node:fs/promises');
const electron = require('electron');
const NativeWindow = electron.BrowserWindow;
class OffscreenWindow extends NativeWindow {
  constructor(options) {
    super({ ...options, webPreferences: { ...options.webPreferences, offscreen: true } });
  }
}
require.cache[require.resolve('electron')].exports = {
  ...electron,
  BrowserWindow: OffscreenWindow,
};
const capture = require.resolve('../desktop/capture.cjs');
require(capture);
require.cache[capture].exports = {
  captureWebsite: async (contents, root) => {
    require(path.join(root, 'desktop/security.cjs')).webUrl(contents.getURL());
    const code = await fs.readFile(path.join(root, 'capture.js'), 'utf8');
    const snapshot = await contents.executeJavaScriptInIsolatedWorld(1001, [
      { code: code + '\n;globalThis.UICloneCapture.capture(document);' },
    ]);
    snapshot.screenshot = JSON.parse(
      await fs.readFile(path.join(root, 'sample.uiclone.json'), 'utf8'),
    ).screenshot;
    return snapshot;
  },
};
require('./desktop-fixture.cjs');
