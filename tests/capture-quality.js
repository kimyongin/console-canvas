import { CanvasScene, copy, validateSnapshot } from '../engine.js';
import { saveCapture, saveSession, getDocument } from '../db.js';
const results = [];
function check(name, value) {
  results.push({ name, passed: !!value });
  document.querySelector('#results').textContent = results
    .map((r) => (r.passed ? 'PASS ' : 'FAIL ') + r.name)
    .join('\n');
  if (!value) throw Error(name);
}
const near = (a, b) => Math.abs(a - b) < 1;
try {
  if (!globalThis.iframeNativeSnapshot)
    await new Promise((r) => addEventListener('snapshotready', r, { once: true }));
  const snapshot = validateSnapshot(globalThis.iframeNativeSnapshot),
    legacy = copy(globalThis.iframeSnapshot);
  const node = (id) =>
    snapshot.nodes.find(
      (n) => n.locator.id === id && n.kind !== 'text' && !n.locator.frames?.length,
    );
  check(
    'Capture keeps original fixture DOM and business actions unchanged',
    globalThis.iframeSourceUnchanged,
  );
  const frames = snapshot.nodes.filter((n) => n.tag === 'iframe');
  check(
    'Scroll-driven layout collapse is aligned using original element anchors ' +
      JSON.stringify({
        mode: snapshot.captureReport.screenshotMode,
        warnings: snapshot.warnings.filter((w) => w.type === 'screenshot'),
        shifts: (snapshot.screenshotTiles || [])
          .filter((t) => t.layoutShift)
          .map((t) => t.layoutShift),
      }),
    snapshot.captureReport.screenshotMode === 'viewport-scroll' &&
      snapshot.screenshotTiles.some((t) => t.sourceRect && Math.abs(t.layoutShift.dy - 180) < 2),
  );
  check(
    'Every same-origin, cross-origin and opaque frame is attempted in its own context',
    snapshot.captureReport.frameCount >= 5 &&
      snapshot.captureReport.domFrames === snapshot.captureReport.frameCount - 1 &&
      frames.filter((n) => n.locator.id !== 'changing-frame').every((n) => n.frame.mode === 'dom'),
  );
  check(
    'A frame changing during collection alone falls back to captured pixels',
    node('changing-frame').frame.mode === 'image' &&
      node('changing-frame').frame.failure.code === 'frame_changed_during_capture',
  );
  check('Font faces inside CSS layers are retained', snapshot.html.includes('CaptureNested'));
  check(
    'A decodable PNG missing its end chunk is rejected as a complete resource',
    globalThis.truncatedPngRejected,
  );
  check(
    'Named OpenType feature definitions inside CSS layers survive font collection',
    snapshot.html.includes('@font-feature-values CaptureNested') &&
      snapshot.html.includes('capture-shapes: 1 2'),
  );
  check(
    'Independent frame font feature names survive merging into the editable copy',
    snapshot.html.includes('frame-shapes: 3'),
  );
  check(
    'Repeated frame URLs are mapped to separate original owners',
    node('duplicate-one').id !== node('duplicate-two').id &&
      snapshot.nodes.filter((n) => n.locator.id === 'add' && n.tag === 'button').length === 3,
  );
  check(
    'Imported IDs are globally unique',
    new Set(snapshot.nodes.map((n) => n.id)).size === snapshot.nodes.length,
  );
  check(
    'Cross-frame original selector and frame provenance stay intact',
    snapshot.nodes
      .filter((n) => n.locator.id === 'add')
      .every((n) => n.locator.selector.includes('add') && n.locator.frames.length === 1),
  );
  check(
    'Entire long frame and page are captured beyond initial viewport',
    snapshot.screenshotTiles.some(
      (t) => t.rect.y + t.rect.height > snapshot.source.viewport.height,
    ) && snapshot.captureReport.preparedView.restored,
  );
  check(
    'Clipped iframe descendants do not enlarge the document canvas',
    snapshot.source.width === snapshot.source.viewport.width &&
      snapshot.source.height <= snapshot.captureReport.contentSize.height + 1,
  );
  check(
    'Actual resource bytes are embedded for cross-origin images',
    node('remote-image').image.mode === 'embedded' &&
      !snapshot.html.includes('src="http://localhost:'),
  );
  check(
    'Privileged collector includes closed Shadow DOM nodes with source IDs',
    snapshot.captureReport.closedShadowRoots >= 1 &&
      node('closed-control')?.locator.shadows?.[0]?.mode === 'closed',
  );
  const scene = await new CanvasScene(document.querySelector('#clone'), snapshot, {
    smartSelection: true,
  }).mount();
  check(
    'Frame backgrounds and body content preserve positions',
    frames.every((n) => near(scene.rect(n.id).x, n.rect.x) && near(scene.rect(n.id).y, n.rect.y)),
  );
  const hero = scene.elements.get(node('hero').id);
  check(
    'CSS background is embedded while text and button remain editable',
    scene.doc.defaultView.getComputedStyle(hero).backgroundImage.includes('data:image/') &&
      hero.querySelector('button[data-uic-id]'),
  );
  check(
    'Repeated CSS image bytes are stored in inherited variables',
    hero.style.backgroundImage.includes('var(--uic-asset-'),
  );
  scene.setEdits({ [node('hero').id]: { dx: 12, dy: 7 } });
  check(
    'Moving a sprite-backed element retains its embedded background',
    scene.doc.defaultView.getComputedStyle(hero).backgroundImage.includes('data:image/'),
  );
  scene.setEdits({});
  check(
    'Frame-local SVG IDs and paint references are namespaced',
    scene.doc.querySelectorAll('linearGradient').length === 3 &&
      new Set([...scene.doc.querySelectorAll('linearGradient')].map((e) => e.id)).size === 3 &&
      [...scene.doc.querySelectorAll('svg rect')].every((e) => /url\("?#n/.test(e.style.fill)),
  );
  const externalSvg = node('external-svg');
  const complexSvg = node('complex-svg');
  check(
    'SVG masks and radial paints retain actual source pixels as one icon',
    complexSvg.rasterReason === 'svg_complex_paint' &&
      scene.elements.get(complexSvg.id).dataset.uicRasterCoverage === 'full',
  );
  check(
    'SVG external images preserve original SVG identity as one raster layer',
    externalSvg.kind === 'raster' &&
      externalSvg.tag === 'svg' &&
      externalSvg.rasterReason === 'svg_external_reference',
  );
  check(
    'SVG image references render from embedded source pixels',
    scene.elements.get(externalSvg.id).dataset.uicRasterCoverage === 'full' &&
      scene.elements.get(externalSvg.id).querySelector('img')?.src.startsWith('data:image/png'),
  );
  const bottom = node('bottom');
  const damaged = copy(snapshot);
  const parser = new DOMParser().parseFromString(damaged.html, 'text/html');
  const damagedImage = parser.querySelector('[data-uic-id="' + bottom.id + '"]');
  const repairCanvas = document.createElement('canvas');
  repairCanvas.width = 200;
  repairCanvas.height = 200;
  repairCanvas.getContext('2d').fillRect(0, 0, 200, 200);
  damagedImage.src =
    'data:image/png;base64,' + btoa(atob(repairCanvas.toDataURL().split(',')[1]).slice(0, -12));
  damaged.html = '<!doctype html>' + parser.documentElement.outerHTML;
  damaged.nodes.find((n) => n.id === bottom.id).image.mode = 'embedded';
  const repairFrame = document.createElement('iframe');
  repairFrame.setAttribute('sandbox', 'allow-same-origin');
  document.body.append(repairFrame);
  const repaired = await new CanvasScene(repairFrame, damaged).mount();
  check(
    'Older partial PNG captures recover their visible pixels without changing immutable content',
    repaired.elements.get(bottom.id).dataset.uicImageRendering === 'source-pixels' &&
      repaired.elements.get(bottom.id).dataset.uicImageCoverage === 'full' &&
      damaged.html.includes(damagedImage.src) &&
      damaged.nodes.find((n) => n.id === bottom.id).image.mode === 'embedded',
  );
  repairFrame.remove();
  check(
    'Static WebP keeps its complete embedded image without flattening overlays',
    node('static-webp').image.mode === 'embedded' &&
      scene.elements.get(node('static-webp').id).src.startsWith('data:image/webp;'),
  );
  const aspectThumb = node('aspect-thumb');
  check(
    'Padding-only pseudo preserves the image aspect box',
    near(scene.rect(aspectThumb.id).height, aspectThumb.rect.height) &&
      scene.rect(aspectThumb.id).height > 100,
  );
  const clamped = node('clamped');
  const clampedPadding = node('clamped-padding');
  check(
    'Padded clamped links keep their used box height',
    near(scene.rect(clampedPadding.id).height, clampedPadding.rect.height),
  );
  check(
    'Line-clamped card text keeps its original height and line count ' +
      JSON.stringify({
        clamp: scene.doc.defaultView.getComputedStyle(scene.elements.get(clamped.id))
          .webkitLineClamp,
        source: clamped.rect.height,
        clone: scene.rect(clamped.id).height,
      }),
    scene.doc.defaultView.getComputedStyle(scene.elements.get(clamped.id)).webkitLineClamp ===
      '2' && near(scene.rect(clamped.id).height, clamped.rect.height),
  );
  const backgroundSvg = node('svg-background');
  check(
    'SVG CSS backgrounds are preserved as actual embedded pixels',
    backgroundSvg.kind === 'raster' &&
      scene.elements.get(backgroundSvg.id).dataset.uicRasterCoverage === 'full' &&
      scene.elements.get(backgroundSvg.id).querySelector('img')?.src.startsWith('data:image/png'),
  );
  check(
    'All images render while original source requests are blocked',
    [...scene.doc.images].every((i) => i.src.startsWith('data:image/')),
  );
  check(
    'Offscreen source images do not depend on original URL',
    scene.elements.get(bottom.id).src.startsWith('data:image/'),
  );
  const long = node('long'),
    button = snapshot.nodes.find(
      (n) => n.tag === 'button' && n.locator.frames?.[0]?.selector.includes('long'),
    );
  check(
    'Long iframe bottom controls are individual editable nodes',
    button && scene.elements.has(button.id),
  );
  const before = scene.rect(button.id);
  scene.setEdits({ [long.id]: { dx: 22, dy: 13 } });
  check(
    'Parent frame move preserves descendant offsets',
    near(scene.rect(button.id).x - before.x, 22) && near(scene.rect(button.id).y - before.y, 13),
  );
  scene.setComment(button.id, '하단 버튼을 오른쪽에 정렬');
  scene.remove(long.id);
  check(
    'Frame deletion retains child comments and hides descendants',
    scene.hidden(button.id) && scene.annotations[button.id].includes('오른쪽'),
  );
  const payload = {
    ...copy(snapshot),
    edits: copy(scene.edits),
    annotations: copy(scene.annotations),
  };
  await saveCapture(payload);
  await saveSession(payload.id, payload);
  const restored = await getDocument(payload.id);
  check(
    'Storage round-trip preserves tiles, embedded images and comments',
    restored.screenshotTiles.length === snapshot.screenshotTiles.length &&
      restored.annotations[button.id] === scene.annotations[button.id],
  );
  const reopened = await new CanvasScene(document.querySelector('#clone'), restored).mount();
  check(
    'Saved frame content reopens from embedded assets',
    reopened.elements.get(bottom.id).src.startsWith('data:image/') && reopened.nodes.has(button.id),
  );
  legacy.screenshotTiles = copy(snapshot.screenshotTiles);
  const fallback = await new CanvasScene(document.querySelector('#clone'), legacy).mount();
  const backgroundIcon = legacy.nodes.find((n) => n.locator.id === 'background-icon');
  check(
    'Unreadable decorative CSS image is preserved from original pixels',
    backgroundIcon.background?.mode === 'screenshot' &&
      fallback.elements.get(backgroundIcon.id).dataset.uicBackgroundCoverage === 'full' &&
      fallback.doc.defaultView
        .getComputedStyle(fallback.elements.get(backgroundIcon.id))
        .backgroundImage.includes('data:image/png'),
  );
  const legacyLong = legacy.nodes.find((n) => n.locator.id === 'long' && n.kind === 'raster');
  const image = fallback.elements
    .get(legacyLong.id)
    .querySelector('[data-uic-raster-coverage="full"] img');
  check(
    'A failed long-frame DOM capture uses its full pixel image',
    image?.src.startsWith('data:image/png'),
  );
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  canvas
    .getContext('2d')
    .drawImage(
      image,
      Math.floor(image.naturalWidth / 2),
      image.naturalHeight - 50,
      1,
      1,
      0,
      0,
      1,
      1,
    );
  const pixel = canvas.getContext('2d').getImageData(0, 0, 1, 1).data;
  check(
    'Long-frame fallback contains actual lower content, not gray filler',
    pixel[3] === 255 && pixel[2] > 220 && pixel[0] < 235,
  );
  const remote = legacy.nodes.find((n) => n.locator.id === 'remote-image' && n.tag === 'img');
  check(
    'Unreadable image bytes use captured PNG pixels',
    remote.image.mode === 'screenshot' &&
      fallback.elements.get(remote.id).src.startsWith('data:image/png') &&
      fallback.elements.get(remote.id).dataset.uicImageCoverage === 'full',
  );
  let rejected = false;
  try {
    validateSnapshot({
      ...copy(snapshot),
      screenshotTiles: [
        { rect: { x: 0, y: 0, width: NaN, height: 1 }, data: 'data:image/png;base64,a' },
      ],
    });
  } catch {
    rejected = true;
  }
  check('Invalid embedded screenshot rectangles are rejected', rejected);
  let invalidClip = false;
  try {
    validateSnapshot({
      ...copy(snapshot),
      screenshotTiles: [
        {
          rect: { x: 0, y: 0, width: 1, height: 1 },
          clip: { x: 0, y: NaN, width: 1, height: 1 },
          data: 'data:image/png;base64,a',
        },
      ],
    });
  } catch {
    invalidClip = true;
  }
  check('Nonfinite screenshot clipping metadata is rejected', invalidClip);
  document.querySelector('#status').textContent = `${results.length}/${results.length} passed`;
  document.body.dataset.result = 'pass';
} catch (error) {
  document.querySelector('#status').textContent = error.stack;
  document.body.dataset.result = 'fail';
}
