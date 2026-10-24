import { download, instructionText, reviewPayload, buildReview } from '../export.js';
export function createExportDialog({ $, state, commitCommentDraft }) {
  $('#export-button').addEventListener('click', () => {
    commitCommentDraft();
    const changes = state.scene.changes(),
      deleted = changes.filter((c) => c.action === 'delete').length;
    $('#export-summary').textContent =
      '이동 ' +
      (changes.length - deleted) +
      '개 · 삭제 ' +
      deleted +
      '개 · 주석 ' +
      state.scene.comments().length +
      '개 · 원본과 편집본 포함';
    $('#export-status').textContent =
      '주석은 수정 요청으로 전달되며 화면에 자동 반영되지 않습니다. ZIP을 이 대화에 첨부해 주세요.';
    $('#export-dialog').showModal();
  });
  $('#copy-summary').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(
        instructionText(
          state.snapshot,
          state.scene.changes(),
          $('#review-note').value,
          state.scene.comments(),
        ),
      );
      $('#export-status').textContent = '지시문을 복사했어요. 이 대화에 붙여넣을 수 있습니다.';
    } catch {
      $('#export-status').textContent =
        '클립보드에 접근하지 못했습니다. ZIP의 instructions.txt를 사용해 주세요.';
    }
  });
  $('#download-session').addEventListener('click', () => {
    download(
      'console-canvas-' + state.snapshot.id.slice(0, 8) + '.uiclone.json',
      JSON.stringify(
        reviewPayload(state.snapshot, state.scene, $('#review-note').value, state.timeline),
      ),
      'application/json',
    );
    $('#export-status').textContent =
      '스냅샷 목록을 포함해 편집 파일을 저장했어요. 화면 파일 열기로 다시 편집할 수 있습니다.';
  });
  $('#download-review').addEventListener('click', async () => {
    const button = $('#download-review');
    button.disabled = true;
    try {
      const result = await buildReview(
        state.snapshot,
        state.scene,
        $('#review-note').value,
        (message) => ($('#export-status').textContent = message),
        state.timeline,
      );
      download('console-canvas-review-' + state.snapshot.id.slice(0, 8) + '.zip', result.blob);
      $('#export-status').textContent =
        'ZIP을 저장했어요. 이 대화에 첨부하고 “이 편집 결과를 기준으로 수정해 줘”라고 보내 주세요.' +
        (result.warnings.length
          ? ' 비교 이미지 일부를 생성하지 못해 HTML 비교 화면을 포함했습니다.'
          : '');
    } catch (error) {
      $('#export-status').textContent = '내보내지 못했습니다: ' + error.message;
    } finally {
      button.disabled = false;
    }
  });

  return {};
}
