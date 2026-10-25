import { buildHandoffImage } from './handoff-image.js';
import { withVersionScene } from './ui/version-preview.js';
import { cleanActivity } from './activity-history.js';
import { pointTarget } from './edit-commands.js';
import { createActivityPanel } from './ui/activity-panel.js';
import { createToast } from './ui/toast.js';
import { createRenameDialog } from './ui/rename-dialog.js';
import { createDocumentSwitcher } from './ui/document-switcher.js';
import { createCommentEditor } from './ui/comment-editor.js';
import { createAreaSelection } from './ui/area-selection.js';
import { createClipboard } from './ui/clipboard.js';
import { createVersionPreview } from './ui/version-preview.js';
import { createWorkspaceLayout } from './ui/workspace-layout.js';
import { createInspector } from './ui/inspector.js';
import { createDocumentLists } from './ui/document-lists.js';
import { createSnapshotPanel } from './ui/snapshot-panel.js';
import { createCanvasViewport } from './ui/canvas-viewport.js';
import { createExportDialog } from './ui/export-dialog.js';
import {
  saveCapture,
  getDocument,
  getDocumentMetadata,
  listDocuments,
  cleanDocumentName,
} from './db.js';
import { createEditorSession } from './editor-session.js';
import { CanvasScene, copy, validateSnapshot } from './engine.js';
import { buildReview } from './export.js';
import { createEditorController } from './editor-controller.js';
import { createMcpBridge } from './bridge-client.js';
import { createSnapshotHistory } from './snapshot-history.js';

const $ = (selector) => document.querySelector(selector);
const isExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
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
  flush,
} = createEditorSession({
  state,
  getNote: () => $('#review-note').value,
  setNote: (value) => {
    $('#review-note').value = value;
  },
  status: (message) => {
    $('#save-status').textContent = message;
  },
  commitCommentDraft,
  render: () => {
    renderInspector();
    renderLayers();
    activityPanel.render();
    renderHistory();
    renderSnapshots();
    renderMcpStatus();
  },
});
const { panels, setPanelVisibility } = createWorkspaceLayout({ $, commitCommentDraft });
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
      state.scene = null;
      state.timeline = null;
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
      for (const key of ['#export-button', '#snapshots-button']) $(key).disabled = true;
      $('#source-url').hidden = true;
      $('#source-meta').textContent = '편집할 화면을 열어 주세요.';
      $('#review-note').value = '';
      $('#layers').replaceChildren();
      $('#snapshot-list').replaceChildren();
      for (const key of ['#layer-count', '#snapshot-count']) $(key).textContent = '0';
      $('#version-status').textContent = '';
      $('#snapshot-current').textContent = '';
      $('#save-status').textContent = '휴지통에 보관됨';
      renderDocumentName();
      renderSnapshots();
      renderInspector();
      renderHistory();
      renderRecentDocuments();
    });
  opening = next;
  return next;
}
const areaSelection = createAreaSelection({ $, state, toast });
const clipboard = createClipboard({ $, state, toast, commitCommentDraft });
const { renderInspector } = createInspector({ $, state, kinds, selectNode });
function selectNode(id, { reveal = false, additive = false } = {}) {
  if (!state.scene) return;
  state.scene.select(id, { additive });
  for (const parent of state.scene.ancestors(id)) state.expanded.add(parent);
  renderLayers();
  if (reveal) {
    const r = state.scene.rect(id);
    if (r) {
      $('#viewport').scrollTo({
        left: Math.max(0, r.x * state.zoom - 100),
        top: Math.max(0, r.y * state.zoom - 100),
        behavior: 'smooth',
      });
    }
  }
}
const { renderLayers } = createDocumentLists({ $, state, selectNode, focusComment });
const commentEditor = createCommentEditor({
  $,
  state,
  commit: commitCommentDraft,
});
function focusComment(options = {}) {
  commentEditor.open(options);
}
const preview = createVersionPreview({ $, state, commitCommentDraft });
const snapshotHistory = createSnapshotHistory({
  state,
  checkpoint,
  historyBefore,
  apply: applyCheckpoint,
  changed: changeCommitted,
});
const { showSnapshots, renderSnapshots } = createSnapshotPanel({
  $,
  state,
  snapshotHistory,
  commitCommentDraft,
  setPanelVisibility,
  panels,
  toast,
  preview,
  renameDialog,
  flushEditor,
});
const activityPanel = createActivityPanel({ $, state, selectNode, focusComment });
function onKey(event) {
  if (!state.scene || document.querySelector('dialog[open]')) return;
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
async function openDocument(snapshot, edits = {}, note = '', annotations = {}, timeline = null) {
  validateSnapshot(snapshot);
  await flushEditor();
  areaSelection.reset();
  clipboard.reset();
  commentEditor.reset();
  for (const id of ['#compare-dialog', '#export-dialog', '#properties-dialog'])
    if ($(id).open) $(id).close();
  const existingMeta = await getDocumentMetadata(snapshot.id);
  const documentName = snapshot.documentName
    ? cleanDocumentName(snapshot.documentName)
    : existingMeta?.title && existingMeta.title !== snapshot.source.title
      ? existingMeta.title
      : undefined;
  await saveCapture({ ...snapshot, ...(documentName ? { documentName } : {}) });
  if (existingMeta?.deletedAt)
    throw new Error('휴지통에 있는 문서입니다. 문서 목록의 휴지통에서 먼저 복구해 주세요.');
  const generation = ++state.generation;
  commitCommentDraft();
  state.commentTarget = null;
  state.ready = false;
  state.revision++;
  $('#welcome').hidden = true;
  $('#artboard-space').hidden = false;
  $('#export-button').disabled = true;
  $('#snapshots-button').disabled = true;
  const {
    timeline: storedTimeline,
    edits: storedEdits,
    annotations: storedComments,
    note: storedNote,
    documentName: storedDocumentName,
    deletedAt,
    activity,
    activityHead,
    ...capture
  } = snapshot;
  timeline = timeline || storedTimeline;
  state.timeline = null;
  state.snapshot = { ...capture, ...(documentName ? { documentName } : {}) };
  state.activity = cleanActivity(snapshot.activity);
  state.activityHead = snapshot.activityHead || null;
  state.lastCheckpoint = null;
  state.pendingBefore = null;
  state.undo = [];
  state.redo = [];
  state.expanded = new Set(snapshot.nodes.filter((node) => !node.parentId).map((node) => node.id));
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
  try {
    await scene.mount();
    areaSelection.bind(scene);
    clipboard.bindScene(scene);
    if (generation !== state.generation) return;
    scene.interactionMode = state.mode;
    scene.setEdits(edits);
    scene.setComments(annotations);
    snapshotHistory.initialise(timeline);
    fit();
    $('#viewport').scrollLeft = (snapshot.source.scroll?.x || 0) * state.zoom;
    $('#viewport').scrollTop = (snapshot.source.scroll?.y || 0) * state.zoom;
    renderInspector();
    renderLayers();
    activityPanel.render();
    renderHistory();
    renderSnapshots();
    $('#export-button').disabled = false;
    $('#snapshots-button').disabled = false;
    $('#capture-notes').hidden = !snapshot.warnings.length;
    $('#capture-notes-title').textContent = '가져오기 참고 ' + snapshot.warnings.length + '건';
    $('#capture-notes-list').replaceChildren();
    for (const warning of snapshot.warnings) {
      const li = document.createElement('li');
      li.textContent = warning.message;
      $('#capture-notes-list').append(li);
    }
    state.lastCheckpoint = checkpoint();
    activityPanel.render();
    state.ready = true;
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
  if (data.format === 'console-canvas-review') {
    await openSnapshot(
      { ...data.snapshot, activity: data.activity, activityHead: data.activityHead },
      data.edits,
      data.note || '',
      data.annotations || {},
      data.timeline,
    );
  } else
    await openSnapshot(
      data,
      data.edits || {},
      data.note || '',
      data.annotations || {},
      data.timeline,
    );
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
$('#component-comment').addEventListener('input', () => {
  $('#comment-status').textContent = '작성 중 · 저장하거나 다른 요소를 선택하면 기록됩니다.';
  $('#clear-comment').disabled =
    !$('#component-comment').value.trim() && !state.scene?.annotations[state.commentTarget];
});
$('#component-comment').addEventListener('change', commitCommentDraft);
$('#save-comment').addEventListener('click', () => {
  commitCommentDraft();
  renderInspector();
});
$('#clear-comment').addEventListener('click', () => {
  $('#component-comment').value = '';
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
$('#edit-properties').addEventListener('click', () => {
  if (!state.scene?.selected) return;
  commitCommentDraft();
  renderInspector();
  $('#properties-dialog').showModal();
});
$('#close-properties').addEventListener('click', () => $('#properties-dialog').close());
$('#undo').addEventListener('click', () => undo());
$('#redo').addEventListener('click', () => undo('redo'));
$('#select-parent').addEventListener('click', () =>
  selectNode(state.scene.parent(state.scene.selected)),
);
$('#delete').addEventListener('click', () => state.scene?.remove());
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
createExportDialog({ $, state, commitCommentDraft, editorId, flushEditor, toast });
window.addEventListener('dragover', (event) => {
  if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
});
window.addEventListener('drop', (event) => {
  if (event.dataTransfer?.files.length) {
    event.preventDefault();
    if (document.querySelector('dialog[open]')) {
      toast('열린 창을 닫고 파일을 가져와 주세요.');
      return;
    }
    importFile(event.dataTransfer.files[0]).catch((error) => notice(error.message));
  }
});
function renderMcpStatus() {
  const status = state.mcpStatus;
  $('#mcp-button').textContent = status.connected ? '● 에이전트 연결됨' : '○ 에이전트 연결';
  $('#mcp-button').classList.toggle('connected', !!status.connected);
  $('#mcp-state').textContent =
    (status.connected ? 'MCP 연결됨 · r' + state.revision : status.message || 'MCP 연결 안 됨') +
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
  historyBefore,
  changeCommitted,
  undo,
  snapshotHistory,
  buildHandoffImage: async (id) => {
    const point = id
      ? state.timeline.entries.find((e) => e.id === id && !e.deletedAt)?.state
      : checkpoint();
    if (!point) throw new Error('해당 스냅샷을 찾을 수 없습니다.');
    return withVersionScene(state.snapshot, point, (scene) =>
      buildHandoffImage(state.snapshot, scene, point.note),
    );
  },
  isBusy: () =>
    !!document.querySelector('dialog[open]') ||
    document.activeElement === $('#snapshot-name') ||
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
    renderMcpStatus();
  },
});
$('#mcp-button').addEventListener('click', () => $('#mcp-dialog').showModal());
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
  actions.setAttribute('aria-label', '스냅샷과 화면 파일');
  $('.canvas-tools').append(actions);
  $('#recapture-button').hidden = false;
  $('#recapture-button').addEventListener('click', () => window.ConsoleCanvasDesktop.showSource());
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
      document.querySelector('dialog[open]')
    )
      return;
    commitCommentDraft();
    undo(command);
  });
  window.ConsoleCanvasDesktop.onFlush(flushEditor);
  window.ConsoleCanvasDesktop.onSnapshot((value) =>
    openSnapshot(value).catch((error) => notice(error.message)),
  );
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
        throw new Error('저장된 화면을 찾을 수 없습니다. 웹사이트에서 다시 가져와 주세요.');
      return openSnapshot(value, value.edits, value.note, value.annotations);
    })
    .catch((error) => notice(error.message));
else if (params.has('sample')) loadSample();
else renderRecentDocuments();
async function renderRecentDocuments() {
  try {
    const values = await listDocuments();
    $('#recent-documents').replaceChildren();
    for (const snapshot of values) {
      const button = document.createElement('button');
      button.className = 'recent-item';
      const title = document.createElement('span'),
        date = document.createElement('small');
      title.textContent = snapshot.title;
      date.textContent = new Date(snapshot.capturedAt).toLocaleDateString('ko-KR');
      button.append(title, date);
      button.addEventListener('click', () =>
        getDocument(snapshot.id)
          .then((value) => {
            if (!value) throw new Error('문서를 찾을 수 없습니다. 휴지통을 확인해 주세요.');
            return openSnapshot(value, value.edits, value.note, value.annotations);
          })
          .catch((error) => notice(error.message)),
      );
      $('#recent-documents').append(button);
    }
  } catch (error) {
    notice(error.message);
  }
}
// Exposed for the local integration harness; contains only this editor's current document.
window.ConsoleCanvas = {
  state,
  openSnapshot,
  closeDocument,
  importFile,
  undo,
  selectNode,
  controller,
  snapshotHistory,
  buildHandoffImage: () =>
    withVersionScene(state.snapshot, checkpoint(), (scene) =>
      buildHandoffImage(state.snapshot, scene, $('#review-note').value),
    ),
  buildReview: () =>
    buildReview(state.snapshot, state.scene, $('#review-note').value, undefined, state.timeline),
};
function connectDesktopIfReady() {
  if (state.desktopConnection && state.ready && !mcpBridge.isConnected()) {
    const connection = state.desktopConnection;
    state.desktopConnection = null;
    mcpBridge.connect(connection.url, connection.token).catch((error) => notice(error.message));
  }
}
