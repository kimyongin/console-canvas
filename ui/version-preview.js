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
  async function renderSide(side) {
    const token = (scenes.get(side)?.token || 0) + 1;
    scenes.set(side, { token });
    const option = versionOptions(state).find((v) => v.id === $('#compare-' + side).value);
    if (!option) return;
    const target = $('#compare-' + side + '-view');
    clearReact(target);
    target.textContent = '미리보기 준비 중…';
    try {
      const result = await withVersionScene(state.snapshot, option.state, (scene) => ({
        html: scene.serialize(),
        size: scene.contentSize(),
        changes: scene.changes().length,
        comments: scene.comments().length,
      }));
      if (scenes.get(side)?.token !== token || !$('#compare-dialog').open) return;
      renderVersionFrame(target, result, option.name + ' 비교 화면');
      $('#compare-' + side + '-summary').textContent =
        '변경 ' +
        result.changes +
        '개 · 주석 ' +
        result.comments +
        '개' +
        (option.state.note ? ' · 설명: ' + option.state.note : '');
      const values = ['left', 'right'].map(
        (key) => versionOptions(state).find((v) => v.id === $('#compare-' + key).value)?.state,
      );
      if (values.every(Boolean)) {
        const ids = new Set(
          values.flatMap((v) => [...Object.keys(v.edits), ...Object.keys(v.annotations)]),
        );
        let count = 0;
        for (const id of ids)
          if (
            JSON.stringify(values[0].edits[id] || {}) !==
              JSON.stringify(values[1].edits[id] || {}) ||
            (values[0].annotations[id] || '') !== (values[1].annotations[id] || '')
          )
            count++;
        $('#compare-diff').textContent =
          '두 버전에서 다른 요소 ' +
          count +
          '개' +
          (values[0].note !== values[1].note ? ' · 추가 설명도 다릅니다.' : '');
      }
    } catch (error) {
      if (scenes.get(side)?.token === token)
        target.textContent = '미리보기를 열지 못했습니다: ' + error.message;
    }
  }
  function open(left = '@original', right = '@current') {
    if (!state.ready) return;
    commitCommentDraft();
    const options = versionOptions(state);
    for (const side of ['left', 'right']) {
      const select = $('#compare-' + side);
      renderVersionOptions(select, options);
      select.value = side === 'left' ? left : right;
    }
    if (!$('#compare-dialog').open) $('#compare-dialog').showModal();
    renderSide('left');
    renderSide('right');
  }
  for (const side of ['left', 'right'])
    $('#compare-' + side).addEventListener('change', () => renderSide(side));
  $('#compare-button').addEventListener('click', () =>
    open(state.snapshotPreviewId || '@original', '@current'),
  );
  $('#compare-dialog').addEventListener('close', () => {
    for (const side of ['left', 'right']) {
      scenes.set(side, { token: (scenes.get(side)?.token || 0) + 1 });
      clearReact($('#compare-' + side + '-view'));
    }
  });
  return { open };
}
