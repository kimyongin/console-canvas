// A top-layer menu stays usable inside scrolling lists and modal dialogs.
export function createActionMenu({ label, actions }) {
  const host = document.createElement('div'),
    trigger = document.createElement('button'),
    menu = document.createElement('div');
  host.className = 'action-menu';
  trigger.type = 'button';
  trigger.className = 'more-actions';
  trigger.textContent = '⋯';
  trigger.setAttribute('aria-label', label + ' · 기타 작업');
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  menu.id = 'actions-' + crypto.randomUUID();
  trigger.setAttribute('aria-controls', menu.id);
  menu.className = 'action-menu-popover';
  menu.setAttribute('popover', 'auto');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', label + ' 작업');
  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.setAttribute('role', 'menuitem');
    button.setAttribute('aria-label', label + ' · ' + action.label);
    if (action.kind) button.dataset[action.scope + 'Action'] = action.kind;
    if (action.className) button.className = action.className;
    button.addEventListener('click', () => {
      menu.hidePopover();
      trigger.focus({ preventScroll: true });
      action.run();
    });
    menu.append(button);
  }
  function open(last = false) {
    menu.showPopover();
    const rect = trigger.getBoundingClientRect();
    menu.style.left =
      Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, rect.right - menu.offsetWidth)) +
      'px';
    menu.style.top =
      Math.max(8, Math.min(innerHeight - menu.offsetHeight - 8, rect.bottom + 4)) + 'px';
    (last ? menu.lastElementChild : menu.firstElementChild)?.focus();
  }
  trigger.addEventListener('click', () => {
    if (menu.matches(':popover-open')) menu.hidePopover();
    else open();
  });
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open(event.key === 'ArrowUp');
    }
  });
  menu.addEventListener('toggle', () =>
    trigger.setAttribute('aria-expanded', String(menu.matches(':popover-open'))),
  );
  menu.addEventListener('keydown', (event) => {
    const buttons = [...menu.querySelectorAll('button')],
      index = buttons.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      buttons[
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      ]?.focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      menu.hidePopover();
      trigger.focus({ preventScroll: true });
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
      }
    }
  });
  host.append(trigger, menu);
  return host;
}
