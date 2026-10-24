export function createSnapshotPanel({
  $,
  state,
  snapshotHistory,
  commitCommentDraft,
  setPanelVisibility,
  panels,
  toast,
  preview,
  renameDialog,
  flushEditor,
}) {
  let trashView = false;
  function showPanel(tab) {
    setPanelVisibility('properties', true);
    $('#properties-panel-title').textContent =
      tab === 'snapshots' ? '스냅샷' : tab === 'comments' ? '주석' : '선택한 요소';
    $('#close-snapshots').hidden = tab !== 'snapshots';
    $('#snapshot-panel').hidden = tab !== 'snapshots';
    $('#inspect-panel').hidden = tab !== 'inspect';
    $('#comments-panel').hidden = tab !== 'comments';
    $('#snapshots-button').setAttribute('aria-expanded', String(tab === 'snapshots'));
    for (const name of ['inspect', 'comments', 'snapshots'])
      $('#tab-' + name).setAttribute('aria-pressed', String(tab === name));
    if (tab === 'snapshots') renderSnapshots();
  }
  function showSnapshots(show = true) {
    showPanel(show ? 'snapshots' : 'inspect');
  }
  for (const name of ['inspect', 'comments', 'snapshots'])
    $('#tab-' + name).addEventListener('click', () => {
      commitCommentDraft();
      showPanel(name);
    });
  function renderSnapshots() {
    if (!state.timeline) return;
    const entries = snapshotHistory.list(),
      index = entries.findIndex((e) => e.active),
      dirty = snapshotHistory.dirty();
    $('#snapshot-count').textContent = entries.length;
    $('#version-status').textContent = dirty ? '스냅샷 이후 변경 있음' : '스냅샷과 같음';
    $('#snapshot-position').textContent =
      (index < 0 ? '현재 작업' : index + 1) + ' / ' + entries.length;
    $('#previous-snapshot').disabled = index <= 0;
    $('#next-snapshot').disabled = !entries.length || index >= entries.length - 1;
    $('#snapshot-current').textContent = dirty
      ? '현재 작업 중 · 다른 버전으로 이동하면 자동 보관됩니다.'
      : '저장된 버전을 보고 있습니다.';
    if ($('#snapshot-panel').hidden) return;
    const fragment = document.createDocumentFragment();
    const trashEntries = snapshotHistory.list({ deleted: true });
    $('#snapshots-live').textContent = '저장된 버전 ' + entries.length;
    $('#snapshots-trash').textContent = '휴지통 ' + trashEntries.length;
    $('#snapshots-live').setAttribute('aria-pressed', String(!trashView));
    $('#snapshots-trash').setAttribute('aria-pressed', String(trashView));
    $('#snapshot-trash-help').hidden = !trashView;
    const shown = trashView ? trashEntries : entries;
    if (!shown.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-small';
      empty.textContent = trashView
        ? '휴지통이 비어 있습니다.'
        : '저장된 스냅샷이 없습니다. 현재 상태를 저장해 보세요.';
      fragment.append(empty);
    }
    shown.forEach((entry, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'snapshot-entry';
      button.dataset.snapshotId = entry.id;
      button.disabled = trashView;
      button.setAttribute('aria-pressed', String(entry.active));
      const title = document.createElement('strong');
      title.textContent = i + 1 + '. ' + entry.name;
      const meta = document.createElement('span');
      meta.textContent =
        new Date(entry.created_at).toLocaleString('ko-KR', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }) +
        ' · 변경 ' +
        entry.change_count +
        ' · 주석 ' +
        entry.comment_count;
      const badge = document.createElement('small');
      badge.textContent = entry.deleted_at
        ? '휴지통 · ' + new Date(entry.deleted_at).toLocaleDateString('ko-KR')
        : entry.active
          ? dirty
            ? '현재 버전 + 편집 중'
            : '현재 버전'
          : entry.kind === 'automatic'
            ? '이동 전 자동 보관'
            : entry.kind === 'initial'
              ? '시작점'
              : '저장된 버전';
      const image = document.createElement('img');
      image.alt = '배치 미리보기 · ' + entry.name;
      image.dataset.previewId = entry.id;
      button.append(image, title, meta, badge);
      button.addEventListener('click', () => restoreSnapshot(entry.id));
      const card = document.createElement('div');
      card.className = 'snapshot-card';
      const compare = document.createElement('button');
      compare.className = 'snapshot-compare';
      compare.textContent = '현재 작업과 비교';
      compare.addEventListener('click', () => preview.open(entry.id, '@current'));
      const actions = document.createElement('div');
      actions.className = 'item-actions';
      function control(text, kind, run) {
        const b = document.createElement('button');
        b.textContent = text;
        b.dataset.snapshotAction = kind;
        b.setAttribute('aria-label', entry.name + ' · ' + text);
        b.addEventListener('click', run);
        actions.append(b);
      }
      control('이름 변경', 'rename', () =>
        renameDialog.open('스냅샷 이름 변경', entry.name, async (name) => {
          snapshotHistory.rename(entry.id, name);
          await flushEditor();
          toast('스냅샷 이름을 변경했습니다.');
        }),
      );
      if (trashView)
        control('복구', 'recover', () =>
          manage(
            () => snapshotHistory.recover(entry.id),
            '스냅샷을 목록에 복구했습니다. 현재 화면은 유지됩니다.',
          ),
        );
      else
        control('휴지통으로 이동', 'trash', () =>
          manage(
            () => snapshotHistory.trash(entry.id),
            '스냅샷을 휴지통으로 이동했습니다. 현재 편집 내용은 유지됩니다.',
          ),
        );
      card.append(button);
      if (!trashView) card.append(compare);
      card.append(actions);
      fragment.append(card);
    });
    $('#snapshot-list').replaceChildren(fragment);
    preview.thumbnails();
  }
  async function manage(run, message) {
    try {
      commitCommentDraft();
      run();
      await flushEditor();
      toast(message);
    } catch (error) {
      toast(error.message);
    }
  }
  for (const [id, value] of [
    ['#snapshots-live', false],
    ['#snapshots-trash', true],
  ])
    $(id).addEventListener('click', () => {
      trashView = value;
      renderSnapshots();
    });
  function restoreSnapshot(id) {
    try {
      commitCommentDraft();
      const result = snapshotHistory.restore(id);
      toast(
        result.automatic_snapshot_id
          ? '현재 작업을 자동 보관하고 스냅샷으로 이동했어요.'
          : '저장한 스냅샷으로 이동했어요.',
      );
    } catch (error) {
      toast(error.message);
    }
  }
  $('#snapshots-button').addEventListener('click', () => {
    commitCommentDraft();
    showSnapshots(!panels.properties || $('#snapshot-panel').hidden);
  });
  $('#close-snapshots').addEventListener('click', () => showSnapshots(false));
  $('#snapshot-form').addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      commitCommentDraft();
      snapshotHistory.create($('#snapshot-name').value);
      $('#snapshot-name').value = '';
      toast('현재 화면과 주석을 스냅샷으로 저장했어요.');
    } catch (error) {
      toast(error.message);
    }
  });
  for (const [id, delta] of [
    ['#previous-snapshot', -1],
    ['#next-snapshot', 1],
  ])
    $(id).addEventListener('click', () => {
      const entries = snapshotHistory.list(),
        index = entries.findIndex((e) => e.active);
      if (entries[index + delta]) restoreSnapshot(entries[index + delta].id);
    });

  return { showSnapshots, renderSnapshots, showPanel };
}
