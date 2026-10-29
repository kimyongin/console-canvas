import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const context = vm.createContext({});
vm.runInContext(await fs.readFile(new URL('../../capture.js', import.meta.url), 'utf8'), context);
function align(points) {
  const elements = new Map(
    points.map((p) => [
      '#' + p.id,
      { textContent: p.id, getBoundingClientRect: () => ({ x: p.x, y: p.after }) },
    ]),
  );
  const doc = {
    defaultView: { innerWidth: 1600, scrollX: 0, scrollY: 0 },
    querySelector: (s) => elements.get(s),
  };
  return context.UICloneCapture.alignAnchors(doc, [
    points.map((p) => ({ selector: '#' + p.id, key: p.id, x: p.x, y: p.before })),
  ])[0];
}
test('a changing right ad column cannot shift stationary main content', () => {
  const points = [
    { id: 'article', x: 240, before: 4604, after: 4604 },
    ...Array.from({ length: 7 }, (_, i) => ({
      id: 'ad' + i,
      x: 1000 + i * 40,
      before: 4477,
      after: 3678,
    })),
  ];
  assert.equal(align(points).dy, 0);
});
test('a global collapsed banner is aligned to its final flow position', () => {
  const points = [240, 500, 1000].map((x, i) => ({ id: 'flow' + i, x, before: 1000, after: 1180 }));
  const result = align(points);
  assert.equal(result.dy, 180);
  assert.equal(result.dx, 0);
});
