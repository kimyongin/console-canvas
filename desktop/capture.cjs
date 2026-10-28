const fs = require('node:fs/promises');
const path = require('node:path');
const { webUrl } = require('./security.cjs');
async function captureWebsite(contents, root) {
  webUrl(contents.getURL());
  const code = await fs.readFile(path.join(root, 'capture.js'), 'utf8');
  const snapshot = await contents.executeJavaScriptInIsolatedWorld(1001, [
    { code: code + '\n;globalThis.UICloneCapture.capture(document);' },
  ]);
  const matches = async () =>
    await contents.executeJavaScriptInIsolatedWorld(1001, [
      {
        code: `globalThis.UICloneCapture?.matchesView(document, ${JSON.stringify(snapshot.source)}) === true`,
      },
    ]);
  if (await matches()) {
    const screenshot = (await contents.capturePage()).toDataURL();
    if (await matches()) snapshot.screenshot = screenshot;
  }
  if (!snapshot.screenshot)
    snapshot.warnings.push({
      type: 'screenshot',
      message:
        '가져오는 동안 주소·화면 크기 또는 스크롤이 변경되어 이미지 캡처를 생략했습니다. 화면을 유지한 채 다시 가져와 주세요.',
    });
  return snapshot;
}
module.exports = { captureWebsite };
