import { getDocument } from '../db.js';
const results = [],
  frame = document.querySelector('#editor');
function check(name, value) {
  results.push({ name, passed: !!value });
  document.querySelector('#results').textContent = results
    .map((r) => (r.passed ? 'PASS ' : 'FAIL ') + r.name)
    .join('\n');
  if (!value) throw Error(name);
}
async function until(fn) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw Error('Timed out');
}
try {
  await until(() => frame.contentWindow.ConsoleCanvas?.state.ready);
  const win = frame.contentWindow,
    doc = frame.contentDocument,
    app = win.ConsoleCanvas;
  const $ = (s) => doc.querySelector(s),
    click = (s) => $(s).click();
  const input = (s, value) => {
    const el = $(s);
    const prototype =
      el.tagName === 'TEXTAREA'
        ? win.HTMLTextAreaElement.prototype
        : win.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, value);
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
  };
  const key = (value, extra = {}) =>
    (doc.activeElement || doc).dispatchEvent(
      new win.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...extra }),
    );
  const snapshot = structuredClone(app.state.snapshot),
    button = snapshot.nodes.find((n) => n.locator?.id === 'new-customer');
  const legacy = { ...structuredClone(snapshot), id: 'action-legacy' };
  await app.openSnapshot(legacy, { [button.id]: { dx: 18, dy: 8 } }, '보존한 설명');
  check(
    'Preserved edit and note are visible without inventing timestamped activity',
    app.state.activity.length === 0 &&
      $('#activity-list').textContent.includes('시간 기록 없음') &&
      Number($('#activity-count').textContent) >= 2,
  );
  const unchanged = JSON.stringify(app.state.scene.edits),
    revision = app.state.revision;
  $('#activity-all').checked = true;
  $('#activity-all').dispatchEvent(new win.Event('change'));
  check(
    'All branches checkbox changes only the integrated list',
    app.state.revision === revision && JSON.stringify(app.state.scene.edits) === unchanged,
  );
  input('#activity-search', 'nothing-matches');
  check('Empty result exposes a one-action filter reset', !$('#activity-reset').hidden);
  click('#activity-reset');
  check(
    'Filter reset restores the same history without altering edits',
    !$('#activity-all').checked &&
      !$('#activity-search').value &&
      JSON.stringify(app.state.scene.edits) === unchanged,
  );
  check(
    'Photo-less original comparison has an explicit disabled direct entry',
    $('#direct-source-compare').disabled,
  );
  const before = await getDocument(legacy.id);
  click('#document-menu-button');
  await until(() => $('#quick-documents').querySelectorAll('button').length > 0);
  check(
    'Document title opens a searchable list directly with input focus',
    doc.activeElement === $('#quick-document-search') &&
      $('#quick-documents').textContent.includes('고객'),
  );
  check(
    'Management actions remain available at the same menu depth',
    $('#rename-current') && $('#trash-current') && $('#save-document') && $('#direct-open-source'),
  );
  frame.style.height = '600px';
  frame.style.width = '700px';
  await new Promise((resolve) =>
    win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)),
  );
  const menuBounds = $('#document-menu-content').getBoundingClientRect(),
    trashBounds = $('#trash-current').getBoundingClientRect();
  check(
    'Small document picker keeps management controls visible without an extra scroll',
    trashBounds.bottom <= menuBounds.bottom + 1 && menuBounds.right <= win.innerWidth,
  );
  frame.style.height = '800px';
  frame.style.width = '1280px';
  $('#document-menu-content').hidePopover();
  await app.openSnapshot({ ...structuredClone(snapshot), id: 'action-comments' });
  const ids = app.state.snapshot.nodes
    .filter((n) => n.tag === 'button' && n.visible && !n.scopeHidden)
    .slice(0, 10)
    .map((n) => n.id);
  check('Fixture has ten distinct editable comment targets', ids.length === 10);
  app.state.scene.select(ids[0], { ids });
  click('#context-comment');
  check(
    'Multi-comment opens exactly the selected IDs, without creating blank annotations',
    $('#comment-request').options.length === 10 &&
      Object.keys(app.state.scene.annotations).length === 0 &&
      $('#comment-progress').textContent.includes('선택 대상'),
  );
  for (let i = 0; i < 3; i++) {
    input('#component-comment', '대상별 요청 ' + i);
    if (i < 2) click('#comment-next');
  }
  click('#save-comment');
  await app.state.saving;
  check(
    'Queue saves individual notes on their original IDs and leaves unfilled targets untouched',
    ids.slice(0, 3).every((id, i) => app.state.scene.annotations[id] === '대상별 요청 ' + i) &&
      Object.keys(app.state.scene.annotations).length === 3,
  );
  app.selectNode(ids[7]);
  click('#context-comment');
  check(
    'Single-target comment still opens the ordinary modal with autofocus',
    doc.activeElement === $('#component-comment') &&
      $('#comment-dialog-title').textContent === '컴포넌트에 주석 남기기',
  );
  click('#close-comment-dialog');
  const count = app.state.scene.nodes.size,
    undo = app.state.undo.length;
  app.selectNode(ids[0]);
  $('#scene-frame').focus();
  key('d', { ctrlKey: true });
  check(
    'Explicit duplicate creates a copy in one shared undo step',
    app.state.scene.nodes.size > count && app.state.undo.length === undo + 1,
  );
  app.undo('undo');
  check('Duplicate undo restores the original node count', app.state.scene.nodes.size === count);
  input('#layer-search', 'preserve typing');
  $('#layer-search').focus();
  key('d', { ctrlKey: true });
  check(
    'Text-field shortcuts do not duplicate or modify the canvas',
    app.state.scene.nodes.size === count,
  );
  input('#layer-search', '');
  $('#layer-search').blur();
  key('d', { ctrlKey: true, isComposing: true });
  check('IME composition is never interpreted as duplicate', app.state.scene.nodes.size === count);
  const panelState = win.localStorage.getItem('console-canvas-panels-v1');
  const panelVisibility = ['#toggle-layers', '#toggle-properties'].map((id) =>
    $(id).getAttribute('aria-expanded'),
  );
  const panelWidths = ['--layers-open-width', '--properties-open-width'].map((name) =>
    $('#workspace').style.getPropertyValue(name),
  );
  key('f', { ctrlKey: true, shiftKey: true });
  check(
    'Focus view preserves the stored panel preferences',
    win.localStorage.getItem('console-canvas-panels-v1') === panelState,
  );
  key('f', { ctrlKey: true, shiftKey: true });
  check(
    'Focus view restores prior panel visibility',
    JSON.stringify(
      ['#toggle-layers', '#toggle-properties'].map((id) => $(id).getAttribute('aria-expanded')),
    ) === JSON.stringify(panelVisibility) &&
      JSON.stringify(
        ['--layers-open-width', '--properties-open-width'].map((name) =>
          $('#workspace').style.getPropertyValue(name),
        ),
      ) === JSON.stringify(panelWidths),
  );
  const pngCanvas = doc.createElement('canvas');
  pngCanvas.width = 12;
  pngCanvas.height = 12;
  pngCanvas.getContext('2d').fillRect(0, 0, 12, 12);
  const png = pngCanvas.toDataURL();
  const repaired = { ...structuredClone(snapshot), id: 'action-repair' };
  const urls = ['a', 'b', 'c'].map((s) => 'https://assets.example.test/' + s + '.png');
  urls.forEach((url, i) => {
    const id = 'n' + (900001 + i);
    repaired.html = repaired.html.replace(
      '</body>',
      `<img data-uic-id="${id}" src="${url}" width="12" height="12"></body>`,
    );
    repaired.nodes.push({
      id,
      tag: 'img',
      parentId: null,
      name: '이미지 ' + i,
      kind: 'element',
      visible: true,
      position: 'static',
      rect: { x: 20 + i * 20, y: 20, width: 12, height: 12 },
      locator: {},
      image: { url, mode: 'screenshot', broken: true },
    });
  });
  await app.openSnapshot(repaired);
  let attempt = 0;
  win.ConsoleCanvasDesktop = {
    retryAssets: async (requested) => {
      attempt++;
      return requested.map((url) =>
        attempt === 1 && url === urls[1] ? { url, error: '일시 실패' } : { url, data: png },
      );
    },
  };
  click('#capture-status-button');
  click('#repair-assets-button');
  const third = [...$('#repair-assets-results').querySelectorAll('input')].find(
    (el) => el.value === urls[2],
  );
  third.checked = false;
  third.dispatchEvent(new win.Event('change'));
  click('#repair-assets-fetch');
  await until(() => !$('#repair-assets-apply').disabled && !$('#repair-assets-retry').disabled);
  check(
    'Initial repair keeps failed and unselected candidates while staging success',
    $('#repair-assets-results').querySelectorAll('input').length >= 3 &&
      $('#repair-assets-results').textContent.includes('읽기 전') &&
      $('#repair-assets-results').textContent.includes('일시 실패'),
  );
  check('Staging repair is read-only', app.state.scene.codePatches.length === 0);
  click('#repair-assets-retry');
  await until(
    () =>
      $('#repair-assets-apply').textContent.includes('2개') && !$('#repair-assets-apply').disabled,
  );
  check(
    'Retry accumulates earlier success instead of replacing it',
    attempt === 2 && $('#repair-assets-apply').textContent.includes('2개'),
  );
  click('#repair-assets-apply');
  check(
    'Accumulated resources apply together as one undo step',
    app.state.scene.codePatches.length === 2 && app.state.undo.length === 1,
  );
  check(
    'Original broken-image evidence remains separate from current repair labels',
    $('#capture-status-button').textContent.includes('가져오기'),
  );
  click('#capture-status-button');
  check(
    'Recovered original evidence explicitly reports resource applied without claiming visual equality',
    $('#capture-status-list').textContent.includes('복구 적용됨') &&
      $('#capture-repair-summary').textContent.includes('2개'),
  );
  $('#capture-status-dialog').close();
  app.undo('undo');
  check(
    'Undo restores the original missing-resource state',
    app.state.scene.codePatches.length === 0,
  );
  const result = { ...structuredClone(snapshot), id: 'action-implementation-result' };
  await app.openSnapshot(result);
  await app.state.saving;
  await app.openSnapshot({ ...structuredClone(snapshot), id: 'action-implementation-target' });
  app.state.scene.setComment(button.id, '버튼 요청');
  const others = ids.filter((id) => id !== button.id);
  app.state.scene.setComment(others[0], '다른 요청');
  app.state.scene.setComment(others[1], '세 번째 요청');
  click('#implementation-button');
  await until(() => $('#implementation-result'));
  const select = $('#implementation-result');
  select.value = result.id;
  select.dispatchEvent(new win.Event('change', { bubbles: true }));
  await until(
    () => $('#implementation-dialog iframe') && app.state.implementationReviews.at(-1)?.result,
  );
  await until(() => !$('#implementation-dialog .implementation-verdict-buttons button')?.disabled);
  const review = app.state.implementationReviews.at(-1),
    first = review.requests[0].id;
  check(
    'Automatic next is opt-in and defaults off',
    !$('.implementation-judgement-options input').checked,
  );
  $('.implementation-verdict-buttons button').click();
  await until(
    () =>
      review.requests[0].status === 'done' && !$('.implementation-verdict-buttons button').disabled,
  );
  check(
    'Default judgement stays on the same request',
    doc.querySelector('.implementation-request-pick')?.textContent &&
      $('#implementation-dialog .is-current').textContent.includes(review.requests[0].name),
  );
  const undoButton = [...$('#implementation-dialog').querySelectorAll('button')].find(
    (el) => el.textContent === '직전 판정 취소',
  );
  undoButton.click();
  await until(() => review.requests[0].status === 'pending');
  check(
    'Verdict undo is separate from canvas edits',
    review.requests[0].status === 'pending' && app.state.scene.annotations[first] === '버튼 요청',
  );
  await until(() => !$('.implementation-judgement-options input').disabled);
  $('.implementation-judgement-options input').click();
  await until(() => $('.implementation-judgement-options input').checked);
  $('.implementation-verdict-buttons button').click();
  await until(() =>
    $('#implementation-dialog .is-current').textContent.includes(review.requests[1].name),
  );
  check(
    'Opted-in next follows successful save and keeps request-specific data',
    review.requests[0].status === 'done' && review.requests[1].status === 'pending',
  );
  $('#implementation-dialog .implementation-verdict-buttons button').dispatchEvent(
    new win.MouseEvent('click', { bubbles: true, detail: 2 }),
  );
  check(
    'Second click of a double-click does not judge the next request',
    review.requests[1].status === 'pending',
  );
  input('[aria-label="요청 2 검토 메모"]', '실패해도 보존할 검토 메모');
  await app.state.saving;
  const activeSecond = review.requests[1].id;
  const oldPut = win.IDBObjectStore.prototype.put;
  win.IDBObjectStore.prototype.put = function () {
    throw new win.DOMException('검증용 저장 실패', 'QuotaExceededError');
  };
  $('.implementation-verdict-buttons button').click();
  await until(
    () => $('#implementation-status').textContent.includes('실패') || app.state.lastSaveError,
  );
  await until(() => !$('.implementation-verdict-buttons button').disabled);
  win.IDBObjectStore.prototype.put = oldPut;
  check(
    'Failed verdict save rolls back and never advances to the next request',
    review.requests[1].status === 'pending' &&
      $('#implementation-dialog .is-current').textContent.includes(review.requests[1].name) &&
      review.requests[2].status === 'pending' &&
      review.requests[1].note === '실패해도 보존할 검토 메모',
  );
  $('#implementation-dialog').close();
  let destination = null;
  win.ConsoleCanvasDesktop = {
    beginReviewCapture: async (value) => {
      destination = structuredClone(value);
      return value;
    },
  };
  click('#implementation-button');
  await until(() => $('#implementation-capture'));
  click('#implementation-capture');
  await until(() => destination);
  const targetId = app.state.snapshot.id,
    oldReviewCount = app.state.implementationReviews.length;
  await app.implementationReview.acceptCapture(
    { ...structuredClone(snapshot), id: 'native-result' },
    destination,
  );
  check(
    'Direct capture attaches to the frozen review without replacing the target document',
    app.state.snapshot.id === targetId &&
      app.state.implementationReviews.length === oldReviewCount + 1 &&
      app.state.implementationReviews.at(-1).result.snapshot.id === 'native-result',
  );
  check(
    'Previous implementation verdict is preserved when a new result is attached',
    app.state.implementationReviews[0].requests[0].status === 'done',
  );
  destination = null;
  click('#implementation-capture');
  await until(() => destination);
  const stale = destination;
  $('#implementation-dialog').close();
  await app.openSnapshot({ ...structuredClone(snapshot), id: 'different-target' });
  let rejected = false;
  try {
    await app.implementationReview.acceptCapture(
      { ...structuredClone(snapshot), id: 'late-result' },
      stale,
    );
  } catch {
    rejected = true;
  }
  check(
    'Late result cannot replace or attach to a different target document',
    rejected &&
      app.state.snapshot.id === 'different-target' &&
      app.state.implementationReviews.length === 0,
  );
  check(
    'Original virtual capture bytes remain unchanged',
    snapshot.html === legacy.html && before.html === legacy.html,
  );
  document.querySelector('#status').textContent = JSON.stringify({
    passed: results.length,
    failed: 0,
    total: results.length,
  });
  document.body.dataset.result = 'pass';
} catch (error) {
  document.querySelector('#status').textContent = String(error) + '\n' + error.stack;
  document.body.dataset.result = 'fail';
}
