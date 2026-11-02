import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';

// Test control only. Capture commands execute in the extension's worker.
export function launchChrome(profile, { headed = false, args = [], logFile } = {}) {
  const child = spawn(
    process.env.CDP_PROBE_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      ...(headed ? [] : ['--headless=new']),
      '--remote-debugging-pipe',
      '--enable-unsafe-extension-debugging',
      '--user-data-dir=' + profile,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1440,1000',
      '--force-device-scale-factor=1',
      '--site-per-process',
      ...args,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] },
  );
  const pending = new Map();
  let sequence = 0,
    buffer = Buffer.alloc(0);
  child.stderr.on('data', (data) => {
    if (logFile) void fs.appendFile(logFile, data);
  });
  child.stdio[4].on('data', (data) => {
    buffer = Buffer.concat([buffer, data]);
    let end;
    while ((end = buffer.indexOf(0)) >= 0) {
      const raw = buffer.subarray(0, end).toString();
      buffer = buffer.subarray(end + 1);
      if (!raw) continue;
      const value = JSON.parse(raw),
        entry = pending.get(value.id);
      if (!entry) continue;
      pending.delete(value.id);
      clearTimeout(entry.timer);
      value.error ? entry.reject(Error(JSON.stringify(value.error))) : entry.resolve(value.result);
    }
  });
  const send = (method, params = {}, sessionId, timeout = 240000) =>
    new Promise((resolve, reject) => {
      const id = ++sequence,
        timer = setTimeout(() => {
          pending.delete(id);
          reject(Error('Chrome test timeout: ' + method));
        }, timeout);
      pending.set(id, { resolve, reject, timer });
      child.stdio[3].write(
        JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0',
      );
    });
  return {
    child,
    send,
    async stop() {
      const exited = new Promise((resolve) => {
        if (child.exitCode !== null) resolve();
        else child.once('exit', resolve);
      });
      await Promise.race([send('Browser.close', {}, undefined, 3000).catch(() => {}), exited]);
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1500))]);
      if (child.exitCode === null) child.kill('SIGTERM');
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(Error('Chrome test ended'));
      }
      pending.clear();
    },
  };
}
