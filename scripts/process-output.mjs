import { spawn } from 'node:child_process';
// JSON protocols belong on stdout. Diagnostics remain visible on stderr and in errors.
export function startProcess(
  command,
  args,
  { cwd, env, onDiagnostic = (chunk) => process.stderr.write(chunk) } = {},
) {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '',
    diagnostics = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => {
    diagnostics += chunk;
    onDiagnostic(chunk);
  });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve(output)
        : reject(new Error(output + diagnostics || 'Process failed: ' + code)),
    );
  });
  done.catch(() => {});
  return {
    child,
    done,
    get output() {
      return output + diagnostics;
    },
  };
}
