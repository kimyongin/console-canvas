import { applyImplementationFixture } from './implementation-fixture.js';
import { suggestDesignIntents, appendIntent, RESPONSIVE_INTENTS } from '../design-intent.js';
import { cleanImplementationReviews } from '../workflow-state.js';
import { getDocument, saveCapture, saveSession } from '../db.js';
import { reviewPayload } from '../export.js';
import { buildHandoffImage } from '../handoff-image.js';
const results = [],
  frame = document.querySelector('#editor'),
  source = document.querySelector('#implemented-source');
function check(name, value) {
  results.push({ name, passed: !!value });
  document.querySelector('#results').textContent = results
    .map((r) => (r.passed ? 'PASS ' : 'FAIL ') + r.name)
    .join('\n');
  if (!value) throw Error(name);
}
async function until(fn) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw Error('Timed out');
}
try {
  await until(
    () =>
      frame.contentWindow.ConsoleCanvas?.state.ready &&
      source.contentDocument?.querySelector('#new-customer'),
  );
  let win = frame.contentWindow,
    app = win.ConsoleCanvas,
    doc = frame.contentDocument;
  const click = (selector) => doc.querySelector(selector).click();
  const scene = app.state.scene,
    button = [...scene.nodes.values()].find((n) => n.locator?.id === 'new-customer');
  const filter = [...scene.nodes.values()].find((n) => n.locator?.id === 'customer-filter');
  const deleted = [...scene.elements].find(
    ([, el]) => el.matches('.stat') && el.textContent.includes('이번 달 신규'),
  )[0];
  const originalSource = source.contentDocument.documentElement.outerHTML;
  app.selectNode(button.id);
  const buttonRect = scene.rect(button.id),
    filterRect = scene.rect(filter.id);
  scene.setPosition(
    filterRect.x + filterRect.width - buttonRect.width - buttonRect.x - 8,
    filterRect.y - buttonRect.y + 8,
  );
  const toolbar = doc.querySelector('#selection-actions'),
    toolbarRect = toolbar.getBoundingClientRect(),
    frameRect = doc.querySelector('#scene-frame').getBoundingClientRect();
  const stableEdits = JSON.stringify(scene.edits),
    stableUndo = app.state.undo.length;
  doc
    .querySelector('#selection-toolbar-handle')
    .dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  check(
    'Selection toolbar avoids capture controls and can move without editing the scene',
    toolbarRect.top >= doc.querySelector('.artboard-caption').getBoundingClientRect().bottom &&
      toolbar.getBoundingClientRect().left < toolbarRect.left &&
      stableEdits === JSON.stringify(scene.edits) &&
      stableUndo === app.state.undo.length,
  );
  const proposed = suggestDesignIntents(scene, button.id);
  check(
    'Move proposes a region relationship without silently annotating or changing the layout',
    proposed.some((p) => p.text.includes('검색 영역')) && !scene.annotations[button.id],
  );
  click('#context-comment');
  const intentButtons = [...doc.querySelectorAll('#comment-intent-suggestions button')];
  intentButtons.find((b) => b.textContent.includes('검색 영역')).click();
  intentButtons.find((b) => b.textContent === '다음 줄·전체 너비').click();
  const beforeReplacing = doc.querySelector('#component-comment').value;
  intentButtons.find((b) => b.textContent === '세로로 쌓기').click();
  check(
    'Responsive choices replace only earlier preset lines and preserve the selected relationship',
    beforeReplacing.includes(RESPONSIVE_INTENTS[0].text) &&
      doc.querySelector('#component-comment').value.includes(RESPONSIVE_INTENTS[1].text) &&
      !doc.querySelector('#component-comment').value.includes(RESPONSIVE_INTENTS[0].text) &&
      doc.querySelector('#component-comment').value.includes('검색 영역'),
  );
  click('#save-comment');
  check(
    'Accepted suggestions become ordinary editable comments for image and MCP paths',
    scene.annotations[button.id].includes('검색 영역') &&
      scene.annotations[button.id].includes('세로로 쌓고'),
  );
  app.selectNode(deleted);
  scene.remove();
  const deletion = suggestDesignIntents(scene, deleted);
  check(
    'Deleted card suggests equal widths for its two surviving siblings',
    deletion.some((p) => p.label === '남은 2개 같은 너비'),
  );
  scene.callbacks.onCommentSelect(deleted);
  [...doc.querySelectorAll('#comment-intent-suggestions button')]
    .find((b) => b.textContent === '남은 2개 같은 너비')
    .click();
  [...doc.querySelectorAll('#comment-intent-suggestions button')]
    .find((b) => b.textContent === '세로로 쌓기')
    .click();
  click('#save-comment');
  check(
    'Reviewing a deleted target retains its comment and responsive intent',
    scene.hidden(deleted) && scene.annotations[deleted].includes('같은 비율'),
  );
  check(
    'Canvas edits never run original-source events or rewrite the original website',
    source.contentDocument.documentElement.outerHTML === originalSource,
  );
  const a = app.snapshotHistory.create('개발 전달 목표');
  await app.state.saving;
  const before = JSON.stringify([
    scene.edits,
    scene.annotations,
    app.state.timeline,
    app.state.revision,
    app.state.undo,
  ]);
  const png = await app.buildHandoffImage();
  check(
    'Single PNG contains automatic path, viewport, version and reference policy',
    png.blob.type === 'image/png' &&
      png.requests.length === 2 &&
      png.context.path.includes('/fixtures/console.html') &&
      png.context.viewport.width === 1360 &&
      png.context.mode === 'reference' &&
      png.context.policy.includes('주석 요청 우선'),
  );
  const pendingImage = app.controller.execute({
    name: 'get_review_image',
    document_id: app.state.snapshot.id,
    arguments: { editor_id: app.controller.metadata().editor_id },
  });
  app.state.handoffSettings = { mode: 'exact' };
  const staleImage = await pendingImage;
  check(
    'MCP rejects an image when its interpretation policy changes during rendering',
    !staleImage.ok && staleImage.error.code === 'revision_conflict',
  );
  app.state.handoffSettings = { mode: 'reference' };
  click('#export-button');
  await until(() => !doc.querySelector('#download-review').disabled);
  const mode = doc.querySelector('#handoff-mode');
  mode.value = 'exact';
  mode.dispatchEvent(new win.Event('change', { bubbles: true }));
  await until(() => app.state.handoffSettings.mode === 'exact');
  await until(() => !doc.querySelector('#handoff-verify').disabled);
  click('#handoff-verify');
  await until(
    () =>
      doc.querySelector('#implementation-dialog').open &&
      app.state.implementationReviews.length === 1,
  );
  let review = app.state.implementationReviews[0];
  check(
    'Starting implementation review freezes the chosen target and leaves all canvas history untouched',
    review.target.mode === 'exact' &&
      review.requests.length === 2 &&
      before ===
        JSON.stringify([
          scene.edits,
          scene.annotations,
          app.state.timeline,
          app.state.revision,
          app.state.undo,
        ]),
  );
  check(
    'No request is marked as implemented before a result is selected',
    review.requests.every((r) => r.status === 'pending') &&
      [...doc.querySelectorAll('.implementation-requests select[aria-label$="검토 상태"]')].every(
        (el) => el.disabled,
      ),
  );
  doc.querySelector('[aria-label="구현 결과 확인 닫기"]').click();

  // Simulate a development change in a separate web source, then really recapture it.
  const implemented = source.contentDocument;
  applyImplementationFixture(implemented);
  const capture = await UICloneCapture.capture(implemented);
  capture.documentName = '개발 반영 결과 · 새 캡처';
  await saveCapture(capture);
  await saveSession(capture.id, { documentName: capture.documentName });
  check(
    'Implementation fixture uses structural CSS and real parent membership instead of copied offsets',
    implemented.querySelectorAll('.stats .stat').length === 2 &&
      implemented.querySelector('#customer-filter #new-customer') &&
      getComputedStyle(implemented.querySelector('.stats')).gridTemplateColumns.split(' ')
        .length === 2,
  );
  click('#implementation-button');
  await until(() => doc.querySelector('#implementation-result option[value="' + capture.id + '"]'));
  const resultSelect = doc.querySelector('#implementation-result');
  resultSelect.value = capture.id;
  resultSelect.dispatchEvent(new win.Event('change', { bubbles: true }));
  await until(
    () =>
      app.state.implementationReviews[0].result &&
      doc.querySelectorAll('.implementation-frame iframe').length === 2,
  );
  review = app.state.implementationReviews[0];
  check(
    'A separately captured web page renders beside the frozen goal without replacing the active document',
    review.result.snapshot.id === capture.id &&
      app.state.snapshot.id !== capture.id &&
      scene.hidden(deleted) &&
      app.state.timeline.activeId === a.id,
  );
  await until(
    () => !doc.querySelector('[aria-label="요청 1 직접 판정"] [data-verdict="done"]').disabled,
  );
  const status = doc.querySelector('[aria-label="요청 1 직접 판정"] [data-verdict="done"]');
  status.click();
  const otherStatus = doc.querySelector('[aria-label="요청 2 검토 상태"]');
  otherStatus.value = 'change';
  otherStatus.dispatchEvent(new win.Event('change', { bubbles: true }));
  const request2 = review.requests[1];
  [...doc.querySelectorAll('.implementation-request-pick')][1].click();
  await until(() => doc.querySelector('[aria-label="요청 2 검토 메모"]'));
  const memo = doc.querySelector('[aria-label="요청 2 검토 메모"]');
  Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value').set.call(
    memo,
    '카드 간격을 16px로 통일해 주세요.',
  );
  memo.dispatchEvent(new win.Event('input', { bubbles: true }));
  await app.state.saving;
  const documentId = app.state.snapshot.id;
  check(
    'Per-request verification and notes persist independently of canvas undo',
    (await getDocument(documentId)).implementationReviews[0].requests[0].status === 'done' &&
      (await getDocument(documentId)).implementationReviews[0].requests[1].note.includes('16px') &&
      before ===
        JSON.stringify([
          scene.edits,
          scene.annotations,
          app.state.timeline,
          app.state.revision,
          app.state.undo,
        ]),
  );
  const followup = await buildHandoffImage(app.state.snapshot, scene, '', undefined, {
    requestIds: review.requests.filter((r) => r.status !== 'done').map((r) => r.id),
    requestNotes: Object.fromEntries(review.requests.map((r) => [r.id, r.note])),
    mode: review.target.mode,
    versionName: review.target.label,
  });
  check(
    'One follow-up PNG keeps only unfinished requests, their original numbers and review notes',
    followup.requests.length === 1 &&
      followup.requests[0].number === 2 &&
      followup.requests[0].text.includes('16px') &&
      followup.context.mode === 'exact',
  );
  // New result revision keeps the older verdicts but starts a fresh manual review.
  const changedButton = capture.nodes.find((n) => n.locator?.id === 'new-customer');
  await saveSession(capture.id, {
    documentName: capture.documentName,
    edits: { [changedButton.id]: { dx: 4, dy: 0 } },
  });
  const selectNew = doc.querySelector('#implementation-result');
  selectNew.value = capture.id;
  selectNew.dispatchEvent(new win.Event('change', { bubbles: true }));
  await until(() => app.state.implementationReviews.length === 2);
  check(
    'Selecting another result preserves earlier verdicts and resets only the new review',
    app.state.implementationReviews[0].requests[0].status === 'done' &&
      app.state.implementationReviews[1].requests.every((r) => r.status === 'pending'),
  );
  source.style.width = '640px';
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  check(
    'Implementation fixture expresses narrow-screen stacking and full-width action structurally',
    source.contentWindow
      .getComputedStyle(implemented.querySelector('.stats'))
      .gridTemplateColumns.split(' ').length === 1 &&
      implemented.querySelector('#new-customer').getBoundingClientRect().width >
        implemented.querySelector('#customer-filter').getBoundingClientRect().width * 0.8,
  );
  const mobile = await UICloneCapture.capture(implemented);
  mobile.documentName = '개발 반영 결과 · 640px';
  await saveCapture(mobile);
  await saveSession(mobile.id, { documentName: mobile.documentName });
  click('#implementation-refresh');
  await until(() => doc.querySelector('#implementation-result option[value="' + mobile.id + '"]'));
  const mobileSelect = doc.querySelector('#implementation-result');
  mobileSelect.value = mobile.id;
  mobileSelect.dispatchEvent(new win.Event('change', { bubbles: true }));
  await until(
    () =>
      app.state.implementationReviews.length === 3 && doc.querySelector('.implementation-warning'),
  );
  check(
    'Newly recaptured results can refresh in place and different widths are clearly identified',
    doc.querySelector('.implementation-warning').textContent.includes('서로 다른 기준 너비') &&
      app.state.implementationReviews[2].requests.every((r) => r.status === 'pending'),
  );
  const reviewList = doc.querySelector('#implementation-review-list');
  reviewList.value = review.id;
  reviewList.dispatchEvent(new win.Event('change', { bubbles: true }));
  await until(
    () =>
      doc
        .querySelector('[aria-label="요청 1 직접 판정"] [data-verdict="done"]')
        ?.getAttribute('aria-pressed') === 'true',
  );
  doc.querySelector('[aria-label="구현 결과 확인 닫기"]').click();
  const payload = reviewPayload(
    app.state.snapshot,
    scene,
    '',
    app.state.timeline,
    app.state.activity,
    app.state.activityHead,
    app.state.aiRequests,
    app.state.aiDraft,
    {
      handoffSettings: app.state.handoffSettings,
      implementationReviews: app.state.implementationReviews,
    },
  );
  await app.importFile(new win.File([JSON.stringify(payload)], 'workflow.uiclone.json'));
  check(
    'Portable roundtrip embeds implementation captures and retains target branches, comments and verdicts',
    app.state.implementationReviews.length === 3 &&
      new DOMParser()
        .parseFromString(app.state.implementationReviews[0].result.snapshot.html, 'text/html')
        .querySelectorAll('.stats .stat').length === 2 &&
      app.state.implementationReviews[0].requests[0].status === 'done' &&
      app.state.scene.annotations[deleted].includes('같은 비율') &&
      app.state.timeline.entries.some((e) => e.id === a.id),
  );
  const bad = structuredClone(payload);
  bad.implementationReviews[0].result.snapshot.nodes[0].rect.x = 'bad';
  const stableId = app.state.snapshot.id;
  let rejected = false;
  try {
    await app.importFile(new win.File([JSON.stringify(bad)], 'bad-review.uiclone.json'));
  } catch {
    rejected = true;
  }
  check(
    'Malformed embedded result is rejected before the active editor is replaced',
    rejected &&
      app.state.snapshot.id === stableId &&
      app.state.implementationReviews[0].requests[0].status === 'done',
  );
  const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  frame.src = '../editor.html?id=' + documentId;
  await loaded;
  await until(() => frame.contentWindow.ConsoleCanvas?.state.ready);
  win = frame.contentWindow;
  app = win.ConsoleCanvas;
  doc = frame.contentDocument;
  click('#implementation-button');
  await until(() => doc.querySelectorAll('.implementation-frame iframe').length === 2);
  check(
    'Fresh renderer restores the implementation review and actual captured result',
    app.state.implementationReviews.length === 3 &&
      app.state.implementationReviews[0].requests[1].note.includes('16px') &&
      app.state.handoffSettings.mode === 'exact',
  );
  check(
    'Inferred source matching is only a visual aid, never an automatic pass',
    app.state.implementationReviews[1].requests.every((r) => r.status === 'pending'),
  );
  frame.style.width = '700px';
  frame.style.height = '600px';
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const dialogRect = doc.querySelector('#implementation-dialog').getBoundingClientRect(),
    exportRect = doc.querySelector('#implementation-export').getBoundingClientRect(),
    closeRect = doc.querySelector('[aria-label="구현 결과 확인 닫기"]').getBoundingClientRect();
  check(
    'A compact 700×600 review retains reachable controls and scrollable request cards',
    dialogRect.left >= 0 &&
      dialogRect.right <= win.innerWidth &&
      dialogRect.bottom <= win.innerHeight &&
      exportRect.bottom <= dialogRect.bottom &&
      closeRect.top >= dialogRect.top &&
      doc.querySelector('.implementation-requests').clientHeight > 0 &&
      doc.documentElement.scrollWidth <= win.innerWidth,
  );
  frame.style.width = '1440px';
  frame.style.height = '1000px';
  doc.querySelector('[aria-label="구현 결과 확인 닫기"]').click();
  app.state.handoffSettings = { mode: 'reference' };
  click('#export-button');
  await until(() => !doc.querySelector('#handoff-verify').disabled);
  click('#handoff-verify');
  await until(() => app.state.implementationReviews.length === 4);
  check(
    'Changing image policy starts a separate review instead of reusing an earlier exact target',
    app.state.implementationReviews.at(-1).target.mode === 'reference' &&
      app.state.implementationReviews[0].target.mode === 'exact',
  );
  let overLimit = false;
  try {
    appendIntent('x'.repeat(4000), 'more');
  } catch {
    overLimit = true;
  }
  check('Intent length overflow is rejected instead of truncating existing comments', overLimit);
  const oldMeta = JSON.stringify(app.state.implementationReviews);
  let duplicate = false;
  try {
    cleanImplementationReviews(
      [app.state.implementationReviews[0], app.state.implementationReviews[0]],
      app.state.snapshot,
    );
  } catch {
    duplicate = true;
  }
  check(
    'Duplicate review IDs are rejected without changing stored review metadata',
    duplicate && oldMeta === JSON.stringify(app.state.implementationReviews),
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
