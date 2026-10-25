export function createSelectionToolbar({ $, state }) {
  const host = $('#selection-actions'),
    viewport = $('#viewport');
  function position() {
    const scene = state.scene,
      r = scene?.selected && scene.rect(scene.selected);
    host.hidden = !r || scene.hidden(scene.selected) || !state.ready;
    if (host.hidden) return;
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
    host.style.left = Math.max(v.left + 8, Math.min(v.right - host.offsetWidth - 8, x)) + 'px';
    const above = y - host.offsetHeight - 48;
    host.style.top =
      Math.max(
        v.top + 8,
        Math.min(
          v.bottom - host.offsetHeight - 8,
          above >= v.top + 8 ? above : y + r.height * state.zoom + 12,
        ),
      ) + 'px';
  }
  viewport.addEventListener('scroll', position);
  viewport.addEventListener('canvas:viewportchange', position);
  new ResizeObserver(position).observe(viewport);
  window.addEventListener('resize', position);
  $('#zoom').addEventListener('change', () => requestAnimationFrame(position));
  for (const id of ['#fit', '#zoom-in', '#zoom-out', '#zoom-selection'])
    $(id).addEventListener('click', () => requestAnimationFrame(position));
  return { position };
}
