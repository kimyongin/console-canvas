import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotTree } from '../../snapshot-tree.js';
import { recordActivity, activityBranch } from '../../activity-history.js';
import { cleanComments, prepareEdits } from '../../edit-commands.js';
test('branch tree retains deleted ancestors only when connecting live descendants', () => {
  const entries = [
    { id: 'A', parentId: null, deletedAt: 'now' },
    { id: 'B', parentId: 'A', deletedAt: 'now' },
    { id: 'C', parentId: 'B' },
    { id: 'D', parentId: 'A' },
  ];
  assert.deepEqual(
    snapshotTree(entries).map((e) => [e.id, e.depth]),
    [
      ['A', 0],
      ['B', 1],
      ['C', 2],
      ['D', 1],
    ],
  );
  assert.deepEqual(snapshotTree(entries.map((e) => ({ ...e, deletedAt: 'now' }))), []);
  assert.equal(
    snapshotTree([
      { id: 'X', parentId: 'Y' },
      { id: 'Y', parentId: 'X' },
    ]).length,
    2,
  );
});
test('restoring an event head keeps parallel history without showing it in the current branch', () => {
  const state = { scene: { nodes: new Map() }, activity: [], activityHead: null };
  const point = { edits: {}, annotations: {}, note: '' };
  const a = recordActivity(state, point, point, { label: 'A' });
  const b = recordActivity(state, point, { ...point, annotations: { n1: 'B' } }, { label: 'B' });
  state.activityHead = a.id;
  recordActivity(state, point, { ...point, annotations: { n1: 'D' } }, { label: 'D' });
  assert.deepEqual(
    activityBranch(state).map((e) => e.label),
    ['D', 'A'],
  );
  assert.equal(activityBranch(state, true).length, 3);
  assert.ok(state.activity.some((e) => e.id === b.id));
});
test('coordinate annotations roundtrip without admitting unknown element edits or invalid coordinates', () => {
  const current = { edits: {}, annotations: {} };
  const elements = new Map([['n1', {}]]);
  const next = prepareEdits(
    current,
    [{ type: 'point_comment', x: 100.5, y: 200, text: '간격 정리' }],
    elements,
  );
  assert.deepEqual(cleanComments(next.annotations, elements), { 'point:100.5:200': '간격 정리' });
  assert.throws(() =>
    prepareEdits(current, [{ type: 'point_comment', x: Infinity, y: 200, text: 'bad' }], elements),
  );
  assert.throws(() =>
    prepareEdits(
      current,
      [{ type: 'move', element_id: 'point:100:200', dx: 1, dy: 0, mode: 'relative' }],
      elements,
    ),
  );
  const deleted = prepareEdits(
    next,
    [{ type: 'comment', element_id: 'point:100.5:200', text: '' }],
    elements,
  );
  assert.deepEqual(deleted.annotations, {});
});
