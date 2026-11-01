import { useEffect, useState } from 'react';
import { renderReact } from './mount';
import { Button } from './components/button';
import { Input } from './components/input';
import { listTickets, TICKET_STATES } from '../../ticket-model.js';
import { restoreDocument } from '../../db.js';
import { ticketSummary, ticketSource } from '../../ticket-presentation.js';
export interface TicketUIOptions {
  project?: string;
  documentId?: string;
  open(id: string): Promise<void>;
  close(): void;
  changed(): void;
  handoff?(intent: 'read' | 'implement'): Promise<void>;
}
function Tickets({ options }: { options: TicketUIOptions }) {
  const [rows, setRows] = useState<any[]>([]),
    [filter, setFilter] = useState('unfinished'),
    [query, setQuery] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [readyCount, setReadyCount] = useState(0);
  const load = async () =>
    (
      await listTickets(options.project, {
        status: filter === 'trash' ? 'all' : filter,
        query,
        deleted: filter === 'trash',
        limit: 10000,
      })
    ).tickets;
  const refresh = async () => {
    setRows(await load());
    setReadyCount((await listTickets(options.project, { status: 'ready', limit: 1 })).total);
  };
  useEffect(() => {
    let current = true;
    listTickets(options.project, { status: 'ready', limit: 1 })
      .then((r) => {
        if (current) setReadyCount(r.total);
      })
      .catch(() => {});
    load()
      .then((rows) => {
        if (current) setRows(rows);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [filter, query, options.project]);
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
      options.changed();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="ticket-heading">
        <h2 id="tickets-title">티켓 목록</h2>
        <Button variant="ghost" onClick={options.close} aria-label="티켓 목록 닫기">
          ×
        </Button>
      </div>
      <div className="ticket-list-filters">
        <Input
          disabled={busy}
          type="search"
          placeholder="티켓 ID·이름 검색"
          aria-label="티켓 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          disabled={busy}
          aria-label="티켓 상태 필터"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="unfinished">미완료</option>
          <option value="ready">확정 · 미착수</option>
          <option value="all">전체</option>
          <option value="done">완료</option>
          <option value="trash">휴지통</option>
        </select>
      </div>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      <div className="ticket-compact-list" aria-label="프로젝트 티켓">
        {rows.length === 0 && (
          <p className="empty-small">
            {filter === 'unfinished' && !query
              ? '웹사이트에서 화면을 가져오면 티켓이 여기에 쌓입니다.'
              : '티켓이 없습니다.'}
          </p>
        )}
        {rows.map((t) => (
          <div
            className="ticket-compact-row"
            key={t.id}
            data-ticket-id={t.display_id}
            data-document-id={t.document_id}
          >
            <button
              className="ticket-open"
              title={t.source_url ? '원본: ' + t.source_url : undefined}
              aria-current={t.document_id === options.documentId ? 'page' : undefined}
              disabled={busy || filter === 'trash'}
              onClick={() => run(() => options.open(t.id))}
            >
              {t.thumbnail && <img src={t.thumbnail} alt="" loading="lazy" />}
              <div>
                <strong>
                  <span className="ticket-code">{t.display_id}</span> {t.title}
                </strong>
                <small>
                  {t.comment_count ? `주석 ${t.comment_count} · ` : ''}
                  {ticketSummary(t)}
                </small>
                <small className="ticket-source">{ticketSource(t)}</small>
              </div>
              <span className={'ticket-badge status-' + t.status}>
                {t.revision_requested
                  ? '변경 요청'
                  : t.needs_reconfirmation
                    ? '재확정 필요'
                    : t.status === 'queued'
                      ? '확정'
                      : (TICKET_STATES as Record<string, string>)[t.status]}
              </span>
            </button>
            {filter === 'trash' && (
              <Button
                variant="ghost"
                disabled={busy}
                aria-label={t.display_id + ' 복구'}
                onClick={() => run(() => restoreDocument(t.id))}
              >
                복구
              </Button>
            )}
          </div>
        ))}
      </div>
      {options.handoff && (
        <footer className="ticket-handoff">
          <Button disabled={busy} onClick={() => options.handoff?.('read')}>
            에이전트 조회 요청 복사
          </Button>
          <Button
            disabled={busy || !readyCount}
            title="현재 프로젝트 전체 · 구현 요청 시점에 대상을 확정합니다"
            onClick={() => options.handoff?.('implement')}
          >
            확정 티켓 {readyCount}개 구현 요청 복사
          </Button>
        </footer>
      )}
    </>
  );
}
export function renderTickets(host: Element, options: TicketUIOptions) {
  renderReact(host, <Tickets key={crypto.randomUUID()} options={options} />);
}
