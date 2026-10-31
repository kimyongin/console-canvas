const checks = [];
function check(name, value) {
  checks.push({ name, passed: !!value });
  document.querySelector('#results').textContent = JSON.stringify(checks);
  if (!value) throw Error(name);
}
try {
  await new Promise((ok, no) => {
    const r = indexedDB.deleteDatabase('console-canvas-workspace');
    r.onsuccess = ok;
    r.onerror = no;
  });
  await new Promise((ok, no) => {
    const r = indexedDB.open('console-canvas-workspace', 1);
    r.onupgradeneeded = () => {
      for (const name of ['captures', 'sessions', 'documents'])
        r.result
          .createObjectStore(name, { keyPath: 'id' })
          .add({ id: 'disposable-legacy', timeline: { entries: ['old-test-branch'] } });
    };
    r.onsuccess = () => {
      r.result.close();
      ok();
    };
    r.onerror = no;
  });
  const frame = document.querySelector('#editor');
  frame.src = '../editor.html?sample=1';
  await new Promise((r) => frame.addEventListener('load', r, { once: true }));
  const end = Date.now() + 30000;
  while (!frame.contentWindow.ConsoleCanvas?.state.ready) {
    if (Date.now() > end) throw Error('reset editor timeout');
    await new Promise((r) => setTimeout(r, 50));
  }
  const db = await (await import('../db.js')).database();
  check('Disposable v1 becomes current v2', db.version === 2);
  check(
    'Only current stores exist',
    JSON.stringify([...db.objectStoreNames]) ===
      JSON.stringify(['captures', 'documents', 'operations', 'sessions', 'tickets']),
  );
  const old = await new Promise((ok, no) => {
    const r = db.transaction(['captures']).objectStore('captures').get('disposable-legacy');
    r.onsuccess = () => ok(r.result);
    r.onerror = no;
  });
  check('Explicitly waived test work is actually removed', !old);
  db.close();
  check(
    'New editing is ready without legacy state',
    frame.contentWindow.ConsoleCanvas.state.scene.nodes.size > 300 &&
      !frame.contentWindow.ConsoleCanvas.state.timeline,
  );
  document.querySelector('#status').textContent = `PASS ${checks.length} checks`;
  document.body.dataset.result = 'pass';
} catch (e) {
  document.querySelector('#status').textContent = 'FAIL ' + e.message;
  document.body.dataset.result = 'fail';
}
