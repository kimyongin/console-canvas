const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session,
  Menu,
  dialog,
  clipboard,
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
    message:
      message ||
      (current === 'source'
        ? '로그인한 뒤 원하는 화면에서 가져오기를 누르세요.'
        : '복제본 편집 · 원본 사이트에는 적용되지 않습니다.'),
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
  if (!['source', 'editor', 'settings', 'agent', 'update'].includes(which))
    throw new Error('알 수 없는 화면');
  current = which;
  source.setVisible(which === 'source');
  editor.setVisible(which === 'editor');
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
async function start() {
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
    const target = require('./security.cjs').webUrl(url);
    show('source');
    await source.webContents.loadURL(target);
  });
  ipcMain.handle('canvas:show-source', (event) => {
    trusted(event, 'editor');
    show('source');
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
  async function capture() {
    if (busy) throw new Error('화면을 가져오는 중입니다.');
    busy = true;
    notify('원본 화면을 복제하고 있어요…');
    try {
      const snapshot = await captureWebsite(source.webContents, ROOT);
      if (editorReady) editor.webContents.send('canvas:snapshot', snapshot);
      else pendingCapture = snapshot;
      show('editor');
      notify('화면을 가져왔어요. 요소를 옮기거나 주석을 남겨 보세요.');
      return { id: snapshot.id, nodes: snapshot.nodes.length };
    } finally {
      busy = false;
      notify();
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
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Console Canvas',
        submenu: [
          { role: 'about' },
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
  await source.webContents.loadURL(connection.url + '/fixtures/console.html');
  if (reopen?.document_id) show('editor');
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
