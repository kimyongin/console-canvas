const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session,
  Menu,
  dialog,
  clipboard,
  shell,
} = require('electron');
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  { execFile } = require('node:child_process'),
  { promisify } = require('node:util');
const run = promisify(execFile),
  ROOT = path.resolve(__dirname, '..');
const { createUpdater } = require('./updater.cjs');
const { createEditorLifecycle } = require('./lifecycle.cjs');
const { secureWebsite, trustFrame } = require('./security.cjs');
let win,
  source,
  editor,
  connection,
  current = 'source',
  busy = false,
  editorReady = false,
  pendingCapture = null;
const { createSkillService } = require('./skills.cjs');
const { registerShellIpc } = require('./ipc.cjs');
const { captureWebsite } = require('./capture.cjs');
const { HEADER_HEIGHT } = require('./layout.cjs');
const bridgePort = process.env.CONSOLE_CANVAS_PORT || '8849';
// Explicit developer/QA isolation; the default user profile is unchanged.
if (process.env.CONSOLE_CANVAS_USER_DATA_DIR) {
  const qaProfile = path.resolve(process.env.CONSOLE_CANVAS_USER_DATA_DIR);
  fs.mkdirSync(qaProfile, { recursive: true });
  app.setPath('userData', qaProfile);
}
app.setName('Console Canvas');
const stateDir =
  process.env.CONSOLE_CANVAS_STATE_DIR ||
  path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'console-canvas');
const python =
  process.env.CONSOLE_CANVAS_PYTHON ||
  (process.platform === 'darwin' ? '/usr/bin/python3' : 'python3');
const appVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const bundledSkill = fs.existsSync(path.join(ROOT, '..', 'console-canvas-skill.zip'))
  ? path.join(ROOT, '..', 'console-canvas-skill.zip')
  : path.join(ROOT, 'dist', 'console-canvas-skill.zip');
function state(message) {
  return {
    url: source?.webContents.getURL() || '',
    view: current,
    header_height: HEADER_HEIGHT[current],
    busy,
    can_go_back: !!source?.webContents.navigationHistory.canGoBack(),
    can_go_forward: !!source?.webContents.navigationHistory.canGoForward(),
    message: message || '',
    demo_url: connection.url + '/fixtures/console.html',
  };
}
function notify(message) {
  if (win && !win.isDestroyed()) win.webContents.send('canvas:state', state(message));
}
function layout() {
  if (!win) return;
  const [width, height] = win.getContentSize();
  for (const [view, top] of [
    [source, HEADER_HEIGHT.source],
    [editor, HEADER_HEIGHT.editor],
  ])
    view?.setBounds({ x: 0, y: top, width, height: Math.max(1, height - top) });
}
function show(which) {
  if (!['source', 'editor', 'tickets', 'settings', 'agent', 'update', 'capture'].includes(which))
    throw new Error('알 수 없는 화면');
  current = which;
  source.setVisible(which === 'source' && !!source.webContents.getURL());
  editor.setVisible(which === 'editor' || which === 'tickets');
  layout();
  notify(
    which === 'settings'
      ? '에이전트 연결·스킬 설치와 앱 업데이트를 관리합니다.'
      : which === 'agent'
        ? '앱에 포함된 스킬과 MCP 연결 정보를 준비하세요.'
        : which === 'update'
          ? 'GitHub Releases에서 앱의 새 버전을 가져옵니다.'
          : undefined,
  );
}
function trusted(event, kind) {
  trustFrame(event, kind === 'editor' ? editor?.webContents : win?.webContents);
}
let workspaceState = null;
async function requestEditor(command) {
  if (!editorReady) throw Error('작업 공간을 준비하고 있습니다. 잠시 후 다시 시도해 주세요.');
  const id = require('node:crypto').randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(Error('작업 공간 응답이 없습니다. 다시 시도해 주세요.'));
    }, 30000);
    function cleanup() {
      clearTimeout(timer);
      ipcMain.removeListener('canvas:workspace-result', reply);
    }
    function reply(event, receipt, result) {
      try {
        trusted(event, 'editor');
      } catch {
        return;
      }
      if (receipt !== id) return;
      cleanup();
      result?.ok ? resolve(result.value) : reject(Error(result?.message || '작업 공간 요청 실패'));
    }
    ipcMain.on('canvas:workspace-result', reply);
    editor.webContents.send('canvas:workspace-command', id, command);
  });
}
async function deliverCapture(snapshot) {
  if (!editorReady) throw Error('작업 공간을 준비하고 있습니다.');
  const receipt = require('node:crypto').randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(Error('가져온 화면의 저장 응답이 없습니다.'));
    }, 60000);
    function cleanup() {
      clearTimeout(timer);
      ipcMain.removeListener('canvas:snapshot-result', saved);
    }
    function saved(event, id, result) {
      try {
        trusted(event, 'editor');
      } catch {
        return;
      }
      if (id !== receipt) return;
      cleanup();
      result?.ok ? resolve() : reject(Error(result?.message || '화면을 저장하지 못했습니다.'));
    }
    ipcMain.on('canvas:snapshot-result', saved);
    editor.webContents.send('canvas:snapshot', snapshot, null, receipt);
  });
}
async function start() {
  // Expose WebContentsView controls to native assistive technology on first launch.
  app.setAccessibilitySupportEnabled(true);
  const skills = createSkillService({
    root: ROOT,
    archive: bundledSkill,
    version: appVersion,
    python,
    stateDir,
    port: bridgePort,
    userData: app.getPath('userData'),
    run,
  });
  const skillSync = await skills.syncInstalled();
  await run(
    python,
    [
      path.join(ROOT, 'mcp/server.py'),
      '--state-dir',
      stateDir,
      '--app-dir',
      ROOT,
      '--port',
      bridgePort,
      '--start',
    ],
    { timeout: 15000 },
  );
  connection = JSON.parse(fs.readFileSync(path.join(stateDir, 'connection.json'), 'utf8'));
  const browsing = session.fromPartition('persist:console-canvas-websites');
  browsing.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  browsing.setPermissionCheckHandler(() => false);
  win = new BrowserWindow({
    width: 1440,
    height: 1000,
    minWidth: 1000,
    minHeight: 720,
    title: 'Console Canvas',
    backgroundColor: '#f5f6fb',
    webPreferences: {
      preload: path.join(__dirname, 'shell-preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  source = new WebContentsView({
    webPreferences: {
      session: browsing,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  editor = new WebContentsView({
    webPreferences: {
      partition: 'persist:console-canvas-editor',
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.contentView.addChildView(source);
  win.contentView.addChildView(editor);
  editor.setVisible(false);
  layout();
  secureWebsite(
    source.webContents,
    () => win,
    () => source.webContents.session,
  );
  editor.webContents.on('will-navigate', (event) => event.preventDefault());
  editor.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('resize', layout);
  win.on('close', (event) => {
    if (!lifecycle.canQuit()) {
      event.preventDefault();
      app.quit();
    }
  });
  win.on('closed', () => {
    if (!source.webContents.isDestroyed()) source.webContents.close();
    if (!editor.webContents.isDestroyed()) editor.webContents.close();
    win = null;
  });
  for (const event of [
    'did-navigate',
    'did-navigate-in-page',
    'did-finish-load',
    'did-stop-loading',
  ])
    source.webContents.on(event, () => notify());
  source.webContents.on('did-fail-load', (_event, code, description, _url, isMain) => {
    if (isMain && code !== -3) notify('사이트를 열지 못했습니다: ' + description);
  });
  const saveFile = require('./files.cjs').createFileSaver({
    dialog,
    getWindow: () => win,
    downloads: app.getPath('downloads'),
  });
  ipcMain.on('canvas:workspace-state', (event, value) => {
    trusted(event, 'editor');
    if (
      !value ||
      !Array.isArray(value.projects) ||
      value.projects.length > 1000 ||
      JSON.stringify(value).length > 2000000
    )
      return;
    workspaceState = value;
    win.webContents.send('canvas:workspace-state', value);
  });
  ipcMain.handle('canvas:project-menu', (event, position) => {
    trusted(event);
    return new Promise((resolve) => {
      const menu = Menu.buildFromTemplate([
        { label: '연결 요청 복사', click: () => resolve('copy-connection') },
        { label: '프로젝트 이름 변경', click: () => resolve('rename') },
      ]);
      menu.popup({
        window: win,
        x: Math.max(0, Math.round(Number(position?.x) || 0)),
        y: 48,
        callback: () => resolve(null),
      });
    });
  });
  ipcMain.handle('canvas:workspace-command', async (event, command) => {
    trusted(event);
    if (
      !command ||
      ![
        'state',
        'create',
        'select',
        'rename',
        'copy-connection',
        'copy-ticket-id',
        'open-file',
        'tickets',
        'confirm',
        'editor',
        'ticket-menu',
      ].includes(command.action) ||
      JSON.stringify(command).length > 5000
    )
      throw Error('허용되지 않은 작업 공간 명령');
    if (command.action === 'open-file') return openFile();
    if (['tickets', 'confirm', 'editor', 'ticket-menu'].includes(command.action))
      show(command.action === 'tickets' ? 'tickets' : 'editor');
    const previous = workspaceState?.project?.id;
    const result = await requestEditor(command);
    if (['copy-connection', 'copy-ticket-id'].includes(command.action))
      clipboard.writeText(result.connection_request);
    if (command.action === 'select' && previous !== result.project?.id && result.project?.last_url)
      await source.webContents.loadURL(require('./security.cjs').webUrl(result.project.last_url));
    return result;
  });
  ipcMain.handle('canvas:retry-assets', async (event, urls) => {
    trusted(event, 'editor');
    return require('./repair-resources.cjs')(urls, require('electron').net.fetch);
  });
  ipcMain.handle('canvas:render-image', async (event, value) => {
    trusted(event, 'editor');
    return require('./render-image.cjs')(value);
  });
  ipcMain.handle('canvas:save-file', (event, value) => {
    trusted(event, 'editor');
    return saveFile(value);
  });
  ipcMain.handle('canvas:open-source', async (event, url) => {
    trusted(event, 'editor');
    const ownView = /^console-canvas:\/\/app\/(editor|source|tickets|settings|agent|update)$/.exec(
      url,
    );
    if (ownView) {
      show(ownView[1]);
      return;
    }
    const target = require('./security.cjs').webUrl(url);
    show('source');
    await source.webContents.loadURL(target);
  });
  ipcMain.handle('canvas:show-editor', (event) => {
    trusted(event, 'editor');
    show('editor');
  });
  ipcMain.handle('canvas:show-source', (event) => {
    trusted(event, 'editor');
    show('source');
  });
  ipcMain.handle('canvas:focus-address', (event) => {
    trusted(event, 'editor');
    show('source');
    win.webContents.send('canvas:focus-address');
  });
  ipcMain.handle('canvas:connection', (event) => {
    trusted(event, 'editor');
    return { url: connection.url, token: connection.token };
  });
  ipcMain.on('canvas:editor-ready', (event) => {
    trusted(event, 'editor');
    editorReady = true;
    if (pendingCapture) {
      editor.webContents.send('canvas:snapshot', pendingCapture);
      pendingCapture = null;
    }
  });
  source.webContents.on('did-start-navigation', () => {
    if (current === 'source') source.setVisible(true);
  });
  source.webContents.on('did-navigate', (_event, url) => {
    if (editorReady) requestEditor({ action: 'save-url', url }).catch(() => {});
  });
  source.webContents.on('did-navigate-in-page', (_event, url) => {
    if (editorReady) requestEditor({ action: 'save-url', url }).catch(() => {});
  });
  const lifecycle = createEditorLifecycle({
    ipcMain,
    trusted,
    getContents: () => editor.webContents,
    isReady: () => editorReady,
    isBusy: () => busy,
    sessionFile: path.join(app.getPath('userData'), 'session.json'),
  });
  lifecycle.protectQuit(app, (error) =>
    dialog.showErrorBox('편집 내용을 저장하지 못했습니다', error.message),
  );
  const updater = createUpdater({
    app,
    root: ROOT,
    python,
    version: appVersion,
    skillSync,
    notify: (value) => {
      if (win && !win.isDestroyed()) win.webContents.send('canvas:update-state', value);
    },
    flush: lifecycle.flush,
    quit: () => lifecycle.quitSaved(app),
  });
  ipcMain.handle('canvas:open-file', (event) => {
    trusted(event, 'editor');
    return openFile();
  });
  async function openFile() {
    if (!workspaceState?.project) throw Error('파일을 가져올 프로젝트를 먼저 선택해 주세요.');
    await lifecycle.flush();
    const result = await dialog.showOpenDialog(win, {
      title: '편집 파일 열기',
      properties: ['openFile'],
      filters: [{ name: 'Console Canvas', extensions: ['json', 'uiclone'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const file = result.filePaths[0],
      stat = await fs.promises.stat(file);
    if (stat.size > 85000000) throw Error('85MB 이하 편집 파일을 선택해 주세요.');
    await requestEditor({
      action: 'import-file',
      name: path.basename(file),
      content: await fs.promises.readFile(file, 'utf8'),
    });
    show('editor');
    return { canceled: false };
  }
  async function capture(options = {}) {
    options = { ...options, project_id: options.project_id || workspaceState?.project?.id };
    if (!options.project_id) throw Error('프로젝트를 먼저 선택하거나 만들어 주세요.');
    if (busy) throw new Error('화면을 가져오는 중입니다.');
    busy = true;
    notify('원본 화면을 복제하고 있어요…');
    try {
      show('source');
      const snapshot = await captureWebsite(source.webContents, ROOT, { scope: options });
      snapshot.project_id = options.project_id;
      await deliverCapture(snapshot);
      show('editor');
      notify('화면을 가져왔어요. 요소를 옮기거나 주석을 남겨 보세요.');
      return { id: snapshot.id, nodes: snapshot.nodes.length };
    } finally {
      busy = false;
      notify();
    }
  }
  async function captureApp() {
    const projectId = workspaceState?.project?.id;
    if (!projectId) throw Error('프로젝트를 먼저 만들어 주세요.');
    if (busy || current === 'capture') throw Error('화면 가져오기를 마친 뒤 다시 시도해 주세요.');
    if (!editorReady) throw Error('편집기를 준비 중입니다. 잠시 후 다시 시도해 주세요.');
    const view = current,
      [width, height] = win.getContentSize();
    const child = ['editor', 'tickets'].includes(view) ? editor : view === 'source' ? source : null;
    busy = true;
    let message;
    try {
      const snapshot = await require('./app-capture.cjs').captureApplication({
        shell: win.webContents,
        content: child?.webContents,
        bounds: child?.getBounds(),
        width,
        height,
        view,
        root: ROOT,
        version: appVersion,
        onShellCaptured: () => notify('앱 디자인을 가져오고 있어요…'),
      });
      if (
        current !== view ||
        win.getContentSize().some((value, index) => value !== [width, height][index])
      )
        throw Error('앱 화면이 바뀌었습니다. 다시 가져와 주세요.');
      notify('앱 디자인을 새 문서로 저장하고 있어요…');
      snapshot.project_id = projectId;
      await deliverCapture(snapshot);
      show('editor');
      message =
        '앱 디자인 복제본을 열었어요. 헤더·패널·버튼을 편집하고 주석이나 작업 티켓으로 목표를 남겨 보세요.';
      return { id: snapshot.id, nodes: snapshot.nodes.length };
    } catch (error) {
      message = error.message;
      throw error;
    } finally {
      busy = false;
      notify(message);
    }
  }
  registerShellIpc({
    ipcMain,
    trusted,
    app,
    win,
    source,
    updater,
    skills,
    version: appVersion,
    dialog,
    clipboard,
    show,
    info: state,
    capture,
    captureApp,
    captureMenu: (position) =>
      new Promise((resolve) => {
        const modes = [
          ['viewport', '현재 보이는 화면 가져오기'],
          ['document', '전체 페이지 가져오기'],
          ['region', '영역 지정하여 가져오기'],
          ['app', '앱 디자인 화면 가져오기'],
          ['file', '편집 파일 열기…'],
        ];
        const menu = Menu.buildFromTemplate(
          modes.map(([mode, label]) => ({ label, click: () => resolve(mode) })),
        );
        const [width, height] = win.getContentSize();
        menu.popup({
          window: win,
          x: Math.max(0, Math.min(width - 1, Math.round(Number(position?.x) || 0))),
          y: Math.max(0, Math.min(height - 1, Math.round(Number(position?.y) || 0))),
          callback: () => resolve(null),
        });
      }),
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Console Canvas',
        submenu: [
          { role: 'about' },
          {
            label: '앱 디자인 편집',
            click: () => captureApp().catch((error) => notify(error.message)),
          },
          {
            label: '업데이트 확인…',
            click: () => {
              show('update');
              updater.check().catch(() => {});
            },
          },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: '편집',
        submenu: [
          ...['undo', 'redo'].map((command, index) => ({
            label: index ? '다시 실행' : '실행 취소',
            accelerator: index ? 'CommandOrControl+Shift+Z' : 'CommandOrControl+Z',
            click: () => {
              if (current === 'editor') editor.webContents.send('canvas:history', command);
              else require('electron').webContents.getFocusedWebContents()?.[command]();
            },
          })),
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      { label: '보기', submenu: [{ role: 'toggleDevTools' }, { role: 'togglefullscreen' }] },
    ]),
  );
  const reopen = lifecycle.restore();
  await win.loadFile(path.join(__dirname, 'shell.html'));
  await editor.webContents.loadURL(
    connection.url +
      '/editor.html' +
      (reopen?.document_id ? '?id=' + encodeURIComponent(reopen.document_id) : ''),
  );
  for (let n = 0; !editorReady && n < 100; n++)
    await new Promise((resolve) => setTimeout(resolve, 20));
  await requestEditor({ action: 'state' });
  if (workspaceState?.project?.last_url)
    await source.webContents.loadURL(
      require('./security.cjs').webUrl(workspaceState.project.last_url),
    );
  show('source');
  notify();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app
    .whenReady()
    .then(start)
    .catch((error) => {
      require('electron').dialog.showErrorBox('Console Canvas 실행 오류', error.message);
      app.quit();
    });
}
app.on('window-all-closed', () => app.quit());
