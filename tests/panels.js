const frame = document.querySelector('#editor'),
  results = [],
  storageKey = 'console-canvas-panels-v1',
  original = localStorage.getItem(storageKey);
function check(name, passed) {
  results.push({ name, passed: !!passed });
  document.querySelector('#results').textContent = results
    .map((r) => (r.passed ? 'PASS ' : 'FAIL ') + r.name)
    .join('\n');
  if (!passed) throw new Error(name);
}
async function open(url) {
  const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  frame.src = url;
  await loaded;
  const deadline = Date.now() + 20000;
  while (!frame.contentWindow.ConsoleCanvas?.state.ready) {
    if (Date.now() > deadline) throw new Error('Editor did not become ready');
    await new Promise((r) => setTimeout(r, 50));
  }
  return frame.contentWindow.ConsoleCanvas;
}
try {
  localStorage.removeItem(storageKey);
  let app = await open('../editor.html?sample=1'),
    doc = frame.contentDocument;
  let click = (id) => doc.querySelector('#' + id).click(),
    width = () => doc.querySelector('#viewport').getBoundingClientRect().width;
  const initialWidth = width(),
    leftWidth = doc.querySelector('#layers-panel').getBoundingClientRect().width,
    rightWidth = doc.querySelector('#properties-panel').getBoundingClientRect().width,
    zoom = app.state.zoom;
  check(
    'Both panels start expanded with accessible toggle buttons',
    !doc.querySelector('#layers-panel').hidden &&
      !doc.querySelector('#properties-panel').hidden &&
      doc.querySelector('#toggle-layers').getAttribute('aria-expanded') === 'true',
  );
  check(
    'Expanded toggles sit inside the top row of their respective panels',
    ['layers', 'properties'].every((key) => {
      const panel = doc.querySelector('#' + key + '-panel'),
        button = doc.querySelector('#toggle-' + key),
        r = button.getBoundingClientRect(),
        p = panel.getBoundingClientRect();
      return (
        panel.contains(button) &&
        r.top >= p.top &&
        r.bottom <= p.top + 44 &&
        frame.contentWindow.getComputedStyle(button.querySelector('span')).display === 'none'
      );
    }),
  );
  doc.querySelector('#toggle-layers').focus();
  check(
    'Both sides of each resize boundary receive pointer input',
    ['layers', 'properties'].every((key) => {
      const handle = doc.querySelector('#resize-' + key),
        r = handle.getBoundingClientRect();
      return [1, 6].every((dx) => doc.elementFromPoint(r.left + dx, r.top + 200) === handle);
    }),
  );
  click('toggle-layers');
  check(
    'Collapsing layers gives its full width to the canvas',
    doc.querySelector('#layers-panel').hidden && Math.abs(width() - initialWidth - leftWidth) < 1,
  );
  const focusedAfterCollapse = doc.activeElement.id === 'toggle-layers';
  click('toggle-properties');
  check(
    'Both panels can collapse while their reopen buttons stay visible',
    Math.abs(width() - initialWidth - leftWidth - rightWidth) < 1 &&
      ['toggle-layers', 'toggle-properties'].every((id) => {
        const button = doc.querySelector('#' + id);
        return (
          button.getBoundingClientRect().width > 0 &&
          button.closest('.canvas-tools') &&
          button.getAttribute('aria-expanded') === 'false'
        );
      }),
  );
  check('Panel changes preserve the current canvas zoom', app.state.zoom === zoom);
  click('toggle-layers');
  check(
    'Moving the toggle between panel and canvas preserves keyboard focus',
    focusedAfterCollapse && doc.activeElement.id === 'toggle-layers',
  );
  click('toggle-properties');
  const panelWidth = (key) => doc.querySelector('#' + key + '-panel').getBoundingClientRect().width;
  const pointer = (key, type, x) =>
    doc.querySelector('#resize-' + key).dispatchEvent(
      new frame.contentWindow.PointerEvent(type, {
        pointerId: 1,
        button: 0,
        clientX: x,
        bubbles: true,
        cancelable: true,
      }),
    );
  const drag = (key, delta) => {
    pointer(key, 'pointerdown', 100);
    pointer(key, 'pointermove', 100 + delta);
    pointer(key, 'pointerup', 100 + delta);
  };
  drag('layers', 84);
  drag('properties', -110);
  check(
    'Dragging each boundary changes its panel and available canvas width',
    panelWidth('layers') === 312 &&
      panelWidth('properties') === 360 &&
      Math.abs(width() - (initialWidth - 194)) < 1,
  );
  check(
    'Resize handles expose their current width to assistive technology',
    doc.querySelector('#resize-layers').getAttribute('aria-valuenow') === '312' &&
      doc.querySelector('#resize-properties').getAttribute('aria-valuenow') === '360',
  );
  pointer('layers', 'pointerdown', 100);
  pointer('layers', 'pointermove', 200);
  doc
    .querySelector('#resize-layers')
    .dispatchEvent(
      new frame.contentWindow.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
  check(
    'Escape cancels an in-progress resize and clears the drag overlay',
    panelWidth('layers') === 312 && !doc.body.classList.contains('resizing-panels'),
  );
  drag('layers', 5000);
  drag('properties', 5000);
  check(
    'Drag limits prevent unusably wide or narrow panels',
    panelWidth('layers') === 520 && panelWidth('properties') === 200 && width() >= 320,
  );
  drag('layers', 312 - panelWidth('layers'));
  drag('properties', panelWidth('properties') - 360);
  const separator = doc.querySelector('#resize-properties');
  separator.dispatchEvent(
    new frame.contentWindow.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
  );
  check(
    'Keyboard arrows resize a vertical boundary in the correct direction',
    panelWidth('properties') === 370,
  );
  separator.dispatchEvent(
    new frame.contentWindow.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
  );
  check(
    'Panel resizing leaves canvas edits, undo history and zoom unchanged',
    app.state.undo.length === 0 &&
      Object.keys(app.state.scene.edits).length === 0 &&
      app.state.zoom === zoom,
  );
  drag('layers', 500 - panelWidth('layers'));
  drag('properties', panelWidth('properties') - 500);
  const nextFrame = () =>
    new Promise((resolve) =>
      frame.contentWindow.requestAnimationFrame(() =>
        frame.contentWindow.requestAnimationFrame(resolve),
      ),
    );
  frame.style.width = '1000px';
  await nextFrame();
  const preferred = JSON.parse(localStorage.getItem(storageKey)).widths;
  check(
    'A narrow window reserves canvas space without overwriting saved preferred widths',
    width() >= 319 && preferred.layers === 500 && preferred.properties === 500,
  );
  frame.style.width = '1440px';
  await nextFrame();
  check(
    'Growing the window restores the preferred panel widths',
    panelWidth('layers') === 500 && panelWidth('properties') === 500,
  );
  drag('layers', 312 - panelWidth('layers'));
  drag('properties', panelWidth('properties') - 360);
  const node = [...app.state.scene.nodes.values()].find(
    (n) => n.tag === 'button' && n.locator.id === 'new-customer',
  );
  app.selectNode(node.id);
  doc.querySelector('#component-comment').value = '접어도 보존할 수정 방향';
  click('toggle-properties');
  check(
    'Collapsing properties commits the comment draft without losing selection',
    app.state.scene.annotations[node.id] === '접어도 보존할 수정 방향' &&
      app.state.scene.selected === node.id,
  );
  click('snapshots-button');
  check(
    'Snapshots reopen a collapsed properties panel',
    !doc.querySelector('#properties-panel').hidden && !doc.querySelector('#snapshot-panel').hidden,
  );
  check(
    'Snapshot mode keeps the collapse toggle visible in the same shared heading',
    !doc.querySelector('#properties-panel-title').closest('[hidden]') &&
      doc.querySelector('#properties-panel-title').textContent === '스냅샷' &&
      !doc.querySelector('#toggle-properties').closest('[hidden]') &&
      !doc.querySelector('#close-snapshots'),
  );
  click('toggle-properties');
  click('snapshots-button');
  check(
    'Snapshots reopen even when the hidden panel already contains the snapshot list',
    !doc.querySelector('#properties-panel').hidden && !doc.querySelector('#snapshot-panel').hidden,
  );
  click('toggle-properties');
  click('toggle-layers');
  await app.state.saving;
  const documentId = app.state.snapshot.id;
  app = await open('../editor.html?id=' + encodeURIComponent(documentId));
  doc = frame.contentDocument;
  check(
    'Both collapsed preferences survive reopening the app page',
    doc.querySelector('#layers-panel').hidden && doc.querySelector('#properties-panel').hidden,
  );
  click('toggle-layers');
  click('toggle-properties');
  app.selectNode(node.id);
  check(
    'Custom widths survive collapse, app-page restart and reopening',
    panelWidth('layers') === 312 && panelWidth('properties') === 360,
  );
  check(
    'Reopened panels retain the saved document, comment and snapshot list',
    app.state.snapshot.id === documentId &&
      doc.querySelector('#component-comment').value === '접어도 보존할 수정 방향' &&
      app.state.timeline.entries.length === 1,
  );
  click('snapshots-button');
  click('toggle-properties');
  // Selecting a comment from the change list explicitly opens its input, unlike ordinary selection.
  doc.querySelector('#changes button').click();
  check(
    'Opening a comment reveals its inspector instead of the hidden snapshot list',
    !doc.querySelector('#properties-panel').hidden &&
      doc.querySelector('#snapshot-panel').hidden &&
      doc.activeElement.id === 'component-comment',
  );
  await app.state.saving;
  document.querySelector('#status').textContent = JSON.stringify({
    passed: results.length,
    failed: 0,
    total: results.length,
  });
  document.body.dataset.result = 'pass';
} catch (error) {
  document.querySelector('#status').textContent = 'FAILED: ' + error.message;
  document.body.dataset.result = 'fail';
  console.error(error);
} finally {
  if (original === null) localStorage.removeItem(storageKey);
  else localStorage.setItem(storageKey, original);
}
