import { applyResourcePatch } from './resource-repair.js';
// Declarative code changes only. Never evaluate generated JavaScript.
export function validateCodePatches(value = []) {
  if (!Array.isArray(value) || value.length > 500 || JSON.stringify(value).length > 2_000_000)
    throw new Error('코드 패치는 500개·2MB 이하여야 합니다.');
  return structuredClone(value);
}
const forbidden =
  /(?:url\s*\(|image-set\s*\(|src\s*\(|@import|@namespace|\\|\/\*|expression\s*\(|javascript\s*:|behavior\s*:|-moz-binding)/i;
function safeStyle(value) {
  if (typeof value !== 'string' || value.length > 50000 || forbidden.test(value))
    throw new Error('외부 리소스나 실행 코드를 포함한 CSS는 사용할 수 없습니다.');
  return value;
}
const tags = new Set(
  'div span p section article header footer main nav aside button input select option label textarea table thead tbody tfoot tr th td ul ol li h1 h2 h3 h4 h5 h6 strong em b i small a hr br fieldset legend form dl dt dd svg path circle rect line polyline polygon'.split(
    ' ',
  ),
);
const attributes =
  /^(?:class|title|role|aria-[a-z-]+|placeholder|value|type|name|disabled|checked|selected|tabindex|colspan|rowspan|viewBox|d|fill|stroke|stroke-width|x|y|width|height|cx|cy|r|points)$/;
function setAttribute(el, name, value) {
  if (!attributes.test(name) || typeof value !== 'string' || value.length > 20000)
    throw new Error('지원하지 않는 HTML 속성입니다: ' + name);
  if (
    name === 'type' &&
    !/^(button|text|search|number|checkbox|radio|email|date|submit|reset)$/.test(value)
  )
    throw new Error('지원하지 않는 입력 종류입니다.');
  el.setAttribute(name, value);
}
export function buildCodeDocument(baseHtml, baseNodes, patches = []) {
  patches = validateCodePatches(patches);
  const doc = new DOMParser().parseFromString(baseHtml, 'text/html');
  const nodes = new Map([...baseNodes].map(([id, node]) => [id, structuredClone(node)]));
  const elements = new Map(
    [...doc.querySelectorAll('[data-uic-id]')].map((el) => [el.dataset.uicId, el]),
  );
  const get = (id) => {
    const el = elements.get(id);
    if (!el || !el.isConnected) throw new Error('패치 대상이 없습니다: ' + id);
    return el;
  };
  for (const [index, op] of patches.entries()) {
    if (!op || typeof op !== 'object' || Array.isArray(op))
      throw new Error('코드 패치 형식이 올바르지 않습니다.');
    if (op.type === 'resource') {
      applyResourcePatch(doc, nodes, elements, op);
      continue;
    }
    if (op.type === 'stylesheet') {
      const style = doc.createElement('style');
      style.textContent = safeStyle(op.css);
      if (/<\//i.test(style.textContent)) throw new Error('CSS에 HTML을 포함할 수 없습니다.');
      doc.head.append(style);
      continue;
    }
    const el = get(op.element_id);
    if (op.type === 'style') {
      if (
        !op.properties ||
        typeof op.properties !== 'object' ||
        Array.isArray(op.properties) ||
        Object.keys(op.properties).length > 100
      )
        throw new Error('CSS 속성 형식이 올바르지 않습니다.');
      for (const [key, value] of Object.entries(op.properties)) {
        if (
          !/^(?:--[a-zA-Z0-9_-]+|(?:-(?:webkit|moz|ms|o)-)?[a-z][a-z-]*)$/.test(key) ||
          ['-moz-binding', 'behavior'].includes(key)
        )
          throw Object.assign(new Error('CSS 속성 이름이 올바르지 않습니다.'), {
            code: 'invalid_css_property',
          });
        if (value === null) el.style.removeProperty(key);
        else el.style.setProperty(key, safeStyle(value), 'important');
      }
    } else if (op.type === 'text') {
      if (typeof op.text !== 'string' || op.text.length > 20000 || el.children.length)
        throw new Error('텍스트 패치는 하위 요소가 없는 요소에 적용해 주세요.');
      el.textContent = op.text;
    } else if (op.type === 'attributes') {
      if (!op.attributes || typeof op.attributes !== 'object' || Array.isArray(op.attributes))
        throw new Error('HTML 속성 형식이 올바르지 않습니다.');
      for (const [key, value] of Object.entries(op.attributes)) setAttribute(el, key, value);
    } else if (op.type === 'remove') {
      if (el === doc.body || el === doc.documentElement)
        throw new Error('화면 루트는 삭제할 수 없습니다.');
      for (const target of [el, ...el.querySelectorAll('[data-uic-id]')]) {
        const node = nodes.get(target.dataset.uicId);
        if (node)
          node.parentId =
            target.parentElement?.closest('[data-uic-id]')?.dataset.uicId || node.parentId;
      }
      el.remove();
    } else if (op.type === 'reparent') {
      const parent = get(op.parent_id),
        before = op.before_id ? get(op.before_id) : null;
      if (
        el === doc.body ||
        el === doc.documentElement ||
        el.contains(parent) ||
        (before && before.parentElement !== parent)
      )
        throw new Error('부모/삽입 위치가 올바르지 않습니다.');
      parent.insertBefore(el, before);
    } else if (op.type === 'insert') {
      if (typeof op.html !== 'string' || op.html.length > 100000)
        throw new Error('추가할 HTML은 100KB 이하여야 합니다.');
      const template = doc.createElement('template');
      template.innerHTML = op.html;
      let serial = 0;
      for (const added of template.content.querySelectorAll('*')) {
        if (!tags.has(added.localName))
          throw new Error('추가할 수 없는 HTML 요소입니다: ' + added.localName);
        const id = added.getAttribute('data-uic-id') || `a${index}_${serial++}`;
        if (!/^a[a-zA-Z0-9_-]{1,80}$/.test(id) || nodes.has(id))
          throw new Error('새 요소 ID가 중복되거나 올바르지 않습니다: ' + id);
        for (const attr of [...added.attributes]) {
          if (attr.name === 'data-uic-id') continue;
          if (attr.name === 'style') {
            safeStyle(attr.value);
            continue;
          }
          setAttribute(added, attr.name, attr.value);
        }
        added.dataset.uicId = id;
        elements.set(id, added);
        nodes.set(id, {
          id,
          parentId: null,
          tag: added.localName,
          name: added.textContent.trim().slice(0, 120) || added.localName,
          kind: 'element',
          visible: true,
          position: 'static',
          rect: { x: 0, y: 0, width: 0, height: 0 },
          locator: null,
          generated: true,
          originParentId: op.element_id,
        });
      }
      const before = op.before_id ? get(op.before_id) : null;
      if (before && before.parentElement !== el) throw new Error('삽입 위치가 부모 안에 없습니다.');
      el.insertBefore(template.content, before);
    } else throw new Error('지원하지 않는 코드 패치입니다: ' + op.type);
  }
  if (nodes.size > 40000) throw new Error('요소는 40,000개까지 지원합니다.');
  for (const [id, node] of nodes) {
    const el = elements.get(id);
    node.codeDeleted = !el?.isConnected;
    if (el?.isConnected)
      node.parentId = el.parentElement?.closest('[data-uic-id]')?.dataset.uicId || null;
  }
  return { doc, nodes, patches, elements };
}
export function codeDifferenceIds(left = [], right = []) {
  if (JSON.stringify(left) === JSON.stringify(right)) return [];
  return [
    ...new Set(
      [...left, ...right].map(
        (op) => op.element_id || (op.type === 'resource' ? '@resource' : '@stylesheet'),
      ),
    ),
  ];
}
