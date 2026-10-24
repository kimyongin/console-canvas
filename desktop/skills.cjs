const fs = require('node:fs/promises');
const path = require('node:path');
const quote = (value) => "'" + value.replace(/'/g, "'\\''") + "'";
function createSkillService({ root, archive, version, python, stateDir, port, userData, run }) {
  let sync = { updated: [], current: [], errors: [] };
  const command = [
    'codex',
    'mcp',
    'add',
    'console-canvas',
    '--',
    python,
    path.join(root, 'mcp/server.py'),
    '--state-dir',
    stateDir,
    '--port',
    String(port),
  ]
    .map(quote)
    .join(' ');
  async function invoke(args) {
    const result = await run(
      python,
      [path.join(root, 'mcp/skill_install.py'), '--archive', archive, ...args],
      { timeout: 15000, maxBuffer: 1024 * 1024 },
    );
    return JSON.parse(result.stdout);
  }
  async function syncInstalled() {
    try {
      sync = await invoke(['--sync-installed']);
    } catch (error) {
      sync.errors.push({ message: error.message });
    }
    try {
      await fs.mkdir(userData, { recursive: true });
      await fs.writeFile(
        path.join(userData, 'skill-sync-result.json'),
        JSON.stringify({ version, ...sync }),
        { mode: 0o600 },
      );
    } catch {}
    return sync;
  }
  async function info(install = false) {
    return {
      ...(await invoke(install ? [] : ['--status'])),
      version,
      mcp_command: command,
      auto_update: sync,
    };
  }
  return { syncInstalled, info, archive, command };
}
module.exports = { createSkillService };
