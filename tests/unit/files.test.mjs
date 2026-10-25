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
test('native PNG save uses the image filter and atomically writes actual PNG bytes', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-png-save-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1cAAAAASUVORK5CYII=',
    'base64',
  );
  const target = path.join(directory, 'review.png');
  let options;
  const save = createFileSaver({
    dialog: {
      showSaveDialog: async (_window, value) => {
        options = value;
        return { canceled: false, filePath: target };
      },
    },
    getWindow: () => null,
    downloads: directory,
  });
  const bytes = Uint8Array.from(png).buffer;
  await save({ name: 'console-canvas-test.png', bytes });
  assert.deepEqual(options.filters, [{ name: 'PNG 이미지', extensions: ['png'] }]);
  assert.deepEqual(await fs.readFile(target), png);
  assert.deepEqual(await fs.readdir(directory), ['review.png']);
  await assert.rejects(save({ name: 'console-canvas-test.png', bytes: new ArrayBuffer(8) }), /PNG/);
  await assert.rejects(
    save({ name: 'console-canvas-test.png', bytes: new ArrayBuffer(120_000_001) }),
  );
});
