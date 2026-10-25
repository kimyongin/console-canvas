// Real Chrome + official Chrome DevTools MCP, using an isolated browser profile.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(import.meta.dirname, '../..');
const output = path.join(root, 'local/webmcp-experiment');
const chrome =
  process.env.WEBMCP_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const mcpRoot =
  process.env.WEBMCP_MCP_ROOT || path.join(output, 'node_modules/chrome-devtools-mcp');
const mcpVersion = JSON.parse(
  await fs.readFile(path.join(mcpRoot, 'package.json'), 'utf8'),
).version;
assert.equal(mcpVersion, '1.12.0', 'Use the documented, pinned official MCP version');
await fs.mkdir(output, { recursive: true });
const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'console-canvas-webmcp-extension-'));
const report = {
  sourceVersion: JSON.parse(await fs.readFile(path.join(root, 'package.json'))).version,
  mcpVersion,
  chrome,
  checks: [],
  calls: [],
  mode: 'isolated headless Chrome; no native host or Console Canvas MCP server',
};
let client, transport, server;
const textOf = (result) =>
  result.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
function check(name, value) {
  assert.ok(value, name);
  report.checks.push(name);
  console.log('PASS: ' + name);
}
async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  report.calls.push({ name, arguments: args, isError: !!result.isError });
  if (result.isError) throw new Error(name + ': ' + textOf(result));
  return result;
}
async function evaluate(pageId, fn) {
  const result = await call('evaluate_script', { pageId, function: fn, waitForStableDom: false });
  const text = textOf(result);
  return JSON.parse(text.match(/```json\s*([\s\S]*?)\s*```/)[1]);
}
function pageId(result, url) {
  const line = textOf(result)
    .split('\n')
    .find((line) => line.includes(url) && /^\d+:/.test(line));
  assert.ok(line, 'Page listed: ' + url);
  return Number(line.match(/^\d+/)[0]);
}
async function openClient(enabled) {
  client = new Client({ name: 'console-canvas-webmcp-experiment', version: '0.1.0' });
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.join(mcpRoot, 'build/src/bin/chrome-devtools-mcp.js'),
      '--headless',
      '--isolated',
      '--categoryExtensions',
      '--categoryExperimentalWebmcp',
      '--executablePath=' + chrome,
      '--chromeArg=--' + (enabled ? 'enable' : 'disable') + '-features=WebMCP',
      '--viewport=1600x1100',
      '--no-usage-statistics',
      '--no-performance-crux',
      '--filesystemRoot=' + stage,
      '--filesystemRoot=' + output,
    ],
    env: {
      ...process.env,
      CHROME_DEVTOOLS_MCP_NO_CONFIG_DISCOVERY: '1',
      CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1',
    },
    stderr: 'pipe',
  });
  await client.connect(transport);
  transport.stderr.on('data', (data) =>
    fs.appendFile(path.join(output, 'server.log'), data).catch(() => {}),
  );
}
async function install() {
  const result = await call('install_extension', { path: stage });
  return textOf(result).match(/Id: ([a-p]{32})/)[1];
}
try {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'runtime-manifest.json'), 'utf8'));
  for (const name of new Set([...manifest.public, 'manifest.json', 'background.js'])) {
    await fs.mkdir(path.dirname(path.join(stage, name)), { recursive: true });
    await fs.copyFile(path.join(root, name), path.join(stage, name));
  }
  const html = await fs.readFile(path.join(stage, 'editor.html'), 'utf8');
  const extensionManifest = JSON.parse(
    await fs.readFile(path.join(stage, 'manifest.json'), 'utf8'),
  );
  extensionManifest.cross_origin_opener_policy = { value: 'same-origin' };
  extensionManifest.cross_origin_embedder_policy = { value: 'require-corp' };
  await fs.writeFile(path.join(stage, 'manifest.json'), JSON.stringify(extensionManifest, null, 2));
  await fs.writeFile(
    path.join(stage, 'editor.html'),
    html.replace('</body>', '<script type="module" src="webmcp-experiment.js"></script></body>'),
  );
  await fs.copyFile(
    path.join(import.meta.dirname, 'adapter.js'),
    path.join(stage, 'webmcp-experiment.js'),
  );
  const definitions = JSON.parse(
    execFileSync(
      process.env.WEBMCP_PYTHON || '/usr/bin/python3',
      ['-c', 'import json; from mcp.server import definitions; print(json.dumps(definitions()))'],
      { cwd: root, encoding: 'utf8' },
    ),
  ).filter((tool) => !['get_agent_guide', 'get_review_image'].includes(tool.name));
  await fs.writeFile(path.join(stage, 'experiment-tools.json'), JSON.stringify(definitions));
  check(
    'Test extension has no nativeMessaging permission',
    !JSON.parse(await fs.readFile(path.join(stage, 'manifest.json'))).permissions.includes(
      'nativeMessaging',
    ),
  );
  server = http.createServer(async (request, response) => {
    const name = new URL(request.url, 'http://localhost').pathname;
    if (
      !['/fixtures/console.html', '/fixtures/console.css', '/fixtures/console.js'].includes(name)
    ) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader(
      'Content-Type',
      { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' }[
        path.extname(name)
      ],
    );
    response.end(await fs.readFile(path.join(root, name)));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const sourceUrl = `http://127.0.0.1:${server.address().port}/fixtures/console.html`;
  // Reproduce the baseline failure without changing browser security flags.
  await fs.copyFile(path.join(root, 'manifest.json'), path.join(stage, 'manifest.json'));
  await openClient(true);
  const baselineId = await install();
  const baselineUrl = `chrome-extension://${baselineId}/editor.html?sample=1`;
  const baselinePage = pageId(await call('new_page', { url: baselineUrl }), baselineUrl);
  const baseline = await evaluate(
    baselinePage,
    `async () => {
    for(let i=0;i<200 && !window.ConsoleCanvasWebMcpExperiment?.error;i++) await new Promise(r=>setTimeout(r,50));
    return {ready:!!window.ConsoleCanvas?.state.ready,status:window.ConsoleCanvasWebMcpExperiment,crossOriginIsolated,originAgentCluster};
  }`,
  );
  report.baseline = baseline;
  check(
    'Unisolated extension reproduces the native document.domain registration rejection',
    baseline.status.error?.includes('document.domain'),
  );
  check('Baseline registration failure does not break normal editor readiness', baseline.ready);
  await client.close();
  client = null;
  await fs.writeFile(path.join(stage, 'manifest.json'), JSON.stringify(extensionManifest, null, 2));
  await openClient(true);
  const official = await client.listTools();
  check(
    'Official MCP exposes native WebMCP discovery and execution',
    ['list_webmcp_tools', 'execute_webmcp_tool'].every((name) =>
      official.tools.some((tool) => tool.name === name),
    ),
  );
  const extensionId = await install();
  report.extensionId = extensionId;
  const sourceId = pageId(await call('new_page', { url: sourceUrl }), sourceUrl);
  const fingerprint =
    '() => ({html: document.documentElement.outerHTML, actions: window.consoleDemoActions})';
  const original = await evaluate(sourceId, fingerprint);
  await call('trigger_extension_action', { id: extensionId });
  let pages;
  for (let i = 0; i < 100; i++) {
    pages = await call('list_pages');
    if (textOf(pages).includes('editor.html?id=')) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const editorId = pageId(pages, `chrome-extension://${extensionId}/editor.html?id=`);
  const readiness = await evaluate(
    editorId,
    `async () => {
    for (let i=0; i<200 && !window.ConsoleCanvasWebMcpExperiment?.ready && !window.ConsoleCanvasWebMcpExperiment?.error; i++) await new Promise(r=>setTimeout(r,50));
    return {status:window.ConsoleCanvasWebMcpExperiment, native:typeof document.modelContext, url:location.href, userAgent:navigator.userAgent, crossOriginIsolated, originAgentCluster, legacyBridgeConnected:!!window.ConsoleCanvas.state.mcpStatus.connected};
  }`,
  );
  report.environment = readiness;
  check(
    'Real extension action captured HTTP console into extension editor',
    readiness.url.startsWith('chrome-extension:') && readiness.url.includes('?id='),
  );
  check(
    'Native document.modelContext registers tools without a polyfill',
    readiness.native === 'object' && readiness.status.ready,
  );
  check(
    'Standard extension COOP/COEP enables cross-origin isolation',
    readiness.crossOriginIsolated === true,
  );
  check('Console Canvas localhost MCP bridge is not connected', !readiness.legacyBridgeConnected);
  const discovered = await call('list_webmcp_tools', { pageId: editorId });
  check(
    'Official MCP discovers all eleven extension-owned editor tools',
    definitions.every((tool) => textOf(discovered).includes('console_canvas_' + tool.name)),
  );
  async function web(name, args = {}, allowFailure = false) {
    const result = await call('execute_webmcp_tool', {
      pageId: editorId,
      toolName: 'console_canvas_' + name,
      input: JSON.stringify(args),
    });
    const envelope = JSON.parse(result.structuredContent?.message || textOf(result));
    assert.ok(!envelope.error, JSON.stringify(envelope));
    const value =
      typeof envelope.output === 'string' ? JSON.parse(envelope.output) : envelope.output;
    if (!allowFailure) assert.equal(value.ok, true, JSON.stringify(value));
    return value;
  }
  const screen = (await web('list_screens')).screens[0];
  const base = { editor_id: screen.editor_id };
  let current = (await web('get_screen', base)).screen;
  check(
    'WebMCP reads captured elements and the original HTTP source identity',
    screen.element_count > 300 && screen.url === sourceUrl,
  );
  const button = (await web('list_elements', { ...base, query: 'new-customer' })).elements.find(
    (element) => element.locator.id === 'new-customer',
  );
  check(
    'Original button selector survives source-free extension capture',
    !!button && button.tag === 'button',
  );
  check('Initial component comments are empty', (await web('list_comments', base)).total === 0);
  const observation = `() => {
    const a=window.ConsoleCanvas, id=${JSON.stringify(button.id)}, el=a.state.scene.elements.get(id), r=el.getBoundingClientRect();
    return {rect:{x:r.x,y:r.y,width:r.width,height:r.height},comments:a.state.scene.annotations,history:document.querySelector('#activity-list').textContent,revision:a.state.revision};
  }`;
  const before = await evaluate(editorId, observation);
  const batch = {
    ...base,
    expected_revision: current.revision,
    operation_id: randomUUID(),
    operations: [
      { type: 'move', element_id: button.id, mode: 'absolute', dx: -80, dy: 32 },
      {
        type: 'comment',
        element_id: button.id,
        text: 'WebMCP 실험: 고객 추가 버튼의 배치와 문구를 검토해 주세요.',
      },
    ],
  };
  const applied = await web('apply_edits', batch);
  current = applied.screen;
  const after = await evaluate(editorId, observation);
  check(
    'Native WebMCP changes actual captured DOM geometry',
    Math.abs(after.rect.x - before.rect.x + 80) < 1 &&
      Math.abs(after.rect.y - before.rect.y - 32) < 1,
  );
  check(
    'Move and comment share one undo step and persisted save',
    current.undo_count === 1 &&
      current.revision === screen.revision + 1 &&
      applied.persisted === true,
  );
  const comments = await web('list_comments', base);
  check(
    'Comment query retains original locator and visible unified history',
    comments.total === 1 &&
      comments.comments[0].locator.id === 'new-customer' &&
      after.history.includes('WebMCP 실험'),
  );
  await call('take_screenshot', {
    pageId: editorId,
    filePath: path.join(output, 'moved-and-commented.png'),
  });
  const replay = await web('apply_edits', {
    operations: batch.operations,
    operation_id: batch.operation_id,
    expected_revision: batch.expected_revision,
    editor_id: batch.editor_id,
  });
  check(
    'Reordered identical operation replay is not applied twice',
    replay.screen.revision === current.revision &&
      (await web('get_screen', base)).screen.undo_count === 1,
  );
  const reused = await web(
    'apply_edits',
    {
      ...batch,
      operations: [{ type: 'move', element_id: button.id, mode: 'absolute', dx: 123, dy: 0 }],
    },
    true,
  );
  check(
    'Reusing an operation id for a different edit is rejected',
    reused.error?.code === 'operation_id_reused',
  );
  const stale = await web('apply_edits', { ...batch, operation_id: randomUUID() }, true);
  check(
    'Stale revision is rejected without changing the document',
    stale.error?.code === 'revision_conflict' &&
      (await web('get_screen', base)).screen.revision === current.revision,
  );
  const wrong = await web('list_comments', { editor_id: 'another-editor' }, true);
  check('Wrong editor targeting is rejected', wrong.error?.code === 'wrong_document');
  current = (
    await web('undo', { ...base, expected_revision: current.revision, operation_id: randomUUID() })
  ).screen;
  const undone = await evaluate(editorId, observation);
  check(
    'WebMCP undo restores DOM position and removes the added comment',
    Math.abs(undone.rect.x - before.rect.x) < 1 &&
      Math.abs(undone.rect.y - before.rect.y) < 1 &&
      (await web('list_comments', base)).total === 0,
  );
  current = (
    await web('redo', { ...base, expected_revision: current.revision, operation_id: randomUUID() })
  ).screen;
  check(
    'WebMCP redo restores the shared move/comment change',
    (await web('list_comments', base)).total === 1,
  );
  async function write(name, args) {
    const value = await web(name, {
      ...base,
      expected_revision: current.revision,
      operation_id: randomUUID(),
      ...args,
    });
    check(name + ' persisted', value.persisted === true);
    current = value.screen;
    return value;
  }
  const a = (await write('create_snapshot', { name: 'A · WebMCP 기준' })).snapshot_id;
  await write('apply_edits', {
    operations: [{ type: 'move', element_id: button.id, mode: 'absolute', dx: -40, dy: 32 }],
  });
  const b = (await write('create_snapshot', { name: 'B · WebMCP 대안' })).snapshot_id;
  await write('apply_edits', {
    operations: [{ type: 'move', element_id: button.id, mode: 'absolute', dx: 0, dy: 32 }],
  });
  const c = (await write('create_snapshot', { name: 'C · WebMCP 미래' })).snapshot_id;
  await write('restore_snapshot', { snapshot_id: a });
  await write('apply_edits', {
    operations: [{ type: 'move', element_id: button.id, mode: 'absolute', dx: -120, dy: 32 }],
  });
  const d = (await write('create_snapshot', { name: 'D · WebMCP 분기' })).snapshot_id;
  const snapshots = (await web('list_snapshots', base)).snapshots;
  const entry = (id) => snapshots.find((snapshot) => snapshot.id === id);
  check(
    'WebMCP preserves real A→B→C and A→D parent branches',
    entry(b).parent_id === a && entry(c).parent_id === b && entry(d).parent_id === a,
  );
  await write('restore_snapshot', { snapshot_id: c });
  check(
    'Future C remains restorable after creating branch D',
    current.active_snapshot_id === c &&
      (await web('list_snapshots', base)).snapshots.some((snapshot) => snapshot.id === d),
  );
  check(
    'Agent edits appear in the common history stream',
    (await web('list_history', { ...base, scope: 'all' })).events.some(
      (event) => event.actor === 'agent',
    ),
  );
  await call('navigate_page', { pageId: editorId, type: 'reload' });
  await evaluate(
    editorId,
    `async () => {for(let i=0;i<200 && !window.ConsoleCanvasWebMcpExperiment?.ready;i++) await new Promise(r=>setTimeout(r,50)); return window.ConsoleCanvasWebMcpExperiment;}`,
  );
  const reopened = (await web('list_screens')).screens[0];
  const saved = await web('list_snapshots', { editor_id: reopened.editor_id });
  check(
    'Editor tab reload preserves comments and all snapshot branches',
    saved.active_snapshot_id === c &&
      saved.snapshots.length === snapshots.length &&
      saved.snapshots.some((snapshot) => snapshot.id === d && snapshot.parent_id === a) &&
      (await web('list_comments', { editor_id: reopened.editor_id })).total === 1,
  );
  const finalOriginal = await evaluate(sourceId, fingerprint);
  check(
    'Original source DOM and business event count are unchanged',
    finalOriginal.html === original.html && finalOriginal.actions === 0,
  );
  report.sourceFingerprint = createHash('sha256').update(original.html).digest('hex');
  await client.close();
  client = null;

  // Negative control: the editor must still work without native WebMCP.
  await openClient(false);
  const controlId = await install();
  const controlUrl = `chrome-extension://${controlId}/editor.html?sample=1`;
  const controlPage = pageId(await call('new_page', { url: controlUrl }), controlUrl);
  const control = await evaluate(
    controlPage,
    `async () => {for(let i=0;i<200 && !window.ConsoleCanvas?.state.ready;i++) await new Promise(r=>setTimeout(r,50));return {ready:!!window.ConsoleCanvas?.state.ready,experiment:window.ConsoleCanvasWebMcpExperiment};}`,
  );
  check(
    'Disabled WebMCP is detected while normal editing remains ready',
    control.ready && control.experiment.unsupported === true,
  );
  check(
    'Disabled native WebMCP exposes no experimental tools',
    !textOf(await call('list_webmcp_tools', { pageId: controlPage })).includes(
      'console_canvas_get_screen',
    ),
  );
  report.passed = report.checks.length;
  report.result = 'pass';
} catch (error) {
  report.result = 'fail';
  report.error = error.stack;
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  await client?.close().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await fs.rm(stage, { recursive: true, force: true });
  console.log(
    `Result: ${report.result}; ${report.checks.length} checks; report: ${path.join(output, 'report.json')}`,
  );
}
