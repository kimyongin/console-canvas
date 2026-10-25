export function configureModelessInspector({ $ }) {
  const dialog = $('#properties-dialog'),
    handle = dialog.querySelector('.popover-heading');
  let gesture = null;
  dialog.addEventListener('toggle', (event) => {
    if (event.newState !== 'open') return;
    const v = $('#viewport').getBoundingClientRect(),
      selected = $('#selection-actions').getBoundingClientRect();
    dialog.style.width = Math.max(220, Math.min(320, v.width - 24)) + 'px';
    dialog.style.maxHeight = Math.max(180, v.height - 24) + 'px';
    dialog.style.right = 'auto';
    dialog.style.left =
      Math.max(
        8,
        selected.left > (v.left + v.right) / 2 ? v.left + 12 : v.right - dialog.offsetWidth - 12,
      ) + 'px';
    dialog.style.top = v.top + 12 + 'px';
  });
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const r = dialog.getBoundingClientRect();
    gesture = { x: e.clientX - r.left, y: e.clientY - r.top, id: e.pointerId };
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!gesture || e.pointerId !== gesture.id) return;
    dialog.style.right = 'auto';
    dialog.style.left =
      Math.max(8, Math.min(innerWidth - dialog.offsetWidth - 8, e.clientX - gesture.x)) + 'px';
    dialog.style.top =
      Math.max(8, Math.min(innerHeight - dialog.offsetHeight - 8, e.clientY - gesture.y)) + 'px';
  });
  function finish(e) {
    if (!gesture || e.pointerId !== gesture.id) return;
    gesture = null;
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
  }
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  window.addEventListener('resize', () => {
    dialog.style.left = '';
    dialog.style.top = '';
    dialog.style.right = '';
  });
}
