import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { captureAssessment } from '../../capture-status.js';
import { prepareCaptureScope, renderScope } from '../../capture-scope.js';
const require = createRequire(import.meta.url),
  retry = require('../../desktop/repair-resources.cjs');
test('Missing capture is distinct from editing constraint and information', () => {
  const r = captureAssessment({
    nodes: [{ id: 'f', frame: { mode: 'image' } }],
    warnings: [
      { type: 'capture_limit', message: 'missing' },
      { type: 'shadow', message: 'flattened' },
    ],
  });
  assert.deepEqual(r.counts, { loss: 1, constraint: 1, info: 1 });
});
test('Scope rejects invalid metadata even if imported file claims prepared', () => {
  const s = {
    source: { width: 100, height: 100 },
    nodes: [],
    captureScope: { mode: 'region', rect: { x: 100, y: 0, width: 50, height: 50 }, prepared: true },
  };
  assert.throws(() => prepareCaptureScope(s));
  assert.throws(() =>
    renderScope('<meta name="console-canvas-view" content="0,0,200,20">', 100, 100),
  );
});
test('Resource retry identifies bytes and preserves individual failure', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
    'base64',
  );
  let options;
  const read = async (url, opts) => {
    options = opts;
    return url.includes('bad') ? new Response('<html>login</html>') : new Response(png);
  };
  const result = await retry(['https://example.test/a.png', 'https://example.test/bad'], read);
  assert.match(result[0].data, /^data:image\/png;base64,/);
  assert.ok(result[1].error);
  assert.equal(options.credentials, 'omit');
});
