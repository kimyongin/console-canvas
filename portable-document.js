import { captureFromDocument, transact } from './db.js';
import { validateDocumentInput } from './document-input.js';
import { listTickets, getTicket, projectKey, validateStoredTicket } from './ticket-model.js';
export async function exportDocument(snapshot, point, project_id, { allowPartial = false } = {}) {
  let tickets = [],
    backupWarnings = [];
  try {
    const rows = await listTickets(project_id, { limit: 10000 });
    tickets = (
      await Promise.all(
        rows.tickets
          .filter((t) => t.document_id === snapshot.id)
          .map((t) => getTicket(t.id, project_id)),
      )
    ).filter(Boolean);
  } catch (error) {
    if (!allowPartial) throw error;
    backupWarnings = [
      '티켓 저장소를 읽지 못해 현재 편집 화면만 백업했습니다. 티켓은 포함되지 않았습니다.',
    ];
  }
  return {
    format: 'console-canvas-document',
    version: 2,
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
  if (value.format !== 'console-canvas-document' || value.version !== 2)
    throw Error('지원하지 않는 편집 파일입니다. 새 문서를 가져와 주세요.');
  const { capture, session, tickets = [] } = value;
  validateDocumentInput(
    { ...capture, resourceRepairs: session.resourceRepairs },
    session.edits,
    session.annotations,
  );
  projectKey(session.project_id);
  if (!Array.isArray(tickets) || tickets.length > 10000)
    throw Error('티켓 목록 형식을 확인해 주세요.');
  if (typeof session.note !== 'string' || session.note.length > 12000)
    throw Error('추가 설명을 확인해 주세요.');
  if (
    session.documentName != null &&
    (typeof session.documentName !== 'string' ||
      session.documentName.length > 120 ||
      !session.documentName.trim())
  )
    throw Error('문서 이름을 확인해 주세요.');
  for (const t of tickets) await validateStoredTicket(t, session.project_id, capture.id);
  // One transaction: a failed/conflicting import cannot partially replace work.
  await transact(['captures', 'documents', 'sessions', 'tickets'], 'readwrite', (tx) => {
    const store = tx.objectStore('captures'),
      read = store.get(capture.id);
    read.onsuccess = () => {
      if (read.result) {
        tx.failure = new Error('이미 있는 문서입니다. 목록에서 기존 문서를 열어 주세요.');
        tx.abort();
        return;
      }
      store.add(capture);
      tx.objectStore('sessions').add({ ...session, id: capture.id });
      tx.objectStore('documents').add({
        id: capture.id,
        title: session.documentName || capture.source.title,
        url: capture.source.url,
        viewport: capture.source.viewport,
        project_id: session.project_id,
        updatedAt: new Date().toISOString(),
        commentCount: Object.keys(session.annotations || {}).length,
      });
      for (const t of tickets) tx.objectStore('tickets').add(t);
    };
  });
  return { ...capture, ...session };
}
