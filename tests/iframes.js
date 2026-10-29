import { CanvasScene, validateSnapshot, copy } from '../engine.js';
import { saveCapture, saveSession, getDocument } from '../db.js';
import { elementLabel } from '../ui/element-labels.js';
const results = [];
function check(name, value) {
  results.push({ name, passed: !!value });
  document.querySelector('#results').textContent = results
    .map((r) => `${r.passed ? 'PASS' : 'FAIL'} ${r.name}`)
    .join('\n');
  if (!value) throw new Error(name);
}
const near = (a, b) => Math.abs(a - b) < 1;
try {
  if (!globalThis.iframeSnapshot)
    await new Promise((r) => addEventListener('snapshotready', r, { once: true }));
  const snapshot = validateSnapshot(globalThis.iframeSnapshot),
    nodes = snapshot.nodes;
  const find = (id) => nodes.find((n) => n.locator.id === id && n.kind !== 'text');
  const same = find('same'),
    child = find('child-button'),
    nested = find('nested-button'),
    opaque = find('opaque'),
    partial = find('partial'),
    offscreen = find('offscreen');
  check(
    'Native capture preserves source DOM, scroll and business event count',
    globalThis.iframeSourceUnchanged,
  );
  check(
    'Readable frames contain individually editable elements',
    same.frame.mode === 'dom' && child && nested && nested.locator.frames.length === 2,
  );
  check(
    'Original selector and frame provenance are preserved',
    child.locator.id === 'child-button' && child.locator.frames[0].selector.includes('same'),
  );
  check(
    'Opaque frames stay image layers',
    opaque.kind === 'raster' &&
      opaque.frame.mode === 'image' &&
      !nodes.some((n) => n.locator.frames?.some((f) => f.selector.includes('opaque'))),
  );
  check('No executable frames or scripts are copied', !/<iframe|<script/i.test(snapshot.html));
  check('All capture node IDs stay unique', new Set(nodes.map((n) => n.id)).size === nodes.length);
  const scene = await new CanvasScene(document.querySelector('#clone'), snapshot, {}).mount();
  check(
    'Readable frame button matches captured position after internal scrolling',
    near(scene.rect(child.id).x, child.rect.x) && near(scene.rect(child.id).y, child.rect.y),
  );
  check(
    'Nested frame button matches captured position',
    near(scene.rect(nested.id).x, nested.rect.x) && near(scene.rect(nested.id).y, nested.rect.y),
  );
  const fixed = nodes.find((n) => n.position === 'fixed');
  check(
    'Fixed frame child matches captured position and stays clipped',
    near(scene.rect(fixed.id).x, fixed.rect.x) &&
      !!scene.lifts.get(fixed.id).wrapper.style.clipPath,
  );
  check(
    'Full image fallback uses real native screenshot',
    scene.elements
      .get(opaque.id)
      .querySelector('[data-uic-raster-coverage="full"] img')
      ?.src.startsWith('data:image/png'),
  );
  const crop = scene.elements
    .get(partial.id)
    .querySelector('[data-uic-raster-coverage="partial"] img');
  await crop?.decode();
  const partialCanvas = document.createElement('canvas');
  partialCanvas.width = 1;
  partialCanvas.height = 1;
  if (crop)
    partialCanvas
      .getContext('2d')
      .drawImage(crop, crop.naturalWidth - 1, Math.floor(crop.naturalHeight / 2), 1, 1, 0, 0, 1, 1);
  check(
    'Partially visible iframe keeps uncaptured pixels transparent instead of stretching',
    crop && partialCanvas.getContext('2d').getImageData(0, 0, 1, 1).data[3] === 0,
  );

  check(
    'Fully offscreen frame does not fabricate an image',
    !scene.elements.get(offscreen.id).querySelector('img') &&
      scene.elements.get(offscreen.id).textContent.includes('화면 밖'),
  );
  const image = scene.elements.get(opaque.id).querySelector('img'),
    canvas = document.createElement('canvas');
  await image.decode();
  canvas.width = 1;
  canvas.height = 1;
  canvas.getContext('2d').drawImage(image, 100, 100, 1, 1, 0, 0, 1, 1);
  const pixel = canvas.getContext('2d').getImageData(0, 0, 1, 1).data;
  check(
    'Opaque frame screenshot contains its rendered green content: ' + [...pixel].join(','),
    Math.abs(pixel[0] - 20) < 4 && Math.abs(pixel[1] - 180) < 4 && Math.abs(pixel[2] - 90) < 4,
  );
  check(
    'Layer labels distinguish DOM and image frames',
    elementLabel(same).endsWith('· 요소') && elementLabel(opaque).endsWith('· 이미지'),
  );
  const before = scene.rect(child.id);
  scene.setEdits({ [same.id]: { dx: 25, dy: 15 } });
  check(
    'Moving a DOM frame moves its descendants',
    near(scene.rect(child.id).x - before.x, 25) && near(scene.rect(child.id).y - before.y, 15),
  );
  scene.remove(same.id);
  check(
    'Deleting a DOM frame also hides its children',
    scene.hidden(child.id) && scene.hidden(nested.id),
  );
  scene.setEdits({ [opaque.id]: { dx: 12, dy: 8 } });
  scene.setComment(opaque.id, '이 영역을 고객 요약으로 교체');
  check(
    'Image frame supports movement and comments',
    near(scene.rect(opaque.id).x - opaque.rect.x, 12) &&
      scene.annotations[opaque.id]?.includes('고객 요약'),
  );
  const saved = {
    ...copy(snapshot),
    edits: copy(scene.edits),
    annotations: copy(scene.annotations),
  };
  await saveCapture(saved);
  await saveSession(saved.id, saved);
  const restored = await getDocument(snapshot.id);
  check(
    'Persistent document retains frame structure and original screenshot',
    restored.screenshot === snapshot.screenshot &&
      restored.nodes.find((n) => n.id === nested.id).locator.frames.length === 2,
  );
  const second = await new CanvasScene(
    document.querySelector('#clone'),
    JSON.parse(JSON.stringify(restored)),
    {},
  ).mount();
  second.setEdits(saved.edits);
  second.setComments(saved.annotations);
  check(
    'Reload reconstructs image fallback and edits',
    second.elements.get(opaque.id).querySelector('img') &&
      near(second.rect(opaque.id).x - opaque.rect.x, 12),
  );
  scene.destroy?.();
  second.destroy?.();
  document.querySelector('#status').textContent = `${results.length}/${results.length} passed`;
  document.body.dataset.result = 'pass';
} catch (error) {
  document.querySelector('#status').textContent = error.stack;
  document.body.dataset.result = 'fail';
}
