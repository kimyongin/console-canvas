import { elementLabel } from './element-labels.js';
export function createRequestsPanel({ $, state, selectNode, focusComment }) {
  function render() {
    const host = $('#requests-list');
    host.replaceChildren();
    if (!state.scene) {
      $('#activity-count').textContent = '0';
      return;
    }
    const comments = state.scene.comments().map((c) => ({
      id: c.id,
      name: c.name || state.scene.nodes.get(c.id)?.name || '위치 주석',
      text: c.text || c.comment || state.scene.annotations[c.id],
      comment: true,
    }));
    const changes = state.scene.changes().map((c) => ({
      id: c.id,
      name: c.name,
      text:
        c.action === 'delete'
          ? '요소 삭제'
          : c.action === 'copy'
            ? '복사본 추가'
            : c.action === 'resource'
              ? '이미지·폰트 복구'
              : '배치 변경',
      comment: false,
    }));
    const rows = [...comments, ...changes],
      query = $('#requests-search').value.toLowerCase();
    $('#activity-count').textContent = String(rows.length);
    for (const r of rows.filter((r) => (r.name + ' ' + r.text).toLowerCase().includes(query))) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'request-row';
      const name = document.createElement('strong');
      name.textContent = state.scene.nodes.has(r.id)
        ? elementLabel(state.scene.nodes.get(r.id), state.snapshot.layerNames)
        : r.name;
      const desc = document.createElement('span');
      desc.textContent = r.text;
      b.append(name, desc);
      b.onclick = () => {
        if (r.id && state.scene.nodes.has(r.id)) selectNode(r.id, { reveal: true });
        if (r.comment) focusComment({ id: r.id });
      };
      host.append(b);
    }
    if (!host.childElementCount) {
      const p = document.createElement('p');
      p.className = 'empty-small';
      p.textContent = query
        ? '일치하는 요청이 없습니다.'
        : '요소를 편집하거나 주석으로 의도를 남기세요.';
      host.append(p);
    }
  }
  $('#requests-search').addEventListener('input', render);
  return { render };
}
