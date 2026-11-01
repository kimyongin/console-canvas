import { trashDocument, cleanDocumentName } from '../db.js';
export function createDocumentSwitcher({
  $,
  state,
  flushEditor,
  closeDocument,
  refresh,
  toast,
  renameDialog,
}) {
  const menu = $('#document-menu-content');
  menu.addEventListener('toggle', () => {
    $('#document-menu-button').setAttribute('aria-expanded', String(menu.matches(':popover-open')));
    state.publishWorkspace?.();
  });
  menu.addEventListener('beforetoggle', (e) => {
    if (e.newState !== 'open') return;
    const r = $('#document-menu-button').getBoundingClientRect();
    menu.style.left =
      Math.max(
        8,
        Math.min(innerWidth - 388, window.ConsoleCanvasDesktop ? innerWidth - 388 : r.left),
      ) + 'px';
    menu.style.top = window.ConsoleCanvasDesktop ? '4px' : r.bottom + 4 + 'px';
  });
  $('#rename-ticket').addEventListener('click', () => {
    if (!state.snapshot) return;
    menu.hidePopover();
    const snapshot = state.snapshot,
      previous = snapshot.documentName;
    renameDialog.open('티켓 이름 변경', previous || snapshot.source.title || '', async (input) => {
      const name = cleanDocumentName(input);
      await flushEditor();
      if (state.snapshot !== snapshot) throw Error('편집 티켓이 바뀌었습니다. 다시 열어 주세요.');
      try {
        snapshot.documentName = name;
        await flushEditor();
        await refresh();
        toast('티켓 이름을 변경했습니다.');
      } catch (error) {
        snapshot.documentName = previous;
        throw error;
      }
    });
  });
  $('#trash-current').addEventListener('click', async () => {
    if (!state.snapshot) return;
    const id = state.snapshot.id;
    try {
      await flushEditor();
      await trashDocument(id);
      menu.hidePopover();
      await closeDocument(id);
      toast('티켓 휴지통에서 복구할 수 있습니다.');
    } catch (error) {
      toast(error.message);
    }
  });
}
