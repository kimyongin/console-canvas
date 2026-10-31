const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ConsoleCanvasDesktop', {
  focusAddress: () => ipcRenderer.invoke('canvas:focus-address'),
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
