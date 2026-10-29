// Image pixels are reconstructed solely from document-embedded captures. No
// source URL is requested when an image needs screenshot fallback.
function intersect(a, b) {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
}
function area(rects) {
  const xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.width]))].sort((a, b) => a - b);
  let total = 0;
  for (let i = 1; i < xs.length; i++) {
    const ranges = rects
      .filter((r) => r.x <= xs[i - 1] && r.x + r.width >= xs[i])
      .map((r) => [r.y, r.y + r.height])
      .sort((a, b) => a[0] - b[0]);
    let lo = 0,
      hi = 0,
      length = 0;
    for (const [a, b] of ranges) {
      if (a > hi) {
        length += hi - lo;
        lo = a;
        hi = b;
      } else hi = Math.max(hi, b);
    }
    total += (xs[i] - xs[i - 1]) * (length + hi - lo);
  }
  return total;
}
export async function applyCaptureMedia(scene) {
  const snapshot = scene.snapshot,
    doc = scene.doc;
  const descriptions = [...(snapshot.screenshotTiles || [])];
  if (snapshot.screenshot)
    descriptions.push({
      rect: { ...snapshot.source.scroll, ...snapshot.source.viewport },
      data: snapshot.screenshot,
    });
  const sources = [];
  for (const description of descriptions) {
    try {
      const image = new doc.defaultView.Image();
      image.src = description.data;
      await image.decode();
      sources.push({ ...description, image });
    } catch {}
  }
  function crop(rect, clip) {
    if (!rect.width || !rect.height) return null;
    const target = intersect(clip ? intersect(rect, clip) : rect, {
      x: 0,
      y: 0,
      width: scene.snapshot.source.width,
      height: scene.snapshot.source.height,
    });
    if (!target.width || !target.height) return null;
    const parts = sources
      .map((s) => ({
        source: s,
        rect: intersect(target, s.clip ? intersect(s.rect, s.clip) : s.rect),
      }))
      .filter((p) => p.rect.width > 0 && p.rect.height > 0);
    if (!parts.length) return null;
    const density = Math.min(
      2,
      Math.max(...parts.map((p) => p.source.image.naturalWidth / p.source.rect.width)),
    );
    const scale = Math.min(
      density,
      Math.sqrt(16_000_000 / (rect.width * rect.height)),
      32760 / Math.max(rect.width, rect.height),
    );
    const canvas = doc.createElement('canvas');
    canvas.width = Math.max(1, Math.round(rect.width * scale));
    canvas.height = Math.max(1, Math.round(rect.height * scale));
    const context = canvas.getContext('2d');
    for (const { source: s, rect: r } of parts) {
      const sx = s.image.naturalWidth / s.rect.width,
        sy = s.image.naturalHeight / s.rect.height;
      context.drawImage(
        s.image,
        (r.x - s.rect.x) * sx,
        (r.y - s.rect.y) * sy,
        r.width * sx,
        r.height * sy,
        (r.x - rect.x) * scale,
        (r.y - rect.y) * scale,
        r.width * scale,
        r.height * scale,
      );
    }
    return {
      data: canvas.toDataURL('image/png'),
      coverage:
        area(parts.map((p) => p.rect)) >= target.width * target.height - 0.5 ? 'full' : 'partial',
    };
  }
  for (const node of scene.nodes.values()) {
    const element = scene.elements.get(node.id);
    if (!element) continue;
    if (node.background?.mode === 'screenshot') {
      const result = crop(
        node.kind === 'pseudo' ? scene.rect(node.id) : node.rect,
        node.captureClip,
      );
      element.dataset.uicBackgroundCoverage = result?.coverage || 'unavailable';
      if (result) {
        element.style.backgroundImage = 'url("' + result.data + '")';
        element.style.backgroundSize = '100% 100%';
        element.style.backgroundPosition = '0 0';
        element.style.backgroundRepeat = 'no-repeat';
        element.style.backgroundOrigin = 'border-box';
        element.style.backgroundClip = 'border-box';
        element.style.maskImage = 'none';
        element.style.webkitMaskImage = 'none';
      }
    }
    let incompletePng = false;
    if (node.image && /^data:image\/png;base64,/i.test(element.getAttribute('src') || ''))
      try {
        const src = element.getAttribute('src');
        incompletePng =
          doc.defaultView.atob(src.slice(src.indexOf(',') + 1).slice(-32)).slice(-12) !==
          '\x00\x00\x00\x00IEND\xae\x42\x60\x82';
      } catch {
        incompletePng = true;
      }
    // Repair older captures too, without rewriting their immutable HTML/nodes.
    if (node.image?.mode === 'screenshot' || incompletePng) {
      const result = crop(node.image.contentRect || node.rect, node.captureClip);
      element.dataset.uicImageCoverage = result?.coverage || 'unavailable';
      element.dataset.uicImageRendering = 'source-pixels';
      if (result) {
        element.src = result.data;
        element.style.objectFit = 'fill';
        element.style.objectPosition = 'center';
        element.removeAttribute('data-uic-image-fallback');
      }
      element.title =
        result?.coverage === 'full'
          ? '가져올 당시의 이미지입니다.'
          : result
            ? '화면에 보였던 부분만 포함한 이미지입니다.'
            : '원본 이미지 픽셀을 가져오지 못했습니다.';
    }
    if (node.kind === 'raster' && !element.querySelector('img')) {
      const result = crop(
        node.rasterContentRect || node.frame?.contentRect || node.rect,
        node.captureClip,
      );
      element.dataset.uicRasterCoverage = result?.coverage || 'unavailable';
      if (!result) {
        element.textContent = sources.length
          ? '이미지 영역 · 화면 밖 부분은 가져오지 못했습니다'
          : '이미지 캡처 없음 · 다시 가져와 주세요';
        continue;
      }
      const image = doc.createElement('img');
      image.src = result.data;
      image.style.cssText = 'display:block;width:100%;height:100%;object-fit:fill';
      const holder = doc.createElement('div');
      holder.style.cssText = 'width:100%;height:100%;overflow:hidden;background:#f2f4f7';
      holder.dataset.uicRasterCoverage = result.coverage;
      holder.title =
        result.coverage === 'full'
          ? '이미지 한 레이어입니다. 이동·삭제·주석할 수 있습니다.'
          : '일부 영역의 이미지가 누락되었습니다. 전체 캡처를 완료하지 못했습니다.';
      holder.append(image);
      element.replaceChildren(holder);
    }
  }
}
