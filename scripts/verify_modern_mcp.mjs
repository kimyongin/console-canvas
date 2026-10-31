import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const client = new Client(
    { name: 'console-canvas-modern-ticket-qa', version: '0.46.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  ),
  checks = [];
const check = (name, value) => {
  assert.ok(value, name);
  checks.push(name);
};
async function tool(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  assert.equal(r.isError, false, JSON.stringify(r.structuredContent));
  return r.structuredContent;
}
try {
  await client.connect(
    new StdioClientTransport({
      command: process.env.CONSOLE_CANVAS_PYTHON || '/usr/bin/python3',
      args: JSON.parse(process.env.CONSOLE_CANVAS_MCP_ARGS || '[]'),
      stderr: 'pipe',
    }),
  );
  check(
    'Modern server identity without initialize',
    client.getServerVersion()?.name === 'console-canvas',
  );
  check('Modern discovers current shared tools', (await client.listTools()).tools.length === 16);
  const screen = (await tool('list_screens')).screens.find(
    (s) => s.workspace && s.project_ids?.length,
  );
  assert.ok(screen);
  const resource = (await client.listResources()).resources.find((r) =>
    r.uri.includes(screen.editor_id),
  );
  check(
    'Only connected project tickets are explicit resources',
    resource?.uri.endsWith('/tickets'),
  );
  const read = await client.readResource({ uri: resource.uri });
  check('Read project ticket resource', JSON.parse(read.contents[0].text).tickets.length > 0);
  let notifications = 0;
  client.setNotificationHandler('notifications/resources/updated', (n) => {
    if (n.params.uri === resource.uri) notifications++;
  });
  const subscription = await client.listen({
    resourceSubscriptions: [resource.uri],
    toolsListChanged: true,
  });
  check(
    'Subscription honors supported resource only',
    subscription.honoredFilter.resourceSubscriptions.includes(resource.uri) &&
      !subscription.honoredFilter.toolsListChanged,
  );
  await new Promise((r) => setTimeout(r, 600));
  const tickets = await tool('list_tickets', {
      editor_id: screen.editor_id,
      project_id: screen.project_id,
    }),
    t = tickets.tickets.find((t) => t.has_goal);
  await tool('update_ticket', {
    editor_id: screen.editor_id,
    project_id: screen.project_id,
    ticket_ref: t.id,
    goal_id: t.goal_id,
    expected_ticket_revision: t.revision,
    operation_id: randomUUID(),
    status: 'queued',
    summary: '동일 목표 수정 요청 · 격리 테스트',
  });
  const deadline = Date.now() + 6000;
  while (!notifications && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  check('Ticket revision emits subscribed resource notification', notifications > 0);
  await subscription.close();
  console.log(JSON.stringify({ passed: checks.length, checks, protocol: '2026-07-28' }));
} finally {
  await client.close();
}
