// Only metadata and completed candidates cross this boundary; never OAuth tokens.
export function createChatgptProvider(transport = globalThis.ConsoleCanvasDesktop?.chatgpt) {
  const jobs = new Map();
  let selectedModel = '',
    selectedAccount = '';
  async function call(name, ...args) {
    if (!transport) throw new Error('ChatGPT 로그인은 내장 앱에서 사용할 수 있습니다.');
    const result = await transport[name](...args);
    if (!result.ok)
      throw Object.assign(new Error(result.error.message), { code: result.error.code });
    return result.value;
  }
  return {
    available: () => !!transport,
    call,
    setModel(value, accountId) {
      selectedModel = value;
      selectedAccount = accountId || '';
    },
    async generate({ request, context, register }) {
      if (jobs.has(request.id)) throw new Error('이미 생성 중인 요청입니다.');
      const job = { canceled: false };
      jobs.set(request.id, job);
      const usage = [],
        failures = [];
      const model = selectedModel;
      const accountId = selectedAccount;
      try {
        for (let i = 0; i < request.count && !job.canceled; i++) {
          let result;
          try {
            result = await call('generate', {
              request: {
                id: request.id,
                prompt: request.prompt,
                count: 1,
                baseline: { selection: request.baseline.selection },
              },
              context,
              model,
              accountId,
              variantIndex: i,
              variantTotal: request.count,
              previousDirections: usage.map((item) => item.name).filter(Boolean),
            });
          } catch (error) {
            failures.push({ index: i + 1, code: error.code || 'generation_failed' });
            break;
          }
          // Inference has already consumed usage even if local patch validation fails.
          usage.push(...result.usage);
          failures.push(...result.failures);
          let rejected = false;
          for (const candidate of result.candidates) {
            if (job.canceled) break;
            try {
              await register(candidate);
            } catch (error) {
              failures.push({
                index: i + 1,
                code: error.code === 'invalid_css_property' ? error.code : 'candidate_invalid',
              });
              rejected = true;
              break;
            }
          }
          if (rejected || result.failures.length || result.canceled) break;
        }
        return { auth: 'chatgpt', model, usage, failures, canceled: job.canceled };
      } finally {
        jobs.delete(request.id);
      }
    },
    cancel(id) {
      const job = jobs.get(id);
      if (job) {
        job.canceled = true;
        call('cancel', id).catch(() => {});
      }
    },
    cancelAll() {
      for (const [id, job] of jobs) {
        job.canceled = true;
        call('cancel', id).catch(() => {});
      }
    },
  };
}
