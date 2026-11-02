const $ = (selector) => document.querySelector(selector),
  params = new URLSearchParams(location.search);
const send = async (value) => {
  const r = await chrome.runtime.sendMessage(value);
  if (!r?.ok) throw Error(r?.error || '확장 연결을 확인해 주세요.');
  return r;
};
let preview, start, rect;
$('#cancel').onclick = () => window.close();
const point = (event) => {
  const r = $('#surface').getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(r.width, event.clientX - r.x)),
    y: Math.max(0, Math.min(r.height, event.clientY - r.y)),
  };
};
$('#surface').onpointerdown = (event) => {
  if (!preview) return;
  start = point(event);
  $('#surface').setPointerCapture(event.pointerId);
  $('#save').disabled = true;
  event.preventDefault();
};
$('#surface').onpointermove = (event) => {
  if (!start) return;
  const end = point(event);
  rect = {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
  Object.assign($('#selection').style, {
    left: rect.x + 'px',
    top: rect.y + 'px',
    width: rect.width + 'px',
    height: rect.height + 'px',
  });
  $('#selection').hidden = false;
};
$('#surface').onpointerup = () => {
  start = null;
  $('#save').disabled = !rect || rect.width < 4 || rect.height < 4;
};
$('#save').onclick = async () => {
  $('#save').disabled = true;
  try {
    const r = $('#surface').getBoundingClientRect(),
      sx = preview.view.width / r.width,
      sy = preview.view.height / r.height;
    const region = {
      x: rect.x * sx,
      y: rect.y * sy,
      width: rect.width * sx,
      height: rect.height * sy,
    };
    await send({
      action: 'capture',
      id: crypto.randomUUID(),
      tab_id: Number(params.get('tab')),
      project_id: params.get('project'),
      expected_document_id: preview.document_id,
      scope: { mode: 'region', rect: region, expectedView: preview.view },
    });
    $('#status').textContent = '가져오고 있습니다. 완료되면 편집기로 이동합니다.';
    window.close();
  } catch (error) {
    $('#status').textContent = error.message;
    $('#save').disabled = false;
  }
};
(async () => {
  preview = (await send({ action: 'region-preview', tab_id: Number(params.get('tab')) })).preview;
  $('#preview').src = preview.image;
})().catch((error) => ($('#status').textContent = error.message));
