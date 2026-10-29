// Blink lays out on 1/64 CSS-pixel units. Its computed-style decimal string
// can round down when parsed again (134.078125 -> 134.078 -> 134.0625),
// wrapping an otherwise exact-fitting flex row. Restore that lost precision
// in the rendering copy only; the immutable capture and edits are untouched.
export function restoreCapturedLayout(doc, nodes) {
  // Script-created DOM can contain a paragraph inside a paragraph. Parsing
  // its serialized HTML closes the outer paragraph early. Restore its known
  // captured children, then use a neutral styled box to keep later file/code
  // roundtrips from repairing it again. Source tags/locators stay in nodes.
  const elements = new Map(
    [...doc.querySelectorAll('[data-uic-id]')].map((e) => [e.dataset.uicId, e]),
  );
  const repaired = new Set();
  for (const node of nodes.values()) {
    const parent = elements.get(node.parentId),
      child = elements.get(node.id);
    if (
      parent?.tagName === 'P' &&
      child &&
      child.parentElement?.closest('[data-uic-id]') !== parent
    ) {
      parent.append(child);
      repaired.add(parent);
    }
  }
  if (repaired.size) {
    for (const parent of repaired) {
      const box = doc.createElement('div');
      for (const attribute of parent.attributes) box.setAttribute(attribute.name, attribute.value);
      box.append(...parent.childNodes);
      parent.replaceWith(box);
    }
    for (const paragraph of doc.querySelectorAll('p:not([data-uic-id])'))
      if (!paragraph.attributes.length && !paragraph.childNodes.length) paragraph.remove();
  }
  for (const element of doc.querySelectorAll('[data-uic-id]')) {
    const style = element.style;
    if (!/^\d+(?:\.\d+)?px$/.test(style.width)) continue;
    // CSS zoom changes the effective layout unit; do not quantize that tree.
    let zoomed = false;
    for (let owner = element; owner; owner = owner.parentElement) {
      const zoom = owner.style.zoom;
      if (zoom && zoom !== 'normal' && zoom !== '1') {
        zoomed = true;
        break;
      }
    }
    if (zoomed) continue;
    const width = parseFloat(style.width);
    style.setProperty(
      'width',
      Math.round(width * 64) / 64 + 'px',
      style.getPropertyPriority('width'),
    );
  }
}
