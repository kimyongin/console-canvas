import { restoreSerializedScroll } from '../../capture-scroll.js';
import { useLayoutEffect, useRef, useState } from 'react';
import { renderReact } from './mount';
import { Button } from './components/button';
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
  documentSize,
  origin = { x: 0, y: 0 },
}: {
  html: string;
  size: { width: number; height: number };
  title: string;
  zoom?: number;
  highlight?: PreviewHighlight;
  fitHeight?: boolean;
  documentSize?: { width: number; height: number };
  origin?: { x: number; y: number };
}) {
  const space = useRef<HTMLDivElement>(null),
    label = useRef<HTMLSpanElement>(null),
    [scale, setScale] = useState(0.5),
    [hostWidth, setHostWidth] = useState(0),
    [labelWidth, setLabelWidth] = useState(0);
  useLayoutEffect(() => {
    const host = space.current!.parentElement!;
    const fit = () => {
      setHostWidth(host.clientWidth);
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
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    return () => observer.disconnect();
  }, [size.width, size.height, zoom, fitHeight]);
  const labelMaxWidth = Math.max(14, Math.min(280, size.width * scale - 4, hostWidth - 24));
  useLayoutEffect(() => {
    setLabelWidth(label.current?.offsetWidth || 0);
  }, [highlight?.label, labelMaxWidth]);
  return (
    <div
      ref={space}
      className="snapshot-preview-space"
      style={{
        width: size.width * scale,
        height: size.height * scale,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <iframe
        title={title}
        sandbox="allow-same-origin"
        referrerPolicy="no-referrer"
        tabIndex={-1}
        width={(documentSize || size).width}
        height={(documentSize || size).height}
        srcDoc={html}
        onLoad={(e) => {
          const doc = e.currentTarget.contentDocument;
          if (doc) restoreSerializedScroll(doc);
        }}
        style={{
          pointerEvents: 'none',
          transform:
            origin.x || origin.y
              ? `translate(${-origin.x * scale}px,${-origin.y * scale}px) scale(${scale})`
              : `scale(${scale})`,
        }}
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
            left: (highlight.rect.x - origin.x) * scale,
            top: (highlight.rect.y - origin.y) * scale,
            width: Math.max(14, highlight.rect.width * scale),
            height: Math.max(14, highlight.rect.height * scale),
          }}
        >
          <span
            ref={label}
            style={{
              top: (highlight.rect.y - origin.y) * scale < 26 ? 0 : -25,
              maxWidth: labelMaxWidth,
              left:
                Math.max(
                  2,
                  Math.min(
                    (highlight.rect.x - origin.x) * scale + 2,
                    size.width * scale - labelWidth - 2,
                  ),
                ) -
                (highlight.rect.x - origin.x) * scale -
                2,
            }}
          >
            {highlight.label}
          </span>
        </div>
      )}
    </div>
  );
}
export function renderVersionFrame(
  host: Element,
  result: {
    html: string;
    size: { width: number; height: number };
    documentSize?: { width: number; height: number };
    origin?: { x: number; y: number };
  },
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
export function renderTargetPreview(
  host: Element,
  html: string,
  size: { width: number; height: number },
  rect: { x: number; y: number; width: number; height: number },
  maxHeight = 130,
  target = '',
) {
  renderReact(
    host,
    <TargetPreview key={target} html={html} size={size} rect={rect} maxHeight={maxHeight} />,
  );
}
function TargetPreview({
  html,
  size,
  rect,
  maxHeight,
}: {
  html: string;
  size: { width: number; height: number };
  rect: { x: number; y: number; width: number; height: number };
  maxHeight: number;
}) {
  const [expanded, setExpanded] = useState(false),
    [zoom, setZoom] = useState('fit'),
    host = useRef<HTMLDivElement>(null),
    [bounds, setBounds] = useState({ width: 400, height: 100 });
  useLayoutEffect(() => {
    const element = host.current!;
    const measure = () =>
      setBounds({ width: element.clientWidth || 400, height: element.clientHeight || maxHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [maxHeight, expanded]);
  const width = Math.min(size.width, Math.max(280, rect.width + 64)),
    height = Math.min(size.height, Math.max(110, rect.height + 48));
  const x = Math.max(0, Math.min(size.width - width, rect.x + rect.width / 2 - width / 2)),
    y = Math.max(0, Math.min(size.height - height, rect.y + rect.height / 2 - height / 2));
  const scale =
    expanded && zoom !== 'fit'
      ? Number(zoom)
      : Math.min(1, bounds.width / width, (expanded ? bounds.height : maxHeight) / height);
  return (
    <div className={'target-preview' + (expanded ? ' is-expanded' : '')}>
      <div className="target-preview-tools">
        <Button
          id="comment-preview-expand"
          variant="ghost"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '미리보기 접기' : '미리보기 펼치기'}
        </Button>
        {expanded && (
          <label>
            확대{' '}
            <select
              aria-label="주석 대상 확대"
              value={zoom}
              onChange={(e) => setZoom(e.target.value)}
            >
              <option value="fit">맞춤</option>
              <option value="0.5">50%</option>
              <option value="1">100%</option>
            </select>
          </label>
        )}
      </div>
      <div
        className="target-preview-scroll"
        ref={host}
        style={{ height: expanded ? 'min(280px, 40dvh)' : maxHeight }}
        tabIndex={expanded ? 0 : undefined}
        aria-label="주석 대상 미리보기 스크롤"
      >
        <div className="target-crop" style={{ width: width * scale, height: height * scale }}>
          <iframe
            title="주석 대상 주변 화면"
            aria-hidden="true"
            sandbox="allow-same-origin"
            referrerPolicy="no-referrer"
            tabIndex={-1}
            srcDoc={html}
            onLoad={(e) => {
              const doc = e.currentTarget.contentDocument;
              if (doc) restoreSerializedScroll(doc);
            }}
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
        </div>
      </div>
    </div>
  );
}

export function renderSelectOptions(host: Element, options: { id: string; name: string }[]) {
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
