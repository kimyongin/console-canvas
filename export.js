import { cleanHandoffSettings } from './workflow-state.js';
import { cleanAiDraft } from './ai-draft.js';
const encoder = new TextEncoder();
export function changeActionLabel(change) {
  return change.action === 'code'
    ? 'HTML·CSS 수정'
    : change.action === 'copy'
      ? '복사본 추가'
      : change.action === 'delete'
        ? change.copiedFrom
          ? '복사본 삭제'
          : '삭제'
        : '이동';
}
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export async function download(name, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type }),
    url = URL.createObjectURL(blob),
    a = document.createElement('a');
  if (window.ConsoleCanvasDesktop?.saveFile) {
    URL.revokeObjectURL(url);
    return window.ConsoleCanvasDesktop.saveFile({ name, bytes: await blob.arrayBuffer() });
  }
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 300000);
  return { requested: true };
}
export function instructionText(snapshot, changes, note = '', comments = []) {
  const lines = [
    '다음 콘솔 UI 편집 결과를 기준으로 화면을 수정하거나 구현 방향을 정리해 주세요.',
    '화면: ' + (snapshot.documentName || snapshot.source.title),
    '주소: ' + snapshot.source.url,
    '가져온 시각: ' + snapshot.capturedAt,
    '원본 화면 크기: ' + snapshot.source.viewport.width + ' × ' + snapshot.source.viewport.height,
    '',
    '요소 식별자와 위치는 가져온 시점 기준입니다. 실제 코드의 배치 구조와 반응형 동작에 맞게 적용해 주세요.',
    '원본 서비스와의 코드 연결은 포함되어 있지 않습니다.',
    '',
    '변경 내용:',
  ];
  for (const change of changes) {
    lines.push(
      '- [' +
        change.id +
        '] ' +
        change.name +
        ' (' +
        change.tag +
        '): ' +
        (change.action === 'code'
          ? 'HTML·CSS 수정'
          : change.action === 'copy'
            ? '복사본 추가 (원본 ' + change.copiedFrom + ')'
            : change.action === 'delete'
              ? change.copiedFrom
                ? '복사본 삭제 (참조 원본 ' + change.copiedFrom + '은 유지)'
                : '삭제'
              : '가로 ' + change.delta.x + 'px, 세로 ' + change.delta.y + 'px 이동') +
        (change.affectedDescendants
          ? ' · 하위 ' + change.affectedDescendants + '개 요소 포함'
          : ''),
    );
    lines.push('  원본 식별 정보: ' + JSON.stringify(change.locator));
  }
  if (!changes.length) lines.push('- 변경 없음');
  if (comments.length) {
    lines.push('', '요소별 주석 (아래 문구는 수정 요청이며 화면에 자동 적용되지 않았습니다):');
    for (const comment of comments) {
      lines.push(
        '- [' +
          comment.id +
          '] ' +
          comment.name +
          ' (' +
          comment.tag +
          ')' +
          (comment.copiedFrom ? ' · 복사본 (참조 원본 ' + comment.copiedFrom + ')' : '') +
          (comment.targetDeleted ? ' · 대상이 삭제된 상태' : ''),
        '  요청: ' + comment.text,
        '  원본 식별 정보: ' + JSON.stringify(comment.locator),
      );
    }
  }
  if (note.trim()) lines.push('', '추가 설명:', note.trim());
  lines.push(
    '',
    'ZIP의 changes.json에 상세 변경 사항, review.html에 비교 화면, review.json에 다시 편집할 수 있는 전체 화면이 있습니다.',
  );
  return lines.join('\n');
}
export function reviewPayload(
  snapshot,
  scene,
  note = '',
  timeline = null,
  activity = [],
  activityHead = null,
  aiRequests = [],
  aiDraft,
  workflow = {},
) {
  return {
    format: 'console-canvas-review',
    version: 1,
    createdAt: new Date().toISOString(),
    activity,
    activityHead,
    snapshot,
    codePatches: scene.codePatches || [],
    aiRequests,
    aiDraft: cleanAiDraft(aiDraft),
    handoffSettings: cleanHandoffSettings(workflow.handoffSettings),
    implementationReviews: workflow.implementationReviews || [],
    edits: scene.edits,
    annotations: scene.annotations,
    comments: scene.comments(),
    changes: scene.changes(),
    note,
    ...(timeline ? { timeline } : {}),
  };
}
function reportRuntime() {
  const data = JSON.parse(document.getElementById('review-data').textContent),
    frame = document.getElementById('screen'),
    host = document.getElementById('screen-host');
  let current = 'after',
    scale = 1;
  function draw() {
    document
      .querySelectorAll('[data-view]')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === current)));
    frame.srcdoc = current === 'before' ? data.before : data.after;
    const width = data.width,
      height = data.height;
    scale = Math.min(1, (document.getElementById('viewport').clientWidth - 64) / width);
    frame.width = width;
    frame.height = height;
    frame.style.transform = 'scale(' + scale + ')';
    host.style.width = width * scale + 'px';
    host.style.height = height * scale + 'px';
  }
  document.querySelectorAll('[data-view]').forEach((button) =>
    button.addEventListener('click', () => {
      current = button.dataset.view;
      draw();
    }),
  );
  document.getElementById('notes').textContent = data.instructions;
  window.addEventListener('resize', draw);
  draw();
}
export function makeReport(snapshot, before, after, instructions, size) {
  const payload = JSON.stringify({
    before,
    after,
    instructions,
    width: size.width,
    height: size.height,
  }).replace(/</g, '\\u003c');
  return (
    '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Console Canvas · 편집 결과</title><style>' +
    'body{margin:0;color:#303549;background:#f4f5f9;font:14px/1.7 system-ui,sans-serif}header{padding:18px 25px;background:white;border-bottom:1px solid #e0e3ec;display:flex;align-items:center;justify-content:space-between;gap:15px;flex-wrap:wrap}h1{font-size:17px;margin:0}header p{margin:3px 0 0;color:#939aae;font-size:11px}button{font:inherit;border:1px solid #dddfea;background:white;border-radius:6px;padding:8px 14px;color:#777e91;cursor:pointer}button[aria-pressed=true]{background:#5a55d9;border-color:#5a55d9;color:white}#viewport{overflow:auto;padding:32px;max-height:75vh}#screen-host{position:relative;margin:0 auto;background:white;box-shadow:0 5px 30px #30354915}iframe{border:0;position:absolute;left:0;top:0;transform-origin:0 0;background:white}details{margin:20px 25px;background:white;border:1px solid #e0e3ec;border-radius:9px;padding:15px}summary{cursor:pointer}pre{white-space:pre-wrap;font:12px/1.9 system-ui,sans-serif;overflow-wrap:anywhere}</style></head><body><header><div><h1>' +
    escapeHtml(snapshot.documentName || snapshot.source.title || '콘솔 화면') +
    ' · 편집 결과</h1><p>' +
    escapeHtml(snapshot.source.url) +
    '</p></div><div><button data-view="before" aria-pressed="false">변경 전</button> <button data-view="after" aria-pressed="true">변경 후</button></div></header><div id="viewport"><div id="screen-host"><iframe id="screen" title="변경 전후 화면" sandbox="allow-same-origin" referrerpolicy="no-referrer"></iframe></div></div><details open><summary>전달할 편집 방향</summary><pre id="notes"></pre></details><script type="application/json" id="review-data">' +
    payload +
    '</script><script>(' +
    reportRuntime.toString() +
    ')();</script></body></html>'
  );
}
export async function renderPng(html, width, height) {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed
    .querySelectorAll('[data-uic-editor]:not([data-uic-editor="portal"])')
    .forEach((el) => el.remove());
  const root = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
  root.style.cssText =
    'position:relative;width:' +
    width +
    'px;height:' +
    height +
    'px;overflow:hidden;background:white';
  for (const style of parsed.head.querySelectorAll('style'))
    root.append(document.importNode(style, true));
  const body = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
  for (const attr of parsed.body.attributes) body.setAttribute(attr.name, attr.value);
  for (const child of [...parsed.body.childNodes]) body.append(document.importNode(child, true));
  root.append(body);
  for (const extra of parsed.documentElement.children)
    if (!['HEAD', 'BODY'].includes(extra.tagName)) root.append(document.importNode(extra, true));
  // SVG images cannot load external resources. Keep the HTML report as the authoritative view.
  for (const image of root.querySelectorAll('img'))
    if (!image.getAttribute('src')?.startsWith('data:')) image.removeAttribute('src');
  const scale = Math.min(1, Math.sqrt(16_000_000 / (width * height)), 8192 / width, 16384 / height);
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    Math.ceil(width * scale) +
    '" height="' +
    Math.ceil(height * scale) +
    '" viewBox="0 0 ' +
    width +
    ' ' +
    height +
    '"><foreignObject width="100%" height="100%">' +
    new XMLSerializer().serializeToString(root) +
    '</foreignObject></svg>';
  const image = new Image();
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await Promise.race([
    image.decode(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('비교 이미지 생성 시간 초과')), 7000),
    ),
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  canvas.getContext('2d').drawImage(image, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('비교 이미지를 생성하지 못했습니다.');
  return blob;
}
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export async function zipFiles(files) {
  const chunks = [],
    directory = [],
    now = new Date();
  let offset = 0;
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1),
    dosDate =
      ((Math.max(1980, now.getFullYear()) - 1980) << 9) |
      ((now.getMonth() + 1) << 5) |
      now.getDate();
  for (const [name, value] of Object.entries(files)) {
    const bytes =
      value instanceof Blob
        ? new Uint8Array(await value.arrayBuffer())
        : value instanceof Uint8Array
          ? value
          : encoder.encode(value);
    const filename = encoder.encode(name),
      crc = crc32(bytes),
      header = new Uint8Array(30 + filename.length),
      view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, bytes.length, true);
    view.setUint32(22, bytes.length, true);
    view.setUint16(26, filename.length, true);
    header.set(filename, 30);
    view.setUint16(10, dosTime, true);
    view.setUint16(12, dosDate, true);
    const central = new Uint8Array(46 + filename.length),
      cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, bytes.length, true);
    cv.setUint32(24, bytes.length, true);
    cv.setUint16(28, filename.length, true);
    cv.setUint32(42, offset, true);
    central.set(filename, 46);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    chunks.push(header, bytes);
    directory.push(central);
    offset += header.length + bytes.length;
  }
  const size = directory.reduce((sum, entry) => sum + entry.length, 0),
    end = new Uint8Array(22),
    ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, directory.length, true);
  ev.setUint16(10, directory.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, offset, true);
  return new Blob([...chunks, ...directory, end], { type: 'application/zip' });
}
export async function buildReview(
  snapshot,
  scene,
  note,
  onProgress = () => {},
  timeline = null,
  session = {},
) {
  onProgress('변경 전후 화면을 정리하고 있어요.');
  const before = await scene.beforeHtml(),
    after = scene.serialize(),
    changes = scene.changes(),
    size = scene.contentSize();
  const comments = scene.comments(),
    instructions = instructionText(snapshot, changes, note, comments),
    payload = reviewPayload(
      snapshot,
      scene,
      note,
      timeline,
      session.activity || [],
      session.activityHead || null,
      session.aiRequests || [],
      session.aiDraft,
      session,
    ),
    warnings = [];
  const files = {
    'changes.json': JSON.stringify(
      {
        format: 'console-canvas-changes',
        version: 1,
        source: snapshot.source,
        note,
        changes,
        comments,
      },
      null,
      2,
    ),
    'instructions.txt': instructions,
    'review.json': JSON.stringify(payload),
    'before.html': before,
    'after.html': after,
    'review.html': makeReport(snapshot, before, after, instructions, size),
  };
  onProgress('비교 이미지를 만들고 있어요.');
  const images = await Promise.allSettled([
    renderPng(before, size.width, size.height),
    renderPng(after, size.width, size.height),
  ]);
  images.forEach((result, index) => {
    if (result.status === 'fulfilled') files[index ? 'after.png' : 'before.png'] = result.value;
    else warnings.push(result.reason.message);
  });
  if (snapshot.screenshot) {
    const comma = snapshot.screenshot.indexOf(',');
    if (/^data:image\/png;base64,/.test(snapshot.screenshot))
      files['source-viewport.png'] = Uint8Array.from(
        atob(snapshot.screenshot.slice(comma + 1)),
        (c) => c.charCodeAt(0),
      );
  }
  files['READ-ME.txt'] =
    'Console Canvas 편집 결과\n\n1. review.html을 브라우저에서 열어 변경 전후를 비교합니다.\n2. changes.json과 instructions.txt에 요소별 변경 방향이 있습니다.\n3. review.json을 Console Canvas에서 열면 계속 편집할 수 있습니다.\n4. 이 ZIP을 Codex 대화에 첨부하고 "이 편집 결과를 기준으로 수정해 줘"라고 요청하세요.\n\n비교 PNG는 보조 이미지입니다. 외부 이미지·폰트가 있는 경우 HTML 비교 화면을 함께 확인하세요. 원본 페이지의 스크립트는 실행되지 않습니다.\n' +
    (warnings.length ? '\n이미지 생성 참고: ' + warnings.join('; ') : '');
  onProgress('전달 파일을 묶고 있어요.');
  return { blob: await zipFiles(files), warnings, fileNames: Object.keys(files) };
}
