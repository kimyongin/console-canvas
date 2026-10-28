const regionNames = {
  body: '전체 화면',
  main: '본문',
  header: '상단 영역',
  footer: '하단 영역',
  aside: '사이드바',
  nav: '메뉴',
  table: '목록',
  thead: '목록 헤더',
  tbody: '목록 본문',
  tr: '행',
  td: '셀',
  th: '열 제목',
  form: '입력 영역',
};
export function elementLabel(node, aliases = {}) {
  if (!node) return '요소';
  if (typeof aliases[node.id] === 'string') return aliases[node.id];
  if (node.copiedFrom && node.copyRoot === node.id)
    return elementLabel({ ...node, copiedFrom: null }) + ' · 복사본';
  if (node.tag === 'iframe')
    return (
      (node.name && node.name !== 'iframe' ? node.name.slice(0, 24) : '삽입 화면') +
      (node.frame?.mode === 'dom' ? ' · 요소' : ' · 이미지')
    );
  const name = (node.locator?.label || node.name || '').replace(/\s+/g, ' ').trim();
  const region =
    !['text', 'icon', 'raster'].includes(node.kind) &&
    !['button', 'input', 'select', 'textarea', 'a'].includes(node.tag);
  const identity = (node.locator?.id || '').toLowerCase();
  if (region && /search|filter/.test(identity)) return '검색 영역';
  if (node.tag === 'table' && /customer/.test(identity)) return '고객 목록';
  if (region && node.locator?.label) return name.slice(0, 36);
  if (regionNames[node.tag]) return regionNames[node.tag];
  const suffix =
    {
      button: '버튼',
      input: '입력',
      select: '선택',
      textarea: '입력',
      a: '링크',
      img: '이미지',
      svg: '아이콘',
    }[node.tag] || (node.kind === 'text' ? '텍스트' : node.kind === 'pseudo' ? '문구' : null);
  if (suffix) {
    const short = name.slice(0, 28);
    return (
      (short || node.locator?.id || suffix) + (short && !short.endsWith(suffix) ? ' ' + suffix : '')
    );
  }
  if (/^h[1-6]$/.test(node.tag)) return name.slice(0, 32) + ' 제목';
  if (name && name.length <= 36) return name;
  return (node.tag === 'section' ? '영역' : '그룹') + (name ? ' · ' + name.slice(0, 18) + '…' : '');
}
export function isMajorElement(node) {
  return (
    node.kind === 'icon' ||
    node.kind === 'raster' ||
    [
      'body',
      'iframe',
      'main',
      'aside',
      'header',
      'footer',
      'nav',
      'section',
      'form',
      'table',
      'button',
      'input',
      'select',
      'textarea',
      'a',
    ].includes(node.tag) ||
    /^h[1-6]$/.test(node.tag)
  );
}
