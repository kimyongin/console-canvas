import { renderReact } from './mount';
import { Button } from './components/button';
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
  comment?: string;
  commentNumber?: number;
  mark?: string;
}
export function renderLayerRows(
  host: Element,
  rows: LayerRow[],
  toggle: (id: string) => void,
  pick: (id: string, additive: boolean) => void,
) {
  renderReact(
    host,
    <>
      {rows.map((row) => (
        <div
          key={row.id}
          className={
            'layer-row' + (row.selected ? ' selected' : '') + (row.deleted ? ' deleted' : '')
          }
          style={{ paddingLeft: Math.min(row.depth * 12, 96) }}
          data-layer-id={row.id}
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
          {row.comment && (
            <span className="layer-comment" title={row.comment}>
              주석 {row.commentNumber}
            </span>
          )}
          {row.mark && <span className="layer-mark">{row.mark}</span>}
        </div>
      ))}
    </>,
  );
}
export interface ActivityRow {
  id: string;
  time: string;
  heading: string;
  changes: {
    id: string;
    name: string;
    type: string;
    description: string;
    disabled: boolean;
    run: () => void;
  }[];
}
export function renderActivityRows(host: Element, rows: ActivityRow[], empty: string) {
  renderReact(
    host,
    rows.length ? (
      <>
        {rows.map((row) => (
          <article key={row.id} className="activity-event" data-event-id={row.id}>
            <small>{row.time}</small>
            <strong>{row.heading}</strong>
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
  current: boolean;
  disabled: boolean;
  open: () => void;
  actions: MenuAction[];
  recovery?: { label: string; kind: string; run: () => unknown }[];
}
export function renderDocumentRows(host: Element, rows: DocumentRow[], loading: boolean) {
  renderReact(
    host,
    <>
      {rows.map((row) => (
        <div className="document-card" key={row.id} data-document-card={row.id}>
          <Button
            variant="ghost"
            className="document-item"
            size="content"
            disabled={row.disabled}
            data-document-id={row.id}
            aria-current={row.current ? 'true' : undefined}
            title={row.captured}
            onClick={row.open}
          >
            <strong>{row.title + (row.current ? ' · 현재 작업' : '')}</strong>
            <span>{row.url}</span>
            <small>{row.date}</small>
          </Button>
          <ActionMenu label={row.title} actions={row.actions} disabled={loading} />
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
      ))}
    </>,
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
export function renderWarnings(host: Element, warnings: { message: string }[]) {
  renderReact(
    host,
    <>
      {warnings.map((item, index) => (
        <li key={index}>{item.message}</li>
      ))}
    </>,
  );
}
