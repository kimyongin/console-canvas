export function createCanvasViewport({ $, state }) {
  function sizeChanged(size) {
    state.size = size;
    updateZoom();
  }
  function updateZoom() {
    if (!state.scene) return;
    const { width, height } = state.size,
      zoom = state.zoom;
    state.scene.setDisplayScale(zoom);
    $('#scene-frame').width = width;
    $('#scene-frame').height = height;
    $('#scene-frame').style.transform = 'scale(' + zoom + ')';
    $('#artboard').style.width = width * zoom + 'px';
    $('#artboard').style.height = height * zoom + 'px';
    const select = $('#zoom');
    let option = [...select.options].find((option) => Number(option.value) === zoom);
    if (!option) {
      option = document.createElement('option');
      option.value = zoom;
      option.dataset.custom = '';
      select.append(option);
    }
    option.textContent = Math.round(zoom * 100) + '%';
    select.value = String(zoom);
    $('#viewport').dispatchEvent(new Event('canvas:viewportchange'));
    $('#canvas-dimensions').textContent =
      width + ' × ' + height + ' · ' + Math.round(zoom * 100) + '%';
  }
  function zoomTo(value, anchor = null) {
    const rect = $('#scene-frame').getBoundingClientRect(),
      viewport = $('#viewport'),
      bounds = viewport.getBoundingClientRect();
    const point = anchor || {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    };
    const x = (point.x - rect.left) / state.zoom,
      y = (point.y - rect.top) / state.zoom,
      previous = state.zoom;
    state.zoom = Math.max(0.1, Math.min(2.5, value));
    updateZoom();
    viewport.scrollLeft += (state.zoom - previous) * x;
    viewport.scrollTop += (state.zoom - previous) * y;
  }
  function fit() {
    zoomTo(Math.min(1, Math.max(0.1, ($('#viewport').clientWidth - 96) / state.size.width)));
  }

  function fitSelection() {
    const scene = state.scene;
    if (!scene?.selected) return;
    const rects = scene
      .selectionRoots()
      .map((id) => scene.rect(id))
      .filter(Boolean);
    if (!rects.length) return;
    const x = Math.min(...rects.map((r) => r.x)),
      y = Math.min(...rects.map((r) => r.y)),
      width = Math.max(...rects.map((r) => r.x + r.width)) - x,
      height = Math.max(...rects.map((r) => r.y + r.height)) - y,
      viewport = $('#viewport');
    zoomTo(
      Math.min(
        2.5,
        (viewport.clientWidth - 96) / Math.max(1, width),
        (viewport.clientHeight - 96) / Math.max(1, height),
      ),
    );
    viewport.scrollLeft = Math.max(0, (x + width / 2) * state.zoom - viewport.clientWidth / 2 + 48);
    viewport.scrollTop = Math.max(
      0,
      (y + height / 2) * state.zoom - viewport.clientHeight / 2 + 48,
    );
  }
  return { sizeChanged, zoomTo, fit, fitSelection };
}
