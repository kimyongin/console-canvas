// Pointer capture keeps a gesture alive when it crosses the scriptless scene iframe.
export function createAreaSelection({ $, state, toast }) {
  const viewport = $('#viewport');
  let gesture = null,
    unbindScene = () => {};
  const overlay = document.createElement('div');
  overlay.className = 'area-selection';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.hidden = true;
  const label = document.createElement('span');
  overlay.append(label);
  document.body.append(overlay);
  function point(event) {
    if (event.target?.ownerDocument === gesture.scene.doc) {
      const r = gesture.scene.frame.getBoundingClientRect();
      return { x: r.left + event.clientX * state.zoom, y: r.top + event.clientY * state.zoom };
    }
    return { x: event.clientX, y: event.clientY };
  }
  function update(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const g = gesture,
      p = point(event),
      v = viewport.getBoundingClientRect();
    const x = Math.max(v.left, Math.min(v.left + viewport.clientWidth, p.x));
    const y = Math.max(v.top, Math.min(v.top + viewport.clientHeight, p.y));
    if (!g.started && Math.hypot(x - g.x, y - g.y) < 4) return;
    g.started = true;
    const box = {
      left: Math.min(g.x, x),
      top: Math.min(g.y, y),
      right: Math.max(g.x, x),
      bottom: Math.max(g.y, y),
    };
    Object.assign(overlay.style, {
      left: box.left + 'px',
      top: box.top + 'px',
      width: box.right - box.left + 'px',
      height: box.bottom - box.top + 'px',
    });
    overlay.hidden = false;
    const inside = new Set(
      g.candidates
        .filter(
          (r) =>
            r.x >= box.left - 0.01 &&
            r.y >= box.top - 0.01 &&
            r.x + r.width <= box.right + 0.01 &&
            r.y + r.height <= box.bottom + 0.01,
        )
        .map((r) => r.id),
    );
    const combined = new Set([...(g.additive ? g.before : []), ...inside]);
    const all = [...combined].filter((id) => !g.scene.ancestors(id).some((p) => combined.has(p)));
    g.truncated = all.length > 100;
    const ids = all.slice(0, 100);
    label.textContent = ids.length + '개 선택' + (g.truncated ? ' · 최대 100개' : '');
    if (JSON.stringify(ids) !== JSON.stringify([...g.scene.selection]))
      g.scene.select(ids.at(-1), { ids });
  }
  function finish(event, cancel = false) {
    const g = gesture;
    if (!g || (event?.pointerId != null && event.pointerId !== g.pointerId)) return;
    if (!cancel && event?.clientX != null) update(event);
    gesture = null;
    g.scene.areaSelecting = false;
    overlay.hidden = true;
    document.body.classList.remove('selecting-area');
    if (g.capture.hasPointerCapture(g.pointerId)) g.capture.releasePointerCapture(g.pointerId);
    if (cancel) g.scene.select(g.primary, { ids: g.before });
    else if (!g.started) {
      if (!g.additive) g.scene.select(g.clickId);
    } else
      toast(
        g.scene.selection.size +
          '개 요소를 선택했습니다.' +
          (g.truncated ? ' 한 번에 100개까지 선택할 수 있습니다.' : ''),
      );
  }
  function start(event, clickId = null) {
    const scene = state.scene;
    if (
      !state.ready ||
      !scene ||
      scene.drag ||
      gesture ||
      event.button !== 0 ||
      state.mode !== 'edit'
    )
      return false;
    event.preventDefault();
    event.stopPropagation();
    gesture = {
      scene,
      pointerId: event.pointerId,
      capture: event.target.ownerDocument.documentElement,
      before: [...scene.selection],
      primary: scene.selected,
      clickId,
      additive: event.ctrlKey || event.metaKey,
      started: false,
    };
    const p = point(event);
    gesture.x = p.x;
    gesture.y = p.y;
    const f = scene.frame.getBoundingClientRect(),
      win = scene.frame.contentWindow;
    gesture.candidates = [...scene.nodes.values()]
      .filter((n) => n.visible && scene.elements.has(n.id) && !scene.hidden(n.id))
      .map((n) => ({ id: n.id, ...scene.rect(n.id) }))
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({
        id: r.id,
        x: f.left + (r.x - win.scrollX) * state.zoom,
        y: f.top + (r.y - win.scrollY) * state.zoom,
        width: r.width * state.zoom,
        height: r.height * state.zoom,
      }));
    scene.areaSelecting = true;
    scene.hover.style.display = 'none';
    document.body.classList.add('selecting-area');
    gesture.capture.setPointerCapture(event.pointerId);
    return true;
  }
  function beginScene(event, id) {
    const scene = state.scene;
    if (event.altKey || event.shiftKey || scene?.selection.has(id)) return false;
    const semantic =
      id &&
      [id, ...scene.ancestors(id)].some((key) =>
        ['button', 'a', 'input', 'select', 'textarea', 'svg'].includes(scene.nodes.get(key)?.tag),
      );
    if (semantic) return false;
    if (
      id &&
      !['body', 'html'].includes(scene.nodes.get(id)?.tag) &&
      !scene.children.get(id)?.length
    )
      return false;
    return start(event, ['body', 'html'].includes(scene.nodes.get(id)?.tag) ? null : id);
  }
  function listeners(doc) {
    const move = (e) => update(e),
      up = (e) => finish(e),
      cancel = (e) => finish(e, true);
    const key = (e) => {
      if (gesture && e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        finish(null, true);
      }
    };
    const wheel = () => finish(null, true);
    doc.addEventListener('pointermove', move, true);
    doc.addEventListener('pointerup', up, true);
    doc.addEventListener('pointercancel', cancel, true);
    doc.addEventListener('lostpointercapture', cancel, true);
    doc.addEventListener('keydown', key, true);
    doc.addEventListener('wheel', wheel, { capture: true, passive: true });
    return () => {
      doc.removeEventListener('pointermove', move, true);
      doc.removeEventListener('pointerup', up, true);
      doc.removeEventListener('pointercancel', cancel, true);
      doc.removeEventListener('lostpointercapture', cancel, true);
      doc.removeEventListener('keydown', key, true);
      doc.removeEventListener('wheel', wheel, true);
    };
  }
  listeners(document);
  viewport.addEventListener('pointerdown', (event) => {
    if (event.target.closest('#welcome,button,input,a')) return;
    start(event);
  });
  viewport.addEventListener('scroll', () => finish(null, true));
  window.addEventListener('blur', () => finish(null, true));
  window.addEventListener('resize', () => finish(null, true));
  return {
    beginScene,
    bind(scene) {
      unbindScene();
      unbindScene = listeners(scene.doc);
    },
    reset() {
      finish(null, true);
      unbindScene();
      unbindScene = () => {};
    },
  };
}
