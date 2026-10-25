// Each event points to its predecessor. Restoring a snapshot changes the head,
// preserving events in other branches without copying the log into snapshots.
export function cleanActivity(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .filter(
      (e) =>
        e &&
        typeof e.id === 'string' &&
        !seen.has(e.id) &&
        (seen.add(e.id), true) &&
        Array.isArray(e.changes),
    )
    .map((e) => structuredClone(e));
}
export function activityBranch(state, all = false) {
  if (all) return [...(state.activity || [])].reverse();
  const map = new Map((state.activity || []).map((e) => [e.id, e])),
    result = [],
    seen = new Set();
  let id = state.activityHead;
  while (map.has(id) && !seen.has(id)) {
    seen.add(id);
    const event = map.get(id);
    result.push(event);
    id = event.parent_id;
  }
  return result;
}
export function recordActivity(state, before, after, detail = {}) {
  const changes = [];
  for (const id of new Set([
    ...Object.keys(before?.edits || {}),
    ...Object.keys(after.edits || {}),
  ])) {
    const a = before?.edits?.[id] || {},
      b = after.edits[id] || {};
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    changes.push({
      id,
      type:
        !a.copy && b.copy ? 'copy' : a.deleted !== b.deleted ? 'delete' : detail.category || 'move',
      name: state.scene.nodes.get(id)?.name || id,
      before: a,
      after: b,
    });
  }
  for (const id of new Set([
    ...Object.keys(before?.annotations || {}),
    ...Object.keys(after.annotations || {}),
  ])) {
    const a = before?.annotations?.[id] || '',
      b = after.annotations[id] || '';
    if (a !== b)
      changes.push({
        id,
        type: 'comment',
        name: state.scene.nodes.get(id)?.name || '위치 주석',
        before: a,
        after: b,
      });
  }
  if (before?.note !== after.note)
    changes.push({
      type: 'comment',
      name: '추가 설명',
      before: before?.note || '',
      after: after.note,
    });
  const event = {
    id: crypto.randomUUID(),
    parent_id: state.activityHead || null,
    snapshot_id: state.timeline?.activeId || null,
    created_at: new Date().toISOString(),
    actor: detail.actor || 'user',
    label: detail.label || (changes.some((c) => c.type === 'comment') ? '주석 편집' : '요소 편집'),
    changes,
  };
  state.activity ||= [];
  state.activity.push(event);
  state.activityHead = event.id;
  return event;
}
