const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ConsoleCanvasDesktop', {
  renderImage: (v) => ipcRenderer.invoke('visual-test-render', v),
});
