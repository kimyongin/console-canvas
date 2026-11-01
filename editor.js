import { createProjectWorkflow } from './ui/project-workflow.js';
import { updateProject, getProject, listProjects, activeProject } from './project-model.js';
import { createTicketWorkspace } from './ticket-workspace.js';
import { isComposingKey } from './ui/keyboard.js';
import { getTicket, confirmTicketGoal } from './ticket-model.js';
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
state.writerId = editorId;
const adapter = createEditorAdapter(() => ({
  documentId: state.snapshot?.id || null,
  ticketDisplayId: state.ticket?.display_id || '',
  ticketStatus: state.ticket?.status || '',
  goalConfirmed: !!state.ticket?.goal,
  needsReconfirmation: !!state.ticket?.needs_reconfirmation,
  emptyCapture: !!state.snapshot?.source.empty,
  generation: state.generation,
  revision: state.revision,
  ready: state.ready,
  selected: !!state.scene?.selected,
  selectedHidden: !!(state.scene?.selected && state.scene.hidden(state.scene.selected)),
  undoCount: state.undo.length,
  redoCount: state.redo.length,
  confirming: !!state.confirming,
  revisionRequested: !!state.ticket?.revision_requested,
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
let noteBaseline = '',
  noteTimer,
  noteComposing = false;
let commentEditor = null;
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
    noteBaseline = value;
  },
  status: (message) => {
    state.saveMessage = message;
    $('#emergency-backup').hidden = !state.lastSaveError;
    state.savePending = message === '저장 중…';
    if (message === '자동 저장 완료') void refreshTicket();
    adapter.publish();
    state.publishWorkspace?.();
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
  if (noteComposing || commentEditor?.isComposing())
    throw Error('한글 입력을 마친 뒤 다시 시도해 주세요.');
  commitNoteDraft();
  if (state.scene && state.commentEditing && state.commentTarget)
    state.scene.setComment(state.commentTarget, $('#component-comment').value);
}
const { sizeChanged, zoomTo, fit, fitSelection } = createCanvasViewport({ $, state });
const renameDialog = createRenameDialog({ $ });
createDocumentSwitcher({
  $,
  state,
  flushEditor,
  closeDocument,
  refresh: refreshTicket,
  toast,
  renameDialog,
});
function renderDocumentName() {
  const name = state.ticket
    ? state.ticket.display_id + ' · ' + (state.snapshot?.documentName || state.ticket.title)
    : '웹사이트에서 화면을 가져오세요';
  $('#source-title').textContent = name;
  $('#document-menu-button').title = name;
  renderTicketIdentity();
  for (const button of document.querySelectorAll('[data-current-document]'))
    button.disabled = !state.snapshot;
  $('#artboard-label').textContent = state.snapshot
    ? '원본 · ' + state.snapshot.source.title + ' · ' + state.snapshot.source.viewport.width + ' px'
    : '';
}
function closeDocument(id = state.snapshot?.id) {
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
      state.ticket = null;
      const route = new URL(location.href);
      route.searchParams.delete('id');
      route.searchParams.delete('sample');
      history.replaceState(null, '', route);
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
      connectDesktopIfReady();
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
  $('#capture-status-button').hidden =
    assessment.remaining_counts.loss === 0 && assessment.remaining_counts.constraint === 0;
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
    ($('#capture-status-button').hidden ? $('#viewport') : $('#capture-status-button')).focus();
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
  $('#direct-source-compare').hidden = !hasCapturedPhoto(state.snapshot);
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
  $('#document-menu-content').hidePopover();
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
commentEditor = createCommentEditor({
  $,
  state,
  commit: commitCommentDraft,
  flushEditor,
  revealPanel: () => setPanelVisibility('properties', true),
  renderRequests: () => activityPanel.render(),
});
state.resetComment = commentEditor.reset;
function focusComment(options = {}) {
  try {
    commentEditor.open(options);
  } catch (e) {
    toast(e.message);
  }
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
  if (event.defaultPrevented || isComposingKey(event)) return;
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
  if (!snapshot.project_id && !existingMeta) {
    const p = await projectWorkflow.ensure(state.project_id);
    snapshot = { ...snapshot, project_id: p.id };
  }
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
  state.revision = snapshot.edit_revision || 0;
  state.storageRevision = snapshot.storage_revision || 0;
  state.ticket = await getTicket(snapshot.id);
  $('#welcome').hidden = true;
  $('#artboard-space').hidden = false;
  $('#export-button').disabled = true;
  const storedCodePatches = snapshot.resourceRepairs;
  const storedLayerNames = snapshot.layerNames;
  const capture = captureFromDocument(snapshot);
  state.project_id = state.ticket?.project_id || snapshot.project_id;
  await activeProject(state.project_id);
  state.snapshot = {
    ...capture,
    layerNames: cleanLayerNames(storedLayerNames),
    ...(documentName ? { documentName } : {}),
  };
  state.activity = cleanActivity(snapshot.activity);
  state.activityHead = snapshot.activityHead || null;
  state.lastCheckpoint = null;
  state.pendingBefore = null;
  state.undo = snapshot.undo || [];
  state.redo = snapshot.redo || [];
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
  noteBaseline = note;
  const scene = new CanvasScene($('#scene-frame'), snapshot, {
    smartSelection: true,
    onAreaStart: areaSelection.beginScene,
    onMessage: toast,
    onBeforeSelect: () => !noteComposing && !commentEditor?.isComposing(),
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
    await saveCapture({
      ...snapshot,
      edits,
      annotations,
      note,
      ...(documentName ? { documentName } : {}),
    });
    state.ticket = await getTicket(snapshot.id);
    areaSelection.bind(scene);
    clipboard.bindScene(scene);
    if (generation !== state.generation) return;
    scene.interactionMode = state.mode;
    scene.setResourceRepairs(storedCodePatches || []);
    scene.setEdits(edits);
    scene.setComments(annotations);
    scene.select(null, { ids: snapshot.selection || [] });
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
    await updateProject(state.project_id, { last_ticket_id: snapshot.id });
    notice('');
    const route = new URL(location.href);
    route.searchParams.delete('sample');
    route.searchParams.set('id', state.snapshot.id);
    history.replaceState(null, '', route);
    renderTicketIdentity();
    adapter.publish();
    connectDesktopIfReady();
    renderMcpStatus();
    save();
    toast('화면을 가져왔어요. 이 티켓에서 편집과 주석을 이어가세요.');
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
      await receiveCapture(copy(window.CONSOLE_CANVAS_SAMPLE));
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
    await receiveCapture(snapshot);
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
  if (data.format && data.format !== 'console-canvas-snapshot') {
    const doc = await importDocument(data, state.project_id);
    await openSnapshot(doc, doc.edits, doc.note || '', doc.annotations || {});
  } else {
    const prepared = prepareCaptureScope(data);
    validateDocumentInput(prepared, data.edits || {}, data.annotations || {});
    const existing = await getDocument(data.id);
    if (existing) {
      if (existing.project_id !== state.project_id)
        throw Error('다른 프로젝트에 저장된 티켓입니다. 해당 프로젝트에서 열어 주세요.');
      if (
        JSON.stringify(captureFromDocument(existing)) !==
        JSON.stringify(captureFromDocument(prepared))
      )
        throw Error('같은 ID에 다른 원본이 저장돼 있습니다. 기존 작업은 바꾸지 않았습니다.');
      await openTicket(data.id);
      toast('이미 저장된 화면입니다. 기존 티켓과 편집을 열었습니다.');
    } else
      await openSnapshot(
        { ...prepared, project_id: state.project_id },
        data.edits || {},
        data.note || '',
        data.annotations || {},
      );
  }
}
$('#file-input').addEventListener('change', (event) => {
  importFile(event.target.files[0]).catch((error) =>
    notice('파일을 열지 못했습니다: ' + error.message),
  );
  event.target.value = '';
});
for (const id of ['#welcome-import'])
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
  if (commentEditor.isComposing()) return;
  $('#component-comment').value = '';
  $('#clear-comment').disabled = true;
  $('#clear-comment').hidden = true;
  commitCommentDraft();
  $('#component-comment').focus();
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
  if (ids.length > 1) focusComment({ ids });
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
  if (e.key === 'Escape' && !isComposingKey(e)) {
    e.preventDefault();
    e.stopPropagation();
    $('#properties-dialog').close();
  }
});
adapter.register('undo', () => {
  commitCommentDraft();
  undo();
});
adapter.register('redo', () => {
  commitCommentDraft();
  undo('redo');
});
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
function commitNoteDraft() {
  clearTimeout(noteTimer);
  if (!state.ready || !state.scene || noteComposing || $('#review-note').value === noteBaseline)
    return;
  const before = checkpoint();
  before.note = noteBaseline;
  state.undo.push(before);
  state.pendingBefore = before;
  state.redo = [];
  noteBaseline = $('#review-note').value;
  changeCommitted({ label: '추가 설명 수정' });
}
$('#review-note').addEventListener('compositionstart', () => {
  noteComposing = true;
  clearTimeout(noteTimer);
});
$('#review-note').addEventListener('compositionend', () => {
  noteComposing = false;
  scheduleNote();
});
function scheduleNote() {
  clearTimeout(noteTimer);
  if (!noteComposing) noteTimer = setTimeout(commitNoteDraft, 650);
}
$('#review-note').addEventListener('input', scheduleNote);
$('#review-note').addEventListener('change', () => {
  if (!noteComposing) commitNoteDraft();
});
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
function renderTicketIdentity() {
  const ticket = state.ticket;
  $('#header-ticket-identity').textContent = ticket ? ticket.display_id + ' · ' + ticket.title : '';
  $('#artboard-label').dataset.confirmed = String(!!ticket?.goal && !ticket.needs_reconfirmation);
  void projectWorkflow?.emit();
}
async function refreshTicket() {
  if (state.snapshot) state.ticket = await getTicket(state.snapshot.id);
  renderDocumentName();
  adapter.publish();
  await ticketWorkspace.refreshProjects();
}
async function openTicket(id) {
  await flushEditor();
  const doc = await getDocument(id);
  if (!doc) throw Error('티켓 작업 공간을 찾을 수 없습니다.');
  await openSnapshot(doc, doc.edits, doc.note, doc.annotations);
}
async function receiveCapture(value) {
  const project = await projectWorkflow.ensure(value.project_id);
  if (/^https?:\/\//.test(value.source.url))
    await updateProject(project.id, { last_url: value.source.url });
  await openSnapshot({ ...value, project_id: project.id });
  await refreshTicket();
}
async function confirmCurrentTicket() {
  if (!state.ready || state.confirming) return;
  state.confirming = true;
  adapter.publish();
  await projectWorkflow.emit();
  try {
    await flushEditor();
    const ticket = await getTicket(state.snapshot.id);
    const revision = state.revision,
      generation = state.generation;
    const image = await blobUrl((await imageResult()).blob);
    if (revision !== state.revision || generation !== state.generation)
      throw Error('편집이 바뀌었습니다. 다시 확정해 주세요.');
    await confirmTicketGoal({
      ticket_id: ticket.id,
      project_id: ticket.project_id,
      expected_revision: ticket.revision,
      expected_edit_revision: revision,
      operation_id: crypto.randomUUID(),
      image_data_url: image,
      selection_confirmed: true,
      source: state.snapshot.source,
      annotations: copy(state.scene.annotations),
      selection: [...state.scene.selection],
      request: [$('#review-note').value, ...state.scene.comments().map((c) => c.text)]
        .filter(Boolean)
        .join('\n\n'),
    });
    await refreshTicket();
    toast('확정했습니다. 에이전트 대화에서 조회하거나 구현을 요청할 수 있습니다.');
  } finally {
    state.confirming = false;
    adapter.publish();
    await projectWorkflow.emit();
  }
}
async function showTickets() {
  try {
    if (!state.project_id) {
      toast('프로젝트를 먼저 선택해 주세요.');
      return;
    }
    await flushEditor();
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    renderTickets($('#tickets-content'), {
      project: state.project_id,
      handoff: (intent) => copyHandoff(intent, 'project'),
      documentId: state.snapshot?.id,
      open: async (id) => {
        $('#tickets-dialog').close();
        await openTicket(id);
        window.ConsoleCanvasDesktop?.showEditor();
      },
      close: () => $('#tickets-dialog').close(),
      removed: async (id) => {
        if (state.snapshot?.id === id) await closeDocument(id);
      },
      changed: () => {
        state.ticketRevision = (state.ticketRevision || 0) + 1;
        void refreshTicket();
      },
    });
    if (!$('#tickets-dialog').open) $('#tickets-dialog').showModal();
  } catch (e) {
    toast(e.message);
  }
}
adapter.register('tickets', () => showTickets());
adapter.register('confirm-ticket', () => confirmCurrentTicket().catch((e) => toast(e.message)));
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
  $('#mcp-button').textContent = status.connected
    ? '연결 상태'
    : status.retrying
      ? '서버 재연결 중'
      : '연결 확인';
  $('#mcp-button').title =
    '서버 연결과 에이전트 인증은 다릅니다.' +
    (state.lastAgentCommand
      ? ' 최근 에이전트 통신: ' + state.lastAgentCommand
      : ' 이 실행에서 에이전트 명령 수신 기록 없음');
  $('#mcp-button').classList.toggle('connected', !!status.connected);
  $('#connection-server').textContent = status.connected
    ? '연결됨'
    : status.message || '연결 안 됨';
  $('#connection-agent').textContent = state.lastAgentCommand || '이 실행에서 수신 기록 없음';
  $('#manual-connection').hidden = !!window.ConsoleCanvasDesktop;
  $('#connection-retry').hidden = !window.ConsoleCanvasDesktop || !!status.connected;
  $('#connection-copy-command').hidden = !window.ConsoleCanvasDesktop;
  void activeConnectionProject();
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
const ticketWorkspace = createTicketWorkspace({
  state,
  editorId,
  controller,
  flushEditor,
  refresh: () => {
    state.ticketRevision = (state.ticketRevision || 0) + 1;
    void refreshTicket();
  },
});
const mcpBridge = createMcpBridge({
  refreshConnection: () => window.ConsoleCanvasDesktop?.getConnection(),
  metadata: ticketWorkspace.metadata,
  execute: ticketWorkspace.execute,
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
async function activeConnectionProject() {
  const projectId = state.project_id;
  const project = projectId ? await getProject(projectId) : null;
  if (projectId !== state.project_id) return;
  $('#connection-repository').textContent =
    project?.repository?.root || '미연결 · 편집·확정은 사용할 수 있습니다.';
  $('#connection-copy-project').hidden = !project || !!project.repository;
}
$('#connection-copy-command').onclick = async () => {
  try {
    await window.ConsoleCanvasDesktop.copyMcpCommand();
    $('#mcp-message').textContent =
      '연결 명령을 복사했습니다. 설정 경로가 다르면 등록한 뒤 MCP 클라이언트를 다시 연결하세요.';
  } catch (e) {
    $('#mcp-message').textContent = e.message;
  }
};
$('#connection-copy-project').onclick = () =>
  projectWorkflow
    .execute({ action: 'copy-connection' })
    .then(() => {
      $('#mcp-message').textContent = '저장소 연결 요청을 복사했습니다.';
    })
    .catch((e) => {
      $('#mcp-message').textContent = e.message;
    });
$('#connection-retry').onclick = async () => {
  try {
    const c = await window.ConsoleCanvasDesktop.getConnection();
    await mcpBridge.connect(c.url, c.token);
    $('#mcp-message').textContent = '앱과 로컬 서버를 다시 연결했습니다.';
  } catch (e) {
    $('#mcp-message').textContent = e.message;
  }
};
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
const projectWorkflow = createProjectWorkflow({
  state,
  flush: flushEditor,
  openTicket,
  closeDocument,
  showTickets,
  confirm: confirmCurrentTicket,
  importFile,
  copyRequest: window.ConsoleCanvasDesktop?.copyRequest,
  leave: () => {
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    for (const popover of document.querySelectorAll(':popover-open')) popover.hidePopover();
  },
  publish: (value) => {
    window.ConsoleCanvasDesktop?.publishWorkspace(value);
    void ticketWorkspace.refreshProjects();
    renderProjectControl(value);
  },
});
state.publishWorkspace = () => {
  void projectWorkflow.emit();
};
async function copyHandoff(intent = 'read', scope = 'ticket') {
  try {
    await projectWorkflow.execute({ action: 'copy-handoff', intent, scope });
    $('#document-menu-content').hidePopover();
    toast(
      (intent === 'implement' ? '구현' : intent === 'design' ? '시안' : '조회') +
        ' 요청을 복사했습니다. 에이전트 대화에 붙여 넣으세요.',
    );
  } catch (e) {
    toast(e.message);
  }
}
for (const intent of ['read', 'design', 'implement'])
  adapter.register('handoff-' + intent, () => copyHandoff(intent));
function renderProjectControl(value) {
  const host = $('#project-control');
  if (host.contains(document.activeElement)) return;
  host.replaceChildren();
  const select = document.createElement('select');
  select.setAttribute('aria-label', '프로젝트');
  const placeholder = new Option('프로젝트 선택', '');
  placeholder.disabled = true;
  select.add(placeholder);
  for (const p of value.projects) select.add(new Option(p.name, p.id));
  select.add(new Option('+ 새 프로젝트', 'new'));
  if (value.project) select.add(new Option('프로젝트 이름 변경', 'rename'));
  select.value = value.project?.id || '';
  select.onchange = async () => {
    if (select.value === 'new') showProjectName();
    else if (select.value === 'rename') showProjectName(value.project);
    else await projectWorkflow.execute({ action: 'select', id: select.value });
  };
  host.append(select);
}
function showProjectName(project = null) {
  const host = $('#project-control');
  host.replaceChildren();
  const form = document.createElement('form'),
    input = document.createElement('input'),
    save = document.createElement('button'),
    cancel = document.createElement('button');
  input.value = project?.name || '새 프로젝트';
  input.maxLength = 120;
  input.setAttribute('aria-label', '프로젝트 이름');
  save.textContent = project ? '이름 변경' : '만들기';
  cancel.type = 'button';
  cancel.textContent = '취소';
  cancel.onclick = () => {
    document.activeElement?.blur();
    projectWorkflow.emit();
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      document.activeElement?.blur();
      await projectWorkflow.execute({ action: project ? 'rename' : 'create', name: input.value });
    } catch (error) {
      toast(error.message);
    }
  };
  form.append(input, save, cancel);
  host.append(form);
  input.focus();
  input.select();
}
$('#header-ticket-identity').onclick = () => {
  if (state.ticket)
    navigator.clipboard
      .writeText(state.ticket.display_id)
      .then(() => toast('티켓 ID를 복사했습니다.'));
};
$('#web-source').onclick = () =>
  window.ConsoleCanvasDesktop?.showSource() || toast('내장 앱의 웹사이트에서 화면을 가져오세요.');
$('#web-editor').onclick = () => $('#tickets-dialog').close();
void projectWorkflow.initialize().then(() => projectWorkflow.emit());
if (window.ConsoleCanvasDesktop) {
  document.body.classList.add('desktop-editor');
  const tools = $('.canvas-toolbar');
  tools.setAttribute('role', 'toolbar');
  tools.setAttribute('aria-label', '편집 도구');

  // The native shell owns the single common header; editor tools stay by the canvas.
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
  window.ConsoleCanvasDesktop.onWorkspace((command) => projectWorkflow.execute(command));
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
      await receiveCapture(value);
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
            ? '새 작업 공간을 준비했습니다. 웹사이트에서 화면을 가져와 주세요.'
            : '저장된 화면을 찾을 수 없습니다. 웹사이트에서 다시 가져와 주세요.',
        );
      return openSnapshot(value, value.edits, value.note, value.annotations);
    })
    .catch((error) => notice(error.message));
else if (params.has('sample')) {
  projectWorkflow
    .initialize()
    .then(async () => {
      if (!(await listProjects()).length)
        await projectWorkflow.execute({ action: 'create', name: '샘플 콘솔' });
      await loadSample();
    })
    .catch((e) => notice(e.message));
} else
  projectWorkflow.initialize().then(async () => {
    const { project } = await projectWorkflow.view();
    if (project?.last_ticket_id && (await getDocument(project.last_ticket_id)))
      await openTicket(project.last_ticket_id);
    else await renderRecentDocuments();
  });
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
  ticketWorkspace,
  projectWorkflow,
  receiveCapture,
  confirmCurrentTicket,
  openTicket,
  checkpoint,
  flushEditor,
  showTickets,
  buildHandoffImage: imageResult,
  exportDocument: (options) =>
    exportDocument(state.snapshot, checkpoint(), state.project_id, options),
};
function connectDesktopIfReady() {
  if (state.desktopConnection && !mcpBridge.isConnected()) {
    const connection = state.desktopConnection;
    state.desktopConnection = null;
    mcpBridge.connect(connection.url, connection.token).catch((error) => notice(error.message));
  }
}
