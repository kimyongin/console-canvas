import { buildCapturedPhoto, hasCapturedPhoto } from '../capture-reference.js';
import { withSceneCopy } from '../scene-preview.js';
import { renderVersionFrame } from './react/scene-preview.tsx';
import { clearReact } from './react/mount.tsx';
export function createSourceComparison({ $, state, adapter, commitCommentDraft, workspace }) {
  let generation = 0,
    photo = null,
    clone = null,
    frozen = null;
  const host = (side) => $('#source-compare-' + side);
  function draw() {
    if (!photo || !clone) return;
    const zoom = $('#source-compare-zoom').value;
    const scale =
      zoom === 'fit'
        ? Math.min(
            1,
            Math.max(
              0.05,
              Math.min(host('photo').clientWidth, host('clone').clientWidth) /
                Math.max(photo.size.width, clone.size.width) -
                0.02,
            ),
          )
        : Number(zoom);
    renderVersionFrame(host('photo'), photo, '가져오기 당시 실제 원본 사진', scale);
    renderVersionFrame(
      host('clone'),
      clone,
      $('#source-compare-version').value === 'baseline' ? '편집 전 복제본' : '현재 작업',
      scale,
    );
  }
  async function renderClone(token) {
    const point = $('#source-compare-version').value === 'baseline' ? {} : frozen;
    const result = await withSceneCopy(state.snapshot, point, (scene) => scene.preview());
    if (token !== generation || !workspace.active('source')) return;
    const reference = await buildCapturedPhoto(state.snapshot, {
      ...result.origin,
      ...result.size,
    });
    if (token !== generation || !workspace.active('source')) return;
    clone = result;
    photo = reference;
    $('#source-compare-clone-label').textContent =
      $('#source-compare-version').value === 'baseline'
        ? '편집 전 복제본'
        : '현재 작업 · 의도한 편집 차이 포함';
    $('#source-compare-status').textContent =
      '촬영 면적 ' +
      (photo.coverage.ratio * 100).toFixed(1) +
      '% · 빗금은 사진이 없는 범위입니다. ' +
      (photo.multipleFrames
        ? '여러 촬영 타일이므로 한 시점이라고 보장하지 않습니다. '
        : '가져오기 당시 촬영 사진입니다. ') +
      '시각적 일치율을 측정한 수치가 아닙니다.';
    draw();
  }
  async function open() {
    if (!state.ready) return;
    commitCommentDraft();
    if (!hasCapturedPhoto(state.snapshot)) throw Error('원본 촬영 사진이 없는 문서입니다.');
    const token = ++generation;
    photo = null;
    clone = null;
    frozen = {
      resourceRepairs: structuredClone(state.scene.resourceRepairs),
      edits: structuredClone(state.scene.edits),
      annotations: structuredClone(state.scene.annotations),
    };
    $('#source-compare-version').value = 'baseline';
    $('#source-compare-zoom').value = 'fit';
    $('#source-compare-mode').value = 'side';
    mode();
    $('#source-compare-status').textContent = '가져오기 당시 사진을 준비하고 있습니다…';
    workspace.show('source');
    try {
      await renderClone(token);
    } catch (error) {
      if (token === generation) $('#source-compare-status').textContent = error.message;
    }
  }
  function mode() {
    const overlay = $('#source-compare-mode').value === 'overlay';
    $('#source-compare-grid').classList.toggle('overlay', overlay);
    $('#source-compare-blend-label').hidden = !overlay;
    $('#source-compare-grid').style.setProperty(
      '--reference-blend',
      String(Number($('#source-compare-blend').value) / 100),
    );
    draw();
  }
  for (const side of ['photo', 'clone'])
    host(side).addEventListener('scroll', () => {
      const other = host(side === 'photo' ? 'clone' : 'photo');
      if (Math.abs(other.scrollLeft - host(side).scrollLeft) > 1)
        other.scrollLeft = host(side).scrollLeft;
      if (Math.abs(other.scrollTop - host(side).scrollTop) > 1)
        other.scrollTop = host(side).scrollTop;
    });
  $('#source-compare-version').addEventListener('change', () => {
    const token = ++generation;
    renderClone(token).catch((error) => {
      if (token === generation && workspace.active('source'))
        $('#source-compare-status').textContent = error.message;
    });
  });
  $('#source-compare-zoom').addEventListener('change', draw);
  $('#source-compare-mode').addEventListener('change', mode);
  $('#source-compare-blend').addEventListener('input', mode);
  workspace.onLeave('source', () => {
    generation++;
    photo = null;
    clone = null;
    clearReact(host('photo'));
    clearReact(host('clone'));
  });
  adapter.register('source-compare', () => {
    return open();
  });
  return { open };
}
