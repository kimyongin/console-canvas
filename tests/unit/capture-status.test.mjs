import test from 'node:test';
import assert from 'node:assert/strict';
import { captureAssessment } from '../../capture-status.js';
test('Collection evidence never claims visual similarity and preserves source data', () => {
  const source = {
    nodes: [{ id: 'n1', name: 'Frame', frame: { mode: 'image', failure: { message: 'Denied' } } }],
    warnings: [{ type: 'capture_limit', message: 'Long page' }],
  };
  const before = JSON.stringify(source);
  const result = captureAssessment(
    source,
    new Map([['n1', { dataset: { uicRasterCoverage: 'partial' } }]]),
  );
  assert.equal(result.items.length, 3);
  assert.ok(
    result.items.some(
      (x) => x.kind === '프레임·화면 영역 부분 수집' && x.id === 'n1' && x.actionable,
    ),
  );
  assert.equal(JSON.stringify(source), before);
  assert.ok(!/95%|100%|완벽|검증 완료/.test(result.label));
  assert.equal(captureAssessment({ nodes: [], warnings: [] }).label, '가져오기 · 화면 비교 전');
});
test('Missing media and an unresolved saved warning retain actionable source identity', () => {
  const snapshot = {
    nodes: [{ id: 'n2', name: 'Logo' }],
    warnings: [
      { type: 'assets', id: 'n2', message: 'External' },
      { type: 'assets', id: 'n2', message: 'External' },
    ],
  };
  const r = captureAssessment(
    snapshot,
    new Map([
      ['n2', { dataset: { uicImageCoverage: 'unavailable', uicBackgroundCoverage: 'partial' } }],
    ]),
  );
  assert.equal(r.items.length, 3);
  assert.ok(r.items.every((x) => x.id === 'n2' && x.name === 'Logo'));
  assert.ok(r.items.some((x) => x.kind === '이미지 누락'));
});

test('Legacy warning records cannot break the evidence UI or claim completion', () => {
  const r = captureAssessment({
    nodes: [],
    warnings: [null, { message: {} }, { type: '__proto__', message: 'Unknown' }],
  });
  assert.equal(r.items.length, 2);
  assert.ok(
    r.items.every((item) => typeof item.kind === 'string' && typeof item.message === 'string'),
  );
});
