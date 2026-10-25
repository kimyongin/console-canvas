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
  const {
    edits,
    annotations,
    timeline,
    activity,
    activityHead,
    note,
    updatedAt,
    documentName,
    layerNames,
    deletedAt,
    ...capture
  } = value;
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
        title: value.documentName || capture.source.title,
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
    activity = [],
    activityHead = null,
    note = '',
    layerNames = {},
    updatedAt = new Date().toISOString(),
    documentName,
  } = value;
  const session = {
    edits,
    annotations,
    timeline,
    activity,
    activityHead,
    note,
    ...(Object.keys(layerNames).length ? { layerNames } : {}),
    updatedAt,
  };
  return transact(['sessions', 'documents'], 'readwrite', (tx) => {
    const metadata = tx.objectStore('documents');
    const request = metadata.get(id);
    request.onsuccess = () => {
      if (!request.result || request.result.deletedAt) {
        tx.abort();
        return;
      }
      tx.objectStore('sessions').put({ ...session, id });
      metadata.put({
        ...request.result,
        ...(typeof documentName === 'string' ? { title: documentName } : {}),
        ...documentSummary(session),
        updatedAt: session.updatedAt,
      });
    };
  });
}
export async function getDocumentMetadata(id) {
  return transact(['documents'], 'readonly', (tx, done) => {
    const request = tx.objectStore('documents').get(id);
    request.onsuccess = () => done(request.result);
  });
}
export async function getDocument(id, { includeDeleted = false } = {}) {
  return transact(['captures', 'sessions', 'documents'], 'readonly', (tx, done) => {
    const values = {};
    for (const name of ['captures', 'sessions', 'documents']) {
      const request = tx.objectStore(name).get(id);
      request.onsuccess = () => {
        values[name] = request.result;
        if (Object.keys(values).length === 3) {
          const meta = values.documents;
          done(
            values.captures && meta && (includeDeleted || !meta.deletedAt)
              ? {
                  ...values.captures,
                  ...values.sessions,
                  ...(meta.title !== values.captures.source.title
                    ? { documentName: meta.title }
                    : {}),
                  ...(meta.deletedAt ? { deletedAt: meta.deletedAt } : {}),
                }
              : undefined,
          );
        }
      };
    }
  });
}
export async function listDocuments(limit = 4, { deleted = false } = {}) {
  return transact(['documents'], 'readonly', (tx, done) => {
    const result = [];
    const request = tx.objectStore('documents').index('updatedAt').openCursor(null, 'prev');
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || result.length >= limit) return done(result);
      if (!!cursor.value.deletedAt === deleted) result.push(cursor.value);
      cursor.continue();
    };
  });
}
function updateMetadata(id, patch) {
  return transact(['documents'], 'readwrite', (tx, done) => {
    const store = tx.objectStore('documents'),
      request = store.get(id);
    request.onsuccess = () => {
      if (!request.result) {
        tx.abort();
        return;
      }
      const next = { ...request.result, ...patch, updatedAt: new Date().toISOString() };
      store.put(next);
      done(next);
    };
  });
}
export function cleanDocumentName(name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120)
    throw new Error('이름은 1~120자로 입력해 주세요.');
  return name.trim();
}
export function renameDocument(id, name) {
  return updateMetadata(id, { title: cleanDocumentName(name) });
}
export function trashDocument(id) {
  return updateMetadata(id, { deletedAt: new Date().toISOString() });
}
export function restoreDocument(id) {
  return updateMetadata(id, { deletedAt: null });
}

export function documentSummary(value) {
  const entry = (value.timeline?.entries || [])
    .filter((e) => !e.deletedAt && e.kind !== 'automatic')
    .reverse()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  return {
    snapshotName: entry?.name || '스냅샷 없음',
    commentCount: Object.values(value.annotations || {}).filter(
      (text) => typeof text === 'string' && text.trim(),
    ).length,
  };
}
