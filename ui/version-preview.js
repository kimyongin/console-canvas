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
export function createVersionPreview({ $, state, commitCommentDraft }) {
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
        renderVersionFrame(host(side), item.result, item.name + ' 비교 화면', scale);
    }
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
            : elementLabel(state.scene.nodes.get(id), state.snapshot.layerNames)),
      })),
    ]);
    $('#compare-target').value = different.includes(selected) ? selected : '';
    $('#compare-target').disabled = !different.length;
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
        rects: Object.fromEntries(
          [...scene.nodes.keys()].map((id) => [id, scene.rect(id) || scene.nodes.get(id).rect]),
        ),
      }));
      if (scenes.get(side)?.token !== token || !$('#compare-dialog').open) return;
      scenes.set(side, { token, result, name: option.name });
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
    if (!id) return;
    const point = pointTarget(id);
    for (const side of ['left', 'right']) {
      const item = scenes.get(side);
      const other = scenes.get(side === 'left' ? 'right' : 'left');
      const rect = point
        ? { x: point.x, y: point.y, width: 0, height: 0 }
        : item?.result?.rects[id] || other?.result?.rects[id];
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
  }
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
  $('#compare-target').addEventListener('change', jump);
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
