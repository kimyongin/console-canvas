import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
const root = path.resolve(import.meta.dirname, '..');
const appRoot = process.env.CONSOLE_CANVAS_TEST_APP_ROOT || root;
const offscreen = process.argv.includes('--offscreen');
const fixture = offscreen ? 'tests/desktop-offscreen-fixture.cjs' : 'tests/desktop-fixture.cjs';
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'console-canvas-desktop-check-'));
const socket = net.createServer();
await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const env = {
  ...process.env,
  HOME: path.join(temporary, 'home'),
  CODEX_HOME: path.join(temporary, 'home/.codex'),
  CONSOLE_CANVAS_TEST_DIR: temporary,
  CONSOLE_CANVAS_STATE_DIR: path.join(temporary, 'bridge'),
  CONSOLE_CANVAS_PORT: String(port),
  ...(offscreen ? { CONSOLE_CANVAS_OFFSCREEN: '1' } : {}),
};
await fs.mkdir(env.HOME, { recursive: true });
let active,
  checking = true;
function start(command, args, extra = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...env, ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve(output) : reject(new Error(output || 'Process failed: ' + code)),
    );
  });
  done.catch(() => {});
  return {
    child,
    done,
    get output() {
      return output;
    },
  };
}
async function waitFor(filename) {
  const deadline = Date.now() + 60000;
  while (checking && Date.now() < deadline) {
    try {
      return JSON.parse(await fs.readFile(path.join(temporary, filename), 'utf8'));
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Timed out: ' + filename);
}
try {
  const electron = process.env.ELECTRON_BINARY || path.join(root, 'node_modules/.bin/electron');
  active = start(electron, [fixture], { CONSOLE_CANVAS_TEST_PHASE: 'prepare' });
  const capture = await Promise.race([
    waitFor('prepare-ready.json'),
    active.done.then(() => {
      throw new Error('Desktop fixture exited before prepare');
    }),
  ]);
  const sdk = start(process.execPath, ['scripts/verify_mcp.mjs'], {
    CONSOLE_CANVAS_MCP_ARGS: JSON.stringify([
      path.join(appRoot, 'mcp/server.py'),
      '--state-dir',
      env.CONSOLE_CANVAS_STATE_DIR,
      '--port',
      String(port),
    ]),
  });
  const sdkOutput = await sdk.done;
  const sdkReport = JSON.parse(sdkOutput);
  console.log(`Real SDK: ${sdkReport.passed} checks passed`);
  const modernSdk = start(process.execPath, ['scripts/verify_modern_mcp.mjs'], {
    CONSOLE_CANVAS_MCP_ARGS: JSON.stringify([
      path.join(appRoot, 'mcp/server.py'),
      '--state-dir',
      env.CONSOLE_CANVAS_STATE_DIR,
      '--port',
      String(port),
    ]),
  });
  const modernReport = JSON.parse(await modernSdk.done);
  console.log(`Modern SDK: ${modernReport.passed} checks passed`);
  await fs.writeFile(
    path.join(root, 'local/mcp-modern-verification.json'),
    JSON.stringify(modernReport, null, 2),
  );
  await fs.writeFile(path.join(temporary, 'sdk-complete'), 'done');
  await active.done;
  active = null;
  const expected = JSON.parse(await fs.readFile(path.join(temporary, 'expected.json'), 'utf8'));
  const session = JSON.parse(
    await fs.readFile(path.join(temporary, 'profile/session.json'), 'utf8'),
  );
  if (session.document_id !== expected.document_id)
    throw new Error('Normal quit did not persist last document');
  active = start(electron, [fixture], { CONSOLE_CANVAS_TEST_PHASE: 'reopen' });
  const reopened = await Promise.race([
    waitFor('reopen-ready.json'),
    active.done.then(() => {
      throw new Error('Desktop fixture exited before reopen');
    }),
  ]);
  await active.done;
  active = null;
  active = start(electron, ['tests/scoped-capture.cjs']);
  const nativeScopes = JSON.parse((await active.done).trim());
  active = null;
  const report = {
    nativeScopes,
    captureMode: offscreen
      ? 'real DOM / fixture screenshot / offscreen'
      : 'real DOM / display screenshot',
    manualInstalledAppUse: false,
    capture,
    reopened,
    officialSdkChecks: sdkReport.passed,
    modernSdkChecks: modernReport.passed,
    modernProtocol: modernReport.protocol,
    normalQuitAndRelaunch: true,
  };
  await fs.writeFile(
    path.join(root, offscreen ? 'dist/desktop-offscreen-checks.json' : 'dist/desktop-checks.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report));
} finally {
  checking = false;
  if (active) {
    if (active.output) console.error(active.output);
    active.child.kill('SIGTERM');
    await active.done.catch(() => {});
  }
  // Only stop the disposable broker owned by this fixture.
  try {
    const connection = JSON.parse(
      await fs.readFile(path.join(temporary, 'bridge/connection.json'), 'utf8'),
    );
    await fetch(connection.url + '/admin/stop', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + connection.token, 'Content-Type': 'application/json' },
      body: '{}',
    });
  } catch {}
  await fs.rm(temporary, { recursive: true, force: true });
}
