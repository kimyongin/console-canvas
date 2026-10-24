function webUrl(value) {
  const parsed = new URL(value);
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password)
    throw new Error('HTTP 또는 HTTPS 주소를 입력해 주세요.');
  return parsed.href;
}
function secureWebsite(contents, getWindow, getSession) {
  contents.on('will-navigate', (event, url) => {
    try {
      webUrl(url);
    } catch {
      event.preventDefault();
    }
  });
  contents.setWindowOpenHandler(({ url }) => {
    try {
      webUrl(url);
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: getWindow(),
          width: 850,
          height: 750,
          webPreferences: {
            session: getSession(),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
        },
      };
    } catch {
      return { action: 'deny' };
    }
  });
  contents.on('did-create-window', (child) =>
    secureWebsite(child.webContents, getWindow, getSession),
  );
}
function trustFrame(event, contents) {
  if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame)
    throw new Error('허용되지 않은 앱 요청');
}
module.exports = { webUrl, secureWebsite, trustFrame };
