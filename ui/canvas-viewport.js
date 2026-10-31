export function createCanvasViewport({ $, state }) {
  let pendingFit = null,
    fitObserver = null;
  function cancelFit() {
    pendingFit = null;
    fitObserver?.disconnect();
  }
  function sizeChanged(size) {
    state.size = size;
    updateZoom();
  }
  function updateZoom() {
    if (!state.scene) return;
    const { width, height } = state.size,
      zoom = state.zoom,
      view = state.scene.viewRect();
    state.scene.setDisplayScale(zoom);
    $('#scene-frame').width = width;
    $('#scene-frame').height = height;
    $('#scene-frame').style.transform =
      `translate(${-view.x * zoom}px,${-view.y * zoom}px) scale(${zoom})`;
    $('#artboard').style.width = view.width * zoom + 'px';
    $('#artboard').style.height = view.height * zoom + 'px';
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
      view.width + ' × ' + view.height + ' · ' + Math.round(zoom * 100) + '%';
  }
  function zoomTo(value, anchor = null) {
    cancelFit();
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
    viewport.scrollLeft += (state.zoom - previous) * (x - state.scene.viewRect().x);
    viewport.scrollTop += (state.zoom - previous) * (y - state.scene.viewRect().y);
  }
  function applyFit() {
    if (!pendingFit) return true;
    if (pendingFit.scene !== state.scene) {
      cancelFit();
      return true;
    }
    const viewport = $('#viewport');
    if (viewport.clientWidth <= 96 || !viewport.clientHeight) return false;
    const onFit = pendingFit.onFit;
    zoomTo(Math.min(1, Math.max(0.1, (viewport.clientWidth - 96) / state.scene.viewRect().width)));
    if (typeof onFit === 'function') onFit();
    return true;
  }
  function fit(onFit) {
    cancelFit();
    if (!state.scene) return;
    pendingFit = { scene: state.scene, onFit };
    // Electron restores the document before displaying its WebContentsView.
    // Wait for a usable viewport without delaying document readiness or later
    // overwriting a manual zoom. The observer belongs only to this pending fit.
    if (!applyFit()) {
      fitObserver ||= new ResizeObserver(applyFit);
      fitObserver.observe($('#viewport'));
    }
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
    viewport.scrollLeft = Math.max(
      0,
      (x - state.scene.viewRect().x + width / 2) * state.zoom - viewport.clientWidth / 2 + 48,
    );
    viewport.scrollTop = Math.max(
      0,
      (y - state.scene.viewRect().y + height / 2) * state.zoom - viewport.clientHeight / 2 + 48,
    );
  }
  return { sizeChanged, zoomTo, fit, fitSelection };
}
