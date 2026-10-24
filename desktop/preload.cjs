const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('ConsoleCanvasDesktop',{
  getConnection:()=>ipcRenderer.invoke('canvas:connection'),
  onBeforeUpdate:callback=>ipcRenderer.on('canvas:before-update',async(_event,id)=>{try{ipcRenderer.send('canvas:update-saved',id,{ok:true,...await callback()});}catch(error){ipcRenderer.send('canvas:update-saved',id,{ok:false,message:error.message});}}),
  onSnapshot:callback=>{ipcRenderer.on('canvas:snapshot',(_event,value)=>callback(value));ipcRenderer.send('canvas:editor-ready');}
});
