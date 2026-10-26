import { buildCodeDocument, validateCodePatches } from './code-patches.js';
import { copy, cleanEdits, cleanComments } from './engine.js';
import { expandCopyNodes } from './copy-model.js';

// Versions share the captured DOM; only editing data is copied into each entry.
export function snapshotPoint(value, nodes, baseHtml) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    [value.edits, value.annotations].some(
      (v) => v != null && (typeof v !== 'object' || Array.isArray(v)),
    ) ||
    (value.note != null && typeof value.note !== 'string')
  )
    throw new Error('스냅샷 편집 상태 형식이 올바르지 않습니다.');
  const codePatches = validateCodePatches(value?.codePatches);
  if (codePatches.length && baseHtml) nodes = buildCodeDocument(baseHtml, nodes, codePatches).nodes;
  const edits = cleanEdits(value?.edits, nodes);
  nodes = expandCopyNodes(edits, new Map([...nodes].filter(([, n]) => !n.copiedFrom))).nodes;
  return {
    codePatches,
    edits,
    annotations: cleanComments(value?.annotations, nodes),
    selected: nodes.has(value?.selected) ? value.selected : null,
    selection: Array.isArray(value?.selection)
      ? value.selection.filter((id) => nodes.has(id)).slice(0, 100)
      : value?.selected && nodes.has(value.selected)
        ? [value.selected]
        : [],
    note: typeof value?.note === 'string' ? value.note : '',
    activityHead: typeof value?.activityHead === 'string' ? value.activityHead : null,
  };
}
export function snapshotSignature(point) {
  const edits = Object.entries(point.edits)
    .filter(([, e]) => e.dx || e.dy || e.deleted || e.copy)
    .sort(([a], [b]) => a.localeCompare(b));
  const comments = Object.entries(point.annotations).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([edits, comments, point.note, point.codePatches || []]);
}
export function createSnapshotHistory(options) {
  const { state } = options;
  const current = () =>
    snapshotPoint(
      options.checkpoint(),
      state.scene.captureNodes || state.scene.nodes,
      state.snapshot?.html,
    );
  function initialise(value) {
    const nodes = state.scene.captureNodes || state.scene.nodes;
    if (value != null) {
      if (value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > 500)
        throw new Error('스냅샷 목록 형식이 올바르지 않습니다.');
      const ids = new Set();
      const entries = value.entries.map((entry) => {
        if (
          !entry ||
          typeof entry.id !== 'string' ||
          !/^[\w-]{1,100}$/.test(entry.id) ||
          ids.has(entry.id) ||
          typeof entry.name !== 'string' ||
          !entry.name.trim() ||
          entry.name.length > 120 ||
          !Number.isFinite(Date.parse(entry.createdAt)) ||
          !entry.state ||
          (entry.deletedAt != null && !Number.isFinite(Date.parse(entry.deletedAt)))
        )
          throw new Error('스냅샷 정보가 올바르지 않습니다.');
        ids.add(entry.id);
        return {
          id: entry.id,
          name: entry.name,
          createdAt: entry.createdAt,
          kind: ['initial', 'automatic', 'manual'].includes(entry.kind) ? entry.kind : 'manual',
          parentId: typeof entry.parentId === 'string' ? entry.parentId : null,
          state: snapshotPoint(entry.state, nodes, state.snapshot?.html),
          ...(entry.deletedAt ? { deletedAt: entry.deletedAt } : {}),
        };
      });
      for (const entry of entries) {
        const seen = new Set([entry.id]);
        let parent = entry.parentId;
        while (parent) {
          if (!ids.has(parent) || seen.has(parent))
            throw new Error('스냅샷 부모 관계가 올바르지 않습니다.');
          seen.add(parent);
          parent = entries.find((candidate) => candidate.id === parent).parentId;
        }
      }
      state.timeline = {
        version: 1,
        entries,
        activeId: entries.some((e) => e.id === value.activeId && !e.deletedAt)
          ? value.activeId
          : null,
      };
    } else state.timeline = { version: 1, entries: [], activeId: null };
    if (!state.timeline.entries.length) {
      const entry = append('가져온 상태', 'initial');
      state.timeline.activeId = entry.id;
    }
  }
  function append(name, kind) {
    if (state.timeline.entries.length >= 500)
      throw new Error(
        '스냅샷은 화면당 500개까지 저장할 수 있습니다. 편집 파일을 저장한 뒤 새 화면으로 이어가 주세요.',
      );
    const entry = {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      kind,
      parentId: state.timeline.activeId,
      state: current(),
    };
    state.timeline.entries.push(entry);
    return entry;
  }
  function dirty() {
    const entry = state.timeline?.entries.find((e) => e.id === state.timeline.activeId);
    return (
      !!state.scene && (!entry || snapshotSignature(current()) !== snapshotSignature(entry.state))
    );
  }
  function list({ deleted = false } = {}) {
    return (state.timeline?.entries || [])
      .filter((entry) => !!entry.deletedAt === deleted)
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        created_at: entry.createdAt,
        kind: entry.kind,
        parent_id: entry.parentId,
        ...(entry.deletedAt ? { deleted_at: entry.deletedAt } : {}),
        active: entry.id === state.timeline.activeId,
        change_count: new Set([
          ...Object.entries(entry.state.edits)
            .filter(([, e]) => e.dx || e.dy || e.deleted || e.copy)
            .map(([id]) => id),
          ...(entry.state.codePatches || []).map((op) => op.element_id || '@stylesheet'),
        ]).size,
        comment_count: Object.keys(entry.state.annotations).length,
      }));
  }
  function create(name = '', detail = {}) {
    if (typeof name !== 'string' || name.length > 120)
      throw new Error('스냅샷 이름은 120자 이하로 입력해 주세요.');
    const entry = append(name.trim() || '스냅샷 ' + state.timeline.entries.length, 'manual');
    state.timeline.activeId = entry.id;
    options.changed({ ...detail, label: '스냅샷 저장' });
    return entry;
  }
  function restore(id, detail = {}) {
    const entry = state.timeline.entries.find((e) => e.id === id);
    if (!entry || entry.deletedAt)
      throw new Error('해당 스냅샷을 찾을 수 없습니다. 휴지통에 있다면 먼저 복구해 주세요.');
    if (!dirty() && state.timeline.activeId === id) return { unchanged: true };
    // Protect the current draft without deleting any later or parallel versions.
    const automatic = dirty()
      ? append(
          '이동 전 작업 · ' +
            new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
          'automatic',
        )
      : null;
    options.historyBefore();
    options.apply(copy(entry.state));
    state.timeline.activeId = id;
    options.changed({ ...detail, label: detail.label || '스냅샷 복원 · ' + entry.name });
    return { restored_id: id, automatic_snapshot_id: automatic?.id || null };
  }
  function manage(id, action, name) {
    const entry = state.timeline.entries.find((e) => e.id === id);
    if (!entry) throw new Error('해당 스냅샷을 찾을 수 없습니다.');
    if (action === 'rename') {
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 120)
        throw new Error('이름은 1~120자로 입력해 주세요.');
      entry.name = name.trim();
    } else if (action === 'trash') {
      if (entry.deletedAt) return;
      entry.deletedAt = new Date().toISOString();
      if (state.timeline.activeId === id) state.timeline.activeId = null;
    } else {
      delete entry.deletedAt;
    }
    options.changed({
      label:
        action === 'rename'
          ? '스냅샷 이름 변경'
          : action === 'trash'
            ? '스냅샷을 휴지통으로 이동'
            : '스냅샷 휴지통 복구',
    });
  }
  async function restorePersisted(id, detail = {}, { recover = false } = {}) {
    if (state.transactionBusy) throw new Error('버전 이동을 마친 뒤 다시 시도해 주세요.');
    const before = copy(options.checkpoint());
    const fields = [
      'timeline',
      'activity',
      'activityHead',
      'undo',
      'redo',
      'revision',
      'lastAction',
      'lastCheckpoint',
      'pendingBefore',
      'pendingRedo',
      'snapshotPreviewId',
    ];
    const previous = Object.fromEntries(fields.map((key) => [key, structuredClone(state[key])]));
    state.transactionBusy = true;
    options.setBusy?.(true);
    try {
      if (recover) manage(id, 'recover');
      const result = restore(id, detail);
      await options.persist?.();
      return result;
    } catch (error) {
      options.apply(before);
      Object.assign(state, previous);
      // Replace the failed target in the save queue with the protected current work.
      try {
        await options.persist?.();
      } catch {
        /* Keep the storage error visible. */
      }
      options.render?.();
      throw error;
    } finally {
      state.transactionBusy = false;
      options.setBusy?.(false);
    }
  }
  return {
    initialise,
    addDetached(name, point, parentId) {
      if (state.timeline.entries.length >= 500)
        throw new Error('스냅샷은 500개까지 저장할 수 있습니다.');
      const entry = {
        id: crypto.randomUUID(),
        name,
        createdAt: new Date().toISOString(),
        kind: 'manual',
        parentId: state.timeline.entries.some((e) => e.id === parentId) ? parentId : null,
        state: snapshotPoint(
          point,
          state.scene.captureNodes || state.scene.nodes,
          state.snapshot?.html,
        ),
      };
      state.timeline.entries.push(entry);
      return entry;
    },
    dirty,
    list,
    create,
    restore,
    restorePersisted,
    rename: (id, name) => manage(id, 'rename', name),
    trash: (id) => manage(id, 'trash'),
    recover: (id) => manage(id, 'recover'),
  };
}
