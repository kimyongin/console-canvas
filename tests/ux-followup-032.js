import { getDocument, saveCapture, saveSession } from '../db.js';
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
  const modals = () => [...d.querySelectorAll('dialog:modal')].map((e) => e.id).join();
  const canvasSignature = () =>
    JSON.stringify([
      a.state.snapshot.html,
      a.state.scene.edits,
      a.state.scene.annotations,
      a.state.timeline,
      a.state.revision,
    ]);
  const capture = structuredClone(a.state.snapshot);
  capture.id = crypto.randomUUID();
  capture.documentName = '별도 구현 결과';
  await saveCapture(capture);
  await saveSession(capture.id, { documentName: capture.documentName });
  const nodes = [...a.state.scene.nodes.values()]
    .filter((n) => n.kind === 'text' && !n.scopeHidden)
    .slice(0, 30);
  for (const count of [3, 10, 30]) {
    for (const node of nodes.slice(0, count))
      a.state.scene.setComment(
        node.id,
        '요청: 정렬·간격과 반응형 배치를 확인해 주세요. ' + node.id,
      );
    click('#implementation-button');
    await until(() => $('#implementation-dialog').open);
    if (count > 3) {
      click('#implementation-new');
      await until(() => a.state.implementationReviews.at(-1).requests.length === count);
    }
    await until(() => !$('#implementation-result').disabled);
    change('#implementation-result', capture.id);
    await until(
      () =>
        d.querySelectorAll('.implementation-frame iframe').length === 2 &&
        !$('#implementation-visual-picker').disabled,
    );
    const review = a.state.implementationReviews.at(-1),
      before = canvasSignature();
    change('[aria-label="구현 비교 확대"]', '1');
    await tick();
    const f = $('.implementation-frame'),
      comparison = $('.implementation-comparison');
    check(
      `100% comparison keeps content inside allocated frame for ${count}`,
      f.clientHeight <= comparison.clientHeight && f.scrollHeight > f.clientHeight,
    );
    f.scrollTop = 500;
    f.scrollLeft = 200;
    await tick();
    check(
      `100% lower and right content is reachable for ${count}`,
      f.scrollTop > 0 && f.scrollLeft > 0,
    );
    click('#implementation-focus-request');
    await tick();
    const h = f.querySelector('.compare-target-highlight').getBoundingClientRect(),
      box = f.getBoundingClientRect();
    check(
      `Explicit request focus brings the target into view for ${count}`,
      h.right > box.left && h.left < box.right && h.bottom > box.top && h.top < box.bottom,
    );
    const picks = d.querySelectorAll('.implementation-request-pick');
    picks[picks.length - 1].click();
    await tick();
    input(`[aria-label="요청 ${count} 검토 메모"]`, '보존할 검토 메모');
    await a.state.saving;
    await tick();
    const list = $('.implementation-request-list');
    list.scrollTop = list.scrollHeight;
    await tick();
    const aside = $('.implementation-requests').getBoundingClientRect(),
      nav = $('#implementation-next-pending').getBoundingClientRect();
    check(
      `Review navigation remains visible while scrolling ${count} requests`,
      nav.top >= aside.top && nav.bottom <= aside.bottom && list.scrollTop > 0,
    );
    click('#implementation-next-pending');
    await tick();
    check(
      `Next pending remains one action from the bottom for ${count}`,
      !$('.implementation-request-list .is-current').textContent.startsWith(count + '.') &&
        review.requests[count - 1].note === '보존할 검토 메모',
    );
    await until(() => !$('[data-verdict="done"]').disabled);
    click('[data-verdict="done"]');
    await until(
      () => review.requests.some((r) => r.status === 'done') && !$('#implementation-new').disabled,
    );
    check('Comparison and request navigation preserve canvas data', canvasSignature() === before);
    $('#implementation-dialog').close();
    await tick();
  }
  // Full-size PNG inspection, unchanged output and correct hotspot mapping.
  click('#export-button');
  await until(() => $('#handoff-preview').dataset.state === 'ready');
  await until(() => $('#handoff-preview img').naturalWidth > 0);
  const pngURL = $('#handoff-preview img').src,
    pngDimensions = [
      $('#handoff-preview img').naturalWidth,
      $('#handoff-preview img').naturalHeight,
    ],
    beforePNG = canvasSignature();
  change('#handoff-preview-zoom', '1');
  click('#handoff-preview-wide');
  await tick();
  await tick();
  const pngScroll = $('.handoff-preview-scroll');
  pngScroll.scrollTop = pngScroll.scrollHeight;
  pngScroll.scrollLeft = 200;
  await tick();
  const close = $('#export-dialog .dialog-close'),
    r = close.getBoundingClientRect();
  check(
    'Close remains visible and is the real hit target above a scrolled PNG',
    d.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === close,
  );
  check(
    '100% PNG is readable at original width with actual internal scrolling',
    $('#handoff-preview img').getBoundingClientRect().width === pngDimensions[0] &&
      pngScroll.scrollTop > 0 &&
      pngScroll.scrollLeft > 0,
  );
  check(
    'Preview zoom and wide view do not regenerate or alter the handoff',
    $('#handoff-preview img').src === pngURL && canvasSignature() === beforePNG,
  );
  const hotspot = d.querySelectorAll('.handoff-hotspot')[35] || $('.handoff-hotspot'),
    requestId = hotspot.dataset.requestId;
  hotspot.click();
  check(
    'Scaled image hotspot opens the exact request in a single modal',
    modals() === 'comment-dialog' && a.state.commentTarget === requestId,
  );
  click('#save-comment');
  await until(() => $('#export-dialog').open && $('#handoff-preview').dataset.state === 'ready');
  check(
    'Returning from a PNG request preserves zoom, wide view and exact request focus',
    $('#handoff-preview-zoom').value === '1' &&
      $('#export-dialog').dataset.previewWide === 'true' &&
      d.activeElement?.dataset.requestId === requestId,
  );
  close.click();
  await tick();
  check('Closing handoff returns to the editor without stray modals', !modals());
  // Naming, trash/recover, explicit deletion and rollback use existing storage queue.
  click('#implementation-button');
  await until(() => $('#implementation-dialog').open);
  const selected = $('#implementation-review-list').value,
    recordBefore = structuredClone(a.state.implementationReviews.find((r) => r.id === selected)),
    canvasBefore = canvasSignature();
  change('[aria-label="구현 비교 확대"]', '1');
  await tick();
  $('.implementation-frame').scrollTop = 80;
  const oldScroll = $('.implementation-frame').scrollTop;
  click('#implementation-records');
  await tick();
  check(
    'Records management is a subpage of the same modal',
    modals() === 'implementation-dialog' &&
      $('#implementation-page-title').textContent === '검토 기록 관리' &&
      $('.implementation-workspace').hidden,
  );
  click('#implementation-records-back');
  await tick();
  await tick();
  check(
    'Back from management preserves the existing comparison scroll',
    $('.implementation-frame').scrollTop === oldScroll,
  );
  click('#implementation-records');
  await tick();
  const record = () => d.querySelector(`[data-review-record="${selected}"]`);
  const button = (root, text) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent === text);
  button(record(), '이름 변경').click();
  await tick();
  input('[aria-label="검토 이름"]', '');
  $('.review-record-rename').requestSubmit();
  await until(() => $('#review-record-status').textContent.includes('1~120'));
  check(
    'Invalid record name leaves the draft and all prior review data intact',
    $('[aria-label="검토 이름"]').value === '' &&
      a.state.implementationReviews.find((r) => r.id === selected).name === undefined,
  );
  input('[aria-label="검토 이름"]', '1차 디자인 검수');
  $('.review-record-rename').requestSubmit();
  await until(() => !$('.review-record-rename'));
  check(
    'Renaming changes only record metadata',
    a.state.implementationReviews.find((r) => r.id === selected).name === '1차 디자인 검수' &&
      JSON.stringify(a.state.implementationReviews.find((r) => r.id === selected).requests) ===
        JSON.stringify(recordBefore.requests),
  );
  const transaction = w.IDBDatabase.prototype.transaction;
  w.IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
    if (mode === 'readwrite')
      throw new w.DOMException('record-write-failure', 'QuotaExceededError');
    return transaction.call(this, stores, mode, ...rest);
  };
  button(record(), '휴지통으로 이동').click();
  await until(() => $('#review-record-status').textContent.includes('record-write-failure'));
  check(
    'Storage failure rolls back trash and preserves current record',
    !a.state.implementationReviews.find((r) => r.id === selected).deletedAt &&
      $('#implementation-review-list').value === selected,
  );
  let backup;
  w.ConsoleCanvasDesktop = {
    saveFile: async (value) => {
      backup = JSON.parse(new TextDecoder().decode(value.bytes));
      return { canceled: false };
    },
  };
  click('#review-records-backup');
  await until(() => backup);
  check(
    'Emergency review backup remains available during DB failure',
    backup.implementationReviews.some((r) => r.name === '1차 디자인 검수') &&
      backup.timeline.entries.length === a.state.timeline.entries.length &&
      backup.snapshot.id === a.state.snapshot.id,
  );
  w.IDBDatabase.prototype.transaction = transaction;
  delete w.ConsoleCanvasDesktop;
  await until(() => !$('#review-records-backup').disabled);
  button(record(), '휴지통으로 이동').click();
  await until(
    () =>
      a.state.implementationReviews.find((r) => r.id === selected).deletedAt &&
      !$('#review-records-backup').disabled &&
      $('#implementation-review-list').value !== selected,
  );
  check(
    'Trashing selected review keeps its frozen content and selects a live fallback',
    JSON.stringify(a.state.implementationReviews.find((r) => r.id === selected).requests) ===
      JSON.stringify(recordBefore.requests) && $('#implementation-review-list').value !== selected,
  );
  click('#review-records-trash');
  await tick();
  button(record(), '복구').click();
  await until(
    () =>
      !a.state.implementationReviews.find((r) => r.id === selected).deletedAt &&
      !$('#review-records-backup').disabled &&
      $('#review-record-status').textContent.includes('복구했습니다'),
  );
  check(
    'Recovery does not implicitly apply the restored review or alter canvas',
    $('#implementation-review-list').value !== selected && canvasSignature() === canvasBefore,
  );
  click('#review-records-live');
  await tick();
  record().querySelector('summary').click();
  await until(() => !button(record(), '영구 삭제').disabled);
  button(record(), '영구 삭제').click();
  await until(() => $('.review-record-confirm'));
  button(record(), '취소').click();
  await tick();
  check(
    'Permanent deletion requires a separate explicit confirmation',
    a.state.implementationReviews.some((r) => r.id === selected) && !$('.review-record-confirm'),
  );
  button(record(), '검토 열기').click();
  await tick();
  await tick();
  check(
    'Opening a named record returns to its comparison without changing verdicts',
    $('#implementation-review-list').value === selected &&
      $('#implementation-review-list').selectedOptions[0].textContent.includes('1차 디자인 검수') &&
      JSON.stringify(a.state.implementationReviews.find((r) => r.id === selected).requests) ===
        JSON.stringify(recordBefore.requests),
  );
  // Compact viewport keeps the fixed controls and scrollable frames usable.
  frame.style.width = '720px';
  frame.style.height = '600px';
  await tick();
  check(
    '720x600 comparison keeps close, footer and bounded frames reachable',
    $('#implementation-export').getBoundingClientRect().bottom <=
      $('#implementation-dialog').getBoundingClientRect().bottom &&
      $('.implementation-frame').clientHeight > 40 &&
      d.documentElement.scrollWidth <= w.innerWidth,
  );
  click('#implementation-records');
  await tick();
  check(
    '720x600 record management fits one modal',
    modals() === 'implementation-dialog' &&
      $('.review-record-list').clientHeight > 40 &&
      d.documentElement.scrollWidth <= w.innerWidth,
  );
  $('#implementation-dialog').close();
  await tick();
  click('#export-button');
  await until(() => $('#handoff-preview').dataset.state === 'ready');
  check(
    '720x600 handoff keeps header and footer visible',
    $('#export-dialog .dialog-close').getBoundingClientRect().top >= 0 &&
      $('#download-review').getBoundingClientRect().bottom <= w.innerHeight &&
      $('.handoff-preview-scroll').clientHeight > 40 &&
      d.documentElement.scrollWidth <= w.innerWidth,
  );
  $('#export-dialog').close();
  await tick();
  frame.style.width = '1280px';
  frame.style.height = '720px';
  click('#implementation-button');
  await until(() => $('#implementation-dialog').open);
  click('#implementation-records');
  await tick();
  const other = a.state.implementationReviews.find((r) => r.id !== selected);
  button(d.querySelector(`[data-review-record="${other.id}"]`), '휴지통으로 이동').click();
  await until(() => a.state.implementationReviews.find((r) => r.id === other.id).deletedAt);
  $('#implementation-dialog').close();
  await tick();
  const managedPayload = reviewPayload(
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
  const managedSignature = JSON.stringify(managedPayload.implementationReviews);
  await a.importFile(new w.File([JSON.stringify(managedPayload)], 'named-records.uiclone.json'));
  await a.state.saving;
  check(
    'Named and trashed records keep actual result, verdict and memo through file round-trip',
    JSON.stringify(a.state.implementationReviews) === managedSignature &&
      a.state.implementationReviews.some((r) => r.name === '1차 디자인 검수') &&
      a.state.implementationReviews.some((r) => r.deletedAt && r.result),
  );
  // Twenty legacy records, bounded trash, active-slot recovery and explicit purge.
  const legacyBase = structuredClone(a.state.implementationReviews[0]);
  legacyBase.result = null;
  delete legacyBase.name;
  delete legacyBase.deletedAt;
  const legacy = Array.from({ length: 20 }, (_, i) => ({
    ...structuredClone(legacyBase),
    id: 'legacy-' + i,
  }));
  const legacyDoc = { ...(await getDocument(a.state.snapshot.id)), implementationReviews: legacy };
  await a.openSnapshot(legacyDoc);
  await a.state.saving;
  click('#implementation-button');
  await until(() => $('#implementation-dialog').open);
  check(
    'Legacy twenty-record document opens without eviction at capacity',
    a.state.implementationReviews.length === 20 &&
      $('#implementation-new').disabled &&
      !$('#implementation-records').disabled,
  );
  click('#implementation-records');
  await tick();
  const first = d.querySelector('[data-review-record="legacy-0"]');
  button(first, '휴지통으로 이동').click();
  await until(() => a.state.implementationReviews.find((r) => r.id === 'legacy-0').deletedAt);
  click('#implementation-records-back');
  await tick();
  click('#implementation-new');
  await until(
    () => a.state.implementationReviews.length === 21 && !$('#implementation-records').disabled,
  );
  check(
    'Trash frees one active slot without erasing any old record',
    a.state.implementationReviews.filter((r) => !r.deletedAt).length === 20 &&
      legacy.every((r) => a.state.implementationReviews.some((v) => v.id === r.id)),
  );
  click('#implementation-records');
  await tick();
  click('#review-records-trash');
  await tick();
  check(
    'Recovery at active capacity explains its disabled state',
    button(d.querySelector('[data-review-record="legacy-0"]'), '복구').disabled,
  );
  const complete = structuredClone(a.state.implementationReviews);
  while (complete.length < 40)
    complete.push({
      ...structuredClone(legacyBase),
      id: 'trash-' + complete.length,
      deletedAt: new Date().toISOString(),
    });
  $('#implementation-dialog').close();
  await tick();
  await a.openSnapshot({ ...legacyDoc, implementationReviews: complete });
  await a.state.saving;
  click('#implementation-button');
  await until(() => $('#implementation-dialog').open);
  click('#implementation-records');
  await tick();
  click('#review-records-trash');
  await tick();
  const trash = d.querySelector('[data-review-record="legacy-0"]');
  trash.querySelector('summary').click();
  button(trash, '영구 삭제').click();
  await tick();
  button(trash, '영구 삭제 확정').click();
  await until(() => a.state.implementationReviews.length === 39);
  check(
    'Confirmed cleanup at forty retained records removes only its exact target',
    !a.state.implementationReviews.some((r) => r.id === 'legacy-0') &&
      a.state.implementationReviews.some((r) => r.id === 'legacy-1'),
  );
  $('#implementation-dialog').close();
  await tick();
  const exported = reviewPayload(
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
  const signature = JSON.stringify(exported.implementationReviews);
  const onlyTrash = [
    { ...structuredClone(legacyBase), id: 'only-trash', deletedAt: new Date().toISOString() },
  ];
  await a.openSnapshot({ ...legacyDoc, implementationReviews: onlyTrash });
  await a.state.saving;
  click('#implementation-button');
  await until(() => $('#implementation-dialog').open);
  check(
    'All-trash history opens an empty workspace without silently creating a review',
    a.state.implementationReviews.length === 1 && $('#implementation-review-list').value === '',
  );
  click('#implementation-records');
  await tick();
  click('#review-records-trash');
  await tick();
  button(d.querySelector('[data-review-record="only-trash"]'), '복구').click();
  await until(() => !a.state.implementationReviews[0].deletedAt);
  click('#implementation-records-back');
  await tick();
  check(
    'Recovering the only record does not silently select or apply it',
    $('#implementation-review-list').value === '' && a.state.implementationReviews.length === 1,
  );
  $('#implementation-dialog').close();
  await tick();
  await a.importFile(new w.File([JSON.stringify(exported)], 'records-032.uiclone.json'));
  await a.state.saving;
  check(
    'File round-trip retains every active and trashed record',
    a.state.implementationReviews.length === 39 &&
      a.state.implementationReviews.some((r) => r.deletedAt) &&
      JSON.stringify(a.state.implementationReviews) === signature,
  );
  frame.src = '../editor.html?id=' + a.state.snapshot.id;
  await until(
    () => frame.contentWindow.ConsoleCanvas?.state.ready && frame.contentWindow.ConsoleCanvas !== a,
  );
  w = frame.contentWindow;
  d = frame.contentDocument;
  a = w.ConsoleCanvas;
  check(
    'Reload retains management metadata, trash and prior result states',
    JSON.stringify(a.state.implementationReviews) === signature,
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
