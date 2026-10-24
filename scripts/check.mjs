import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
const root = path.resolve(import.meta.dirname, '..');
async function run(command, args) {
  console.log(`\n→ ${command} ${args.join(' ')}`);
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, NODE_BINARY: process.execPath },
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Check failed (${code})`)),
    );
  });
}
try {
  await run(process.execPath, ['scripts/format.mjs', '--check']);
  await run('python3', ['scripts/build.py']);
  await run('python3', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py']);
  await run(process.execPath, [
    '--test',
    ...(await fs.readdir(path.join(root, 'tests/unit')))
      .filter((name) => name.endsWith('.test.mjs'))
      .map((name) => 'tests/unit/' + name),
  ]);
  await run(process.env.ELECTRON_BINARY || path.join(root, 'node_modules/.bin/electron'), [
    'tests/browser-runner.cjs',
  ]);
  await run(process.execPath, ['scripts/check-desktop.mjs']);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
