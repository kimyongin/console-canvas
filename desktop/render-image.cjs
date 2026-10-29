const { BrowserWindow, session } = require('electron');
// Only the trusted editor main frame may request this renderer. Captured scripts,
// page APIs and preload bridges are unavailable in this temporary window.
module.exports = async function renderImage(value) {
  if (
    !value ||
    typeof value.html !== 'string' ||
    value.html.length > 60_000_000 ||
    !Number.isInteger(value.width) ||
    !Number.isInteger(value.height) ||
    value.width < 1 ||
    value.width > 8192 ||
    value.height < 1 ||
    value.height > 200000
  )
    throw new Error('화면 이미지가 너무 큽니다. 화면 범위를 줄여 주세요.');
  const { renderScope } = await import('../capture-scope.js');
  const view = renderScope(value.html, value.width, value.height);
  if (view.width > 8192 || view.height > 16000 || view.width * view.height > 48_000_000)
    throw Error('화면 이미지가 너무 큽니다. 화면 범위를 줄여 주세요.');
  const isolated = session.fromPartition('image-' + require('node:crypto').randomUUID());
  isolated.setPermissionRequestHandler((_c, _p, done) => done(false));
  const win = new BrowserWindow({
    show: false,
    width: value.width,
    height: Math.min(value.height, 16000, Math.floor(48_000_000 / value.width)),
    useContentSize: true,
    webPreferences: {
      session: isolated,
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(value.html));
    await win.webContents.executeJavaScriptInIsolatedWorld(1003, [
      {
        code: 'Promise.race([Promise.all([document.fonts.ready,...[...document.images].map(i=>i.decode().catch(()=>{}))]),new Promise(r=>setTimeout(r,2000))]).then(()=>0)',
      },
    ]);
    await win.webContents.executeJavaScriptInIsolatedWorld(1003, [
      {
        code: `(${(await import('../capture-scroll.js')).restoreSerializedScroll.toString()})(document)`,
      },
    ]);
    // loadURL waits for the document and its blocking resources. Give Chromium
    // a render turn; JavaScript remains disabled, including injected scripts.
    await new Promise((resolve, reject) => {
      const paint = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        win.webContents.removeListener('paint', paint);
        reject(Error('이미지 렌더링 시간 초과'));
      }, 5000);
      win.webContents.once('paint', paint);
      win.webContents.invalidate();
    });
    const protocol = win.webContents.debugger;
    protocol.attach('1.3');
    const result = await protocol.sendCommand('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: true,
      clip: {
        ...view,
        scale:
          1 /
          (await win.webContents.executeJavaScriptInIsolatedWorld(1003, [
            { code: 'devicePixelRatio || 1' },
          ])),
      },
    });
    return Buffer.from(result.data, 'base64');
  } finally {
    win.destroy();
    await isolated.clearStorageData();
  }
};
