import { activityBranch } from '../activity-history.js';
import { getDocument } from '../db.js';
import { reviewPayload } from '../export.js';
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
  let app = frame.contentWindow.ConsoleCanvas,
    doc = frame.contentDocument;
  const click = (q) => doc.querySelector(q).click(),
    scene = app.state.scene,
    button = [...scene.nodes.values()].find((n) => n.locator.id === 'new-customer');
  check(
    'No selection/comment mode switch; history is the default right panel',
    !doc.querySelector('#select-mode') &&
      !doc.querySelector('#comment-mode') &&
      !doc.querySelector('#history-panel').hidden,
  );
  app.selectNode(button.id);
  check(
    'Selecting a component exposes one contextual comment control',
    scene.addCommentButton.style.display !== 'none',
  );
  scene.callbacks.onCommentSelect(button.id);
  check(
    'Context action opens focused comment modal',
    doc.querySelector('#comment-dialog').open && doc.activeElement.id === 'component-comment',
  );
  doc.querySelector('#component-comment').value = '제목 오른쪽에 배치하고 좁은 화면에서 줄바꿈';
  click('#save-comment');
  check(
    'Saving closes modal and leaves a numbered editable pin',
    !doc.querySelector('#comment-dialog').open && scene.commentMarkers.has(button.id),
  );
  scene.openComment(button.id);
  check(
    'Existing numbered pin reopens its saved text',
    doc.querySelector('#component-comment').value.includes('줄바꿈'),
  );
  click('#close-comment-dialog');
  scene.showPointComment(850, 380);
  scene.callbacks.onCommentSelect('point:850:380');
  doc.querySelector('#component-comment').value = '이 여백을 줄이고 검색 영역을 묶어 주세요.';
  click('#save-comment');
  check(
    'Empty-coordinate note is stored and rendered as a point marker',
    scene.annotations['point:850:380'] &&
      scene.comments().find((c) => c.id === 'point:850:380').point.x === 850,
  );
  app.undo();
  check('Undo removes coordinate annotation atomically', !scene.annotations['point:850:380']);
  app.undo('redo');
  const save = (name) => {
    click('#snapshots-button');
    check(
      'Snapshot button asks for name in a modal',
      doc.querySelector('#snapshot-save-dialog').open,
    );
    doc.querySelector('#snapshot-name').value = name;
    doc.querySelector('#snapshot-form').requestSubmit();
    return app.state.timeline.activeId;
  };
  const a = save('A · 기준');
  app.selectNode(button.id);
  scene.nudge(18, 0);
  const b = save('B · 배치');
  scene.nudge(10, 0);
  const c = save('C · 간격');
  app.snapshotHistory.restore(a);
  scene.setComment(button.id, 'D 가지에서만 적용할 요청');
  const d = save('D · 대안');
  check(
    'Past-version edits create A→D while retaining A→B→C',
    app.state.timeline.entries.find((e) => e.id === b).parentId === a &&
      app.state.timeline.entries.find((e) => e.id === c).parentId === b &&
      app.state.timeline.entries.find((e) => e.id === d).parentId === a,
  );
  click('#snapshot-dropdown');
  const depth = (id) =>
    Number(doc.querySelector(`[data-snapshot-id="${id}"]`).closest('[data-depth]').dataset.depth);
  check(
    'Dropdown displays real branch depths and current version',
    depth(b) === depth(d) &&
      depth(c) === depth(b) + 1 &&
      doc.querySelector(`[data-snapshot-id="${d}"]`).getAttribute('aria-pressed') === 'true',
  );
  doc.querySelector('#snapshot-panel').hidePopover();
  const currentEvents = activityBranch(app.state),
    allEvents = activityBranch(app.state, true);
  check(
    'Current branch excludes parallel C geometry events',
    currentEvents.length < allEvents.length &&
      !currentEvents.some((e) => e.changes.some((c) => c.after?.dx === 28)),
  );
  check(
    'Unified history contains comment, geometry, undo and snapshot operations',
    allEvents.some((e) => e.changes.some((c) => c.type === 'comment')) &&
      allEvents.some((e) => e.changes.some((c) => c.type === 'move')) &&
      allEvents.some((e) => e.label === '실행 취소') &&
      allEvents.some((e) => e.label === '스냅샷 저장'),
  );
  app.snapshotHistory.restore(c);
  check(
    'Future branch and its coordinate notes remain accessible',
    scene.edits[button.id].dx === 28 && scene.annotations['point:850:380'],
  );
  app.snapshotHistory.restore(d);
  const targets = [...scene.nodes.values()]
    .filter((n) => n.tag === 'button' && n.id !== button.id)
    .slice(0, 8);
  for (const [i, n] of targets.entries())
    scene.setComment(
      n.id,
      '요청 ' + (i + 3) + ' · 주변 요소와 간격을 맞추고 좁은 화면에서 줄바꿈해 주세요.',
    );
  const deleteTarget = targets[0];
  scene.remove(deleteTarget.id);
  const before = JSON.stringify([
    scene.edits,
    scene.annotations,
    app.state.timeline,
    app.state.activity,
  ]);
  const image = await app.buildHandoffImage();
  check(
    'Ten requests produce one PNG with screen above two-column cards',
    image.requests.length === 10 &&
      image.blob.type === 'image/png' &&
      image.height > image.width &&
      image.requests.find((r) => r.id === deleteTarget.id).deleted,
  );
  check(
    'Image generation preserves document, branches and operation history',
    before ===
      JSON.stringify([scene.edits, scene.annotations, app.state.timeline, app.state.activity]),
  );
  const id = app.state.snapshot.id;
  await app.state.saving;
  const saved = await getDocument(id);
  check(
    'Persistent session includes all branches, point comments and event head',
    saved.activity.length === app.state.activity.length &&
      saved.activityHead === app.state.activityHead &&
      saved.annotations['point:850:380'] &&
      saved.timeline.entries.some((e) => e.id === c),
  );
  const payload = reviewPayload(
    app.state.snapshot,
    scene,
    '',
    app.state.timeline,
    app.state.activity,
    app.state.activityHead,
  );
  await app.importFile(new File([JSON.stringify(payload)], 'branches.uiclone.json'));
  check(
    'Editable file roundtrip retains operation graph and point notes',
    app.state.activity.length === saved.activity.length &&
      app.state.scene.annotations['point:850:380'],
  );
  const command = {
    document_id: id,
    deadline: Date.now() / 1000 + 30,
    name: 'list_history',
    arguments: { editor_id: app.controller.metadata().editor_id, scope: 'all' },
  };
  const history = await app.controller.execute(command);
  check(
    'MCP history reads the same persisted graph',
    history.ok && history.total === app.state.activity.length,
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
