import { CanvasScene } from '../engine.js';
try {
  const snapshot = await (await fetch('/capture-case.json')).json();
  const frame = document.querySelector('iframe');
  frame.style.width = snapshot.source.width + 'px';
  frame.style.height = snapshot.source.height + 'px';
  const scene = await new CanvasScene(frame, snapshot, { smartSelection: true }).mount();
  await Promise.race([
    Promise.all([...scene.doc.images].map((i) => i.decode().catch(() => {}))),
    new Promise((r) => setTimeout(r, 10000)),
  ]);
  await Promise.race([scene.doc.fonts.ready, new Promise((r) => setTimeout(r, 10000))]);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  window.captureScene = scene;
  const testedHeight = Math.min(snapshot.source.height, 12000);
  const missingMedia = [...scene.nodes.values()]
    .filter((n) => {
      if (!n.visible || n.image?.broken) return false;
      const r = n.rect,
        c = n.captureClip || {
          x: 0,
          y: 0,
          width: snapshot.source.viewport.width,
          height: testedHeight,
        };
      if (
        Math.min(r.x + r.width, c.x + c.width, snapshot.source.viewport.width) <=
          Math.max(r.x, c.x, 0) ||
        Math.min(r.y + r.height, c.y + c.height, testedHeight) <= Math.max(r.y, c.y, 0) ||
        r.width * r.height < 64
      )
        return false;
      const e = scene.elements.get(n.id);
      if (!e) return false;
      return (
        ((n.image?.mode === 'screenshot' || e.dataset.uicImageRendering === 'source-pixels') &&
          e.dataset.uicImageCoverage !== 'full') ||
        (n.background?.mode === 'screenshot' && e.dataset.uicBackgroundCoverage !== 'full') ||
        (n.kind === 'raster' &&
          e.dataset.uicRasterCoverage &&
          e.dataset.uicRasterCoverage !== 'full') ||
        (e.tagName === 'IMG' && !e.naturalWidth)
      );
    })
    .map((n) => ({ id: n.id, tag: n.tag, rect: n.rect }));
  document.querySelector('#results').textContent = JSON.stringify({
    nodes: scene.nodes.size,
    missingMedia,
    images: [...scene.doc.images].map((i) => ({
      loaded: !!i.naturalWidth,
      embedded: i.src.startsWith('data:'),
      source: i.src.slice(0, 120),
    })),
    geometry: [...scene.nodes.values()]
      .filter((n) => n.visible)
      .map((n) => ({
        id: n.id,
        tag: n.tag,
        name: n.name,
        kind: n.kind,
        expected: n.rect,
        actual: scene.rect(n.id),
      })),
  });
  document.body.dataset.result = 'ready';
} catch (error) {
  document.querySelector('#results').textContent = error.stack;
  document.body.dataset.result = 'error';
}
