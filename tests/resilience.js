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
  const node = [...app.state.scene.nodes.values()].find((n) => n.locator.id === 'new-customer');
  app.selectNode(node.id);
  doc.querySelector('#component-comment').value = 'uncommitted draft';
  const inputSignature = async () =>
    JSON.stringify({
      selected: app.state.scene.selected,
      draft: doc.querySelector('#component-comment').value,
      metadata: app.controller.metadata(),
      persisted: await db.getDocument(initial),
    });
  const inputBefore = await inputSignature();
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
    check(
      'Invalid input preserves selection, draft, MCP and stored session for ' +
        (same ? 'same' : 'new') +
        ' ID',
      (await inputSignature()) === inputBefore,
    );
  }
  const badCopy = structuredClone(app.state.snapshot);
  badCopy.edits = { n999999: { copy: { nodes: [] } } };
  let copyRejected = false;
  try {
    await app.importFile(new win.File([JSON.stringify(badCopy)], 'bad-copy.json'));
  } catch {
    copyRejected = true;
  }
  check(
    'Malformed copy input leaves the active document and DB untouched',
    copyRejected && (await inputSignature()) === inputBefore,
  );
  doc.querySelector('#component-comment').value = '';
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
  win.ConsoleCanvasDesktop.saveFile = async () => ({ canceled: true });
  doc.querySelector('#save-document').click();
  await until(() => !doc.querySelector('#save-document').disabled);
  check(
    'Cancelling an emergency backup keeps the DB error visible',
    !!app.state.lastSaveError && doc.querySelector('#toast').textContent.includes('취소'),
  );
  win.ConsoleCanvasDesktop.saveFile = async () => {
    throw Error('Injected file write failure');
  };
  doc.querySelector('#save-document').click();
  await until(() => !doc.querySelector('#save-document').disabled);
  check(
    'File write failure is reported without clearing the DB error',
    !!app.state.lastSaveError &&
      doc.querySelector('#toast').textContent.includes('Injected file write failure'),
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
  const mcp = await app.controller.execute({
    name: 'restore_snapshot',
    arguments: {
      editor_id: app.controller.metadata().editor_id,
      expected_revision: app.state.revision,
      snapshot_id: a.id,
    },
    document_id: initial,
    deadline: Date.now() / 1000 + 30,
  });
  check(
    'MCP restoration reports snapshot_error and leaves the protected work unchanged',
    !mcp.ok &&
      mcp.error.code === 'snapshot_error' &&
      app.state.scene.edits[node.id].dx === 48 &&
      app.state.timeline.activeId === a.id &&
      app.state.revision === JSON.parse(before).revision,
  );
  app.snapshotHistory.trash(a.id);
  await app.state.saving;
  let recoveryFailed = false;
  try {
    await app.snapshotHistory.restorePersisted(a.id, {}, { recover: true });
  } catch {
    recoveryFailed = true;
  }
  check(
    'Failed recover-and-apply keeps the snapshot in trash and current work intact',
    recoveryFailed &&
      !!app.state.timeline.entries.find((e) => e.id === a.id).deletedAt &&
      app.state.scene.edits[node.id].dx === 48 &&
      !app.state.transactionBusy,
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
  // A clipboard permission failure must preserve the already generated handoff.
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(win.navigator, 'clipboard');
  Object.defineProperty(win.navigator, 'clipboard', {
    configurable: true,
    value: {
      write: async () => {
        throw new Error('Injected clipboard permission denial');
      },
    },
  });
  let fallbackPng;
  win.ConsoleCanvasDesktop = {
    saveFile: async (value) => {
      fallbackPng = value;
      return { path: 'fallback.png' };
    },
  };
  doc.querySelector('#export-button').click();
  await until(
    () => !doc.querySelector('#copy-summary').disabled && doc.querySelector('#handoff-preview img'),
  );
  const preview = doc.querySelector('#handoff-preview img').src;
  doc.querySelector('#copy-summary').click();
  await until(() => doc.querySelector('#export-status').textContent.includes('Injected clipboard'));
  check(
    'Clipboard denial keeps the generated preview and exposes the PNG fallback',
    doc.querySelector('#handoff-preview img').src === preview &&
      !doc.querySelector('#download-review').disabled &&
      doc.querySelector('#export-status').textContent.includes('전달 이미지 저장'),
  );
  doc.querySelector('#download-review').click();
  await until(() => fallbackPng && !doc.querySelector('#download-review').disabled);
  check(
    'One fallback save delivers actual PNG bytes without rebuilding the request',
    JSON.stringify([...new Uint8Array(fallbackPng.bytes).subarray(0, 8)]) ===
      '[137,80,78,71,13,10,26,10]' &&
      doc.querySelector('#handoff-preview img').src === preview &&
      doc.querySelector('#export-status').textContent.includes('저장했습니다'),
  );
  doc.querySelector('#export-dialog').close();
  if (clipboardDescriptor) Object.defineProperty(win.navigator, 'clipboard', clipboardDescriptor);
  else delete win.navigator.clipboard;
  delete win.ConsoleCanvasDesktop;
  const timeline = structuredClone(app.state.timeline);
  const parent = timeline.entries[0].id;
  while (app.state.timeline.entries.length < 500) {
    app.state.timeline.entries.push({
      ...structuredClone(timeline.entries[0]),
      id: 'limit-' + app.state.timeline.entries.length,
      parentId: parent,
      kind: 'manual',
    });
  }
  app.state.scene.setPosition(99, 0);
  await app.state.saving;
  const limitBefore = JSON.stringify([app.state.timeline, app.state.revision, app.state.undo]);
  let limitRejected = false;
  try {
    await app.snapshotHistory.restorePersisted(parent);
  } catch (error) {
    limitRejected = error.message.includes('500');
  }
  check(
    'Snapshot limit refuses navigation without losing unsaved work or history',
    limitRejected &&
      app.state.scene.edits[node.id].dx === 99 &&
      JSON.stringify([app.state.timeline, app.state.revision, app.state.undo]) === limitBefore,
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
