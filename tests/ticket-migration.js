// The approved 0.52 transition resets business data once; subsequent opens preserve new work.
const results = [];
function check(name, passed) {
  results.push({ name, passed: !!passed });
  document.querySelector('#results').textContent = JSON.stringify(results);
  if (!passed) throw Error(name);
}
try {
  await new Promise((ok, no) => {
    const r = indexedDB.deleteDatabase('console-canvas-workspace');
    r.onsuccess = ok;
    r.onerror = no;
  });
  await new Promise((ok, no) => {
    const r = indexedDB.open('console-canvas-workspace', 3);
    r.onupgradeneeded = () => {
      for (const name of ['captures', 'documents', 'sessions', 'tickets', 'operations', 'settings'])
        r.result.createObjectStore(name, { keyPath: 'id' }).add({ id: 'old-business-data' });
    };
    r.onsuccess = () => {
      r.result.close();
      ok();
    };
    r.onerror = no;
  });
  const { database, getDocument, saveCapture, saveSession } = await import('../db.js');
  const { createProject, getProject } = await import('../project-model.js');
  const { getTicket } = await import('../ticket-model.js');
  const db = await database();
  check('v3 resets once into named-project schema v4', db.version === 4);
  db.close();
  check(
    'Old capture and ticket data are actually removed',
    !(await getDocument('old-business-data')) && !(await getTicket('old-business-data')),
  );
  const project = await createProject('재실행 유지'),
    sample = await (await fetch('../sample.uiclone.json')).json();
  sample.id = crypto.randomUUID();
  sample.project_id = project.id;
  await saveCapture(sample);
  await saveSession(sample.id, {
    project_id: project.id,
    annotations: { n1: '새 주석' },
    edits: { n1: { dx: 17, dy: 3 } },
    note: '새 자료는 보존',
  });
  for (let i = 0; i < 3; i++) {
    const again = await database();
    again.close();
  }
  check(
    'Opening the database again never repeats the reset',
    (await getDocument(sample.id)).annotations.n1 === '새 주석' &&
      (await getTicket(sample.id)).project_id === project.id,
  );
  check(
    'New named project persists across database connections',
    (await getProject(project.id)).name === project.name,
  );
  check(
    'New edit geometry and notes remain intact',
    (await getDocument(sample.id)).edits.n1.dx === 17 &&
      (await getDocument(sample.id)).note === '새 자료는 보존',
  );
  document.querySelector('#status').textContent = `PASS ${results.length} checks`;
  document.body.dataset.result = 'pass';
} catch (e) {
  document.querySelector('#status').textContent = 'FAIL ' + e.stack;
  document.body.dataset.result = 'fail';
}
