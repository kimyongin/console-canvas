import { getDocument, listDocuments } from '../db.js';
export function createDocumentSwitcher({ $, state, openSnapshot, commitCommentDraft }) {
  const dialog = $('#documents-dialog'),
    list = $('#document-list'),
    status = $('#document-list-status');
  let documents = [],
    loading = false;
  function render() {
    const query = $('#document-search').value.trim().toLocaleLowerCase();
    list.replaceChildren();
    const matches = documents.filter((d) =>
      (d.title + ' ' + d.url).toLocaleLowerCase().includes(query),
    );
    status.textContent = matches.length
      ? matches.length + '개 화면'
      : query
        ? '검색 결과가 없습니다.'
        : '저장된 화면이 없습니다.';
    for (const value of matches) {
      const button = document.createElement('button');
      button.className = 'document-item';
      button.disabled = loading;
      button.dataset.documentId = value.id;
      const current = value.id === state.snapshot?.id;
      if (current) button.setAttribute('aria-current', 'true');
      const title = document.createElement('strong'),
        url = document.createElement('span'),
        date = document.createElement('small');
      title.textContent = (value.title || '이름 없는 화면') + (current ? ' · 현재 작업' : '');
      url.textContent = value.url;
      date.textContent =
        '가져옴 ' +
        new Date(value.capturedAt).toLocaleString('ko-KR') +
        ' · 최근 저장 ' +
        new Date(value.updatedAt).toLocaleString('ko-KR');
      button.append(title, url, date);
      button.addEventListener('click', async () => {
        if (loading) return;
        if (current) {
          dialog.close();
          return;
        }
        loading = true;
        render();
        status.textContent = '작업을 저장하고 화면을 여는 중…';
        try {
          const document = await getDocument(value.id);
          if (!document) throw new Error('저장된 화면을 찾을 수 없습니다.');
          await openSnapshot(document, document.edits, document.note, document.annotations);
          dialog.close();
        } catch (error) {
          status.textContent = error.message;
        } finally {
          loading = false;
          for (const b of list.querySelectorAll('button')) b.disabled = false;
        }
      });
      list.append(button);
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
      documents = await listDocuments(Number.MAX_SAFE_INTEGER);
      render();
      $('#document-search').focus();
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
