import { copy, validateSnapshot } from './engine.js';
import { snapshotPoint, snapshotSignature } from './snapshot-history.js';
import { cleanHandoffSettings } from './handoff-settings.js';
export { cleanHandoffSettings } from './handoff-settings.js';
export function sourcePath(source) {
  try {
    const url = new URL(source.url);
    return url.origin + url.pathname;
  } catch {
    return String(source?.url || '경로 없음').slice(0, 500);
  }
}
export function reviewCapture(snapshot) {
  return copy({
    format: snapshot.format,
    version: snapshot.version,
    id: snapshot.id,
    capturedAt: snapshot.capturedAt,
    source: snapshot.source,
    html: snapshot.html,
    nodes: snapshot.nodes,
    warnings: snapshot.warnings || [],
    ...(snapshot.captureScope ? { captureScope: snapshot.captureScope } : {}),
    screenshot: null,
  });
}
// Names and navigation are metadata; identity includes the frozen capture and edits.
export function sameReviewResult(left, right) {
  return (
    !!left &&
    !!right &&
    JSON.stringify(reviewCapture(left.snapshot)) ===
      JSON.stringify(reviewCapture(right.snapshot)) &&
    snapshotSignature(left.point) === snapshotSignature(right.point)
  );
}
const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
export const REVIEW_LIMITS = Object.freeze({ live: 20, total: 40, characters: 20_000_000 });
export function implementationReviewUsage(value = []) {
  const live = value.filter((r) => !r.deletedAt).length,
    characters = JSON.stringify(value).length;
  return {
    live,
    trash: value.length - live,
    total: value.length,
    characters,
    canCreate:
      live < REVIEW_LIMITS.live &&
      value.length < REVIEW_LIMITS.total &&
      characters < REVIEW_LIMITS.characters,
  };
}
export function cleanImplementationReviews(value = [], snapshot) {
  if (
    !Array.isArray(value) ||
    value.length > REVIEW_LIMITS.total ||
    value.filter((r) => r && !r.deletedAt).length > REVIEW_LIMITS.live ||
    JSON.stringify(value).length > REVIEW_LIMITS.characters
  )
    throw new Error(
      '검토 보관 한도입니다: 사용 중20개·휴지통 포함40개·2,000만 자. 검토 기록 관리에서 휴지통으로 옮기거나 파일 백업 후 필요한 기록을 정리하세요.',
    );
  const seen = new Set();
  return value.map((review) => {
    if (
      !review ||
      typeof review.id !== 'string' ||
      !/^[\w-]{1,100}$/.test(review.id) ||
      seen.has(review.id) ||
      !Number.isFinite(Date.parse(review.createdAt)) ||
      (review.name != null &&
        (typeof review.name !== 'string' ||
          !review.name.trim() ||
          review.name.trim().length > 120)) ||
      (review.deletedAt != null &&
        (typeof review.deletedAt !== 'string' || !Number.isFinite(Date.parse(review.deletedAt)))) ||
      !review.target ||
      !Array.isArray(review.requests) ||
      review.requests.length > 1000
    )
      throw new Error('구현 검토 형식이 올바르지 않습니다.');
    seen.add(review.id);
    const point = snapshotPoint(
      review.target.point,
      new Map(snapshot.nodes.map((n) => [n.id, n])),
      snapshot.html,
    );
    const ids = new Set();
    const requests = review.requests.map((r, i) => {
      if (
        !r ||
        typeof r.id !== 'string' ||
        ids.has(r.id) ||
        !['pending', 'done', 'change'].includes(r.status) ||
        (r.rect && !['x', 'y', 'width', 'height'].every((k) => Number.isFinite(r.rect[k])))
      )
        throw new Error('구현 요청 검토 정보가 올바르지 않습니다.');
      ids.add(r.id);
      return {
        id: r.id,
        number: i + 1,
        name: text(r.name, 240),
        text: text(r.text, 4000),
        sourceId: text(r.sourceId, 300),
        selector: text(r.selector, 1000),
        ...(r.rect ? { rect: copy(r.rect) } : {}),
        status: r.status,
        note: text(r.note, 4000),
      };
    });
    let result = null;
    if (review.result) {
      const capture = reviewCapture(review.result.snapshot);
      validateSnapshot(capture);
      result = {
        snapshot: capture,
        point: snapshotPoint(
          review.result.point,
          new Map(capture.nodes.map((n) => [n.id, n])),
          capture.html,
        ),
        name: text(review.result.name, 120),
      };
    }
    return {
      id: review.id,
      createdAt: review.createdAt,
      ...(review.name != null ? { name: review.name.trim() } : {}),
      ...(review.deletedAt != null ? { deletedAt: review.deletedAt } : {}),
      target: {
        label: text(review.target.label, 120),
        mode: cleanHandoffSettings(review.target).mode,
        point,
      },
      requests,
      result,
    };
  });
}
