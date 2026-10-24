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
export function elementLabel(node) {
  if (!node) return '요소';
  if (node.copiedFrom && node.copyRoot === node.id)
    return elementLabel({ ...node, copiedFrom: null }) + ' · 복사본';
  const name = (node.locator?.label || node.name || '').replace(/\s+/g, ' ').trim();
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
