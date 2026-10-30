import {
  renderHandoffPreview,
  renderHandoffConflicts,
  renderHandoffRequests,
  renderVersionOptions,
} from './react/versions.tsx';
import { clearReact } from './react/mount.tsx';
import { download, reviewPayload } from '../export.js';
import { buildHandoffImage, handoffRequests } from '../handoff-image.js';
import { withVersionScene, versionOptions } from './version-preview.js';
export function createExportDialog({
  $,
  state,
  commitCommentDraft,
  flushEditor,
  prepareEditor,
  toast,
  focusComment,
  save,
  implementationReview,
  snapshotHistory,
  adapter,
}) {
  let excludedComments = new Map(),
    reviewDocument = null;
  let generation = 0,
    latest = null,
    previewUrl = null,
    returnToExport = null;
  let hasReady = false,
    actionBusy = false,
    activeAction = null,
    intentEpoch = 0,
    preparing = null,
    noteTimer;
  let continuing = false;
  async function continueVersion(requestId = null) {
    const version = chosen();
    if (continuing || !version || version.id.startsWith('@')) return false;
    continuing = true;
    const documentId = state.snapshot.id,
      epoch = state.generation;
    try {
      commitCommentDraft();
      await flushEditor();
      if (
        !$('#export-dialog').open ||
        state.snapshot?.id !== documentId ||
        state.generation !== epoch ||
        chosen()?.id !== version.id
      )
        throw Error('전달 기준이 바뀌었습니다. 선택한 버전에서 다시 시도해 주세요.');
      if (requestId) {
        const exists = await withVersionScene(state.snapshot, version.state, (scene) =>
          handoffRequests(scene).some((request) => request.id === requestId),
        );
        if (!exists) throw Error('이 버전에서 해당 요청을 찾을 수 없습니다.');
        if (
          !$('#export-dialog').open ||
          state.snapshot?.id !== documentId ||
          state.generation !== epoch ||
          chosen()?.id !== version.id
        )
          throw Error('전달 기준이 바뀌었습니다.');
      }
      await snapshotHistory.restorePersisted(version.id);
      if (
        !$('#export-dialog').open ||
        state.snapshot?.id !== documentId ||
        state.generation !== epoch
      )
        return false;
      renderVersionOptions($('#handoff-version'), versionOptions(state));
      $('#handoff-version').value = '@current';
      toast('선택한 버전에서 이어 편집합니다. 이동 전 작업과 이후 가지는 보존했습니다.');
      return true;
    } catch (error) {
      toast(error.message);
      return false;
    } finally {
      continuing = false;
    }
  }
  async function editRequest(id) {
    if (chosen()?.id !== '@current' && !(await continueVersion(id))) return;
    returnToExport = {
      document: state.snapshot.id,
      generation: state.generation,
      scroll: $('.export-scroll').scrollTop,
      id,
    };
    $('#export-dialog').close();
    focusComment({ id });
  }
  $('#comment-dialog').addEventListener('close', async () => {
    const target = returnToExport;
    returnToExport = null;
    if (!target || target.document !== state.snapshot?.id || target.generation !== state.generation)
      return;
    try {
      await flushEditor();
      if (target.generation !== state.generation) return;
      renderVersionOptions($('#handoff-version'), versionOptions(state));
      $('#handoff-version').value = '@current';
      $('#export-dialog').showModal();
      await refresh();
      if (
        !$('#export-dialog').open ||
        target.document !== state.snapshot?.id ||
        target.generation !== state.generation
      )
        return;
      $('.export-scroll').scrollTop = target.scroll;
      const trigger = [...$('#handoff-items').querySelectorAll('[data-request-id]')].find(
        (e) => e.dataset.requestId === target.id,
      );
      (trigger || $('#handoff-version')).focus({ preventScroll: true });
    } catch (error) {
      toast(error.message);
    }
  });
  function chosen() {
    return versionOptions(state).find((v) => v.id === $('#handoff-version').value);
  }
  function available(status) {
    $('#handoff-preview').dataset.state = status;
    $('#handoff-preview').setAttribute('aria-busy', String(status === 'preparing'));
    for (const id of ['copy-summary', 'download-review', 'handoff-verify'])
      $('#' + id).disabled =
        actionBusy || (status !== 'ready' && !(status === 'preparing' && hasReady));
    $('#handoff-retry').hidden = status !== 'failed';
  }
  function currentImage(image = latest) {
    return (
      !!image &&
      $('#export-dialog').open &&
      image.documentId === state.snapshot?.id &&
      image.sceneGeneration === state.generation &&
      image.signature === JSON.stringify(chosen()) &&
      image.mode === (state.handoffSettings?.mode || 'reference')
    );
  }
  function refresh() {
    clearTimeout(noteTimer);
    preparing = renderImage();
    return preparing;
  }
  async function renderImage() {
    if (!$('#export-dialog').open) return;
    const token = ++generation;
    latest = null;
    available('preparing');
    $('#export-status').textContent = '전달 이미지를 준비하고 있습니다…';
    clearReact($('#handoff-preview'));
    $('#handoff-preview').textContent = '전달 이미지 준비 중…';
    clearReact($('#handoff-items'));
    try {
      commitCommentDraft();
      const option = chosen();
      if (!option) throw new Error('전달할 버전을 선택해 주세요.');
      const signature = JSON.stringify(option),
        version = structuredClone(option),
        capture = state.snapshot,
        sceneGeneration = state.generation,
        mode = state.handoffSettings?.mode || 'reference';
      const valid = () =>
        token === generation &&
        $('#export-dialog').open &&
        state.snapshot?.id === capture.id &&
        state.generation === sceneGeneration;
      const result = await withVersionScene(capture, version.state, async (scene) => {
        if (token !== generation) throw Error('전달 기준이 바뀌었습니다.');
        const conflicts = scene.comments().filter((c) => c.targetDeleted);
        if (reviewDocument !== state.snapshot.id) {
          reviewDocument = state.snapshot.id;
          excludedComments = new Map();
        }
        renderHandoffConflicts(
          $('#handoff-conflicts'),
          conflicts.map((c) => ({
            id: c.id,
            name: c.name || '삭제된 대상',
            text: c.text,
            excluded: excludedComments.get(version.id + ':' + c.id) === c.text,
          })),
          (id, excluded) => {
            const item = conflicts.find((c) => c.id === id);
            if (excluded) excludedComments.set(version.id + ':' + id, item.text);
            else excludedComments.delete(version.id + ':' + id);
            refresh();
          },
          editRequest,
          version.id === '@current',
        );
        const annotations = { ...scene.annotations };
        for (const c of conflicts)
          if (excludedComments.get(version.id + ':' + c.id) === c.text) delete annotations[c.id];
        scene.setComments(annotations);
        version.state.annotations = annotations;
        const requests = handoffRequests(scene);
        $('#handoff-continue').hidden = version.id.startsWith('@');
        $('#export-summary').textContent = version.name + ' · 변경 요청 ' + requests.length + '개';
        $('#review-note').closest('label').hidden = version.id !== '@current';
        if (token === generation)
          renderHandoffRequests(
            $('#handoff-items'),
            requests,
            version.id !== '@original',
            editRequest,
            version.id !== '@current',
          );
        // The image is the review surface; avoid duplicating all cards as text.
        return buildHandoffImage(
          capture,
          scene,
          version.state.note,
          (m) => {
            if (valid()) $('#export-status').textContent = m;
          },
          { mode, versionName: version.name },
        );
      });
      if (!valid()) return;
      if (
        signature !== JSON.stringify(chosen()) ||
        mode !== (state.handoffSettings?.mode || 'reference')
      ) {
        refresh();
        return;
      }
      latest = {
        ...result,
        option: version,
        signature,
        documentId: capture.id,
        sceneGeneration,
        mode,
      };
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(result.blob);
      renderHandoffPreview(
        $('#handoff-preview'),
        previewUrl,
        result,
        chosen()?.id === '@current',
        editRequest,
      );
      if (token !== generation || !$('#export-dialog').open) return;
      $('#export-status').textContent = actionBusy
        ? '최신 이미지가 준비되었습니다. 선택한 동작을 진행합니다…'
        : '이 이미지 한 장을 에이전트 대화에 첨부하세요. 번호별 주석에 반응형 배치 의도를 적으면 더 명확해집니다.';
      hasReady = true;
      available('ready');
    } catch (error) {
      if (token === generation) {
        $('#handoff-preview').textContent = '';
        $('#export-status').textContent = '이미지를 만들지 못했습니다: ' + error.message;
        available('failed');
      }
    }
  }
  adapter.register('handoff-retry', () => {
    if ($('#handoff-preview').dataset.state === 'failed') refresh();
  });
  $('#export-button').addEventListener('click', () => {
    hasReady = false;
    excludedComments = new Map();
    reviewDocument = state.snapshot?.id;
    commitCommentDraft();
    renderVersionOptions($('#handoff-version'), versionOptions(state));
    $('#handoff-version').value = '@current';
    $('#handoff-mode').value = state.handoffSettings?.mode || 'reference';
    $('#export-dialog').showModal();
    refresh();
  });
  $('#handoff-mode').addEventListener('change', () => {
    intentEpoch++;
    hasReady = false;
    state.handoffSettings = { mode: $('#handoff-mode').value === 'exact' ? 'exact' : 'reference' };
    save();
    refresh();
  });
  // A click is an intent, even when blur commits a new note before click dispatch.
  // Queue that intent against its exact document/version/note, never a stale PNG.
  async function imageAction(kind) {
    if (actionBusy) return;
    actionBusy = true;
    const actionId = Symbol();
    activeAction = actionId;
    const epoch = intentEpoch,
      documentId = state.snapshot?.id,
      sceneGeneration = state.generation,
      signature = JSON.stringify(chosen()),
      mode = state.handoffSettings?.mode || 'reference';
    const valid = () =>
      epoch === intentEpoch &&
      $('#export-dialog').open &&
      documentId === state.snapshot?.id &&
      sceneGeneration === state.generation &&
      signature === JSON.stringify(chosen()) &&
      mode === (state.handoffSettings?.mode || 'reference');
    const imagePromise = (async () => {
      await flushEditor();
      if (!valid()) throw Error('전달 기준이 바뀌어 동작을 취소했습니다.');
      if (!currentImage()) {
        if (preparing) await preparing;
        if (valid() && !currentImage() && $('#handoff-preview').dataset.state !== 'failed')
          await refresh();
      }
      if (!valid()) throw Error('전달 기준이 바뀌어 동작을 취소했습니다.');
      if (!currentImage())
        throw Error('이미지를 준비하지 못했습니다. 이미지 다시 만들기를 눌러 주세요.');
      return latest;
    })();
    imagePromise.catch(() => {});
    available($('#handoff-preview').dataset.state);
    $('#export-status').textContent = '최신 설명을 확인하고 선택한 동작을 진행합니다…';
    try {
      if (kind === 'copy') {
        // Start within the user gesture; ClipboardItem waits for the latest PNG.
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': imagePromise.then((image) => image.blob) }),
        ]);
        if (valid())
          $('#export-status').textContent = '이미지를 복사했습니다. 에이전트 대화에 붙여넣으세요.';
      } else {
        const image = await imagePromise;
        if (kind === 'verify') {
          $('#export-dialog').close();
          await implementationReview.open(image.option);
        } else {
          const result = await download(
            'console-canvas-' + image.documentId.slice(0, 8) + '.png',
            image.blob,
            'image/png',
          );
          if (valid())
            $('#export-status').textContent = result?.canceled
              ? '저장을 취소했습니다.'
              : '전달 이미지 한 장을 저장했습니다. 에이전트 대화에 첨부하세요.';
        }
      }
    } catch (error) {
      if (valid())
        $('#export-status').textContent =
          (kind === 'copy'
            ? '복사 실패 · 전달 이미지 저장을 사용할 수 있습니다: '
            : '진행하지 못했습니다: ') + error.message;
      else if (epoch === intentEpoch && kind === 'verify' && !$('#export-dialog').open)
        toast(error.message);
    } finally {
      if (activeAction === actionId) {
        activeAction = null;
        actionBusy = false;
        available($('#handoff-preview').dataset.state);
      }
    }
  }
  $('#handoff-verify').addEventListener('click', () => imageAction('verify'));
  $('#copy-summary').addEventListener('click', () => imageAction('copy'));
  $('#download-review').addEventListener('click', () => imageAction('download'));
  $('#handoff-version').addEventListener('change', () => {
    intentEpoch++;
    hasReady = false;
    refresh();
  });
  $('#handoff-continue').addEventListener('click', async () => {
    if (await continueVersion()) await refresh();
  });
  $('#review-note').addEventListener('input', () => {
    intentEpoch++;
    if (!$('#export-dialog').open) return;
    $('#export-status').textContent = '추가 설명을 이미지에 반영합니다…';
    clearTimeout(noteTimer);
    noteTimer = setTimeout(refresh, 250);
  });
  $('#review-note').addEventListener('change', () => {
    // No synchronous disabling on blur: the following click must reach its handler.
    if ($('#export-dialog').open) {
      clearTimeout(noteTimer);
      noteTimer = setTimeout(refresh, 0);
    }
  });
  $('#export-dialog').addEventListener('close', () => {
    if ($('#export-dialog').open) return;
    generation++;
    intentEpoch++;
    clearTimeout(noteTimer);
    activeAction = null;
    actionBusy = false;
    latest = null;
    preparing = null;
    hasReady = false;
    available('idle');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    clearReact($('#handoff-preview'));
  });
  $('#save-document').addEventListener('click', async () => {
    if (!state.ready) return;
    $('#document-menu-content').hidePopover();
    const button = $('#save-document');
    button.disabled = true;
    try {
      prepareEditor();
      const documentId = state.snapshot.id;
      let storageError = null;
      try {
        await flushEditor();
      } catch (error) {
        storageError = error;
      }
      if (state.snapshot?.id !== documentId || !state.ready)
        throw new Error('문서가 바뀌었습니다. 현재 문서에서 다시 저장해 주세요.');
      const payload = reviewPayload(
        state.snapshot,
        state.scene,
        $('#review-note').value,
        state.timeline,
        state.activity,
        state.activityHead,
        state.aiRequests,
        state.aiDraft,
        {
          handoffSettings: state.handoffSettings,
          implementationReviews: state.implementationReviews,
        },
      );
      const result = await download(
        'console-canvas-' + state.snapshot.id.slice(0, 8) + '.uiclone.json',
        JSON.stringify(payload),
        'application/json',
      );
      toast(
        result?.canceled
          ? '저장을 취소했습니다.'
          : storageError
            ? '긴급 편집 파일을 저장했습니다. 기기 자동 저장 오류는 계속되고 있습니다: ' +
              storageError.message
            : '편집 파일을 저장했습니다. 주석·분기·변경 이력·휴지통도 포함됩니다.',
      );
    } catch (error) {
      toast('편집 파일 저장 실패: ' + error.message);
    } finally {
      button.disabled = !state.ready;
    }
  });
  let directCopying = false;
  async function copyCurrentImage() {
    if (directCopying || !state.ready) return;
    directCopying = true;
    try {
      commitCommentDraft();
      await flushEditor();
      if (state.scene.comments().some((c) => c.targetDeleted)) {
        $('#export-button').click();
        toast('삭제된 대상의 주석을 확인한 뒤 전달해 주세요.');
        return;
      }
      const id = state.snapshot.id,
        revision = state.revision,
        generation = state.generation;
      const option = versionOptions(state).find((v) => v.id === '@current');
      const result = await withVersionScene(state.snapshot, option.state, (scene) =>
        buildHandoffImage(state.snapshot, scene, option.state.note, undefined, {
          mode: state.handoffSettings?.mode,
          versionName: option.name,
        }),
      );
      if (
        state.snapshot?.id !== id ||
        state.revision !== revision ||
        state.generation !== generation
      )
        throw Error('작업이 바뀌어 이미지를 복사하지 않았습니다. 다시 실행해 주세요.');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': result.blob })]);
      toast('현재 작업의 전달 이미지를 복사했습니다.');
    } catch (error) {
      toast('이미지를 복사하지 못했습니다. 변경 내용 전달에서 PNG로 저장하세요. ' + error.message);
    } finally {
      directCopying = false;
    }
  }
  return { copyCurrentImage };
}
