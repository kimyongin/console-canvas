function sourcePath(source) {
  try {
    const url = new URL(source.url);
    return url.origin + url.pathname;
  } catch {
    return String(source?.url || '').slice(0, 500);
  }
}
import { renderPng } from './export.js';
import { elementLabel } from './ui/element-labels.js';
export function handoffRequests(scene) {
  const changes = new Map(scene.changes().map((c) => [c.id, c]));
  const result = scene.comments().map((c) => ({
    id: c.id,
    name:
      (c.targetDeleted ? (c.copiedFrom ? '복사본 삭제 · ' : '삭제 · ') : '') +
      (c.point ? '위치 주석' : elementLabel(scene.nodes.get(c.id), scene.snapshot.layerNames)),
    text: c.text,
    rect: c.after || c.before,
    deleted: c.targetDeleted,
    before: c.before,
    action: changes.get(c.id)?.action,
    point: !!c.point,
  }));
  const annotated = new Set(result.map((r) => r.id));
  for (const c of changes.values())
    if (!annotated.has(c.id))
      result.push({
        id: c.id,
        name: elementLabel(scene.nodes.get(c.id), scene.snapshot.layerNames),
        text:
          c.action === 'resource'
            ? '복구한 이미지·폰트가 올바르게 보이는지 원본 자산과 확인해 주세요.'
            : c.action === 'delete'
              ? '이 요소를 제거하고 주변 배치와 간격을 자연스럽게 정리해 주세요.'
              : c.action === 'copy'
                ? '추가한 복사본을 포함해 그림의 구조와 간격을 반응형으로 구현해 주세요.'
                : '그림의 변경 후 배치를 기준으로 주변 요소와 정렬·간격을 맞추고, 좁은 화면에서는 자연스럽게 줄바꿈해 주세요.',
        rect: c.after || c.before,
        before: c.before,
        deleted: c.action === 'delete',
        action: c.action,
      });
  return result.map((r, i) => ({ ...r, number: i + 1 }));
}
async function screenshot(html, size) {
  if (window.ConsoleCanvasDesktop?.renderImage)
    return new Blob(
      [
        await window.ConsoleCanvasDesktop.renderImage({
          html,
          width: size.width,
          height: size.height,
        }),
      ],
      { type: 'image/png' },
    );
  return renderPng(html, size.width, size.height);
}
function wrap(ctx, text, width) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const char of paragraph) {
      if (line && ctx.measureText(line + char).width > width) {
        lines.push(line);
        line = char;
      } else line += char;
    }
    lines.push(line);
  }
  return lines;
}
function box(ctx, x, y, w, h, fill, stroke, r = 12) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
function badge(ctx, n, x, y) {
  ctx.beginPath();
  ctx.arc(x, y, 19, 0, Math.PI * 2);
  ctx.fillStyle = '#6547ed';
  ctx.fill();
  ctx.fillStyle = 'white';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 21px system-ui';
  ctx.fillText(String(n), x, y);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}
export async function buildHandoffImage(
  snapshot,
  scene,
  note = '',
  progress = () => {},
  options = {},
) {
  progress('변경 후 화면과 요청 카드를 만들고 있습니다.');
  const mode = 'reference';
  const view = scene.viewRect();
  const requests = handoffRequests(scene)
      .filter((r) => !Array.isArray(options.requestIds) || options.requestIds.includes(r.id))
      .map((r) => ({
        ...r,
        rect: r.rect ? { ...r.rect, x: r.rect.x - view.x, y: r.rect.y - view.y } : r.rect,
        before: r.before
          ? { ...r.before, x: r.before.x - view.x, y: r.before.y - view.y }
          : r.before,
        text:
          r.text +
          (options.requestNotes?.[r.id] ? '\n추가 수정: ' + options.requestNotes[r.id] : ''),
      })),
    currentSize = scene.contentSize(),
    reference = requests.some((r) => r.deleted) ? scene.referenceFrame() : null,
    renderSize = {
      width: Math.max(currentSize.width, reference?.size.width || 0),
      height: Math.max(currentSize.height, reference?.size.height || 0),
    };
  const size = { width: view.width, height: view.height };
  const after = await createImageBitmap(await screenshot(scene.serialize(), renderSize));
  let before;
  if (reference) {
    // The before bitmap and annotation rectangles must share the current view's
    // origin, including areas exposed by moving beyond a captured crop.
    const html = reference.html.replace(
      /(<meta name="console-canvas-view" content=")[^"]*(">)/,
      (_match, start, end) => start + [view.x, view.y, view.width, view.height].join(',') + end,
    );
    before = await createImageBitmap(await screenshot(html, renderSize));
  }
  try {
    const width = Math.max(1440, Math.min(2200, size.width + 80)),
      margin = 40,
      gutter = 22,
      cardWidth = (width - margin * 2 - gutter) / 2,
      screenWidth = width - margin * 2,
      scale = screenWidth / size.width,
      screenHeight = Math.ceil(size.height * scale);
    const canvas = document.createElement('canvas'),
      ctx = canvas.getContext('2d');
    ctx.font = '700 36px system-ui';
    const titleLines = wrap(
      ctx,
      (snapshot.documentName || snapshot.source.title || '화면') + ' · UI 변경 요청',
      width - margin * 2,
    );
    ctx.font = '20px system-ui';
    const context = {
      mode,
      versionName: options.versionName || '현재 작업',
      path: sourcePath(snapshot.source),
      viewport: snapshot.source.viewport,
      capturedAt: snapshot.capturedAt,
      policy:
        mode === 'exact'
          ? '확정 시안 · 그림을 기준으로 구현하되 주석의 예외·반응형 조건을 우선합니다.'
          : '배치 참고 · 주석 요청 우선. 그림의 빈자리·겹침은 완성된 배치를 뜻하지 않습니다.',
    };
    const metadataLines = [
      `${context.path} · 기준 ${context.viewport.width} × ${context.viewport.height}px`,
      `버전: ${context.versionName} · 가져온 시각: ${context.capturedAt || '기록 없음'}`,
      context.policy,
    ].flatMap((line) => wrap(ctx, line, width - margin * 2));
    const metadataY = 94 + (titleLines.length - 1) * 46;
    const screenY = metadataY + metadataLines.length * 28 + 20;
    ctx.font = '22px system-ui';
    const cards = requests.map((r) => ({
      ...r,
      title: wrap(ctx, r.name, cardWidth - 102),
      lines: wrap(ctx, r.text, cardWidth - 44),
      crop: r.deleted || (!r.point && r.rect?.width * scale < 100 && r.rect?.height * scale < 60),
    }));
    let y = screenY + screenHeight + 92;
    for (let i = 0; i < cards.length; i += 2) {
      const pair = cards.slice(i, i + 2),
        h = Math.max(
          ...pair.map((c) =>
            Math.max(148, 78 + c.title.length * 28 + c.lines.length * 32 + (c.crop ? 136 : 0)),
          ),
        );
      pair.forEach((c, j) => Object.assign(c, { x: margin + j * (cardWidth + gutter), y, h }));
      y += h + 18;
    }
    ctx.font = '22px system-ui';
    const noteLines = note.trim() ? wrap(ctx, note, width - margin * 2 - 40) : [];
    ctx.font = '20px system-ui';
    const footerText =
      '구현 기준: 고정 좌표 대신 정렬·간격·줄바꿈 의도를 반영하고 여러 화면 너비에서 확인하세요. 별도 요청이 없는 기존 버튼·검색·입력 동작은 유지하세요. 주석에는 그림에 아직 반영되지 않은 구현 요청이 포함될 수 있습니다.';
    const footerLines = wrap(ctx, footerText, width - margin * 2);
    const height = Math.ceil(
      y + 70 + footerLines.length * 29 + (noteLines.length ? noteLines.length * 32 + 70 : 0),
    );
    if (height > 32760 || width * height > 100_000_000)
      throw new Error(
        '요청 내용을 한 이미지에 담기에는 너무 큽니다. 주석을 간결하게 정리하거나 전달할 스냅샷을 나누어 주세요.',
      );
    canvas.width = width;
    canvas.height = height;
    ctx.fillStyle = '#f8f9fe';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#111a34';
    ctx.font = '700 36px system-ui';
    titleLines.forEach((line, i) => ctx.fillText(line, margin, 58 + i * 46));
    ctx.font = '21px system-ui';
    ctx.fillStyle = '#72798d';
    ctx.font = '20px system-ui';
    metadataLines.forEach((line, i) => ctx.fillText(line, margin, metadataY + i * 28));
    ctx.drawImage(after, margin, screenY, screenWidth, screenHeight);
    // Number badges never form leader lines. Deleted targets are dashed at their old location.
    const occupied = [],
      hotspots = [];
    for (const r of requests) {
      if (!r.rect) continue;
      const x = margin + r.rect.x * scale,
        yy = screenY + r.rect.y * scale,
        w = Math.max(12, r.rect.width * scale),
        h = Math.max(12, r.rect.height * scale);
      ctx.save();
      ctx.beginPath();
      ctx.rect(margin, screenY, screenWidth, screenHeight);
      ctx.clip();
      ctx.setLineDash(r.deleted ? [7, 5] : []);
      box(
        ctx,
        x - 3,
        yy - 3,
        w + 6,
        h + 6,
        r.deleted ? '#ef44440d' : '#7755ee0c',
        r.deleted ? '#ca6375' : '#7956eb',
        6,
      );
      ctx.restore();
      let bx = Math.max(margin + 19, Math.min(width - margin - 19, x + 5)),
        by = Math.max(screenY + 19, Math.min(screenY + screenHeight - 19, yy + 3));
      while (
        occupied.some((p) => Math.hypot(p.x - bx, p.y - by) < 40) &&
        by < screenY + screenHeight - 60
      )
        by += 42;
      occupied.push({ x: bx, y: by });
      badge(ctx, r.number, bx, by);
      hotspots.push({ id: r.id, number: r.number, x: bx - 22, y: by - 22, width: 44, height: 44 });
    }
    ctx.fillStyle = '#111a34';
    ctx.font = '700 29px system-ui';
    ctx.fillText('변경 요청 ' + requests.length + '개', margin, screenY + screenHeight + 56);
    if (!cards.length) {
      ctx.font = '22px system-ui';
      ctx.fillStyle = '#77798b';
      ctx.fillText('변경 또는 주석이 없는 화면입니다.', margin, y);
    }
    for (const c of cards) {
      box(ctx, c.x, c.y, cardWidth, c.h, 'white', '#e1e2f0');
      badge(ctx, c.number, c.x + 36, c.y + 38);
      hotspots.push({
        id: c.id,
        number: c.number,
        x: c.x + 14,
        y: c.y + 16,
        width: 44,
        height: 44,
      });
      ctx.fillStyle = '#19213a';
      ctx.font = '700 23px system-ui';
      c.title.forEach((line, i) => ctx.fillText(line, c.x + 70, c.y + 37 + i * 28));
      let ty = c.y + 75 + (c.title.length - 1) * 28;
      ctx.font = '22px system-ui';
      ctx.fillStyle = '#606980';
      c.lines.forEach((line) => {
        ctx.fillText(line, c.x + 22, ty);
        ty += 32;
      });
      if (c.crop) {
        const image = c.deleted ? before : after,
          r = c.deleted ? c.before : c.rect;
        if (image && r) {
          ctx.font = '16px system-ui';
          ctx.fillText(
            c.deleted ? '삭제 전 참고 · 점선 번호는 원래 위치' : '변경 영역 확대',
            c.x + 22,
            ty + 12,
          );
          const sx = Math.max(0, r.x - 12),
            sy = Math.max(0, r.y - 12),
            sw = Math.max(1, Math.min(size.width - sx, r.width + 24)),
            sh = Math.max(1, Math.min(size.height - sy, r.height + 24)),
            ratio = Math.min((cardWidth - 44) / sw, 90 / sh);
          ctx.drawImage(
            image,
            (sx * image.width) / size.width,
            (sy * image.height) / size.height,
            (sw * image.width) / size.width,
            (sh * image.height) / size.height,
            c.x + 22,
            ty + 24,
            sw * ratio,
            sh * ratio,
          );
        }
      }
    }
    if (noteLines.length) {
      box(ctx, margin, y, width - margin * 2, noteLines.length * 32 + 54, '#eeebfc');
      ctx.fillStyle = '#514571';
      ctx.font = '22px system-ui';
      noteLines.forEach((line, i) => ctx.fillText(line, margin + 20, y + 35 + i * 32));
      y += noteLines.length * 32 + 70;
    }
    ctx.fillStyle = '#696c86';
    ctx.font = '20px system-ui';
    const footer = footerLines;
    footer.forEach((line, i) => ctx.fillText(line, margin, y + 38 + i * 29));
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('전달 이미지 생성 실패');
    return { blob, requests, width, height, hotspots, context };
  } finally {
    after.close();
    before?.close();
  }
}
