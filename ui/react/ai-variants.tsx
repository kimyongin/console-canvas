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
interface ChatgptStatus {
  available: boolean;
  activeId: string;
  pending: boolean;
  message: string;
  accounts: { id: string; label: string; loggedIn: boolean; planEnabled: boolean }[];
}
interface Actions {
  authentication(): string;
  setAuthentication(value: string): void;
  chatgptAvailable(): boolean;
  chatgpt(name: string, ...args: unknown[]): Promise<any>;
  chatgptModel(model: string, accountId?: string): void;
  draft(): Draft;
  saveDraft(value: Draft): void;
  initialNew(): boolean;
  context(): { target: string; comments: number; version: string };
  currentCandidate(request: string): string;
  remembered(): { requestId?: string; candidateId?: string };
  remember(value: { requestId: string; candidateId: string }): void;
  followup(id: string): Draft | null;
  rememberFollowup(id: string, value: Draft): void;
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
  const [authentication, setAuthentication] = useState(actions.authentication()),
    [chatgptStatus, setChatgptStatus] = useState<ChatgptStatus>({
      available: actions.chatgptAvailable(),
      activeId: '',
      pending: false,
      message: '',
      accounts: [],
    }),
    [chatgptModels, setChatgptModels] = useState<{ id: string; name: string }[]>([]),
    [chatgptModel, setChatgptModel] = useState(''),
    chatgptSequence = useRef(0);
  const chatgptAccount = chatgptStatus.accounts.find((a) => a.id === chatgptStatus.activeId);
  const generating = requests.some(
    (r) =>
      r.route === 'api' && ['pending', 'running', 'partial'].includes(r.status) && !r.execution,
  );
  const directReady =
    authentication === 'chatgpt'
      ? !!(
          !chatgptStatus.pending &&
          chatgptAccount?.loggedIn &&
          chatgptAccount.planEnabled &&
          chatgptModel &&
          chatgptModels.some((m) => m.id === chatgptModel)
        )
      : actions.apiStatus().configured;
  async function refreshChatgpt() {
    const sequence = ++chatgptSequence.current;
    try {
      const status: ChatgptStatus = await actions.chatgpt('status');
      if (sequence !== chatgptSequence.current) return;
      setChatgptStatus(status);
      const account = status.accounts.find((a) => a.id === status.activeId);
      if (!account?.loggedIn || !account.planEnabled || status.pending) {
        setChatgptModels([]);
        setChatgptModel('');
        actions.chatgptModel('');
        return;
      }
      const models = await actions.chatgpt('models');
      if (sequence !== chatgptSequence.current) return;
      setChatgptModels(models);
      setChatgptModel((previous) => {
        const model = models.some((m: { id: string }) => m.id === previous)
          ? previous
          : models[0]?.id || '';
        actions.chatgptModel(model, status.activeId);
        return model;
      });
    } catch (e) {
      if (sequence === chatgptSequence.current) {
        setChatgptModels([]);
        setChatgptModel('');
        actions.chatgptModel('');
        setMessage(e instanceof Error ? e.message : String(e));
      }
    }
  }
  useEffect(() => {
    if (actions.chatgptAvailable() && authentication === 'chatgpt') refreshChatgpt();
    return () => {
      chatgptSequence.current++;
    };
  }, [authentication]);
  useEffect(() => {
    if (!chatgptStatus.pending) return;
    const timer = setInterval(() => refreshChatgpt(), 2000);
    return () => clearInterval(timer);
  }, [chatgptStatus.pending]);
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
    [expandedFollowups, setExpandedFollowups] = useState<Record<string, boolean>>({}),
    promptField = useRef<HTMLTextAreaElement>(null),
    creating = useRef(false),
    regenerating = useRef(false),
    previousDraft = useRef<Draft | null>(null),
    [, setFollowupRevision] = useState(0);
  const request = requests.find((r) => r.id === requestId),
    candidate = request?.candidates.find((c) => c.id === candidateId) || request?.candidates[0];
  const currentCandidateId = request ? actions.currentCandidate(request.id) : '';
  const context = actions.context();
  const followup = request
    ? actions.followup(request.id) || {
        prompt: request.prompt,
        count: request.count,
        route: request.route || 'mcp',
      }
    : null;
  const followupBlocked = followup?.route === 'api' && !directReady;
  const followupInvalid =
    !!followup && (!Number.isInteger(followup.count) || followup.count < 1 || followup.count > 12);
  function updateFollowup(value: Partial<Draft>) {
    if (!request || !followup) return;
    actions.rememberFollowup(request.id, { ...followup, ...value });
    setFollowupRevision((n) => n + 1);
  }
  function openApiSettings() {
    setFormOpen(true);
    setAuthOpen(true);
    requestAnimationFrame(() =>
      document
        .getElementById(authentication === 'chatgpt' ? 'chatgpt-login' : 'ai-api-key')
        ?.focus(),
    );
  }
  async function regenerate(fromCandidate: boolean) {
    if (
      regenerating.current ||
      !request ||
      !followup ||
      followupBlocked ||
      followupInvalid ||
      (fromCandidate && !candidate)
    )
      return;
    regenerating.current = true;
    try {
      await run(async () => {
        const next = await actions.create({
          ...followup,
          basis_request_id: request.id,
          ...(fromCandidate ? { basis_candidate_id: candidate?.id } : {}),
        });
        setRequestId(next.id);
        setCandidateId('');
        actions.remember({ requestId: next.id, candidateId: '' });
      });
    } finally {
      regenerating.current = false;
    }
  }
  useEffect(() => {
    if (formOpen && !authOpen) promptField.current?.focus();
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
  const apiBlocked = route === 'api' && !directReady;
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
              <option value="api">AI 직접 호출 · ChatGPT 또는 API 키</option>
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
              {route === 'api'
                ? authentication === 'chatgpt'
                  ? 'ChatGPT로 시안 생성'
                  : 'API로 시안 생성'
                : '요청 보관하고 복사'}
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
              ? authentication === 'chatgpt'
                ? directReady
                  ? 'ChatGPT 계정·모델 준비됨 · 생성 시 요금제 사용 권한과 한도를 확인합니다.'
                  : 'ChatGPT 로그인·요금제 사용 동의 후 모델을 선택하세요.'
                : configured
                  ? 'API 키·모델 등록됨 · 실제 연결은 생성 시 확인합니다.'
                  : '생성하려면 AI API 연결에서 키와 모델을 등록하세요.'
              : actions.connection()
                ? 'MCP 연결됨 · 요청 문장을 에이전트 대화에 전달해야 실행됩니다.'
                : 'MCP 연결 안 됨 · 요청은 보관할 수 있으며 연결 후 에이전트 대화에 전달하세요.'}
          </p>
          {route === 'api' && !directReady && (
            <Button id="ai-open-auth" onClick={openApiSettings}>
              {authentication === 'chatgpt' ? 'ChatGPT 연결 설정' : 'API 키·모델 설정'}
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
          <summary>
            AI API 연결{' '}
            {authentication === 'chatgpt' ? '· ChatGPT 요금제' : configured ? '· 키 등록됨' : ''}
          </summary>
          <label htmlFor="ai-authentication">직접 호출 인증</label>
          <NativeSelect
            id="ai-authentication"
            value={authentication}
            disabled={busy || generating}
            onChange={(e) => {
              chatgptSequence.current++;
              actions.setAuthentication(e.target.value);
              setAuthentication(e.target.value);
            }}
          >
            <option value="api_key">API 키 · 별도 API 과금</option>
            <option value="chatgpt">ChatGPT 로그인 · 요금제 사용</option>
          </NativeSelect>
          {authentication === 'chatgpt' ? (
            <section className="ai-chatgpt" aria-label="ChatGPT 연결">
              {actions.chatgptAvailable() && !chatgptStatus.available && (
                <p role="status">
                  기기의 안전한 계정 저장소를 사용할 수 없어 로그인이 차단되었습니다. 기기
                  잠금·키체인을 확인한 뒤 앱을 다시 실행하세요.
                </p>
              )}
              <p className="ai-help">
                시스템 브라우저에서 로그인하고 Console Canvas의 요금제 사용에 동의합니다.
                코드·주석·화면 이미지를 OpenAI에 전송합니다. 한도와 사용 가능한 크레딧은 ChatGPT
                설정을 따르며 API 키로 자동 전환하지 않습니다.
              </p>
              {!actions.chatgptAvailable() && (
                <p role="status">
                  ChatGPT 로그인은 Chromium 내장 앱에서 사용할 수 있습니다. 웹 미리보기에서는 API 키
                  또는 외부 에이전트를 선택하세요.
                </p>
              )}
              {!!chatgptStatus.accounts.length && (
                <label>
                  ChatGPT 계정
                  <NativeSelect
                    id="chatgpt-account"
                    value={chatgptStatus.activeId}
                    disabled={busy || chatgptStatus.pending || generating}
                    onChange={(e) =>
                      run(async () => {
                        chatgptSequence.current++;
                        setChatgptModels([]);
                        setChatgptModel('');
                        await actions.chatgpt('select', e.target.value);
                        await refreshChatgpt();
                      })
                    }
                  >
                    {chatgptStatus.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                        {a.loggedIn ? '' : ' · 로그아웃'}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              )}
              <div className="ai-request-actions">
                <Button
                  id="chatgpt-login"
                  disabled={
                    busy ||
                    generating ||
                    chatgptStatus.pending ||
                    !chatgptStatus.available ||
                    !actions.chatgptAvailable()
                  }
                  onClick={() =>
                    run(async () => {
                      await actions.chatgpt('login', chatgptStatus.activeId);
                      await refreshChatgpt();
                    })
                  }
                >
                  Continue with ChatGPT
                </Button>
                {chatgptStatus.accounts.length > 0 && (
                  <Button
                    id="chatgpt-add-account"
                    disabled={busy || generating || chatgptStatus.pending}
                    onClick={() =>
                      run(async () => {
                        await actions.chatgpt('login', '');
                        await refreshChatgpt();
                      })
                    }
                  >
                    다른 계정·워크스페이스 추가
                  </Button>
                )}
                {chatgptStatus.pending && (
                  <Button
                    id="chatgpt-cancel-login"
                    onClick={() =>
                      run(async () => {
                        await actions.chatgpt('cancel-login');
                        await refreshChatgpt();
                      })
                    }
                  >
                    로그인 취소
                  </Button>
                )}
                {!chatgptStatus.pending && chatgptAccount?.loggedIn && (
                  <Button
                    id="chatgpt-logout"
                    disabled={busy || generating}
                    onClick={() =>
                      run(async () => {
                        chatgptSequence.current++;
                        await actions.chatgpt('logout', chatgptStatus.activeId);
                        await refreshChatgpt();
                      })
                    }
                  >
                    로그아웃
                  </Button>
                )}
                <Button
                  id="chatgpt-refresh"
                  disabled={
                    busy ||
                    generating ||
                    chatgptStatus.pending ||
                    !chatgptStatus.available ||
                    !actions.chatgptAvailable()
                  }
                  onClick={() => run(refreshChatgpt)}
                >
                  계정·모델 새로고침
                </Button>
                <Button
                  id="chatgpt-usage"
                  disabled={!actions.chatgptAvailable()}
                  onClick={() => run(() => actions.chatgpt('usage'))}
                >
                  ChatGPT 사용량·연결 관리
                </Button>
              </div>
              <p role="status" className="ai-help" id="chatgpt-status">
                {chatgptStatus.message || '로그인 후 계정의 사용 가능한 모델을 불러옵니다.'}
                {!chatgptStatus.pending && chatgptAccount?.loggedIn && !chatgptAccount.planEnabled
                  ? ' 요금제 사용 권한이 없습니다. Continue with ChatGPT에서 동의하세요.'
                  : ''}
              </p>
              <label>
                ChatGPT 모델
                <NativeSelect
                  id="chatgpt-model"
                  value={chatgptModel}
                  disabled={busy || generating || !chatgptModels.length}
                  onChange={(e) => {
                    setChatgptModel(e.target.value);
                    actions.chatgptModel(e.target.value, chatgptStatus.activeId);
                  }}
                >
                  <option value="">사용 가능한 모델 선택</option>
                  {chatgptModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <p className="ai-help">
                로그인·모델 목록과 실제 시안 생성 성공은 별개입니다. 로컬 도구용 공식 미리보기
                경로이며 계정·워크스페이스·배포 자격에 따라 제한될 수 있습니다.
              </p>
            </section>
          ) : (
            <>
              <p className="ai-help">
                일반 OpenAI API 사용량으로 별도 과금됩니다. 키는 이 창의 메모리에만 보관하며 재실행
                시 삭제됩니다. ChatGPT 구독 로그인은 위에서 별도로 선택하며 인증·제품 자격 검증이
                필요합니다.
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
                      setMessage(
                        'API 키를 등록했습니다. 실제 추론 연결은 시안 생성 시 확인합니다.',
                      );
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
            </>
          )}
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
                      ? ` · 실패 ${request.execution.failures.length}개 (${request.execution.failures.map((f) => f.code).join(', ')}) · 계정·인증·모델·한도를 확인하고 새 요청으로 다시 시도하세요.`
                      : ''}
                  </p>
                )}
                {followup && (
                  <details
                    className="ai-followup-details"
                    key={request.id}
                    open={!!expandedFollowups[request.id]}
                    onToggle={(e) => {
                      const element = e.currentTarget;
                      setExpandedFollowups((previous) => ({
                        ...previous,
                        [request.id]: element.open,
                      }));
                      if (element.open)
                        requestAnimationFrame(() => {
                          if (element.isConnected && element.open)
                            element.querySelector('textarea')?.focus();
                        });
                    }}
                  >
                    <summary>
                      <strong>추가 생성 설정</strong>
                      <span className="ai-followup-summary" title={followup.prompt}>
                        {followup.route === 'api'
                          ? authentication === 'chatgpt'
                            ? 'ChatGPT 요금제'
                            : 'AI API · 별도 과금'
                          : '외부 에이전트 · MCP'}{' '}
                        · {followup.count || '개수 확인'}개 ·{' '}
                        {followup.prompt || '현재 기준의 주석 사용'}
                      </span>
                    </summary>
                    <fieldset className="ai-followup-settings" disabled={busy}>
                      <legend>이 요청에서 추가 생성</legend>
                      <p className="ai-help">
                        새 시안 요청의 초안과 별개입니다. 아래 문장·개수·실행 방식으로 생성합니다.
                      </p>
                      <label htmlFor="ai-followup-prompt">추가 생성 요청</label>
                      <Textarea
                        id="ai-followup-prompt"
                        value={followup.prompt}
                        maxLength={8000}
                        onChange={(e) => updateFollowup({ prompt: e.target.value })}
                      />
                      <div className="ai-request-actions">
                        <label>
                          실행 방식
                          <NativeSelect
                            id="ai-followup-route"
                            value={followup.route}
                            onChange={(e) => updateFollowup({ route: e.target.value })}
                          >
                            <option value="mcp">외부 에이전트 · MCP</option>
                            <option value="api">AI 직접 호출 · ChatGPT 또는 API 키</option>
                          </NativeSelect>
                        </label>
                        <label>
                          시안 수
                          <Input
                            id="ai-followup-count"
                            type="number"
                            min={1}
                            max={12}
                            value={followup.count || ''}
                            onChange={(e) => updateFollowup({ count: Number(e.target.value) })}
                          />
                        </label>
                      </div>
                      {followupInvalid && (
                        <p role="status" className="ai-help">
                          시안 수는 1~12개로 입력해 주세요.
                        </p>
                      )}
                    </fieldset>
                  </details>
                )}
                <div className="ai-request-actions ai-followup-actions">
                  <Button
                    id="ai-regenerate-baseline"
                    disabled={busy || followupBlocked || followupInvalid}
                    onClick={() => regenerate(false)}
                  >
                    같은 기준으로 추가 생성
                  </Button>
                  <Button
                    id="ai-regenerate-candidate"
                    disabled={busy || !candidate || followupBlocked || followupInvalid}
                    onClick={() => regenerate(true)}
                  >
                    선택 시안에서 추가 생성
                  </Button>
                </div>
                {followupBlocked && (
                  <p className="ai-help">
                    {authentication === 'chatgpt'
                      ? 'ChatGPT 로그인·사용 동의 후 모델을 선택하세요.'
                      : 'API로 추가 생성하려면 키와 모델을 먼저 등록하세요. 별도 API 사용량이 청구됩니다.'}
                    <Button id="ai-followup-open-auth" disabled={busy} onClick={openApiSettings}>
                      {authentication === 'chatgpt' ? 'ChatGPT 연결 설정' : 'API 키·모델 설정'}
                    </Button>
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
