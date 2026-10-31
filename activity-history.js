import { elementLabel } from './ui/element-labels.js';
import { pointTarget } from './edit-commands.js';
import { resourceDifferenceIds } from './resource-document.js';
// Recent edit events support undo and MCP inspection.
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
export function activityBranch(state) {
  return [...(state.activity || [])].reverse();
}
export function activityChanges(state, before, after, detail = {}) {
  const named = (id) => {
    const copies = [
      ...Object.values(before?.edits || {}),
      ...Object.values(after.edits || {}),
    ].flatMap((e) => e.copy?.nodes || []);
    const descriptor = copies.find((n) => n.id === id);
    const original = state.snapshot?.nodes?.find((n) => n.id === (descriptor?.sourceId || id));
    const node =
      state.scene.nodes.get(id) ||
      (descriptor && original
        ? { ...original, id, copiedFrom: original.id, copyRoot: id }
        : original);
    return node
      ? elementLabel(node, state.snapshot?.layerNames)
      : pointTarget(id)
        ? '위치 주석'
        : '이전 요소 · 현재 화면에 없음';
  };
  const changes = resourceDifferenceIds(before?.resourceRepairs, after.resourceRepairs).map(
    (id) => ({
      id: id.startsWith('@') ? undefined : id,
      type: 'code',
      name:
        id === '@resource' ? '이미지·폰트 복구' : state.scene.nodes.get(id)?.name || '공통 스타일',
      before: '자산 복구 전',
      after: '자산 복구 후',
    }),
  );
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
        !a.copy && b.copy
          ? 'copy'
          : !!a.deleted !== !!b.deleted
            ? 'delete'
            : detail.category || 'move',
      name: named(id),
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
        name: named(id),
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
  return changes;
}
export function recordActivity(state, before, after, detail = {}) {
  const changes = activityChanges(state, before, after, detail);
  const event = {
    id: crypto.randomUUID(),
    parent_id: state.activityHead || null,
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
