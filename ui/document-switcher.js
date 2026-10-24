import {
  getDocument,
  listDocuments,
  renameDocument,
  trashDocument,
  restoreDocument,
} from '../db.js';
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
    status = $('#document-list-status');
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
    for (const id of [
      '#documents-live',
      '#documents-trash',
      '#documents-import',
      '#documents-dialog .dialog-close',
    ])
      $(id).disabled = value;
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
      if (rethrow) throw error;
    } finally {
      setLoading(false);
      for (const b of list.querySelectorAll('button'))
        b.disabled = deleted && b.classList.contains('document-item');
    }
  }
  function render() {
    const query = $('#document-search').value.trim().toLocaleLowerCase();
    list.replaceChildren();
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
    for (const value of matches) {
      const card = document.createElement('div');
      card.className = 'document-card';
      card.dataset.documentCard = value.id;
      const button = document.createElement('button');
      button.className = 'document-item';
      button.disabled = loading || deleted;
      button.dataset.documentId = value.id;
      const current = value.id === state.snapshot?.id;
      if (current) button.setAttribute('aria-current', 'true');
      const title = document.createElement('strong'),
        url = document.createElement('span'),
        date = document.createElement('small');
      title.textContent = (value.title || '이름 없는 화면') + (current ? ' · 현재 작업' : '');
      url.textContent = value.url;
      date.textContent = deleted
        ? '휴지통 이동 ' + new Date(value.deletedAt).toLocaleString('ko-KR')
        : '가져옴 ' +
          new Date(value.capturedAt).toLocaleString('ko-KR') +
          ' · 최근 저장 ' +
          new Date(value.updatedAt).toLocaleString('ko-KR');
      button.append(title, url, date);
      button.addEventListener('click', () => {
        if (current) {
          dialog.close();
          return;
        }
        action(async () => {
          const doc = await getDocument(value.id);
          if (!doc) throw new Error('저장된 화면을 찾을 수 없습니다.');
          await openSnapshot(doc, doc.edits, doc.note, doc.annotations);
          dialog.close();
        });
      });
      const controls = document.createElement('div');
      controls.className = 'item-actions';
      function control(text, kind, run) {
        const b = document.createElement('button');
        b.textContent = text;
        b.dataset.documentAction = kind;
        b.disabled = loading;
        b.setAttribute('aria-label', value.title + ' · ' + text);
        b.addEventListener('click', run);
        controls.append(b);
      }
      control('이름 변경', 'rename', () =>
        renameDialog.open('문서 이름 변경', value.title, (name) =>
          action(async () => {
            await flushEditor();
            await renameDocument(value.id, name);
            if (current) renameCurrent(name);
            toast('문서 이름을 변경했습니다.');
          }, true),
        ),
      );
      if (deleted)
        control('복구', 'recover', () =>
          action(async () => {
            await restoreDocument(value.id);
            toast('문서를 복구했습니다. 저장된 화면에서 열 수 있습니다.');
          }),
        );
      else
        control('휴지통으로 이동', 'trash', () =>
          action(async () => {
            await flushEditor();
            await trashDocument(value.id);
            if (current) await closeDocument(value.id);
            toast('문서를 휴지통으로 이동했습니다. 편집과 스냅샷도 함께 보관됩니다.');
          }),
        );
      card.append(button, controls);
      list.append(card);
    }
  }
  $('#documents-button').addEventListener('click', async () => {
    if (state.scene?.drag || state.scene?.areaSelecting || loading) return;
    commitCommentDraft();
    $('#document-search').value = '';
    list.replaceChildren();
    status.textContent = '저장된 화면을 불러오는 중…';
    dialog.showModal();
    try {
      await reload();
      $('#document-search').focus();
    } catch (error) {
      status.textContent = error.message;
    }
  });
  for (const [id, trash] of [
    ['#documents-live', false],
    ['#documents-trash', true],
  ])
    $(id).addEventListener('click', async () => {
      if (loading) return;
      deleted = trash;
      $('#document-search').value = '';
      try {
        await reload();
      } catch (error) {
        status.textContent = error.message;
      }
    });
  $('#document-search').addEventListener('input', render);
  $('#documents-import').addEventListener('click', () => {
    if (!loading) {
      dialog.close();
      $('#file-input').click();
    }
  });
  dialog.addEventListener('cancel', (event) => {
    if (loading) event.preventDefault();
  });
}
