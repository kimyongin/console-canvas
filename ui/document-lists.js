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
  function renderChanges() {
    if (!state.scene) return;
    const changes = state.scene.changes(),
      comments = state.scene.comments(),
      container = $('#changes');
    container.replaceChildren();
    $('#change-count').textContent = changes.length + comments.length;
    renderComments();
    if (!changes.length && !comments.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-small';
      empty.textContent = '이동·삭제 기록과 요소별 주석을 모읍니다.';
      container.append(empty);
    }
    for (const change of changes) {
      const item = document.createElement('div');
      item.className = 'change-item';
      const title = document.createElement('strong');
      title.textContent = change.name;
      const detail = document.createElement('span');
      detail.textContent =
        change.action === 'delete'
          ? '삭제' +
            (change.affectedDescendants ? ' · 하위 ' + change.affectedDescendants + '개 포함' : '')
          : 'X ' + change.delta.x + ' · Y ' + change.delta.y;
      item.append(title, detail);
      container.append(item);
    }
    comments.forEach((comment, index) => {
      const item = document.createElement('div');
      item.className = 'change-item';
      const pick = document.createElement('button');
      pick.type = 'button';
      const title = document.createElement('strong');
      title.textContent = '주석 ' + (index + 1) + ' · ' + comment.name;
      pick.append(title);
      pick.addEventListener('click', () => {
        selectNode(comment.id, { reveal: true });
        focusComment();
      });
      const text = document.createElement('span');
      text.className = 'comment-text';
      text.textContent = comment.text;
      item.append(pick, text);
      if (comment.targetDeleted) {
        const deleted = document.createElement('span');
        deleted.className = 'comment-target-deleted';
        deleted.textContent = '대상이 삭제된 상태 · 요청 내용 확인 필요';
        item.append(deleted);
      }
      container.append(item);
    });
  }

  function renderComments() {
    const comments = state.scene?.comments() || [],
      query = $('#comment-search').value.trim().toLowerCase();
    $('#comments-count').textContent = comments.length;
    const list = $('#comments-list');
    list.replaceChildren();
    for (const [index, comment] of comments.entries()) {
      const name = elementLabel(state.scene.nodes.get(comment.id));
      if (query && !`${name} ${comment.text}`.toLowerCase().includes(query)) continue;
      const button = document.createElement('button');
      button.className = 'comment-list-item';
      const title = document.createElement('strong'),
        text = document.createElement('span');
      title.textContent = index + 1 + '. ' + name + (comment.targetDeleted ? ' · 삭제된 대상' : '');
      text.textContent = comment.text;
      button.append(title, text);
      button.addEventListener('click', () => {
        selectNode(comment.id, { reveal: true });
        focusComment();
      });
      list.append(button);
    }
    if (!list.children.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-small';
      empty.textContent = comments.length
        ? '검색 결과가 없습니다.'
        : '주석 모드에서 요소를 클릭해 수정 방향을 남겨 보세요.';
      list.append(empty);
    }
  }
  $('#comment-search').addEventListener('input', renderComments);
  return { renderLayers, renderChanges, renderComments };
}
