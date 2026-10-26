// Deliberately separate web-source fixture for testing recapture, not editor patches.
export function applyImplementationFixture(doc, partial = false) {
  if (!partial) doc.querySelector('.stats .stat:last-child').remove();
  doc.querySelector('#customer-filter').append(doc.querySelector('#new-customer'));
  const style = doc.createElement('style');
  style.textContent = `${partial ? '' : '.stats{grid-template-columns:repeat(2,minmax(0,1fr))}'}
    .filters{flex-wrap:wrap}#new-customer{margin-left:auto}
    @media(max-width:760px){body{min-width:0}.sidebar{display:none}.page{margin-left:0}main{padding:16px}.stats{grid-template-columns:1fr}.filters #new-customer{flex-basis:100%;width:100%}}`;
  doc.head.append(style);
  doc.title = partial ? 'QA 구현 결과 · 일부 반영' : 'QA 구현 결과 · 전체 반영';
}
