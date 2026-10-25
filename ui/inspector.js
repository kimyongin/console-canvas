import { renderPath } from './react/lists.tsx';
import { elementLabel } from './element-labels.js';
export function createInspector({ $, state, kinds, selectNode }) {
  function renderInspector() {
    const scene = state.scene,
      id = scene?.selected,
      node = id && scene.nodes.get(id);
    $('#no-selection').hidden = !!node;
    $('#inspector').hidden = !node;
    $('#delete').disabled = !node || scene.hidden(id) || state.mode === 'comment';
    $('#copy').disabled = !node || scene.hidden(id) || state.mode === 'comment';
    $('#paste').disabled = !scene || state.mode === 'comment';
    $('#select-parent').disabled = !node || !scene.parent(id);
    $('#direct-edit-controls').hidden = state.mode === 'comment';
    const count = scene?.selection.size || 0;
    $('#inspector').classList.toggle('multi-selection', count > 1);
    $('#inspector-delete').textContent = count > 1 ? '선택한 ' + count + '개 삭제' : '이 요소 삭제';
    $('#batch-controls').hidden = count < 2;
    $('#selection-count').textContent = count + '개 선택됨';
    $('.coordinate-fields').hidden = count > 1;
    $('.field-heading').textContent = count > 1 ? '묶음 전체 이동' : '원래 위치에서 이동';
    $('.component-comment label').textContent = '수정 요청';
    $('#zoom-selection').disabled = !node;
    $('#edit-properties').disabled = !node;
    if (!node) {
      if (!$('#comment-dialog').open) state.commentTarget = null;
      return;
    }
    if (document.activeElement !== $('#layer-alias'))
      $('#layer-alias').value = state.snapshot.layerNames?.[id] || '';
    const comment = scene.annotations[id] || '';
    $('#comment-target-title').textContent = elementLabel(node, state.snapshot.layerNames);
    $('#selected-comment-summary').textContent =
      comment || '수정 방향을 주석으로 남길 수 있습니다.';
    $('#edit-selected-comment').textContent = comment ? '주석 편집' : '주석 남기기';
    if (
      !$('#comment-dialog').open &&
      (state.commentTarget !== id || document.activeElement !== $('#component-comment'))
    )
      $('#component-comment').value = comment;
    if (!$('#comment-dialog').open) state.commentTarget = id;
    $('#clear-comment').disabled = !comment && !$('#component-comment').value.trim();
    $('#comment-status').textContent = comment
      ? '저장된 주석 · 전달 파일에 포함됩니다.'
      : '주석은 화면을 바꾸지 않고 요청으로 전달됩니다.';
    $('#element-kind').textContent =
      count > 1 ? '다중 선택 · ' + count + '개' : (kinds[node.kind] || '요소') + ' · ' + node.tag;
    $('#element-name').textContent =
      count > 1 ? count + '개 요소 선택' : elementLabel(node, state.snapshot.layerNames);
    const path = $('#element-path');
    renderPath(
      path,
      [...scene.ancestors(id).reverse(), id].slice(-5).map((key) => ({
        id: key,
        label: elementLabel(scene.nodes.get(key), state.snapshot.layerNames),
        title: scene.nodes.get(key).tag + ' · ' + key,
      })),
      selectNode,
    );
    const edit = scene.edits[id] || {};
    $('#offset-x').value = edit.dx || 0;
    $('#offset-y').value = edit.dy || 0;
    let rect = scene.rect(id) || node.rect;
    if (count > 1) {
      const boxes = scene
        .selectionRoots()
        .map((key) => scene.rect(key))
        .filter(Boolean);
      if (boxes.length) {
        const left = Math.min(...boxes.map((r) => r.x)),
          top = Math.min(...boxes.map((r) => r.y));
        rect = {
          width: Math.max(...boxes.map((r) => r.x + r.width)) - left,
          height: Math.max(...boxes.map((r) => r.y + r.height)) - top,
        };
      }
    }
    $('#element-size').textContent =
      (count > 1 ? '선택 영역 · ' : '') +
      Math.round(rect.width) +
      ' × ' +
      Math.round(rect.height) +
      ' px' +
      (scene.hidden(id) ? ' · 삭제됨' : '');
    $('#inspector-delete').disabled = scene.hidden(id);
  }

  return { renderInspector };
}
