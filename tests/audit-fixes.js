import { getDocument, documentSummary } from '../db.js';
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
  const node = [...a.state.scene.nodes.values()].find((n) => n.locator.id === 'new-customer');
  a.selectNode(node.id);
  a.state.scene.setPosition(24, 0);
  await a.state.saving;
  frame.style.width = '720px';
  await tick();
  for (const key of ['layers', 'properties'])
    if ($('#' + key + '-panel').hidden) click('#toggle-' + key);
  await tick();
  const visibleHit = (s) => {
    const e = $(s),
      r = e.getBoundingClientRect(),
      hit = d.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return (
      r.width > 0 &&
      !!hit &&
      (hit === e || e.contains(hit) || (e.disabled && !hit.closest('button')))
    );
  };
  check(
    '720px toolbar keeps undo, redo, snapshot and overflow hit targets accessible',
    ['#undo', '#redo', '#snapshot-dropdown', '#compact-tools-button'].every(visibleHit),
  );
  check(
    'Compact snapshot button retains the selected version name',
    $('#snapshot-active-name').getBoundingClientRect().height > 0 &&
      $('#snapshot-active-name').textContent.includes('가져온 상태'),
  );
  check(
    'Compact toolbar stays inside its canvas panel',
    (() => {
      const p = $('.canvas-panel').getBoundingClientRect();
      return ['#undo', '#redo', '#snapshot-dropdown', '#compact-tools-button'].every((s) => {
        const r = $(s).getBoundingClientRect();
        return r.left >= p.left && r.right <= p.right;
      });
    })(),
  );
  click('#compact-tools-button');
  await tick();
  check(
    'Compact tools retains paste, AI and optional focus command',
    $('#compact-tools').matches(':popover-open') &&
      $('#compact-tools').textContent.includes('붙여넣기') &&
      $('#compact-tools').textContent.includes('캔버스 넓히기'),
  );
  $('#compact-tools').hidePopover();
  frame.style.width = '1280px';
  await tick();
  a.selectNode(node.id);
  await tick();
  const toolbar = $('#selection-actions').getBoundingClientRect(),
    caption = $('.artboard-caption').getBoundingClientRect();
  check('Selection tools never cover capture controls', toolbar.top >= caption.bottom + 4);
  check(
    'Selection identity includes readable kind and parent path',
    $('#selection-name').textContent.includes('버튼') &&
      $('#selection-path').textContent.length > 0,
  );
  click('#selection-parent');
  check(
    'Explicit parent selection preserves child access',
    a.state.scene.selected === node.parentId,
  );
  a.selectNode(node.id);
  const first = a.snapshotHistory.create('A · 기준');
  await a.state.saving;
  a.state.scene.setPosition(48, 0);
  const b = a.snapshotHistory.create('B');
  await a.state.saving;
  a.state.scene.setPosition(64, 0);
  const c = a.snapshotHistory.create('C');
  await a.state.saving;
  await a.snapshotHistory.restorePersisted(first.id);
  a.state.scene.setPosition(80, 0);
  const branch = a.snapshotHistory.create('D');
  await a.state.saving;
  click('#snapshot-dropdown');
  await until(() => $('#snapshot-preview-view iframe'));
  await tick();
  const rect = $('#snapshot-graph-scroll').getBoundingClientRect();
  check(
    'A→B→C / A→D graph reveals complete cards after opening',
    [...d.querySelectorAll('[data-snapshot-id]')].every((e) => {
      const r = e.getBoundingClientRect();
      return r.top >= rect.top && r.bottom <= rect.bottom;
    }),
  );
  const signature = JSON.stringify([a.state.timeline, a.state.scene.edits]);
  click('#snapshot-fit-graph');
  click('#snapshot-fit-graph');
  check(
    'Graph fit changes no version or edit',
    signature === JSON.stringify([a.state.timeline, a.state.scene.edits]),
  );
  const previewWidth = $('#snapshot-preview-view iframe').width;
  $('#snapshot-preview-zoom').value = '1';
  $('#snapshot-preview-zoom').dispatchEvent(new w.Event('change'));
  await until(() => $('#snapshot-preview-view iframe'));
  check(
    '100% snapshot preview preserves captured viewport and offers width/target modes',
    $('#snapshot-preview-view iframe').width === previewWidth &&
      $('#snapshot-preview-zoom').options.length === 4,
  );
  click('#compare-button');
  await until(() => $('#compare-left-view iframe'));
  $('#compare-dialog').close();
  await until(() => $('#snapshot-panel').matches(':popover-open'));
  await tick();
  check(
    'Closing comparison restores graph and selected preview',
    a.state.snapshotPreviewId === branch.id && $('#snapshot-panel').matches(':popover-open'),
  );
  click('#close-snapshots');
  await a.snapshotHistory.restorePersisted(c.id);
  await a.state.saving;
  const summary = documentSummary(await getDocument(a.state.snapshot.id));
  check(
    'Current C and latest saved D have distinct metadata',
    summary.activeSnapshotName === 'C' && summary.snapshotName === 'D',
  );
  a.selectNode(node.id);
  a.state.scene.setComment(node.id, '옮겨 주세요');
  a.state.scene.remove(node.id);
  click('#export-button');
  await until(() => !$('#copy-summary').disabled);
  check(
    'Deleted-target comment conflict is explicit before delivery',
    $('#handoff-conflicts').textContent.includes('옮겨 주세요') && $('#handoff-conflicts input'),
  );
  const text = a.state.scene.annotations[node.id];
  $('#handoff-conflicts input').click();
  await until(() => !$('#copy-summary').disabled);
  check(
    'Excluding one handoff comment retains source annotation and deletion',
    a.state.scene.annotations[node.id] === text &&
      a.state.scene.hidden(node.id) &&
      !$('#handoff-items').textContent.includes('삭제 ·'),
  );
  click('#handoff-verify');
  await until(() => $('#implementation-dialog').open);
  check(
    'Review frozen from handoff matches excluded comment without changing original',
    !a.state.implementationReviews.at(-1).target.point.annotations[node.id] &&
      a.state.scene.annotations[node.id] === text,
  );
  $('#implementation-dialog').close();
  a.undo();
  a.selectNode(node.id);
  click('#copy');
  click('#paste');
  await tick();
  click('#undo');
  await a.state.saving;
  check(
    'Removed copies retain readable names in permanent activity',
    a.state.activity.flatMap((e) => e.changes).every((c) => !/^n\d+$/.test(c.name)),
  );
  click('#activity-all');
  check(
    'All-branch history states scope and per-event path',
    $('#activity-branch').textContent.includes('모든 가지') &&
      $('.activity-context')?.textContent.includes('경로'),
  );
  click('#mcp-button');
  check(
    'Disconnected MCP cannot invoke disconnect',
    $('#mcp-disconnect').disabled && d.activeElement === $('#mcp-code'),
  );
  $('#mcp-dialog').close();
  click('#implementation-button');
  await until(() => $('#implementation-dialog').open);
  check(
    'Result picker retains direct path plus explicit visual selection',
    $('#implementation-result') &&
      $('#implementation-visual-picker') &&
      $('.implementation-context').textContent.includes(a.state.snapshot.source.title),
  );
  $('#implementation-dialog').close();
  await a.state.saving;
  const targetDocument = await getDocument(a.state.snapshot.id),
    resultDocument = {
      ...structuredClone(a.state.snapshot),
      id: crypto.randomUUID(),
      documentName: '결과 식별 QA',
    };
  await a.openSnapshot(resultDocument);
  await a.openSnapshot(
    targetDocument,
    targetDocument.edits,
    targetDocument.note,
    targetDocument.annotations,
  );
  click('#implementation-button');
  await until(() => $('#implementation-dialog').open);
  const resultOption = [...$('#implementation-result').options].find(
    (o) => o.value === resultDocument.id,
  );
  check(
    'Result selection exposes capture time and true viewport width',
    resultOption.textContent.includes('가져옴') &&
      resultOption.textContent.includes(resultDocument.source.viewport.width + 'px'),
  );
  click('#implementation-visual-picker');
  await until(() => $('#implementation-results-visual .document-thumbnail iframe'));
  check(
    'Visual result picker has a sandboxed lazy thumbnail',
    $('#implementation-results-visual .document-thumbnail iframe').getAttribute('sandbox') ===
      'allow-same-origin',
  );
  $('#implementation-results-visual').hidePopover();
  $('#implementation-result').value = resultDocument.id;
  $('#implementation-result').dispatchEvent(new w.Event('change', { bubbles: true }));
  await until(
    () =>
      $('#implementation-content [data-verdict="done"]') &&
      !$('#implementation-content [data-verdict="done"]').disabled,
  );
  click('#implementation-content [data-verdict="done"]');
  await until(() => $('#implementation-status').textContent.includes('판정을 저장'));
  [...d.querySelectorAll('#implementation-content button')]
    .find((b) => b.textContent === '직전 판정 취소')
    .click();
  await until(() => $('#implementation-status').textContent.includes('메모는 유지'));
  check(
    'Verdict undo identifies the request and restored state without canvas edits',
    $('#implementation-status').textContent.includes('요청 1') &&
      $('#implementation-status').textContent.includes('미검토'),
  );
  $('#implementation-dialog').close();
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
