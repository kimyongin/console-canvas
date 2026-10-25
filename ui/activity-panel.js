import { activityBranch } from '../activity-history.js';
import { pointTarget } from '../edit-commands.js';
export function createActivityPanel({ $, state, selectNode, focusComment }) {
  const labels = {
    move: '요소 이동',
    delete: '삭제 상태 변경',
    copy: '복사본 추가',
    comment: '주석 변경',
    property: '속성 변경',
  };
  function render() {
    const list = $('#activity-list');
    list.replaceChildren();
    const all = $('#activity-scope').value === 'all',
      filter = $('#activity-filter').value;
    const entries = activityBranch(state, all);
    $('#activity-branch').textContent =
      state.timeline?.entries.find((e) => e.id === state.timeline.activeId)?.name || '현재 작업';
    for (const event of entries) {
      const changes =
        filter === 'all'
          ? event.changes
          : event.changes.filter((c) =>
              filter === 'layout' ? ['move', 'delete', 'copy'].includes(c.type) : c.type === filter,
            );
      if (filter !== 'all' && !changes.length) continue;
      const card = document.createElement('article');
      card.className = 'activity-event';
      card.dataset.eventId = event.id;
      const heading = document.createElement('strong');
      heading.textContent = event.label;
      const time = document.createElement('small');
      time.textContent =
        new Date(event.created_at).toLocaleTimeString('ko-KR', {
          hour: '2-digit',
          minute: '2-digit',
        }) + (event.actor === 'agent' ? ' · 에이전트' : '');
      card.append(time, heading);
      for (const change of changes) {
        const button = document.createElement('button');
        button.className = 'activity-change';
        button.textContent =
          (labels[change.type] || '변경') +
          ' · ' +
          change.name +
          (change.type === 'comment' ? '\n' + (change.after || '주석 삭제') : '');
        button.disabled =
          !change.id || (!pointTarget(change.id) && !state.scene?.nodes.has(change.id));
        button.addEventListener('click', () => {
          if (!pointTarget(change.id)) selectNode(change.id, { reveal: true });
          else {
            const p = pointTarget(change.id);
            state.scene.showPointComment(p.x, p.y);
          }
          if (change.type === 'comment') focusComment({ id: change.id });
        });
        card.append(button);
      }
      list.append(card);
    }
    if (!list.children.length)
      list.textContent = entries.length
        ? '이 종류의 변경이 없습니다.'
        : '이 버전의 변경 이력이 없습니다. 새 편집부터 시간순으로 기록합니다.';
  }
  for (const id of ['#activity-scope', '#activity-filter'])
    $(id).addEventListener('change', render);
  return { render };
}
