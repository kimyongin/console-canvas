import { elementLabel, isMajorElement } from './element-labels.js';
import { renderLayerRows } from './react/lists.tsx';
export function createDocumentLists({ $, state, adapter, selectNode, renameLayer }) {
  const key = 'console-canvas-layer-navigation-v1';
  let cache = new Map(),
    pendingScroll = null,
    lastSaved = '';
  try {
    const values = JSON.parse(localStorage.getItem(key) || '[]');
    if (Array.isArray(values)) cache = new Map(values.slice(-20));
  } catch {}
  function remember() {
    if (!state.ready || !state.snapshot || !state.scene) return;
    const value = {
      expanded: [...state.expanded].slice(0, 2000),
      query: $('#layer-search').value.slice(0, 240),
      major: $('#major-layers').checked,
      scroll: $('#layers').scrollTop,
    };
    cache.delete(state.snapshot.id);
    cache.set(state.snapshot.id, value);
    while (cache.size > 20) cache.delete(cache.keys().next().value);
    const serialized = JSON.stringify([...cache]);
    if (serialized !== lastSaved)
      try {
        localStorage.setItem(key, serialized);
        lastSaved = serialized;
      } catch {}
  }
  function restoreNavigation() {
    const value = cache.get(state.snapshot.id),
      ids = new Set(state.snapshot.nodes.map((n) => n.id));
    if (value && Array.isArray(value.expanded))
      state.expanded = new Set(
        value.expanded.filter((id) => typeof id === 'string' && ids.has(id)),
      );
    $('#layer-search').value = typeof value?.query === 'string' ? value.query.slice(0, 240) : '';
    $('#major-layers').checked = !!value?.major;
    pendingScroll = Number.isFinite(value?.scroll) ? Math.max(0, value.scroll) : 0;
  }
  let timer;
  $('#layers').addEventListener('scroll', () => {
    clearTimeout(timer);
    timer = setTimeout(remember, 100);
  });
  let directMatches = [];
  function renderLayers() {
    const scene = state.scene;
    if (!scene) return;
    const query = $('#layer-search').value.trim().toLowerCase(),
      rows = [];
    const numbers = new Map(Object.keys(scene.annotations).map((id, index) => [id, index + 1]));
    let matches = null;
    directMatches = [];
    if (query) {
      matches = new Set();
      for (const node of scene.nodes.values())
        if (
          (
            (state.snapshot.layerNames?.[node.id] || '') +
            ' ' +
            elementLabel(node) +
            ' ' +
            node.name +
            ' ' +
            node.tag +
            ' ' +
            node.id +
            ' ' +
            Object.values(node.locator || {})
              .filter((v) => typeof v === 'string')
              .join(' ')
          )
            .toLowerCase()
            .includes(query)
        ) {
          matches.add(node.id);
          if (!node.scopeHidden) directMatches.push(node.id);
          scene.ancestors(node.id).forEach((id) => matches.add(id));
        }
    }
    function add(node, depth) {
      if (node.scopeHidden) return;
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
        name: elementLabel(node, state.snapshot.layerNames),
        title: node.name + ' · ' + node.tag + ' · ' + node.id,
        icon: { text: 'T', icon: '◇', raster: '▧' }[node.kind] || '▱',
        label: elementLabel(node, state.snapshot.layerNames),
        comment: scene.annotations[node.id],
        searchMatch: directMatches.includes(node.id),
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
      renameLayer,
      query
        ? '일치하는 요소가 없습니다. 검색어를 바꾸거나 검색을 지워 주세요.'
        : '표시할 요소가 없습니다.',
    );
    $('#layer-count').textContent = scene.elements.size.toLocaleString();
    $('#layer-search-clear').hidden = !$('#layer-search').value;
    $('#layer-search-status').hidden = !query;
    $('#layer-search-status').textContent = query
      ? '일치 ' + directMatches.length.toLocaleString() + '개 · 상위 경로 함께 표시'
      : '';
    if (pendingScroll !== null) {
      $('#layers').scrollTop = pendingScroll;
      pendingScroll = null;
    }
    remember();
  }
  $('#layer-search').title =
    '문구·태그·원본 식별자로 검색합니다. 일치 표시는 실제 검색 결과이며 상위 경로는 탐색을 위해 함께 표시됩니다.';
  function clearSearch() {
    $('#layer-search').value = '';
    renderLayers();
    $('#layer-search').focus();
  }
  adapter.register('layer-search-clear', clearSearch);
  $('#layer-search').addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !e.currentTarget.value) return;
    e.preventDefault();
    e.stopPropagation();
    clearSearch();
  });
  return { renderLayers, restoreNavigation };
}
