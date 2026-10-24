const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('ConsoleCanvasDesktop',{
  getConnection:()=>ipcRenderer.invoke('canvas:connection'),
  onSnapshot:callback=>{ipcRenderer.on('canvas:snapshot',(_event,value)=>callback(value));ipcRenderer.send('canvas:editor-ready');}
});
