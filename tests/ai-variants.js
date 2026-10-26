import { createAiRequests } from '../ai-requests.js';
import { buildCodeDocument } from '../code-patches.js';
import { getDocument } from '../db.js';
import { reviewPayload } from '../export.js';
const frame = document.querySelector('#editor'),
  results = [];
const wait = async (fn) => {
  const deadline = Date.now() + 20000;
  while (!fn()) {
    if (Date.now() > deadline) throw Error('Timed out');
    await new Promise((r) => setTimeout(r, 30));
  }
};
function check(name, passed) {
  results.push({ name, passed: !!passed });
  document.querySelector('#results').textContent = results
    .map((r) => (r.passed ? 'PASS ' : 'FAIL ') + r.name)
    .join('\n');
  if (!passed) throw Error(name);
}
try {
  await wait(() => frame.contentWindow.ConsoleCanvas?.state.ready);
  let app = frame.contentWindow.ConsoleCanvas,
    doc = frame.contentDocument,
    state = app.state,
    scene = state.scene;
  const button = [...scene.nodes.values()].find(
    (n) => n.locator?.id === 'new-customer' && n.tag === 'button',
  );
  app.selectNode(button.id);
  scene.setPosition(24, 16);
  scene.setComment(button.id, 'Keep the customer action prominent');
  const before = {
    revision: state.revision,
    undo: state.undo.length,
    active: state.timeline.activeId,
    html: scene.serialize(),
  };
  doc.querySelector('#component-comment').value = 'Uncommitted comment draft';
  state.commentTarget = button.id;
  const request = await app.aiRequests.create({ prompt: 'Three alternatives', count: 3 });
  check(
    'Freeze includes unsaved comment without changing revision, undo, active version or rendered canvas',
    request.baseline.annotations[button.id] === 'Uncommitted comment draft' &&
      state.revision === before.revision &&
      state.undo.length === before.undo &&
      state.timeline.activeId === before.active &&
      scene.serialize() === before.html,
  );
  const frozen = JSON.stringify(request.baseline);
  const candidates = [];
  for (const color of ['#ef4444', '#22c55e', '#3b82f6'])
    candidates.push(
      await app.aiRequests.register({
        request_id: request.id,
        name: color,
        summary: 'Color alternative',
        patches: [
          {
            type: 'style',
            element_id: button.id,
            properties: { 'background-color': color, 'border-radius': '12px' },
          },
        ],
      }),
    );
  check(
    'All candidates share the exact frozen baseline and do not auto-apply',
    state.revision === before.revision &&
      scene.codePatches.length === 0 &&
      app.aiRequests
        .find(request.id)
        .candidates.every(
          (c) => JSON.stringify(c.point.edits) === JSON.stringify(request.baseline.edits),
        ) &&
      JSON.stringify(app.aiRequests.find(request.id).baseline) === frozen,
  );
  doc.querySelector('#ai-variants-button').click();
  await wait(() => doc.querySelectorAll('[data-candidate-id]').length === 3);
  check(
    'Sparkle opens gallery with three real alternatives',
    doc.querySelector('#ai-dialog').open &&
      doc.querySelector('[data-candidate-id="' + candidates[1].id + '"]'),
  );
  doc.querySelector('[data-candidate-id="' + candidates[1].id + '"]').click();
  await wait(() => doc.querySelectorAll('.ai-preview iframe').length === 2);
  check(
    'Gallery compares baseline and selected candidate in scriptless HTML frames',
    [...doc.querySelectorAll('.ai-preview iframe')].every(
      (el) => el.getAttribute('sandbox') === 'allow-same-origin',
    ),
  );
  doc.querySelector('#ai-close').click();
  state.commentTarget = null;
  scene.setComment(button.id, 'New work after request');
  scene.setPosition(80, 32);
  const undoCount = state.undo.length;
  await app.aiRequests.apply(request.id, candidates[1].id);
  check(
    'Choosing candidate applies CSS as one undo step and restores frozen comment',
    state.undo.length === undoCount + 1 &&
      scene.elements.get(button.id).style.backgroundColor === 'rgb(34, 197, 94)' &&
      scene.annotations[button.id] === 'Uncommitted comment draft',
  );
  const storedRequest = app.aiRequests.find(request.id),
    candidateEntries = storedRequest.candidates.map((c) =>
      state.timeline.entries.find((e) => e.id === c.snapshotId),
    );
  check(
    'Alternatives form siblings under one frozen anchor, never a chain',
    new Set(candidateEntries.map((e) => e.parentId)).size === 1 &&
      candidateEntries[0].parentId === storedRequest.anchorId,
  );
  check(
    'Selection protects work made after request',
    state.timeline.entries.some(
      (e) =>
        e.kind === 'automatic' &&
        e.state.edits[button.id]?.dx === 80 &&
        e.state.annotations[button.id] === 'New work after request',
    ),
  );
  app.undo();
  check(
    'Undo restores code, geometry and comments together',
    scene.codePatches.length === 0 &&
      scene.edits[button.id].dx === 80 &&
      scene.annotations[button.id] === 'New work after request',
  );
  app.undo('redo');
  check(
    'Redo restores chosen HTML/CSS',
    scene.elements.get(button.id).style.backgroundColor === 'rgb(34, 197, 94)',
  );
  await app.snapshotHistory.restorePersisted(candidateEntries[0].id);
  check(
    'Can visit past and alternate future CSS versions',
    scene.elements.get(button.id).style.backgroundColor === 'rgb(239, 68, 68)',
  );
  await app.snapshotHistory.restorePersisted(candidateEntries[2].id);
  check(
    'Future alternative remains reachable',
    scene.elements.get(button.id).style.backgroundColor === 'rgb(59, 130, 246)',
  );
  const aliased = app.aiRequests.find(request.id).candidates[0];
  aliased.snapshotId = candidateEntries[1].id;
  await app.aiRequests.apply(request.id, aliased.id);
  check(
    'Candidate snapshot references cannot substitute different visible code',
    scene.elements.get(button.id).style.backgroundColor === 'rgb(239, 68, 68)' &&
      aliased.snapshotId !== candidateEntries[1].id,
  );
  const context = await app.controller.execute({
    name: 'get_ai_context',
    document_id: state.snapshot.id,
    arguments: { editor_id: app.controller.metadata().editor_id, request_id: request.id },
  });
  check(
    'MCP context reads the immutable baseline HTML and original locator',
    context.ok &&
      context.html.includes('data-uic-id="' + button.id + '"') &&
      context.baseline.annotations[button.id] === 'Uncommitted comment draft' &&
      context.elements.some((n) => n.id === button.id && n.locator.id === 'new-customer'),
  );
  const parent = scene.parent(button.id),
    patches = [
      ...scene.codePatches,
      {
        type: 'insert',
        element_id: parent,
        html: '<div data-uic-id="anew"><span data-uic-id="anewtext">Added</span></div>',
      },
      { type: 'text', element_id: 'anewtext', text: 'Editable text' },
      { type: 'style', element_id: 'anew', properties: { display: 'flex', gap: '12px' } },
      { type: 'reparent', element_id: 'anew', parent_id: scene.parent(parent) },
    ];
  scene.setCodePatches(patches);
  scene.setComment('anewtext', 'Generated node comment');
  check(
    'Insert, text, CSS and reparent preserve stable generated identities',
    scene.elements.get('anewtext').textContent === 'Editable text' &&
      scene.parent('anew') === scene.parent(parent) &&
      scene.nodes.get('anew').generated &&
      scene.nodes.get(button.id).locator.id === 'new-customer',
  );
  scene.setCodePatches([...patches, { type: 'remove', element_id: 'anew' }]);
  check(
    'Removed generated subtree keeps comment identity as deleted target',
    scene.comments().some((c) => c.id === 'anewtext' && c.targetDeleted),
  );
  const safe = scene.serialize(),
    nodes = new Map(state.snapshot.nodes.map((n) => [n.id, n]));
  for (const op of [
    { type: 'insert', element_id: parent, html: '<script>alert(1)</script>' },
    { type: 'insert', element_id: parent, html: '<div onclick="alert(1)">bad</div>' },
    {
      type: 'style',
      element_id: button.id,
      properties: { background: 'u\\72l(https://bad.test)' },
    },
    { type: 'stylesheet', css: '@import "https://bad.test"' },
    { type: 'reparent', element_id: parent, parent_id: button.id },
    { type: 'text', element_id: parent, text: 'Would destroy IDs' },
  ]) {
    let rejected = false;
    try {
      scene.setCodePatches([...patches, op]);
    } catch {
      rejected = true;
    }
    check(
      'Unsafe or identity-destroying patch is atomic: ' + op.type,
      rejected && scene.serialize() === safe,
    );
  }
  scene.setCodePatches(patches);
  scene.setComments({ ...scene.annotations, anewtext: 'Persist generated comment' });
  scene.select('anew');
  const generatedCopy = scene.pasteSelection(scene.copySelection())[0];
  scene.setCodePatches([...patches, { type: 'remove', element_id: 'anew' }]);
  check(
    'Copies remain visible when a later code patch removes their generated source',
    scene.elements.has(generatedCopy) &&
      !scene.hidden(generatedCopy) &&
      scene.nodes.get(generatedCopy).copiedFrom === 'anew',
  );
  scene.setCodePatches(patches);
  const custom = app.snapshotHistory.create('Structured code version');
  await state.saving;
  const payload = reviewPayload(
    state.snapshot,
    scene,
    'Code handoff',
    state.timeline,
    state.activity,
    state.activityHead,
    state.aiRequests,
  );
  check(
    'Portable file contains all candidates, code and branching versions',
    payload.aiRequests.length === 1 &&
      payload.codePatches.length === patches.length &&
      payload.timeline.entries.some((e) => e.id === custom.id),
  );
  const id = state.snapshot.id;
  await app.openSnapshot(
    {
      ...payload.snapshot,
      codePatches: payload.codePatches,
      aiRequests: payload.aiRequests,
      activity: payload.activity,
      activityHead: payload.activityHead,
    },
    payload.edits,
    payload.note,
    payload.annotations,
    payload.timeline,
  );
  state = app.state;
  scene = state.scene;
  await state.saving;
  const stored = await getDocument(id);
  check(
    'Reopen and IndexedDB preserve patches, comments and all candidate siblings',
    scene.elements.get('anewtext').textContent === 'Editable text' &&
      scene.annotations.anewtext === 'Persist generated comment' &&
      stored.aiRequests[0].candidates.length === 3 &&
      stored.codePatches.length === patches.length,
  );
  const second = await app.aiRequests.create({ count: 2 });
  await app.aiRequests.register({
    request_id: second.id,
    name: 'Complete before cancel',
    patches: [{ type: 'style', element_id: button.id, properties: { color: '#111111' } }],
  });
  await app.aiRequests.cancel(second.id);
  let rejected = false;
  try {
    await app.aiRequests.register({
      request_id: second.id,
      name: 'Late',
      patches: [{ type: 'style', element_id: button.id, properties: { color: '#fff' } }],
    });
  } catch {
    rejected = true;
  }
  check(
    'Cancel retains completed variants and rejects late submissions',
    rejected && app.aiRequests.find(second.id).candidates.length === 1,
  );
  let invalid = false;
  try {
    buildCodeDocument(state.snapshot.html, nodes, [
      { type: 'insert', element_id: parent, html: '<div data-uic-id="n1">wrong</div>' },
    ]);
  } catch {
    invalid = true;
  }
  check('Generated nodes cannot impersonate captured element IDs', invalid);
  doc.querySelector('#ai-variants-button').click();
  doc.querySelector('#ai-route').value = 'api';
  doc
    .querySelector('#ai-route')
    .dispatchEvent(new frame.contentWindow.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
  check(
    'API auth clearly distinguishes usage billing, memory storage and future OAuth',
    doc.querySelector('.ai-auth').textContent.includes('별도 과금') &&
      doc.querySelector('.ai-auth').textContent.includes('메모리') &&
      doc.querySelector('.ai-auth').textContent.includes('검증 후'),
  );
  const isolated = { ...state, aiRequests: JSON.parse(JSON.stringify(state.aiRequests)) };
  let fail = false;
  const failureManager = createAiRequests({
    state: isolated,
    checkpoint: () => ({
      edits: scene.edits,
      annotations: scene.annotations,
      note: '',
      selection: [],
      codePatches: scene.codePatches,
    }),
    save: () => {},
    flush: async () => {
      if (fail) throw Error('QA quota failure');
    },
  });
  const isolatedRequest = await failureManager.create({ count: 2 });
  fail = true;
  let quotaRejected = false;
  try {
    await failureManager.register({
      request_id: isolatedRequest.id,
      name: 'Must roll back',
      patches: [{ type: 'style', element_id: button.id, properties: { color: '#123456' } }],
    });
  } catch {
    quotaRejected = true;
  }
  check(
    'Candidate persistence failure leaves no partial candidate or active edit',
    quotaRejected &&
      failureManager.find(isolatedRequest.id).candidates.length === 0 &&
      failureManager.find(isolatedRequest.id).status === 'pending',
  );
  const regenerated = await app.aiRequests.create({
    basis_request_id: request.id,
    basis_candidate_id: candidates[1].id,
    count: 1,
  });
  check(
    'Regeneration can freeze an unselected alternative without applying',
    JSON.stringify(regenerated.baseline.codePatches) ===
      JSON.stringify(app.aiRequests.find(request.id).candidates[1].point.codePatches) &&
      scene.elements.get('anewtext').textContent === 'Editable text',
  );
  const apiFrame = document.createElement('iframe');
  apiFrame.src = '/tests/ai-api-editor.html?sample=1';
  document.body.append(apiFrame);
  await wait(() => apiFrame.contentWindow.ConsoleCanvas?.state.ready);
  const apiWindow = apiFrame.contentWindow,
    apiApp = apiWindow.ConsoleCanvas,
    apiDoc = apiFrame.contentDocument;
  const apiNode = [...apiApp.state.scene.nodes.values()].find(
    (n) => n.locator?.id === 'new-customer' && n.tag === 'button',
  );
  apiApp.selectNode(apiNode.id);
  apiDoc.querySelector('#context-ai').click();
  function input(selector, value) {
    const el = apiDoc.querySelector(selector);
    Object.getOwnPropertyDescriptor(
      apiWindow[el.tagName === 'TEXTAREA' ? 'HTMLTextAreaElement' : 'HTMLInputElement'].prototype,
      'value',
    ).set.call(el, value);
    el.dispatchEvent(new apiWindow.Event('input', { bubbles: true }));
  }
  apiDoc.querySelector('.ai-auth').open = true;
  input('#ai-api-key', 'qa-fake-key');
  input('#ai-model', 'qa-mock-model');
  apiDoc.querySelector('#ai-configure-api').click();
  await wait(() => apiDoc.querySelector('#ai-api-key').value === '');
  check(
    'API credential registration clears the password input',
    apiDoc.querySelector('.ai-auth').textContent.includes('키 등록됨'),
  );
  const route = apiDoc.querySelector('#ai-route');
  route.value = 'api';
  route.dispatchEvent(new apiWindow.Event('change', { bubbles: true }));
  input('#ai-prompt', 'Make three distinct candidates');
  const apiRevision = apiApp.state.revision;
  apiDoc.querySelector('#ai-create').click();
  await wait(() => apiApp.state.aiRequests[0]?.execution?.usage?.length === 3);
  check(
    'API UI generates three real candidates through shared engine without MCP or auto-apply',
    apiWindow.apiMockCalls.length === 3 &&
      apiWindow.apiMockCalls.every((call) =>
        call.body.input[0].content.some(
          (item) =>
            item.type === 'input_image' && item.image_url.startsWith('data:image/png;base64,'),
        ),
      ) &&
      apiApp.state.aiRequests[0].candidates.length === 3 &&
      apiApp.state.revision === apiRevision &&
      apiApp.state.scene.codePatches.length === 0,
  );
  await wait(() => apiDoc.querySelectorAll('[data-candidate-id]').length === 3);
  check(
    'Existing requests collapse the input form to prioritize previews',
    !apiDoc.querySelector('.ai-new-request').open &&
      apiDoc.querySelectorAll('.ai-preview').length === 2,
  );
  const apiPayload = reviewPayload(
    apiApp.state.snapshot,
    apiApp.state.scene,
    '',
    apiApp.state.timeline,
    apiApp.state.activity,
    apiApp.state.activityHead,
    apiApp.state.aiRequests,
  );
  check(
    'Credentials are absent from portable documents and model inputs',
    !JSON.stringify(apiPayload).includes('qa-fake-key') &&
      apiWindow.apiMockCalls.every((call) => !JSON.stringify(call.body).includes('qa-fake-key')),
  );
  const previewSelect = apiDoc.querySelector('.ai-preview select');
  previewSelect.value = '1';
  previewSelect.dispatchEvent(new apiWindow.Event('change', { bubbles: true }));
  check(
    'Candidate comparison keeps the same zoom on both sides',
    [...apiDoc.querySelectorAll('.ai-preview select')].every((el) => el.value === '1'),
  );
  apiDoc.querySelector('#ai-apply').click();
  await wait(() => !apiDoc.querySelector('#ai-dialog').open);
  check(
    'Explicit candidate application returns to live canvas with code changes',
    apiApp.state.scene.codePatches.length === 1 &&
      apiApp.state.timeline.entries.some((e) => e.name === 'API candidate 2'),
  );
  apiApp.undo();
  check('API-applied candidate uses shared undo', apiApp.state.scene.codePatches.length === 0);
  apiDoc.querySelector('#ai-variants-button').click();
  apiWindow.apiMockMode = 'wait';
  apiDoc.querySelector('#ai-regenerate-baseline').click();
  await wait(() => apiWindow.apiMockCalls.length === 4);
  apiDoc.querySelector('#ai-cancel-request').click();
  await wait(() => apiApp.state.aiRequests.at(-1).status === 'canceled');
  check(
    'UI cancellation stops API generation while retaining earlier candidates',
    apiApp.state.aiRequests[0].candidates.length === 3 &&
      apiApp.state.aiRequests.at(-1).candidates.length === 0,
  );
  apiDoc.querySelector('#ai-forget-api').click();
  await wait(() => !apiDoc.querySelector('.ai-auth').textContent.includes('키 등록됨'));
  check(
    'Forgetting API credentials does not delete requests or candidates',
    apiApp.state.aiRequests.length === 2 &&
      !apiDoc.querySelector('.ai-auth').textContent.includes('키 등록됨'),
  );
  // Regression coverage for the usability walkthrough (#45–#51).
  apiDoc.querySelector('#ai-close').click();
  await apiApp.snapshotHistory.restorePersisted(
    apiApp.state.aiRequests[0].candidates[1].snapshotId,
  );
  apiDoc.querySelector('#ai-variants-button').click();
  const currentId = apiApp.state.aiRequests[0].candidates[1].id;
  check(
    'Gallery follows the current version instead of defaulting to the first candidate',
    apiDoc.querySelector('[data-candidate-id="' + currentId + '"]').getAttribute('aria-pressed') ===
      'true' &&
      apiDoc
        .querySelector('[data-candidate-id="' + currentId + '"]')
        .textContent.includes('현재 캔버스'),
  );
  apiDoc.querySelector('#ai-close').click();
  apiApp.state.scene.setPosition(17, 19);
  apiDoc.querySelector('#ai-variants-button').click();
  check(
    'Manual edits do not retain a false current-canvas badge',
    !apiDoc.querySelector('.ai-current-badge'),
  );
  apiDoc.querySelector('#ai-close').click();
  apiApp.selectNode(apiNode.id);
  apiDoc.querySelector('#context-ai').click();
  check(
    'Element sparkle opens composition with visible target and basis',
    apiDoc.querySelector('.ai-new-request').open &&
      apiDoc.querySelector('#ai-context-summary').textContent.includes('고객 등록') &&
      apiDoc.querySelector('#ai-context-summary').textContent.includes('기준:'),
  );
  check(
    'Unconfigured API blocks generation and exposes setup before submission',
    apiDoc.querySelector('.ai-auth').open &&
      apiDoc.querySelector('#ai-create').disabled &&
      apiDoc.querySelector('#ai-readiness').textContent.includes('키와 모델'),
  );
  input('#ai-prompt', 'Preserve my unsent design instructions');
  input('#ai-count', '5');
  await apiApp.state.saving;
  const savedId = apiApp.state.snapshot.id;
  apiDoc.querySelector('#ai-close').click();
  apiDoc.querySelector('#ai-variants-button').click();
  check(
    'Closing and reopening keeps prompt, count and route draft',
    apiDoc.querySelector('#ai-prompt').value === 'Preserve my unsent design instructions' &&
      apiDoc.querySelector('#ai-count').value === '5' &&
      apiDoc.querySelector('#ai-route').value === 'api',
  );
  const draftDocument = await getDocument(savedId);
  check(
    'Persisted draft contains only allowed non-secret fields',
    draftDocument.aiDraft.prompt === 'Preserve my unsent design instructions' &&
      Object.keys(draftDocument.aiDraft).sort().join(',') === 'count,prompt,route' &&
      !JSON.stringify(draftDocument).includes('qa-fake-key'),
  );
  const draftPayload = reviewPayload(
    apiApp.state.snapshot,
    apiApp.state.scene,
    '',
    apiApp.state.timeline,
    apiApp.state.activity,
    apiApp.state.activityHead,
    apiApp.state.aiRequests,
    { ...apiApp.state.aiDraft, key: 'must-not-export', model: 'must-not-export' },
  );
  await apiApp.importFile(
    new apiWindow.File([JSON.stringify(draftPayload)], 'draft-roundtrip.uiclone.json'),
  );
  check(
    'Portable file roundtrip preserves draft, code, comments and candidates without credential fields',
    apiApp.state.aiDraft.prompt === 'Preserve my unsent design instructions' &&
      apiApp.state.aiDraft.count === 5 &&
      apiApp.state.aiRequests[0].candidates.length === 3 &&
      apiApp.state.scene.codePatches.length > 0 &&
      !JSON.stringify(draftPayload).includes('must-not-export'),
  );
  const other = await (await fetch('../sample.uiclone.json')).json();
  other.id = crypto.randomUUID();
  await apiApp.openSnapshot(other);
  apiDoc.querySelector('#ai-variants-button').click();
  check(
    'A different document never inherits another document request draft',
    apiDoc.querySelector('#ai-prompt').value === '' &&
      apiDoc.querySelector('#ai-count').value === '3',
  );
  const previousGraphHeight = localStorage.getItem('console-canvas-graph-height');
  localStorage.setItem('console-canvas-graph-height', '360');
  const loaded = new Promise((resolve) =>
    apiFrame.addEventListener('load', resolve, { once: true }),
  );
  apiFrame.src = '/editor.html?id=' + savedId;
  await loaded;
  await wait(() => apiFrame.contentWindow.ConsoleCanvas?.state.ready);
  const restarted = apiFrame.contentDocument;
  restarted.querySelector('#ai-variants-button').click();
  check(
    'A fresh renderer restores the per-document draft and existing candidates',
    restarted.querySelector('#ai-prompt').value === 'Preserve my unsent design instructions' &&
      restarted.querySelector('#ai-count').value === '5' &&
      apiFrame.contentWindow.ConsoleCanvas.state.aiRequests[0].candidates.length === 3,
  );
  restarted.querySelector('#ai-reset-draft').click();
  await wait(() => restarted.querySelector('#ai-prompt').value === '');
  check(
    'Explicit reset clears only the composition draft',
    restarted.querySelector('#ai-prompt').value === '' &&
      apiFrame.contentWindow.ConsoleCanvas.state.aiRequests.length === 2,
  );
  restarted.querySelector('#ai-create').click();
  await wait(() => apiFrame.contentWindow.ConsoleCanvas.state.aiRequests.length === 3);
  await wait(() =>
    restarted.querySelector('.ai-waiting')?.textContent.includes('자동으로 실행되지는'),
  );
  check(
    'MCP request storage is clearly distinguished from automatic execution',
    restarted.querySelector('#ai-request-state').textContent.includes('수동') &&
      restarted.querySelector('.ai-waiting').textContent.includes('자동으로 실행되지는') &&
      restarted.querySelector('#ai-connect-agent'),
  );
  restarted.querySelector('#ai-close').click();
  // Exercise actual layout geometry at short and narrow viewports.
  apiFrame.style.width = '1280px';
  apiFrame.style.height = '720px';
  const lastRequest = apiFrame.contentWindow.ConsoleCanvas.state.aiRequests[0];
  await apiFrame.contentWindow.ConsoleCanvas.snapshotHistory.restorePersisted(
    lastRequest.candidates[1].snapshotId,
  );
  restarted.querySelector('#ai-variants-button').click();
  await wait(() => restarted.querySelectorAll('.ai-preview iframe').length === 2);
  await new Promise((resolve) =>
    apiFrame.contentWindow.requestAnimationFrame(() =>
      apiFrame.contentWindow.requestAnimationFrame(resolve),
    ),
  );
  const layoutFits = () => {
    const a = restarted.querySelector('.ai-review-workspace').getBoundingClientRect();
    const b = restarted.querySelector('#ai-apply').getBoundingClientRect();
    return (
      a.height > 180 && a.bottom <= b.top + 1 && b.bottom <= apiFrame.contentWindow.innerHeight
    );
  };
  check(
    '720px review keeps candidate controls and full comparison viewport above apply',
    layoutFits(),
  );
  apiFrame.style.width = '700px';
  apiFrame.style.height = '600px';
  await new Promise((resolve) =>
    apiFrame.contentWindow.requestAnimationFrame(() =>
      apiFrame.contentWindow.requestAnimationFrame(resolve),
    ),
  );
  check(
    'Narrow review retains comparison and apply without horizontal page overflow',
    layoutFits() &&
      restarted.querySelector('.ai-review-workspace').getBoundingClientRect().right <= 700,
  );
  restarted.querySelector('#ai-close').click();
  apiFrame.style.width = '1280px';
  apiFrame.style.height = '720px';
  restarted.querySelector('#snapshot-dropdown').click();
  await wait(() => restarted.querySelector('#snapshot-preview-view iframe'));
  await new Promise((resolve) =>
    apiFrame.contentWindow.requestAnimationFrame(() =>
      apiFrame.contentWindow.requestAnimationFrame(resolve),
    ),
  );
  const previewRect = restarted.querySelector('#snapshot-preview-view').getBoundingClientRect();
  check(
    'Snapshot graph reserves visible preview area in a 720px window',
    previewRect.height >= 110 && previewRect.top < 600 && previewRect.bottom <= 720,
  );
  if (previousGraphHeight === null) localStorage.removeItem('console-canvas-graph-height');
  else localStorage.setItem('console-canvas-graph-height', previousGraphHeight);
  document.querySelector('#status').textContent = JSON.stringify({
    passed: results.length,
    failed: 0,
    total: results.length,
  });
  document.body.dataset.result = 'pass';
} catch (error) {
  document.querySelector('#status').textContent = error.stack;
  document.body.dataset.result = 'fail';
}
