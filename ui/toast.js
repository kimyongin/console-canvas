export function createToast({ $ }) {
  let timer;
  return function toast(message, action = null) {
    const box = $('#toast'),
      text = document.createElement('span');
    clearTimeout(timer);
    // Controls outside a modal are inert, so place its feedback inside that modal.
    const dialogs = [...document.querySelectorAll('dialog[open]')];
    (dialogs.at(-1) || document.body).append(box);
    text.textContent = message;
    box.replaceChildren(text);
    box.hidden = false;
    if (action) {
      const button = document.createElement('button');
      button.textContent = action.label;
      button.id = 'toast-action';
      button.addEventListener('click', async () => {
        clearTimeout(timer);
        button.disabled = true;
        try {
          await action.run();
          if (box.contains(button)) box.hidden = true;
        } catch (error) {
          toast(error.message, action);
        }
      });
      box.append(button);
    }
    timer = setTimeout(
      () => {
        box.hidden = true;
      },
      action ? 15000 : 4500,
    );
  };
}
