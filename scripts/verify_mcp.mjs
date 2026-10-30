// Run against an OPEN desktop app with only the disposable local sample connected.
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const client = new Client({
  name: 'console-canvas-real-connection-test',
  version: JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version,
});
const transport = new StdioClientTransport({
  command:
    process.env.CONSOLE_CANVAS_MCP_COMMAND ||
    process.env.CONSOLE_CANVAS_PYTHON ||
    '/usr/bin/python3',
  args: process.env.CONSOLE_CANVAS_MCP_ARGS
    ? JSON.parse(process.env.CONSOLE_CANVAS_MCP_ARGS)
    : [path.join(root, 'mcp/server.py')],
  stderr: 'pipe',
});
const checks = [];
function check(name, value) {
  assert.ok(value, name);
  checks.push(name);
}
async function tool(name, args = {}, allowError = false) {
  const result = await client.callTool({ name, arguments: args });
  const value = result.structuredContent || JSON.parse(result.content[0].text);
  if (!allowError) assert.equal(result.isError, false, JSON.stringify(value));
  return value;
}
try {
  await client.connect(transport);
  const tools = await client.listTools();
  check('Official SDK discovers nineteen MCP tools', tools.tools.length === 19);
  const guide = await tool('get_agent_guide');
  check(
    'Agent reads the app-bundled skill through MCP',
    guide.source === 'app_bundle' &&
      guide.name === 'console-canvas' &&
      guide.markdown.includes('## 독립 앱과 MCP') &&
      guide.markdown.includes('restore_snapshot'),
  );
  const screens = (await tool('list_screens')).screens;
  const screen = screens.find((s) => {
    const u = new URL(s.url);
    return u.hostname === '127.0.0.1' && u.pathname === '/fixtures/console.html';
  });
  assert.ok(screen, 'Capture the disposable sample in the desktop app first');
  const editor_id = screen.editor_id,
    base = { editor_id };
  let current = (await tool('get_screen', base)).screen;
  check('Real desktop screen is connected', current.element_count > 300);
  check(
    'Capture evidence separates original pixels, scope and severity',
    current.capture_reference?.kind === 'captured_pixels' &&
      current.capture_reference.visual_comparison === 'not_measured' &&
      current.capture_scope.mode === 'document' &&
      typeof current.capture_status.counts.loss === 'number',
  );
  check(
    'MCP describes bounded offline resource patches',
    tools.tools
      .find((t) => t.name === 'apply_code_patches')
      .inputSchema.properties.patches.items.properties.type.enum.includes('resource'),
  );
  const invalidResource = await tool(
    'apply_code_patches',
    {
      ...base,
      expected_revision: current.revision,
      operation_id: randomUUID(),
      patches: [
        {
          type: 'resource',
          resource_url: 'https://unobserved.example.test/asset.png',
          data: 'data:font/woff2;base64,d09GMgAAAAAAAABh',
        },
      ],
    },
    true,
  );
  check(
    'Unobserved resource is rejected atomically through official SDK',
    invalidResource.ok === false &&
      (await tool('get_screen', base)).screen.revision === current.revision,
  );
  const elements = (await tool('list_elements', { ...base, query: 'new-customer' })).elements;
  const button = elements.find((e) => e.tag === 'button' && e.locator.id === 'new-customer');
  assert.ok(button);
  const icon = (await tool('list_elements', { ...base, parent_id: button.id })).elements.find(
    (e) => e.kind === 'icon',
  );
  assert.ok(icon);
  const initialUndoCount = current.undo_count;
  const revision = current.revision,
    operation_id = randomUUID();
  const batch = {
    ...base,
    expected_revision: revision,
    operation_id,
    operations: [
      { type: 'move', element_id: button.id, mode: 'absolute', dx: -120, dy: 50 },
      { type: 'delete', element_id: icon.id },
      {
        type: 'comment',
        element_id: button.id,
        text: 'MCP로 적용한 시안입니다. 버튼 위치를 확인하고 문구를 고객 추가로 바꿔 주세요.',
      },
    ],
  };
  current = (await tool('apply_edits', batch)).screen;
  check(
    'Move + delete + comment form one shared undo step',
    current.undo_count === initialUndoCount + 1 && current.revision === revision + 1,
  );
  let result = (await tool('list_elements', { ...base, query: 'new-customer' })).elements.find(
    (e) => e.id === button.id,
  );
  check(
    'Move is reflected in actual editor geometry',
    Math.abs(result.current_rect.x - button.current_rect.x + 120) < 1 &&
      Math.abs(result.current_rect.y - button.current_rect.y - 50) < 1,
  );
  check(
    'Component comment retains its original locator',
    (await tool('list_comments', base)).comments.some(
      (c) => c.id === button.id && c.locator.id === 'new-customer',
    ),
  );
  check(
    'Target icon is deleted',
    (await tool('list_elements', { ...base, parent_id: button.id })).elements.find(
      (e) => e.id === icon.id,
    ).deleted,
  );
  const replay = await tool('apply_edits', batch);
  check(
    'Retry uses cached result without applying twice',
    replay.screen.revision === current.revision &&
      (await tool('get_screen', base)).screen.revision === current.revision,
  );
  const conflict = await tool('apply_edits', { ...batch, operation_id: randomUUID() }, true);
  check('Stale revision is rejected', conflict.error?.code === 'revision_conflict');
  current = (
    await tool('undo', { ...base, expected_revision: current.revision, operation_id: randomUUID() })
  ).screen;
  result = (await tool('list_elements', { ...base, query: 'new-customer' })).elements.find(
    (e) => e.id === button.id,
  );
  check(
    'Undo restores position, deletion, and comment together',
    Math.abs(result.current_rect.x - button.current_rect.x) < 1 &&
      !(await tool('list_comments', base)).comments.length &&
      !(await tool('list_elements', { ...base, parent_id: button.id })).elements.find(
        (e) => e.id === icon.id,
      ).deleted,
  );
  current = (
    await tool('redo', { ...base, expected_revision: current.revision, operation_id: randomUUID() })
  ).screen;
  const edited =
    '에이전트가 기존 주석을 수정했습니다. 이 배치를 기준으로 반응형 UI를 구현해 주세요.';
  current = (
    await tool('apply_edits', {
      ...base,
      expected_revision: current.revision,
      operation_id: randomUUID(),
      operations: [{ type: 'comment', element_id: button.id, text: edited }],
    })
  ).screen;
  check(
    'Existing comment can be edited',
    (await tool('list_comments', base)).comments.find((c) => c.id === button.id).text === edited,
  );
  current = (
    await tool('apply_edits', {
      ...base,
      expected_revision: current.revision,
      operation_id: randomUUID(),
      operations: [{ type: 'comment', element_id: button.id, text: '' }],
    })
  ).screen;
  check('Empty text deletes a comment', !(await tool('list_comments', base)).comments.length);
  current = (
    await tool('undo', { ...base, expected_revision: current.revision, operation_id: randomUUID() })
  ).screen;
  const invalid = await tool(
    'apply_edits',
    {
      ...base,
      expected_revision: current.revision,
      operation_id: randomUUID(),
      operations: [
        { type: 'move', element_id: button.id, mode: 'relative', dx: 40, dy: 0 },
        { type: 'delete', element_id: 'n999999' },
      ],
    },
    true,
  );
  check(
    'Invalid batch applies nothing',
    invalid.error?.code === 'unknown_element' &&
      (await tool('get_screen', base)).screen.revision === current.revision,
  );
  const initialVersion = (await tool('list_snapshots', base)).snapshots[0];
  assert.ok(initialVersion);
  const saved = await tool('create_snapshot', {
    ...base,
    expected_revision: current.revision,
    operation_id: randomUUID(),
    name: 'MCP 시안 B',
  });
  current = saved.screen;
  const snapshotBatch = {
    ...base,
    expected_revision: current.revision,
    operation_id: randomUUID(),
    operations: [
      { type: 'move', element_id: button.id, mode: 'absolute', dx: -40, dy: 90 },
      { type: 'comment', element_id: button.id, text: '스냅샷으로 보호할 미저장 작업' },
    ],
  };
  current = (await tool('apply_edits', snapshotBatch)).screen;
  const restored = await tool('restore_snapshot', {
    ...base,
    expected_revision: current.revision,
    operation_id: randomUUID(),
    snapshot_id: initialVersion.id,
  });
  current = restored.screen;
  let versions = await tool('list_snapshots', base);
  check(
    'MCP restores initial state while retaining future and automatic snapshots',
    !!restored.automatic_snapshot_id &&
      versions.total === 3 &&
      !(await tool('list_comments', base)).comments.length,
  );
  const savedReplay = {
    ...base,
    expected_revision: current.revision,
    operation_id: randomUUID(),
    snapshot_id: saved.snapshot_id,
  };
  current = (await tool('restore_snapshot', savedReplay)).screen;
  check(
    'MCP returns from the past to saved future geometry and comment',
    (await tool('list_comments', base)).comments.find((c) => c.id === button.id)?.text === edited &&
      (await tool('list_elements', { ...base, query: 'new-customer' })).elements.find(
        (e) => e.id === button.id,
      ).offset.dx === -120,
  );
  const replayRestore = await tool('restore_snapshot', savedReplay);
  check(
    'Snapshot restoration retries do not create extra versions',
    replayRestore.screen.revision === current.revision &&
      (await tool('list_snapshots', base)).total === 3,
  );
  current = (
    await tool('restore_snapshot', {
      ...base,
      expected_revision: current.revision,
      operation_id: randomUUID(),
      snapshot_id: restored.automatic_snapshot_id,
    })
  ).screen;
  check(
    'Automatic snapshot recovers unsaved work',
    (await tool('list_comments', base)).comments.find((c) => c.id === button.id)?.text ===
      '스냅샷으로 보호할 미저장 작업',
  );
  current = (
    await tool('undo', { ...base, expected_revision: current.revision, operation_id: randomUUID() })
  ).screen;
  check(
    'Undoing a snapshot jump restores the prior version and keeps all snapshots',
    current.active_snapshot_id === saved.snapshot_id &&
      (await tool('list_snapshots', base)).total === 3,
  );
  const finalRestore = await tool('restore_snapshot', {
    ...base,
    expected_revision: current.revision,
    operation_id: randomUUID(),
    snapshot_id: initialVersion.id,
  });
  current = finalRestore.screen;
  const history = await tool('list_history', { ...base, scope: 'all' });
  check(
    'Official SDK reads persisted branch-aware history',
    history.total > 5 && history.events.some((e) => e.actor === 'agent'),
  );
  current = (
    await tool('apply_edits', {
      ...base,
      expected_revision: current.revision,
      operation_id: randomUUID(),
      operations: [
        { type: 'point_comment', x: 770, y: 350, text: '검색 영역에 맞춰 여백을 정리해 주세요.' },
      ],
    })
  ).screen;
  check(
    'Official SDK creates and queries coordinate annotations',
    (await tool('list_comments', base)).comments.some(
      (c) => c.id === 'point:770:350' && c.point.x === 770,
    ),
  );
  const image = await client.callTool({ name: 'get_review_image', arguments: base });
  if (image.isError)
    throw new Error(
      'MCP image failure: ' + JSON.stringify(image.structuredContent || image.content),
    );
  const imageBlock = image.content.find((c) => c.type === 'image');
  check(
    'Official SDK receives a real PNG as MCP image content',
    !image.isError &&
      imageBlock?.mimeType === 'image/png' &&
      Buffer.from(imageBlock.data, 'base64').subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
  );
  await fs.writeFile(
    path.join(root, 'local/mcp-review-image.png'),
    Buffer.from(imageBlock.data, 'base64'),
  );
  const imageBefore = current.revision;
  current = (await tool('get_screen', base)).screen;
  check('MCP image retrieval does not mutate current revision', current.revision === imageBefore);
  current = (
    await tool('undo', { ...base, expected_revision: current.revision, operation_id: randomUUID() })
  ).screen;
  const report = {
    officialSdk: true,
    transport: 'stdio',
    passed: checks.length,
    checks,
    editor_id,
    document_id: screen.document_id,
    final_revision: current.revision,
  };
  await fs.mkdir(path.join(root, 'local'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'local/mcp-native-verification.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.close();
}
