import { renderPng } from './export.js';
import { aiInputError, AI_IMAGE_LIMIT } from './ai-input-policy.js';
const dataUrl = (blob) =>
  new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = no;
    r.readAsDataURL(blob);
  });
async function photo(html, size, marks = []) {
  const blob = globalThis.ConsoleCanvasDesktop?.renderImage
    ? new Blob([await globalThis.ConsoleCanvasDesktop.renderImage({ html, ...size })], {
        type: 'image/png',
      })
    : await renderPng(html, size.width, size.height);
  const bitmap = await createImageBitmap(blob),
    canvas = document.createElement('canvas');
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const c = canvas.getContext('2d');
  c.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const mark of marks) {
    const x = mark.x * scale,
      y = mark.y * scale;
    if (x < 0 || y < 0 || x > canvas.width || y > canvas.height) continue;
    c.strokeStyle = '#6350e8';
    c.lineWidth = 2;
    c.strokeRect(x, y, mark.width * scale, mark.height * scale);
    c.fillStyle = '#6350e8';
    c.fillRect(x, y, 30, 22);
    c.fillStyle = 'white';
    c.font = 'bold 13px sans-serif';
    c.fillText(String(mark.number), x + 4, y + 16);
  }
  const result = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  return { blob: result, image_url: await dataUrl(result) };
}
export async function buildVisualContext(scene, point) {
  const selected = (point.selection || []).filter(
    (id) => scene.elements.has(id) && !scene.hidden(id),
  );
  const within = (id) =>
    !selected.length ||
    selected.some(
      (s) => s === id || scene.ancestors(id).includes(s) || scene.ancestors(s).includes(id),
    );
  const nodes = [...scene.nodes.values()].filter(
    (n) => n.kind !== 'text' && scene.elements.has(n.id) && !scene.hidden(n.id) && within(n.id),
  );
  nodes.sort(
    (a, b) =>
      Number(selected.includes(b.id)) - Number(selected.includes(a.id)) ||
      scene.ancestors(a.id).length - scene.ancestors(b.id).length,
  );
  const targets = nodes.slice(0, 60).map((n, i) => ({
    id: n.id,
    number: i + 1,
    role: n.tag,
    label: (n.name || '').slice(0, 80),
    parent_id: n.parentId,
    rect: scene.rect(n.id),
  }));
  const size = scene.contentSize(),
    base = scene.viewRect();
  const view = {
    x: base.x,
    y: base.y,
    width: Math.min(base.width, scene.snapshot.source.viewport?.width || 1920),
    height: Math.min(base.height, scene.snapshot.source.viewport?.height || 1080),
  };
  const images = [],
    warnings = [];
  let bytes = 0;
  async function add(html, dimensions, metadata, marks = []) {
    if (images.length >= 8) {
      warnings.push('Image budget reached; further detail omitted.');
      return false;
    }
    const result = await photo(html, dimensions, marks);
    bytes += result.blob.size;
    if (bytes > AI_IMAGE_LIMIT) throw aiInputError('input_image_too_large');
    images.push({ ...metadata, image_url: result.image_url });
    return true;
  }
  function scoped(rect) {
    const doc = new DOMParser().parseFromString(scene.serialize(), 'text/html');
    doc.querySelector('meta[name="console-canvas-view"]')?.remove();
    const m = doc.createElement('meta');
    m.name = 'console-canvas-view';
    m.content = [rect.x, rect.y, rect.width, rect.height].join(',');
    doc.head.append(m);
    return '<!doctype html>' + doc.documentElement.outerHTML;
  }
  await add(
    scoped(view),
    size,
    { kind: 'overview', rect: view },
    targets
      .filter((t) => t.rect)
      .map((t) => ({ ...t.rect, x: t.rect.x - view.x, y: t.rect.y - view.y, number: t.number })),
  );
  const target = targets.find((t) => selected.includes(t.id));
  if (target?.rect) {
    const r = target.rect,
      x = Math.max(0, r.x),
      y = Math.max(0, r.y);
    const crop = {
      x,
      y,
      width: Math.max(1, Math.min(r.width, size.width - x)),
      height: Math.max(1, Math.min(r.height, size.height - y, 4000)),
    };
    if (crop.x < size.width && crop.y < size.height)
      await add(scoped(crop), size, {
        kind: 'selection_detail',
        target_id: target.id,
        number: target.number,
        rect: crop,
        partial: crop.height < r.height,
      });
  }
  const scrolls = nodes.filter((n) => {
    const e = scene.elements.get(n.id),
      s = scene.doc.defaultView.getComputedStyle(e);
    return (
      e.clientWidth > 10 &&
      e.clientHeight > 10 &&
      ((/auto|scroll/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 2) ||
        (/auto|scroll/.test(s.overflowX) && e.scrollWidth > e.clientWidth + 2))
    );
  });
  for (const n of scrolls.slice(0, 2)) {
    const el = scene.elements.get(n.id),
      w = el.clientWidth,
      h = el.clientHeight,
      sw = el.scrollWidth,
      sh = el.scrollHeight;
    const nx = Math.ceil(sw / w),
      ny = Math.ceil(sh / h),
      tileCount = nx * ny;
    const capacity = Math.min(6, 8 - images.length);
    if (!capacity) {
      warnings.push(`Scroll region ${n.id} omitted because image budget is full.`);
      continue;
    }
    const indices =
      tileCount <= capacity
        ? Array.from({ length: tileCount }, (_, i) => i)
        : capacity >= 3
          ? [0, Math.floor(tileCount / 2), tileCount - 1]
          : Array.from({ length: capacity }, (_, i) => i);
    const chosen = indices.map((i) => ({
      x: Math.min((i % nx) * w, sw - w),
      y: Math.min(Math.floor(i / nx) * h, sh - h),
    }));
    const clone = el.cloneNode(true);
    clone.style.setProperty('position', 'relative', 'important');
    clone.style.setProperty('inset', 'auto', 'important');
    clone.style.setProperty('transform', 'none', 'important');
    clone.style.setProperty('margin', '0', 'important');
    clone.style.setProperty('box-sizing', 'border-box', 'important');
    clone.style.setProperty('width', el.offsetWidth + 'px', 'important');
    clone.style.setProperty('height', el.offsetHeight + 'px', 'important');
    clone.style.setProperty('max-height', 'none', 'important');
    clone.style.setProperty('max-width', 'none', 'important');
    clone.style.setProperty('overflow', 'auto', 'important');
    clone.style.setProperty('contain', 'layout paint', 'important');
    for (const tile of chosen) {
      clone.setAttribute('data-uic-scroll-x', String(tile.x));
      clone.setAttribute('data-uic-scroll-y', String(tile.y));
      // Browser SVG fallback cannot restore scrolling; translate a copy of the
      // contents. Native rendering uses the real scrollport/sticky semantics.
      const copy = clone.cloneNode(true);
      if (!globalThis.ConsoleCanvasDesktop?.renderImage) {
        const inner = scene.doc.createElement('div');
        while (copy.firstChild) inner.append(copy.firstChild);
        inner.style.transform = `translate(${-tile.x}px,${-tile.y}px)`;
        inner.style.width = sw + 'px';
        copy.append(inner);
      }
      const html =
        '<!doctype html><html style="' +
        (scene.doc.documentElement.getAttribute('style') || '')
          .replaceAll('&', '&amp;')
          .replaceAll('"', '&quot;') +
        '"><head>' +
        [...scene.doc.head.querySelectorAll('style')].map((s) => s.outerHTML).join('') +
        '</head><body style="margin:0;background:white">' +
        copy.outerHTML +
        '</body></html>';
      await add(
        html,
        { width: Math.ceil(el.offsetWidth), height: Math.ceil(el.offsetHeight) },
        {
          kind: 'scroll_detail',
          target_id: n.id,
          number: targets.find((t) => t.id === n.id)?.number,
          viewport: { width: w, height: h },
          content: { width: sw, height: sh },
          offset: tile,
          current_offset: { x: el.scrollLeft, y: el.scrollTop },
          coverage: tileCount <= chosen.length ? 'captured_content' : 'sampled',
          tile_count: tileCount,
          provided_tiles: chosen.length,
        },
      );
    }
  }
  if (scrolls.length > 2)
    warnings.push(
      `${scrolls.length - 2} related scroll regions omitted; select a region for further detail.`,
    );
  return {
    kind: 'visual',
    selection: selected,
    targets,
    annotations: point.annotations,
    note: point.note,
    images,
    warnings,
    coverage:
      'Captured DOM only. Virtualized, unloaded and collapsed content may be absent. Scroll detail is a separate view; preserve the actual viewport and scrolling. Number labels identify local edit targets, not source selectors.',
    omitted_target_count: Math.max(0, nodes.length - targets.length),
  };
}
