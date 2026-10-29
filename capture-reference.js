import { viewRect } from './capture-scope.js';
const intersection = (a, b) => {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
};
export function coveredArea(rects) {
  const xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.width]))].sort((a, b) => a - b);
  let total = 0;
  for (let i = 1; i < xs.length; i++) {
    const ys = rects
      .filter((r) => r.x < xs[i] && r.x + r.width > xs[i - 1])
      .map((r) => [r.y, r.y + r.height])
      .sort((a, b) => a[0] - b[0]);
    let end = -Infinity,
      length = 0;
    for (const [a, b] of ys) {
      length += Math.max(0, b - Math.max(a, end));
      end = Math.max(end, b);
    }
    total += (xs[i] - xs[i - 1]) * length;
  }
  return total;
}
export function hasCapturedPhoto(snapshot) {
  return (
    !!snapshot?.screenshotTiles?.some((t) => t.data?.startsWith('data:image/png;base64,')) ||
    !!snapshot?.screenshot?.startsWith('data:image/png;base64,')
  );
}
export async function buildCapturedPhoto(snapshot, requestedView = null) {
  if (!hasCapturedPhoto(snapshot))
    throw Error('이 문서에는 원본 촬영 사진이 없습니다. 편집 전 복제본과 구분해 주세요.');
  const scope = requestedView || viewRect(snapshot);
  const width = Math.min(6000, Math.ceil(scope.width)),
    height = Math.min(32760, Math.ceil(scope.height), Math.floor(40_000_000 / width));
  const bounds = { x: scope.x, y: scope.y, width, height },
    canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e9eaf1';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#d1d4e0';
  ctx.lineWidth = 2;
  for (let x = -height; x < width; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + height, height);
    ctx.stroke();
  }
  const layers = snapshot.screenshotTiles?.length
    ? snapshot.screenshotTiles
    : [
        {
          data: snapshot.screenshot,
          rect: snapshot.captureScope?.referenceViewportRect || {
            x: snapshot.source.scroll?.x || 0,
            y: snapshot.source.scroll?.y || 0,
            ...snapshot.source.viewport,
          },
        },
      ];
  const covered = [];
  for (const layer of layers) {
    if (!layer.data?.startsWith('data:image/png;base64,')) continue;
    const rect = layer.rect,
      clip = intersection(intersection(rect, layer.clip || rect), bounds);
    if (!clip.width || !clip.height) continue;
    const img = new Image();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error('원본 사진을 여는 시간이 초과되었습니다.')),
        5000,
      );
      img.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      img.onerror = () => {
        clearTimeout(timer);
        reject(Error('원본 사진을 읽지 못했습니다.'));
      };
      img.src = layer.data;
    });
    ctx.save();
    ctx.beginPath();
    ctx.rect(clip.x - scope.x, clip.y - scope.y, clip.width, clip.height);
    ctx.clip();
    ctx.drawImage(img, rect.x - scope.x, rect.y - scope.y, rect.width, rect.height);
    ctx.restore();
    covered.push(clip);
  }
  const area = coveredArea(covered),
    data = canvas.toDataURL('image/png');
  return {
    html: `<!doctype html><meta charset="utf-8"><body style="margin:0;overflow:hidden;background:#e9eaf1"><img alt="가져오기 당시 실제 원본 촬영 사진" style="display:block;width:${width}px;height:${height}px" src="${data}"></body>`,
    size: { width, height },
    coverage: {
      area,
      total: scope.width * scope.height,
      ratio: area / (scope.width * scope.height),
    },
    multipleFrames: layers.length > 1,
  };
}
