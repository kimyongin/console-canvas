const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// The same acknowledged editor flush is used by close, quit and app updates.
function createEditorLifecycle({
  ipcMain,
  trusted,
  getContents,
  isReady,
  isBusy,
  sessionFile,
  timeout = 15000,
}) {
  let pending = null,
    quitAllowed = false,
    quitting = false,
    last = { document_id: null };
  try {
    last = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  } catch {}
  async function requestFlush() {
    if (isBusy()) throw new Error('화면 가져오기를 마친 뒤 다시 시도해 주세요.');
    if (!isReady()) return last;
    const contents = getContents(),
      id = randomUUID();
    const result = await new Promise((resolve, reject) => {
      function cleanup() {
        clearTimeout(timer);
        ipcMain.removeListener('canvas:flushed', saved);
        contents.removeListener('destroyed', destroyed);
      }
      function fail(error) {
        cleanup();
        reject(error);
      }
      function destroyed() {
        fail(new Error('편집기가 저장 전에 종료되었습니다.'));
      }
      function saved(event, request, value) {
        try {
          trusted(event, 'editor');
        } catch {
          return;
        }
        if (request !== id) return;
        cleanup();
        value.ok
          ? resolve({ document_id: value.document_id || null })
          : reject(new Error(value.message));
      }
      const timer = setTimeout(
        () => fail(new Error('편집 내용 저장 응답이 없습니다. 다시 시도해 주세요.')),
        timeout,
      );
      ipcMain.on('canvas:flushed', saved);
      contents.once('destroyed', destroyed);
      try {
        contents.send('canvas:flush', id);
      } catch (error) {
        fail(error);
      }
    });
    await fs.promises.mkdir(path.dirname(sessionFile), { recursive: true });
    const temporary = sessionFile + '.tmp';
    await fs.promises.writeFile(temporary, JSON.stringify(result), { mode: 0o600 });
    await fs.promises.rename(temporary, sessionFile);
    last = result;
    return result;
  }
  function flush() {
    if (!pending)
      pending = requestFlush().finally(() => {
        pending = null;
      });
    return pending;
  }
  function quitSaved(app) {
    quitAllowed = true;
    app.quit();
  }
  function protectQuit(app, onError) {
    app.on('before-quit', (event) => {
      if (quitAllowed) return;
      event.preventDefault();
      if (quitting) return;
      quitting = true;
      flush().then(
        () => quitSaved(app),
        (error) => {
          quitting = false;
          onError(error);
        },
      );
    });
  }
  return { flush, protectQuit, quitSaved, canQuit: () => quitAllowed, restore: () => last };
}
module.exports = { createEditorLifecycle };
