const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ConsoleCanvasDesktop', {
  chatgpt: Object.fromEntries(
    [
      'status',
      'login',
      'cancel-login',
      'models',
      'select',
      'logout',
      'generate',
      'cancel',
      'usage',
    ].map((name) => [name, (...args) => ipcRenderer.invoke('canvas:chatgpt-' + name, ...args)]),
  ),
  focusAddress: () => ipcRenderer.invoke('canvas:focus-address'),
  beginReviewCapture: (value) => ipcRenderer.invoke('canvas:begin-review-capture', value),
  cancelReviewCapture: (id) => ipcRenderer.invoke('canvas:cancel-review-capture', id),
  onReviewCancelled: (callback) =>
    ipcRenderer.on('canvas:review-cancelled', (_event, id) => callback(id)),
  retryAssets: (urls) => ipcRenderer.invoke('canvas:retry-assets', urls),
  openSource: (url) => ipcRenderer.invoke('canvas:open-source', url),
  showSource: () => ipcRenderer.invoke('canvas:show-source'),
  renderImage: (value) => ipcRenderer.invoke('canvas:render-image', value),
  saveFile: (value) => ipcRenderer.invoke('canvas:save-file', value),
  getConnection: () => ipcRenderer.invoke('canvas:connection'),
  onHistory: (callback) =>
    ipcRenderer.on('canvas:history', (_event, command) => {
      if (['undo', 'redo'].includes(command)) callback(command);
    }),
  onFlush: (callback) =>
    ipcRenderer.on('canvas:flush', async (_event, id) => {
      try {
        ipcRenderer.send('canvas:flushed', id, { ok: true, ...(await callback()) });
      } catch (error) {
        ipcRenderer.send('canvas:flushed', id, { ok: false, message: error.message });
      }
    }),
  onSnapshot: (callback) => {
    ipcRenderer.on('canvas:snapshot', async (_event, value, destination, receipt) => {
      try {
        const result = await callback(value, destination);
        if (receipt) ipcRenderer.send('canvas:snapshot-result', receipt, result || { ok: true });
      } catch (error) {
        if (receipt)
          ipcRenderer.send('canvas:snapshot-result', receipt, {
            ok: false,
            message: error.message,
          });
      }
    });
    ipcRenderer.send('canvas:editor-ready');
  },
});
