import { snapshotChangeLabel } from './snapshot-delta.js';
import { snapshotGraph } from '../snapshot-graph.js';
import { withVersionScene } from './version-preview.js';
import {
  renderSnapshotGraph,
  renderSnapshotTrash,
  renderVersionFrame,
  renderSnapshotMatches,
} from './react/versions.tsx';
import { clearReact } from './react/mount.tsx';
export function createSnapshotPanel({
  $,
  state,
  snapshotHistory,
  adapter,
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
  let graphFit = false,
    graphFitChosen = false,
    graphData = null;
  let preferredHeight = null;
  try {
    preferredHeight = Number(localStorage.getItem('console-canvas-graph-height')) || null;
  } catch {}
  function availableHeight() {
    const r = $('#snapshot-dropdown').getBoundingClientRect();
    return innerHeight - Math.min(r.bottom + 8, Math.min(80, innerHeight * 0.12)) - 18;
  }
  function graphHeight(natural = 170) {
    const panel = $('#snapshot-panel');
    const header =
      panel.querySelector('.snapshot-navigation-header').getBoundingClientRect().height || 150;
    const heading =
      panel.querySelector('.snapshot-preview-heading').getBoundingClientRect().height || 55;
    const limit = Math.max(
      100,
      Math.min(360, availableHeight() - header - heading - 36 - 60 - 160),
    );
    const h = Math.max(100, Math.min(preferredHeight || natural, limit));
    $('#snapshot-graph-scroll').style.height = h + 'px';
    $('#snapshot-splitter').setAttribute('aria-valuenow', String(Math.round(h)));
    $('#snapshot-splitter').setAttribute('aria-valuemax', String(Math.round(limit)));
    layoutGraph();
  }
  function layoutGraph() {
    if (!graphData) return;
    const scroll = $('#snapshot-graph-scroll'),
      root = $('#snapshot-list'),
      space = $('#snapshot-graph-space');
    const scale = graphFit
      ? Math.min(
          1,
          (scroll.clientWidth - 12) / graphData.width,
          (scroll.clientHeight - 12) / graphData.height,
        )
      : 1;
    root.style.transformOrigin = '0 0';
    root.style.transform = `scale(${scale})`;
    space.style.width = graphData.width * scale + 'px';
    space.style.height = graphData.height * scale + 'px';
    $('#snapshot-overflow').textContent = graphFit
      ? '그래프 맞춤 · ' + Math.round(scale * 100) + '%'
      : '카드와 연결선을 가로·세로로 스크롤하여 탐색할 수 있습니다.';
    $('#snapshot-fit-graph').textContent = graphFit ? '실제 크기' : '그래프 맞춤';
  }
  $('#snapshot-fit-graph').addEventListener('click', () => {
    graphFitChosen = true;
    graphFit = !graphFit;
    layoutGraph();
    const s = $('#snapshot-graph-scroll');
    s.scrollLeft = 0;
    s.scrollTop = 0;
  });
  function placePanel() {
    const r = $('#snapshot-dropdown').getBoundingClientRect(),
      panel = $('#snapshot-panel');
    panel.style.top = Math.min(r.bottom + 8, Math.min(80, innerHeight * 0.12)) + 'px';
    panel.style.left = '24px';
    panel.style.height = Math.max(280, availableHeight()) + 'px';
    panel.style.maxHeight = Math.max(280, availableHeight()) + 'px';
    graphHeight($('#snapshot-list').offsetHeight);
  }
  const splitter = $('#snapshot-splitter');
  let resizing = null;
  function storeHeight() {
    try {
      localStorage.setItem('console-canvas-graph-height', String(preferredHeight));
    } catch {}
  }
  splitter.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    resizing = {
      y: e.clientY,
      height: $('#snapshot-graph-scroll').getBoundingClientRect().height,
      id: e.pointerId,
    };
    splitter.setPointerCapture(e.pointerId);
  });
  splitter.addEventListener('pointermove', (e) => {
    if (!resizing || e.pointerId !== resizing.id) return;
    preferredHeight = Math.max(100, Math.min(360, resizing.height + e.clientY - resizing.y));
    graphHeight();
  });
  function finishResize(e) {
    if (!resizing || e.pointerId !== resizing.id) return;
    resizing = null;
    if (splitter.hasPointerCapture(e.pointerId)) splitter.releasePointerCapture(e.pointerId);
    storeHeight();
  }
  splitter.addEventListener('pointerup', finishResize);
  splitter.addEventListener('pointercancel', finishResize);
  splitter.addEventListener('keydown', (e) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    preferredHeight =
      e.key === 'Home'
        ? 100
        : e.key === 'End'
          ? 360
          : Math.max(
              100,
              Math.min(
                360,
                Number(splitter.getAttribute('aria-valuenow')) + (e.key === 'ArrowUp' ? -20 : 20),
              ),
            );
    graphHeight();
    storeHeight();
  });
  window.addEventListener('resize', () => {
    if ($('#snapshot-panel').matches(':popover-open')) placePanel();
  });
  const selected = () =>
    state.timeline?.entries.find((e) => e.id === state.snapshotPreviewId && !e.deletedAt);
  function updateLabel() {
    adapter.publish();
    const entry = selected(),
      active = state.timeline?.entries.find(
        (e) => e.id === state.timeline.activeId && !e.deletedAt,
      );
    const name = entry?.name || active?.name || (state.timeline ? '현재 작업' : '문서 열기');
    $('#snapshot-current').textContent =
      '작업 중: ' +
      (active?.name || '현재 작업') +
      '  |  미리보기: ' +
      (entry?.name || '선택 없음') +
      (snapshotHistory.dirty() ? ' · 스냅샷 이후 변경 있음' : '');
    const suffix =
      entry && entry.id !== active?.id
        ? ' · 미리보기'
        : snapshotHistory.dirty()
          ? ' · 변경 있음'
          : '';
    $('#snapshot-active-name').textContent = name + suffix;
    $('#snapshot-dropdown').setAttribute('aria-label', '스냅샷 목록 · ' + name + suffix);
    $('#snapshot-dropdown').title = '스냅샷 목록 · ' + name + suffix;
  }
  async function renderPreview() {
    const entry = selected(),
      panel = $('#snapshot-preview');
    panel.hidden = trashView;
    const current = entry?.id === state.timeline?.activeId && !snapshotHistory.dirty();
    $('#apply-snapshot').disabled = !entry || current;
    $('#apply-snapshot').textContent = current ? '현재 버전' : '이 버전으로 이동';
    $('#apply-snapshot').title = current
      ? '이 버전에서 편집 중이며 저장 이후 변경이 없습니다.'
      : '';
    const targetOption = $('#snapshot-preview-zoom option[value="target"]');
    targetOption.disabled = true;
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
      clearReact($('#snapshot-preview-view'));
      return;
    }
    const mode = $('#snapshot-preview-zoom').value;
    const key = state.snapshot.id + '/' + state.generation + '/' + entry.id + '/' + mode;
    if (key === previewKey && $('#snapshot-preview-view iframe')) {
      targetOption.disabled = $('#snapshot-preview-view').dataset.hasTarget !== 'true';
      return;
    }
    previewKey = key;
    const token = ++generation;
    clearReact($('#snapshot-preview-view'));
    $('#snapshot-preview-view').textContent = '미리보기 준비 중…';
    try {
      const capture = state.snapshot;
      const result = await withVersionScene(capture, entry.state, (scene) => ({
        ...scene.preview(),
        changeCount: scene.changes().length,
        target: [...scene.changes(), ...scene.comments()]
          .map((c) => c.after || c.before)
          .find(Boolean),
      }));
      if (token !== generation || state.snapshot?.id !== capture.id || selected()?.id !== entry.id)
        return;
      targetOption.disabled = !result.target;
      targetOption.textContent = result.target ? '변경 위치 확대' : '변경 위치 없음';
      $('#snapshot-preview-view').dataset.hasTarget = String(!!result.target);
      if (mode === 'target' && !result.target) $('#snapshot-preview-zoom').value = 'fit';
      renderVersionFrame(
        $('#snapshot-preview-view'),
        result,
        entry.name + ' 미리보기 화면',
        mode === '1' || (mode === 'target' && result.target) ? 1 : undefined,
        mode === 'target' && result.target
          ? { rect: result.target, label: '저장된 변경 위치' }
          : undefined,
        mode === 'fit' || (mode === 'target' && !result.target),
      );
      if (mode === 'target' && result.target)
        requestAnimationFrame(() => {
          const v = $('#snapshot-preview-view');
          v.scrollLeft = Math.max(0, result.target.x - 32);
          v.scrollTop = Math.max(0, result.target.y - 32);
        });
      $('#snapshot-preview-status').textContent =
        (entry.id === state.timeline.activeId
          ? '현재 작업의 기준 버전'
          : '선택만으로 현재 편집은 바뀌지 않습니다.') +
        ' · 변경 ' +
        result.changeCount +
        ' · 주석 ' +
        Object.keys(entry.state.annotations).length;
    } catch (error) {
      if (token === generation) {
        previewKey = null;
        $('#snapshot-preview-view').textContent = '미리보기 실패: ' + error.message;
      }
    }
  }
  $('#snapshot-preview-zoom').addEventListener('change', renderPreview);
  function selectPreview(id, { reveal = false } = {}) {
    const entry = state.timeline.entries.find((e) => e.id === id && !e.deletedAt);
    if (!entry) return;
    state.snapshotPreviewId = id;
    renderSnapshots();
    if (reveal) revealNode(id);
  }
  function revealNode(id) {
    const node = $('#snapshot-list [data-snapshot-id="' + id + '"]')?.closest(
      '.snapshot-graph-node',
    );
    if (!node) return;
    const scroll = $('#snapshot-graph-scroll');
    if (graphFit) return;
    // Keep the whole card visible; do not center its dot and crop the label.
    if (
      !graphFitChosen &&
      graphData &&
      graphData.height > scroll.clientHeight &&
      graphData.height <= 260
    ) {
      graphFit = true;
      layoutGraph();
      scroll.scrollTop = 0;
      scroll.scrollLeft = 0;
      return;
    }
    scroll.scrollLeft = Math.max(
      0,
      node.offsetLeft + node.offsetWidth / 2 - scroll.clientWidth / 2,
    );
    scroll.scrollTop = Math.max(
      0,
      Math.min(node.offsetTop, node.offsetTop + node.offsetHeight - scroll.clientHeight),
    );
  }
  function search() {
    const query = $('#snapshot-search').value.trim().toLocaleLowerCase(),
      host = $('#snapshot-search-results');
    host.hidden = !query || trashView;
    if (host.hidden) {
      clearReact(host);
      return;
    }
    const entries = state.timeline?.entries || [],
      names = new Map(entries.map((e) => [e.id, e.name]));
    const matches = entries
      .filter((e) => !e.deletedAt && e.name.toLocaleLowerCase().includes(query))
      .reverse()
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    renderSnapshotMatches(
      host,
      matches.slice(0, 40).map((e) => ({
        id: e.id,
        name: e.name,
        parent: '부모 · ' + (names.get(e.parentId) || '가져온 시작점'),
      })),
      matches.length,
      (id) => {
        $('#snapshot-search').value = '';
        search();
        selectPreview(id);
        $('#snapshot-panel').scrollTop = 0;
        revealNode(id);
        $('#snapshot-list [data-snapshot-id="' + id + '"]')?.focus({ preventScroll: true });
      },
    );
  }
  $('#snapshot-search').addEventListener('input', search);
  $('#snapshot-search').addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#snapshot-search').value) {
      e.preventDefault();
      e.stopPropagation();
      $('#snapshot-search').value = '';
      search();
    }
    if (e.key === 'ArrowDown' && !$('#snapshot-search-results').hidden) {
      e.preventDefault();
      e.stopPropagation();
      $('#snapshot-search-results button')?.focus();
    }
  });
  $('#snapshot-panel').addEventListener('keydown', (e) => e.stopPropagation());
  $('#snapshot-search-results').addEventListener('keydown', (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const buttons = [...$('#snapshot-search-results').querySelectorAll('button')],
      index = buttons.indexOf(document.activeElement);
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? buttons.length - 1
          : Math.max(0, Math.min(buttons.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)));
    buttons[next]?.focus();
  });
  adapter.register('snapshot-current', () => {
    const id = state.timeline?.activeId;
    if (!id || trashView) return;
    $('#snapshot-search').value = '';
    search();
    selectPreview(id);
    $('#snapshot-panel').scrollTop = 0;
    revealNode(id);
    $('#snapshot-list [data-snapshot-id="' + id + '"]')?.focus({ preventScroll: true });
  });
  async function manage(run, message, action = null, rethrow = false) {
    try {
      commitCommentDraft();
      await run();
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
        run: () => {
          const panel = $('#snapshot-panel'),
            graph = $('#snapshot-graph-scroll');
          const position = { left: graph.scrollLeft, top: graph.scrollTop, panel: panel.scrollTop };
          renameDialog.open(
            '스냅샷 이름 변경',
            entry.name,
            async (name) => {
              snapshotHistory.rename(entry.id, name);
              await flushEditor();
              toast('스냅샷 이름을 변경했습니다.');
            },
            () => {
              if (state.snapshot?.id !== doc) return;
              showSnapshots();
              requestAnimationFrame(() => {
                graph.scrollLeft = position.left;
                graph.scrollTop = position.top;
                panel.scrollTop = position.panel;
                panel
                  .querySelector('[data-snapshot-id="' + entry.id + '"]')
                  ?.closest('.snapshot-card')
                  ?.querySelector('.more-actions')
                  ?.focus({ preventScroll: true });
              });
            },
          );
        },
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
    return items;
  }
  function graph() {
    const data = snapshotGraph(state.timeline.entries),
      root = $('#snapshot-list'),
      scroll = $('#snapshot-graph-scroll'),
      x = scroll.scrollLeft,
      y = scroll.scrollTop;
    const focus = document.activeElement?.dataset?.snapshotId;
    renderSnapshotGraph(
      root,
      data,
      state.timeline.activeId,
      state.snapshotPreviewId,
      snapshotHistory.dirty(),
      selectPreview,
      actions,
    );
    graphData = data;
    graphHeight(data.height);
    scroll.scrollLeft = x;
    scroll.scrollTop = y;
    if (focus)
      root.querySelector('[data-snapshot-id="' + focus + '"]')?.focus({ preventScroll: true });
  }
  function trash() {
    const root = $('#snapshot-trash-list');
    renderSnapshotTrash(
      root,
      state.timeline.entries.filter((e) => e.deletedAt),
      (id, apply) =>
        manage(
          async () => {
            if (apply) {
              await snapshotHistory.restorePersisted(id, {}, { recover: true });
              trashView = false;
              state.snapshotPreviewId = id;
            } else snapshotHistory.recover(id);
            renderSnapshots();
          },
          apply ? '스냅샷을 복구하고 적용했습니다.' : '스냅샷을 목록에 복구했습니다.',
        ),
    );
  }

  function renderSnapshots() {
    const available = !!state.timeline;
    $('#snapshot-find').hidden = !available || trashView;
    $('#snapshot-find-current').disabled = !available || !state.timeline.activeId;
    search();
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
      clearReact($('#snapshot-list'));
      clearReact($('#snapshot-preview-view'));
      $('#apply-snapshot').disabled = true;
      $('#compare-button').disabled = true;
      $('#snapshot-tools').hidden = true;
      $('#snapshots-live').textContent = '저장된 버전 0';
      $('#snapshots-trash').textContent = '휴지통 0';
      return;
    }
    if (documentId !== state.snapshot.id) {
      graphFit = false;
      graphFitChosen = false;
      graphData = null;
      documentId = state.snapshot.id;
      state.snapshotPreviewId = state.timeline.activeId;
      previewKey = null;
      trashView = false;
      $('#snapshot-search').value = '';
      search();
    }
    $('#snapshot-find').hidden = trashView;
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
    $('#version-status').textContent = snapshotChangeLabel(state, $('#review-note').value);
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
        $('#snapshot-panel').scrollTop = 0;
        placePanel();
        renderPreview();
        revealNode(state.snapshotPreviewId);
      });
    } else $('#snapshot-panel').hidePopover();
  }
  $('#snapshot-panel').addEventListener('beforetoggle', (e) => {
    if (e.newState === 'open') {
      renderSnapshots();
      $('#snapshot-panel').scrollTop = 0;
      placePanel();
      requestAnimationFrame(() => {
        $('#snapshot-panel').scrollTop = 0;
        placePanel();
        renderPreview();
        revealNode(state.snapshotPreviewId);
      });
    }
  });
  $('#snapshot-dropdown').addEventListener('click', () => {
    commitCommentDraft();
  });
  $('#snapshot-panel').addEventListener('toggle', (e) => {
    if (e.newState === 'closed') {
      $('#snapshot-search').value = '';
      search();
    }
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
  adapter.register('snapshots', () => {
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
      if (entry.id === state.timeline.activeId && !snapshotHistory.dirty()) return;
      const result = await snapshotHistory.restorePersisted(entry.id);
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
