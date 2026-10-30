const frame = document.querySelector('#editor'),
  results = [];
function check(name, passed) {
  results.push({ name, passed: !!passed });
  document.querySelector('#results').textContent = JSON.stringify(results);
  if (!passed) throw Error(name);
}
async function until(read) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (await read()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw Error('Timed out');
}
try {
  await until(() => frame.contentWindow.ConsoleCanvas?.state.ready);
  const app = frame.contentWindow.ConsoleCanvas,
    doc = frame.contentDocument;
  check(
    'Chrome installation and WebMCP publishing controls are absent',
    !doc.querySelector('#webmcp-enable') &&
      !doc.body.textContent.includes('Chrome 확장 프로그램 설치'),
  );
  const snapshot = structuredClone(app.state.snapshot);
  snapshot.id = 'capture-status-regression';
  const node = snapshot.nodes.find((n) => n.locator?.id === 'new-customer');
  snapshot.warnings = [
    { type: 'capture_limit', message: '문서 하단은 촬영하지 못했습니다.' },
    { type: 'assets', id: node.id, message: '외부 폰트를 확인하세요.' },
  ];
  const before = JSON.stringify(snapshot);
  await app.openSnapshot(snapshot);
  doc.querySelector('#capture-status-button').click();
  check(
    'Collection limits are accessible outside the element inspector',
    doc.querySelector('#capture-status-dialog').open &&
      !doc.querySelector('#properties-dialog').open,
  );
  check(
    'Limits explain their actual scope',
    doc.querySelector('#capture-status-list').textContent.includes('하단') &&
      doc.querySelector('#capture-status-scope').textContent.includes('원본 화면'),
  );
  check(
    'No fabricated visual score is displayed',
    doc.querySelector('#capture-info-view').textContent.includes('일치율은 측정하지 않았습니다') &&
      !/95%|100%/.test(doc.querySelector('#capture-info-view').textContent),
  );
  const controller = await app.controller.execute({
    name: 'get_screen',
    document_id: snapshot.id,
    arguments: { editor_id: app.controller.metadata().editor_id },
    deadline: Date.now() / 1000 + 10,
  });
  check(
    'MCP explicitly reports visual comparison not measured',
    controller.screen?.capture_status?.visual_comparison === 'not_measured' &&
      controller.screen?.capture_status.issue_count === 2,
  );
  doc.querySelector('#capture-status-list button').click();
  check(
    'Issue action closes modal and selects the actual target',
    !doc.querySelector('#capture-status-dialog').open && app.state.scene.selected === node.id,
  );
  check(
    'Reading evidence preserves capture nodes and warnings',
    JSON.stringify(app.state.snapshot.nodes) === JSON.stringify(JSON.parse(before).nodes) &&
      JSON.stringify(app.state.snapshot.warnings) === JSON.stringify(JSON.parse(before).warnings),
  );
  window.testResult = { passed: results.length, failed: 0, total: results.length };
  document.querySelector('#status').textContent = JSON.stringify(window.testResult);
  document.body.dataset.result = 'pass';
} catch (error) {
  document.querySelector('#status').textContent = 'FAIL ' + error.stack;
  document.body.dataset.result = 'fail';
  window.testResult = {
    passed: results.filter((r) => r.passed).length,
    failed: 1,
    results,
    error: error.message,
  };
}
