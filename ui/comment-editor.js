import { suggestDesignIntents, RESPONSIVE_INTENTS, appendIntent } from '../design-intent.js';
import { renderIntentSuggestions } from './react/intent-suggestions.tsx';
import { handoffRequests } from '../handoff-image.js';
import { renderTargetPreview, renderVersionOptions } from './react/versions.tsx';
import { clearReact } from './react/mount.tsx';
import { elementLabel } from './element-labels.js';
import { pointTarget } from '../edit-commands.js';
export function createCommentEditor({ $, state, commit, flushEditor }) {
  const dialog = $('#comment-dialog'),
    field = $('#component-comment');
  let timer,
    requests = [],
    queueMode = false,
    documentId = null;
  function close() {
    clearTimeout(timer);
    if (dialog.open) dialog.close();
  }
  function open({ id = state.scene?.selected, navigating = false, ids = null } = {}) {
    if (!state.scene || !id) return;
    if (navigating && documentId !== state.snapshot?.id) return;
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
      renderVersionOptions(
        $('#comment-request'),
        requests.map((r, i) => ({
          id: r.id,
          name: `${queueMode ? '대상 ' : ''}${i + 1} / ${requests.length} · ${r.name}`,
        })),
      );
    }
    $('#comment-request').value = id;
    const index = requests.findIndex((r) => r.id === id);
    $('#comment-progress').textContent =
      `${queueMode ? '선택 대상' : '요청'} ${index + 1} / ${requests.length}`;
    $('#comment-previous').disabled = index <= 0;
    $('#comment-next').disabled = index < 0 || index >= requests.length - 1;
    const point = pointTarget(id);
    if (!point && !state.scene.nodes.has(id)) return;
    state.commentTarget = id;
    $('#comment-dialog-title').textContent = point
      ? '위치에 주석 남기기'
      : '컴포넌트에 주석 남기기';
    $('#comment-target-title').textContent = point
      ? `위치 · ${point.x}, ${point.y}`
      : elementLabel(state.scene.nodes.get(id), state.snapshot.layerNames);
    field.value = state.scene.annotations[id] || '';
    $('#clear-comment').disabled = !field.value;
    if (!dialog.open) dialog.showModal();
    $('#comment-status').textContent = state.lastSaveError
      ? '자동 저장 실패 · 파일로 백업해 주세요: ' + state.lastSaveError
      : '입력 내용은 자동 저장됩니다.';
    const scene = state.scene,
      request = handoffRequests(scene).find((r) => r.id === id);
    const rect =
      request?.rect ||
      (point
        ? { x: point.x, y: point.y, width: 0, height: 0 }
        : scene.rect(id) || scene.nodes.get(id).rect);
    const reference = scene.hidden(id) ? scene.referenceFrame() : null;
    $('#comment-preview-label').textContent = reference
      ? '삭제 전 참고 · 테두리가 주석 대상입니다.'
      : point
        ? '지정 위치 주변 화면'
        : '대상 주변 화면 · 보라색 테두리가 주석 대상입니다.';
    renderTargetPreview(
      $('#comment-target-preview'),
      reference?.html || scene.serialize(),
      reference?.size || scene.contentSize(),
      rect,
      100,
    );
    renderIntentSuggestions(
      $('#comment-intent-suggestions'),
      suggestDesignIntents(scene, id),
      RESPONSIVE_INTENTS,
      (text, responsive) => {
        try {
          field.value = appendIntent(field.value, text, { responsive });
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.focus();
        } catch (error) {
          $('#comment-status').textContent = error.message;
        }
      },
    );
    field.focus();
  }
  field.addEventListener('input', () => {
    $('#clear-comment').disabled = !field.value.trim();
    clearTimeout(timer);
    $('#comment-status').textContent = '입력 중 · 자동 저장됩니다.';
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
  });
  field.addEventListener('keydown', (e) => {
    if (!e.isComposing && e.keyCode !== 229 && (e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      commit();
      close();
    }
  });
  dialog.addEventListener('cancel', () => commit());
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      commit();
      close();
    }
  });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    clearTimeout(timer);
    state.commentTarget = null;
    ((requests = []), (queueMode = false), (documentId = null));
    clearReact($('#comment-target-preview'));
    clearReact($('#comment-intent-suggestions'));
  });
  $('#close-comment-dialog').addEventListener('click', () => {
    commit();
    close();
  });
  $('#save-comment').addEventListener('click', () => {
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
  return { open, reset: close, position() {} };
}
