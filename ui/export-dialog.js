import {
  download,
  instructionText,
  reviewPayload,
  buildReview,
  changeActionLabel,
} from '../export.js';
import { withVersionScene, versionOptions } from './version-preview.js';
import { elementLabel } from './element-labels.js';
export function createExportDialog({ $, state, commitCommentDraft, editorId }) {
  let generation = 0;
  function chosen() {
    return versionOptions(state).find((v) => v.id === $('#handoff-version').value);
  }
  function timelineFor(option) {
    return {
      ...state.timeline,
      activeId:
        option.id === '@current'
          ? state.timeline.activeId
          : option.id === '@original'
            ? null
            : option.id,
    };
  }
  async function useVersion(run) {
    commitCommentDraft();
    const option = chosen();
    if (!option) throw new Error('전달할 버전을 선택해 주세요.');
    return option.id === '@current'
      ? run(state.scene, option)
      : withVersionScene(state.snapshot, option.state, (scene) => run(scene, option));
  }
  async function refresh() {
    const token = ++generation;
    $('#handoff-items').textContent = '변경 내용 확인 중…';
    const option = chosen();
    $('#review-note').closest('label').hidden = option?.id !== '@current';
    try {
      await useVersion((scene, version) => {
        if (token !== generation) return;
        const changes = scene.changes(),
          comments = scene.comments(),
          deleted = changes.filter((c) => c.action === 'delete' && !c.copiedFrom).length,
          deletedCopies = changes.filter((c) => c.action === 'delete' && c.copiedFrom).length,
          copied = changes.filter((c) => c.action === 'copy').length;
        $('#export-summary').textContent =
          '이동 ' +
          changes.filter((c) => c.action === 'move').length +
          '개 · 삭제 ' +
          deleted +
          '개 · 복사본 ' +
          copied +
          (deletedCopies ? '개 · 복사본 삭제 ' + deletedCopies : '') +
          '개 · 주석 ' +
          comments.length +
          '개 · ' +
          version.name;
        const list = $('#handoff-items');
        list.replaceChildren();
        for (const change of changes) {
          const item = document.createElement('div');
          item.className = 'handoff-item';
          item.textContent =
            changeActionLabel(change) +
            ' · ' +
            elementLabel(scene.nodes.get(change.id)) +
            (change.action === 'move' ? ' · X ' + change.delta.x + ' / Y ' + change.delta.y : '');
          list.append(item);
        }
        for (const comment of comments) {
          const item = document.createElement('div');
          item.className = 'handoff-item';
          item.classList.toggle('target-deleted', comment.targetDeleted);
          item.textContent =
            (comment.targetDeleted
              ? comment.copiedFrom
                ? '삭제된 복사본의 주석 · '
                : '삭제된 요소의 주석 · '
              : '주석 · ') +
            elementLabel(scene.nodes.get(comment.id)) +
            '\n' +
            comment.text;
          list.append(item);
        }
        if (version.id !== '@current' && version.state.note) {
          const item = document.createElement('div');
          item.className = 'handoff-item';
          item.textContent = '추가 설명 · ' + version.state.note;
          list.append(item);
        }
        if (!list.children.length) list.textContent = '아직 이동·삭제·주석이 없습니다.';
      });
    } catch (error) {
      $('#handoff-items').textContent = error.message;
    }
  }
  $('#export-button').addEventListener('click', () => {
    commitCommentDraft();
    $('#handoff-version').replaceChildren(
      ...versionOptions(state).map((v) => new Option(v.name, v.id)),
    );
    $('#handoff-version').value = '@current';
    $('#export-status').textContent =
      '전달할 변경과 주석을 확인하세요. 연결된 에이전트에는 요청문을 복사하고, 파일로 전달할 때는 ZIP을 저장하세요.';
    $('#export-dialog').showModal();
    refresh();
  });
  $('#handoff-version').addEventListener('change', refresh);
  $('#copy-summary').addEventListener('click', async () => {
    try {
      const text = await useVersion((scene, version) => {
        const context =
          version.id === '@current'
            ? '현재 작업'
            : version.id === '@original'
              ? '가져온 원본'
              : version.name + ' (snapshot_id: ' + version.id + ')';
        return (
          'Console Canvas의 ' +
          context +
          '을 기준으로 수정해 주세요.\ndocument_id: ' +
          state.snapshot.id +
          '\neditor_id: ' +
          editorId +
          '\nMCP에서 화면과 최신 revision을 다시 조회한 뒤 작업해 주세요.\n\n' +
          instructionText(state.snapshot, scene.changes(), version.state.note, scene.comments())
        );
      });
      await navigator.clipboard.writeText(text);
      $('#export-status').textContent =
        '전달 기준과 변경 내용을 복사했습니다. 에이전트 대화에 붙여넣으세요.';
    } catch (error) {
      $('#export-status').textContent = '복사하지 못했습니다: ' + error.message;
    }
  });
  async function perform(button, run) {
    button.disabled = true;
    try {
      await run();
    } catch (error) {
      $('#export-status').textContent = '저장하지 못했습니다: ' + error.message;
    } finally {
      button.disabled = false;
    }
  }
  $('#download-session').addEventListener('click', () =>
    perform($('#download-session'), async () => {
      const payload = await useVersion((scene, version) =>
        reviewPayload(state.snapshot, scene, version.state.note, timelineFor(version)),
      );
      const result = await download(
        'console-canvas-' + state.snapshot.id.slice(0, 8) + '.uiclone.json',
        JSON.stringify(payload),
        'application/json',
      );
      $('#export-status').textContent = result?.canceled
        ? '저장을 취소했습니다.'
        : result?.path
          ? '편집 파일을 저장했습니다. 스냅샷 목록도 포함됩니다.'
          : '편집 파일 다운로드를 요청했습니다.';
    }),
  );
  $('#download-review').addEventListener('click', () =>
    perform($('#download-review'), async () => {
      const result = await useVersion((scene, version) =>
        buildReview(
          state.snapshot,
          scene,
          version.state.note,
          (message) => ($('#export-status').textContent = message),
          timelineFor(version),
        ),
      );
      const saved = await download(
        'console-canvas-review-' + state.snapshot.id.slice(0, 8) + '.zip',
        result.blob,
      );
      $('#export-status').textContent = saved?.canceled
        ? '저장을 취소했습니다.'
        : (saved?.path ? '전달 ZIP을 저장했습니다.' : '전달 ZIP 다운로드를 요청했습니다.') +
          ' 에이전트 대화에 첨부해 주세요.' +
          (result.warnings.length ? ' 일부 이미지는 HTML 비교 화면으로 확인해 주세요.' : '');
    }),
  );
  return {};
}
