import { editingDifferenceIds } from './snapshot-delta.js';
import { elementLabel } from './element-labels.js';
import { pointTarget } from '../edit-commands.js';
import { renderVersionFrame, renderVersionOptions } from './react/versions.tsx';
import { clearReact } from './react/mount.tsx';
import { CanvasScene, copy } from '../engine.js';
export async function withVersionScene(snapshot, point, run) {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;left:-100000px;top:0;border:0;visibility:hidden';
  document.body.append(frame);
  try {
    const scene = new CanvasScene(frame, copy(snapshot));
    await scene.mount();
    scene.setCodePatches(point.codePatches || []);
    scene.setEdits(point.edits || {});
    scene.setComments(point.annotations || {});
    return await run(scene);
  } finally {
    frame.remove();
  }
}
export function versionOptions(state) {
  return [
    { id: '@original', name: '가져온 원본', state: { edits: {}, annotations: {}, note: '' } },
    {
      id: '@current',
      name: '현재 작업',
      state: {
        codePatches: state.scene.codePatches,
        edits: state.scene.edits,
        annotations: state.scene.annotations,
        note: document.querySelector('#review-note').value,
      },
    },
    ...(state.timeline?.entries || [])
      .filter((entry) => !entry.deletedAt)
      .map((entry) => ({
        ...entry,
        name: '스냅샷 · ' + entry.name,
      })),
  ];
}
export function createVersionPreview({ $, state, commitCommentDraft, adapter }) {
  const scenes = new Map();
  let different = [];
  let scale = 1,
    syncing = false;
  const host = (side) => $('#compare-' + side + '-view');
  function draw() {
    const zoom = $('#compare-zoom').value;
    const widths = [...scenes.values()].filter((s) => s.result).map((s) => s.result.size.width);
    scale =
      zoom === 'fit'
        ? Math.max(
            0.05,
            Math.min(
              1,
              ...['left', 'right'].map(
                (side) => (host(side).clientWidth - 16) / Math.max(1, ...widths),
              ),
            ),
          )
        : Number(zoom);
    for (const side of ['left', 'right']) {
      const item = scenes.get(side);
      if (item?.result)
        renderVersionFrame(
          host(side),
          item.result,
          item.name + ' 비교 화면',
          scale,
          highlight(side),
        );
    }
  }
  function target(side) {
    const id = $('#compare-target').value,
      item = scenes.get(side)?.result;
    if (!id || !item) return null;
    const value = item.targets[id],
      other = scenes.get(side === 'left' ? 'right' : 'left')?.result?.targets[id];
    const point = pointTarget(id);
    return {
      rect: point
        ? { x: point.x, y: point.y, width: 0, height: 0 }
        : value && !value.hidden
          ? value.rect
          : other?.rect || value?.rect,
      missing: !point && (!value || value.hidden),
      point: !!point,
      name: point ? '위치 주석' : value?.name || other?.name || '요소',
      status: point ? '위치 주석' : !value ? '이 버전에 없음' : value.hidden ? '삭제됨' : '대상',
    };
  }
  function highlight(side) {
    const value = target(side),
      index = different.indexOf($('#compare-target').value);
    if (!value?.rect) return undefined;
    return {
      ...value,
      label:
        `${index + 1} · ${value.name}` +
        (value.missing ? ' · ' + value.status + ' (참고 위치)' : ''),
    };
  }
  function focusStatus() {
    const index = different.indexOf($('#compare-target').value);
    $('#compare-previous').disabled = index <= 0;
    $('#compare-next').disabled = !different.length || index >= different.length - 1;
    $('#compare-focus-status').textContent =
      index < 0
        ? different.length
          ? '변경 위치를 선택하거나 다음을 눌러 검토하세요.'
          : '선택한 두 버전의 요소·주석 차이가 없습니다.'
        : `변경 ${index + 1} / ${different.length} · 왼쪽: ${target('left')?.status || '준비 중'} · 오른쪽: ${target('right')?.status || '준비 중'}`;
  }
  function differences() {
    const values = ['left', 'right'].map(
      (side) => versionOptions(state).find((v) => v.id === $('#compare-' + side).value)?.state,
    );
    if (!values.every(Boolean)) return;
    different = editingDifferenceIds(values[0], values[1]);
    $('#compare-diff').textContent =
      '두 버전에서 다른 요소 ' +
      different.length +
      '개' +
      (values[0].note !== values[1].note ? ' · 추가 설명도 다릅니다.' : '');
    const selected = $('#compare-target').value;
    renderVersionOptions($('#compare-target'), [
      { id: '', name: different.length ? '변경 요소로 이동' : '다른 요소 없음' },
      ...different.map((id, i) => ({
        id,
        name:
          i +
          1 +
          ' · ' +
          (pointTarget(id)
            ? '위치 주석'
            : scenes.get('left')?.result?.targets[id]?.name ||
              scenes.get('right')?.result?.targets[id]?.name ||
              elementLabel(state.scene.nodes.get(id), state.snapshot.layerNames)),
      })),
    ]);
    $('#compare-target').value = different.includes(selected) ? selected : '';
    $('#compare-target').disabled = !different.length;
    focusStatus();
  }
  async function renderSide(side) {
    const token = (scenes.get(side)?.token || 0) + 1;
    scenes.set(side, { token });
    const option = versionOptions(state).find((v) => v.id === $('#compare-' + side).value);
    if (!option) return;
    clearReact(host(side));
    host(side).textContent = '미리보기 준비 중…';
    differences();
    try {
      const result = await withVersionScene(state.snapshot, option.state, (scene) => ({
        html: scene.serialize(),
        size: scene.contentSize(),
        changes: scene.changes().length,
        comments: scene.comments().length,
        targets: Object.fromEntries(
          [...scene.nodes].map(([id, node]) => [
            id,
            {
              rect: !scene.hidden(id) ? scene.rect(id) || node.rect : node.rect,
              hidden: scene.hidden(id),
              name: elementLabel(node, state.snapshot.layerNames),
            },
          ]),
        ),
      }));
      if (scenes.get(side)?.token !== token || !$('#compare-dialog').open) return;
      scenes.set(side, { token, result, name: option.name });
      differences();
      draw();
      $('#compare-' + side + '-summary').textContent =
        '변경 ' +
        result.changes +
        '개 · 주석 ' +
        result.comments +
        '개' +
        (option.state.note ? ' · 설명: ' + option.state.note : '');
    } catch (error) {
      if (scenes.get(side)?.token === token)
        host(side).textContent = '미리보기를 열지 못했습니다: ' + error.message;
    }
  }
  function jump() {
    const id = $('#compare-target').value;
    focusStatus();
    if (!id) return;
    const left = target('left')?.rect,
      right = target('right')?.rect;
    const common =
      left && right
        ? {
            x: Math.min(left.x, right.x),
            y: Math.min(left.y, right.y),
            width: Math.max(left.x + left.width, right.x + right.width) - Math.min(left.x, right.x),
            height:
              Math.max(left.y + left.height, right.y + right.height) - Math.min(left.y, right.y),
          }
        : left || right;
    syncing = true;
    for (const side of ['left', 'right']) {
      const rect = $('#compare-sync').checked ? common : target(side)?.rect;
      if (rect) {
        host(side).scrollLeft = Math.max(
          0,
          (rect.x + rect.width / 2) * scale - host(side).clientWidth / 2,
        );
        host(side).scrollTop = Math.max(
          0,
          (rect.y + rect.height / 2) * scale - host(side).clientHeight / 2,
        );
      }
    }
    requestAnimationFrame(() => {
      syncing = false;
    });
  }
  function step(delta) {
    if (!$('#compare-dialog').open) return;
    const index = different.indexOf($('#compare-target').value),
      next = index + delta;
    if (next < 0 || next >= different.length) return;
    $('#compare-target').value = different[next];
    draw();
    jump();
  }
  adapter.register('compare-previous', () => step(-1));
  adapter.register('compare-next', () => step(1));
  function open(left = '@original', right = '@current') {
    if (!state.ready) return;
    commitCommentDraft();
    for (const side of ['left', 'right']) {
      renderVersionOptions($('#compare-' + side), versionOptions(state));
      $('#compare-' + side).value = side === 'left' ? left : right;
    }
    $('#compare-zoom').value = 'fit';
    if (!$('#compare-dialog').open) $('#compare-dialog').showModal();
    renderSide('left');
    renderSide('right');
  }
  for (const side of ['left', 'right']) {
    $('#compare-' + side).addEventListener('change', () => renderSide(side));
    host(side).addEventListener('scroll', () => {
      if (syncing || !$('#compare-sync').checked) return;
      const other = host(side === 'left' ? 'right' : 'left');
      if (
        Math.abs(other.scrollLeft - host(side).scrollLeft) < 1 &&
        Math.abs(other.scrollTop - host(side).scrollTop) < 1
      )
        return;
      syncing = true;
      other.scrollLeft = host(side).scrollLeft;
      other.scrollTop = host(side).scrollTop;
      requestAnimationFrame(() => {
        syncing = false;
      });
    });
  }
  $('#compare-zoom').addEventListener('change', () => {
    draw();
    jump();
  });
  $('#compare-target').addEventListener('change', () => {
    draw();
    jump();
  });
  const observer = new ResizeObserver(() => {
    if ($('#compare-dialog').open) draw();
  });
  observer.observe($('#compare-left-view'));
  $('#compare-button').addEventListener('click', () =>
    open(state.snapshotPreviewId || '@original', '@current'),
  );
  $('#compare-dialog').addEventListener('close', () => {
    for (const side of ['left', 'right']) {
      scenes.set(side, { token: (scenes.get(side)?.token || 0) + 1 });
      clearReact(host(side));
    }
  });
  return { open };
}
