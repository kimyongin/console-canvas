// Browser contract test for the real shell UI with an explicitly fake native boundary.
const results = [],
  frame = document.querySelector('#shell');
const calls = { capture: [], preview: 0, check: 0, download: 0, install: 0, skill: 0, copy: 0 };
let stateListener,
  focusListener,
  menuMode = null;
let state = {
  view: 'source',
  header_height: 100,
  url: 'https://fixture.example.test/',
  busy: false,
};
const update = {
  phase: 'available',
  current_version: '0.27.0',
  latest_version: '0.28.0',
  message: 'fixture',
};
window.shellMock = {
  onState(fn) {
    stateListener = fn;
  },
  onUpdate() {},
  onFocusAddress(fn) {
    focusListener = fn;
  },
  async info() {
    return { ...state, demo_url: 'https://fixture.example.test/' };
  },
  async show(view) {
    state = { ...state, view };
    stateListener(state);
  },
  async capture(value) {
    calls.capture.push(structuredClone(value));
  },
  async chooseCaptureMode() {
    return menuMode;
  },
  async previewCapture() {
    calls.preview++;
    await this.show('capture');
    return {
      data:
        'data:image/svg+xml,' +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="white"/></svg>',
        ),
      view: { width: 600, height: 400, url: state.url },
    };
  },
  async updateInfo() {
    return update;
  },
  async checkUpdate() {
    calls.check++;
    return update;
  },
  async downloadUpdate() {
    calls.download++;
    return { ...update, phase: 'ready' };
  },
  async installUpdate() {
    calls.install++;
  },
  async skillInfo() {
    return { version: '0.27.0', path: '/fixture/skill', mcp_command: 'fixture command' };
  },
  async installSkill() {
    calls.skill++;
    return this.skillInfo();
  },
  async copyMcpCommand() {
    calls.copy++;
  },
  async saveSkill() {
    return { canceled: true };
  },
  async cancelReview() {
    state = { ...state, review_target: null };
    stateListener(state);
  },
  async navigate() {},
  async back() {},
  async forward() {},
  async reload() {},
};
function check(name, value) {
  results.push({ name, passed: !!value });
  document.querySelector('#results').textContent = results
    .map((r) => (r.passed ? 'PASS ' : 'FAIL ') + r.name)
    .join('\n');
  if (!value) throw Error(name);
}
async function until(fn) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw Error('Timed out');
}
const tick = () => new Promise((r) => setTimeout(r, 30));
try {
  const source = await (await fetch('../desktop/shell.html')).text();
  // Remove production CSP only from this srcdoc so the fixture can inject its mock.
  frame.srcdoc = source
    .replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, '')
    .replace('<head>', '<head><base href="/desktop/">')
    .replace(
      '<script src="shell.cjs"></script>',
      '<script>window.ConsoleCanvasShell=parent.shellMock;localStorage.removeItem("capture-scope");localStorage.removeItem("console-canvas-auto-download-updates");</script><script src="shell.cjs"></script>',
    );
  await until(() =>
    frame.contentDocument?.querySelector('#capture')?.textContent.includes('현재 화면'),
  );
  const w = frame.contentWindow,
    d = frame.contentDocument,
    $ = (s) => d.querySelector(s),
    click = (s) => $(s).click();
  click('#capture-menu-button');
  await tick();
  check(
    'Opening and canceling the capture menu performs no capture',
    calls.capture.length === 0 && calls.preview === 0,
  );
  menuMode = 'document';
  click('#capture-menu-button');
  await tick();
  check(
    'Named full-page command executes once and remembers visible scope',
    calls.capture.length === 1 &&
      calls.capture[0].mode === 'document' &&
      $('#capture').textContent.includes('전체 페이지'),
  );
  menuMode = 'region';
  click('#capture-menu-button');
  await until(() => $('#capture-photo').complete && $('#capture-photo').naturalWidth);
  check(
    'Region command opens preview without final capture',
    calls.preview === 1 && calls.capture.length === 1 && $('#capture-region-confirm').disabled,
  );
  const wrap = $('#capture-photo-wrap'),
    photo = $('#capture-photo');
  wrap.setPointerCapture = () => {}; // Synthetic test pointers have no OS pointer capture.
  const point = (x, y) => {
    const b = photo.getBoundingClientRect();
    return { clientX: b.left + (x * b.width) / 600, clientY: b.top + (y * b.height) / 400 };
  };
  const pointer = (target, type, x, y) =>
    target.dispatchEvent(
      new w.PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, ...point(x, y) }),
    );
  pointer(photo, 'pointerdown', 40, 50);
  pointer(wrap, 'pointermove', 240, 150);
  pointer(wrap, 'pointerup', 240, 150);
  check(
    'Region has eight handles and a focusable nonempty selection',
    d.querySelectorAll('[data-handle]').length === 8 &&
      !$('#capture-selection').hidden &&
      !$('#capture-region-confirm').disabled &&
      d.activeElement === $('#capture-selection'),
  );
  pointer($('#capture-selection'), 'pointerdown', 100, 100);
  pointer(wrap, 'pointermove', 110, 110);
  pointer(wrap, 'pointerup', 110, 110);
  pointer($('[data-handle="e"]'), 'pointerdown', 250, 110);
  pointer(wrap, 'pointermove', 270, 110);
  pointer(wrap, 'pointerup', 270, 110);
  $('#capture-selection').dispatchEvent(
    new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
  );
  $('#capture-selection').dispatchEvent(
    new w.KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }),
  );
  click('#capture-region-confirm');
  await tick();
  const final = calls.capture.at(-1);
  check(
    'Move, edge resize and keyboard adjustments reach explicit confirmation with original view',
    calls.capture.length === 2 &&
      final.mode === 'region' &&
      Math.abs(final.rect.x - 51) <= 1 &&
      final.rect.y === 60 &&
      final.rect.width === 220 &&
      final.rect.height === 101 &&
      final.expectedView.url === state.url,
  );
  menuMode = 'region';
  await window.shellMock.show('source');
  click('#capture-menu-button');
  await tick();
  click('#capture-region-cancel');
  await tick();
  check(
    'Canceling region preview performs no capture',
    calls.capture.length === 2 && state.view === 'source',
  );
  state = { ...state, review_target: { request_id: 'pending', label: 'QA target' } };
  stateListener(state);
  check(
    'Frozen review destination and cancel are explicit in source view',
    $('#capture').textContent.includes('이 검토에 가져오기') && !$('#cancel-review-capture').hidden,
  );
  click('#cancel-review-capture');
  await tick();
  check(
    'Review cancel clears the destination',
    !state.review_target && $('#cancel-review-capture').hidden,
  );
  focusListener();
  check(
    'Address command focuses and selects address without navigating',
    d.activeElement === $('#address'),
  );
  click('#show-settings');
  await tick();
  click('#quick-install-skill');
  click('#quick-copy-mcp');
  await tick();
  check(
    'Settings exposes direct skill and MCP copy without opening details',
    calls.skill === 1 &&
      calls.copy === 1 &&
      state.view === 'settings' &&
      $('#quick-skill-info').textContent.includes('0.27.0'),
  );
  check(
    'Automatic update download is opt-in and off by default',
    !$('#auto-download-updates').checked,
  );
  click('#show-update');
  await tick();
  check(
    'Opening updates checks but does not download or install by default',
    calls.check === 1 && calls.download === 0 && calls.install === 0,
  );
  await window.shellMock.show('settings');
  $('#auto-download-updates').checked = true;
  $('#auto-download-updates').dispatchEvent(new w.Event('change'));
  check(
    'Opt-in setting itself does not initiate download',
    calls.download === 0 &&
      w.localStorage.getItem('console-canvas-auto-download-updates') === 'true',
  );
  click('#show-update');
  await tick();
  check(
    'Opt-in downloads only after explicit update page entry and leaves installation manual',
    calls.check === 2 &&
      calls.download === 1 &&
      calls.install === 0 &&
      !$('#install-update').hidden,
  );
  w.localStorage.removeItem('capture-scope');
  w.localStorage.removeItem('console-canvas-auto-download-updates');
  document.querySelector('#status').textContent = JSON.stringify({
    passed: results.length,
    failed: 0,
    total: results.length,
  });
  document.body.dataset.result = 'pass';
} catch (error) {
  document.querySelector('#status').textContent = String(error) + '\n' + error.stack;
  document.body.dataset.result = 'fail';
}
