const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('ConsoleCanvasShell',{
  navigate:url=>ipcRenderer.invoke('canvas:navigate',url),
  capture:()=>ipcRenderer.invoke('canvas:capture'),
  show:view=>ipcRenderer.invoke('canvas:show',view),
  back:()=>ipcRenderer.invoke('canvas:back'),
  forward:()=>ipcRenderer.invoke('canvas:forward'),
  reload:()=>ipcRenderer.invoke('canvas:reload'),
  info:()=>ipcRenderer.invoke('canvas:info'),
  skillInfo:()=>ipcRenderer.invoke('canvas:skill-info'),
  installSkill:()=>ipcRenderer.invoke('canvas:skill-install'),
  saveSkill:()=>ipcRenderer.invoke('canvas:skill-save'),
  copyMcpCommand:()=>ipcRenderer.invoke('canvas:mcp-copy'),
  onState:callback=>ipcRenderer.on('canvas:state',(_event,value)=>callback(value))
});
