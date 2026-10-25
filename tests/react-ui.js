const frame = document.querySelector('#editor'),
  results = [];
function check(name, ok) {
  results.push({ name, passed: !!ok });
  document.querySelector('#results').textContent = results
    .map((r) => (r.passed ? 'PASS ' : 'FAIL ') + r.name)
    .join('\n');
  if (!ok) throw Error(name);
}
async function until(test) {
  const limit = Date.now() + 20000;
  while (!test()) {
    if (Date.now() > limit) throw Error('Timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}
try {
  await until(() => frame.contentWindow.ConsoleCanvas?.state.ready);
  const win = frame.contentWindow,
    doc = frame.contentDocument,
    app = win.ConsoleCanvas;
  const node = [...app.state.scene.nodes.values()].find((n) => n.locator.id === 'new-customer');
  check(
    'React shell and shadcn buttons load without runtime dependencies',
    !!doc.querySelector('#editor-root [data-slot="button"]') && !!app.adapter,
  );
  function luminance(color) {
    const channels = color
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map(Number)
      .map((v) => {
        v /= 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  }
  const primary = win.getComputedStyle(doc.querySelector('#export-button'));
  const foreground = luminance(primary.color),
    background = luminance(primary.backgroundColor);
  check(
    'Primary button keeps readable contrast after theme integration',
    (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) >= 4.5,
  );
  const first = app.adapter.getSnapshot();
  check(
    'Adapter snapshots stay stable until a state notification',
    first === app.adapter.getSnapshot(),
  );
  app.selectNode(node.id);
  await new Promise((r) => setTimeout(r, 0));
  doc.querySelector('#edit-properties').focus();
  doc.querySelector('#edit-properties').click();
  check(
    'Selection opens the labelled modeless editor',
    doc.querySelector('#properties-dialog').open &&
      !doc.querySelector('#properties-dialog').matches(':modal') &&
      (doc.querySelector('#properties-dialog').hasAttribute('aria-labelledby') ||
        doc.querySelector('#properties-dialog').hasAttribute('aria-label')),
  );
  doc.querySelector('#close-properties').click();
  await until(() => doc.activeElement === doc.querySelector('#edit-properties'));
  check(
    'Closing the modeless editor returns focus to its trigger',
    doc.activeElement === doc.querySelector('#edit-properties'),
  );
  app.adapter.dispatch('properties');
  doc.querySelector('#offset-x').value = 12;
  doc.querySelector('#offset-y').value = 24;
  doc.querySelector('#offset-x').dispatchEvent(new win.Event('change'));
  doc.querySelector('#close-properties').click();
  await app.state.saving;
  check(
    'Shared command adapter updates engine and native save status',
    app.adapter.getSnapshot().revision === app.state.revision &&
      doc
        .querySelector('#save-status')
        .textContent.startsWith('자동 저장 완료 / 스냅샷 이후 변경 '),
  );
  const before = app.state.scene.edits[node.id]?.dx;
  app.adapter.dispatch('undo');
  check(
    'Adapter undo uses the existing engine history',
    before === 12 && !app.state.scene.edits[node.id],
  );
  app.adapter.dispatch('redo');
  await app.state.saving;
  doc.querySelector('#snapshots-button').click();
  const field = doc.querySelector('#snapshot-name');
  field.value = '한글 조합 확인';
  const composing = new win.KeyboardEvent('keydown', {
    key: 'Enter',
    isComposing: true,
    keyCode: 229,
    bubbles: true,
    cancelable: true,
  });
  field.dispatchEvent(composing);
  check(
    'IME Enter is cancelled without saving or closing the name modal',
    composing.defaultPrevented && doc.querySelector('#snapshot-save-dialog').open,
  );
  doc
    .querySelector('#snapshot-form')
    .dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await app.state.saving;
  await until(() => doc.querySelector('#snapshot-panel').matches(':popover-open'));
  check(
    'React graph opens after named save and shows the selected version',
    doc.querySelector('#snapshot-active-name').textContent.includes('한글 조합 확인') &&
      !!doc.querySelector('.snapshot-graph-node'),
  );
  const beforeView = JSON.stringify({
    revision: app.state.revision,
    active: app.state.timeline.activeId,
    edits: app.state.scene.edits,
  });
  const initial = app.state.timeline.entries[0].id;
  doc.querySelector('[data-snapshot-id="' + initial + '"]').click();
  await until(() => doc.querySelector('#snapshot-preview-view iframe'));
  check(
    'Graph preview updates the adapter without applying the version',
    app.adapter.getSnapshot().previewSnapshotId === initial &&
      JSON.stringify({
        revision: app.state.revision,
        active: app.state.timeline.activeId,
        edits: app.state.scene.edits,
      }) === beforeView,
  );
  doc.querySelector('#compare-button').click();
  await until(
    () =>
      doc.querySelector('#compare-left-view iframe') &&
      doc.querySelector('#compare-right-view iframe'),
  );
  const close = doc.querySelector('#compare-dialog .dialog-close');
  close.click();
  await until(
    () =>
      !doc.querySelector('#compare-left-view iframe') &&
      !doc.querySelector('#compare-right-view iframe'),
  );
  check(
    'Closing comparison releases both preview frames',
    !doc.querySelector('#compare-left-view iframe') &&
      !doc.querySelector('#compare-right-view iframe'),
  );
  doc.querySelector('#close-snapshots').click();
  app.selectNode(node.id);
  doc.querySelector('#edit-selected-comment').click();
  const longComment =
    'React UI에서도 저장되는 주석입니다. 좁은 패널에서도 내용이 다음 변경 이력과 겹치지 않고 줄바꿈되어야 합니다. '.repeat(
      5,
    );
  doc.querySelector('#component-comment').value = longComment;
  doc.querySelector('#save-comment').click();
  await app.state.saving;
  check(
    'Unified React history keeps comments and properties in one list',
    doc.querySelector('#activity-list').textContent.includes('React UI에서도 저장되는 주석') &&
      doc.querySelector('#activity-list').textContent.includes('속성 변경') &&
      !doc.querySelector('.activity-tabs'),
  );
  const commentCard = [...doc.querySelectorAll('.activity-change')].find((el) =>
    el.textContent.includes(longComment.trim()),
  );
  const cardBounds = commentCard.getBoundingClientRect();
  const textBounds = commentCard.querySelector('span').getBoundingClientRect();
  const eventBounds = commentCard.closest('.activity-event').getBoundingClientRect();
  const nextBounds = commentCard
    .closest('.activity-event')
    .nextElementSibling.getBoundingClientRect();
  check(
    'Long comments grow inside narrow history cards without overlapping the next event',
    textBounds.bottom <= cardBounds.bottom &&
      cardBounds.bottom <= eventBounds.bottom + 1 &&
      eventBounds.bottom <= nextBounds.top + 1,
  );
  doc.querySelector('#document-menu-button').click();
  doc.querySelector('#documents-button').click();
  await until(() => doc.querySelector('.document-item small'));
  const documentCard = doc.querySelector('.document-item');
  check(
    'Document cards contain all metadata rows without clipping',
    documentCard.querySelector('small').getBoundingClientRect().bottom <=
      documentCard.getBoundingClientRect().bottom,
  );
  doc.querySelector('#documents-dialog .dialog-close').click();
  document.querySelector('#status').textContent = JSON.stringify({
    passed: results.length,
    failed: 0,
    total: results.length,
  });
  document.body.dataset.result = 'pass';
} catch (error) {
  document.querySelector('#status').textContent = 'FAILED: ' + error.stack;
  document.body.dataset.result = 'fail';
  console.error(error);
}
