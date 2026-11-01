// Development-only: real collector + inert clone pixel comparison on local samples.
// Produces an ordinary capture file for UI import; never seeds any editor database.
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os'),
  http = require('node:http'),
  assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'),
  names = ['dashboard', 'shop', 'board', 'booking', 'cms'];
const name = process.argv[2],
  index = names.indexOf(name);
if (index < 0) throw Error('Choose dashboard/shop/board/booking/cms');
app.on('window-all-closed', () => {});
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-study-capture-'));
  app.setPath('userData', profile);
  await app.whenReady();
  let snapshot;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://local');
      if (url.pathname === '/capture-case.json') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(snapshot));
        return;
      }
      const file = path.resolve(root, '.' + url.pathname);
      if (!file.startsWith(root + path.sep)) throw Error('path');
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
  const opts = {
    show: false,
    width: 1280,
    height: 900,
    useContentSize: true,
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  };
  const source = new BrowserWindow(opts),
    renderer = new BrowserWindow(opts);
  try {
    await source.loadURL('http://127.0.0.1:' + (59030 + index) + '/');
    const before = await source.webContents.executeJavaScript('document.documentElement.outerHTML');
    snapshot = await require('../desktop/capture.cjs').captureWebsite(source.webContents, root, {
      scope: { mode: 'document' },
    });
    assert.equal(
      await source.webContents.executeJavaScript('document.documentElement.outerHTML'),
      before,
    );
    const out = path.join(root, 'local/ux-study', name);
    await fs.mkdir(out, { recursive: true });
    await fs.writeFile(path.join(out, 'capture.uiclone'), JSON.stringify(snapshot));
    const width = snapshot.source.width,
      height = snapshot.source.height;
    const pixels = Buffer.alloc(width * height * 4),
      covered = new Uint8Array(width * height);
    const tiles = [
      { rect: { x: 0, y: 0, ...snapshot.source.viewport }, data: snapshot.screenshot },
      ...(snapshot.screenshotTiles || []),
    ];
    for (const tile of tiles) {
      if (!tile.data) continue;
      const img = nativeImage.createFromDataURL(tile.data),
        size = img.getSize(),
        bitmap = img.toBitmap();
      const x = Math.round(tile.rect.x || 0),
        y = Math.round(tile.rect.y || 0);
      for (let row = 0; row < size.height && y + row < height; row++) {
        const n = Math.min(size.width, width - x);
        if (n <= 0 || y + row < 0) continue;
        bitmap.copy(
          pixels,
          ((y + row) * width + x) * 4,
          row * size.width * 4,
          (row * size.width + n) * 4,
        );
        covered.fill(1, (y + row) * width + x, (y + row) * width + x + n);
      }
    }
    assert.equal(
      covered.reduce((n, v) => n + v, 0),
      width * height,
      'full source photo coverage',
    );
    const photo = nativeImage.createFromBitmap(pixels, { width, height, scaleFactor: 1 });
    await fs.writeFile(path.join(out, 'original.png'), photo.toPNG());
    await renderer.loadURL(
      'http://127.0.0.1:' + server.address().port + '/tests/capture-render.html',
    );
    let ready = false;
    for (let i = 0; i < 300; i++) {
      const s = await renderer.webContents.executeJavaScript('document.body.dataset.result');
      if (s === 'error')
        throw Error(
          await renderer.webContents.executeJavaScript(
            'document.querySelector("#results").textContent',
          ),
        );
      if (s === 'ready') {
        ready = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(ready, 'clone ready');
    const request = await renderer.webContents.executeJavaScript(
      '({html:captureScene.serialize(),...captureScene.contentSize()})',
    );
    const png = await require('../desktop/render-image.cjs')(request);
    await fs.writeFile(path.join(out, 'clone.png'), png);
    const clone = nativeImage.createFromBuffer(png);
    const a = photo.getSize(),
      b = clone.getSize();
    // Compare the exact overlapping captured rectangle, report full sizes explicitly.
    const rect = {
      x: 0,
      y: 0,
      width: Math.min(a.width, b.width),
      height: Math.min(a.height, b.height),
    };
    assert.equal(a.width, b.width, 'same capture width');
    assert.equal(a.height, b.height, 'same capture height');
    const expected = photo.crop(rect).toBitmap(),
      actual = clone.crop(rect).toBitmap();
    let matched16 = 0,
      matched8 = 0,
      exact = 0;
    for (let i = 0; i < actual.length; i += 4) {
      const d = Math.max(...[0, 1, 2].map((k) => Math.abs(actual[i + k] - expected[i + k])));
      if (d <= 16) matched16++;
      if (d <= 8) matched8++;
      if (d === 0) exact++;
    }
    const comparedPixels = actual.length / 4;
    const result = {
      name,
      captureId: snapshot.id,
      projectId: 'ux-study-' + name,
      url: snapshot.source.url,
      nodes: snapshot.nodes.length,
      sourceSize: a,
      cloneSize: b,
      matched16: (100 * matched16) / comparedPixels,
      matched8: (100 * matched8) / comparedPixels,
      exact: (100 * exact) / comparedPixels,
      sourceUnchanged: true,
      scope: snapshot.captureScope,
      mode: 'actual local DOM + real offscreen Chromium pixels / not manual installed-app capture',
    };
    await fs.writeFile(path.join(out, 'capture-report.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    assert.ok(result.matched16 >= 95, '95% capture threshold');
  } finally {
    source.destroy();
    renderer.destroy();
    server.close();
    app.quit();
  }
})().catch((e) => {
  console.error(e);
  app.exit(1);
});
