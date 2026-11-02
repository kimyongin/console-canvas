import { captureTab } from './capture.js';
import { activeProject, createProject, getProject, listProjects } from '../project-model.js';
import {
  beginCaptureJob,
  readCaptureJob,
  finishCaptureJob,
  persistCapturedTicket,
  recoverCaptureJob,
} from '../capture-jobs.js';

let running = null;
const ready = (async () => {
  let { browserSession } = await chrome.storage.session.get('browserSession');
  if (!browserSession) {
    browserSession = crypto.randomUUID();
    await chrome.storage.session.set({ browserSession });
  }
  await recoverCaptureJob();
  return browserSession;
})();
async function editor(id) {
  const url = chrome.runtime.getURL('editor.html');
  const tabs = await chrome.tabs.query({ url: url + '*' });
  const tab = tabs[0];
  if (tab) {
    if (id) {
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'open-ticket',
        ticket_id: id,
      });
      if (!response?.ok) throw Error(response?.error || '열린 편집을 마친 뒤 티켓을 열어 주세요.');
    }
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return tab.id;
  }
  return (
    await chrome.tabs.create({
      url: url + (id ? '?id=' + encodeURIComponent(id) : ''),
      active: true,
    })
  ).id;
}
async function startCapture(request) {
  const session_id = await ready;
  const tab = await chrome.tabs.get(request.tab_id);
  if (!/^https?:\/\//.test(tab.url || '')) throw Error('일반 웹페이지에서 가져와 주세요.');
  if (request.expected_url && request.expected_url !== tab.url)
    throw Error('원본 페이지가 변경되었습니다. 확장 버튼을 다시 눌러 주세요.');
  const sourceFrame = await chrome.webNavigation.getFrame({ tabId: tab.id, frameId: 0 });
  if (
    !sourceFrame?.documentId ||
    (request.expected_document_id && request.expected_document_id !== sourceFrame.documentId)
  )
    throw Error('원본 문서가 변경되었습니다. 다시 가져와 주세요.');
  const project = await getProject(request.project_id);
  if (!project) throw Error('저장할 프로젝트를 선택해 주세요.');
  const job = await beginCaptureJob({
    id: request.id,
    tab_id: tab.id,
    url: tab.url,
    project_id: project.id,
    scope: request.scope || { mode: 'viewport' },
    session_id,
    source_document_id: sourceFrame.documentId,
  });
  if (job.stage === 'complete') {
    await editor(job.ticket_id);
    return job;
  }
  if (job.stage !== 'running') return job;
  if (running) return job;
  const controller = new AbortController();
  running = { id: job.id, controller };
  // Do not await this in the popup: the capture belongs to the service worker.
  void (async () => {
    try {
      const snapshot = await captureTab(job.tab_id, {
        scope: job.scope,
        signal: controller.signal,
        onProgress: () => {},
      });
      if (controller.signal.aborted) throw Error('화면 가져오기를 취소했습니다.');
      const currentFrame = await chrome.webNavigation.getFrame({ tabId: job.tab_id, frameId: 0 });
      if (currentFrame?.documentId !== job.source_document_id)
        throw Error('가져오는 동안 원본 문서가 변경되었습니다.');
      const saved = await persistCapturedTicket(snapshot, job);
      await editor(saved.ticket_id);
    } catch (error) {
      // A completed durable save takes precedence over a lost UI-open response.
      const current = await readCaptureJob(job.id);
      if (current?.stage !== 'complete')
        await finishCaptureJob(job, {
          stage: controller.signal.aborted ? 'cancelled' : 'failed',
          error: controller.signal.aborted ? '화면 가져오기를 취소했습니다.' : error.message,
        });
      else await finishCaptureJob(job, { open_error: error.message });
    } finally {
      if (running?.id === job.id) running = null;
    }
  })();
  return job;
}
async function command(message) {
  await ready;
  if (message.action === 'state')
    return {
      projects: await listProjects(),
      active_project: await activeProject(),
      job: await recoverCaptureJobView(),
    };
  if (message.action === 'create-project') {
    const project = await createProject(message.name);
    return { project };
  }
  if (message.action === 'select-project') {
    await activeProject(message.project_id);
    return {};
  }
  if (message.action === 'capture') return { job: await startCapture(message) };
  if (message.action === 'job') return { job: await readCaptureJob(message.id) };
  if (message.action === 'cancel') {
    if (running?.id === message.id) {
      running.controller.abort();
      return {};
    }
    return { job: await readCaptureJob(message.id) };
  }
  if (message.action === 'editor') return { tab_id: await editor(message.ticket_id) };
  if (message.action === 'region-preview') {
    if (running) throw Error('진행 중인 가져오기를 마친 뒤 영역을 선택해 주세요.');
    const sourceFrame = await chrome.webNavigation.getFrame({ tabId: message.tab_id, frameId: 0 });
    const preview = await captureTab(message.tab_id, { preview: true });
    const after = await chrome.webNavigation.getFrame({ tabId: message.tab_id, frameId: 0 });
    if (!sourceFrame?.documentId || sourceFrame.documentId !== after?.documentId)
      throw Error('원본 문서가 변경되었습니다.');
    return { preview: { ...preview, document_id: sourceFrame.documentId } };
  }
  if (message.action === 'source') {
    if (!message.document_id && message.session_id !== (await ready))
      throw Error('이전 브라우저 실행의 원본입니다. Chrome에서 해당 페이지를 다시 열어 주세요.');
    const tab = await chrome.tabs.get(message.tab_id).catch(() => null);
    const frame =
      tab && (await chrome.webNavigation.getFrame({ tabId: tab.id, frameId: 0 }).catch(() => null));
    if (
      !tab ||
      tab.url !== message.url ||
      (message.document_id && frame?.documentId !== message.document_id)
    )
      throw Error('원본 탭이 닫혔거나 페이지가 바뀌었습니다.');
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return {};
  }
  throw Error('지원하지 않는 확장 요청입니다.');
}
async function recoverCaptureJobView() {
  // Recovery runs once at worker startup, never while a live capture is running.
  const { transact } = await import('../db.js');
  return transact(['settings'], 'readonly', (tx, done) => {
    const r = tx.objectStore('settings').get('active-capture-job');
    r.onsuccess = () => done(r.result?.value || null);
  });
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const allowed = ['/popup.html', '/editor.html', '/region.html'];
  let path;
  try {
    const url = new URL(sender.url);
    if (url.origin !== new URL(chrome.runtime.getURL('/')).origin) return false;
    path = url.pathname;
  } catch {
    return false;
  }
  if (sender.id !== chrome.runtime.id || (sender.frameId ?? 0) !== 0 || !allowed.includes(path))
    return false;
  command(message)
    .then((value) => respond({ ok: true, ...value }))
    .catch((error) => respond({ ok: false, error: error.message }));
  return true;
});
