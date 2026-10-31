// Official SDK integration against an explicitly connected disposable local console only.
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..'),
  checks = [];
const client = new Client({ name: 'console-canvas-ticket-qa', version: '0.45.0' });
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
async function tool(name, args = {}, error = false) {
  const r = await client.callTool({ name, arguments: args });
  if (!error) assert.equal(r.isError, false, JSON.stringify(r.structuredContent || r.content));
  return r.structuredContent;
}
try {
  await client.connect(transport);
  const definitions = (await client.listTools()).tools,
    names = definitions.map((t) => t.name);
  check(
    'Only current editing/context/ticket tools are discoverable',
    names.length === 15 && !names.some((n) => /snapshot|candidate|ai_request|code_patch/.test(n)),
  );
  const guide = await tool('get_agent_guide');
  check(
    'Live bundled guide matches the ticket contract',
    guide.source === 'app_bundle' &&
      guide.markdown.includes('register_ticket') &&
      !guide.markdown.includes('register_ai_candidate'),
  );
  const screen = (await tool('list_screens')).screens.find(
    (s) => new URL(s.url).pathname === '/fixtures/console.html',
  );
  assert.ok(screen, 'Disposable console required');
  const base = { editor_id: screen.editor_id },
    project = { ...base, project_id: screen.project_id };
  let current = (await tool('get_screen', base)).screen;
  check(
    'Captured copy and source evidence are available',
    current.element_count > 300 &&
      typeof current.capture_reference.available === 'boolean' &&
      current.capture_reference.kind === 'captured_pixels',
  );
  const node = (await tool('list_elements', { ...base, query: 'new-customer' })).elements.find(
    (n) => n.locator.id === 'new-customer',
  );
  assert.ok(node);
  const write = {
    ...base,
    expected_revision: current.revision,
    operation_id: randomUUID(),
    operations: [
      { type: 'move', element_id: node.id, dx: 12, dy: 6, mode: 'relative' },
      { type: 'comment', element_id: node.id, text: '제목과 버튼을 반응형으로 정렬' },
    ],
  };
  const applied = await tool('apply_edits', write);
  check(
    'Shared edit batch is one persisted undo step',
    applied.persisted && applied.screen.undo_count === current.undo_count + 1,
  );
  check(
    'Edit replay does not duplicate undo',
    (await tool('apply_edits', write)).screen.revision === applied.screen.revision,
  );
  check(
    'Stale screen writes are rejected',
    (
      await tool(
        'undo',
        { ...base, expected_revision: current.revision, operation_id: randomUUID() },
        true,
      )
    ).error.code === 'revision_conflict',
  );
  current = applied.screen;
  const context = await client.callTool({ name: 'get_design_context', arguments: base });
  check(
    'Visual context returns images without HTML/CSS',
    context.content.some((c) => c.type === 'image') &&
      context.structuredContent.kind === 'visual' &&
      !context.structuredContent.html &&
      !context.structuredContent.styles,
  );
  const image = await client.callTool({ name: 'get_review_image', arguments: base });
  check(
    'Single current handoff image is returned',
    image.content.some((c) => c.type === 'image'),
  );
  const photo = context.content.find((c) => c.type === 'image'),
    image_data_url = 'data:' + photo.mimeType + ';base64,' + photo.data;
  const register = {
    ...project,
    expected_revision: current.revision,
    operation_id: randomUUID(),
    title: 'SDK에서 사람이 선택한 목표',
    request: '제목과 버튼 정렬; 작은 화면에서 줄바꿈 유지',
    selection_confirmed: true,
    image_data_url,
  };
  const ticket = (await tool('register_ticket', register)).ticket;
  check(
    'Registration is queued and does not edit the canvas',
    ticket.status === 'queued' &&
      (await tool('get_screen', base)).screen.revision === current.revision,
  );
  check(
    'Same registration operation is idempotent',
    (await tool('register_ticket', register)).ticket.id === ticket.id,
  );
  check(
    'Project isolation rejects unrelated access',
    (await tool('list_tickets', { ...project, project_id: 'unrelated' }, true)).error.code ===
      'wrong_project',
  );
  const get = await client.callTool({
    name: 'get_ticket',
    arguments: { ...project, ticket_id: ticket.id },
  });
  check(
    'Goal image is an MCP image block',
    get.content.some((c) => c.type === 'image') &&
      !JSON.stringify(get.structuredContent).includes('base64'),
  );
  check(
    'Project ticket list includes confirmed goal',
    (await tool('list_tickets', project)).tickets.some((t) => t.id === ticket.id),
  );
  const id = { ...project, ticket_id: ticket.id };
  let revision = 0;
  const update = async (status, extras = {}, error = false) => {
    const r = await tool(
      'update_ticket',
      {
        ...id,
        expected_revision: revision,
        operation_id: randomUUID(),
        status,
        summary: '격리 테스트 역할의 기록',
        ...extras,
      },
      error,
    );
    if (r.ok) revision = r.ticket.revision;
    return r;
  };
  check(
    'Implementation requires explicit human instruction',
    (await update('working', {}, true)).error.code === 'instruction_required',
  );
  await update('working', { implementation_instruction: '테스트 역할 사람이 구현 지시' });
  check(
    'Review requires result image and checks',
    (await update('review', {}, true)).error.code === 'evidence_required',
  );
  await update('review', {
    implementation_image_data_url: image_data_url,
    checks: '격리 NORTH 콘솔 렌더 검증',
  });
  check(
    'Completion requires approval record',
    (await update('done', {}, true)).error.code === 'approval_required',
  );
  await update('done', {
    review_decision: 'approved',
    review_note: '테스트 역할 사람이 결과 승인',
  });
  const final = await client.callTool({ name: 'get_ticket', arguments: id });
  check(
    'Goal and latest implementation image are returned together',
    final.content.filter((c) => c.type === 'image').length === 2 &&
      final.structuredContent.ticket.status === 'done',
  );
  check(
    'Stale ticket CAS rejected',
    (
      await tool(
        'update_ticket',
        {
          ...id,
          expected_revision: 0,
          operation_id: randomUUID(),
          status: 'queued',
          summary: 'stale',
        },
        true,
      )
    ).error.code === 'ticket_revision_conflict',
  );
  const undone = await tool('undo', {
    ...base,
    expected_revision: current.revision,
    operation_id: randomUUID(),
  });
  check(
    'Undo changes canvas without rewriting ticket',
    undone.persisted && (await tool('get_ticket', id)).ticket.status === 'done',
  );
  const report = {
    passed: checks.length,
    checks,
    ticket_id: ticket.id,
    project_id: screen.project_id,
  };
  await fs.mkdir(path.join(root, 'local'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'local/mcp-verification.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await client.close();
}
