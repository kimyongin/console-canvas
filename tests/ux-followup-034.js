import { saveCapture, saveSession, getDocument } from '../db.js';
import { reviewPayload } from '../export.js';
const frame = document.querySelector('#editor'),
  results = [];
function check(name, passed, details) {
  results.push({ name, passed: !!passed });
  document.querySelector('#results').textContent = results
    .map((r) => (r.passed ? 'PASS ' : 'FAIL ') + r.name)
    .join('\n');
  if (!passed) throw Error(name + (details ? ': ' + JSON.stringify(details) : ''));
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
  const cancel = () => {
    const dialog = d.querySelector('dialog:modal');
    if (dialog.dispatchEvent(new w.Event('cancel', { cancelable: true }))) dialog.close();
  };
  const modal = () => [...d.querySelectorAll('dialog:modal')].map((e) => e.id).join();
  const signature = () =>
    JSON.stringify([
      a.state.snapshot.html,
      a.state.scene.edits,
      a.state.scene.annotations,
      a.state.timeline,
      a.state.activity,
    ]);
  const button = [...a.state.scene.nodes.values()].find((n) => n.locator?.id === 'new-customer'),
    other = [...a.state.scene.nodes.values()].find((n) => n.locator?.id === 'export-customers');
  const capture = structuredClone(a.state.snapshot);
  capture.id = crypto.randomUUID();
  capture.documentName = '별도 구현';
  await saveCapture(capture);
  await saveSession(capture.id, { documentName: capture.documentName });
  a.state.scene.setComment(button.id, '정렬 요청 A');
  a.state.scene.setComment(other.id, '삭제 전의 주석 요청');
  a.state.scene.remove(other.id);
  $('#review-note').value = '추가 설명 A';
  $('#review-note').dispatchEvent(new w.Event('change', { bubbles: true }));
  const A = a.snapshotHistory.create('같은 이름');
  a.state.scene.select(button.id);
  a.state.scene.nudge(8, 0);
  const B = a.snapshotHistory.create('같은 이름');
  await a.state.saving;
  click('#export-button');
  change('#handoff-version', A.id);
  change('#handoff-mode', 'exact');
  await until(() => $('#handoff-preview').dataset.state === 'ready');
  const excluded = $('#handoff-conflicts input');
  excluded.click();
  await until(
    () => $('#handoff-preview').dataset.state === 'ready' && $('#handoff-conflicts input').checked,
  );
  change('#handoff-preview-zoom', '1');
  await tick();
  $('.handoff-preview-scroll').scrollTop = 400;
  $('.handoff-preview-scroll').scrollLeft = 32;
  $('.export-options').scrollTop = 90;
  $('.handoff-preview-scroll').dispatchEvent(new w.Event('scroll'));
  const view = {
    top: $('.handoff-preview-scroll').scrollTop,
    left: $('.handoff-preview-scroll').scrollLeft,
    options: $('.export-options').scrollTop,
  };
  const initial = signature();
  click('#handoff-verify');
  await until(() => $('#implementation-dialog').open && $('#implementation-handoff-back'));
  check(
    'Verification replaces handoff with one modal and an explicit return',
    modal() === 'implementation-dialog' &&
      $('#implementation-handoff-back').getAttribute('aria-label') === '변경 내용 전달로 돌아가기',
  );
  change('#implementation-result', capture.id);
  await until(
    () =>
      d.querySelectorAll('.implementation-frame iframe').length === 2 &&
      !$('#implementation-result').disabled,
  );
  const request = a.state.implementationReviews.at(-1).requests.find((r) => r.id === button.id);
  const pick = () =>
    [...d.querySelectorAll('.implementation-request-pick')]
      .find((e) => e.textContent.startsWith(request.number + '.'))
      .click();
  pick();
  await tick();
  input(`[aria-label="요청 ${request.number} 검토 메모"]`, '판정과 메모 보존');
  await a.state.saving;
  await tick();
  $('.is-current [data-verdict="change"]').click();
  await until(
    () =>
      !$('#implementation-result').disabled &&
      a.state.implementationReviews.at(-1).requests.find((r) => r.id === button.id).status ===
        'change',
  );
  const reviewId = $('#implementation-review-list').value,
    reviewed = JSON.stringify(a.state.implementationReviews);
  click('#implementation-visual-picker');
  await tick();
  cancel();
  await tick();
  check(
    'First Escape returns from result picker to review, not all the way to handoff',
    modal() === 'implementation-dialog' && $('#implementation-results-visual').hidden,
  );
  click('#implementation-records');
  await tick();
  cancel();
  await tick();
  check(
    'Record management also returns one level before the handoff origin',
    modal() === 'implementation-dialog' && $('.review-records-page').hidden,
  );
  click('#implementation-handoff-back');
  await until(() => $('#export-dialog').open && $('#handoff-preview').dataset.state === 'ready');
  await tick();
  check(
    'Two-action review round-trip keeps the exact saved target and output policy',
    $('#handoff-version').value === A.id &&
      $('#handoff-mode').value === 'exact' &&
      modal() === 'export-dialog',
  );
  check(
    'Returning preserves excluded comments, preview scale and image scroll',
    $('#handoff-conflicts input').checked &&
      $('#handoff-preview-zoom').value === '1' &&
      Math.abs($('.handoff-preview-scroll').scrollTop - view.top) < 2 &&
      Math.abs($('.handoff-preview-scroll').scrollLeft - view.left) < 2,
  );
  check(
    'Return restores settings position, focus and frozen review contents',
    Math.abs($('.export-options').scrollTop - view.options) < 2 &&
      d.activeElement === $('#handoff-verify') &&
      JSON.stringify(a.state.implementationReviews) === reviewed &&
      signature() === initial,
  );
  click('#handoff-verify');
  await until(() => $('#implementation-dialog').open && $('#implementation-handoff-back'));
  cancel();
  await until(() => $('#export-dialog').open && $('#handoff-preview').dataset.state === 'ready');
  check(
    'Escape in the review workspace resumes the same handoff',
    $('#handoff-version').value === A.id && modal() === 'export-dialog',
  );
  click('#handoff-verify');
  await until(() => $('#implementation-dialog').open && $('#implementation-handoff-back'));
  pick();
  await tick();
  const backTransaction = w.IDBDatabase.prototype.transaction;
  w.IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
    if (mode === 'readwrite')
      throw new w.DOMException('handoff-return-write-failure', 'QuotaExceededError');
    return backTransaction.call(this, stores, mode, ...rest);
  };
  input(`[aria-label="요청 ${request.number} 검토 메모"]`, '저장 실패 중인 메모');
  await until(() =>
    $('#implementation-status').textContent.includes('handoff-return-write-failure'),
  );
  click('#implementation-handoff-back');
  await tick();
  await tick();
  check(
    'A storage failure blocks Back and preserves the current review task',
    modal() === 'implementation-dialog' &&
      !$('#export-dialog').open &&
      $('#implementation-review-list').value === reviewId &&
      signature() === initial,
  );
  w.IDBDatabase.prototype.transaction = backTransaction;
  input(`[aria-label="요청 ${request.number} 검토 메모"]`, '재시도 후 보존할 메모');
  await until(() => $('#implementation-status').textContent.includes('검토 내용을 저장했습니다'));
  click('#implementation-handoff-back');
  await until(() => $('#export-dialog').open && $('#handoff-preview').dataset.state === 'ready');
  check(
    'After a successful retry Back resumes the exact original handoff',
    $('#handoff-version').value === A.id &&
      a.state.implementationReviews
        .find((r) => r.id === reviewId)
        .requests.find((r) => r.id === button.id).note === '재시도 후 보존할 메모',
  );
  click('#handoff-verify');
  await until(() => $('#implementation-dialog').open);
  $('#implementation-dialog button[aria-label="구현 결과 확인 닫기"]').click();
  await tick();
  check(
    'Full Close ends the task rather than resurrecting the previous handoff',
    modal() === '' && !$('#snapshot-panel').matches(':popover-open'),
  );
  click('#implementation-button');
  await until(() => $('#implementation-dialog').open);
  check(
    'Global review has no stale handoff return',
    $('#implementation-review-list').value === reviewId && !$('#implementation-handoff-back'),
  );
  $('#implementation-dialog').close();
  await tick();
  // A selected graph node is passed by ID without restoring it. All navigation state stays local.
  click('#snapshot-dropdown');
  $(`[data-snapshot-id="${A.id}"]`).click();
  await tick();
  input('#snapshot-search', '같은 이름');
  change('#snapshot-preview-zoom', '1');
  await tick();
  $('#snapshot-graph-scroll').scrollLeft = 24;
  $('#snapshot-panel').scrollTop = 100;
  const graphView = {
    x: $('#snapshot-graph-scroll').scrollLeft,
    y: $('#snapshot-graph-scroll').scrollTop,
    top: $('#snapshot-panel').scrollTop,
  };
  click('#snapshot-handoff');
  await until(() => $('#export-dialog').open && $('#handoff-preview').dataset.state === 'ready');
  check(
    'Selected snapshot handoff takes one explicit action with no version re-selection',
    $('#handoff-version').value === A.id &&
      a.state.timeline.activeId === B.id &&
      signature() === initial &&
      !$('#snapshot-panel').matches(':popover-open'),
  );
  check(
    'Graph handoff exposes Back and keeps the canvas read-only',
    !$('#export-back').hidden && modal() === 'export-dialog' && a.state.snapshotPreviewId === A.id,
  );
  click('#handoff-verify');
  await until(() => $('#implementation-dialog').open);
  click('#implementation-handoff-back');
  await until(() => $('#export-dialog').open && $('#handoff-preview').dataset.state === 'ready');
  check(
    'Review return retains its graph origin without stacking dialogs',
    !$('#export-back').hidden &&
      $('#handoff-version').value === A.id &&
      modal() === 'export-dialog',
  );
  click('#export-back');
  await until(() => $('#snapshot-panel').matches(':popover-open'));
  await tick();
  await tick();
  check(
    'Back restores graph selection, search and preview scale',
    $('#snapshot-search').value === '같은 이름' &&
      $('#snapshot-preview-zoom').value === '1' &&
      a.state.snapshotPreviewId === A.id &&
      a.state.timeline.activeId === B.id,
  );
  check(
    'Back restores actual graph scroll and focus without changing canvas',
    Math.abs($('#snapshot-graph-scroll').scrollLeft - graphView.x) < 2 &&
      Math.abs($('#snapshot-graph-scroll').scrollTop - graphView.y) < 2 &&
      Math.abs($('#snapshot-panel').scrollTop - graphView.top) < 2 &&
      d.activeElement === $('#snapshot-handoff') &&
      signature() === initial,
  );
  click('#snapshot-handoff');
  await until(() => $('#export-dialog').open);
  cancel();
  await until(() => $('#snapshot-panel').matches(':popover-open'));
  await tick();
  check(
    'Escape from snapshot handoff goes back to the source graph',
    modal() === '' && a.state.snapshotPreviewId === A.id,
  );
  click('#snapshot-handoff');
  await until(() => $('#export-dialog').open);
  $('#export-dialog .dialog-close').click();
  await tick();
  check(
    'Full Close does not leave an old graph task active',
    modal() === '' && !$('#snapshot-panel').matches(':popover-open'),
  );
  click('#export-button');
  await until(() => $('#export-dialog').open && $('#handoff-preview').dataset.state === 'ready');
  check(
    'Normal global handoff still starts from current work, with no fake graph origin',
    $('#handoff-version').value === '@current' && $('#export-back').hidden,
  );
  $('#export-dialog').close();
  await tick();
  // Recover-only stays separate. The combined action opens only after durable success.
  click('#implementation-button');
  await until(() => $('#implementation-dialog').open && !$('#implementation-new').disabled);
  const countBeforeFresh = a.state.implementationReviews.length;
  click('#implementation-new');
  await until(
    () =>
      a.state.implementationReviews.length === countBeforeFresh + 1 &&
      !$('#implementation-new').disabled &&
      $('#implementation-review-list').value !== reviewId &&
      $('#implementation-review-list').value === a.state.implementationReviews.at(-1).id,
  );
  const currentId = $('#implementation-review-list').value;
  click('#implementation-records');
  await tick();
  const row = (id) => $(`[data-review-record="${id}"]`),
    btn = (root, text) => [...root.querySelectorAll('button')].find((e) => e.textContent === text);
  btn(row(reviewId), '휴지통으로 이동').click();
  await until(
    () =>
      a.state.implementationReviews.find((r) => r.id === reviewId).deletedAt &&
      $('#review-record-status').textContent.includes('휴지통으로 옮겼습니다') &&
      !$('#review-records-trash').disabled,
  );
  click('#review-records-trash');
  await tick();
  const preserved = JSON.stringify(
    a.state.implementationReviews.find((r) => r.id === reviewId).requests,
  );
  btn(row(reviewId), '복구').click();
  await until(
    () =>
      !a.state.implementationReviews.find((r) => r.id === reviewId).deletedAt &&
      $('#review-record-status').textContent.includes('검토를 복구했습니다') &&
      !$('#review-records-live').disabled,
  );
  check(
    'Recover alone does not select or apply the restored record',
    $('#implementation-review-list').value === currentId &&
      !$('.review-records-page').hidden &&
      signature() === initial,
    {
      selected: $('#implementation-review-list').value,
      currentId,
      manager: !$('.review-records-page').hidden,
      sameCanvas: signature() === initial,
    },
  );
  click('#review-records-live');
  await tick();
  btn(row(reviewId), '휴지통으로 이동').click();
  await until(
    () =>
      a.state.implementationReviews.find((r) => r.id === reviewId).deletedAt &&
      $('#review-record-status').textContent.includes('휴지통으로 옮겼습니다') &&
      !$('#review-records-trash').disabled,
  );
  click('#review-records-trash');
  await tick();
  const transaction = w.IDBDatabase.prototype.transaction;
  w.IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
    if (mode === 'readwrite')
      throw new w.DOMException('recover-open-write-failure', 'QuotaExceededError');
    return transaction.call(this, stores, mode, ...rest);
  };
  btn(row(reviewId), '복구하고 열기').click();
  await until(() => $('#review-record-status').textContent.includes('recover-open-write-failure'));
  check(
    'Failed recovery keeps the record in trash and the current review unchanged',
    !!a.state.implementationReviews.find((r) => r.id === reviewId).deletedAt &&
      $('#implementation-review-list').value === currentId &&
      !$('.review-records-page').hidden,
  );
  w.IDBDatabase.prototype.transaction = transaction;
  btn(row(reviewId), '복구하고 열기').click();
  await until(
    () => $('.review-records-page').hidden && $('#implementation-review-list').value === reviewId,
  );
  check(
    'Recover and Open is one action after a successful save',
    !a.state.implementationReviews.find((r) => r.id === reviewId).deletedAt &&
      JSON.stringify(a.state.implementationReviews.find((r) => r.id === reviewId).requests) ===
        preserved &&
      signature() === initial &&
      modal() === 'implementation-dialog',
  );
  $('#implementation-dialog').close();
  await tick();
  // Narrow layouts keep origin Back, Close and the final output action reachable.
  frame.style.width = '720px';
  frame.style.height = '600px';
  await tick();
  click('#snapshot-dropdown');
  $(`[data-snapshot-id="${A.id}"]`).click();
  click('#snapshot-handoff');
  await until(() => $('#export-dialog').open && $('#handoff-preview').dataset.state === 'ready');
  const hit = (element) => {
    const r = element.getBoundingClientRect();
    return d.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === element;
  };
  check(
    'Small handoff has actual hit targets for Back, Close and output',
    hit($('#export-back')) && hit($('#export-dialog .dialog-close')) && hit($('#download-review')),
  );
  click('#handoff-verify');
  await until(() => $('#implementation-dialog').open);
  check('Small review return is an actual visible button', hit($('#implementation-handoff-back')));
  $('#implementation-dialog').close();
  await tick();
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
      implementationReviews: a.state.implementationReviews,
      handoffSettings: a.state.handoffSettings,
    },
  );
  const keep = JSON.stringify([
    a.state.scene.edits,
    a.state.scene.annotations,
    a.state.timeline,
    a.state.implementationReviews,
  ]);
  click('#export-button');
  await until(() => $('#export-dialog').open && $('#handoff-preview').dataset.state === 'ready');
  click('#handoff-verify');
  await until(() => $('#implementation-dialog').open);
  await a.openSnapshot(capture);
  await tick();
  await tick();
  check(
    'Changing documents discards the old return task without reopening its image or graph',
    a.state.snapshot.id === capture.id &&
      modal() === '' &&
      !$('#snapshot-panel').matches(':popover-open'),
  );
  await a.importFile(new w.File([JSON.stringify(payload)], 'navigation-034.uiclone.json'));
  await a.state.saving;
  check(
    'File round-trip preserves comments, both branches and original review judgments',
    keep ===
      JSON.stringify([
        a.state.scene.edits,
        a.state.scene.annotations,
        a.state.timeline,
        a.state.implementationReviews,
      ]),
  );
  const id = a.state.snapshot.id,
    stored = await getDocument(id);
  frame.src = '../editor.html?id=' + id;
  await until(
    () => frame.contentWindow.ConsoleCanvas?.state.ready && frame.contentWindow.ConsoleCanvas !== a,
  );
  w = frame.contentWindow;
  d = frame.contentDocument;
  a = w.ConsoleCanvas;
  check(
    'Durable reopen retains reviews and never persists task-return callbacks',
    JSON.stringify(a.state.implementationReviews) ===
      JSON.stringify(stored.implementationReviews) &&
      !$('#export-dialog').open &&
      !$('#implementation-dialog').open,
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
