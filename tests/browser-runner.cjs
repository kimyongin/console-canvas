// Runs our own fixture pages in real Chromium with a disposable profile.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const appRoot = process.env.CONSOLE_CANVAS_TEST_APP_ROOT || root;
let server, profile, window;
app.on('window-all-closed', () => {});
async function main() {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'console-canvas-check-'));
  app.setPath('userData', profile);
  await app.whenReady();
  server = http.createServer(async (request, response) => {
    try {
      const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const assetRoot = name.startsWith('/tests/') ? root : appRoot;
      const filename = path.resolve(assetRoot, '.' + name);
      if (!filename.startsWith(assetRoot + path.sep)) throw new Error('Invalid path');
      const content = await fs.readFile(filename);
      response.setHeader(
        'Content-Type',
        {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
        }[path.extname(filename)] || 'application/octet-stream',
      );
      response.end(content);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  window = new BrowserWindow({
    show: false,
    width: 1600,
    height: 1100,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  const reports = [];
  for (const suite of [
    'iframes',
    'integration',
    'ai-variants',
    'developer-workflow',
    'snapshots',
    'panels',
    'storage',
    'ux',
    'selection',
    'trash',
    'placement',
    'evolution',
    'graphflow',
    'resilience',
    'react-ui',
    'usability',
    'followup',
    'navigation',
  ]) {
    let iframeSnapshot, iframeSourceUnchanged;
    if (suite === 'iframes') {
      window.setContentSize(900, 700);
      await window.loadURL(`http://127.0.0.1:${server.address().port}/fixtures/iframes.html`);
      const before = await window.webContents.executeJavaScript(
        `JSON.stringify({html:document.documentElement.outerHTML,scroll:document.querySelector('#same').contentWindow.scrollY,actions:document.querySelector('#same').contentWindow.actions})`,
      );
      await window.webContents.executeJavaScript(
        'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
      );
      iframeSnapshot = await require(path.join(appRoot, 'desktop/capture.cjs')).captureWebsite(
        window.webContents,
        appRoot,
      );
      const after = await window.webContents.executeJavaScript(
        `JSON.stringify({html:document.documentElement.outerHTML,scroll:document.querySelector('#same').contentWindow.scrollY,actions:document.querySelector('#same').contentWindow.actions})`,
      );
      iframeSourceUnchanged = before === after;
      window.setContentSize(1600, 1100);
    }
    await window.loadURL(`http://127.0.0.1:${server.address().port}/tests/${suite}.html`);
    if (iframeSnapshot)
      await window.webContents.executeJavaScript(
        `globalThis.iframeSnapshot=${JSON.stringify(iframeSnapshot)};globalThis.iframeSourceUnchanged=${iframeSourceUnchanged};dispatchEvent(new Event('snapshotready'));`,
      );
    const deadline = Date.now() + 120000;
    let result;
    do {
      result = await window.webContents.executeJavaScript(
        `(() => {const status=document.querySelector('#status');return {text:status?.textContent,done:document.body.dataset.result || (status?.classList.contains('pass')?'pass':status?.classList.contains('fail')?'fail':null)};})()`,
      );
      if (result.done) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    console.log(`${suite}: ${result.text}`);
    reports.push({ suite, ...result });
    if (result.done !== 'pass') {
      console.error(
        await window.webContents.executeJavaScript(
          'document.querySelector("#results")?.textContent',
        ),
      );
      throw new Error(`${suite} failed: ${result.text}`);
    }
  }
  await window.loadFile(path.join(root, 'preview.html'), { query: { sample: '1' } });
  const deadline = Date.now() + 20000;
  let standalone;
  do {
    standalone = await window.webContents.executeJavaScript(
      `(() => {const app=window.ConsoleCanvas;return {ready:!!app?.state.ready,elements:app?.state.scene?.elements.size||0,externalScripts:[...document.scripts].filter(s=>s.src).length,cssBundled:[...document.querySelectorAll('style')].some(s=>s.textContent.includes('.workspace'))&&! [...document.querySelectorAll('style')].some(s=>s.textContent.includes('@import'))};})()`,
    );
    if (standalone.ready) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  if (
    !standalone.ready ||
    standalone.elements < 300 ||
    standalone.externalScripts ||
    !standalone.cssBundled
  )
    throw new Error('Standalone file bundle failed: ' + JSON.stringify(standalone));
  console.log('standalone: ' + JSON.stringify(standalone));
  reports.push({ suite: 'standalone', done: 'pass', ...standalone });
  const gesture = await window.webContents.executeJavaScript(`(() => {
    const app=window.ConsoleCanvas,v=document.querySelector('#viewport').getBoundingClientRect(),f=document.querySelector('#scene-frame').getBoundingClientRect();app.state.scene.select(null);
    return {x:Math.round(v.left+5),y:Math.round(v.top+5),endX:Math.round(Math.min(f.right-3,v.right-20)),endY:Math.round(f.top+160*app.state.zoom),before:JSON.stringify(app.state.scene.edits)};
  })()`);
  const input = (type, x, y) =>
    window.webContents.sendInputEvent({
      type,
      x,
      y,
      button: 'left',
      clickCount: 1,
      ...(type === 'mouseMove' ? { modifiers: ['leftButtonDown'] } : {}),
    });
  input('mouseDown', gesture.x, gesture.y);
  for (let i = 1; i <= 4; i++)
    input(
      'mouseMove',
      Math.round(gesture.x + ((gesture.endX - gesture.x) * i) / 4),
      Math.round(gesture.y + ((gesture.endY - gesture.y) * i) / 4),
    );
  input('mouseUp', gesture.endX, gesture.endY);
  await window.webContents.executeJavaScript(
    'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
  );
  const area = await window.webContents.executeJavaScript(
    `(() => {const s=window.ConsoleCanvas.state.scene;return {count:s.selection.size,finished:!s.areaSelecting&&!s.drag,edits:JSON.stringify(s.edits)};})()`,
  );
  if (!area.count || !area.finished || area.edits !== gesture.before)
    throw new Error('Native cross-frame marquee failed: ' + JSON.stringify(area));
  console.log(
    'native-area: ' +
      JSON.stringify({ selected: area.count, crossFrame: true, geometryUnchanged: true }),
  );
  reports.push({ suite: 'native-area', done: 'pass', selected: area.count, crossFrame: true });
  await fs.mkdir(path.join(root, 'dist'), { recursive: true });
  await fs.writeFile(path.join(root, 'dist/browser-checks.json'), JSON.stringify(reports, null, 2));
}
async function finish(code) {
  window?.destroy();
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  if (profile) await fs.rm(profile, { recursive: true, force: true });
  app.exit(code);
}
main().then(
  () => finish(0),
  (error) => {
    console.error(error);
    return finish(1);
  },
);
