import { toolContract, validateToolArguments } from './tool-contract.js';
export function createWebMcpClient({ controller, onStatus }) {
  let session = null,
    queue = Promise.resolve();
  const replay = new Map();
  function notify(message) {
    onStatus({ enabled: !!session, message });
  }
  function disable() {
    session?.abort.abort();
    for (const url of session?.urls || []) URL.revokeObjectURL(url);
    session = null;
    notify('WebMCP 도구 미공개');
  }
  async function enable() {
    disable();
    if (!document.modelContext?.registerTool)
      throw new Error(
        'WebMCP를 지원하는 Chrome과 기능 설정을 확인해 주세요. 일반 편집은 계속 사용할 수 있습니다.',
      );
    const current = {
      abort: new AbortController(),
      documentId: controller.metadata()?.document_id || null,
      replay,
      imageJob: null,
      contextJob: null,
      urls: new Set(),
    };
    session = current;
    try {
      for (const tool of toolContract.tools) {
        if (session !== current) return;
        await document.modelContext.registerTool(
          {
            name: 'console_canvas_' + tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: tool.annotations,
            execute(args) {
              const task = queue
                .catch(() => {})
                .then(async () => {
                  if (session !== current || current.abort.signal.aborted)
                    return { ok: false, error: { code: 'disconnected' } };
                  const metadata = controller.metadata();
                  if ((metadata?.document_id || null) !== current.documentId) {
                    disable();
                    return { ok: false, error: { code: 'wrong_document' } };
                  }
                  try {
                    validateToolArguments(tool.name, args);
                  } catch (error) {
                    return {
                      ok: false,
                      error: { code: 'invalid_arguments', message: error.message },
                    };
                  }
                  notify(
                    'WebMCP 호출 확인 · ' + tool.name + ' · ' + new Date().toLocaleTimeString(),
                  );
                  if (tool.name === 'get_agent_guide') {
                    const response = await fetch(chrome.runtime.getURL('agent-guide.md'));
                    if (!response.ok) return { ok: false, error: { code: 'guide_unavailable' } };
                    return {
                      ok: true,
                      name: 'console-canvas',
                      source: 'extension_bundle',
                      version: chrome.runtime.getManifest().version,
                      contract_version: toolContract.version,
                      markdown: await response.text(),
                    };
                  }
                  if (tool.name === 'list_screens')
                    return { ok: true, screens: metadata ? [metadata] : [] };
                  if (!metadata) return { ok: false, error: { code: 'not_ready' } };
                  const key = args.operation_id
                    ? metadata.document_id + ':' + args.operation_id
                    : null;
                  const fingerprint = JSON.stringify({ name: tool.name, args }, (_key, value) =>
                    value && typeof value === 'object' && !Array.isArray(value)
                      ? Object.fromEntries(
                          Object.keys(value)
                            .sort()
                            .map((key) => [key, value[key]]),
                        )
                      : value,
                  );
                  if (key && current.replay.has(key)) {
                    const old = current.replay.get(key);
                    return old.fingerprint === fingerprint
                      ? structuredClone(old.result)
                      : { ok: false, error: { code: 'operation_id_reused' } };
                  }
                  const command = {
                    name: tool.name,
                    document_id: metadata.document_id,
                    arguments: args,
                    deadline: Date.now() / 1000 + 45,
                  };
                  if (['get_review_image', 'get_ai_context'].includes(tool.name)) {
                    const slot = tool.name === 'get_review_image' ? 'imageJob' : 'contextJob';
                    const signature = JSON.stringify([
                      metadata.document_id,
                      metadata.revision,
                      metadata.title,
                      tool.name,
                      args,
                    ]);
                    if (current[slot]?.signature !== signature) {
                      const job = { signature, result: null };
                      current[slot] = job;
                      setTimeout(async () => {
                        if (session !== current) {
                          job.result = { ok: false, error: { code: 'disconnected' } };
                          return;
                        }
                        try {
                          const result = await controller.execute(command);
                          if (
                            session !== current ||
                            controller.metadata()?.revision !== metadata.revision
                          ) {
                            job.result = { ok: false, error: { code: 'revision_conflict' } };
                            return;
                          }
                          job.result = await (async () => {
                            if (tool.name === 'get_review_image' && result.ok) {
                              const blob = await fetch(result.data_url).then((r) => r.blob());
                              if (session !== current)
                                return { ok: false, error: { code: 'disconnected' } };
                              const url = URL.createObjectURL(blob);
                              current.urls.add(url);
                              setTimeout(() => {
                                URL.revokeObjectURL(url);
                                current.urls.delete(url);
                              }, 300000);
                              const { data_url, ...info } = result;
                              const imageResult = {
                                ...info,
                                preview_url:
                                  chrome.runtime.getURL('review-image.html') +
                                  '#' +
                                  encodeURIComponent(url),
                                image_transport:
                                  'Open preview_url with official new_page, wait for the image to load, then take_screenshot with fullPage:true to receive image/png content. Preview expires after five minutes or editor tab closes.',
                              };

                              return imageResult;
                            }
                            return result;
                          })();
                        } catch (error) {
                          job.result = {
                            ok: false,
                            error: { code: 'image_error', message: error.message },
                          };
                        }
                      }, 0);
                    }
                    const result = current[slot].result;
                    if (result) current[slot] = null;
                    return (
                      result || {
                        ok: true,
                        pending: true,
                        revision: metadata.revision,
                        message:
                          'Rendering. Call ' +
                          tool.name +
                          ' again with identical arguments to retrieve the result.',
                      }
                    );
                  }
                  const result = await controller.execute(command);
                  if (key && result.ok) {
                    if (current.replay.size >= 200)
                      current.replay.delete(current.replay.keys().next().value);
                    current.replay.set(key, { fingerprint, result: structuredClone(result) });
                  }
                  return result;
                });
              queue = task;
              return task;
            },
          },
          { signal: current.abort.signal },
        );
      }
      if (session === current) notify('WebMCP 도구 공개 중 · 실제 호출 대기');
    } catch (error) {
      if (session === current) disable();
      throw error;
    }
  }
  return {
    enable,
    disable,
    get enabled() {
      return !!session;
    },
    invalidate() {
      if (session) disable();
    },
  };
}
