import { reviewPayload, instructionText } from '../export.js';
const frame = document.querySelector('#editor'),
  results = [];
function check(name, passed) {
  results.push({ name, passed: !!passed });
  document.querySelector('#results').textContent = JSON.stringify(results);
  if (!passed) throw new Error(name);
}
async function until(read) {
  const end = Date.now() + 25000;
  while (Date.now() < end) {
    if (await read()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('Timed out');
}
try {
  await until(() => frame.contentWindow.ConsoleCanvas?.state.ready);
  let app = frame.contentWindow.ConsoleCanvas,
    doc = frame.contentDocument,
    scene = app.state.scene;
  const first = [...scene.nodes.values()].find((n) => n.locator.id === 'new-customer'),
    second = [...scene.nodes.values()].find((n) => n.tag === 'button' && n.name === '내보내기');
  const root = doc.documentElement,
    oldSet = root.setPointerCapture,
    oldHas = root.hasPointerCapture;
  root.setPointerCapture = () => {};
  root.hasPointerCapture = () => false;
  const sceneRoot = scene.doc.documentElement,
    oldSceneSet = sceneRoot.setPointerCapture,
    oldSceneHas = sceneRoot.hasPointerCapture;
  sceneRoot.setPointerCapture = () => {};
  sceneRoot.hasPointerCapture = () => false;
  const before = JSON.stringify([
    scene.edits,
    app.state.undo.length,
    app.state.redo.length,
    app.state.revision,
  ]);
  const v = doc.querySelector('#viewport'),
    f = doc.querySelector('#scene-frame');
  function pointer(target, type, x, y, extra = {}) {
    target.dispatchEvent(
      new frame.contentWindow.PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 71,
        button: 0,
        clientX: x,
        clientY: y,
        ...extra,
      }),
    );
  }
  function outerBox(ids, extra = {}) {
    const boxes = ids.map((id) => scene.rect(id)),
      r = f.getBoundingClientRect();
    const left = Math.min(...boxes.map((b) => b.x)),
      top = Math.min(...boxes.map((b) => b.y)),
      right = Math.max(...boxes.map((b) => b.x + b.width)),
      bottom = Math.max(...boxes.map((b) => b.y + b.height));
    pointer(
      v,
      'pointerdown',
      r.left + (left - 2) * app.state.zoom,
      r.top + (top - 2) * app.state.zoom,
      extra,
    );
    pointer(
      root,
      'pointermove',
      r.left + (right + 2) * app.state.zoom,
      r.top + (bottom + 2) * app.state.zoom,
      extra,
    );
    return { x: r.left + (right + 2) * app.state.zoom, y: r.top + (bottom + 2) * app.state.zoom };
  }
  let p = outerBox([first.id, second.id]);
  const selectedOrAncestor = (id) =>
    scene.selection.has(id) || scene.ancestors(id).some((p) => scene.selection.has(p));
  check(
    'Area preview chooses contained roots and deduplicates text/icon descendants',
    selectedOrAncestor(first.id) &&
      selectedOrAncestor(second.id) &&
      scene.selection.size <= 2 &&
      scene.selection.size > 0 &&
      !doc.querySelector('.area-selection').hidden,
  );
  const busy = await app.controller.execute({
    name: 'apply_edits',
    document_id: app.state.snapshot.id,
    deadline: Date.now() / 1000 + 30,
    arguments: {
      editor_id: app.controller.metadata().editor_id,
      expected_revision: app.state.revision,
      operation_id: 'area-busy',
      operations: [{ type: 'move', element_id: first.id, dx: 1, dy: 1, mode: 'relative' }],
    },
  });
  check('MCP refuses writes during a live area gesture', busy.error?.code === 'editor_busy');
  pointer(root, 'pointerup', p.x, p.y);
  check(
    'Area selection leaves geometry, revision and undo/redo unchanged',
    JSON.stringify([
      scene.edits,
      app.state.undo.length,
      app.state.redo.length,
      app.state.revision,
    ]) === before &&
      !scene.areaSelecting &&
      doc.querySelector('.area-selection').hidden,
  );
  app.selectNode(first.id);
  p = outerBox([second.id], { ctrlKey: true });
  pointer(root, 'pointerup', p.x, p.y, { ctrlKey: true });
  check(
    'Ctrl area gesture adds to an existing selection',
    scene.selection.has(first.id) && scene.selection.has(second.id),
  );
  p = outerBox([second.id]);
  root.dispatchEvent(
    new frame.contentWindow.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  check(
    'Escape restores the complete pre-gesture selection',
    scene.selection.has(first.id) && scene.selection.has(second.id) && !scene.areaSelecting,
  );
  const r = f.getBoundingClientRect(),
    a = scene.rect(first.id);
  pointer(
    v,
    'pointerdown',
    r.left + (a.x + 1) * app.state.zoom,
    r.top + (a.y + 1) * app.state.zoom,
  );
  pointer(
    root,
    'pointermove',
    r.left + (a.x + a.width - 1) * app.state.zoom,
    r.top + (a.y + a.height - 1) * app.state.zoom,
  );
  pointer(
    root,
    'pointerup',
    r.left + (a.x + a.width - 1) * app.state.zoom,
    r.top + (a.y + a.height - 1) * app.state.zoom,
  );
  check('Partial overlap never selects the outer button', !scene.selection.has(first.id));
  // Source-document coordinates remain correct when starting inside the cloned blank body.
  scene.select(null);
  const br = scene.rect(first.id);
  pointer(scene.doc.body, 'pointerdown', br.x - 2, br.y - 2);
  pointer(sceneRoot, 'pointermove', br.x + br.width + 2, br.y + br.height + 2);
  pointer(sceneRoot, 'pointerup', br.x + br.width + 2, br.y + br.height + 2);
  check(
    'Starting in cloned-page background selects without moving its body',
    scene.selection.has(first.id) && !scene.drag && !scene.areaSelecting && !scene.edits.n1,
  );
  const stats = [...scene.nodes.values()].find(
    (n) => n.tag === 'section' && n.name.startsWith('전체 고객 128 명'),
  );
  const statText = [...scene.nodes.values()].find(
    (n) => n.kind === 'text' && n.name === '128' && scene.ancestors(n.id).includes(stats.id),
  );
  app.selectNode(stats.id);
  app.selectNode(first.id, { additive: true });
  const childrenBefore = app.state.undo.length;
  pointer(scene.elements.get(statText.id), 'pointerdown', 10, 10);
  pointer(sceneRoot, 'pointermove', 30, 35);
  pointer(sceneRoot, 'pointerup', 30, 35);
  check(
    'Dragging text inside a selected container moves the complete selection as one undo step',
    scene.selection.size === 2 &&
      scene.edits[stats.id]?.dx === 20 &&
      scene.edits[first.id]?.dx === 20 &&
      !scene.edits[statText.id] &&
      app.state.undo.length === childrenBefore + 1,
  );
  app.undo();
  pointer(scene.elements.get(statText.id), 'pointerdown', 10, 10, { altKey: true });
  pointer(sceneRoot, 'pointerup', 10, 10, { altKey: true });
  check(
    'Alt retains explicit access to a child inside the selected group',
    scene.selected === statText.id && scene.selection.size === 1,
  );
  app.selectNode(first.id);
  pointer(scene.elements.get(stats.id), 'pointerdown', 10, 10, { metaKey: true });
  pointer(sceneRoot, 'pointerup', 10, 10, { metaKey: true });
  check(
    'Cmd-click on container background adds it even without a marquee drag',
    scene.selection.has(first.id) && scene.selection.has(stats.id),
  );
  check(
    'Multi-selection inspector presents group controls first and labels its delete scope and bounds',
    doc.querySelector('#direct-edit-controls').getBoundingClientRect().top <
      doc.querySelector('#inspector-comment-host').getBoundingClientRect().top &&
      doc.querySelector('#inspector-delete').textContent === '선택한 2개 삭제' &&
      doc.querySelector('#element-size').textContent.startsWith('선택 영역'),
  );
  root.setPointerCapture = oldSet;
  root.hasPointerCapture = oldHas;
  sceneRoot.setPointerCapture = oldSceneSet;
  sceneRoot.hasPointerCapture = oldSceneHas;
  scene.setComment(first.id, '복사한 주석');
  app.selectNode(first.id);
  app.selectNode(second.id, { additive: true });
  const transfer = new frame.contentWindow.DataTransfer();
  scene.doc.dispatchEvent(
    new frame.contentWindow.ClipboardEvent('copy', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    }),
  );
  const clip = JSON.parse(transfer.getData('text/plain'));
  check(
    'Copy event includes every root and its captured descendants',
    clip.items.length === 2 && clip.items[0].nodes.length > 1,
  );
  const undoBefore = app.state.undo.length,
    originalRects = [scene.rect(first.id), scene.rect(second.id)];
  scene.doc.dispatchEvent(
    new frame.contentWindow.ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    }),
  );
  const pasted = [...scene.selection],
    copyRoot = pasted.find((id) => scene.nodes.get(id).copiedFrom === first.id),
    child = (scene.children.get(copyRoot) || [])[0];
  check(
    'Paste creates independently selectable roots as one undo step',
    pasted.length === 2 &&
      pasted.every((id) => scene.nodes.has(id)) &&
      app.state.undo.length === undoBefore + 1 &&
      Math.abs(scene.rect(copyRoot).x - originalRects[0].x - 24) < 1,
  );
  check(
    'Copy retains descendant geometry, comments and addition intent',
    !!child &&
      scene.annotations[copyRoot] === '복사한 주석' &&
      scene.changes().filter((c) => c.action === 'copy').length === 2 &&
      scene.serialize().includes(copyRoot),
  );
  const copiedText = (scene.children.get(copyRoot) || []).find((n) => n.kind === 'text'),
    type = scene.frame.contentWindow.getComputedStyle(scene.elements.get(copiedText.id));
  check(
    'Copied text keeps typography without duplicating its button background or padding',
    type.paddingLeft === '0px' &&
      type.backgroundColor === 'rgba(0, 0, 0, 0)' &&
      type.color === scene.frame.contentWindow.getComputedStyle(scene.elements.get(first.id)).color,
  );
  const again = scene.pasteSelection(scene.copySelection());
  check(
    'A copy can be copied again without tying it to the earlier instance',
    again.every(
      (id) =>
        scene.nodes.get(id).copiedFrom === first.id || scene.nodes.get(id).copiedFrom === second.id,
    ),
  );
  app.undo();
  scene.remove(copyRoot);
  doc.querySelector('#export-button').click();
  await until(() =>
    doc.querySelector('#handoff-items').textContent.includes('삭제된 복사본의 주석'),
  );
  check(
    'Handoff distinguishes deleted copies and their comments from captured-element deletions',
    doc.querySelector('#handoff-items').textContent.includes('복사본 삭제') &&
      doc.querySelector('#export-summary').textContent.includes('삭제 0개') &&
      doc.querySelector('#export-summary').textContent.includes('복사본 삭제 1개') &&
      instructionText(app.state.snapshot, scene.changes(), '', scene.comments()).includes(
        '참조 원본 ' + first.id + '은 유지',
      ),
  );
  doc.querySelector('#export-dialog').close();
  app.undo();
  scene.nudge(10, 5);
  check(
    'Moving pasted roots never moves their originals',
    Math.abs(scene.rect(first.id).x - originalRects[0].x) < 1 && scene.offset(copyRoot).x === 10,
  );
  app.undo();
  const copiedVersion = app.snapshotHistory.create('복사본 포함');
  app.undo();
  check(
    'Undo paste removes the complete cloned subtree',
    pasted.every((id) => !scene.nodes.has(id)) && !scene.elements.has(child.id),
  );
  app.undo('redo');
  check(
    'Redo restores copy identities and comments',
    pasted.every((id) => scene.nodes.has(id)) && scene.annotations[copyRoot] === '복사한 주석',
  );
  const original = app.state.timeline.entries[0].id;
  app.snapshotHistory.restore(original);
  check('Old snapshots do not show future copies', !scene.nodes.has(copyRoot));
  app.snapshotHistory.restore(copiedVersion.id);
  check(
    'Returning to a later snapshot restores its copies',
    scene.nodes.has(copyRoot) && scene.annotations[copyRoot] === '복사한 주석',
  );
  const savedComments = JSON.stringify(scene.annotations);
  await scene.beforeHtml();
  check(
    'Before/after export preserves current copy comments and selection',
    JSON.stringify(scene.annotations) === savedComments && scene.nodes.has(copyRoot),
  );
  const payload = JSON.stringify(reviewPayload(app.state.snapshot, scene, '', app.state.timeline));
  await app.importFile(new frame.contentWindow.File([payload], 'copies.uiclone.json'));
  scene = app.state.scene;
  check(
    'File roundtrip retains copy descriptors, comments and snapshot futures',
    scene.nodes.has(copyRoot) &&
      scene.annotations[copyRoot] === '복사한 주석' &&
      app.state.timeline.entries.some((e) => e.id === copiedVersion.id),
  );
  await app.state.saving;
  const id = app.state.snapshot.id;
  frame.src = '../editor.html?id=' + encodeURIComponent(id);
  await new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  await until(() => frame.contentWindow.ConsoleCanvas?.state.ready);
  app = frame.contentWindow.ConsoleCanvas;
  scene = app.state.scene;
  doc = frame.contentDocument;
  check(
    'IndexedDB reopen reconstructs copied DOM and comments from immutable source references',
    scene.nodes.has(copyRoot) &&
      scene.elements.has(child.id) &&
      scene.annotations[copyRoot] === '복사한 주석',
  );
  const field = doc.querySelector('#layer-search'),
    textTransfer = new frame.contentWindow.DataTransfer();
  textTransfer.setData('text/plain', '일반 텍스트');
  const textEvent = new frame.contentWindow.ClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    clipboardData: textTransfer,
  });
  field.dispatchEvent(textEvent);
  check(
    'Real editor input fields retain native text clipboard behavior',
    !textEvent.defaultPrevented,
  );
  document.querySelector('#status').textContent = JSON.stringify({
    passed: results.length,
    failed: 0,
    total: results.length,
  });
  document.body.dataset.result = 'pass';
} catch (error) {
  document.querySelector('#status').textContent = 'FAILED: ' + error.stack;
  document.body.dataset.result = 'fail';
}
