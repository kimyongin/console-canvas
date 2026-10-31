import { renderScope } from './capture-scope.js';
export function changeActionLabel(change) {
  return change.action === 'resource'
    ? '이미지·폰트 복구'
    : change.action === 'copy'
      ? '복사본 추가'
      : change.action === 'delete'
        ? change.copiedFrom
          ? '복사본 삭제'
          : '삭제'
        : '이동';
}

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

export async function renderPng(html, width, height) {
  const view = renderScope(html, width, height);
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
  const scale = Math.min(
    1,
    Math.sqrt(16_000_000 / (view.width * view.height)),
    8192 / view.width,
    16384 / view.height,
  );
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    Math.ceil(view.width * scale) +
    '" height="' +
    Math.ceil(view.height * scale) +
    '" viewBox="' +
    view.x +
    ' ' +
    view.y +
    ' ' +
    view.width +
    ' ' +
    view.height +
    '"><foreignObject width="' +
    width +
    '" height="' +
    height +
    '">' +
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
  canvas.width = Math.ceil(view.width * scale);
  canvas.height = Math.ceil(view.height * scale);
  canvas.getContext('2d').drawImage(image, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('비교 이미지를 생성하지 못했습니다.');
  return blob;
}
