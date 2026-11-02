async function resolveScope(read, request) {
  if (!request || request.mode === 'document') return { mode: 'document' };
  if (!['viewport', 'region'].includes(request.mode))
    throw Error('알 수 없는 가져오기 범위입니다.');
  const view = await read(
    '({url:location.href,x:scrollX,y:scrollY,width:innerWidth,height:innerHeight})',
  );
  if (request.expectedView && JSON.stringify(request.expectedView) !== JSON.stringify(view))
    throw Error('원본 화면이 바뀌었습니다. 영역을 다시 선택해 주세요.');
  const r =
    request.mode === 'viewport'
      ? { x: 0, y: 0, width: view.width, height: view.height }
      : request.rect;
  if (
    !r ||
    !['x', 'y', 'width', 'height'].every((k) => Number.isFinite(r[k])) ||
    r.x < 0 ||
    r.y < 0 ||
    r.width < 1 ||
    r.height < 1 ||
    r.x + r.width > view.width + 1 ||
    r.y + r.height > view.height + 1
  )
    throw Error('화면 안에서 가져올 영역을 선택해 주세요.');
  return {
    mode: request.mode,
    rect: { x: view.x + r.x, y: view.y + r.y, width: r.width, height: r.height },
    viewport: view,
  };
}
module.exports = { resolveScope };
