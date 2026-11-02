import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { launchChrome } from '../tests/helpers/chrome-pipe.mjs';

const root = path.resolve(import.meta.dirname, '..'),
  output = path.resolve(
    process.env.EXTENSION_PRODUCT_OUTPUT || path.join(root, 'local/extension-product'),
  );
const mcpRoot =
  process.env.WEBMCP_MCP_ROOT ||
  path.join(root, 'local/webmcp-experiment/node_modules/chrome-devtools-mcp');
await fs.mkdir(output, { recursive: true });
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'page-canvas-extension-product-'));
const extension = path.join(temp, 'extension'),
  profile = path.join(temp, 'profile');
await fs.cp(path.join(root, 'dist/page-canvas-chrome'), extension, { recursive: true });
const fixtures = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost'),
    file = path.resolve(root, '.' + url.pathname);
  if (!url.pathname.startsWith('/fixtures/') || !file.startsWith(root + path.sep))
    return res.writeHead(404).end();
  try {
    res.setHeader(
      'Content-Type',
      {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'text/javascript',
        '.svg': 'image/svg+xml',
        '.jpg': 'image/jpeg',
      }[path.extname(file)] || 'application/octet-stream',
    );
    res.end(await fs.readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => fixtures.listen(0, '127.0.0.1', r));
let chrome = launchChrome(profile, {
  headed: true,
  args: ['--remote-debugging-port=0', '--enable-features=WebMCP'],
  logFile: path.join(output, 'chrome.log'),
});
let client, transport;
const report = { checks: [], actions: [], calls: [], product: true };
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
  report.extensionId = id;
  async function connectAgent() {
    let port;
    for (let i = 0; i < 200; i++) {
      try {
        port = Number(
          (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0],
        );
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    client = new Client({ name: 'page-canvas-product-qa', version: '0.1.0' });
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        path.join(mcpRoot, 'build/src/bin/chrome-devtools-mcp.js'),
        '--browser-url=http://127.0.0.1:' + port,
        '--categoryExperimentalWebmcp',
        '--categoryExtensions',
        '--experimentalIncludeAllPages',
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
    transport.stderr.on(
      'data',
      (data) => void fs.appendFile(path.join(output, 'server.log'), data),
    );
    await client.connect(transport);
  }
  await connectAgent();
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
    report.calls.push({ name, isError: !!r.isError });
    if (r.isError) throw Error(name + ': ' + textOf(r));
    return r;
  };
  const pages = async () => textOf(await call('list_pages'));
  const pageId = (text, url) => {
    const line = text.split('\n').find((s) => /^\d+:/.test(s) && s.includes(url));
    return line ? Number(line.match(/^\d+/)[0]) : null;
  };
  const until = async (read, label, timeout = 120000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const r = await read();
      if (r !== null && r !== false && r !== undefined) return r;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error(label);
  };
  const observe = async (pageId, fn) => {
    const r = await call('evaluate_script', { pageId, function: fn, waitForStableDom: false });
    return JSON.parse(textOf(r).match(/```json\s*([\s\S]*?)\s*```/)[1]);
  };
  const uid = async (pageId, role, label) => {
    const snapshot = textOf(await call('take_snapshot', { pageId }));
    const line = snapshot
      .split('\n')
      .find((line) => line.includes(role + ' "' + label + '"') && line.includes('uid='));
    if (!line) {
      await fs.writeFile(path.join(output, 'missing-ui.txt'), snapshot);
      throw Error('UI element missing: ' + role + ' ' + label);
    }
    return line.match(/uid=([^\s]+)/)[1];
  };
  const click = async (pageId, label) => {
    const target = await uid(pageId, 'button', label);
    await call('click', { pageId, uid: target });
    report.actions.push({ kind: 'click', label });
  };
  const fill = async (pageId, role, label, value) => {
    const target = await uid(pageId, role, label);
    await call('fill', { pageId, uid: target, value });
    report.actions.push({ kind: 'input', label });
  };
  const sourceUrl = 'http://127.0.0.1:' + fixtures.address().port + '/fixtures/console.html';
  let source = pageId(textOf(await call('new_page', { url: sourceUrl })), sourceUrl);
  await call('trigger_extension_action', { id });
  report.actions.push({ kind: 'menu', label: 'Chrome 확장 열기' });
  const popup = await until(
    async () => pageId(await pages(), '/popup.html'),
    'Extension popup did not appear',
    15000,
  );
  await until(
    () =>
      observe(
        popup,
        '()=>document.querySelector("#project-name")&&!document.querySelector("#new-project").hidden',
      ),
    'Project creation ready',
  );
  await call('take_screenshot', {
    pageId: popup,
    filePath: path.join(output, '01-first-import.png'),
  });
  await fill(popup, 'textbox', '새 프로젝트 이름', '제품 검증');
  await click(popup, '현재 화면 가져오기');
  let editor = await until(
    async () => pageId(await pages(), 'chrome-extension://' + id + '/editor.html'),
    'Capture editor did not open',
  );
  await until(
    () => observe(editor, '()=>!!window.ConsoleCanvas?.state.ready'),
    'Editor initialized',
  );
  let state = await observe(
    editor,
    '()=>({id:window.ConsoleCanvas.state.snapshot.id,project:window.ConsoleCanvas.state.project_id,elements:window.ConsoleCanvas.state.snapshot.nodes.length,source:window.ConsoleCanvas.state.snapshot.source})',
  );
  check(
    'Popup creates project and real captured ticket without app/server',
    state.elements > 300 && state.source.url === sourceUrl && !!state.source.extension,
  );
  check(
    'Extension shell has no local server form or duplicated website editor tabs',
    await observe(
      editor,
      '()=>!document.querySelector("#mcp-address")&&!document.querySelector("#web-editor")&&document.querySelector("#web-source").textContent.includes("원본으로")',
    ),
  );
  await click(editor, '에이전트 연결');
  await click(editor, '도구 연결');
  await call('list_webmcp_tools', { pageId: editor });
  const web = async (name, args = {}, allowFailure = false) => {
    const r = await call('execute_webmcp_tool', {
      pageId: editor,
      toolName: 'page_canvas_' + name,
      input: JSON.stringify(args),
    });
    const envelope = JSON.parse(r.structuredContent?.message || textOf(r));
    if (envelope.error) throw Error(envelope.error);
    const value =
      typeof envelope.output === 'string' ? JSON.parse(envelope.output) : envelope.output;
    if (!allowFailure) assert.equal(value.ok, true, JSON.stringify(value));
    return value;
  };
  const projects = await web('list_projects'),
    base = { workspace_id: projects.workspace_id, project_id: state.project, ticket_ref: state.id };
  const guide = await web('get_agent_guide');
  const liveScreens = await web('list_screens');
  check(
    'Live workspace discovery is scoped to the extension',
    liveScreens.workspace_id === base.workspace_id && liveScreens.screens.length === 1,
  );
  check(
    'Live skill describes both independent execution modes',
    guide.capabilities.transport === 'webmcp' && guide.markdown.includes('Chrome 확장'),
  );
  const repository = path.join(temp, 'project-repository');
  await fs.mkdir(repository);
  execFileSync('git', ['init', '--quiet', repository]);
  const gitRoot = execFileSync('git', ['-C', repository, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
  const common = execFileSync(
    'git',
    ['-C', repository, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    { encoding: 'utf8' },
  ).trim();
  const context = { root: gitRoot, common_dir: common, method: 'git_rev_parse' };
  const bound = await web('connect_repository', {
    workspace_id: base.workspace_id,
    project_id: base.project_id,
    repository_path: gitRoot,
    repository_context: context,
    expected_project_revision: projects.projects[0].revision,
    operation_id: randomUUID(),
  });
  check(
    'Repository connection labels verification as performed by the local agent',
    bound.project.repository.verification.by === 'local_agent' &&
      !bound.project.repository.verification.browser_filesystem_verified,
  );
  const resolved = await web('resolve_project', {
    workspace_id: base.workspace_id,
    repository_path: gitRoot,
    repository_context: context,
  });
  check(
    'A new request resolves the same Git project without app selection',
    resolved.project.id === base.project_id,
  );
  const wrong = await web('get_screen', { ...base, workspace_id: randomUUID() }, true);
  check(
    'Another workspace ID cannot access a matching ticket ID',
    wrong.error?.code === 'wrong_workspace',
  );
  const elements = await web('list_elements', { ...base, query: 'new-customer' }),
    button = elements.elements.find((e) => e.locator.id === 'new-customer');
  check('Captured editable button identity is exposed', !!button);
  const current = await web('get_screen', base);
  const editArguments = {
    ...base,
    expected_edit_revision: current.screen.revision,
    operation_id: randomUUID(),
    operations: [
      { type: 'move', element_id: button.id, mode: 'relative', dx: 20, dy: 10 },
      { type: 'comment', element_id: button.id, text: '등록 버튼의 위치와 간격을 정리해 주세요.' },
    ],
  };
  const change = await web('apply_edits', editArguments);
  check('Shared editor changes and annotations persist', change.persisted);
  await click(editor, '확정');
  await until(
    () => observe(editor, '()=>!!window.ConsoleCanvas.state.ticket?.goal'),
    'Confirmation saved',
  );
  const ticket = await web('get_ticket', base);
  check(
    'Confirmed goal and current image are returned',
    !!ticket.ticket.goal && ticket.images.length >= 2,
  );
  await call('take_screenshot', { pageId: editor, filePath: path.join(output, '02-editor.png') });
  await click(editor, '티켓 목록');
  await call('take_screenshot', { pageId: editor, filePath: path.join(output, '03-tickets.png') });
  await click(editor, '티켓 목록 닫기');
  await click(editor, '원본으로');
  await call('select_page', { pageId: source, bringToFront: true });
  await call('trigger_extension_action', { id });
  report.actions.push({ kind: 'menu', label: 'Chrome 확장 열기' });
  const repeat = await until(
    async () => pageId(await pages(), '/popup.html'),
    'Repeat popup opened',
    15000,
  );
  await until(
    () => observe(repeat, '()=>document.querySelector("#project").value!=="new"'),
    'Remembered project',
  );
  await click(repeat, '현재 화면 가져오기');
  const first = state.id;
  await until(
    () =>
      observe(
        editor,
        `()=>window.ConsoleCanvas?.state.snapshot?.id!==${JSON.stringify(first)}&&!!window.ConsoleCanvas?.state.ready`,
      ),
    'Second ticket reused editor',
  );
  check(
    'Repeated import reuses one editor and keeps the selected project',
    (await pages()).split('\n').filter((line) => line.includes('/editor.html')).length === 1,
  );
  const listing = await web('list_tickets', {
    workspace_id: base.workspace_id,
    project_id: base.project_id,
  });
  check('Agent reads both saved tickets including a closed first ticket', listing.total === 2);
  const activeBefore = await observe(editor, '()=>window.ConsoleCanvas.state.snapshot.id');
  const closed = await web('get_screen', base);
  const comments = await web('list_comments', base);
  check(
    'Closed-ticket reads preserve annotations without changing the visible ticket',
    closed.screen.document_id === first &&
      comments.comments.length === 1 &&
      (await observe(editor, '()=>window.ConsoleCanvas.state.snapshot.id')) === activeBefore,
  );
  await call('navigate_page', { pageId: editor, type: 'reload' });
  await until(
    () => observe(editor, '()=>!!window.ConsoleCanvas?.state.ready'),
    'Reload restored ticket',
  );
  await until(
    async () =>
      textOf(await call('list_webmcp_tools', { pageId: editor })).includes(
        'page_canvas_list_tickets',
      ),
    'WebMCP publication restored after reload',
  );
  const restored = await web('list_projects');
  check(
    'Reload keeps workspace ID and repository connection',
    restored.workspace_id === base.workspace_id &&
      restored.projects[0].repository.identity === bound.project.repository.identity,
  );

  await click(editor, '원본으로');
  await call('select_page', { pageId: source, bringToFront: true });
  await call('trigger_extension_action', { id });
  report.actions.push({ kind: 'menu', label: 'Chrome 확장 열기·영역' });
  const regionPopup = await until(
    async () => pageId(await pages(), '/popup.html'),
    'Region popup opened',
    15000,
  );
  await fill(regionPopup, 'combobox', '가져오기 범위', '영역 선택');
  await click(regionPopup, '영역 선택');
  const region = await until(
    async () => pageId(await pages(), '/region.html'),
    'Region selector opened',
    15000,
  );
  await until(
    () => observe(region, '()=>document.querySelector("#preview").naturalWidth>0'),
    'Region preview loaded',
  );
  const area = await observe(
    region,
    '()=>{const r=document.querySelector("#surface").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}',
  );
  const regionTarget = (await chrome.send('Target.getTargets')).targetInfos.find((t) =>
    t.url.includes('chrome-extension://' + id + '/region.html'),
  );
  const attached = await chrome.send('Target.attachToTarget', {
    targetId: regionTarget.targetId,
    flatten: true,
  });
  const input = (type, x, y, extra = {}) =>
    chrome.send('Input.dispatchMouseEvent', { type, x, y, ...extra }, attached.sessionId);
  await input('mouseMoved', area.x + 100, area.y + 100);
  await input('mousePressed', area.x + 100, area.y + 100, { button: 'left', clickCount: 1 });
  await input('mouseMoved', area.x + 500, area.y + 300, { buttons: 1 });
  await input('mouseReleased', area.x + 500, area.y + 300, { button: 'left', clickCount: 1 });
  report.actions.push({ kind: 'drag', label: '영역 지정' });
  await click(region, '선택 영역 가져오기');
  const second = activeBefore;
  await until(
    () =>
      observe(
        editor,
        `()=>window.ConsoleCanvas?.state.snapshot?.id!==${JSON.stringify(second)}&&!!window.ConsoleCanvas?.state.ready`,
      ),
    'Region capture opened',
  );
  const regionState = await observe(
    editor,
    '()=>({scope:window.ConsoleCanvas.state.snapshot.captureScope,source:window.ConsoleCanvas.state.snapshot.source})',
  );
  check(
    'Region selector captures the chosen rectangle without changing original DOM',
    regionState.scope.mode === 'region' &&
      regionState.scope.rect.width > 300 &&
      regionState.source.extension.document_id,
  );
  await call('take_screenshot', {
    pageId: editor,
    filePath: path.join(output, '05-region-editor.png'),
  });
  await click(editor, '원본으로');
  await call('select_page', { pageId: source, bringToFront: true });
  await call('trigger_extension_action', { id });
  report.actions.push({ kind: 'menu', label: 'Chrome 확장 열기·전체' });
  const fullPopup = await until(
    async () => pageId(await pages(), '/popup.html'),
    'Full page popup opened',
    15000,
  );
  const regionId = await observe(editor, '()=>window.ConsoleCanvas.state.snapshot.id');
  await fill(fullPopup, 'combobox', '가져오기 범위', '전체 페이지');
  await click(fullPopup, '전체 페이지 가져오기');
  await until(
    () =>
      observe(
        editor,
        `()=>window.ConsoleCanvas?.state.snapshot?.id!==${JSON.stringify(regionId)}&&!!window.ConsoleCanvas?.state.ready`,
      ),
    'Document capture opened',
  );
  check(
    'Full-page mode is distinct from current viewport',
    await observe(editor, '()=>window.ConsoleCanvas.state.snapshot.captureScope.mode==="document"'),
  );
  await click(editor, '원본으로');
  await call('select_page', { pageId: source, bringToFront: true });
  await call('trigger_extension_action', { id });
  report.actions.push({ kind: 'menu', label: 'Chrome 확장 열기·취소 검증' });
  const cancelPopup = await until(
    async () => pageId(await pages(), '/popup.html'),
    'Cancellation popup opened',
  );
  await click(cancelPopup, '현재 화면 가져오기');
  await click(cancelPopup, '가져오기 취소');
  await until(
    () =>
      observe(cancelPopup, '()=>document.querySelector("#status").textContent.includes("취소")'),
    'Cancellation recorded',
  );
  const cancelled = await web('list_tickets', {
    workspace_id: base.workspace_id,
    project_id: base.project_id,
  });
  check('Cancelling a running capture leaves no empty or duplicate ticket', cancelled.total === 4);
  await click(cancelPopup, '편집기 열기');
  report.headerGeometry = await observe(
    editor,
    '()=>({width:innerWidth,items:[...document.querySelectorAll(".app-header > *, .app-header button, .app-header select")].map(e=>({tag:e.id||e.className,right:e.getBoundingClientRect().right,left:e.getBoundingClientRect().left}))})',
  );
  check(
    'Header controls stay inside the browser width',
    report.headerGeometry.items.every((item) => item.right <= report.headerGeometry.width + 1),
  );
  await call('resize_page', { pageId: editor, width: 1000, height: 800 });
  report.narrowHeader = await observe(
    editor,
    '()=>({width:innerWidth,items:[...document.querySelectorAll(".app-header > *, .app-header button, .app-header select")].map(e=>({tag:e.id||e.className,right:e.getBoundingClientRect().right,left:e.getBoundingClientRect().left}))})',
  );
  check(
    'Narrow header keeps all controls reachable',
    report.narrowHeader.items.every((item) => item.right <= report.narrowHeader.width + 1),
  );
  await call('take_screenshot', {
    pageId: editor,
    filePath: path.join(output, '04-narrow-editor.png'),
  });
  const history = await web('list_history', base),
    contextImages = await web('get_design_context', base),
    reviewImage = await web('get_review_image', base);
  check(
    'History, design context and image tools share the persisted ticket',
    history.ok && contextImages.images.length > 0 && !!reviewImage.image.preview_url,
  );
  const undoState = await web('get_screen', base);
  const undone = await web('undo', {
    ...base,
    expected_edit_revision: undoState.screen.revision,
    operation_id: randomUUID(),
  });
  const redone = await web('redo', {
    ...base,
    expected_edit_revision: undone.screen.revision,
    operation_id: randomUUID(),
  });
  check(
    'Undo and redo persist through the same WebMCP contract',
    undone.persisted && redone.persisted,
  );
  const latestGoal = await web('get_ticket', base);
  const confirmedAgain = await web('confirm_ticket_goal', {
    ...base,
    expected_ticket_revision: latestGoal.ticket.revision,
    expected_edit_revision: latestGoal.ticket.workspace.edit_revision,
    operation_id: randomUUID(),
    request: '가상 프로젝트 등록 버튼 개선',
    selection_confirmed: true,
  });
  const plan = await web('prepare_implementation', {
    workspace_id: base.workspace_id,
    project_id: base.project_id,
    instruction: '가상 QA 티켓들을 구현해',
    operation_id: randomUUID(),
  });
  check(
    'Explicit bulk instruction freezes the confirmed goal',
    plan.manifest.tickets.some(
      (t) => t.id === base.ticket_ref && t.goal_id === confirmedAgain.ticket.goal.id,
    ),
  );
  const claim = {
    ...base,
    goal_id: confirmedAgain.ticket.goal.id,
    expected_ticket_revision: confirmedAgain.ticket.revision,
    operation_id: randomUUID(),
    claim_token: 'webmcp-product-qa',
    status: 'working',
    summary: '격리 QA 착수',
  };
  const denied = await web('update_ticket', claim, true);
  check(
    'Read and confirmation do not authorize implementation',
    denied.error.code === 'instruction_required',
  );
  const started = await web('update_ticket', {
    ...claim,
    operation_id: randomUUID(),
    implementation_instruction: '가상 QA 구현',
  });
  const other = await web(
    'update_ticket',
    {
      ...claim,
      operation_id: randomUUID(),
      claim_token: 'second-agent',
      implementation_instruction: '가상 QA 구현',
    },
    true,
  );
  check('A second claim cannot take the same goal', started.ok && !other.ok);
  const latestReview = await web('get_ticket', base);
  const inReview = await web('update_ticket', {
    ...base,
    goal_id: latestReview.ticket.goal.id,
    expected_ticket_revision: latestReview.ticket.revision,
    operation_id: randomUUID(),
    claim_token: 'webmcp-product-qa',
    status: 'review',
    summary: '가상 QA 결과',
    checks: '격리 샘플 비교',
    implementation_image_data_url:
      'data:image/png;base64,' +
      (await fs.readFile(path.join(output, '02-editor.png'))).toString('base64'),
  });
  const noApproval = await web(
    'update_ticket',
    {
      ...base,
      goal_id: inReview.ticket.goal.id,
      expected_ticket_revision: inReview.ticket.revision,
      operation_id: randomUUID(),
      claim_token: 'webmcp-product-qa',
      status: 'done',
      summary: '검사만 완료',
    },
    true,
  );
  check(
    'Implementation evidence does not bypass real human approval',
    noApproval.error.code === 'approval_required',
  );
  const beforeUpdate = await web('get_ticket', base);
  const editorTarget = (await chrome.send('Target.getTargets')).targetInfos.find((t) =>
    t.url.includes('/editor.html'),
  );
  const editorSession = (
    await chrome.send('Target.attachToTarget', { targetId: editorTarget.targetId, flatten: true })
  ).sessionId;
  const expectedJob = await observe(
    editor,
    'async()=>(await chrome.runtime.sendMessage({action:"state"})).job',
  );
  await chrome.send('ServiceWorker.enable', {}, editorSession);
  await chrome.send('ServiceWorker.stopAllWorkers', {}, editorSession);
  const workerState = await observe(
    editor,
    'async()=>await chrome.runtime.sendMessage({action:"state"})',
  );
  check(
    'Service-worker restart keeps the project and latest durable capture outcome',
    workerState.ok &&
      workerState.projects.length === 1 &&
      workerState.job.stage === expectedJob.stage &&
      workerState.job.id === expectedJob.id,
  );
  const packagedManifest = JSON.parse(
    await fs.readFile(path.join(extension, 'manifest.json'), 'utf8'),
  );
  // Test-only subsequent version, same stable key/path and production payload.
  await fs.writeFile(
    path.join(extension, 'manifest.json'),
    JSON.stringify({ ...packagedManifest, version: '0.57.1' }),
  );
  await chrome.send('ServiceWorker.disable', {}, editorSession);
  await client.close();
  await transport.close();
  client = null;
  transport = null;
  await chrome.stop();
  await fs.rm(path.join(profile, 'DevToolsActivePort'), { force: true });
  chrome = launchChrome(profile, {
    headed: true,
    args: ['--remote-debugging-port=0', '--enable-features=WebMCP'],
    logFile: path.join(output, 'chrome-restarted.log'),
  });
  await chrome.send('Browser.getVersion');
  await chrome.send('Extensions.loadUnpacked', { path: extension });
  await connectAgent();
  async function openReloadedWorkspace() {
    const target = await until(
      async () =>
        (await chrome.send('Target.getTargets')).targetInfos.find(
          (t) => t.url === 'chrome-extension://' + id + '/background.js',
        ),
      'Reloaded worker ready',
    );
    const session = (
      await chrome.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
    ).sessionId;
    // Harness bootstrap only: Chrome's temporary CDP extension registration invalidates MCP popup handles on reload.
    await chrome.send(
      'Runtime.evaluate',
      {
        expression:
          'chrome.tabs.create({url:chrome.runtime.getURL("editor.html")+"?id=' + first + '"})',
        awaitPromise: true,
        returnByValue: true,
      },
      session,
    );
  }
  await openReloadedWorkspace();
  await until(async () => {
    const p = pageId(await pages(), 'chrome-extension://' + id + '/editor.html');
    if (p) editor = p;
    return (
      p &&
      (await observe(
        p,
        '()=>!!window.ConsoleCanvas?.state.ready&&chrome.runtime.getManifest().version==="0.57.1"',
      ).catch(() => false))
    );
  }, 'Extension reload ready');
  await until(
    async () =>
      textOf(await call('list_webmcp_tools', { pageId: editor })).includes(
        'page_canvas_get_ticket',
      ),
    'Updated WebMCP tools ready',
  );
  const afterUpdate = await web('get_ticket', base);
  check(
    'Same-ID version update keeps annotations, goal and ticket workspace',
    JSON.stringify(afterUpdate.ticket.workspace) ===
      JSON.stringify(beforeUpdate.ticket.workspace) &&
      afterUpdate.ticket.goal.id === beforeUpdate.ticket.goal.id,
  );
  const replayed = await web('apply_edits', editArguments);
  check(
    'Persisted operation receipt prevents edit replay after extension update',
    replayed.persisted && replayed.screen.revision === change.screen.revision,
  );
  const restartedProjects = await web('list_projects');
  check(
    'Browser restart keeps workspace and repository connection',
    restartedProjects.workspace_id === base.workspace_id &&
      restartedProjects.projects[0].repository.identity === bound.project.repository.identity,
  );
  report.updateMethod = 'same profile, same key/path, normal browser restart, CDP reload bootstrap';
  report.manualExtensionRefreshVerified = false;
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
  await new Promise((r) => fixtures.close(r));
  await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
console.log(
  JSON.stringify({
    ok: report.ok,
    checks: report.checks.length,
    actions: report.actions.length,
    output,
  }),
);
if (!report.ok) process.exitCode = 1;
