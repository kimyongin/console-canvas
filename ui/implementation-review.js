import { buildHandoffImage } from '../handoff-image.js';
import { download } from '../export.js';
import { copy, validateSnapshot } from '../engine.js';
import { snapshotPoint, snapshotSignature } from '../snapshot-history.js';
import {
  cleanImplementationReviews,
  reviewCapture,
  sameReviewResult,
  implementationReviewUsage,
} from '../workflow-state.js';
import { listDocuments, getDocument } from '../db.js';
import { handoffRequests } from '../handoff-image.js';
import { withVersionScene, versionOptions } from './version-preview.js';
import { renderImplementationReview } from './react/implementation-review.tsx';
import { clearReact } from './react/mount.tsx';
import { reviewPayload } from '../export.js';
export function createImplementationReview({
  $,
  state,
  adapter,
  save,
  flushEditor,
  commitCommentDraft,
  toast,
}) {
  let generation = 0,
    selectedId = null,
    documents = [];
  let captureDestination = null;
  const documentResults = new Map();
  const items = () => state.implementationReviews || [];
  const live = () => items().filter((r) => !r.deletedAt);
  function find(id) {
    const review = live().find((r) => r.id === id);
    if (!review) throw Error('검토를 찾을 수 없습니다.');
    return review;
  }
  async function persist(next) {
    const documentId = state.snapshot.id,
      previous = items();
    const cleaned = cleanImplementationReviews(next, state.snapshot);
    state.implementationReviews = cleaned;
    save();
    try {
      await flushEditor();
    } catch (error) {
      if (state.snapshot?.id === documentId) {
        state.implementationReviews = previous;
        save();
        try {
          await flushEditor();
        } catch {
          /* Keep the original storage failure visible. */
        }
      }
      throw error;
    }
    if (state.snapshot?.id !== documentId) throw Error('문서가 바뀌었습니다.');
    render();
  }
  async function create(option) {
    if (!implementationReviewUsage(items()).canCreate)
      throw Error(
        '새 검토를 보관할 공간이 없습니다. 검토 기록 관리에서 정리하거나 파일로 백업하세요.',
      );
    commitCommentDraft();
    const documentId = state.snapshot.id,
      sceneGeneration = state.generation;
    const point = snapshotPoint(
      option.state,
      new Map(state.snapshot.nodes.map((n) => [n.id, n])),
      state.snapshot.html,
    );
    const requests = await withVersionScene(state.snapshot, point, (scene) =>
      handoffRequests(scene).map((r) => ({
        id: r.id,
        number: r.number,
        name: r.name,
        text: r.text,
        rect: r.rect,
        status: 'pending',
        note: '',
        sourceId: scene.nodes.get(r.id)?.locator?.id || '',
        selector: scene.nodes.get(r.id)?.locator?.selector || '',
      })),
    );
    if (state.snapshot?.id !== documentId || state.generation !== sceneGeneration)
      throw Error('문서가 바뀌었습니다.');
    const review = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      target: { label: option.name, point, mode: state.handoffSettings?.mode || 'reference' },
      requests,
      result: null,
    };
    await persist([...items(), review]);
    selectedId = review.id;
    render();
    return review;
  }
  const confirmed = new Map(),
    mutations = new Map();
  let verdicts = [];
  const actions = {
    usage: () => implementationReviewUsage(items()),
    async backup() {
      const expectedDocument = state.snapshot.id;
      let storageError = '';
      try {
        await flushEditor();
      } catch (error) {
        storageError = error.message;
      }
      if (!state.ready || state.snapshot?.id !== expectedDocument)
        throw Error('문서가 바뀌었습니다. 현재 문서에서 다시 백업해 주세요.');
      const snapshot = state.snapshot,
        documentId = snapshot.id;
      const payload = reviewPayload(
        snapshot,
        state.scene,
        $('#review-note').value,
        state.timeline,
        state.activity,
        state.activityHead,
        state.aiRequests,
        state.aiDraft,
        { implementationReviews: items(), handoffSettings: state.handoffSettings },
      );
      const result = await download(
        'console-canvas-review-backup-' + documentId.slice(0, 8) + '.uiclone.json',
        JSON.stringify(payload),
        'application/json',
      );
      if (result?.canceled) throw Error('백업 저장을 취소했습니다. 기록은 그대로입니다.');
      if (state.snapshot?.id !== documentId) throw Error('다른 문서로 바뀌었습니다.');
      return storageError
        ? '긴급 편집 파일 백업을 요청했습니다. 기기 자동 저장 오류는 계속됩니다: ' + storageError
        : '편집 파일 백업을 요청했습니다. 저장된 파일을 확인하세요.';
    },
    async manage(id, action, value = '') {
      const target = items().find((r) => r.id === id);
      if (!target) throw Error('검토 기록을 찾을 수 없습니다.');
      if (action === 'purge' && JSON.stringify(target) !== value)
        throw Error('검토 내용이 바뀌었습니다. 다시 확인해 주세요.');
      const next = copy(items()),
        entry = next.find((r) => r.id === id);
      if (action === 'rename') {
        if (typeof value !== 'string' || !value.trim() || value.trim().length > 120)
          throw Error('이름은1~120자로 입력해 주세요.');
        entry.name = value.trim();
      } else if (action === 'trash') entry.deletedAt = new Date().toISOString();
      else if (action === 'recover') delete entry.deletedAt;
      else if (action !== 'purge') throw Error('지원하지 않는 관리 작업입니다.');
      await persist(action === 'purge' ? next.filter((r) => r.id !== id) : next);
      if ((action === 'trash' || action === 'purge') && !live().some((r) => r.id === selectedId))
        selectedId = live().at(-1)?.id || null;
      if (captureDestination?.review_id === id && action !== 'rename') captureDestination = null;
      render();
    },
    currentResult: (id) =>
      sameReviewResult(items().find((r) => r.id === selectedId)?.result, documentResults.get(id)),
    captureAvailable: () => !!window.ConsoleCanvasDesktop?.beginReviewCapture,
    async capture() {
      await flushEditor();
      const review = find(selectedId);
      captureDestination = {
        request_id: crypto.randomUUID(),
        document_id: state.snapshot.id,
        review_id: review.id,
        label: (
          (state.snapshot.documentName || state.snapshot.source.title || '목표') +
          ' · ' +
          review.target.label
        ).slice(0, 160),
        generation: state.generation,
      };
      try {
        await window.ConsoleCanvasDesktop.beginReviewCapture(captureDestination);
      } catch (error) {
        captureDestination = null;
        throw error;
      }
    },
    canUndo: () =>
      verdicts.some((v) => v.document === state.snapshot?.id && v.review === selectedId),
    async undoVerdict() {
      const index = verdicts.findLastIndex(
        (v) => v.document === state.snapshot?.id && v.review === selectedId,
      );
      if (index < 0) throw Error('되돌릴 판정이 없습니다.');
      const v = verdicts[index],
        r = find(v.review).requests.find((r) => r.id === v.id);
      if (!r || r.status !== v.after)
        throw Error('판정이 바뀌었습니다. 현재 상태를 확인해 주세요.');
      await actions.update(r.id, v.before, r.note, { record: false });
      verdicts.splice(index, 1);
      render();
      return { number: r.number, status: v.before };
    },
    close: () => $('#implementation-dialog').close(),
    choose(id) {
      find(id);
      selectedId = id;
      render();
    },
    async refresh() {
      const id = state.snapshot.id,
        epoch = generation;
      const next = await listDocuments(1000);
      if (id !== state.snapshot?.id || epoch !== generation) throw Error('문서가 바뀌었습니다.');
      const enriched = await enrichDocuments(next);
      if (id !== state.snapshot?.id || epoch !== generation) throw Error('문서가 바뀌었습니다.');
      documents = enriched;
      render();
    },
    async fresh() {
      return create(versionOptions(state).find((v) => v.id === '@current'));
    },
    async result(id) {
      const documentId = state.snapshot.id,
        epoch = generation,
        review = find(selectedId);
      const value = await getDocument(id);
      if (!value) throw Error('구현 화면을 찾을 수 없습니다. 다시 가져와 주세요.');
      if (documentId !== state.snapshot?.id || epoch !== generation || selectedId !== review.id)
        throw Error('문서가 바뀌었습니다.');
      const result = resultValue(value);
      documentResults.set(id, result);
      if (sameReviewResult(review.result, result)) return;
      const next = copy(review);
      if (review.result) {
        next.id = crypto.randomUUID();
        next.createdAt = new Date().toISOString();
      }
      next.result = result;
      next.requests = next.requests.map((r) => ({ ...r, status: 'pending', note: '' }));
      await persist(
        review.result ? [...items(), next] : items().map((r) => (r.id === review.id ? next : r)),
      );
      selectedId = next.id;
      render();
    },
    async update(id, status, note, { record = true } = {}) {
      const review = find(selectedId);
      if (!review.result) return;
      if (!['pending', 'done', 'change'].includes(status))
        throw Error('검토 상태가 올바르지 않습니다.');
      const request = review.requests.find((r) => r.id === id);
      if (!request) return;
      const previous = { status: request.status, note: request.note };
      request.status = status;
      request.note = String(note).slice(0, 4000);
      if (JSON.stringify(items()).length > 20_000_000) {
        Object.assign(request, previous);
        throw Error(
          '구현 검토 저장 한도에 도달했습니다. 기존 메모를 줄이거나 편집 파일로 백업해 주세요.',
        );
      }
      const documentId = state.snapshot.id,
        key = review.id + ':' + id;
      if (!confirmed.has(key)) confirmed.set(key, previous);
      const mutation = (mutations.get(key) || 0) + 1;
      mutations.set(key, mutation);
      const after = { status: request.status, note: request.note };
      save();
      const saving = flushEditor();
      render();
      try {
        await saving;
        if (state.snapshot?.id !== documentId) throw Error('문서가 바뀌었습니다.');
        confirmed.set(key, after);
        if (record && previous.status !== status) {
          verdicts.push({
            document: documentId,
            review: review.id,
            id,
            before: previous.status,
            after: status,
          });
          if (verdicts.length > 100) verdicts.shift();
        }
        render();
      } catch (error) {
        if (state.snapshot?.id === documentId && mutations.get(key) === mutation) {
          Object.assign(request, confirmed.get(key));
          render();
        }
        throw error;
      }
    },
    async export(id) {
      const review = find(id),
        result = await withVersionScene(state.snapshot, review.target.point, (scene) =>
          buildHandoffImage(state.snapshot, scene, review.target.point.note, undefined, {
            mode: review.target.mode,
            versionName: review.target.label + ' · 구현 결과 추가 검토',
            requestIds: review.requests.filter((r) => r.status !== 'done').map((r) => r.id),
            requestNotes: Object.fromEntries(
              review.requests.filter((r) => r.note).map((r) => [r.id, r.note]),
            ),
          }),
        );
      const saved = await download(
        'console-canvas-followup-' + review.id.slice(0, 8) + '.png',
        result.blob,
        'image/png',
      );
      if (saved?.canceled) throw Error('이미지 저장을 취소했습니다.');
    },
    async preview(side, reviewId) {
      const review = find(reviewId),
        snapshot = side === 'target' ? state.snapshot : review.result?.snapshot,
        point = side === 'target' ? review.target.point : review.result?.point;
      if (!snapshot || !point) return null;
      return withVersionScene(snapshot, point, (scene) => ({
        ...scene.preview(),
        targets: Object.fromEntries(
          [...scene.nodes]
            .filter(([, n]) => !scene.hidden(n.id))
            .map(([id, n]) => [
              id,
              {
                rect: scene.rect(id),
                sourceId: n.locator?.id || '',
                selector: n.locator?.selector || '',
              },
            ]),
        ),
      }));
    },
  };
  function resultValue(value) {
    validateSnapshot(value);
    return {
      snapshot: reviewCapture(value),
      point: snapshotPoint(value, new Map(value.nodes.map((n) => [n.id, n])), value.html),
      name: value.documentName || value.source.title,
    };
  }
  async function acceptCapture(value, destination) {
    const pending = captureDestination;
    if (
      !pending ||
      destination.request_id !== pending.request_id ||
      destination.document_id !== state.snapshot?.id ||
      destination.review_id !== pending.review_id ||
      selectedId !== pending.review_id ||
      state.generation !== pending.generation
    )
      throw Error('검토 대상이 바뀌어 가져온 화면을 연결하지 않았습니다. 기존 작업은 유지됩니다.');
    const review = find(pending.review_id),
      next = copy(review);
    if (review.result) {
      next.id = crypto.randomUUID();
      next.createdAt = new Date().toISOString();
    }
    next.result = resultValue(value);
    next.requests = next.requests.map((r) => ({ ...r, status: 'pending', note: '' }));
    await persist(
      review.result ? [...items(), next] : items().map((r) => (r.id === review.id ? next : r)),
    );
    if (state.snapshot?.id !== pending.document_id || state.generation !== pending.generation)
      throw Error('검토 대상이 바뀌었습니다.');
    captureDestination = null;
    selectedId = next.id;
    if (!$('#implementation-dialog').open) $('#implementation-dialog').showModal();
    render();
    toast('목표를 유지한 채 구현 화면을 연결했습니다. 요청별로 확인해 주세요.');
  }
  function cancelPending(id) {
    if (!id || captureDestination?.request_id === id) captureDestination = null;
  }
  function render() {
    if ($('#implementation-dialog').open)
      renderImplementationReview(
        $('#implementation-content'),
        items(),
        selectedId,
        documents,
        {
          ...state.snapshot.source,
          title: state.snapshot.documentName || state.snapshot.source.title,
        },
        actions,
      );
  }
  async function enrichDocuments(values) {
    const ids = new Set(
      items()
        .map((r) => r.result?.snapshot.id)
        .filter(Boolean),
    );
    const results = await Promise.all([...ids].map(async (id) => [id, await getDocument(id)]));
    documentResults.clear();
    for (const [id, value] of results) if (value) documentResults.set(id, resultValue(value));
    return values.filter((d) => d.id !== state.snapshot.id);
  }
  async function open(option = null) {
    if (!state.ready) return;
    await flushEditor();
    const epoch = ++generation,
      documentId = state.snapshot.id;
    documents = await enrichDocuments(await listDocuments(1000));
    if (epoch !== generation || documentId !== state.snapshot?.id) return;
    if (option) {
      const signature = snapshotSignature(option.state);
      const matching = [...live()]
        .reverse()
        .find(
          (r) =>
            snapshotSignature(r.target.point) === signature &&
            r.target.mode === (state.handoffSettings?.mode || 'reference'),
        );
      if (matching) selectedId = matching.id;
      else if (implementationReviewUsage(items()).canCreate) await create(option);
      else {
        selectedId = live().at(-1)?.id || null;
        toast('새 검토의 보관 한도에 도달했습니다. 기록 관리에서 정리한 뒤 다시 시작해 주세요.');
      }
    } else selectedId = live().at(-1)?.id || null;
    if (!selectedId && !items().length)
      await create(versionOptions(state).find((v) => v.id === '@current'));
    if (epoch !== generation || documentId !== state.snapshot?.id) return;
    clearReact($('#implementation-content'));
    $('#implementation-dialog').showModal();
    render();
  }
  adapter.register('implementation-review', () =>
    open().catch((error) => {
      $('#review-launch-status').textContent = error.message;
      toast(error.message);
    }),
  );
  $('#implementation-dialog').addEventListener('close', () => {
    if (!$('#implementation-dialog').open) {
      generation++;
      clearReact($('#implementation-content'));
    }
  });
  return { open, acceptCapture, cancelPending };
}
