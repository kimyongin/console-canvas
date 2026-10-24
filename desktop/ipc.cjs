const path = require('node:path');
const fs = require('node:fs/promises');
const { webUrl } = require('./security.cjs');
// Every shell action passes through one exact main-frame trust boundary.
function registerShellIpc({
  ipcMain,
  trusted,
  app,
  win,
  source,
  updater,
  skills,
  version,
  dialog,
  clipboard,
  show,
  info,
  capture,
}) {
  const handle = (name, callback) =>
    ipcMain.handle('canvas:' + name, (event, ...args) => {
      trusted(event);
      return callback(...args);
    });
  for (const name of ['info', 'check', 'download', 'install'])
    handle('update-' + name, () => updater[name]());
  handle('info', info);
  handle('skill-info', () => skills.info());
  handle('skill-install', () => skills.info(true));
  handle('mcp-copy', async () => {
    await clipboard.writeText(skills.command);
    return { copied: true };
  });
  handle('skill-save', async () => {
    const result = await dialog.showSaveDialog(win, {
      title: 'Console Canvas 스킬 ZIP 저장',
      defaultPath: path.join(app.getPath('downloads'), 'console-canvas-skill-' + version + '.zip'),
      filters: [{ name: 'ZIP 파일', extensions: ['zip'] }],
    });
    if (result.canceled) return { canceled: true };
    await fs.copyFile(skills.archive, result.filePath);
    return { path: result.filePath };
  });
  handle('show', show);
  handle('navigate', async (input) => {
    let value = String(input).trim();
    if (!/^https?:\/\//i.test(value)) value = 'https://' + value;
    const url = webUrl(value);
    show('source');
    await source.webContents.loadURL(url);
  });
  handle('back', () => {
    if (source.webContents.navigationHistory.canGoBack())
      source.webContents.navigationHistory.goBack();
  });
  handle('forward', () => {
    if (source.webContents.navigationHistory.canGoForward())
      source.webContents.navigationHistory.goForward();
  });
  handle('reload', () => source.webContents.reload());
  handle('capture', capture);
}
module.exports = { registerShellIpc };
