import { elementLabel, isMajorElement } from './element-labels.js';
import { renderLayerRows } from './react/lists.tsx';
export function createDocumentLists({ $, state, selectNode }) {
  function renderLayers() {
    const scene = state.scene;
    if (!scene) return;
    const query = $('#layer-search').value.trim().toLowerCase(),
      rows = [];
    const numbers = new Map(Object.keys(scene.annotations).map((id, index) => [id, index + 1]));
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
      const children = scene.children.get(node.id) || [];
      if (
        $('#major-layers').checked &&
        !query &&
        !isMajorElement(node) &&
        !scene.selection.has(node.id)
      ) {
        children.forEach((child) => add(child, depth));
        return;
      }
      const expanded = state.expanded.has(node.id) || !!query,
        edit = scene.edits[node.id];
      rows.push({
        id: node.id,
        depth,
        selected: scene.selection.has(node.id),
        deleted: scene.hidden(node.id),
        expanded,
        hasChildren: !!children.length,
        name: node.name,
        title: node.name + ' · ' + node.tag + ' · ' + node.id,
        icon: { text: 'T', icon: '◇', raster: '▧' }[node.kind] || '▱',
        label: elementLabel(node),
        comment: scene.annotations[node.id],
        commentNumber: numbers.get(node.id),
        mark: edit?.deleted ? '×' : edit?.dx || edit?.dy ? '•' : null,
      });
      if (expanded) children.forEach((child) => add(child, depth + 1));
    }
    (scene.children.get(null) || []).forEach((node) => add(node, 0));
    renderLayerRows(
      $('#layers'),
      rows,
      (id) => {
        if (state.expanded.has(id)) state.expanded.delete(id);
        else state.expanded.add(id);
        renderLayers();
      },
      (id, additive) => selectNode(id, { reveal: true, additive }),
    );
    $('#layer-count').textContent = scene.elements.size.toLocaleString();
  }
  return { renderLayers };
}
