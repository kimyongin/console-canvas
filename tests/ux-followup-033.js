import { getDocument, saveCapture, saveSession } from '../db.js';
import { reviewPayload } from '../export.js';
const frame = document.querySelector('#editor'),
  results = [];
function check(name, passed) {
  results.push({ name, passed: !!passed });
  document.querySelector('#results').textContent = results
    .map((r) => (r.passed ? 'PASS ' : 'FAIL ') + r.name)
    .join('\n');
  if (!passed) throw Error(name);
}
async function until(fn) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw Error('Timed out: ' + fn.toString());
}
const tick = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
try {
  await until(() => frame.contentWindow.ConsoleCanvas?.state.ready);
  let w = frame.contentWindow,
    d = frame.contentDocument,
    a = w.ConsoleCanvas;
  const $ = (s) => d.querySelector(s),
    click = (s) => $(s).click();
  const change = (s, value) => {
    $(s).value = value;
    $(s).dispatchEvent(new w.Event('change', { bubbles: true }));
  };
  const input = (s, value) => {
    const e = $(s);
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(e, value);
    e.dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  const signature = () =>
    JSON.stringify([
      a.state.snapshot.html,
      a.state.scene.edits,
      a.state.scene.annotations,
      a.state.timeline,
      a.state.activity,
    ]);
  const button = [...a.state.scene.nodes.values()].find((n) => n.locator?.id === 'new-customer'),
    filter = [...a.state.scene.nodes.values()].find((n) => n.locator?.id === 'customer-filter'),
    textNodes = [...a.state.scene.nodes.values()]
      .filter((n) => n.kind === 'text' && !n.scopeHidden)
      .slice(0, 28);
  const capture = structuredClone(a.state.snapshot);
  capture.id = crypto.randomUUID();
  capture.documentName = '검토용 별도 구현 화면';
  await saveCapture(capture);
  await saveSession(capture.id, { documentName: capture.documentName });
  let lastReview;
  for (const count of [3, 10, 30]) {
    for (const node of [button, filter, ...textNodes].slice(0, count))
      a.state.scene.setComment(node.id, '높이·간격과 좁은 화면의 배치를 정리해 주세요. ' + node.id);
    click('#implementation-button');
    await until(() => $('#implementation-dialog').open && !$('#implementation-result').disabled);
    if (count > 3) {
      click('#implementation-new');
      await until(() => a.state.implementationReviews.at(-1).requests.length === count);
      await until(() => !$('#implementation-result').disabled);
    }
    change('#implementation-result', capture.id);
    await until(
      () =>
        d.querySelectorAll('.implementation-frame iframe').length === 2 &&
        !$('#implementation-result').disabled,
    );
    lastReview = a.state.implementationReviews.at(-1);
    const before = signature();
    for (const [width, height] of [
      [1280, 720],
      [850, 600],
      [720, 600],
    ]) {
      frame.style.width = width + 'px';
      frame.style.height = height + 'px';
      await tick();
      const body = $('.implementation-body').getBoundingClientRect(),
        panes = [...d.querySelectorAll('.implementation-frame')],
        list = $('.implementation-request-list').getBoundingClientRect(),
        nav = $('#implementation-next-pending').getBoundingClientRect(),
        dialog = $('#implementation-dialog').getBoundingClientRect();
      check(
        `Readable comparison height and request list for ${count} at ${width}`,
        panes.every(
          (p) => p.clientHeight >= 160 && p.getBoundingClientRect().bottom <= body.bottom + 1,
        ) &&
          list.height >= 90 &&
          list.top >= nav.bottom - 1 &&
          list.bottom <= body.bottom + 1,
      );
      const footer = $('.implementation-review footer button'),
        f = footer.getBoundingClientRect();
      check(
        `Fixed navigation and output remain reachable for ${count} at ${width}`,
        nav.top >= body.top &&
          nav.right <= dialog.right &&
          d.elementFromPoint(f.x + f.width / 2, f.y + f.height / 2)?.closest('button') === footer,
      );
      change('[aria-label="구현 비교 확대"]', '1');
      await tick();
      panes[0].scrollTop = panes[0].scrollHeight;
      panes[0].scrollLeft = panes[0].scrollWidth;
      await tick();
      check(
        `Full-size content scrolls without changing the rendered source for ${count} at ${width}`,
        panes[0].scrollTop > 0 &&
          panes[0].scrollLeft > 0 &&
          panes[0].querySelector('iframe').width === '1360' &&
          signature() === before,
      );
      panes[1].focus();
      check(
        `Comparison scroll region is an explicit named keyboard target for ${count} at ${width}`,
        d.activeElement === panes[1] &&
          panes[1].tabIndex === 0 &&
          panes[1].getAttribute('aria-label') === '구현 화면 비교 영역',
      );
      change('[aria-label="구현 비교 확대"]', 'fit');
      await tick();
    }
    const request = lastReview.requests.find((r) => r.id === button.id);
    [...d.querySelectorAll('.implementation-request-pick')]
      .find((e) => e.textContent.startsWith(request.number + '.'))
      .click();
    await tick();
    const label = $('.compare-target-highlight > span'),
      labelBox = label.getBoundingClientRect(),
      space = label.parentElement.parentElement.getBoundingClientRect();
    check(
      `Right-edge request name stays inside the rendered screen for ${count}`,
      labelBox.left >= space.left - 1 &&
        labelBox.right <= space.right + 1 &&
        label.textContent.includes('고객 등록'),
    );
    change('[aria-label="구현 비교 확대"]', '1');
    await tick();
    const matched = d
      .querySelectorAll('.implementation-frame')[1]
      .querySelector('.compare-target-highlight');
    check(
      `Button and its text sharing an ID resolve to the button for ${count}`,
      !!matched &&
        Math.abs(matched.getBoundingClientRect().width - button.rect.width) < 2 &&
        d
          .querySelectorAll('.implementation-correspondence')[1]
          .textContent.includes('식별자로 추정'),
    );
    click('#implementation-focus-request');
    await tick();
    const focused = $('.compare-target-highlight > span').getBoundingClientRect(),
      pane = $('.implementation-frame').getBoundingClientRect();
    check(
      `Explicit focus includes the request label at 100% for ${count}`,
      focused.left >= pane.left &&
        focused.right <= pane.right &&
        focused.top >= pane.top &&
        focused.bottom <= pane.bottom,
    );
    const oldScroll = $('.implementation-frame').scrollLeft;
    click('#implementation-records');
    await tick();
    click('#implementation-records-back');
    await tick();
    await tick();
    check(
      `Management round-trip preserves scale, position and review data for ${count}`,
      $('[aria-label="구현 비교 확대"]').value === '1' &&
        $('.implementation-frame').scrollLeft === oldScroll &&
        signature() === before &&
        $('#implementation-review-list').value === lastReview.id,
    );
    $('#implementation-dialog').close();
    await tick();
  }
  // Four boundaries and a long label use the same shared VersionFrame as snapshot/comment previews.
  frame.style.width = '1280px';
  frame.style.height = '720px';
  await tick();
  for (const [x, y] of [
    [0, 0],
    [1350, 0],
    [0, 970],
    [1350, 970],
  ])
    a.state.scene.setComment(`point:${x}:${y}`, '가장자리의 요청과 번호를 확인해 주세요.');
  const rightText = [...a.state.scene.nodes.values()].find(
    (n) => n.tag === '#text' && n.locator?.id === 'new-customer',
  );
  a.state.scene.setComment(rightText.id, '버튼 안의 텍스트만 확인해 주세요.');
  const edgeRequestCount = a.state.scene.comments().length;
  a.state.snapshot.layerNames = {
    ...a.state.snapshot.layerNames,
    [button.id]: '고객 등록 작업의 긴 표시 이름 '.repeat(7).slice(0, 120),
  };
  click('#implementation-button');
  await until(() => $('#implementation-dialog').open && !$('#implementation-new').disabled);
  click('#implementation-new');
  await until(
    () =>
      a.state.implementationReviews.at(-1).requests.length === edgeRequestCount &&
      !$('#implementation-result').disabled,
  );
  change('#implementation-result', capture.id);
  await until(
    () =>
      d.querySelectorAll('.implementation-frame iframe').length === 2 &&
      !$('#implementation-result').disabled,
  );
  lastReview = a.state.implementationReviews.at(-1);
  for (const r of lastReview.requests.filter(
    (r) => r.id.startsWith('point:') || r.id === button.id,
  )) {
    [...d.querySelectorAll('.implementation-request-pick')]
      .find((e) => e.textContent.startsWith(r.number + '.'))
      .click();
    change('[aria-label="구현 비교 확대"]', 'fit');
    await tick();
    const h = $('.compare-target-highlight'),
      label = h.querySelector('span'),
      b = label.getBoundingClientRect(),
      s = h.parentElement.getBoundingClientRect();
    check(
      `Boundary label is contained with full accessible identity: ${r.id}`,
      b.left >= s.left - 1 &&
        b.right <= s.right + 1 &&
        b.top >= s.top - 1 &&
        b.bottom <= s.bottom + 1 &&
        h.getAttribute('aria-label').includes(r.name) &&
        b.width <= 280,
    );
    if (r.id.startsWith('point:'))
      check(
        'Point request does not invent a source element: ' + r.id,
        !d
          .querySelectorAll('.implementation-frame')[1]
          .querySelector('.compare-target-highlight') &&
          d.querySelectorAll('.implementation-correspondence')[1].textContent.includes('위치'),
      );
  }
  const pickRequest = (id) => {
    const r = a.state.implementationReviews
      .find((r) => r.id === $('#implementation-review-list').value)
      .requests.find((r) => r.id === id);
    [...d.querySelectorAll('.implementation-request-pick')]
      .find((e) => e.textContent.startsWith(r.number + '.'))
      .click();
  };
  pickRequest(rightText.id);
  change('[aria-label="구현 비교 확대"]', '1');
  await tick();
  check(
    'Text identity resolves separately from its owning button',
    Math.abs(
      d
        .querySelectorAll('.implementation-frame')[1]
        .querySelector('.compare-target-highlight')
        .getBoundingClientRect().width - rightText.rect.width,
    ) < 2,
  );
  const reviewBeforeAmbiguity = JSON.stringify(a.state.implementationReviews),
    canvasBeforeAmbiguity = signature();
  const duplicate = structuredClone(capture);
  duplicate.id = crypto.randomUUID();
  duplicate.documentName = '원본 ID가 중복된 구현 화면';
  const parsed = new w.DOMParser().parseFromString(duplicate.html, 'text/html'),
    duplicateNode = structuredClone(button),
    duplicateElement = parsed.querySelector('#new-customer').cloneNode(false);
  duplicateNode.id = 'n999999';
  duplicateNode.parentId = 'n1';
  duplicateNode.rect = { x: 500, y: 500, width: 92, height: 37 };
  duplicateElement.setAttribute('data-uic-id', duplicateNode.id);
  duplicateElement.style.cssText = 'position:absolute;left:500px;top:500px;width:92px;height:37px';
  duplicateElement.textContent = '다른 버튼';
  parsed.body.append(duplicateElement);
  duplicate.html = '<!doctype html>' + parsed.documentElement.outerHTML;
  duplicate.nodes.push(duplicateNode);
  await saveCapture(duplicate);
  await saveSession(duplicate.id, { documentName: duplicate.documentName });
  click('#implementation-refresh');
  await until(
    () =>
      !$('#implementation-result').disabled &&
      [...$('#implementation-result').options].some((o) => o.value === duplicate.id),
  );
  change('#implementation-result', duplicate.id);
  await until(
    () =>
      !$('#implementation-result').disabled &&
      a.state.implementationReviews.at(-1).result?.snapshot.id === duplicate.id,
  );
  await until(() =>
    d
      .querySelectorAll('.implementation-frame iframe')[1]
      ?.contentDocument?.querySelector('[data-uic-id="n999999"]'),
  );
  pickRequest(button.id);
  await tick();
  check(
    'Two actual buttons sharing an ID stay ambiguous and are explicitly explained',
    !d.querySelectorAll('.implementation-frame')[1].querySelector('.compare-target-highlight') &&
      d.querySelectorAll('.implementation-correspondence')[1].textContent.includes('대응 후보 2개'),
  );
  const hiddenDuplicate = structuredClone(duplicate);
  hiddenDuplicate.id = crypto.randomUUID();
  hiddenDuplicate.documentName = '같은 ID의 숨겨진 버튼이 있는 구현 화면';
  const hiddenDom = new w.DOMParser().parseFromString(hiddenDuplicate.html, 'text/html');
  hiddenDom.querySelector('[data-uic-id="n999999"]').style.display = 'none';
  hiddenDuplicate.html = '<!doctype html>' + hiddenDom.documentElement.outerHTML;
  await saveCapture(hiddenDuplicate);
  await saveSession(hiddenDuplicate.id, { documentName: hiddenDuplicate.documentName });
  click('#implementation-refresh');
  await until(
    () =>
      !$('#implementation-result').disabled &&
      [...$('#implementation-result').options].some((o) => o.value === hiddenDuplicate.id),
  );
  change('#implementation-result', hiddenDuplicate.id);
  await until(
    () =>
      !$('#implementation-result').disabled &&
      a.state.implementationReviews.at(-1).result?.snapshot.id === hiddenDuplicate.id,
  );
  await until(() => {
    const el = d
      .querySelectorAll('.implementation-frame iframe')[1]
      ?.contentDocument?.querySelector('[data-uic-id="n999999"]');
    return !!el && el.getBoundingClientRect().width === 0;
  });
  pickRequest(button.id);
  await tick();
  check(
    'A hidden responsive alternative is not confused with the visible button',
    !!d.querySelectorAll('.implementation-frame')[1].querySelector('.compare-target-highlight') &&
      d.querySelectorAll('.implementation-correspondence')[1].textContent.includes('식별자로 추정'),
  );
  const absent = structuredClone(capture);
  absent.id = crypto.randomUUID();
  absent.documentName = '대상 버튼이 사라진 구현 화면';
  absent.nodes = absent.nodes.filter((n) => n.id !== button.id);
  const absentDom = new w.DOMParser().parseFromString(absent.html, 'text/html');
  absentDom.querySelector('#new-customer').remove();
  absent.html = '<!doctype html>' + absentDom.documentElement.outerHTML;
  // Remove captured children too, so the fixture represents the actual absent DOM subtree.
  absent.nodes = absent.nodes.filter((n) => n.parentId !== button.id);
  await saveCapture(absent);
  await saveSession(absent.id, { documentName: absent.documentName });
  click('#implementation-refresh');
  await until(
    () =>
      !$('#implementation-result').disabled &&
      [...$('#implementation-result').options].some((o) => o.value === absent.id),
  );
  change('#implementation-result', absent.id);
  await until(
    () =>
      !$('#implementation-result').disabled &&
      a.state.implementationReviews.at(-1).result?.snapshot.id === absent.id,
  );
  await until(() => {
    const doc = d.querySelectorAll('.implementation-frame iframe')[1]?.contentDocument;
    return !!doc?.querySelector('[data-uic-id="n1"]') && !doc.querySelector('#new-customer');
  });
  pickRequest(button.id);
  await tick();
  check(
    'Missing result target is explained without drawing a false correspondence',
    !d.querySelectorAll('.implementation-frame')[1].querySelector('.compare-target-highlight') &&
      d
        .querySelectorAll('.implementation-correspondence')[1]
        .textContent.includes('대응 요소 없음'),
  );
  check(
    'Result correspondence preserves existing frozen reviews and the complete canvas',
    JSON.stringify(
      a.state.implementationReviews.slice(0, JSON.parse(reviewBeforeAmbiguity).length),
    ) === reviewBeforeAmbiguity && signature() === canvasBeforeAmbiguity,
  );
  $('#implementation-dialog').close();
  await tick();
  // Displayed version ordinals resolve by immutable IDs, including deleted ancestors.
  const saveVersion = async (name) => {
    click('#snapshots-button');
    $('#snapshot-name').value = name;
    $('#snapshot-form').requestSubmit();
    await until(() => !$('#snapshot-save-dialog').open);
    await a.state.saving;
    return a.state.timeline.entries.at(-1);
  };
  const A = await saveVersion('같은 이름');
  click('#close-snapshots');
  a.state.scene.select(button.id);
  a.state.scene.nudge(8, 0);
  const B = await saveVersion('같은 이름');
  const labelOf = (entry) =>
    'v' + (a.state.timeline.entries.findIndex((e) => e.id === entry.id) + 1) + ' · ' + entry.name;
  const beforeRead = signature();
  // A preview selection must never change the save parent or current history scope.
  $(`[data-snapshot-id="${A.id}"]`).click();
  click('#close-snapshots');
  click('#snapshots-button');
  check(
    'Save dialog distinguishes the actual parent from a same-name preview',
    $('#snapshot-parent-name').textContent.includes(labelOf(B)) &&
      a.state.timeline.activeId === B.id &&
      signature() === beforeRead,
  );
  click('#cancel-snapshot');
  await a.snapshotHistory.restorePersisted(A.id);
  a.state.scene.select(button.id);
  a.state.scene.nudge(0, 8);
  const D = await saveVersion('같은 이름');
  click('#close-snapshots');
  check(
    'New branch retains the selected parent and its existing future',
    D.parentId === A.id &&
      B.parentId === A.id &&
      a.state.timeline.entries.some((e) => e.id === B.id),
  );
  check(
    'History branch and individual event contexts distinguish same-name versions',
    $('#activity-branch').textContent.includes(labelOf(D)) &&
      [...d.querySelectorAll('.activity-context')].some((e) => e.textContent.includes(labelOf(A))),
  );
  await a.snapshotHistory.trash(A.id);
  check(
    'Deleted ancestor retains its ordinal and explicit trash context',
    [...d.querySelectorAll('.activity-context')].some((e) =>
      e.textContent.includes(labelOf(A) + ' · 휴지통'),
    ),
  );
  click('#snapshot-dropdown');
  const beforeSearch = signature();
  input('#snapshot-search', '같은 이름');
  await tick();
  check(
    'Search identifies same-name versions and their deleted parent without restoration',
    $('#snapshot-search-results').textContent.includes(labelOf(B)) &&
      $('#snapshot-search-results').textContent.includes(labelOf(A) + ' · 휴지통') &&
      signature() === beforeSearch,
  );
  click('#close-snapshots');
  await a.snapshotHistory.recover(A.id);
  await a.snapshotHistory.rename(A.id, '길어진 부모 버전 '.repeat(9).slice(0, 120));
  check(
    'Ancestor rename updates readable history without altering branch identity',
    [...d.querySelectorAll('.activity-context')].some((e) => e.textContent.includes(labelOf(A))) &&
      D.parentId === A.id &&
      B.parentId === A.id,
  );
  const payload = reviewPayload(
    a.state.snapshot,
    a.state.scene,
    $('#review-note').value,
    a.state.timeline,
    a.state.activity,
    a.state.activityHead,
    a.state.aiRequests,
    a.state.aiDraft,
    {
      implementationReviews: a.state.implementationReviews,
      handoffSettings: a.state.handoffSettings,
    },
  );
  const beforeFile = JSON.stringify([
    a.state.scene.edits,
    a.state.scene.annotations,
    a.state.timeline,
    a.state.activity,
    a.state.implementationReviews,
  ]);
  await a.importFile(new w.File([JSON.stringify(payload)], 'ux-033.uiclone.json'));
  await a.state.saving;
  check(
    'Editable file preserves original geometry, annotations, branches and reviews',
    beforeFile ===
      JSON.stringify([
        a.state.scene.edits,
        a.state.scene.annotations,
        a.state.timeline,
        a.state.activity,
        a.state.implementationReviews,
      ]),
  );
  const docId = a.state.snapshot.id;
  const persisted = await getDocument(docId);
  frame.src = '../editor.html?id=' + docId;
  await until(
    () => frame.contentWindow.ConsoleCanvas?.state.ready && frame.contentWindow.ConsoleCanvas !== a,
  );
  w = frame.contentWindow;
  d = frame.contentDocument;
  a = w.ConsoleCanvas;
  check(
    'IndexedDB reload retains branch parents and version-labeled history',
    a.state.timeline.entries.length === persisted.timeline.entries.length &&
      a.state.timeline.entries.find((e) => e.id === D.id).parentId === A.id &&
      $('#activity-branch').textContent.includes(labelOf(D)) &&
      JSON.stringify(a.state.implementationReviews) ===
        JSON.stringify(persisted.implementationReviews),
  );
  document.body.dataset.result = 'pass';
} catch (error) {
  results.push({ name: error.stack || String(error), passed: false });
  document.querySelector('#results').textContent = results
    .map((r) => (r.passed ? 'PASS ' : 'FAIL ') + r.name)
    .join('\n');
  document.body.dataset.result = 'fail';
}
document.querySelector('#status').textContent = JSON.stringify({
  passed: results.filter((r) => r.passed).length,
  failed: results.filter((r) => !r.passed).length,
  total: results.length,
});
