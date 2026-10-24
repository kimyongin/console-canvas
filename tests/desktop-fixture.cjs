// Own-app integration fixture. All profiles, skills and broker state live in a temp directory.
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const directory = process.env.CONSOLE_CANVAS_TEST_DIR;
if (!directory) throw new Error('Run scripts/check-desktop.mjs');
app.setPath('userData', path.join(directory, 'profile'));
const phase = process.env.CONSOLE_CANVAS_TEST_PHASE;
app.on('browser-window-created', (_event, window) => window.hide());
dialog.showErrorBox = (title, message) => {
  console.error(title + ': ' + message);
  app.exit(1);
};
require('../desktop/main.cjs');
async function until(read, message, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(message);
}
const evaluate = (contents, code) => contents.executeJavaScript(code);
async function main() {
  await app.whenReady();
  const window = await until(() => BrowserWindow.getAllWindows()[0], 'Window not ready');
  const shell = window.webContents;
  const editor = await until(
    () =>
      window.contentView.children.find((view) =>
        view.webContents?.getURL().includes('/editor.html'),
      )?.webContents,
    'Editor not loaded',
  );
  const source = await until(
    () =>
      window.contentView.children.find((view) =>
        view.webContents?.getURL().includes('/fixtures/console.html'),
      )?.webContents,
    'Website not loaded',
  );
  await until(
    () => evaluate(shell, 'typeof window.ConsoleCanvasShell !== "undefined"'),
    'Shell preload missing',
  );
  for (const contents of [source, editor, shell]) {
    const prefs = contents.getLastWebPreferences();
    assert.equal(prefs.nodeIntegration, false);
    assert.equal(prefs.contextIsolation, true);
    assert.equal(prefs.sandbox, true);
  }
  assert.equal(await evaluate(source, 'typeof window.ConsoleCanvasDesktop'), 'undefined');
  if (phase === 'prepare') {
    const before = await evaluate(source, 'document.documentElement.outerHTML');
    await evaluate(shell, 'window.ConsoleCanvasShell.capture()');
    await until(
      () =>
        evaluate(
          editor,
          '!!window.ConsoleCanvas?.state.ready && !!window.ConsoleCanvas.state.mcpStatus.connected',
        ),
      'Capture/MCP not ready',
    );
    assert.equal(await evaluate(source, 'document.documentElement.outerHTML'), before);
    assert.equal(await evaluate(shell, "document.querySelector('#navigation').hidden"), true);
    assert.equal(editor.getOwnerBrowserWindow(), window);
    await fs.writeFile(
      path.join(directory, 'prepare-ready.json'),
      JSON.stringify({ sandbox: true, sourceUnchanged: true }),
    );
    await until(
      () =>
        fs.access(path.join(directory, 'sdk-complete')).then(
          () => true,
          () => false,
        ),
      'SDK did not finish',
      120000,
    );
    const expected = await evaluate(
      editor,
      `(() => {
      const app=window.ConsoleCanvas,doc=document,node=[...app.state.scene.nodes.values()].find(n=>n.locator.id==='new-customer');
      app.selectNode(node.id);app.state.scene.setPosition(23,31);
      doc.querySelector('#component-comment').value='comment in saved snapshot';doc.querySelector('#save-comment').click();
      const saved=app.snapshotHistory.create('refactor persistence');
      doc.querySelector('#component-comment').value='draft saved on normal quit';doc.querySelector('#review-note').value='note saved on normal quit';
      const left=doc.querySelector('#resize-layers'),right=doc.querySelector('#resize-properties');
      left.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));right.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));
      for(let i=0;i<10;i++)left.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
      for(let i=0;i<12;i++)right.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
      return {document_id:app.state.snapshot.id,node:node.id,dx:23,dy:31,snapshotId:saved.id,snapshots:app.state.timeline.entries.length};
    })()`,
    );
    await fs.writeFile(path.join(directory, 'expected.json'), JSON.stringify(expected));
  } else {
    await until(
      () =>
        evaluate(
          editor,
          '!!window.ConsoleCanvas?.state.ready && !!window.ConsoleCanvas.state.mcpStatus.connected',
        ),
      'Restored document not ready',
    );
    const expected = JSON.parse(await fs.readFile(path.join(directory, 'expected.json')));
    const actual = await evaluate(
      editor,
      `(() => {const app=window.ConsoleCanvas;return {document_id:app.state.snapshot.id,edits:app.state.scene.edits,annotations:app.state.scene.annotations,note:document.querySelector('#review-note').value,entries:app.state.timeline.entries.map(e=>e.id),active:app.state.timeline.activeId,panels:JSON.parse(localStorage.getItem('console-canvas-panels-v1'))};})()`,
    );
    assert.equal(actual.document_id, expected.document_id);
    assert.equal(actual.edits[expected.node].dx, expected.dx);
    assert.equal(actual.edits[expected.node].dy, expected.dy);
    assert.equal(actual.annotations[expected.node], 'draft saved on normal quit');
    assert.equal(actual.note, 'note saved on normal quit');
    assert.equal(actual.entries.length, expected.snapshots);
    assert.equal(actual.active, expected.snapshotId);
    assert.deepEqual(actual.panels.widths, { layers: 260, properties: 320 });
    assert.equal(await evaluate(shell, "document.querySelector('#navigation').hidden"), true);
    assert.equal(
      await evaluate(
        shell,
        "getComputedStyle(document.documentElement).getPropertyValue('--shell-height').trim()",
      ),
      '54px',
    );
    await fs.writeFile(
      path.join(directory, 'reopen-ready.json'),
      JSON.stringify({
        restored: true,
        comments: true,
        snapshots: true,
        panels: true,
        sandbox: true,
      }),
    );
  }
  if (phase === 'reopen') {
    await fs.writeFile(
      path.join(__dirname, '../dist/editor-panel-controls.png'),
      (await editor.capturePage()).toPNG(),
    );
  }
  window.close();
}
main().catch((error) => {
  console.error(error);
  app.exit(1);
});
