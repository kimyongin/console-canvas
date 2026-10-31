// Captures are immutable; edits and lightweight recent-document metadata are separate.
export const DATABASE_NAME = 'console-canvas-workspace';
export let workspaceReset = false;
export async function database() {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 3);
    request.onupgradeneeded = (event) => {
      const db = request.result,
        tx = request.transaction;
      if (event.oldVersion < 2) {
        workspaceReset = event.oldVersion > 0;
        for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name);
        db.createObjectStore('tickets', { keyPath: 'id' }).createIndex('project_id', 'project_id');
        db.createObjectStore('operations', { keyPath: 'id' });
        db.createObjectStore('captures', { keyPath: 'id' });
        db.createObjectStore('sessions', { keyPath: 'id' });
        db.createObjectStore('documents', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
      }
      db.createObjectStore('settings', { keyPath: 'id' });
      if (event.oldVersion === 2) {
        const values = {};
        for (const name of ['tickets', 'documents', 'captures', 'sessions']) {
          const r = tx.objectStore(name).getAll();
          r.onsuccess = () => {
            values[name] = r.result;
            if (Object.keys(values).length !== 4) return;
            let sequence = 0;
            for (const ticket of values.tickets) {
              const original = values.captures.find((c) => c.id === ticket.goal.document_id);
              const session = values.sessions.find((c) => c.id === ticket.goal.document_id);
              const meta = values.documents.find((c) => c.id === ticket.goal.document_id);
              const t = {
                ...ticket,
                title: ticket.goal.title,
                display_id: 'CC-' + ++sequence,
                document_id: ticket.id,
                goal: { ...ticket.goal, id: crypto.randomUUID() },
                legacy_workspace: true,
                deletedAt: meta?.deletedAt || null,
              };
              tx.objectStore('tickets').put(t);
              if (original) {
                tx.objectStore('captures').put({ ...original, id: t.id });
                tx.objectStore('sessions').put({ ...session, id: t.id, storage_revision: 0 });
                tx.objectStore('documents').put({
                  ...meta,
                  id: t.id,
                  title: t.title,
                  project_id: t.project_id,
                });
              }
            }
            for (const meta of values.documents) {
              const session = values.sessions.find((c) => c.id === meta.id);
              const t = {
                id: meta.id,
                display_id: 'CC-' + ++sequence,
                title: meta.title,
                document_id: meta.id,
                project_id: session?.project_id || meta.project_id || 'local-project',
                status: 'draft',
                revision: 0,
                goal: null,
                records: [],
                created_at: meta.capturedAt || meta.updatedAt,
                updated_at: meta.updatedAt,
                deletedAt: meta.deletedAt || null,
              };
              tx.objectStore('tickets').put(t);
            }
            tx.objectStore('settings').put({ id: 'ticket-sequence', value: sequence });
          };
        }
      }
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
  return transact(['captures', 'documents', 'tickets', 'settings'], 'readwrite', (tx, done) => {
    const store = tx.objectStore('captures');
    const request = store.getKey(capture.id);
    request.onsuccess = () => {
      if (request.result !== undefined) {
        const read = store.get(capture.id);
        read.onsuccess = () => {
          if (read.result.source?.empty && !capture.source.empty) {
            store.put(capture);
            done(true);
          } else done(false);
        };
        return;
      }
      store.add(capture);
      const seq = tx.objectStore('settings').get('ticket-sequence');
      seq.onsuccess = () => {
        const n = (seq.result?.value || 0) + 1;
        tx.objectStore('settings').put({ id: 'ticket-sequence', value: n });
        tx.objectStore('tickets').put({
          id: capture.id,
          display_id: 'CC-' + n,
          document_id: capture.id,
          title: value.documentName || capture.source.title,
          project_id: value.project_id || sourceProject(capture.source.url),
          goal: null,
          status: 'draft',
          revision: 0,
          records: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      };
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
  return transact(['sessions', 'documents', 'tickets', 'operations'], 'readwrite', (tx, done) => {
    const metadata = tx.objectStore('documents'),
      request = metadata.get(id);
    request.onsuccess = () => {
      if (!request.result || request.result.deletedAt) {
        tx.abort();
        return;
      }
      const readSession = tx.objectStore('sessions').get(id);
      readSession.onsuccess = () => {
        const old = readSession.result;
        if (
          value.expected_storage_revision !== undefined &&
          (old?.storage_revision || 0) !== value.expected_storage_revision &&
          old?.writer_id !== value.writer_id
        ) {
          tx.failure = Object.assign(
            new Error('다른 편집기에서 변경했습니다. 최신 티켓을 다시 열어 주세요.'),
            { code: 'revision_conflict' },
          );
          tx.abort();
          return;
        }
        const storage_revision = (old?.storage_revision || 0) + 1;
        tx.objectStore('sessions').put({
          ...session,
          id,
          edit_revision: value.edit_revision || 0,
          storage_revision,
          writer_id: value.writer_id,
          undo: value.undo || [],
          redo: value.redo || [],
          selection: value.selection || [],
        });
        if (value.operation_receipt)
          tx.objectStore('operations').put({
            ...value.operation_receipt,
            result: {
              ok: true,
              persisted: true,
              ticket_id: id,
              revision: value.edit_revision,
              screen: { document_id: id, revision: value.edit_revision, project_id },
            },
          });
        done(storage_revision);
        const tr = tx.objectStore('tickets').get(id);
        tr.onsuccess = () => {
          if (tr.result)
            tx.objectStore('tickets').put({
              ...tr.result,
              title: documentName || tr.result.title,
              project_id: tr.result.goal
                ? tr.result.project_id
                : project_id || tr.result.project_id,
              updated_at: updatedAt,
            });
        };
      };
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
  return transact(['documents', 'tickets'], 'readwrite', (tx, done) => {
    const store = tx.objectStore('documents'),
      request = store.get(id);
    request.onsuccess = () => {
      if (!request.result) {
        tx.abort();
        return;
      }
      const next = { ...request.result, ...patch, updatedAt: new Date().toISOString() };
      store.put(next);
      const r = tx.objectStore('tickets').get(id);
      r.onsuccess = () => {
        if (r.result)
          tx.objectStore('tickets').put({
            ...r.result,
            ...(patch.title ? { title: patch.title } : {}),
            ...('deletedAt' in patch ? { deletedAt: patch.deletedAt } : {}),
            updated_at: next.updatedAt,
          });
      };
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

export function sourceProject(url) {
  try {
    const u = new URL(url);
    return u.origin === 'null' ? 'local-project' : u.origin;
  } catch {
    return 'local-project';
  }
}
export async function setProjectAccess(project_id, allowed) {
  return transact(['settings'], 'readwrite', (tx) =>
    tx.objectStore('settings').put({ id: 'access:' + project_id, allowed: !!allowed }),
  );
}
export async function sharedProjects() {
  return transact(['settings'], 'readonly', (tx, done) => {
    const r = tx.objectStore('settings').getAll();
    r.onsuccess = () =>
      done(
        r.result.filter((v) => v.id.startsWith('access:') && v.allowed).map((v) => v.id.slice(7)),
      );
  });
}

export async function editReceipt(id, hash) {
  return transact(['operations'], 'readonly', (tx, done) => {
    const r = tx.objectStore('operations').get(id);
    r.onsuccess = () => {
      if (r.result && r.result.hash !== hash) {
        tx.failure = Object.assign(Error('다른 요청에 사용한 작업 ID입니다.'), {
          code: 'operation_id_reused',
        });
        tx.abort();
      } else done(r.result?.result);
    };
  });
}
