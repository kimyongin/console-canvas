const fs = require('node:fs/promises');
const path = require('node:path');
const { webUrl } = require('./security.cjs');
const { captureWithProtocol } = require('./capture-cdp.cjs');
const { prepareCaptureView } = require('./capture-view.cjs');
const { readPublicResource } = require('./capture-resources.cjs');
async function captureWebsite(contents, root, options = {}) {
  webUrl(contents.getURL());
  const code = await fs.readFile(path.join(root, 'capture.js'), 'utf8');
  const prepared = await prepareCaptureView(contents, code);
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
      send: async (method, params, session) => {
        let timer;
        try {
          return await Promise.race([
            protocol.sendCommand(method, params, session || undefined),
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(Error('수집 응답 시간 초과: ' + method)),
                method === 'Network.loadNetworkResource'
                  ? 5000
                  : method === 'Page.getResourceContent'
                    ? 400
                    : method === 'Runtime.evaluate'
                      ? params?.expression?.length > 1_000_000
                        ? 45000
                        : 15000
                      : 2000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      },
      code,
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
    snapshot.captureReport.preparedView = prepared;
    return snapshot;
  } finally {
    protocol.removeListener('message', onMessage);
    if (protocol.isAttached()) protocol.detach();
  }
}
module.exports = { captureWebsite };
