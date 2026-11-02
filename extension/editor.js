import { createWebMcpClient } from './webmcp.js';
import { workspaceIdentity } from '../workspace-identity.js';

export async function openOriginal(snapshot) {
  const source = snapshot?.source,
    binding = source?.extension;
  if (!binding)
    throw Error(
      '이 티켓에는 현재 Chrome 원본 탭 연결이 없습니다. Chrome에서 원본 페이지를 열어 주세요.',
    );
  const r = await chrome.runtime.sendMessage({
    action: 'source',
    tab_id: binding.tab_id,
    session_id: binding.session_id,
    document_id: binding.document_id,
    url: source.url,
  });
  if (!r?.ok) throw Error(r?.error || '원본 탭을 열지 못했습니다.');
}
export async function initializeExtension({ workspace, openTicket, onStatus }) {
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message.action !== 'open-ticket') return false;
    openTicket(message.ticket_id)
      .then(() => respond({ ok: true }))
      .catch((error) => respond({ ok: false, error: error.message }));
    return true;
  });
  const bridge = await createWebMcpClient({ workspace, onStatus });
  const enabled = await chrome.storage.local.get('webmcpEnabled');
  if (enabled.webmcpEnabled) await bridge.enable();
  return {
    ...bridge,
    async enable() {
      const r = await bridge.enable();
      if (r.ok) await chrome.storage.local.set({ webmcpEnabled: true });
      return r;
    },
    async disable() {
      bridge.disable();
      await chrome.storage.local.set({ webmcpEnabled: false });
    },
    async copyRequest(text) {
      const id = await workspaceIdentity();
      await navigator.clipboard.writeText(`Chrome 확장의 Page Canvas 작업공간 ${id}에서 ${text}`);
    },
  };
}
