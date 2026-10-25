// Disposable UI benchmark. Pass a baseline runtime directory as argv[2].
// Measures command batches, not full paint latency or a product SLA.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os'),
  http = require('node:http');
let win, server, profile;
app.on('window-all-closed', () => {});
(async () => {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-ui-bench-'));
  app.setPath('userData', profile);
  await app.whenReady();
  const results = [];
  const currentRoot = path.resolve(__dirname, '..');
  const runtimes = process.argv[2] ? [path.resolve(process.argv[2]), currentRoot] : [currentRoot];
  for (const root of runtimes) {
    const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
    server = http.createServer(async (req, res) => {
      try {
        const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
        if (!file.startsWith(root + path.sep)) throw Error('path');
        res.setHeader(
          'Content-Type',
          {
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.html': 'text/html',
            '.json': 'application/json',
          }[path.extname(file)] || 'application/octet-stream',
        );
        res.end(await fs.readFile(file));
      } catch {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    win = new BrowserWindow({
      show: false,
      width: 1440,
      height: 1000,
      webPreferences: {
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/editor.html?sample=1`);
    for (
      let i = 0;
      !(await win.webContents.executeJavaScript('!!window.ConsoleCanvas?.state.ready'));
      i++
    ) {
      if (i > 400) throw Error('load timeout');
      await new Promise((r) => setTimeout(r, 25));
    }
    const report = await win.webContents
      .executeJavaScript(`(async()=>{const app=window.ConsoleCanvas,scene=app.state.scene,node=[...scene.nodes.values()].find(n=>n.locator.id==='new-customer'),frame=scene.frame,out={};const tick=()=>new Promise(r=>setTimeout(r,0));
async function measure(name,run,count){const t=performance.now();await run();out[name]={count,totalMs:Math.round((performance.now()-t)*100)/100};}
await measure('select',async()=>{for(let i=0;i<80;i++)app.selectNode(i%2?node.id:'n83')},80);
app.selectNode(node.id);await measure('moveCommit',async()=>{for(let i=0;i<80;i++)scene.setPosition(i,0);await app.state.saving},80);
const search=document.querySelector('#layer-search');await measure('layerSearch',async()=>{for(let i=0;i<40;i++){search.value=i%2?'고객':'검색';search.dispatchEvent(new Event('input'));}},40);search.value='';search.dispatchEvent(new Event('input'));
for(let i=0;i<80;i++){scene.setPosition(i+100,0);app.snapshotHistory.create('성능 확인 '+i);await app.state.saving;}
await measure('longHistorySelect',async()=>{for(let i=0;i<40;i++)app.selectNode(i%2?node.id:'n83');},40);
await measure('graphOpen',async()=>{for(let i=0;i<6;i++){document.querySelector('#snapshot-dropdown').click();await tick();document.querySelector('#close-snapshots').click();await tick();}},6);
const before=app.state.revision;app.selectNode(node.id);scene.setPosition(999,0);await app.state.saving;out.singleCommitDelta=app.state.revision-before;out.sameScene=scene===app.state.scene;out.frameCount=[...document.querySelectorAll('iframe')].filter(f=>f===scene.frame).length;out.sameFrame=frame===scene.frame;out.snapshots=app.state.timeline.entries.length;out.history=app.state.activity?.length;return out;})()`);
    results.push({ version, ...report });
    win.destroy();
    win = null;
    await new Promise((r) => server.close(r));
    server = null;
  }
  await fs.writeFile(
    path.join(__dirname, '../dist/performance.json'),
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results));
  await fs.rm(profile, { recursive: true, force: true });
  app.exit(0);
})().catch((e) => {
  console.error(e);
  win?.destroy();
  server?.close();
  app.exit(1);
});
