import { getDocument } from '../db.js';
const frame = document.querySelector('#editor'),
  results = [];
function check(name, passed) {
  results.push({ name, passed: !!passed });
  document.querySelector('#results').textContent = JSON.stringify(results);
  if (!passed) throw new Error(name);
}
async function until(read) {
  const end = Date.now() + 25000;
  while (Date.now() < end) {
    if (await read()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error('Timed out');
}
try {
  await until(() => frame.contentWindow.ConsoleCanvas?.state.ready);
  const win = frame.contentWindow,
    doc = frame.contentDocument,
    app = win.ConsoleCanvas,
    click = (q) => doc.querySelector(q).click(),
    id = app.state.snapshot.id,
    node = [...app.state.scene.nodes.values()].find((n) => n.locator.id === 'new-customer');
  click('#toggle-layers');
  click('#document-menu-button');
  check(
    'Document menu stays visible with layers closed and exposes file backup and document management',
    doc.querySelector('#document-menu-content').matches(':popover-open') &&
      doc.querySelector('#document-menu-button').getBoundingClientRect().width > 0 &&
      !doc.querySelector('#save-document').disabled &&
      !doc.querySelector('#layers-panel').contains(doc.querySelector('#source-title')),
  );
  doc.querySelector('#document-menu-content').hidePopover();
  app.selectNode(node.id);
  click('#edit-selected-comment');
  const field = doc.querySelector('#component-comment');
  field.value = '저장 전 주석 초안';
  field.dispatchEvent(new win.Event('input', { bubbles: true }));
  click('#comment-mode');
  click('#comment-mode');
  check(
    'Comment mode is explicit and clicking it again does not silently switch modes',
    app.state.mode === 'comment' &&
      doc.querySelector('#select-mode').getAttribute('aria-pressed') === 'false',
  );
  field.dispatchEvent(
    new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  check(
    'Escape from a comment input saves the draft and returns to selection mode',
    app.state.mode === 'edit' &&
      app.state.scene.annotations[node.id] === '저장 전 주석 초안' &&
      doc.querySelector('#select-mode').getAttribute('aria-pressed') === 'true',
  );
  click('#tab-inspect');
  check(
    'Properties prioritize geometry and show a concise comment link, with editing on the comments tab',
    !doc.querySelector('#inspect-panel').contains(field) &&
      !doc.querySelector('#direct-edit-controls').hidden &&
      doc.querySelector('#selected-comment-summary').textContent.includes('주석 초안'),
  );
  app.state.scene.nudge(16, 8);
  const snapshot = app.snapshotHistory.create('배치 검증');
  click('#snapshots-button');
  const card = () =>
    doc.querySelector('[data-snapshot-id="' + snapshot.id + '"]').closest('.snapshot-card');
  card().querySelector('.more-actions').click();
  const popover = card().querySelector('[popover]');
  check(
    'Snapshot management opens a top-layer menu with initial keyboard focus',
    popover.matches(':popover-open') && popover.contains(doc.activeElement),
  );
  popover.dispatchEvent(
    new win.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
  );
  check(
    'Keyboard navigation reaches the last destructive menu action',
    doc.activeElement.dataset.snapshotAction === 'trash',
  );
  popover.dispatchEvent(
    new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  check(
    'Escape closes only the action menu and returns focus to its trigger',
    !popover.matches(':popover-open') &&
      doc.activeElement === card().querySelector('.more-actions') &&
      !doc.querySelector('#snapshot-panel').hidden,
  );
  card().querySelector('[data-snapshot-action="trash"]').click();
  await until(() => doc.querySelector('#toast-action'));
  click('#toast-action');
  await until(() => !app.state.timeline.entries.find((e) => e.id === snapshot.id).deletedAt);
  check(
    'Snapshot deletion can be reversed without changing current edits',
    app.state.scene.edits[node.id].dx === 16,
  );
  card().querySelector('[data-snapshot-action="trash"]').click();
  await until(() => !app.snapshotHistory.list().some((e) => e.id === snapshot.id));
  click('#snapshots-trash');
  check(
    'Trash hides snapshot creation, navigation and compare, leaving restore actions',
    doc.querySelector('#snapshot-tools').hidden &&
      card().querySelector('[data-snapshot-action="recover-apply"]'),
  );
  app.selectNode(node.id);
  app.state.scene.nudge(5, 0);
  card().querySelector('[data-snapshot-action="recover-apply"]').click();
  await until(() => app.state.timeline.activeId === snapshot.id);
  check(
    'Recover and apply restores the saved version and preserves newer work automatically',
    app.state.scene.edits[node.id].dx === 16 &&
      app.state.timeline.entries.some(
        (e) => e.kind === 'automatic' && e.state.edits[node.id]?.dx === 21,
      ),
  );
  click('#toggle-properties');
  check(
    'Global snapshot state follows panel visibility',
    doc.querySelector('#snapshots-button').getAttribute('aria-expanded') === 'false',
  );
  click('#snapshots-button');
  check(
    'Global snapshot button always opens versions instead of unexpectedly switching to properties',
    !doc.querySelector('#snapshot-panel').hidden &&
      doc.querySelector('#snapshots-button').getAttribute('aria-expanded') === 'true' &&
      !doc.querySelector('#close-snapshots'),
  );
  let saved;
  win.ConsoleCanvasDesktop = {
    saveFile: async (value) => {
      saved = JSON.parse(new TextDecoder().decode(value.bytes));
      return { path: 'test-only.uiclone.json' };
    },
  };
  doc.querySelector('#review-note').value = '백업할 문서 설명';
  click('#save-document');
  await until(() => saved);
  check(
    'Document backup saves current comments, note, edits and complete snapshot futures without opening handoff',
    saved.note === '백업할 문서 설명' &&
      saved.annotations[node.id] === '저장 전 주석 초안' &&
      saved.timeline.entries.length === app.state.timeline.entries.length &&
      !doc.querySelector('#export-dialog').open,
  );
  delete win.ConsoleCanvasDesktop;
  click('#documents-button');
  await until(() => doc.querySelector('[data-document-card="' + id + '"]'));
  click('[data-document-card="' + id + '"] [data-document-action="trash"]');
  await until(() => !app.state.snapshot && !doc.querySelector('#documents-live').disabled);
  check(
    'Document undo feedback remains operable inside the modal rather than becoming inert',
    doc.querySelector('#documents-dialog').contains(doc.querySelector('#toast-action')),
  );
  check(
    'Closing the last document removes invalid snapshot actions and stale counts',
    doc.querySelector('#snapshot-tools').hidden &&
      doc.querySelector('#save-snapshot').disabled &&
      doc.querySelector('#next-snapshot').disabled &&
      doc.querySelector('#snapshots-live').textContent === '저장된 버전 0',
  );
  click('#toast-action');
  await until(
    () =>
      app.state.ready &&
      app.state.snapshot?.id === id &&
      !doc.querySelector('#documents-dialog').open,
  );
  check(
    'Undoing current-document deletion restores and reopens the saved work',
    app.state.scene.annotations[node.id] === '저장 전 주석 초안' &&
      doc.querySelector('#review-note').value === '백업할 문서 설명',
  );
  click('#trash-current');
  await until(() => !app.state.snapshot);
  click('#documents-trash-button');
  await until(() => doc.querySelector('[data-document-action="recover-open"]'));
  click('[data-document-card="' + id + '"] [data-document-action="recover-open"]');
  await until(() => app.state.ready && !doc.querySelector('#documents-dialog').open);
  check(
    'Recover and open reaches the actual document in one action and retains snapshots',
    app.state.snapshot.id === id &&
      (await getDocument(id)).timeline.entries.length === saved.timeline.entries.length,
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
