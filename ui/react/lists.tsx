import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getDocument, documentSummary } from '../../db.js';
import { withVersionScene } from '../version-preview.js';
import { renderReact } from './mount';
import { Button } from './components/button';
import { Input } from './components/input';
import { ActionMenu, type MenuAction } from './components/action-menu';
export interface LayerRow {
  id: string;
  depth: number;
  selected: boolean;
  deleted: boolean;
  expanded: boolean;
  hasChildren: boolean;
  name: string;
  title: string;
  icon: string;
  label: string;
  searchMatch?: boolean;
  comment?: string;
  commentNumber?: number;
  mark?: string;
}
export function renderLayerRows(
  host: Element,
  rows: LayerRow[],
  toggle: (id: string) => void,
  pick: (id: string, additive: boolean) => void,
  rename?: (id: string) => void,
  emptyMessage = '표시할 요소가 없습니다.',
) {
  renderReact(
    host,
    <>
      {!rows.length && <p className="empty-small">{emptyMessage}</p>}
      {rows.map((row) => (
        <div
          key={row.id}
          className={
            'layer-row' + (row.selected ? ' selected' : '') + (row.deleted ? ' deleted' : '')
          }
          style={{ paddingLeft: Math.min(row.depth * 12, 96) }}
          data-layer-id={row.id}
          data-search-match={row.searchMatch || undefined}
        >
          <Button
            variant="ghost"
            className="tree-toggle"
            disabled={!row.hasChildren}
            aria-label={(row.expanded ? '접기' : '펼치기') + ' ' + row.name}
            aria-expanded={row.expanded}
            onClick={() => toggle(row.id)}
          >
            {row.hasChildren ? (row.expanded ? '⌄' : '›') : ''}
          </Button>
          <Button
            variant="ghost"
            className="layer-pick"
            aria-pressed={row.selected}
            title={row.title}
            onClick={(e) => pick(row.id, e.metaKey || e.ctrlKey)}
          >
            <span className="layer-icon">{row.icon}</span>
            <span className="layer-label">{row.label}</span>
          </Button>
          {row.searchMatch && <small className="search-match-badge">일치</small>}
          {row.comment && (
            <span className="layer-comment" title={row.comment}>
              주석 {row.commentNumber}
            </span>
          )}
          {row.mark && <span className="layer-mark">{row.mark}</span>}
          {row.selected && rename && (
            <Button
              className="layer-rename"
              variant="ghost"
              aria-label={row.label + ' 별칭 변경'}
              onClick={() => rename(row.id)}
            >
              ⋯
            </Button>
          )}
        </div>
      ))}
    </>,
  );
}
export interface ActivityRow {
  id: string;
  time: string;
  heading: string;
  context?: string;
  children?: ActivityRow[];
  changes: {
    id: string;
    name: string;
    type: string;
    description: string;
    disabled: boolean;
    run: () => void;
  }[];
}
function ActivityContents({ row }: { row: ActivityRow }) {
  return (
    <>
      <small>{row.time}</small>
      <strong>{row.heading}</strong>
      {row.context && <small className="activity-context">{row.context}</small>}
      {row.changes.map((change, index) => (
        <Button
          variant="ghost"
          key={change.id + '/' + index}
          className="activity-change"
          size="content"
          data-target-id={change.id}
          data-change-type={change.type}
          disabled={change.disabled}
          onClick={change.run}
        >
          <strong>{change.name}</strong>
          <span>{change.description}</span>
        </Button>
      ))}
      {row.children && (
        <details className="activity-details">
          <summary>{'개별 기록 ' + row.children.length + '개 보기'}</summary>
          {row.children.map((child) => (
            <div className="activity-detail" key={child.id} data-detail-event-id={child.id}>
              <ActivityContents row={child} />
            </div>
          ))}
        </details>
      )}
    </>
  );
}
export function renderActivityRows(host: Element, rows: ActivityRow[], empty: string) {
  renderReact(
    host,
    rows.length ? (
      <>
        {rows.map((row) => (
          <article key={row.id} className="activity-event" data-event-id={row.id}>
            <ActivityContents row={row} />
          </article>
        ))}
      </>
    ) : (
      empty
    ),
  );
}
export interface DocumentRow {
  id: string;
  title: string;
  url: string;
  date: string;
  captured: string;
  summary?: { snapshotName?: string; activeSnapshotName?: string; commentCount?: number };
  current: boolean;
  disabled: boolean;
  open: () => void;
  actions: MenuAction[];
  rename?: (name: string) => Promise<void>;
  recovery?: { label: string; kind: string; run: () => unknown }[];
}
export function renderDocumentRows(host: Element, rows: DocumentRow[], loading: boolean) {
  renderReact(host, <DocumentList rows={rows} loading={loading} />);
}
type NameDraft = { name: string; busy: boolean; error: string };
function DocumentList({ rows, loading }: { rows: DocumentRow[]; loading: boolean }) {
  // Owned by the list, so filtering/unmounting a card never discards its draft.
  // Closing the list also retains drafts for this editor session; only Save/Cancel clears them.
  const [drafts, setDrafts] = useState<Record<string, NameDraft>>({});
  function change(id: string, value: NameDraft | null) {
    setDrafts((previous) => {
      const next = { ...previous };
      if (value) next[id] = value;
      else delete next[id];
      return next;
    });
  }
  return (
    <>
      {!!Object.keys(drafts).length && (
        <p className="name-draft-status" role="status">
          이름 편집 {Object.keys(drafts).length}개 · 저장 버튼으로 확정하세요. 검색·휴지통 전환과 창
          닫기 후에도 이 실행 중 초안은 유지됩니다.
        </p>
      )}
      {rows.map((row) => (
        <DocumentCard
          key={row.id}
          row={row}
          loading={loading}
          draft={drafts[row.id]}
          changeDraft={(value) => change(row.id, value)}
        />
      ))}
    </>
  );
}
function DocumentCard({
  row,
  loading,
  draft,
  changeDraft,
}: {
  row: DocumentRow;
  loading: boolean;
  draft?: NameDraft;
  changeDraft: (value: NameDraft | null) => void;
}) {
  const editing = !!draft,
    name = draft?.name || '',
    busy = !!draft?.busy,
    error = draft?.error || '';
  const field = useRef<HTMLInputElement>(null),
    card = useRef<HTMLDivElement>(null),
    wasEditing = useRef(editing),
    focusDraft = useRef(false);
  useLayoutEffect(() => {
    if (editing && focusDraft.current) {
      focusDraft.current = false;
      field.current?.focus();
      field.current?.select();
    } else if (!editing && wasEditing.current)
      card.current?.querySelector<HTMLButtonElement>('.more-actions')?.focus();
    wasEditing.current = editing;
  }, [editing]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !row.rename) return;
    if (!name.trim() || name.trim().length > 120) {
      changeDraft({ name, busy: false, error: '이름은 1~120자로 입력해 주세요.' });
      return;
    }
    changeDraft({ name, busy: true, error: '' });
    try {
      await row.rename(name.trim());
      changeDraft(null);
    } catch (error) {
      changeDraft({
        name,
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return (
    <div className="document-card" ref={card} data-document-card={row.id}>
      <Button
        variant="ghost"
        className="document-item"
        size="content"
        disabled={row.disabled}
        data-document-id={row.id}
        aria-current={row.current ? 'true' : undefined}
        title={row.captured}
        onClick={row.open}
        hidden={editing}
      >
        <DocumentVisual id={row.id} summary={row.summary} />
        <strong>{row.title + (row.current ? ' · 현재 작업' : '')}</strong>
        <span>{row.url}</span>
        <small>{row.date}</small>
      </Button>
      {editing && (
        <form
          className="document-inline-rename"
          noValidate
          onSubmit={submit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              if (!busy) changeDraft(null);
            }
          }}
        >
          <label htmlFor={'document-name-' + row.id}>화면 이름</label>
          <Input
            id={'document-name-' + row.id}
            ref={field}
            value={name}
            maxLength={120}
            disabled={busy}
            onChange={(e) => changeDraft({ name: e.target.value, busy: false, error: '' })}
          />
          <small>{row.url}</small>
          {error && <p role="alert">{error}</p>}
          <div>
            <Button type="button" disabled={busy} onClick={() => changeDraft(null)}>
              취소
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? '저장 중…' : '저장'}
            </Button>
          </div>
        </form>
      )}
      <ActionMenu
        label={row.title}
        actions={row.actions.map((a) =>
          a.kind === 'rename' && row.rename
            ? {
                ...a,
                run: () => {
                  focusDraft.current = true;
                  changeDraft({ name: row.title, busy: false, error: '' });
                },
              }
            : a,
        )}
        disabled={loading || editing}
      />
      {row.recovery && (
        <div className="recovery-actions">
          {row.recovery.map((item) => (
            <Button
              variant="outline"
              key={item.kind}
              data-document-action={item.kind}
              disabled={loading}
              aria-label={row.title + ' · ' + item.label}
              onClick={item.run}
            >
              {item.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
export function renderPath(
  host: Element,
  items: { id: string; label: string; title: string }[],
  select: (id: string) => void,
) {
  renderReact(
    host,
    <>
      {items.map((item) => (
        <Button
          variant="ghost"
          type="button"
          key={item.id}
          title={item.title}
          onClick={() => select(item.id)}
        >
          {item.label}
        </Button>
      ))}
    </>,
  );
}
export function renderRecent(
  host: Element,
  items: { id: string; title: string; capturedAt: string }[],
  open: (id: string) => unknown,
) {
  renderReact(
    host,
    <>
      {items.map((item) => (
        <Button variant="ghost" key={item.id} className="recent-item" onClick={() => open(item.id)}>
          <span>{item.title}</span>
          <small>{new Date(item.capturedAt).toLocaleDateString('ko-KR')}</small>
        </Button>
      ))}
    </>,
  );
}
export function renderCaptureIssues(
  host: Element,
  items: {
    id?: string;
    kind: string;
    message: string;
    name?: string;
    actionable: boolean;
    severity: string;
    resolution?: string;
  }[],
  reveal: (id: string) => void,
) {
  const groups = [
    { id: 'loss', name: '누락·부분 수집 확인' },
    { id: 'constraint', name: '개별 편집 제약' },
    { id: 'info', name: '참고 사항' },
  ];
  renderReact(
    host,
    <>
      {groups.map((group) => {
        const values = items.filter((item) => item.severity === group.id);
        return values.length ? (
          <li className={'capture-issue-group ' + group.id} key={group.id}>
            <h3>
              {group.name} · {values.length}
            </h3>
            <ul>
              {values.map((item, index) => (
                <li key={index}>
                  <strong>{item.name || item.kind}</strong>
                  {item.name && <span className="capture-issue-kind">{item.kind}</span>}
                  <p>{item.message}</p>
                  {item.resolution === 'resource_applied' && (
                    <p>현재 작업에 복구 적용됨 · 시각 확인은 필요합니다.</p>
                  )}
                  {item.id && item.actionable && (
                    <Button
                      type="button"
                      variant="outline"
                      aria-label={(item.name || item.kind) + ' · 화면에서 확인'}
                      onClick={() => reveal(item.id!)}
                    >
                      화면에서 확인
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ) : null;
      })}
    </>,
  );
}

export function DocumentVisual({
  id,
  summary,
}: {
  id: string;
  summary?: { snapshotName?: string; activeSnapshotName?: string; commentCount?: number };
}) {
  const host = useRef<HTMLDivElement>(null);
  const [details, setDetails] = useState(summary);
  const [preview, setPreview] = useState<{
    html: string;
    size: { width: number; height: number };
  } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true,
      started = false;
    const observer = new IntersectionObserver((entries) => {
      if (started || !entries.some((e) => e.isIntersecting)) return;
      started = true;
      observer.disconnect();
      (async () => {
        const doc = await getDocument(id, { includeDeleted: true });
        if (!live || !doc) return;
        setDetails(documentSummary(doc));
        const result = await withVersionScene(
          doc,
          doc,
          (scene: import('../../engine.js').CanvasScene) => ({
            html: scene.serialize(),
            size: scene.contentSize(),
          }),
        );
        if (live) setPreview(result);
      })().catch(() => {
        if (live) setFailed(true);
      });
    });
    observer.observe(host.current!);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [id]);
  const scale = preview ? Math.min(112 / preview.size.width, 72 / preview.size.height) : 1;
  return (
    <div className="document-visual" ref={host}>
      <div className="document-thumbnail" aria-label="저장된 편집 화면 미리보기">
        {preview ? (
          <iframe
            title="문서 축소 미리보기"
            sandbox="allow-same-origin"
            referrerPolicy="no-referrer"
            tabIndex={-1}
            aria-hidden="true"
            srcDoc={preview.html}
            width={preview.size.width}
            height={preview.size.height}
            style={{ transform: `scale(${scale})` }}
          />
        ) : (
          <small>{failed ? '미리보기 없음' : '미리보기 준비 중'}</small>
        )}
      </div>
      <div className="document-summary">
        <span>
          {'작업 기준 · ' + (details?.activeSnapshotName || '기록 없음')}
          <br />
          {'최근 저장 버전 · ' + (details?.snapshotName || '불러오는 중')}
        </span>
        <small>
          {details?.commentCount === undefined
            ? '주석 불러오는 중'
            : '주석 ' + details.commentCount + '개'}
        </small>
      </div>
    </div>
  );
}

export function renderQuickDocuments(host: Element, rows: DocumentRow[], loading: boolean) {
  renderReact(
    host,
    <>
      {loading && <p role="status">저장된 화면을 불러오는 중…</p>}
      {!loading && !rows.length && <p role="status">일치하는 화면이 없습니다.</p>}
      {rows.map((row) => (
        <div key={row.id} className="quick-document">
          <Button
            className="quick-document-open"
            variant="ghost"
            disabled={row.disabled}
            onClick={row.open}
            title={row.url + ' · ' + row.captured}
            aria-current={row.current ? 'true' : undefined}
          >
            <strong>
              {row.title}
              {row.current ? ' · 현재 작업' : ''}
            </strong>
            <small>
              작업 기준 {row.summary?.activeSnapshotName || '기록 없음'} · 주석{' '}
              {row.summary?.commentCount ?? '—'}개<br />
              최근 저장 버전 {row.summary?.snapshotName || '기록 없음'}
            </small>
            <small>
              {row.date} · {row.url}
            </small>
          </Button>
          <ActionMenu label={row.title} actions={row.actions} />
        </div>
      ))}
    </>,
  );
}
