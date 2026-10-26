export function createSelectionToolbar({ $, state }) {
  const host = $('#selection-actions'),
    viewport = $('#viewport');
  let manual = null,
    documentId = null,
    gesture = null;
  function position() {
    const scene = state.scene,
      r = scene?.selected && scene.rect(scene.selected);
    host.hidden = !r || scene.hidden(scene.selected) || !state.ready;
    if (host.hidden) return;
    if (documentId !== state.snapshot?.id) {
      manual = null;
      documentId = state.snapshot?.id;
    }
    const f = $('#scene-frame').getBoundingClientRect(),
      v = viewport.getBoundingClientRect();
    const x = f.left + r.x * state.zoom,
      y = f.top + r.y * state.zoom;
    if (
      x + r.width * state.zoom < v.left ||
      x > v.right ||
      y + r.height * state.zoom < v.top ||
      y > v.bottom
    ) {
      host.hidden = true;
      return;
    }
    const left = manual?.x ?? x;
    host.style.left = Math.max(v.left + 4, Math.min(v.right - host.offsetWidth - 4, left)) + 'px';
    const above = y - host.offsetHeight - 48;
    host.style.top =
      Math.max(
        v.top + 8,
        Math.min(
          v.bottom - host.offsetHeight - 8,
          manual?.y ??
            (f.top - v.top >= host.offsetHeight + 8
              ? v.top + 4
              : above >= v.top + 8
                ? above
                : y + r.height * state.zoom + 12),
        ),
      ) + 'px';
  }
  const handle = $('#selection-toolbar-handle');
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const r = host.getBoundingClientRect();
    gesture = { id: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top };
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!gesture || gesture.id !== e.pointerId) return;
    manual = { x: e.clientX - gesture.x, y: e.clientY - gesture.y };
    position();
  });
  const finish = (e) => {
    if (!gesture || gesture.id !== e.pointerId) return;
    gesture = null;
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
  };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  handle.addEventListener('keydown', (e) => {
    const delta = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] }[
      e.key
    ];
    if (!delta && e.key !== 'Home') return;
    e.preventDefault();
    e.stopPropagation();
    const r = host.getBoundingClientRect();
    manual = e.key === 'Home' ? null : { x: r.left + delta[0], y: r.top + delta[1] };
    position();
  });
  viewport.addEventListener('scroll', position);
  viewport.addEventListener('canvas:viewportchange', position);
  new ResizeObserver(position).observe(viewport);
  window.addEventListener('resize', position);
  $('#zoom').addEventListener('change', () => requestAnimationFrame(position));
  for (const id of ['#fit', '#zoom-in', '#zoom-out', '#zoom-selection'])
    $(id).addEventListener('click', () => requestAnimationFrame(position));
  return { position };
}
