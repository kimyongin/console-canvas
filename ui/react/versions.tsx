import { useLayoutEffect, useRef, useState } from 'react';
import { renderReact } from './mount';
import { Button } from './components/button';
import { Badge } from './components/badge';
import { ActionMenu, type MenuAction } from './components/action-menu';
export interface GraphNode {
  id: string;
  parentId: string | null;
  name: string;
  createdAt: string;
  kind: string;
  deletedAt?: string;
  x: number;
  y: number;
  lane: number;
  depth: number;
}
export interface GraphData {
  width: number;
  height: number;
  nodes: GraphNode[];
  edges: {
    parent_id: string;
    child_id: string;
    from: { x: number; y: number };
    to: { x: number; y: number };
  }[];
}
export function renderSnapshotGraph(
  host: HTMLElement,
  data: GraphData,
  active: string | null,
  preview: string | null,
  dirty: boolean,
  select: (id: string) => void,
  actions: (entry: GraphNode) => MenuAction[],
) {
  host.style.width = data.width + 'px';
  host.style.height = data.height + 'px';
  const parent = data.nodes.find((n) => n.id === active);
  renderReact(
    host,
    <>
      <svg width={data.width} height={data.height} aria-hidden="true" className="snapshot-edges">
        {data.edges.map((edge) => (
          <path
            key={edge.child_id}
            data-parent-id={edge.parent_id}
            data-child-id={edge.child_id}
            className={
              (edge.from.y !== edge.to.y ? 'branch-edge ' : '') +
              (edge.child_id === preview ? 'selected-edge' : '')
            }
            d={`M${edge.from.x},${edge.from.y} C${edge.from.x + 70},${edge.from.y} ${edge.to.x - 70},${edge.to.y} ${edge.to.x},${edge.to.y}`}
          />
        ))}
      </svg>
      {data.nodes.map((entry) => (
        <div
          key={entry.id}
          className={
            'snapshot-card snapshot-graph-node' +
            (entry.id === active ? ' active-version' : '') +
            (entry.id === preview ? ' preview-version' : '')
          }
          style={{ left: entry.x - 28, top: entry.y - 65 }}
          data-depth={entry.depth}
          data-lane={entry.lane}
        >
          <Button
            variant="ghost"
            type="button"
            className="snapshot-entry"
            size="content"
            data-snapshot-id={entry.id}
            data-parent-id={entry.parentId || ''}
            disabled={!!entry.deletedAt}
            aria-pressed={entry.id === preview}
            aria-label={entry.name + ' · 미리보기'}
            onClick={() => select(entry.id)}
          >
            <strong>{entry.name + (entry.deletedAt ? ' · 휴지통' : '')}</strong>
            <span>
              {new Date(entry.createdAt).toLocaleString('ko-KR', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <small>
              {entry.id === active
                ? '현재 버전'
                : entry.id === preview
                  ? '선택한 미리보기'
                  : entry.kind === 'automatic'
                    ? '이동 전 자동 보관'
                    : '저장된 버전'}
            </small>
          </Button>
          {!entry.deletedAt && <ActionMenu label={entry.name} actions={actions(entry)} />}
        </div>
      ))}
      {dirty && (
        <div
          className="snapshot-draft-node"
          style={{ left: parent ? parent.x + 30 : 20, top: parent ? parent.y + 28 : 20 }}
        >
          <Badge variant="outline">◌ 현재 작업 · 저장 전</Badge>
        </div>
      )}
    </>,
  );
}
export function renderSnapshotTrash(
  host: Element,
  entries: { id: string; name: string }[],
  recover: (id: string, apply: boolean) => unknown,
) {
  renderReact(
    host,
    entries.length ? (
      <>
        {entries.map((entry) => (
          <div key={entry.id} className="snapshot-card" data-trashed-id={entry.id}>
            <strong>{entry.name}</strong>
            <Button
              variant="outline"
              data-snapshot-action="recover"
              aria-label={entry.name + ' · 복구'}
              onClick={() => recover(entry.id, false)}
            >
              복구
            </Button>
            <Button
              variant="outline"
              data-snapshot-action="recover-apply"
              aria-label={entry.name + ' · 복구하고 적용'}
              onClick={() => recover(entry.id, true)}
            >
              복구하고 적용
            </Button>
          </div>
        ))}
      </>
    ) : (
      '휴지통이 비어 있습니다.'
    ),
  );
}
function VersionFrame({
  html,
  size,
  title,
}: {
  html: string;
  size: { width: number; height: number };
  title: string;
}) {
  const space = useRef<HTMLDivElement>(null),
    [scale, setScale] = useState(0.5);
  useLayoutEffect(() => {
    const host = space.current!.parentElement!;
    const fit = () => setScale(Math.max(0.05, Math.min(1, (host.clientWidth - 16) / size.width)));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    return () => observer.disconnect();
  }, [size.width]);
  return (
    <div
      ref={space}
      className="snapshot-preview-space"
      style={{ width: size.width * scale, height: size.height * scale, position: 'relative' }}
    >
      <iframe
        title={title}
        sandbox="allow-same-origin"
        referrerPolicy="no-referrer"
        tabIndex={-1}
        width={size.width}
        height={size.height}
        srcDoc={html}
        style={{ pointerEvents: 'none', transform: `scale(${scale})` }}
      />
    </div>
  );
}
export function renderVersionFrame(
  host: Element,
  result: { html: string; size: { width: number; height: number } },
  title: string,
) {
  renderReact(host, <VersionFrame {...result} title={title} />);
}
export function renderImage(host: Element, url: string) {
  renderReact(host, <img src={url} alt="변경 후 화면과 번호별 주석 카드가 포함된 전달 이미지" />);
}
export function renderVersionOptions(host: Element, options: { id: string; name: string }[]) {
  renderReact(
    host,
    <>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name}
        </option>
      ))}
    </>,
  );
}
