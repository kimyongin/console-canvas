import { CanvasScene, copy, validateSnapshot, sanitizeHtml } from '../engine.js';
const results = [],
  output = document.getElementById('results'),
  status = document.getElementById('status');
function check(name, predicate) {
  let passed = false,
    error = '';
  try {
    passed = !!predicate();
  } catch (e) {
    error = e.message;
  }
  results.push({ name, passed, error });
  output.textContent = results
    .map((r) => (r.passed ? 'PASS ' : 'FAIL ') + r.name + (r.error ? ' · ' + r.error : ''))
    .join('\n');
}
function near(a, b) {
  return Math.abs(a - b) < 0.75;
}
async function run() {
  const sourceFrame = document.getElementById('source');
  if (
    sourceFrame.contentDocument?.readyState !== 'complete' ||
    !sourceFrame.contentDocument?.getElementById('customer-search')
  )
    await new Promise((resolve) => sourceFrame.addEventListener('load', resolve, { once: true }));
  const source = sourceFrame.contentDocument;
  source.getElementById('customer-search').value = '김민서';
  source.querySelector('input[type=checkbox]').checked = true;
  source.querySelector('select').value = 'VIP';
  const password = source.createElement('input');
  password.type = 'password';
  password.value = 'DO-NOT-COPY-PASSWORD';
  password.setAttribute('value', 'DO-NOT-COPY-PASSWORD');
  password.setAttribute('aria-label', 'password-test');
  source.body.append(password);
  const beforeSource = source.documentElement.outerHTML;
  const snapshot = await globalThis.UICloneCapture.capture(source);
  check(
    'Capture leaves original DOM unchanged',
    () => source.documentElement.outerHTML === beforeSource,
  );
  check(
    'Capture finds real DOM and individual text',
    () =>
      snapshot.nodes.length > 300 &&
      snapshot.nodes.some((n) => n.kind === 'text') &&
      snapshot.nodes.some((n) => n.kind === 'icon'),
  );
  check('Empty CSS pseudo icons are preserved', () =>
    snapshot.nodes.some((n) => n.kind === 'pseudo'),
  );
  check('Snapshot has no source scripts', () => !/<script[\s>]/i.test(snapshot.html));
  check('Password values are not copied', () => !snapshot.html.includes('DO-NOT-COPY-PASSWORD'));
  const scene = new CanvasScene(document.getElementById('clone'), snapshot);
  await scene.mount();
  check(
    'All captured DOM targets resolve in the clone',
    () => scene.elements.size === snapshot.nodes.length,
  );
  check(
    'Input value is preserved',
    () => scene.doc.getElementById('customer-search').value === '김민서',
  );
  check(
    'Checkbox state is preserved',
    () => scene.doc.querySelector('input[type=checkbox]').checked,
  );
  check('Select state is preserved', () => scene.doc.querySelector('select').value === 'VIP');
  check(
    'Source scripts do not run in the clone',
    () => scene.frame.contentWindow.consoleDemoActions === undefined,
  );
  const visible = [...scene.elements.keys()].filter((id) => {
    const n = scene.nodes.get(id),
      r = scene.rect(id);
    return n.visible && r.width > 0 && r.height > 0 && n.tag !== 'option';
  });
  const failureDetails = [];
  for (const id of visible) {
    scene.setEdits({});
    const before = scene.rect(id);
    scene.setEdits({ [id]: { dx: 17, dy: 9 } });
    const after = scene.rect(id);
    if (!near(after.x - before.x, 17) || !near(after.y - before.y, 9))
      failureDetails.push({
        id,
        kind: scene.nodes.get(id).kind,
        tag: scene.nodes.get(id).tag,
        before,
        after,
      });
    scene.remove(id);
    if (
      !scene.hidden(id) ||
      scene.doc.defaultView.getComputedStyle(scene.elements.get(id)).visibility !== 'hidden'
    )
      failureDetails.push({ id, action: 'deletion' });
    scene.setEdits({});
    const restored = scene.rect(id);
    if (!near(before.x, restored.x) || !near(before.y, restored.y))
      failureDetails.push({ id, action: 'restore', before, restored });
  }
  check(
    'Every rendered element can move, delete, and restore (' + visible.length + ' elements)',
    () => !failureDetails.length,
  );
  if (failureDetails.length) {
    const pre = document.createElement('pre');
    pre.id = 'element-failures';
    pre.textContent = JSON.stringify(failureDetails.slice(0, 20), null, 2);
    document.body.append(pre);
  }
  scene.setEdits({});
  const button = snapshot.nodes.find((n) => n.locator.id === 'new-customer' && n.tag === 'button'),
    label = snapshot.nodes.find((n) => n.parentId === button.id && n.kind === 'text'),
    icon = snapshot.nodes.find((n) => n.parentId === button.id && n.kind === 'icon');
  const baseLabel = scene.rect(label.id);
  scene.setEdits({ [button.id]: { dx: 70, dy: 35 }, [label.id]: { dx: 20, dy: 10 } });
  check(
    'Moved text follows moved parent and keeps its own offset',
    () =>
      near(scene.rect(label.id).x, baseLabel.x + 90) &&
      near(scene.rect(label.id).y, baseLabel.y + 45),
  );
  scene.setEdits({ [label.id]: { deleted: true } });
  check(
    'Deleting button text preserves the button and icon',
    () => scene.hidden(label.id) && !scene.hidden(button.id) && !scene.hidden(icon.id),
  );
  scene.setEdits({ [label.id]: { dx: 120, dy: 90 }, [button.id]: { deleted: true } });
  check(
    'Deleting a group hides detached moved descendants',
    () => scene.hidden(label.id) && scene.elements.get(label.id).style.opacity === '0',
  );
  check(
    'Deletion log deduplicates descendants',
    () => scene.changes().length === 1 && scene.changes()[0].id === button.id,
  );
  scene.setEdits({});
  const text = snapshot.nodes.find(
    (n) =>
      n.kind === 'text' &&
      n.text === '고객 관리' &&
      scene.parent(n.id) &&
      scene.nodes.get(scene.parent(n.id)).tag === 'h1',
  );
  scene.select(text.id);
  scene.doc.documentElement.setPointerCapture = () => {};
  scene.doc.documentElement.hasPointerCapture = () => false;
  const target = scene.elements.get(text.id),
    r = scene.rect(text.id);
  target.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      pointerId: 7,
      button: 0,
      clientX: r.x + 5,
      clientY: r.y + 5,
    }),
  );
  scene.doc.documentElement.dispatchEvent(
    new PointerEvent('pointermove', {
      bubbles: true,
      pointerId: 7,
      clientX: r.x + 115,
      clientY: r.y + 85,
    }),
  );
  scene.doc.documentElement.dispatchEvent(
    new PointerEvent('pointerup', { bubbles: true, pointerId: 7 }),
  );
  check(
    'Direct drag moves text outside its original container',
    () =>
      scene.edits[text.id].dx === 110 &&
      scene.edits[text.id].dy === 80 &&
      near(scene.rect(text.id).x, r.x + 110),
  );
  const moved = copy(scene.edits);
  scene.setEdits({});
  scene.setEdits(moved);
  check(
    'Restoring imported edits reproduces the final position',
    () => near(scene.rect(text.id).x, r.x + 110) && near(scene.rect(text.id).y, r.y + 80),
  );
  const originalBefore = await scene.beforeHtml();
  check(
    'Generating the original view preserves current edits',
    () => scene.edits[text.id].dx === 110 && near(scene.rect(text.id).x, r.x + 110),
  );
  check(
    'Serialized output excludes editor outlines',
    () => !scene.serialize().includes('data-uic-editor="selection"'),
  );
  const cleaned = sanitizeHtml(
    '<html><head><script>alert(1)</script></head><body><img src="x" onerror="alert(1)"><iframe srcdoc="bad"></iframe><a href="javascript:alert(1)">link</a></body></html>',
  );
  check(
    'Imported active content is removed',
    () =>
      !cleaned.includes('onerror') &&
      !cleaned.includes('<script') &&
      !cleaned.includes('<iframe') &&
      !cleaned.includes('javascript:'),
  );
  let rejected = false;
  try {
    validateSnapshot({
      ...snapshot,
      nodes: [{ ...snapshot.nodes[0], parentId: snapshot.nodes[0].id }],
    });
  } catch {
    rejected = true;
  }
  check('Cyclic imported element identities are rejected', () => rejected);
  const originalEdits = JSON.stringify(scene.edits),
    originalPosition = scene.rect(text.id);
  scene.setComment(text.id, '제목 문구를 고객 목록으로 바꾸고\n설명은 한 줄로 줄여 주세요.');
  check(
    'Comment-only requests preserve the visual layout and original locator',
    () =>
      JSON.stringify(scene.edits) === originalEdits &&
      near(scene.rect(text.id).x, originalPosition.x) &&
      scene.comments()[0].locator.selector === text.locator.selector,
  );
  const marker = scene.commentMarkers.get(text.id);
  check(
    'Commented elements display a numbered canvas marker with preview text',
    () =>
      marker?.textContent === '1' &&
      marker.title.includes('제목 문구를 고객 목록으로') &&
      marker.dataset.uicComment === text.id,
  );
  let openedComment = null;
  scene.callbacks.onCommentSelect = (id) => {
    openedComment = id;
  };
  marker.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, pointerId: 30, button: 0 }),
  );
  check(
    'Clicking a comment marker opens its target without moving it',
    () =>
      openedComment === text.id &&
      scene.selected === text.id &&
      !scene.drag &&
      JSON.stringify(scene.edits) === originalEdits,
  );
  openedComment = null;
  marker.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
  check('Comment markers support keyboard activation', () => openedComment === text.id);
  scene.setDisplayScale(0.5);
  check('Canvas comment markers stay readable when the artboard is zoomed out', () =>
    near(marker.getBoundingClientRect().width * scene.displayScale, 24),
  );
  scene.setDisplayScale(1);
  const markerX = parseFloat(marker.style.left);
  scene.setEdits({ ...scene.edits, [text.id]: { dx: 150, dy: 80 } });
  check('Comment markers follow their elements when moved', () =>
    near(parseFloat(marker.style.left) - markerX, 40),
  );
  scene.setEdits(JSON.parse(originalEdits));
  check(
    'Canvas comment markers are excluded from exported page HTML',
    () =>
      !scene.serialize().includes('data-uic-comment') &&
      !scene.serialize().includes('data-uic-editor="comment-markers"'),
  );
  scene.interactionMode = 'comment';
  target.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      pointerId: 8,
      button: 0,
      clientX: r.x + 5,
      clientY: r.y + 5,
    }),
  );
  scene.doc.documentElement.dispatchEvent(
    new PointerEvent('pointermove', {
      bubbles: true,
      pointerId: 8,
      clientX: r.x + 200,
      clientY: r.y + 200,
    }),
  );
  scene.doc.documentElement.dispatchEvent(
    new PointerEvent('pointerup', { bubbles: true, pointerId: 8 }),
  );
  check(
    'Comment mode selects without accidentally dragging',
    () =>
      scene.selected === text.id && !scene.drag && JSON.stringify(scene.edits) === originalEdits,
  );
  scene.interactionMode = 'edit';
  scene.setComment(label.id, '버튼 문구를 바꿔 주세요.');
  scene.setEdits({ [button.id]: { deleted: true } });
  check('Comments survive deleted ancestors and mark the missing target', () =>
    scene.comments().some((c) => c.id === label.id && c.targetDeleted && c.after === null),
  );
  check(
    'Deleted targets retain a clickable canvas comment marker',
    () =>
      scene.commentMarkers.has(label.id) &&
      scene.commentMarkers.get(label.id).title.includes('삭제된 대상'),
  );
  scene.setEdits(moved);
  scene.setComment(label.id, '');
  check('Deleting a comment removes its canvas marker', () => !scene.commentMarkers.has(label.id));
  const savedComments = copy(scene.annotations);
  scene.setComments({ ...savedComments, n999999: 'unknown', bad: 123 });
  check(
    'Imported comments exclude unknown IDs and invalid values',
    () => JSON.stringify(scene.annotations) === JSON.stringify(savedComments),
  );
  scene.select(icon.id);
  scene.remove();
  scene.setComment(icon.id, '아이콘 대신 텍스트만 남겨 주세요.');
  const failures = results.filter((r) => !r.passed);
  status.textContent = JSON.stringify({
    passed: results.length - failures.length,
    failed: failures.length,
    total: results.length,
  });
  document.body.dataset.result = failures.length ? 'fail' : 'pass';
}
run().catch((error) => {
  status.textContent = 'FAIL ' + error.stack;
  document.body.dataset.result = 'fail';
});
