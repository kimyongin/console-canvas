import { trashDocument, cleanDocumentName } from '../db.js';
export function createDocumentSwitcher({ $, state, flushEditor, closeDocument, refresh, toast }) {
  const menu = $('#document-menu-content'),
    form = $('#ticket-settings-form');
  let busy = false;
  menu.addEventListener('toggle', () => {
    if (!menu.matches(':popover-open')) return;
    $('#ticket-name').value = state.snapshot?.documentName || state.snapshot?.source.title || '';
    $('#ticket-settings-error').hidden = true;
  });
  menu.addEventListener('beforetoggle', (e) => {
    if (e.newState !== 'open') return;
    const r = $('#document-menu-button').getBoundingClientRect();
    if (window.ConsoleCanvasDesktop) {
      menu.style.left = Math.max(8, innerWidth - 388) + 'px';
      menu.style.top = '4px';
      return;
    }
    menu.style.left = Math.max(8, Math.min(innerWidth - 388, r.left)) + 'px';
    menu.style.top = r.bottom + 4 + 'px';
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !state.snapshot) return;
    const inputName = $('#ticket-name').value;
    const previous = {
      name: state.snapshot.documentName,
      project: state.project_id,
      revision: state.revision,
    };
    busy = true;
    $('#save-ticket-settings').disabled = true;
    try {
      const name = cleanDocumentName(inputName);
      await flushEditor();
      state.snapshot.documentName = name;

      await flushEditor();
      await refresh();
      menu.hidePopover();
      toast('티켓 설정을 저장했습니다.');
    } catch (error) {
      state.snapshot.documentName = previous.name;
      state.project_id = previous.project;
      state.revision = previous.revision;
      $('#ticket-settings-error').textContent = error.message;
      $('#ticket-settings-error').hidden = false;
    } finally {
      busy = false;
      $('#save-ticket-settings').disabled = !state.snapshot;
    }
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
