const {app,BrowserWindow,WebContentsView,ipcMain,session,Menu}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile),ROOT=path.resolve(__dirname,'..');
let win,source,editor,connection,current='source',busy=false;
app.setName('Console Canvas');
const stateDir=process.env.CONSOLE_CANVAS_STATE_DIR||path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'console-canvas');
function webUrl(value){const parsed=new URL(value);if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error('HTTP 또는 HTTPS 주소를 입력해 주세요.');return parsed.href;}
function state(message){return {url:source?.webContents.getURL()||'',view:current,busy,message:message|| (current==='source'?'로그인한 뒤 원하는 화면에서 가져오기를 누르세요.':'요소를 옮기거나 주석을 남기세요. MCP는 가져온 화면에 자동 연결됩니다.'),demo_url:connection.url+'/fixtures/console.html'};}
function notify(message){if(win&&!win.isDestroyed())win.webContents.send('canvas:state',state(message));}
function layout(){if(!win)return;const [width,height]=win.getContentSize();for(const view of [source,editor])view?.setBounds({x:0,y:100,width,height:Math.max(1,height-100)});}
function show(which){if(!['source','editor'].includes(which))throw new Error('알 수 없는 화면');current=which;source.setVisible(which==='source');editor.setVisible(which==='editor');layout();notify();}
function trusted(event,kind){const expected=kind==='editor'?editor.webContents:win.webContents;if(event.sender!==expected||event.senderFrame!==expected.mainFrame)throw new Error('허용되지 않은 앱 요청');}
function secure(contents){contents.on('will-navigate',(event,url)=>{try{webUrl(url);}catch{event.preventDefault();}});contents.setWindowOpenHandler(({url})=>{try{webUrl(url);return {action:'allow',overrideBrowserWindowOptions:{parent:win,width:850,height:750,webPreferences:{session:source.webContents.session,nodeIntegration:false,contextIsolation:true,sandbox:true}}};}catch{return {action:'deny'};}});contents.on('did-create-window',child=>secure(child.webContents));}
async function start(){
  const python=process.env.CONSOLE_CANVAS_PYTHON||(process.platform==='darwin'?'/usr/bin/python3':'python3');
  await run(python,[path.join(ROOT,'mcp/server.py'),'--state-dir',stateDir,'--app-dir',ROOT,'--start'],{timeout:15000});
  connection=JSON.parse(fs.readFileSync(path.join(stateDir,'connection.json'),'utf8'));
  const browsing=session.fromPartition('persist:console-canvas-websites');browsing.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));browsing.setPermissionCheckHandler(()=>false);
  win=new BrowserWindow({width:1440,height:1000,minWidth:1000,minHeight:720,title:'Console Canvas',backgroundColor:'#f5f6fb',webPreferences:{preload:path.join(__dirname,'shell-preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  source=new WebContentsView({webPreferences:{session:browsing,nodeIntegration:false,contextIsolation:true,sandbox:true}});
  editor=new WebContentsView({webPreferences:{partition:'persist:console-canvas-editor',preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  win.contentView.addChildView(source);win.contentView.addChildView(editor);editor.setVisible(false);layout();secure(source.webContents);
  editor.webContents.on('will-navigate',event=>event.preventDefault());editor.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.on('resize',layout);win.on('closed',()=>{if(!source.webContents.isDestroyed())source.webContents.close();if(!editor.webContents.isDestroyed())editor.webContents.close();win=null;});
  for(const event of ['did-navigate','did-navigate-in-page','did-finish-load'])source.webContents.on(event,()=>notify());
  source.webContents.on('did-fail-load',(_event,code,description,_url,isMain)=>{if(isMain&&code!==-3)notify('사이트를 열지 못했습니다: '+description);});
  ipcMain.handle('canvas:connection',event=>{trusted(event,'editor');return {url:connection.url,token:connection.token};});
  ipcMain.handle('canvas:info',event=>{trusted(event);return state();});
  ipcMain.handle('canvas:show',(event,which)=>{trusted(event);show(which);});
  ipcMain.handle('canvas:navigate',async(event,input)=>{trusted(event);let value=String(input).trim();if(!/^https?:\/\//i.test(value))value='https://'+value;const url=webUrl(value);show('source');await source.webContents.loadURL(url);});
  ipcMain.handle('canvas:back',event=>{trusted(event);if(source.webContents.navigationHistory.canGoBack())source.webContents.navigationHistory.goBack();});
  ipcMain.handle('canvas:forward',event=>{trusted(event);if(source.webContents.navigationHistory.canGoForward())source.webContents.navigationHistory.goForward();});
  ipcMain.handle('canvas:reload',event=>{trusted(event);source.webContents.reload();});
  ipcMain.handle('canvas:capture',async event=>{
    trusted(event);if(busy)throw new Error('화면을 가져오는 중입니다.');webUrl(source.webContents.getURL());busy=true;notify('원본 화면을 복제하고 있어요…');
    try{const captureCode=fs.readFileSync(path.join(ROOT,'capture.js'),'utf8');
      const snapshot=await source.webContents.executeJavaScriptInIsolatedWorld(1001,[{code:captureCode+'\n;globalThis.UICloneCapture.capture(document);'}]);
      snapshot.screenshot=(await source.webContents.capturePage()).toDataURL();
      editor.webContents.send('canvas:snapshot',snapshot);show('editor');notify('화면을 가져왔어요. 요소를 옮기거나 주석을 남겨 보세요.');
      return {id:snapshot.id,nodes:snapshot.nodes.length};
    }finally{busy=false;notify();}
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Console Canvas',submenu:[{role:'about'},{type:'separator'},{role:'quit'}]},{label:'편집',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'보기',submenu:[{role:'toggleDevTools'},{role:'togglefullscreen'}]}]));
  await win.loadFile(path.join(__dirname,'shell.html'));await editor.webContents.loadURL(connection.url+'/editor.html');await source.webContents.loadURL(connection.url+'/fixtures/console.html');notify();
}
if(!app.requestSingleInstanceLock())app.quit();else{app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});app.whenReady().then(start).catch(error=>{require('electron').dialog.showErrorBox('Console Canvas 실행 오류',error.message);app.quit();});}
app.on('window-all-closed',()=>app.quit());
