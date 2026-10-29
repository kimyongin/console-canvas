const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ConsoleCanvasDesktop', {
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
    ipcRenderer.on('canvas:snapshot', (_event, value) => callback(value));
    ipcRenderer.send('canvas:editor-ready');
  },
});
