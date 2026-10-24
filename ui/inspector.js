export function createInspector({ $, state, kinds }) {
  function renderInspector() {
    const scene = state.scene,
      id = scene?.selected,
      node = id && scene.nodes.get(id);
    $('#no-selection').hidden = !!node;
    $('#inspector').hidden = !node;
    $('#delete').disabled = !node || scene.hidden(id) || state.mode === 'comment';
    $('#select-parent').disabled = !node || !scene.parent(id);
    $('#direct-edit-controls').hidden = state.mode === 'comment';
    if (!node) {
      state.commentTarget = null;
      return;
    }
    const comment = scene.annotations[id] || '';
    if (state.commentTarget !== id || document.activeElement !== $('#component-comment'))
      $('#component-comment').value = comment;
    state.commentTarget = id;
    $('#clear-comment').disabled = !comment && !$('#component-comment').value.trim();
    $('#comment-status').textContent = comment
      ? '저장된 주석 · 전달 파일에 포함됩니다.'
      : '주석은 화면을 바꾸지 않고 요청으로 전달됩니다.';
    $('#element-kind').textContent = (kinds[node.kind] || '요소') + ' · ' + node.tag;
    $('#element-name').textContent = node.name || node.tag;
    $('#element-path').textContent =
      [
        ...scene
          .ancestors(id)
          .reverse()
          .map((id) => scene.nodes.get(id).tag),
        node.tag,
      ].join(' › ') +
      ' · ' +
      id;
    const edit = scene.edits[id] || {};
    $('#offset-x').value = edit.dx || 0;
    $('#offset-y').value = edit.dy || 0;
    const rect = scene.rect(id) || node.rect;
    $('#element-size').textContent =
      Math.round(rect.width) +
      ' × ' +
      Math.round(rect.height) +
      ' px' +
      (scene.hidden(id) ? ' · 삭제됨' : '');
    $('#inspector-delete').disabled = scene.hidden(id);
  }

  return { renderInspector };
}
