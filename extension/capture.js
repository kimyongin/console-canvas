import { captureWithProtocol } from '../capture/protocol.cjs';
import { prepareCaptureView } from '../capture/view.cjs';
import { resolveScope } from '../capture/scope.cjs';
import { readPublicResource } from '../capture/resources.cjs';
import { timedSend } from '../capture/transport.cjs';

// Platform adapter only. All DOM, style, resource and iframe algorithms are shared.
export async function captureTab(tabId, options = {}) {
  const tab = await chrome.tabs.get(tabId);
  const url = new URL(tab.url);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw Error('일반 웹페이지에서 화면을 가져와 주세요.');
  const debuggee = { tabId },
    targets = [],
    children = new Set(),
    direct = new Set(),
    sessions = new Map();
  let attached = false,
    detached = false;
  const onEvent = (source, method, params) => {
    if (source.tabId !== tabId && !direct.has(source.targetId)) return;
    if (method === 'Target.attachedToTarget') {
      targets.push(params);
      children.add(params.targetInfo.targetId);
      if (source.targetId)
        sessions.set(params.sessionId, { targetId: source.targetId, sessionId: params.sessionId });
    }
  };
  const onDetach = (source) => {
    if (source.tabId === tabId) detached = true;
  };
  const abort = () => {
    for (const targetId of direct) void chrome.debugger.detach({ targetId }).catch(() => {});
    if (attached && !detached) void chrome.debugger.detach(debuggee).catch(() => {});
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  chrome.debugger.onEvent.addListener(onEvent);
  chrome.debugger.onDetach.addListener(onDetach);
  const send = timedSend(async (method, params, session) => {
    if (detached || options.signal?.aborted) throw Error('화면 가져오기 연결이 종료되었습니다.');
    try {
      return await chrome.debugger.sendCommand(
        sessions.get(session) || { ...debuggee, ...(session ? { sessionId: session } : {}) },
        method,
        params,
      );
    } catch (error) {
      if (method !== 'Target.attachToTarget' || !children.has(params.targetId)) throw error;
      // Chrome authorizes this API separately from raw Target.attachToTarget.
      await chrome.debugger.attach({ targetId: params.targetId }, '1.3');
      direct.add(params.targetId);
      const sessionId = 'direct:' + params.targetId;
      sessions.set(sessionId, { targetId: params.targetId });
      return { sessionId };
    }
  });
  try {
    await chrome.debugger.attach(debuggee, '1.3');
    attached = true;
    const frame = (await send('Page.getFrameTree')).frameTree.frame;
    const world = await send('Page.createIsolatedWorld', {
      frameId: frame.id,
      worldName: 'page-canvas-prepare',
    });
    const read = async (expression) => {
      const response = await send('Runtime.evaluate', {
        expression,
        contextId: world.executionContextId,
        returnByValue: true,
        awaitPromise: true,
      });
      if (response.exceptionDetails)
        throw Error(
          response.exceptionDetails.exception?.description || response.exceptionDetails.text,
        );
      return response.result?.value;
    };
    // Chrome's debugger notice can change innerHeight while it animates.
    const stable = await read(
      `new Promise(resolve=>{let last='',since=Date.now();const deadline=Date.now()+5000;const timer=setInterval(()=>{const key=[innerWidth,innerHeight,devicePixelRatio].join(',');if(key!==last){last=key;since=Date.now()}if(Date.now()-since>=650||Date.now()>deadline){clearInterval(timer);resolve(Date.now()-since>=650)}},50)})`,
    );
    if (!stable) throw Error('원본 화면 크기가 계속 바뀝니다. 잠시 후 다시 가져와 주세요.');
    if ((await read('location.href')) !== tab.url)
      throw Error('원본 페이지가 변경되었습니다. 다시 가져와 주세요.');
    if (options.preview) {
      const view = await read(
        '({url:location.href,x:scrollX,y:scrollY,width:innerWidth,height:innerHeight})',
      );
      const shot = await send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      return { view, image: 'data:image/png;base64,' + shot.data };
    }
    const scope = await resolveScope(read, options.scope || { mode: 'viewport' });
    const code = await fetch(chrome.runtime.getURL('capture.js')).then((response) => {
      if (!response.ok) throw Error('수집 모듈을 읽지 못했습니다.');
      return response.text();
    });
    const prepared = await prepareCaptureView(read, code, { scope });
    const snapshot = await captureWithProtocol({
      send,
      code,
      scope,
      getTargets: () => targets,
      onProgress: options.onProgress,
      readResource: (resource) => readPublicResource(resource, fetch),
    });
    if ((await read('location.href')) !== tab.url)
      throw Error('가져오는 동안 원본 페이지가 변경되었습니다.');
    snapshot.captureScope = scope;
    snapshot.captureReport.preparedView = prepared;
    return snapshot;
  } finally {
    for (const targetId of direct) await chrome.debugger.detach({ targetId }).catch(() => {});
    if (attached && !detached) await chrome.debugger.detach(debuggee).catch(() => {});
    options.signal?.removeEventListener('abort', abort);
    chrome.debugger.onEvent.removeListener(onEvent);
    chrome.debugger.onDetach.removeListener(onDetach);
  }
}
