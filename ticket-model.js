import { transact } from './db.js';
export const TICKET_STATES = {
  queued: '구현 대기',
  working: '작업 중',
  review: '검토 대기',
  done: '완료',
  blocked: '확인 필요',
};
function invalid(message, code = 'invalid_ticket') {
  const e = new Error(message);
  e.code = code;
  throw e;
}
function text(value, label, max = 12000, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    invalid(label + '을 확인해 주세요.');
  return value.trim();
}
export function projectKey(value) {
  return text(value, '프로젝트', 300);
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, stable(value[k])]),
    );
  return value;
}
async function fingerprint(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(stable(value)));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export async function ticketImage(value) {
  if (
    typeof value !== 'string' ||
    value.length > 16_000_000 ||
    !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
    invalid('12MB 이하의 PNG·JPEG·WebP 이미지를 사용해 주세요.', 'invalid_image');
  const [header, encoded] = value.split(',');
  let raw;
  try {
    raw = atob(encoded);
  } catch {
    invalid('이미지 인코딩이 올바르지 않습니다.', 'invalid_image');
  }
  const png = raw.startsWith('\x89PNG\r\n\x1a\n'),
    jpeg = raw.startsWith('\xff\xd8\xff'),
    webp = raw.startsWith('RIFF') && raw.slice(8, 12) === 'WEBP';
  if (!(
    (header.includes('/png') && png) ||
    (header.includes('/jpeg') && jpeg) ||
    (header.includes('/webp') && webp)
  ))
    invalid('실제 이미지 형식을 확인해 주세요.', 'invalid_image');
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  let width, height;
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: header.slice(5, header.indexOf(';')) }),
      );
      width = bitmap.width;
      height = bitmap.height;
      bitmap.close();
    } catch {
      invalid('이미지를 읽을 수 없습니다.', 'invalid_image');
    }
    if (!width || !height || width * height > 80_000_000)
      invalid('이미지 표시 크기를 확인해 주세요.', 'invalid_image');
  }
  return { data_url: value, ...(width ? { width, height } : {}) };
}
function operation(value) {
  return text(value, '작업 ID', 160);
}
function metadata(value, label) {
  if (!value || typeof value !== 'object' || JSON.stringify(value).length > 200000)
    invalid(label + ' 크기 또는 형식을 확인해 주세요.');
  return structuredClone(value);
}
export async function validateStoredTicket(t, project_id, document_id) {
  if (
    !t ||
    t.project_id !== project_id ||
    t.goal?.document_id !== document_id ||
    !Object.hasOwn(TICKET_STATES, t.status) ||
    !Number.isInteger(t.revision) ||
    t.revision < 0 ||
    !Array.isArray(t.records) ||
    t.records.length > 1000
  )
    invalid('티켓 정보를 확인해 주세요.');
  text(t.id, '티켓 ID', 200);
  text(t.goal.title, '티켓 이름', 120);
  text(t.goal.request, '변경 요청');
  if (!Number.isFinite(Date.parse(t.created_at)) || !Number.isFinite(Date.parse(t.updated_at)))
    invalid('티켓 날짜를 확인해 주세요.');
  await ticketImage(t.goal.image?.data_url);
  metadata(t.goal.source || {}, '출처');
  metadata(t.goal.annotations || {}, '주석');
  metadata(t.goal.selection || [], '선택');
  const seen = new Set();
  for (const r of t.records) {
    if (
      !r ||
      seen.has(r.id) ||
      !Object.hasOwn(TICKET_STATES, r.status) ||
      !Number.isFinite(Date.parse(r.at))
    )
      invalid('작업 기록을 확인해 주세요.');
    text(r.id, '기록 ID', 200);
    seen.add(r.id);
    text(r.summary, '작업 기록', 6000);
    if (r.image) await ticketImage(r.image.data_url);
    if (r.checks) text(r.checks, '검증 결과', 6000);
  }
  return t;
}
function now() {
  return new Date().toISOString();
}
export async function ticketReceipt(project_id, operation_id, payload) {
  const key = 'register:' + projectKey(project_id) + ':' + operation(operation_id),
    hash = await fingerprint(payload);
  return transact(['tickets', 'operations'], 'readonly', (tx, done) => {
    const r = tx.objectStore('operations').get(key);
    r.onsuccess = () => {
      if (!r.result) return done(null);
      if (r.result.hash !== hash) {
        tx.failure = Object.assign(new Error('다른 요청에서 사용한 작업 ID입니다.'), {
          code: 'operation_id_reused',
        });
        tx.abort();
        return;
      }
      const read = tx.objectStore('tickets').get(r.result.ticket_id);
      read.onsuccess = () => done(read.result);
    };
  });
}
async function mutate(key, payload, work) {
  const hash = await fingerprint(payload);
  return transact(['tickets', 'operations'], 'readwrite', (tx, done) => {
    const request = tx.objectStore('operations').get(key);
    request.onsuccess = () => {
      if (request.result) {
        if (request.result.hash !== hash) {
          tx.failure = Object.assign(new Error('다른 요청에서 사용한 작업 ID입니다.'), {
            code: 'operation_id_reused',
          });
          tx.abort();
          return;
        }
        const read = tx.objectStore('tickets').get(request.result.ticket_id);
        read.onsuccess = () => done(read.result);
        return;
      }
      work(tx, (result) => {
        tx.objectStore('operations').put({ id: key, hash, ticket_id: result.id });
        done(result);
      });
    };
  });
}
export async function registerTicket(input) {
  const project_id = projectKey(input.project_id),
    op = operation(input.operation_id);
  const goal = {
    image: await ticketImage(input.image_data_url),
    request: text(input.request, '변경 요청'),
    title: text(input.title, '티켓 이름', 120),
    document_id: text(input.document_id, '대상 문서', 200),
    source: metadata(input.source || {}, '출처'),
    annotations: metadata(input.annotations || {}, '주석'),
    selection: metadata(input.selection || [], '선택'),
  };
  if (input.selection_confirmed !== true)
    invalid('사람이 확정한 목표만 등록할 수 있습니다.', 'selection_required');
  const payload = input.operation_payload || { project_id, goal };
  return mutate('register:' + project_id + ':' + op, payload, (tx, done) => {
    const ticket = {
      id: crypto.randomUUID(),
      project_id,
      goal,
      status: 'queued',
      revision: 0,
      created_at: now(),
      updated_at: now(),
      records: [],
    };
    tx.objectStore('tickets').add(ticket);
    done(ticket);
  });
}
/** @param {string} project_id @param {{status?:string,limit?:number,offset?:number}} options */
export async function listTickets(project_id, { status, limit = 100, offset = 0 } = {}) {
  project_id = projectKey(project_id);
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 10000 ||
    !Number.isInteger(offset) ||
    offset < 0
  )
    invalid('목록 범위를 확인해 주세요.');
  if (status && !Object.hasOwn(TICKET_STATES, status)) invalid('티켓 상태를 확인해 주세요.');
  return transact(['tickets'], 'readonly', (tx, done) => {
    const req = tx.objectStore('tickets').index('project_id').getAll(project_id);
    req.onsuccess = () => {
      const rows = req.result
        .filter((t) => !status || t.status === status)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      done({
        total: rows.length,
        tickets: rows.slice(offset, offset + limit).map(({ goal, records, ...t }) => ({
          ...t,
          title: goal.title,
          request: goal.request,
          document_id: goal.document_id,
          record_count: records.length,
        })),
      });
    };
  });
}
export async function getTicket(id, project_id) {
  project_id = projectKey(project_id);
  return transact(['tickets'], 'readonly', (tx, done) => {
    const r = tx.objectStore('tickets').get(id);
    r.onsuccess = () => done(r.result?.project_id === project_id ? r.result : null);
  });
}
const transitions = {
  queued: ['working', 'blocked'],
  working: ['review', 'blocked', 'queued'],
  review: ['done', 'queued', 'blocked'],
  done: ['queued'],
  blocked: ['working', 'queued'],
};
export function applyTicketUpdate(ticket, patch) {
  if (ticket.revision !== patch.expected_revision)
    invalid('티켓이 변경됐습니다. 최신 상태를 조회해 주세요.', 'ticket_revision_conflict');
  const status = patch.status || ticket.status;
  if (
    !Object.hasOwn(TICKET_STATES, status) ||
    (status !== ticket.status && !transitions[ticket.status].includes(status))
  )
    invalid('허용하지 않는 상태 전환입니다.', 'invalid_transition');
  if (ticket.records.length >= 1000)
    invalid('티켓 기록 보관 한도입니다. 새 티켓에 후속 목표를 정리해 주세요.');
  const summary = text(patch.summary, '작업/검토 기록', 6000);
  if (status === 'working' && status !== ticket.status && !patch.implementation_instruction?.trim())
    invalid('사람의 구현 지시를 기록해 주세요.', 'instruction_required');
  if (status === 'review' && status !== ticket.status && (!patch.image || !patch.checks?.trim()))
    invalid('검토를 위해 구현 이미지와 검증 결과가 필요합니다.', 'evidence_required');
  if (
    status === 'done' &&
    status !== ticket.status &&
    (patch.review_decision !== 'approved' || !patch.review_note?.trim())
  )
    invalid('사람의 승인 내용이 필요합니다.', 'approval_required');
  const record = {
    id: crypto.randomUUID(),
    at: now(),
    status,
    summary,
    ...(patch.image ? { image: patch.image } : {}),
    ...(patch.checks ? { checks: text(patch.checks, '검증 결과', 6000) } : {}),
    ...(patch.implementation_instruction
      ? { implementation_instruction: text(patch.implementation_instruction, '구현 지시', 3000) }
      : {}),
    ...(patch.review_decision
      ? {
          review_decision: patch.review_decision,
          review_note: text(patch.review_note, '검토 내용', 3000),
        }
      : {}),
  };
  return {
    ...ticket,
    status,
    revision: ticket.revision + 1,
    updated_at: record.at,
    records: [...ticket.records, record],
  };
}
export async function updateTicket(input) {
  const project_id = projectKey(input.project_id),
    op = operation(input.operation_id);
  const patch = {
    ...input,
    ...(input.implementation_image_data_url
      ? { image: await ticketImage(input.implementation_image_data_url) }
      : {}),
  };
  delete patch.implementation_image_data_url;
  delete patch.operation_id;
  delete patch.editor_id;
  // Validate in the same read/write transaction as the CAS and operation receipt.
  return mutate('update:' + project_id + ':' + op, patch, (tx, done) => {
    const r = tx.objectStore('tickets').get(input.ticket_id);
    r.onsuccess = () => {
      try {
        if (!r.result || r.result.project_id !== project_id)
          invalid('이 프로젝트의 티켓을 찾을 수 없습니다.', 'ticket_not_found');
        const next = applyTicketUpdate(r.result, patch);
        tx.objectStore('tickets').put(next);
        done(next);
      } catch (e) {
        tx.failure = e;
        tx.abort();
      }
    };
  });
}
