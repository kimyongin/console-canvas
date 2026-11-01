export function ticketSummary(t) {
  return (
    t.current_note?.trim() ||
    t.first_comment?.trim() ||
    (t.change_count ? `배치·속성 변경 ${t.change_count}건` : '변경·요청 없음')
  );
}
export function ticketSource(t) {
  let source = '';
  try {
    const url = new URL(t.source_url);
    source = url.host + url.pathname;
  } catch {}
  const date = new Date(t.created_at);
  return [
    source,
    Number.isNaN(date.getTime())
      ? ''
      : date.toLocaleString('ko-KR', {
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
  ]
    .filter(Boolean)
    .join(' · ');
}
