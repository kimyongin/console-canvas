import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from './components/button';
import { Input } from './components/input';
export interface ReviewRecord {
  id: string;
  createdAt: string;
  name?: string;
  deletedAt?: string;
  target: { label: string };
  result: { name: string } | null;
  requests: { status: string }[];
}
export interface ReviewRecordActions {
  usage(): { live: number; trash: number; total: number; characters: number; canCreate: boolean };
  manage(id: string, action: string, value?: string): Promise<unknown>;
  backup(): Promise<string>;
}
export function reviewRecordName(record: ReviewRecord, records: ReviewRecord[]) {
  return record.name || '검토 ' + (records.findIndex((r) => r.id === record.id) + 1);
}
export function ReviewRecords({
  records,
  selectedId,
  active,
  actions,
  choose,
}: {
  records: ReviewRecord[];
  selectedId: string | null;
  active: boolean;
  actions: ReviewRecordActions;
  choose: (id: string) => void;
}) {
  const [trash, setTrash] = useState(false),
    [query, setQuery] = useState(''),
    [draft, setDraft] = useState<{ id: string; name: string } | null>(null),
    [confirm, setConfirm] = useState<{ id: string; expected: string } | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const search = useRef<HTMLInputElement>(null),
    working = useRef(false);
  useLayoutEffect(() => {
    if (active) search.current?.focus();
  }, [active]);
  async function run(action: () => Promise<unknown>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setMessage('');
    try {
      await action();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  const usage = actions.usage();
  const matches = records.filter(
    (r) =>
      !!r.deletedAt === trash &&
      [reviewRecordName(r, records), r.target.label, r.result?.name]
        .join(' ')
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <div
      className="review-records-page"
      hidden={!active}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.nativeEvent.isComposing && (draft || confirm)) {
          e.preventDefault();
          e.stopPropagation();
          if (!busy) {
            setDraft(null);
            setConfirm(null);
          }
        }
      }}
    >
      <div className="review-record-tools">
        <Button
          id="review-records-live"
          aria-pressed={!trash}
          disabled={busy}
          onClick={() => setTrash(false)}
        >
          사용 중 {usage.live}
        </Button>
        <Button
          id="review-records-trash"
          aria-pressed={trash}
          disabled={busy}
          onClick={() => setTrash(true)}
        >
          휴지통 {usage.trash}
        </Button>
        <Button
          id="review-records-backup"
          disabled={busy}
          onClick={() =>
            run(async () => {
              setMessage(await actions.backup());
            })
          }
        >
          전체 편집 파일 백업
        </Button>
      </div>
      <p className="review-record-usage">
        사용 중 {usage.live}/20개 · 휴지통 포함 {usage.total}/40개 · 보관 용량{' '}
        {Math.ceil((usage.characters / 20_000_000) * 100)}%
      </p>
      {!usage.canCreate && (
        <p className="implementation-warning">
          보관 한도에 도달했습니다. 사용 중인 기록을 휴지통으로 옮기거나, 백업 파일을 확인한 뒤
          불필요한 기록을 영구 삭제하세요. 휴지통도 보관 용량에 포함됩니다.
        </p>
      )}
      <Input
        id="review-record-search"
        ref={search}
        type="search"
        aria-label="검토 기록 검색"
        placeholder="검토 이름·목표·구현 화면 검색"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p id="review-record-status" role="status">
        {busy ? '저장 중…' : message || matches.length + '개 기록'}
      </p>
      <div className="review-record-list">
        {!matches.length && (
          <p>
            표시할 기록이 없습니다.{' '}
            {query
              ? '검색어를 지우거나 다른 범위를 선택하세요.'
              : trash
                ? '휴지통으로 옮긴 기록은 여기에서 복구할 수 있습니다.'
                : '새 검토를 만들거나 휴지통의 기록을 복구하세요.'}
          </p>
        )}
        {matches.map((record) => (
          <article key={record.id} data-review-record={record.id}>
            <strong>
              {reviewRecordName(record, records)}
              {record.id === selectedId && !record.deletedAt ? ' · 현재 검토' : ''}
            </strong>
            <small>{new Date(record.createdAt).toLocaleString('ko-KR')}</small>
            <p>
              목표 · {record.target.label}
              <br />
              구현 · {record.result?.name || '구현 화면 미선택'}
              <br />
              반영 {record.requests.filter((r) => r.status === 'done').length} /{' '}
              {record.requests.length} · 추가 수정{' '}
              {record.requests.filter((r) => r.status === 'change').length} · 미검토{' '}
              {record.requests.filter((r) => r.status === 'pending').length}
            </p>
            {draft?.id === record.id ? (
              <form
                className="review-record-rename"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (draft)
                    run(async () => {
                      await actions.manage(record.id, 'rename', draft.name);
                      setDraft(null);
                      setMessage('검토 이름을 저장했습니다.');
                    });
                }}
              >
                <label>
                  검토 이름
                  <Input
                    autoFocus
                    aria-label="검토 이름"
                    maxLength={120}
                    value={draft.name}
                    disabled={busy}
                    onChange={(e) => setDraft({ id: record.id, name: e.target.value })}
                  />
                </label>
                <Button type="button" disabled={busy} onClick={() => setDraft(null)}>
                  취소
                </Button>
                <Button type="submit" disabled={busy}>
                  이름 저장
                </Button>
              </form>
            ) : (
              <div className="review-record-actions">
                {!record.deletedAt && (
                  <Button disabled={busy} onClick={() => choose(record.id)}>
                    검토 열기
                  </Button>
                )}
                <Button
                  disabled={busy}
                  onClick={() => {
                    setDraft({ id: record.id, name: reviewRecordName(record, records) });
                    setConfirm(null);
                  }}
                >
                  이름 변경
                </Button>
                <Button
                  disabled={busy || (!!record.deletedAt && usage.live >= 20)}
                  title={
                    record.deletedAt && usage.live >= 20
                      ? '사용 중인 기록을 먼저 정리해 주세요.'
                      : undefined
                  }
                  onClick={() =>
                    run(async () => {
                      await actions.manage(record.id, record.deletedAt ? 'recover' : 'trash');
                      setMessage(
                        record.deletedAt
                          ? '검토를 복구했습니다. 캔버스는 바뀌지 않았습니다.'
                          : '휴지통으로 옮겼습니다. 기록은 복구할 수 있습니다.',
                      );
                    })
                  }
                >
                  {record.deletedAt ? '복구' : '휴지통으로 이동'}
                </Button>
              </div>
            )}
            <details className="review-record-danger">
              <summary>백업·영구 삭제</summary>
              <p>
                기록의 판정·메모·고정 목표와 구현 화면을 삭제합니다. 현재 캔버스·스냅샷과 다른
                기록은 유지됩니다. 파일 백업 후 정리할 수 있습니다.
              </p>
              {confirm?.id === record.id ? (
                <div
                  className="review-record-confirm"
                  role="group"
                  aria-label="검토 영구 삭제 확인"
                >
                  <p>
                    ‘{reviewRecordName(record, records)}’을 영구 삭제할까요? 휴지통으로 복구할 수
                    없습니다.
                  </p>
                  <Button disabled={busy} onClick={() => setConfirm(null)}>
                    취소
                  </Button>
                  <Button
                    className="danger-outline"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await actions.manage(record.id, 'purge', confirm.expected);
                        setConfirm(null);
                        if (draft?.id === record.id) setDraft(null);
                        setMessage('검토 기록을 영구 삭제했습니다.');
                      })
                    }
                  >
                    영구 삭제 확정
                  </Button>
                </div>
              ) : (
                <Button
                  className="danger-outline"
                  disabled={busy}
                  onClick={() => {
                    setConfirm({ id: record.id, expected: JSON.stringify(record) });
                    setDraft(null);
                  }}
                >
                  영구 삭제
                </Button>
              )}
            </details>
          </article>
        ))}
      </div>
    </div>
  );
}
