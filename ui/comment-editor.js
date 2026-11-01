import { handoffRequests } from '../handoff-image.js';
import { renderTargetPreview, renderSelectOptions } from './react/scene-preview.tsx';
import { clearReact } from './react/mount.tsx';
import { elementLabel } from './element-labels.js';
import { pointTarget } from '../edit-commands.js';
import { isComposingKey } from './keyboard.js';
export function createCommentEditor({
  $,
  state,
  commit,
  flushEditor,
  revealPanel,
  renderRequests,
}) {
  const dialog = $('#comment-dialog'),
    field = $('#component-comment');
  let timer,
    requests = [],
    queueMode = false,
    documentId = null,
    composing = false;
  function close() {
    if (composing) throw Error('한글 입력을 마친 뒤 다시 시도해 주세요.');
    clearTimeout(timer);
    state.commentEditing = false;
    state.commentTarget = null;
    $('#inline-comment-editor').hidden = true;
    dialog.append($('#comment-composer'));
    clearReact($('#comment-target-preview'));
    composing = false;
    if (dialog.open) dialog.close();
    renderRequests();
  }
  function open({
    id = state.scene?.selected,
    navigating = false,
    ids = null,
    expanded = false,
  } = {}) {
    if (!state.scene || !id) return;
    if (navigating && documentId !== state.snapshot?.id) return;
    if (composing) throw Error('한글 입력을 마친 뒤 다시 시도해 주세요.');
    clearTimeout(timer);
    commit();
    if (!navigating) {
      documentId = state.snapshot.id;
      queueMode = !!ids?.length;
      const all = handoffRequests(state.scene);
      requests = queueMode
        ? [...new Set(ids)]
            .filter((key) => state.scene.nodes.has(key))
            .map(
              (key) =>
                all.find((r) => r.id === key) || {
                  id: key,
                  name: elementLabel(state.scene.nodes.get(key), state.snapshot.layerNames),
                },
            )
        : all;
      if (queueMode) id = requests[0]?.id;
      if (!id) return;
      if (!requests.some((r) => r.id === id))
        requests.push({
          id,
          number: requests.length + 1,
          name: pointTarget(id)
            ? '위치 주석'
            : elementLabel(state.scene.nodes.get(id), state.snapshot.layerNames),
        });
      renderSelectOptions(
        $('#comment-request'),
        requests.map((r, i) => ({
          id: r.id,
          name: `${queueMode ? '대상 ' : ''}${i + 1} / ${requests.length} · ${r.name}`,
        })),
      );
    }
    $('#comment-request').value = id;
    const index = requests.findIndex((r) => r.id === id);
    $('.comment-navigation').hidden = requests.length <= 1;
    $('#comment-target-title').hidden = requests.length > 1;
    $('#comment-previous').disabled = index <= 0;
    $('#comment-next').disabled = index < 0 || index >= requests.length - 1;
    const point = pointTarget(id);
    if (!point && !state.scene.nodes.has(id)) return;
    state.commentTarget = id;
    state.commentEditing = true;
    const targetName = point
      ? `위치 · ${point.x}, ${point.y}`
      : elementLabel(state.scene.nodes.get(id), state.snapshot.layerNames);
    $('#comment-dialog-title').textContent = targetName + ' · 주석';
    $('#comment-target-title').textContent = targetName;
    field.value = state.scene.annotations[id] || '';
    $('#clear-comment').disabled = !field.value;
    $('#clear-comment').hidden = !field.value.trim();
    $('#inline-comment-heading').hidden = expanded;
    $('#save-comment').hidden = !expanded;
    $('#comment-target-preview').hidden = !expanded;
    $('#inline-comment-editor').hidden = expanded;
    if (expanded) {
      dialog.append($('#comment-composer'));
      if (!dialog.open) dialog.showModal();
    } else {
      revealPanel();
      $('#inline-comment-editor').append($('#comment-composer'));
    }

    $('#comment-status').textContent = state.lastSaveError
      ? '자동 저장 실패 · 파일로 백업해 주세요: ' + state.lastSaveError
      : field.value.trim()
        ? '저장된 주석'
        : '';
    const scene = state.scene,
      request = handoffRequests(scene).find((r) => r.id === id);
    const rect =
      request?.rect ||
      (point
        ? { x: point.x, y: point.y, width: 0, height: 0 }
        : scene.rect(id) || scene.nodes.get(id).rect);
    const reference = scene.hidden(id) ? scene.referenceFrame() : null;
    $('#comment-preview-label').textContent = reference ? '삭제 전 참고' : '';
    $('#comment-preview-label').hidden = !reference;
    if (expanded)
      renderTargetPreview(
        $('#comment-target-preview'),
        reference?.html || scene.serialize(),
        reference?.size || scene.contentSize(),
        rect,
        100,
        id,
      );
    renderRequests();
    field.focus();
  }
  function scheduleSave() {
    $('#clear-comment').disabled = !field.value.trim();
    $('#clear-comment').hidden = !field.value.trim();
    clearTimeout(timer);
    $('#comment-status').textContent = '입력 중 · 자동 저장됩니다.';
    if (composing) return;
    const target = state.commentTarget,
      generation = state.generation;
    timer = setTimeout(async () => {
      commit();
      try {
        await flushEditor();
        if (state.generation === generation && state.commentTarget === target)
          $('#comment-status').textContent = '자동 저장 완료';
      } catch (error) {
        if (state.generation === generation && state.commentTarget === target)
          $('#comment-status').textContent =
            '자동 저장 실패 · 편집 파일로 백업해 주세요: ' + error.message;
      }
    }, 650);
  }
  field.addEventListener('compositionstart', () => {
    composing = true;
    clearTimeout(timer);
  });
  field.addEventListener('compositionend', () => {
    composing = false;
    scheduleSave();
  });
  field.addEventListener('input', scheduleSave);
  field.addEventListener('keydown', (e) => {
    if ((composing || isComposingKey(e)) && ['Enter', 'Escape'].includes(e.key)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (!composing && !isComposingKey(e) && (e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      commit();
      close();
    }
  });
  dialog.addEventListener('cancel', () => commit());
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !composing && !isComposingKey(e)) {
      e.preventDefault();
      e.stopPropagation();
      commit();
      close();
    }
  });
  dialog.addEventListener('close', () => {
    if (dialog.open || (!$('#inline-comment-editor').hidden && state.commentEditing)) return;
    state.commentEditing = false;
    $('#inline-comment-editor').hidden = true;
    composing = false;
    clearTimeout(timer);
    state.commentTarget = null;
    ((requests = []), (queueMode = false), (documentId = null));
    clearReact($('#comment-target-preview'));
  });
  $('#expand-comment-editor').onclick = () => open({ id: state.commentTarget, expanded: true });
  $('#close-inline-comment').onclick = () => {
    if (composing) return;
    commit();
    close();
  };
  $('#close-comment-dialog').addEventListener('click', () => {
    if (composing) return;
    commit();
    close();
  });
  $('#save-comment').addEventListener('click', () => {
    if (composing) return;
    commit();
    close();
  });
  for (const [button, delta] of [
    ['#comment-previous', -1],
    ['#comment-next', 1],
  ])
    $(button).addEventListener('click', () => {
      const index = requests.findIndex((r) => r.id === state.commentTarget),
        next = requests[index + delta];
      if (next) open({ id: next.id, navigating: true });
    });
  $('#comment-request').addEventListener('change', () =>
    open({ id: $('#comment-request').value, navigating: true }),
  );
  return { open, reset: close, isComposing: () => composing, position() {} };
}
