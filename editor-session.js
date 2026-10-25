import { recordActivity } from './activity-history.js';
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
      selection: [...state.scene.selection],
      note: getNote(),
      activeSnapshotId: state.timeline?.activeId || null,
      activityHead: state.activityHead || null,
    };
  }
  function applyCheckpoint(point) {
    state.commentTarget = null;
    state.activityHead = point.activityHead || null;
    state.scene.setEdits(point.edits);
    state.scene.setComments(point.annotations);
    state.scene.select(point.selected, {
      ids: point.selection || (point.selected ? [point.selected] : []),
    });
    setNote(point.note || '');
  }
  function historyBefore() {
    state.pendingBefore = checkpoint();
    state.undo.push(state.pendingBefore);
    if (state.undo.length > 100) state.undo.shift();
    state.pendingRedo = state.redo;
    state.redo = [];
  }
  function changeCommitted(detail = {}) {
    if (detail.cancel) {
      state.undo.pop();
      state.redo = state.pendingRedo || [];
    } else {
      recordActivity(
        state,
        state.pendingBefore || state.lastCheckpoint || checkpoint(),
        checkpoint(),
        detail,
      );
      state.revision++;
      state.lastAction = { actor: detail.actor || 'user', label: detail.label || '화면 편집' };
    }
    state.pendingBefore = null;
    state.lastCheckpoint = checkpoint();
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
    if (state.timeline)
      state.timeline.activeId = state.timeline.entries.some(
        (e) => e.id === previous.activeSnapshotId && !e.deletedAt,
      )
        ? previous.activeSnapshotId
        : null;
    recordActivity(state, to.at(-1), checkpoint(), {
      ...detail,
      label: direction === 'undo' ? '실행 취소' : '다시 실행',
    });
    state.lastCheckpoint = checkpoint();
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
      documentName: state.snapshot.documentName,
      edits: state.scene.edits,
      annotations: state.scene.annotations,
      timeline: state.timeline,
      activity: state.activity,
      activityHead: state.activityHead,
      note: getNote(),
      updatedAt: new Date().toISOString(),
    });
  }
  function prepareEditor({ allowTransaction = false } = {}) {
    if (state.transactionBusy && !allowTransaction)
      throw new Error('버전 이동이 끝난 뒤 다시 시도해 주세요.');
    if (state.scene?.drag || state.scene?.areaSelecting)
      throw new Error('드래그를 마친 뒤 다시 시도해 주세요.');
    if (state.snapshot && !state.ready)
      throw new Error('화면을 여는 중입니다. 잠시 후 다시 시도해 주세요.');
    commitCommentDraft();
  }
  async function flushEditor(options) {
    prepareEditor(options);
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
    prepareEditor,
    flush: saveQueue.flush,
  };
}
