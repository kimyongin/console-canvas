import { applyResourcePatch, validateResourcePatch } from './resource-repair.js';
// Only restore observed inert image/font bytes. No generated HTML or CSS candidates.
export function validateResourceRepairs(value = []) {
  if (!Array.isArray(value) || value.length > 500 || JSON.stringify(value).length > 2_000_000)
    throw Error('복구 자산은 500개·2MB 이하여야 합니다.');
  for (const op of value) {
    if (!op || op.type !== 'resource') throw Error('이미지·폰트 복구만 지원합니다.');
    validateResourcePatch(op);
  }
  return structuredClone(value);
}
export function buildResourceDocument(baseHtml, baseNodes, repairs = []) {
  repairs = validateResourceRepairs(repairs);
  const doc = new DOMParser().parseFromString(baseHtml, 'text/html');
  const nodes = new Map([...baseNodes].map(([id, n]) => [id, structuredClone(n)]));
  const elements = new Map(
    [...doc.querySelectorAll('[data-uic-id]')].map((el) => [el.dataset.uicId, el]),
  );
  for (const op of repairs) applyResourcePatch(doc, nodes, elements, op);
  return { doc, nodes, repairs, elements };
}
export function resourceDifferenceIds(left = [], right = []) {
  return JSON.stringify(left) === JSON.stringify(right) ? [] : ['@resource'];
}
