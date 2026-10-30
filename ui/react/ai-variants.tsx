import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { renderReact } from './mount';
import { Button } from './components/button';
import { Input } from './components/input';
import { Textarea } from './components/textarea';
import { NativeSelect } from './components/surfaces';
interface Candidate {
  id: string;
  name: string;
  summary: string;
  point: unknown;
}
interface Request {
  id: string;
  prompt: string;
  count: number;
  status: string;
  candidates: Candidate[];
  baseline: unknown;
  selectedId?: string;
  route?: string;
  execution?: {
    model?: string;
    usage?: { input_tokens: number; output_tokens: number }[];
    failures?: { code: string }[];
  };
}
interface Draft {
  prompt: string;
  count: number;
  route: string;
}
interface Actions {
  draft(): Draft;
  saveDraft(value: Draft): void;
  initialNew(): boolean;
  context(): { target: string; comments: number; version: string };
  currentCandidate(request: string): string;
  remembered(): { requestId?: string; candidateId?: string };
  remember(value: { requestId: string; candidateId: string }): void;
  connection(): boolean;
  connect(): void;
  create(value: {
    prompt: string;
    count: number;
    route: string;
    basis_request_id?: string;
    basis_candidate_id?: string;
  }): Promise<Request>;
  cancel(id: string): Promise<unknown>;
  apply(request: string, candidate: string): Promise<unknown>;
  instruction(id: string): string;
  preview(point: unknown): Promise<{ html: string; size: { width: number; height: number } }>;
  apiStatus(): { configured: boolean; model: string };
  configureApi(value: { key: string; model: string }): Promise<void>;
  forgetApi(): void;
  close(): void;
}
function Preview({
  point,
  actions,
  title,
  zoom,
  onZoom,
}: {
  point: unknown;
  actions: Actions;
  title: string;
  zoom: string;
  onZoom: (value: string) => void;
}) {
  const [result, setResult] = useState<{
    html: string;
    size: { width: number; height: number };
  } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    setResult(null);
    setError('');
    actions
      .preview(point)
      .then((value) => {
        if (current) setResult(value);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [point, actions]);
  const viewport = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 460, height: 350 });
  useLayoutEffect(() => {
    const host = viewport.current!;
    const measure = () => {
      if (host.clientWidth) setBounds({ width: host.clientWidth, height: host.clientHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  const scale = result
    ? zoom === 'fit'
      ? Math.max(
          0.05,
          Math.min(1, bounds.width / result.size.width, bounds.height / result.size.height),
        )
      : Number(zoom)
    : 1;
  return (
    <section className="ai-preview">
      <div className="ai-preview-heading">
        <strong>{title}</strong>
        <NativeSelect
          aria-label={title + ' 확대'}
          value={zoom}
          onChange={(e) => onZoom(e.target.value)}
        >
          <option value="fit">맞춤</option>
          <option value="0.5">50%</option>
          <option value="1">100%</option>
        </NativeSelect>
      </div>
      <div className="ai-preview-scroll" ref={viewport}>
        {result ? (
          <div
            style={{
              position: 'relative',
              width: result.size.width * scale,
              height: result.size.height * scale,
            }}
          >
            <iframe
              title={title}
              sandbox="allow-same-origin"
              referrerPolicy="no-referrer"
              srcDoc={result.html}
              width={result.size.width}
              height={result.size.height}
              style={{
                transform: `scale(${scale})`,
                transformOrigin: '0 0',
                position: 'absolute',
                border: 0,
                pointerEvents: 'none',
              }}
            />
          </div>
        ) : (
          <p role="status">{error || '미리보기 준비 중…'}</p>
        )}
      </div>
    </section>
  );
}
function AiVariants({ requests, actions }: { requests: Request[]; actions: Actions }) {
  const [prompt, setPrompt] = useState(actions.draft().prompt),
    [count, setCount] = useState(actions.draft().count),
    [route, setRoute] = useState(actions.draft().route),
    [formOpen, setFormOpen] = useState(actions.initialNew() || !requests.length),
    [apiKey, setApiKey] = useState(''),
    [model, setModel] = useState(actions.apiStatus().model),
    [configured, setConfigured] = useState(actions.apiStatus().configured),
    [requestId, setRequestId] = useState(
      () =>
        [...requests].reverse().find((r) => actions.currentCandidate(r.id))?.id ||
        actions.remembered().requestId ||
        requests.at(-1)?.id ||
        '',
    ),
    [candidateId, setCandidateId] = useState(() =>
      requestId
        ? actions.currentCandidate(requestId) ||
          (actions.remembered().requestId === requestId ? actions.remembered().candidateId : '') ||
          ''
        : '',
    ),
    [authOpen, setAuthOpen] = useState(false),
    [previewZoom, setPreviewZoom] = useState('fit'),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    promptField = useRef<HTMLTextAreaElement>(null),
    creating = useRef(false),
    previousDraft = useRef<Draft | null>(null);
  const request = requests.find((r) => r.id === requestId),
    candidate = request?.candidates.find((c) => c.id === candidateId) || request?.candidates[0];
  const currentCandidateId = request ? actions.currentCandidate(request.id) : '';
  const context = actions.context();
  useEffect(() => {
    if (formOpen) promptField.current?.focus();
  }, [formOpen]);
  async function createRequest(copyText: boolean) {
    if (creating.current) return;
    creating.current = true;
    await run(async () => {
      const item = await actions.create({ prompt, count, route });
      updateDraft({ prompt: '' });
      setRequestId(item.id);
      actions.remember({ requestId: item.id, candidateId: '' });
      setCandidateId('');
      setFormOpen(false);
      setMessage(
        route === 'api'
          ? 'API로 시안을 생성하고 있습니다.'
          : '요청을 보관했습니다. 에이전트 대화에 전달해야 실행됩니다.',
      );
      if (copyText && route === 'mcp')
        try {
          await navigator.clipboard.writeText(actions.instruction(item.id));
          setMessage('요청을 보관하고 복사했습니다. 에이전트 대화에 붙여넣으세요.');
        } catch {
          setMessage(
            '요청은 보관됐지만 복사하지 못했습니다. 아래 요청 문장 복사를 다시 눌러 주세요.',
          );
        }
    });
    creating.current = false;
  }
  const apiBlocked = route === 'api' && !configured;
  function updateDraft(next: Partial<Draft>, { preserveUndo = false } = {}) {
    if (!preserveUndo) previousDraft.current = null;
    const value = { prompt, count, route, ...next };
    setPrompt(value.prompt);
    setCount(value.count);
    setRoute(value.route);
    actions.saveDraft(value);
  }
  function chooseCandidate(id: string) {
    setCandidateId(id);
    actions.remember({ requestId, candidateId: id });
  }
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={'ai-variants' + (candidate && !formOpen ? ' ai-review-mode' : '')}>
      <header>
        <div>
          <h2>AI 시안</h2>
          <p>같은 기준에서 만든 대안을 비교하고 하나를 선택하세요.</p>
        </div>
        <Button id="ai-close" onClick={actions.close} aria-label="AI 시안 닫기">
          ×
        </Button>
      </header>
      <details
        className="ai-new-request"
        open={formOpen}
        onToggle={(e) => setFormOpen(e.currentTarget.open)}
      >
        <summary>새 시안 요청</summary>
        <p className="ai-context" id="ai-context-summary">
          대상: {context.target} · 문서 주석 {context.comments}개 · 기준: {context.version}
        </p>
        <div className="ai-request-form">
          <label className="ai-request-picker">
            실행 방식
            <NativeSelect
              id="ai-route"
              value={route}
              onChange={(e) => {
                updateDraft({ route: e.target.value });
              }}
            >
              <option value="mcp">외부 에이전트 · MCP</option>
              <option value="api">AI API 직접 호출 · 별도 과금</option>
            </NativeSelect>
          </label>
          <label htmlFor="ai-prompt">어떻게 개선할까요?</label>
          <Textarea
            id="ai-prompt"
            ref={promptField}
            value={prompt}
            onChange={(e) => updateDraft({ prompt: e.target.value })}
            placeholder="예: 검색 조건을 한 줄로 정리하고 중요한 작업 버튼을 강조해 줘"
            maxLength={8000}
          />
          <div className="ai-request-actions">
            <label>
              시안 수{' '}
              <Input
                id="ai-count"
                type="number"
                min={1}
                max={12}
                value={count}
                onChange={(e) => updateDraft({ count: Number(e.target.value) })}
              />
            </label>
            <Button
              id="ai-create"
              disabled={busy || apiBlocked}
              aria-describedby="ai-readiness"
              onClick={(e) => {
                if (e.detail <= 1) createRequest(route === 'mcp');
              }}
            >
              {route === 'api' ? 'API로 시안 생성' : '요청 보관하고 복사'}
            </Button>
            {route === 'mcp' && (
              <Button
                id="ai-store-only"
                disabled={busy}
                variant="outline"
                onClick={() => createRequest(false)}
              >
                보관만 하기
              </Button>
            )}
          </div>
          <p id="ai-readiness" className="ai-help" role="status">
            {route === 'api'
              ? configured
                ? 'API 키·모델 등록됨 · 실제 연결은 생성 시 확인합니다.'
                : '생성하려면 AI API 연결에서 키와 모델을 등록하세요.'
              : actions.connection()
                ? 'MCP 연결됨 · 요청 문장을 에이전트 대화에 전달해야 실행됩니다.'
                : 'MCP 연결 안 됨 · 요청은 보관할 수 있으며 연결 후 에이전트 대화에 전달하세요.'}
          </p>
          {route === 'api' && !configured && (
            <Button
              id="ai-open-auth"
              onClick={() => {
                setAuthOpen(true);
                requestAnimationFrame(() => document.getElementById('ai-api-key')?.focus());
              }}
            >
              API 키·모델 설정
            </Button>
          )}
          <Button
            id="ai-reset-draft"
            disabled={busy}
            onClick={() => {
              previousDraft.current = { prompt, count, route };
              updateDraft({ prompt: '', count: 3, route: 'mcp' }, { preserveUndo: true });
            }}
          >
            초안 초기화
          </Button>
          {previousDraft.current && (
            <Button
              id="ai-undo-reset"
              onClick={() => {
                const value = previousDraft.current;
                previousDraft.current = null;
                if (value) updateDraft(value);
              }}
            >
              초안 초기화 되돌리기
            </Button>
          )}
          <p className="ai-help">
            현재 선택·주석·편집을 기준으로 고정합니다. API 실행 시 해당 코드·주석과 화면 이미지를
            OpenAI에 전송합니다. 에이전트가 시안을 반환해도 선택 전까지 캔버스는 유지됩니다.
          </p>
        </div>
        <details
          className="ai-auth"
          open={authOpen}
          onToggle={(e) => setAuthOpen(e.currentTarget.open)}
        >
          <summary>AI API 연결 {configured ? '· 키 등록됨' : ''}</summary>
          <p className="ai-help">
            일반 OpenAI API 사용량으로 별도 과금됩니다. 키는 이 창의 메모리에만 보관하며 재실행 시
            삭제됩니다. ChatGPT 구독 로그인은 인증·제품 자격 검증 후 지원할 예정입니다.
          </p>
          <label htmlFor="ai-api-key">API 키</label>
          <Input
            id="ai-api-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="현재 실행 동안만 사용"
          />
          <label htmlFor="ai-model">모델 ID</label>
          <Input
            id="ai-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="계정에서 사용할 수 있는 모델 ID"
          />
          <div className="ai-request-actions">
            <Button
              id="ai-configure-api"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await actions.configureApi({ key: apiKey, model });
                  setApiKey('');
                  setConfigured(true);
                  setMessage('API 키를 등록했습니다. 실제 추론 연결은 시안 생성 시 확인합니다.');
                })
              }
            >
              키 등록
            </Button>
            <Button
              id="ai-forget-api"
              disabled={!configured}
              onClick={() => {
                actions.forgetApi();
                setConfigured(false);
                setApiKey('');
                setMessage('API 키를 메모리에서 삭제했습니다.');
              }}
            >
              키 삭제
            </Button>
          </div>
        </details>
      </details>
      {!!requests.length && (
        <>
          <label className="ai-request-picker">
            보관된 요청
            <NativeSelect
              id="ai-request-list"
              value={requestId}
              onChange={(e) => {
                setRequestId(e.target.value);
                const id = actions.currentCandidate(e.target.value);
                setCandidateId(id);
                actions.remember({ requestId: e.target.value, candidateId: id });
              }}
            >
              {requests.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.prompt || '선택 영역 개선'} · {r.candidates.length}/{r.count}
                  {r.status === 'canceled'
                    ? ' · 취소됨'
                    : r.status === 'failed'
                      ? ' · 생성 실패'
                      : ''}
                </option>
              ))}
            </NativeSelect>
          </label>
          {request && (
            <>
              <p id="ai-request-state" role="status" className="ai-help">
                {request.status === 'canceled'
                  ? '취소됨'
                  : request.status === 'failed'
                    ? '생성 실패'
                    : request.status === 'ready'
                      ? `후보 ${request.candidates.length}개 완료 · 비교 후 적용하세요.`
                      : request.candidates.length
                        ? `후보 ${request.candidates.length}/${request.count}개 수신 · 완성된 안부터 비교할 수 있습니다.`
                        : request.route === 'api'
                          ? 'API 생성 준비·실행 중'
                          : '요청 보관됨 · 수동 전달 필요 · 자동 실행되지 않음'}
                <Button
                  id="ai-cancel-request"
                  hidden={request.status === 'canceled' || request.status === 'ready'}
                  disabled={busy || request.status === 'canceled' || request.status === 'ready'}
                  onClick={() => run(() => actions.cancel(request.id))}
                >
                  요청 취소
                </Button>
              </p>

              <details className="ai-request-details" open={!request.candidates.length}>
                <summary>요청 전달·추가 생성</summary>
                <div className="ai-request-actions">
                  <Button
                    id="ai-copy-request"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await navigator.clipboard.writeText(actions.instruction(request.id));
                        setMessage('요청 문장을 복사했습니다. 에이전트 대화에 한 번 붙여넣으세요.');
                      })
                    }
                  >
                    요청 문장 복사
                  </Button>

                  {request.route === 'mcp' && (
                    <Button id="ai-connect-agent" onClick={actions.connect}>
                      {actions.connection() ? '연결 상태 보기' : '에이전트 연결하기'}
                    </Button>
                  )}
                  <small>요청 ID: {request.id}</small>
                </div>
                {request.execution && (
                  <p className="ai-help">
                    {request.execution.model} · 입력{' '}
                    {request.execution.usage?.reduce((sum, u) => sum + u.input_tokens, 0) || 0} /
                    출력{' '}
                    {request.execution.usage?.reduce((sum, u) => sum + u.output_tokens, 0) || 0}{' '}
                    토큰
                    {request.execution.failures?.length
                      ? ` · 실패 ${request.execution.failures.length}개 (${request.execution.failures.map((f) => f.code).join(', ')}) · 키·모델·한도를 확인하고 새 요청으로 다시 시도하세요.`
                      : ''}
                  </p>
                )}
                <div className="ai-request-actions">
                  <Button
                    id="ai-regenerate-baseline"
                    disabled={busy || apiBlocked}
                    onClick={() =>
                      run(async () => {
                        const next = await actions.create({
                          prompt: prompt || request.prompt,
                          count,
                          route,
                          basis_request_id: request.id,
                        });
                        setRequestId(next.id);
                        setCandidateId('');
                      })
                    }
                  >
                    같은 기준으로 추가 생성
                  </Button>
                  <Button
                    id="ai-regenerate-candidate"
                    disabled={busy || !candidate || apiBlocked}
                    onClick={() =>
                      run(async () => {
                        const next = await actions.create({
                          prompt: prompt || request.prompt,
                          count,
                          route,
                          basis_request_id: request.id,
                          basis_candidate_id: candidate?.id,
                        });
                        setRequestId(next.id);
                        setCandidateId('');
                      })
                    }
                  >
                    선택 시안에서 추가 생성
                  </Button>
                </div>
                {apiBlocked && (
                  <p className="ai-help">
                    API로 추가 생성하려면 새 시안 요청에서 키와 모델을 등록하세요.
                  </p>
                )}
              </details>
              <div className="ai-review-workspace">
                <div className="ai-candidate-list" aria-label="시안 목록">
                  {request.candidates.map((c) => (
                    <Button
                      key={c.id}
                      data-candidate-id={c.id}
                      aria-pressed={candidate?.id === c.id}
                      onClick={() => chooseCandidate(c.id)}
                    >
                      <strong>{c.name}</strong>
                      <span>{c.summary}</span>
                      {currentCandidateId === c.id && (
                        <small className="ai-current-badge">현재 캔버스</small>
                      )}
                      {candidate?.id === c.id && <small>비교 중</small>}
                      {request.selectedId === c.id && <small>마지막으로 적용</small>}
                    </Button>
                  ))}
                </div>
                {candidate ? (
                  <>
                    <div className="ai-comparison">
                      <Preview
                        point={request.baseline}
                        actions={actions}
                        title="요청 기준"
                        zoom={previewZoom}
                        onZoom={setPreviewZoom}
                      />
                      <Preview
                        point={candidate.point}
                        actions={actions}
                        title={candidate.name}
                        zoom={previewZoom}
                        onZoom={setPreviewZoom}
                      />
                    </div>
                  </>
                ) : (
                  <div className="ai-waiting">
                    {request.status === 'failed'
                      ? '시안 생성에 실패했습니다. 키·모델·사용 한도를 확인해 주세요.'
                      : request.status === 'canceled'
                        ? '요청을 취소했습니다. 완성된 시안은 보존됩니다.'
                        : request.route === 'api'
                          ? 'API가 시안을 준비하고 있습니다. 편집을 계속해도 됩니다.'
                          : '요청 보관됨 · 수동 전달 필요. 요청 문장을 에이전트 대화에 붙여넣으세요. 자동으로 실행되지는 않습니다.'}
                  </div>
                )}
              </div>
              {candidate && (
                <>
                  <p className="ai-selected-summary">{candidate.summary}</p>
                  <div className="ai-apply-row">
                    <p>
                      현재 미저장 작업과 다른 시안을 스냅샷으로 보존합니다. 적용 후 실행 취소할 수
                      있습니다.
                    </p>
                    <Button
                      id="ai-apply"
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await actions.apply(request.id, candidate.id);
                          setMessage(
                            '시안을 적용했습니다. 다른 후보도 스냅샷 목록에 보존했습니다.',
                          );
                        })
                      }
                    >
                      {candidate.name} 적용
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
      <p id="ai-status" role="status">
        {busy ? '처리 중…' : message}
      </p>
    </div>
  );
}
export function renderAiVariants(host: HTMLElement, requests: Request[], actions: Actions) {
  renderReact(host, <AiVariants requests={requests} actions={actions} />);
}
