// Isolated native integration. Never run against a user's profile.
const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async function selfDesign({ editor, shell, window, appRoot, until }) {
  const run = (contents, code) => contents.executeJavaScript(code);
  const originalId = await run(editor, 'window.ConsoleCanvas.state.snapshot.id');
  const shellHtml = await run(shell, 'document.documentElement.outerHTML');
  const capture = require(path.join(appRoot, 'desktop/capture.cjs'));
  await assert.rejects(() => capture.captureWebsite(shell, appRoot), /HTTP/);
  await assert.rejects(() => capture.captureAppShell(editor, appRoot), /출처/);
  // Include a real open task window and an unsaved comment draft.
  await run(
    editor,
    `(()=>{const a=window.ConsoleCanvas,n=[...a.state.scene.nodes.values()].find(n=>n.locator.id==='new-customer'&&n.tag==='button');a.selectNode(n.id);document.querySelector('#context-comment').click();document.querySelector('#component-comment').value='self-design draft preserved';})()`,
  );
  const originalHeader = await run(
    editor,
    'document.querySelector("#snapshots-button").textContent',
  );
  const imported = await run(shell, 'window.ConsoleCanvasShell.captureApp()');
  const first = await run(
    editor,
    `(()=>{const a=window.ConsoleCanvas,s=a.state.snapshot;return {id:s.id,source:s.source,ids:s.nodes.map(n=>n.id),parents:s.nodes.map(n=>n.parentId),shell:s.nodes.find(n=>n.locator.id==='show-settings'),toolbar:s.nodes.find(n=>n.locator.id==='snapshots-button'),modal:s.nodes.some(n=>n.locator.id==='component-comment'&&n.visible),frames:s.nodes.filter(n=>n.frame?.mode==='dom').length,inert:typeof a.state.scene.frame.contentWindow.ConsoleCanvasShell==='undefined'};})()`,
  );
  assert.equal(first.id, imported.id);
  assert.notEqual(first.id, originalId);
  assert.equal(first.source.application.view, 'editor');
  assert.equal(new Set(first.ids).size, first.ids.length);
  assert.ok(first.parents.every((id) => id === null || first.ids.includes(id)));
  assert.ok(first.shell.rect.y < 54 && first.toolbar.rect.y >= 54);
  assert.equal(first.modal, true);
  assert.ok(first.frames > 0, 'Inner canvas is DOM, not a screenshot');
  assert.equal(first.inert, true);
  async function compare(prefix) {
    const reference = await run(
      editor,
      '({photo:window.ConsoleCanvas.state.snapshot.screenshot,html:window.ConsoleCanvas.state.scene.serialize(),source:window.ConsoleCanvas.state.snapshot.source})',
    );
    const rendered = await require(path.join(appRoot, 'desktop/render-image.cjs'))({
      html: reference.html,
      width: reference.source.width,
      height: reference.source.height,
    });
    const { nativeImage } = require('electron'),
      beforeImage = nativeImage.createFromDataURL(reference.photo),
      afterImage = nativeImage.createFromBuffer(rendered);
    assert.deepEqual(beforeImage.getSize(), afterImage.getSize());
    const a = beforeImage.toBitmap(),
      b = afterImage.toBitmap();
    let equal = 0;
    for (let i = 0; i < a.length; i += 4)
      if (
        Math.max(
          Math.abs(a[i] - b[i]),
          Math.abs(a[i + 1] - b[i + 1]),
          Math.abs(a[i + 2] - b[i + 2]),
        ) <= 24
      )
        equal++;
    const visualMatch = equal / (a.length / 4);
    const artifacts = path.resolve(__dirname, '../local/self-design-041');
    await require('node:fs/promises').mkdir(artifacts, { recursive: true });
    await require('node:fs/promises').writeFile(
      path.join(artifacts, prefix + '-native-reference.png'),
      beforeImage.toPNG(),
    );
    await require('node:fs/promises').writeFile(
      path.join(artifacts, prefix + '-cloned-app.png'),
      rendered,
    );
    console.error('Self-design native visual match (' + prefix + '): ' + visualMatch);
    assert.ok(visualMatch >= 0.95, 'Native app clone must match at least 95%: ' + visualMatch);
    return visualMatch;
  }
  const visualMatch = await compare('modal');
  const changed = await run(
    editor,
    `(async()=>{const a=window.ConsoleCanvas,n=[...a.state.scene.nodes.values()].find(n=>n.locator.id==='snapshots-button');a.selectNode(n.id);a.state.scene.nudge(12,8);a.state.scene.setComment(n.id,'Give snapshots more room');a.state.scene.remove();a.undo();const saved=await a.snapshotHistory.create('앱 디자인 테스트');const db=await import('/db.js');await a.state.saving;const original=await db.getDocument(${JSON.stringify(originalId)});return {id:a.state.snapshot.id,node:n.id,dx:a.state.scene.edits[n.id].dx,comment:a.state.scene.annotations[n.id],deleted:a.state.scene.hidden(n.id),snapshot:saved.id,originalDraft:Object.values(original.annotations).includes('self-design draft preserved'),header:document.querySelector('#snapshots-button').textContent,source:a.buildReview?true:false};})()`,
  );
  assert.equal(changed.dx, 12);
  assert.equal(changed.comment, 'Give snapshots more room');
  assert.equal(changed.deleted, false);
  assert.equal(changed.originalDraft, true);
  assert.equal(await run(editor, "!!document.querySelector('#snapshots-button')"), true);
  const roundTrip = await run(
    editor,
    `(async()=>{const a=window.ConsoleCanvas,s=a.state,{reviewPayload}=await import('/export.js'),payload=reviewPayload(s.snapshot,s.scene,'',s.timeline,s.activity,s.activityHead,s.aiRequests,s.aiDraft);await a.importFile(new File([JSON.stringify(payload)],'self-design.uiclone.json'));return {url:a.state.snapshot.source.url,application:a.state.snapshot.source.application,comment:a.state.scene.annotations[${JSON.stringify(changed.node)}],dx:a.state.scene.edits[${JSON.stringify(changed.node)}].dx};})()`,
  );
  assert.equal(roundTrip.url, 'console-canvas://app/editor');
  assert.equal(roundTrip.application.view, 'editor');
  assert.equal(roundTrip.dx, 12);
  assert.equal(roundTrip.comment, changed.comment);
  await run(shell, "window.ConsoleCanvasShell.show('settings')");
  const settings = await run(shell, 'window.ConsoleCanvasShell.captureApp()');
  assert.notEqual(settings.id, first.id);
  assert.equal(
    await run(editor, 'window.ConsoleCanvas.state.snapshot.source.application.view'),
    'settings',
  );
  assert.equal(
    await run(
      editor,
      "window.ConsoleCanvas.state.snapshot.nodes.some(n=>n.locator.id==='show-agent'&&n.visible)",
    ),
    true,
  );
  const module = require(path.join(appRoot, 'desktop/app-capture.cjs')),
    real = module.captureApplication;
  module.captureApplication = async () => {
    throw Error('qa capture rejected');
  };
  try {
    await assert.rejects(
      () => run(shell, 'window.ConsoleCanvasShell.captureApp()'),
      /qa capture rejected/,
    );
  } finally {
    module.captureApplication = real;
  }
  assert.equal(await run(editor, 'window.ConsoleCanvas.state.snapshot.id'), settings.id);
  assert.equal(await run(shell, "document.querySelector('#capture-app').disabled"), false);
  // Restore the original fixture document so the existing SDK/persistence cases
  // continue to exercise their own console, with no self-design test edits.
  const restoreOriginal = () =>
    run(
      editor,
      `(async()=>{const db=await import('/db.js'),s=await db.getDocument(${JSON.stringify(originalId)});await window.ConsoleCanvas.openSnapshot(s,s.edits,s.note,s.annotations);const n=[...window.ConsoleCanvas.state.scene.nodes.values()].find(n=>n.locator.id==='new-customer'&&n.tag==='button');window.ConsoleCanvas.state.scene.setComment(n.id,'');await window.ConsoleCanvas.state.saving;})()`,
    );
  await restoreOriginal();
  assert.equal(
    await run(editor, 'document.querySelector("#snapshots-button").textContent'),
    originalHeader,
  );
  await run(shell, 'window.ConsoleCanvasShell.captureApp()');
  const plainVisualMatch = await compare('plain');
  await restoreOriginal();
  return {
    visualMatch,
    plainVisualMatch,
    document_id: first.id,
    node: changed.node,
    snapshot: changed.snapshot,
    original_id: originalId,
    nativeComposedCapture: true,
    framesEditable: true,
    draftPreserved: true,
    fileRoundTrip: true,
    failurePreservesDocument: true,
  };
};
