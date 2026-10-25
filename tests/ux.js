import { reviewPayload } from '../export.js';
const frame = document.querySelector('#editor'),
  results = [];
function check(name, value) {
  results.push({ name, passed: !!value });
  document.querySelector('#results').textContent = JSON.stringify(results, null, 2);
  if (!value) throw new Error(name);
}
async function until(read) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (await read()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Timed out waiting for workflow');
}
try {
  await until(() => frame.contentWindow.ConsoleCanvas?.state.ready);
  const app = frame.contentWindow.ConsoleCanvas,
    doc = frame.contentDocument,
    scene = app.state.scene,
    click = (id) => doc.querySelector('#' + id).click();
  const first = [...scene.nodes.values()].find((n) => n.locator.id === 'new-customer'),
    second = [...scene.nodes.values()].find((n) => n.tag === 'button' && n.name === '내보내기'),
    text = (scene.children.get(first.id) || []).find((n) => n.kind === 'text');
  check(
    'Document details are compact and file/connection controls live outside the editing toolbar',
    !doc.querySelector('#document-menu-content').matches(':popover-open') &&
      !doc.querySelector('.canvas-toolbar').contains(doc.querySelector('#import-button')) &&
      !doc.querySelector('.canvas-toolbar').contains(doc.querySelector('#mcp-button')),
  );
  check(
    'Normal pointer selection finds a button while Alt retains access to its text',
    scene.targetId({ target: scene.elements.get(text.id) }) === first.id &&
      scene.targetId({ target: scene.elements.get(text.id), altKey: true }) === text.id,
  );
  app.selectNode(first.id);
  check(
    'Inspector shows readable labels and clickable parent breadcrumbs',
    doc.querySelector('#element-name').textContent.includes('버튼') &&
      doc.querySelectorAll('#element-path button').length > 1,
  );
  app.selectNode(second.id, { additive: true });
  const before = app.state.undo.length;
  scene.nudge(12, -4);
  check(
    'Multi-selection moves both roots as one shared undo step',
    scene.edits[first.id].dx === 12 &&
      scene.edits[second.id].dx === 12 &&
      app.state.undo.length === before + 1,
  );
  app.undo();
  check(
    'Undo restores geometry and the multi-selection',
    !scene.edits[first.id] && !scene.edits[second.id] && scene.selection.size === 2,
  );
  const root = scene.doc.documentElement,
    oldCapture = root.setPointerCapture,
    oldHas = root.hasPointerCapture;
  root.setPointerCapture = () => {};
  root.hasPointerCapture = () => false;
  const pointer = () => ({
    button: 0,
    target: scene.elements.get(first.id),
    pointerId: 42,
    clientX: 0,
    clientY: 0,
    preventDefault() {},
    stopPropagation() {},
  });
  scene.begin(pointer());
  scene.move({ pointerId: 42, clientX: 22, clientY: 13 });
  scene.finish({ pointerId: 42 }, false);
  check(
    'Dragging a selected group keeps every root at the same delta and removes overlays from exports',
    scene.edits[first.id].dx === 22 &&
      scene.edits[second.id].dx === 22 &&
      !scene.serialize().includes('data-uic-editor="multi-selection"'),
  );
  app.undo();
  const redoCount = app.state.redo.length;
  scene.begin(pointer());
  scene.move({ pointerId: 42, clientX: 18, clientY: 11 });
  scene.finish({ pointerId: 42 }, true);
  check(
    'Cancelling a group drag restores geometry without discarding redo history',
    !scene.edits[first.id] && !scene.edits[second.id] && app.state.redo.length === redoCount,
  );
  root.setPointerCapture = oldCapture;
  root.hasPointerCapture = oldHas;
  scene.remove();
  check('Multi-selection deletion is atomic', scene.hidden(first.id) && scene.hidden(second.id));
  app.undo();
  app.selectNode('n1');
  app.selectNode(first.id, { additive: true });
  scene.nudge(10, 0);
  check(
    'Selecting parent and child never doubles movement',
    scene.offset(first.id).x === 10 && !scene.edits[first.id],
  );
  app.undo();
  app.selectNode(first.id);
  scene.setPosition(0, 30);
  app.selectNode(second.id, { additive: true });
  scene.align('top');
  check(
    'Alignment uses final visual coordinates',
    Math.abs(scene.rect(first.id).y - scene.rect(second.id).y) < 1,
  );
  app.undo();
  app.undo();
  app.selectNode(first.id);
  scene.callbacks.onCommentSelect(first.id);
  check(
    'Component comment icon opens a modal without a mode switch',
    doc.querySelector('#comment-dialog').open && doc.activeElement.id === 'component-comment',
  );
  const field = doc.querySelector('#component-comment');
  field.value = '버튼 문구를 고객 추가로 변경';
  field.dispatchEvent(new frame.contentWindow.Event('input', { bubbles: true }));
  await until(() => scene.annotations[first.id] === field.value);
  await app.state.saving;
  check(
    'Inline comments autosave and keep a numbered canvas marker',
    scene.commentMarkers.has(first.id) && scene.annotations[first.id].includes('고객 추가'),
  );
  click('close-comment-dialog');
  check(
    'Closing the popover preserves the draft and returns the draft to the comments panel',
    doc.querySelector('#comment-editor-host').contains(field) &&
      scene.annotations[first.id] === field.value,
  );
  click('tab-comments');
  doc.querySelector('#comment-search').value = '고객 추가';
  doc.querySelector('#comment-search').dispatchEvent(new Event('input'));
  check(
    'Comments have a searchable list with stable element targets',
    doc.querySelectorAll('.comment-list-item').length === 1 &&
      doc.querySelector('#comments-count').textContent === '1',
  );
  doc.querySelector('.comment-list-item').click();
  check(
    'Picking a comment reveals its target and input',
    scene.selected === first.id &&
      !doc.querySelector('#comments-panel').hidden &&
      doc.activeElement.id === 'component-comment',
  );
  click('close-comment-dialog');
  const a = app.snapshotHistory.create('비교 A');
  scene.nudge(35, 20);
  const b = app.snapshotHistory.create('비교 B');
  click('snapshot-dropdown');
  check(
    'Snapshot tree displays branch depth and saved names',
    doc.querySelector('[data-depth="1"]') &&
      doc.querySelector('#snapshot-list').textContent.includes('비교 B'),
  );
  const signature = () =>
    JSON.stringify([
      scene.edits,
      scene.annotations,
      app.state.timeline,
      app.state.revision,
      app.state.undo.length,
    ]);
  const saved = signature();
  doc.querySelector('.snapshot-compare').click();
  doc.querySelector('#compare-left').value = a.id;
  doc.querySelector('#compare-left').dispatchEvent(new Event('change'));
  doc.querySelector('#compare-right').value = b.id;
  doc.querySelector('#compare-right').dispatchEvent(new Event('change'));
  await until(
    () =>
      doc.querySelectorAll('.compare-view iframe').length === 2 &&
      doc.querySelector('#compare-diff').textContent.includes('1개'),
  );
  check(
    'Two saved versions can be compared without changing current edits, revision or history',
    signature() === saved &&
      doc.querySelector('#compare-left').value === a.id &&
      doc.querySelector('#compare-right').value === b.id,
  );
  doc.querySelector('#compare-dialog').close();
  click('export-button');
  doc.querySelector('#handoff-version').value = a.id;
  doc.querySelector('#handoff-version').dispatchEvent(new Event('change'));
  await until(() => doc.querySelector('#export-summary').textContent.includes('비교 A'));
  check(
    'Handoff previews the selected saved version without restoring it',
    signature() === saved && doc.querySelector('#export-summary').textContent.includes('변경 요청'),
  );
  doc.querySelector('#export-dialog').close();
  const payload = JSON.stringify(
    reviewPayload(
      app.state.snapshot,
      scene,
      doc.querySelector('#review-note').value,
      app.state.timeline,
    ),
  );
  await app.importFile(new frame.contentWindow.File([payload], 'ux.uiclone.json'));
  check(
    'New UX preserves edits, comments and all snapshots through file roundtrip',
    app.state.scene.edits[first.id].dx === 35 &&
      app.state.scene.annotations[first.id].includes('고객 추가') &&
      app.state.timeline.entries.length === 3,
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
