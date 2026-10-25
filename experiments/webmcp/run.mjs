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

const product = process.argv.includes('--product');
const headed = process.argv.includes('--headed');
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
  mode:
    'isolated ' +
    (headed ? 'headed' : 'headless') +
    ' Chrome; no native host or Console Canvas MCP server',
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
      ...(headed ? [] : ['--headless']),
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
  if (product) {
    const archive = path.join(root, 'dist/console-canvas-chrome.zip');
    const descriptor = JSON.parse(await fs.readFile(path.join(root, 'dist/chrome-package.json')));
    report.packageSha256 = createHash('sha256')
      .update(await fs.readFile(archive))
      .digest('hex');
    assert.equal(report.packageSha256, descriptor.sha256);
    execFileSync(process.env.WEBMCP_PYTHON || '/usr/bin/python3', [
      '-c',
      'import zipfile,sys,pathlib; z=zipfile.ZipFile(sys.argv[1]); root=pathlib.Path(sys.argv[2]); [(root.joinpath(*pathlib.PurePosixPath(n).parts[1:]).parent.mkdir(parents=True,exist_ok=True),root.joinpath(*pathlib.PurePosixPath(n).parts[1:]).write_bytes(z.read(n))) for n in z.namelist()]',
      archive,
      stage,
    ]);
  } else {
    const manifest = JSON.parse(
      await fs.readFile(path.join(root, 'runtime-manifest.json'), 'utf8'),
    );
    for (const name of new Set([...manifest.public, 'manifest.json', 'background.js'])) {
      await fs.mkdir(path.dirname(path.join(stage, name)), { recursive: true });
      await fs.copyFile(path.join(root, name), path.join(stage, name));
    }
  }
  let definitions;
  if (!product) {
    const html = await fs.readFile(path.join(stage, 'editor.html'), 'utf8');
    const extensionManifest = JSON.parse(
      await fs.readFile(path.join(stage, 'manifest.json'), 'utf8'),
    );
    extensionManifest.cross_origin_opener_policy = { value: 'same-origin' };
    extensionManifest.cross_origin_embedder_policy = { value: 'require-corp' };
    await fs.writeFile(
      path.join(stage, 'manifest.json'),
      JSON.stringify(extensionManifest, null, 2),
    );
    await fs.writeFile(
      path.join(stage, 'editor.html'),
      html.replace('</body>', '<script type="module" src="webmcp-experiment.js"></script></body>'),
    );
    await fs.copyFile(
      path.join(import.meta.dirname, 'adapter.js'),
      path.join(stage, 'webmcp-experiment.js'),
    );
    definitions = JSON.parse(
      execFileSync(
        process.env.WEBMCP_PYTHON || '/usr/bin/python3',
        ['-c', 'import json; from mcp.server import definitions; print(json.dumps(definitions()))'],
        { cwd: root, encoding: 'utf8' },
      ),
    ).filter((tool) => !['get_agent_guide', 'get_review_image'].includes(tool.name));
    await fs.writeFile(path.join(stage, 'experiment-tools.json'), JSON.stringify(definitions));
  } else {
    definitions = (await import('../../tool-contract.js')).toolContract.tools;
  }
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
  if (!product) {
    // Reproduce the baseline failure without changing browser security flags.
    const baselineManifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json')));
    delete baselineManifest.cross_origin_opener_policy;
    delete baselineManifest.cross_origin_embedder_policy;
    await fs.writeFile(path.join(stage, 'manifest.json'), JSON.stringify(baselineManifest));
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
    await fs.writeFile(
      path.join(stage, 'manifest.json'),
      JSON.stringify({
        ...JSON.parse(await fs.readFile(path.join(root, 'manifest.json'))),
        cross_origin_opener_policy: { value: 'same-origin' },
        cross_origin_embedder_policy: { value: 'require-corp' },
      }),
    );
  }
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
    product
      ? `async () => {for(let i=0;i<200&&!window.ConsoleCanvas?.state.ready;i++)await new Promise(r=>setTimeout(r,50)); document.querySelector('#webmcp-enable').click(); for(let i=0;i<200&&document.querySelector('#webmcp-disable').disabled;i++)await new Promise(r=>setTimeout(r,50));return {native:typeof document.modelContext,status:{ready:!document.querySelector('#webmcp-disable').disabled},url:location.href,crossOriginIsolated,originAgentCluster,userAgent:navigator.userAgent,legacyBridgeConnected:!!window.ConsoleCanvas.state.mcpStatus.connected};}`
      : `async () => {
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
    'Official MCP discovers all ' + definitions.length + ' extension-owned editor tools',
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
    if (!allowFailure) assert.equal(value.ok, true, JSON.stringify(envelope));
    return value;
  }
  const screen = (await web('list_screens')).screens[0];
  let base = { editor_id: screen.editor_id };
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
  if (product) {
    check(
      'Live guide contains current skill instructions',
      (await web('get_agent_guide')).markdown.includes('restore_snapshot'),
    );
    let review;
    for (let i = 0; i < 100; i++) {
      review = await web('get_review_image', base);
      if (!review.pending) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(review.preview_url, JSON.stringify(review));
    const viewer = pageId(await call('new_page', { url: review.preview_url }), 'review-image.html');
    await evaluate(
      viewer,
      `async () => {for(let i=0;i<200&&document.body.dataset.ready!=='true';i++)await new Promise(r=>setTimeout(r,50));return document.body.dataset.ready;}`,
    );
    const screenshot = await call('take_screenshot', { pageId: viewer, fullPage: true });
    const png = screenshot.content.find((item) => item.type === 'image');
    check(
      'Agent receives real image/png content via official MCP',
      png?.mimeType === 'image/png' && !!png.data,
    );
    await fs.writeFile(path.join(output, 'agent-review.png'), Buffer.from(png.data, 'base64'));
    await call('close_page', { pageId: viewer });
  }
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
    product
      ? `async () => {for(let i=0;i<200&&!window.ConsoleCanvas?.state.ready;i++)await new Promise(r=>setTimeout(r,50));document.querySelector('#webmcp-enable').click();for(let i=0;i<200&&document.querySelector('#webmcp-disable').disabled;i++)await new Promise(r=>setTimeout(r,50));return true;}`
      : `async () => {for(let i=0;i<200 && !window.ConsoleCanvasWebMcpExperiment?.ready;i++) await new Promise(r=>setTimeout(r,50)); return window.ConsoleCanvasWebMcpExperiment;}`,
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
  if (product) {
    const oldBase = base;
    base = { editor_id: reopened.editor_id };
    check(
      'Reload rejects commands addressed to the previous editor generation',
      (await web('get_screen', oldBase, true)).error?.code === 'wrong_document',
    );
    current = (await web('get_screen', base)).screen;
    await evaluate(
      editorId,
      `()=>{document.querySelector('#webmcp-disable').click();return true;}`,
    );
    check(
      'Explicit revoke removes all document tools from official discovery',
      !textOf(await call('list_webmcp_tools', { pageId: editorId })).includes('console_canvas_'),
    );
    await evaluate(
      editorId,
      `async()=>{document.querySelector('#webmcp-enable').click();for(let i=0;i<200&&document.querySelector('#webmcp-disable').disabled;i++)await new Promise(r=>setTimeout(r,50));return true;}`,
    );
    const malformed = await web(
      'apply_edits',
      {
        ...base,
        expected_revision: current.revision,
        operation_id: randomUUID(),
        operations: [
          { type: 'move', element_id: button.id, mode: 'relative', dx: 20, dy: 0 },
          { type: 'move', element_id: button.id, mode: 'relative', dx: 900000, dy: 0 },
        ],
      },
      true,
    );
    check(
      'Invalid mixed batch is rejected before any partial edit',
      malformed.error?.code === 'invalid_arguments' &&
        (await web('get_screen', base)).screen.revision === current.revision,
    );
    await evaluate(
      editorId,
      `()=>{document.querySelector('#mcp-dialog').showModal();return true;}`,
    );
    check(
      'Human modal input blocks agent writes',
      (
        await web(
          'undo',
          { ...base, expected_revision: current.revision, operation_id: randomUUID() },
          true,
        )
      ).error?.code === 'editor_busy',
    );
    await evaluate(editorId, `()=>{document.querySelector('#mcp-dialog').close();return true;}`);
    await write('apply_edits', {
      operations: [{ type: 'move', element_id: button.id, mode: 'absolute', dx: 0, dy: 0 }],
    });
    async function reviewImage(args, filename) {
      const stateBefore = JSON.stringify((await web('get_screen', base)).screen);
      let value;
      for (let i = 0; i < 300; i++) {
        value = await web('get_review_image', { ...base, ...args });
        if (!value.pending) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(value.preview_url, JSON.stringify(value));
      const viewer = pageId(
        await call('new_page', { url: value.preview_url }),
        'review-image.html',
      );
      assert.equal(
        await evaluate(
          viewer,
          `async()=>{for(let i=0;i<200&&document.body.dataset.ready!=='true';i++)await new Promise(r=>setTimeout(r,50));return document.body.dataset.ready;}`,
        ),
        'true',
      );
      const dimensions = await evaluate(
        viewer,
        `()=>({width:document.querySelector('img').naturalWidth,height:document.querySelector('img').naturalHeight,source:document.querySelector('img').src})`,
      );
      assert.equal(dimensions.width, value.width);
      assert.equal(dimensions.height, value.height);
      assert.equal(dimensions.source, decodeURIComponent(new URL(value.preview_url).hash.slice(1)));
      const result = await call('take_screenshot', { pageId: viewer, fullPage: true });
      const png = result.content.find((item) => item.type === 'image');
      assert.equal(png?.mimeType, 'image/png');
      await fs.writeFile(path.join(output, filename), Buffer.from(png.data, 'base64'));
      await call('close_page', { pageId: viewer });
      check(
        filename + ' is native image content and does not mutate editor state',
        stateBefore === JSON.stringify((await web('get_screen', base)).screen),
      );
      return value;
    }
    check(
      'Comment-only request produces an agent image',
      (await reviewImage({}, 'agent-comments-only.png')).request_count === 1,
    );
    const buttons = (await web('list_elements', { ...base, limit: 200 })).elements
      .filter((n) => n.tag === 'button' && !n.deleted && n.id !== button.id)
      .slice(0, 9);
    assert.equal(buttons.length, 9);
    await write('apply_edits', {
      operations: [
        ...buttons.map((n, i) => ({
          type: 'comment',
          element_id: n.id,
          text: '요청 ' + (i + 2) + ': 반응형 배치와 접근성을 검토해 주세요.',
        })),
        { type: 'delete', element_id: buttons.at(-1).id },
      ],
    });
    const ten = (await write('create_snapshot', { name: '10개 요청 · 삭제 전 참고' })).snapshot_id;
    check(
      'Ten-request image includes deleted reference and ten cards',
      (await reviewImage({}, 'agent-ten-requests.png')).request_count === 10,
    );
    await write('apply_edits', {
      operations: [{ type: 'comment', element_id: button.id, text: '현재 작업만 변경' }],
    });
    check(
      'Saved version image retains all ten saved requests',
      (await reviewImage({ snapshot_id: ten }, 'agent-saved-version.png')).request_count === 10,
    );
    await evaluate(
      editorId,
      `()=>{window.__originalTransaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,mode,...rest){if(mode==='readwrite')throw new DOMException('QA quota','QuotaExceededError');return window.__originalTransaction.call(this,stores,mode,...rest)};return true;}`,
    );
    const unsaved = await web('apply_edits', {
      ...base,
      expected_revision: current.revision,
      operation_id: randomUUID(),
      operations: [{ type: 'comment', element_id: button.id, text: '저장 실패 중 초안' }],
    });
    current = unsaved.screen;
    check(
      'Official WebMCP distinguishes applied edits from failed persistence',
      unsaved.ok && unsaved.persisted === false && !!unsaved.save_error,
    );
    const protectedState = JSON.stringify(current);
    const failedRestore = await web(
      'restore_snapshot',
      { ...base, expected_revision: current.revision, operation_id: randomUUID(), snapshot_id: c },
      true,
    );
    check(
      'Failed snapshot save rolls back current version and revision',
      failedRestore.error?.code === 'snapshot_error' &&
        JSON.stringify((await web('get_screen', base)).screen) === protectedState,
    );
    await evaluate(
      editorId,
      `async()=>{IDBDatabase.prototype.transaction=window.__originalTransaction;await window.ConsoleCanvas.state.saving;return true;}`,
    );
    await evaluate(
      editorId,
      `async()=>{await window.ConsoleCanvas.closeDocument(window.ConsoleCanvas.state.snapshot.id);return true;}`,
    );
    check(
      'Closing document automatically revokes its tool scope',
      !textOf(await call('list_webmcp_tools', { pageId: editorId })).includes('console_canvas_'),
    );
    await evaluate(
      editorId,
      `async()=>{document.querySelector('#webmcp-enable').click();for(let i=0;i<200&&document.querySelector('#webmcp-disable').disabled;i++)await new Promise(r=>setTimeout(r,50));return true;}`,
    );
    const guide = await web('get_agent_guide');
    check(
      'Guide is available before capture with matching bundle version and no screens',
      guide.version === report.sourceVersion &&
        guide.contract_version === 1 &&
        (await web('list_screens')).screens.length === 0,
    );
  }
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
    product
      ? `async () => {for(let i=0;i<200&&!window.ConsoleCanvas?.state.ready;i++)await new Promise(r=>setTimeout(r,50));document.querySelector('#webmcp-enable').click();await new Promise(r=>setTimeout(r,100));return {ready:!!window.ConsoleCanvas?.state.ready,experiment:{unsupported:document.querySelector('#webmcp-status').textContent.includes('오류')}};}`
      : `async () => {for(let i=0;i<200 && !window.ConsoleCanvas?.state.ready;i++) await new Promise(r=>setTimeout(r,50));return {ready:!!window.ConsoleCanvas?.state.ready,experiment:window.ConsoleCanvasWebMcpExperiment};}`,
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
  if (product)
    await fs.writeFile(
      path.join(output, headed ? 'product-headed-report.json' : 'product-headless-report.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  console.log(
    `Result: ${report.result}; ${report.checks.length} checks; report: ${path.join(output, 'report.json')}`,
  );
}
