import { useEffect, useState } from 'react';
import { renderReact } from './mount';
import { Button } from './components/button';
import { Input } from './components/input';
import { Textarea } from './components/textarea';
import {
  registerTicket,
  listTickets,
  getTicket,
  updateTicket,
  TICKET_STATES,
} from '../../ticket-model.js';
const labels = TICKET_STATES as Record<string, string>;
export interface TicketUIOptions {
  project: string;
  documentId: string;
  title: string;
  note: string;
  source: unknown;
  annotations: unknown;
  selection: string[];
  capture(): Promise<string>;
  close(): void;
  changed(): void;
  create?: boolean;
}
function Tickets({ options }: { options: TicketUIOptions }) {
  const [rows, setRows] = useState<any[]>([]),
    [ticket, setTicket] = useState<any>(null),
    [creating, setCreating] = useState(!!options.create),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [filter, setFilter] = useState(''),
    [title, setTitle] = useState(options.title.slice(0, 120)),
    [request, setRequest] = useState(options.note),
    [image, setImage] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [summary, setSummary] = useState(''),
    [checks, setChecks] = useState(''),
    [evidence, setEvidence] = useState('');
  const refresh = async () =>
    setRows((await listTickets(options.project, { status: filter || undefined })).tickets);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [filter]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      options.changed();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function file(file: File | undefined, set: (v: string) => void) {
    if (!file) return;
    if (file.size > 12_000_000) {
      setError('12MB 이하 이미지를 선택해 주세요.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set(String(reader.result));
    reader.readAsDataURL(file);
  }
  async function update(status: string) {
    const next = await updateTicket({
      project_id: options.project,
      ticket_id: ticket.id,
      expected_revision: ticket.revision,
      operation_id: crypto.randomUUID(),
      status,
      summary,
      ...(status === 'working' ? { implementation_instruction: summary } : {}),
      ...(status === 'review' ? { implementation_image_data_url: evidence, checks } : {}),
      ...(status === 'done' ? { review_decision: 'approved', review_note: summary } : {}),
    });
    setTicket(next);
    setSummary('');
    setChecks('');
    setEvidence('');
    await refresh();
  }
  return (
    <>
      <div className="ticket-heading">
        <div>
          <h2 id="tickets-title">
            {creating ? '확정 목표 등록' : ticket ? ticket.goal.title : '작업 티켓'}
          </h2>
          <p>{options.project} · 등록만으로 구현을 시작하지 않습니다.</p>
        </div>
        <Button variant="ghost" disabled={busy} onClick={options.close} aria-label="작업 티켓 닫기">
          ×
        </Button>
      </div>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {creating ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const data = image || (await options.capture());
              const saved = await registerTicket({
                project_id: options.project,
                document_id: options.documentId,
                title,
                request,
                image_data_url: data,
                selection_confirmed: !image || confirmed,
                source: options.source,
                annotations: options.annotations,
                selection: options.selection,
                operation_id: crypto.randomUUID(),
              });
              setTicket(saved);
              setCreating(false);
              await refresh();
            });
          }}
        >
          <p>
            현재 편집 화면을 목표 이미지로 고정합니다. 에이전트 대화에서 선택한 이미지로 대체할 수도
            있습니다.
          </p>
          <label>
            티켓 이름
            <Input
              id="ticket-title"
              required
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            반영할 의도·완료 조건
            <Textarea
              id="ticket-request"
              required
              maxLength={12000}
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder="어떤 문제를 어떤 방향으로 개선할지 설명해 주세요."
            />
          </label>
          <label>
            선택한 시안 이미지 (선택)
            <Input
              id="ticket-image"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                file(e.target.files?.[0], setImage);
                setConfirmed(false);
              }}
            />
          </label>
          {image && (
            <>
              <img className="ticket-image" src={image} alt="등록할 목표 시안" />
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />{' '}
                이 시안을 구현 목표로 선택했습니다.
              </label>
              <Button type="button" variant="ghost" onClick={() => setImage('')}>
                현재 화면 사용
              </Button>
            </>
          )}
          <div className="ticket-actions">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setCreating(false)}
            >
              취소
            </Button>
            <Button id="ticket-register" type="submit" disabled={busy || (!!image && !confirmed)}>
              {busy ? '저장 중…' : '목표 확정·등록'}
            </Button>
          </div>
        </form>
      ) : ticket ? (
        <>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setTicket(null);
              setSummary('');
              setError('');
            }}
          >
            ← 티켓 목록
          </Button>
          <p>
            <strong>{labels[ticket.status]}</strong> · r{ticket.revision}
          </p>
          <p className="ticket-request">{ticket.goal.request}</p>
          <img
            className="ticket-image"
            src={ticket.goal.image.data_url}
            alt="변경되지 않는 확정 목표"
          />
          <details>
            <summary>출처·대상 정보</summary>
            <pre>
              {JSON.stringify(
                {
                  source: ticket.goal.source,
                  selection: ticket.goal.selection,
                  annotations: ticket.goal.annotations,
                },
                null,
                2,
              )}
            </pre>
          </details>
          <h3>작업·검토 기록</h3>
          {ticket.records.length ? (
            ticket.records.map((r: any) => (
              <article className="ticket-record" key={r.id}>
                <strong>{labels[r.status]}</strong>
                <time>{new Date(r.at).toLocaleString()}</time>
                <p>{r.summary}</p>
                {r.checks && <p>검증: {r.checks}</p>}
                {r.image && <img className="ticket-image" src={r.image.data_url} alt="구현 결과" />}
                {r.review_decision === 'approved' && <p>사람의 승인: {r.review_note}</p>}
              </article>
            ))
          ) : (
            <p>에이전트에게 이 티켓의 구현을 요청하세요. 구현 지시 후에 작업 중으로 전환합니다.</p>
          )}
          <label>
            작업·검토 내용
            <Textarea
              id="ticket-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              maxLength={6000}
              placeholder="구현 지시, 검증 결과 또는 수정 요청을 남기세요."
            />
          </label>
          {ticket.status === 'working' && (
            <>
              <label>
                구현 결과 이미지
                <Input
                  id="ticket-evidence"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => file(e.target.files?.[0], setEvidence)}
                />
              </label>
              {evidence && (
                <img className="ticket-image" src={evidence} alt="검토에 첨부할 구현 결과" />
              )}
              <label>
                검증 결과
                <Textarea value={checks} onChange={(e) => setChecks(e.target.value)} />
              </label>
            </>
          )}
          <div className="ticket-actions">
            {['queued', 'blocked'].includes(ticket.status) && (
              <Button
                disabled={busy || !summary.trim()}
                onClick={() => run(() => update('working'))}
              >
                구현 지시·작업 시작
              </Button>
            )}
            {ticket.status === 'working' && (
              <Button
                disabled={busy || !summary.trim() || !checks.trim() || !evidence}
                onClick={() => run(() => update('review'))}
              >
                구현 결과·검토 요청
              </Button>
            )}
            {ticket.status === 'review' && (
              <>
                <Button
                  id="ticket-approve"
                  disabled={busy || !summary.trim()}
                  onClick={() => run(() => update('done'))}
                >
                  목표와 비교 후 승인·완료
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !summary.trim()}
                  onClick={() => run(() => update('queued'))}
                >
                  같은 목표로 수정 요청
                </Button>
              </>
            )}
            {ticket.status === 'done' && (
              <Button
                variant="outline"
                disabled={busy || !summary.trim()}
                onClick={() => run(() => update('queued'))}
              >
                같은 목표로 다시 열기
              </Button>
            )}
            {!['done', 'blocked'].includes(ticket.status) && (
              <Button
                variant="outline"
                disabled={busy || !summary.trim()}
                onClick={() => run(() => update('blocked'))}
              >
                확인 필요
              </Button>
            )}
            <Button
              variant="outline"
              disabled={busy || !summary.trim()}
              onClick={() => run(() => update(ticket.status))}
            >
              기록 추가
            </Button>
          </div>
          <p>목표가 바뀌었다면 기존 티켓을 수정하지 않고 새 목표를 등록하세요.</p>
        </>
      ) : (
        <>
          <div className="ticket-actions">
            <Button
              id="ticket-new"
              onClick={() => {
                setCreating(true);
                setError('');
              }}
            >
              목표 확정
            </Button>
            <label>
              상태{' '}
              <select id="ticket-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="">전체</option>
                {Object.entries(labels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div id="ticket-list">
            {rows.length ? (
              rows.map((t) => (
                <Button
                  className="ticket-row"
                  variant="outline"
                  key={t.id}
                  onClick={() =>
                    run(async () => {
                      setTicket(await getTicket(t.id, options.project));
                    })
                  }
                >
                  <strong>{t.title}</strong>
                  <span>{labels[t.status]}</span>
                  <small>{t.request.slice(0, 160)}</small>
                </Button>
              ))
            ) : (
              <p>
                확정한 목표가 없습니다. 에이전트 대화에서 고른 시안이나 현재 편집 결과를 등록하세요.
              </p>
            )}
          </div>
        </>
      )}
    </>
  );
}
export function renderTickets(host: Element, options: TicketUIOptions) {
  renderReact(
    host,
    <Tickets
      key={options.documentId + ':' + String(options.create) + ':' + Date.now()}
      options={options}
    />,
  );
}
