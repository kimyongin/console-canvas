// Captures are immutable; edits and lightweight recent-document metadata are separate.
export const DATABASE_NAME = 'console-canvas-workspace';
export let workspaceReset = false;
export async function database() {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 2);
    request.onupgradeneeded = (event) => {
      workspaceReset = event.oldVersion > 0;
      // 2026-11-01: user explicitly waived all legacy test documents; no migration.
      for (const name of [...request.result.objectStoreNames])
        request.result.deleteObjectStore(name);
      request.result
        .createObjectStore('tickets', { keyPath: 'id' })
        .createIndex('project_id', 'project_id');
      request.result.createObjectStore('operations', { keyPath: 'id' });
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
export async function transact(stores, mode, action) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () =>
        reject(tx.failure || tx.error || new Error('저장 작업이 중단되었습니다.'));
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
  const keys = [
    'format',
    'version',
    'id',
    'capturedAt',
    'source',
    'html',
    'nodes',
    'warnings',
    'assets',
    'screenshot',
    'captureScope',
    'capture_status',
    'captureStatus',
    'issues',
    'captureReport',
    'screenshotTiles',
    'title',
    'assetReport',
  ];
  return Object.fromEntries(
    keys.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]),
  );
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
        viewport: capture.source.viewport,
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
    activity = [],
    activityHead = null,
    note = '',
    layerNames = {},
    updatedAt = new Date().toISOString(),
    documentName,
    project_id,
    resourceRepairs = [],
  } = value;
  const session = {
    edits,
    annotations,
    activity,
    activityHead,
    note,
    layerNames,
    updatedAt,
    project_id,
    resourceRepairs,
  };
  return transact(['sessions', 'documents'], 'readwrite', (tx) => {
    const metadata = tx.objectStore('documents'),
      request = metadata.get(id);
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
        updatedAt,
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
  return transact(['documents', 'sessions'], 'readonly', (tx, done) => {
    const result = [];
    const request = tx.objectStore('documents').index('updatedAt').openCursor(null, 'prev');
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || result.length >= limit) return done(result);
      if (!!cursor.value.deletedAt === deleted) {
        const value = cursor.value;
        result.push(value);
        if (value.commentCount === undefined) {
          const read = tx.objectStore('sessions').get(value.id);
          read.onsuccess = () => {
            if (read.result) Object.assign(value, documentSummary(read.result));
          };
        }
      }
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
  return {
    project_id: value.project_id || '',
    commentCount: Object.values(value.annotations || {}).filter(
      (t) => typeof t === 'string' && t.trim(),
    ).length,
  };
}
