import { cleanAiDraft } from '../ai-draft.js';
import { snapshotSignature } from '../snapshot-history.js';
import { elementLabel } from './element-labels.js';
import { createAiProvider } from '../ai-provider.js';
import { buildAiContext } from '../ai-context.js';
import { renderAiVariants } from './react/ai-variants.tsx';
import { clearReact } from './react/mount.tsx';
import { withVersionScene } from './version-preview.js';
export function createAiPanel({ $, state, manager, adapter, toast, save, checkpoint }) {
  const provider = createAiProvider();
  const jobs = new Set();
  let epoch = 0,
    newRequest = false;
  const selections = new Map();
  const actions = {
    apiStatus: provider.status,
    draft: () => cleanAiDraft(state.aiDraft),
    saveDraft(value) {
      state.aiDraft = cleanAiDraft(value);
      save();
    },
    initialNew: () => newRequest,
    context() {
      const ids = [...state.scene.selection];
      const names = ids.map((id) =>
        elementLabel(state.scene.nodes.get(id), state.snapshot.layerNames),
      );
      const version =
        state.timeline?.entries.find((e) => e.id === state.timeline.activeId)?.name || '현재 작업';
      return {
        target: names.length
          ? names.slice(0, 3).join(', ') + (names.length > 3 ? ` 외 ${names.length - 3}개` : '')
          : '전체 화면',
        comments: Object.keys(state.scene.annotations).length,
        version,
      };
    },
    currentCandidate(requestId) {
      const signature = snapshotSignature(checkpoint());
      return (
        manager.find(requestId).candidates.find((c) => snapshotSignature(c.point) === signature)
          ?.id || ''
      );
    },
    remembered: () => selections.get(state.snapshot.id) || {},
    remember(value) {
      selections.set(state.snapshot.id, value);
    },
    connection: () => $('#mcp-button').classList.contains('connected'),
    connect() {
      $('#ai-dialog').close();
      $('#mcp-button').click();
    },
    async configureApi(value) {
      provider.configure(value);
    },
    forgetApi: () => {
      provider.forget();
      render();
    },
    async create(value) {
      if (value.route === 'api' && !provider.status().configured)
        throw new Error('API 키와 모델을 먼저 등록해 주세요.');
      const item = await manager.create(value);
      if (value.route === 'api') {
        const generation = state.generation,
          currentEpoch = epoch,
          documentId = state.snapshot.id;
        const current = () =>
          epoch === currentEpoch &&
          state.generation === generation &&
          state.snapshot?.id === documentId;
        const target = manager.find(item.id);
        const job = (async () => {
          try {
            const context = await buildAiContext(state.snapshot, item.baseline, { image: true });
            if (!current() || target.status === 'canceled') return;
            target.status = 'running';
            await manager.persist();
            if (!current() || target.status === 'canceled') return;
            const result = await provider.generate({
              request: item,
              context,
              register: (args) => {
                if (!current()) throw new Error('문서가 바뀌었습니다.');
                return manager.register(args);
              },
            });
            if (!current()) return;
            target.execution = result;
            if (result.canceled) target.status = 'canceled';
            else if (result.failures.length)
              target.status = target.candidates.length ? 'partial' : 'failed';
          } catch {
            if (current()) {
              target.status = 'failed';
              target.execution = { failures: [{ code: 'generation_failed' }] };
            }
          } finally {
            if (current()) await manager.persist();
          }
        })()
          .catch(() => {})
          .finally(() => jobs.delete(job));
        jobs.add(job);
      }
      return item;
    },
    cancel: async (id) => {
      provider.cancel(id);
      await manager.cancel(id);
    },
    apply: async (...args) => {
      await manager.apply(...args);
      toast?.(
        '선택한 시안을 적용했습니다. 실행 취소하거나 스냅샷 목록에서 다른 시안으로 이동할 수 있습니다.',
      );
      $('#ai-dialog').close();
    },
    instruction: manager.instruction,
    preview: (point) =>
      withVersionScene(state.snapshot, point, (scene) => ({
        html: scene.serialize(),
        size: scene.contentSize(),
      })),
    close: () => $('#ai-dialog').close(),
  };
  function render() {
    if ($('#ai-dialog').open) renderAiVariants($('#ai-dialog-content'), manager.list(), actions);
  }
  function open(compose) {
    if (!state.ready) return;
    newRequest = compose;
    clearReact($('#ai-dialog-content'));
    $('#ai-dialog').showModal();
    render();
  }
  adapter.register('ai', () => open(false));
  adapter.register('ai-new', () => open(true));
  $('#ai-dialog').addEventListener('close', () => {
    if (!$('#ai-dialog').open) clearReact($('#ai-dialog-content'));
  });
  return {
    render,
    async cancelJobs({ persist = true } = {}) {
      const hadJobs = jobs.size;
      let changed = false;
      epoch++;
      provider.cancelAll();
      for (const item of manager.list())
        if (
          item.route === 'api' &&
          ['running', 'pending', 'partial'].includes(item.status) &&
          !item.execution
        ) {
          manager.find(item.id).status = 'canceled';
          changed = true;
        }
      await Promise.allSettled([...jobs]);
      if (persist && state.ready && (hadJobs || changed)) await manager.persist();
    },
  };
}
