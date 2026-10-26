import { elementLabel } from './ui/element-labels.js';
export const RESPONSIVE_INTENTS = [
  {
    label: '좁으면 다음 줄·전체 너비',
    text: '좁은 화면에서는 다음 줄로 내려 전체 너비로 표시해 주세요.',
  },
  {
    label: '좁으면 세로로 쌓기',
    text: '좁은 화면에서는 요소들을 세로로 쌓고 화면 너비에 맞춰 주세요.',
  },
  { label: '좁아져도 구조 유지', text: '좁은 화면에서도 현재 순서와 배치 구조를 유지해 주세요.' },
];
// Geometry is evidence for a suggestion, never an inferred user instruction.
export function suggestDesignIntents(scene, id) {
  const node = scene.nodes.get(id);
  if (!node) return [];
  const name = (n) => elementLabel(n, scene.snapshot.layerNames);
  const change = scene.changes().find((c) => c.id === id);
  const result = [];
  if (scene.hidden(id)) {
    const siblings = [...scene.nodes.values()].filter(
      (n) =>
        n.id !== id &&
        n.parentId === node.parentId &&
        !scene.hidden(n.id) &&
        n.visible &&
        n.tag === node.tag,
    );
    if (siblings.length > 1 && siblings.length <= 6)
      result.push({
        label: `남은 ${siblings.length}개 같은 너비`,
        text: `「${name(node)}」를 제거하고, 남은 ${siblings.length}개 요소가 행의 너비를 같은 비율로 채우게 해 주세요.`,
      });
    result.push({
      label: '삭제한 자리 정리',
      text: '이 요소를 제거하고 남은 요소의 정렬과 간격을 자연스럽게 정리해 주세요.',
    });
  } else if (change?.action === 'move') {
    const r = scene.rect(id),
      ancestors = new Set(scene.ancestors(id));
    if (r) {
      const center = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      const areas = [...scene.nodes.values()]
        .filter(
          (n) =>
            n.id !== id &&
            !ancestors.has(n.id) &&
            !scene.ancestors(n.id).includes(id) &&
            !scene.hidden(n.id) &&
            (['section', 'form', 'header', 'aside', 'nav'].includes(n.tag) ||
              /search|filter/.test(n.locator?.id || '')),
        )
        .map((n) => ({ n, r: scene.rect(n.id) }))
        .filter(
          (v) =>
            v.r &&
            center.x >= v.r.x &&
            center.x <= v.r.x + v.r.width &&
            center.y >= v.r.y &&
            center.y <= v.r.y + v.r.height,
        )
        .sort((a, b) => a.r.width * a.r.height - b.r.width * b.r.height);
      const area = areas[0];
      if (area) {
        const position = (center.x - area.r.x) / area.r.width;
        const edge = position >= 0.66 ? '오른쪽 끝' : position <= 0.34 ? '왼쪽 끝' : '가운데';
        result.push({
          label: `${name(area.n)} ${edge} 정렬`,
          text: `「${name(node)}」를 「${name(area.n)}」 안에서 ${edge}에 정렬해 주세요. 고정 좌표 대신 해당 영역의 배치 구조에 포함해 주세요.`,
        });
      }
    }
    result.push({
      label: '옮긴 위치 기준으로 정렬',
      text: '그림의 이동 후 위치를 기준으로 주변 요소와 정렬·간격을 맞춰 주세요. 좌표를 고정하지 말고 반응형 배치로 구현해 주세요.',
    });
  }
  result.push({
    label: '한 줄로 배치',
    text: '이 영역의 요소들을 한 줄로 배치하고 간격을 일관되게 맞춰 주세요.',
  });
  return result.slice(0, 3);
}
export function appendIntent(text, intent, { responsive = false } = {}) {
  const lines = text
    .split('\n')
    .filter((line) => !responsive || !RESPONSIVE_INTENTS.some((i) => i.text === line.trim()));
  if (!lines.some((line) => line.trim() === intent)) lines.push(intent);
  const value = lines
    .filter((line, i) => line || i > 0)
    .join('\n')
    .trim();
  if (value.length > 4000)
    throw new Error('요청이 4,000자를 넘습니다. 기존 문구를 줄인 뒤 추가해 주세요.');
  return value;
}
