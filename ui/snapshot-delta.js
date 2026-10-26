import { codeDifferenceIds } from '../code-patches.js';
// Compare visible editing state; selection and activity bookkeeping are not edits.
const editValue = (value = {}) => [
  value.dx || 0,
  value.dy || 0,
  !!value.deleted,
  value.copy || null,
];
export function editingDifferenceIds(left = {}, right = {}) {
  const ids = new Set([
    ...Object.keys(left.edits || {}),
    ...Object.keys(right.edits || {}),
    ...Object.keys(left.annotations || {}),
    ...Object.keys(right.annotations || {}),
  ]);
  const codeIds = codeDifferenceIds(left.codePatches, right.codePatches);
  for (const id of codeIds) ids.add(id);
  return [...ids].filter(
    (id) =>
      codeIds.includes(id) ||
      JSON.stringify(editValue(left.edits?.[id])) !==
        JSON.stringify(editValue(right.edits?.[id])) ||
      (left.annotations?.[id] || '') !== (right.annotations?.[id] || ''),
  );
}
export function snapshotChangeCount(state, note = '') {
  const base = state.timeline?.entries.find((e) => e.id === state.timeline.activeId)?.state || {};
  return editingDifferenceIds(base, state.scene || {}).length + Number((base.note || '') !== note);
}
export const snapshotChangeLabel = (state, note) =>
  '스냅샷 이후 변경 ' + snapshotChangeCount(state, note) + '건';
