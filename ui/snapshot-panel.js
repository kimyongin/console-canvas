import { snapshotGraph } from '../snapshot-graph.js';
import { withVersionScene } from './version-preview.js';
import { createActionMenu } from './action-menu.js';
export function createSnapshotPanel({
  $,
  state,
  snapshotHistory,
  commitCommentDraft,
  toast,
  preview,
  renameDialog,
  flushEditor,
}) {
  let trashView = false,
    documentId = null,
    activeId = null,
    previewKey = null,
    generation = 0;
  const selected = () =>
    state.timeline?.entries.find((e) => e.id === state.snapshotPreviewId && !e.deletedAt);
  function updateLabel() {
    const entry = selected(),
      active = state.timeline?.entries.find(
        (e) => e.id === state.timeline.activeId && !e.deletedAt,
      );
    const name = entry?.name || active?.name || (state.timeline ? '현재 작업' : '문서 열기');
    const suffix =
      entry && entry.id !== active?.id
        ? ' · 미리보기'
        : snapshotHistory.dirty()
          ? ' · 편집 중'
          : '';
    $('#snapshot-active-name').textContent = name + suffix;
    $('#snapshot-dropdown').setAttribute('aria-label', '스냅샷 목록 · ' + name + suffix);
    $('#snapshot-dropdown').title = '스냅샷 목록 · ' + name + suffix;
  }
  async function renderPreview() {
    const entry = selected(),
      panel = $('#snapshot-preview');
    panel.hidden = trashView;
    $('#apply-snapshot').disabled = !entry;
    $('#compare-button').disabled = !entry;
    updateLabel();
    if (trashView) return;
    $('#snapshot-preview-title').textContent = entry
      ? entry.name + ' 미리보기'
      : '버전을 선택하세요';
    $('#snapshot-preview-status').textContent = entry
      ? '선택만으로 현재 편집은 바뀌지 않습니다.'
      : '저장된 버전을 선택하면 화면을 미리 볼 수 있습니다.';
    if (!entry) {
      generation++;
      previewKey = null;
      $('#snapshot-preview-view').replaceChildren();
      return;
    }
    const key = state.snapshot.id + '/' + state.generation + '/' + entry.id;
    if (key === previewKey && $('#snapshot-preview-view iframe')) return;
    previewKey = key;
    const token = ++generation;
    $('#snapshot-preview-view').textContent = '미리보기 준비 중…';
    try {
      const capture = state.snapshot;
      const result = await withVersionScene(capture, entry.state, (scene) => ({
        html: scene.serialize(),
        size: scene.contentSize(),
      }));
      if (token !== generation || state.snapshot?.id !== capture.id || selected()?.id !== entry.id)
        return;
      const frame = document.createElement('iframe');
      frame.title = entry.name + ' 미리보기 화면';
      frame.setAttribute('sandbox', 'allow-same-origin');
      frame.referrerPolicy = 'no-referrer';
      frame.tabIndex = -1;
      frame.width = result.size.width;
      frame.height = result.size.height;
      frame.srcdoc = result.html;
      frame.style.pointerEvents = 'none';
      const space = document.createElement('div');
      space.className = 'snapshot-preview-space';
      space.append(frame);
      $('#snapshot-preview-view').replaceChildren(space);
      function fit() {
        const scale = Math.max(
          0.05,
          Math.min(1, ($('#snapshot-preview-view').clientWidth - 16) / result.size.width),
        );
        frame.style.transform = 'scale(' + scale + ')';
        space.style.width = result.size.width * scale + 'px';
        space.style.height = result.size.height * scale + 'px';
      }
      fit();
      requestAnimationFrame(fit);
      $('#snapshot-preview-status').textContent =
        (entry.id === state.timeline.activeId
          ? '현재 작업의 기준 버전'
          : '선택만으로 현재 편집은 바뀌지 않습니다.') +
        ' · 변경 ' +
        Object.keys(entry.state.edits).length +
        ' · 주석 ' +
        Object.keys(entry.state.annotations).length;
    } catch (error) {
      if (token === generation) {
        previewKey = null;
        $('#snapshot-preview-view').textContent = '미리보기 실패: ' + error.message;
      }
    }
  }
  function selectPreview(id, { reveal = false } = {}) {
    const entry = state.timeline.entries.find((e) => e.id === id && !e.deletedAt);
    if (!entry) return;
    state.snapshotPreviewId = id;
    renderSnapshots();
    if (reveal)
      $('#snapshot-list [data-snapshot-id="' + id + '"]').scrollIntoView({
        block: 'nearest',
        inline: 'center',
        behavior: 'smooth',
      });
  }
  async function manage(run, message, action = null, rethrow = false) {
    try {
      commitCommentDraft();
      run();
      await flushEditor();
      toast(message, action);
    } catch (error) {
      toast(error.message);
      if (rethrow) throw error;
    }
  }
  function actions(entry) {
    const doc = state.snapshot.id;
    const items = [
      {
        label: '현재 작업과 비교',
        className: 'snapshot-compare',
        run: () => preview.open(entry.id, '@current'),
      },
      {
        label: '이름 변경',
        scope: 'snapshot',
        kind: 'rename',
        run: () =>
          renameDialog.open('스냅샷 이름 변경', entry.name, async (name) => {
            snapshotHistory.rename(entry.id, name);
            await flushEditor();
            toast('스냅샷 이름을 변경했습니다.');
          }),
      },
    ];
    if (!entry.deletedAt)
      items.push({
        label: '휴지통으로 이동',
        scope: 'snapshot',
        kind: 'trash',
        className: 'danger-menu',
        run: () =>
          manage(() => snapshotHistory.trash(entry.id), '스냅샷을 휴지통으로 이동했습니다.', {
            label: '되돌리기',
            run: () => {
              if (state.snapshot?.id !== doc)
                throw new Error('삭제한 스냅샷의 문서를 먼저 열어 주세요.');
              return manage(
                () => snapshotHistory.recover(entry.id),
                '스냅샷을 목록에 복구했습니다.',
                null,
                true,
              );
            },
          }),
      });
    return createActionMenu({ label: entry.name, actions: items });
  }
  function graph() {
    const data = snapshotGraph(state.timeline.entries),
      root = $('#snapshot-list'),
      scroll = $('#snapshot-graph-scroll'),
      x = scroll.scrollLeft,
      y = scroll.scrollTop;
    const focus = document.activeElement?.dataset?.snapshotId;
    root.style.width = data.width + 'px';
    root.style.height = data.height + 'px';
    root.replaceChildren();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', data.width);
    svg.setAttribute('height', data.height);
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('snapshot-edges');
    for (const edge of data.edges) {
      const path = document.createElementNS(svg.namespaceURI, 'path');
      path.dataset.parentId = edge.parent_id;
      path.dataset.childId = edge.child_id;
      if (edge.from.y !== edge.to.y) path.classList.add('branch-edge');
      if (edge.child_id === state.snapshotPreviewId) path.classList.add('selected-edge');
      path.setAttribute(
        'd',
        `M${edge.from.x},${edge.from.y} C${edge.from.x + 70},${edge.from.y} ${edge.to.x - 70},${edge.to.y} ${edge.to.x},${edge.to.y}`,
      );
      svg.append(path);
    }
    root.append(svg);
    for (const entry of data.nodes) {
      const card = document.createElement('div');
      card.className = 'snapshot-card snapshot-graph-node';
      card.style.left = entry.x - 28 + 'px';
      card.style.top = entry.y - 65 + 'px';
      card.dataset.depth = entry.depth;
      card.dataset.lane = entry.lane;
      card.classList.toggle('active-version', entry.id === state.timeline.activeId);
      card.classList.toggle('preview-version', entry.id === state.snapshotPreviewId);
      const b = document.createElement('button');
      b.className = 'snapshot-entry';
      b.type = 'button';
      b.dataset.snapshotId = entry.id;
      b.dataset.parentId = entry.parentId || '';
      b.disabled = !!entry.deletedAt;
      b.setAttribute('aria-pressed', String(entry.id === state.snapshotPreviewId));
      b.setAttribute('aria-label', entry.name + ' · 미리보기');
      const title = document.createElement('strong');
      title.textContent = entry.name + (entry.deletedAt ? ' · 휴지통' : '');
      const meta = document.createElement('span');
      meta.textContent = new Date(entry.createdAt).toLocaleString('ko-KR', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const badge = document.createElement('small');
      badge.textContent =
        entry.id === state.timeline.activeId
          ? '현재 버전'
          : entry.id === state.snapshotPreviewId
            ? '선택한 미리보기'
            : entry.kind === 'automatic'
              ? '이동 전 자동 보관'
              : '저장된 버전';
      b.append(title, meta, badge);
      b.addEventListener('click', () => selectPreview(entry.id));
      card.append(b);
      if (!entry.deletedAt) card.append(actions(entry));
      root.append(card);
    }
    if (snapshotHistory.dirty()) {
      const parent = data.nodes.find((n) => n.id === state.timeline.activeId),
        leaf = document.createElement('div');
      leaf.className = 'snapshot-draft-node';
      leaf.textContent = '◌ 현재 작업 · 저장 전';
      leaf.style.left = (parent ? parent.x + 30 : 20) + 'px';
      leaf.style.top = (parent ? parent.y + 28 : 20) + 'px';
      root.append(leaf);
    }
    scroll.scrollLeft = x;
    scroll.scrollTop = y;
    if (focus)
      root.querySelector('[data-snapshot-id="' + focus + '"]')?.focus({ preventScroll: true });
  }
  function trash() {
    const root = $('#snapshot-trash-list');
    root.replaceChildren();
    for (const entry of state.timeline.entries.filter((e) => e.deletedAt)) {
      const card = document.createElement('div');
      card.className = 'snapshot-card';
      card.dataset.trashedId = entry.id;
      const title = document.createElement('strong');
      title.textContent = entry.name;
      card.append(title);
      for (const [label, kind, apply] of [
        ['복구', 'recover', false],
        ['복구하고 적용', 'recover-apply', true],
      ]) {
        const b = document.createElement('button');
        b.textContent = label;
        b.dataset.snapshotAction = kind;
        b.setAttribute('aria-label', entry.name + ' · ' + label);
        b.addEventListener('click', () =>
          manage(
            () => {
              snapshotHistory.recover(entry.id);
              if (apply) {
                snapshotHistory.restore(entry.id);
                trashView = false;
                state.snapshotPreviewId = entry.id;
              }
              renderSnapshots();
            },
            apply ? '스냅샷을 복구하고 적용했습니다.' : '스냅샷을 목록에 복구했습니다.',
          ),
        );
        card.append(b);
      }
      root.append(card);
    }
    if (!root.children.length) root.textContent = '휴지통이 비어 있습니다.';
  }
  function renderSnapshots() {
    const available = !!state.timeline;
    for (const id of [
      '#snapshot-dropdown',
      '#snapshot-name',
      '#save-snapshot',
      '#snapshots-live',
      '#snapshots-trash',
    ])
      $(id).disabled = !available;
    if (!available) {
      state.snapshotPreviewId = null;
      documentId = null;
      activeId = null;
      generation++;
      previewKey = null;
      $('#snapshot-active-name').textContent = '문서 열기';
      $('#snapshot-count').textContent = '0';
      $('#snapshot-list').replaceChildren();
      $('#snapshot-preview-view').replaceChildren();
      $('#apply-snapshot').disabled = true;
      $('#compare-button').disabled = true;
      $('#snapshot-tools').hidden = true;
      $('#snapshots-live').textContent = '저장된 버전 0';
      $('#snapshots-trash').textContent = '휴지통 0';
      return;
    }
    if (documentId !== state.snapshot.id) {
      documentId = state.snapshot.id;
      state.snapshotPreviewId = state.timeline.activeId;
      previewKey = null;
      trashView = false;
    }
    if (activeId !== state.timeline.activeId) {
      activeId = state.timeline.activeId;
      state.snapshotPreviewId = activeId;
    }
    if (!selected())
      state.snapshotPreviewId = state.timeline.entries.find((e) => !e.deletedAt)?.id || null;
    const entries = snapshotHistory.list(),
      deleted = snapshotHistory.list({ deleted: true });
    $('#snapshot-count').textContent = entries.length;
    $('#snapshots-live').textContent = '저장된 버전 ' + entries.length;
    $('#snapshots-trash').textContent = '휴지통 ' + deleted.length;
    $('#snapshots-live').setAttribute('aria-pressed', String(!trashView));
    $('#snapshots-trash').setAttribute('aria-pressed', String(trashView));
    $('#snapshot-tools').hidden = trashView;
    $('#snapshot-trash-list').hidden = !trashView;
    $('#snapshot-trash-help').hidden = !trashView;
    $('#snapshot-preview').hidden = trashView;
    $('#version-status').textContent = snapshotHistory.dirty()
      ? '스냅샷 이후 변경 있음'
      : '스냅샷과 같음';
    const active = entries.find((e) => e.active);
    $('#snapshot-parent-name').textContent = '부모 버전 · ' + (active?.name || '현재 작업');
    $('#snapshot-current').textContent =
      '현재 작업 기준 · ' +
      (active?.name || '현재 작업') +
      (snapshotHistory.dirty() ? ' · 저장 전 변경은 버전 이동 전 자동 보관됩니다.' : '');
    updateLabel();
    if (trashView) trash();
    else graph();
    if ($('#snapshot-panel').matches(':popover-open')) renderPreview();
  }
  function showSnapshots(show = true) {
    if (!state.ready) return;
    commitCommentDraft();
    renderSnapshots();
    if (show) {
      if (!$('#snapshot-panel').matches(':popover-open')) $('#snapshot-panel').showPopover();
      requestAnimationFrame(() => {
        renderPreview();
        const b = $('#snapshot-list [data-snapshot-id="' + state.snapshotPreviewId + '"]');
        b?.scrollIntoView({ block: 'nearest', inline: 'center' });
      });
    } else $('#snapshot-panel').hidePopover();
  }
  $('#snapshot-panel').addEventListener('beforetoggle', (e) => {
    if (e.newState === 'open') {
      renderSnapshots();
      const r = $('#snapshot-dropdown').getBoundingClientRect(),
        panel = $('#snapshot-panel');
      panel.style.top = Math.min(r.bottom + 8, innerHeight * 0.22) + 'px';
      panel.style.left = '24px';
      panel.style.maxHeight =
        Math.max(280, innerHeight - Math.min(r.bottom + 8, innerHeight * 0.22) - 18) + 'px';
      requestAnimationFrame(renderPreview);
    }
  });
  $('#snapshot-dropdown').addEventListener('click', () => {
    commitCommentDraft();
  });
  $('#close-snapshots').addEventListener('click', () => $('#snapshot-panel').hidePopover());
  for (const [id, value] of [
    ['#snapshots-live', false],
    ['#snapshots-trash', true],
  ])
    $(id).addEventListener('click', () => {
      trashView = value;
      renderSnapshots();
    });
  $('#snapshots-button').addEventListener('click', () => {
    if (!state.ready) return;
    commitCommentDraft();
    renderSnapshots();
    $('#snapshot-panel').hidePopover();
    $('#snapshot-name').value = '';
    $('#snapshot-save-dialog').showModal();
    $('#snapshot-name').focus();
  });
  $('#cancel-snapshot').addEventListener('click', () => $('#snapshot-save-dialog').close());
  $('#snapshot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      commitCommentDraft();
      const entry = snapshotHistory.create($('#snapshot-name').value);
      state.snapshotPreviewId = entry.id;
      trashView = false;
      $('#snapshot-save-dialog').close();
      showSnapshots();
      await flushEditor();
      toast('스냅샷을 저장했습니다. 그래프에서 과거·미래 버전을 선택해 보세요.');
    } catch (error) {
      toast(error.message);
    }
  });
  $('#apply-snapshot').addEventListener('click', async () => {
    const entry = selected();
    if (!entry) return;
    try {
      commitCommentDraft();
      const result = snapshotHistory.restore(entry.id);
      await flushEditor();
      renderSnapshots();
      $('#snapshot-preview-status').textContent = entry.name + ' 버전을 편집 화면에 적용했습니다.';
      toast(
        result.automatic_snapshot_id
          ? '현재 작업을 자동 보관하고 버전으로 이동했습니다.'
          : '선택한 버전으로 이동했습니다.',
      );
    } catch (error) {
      toast(error.message);
    }
  });
  return { showSnapshots, renderSnapshots, selectPreview };
}
