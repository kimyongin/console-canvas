// Native integration: isolated app profile, skill directory and authenticated broker.
const { app, BrowserWindow, dialog, Menu } = require('electron');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const directory = process.env.CONSOLE_CANVAS_TEST_DIR;
if (!directory) throw Error('Run scripts/check-desktop.mjs');
app.setPath('userData', path.join(directory, 'profile'));
const phase = process.env.CONSOLE_CANVAS_TEST_PHASE,
  appRoot = process.env.CONSOLE_CANVAS_TEST_APP_ROOT || path.resolve(__dirname, '..');
app.on('browser-window-created', (_e, w) => {
  if (!process.env.CONSOLE_CANVAS_VISIBLE_TEST) w.hide();
});
dialog.showErrorBox = (title, message) => {
  console.error(title + ': ' + message);
  app.exit(1);
};
require(path.join(appRoot, 'desktop/main.cjs'));
async function until(read, message, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = await read();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error(message);
}
const evaluate = (wc, code) => wc.executeJavaScript(code);
async function main() {
  await app.whenReady();
  const window = await until(() => BrowserWindow.getAllWindows()[0], 'Window missing'),
    shell = window.webContents;
  const get = async (part) =>
    until(
      () =>
        window.contentView.children.find((v) => v.webContents?.getURL().includes(part))
          ?.webContents,
      'Missing ' + part,
    );
  const editor = await get('/editor.html'),
    source = await get('/fixtures/console.html');
  await until(
    () => evaluate(shell, 'typeof window.ConsoleCanvasShell!=="undefined"'),
    'Shell preload missing',
  );
  for (const wc of [source, editor, shell]) {
    const p = wc.getLastWebPreferences();
    assert.equal(p.nodeIntegration, false);
    assert.equal(p.contextIsolation, true);
    assert.equal(p.sandbox, true);
  }
  assert.equal(await evaluate(source, 'typeof window.ConsoleCanvasDesktop'), 'undefined');
  assert.equal(await evaluate(editor, 'typeof window.ConsoleCanvasDesktop.chatgpt'), 'undefined');
  assert.equal(
    await evaluate(editor, 'typeof window.ConsoleCanvasDesktop.beginReviewCapture'),
    'undefined',
  );
  if (phase === 'prepare') {
    const before = await evaluate(source, 'document.documentElement.outerHTML');
    await evaluate(shell, 'window.ConsoleCanvasShell.capture()');
    await until(
      () =>
        evaluate(
          editor,
          '!!window.ConsoleCanvas?.state.ready&&!!window.ConsoleCanvas.state.mcpStatus.connected',
        ),
      'Capture/MCP missing',
    );
    assert.equal(await evaluate(source, 'document.documentElement.outerHTML'), before);
    await evaluate(
      editor,
      "(async()=>{const m=await import('/db.js');await m.setProjectAccess(window.ConsoleCanvas.state.project_id,true);await window.ConsoleCanvas.ticketWorkspace.permissions();})()",
    );
    const originalSave = dialog.showSaveDialog;
    const pngFile = path.join(directory, 'current-goal.png');
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: pngFile });
    await evaluate(editor, "document.querySelector('#export-button').click()");
    await until(
      () =>
        fs.stat(pngFile).then(
          (s) => s.size > 100,
          () => false,
        ),
      'Native image save missing',
    );
    assert.deepEqual(
      [...(await fs.readFile(pngFile)).subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
    dialog.showSaveDialog = originalSave;
    await evaluate(shell, "window.ConsoleCanvasShell.show('agent')");
    await until(
      () => evaluate(shell, "!document.querySelector('#install-skill').disabled"),
      'Skill button missing',
    );
    await evaluate(shell, "document.querySelector('#install-skill').click()");
    await until(
      () =>
        evaluate(
          shell,
          "document.querySelector('#agent-result').textContent.includes('설치했습니다')",
        ),
      'Skill install missing',
    );
    const installed = await fs.readFile(
      path.join(process.env.CONSOLE_CANVAS_SKILL_DIR, 'SKILL.md'),
      'utf8',
    );
    assert.ok(
      installed.includes('confirm_ticket_goal') && !installed.includes('register_ai_candidate'),
    );
    await evaluate(shell, "window.ConsoleCanvasShell.show('editor')");
    await fs.writeFile(
      path.join(directory, 'prepare-ready.json'),
      JSON.stringify({
        sandbox: true,
        sourceUnchanged: true,
        retiredIpcAbsent: true,
        nativePng: true,
        installedSkill: true,
      }),
    );
    await until(
      () =>
        fs.access(path.join(directory, 'sdk-complete')).then(
          () => true,
          () => false,
        ),
      'SDK missing',
      120000,
    );
    const expected = await evaluate(
      editor,
      `(async()=>{const a=window.ConsoleCanvas,n=[...a.state.scene.nodes.values()].find(n=>n.locator.id==='new-customer');a.selectNode(n.id);a.state.scene.setPosition(23,31);a.state.scene.setComment(n.id,'native persisted comment');const copy=a.state.scene.pasteSelection(a.state.scene.copySelection())[0];document.querySelector('#review-note').value='native persisted note';a.state.snapshot.documentName='새 흐름 재실행 검증';await a.flushEditor();const tickets=await(await import('/ticket-model.js')).listTickets(a.state.project_id);return {document_id:a.state.snapshot.id,node:n.id,copyId:copy,ticketId:tickets.tickets.find(t=>t.document_id===a.state.snapshot.id).id,project_id:a.state.project_id};})()`,
    );
    await fs.writeFile(path.join(directory, 'expected.json'), JSON.stringify(expected));
  } else {
    await until(
      () =>
        evaluate(
          editor,
          '!!window.ConsoleCanvas?.state.ready&&!!window.ConsoleCanvas.state.mcpStatus.connected',
        ),
      'Reopened editor/MCP missing',
    );
    const e = JSON.parse(await fs.readFile(path.join(directory, 'expected.json')));
    const actual = await evaluate(
      editor,
      `(async()=>{const a=window.ConsoleCanvas,t=await(await import('/ticket-model.js')).getTicket(${JSON.stringify(e.ticketId)},${JSON.stringify(e.project_id)});return {id:a.state.snapshot.id,title:a.state.snapshot.documentName,edits:a.state.scene.edits,annotations:a.state.scene.annotations,note:document.querySelector('#review-note').value,ticket:t};})()`,
    );
    assert.equal(actual.id, e.document_id);
    assert.equal(actual.title, '새 흐름 재실행 검증');
    assert.equal(actual.edits[e.node].dx, 23);
    assert.equal(actual.edits[e.node].dy, 31);
    assert.ok(actual.edits[e.copyId].copy);
    assert.equal(actual.annotations[e.node], 'native persisted comment');
    assert.equal(actual.note, 'native persisted note');
    assert.equal(actual.ticket.status, 'queued');
    assert.ok(actual.ticket.records.length >= 4);
    await evaluate(editor, "document.querySelector('#tickets-button').click()");
    await until(
      () => evaluate(editor, "!!document.querySelector('#ticket-list .ticket-row')"),
      'Reopened ticket list missing',
    );
    await fs.writeFile(
      path.join(directory, 'reopen-ready.json'),
      JSON.stringify({
        restored: true,
        comments: true,
        copies: true,
        fixedGoal: true,
        ticketRecords: true,
        mcp: true,
        retiredIpcAbsent: true,
      }),
    );
  }
  window.close();
}
main().catch((e) => {
  console.error(e);
  app.exit(1);
});
