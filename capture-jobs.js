import { transact, getDocument, saveCapture } from './db.js';
import { getProject } from './project-model.js';

const key = (id) => 'capture-job:' + id;
export function readCaptureJob(id) {
  return transact(['settings'], 'readonly', (tx, done) => {
    const read = tx.objectStore('settings').get(key(id));
    read.onsuccess = () => done(read.result?.value || null);
  });
}
export async function beginCaptureJob(request) {
  if (
    !/^[0-9a-f-]{36}$/i.test(request.id || '') ||
    !Number.isInteger(request.tab_id) ||
    !['viewport', 'document', 'region'].includes(request.scope?.mode) ||
    !(await getProject(request.project_id))
  )
    throw Error('가져올 화면과 프로젝트를 확인해 주세요.');
  const fingerprint = JSON.stringify([
    request.tab_id,
    request.url,
    request.project_id,
    request.scope,
    request.source_document_id,
  ]);
  return transact(['settings'], 'readwrite', (tx, done) => {
    const store = tx.objectStore('settings'),
      prior = store.get(key(request.id));
    prior.onsuccess = () => {
      if (prior.result) {
        if (prior.result.value.fingerprint !== fingerprint) {
          tx.failure = Error('다른 가져오기에 사용한 요청 ID입니다.');
          tx.abort();
          return;
        }
        done(prior.result.value);
        return;
      }
      const read = store.get('active-capture-job');
      read.onsuccess = () => {
        const current = read.result?.value;
        if (current?.stage === 'running') {
          tx.failure = Error('화면을 가져오고 있습니다. 완료하거나 취소한 뒤 다시 시도해 주세요.');
          tx.abort();
          return;
        }
        const job = {
          ...request,
          fingerprint,
          stage: 'running',
          created_at: new Date().toISOString(),
        };
        store.put({ id: key(job.id), value: job });
        store.put({ id: 'active-capture-job', value: job });
        done(job);
      };
    };
  });
}
export function finishCaptureJob(job, patch) {
  return transact(['settings'], 'readwrite', (tx, done) => {
    const store = tx.objectStore('settings'),
      read = store.get(key(job.id));
    read.onsuccess = () => {
      const next = {
        ...(read.result?.value || job),
        ...patch,
        updated_at: new Date().toISOString(),
      };
      store.put({ id: key(job.id), value: next });
      const active = store.get('active-capture-job');
      active.onsuccess = () => {
        if (active.result?.value?.id === job.id)
          store.put({ id: 'active-capture-job', value: next });
        done(next);
      };
    };
  });
}
export async function persistCapturedTicket(snapshot, job) {
  if (snapshot.source.url !== job.url) throw Error('가져오는 동안 원본 페이지가 변경되었습니다.');
  // The durable request ID is also the immutable capture ID: response loss cannot allocate a second ticket.
  const value = {
    ...snapshot,
    id: job.id,
    project_id: job.project_id,
    source: {
      ...snapshot.source,
      extension: {
        tab_id: job.tab_id,
        session_id: job.session_id,
        ...(job.source_document_id ? { document_id: job.source_document_id } : {}),
      },
    },
  };
  await saveCapture(value);
  const saved = await getDocument(job.id);
  if (!saved || saved.project_id !== job.project_id)
    throw Error('가져온 화면 저장을 확인하지 못했습니다.');
  return finishCaptureJob(job, { stage: 'complete', ticket_id: job.id });
}
export async function recoverCaptureJob() {
  const job = await transact(['settings'], 'readonly', (tx, done) => {
    const r = tx.objectStore('settings').get('active-capture-job');
    r.onsuccess = () => done(r.result?.value || null);
  });
  if (job?.stage !== 'running') return job;
  const saved = await getDocument(job.id);
  return finishCaptureJob(
    job,
    saved
      ? { stage: 'complete', ticket_id: job.id }
      : {
          stage: 'interrupted',
          error: '화면 가져오기가 중단되었습니다. 원본에서 다시 가져와 주세요.',
        },
  );
}
