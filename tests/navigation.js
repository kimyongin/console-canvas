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
  const app = frame.contentWindow.ConsoleCanvas,
    doc = frame.contentDocument,
    win = frame.contentWindow,
    click = (q) => doc.querySelector(q).click(),
    change = (q, value) => {
      const e = doc.querySelector(q);
      e.value = value;
      e.dispatchEvent(new win.Event('change', { bubbles: true }));
    };
  const node = [...app.state.scene.nodes.values()].find((n) => n.locator.id === 'new-customer'),
    other = [...app.state.scene.nodes.values()].find((n) => n.locator.id === 'export-customers');
  app.selectNode(node.id);
  app.state.scene.setComment(node.id, '원래 요청');
  const a = app.snapshotHistory.create('A · 공통 기준');
  app.state.scene.nudge(10, 0);
  const b = app.snapshotHistory.create('B · 검색 배치');
  app.state.scene.nudge(10, 0);
  const c = app.snapshotHistory.create('C · 검색 완성');
  await app.snapshotHistory.restorePersisted(a.id);
  app.state.scene.nudge(0, 80);
  const d = app.snapshotHistory.create('D · 검색 대안');
  app.state.scene.setComment(other.id, '두 번째 요청');
  app.state.scene.remove(other.id);
  await app.state.saving;
  const signature = () =>
    JSON.stringify({
      edits: app.state.scene.edits,
      annotations: app.state.scene.annotations,
      timeline: app.state.timeline,
      revision: app.state.revision,
      undo: app.state.undo.length,
    });
  const before = signature();
  click('#snapshot-dropdown');
  await until(() => doc.querySelector('#snapshot-preview-view iframe'));
  const field = doc.querySelector('#snapshot-search');
  field.value = '검색';
  field.dispatchEvent(new win.Event('input', { bubbles: true }));
  check(
    'Search keeps branch graph while showing named results with parent context',
    doc.querySelectorAll('[data-snapshot-match]').length === 3 &&
      doc.querySelector('#snapshot-search-results').textContent.includes('부모 · A · 공통 기준') &&
      doc.querySelectorAll('[data-snapshot-id]').length === 5,
  );
  field.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  const first = doc.activeElement;
  first.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  check(
    'Search result keys move focus without editing the canvas',
    doc.activeElement !== first &&
      doc.activeElement.hasAttribute('data-snapshot-match') &&
      signature() === before,
  );
  doc.querySelector('[data-snapshot-match="' + b.id + '"]').click();
  check(
    'Search selection previews past branch without restoring it',
    app.state.snapshotPreviewId === b.id &&
      app.state.timeline.activeId === d.id &&
      signature() === before &&
      doc.querySelector('#snapshot-search-results').hidden,
  );
  click('#snapshot-find-current');
  check(
    'Current version finder returns preview to active node without data changes',
    app.state.snapshotPreviewId === d.id && signature() === before,
  );
  const panel = doc.querySelector('#snapshot-panel');
  panel.scrollTop = panel.scrollHeight;
  const heading = doc.querySelector('.snapshot-navigation-header').getBoundingClientRect(),
    bounds = panel.getBoundingClientRect();
  check(
    'Snapshot navigation stays visible during preview scroll',
    heading.top >= bounds.top &&
      heading.bottom <= bounds.bottom &&
      doc.querySelector('#close-snapshots').getBoundingClientRect().top >= bounds.top,
  );
  field.value = '없는 버전';
  field.dispatchEvent(new win.Event('input'));
  check(
    'Empty search explains absence without losing graph',
    doc.querySelector('#snapshot-search-results').textContent.includes('검색 결과가 없습니다.') &&
      doc.querySelectorAll('[data-snapshot-id]').length === 5,
  );
  field.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check(
    'Search Escape clears query without closing or changing selection',
    field.value === '' && panel.matches(':popover-open') && signature() === before,
  );
  click('#close-snapshots');
  click('#snapshot-dropdown');
  await until(() => doc.querySelector('#snapshot-preview-view iframe'));
  await until(() => panel.scrollTop === 0);
  check('Reopening starts at navigation header', panel.scrollTop === 0);
  click('#compare-button');
  await until(() => doc.querySelectorAll('.compare-view iframe').length === 2);
  change('#compare-left', '@original');
  await until(() => doc.querySelector('#compare-left-view iframe'));
  click('#compare-next');
  check(
    'Next change selects first target with two numbered outlines',
    doc.querySelectorAll('.compare-target-highlight').length === 2 &&
      doc.querySelector('#compare-focus-status').textContent.includes('변경 1 / 2') &&
      doc.querySelector('#compare-previous').disabled,
  );
  click('#compare-next');
  check(
    'Deleted target is marked as a dashed reference in its version',
    doc.querySelector('#compare-right-view .missing-target') &&
      doc.querySelector('#compare-focus-status').textContent.includes('삭제됨') &&
      doc.querySelector('#compare-next').disabled,
  );
  change('#compare-zoom', '1');
  check(
    'Target highlight follows common zoom',
    Number.parseFloat(
      doc.querySelector('#compare-left-view .compare-target-highlight').style.width,
    ) > 50,
  );
  click('#compare-previous');
  check(
    'Previous change returns to first without editing',
    doc.querySelector('#compare-focus-status').textContent.includes('변경 1 / 2') &&
      signature() === before,
  );
  change('#compare-left', '@current');
  await until(() => doc.querySelector('#compare-left-view iframe'));
  check(
    'Equal versions clear highlights and disable both navigation buttons',
    !doc.querySelector('.compare-target-highlight') &&
      doc.querySelector('#compare-next').disabled &&
      doc.querySelector('#compare-previous').disabled &&
      doc.querySelector('#compare-focus-status').textContent.includes('차이가 없습니다.'),
  );
  click('#compare-dialog .dialog-close');
  const extra = [...app.state.scene.nodes.values()]
    .filter((n) => n.tag === 'button' && ![node.id, other.id].includes(n.id))
    .slice(0, 8);
  extra.forEach((n, i) => app.state.scene.setComment(n.id, '요청 ' + (i + 3)));
  app.selectNode(node.id);
  click('#edit-selected-comment');
  check(
    'Comment picker lists ten request numbers and names',
    doc.querySelector('#comment-request').options.length === 10 &&
      doc.querySelector('#comment-request').options[9].textContent.includes('10 / 10'),
  );
  const comment = doc.querySelector('#component-comment');
  comment.value = '직접 이동 전에 보존할 초안';
  comment.dispatchEvent(new win.Event('input'));
  const last = doc.querySelector('#comment-request').options[9].value;
  change('#comment-request', last);
  check(
    'Direct jump commits draft and reaches requested target without closing',
    app.state.scene.annotations[node.id] === '직접 이동 전에 보존할 초안' &&
      app.state.commentTarget === last &&
      doc.querySelector('#comment-progress').textContent === '요청 10 / 10' &&
      doc.querySelector('#comment-dialog').open,
  );
  const targetTitle = doc.querySelector('#comment-target-title').textContent;
  comment.value = 'request ten autosaved';
  comment.dispatchEvent(new win.Event('input'));
  await until(
    () =>
      app.state.scene.annotations[last] === 'request ten autosaved' &&
      doc.querySelector('#comment-status').textContent.includes('자동 저장 완료'),
  );
  check(
    'Autosave keeps requested target context despite a different canvas selection',
    doc.querySelector('#comment-target-title').textContent === targetTitle &&
      app.state.commentTarget === last &&
      !doc.querySelector('#clear-comment').disabled,
  );
  change('#comment-request', node.id);
  check(
    'Jumping back retains draft and stable request order',
    comment.value === '직접 이동 전에 보존할 초안' &&
      doc.querySelector('#comment-request').options.length === 10,
  );
  click('#clear-comment');
  change('#comment-request', last);
  change('#comment-request', node.id);
  check(
    'Cleared request stays reachable until review closes',
    comment.value === '' && doc.querySelector('#comment-request').options.length === 10,
  );
  click('#save-comment');
  await app.state.saving;
  check(
    'Branch ancestry survives all navigation',
    app.state.timeline.entries.find((e) => e.id === d.id).parentId === a.id &&
      app.state.timeline.entries.find((e) => e.id === c.id).parentId === b.id,
  );
  document.querySelector('#status').textContent = results.length + ' navigation checks passed';
  document.body.dataset.result = 'pass';
} catch (error) {
  document.querySelector('#status').textContent = error.stack;
  document.body.dataset.result = 'fail';
}
