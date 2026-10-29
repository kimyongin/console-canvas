// Native collector + inert native PNG renderer, disposable pages/profile only.
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os'),
  http = require('node:http'),
  assert = require('node:assert/strict');
const root = process.env.CONSOLE_CANVAS_TEST_APP_ROOT || path.resolve(__dirname, '..'),
  testRoot = path.resolve(__dirname, '..');
app.on('window-all-closed', () => {});
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-scoped-'));
  app.setPath('userData', profile);
  await app.whenReady();
  let snapshot;
  const server = http.createServer(async (req, res) => {
    try {
      const name = new URL(req.url, 'http://localhost').pathname;
      if (name === '/capture-case.json') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(snapshot));
        return;
      }
      const base = name.startsWith('/tests/') ? testRoot : root,
        file = path.resolve(base, '.' + name);
      if (!file.startsWith(base + path.sep)) throw Error('bad path');
      res.setHeader(
        'Content-Type',
        {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.json': 'application/json',
          '.css': 'text/css',
        }[path.extname(file)] || 'application/octet-stream',
      );
      res.end(await fs.readFile(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const source = new BrowserWindow({
      show: false,
      width: 1100,
      height: 850,
      useContentSize: true,
      webPreferences: {
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    }),
    renderer = new BrowserWindow({
      show: false,
      width: 1100,
      height: 850,
      webPreferences: {
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
  await source.loadURL(base + '/tests/fixtures/console-states.html');
  await source.webContents.executeJavaScript('scrollTo(0,500)');
  const state = () =>
    source.webContents.executeJavaScript(
      'JSON.stringify({html:document.documentElement.outerHTML,scroll:[scrollX,scrollY],actions:globalThis.actions||0,nested:[document.querySelector("#table").scrollTop,document.querySelector("#table").scrollLeft,document.querySelector("#virtual").scrollTop]})',
    );
  const before = await state();
  const results = [];
  for (const scope of [
    { mode: 'viewport' },
    { mode: 'region', rect: { x: 270, y: 40, width: 500, height: 300 } },
    { mode: 'document' },
  ]) {
    snapshot = await require(path.join(root, 'desktop/capture.cjs')).captureWebsite(
      source.webContents,
      root,
      { scope },
    );
    assert.equal(await state(), before);
    assert.equal(snapshot.captureScope.mode, scope.mode);
    assert.ok(
      snapshot.nodes.some((n) => n.image?.broken),
      'Known missing source image is explicitly preserved',
    );
    assert.equal(snapshot.captureReport.preparedView.steps === 0, scope.mode !== 'document');
    assert.equal(
      snapshot.captureReport.screenshotMode === 'viewport-only',
      scope.mode !== 'document',
    );
    await renderer.loadURL(base + '/tests/capture-render.html');
    const deadline = Date.now() + 15000;
    while (
      Date.now() < deadline &&
      (await renderer.webContents.executeJavaScript('document.body.dataset.result')) !== 'ready'
    )
      await new Promise((r) => setTimeout(r, 50));
    assert.equal(
      await renderer.webContents.executeJavaScript('document.body.dataset.result'),
      'ready',
    );
    const request = await renderer.webContents.executeJavaScript(
      '({html:captureScene.serialize(),...captureScene.contentSize()})',
    );
    const png = await require(path.join(root, 'desktop/render-image.cjs'))(request),
      size = nativeImage.createFromBuffer(png).getSize();
    const view = snapshot.captureScope.rect || {
      width: snapshot.source.width,
      height: snapshot.source.height,
    };
    assert.equal(size.width, Math.ceil(view.width));
    assert.equal(size.height, Math.ceil(view.height));
    let matchedPixels;
    if (scope.mode !== 'document') {
      const rect = scope.rect || {
        x: 0,
        y: 0,
        width: snapshot.source.viewport.width,
        height: snapshot.source.viewport.height,
      };
      const expected = nativeImage.createFromDataURL(snapshot.screenshot).crop(rect).toBitmap(),
        actual = nativeImage.createFromBuffer(png).toBitmap();
      assert.equal(expected.length, actual.length);
      let same = 0;
      for (let i = 0; i < actual.length; i += 4)
        if (Math.max(...[0, 1, 2].map((k) => Math.abs(expected[i + k] - actual[i + k]))) <= 16)
          same++;
      matchedPixels = (100 * same) / (actual.length / 4);
      const out = path.join(testRoot, 'local/capture-enhancements-026');
      await fs.mkdir(out, { recursive: true });
      await fs.writeFile(path.join(out, scope.mode + '-native.png'), png);
      await fs.writeFile(
        path.join(out, scope.mode + '-original.png'),
        nativeImage.createFromDataURL(snapshot.screenshot).crop(rect).toPNG(),
      );
      await fs.writeFile(path.join(out, scope.mode + '-snapshot.json'), JSON.stringify(snapshot));
      if (scope.mode === 'region')
        await fs.writeFile(
          path.join(out, 'region-before-scroll-fix-reproduction.png'),
          await require(path.join(root, 'desktop/render-image.cjs'))({
            ...request,
            html: request.html.replace(/data-uic-scroll-[xy]="[^"]*"/g, ''),
          }),
        );
      assert.ok(matchedPixels >= 95, scope.mode + ' pixel match ' + matchedPixels);
    }
    results.push({ scope: scope.mode, size, sourceUnchanged: true, matchedPixels });
  }
  await assert.rejects(() =>
    require(path.join(root, 'desktop/capture.cjs')).captureWebsite(source.webContents, root, {
      scope: {
        mode: 'region',
        rect: { x: 0, y: 0, width: 100, height: 100 },
        expectedView: { url: 'stale' },
      },
    }),
  );
  const tall = await require(path.join(root, 'desktop/render-image.cjs'))({
    width: 900,
    height: 22000,
    html: '<!doctype html><meta name="console-canvas-view" content="100,19000,400,200"><body style="margin:0;height:22000px;background:#fafafa"><div style="position:absolute;left:100px;top:19000px;width:400px;height:200px;background:#2266cc"></div></body>',
  });
  const tallImage = nativeImage.createFromBuffer(tall);
  assert.deepEqual(tallImage.getSize(), { width: 400, height: 200 });
  const pixel = tallImage.toBitmap();
  assert.ok(
    Math.abs(pixel[0] - 204) < 2 && Math.abs(pixel[1] - 102) < 2 && Math.abs(pixel[2] - 34) < 2,
    'Long-document crop must contain actual target pixels',
  );
  results.push({ scope: 'long-document-region', size: tallImage.getSize(), actualPixels: true });
  console.log(JSON.stringify({ passed: 5, results, staleSelectionRejected: true }));
  source.destroy();
  renderer.destroy();
  server.closeAllConnections();
  server.close();
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  app.quit();
})().catch((error) => {
  console.error(error);
  app.exit(1);
});
