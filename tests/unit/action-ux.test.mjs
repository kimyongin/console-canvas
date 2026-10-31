import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { activityChanges } from '../../activity-history.js';
import { captureAssessment } from '../../capture-status.js';
test('read-only legacy summary never creates timestamped activity', () => {
  const state = { scene: { nodes: new Map([['n1', { name: '버튼' }]]) }, activity: [] };
  const values = activityChanges(
    state,
    {},
    { edits: { n1: { dx: 12 } }, annotations: {}, resourceRepairs: [], note: '' },
  );
  assert.equal(values[0].id, 'n1');
  assert.equal(values[0].type, 'move');
  assert.deepEqual(state.activity, []);
});
test('current repaired evidence remains separate from immutable original warning', () => {
  const snapshot = {
    nodes: [
      { id: 'n1', name: '이미지', image: { broken: true, url: 'https://assets.test/a.png' } },
    ],
    warnings: [],
  };
  const before = JSON.stringify(snapshot),
    result = captureAssessment(snapshot, new Map(), [
      { type: 'resource', resource_url: 'https://assets.test/a.png' },
    ]);
  assert.equal(result.counts.loss, 1);
  assert.equal(result.remaining_counts.loss, 0);
  assert.equal(result.repaired_count, 1);
  assert.equal(result.items[0].resolution, 'resource_applied');
  assert.equal(JSON.stringify(snapshot), before);
});
test('repair cannot resolve an unrelated original capture limit', () => {
  const result = captureAssessment(
    { nodes: [], warnings: [{ type: 'capture_limit', message: '사진 없음' }] },
    new Map(),
    [{ type: 'resource', resource_url: 'https://assets.test/a.png' }],
  );
  assert.equal(result.remaining_counts.loss, 1);
  assert.equal(result.repaired_count, 0);
});
