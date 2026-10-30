import { getDocument, saveCapture } from '../db.js';
import { reviewPayload } from '../export.js';
const frame = document.querySelector('#editor'),
  results = [];
function check(name, passed) {
  results.push({ name, passed: !!passed });
  document.querySelector('#results').textContent = results
    .map((r) => (r.passed ? 'PASS ' : 'FAIL ') + r.name)
    .join('\n');
  if (!passed) throw Error(name);
}
async function until(fn) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw Error('Timed out: ' + fn.toString());
}
const tick = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
try {
  await until(() => frame.contentWindow.ConsoleCanvas?.state.ready);
  let w = frame.contentWindow,
    d = frame.contentDocument,
    a = w.ConsoleCanvas;
  const $ = (s) => d.querySelector(s),
    click = (s) => $(s).click();
  const input = (s, value) => {
    const e = $(s);
    Object.getOwnPropertyDescriptor(
      e.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype,
      'value',
    ).set.call(e, value);
    e.dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  const change = (s, value) => {
    $(s).value = value;
    $(s).dispatchEvent(new w.Event('change', { bubbles: true }));
  };
  const snapshot = structuredClone(a.state.snapshot);
  const button = [...a.state.scene.nodes.values()].find(
    (n) => n.tag === 'button' && n.locator?.id === 'new-customer',
  );
  a.selectNode(button.id);
  a.state.scene.setComment(button.id, '같은 기준에서 버튼 정렬');
  const A = a.snapshotHistory.create('이어찾기 A');
  a.state.scene.nudge(12, 0);
  const B = a.snapshotHistory.create('이어찾기 B');
  for (let i = 0; i < 8; i++) a.snapshotHistory.create('이어찾기 ' + i);
  await a.snapshotHistory.restorePersisted(A.id);
  a.state.scene.nudge(0, 8);
  const D = a.snapshotHistory.create('이어찾기 D');
  await a.state.saving;
  const content = () =>
    JSON.stringify([
      a.state.snapshot.html,
      a.state.scene.edits,
      a.state.scene.annotations,
      a.state.timeline,
      a.state.activity,
    ]);
  const initial = content();
  click('#snapshot-dropdown');
  $(`[data-snapshot-id="${A.id}"]`).click();
  input('#snapshot-search', '이어찾기');
  change('#snapshot-preview-zoom', '1');
  await tick();
  $('#snapshot-graph-scroll').scrollLeft = 100;
  const position = $('#snapshot-graph-scroll').scrollLeft;
  $('#compare-button').focus();
  click('#compare-button');
  await until(
    () =>
      $('#compare-dialog').open &&
      $('#compare-left-view iframe') &&
      $('#compare-right-view iframe'),
  );
  check(
    'Snapshot comparison has one modal and keeps the actual working branch',
    d.querySelectorAll('dialog:modal').length === 1 &&
      a.state.timeline.activeId === D.id &&
      a.state.snapshotPreviewId === A.id,
  );
  $('#compare-dialog').close();
  await until(() => $('#snapshot-panel').matches(':popover-open'));
  await tick();
  check(
    'Comparison restores the exact search and results without retyping',
    $('#snapshot-search').value === '이어찾기' &&
      !$('#snapshot-search-results').hidden &&
      $('#snapshot-search-results').textContent.includes('이어찾기 A'),
  );
  check(
    'Comparison restores graph position, preview zoom and trigger focus',
    $('#snapshot-graph-scroll').scrollLeft === position &&
      $('#snapshot-preview-zoom').value === '1' &&
      d.activeElement === $('#compare-button'),
  );
  check(
    'Search/comparison never applies a snapshot, edits a note or truncates the future',
    content() === initial && B.parentId === A.id && D.parentId === A.id,
  );
  $('#snapshot-search').dispatchEvent(
    new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  check(
    'Escape still clears restored search before dismissing the graph',
    $('#snapshot-search').value === '' && $('#snapshot-panel').matches(':popover-open'),
  );
  input('#snapshot-search', '이어찾기');
  const card = () => $(`[data-snapshot-id="${A.id}"]`).closest('.snapshot-card');
  const rename = () => {
    card().querySelector('.more-actions').click();
    card().querySelector('[data-snapshot-action="rename"]').click();
  };
  rename();
  await until(() => $('#rename-dialog').open);
  click('#rename-cancel');
  await until(() => $('#snapshot-panel').matches(':popover-open'));
  await tick();
  check(
    'Canceling rename restores search, zoom and graph position',
    $('#snapshot-search').value === '이어찾기' &&
      $('#snapshot-preview-zoom').value === '1' &&
      $('#snapshot-graph-scroll').scrollLeft === position &&
      A.name === '이어찾기 A',
  );
  rename();
  input('#rename-name', '다른 이름으로 변경');
  $('#rename-form').requestSubmit();
  await until(() => !$('#rename-dialog').open && $('#snapshot-panel').matches(':popover-open'));
  await tick();
  check(
    'Successful rename preserves a now-nonmatching query and active/preview identity',
    $('#snapshot-search').value === '이어찾기' &&
      A.name === '다른 이름으로 변경' &&
      a.state.timeline.activeId === D.id &&
      a.state.snapshotPreviewId === A.id &&
      !$('#snapshot-search-results').querySelector(`[data-snapshot-match="${A.id}"]`),
  );
  input('#snapshot-search', '없는-버전-035');
  click('#compare-button');
  await until(() => $('#compare-dialog').open);
  $('#compare-dialog').close();
  await until(() => $('#snapshot-panel').matches(':popover-open'));
  await tick();
  check(
    'Zero-result query stays visible after comparison with no automatic version movement',
    $('#snapshot-search').value === '없는-버전-035' &&
      $('#snapshot-search-results').textContent.includes('없') &&
      a.state.timeline.activeId === D.id,
  );
  click('#close-snapshots');
  // More than twenty matching documents must remain findable after crossing to the full list.
  const ownDocuments = [];
  for (let i = 0; i < 23; i++) {
    const copy = {
      ...structuredClone(snapshot),
      id: crypto.randomUUID(),
      documentName: '이어문서035 ' + i,
    };
    await saveCapture(copy);
    ownDocuments.push(copy);
  }
  const beforeDocuments = content();
  click('#document-menu-button');
  await until(() => $('#quick-documents').querySelector('button'));
  input('#quick-document-search', '이어문서035');
  await tick();
  check(
    'Quick search reports its twenty-result boundary rather than hiding matching documents',
    $('#quick-documents').querySelectorAll('.quick-document').length === 20 &&
      $('#quick-document-status').textContent.includes('23개'),
  );
  click('#documents-button');
  await until(
    () =>
      $('#documents-dialog').open &&
      $('#document-list').querySelectorAll('[data-document-card]').length === 23,
  );
  check(
    'Full list carries the exact quick-search query and all matching documents',
    $('#document-search').value === '이어문서035' &&
      $('#document-list-status').textContent.includes('23개') &&
      d.activeElement === $('#document-search'),
  );
  check(
    'Crossing document lists never navigates, changes the canvas or discards an active branch',
    content() === beforeDocuments && a.state.snapshot.id === snapshot.id,
  );
  $('#documents-dialog').close();
  click('#document-menu-button');
  input('#quick-document-search', '없는-문서-035');
  click('#documents-button');
  await until(
    () => $('#documents-dialog').open && $('#document-list-status').textContent.includes('없'),
  );
  check(
    'No-result quick query carries into the full list without silently selecting another document',
    $('#document-search').value === '없는-문서-035' &&
      !$('#document-list').querySelector('[data-document-card]'),
  );
  input('#document-search', '이어문서035');
  await tick();
  check(
    'Search can be refined directly in the full list',
    $('#document-list').querySelectorAll('[data-document-card]').length === 23,
  );
  $('#documents-dialog').close();
  click('#documents-button');
  await until(
    () => $('#documents-dialog').open && $('#document-list').querySelector('[data-document-card]'),
  );
  check(
    'Direct full-list entry never inherits an old hidden quick query',
    $('#document-search').value === '',
  );
  $('#documents-dialog').close();
  click('#documents-trash-button');
  await until(
    () =>
      $('#documents-dialog').open && $('#documents-trash').getAttribute('aria-pressed') === 'true',
  );
  check(
    'Trash entry retains its separate empty-search default',
    $('#document-search').value === '' &&
      $('#documents-trash').getAttribute('aria-pressed') === 'true',
  );
  $('#documents-dialog').close();
  const savedMain = await getDocument(snapshot.id);
  click('#snapshot-dropdown');
  $(`[data-snapshot-id="${A.id}"]`).click();
  input('#snapshot-search', '이어찾기');
  click('#compare-button');
  await until(() => $('#compare-dialog').open);
  const transaction = w.IDBDatabase.prototype.transaction;
  w.IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
    const tx = transaction.call(this, stores, mode, ...rest);
    if (mode === 'readwrite' && (Array.isArray(stores) ? stores : [stores]).includes('captures')) {
      const store = tx.objectStore('captures'),
        deadline = Date.now() + 80;
      const hold = () => {
        const request = store.get('latency-fixture-035');
        request.onsuccess = () => {
          if (Date.now() < deadline) hold();
        };
      };
      hold();
    }
    return tx;
  };
  try {
    await a.openSnapshot(ownDocuments[0]);
  } finally {
    w.IDBDatabase.prototype.transaction = transaction;
  }
  await tick();
  await tick();
  check(
    'Document replacement never reopens the old comparison graph or query',
    a.state.snapshot.id === ownDocuments[0].id &&
      !$('#snapshot-panel').matches(':popover-open') &&
      !d.querySelector('dialog:modal'),
  );
  await a.openSnapshot(savedMain, savedMain.edits, savedMain.note, savedMain.annotations);
  click('#snapshot-dropdown');
  $(`[data-snapshot-id="${A.id}"]`).click();
  input('#snapshot-search', '이어찾기');
  click('#compare-button');
  await until(() => $('#compare-dialog').open);
  w.IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
    if (mode === 'readwrite' && (Array.isArray(stores) ? stores : [stores]).includes('captures'))
      throw new w.DOMException('Incoming capture save failure', 'QuotaExceededError');
    return transaction.call(this, stores, mode, ...rest);
  };
  let failedOpen = false;
  try {
    await a.openSnapshot(ownDocuments[0]);
  } catch {
    failedOpen = true;
  } finally {
    w.IDBDatabase.prototype.transaction = transaction;
  }
  check(
    'Failed incoming capture save leaves the original comparison task and document intact',
    failedOpen &&
      a.state.snapshot.id === snapshot.id &&
      $('#compare-dialog').open &&
      !$('#snapshot-panel').matches(':popover-open'),
  );
  $('#compare-dialog').close();
  await until(() => $('#snapshot-panel').matches(':popover-open'));
  rename();
  await until(() => $('#rename-dialog').open);
  await a.openSnapshot(ownDocuments[0]);
  await tick();
  await tick();
  check(
    'Successful document replacement cancels an old rename without restoring its graph',
    a.state.snapshot.id === ownDocuments[0].id &&
      !$('#rename-dialog').open &&
      !$('#snapshot-panel').matches(':popover-open'),
  );
  await a.openSnapshot(savedMain, savedMain.edits, savedMain.note, savedMain.annotations);
  click('#snapshot-dropdown');
  $(`[data-snapshot-id="${A.id}"]`).click();
  click('#compare-button');
  await until(() => $('#compare-dialog').open);
  a.snapshotHistory.trash(A.id);
  $('#compare-dialog').close();
  await tick();
  await tick();
  check(
    'A deleted preview does not force a stale graph to reopen',
    !$('#snapshot-panel').matches(':popover-open') && a.state.timeline.activeId === D.id,
  );
  a.snapshotHistory.recover(A.id);
  a.selectNode(button.id);
  click('#context-comment');
  await until(() => $('#comment-dialog').open);
  let lateTyped = false;
  w.IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
    const tx = transaction.call(this, stores, mode, ...rest);
    if (mode === 'readwrite' && (Array.isArray(stores) ? stores : [stores]).includes('captures')) {
      setTimeout(() => {
        input('#component-comment', '느린 저장 도중 추가한 주석');
        lateTyped = true;
      }, 10);
      const store = tx.objectStore('captures'),
        deadline = Date.now() + 80;
      const hold = () => {
        const request = store.get('late-comment-fixture-035');
        request.onsuccess = () => {
          if (Date.now() < deadline) hold();
        };
      };
      hold();
    }
    return tx;
  };
  try {
    await a.openSnapshot(ownDocuments[0]);
  } finally {
    w.IDBDatabase.prototype.transaction = transaction;
  }
  const lateSaved = await getDocument(snapshot.id);
  check(
    'A comment typed during a slow incoming capture write is flushed before replacing its editor',
    lateTyped && lateSaved.annotations[button.id] === '느린 저장 도중 추가한 주석',
  );
  await a.openSnapshot(lateSaved, lateSaved.edits, lateSaved.note, lateSaved.annotations);
  // A new composition draft must never supply hidden arguments to an old request.
  const R = await a.aiRequests.create({ prompt: '기존 버튼 정렬 요청', count: 2, route: 'mcp' });
  const candidate = await a.aiRequests.register({
    request_id: R.id,
    name: '후보 A',
    summary: '간격 비교',
    patches: [{ type: 'style', element_id: button.id, properties: { 'border-radius': '9px' } }],
  });
  a.state.aiDraft = { prompt: '제출하지 않은 다른 검색 요청', count: 7, route: 'api' };
  const newDraft = JSON.stringify(a.state.aiDraft);
  click('#ai-variants-button');
  await until(() => $('#ai-request-list') && $('#ai-followup-prompt'));
  $('.ai-request-details').open = true;
  check(
    'Follow-up shows its own request text, count and route despite an unrelated API draft',
    $('#ai-followup-prompt').value === R.prompt &&
      $('#ai-followup-count').value === '2' &&
      $('#ai-followup-route').value === 'mcp' &&
      !$('#ai-regenerate-baseline').disabled,
  );
  check(
    'Unchanged regeneration keeps compact controls without opening another editor',
    !$('.ai-followup-details').open && $('.ai-followup-summary').textContent.includes(R.prompt),
  );
  $('.ai-followup-details').open = true;
  await until(() => d.activeElement === $('#ai-followup-prompt'));
  check(
    'Opening follow-up settings focuses its own prompt in one action',
    d.activeElement === $('#ai-followup-prompt'),
  );
  const beforeAI = content();
  change('#ai-followup-route', 'api');
  await tick();
  check(
    'API follow-up is explicitly gated without a key and provides settings in place',
    $('#ai-regenerate-baseline').disabled &&
      $('#ai-followup-open-auth') &&
      $('.ai-request-details').textContent.includes('별도 API'),
  );
  click('#ai-followup-open-auth');
  await tick();
  check(
    'Follow-up API settings open in the same modal and preserve the separate new draft',
    d.querySelectorAll('dialog:modal').length === 1 &&
      $('.ai-auth').open &&
      d.activeElement === $('#ai-api-key') &&
      JSON.stringify(a.state.aiDraft) === newDraft,
  );
  $('.ai-new-request').open = false;
  change('#ai-followup-route', 'mcp');
  input('#ai-followup-prompt', '추가 정렬 요청만 변경');
  input('#ai-followup-count', '4');
  await tick();
  check(
    'Changing follow-up settings leaves canvas, branches and the unsubmitted new draft untouched',
    content() === beforeAI && JSON.stringify(a.state.aiDraft) === newDraft,
  );
  click('#ai-connect-agent');
  await until(() => !$('#ai-connection-page').hidden);
  click('#ai-connection-back');
  await tick();
  check(
    'Connection roundtrip retains the explicit follow-up settings',
    $('#ai-followup-prompt').value === '추가 정렬 요청만 변경' &&
      $('#ai-followup-count').value === '4',
  );
  click('#ai-close');
  click('#ai-variants-button');
  await until(() => $('#ai-followup-prompt'));
  check(
    'Reopening the gallery retains follow-up draft during this run',
    $('#ai-followup-prompt').value === '추가 정렬 요청만 변경' &&
      $('#ai-followup-count').value === '4',
  );
  $('.ai-request-details').open = true;
  $('.ai-followup-details').open = true;
  await tick();
  input('#ai-followup-count', '');
  await tick();
  check(
    'Empty or invalid counts are not silently replaced and cannot generate',
    $('#ai-followup-count').value === '' &&
      $('#ai-regenerate-baseline').disabled &&
      $('.ai-followup-settings').textContent.includes('1~12'),
  );
  input('#ai-followup-count', '4');
  await tick();
  let calls = 0,
    release;
  const originalCreate = a.aiRequests.create;
  a.aiRequests.create = async (value) => {
    calls++;
    await new Promise((r) => (release = r));
    return originalCreate(value);
  };
  const beforeRequests = a.state.aiRequests.length;
  click('#ai-regenerate-baseline');
  click('#ai-regenerate-baseline');
  await until(() => release);
  check(
    'Repeated activation submits one follow-up and disables its settings while saving',
    calls === 1 && $('.ai-followup-settings').disabled,
  );
  release();
  await until(
    () =>
      a.state.aiRequests.length === beforeRequests + 1 && !$('#ai-regenerate-baseline').disabled,
  );
  a.aiRequests.create = originalCreate;
  const followup = a.state.aiRequests.at(-1);
  check(
    'Same-basis regeneration uses visible follow-up arguments and the original frozen baseline',
    followup.prompt === '추가 정렬 요청만 변경' &&
      followup.count === 4 &&
      followup.route === 'mcp' &&
      followup.basisRequestId === R.id &&
      !followup.basisCandidateId &&
      JSON.stringify(followup.baseline) === JSON.stringify(R.baseline) &&
      JSON.stringify(a.state.aiDraft) === newDraft,
  );
  change('#ai-request-list', R.id);
  await tick();
  $('.ai-request-details').open = true;
  check(
    'Switching requests restores the corresponding follow-up rather than borrowing another request settings',
    $('#ai-followup-prompt').value === '추가 정렬 요청만 변경' &&
      $('#ai-followup-count').value === '4',
  );
  click('#ai-regenerate-candidate');
  await until(
    () =>
      a.state.aiRequests.length === beforeRequests + 2 && !$('#ai-regenerate-baseline').disabled,
  );
  const child = a.state.aiRequests.at(-1);
  check(
    'Selected-candidate generation identifies that candidate and preserves all existing alternatives',
    child.basisRequestId === R.id &&
      child.basisCandidateId === candidate.id &&
      JSON.stringify(child.baseline) ===
        JSON.stringify(a.aiRequests.find(R.id).candidates[0].point) &&
      a.aiRequests.find(R.id).candidates.length === 1 &&
      content() === beforeAI,
  );
  await until(
    () => $('#ai-request-list').value === child.id && !$('#ai-regenerate-baseline').disabled,
  );
  $('.ai-followup-details').open = true;
  await tick();
  input('#ai-followup-prompt', '실패 후에도 유지할 추가 초안');
  await tick();
  a.aiRequests.create = async () => {
    throw Error('추가 생성 저장 실패 시험');
  };
  const failuresBefore = a.state.aiRequests.length;
  await until(
    () => $('#ai-request-list').value === child.id && !$('#ai-regenerate-baseline').disabled,
  );
  click('#ai-regenerate-baseline');
  await until(() => $('#ai-status').textContent.includes('저장 실패')).catch((error) => {
    throw Error(
      error.message +
        ': ' +
        JSON.stringify({
          status: $('#ai-status').textContent,
          disabled: $('#ai-regenerate-baseline').disabled,
          id: $('#ai-request-list').value,
          count: $('#ai-followup-count').value,
          route: $('#ai-followup-route').value,
        }),
    );
  });
  check(
    'Failed follow-up retains selected request/settings and does not consume a new draft',
    a.state.aiRequests.length === failuresBefore &&
      $('#ai-request-list').value === child.id &&
      $('#ai-followup-prompt').value === '실패 후에도 유지할 추가 초안' &&
      JSON.stringify(a.state.aiDraft) === newDraft,
  );
  a.aiRequests.create = originalCreate;
  frame.style.width = '720px';
  frame.style.height = '600px';
  await tick();
  const field = $('#ai-followup-prompt');
  field.scrollIntoView({ block: 'center' });
  await tick();
  const hit = (element) => {
    const r = element.getBoundingClientRect();
    return (
      r.width > 0 &&
      r.height > 0 &&
      element.contains(d.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
    );
  };
  check(
    'Narrow follow-up text and route remain reachable without horizontal page overflow',
    hit(field) && $('#ai-dialog').scrollWidth <= $('#ai-dialog').clientWidth + 1,
  );
  check(
    'Expanded follow-up keeps its final generation action reachable without closing another form',
    hit($('#ai-regenerate-baseline')) && !$('#ai-regenerate-baseline').disabled,
  );
  $('#ai-followup-route').scrollIntoView({ block: 'center' });
  await tick();
  check(
    'Narrow follow-up execution controls are hit targets rather than clipped fields',
    hit($('#ai-followup-route')) && hit($('#ai-followup-count')),
  );
  click('#ai-close');
  const payload = reviewPayload(
    a.state.snapshot,
    a.state.scene,
    $('#review-note').value,
    a.state.timeline,
    a.state.activity,
    a.state.activityHead,
    a.state.aiRequests,
    a.state.aiDraft,
    {
      handoffSettings: a.state.handoffSettings,
      implementationReviews: a.state.implementationReviews,
    },
  );
  const durable = JSON.stringify([
    a.state.scene.edits,
    a.state.scene.annotations,
    a.state.timeline,
    a.state.aiRequests,
    a.state.aiDraft,
  ]);
  await a.importFile(new w.File([JSON.stringify(payload)], 'context-035.uiclone.json'));
  await a.state.saving;
  check(
    'File roundtrip preserves edits, notes, complete branches and both original/submitted AI requests',
    JSON.stringify([
      a.state.scene.edits,
      a.state.scene.annotations,
      a.state.timeline,
      a.state.aiRequests,
      a.state.aiDraft,
    ]) === durable,
  );
  const id = a.state.snapshot.id,
    stored = await getDocument(id);
  check(
    'Temporary follow-up/settings/navigation state is not written into AI requests or documents',
    !JSON.stringify(stored).includes('실패 후에도 유지할 추가 초안') &&
      stored.aiDraft.prompt === '제출하지 않은 다른 검색 요청',
  );
  frame.src = '../editor.html?id=' + encodeURIComponent(id);
  await until(
    () => frame.contentWindow.ConsoleCanvas?.state.ready && frame.contentWindow.ConsoleCanvas !== a,
  );
  w = frame.contentWindow;
  d = frame.contentDocument;
  a = w.ConsoleCanvas;
  check(
    'IndexedDB reopen retains content and does not automatically reopen or submit tasks',
    JSON.stringify([
      a.state.scene.edits,
      a.state.scene.annotations,
      a.state.timeline,
      a.state.aiRequests,
      a.state.aiDraft,
    ]) === durable && !d.querySelector('dialog:modal'),
  );
  document.body.dataset.result = 'pass';
} catch (error) {
  results.push({ name: error.stack || String(error), passed: false });
  document.querySelector('#results').textContent = results
    .map((r) => (r.passed ? 'PASS ' : 'FAIL ') + r.name)
    .join('\n');
  document.body.dataset.result = 'fail';
}
document.querySelector('#status').textContent = JSON.stringify({
  passed: results.filter((r) => r.passed).length,
  failed: results.filter((r) => !r.passed).length,
  total: results.length,
});
