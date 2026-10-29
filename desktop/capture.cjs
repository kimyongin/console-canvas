const fs = require('node:fs/promises');
const path = require('node:path');
const { webUrl } = require('./security.cjs');
const { captureWithProtocol } = require('./capture-cdp.cjs');
const { prepareCaptureView } = require('./capture-view.cjs');
const { readPublicResource } = require('./capture-resources.cjs');
async function captureWebsite(contents, root, options = {}) {
  webUrl(contents.getURL());
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
async function resolveScope(contents, request) {
  if (!request || request.mode === 'document') return { mode: 'document' };
  if (!['viewport', 'region'].includes(request.mode))
    throw Error('알 수 없는 가져오기 범위입니다.');
  const view = await contents.executeJavaScriptInIsolatedWorld(1002, [
    { code: '({url:location.href,x:scrollX,y:scrollY,width:innerWidth,height:innerHeight})' },
  ]);
  if (request.expectedView && JSON.stringify(request.expectedView) !== JSON.stringify(view))
    throw Error('원본 화면이 바뀌었습니다. 영역을 다시 선택해 주세요.');
  const r =
    request.mode === 'viewport'
      ? { x: 0, y: 0, width: view.width, height: view.height }
      : request.rect;
  if (
    !r ||
    !['x', 'y', 'width', 'height'].every((k) => Number.isFinite(r[k])) ||
    r.x < 0 ||
    r.y < 0 ||
    r.width < 1 ||
    r.height < 1 ||
    r.x + r.width > view.width + 1 ||
    r.y + r.height > view.height + 1
  )
    throw Error('화면 안에서 가져올 영역을 선택해 주세요.');
  return {
    mode: request.mode,
    rect: { x: view.x + r.x, y: view.y + r.y, width: r.width, height: r.height },
    viewport: view,
  };
}
module.exports = { captureWebsite, resolveScope };
