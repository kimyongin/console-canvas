const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  http = require('node:http'),
  os = require('node:os'),
  assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
let win, server;
app.on('window-all-closed', () => {});
setTimeout(() => {
  console.error('Visual fixture timeout');
  app.exit(1);
}, 60000).unref();
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-visual-'));
  app.setPath('userData', profile);
  await app.whenReady();
  app.dock?.hide();
  server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/visual-blank.html') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><title>Isolated visual input</title><body></body>');
        return;
      }
      const p = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
      assert.ok(p.startsWith(root + path.sep));
      res.setHeader(
        'Content-Type',
        p.endsWith('.js')
          ? 'text/javascript'
          : p.endsWith('.json')
            ? 'application/json'
            : 'text/html',
      );
      res.end(await fs.readFile(p));
    } catch (error) {
      console.error(req.url, error);
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  win = new BrowserWindow({
    show: false,
    width: 600,
    height: 400,
    webPreferences: {
      preload: path.join(__dirname, 'visual-preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  ipcMain.handle('visual-test-render', (e, v) => {
    assert.equal(e.sender, win.webContents);
    return require('../desktop/render-image.cjs')(v);
  });
  await win.loadURL('http://127.0.0.1:' + server.address().port + '/visual-blank.html');
  const result = await win.webContents.executeJavaScript(
    `(async()=>{document.documentElement.style.setProperty('--visual-test-color','rgb(255,0,0)');document.body.innerHTML='<div data-uic-id="n1" style="position:absolute;left:20px;top:20px;width:300px;height:100px;overflow:auto"><div style="height:100px;background:var(--visual-test-color)">TOP</div><div style="height:100px;background:rgb(0,255,0)">MIDDLE</div><div style="height:100px;background:rgb(0,0,255)">BOTTOM</div></div>';const e=document.querySelector('[data-uic-id]'),before=e.outerHTML;const scene={doc:document,snapshot:{source:{viewport:{width:600,height:400}}},elements:new Map([['n1',e]]),nodes:new Map([['n1',{id:'n1',kind:'element',tag:'div',name:'Scrollable panel',parentId:null}]]),hidden:()=>false,ancestors:()=>[],rect:()=>({x:20,y:20,width:300,height:100}),contentSize:()=>({width:600,height:400}),viewRect:()=>({x:0,y:0,width:600,height:400}),serialize:()=>document.documentElement.outerHTML};const {buildVisualContext}=await import('/ai-visual-context.js');const c=await buildVisualContext(scene,{selection:['n1'],annotations:{n1:'Keep scrolling'},note:''});return {context:c,unchanged:before===e.outerHTML&&e.scrollTop===0}})()`,
  );
  assert.equal(result.unchanged, true);
  const c = result.context;
  assert.equal(c.kind, 'visual');
  assert.ok(!('html' in c) && !('styles' in c));
  assert.equal(c.images[0].kind, 'overview');
  assert.equal(c.images[1].kind, 'selection_detail');
  const tiles = c.images.filter((i) => i.kind === 'scroll_detail');
  assert.equal(tiles.length, 3);
  assert.deepEqual(
    tiles.map((i) => i.offset.y),
    [0, 100, 200],
  );
  assert.ok(
    tiles.every(
      (i) =>
        i.viewport.height === 100 && i.content.height === 300 && i.coverage === 'captured_content',
    ),
  );
  const channels = tiles.map((i) => {
    const b = nativeImage.createFromDataURL(i.image_url).toBitmap();
    const pos = (50 * 300 + 150) * 4;
    return [b[pos + 2], b[pos + 1], b[pos]];
  });
  assert.deepEqual(channels, [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
  ]);
  console.log(
    JSON.stringify({
      passed: 8,
      scrollPixels: channels,
      sourceUnchanged: true,
      images: c.images.length,
      htmlCssAbsent: true,
    }),
  );
  win.destroy();
  await new Promise((r) => server.close(r));
  app.exit(0);
})().catch((e) => {
  console.error(e);
  win?.destroy();
  server?.close();
  app.exit(1);
});
