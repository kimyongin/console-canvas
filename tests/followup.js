import { getDocument, saveCapture, saveSession, listDocuments } from '../db.js';
import { copy } from '../engine.js';
import { snapshotChangeCount } from '../ui/snapshot-delta.js';
const frame = document.querySelector('#editor'),
  results = [];
function check(name, passed) {
  results.push({ name, passed: !!passed });
  document.querySelector('#results').textContent = JSON.stringify(results, null, 2);
  if (!passed) throw new Error(name);
}
async function until(fn) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('Timed out');
}
try {
  await until(() => frame.contentWindow.ConsoleCanvas?.state.ready);
  const app = frame.contentWindow.ConsoleCanvas,
    doc = frame.contentDocument,
    win = frame.contentWindow,
    click = (q) => doc.querySelector(q).click();
  const node = [...app.state.scene.nodes.values()].find((n) => n.locator.id === 'new-customer'),
    other = [...app.state.scene.nodes.values()].find((n) => n.locator.id === 'export-customers');
  app.selectNode(node.id);
  click('#edit-properties');
  check(
    'Position controls precede collapsed metadata and secondary actions',
    !doc.querySelector('.inspector-details').open &&
      !doc.querySelector('.inspector-secondary').open &&
      doc.querySelector('#offset-x').getBoundingClientRect().top <
        doc.querySelector('.inspector-details').getBoundingClientRect().top,
  );
  click('#close-properties');
  app.state.scene.nudge(24, 16);
  app.state.scene.setComment(node.id, '첫 요청');
  app.state.scene.setComment(other.id, '둘째 요청');
  await app.state.saving;
  check(
    'Autosave and snapshot differences are separate',
    doc
      .querySelector('#save-status')
      .textContent.includes('자동 저장 완료 / 스냅샷 이후 변경 2건') &&
      snapshotChangeCount(app.state, '') === 2,
  );
  const baseline = app.snapshotHistory.create('비교 기준');
  await app.state.saving;
  check(
    'Saving snapshot resets delta without implying unsaved data',
    doc.querySelector('#save-status').textContent.includes('자동 저장 완료 / 스냅샷 이후 변경 0건'),
  );
  app.state.scene.nudge(0, 80);
  await app.state.saving;
  const before = JSON.stringify({
    edits: app.state.scene.edits,
    annotations: app.state.scene.annotations,
    timeline: app.state.timeline,
    revision: app.state.revision,
  });
  click('#snapshot-dropdown');
  await until(() => doc.querySelector('#snapshot-preview-view iframe'));
  click('#compare-button');
  await until(() => doc.querySelectorAll('.compare-view iframe').length === 2);
  check(
    'Comparison differences are above the views',
    doc.querySelector('#compare-diff').getBoundingClientRect().bottom <
      doc.querySelector('.compare-view').getBoundingClientRect().top &&
      doc.querySelector('#compare-diff').textContent.includes('1개'),
  );
  const zoom = doc.querySelector('#compare-zoom');
  zoom.value = '1';
  zoom.dispatchEvent(new win.Event('change'));
  await until(() =>
    [...doc.querySelectorAll('.compare-view iframe')].every(
      (e) => e.style.transform === 'scale(1)',
    ),
  );
  check(
    'Both comparison panes use readable common zoom',
    [...doc.querySelectorAll('.compare-view iframe')].every(
      (e) => e.style.transform === 'scale(1)',
    ),
  );
  const left = doc.querySelector('#compare-left-view'),
    right = doc.querySelector('#compare-right-view');
  left.scrollTop = 100;
  left.dispatchEvent(new win.Event('scroll'));
  await new Promise((r) => setTimeout(r, 80));
  check(
    'Comparison scrolls together',
    left.scrollTop > 0 && Math.abs(right.scrollTop - left.scrollTop) < 2,
  );
  const target = doc.querySelector('#compare-target');
  target.value = node.id;
  target.dispatchEvent(new win.Event('change'));
  check(
    'Difference navigation lists the changed target',
    target.options.length === 2 && target.value === node.id,
  );
  click('#compare-dialog .dialog-close');
  check(
    'Comparison never mutates editing state or revisions',
    before ===
      JSON.stringify({
        edits: app.state.scene.edits,
        annotations: app.state.scene.annotations,
        timeline: app.state.timeline,
        revision: app.state.revision,
      }),
  );
  click('#close-snapshots');
  app.selectNode(node.id);
  click('#edit-selected-comment');
  check(
    'Comment shows target crop, request number and Done',
    doc.querySelector('#comment-target-preview iframe') &&
      doc.querySelector('.target-crop-outline') &&
      doc.querySelector('#comment-progress').textContent === '요청 1 / 2' &&
      doc.querySelector('#save-comment').textContent === '완료' &&
      doc.querySelector('#comment-previous').disabled,
  );
  const field = doc.querySelector('#component-comment');
  field.value = '이전 이동 전 초안';
  field.dispatchEvent(new win.Event('input'));
  click('#comment-next');
  check(
    'Next request commits the pending draft without closing modal',
    app.state.scene.annotations[node.id] === '이전 이동 전 초안' &&
      doc.querySelector('#comment-dialog').open &&
      field.value === '둘째 요청' &&
      doc.querySelector('#comment-progress').textContent === '요청 2 / 2' &&
      doc.querySelector('#comment-next').disabled,
  );
  click('#comment-previous');
  check(
    'Previous request retains original ordering and content',
    field.value === '이전 이동 전 초안' &&
      doc.querySelector('#comment-progress').textContent === '요청 1 / 2',
  );
  click('#save-comment');
  await app.state.saving;
  app.selectNode(other.id);
  app.state.scene.remove(other.id);
  app.selectNode(other.id);
  click('#edit-selected-comment');
  check(
    'Deleted target retains reference preview',
    doc.querySelector('#comment-preview-label').textContent.includes('삭제 전 참고') &&
      doc.querySelector('#comment-target-preview iframe'),
  );
  click('#save-comment');
  const saved = await getDocument(app.state.snapshot.id),
    duplicate = copy(saved);
  duplicate.id = crypto.randomUUID();
  await saveCapture(duplicate);
  await saveSession(duplicate.id, {
    ...duplicate,
    timeline: { version: 1, activeId: baseline.id, entries: [{ ...baseline, name: '다른 배치' }] },
    annotations: { [node.id]: '복제 문서 요청' },
  });
  click('#document-menu-button');
  click('#documents-button');
  await until(() => doc.querySelectorAll('.document-thumbnail iframe').length >= 2);
  check(
    'Same-title documents have visual thumbnails and distinct snapshot context',
    doc.querySelectorAll('.document-thumbnail iframe').length >= 2 &&
      doc.querySelector('#document-list').textContent.includes('다른 배치') &&
      doc.querySelector('#document-list').textContent.includes('비교 기준') &&
      doc.querySelector('#document-list').textContent.includes('주석 2개'),
  );
  const rows = await listDocuments(100);
  check(
    'Document summary metadata stays lightweight',
    rows.every((r) => !r.html && !r.timeline && !r.nodes) &&
      rows.find((r) => r.id === duplicate.id).commentCount === 1,
  );
  click('#documents-dialog .dialog-close');
  const reopened = await getDocument(saved.id);
  await app.openSnapshot(reopened, reopened.edits, reopened.note, reopened.annotations);
  check(
    'Reopen preserves edits, comments, branches and snapshot names',
    app.state.scene.annotations[node.id] === '이전 이동 전 초안' &&
      app.state.timeline.entries.some((e) => e.name === '비교 기준') &&
      app.state.scene.hidden(other.id),
  );
  const transaction = win.IDBDatabase.prototype.transaction;
  win.IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
    if (mode === 'readwrite')
      throw new win.DOMException('Injected quota failure', 'QuotaExceededError');
    return transaction.call(this, stores, mode, ...rest);
  };
  click('#document-menu-button');
  click('#documents-button');
  await until(() =>
    doc.querySelector('#document-list-status').textContent.includes('자동 저장 실패'),
  );
  check(
    'Save failure does not hide documents or claim autosave success',
    doc.querySelectorAll('[data-document-card]').length >= 2 &&
      doc.querySelector('#save-status').textContent.includes('자동 저장 실패'),
  );
  click('#documents-dialog .dialog-close');
  win.IDBDatabase.prototype.transaction = transaction;
  document.querySelector('#status').textContent = results.length + ' UX followup checks passed';
  document.body.dataset.result = 'pass';
} catch (error) {
  document.querySelector('#status').textContent = error.stack;
  document.body.dataset.result = 'fail';
}
