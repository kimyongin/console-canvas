import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { toolContract, validateToolArguments } from '../../tool-contract.js';
import { createEditorController } from '../../editor-controller.js';

test('Python MCP and editor consume identical resolved contracts', () => {
  const python = JSON.parse(
    execFileSync(
      'python3',
      ['-c', 'import json; from mcp.server import definitions; print(json.dumps(definitions()))'],
      { cwd: new URL('../..', import.meta.url), encoding: 'utf8' },
    ),
  );
  assert.equal(python.length, 16);
  assert.deepEqual(python, toolContract.tools);
  const valid = {
    ticket_ref: 'CC-1',
    editor_id: 'editor',
    expected_edit_revision: 1,
    operation_id: 'retry',
    operations: [{ type: 'comment', element_id: 'n1', text: '의도 😀' }],
  };
  validateToolArguments('apply_edits', valid);
  for (const invalid of [
    { ...valid, expected_edit_revision: true },
    { ...valid, expected_edit_revision: 1.5 },
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
