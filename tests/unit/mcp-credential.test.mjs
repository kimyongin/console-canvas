import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('existing SDK connection recovers a rotated bridge credential without replaying delivery', async () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'))).version;
  const state = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-credential-'));
  let token = 'fixture-initial',
    delivered = 0,
    rejected = 0;
  const server = http.createServer(async (req, res) => {
    if (req.headers.authorization !== 'Bearer ' + token) {
      rejected++;
      res.writeHead(401).end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    if (req.url === '/health') {
      res.end(JSON.stringify({ service: 'console-canvas', version }));
    } else if (req.url === '/agent/call') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const params = JSON.parse(body);
      delivered++;
      res.end(JSON.stringify({ ok: true, operation_id: params.arguments?.operation_id }));
    } else res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const save = () =>
    fs.writeFile(
      path.join(state, 'connection.json'),
      JSON.stringify({ url: 'http://127.0.0.1:' + port, token }),
      { mode: 0o600 },
    );
  const client = new Client({ name: 'credential-regression', version: '1.0.0' });
  try {
    await save();
    await client.connect(
      new StdioClientTransport({
        command: '/usr/bin/python3',
        args: [path.join(root, 'mcp/server.py'), '--state-dir', state, '--port', String(port)],
        stderr: 'pipe',
      }),
    );
    await client.callTool({ name: 'get_agent_guide', arguments: {} });
    token = 'fixture-after-update';
    await save();
    const response = await client.callTool({
      name: 'update_ticket',
      arguments: { operation_id: 'unchanged-operation' },
    });
    assert.equal(response.isError, false);
    assert.equal(response.structuredContent.operation_id, 'unchanged-operation');
    assert.equal(rejected, 1);
    assert.equal(delivered, 2);
    await client.callTool({ name: 'get_agent_guide', arguments: {} });
    assert.equal(rejected, 1);
    assert.equal(delivered, 3);
    token = 'fixture-rejected-without-new-file';
    const denied = await client.callTool({ name: 'get_agent_guide', arguments: {} });
    assert.equal(denied.isError, true);
    assert.equal(denied.structuredContent.error.code, 'connection_authentication_failed');
    assert.equal(denied.structuredContent.error.http_status, 401);
    assert.equal(JSON.stringify(denied).includes(token), false);
    assert.equal(delivered, 3);
  } finally {
    await client.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(state, { recursive: true, force: true });
  }
});
