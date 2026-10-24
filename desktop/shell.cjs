const api = window.ConsoleCanvasShell,
  $ = (selector) => document.querySelector(selector);
let info,
  currentState,
  returnView = 'source';
function showState(value) {
  if (['source', 'editor'].includes(value.view)) returnView = value.view;
  currentState = value;
  document.body.dataset.view = value.view;
  document.documentElement.style.setProperty('--shell-height', value.header_height + 'px');
  $('#navigation').hidden = value.view !== 'source';
  if (value.url && document.activeElement !== $('#address')) $('#address').value = value.url;
  $('#status').textContent = value.message || '';
  $('#capture').hidden = value.view !== 'source';
  $('#capture').disabled = !!value.busy;
  for (const view of ['source', 'editor', 'settings', 'agent', 'update'])
    $('#show-' + view).classList.toggle('active', value.view === view);
  $('#back').disabled = !value.can_go_back;
  $('#forward').disabled = !value.can_go_forward;
  $('#settings-setup').hidden = value.view !== 'settings';
  $('#show-settings').classList.toggle(
    'active',
    ['settings', 'agent', 'update'].includes(value.view),
  );
  $('#agent-setup').hidden = value.view !== 'agent';
  $('#update-setup').hidden = value.view !== 'update';
  $('#fallback').hidden = ['settings', 'agent', 'update'].includes(value.view);
}
api.onState(showState);
api.info().then((value) => {
  info = value;
  showState(value);
});
$('#navigation').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api.navigate($('#address').value);
  } catch (error) {
    $('#status').textContent = error.message;
  }
});
$('#capture').addEventListener('click', async () => {
  try {
    await api.capture();
  } catch (error) {
    $('#status').textContent = error.message;
    $('#capture').hidden = currentState.view !== 'source';
    $('#capture').disabled = false;
  }
});
$('#show-settings').addEventListener('click', () => api.show('settings'));
$('#settings-return').addEventListener('click', () => api.show(returnView));
for (const button of document.querySelectorAll('.settings-back'))
  button.addEventListener('click', () => api.show('settings'));
$('#show-source').addEventListener('click', () => api.show('source'));
$('#show-editor').addEventListener('click', () => api.show('editor'));
$('#back').addEventListener('click', () => api.back());
$('#forward').addEventListener('click', () => api.forward());
$('#reload').addEventListener('click', () => api.reload());
$('#demo').addEventListener('click', () =>
  api.navigate(info.demo_url).catch((error) => ($('#status').textContent = error.message)),
);
function skillSyncText(value) {
  if (value?.errors?.length)
    return (
      '스킬 자동 업데이트를 완료하지 못했습니다: ' +
      value.errors.map((item) => (item.path || '') + ' ' + item.message).join(' · ')
    );
  if (value?.updated?.length)
    return '스킬 자동 업데이트 완료 · ' + value.updated.length + '곳 · 이전 파일을 백업했습니다.';
  if (value?.current?.length) return '설치된 스킬이 앱과 같은 버전입니다.';
  return '설치된 스킬은 앱 업데이트 후 자동으로 갱신됩니다.';
}
function displaySkill(value) {
  $('#skill-auto-status').textContent = skillSyncText(value.auto_update);
  $('#skill-version').textContent = '앱 번들 v' + value.version;
  $('#skill-path').textContent = value.path;
  $('#skill-install-status').textContent = value.current
    ? '설치된 스킬이 앱과 같습니다.'
    : value.installed
      ? '스킬 업데이트가 있습니다.'
      : '스킬을 설치할 수 있습니다.';
  $('#install-skill').textContent = value.current ? '스킬 설치 확인' : 'Codex 스킬 설치·업데이트';
  $('#mcp-command').value = value.mcp_command;
}
$('#show-agent').addEventListener('click', async () => {
  await api.show('agent');
  try {
    displaySkill(await api.skillInfo());
  } catch (error) {
    $('#agent-result').textContent = error.message;
  }
});
$('#install-skill').addEventListener('click', async () => {
  const button = $('#install-skill');
  button.disabled = true;
  try {
    const result = await api.installSkill();
    displaySkill(result);
    $('#agent-result').textContent =
      '스킬을 설치했습니다. 다음 대화에서 $console-canvas로 사용할 수 있습니다.' +
      (result.backup ? ' 이전 파일 백업: ' + result.backup : '');
  } catch (error) {
    $('#agent-result').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
$('#save-skill').addEventListener('click', async () => {
  try {
    const result = await api.saveSkill();
    if (!result.canceled)
      $('#agent-result').textContent = '스킬 ZIP을 저장했습니다: ' + result.path;
  } catch (error) {
    $('#agent-result').textContent = error.message;
  }
});
$('#copy-mcp').addEventListener('click', async () => {
  try {
    await api.copyMcpCommand();
    $('#agent-result').textContent =
      'MCP 등록 명령을 복사했습니다. 터미널에서 한 번 실행하고 에이전트의 MCP 연결을 시작해 주세요.';
  } catch (error) {
    $('#agent-result').textContent = error.message;
  }
});
function displayUpdate(value) {
  $('#update-skill-status').textContent = skillSyncText(value.skill_update);
  const working = ['checking', 'downloading', 'installing'].includes(value.phase);
  $('#update-version').textContent = '현재 버전 v' + value.current_version;
  $('#update-title').textContent = value.latest_version
    ? 'v' + value.latest_version + ' 업데이트'
    : value.phase === 'current'
      ? '최신 버전입니다'
      : '새 버전 확인';
  $('#update-message').textContent = value.message;
  $('#check-update').disabled = working || value.phase === 'ready';
  $('#download-update').hidden = value.phase !== 'available';
  $('#install-update').hidden = !['ready', 'installing'].includes(value.phase);
  $('#install-update').disabled = working;
  $('#update-progress').hidden = value.phase !== 'downloading';
  $('#update-progress').value = value.percent || 0;
}
api.onUpdate(displayUpdate);
api.updateInfo().then(displayUpdate);
$('#show-update').addEventListener('click', async () => {
  try {
    await api.show('update');
    displayUpdate(await api.updateInfo());
  } catch (error) {
    $('#update-message').textContent = error.message;
  }
});
for (const [id, method] of [
  ['check-update', 'checkUpdate'],
  ['download-update', 'downloadUpdate'],
  ['install-update', 'installUpdate'],
])
  $('#' + id).addEventListener('click', async () => {
    try {
      await api[method]();
    } catch (error) {
      $('#update-message').textContent = error.message;
    }
  });
