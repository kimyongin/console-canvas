import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityGroups } from '../../ui/activity-groups.js';
const move = (id, parent_id, snapshot_id = 'a', actor = 'user', target = 'n1') => ({
  id,
  parent_id,
  snapshot_id,
  actor,
  created_at: '2026-10-25T00:00:00Z',
  label: '요소 이동',
  changes: [{ id: target, type: 'move', before: { dx: 0 }, after: { dx: 1 } }],
});
test('display grouping retains all raw events and boundaries', () => {
  const events = [move('3', '2'), move('2', '1'), move('1', null)],
    before = structuredClone(events);
  assert.deepEqual(
    activityGroups(events).map((g) => g.length),
    [3],
  );
  assert.deepEqual(events, before);
  for (const changed of [
    move('1', null, 'b'),
    move('1', null, 'a', 'agent'),
    move('1', null, 'a', 'user', 'n2'),
    { ...move('1', null), label: '실행 취소' },
    { ...move('1', null), created_at: '2026-10-24T23:58:00Z' },
  ])
    assert.deepEqual(
      activityGroups([events[1], changed]).map((g) => g.length),
      [1, 1],
    );
  assert.deepEqual(
    activityGroups([move('3', 'other'), move('2', null)]).map((g) => g.length),
    [1, 1],
  );
});
