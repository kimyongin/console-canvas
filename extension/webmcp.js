import { toolContract, validateToolArguments } from '../tool-contract.js';
import { workspaceIdentity } from '../workspace-identity.js';
import { agentRepositoryContext } from '../repository-context.js';

// Same ticket service and validation as the app. No original-page control API.
export async function createWebMcpClient({ workspace, onStatus = () => {} }) {
  const workspaceId = await workspaceIdentity();
  let active = null,
    queue = Promise.resolve();
  const urls = new Set();
  const status = (value) => onStatus({ workspace_id: workspaceId, ...value });
  const error = (code, message) => ({
    ok: false,
    error: { code, message },
    workspace_id: workspaceId,
  });
  function disable() {
    active?.abort();
    active = null;
    for (const url of urls) URL.revokeObjectURL(url);
    urls.clear();
    status({ connected: false, message: 'WebMCP 연결 해제' });
  }
  function preview(data, role = 'current') {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(data || '');
    if (!match) throw Error('이미지 형식을 확인해 주세요.');
    const bytes = Uint8Array.from(atob(match[2]), (s) => s.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: match[1] }));
    urls.add(url);
    setTimeout(() => {
      URL.revokeObjectURL(url);
      urls.delete(url);
    }, 300000);
    return {
      role,
      preview_url: chrome.runtime.getURL('review-image.html') + '#' + encodeURIComponent(url),
      expires_in_seconds: 300,
    };
  }
  async function execute(name, input) {
    if (!active) return error('disconnected', '작업공간 탭의 연결을 확인해 주세요.');
    const { workspace_id, repository_context, ...args } = input;
    const discovery = ['get_agent_guide', 'list_projects', 'list_screens'].includes(name);
    if ((!discovery || workspace_id) && workspace_id !== workspaceId)
      return error('wrong_workspace', '작업공간 ID가 다릅니다. 목록을 다시 확인해 주세요.');
    try {
      validateToolArguments(name, args);
      status({ connected: true, agent_command: name, message: '에이전트 호출 확인 · ' + name });
      if (name === 'get_agent_guide') {
        const response = await fetch(chrome.runtime.getURL('agent-guide.md'));
        if (!response.ok) throw Error('스킬 가이드를 읽지 못했습니다.');
        return {
          ok: true,
          workspace_id: workspaceId,
          version: chrome.runtime.getManifest().version,
          source: 'extension_bundle',
          markdown: await response.text(),
          capabilities: {
            transport: 'webmcp',
            requires_workspace_tab: true,
            subscriptions: false,
            repository_verifier: 'local_agent',
          },
        };
      }
      if (name === 'list_screens')
        return { ok: true, workspace_id: workspaceId, screens: [workspace.metadata()] };
      if (args.repository_path) {
        if (!repository_context)
          return error(
            'repository_context_required',
            '로컬 Git root/common-dir를 확인하고 repository_context와 함께 보내 주세요.',
          );
      } else if (repository_context)
        return error(
          'repository_context_required',
          '확인한 Git root를 repository_path로 함께 보내 주세요.',
        );
      const normalized = args.repository_path
        ? await agentRepositoryContext(repository_context, args.repository_path)
        : null;
      const result = await workspace.execute({
        name,
        arguments: { ...structuredClone(args), ...(normalized ? { repository: normalized } : {}) },
        deadline: Date.now() / 1000 + 120,
      });
      if (result.ok && result.data_url) {
        const { data_url, ...info } = result;
        return {
          ...info,
          workspace_id: workspaceId,
          image: preview(data_url),
          image_transport:
            'Open image.preview_url with new_page, then take_screenshot with fullPage:true to receive an image content block.',
        };
      }
      if (result.ok && result.images) {
        result.images = result.images.map(({ image_url, ...info }) => ({
          ...info,
          ...preview(image_url, info.role),
        }));
        result.image_transport =
          'Open each preview_url with new_page, then take_screenshot with fullPage:true to receive image content blocks.';
      }
      return { ...result, workspace_id: workspaceId };
    } catch (e) {
      return error('tool_error', e.message);
    }
  }
  async function enable() {
    disable();
    if (!document.modelContext?.registerTool) {
      status({
        connected: false,
        message: '이 Chrome에서 WebMCP를 사용할 수 없습니다. 편집·저장은 계속 가능합니다.',
      });
      return { ok: false, error: 'webmcp_unavailable' };
    }
    active = new AbortController();
    try {
      for (const tool of toolContract.tools) {
        const discovery = ['get_agent_guide', 'list_projects', 'list_screens'].includes(tool.name);
        await document.modelContext.registerTool(
          {
            name: 'page_canvas_' + tool.name,
            description: tool.description,
            inputSchema: {
              ...tool.inputSchema,
              properties: {
                ...tool.inputSchema.properties,
                workspace_id: { type: 'string', minLength: 1, maxLength: 100 },
                ...(tool.inputSchema.properties.repository_path
                  ? {
                      repository_context: {
                        type: 'object',
                        properties: {
                          root: { type: 'string', maxLength: 4096 },
                          common_dir: { type: 'string', maxLength: 4096 },
                          identity: { type: 'string', maxLength: 64 },
                          method: { const: 'git_rev_parse' },
                        },
                        required: ['root', 'common_dir', 'method'],
                        additionalProperties: false,
                      },
                    }
                  : {}),
              },
              required: [...tool.inputSchema.required, ...(discovery ? [] : ['workspace_id'])],
            },
            annotations: {
              readOnlyHint: !!tool.annotations?.readOnlyHint,
              untrustedContentHint: true,
            },
            execute(input) {
              const task = queue.catch(() => {}).then(() => execute(tool.name, input));
              queue = task;
              return task;
            },
          },
          { signal: active.signal },
        );
      }
      status({ connected: true, message: 'WebMCP 도구 준비 · 에이전트 호출 대기' });
      return { ok: true, workspace_id: workspaceId };
    } catch (e) {
      disable();
      status({ connected: false, message: e.message });
      return { ok: false, error: e.message };
    }
  }
  window.addEventListener('pagehide', disable, { once: true });
  return { enable, disable, workspaceId };
}
