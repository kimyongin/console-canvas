import { captureFromDocument, transact } from './db.js';
import { validateDocumentInput } from './document-input.js';
import { listTickets, getTicket, projectKey, validateStoredTicket } from './ticket-model.js';
export async function exportDocument(snapshot, point, project_id, { allowPartial = false } = {}) {
  let tickets = [],
    backupWarnings = [];
  try {
    const t = await getTicket(snapshot.id);
    if (t) tickets = [t];
  } catch (e) {
    if (!allowPartial) throw e;
    backupWarnings = ['티켓 저장소를 읽지 못해 현재 편집 화면만 백업했습니다.'];
  }
  return {
    format: 'console-canvas-ticket',
    version: 3,
    capture: captureFromDocument(snapshot),
    session: {
      ...point,
      project_id,
      documentName: snapshot.documentName,
      layerNames: snapshot.layerNames || {},
    },
    tickets,
    ...(backupWarnings.length ? { backupWarnings } : {}),
  };
}
export async function importDocument(value) {
  if (!(
    (value.format === 'console-canvas-ticket' && value.version === 3) ||
    (value.format === 'console-canvas-document' && value.version === 2)
  ))
    throw Error('지원하지 않는 편집 파일입니다.');
  const { capture, session, tickets = [] } = value;
  if (!session) throw Error('편집 내용이 없습니다.');
  validateDocumentInput(
    { ...capture, resourceRepairs: session.resourceRepairs },
    session.edits,
    session.annotations,
  );
  projectKey(session.project_id);
  if (
    !Array.isArray(tickets) ||
    tickets.length > 10000 ||
    typeof session.note !== 'string' ||
    session.note.length > 12000
  )
    throw Error('티켓 파일을 확인해 주세요.');
  if (
    session.documentName != null &&
    (typeof session.documentName !== 'string' ||
      !session.documentName.trim() ||
      session.documentName.length > 120)
  )
    throw Error('티켓 이름을 확인해 주세요.');
  for (const t of tickets) await validateStoredTicket(t, session.project_id, capture.id);
  await transact(
    ['captures', 'documents', 'sessions', 'tickets', 'settings'],
    'readwrite',
    (tx) => {
      const r = tx.objectStore('captures').get(capture.id);
      r.onsuccess = () => {
        if (r.result) {
          tx.failure = Error('이미 있는 티켓입니다. 기존 티켓을 열어 주세요.');
          tx.abort();
          return;
        }
        const sequence = tx.objectStore('settings').get('ticket-sequence');
        sequence.onsuccess = () => {
          let n = sequence.result?.value || 0;
          const rows = tickets.map((t) => ({
            ...t,
            title: t.title || t.goal?.title,
            document_id: t.document_id || t.id,
            goal: t.goal ? { ...t.goal, id: t.goal.id || crypto.randomUUID() } : null,
            display_id: t.display_id || 'CC-' + ++n,
          }));
          if (!rows.some((t) => t.id === capture.id))
            rows.push({
              id: capture.id,
              title: session.documentName || capture.source.title,
              display_id: 'CC-' + ++n,
              document_id: capture.id,
              project_id: session.project_id,
              status: 'draft',
              goal: null,
              revision: 0,
              records: [],
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          for (const t of rows) {
            const id = t.document_id;
            tx.objectStore('tickets').add(t);
            tx.objectStore('captures').add({ ...capture, id });
            tx.objectStore('sessions').add({
              ...session,
              id,
              storage_revision: 0,
              edit_revision: 0,
            });
            tx.objectStore('documents').add({
              id,
              title: t.title,
              url: capture.source.url,
              viewport: capture.source.viewport,
              project_id: t.project_id,
              updatedAt: t.updated_at,
              capturedAt: capture.capturedAt,
            });
            n = Math.max(n, Number(t.display_id?.replace('CC-', '')) || 0);
          }
          tx.objectStore('settings').put({ id: 'ticket-sequence', value: n });
        };
      };
    },
  );
  return { ...capture, ...session, edit_revision: 0, storage_revision: 0 };
}
