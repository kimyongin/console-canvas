export function createWorkspaceLayout({ $, commitCommentDraft }) {
  const panelStorageKey = 'console-canvas-panels-v1';
  const panels = {
    layers: !!window.ConsoleCanvasDesktop || window.innerWidth > 850,
    properties: true,
  };
  const panelWidths = { layers: null, properties: null },
    panelMinimum = { layers: 160, properties: 200 };
  let panelDrag = null;
  try {
    const stored = JSON.parse(localStorage.getItem(panelStorageKey));
    for (const key of Object.keys(panels)) {
      if (typeof stored?.[key] === 'boolean') panels[key] = stored[key];
      const width = stored?.widths?.[key];
      if (typeof width === 'number' && Number.isFinite(width))
        panelWidths[key] = Math.max(panelMinimum[key], Math.min(520, width));
    }
  } catch {}
  function persistPanels() {
    try {
      localStorage.setItem(panelStorageKey, JSON.stringify({ ...panels, widths: panelWidths }));
    } catch {}
  }
  const railWidth = () =>
    parseFloat(getComputedStyle($('#workspace')).getPropertyValue('--panel-rail-width')) || 36;
  function renderPanelWidths() {
    const workspace = $('#workspace'),
      width = workspace.clientWidth || window.innerWidth || 1440;
    const display = {
      layers: panelWidths.layers ?? (width <= 1100 ? 190 : 228),
      properties: panelWidths.properties ?? (width <= 1100 ? 220 : 250),
    };
    const visible = Object.keys(panels).filter((key) => panels[key]),
      minimum = visible.reduce((sum, key) => sum + panelMinimum[key], 0),
      budget = Math.max(minimum, width - 320 - (2 - visible.length) * railWidth());
    const wanted = visible.reduce((sum, key) => sum + display[key], 0);
    if (wanted > budget) {
      const flexible = wanted - minimum;
      for (const key of visible)
        display[key] = Math.floor(
          panelMinimum[key] + ((display[key] - panelMinimum[key]) * (budget - minimum)) / flexible,
        );
    }
    for (const key of Object.keys(panels)) {
      workspace.style.setProperty('--' + key + '-open-width', display[key] + 'px');
      const handle = $('#resize-' + key),
        other = key === 'layers' ? 'properties' : 'layers';
      handle.hidden = !panels[key] || window.innerWidth <= 580;
      handle.setAttribute('aria-valuemin', String(panelMinimum[key]));
      handle.setAttribute(
        'aria-valuemax',
        String(
          Math.max(
            panelMinimum[key],
            Math.min(520, width - 320 - (panels[other] ? display[other] : railWidth())),
          ),
        ),
      );
      handle.setAttribute('aria-valuenow', String(Math.round(display[key])));
      handle.setAttribute('aria-valuetext', Math.round(display[key]) + '픽셀');
    }
  }
  function renderPanels() {
    for (const [key, visible] of Object.entries(panels)) {
      const label = key === 'layers' ? '레이어' : '변경 이력',
        button = $('#toggle-' + key);
      const focused = document.activeElement === button;
      const home = $('#' + key + (visible ? '-toggle-home' : '-toggle-rail'));
      if (button.parentElement !== home) home.append(button);
      $('#' + key + '-panel').hidden = !visible;
      $('#' + key + '-rail').hidden = visible;
      $('#workspace').classList.toggle(key + '-collapsed', !visible);
      button.setAttribute('aria-expanded', String(visible));
      button.setAttribute('aria-label', label + ' 패널 ' + (visible ? '접기' : '펼치기'));
      button.title = label + ' 패널 ' + (visible ? '접기' : '펼치기');
      if (focused) button.focus({ preventScroll: true });
    }

    renderPanelWidths();
  }
  function setPanelVisibility(key, visible, { persist = true } = {}) {
    if (panelDrag) finishPanelResize();
    if (key === 'properties' && !visible) commitCommentDraft();
    panels[key] = visible;
    renderPanels();
    if (persist) persistPanels();
  }
  function resizePanel(key, width, otherWidth) {
    const other = key === 'layers' ? 'properties' : 'layers',
      maximum = Math.max(
        panelMinimum[key],
        Math.min(
          520,
          $('#workspace').clientWidth - 320 - (panels[other] ? otherWidth : railWidth()),
        ),
      );
    panelWidths[key] = Math.round(Math.max(panelMinimum[key], Math.min(maximum, width)));
    if (panels[other]) panelWidths[other] = otherWidth;
    renderPanelWidths();
  }
  function finishPanelResize(cancel = false) {
    if (!panelDrag) return;
    const drag = panelDrag;
    panelDrag = null;
    if (cancel) Object.assign(panelWidths, drag.previous);
    document.body.classList.remove('resizing-panels');
    drag.handle.classList.remove('active');
    if (drag.handle.hasPointerCapture(drag.pointerId))
      drag.handle.releasePointerCapture(drag.pointerId);
    renderPanelWidths();
    persistPanels();
  }
  for (const key of Object.keys(panels)) {
    const handle = $('#resize-' + key),
      other = key === 'layers' ? 'properties' : 'layers',
      direction = key === 'layers' ? 1 : -1;
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || panelDrag || handle.hidden) return;
      event.preventDefault();
      handle.focus({ preventScroll: true });
      panelDrag = {
        key,
        handle,
        pointerId: event.pointerId,
        x: event.clientX,
        width: $('#' + key + '-panel').getBoundingClientRect().width,
        otherWidth: panels[other] ? $('#' + other + '-panel').getBoundingClientRect().width : 0,
        previous: { ...panelWidths },
      };
      document.body.classList.add('resizing-panels');
      handle.classList.add('active');
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {}
    });
    handle.addEventListener('lostpointercapture', () => {
      if (panelDrag?.handle === handle) finishPanelResize();
    });
    handle.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape' && panelDrag) {
        event.preventDefault();
        finishPanelResize(true);
        return;
      }
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const width = $('#' + key + '-panel').getBoundingClientRect().width,
        otherWidth = panels[other] ? $('#' + other + '-panel').getBoundingClientRect().width : 0;
      const target =
        event.key === 'Home'
          ? panelMinimum[key]
          : event.key === 'End'
            ? 520
            : width +
              (event.key === 'ArrowRight' ? 1 : -1) * direction * (event.shiftKey ? 50 : 10);
      resizePanel(key, target, otherWidth);
      persistPanels();
    });
  }
  window.addEventListener('pointermove', (event) => {
    if (!panelDrag || event.pointerId !== panelDrag.pointerId) return;
    event.preventDefault();
    resizePanel(
      panelDrag.key,
      panelDrag.width + (event.clientX - panelDrag.x) * (panelDrag.key === 'layers' ? 1 : -1),
      panelDrag.otherWidth,
    );
  });
  for (const type of ['pointerup', 'pointercancel'])
    window.addEventListener(type, (event) => {
      if (panelDrag?.pointerId === event.pointerId) finishPanelResize();
    });
  window.addEventListener('blur', () => finishPanelResize());
  new ResizeObserver(renderPanelWidths).observe($('#workspace'));
  for (const key of Object.keys(panels))
    $('#toggle-' + key).addEventListener('click', () => setPanelVisibility(key, !panels[key]));
  renderPanels();

  return {
    panels,
    setPanelVisibility,
    snapshotLayout: () => ({ visibility: { ...panels }, widths: { ...panelWidths } }),
    restoreLayout(value) {
      Object.assign(panels, value.visibility);
      Object.assign(panelWidths, value.widths);
      renderPanels();
      persistPanels();
    },
  };
}
