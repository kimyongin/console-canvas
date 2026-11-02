const fs = require('node:fs/promises');
const path = require('node:path');
const { webUrl } = require('./security.cjs');
const { captureWithProtocol } = require('../capture/protocol.cjs');
const { prepareCaptureView } = require('./capture-view.cjs');
const { readPublicResource } = require('../capture/resources.cjs');
async function captureWebsite(contents, root, options = {}) {
  webUrl(contents.getURL());
  return captureContents(contents, root, options);
}
// This file-only exception is private to our own shell, never the website IPC.
async function captureAppShell(contents, root) {
  const expected = require('node:url').pathToFileURL(path.join(root, 'desktop/shell.html')).href;
  if (contents.getURL() !== expected) throw Error('앱 화면 출처가 올바르지 않습니다.');
  return captureContents(contents, root, { scope: { mode: 'viewport' } });
}
async function captureContents(contents, root, options) {
  const code = await fs.readFile(path.join(root, 'capture.js'), 'utf8');
  const scope = await resolveScope(contents, options.scope);
  const prepared = await prepareCaptureView(contents, code, { scope });
  const protocol = contents.debugger;
  if (protocol.isAttached())
    throw Error('원본 화면 개발자 도구가 연결되어 있습니다. 연결을 마친 뒤 다시 가져와 주세요.');
  protocol.attach('1.3');
  const targets = [];
  const onMessage = (_event, method, params) => {
    if (method === 'Target.attachedToTarget') targets.push(params);
  };
  protocol.on('message', onMessage);
  try {
    const snapshot = await captureWithProtocol({
      send: require('../capture/transport.cjs').timedSend((method, params, session) =>
        protocol.sendCommand(method, params, session || undefined),
      ),
      code,
      scope,
      readResource: (url) => readPublicResource(url, require('electron').net.fetch),
      onProgress: options.onProgress,
      getTargets: () => targets,
      beforeScreenshot: async () => {
        if (!contents.isOffscreen()) return;
        await new Promise((resolve, reject) => {
          const paint = () => {
            clearTimeout(timer);
            resolve();
          };
          const timer = setTimeout(() => {
            contents.removeListener('paint', paint);
            reject(Error('원본 화면의 렌더링을 기다리는 시간이 초과되었습니다.'));
          }, 5000);
          contents.once('paint', paint);
          contents.invalidate();
        });
      },
    });
    if (scope) snapshot.captureScope = scope;
    snapshot.captureReport.preparedView = prepared;
    return snapshot;
  } finally {
    protocol.removeListener('message', onMessage);
    if (protocol.isAttached()) protocol.detach();
  }
}
function resolveScope(contents, request) {
  return require('../capture/scope.cjs').resolveScope(
    (expression) => contents.executeJavaScriptInIsolatedWorld(1002, [{ code: expression }]),
    request,
  );
}
module.exports = { captureWebsite, captureAppShell, resolveScope };
