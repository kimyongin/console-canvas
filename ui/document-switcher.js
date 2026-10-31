import { listDocuments, renameDocument, trashDocument } from '../db.js';
import { renderQuickDocuments } from './react/lists.tsx';
export function createDocumentSwitcher({
  $,
  state,
  openTicket,
  showTickets,
  flushEditor,
  closeDocument,
  renameCurrent,
  renameDialog,
  toast,
}) {
  const menu = $('#document-menu-content');
  let values = [];
  const open = async (id) => {
    menu.hidePopover();
    await openTicket(id);
  };
  const rename = (value) => {
    menu.hidePopover();
    renameDialog.open('티켓 이름 변경', value.title, async (name) => {
      await flushEditor();
      await renameDocument(value.id, name);
      if (value.id === state.snapshot?.id) renameCurrent(name);
      toast('티켓 이름을 변경했습니다.');
    });
  };
  async function trash(id) {
    menu.hidePopover();
    await flushEditor();
    await trashDocument(id);
    if (state.snapshot?.id === id) await closeDocument(id);
    toast('티켓 휴지통에서 복구할 수 있습니다.');
  }
  function render() {
    const query = $('#quick-document-search').value.toLocaleLowerCase();
    const matches = values.filter((v) =>
      (v.title + ' ' + v.url).toLocaleLowerCase().includes(query),
    );
    renderQuickDocuments(
      $('#quick-documents'),
      matches.slice(0, 10).map((v) => ({
        id: v.id,
        title: v.title,
        url: v.url,
        current: v.id === state.snapshot?.id,
        summary: v,
        date: '최근 편집 ' + new Date(v.updatedAt).toLocaleString(),
        captured: '',
        open: () => open(v.id),
        rename: (name) => renameDocument(v.id, name),
        actions: [
          { label: '이름 변경', run: () => rename(v) },
          { label: '휴지통으로 이동', run: () => trash(v.id) },
        ],
      })),
      false,
    );
    $('#quick-document-status').textContent = matches.length + '개 티켓';
  }
  $('#quick-document-search').addEventListener('input', render);
  menu.addEventListener('toggle', async (e) => {
    if (e.newState !== 'open') return;
    values = await listDocuments(10000);
    render();
    $('#quick-document-search').focus();
  });
  menu.addEventListener('beforetoggle', (e) => {
    if (e.newState !== 'open') return;
    const r = $('#document-menu-button').getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(innerWidth - 388, r.left)) + 'px';
    menu.style.top = r.bottom + 4 + 'px';
  });
  for (const id of ['#documents-button', '#documents-trash-button'])
    $(id).addEventListener('click', () => {
      menu.hidePopover();
      showTickets();
    });
  $('#rename-current').addEventListener('click', () => {
    if (state.snapshot)
      rename({
        id: state.snapshot.id,
        title: state.snapshot.documentName || state.snapshot.source.title,
      });
  });
  $('#trash-current').addEventListener('click', () => {
    if (state.snapshot) trash(state.snapshot.id);
  });
}
