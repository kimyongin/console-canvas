import { elementLabel } from './element-labels.js';
import { pointTarget } from '../edit-commands.js';
export function createCommentEditor({ $, state, commit }) {
  const dialog = $('#comment-dialog'),
    field = $('#component-comment');
  let timer;
  function close() {
    clearTimeout(timer);
    if (dialog.open) dialog.close();
  }
  function open({ id = state.scene?.selected } = {}) {
    if (!state.scene || !id) return;
    commit();
    const point = pointTarget(id);
    if (!point && !state.scene.nodes.has(id)) return;
    state.commentTarget = id;
    $('#comment-dialog-title').textContent = point
      ? '위치에 주석 남기기'
      : '컴포넌트에 주석 남기기';
    $('#comment-target-title').textContent = point
      ? `위치 · ${point.x}, ${point.y}`
      : elementLabel(state.scene.nodes.get(id));
    field.value = state.scene.annotations[id] || '';
    $('#clear-comment').disabled = !field.value;
    if (!dialog.open) dialog.showModal();
    field.focus();
  }
  field.addEventListener('input', () => {
    clearTimeout(timer);
    $('#comment-status').textContent = '입력 중 · 자동 저장됩니다.';
    timer = setTimeout(() => {
      commit();
      $('#comment-status').textContent = '이 기기에 저장됨';
    }, 650);
  });
  field.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
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
    clearTimeout(timer);
    state.commentTarget = null;
  });
  $('#close-comment-dialog').addEventListener('click', () => {
    commit();
    close();
  });
  $('#save-comment').addEventListener('click', () => {
    commit();
    close();
  });
  return { open, reset: close, position() {} };
}
