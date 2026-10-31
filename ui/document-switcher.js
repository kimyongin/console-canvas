import {
  getDocument,
  listDocuments,
  renameDocument,
  trashDocument,
  restoreDocument,
} from '../db.js';
import { renderDocumentRows, renderQuickDocuments } from './react/lists.tsx';
export function createDocumentSwitcher({
  $,
  state,
  openSnapshot,
  commitCommentDraft,
  flushEditor,
  closeDocument,
  renameCurrent,
  renameDialog,
  toast,
}) {
  const dialog = $('#documents-dialog'),
    list = $('#document-list'),
    status = $('#document-list-status'),
    menu = $('#document-menu-content');
  let documents = [],
    loading = false,
    deleted = false,
    generation = 0;
  async function reload() {
    const token = ++generation,
      values = await listDocuments(Number.MAX_SAFE_INTEGER, { deleted });
    if (token !== generation) return;
    documents = values;
    render();
  }
  function setLoading(value) {
    loading = value;
    for (const id of ['#documents-live', '#documents-trash', '#documents-dialog .dialog-close'])
      $(id).disabled = value;
    for (const button of menu.querySelectorAll('button'))
      button.disabled = value || (button.hasAttribute('data-current-document') && !state.ready);
  }
  async function action(run, rethrow = false) {
    if (loading) return;
    setLoading(true);
    render();
    try {
      await run();
      if (dialog.open) await reload();
    } catch (error) {
      status.textContent = error.message;
      toast(error.message);
      if (rethrow) throw error;
    } finally {
      setLoading(false);
      if (dialog.open) render();
    }
  }
  async function openDocument(id) {
    if (menu.matches(':popover-open')) menu.hidePopover();
    const doc = await getDocument(id);
    if (!doc) throw new Error('저장된 화면을 찾을 수 없습니다.');
    await openSnapshot(doc, doc.edits, doc.note, doc.annotations);
    if (dialog.open) dialog.close();
  }
  function rename(value) {
    renameDialog.open('문서 이름 변경', value.title, (name) =>
      action(async () => {
        await flushEditor();
        await renameDocument(value.id, name);
        if (value.id === state.snapshot?.id) renameCurrent(name);
        toast('문서 이름을 변경했습니다.');
      }, true),
    );
  }
  function recover(value, open = false) {
    return action(async () => {
      await restoreDocument(value.id);
      if (open) await openDocument(value.id);
      toast(
        open ? '문서를 복구하고 열었습니다.' : '문서를 복구했습니다.',
        open ? null : { label: '문서 열기', run: () => action(() => openDocument(value.id)) },
      );
    });
  }
  function trash(value) {
    const wasCurrent = value.id === state.snapshot?.id;
    return action(async () => {
      await flushEditor();
      await trashDocument(value.id);
      if (wasCurrent) await closeDocument(value.id);
      toast('문서를 휴지통으로 이동했습니다.', {
        label: '되돌리기',
        run: () => recover(value, wasCurrent && !state.snapshot),
      });
    });
  }
  function render() {
    const query = $('#document-search').value.trim().toLocaleLowerCase();

    $('#documents-live').setAttribute('aria-pressed', String(!deleted));
    $('#documents-trash').setAttribute('aria-pressed', String(deleted));
    const matches = documents.filter((d) =>
      (d.title + ' ' + d.url).toLocaleLowerCase().includes(query),
    );
    status.textContent = matches.length
      ? matches.length + '개 화면'
      : query
        ? '검색 결과가 없습니다.'
        : deleted
          ? '휴지통이 비어 있습니다.'
          : '저장된 화면이 없습니다.';
    const rows = makeRows(matches);
    renderDocumentRows(list, rows, loading);
  }
  function makeRows(matches) {
    return matches.map((value) => {
      const current = value.id === state.snapshot?.id;
      const actions = [
        {
          label: '이름 변경',
          scope: 'document',
          kind: 'rename',
          run: () => {
            if (menu.matches(':popover-open')) menu.hidePopover();
            rename(value);
          },
        },
      ];
      if (!deleted)
        actions.push({
          label: '휴지통으로 이동',
          scope: 'document',
          kind: 'trash',
          className: 'danger-menu',
          run: () => {
            if (menu.matches(':popover-open')) menu.hidePopover();
            return trash(value);
          },
        });
      return {
        id: value.id,
        title: value.title || '이름 없는 화면',
        url: value.url,
        summary: current
          ? {
              ...value,
            }
          : value,
        date:
          (deleted ? '휴지통 이동 ' : '최근 저장 ') +
          new Date(deleted ? value.deletedAt : value.updatedAt).toLocaleString('ko-KR'),
        captured: '가져옴 ' + new Date(value.capturedAt).toLocaleString('ko-KR'),
        current,
        disabled: loading || deleted,
        rename: (name) =>
          action(async () => {
            const scroll = list.scrollTop;
            await flushEditor();
            await renameDocument(value.id, name);
            if (value.id === state.snapshot?.id) renameCurrent(name);
            if (dialog.open) {
              await reload();
              list.scrollTop = scroll;
              if (!list.querySelector('[data-document-card="' + value.id + '"]'))
                $('#document-search').focus();
            }
            toast('문서 이름을 변경했습니다.');
          }, true),
        open: () => {
          if (menu.matches(':popover-open')) menu.hidePopover();
          if (current) dialog.close();
          else action(() => openDocument(value.id));
        },
        actions,
        recovery: deleted
          ? [
              { label: '복구', kind: 'recover', run: () => recover(value, false) },
              { label: '복구하고 열기', kind: 'recover-open', run: () => recover(value, true) },
            ]
          : undefined,
      };
    });
  }
  let quickValues = [],
    quickGeneration = 0;
  function quickRender() {
    const query = $('#quick-document-search').value.trim().toLocaleLowerCase();
    const matches = quickValues.filter((d) =>
      (d.title + ' ' + d.url).toLocaleLowerCase().includes(query),
    );
    renderQuickDocuments($('#quick-documents'), makeRows(matches.slice(0, query ? 20 : 5)), false);
    $('#quick-document-status').textContent =
      matches.length +
      '개 화면' +
      (matches.length > (query ? 20 : 5) ? ' · 더 보려면 전체 목록을 여세요.' : '');
  }
  async function show(trashView = false, query = '') {
    if (state.scene?.drag || state.scene?.areaSelecting || loading) return;
    commitCommentDraft();
    menu.hidePopover();
    deleted = trashView;
    $('#document-search').value = query;
    renderDocumentRows(list, [], true);
    status.textContent = '저장된 화면을 불러오는 중…';
    dialog.showModal();
    try {
      let saveError = '';
      try {
        await flushEditor();
      } catch (error) {
        saveError = error.message;
      }
      if (!dialog.open) return;
      await reload();
      if (saveError) status.textContent += ' · 자동 저장 실패: ' + saveError;
      if (dialog.open) $('#document-search').focus();
    } catch (error) {
      status.textContent = error.message;
    }
  }
  $('#documents-button').addEventListener('click', () =>
    show(false, menu.matches(':popover-open') ? $('#quick-document-search').value : ''),
  );
  $('#documents-trash-button').addEventListener('click', () => show(true));
  $('#rename-current').addEventListener('click', () => {
    menu.hidePopover();
    if (state.ready) rename({ id: state.snapshot.id, title: $('#source-title').textContent });
  });
  $('#trash-current').addEventListener('click', () => {
    menu.hidePopover();
    if (state.ready) trash({ id: state.snapshot.id, title: $('#source-title').textContent });
  });
  for (const [id, value] of [
    ['#documents-live', false],
    ['#documents-trash', true],
  ])
    $(id).addEventListener('click', async () => {
      if (loading) return;
      deleted = value;
      $('#document-search').value = '';
      try {
        await reload();
      } catch (error) {
        status.textContent = error.message;
      }
    });
  $('#document-search').addEventListener('input', render);
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    generation++;
    renderDocumentRows(list, [], false);
  });
  dialog.addEventListener('cancel', (event) => {
    if (loading) event.preventDefault();
  });
  $('#quick-document-search').addEventListener('input', quickRender);
  menu.addEventListener('toggle', async (event) => {
    const token = ++quickGeneration;
    if (event.newState !== 'open') {
      renderQuickDocuments($('#quick-documents'), [], false);
      return;
    }
    deleted = false;
    $('#quick-document-search').value = '';
    $('#quick-document-search').focus();
    renderQuickDocuments($('#quick-documents'), [], true);
    try {
      const values = await listDocuments(Number.MAX_SAFE_INTEGER);
      if (token !== quickGeneration || !menu.matches(':popover-open')) return;
      quickValues = values;
      quickRender();
    } catch (error) {
      if (token === quickGeneration) $('#quick-document-status').textContent = error.message;
    }
  });
  menu.addEventListener('beforetoggle', (event) => {
    if (event.newState !== 'open') return;
    commitCommentDraft();
    const rect = $('#document-menu-button').getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(innerWidth - 388, rect.left)) + 'px';
    menu.style.top = rect.bottom + 4 + 'px';
  });
}
