import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createEditorLifecycle } = require('../../desktop/lifecycle.cjs');
const { trustFrame, webUrl } = require('../../desktop/security.cjs');
async function fixture(t, overrides = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-lifecycle-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const ipcMain = new EventEmitter(),
    contents = new EventEmitter();
  contents.mainFrame = {};
  const trusted = (event) => trustFrame(event, contents),
    event = { sender: contents, senderFrame: contents.mainFrame };
  const options = {
    ipcMain,
    trusted,
    getContents: () => contents,
    isReady: () => true,
    isBusy: () => false,
    sessionFile: path.join(dir, 'session.json'),
    timeout: 50,
    ...overrides,
  };
  return { lifecycle: createEditorLifecycle(options), options, contents, ipcMain, event };
}
test('close and updater share one acknowledged flush; last document reopens on normal startup', async (t) => {
  const f = await fixture(t);
  let count = 0;
  f.contents.send = (channel, id) => {
    assert.equal(channel, 'canvas:flush');
    count++;
    setImmediate(() =>
      f.ipcMain.emit('canvas:flushed', f.event, id, { ok: true, document_id: 'doc-a' }),
    );
  };
  assert.deepEqual(await Promise.all([f.lifecycle.flush(), f.lifecycle.flush()]), [
    { document_id: 'doc-a' },
    { document_id: 'doc-a' },
  ]);
  assert.equal(count, 1);
  assert.equal(f.ipcMain.listenerCount('canvas:flushed'), 0);
  assert.deepEqual(createEditorLifecycle(f.options).restore(), { document_id: 'doc-a' });
});
test('failed or missing acknowledgements do not overwrite last session and remove IPC listeners', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.options.sessionFile, JSON.stringify({ document_id: 'keep' }));
  f.contents.send = (channel, id) =>
    setImmediate(() =>
      f.ipcMain.emit('canvas:flushed', f.event, id, { ok: false, message: 'disk full' }),
    );
  await assert.rejects(f.lifecycle.flush(), /disk full/);
  f.contents.send = () => {};
  await assert.rejects(f.lifecycle.flush(), /응답/);
  assert.equal(f.ipcMain.listenerCount('canvas:flushed'), 0);
  assert.equal(f.contents.listenerCount('destroyed'), 0);
  assert.equal(JSON.parse(await fs.readFile(f.options.sessionFile)).document_id, 'keep');
});
test('quit is deferred until persistence succeeds and stays cancellable on failure', async (t) => {
  const f = await fixture(t);
  const app = new EventEmitter();
  let exited = 0,
    error;
  app.quit = () => {
    let prevented = false;
    app.emit('before-quit', {
      preventDefault() {
        prevented = true;
      },
    });
    if (!prevented) exited++;
  };
  f.lifecycle.protectQuit(app, (e) => {
    error = e;
  });
  f.contents.send = (channel, id) =>
    setImmediate(() =>
      f.ipcMain.emit('canvas:flushed', f.event, id, { ok: false, message: 'failed' }),
    );
  app.quit();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(exited, 0);
  assert.equal(error.message, 'failed');
  f.contents.send = (channel, id) =>
    setImmediate(() =>
      f.ipcMain.emit('canvas:flushed', f.event, id, { ok: true, document_id: 'saved' }),
    );
  app.quit();
  assert.equal(exited, 0);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(exited, 1);
  assert.equal(f.lifecycle.canQuit(), true);
});
test('security only trusts the exact mainFrame and HTTP(S) URLs without credentials', () => {
  const contents = { mainFrame: {} };
  assert.throws(() => trustFrame({ sender: contents, senderFrame: {} }, contents));
  assert.throws(() => webUrl('file:///etc/passwd'));
  assert.throws(() => webUrl('https://user:secret@example.com'));
  assert.equal(webUrl('https://example.com'), 'https://example.com/');
});
