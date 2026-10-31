import {
  createTicket,
  getTicket,
  listTickets,
  confirmTicketGoal,
  updateTicket,
} from '../ticket-model.js';
import {
  getDocument,
  setProjectAccess,
  trashDocument,
  restoreDocument,
  sharedProjects,
  renameDocument,
  transact,
  saveSession,
} from '../db.js';
import { importDocument } from '../portable-document.js';
const frame = document.querySelector('#editor'),
  results = [];
function check(name, value) {
  results.push({ name, passed: !!value });
  document.querySelector('#results').textContent = JSON.stringify(results);
  if (!value) throw Error(name);
}
async function until(read) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (await read()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw Error('Timeout: ' + read);
}
async function rejects(run, code) {
  try {
    await run();
    return false;
  } catch (e) {
    return !code || e.code === code;
  }
}
try {
  await until(() => frame.contentWindow.ConsoleCanvas?.state.ready);
  let app = frame.contentWindow.ConsoleCanvas,
    doc = frame.contentDocument;
  const initial = app.state.snapshot.id,
    project = app.state.project_id;
  let ticket = await getTicket(initial, project);
  check(
    'Every imported capture already belongs to a draft ticket',
    ticket.status === 'draft' &&
      !ticket.goal &&
      ticket.id === initial &&
      ticket.display_id.startsWith('CC-'),
  );
  const originalId = ticket.id;
  await setProjectAccess(project, true);
  await app.ticketWorkspace.permissions();
  const call = (name, args = {}) =>
    app.ticketWorkspace.execute({ name, arguments: args, deadline: Date.now() / 1000 + 60 });
  let node = [...app.state.scene.nodes.values()].find((n) => n.locator.id === 'new-customer');
  app.state.scene.select(node.id);
  app.state.scene.nudge(12, 4);
  app.state.scene.setComment(node.id, '고객 등록을 제목과 정렬, 모바일에서는 전체 너비');
  await app.flushEditor();
  const read = await call('get_ticket', { ticket_ref: ticket.display_id });
  check(
    'Display ID reads current images and associated comments without a screen ID',
    read.ok && read.images.length && read.ticket.workspace.annotations[node.id].includes('모바일'),
  );
  check(
    'Current images are identified separately from an unconfirmed goal',
    read.images.every((i) => i.role === 'current') && !read.ticket.goal,
  );
  const other = await call('get_ticket', { ticket_ref: ticket.id, project_id: 'unrelated' });
  check('An unrelated project is not exposed', !other.ok && other.error.code === 'not_authorized');
  const blank = await createTicket({
    project_id: project,
    title: '비어 있는 티켓',
    operation_id: 'blank-create',
  });
  check(
    'Blank creation is replay safe and independent of goals',
    (
      await createTicket({
        project_id: project,
        title: '비어 있는 티켓',
        operation_id: 'blank-create',
      })
    ).id === blank.id && !blank.goal,
  );
  check(
    'Reusing a create operation with other input is rejected',
    await rejects(
      () => createTicket({ project_id: project, title: '다른 이름', operation_id: 'blank-create' }),
      'operation_id_reused',
    ),
  );
  await app.openTicket(blank.id);
  const beforeUI = app.state.snapshot.id;
  let closed = await call('get_ticket', { ticket_ref: originalId });
  check(
    'Closed ticket reads render saved edits without changing the visible ticket',
    closed.ok && closed.images.length && app.state.snapshot.id === beforeUI,
  );
  const revision = closed.ticket.workspace.edit_revision;
  const edited = await call('apply_edits', {
    ticket_ref: originalId,
    expected_edit_revision: revision,
    operation_id: 'closed-move',
    operations: [{ type: 'move', element_id: node.id, dx: 10, dy: 0, mode: 'relative' }],
  });
  check(
    'Closed ticket editing uses the shared saved session',
    edited.ok && edited.persisted && (await getDocument(originalId)).edits[node.id].dx === 22,
  );
  const stale = await call('apply_edits', {
    ticket_ref: originalId,
    expected_edit_revision: revision,
    operation_id: 'stale-move',
    operations: [{ type: 'move', element_id: node.id, dx: 100, dy: 0, mode: 'relative' }],
  });
  check(
    'Stale edit revision cannot overwrite work',
    !stale.ok && stale.error.code === 'revision_conflict',
  );
  const undo = await call('undo', {
    ticket_ref: originalId,
    expected_edit_revision: edited.screen.revision,
    operation_id: 'closed-undo',
  });
  check(
    'Closed ticket undo restores the actual previous edit',
    undo.ok && (await getDocument(originalId)).edits[node.id].dx === 12,
  );
  const replay = await call('apply_edits', {
    ticket_ref: originalId,
    expected_edit_revision: revision,
    operation_id: 'closed-move',
    operations: [{ type: 'move', element_id: node.id, dx: 10, dy: 0, mode: 'relative' }],
  });
  check(
    'Durable editing receipt prevents duplicate writes even after undo',
    replay.ok && replay.replayed && (await getDocument(originalId)).edits[node.id].dx === 12,
  );
  await renameDocument(originalId, '고객 검색 개선');
  check(
    'An exact name resolves to the same stable ticket ID',
    (await call('get_ticket', { ticket_ref: '고객 검색 개선' })).ticket.id === originalId,
  );
  const twin = await createTicket({
    project_id: project,
    title: '고객 검색 개선',
    operation_id: 'same-name',
  });
  const ambiguous = await call('get_ticket', { ticket_ref: '고객 검색 개선' });
  check(
    'Duplicate names return only scoped candidates instead of guessing',
    !ambiguous.ok &&
      ambiguous.error.code === 'ambiguous_ticket' &&
      ambiguous.error.candidates.length === 2,
  );
  await trashDocument(twin.id);
  check(
    'Trash immediately removes tickets from agent lookup',
    !(await call('get_ticket', { ticket_ref: twin.id })).ok,
  );
  await restoreDocument(twin.id);
  check('Recover restores the same ticket ID', (await getTicket(twin.id)).id === twin.id);
  await setProjectAccess(project, false);
  check(
    'Revoking access hides list and image/detail paths',
    !(await call('get_ticket', { ticket_ref: originalId })).ok &&
      (await call('list_tickets', {})).total === 0,
  );
  await setProjectAccess(project, true);
  const canvas = document.createElement('canvas');
  canvas.width = 80;
  canvas.height = 50;
  canvas.getContext('2d').fillRect(0, 0, 80, 50);
  const image = canvas.toDataURL();
  let fresh = await getTicket(originalId);
  const saved = await getDocument(originalId);
  const goalArgs = {
    ticket_id: originalId,
    project_id: project,
    expected_revision: fresh.revision,
    expected_edit_revision: saved.edit_revision,
    operation_id: 'confirm-once',
    image_data_url: image,
    request: '제목과 정렬, 모바일 줄바꿈',
    selection_confirmed: true,
    source: saved.source,
    annotations: saved.annotations,
  };
  ticket = await confirmTicketGoal(goalArgs);
  const goal = JSON.stringify(ticket.goal);
  check(
    'Goal confirmation transitions the SAME ticket to queued',
    ticket.id === originalId && ticket.status === 'queued' && !!ticket.goal.id,
  );
  check(
    'Goal confirmation retry is idempotent',
    (await confirmTicketGoal(goalArgs)).goal.id === ticket.goal.id,
  );
  check(
    'Goal cannot be silently replaced',
    await rejects(
      () => confirmTicketGoal({ ...goalArgs, operation_id: 'replace' }),
      'goal_already_confirmed',
    ),
  );
  const draftUpdate = {
    ticket_id: blank.id,
    project_id: project,
    expected_revision: blank.revision,
    operation_id: 'invalid-working',
    status: 'working',
    summary: 'start',
    implementation_instruction: 'human',
  };
  check(
    'A draft cannot enter implementation before goal confirmation',
    await rejects(() => updateTicket(draftUpdate), 'invalid_transition'),
  );
  async function update(status, extras = {}) {
    const current = await getTicket(originalId);
    return updateTicket({
      ticket_id: originalId,
      project_id: project,
      expected_revision: current.revision,
      goal_id: current.goal.id,
      operation_id: crypto.randomUUID(),
      status,
      summary: '실제 QA 기록',
      ...extras,
    });
  }
  check(
    'Starting implementation requires a human instruction',
    await rejects(() => update('working'), 'instruction_required'),
  );
  await update('working', { implementation_instruction: '이 티켓을 구현해 주세요' });
  check(
    'Review requires implementation evidence',
    await rejects(() => update('review'), 'evidence_required'),
  );
  await update('review', { implementation_image_data_url: image, checks: '가상 반응형 결과 검증' });
  check(
    'Human approval cannot be inferred from test success',
    await rejects(() => update('done'), 'approval_required'),
  );
  await update('done', {
    review_decision: 'approved',
    review_note: '가상 검토자가 목표와 결과를 확인함',
  });
  check(
    'Records and completion retain the fixed goal',
    JSON.stringify((await getTicket(originalId)).goal) === goal &&
      (await getTicket(originalId)).records.length === 3,
  );
  await app.openTicket(originalId);
  app.state.scene.select(node.id);
  app.state.scene.nudge(3, 0);
  await app.flushEditor();
  check(
    'Further manual editing does not overwrite the confirmed goal',
    JSON.stringify((await getTicket(originalId)).goal) === goal,
  );
  const exported = await app.exportDocument();
  check(
    'Ticket backup owns edits and fixed goal',
    exported.format === 'console-canvas-ticket' &&
      exported.version === 3 &&
      exported.tickets.length === 1 &&
      exported.tickets[0].id === originalId,
  );
  check(
    'Conflicting backup import leaves the original intact',
    (await rejects(() => importDocument(exported))) &&
      JSON.stringify((await getTicket(originalId)).goal) === goal,
  );
  const old = await getDocument(originalId);
  const competing = {
    ...old,
    writer_id: 'other-writer',
    expected_storage_revision: old.storage_revision,
    note: 'other edit',
  };
  await saveSession(originalId, competing);
  check(
    'A stale writer cannot replace another editor session',
    await rejects(
      () =>
        saveSession(originalId, {
          ...old,
          writer_id: 'stale-writer',
          expected_storage_revision: old.storage_revision,
          note: 'overwrite',
        }),
      'revision_conflict',
    ),
  );
  // Reload a new editor identity and verify the saved ticket, not an old live session.
  frame.src = '../editor.html?id=' + originalId;
  await new Promise((r) => frame.addEventListener('load', r, { once: true }));
  await until(() => frame.contentWindow.ConsoleCanvas?.state.ready);
  app = frame.contentWindow.ConsoleCanvas;
  doc = frame.contentDocument;
  check(
    'Restart keeps ticket ID, comments, fixed goal and review records',
    app.state.snapshot.id === originalId &&
      app.state.ticket.id === originalId &&
      app.state.scene.annotations[node.id].includes('모바일') &&
      JSON.stringify((await getTicket(originalId)).goal) === goal,
  );
  doc.querySelector('#create-ticket').click();
  await until(() => app.state.ready && app.state.snapshot.id !== originalId);
  const newId = app.state.snapshot.id;
  check(
    'New ticket creates a visible ID without a naming modal',
    !!app.state.ticket.display_id &&
      !doc.querySelector('dialog:modal') &&
      app.state.ticket.status === 'draft',
  );
  doc.querySelector('#ticket-sample').click();
  await until(() => app.state.ready && app.state.scene.nodes.size > 300);
  check(
    'Capture attaches to the existing empty ticket without creating another',
    app.state.snapshot.id === newId && app.state.ticket.id === newId,
  );
  doc.querySelector('#review-note').value = '같은 티켓 목표 확정 UI';
  doc.querySelector('#review-note').dispatchEvent(new frame.contentWindow.Event('change'));
  await app.flushEditor();
  doc.querySelector('#new-ticket-button').click();
  await until(() => doc.querySelector('#ticket-request'));
  check(
    'Goal form includes current comments and intent without retyping',
    doc.querySelector('#ticket-request').value.includes('같은 티켓'),
  );
  doc.querySelector('#ticket-register').click();
  await until(() => doc.querySelector('.ticket-image'));
  check(
    'Actual form confirms a goal on the same ID',
    (await getTicket(newId)).status === 'queued' &&
      doc.querySelector('#tickets-content').textContent.includes(app.state.ticket.display_id),
  );
  doc.querySelector('#tickets-dialog').close();
  doc.querySelector('#tickets-button').click();
  await until(
    () => doc.querySelector('#tickets-dialog').open && doc.querySelector('#share-project'),
  );
  let share = doc.querySelector('#share-project');
  await until(() => share.checked);
  share.click();
  await until(async () => !(await sharedProjects()).includes(project) && !share.checked);
  check('Public-access switch stays off after asynchronous persistence', !share.checked);
  share.click();
  await until(async () => (await sharedProjects()).includes(project) && share.checked);
  check('Public-access switch stays on and reflects the real permission', share.checked);
  doc.querySelector('#tickets-dialog').close();
  const originalCount = (await listTickets(project, { limit: 10000 })).total;
  const originalAdd = IDBObjectStore.prototype.add;
  let failed = false;
  const silence = (e) => {
    if (e.error?.name === 'QuotaExceededError') e.preventDefault();
  };
  addEventListener('error', silence);
  try {
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'tickets') throw new DOMException('QA quota', 'QuotaExceededError');
      return originalAdd.apply(this, args);
    };
    failed = await rejects(() =>
      createTicket({ project_id: project, title: 'failure', operation_id: 'failure' }),
    );
  } finally {
    IDBObjectStore.prototype.add = originalAdd;
    removeEventListener('error', silence);
  }
  check(
    'Failed ticket creation leaves neither workspace nor success receipt',
    failed && (await listTickets(project, { limit: 10000 })).total === originalCount,
  );
  check(
    'Creation retry after storage recovery succeeds',
    (await createTicket({ project_id: project, title: 'failure', operation_id: 'failure' }))
      .status === 'draft',
  );
  await transact(['captures', 'sessions', 'documents', 'tickets'], 'readwrite', (tx) => {
    for (const name of ['captures', 'sessions', 'documents', 'tickets'])
      tx.objectStore(name).delete(originalId);
  });
  await importDocument(exported);
  check(
    'Backup restores stable identity and immutable goal',
    JSON.stringify((await getTicket(originalId)).goal) === goal &&
      (await getDocument(originalId)).annotations[node.id].includes('모바일'),
  );
  document.querySelector('#status').textContent = `PASS ${results.length} checks`;
  document.body.dataset.result = 'pass';
} catch (e) {
  console.error(e);
  document.querySelector('#status').textContent = 'FAIL ' + e.stack;
  document.body.dataset.result = 'fail';
}
