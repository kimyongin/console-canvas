import { registerTicket, listTickets, getTicket, updateTicket } from '../ticket-model.js';
import { importDocument } from '../portable-document.js';
const frame = document.querySelector('#editor'),
  results = [];
function check(name, passed) {
  results.push({ name, passed: !!passed });
  document.querySelector('#results').textContent = JSON.stringify(results);
  if (!passed) throw Error(name);
}
async function until(read) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (await read()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw Error('Timed out: ' + read);
}
async function rejects(action, code) {
  try {
    await action();
    return false;
  } catch (e) {
    return !code || e.code === code;
  }
}
try {
  await until(() => frame.contentWindow.ConsoleCanvas?.state.ready);
  let app = frame.contentWindow.ConsoleCanvas,
    doc = frame.contentDocument,
    scene = app.state.scene;
  check(
    'Retired UI and runtime APIs are removed',
    !doc.querySelector('#snapshot-panel,#ai-dialog,#implementation-dialog,#snapshot-dropdown') &&
      !app.snapshotHistory &&
      !app.aiRequests &&
      !app.implementationReview,
  );
  const node = [...scene.nodes.values()].find((n) => n.locator.id === 'new-customer');
  scene.select(node.id);
  scene.nudge(12, 4);
  scene.setComment(node.id, '버튼을 제목과 같은 줄에 반응형으로 정렬');
  await app.flushEditor();
  check(
    'Requests panel shows current intent and edit without event filters',
    doc.querySelector('#requests-list').textContent.includes('반응형') &&
      !doc.querySelector('#activity-filter'),
  );
  const context = await app.controller.execute({
    name: 'get_design_context',
    document_id: app.state.snapshot.id,
    arguments: { editor_id: app.controller.metadata().editor_id },
    deadline: Date.now() / 1000 + 60,
  });
  check(
    'Visual context uses image blocks and coverage, never HTML/CSS',
    context.ok &&
      context.images.length > 0 &&
      !context.html &&
      !context.styles &&
      !!context.coverage,
  );
  doc.querySelector('#new-ticket-button').click();
  await until(() => doc.querySelector('#ticket-request'));
  check(
    'Selected comment prefills goal request without retyping',
    doc.querySelector('#ticket-request').value.includes('반응형'),
  );
  const input = doc.querySelector('#ticket-request');
  input.value = '제목과 버튼 정렬, 작은 화면에서 줄바꿈 유지';
  input.dispatchEvent(new frame.contentWindow.Event('input', { bubbles: true }));
  // Use model API for deterministic immutable goal + idempotency; UI submission is separately exercised below.
  doc.querySelector('#tickets-dialog').close();
  const canvas = document.createElement('canvas');
  canvas.width = 100;
  canvas.height = 60;
  canvas.getContext('2d').fillRect(0, 0, 100, 60);
  const image = canvas.toDataURL();
  const args = {
    project_id: app.state.project_id,
    document_id: app.state.snapshot.id,
    operation_id: crypto.randomUUID(),
    title: '확정 목표',
    request: '반응형으로 제목과 버튼 정렬',
    selection_confirmed: true,
    image_data_url: image,
    annotations: structuredClone(scene.annotations),
    source: app.state.snapshot.source,
  };
  const ticket = await registerTicket(args),
    goal = JSON.stringify(ticket.goal);
  check(
    'Retry registration returns same durable ticket',
    (await registerTicket(args)).id === ticket.id,
  );
  check(
    'Reusing receipt for different payload is rejected',
    await rejects(() => registerTicket({ ...args, title: '다른 목표' }), 'operation_id_reused'),
  );
  check(
    'Registration requires explicit selection',
    await rejects(
      () =>
        registerTicket({ ...args, operation_id: crypto.randomUUID(), selection_confirmed: false }),
      'selection_required',
    ),
  );
  scene.nudge(6, 0);
  scene.setComment(node.id, '이후에 바뀐 주석');
  await app.flushEditor();
  check(
    'Canvas changes cannot mutate fixed goal',
    JSON.stringify((await getTicket(ticket.id, args.project_id)).goal) === goal,
  );
  check(
    'Projects are isolated',
    !(await getTicket(ticket.id, 'other-project')) &&
      (await listTickets('other-project')).total === 0,
  );
  async function update(status, extras = {}) {
    return updateTicket({
      project_id: args.project_id,
      ticket_id: ticket.id,
      expected_revision: (await getTicket(ticket.id, args.project_id)).revision,
      operation_id: crypto.randomUUID(),
      status,
      summary: '격리 테스트 기록',
      ...extras,
    });
  }
  check(
    'Registration is not implementation authorization',
    await rejects(() => update('working'), 'instruction_required'),
  );
  await update('working', { implementation_instruction: '이 티켓을 구현해 주세요' });
  check(
    'Review requires image and verification evidence',
    await rejects(() => update('review'), 'evidence_required'),
  );
  const reviewed = await update('review', {
    implementation_image_data_url: image,
    checks: '고정 목표 및 좁은 화면에서 레이아웃 검증',
  });
  check(
    'Agent cannot finish without human approval record',
    await rejects(() => update('done'), 'approval_required'),
  );
  const done = await update('done', {
    review_decision: 'approved',
    review_note: '테스트 역할의 사람이 목표와 결과를 확인함',
  });
  check(
    'Approved implementation reaches done and preserves goal',
    done.status === 'done' && JSON.stringify(done.goal) === goal && done.records.length === 3,
  );
  check(
    'Stale ticket revision rejects overwrite',
    await rejects(
      () =>
        updateTicket({
          project_id: args.project_id,
          ticket_id: ticket.id,
          expected_revision: reviewed.revision,
          operation_id: crypto.randomUUID(),
          status: 'queued',
          summary: 'stale',
        }),
      'ticket_revision_conflict',
    ),
  );
  await update('queued');
  await update('blocked');
  check(
    'Same goal corrections and blocked states append records',
    (await getTicket(ticket.id, args.project_id)).records.length === 5,
  );
  const exported = await app.exportDocument();
  check(
    'Portable document contains fixed goal evidence',
    exported.version === 2 &&
      exported.tickets.some((t) => t.id === ticket.id && JSON.stringify(t.goal) === goal),
  );
  check(
    'Conflicting import cannot overwrite existing document',
    await rejects(() => importDocument(exported)),
  );
  const originalId = app.state.snapshot.id;
  doc.querySelector('#duplicate-document').click();
  await until(() => app.state.ready && app.state.snapshot.id !== originalId);
  scene = app.state.scene;
  scene.setComment(node.id, '독립 문서 주석');
  await app.flushEditor();
  const original = await (await import('../db.js')).getDocument(originalId);
  check(
    'Document copy is independent and tickets remain original',
    original.annotations[node.id] === '이후에 바뀐 주석' &&
      (await getTicket(ticket.id, args.project_id)).goal.document_id === originalId,
  );
  const id = app.state.snapshot.id;
  frame.src = '../editor.html?id=' + encodeURIComponent(id);
  await new Promise((r) => frame.addEventListener('load', r, { once: true }));
  await until(() => frame.contentWindow.ConsoleCanvas?.state.ready);
  app = frame.contentWindow.ConsoleCanvas;
  doc = frame.contentDocument;
  check(
    'Restart restores new current work and immutable ticket',
    app.state.scene.annotations[node.id] === '독립 문서 주석' &&
      JSON.stringify((await getTicket(ticket.id, args.project_id)).goal) === goal,
  );
  doc.querySelector('#tickets-button').click();
  await until(() => doc.querySelector('#ticket-list .ticket-row'));
  doc.querySelector('#ticket-list .ticket-row').click();
  await until(() => doc.querySelector('.ticket-image'));
  check(
    'Ticket list opens goal and work records in one dialog',
    doc.querySelectorAll('dialog[open]').length === 1 &&
      doc.querySelector('.ticket-request').textContent === args.request &&
      doc.querySelectorAll('.ticket-record').length === 5,
  );
  doc.querySelector('#tickets-dialog').close();
  // Create through the actual React form with an external selected image.
  doc.querySelector('#new-ticket-button').click();
  await until(() => doc.querySelector('#ticket-request'));
  function setInput(selector, value) {
    const el = doc.querySelector(selector);
    const proto =
      el.tagName === 'TEXTAREA'
        ? frame.contentWindow.HTMLTextAreaElement.prototype
        : frame.contentWindow.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new frame.contentWindow.Event('input', { bubbles: true }));
  }
  setInput('#ticket-title', '현재 편집 목표');
  setInput('#ticket-request', '현재 화면을 반응형 구현 기준으로 확정합니다.');
  await new Promise((r) => setTimeout(r, 50));
  doc.querySelector('#ticket-register').click();
  await until(
    () =>
      doc.querySelector('.ticket-request')?.textContent ===
      '현재 화면을 반응형 구현 기준으로 확정합니다.',
  );
  check(
    'UI registers current image and shows queued fixed goal',
    doc.querySelector('.ticket-image').src.startsWith('data:image/png') &&
      doc.querySelector('#tickets-content').textContent.includes('구현 대기'),
  );
  // File roundtrip recreates the original document and exact fixed goal in a clean slot.
  const { transact } = await import('../db.js');
  await transact(['captures', 'sessions', 'documents', 'tickets'], 'readwrite', (tx) => {
    for (const name of ['captures', 'sessions', 'documents'])
      tx.objectStore(name).delete(originalId);
    tx.objectStore('tickets').delete(ticket.id);
  });
  const bytes = JSON.stringify(exported);
  await app.importFile(
    new frame.contentWindow.File([bytes], 'backup.json', { type: 'application/json' }),
  );
  check(
    'Real file import restores current document and immutable ticket goal',
    app.state.snapshot.id === originalId &&
      JSON.stringify((await getTicket(ticket.id, args.project_id)).goal) === goal &&
      app.state.scene.annotations[node.id] === '이후에 바뀐 주석',
  );
  const malformed = structuredClone(exported);
  malformed.capture.id = crypto.randomUUID();
  malformed.tickets[0].goal.document_id = malformed.capture.id;
  malformed.tickets[0].goal.image.data_url = 'data:image/png;base64,' + btoa('not an image');
  check(
    'Invalid imported image leaves no partial document',
    (await rejects(() => importDocument(malformed))) &&
      !(await (await import('../db.js')).getDocument(malformed.capture.id)),
  );
  const replayArgs = {
    editor_id: app.controller.metadata().editor_id,
    project_id: app.state.project_id,
    expected_revision: app.state.revision,
    operation_id: crypto.randomUUID(),
    title: '응답 재시도 목표',
    request: '이 목표를 그대로 유지',
    selection_confirmed: true,
  };
  const invoke = () =>
    app.controller.execute({
      name: 'register_ticket',
      document_id: app.state.snapshot.id,
      arguments: replayArgs,
      deadline: Date.now() / 1000 + 60,
    });
  const registered = await invoke();
  check('Current-image MCP registration succeeds', registered.ok);
  app.state.scene.select(node.id);
  app.state.scene.nudge(5, 0);
  await app.flushEditor();
  const retried = await invoke();
  check(
    'Uncertain registration retries after canvas changes without rendering another goal',
    retried.ok && retried.replayed && retried.ticket.id === registered.ticket.id,
  );
  frame.src = '../editor.html?id=' + encodeURIComponent(originalId);
  await new Promise((r) => frame.addEventListener('load', r, { once: true }));
  await until(() => frame.contentWindow.ConsoleCanvas?.state.ready);
  app = frame.contentWindow.ConsoleCanvas;
  replayArgs.editor_id = app.controller.metadata().editor_id;
  const restarted = await invoke();
  check(
    'Registration receipt survives restart and a new editor identity',
    restarted.ok && restarted.replayed && restarted.ticket.id === registered.ticket.id,
  );
  const factory = frame.contentWindow.indexedDB,
    originalOpen = factory.open;
  let backup;
  try {
    factory.open = () => {
      throw new Error('QA storage unavailable');
    };
    backup = await app.exportDocument({ allowPartial: true });
  } finally {
    factory.open = originalOpen;
  }
  check(
    'Unavailable DB still permits clearly marked memory-only emergency backup',
    backup.backupWarnings.length === 1 &&
      backup.tickets.length === 0 &&
      backup.session.edits[node.id],
  );
  const countBefore = (await listTickets(args.project_id)).total,
    failedArgs = { ...args, operation_id: crypto.randomUUID(), title: '저장 실패 뒤 재시도' };
  const add = IDBObjectStore.prototype.add,
    hideExpected = (e) => {
      if (e.error?.name === 'QuotaExceededError') e.preventDefault();
    };
  let failed = false;
  addEventListener('error', hideExpected);
  try {
    IDBObjectStore.prototype.add = function (...values) {
      if (this.name === 'tickets') throw new DOMException('QA quota', 'QuotaExceededError');
      return add.apply(this, values);
    };
    failed = await rejects(() => registerTicket(failedArgs));
  } finally {
    IDBObjectStore.prototype.add = add;
    removeEventListener('error', hideExpected);
  }
  check(
    'Quota abort leaves neither partial ticket nor success receipt',
    failed && (await listTickets(args.project_id)).total === countBefore,
  );
  const retriedAfterFailure = await registerTicket(failedArgs);
  check(
    'Same operation can succeed after storage recovers',
    (await listTickets(args.project_id)).total === countBefore + 1 &&
      retriedAfterFailure.status === 'queued',
  );
  const race = await Promise.allSettled(
    ['first', 'second'].map((summary) =>
      updateTicket({
        project_id: args.project_id,
        ticket_id: retriedAfterFailure.id,
        expected_revision: 0,
        operation_id: crypto.randomUUID(),
        status: 'working',
        summary,
        implementation_instruction: 'QA human requested',
      }),
    ),
  );
  check(
    'Concurrent ticket writers cannot lose a record',
    race.filter((r) => r.status === 'fulfilled').length === 1 &&
      race.some((r) => r.status === 'rejected' && r.reason.code === 'ticket_revision_conflict') &&
      (await getTicket(retriedAfterFailure.id, args.project_id)).records.length === 1,
  );
  document.querySelector('#status').textContent = `PASS ${results.length} checks`;
  document.body.dataset.result = 'pass';
} catch (e) {
  console.error(e);
  document.querySelector('#status').textContent = 'FAIL ' + e.message;
  document.body.dataset.result = 'fail';
}
