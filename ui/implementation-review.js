import { buildHandoffImage } from '../handoff-image.js';
import { download } from '../export.js';
import { copy } from '../engine.js';
import { snapshotPoint, snapshotSignature } from '../snapshot-history.js';
import { cleanImplementationReviews, reviewCapture } from '../workflow-state.js';
import { listDocuments, getDocument } from '../db.js';
import { handoffRequests } from '../handoff-image.js';
import { withVersionScene, versionOptions } from './version-preview.js';
import { renderImplementationReview } from './react/implementation-review.tsx';
import { clearReact } from './react/mount.tsx';
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
  const items = () => state.implementationReviews || [];
  function find(id) {
    const review = items().find((r) => r.id === id);
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
      await state.saving;
    } catch (error) {
      if (state.snapshot?.id === documentId) {
        state.implementationReviews = previous;
        save();
      }
      throw error;
    }
    if (state.snapshot?.id !== documentId) throw Error('문서가 바뀌었습니다.');
    render();
  }
  async function create(option) {
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
  const actions = {
    close: () => $('#implementation-dialog').close(),
    choose(id) {
      selectedId = id;
      render();
    },
    async refresh() {
      const id = state.snapshot.id,
        epoch = generation;
      const next = await listDocuments(1000);
      if (id !== state.snapshot?.id || epoch !== generation) throw Error('문서가 바뀌었습니다.');
      documents = next.filter((d) => d.id !== id);
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
      if (documentId !== state.snapshot?.id || epoch !== generation)
        throw Error('문서가 바뀌었습니다.');
      const next = copy(review);
      if (review.result) {
        next.id = crypto.randomUUID();
        next.createdAt = new Date().toISOString();
      }
      next.result = {
        snapshot: reviewCapture(value),
        point: snapshotPoint(value, new Map(value.nodes.map((n) => [n.id, n])), value.html),
        name: value.documentName || value.source.title,
      };
      next.requests = next.requests.map((r) => ({ ...r, status: 'pending', note: '' }));
      await persist(
        review.result ? [...items(), next] : items().map((r) => (r.id === review.id ? next : r)),
      );
      selectedId = next.id;
      render();
    },
    update(id, status, note) {
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
      save();
      render();
      return state.saving;
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
  function render() {
    if ($('#implementation-dialog').open)
      renderImplementationReview(
        $('#implementation-content'),
        items(),
        selectedId,
        documents,
        state.snapshot.source,
        actions,
      );
  }
  async function open(option = null) {
    if (!state.ready) return;
    await flushEditor();
    const epoch = ++generation,
      documentId = state.snapshot.id;
    documents = (await listDocuments(1000)).filter((d) => d.id !== documentId);
    if (epoch !== generation || documentId !== state.snapshot?.id) return;
    if (option) {
      const signature = snapshotSignature(option.state);
      const matching = [...items()]
        .reverse()
        .find(
          (r) =>
            snapshotSignature(r.target.point) === signature &&
            r.target.mode === (state.handoffSettings?.mode || 'reference'),
        );
      if (matching) selectedId = matching.id;
      else await create(option);
    } else selectedId = items().at(-1)?.id || null;
    if (!selectedId) await create(versionOptions(state).find((v) => v.id === '@current'));
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
  return { open };
}
