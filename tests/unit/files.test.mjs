import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { createFileSaver } = createRequire(import.meta.url)('../../desktop/files.cjs');
test('native file saving reports cancellation without creating a file', async () => {
  const save = createFileSaver({
    dialog: { showSaveDialog: async () => ({ canceled: true }) },
    getWindow: () => null,
    downloads: '/tmp',
  });
  assert.deepEqual(await save({ name: 'console-canvas-test.json', bytes: new ArrayBuffer(0) }), {
    canceled: true,
  });
});
test('native file saving writes acknowledged bytes atomically and rejects path injection', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-file-save-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'review.json');
  let prompts = 0;
  const save = createFileSaver({
    dialog: {
      showSaveDialog: async () => {
        prompts++;
        return { canceled: false, filePath: target };
      },
    },
    getWindow: () => null,
    downloads: directory,
  });
  const result = await save({
    name: 'console-canvas-test.json',
    bytes: new TextEncoder().encode('{"saved":true}').buffer,
  });
  assert.equal(result.path, target);
  assert.equal(await fs.readFile(target, 'utf8'), '{"saved":true}');
  assert.equal((await fs.readdir(directory)).length, 1);
  await assert.rejects(save({ name: '../console-canvas-test.json', bytes: new ArrayBuffer(0) }));
  assert.equal(prompts, 1);
});
