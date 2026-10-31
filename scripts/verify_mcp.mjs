import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..'),
  checks = [];
const client = new Client({ name: 'console-canvas-ticket-first-qa', version: '0.46.0' });
const transport = new StdioClientTransport({
  command: process.env.CONSOLE_CANVAS_PYTHON || '/usr/bin/python3',
  args: process.env.CONSOLE_CANVAS_MCP_ARGS
    ? JSON.parse(process.env.CONSOLE_CANVAS_MCP_ARGS)
    : [path.join(root, 'mcp/server.py')],
  stderr: 'pipe',
});
const check = (name, value) => {
  assert.ok(value, name);
  checks.push(name);
};
async function tool(name, args = {}, allowError = false) {
  const r = await client.callTool({ name, arguments: args });
  if (!allowError) assert.equal(r.isError, false, JSON.stringify(r.structuredContent || r.content));
  return r.structuredContent;
}
try {
  await client.connect(transport);
  const names = (await client.listTools()).tools.map((t) => t.name);
  check(
    'Ticket-first tools replace post-edit registration',
    names.length === 16 &&
      names.includes('create_ticket') &&
      names.includes('confirm_ticket_goal') &&
      !names.includes('register_ticket'),
  );
  const guide = await tool('get_agent_guide');
  check(
    'App guide explains short ticket commands and same-ticket confirmation',
    guide.markdown.includes('캔버스 편집/티켓 가져와') &&
      guide.markdown.includes('confirm_ticket_goal'),
  );
  const rows = await tool('list_tickets');
  assert.ok(rows.tickets.length, 'Disposable shared project required');
  const t = rows.tickets.find((t) => t.status === 'draft');
  assert.ok(t);
  const ref = { ticket_ref: t.display_id, project_id: t.project_id };
  let current = await tool('get_ticket', ref);
  check(
    'ID alone reads saved edits and images without editor selection',
    current.ticket.id === t.id &&
      current.ticket.workspace &&
      !current.ticket.goal &&
      current.images.length,
  );
  check(
    'Exact name resolves stable identity',
    (await tool('get_ticket', { ticket_ref: t.title, project_id: t.project_id })).ticket.id ===
      t.id,
  );
  const elements = await tool('list_elements', { ...ref, query: 'new-customer' }),
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
  const applied = await tool('apply_edits', write);
  check(
    'Official SDK performs a durable editing batch',
    applied.persisted && applied.screen.revision > write.expected_edit_revision,
  );
  check(
    'Uncertain retry does not duplicate the saved edit',
    (await tool('apply_edits', write)).screen.revision === applied.screen.revision,
  );
  check(
    'Old edit revision is rejected',
    (await tool('apply_edits', { ...write, operation_id: randomUUID() }, true)).error.code ===
      'revision_conflict',
  );
  const blank = await tool('create_ticket', {
    project_id: t.project_id,
    title: 'SDK 닫힌 준비 중 티켓',
    operation_id: randomUUID(),
  });
  check(
    'Create returns draft identity before a screen exists',
    blank.ticket.status === 'draft' && !blank.ticket.goal,
  );
  check(
    'A closed empty ticket is readable by ID',
    (await tool('get_ticket', { ticket_ref: blank.ticket.id })).ticket.workspace.empty,
  );
  const context = await client.callTool({ name: 'get_design_context', arguments: ref });
  check(
    'Visual context is delivered as real MCP image blocks',
    context.content.some((b) => b.type === 'image'),
  );
  current = await tool('get_ticket', ref);
  const confirm = {
    ...ref,
    expected_ticket_revision: current.ticket.revision,
    expected_edit_revision: current.ticket.workspace.edit_revision,
    operation_id: randomUUID(),
    request: '고객 등록을 제목과 정렬하고 모바일에서는 전체 너비로 표시',
    selection_confirmed: true,
  };
  const confirmed = await tool('confirm_ticket_goal', confirm);
  check(
    'Goal is confirmed on the same ticket ID',
    confirmed.ticket.id === t.id &&
      confirmed.ticket.status === 'queued' &&
      confirmed.ticket.goal.id,
  );
  check(
    'Confirmation retry is durable without re-rendering another goal',
    (await tool('confirm_ticket_goal', confirm)).ticket.goal.id === confirmed.ticket.goal.id,
  );
  const goalId = confirmed.ticket.goal.id;
  async function update(status, extra = {}, bad = false) {
    const r = await tool('get_ticket', ref);
    return tool(
      'update_ticket',
      {
        ...ref,
        goal_id: goalId,
        expected_ticket_revision: r.ticket.revision,
        operation_id: randomUUID(),
        status,
        summary: 'SDK 작업·검토 기록',
        ...extra,
      },
      bad,
    );
  }
  check(
    'Implementation does not begin without instruction',
    (await update('working', {}, true)).error.code === 'instruction_required',
  );
  await update('working', {
    implementation_instruction: '가상 프로젝트에 이 티켓을 구현하라는 QA 지시',
  });
  const block = context.content.find((b) => b.type === 'image');
  const png = 'data:' + block.mimeType + ';base64,' + block.data;
  await update('review', {
    implementation_image_data_url: png,
    checks: '가상 결과와 반응형 완료 조건 확인',
  });
  check(
    'Review cannot automatically become human approval',
    (await update('done', {}, true)).error.code === 'approval_required',
  );
  await update('done', {
    review_decision: 'approved',
    review_note: 'QA 역할 검토자가 결과를 확인하고 승인',
  });
  const final = await client.callTool({ name: 'get_ticket', arguments: ref });
  check(
    'Goal and implementation images remain distinguishable',
    final.structuredContent.ticket.status === 'done' &&
      final.structuredContent.ticket.goal.id === goalId &&
      final.content.filter((b) => b.type === 'image').length >= 2,
  );
  check(
    'Unauthorized project returns no ticket candidates',
    (await tool('list_tickets', { project_id: 'not-shared' }, true)).error.code ===
      'not_authorized',
  );
  const report = { passed: checks.length, checks, ticket_id: t.id, project_id: t.project_id };
  await fs.mkdir(path.join(root, 'local'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'local/mcp-verification.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await client.close();
}
