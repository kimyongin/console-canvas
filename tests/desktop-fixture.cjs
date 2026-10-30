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
const appRoot = process.env.CONSOLE_CANVAS_TEST_APP_ROOT || path.resolve(__dirname, '..');
require(path.join(appRoot, 'desktop/main.cjs'));
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
  const chatgptBoundary = await evaluate(editor, 'window.ConsoleCanvasDesktop.chatgpt.status()');
  assert.equal(chatgptBoundary.ok, true);
  assert.deepEqual(chatgptBoundary.value.accounts, []);
  assert.ok(!JSON.stringify(chatgptBoundary).includes('access_token'));
  const protectedStorage = await require(
    path.join(appRoot, 'desktop/chatgpt.cjs'),
  ).createChatgptStorage(require('electron').safeStorage);
  if (protectedStorage.isEncryptionAvailable()) {
    const encrypted = await protectedStorage.encryptString('qa-only-protected-value');
    assert.ok(!encrypted.includes('qa-only-protected-value'));
    assert.equal(await protectedStorage.decryptString(encrypted), 'qa-only-protected-value');
  }
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
    // Real IPC capture into a frozen review must leave the target editor intact.
    const targetDocument = await evaluate(editor, 'window.ConsoleCanvas.state.snapshot.id');
    await evaluate(
      editor,
      `(async()=>{const a=window.ConsoleCanvas,n=[...a.state.scene.nodes.values()].find(n=>n.locator.id==='new-customer');a.state.scene.setComment(n.id,'검증용 구현 요청');await a.implementationReview.open();document.querySelector('#implementation-capture').click();})()`,
    );
    await until(
      () =>
        evaluate(
          shell,
          `!!window.ConsoleCanvasShell && !!document.querySelector('#cancel-review-capture') && !document.querySelector('#cancel-review-capture').hidden`,
        ),
      'Review capture target not exposed',
    );
    const reviewTicket = await evaluate(
      shell,
      'window.ConsoleCanvasShell.info().then(v=>v.review_target)',
    );
    assert.equal(reviewTicket.document_id, targetDocument);
    await evaluate(shell, "window.ConsoleCanvasShell.capture({mode:'viewport'})");
    await until(
      () => evaluate(editor, '!!window.ConsoleCanvas.state.implementationReviews.at(-1)?.result'),
      'Native review result not attached',
    );
    const reviewState = await evaluate(
      editor,
      `({target:window.ConsoleCanvas.state.snapshot.id,result:window.ConsoleCanvas.state.implementationReviews.at(-1).result.snapshot.id,scope:window.ConsoleCanvas.state.implementationReviews.at(-1).result.snapshot.captureScope})`,
    );
    assert.equal(reviewState.target, targetDocument);
    assert.notEqual(reviewState.result, targetDocument);
    if (!process.env.CONSOLE_CANVAS_OFFSCREEN) assert.equal(reviewState.scope.mode, 'viewport');
    await evaluate(editor, `document.querySelector('#implementation-capture').click()`);
    await until(
      () => evaluate(shell, "!document.querySelector('#cancel-review-capture').hidden"),
      'Second review capture not pending',
    );
    await evaluate(
      shell,
      'window.ConsoleCanvasShell.info().then(v=>window.ConsoleCanvasShell.cancelReview(v.review_target.request_id))',
    );
    assert.equal(await evaluate(editor, 'window.ConsoleCanvas.state.snapshot.id'), targetDocument);
    await evaluate(
      editor,
      `(async()=>{document.querySelector('#implementation-dialog').close();const a=window.ConsoleCanvas,n=[...a.state.scene.nodes.values()].find(n=>n.locator.id==='new-customer');a.state.scene.setComment(n.id,'');await a.state.saving;})()`,
    );
    await evaluate(editor, 'window.ConsoleCanvasDesktop.focusAddress()');
    await until(
      () => evaluate(shell, "document.activeElement===document.querySelector('#address')"),
      'Address command did not focus shell input',
    );
    await evaluate(shell, "window.ConsoleCanvasShell.show('editor')");
    await evaluate(shell, "document.querySelector('#show-settings').click()");
    await until(
      () => evaluate(shell, "document.body.dataset.view==='settings'"),
      'Settings not shown',
    );
    assert.equal(
      window.contentView.children.find((v) => v.webContents === editor).getVisible(),
      false,
    );
    assert.equal(await evaluate(shell, "document.querySelector('#settings-setup').hidden"), false);
    await evaluate(shell, "document.querySelector('#show-agent').click()");
    await until(
      () =>
        evaluate(shell, "document.querySelector('#mcp-command').value.includes('mcp/server.py')"),
      'Agent command missing',
    );
    await evaluate(shell, "document.querySelector('#copy-mcp').click()");
    await until(
      () =>
        evaluate(
          shell,
          "document.querySelector('#agent-result').textContent.includes('복사했습니다')",
        ),
      'Command copy failed',
    );
    assert.ok((await require('electron').clipboard.readText()).includes('mcp/server.py'));
    await evaluate(shell, "document.querySelector('#install-skill').click()");
    await until(
      () =>
        evaluate(
          shell,
          "!document.querySelector('#install-skill').disabled && document.querySelector('#agent-result').textContent.includes('설치했습니다')",
        ),
      'Skill install failed',
    );
    const originalSave = dialog.showSaveDialog;
    const skillFile = path.join(directory, 'saved-skill.zip');
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: skillFile });
    await evaluate(shell, "document.querySelector('#save-skill').click()");
    await until(
      () =>
        fs.stat(skillFile).then(
          (s) => s.size > 1000,
          () => false,
        ),
      'Skill ZIP save failed',
    );
    dialog.showSaveDialog = originalSave;
    const pngFile = path.join(directory, 'review.png');
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: pngFile });
    await evaluate(editor, "document.querySelector('#export-button').click()");
    await until(
      () =>
        evaluate(
          editor,
          "!document.querySelector('#download-review').disabled && !!document.querySelector('#handoff-preview img')",
        ),
      'Handoff PNG not ready',
    );
    await evaluate(editor, "document.querySelector('#download-review').click()");
    await until(
      () =>
        fs.stat(pngFile).then(
          (s) => s.size > 100,
          () => false,
        ),
      'Native PNG file not saved',
    );
    assert.deepEqual(
      [...(await fs.readFile(pngFile)).subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
    await evaluate(editor, "document.querySelector('#export-dialog').close()");
    dialog.showSaveDialog = originalSave;
    await evaluate(shell, "document.querySelector('.settings-back').click()");
    await until(
      () => evaluate(shell, "document.body.dataset.view==='settings'"),
      'Settings back failed',
    );
    await evaluate(shell, "document.querySelector('#show-update').click()");
    await until(
      () =>
        evaluate(
          shell,
          "document.body.dataset.view==='update' && document.querySelector('#update-version').textContent.includes('v')",
        ),
      'Update page missing',
    );
    assert.equal(
      await evaluate(
        shell,
        "document.querySelector('#download-update').hidden && document.querySelector('#install-update').hidden",
      ),
      true,
    );
    await evaluate(shell, "window.ConsoleCanvasShell.show('settings')");
    await evaluate(shell, "document.querySelector('#settings-return').click()");
    await until(
      () => evaluate(shell, "document.body.dataset.view==='editor'"),
      'Settings return lost editor',
    );
    // A failed capture must show its error and re-enable the button without a second renderer error.
    await source.loadURL('about:blank');
    await evaluate(shell, "document.querySelector('#show-source').click()");
    await until(() => evaluate(shell, "document.body.dataset.view==='source'"), 'Source not shown');
    await evaluate(shell, "document.querySelector('#capture').click()");
    await until(
      () =>
        evaluate(
          shell,
          "!document.querySelector('#capture').disabled && document.querySelector('#status').textContent.includes('HTTP')",
        ),
      'Capture failure did not recover',
    );
    await source.loadURL(
      await evaluate(shell, '(async()=> (await window.ConsoleCanvasShell.info()).demo_url)()'),
    );
    assert.equal(await evaluate(shell, "document.querySelector('#forward').disabled"), true);
    await evaluate(shell, "document.querySelector('#back').click()");
    await until(() => source.getURL() === 'about:blank', 'Back failed');
    await until(
      () => evaluate(shell, "!document.querySelector('#forward').disabled"),
      'Forward button not enabled',
    );
    await evaluate(shell, "document.querySelector('#forward').click()");
    await until(() => source.getURL().includes('/fixtures/console.html'), 'Forward failed');
    await evaluate(shell, "document.querySelector('#show-editor').click()");
    await evaluate(editor, "document.querySelector('#source-url').click()");
    await until(
      () => evaluate(shell, "document.body.dataset.view==='source'"),
      'Source URL did not open in app',
    );
    await evaluate(shell, "document.querySelector('#show-editor').click()");
    const historyNode = await evaluate(
      editor,
      `(() => { const a=window.ConsoleCanvas,n=[...a.state.scene.nodes.values()].find(n=>n.locator.id==='new-customer');a.selectNode(n.id);a.state.scene.nudge(9,4); document.activeElement?.blur(); return n.id; })()`,
    );
    const editMenu = require('electron')
      .Menu.getApplicationMenu()
      .items.find((item) => item.label === '편집').submenu;
    editMenu.items.find((item) => item.label === '실행 취소').click();
    await until(
      () =>
        evaluate(editor, `!window.ConsoleCanvas.state.scene.edits[${JSON.stringify(historyNode)}]`),
      'Native undo did not use canvas history',
    );
    editMenu.items.find((item) => item.label === '다시 실행').click();
    await until(
      () =>
        evaluate(
          editor,
          `window.ConsoleCanvas.state.scene.edits[${JSON.stringify(historyNode)}]?.dx===9`,
        ),
      'Native redo did not use canvas history',
    );
    await evaluate(editor, 'window.ConsoleCanvas.undo()');
    assert.equal(await evaluate(source, 'document.documentElement.outerHTML'), before);
    assert.equal(await evaluate(shell, "document.querySelector('#navigation').hidden"), true);
    assert.equal(editor.getOwnerBrowserWindow(), window);
    await fs.writeFile(
      path.join(directory, 'prepare-ready.json'),
      JSON.stringify({
        sandbox: true,
        chatgptIpc: true,
        chatgptProtectedStorage: protectedStorage.isEncryptionAvailable(),
        sourceUnchanged: true,
        reviewCapturePreservesTarget: true,
        reviewCancellation: true,
        addressCommand: true,
      }),
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
      `(async() => {
      const app=window.ConsoleCanvas,doc=document,node=[...app.state.scene.nodes.values()].find(n=>n.locator.id==='new-customer');
      app.selectNode(node.id);app.state.scene.setPosition(23,31);
      doc.querySelector('#component-comment').value='comment in saved snapshot';doc.querySelector('#save-comment').click();
      const copyId=app.state.scene.pasteSelection(app.state.scene.copySelection())[0];
      app.selectNode(node.id);
      const saved=app.snapshotHistory.create('refactor persistence');
      app.state.snapshot.documentName='종료 후 보존할 문서';app.snapshotHistory.rename(saved.id,'이름 바꾼 시안');
      const trashId=app.state.timeline.entries[0].id;app.snapshotHistory.trash(trashId);
      const db=await import('/db.js'),trashed=structuredClone(app.state.snapshot);trashed.id=crypto.randomUUID();
      await db.saveCapture(trashed);await db.saveSession(trashed.id,{note:'document trash survives quit',timeline:app.state.timeline});await db.trashDocument(trashed.id);
      doc.querySelector('#component-comment').value='draft saved on normal quit';doc.querySelector('#review-note').value='note saved on normal quit';
      const left=doc.querySelector('#resize-layers'),right=doc.querySelector('#resize-properties');
      left.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));right.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));
      for(let i=0;i<10;i++)left.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
      for(let i=0;i<12;i++)right.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
      return {document_id:app.state.snapshot.id,node:node.id,copyId,dx:23,dy:31,snapshotId:saved.id,trashId,trashedDocumentId:trashed.id,snapshots:app.state.timeline.entries.length};
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
      `(() => {const app=window.ConsoleCanvas;return {document_id:app.state.snapshot.id,documentName:app.state.snapshot.documentName,trash:app.snapshotHistory.list({deleted:true}),visible:app.snapshotHistory.list(),edits:app.state.scene.edits,annotations:app.state.scene.annotations,note:document.querySelector('#review-note').value,entries:app.state.timeline.entries.map(e=>e.id),active:app.state.timeline.activeId,panels:JSON.parse(localStorage.getItem('console-canvas-panels-v1'))};})()`,
    );
    assert.equal(actual.document_id, expected.document_id);
    assert.equal(actual.documentName, '종료 후 보존할 문서');
    const trashedDocument = await evaluate(
      editor,
      `(async()=>{const db=await import('/db.js');return {hidden:!(await db.getDocument(${JSON.stringify(expected.trashedDocumentId)})),value:await db.getDocument(${JSON.stringify(expected.trashedDocumentId)},{includeDeleted:true})};})()`,
    );
    assert.equal(trashedDocument.hidden, true);
    assert.equal(trashedDocument.value.note, 'document trash survives quit');
    assert.ok(trashedDocument.value.timeline.entries.some((e) => e.deletedAt));
    assert.ok(actual.trash.some((e) => e.id === expected.trashId));
    assert.ok(!actual.visible.some((e) => e.id === expected.trashId));
    assert.equal(actual.visible.find((e) => e.id === expected.snapshotId).name, '이름 바꾼 시안');
    assert.equal(actual.edits[expected.node].dx, expected.dx);
    assert.equal(actual.edits[expected.node].dy, expected.dy);
    assert.equal(actual.annotations[expected.node], 'draft saved on normal quit');
    assert.ok(actual.edits[expected.copyId].copy);
    assert.equal(actual.annotations[expected.copyId], 'comment in saved snapshot');
    assert.equal(
      await evaluate(
        editor,
        `window.ConsoleCanvas.state.scene.elements.has(${JSON.stringify(expected.copyId)})`,
      ),
      true,
    );
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
        snapshotTrash: true,
        documentTrash: true,
        documentName: true,
        panels: true,
        sandbox: true,
      }),
    );
  }
  if (phase === 'reopen' && !process.env.CONSOLE_CANVAS_OFFSCREEN) {
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
