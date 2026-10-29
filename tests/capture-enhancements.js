import { buildCapturedPhoto, coveredArea } from '../capture-reference.js';
import { prepareCaptureScope, renderScope } from '../capture-scope.js';
import { resourceCandidates, validateResourcePatch, decodeResource } from '../resource-repair.js';
import { buildCodeDocument } from '../code-patches.js';
import { renderPng } from '../export.js';
const results = [],
  frame = document.querySelector('#editor');
function check(name, passed) {
  results.push({ name, passed: !!passed });
  document.querySelector('#results').textContent = JSON.stringify(results);
  if (!passed) throw Error(name);
}
async function until(fn) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw Error('Timed out');
}
try {
  await until(() => frame.contentWindow.ConsoleCanvas?.state.ready);
  const app = frame.contentWindow.ConsoleCanvas,
    doc = frame.contentDocument,
    win = frame.contentWindow;
  check(
    'Coverage counts overlapping tiles only once',
    coveredArea([
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 50, y: 0, width: 100, height: 100 },
    ]) === 15000,
  );
  const snapshot = structuredClone(app.state.snapshot);
  snapshot.id = 'capture-enhancements-qa';
  const canvas = document.createElement('canvas');
  canvas.width = 100;
  canvas.height = 100;
  canvas.getContext('2d').fillRect(0, 0, 100, 100);
  const png = canvas.toDataURL();
  snapshot.screenshot = png;
  snapshot.screenshotTiles = [{ data: png, rect: { x: 0, y: 0, width: 100, height: 100 } }];
  snapshot.warnings = [
    { type: 'capture_limit', message: '미촬영 범위' },
    { type: 'raster', message: '개별 편집 불가' },
    { type: 'shadow', message: '구조 변환 참고' },
  ];
  const original = JSON.stringify(snapshot);
  await app.openSnapshot(snapshot);
  doc.querySelector('#capture-status-button').click();
  check(
    'Evidence is grouped into loss, constraint and information',
    doc.querySelectorAll('.capture-issue-group').length === 3,
  );
  doc.querySelector('#source-compare-button').click();
  await until(() => doc.querySelector('#source-compare-clone iframe'));
  check(
    'Actual photo and before-copy are named separately',
    doc.querySelector('#source-compare-dialog').open &&
      doc.querySelector('#source-compare-clone-label').textContent === '편집 전 복제본',
  );
  check(
    'Partial photo honestly reports coverage',
    doc.querySelector('#source-compare-status').textContent.includes('사진이 없는 범위') &&
      !doc.querySelector('#source-compare-status').textContent.includes('100.0%'),
  );
  doc.querySelector('#source-compare-mode').value = 'overlay';
  doc.querySelector('#source-compare-mode').dispatchEvent(new Event('change'));
  check(
    'Overlay includes adjustable clone opacity',
    doc.querySelector('#source-compare-grid').classList.contains('overlay') &&
      !doc.querySelector('#source-compare-blend-label').hidden,
  );
  doc.querySelector('#source-compare-dialog').close();
  check('Comparing never mutates saved capture', JSON.stringify(snapshot) === original);
  const target = snapshot.nodes.find((n) => n.locator.id === 'new-customer'),
    rect = {
      x: target.rect.x - 8,
      y: target.rect.y - 8,
      width: target.rect.width + 16,
      height: target.rect.height + 16,
    };
  const scoped = {
    ...structuredClone(snapshot),
    id: 'capture-scope-qa',
    captureScope: { mode: 'region', rect },
  };
  const prepared = prepareCaptureScope(scoped);
  check(
    'Scope retains global coordinates, selected nodes and layout ancestors',
    prepared.nodes.find((n) => n.id === target.id).rect.x === target.rect.x &&
      !prepared.nodes.find((n) => n.id === target.id).scopeHidden &&
      prepared.nodes.some((n) => n.scopeHidden),
  );
  await app.openSnapshot(scoped);
  check(
    'Canvas clips to region while document layout retains full width',
    app.state.scene.viewRect().x === rect.x &&
      Number(doc.querySelector('#scene-frame').width) >= scoped.source.width &&
      parseFloat(doc.querySelector('#artboard').style.width) < scoped.source.width,
  );
  const view = renderScope(
    app.state.scene.serialize(),
    app.state.scene.contentSize().width,
    app.state.scene.contentSize().height,
  );
  check(
    'Image rendering declares the same explicit crop',
    view.x === rect.x && view.width === rect.width,
  );
  const blob = await renderPng(
      app.state.scene.serialize(),
      app.state.scene.contentSize().width,
      app.state.scene.contentSize().height,
    ),
    image = await createImageBitmap(blob);
  check(
    'Browser image output is cropped to selected range',
    image.width === Math.ceil(rect.width) && image.height === Math.ceil(rect.height),
  );
  image.close();
  const repair = structuredClone(snapshot),
    url = 'https://assets.example.test/missing.png';
  repair.id = 'resource-repair-qa';
  repair.html = repair.html.replace(
    '</body>',
    `<img data-uic-id="n999999" src="${url}" width="80" height="60"></body>`,
  );
  repair.nodes.push({
    id: 'n999999',
    tag: 'img',
    parentId: null,
    name: '누락 이미지',
    kind: 'element',
    visible: true,
    position: 'static',
    rect: { x: 0, y: 0, width: 80, height: 60 },
    locator: {},
    image: { url, mode: 'screenshot' },
  });
  const patch = { type: 'resource', resource_url: url, data: png },
    before = JSON.stringify(repair),
    built = buildCodeDocument(repair.html, new Map(repair.nodes.map((n) => [n.id, n])), [patch]);
  check(
    'Resource patch restores only observed image reference',
    built.elements.get('n999999').src === png &&
      built.nodes.get('n999999').image.mode === 'embedded',
  );
  let rejected = 0;
  for (const invalid of [
    { ...patch, data: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { ...patch, resource_url: 'file:///tmp/secret' },
    { ...patch, resource_url: 'https://unobserved.test/a.png' },
  ])
    try {
      buildCodeDocument(repair.html, new Map(repair.nodes.map((n) => [n.id, n])), [invalid]);
    } catch {
      rejected++;
    }
  check('Active types, nonweb URLs and unobserved references are rejected', rejected === 3);
  check(
    'Resource candidate omits already repaired image',
    resourceCandidates(repair, [patch]).every((c) => c.url !== url),
  );
  validateResourcePatch(patch);
  await decodeResource(png);
  let brokenRejected = false;
  try {
    validateResourcePatch({ ...patch, data: png.slice(0, -16) });
  } catch {
    brokenRejected = true;
  }
  check('Truncated PNG is rejected before preview/apply', brokenRejected);
  await app.openSnapshot(repair);
  win.ConsoleCanvasDesktop = {
    retryAssets: async (urls) => urls.map((url) => ({ url, data: png })),
  };
  doc.querySelector('#capture-status-button').click();
  doc.querySelector('#repair-assets-button').click();
  doc.querySelector('#repair-assets-fetch').click();
  await until(() => !doc.querySelector('#repair-assets-apply').disabled);
  check(
    'Resource preview leaves current scene untouched',
    app.state.scene.codePatches.length === 0 && doc.querySelector('#repair-assets-preview iframe'),
  );
  doc.querySelector('#repair-assets-apply').click();
  check(
    'Explicit apply commits resource as one undo step',
    app.state.scene.codePatches.length === 1 && app.state.undo.length === 1,
  );
  doc.querySelector('#undo').click();
  check('Undo restores missing image state', app.state.scene.codePatches.length === 0);
  doc.querySelector('#redo').click();
  check('Redo restores resource bytes', app.state.scene.codePatches[0]?.data === png);
  await app.state.saving;
  const saved = await (await import('../db.js')).getDocument(repair.id);
  check('Resource bytes persist with document session', saved.codePatches[0].data === png);
  check('Original capture remains immutable after repair', JSON.stringify(repair) === before);
  const a = app.snapshotHistory.create('복구 A');
  await app.state.saving;
  app.state.scene.setComment('n999999', '기존 주석 보존');
  const b = app.snapshotHistory.create('주석 B');
  await app.state.saving;
  await app.snapshotHistory.restorePersisted(a.id);
  check(
    'Returning to past snapshot restores embedded resource independently',
    app.state.scene.codePatches[0]?.data === png && !app.state.scene.annotations.n999999,
  );
  await app.snapshotHistory.restorePersisted(b.id);
  check(
    'Future snapshot preserves repair and annotation',
    app.state.scene.annotations.n999999 === '기존 주석 보존',
  );
  const portable = JSON.parse(
    JSON.stringify(await (await import('../db.js')).getDocument(repair.id)),
  );
  await app.openSnapshot(portable, portable.edits, portable.note, portable.annotations);
  check(
    'Portable document roundtrip retains resource, annotation and snapshots',
    app.state.scene.codePatches[0]?.data === png &&
      app.state.scene.annotations.n999999 === '기존 주석 보존' &&
      app.state.timeline.entries.some((e) => e.id === a.id) &&
      app.state.timeline.entries.some((e) => e.id === b.id),
  );
  document.querySelector('#status').textContent = results.length + '/' + results.length + ' passed';
  document.body.dataset.result = 'pass';
} catch (error) {
  document.querySelector('#status').textContent = error.stack;
  document.body.dataset.result = 'fail';
}
