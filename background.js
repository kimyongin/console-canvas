import { captureChromeTab } from './chrome-capture.js';
import { saveCapture } from './db.js';

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  await chrome.action.setBadgeText({ tabId: tab.id, text: '…' });
  await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#5152cd' });
  try {
    if (!/^https?:\/\//.test(tab.url || ''))
      throw new Error(
        '일반 HTTP·HTTPS 웹 화면에서 확장 버튼을 눌러 주세요. 브라우저 설정 화면에는 접근할 수 없습니다.',
      );
    const snapshot = await captureChromeTab(chrome, tab);
    await saveCapture(snapshot);
    await chrome.tabs.create({
      url: chrome.runtime.getURL('editor.html') + '?id=' + encodeURIComponent(snapshot.id),
    });
    await chrome.action.setBadgeText({ tabId: tab.id, text: '' });
  } catch (error) {
    await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
    await chrome.tabs.create({
      url: chrome.runtime.getURL('editor.html') + '?error=' + encodeURIComponent(error.message),
    });
  }
});
