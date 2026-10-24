import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareEdits, cleanEdits } from '../../edit-commands.js';
import { CanvasScene } from '../../engine.js';
const elements = new Map([
  ['n1', {}],
  ['n2', {}],
]);
test('command preparation is atomic even if a later move overflows', () => {
  const initial = { edits: { n1: { dx: 59999, dy: 0 } }, annotations: { n2: 'keep' } };
  assert.throws(
    () =>
      prepareEdits(
        initial,
        [
          { type: 'delete', element_id: 'n2' },
          { type: 'move', element_id: 'n1', dx: 2, dy: 0, mode: 'relative' },
        ],
        elements,
      ),
    { code: 'invalid_move' },
  );
  assert.deepEqual(initial, { edits: { n1: { dx: 59999, dy: 0 } }, annotations: { n2: 'keep' } });
});
test('manual moves use the same validation and survive persistence without coordinate changes', () => {
  const scene = Object.assign(Object.create(CanvasScene.prototype), {
    selected: 'n1',
    elements,
    nodes: elements,
    originalNodes: elements,
    copySignature: '{}',
    selection: new Set(['n1']),
    edits: {},
    annotations: {},
    callbacks: {},
    apply() {},
  });
  scene.setPosition(60000, -200000);
  assert.deepEqual(cleanEdits(scene.edits, elements), scene.edits);
  assert.throws(() => scene.setPosition(70000, 0), { code: 'invalid_move' });
  assert.throws(() => scene.nudge(1, 0), { code: 'invalid_move' });
  assert.equal(scene.edits.n1.dx, 60000);
});
test('batch moves, deletion and comments retain element identity', () => {
  const result = prepareEdits(
    { edits: {}, annotations: {} },
    [
      { type: 'move', element_id: 'n1', dx: 4, dy: 5, mode: 'absolute' },
      { type: 'move', element_id: 'n1', dx: -1, dy: 2, mode: 'relative' },
      { type: 'delete', element_id: 'n2' },
      { type: 'comment', element_id: 'n2', text: '  note  ' },
    ],
    elements,
  );
  assert.deepEqual(result.edits, { n1: { dx: 3, dy: 7 }, n2: { deleted: true } });
  assert.deepEqual(result.annotations, { n2: 'note' });
  assert.throws(
    () =>
      prepareEdits(
        { edits: {}, annotations: {} },
        [{ type: 'comment', element_id: 'n1', text: 'x'.repeat(4001) }],
        elements,
      ),
    { code: 'invalid_comment' },
  );
});
