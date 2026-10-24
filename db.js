// Captures are immutable; edits and lightweight recent-document metadata are separate.
export const DATABASE_NAME = 'console-canvas-workspace';
export async function database() {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('captures', { keyPath: 'id' });
      request.result.createObjectStore('sessions', { keyPath: 'id' });
      request.result
        .createObjectStore('documents', { keyPath: 'id' })
        .createIndex('updatedAt', 'updatedAt');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transact(stores, mode, action) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('저장 작업이 중단되었습니다.'));
      try {
        action(tx, (value) => {
          result = value;
        });
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  } finally {
    db.close();
  }
}
export function captureFromDocument(value) {
  const { edits, annotations, timeline, note, updatedAt, ...capture } = value;
  return capture;
}
export async function saveCapture(value) {
  const capture = captureFromDocument(value);
  return transact(['captures', 'documents'], 'readwrite', (tx, done) => {
    const store = tx.objectStore('captures');
    const request = store.getKey(capture.id);
    request.onsuccess = () => {
      if (request.result !== undefined) return done(false);
      store.add(capture);
      tx.objectStore('documents').add({
        id: capture.id,
        title: capture.source.title,
        url: capture.source.url,
        capturedAt: capture.capturedAt,
        updatedAt: new Date().toISOString(),
      });
      done(true);
    };
  });
}
export async function saveSession(id, value) {
  const {
    edits = {},
    annotations = {},
    timeline = null,
    note = '',
    updatedAt = new Date().toISOString(),
  } = value;
  const session = { edits, annotations, timeline, note, updatedAt };
  return transact(['sessions', 'documents'], 'readwrite', (tx) => {
    const metadata = tx.objectStore('documents');
    const request = metadata.get(id);
    request.onsuccess = () => {
      if (!request.result) {
        tx.abort();
        return;
      }
      tx.objectStore('sessions').put({ ...session, id });
      metadata.put({ ...request.result, updatedAt: session.updatedAt });
    };
  });
}
export async function getDocument(id) {
  return transact(['captures', 'sessions'], 'readonly', (tx, done) => {
    let capture, session;
    const source = tx.objectStore('captures').get(id),
      edits = tx.objectStore('sessions').get(id);
    source.onsuccess = () => {
      capture = source.result;
      done(capture && { ...capture, ...session });
    };
    edits.onsuccess = () => {
      session = edits.result;
      done(capture && { ...capture, ...session });
    };
  });
}
export async function listDocuments(limit = 4) {
  return transact(['documents'], 'readonly', (tx, done) => {
    const result = [];
    const request = tx.objectStore('documents').index('updatedAt').openCursor(null, 'prev');
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || result.length >= limit) return done(result);
      result.push(cursor.value);
      cursor.continue();
    };
  });
}
