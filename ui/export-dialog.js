import { download, reviewPayload } from '../export.js';
import { buildHandoffImage, handoffRequests } from '../handoff-image.js';
import { withVersionScene, versionOptions } from './version-preview.js';
export function createExportDialog({ $, state, commitCommentDraft, flushEditor, toast }) {
  let generation = 0,
    latest = null,
    previewUrl = null;
  function chosen() {
    return versionOptions(state).find((v) => v.id === $('#handoff-version').value);
  }
  async function useVersion(run) {
    commitCommentDraft();
    const option = chosen();
    if (!option) throw new Error('전달할 버전을 선택해 주세요.');
    return withVersionScene(state.snapshot, option.state, (scene) => run(scene, option));
  }
  async function refresh() {
    const token = ++generation;
    latest = null;
    $('#copy-summary').disabled = true;
    $('#download-review').disabled = true;
    $('#handoff-preview').textContent = '전달 이미지 준비 중…';
    try {
      const result = await useVersion(async (scene, version) => {
        const requests = handoffRequests(scene);
        $('#export-summary').textContent = version.name + ' · 변경 요청 ' + requests.length + '개';
        $('#review-note').closest('label').hidden = version.id !== '@current';
        $('#handoff-items').replaceChildren();
        // The image is the review surface; avoid duplicating all cards as text.
        return buildHandoffImage(
          state.snapshot,
          scene,
          version.state.note,
          (m) => ($('#export-status').textContent = m),
        );
      });
      if (token !== generation || !$('#export-dialog').open) return;
      latest = result;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(result.blob);
      const image = new Image();
      image.alt = '변경 후 화면과 번호별 주석 카드가 포함된 전달 이미지';
      image.src = previewUrl;
      $('#handoff-preview').replaceChildren(image);
      $('#export-status').textContent =
        '이 이미지 한 장을 에이전트 대화에 첨부하세요. 번호별 주석에 반응형 배치 의도를 적으면 더 명확해집니다.';
      $('#copy-summary').disabled = false;
      $('#download-review').disabled = false;
    } catch (error) {
      if (token === generation) {
        $('#handoff-preview').textContent = '';
        $('#export-status').textContent = '이미지를 만들지 못했습니다: ' + error.message;
      }
    }
  }
  $('#export-button').addEventListener('click', () => {
    commitCommentDraft();
    $('#handoff-version').replaceChildren(
      ...versionOptions(state).map((v) => new Option(v.name, v.id)),
    );
    $('#handoff-version').value = '@current';
    $('#export-dialog').showModal();
    refresh();
  });
  $('#handoff-version').addEventListener('change', refresh);
  $('#review-note').addEventListener('change', () => {
    if ($('#export-dialog').open) refresh();
  });
  $('#export-dialog').addEventListener('close', () => {
    generation++;
    latest = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    $('#handoff-preview').replaceChildren();
  });
  $('#copy-summary').addEventListener('click', async () => {
    try {
      if (!latest) return;
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': latest.blob })]);
      $('#export-status').textContent = '이미지를 복사했습니다. 에이전트 대화에 붙여넣으세요.';
    } catch (error) {
      $('#export-status').textContent =
        '이미지 복사를 지원하지 않는 환경입니다. 전달 이미지 저장을 사용해 주세요. ' +
        error.message;
    }
  });
  $('#download-review').addEventListener('click', async () => {
    if (!latest) return;
    const button = $('#download-review');
    button.disabled = true;
    try {
      const result = await download(
        'console-canvas-' + state.snapshot.id.slice(0, 8) + '.png',
        latest.blob,
        'image/png',
      );
      $('#export-status').textContent = result?.canceled
        ? '저장을 취소했습니다.'
        : '전달 이미지 한 장을 저장했습니다. 에이전트 대화에 첨부하세요.';
    } catch (error) {
      $('#export-status').textContent = '저장 실패: ' + error.message;
    } finally {
      button.disabled = false;
    }
  });
  $('#save-document').addEventListener('click', async () => {
    if (!state.ready) return;
    $('#document-menu-content').hidePopover();
    const button = $('#save-document');
    button.disabled = true;
    try {
      await flushEditor();
      const payload = reviewPayload(
        state.snapshot,
        state.scene,
        $('#review-note').value,
        state.timeline,
        state.activity,
        state.activityHead,
      );
      const result = await download(
        'console-canvas-' + state.snapshot.id.slice(0, 8) + '.uiclone.json',
        JSON.stringify(payload),
        'application/json',
      );
      toast(
        result?.canceled
          ? '저장을 취소했습니다.'
          : '편집 파일을 저장했습니다. 주석·분기·변경 이력·휴지통도 포함됩니다.',
      );
    } catch (error) {
      toast('편집 파일 저장 실패: ' + error.message);
    } finally {
      button.disabled = !state.ready;
    }
  });
}
