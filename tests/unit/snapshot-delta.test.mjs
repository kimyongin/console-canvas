import test from 'node:test';
import assert from 'node:assert/strict';
import { editingDifferenceIds, snapshotChangeCount } from '../../ui/snapshot-delta.js';
test('Visible differences ignore zero offsets and edit property ordering', () => {
  assert.deepEqual(
    editingDifferenceIds({}, { edits: { n1: { deleted: false, dy: 0, dx: 0 } } }),
    [],
  );
  assert.deepEqual(
    editingDifferenceIds(
      { edits: { n1: { dx: 4, dy: 5, deleted: false } } },
      { edits: { n1: { deleted: false, dy: 5, dx: 4 } } },
    ),
    [],
  );
});
test('Snapshot delta counts one changed target once, with notes separately', () => {
  const state = {
    timeline: {
      activeId: 'a',
      entries: [{ id: 'a', state: { edits: {}, annotations: {}, note: '' } }],
    },
    scene: {
      edits: { n1: { dx: 5 } },
      annotations: { n1: 'request', 'point:10:20': 'point' },
      selected: 'n2',
    },
  };
  assert.equal(snapshotChangeCount(state, ''), 2);
  assert.equal(snapshotChangeCount(state, 'extra'), 3);
});
