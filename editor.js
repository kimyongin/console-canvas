import { createEditorCommands } from './ui/editor-commands.js';
import { createResourceRepair } from './ui/resource-repair.js';
import { resourceCandidates } from './resource-repair.js';
import { prepareCaptureScope } from './capture-scope.js';
import { hasCapturedPhoto } from './capture-reference.js';
import { createSourceComparison } from './ui/source-comparison.js';
import { createCaptureWorkspace } from './ui/capture-workspace.js';
import { captureAssessment } from './capture-status.js';
import { configureModelessInspector } from './ui/modeless-inspector.js';
import { cleanLayerNames } from './layer-names.js';
import { createSelectionToolbar } from './ui/selection-toolbar.js';
import { renderRecent, renderCaptureIssues } from './ui/react/lists.tsx';
import { buildHandoffImage } from './handoff-image.js';
import { withSceneCopy } from './scene-preview.js';
import { buildVisualContext } from './design-context.js';
import { renderTickets } from './ui/react/tickets.tsx';
import { exportDocument, importDocument } from './portable-document.js';
import { download } from './export.js';
import { captureFromDocument, workspaceReset } from './db.js';
import { cleanActivity } from './activity-history.js';
import { pointTarget } from './edit-commands.js';
import { createRequestsPanel } from './ui/requests-panel.js';
import { createToast } from './ui/toast.js';
import { createRenameDialog } from './ui/rename-dialog.js';
import { createDocumentSwitcher } from './ui/document-switcher.js';
import { createCommentEditor } from './ui/comment-editor.js';
import { createAreaSelection } from './ui/area-selection.js';
import { createClipboard } from './ui/clipboard.js';
import { createWorkspaceLayout } from './ui/workspace-layout.js';
import { createInspector } from './ui/inspector.js';
import { createDocumentLists } from './ui/document-lists.js';
import { createCanvasViewport } from './ui/canvas-viewport.js';
import {
  saveCapture,
  getDocument,
  getDocumentMetadata,
  listDocuments,
  cleanDocumentName,
} from './db.js';
import { createEditorSession } from './editor-session.js';
import { CanvasScene, copy, validateSnapshot } from './engine.js';
import { createEditorController } from './editor-controller.js';
import { createMcpBridge } from './bridge-client.js';
import { validateDocumentInput } from './document-input.js';
import {
  mountEditorShell,
  clearReact,
  renderSaveStatus,
  connectShellAdapter,
} from './ui/react/mount.tsx';
import { createEditorAdapter } from './ui/react/store.ts';
import { connectEditorCommands } from './ui/react/commands.ts';

mountEditorShell();
const $ = (selector) => document.querySelector(selector);
const state = {
  snapshot: null,
  scene: null,
  undo: [],
  redo: [],
  expanded: new Set(),
  zoom: 1,
  size: { width: 1280, height: 900 },
  saving: Promise.resolve(),
  generation: 0,
  commentTarget: null,
  mode: 'edit',
  activity: [],
  activityHead: null,
  ready: false,
  revision: 0,
  lastAction: null,
  lastSaveError: null,
  mcpStatus: { connected: false },
};
const editorId =
  globalThis.crypto?.randomUUID?.() ||
  'editor-' + Date.now() + '-' + Math.random().toString(36).slice(2);
const adapter = createEditorAdapter(() => ({
  documentId: state.snapshot?.id || null,
  generation: state.generation,
  revision: state.revision,
  ready: state.ready,
  selected: !!state.scene?.selected,
  selectedHidden: !!(state.scene?.selected && state.scene.hidden(state.scene.selected)),
  undoCount: state.undo.length,
  redoCount: state.redo.length,
  save: {
    pending: !!state.savePending,
    error: state.lastSaveError,
    message: state.saveMessage || '이 브라우저에 저장',
  },
}));
connectEditorCommands(adapter);
connectShellAdapter(adapter);
renderSaveStatus($('#save-status'), adapter);
const kinds = {
  text: '텍스트',
  pseudo: '생성된 문구',
  icon: '아이콘',
  raster: '이미지 레이어',
  element: '요소',
};
const toast = createToast({ $ });
const {
  checkpoint,
  applyCheckpoint,
  historyBefore,
  changeCommitted,
  undo,
  save,
  flushEditor,
  prepareEditor,
  flush,
} = createEditorSession({
  state,
  getNote: () => $('#review-note').value,
  setNote: (value) => {
    $('#review-note').value = value;
  },
  status: (message) => {
    state.saveMessage = message;
    $('#emergency-backup').hidden = !state.lastSaveError;
    state.savePending = message === '저장 중…';
    adapter.publish();
  },
  commitCommentDraft,
  render: () => {
    adapter.publish();
    renderInspector();
    renderLayers();
    activityPanel.render();
    renderHistory();
    renderMcpStatus();
  },
});
const { panels, setPanelVisibility, snapshotLayout, restoreLayout } = createWorkspaceLayout({
  $,
  commitCommentDraft,
});
function editSafely(action) {
  try {
    action();
  } catch (error) {
    toast(error.message);
    renderInspector();
  }
}
function notice(message) {
  $('#notice').textContent = message;
  $('#notice').hidden = !message;
}
function renderHistory() {
  $('#undo').disabled = !state.undo.length;
  $('#redo').disabled = !state.redo.length;
}
function commitCommentDraft() {
  if (state.scene && state.commentTarget)
    state.scene.setComment(state.commentTarget, $('#component-comment').value);
}
const { sizeChanged, zoomTo, fit, fitSelection } = createCanvasViewport({ $, state });
const renameDialog = createRenameDialog({ $ });
createDocumentSwitcher({
  $,
  state,
  openSnapshot,
  commitCommentDraft,
  flushEditor,
  closeDocument,
  renameCurrent,
  renameDialog,
  toast,
});
function renameCurrent(name) {
  state.snapshot.documentName = name;
  renderDocumentName();
  save();
}
function renderDocumentName() {
  const name = state.snapshot?.documentName || state.snapshot?.source.title || '문서 열기';
  $('#source-title').textContent = name;
  $('#document-title').textContent = name;
  $('#document-menu-button').title = name;
  for (const button of document.querySelectorAll('[data-current-document]'))
    button.disabled = !state.snapshot;
  $('#artboard-label').textContent = state.snapshot
    ? name + ' / ' + state.snapshot.source.viewport.width + ' px'
    : '';
}
function closeDocument(id) {
  const next = opening
    .catch(() => {})
    .then(async () => {
      if (state.snapshot?.id !== id) return;
      state.ready = false;
      state.desktopConnection = await mcpBridge.suspend();
      areaSelection.reset();
      clipboard.reset();
      commentEditor.reset();
      state.snapshot = null;
      editorCommands.reset();
      state.scene = null;
      state.activity = [];
      state.activityHead = null;
      activityPanel.render();
      state.commentTarget = null;
      state.undo = [];
      state.redo = [];
      state.expanded = new Set();
      state.revision++;
      state.generation++;
      $('#scene-frame').srcdoc = '';
      $('#welcome').hidden = false;
      $('#artboard-space').hidden = true;
      $('#export-button').disabled = true;
      $('#source-url').hidden = true;
      $('#source-meta').textContent = '편집할 화면을 열어 주세요.';
      $('#review-note').value = '';
      clearReact($('#layers'));
      $('#layer-count').textContent = '0';
      state.saveMessage = '휴지통에 보관됨';
      adapter.publish();
      renderDocumentName();
      renderInspector();
      renderHistory();
      renderRecentDocuments();
    });
  opening = next;
  return next;
}
const areaSelection = createAreaSelection({ $, state, toast });
const clipboard = createClipboard({ $, state, toast, commitCommentDraft, adapter });
const { renderInspector: renderInspectorView } = createInspector({ $, state, kinds, selectNode });
const selectionToolbar = createSelectionToolbar({ $, state, selectNode });
configureModelessInspector({ $ });
function renderCaptureStatus() {
  const assessment = captureAssessment(
    state.snapshot,
    state.scene?.elements,
    state.scene?.resourceRepairs,
  );
  $('#capture-status-button').textContent = assessment.label;
  $('#capture-status-button').classList.toggle(
    'needs-review',
    assessment.remaining_counts.loss > 0,
  );
  $('#capture-status-summary').textContent = assessment.items.length
    ? '수집 확인 ' +
      assessment.counts.loss +
      '건 · 편집 제약 ' +
      assessment.counts.constraint +
      '건 · 참고 ' +
      assessment.counts.info +
      '건'
    : '기록된 수집 제한 없음 · 시각 비교 전';
  $('#capture-repair-summary').textContent =
    '아직 확인할 수집 기록 ' +
    assessment.remaining_counts.loss +
    '건 · 자산 복구 ' +
    assessment.applied_resource_count +
    '개 적용. 원본 수집 기록은 유지합니다.';
  const source = state.snapshot?.source;
  $('#capture-status-scope').textContent = source
    ? '가져온 문서 ' +
      source.width +
      ' × ' +
      source.height +
      'px · 원본 화면 ' +
      source.viewport.width +
      ' × ' +
      source.viewport.height +
      'px. ' +
      (state.snapshot.captureScope?.mode && state.snapshot.captureScope.mode !== 'document'
        ? '선택 범위 ' +
          state.snapshot.captureScope.rect.width +
          ' × ' +
          state.snapshot.captureScope.rect.height +
          'px · 범위 밖은 편집 대상이 아닙니다. 레이아웃 유지를 위한 주변 DOM은 포함될 수 있습니다.'
        : '화면 밖 미렌더링 내용은 포함되지 않습니다.')
    : '';
  $('#capture-status-empty').hidden = assessment.items.length > 0;
  renderCaptureIssues($('#capture-status-list'), assessment.items, (id) => {
    $('#capture-status-dialog').close();
    selectNode(id, { reveal: true });
    fitSelection();
    $('#capture-status-button').focus();
  });
  const candidates = resourceCandidates(state.snapshot, state.scene.resourceRepairs);
  $('#repair-assets-button').disabled =
    !window.ConsoleCanvasDesktop?.retryAssets || !candidates.length;
  $('#repair-assets-note').textContent = !window.ConsoleCanvasDesktop?.retryAssets
    ? '이미지·폰트 다시 읽기는 내장 앱에서 사용할 수 있습니다.'
    : candidates.length
      ? '다시 읽을 수 있는 이미지·폰트 주소 ' +
        candidates.length +
        '개 · 실제 사진과 비교한 뒤 필요할 때 사용하세요.'
      : '다시 읽을 수 있는 미복구 자산 선언이 없습니다.';
  $('#source-compare-button').disabled = !hasCapturedPhoto(state.snapshot);
  $('#direct-source-compare').disabled = !hasCapturedPhoto(state.snapshot);
  $('#direct-source-compare').title = hasCapturedPhoto(state.snapshot)
    ? '가져오기 당시 실제 사진과 비교'
    : '저장된 실제 원본 사진이 없습니다.';
  $('#source-compare-unavailable').hidden = hasCapturedPhoto(state.snapshot);
  const desktop = !!window.ConsoleCanvasDesktop;
  $('#capture-source-button').hidden = !desktop;
  $('#capture-source-note').hidden = !desktop;
}
const captureWorkspace = createCaptureWorkspace({
  $,
  state,
  adapter,
  renderStatus: renderCaptureStatus,
});
adapter.register('capture-status', () => {
  if (!state.ready) return;
  renderCaptureStatus();
  captureWorkspace.show('info');
});
$('#capture-source-button').addEventListener('click', () => {
  $('#capture-status-dialog').close();
  window.ConsoleCanvasDesktop?.showSource();
});
function renderInspector() {
  renderInspectorView();
  selectionToolbar.position();
  if (!state.scene?.selected && $('#properties-dialog').open) $('#properties-dialog').close();
  adapter.publish();
}
function selectNode(id, { reveal = false, additive = false } = {}) {
  if (!state.scene) return;
  state.scene.select(id, { additive });
  for (const parent of state.scene.ancestors(id)) state.expanded.add(parent);
  renderLayers();
  if (reveal) {
    const r = state.scene.rect(id);
    if (r) {
      $('#viewport').scrollTo({
        left: Math.max(0, (r.x - state.scene.viewRect().x) * state.zoom - 100),
        top: Math.max(0, (r.y - state.scene.viewRect().y) * state.zoom - 100),
        behavior: 'smooth',
      });
    }
  }
}
const { renderLayers, restoreNavigation } = createDocumentLists({
  $,
  state,
  adapter,
  selectNode,
  renameLayer: (id) => {
    selectNode(id, { reveal: true });
    adapter.dispatch('properties');
    $('.inspector-details').open = true;
    $('.layer-alias-editor').open = true;
    $('#layer-alias').focus();
    $('#layer-alias').select();
  },
});
const commentEditor = createCommentEditor({
  $,
  state,
  commit: commitCommentDraft,
  flushEditor,
});
function focusComment(options = {}) {
  commentEditor.open(options);
}
createSourceComparison({ $, state, adapter, commitCommentDraft, workspace: captureWorkspace });
createResourceRepair({
  $,
  state,
  adapter,
  workspace: captureWorkspace,
  commitCommentDraft,
  historyBefore,
  changeCommitted,
  toast,
});
const activityPanel = createRequestsPanel({ $, state, selectNode, focusComment });
function onKey(event) {
  if (event.defaultPrevented) return;
  if (editorCommands.handle(event)) return;
  if (!state.scene || document.querySelector('dialog:modal')) return;
  if (state.scene.areaSelecting) return;
  const editing = event.target.closest?.('input,textarea,select');
  if (editing && event.target.ownerDocument === document) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    undo(event.shiftKey ? 'redo' : 'undo');
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    undo('redo');
    return;
  }
  if (event.key === 'Escape') {
    setMode('edit');
    state.scene.select(null);
    renderLayers();
    return;
  }
  if (state.mode === 'comment') return;
  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (state.scene.selected) {
      event.preventDefault();
      state.scene.remove();
    }
    return;
  }
  const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
    event.key
  ];
  if (delta && state.scene.selected) {
    event.preventDefault();
    editSafely(() =>
      state.scene.nudge(delta[0] * (event.shiftKey ? 10 : 1), delta[1] * (event.shiftKey ? 10 : 1)),
    );
  }
}
let opening = Promise.resolve();
function openSnapshot(...args) {
  const next = opening.catch(() => {}).then(() => openDocument(...args));
  opening = next;
  return next;
}
async function openDocument(snapshot, edits = {}, note = '', annotations = {}) {
  snapshot = prepareCaptureScope(snapshot);
  validateDocumentInput(snapshot, edits, annotations);
  if (typeof note !== 'string' || note.length > 12000)
    throw new Error('추가 설명 형식이 올바르지 않습니다.');
  const existingMeta = await getDocumentMetadata(snapshot.id);
  if (existingMeta?.deletedAt)
    throw new Error('휴지통에 있는 문서입니다. 문서 목록의 휴지통에서 먼저 복구해 주세요.');

  await flushEditor();
  const outgoingRevision = state.revision,
    outgoingNote = $('#review-note').value,
    outgoingComment = $('#component-comment').value;
  const documentName = snapshot.documentName
    ? cleanDocumentName(snapshot.documentName)
    : existingMeta?.title && existingMeta.title !== snapshot.source.title
      ? existingMeta.title
      : undefined;
  await saveCapture({ ...snapshot, ...(documentName ? { documentName } : {}) });
  if (
    state.revision !== outgoingRevision ||
    $('#review-note').value !== outgoingNote ||
    $('#component-comment').value !== outgoingComment
  )
    await flushEditor();
  // Close callbacks must already belong to an obsolete document generation.
  // Keep the current task open if saving the incoming capture fails.
  const generation = ++state.generation;
  areaSelection.reset();
  clipboard.reset();
  commentEditor.reset();
  for (const id of [
    '#capture-status-dialog',
    '#properties-dialog',
    '#tickets-dialog',
    '#rename-dialog',
  ])
    if ($(id).open) $(id).close();
  commitCommentDraft();
  state.commentTarget = null;
  state.ready = false;
  // A long-poll may still advertise the preceding document after a switch.
  // Withdraw it before replacing the scene, then reconnect with fresh metadata.
  state.desktopConnection = (await mcpBridge.suspend()) || state.desktopConnection;
  state.revision++;
  $('#welcome').hidden = true;
  $('#artboard-space').hidden = false;
  $('#export-button').disabled = true;
  const storedCodePatches = snapshot.resourceRepairs;
  const storedLayerNames = snapshot.layerNames;
  const capture = captureFromDocument(snapshot);
  state.project_id = snapshot.project_id || defaultProject(snapshot.source.url);
  $('#project-id').value = state.project_id;
  state.snapshot = {
    ...capture,
    layerNames: cleanLayerNames(storedLayerNames),
    ...(documentName ? { documentName } : {}),
  };
  state.activity = cleanActivity(snapshot.activity);
  state.activityHead = snapshot.activityHead || null;
  state.lastCheckpoint = null;
  state.pendingBefore = null;
  state.undo = [];
  state.redo = [];
  state.expanded = new Set(snapshot.nodes.filter((node) => !node.parentId).map((node) => node.id));
  restoreNavigation();
  renderDocumentName();
  $('#source-url').textContent = snapshot.source.url;
  try {
    const url = new URL(snapshot.source.url);
    $('#source-url').href = /^https?:$/.test(url.protocol) ? url.href : '#';
  } catch {
    $('#source-url').href = '#';
  }
  $('#source-url').hidden = false;
  $('#source-meta').textContent =
    snapshot.source.viewport.width +
    ' × ' +
    snapshot.source.viewport.height +
    ' · ' +
    snapshot.nodes.length.toLocaleString() +
    '개 요소';
  $('#review-note').value = note;
  const scene = new CanvasScene($('#scene-frame'), snapshot, {
    smartSelection: true,
    onAreaStart: areaSelection.beginScene,
    onMessage: toast,
    onSelect: (id) => {
      $('#document-menu-content').hidePopover();
      if (id !== state.commentTarget) {
        commitCommentDraft();
        commentEditor.reset();
      }
      if (state.scene && id)
        for (const parent of state.scene.ancestors(id)) state.expanded.add(parent);
      renderInspector();
      renderLayers();
      activityPanel.render();
    },
    onCommentSelect: (id) => focusComment({ id }),
    onSize: sizeChanged,
    onBeforeChange: historyBefore,
    onLiveChange: () => {
      renderInspector();
      commentEditor.position();
    },
    onCommit: changeCommitted,
    onKey,
  });
  state.scene = scene;
  scene.snapshot.layerNames = state.snapshot.layerNames;
  try {
    await scene.mount();
    areaSelection.bind(scene);
    clipboard.bindScene(scene);
    if (generation !== state.generation) return;
    scene.interactionMode = state.mode;
    scene.setResourceRepairs(storedCodePatches || []);
    scene.setEdits(edits);
    scene.setComments(annotations);
    fit(() => {
      if (generation !== state.generation) return;
      $('#viewport').scrollLeft = (snapshot.source.scroll?.x || 0) * state.zoom;
      $('#viewport').scrollTop = (snapshot.source.scroll?.y || 0) * state.zoom;
    });
    renderInspector();
    renderLayers();
    activityPanel.render();
    renderHistory();
    $('#export-button').disabled = false;
    renderCaptureStatus();
    state.lastCheckpoint = checkpoint();
    activityPanel.render();
    state.ready = true;
    adapter.publish();
    connectDesktopIfReady();
    renderMcpStatus();
    save();
    toast('화면을 가져왔어요. 요소를 옮기거나 주석으로 수정 방향을 남겨 보세요.');
  } catch (error) {
    state.snapshot = null;
    state.scene = null;
    state.ready = false;
    notice(error.message);
    $('#welcome').hidden = false;
    $('#artboard-space').hidden = true;
    throw error;
  }
}
async function loadSample() {
  const button = $('#sample-button');
  button.disabled = true;
  button.textContent = '콘솔 화면을 가져오는 중…';
  let source;
  try {
    if (window.CONSOLE_CANVAS_SAMPLE) {
      await openSnapshot(copy(window.CONSOLE_CANVAS_SAMPLE));
      return;
    }
    source = document.createElement('iframe');
    source.width = '1360';
    source.height = '980';
    source.style.cssText = 'position:fixed;left:-20000px;top:0;width:1360px;height:980px;border:0';
    source.src = 'fixtures/console.html';
    const loaded = new Promise((resolve, reject) => {
      source.onload = resolve;
      source.onerror = () => reject(new Error('샘플 화면을 열지 못했습니다.'));
    });
    document.body.append(source);
    await loaded;
    const snapshot = await globalThis.UICloneCapture.capture(source.contentDocument);
    await openSnapshot(snapshot);
  } catch (error) {
    notice(error.message);
  } finally {
    source?.remove();
    button.disabled = false;
    button.textContent = '샘플 콘솔로 시작 →';
  }
}
async function importFile(file) {
  if (!file) return;
  if (file.size > 85_000_000)
    throw new Error('파일이 너무 큽니다. 85MB 이하의 화면 파일을 선택해 주세요.');
  const data = JSON.parse(await file.text());
  if (data.format) {
    const doc = await importDocument(data);
    await openSnapshot(doc, doc.edits, doc.note || '', doc.annotations || {});
  } else await openSnapshot(data, data.edits || {}, data.note || '', data.annotations || {});
}
$('#file-input').addEventListener('change', (event) => {
  importFile(event.target.files[0]).catch((error) =>
    notice('파일을 열지 못했습니다: ' + error.message),
  );
  event.target.value = '';
});
for (const id of ['#import-button', '#welcome-import'])
  $(id).addEventListener('click', () => {
    $('#document-menu-content').hidePopover();
    $('#file-input').click();
  });
$('#installation-button').addEventListener('click', () => {
  $('#import-guide').hidden = !$('#import-guide').hidden;
});
$('#sample-button').addEventListener('click', loadSample);
$('#layer-search').addEventListener('input', renderLayers);
$('#major-layers').addEventListener('change', renderLayers);
$('#snap-enabled').addEventListener('change', (event) => {
  if (state.scene) state.scene.snapEnabled = event.target.checked;
});
for (const button of document.querySelectorAll('[data-align]'))
  button.addEventListener('click', () =>
    editSafely(() => state.scene?.align(button.dataset.align)),
  );
$('#zoom-selection').addEventListener('click', fitSelection);
$('#component-comment').addEventListener('change', commitCommentDraft);
$('#save-comment').addEventListener('click', renderInspector);
$('#clear-comment').addEventListener('click', () => {
  $('#component-comment').value = '';
  $('#clear-comment').disabled = true;
  commitCommentDraft();
  renderInspector();
});
function setMode() {
  commitCommentDraft();
  commentEditor.reset();
  state.mode = 'edit';
  if (state.scene) {
    state.scene.interactionMode = 'edit';
    state.scene.drawSelection();
  }
  renderInspector();
}
$('#edit-selected-comment').addEventListener('click', () => {
  $('#properties-dialog').close();
  focusComment();
});
adapter.register('comment', () => {
  const ids = [...(state.scene?.selection || [])];
  if (ids.length > 1) commentEditor.open({ ids });
  else focusComment();
});
adapter.register('properties', () => {
  if (!state.scene?.selected) return;
  commitCommentDraft();
  renderInspector();
  $('#properties-dialog').show();
});
async function setLayerAlias(clear = false) {
  const id = state.scene?.selected;
  if (!id) return;
  const name = clear ? '' : $('#layer-alias').value.trim();
  if (name.length > 120) return toast('별칭은 120자 이내로 입력해 주세요.');
  const aliases = { ...state.snapshot.layerNames };
  if (name) aliases[id] = name;
  else delete aliases[id];
  state.snapshot.layerNames = aliases;
  state.scene.snapshot.layerNames = aliases;
  state.revision++;
  renderInspector();
  renderLayers();
  try {
    await flushEditor();
    toast(name ? '레이어 별칭을 저장했습니다.' : '기본 레이어 이름을 사용합니다.');
  } catch (error) {
    toast(error.message);
  }
}
$('#save-layer-alias').addEventListener('click', () => setLayerAlias());
$('#clear-layer-alias').addEventListener('click', () => setLayerAlias(true));
$('#close-properties').addEventListener('click', () => $('#properties-dialog').close());
$('#properties-dialog').addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !e.isComposing) {
    e.preventDefault();
    e.stopPropagation();
    $('#properties-dialog').close();
  }
});
adapter.register('undo', () => undo());
adapter.register('redo', () => undo('redo'));
$('#select-parent').addEventListener('click', () =>
  selectNode(state.scene.parent(state.scene.selected)),
);
adapter.register('delete', () => state.scene?.remove());
$('#inspector-delete').addEventListener('click', () => state.scene?.remove());
for (const button of document.querySelectorAll('[data-nudge]'))
  button.addEventListener('click', () => {
    const delta = { left: [-8, 0], up: [0, -8], down: [0, 8], right: [8, 0] }[button.dataset.nudge];
    editSafely(() => state.scene?.nudge(...delta));
  });
for (const id of ['#offset-x', '#offset-y'])
  $(id).addEventListener('change', () =>
    editSafely(() =>
      (() => {
        if (!state.scene) return;
        state.scene.editCategory = 'property';
        try {
          state.scene.setPosition(Number($('#offset-x').value), Number($('#offset-y').value));
        } finally {
          state.scene.editCategory = null;
        }
      })(),
    ),
  );
$('#zoom').addEventListener('change', (event) => zoomTo(Number(event.target.value)));
$('#zoom-in').addEventListener('click', () => zoomTo(state.zoom + 0.1));
$('#zoom-out').addEventListener('click', () => zoomTo(state.zoom - 0.1));
$('#fit').addEventListener('click', fit);
$('#viewport').addEventListener(
  'wheel',
  (event) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      zoomTo(state.zoom + (event.deltaY > 0 ? -0.05 : 0.05), {
        x: event.clientX,
        y: event.clientY,
      });
    }
  },
  { passive: false },
);
document.addEventListener('keydown', onKey);
$('#review-note').addEventListener('change', () => changeCommitted({ label: '추가 설명 수정' }));
async function imageResult() {
  return withSceneCopy(state.snapshot, checkpoint(), (scene) =>
    buildHandoffImage(state.snapshot, scene, $('#review-note').value),
  );
}
async function blobUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
function defaultProject(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === 'null'
      ? parsed.protocol + '//' + (parsed.host || 'local-project')
      : parsed.origin;
  } catch {
    return 'local-project';
  }
}
function showTickets(create = false) {
  if (!state.ready) return;
  commitCommentDraft();
  const generation = state.generation;
  const selected = [...state.scene.selection];
  const requested = state.scene
    .comments()
    .filter(
      (c) =>
        !selected.length ||
        selected.some((id) => id === c.id || state.scene.ancestors(c.id).includes(id)),
    )
    .map((c) => c.text);
  const goalRequest = [$('#review-note').value, ...requested].filter((v) => v?.trim()).join('\n\n');
  renderTickets($('#tickets-content'), {
    project: state.project_id,
    documentId: state.snapshot.id,
    title: state.snapshot.documentName || state.snapshot.source.title,
    note: goalRequest,
    source: state.snapshot.source,
    annotations: copy(state.scene.annotations),
    selection: [...state.scene.selection],
    create,
    capture: async () => {
      const revision = state.revision;
      const image = await imageResult();
      if (generation !== state.generation || revision !== state.revision)
        throw Error('화면이 변경되었습니다. 다시 등록해 주세요.');
      return blobUrl(image.blob);
    },
    close: () => $('#tickets-dialog').close(),
    changed: () => {
      state.ticketRevision = (state.ticketRevision || 0) + 1;
    },
  });
  $('#tickets-dialog').showModal();
}
adapter.register('tickets', () => showTickets());
adapter.register('new-ticket', () => showTickets(true));
$('#project-id').addEventListener('change', async () => {
  const key = $('#project-id').value.trim();
  if (!key) {
    $('#project-id').value = state.project_id;
    return;
  }
  state.project_id = key;
  state.revision++;
  await flushEditor();
  toast('이 문서의 프로젝트를 설정했습니다. 기존 티켓의 프로젝트는 유지됩니다.');
});
$('#duplicate-document').addEventListener('click', async () => {
  try {
    await flushEditor();
    const doc = {
      ...copy(state.snapshot),
      id: crypto.randomUUID(),
      project_id: state.project_id,
      documentName:
        (state.snapshot.documentName || state.snapshot.source.title).slice(0, 115) + ' 복사본',
      resourceRepairs: copy(state.scene.resourceRepairs),
    };
    await openSnapshot(
      doc,
      copy(state.scene.edits),
      $('#review-note').value,
      copy(state.scene.annotations),
    );
    toast('독립 문서를 만들었습니다. 기존 티켓은 복제하지 않습니다.');
  } catch (e) {
    toast(e.message);
  }
});
$('#export-button').addEventListener('click', async () => {
  const button = $('#export-button');
  button.disabled = true;
  try {
    prepareEditor();
    await download('console-canvas-goal.png', (await imageResult()).blob);
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = !state.ready;
  }
});
$('#save-document').addEventListener('click', async () => {
  try {
    prepareEditor();
    await flushEditor().catch(() =>
      notice('자동 저장에 실패했습니다. 현재 메모리의 작업을 편집 파일로 저장합니다.'),
    );
    const value = await exportDocument(state.snapshot, checkpoint(), state.project_id, {
      allowPartial: true,
    });
    const result = await download(
      'console-canvas-document.json',
      JSON.stringify(value),
      'application/json',
    );
    if (!result.canceled)
      toast(value.backupWarnings?.join(' ') || '현재 문서와 티켓의 편집 파일 저장을 요청했습니다.');
  } catch (error) {
    toast(error.message);
  }
});
const exportDialog = {
  copyCurrentImage: async () => {
    const image = await imageResult();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': image.blob })]);
    toast('전달 이미지를 복사했습니다.');
  },
};
const editorCommands = createEditorCommands({
  $,
  state,
  adapter,
  panels,
  setPanelVisibility,
  snapshotLayout,
  restoreLayout,
  flushEditor,
  renameDialog,
  toast,
  copyImage: () => exportDialog.copyCurrentImage(),
  setAlias: async (id, name) => {
    if (!state.scene?.nodes.has(id)) throw Error('요소를 찾을 수 없습니다.');
    state.scene.select(id);
    $('#layer-alias').value = name;
    await setLayerAlias();
  },
});
for (const id of ['#offset-x', '#offset-y'])
  $(id).addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    }
  });
window.addEventListener('dragover', (event) => {
  if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
});
window.addEventListener('drop', (event) => {
  if (event.dataTransfer?.files.length) {
    event.preventDefault();
    if (document.querySelector('dialog:modal')) {
      toast('열린 창을 닫고 파일을 가져와 주세요.');
      return;
    }
    importFile(event.dataTransfer.files[0]).catch((error) => notice(error.message));
  }
});
function renderMcpStatus() {
  const status = state.mcpStatus;
  $('#mcp-disconnect').disabled = !status.connected;
  $('#mcp-disconnect').title = status.connected
    ? '이 복제본의 연결 끊기'
    : '연결된 로컬 서버가 없습니다.';
  $('#mcp-button').textContent = status.connected ? '● 로컬 서버 연결됨' : '○ 에이전트 연결';
  $('#mcp-button').title =
    '서버 연결과 에이전트 인증은 다릅니다.' +
    (state.lastAgentCommand
      ? ' 최근 에이전트 통신: ' + state.lastAgentCommand
      : ' 이 실행에서 에이전트 명령 수신 기록 없음');
  $('#mcp-button').classList.toggle('connected', !!status.connected);
  $('#mcp-state').textContent =
    (status.connected
      ? '로컬 서버 연결됨 · r' + state.revision
      : status.message || 'MCP 연결 안 됨') +
    (state.lastAction
      ? ' · ' +
        (state.lastAction.actor === 'agent' ? '에이전트' : '직접 편집') +
        ' ' +
        state.lastAction.label
      : '');
}
const controller = createEditorController({
  state,
  editorId,
  checkpoint,
  applyCheckpoint,
  historyBefore,
  changeCommitted,
  undo,
  buildDesignContext: () =>
    withSceneCopy(state.snapshot, checkpoint(), (scene) => buildVisualContext(scene, checkpoint())),
  buildHandoffImage: imageResult,
  captureGoal: async () => blobUrl((await imageResult()).blob),
  isBusy: () =>
    !!state.transactionBusy ||
    !!document.querySelector('dialog:modal') ||
    !!document.activeElement?.closest('#properties-dialog input') ||
    !!(
      state.commentTarget &&
      $('#component-comment').value.trim() !== (state.scene?.annotations[state.commentTarget] || '')
    ),
  render: () => {
    renderInspector();
    renderLayers();
    activityPanel.render();
    renderHistory();
  },
  flush: async () => {
    await flush();
    return true;
  },
});
const mcpBridge = createMcpBridge({
  metadata: controller.metadata,
  execute: controller.execute,
  onStatus: (status) => {
    state.mcpStatus = status;
    if (status.agent_command)
      state.lastAgentCommand =
        new Date().toLocaleTimeString('ko-KR') + ' · ' + status.agent_command;
    renderMcpStatus();
  },
});
$('#mcp-button').addEventListener('click', () => {
  $('#mcp-dialog').showModal();
  if (!state.mcpStatus.connected) $('#mcp-code').focus();
});
$('#direct-open-source').addEventListener('click', () => {
  $('#document-menu-content').hidePopover();
  if (!state.snapshot) return;
  if (window.ConsoleCanvasDesktop)
    window.ConsoleCanvasDesktop.openSource(state.snapshot.source.url).catch((error) =>
      notice(error.message),
    );
  else window.open(state.snapshot.source.url, '_blank', 'noopener,noreferrer');
});
$('#emergency-backup').addEventListener('click', () => $('#save-document').click());
$('#mcp-connect').addEventListener('click', async () => {
  const button = $('#mcp-connect');
  button.disabled = true;
  try {
    commitCommentDraft();
    await mcpBridge.connect($('#mcp-address').value.trim(), $('#mcp-code').value.trim());
    $('#mcp-code').value = '';
    $('#mcp-dialog').close();
  } catch (error) {
    $('#mcp-message').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
$('#mcp-disconnect').addEventListener('click', async () => {
  await mcpBridge.disconnect();
  $('#mcp-dialog').close();
});
if (window.ConsoleCanvasDesktop) {
  document.body.classList.add('desktop-editor');
  const tools = $('.canvas-toolbar');
  tools.setAttribute('role', 'toolbar');
  tools.setAttribute('aria-label', '편집 도구');
  const actions = $('.header-actions');
  actions.setAttribute('role', 'group');
  actions.setAttribute('aria-label', '목표 티켓과 전달 이미지');
  $('.canvas-tools').append(actions);
  $('#recapture-button').hidden = false;
  $('#recapture-button').addEventListener('click', () =>
    state.snapshot?.source.application
      ? window.ConsoleCanvasDesktop.openSource(state.snapshot.source.url).catch((error) =>
          notice(error.message),
        )
      : window.ConsoleCanvasDesktop.showSource(),
  );
  $('#source-url').addEventListener('click', (event) => {
    event.preventDefault();
    window.ConsoleCanvasDesktop.openSource(state.snapshot.source.url).catch((error) =>
      notice(error.message),
    );
  });
  $('#installation-button').textContent = '웹사이트에서 화면 가져오기';
  $('#installation-button').addEventListener('click', () =>
    window.ConsoleCanvasDesktop.showSource(),
  );
  $('.app-header').hidden = true;
  window.ConsoleCanvasDesktop.onHistory((command) => {
    if (document.activeElement?.closest('input,textarea,[contenteditable="true"]')) {
      document.execCommand(command);
      return;
    }
    if (
      !state.ready ||
      state.scene?.drag ||
      state.scene?.areaSelecting ||
      document.querySelector('dialog:modal')
    )
      return;
    commitCommentDraft();
    undo(command);
  });
  window.ConsoleCanvasDesktop.onFlush(async () => {
    return flushEditor();
  });
  window.ConsoleCanvasDesktop.onSnapshot(async (value) => {
    try {
      await openSnapshot(value);
      return { ok: true };
    } catch (error) {
      notice(error.message);
      return { ok: false, message: error.message };
    }
  });
  window.ConsoleCanvasDesktop.getConnection()
    .then((connection) => {
      if (connection) {
        state.desktopConnection = connection;
        connectDesktopIfReady();
      }
    })
    .catch((error) => notice(error.message));
}
const params = new URLSearchParams(location.search);
if (params.has('error')) notice(params.get('error'));
if (params.has('id'))
  getDocument(params.get('id'))
    .then((value) => {
      if (!value)
        throw new Error(
          workspaceReset
            ? '0.45 전환으로 이전 테스트 자료를 초기화했습니다. 웹사이트에서 새 화면을 가져와 주세요.'
            : '저장된 화면을 찾을 수 없습니다. 웹사이트에서 다시 가져와 주세요.',
        );
      return openSnapshot(value, value.edits, value.note, value.annotations);
    })
    .catch((error) => notice(error.message));
else if (params.has('sample')) loadSample();
else renderRecentDocuments();
async function renderRecentDocuments() {
  try {
    const values = await listDocuments();
    renderRecent($('#recent-documents'), values, (id) =>
      getDocument(id)
        .then((value) => {
          if (!value) throw new Error('문서를 찾을 수 없습니다. 휴지통을 확인해 주세요.');
          return openSnapshot(value, value.edits, value.note, value.annotations);
        })
        .catch((error) => notice(error.message)),
    );
  } catch (error) {
    notice(error.message);
  }
}
// Exposed for the local integration harness; contains only this editor's current document.
window.ConsoleCanvas = {
  state,
  adapter,
  openSnapshot,
  closeDocument,
  importFile,
  undo,
  selectNode,
  controller,
  checkpoint,
  flushEditor,
  showTickets,
  buildHandoffImage: imageResult,
  exportDocument: (options) =>
    exportDocument(state.snapshot, checkpoint(), state.project_id, options),
};
function connectDesktopIfReady() {
  if (state.desktopConnection && state.ready && !mcpBridge.isConnected()) {
    const connection = state.desktopConnection;
    state.desktopConnection = null;
    mcpBridge.connect(connection.url, connection.token).catch((error) => notice(error.message));
  }
}
