import { CanvasScene } from '../engine.js';
const results = [];
function check(name, passed) {
  results.push({ name, passed: !!passed });
  document.querySelector('#results').textContent = JSON.stringify(results);
  if (!passed) throw Error(name);
}
try {
  if (!globalThis.iframeNativeSnapshot)
    await new Promise((r) => addEventListener('snapshotready', r, { once: true }));
  const snapshot = globalThis.iframeNativeSnapshot,
    before = JSON.stringify(snapshot);
  check(
    'Scrollbar fixture actually reserves layout width',
    snapshot.captureReport.scrollbarGutter === 6,
  );
  check(
    'Reserved scrollbar uses actual viewport tiles',
    snapshot.captureReport.screenshotMode === 'viewport-scroll' &&
      snapshot.screenshotTiles.length > 1,
  );
  check('Capture preserves source markup and scroll state', globalThis.iframeSourceUnchanged);
  check(
    'Static source does not receive a spurious dynamic-layout warning',
    !snapshot.captureReport.sourceChangedDuringCapture &&
      !snapshot.warnings.some((w) => w.type === 'dynamic'),
  );
  const scene = await new CanvasScene(document.querySelector('#copy'), snapshot).mount();
  const scroll = snapshot.nodes.find((n) => n.locator.id === 'scroller'),
    target = snapshot.nodes.find((n) => n.locator.id === 'nested-action');
  check(
    'Nested scroll survives fixed-container reconstruction',
    scene.elements.get(scroll.id).scrollTop === 130,
  );
  const original = scene.rect(target.id);
  scene.setEdits({ [target.id]: { dx: 7, dy: 0 } });
  const moved = scene.rect(target.id);
  check(
    'A child edit does not jump to an unscrolled baseline',
    Math.abs(moved.x - original.x - 7) < 1 && Math.abs(moved.y - original.y) < 1,
  );
  scene.resourceBaseHtml = scene.resourceBaseHtml.replace(
    '</head>',
    '<style>:root{--repair-test:url(https://assets.test/probe.png)}</style></head>',
  );
  scene.setResourceRepairs([
    {
      type: 'resource',
      resource_url: 'https://assets.test/probe.png',
      data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
    },
  ]);
  const rebuilt = scene.rect(target.id);
  check(
    'Resource reconstruction retains scroll and the existing child move once',
    scene.elements.get(scroll.id).scrollTop === 130 &&
      Math.abs(rebuilt.x - original.x - 7) < 1 &&
      Math.abs(rebuilt.y - original.y) < 1,
  );
  scene.setEdits({});
  const restored = scene.rect(target.id);
  check(
    'Removing the edit returns the child to the captured scrolled position',
    Math.abs(restored.x - original.x) < 1 && Math.abs(restored.y - original.y) < 1,
  );
  check(
    'Runtime reconstruction and editing preserve immutable capture metadata',
    JSON.stringify(snapshot) === before,
  );
  document.querySelector('#status').textContent = results.length + '/' + results.length + ' passed';
  document.body.dataset.result = 'pass';
} catch (e) {
  document.querySelector('#status').textContent = e.stack;
  document.body.dataset.result = 'fail';
}
