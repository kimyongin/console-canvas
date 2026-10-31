// Official SDK v2, pinned modern protocol, disposable app fixture only.
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const args = JSON.parse(process.env.CONSOLE_CANVAS_MCP_ARGS || '[]');
const client = new Client(
  { name: 'console-canvas-modern-qa', version: '1.0.0' },
  { versionNegotiation: { mode: { pin: '2026-07-28' } } },
);
const checks = [];
function check(name, value) {
  assert.ok(value, name);
  checks.push(name);
}
async function tool(name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, false, JSON.stringify(result.structuredContent));
  return result.structuredContent;
}
try {
  await client.connect(
    new StdioClientTransport({
      command: process.env.CONSOLE_CANVAS_PYTHON || '/usr/bin/python3',
      args,
      stderr: 'pipe',
    }),
  );
  check(
    'Pinned 2026 protocol discovers server identity without initialize',
    client.getServerVersion()?.name === 'console-canvas',
  );
  const guide = await tool('get_agent_guide', {});
  check(
    'Modern live guide documents frozen candidate editing',
    guide.markdown.includes('register_ai_candidate') && guide.markdown.includes('2026-07-28'),
  );
  const definitions = await client.listTools();
  check('Modern discovers shared 19 tools', definitions.tools.length === 19);
  const screen = (await tool('list_screens', {})).screens.find((s) =>
    s.url.includes('/fixtures/console.html'),
  );
  assert.ok(screen, 'Disposable fixture screen required');
  const base = { editor_id: screen.editor_id },
    write = { ...base, expected_revision: screen.revision };
  const resources = await client.listResources(),
    resource = resources.resources.find((r) => r.uri.includes(screen.editor_id));
  check('Frozen requests are explicit resources', !!resource);
  let notifications = 0;
  client.setNotificationHandler('notifications/resources/updated', (notification) => {
    if (notification.params.uri === resource.uri) notifications++;
  });
  const subscription = await client.listen({
    resourceSubscriptions: [resource.uri],
    toolsListChanged: true,
  });
  check(
    'Subscription acknowledges only supported filters',
    subscription.honoredFilter.resourceSubscriptions.includes(resource.uri) &&
      !subscription.honoredFilter.toolsListChanged,
  );
  // Allow initial poll baseline before writes.
  await new Promise((r) => setTimeout(r, 600));
  const request = await tool('create_ai_request', {
    ...write,
    operation_id: randomUUID(),
    prompt: 'Three visual alternatives from SDK v2',
    count: 3,
  });
  check(
    'Request creation keeps current revision and undo',
    request.screen.revision === screen.revision,
  );
  const context = await tool('get_ai_context', {
    ...base,
    request_id: request.request.id,
    full_context: true,
  });
  const visual = await client.callTool({
    name: 'get_ai_context',
    arguments: { ...base, request_id: request.request.id },
  });
  check(
    'Default AI context is visual MCP content without HTML/CSS or locators',
    visual.structuredContent.kind === 'visual' &&
      !visual.structuredContent.html &&
      !visual.structuredContent.styles &&
      !visual.structuredContent.baseline.codePatches &&
      visual.content.some((c) => c.type === 'image') &&
      visual.structuredContent.images.every((i) => !i.image_url),
  );
  const node = context.elements.find((n) => n.locator?.id === 'new-customer');
  assert.ok(node);
  const candidates = [];
  for (const color of ['#ef4444', '#22c55e', '#3b82f6']) {
    const batch = {
      ...write,
      operation_id: randomUUID(),
      request_id: request.request.id,
      name: color,
      patches: [{ type: 'style', element_id: node.id, properties: { 'background-color': color } }],
    };
    const result = await tool('register_ai_candidate', batch);
    candidates.push(result.candidate);
    const replay = await tool('register_ai_candidate', batch);
    check('Candidate retry is idempotent ' + color, replay.candidate.id === result.candidate.id);
  }
  const list = await tool('list_ai_requests', base);
  check(
    'Three candidates are registered without auto-apply',
    list.requests.find((r) => r.id === request.request.id).candidates.length === 3 &&
      (await tool('get_screen', base)).screen.revision === screen.revision,
  );
  const candidateContext = await tool('get_ai_context', {
    ...base,
    request_id: request.request.id,
    candidate_id: candidates[1].id,
    full_context: true,
  });
  check(
    'Agent can inspect actual unselected candidate code',
    candidateContext.html.includes('34, 197, 94'),
  );
  const image = await client.callTool({
    name: 'get_review_image',
    arguments: { ...base, request_id: request.request.id, candidate_id: candidates[1].id },
  });
  check(
    'Agent receives real candidate PNG without applying',
    image.content.some(
      (c) =>
        c.type === 'image' &&
        Buffer.from(c.data, 'base64').subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
    ),
  );
  const value = await client.readResource({ uri: resource.uri });
  check(
    'Resources expose persisted request summaries',
    value.contents[0].text.includes(request.request.id),
  );
  const deadline = Date.now() + 10000;
  while (!notifications && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  check('Resource change notification arrives on subscribed stream', notifications > 0);
  await subscription.close();
  check('Cancel closes subscription locally', (await subscription.closed) === 'local');
  const second = await client.listen({ resourcesListChanged: true });
  check(
    'Re-listen explicitly establishes a new subscription',
    second.honoredFilter.resourcesListChanged,
  );
  await second.close();
  const applied = await tool('apply_code_patches', {
    ...write,
    operation_id: randomUUID(),
    patches: [{ type: 'style', element_id: node.id, properties: { color: '#111827' } }],
  });
  check(
    'Modern direct code patches increment one shared undo step',
    applied.screen.revision === screen.revision + 1,
  );
  await tool('undo', {
    ...base,
    expected_revision: applied.screen.revision,
    operation_id: randomUUID(),
  });
  console.log(
    JSON.stringify(
      {
        officialSdk: '@modelcontextprotocol/client@2.4.0',
        protocol: '2026-07-28',
        passed: checks.length,
        checks,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
