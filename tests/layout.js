import { CanvasScene } from '../engine.js';
const results = [];
function check(name, passed) {
  results.push({ name, passed: !!passed });
  document.querySelector('#results').textContent = results
    .map((r) => (r.passed ? 'PASS ' : 'FAIL ') + r.name)
    .join('\n');
  if (!passed) throw Error(name);
}
const rect = (x, y, width, height) => ({ x, y, width, height });
const node = (id, parentId, position, box) => ({
  id,
  parentId,
  position,
  rect: box,
  kind: 'element',
  tag: 'div',
  name: id,
  locator: { id },
  visible: true,
  scroll: { x: 0, y: 0 },
});
const snapshot = {
  format: 'console-canvas-snapshot',
  version: 1,
  id: 'layout-regression',
  warnings: [],
  source: {
    width: 800,
    height: 600,
    viewport: { width: 800, height: 600 },
    scroll: { x: 0, y: 0 },
    url: 'https://example.test/console',
  },
  nodes: [
    node('n1', null, 'static', rect(0, 0, 800, 600)),
    node('n2', 'n1', 'fixed', rect(100, 200, 300, 200)),
    node('n3', 'n2', 'fixed', rect(100, 200, 300, 200)),
    node('n4', 'n2', 'static', rect(150, 240, 200, 120)),
    node('n5', 'n1', 'fixed', rect(0, 0, 300, 600)),
    node('n6', 'n1', 'relative', rect(0, 0, 800, 50)),
    node('n7', 'n1', 'static', rect(320, 60, 134.078125, 20)),
    node('n8', 'n7', 'static', rect(320, 60, 94.21875, 20)),
    node('n9', 'n7', 'static', rect(414.21875, 60, 39.859375, 20)),
    node('n10', 'n1', 'static', rect(500, 60, 100, 20)),
    { ...node('n11', 'n1', 'static', rect(500, 200, 200, 100)), tag: 'p' },
    { ...node('n12', 'n11', 'static', rect(500, 200, 100, 20)), tag: 'span' },
    { ...node('n13', 'n11', 'static', rect(500, 220, 200, 20)), tag: 'p' },
    { ...node('n14', 'n11', 'static', rect(500, 240, 100, 20)), tag: 'span' },
    node('n15', 'n1', 'fixed', rect(420, 350, 20, 20)),
    node('n16', 'n15', 'fixed', rect(460, 300, 200, 80)),
    {
      ...node('n17', 'n15', 'fixed', rect(420, 300, 250, 150)),
      kind: 'pseudo',
      tag: '::before',
      locator: { pseudo: 'before' },
    },
    node('n18', 'n1', 'absolute', rect(500, 450, 300, 100)),
    node('n19', 'n18', 'fixed', rect(500, 450, 300, 100)),
    node('n20', 'n18', 'relative', rect(500, 450, 300, 100)),
    {
      ...node('n21', 'n1', 'static', rect(700.25, 100, 4, 4)),
      kind: 'pseudo',
      tag: '::before',
      locator: { pseudo: 'before' },
    },
  ],
  html: `<!doctype html><html><body data-uic-id="n1" style="margin:0;width:800px;height:600px;background:white">
    <div data-uic-id="n2" style="position:fixed;left:100px;top:200px;width:300px;height:200px;display:flex;align-items:center;justify-content:center;z-index:900">
      <div data-uic-id="n3" style="position:fixed;left:100px;top:200px;width:300px;height:200px;background:#ddd"></div>
      <div data-uic-id="n4" style="width:200px;height:120px;background:white;z-index:2">Dialog content</div>
    </div>
    <div data-uic-id="n5" style="position:fixed;left:0;top:0;width:300px;height:600px;background:#5599ff;z-index:100">Sidebar</div>
    <div data-uic-id="n6" style="position:relative;z-index:1000;width:800px;height:50px;background:#ffe800">Toolbar</div>
    <div data-uic-id="n7" style="margin-left:320px;display:flex;flex-wrap:wrap;width:134.078px">
      <div data-uic-id="n8" style="flex-shrink:0;width:94.2188px;min-width:94.2188px;height:20px">Workspace</div><div data-uic-id="n9" style="flex-shrink:0;width:39.8594px;min-width:39.8594px;height:20px">Home</div>
    </div><div style="zoom:1.2"><div data-uic-id="n10" style="width:83.3333px;height:20px"></div></div>
    <p data-uic-id="n11" style="margin:0;padding:0;width:200px;line-height:20px"><span data-uic-id="n12">Before</span><p data-uic-id="n13" style="margin:0">Nested</p><span data-uic-id="n14">After</span></p>
    <div data-uic-id="n15" style="position:fixed;left:420px;top:350px;width:20px;height:20px;overflow:auto">
      <span data-uic-id="n17" style="position:fixed;left:420px;top:300px;width:250px;height:150px;background:blue;opacity:.3"></span>
      <div data-uic-id="n16" style="position:fixed;left:460px;top:300px;width:200px;height:80px;background:white">Escaping scroll box</div>
    </div>
    <div data-uic-id="n18" style="position:absolute;left:500px;top:450px;width:300px;height:100px;z-index:1;isolation:isolate">
      <div data-uic-id="n19" style="position:fixed;left:500px;top:450px;width:300px;height:100px;background:blue;z-index:10"></div>
      <div data-uic-id="n20" style="position:relative;width:300px;height:100px;background:red;z-index:20">Page above its fixed background</div>
    </div>
    <span data-uic-id="n21" style="position:absolute;left:700.5px;top:100px;width:4px;height:4px;background:green"></span>
  </body></html>`,
};
try {
  const before = JSON.stringify(snapshot);
  const scene = await new CanvasScene(document.querySelector('iframe'), snapshot).mount();
  check(
    'Refreshed pseudo geometry belongs to the working copy, preserving captured geometry',
    scene.nodes.get('n21').rect.x === 700.5 && snapshot.nodes.at(-1).rect.x === 700.25,
  );
  const hit = (id, x, y) => scene.elements.get(id).contains(scene.doc.elementFromPoint(x, y));
  check(
    'Modal panel remains above its fixed backdrop and later lower sidebar',
    hit('n4', 200, 280),
  );
  check('Ordinary positioned toolbar remains above lower fixed layers', hit('n6', 20, 20));
  check(
    'Serialized subpixel width does not wrap a previously fitting row',
    Math.abs(scene.rect('n8').y - scene.rect('n9').y) < 0.1,
  );
  check(
    'Zoomed layout widths are not quantized to an unrelated CSS unit',
    scene.elements.get('n10').style.width === '83.3333px',
  );
  check('Fixed dialog children escape a small overflow scroll box', hit('n16', 480, 320));
  check(
    'Paragraph parser repair restores captured hierarchy',
    scene.elements.get('n11').contains(scene.elements.get('n13')) &&
      scene.elements.get('n11').contains(scene.elements.get('n14')),
  );
  check(
    'A fixed background stays below higher content in its original stacking context',
    hit('n20', 600, 490),
  );
  const fixedBackground = scene.rect('n19');
  scene.setEdits({ n18: { dx: 13, dy: 7 } });
  check(
    'Moving a stacking scope does not double its fixed-child offset',
    Math.abs(scene.rect('n19').x - fixedBackground.x - 13) < 0.1 &&
      Math.abs(scene.rect('n19').y - fixedBackground.y - 7) < 0.1,
  );
  scene.setEdits({});
  const panel = scene.rect('n4'),
    backdrop = scene.rect('n3');
  scene.setEdits({ n2: { dx: 17, dy: 11 } });
  check(
    'Moving a fixed parent moves its fixed child exactly once',
    Math.abs(scene.rect('n3').x - backdrop.x - 17) < 0.1 &&
      Math.abs(scene.rect('n3').y - backdrop.y - 11) < 0.1,
  );
  check(
    'Static modal content follows the same parent movement',
    Math.abs(scene.rect('n4').x - panel.x - 17) < 0.1 &&
      Math.abs(scene.rect('n4').y - panel.y - 11) < 0.1,
  );
  scene.setEdits({ n2: { dx: 17, dy: 11 }, n3: { dx: 5, dy: 3 } });
  check(
    'Independent fixed-child offsets accumulate once with its parent',
    Math.abs(scene.rect('n3').x - backdrop.x - 22) < 0.1 &&
      Math.abs(scene.rect('n3').y - backdrop.y - 14) < 0.1,
  );
  scene.setEdits({ n2: { deleted: true } });
  check(
    'Deleting a fixed parent hides the detached fixed subtree',
    scene.hidden('n3') && scene.hidden('n4'),
  );
  scene.setEdits({});
  check(
    'Restoring edits returns layer order and original positions',
    hit('n4', 200, 280) && Math.abs(scene.rect('n3').x - backdrop.x) < 0.1,
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
  check(
    'Resource rebuilding keeps fixed layer hierarchy',
    hit('n4', 200, 280) &&
      hit('n6', 20, 20) &&
      hit('n16', 480, 320) &&
      scene.elements.get('n11').contains(scene.elements.get('n14')),
  );
  check(
    'Rendering corrections preserve the immutable source capture',
    JSON.stringify(snapshot) === before,
  );
  document.querySelector('#status').textContent = `${results.length}/${results.length} passed`;
  document.body.dataset.result = 'pass';
} catch (error) {
  document.querySelector('#status').textContent = error.stack;
  document.body.dataset.result = 'fail';
}
