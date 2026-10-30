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
  let app = frame.contentWindow.ConsoleCanvas;
  const doc = frame.contentDocument,
    win = frame.contentWindow,
    click = (q) => doc.querySelector(q).click();
  const node = [...app.state.scene.nodes.values()].find((n) => n.locator.id === 'new-customer'),
    other = [...app.state.scene.nodes.values()].find((n) => n.locator.id === 'export-customers');
  app.selectNode(node.id);
  click('#fit');
  click('#edit-properties');
  check(
    'Inspector opens without making the canvas inert',
    doc.querySelector('#properties-dialog').open &&
      !doc.querySelector('#properties-dialog').matches(':modal'),
  );
  const inspector = doc.querySelector('#properties-dialog');
  inspector.scrollTop = inspector.scrollHeight;
  const heading = inspector.querySelector('.popover-heading').getBoundingClientRect();
  check(
    'Inspector title and close control remain visible while its body scrolls',
    heading.top >= inspector.getBoundingClientRect().top &&
      heading.bottom <= inspector.getBoundingClientRect().bottom,
  );
  inspector.scrollTop = 0;
  const start = app.state.scene.offset(node.id).x;
  app.state.scene.nudge(1, 0);
  app.state.scene.nudge(1, 0);
  app.state.scene.nudge(1, 0);
  check(
    'Canvas edits update while inspector stays open',
    doc.querySelector('#properties-dialog').open &&
      Number(doc.querySelector('#offset-x').value) === start + 3,
  );
  check(
    'Consecutive movements collapse without merging the raw events',
    doc.querySelector('.activity-details summary')?.textContent.includes('3') &&
      app.state.activity.filter((e) => e.label === '요소 이동').length === 3,
  );
  doc.querySelector('.activity-details').open = true;
  check(
    'Individual movement events remain inspectable',
    doc.querySelectorAll('[data-detail-event-id]').length === 3,
  );
  doc.querySelector('#activity-selected').checked = true;
  doc.querySelector('#activity-selected').dispatchEvent(new win.Event('change'));
  app.selectNode(other.id);
  check(
    'Selected-only history follows selection and shows an empty result',
    doc.querySelector('#activity-list').textContent.includes('조건에 맞는 변경이 없습니다.'),
  );
  doc.querySelector('#activity-selected').checked = false;
  doc.querySelector('#activity-selected').dispatchEvent(new win.Event('change'));
  app.selectNode(node.id);
  check(
    'Selection actions belong to a contextual toolbar and zoom belongs to the footer',
    doc.querySelector('#selection-actions').contains(doc.querySelector('#copy')) &&
      doc.querySelector('.canvas-footer').contains(doc.querySelector('#zoom')) &&
      !doc.querySelector('.canvas-toolbar').contains(doc.querySelector('#delete')),
  );
  doc.querySelector('#layer-alias').value = '고객 추가 작업';
  click('#save-layer-alias');
  await app.state.saving;
  doc.querySelector('#layer-search').value = '고객 추가 작업';
  doc.querySelector('#layer-search').dispatchEvent(new win.Event('input'));
  check(
    'Layer alias is searchable and original locator is unchanged',
    doc.querySelector('#layers').textContent.includes('고객 추가 작업') &&
      app.state.scene.nodes.get(node.id).locator.id === 'new-customer',
  );
  doc.querySelector('#activity-search').value = '고객 추가 작업';
  doc.querySelector('#activity-search').dispatchEvent(new win.Event('input'));
  check(
    'Unified history can find renamed layers without rewriting raw events',
    doc.querySelector('#activity-list').textContent.includes('고객 추가 작업') &&
      !app.state.activity.some((e) => e.changes.some((c) => c.name === '고객 추가 작업')),
  );
  doc.querySelector('#activity-search').value = '';
  doc.querySelector('#activity-search').dispatchEvent(new win.Event('input'));
  const saved = await getDocument(app.state.snapshot.id);
  check('Alias persists outside immutable capture', saved.layerNames[node.id] === '고객 추가 작업');
  await app.openSnapshot(saved, saved.edits, saved.note, saved.annotations);
  check(
    'Reopening the saved document restores aliases',
    app.state.snapshot.layerNames[node.id] === '고객 추가 작업',
  );
  const aliasSearch = await app.controller.execute({
    document_id: app.state.snapshot.id,
    deadline: Date.now() / 1000 + 30,
    name: 'list_elements',
    arguments: { editor_id: app.controller.metadata().editor_id, query: '고객 추가 작업' },
  });
  check(
    'MCP searches alias while retaining the original locator',
    aliasSearch.ok &&
      aliasSearch.elements.some(
        (e) => e.alias === '고객 추가 작업' && e.locator.id === 'new-customer',
      ),
  );
  const payload = reviewPayload(
    app.state.snapshot,
    app.state.scene,
    '',
    app.state.timeline,
    app.state.activity,
    app.state.activityHead,
  );
  await app.importFile(new win.File([JSON.stringify(payload)], 'aliases.uiclone.json'));
  check(
    'Portable document roundtrip retains aliases',
    app.state.snapshot.layerNames[node.id] === '고객 추가 작업',
  );
  app.selectNode(node.id);
  click('#edit-properties');
  click('#clear-layer-alias');
  await app.state.saving;
  check(
    'Resetting an alias removes metadata without changing the source identifier',
    !(await getDocument(app.state.snapshot.id)).layerNames &&
      app.state.scene.nodes.get(node.id).locator.id === 'new-customer',
  );
  click('#close-properties');
  app.state.scene.setComment(node.id, '전달 전 원래 주석');
  const a = app.snapshotHistory.create('기준 버전');
  await app.state.saving;
  click('#snapshot-dropdown');
  await until(() => doc.querySelector('#snapshot-preview-view iframe'));
  const height = doc.querySelector('#snapshot-graph-scroll').getBoundingClientRect().height;
  check(
    'A single graph lane leaves room for preview',
    height <= 190 && doc.querySelector('#snapshot-preview').getBoundingClientRect().top < 620,
  );
  const splitter = doc.querySelector('#snapshot-splitter');
  const splitterEdits = JSON.stringify(app.state.scene.edits),
    splitterUndo = app.state.undo.length;
  splitter.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  const minimumGraphHeight = doc
    .querySelector('#snapshot-graph-scroll')
    .getBoundingClientRect().height;
  splitter.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  check(
    'Keyboard resizing adjusts graph height',
    doc.querySelector('#snapshot-graph-scroll').getBoundingClientRect().height >
      minimumGraphHeight &&
      doc.querySelector('#snapshot-graph-scroll').getBoundingClientRect().height <=
        Number(splitter.getAttribute('aria-valuemax')),
  );
  check(
    'Graph resizing keys do not nudge canvas elements or create undo steps',
    JSON.stringify(app.state.scene.edits) === splitterEdits &&
      app.state.undo.length === splitterUndo,
  );
  check(
    'Working and preview names are explicit',
    /작업 중: v\d+ · 기준 버전/.test(doc.querySelector('#snapshot-current').textContent) &&
      /미리보기: v\d+ · 기준 버전/.test(doc.querySelector('#snapshot-current').textContent),
  );
  click('#close-snapshots');
  click('#export-button');
  await until(
    () => doc.querySelector('#handoff-preview img') && !doc.querySelector('#copy-summary').disabled,
  );
  check(
    'Review summary and note appear before the image',
    doc.querySelector('#review-note').getBoundingClientRect().top <
      doc.querySelector('#handoff-preview').getBoundingClientRect().top &&
      doc.querySelector('#export-summary').getBoundingClientRect().top <
        doc.querySelector('#handoff-preview').getBoundingClientRect().top,
  );
  check(
    'Image number has a real editable hotspot',
    doc.querySelectorAll('.handoff-hotspot').length === 2,
  );
  const scroll = doc.querySelector('.export-scroll');
  scroll.scrollTop = 80;
  const beforeScroll = scroll.scrollTop;
  doc.querySelector('.handoff-hotspot').click();
  check(
    'Clicking image number opens the existing comment editor',
    doc.querySelector('#comment-dialog').open &&
      doc.querySelector('#component-comment').value === '전달 전 원래 주석',
  );
  doc.querySelector('#component-comment').value = '번호에서 수정한 요청';
  click('#save-comment');
  await until(
    () =>
      doc.querySelector('#export-dialog').open &&
      doc.querySelector('#handoff-preview img') &&
      !doc.querySelector('#copy-summary').disabled,
  );
  check(
    'Comment save returns to same export position with new request',
    app.state.scene.annotations[node.id] === '번호에서 수정한 요청' &&
      Math.abs(scroll.scrollTop - beforeScroll) < 2,
  );
  doc.querySelector('#handoff-version').value = a.id;
  doc.querySelector('#handoff-version').dispatchEvent(new win.Event('change'));
  await until(() => !doc.querySelector('#copy-summary').disabled);
  check(
    'Stored version remains read-only with an explicit continuation route',
    !doc.querySelector('.handoff-hotspot') &&
      !doc.querySelector('#handoff-continue').hidden &&
      [...doc.querySelectorAll('.handoff-request')].every((e) =>
        e.getAttribute('aria-label').includes('이 버전에서 이어 편집'),
      ) &&
      app.state.scene.annotations[node.id] === '번호에서 수정한 요청',
  );
  doc.querySelector('#export-dialog').close();
  await app.state.saving;
  const invalid = { ...app.state.snapshot, layerNames: { [node.id]: 42 } };
  const beforeId = app.state.snapshot.id;
  let rejected = false;
  try {
    await app.openSnapshot(invalid);
  } catch {
    rejected = true;
  }
  check(
    'Invalid alias data is rejected before replacing the active document',
    rejected && app.state.snapshot.id === beforeId,
  );
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
