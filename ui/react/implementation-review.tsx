import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { renderReact } from './mount';
import { Button } from './components/button';
import { NativeSelect } from './components/surfaces';
import { Textarea } from './components/textarea';
import { Input } from './components/input';
import { DocumentVisual } from './lists';
import { VersionFrame } from './versions';
type Rect = { x: number; y: number; width: number; height: number };
type Source = { url: string; title?: string; viewport: { width: number; height: number } };
interface Item {
  id: string;
  number: number;
  name: string;
  text: string;
  rect?: Rect;
  sourceId: string;
  selector: string;
  status: string;
  note: string;
}
interface Review {
  id: string;
  createdAt: string;
  target: { label: string; point: unknown };
  requests: Item[];
  result: { snapshot: { id: string; source: Source }; name: string } | null;
}
interface Preview {
  html: string;
  size: { width: number; height: number };
  targets: Record<string, { rect: Rect; sourceId: string; selector: string }>;
}
interface Actions {
  captureAvailable(): boolean;
  capture(): Promise<unknown>;
  canUndo(): boolean;
  undoVerdict(): Promise<{ number: number; status: string }>;
  close(): void;
  choose(id: string): void;
  fresh(): Promise<unknown>;
  refresh(): Promise<unknown>;
  result(id: string): Promise<unknown>;
  update(id: string, status: string, note: string): Promise<unknown>;
  preview(side: string, id: string): Promise<Preview | null>;
  export(id: string): Promise<unknown>;
}
function ImplementationReview({
  reviews,
  selectedId,
  documents,
  source,
  actions,
}: {
  reviews: Review[];
  selectedId: string | null;
  documents: {
    id: string;
    title: string;
    url: string;
    capturedAt?: string;
    updatedAt?: string;
    viewport?: { width: number };
  }[];
  source: Source;
  actions: Actions;
}) {
  const review = reviews.find((r) => r.id === selectedId),
    [focused, setFocused] = useState(''),
    [autoNext, setAutoNext] = useState(false),
    judging = useRef(false),
    context = useRef({ review: selectedId, request: '' }),
    [zoom, setZoom] = useState('fit'),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [resultQuery, setResultQuery] = useState(''),
    [picking, setPicking] = useState(false),
    [frames, setFrames] = useState<(Preview | null)[]>([null, null]);
  const resultSearch = useRef<HTMLInputElement>(null),
    resultFocusPending = useRef(false),
    comparisonScroll = useRef<[HTMLElement, number, number][]>([]),
    pickerScroll = useRef(0),
    pickerList = useRef<HTMLDivElement>(null);
  function closeResults() {
    pickerScroll.current = pickerList.current?.scrollTop || 0;
    setPicking(false);
    resultFocusPending.current = true;
  }
  function openResults() {
    comparisonScroll.current = [
      ...document.querySelectorAll<HTMLElement>('.implementation-frame, .implementation-requests'),
    ].map((e) => [e, e.scrollTop, e.scrollLeft]);
    setPicking(true);
  }
  useLayoutEffect(() => {
    if (picking) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        for (const [element, top, left] of comparisonScroll.current)
          if (element.isConnected) {
            element.scrollTop = top;
            element.scrollLeft = left;
          }
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [picking]);
  useLayoutEffect(() => {
    if (picking) {
      resultSearch.current?.focus();
      if (pickerList.current) pickerList.current.scrollTop = pickerScroll.current;
    } else if (resultFocusPending.current && !busy) {
      resultFocusPending.current = false;
      document.getElementById('implementation-visual-picker')?.focus();
    }
  }, [picking, busy]);
  useEffect(() => {
    const dialog = document.querySelector<HTMLDialogElement>('#implementation-dialog')!;
    const cancel = (event: Event) => {
      if (picking) {
        event.preventDefault();
        closeResults();
      }
    };
    dialog.addEventListener('cancel', cancel);
    return () => dialog.removeEventListener('cancel', cancel);
  }, [picking]);
  const comparison = useRef<HTMLDivElement>(null),
    [bounds, setBounds] = useState({ width: 800, height: 350 });
  useLayoutEffect(() => {
    const host = comparison.current!;
    const measure = () => {
      if (host.clientWidth) setBounds({ width: host.clientWidth, height: host.clientHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let current = true;
    setFrames([null, null]);
    if (review)
      Promise.all([actions.preview('target', review.id), actions.preview('result', review.id)])
        .then((result) => {
          if (current) setFrames(result);
        })
        .catch((error) => {
          if (current) setMessage(error.message);
        });
    return () => {
      current = false;
    };
  }, [review?.id, review?.result, actions]);
  const active = review?.requests.find((r) => r.id === focused) || review?.requests[0];
  context.current = { review: selectedId, request: active?.id || '' };
  useEffect(() => {
    setAutoNext(false);
    setFocused('');
  }, [review?.id]);
  async function judge(status: string, detail: number) {
    if (!review || !active || judging.current || busy || detail > 1 || !frames[0] || !frames[1])
      return;
    const identity = { review: review.id, request: active.id };
    judging.current = true;
    setBusy(true);
    try {
      await actions.update(active.id, status, active.note);
      if (
        context.current.review !== identity.review ||
        context.current.request !== identity.request
      )
        return;
      if (autoNext && status !== 'pending') {
        const index = review.requests.findIndex((r) => r.id === identity.request);
        if (review.requests[index + 1]) setFocused(review.requests[index + 1].id);
      }
      setMessage('요청 ' + active.number + ' 판정을 저장했습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      judging.current = false;
      setBusy(false);
    }
  }
  const scale =
    zoom === 'fit'
      ? Math.max(
          0.05,
          Math.min(
            1,
            ...frames
              .filter((p): p is Preview => !!p)
              .flatMap((p) => [
                (bounds.width / 2 - 20) / p.size.width,
                (bounds.height - 56) / p.size.height,
              ]),
          ),
        )
      : Number(zoom);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage('');
    try {
      await action();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function undoVerdict() {
    const result = await actions.undoVerdict();
    setMessage(
      '요청 ' +
        result.number +
        '을 ' +
        ({ done: '반영 확인', change: '추가 수정', pending: '미검토' }[result.status] ||
          result.status) +
        ' 상태로 되돌렸습니다. 메모는 유지됩니다.',
    );
  }
  async function update(id: string, status: string, note: string) {
    try {
      await actions.update(id, status, note);
      setMessage('검토 내용을 저장했습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }
  const remaining = review?.requests.filter((r) => r.status !== 'done').length || 0;
  const visibleDocuments = documents.filter((d) =>
    [
      d.title,
      d.url,
      d.capturedAt,
      d.capturedAt ? new Date(d.capturedAt).toLocaleString('ko-KR') : '',
    ]
      .join(' ')
      .toLocaleLowerCase()
      .includes(resultQuery.trim().toLocaleLowerCase()),
  );
  return (
    <div className="implementation-review">
      <header>
        <div>
          <h2>구현 결과 확인</h2>
          <p>목표 시안과 별도로 가져온 구현 화면을 비교하고 요청별로 확인하세요.</p>
        </div>
        <Button aria-label="구현 결과 확인 닫기" onClick={actions.close}>
          ×
        </Button>
      </header>
      <div
        id="implementation-results-visual"
        hidden={!picking}
        className="implementation-result-page"
        aria-label="구현 결과 미리보기 목록"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            e.stopPropagation();
            closeResults();
          }
        }}
      >
        <div className="result-picker-heading">
          <h3>구현 결과 선택</h3>
          <div className="result-picker-actions">
            <Button disabled={busy} onClick={() => run(actions.refresh)}>
              목록 새로고침
            </Button>
            <Button id="implementation-results-back" onClick={closeResults}>
              ← 비교로 돌아가기
            </Button>
          </div>
        </div>
        <Input
          ref={resultSearch}
          id="implementation-result-search"
          type="search"
          aria-label="구현 결과 검색"
          placeholder="화면 이름·주소·가져온 시간 검색"
          value={resultQuery}
          onChange={(e) => setResultQuery(e.target.value)}
        />
        <p role="status" className="result-picker-status">
          {visibleDocuments.length} / {documents.length}개 화면
        </p>
        {!documents.length ? (
          <p className="empty-small">
            선택할 구현 화면이 없습니다. 수정한 웹 화면을 가져온 뒤 ‘목록 새로고침’을 눌러 주세요.
          </p>
        ) : (
          !visibleDocuments.length && (
            <div className="empty-small">
              일치하는 화면이 없습니다.{' '}
              <Button
                onClick={() => {
                  setResultQuery('');
                  resultSearch.current?.focus();
                }}
              >
                검색 지우기
              </Button>
            </div>
          )
        )}
        <div className="result-picker-list" ref={pickerList}>
          {visibleDocuments.map((d) => (
            <Button
              key={d.id}
              className="result-visual-row"
              disabled={busy}
              onClick={async () => {
                if (await run(() => actions.result(d.id))) closeResults();
              }}
            >
              <DocumentVisual id={d.id} />
              <span>
                <strong>{d.title}</strong>
                <small>{d.url}</small>
                <small>
                  가져옴{' '}
                  {d.capturedAt ? new Date(d.capturedAt).toLocaleString('ko-KR') : '기록 없음'} ·{' '}
                  {d.viewport?.width || '—'}px
                </small>
              </span>
            </Button>
          ))}
        </div>
      </div>
      <div className="implementation-workspace" hidden={picking}>
        <div className="implementation-controls">
          <label>
            검토 기록
            <NativeSelect
              id="implementation-review-list"
              value={review?.id || ''}
              onChange={(e) => {
                setFocused('');
                actions.choose(e.target.value);
              }}
            >
              {reviews.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.target.label} · {new Date(r.createdAt).toLocaleString('ko-KR')} ·{' '}
                  {r.result?.name || '구현 화면 미선택'}
                </option>
              ))}
            </NativeSelect>
          </label>
          <div className="implementation-result-control">
            <span className="implementation-result-label">
              <label htmlFor="implementation-result">수정 후 가져온 화면</label>
              <Button
                id="implementation-refresh"
                size="content"
                variant="ghost"
                disabled={busy}
                onClick={() => run(actions.refresh)}
              >
                목록 새로고침
              </Button>
            </span>
            <NativeSelect
              id="implementation-result"
              value=""
              disabled={busy}
              onChange={(e) => run(() => actions.result(e.target.value))}
            >
              <option value="">{review?.result ? '다른 결과로 새 검토' : '구현 화면 선택'}</option>
              {documents.map((d) => (
                <option value={d.id} key={d.id}>
                  {d.title} · {d.url} · 가져옴{' '}
                  {d.capturedAt ? new Date(d.capturedAt).toLocaleString('ko-KR') : '기록 없음'} ·{' '}
                  {d.viewport?.width || '—'}px
                </option>
              ))}
            </NativeSelect>
            <Button
              id="implementation-visual-picker"
              aria-expanded={picking}
              onClick={openResults}
              disabled={busy}
            >
              미리보기로 선택
            </Button>
          </div>
          {actions.captureAvailable() && (
            <Button
              id="implementation-capture"
              disabled={busy}
              onClick={() => run(actions.capture)}
            >
              이 목표의 구현 화면 가져오기
            </Button>
          )}
          <Button id="implementation-new" disabled={busy} onClick={() => run(actions.fresh)}>
            현재 작업으로 새 검토
          </Button>
        </div>
        <div className="implementation-context">
          <span>
            목표: {source.title || '문서'} · {review?.target.label} · {source.viewport.width}px
            {review?.result
              ? ` / 구현: ${review.result.name} · ${review.result.snapshot.source.viewport.width}px`
              : ''}
          </span>
          <label>
            공통 확대{' '}
            <NativeSelect
              aria-label="구현 비교 확대"
              value={zoom}
              onChange={(e) => setZoom(e.target.value)}
            >
              <option value="fit">맞춤</option>
              <option value="0.5">50%</option>
              <option value="1">100%</option>
            </NativeSelect>
          </label>
        </div>
        {review?.result &&
          source.viewport.width !== review.result.snapshot.source.viewport.width && (
            <p className="implementation-warning">
              서로 다른 기준 너비입니다. 반응형 차이와 미반영 변경을 구분해 확인하세요.
            </p>
          )}
        <div className="implementation-judgement-options">
          <label>
            <input
              type="checkbox"
              checked={autoNext}
              disabled={busy}
              onChange={(e) => setAutoNext(e.target.checked)}
            />{' '}
            판정 후 다음 요청으로 이동
          </label>
          <Button disabled={busy || !actions.canUndo()} onClick={() => run(undoVerdict)}>
            직전 판정 취소
          </Button>
        </div>
        <main className="implementation-body">
          <div className="implementation-comparison" ref={comparison}>
            {['목표 시안', '구현 화면'].map((title, i) => {
              const frame = frames[i];
              const matches =
                i === 1 && active && frame
                  ? Object.values(frame.targets).filter((t) =>
                      active.sourceId
                        ? t.sourceId === active.sourceId
                        : active.selector && t.selector === active.selector,
                    )
                  : [];
              const rect =
                i === 0 ? active?.rect : matches.length === 1 ? matches[0].rect : undefined;
              return (
                <section key={title}>
                  <strong>{title}</strong>
                  <div className="implementation-frame">
                    {frame ? (
                      <VersionFrame
                        html={frame.html}
                        size={frame.size}
                        title={title}
                        zoom={scale}
                        highlight={
                          rect && active
                            ? {
                                rect,
                                label: `${i === 1 ? '추정 대응 · ' : ''}${active.number} · ${active.name}`,
                              }
                            : undefined
                        }
                      />
                    ) : (
                      <p>
                        {i === 1 && !review?.result
                          ? '수정된 웹 화면을 기존 가져오기 기능으로 가져온 뒤 위에서 선택하세요. 별도 파일을 에이전트에게 전달할 필요는 없습니다.'
                          : '미리보기 준비 중…'}
                      </p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
          <aside className="implementation-requests">
            <strong>
              요청별 확인 · {review?.requests.filter((r) => r.status === 'done').length || 0}/
              {review?.requests.length || 0} 반영
            </strong>
            {review?.requests.map((r) => (
              <section key={r.id} className={r.id === active?.id ? 'is-current' : ''}>
                <Button
                  variant="ghost"
                  size="content"
                  className="implementation-request-pick"
                  onClick={() => setFocused(r.id)}
                >
                  {r.number}. {r.name}
                </Button>
                <p>{r.text}</p>
                {r.id !== active?.id && (
                  <NativeSelect
                    aria-label={`요청 ${r.number} 검토 상태`}
                    disabled={!review.result || busy}
                    value={r.status}
                    onChange={(e) => update(r.id, e.target.value, r.note)}
                  >
                    <option value="pending">미검토</option>
                    <option value="done">반영 확인</option>
                    <option value="change">추가 수정 필요</option>
                  </NativeSelect>
                )}
                {r.id === active?.id && (
                  <div
                    className="implementation-verdict-buttons"
                    aria-label={'요청 ' + r.number + ' 직접 판정'}
                  >
                    <Button
                      disabled={!review.result || busy || !frames[0] || !frames[1]}
                      data-verdict="done"
                      aria-pressed={r.status === 'done'}
                      onClick={(e) => judge('done', e.detail)}
                      onKeyDown={(e) => {
                        if (e.repeat) e.preventDefault();
                      }}
                    >
                      반영 확인
                    </Button>
                    <Button
                      disabled={!review.result || busy || !frames[0] || !frames[1]}
                      data-verdict="change"
                      aria-pressed={r.status === 'change'}
                      onClick={(e) => judge('change', e.detail)}
                      onKeyDown={(e) => {
                        if (e.repeat) e.preventDefault();
                      }}
                    >
                      추가 수정
                    </Button>
                    <Button
                      data-verdict="pending"
                      disabled={!review.result || busy || !frames[0] || !frames[1]}
                      aria-pressed={r.status === 'pending'}
                      onClick={(e) => judge('pending', e.detail)}
                      onKeyDown={(e) => {
                        if (e.repeat) e.preventDefault();
                      }}
                    >
                      미검토
                    </Button>
                  </div>
                )}
                {r.id === active?.id && (
                  <Textarea
                    aria-label={`요청 ${r.number} 검토 메모`}
                    placeholder="남은 차이 또는 확인한 내용을 기록하세요."
                    maxLength={4000}
                    disabled={!review.result}
                    value={r.note}
                    onChange={(e) => update(r.id, r.status, e.target.value)}
                  />
                )}
              </section>
            ))}
            {!review?.requests.length && (
              <p>이 목표에는 개별 요청이 없습니다. 화면 전체를 비교할 수 있습니다.</p>
            )}
          </aside>
        </main>
        <footer>
          <span>
            사용자가 확인한 상태입니다. 버튼·검색 등 실제 동작은 원본 프로젝트에서 확인하세요.
          </span>
          <Button
            id="implementation-export"
            disabled={busy || !review?.result || !remaining}
            onClick={() =>
              review &&
              run(async () => {
                await actions.export(review.id);
                setMessage('남은 요청을 이미지 한 장으로 저장했습니다.');
              })
            }
          >
            남은 {remaining}개 요청 이미지 저장
          </Button>
        </footer>
      </div>
      <p role="status" id="implementation-status">
        {busy ? '처리 중…' : message}
      </p>
    </div>
  );
}
export function renderImplementationReview(
  host: HTMLElement,
  reviews: Review[],
  selectedId: string | null,
  documents: { id: string; title: string; url: string }[],
  source: Source,
  actions: Actions,
) {
  renderReact(
    host,
    <ImplementationReview
      reviews={reviews}
      selectedId={selectedId}
      documents={documents}
      source={source}
      actions={actions}
    />,
  );
}
