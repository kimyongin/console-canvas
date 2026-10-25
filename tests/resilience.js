const frame = document.querySelector('#editor'),
  results = [];
function check(name, passed) {
  results.push({ name, passed: !!passed });
  document.querySelector('#results').textContent = results
    .map((r) => (r.passed ? 'PASS ' : 'FAIL ') + r.name)
    .join('\n');
  if (!passed) throw Error(name);
}
async function until(test) {
  const deadline = Date.now() + 20000;
  while (!test()) {
    if (Date.now() > deadline) throw Error('Timed out');
    await new Promise((r) => setTimeout(r, 30));
  }
}
try {
  await until(() => frame.contentWindow.ConsoleCanvas?.state.ready);
  const win = frame.contentWindow,
    doc = frame.contentDocument,
    app = win.ConsoleCanvas;
  const db = await import('../db.js');
  await app.state.saving;
  const initial = app.state.snapshot.id;
  const originalRevision = app.state.revision;
  for (const same of [false, true]) {
    const bad = structuredClone(app.state.snapshot);
    if (!same) bad.id = crypto.randomUUID();
    bad.timeline = { version: 999, entries: [] };
    let rejected = false;
    try {
      await app.importFile(new win.File([JSON.stringify(bad)], 'invalid.json'));
    } catch {
      rejected = true;
    }
    check(
      'Invalid timeline rejects ' + (same ? 'same' : 'new') + ' ID without replacing active UI',
      rejected &&
        app.state.ready &&
        app.state.snapshot.id === initial &&
        app.state.revision === originalRevision,
    );
    if (!same)
      check('Invalid document has no metadata record', !(await db.getDocumentMetadata(bad.id)));
  }
  const node = [...app.state.scene.nodes.values()].find((n) => n.locator.id === 'new-customer');
  app.selectNode(node.id);
  app.state.scene.setPosition(24, 0);
  const a = app.snapshotHistory.create('A');
  await app.state.saving;
  app.state.scene.setPosition(48, 0);
  await app.state.saving;
  const transaction = win.IDBDatabase.prototype.transaction;
  let backup;
  win.ConsoleCanvasDesktop = {
    saveFile: async (value) => {
      backup = JSON.parse(new TextDecoder().decode(value.bytes));
      return { path: 'test-backup.json' };
    },
  };
  win.IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
    if (mode === 'readwrite')
      throw new win.DOMException('Injected quota failure', 'QuotaExceededError');
    return transaction.call(this, stores, mode, ...rest);
  };
  doc.querySelector('#component-comment').value = 'latest draft during quota failure';
  doc.querySelector('#review-note').value = 'emergency note';
  doc.querySelector('#save-document').click();
  await until(() => !doc.querySelector('#save-document').disabled);
  check(
    'DB failure still downloads the latest memory edits and drafts',
    backup?.edits[node.id]?.dx === 48 &&
      backup.annotations[node.id] === 'latest draft during quota failure' &&
      backup.note === 'emergency note',
  );
  check(
    'Emergency file includes the complete timeline and reports DB error separately',
    backup.timeline.entries.some((e) => e.id === a.id) &&
      !!app.state.lastSaveError &&
      doc.querySelector('#toast').textContent.includes('긴급'),
  );
  const before = JSON.stringify({
    edits: app.state.scene.edits,
    annotations: app.state.scene.annotations,
    timeline: app.state.timeline,
    activity: app.state.activity,
    head: app.state.activityHead,
    revision: app.state.revision,
    undo: app.state.undo,
    redo: app.state.redo,
  });
  let failed = false;
  try {
    await app.snapshotHistory.restorePersisted(a.id);
  } catch {
    failed = true;
  }
  const after = JSON.stringify({
    edits: app.state.scene.edits,
    annotations: app.state.scene.annotations,
    timeline: app.state.timeline,
    activity: app.state.activity,
    head: app.state.activityHead,
    revision: app.state.revision,
    undo: app.state.undo,
    redo: app.state.redo,
  });
  check(
    'Failed snapshot persistence rolls back the complete UI/history/undo state',
    failed && before === after && !app.state.transactionBusy && !doc.body.inert,
  );
  win.IDBDatabase.prototype.transaction = transaction;
  delete win.ConsoleCanvasDesktop;
  const portable = structuredClone(backup);
  portable.snapshot.id = crypto.randomUUID();
  await app.importFile(new win.File([JSON.stringify(portable)], 'backup.uiclone.json'));
  check(
    'Emergency backup reopens with matching drafts and full branches',
    app.state.scene.edits[node.id]?.dx === 48 &&
      app.state.scene.annotations[node.id] === 'latest draft during quota failure' &&
      app.state.timeline.entries.length === backup.timeline.entries.length,
  );
  await app.snapshotHistory.restorePersisted(a.id);
  check(
    'Storage recovery allows a successful retry',
    app.state.scene.edits[node.id]?.dx === 24 && app.state.timeline.activeId === a.id,
  );
  await app.state.saving;
  document.querySelector('#status').textContent = JSON.stringify({
    passed: results.length,
    failed: 0,
    total: results.length,
  });
  document.body.dataset.result = 'pass';
} catch (error) {
  document.querySelector('#status').textContent = 'FAILED: ' + error.message;
  document.body.dataset.result = 'fail';
  console.error(error);
}
