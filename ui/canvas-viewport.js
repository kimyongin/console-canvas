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
    $('#canvas-dimensions').textContent =
      width + ' × ' + height + ' · ' + Math.round(zoom * 100) + '%';
  }
  function zoomTo(value) {
    state.zoom = Math.max(0.1, Math.min(2.5, value));
    updateZoom();
  }
  function fit() {
    zoomTo(Math.min(1, Math.max(0.1, ($('#viewport').clientWidth - 96) / state.size.width)));
  }

  return { sizeChanged, zoomTo, fit };
}
