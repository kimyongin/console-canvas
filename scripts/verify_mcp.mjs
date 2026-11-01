import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..'),
  checks = [],
  clients = [];
function check(name, passed) {
  assert.ok(passed, name);
  checks.push(name);
}
async function connect() {
  const client = new Client({ name: 'console-canvas-project-qa', version: '0.52.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.env.CONSOLE_CANVAS_PYTHON || '/usr/bin/python3',
      args: process.env.CONSOLE_CANVAS_MCP_ARGS
        ? JSON.parse(process.env.CONSOLE_CANVAS_MCP_ARGS)
        : [path.join(root, 'mcp/server.py')],
      stderr: 'pipe',
    }),
  );
  clients.push(client);
  return client;
}
async function tool(client, name, args = {}, allowError = false) {
  const result = await client.callTool({ name, arguments: args });
  if (!allowError)
    assert.equal(result.isError, false, JSON.stringify(result.structuredContent || result.content));
  return result.structuredContent;
}
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-repository-qa-'));
try {
  const a = await connect(),
    b = await connect();
  const names = (await a.listTools()).tools.map((t) => t.name);
  check(
    'Project API replaces empty-ticket creation',
    names.length === 19 &&
      names.includes('connect_repository') &&
      names.includes('prepare_implementation') &&
      !names.includes('create_ticket'),
  );
  const guide = await tool(a, 'get_agent_guide');
  check(
    'Bundled skill explains short requests and repository scope',
    guide.markdown.includes('캔버스 편집/티켓 가져와') &&
      guide.markdown.includes('repository_path'),
  );
  check(
    'No request inherits the visible app project',
    !(await tool(a, 'list_tickets', {}, true)).ok,
  );
  const projects = (await tool(a, 'list_projects')).projects;
  const p = projects.find((p) => p.name === 'QA 고객 콘솔'),
    other = projects.find((p) => p.name === 'QA 다른 저장소');
  assert.ok(p && other, 'Run on the disposable fixture only');
  const dirs = [path.join(temporary, 'a'), path.join(temporary, 'b')];
  for (const directory of dirs) {
    await fs.mkdir(directory);
    execFileSync('git', ['init', '-q', directory]);
  }
  await tool(a, 'connect_repository', {
    project_id: p.display_id,
    repository_path: dirs[0],
    expected_project_revision: p.revision,
    operation_id: randomUUID(),
  });
  await tool(b, 'connect_repository', {
    project_id: other.id,
    repository_path: dirs[1],
    expected_project_revision: other.revision,
    operation_id: randomUUID(),
  });
  check(
    'Independent stdio clients resolve their own repositories',
    (await tool(a, 'resolve_project', { repository_path: dirs[0] })).project.id === p.id &&
      (await tool(b, 'resolve_project', { repository_path: dirs[1] })).project.id === other.id,
  );
  const rows = await tool(a, 'list_tickets', {
    repository_path: dirs[0],
    status: 'unfinished',
    limit: 1,
  });
  const t = rows.tickets.find((t) => t.status === 'draft');
  assert.ok(t);
  const otherRows = await tool(b, 'list_tickets', { repository_path: dirs[1] });
  check(
    'Concurrent agent catalogs do not mix projects',
    otherRows.tickets.length > 0 &&
      otherRows.tickets.every((t) => t.project_id === other.id) &&
      !otherRows.tickets.some((x) => x.id === t.id),
  );
  check(
    'Mismatched explicit project and repository is rejected',
    (await tool(a, 'list_tickets', { project_id: p.id, repository_path: dirs[1] }, true)).error
      .code === 'repository_mismatch',
  );
  const ref = { ticket_ref: t.display_id, project_id: p.id };
  let current = await tool(a, 'get_ticket', ref);
  check(
    'Ticket ID reads persisted current images and comments',
    current.ticket.id === t.id && current.images.length && current.ticket.workspace,
  );
  const elements = await tool(a, 'list_elements', { ...ref, query: 'new-customer' }),
    node = elements.elements.find((n) => n.locator.id === 'new-customer');
  assert.ok(node);
  const write = {
    ...ref,
    expected_edit_revision: current.ticket.workspace.edit_revision,
    operation_id: randomUUID(),
    operations: [
      { type: 'move', element_id: node.id, dx: 12, dy: 5, mode: 'relative' },
      { type: 'comment', element_id: node.id, text: 'SDK: 제목과 정렬, 모바일에서 줄바꿈' },
    ],
  };
  const applied = await tool(a, 'apply_edits', write);
  check(
    'Official SDK persists editing and replay does not duplicate it',
    applied.persisted &&
      (await tool(a, 'apply_edits', write)).screen.revision === applied.screen.revision,
  );
  check(
    'Stale editing revision is rejected',
    (await tool(a, 'apply_edits', { ...write, operation_id: randomUUID() }, true)).error.code ===
      'revision_conflict',
  );
  const context = await a.callTool({ name: 'get_design_context', arguments: ref });
  check(
    'Visual context uses actual MCP image blocks',
    context.content.some((block) => block.type === 'image'),
  );
  current = await tool(a, 'get_ticket', ref);
  const confirm = {
    ...ref,
    expected_ticket_revision: current.ticket.revision,
    expected_edit_revision: current.ticket.workspace.edit_revision,
    operation_id: randomUUID(),
    request: '제목과 정렬하고 모바일 전체 너비',
    selection_confirmed: true,
  };
  const confirmed = await tool(a, 'confirm_ticket_goal', confirm),
    goalId = confirmed.ticket.goal.id;
  check(
    'Confirmation and retry keep the same ticket and goal',
    confirmed.ticket.id === t.id &&
      (await tool(a, 'confirm_ticket_goal', confirm)).ticket.goal.id === goalId,
  );
  const plan = await tool(a, 'prepare_implementation', {
    project_id: p.id,
    instruction: '확정된 티켓들을 구현해',
    operation_id: randomUUID(),
  });
  check(
    'Explicit bulk request freezes eligible canonical goal IDs',
    plan.manifest.tickets.some((x) => x.id === t.id && x.goal_id === goalId),
  );
  const claim = {
    ...ref,
    goal_id: goalId,
    expected_ticket_revision: confirmed.ticket.revision,
    status: 'working',
    summary: '착수',
    claim_token: 'sdk-a',
    operation_id: randomUUID(),
  };
  check(
    'Implementation requires an explicit instruction',
    (await tool(a, 'update_ticket', claim, true)).error.code === 'instruction_required',
  );
  const race = await Promise.all([
    tool(
      a,
      'update_ticket',
      { ...claim, operation_id: randomUUID(), implementation_instruction: '가상 프로젝트 QA 구현' },
      true,
    ),
    tool(
      b,
      'update_ticket',
      {
        ...claim,
        operation_id: randomUUID(),
        claim_token: 'sdk-b',
        implementation_instruction: '가상 프로젝트 QA 구현',
      },
      true,
    ),
  ]);
  check(
    'Two stdio clients cannot both start the same ticket',
    race.filter((x) => x.ok).length === 1,
  );
  current = await tool(a, 'get_ticket', ref);
  const token = current.ticket.claim.token;
  async function update(status, extra = {}, bad = false) {
    const latest = await tool(a, 'get_ticket', ref);
    return tool(
      a,
      'update_ticket',
      {
        ...ref,
        goal_id: goalId,
        expected_ticket_revision: latest.ticket.revision,
        operation_id: randomUUID(),
        claim_token: token,
        status,
        summary: 'SDK 구현·검토 기록',
        ...extra,
      },
      bad,
    );
  }
  const block = context.content.find((block) => block.type === 'image');
  await update('review', {
    implementation_image_data_url: 'data:' + block.mimeType + ';base64,' + block.data,
    checks: '가상 결과와 반응형 확인',
  });
  check(
    'Review cannot become human approval automatically',
    (await update('done', {}, true)).error.code === 'approval_required',
  );
  await update('done', { review_decision: 'approved', review_note: 'QA 역할 검토자 승인' });
  const final = await tool(a, 'get_ticket', ref);
  check(
    'Goal, current and implementation evidence remain distinguishable',
    final.ticket.status === 'done' &&
      final.ticket.goal.id === goalId &&
      final.images.some((i) => i.role === 'goal') &&
      final.images.some((i) => i.role === 'implementation'),
  );
  check(
    'Completed ticket is excluded only from unfinished lists',
    !(await tool(a, 'list_tickets', { project_id: p.id, status: 'unfinished' })).tickets.some(
      (x) => x.id === t.id,
    ),
  );
  console.log(JSON.stringify({ passed: checks.length, checks }));
} finally {
  for (const c of clients) await c.close();
  await fs.rm(temporary, { recursive: true, force: true });
}
