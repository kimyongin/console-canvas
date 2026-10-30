// One modal owns information, photo comparison and asset repair. Sub-pages never open dialogs.
export function createCaptureWorkspace({ $, state, adapter, renderStatus }) {
  const dialog = $('#capture-status-dialog');
  const pages = {
    info: $('#capture-info-view'),
    source: $('#source-compare-dialog'),
    repair: $('#repair-assets-dialog'),
  };
  const titles = {
    info: 'capture-status-title',
    source: 'source-compare-title',
    repair: 'repair-assets-title',
  };
  const labels = {
    info: '가져오기 정보 닫기',
    source: '원본 사진 비교 닫기',
    repair: '자산 복구 닫기',
  };
  let page = 'info',
    origin = null,
    identity = null;
  const leave = new Map();
  function notify() {
    for (const fn of leave.get(page) || []) fn();
  }
  function display(next) {
    page = next;
    for (const [id, host] of Object.entries(pages)) host.hidden = id !== next;
    dialog.dataset.page = next;
    dialog.setAttribute('aria-labelledby', titles[next]);
    $('#capture-task-close').setAttribute('aria-label', labels[next]);
    $('#capture-task-back').hidden = !origin || next === 'info';
  }
  function show(next) {
    if (!state.ready) return;
    if (dialog.open && page === 'info' && next !== 'info')
      origin = { scroll: dialog.scrollTop, focus: document.activeElement };
    else if (!dialog.open || next === 'info') origin = null;
    if (page !== next) notify();
    identity = { document: state.snapshot.id, generation: state.generation };
    display(next);
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
    (next === 'info'
      ? $('#capture-task-close')
      : $('#capture-task-back').hidden
        ? $('#capture-task-close')
        : $('#capture-task-back')
    ).focus();
  }
  function back() {
    if (!origin || page === 'info') {
      dialog.close();
      return;
    }
    const target = origin;
    origin = null;
    notify();
    if (identity?.document !== state.snapshot?.id || identity.generation !== state.generation) {
      dialog.close();
      return;
    }
    display('info');
    renderStatus();
    dialog.scrollTop = target.scroll;
    if (target.focus?.isConnected && !target.focus.disabled)
      target.focus.focus({ preventScroll: true });
    else $('#capture-task-close').focus();
  }
  dialog.addEventListener('cancel', (event) => {
    if (page !== 'info' && origin) {
      event.preventDefault();
      back();
    }
  });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    notify();
    origin = null;
    identity = null;
    display('info');
  });
  adapter.register('capture-back', back);
  return {
    show,
    back,
    close: () => dialog.close(),
    active: (id) => dialog.open && page === id,
    onLeave(id, fn) {
      if (!leave.has(id)) leave.set(id, new Set());
      leave.get(id).add(fn);
    },
  };
}
