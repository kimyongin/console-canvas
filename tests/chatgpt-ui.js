import { reviewPayload } from '../export.js';
const frame = document.querySelector('#editor'),
  results = [];
function check(name, value) {
  results.push({ name, passed: !!value });
  document.querySelector('#results').textContent = results
    .map((r) => (r.passed ? 'PASS ' : 'FAIL ') + r.name)
    .join('\n');
  if (!value) throw Error(name);
}
async function until(fn) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw Error('Timeout: ' + fn);
}
const tick = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
try {
  await until(() => frame.contentWindow.ConsoleCanvas?.state.ready);
  const w = frame.contentWindow,
    d = frame.contentDocument,
    a = w.ConsoleCanvas,
    $ = (s) => d.querySelector(s),
    click = (s) => $(s).click();
  const change = (s, value) => {
    $(s).value = value;
    $(s).dispatchEvent(new w.Event('change', { bubbles: true }));
  };
  const input = (s, value) => {
    Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set.call($(s), value);
    $(s).dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  const button = [...a.state.scene.nodes.values()].find((n) => n.locator?.id === 'new-customer');
  a.state.scene.select(button.id);
  click('#ai-variants-button');
  await until(() => $('#ai-route'));
  $('.ai-auth').open = true;
  await tick();
  change('#ai-authentication', 'chatgpt');
  change('#ai-route', 'api');
  await tick();
  check(
    'ChatGPT and API-key billing paths are explicit without replacing MCP',
    !!$('#chatgpt-login') &&
      $('#ai-route').querySelector('[value="mcp"]') &&
      $('#ai-authentication').value === 'chatgpt',
  );
  check('Generation disabled until consent and account model are ready', $('#ai-create').disabled);
  w.chatgptMock.storageMode = 'wait';
  click('#chatgpt-refresh');
  await until(() => $('.ai-chatgpt').textContent.includes('저장소와 연결을 확인하고'));
  check(
    'Pending Keychain permission has an explanation and blocks authentication/generation',
    $('#chatgpt-login').disabled &&
      $('#ai-create').disabled &&
      $('.ai-chatgpt').textContent.includes('Safe Storage'),
  );
  click('#ai-close');
  await until(() => !$('#ai-close'));
  check(
    'Pending protected storage does not block returning to normal editing',
    a.state.ready &&
      d.querySelectorAll('dialog:modal').length === 0 &&
      a.state.scene.selection.has(button.id),
  );
  w.chatgptMock.storageMode = 'denied';
  w.chatgptMock.releaseStorage();
  click('#ai-variants-button');
  await until(() => $('#chatgpt-storage-retry'));
  check(
    'Denied storage preserves the document and offers an in-app retry',
    $('#ai-create').disabled &&
      a.state.aiRequests.length === 0 &&
      $('.ai-chatgpt').textContent.includes('로그인 정보는 유지'),
  );
  w.chatgptMock.storageMode = 'complete';
  click('#chatgpt-storage-retry');
  await until(() => !$('#chatgpt-login').disabled);
  check(
    'Storage retry recovers without restarting or creating requests',
    !$('#chatgpt-storage-retry') && a.state.aiRequests.length === 0,
  );
  click('#chatgpt-login');
  await until(() => $('#chatgpt-cancel-login'));
  check(
    'Login pending has cancellation and does not create requests',
    a.state.aiRequests.length === 0 && $('#chatgpt-login').disabled,
  );
  click('#chatgpt-cancel-login');
  await until(() => !$('#chatgpt-cancel-login'));
  check(
    'Cancel login keeps document and new prompt',
    a.state.ready && a.state.scene.selection.has(button.id),
  );
  w.chatgptMock.complete(false);
  click('#chatgpt-refresh');
  await until(() => $('#chatgpt-account'));
  check(
    'Identity login without plan scope never enables inference',
    $('#ai-create').disabled && $('#chatgpt-status').textContent.includes('권한'),
  );
  w.chatgptMock.complete();
  click('#chatgpt-refresh');
  await until(() => $('#chatgpt-model').value === 'qa-model' && !$('#ai-create').disabled);
  check(
    'Account-specific catalog names are shown and slugs selected',
    $('#chatgpt-model').textContent.includes('QA 가상 모델'),
  );
  check(
    'Tokens are absent from rendered account settings',
    !$('.ai-chatgpt').textContent.includes('access_token') &&
      !$('.ai-chatgpt').textContent.includes('refresh_token'),
  );
  input('#ai-prompt', '버튼을 더 명확하게 구분해 주세요.');
  const revision = a.state.revision;
  click('#ai-create');
  await until(
    () => a.state.aiRequests[0]?.candidates.length === 3 && a.state.aiRequests[0]?.execution,
  );
  const request = a.state.aiRequests[0],
    calls = w.chatgptMock.calls.filter((c) => c.name === 'generate');
  check(
    'Three completed candidates use the shared request engine',
    request.execution.auth === 'chatgpt' &&
      request.authentication === 'chatgpt' &&
      request.candidates.length === 3,
  );
  check(
    'Selected model and code/image/frozen selection reach native provider',
    calls.length === 3 &&
      calls.every(
        (c) =>
          c.value.model === 'qa-model' &&
          c.value.accountId === 'qa-registration' &&
          c.value.context.html &&
          c.value.context.image_url.startsWith('data:image/png') &&
          c.value.request.baseline.selection[0] === button.id,
      ),
  );
  check(
    'Receiving alternatives never auto applies current canvas',
    a.state.revision === revision && a.state.scene.codePatches.length === 0,
  );
  check(
    'All alternatives share frozen basis',
    request.candidates.every(
      (c) => c.point.codePatches.length === request.baseline.codePatches.length + 1,
    ),
  );
  click('#ai-close');
  click('#ai-variants-button');
  await until(() => $('#chatgpt-model')?.value === 'qa-model');
  check(
    'Reopening preserves explicit ChatGPT auth and existing alternatives',
    $('#ai-authentication').value === 'chatgpt' && a.state.aiRequests[0].candidates.length === 3,
  );
  w.chatgptMock.mode = 'failure';
  const before = w.chatgptMock.calls.filter((c) => c.name === 'generate').length;
  $('.ai-request-details').open = true;
  click('#ai-regenerate-baseline');
  await until(() => a.state.aiRequests[1]?.execution);
  check(
    'Plan limit stops after one attempt and preserves finished alternatives',
    a.state.aiRequests[1].execution.failures[0].code ===
      'subscription_sharing_usage_limit_exceeded' &&
      w.chatgptMock.calls.filter((c) => c.name === 'generate').length === before + 1 &&
      a.state.aiRequests[0].candidates.length === 3,
  );
  check(
    'No silent API-key switch or canvas mutation after plan error',
    $('#ai-authentication').value === 'chatgpt' && a.state.revision === revision,
  );
  const payload = JSON.stringify(
    reviewPayload(
      a.state.snapshot,
      a.state.scene,
      a.state.note,
      a.state.timeline,
      a.state.activity,
      a.state.activityHead,
      a.state.aiRequests,
    ),
  );
  check(
    'Editing export never gains OAuth credentials',
    !payload.includes('access_token') && !payload.includes('refresh_token'),
  );
  frame.style.width = '720px';
  frame.style.height = '600px';
  await tick();
  check(
    'Narrow auth section stays within viewport',
    d.documentElement.scrollWidth <= w.innerWidth + 1,
  );
  check('UI uses one modal for account setup', d.querySelectorAll('dialog:modal').length === 1);
} catch (error) {
  results.push({ name: String(error.stack || error), passed: false });
  document.querySelector('#results').textContent = results
    .map((r) => (r.passed ? 'PASS ' : 'FAIL ') + r.name)
    .join('\n');
}
document.querySelector('#status').textContent = JSON.stringify({
  passed: results.filter((r) => r.passed).length,
  failed: results.filter((r) => !r.passed).length,
  total: results.length,
});
window.__results = results;
document.body.dataset.result = results.every((r) => r.passed) ? 'pass' : 'fail';
