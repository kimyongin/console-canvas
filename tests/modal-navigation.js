import { getDocument, getDocumentMetadata } from '../db.js';
const frame = document.querySelector('#editor'),
  results = [];
function check(name, value) {
  results.push({ name, passed: !!value });
  document.querySelector('#results').textContent = results
    .map((r) => (r.passed ? 'PASS ' : 'FAIL ') + r.name)
    .join('\n');
  if (!value) throw Error(name);
}
async function until(fn) {
  const end = Date.now() + 25000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw Error('Timed out');
}
const tick = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
try {
  await until(() => frame.contentWindow.ConsoleCanvas?.state.ready);
  const w = frame.contentWindow,
    d = frame.contentDocument,
    a = w.ConsoleCanvas,
    $ = (s) => d.querySelector(s),
    click = (s) => $(s).click();
  const input = (s, value) => {
    const e = $(s);
    Object.getOwnPropertyDescriptor(
      e.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype,
      'value',
    ).set.call(e, value);
    e.dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  const modals = () => [...d.querySelectorAll('dialog:modal')].map((e) => e.id);
  const cancel = () =>
    d.querySelector('dialog:modal').dispatchEvent(new w.Event('cancel', { cancelable: true }));
  const signature = () =>
    JSON.stringify([
      a.state.snapshot.html,
      a.state.scene.edits,
      a.state.scene.annotations,
      a.state.timeline,
      a.state.revision,
    ]);
  const node = [...a.state.scene.nodes.values()].find((n) => n.locator?.id === 'new-customer');
  a.selectNode(node.id);
  a.state.scene.setComment(node.id, '요청 위치와 초점을 보존');
  await a.state.saving;
  click('#implementation-button');
  await until(() => $('#implementation-dialog').open);
  const before = signature();
  await until(() => $('.implementation-frame iframe'));
  const zoom = $('select[aria-label="구현 비교 확대"]');
  zoom.value = '1';
  zoom.dispatchEvent(new w.Event('change', { bubbles: true }));
  await tick();
  $('.implementation-frame').scrollLeft = 140;
  $('.implementation-frame').scrollTop = 100;
  const comparisonScroll = [
    $('.implementation-frame').scrollLeft,
    $('.implementation-frame').scrollTop,
  ];
  click('#implementation-visual-picker');
  await tick();
  check(
    'Result selection replaces the modal body without a floating picker',
    modals().join() === 'implementation-dialog' &&
      !$('#implementation-results-visual').hidden &&
      !$('#implementation-results-visual').hasAttribute('popover') &&
      $('.implementation-workspace').hidden,
  );
  input('#implementation-result-search', 'remember-query');
  await tick();
  cancel();
  await tick();
  await tick();
  check(
    'Escape from result selection returns to the same review without closing it',
    modals().join() === 'implementation-dialog' &&
      $('#implementation-results-visual').hidden &&
      d.activeElement === $('#implementation-visual-picker') &&
      signature() === before,
  );
  check(
    'Returning from selection preserves comparison zoom and scroll',
    zoom.value === '1' &&
      $('.implementation-frame').scrollLeft === comparisonScroll[0] &&
      $('.implementation-frame').scrollTop === comparisonScroll[1],
  );
  click('#implementation-visual-picker');
  await tick();
  check(
    'Reopening result selection preserves search and its independent route',
    $('#implementation-result-search').value === 'remember-query' &&
      d.activeElement === $('#implementation-result-search'),
  );
  $('#implementation-result-search').dispatchEvent(
    new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  await tick();
  check(
    'Escape inside nonempty search returns without consuming the preserved query',
    $('#implementation-results-visual').hidden &&
      $('#implementation-result-search').value === 'remember-query' &&
      $('#implementation-dialog').open,
  );
  click('#implementation-visual-picker');
  await tick();
  frame.style.width = '720px';
  await tick();
  const rect = $('#implementation-results-visual').getBoundingClientRect();
  check(
    'Inline result selection fits a 720px modal',
    rect.left >= 0 &&
      rect.right <= w.innerWidth &&
      rect.bottom <= w.innerHeight &&
      d.documentElement.scrollWidth <= w.innerWidth,
  );
  frame.style.width = '1280px';
  $('#implementation-dialog').close();
  await tick();
  click('#document-menu-button');
  click('#documents-button');
  await until(() => d.querySelector('[data-document-action="rename"]'));
  const documentId = a.state.snapshot.id,
    originalTitle = (await getDocumentMetadata(documentId)).title;
  const renameButton = () =>
    d.querySelector('[data-document-card="' + documentId + '"] [data-document-action="rename"]');
  renameButton().click();
  await tick();
  check(
    'Document rename edits its card with only the document list modal open',
    !!$('.document-inline-rename input') &&
      modals().join() === 'documents-dialog' &&
      !$('#rename-dialog').open,
  );
  input('.document-inline-rename input', '');
  $('.document-inline-rename').requestSubmit();
  await tick();
  check(
    'Empty document name retains inline draft with a local error',
    $('.document-inline-rename [role="alert"]') &&
      (await getDocumentMetadata(documentId)).title === originalTitle,
  );
  input('.document-inline-rename input', '남길 초안');
  $('.document-inline-rename input').dispatchEvent(
    new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  await tick();
  check(
    'Escape cancels only inline rename and preserves the list',
    !$('.document-inline-rename') &&
      $('#documents-dialog').open &&
      (await getDocumentMetadata(documentId)).title === originalTitle,
  );
  renameButton().click();
  await tick();
  input('.document-inline-rename input', '변경한 화면 이름');
  const transaction = w.IDBDatabase.prototype.transaction;
  w.IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
    if (mode === 'readwrite') throw new w.DOMException('rename-test-failure', 'QuotaExceededError');
    return transaction.call(this, stores, mode, ...rest);
  };
  $('.document-inline-rename').requestSubmit();
  await until(() => $('.document-inline-rename [role="alert"]'));
  check(
    'Storage failure keeps the inline name and blocks no surrounding dialog',
    $('.document-inline-rename input').value === '변경한 화면 이름' &&
      modals().join() === 'documents-dialog',
  );
  w.IDBDatabase.prototype.transaction = transaction;
  $('.document-inline-rename').requestSubmit();
  await until(() => !$('.document-inline-rename'));
  check(
    'Retry saves document metadata without changing original capture or versions',
    (await getDocumentMetadata(documentId)).title === '변경한 화면 이름' && signature() === before,
  );
  $('#documents-dialog').close();
  await tick();
  click('#ai-variants-button');
  await tick();
  input('#ai-prompt', '같은 요청으로 돌아오기');
  click('#ai-store-only');
  await until(() => $('#ai-connect-agent'));
  const request = $('#ai-request-list').value;
  $('.ai-new-request summary').click();
  await tick();
  input('#ai-prompt', '보존할 작성 중 초안');
  click('#ai-connect-agent');
  await tick();
  check(
    'AI connection uses the existing AI modal and shared connection form',
    modals().join() === 'ai-dialog' &&
      !$('#ai-connection-page').hidden &&
      $('#ai-connection-host #mcp-code') &&
      !$('#mcp-dialog').open,
  );
  cancel();
  await tick();
  check(
    'Escape from connection restores the selected AI request and trigger',
    $('#ai-connection-page').hidden &&
      $('#ai-request-list').value === request &&
      d.activeElement === $('#ai-connect-agent') &&
      modals().join() === 'ai-dialog',
  );
  check(
    'AI connection back preserves the unfinished composition form',
    $('.ai-new-request').open && $('#ai-prompt').value === '보존할 작성 중 초안',
  );
  $('.ai-new-request summary').click();
  await tick();
  await a.aiRequests.register({
    request_id: request,
    name: '복귀 확인 후보',
    summary: '스크롤과 후보 유지',
    patches: [{ type: 'style', element_id: node.id, properties: { 'border-radius': '12px' } }],
  });
  await until(() => $('.ai-preview-scroll iframe'));
  for (const select of d.querySelectorAll('.ai-preview-heading select')) {
    select.value = '1';
    select.dispatchEvent(new w.Event('change', { bubbles: true }));
  }
  await tick();
  const aiFrame = $('.ai-preview-scroll');
  aiFrame.scrollLeft = 120;
  aiFrame.scrollTop = 80;
  const aiScroll = [aiFrame.scrollLeft, aiFrame.scrollTop];
  click('#ai-connect-agent');
  await tick();
  click('#ai-connection-back');
  await tick();
  await tick();
  check(
    'AI connection preserves candidate preview zoom and scroll',
    aiFrame.scrollLeft === aiScroll[0] &&
      aiFrame.scrollTop === aiScroll[1] &&
      $('.ai-preview-heading select').value === '1',
  );
  click('#ai-connect-agent');
  await tick();
  click('[aria-label="AI 연결 설정 닫기"]');
  await tick();
  check(
    'Closing AI connection ends the task and restores standalone form ownership',
    !modals().length && $('#mcp-dialog #mcp-code') && !$('#ai-connection-host #mcp-code'),
  );
  click('#mcp-button');
  check('Direct connection remains a single standalone dialog', modals().join() === 'mcp-dialog');
  $('#mcp-dialog').close();
  await tick();
  const photo = d.createElement('canvas');
  photo.width = 100;
  photo.height = 100;
  photo.getContext('2d').fillRect(0, 0, 100, 100);
  const png = photo.toDataURL();
  const fixture = structuredClone(a.state.snapshot),
    url = 'https://modal-test.invalid/image.png';
  fixture.id = crypto.randomUUID();
  fixture.screenshot = png;
  fixture.screenshotTiles = [{ data: png, rect: { x: 0, y: 0, width: 100, height: 100 } }];
  fixture.html = fixture.html.replace(
    '</body>',
    `<img data-uic-id="n999999" src="${url}" width="80" height="60"></body>`,
  );
  fixture.nodes.push({
    id: 'n999999',
    tag: 'img',
    parentId: null,
    name: '누락 이미지',
    kind: 'element',
    visible: true,
    position: 'static',
    rect: { x: 0, y: 0, width: 80, height: 60 },
    locator: {},
    image: { url, mode: 'screenshot' },
  });
  await a.openSnapshot(fixture);
  w.ConsoleCanvasDesktop = { retryAssets: async (urls) => urls.map((url) => ({ url, data: png })) };
  click('#capture-status-button');
  $('#capture-status-dialog').scrollTop = 60;
  const infoScroll = $('#capture-status-dialog').scrollTop;
  $('#source-compare-button').focus();
  click('#source-compare-button');
  await until(() => $('#source-compare-clone iframe'));
  check(
    'Information and photo comparison share one native modal',
    modals().join() === 'capture-status-dialog' &&
      $('#capture-status-dialog').dataset.page === 'source' &&
      !$('#capture-task-back').hidden &&
      $('#source-compare-dialog').tagName === 'SECTION',
  );
  cancel();
  await tick();
  check(
    'Photo comparison Escape restores information scroll and original button',
    $('#capture-status-dialog').dataset.page === 'info' &&
      d.activeElement === $('#source-compare-button') &&
      $('#capture-status-dialog').scrollTop === infoScroll,
  );
  click('#capture-task-close');
  await tick();
  click('#direct-source-compare');
  await until(() => $('#source-compare-clone iframe'));
  check(
    'Direct photo comparison has no misleading information back route',
    $('#capture-task-back').hidden && modals().join() === 'capture-status-dialog',
  );
  click('#capture-task-close');
  await tick();
  click('#capture-status-button');
  click('#repair-assets-button');
  check(
    'Asset repair is another page in the same modal',
    modals().join() === 'capture-status-dialog' &&
      $('#capture-status-dialog').dataset.page === 'repair',
  );
  let finish;
  w.ConsoleCanvasDesktop.retryAssets = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  click('#repair-assets-fetch');
  await until(() => finish);
  click('#capture-task-back');
  await tick();
  finish([{ url, data: png }]);
  await tick();
  check(
    'Leaving repair ignores late responses and preserves information',
    $('#capture-status-dialog').dataset.page === 'info' &&
      !a.state.scene.codePatches.length &&
      !$('#repair-assets-preview iframe'),
  );
  w.ConsoleCanvasDesktop.retryAssets = async (urls) => urls.map((url) => ({ url, data: png }));
  click('#repair-assets-button');
  click('#repair-assets-fetch');
  await until(() => !$('#repair-assets-apply').disabled);
  click('#repair-assets-apply');
  await tick();
  check(
    'Applying repair returns to refreshed information without stacking modals',
    modals().join() === 'capture-status-dialog' &&
      $('#capture-status-dialog').dataset.page === 'info' &&
      a.state.scene.codePatches.length === 1 &&
      $('#capture-repair-summary').textContent.includes('1개 적용'),
  );
  click('#capture-task-close');
  await tick();
  delete w.ConsoleCanvasDesktop;
  a.selectNode(node.id);
  a.state.scene.setComment(node.id, '전달 요청 복귀');
  click('#export-button');
  await until(() => !$('#handoff-verify').disabled);
  const trigger = $('#handoff-items [data-request-id="' + node.id + '"]');
  trigger.click();
  check('Handoff comment editing has only one active modal', modals().join() === 'comment-dialog');
  click('#save-comment');
  await until(() => $('#export-dialog').open && d.activeElement?.dataset.requestId === node.id);
  check(
    'Handoff restores the exact request focus after image regeneration',
    modals().join() === 'export-dialog' && a.state.scene.annotations[node.id] === '전달 요청 복귀',
  );
  $('#export-dialog').close();
  await tick();
  click('#capture-status-button');
  click('#source-compare-button');
  await until(() => $('#source-compare-clone iframe'));
  const next = structuredClone(a.state.snapshot);
  next.id = crypto.randomUUID();
  await a.openSnapshot(next);
  await tick();
  check(
    'Document replacement closes the capture workspace without reopening old pages',
    !modals().length && $('#capture-info-view').hidden === false,
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
