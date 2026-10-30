import { getDocument } from '../db.js';
const results = [],
  frame = document.querySelector('#editor');
function check(name, passed) {
  results.push({ name, passed: !!passed });
  document.querySelector('#results').textContent = results
    .map((r) => (r.passed ? 'PASS ' : 'FAIL ') + r.name)
    .join('\n');
  if (!passed) throw Error(name);
}
async function until(fn) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
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
    a = w.ConsoleCanvas;
  const $ = (s) => d.querySelector(s),
    click = (s) => $(s).click();
  const input = (s, text) => {
    const element = $(s);
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(element, text);
    element.dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  const change = (s, value) => {
    $(s).value = value;
    $(s).dispatchEvent(new w.Event('change', { bubbles: true }));
  };
  const stateSignature = () =>
    JSON.stringify([
      a.state.scene.edits,
      a.state.scene.annotations,
      a.state.timeline,
      a.state.revision,
    ]);
  const baseline = stateSignature(),
    expanded = [...a.state.expanded];
  input('#layer-search', 'new-customer');
  check(
    'Original DOM id finds the actual button with an explicit direct-match count',
    $('#layers [data-search-match="true"]')?.textContent.includes('고객 등록') &&
      $('#layer-search-status').textContent.includes(
        '일치 ' + d.querySelectorAll('#layers [data-search-match="true"]').length + '개',
      ),
  );
  input('#layer-search', 'button[id="export-customers"]');
  check(
    'Original selector can be searched without selecting an element',
    $('#layers [data-search-match="true"]')?.textContent.includes('내보내기'),
  );
  input('#layer-search', 'no-such-component-029');
  check(
    'No matches explains the blank layer list and exposes clear',
    $('#layers').textContent.includes('일치하는 요소가 없습니다') &&
      !$('#layer-search-clear').hidden &&
      $('#layer-search-status').textContent.includes('일치 0개'),
  );
  click('#layer-search-clear');
  check(
    'Clearing search restores navigation with input focus and no scene mutation',
    !$('#layer-search').value &&
      d.activeElement === $('#layer-search') &&
      stateSignature() === baseline &&
      JSON.stringify([...a.state.expanded]) === JSON.stringify(expanded),
  );
  input('#layer-search', '고객');
  $('#layer-search').dispatchEvent(
    new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  check(
    'Escape clears only the search and preserves current edits and selection',
    !$('#layer-search').value && stateSignature() === baseline,
  );

  click('#snapshot-dropdown');
  await until(() => $('#snapshot-preview-view iframe'));
  check(
    'Clean active snapshot identifies itself rather than offering a redundant restore',
    $('#apply-snapshot').disabled && $('#apply-snapshot').textContent === '현재 버전',
  );
  check(
    'A version without changes has no enabled change-location zoom',
    $('#snapshot-preview-zoom option[value="target"]').disabled &&
      $('#snapshot-preview-zoom option[value="target"]').textContent.includes('없음'),
  );
  click('#close-snapshots');
  const node = [...a.state.scene.nodes.values()].find((n) => n.locator?.id === 'new-customer');
  a.selectNode(node.id);
  a.state.scene.setPosition(16, 0);
  click('#snapshot-dropdown');
  await until(() => !$('#apply-snapshot').disabled);
  check(
    'The active basis remains restorable when unsaved changes exist',
    !$('#apply-snapshot').disabled,
  );
  click('#apply-snapshot');
  await until(() => $('#apply-snapshot').disabled && !a.snapshotHistory.dirty());
  check(
    'Restoring active basis auto-preserves unsaved work',
    a.state.timeline.entries.some(
      (e) => e.kind === 'automatic' && e.state.edits[node.id]?.dx === 16,
    ),
  );
  click('#close-snapshots');
  a.state.scene.setEdits({ [node.id]: { dx: 0, dy: 0, deleted: false } });
  a.snapshotHistory.create('이동 없는 버전');
  await a.state.saving;
  click('#snapshot-dropdown');
  await until(
    () =>
      $('#snapshot-preview-view iframe') &&
      $('#snapshot-preview-title').textContent.includes('이동 없는 버전'),
  );
  check(
    'Zero movement records are not treated as a real change location',
    $('#snapshot-preview-zoom option[value="target"]').disabled,
  );
  click('#close-snapshots');
  a.state.scene.setComment('point:850:500', '위치 주석만 있는 버전');
  const annotated = a.snapshotHistory.create('주석 위치');
  await a.state.saving;
  click('#snapshot-dropdown');
  await until(
    () =>
      $('#snapshot-preview-view iframe') &&
      !$('#snapshot-preview-zoom option[value="target"]').disabled,
  );
  const beforeZoom = stateSignature();
  change('#snapshot-preview-zoom', 'target');
  await until(() => $('#snapshot-preview-view .compare-target-highlight'));
  check(
    'Point-only comments provide a zoom target without changing saved versions',
    stateSignature() === beforeZoom && a.state.timeline.activeId === annotated.id,
  );
  click('#close-snapshots');
  a.state.scene.setComments({});
  a.state.scene.setCodePatches([
    { type: 'style', element_id: node.id, properties: { 'border-radius': '12px' } },
  ]);
  a.snapshotHistory.create('CSS 시안');
  await a.state.saving;
  click('#snapshot-dropdown');
  await until(
    () =>
      $('#snapshot-preview-view iframe') &&
      $('#snapshot-preview-title').textContent.includes('CSS 시안') &&
      !$('#snapshot-preview-zoom option[value="target"]').disabled,
  );
  check(
    'HTML/CSS-only edits expose their real zoom target',
    $('#snapshot-preview-status').textContent.includes('변경 1'),
  );
  click('#close-snapshots');

  click('#implementation-button');
  await until(() => $('#implementation-dialog').open);
  click('#implementation-visual-picker');
  await tick();
  check(
    'Empty visual picker explains how to add an implementation screen',
    $('#implementation-results-visual').textContent.includes('선택할 구현 화면이 없습니다'),
  );
  check(
    'Opening visual picker puts keyboard focus in search',
    d.activeElement === $('#implementation-result-search'),
  );
  click('#implementation-results-back');
  await tick();
  check(
    'Explicit close returns focus to its trigger',
    d.activeElement === $('#implementation-visual-picker') &&
      $('#implementation-results-visual').hidden,
  );
  $('#implementation-dialog').close();
  await a.state.saving;
  const target = await getDocument(a.state.snapshot.id);
  for (const [title, path] of [
    ['개선 초안', 'draft'],
    ['반영 결과', 'release-final'],
  ]) {
    const result = structuredClone(a.state.snapshot);
    result.id = crypto.randomUUID();
    result.documentName = title;
    result.source.url = 'https://north.invalid/' + path;
    await a.openSnapshot(result);
  }
  await a.openSnapshot(target, target.edits, target.note, target.annotations);
  click('#implementation-button');
  await until(() => $('#implementation-dialog').open);
  click('#implementation-visual-picker');
  await tick();
  const reviewCount = a.state.implementationReviews.length;
  input('#implementation-result-search', 'release-final');
  await tick();
  check(
    'URL search narrows captured results without creating a review',
    d.querySelectorAll('.result-visual-row').length === 1 &&
      a.state.implementationReviews.length === reviewCount,
  );
  input('#implementation-result-search', 'missing-029');
  await tick();
  check(
    'No matching result offers a one-action clear',
    $('#implementation-results-visual').textContent.includes('일치하는 화면이 없습니다'),
  );
  [...d.querySelectorAll('#implementation-results-visual button')]
    .find((b) => b.textContent === '검색 지우기')
    .click();
  await tick();
  check(
    'Clear restores all captured results and focus',
    d.querySelectorAll('.result-visual-row').length === 2 &&
      d.activeElement === $('#implementation-result-search'),
  );
  input('#implementation-result-search', 'release-final');
  await tick();
  click('.result-visual-row');
  await until(() => a.state.implementationReviews.at(-1).result?.name === '반영 결과');
  await until(() => d.activeElement === $('#implementation-visual-picker'));
  check(
    'Selecting a visual result uses the chosen capture and closes the list',
    $('#implementation-results-visual').hidden &&
      a.state.implementationReviews.at(-1).result.snapshot.source.url.endsWith('/release-final'),
  );
  click('#implementation-visual-picker');
  await tick();
  check(
    'Reopening inline picker preserves the previous filter',
    $('#implementation-result-search').value === 'release-final' &&
      d.querySelectorAll('.result-visual-row').length === 1,
  );
  $('#implementation-dialog').close();

  const originalBlob = w.HTMLCanvasElement.prototype.toBlob;
  w.HTMLCanvasElement.prototype.toBlob = function (callback) {
    callback(null);
  };
  click('#export-button');
  await until(() => $('#handoff-preview').dataset.state === 'failed');
  check(
    'Image generation failure blocks every dependent action and offers retry',
    ['copy-summary', 'download-review', 'handoff-verify'].every((id) => $('#' + id).disabled) &&
      !$('#handoff-retry').hidden &&
      $('#handoff-preview').getAttribute('aria-busy') === 'false',
  );
  w.HTMLCanvasElement.prototype.toBlob = originalBlob;
  click('#handoff-retry');
  await until(() => $('#handoff-preview').dataset.state === 'ready');
  check(
    'Retry produces a usable image and activates the same follow-up basis',
    ['copy-summary', 'download-review', 'handoff-verify'].every((id) => !$('#' + id).disabled) &&
      $('#handoff-retry').hidden,
  );
  $('#export-dialog').close();
  await tick();
  let pending;
  const holdImage = () => {
    pending = null;
    w.HTMLCanvasElement.prototype.toBlob = function (...args) {
      w.HTMLCanvasElement.prototype.toBlob = originalBlob;
      pending = () => originalBlob.apply(this, args);
    };
  };
  holdImage();
  click('#export-button');
  await until(() => pending);
  check(
    'In-flight image announces busy and blocks copy, save and follow-up review',
    $('#handoff-preview').getAttribute('aria-busy') === 'true' &&
      ['copy-summary', 'download-review', 'handoff-verify'].every((id) => $('#' + id).disabled),
  );
  change('#handoff-version', '@original');
  await until(() => $('#handoff-preview').dataset.state === 'ready');
  pending();
  await tick();
  check(
    'An older generation cannot replace the selected version image',
    $('#handoff-version').value === '@original' &&
      $('#export-summary').textContent.startsWith('편집 전 복제본') &&
      $('#handoff-preview').dataset.state === 'ready',
  );
  click('#handoff-verify');
  await until(() => $('#implementation-dialog').open);
  check(
    'Follow-up review freezes the exact ready image version',
    a.state.implementationReviews.at(-1).target.label === '편집 전 복제본' &&
      a.state.implementationReviews.at(-1).requests.length === 0,
  );
  $('#implementation-dialog').close();
  holdImage();
  click('#export-button');
  await until(() => pending);
  $('#export-dialog').close();
  await tick();
  pending();
  await tick();
  check(
    'Closing during generation never reopens the dialog or reactivates its actions',
    !$('#export-dialog').open &&
      $('#handoff-verify').disabled &&
      $('#handoff-preview').dataset.state === 'idle',
  );
  click('#export-button');
  await until(() => $('#handoff-preview').dataset.state === 'ready');
  let finishSave;
  w.ConsoleCanvasDesktop = {
    saveFile: () =>
      new Promise((resolve) => {
        finishSave = resolve;
      }),
  };
  click('#download-review');
  await until(() => finishSave);
  holdImage();
  change('#handoff-version', '@original');
  await until(() => pending);
  finishSave({ canceled: false });
  await tick();
  check(
    'A stale save completion cannot enable buttons or overwrite new progress',
    $('#handoff-preview').dataset.state === 'preparing' &&
      $('#download-review').disabled &&
      !$('#export-status').textContent.includes('저장했습니다'),
  );
  pending();
  await until(() => $('#handoff-preview').dataset.state === 'ready');
  delete w.ConsoleCanvasDesktop;
  $('#export-dialog').close();
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
