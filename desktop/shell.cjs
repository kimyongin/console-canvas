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
  $('#capture-menu-button').hidden = value.view !== 'source';
  $('#capture-menu-button').disabled = !!value.busy;
  $('#cancel-review-capture').hidden = !value.review_target;
  updateCaptureLabel();
  if (value.review_target && value.view === 'source')
    $('#status').textContent =
      '목표: ' + value.review_target.label + ' · 결과 상태를 확인해 주세요.';
  $('#capture-picker').hidden = value.view !== 'capture';
  $('#capture').disabled = !!value.busy;
  $('#capture-app').disabled = !!value.busy || value.view === 'capture';
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
  $('#fallback').hidden = ['settings', 'agent', 'update', 'capture'].includes(value.view);
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
async function captureCurrent() {
  try {
    localStorage.setItem('capture-scope', captureMode);
    if (captureMode === 'region') {
      regionPreview = await api.previewCapture();
      regionRect = null;
      $('#capture-photo').src = regionPreview.data;
      $('#capture-selection').hidden = true;
      $('#capture-region-confirm').disabled = true;
      $('#capture-region-size').textContent = '아직 선택하지 않았습니다.';
    } else await api.capture({ mode: captureMode });
  } catch (error) {
    $('#status').textContent = error.message;
    $('#capture').hidden = currentState.view !== 'source';
    $('#capture').disabled = false;
  }
}
$('#capture').addEventListener('click', captureCurrent);
let appCapturePending = false;
$('#capture-app').addEventListener('click', async () => {
  if (appCapturePending) return;
  appCapturePending = true;
  try {
    await api.captureApp();
  } catch (error) {
    $('#status').textContent = error.message;
  } finally {
    appCapturePending = false;
  }
});
$('#capture-menu-button').addEventListener('click', async () => {
  try {
    const r = $('#capture-menu-button').getBoundingClientRect();
    const mode = await api.chooseCaptureMode({ x: r.left, y: r.bottom });
    if (!mode) return;
    captureMode = mode;
    updateCaptureLabel();
    await captureCurrent();
  } catch (error) {
    $('#status').textContent = error.message;
  }
});
$('#cancel-review-capture').addEventListener('click', () =>
  api.cancelReview(currentState.review_target?.request_id),
);
api.onFocusAddress?.(() => {
  $('#address').focus();
  $('#address').select();
});
$('#show-settings').addEventListener('click', async () => {
  await api.show('settings');
  try {
    const value = await api.skillInfo();
    displaySkill(value);
    $('#quick-skill-info').textContent = '앱 v' + value.version + ' · 설치 대상 ' + value.path;
  } catch (error) {
    $('#quick-agent-status').textContent = error.message;
  }
});
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
    const value = await api.updateInfo();
    displayUpdate(value);
    if (!['checking', 'downloading', 'ready', 'installing'].includes(value.phase)) {
      const checked = await api.checkUpdate();
      displayUpdate(checked);
      if (checked.phase === 'available' && $('#auto-download-updates').checked)
        displayUpdate(await api.downloadUpdate());
    }
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

let regionPreview = null,
  regionRect = null,
  regionStart = null;
let captureMode = ['viewport', 'document', 'region'].includes(localStorage.getItem('capture-scope'))
  ? localStorage.getItem('capture-scope')
  : 'viewport';
function updateCaptureLabel() {
  const name = { viewport: '현재 화면', document: '전체 페이지', region: '영역 지정' }[captureMode];
  $('#capture').textContent = currentState?.review_target
    ? '이 검토에 가져오기 · ' + name
    : name + ' 가져오기 →';
}
updateCaptureLabel();
const photoPoint = (e) => {
  const b = $('#capture-photo').getBoundingClientRect();
  return {
    x: Math.max(
      0,
      Math.min(
        regionPreview.view.width,
        ((e.clientX - b.left) / b.width) * regionPreview.view.width,
      ),
    ),
    y: Math.max(
      0,
      Math.min(
        regionPreview.view.height,
        ((e.clientY - b.top) / b.height) * regionPreview.view.height,
      ),
    ),
  };
};
function paintRegion() {
  if (!regionRect || !regionPreview) return;
  const b = $('#capture-photo').getBoundingClientRect(),
    sx = b.width / regionPreview.view.width,
    sy = b.height / regionPreview.view.height;
  const el = $('#capture-selection');
  el.hidden = false;
  Object.assign(el.style, {
    left: regionRect.x * sx + 'px',
    top: regionRect.y * sy + 'px',
    width: regionRect.width * sx + 'px',
    height: regionRect.height * sy + 'px',
  });
  $('#capture-region-size').textContent =
    regionRect.width + ' × ' + regionRect.height + ' px · 방향키 이동 · Shift+방향키 크기 조절';
  $('#capture-region-confirm').disabled = regionRect.width < 4 || regionRect.height < 4;
}
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
$('#capture-photo-wrap').addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !regionPreview) return;
  e.preventDefault();
  const p = photoPoint(e),
    handle = e.target.closest('[data-handle]')?.dataset.handle;
  regionStart = {
    point: p,
    kind: regionRect && e.target.closest('#capture-selection') ? handle || 'move' : 'new',
    rect: regionRect && { ...regionRect },
  };
  e.currentTarget.setPointerCapture(e.pointerId);
});
$('#capture-photo-wrap').addEventListener('pointermove', (e) => {
  if (!regionStart || !regionPreview) return;
  const p = photoPoint(e),
    dx = Math.round(p.x - regionStart.point.x),
    dy = Math.round(p.y - regionStart.point.y),
    r = regionStart.rect,
    v = regionPreview.view;
  if (regionStart.kind === 'new')
    regionRect = {
      x: Math.floor(Math.min(p.x, regionStart.point.x)),
      y: Math.floor(Math.min(p.y, regionStart.point.y)),
      width: Math.max(1, Math.floor(Math.abs(p.x - regionStart.point.x))),
      height: Math.max(1, Math.floor(Math.abs(p.y - regionStart.point.y))),
    };
  else if (regionStart.kind === 'move')
    regionRect = {
      ...r,
      x: clamp(r.x + dx, 0, v.width - r.width),
      y: clamp(r.y + dy, 0, v.height - r.height),
    };
  else {
    const k = regionStart.kind;
    let left = r.x,
      top = r.y,
      right = r.x + r.width,
      bottom = r.y + r.height;
    if (k.includes('w')) left = clamp(r.x + dx, 0, right - 4);
    if (k.includes('e')) right = clamp(right + dx, left + 4, v.width);
    if (k.includes('n')) top = clamp(r.y + dy, 0, bottom - 4);
    if (k.includes('s')) bottom = clamp(bottom + dy, top + 4, v.height);
    regionRect = { x: left, y: top, width: right - left, height: bottom - top };
  }
  paintRegion();
});
$('#capture-photo-wrap').addEventListener('pointerup', () => {
  regionStart = null;
  if (regionRect) $('#capture-selection').focus();
});
$('#capture-photo-wrap').addEventListener('pointercancel', () => {
  regionStart = null;
});
$('#capture-selection').addEventListener('keydown', (e) => {
  if (!regionRect || !regionPreview) return;
  const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
    e.key
  ];
  if (!delta) return;
  e.preventDefault();
  if (e.shiftKey) {
    regionRect.width = clamp(
      regionRect.width + delta[0],
      4,
      regionPreview.view.width - regionRect.x,
    );
    regionRect.height = clamp(
      regionRect.height + delta[1],
      4,
      regionPreview.view.height - regionRect.y,
    );
  } else {
    regionRect.x = clamp(regionRect.x + delta[0], 0, regionPreview.view.width - regionRect.width);
    regionRect.y = clamp(regionRect.y + delta[1], 0, regionPreview.view.height - regionRect.height);
  }
  paintRegion();
});
window.addEventListener('resize', paintRegion);
$('#capture-region-cancel').addEventListener('click', () => api.show('source'));
$('#capture-region-confirm').addEventListener('click', async () => {
  if (!regionRect) return;
  $('#capture-region-confirm').disabled = true;
  try {
    await api.capture({ mode: 'region', rect: regionRect, expectedView: regionPreview.view });
  } catch (error) {
    await api.show('source');
    $('#status').textContent = error.message;
  }
});

$('#quick-install-skill').addEventListener('click', async () => {
  const button = $('#quick-install-skill');
  button.disabled = true;
  try {
    const value = await api.installSkill();
    displaySkill(value);
    $('#quick-agent-status').textContent = '스킬 설치·업데이트 완료. 이전 관리 파일은 백업됩니다.';
  } catch (error) {
    $('#quick-agent-status').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
$('#quick-copy-mcp').addEventListener('click', async () => {
  try {
    await api.copyMcpCommand();
    $('#quick-agent-status').textContent =
      '등록 명령을 복사했습니다. 터미널에서 실행하고 실제 도구 연결을 확인해 주세요.';
  } catch (error) {
    $('#quick-agent-status').textContent = error.message;
  }
});

$('#auto-download-updates').checked =
  localStorage.getItem('console-canvas-auto-download-updates') === 'true';
$('#auto-download-updates').addEventListener('change', () =>
  localStorage.setItem(
    'console-canvas-auto-download-updates',
    String($('#auto-download-updates').checked),
  ),
);
