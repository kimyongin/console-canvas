import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandCopyNodes } from '../../copy-model.js';
import { cleanEdits } from '../../edit-commands.js';
const bounds = { x: 12, y: 20, width: 40, height: 20 };
const originals = new Map([
  ['n1', { id: 'n1', parentId: null, rect: bounds }],
  ['n2', { id: 'n2', parentId: 'n1', rect: bounds }],
  ['n3', { id: 'n3', parentId: 'n2', rect: bounds }],
]);
const fixture = () => ({
  n50: {
    dx: 0,
    dy: 0,
    copy: {
      nodes: [
        { id: 'n50', sourceId: 'n2', parentId: null, rect: bounds },
        { id: 'n51', sourceId: 'n3', parentId: 'n50', rect: bounds },
      ],
    },
  },
});
test('copy descriptors expand independent trees without changing immutable capture nodes', () => {
  const edits = cleanEdits(fixture(), originals),
    { nodes } = expandCopyNodes(edits, originals);
  assert.equal(originals.size, 3);
  assert.equal(nodes.get('n50').parentId, null);
  assert.equal(nodes.get('n51').parentId, 'n50');
  assert.equal(nodes.get('n51').copiedFrom, 'n3');
  assert.ok(edits.n50.copy);
});
test('untrusted copy descriptors reject foreign sources, reused IDs, broken trees and nonfinite geometry', () => {
  for (const mutate of [
    (e) => (e.n50.copy.nodes[0].sourceId = 'n999'),
    (e) => (e.n50.copy.nodes[1].id = 'n1'),
    (e) => (e.n50.copy.nodes[1].parentId = 'n1'),
    (e) => (e.n50.copy.nodes[1].sourceId = 'n1'),
    (e) => (e.n50.copy.nodes[1].rect = { ...bounds, x: NaN }),
  ]) {
    const edits = fixture();
    mutate(edits);
    assert.throws(() => cleanEdits(edits, originals));
  }
});
