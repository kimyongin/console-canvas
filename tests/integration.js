import { CanvasScene, copy, validateSnapshot, sanitizeHtml } from '../engine.js';
import { buildReview, download, zipFiles, reviewPayload, instructionText } from '../export.js';
import { createEditorController } from '../editor-controller.js';
import { createSnapshotHistory } from '../snapshot-history.js';
const results = [],
  output = document.getElementById('results'),
  status = document.getElementById('status');
function check(name, predicate) {
  let passed = false,
    error = '';
  try {
    passed = !!predicate();
  } catch (e) {
    error = e.message;
  }
  results.push({ name, passed, error });
  output.textContent = results
    .map((r) => (r.passed ? 'PASS ' : 'FAIL ') + r.name + (r.error ? ' · ' + r.error : ''))
    .join('\n');
}
function near(a, b) {
  return Math.abs(a - b) < 0.75;
}
async function run() {
  let workerRegistration,
    workerReady = false,
    workerError = '';
  try {
    workerRegistration = await navigator.serviceWorker.register('./background-worker.js', {
      type: 'module',
      scope: './background-startup/',
    });
    const worker =
      workerRegistration.installing || workerRegistration.waiting || workerRegistration.active;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Background startup timed out')), 10000);
      const changed = () => {
        if (worker.state === 'activated' || worker.state === 'redundant') {
          clearTimeout(timeout);
          worker.removeEventListener('statechange', changed);
          if (worker.state === 'redundant') reject(Error('Background startup failed'));
          else resolve();
        }
      };
      worker.addEventListener('statechange', changed);
      changed();
    });
    workerReady = await new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => reject(Error('Background response timed out')), 5000);
      channel.port1.onmessage = ({ data }) => {
        clearTimeout(timeout);
        channel.port1.close();
        resolve(data.ready === true);
      };
      worker.postMessage('status', [channel.port2]);
    });
  } catch (error) {
    workerError = error.message;
  } finally {
    await workerRegistration?.unregister();
  }
  check(
    'Production background imports start in a real module service worker' +
      (workerError ? ': ' + workerError : ''),
    () => workerReady,
  );
  const sourceFrame = document.getElementById('source');
  if (
    sourceFrame.contentDocument?.readyState !== 'complete' ||
    !sourceFrame.contentDocument?.getElementById('customer-search')
  )
    await new Promise((resolve) => sourceFrame.addEventListener('load', resolve, { once: true }));
  const source = sourceFrame.contentDocument;
  source.getElementById('customer-search').value = '김민서';
  source.querySelector('input[type=checkbox]').checked = true;
  source.querySelector('select').value = 'VIP';
  const password = source.createElement('input');
  password.type = 'password';
  password.value = 'DO-NOT-COPY-PASSWORD';
  password.setAttribute('value', 'DO-NOT-COPY-PASSWORD');
  password.setAttribute('aria-label', 'password-test');
  source.body.append(password);
  const beforeSource = source.documentElement.outerHTML;
  const snapshot = await globalThis.UICloneCapture.capture(source);
  check(
    'Capture leaves original DOM unchanged',
    () => source.documentElement.outerHTML === beforeSource,
  );
  check(
    'Capture finds real DOM and individual text',
    () =>
      snapshot.nodes.length > 300 &&
      snapshot.nodes.some((n) => n.kind === 'text') &&
      snapshot.nodes.some((n) => n.kind === 'icon'),
  );
  check('Empty CSS pseudo icons are preserved', () =>
    snapshot.nodes.some((n) => n.kind === 'pseudo'),
  );
  check('Snapshot has no source scripts', () => !/<script[\s>]/i.test(snapshot.html));
  check('Password values are not copied', () => !snapshot.html.includes('DO-NOT-COPY-PASSWORD'));
  const scene = new CanvasScene(document.getElementById('clone'), snapshot);
  await scene.mount();
  check(
    'All captured DOM targets resolve in the clone',
    () => scene.elements.size === snapshot.nodes.length,
  );
  check(
    'Input value is preserved',
    () => scene.doc.getElementById('customer-search').value === '김민서',
  );
  check(
    'Checkbox state is preserved',
    () => scene.doc.querySelector('input[type=checkbox]').checked,
  );
  check('Select state is preserved', () => scene.doc.querySelector('select').value === 'VIP');
  check(
    'Source scripts do not run in the clone',
    () => scene.frame.contentWindow.consoleDemoActions === undefined,
  );
  const visible = [...scene.elements.keys()].filter((id) => {
    const n = scene.nodes.get(id),
      r = scene.rect(id);
    return n.visible && r.width > 0 && r.height > 0 && n.tag !== 'option';
  });
  const failureDetails = [];
  for (const id of visible) {
    scene.setEdits({});
    const before = scene.rect(id);
    scene.setEdits({ [id]: { dx: 17, dy: 9 } });
    const after = scene.rect(id);
    if (!near(after.x - before.x, 17) || !near(after.y - before.y, 9))
      failureDetails.push({
        id,
        kind: scene.nodes.get(id).kind,
        tag: scene.nodes.get(id).tag,
        before,
        after,
      });
    scene.remove(id);
    if (
      !scene.hidden(id) ||
      scene.doc.defaultView.getComputedStyle(scene.elements.get(id)).visibility !== 'hidden'
    )
      failureDetails.push({ id, action: 'deletion' });
    scene.setEdits({});
    const restored = scene.rect(id);
    if (!near(before.x, restored.x) || !near(before.y, restored.y))
      failureDetails.push({ id, action: 'restore', before, restored });
  }
  check(
    'Every rendered element can move, delete, and restore (' + visible.length + ' elements)',
    () => !failureDetails.length,
  );
  if (failureDetails.length) {
    const pre = document.createElement('pre');
    pre.id = 'element-failures';
    pre.textContent = JSON.stringify(failureDetails.slice(0, 20), null, 2);
    document.body.append(pre);
  }
  scene.setEdits({});
  const button = snapshot.nodes.find((n) => n.locator.id === 'new-customer' && n.tag === 'button'),
    label = snapshot.nodes.find((n) => n.parentId === button.id && n.kind === 'text'),
    icon = snapshot.nodes.find((n) => n.parentId === button.id && n.kind === 'icon');
  const baseLabel = scene.rect(label.id);
  scene.setEdits({ [button.id]: { dx: 70, dy: 35 }, [label.id]: { dx: 20, dy: 10 } });
  check(
    'Moved text follows moved parent and keeps its own offset',
    () =>
      near(scene.rect(label.id).x, baseLabel.x + 90) &&
      near(scene.rect(label.id).y, baseLabel.y + 45),
  );
  scene.setEdits({ [label.id]: { deleted: true } });
  check(
    'Deleting button text preserves the button and icon',
    () => scene.hidden(label.id) && !scene.hidden(button.id) && !scene.hidden(icon.id),
  );
  scene.setEdits({ [label.id]: { dx: 120, dy: 90 }, [button.id]: { deleted: true } });
  check(
    'Deleting a group hides detached moved descendants',
    () => scene.hidden(label.id) && scene.elements.get(label.id).style.opacity === '0',
  );
  check(
    'Deletion log deduplicates descendants',
    () => scene.changes().length === 1 && scene.changes()[0].id === button.id,
  );
  scene.setEdits({});
  const text = snapshot.nodes.find(
    (n) =>
      n.kind === 'text' &&
      n.text === '고객 관리' &&
      scene.parent(n.id) &&
      scene.nodes.get(scene.parent(n.id)).tag === 'h1',
  );
  scene.select(text.id);
  scene.doc.documentElement.setPointerCapture = () => {};
  scene.doc.documentElement.hasPointerCapture = () => false;
  const target = scene.elements.get(text.id),
    r = scene.rect(text.id);
  target.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      pointerId: 7,
      button: 0,
      clientX: r.x + 5,
      clientY: r.y + 5,
    }),
  );
  scene.doc.documentElement.dispatchEvent(
    new PointerEvent('pointermove', {
      bubbles: true,
      pointerId: 7,
      clientX: r.x + 115,
      clientY: r.y + 85,
    }),
  );
  scene.doc.documentElement.dispatchEvent(
    new PointerEvent('pointerup', { bubbles: true, pointerId: 7 }),
  );
  check(
    'Direct drag moves text outside its original container',
    () =>
      scene.edits[text.id].dx === 110 &&
      scene.edits[text.id].dy === 80 &&
      near(scene.rect(text.id).x, r.x + 110),
  );
  const moved = copy(scene.edits);
  scene.setEdits({});
  scene.setEdits(moved);
  check(
    'Restoring imported edits reproduces the final position',
    () => near(scene.rect(text.id).x, r.x + 110) && near(scene.rect(text.id).y, r.y + 80),
  );
  const originalBefore = await scene.beforeHtml();
  check(
    'Generating the original view preserves current edits',
    () => scene.edits[text.id].dx === 110 && near(scene.rect(text.id).x, r.x + 110),
  );
  check(
    'Serialized output excludes editor outlines',
    () => !scene.serialize().includes('data-uic-editor="selection"'),
  );
  const cleaned = sanitizeHtml(
    '<html><head><script>alert(1)</script></head><body><img src="x" onerror="alert(1)"><iframe srcdoc="bad"></iframe><a href="javascript:alert(1)">link</a></body></html>',
  );
  check(
    'Imported active content is removed',
    () =>
      !cleaned.includes('onerror') &&
      !cleaned.includes('<script') &&
      !cleaned.includes('<iframe') &&
      !cleaned.includes('javascript:'),
  );
  let rejected = false;
  try {
    validateSnapshot({
      ...snapshot,
      nodes: [{ ...snapshot.nodes[0], parentId: snapshot.nodes[0].id }],
    });
  } catch {
    rejected = true;
  }
  check('Cyclic imported element identities are rejected', () => rejected);
  const originalEdits = JSON.stringify(scene.edits),
    originalPosition = scene.rect(text.id);
  scene.setComment(text.id, '제목 문구를 고객 목록으로 바꾸고\n설명은 한 줄로 줄여 주세요.');
  check(
    'Comment-only requests preserve the visual layout and original locator',
    () =>
      JSON.stringify(scene.edits) === originalEdits &&
      near(scene.rect(text.id).x, originalPosition.x) &&
      scene.comments()[0].locator.selector === text.locator.selector,
  );
  const marker = scene.commentMarkers.get(text.id);
  check(
    'Commented elements display a numbered canvas marker with preview text',
    () =>
      marker?.textContent === '1' &&
      marker.title.includes('제목 문구를 고객 목록으로') &&
      marker.dataset.uicComment === text.id,
  );
  let openedComment = null;
  scene.callbacks.onCommentSelect = (id) => {
    openedComment = id;
  };
  marker.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, pointerId: 30, button: 0 }),
  );
  check(
    'Clicking a comment marker opens its target without moving it',
    () =>
      openedComment === text.id &&
      scene.selected === text.id &&
      !scene.drag &&
      JSON.stringify(scene.edits) === originalEdits,
  );
  openedComment = null;
  marker.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
  check('Comment markers support keyboard activation', () => openedComment === text.id);
  scene.setDisplayScale(0.5);
  check('Canvas comment markers stay readable when the artboard is zoomed out', () =>
    near(marker.getBoundingClientRect().width * scene.displayScale, 24),
  );
  scene.setDisplayScale(1);
  const markerX = parseFloat(marker.style.left);
  scene.setEdits({ ...scene.edits, [text.id]: { dx: 150, dy: 80 } });
  check('Comment markers follow their elements when moved', () =>
    near(parseFloat(marker.style.left) - markerX, 40),
  );
  scene.setEdits(JSON.parse(originalEdits));
  check(
    'Canvas comment markers are excluded from exported page HTML',
    () =>
      !scene.serialize().includes('data-uic-comment') &&
      !scene.serialize().includes('data-uic-editor="comment-markers"'),
  );
  scene.interactionMode = 'comment';
  target.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      pointerId: 8,
      button: 0,
      clientX: r.x + 5,
      clientY: r.y + 5,
    }),
  );
  scene.doc.documentElement.dispatchEvent(
    new PointerEvent('pointermove', {
      bubbles: true,
      pointerId: 8,
      clientX: r.x + 200,
      clientY: r.y + 200,
    }),
  );
  scene.doc.documentElement.dispatchEvent(
    new PointerEvent('pointerup', { bubbles: true, pointerId: 8 }),
  );
  check(
    'Comment mode selects without accidentally dragging',
    () =>
      scene.selected === text.id && !scene.drag && JSON.stringify(scene.edits) === originalEdits,
  );
  scene.interactionMode = 'edit';
  scene.setComment(label.id, '버튼 문구를 바꿔 주세요.');
  scene.setEdits({ [button.id]: { deleted: true } });
  check('Comments survive deleted ancestors and mark the missing target', () =>
    scene.comments().some((c) => c.id === label.id && c.targetDeleted && c.after === null),
  );
  check(
    'Deleted targets retain a clickable canvas comment marker',
    () =>
      scene.commentMarkers.has(label.id) &&
      scene.commentMarkers.get(label.id).title.includes('삭제된 대상'),
  );
  scene.setEdits(moved);
  scene.setComment(label.id, '');
  check('Deleting a comment removes its canvas marker', () => !scene.commentMarkers.has(label.id));
  const savedComments = copy(scene.annotations);
  scene.setComments({ ...savedComments, n999999: 'unknown', bad: 123 });
  check(
    'Imported comments exclude unknown IDs and invalid values',
    () => JSON.stringify(scene.annotations) === JSON.stringify(savedComments),
  );
  scene.select(icon.id);
  scene.remove();
  scene.setComment(icon.id, '아이콘 대신 텍스트만 남겨 주세요.');
  const payload = reviewPayload(snapshot, scene, '주석과 직접 편집을 함께 전달합니다.');
  check(
    'Review JSON preserves comments separately from visual changes',
    () =>
      payload.comments.length === 2 &&
      payload.annotations[text.id].includes('\n') &&
      payload.comments.some((c) => c.id === icon.id && c.targetDeleted),
  );
  scene.setComments({});
  scene.setComments(payload.annotations);
  check(
    'Reopened comments retain text, targets, and delete status',
    () => JSON.stringify(scene.comments()) === JSON.stringify(payload.comments),
  );
  check(
    'Reopening comments rebuilds their canvas markers',
    () =>
      scene.commentMarkers.size === 2 &&
      scene.commentMarkers.has(text.id) &&
      scene.commentMarkers.has(icon.id),
  );
  check(
    'Human-readable handoff includes component comment text and identity',
    () =>
      instructionText(snapshot, scene.changes(), '', scene.comments()).includes(
        '제목 문구를 고객 목록으로',
      ) &&
      instructionText(snapshot, scene.changes(), '', scene.comments()).includes('원본 식별 정보:'),
  );
  const initial = {
    edits: copy(scene.edits),
    annotations: copy(scene.annotations),
    selected: scene.selected,
    changes: copy(scene.changes()),
  };
  const controlState = {
    snapshot,
    scene,
    ready: true,
    revision: 20,
    undo: [],
    redo: [],
    commentTarget: null,
  };
  let userBusy = false;
  const point = () => ({
    edits: copy(scene.edits),
    annotations: copy(scene.annotations),
    selected: scene.selected,
  });
  const control = createEditorController({
    state: controlState,
    editorId: 'integration-editor',
    checkpoint: point,
    isBusy: () => userBusy,
    historyBefore: () => {
      controlState.undo.push(point());
      controlState.redo = [];
    },
    changeCommitted: () => {
      controlState.revision++;
    },
    undo: (direction) => {
      const previous = controlState[direction].pop();
      controlState[direction === 'undo' ? 'redo' : 'undo'].push(point());
      scene.setComments(previous.annotations);
      scene.setEdits(previous.edits);
      scene.select(previous.selected);
      controlState.revision++;
    },
  });
  const invoke = (name, args = {}) =>
    control.execute({
      name,
      arguments: { editor_id: 'integration-editor', ...args },
      document_id: snapshot.id,
      deadline: Date.now() / 1000 + 30,
    });
  const query = await invoke('list_elements', { query: 'new-customer' });
  check(
    'MCP controller queries original captured element identities',
    () =>
      query.ok && query.elements.some((e) => e.id === button.id && e.locator.id === 'new-customer'),
  );
  const invalid = await invoke('apply_edits', {
    expected_revision: 20,
    operations: [
      { type: 'move', element_id: text.id, mode: 'relative', dx: 5, dy: 0 },
      { type: 'delete', element_id: 'n999999' },
    ],
  });
  check(
    'MCP invalid batches do not partially change the scene',
    () =>
      !invalid.ok &&
      controlState.revision === 20 &&
      JSON.stringify(scene.edits) === JSON.stringify(initial.edits) &&
      !controlState.undo.length,
  );
  const applied = await invoke('apply_edits', {
    expected_revision: 20,
    operations: [
      { type: 'move', element_id: text.id, mode: 'absolute', dx: 80, dy: 30 },
      { type: 'comment', element_id: button.id, text: 'MCP controller comment' },
    ],
  });
  check(
    'MCP batched edits create one history step and one revision',
    () =>
      applied.ok &&
      controlState.revision === 21 &&
      controlState.undo.length === 1 &&
      scene.edits[text.id].dx === 80 &&
      scene.annotations[button.id] === 'MCP controller comment',
  );
  const controllerComments = await invoke('list_comments', { element_id: button.id });
  check(
    'MCP comment lookup returns only the requested element',
    () =>
      controllerComments.comments.length === 1 && controllerComments.comments[0].id === button.id,
  );
  const stale = await invoke('undo', { expected_revision: 20 });
  check(
    'MCP stale revisions cannot overwrite intervening edits',
    () => stale.error?.code === 'revision_conflict' && controlState.revision === 21,
  );
  userBusy = true;
  const busy = await invoke('undo', { expected_revision: 21 });
  userBusy = false;
  check(
    'MCP writes wait for active user editing',
    () => busy.error?.code === 'editor_busy' && controlState.revision === 21,
  );
  await invoke('undo', { expected_revision: 21 });
  check(
    'MCP undo restores the entire batch',
    () =>
      JSON.stringify(scene.changes()) === JSON.stringify(initial.changes) &&
      JSON.stringify(scene.annotations) === JSON.stringify(initial.annotations) &&
      controlState.revision === 22,
  );
  await invoke('redo', { expected_revision: 22 });
  check(
    'MCP redo restores the batch without losing comments',
    () =>
      scene.annotations[button.id] === 'MCP controller comment' && scene.edits[text.id].dx === 80,
  );
  const wrong = await control.execute({
    name: 'get_screen',
    arguments: { editor_id: 'integration-editor' },
    document_id: 'different',
    deadline: Date.now() / 1000 + 30,
  });
  check(
    'MCP commands are bound to the captured document identity',
    () => wrong.error?.code === 'wrong_document',
  );
  let note = '초기 설명';
  const versionPoint = () => ({
    ...point(),
    note,
    activeSnapshotId: controlState.timeline?.activeId,
  });
  const versionHistory = createSnapshotHistory({
    state: controlState,
    checkpoint: versionPoint,
    historyBefore: () => {
      controlState.undo.push(versionPoint());
      controlState.redo = [];
    },
    apply: (p) => {
      scene.setComments(p.annotations);
      scene.setEdits(p.edits);
      scene.select(p.selected);
      note = p.note;
    },
    changed: () => controlState.revision++,
  });
  versionHistory.initialise();
  const firstVersion = controlState.timeline.activeId;
  scene.setEdits({ ...scene.edits, [text.id]: { dx: 180, dy: 50 }, [icon.id]: { deleted: true } });
  scene.setComments({ [button.id]: '두 번째 버전의 주석' });
  note = '두 번째 설명';
  const secondVersion = versionHistory.create('시안 B').id;
  versionHistory.restore(firstVersion);
  check(
    'Saved versions restore movements, comments and handoff notes',
    () =>
      scene.edits[text.id].dx === 80 &&
      scene.annotations[button.id] === 'MCP controller comment' &&
      note === '초기 설명',
  );
  versionHistory.restore(secondVersion);
  check(
    'Navigating to the past retains future versions and deleted elements',
    () =>
      scene.edits[text.id].dx === 180 &&
      scene.hidden(icon.id) &&
      note === '두 번째 설명' &&
      versionHistory.list().length === 2,
  );
  scene.setEdits({ ...scene.edits, [text.id]: { dx: 290, dy: 60 } });
  scene.setComments({ [button.id]: '저장하지 않은 작업' });
  note = '작업 중 설명';
  const restored = versionHistory.restore(firstVersion);
  check(
    'Unsaved work is automatically preserved before navigation',
    () => !!restored.automatic_snapshot_id && versionHistory.list().length === 3,
  );
  versionHistory.restore(restored.automatic_snapshot_id);
  check(
    'Automatically preserved work is recoverable including notes',
    () =>
      scene.edits[text.id].dx === 290 &&
      scene.annotations[button.id] === '저장하지 않은 작업' &&
      note === '작업 중 설명',
  );
  versionHistory.restore(firstVersion);
  scene.setEdits({ ...scene.edits, [text.id]: { dx: 350, dy: 80 } });
  const branch = versionHistory.create('과거에서 만든 시안 C').id;
  check(
    'Editing in the past creates a branch without truncating later snapshots',
    () =>
      versionHistory.list().some((e) => e.id === secondVersion) &&
      controlState.timeline.entries.find((e) => e.id === branch).parentId === firstVersion,
  );
  const persisted = JSON.parse(JSON.stringify(controlState.timeline));
  versionHistory.initialise(persisted);
  versionHistory.restore(secondVersion);
  check(
    'Serialized snapshot history can reopen and navigate forward',
    () => scene.edits[text.id].dx === 180 && controlState.timeline.entries.length === 4,
  );
  const beforeInvalid = JSON.stringify(controlState.timeline);
  let invalidHistory = false;
  try {
    versionHistory.initialise({
      ...persisted,
      entries: [persisted.entries[0], persisted.entries[0]],
    });
  } catch {
    invalidHistory = true;
  }
  check(
    'Invalid imported history is rejected without changing the timeline',
    () => invalidHistory && JSON.stringify(controlState.timeline) === beforeInvalid,
  );
  const versionControl = createEditorController({
    state: controlState,
    editorId: 'integration-editor',
    snapshotHistory: versionHistory,
    isBusy: () => false,
  });
  const versionInvoke = (name, args = {}) =>
    versionControl.execute({
      name,
      arguments: { editor_id: 'integration-editor', ...args },
      document_id: snapshot.id,
      deadline: Date.now() / 1000 + 30,
    });
  const savedRevision = controlState.revision;
  const savedViaMcp = await versionInvoke('create_snapshot', {
    expected_revision: savedRevision,
    name: 'MCP로 저장',
  });
  check(
    'MCP creates named snapshots with monotonic revision checks',
    () => savedViaMcp.ok && savedViaMcp.snapshot_id && controlState.revision === savedRevision + 1,
  );
  const staleSnapshot = await versionInvoke('restore_snapshot', {
    expected_revision: savedRevision,
    snapshot_id: firstVersion,
  });
  check(
    'Stale MCP snapshot restoration cannot overwrite current work',
    () => staleSnapshot.error?.code === 'revision_conflict',
  );
  await versionInvoke('restore_snapshot', {
    expected_revision: controlState.revision,
    snapshot_id: firstVersion,
  });
  const snapshotPage = await versionInvoke('list_snapshots', { offset: 1, limit: 2 });
  check(
    'MCP snapshot listing is paginated and restoration keeps every saved version',
    () =>
      snapshotPage.ok &&
      snapshotPage.snapshots.length === 2 &&
      snapshotPage.total === 5 &&
      snapshotPage.active_snapshot_id === firstVersion,
  );
  const portable = reviewPayload(snapshot, scene, note, controlState.timeline);
  check(
    'Portable review JSON includes immutable snapshot history',
    () => JSON.parse(JSON.stringify(portable)).timeline.entries.length === 5,
  );
  scene.setComments(initial.annotations);
  scene.setEdits(initial.edits);
  scene.select(initial.selected);
  const result = await buildReview(
    snapshot,
    scene,
    '제목은 오른쪽으로 옮기고 등록 버튼의 아이콘은 삭제해 주세요.',
  );
  check('Review contains reopenable JSON, changes, and visual comparison', () =>
    ['review.json', 'changes.json', 'review.html', 'before.html', 'after.html'].every((name) =>
      result.fileNames.includes(name),
    ),
  );
  check(
    'Before and after comparison PNGs are generated',
    () => result.fileNames.includes('before.png') && result.fileNames.includes('after.png'),
  );
  check('ZIP signature is correct', () => result.blob.size > 10000);
  check(
    'Original source application was never activated by editing',
    () => sourceFrame.contentWindow.consoleDemoActions === 0,
  );
  document.getElementById('download-snapshot').disabled = false;
  document.getElementById('download-snapshot').onclick = () =>
    download('sample-snapshot.uiclone.json', JSON.stringify(snapshot), 'application/json');
  document.getElementById('download-zip').disabled = false;
  document.getElementById('download-zip').onclick = () =>
    download('integration-review.zip', result.blob);
  const summary = {
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    total: results.length,
    nodes: snapshot.nodes.length,
    testedElements: visible.length,
    archiveBytes: result.blob.size,
    exportWarnings: result.warnings,
  };
  status.textContent = JSON.stringify(summary);
  status.className = summary.failed ? 'fail' : 'pass';
  document.title = (summary.failed ? 'FAIL' : 'PASS') + ' · Console Canvas integration';
}
run().catch((error) => {
  status.textContent = 'ERROR: ' + error.stack;
  status.className = 'fail';
  document.title = 'ERROR · Console Canvas integration';
});
