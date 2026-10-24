// Work on topmost selected elements so selected descendants never receive a move twice.
export function selectionRoots(scene) {
  const ids = [
    ...(scene.selection?.size ? scene.selection : scene.selected ? [scene.selected] : []),
  ].filter((id) => scene.elements.has(id) && !scene.hidden(id));
  const selected = new Set(ids);
  return ids.filter((id) => !scene.ancestors(id).some((parent) => selected.has(parent)));
}
export function alignmentOperations(scene, kind) {
  const ids = selectionRoots(scene),
    boxes = ids.map((id) => ({ id, ...scene.rect(id) })).filter((r) => Number.isFinite(r.x));
  if (boxes.length < 2) throw new Error('두 개 이상의 요소를 선택해 주세요.');
  const axis = kind.endsWith('y') || kind === 'top' ? 'y' : 'x',
    size = axis === 'x' ? 'width' : 'height';
  const min = Math.min(...boxes.map((r) => r[axis])),
    max = Math.max(...boxes.map((r) => r[axis] + r[size]));
  let targets;
  if (kind.startsWith('distribute')) {
    if (boxes.length < 3) throw new Error('간격을 맞추려면 세 개 이상 선택해 주세요.');
    boxes.sort((a, b) => a[axis] - b[axis]);
    const gap = (max - min - boxes.reduce((sum, r) => sum + r[size], 0)) / (boxes.length - 1);
    let next = min;
    targets = boxes.map((r) => {
      const target = next;
      next += r[size] + gap;
      return target;
    });
  } else targets = boxes.map((r) => (kind.startsWith('center') ? (min + max - r[size]) / 2 : min));
  return boxes.map((r, i) => ({
    type: 'move',
    element_id: r.id,
    mode: 'relative',
    dx: axis === 'x' ? Math.round(targets[i] - r.x) : 0,
    dy: axis === 'y' ? Math.round(targets[i] - r.y) : 0,
  }));
}
export function snapDelta(moving, candidates, dx, dy, threshold) {
  const result = { dx, dy, guides: [] };
  for (const [axis, delta, size] of [
    ['x', 'dx', 'width'],
    ['y', 'dy', 'height'],
  ]) {
    let best = threshold + 1,
      match;
    const starts = [
      moving[axis] + result[delta],
      moving[axis] + moving[size] / 2 + result[delta],
      moving[axis] + moving[size] + result[delta],
    ];
    for (const rect of candidates)
      for (const target of [rect[axis], rect[axis] + rect[size] / 2, rect[axis] + rect[size]])
        for (const start of starts) {
          const distance = target - start;
          if (Math.abs(distance) < best) {
            best = Math.abs(distance);
            match = { distance, target };
          }
        }
    if (match && best <= threshold) {
      result[delta] += match.distance;
      result.guides.push({ axis, position: match.target });
    }
  }
  return result;
}
