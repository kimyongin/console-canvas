// Actual Chrome extension API -> unmodified production captureWithProtocol engine in Node.
// A disposable headless profile only; browser-level CDP bootstraps the extension, never captures pages.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../..');
const { captureWithProtocol } = require(path.join(root, 'desktop/capture-cdp.cjs'));
const { prepareCaptureView } = require(path.join(root, 'desktop/capture-view.cjs'));
const { resolveScope } = require(path.join(root, 'desktop/capture.cjs'));
const { readPublicResource } = require(path.join(root, 'desktop/capture-resources.cjs'));
const output = path.resolve(process.env.CDP_PROBE_OUTPUT || path.join(root, 'local/cdp-compat'));
await fs.mkdir(output, { recursive: true });
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'page-canvas-cdp-probe-'));
const extension = path.join(temporary, 'extension');
await fs.mkdir(extension);
const token = randomBytes(32).toString('hex');
let sequence = 0,
  queue = [],
  poll = null,
  hello,
  fatal;
const pending = new Map();
let targets = [],
  calls = [],
  activeCase = null,
  rootFrameId = null,
  injected = false;
const report = {
  engineSha256: createHash('sha256')
    .update(await fs.readFile(path.join(root, 'desktop/capture-cdp.cjs')))
    .digest('hex'),
  productVersion: JSON.parse(await fs.readFile(path.join(root, 'package.json'))).version,
  isolated: true,
  sameEngineFile: 'desktop/capture-cdp.cjs',
  cases: [],
  calls: [],
};
function dispatch() {
  if (!poll || !queue.length) return;
  const { response, timer } = poll;
  poll = null;
  clearTimeout(timer);
  response.end(JSON.stringify(queue.shift()));
}
function command(value) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error('Extension transport timed out: ' + (value.method || value.action)));
    }, 65000);
    pending.set(id, { resolve, reject, timer });
    queue.push({ id, ...value });
    dispatch();
  });
}
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const protectedRoute = ['/next', '/hello', '/event', '/result', '/fatal'].includes(
      url.pathname,
    );
    if (protectedRoute && request.headers.authorization !== 'Bearer ' + token)
      return response.writeHead(403).end();
    response.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/next') {
      const timer = setTimeout(() => {
        if (poll?.response === response) poll = null;
        response.end('null');
      }, 20000);
      poll = { response, timer };
      return dispatch();
    }
    if (protectedRoute) {
      let data = '';
      for await (const chunk of request) {
        data += chunk;
        if (data.length > 100_000_000) throw Error('Probe body limit');
      }
      const value = JSON.parse(data);
      if (url.pathname === '/hello') hello = value;
      if (url.pathname === '/fatal') fatal = value.error;
      if (url.pathname === '/event' && value.method === 'Target.attachedToTarget')
        targets.push(value.params);
      if (url.pathname === '/result') {
        const entry = pending.get(value.id);
        if (entry) {
          pending.delete(value.id);
          clearTimeout(entry.timer);
          value.error ? entry.reject(Error(value.error)) : entry.resolve(value.result);
        }
      }
      return response.end('{}');
    }
    if (url.pathname === '/fixtures/probe-fallback.html') {
      response.setHeader('Content-Type', 'text/html');
      return response.end(
        '<!doctype html><style>body{margin:20px;font:16px system-ui}iframe{width:650px;height:300px;border:2px solid #6350e8}</style><h1>Shared engine fallback</h1><p>Stable cross-site iframe</p><iframe src="http://localhost:' +
          server.address().port +
          '/fixtures/capture-frame.html"></iframe><section>' +
          Array.from({ length: 30 }, (_, i) => '<p>Shared item ' + i + '</p>').join('') +
          '</section>',
      );
    }
    const file = path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + path.sep) || !/^\/(fixtures|tests\/fixtures)\//.test(url.pathname))
      return response.writeHead(404).end();
    response.setHeader(
      'Content-Type',
      {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'text/javascript',
        '.svg': 'image/svg+xml',
        '.jpg': 'image/jpeg',
        '.webp': 'image/webp',
      }[path.extname(file)] || 'application/octet-stream',
    );
    response.end(await fs.readFile(file));
  } catch (e) {
    response.writeHead(500).end(JSON.stringify({ error: e.message }));
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const cases = [
  { name: 'cross-frame-fallback', url: base + '/fixtures/probe-fallback.html', mode: 'viewport' },
  { name: 'console', url: base + '/fixtures/console.html', mode: 'document' },
  { name: 'complex', url: base + '/fixtures/capture-quality.html', mode: 'document' },
  { name: 'iframes', url: base + '/fixtures/iframes.html', mode: 'document' },
  { name: 'scroll-viewport', url: base + '/tests/fixtures/console-states.html', mode: 'viewport' },
  {
    name: 'scroll-region',
    url: base + '/tests/fixtures/console-states.html',
    mode: 'region',
    rect: { x: 270, y: 40, width: 500, height: 300 },
  },
];
await fs.writeFile(
  path.join(extension, 'manifest.json'),
  JSON.stringify({
    manifest_version: 3,
    name: 'Page Canvas shared CDP compatibility probe',
    version: '0.1.0',
    permissions: ['debugger', 'tabs'],
    host_permissions: [base + '/*', 'http://localhost/*'],
    background: { service_worker: 'relay.js' },
  }),
);
await fs.copyFile(path.join(import.meta.dirname, 'relay.js'), path.join(extension, 'relay.js'));
await fs.writeFile(
  path.join(extension, 'config.js'),
  'self.PROBE_CONFIG=' +
    JSON.stringify({ url: base, token, allowedUrls: cases.map((c) => c.url) }) +
    ';',
);
const binary =
  process.env.CDP_PROBE_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(
  binary,
  [
    '--headless=new',
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    '--user-data-dir=' + path.join(temporary, 'profile'),
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1440,1000',
    '--force-device-scale-factor=1',
    '--site-per-process',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] },
);
const log = [];
chrome.stderr.on('data', (d) => log.push(String(d)));
let browserSequence = 0,
  buffer = Buffer.alloc(0);
const browserPending = new Map();
chrome.stdio[4].on('data', (data) => {
  buffer = Buffer.concat([buffer, data]);
  let end;
  while ((end = buffer.indexOf(0)) >= 0) {
    const raw = buffer.subarray(0, end).toString();
    buffer = buffer.subarray(end + 1);
    if (!raw) continue;
    const message = JSON.parse(raw),
      entry = browserPending.get(message.id);
    if (entry) {
      browserPending.delete(message.id);
      clearTimeout(entry.timer);
      message.error
        ? entry.reject(Error(JSON.stringify(message.error)))
        : entry.resolve(message.result);
    }
  }
});
function browserCommand(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++browserSequence,
      timer = setTimeout(() => {
        browserPending.delete(id);
        reject(Error('Browser bootstrap timed out: ' + method));
      }, 20000);
    browserPending.set(id, { resolve, reject, timer });
    chrome.stdio[3].write(JSON.stringify({ id, method, params }) + '\0');
  });
}
async function until(read, label, timeout = 35000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (value) return value;
    if (fatal) throw Error(fatal);
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error(label);
}
const send = async (method, params = {}, session) => {
  const item = {
    case: activeCase,
    method,
    session: !!session,
    normalized: activeCase === 'cross-frame-fallback' && method === 'Target.attachToTarget',
  };
  calls.push(item);
  try {
    if (
      activeCase === 'cross-frame-fallback' &&
      method === 'Page.createIsolatedWorld' &&
      params.frameId !== rootFrameId &&
      !injected
    ) {
      injected = true;
      item.injected = true;
      throw Error('Probe injected delayed child execution context');
    }
    const value = await command({
      action: 'send',
      method,
      params,
      session,
      normalizeAttach: item.normalized,
    });
    if (method === 'Page.getFrameTree' && !session) rootFrameId = value.frameTree.frame.id;
    item.ok = true;
    return value;
  } catch (e) {
    item.ok = false;
    item.error = e.message;
    throw e;
  }
};
const view = {
  getURL: () => cases.find((c) => c.name === activeCase)?.url,
  executeJavaScriptInIsolatedWorld: async (_id, entries) => {
    const result = await send('Runtime.evaluate', {
      expression: entries.map((e) => e.code).join('\n'),
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    return result.result?.value;
  },
};
const settleView = require('./settle-view.cjs');
const code = await fs.readFile(path.join(root, 'capture.js'), 'utf8');
try {
  report.browser = await browserCommand('Browser.getVersion');
  report.extension = await browserCommand('Extensions.loadUnpacked', { path: extension });
  await until(() => hello, 'Extension did not start');
  for (const item of cases) {
    activeCase = item.name;
    targets = [];
    rootFrameId = null;
    injected = false;
    console.log('START ' + item.name);
    const result = { name: item.name, url: item.url, scope: item.mode };
    report.cases.push(result);
    try {
      await command({ action: 'open', url: item.url });
      await send('Runtime.evaluate', {
        expression:
          'Promise.all([document.fonts.ready,...[...document.images].map(i=>i.decode().catch(()=>{}))])',
        awaitPromise: true,
        returnByValue: true,
      });
      result.viewportReadiness = (
        await send('Runtime.evaluate', {
          expression: settleView,
          returnByValue: true,
          awaitPromise: true,
        })
      ).result.value;
      assert.ok(
        result.viewportReadiness.stable,
        'Test viewport must settle after debugger connection',
      );
      if (item.name.startsWith('scroll-'))
        await send('Runtime.evaluate', { expression: 'scrollTo(0,500)' });
      const read = async (expression) =>
        (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))
          .result?.value;
      const before = await read(
        'JSON.stringify({html:document.documentElement.outerHTML,scroll:[scrollX,scrollY],actions:globalThis.actions||0})',
      );
      const scope = await resolveScope(view, { mode: item.mode, rect: item.rect });
      const prepared = await prepareCaptureView(view, code, { scope });
      const snapshot = await captureWithProtocol({
        send,
        code,
        scope,
        getTargets: () => targets,
        readResource: (url) => readPublicResource(url, fetch),
      });
      snapshot.captureScope = scope;
      snapshot.captureReport.preparedView = prepared;
      const after = await read(
        'JSON.stringify({html:document.documentElement.outerHTML,scroll:[scrollX,scrollY],actions:globalThis.actions||0})',
      );
      assert.equal(before, after, 'Source DOM, scroll and actions must be restored');
      assert.ok(
        snapshot.nodes.length >=
          (item.name === 'console'
            ? 300
            : item.name.startsWith('scroll-')
              ? 500
              : item.name === 'complex'
                ? 50
                : 5),
      );
      assert.ok(snapshot.screenshot?.startsWith('data:image/png;base64,'));
      const dir = path.join(output, item.name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'capture.uiclone.json'), JSON.stringify(snapshot));
      await fs.writeFile(
        path.join(dir, 'source.png'),
        Buffer.from(snapshot.screenshot.split(',')[1], 'base64'),
      );
      Object.assign(result, {
        ok: true,
        nodes: snapshot.nodes.length,
        sourceUnchanged: true,
        frames: snapshot.captureReport.frameCount,
        domFrames: snapshot.captureReport.domFrames,
        closedShadowRoots: snapshot.captureReport.closedShadowRoots,
        failedFrames: snapshot.captureReport.failedFrames,
        screenshotMode: snapshot.captureReport.screenshotMode,
        viewport: snapshot.source.viewport,
      });
      if (item.name === 'complex') {
        assert.ok(result.closedShadowRoots >= 1, 'Closed shadow DOM must be collected');
        assert.ok(
          snapshot.nodes.some(
            (n) =>
              n.locator?.id === 'closed-control' || n.locator?.selector?.includes('closed-control'),
          ),
          'Closed shadow control identity must survive',
        );
        assert.ok(
          result.failedFrames.every(
            (f) => f.error.code === 'frame_changed_during_capture' && f.url === 'about:srcdoc',
          ),
          'Only the deliberately changing iframe may fall back to its captured image',
        );
        const child = targets.find((t) => t.targetInfo?.type === 'iframe');
        assert.ok(child, 'Out-of-process iframe session must exist');
        try {
          const attached = await send('Target.attachToTarget', {
            targetId: child.targetInfo.targetId,
            flatten: true,
          });
          report.rawAttach = { supported: true, session: !!attached.sessionId };
        } catch (e) {
          report.rawAttach = { supported: false, error: e.message };
        }
        try {
          await command({ action: 'directAttach', targetId: child.targetInfo.targetId });
          const tree = await command({
            action: 'directSend',
            targetId: child.targetInfo.targetId,
            method: 'Page.getFrameTree',
          });
          report.alternativeAttachment = {
            supported: !!tree.frameTree,
            frameUrl: tree.frameTree?.frame?.url,
          };
          await command({ action: 'directDetach', targetId: child.targetInfo.targetId });
        } catch (e) {
          report.alternativeAttachment = { supported: false, error: e.message };
        }
      }
      if (item.name === 'cross-frame-fallback')
        assert.ok(
          calls.some((c) => c.case === item.name && c.normalized && c.ok),
          'Shared engine fallback must execute through normalized extension attachment',
        );
      console.log(
        'PASS ' +
          item.name +
          ' ' +
          snapshot.nodes.length +
          ' nodes / ' +
          result.domFrames +
          ' DOM frames',
      );
    } catch (e) {
      result.ok = false;
      result.error = e.stack;
      console.log('FAIL ' + item.name + ': ' + e.message);
    }
  }
  // Probe fallback-only commands against a real frame without altering the engine's algorithms.
  activeCase = 'fallback-command-coverage';
  const frame = (await send('Page.getFrameTree')).frameTree.frame;
  const loaded = (
    await send('Network.loadNetworkResource', {
      frameId: frame.id,
      url: base + '/fixtures/capture-photo.jpg',
      options: { disableCache: false, includeCredentials: false },
    })
  ).resource;
  assert.ok(loaded.success && loaded.stream);
  const part = await send('IO.read', { handle: loaded.stream, size: 64 });
  assert.ok(part.data);
  await send('IO.close', { handle: loaded.stream });
  const commandSource = await fs.readFile(path.join(root, 'desktop/capture-cdp.cjs'), 'utf8');
  const required = [
    ...new Set(
      [
        ...commandSource.matchAll(
          /(?:send\(\s*|call\(\s*[^,]+,\s*)['"]([A-Z][A-Za-z]+\.[A-Za-z]+)['"]/g,
        ),
      ].map((m) => m[1]),
    ),
  ].sort();
  report.commandCoverage = required.map((method) => ({
    method,
    ok: calls.some((c) => c.method === method && c.ok && !c.normalized),
    failures: calls.filter((c) => c.method === method && !c.ok).map((c) => c.error),
  }));
  const nativeCases = cases.map((item) => ({
    ...item,
    viewport: report.cases.find((c) => c.name === item.name)?.viewport,
  }));
  const casesFile = path.join(output, 'cases.json');
  await fs.writeFile(casesFile, JSON.stringify(nativeCases));
  const electron = path.join(root, 'node_modules/.bin/electron');
  const baseline = await promisify(execFile)(
    electron,
    [path.join(import.meta.dirname, 'baseline.cjs')],
    {
      env: {
        ...process.env,
        CDP_PROBE_CASES_FILE: casesFile,
        CDP_PROBE_OUTPUT: output,
        CDP_PROBE_PROFILE: path.join(temporary, 'electron-profile'),
      },
      timeout: 240000,
      maxBuffer: 10_000_000,
    },
  );
  await fs.writeFile(path.join(output, 'native.log'), baseline.stdout + baseline.stderr);
  report.native = JSON.parse(await fs.readFile(path.join(output, 'native-report.json'), 'utf8'));
  report.normalizedCommandCoverage = required.map((method) => ({
    method,
    ok: calls.some((c) => c.method === method && c.ok),
  }));
  report.allRequiredOperationsSupported = report.normalizedCommandCoverage.every((c) => c.ok);
  report.captureSuitePassed = report.cases.every((c) => c.ok) && report.native.every((c) => c.ok);
  report.allRawCommandsSupported = report.commandCoverage.every((c) => c.ok);
  report.ok = report.captureSuitePassed && report.allRequiredOperationsSupported;
  report.investigationComplete = true;
} catch (e) {
  report.ok = false;
  report.error = e.stack;
  console.error(e.message);
} finally {
  report.calls = calls;
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(output, 'chrome.log'), log.join(''));
  const exited = new Promise((resolve) => {
    if (chrome.exitCode !== null) resolve();
    else chrome.once('exit', resolve);
  });
  await Promise.race([browserCommand('Browser.close').catch(() => {}), exited]);
  await Promise.race([exited, new Promise((r) => setTimeout(r, 1500))]);
  if (chrome.exitCode === null) chrome.kill('SIGTERM');
  await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
  for (const p of browserPending.values()) clearTimeout(p.timer);
  browserPending.clear();
  if (poll) {
    clearTimeout(poll.timer);
    poll.response.end('null');
    poll = null;
  }
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(Error('Probe finished'));
  }
  pending.clear();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
console.log(
  JSON.stringify({
    ok: report.ok,
    browser: report.browser?.product,
    cases: report.cases.map((c) => ({
      name: c.name,
      ok: c.ok,
      nodes: c.nodes,
      frames: c.domFrames,
      error: c.error?.split('\n')[0],
    })),
    coverage: report.commandCoverage,
    output,
  }),
);
if (!report.ok) process.exitCode = 1;
