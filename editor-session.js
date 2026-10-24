import { copy } from './engine.js';
import { saveSession } from './db.js';
import { createSaveQueue } from './save-queue.js';
export function createEditorSession({
  state,
  getNote,
  setNote,
  status,
  render,
  commitCommentDraft,
}) {
  function checkpoint() {
    return {
      edits: copy(state.scene.edits),
      annotations: copy(state.scene.annotations),
      selected: state.scene.selected,
      note: getNote(),
      activeSnapshotId: state.timeline?.activeId || null,
    };
  }
  function applyCheckpoint(point) {
    state.commentTarget = null;
    state.scene.setComments(point.annotations);
    state.scene.setEdits(point.edits);
    state.scene.select(point.selected);
    setNote(point.note || '');
  }
  function historyBefore() {
    state.undo.push(checkpoint());
    if (state.undo.length > 100) state.undo.shift();
    state.redo = [];
  }
  function changeCommitted(detail = {}) {
    if (detail.cancel) state.undo.pop();
    else {
      state.revision++;
      state.lastAction = { actor: detail.actor || 'user', label: detail.label || '화면 편집' };
    }
    render();
    save();
  }
  function undo(direction = 'undo', detail = {}) {
    if (!state.scene) return;
    const from = state[direction],
      to = state[direction === 'undo' ? 'redo' : 'undo'],
      previous = from.pop();
    if (!previous) return;
    to.push(checkpoint());
    applyCheckpoint(previous);
    if (state.timeline) state.timeline.activeId = previous.activeSnapshotId || null;
    state.revision++;
    state.lastAction = {
      actor: detail.actor || 'user',
      label: direction === 'undo' ? '실행 취소' : '다시 실행',
    };
    render();
    save();
  }
  const saveQueue = createSaveQueue(saveSession, {
    onSaved(id) {
      if (id === state.snapshot?.id) {
        state.lastSaveError = null;
        status('이 기기에 저장됨');
      }
    },
    onError(error, id) {
      if (id === state.snapshot?.id) {
        state.lastSaveError = error.message;
        status('자동 저장 실패 · 파일로 저장해 주세요');
      }
    },
  });
  function save() {
    if (!state.snapshot || !state.scene || !state.ready) return;
    status('저장 중…');
    state.saving = saveQueue.enqueue(state.snapshot.id, {
      edits: state.scene.edits,
      annotations: state.scene.annotations,
      timeline: state.timeline,
      note: getNote(),
      updatedAt: new Date().toISOString(),
    });
  }
  async function flushEditor() {
    if (state.scene?.drag) throw new Error('요소 드래그를 마친 뒤 다시 시도해 주세요.');
    if (state.snapshot && !state.ready)
      throw new Error('화면을 여는 중입니다. 잠시 후 다시 시도해 주세요.');
    commitCommentDraft();
    save();
    await saveQueue.flush();
    return { document_id: state.snapshot?.id || null };
  }
  return {
    checkpoint,
    applyCheckpoint,
    historyBefore,
    changeCommitted,
    undo,
    save,
    flushEditor,
    flush: saveQueue.flush,
  };
}
