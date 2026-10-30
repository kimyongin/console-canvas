// Public local-client SIWC flow. Credentials never cross the editor IPC boundary.
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const terminalRefresh = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
]);
function fail(code, message) {
  return Object.assign(new Error(message), { code });
}
function authEndpoint(value) {
  const url = new URL(value);
  if (url.origin !== ISSUER || url.username || url.password || url.hash)
    throw fail('discovery_invalid', '공식 인증 주소를 확인할 수 없습니다.');
  return url.href;
}
function createChatgptService({
  directory,
  safeStorage,
  openExternal,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  loginTimeout = 300000,
}) {
  const filename = path.join(directory, 'chatgpt-accounts.enc');
  let data = { host: 'urn:uuid:' + crypto.randomUUID(), active: '', accounts: [] },
    pending = null,
    message = '',
    queue = Promise.resolve();
  const catalogs = new Map(),
    jobs = new Map();
  let starting = false,
    loginEpoch = 0;
  const encrypted = () =>
    safeStorage.isEncryptionAvailable() &&
    safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
  async function load() {
    try {
      const raw = await fs.readFile(filename);
      if (!encrypted())
        throw fail('storage_unavailable', '안전한 계정 저장소를 사용할 수 없습니다.');
      const parsed = JSON.parse(await safeStorage.decryptString(raw));
      if (!/^urn:uuid:[\da-f-]{36}$/i.test(parsed.host) || !Array.isArray(parsed.accounts))
        throw Error();
      data = parsed;
    } catch (e) {
      if (e.code !== 'ENOENT')
        throw fail('storage_unavailable', '저장된 ChatGPT 계정을 안전하게 읽을 수 없습니다.');
    }
  }
  const ready = load();
  ready.catch(() => {});
  async function save() {
    if (!encrypted()) throw fail('storage_unavailable', '안전한 계정 저장소를 사용할 수 없습니다.');
    const tmp = filename + '.' + crypto.randomUUID();
    try {
      await fs.writeFile(tmp, await safeStorage.encryptString(JSON.stringify(data)), {
        mode: 0o600,
      });
      await fs.rename(tmp, filename);
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }
  function locked(task) {
    const run = queue
      .catch(() => {})
      .then(async () => {
        await ready;
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        let lock;
        for (let i = 0; i < 100; i++) {
          try {
            lock = await fs.open(filename + '.lock', 'wx', 0o600);
            break;
          } catch (e) {
            if (e.code !== 'EEXIST') throw e;
            await new Promise((r) => setTimeout(r, 50));
          }
        }
        if (!lock) throw fail('account_busy', '계정을 갱신 중입니다. 잠시 후 다시 시도하세요.');
        try {
          await load();
          return await task();
        } finally {
          await lock.close();
          await fs.rm(filename + '.lock', { force: true });
        }
      });
    queue = run;
    return run;
  }
  async function json(url, options = {}) {
    const response = await fetchImpl(url, {
      ...options,
      redirect: 'error',
      signal: options.signal || AbortSignal.timeout(15000),
    });
    const text = await response.text();
    if (text.length > 1000000) throw fail('response_too_large', '인증 응답이 너무 큽니다.');
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = {};
    }
    if (!response.ok)
      throw fail(
        typeof body.error === 'string' ? body.error : 'http_' + response.status,
        'ChatGPT 연결을 확인해 주세요. (' + response.status + ')',
      );
    return body;
  }
  async function discovery() {
    const value = await json(ISSUER + '/.well-known/openid-configuration');
    if (value.issuer !== ISSUER)
      throw fail('discovery_invalid', '인증 발급자가 올바르지 않습니다.');
    for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'])
      authEndpoint(value[k]);
    if (value.revocation_endpoint) authEndpoint(value.revocation_endpoint);
    return value;
  }
  async function identity(token, client, nonce, endpoints) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) throw Error();
      const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
      if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw Error();
      const { keys } = await json(endpoints.jwks_uri);
      const jwk = keys.find(
        (k) =>
          k.kid === header.kid &&
          k.kty === 'RSA' &&
          (!k.use || k.use === 'sig') &&
          (!k.alg || k.alg === 'RS256'),
      );
      if (
        !jwk ||
        !crypto.verify(
          'RSA-SHA256',
          Buffer.from(parts[0] + '.' + parts[1]),
          crypto.createPublicKey({ key: jwk, format: 'jwk' }),
          Buffer.from(parts[2], 'base64url'),
        )
      )
        throw Error();
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
      if (
        claims.iss !== ISSUER ||
        !(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(client) ||
        (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== client) ||
        !Number.isFinite(claims.exp) ||
        claims.exp * 1000 <= now() ||
        (claims.nbf && claims.nbf * 1000 > now() + 30000) ||
        (nonce && claims.nonce !== nonce) ||
        typeof claims.sub !== 'string' ||
        !claims.sub
      )
        throw Error();
      return claims;
    } catch {
      throw fail('identity_invalid', '로그인 응답의 서명 또는 계정 정보를 검증하지 못했습니다.');
    }
  }
  function tokens(value, previous = {}) {
    if (
      typeof value.access_token !== 'string' ||
      !value.access_token ||
      value.token_type?.toLowerCase() !== 'bearer' ||
      !Number.isFinite(value.expires_in) ||
      value.expires_in <= 0
    )
      throw fail('token_invalid', '로그인 토큰 응답이 올바르지 않습니다.');
    return {
      ...previous,
      access_token: value.access_token,
      refresh_token: value.refresh_token || previous.refresh_token,
      id_token: value.id_token || previous.id_token,
      scopes: typeof value.scope === 'string' ? value.scope.split(/\s+/) : previous.scopes || [],
      expires: now() + value.expires_in * 1000,
    };
  }
  function view() {
    return {
      available: !!encrypted(),
      activeId: data.active,
      pending: !!pending || starting,
      message,
      accounts: data.accounts.map((a) => ({
        id: a.id,
        label: (a.email || 'ChatGPT 계정') + ' · ' + a.id.slice(-6),
        loggedIn: !!a.access_token,
        planEnabled: !!a.scopes?.includes('chatgpt.tokens.use.direct'),
      })),
    };
  }
  async function status() {
    return locked(async () => view());
  }
  function cancelLogin() {
    loginEpoch++;
    if (pending) {
      pending.canceled = true;
      clearTimeout(pending.timer);
      pending.server.close();
      pending = null;
    }
  }
  async function login(id = '') {
    if (jobs.size) throw fail('generation_busy', '생성을 취소한 뒤 계정을 바꾸세요.');
    if (pending || starting)
      throw fail('login_pending', '이미 로그인 중입니다. 브라우저에서 완료하거나 취소하세요.');
    starting = true;
    const epoch = ++loginEpoch;
    try {
      await locked(save);
      const account = id ? data.accounts.find((a) => a.id === id) : null;
      if (id && !account) throw fail('account_missing', '계정을 다시 선택해 주세요.');
      const endpoints = await discovery(),
        attempt = {
          state: crypto.randomBytes(32).toString('base64url'),
          nonce: crypto.randomBytes(32).toString('base64url'),
          verifier: crypto.randomBytes(48).toString('base64url'),
          account,
          canceled: false,
          exchanging: false,
        };
      const server = http.createServer(async (req, res) => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
        const url = new URL(req.url, 'http://127.0.0.1');
        if (req.method !== 'GET' || url.pathname !== '/auth/callback') {
          res.writeHead(404).end();
          return;
        }
        if (
          pending !== attempt ||
          attempt.exchanging ||
          url.searchParams.getAll('state').length !== 1 ||
          url.searchParams.get('state') !== attempt.state
        ) {
          res.writeHead(400).end('Invalid authorization attempt.');
          return;
        }
        attempt.exchanging = true;
        try {
          if (url.searchParams.has('error'))
            throw fail('consent_declined', '로그인이 취소되었거나 동의하지 않았습니다.');
          const client = url.searchParams.get('client_id') || account?.client_id;
          if (
            !client ||
            !/^[\w-]{1,256}$/.test(client) ||
            client === 'dynamic_agent_client' ||
            (account && client !== account.client_id) ||
            !url.searchParams.get('code')
          )
            throw fail(
              'registration_incomplete',
              '앱 등록을 완료하지 못했습니다. 다시 로그인하세요.',
            );
          const value = await json(endpoints.token_endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              client_id: client,
              code: url.searchParams.get('code'),
              code_verifier: attempt.verifier,
              redirect_uri: attempt.redirect,
              resource: RESOURCE,
            }),
          });
          const claims = await identity(value.id_token, client, attempt.nonce, endpoints);
          if (account && claims.sub !== account.subject)
            throw fail(
              'identity_mismatch',
              '선택한 계정과 다른 로그인입니다. 계정 추가로 다시 시도하세요.',
            );
          if (attempt.canceled) throw fail('login_canceled', '로그인이 취소되었습니다.');
          await locked(async () => {
            if (attempt.canceled) throw fail('login_canceled', '로그인이 취소되었습니다.');
            const id = crypto
              .createHash('sha256')
              .update(ISSUER + '|' + client + '|' + claims.sub)
              .digest('hex')
              .slice(0, 24);
            const record = {
              ...tokens(value),
              id,
              client_id: client,
              subject: claims.sub,
              email: typeof claims.email === 'string' ? claims.email : '',
              issuer: ISSUER,
            };
            const i = data.accounts.findIndex((a) => a.id === id);
            if (i < 0) data.accounts.push(record);
            else data.accounts[i] = record;
            data.active = id;
            await save();
            catalogs.clear();
            message = record.scopes.includes('chatgpt.tokens.use.direct')
              ? 'ChatGPT 로그인 완료 · 모델과 실제 생성 권한은 별도로 확인합니다.'
              : '로그인 완료 · ChatGPT 요금제 사용 동의가 필요합니다.';
          });
          res.end('Console Canvas에 로그인했습니다. 앱으로 돌아가세요.');
        } catch (e) {
          message =
            e.code === 'identity_invalid' ||
            e.code === 'identity_mismatch' ||
            e.code === 'consent_declined'
              ? e.message
              : '로그인을 완료하지 못했습니다. 다시 시도하세요.';
          res.writeHead(400).end(message);
        } finally {
          if (pending === attempt) {
            clearTimeout(attempt.timer);
            pending = null;
            server.close();
          }
        }
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      if (epoch !== loginEpoch) {
        server.close();
        throw fail('login_canceled', '로그인이 취소되었습니다.');
      }
      attempt.server = server;
      attempt.redirect = 'http://127.0.0.1:' + server.address().port + '/auth/callback';
      pending = attempt;
      attempt.timer = setTimeout(() => {
        if (pending === attempt) {
          cancelLogin();
          message = '로그인 시간이 만료되었습니다. 다시 시도하세요.';
        }
      }, loginTimeout);
      attempt.timer.unref?.();
      const url = new URL(endpoints.authorization_endpoint);
      const params = {
        client_id: account?.client_id || 'dynamic_agent_client',
        ext_agent_host_id: data.host,
        response_type: 'code',
        redirect_uri: attempt.redirect,
        scope: SCOPES,
        resource: RESOURCE,
        state: attempt.state,
        nonce: attempt.nonce,
        code_challenge_method: 'S256',
        code_challenge: crypto.createHash('sha256').update(attempt.verifier).digest('base64url'),
      };
      if (!account) params.agent_name_hint = 'Console Canvas';
      if (account?.id_token) params.id_token_hint = account.id_token;
      if (account?.email) params.login_hint = account.email;
      if (account && !account.scopes?.includes('chatgpt.tokens.use.direct'))
        params.prompt = 'consent';
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      try {
        await openExternal(url.href);
      } catch {
        cancelLogin();
        throw fail('browser_failed', '로그인 브라우저를 열지 못했습니다.');
      }
      message = '브라우저에서 ChatGPT 로그인과 앱 사용 동의를 완료하세요.';
      starting = false;
      return view();
    } finally {
      starting = false;
    }
  }
  async function credential(id) {
    return locked(async () => {
      const record = data.accounts.find((a) => a.id === id);
      if (!record?.access_token) throw fail('signin_required', 'ChatGPT에 로그인해 주세요.');
      if (!record.scopes?.includes('chatgpt.tokens.use.direct'))
        throw fail('permission_required', 'ChatGPT 요금제 사용 동의가 필요합니다.');
      if (record.expires < now() + 60000) {
        if (!record.refresh_token) throw fail('signin_required', '다시 로그인해 주세요.');
        const endpoints = await discovery();
        try {
          const value = await json(endpoints.token_endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              client_id: record.client_id,
              refresh_token: record.refresh_token,
              resource: RESOURCE,
            }),
          });
          if (value.id_token) {
            const claims = await identity(value.id_token, record.client_id, null, endpoints);
            if (claims.sub !== record.subject)
              throw fail('identity_mismatch', '계정 갱신을 검증하지 못했습니다.');
          }
          const next = tokens(value, record);
          Object.assign(record, next);
          await save();
        } catch (e) {
          if (terminalRefresh.has(e.code)) {
            delete record.access_token;
            delete record.refresh_token;
            delete record.id_token;
            await save();
            throw fail('signin_required', '로그인이 만료되었습니다. 다시 로그인하세요.');
          }
          throw e;
        }
      }
      return { ...record };
    });
  }
  async function models() {
    await ready;
    const id = data.active,
      record = await credential(id);
    const body = await json(RESOURCE + '/models', {
      headers: { Authorization: 'Bearer ' + record.access_token },
    });
    if (data.active !== id) throw fail('account_changed', '계정이 변경되었습니다.');
    const list = (body.models || [])
      .filter(
        (m) =>
          m.visibility === 'list' &&
          typeof m.slug === 'string' &&
          typeof m.display_name === 'string',
      )
      .map((m) => ({ id: m.slug, name: m.display_name }));
    catalogs.set(id, list);
    return list;
  }
  function cancel(id) {
    jobs.get(id)?.cancelAll();
  }
  async function select(id) {
    if (jobs.size) throw fail('generation_busy', '생성을 취소한 뒤 계정을 바꾸세요.');
    cancelLogin();
    return locked(async () => {
      if (!data.accounts.some((a) => a.id === id))
        throw fail('account_missing', '계정을 찾을 수 없습니다.');
      data.active = id;
      await save();
      return view();
    });
  }
  async function logout(id) {
    cancelLogin();
    for (const p of jobs.values()) p.cancelAll();
    return locked(async () => {
      const record = data.accounts.find((a) => a.id === id);
      if (!record) return view();
      let revoked = !record.refresh_token;
      if (record.refresh_token)
        try {
          const endpoint = (await discovery()).revocation_endpoint;
          if (endpoint) {
            const r = await fetchImpl(endpoint, {
              method: 'POST',
              redirect: 'error',
              signal: AbortSignal.timeout(10000),
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                token: record.refresh_token,
                token_type_hint: 'refresh_token',
                client_id: record.client_id,
              }),
            });
            revoked = r.status === 200;
          }
        } catch {}
      delete record.access_token;
      delete record.refresh_token;
      delete record.id_token;
      catalogs.delete(id);
      await save();
      message = revoked
        ? '로그아웃했습니다.'
        : '기기에서 로그아웃했습니다. 원격 철회는 확인하지 못했으니 ChatGPT 설정에서 연결을 해제하세요.';
      return view();
    });
  }
  async function generate({
    request,
    context,
    model,
    accountId,
    variantIndex = 0,
    variantTotal = 1,
    previousDirections = [],
  }) {
    await ready;
    const id = data.active;
    if (accountId !== id)
      throw fail(
        'account_changed',
        '요청의 ChatGPT 계정이 변경되었습니다. 새 요청으로 다시 시작하세요.',
      );
    if (
      !request ||
      !/^[\w-]{1,100}$/.test(request.id) ||
      typeof request.prompt !== 'string' ||
      request.prompt.length > 8000 ||
      request.count !== 1 ||
      !Number.isInteger(variantIndex) ||
      !Number.isInteger(variantTotal) ||
      variantIndex < 0 ||
      variantIndex >= variantTotal ||
      variantTotal > 12 ||
      !Array.isArray(previousDirections) ||
      previousDirections.length > 12 ||
      previousDirections.some((v) => typeof v !== 'string' || v.length > 120) ||
      !context ||
      JSON.stringify(context).length > 22000000 ||
      !catalogs.get(id)?.some((m) => m.id === model)
    )
      throw fail('generation_invalid', '계정의 모델 목록을 새로고침하고 요청을 확인하세요.');
    if (jobs.size) throw fail('generation_busy', '이미 생성 중입니다.');
    let canceled = false,
      provider;
    jobs.set(request.id, {
      cancelAll() {
        canceled = true;
        provider?.cancelAll();
      },
    });
    try {
      const { createAiProvider } = await import('../ai-provider.js');
      const record = await credential(id);
      if (id !== data.active) throw fail('account_changed', '계정이 변경되었습니다.');
      if (canceled)
        return { model, auth: 'chatgpt', candidates: [], usage: [], failures: [], canceled: true };
      // OAuth bearer tokens are opaque and can exceed the API-key length limit.
      provider = createAiProvider({ fetchImpl, authentication: 'chatgpt' });
      provider.configure({ key: record.access_token, model });
      const candidates = [];
      const result = await provider.generate({
        request,
        context,
        variantOffset: variantIndex,
        variantTotal,
        previousDirections,
        register: async (value) => {
          candidates.push(value);
        },
      });
      return { ...result, auth: 'chatgpt', candidates };
    } finally {
      provider?.forget();
      jobs.delete(request.id);
    }
  }
  function close() {
    cancelLogin();
    for (const p of jobs.values()) p.cancelAll();
  }
  return { status, login, cancelLogin, models, select, logout, generate, cancel, close };
}
async function createChatgptStorage(safeStorage) {
  let secure = false;
  try {
    const available = await safeStorage.isAsyncEncryptionAvailable();
    if (
      available &&
      !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
    ) {
      const probe = 'Console Canvas protected-storage probe';
      const encrypted = await safeStorage.encryptStringAsync(probe);
      secure =
        !encrypted.includes(Buffer.from(probe)) &&
        (await safeStorage.decryptStringAsync(encrypted)).result === probe;
    }
  } catch {
    secure = false;
  }
  return {
    isEncryptionAvailable: () => secure,
    encryptString: (value) => safeStorage.encryptStringAsync(value),
    decryptString: async (value) => (await safeStorage.decryptStringAsync(value)).result,
  };
}
module.exports = { createChatgptService, createChatgptStorage };
