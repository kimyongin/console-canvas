import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { prepareCaptureView } = createRequire(import.meta.url)('../../desktop/capture-view.cjs');
test('unresponsive source context cannot leave capture preparation pending forever', async () => {
  let calls = 0;
  await assert.rejects(
    prepareCaptureView(
      {
        executeJavaScriptInIsolatedWorld() {
          calls++;
          return new Promise(() => {});
        },
      },
      '',
      { timeoutMs: 10 },
    ),
    /원본 화면 응답/,
  );
  assert.equal(calls, 1);
});
