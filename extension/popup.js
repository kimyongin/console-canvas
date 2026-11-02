const $ = (selector) => document.querySelector(selector);
const send = async (message) => {
  const r = await chrome.runtime.sendMessage(message);
  if (!r?.ok) throw Error(r?.error || '확장을 다시 로드해 주세요.');
  return r;
};
let job = null,
  source = null;
const status = (message) => ($('#status').textContent = message || '');
function projectChoice() {
  const fresh = $('#project').value === 'new';
  $('#new-project').hidden = !fresh;
  $('#project-name').required = fresh;
}
function showJob(value) {
  job = value;
  const busy = value?.stage === 'running';
  $('#capture').disabled = busy;
  $('#cancel').hidden = !busy;
  if (busy) status('화면을 가져오고 있습니다. 이 창을 닫아도 계속 진행됩니다.');
  else if (value?.stage === 'complete')
    status(
      value.open_error
        ? '저장했습니다. 열린 편집을 마친 뒤 편집기 열기를 눌러 주세요.'
        : '가져왔습니다. 편집기에서 확인하세요.',
    );
  else if (value?.error) status(value.error);
}
$('#project').onchange = async () => {
  projectChoice();
  if ($('#project').value !== 'new')
    await send({ action: 'select-project', project_id: $('#project').value });
};
$('#editor').onclick = () =>
  send({
    action: 'editor',
    ticket_id: job?.stage === 'complete' ? job.ticket_id : undefined,
  }).catch((error) => status(error.message));
$('#cancel').onclick = () =>
  send({ action: 'cancel', id: job.id }).catch((error) => status(error.message));
$('#scope').onchange = () => {
  $('#capture').textContent = {
    viewport: '현재 화면 가져오기',
    document: '전체 페이지 가져오기',
    region: '영역 선택',
  }[$('#scope').value];
};
$('#capture-form').onsubmit = async (event) => {
  event.preventDefault();
  $('#capture').disabled = true;
  status('');
  try {
    let project_id = $('#project').value;
    if (project_id === 'new') {
      const { project } = await send({ action: 'create-project', name: $('#project-name').value });
      $('#project').insertBefore(
        new Option(project.name, project.id),
        $('#project').lastElementChild,
      );
      $('#project').value = project.id;
      projectChoice();
      project_id = project.id;
    }
    if (!source || !/^https?:\/\//.test(source.url || ''))
      throw Error('Chrome에서 가져올 웹페이지를 먼저 열어 주세요.');
    const mode = $('#scope').value;
    if (mode === 'region') {
      const query = new URLSearchParams({ tab: String(source.id), project: project_id });
      await chrome.tabs.create({ url: chrome.runtime.getURL('region.html') + '?' + query });
      return;
    }
    const { job: value } = await send({
      action: 'capture',
      id: crypto.randomUUID(),
      tab_id: source.id,
      expected_url: source.url,
      project_id,
      scope: { mode },
    });
    showJob(value);
  } catch (error) {
    status(error.message);
    $('#capture').disabled = false;
  }
};
(async () => {
  [source] = await chrome.tabs.query({ active: true, currentWindow: true });
  const value = await send({ action: 'state' });
  for (const project of value.projects) $('#project').add(new Option(project.name, project.id));
  $('#project').add(new Option('+ 새 프로젝트', 'new'));
  $('#project').value = value.active_project || value.projects[0]?.id || 'new';
  projectChoice();
  showJob(value.job);
  if (!source || !/^https?:\/\//.test(source.url || '')) {
    $('#capture').disabled = true;
    status('가져올 웹페이지에서 확장 버튼을 눌러 주세요.');
  }
})().catch((error) => status(error.message));
setInterval(async () => {
  if (job?.stage === 'running')
    try {
      showJob((await send({ action: 'job', id: job.id })).job);
    } catch (error) {
      status(error.message);
    }
}, 600);
