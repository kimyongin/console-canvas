// Product integration test: disposable embedded Chromium source + real editor
// engine. Live captures remain under ignored local/, never in the repository.
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os'),
  http = require('node:http');
const { captureWebsite } = require('../desktop/capture.cjs');
const root = path.resolve(__dirname, '..'),
  output = path.resolve(
    process.env.CAPTURE_QA_OUTPUT || path.join(root, 'local/capture-quality-2026-10-29'),
  );
app.on('window-all-closed', () => {});
let source, renderer, server, profile, current;
const report = [];
const evaluate = (contents, code) => contents.executeJavaScript(code);
async function until(read, label, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error(label);
}
function pngCompare(a, b, tolerance = 16) {
  const size = a.getSize(),
    other = b.getSize();
  if (size.width !== other.width || size.height !== other.height)
    throw Error('Image dimensions differ: ' + JSON.stringify({ size, other }));
  const left = a.toBitmap(),
    right = b.toBitmap(),
    diff = Buffer.alloc(left.length);
  let same = 0,
    exact = 0,
    within8 = 0,
    delta = 0;
  for (let i = 0; i < left.length; i += 4) {
    let max = 0;
    for (let j = 0; j < 3; j++) {
      max = Math.max(max, Math.abs(left[i + j] - right[i + j]));
      delta += Math.abs(left[i + j] - right[i + j]);
    }
    if (max <= tolerance) same++;
    if (max === 0) exact++;
    if (max <= 8) within8++;
    diff[i] = max > tolerance ? 70 : 255;
    diff[i + 1] = max > tolerance ? 45 : 255;
    diff[i + 2] = max > tolerance ? 230 : 255;
    diff[i + 3] = 255;
  }
  return {
    matchedPixels: (100 * same) / (size.width * size.height),
    exactPixels: (100 * exact) / (size.width * size.height),
    matchedWithin8: (100 * within8) / (size.width * size.height),
    meanChannelDifference: delta / (3 * size.width * size.height),
    threshold: tolerance,
    width: size.width,
    height: size.height,
    diff: nativeImage.createFromBitmap(diff, { width: size.width, height: size.height }),
  };
}
async function screenshot(contents, rect) {
  if (contents.isOffscreen())
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        contents.removeListener('paint', paint);
        reject(Error('Offscreen paint timed out'));
      }, 5000);
      const paint = () => {
        clearTimeout(timer);
        resolve();
      };
      contents.once('paint', paint);
      contents.invalidate();
    });
  const protocol = contents.debugger;
  protocol.attach('1.3');
  try {
    const ratio = await evaluate(contents, 'devicePixelRatio || 1');
    const result = await protocol.sendCommand('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { ...rect, scale: 1 / ratio },
    });
    return nativeImage.createFromBuffer(Buffer.from(result.data, 'base64'));
  } finally {
    protocol.detach();
  }
}
function hasVisibleContent(image) {
  const pixels = image.toBitmap();
  const colors = new Set();
  for (let i = 0; i < pixels.length; i += 40)
    colors.add((pixels[i] >> 4) * 256 + (pixels[i + 1] >> 4) * 16 + (pixels[i + 2] >> 4));
  return colors.size > 16;
}
async function matchingViewports(snapshot, directory, testHeight) {
  const viewport = snapshot.source.viewport,
    parts = [],
    checks = [];
  const previousMinimum = await evaluate(
    renderer.webContents,
    'window.captureScene.doc.documentElement.style.minHeight',
  );
  await evaluate(
    renderer.webContents,
    `(()=>{const f=document.querySelector('iframe');f.style.width=${viewport.width}+'px';f.style.height=${viewport.height}+'px';window.captureScene.doc.documentElement.style.minHeight=${snapshot.source.height}+'px';})()`,
  );
  let index = 0;
  for (const tile of snapshot.screenshotTiles || []) {
    if (
      tile.rect.y >= testHeight ||
      tile.rect.x >= viewport.width ||
      tile.rect.width !== viewport.width ||
      tile.rect.height !== viewport.height
    )
      continue;
    const view = await evaluate(
      renderer.webContents,
      `(async()=>{const w=window.captureScene.doc.defaultView;w.scrollTo({left:${tile.rect.x},top:${tile.rect.y},behavior:'instant'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {x:w.scrollX,y:w.scrollY};})()`,
    );
    if (Math.abs(view.x - tile.rect.x) > 1 || Math.abs(view.y - tile.rect.y) > 1)
      throw Error(
        'Clone scroll extent differs from source: ' +
          JSON.stringify({ source: tile.rect, clone: view }),
      );
    const image = await screenshot(renderer.webContents, { x: 0, y: 0, ...viewport });
    const original =
      tile.rect.x === snapshot.source.scroll.x &&
      tile.rect.y === snapshot.source.scroll.y &&
      snapshot.screenshot
        ? snapshot.screenshot
        : tile.data;
    const raw = nativeImage
      .createFromBuffer(Buffer.from(original.split(',')[1], 'base64'))
      .resize(viewport);
    const height = Math.min(viewport.height, testHeight - tile.rect.y),
      clip = { x: 0, y: 0, width: viewport.width, height };
    const compared = pngCompare(raw.crop(clip), image.crop(clip));
    const { diff, ...metrics } = compared;
    checks.push({ scroll: view, ...metrics });
    const prefix = 'scroll-' + String(++index).padStart(2, '0');
    await fs.writeFile(path.join(directory, prefix + '-source.png'), raw.toPNG());
    await fs.writeFile(path.join(directory, prefix + '-clone.png'), image.toPNG());
    await fs.writeFile(path.join(directory, prefix + '-diff.png'), diff.toPNG());
    parts.push({ ...tile, data: 'data:image/png;base64,' + image.toPNG().toString('base64') });
  }
  if (!parts.length) throw Error('No original viewport captures for matched-scroll comparison');
  await evaluate(
    renderer.webContents,
    `(async()=>{const w=window.captureScene.doc.defaultView;w.scrollTo({left:${snapshot.source.scroll.x},top:${snapshot.source.scroll.y},behavior:'instant'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`,
  );
  const initial = await screenshot(renderer.webContents, { x: 0, y: 0, ...viewport });
  const composed = reference(
    {
      ...snapshot,
      screenshotTiles: parts,
      screenshot: 'data:image/png;base64,' + initial.toPNG().toString('base64'),
    },
    { x: 0, y: 0, width: viewport.width, height: testHeight },
  ).image;
  await evaluate(
    renderer.webContents,
    `(()=>{const f=document.querySelector('iframe');f.style.width=${snapshot.source.width}+'px';f.style.height=${snapshot.source.height}+'px';window.captureScene.doc.documentElement.style.minHeight=${JSON.stringify(previousMinimum)};window.captureScene.doc.defaultView.scrollTo(0,0);})()`,
  );
  return { image: composed, checks };
}
async function fontSample(contents, nested = false) {
  const protocol = contents.debugger;
  protocol.attach('1.3');
  try {
    await protocol.sendCommand('Page.enable');
    await protocol.sendCommand('Network.enable');
    await protocol.sendCommand('DOM.enable');
    await protocol.sendCommand('CSS.enable');
    const tree = (await protocol.sendCommand('DOM.getDocument', { depth: -1, pierce: true })).root;
    let document = tree;
    function scan(node) {
      if (node.nodeName === 'IFRAME' && node.contentDocument) document = node.contentDocument;
      for (const child of node.children || []) scan(child);
    }
    if (nested) scan(tree);
    const samples = [];
    for (const selector of ['h2', 'p', 'time']) {
      const { nodeId } = await protocol.sendCommand('DOM.querySelector', {
        nodeId: document.nodeId,
        selector,
      });
      if (nodeId)
        samples.push({
          selector,
          ...(await protocol.sendCommand('CSS.getPlatformFontsForNode', { nodeId })),
        });
    }
    const treeResources = (await protocol.sendCommand('Page.getResourceTree')).frameTree;
    const resources = [];
    for (const item of treeResources.resources
      .filter((r) => r.type === 'Font' || /woff|\.ttf/.test(r.url))
      .slice(0, 35)) {
      try {
        const data = await protocol.sendCommand('Page.getResourceContent', {
          frameId: treeResources.frame.id,
          url: item.url,
        });
        resources.push({
          ...item,
          base64: data.base64Encoded,
          length: data.content.length,
          prefix: data.content.slice(0, 16),
        });
      } catch (error) {
        resources.push({ ...item, error: error.message });
      }
    }
    return { samples, resources };
  } finally {
    protocol.detach();
  }
}
function reference(snapshot, rect) {
  const buffer = Buffer.alloc(rect.width * rect.height * 4, 255),
    covered = new Uint8Array(rect.width * rect.height);
  let coveredPixels = 0;
  const layers = [...(snapshot.screenshotTiles || [])];
  if (snapshot.screenshot)
    layers.push({
      rect: { ...snapshot.source.scroll, ...snapshot.source.viewport },
      data: snapshot.screenshot,
    });
  for (const layer of layers) {
    const image = nativeImage.createFromBuffer(Buffer.from(layer.data.split(',')[1], 'base64'));
    const size = image.getSize();
    const bytes = image.toBitmap();
    const x = Math.max(rect.x, layer.rect.x, layer.clip?.x || 0),
      y = Math.max(rect.y, layer.rect.y, layer.clip?.y || 0),
      right = Math.min(
        rect.x + rect.width,
        layer.rect.x + layer.rect.width,
        layer.clip ? layer.clip.x + layer.clip.width : Infinity,
      ),
      bottom = Math.min(
        rect.y + rect.height,
        layer.rect.y + layer.rect.height,
        layer.clip ? layer.clip.y + layer.clip.height : Infinity,
      );
    for (let yy = Math.ceil(y); yy < Math.floor(bottom); yy++)
      for (let xx = Math.ceil(x); xx < Math.floor(right); xx++) {
        const sx = Math.min(
            size.width - 1,
            Math.floor(((xx - layer.rect.x) * size.width) / layer.rect.width),
          ),
          sy = Math.min(
            size.height - 1,
            Math.floor(((yy - layer.rect.y) * size.height) / layer.rect.height),
          );
        const from = (sy * size.width + sx) * 4,
          to = ((yy - rect.y) * rect.width + xx - rect.x) * 4;
        bytes.copy(buffer, to, from, from + 4);
        if (!covered[to / 4]) {
          covered[to / 4] = 1;
          coveredPixels++;
        }
      }
  }
  return {
    image: nativeImage.createFromBitmap(buffer, { width: rect.width, height: rect.height }),
    coverage: coveredPixels / covered.length,
  };
}
async function checkCase(item, base) {
  const name = item.name,
    url = item.url.startsWith('/') ? base + item.url : item.url;
  const directory = path.join(output, name);
  await fs.mkdir(directory, { recursive: true });
  const result = {
    name,
    url,
    startedAt: new Date().toISOString(),
    viewport: { width: 1440, height: 1000 },
    status: 'running',
  };
  report.push(result);
  console.log('START ' + name + ' ' + url);
  try {
    if (process.env.CAPTURE_QA_REPLAY) {
      current = JSON.parse(
        await fs.readFile(
          path.join(process.env.CAPTURE_QA_REPLAY, name, 'capture.uiclone.json'),
          'utf8',
        ),
      );
      result.replayed = true;
    } else {
      await Promise.race([
        source.loadURL(url),
        new Promise((_, reject) => setTimeout(() => reject(Error('Source load timeout')), 45000)),
      ]);
      await evaluate(
        source.webContents,
        'Promise.race([Promise.all([document.fonts.ready,...[...document.images].map(i=>i.decode().catch(()=>{}))]),new Promise(r=>setTimeout(r,10000))])',
      );

      current = await captureWebsite(source.webContents, root, {
        onProgress: (p) => console.log('PROGRESS ' + name + ' ' + JSON.stringify(p)),
      });
    }
    if (!current.screenshotTiles?.length)
      throw Error('Source screenshots unavailable: ' + JSON.stringify(current.warnings?.at(-1)));
    result.viewport = current.source.viewport;
    result.offlineRenderer = true;
    result.finalUrl = current.source.url;
    result.sourceTitle = current.source.title;
    result.nodes = current.nodes.length;
    if (
      /access denied|robot check|captcha|just a moment|forbidden/i.test(result.sourceTitle) ||
      /봇 확인 절차|간단한 봇 확인|verify you are human|Checking your browser/i.test(
        current.nodes.map((n) => n.locator?.text || '').join(' '),
      ) ||
      current.nodes.length < 30
    )
      throw Error('Source is an access/error page, not the requested content');
    result.capture = current.captureReport;
    result.warnings = current.warnings;

    await fs.writeFile(path.join(directory, 'capture.uiclone.json'), JSON.stringify(current));
    renderer.setContentSize(current.source.viewport.width, current.source.viewport.height);
    await renderer.loadURL(base + '/tests/capture-render.html');
    const status = await until(
      () => evaluate(renderer.webContents, 'document.body.dataset.result'),
      'Renderer timeout',
      45000,
    );
    const details = await evaluate(
      renderer.webContents,
      'document.querySelector("#results").textContent',
    );
    if (status !== 'ready') throw Error(details);
    result.renderer = JSON.parse(details);
    if (result.renderer.missingMedia?.length)
      throw Error(
        'Visible image/frame coverage is incomplete: ' +
          JSON.stringify(result.renderer.missingMedia),
      );
    if (process.env.CAPTURE_QA_FONTS)
      result.fontSamples = {
        source: await fontSample(source.webContents),
        clone: await fontSample(renderer.webContents, true),
      };
    await fs.writeFile(
      path.join(directory, 'render-details.json'),
      JSON.stringify(result.renderer, null, 2),
    );
    const height = Math.min(current.source.height, 12000);
    const width = current.source.viewport.width;
    const regions = [
      { name: 'viewport', x: 0, y: 0, width, height: current.source.viewport.height },
      { name: 'page', x: 0, y: 0, width, height },
    ];
    result.comparisons = [];
    const viewportMode =
      current.captureReport?.screenshotMode === 'viewport-scroll' ||
      current.captureReport?.captureMode === 'extension-frame-dom-and-scroll-tiles';
    let independent;
    if (process.env.CAPTURE_QA_REPLAY) {
      try {
        independent = nativeImage.createFromBuffer(
          await fs.readFile(
            path.join(process.env.CAPTURE_QA_REPLAY, name, 'independent-source.png'),
          ),
        );
      } catch {}
    }
    if (
      independent &&
      (independent.getSize().width < width ||
        independent.getSize().height < height ||
        !hasVisibleContent(independent))
    )
      independent = null;
    const matched =
      viewportMode && !independent ? await matchingViewports(current, directory, height) : null;
    if (matched) result.viewportComparisons = matched.checks;
    result.referenceMode = matched
      ? 'matched-viewport-and-scroll'
      : independent
        ? 'independent-full-page'
        : 'product-source-tiles';
    for (const region of regions) {
      const expectedSource = reference(current, region),
        expected =
          independent && region.name === 'page'
            ? independent.crop({
                x: region.x,
                y: region.y,
                width: region.width,
                height: region.height,
              })
            : expectedSource.image,
        actual =
          matched && region.name === 'page'
            ? matched.image
            : await screenshot(renderer.webContents, region),
        compared = pngCompare(expected, actual);
      await fs.writeFile(path.join(directory, region.name + '-source.png'), expected.toPNG());
      if (!(independent && region.name === 'page') && expectedSource.coverage < 0.99999)
        throw Error(
          'Source screenshot coverage is incomplete: ' +
            (100 * expectedSource.coverage).toFixed(3) +
            '%',
        );
      if (!hasVisibleContent(expected))
        throw Error('Source screenshot has no meaningful visible content');
      await fs.writeFile(path.join(directory, region.name + '-clone.png'), actual.toPNG());
      await fs.writeFile(path.join(directory, region.name + '-diff.png'), compared.diff.toPNG());
      const { diff, ...metrics } = compared;
      result.comparisons.push({ region: region.name, ...metrics });
    }
    result.editing = await evaluate(
      renderer.webContents,
      `(async()=>{
      const scene=window.captureScene;
      const target=[...scene.nodes.values()].find(n=>n.visible&&n.kind==='element'&&n.parentId&&n.rect.width>15&&n.rect.height>15);
      if(!target)throw Error('No editable site element');
      const before=scene.rect(target.id);scene.select(target.id);scene.setEdits({[target.id]:{dx:17,dy:11}});
      const after=scene.rect(target.id);const moved=Math.abs(after.x-before.x-17)<1&&Math.abs(after.y-before.y-11)<1;
      scene.setComment(target.id,'QA: responsive layout intent');scene.remove(target.id);
      const deleted=scene.hidden(target.id);const {saveCapture,saveSession,getDocument}=await import('/db.js');
      const payload={...scene.snapshot,edits:scene.edits,annotations:scene.annotations};await saveCapture(payload);await saveSession(payload.id,payload);
      const restored=await getDocument(payload.id);const persisted=restored.edits[target.id]?.deleted&&restored.annotations[target.id]===scene.annotations[target.id];
      scene.setEdits({});scene.setComments({});
      if(!moved||!deleted||!persisted)throw Error('Site editing or persistence failed '+JSON.stringify({moved,deleted,persisted}));
      return {target:target.id,moved,deleted,persisted};
    })()`,
    );
    result.status = result.comparisons.every((c) => c.matchedPixels >= 95)
      ? 'pass'
      : 'below-target';
    result.finishedAt = new Date().toISOString();
    console.log(
      'RESULT ' +
        name +
        ' ' +
        result.status +
        ' ' +
        result.comparisons.map((c) => c.region + ':' + c.matchedPixels.toFixed(3) + '%').join(' '),
    );
  } catch (error) {
    result.status = 'error';
    result.error = error.stack;
    console.log('ERROR ' + name + ' ' + error.message);
    source.webContents.stop();
  }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(directory, 'result.json'), JSON.stringify(result, null, 2));
}
(async () => {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'console-canvas-quality-'));
  app.setPath('userData', profile);
  await app.whenReady();
  await fs.mkdir(output, { recursive: true });
  server = http.createServer(async (req, res) => {
    try {
      const name = new URL(req.url, 'http://localhost').pathname;
      if (name === '/capture-case.json') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(current));
        return;
      }
      const file = path.resolve(root, '.' + name);
      if (!file.startsWith(root + path.sep)) throw Error('Invalid path');
      res.setHeader(
        'Content-Type',
        {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.json': 'application/json',
          '.svg': 'image/svg+xml',
          '.css': 'text/css',
        }[path.extname(file)] || 'application/octet-stream',
      );
      res.end(await fs.readFile(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const options = {
    show: false,
    width: 1440,
    height: 1000,
    webPreferences: {
      offscreen: true,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  };
  source = new BrowserWindow(options);
  renderer = new BrowserWindow({
    ...options,
    webPreferences: { ...options.webPreferences, partition: 'capture-quality-renderer' },
  });
  renderer.webContents.session.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) =>
      callback({
        cancel: !details.url.startsWith('http://127.0.0.1:' + server.address().port + '/'),
      }),
  );
  source.webContents.on('will-navigate', (_event, url) => {
    if (!/^https?:/.test(url)) _event.preventDefault();
  });
  source.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const cases = process.env.CAPTURE_QA_CASES
    ? JSON.parse(await fs.readFile(process.env.CAPTURE_QA_CASES, 'utf8'))
    : [{ name: 'iframes', url: '/fixtures/iframes.html' }];
  const base = 'http://127.0.0.1:' + server.address().port;
  for (const item of cases) await checkCase(item, base);
  console.log(
    'SUMMARY ' +
      JSON.stringify(
        report.map((r) => ({
          name: r.name,
          status: r.status,
          comparisons: r.comparisons?.map((c) => ({
            region: c.region,
            matchedPixels: c.matchedPixels,
          })),
        })),
      ),
  );
  source.destroy();
  renderer.destroy();
  server.closeAllConnections();
  server.close();
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  app.exit(report.every((r) => r.status === 'pass') ? 0 : 1);
})().catch((error) => {
  console.error(error);
  app.exit(1);
});
