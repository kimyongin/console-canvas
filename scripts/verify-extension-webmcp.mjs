import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { launchChrome } from '../tests/helpers/chrome-pipe.mjs';

// A headed, already-running installed Chrome. Official MCP connects by browser URL,
// not the pipe used solely by this harness to install the temporary extension.
const root = path.resolve(import.meta.dirname, '..');
const output = path.resolve(process.env.WEBMCP_OUTPUT || path.join(root, 'local/extension-webmcp'));
const mcpRoot =
  process.env.WEBMCP_MCP_ROOT ||
  path.join(root, 'local/webmcp-experiment/node_modules/chrome-devtools-mcp');
const version = JSON.parse(await fs.readFile(path.join(mcpRoot, 'package.json'), 'utf8')).version;
await fs.mkdir(output, { recursive: true });
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'page-canvas-headed-webmcp-'));
const extension = path.join(temp, 'extension'),
  profile = path.join(temp, 'profile');
await fs.mkdir(extension);
const assets = JSON.parse(
  await fs.readFile(path.join(root, 'runtime-manifest.json'), 'utf8'),
).public;
for (const name of assets) {
  const target = path.join(extension, name);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(path.join(root, name), target);
}
for (const name of ['review-image.html', 'review-image.css', 'review-image.js'])
  await fs.copyFile(path.join(root, 'extension', name), path.join(extension, name));
const proof = await build({
  absWorkingDir: root,
  stdin: {
    resolveDir: root,
    contents: `
import { createWebMcpClient } from './extension/webmcp.js';
(async()=>{
  const deadline=Date.now()+30000;
  while(!window.ConsoleCanvas?.state.ready){if(Date.now()>deadline)throw Error('Editor initialization timed out');await new Promise(r=>setTimeout(r,50));}
  const bridge=await createWebMcpClient({workspace:window.ConsoleCanvas.ticketWorkspace,onStatus:s=>document.body.dataset.webmcp=JSON.stringify(s)});
  const result=await bridge.enable();
  document.body.dataset.webmcpProof=JSON.stringify(result);
})().catch(e=>document.body.dataset.webmcpProof=JSON.stringify({ok:false,error:e.message}));
`,
  },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
});
await fs.writeFile(path.join(extension, 'proof-entry.js'), proof.outputFiles[0].contents);
await fs.writeFile(
  path.join(extension, 'editor.html'),
  (await fs.readFile(path.join(extension, 'editor.html'), 'utf8')).replace(
    '</body>',
    '<script src="proof-entry.js"></script></body>',
  ),
);
const capture = await build({
  absWorkingDir: root,
  stdin: {
    resolveDir: root,
    contents: `import {captureTab} from './extension/capture.js';globalThis.probeCapture=captureTab;`,
  },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
});
await fs.writeFile(path.join(extension, 'worker.js'), capture.outputFiles[0].contents);
await fs.writeFile(
  path.join(extension, 'manifest.json'),
  JSON.stringify({
    manifest_version: 3,
    name: 'Page Canvas standalone WebMCP proof',
    version: '0.1.0',
    permissions: ['debugger', 'tabs'],
    background: { service_worker: 'worker.js' },
    cross_origin_opener_policy: { value: 'same-origin' },
    cross_origin_embedder_policy: { value: 'require-corp' },
  }),
);
const fixtures = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = path.resolve(root, '.' + url.pathname);
  if (!url.pathname.startsWith('/fixtures/') || !file.startsWith(root + path.sep))
    return res.writeHead(404).end();
  try {
    res.setHeader(
      'Content-Type',
      { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }[path.extname(file)] ||
        'application/octet-stream',
    );
    res.end(await fs.readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => fixtures.listen(0, '127.0.0.1', resolve));
const report = {
  mcpVersion: version,
  headed: true,
  existingBrowserConnection: true,
  checks: [],
  calls: [],
  pageCanvasServers: 0,
};
const chrome = launchChrome(profile, {
  headed: true,
  args: ['--remote-debugging-port=0', '--enable-features=WebMCP'],
  logFile: path.join(output, 'chrome.log'),
});
let client, transport;
const textOf = (r) =>
  (r.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
const check = (name, value) => {
  assert.ok(value, name);
  report.checks.push(name);
  console.log('PASS ' + name);
};
try {
  report.browser = await chrome.send('Browser.getVersion');
  const { id } = await chrome.send('Extensions.loadUnpacked', { path: extension });
  const deadline = Date.now() + 15000;
  let port;
  while (Date.now() < deadline) {
    try {
      port = Number(
        (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0],
      );
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  assert.ok(port, 'Existing browser exposes its official debugging endpoint');
  report.connection = 'browser-url';
  client = new Client({ name: 'page-canvas-independent-proof', version: '0.1.0' });
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.join(mcpRoot, 'build/src/bin/chrome-devtools-mcp.js'),
      '--browser-url=http://127.0.0.1:' + port,
      '--categoryExperimentalWebmcp',
      '--categoryExtensions',
      '--no-usage-statistics',
      '--no-performance-crux',
      '--filesystemRoot=' + output,
    ],
    env: {
      ...process.env,
      CHROME_DEVTOOLS_MCP_NO_CONFIG_DISCOVERY: '1',
      CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1',
    },
    stderr: 'pipe',
  });
  transport.stderr.on('data', (data) => void fs.appendFile(path.join(output, 'server.log'), data));
  await client.connect(transport);
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
    report.calls.push({ name, isError: !!result.isError });
    if (result.isError) throw Error(name + ': ' + textOf(result));
    return result;
  };
  const pageId = (result, url) => {
    const line = textOf(result)
      .split('\n')
      .find((line) => /^\d+:/.test(line) && line.includes(url));
    assert.ok(line, 'MCP page ' + url);
    return Number(line.match(/^\d+/)[0]);
  };
  const url = 'chrome-extension://' + id + '/editor.html?sample=1';
  const editor = pageId(await call('new_page', { url }), url);
  const observe = async (fn) => {
    const r = await call('evaluate_script', {
      pageId: editor,
      function: fn,
      waitForStableDom: false,
    });
    return JSON.parse(textOf(r).match(/```json\s*([\s\S]*?)\s*```/)[1]);
  };
  const status = await observe(
    `async()=>{for(let i=0;i<600&&!document.body.dataset.webmcpProof;i++)await new Promise(r=>setTimeout(r,50));return {proof:JSON.parse(document.body.dataset.webmcpProof||'{}'),text:document.body.innerText.slice(-1000),api:typeof document.modelContext,isolated:crossOriginIsolated}}`,
  );
  report.registration = status;
  check('Native WebMCP registers in a headed Chrome extension', status.proof.ok);
  const tools = await call('list_webmcp_tools', { pageId: editor });
  check(
    'Official external MCP discovers Page Canvas tools',
    textOf(tools).includes('page_canvas_list_tickets'),
  );
  const web = async (name, args = {}) => {
    const r = await call('execute_webmcp_tool', {
      pageId: editor,
      toolName: 'page_canvas_' + name,
      input: JSON.stringify(args),
    });
    const envelope = JSON.parse(r.structuredContent?.message || textOf(r));
    if (envelope.error) throw Error(envelope.error);
    const value =
      typeof envelope.output === 'string' ? JSON.parse(envelope.output) : envelope.output;
    assert.equal(value.ok, true, JSON.stringify(value));
    return value;
  };
  const projects = await web('list_projects'),
    project = projects.projects[0];
  const base = { workspace_id: projects.workspace_id, project_id: project.id };
  const tickets = await web('list_tickets', base);
  check('Saved tickets are listed through WebMCP', tickets.tickets?.length === 1);
  const ticket = tickets.tickets[0];
  base.ticket_ref = ticket.id;
  const screen = await web('get_screen', base);
  const elements = await web('list_elements', { ...base, query: 'new-customer' });
  const button = elements.elements.find((n) => n.locator.id === 'new-customer');
  check('Original element identity survives', !!button);
  const observeButton = () =>
    observe(
      `()=>{const a=window.ConsoleCanvas,e=a.state.scene.elements.get(${JSON.stringify(button.id)}),r=e.getBoundingClientRect();return {x:r.x,y:r.y,revision:a.state.revision}}`,
    );
  const before = await observeButton();
  const applied = await web('apply_edits', {
    ...base,
    expected_edit_revision: screen.screen.revision,
    operation_id: randomUUID(),
    operations: [
      { type: 'move', element_id: button.id, mode: 'relative', dx: 24, dy: 12 },
      { type: 'comment', element_id: button.id, text: '독립 확장 WebMCP 검증' },
    ],
  });
  const after = await observeButton();
  check(
    'External tool changes real captured DOM and saves',
    Math.abs(after.x - before.x - 24) < 1 &&
      Math.abs(after.y - before.y - 12) < 1 &&
      applied.persisted,
  );
  const image = await web('get_review_image', base);
  check(
    'Edited image has an extension-local preview',
    image.image?.preview_url?.startsWith('chrome-extension://' + id + '/'),
  );
  const viewer = pageId(
    await call('new_page', { url: image.image.preview_url }),
    image.image.preview_url,
  );
  await call('evaluate_script', {
    pageId: viewer,
    function:
      'async()=>{await document.querySelector("#image").decode();return {width:document.querySelector("#image").naturalWidth}}',
  });
  const screenshot = await call('take_screenshot', { pageId: viewer, fullPage: true });
  const block = screenshot.content.find((c) => c.type === 'image');
  check('External agent receives actual image content', !!block?.data);
  await fs.writeFile(path.join(output, 'agent-review.png'), Buffer.from(block.data, 'base64'));
  const undone = await web('undo', {
    ...base,
    expected_edit_revision: applied.screen.revision,
    operation_id: randomUUID(),
  });
  const restored = await observeButton();
  check(
    'Undo restores real geometry and persists',
    Math.abs(restored.x - before.x) < 1 && Math.abs(restored.y - before.y) < 1 && undone.persisted,
  );
  const sourceUrl = 'http://127.0.0.1:' + fixtures.address().port + '/fixtures/console.html';
  await call('new_page', { url: sourceUrl });
  const worker = (await chrome.send('Target.getTargets')).targetInfos.find(
    (target) =>
      target.type === 'service_worker' && target.url.startsWith('chrome-extension://' + id + '/'),
  );
  const { sessionId } = await chrome.send('Target.attachToTarget', {
    targetId: worker.targetId,
    flatten: true,
  });
  const captured = await chrome.send(
    'Runtime.evaluate',
    {
      expression: `(async()=>{const [tab]=await chrome.tabs.query({url:${JSON.stringify(sourceUrl)}});const snapshot=await probeCapture(tab.id,{scope:{mode:'viewport'}});return {nodes:snapshot.nodes.length,url:snapshot.source.url,domFrames:snapshot.captureReport.domFrames}})()`,
      returnByValue: true,
      awaitPromise: true,
    },
    sessionId,
  );
  if (captured.exceptionDetails)
    throw Error(captured.exceptionDetails.exception?.description || captured.exceptionDetails.text);
  report.concurrentCapture = captured.result.value;
  check(
    'Extension captures an HTTP source while the external MCP remains connected',
    report.concurrentCapture.nodes > 300 && report.concurrentCapture.url === sourceUrl,
  );
  await call('take_screenshot', { pageId: editor, filePath: path.join(output, 'editor.png') });
  report.ok = true;
} catch (e) {
  report.ok = false;
  report.error = e.stack;
  console.error(e.message);
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await client?.close().catch(() => {});
  await transport?.close().catch(() => {});
  await chrome.stop();
  fixtures.closeAllConnections();
  await new Promise((resolve) => fixtures.close(resolve));
  await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
console.log(JSON.stringify({ ok: report.ok, checks: report.checks.length, output }));
if (!report.ok) process.exitCode = 1;
