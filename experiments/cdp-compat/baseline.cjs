// Same live fixture URLs, production Electron entry point and same capture engine.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const { captureWebsite } = require(path.join(root, 'desktop/capture.cjs'));
app.setPath('userData', process.env.CDP_PROBE_PROFILE);
app.on('window-all-closed', () => {});
(async () => {
  await app.whenReady();
  const cases = JSON.parse(await fs.readFile(process.env.CDP_PROBE_CASES_FILE, 'utf8'));
  const results = [];
  const window = new BrowserWindow({
    show: false,
    width: 1440,
    height: 1000,
    useContentSize: true,
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  for (const item of cases) {
    const result = {
      name: item.name,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
    };
    results.push(result);
    try {
      if (item.viewport) window.setContentSize(item.viewport.width, item.viewport.height);
      let timer;
      const ready = new Promise((resolve) => window.webContents.once('dom-ready', resolve));
      try {
        const navigation = window.loadURL(item.url);
        if (item.verifySourceUnchanged === false)
          await Promise.race([
            navigation,
            ready,
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(Error('Source DOM load timeout')), 20000);
            }),
          ]);
        else await navigation;
      } finally {
        clearTimeout(timer);
      }

      await window.webContents.executeJavaScript(
        'Promise.race([Promise.all([document.fonts.ready,...[...document.images].map(i=>i.decode().catch(()=>{}))]),new Promise(r=>setTimeout(r,10000))])',
      );
      result.viewportReadiness = await window.webContents.executeJavaScript(
        require('./settle-view.cjs'),
      );
      if (!result.viewportReadiness.stable) throw Error('Test viewport did not settle');
      if (item.name.startsWith('scroll-'))
        await window.webContents.executeJavaScript('scrollTo(0,500)');
      const state = () =>
        window.webContents.executeJavaScript(
          'JSON.stringify({html:document.documentElement.outerHTML,scroll:[scrollX,scrollY],actions:globalThis.actions||0})',
        );
      const before = await state();
      const snapshot = await captureWebsite(window.webContents, root, {
        scope: { mode: item.mode, rect: item.rect },
      });
      const sourceUnchanged = before === (await state());
      if (item.verifySourceUnchanged !== false && !sourceUnchanged) throw Error('Source changed');
      const dir = path.join(process.env.CDP_PROBE_OUTPUT, 'native', item.name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'capture.uiclone.json'), JSON.stringify(snapshot));
      Object.assign(result, {
        ok: true,
        nodes: snapshot.nodes.length,
        frames: snapshot.captureReport.frameCount,
        domFrames: snapshot.captureReport.domFrames,
        failedFrames: snapshot.captureReport.failedFrames,
        closedShadowRoots: snapshot.captureReport.closedShadowRoots,
        sourceUnchanged,
      });
      console.log(
        'PASS native ' +
          item.name +
          ' ' +
          result.nodes +
          ' nodes / ' +
          result.domFrames +
          ' DOM frames',
      );
    } catch (e) {
      result.ok = false;
      result.error = e.stack;
      console.log('FAIL native ' + item.name + ': ' + e.message);
    }
  }
  await fs.writeFile(
    path.join(process.env.CDP_PROBE_OUTPUT, 'native-report.json'),
    JSON.stringify(results, null, 2),
  );
  window.destroy();
  app.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => {
  console.error(e);
  app.exit(1);
});
