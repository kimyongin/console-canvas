// Repair only already observed references. Payloads are inert binary images/fonts;
// original capture bytes are never replaced. Saved resource patches are offline.
const mimePattern =
  /^data:(image\/(?:png|jpeg|webp|gif|avif)|font\/(?:woff2?|ttf|otf));base64,([A-Za-z0-9+/]+={0,2})$/;
export function validateResourcePatch(op) {
  let url;
  try {
    url = new URL(op.resource_url);
  } catch {
    throw Error('자산 주소가 올바르지 않습니다.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    typeof op.data !== 'string' ||
    op.data.length > 1_500_000 ||
    !mimePattern.test(op.data)
  )
    throw Error('복구 자산은 1.5MB 이하의 실행 코드 없는 이미지·폰트여야 합니다.');
  if (
    op.data.startsWith('data:image/png;base64,') &&
    atob(op.data.slice(op.data.indexOf(',') + 1).slice(-32)).slice(-12) !==
      '\x00\x00\x00\x00IEND\xae\x42\x60\x82'
  )
    throw Error('끝이 잘린 PNG는 복구 자산으로 사용할 수 없습니다.');
  return url.href;
}
export function resourceCandidates(snapshot, patches = []) {
  const done = new Set(patches.filter((p) => p.type === 'resource').map((p) => p.resource_url)),
    urls = new Map();
  const add = (url, label) => {
    try {
      const u = new URL(url);
      if (
        ['http:', 'https:'].includes(u.protocol) &&
        !u.username &&
        !u.password &&
        !done.has(u.href) &&
        !urls.has(u.href)
      )
        urls.set(u.href, { url: u.href, label: label || u.hostname + u.pathname });
    } catch {}
  };
  for (const n of snapshot.nodes || [])
    if (n.image?.mode !== 'embedded' && !n.scopeHidden) add(n.image?.url, n.name);
  // Only literal references in the captured HTML can be repaired. Failed font
  // declarations that were never collected are honestly excluded.
  for (const m of snapshot.html.matchAll(/url\(\s*["']?(https?:\/\/[^\s"')]+)["']?\s*\)/g))
    add(m[1]);
  return [...urls.values()].slice(0, 32);
}
export function applyResourcePatch(doc, nodes, elements, op) {
  const url = validateResourcePatch(op);
  let changed = false;
  for (const [id, node] of nodes) {
    const el = elements.get(id);
    if (el?.localName === 'img' && (node.image?.url === url || el.getAttribute('src') === url)) {
      el.setAttribute('src', op.data);
      el.removeAttribute('srcset');
      el.removeAttribute('data-uic-image-fallback');
      el.removeAttribute('data-uic-image-coverage');
      node.image = { ...node.image, url, mode: 'embedded', broken: false };
      changed = true;
    }
  }
  const replace = (value) =>
    value.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (whole, _quote, found) => {
      if (found.trim() !== url) return whole;
      changed = true;
      return 'url("' + op.data + '")';
    });
  for (const el of doc.querySelectorAll('[style]'))
    el.setAttribute('style', replace(el.getAttribute('style')));
  for (const el of doc.querySelectorAll('style')) el.textContent = replace(el.textContent);
  if (!changed) throw Error('캡처에서 복구할 자산 선언을 찾지 못했습니다.');
}

export async function decodeResource(data) {
  let timer;
  try {
    const work = data.startsWith('data:image/')
      ? (async () => {
          const image = new Image();
          image.src = data;
          await image.decode();
          if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 16_000_000)
            throw Error('이미지 픽셀 한도를 초과했습니다.');
        })()
      : new FontFace('CanvasRepairValidation', 'url(' + data + ')').load();
    await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('자산 디코딩 시간 초과')), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
