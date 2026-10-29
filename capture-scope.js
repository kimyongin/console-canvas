export const intersects = (a, b) =>
  a.x + a.width > b.x && a.y + a.height > b.y && a.x < b.x + b.width && a.y < b.y + b.height;
export function prepareCaptureScope(snapshot) {
  const scope = snapshot.captureScope;
  if (!scope) return snapshot;
  if (!['document', 'viewport', 'region'].includes(scope.mode))
    throw Error('알 수 없는 가져오기 범위입니다.');
  if (scope.mode === 'document') return snapshot;
  const r = scope.rect;
  if (
    !r ||
    !['x', 'y', 'width', 'height'].every((k) => Number.isFinite(r[k])) ||
    r.x < 0 ||
    r.y < 0 ||
    r.width < 1 ||
    r.height < 1 ||
    r.x + r.width > snapshot.source.width + 1 ||
    r.y + r.height > snapshot.source.height + 1
  )
    throw Error('가져오기 범위 정보가 올바르지 않습니다.');
  const map = new Map(snapshot.nodes.map((n) => [n.id, n])),
    keep = new Set();
  for (const node of snapshot.nodes)
    if (node.visible && intersects(node.rect, r)) {
      for (
        let current = node;
        current && !keep.has(current.id);
        current = map.get(current.parentId)
      )
        keep.add(current.id);
    }
  return {
    ...snapshot,
    captureScope: { ...scope, prepared: true },
    nodes: snapshot.nodes.map((n) => ({ ...n, scopeHidden: !keep.has(n.id) })),
  };
}
export function viewRect(snapshot) {
  return snapshot.captureScope && snapshot.captureScope.mode !== 'document'
    ? { ...snapshot.captureScope.rect }
    : { x: 0, y: 0, width: snapshot.source.width, height: snapshot.source.height };
}
export function renderScope(html, width, height) {
  const match = html.match(/<meta name="console-canvas-view" content="([\d.,-]+)">/);
  if (!match) return { x: 0, y: 0, width, height };
  const [x, y, w, h] = match[1].split(',').map(Number);
  if (
    ![x, y, w, h].every(Number.isFinite) ||
    x < 0 ||
    y < 0 ||
    w < 1 ||
    h < 1 ||
    x + w > width + 1 ||
    y + h > height + 1
  )
    throw Error('이미지 범위가 올바르지 않습니다.');
  return { x, y, width: w, height: h };
}
