import { activityGroups } from './activity-groups.js';
import { renderActivityRows } from './react/lists.tsx';
import { activityBranch, activityChanges } from '../activity-history.js';
import { pointTarget } from '../edit-commands.js';
export function changeDescription(change) {
  if (change.type === 'code') return 'HTML·CSS를 수정했습니다. 스냅샷 비교에서 확인할 수 있습니다.';
  if (change.type === 'comment') return change.after || '주석이 삭제되었습니다.';
  const a = change.before || {},
    b = change.after || {};
  if (change.type === 'delete') return b.deleted ? '표시 → 삭제됨' : '삭제됨 → 표시';
  if (change.type === 'copy') return '원본을 유지하고 복사본을 추가했습니다.';
  const parts = [];
  if ((a.dx || 0) !== (b.dx || 0)) parts.push('가로 위치 ' + (a.dx || 0) + ' → ' + (b.dx || 0));
  if ((a.dy || 0) !== (b.dy || 0)) parts.push('세로 위치 ' + (a.dy || 0) + ' → ' + (b.dy || 0));
  return parts.join(' · ') || '배치 속성이 변경되었습니다.';
}
export function createActivityPanel({ $, state, selectNode, focusComment }) {
  const label = (c) =>
    c.type === 'comment'
      ? !c.before
        ? '주석 추가'
        : !c.after
          ? '주석 삭제'
          : '주석 수정'
      : {
          move: '요소 이동',
          delete: c.after?.deleted ? '요소 삭제' : '요소 복원',
          copy: '복사본 추가',
          property: '속성 변경',
          code: 'HTML·CSS 변경',
        }[c.type] || '변경';
  function reveal(change) {
    if (!change.id) return;
    if (pointTarget(change.id)) {
      const p = pointTarget(change.id);
      state.scene.showPointComment(p.x, p.y);
    } else selectNode(change.id, { reveal: true });
    if (change.type === 'comment') focusComment({ id: change.id });
  }
  function render() {
    const list = $('#activity-list');
    const rows = [];
    if (!state.snapshot || !state.scene) {
      $('#activity-count').textContent = '0';
      $('#activity-branch').textContent = '';
      renderActivityRows(list, [], '화면을 열면 변경 이력이 표시됩니다.');
      return;
    }
    const all = $('#activity-all').checked,
      filter = $('#activity-filter').value,
      query = $('#activity-search').value.trim().toLowerCase(),
      selectedOnly = $('#activity-selected').checked;
    const currentPath = new Set(activityBranch(state).map((e) => e.id));
    const entries = activityBranch(state, all),
      covered = new Set();
    $('#activity-branch').textContent =
      (all ? '모든 가지 · 현재 작업 기준 ' : '현재 작업 기준 · ') +
      (state.timeline?.entries.find((e) => e.id === state.timeline.activeId)?.name || '현재 작업');
    function append(event, baseline = false) {
      const changes = event.changes.filter((c) => {
        const matches =
          filter === 'all' ||
          (filter === 'layout'
            ? ['move', 'delete', 'copy'].includes(c.type)
            : filter === 'property'
              ? ['property', 'code'].includes(c.type)
              : c.type === filter);
        return (
          matches &&
          (!selectedOnly || state.scene?.selection.has(c.id)) &&
          (!query ||
            JSON.stringify([
              event.label,
              c.name,
              state.snapshot.layerNames?.[c.id],
              c.before,
              c.after,
            ])
              .toLowerCase()
              .includes(query))
        );
      });
      if ((filter !== 'all' || query || selectedOnly) && !changes.length) return;
      rows.push({
        id: event.id || 'baseline-' + changes[0]?.id,
        time: baseline
          ? typeof baseline === 'string'
            ? baseline
            : '저장된 주석 · 이전 작업에서 유지됨'
          : new Date(event.created_at).toLocaleTimeString('ko-KR', {
              hour: '2-digit',
              minute: '2-digit',
            }) + (event.actor === 'agent' ? ' · 에이전트' : ''),
        heading: changes.length === 1 ? label(changes[0]) : event.label,
        context:
          event.id && !baseline
            ? '기준 ' +
              (state.timeline?.entries.find((e) => e.id === event.snapshot_id)?.name ||
                '저장 전 작업') +
              ' · ' +
              (currentPath.has(event.id) ? '현재 작업 경로' : '다른 경로')
            : '',
        changes: changes.map((change) => ({
          id: change.id || '',
          name:
            state.snapshot.layerNames?.[change.id] ||
            (/^n\d+$/.test(change.name || '') ? '이전 요소 · 현재 화면에 없음' : change.name),
          type: change.type,
          description: changeDescription(change),
          disabled: !change.id || (!pointTarget(change.id) && !state.scene?.nodes.has(change.id)),
          run: () => reveal(change),
        })),
      });
    }
    for (const event of entries) {
      for (const c of event.changes) if (c.type === 'comment') covered.add(c.id);
      append(event);
    }
    // Existing notes must remain visible even when a pre-history capture has no events.
    for (const comment of state.scene?.comments() || [])
      if (!covered.has(comment.id))
        append(
          {
            label: '저장된 주석',
            changes: [
              {
                id: comment.id,
                name: comment.name,
                type: 'comment',
                before: '',
                after: comment.text,
              },
            ],
          },
          true,
        );
    // Summarize preserved edits without inventing dates or persisting events.
    const summaryKey = (c) =>
      (c.id || c.name) +
      ':' +
      (['move', 'property', 'delete', 'copy'].includes(c.type) ? 'layout' : c.type);
    const recorded = new Set(entries.flatMap((e) => e.changes.map(summaryKey)));
    const currentChanges = activityChanges(
      state,
      {},
      {
        codePatches: state.scene?.codePatches || [],
        edits: state.scene?.edits || {},
        annotations: {},
        note: $('#review-note').value,
      },
    );
    for (const change of currentChanges) {
      if (recorded.has(summaryKey(change)) || (change.type === 'comment' && !change.after))
        continue;
      append(
        {
          id: 'preserved-' + (change.id || change.name),
          label: '보존된 현재 변경',
          changes: [change],
        },
        '보존된 현재 변경 · 시간 기록 없음',
      );
    }
    $('#activity-reset').hidden = !all && filter === 'all' && !query && !selectedOnly;
    const byId = new Map(rows.map((row) => [row.id, row])),
      display = [],
      grouped = new Set();
    for (const group of activityGroups(entries)) {
      const children = group.map((e) => byId.get(e.id)).filter(Boolean);
      if (!children.length) continue;
      for (const child of children) grouped.add(child.id);
      if (children.length === group.length && children.length > 1) {
        const first = group[0].changes[0],
          last = group.at(-1).changes[0];
        display.push({
          ...children[0],
          heading: children[0].changes[0].name + ' 위치 조정 · ' + children.length + '회',
          changes: [
            {
              ...children[0].changes[0],
              description: changeDescription({ ...first, before: last.before }),
            },
          ],
          children,
        });
      } else display.push(...children);
    }
    display.push(...rows.filter((row) => !grouped.has(row.id)));
    $('#activity-count').textContent = rows.length;
    renderActivityRows(
      list,
      display,
      query || filter !== 'all' || selectedOnly
        ? '조건에 맞는 변경이 없습니다.'
        : '아직 변경 이력이 없습니다. 편집과 주석이 시간순으로 모입니다.',
    );
  }
  for (const id of ['#activity-all', '#activity-filter', '#activity-selected'])
    $(id).addEventListener('change', render);
  $('#activity-search').addEventListener('input', render);
  $('#activity-reset').addEventListener('click', () => {
    $('#activity-all').checked = false;
    $('#activity-filter').value = 'all';
    $('#activity-search').value = '';
    $('#activity-selected').checked = false;
    render();
  });
  return { render };
}
