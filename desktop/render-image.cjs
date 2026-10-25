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
    value.height > 16000 ||
    value.width * value.height > 48_000_000
  )
    throw new Error('화면 이미지가 너무 큽니다. 화면 범위를 줄여 주세요.');
  const isolated = session.fromPartition('image-' + require('node:crypto').randomUUID());
  isolated.setPermissionRequestHandler((_c, _p, done) => done(false));
  const win = new BrowserWindow({
    show: false,
    width: value.width,
    height: value.height,
    useContentSize: true,
    webPreferences: {
      session: isolated,
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
    // loadURL waits for the document and its blocking resources. Give Chromium
    // a render turn; JavaScript remains disabled, including injected scripts.
    await new Promise((resolve) => setTimeout(resolve, 150));
    return (
      await win.webContents.capturePage({ x: 0, y: 0, width: value.width, height: value.height })
    ).toPNG();
  } finally {
    win.destroy();
    await isolated.clearStorageData();
  }
};
