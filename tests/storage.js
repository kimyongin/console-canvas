import {
  database,
  saveCapture,
  saveSession,
  getDocument,
  listDocuments,
  renameDocument,
  trashDocument,
  restoreDocument,
} from '../db.js';
const results = [];
function check(name, value) {
  results.push({ name, passed: !!value });
  document.querySelector('#results').textContent = JSON.stringify(results, null, 2);
  if (!value) throw new Error(name);
}
async function openEditor() {
  const frame = document.querySelector('#editor');
  frame.src = '../editor.html?sample=1';
  const deadline = Date.now() + 20000;
  while (!frame.contentWindow.ConsoleCanvas?.state.ready) {
    if (Date.now() > deadline) throw new Error('Editor not ready');
    await new Promise((r) => setTimeout(r, 50));
  }
  return { app: frame.contentWindow.ConsoleCanvas, doc: frame.contentDocument };
}
try {
  const capture = await (await fetch('../sample.uiclone.json')).json();
  capture.id = crypto.randomUUID();
  await saveCapture(capture);
  const original = capture.html;
  capture.html = 'this replacement must never be written';
  check(
    'Saving the same capture never rewrites immutable HTML',
    (await saveCapture(capture)) === false,
  );
  await saveSession(capture.id, {
    edits: { n1: { dx: 25, dy: 9, deleted: false } },
    annotations: { n1: 'keep' },
    project_id: 'storage-regression',
    note: 'draft',
    updatedAt: '2099-01-01T00:00:00.000Z',
  });
  const joined = await getDocument(capture.id);
  check(
    'Capture and mutable state join with current project and comments',
    joined.html === original &&
      joined.edits.n1.dx === 25 &&
      joined.annotations.n1 === 'keep' &&
      joined.project_id === 'storage-regression',
  );
  const recent = await listDocuments(1);
  check(
    'Recent documents query returns only bounded metadata',
    recent.length === 1 &&
      recent[0].id === capture.id &&
      !('html' in recent[0]) &&
      !('nodes' in recent[0]) &&
      !('edits' in recent[0]),
  );
  const db = await database();
  check(
    'Captures, sessions and document metadata have separate stores',
    ['captures', 'sessions', 'documents'].every((name) => db.objectStoreNames.contains(name)),
  );
  db.close();
  await renameDocument(capture.id, '이름을 바꾼 현재 문서');
  check(
    'Rename keeps immutable source, edits and comments',
    (await getDocument(capture.id)).documentName === '이름을 바꾼 현재 문서' &&
      (await getDocument(capture.id)).html === original,
  );
  await trashDocument(capture.id);
  check(
    'Trashed documents leave the normal list but remain recoverable',
    !(await getDocument(capture.id)) &&
      (await listDocuments(100, { deleted: true })).some((d) => d.id === capture.id),
  );
  let deletedSaveRejected = false;
  try {
    await saveSession(capture.id, { note: 'must not resurrect' });
  } catch {
    deletedSaveRejected = true;
  }
  check(
    'A delayed save cannot resurrect a trashed document',
    deletedSaveRejected &&
      (await getDocument(capture.id, { includeDeleted: true })).note === 'draft',
  );
  await restoreDocument(capture.id);
  check(
    'Restore preserves edits and current annotations',
    (await getDocument(capture.id)).edits.n1.dx === 25 &&
      (await getDocument(capture.id)).annotations.n1 === 'keep',
  );
  let rejected = false;
  try {
    await saveSession('missing', { updatedAt: 'now' });
  } catch {
    rejected = true;
  }
  check('An orphan session fails atomically', rejected && !(await getDocument('missing')));
  const { app, doc } = await openEditor(),
    oldId = app.state.snapshot.id;
  const node = [...app.state.scene.nodes.values()].find((n) => n.tag === 'button');
  app.selectNode(node.id);
  doc.querySelector('#component-comment').value = 'unfinished comment before switching';
  doc.querySelector('#review-note').value = 'unfinished note';
  const next = structuredClone(app.state.snapshot);
  next.id = crypto.randomUUID();
  await app.openSnapshot(next);
  const previous = await getDocument(oldId);
  check(
    'Switching captures flushes comment and note drafts before mounting the next one',
    previous.annotations[node.id] === 'unfinished comment before switching' &&
      previous.note === 'unfinished note' &&
      app.state.snapshot.id === next.id,
  );
  const a = structuredClone(next),
    b = structuredClone(next);
  a.id = crypto.randomUUID();
  b.id = crypto.randomUUID();
  await Promise.all([app.openSnapshot(a), app.openSnapshot(b)]);
  check(
    'Concurrent document-open requests are serialized',
    app.state.ready && app.state.snapshot.id === b.id,
  );
  // Exercise the retained document-name UI against current v2 storage.
  doc.querySelector('#rename-current').click();
  const until = async (read) => {
    const end = Date.now() + 15000;
    while (!(await read())) {
      if (Date.now() > end) throw Error('UI persistence timeout');
      await new Promise((r) => setTimeout(r, 30));
    }
  };
  await until(() => doc.querySelector('#rename-dialog').open);
  doc.querySelector('#rename-name').value = 'UI 이름 변경';
  doc
    .querySelector('#rename-form')
    .dispatchEvent(new doc.defaultView.Event('submit', { cancelable: true, bubbles: true }));
  await until(() => !doc.querySelector('#rename-dialog').open);
  await app.flushEditor();
  check(
    'Document rename UI saves the intended title',
    (await getDocument(app.state.snapshot.id)).documentName === 'UI 이름 변경',
  );
  await saveSession(capture.id, { ...joined, updatedAt: '2000-01-01T00:00:00.000Z' });
  document.querySelector('#status').textContent = JSON.stringify({
    passed: results.length,
    failed: 0,
    total: results.length,
  });
  document.body.dataset.result = 'pass';
} catch (error) {
  document.querySelector('#status').textContent = 'FAILED: ' + error.stack;
  document.body.dataset.result = 'fail';
}
