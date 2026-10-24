import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectionRoots, alignmentOperations, snapDelta } from '../../selection-tools.js';
const rects = {
  a: { x: 10, y: 20, width: 20, height: 10 },
  b: { x: 90, y: 60, width: 30, height: 20 },
  c: { x: 40, y: 90, width: 10, height: 10 },
};
const scene = {
  selection: new Set(['a', 'child', 'b', 'c']),
  elements: new Map(['a', 'child', 'b', 'c'].map((id) => [id, {}])),
  hidden: () => false,
  ancestors: (id) => (id === 'child' ? ['a'] : []),
  rect: (id) => rects[id],
};
test('selected descendants do not receive a second group offset', () =>
  assert.deepEqual(selectionRoots(scene), ['a', 'b', 'c']));
test('alignment and distribution use rendered geometry including existing offsets', () => {
  const top = alignmentOperations(scene, 'top');
  assert.deepEqual(
    top.map((op) => op.dy),
    [0, -40, -70],
  );
  const gap = alignmentOperations(scene, 'distribute-x');
  assert.deepEqual(
    gap.map((op) => [op.element_id, op.dx]),
    [
      ['a', 0],
      ['c', 15],
      ['b', 0],
    ],
  );
});
test('snap guides honor zoom-adjusted tolerance and leave distant moves unchanged', () => {
  const moving = { x: 100, y: 100, width: 50, height: 20 },
    target = { x: 200, y: 100, width: 50, height: 20 };
  assert.equal(snapDelta(moving, [target], 49, 0, 4).dx, 50);
  assert.equal(snapDelta(moving, [target], 40, 0, 4).dx, 40);
});
