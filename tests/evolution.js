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
  if (!doc.querySelector('#snapshot-panel').matches(':popover-open')) click('#snapshot-dropdown');
  const node = (id) => doc.querySelector(`[data-snapshot-id="${id}"]`).closest('[data-lane]');
  check(
    'Horizontal graph separates A→D from A→B→C',
    node(b).dataset.lane === node(c).dataset.lane &&
      node(d).dataset.lane !== node(b).dataset.lane &&
      doc.querySelector(`path[data-parent-id="${a}"][data-child-id="${d}"]`) &&
      !doc.querySelector(`path[data-parent-id="${c}"][data-child-id="${d}"]`),
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
  click('#snapshot-dropdown');
  await new Promise((r) =>
    frame.contentWindow.requestAnimationFrame(() => frame.contentWindow.requestAnimationFrame(r)),
  );
  if (doc.querySelector('#snapshot-fit-graph').textContent === '실제 크기')
    click('#snapshot-fit-graph');
  const graphScroll = doc.querySelector('#snapshot-graph-scroll');
  graphScroll.scrollLeft = 30;
  const savedScroll = graphScroll.scrollLeft,
    selectedBeforeRename = app.state.snapshotPreviewId;
  const renameCard = doc.querySelector(`[data-snapshot-id="${d}"]`).closest('.snapshot-card');
  renameCard.querySelector('.more-actions').click();
  renameCard.querySelector('[data-snapshot-action="rename"]').click();
  doc.querySelector('#rename-name').value = 'D renamed';
  doc.querySelector('#rename-form').requestSubmit();
  await until(
    () =>
      !doc.querySelector('#rename-dialog').open &&
      doc.querySelector('#snapshot-panel').matches(':popover-open'),
  );
  await new Promise((r) =>
    frame.contentWindow.requestAnimationFrame(() => frame.contentWindow.requestAnimationFrame(r)),
  );
  check(
    'Snapshot rename returns to graph with preview and horizontal position preserved',
    app.state.snapshotPreviewId === selectedBeforeRename &&
      graphScroll.scrollLeft === savedScroll &&
      doc.querySelector(`[data-snapshot-id="${d}"]`).textContent.includes('D renamed') &&
      doc.activeElement.getAttribute('aria-label') === 'D renamed · 기타 작업',
  );
  doc.querySelector('#snapshot-panel').hidePopover();
  const oldHeight = frame.style.height;
  frame.style.height = '720px';
  click('#export-button');
  const footerButton = doc.querySelector('#download-review').getBoundingClientRect();
  check(
    'Export actions remain inside the 720px viewport without scrolling',
    footerButton.top > 0 &&
      footerButton.bottom <= frame.contentWindow.innerHeight &&
      doc.querySelector('#export-dialog').scrollHeight <=
        doc.querySelector('#export-dialog').clientHeight + 2,
  );
  doc.querySelector('#export-dialog').close();
  frame.style.height = oldHeight;
  await until(() => !doc.querySelector('#export-dialog').open);
  app.selectNode(button.id);
  const copied = scene.pasteSelection(scene.copySelection())[0];
  scene.setComment(copied, 'Deleted copied button reference');
  const copiedRect = scene.nodes.get(copied).rect;
  scene.remove(copied);
  const referenceState = JSON.stringify([scene.edits, scene.annotations, [...scene.selection]]);
  const reference = scene.referenceFrame();
  check(
    'Deleted-copy reference contains its actual node and covers the complete rectangle',
    reference.html.includes(copied) &&
      reference.size.width >= copiedRect.x + copiedRect.width &&
      reference.size.height >= copiedRect.y + copiedRect.height,
  );
  check(
    'Reference rendering preserves deleted edits, comments and selection',
    JSON.stringify([scene.edits, scene.annotations, [...scene.selection]]) === referenceState,
  );
  const oldTitle = app.state.snapshot.documentName;
  app.state.snapshot.documentName =
    '아주 긴 문서 제목과 변경 요청을 정상 크기로 읽을 수 있어야 합니다 '.repeat(3);
  const proto = frame.contentWindow.CanvasRenderingContext2D.prototype,
    originalFill = proto.fillText,
    titleDraws = [];
  proto.fillText = function (...args) {
    if (this.font.includes('36px')) titleDraws.push(args);
    return originalFill.apply(this, args);
  };
  try {
    await app.buildHandoffImage();
  } finally {
    proto.fillText = originalFill;
    app.state.snapshot.documentName = oldTitle;
  }
  check(
    'Long PNG title wraps over multiple lines without horizontal text compression',
    titleDraws.length > 1 &&
      titleDraws.every((args) => args.length === 3) &&
      titleDraws[1][2] > titleDraws[0][2],
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
