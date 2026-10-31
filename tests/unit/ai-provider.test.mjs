import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiProvider } from '../../ai-provider.js';
const request = {
  id: 'request',
  count: 3,
  prompt: 'Improve layout',
  baseline: { selection: ['n1'] },
};
function stream(candidate, usage = { input_tokens: 10, output_tokens: 20 }) {
  const response = {
    status: 'completed',
    output: [{ content: [{ type: 'output_text', text: JSON.stringify(candidate) }] }],
    usage,
  };
  return new Response(
    'data: ' + JSON.stringify({ type: 'response.completed', response }) + '\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}
const candidate = {
  name: 'Layout',
  summary: 'Spacing',
  patches: [
    {
      type: 'style',
      element_id: 'n1',
      properties: [{ name: 'gap', value: '16px' }],
      text: null,
      attributes: null,
      html: null,
      parent_id: null,
      before_id: null,
      css: null,
    },
  ],
};
test('OAuth token bounds are separate from API keys and never expose credential values', () => {
  const keyProvider = createAiProvider();
  const oauthProvider = createAiProvider({ authentication: 'chatgpt' });
  const token = 'fixture-bearer-' + 'x'.repeat(3000);
  assert.throws(() => keyProvider.configure({ key: token, model: 'test' }), {
    code: 'invalid_credential',
  });
  oauthProvider.configure({ key: token, model: 'test' });
  assert.deepEqual(oauthProvider.status(), {
    configured: true,
    model: 'test',
    auth: 'chatgpt',
    storage: 'memory',
  });
  for (const key of ['x'.repeat(64_001), 'bearer\ninvalid'])
    assert.throws(() => oauthProvider.configure({ key, model: 'test' }), {
      code: 'invalid_credential',
    });
  assert.ok(!JSON.stringify(oauthProvider.status()).includes(token));
});
test('Completed compact streams use text events without duplicating deltas or applying partial output', async () => {
  let completed = true;
  const provider = createAiProvider({
    fetchImpl: async () => {
      const text = JSON.stringify(candidate);
      const events = [
        {
          type: 'response.output_text.delta',
          output_index: 0,
          content_index: 0,
          delta: text.slice(0, 30),
        },
        {
          type: 'response.output_text.delta',
          output_index: 0,
          content_index: 0,
          delta: text.slice(30),
        },
        { type: 'response.output_text.done', output_index: 0, content_index: 0, text },
        ...(completed
          ? [
              {
                type: 'response.completed',
                response: {
                  status: 'completed',
                  output: [],
                  usage: { input_tokens: 12, output_tokens: 34 },
                },
              },
            ]
          : []),
      ];
      return new Response(
        events.map((event) => 'data: ' + JSON.stringify(event) + '\n\n').join(''),
      );
    },
  });
  provider.configure({ key: 'fixture-key', model: 'fixture-model' });
  const registered = [];
  const generate = () =>
    provider.generate({
      request: { ...request, count: 1 },
      context: {},
      register: (c) => registered.push(c),
    });
  const result = await generate();
  assert.equal(result.failures.length, 0);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, candidate.name);
  assert.equal(result.usage[0].output_tokens, 34);
  completed = false;
  const interrupted = await generate();
  assert.equal(interrupted.failures[0].code, 'incomplete');
  assert.equal(registered.length, 1);
});
test('API sends frozen context to fixed endpoint, independently registers variants and never serializes credentials', async () => {
  const calls = [],
    registered = [];
  const provider = createAiProvider({
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options });
      return stream(candidate);
    },
  });
  provider.configure({ key: 'fake-local-test-key', model: 'test-model' });
  const result = await provider.generate({
    request,
    context: {
      html: 'LEAK_HTML',
      styles: 'LEAK_CSS',
      elements: [{ locator: { selector: 'LEAK_SELECTOR' } }],
      images: [{ kind: 'overview', image_url: 'data:image/png;base64,AA==' }],
    },
    register: async (value) => registered.push(value),
  });
  assert.equal(calls.length, 3);
  assert.equal(registered.length, 3);
  assert.ok(
    calls.every(
      (call) => call.url === 'https://api.openai.com/v1/responses' && call.redirect === 'error',
    ),
  );
  const bodies = calls.map((call) => JSON.parse(call.body));
  assert.ok(!JSON.stringify(bodies).includes('LEAK_'));
  assert.ok(bodies.every((b) => b.input[0].content.some((c) => c.type === 'input_image')));
  assert.ok(
    bodies.every(
      (body) =>
        body.store === false && body.stream === true && body.text.format.type === 'json_schema',
    ),
  );
  assert.ok(bodies.every((body) => !JSON.stringify(body).includes('fake-local-test-key')));
  assert.deepEqual(registered[0].patches, [
    { type: 'style', element_id: 'n1', properties: { gap: '16px' } },
  ]);
  assert.equal(result.usage.length, 3);
  assert.ok(!JSON.stringify({ result, status: provider.status() }).includes('fake-local-test-key'));
  provider.forget();
  assert.equal(provider.status().configured, false);
  await assert.rejects(provider.generate({ request, context: {}, register: async () => {} }));
});
test('Per-variant invalid output preserves completed alternatives; auth and limits do not silently retry billing routes', async () => {
  for (const status of [401, 403, 429]) {
    let calls = 0;
    const provider = createAiProvider({
      fetchImpl: async () => {
        calls++;
        return new Response('secret unsafe upstream detail', { status });
      },
    });
    provider.configure({ key: 'fake-test', model: 'test' });
    const result = await provider.generate({
      request,
      context: {},
      register: async () => {
        throw Error('must not register');
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.failures[0].code, 'api_' + status);
    assert.ok(!JSON.stringify(result).includes('unsafe'));
  }
  let calls = 0;
  const registered = [];
  const provider = createAiProvider({
    fetchImpl: async () =>
      ++calls === 2 ? new Response('data: {"type":"response.incomplete"}\n\n') : stream(candidate),
  });
  provider.configure({ key: 'fake-test', model: 'test' });
  const result = await provider.generate({
    request,
    context: {},
    register: async (value) => registered.push(value),
  });
  assert.equal(registered.length, 2);
  assert.equal(result.failures.length, 1);
});
test('Cancel aborts stream and leaves completed candidates available', async () => {
  let provider,
    calls = 0;
  const registered = [];
  provider = createAiProvider({
    fetchImpl: async (url, { signal }) => {
      if (++calls === 1) return stream(candidate);
      return new Promise((resolve, reject) =>
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
      );
    },
  });
  provider.configure({ key: 'fake-test', model: 'test' });
  const job = provider.generate({
    request,
    context: {},
    register: async (value) => registered.push(value),
  });
  while (calls < 2) await new Promise((resolve) => setTimeout(resolve, 1));
  provider.cancel(request.id);
  const result = await job;
  assert.equal(result.canceled, true);
  assert.equal(registered.length, 1);
  assert.equal(calls, 2);
});
