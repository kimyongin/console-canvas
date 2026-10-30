import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { activityChanges } from '../../activity-history.js';
import { captureAssessment } from '../../capture-status.js';
import { reviewCapture } from '../../workflow-state.js';
const { createReviewCapture } = createRequire(import.meta.url)('../../desktop/review-capture.cjs');
test('read-only legacy summary never creates timestamped activity', () => {
  const state = { scene: { nodes: new Map([['n1', { name: '버튼' }]]) }, activity: [] };
  const values = activityChanges(
    state,
    {},
    { edits: { n1: { dx: 12 } }, annotations: {}, codePatches: [], note: '' },
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
test('native review destination is bounded, copied and cannot be cleared by stale cancellation', () => {
  const session = createReviewCapture(),
    a = { request_id: 'a', review_id: 'r', document_id: 'd', label: 'A' };
  assert.throws(() => session.begin({ ...a, label: 'x'.repeat(161) }));
  session.begin(a);
  a.label = 'changed';
  assert.equal(session.current().label, 'A');
  session.begin({ ...a, request_id: 'b' });
  assert.equal(session.clear('a'), false);
  assert.equal(session.current().request_id, 'b');
  assert.equal(session.clear('b'), true);
  assert.equal(session.current(), null);
});
test('implementation result retains capture scope without retaining oversized source photos', () => {
  const snapshot = {
    id: 'r',
    format: 'console-canvas-snapshot',
    version: 1,
    source: {},
    html: '',
    nodes: [],
    captureScope: { mode: 'region', rect: { x: 20, y: 30, width: 100, height: 80 } },
    screenshot: { data: 'photo' },
  };
  const value = reviewCapture(snapshot);
  assert.deepEqual(value.captureScope, snapshot.captureScope);
  assert.equal(value.screenshot, null);
  value.captureScope.rect.x = 1;
  assert.equal(snapshot.captureScope.rect.x, 20);
});
