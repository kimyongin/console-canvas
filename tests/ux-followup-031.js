import { getDocument, saveCapture, saveSession, getDocumentMetadata } from '../db.js';
import { reviewPayload } from '../export.js';
const frame = document.querySelector('#editor'),
  results = [];
function check(name, passed) {
  results.push({ name, passed: !!passed });
  document.querySelector('#results').textContent = results
    .map((r) => `${r.passed ? 'PASS' : 'FAIL'} ${r.name}`)
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
  function input(s, value) {
    const e = $(s),
      proto =
        e.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(e, value);
    e.dispatchEvent(new w.Event('input', { bubbles: true }));
  }
  function change(s, value) {
    $(s).value = value;
    $(s).dispatchEvent(new w.Event('change', { bubbles: true }));
  }
  const modals = () => [...d.querySelectorAll('dialog:modal')].map((e) => e.id).join();
  const button = [...a.state.scene.nodes.values()].find((n) => n.locator?.id === 'new-customer');
  const table = [...a.state.scene.nodes.values()].find((n) => n.tag === 'table');
  const capture = structuredClone(a.state.snapshot);
  capture.id = crypto.randomUUID();
  capture.documentName = '구현 결과';
  await saveCapture(capture);
  await saveSession(capture.id, { documentName: capture.documentName });
  // Name drafts survive removal of their cards and remain explicitly unsaved.
  click('#document-menu-button');
  click('#documents-button');
  await until(() => $('[data-document-card] [data-document-action="rename"]'));
  const id = a.state.snapshot.id,
    originalTitle = (await getDocumentMetadata(id)).title;
  $(`[data-document-card="${id}"] [data-document-action="rename"]`).click();
  await tick();
  input('.document-inline-rename input', '보존할 이름 초안');
  input('#document-search', 'no-such-document');
  await tick();
  check(
    'Filtering a name draft announces an explicit unsaved draft',
    $('.name-draft-status').textContent.includes('1개') && !$('.document-inline-rename'),
  );
  input('#document-search', '');
  await tick();
  check(
    'Clearing search restores the exact name draft without saving',
    $('.document-inline-rename input').value === '보존할 이름 초안' &&
      (await getDocumentMetadata(id)).title === originalTitle,
  );
  click('#documents-trash');
  await tick();
  click('#documents-live');
  await until(() => $('.document-inline-rename input'));
  check(
    'Trash tab round-trip retains a name draft for its document',
    $('.document-inline-rename input').value === '보존할 이름 초안',
  );
  $('#documents-dialog').close();
  await tick();
  click('#document-menu-button');
  click('#documents-button');
  await until(() => $('.document-inline-rename input'));
  check(
    'Closing and reopening the document list retains the session name draft',
    $('.document-inline-rename input').value === '보존할 이름 초안',
  );
  $('.document-inline-rename button[type="button"]').click();
  await tick();
  check(
    'Explicit Cancel clears only the name draft',
    !$('.document-inline-rename') && !$('.name-draft-status'),
  );
  $('#documents-dialog').close();
  await tick();
  // 3, 10 and 30 mixed-status requests: filtering does not change the canvas or verdicts.
  const nodes = [...a.state.scene.nodes.values()]
    .filter((n) => n.kind === 'text' && !n.scopeHidden)
    .slice(0, 30);
  for (let count of [3, 10, 30]) {
    for (const node of nodes.slice(0, count))
      a.state.scene.setComment(node.id, '검토 요청 ' + node.id);
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
        a.state.implementationReviews.at(-1).result &&
        d.querySelectorAll('.implementation-frame iframe').length === 2,
    );
    const review = a.state.implementationReviews.at(-1);
    await until(() => !$('[data-verdict="done"]').disabled);
    click('[data-verdict="done"]');
    await until(
      () => review.requests[0].status === 'done' && !$('#implementation-next-pending').disabled,
    );
    input(`[aria-label="요청 1 검토 메모"]`, '유지할 검토 메모');
    await a.state.saving;
    await tick();
    const frozen = JSON.stringify([
      a.state.scene.edits,
      a.state.scene.annotations,
      a.state.timeline,
    ]);
    const reviewId = review.id,
      reviewCount = a.state.implementationReviews.length;
    change('#implementation-result', capture.id);
    await tick();
    await a.state.saving;
    await until(() => !$('#implementation-visual-picker').disabled);
    check(
      `Same frozen result is a no-op for ${count} requests`,
      a.state.implementationReviews.length === reviewCount &&
        $('#implementation-review-list').value === reviewId &&
        review.requests[0].note === '유지할 검토 메모' &&
        review.requests[0].status === 'done',
    );
    click('#implementation-visual-picker');
    await tick();
    check(
      `Current result is identified in picker for ${count} requests`,
      $('.result-visual-row[aria-current="true"]')?.textContent.includes('현재 검토에 사용 중'),
    );
    check(
      'Subtask header presents current title, back then close',
      $('#implementation-page-title').textContent === '구현 결과 선택' &&
        $('#implementation-results-back').getBoundingClientRect().left <
          $('#implementation-page-title').getBoundingClientRect().left &&
        $('#implementation-dialog').getAttribute('aria-labelledby') === 'implementation-page-title',
    );
    $('.result-visual-row[aria-current="true"]').click();
    await until(() => $('#implementation-results-visual').hidden);
    check(
      `Picker reselect preserves review and memo for ${count} requests`,
      a.state.implementationReviews.length === reviewCount &&
        review.requests[0].note === '유지할 검토 메모',
    );
    change('#implementation-request-filter', 'pending');
    await tick();
    check(
      `Pending scope excludes completed requests for ${count}`,
      d.querySelectorAll('.implementation-request-pick').length === count - 1 &&
        !$('.implementation-requests').textContent.includes('유지할 검토 메모'),
    );
    const requestNumber = $(
      '.implementation-requests .is-current .implementation-request-pick',
    ).textContent;
    click('#implementation-next-pending');
    await tick();
    check(
      `Next pending is one action without altering verdicts for ${count}`,
      $('.implementation-requests .is-current .implementation-request-pick').textContent !==
        requestNumber && review.requests.filter((r) => r.status === 'done').length === 1,
    );
    await until(() => !$('[data-verdict="change"]').disabled);
    click('[data-verdict="change"]');
    await until(() => review.requests.some((r) => r.status === 'change'));
    check(
      'Judged request stays visible outside its filter until explicit navigation',
      $('.implementation-request-navigation').textContent.includes('범위 밖') &&
        $('.implementation-requests .is-current [data-verdict="change"]').getAttribute(
          'aria-pressed',
        ) === 'true',
    );
    change('#implementation-request-filter', 'change');
    await tick();
    check(
      `Change and all scopes preserve original request numbers for ${count}`,
      d.querySelectorAll('.implementation-request-pick').length === 1 &&
        $('#implementation-request-filter option[value="pending"]').textContent.includes(
          String(count - 2),
        ),
    );
    change('#implementation-request-filter', 'all');
    await tick();
    check(
      'Filtering preserves canvas, annotations and branches',
      JSON.stringify([a.state.scene.edits, a.state.scene.annotations, a.state.timeline]) === frozen,
    );
    $('#implementation-dialog').close();
    await tick();
    if (count < 30) {
      a.state.scene.setComment(nodes[count].id, '다음 대상');
    }
  }
  // Same ID with changed edit state is a new result, not an accidental deduplication.
  await saveSession(capture.id, { edits: { [button.id]: { dx: 10, dy: 0 } } });
  click('#implementation-button');
  await until(() => $('#implementation-dialog').open);
  const previousCount = a.state.implementationReviews.length;
  change('#implementation-result', capture.id);
  await until(() => a.state.implementationReviews.length === previousCount + 1);
  check(
    'Changed state of same result ID starts a distinct review and preserves old judgments',
    a.state.implementationReviews.at(-1).requests.every((r) => r.status === 'pending') &&
      a.state.implementationReviews.at(-2).requests.some((r) => r.status === 'done'),
  );
  $('#implementation-dialog').close();
  await tick();
  // Branches and same-second, same-name selectors remain distinct.
  a.state.scene.setComment(button.id, '버전 A의 주석');
  const A = a.snapshotHistory.create('시안');
  await a.state.saving;
  a.selectNode(button.id);
  a.state.scene.nudge(10, 0);
  const B = a.snapshotHistory.create('시안');
  await a.state.saving;
  const duplicates = [];
  for (let i = 0; i < 10; i++) duplicates.push(a.snapshotHistory.create('시안'));
  const longName = '길고 같은 이름의 스냅샷 '.repeat(10).slice(0, 120);
  const longVersions = [a.snapshotHistory.create(longName), a.snapshotHistory.create(longName)];
  await a.state.saving;
  a.state.scene.setComment(button.id, '미저장 미래 주석');
  input('#review-note', '보존할 추가 설명');
  $('#review-note').dispatchEvent(new w.Event('change', { bubbles: true }));
  await a.state.saving;
  click('#export-button');
  await until(() => $('#handoff-preview').dataset.state === 'ready');
  const labels = [...$('#handoff-version').options]
    .filter((o) => o.textContent.includes(' · 시안'))
    .map((o) => o.textContent);
  check(
    'Twelve same-name snapshots have distinct readable version labels',
    labels.length === 12 &&
      new Set(labels).size === 12 &&
      labels.every((label) => label.includes('· v')),
  );
  const longLabels = [...$('#handoff-version').options]
    .filter((o) => longVersions.some((v) => v.id === o.value))
    .map((o) => o.textContent);
  check(
    'Long same-name versions expose their ordinal before the name can be clipped',
    longLabels.length === 2 &&
      new Set(longLabels).size === 2 &&
      longLabels.every((label) => /^스냅샷 · v\d+ · /.test(label)),
  );
  change('#handoff-version', A.id);
  await until(() => $('#handoff-preview').dataset.state === 'ready');
  const beforeRestore = JSON.stringify([
    a.state.scene.edits,
    a.state.scene.annotations,
    a.state.timeline,
  ]);
  check(
    'Selecting saved handoff version is read-only with explicit continuation',
    JSON.stringify([a.state.scene.edits, a.state.scene.annotations, a.state.timeline]) ===
      beforeRestore && !$('#handoff-continue').hidden,
  );
  $(`#handoff-items [data-request-id="${button.id}"]`).click();
  await until(() => $('#comment-dialog').open);
  check(
    'Saved-version request opens exact historical comment in one modal',
    $('#component-comment').value === '버전 A의 주석' &&
      a.state.timeline.activeId === A.id &&
      modals() === 'comment-dialog',
  );
  const automatic = a.state.timeline.entries.find(
    (e) => e.kind === 'automatic' && e.state.annotations[button.id] === '미저장 미래 주석',
  );
  check(
    'Continuation preserves dirty future note and all named future branches',
    automatic?.state.note === '보존할 추가 설명' &&
      a.state.timeline.entries.some((e) => e.id === B.id) &&
      duplicates.every((v) => a.state.timeline.entries.some((e) => e.id === v.id)),
  );
  input('#component-comment', 'A에서 분기한 D 주석');
  click('#save-comment');
  await until(() => $('#export-dialog').open && $('#handoff-preview').dataset.state === 'ready');
  check(
    'Edited request returns to current work with exact focus',
    $('#handoff-version').value === '@current' && d.activeElement?.dataset.requestId === button.id,
  );
  $('#export-dialog').close();
  await tick();
  const D = a.snapshotHistory.create('분기 D');
  await a.state.saving;
  check('New branch is parented to A rather than the most recent future', D.parentId === A.id);
  await a.snapshotHistory.restorePersisted(B.id);
  check(
    'Future B remains visitable after branching D',
    a.state.scene.annotations[button.id] === '버전 A의 주석' &&
      a.state.timeline.entries.some((e) => e.id === D.id),
  );
  click('#snapshot-dropdown');
  await until(() => !$('#snapshot-panel').hidden);
  click('#compare-button');
  await until(() => $('#compare-dialog').open);
  for (const side of ['left', 'right']) {
    const names = [...$('#compare-' + side).options]
      .filter((o) => o.textContent.includes(' · 시안'))
      .map((o) => o.textContent);
    check(
      'Both compare selectors distinguish same-name versions: ' + side,
      names.length === 12 && new Set(names).size === 12,
    );
  }
  $('#compare-dialog').close();
  await tick();
  click('#close-snapshots');
  a.state.scene.setComment(button.id, '실패해도 보존할 현재 주석');
  await a.state.saving;
  click('#export-button');
  await until(() => $('#handoff-preview').dataset.state === 'ready');
  change('#handoff-version', A.id);
  await until(() => $('#handoff-preview').dataset.state === 'ready');
  const protectedState = JSON.stringify([
    a.state.scene.edits,
    a.state.scene.annotations,
    a.state.timeline,
  ]);
  const transaction = w.IDBDatabase.prototype.transaction;
  let continuationWrites = 0;
  w.IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
    if (mode === 'readwrite' && ++continuationWrites > 1)
      throw new w.DOMException('continuation-save-failure', 'QuotaExceededError');
    return transaction.call(this, stores, mode, ...rest);
  };
  click('#handoff-continue');
  await until(() => $('#toast').textContent.includes('continuation-save-failure'));
  check(
    'Continuation failure protects current work and all branches',
    continuationWrites > 1 &&
      !a.state.transactionBusy &&
      protectedState ===
        JSON.stringify([a.state.scene.edits, a.state.scene.annotations, a.state.timeline]) &&
      $('#export-dialog').open &&
      $('#handoff-version').value === A.id,
  );
  w.IDBDatabase.prototype.transaction = transaction;
  await tick();
  click('#handoff-continue');
  await until(
    () =>
      $('#handoff-version').value === '@current' && $('#handoff-preview').dataset.state === 'ready',
  );
  check(
    'Explicit continuation retries safely and auto-preserves dirty work',
    a.state.timeline.activeId === A.id &&
      a.state.timeline.entries.some(
        (e) =>
          e.kind === 'automatic' && e.state.annotations[button.id] === '실패해도 보존할 현재 주석',
      ),
  );
  $('#export-dialog').close();
  await tick();
  await a.snapshotHistory.restorePersisted(B.id);
  // Compact/expanded preview changes only presentation, with a still-accessible Done footer.
  a.selectNode(table.id);
  click('#context-comment');
  input('#component-comment', '표 전체의 행 간격을 늘려 주세요.');
  const commentDraft = $('#component-comment').value,
    previewState = JSON.stringify([a.state.scene.edits, a.state.timeline]);
  click('#comment-preview-expand');
  await tick();
  change('[aria-label="주석 대상 확대"]', '1');
  await tick();
  check(
    'Large comment target can be viewed at 100% in the same modal',
    $('.target-crop iframe').style.transform === 'scale(1)' &&
      $('.target-preview-scroll').scrollWidth > $('.target-preview-scroll').clientWidth &&
      modals() === 'comment-dialog',
  );
  frame.style.width = '720px';
  frame.style.height = '600px';
  await tick();
  const doneRect = $('#save-comment').getBoundingClientRect();
  check(
    'Expanded preview keeps Done available at 720x600',
    doneRect.bottom <= w.innerHeight &&
      doneRect.right <= w.innerWidth &&
      d.documentElement.scrollWidth <= w.innerWidth,
  );
  click('#comment-preview-expand');
  await tick();
  check(
    'Preview toggle preserves text draft and branches without editing',
    $('#component-comment').value === commentDraft &&
      JSON.stringify([a.state.scene.edits, a.state.timeline]) === previewState,
  );
  click('#save-comment');
  await tick();
  frame.style.width = '1280px';
  frame.style.height = '800px';
  // Latest-note action queuing, duplicate suppression, cancellation, retry and fallback.
  click('#export-button');
  await until(() => $('#handoff-preview').dataset.state === 'ready');
  input('#review-note', '최종 추가 설명');
  $('#review-note').dispatchEvent(new w.Event('change', { bubbles: true }));
  click('#handoff-verify');
  await until(() => $('#implementation-dialog').open);
  check(
    'First verify intent waits for the exact latest note',
    a.state.implementationReviews.at(-1).target.point.note === '최종 추가 설명' &&
      !$('#export-dialog').open,
  );
  $('#implementation-dialog').close();
  await tick();
  let saves = 0,
    savedData;
  w.ConsoleCanvasDesktop = {
    saveFile: async (value) => {
      saves++;
      savedData = value;
      return { canceled: true };
    },
  };
  click('#export-button');
  await until(() => $('#handoff-preview').dataset.state === 'ready');
  input('#review-note', '저장 직전 추가 설명');
  $('#review-note').dispatchEvent(new w.Event('change', { bubbles: true }));
  click('#download-review');
  click('#download-review');
  await until(() => saves === 1 && $('#export-status').textContent.includes('취소'));
  check('First save waits for PNG once and reports save cancellation', saves === 1 && !!savedData);
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(w.navigator, 'clipboard');
  let copied = 0;
  Object.defineProperty(w.navigator, 'clipboard', {
    configurable: true,
    value: {
      write: async (items) => {
        const png = await items[0].getType('image/png');
        check('Clipboard receives the prepared PNG blob', png.type === 'image/png' && png.size > 0);
        copied++;
      },
    },
  });
  input('#review-note', '복사 직전 추가 설명');
  $('#review-note').dispatchEvent(new w.Event('change', { bubbles: true }));
  click('#copy-summary');
  await until(() => copied === 1);
  check('First copy waits for a latest-note PNG through ClipboardItem', copied === 1);
  Object.defineProperty(w.navigator, 'clipboard', {
    configurable: true,
    value: {
      write: async () => {
        throw Error('clipboard denied');
      },
    },
  });
  click('#copy-summary');
  await until(() => $('#export-status').textContent.includes('복사 실패'));
  check(
    'Clipboard failure exposes save fallback without discarding draft',
    $('#review-note').value === '복사 직전 추가 설명' && !$('#download-review').disabled,
  );
  if (clipboardDescriptor) Object.defineProperty(w.navigator, 'clipboard', clipboardDescriptor);
  else delete w.navigator.clipboard;
  const originalBlob = w.HTMLCanvasElement.prototype.toBlob;
  let release;
  w.HTMLCanvasElement.prototype.toBlob = function (...args) {
    w.HTMLCanvasElement.prototype.toBlob = originalBlob;
    release = () => originalBlob.apply(this, args);
  };
  input('#review-note', '대기 중인 저장');
  $('#review-note').dispatchEvent(new w.Event('change', { bubbles: true }));
  click('#download-review');
  await until(() => release);
  $('#export-dialog').close();
  await tick();
  check(
    'Closing releases the canceled intent without saving',
    saves === 1 && !$('#export-dialog').open,
  );
  click('#export-button');
  await until(() => $('#handoff-preview').dataset.state === 'ready');
  release();
  await tick();
  await tick();
  check(
    'Old image completion cannot block or overwrite a reopened handoff',
    saves === 1 &&
      $('#export-dialog').open &&
      !$('#download-review').disabled &&
      $('#handoff-preview').dataset.state === 'ready',
  );
  $('#export-dialog').close();
  await tick();
  delete w.ConsoleCanvasDesktop;
  // Review and branch state survive durable reload and file serialization.
  await a.state.saving;
  const persisted = await getDocument(a.state.snapshot.id);
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
  check(
    'File export preserves branches, comments and all original verdicts',
    payload.timeline.entries.some((e) => e.id === D.id) &&
      payload.implementationReviews.some((r) =>
        r.requests.some((q) => q.note === '유지할 검토 메모'),
      ),
  );
  await a.importFile(new w.File([JSON.stringify(payload)], 'ux-031.uiclone.json'));
  await a.state.saving;
  check(
    'File round-trip restores review judgments and sibling snapshots',
    a.state.timeline.entries.length === persisted.timeline.entries.length &&
      a.state.implementationReviews.length === persisted.implementationReviews.length,
  );
  const restoredSignature = JSON.stringify([
    a.state.scene.edits,
    a.state.scene.annotations,
    a.state.timeline,
    a.state.implementationReviews,
  ]);
  frame.src = '../editor.html?id=' + a.state.snapshot.id;
  await until(
    () => frame.contentWindow.ConsoleCanvas?.state.ready && frame.contentWindow.ConsoleCanvas !== a,
  );
  w = frame.contentWindow;
  d = frame.contentDocument;
  a = w.ConsoleCanvas;
  check(
    'Reload restores comments, full branch tree and review verdicts from IndexedDB',
    restoredSignature ===
      JSON.stringify([
        a.state.scene.edits,
        a.state.scene.annotations,
        a.state.timeline,
        a.state.implementationReviews,
      ]),
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
