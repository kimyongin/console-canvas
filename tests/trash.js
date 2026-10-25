import { reviewPayload } from '../export.js';
import { getDocument, getDocumentMetadata, listDocuments, saveSession, database } from '../db.js';
const frame = document.querySelector('#editor'),
  results = [];
function check(name, value) {
  results.push({ name, passed: !!value });
  document.querySelector('#results').textContent = JSON.stringify(results);
  if (!value) throw new Error(name);
}
async function until(read) {
  const end = Date.now() + 25000;
  while (Date.now() < end) {
    if (await read()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('Timed out');
}
try {
  await until(() => frame.contentWindow.ConsoleCanvas?.state.ready);
  let app = frame.contentWindow.ConsoleCanvas,
    doc = frame.contentDocument;
  const id = app.state.snapshot.id,
    originalTitle = app.state.snapshot.source.title,
    originalHtml = app.state.snapshot.html;
  const node = [...app.state.scene.nodes.values()].find((n) => n.locator.id === 'new-customer');
  const click = (q) => doc.querySelector(q).click();
  async function named(value) {
    await until(() => doc.querySelector('#rename-dialog').open);
    doc.querySelector('#rename-name').value = value;
    doc.querySelector('#rename-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await until(() => !doc.querySelector('#rename-dialog').open);
  }
  const card = (snapshotId) =>
    doc.querySelector('[data-snapshot-id="' + snapshotId + '"]')?.closest('.snapshot-card') ||
    doc.querySelector('[data-trashed-id="' + snapshotId + '"]');
  click('#documents-button');
  await until(() => doc.querySelector('[data-document-card="' + id + '"]'));
  click('[data-document-card="' + id + '"] [data-document-action="rename"]');
  await named('고객 화면 · 첫 시안');
  check(
    'Document rename updates metadata and editor labels without changing original capture',
    (await getDocumentMetadata(id)).title === '고객 화면 · 첫 시안' &&
      doc.querySelector('#source-title').textContent === '고객 화면 · 첫 시안' &&
      app.state.snapshot.source.title === originalTitle &&
      (await getDocument(id)).html === originalHtml,
  );
  click('#documents-dialog .dialog-close');
  click('#snapshot-dropdown');
  app.selectNode(node.id);
  app.state.scene.setPosition(12, 24);
  app.state.scene.setComment(node.id, '보존할 주석');
  const a = app.snapshotHistory.create('이전 버전');
  app.state.scene.nudge(40, 20);
  const b = app.snapshotHistory.create('미래 버전');
  const savedPoint = JSON.stringify(app.state.timeline.entries.find((e) => e.id === a.id).state);
  card(a.id).querySelector('[data-snapshot-action="rename"]').click();
  await named('검색 영역 정리');
  check(
    'Snapshot rename preserves saved contents, identity and descendant version links',
    app.state.timeline.entries.find((e) => e.id === a.id).name === '검색 영역 정리' &&
      JSON.stringify(app.state.timeline.entries.find((e) => e.id === a.id).state) === savedPoint &&
      app.state.timeline.entries.find((e) => e.id === b.id).parentId === a.id,
  );
  card(a.id).querySelector('[data-snapshot-action="trash"]').click();
  await until(() => app.state.timeline.entries.find((e) => e.id === a.id).deletedAt);
  click('#compare-button');
  const compareHasTrash = [...doc.querySelector('#compare-left').options].some(
    (o) => o.value === a.id,
  );
  doc.querySelector('#compare-dialog').close();
  check(
    'Trashing an ancestor hides it from navigation, MCP list and compare/export choices without removing future versions',
    !app.snapshotHistory.list().some((e) => e.id === a.id) &&
      app.snapshotHistory.list().some((e) => e.id === b.id) &&
      !compareHasTrash &&
      app.state.timeline.entries.find((e) => e.id === b.id).parentId === a.id,
  );
  let rejected = false;
  try {
    app.snapshotHistory.restore(a.id);
  } catch {
    rejected = true;
  }
  check('A trashed snapshot must be recovered before applying it', rejected);
  app.selectNode(node.id);
  doc.querySelector('#component-comment').value = '삭제 직전 주석 초안';
  doc.querySelector('#review-note').value = '삭제 직전 메모';
  const before = JSON.stringify(app.state.scene.edits);
  card(b.id).querySelector('[data-snapshot-action="trash"]').click();
  await until(() => app.state.timeline.activeId === null);
  check(
    'Trashing the active snapshot keeps current geometry and flushes comment/note drafts',
    JSON.stringify(app.state.scene.edits) === before &&
      app.state.scene.annotations[node.id] === '삭제 직전 주석 초안' &&
      doc.querySelector('#review-note').value === '삭제 직전 메모' &&
      app.state.timeline.entries.some((e) => e.id === b.id && e.deletedAt),
  );
  click('#snapshots-trash');
  check(
    'Snapshot trash exposes every recoverable version',
    doc.querySelectorAll('#snapshot-trash-list [data-snapshot-action="recover"]').length === 2,
  );
  const current = JSON.stringify(app.state.scene.edits);
  card(a.id).querySelector('[data-snapshot-action="recover"]').click();
  await until(() => !app.state.timeline.entries.find((e) => e.id === a.id).deletedAt);
  check(
    'Recovery returns snapshot to its list without applying its older geometry',
    JSON.stringify(app.state.scene.edits) === current && app.state.timeline.activeId === null,
  );
  click('#snapshots-live');
  card(a.id).querySelector('.snapshot-entry').click();
  click('#apply-snapshot');
  check(
    'A recovered snapshot applies its original saved geometry and comments',
    app.state.scene.edits[node.id].dx === 12 &&
      app.state.scene.annotations[node.id] === '보존할 주석',
  );
  const payload = reviewPayload(
    app.state.snapshot,
    app.state.scene,
    doc.querySelector('#review-note').value,
    app.state.timeline,
  );
  await app.importFile(
    new frame.contentWindow.File([JSON.stringify(payload)], 'trash.uiclone.json'),
  );
  check(
    'Edit file roundtrip retains document name, renamed snapshots and trash timestamps',
    app.state.snapshot.documentName === '고객 화면 · 첫 시안' &&
      app.state.timeline.entries.some((e) => e.id === a.id && e.name === '검색 영역 정리') &&
      app.state.timeline.entries.some((e) => e.id === b.id && e.deletedAt),
  );
  await app.state.saving;
  frame.src = '../editor.html?id=' + id;
  await new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  await until(() => frame.contentWindow.ConsoleCanvas?.state.ready);
  app = frame.contentWindow.ConsoleCanvas;
  doc = frame.contentDocument;
  check(
    'Reopening IndexedDB preserves renamed documents and snapshot trash',
    app.state.snapshot.documentName === '고객 화면 · 첫 시안' &&
      app.state.timeline.entries.some((e) => e.id === b.id && e.deletedAt),
  );
  app.selectNode(node.id);
  doc.querySelector('#component-comment').value = '문서 삭제 전 미저장 주석';
  doc.querySelector('#review-note').value = '문서 삭제 전 미저장 메모';
  click('#documents-button');
  await until(() => doc.querySelector('[data-document-card="' + id + '"]'));
  click('[data-document-card="' + id + '"] [data-document-action="trash"]');
  await until(() => !app.state.snapshot && !doc.querySelector('[data-document-id="' + id + '"]'));
  check(
    'Trashing the current document closes its editor and removes it from the MCP target',
    !app.state.ready &&
      app.controller.metadata() === null &&
      doc.querySelector('#artboard-space').hidden,
  );
  check(
    'Trashed documents are excluded from normal queries while their complete state remains recoverable',
    !(await getDocument(id)) &&
      !(await listDocuments(999)).some((d) => d.id === id) &&
      (await listDocuments(999, { deleted: true })).some((d) => d.id === id),
  );
  const trashed = await getDocument(id, { includeDeleted: true });
  check(
    'Document trash retains immutable capture, pending drafts and nested snapshot trash',
    trashed.html === originalHtml &&
      trashed.annotations[node.id] === '문서 삭제 전 미저장 주석' &&
      trashed.note === '문서 삭제 전 미저장 메모' &&
      trashed.timeline.entries.some((e) => e.id === b.id && e.deletedAt),
  );
  rejected = false;
  try {
    await saveSession(id, { note: 'stale overwrite' });
  } catch {
    rejected = true;
  }
  check(
    'A stale save cannot overwrite or resurrect a trashed document',
    rejected && (await getDocument(id, { includeDeleted: true })).note === trashed.note,
  );
  click('#documents-trash');
  await until(() =>
    doc.querySelector('[data-document-card="' + id + '"] [data-document-action="recover"]'),
  );
  click('[data-document-card="' + id + '"] [data-document-action="recover"]');
  await until(
    () =>
      !doc.querySelector('[data-document-card="' + id + '"]') &&
      !doc.querySelector('#documents-live').disabled,
  );
  check(
    'Document recovery preserves its name and does not open or apply a screen automatically',
    !app.state.snapshot && (await getDocumentMetadata(id)).title === '고객 화면 · 첫 시안',
  );
  click('#documents-live');
  await until(() => doc.querySelector('[data-document-id="' + id + '"]'));
  click('[data-document-id="' + id + '"]');
  await until(
    () =>
      app.state.ready &&
      app.state.snapshot.id === id &&
      !doc.querySelector('#documents-dialog').open,
  );
  check(
    'Opening a recovered document restores edits, pending comments, note and snapshot futures',
    app.state.scene.annotations[node.id] === trashed.annotations[node.id] &&
      doc.querySelector('#review-note').value === trashed.note &&
      app.state.timeline.entries.length === trashed.timeline.entries.length &&
      app.state.timeline.entries.some((e) => e.id === b.id && e.deletedAt),
  );
  app.state.scene.nudge(3, 2);
  app.snapshotHistory.trash(a.id);
  app.undo();
  check(
    'Undoing a canvas edit never reactivates a snapshot that is in the trash',
    app.state.timeline.activeId !== a.id &&
      app.state.timeline.entries.some((e) => e.id === a.id && e.deletedAt),
  );
  for (const e of [...app.snapshotHistory.list()]) app.snapshotHistory.trash(e.id);
  click('#snapshot-dropdown');
  check(
    'All versions can be trashed while the current editable work remains available',
    !app.snapshotHistory.list().length &&
      app.state.ready &&
      app.state.timeline.activeId === null &&
      doc.querySelector('#apply-snapshot').disabled,
  );
  const db = await database();
  const captureRecord = await new Promise((resolve, reject) => {
    const r = db.transaction(['captures']).objectStore('captures').get(id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  db.close();
  check(
    'Document naming and trash metadata never leak into immutable captures',
    !captureRecord.documentName &&
      !captureRecord.deletedAt &&
      captureRecord.source.title === originalTitle,
  );
  await app.state.saving;
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
