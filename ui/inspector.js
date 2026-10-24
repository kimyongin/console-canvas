import { elementLabel } from './element-labels.js';
export function createInspector({ $, state, kinds, selectNode }) {
  function renderInspector() {
    const scene = state.scene,
      id = scene?.selected,
      node = id && scene.nodes.get(id);
    $('#no-selection').hidden = !!node;
    $('#inspector').hidden = !node;
    $('#delete').disabled = !node || scene.hidden(id) || state.mode === 'comment';
    $('#select-parent').disabled = !node || !scene.parent(id);
    $('#direct-edit-controls').hidden = state.mode === 'comment';
    const count = scene?.selection.size || 0;
    $('#batch-controls').hidden = count < 2;
    $('#selection-count').textContent = count + '개 선택됨';
    $('.coordinate-fields').hidden = count > 1;
    $('.field-heading').textContent = count > 1 ? '묶음 전체 이동' : '원래 위치에서 이동';
    $('.component-comment label').textContent =
      count > 1 ? '주석 대상: ' + elementLabel(node) : '이 요소에 주석 남기기';
    $('#zoom-selection').disabled = !node;
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
    $('#element-name').textContent = count > 1 ? count + '개 요소 선택' : elementLabel(node);
    const path = $('#element-path');
    path.replaceChildren();
    for (const key of [...scene.ancestors(id).reverse(), id].slice(-5)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = elementLabel(scene.nodes.get(key));
      button.title = scene.nodes.get(key).tag + ' · ' + key;
      button.addEventListener('click', () => selectNode(key));
      path.append(button);
    }
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
