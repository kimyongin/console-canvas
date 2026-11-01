import {
  getTicket,
  listTickets,
  confirmTicketGoal,
  updateTicket,
  prepareImplementation,
} from '../ticket-model.js';
import {
  createProject,
  listProjects,
  getProject,
  connectRepository,
  resolveProject,
  updateProject,
} from '../project-model.js';
import {
  getDocument,
  saveCapture,
  saveSession,
  trashDocument,
  restoreDocument,
  renameDocument,
  transact,
} from '../db.js';
import { semanticState } from '../semantic-state.js';
const frame = document.querySelector('#editor'),
  results = [];
function check(name, value) {
  results.push({ name, passed: !!value });
  document.querySelector('#results').textContent = JSON.stringify(results);
  if (!value) throw Error(name);
}
async function until(read) {
  const end = Date.now() + 45000;
  while (Date.now() < end) {
    if (await read()) return;
    await new Promise((r) => setTimeout(r, 25));
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
const image = document.createElement('canvas').toDataURL('image/png');
try {
  await until(() => frame.contentWindow.ConsoleCanvas?.state.ready);
  const app = frame.contentWindow.ConsoleCanvas,
    doc = frame.contentDocument;
  const project = await getProject(app.state.project_id),
    first = app.state.snapshot.id;
  const call = (name, args = {}) =>
    app.ticketWorkspace.execute({
      name,
      arguments: { project_id: project.id, ...args },
      deadline: Date.now() / 1000 + 120,
    });
  let ticket = await getTicket(first);
  check(
    'Successful import creates a named-project ticket before editor use',
    ticket.status === 'draft' && ticket.project_id === project.id && !!(await getDocument(first)),
  );
  check(
    'Blank ticket commands and editable project ID field are removed',
    !doc.querySelector('#create-ticket') && !doc.querySelector('#project-id') && !app.newTicket,
  );
  const repeated = structuredClone(app.state.snapshot);
  repeated.project_id = project.id;
  const count = (await listTickets(project.id, { limit: 10000 })).total;
  await saveCapture(repeated);
  await saveCapture(repeated);
  check(
    'Capture retry does not duplicate the ticket or its counter',
    (await listTickets(project.id, { limit: 10000 })).total === count,
  );
  const missing = { ...repeated, id: crypto.randomUUID(), project_id: 'missing-project' };
  check(
    'Failed project validation rolls back capture and ticket together',
    (await rejects(() => saveCapture(missing))) &&
      !(await getDocument(missing.id)) &&
      !(await getTicket(missing.id)),
  );
  check(
    'MCP cannot infer project from the app selection',
    !(await call('list_tickets', { project_id: undefined })).ok,
  );
  check(
    'MCP lists stored project entities even without tickets',
    (await call('list_projects')).projects.some((p) => p.id === project.id),
  );
  const second = await createProject('다른 저장소 프로젝트');
  check(
    'Project creation requires only a name and no repository',
    second.display_id.startsWith('P-') &&
      !second.repository &&
      !(await listTickets(second.id)).total,
  );
  check(
    'An explicit unknown project is rejected',
    (await call('list_tickets', { project_id: 'missing' })).error.code === 'project_not_found',
  );
  const repo = { identity: 'repo-a', root: '/tmp/repo-a', common_dir: '/tmp/repo-a/.git' },
    op = crypto.randomUUID();
  const bound = await connectRepository({
    project_id: project.display_id,
    repository: repo,
    operation_id: op,
    expected_project_revision: project.revision,
  });
  check(
    'Binding accepts stable display ID and returns canonical identity',
    bound.id === project.id && bound.repository.identity === 'repo-a',
  );
  check(
    'Same repository binds idempotently after revision changes',
    (
      await connectRepository({
        project_id: project.id,
        repository: repo,
        operation_id: crypto.randomUUID(),
        expected_project_revision: 0,
      })
    ).id === project.id,
  );
  check(
    'New agent session resolves repository without app current project',
    (await resolveProject({ repository: { ...repo, root: '/tmp/linked-worktree' } })).id ===
      project.id,
  );
  check(
    'Independent clones with the same URL are not implicitly merged',
    await rejects(
      () => resolveProject({ repository: { ...repo, identity: 'clone-a' } }),
      'project_required',
    ),
  );
  check(
    'Explicit project and mismatched repository fail together',
    await rejects(
      () => resolveProject({ project_id: project.id, repository: { ...repo, identity: 'other' } }),
      'repository_mismatch',
    ),
  );
  check(
    'Rebinding requires a current project revision',
    await rejects(
      () =>
        connectRepository({
          project_id: project.id,
          repository: { ...repo, identity: 'different' },
          operation_id: crypto.randomUUID(),
          expected_project_revision: -1,
        }),
      'project_revision_conflict',
    ),
  );
  const b = await getProject(second.id);
  await connectRepository({
    project_id: b.id,
    repository: repo,
    operation_id: crypto.randomUUID(),
    expected_project_revision: b.revision,
  });
  check(
    'Multiple projects in one repository return candidates instead of guessing',
    await rejects(() => resolveProject({ repository: repo }), 'ambiguous_project'),
  );
  const b2 = await getProject(b.id);
  await connectRepository({
    project_id: b.id,
    repository: { identity: 'repo-b', root: '/tmp/repo-b', common_dir: '/tmp/repo-b/.git' },
    operation_id: crypto.randomUUID(),
    expected_project_revision: b2.revision,
  });
  await updateProject(project.id, { name: '고객 콘솔' });
  check(
    'Project rename preserves identity and repository binding',
    (await getProject(project.id)).repository.identity === 'repo-a',
  );
  const node = [...app.state.scene.nodes.values()].find((n) => n.locator.id === 'new-customer');
  app.selectNode(node.id);
  app.state.scene.nudge(12, 4);
  app.state.scene.setComment(node.id, '제목과 정렬하고 모바일에서는 전체 너비');
  await app.flushEditor();
  check(
    'Agent reads comments and visual context by ticket ID',
    (await call('get_ticket', { ticket_ref: ticket.display_id })).ticket.workspace.annotations[
      node.id
    ].includes('모바일'),
  );
  const before = doc.querySelectorAll('dialog[open]').length;
  await app.confirmCurrentTicket();
  ticket = await getTicket(first);
  check(
    'Confirm is one in-place action without a goal form or navigation',
    ticket.status === 'queued' &&
      app.state.snapshot.id === first &&
      doc.querySelectorAll('dialog[open]').length === before,
  );
  check(
    'Confirmation stores exact image, comments, source and semantic state',
    ticket.goal.image.data_url.startsWith('data:image/') &&
      ticket.goal.annotations[node.id] &&
      ticket.goal.semantic_state === semanticState(await getDocument(first)),
  );
  const goal = ticket.goal.id;
  app.selectNode(null);
  await app.flushEditor();
  check(
    'Selection and view-only saves do not invalidate confirmation',
    !(await getTicket(first)).needs_reconfirmation,
  );
  await renameDocument(first, '고객 검색 개선');
  check(
    'Ticket rename does not invalidate confirmation',
    !(await getTicket(first)).needs_reconfirmation,
  );
  app.selectNode(node.id);
  app.state.scene.nudge(5, 0);
  await app.flushEditor();
  check(
    'Real editing directly after confirm marks reconfirmation required',
    (await getTicket(first)).needs_reconfirmation && (await getTicket(first)).status === 'draft',
  );
  const failedClaim = await call('update_ticket', {
    ticket_ref: first,
    goal_id: goal,
    expected_ticket_revision: ticket.revision,
    status: 'working',
    summary: '구현',
    implementation_instruction: '확정된 티켓을 구현해',
    claim_token: 'agent-a',
    operation_id: crypto.randomUUID(),
  });
  check('Unconfirmed later edits cannot be implemented', !failedClaim.ok);
  app.undo();
  await app.flushEditor();
  check(
    'Undo exactly to the confirmed design restores eligibility',
    !(await getTicket(first)).needs_reconfirmation && (await getTicket(first)).status === 'queued',
  );
  app.undo('redo');
  await app.flushEditor();
  await app.confirmCurrentTicket();
  ticket = await getTicket(first);
  check(
    'Reconfirm replaces the goal on the same ticket',
    ticket.id === first && ticket.goal.id !== goal && ticket.status === 'queued',
  );
  const manifestInput = {
    project_id: project.id,
    instruction: '이 저장소의 확정된 티켓들을 모두 구현해',
    operation_id: crypto.randomUUID(),
  };
  const manifest = await prepareImplementation(manifestInput);
  check(
    'Explicit bulk implementation freezes canonical IDs and goal revisions',
    manifest.tickets.some(
      (t) => t.id === first && t.goal_id === ticket.goal.id && t.revision === ticket.revision,
    ),
  );
  const later = {
    ...structuredClone(repeated),
    id: crypto.randomUUID(),
    documentName: '나중에 추가된 티켓',
  };
  await saveCapture(later);
  check(
    'Manifest replay does not silently add later tickets',
    JSON.stringify((await prepareImplementation(manifestInput)).tickets) ===
      JSON.stringify(manifest.tickets),
  );
  const claim = {
    ticket_id: first,
    project_id: project.id,
    expected_revision: ticket.revision,
    goal_id: ticket.goal.id,
    status: 'working',
    summary: '구현 착수',
    implementation_instruction: manifest.instruction,
    operation_id: crypto.randomUUID(),
    claim_token: 'agent-a',
  };
  const race = await Promise.allSettled([
    updateTicket(claim),
    updateTicket({ ...claim, operation_id: crypto.randomUUID(), claim_token: 'agent-b' }),
  ]);
  check(
    'Concurrent agents cannot both claim the same confirmed goal',
    race.filter((r) => r.status === 'fulfilled').length === 1,
  );
  check(
    'Lost acknowledgement can replay the same atomic claim',
    (await updateTicket(claim)).claim.token === 'agent-a',
  );
  ticket = await getTicket(first);
  const fixedGoal = ticket.goal.id;
  app.state.scene.nudge(3, 0);
  await app.flushEditor();
  ticket = await getTicket(first);
  check(
    'Edits during implementation are requests and leave the active goal immutable',
    ticket.status === 'working' && ticket.goal.id === fixedGoal && ticket.revision_requested,
  );
  check(
    'Working goal cannot be silently reconfirmed',
    await rejects(() => app.confirmCurrentTicket()),
  );
  check(
    'A different agent cannot update claimed work',
    await rejects(
      () =>
        updateTicket({
          ...claim,
          operation_id: crypto.randomUUID(),
          expected_revision: ticket.revision,
          claim_token: 'agent-b',
        }),
      'claim_conflict',
    ),
  );
  ticket = await updateTicket({
    ...claim,
    status: 'review',
    operation_id: crypto.randomUUID(),
    expected_revision: ticket.revision,
    implementation_image_data_url: image,
    checks: '데스크톱·모바일 확인',
    summary: '구현 결과',
  });
  check(
    'Implementation evidence and checks enter review on the same ticket',
    ticket.status === 'review' && ticket.records.at(-1).image,
  );
  check(
    'Completion without human approval is rejected',
    await rejects(
      () =>
        updateTicket({
          ...claim,
          status: 'done',
          operation_id: crypto.randomUUID(),
          expected_revision: ticket.revision,
        }),
      'approval_required',
    ),
  );
  ticket = await updateTicket({
    ...claim,
    status: 'done',
    operation_id: crypto.randomUUID(),
    expected_revision: ticket.revision,
    review_decision: 'approved',
    review_note: '사용자 승인',
    summary: '검토 완료',
  });
  check(
    'Human approval completes and releases the claim',
    ticket.status === 'done' && !ticket.claim,
  );
  check(
    'Unfinished list excludes done without hiding direct ID history',
    !(await listTickets(project.id, { status: 'unfinished' })).tickets.some(
      (t) => t.id === first,
    ) && (await getTicket(first)).status === 'done',
  );
  await trashDocument(later.id);
  check(
    'Trash is excluded from agent listing and exact ID lookup',
    !(await call('list_tickets')).tickets.some((t) => t.id === later.id) &&
      !(await getTicket(later.id)),
  );
  await restoreDocument(later.id);
  check('Restore returns the same ticket identity', (await getTicket(later.id)).id === later.id);
  check(
    'Project switching does not retarget an agent request',
    (await call('list_tickets', { project_id: second.id })).total === 0,
  );
  check(
    'Save cannot move a ticket into another project',
    await rejects(() => saveSession(later.id, { project_id: second.id }), 'project_mismatch'),
  );
  const all = await listTickets(project.id, { limit: 1 });
  check(
    'Pagination exposes continuation when more rows remain',
    all.tickets.length === 1 && all.next_cursor,
  );
  await app.openTicket(later.id);
  await app.showTickets();
  await until(() => doc.querySelectorAll('.ticket-compact-row').length);
  check(
    'Catalog defaults to unfinished tickets and no intermediate detail page',
    doc.querySelector('[aria-label="티켓 상태 필터"]').value === 'unfinished' &&
      !doc.querySelector('.goal-form'),
  );
  doc
    .querySelector('[data-ticket-id="' + (await getTicket(later.id)).display_id + '"] .ticket-open')
    .click();
  await until(() => !doc.querySelector('#tickets-dialog').open && app.state.ready);
  check('One row click opens the ticket directly', app.state.snapshot.id === later.id);
  const saved = await getDocument(later.id);
  await app.openTicket(first);
  await app.openTicket(later.id);
  check(
    'Reopening restores saved content without creating a new ticket',
    (await getDocument(later.id)).html === saved.html && app.state.snapshot.id === later.id,
  );
  const key = 'forced-rollback-' + crypto.randomUUID();
  check(
    'A failed transaction leaves no operation receipt',
    await rejects(() =>
      transact(['operations'], 'readwrite', (tx) => {
        tx.objectStore('operations').add({ id: key });
        tx.abort();
      }),
    ),
  );
  const casCapture = {
    ...structuredClone(repeated),
    id: crypto.randomUUID(),
    project_id: project.id,
  };
  await saveCapture(casCapture);
  const originalSession = await getDocument(casCapture.id);
  await saveSession(casCapture.id, {
    ...originalSession,
    expected_storage_revision: 0,
    writer_id: 'shared-editor',
    note: 'first writer',
  });
  check(
    'Stale saves conflict even when a closed editor shares the writer identity',
    (await rejects(
      () =>
        saveSession(casCapture.id, {
          ...originalSession,
          expected_storage_revision: 0,
          writer_id: 'shared-editor',
          note: 'stale overwrite',
        }),
      'revision_conflict',
    )) && (await getDocument(casCapture.id)).note === 'first writer',
  );
  const confirmInput = {
    ticket_id: casCapture.id,
    project_id: project.id,
    expected_revision: 0,
    expected_edit_revision: 0,
    operation_id: crypto.randomUUID(),
    image_data_url: image,
    request: 'original goal',
    selection_confirmed: true,
  };
  const originalGoal = await confirmTicketGoal(confirmInput);
  const revisedGoal = await confirmTicketGoal({
    ...confirmInput,
    expected_revision: originalGoal.revision,
    operation_id: crypto.randomUUID(),
    request: 'later goal',
  });
  check(
    'Old operation replay returns its original acknowledged goal without replacing the newer goal',
    (await confirmTicketGoal(confirmInput)).goal.id === originalGoal.goal.id &&
      (await getTicket(casCapture.id)).goal.id === revisedGoal.goal.id,
  );
  const held = await updateTicket({
    ticket_id: casCapture.id,
    project_id: project.id,
    expected_revision: revisedGoal.revision,
    goal_id: revisedGoal.goal.id,
    status: 'blocked',
    summary: '사람이 보류',
    operation_id: crypto.randomUUID(),
  });
  await saveSession(casCapture.id, {
    ...(await getDocument(casCapture.id)),
    writer_id: 'shared-editor',
  });
  check(
    'Saving the exact confirmed state does not undo an explicit hold',
    (await getTicket(casCapture.id)).status === 'blocked' &&
      (await getTicket(casCapture.id)).confirmation_held &&
      held.confirmation_held,
  );
  await app.showTickets();
  await until(() => doc.querySelector('.ticket-compact-row'));
  doc.querySelector('#tickets-dialog').close();
  const newInCatalog = {
    ...structuredClone(repeated),
    id: crypto.randomUUID(),
    project_id: project.id,
    documentName: '목록을 닫은 뒤 새로 가져온 화면',
  };
  await saveCapture(newInCatalog);
  await app.showTickets();
  await until(() => doc.querySelector('[data-document-id="' + newInCatalog.id + '"]'));
  check(
    'Reopening the catalog rereads captures created since the previous opening',
    doc
      .querySelector('.ticket-compact-list')
      .textContent.includes('목록을 닫은 뒤 새로 가져온 화면'),
  );
  doc.querySelector('#tickets-dialog').close();
  check('Project entities remain after all ticket operations', (await listProjects()).length >= 2);
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
