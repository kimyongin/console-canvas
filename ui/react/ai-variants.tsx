import { useEffect, useState } from 'react';
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
interface Actions {
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
  const scale = result ? (zoom === 'fit' ? Math.min(1, 460 / result.size.width) : Number(zoom)) : 1;
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
      <div className="ai-preview-scroll">
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
  const [prompt, setPrompt] = useState(''),
    [count, setCount] = useState(3),
    [route, setRoute] = useState(requests.at(-1)?.route || 'mcp'),
    [formOpen, setFormOpen] = useState(!requests.length),
    [apiKey, setApiKey] = useState(''),
    [model, setModel] = useState(actions.apiStatus().model),
    [configured, setConfigured] = useState(actions.apiStatus().configured),
    [requestId, setRequestId] = useState(requests.at(-1)?.id || ''),
    [candidateId, setCandidateId] = useState(''),
    [previewZoom, setPreviewZoom] = useState('fit'),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const request = requests.find((r) => r.id === requestId),
    candidate = request?.candidates.find((c) => c.id === candidateId) || request?.candidates[0];
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
    <div className="ai-variants">
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
        <details className="ai-auth">
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
        <div className="ai-request-form">
          <label className="ai-request-picker">
            실행 방식
            <NativeSelect id="ai-route" value={route} onChange={(e) => setRoute(e.target.value)}>
              <option value="mcp">외부 에이전트 · MCP</option>
              <option value="api">AI API 직접 호출 · 별도 과금</option>
            </NativeSelect>
          </label>
          <label htmlFor="ai-prompt">어떻게 개선할까요?</label>
          <Textarea
            id="ai-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
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
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </label>
            <Button
              id="ai-create"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const item = await actions.create({ prompt, count, route });
                  setRequestId(item.id);
                  setCandidateId('');
                  setFormOpen(false);
                  setMessage(
                    route === 'api'
                      ? '선택 영역의 코드·주석을 OpenAI API로 보내 시안을 생성하고 있습니다.'
                      : '요청이 저장되었습니다. 요청 문장을 복사해 연결한 에이전트에게 보내세요.',
                  );
                })
              }
            >
              {route === 'api' ? 'API로 시안 생성' : '외부 에이전트에 요청'}
            </Button>
          </div>
          <p className="ai-help">
            현재 선택·주석·편집을 기준으로 고정합니다. API 실행 시 해당 코드·주석과 화면 이미지를
            OpenAI에 전송합니다. 에이전트가 시안을 반환해도 선택 전까지 캔버스는 유지됩니다.
          </p>
        </div>
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
                setCandidateId('');
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
              <details className="ai-request-details" open={!request.candidates.length}>
                <summary>요청 전달 정보</summary>
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
                  <Button
                    id="ai-cancel-request"
                    disabled={busy || request.status === 'canceled' || request.status === 'ready'}
                    onClick={() => run(() => actions.cancel(request.id))}
                  >
                    요청 취소
                  </Button>
                  <small>요청 ID: {request.id}</small>
                </div>
              </details>
              {request.execution && (
                <p className="ai-help">
                  {request.execution.model} · 입력{' '}
                  {request.execution.usage?.reduce((sum, u) => sum + u.input_tokens, 0) || 0} / 출력{' '}
                  {request.execution.usage?.reduce((sum, u) => sum + u.output_tokens, 0) || 0} 토큰
                  {request.execution.failures?.length
                    ? ` · 실패 ${request.execution.failures.length}개 (${request.execution.failures.map((f) => f.code).join(', ')}) · 키·모델·한도를 확인하고 새 요청으로 다시 시도하세요.`
                    : ''}
                </p>
              )}
              <div className="ai-request-actions">
                <Button
                  id="ai-regenerate-baseline"
                  disabled={busy}
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
                  disabled={busy || !candidate}
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
              <div className="ai-candidate-list" aria-label="시안 목록">
                {request.candidates.map((c) => (
                  <Button
                    key={c.id}
                    data-candidate-id={c.id}
                    aria-pressed={candidate?.id === c.id}
                    onClick={() => setCandidateId(c.id)}
                  >
                    <strong>{c.name}</strong>
                    <span>{c.summary}</span>
                    {request.selectedId === c.id && <small>적용한 시안</small>}
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
              ) : (
                <div className="ai-waiting">
                  {request.status === 'failed'
                    ? '시안 생성에 실패했습니다. API 키·모델·사용 한도를 확인한 뒤 다시 요청하세요.'
                    : request.status === 'canceled'
                      ? '요청을 취소했습니다. 이미 완성된 시안은 보존됩니다.'
                      : request.route === 'api'
                        ? 'API가 시안을 생성하고 있습니다. 이 창을 닫고 편집을 계속해도 됩니다.'
                        : '에이전트의 시안을 기다리고 있습니다. 이 창을 닫고 편집을 계속해도 됩니다.'}
                </div>
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
