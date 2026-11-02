// Test-only transport. No DOM, CSS, resource collection or screenshot algorithm lives here.
importScripts('config.js');
const config = self.PROBE_CONFIG;
const headers = { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json' };
let target = null;
let events = [];
const observedChildren = new Set(),
  directTargets = new Set(),
  sessions = new Map();
const post = (route, value) =>
  fetch(config.url + route, { method: 'POST', headers, body: JSON.stringify(value) });
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId !== target?.tabId && !directTargets.has(source.targetId)) return;
  if (method === 'Target.attachedToTarget') {
    observedChildren.add(params.targetInfo.targetId);
    if (source.targetId)
      sessions.set(params.sessionId, { targetId: source.targetId, sessionId: params.sessionId });
  }
  events.push(post('/event', { method, params, sessionId: source.sessionId }));
});
async function open(url) {
  if (!config.allowedUrls.includes(url)) throw Error('Test URL was not allowlisted');
  for (const targetId of directTargets) await chrome.debugger.detach({ targetId }).catch(() => {});
  directTargets.clear();
  sessions.clear();
  observedChildren.clear();
  if (target) {
    await chrome.debugger.detach(target).catch(() => {});
    await chrome.tabs.remove(target.tabId).catch(() => {});
  }
  const tab = await chrome.tabs.create({ url, active: true });
  target = { tabId: tab.id };
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(updated);
      reject(Error('Test tab load timed out'));
    }, 30000);
    const done = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(updated);
      resolve();
    };
    function updated(id, info) {
      if (id === tab.id && info.status === 'complete') done();
    }
    chrome.tabs.onUpdated.addListener(updated);
    chrome.tabs.get(tab.id).then((t) => {
      if (t.status === 'complete') done();
    }, reject);
  });
  await chrome.debugger.attach(target, '1.3');
  return { attached: true, tabId: tab.id, userAgent: navigator.userAgent };
}
(async () => {
  await post('/hello', { extensionId: chrome.runtime.id, userAgent: navigator.userAgent });
  while (true) {
    const response = await fetch(config.url + '/next', { headers });
    const command = await response.json();
    if (!command) continue;
    let result, error;
    try {
      if (command.action === 'directAttach') {
        if (!observedChildren.has(command.targetId)) throw Error('Not an owned child target');
        await chrome.debugger.attach({ targetId: command.targetId }, '1.3');
        directTargets.add(command.targetId);
        result = { attached: true };
      } else if (command.action === 'directSend') {
        if (!directTargets.has(command.targetId)) throw Error('Direct target is not attached');
        result = await chrome.debugger.sendCommand(
          { targetId: command.targetId },
          command.method,
          command.params || {},
        );
      } else if (command.action === 'directDetach') {
        await chrome.debugger.detach({ targetId: command.targetId });
        directTargets.delete(command.targetId);
        result = { detached: true };
      } else if (command.normalizeAttach && command.method === 'Target.attachToTarget') {
        if (!observedChildren.has(command.params.targetId))
          throw Error('Not an owned child target');
        const targetId = command.params.targetId;
        await chrome.debugger.attach({ targetId }, '1.3');
        directTargets.add(targetId);
        const sessionId = 'direct:' + targetId;
        sessions.set(sessionId, { targetId });
        result = { sessionId };
      } else
        result =
          command.action === 'open'
            ? await open(command.url)
            : await chrome.debugger.sendCommand(
                sessions.get(command.session) || {
                  ...target,
                  ...(command.session ? { sessionId: command.session } : {}),
                },
                command.method,
                command.params || {},
              );
      await Promise.allSettled(events.splice(0));
    } catch (e) {
      error = String(e.message || e);
    }
    await post('/result', { id: command.id, result, error });
  }
})().catch((e) => post('/fatal', { error: String(e.message || e) }));
