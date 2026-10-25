import { getDocument } from '../db.js';
const frame = document.querySelector('#editor'),
  results = [];
function check(name, value) {
  results.push({ name, passed: !!value });
  document.querySelector('#results').textContent = JSON.stringify(results, null, 2);
  if (!value) throw new Error(name);
}
async function until(fn) {
  const end = Date.now() + 25000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('Timed out');
}
try {
  await until(() => frame.contentWindow.ConsoleCanvas?.state.ready);
  let app = frame.contentWindow.ConsoleCanvas,
    doc = frame.contentDocument;
  const click = (q) => doc.querySelector(q).click(),
    node = [...app.state.scene.nodes.values()].find((n) => n.locator.id === 'new-customer');
  check(
    'Right panel contains one history and no property/comment tabs',
    !doc.querySelector('#properties-panel nav') &&
      !doc.querySelector('#tab-inspect') &&
      !doc.querySelector('#tab-comments') &&
      doc.querySelector('#activity-list'),
  );
  app.selectNode(node.id);
  click('#edit-properties');
  doc.querySelector('#offset-x').value = '24';
  doc.querySelector('#offset-x').dispatchEvent(new frame.contentWindow.Event('change'));
  click('#close-properties');
  app.state.scene.setComment(node.id, 'A의 주석');
  check(
    'Property before/after values and comment contents share the same visible history',
    doc.querySelector('#activity-list').textContent.includes('가로 위치 0 → 24') &&
      doc.querySelector('#activity-list').textContent.includes('A의 주석') &&
      !doc.querySelector('#history-panel').hidden,
  );
  async function save(name) {
    click('#snapshots-button');
    doc.querySelector('#snapshot-name').value = name;
    doc.querySelector('#snapshot-form').requestSubmit();
    check(
      'Saving ' + name + ' immediately opens graph and names the toolbar selection',
      doc.querySelector('#snapshot-panel').matches(':popover-open') &&
        doc.querySelector('#snapshot-dropdown').textContent.includes(name),
    );
    await app.state.saving;
    while (app.state.transactionBusy) await new Promise((r) => setTimeout(r, 10));
    const id = app.state.timeline.activeId;
    await until(() => doc.querySelector('#snapshot-preview-view iframe')?.title.includes(name));
    return id;
  }
  const a = await save('A · 기준');
  click('#close-snapshots');
  app.selectNode(node.id);
  app.state.scene.setPosition(48, 0);
  const b = await save('B · 버튼');
  click('#close-snapshots');
  app.state.scene.setPosition(72, 0);
  const c = await save('C · 여백');
  const signature = () =>
    JSON.stringify([
      app.state.scene.edits,
      app.state.scene.annotations,
      app.state.timeline,
      app.state.revision,
      app.state.activity,
    ]);
  const before = signature();
  click(`[data-snapshot-id="${a}"]`);
  await until(() => doc.querySelector('#snapshot-preview-view iframe')?.title.includes('A · 기준'));
  check(
    'Selecting old A updates name and preview while current C remains intact',
    signature() === before &&
      app.state.timeline.activeId === c &&
      app.state.scene.edits[node.id].dx === 72 &&
      doc.querySelector('#snapshot-active-name').textContent.includes('A · 기준'),
  );
  click('#apply-snapshot');
  await app.state.saving;
  while (app.state.transactionBusy) await new Promise((r) => setTimeout(r, 10));
  check(
    'Explicit apply returns to past A with its saved edits and comments',
    app.state.timeline.activeId === a &&
      app.state.scene.edits[node.id].dx === 24 &&
      app.state.scene.annotations[node.id] === 'A의 주석',
  );
  click('#close-snapshots');
  app.selectNode(node.id);
  app.state.scene.setPosition(96, 0);
  const d = await save('D · 대안');
  const entry = (id) => app.state.timeline.entries.find((e) => e.id === id);
  check(
    'A→B→C and A→D are preserved with real parent IDs',
    entry(b).parentId === a && entry(c).parentId === b && entry(d).parentId === a,
  );
  const row = (id) => doc.querySelector(`[data-snapshot-id="${id}"]`).closest('[data-lane]');
  check(
    'Graph draws D on its own lane and directly connects it to A',
    row(d).dataset.lane !== row(c).dataset.lane &&
      row(b).dataset.lane === row(c).dataset.lane &&
      doc.querySelector(`path[data-parent-id="${a}"][data-child-id="${d}"]`) &&
      !doc.querySelector(`path[data-parent-id="${c}"][data-child-id="${d}"]`),
  );
  const rect = (id) => row(id).getBoundingClientRect();
  check(
    'Rendered cards align horizontally within a branch and separate the fork into another row',
    Math.abs(rect(a).top - rect(b).top) < 1 &&
      Math.abs(rect(b).top - rect(c).top) < 1 &&
      Math.abs(rect(d).left - rect(b).left) < 1 &&
      rect(d).top - rect(b).top > 80 &&
      frame.contentWindow.getComputedStyle(row(d)).position === 'absolute',
  );
  const scroll = doc.querySelector('#snapshot-graph-scroll');
  scroll.scrollLeft = 80;
  check(
    'Graph has usable horizontal scrolling',
    scroll.scrollWidth > scroll.clientWidth && scroll.scrollLeft > 0,
  );
  click(`[data-snapshot-id="${c}"]`);
  click('#apply-snapshot');
  await app.state.saving;
  while (app.state.transactionBusy) await new Promise((r) => setTimeout(r, 10));
  check(
    'Future C remains reachable without removing D',
    app.state.timeline.activeId === c && app.state.scene.edits[node.id].dx === 72 && !!entry(d),
  );
  click(`[data-snapshot-id="${d}"]`);
  click('#apply-snapshot');
  await app.state.saving;
  while (app.state.transactionBusy) await new Promise((r) => setTimeout(r, 10));
  check(
    'Parallel D remains reachable with its own geometry',
    app.state.timeline.activeId === d && app.state.scene.edits[node.id].dx === 96,
  );
  click('#close-snapshots');
  click('#toggle-properties');
  check(
    'Unified history collapses to an edge rail with its reopen control',
    doc.querySelector('#properties-panel').hidden &&
      !doc.querySelector('#properties-rail').hidden &&
      doc.querySelector('#properties-rail').contains(doc.querySelector('#toggle-properties')),
  );
  click('#toggle-properties');
  check(
    'History reopens without a tab switch',
    !doc.querySelector('#properties-panel').hidden &&
      doc.querySelector('#properties-panel').contains(doc.querySelector('#toggle-properties')),
  );
  const id = app.state.snapshot.id;
  await app.state.saving;
  while (app.state.transactionBusy) await new Promise((r) => setTimeout(r, 10));
  const persisted = await getDocument(id);
  check(
    'Saved session retains both branch parent IDs',
    persisted.timeline.entries.find((e) => e.id === d).parentId === a &&
      persisted.timeline.entries.find((e) => e.id === c).parentId === b,
  );
  frame.src = '../editor.html?id=' + id;
  await new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  await until(() => frame.contentWindow.ConsoleCanvas?.state.ready);
  app = frame.contentWindow.ConsoleCanvas;
  doc = frame.contentDocument;
  click('#snapshot-dropdown');
  click(`[data-snapshot-id="${c}"]`);
  click('#apply-snapshot');
  await app.state.saving;
  while (app.state.transactionBusy) await new Promise((r) => setTimeout(r, 10));
  check(
    'App-page restart preserves graph and past/future navigation',
    app.state.timeline.activeId === c &&
      app.state.scene.edits[node.id].dx === 72 &&
      app.state.timeline.entries.find((e) => e.id === d).parentId === a,
  );
  document.querySelector('#status').textContent = JSON.stringify({
    passed: results.length,
    failed: 0,
    total: results.length,
  });
  document.body.dataset.result = 'pass';
} catch (error) {
  document.querySelector('#status').textContent = 'FAILED: ' + error.stack;
  document.body.dataset.result = 'fail';
}
