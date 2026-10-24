import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const { createUpdater } = createRequire(import.meta.url)('../../desktop/updater.cjs');
test('updater launches replacement and requests quit only after the shared flush succeeds', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-updater-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'mcp'));
  await fs.mkdir(path.join(root, 'updates'));
  await fs.writeFile(
    path.join(root, 'mcp/app_update.py'),
    `import json,sys\nfrom pathlib import Path\nif sys.argv[1] == 'prepare':\n print(json.dumps({'type':'result','plan':'test-plan','version':'0.9.0'}))\nelse:\n Path(__file__).with_name('applied').write_text('done')\n`,
  );
  let fail = true,
    flushes = 0,
    quits = 0;
  const updater = createUpdater({
    app: { getPath: () => root },
    root,
    python: '/usr/bin/python3',
    version: '0.8.0',
    skillSync: {},
    notify() {},
    flush: async () => {
      flushes++;
      if (fail) throw new Error('not saved');
      return { document_id: 'doc' };
    },
    quit: () => {
      quits++;
    },
  });
  await updater.download();
  await assert.rejects(updater.install(), /not saved/);
  assert.equal(quits, 0);
  assert.equal(updater.info().phase, 'ready');
  fail = false;
  assert.deepEqual(await updater.install(), { restarting: true });
  assert.equal(flushes, 2);
  assert.equal(quits, 1);
  const marker = path.join(root, 'updates/applied');
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await fs.access(marker);
      break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(await fs.readFile(marker, 'utf8'), 'done');
});
