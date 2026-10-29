import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { readPublicResource } = createRequire(import.meta.url)(
  '../../desktop/capture-resources.cjs',
);
test('observed public resource fallback omits credentials and bounds its response', async () => {
  let options;
  const result = await readPublicResource(
    'https://assets.example.test/font.woff2',
    async (_url, init) => {
      options = init;
      return new Response(new Uint8Array([119, 79, 70, 50]));
    },
  );
  assert.equal(options.credentials, 'omit');
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(result.content, Buffer.from('wOF2').toString('base64'));
  await assert.rejects(
    readPublicResource(
      'https://assets.example.test/large',
      async () => new Response('x', { headers: { 'content-length': '5000001' } }),
    ),
  );
});
test('public resource fallback rejects custom protocols and credentials before fetching', async () => {
  let calls = 0;
  for (const url of [
    'file:///private/data',
    'data:text/plain,test',
    'https://user:secret@example.test/font',
  ])
    await assert.rejects(
      readPublicResource(url, async () => {
        calls++;
      }),
    );
  assert.equal(calls, 0);
});
test('unknown-length streaming resources stop and cancel at the byte budget', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(3_000_000));
      controller.enqueue(new Uint8Array(3_000_000));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    readPublicResource('https://assets.example.test/stream', async () => new Response(stream)),
  );
  assert.equal(cancelled, true);
});
