import { elementLabel, isMajorElement } from './element-labels.js';
export function createDocumentLists({ $, state, selectNode, focusComment }) {
  function renderLayers() {
    const scene = state.scene,
      container = $('#layers');
    if (!scene) return;
    const query = $('#layer-search').value.trim().toLowerCase(),
      fragment = document.createDocumentFragment();
    const commentNumbers = new Map(
      Object.keys(scene.annotations).map((id, index) => [id, index + 1]),
    );
    const children = scene.children;
    const majorOnly = $('#major-layers').checked;
    let matches = null;
    if (query) {
      matches = new Set();
      for (const node of scene.nodes.values())
        if ((node.name + ' ' + node.tag + ' ' + node.id).toLowerCase().includes(query)) {
          matches.add(node.id);
          scene.ancestors(node.id).forEach((id) => matches.add(id));
        }
    }
    function add(node, depth) {
      if (matches && !matches.has(node.id)) return;
      if (majorOnly && !query && !isMajorElement(node) && !scene.selection.has(node.id)) {
        for (const child of children.get(node.id) || []) add(child, depth);
        return;
      }
      const descendants = children.get(node.id) || [],
        expanded = state.expanded.has(node.id) || !!query;
      const row = document.createElement('div');
      row.className =
        'layer-row' +
        (scene.selection.has(node.id) ? ' selected' : '') +
        (scene.hidden(node.id) ? ' deleted' : '');
      row.style.paddingLeft = Math.min(depth * 12, 96) + 'px';
      row.dataset.layerId = node.id;
      const toggle = document.createElement('button');
      toggle.className = 'tree-toggle';
      toggle.textContent = descendants.length ? (expanded ? '⌄' : '›') : '';
      toggle.disabled = !descendants.length;
      toggle.setAttribute('aria-label', (expanded ? '접기' : '펼치기') + ' ' + node.name);
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.addEventListener('click', () => {
        if (state.expanded.has(node.id)) state.expanded.delete(node.id);
        else state.expanded.add(node.id);
        renderLayers();
      });
      const pick = document.createElement('button');
      pick.className = 'layer-pick';
      pick.setAttribute('aria-pressed', String(scene.selection.has(node.id)));
      const icon = document.createElement('span');
      icon.className = 'layer-icon';
      icon.textContent =
        node.kind === 'text'
          ? 'T'
          : node.kind === 'icon'
            ? '◇'
            : node.kind === 'raster'
              ? '▧'
              : '▱';
      const label = document.createElement('span');
      label.className = 'layer-label';
      label.textContent = elementLabel(node);
      pick.title = node.name + ' · ' + node.tag + ' · ' + node.id;
      pick.append(icon, label);
      pick.addEventListener('click', (event) =>
        selectNode(node.id, { reveal: true, additive: event.metaKey || event.ctrlKey }),
      );
      row.append(toggle, pick);
      if (scene.annotations[node.id]) {
        const mark = document.createElement('span');
        mark.className = 'layer-comment';
        mark.textContent = '주석 ' + commentNumbers.get(node.id);
        mark.title = scene.annotations[node.id];
        row.append(mark);
      }
      if (scene.edits[node.id]?.deleted || scene.edits[node.id]?.dx || scene.edits[node.id]?.dy) {
        const mark = document.createElement('span');
        mark.className = 'layer-mark';
        mark.textContent = scene.edits[node.id]?.deleted ? '×' : '•';
        row.append(mark);
      }
      fragment.append(row);
      if (expanded) descendants.forEach((child) => add(child, depth + 1));
    }
    (children.get(null) || []).forEach((node) => add(node, 0));
    container.replaceChildren(fragment);
    $('#layer-count').textContent = scene.elements.size.toLocaleString();
  }
  return { renderLayers };
}
