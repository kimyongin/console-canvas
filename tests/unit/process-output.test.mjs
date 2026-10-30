import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startProcess } from '../../scripts/process-output.mjs';
test('native JSON stdout remains parseable with macOS stderr diagnostics', async () => {
  let diagnostics = '';
  const p = startProcess(
    process.execPath,
    ['-e', `process.stderr.write('native diagnostic\\n');process.stdout.write('{"passed":5}');`],
    { onDiagnostic: (c) => (diagnostics += c) },
  );
  assert.deepEqual(JSON.parse(await p.done), { passed: 5 });
  assert.match(diagnostics, /native diagnostic/);
});
test('nonzero native process retains failure and diagnostic context', async () => {
  const p = startProcess(
    process.execPath,
    ['-e', `process.stderr.write('real failure');process.exit(3);`],
    { onDiagnostic() {} },
  );
  await assert.rejects(p.done, /real failure/);
});
test('invalid JSON is never converted into a passing native result', async () => {
  const p = startProcess(process.execPath, ['-e', `process.stdout.write('broken protocol');`], {
    onDiagnostic() {},
  });
  await assert.rejects(async () => JSON.parse(await p.done), SyntaxError);
});
