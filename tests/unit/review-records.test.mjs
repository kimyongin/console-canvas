import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanImplementationReviews, implementationReviewUsage } from '../../workflow-state.js';
const snapshot = { nodes: [], html: '<html><body></body></html>' };
const record = (i) => ({
  id: 'review-' + i,
  createdAt: '2026-10-30T01:00:00Z',
  target: {
    label: '현재 작업',
    point: { edits: {}, annotations: {}, note: '' },
    mode: 'reference',
  },
  requests: [],
  result: null,
});
test('legacy twenty-record documents remain intact and named trash retains data', () => {
  const legacy = Array.from({ length: 20 }, (_, i) => record(i)),
    before = JSON.stringify(legacy);
  const cleaned = cleanImplementationReviews(legacy, snapshot);
  assert.equal(cleaned.length, 20);
  assert.equal(JSON.stringify(legacy), before);
  assert.ok(!('name' in cleaned[0]) && !('deletedAt' in cleaned[0]));
  const named = { ...cleaned[0], name: '첫 번째 검수', deletedAt: '2026-10-30T02:00:00Z' };
  assert.deepEqual(cleanImplementationReviews([named], snapshot)[0], named);
});
test('review retention is bounded across active, trash and payload, without evicting anything', () => {
  const all = Array.from({ length: 40 }, (_, i) => ({
      ...record(i),
      ...(i >= 20 ? { deletedAt: '2026-10-30T02:00:00Z' } : {}),
    })),
    before = JSON.stringify(all);
  assert.equal(cleanImplementationReviews(all, snapshot).length, 40);
  assert.deepEqual(
    { ...implementationReviewUsage(all), characters: 0 },
    { live: 20, trash: 20, total: 40, characters: 0, canCreate: false },
  );
  assert.throws(() => cleanImplementationReviews([...all, record(41)], snapshot));
  const recovered = structuredClone(all);
  delete recovered[20].deletedAt;
  assert.throws(() => cleanImplementationReviews(recovered, snapshot));
  const huge = record('large');
  huge.target.point.note = 'x'.repeat(20_000_000);
  assert.throws(() => cleanImplementationReviews([huge], snapshot));
  assert.equal(JSON.stringify(all), before);
});
test('invalid management metadata rejects the entire imported review set', () => {
  for (const metadata of [
    { name: '' },
    { name: 7 },
    { name: 'x'.repeat(121) },
    { deletedAt: 'bad' },
    { deletedAt: 8 },
  ]) {
    const values = [record(1), { ...record(2), ...metadata }];
    assert.throws(() => cleanImplementationReviews(values, snapshot));
    assert.equal(values[0].id, 'review-1');
  }
});
