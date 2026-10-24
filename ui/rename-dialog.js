export function createRenameDialog({ $ }) {
  const dialog = $('#rename-dialog'),
    field = $('#rename-name');
  let save = null,
    busy = false;
  function open(title, name, onSave) {
    if (dialog.open) return;
    save = onSave;
    $('#rename-title').textContent = title;
    field.value = name;
    $('#rename-error').textContent = '';
    dialog.showModal();
    field.focus();
    field.select();
  }
  $('#rename-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !save) return;
    const name = field.value.trim();
    if (!name || name.length > 120) {
      $('#rename-error').textContent = '이름은 1~120자로 입력해 주세요.';
      return;
    }
    busy = true;
    $('#rename-save').disabled = true;
    $('#rename-cancel').disabled = true;
    try {
      await save(name);
      dialog.close();
    } catch (error) {
      $('#rename-error').textContent = error.message;
    } finally {
      busy = false;
      $('#rename-save').disabled = false;
      $('#rename-cancel').disabled = false;
    }
  });
  $('#rename-cancel').addEventListener('click', () => {
    if (!busy) dialog.close();
  });
  dialog.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault();
  });
  dialog.addEventListener('close', () => {
    save = null;
  });
  return { open };
}
