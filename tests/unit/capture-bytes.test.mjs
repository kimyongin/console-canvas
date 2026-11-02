import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { fromText, toText, fromBase64, toBase64, concatBytes, signature } = createRequire(
  import.meta.url,
)('../../capture/bytes.cjs');
test('portable capture bytes preserve unicode and every byte across stream boundaries', () => {
  const text = '한글 · 😀 CSS @font-face';
  assert.equal(toText(fromBase64(toBase64(fromText(text)))), text);
  const bytes = Uint8Array.from({ length: 100003 }, (_, i) => i % 256);
  const encoded = toBase64(bytes);
  assert.equal(encoded, Buffer.from(bytes).toString('base64'));
  assert.deepEqual(fromBase64(encoded), bytes);
  assert.deepEqual(concatBytes([bytes.subarray(0, 4097), bytes.subarray(4097)]), bytes);
  assert.equal(signature(fromText('wOF2 font')), 'wOF2');
  assert.equal(toBase64(new Uint8Array()), '');
});
