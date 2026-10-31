import { useEffect, useState } from 'react';
import { renderReact } from './mount';
import { Button } from './components/button';
import { Input } from './components/input';
import { Textarea } from './components/textarea';
import {
  listTickets,
  getTicket,
  confirmTicketGoal,
  updateTicket,
  TICKET_STATES,
} from '../../ticket-model.js';
import {
  renameDocument,
  trashDocument,
  restoreDocument,
  setProjectAccess,
  sharedProjects,
} from '../../db.js';
const labels = TICKET_STATES as Record<string, string>;
export interface TicketUIOptions {
  project?: string;
  documentId?: string;
  title?: string;
  note?: string;
  source?: unknown;
  annotations?: unknown;
  selection?: string[];
  ticket?: any;
  confirm?: boolean;
  editRevision?: number;
  capture?(): Promise<string>;
  create(): Promise<void>;
  open(id: string): Promise<void>;
  close(): void;
  changed(): void;
  removed?(id: string): Promise<void>;
}
function Tickets({ options }: { options: TicketUIOptions }) {
  const [rows, setRows] = useState<any[]>([]),
    [ticket, setTicket] = useState<any>(options.ticket || null),
    [confirming, setConfirming] = useState(!!options.confirm),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [filter, setFilter] = useState(''),
    [query, setQuery] = useState(''),
    [deleted, setDeleted] = useState(false),
    [request, setRequest] = useState(options.note || ''),
    [image, setImage] = useState(''),
    [selected, setSelected] = useState(false),
    [summary, setSummary] = useState(''),
    [checks, setChecks] = useState(''),
    [evidence, setEvidence] = useState(''),
    [name, setName] = useState(options.ticket?.title || ''),
    [shared, setShared] = useState(false),
    [accessProject, setAccessProject] = useState(options.project || 'local-project');
  const refresh = async () =>
    setRows(
      (await listTickets(undefined, { status: filter || undefined, query, deleted, limit: 10000 }))
        .tickets,
    );
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [filter, query, deleted]);
  useEffect(() => {
    sharedProjects().then((p) => setShared(p.includes(accessProject)));
  }, [accessProject]);
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
  function file(f: File | undefined, set: (s: string) => void) {
    if (!f) return;
    if (f.size > 12000000) {
      setError('12MB 이하 이미지를 선택해 주세요.');
      return;
    }
    const r = new FileReader();
    r.onload = () => set(String(r.result));
    r.readAsDataURL(f);
  }
  async function update(status: string) {
    const next = await updateTicket({
      ticket_id: ticket.id,
      project_id: ticket.project_id,
      expected_revision: ticket.revision,
      goal_id: ticket.goal?.id,
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
            {confirming
              ? '이 티켓의 목표 확정'
              : ticket
                ? ticket.display_id + ' · ' + ticket.title
                : '작업 티켓'}
          </h2>
          <p>같은 티켓에서 편집·시안·구현·검토를 이어갑니다. 구현은 에이전트에게 요청하세요.</p>
        </div>
        <Button variant="ghost" disabled={busy} onClick={options.close} aria-label="작업 티켓 닫기">
          ×
        </Button>
      </div>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {confirming && ticket ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const saved = await confirmTicketGoal({
                ticket_id: ticket.id,
                project_id: ticket.project_id,
                expected_revision: ticket.revision,
                expected_edit_revision: options.editRevision,
                operation_id: crypto.randomUUID(),
                request,
                image_data_url: image || (await options.capture!()),
                selection_confirmed: !image || selected,
                source: options.source,
                annotations: options.annotations,
                selection: options.selection,
              });
              setTicket(saved);
              setConfirming(false);
              await refresh();
            });
          }}
        >
          <p>
            <strong>{ticket.display_id}</strong>의 현재 편집 또는 대화에서 선택한 시안을 구현 목표로
            고정합니다. 새 티켓은 만들지 않습니다.
          </p>
          <label>
            반영할 의도·완료 조건
            <Textarea
              id="ticket-request"
              required
              maxLength={12000}
              value={request}
              onChange={(e) => setRequest(e.target.value)}
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
                setSelected(false);
              }}
            />
          </label>
          {image && (
            <>
              <img className="ticket-image" src={image} alt="선택한 목표 시안" />
              <label>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(e) => setSelected(e.target.checked)}
                />{' '}
                이 시안을 구현 목표로 선택했습니다.
              </label>
              <Button type="button" variant="ghost" onClick={() => setImage('')}>
                현재 편집 화면 사용
              </Button>
            </>
          )}
          <div className="ticket-actions">
            <Button type="button" variant="outline" disabled={busy} onClick={options.close}>
              취소
            </Button>
            <Button id="ticket-register" type="submit" disabled={busy || (!!image && !selected)}>
              {busy ? '저장 중…' : '이 티켓의 목표 확정'}
            </Button>
          </div>
        </form>
      ) : ticket ? (
        <>
          <div className="ticket-actions">
            <Button
              variant="outline"
              onClick={() => {
                setTicket(null);
                setName('');
              }}
            >
              ← 티켓 목록
            </Button>
            <Button
              onClick={() =>
                run(async () => {
                  await options.open(ticket.id);
                })
              }
            >
              편집 계속하기
            </Button>
          </div>
          <p>
            <strong>{labels[ticket.status]}</strong> · 티켓 r{ticket.revision} · {ticket.project_id}
          </p>
          <label>
            티켓 이름
            <div className="ticket-actions">
              <Input
                aria-label="티켓 이름"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
              />
              <Button
                variant="outline"
                disabled={busy || !name.trim()}
                onClick={() =>
                  run(async () => {
                    await renameDocument(ticket.document_id, name);
                    setTicket(await getTicket(ticket.id));
                  })
                }
              >
                이름 저장
              </Button>
            </div>
          </label>
          {ticket.legacy_workspace && (
            <p className="notice">
              이전 목표는 보존했습니다. 편집 작업 공간은 전환 당시 현재 상태이며 확정 당시 화면과
              다를 수 있습니다.
            </p>
          )}
          {ticket.goal ? (
            <>
              <h3>확정 구현 목표</h3>
              <p className="ticket-request">{ticket.goal.request}</p>
              <img
                className="ticket-image"
                src={ticket.goal.image.data_url}
                alt="변경되지 않는 확정 목표"
              />
            </>
          ) : (
            <p>
              아직 목표를 확정하지 않았습니다. 이 티켓에서 편집하거나 에이전트에게 시안을
              요청하세요.
            </p>
          )}
          <h3>작업·검토 기록</h3>
          {ticket.records.map((r: any) => (
            <article className="ticket-record" key={r.id}>
              <strong>{labels[r.status]}</strong>
              <time>{new Date(r.at).toLocaleString()}</time>
              <p>{r.summary}</p>
              {r.checks && <p>검증: {r.checks}</p>}
              {r.image && <img className="ticket-image" src={r.image.data_url} alt="구현 결과" />}
              {r.review_decision === 'approved' && <p>사람의 승인: {r.review_note}</p>}
            </article>
          ))}
          <label>
            작업·검토 내용
            <Textarea
              id="ticket-summary"
              maxLength={6000}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </label>
          {ticket.status === 'working' && (
            <>
              <label>
                구현 결과 이미지
                <Input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => file(e.target.files?.[0], setEvidence)}
                />
              </label>
              <label>
                검증 결과
                <Textarea value={checks} onChange={(e) => setChecks(e.target.value)} />
              </label>
            </>
          )}
          <div className="ticket-actions">
            {ticket.goal && ['queued', 'blocked'].includes(ticket.status) && (
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
                disabled={busy || !summary.trim()}
                onClick={() => run(() => update('queued'))}
              >
                같은 목표로 다시 열기
              </Button>
            )}
            {ticket.status === 'blocked' && !ticket.goal && (
              <Button disabled={busy || !summary.trim()} onClick={() => run(() => update('draft'))}>
                준비 계속하기
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
          <p>
            확정한 목표가 바뀌면 새 티켓으로 분리하세요. 같은 목표의 구현 수정은 이 티켓에서
            이어갑니다.
          </p>
        </>
      ) : (
        <>
          <div className="ticket-actions">
            <Button id="ticket-new" disabled={busy} onClick={() => run(options.create)}>
              ＋ 새 티켓
            </Button>
            <Input
              aria-label="티켓 검색"
              placeholder="티켓 ID·이름·요청 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label>
              상태
              <select id="ticket-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="">전체</option>
                {Object.entries(labels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="outline" onClick={() => setDeleted(!deleted)}>
              {deleted ? '티켓 목록' : '휴지통'}
            </Button>
          </div>
          {true && (
            <label className="ticket-share">
              공개 프로젝트
              <select
                aria-label="공개 프로젝트"
                value={accessProject}
                onChange={(e) => setAccessProject(e.target.value)}
              >
                {[
                  ...new Set([
                    options.project || 'local-project',
                    ...rows.map((t) => t.project_id),
                  ]),
                ].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <input
                id="share-project"
                type="checkbox"
                checked={shared}
                onChange={(e) => {
                  const checked = e.target.checked;
                  void run(async () => {
                    await setProjectAccess(accessProject, checked);
                    setShared(checked);
                  });
                }}
              />{' '}
              이 프로젝트의 저장된 티켓을 에이전트에 공개 · {accessProject}
            </label>
          )}
          <div id="ticket-list">
            {rows.length ? (
              rows.map((t) => (
                <article className="ticket-row" key={t.id} data-ticket-id={t.id}>
                  <Button
                    variant="ghost"
                    aria-current={t.id === options.documentId ? 'true' : undefined}
                    disabled={busy || deleted}
                    onClick={() => run(() => options.open(t.id))}
                  >
                    <strong>
                      {t.display_id} · {t.title}
                    </strong>
                    <span>
                      {labels[t.status]} · 주석 {t.comment_count || 0}개
                    </span>
                    <small>
                      {t.project_id} ·{' '}
                      {t.request.slice(0, 100) || '편집·주석으로 의도를 준비하는 중'}
                    </small>
                  </Button>
                  <div className="ticket-actions">
                    {deleted ? (
                      <Button
                        onClick={() =>
                          run(async () => {
                            await restoreDocument(t.document_id);
                            await refresh();
                          })
                        }
                      >
                        복구
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          onClick={() =>
                            run(async () => {
                              const value = await getTicket(t.id);
                              setTicket(value);
                              setName(value.title);
                            })
                          }
                        >
                          작업·검토
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() =>
                            run(async () => {
                              await trashDocument(t.document_id);
                              await options.removed?.(t.document_id);
                              await refresh();
                            })
                          }
                        >
                          휴지통으로 이동
                        </Button>
                      </>
                    )}
                  </div>
                </article>
              ))
            ) : (
              <p>
                {deleted
                  ? '휴지통이 비어 있습니다.'
                  : '티켓이 없습니다. 새 티켓을 만들어 편집을 시작하세요.'}
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
      key={String(options.documentId) + ':' + String(options.confirm) + ':' + Date.now()}
      options={options}
    />,
  );
}
