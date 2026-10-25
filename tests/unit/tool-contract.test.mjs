import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { toolContract, validateToolArguments } from '../../tool-contract.js';
import { createWebMcpClient } from '../../webmcp-client.js';
import { createEditorController } from '../../editor-controller.js';

test('Python MCP and native WebMCP consume identical resolved contracts', () => {
  const python = JSON.parse(
    execFileSync(
      'python3',
      ['-c', 'import json; from mcp.server import definitions; print(json.dumps(definitions()))'],
      { cwd: new URL('../..', import.meta.url), encoding: 'utf8' },
    ),
  );
  assert.equal(python.length, 13);
  assert.deepEqual(python, toolContract.tools);
  const valid = {
    editor_id: 'editor',
    expected_revision: 1,
    operation_id: 'retry',
    operations: [{ type: 'comment', element_id: 'n1', text: '의도 😀' }],
  };
  validateToolArguments('apply_edits', valid);
  for (const invalid of [
    { ...valid, expected_revision: true },
    { ...valid, expected_revision: 1.5 },
    { ...valid, unknown: true },
    { ...valid, operations: [] },
    {
      ...valid,
      operations: [
        ...valid.operations,
        { type: 'move', element_id: 'n2', dx: Infinity, dy: 0, mode: 'absolute' },
      ],
    },
    { ...valid, operations: [{ type: 'comment', element_id: 'n1', text: 'x'.repeat(10001) }] },
  ])
    assert.throws(() => validateToolArguments('apply_edits', invalid));
});

test('Image reads report render failure, size limit and concurrent revision changes', async () => {
  const state = {
    ready: true,
    revision: 1,
    undo: [],
    redo: [],
    snapshot: {
      id: 'doc',
      source: { title: 'QA', url: 'https://example.test' },
    },
    scene: { nodes: new Map(), annotations: {}, changes: () => [] },
  };
  let render = async () => {
    throw Error('QA render failure');
  };
  const controller = createEditorController({
    state,
    editorId: 'editor',
    buildHandoffImage: (...args) => render(...args),
  });
  const execute = () =>
    controller.execute({
      name: 'get_review_image',
      document_id: 'doc',
      arguments: { editor_id: 'editor' },
      deadline: Date.now() / 1000 + 30,
    });
  assert.equal((await execute()).error.code, 'image_error');
  render = async () => ({ blob: { size: 20 * 1024 * 1024 + 1 } });
  assert.equal((await execute()).error.code, 'image_error');
  assert.equal(state.revision, 1);
  render = async () => {
    state.revision++;
    return { blob: { size: 1 } };
  };
  assert.equal((await execute()).error.code, 'revision_conflict');
  assert.deepEqual(state.undo, []);
});

test('Publication revokes queued commands and retries survive disable/enable', async () => {
  const oldDocument = globalThis.document;
  let metadata = { document_id: 'document-1', revision: 1 };
  const registered = new Map();
  const statuses = [];
  let writes = 0;
  globalThis.document = {
    modelContext: {
      registerTool(tool, { signal }) {
        registered.set(tool.name, tool);
        signal.addEventListener('abort', () => registered.delete(tool.name));
      },
    },
  };
  const client = createWebMcpClient({
    controller: {
      metadata: () => metadata,
      execute: async () => {
        writes++;
        return { ok: true, persisted: true, screen: { revision: ++metadata.revision } };
      },
    },
    onStatus: (status) => statuses.push(status),
  });
  try {
    assert.equal(registered.size, 0);
    await client.enable();
    const tool = registered.get('console_canvas_apply_edits');
    const args = {
      editor_id: 'editor',
      expected_revision: 1,
      operation_id: 'one',
      operations: [{ type: 'delete', element_id: 'n1' }],
    };
    const [a, b] = await Promise.all([tool.execute(args), tool.execute(args)]);
    assert.deepEqual(a, b);
    assert.equal(writes, 1);
    client.disable();
    assert.equal(registered.size, 0);
    assert.equal((await tool.execute(args)).error.code, 'disconnected');
    await client.enable();
    assert.deepEqual(await registered.get(tool.name).execute(args), a);
    assert.equal(writes, 1);
    assert.equal(
      (await registered.get(tool.name).execute({ ...args, expected_revision: 2 })).error.code,
      'operation_id_reused',
    );
    metadata = { document_id: 'document-2', revision: 1 };
    assert.equal((await registered.get(tool.name).execute(args)).error.code, 'wrong_document');
    assert.equal(registered.size, 0);
    assert.equal(writes, 1);
    assert.equal(statuses.at(-1).enabled, false);
  } finally {
    client.disable();
    globalThis.document = oldDocument;
  }
});
