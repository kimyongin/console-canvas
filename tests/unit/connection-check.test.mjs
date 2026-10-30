import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { checkChatgptConnection } = require('../../desktop/connection-check.cjs');

test('Native connection diagnostic completes protected account read and model fetch without identity/secrets', async () => {
  const calls = [];
  const result = await checkChatgptConnection(
    {
      async status() {
        calls.push('status');
        return {
          available: true,
          activeId: 'private-account',
          accounts: [
            {
              id: 'private-account',
              label: 'private@example.test',
              loggedIn: true,
              planEnabled: true,
            },
          ],
          access_token: 'secret',
        };
      },
      async models() {
        calls.push('models');
        return [{ id: 'account-specific-model' }];
      },
    },
    'fixture',
  );
  assert.deepEqual(calls, ['status', 'models']);
  assert.deepEqual(result, {
    kind: 'chatgpt-connection-check',
    version: 'fixture',
    ok: true,
    protectedStorage: true,
    accountCount: 1,
    modelCount: 1,
  });
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.ok(!JSON.stringify(result).includes('secret'));
});

test('Unavailable storage does not call models or modify account state', async () => {
  const result = await checkChatgptConnection(
    {
      async status() {
        return { available: false, accounts: [] };
      },
      async models() {
        throw Error('Must not call models');
      },
    },
    'fixture',
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'storage_unavailable');
});

test('Missing consent never becomes an inferred successful connection', async () => {
  for (const accounts of [[], [{ id: 'one', loggedIn: true, planEnabled: false }]]) {
    const result = await checkChatgptConnection(
      {
        async status() {
          return { available: true, activeId: 'one', accounts };
        },
        async models() {
          throw Error('No inference consent');
        },
      },
      'fixture',
    );
    assert.equal(result.ok, false);
    assert.equal(result.code, accounts.length ? 'consent_required' : 'signin_required');
  }
});

test('Native diagnostic emits only allowlisted error codes, never raw provider errors', async () => {
  for (const code of ['storage_unavailable', 'secret-from-provider']) {
    const result = await checkChatgptConnection(
      {
        async status() {
          throw Object.assign(Error('private response'), { code });
        },
      },
      'fixture',
    );
    assert.equal(result.code, code === 'storage_unavailable' ? code : 'connection_failed');
    assert.ok(!JSON.stringify(result).includes('private'));
    assert.ok(!JSON.stringify(result).includes('secret'));
  }
});
