import { CanvasScene } from '../engine.js';
const results = [];
function check(name, passed) {
  results.push({ name, passed: !!passed });
  document.querySelector('#results').textContent = JSON.stringify(results);
  if (!passed) throw Error(name);
}
try {
  const frame = document.querySelector('#source');
  if (!frame.contentDocument?.getElementById('new-customer'))
    await new Promise((r) => frame.addEventListener('load', r, { once: true }));
  const doc = frame.contentDocument,
    hidden = doc.createElement('div');
  hidden.id = 'hidden-large';
  hidden.style.display = 'none';
  hidden.innerHTML = '<span>not rendered</span>'.repeat(20000);
  doc.body.append(hidden);
  const invisible = doc.createElement('div');
  invisible.style.visibility = 'hidden';
  invisible.innerHTML =
    '<button id="visible-descendant" style="visibility:visible">Visible child</button>';
  doc.body.append(invisible);
  const paragraph = doc.createElement('p');
  paragraph.innerHTML =
    '<a id="inline-link" style="display:inline-flex">Guide <demo-link-icon id="custom-icon" style="display:block;width:14px;height:14px;margin-left:4px">↗</demo-link-icon></a>';
  doc.body.append(paragraph);
  const before = doc.documentElement.outerHTML;
  const snapshot = await UICloneCapture.capture(doc, { maxElements: 1000, fetchAssets: false });
  check(
    'Unrendered subtrees do not exhaust the existing collection budget',
    snapshot.captureReport.traversedElements < 1000 &&
      snapshot.captureReport.hiddenSubtreesOmitted > 0,
  );
  check(
    'Hidden root identity is retained without its unrendered descendants',
    snapshot.nodes.some((n) => n.locator.id === 'hidden-large') && snapshot.nodes.length < 1000,
  );
  check(
    'Visibility hidden does not drop an explicitly visible descendant',
    snapshot.nodes.some((n) => n.locator.id === 'visible-descendant' && n.visible),
  );
  check('Collection leaves the source DOM unchanged', doc.documentElement.outerHTML === before);
  const copyFrame = document.createElement('iframe');
  document.body.append(copyFrame);
  const scene = await new CanvasScene(copyFrame, snapshot).mount();
  const icon = snapshot.nodes.find((n) => n.locator.id === 'custom-icon');
  const link = snapshot.nodes.find((n) => n.locator.id === 'inline-link');
  check(
    'Custom inline elements retain valid paragraph/link structure after parsing',
    scene.elements.get(icon.id).tagName === 'SPAN' &&
      scene.elements.get(icon.id).parentElement === scene.elements.get(link.id),
  );
  check(
    'Inline glyph stays at its captured position instead of creating another line',
    Math.abs(scene.rect(icon.id).x - icon.rect.x) < 1 &&
      Math.abs(scene.rect(icon.id).y - icon.rect.y) < 1,
  );
  const first = UICloneCapture.layoutFingerprint(doc);
  doc.body.dataset.nonVisualPing = 'changed';
  check(
    'Nonvisual attributes do not trigger a layout-state mismatch',
    UICloneCapture.layoutFingerprint(doc).key === first.key,
  );
  doc.querySelector('#new-customer').style.transform = 'translateX(12px)';
  check(
    'A changing carousel-style transform is detected without source freezing',
    UICloneCapture.layoutFingerprint(doc).key !== first.key,
  );
  document.querySelector('#status').textContent = results.length + '/' + results.length + ' passed';
  document.body.dataset.result = 'pass';
} catch (e) {
  document.querySelector('#status').textContent = e.stack;
  document.body.dataset.result = 'fail';
}
