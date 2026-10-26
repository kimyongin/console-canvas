import { copy, validateSnapshot } from './engine.js';
import { snapshotPoint } from './snapshot-history.js';
export function cleanHandoffSettings(value) {
  return { mode: value?.mode === 'exact' ? 'exact' : 'reference' };
}
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
    screenshot: null,
  });
}
const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
export function cleanImplementationReviews(value = [], snapshot) {
  if (!Array.isArray(value) || value.length > 20 || JSON.stringify(value).length > 20_000_000)
    throw new Error(
      '구현 검토는 문서당 20개·직렬화 2,000만 자까지 보관할 수 있습니다. 편집 파일로 백업한 뒤 검토를 나누어 주세요.',
    );
  const seen = new Set();
  return value.map((review) => {
    if (
      !review ||
      typeof review.id !== 'string' ||
      !/^[\w-]{1,100}$/.test(review.id) ||
      seen.has(review.id) ||
      !Number.isFinite(Date.parse(review.createdAt)) ||
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
