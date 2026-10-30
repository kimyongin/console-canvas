const { captureWebsite, captureAppShell } = require('./capture.cjs');
const { composeAppCapture } = require('./compose-app-capture.cjs');
async function captureApplication({
  shell,
  content,
  bounds,
  width,
  height,
  view,
  root,
  version,
  onShellCaptured = () => {},
}) {
  const shellCapture = await captureAppShell(shell, root);
  onShellCaptured();
  const parts = [
    {
      snapshot: shellCapture,
      surface: 'shell',
      bounds: { x: 0, y: 0, width, height: content ? bounds.y : height },
    },
  ];
  if (content)
    parts.push({
      snapshot: await captureWebsite(content, root, { scope: { mode: 'viewport' } }),
      bounds,
      surface: view,
    });
  return shell.executeJavaScriptInIsolatedWorld(1004, [
    {
      code: `(${composeAppCapture.toString()})(${JSON.stringify({ parts, width, height, view, version })})`,
    },
  ]);
}
module.exports = { captureApplication };
