// Read-only installed-version audit. Does not start an agent turn or a user browser.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from '@modelcontextprotocol/sdk/types.js';
const root = path.resolve(import.meta.dirname, '../..');
const adapter =
  "import mcp.server as server; server.request=lambda *args,**kwargs:{'ok':True,'screens':[]}; server.stdio({'url':'http://127.0.0.1:1','token':'disposable-probe'})";
const meta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'console-canvas-audit', version: '1' },
};
const requests = [
  { id: 1, method: 'server/discover', params: { _meta: meta } },
  {
    id: 2,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'audit', version: '1' },
    },
  },
  {
    id: 3,
    method: 'subscriptions/listen',
    params: { _meta: meta, notifications: { resourcesListChanged: true } },
  },
];
const raw = spawnSync('python3', ['-c', adapter], {
  cwd: root,
  input: requests.map((r) => JSON.stringify({ jsonrpc: '2.0', ...r })).join('\n') + '\n',
  encoding: 'utf8',
  timeout: 10000,
});
if (raw.status !== 0) throw Error(raw.stderr);
const report = {
  checkedAt: new Date().toISOString(),
  normativeBaseline: '2026-07-28',
  sdk: {
    version: JSON.parse(
      await fs.readFile(path.join(root, 'node_modules/@modelcontextprotocol/sdk/package.json')),
    ).version,
    latest: LATEST_PROTOCOL_VERSION,
    supported: SUPPORTED_PROTOCOL_VERSIONS,
  },
  rawConsoleResponses: raw.stdout.trim().split('\n').map(JSON.parse),
  servers: [],
  limitations: [
    'No live Codex desktop host capability capture',
    'No model turn or user chat message',
    'This metadata-only probe is separate from verify_modern_mcp.mjs live SDK v2 tests',
    'Metadata-only Chrome MCP probe; no browser tool calls',
  ],
};
// Do not save adapter instructions or any pairing information in the report.
delete report.rawConsoleResponses[1]?.result?.instructions;
async function inspect(name, command, args, env) {
  const client = new Client({ name: 'console-canvas-readonly-audit', version: '1' });
  const transport = new StdioClientTransport({ command, args, cwd: root, env, stderr: 'pipe' });
  try {
    await client.connect(transport);
    report.servers.push({
      name,
      info: client.getServerVersion(),
      capabilities: client.getServerCapabilities(),
      tools: (await client.listTools()).tools.length,
    });
  } finally {
    await client.close();
  }
}
await inspect('console-canvas', 'python3', ['-c', adapter]);
const chromeBin = path.join(
  root,
  'local/webmcp-experiment/node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js',
);
await inspect(
  'chrome-devtools-mcp',
  process.execPath,
  [
    chromeBin,
    '--headless',
    '--isolated',
    '--categoryExtensions',
    '--categoryExperimentalWebmcp',
    '--no-usage-statistics',
    '--no-performance-crux',
  ],
  {
    ...process.env,
    CHROME_DEVTOOLS_MCP_NO_CONFIG_DISCOVERY: '1',
    CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1',
  },
);
const output = path.join(root, 'local/agent-trigger');
await fs.mkdir(output, { recursive: true });
await fs.writeFile(
  path.join(output, 'installed-report.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
