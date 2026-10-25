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
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => !['--web', '--all'].includes(arg))) {
    throw new Error('Usage: node scripts/check.mjs [--web | --all]');
  }
  const includeDesktop = args[0] === '--all';
  console.log(includeDesktop ? 'Scope: web/common + Electron integration' : 'Scope: web/common');
  await run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit']);
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
  if (includeDesktop) await run(process.execPath, ['scripts/check-desktop.mjs']);
  console.log(
    includeDesktop
      ? 'Web/common and Electron integration checks passed. Installed-app deployment is separate.'
      : 'Web/common checks passed. Electron integration and installed-app deployment were not run.',
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
