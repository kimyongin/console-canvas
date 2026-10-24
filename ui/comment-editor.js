import { elementLabel } from './element-labels.js';
export function createCommentEditor({ $, state, commit, showInspector }) {
  const form = $('.component-comment'),
    field = $('#component-comment');
  let timer;
  function close() {
    $('#comment-popover').hidden = true;
    $('#inspector-comment-host').append(form);
  }
  function position() {
    if ($('#comment-popover').hidden || !state.scene?.selected) return;
    const r = state.scene.rect(state.scene.selected),
      frame = $('#scene-frame').getBoundingClientRect();
    if (!r) return;
    const box = $('#comment-popover'),
      width = Math.min(320, innerWidth - 24);
    box.style.width = width + 'px';
    box.style.left =
      Math.max(
        12,
        Math.min(innerWidth - width - 12, frame.left + (r.x + r.width) * state.zoom + 12),
      ) + 'px';
    box.style.top =
      Math.max(12, Math.min(innerHeight - box.offsetHeight - 12, frame.top + r.y * state.zoom)) +
      'px';
  }
  function open({ floating = false } = {}) {
    if (!state.scene?.selected) return;
    if (floating) {
      $('#floating-comment-title').textContent = elementLabel(
        state.scene.nodes.get(state.scene.selected),
      );
      $('#floating-comment-host').append(form);
      $('#comment-popover').hidden = false;
      position();
    } else {
      close();
      showInspector();
    }
    field.focus({ preventScroll: true });
    if (!floating) field.scrollIntoView({ block: 'nearest' });
  }
  function schedule() {
    clearTimeout(timer);
    $('#comment-status').textContent = '입력 중 · 자동 저장됩니다.';
    timer = setTimeout(() => {
      commit();
      const id = state.commentTarget,
        text = field.value.trim();
      state.saving.then(() => {
        if (state.commentTarget === id && field.value.trim() === text)
          $('#comment-status').textContent = state.lastSaveError
            ? '저장 실패 · 다시 저장해 주세요.'
            : '주석이 이 기기에 저장됐습니다.';
      });
    }, 650);
  }
  function reset() {
    clearTimeout(timer);
    close();
  }
  field.addEventListener('input', schedule);
  field.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      clearTimeout(timer);
      commit();
      close();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      commit();
      close();
    }
  });
  $('#close-comment-popover').addEventListener('click', () => {
    commit();
    close();
  });
  $('#viewport').addEventListener('scroll', position);
  window.addEventListener('resize', position);
  return { open, reset, position };
}
