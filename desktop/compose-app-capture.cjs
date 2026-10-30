// Executed in the shell's isolated world. Parses frozen clones only; never
// changes the source UI or runs its scripts. No preload/API crosses the result.
async function composeAppCapture({ parts, width, height, view, version }) {
  const doc = new DOMParser().parseFromString(
    '<!doctype html><html><head></head><body></body></html>',
    'text/html',
  );
  const rect = { x: 0, y: 0, width, height },
    nodes = [
      {
        id: 'n1',
        parentId: null,
        kind: 'element',
        tag: 'body',
        name: 'Console Canvas 앱 화면',
        rect,
        locator: { selector: 'body', text: 'Console Canvas' },
        visible: true,
      },
    ],
    warnings = [];
  doc.documentElement.lang = 'ko';
  doc.body.dataset.uicId = 'n1';
  doc.body.style.cssText = `margin:0;position:relative;width:${width}px;height:${height}px;overflow:hidden;background:#f5f6fb`;
  const style = doc.createElement('style');
  style.textContent =
    'html,body{margin:0;padding:0}*{animation:none!important;transition:none!important}[data-uic-text]{display:contents}';
  doc.head.append(style);
  const intersect = (a, b) => {
    const x = Math.max(a.x, b.x),
      y = Math.max(a.y, b.y);
    return {
      x,
      y,
      width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
      height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
    };
  };
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  for (const { snapshot, bounds, surface } of parts) {
    const parsed = new DOMParser().parseFromString(snapshot.html, 'text/html'),
      ids = new Map(snapshot.nodes.map((n, index) => [n.id, 'n' + (nodes.length + index + 1)])),
      offset = snapshot.source.scroll || { x: 0, y: 0 },
      mapRect = (r) => ({ ...r, x: r.x - offset.x + bounds.x, y: r.y - offset.y + bounds.y });
    for (const n of snapshot.nodes) {
      const mapped = mapRect(n.rect),
        clip = n.captureClip ? intersect(bounds, mapRect(n.captureClip)) : bounds;
      const area = intersect(mapped, clip);
      const item = {
        ...n,
        id: ids.get(n.id),
        parentId: ids.get(n.parentId) || 'n1',
        rect: mapped,
        captureClip: clip,
        visible: n.visible && area.width > 0 && area.height > 0,
        locator: { ...n.locator, app_surface: surface },
      };
      if (n.rasterContentRect) item.rasterContentRect = mapRect(n.rasterContentRect);
      if (n.image?.contentRect)
        item.image = { ...n.image, contentRect: mapRect(n.image.contentRect) };
      if (n.frame?.contentRect)
        item.frame = { ...n.frame, contentRect: mapRect(n.frame.contentRect) };
      nodes.push(item);
    }
    const body = doc.createElement('div');
    for (const attr of parsed.body.attributes) body.setAttribute(attr.name, attr.value);
    body.append(...parsed.body.childNodes);
    const prefix = surface + '-',
      scoped = new Map(
        [body, ...body.querySelectorAll('[id]')]
          .filter((el) => el.id)
          .map((el) => [el.id, prefix + el.id]),
      );
    for (const el of [body, ...body.querySelectorAll('*')]) {
      if (ids.has(el.dataset.uicId)) el.dataset.uicId = ids.get(el.dataset.uicId);
      for (const attr of [...el.attributes]) {
        let value = attr.value;
        if (attr.name === 'id') value = scoped.get(value) || value;
        else if (
          [
            'for',
            'aria-labelledby',
            'aria-describedby',
            'aria-controls',
            'aria-activedescendant',
          ].includes(attr.name)
        )
          value = value
            .split(/\s+/)
            .map((id) => scoped.get(id) || id)
            .join(' ');
        else if (['href', 'xlink:href'].includes(attr.name) && value.startsWith('#'))
          value = '#' + (scoped.get(value.slice(1)) || value.slice(1));
        else if (attr.name === 'style')
          value = value.replace(/url\(["']?#([^)'" ]+)["']?\)/g, (all, id) =>
            scoped.has(id) ? 'url("#' + scoped.get(id) + '")' : all,
          );
        if (value !== attr.value) el.setAttribute(attr.name, value);
      }
    }
    for (const original of snapshot.nodes.filter((n) => n.topLayer && !n.locator.frames?.length)) {
      const id = ids.get(original.id),
        old = body.querySelector('[data-uic-id="' + id + '"]');
      if (!old) continue;
      const layer = doc.createElement('div');
      for (const attr of old.attributes)
        if (!['open', 'popover'].includes(attr.name)) layer.setAttribute(attr.name, attr.value);
      layer.style.cssText = original.topLayer.style;
      layer.append(...old.childNodes);
      old.remove();
      const r = original.rect,
        rank = 2147481000 + snapshot.nodes.indexOf(original) * 2;
      for (const [key, value] of Object.entries({
        position: 'absolute',
        left: r.x + 'px',
        top: r.y + 'px',
        right: 'auto',
        bottom: 'auto',
        margin: '0px',
        width: r.width + 'px',
        height: r.height + 'px',
        transform: 'none',
        translate: 'none',
        'z-index': String(rank + 1),
      }))
        layer.style.setProperty(key, value, 'important');
      const backdrop = doc.createElement('div'),
        backdropId = 'n' + (nodes.length + 1);
      backdrop.dataset.uicId = backdropId;
      backdrop.style.cssText = original.topLayer.backdrop;
      for (const [key, value] of Object.entries({
        position: 'absolute',
        left: offset.x + 'px',
        top: offset.y + 'px',
        width: snapshot.source.viewport.width + 'px',
        height: snapshot.source.viewport.height + 'px',
        margin: '0px',
        'z-index': String(rank),
      }))
        backdrop.style.setProperty(key, value, 'important');
      nodes.push({
        id: backdropId,
        parentId: ids.get(snapshot.nodes[0].id),
        tag: 'div',
        kind: 'element',
        name: '모달 배경',
        rect: bounds,
        captureClip: bounds,
        visible: true,
        locator: {
          ...original.locator,
          selector: original.locator.selector + '::backdrop',
          app_surface: surface,
        },
      });
      nodes.find((n) => n.id === id).parentId = ids.get(snapshot.nodes[0].id);
      body.append(backdrop, layer);
    }
    for (const originalStyle of parsed.querySelectorAll('head style')) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(originalStyle.textContent);
      for (const rule of sheet.cssRules)
        if (/^@font-/.test(rule.cssText)) style.textContent += rule.cssText;
    }
    const clip = doc.createElement('div'),
      content = doc.createElement('div');
    clip.style.cssText = `position:absolute;left:${bounds.x}px;top:${bounds.y}px;width:${bounds.width}px;height:${bounds.height}px;overflow:hidden;transform:translateZ(0)`;
    content.style.cssText = `position:relative;width:${snapshot.source.viewport.width}px;height:${snapshot.source.viewport.height}px;transform:translate(${-offset.x}px,${-offset.y}px)`;
    content.append(body);
    clip.append(content);
    doc.body.append(clip);
    warnings.push(
      ...snapshot.warnings.map((w) => ({ ...w, ...(ids.has(w.id) ? { id: ids.get(w.id) } : {}) })),
    );
    if (!snapshot.screenshot)
      throw Error('앱 화면 사진을 준비하지 못했습니다. 다시 시도해 주세요.');
    // Decode bytes without loading a data URL into the source shell's resource
    // registry. Repeated self capture must not accumulate giant page resources.
    const bytes = Uint8Array.from(atob(snapshot.screenshot.split(',')[1]), (c) => c.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    context.drawImage(
      image,
      0,
      0,
      bounds.width,
      bounds.height,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
    );
    image.close();
  }
  const names = {
    editor: '편집기',
    source: '웹사이트',
    settings: '앱 설정',
    agent: '에이전트 연결',
    update: '업데이트',
  };
  return {
    format: 'console-canvas-snapshot',
    version: 1,
    id: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    source: {
      url: 'console-canvas://app/' + view,
      title: `Console Canvas · ${names[view]} 디자인 · v${version}`,
      viewport: { width, height },
      scroll: { x: 0, y: 0 },
      width,
      height,
      background: '#f5f6fb',
      application: { name: 'Console Canvas', version, view },
    },
    html: '<!doctype html>' + doc.documentElement.outerHTML,
    nodes,
    warnings,
    screenshot: canvas.toDataURL('image/png'),
    captureReport: {
      screenshotMode: 'viewport-only',
      application: { version, view, surfaces: parts.map((p) => p.surface) },
    },
  };
}
module.exports = { composeAppCapture };
