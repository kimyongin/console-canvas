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
async function screenshot(window, name) {
  const directory = process.env.CONSOLE_CANVAS_GUIDE_CAPTURE_DIR;
  if (!directory) return;
  await fs.mkdir(directory, { recursive: true });
  const [width, height] = window.getContentSize();
  const child = window.contentView.children.find((v) => v.webContents && v.getVisible());
  const bounds = child?.getBounds(),
    top = bounds?.y || height;
  const header = (
    await window.webContents.capturePage({ x: 0, y: 0, width, height: top })
  ).toDataURL();
  const content = child ? (await child.webContents.capturePage()).toDataURL() : null;
  const png = await window.webContents.executeJavaScript(`(async()=>{
    const c=document.createElement('canvas');c.width=${width};c.height=${height};const x=c.getContext('2d');
    async function draw(src,left,top,w,h){const i=new Image();i.src=src;await i.decode();x.drawImage(i,left,top,w,h);}
    await draw(${JSON.stringify(header)},0,0,${width},${top});
    ${content ? `await draw(${JSON.stringify(content)},${bounds.x},${bounds.y},${bounds.width},${bounds.height});` : ''}
    return c.toDataURL('image/png');})()`);
  await fs.writeFile(path.join(directory, name + '.png'), Buffer.from(png.split(',')[1], 'base64'));
}
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
  const editor = await get('/editor.html');
  await until(
    () => evaluate(shell, 'typeof window.ConsoleCanvasShell!=="undefined"'),
    'Shell preload missing',
  );
  await until(
    () => evaluate(editor, '!!window.ConsoleCanvas?.projectWorkflow'),
    'Workspace missing',
  );
  if (phase === 'prepare') {
    await evaluate(
      shell,
      '(async()=>{ const a=window.ConsoleCanvasShell; const info=await a.info(); await a.navigate(info.demo_url); })()',
    );
  }
  const source = await get('/fixtures/console.html');
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
    await screenshot(window, '01-website');
    await evaluate(shell, "document.querySelector('#capture').click()");
    await until(
      () => evaluate(shell, "!document.querySelector('#project-setup').hidden"),
      'First-import project form missing',
    );
    await screenshot(window, '02-project');
    await evaluate(shell, "document.querySelector('#cancel-project').click()");
    assert.deepEqual(
      await evaluate(
        editor,
        `(async()=>({projects:(await(await import('/project-model.js')).listProjects()).length,tickets:(await(await import('/ticket-model.js')).listTickets()).total}))()`,
      ),
      { projects: 0, tickets: 0 },
    );
    await evaluate(shell, "document.querySelector('#capture').click()");
    await until(
      () => evaluate(shell, "!document.querySelector('#project-setup').hidden"),
      'Project form did not reopen',
    );
    await evaluate(
      shell,
      "document.querySelector('#new-project-name').value='QA 고객 콘솔';document.querySelector('#create-project-form').requestSubmit()",
    );
    await until(
      () =>
        evaluate(
          editor,
          '!!window.ConsoleCanvas?.state.ready&&!!window.ConsoleCanvas.state.mcpStatus.connected',
        ),
      'Capture/MCP missing',
    );
    assert.equal(await evaluate(source, 'document.documentElement.outerHTML'), before);
    const clipboard = require('electron').clipboard;
    const originalCopy = clipboard.writeText,
      copies = [];
    clipboard.writeText = (text) => {
      assert.equal(typeof text, 'string');
      copies.push(text);
    };
    try {
      await evaluate(
        shell,
        "window.ConsoleCanvasShell.workspace({action:'copy-handoff',intent:'read'})",
      );
      const projectId = await evaluate(editor, 'window.ConsoleCanvas.state.project_id');
      assert.ok(copies.at(-1).includes(projectId) && copies.at(-1).includes('조회만'));
      await evaluate(
        editor,
        "window.ConsoleCanvas.projectWorkflow.execute({action:'copy-handoff',intent:'implement',scope:'project'})",
      );
      assert.ok(copies.at(-1).includes('요청 시점'));
      await evaluate(editor, 'window.ConsoleCanvasDesktop.copyMcpCommand()');
      assert.ok(copies.at(-1).includes('mcp/server.py'));
      assert.equal(await evaluate(source, 'typeof window.ConsoleCanvasDesktop'), 'undefined');
    } finally {
      clipboard.writeText = originalCopy;
    }

    await evaluate(
      editor,
      `(async()=>{const a=window.ConsoleCanvas,n=[...a.state.scene.nodes.values()].find(n=>n.locator.id==='new-customer');a.selectNode(n.id);a.state.scene.setComment(n.id,'제목과 정렬하고 모바일에서는 전체 너비로 보여주세요.');await a.flushEditor();})()`,
    );
    const normalSize = window.getSize();
    const originalTitle = await evaluate(editor, 'window.ConsoleCanvas.state.ticket.title');
    await evaluate(
      shell,
      `window.ConsoleCanvasShell.workspace({action:'rename',name:${JSON.stringify('긴 프로젝트 이름 · '.repeat(7))}})`,
    );
    await evaluate(
      editor,
      `(async()=>{window.ConsoleCanvas.state.snapshot.documentName=${JSON.stringify('고객 등록과 검색 배치 개선 · '.repeat(5))};await window.ConsoleCanvas.flushEditor();})()`,
    );
    window.setSize(1000, 780);
    await until(() => evaluate(shell, 'innerWidth===1000'), 'Narrow window layout missing');
    const narrow = await evaluate(
      shell,
      `(()=>{const elements=[...document.querySelectorAll('.top button,.top select,.top nav')].filter(e=>!e.hidden&&e.getClientRects().length);return {overflow:document.documentElement.scrollWidth>innerWidth,controlsFit:elements.every(e=>e.getBoundingClientRect().left>=0&&e.getBoundingClientRect().right<=innerWidth)};})()`,
    );
    assert.equal(narrow.overflow, false);
    assert.equal(narrow.controlsFit, true);
    window.setSize(...normalSize);
    await evaluate(
      shell,
      "window.ConsoleCanvasShell.workspace({action:'rename',name:'QA 고객 콘솔'})",
    );
    await evaluate(
      editor,
      `(async()=>{window.ConsoleCanvas.state.snapshot.documentName=${JSON.stringify(originalTitle)};await window.ConsoleCanvas.flushEditor();})()`,
    );
    assert.equal(
      await evaluate(shell, 'document.querySelector(\'#shell-project option[value=""]\').disabled'),
      true,
    );
    await screenshot(window, '03-edit');
    if (process.env.CONSOLE_CANVAS_GUIDE_CAPTURE_DIR) {
      await evaluate(editor, 'window.ConsoleCanvas.confirmCurrentTicket()');
      await until(
        () => evaluate(shell, "document.querySelector('#shell-confirm').textContent==='확정됨'"),
        'Guide confirmation missing',
      );
      await screenshot(window, '04-confirmed');
      await evaluate(
        editor,
        `(async()=>{const a=window.ConsoleCanvas;a.state.scene.nudge(1,0);await a.flushEditor();})()`,
      );
    }

    const originalUrl = source.getURL();
    await evaluate(
      source,
      "document.querySelector('#customer-search').value='김민서';scrollTo(0,40)",
    );
    const sourceState = await evaluate(
      source,
      "({value:document.querySelector('#customer-search').value,y:scrollY})",
    );
    await evaluate(shell, "window.ConsoleCanvasShell.show('source')");
    await evaluate(shell, "window.ConsoleCanvasShell.workspace({action:'editor'})");
    await evaluate(shell, "window.ConsoleCanvasShell.show('source')");
    assert.equal(source.getURL(), originalUrl);
    assert.deepEqual(
      await evaluate(
        source,
        "({value:document.querySelector('#customer-search').value,y:scrollY})",
      ),
      sourceState,
    );
    const originalOpen = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    assert.equal(
      (await evaluate(shell, "window.ConsoleCanvasShell.workspace({action:'open-file'})")).canceled,
      true,
    );
    assert.equal((await evaluate(shell, 'window.ConsoleCanvasShell.info()')).view, 'source');
    const file = path.join(directory, 'new-ticket.uiclone.json');
    const incoming = await evaluate(
      editor,
      `(async()=>{const d=await window.ConsoleCanvas.exportDocument();d.capture.id=crypto.randomUUID();d.tickets[0].id=d.capture.id;d.tickets[0].document_id=d.capture.id;if(d.tickets[0].goal){d.tickets[0].goal.document_id=d.capture.id;d.tickets[0].goal.id=crypto.randomUUID();}d.tickets[0].title='파일 복원 확인';d.session.documentName='파일 복원 확인';return d;})()`,
    );
    await fs.writeFile(file, JSON.stringify(incoming));
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    const originalTicket = await evaluate(editor, 'window.ConsoleCanvas.state.snapshot.id');
    await evaluate(shell, "window.ConsoleCanvasShell.workspace({action:'open-file'})");
    assert.equal(
      await evaluate(editor, 'window.ConsoleCanvas.state.snapshot.id'),
      incoming.capture.id,
    );
    await evaluate(
      editor,
      `(async()=>{await window.ConsoleCanvas.openTicket(${JSON.stringify(originalTicket)});await(await import('/db.js')).trashDocument(${JSON.stringify(incoming.capture.id)});})()`,
    );
    dialog.showOpenDialog = originalOpen;

    await evaluate(
      editor,
      `(async()=>{const a=window.ConsoleCanvas, model=await import('/project-model.js'), db=await import('/db.js'); const primary=a.state.project_id; const other=await model.createProject('QA 다른 저장소'); const capture={...structuredClone(a.state.snapshot), id:crypto.randomUUID(), project_id:other.id}; await db.saveCapture(capture); await model.activeProject(primary); await a.ticketWorkspace.refreshProjects();})()`,
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
        scopedRequestClipboard: true,
        narrowHeader: true,
        firstImportCancel: true,
        sourceRoundTrip: true,
        fileOpenCancel: true,
        fileRestore: true,
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
      `(async()=>{const a=window.ConsoleCanvas,n=[...a.state.scene.nodes.values()].find(n=>n.locator.id==='new-customer');a.selectNode(n.id);a.state.scene.setPosition(23,31);a.state.scene.setComment(n.id,'제목과 정렬하고 모바일에서는 전체 너비로 배치해 주세요.');const copy=a.state.scene.pasteSelection(a.state.scene.copySelection())[0];document.querySelector('#review-note').value='버튼과 검색 영역의 간격을 정리해 주세요.';a.state.snapshot.documentName='고객 검색 개선';await a.flushEditor();await a.confirmCurrentTicket();const current=await(await import('/ticket-model.js')).getTicket(a.state.snapshot.id);const tickets=await(await import('/ticket-model.js')).listTickets(a.state.project_id);return {document_id:a.state.snapshot.id,node:n.id,copyId:copy,ticketId:tickets.tickets.find(t=>t.document_id===a.state.snapshot.id).id,project_id:a.state.project_id,goal_id:current.goal.id};})()`,
    );
    await until(
      () => evaluate(shell, "document.querySelector('#shell-confirm').textContent==='확정됨'"),
      'Confirmed header missing',
    );
    await evaluate(shell, "window.ConsoleCanvasShell.workspace({action:'tickets'})");
    await until(
      () => evaluate(editor, "!!document.querySelector('.ticket-compact-row')"),
      'Ticket catalog missing',
    );
    await screenshot(window, '05-tickets');
    await evaluate(shell, "window.ConsoleCanvasShell.workspace({action:'editor'})");
    await evaluate(
      editor,
      `window.ConsoleCanvas.openTicket(${JSON.stringify(expected.document_id)})`,
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
    assert.equal(actual.title, '고객 검색 개선');
    assert.equal(actual.edits[e.node].dx, 23);
    assert.equal(actual.edits[e.node].dy, 31);
    assert.ok(actual.edits[e.copyId].copy);
    assert.equal(
      actual.annotations[e.node],
      '제목과 정렬하고 모바일에서는 전체 너비로 배치해 주세요.',
    );
    assert.equal(actual.note, '버튼과 검색 영역의 간격을 정리해 주세요.');
    assert.equal(actual.ticket.status, 'queued');
    assert.equal(actual.ticket.needs_reconfirmation, false);
    assert.equal(actual.ticket.goal.id, e.goal_id);
    assert.ok(actual.ticket.records.length >= 4);
    await evaluate(shell, "window.ConsoleCanvasShell.workspace({action:'tickets'})");
    await until(
      () =>
        evaluate(editor, "!!document.querySelector('.ticket-compact-list .ticket-compact-row')"),
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
