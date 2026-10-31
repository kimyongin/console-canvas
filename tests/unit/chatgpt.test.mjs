import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { createChatgptProvider } from '../../chatgpt-provider.js';
const require = createRequire(import.meta.url);
const { createChatgptService } = require('../../desktop/chatgpt.cjs');
const { registerChatgptIpc } = require('../../desktop/chatgpt-ipc.cjs');
const { trustFrame } = require('../../desktop/security.cjs');
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture', alg: 'RS256', use: 'sig' };
const scope = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const issuer = 'https://auth.openai.com',
  resource = 'https://api.openai.com/v1';
const output = {
  name: 'Fixture layout',
  summary: 'Spacing',
  patches: [
    {
      type: 'style',
      element_id: 'n1',
      properties: [{ name: 'gap', value: '12px' }],
      text: null,
      attributes: null,
      html: null,
      parent_id: null,
      before_id: null,
      css: null,
    },
  ],
};
function stream(response) {
  return new Response('data: ' + JSON.stringify(response) + '\n\n');
}
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-oauth-'));
  const key = crypto.randomBytes(32);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString(text) {
      const iv = crypto.randomBytes(12),
        c = crypto.createCipheriv('aes-256-gcm', key, iv);
      return Buffer.concat([iv, c.update(text), c.final(), c.getAuthTag()]);
    },
    decryptString(value) {
      const d = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      d.setAuthTag(value.subarray(-16));
      return Buffer.concat([d.update(value.subarray(12, -16)), d.final()]).toString();
    },
  };
  const f = {
    directory,
    safeStorage,
    clock: Date.now(),
    url: null,
    claims: {},
    grantScope: scope,
    refreshes: 0,
    calls: [],
    client: 'oaiapp_fixture',
    mode: 'complete',
  };
  f.token = (client = f.client) => {
    const claims = {
      iss: issuer,
      aud: client,
      sub: 'fixture-user',
      email: 'fixture@example.test',
      exp: Math.floor(f.clock / 1000) + 3600,
      nonce: f.url?.searchParams.get('nonce'),
      ...f.claims,
    };
    const parts = [
      Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture' })).toString('base64url'),
      Buffer.from(JSON.stringify(claims)).toString('base64url'),
    ];
    return [
      ...parts,
      crypto.sign('RSA-SHA256', Buffer.from(parts.join('.')), privateKey).toString('base64url'),
    ].join('.');
  };
  f.fetchImpl = async (url, options = {}) => {
    f.calls.push({ url, options });
    assert.equal(options.redirect, 'error');
    if (url.endsWith('openid-configuration'))
      return Response.json({
        issuer,
        authorization_endpoint: issuer + '/api/accounts/authorize',
        token_endpoint: issuer + '/api/accounts/oauth/token',
        jwks_uri: issuer + '/.well-known/jwks.json',
        revocation_endpoint: issuer + '/oauth/revoke',
      });
    if (url.endsWith('jwks.json')) return Response.json({ keys: [jwk] });
    if (url.endsWith('/oauth/token')) {
      const body = new URLSearchParams(options.body);
      assert.notEqual(body.get('client_id'), 'dynamic_agent_client');
      if (body.get('grant_type') === 'refresh_token') {
        f.refreshes++;
        if (f.refreshError)
          return Response.json(
            { error: f.refreshError },
            { status: f.refreshError === 'invalid_grant' ? 400 : 503 },
          );
        await new Promise((r) => setTimeout(r, 10));
        return Response.json({
          access_token: 'rotated-secret',
          refresh_token: 'rotated-renewable',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: f.grantScope,
        });
      }
      assert.equal(body.get('redirect_uri'), f.url.searchParams.get('redirect_uri'));
      assert.equal(
        crypto.createHash('sha256').update(body.get('code_verifier')).digest('base64url'),
        f.url.searchParams.get('code_challenge'),
      );
      return Response.json({
        access_token: f.accessToken || 'fixture-secret',
        refresh_token: 'fixture-renewable',
        id_token: f.token(body.get('client_id')),
        token_type: 'Bearer',
        expires_in: 3600,
        scope: f.grantScope,
      });
    }
    if (url.endsWith('/oauth/revoke'))
      return new Response('', { status: f.revokeError ? 503 : 200 });
    if (url === resource + '/models')
      return Response.json({
        models: [
          { slug: 'allowed', display_name: 'Allowed model', visibility: 'list' },
          { slug: 'hidden', display_name: 'Hidden', visibility: 'hidden' },
        ],
      });
    if (url === resource + '/responses') {
      assert.ok(
        [f.accessToken || 'fixture-secret', 'rotated-secret'].some(
          (token) => options.headers.Authorization === 'Bearer ' + token,
        ),
      );
      const body = JSON.parse(options.body);
      assert.equal(body.store, false);
      assert.equal(body.stream, true);
      assert.equal(body.model, 'allowed');
      assert.ok(!JSON.stringify(body).includes('fixture-secret'));
      if (f.mode === 'wait')
        return new Promise((resolve, reject) =>
          options.signal.addEventListener('abort', () =>
            reject(new DOMException('Canceled', 'AbortError')),
          ),
        );
      if (f.mode === 'limit')
        return stream({
          type: 'response.failed',
          response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } },
        });
      return stream({
        type: 'response.completed',
        response: {
          status: 'completed',
          output: [{ content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
          usage: { input_tokens: 1, output_tokens: 2 },
        },
      });
    }
    throw Error('Unexpected test destination');
  };
  f.service = createChatgptService({
    directory,
    safeStorage,
    openExternal: async (url) => {
      f.url = new URL(url);
    },
    fetchImpl: f.fetchImpl,
    now: () => f.clock,
  });
  f.callback = async (extra = {}) => {
    const u = new URL(f.url.searchParams.get('redirect_uri'));
    for (const [k, v] of Object.entries({
      state: f.url.searchParams.get('state'),
      code: 'fixture-code',
      client_id: f.client,
      ...extra,
    })) {
      if (v === null) u.searchParams.delete(k);
      else u.searchParams.set(k, v);
    }
    return fetch(u);
  };
  f.login = async () => {
    await f.service.login();
    assert.equal((await f.callback()).status, 200);
    return f.service.status();
  };
  f.read = async () =>
    JSON.parse(
      safeStorage.decryptString(await fs.readFile(path.join(directory, 'chatgpt-accounts.enc'))),
    );
  t.after(async () => {
    f.service.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return f;
}
test('Official dynamic registration uses private loopback, PKCE, nonce, issued ID and protected restartable storage', async (t) => {
  const f = await fixture(t);
  await f.service.login();
  assert.equal(f.url.origin, issuer);
  assert.equal(f.url.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(f.url.searchParams.get('agent_name_hint'), 'Console Canvas');
  assert.match(
    f.url.searchParams.get('redirect_uri'),
    /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/,
  );
  const host = f.url.searchParams.get('ext_agent_host_id');
  assert.equal((await f.callback({ state: 'wrong' })).status, 400);
  assert.equal((await f.service.status()).pending, true);
  assert.equal((await f.callback()).status, 200);
  const status = await f.service.status();
  assert.equal(status.accounts[0].planEnabled, true);
  assert.ok(!JSON.stringify(status).includes('fixture-secret'));
  const raw = await fs.readFile(path.join(f.directory, 'chatgpt-accounts.enc'));
  assert.ok(!raw.includes('fixture-secret'));
  assert.equal((await fs.stat(path.join(f.directory, 'chatgpt-accounts.enc'))).mode & 0o777, 0o600);
  const reopened = createChatgptService({
    directory: f.directory,
    safeStorage: f.safeStorage,
    openExternal: async (url) => {
      f.url = new URL(url);
    },
    fetchImpl: f.fetchImpl,
    now: () => f.clock,
  });
  t.after(() => reopened.close());
  assert.equal((await reopened.status()).activeId, status.activeId);
  await reopened.login(status.activeId);
  assert.equal(f.url.searchParams.get('client_id'), f.client);
  assert.equal(f.url.searchParams.get('agent_name_hint'), null);
  assert.equal(f.url.searchParams.get('ext_agent_host_id'), host);
  reopened.cancelLogin();
});
for (const [name, claims] of Object.entries({
  issuer: { iss: 'https://evil.test' },
  audience: { aud: 'other' },
  nonce: { nonce: 'other' },
  expiry: { exp: 1 },
  identity: { sub: '' },
}))
  test('Reject invalid signed ' + name + ' without replacing account', async (t) => {
    const f = await fixture(t);
    await f.login();
    const old = (await f.service.status()).activeId;
    f.claims = claims;
    await f.service.login();
    assert.equal((await f.callback()).status, 400);
    assert.equal((await f.service.status()).activeId, old);
    assert.equal((await f.service.status()).accounts.length, 1);
  });
test('Missing granted plan scope preserves login and blocks inference; registration and returning identities stay separate', async (t) => {
  const f = await fixture(t);
  f.grantScope = 'openid email';
  const s = await f.login();
  assert.equal(s.accounts[0].loggedIn, true);
  assert.equal(s.accounts[0].planEnabled, false);
  await assert.rejects(f.service.models(), { code: 'permission_required' });
  await f.service.login(s.activeId);
  assert.equal(f.url.searchParams.get('prompt'), 'consent');
  f.claims = { sub: 'another' };
  assert.equal((await f.callback()).status, 400);
  assert.equal((await f.service.status()).activeId, s.activeId);
});
test('Refresh serializes rotating tokens, preserves transient failures, and clears only unusable credentials', async (t) => {
  const f = await fixture(t);
  await f.login();
  f.clock += 3590000;
  await Promise.all([f.service.models(), f.service.models()]);
  assert.equal(f.refreshes, 1);
  assert.equal((await f.read()).accounts[0].refresh_token, 'rotated-renewable');
  f.clock += 3590000;
  f.refreshError = 'server_error';
  await assert.rejects(f.service.models());
  assert.equal((await f.service.status()).accounts[0].loggedIn, true);
  f.refreshError = 'invalid_grant';
  await assert.rejects(f.service.models(), { code: 'signin_required' });
  const r = (await f.read()).accounts[0];
  assert.equal(r.access_token, undefined);
  assert.equal(r.refresh_token, undefined);
  assert.equal(r.client_id, f.client);
});
test('Available model catalog and completed SSE produce common patches without tokens; in-stream plan limits stop', async (t) => {
  const f = await fixture(t);
  await f.login();
  assert.deepEqual(await f.service.models(), [{ id: 'allowed', name: 'Allowed model' }]);
  const args = {
    request: { id: 'request', prompt: 'Improve', count: 1, baseline: { selection: ['n1'] } },
    context: { html: '<div></div>' },
    model: 'allowed',
    accountId: (await f.service.status()).activeId,
  };
  await assert.rejects(f.service.generate({ ...args, model: 'hidden' }), {
    code: 'model_unavailable',
  });
  const calls = f.calls.filter((c) => c.url.endsWith('/responses')).length;
  await assert.rejects(f.service.generate({ ...args, context: { html: 'x'.repeat(2_000_001) } }), {
    code: 'input_too_large',
  });
  await assert.rejects(
    f.service.generate({ ...args, context: { image_url: 'x'.repeat(20_000_101) } }),
    { code: 'input_image_too_large' },
  );
  assert.equal(
    f.calls.filter((c) => c.url.endsWith('/responses')).length,
    calls,
    'Local input rejection must not consume inference',
  );
  const result = await f.service.generate(args);
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0].patches[0].properties, { gap: '12px' });
  assert.ok(!JSON.stringify(result).includes('fixture-secret'));
  f.mode = 'limit';
  const limited = await f.service.generate(args);
  assert.equal(limited.candidates.length, 0);
  assert.equal(limited.failures[0].code, 'subscription_sharing_usage_limit_exceeded');
  assert.equal((await f.service.status()).accounts[0].loggedIn, true);
});
test('OAuth bearer tokens longer than API keys reach inference without crossing IPC results', async (t) => {
  const f = await fixture(t);
  f.accessToken = 'fixture-oauth-' + 'x'.repeat(3000);
  await f.login();
  await f.service.models();
  const result = await f.service.generate({
    request: { id: 'long-token', prompt: 'Improve', count: 1, baseline: { selection: ['n1'] } },
    context: { html: '<button data-uic-id="n1">Create</button>' },
    model: 'allowed',
    accountId: (await f.service.status()).activeId,
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.failures.length, 0);
  assert.ok(f.calls.some((call) => call.url.endsWith('/responses')));
  assert.ok(!JSON.stringify(result).includes(f.accessToken));
});
test('A later local input rejection preserves prior candidate usage and stops retries', async () => {
  let calls = 0;
  const provider = createChatgptProvider({
    generate: async ({ request }) =>
      ++calls === 1
        ? {
            ok: true,
            value: {
              candidates: [
                { request_id: request.id, name: 'First', summary: 'Complete', patches: [] },
              ],
              usage: [{ name: 'First', input_tokens: 40, output_tokens: 10 }],
              failures: [],
              canceled: false,
            },
          }
        : { ok: false, error: { code: 'input_too_large', message: 'Input too large' } },
  });
  provider.setModel('allowed', 'qa');
  const registered = [];
  const result = await provider.generate({
    request: { id: 'partial', prompt: 'Improve', count: 3, baseline: { selection: ['n1'] } },
    context: {},
    register: async (c) => registered.push(c),
  });
  assert.equal(calls, 2);
  assert.equal(registered.length, 1);
  assert.equal(result.usage[0].input_tokens, 40);
  assert.equal(result.model, 'allowed');
  assert.equal(result.failures[0].code, 'input_too_large');
});
test('Cancel before credential loading and during streaming prevents late candidates; logout retains registration', async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.service.models();
  const args = {
    request: { id: 'request', prompt: 'Improve', count: 1, baseline: { selection: ['n1'] } },
    context: {},
    model: 'allowed',
    accountId: (await f.service.status()).activeId,
  };
  f.mode = 'wait';
  const p = f.service.generate(args);
  await new Promise((r) => setImmediate(r));
  f.service.cancel('request');
  const result = await p;
  assert.equal(result.canceled, true);
  assert.equal(result.candidates.length, 0);
  f.revokeError = true;
  const status = await f.service.logout((await f.service.status()).activeId);
  assert.equal(status.accounts[0].loggedIn, false);
  assert.match(status.message, /원격 철회/);
  assert.equal((await f.read()).accounts[0].id_token, undefined);
});
test('Duplicate login, denied consent, incomplete registration and cancel never activate a registration', async (t) => {
  const f = await fixture(t);
  const p = f.service.login();
  await assert.rejects(f.service.login(), { code: 'login_pending' });
  await p;
  assert.equal((await f.callback({ error: 'access_denied' })).status, 400);
  assert.equal((await f.service.status()).accounts.length, 0);
  await f.service.login();
  assert.equal((await f.callback({ client_id: null })).status, 400);
  await f.service.login();
  f.service.cancelLogin();
  assert.equal((await f.service.status()).pending, false);
});
test('IPC authorizes only exact editor main frame and never exports provider secrets', async () => {
  const handlers = new Map(),
    mainFrame = {},
    editor = { mainFrame },
    service = { status: async () => ({ accounts: [] }) };
  registerChatgptIpc({
    ipcMain: { handle: (name, cb) => handlers.set(name, cb) },
    service,
    trust: (event) => trustFrame(event, editor),
    openUsage: async () => {},
  });
  const call = handlers.get('canvas:chatgpt-status');
  assert.equal(handlers.size, 9);
  assert.deepEqual(await call({ sender: editor, senderFrame: mainFrame }), {
    ok: true,
    value: { accounts: [] },
  });
  await assert.rejects(call({ sender: editor, senderFrame: {} }));
  await assert.rejects(call({ sender: {}, senderFrame: mainFrame }));
});
test('Renderer broker preserves completed alternatives on cancellation and uses selected account model', async () => {
  const calls = [],
    registered = [];
  let provider;
  provider = createChatgptProvider({
    generate: async (value) => {
      calls.push(value);
      return {
        ok: true,
        value: {
          candidates: [{ name: 'One', patches: [] }],
          usage: [],
          failures: [],
          canceled: false,
        },
      };
    },
    cancel: async () => ({ ok: true }),
  });
  provider.setModel('selected');
  const result = await provider.generate({
    request: { id: 'request', prompt: 'Improve', count: 3, baseline: { selection: ['n1'] } },
    context: { html: 'safe' },
    register: async (candidate) => {
      registered.push(candidate);
      provider.cancel('request');
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(registered.length, 1);
  assert.equal(result.canceled, true);
  assert.equal(calls[0].model, 'selected');
});

test('Local candidate rejection preserves consumed usage and a safe reason without retrying inference', async () => {
  let calls = 0;
  const provider = createChatgptProvider({
    generate: async () => {
      calls++;
      return {
        ok: true,
        value: {
          candidates: [{ name: 'One', patches: [] }],
          usage: [{ name: 'One', input_tokens: 50, output_tokens: 25 }],
          failures: [],
          canceled: false,
        },
      };
    },
  });
  provider.setModel('selected', 'account');
  const result = await provider.generate({
    request: { id: 'reject', prompt: 'Improve', count: 3, baseline: { selection: ['n1'] } },
    context: {},
    register: async () => {
      throw Object.assign(new Error('Do not serialize raw input'), {
        code: 'invalid_css_property',
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.usage[0].input_tokens, 50);
  assert.equal(result.failures[0].code, 'invalid_css_property');
  assert.equal(result.model, 'selected');
  assert.ok(!JSON.stringify(result).includes('Do not serialize'));
});
test('Two app instances serialize renewal and observe external logout without mixing accounts', async (t) => {
  const f = await fixture(t);
  const first = await f.login();
  const second = createChatgptService({
    directory: f.directory,
    safeStorage: f.safeStorage,
    openExternal: async () => {},
    fetchImpl: f.fetchImpl,
    now: () => f.clock,
  });
  t.after(() => second.close());
  await second.status();
  f.clock += 3590000;
  await Promise.all([f.service.models(), second.models()]);
  assert.equal(f.refreshes, 1);
  await second.logout(first.activeId);
  assert.equal((await f.service.status()).accounts[0].loggedIn, false);
});
test('Streaming cancellation aborts native HTTP and corrupted signatures never create credentials', async (t) => {
  const f = await fixture(t);
  await f.service.login();
  const good = f.token;
  f.token = (...args) => {
    const p = good(...args).split('.');
    p[2] = Buffer.alloc(256).toString('base64url');
    return p.join('.');
  };
  assert.equal((await f.callback()).status, 400);
  assert.equal((await f.service.status()).accounts.length, 0);
  f.token = good;
  await f.login();
  await f.service.models();
  f.mode = 'wait';
  const promise = f.service.generate({
    request: { id: 'streaming', prompt: 'Test', count: 1, baseline: { selection: ['n1'] } },
    context: {},
    model: 'allowed',
    accountId: (await f.service.status()).activeId,
  });
  while (!f.calls.some((c) => c.url === resource + '/responses'))
    await new Promise((r) => setTimeout(r, 1));
  f.service.cancel('streaming');
  const result = await promise;
  assert.equal(result.canceled, true);
  assert.equal(result.candidates.length, 0);
});
test('Unavailable secure storage never falls back to plain credential files', async (t) => {
  const f = await fixture(t);
  f.safeStorage.isEncryptionAvailable = () => false;
  assert.equal((await f.service.status()).available, false);
  await assert.rejects(f.service.login(), { code: 'storage_unavailable' });
  assert.equal(f.url, null);
});

test('A request bound to another registration is rejected before inference', async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.service.models();
  await assert.rejects(
    f.service.generate({
      request: { id: 'request', prompt: 'Test', count: 1, baseline: { selection: ['n1'] } },
      context: {},
      model: 'allowed',
      accountId: 'old-account',
    }),
    { code: 'account_changed' },
  );
  assert.ok(!f.calls.some((c) => c.url === resource + '/responses'));
});

test('Status polling during token rotation cannot overwrite the renewed session', async (t) => {
  const f = await fixture(t);
  await f.login();
  f.clock += 3590000;
  const renewal = f.service.models();
  while (!f.refreshes) await new Promise((r) => setTimeout(r, 1));
  await f.service.status();
  await renewal;
  assert.equal((await f.read()).accounts[0].refresh_token, 'rotated-renewable');
});

test('OAuth alternatives carry their ordinal, total and previous directions to the model', async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.service.models();
  await f.service.generate({
    request: { id: 'ordinal', prompt: 'Improve', count: 1, baseline: { selection: ['n1'] } },
    accountId: (await f.service.status()).activeId,
    context: {},
    model: 'allowed',
    variantIndex: 2,
    variantTotal: 3,
    previousDirections: ['Compact layout'],
  });
  const sent = JSON.parse(
    JSON.parse(f.calls.find((c) => c.url === resource + '/responses').options.body).input[0]
      .content[0].text,
  );
  assert.equal(sent.variant_number, 3);
  assert.equal(sent.variant_total, 3);
  assert.deepEqual(sent.previous_directions, ['Compact layout']);
});

test('OS availability alone cannot enable OAuth when actual encryption fails', async () => {
  const { createChatgptStorage } = require('../../desktop/chatgpt.cjs');
  const bad = await createChatgptStorage({
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptStringAsync: async () => {
      throw Error('OS crypto unavailable');
    },
  });
  assert.equal(bad.isEncryptionAvailable(), false);
  const fake = await createChatgptStorage({
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptStringAsync: async () => Buffer.from('opaque'),
    decryptStringAsync: async () => ({ result: 'Console Canvas protected-storage probe' }),
  });
  assert.equal(fake.isEncryptionAvailable(), true);
});

test('App startup does not touch protected storage; concurrent account operations initialize once', async (t) => {
  const { createChatgptStorage } = require('../../desktop/chatgpt.cjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-lazy-storage-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let probes = 0,
    release;
  const permission = new Promise((resolve) => (release = resolve));
  const storage = await createChatgptStorage(
    {
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async () => {
        probes++;
        await permission;
        return Buffer.from('opaque');
      },
      decryptStringAsync: async () => ({ result: 'Console Canvas protected-storage probe' }),
    },
    { lazy: true },
  );
  const service = createChatgptService({ directory, safeStorage: storage });
  t.after(() => service.close());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(probes, 0, 'Startup and service construction must not open Keychain');
  const first = service.status(),
    second = service.status();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(probes, 1);
  release();
  assert.equal((await first).available, true);
  assert.equal((await second).available, true);
  assert.equal(probes, 1);
});

test('Denied account access can retry without restarting or replacing the encrypted file', async (t) => {
  const f = await fixture(t);
  await f.login();
  const file = path.join(f.directory, 'chatgpt-accounts.enc');
  const before = await fs.readFile(file);
  let allow = false,
    reads = 0;
  const service = createChatgptService({
    directory: f.directory,
    safeStorage: {
      ...f.safeStorage,
      decryptString(value) {
        reads++;
        if (!allow) throw Error('Denied');
        return f.safeStorage.decryptString(value);
      },
    },
  });
  t.after(() => service.close());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reads, 0);
  await assert.rejects(service.status(), { code: 'storage_unavailable' });
  assert.deepEqual(await fs.readFile(file), before);
  allow = true;
  const status = await service.status();
  assert.equal(status.accounts.length, 1);
  assert.equal(status.accounts[0].loggedIn, true);
  assert.deepEqual(await fs.readFile(file), before);
});
