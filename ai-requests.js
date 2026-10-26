import { copy } from './engine.js';
import { snapshotPoint, snapshotSignature } from './snapshot-history.js';
import { buildCodeDocument } from './code-patches.js';

export function validateAiRequests(value = [], snapshot) {
  if (!Array.isArray(value) || value.length > 100 || JSON.stringify(value).length > 20_000_000)
    throw new Error('AI 요청은 문서당 100개·20MB까지 보관할 수 있습니다.');
  const ids = new Set(),
    nodes = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const requests = value.map((item) => {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !/^[\w-]{1,100}$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.prompt !== 'string' ||
      item.prompt.length > 8000 ||
      !Number.isInteger(item.count) ||
      item.count < 1 ||
      item.count > 12 ||
      !['mcp', 'api'].includes(item.route) ||
      !['pending', 'running', 'partial', 'ready', 'canceled', 'failed'].includes(item.status) ||
      !Number.isFinite(Date.parse(item.createdAt)) ||
      !Array.isArray(item.candidates) ||
      item.candidates.length > item.count
    )
      throw new Error('AI 요청 형식이 올바르지 않습니다.');
    ids.add(item.id);
    const baseline = snapshotPoint(item.baseline, nodes, snapshot.html),
      seen = new Set();
    const candidates = item.candidates.map((candidate) => {
      if (
        !candidate ||
        typeof candidate.id !== 'string' ||
        !/^[\w-]{1,100}$/.test(candidate.id) ||
        seen.has(candidate.id) ||
        typeof candidate.name !== 'string' ||
        !candidate.name.trim() ||
        candidate.name.length > 120 ||
        typeof candidate.summary !== 'string' ||
        candidate.summary.length > 4000
      )
        throw new Error('AI 시안 형식이 올바르지 않습니다.');
      seen.add(candidate.id);
      const point = snapshotPoint(candidate.point, nodes, snapshot.html);
      if (
        JSON.stringify(point.codePatches.slice(0, baseline.codePatches.length)) !==
        JSON.stringify(baseline.codePatches)
      )
        throw new Error('시안이 요청 기준에서 파생되지 않았습니다.');
      return { ...copy(candidate), point };
    });
    const interrupted =
      item.route === 'api' &&
      !item.execution &&
      ['running', 'pending', 'partial'].includes(item.status);
    return {
      ...copy(item),
      baseline,
      candidates,
      ...(interrupted
        ? {
            status: candidates.length ? 'partial' : 'failed',
            execution: { failures: [{ code: 'interrupted' }] },
          }
        : {}),
    };
  });
  const byId = new Map(requests.map((item) => [item.id, item]));
  for (const item of requests) {
    let current = item;
    const visited = new Set();
    while (current.basisRequestId) {
      if (visited.has(current.id)) throw new Error('AI 기준 요청에 순환이 있습니다.');
      visited.add(current.id);
      const basis = byId.get(current.basisRequestId);
      if (
        !basis ||
        (current.basisCandidateId &&
          !basis.candidates.some((c) => c.id === current.basisCandidateId))
      )
        throw new Error('AI 기준 요청/시안 참조가 올바르지 않습니다.');
      current = basis;
    }
  }
  return requests;
}
export function createAiRequests({
  state,
  checkpoint,
  getDraft,
  save,
  flush,
  snapshotHistory,
  render,
  prepare,
}) {
  const find = (id) => {
    const item = (state.aiRequests || []).find((item) => item.id === id);
    if (!item) throw new Error('AI 요청을 찾을 수 없습니다.');
    return item;
  };
  async function create({
    prompt = '',
    count = 3,
    route = 'mcp',
    basis_request_id,
    basis_candidate_id,
  } = {}) {
    if (!state.ready || state.transactionBusy || state.scene.drag || state.scene.areaSelecting)
      throw new Error('편집을 마친 뒤 시안을 요청해 주세요.');
    if (
      typeof prompt !== 'string' ||
      prompt.length > 8000 ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 12 ||
      !['mcp', 'api'].includes(route)
    )
      throw new Error('요청 설명과 시안 수(1~12개)를 확인해 주세요.');
    if ((state.aiRequests || []).length >= 100)
      throw new Error('문서당 AI 요청은 100개까지 보관할 수 있습니다.');
    const basis = basis_request_id ? find(basis_request_id) : null;
    if (basis_candidate_id && !basis) throw new Error('기준 요청을 지정해 주세요.');
    const chosen = basis_candidate_id
      ? basis?.candidates.find((c) => c.id === basis_candidate_id)
      : null;
    if (basis_candidate_id && !chosen) throw new Error('기준 시안을 찾을 수 없습니다.');
    const draft = basis
      ? copy(chosen?.point || basis.baseline)
      : getDraft
        ? getDraft()
        : checkpoint();
    const baseline = snapshotPoint(
      draft,
      new Map(state.snapshot.nodes.map((n) => [n.id, n])),
      state.snapshot.html,
    );
    const item = {
      id: crypto.randomUUID(),
      documentId: state.snapshot.id,
      generation: state.generation,
      revision: state.revision,
      prompt: prompt.trim(),
      count,
      route,
      createdAt: new Date().toISOString(),
      status: 'pending',
      baseSnapshotId:
        chosen?.snapshotId || basis?.anchorId || basis?.baseSnapshotId || state.timeline.activeId,
      ...(basis_request_id
        ? { basisRequestId: basis_request_id, basisCandidateId: basis_candidate_id || null }
        : {}),
      baseline: copy(baseline),
      candidates: [],
    };
    state.aiRequests ||= [];
    if (JSON.stringify([...state.aiRequests, item]).length > 19_990_000)
      throw new Error('AI 요청 저장 한도(20MB)에 도달했습니다. 편집 파일로 백업해 주세요.');
    state.aiRequests.push(item);
    save();
    try {
      await flush();
    } catch (error) {
      state.aiRequests = state.aiRequests.filter((r) => r.id !== item.id);
      save();
      throw error;
    }
    state.aiRequestRevision = (state.aiRequestRevision || 0) + 1;
    render?.();
    return copy(item);
  }
  async function register({ request_id, name, summary = '', patches }) {
    const item = find(request_id);
    if (item.status === 'canceled') throw new Error('취소한 요청에는 시안을 추가할 수 없습니다.');
    if (item.candidates.length >= item.count)
      throw new Error('요청한 시안 수를 모두 받았습니다. 새 요청으로 이어가 주세요.');
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 120 ||
      typeof summary !== 'string' ||
      summary.length > 4000 ||
      !Array.isArray(patches) ||
      !patches.length
    )
      throw new Error('시안 이름·설명·코드 패치를 확인해 주세요.');
    const codePatches = [...item.baseline.codePatches, ...copy(patches)];
    buildCodeDocument(
      state.snapshot.html,
      new Map(state.snapshot.nodes.map((n) => [n.id, n])),
      codePatches,
    );
    const candidate = {
      id: crypto.randomUUID(),
      name: name.trim(),
      summary,
      createdAt: new Date().toISOString(),
      point: { ...copy(item.baseline), codePatches },
    };
    const priorStatus = item.status;
    item.candidates.push(candidate);
    item.status = item.candidates.length >= item.count ? 'ready' : 'partial';
    if (JSON.stringify(state.aiRequests).length > 19_990_000) {
      item.candidates.pop();
      item.status = priorStatus;
      throw new Error('AI 요청 저장 한도(20MB)에 도달했습니다.');
    }
    save();
    try {
      await flush();
    } catch (error) {
      item.candidates.pop();
      item.status = priorStatus;
      save();
      throw error;
    }
    state.aiRequestRevision = (state.aiRequestRevision || 0) + 1;
    render?.();
    return copy(candidate);
  }
  async function cancel(id) {
    const item = find(id),
      previous = item.status;
    item.status = 'canceled';
    save();
    try {
      await flush();
    } catch (error) {
      item.status = previous;
      save();
      throw error;
    }
    state.aiRequestRevision = (state.aiRequestRevision || 0) + 1;
    render?.();
  }
  async function apply(requestId, candidateId) {
    prepare?.();
    const item = find(requestId),
      candidate = item.candidates.find((c) => c.id === candidateId);
    if (!candidate) throw new Error('시안을 찾을 수 없습니다.');
    // Resolve regeneration ancestry before registering siblings. A candidate
    // can be used as a basis even when it has never been applied to the canvas.
    const chain = [],
      seen = new Set();
    function collect(request) {
      if (seen.has(request.id)) throw new Error('AI 기준 요청에 순환이 있습니다.');
      seen.add(request.id);
      if (request.basisRequestId) collect(find(request.basisRequestId));
      chain.push(request);
    }
    collect(item);
    const existing = (id, point) =>
      state.timeline.entries.some(
        (e) =>
          e.id === id &&
          (!point ||
            (snapshotSignature(e.state) === snapshotSignature(point) &&
              e.state.activityHead === point.activityHead)),
      );
    const required =
      chain.reduce(
        (sum, r) =>
          sum +
          Number(!existing(r.anchorId, r.baseline)) +
          r.candidates.filter((c) => !existing(c.snapshotId, c.point)).length,
        0,
      ) + 1;
    if (state.timeline.entries.length + required > 500)
      throw new Error('스냅샷 공간이 부족합니다. 편집 파일을 저장한 뒤 새 문서로 이어가 주세요.');
    for (const request of chain) {
      const basis = request.basisRequestId ? find(request.basisRequestId) : null;
      const parent = basis
        ? request.basisCandidateId
          ? basis.candidates.find((c) => c.id === request.basisCandidateId)?.snapshotId
          : basis.anchorId
        : request.baseSnapshotId;
      if (!existing(request.anchorId, request.baseline))
        request.anchorId = snapshotHistory.addDetached(
          'AI 기준 · ' + (request.prompt.slice(0, 30) || '선택 영역'),
          request.baseline,
          parent,
        ).id;
      for (const c of request.candidates)
        if (!existing(c.snapshotId, c.point))
          c.snapshotId = snapshotHistory.addDetached(c.name, c.point, request.anchorId).id;
    }
    const result = await snapshotHistory.restorePersisted(candidate.snapshotId, {
      label: '시안 적용 · ' + candidate.name,
    });
    item.selectedId = candidate.id;
    save();
    await flush();
    state.aiRequestRevision = (state.aiRequestRevision || 0) + 1;
    render?.();
    return result;
  }
  return {
    persist: async () => {
      save();
      await flush();
      state.aiRequestRevision = (state.aiRequestRevision || 0) + 1;
      render?.();
    },
    create,
    register,
    find,
    cancel,
    apply,
    list: () => copy(state.aiRequests || []),
    instruction: (id) =>
      `Console Canvas 요청 ${id}의 기준 화면·주석·HTML/CSS를 get_ai_context로 읽고, 서로 다른 시안을 register_ai_candidate로 등록해 주세요. 현재 화면에 자동 적용하지 마세요.`,
  };
}
