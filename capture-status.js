// Evidence about collection limits, not a visual similarity score. Old files
// receive the same read-only assessment; never rewrite captures or sessions.
export function captureAssessment(snapshot, elements = new Map()) {
  const nodes = new Map((snapshot?.nodes || []).map((node) => [node.id, node]));
  const items = [],
    seen = new Set();
  const add = (kind, message, id, severity = 'info', key = kind + ':' + (id || message)) => {
    if (seen.has(key)) return;
    seen.add(key);
    if (nodes.get(id)?.scopeHidden) return;
    const node = nodes.get(id),
      el = elements.get(id);
    items.push({
      kind,
      message,
      severity,
      ...(node ? { id, name: typeof node.name === 'string' ? node.name : kind } : {}),
      actionable: !!el,
    });
  };
  const names = {
    assets: '외부 자산',
    capture_limit: '촬영 범위 제한',
    screenshot: '촬영 실패',
    raster: '한 레이어',
    shadow: '구조 변환',
  };
  for (const warning of snapshot?.warnings || []) {
    if (!warning || typeof warning.message !== 'string') {
      add(
        '정보 형식',
        '일부 수집 경고를 읽지 못했습니다. 원본 화면을 확인하세요.',
        undefined,
        'loss',
      );
      continue;
    }
    add(
      Object.hasOwn(names, warning.type) ? names[warning.type] : '수집 참고',
      warning.message,
      warning.id,
      ['assets', 'capture_limit', 'screenshot', 'dynamic'].includes(warning.type)
        ? 'loss'
        : warning.type === 'raster'
          ? 'constraint'
          : 'info',
    );
  }
  for (const node of nodes.values()) {
    if (node.scopeHidden) continue;
    const el = elements.get(node.id);
    if (node.image?.broken)
      add(
        '원본 이미지 로딩 실패',
        '가져오기 당시 원본에서도 표시되지 않은 이미지입니다. 다시 읽기를 시도할 수 있습니다.',
        node.id,
        'loss',
      );
    if (node.frame?.mode === 'image')
      add(
        '프레임 이미지',
        '내부 요소를 개별 편집할 수 없습니다.' +
          (node.frame.failure?.message ? ' ' + node.frame.failure.message : ''),
        node.id,
        'constraint',
      );
    for (const [asset, coverage] of [
      ['이미지', el?.dataset.uicImageCoverage],
      ['배경 이미지', el?.dataset.uicBackgroundCoverage],
      ['프레임·화면 영역', el?.dataset.uicRasterCoverage],
    ]) {
      if (coverage === 'partial' || coverage === 'unavailable')
        add(
          asset + (coverage === 'partial' ? ' 부분 수집' : ' 누락'),
          coverage === 'partial'
            ? '촬영한 범위만 복원됐습니다. 전체가 원본과 같은지 확인하세요.'
            : '가져온 자료로 이 영역을 복원하지 못했습니다. 원본을 확인하거나 다시 가져오세요.',
          node.id,
          'loss',
          asset + ':' + node.id,
        );
    }
  }
  const counts = { loss: 0, constraint: 0, info: 0 };
  for (const item of items) counts[item.severity]++;
  return {
    items,
    counts,
    label: counts.loss
      ? '가져오기 · 수집 확인 ' + counts.loss + '건'
      : counts.constraint
        ? '가져오기 · 편집 제약 ' + counts.constraint + '건'
        : counts.info
          ? '가져오기 · 참고 ' + counts.info + '건'
          : '가져오기 · 화면 비교 전',
  };
}
