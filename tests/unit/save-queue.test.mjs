import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaveQueue } from '../../save-queue.js';
const gate = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
test('coalesces pending edits without losing another document or mutating queued values', async () => {
  const first = gate(),
    started = gate(),
    writes = [];
  const queue = createSaveQueue(async (id, value) => {
    writes.push([id, value]);
    if (writes.length === 1) {
      started.resolve();
      await first.promise;
    }
  });
  const value = { note: 'first' };
  queue.enqueue('a', value);
  value.note = 'mutated';
  await started.promise;
  queue.enqueue('a', { note: 'intermediate' });
  queue.enqueue('b', { note: 'other' });
  queue.enqueue('a', { note: 'latest' });
  first.resolve();
  await queue.flush();
  assert.deepEqual(writes, [
    ['a', { note: 'first' }],
    ['a', { note: 'latest' }],
    ['b', { note: 'other' }],
  ]);
});
test('flush waits, reports failures and clears an error only after that document is saved', async () => {
  let fail = true;
  const queue = createSaveQueue(async (id) => {
    if (id === 'a' && fail) throw new Error('disk full');
  });
  queue.enqueue('a', {});
  await assert.rejects(queue.flush(), /disk full/);
  queue.enqueue('b', {});
  await assert.rejects(queue.flush(), /disk full/);
  fail = false;
  queue.enqueue('a', {});
  await queue.flush();
});
