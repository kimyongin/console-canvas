import policy from './edit-policy.json' with { type: 'json' };
import { expandCopyNodes } from './copy-model.js';
export const EDIT_LIMITS = Object.freeze(policy);
function invalid(code, message) {
  throw Object.assign(new Error(message), { code });
}
export function boundedPosition(dx, dy) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy))
    invalid('invalid_move', '유한한 이동량을 지정해 주세요.');
  return {
    dx: Math.max(-EDIT_LIMITS.x, Math.min(EDIT_LIMITS.x, dx)),
    dy: Math.max(-EDIT_LIMITS.y, Math.min(EDIT_LIMITS.y, dy)),
  };
}
export function cleanEdits(value, nodes) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  const expanded = expandCopyNodes(value, new Map([...nodes].filter(([, n]) => !n.copiedFrom)));
  nodes = expanded.nodes;
  for (const [id, edit] of Object.entries(value))
    if (nodes.has(id) && edit && typeof edit === 'object') {
      result[id] = {
        ...boundedPosition(
          Number.isFinite(edit.dx) ? edit.dx : 0,
          Number.isFinite(edit.dy) ? edit.dy : 0,
        ),
        deleted: edit.deleted === true,
        ...(expanded.copies[id] ? { copy: expanded.copies[id] } : {}),
      };
    }
  return result;
}
export function cleanComments(value, nodes) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [id, text] of Object.entries(value))
    if (nodes.has(id) && typeof text === 'string' && text.trim())
      result[id] = text.trim().slice(0, EDIT_LIMITS.comment);
  return result;
}
// Pure, atomic command preparation, shared by pointer/keyboard/inspector and MCP edits.
export function prepareEdits(current, operations, elements) {
  if (
    !Array.isArray(operations) ||
    !operations.length ||
    operations.length > EDIT_LIMITS.operations
  )
    invalid('invalid_operations', '1~100개의 작업을 지정해 주세요.');
  const edits = structuredClone(current.edits),
    annotations = structuredClone(current.annotations);
  for (const operation of operations) {
    if (!operation || !elements.has(operation.element_id))
      invalid('unknown_element', '존재하지 않는 요소입니다: ' + operation?.element_id);
    const id = operation.element_id;
    if (operation.type === 'move') {
      if (
        !['relative', 'absolute'].includes(operation.mode) ||
        !Number.isFinite(operation.dx) ||
        !Number.isFinite(operation.dy)
      )
        invalid('invalid_move', '이동 모드와 유한한 이동량을 지정해 주세요.');
      const previous = edits[id] || {};
      const dx = operation.dx + (operation.mode === 'relative' ? previous.dx || 0 : 0),
        dy = operation.dy + (operation.mode === 'relative' ? previous.dy || 0 : 0);
      const bounded = boundedPosition(dx, dy);
      if (dx !== bounded.dx || dy !== bounded.dy)
        invalid('invalid_move', '이동량이 허용 범위를 넘습니다.');
      edits[id] = { ...previous, dx, dy };
    } else if (operation.type === 'delete') edits[id] = { ...(edits[id] || {}), deleted: true };
    else if (operation.type === 'comment') {
      if (typeof operation.text !== 'string' || operation.text.length > EDIT_LIMITS.comment)
        invalid('invalid_comment', '주석은 4,000자 이하의 문자열이어야 합니다.');
      const text = operation.text.trim();
      if (text) annotations[id] = text;
      else delete annotations[id];
    } else invalid('invalid_operation', '지원하지 않는 작업입니다.');
  }
  return {
    edits,
    annotations,
    changed:
      JSON.stringify(edits) !== JSON.stringify(current.edits) ||
      JSON.stringify(annotations) !== JSON.stringify(current.annotations),
  };
}
