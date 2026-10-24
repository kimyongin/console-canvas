const fs = require('node:fs/promises');
const path = require('node:path');
const { webUrl } = require('./security.cjs');
async function captureWebsite(contents, root) {
  webUrl(contents.getURL());
  const code = await fs.readFile(path.join(root, 'capture.js'), 'utf8');
  const snapshot = await contents.executeJavaScriptInIsolatedWorld(1001, [
    { code: code + '\n;globalThis.UICloneCapture.capture(document);' },
  ]);
  snapshot.screenshot = (await contents.capturePage()).toDataURL();
  return snapshot;
}
module.exports = { captureWebsite };
