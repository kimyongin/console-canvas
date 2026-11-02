import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { launchChrome } from '../tests/helpers/chrome-pipe.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.resolve(
  process.env.CDP_PROBE_OUTPUT || path.join(root, 'local/extension-engine'),
);
await fs.mkdir(output, { recursive: true });
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'page-canvas-worker-proof-'));
const extension = path.join(temp, 'extension');
await fs.mkdir(extension);
const bundled = await build({
  absWorkingDir: root,
  stdin: {
    resolveDir: root,
    contents: `
import { captureTab } from './extension/capture.js';
globalThis.probeOpen = async (url) => {
  const tab = await chrome.tabs.create({url, active:true});
  const until = Date.now()+30000;
  while ((await chrome.tabs.get(tab.id)).status!=='complete') {
    if(Date.now()>until) throw Error('Source load timed out');
    await new Promise(r=>setTimeout(r,50));
  }
  return tab.id;
};
globalThis.probeCapture = async (tabId, scope) => {
  const snapshot = await captureTab(tabId, {scope});
  return {snapshot, runtime:{process:typeof process, buffer:typeof Buffer, location:location.href, node:typeof globalThis.require}};
};`,
  },
  platform: 'browser',
  format: 'iife',
  bundle: true,
  write: false,
  metafile: true,
});
assert.ok(Object.keys(bundled.metafile.inputs).includes('capture/protocol.cjs'));
assert.ok(
  !Object.keys(bundled.metafile.inputs).some(
    (name) => name.startsWith('desktop/') || name.startsWith('node_modules/'),
  ),
);
await fs.writeFile(path.join(extension, 'worker.js'), bundled.outputFiles[0].contents);
await fs.copyFile(path.join(root, 'capture.js'), path.join(extension, 'capture.js'));
await fs.writeFile(
  path.join(extension, 'manifest.json'),
  JSON.stringify({
    manifest_version: 3,
    name: 'Page Canvas browser engine proof',
    version: '0.1.0',
    permissions: ['debugger', 'tabs'],
    background: { service_worker: 'worker.js' },
  }),
);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/fixtures/probe-fallback.html') {
    res.setHeader('Content-Type', 'text/html');
    return res.end(
      '<!doctype html><style>body{margin:20px;font:16px system-ui}iframe{width:650px;height:300px;border:2px solid #6350e8}</style><h1>Shared engine fallback</h1><p>Stable cross-site iframe</p><iframe src="http://localhost:' +
        server.address().port +
        '/fixtures/capture-frame.html"></iframe><section>' +
        Array.from({ length: 30 }, (_, i) => '<p>Shared item ' + i + '</p>').join('') +
        '</section>',
    );
  }
  if (!/^\/(fixtures|tests\/fixtures)\//.test(url.pathname)) return res.writeHead(404).end();
  const file = path.resolve(root, '.' + url.pathname);
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  try {
    res.setHeader(
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
    res.end(await fs.readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const fixtureCases = [
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
const cases = process.env.EXTENSION_ENGINE_CASES
  ? JSON.parse(await fs.readFile(process.env.EXTENSION_ENGINE_CASES, 'utf8'))
  : fixtureCases;
const report = { engineFile: 'capture/protocol.cjs', browserRuntime: true, source: [], cases: [] };
for (const name of Object.keys(bundled.metafile.inputs).filter((name) => name !== '<stdin>'))
  report.source.push({
    name,
    sha256: createHash('sha256')
      .update(await fs.readFile(path.join(root, name)))
      .digest('hex'),
  });
const chrome = launchChrome(path.join(temp, 'profile'), {
  logFile: path.join(output, 'chrome.log'),
});
try {
  report.browser = await chrome.send('Browser.getVersion');
  const installed = await chrome.send('Extensions.loadUnpacked', { path: extension });
  let worker;
  for (let i = 0; i < 200; i++) {
    worker = (await chrome.send('Target.getTargets')).targetInfos.find(
      (t) =>
        t.type === 'service_worker' && t.url.startsWith('chrome-extension://' + installed.id + '/'),
    );
    if (worker) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(worker, 'Extension worker running');
  const { sessionId } = await chrome.send('Target.attachToTarget', {
    targetId: worker.targetId,
    flatten: true,
  });
  const evaluate = async (expression) => {
    const r = await chrome.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    if (r.exceptionDetails)
      throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  for (let i = 0; i < 200; i++) {
    if (await evaluate("typeof globalThis.probeOpen === 'function'")) break;
    if (i === 199) throw Error('Worker script did not initialize');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  for (const item of cases) {
    const row = { name: item.name };
    report.cases.push(row);
    try {
      const id = await evaluate(`probeOpen(${JSON.stringify(item.url)})`);
      // Test setup only: put the scroll fixture at its intended initial scroll position.
      if (item.name.startsWith('scroll-')) {
        await evaluate(
          `(async()=>{await chrome.debugger.attach({tabId:${id}},'1.3');try{await chrome.debugger.sendCommand({tabId:${id}},'Runtime.evaluate',{expression:'scrollTo(0,500)'})}finally{await chrome.debugger.detach({tabId:${id}})}})()`,
        );
      }
      const result = await evaluate(
        `probeCapture(${id},${JSON.stringify({ mode: item.mode, rect: item.rect })})`,
      );
      assert.equal(result.runtime.process, 'undefined');
      assert.equal(result.runtime.buffer, 'undefined');
      assert.equal(result.runtime.node, 'undefined');
      const snapshot = result.snapshot;
      if (item.expectedTitle)
        assert.match(
          snapshot.source.title,
          new RegExp(item.expectedTitle, 'i'),
          'Expected real page content, not a browser/challenge screen',
        );
      assert.doesNotMatch(
        snapshot.source.title,
        /just a moment|access denied|security verification|privacy error/i,
      );
      assert.ok(snapshot.nodes.length >= (item.name.startsWith('scroll-') ? 500 : 5));
      const dir = path.join(output, item.name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'capture.uiclone.json'), JSON.stringify(snapshot));
      Object.assign(row, {
        ok: true,
        nodes: snapshot.nodes.length,
        title: snapshot.source.title,
        url: snapshot.source.url,
        domFrames: snapshot.captureReport.domFrames,
        failedFrames: snapshot.captureReport.failedFrames,
        viewport: snapshot.source.viewport,
        runtime: result.runtime,
      });
      console.log(
        'PASS browser worker ' +
          item.name +
          ' ' +
          row.nodes +
          ' nodes / ' +
          row.domFrames +
          ' DOM frames',
      );
      await evaluate(`chrome.tabs.remove(${id})`);
    } catch (error) {
      row.ok = false;
      row.error = error.stack;
      console.error('FAIL ' + item.name + ': ' + error.message);
    }
  }
  const casesFile = path.join(output, 'cases.json');
  await fs.writeFile(
    casesFile,
    JSON.stringify(
      cases.map((item) => ({
        ...item,
        viewport: report.cases.find((c) => c.name === item.name)?.viewport,
      })),
    ),
  );
  const native = await promisify(execFile)(
    path.join(root, 'node_modules/.bin/electron'),
    [path.join(root, 'experiments/cdp-compat/baseline.cjs')],
    {
      env: {
        ...process.env,
        CDP_PROBE_CASES_FILE: casesFile,
        CDP_PROBE_OUTPUT: output,
        CDP_PROBE_PROFILE: path.join(temp, 'native-profile'),
      },
      timeout: process.env.EXTENSION_ENGINE_CASES ? 900000 : 240000,
      maxBuffer: 10_000_000,
    },
  );
  await fs.writeFile(path.join(output, 'native.log'), native.stdout + native.stderr);
  report.native = JSON.parse(await fs.readFile(path.join(output, 'native-report.json'), 'utf8'));
  for (const row of report.cases) {
    const native = report.native.find((n) => n.name === row.name);
    assert.ok(native.ok);
    if (!process.env.EXTENSION_ENGINE_CASES) {
      assert.equal(row.nodes, native.nodes, row.name + ' elements');
      assert.equal(row.domFrames, native.domFrames, row.name + ' DOM frames');
    }
  }
  report.ok = report.cases.every((row) => row.ok);
} catch (error) {
  report.ok = false;
  report.error = error.stack;
  console.error(error.message);
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await chrome.stop();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
console.log(JSON.stringify({ ok: report.ok, output }));
if (!report.ok) process.exitCode = 1;
