import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexNodes } from '../../node-index.js';
test('hierarchy index counts descendants for unordered nodes without changing child order', () => {
  const nodes = [
    { id: 'n3', parentId: 'n2' },
    { id: 'n1', parentId: null },
    { id: 'n4', parentId: 'n1' },
    { id: 'n2', parentId: 'n1' },
  ];
  const index = indexNodes(nodes);
  assert.deepEqual(
    index.children.get('n1').map((node) => node.id),
    ['n4', 'n2'],
  );
  assert.deepEqual(Object.fromEntries(index.descendantCounts), { n3: 0, n2: 1, n4: 0, n1: 3 });
});
