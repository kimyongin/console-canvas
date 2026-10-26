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
          <Badge variant="outline">◌ 현재 작업 · 스냅샷 이후 변경</Badge>
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
export interface PreviewHighlight {
  rect: { x: number; y: number; width: number; height: number };
  label: string;
  missing?: boolean;
  point?: boolean;
}
export function VersionFrame({
  html,
  size,
  title,
  zoom,
  highlight,
  fitHeight = false,
}: {
  html: string;
  size: { width: number; height: number };
  title: string;
  zoom?: number;
  highlight?: PreviewHighlight;
  fitHeight?: boolean;
}) {
  const space = useRef<HTMLDivElement>(null),
    [scale, setScale] = useState(0.5);
  useLayoutEffect(() => {
    const host = space.current!.parentElement!;
    const fit = () =>
      setScale(
        zoom ??
          Math.max(
            0.05,
            Math.min(
              1,
              (host.clientWidth - 16) / size.width,
              fitHeight ? (host.clientHeight - 16) / size.height : 1,
            ),
          ),
      );
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    return () => observer.disconnect();
  }, [size.width, size.height, zoom, fitHeight]);
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
      {highlight && (
        <div
          className={
            'compare-target-highlight' +
            (highlight.missing ? ' missing-target' : '') +
            (highlight.point ? ' point-target' : '')
          }
          role="img"
          aria-label={highlight.label}
          style={{
            left: highlight.rect.x * scale,
            top: highlight.rect.y * scale,
            width: Math.max(14, highlight.rect.width * scale),
            height: Math.max(14, highlight.rect.height * scale),
          }}
        >
          <span style={{ top: highlight.rect.y * scale < 26 ? 0 : -25 }}>{highlight.label}</span>
        </div>
      )}
    </div>
  );
}
export function renderVersionFrame(
  host: Element,
  result: { html: string; size: { width: number; height: number } },
  title: string,
  zoom?: number,
  highlight?: PreviewHighlight,
  fitHeight = false,
) {
  renderReact(
    host,
    <VersionFrame
      {...result}
      title={title}
      zoom={zoom}
      highlight={highlight}
      fitHeight={fitHeight}
    />,
  );
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

export function renderHandoffRequests(
  host: Element,
  requests: { id: string; number: number; name: string }[],
  editable: boolean,
  pick: (id: string) => void,
) {
  renderReact(
    host,
    <>
      {requests.map((r) => (
        <Button
          key={r.id}
          className="handoff-request"
          variant="outline"
          disabled={!editable}
          aria-label={'요청 ' + r.number + ' · ' + r.name + ' 주석 편집'}
          data-request-id={r.id}
          onClick={() => pick(r.id)}
        >
          {r.number + ' · ' + r.name}
        </Button>
      ))}
      {!editable && (
        <small>{'저장 버전은 보기 전용입니다. 현재 작업을 선택해 주석을 편집하세요.'}</small>
      )}
    </>,
  );
}
export function renderHandoffPreview(
  host: Element,
  url: string,
  result: {
    width: number;
    height: number;
    hotspots: { id: string; number: number; x: number; y: number; width: number; height: number }[];
  },
  editable: boolean,
  pick: (id: string) => void,
) {
  renderReact(
    host,
    <div className="handoff-interactive">
      <img
        src={url}
        width={result.width}
        height={result.height}
        alt="변경 후 화면과 번호별 주석 카드가 포함된 전달 이미지"
      />
      {editable &&
        result.hotspots.map((r, i) => (
          <button
            key={i}
            className="handoff-hotspot"
            aria-label={'이미지 요청 ' + r.number + ' 주석 편집'}
            style={{
              left: (r.x / result.width) * 100 + '%',
              top: (r.y / result.height) * 100 + '%',
              width: (r.width / result.width) * 100 + '%',
              height: (r.height / result.height) * 100 + '%',
            }}
            onClick={() => pick(r.id)}
          />
        ))}
    </div>,
  );
}

export function renderTargetPreview(
  host: Element,
  html: string,
  size: { width: number; height: number },
  rect: { x: number; y: number; width: number; height: number },
  maxHeight = 130,
) {
  const width = Math.min(size.width, Math.max(280, rect.width + 64)),
    height = Math.min(size.height, Math.max(110, rect.height + 48));
  const x = Math.max(0, Math.min(size.width - width, rect.x + rect.width / 2 - width / 2)),
    y = Math.max(0, Math.min(size.height - height, rect.y + rect.height / 2 - height / 2));
  const scale = Math.min(1, (host.clientWidth || 380) / width, maxHeight / height);
  renderReact(
    host,
    <div className="target-crop" style={{ width: width * scale, height: height * scale }}>
      <iframe
        title="주석 대상 주변 화면"
        aria-hidden="true"
        sandbox="allow-same-origin"
        referrerPolicy="no-referrer"
        tabIndex={-1}
        srcDoc={html}
        width={size.width}
        height={size.height}
        style={{ transform: `scale(${scale})`, left: -x * scale, top: -y * scale }}
      />
      <span
        className="target-crop-outline"
        style={{
          left: (rect.x - x) * scale,
          top: (rect.y - y) * scale,
          width: Math.max(8, rect.width * scale),
          height: Math.max(8, rect.height * scale),
        }}
      />
    </div>,
  );
}

export function renderSnapshotMatches(
  host: Element,
  entries: { id: string; name: string; parent: string }[],
  total: number,
  pick: (id: string) => void,
) {
  renderReact(
    host,
    <>
      <small role="status">
        {total
          ? `${total}개 결과` + (total > entries.length ? ` · 최근 ${entries.length}개 표시` : '')
          : '검색 결과가 없습니다.'}
      </small>
      {entries.map((e) => (
        <Button
          key={e.id}
          variant="ghost"
          size="content"
          className="snapshot-search-match"
          data-snapshot-match={e.id}
          onClick={() => pick(e.id)}
        >
          <strong>{e.name}</strong>
          <small>{e.parent}</small>
        </Button>
      ))}
    </>,
  );
}
