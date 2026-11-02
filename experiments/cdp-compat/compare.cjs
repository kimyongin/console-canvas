// Read-only visual check through the existing CanvasScene and native PNG renderer.
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os'),
  http = require('node:http');
const root = path.resolve(__dirname, '../..'),
  output = process.env.CDP_PROBE_OUTPUT || path.join(root, 'local/cdp-compat');
app.on('window-all-closed', () => {});
const compare = (a, b) => {
  const size = a.getSize(),
    other = b.getSize();
  if (size.width !== other.width || size.height !== other.height)
    throw Error('Image dimensions differ: ' + JSON.stringify({ size, other }));
  const left = a.toBitmap(),
    right = b.toBitmap(),
    diff = Buffer.alloc(left.length);
  let within16 = 0,
    exact = 0;
  for (let i = 0; i < left.length; i += 4) {
    const max = Math.max(...[0, 1, 2].map((c) => Math.abs(left[i + c] - right[i + c])));
    if (max <= 16) within16++;
    if (max === 0) exact++;
    diff[i] = max <= 16 ? 255 : 230;
    diff[i + 1] = max <= 16 ? 255 : 45;
    diff[i + 2] = max <= 16 ? 255 : 75;
    diff[i + 3] = 255;
  }
  return {
    width: size.width,
    height: size.height,
    matchedPixels: (100 * within16) / (left.length / 4),
    exactPixels: (100 * exact) / (left.length / 4),
    diff: nativeImage.createFromBitmap(diff, size),
  };
};
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'page-canvas-probe-render-'));
  app.setPath('userData', profile);
  await app.whenReady();
  let snapshot;
  const server = http.createServer(async (req, res) => {
    try {
      const name = new URL(req.url, 'http://localhost').pathname;
      if (name === '/capture-case.json') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify(snapshot));
      }
      const file = path.resolve(root, '.' + name);
      if (!file.startsWith(root + path.sep)) throw Error('Bad path');
      res.setHeader(
        'Content-Type',
        {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
        }[path.extname(file)] || 'application/octet-stream',
      );
      res.end(await fs.readFile(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 1000,
    useContentSize: true,
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  const results = [];
  for (const transport of ['chrome', 'native'])
    for (const name of [
      'console',
      'complex',
      'iframes',
      'cross-frame-fallback',
      'scroll-viewport',
      'scroll-region',
    ]) {
      const row = { transport, name };
      results.push(row);
      try {
        snapshot = JSON.parse(
          await fs.readFile(
            path.join(output, transport === 'chrome' ? '' : 'native', name, 'capture.uiclone.json'),
            'utf8',
          ),
        );
        win.setContentSize(snapshot.source.viewport.width, snapshot.source.viewport.height);
        await win.loadURL(
          'http://127.0.0.1:' + server.address().port + '/tests/capture-render.html',
        );
        const deadline = Date.now() + 30000;
        let status;
        do {
          status = await win.webContents.executeJavaScript('document.body.dataset.result');
          if (status) break;
          await new Promise((r) => setTimeout(r, 30));
        } while (Date.now() < deadline);
        if (status !== 'ready')
          throw Error(
            await win.webContents.executeJavaScript(
              'document.querySelector("#results").textContent',
            ),
          );
        const serialized = await win.webContents.executeJavaScript(
          '({html:captureScene.serialize(),...captureScene.contentSize()})',
        );
        const actual = nativeImage.createFromBuffer(
          await require(path.join(root, 'desktop/render-image.cjs'))(serialized),
        );
        const rect = snapshot.captureScope?.rect;
        let expected, clone, comparison;
        if (rect) {
          const original = nativeImage.createFromDataURL(snapshot.screenshot);
          const crop = {
            x: Math.round(rect.x - snapshot.source.scroll.x),
            y: Math.round(rect.y - snapshot.source.scroll.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
          const size = original.getSize();
          if (
            crop.x < 0 ||
            crop.y < 0 ||
            crop.x + crop.width > size.width ||
            crop.y + crop.height > size.height
          )
            throw Error('Source screenshot does not cover requested scope');
          expected = original.crop(crop);
          clone = actual;
          comparison = snapshot.captureScope.mode;
        } else if (name === 'complex') {
          expected = nativeImage.createFromDataURL(snapshot.screenshot);
          clone = actual.crop({
            x: snapshot.source.scroll.x,
            y: snapshot.source.scroll.y,
            ...snapshot.source.viewport,
          });
          comparison = 'initial-viewport-only';
        } else {
          const tile = snapshot.screenshotTiles.find(
            (t) =>
              t.rect.x === 0 &&
              t.rect.y === 0 &&
              t.rect.width >= snapshot.source.width &&
              t.rect.height >= snapshot.source.height,
          );
          if (!tile) throw Error('No full-document reference');
          expected = nativeImage.createFromDataURL(tile.data);
          clone = actual;
          comparison = 'document';
        }
        const metrics = compare(expected, clone);
        const dir = path.join(output, 'visual', transport, name);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, 'source.png'), expected.toPNG());
        await fs.writeFile(path.join(dir, 'clone.png'), clone.toPNG());
        await fs.writeFile(path.join(dir, 'diff.png'), metrics.diff.toPNG());
        delete metrics.diff;
        Object.assign(row, { ok: metrics.matchedPixels >= 99, comparison, ...metrics });
        console.log(JSON.stringify(row));
      } catch (e) {
        row.ok = false;
        row.error = e.message;
        console.log(JSON.stringify(row));
      }
    }
  await fs.writeFile(path.join(output, 'visual-report.json'), JSON.stringify(results, null, 2));
  win.destroy();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  app.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => {
  console.error(e);
  app.exit(1);
});
