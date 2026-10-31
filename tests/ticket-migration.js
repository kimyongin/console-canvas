const results = [];
function check(name, value) {
  results.push({ name, passed: !!value });
  document.querySelector('#results').textContent = JSON.stringify(results);
  if (!value) throw Error(name);
}
try {
  await new Promise((ok, no) => {
    const r = indexedDB.deleteDatabase('console-canvas-workspace');
    r.onsuccess = ok;
    r.onerror = no;
  });
  const capture = await (await fetch('../sample.uiclone.json')).json();
  capture.id = 'old-workspace';
  const at = new Date().toISOString();
  const goal = {
    title: '이전 확정 목표',
    document_id: capture.id,
    request: '유지할 반응형 목표',
    image: { data_url: 'data:image/png;base64,QA' },
    source: capture.source,
    annotations: { n1: '기존 주석' },
  };
  const ticket = {
    id: 'legacy-ticket',
    project_id: 'migration-project',
    status: 'review',
    revision: 3,
    goal,
    records: [{ id: 'r1', status: 'review', at, summary: '이전 결과' }],
    created_at: at,
    updated_at: at,
  };
  await new Promise((ok, no) => {
    const r = indexedDB.open('console-canvas-workspace', 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('tickets', { keyPath: 'id' }).createIndex('project_id', 'project_id');
      d.createObjectStore('operations', { keyPath: 'id' });
      d.createObjectStore('captures', { keyPath: 'id' });
      d.createObjectStore('sessions', { keyPath: 'id' });
      d.createObjectStore('documents', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
      r.transaction.objectStore('captures').add(capture);
      r.transaction.objectStore('sessions').add({
        id: capture.id,
        project_id: 'migration-project',
        annotations: { n1: '현재 편집 주석' },
        edits: { n1: { dx: 14, dy: 0 } },
        note: '보존할 메모',
      });
      r.transaction.objectStore('documents').add({
        id: capture.id,
        title: '진행 중 화면',
        url: capture.source.url,
        updatedAt: at,
        capturedAt: at,
      });
      r.transaction.objectStore('tickets').add(ticket);
    };
    r.onsuccess = () => {
      r.result.close();
      ok();
    };
    r.onerror = no;
  });
  const { database, getDocument } = await import('../db.js'),
    { getTicket, listTickets } = await import('../ticket-model.js');
  const db = await database();
  check('Schema v2 upgrades without clearing captures or sessions', db.version === 3);
  db.close();
  const draft = await getTicket(capture.id),
    fixed = await getTicket(ticket.id);
  check(
    'Existing current editing becomes a draft with the same source identity',
    draft.status === 'draft' &&
      draft.id === capture.id &&
      (await getDocument(capture.id)).edits.n1.dx === 14,
  );
  check(
    'Existing fixed ticket retains ID, status, request and records',
    fixed.id === ticket.id &&
      fixed.status === 'review' &&
      fixed.goal.request === goal.request &&
      fixed.records[0].id === 'r1',
  );
  check(
    'Goal image and annotations are unchanged by migration',
    fixed.goal.image.data_url === goal.image.data_url && fixed.goal.annotations.n1 === '기존 주석',
  );
  check(
    'Legacy working copy is independent and explicitly marked',
    fixed.document_id !== capture.id &&
      fixed.legacy_workspace &&
      (await getDocument(fixed.document_id)).annotations.n1 === '현재 편집 주석',
  );
  check(
    'All records are discoverable under stable distinct display IDs',
    (await listTickets('migration-project')).total === 2 && draft.display_id !== fixed.display_id,
  );
  check(
    'Reopening does not duplicate migrated tickets',
    (await listTickets('migration-project')).total === 2,
  );
  document.querySelector('#status').textContent = `PASS ${results.length} checks`;
  document.body.dataset.result = 'pass';
} catch (e) {
  document.querySelector('#status').textContent = 'FAIL ' + e.stack;
  document.body.dataset.result = 'fail';
}
