// Runs our own fixture pages in real Chromium with a disposable profile.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
let server, profile, window;
async function main() {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'console-canvas-check-'));
  app.setPath('userData', profile);
  await app.whenReady();
  server = http.createServer(async (request, response) => {
    try {
      const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const filename = path.resolve(root, '.' + name);
      if (!filename.startsWith(root + path.sep)) throw new Error('Invalid path');
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
  for (const suite of ['integration', 'snapshots', 'panels', 'storage', 'ux']) {
    await window.loadURL(`http://127.0.0.1:${server.address().port}/tests/${suite}.html`);
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
    if (result.done !== 'pass') throw new Error(`${suite} failed: ${result.text}`);
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
  await fs.mkdir(path.join(root, 'dist'), { recursive: true });
  await fs.writeFile(path.join(root, 'dist/browser-checks.json'), JSON.stringify(reports, null, 2));
}
async function finish(code) {
  window?.destroy();
  if (server) await new Promise((resolve) => server.close(resolve));
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
