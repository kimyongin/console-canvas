/* Runs in an isolated extension world. The source page is read, never modified. */
(() => {
  'use strict';
  const VERSION = 1;
  const registeredShadows = new WeakMap();
  const resourceCaches = new WeakMap();
  const frameIdentities = new WeakMap(),
    frameCounters = new WeakMap();
  function frameIndex(element) {
    if (!frameIdentities.has(element)) {
      const next = frameCounters.get(element.ownerDocument) || 0;
      frameIdentities.set(element, next);
      frameCounters.set(element.ownerDocument, next + 1);
    }
    return frameIdentities.get(element);
  }
  function frameElements(owner) {
    const frames = [];
    function visit(element) {
      if (element.localName === 'iframe') frames.push(element);
      const shadow = element.shadowRoot || registeredShadows.get(element);
      for (const child of shadow?.children || element.children || []) visit(child);
      if (shadow) for (const child of element.children || []) visit(child);
    }
    if (owner.documentElement) visit(owner.documentElement);
    return [...new Set(frames)];
  }
  const PROPS =
    `display position top right bottom left z-index float clear box-sizing width height min-width min-height max-width max-height
    margin-top margin-right margin-bottom margin-left padding-top padding-right padding-bottom padding-left
    border-top-width border-right-width border-bottom-width border-left-width border-top-style border-right-style border-bottom-style border-left-style
    border-top-color border-right-color border-bottom-color border-left-color border-top-left-radius border-top-right-radius border-bottom-left-radius border-bottom-right-radius
    border-collapse border-spacing table-layout caption-side empty-cells vertical-align
    border-image-source border-image-slice border-image-width border-image-outset border-image-repeat
    color background-color background-image background-size background-position background-repeat background-origin background-clip background-attachment
    font-family font-size font-size-adjust font-weight font-style font-stretch font-variant font-feature-settings font-kerning font-variation-settings font-optical-sizing font-palette font-synthesis font-language-override line-height letter-spacing word-spacing
    text-align text-align-last text-decoration text-transform text-indent text-overflow text-shadow text-rendering white-space word-break overflow-wrap direction writing-mode
    line-clamp -webkit-line-clamp -webkit-box-orient -webkit-box-align -webkit-box-pack -webkit-box-flex
    opacity visibility overflow-x overflow-y clip clip-path box-shadow filter backdrop-filter mix-blend-mode isolation
    transform transform-origin translate rotate scale zoom perspective object-fit object-position aspect-ratio appearance accent-color outline outline-offset
    flex-direction flex-wrap flex-grow flex-shrink flex-basis justify-content align-items align-self align-content order gap row-gap column-gap
    grid-template-columns grid-template-rows grid-template-areas grid-auto-columns grid-auto-rows grid-auto-flow grid-column-start grid-column-end grid-row-start grid-row-end
    justify-items justify-self list-style-type list-style-position list-style-image fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-opacity
    mask-image mask-mode mask-repeat mask-position mask-size mask-origin mask-clip mask-composite mask-type
    -webkit-mask-image -webkit-mask-repeat -webkit-mask-position -webkit-mask-size -webkit-mask-origin -webkit-mask-clip -webkit-mask-composite
    unicode-bidi text-orientation text-wrap-style text-wrap-mode -webkit-font-smoothing
    -webkit-text-fill-color -webkit-text-stroke-width -webkit-text-stroke-color -webkit-background-clip`
      .split(/\s+/)
      .filter(Boolean);
  const OMIT = new Set([
    'SCRIPT',
    'STYLE',
    'LINK',
    'META',
    'BASE',
    'NOSCRIPT',
    'TEMPLATE',
    'OBJECT',
    'EMBED',
  ]);
  const SAFE_ATTR =
    /^(id|class|title|role|aria-[\w-]+|colspan|rowspan|scope|type|placeholder|name|checked|selected|multiple|size|rows|cols|min|max|step|value|alt|width|height|viewBox|d|fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|xmlns|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|points|preserveAspectRatio|transform|offset|stop-color|stop-opacity|fill-rule|clip-rule|opacity|text-anchor|dominant-baseline|font-size|font-family|pathLength|for|open|dir|lang)$/i;
  const esc = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    );
  const short = (value) =>
    String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  const deadline = (promise, ms) =>
    Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
  const isFontRule = (rule) =>
    /^@font-(?:face|feature-values|palette-values)\b/i.test(rule.cssText);
  function completeImageData(data, win) {
    if (typeof data !== 'string') return false;
    if (!/^data:image\/png;base64,/i.test(data)) return true;
    try {
      // Blink can decode a truncated PNG and report complete/naturalWidth
      // while silently painting missing scanlines white. Require its end chunk.
      return (
        win.atob(data.slice(data.indexOf(',') + 1).slice(-32)).slice(-12) ===
        '\x00\x00\x00\x00IEND\xae\x42\x60\x82'
      );
    } catch {
      return false;
    }
  }
  function absolute(value, base) {
    try {
      return new URL(value, base).href;
    } catch {
      return '';
    }
  }
  function imageData(image, doc) {
    try {
      if (!image.complete || !image.naturalWidth) return null;
      const canvas = doc.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      if (canvas.width * canvas.height > 16_000_000) return null;
      canvas.getContext('2d').drawImage(image, 0, 0);
      return canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  }
  async function capture(doc = document, options = {}) {
    const win = doc.defaultView;
    const resourceCache = resourceCaches.get(doc) || new Map();
    resourceCaches.set(doc, resourceCache);
    if (!doc.body || !win)
      throw new Error('아직 화면이 준비되지 않았습니다. 로딩 후 다시 가져와 주세요.');
    const sourceUrl = doc.location.href;
    function canvasBackground(owner) {
      const html = owner.defaultView.getComputedStyle(owner.documentElement),
        body = owner.defaultView.getComputedStyle(owner.body);
      return html.backgroundColor === 'rgba(0, 0, 0, 0)' && html.backgroundImage === 'none'
        ? body.backgroundColor
        : html.backgroundColor;
    }
    const sourceWidth = win.innerWidth,
      sourceHeight = win.innerHeight;
    const scrollX = win.scrollX,
      scrollY = win.scrollY;
    const nodes = [],
      warnings = [],
      assets = new Set(),
      extraFonts = [],
      imageJobs = [],
      contexts = new Map([[doc, { x: scrollX, y: scrollY, sx: 1, sy: 1, frames: [] }]]);
    let counter = 0,
      traversed = 0;
    const maxElements = options.maxElements || 15000;
    const project = (r, owner) => {
      const c = contexts.get(owner);
      return {
        x: Math.round((r.left * c.sx + c.x) * 100) / 100,
        y: Math.round((r.top * c.sy + c.y) * 100) / 100,
        width: Math.round(r.width * c.sx * 100) / 100,
        height: Math.round(r.height * c.sy * 100) / 100,
      };
    };
    const bounds = (element) => project(element.getBoundingClientRect(), element.ownerDocument);
    function styles(element, pseudo) {
      const doc = element.ownerDocument,
        win = doc.defaultView,
        sourceUrl = doc.baseURI;
      const result = doc.createElement('span').style,
        computed = win.getComputedStyle(element, pseudo);
      for (const property of PROPS) {
        let value = computed.getPropertyValue(property);
        value = value.replace(/url\(["']?([^)'"\s]+)["']?\)/g, (all, url) => {
          const full = absolute(url, doc.baseURI),
            hash = full.indexOf('#');
          return hash >= 0 && full.slice(0, hash) === doc.location.href.split('#')[0]
            ? 'url("' + full.slice(hash) + '")'
            : all;
        });
        if (value) result.setProperty(property, value);
        for (const match of value.matchAll(/url\(["']?(.*?)["']?\)/g)) {
          const url = absolute(match[1], sourceUrl);
          if (/^https?:/.test(url) && !match[1].startsWith('#')) assets.add(url);
        }
      }
      // Blink may report flow-root for a line-clamped legacy WebKit box.
      // Re-establish its required formatting context, not just the clamp count.
      if (parseInt(computed.webkitLineClamp, 10) > 0 && computed.webkitBoxOrient === 'vertical') {
        result.display = computed.display.startsWith('inline')
          ? '-webkit-inline-box'
          : '-webkit-box';
        result.webkitBoxOrient = 'vertical';
        result.webkitLineClamp = computed.webkitLineClamp;
      }
      result.setProperty('animation', 'none', 'important');
      result.setProperty('transition', 'none', 'important');
      result.setProperty('caret-color', 'transparent');
      result.setProperty('scroll-behavior', 'auto');
      // Used pixel heights turn an auto-height parent into a definite-height
      // box and change margin collapsing (notably dl/dd paragraphs).
      if (
        !pseudo &&
        !['absolute', 'fixed'].includes(computed.position) &&
        !(parseInt(computed.webkitLineClamp, 10) > 0 && computed.webkitBoxOrient === 'vertical') &&
        !['IMG', 'SVG', 'CANVAS', 'VIDEO', 'IFRAME', 'INPUT', 'TEXTAREA', 'SELECT'].includes(
          element.tagName,
        )
      )
        try {
          const typed = element.computedStyleMap?.();
          if (typed?.get('height')?.toString() === 'auto') result.height = 'auto';
        } catch {}
      if (!pseudo)
        try {
          const typed = element.computedStyleMap?.();
          for (const property of [
            'margin-left',
            'margin-right',
            'margin-inline-start',
            'margin-inline-end',
          ])
            if (typed?.get(property)?.toString() === 'auto') result.setProperty(property, 'auto');
        } catch {}
      return { css: result.cssText, computed };
    }
    function locator(element) {
      const doc = element.ownerDocument;
      const parts = [];
      let current = element;
      for (
        let depth = 0;
        current && current !== doc.body && depth < 7;
        depth++, current = current.parentElement
      ) {
        let part = current.localName;
        if (current.id) {
          part += '[id="' + current.id.replace(/["\\]/g, '\\$&') + '"]';
          parts.unshift(part);
          break;
        }
        const siblings = current.parentElement
          ? [...current.parentElement.children].filter(
              (child) => child.localName === current.localName,
            )
          : [];
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
        parts.unshift(part);
      }
      const shadows = [];
      let boundary = element.getRootNode();
      while (boundary.host) {
        shadows.unshift({ selector: locator(boundary.host).selector, mode: boundary.mode });
        boundary = boundary.host.getRootNode();
      }
      return {
        ...(shadows.length ? { shadows } : {}),
        selector: parts.join(' > ') || 'body',
        id: element.id || null,
        role: element.getAttribute('role'),
        label: element.getAttribute('aria-label'),
        text: short(element.textContent),
        ...(contexts.get(doc).frames.length ? { frames: contexts.get(doc).frames } : {}),
      };
    }
    function record(element, parentId, kind = 'element', extra = {}) {
      const id = 'n' + ++counter,
        computed = element.ownerDocument.defaultView.getComputedStyle(element),
        rect = bounds(element);
      const label =
        element.getAttribute('aria-label') ||
        element.getAttribute('title') ||
        element.getAttribute('placeholder') ||
        element.getAttribute('alt');
      const semantic = {
        BODY: '전체 화면',
        MAIN: '본문',
        ASIDE: '사이드바',
        HEADER: '상단 영역',
        FOOTER: '하단 영역',
        NAV: '내비게이션',
        FORM: '입력 영역',
        TABLE: '테이블',
        THEAD: '테이블 헤더',
        TBODY: '테이블 본문',
      };
      const node = {
        id,
        parentId,
        kind,
        tag: element.localName,
        name: short(
          label ||
            semantic[element.tagName] ||
            element.innerText ||
            element.textContent ||
            element.localName,
        ),
        rect,
        locator: locator(element),
        position: computed.position,
        scroll: { x: element.scrollLeft || 0, y: element.scrollTop || 0 },
        visible:
          computed.display !== 'none' &&
          computed.visibility !== 'hidden' &&
          rect.width > 0 &&
          rect.height > 0,
        ...extra,
      };
      const clip = contexts.get(element.ownerDocument).clip;
      if (clip) node.captureClip = clip;
      nodes.push(node);
      return node;
    }
    function textNode(source, parentId) {
      const text = source.textContent;
      if (!text.trim()) return doc.createTextNode(text);
      const parent = source.parentElement || source.getRootNode()?.host;
      if (['OPTION', 'TEXTAREA', 'TITLE'].includes(parent?.tagName))
        return doc.createTextNode(text);
      const range = doc.createRange();
      range.selectNodeContents(source);
      const r = range.getBoundingClientRect();
      if (!r.width || !r.height) return doc.createTextNode(text);
      const id = 'n' + ++counter,
        span = doc.createElement('span');
      span.setAttribute('data-uic-id', id);
      span.setAttribute('data-uic-text', '');
      span.style.display = 'contents';
      span.textContent = text;
      nodes.push({
        id,
        parentId,
        kind: 'text',
        tag: '#text',
        name: short(text),
        text,
        rect: project(r, source.ownerDocument),
        ...(contexts.get(source.ownerDocument).clip
          ? { captureClip: contexts.get(source.ownerDocument).clip }
          : {}),
        locator: {
          ...locator(parent),
          text: short(text),
          textIndex: [...parent.childNodes].filter((n) => n.nodeType === 3).indexOf(source),
        },
        position: 'static',
        scroll: { x: 0, y: 0 },
        visible: true,
        textStyle: styles(parent).css,
      });
      return span;
    }
    function pseudo(source, clone, parentId, position) {
      const { computed, css } = styles(source, '::' + position),
        content = computed.content;
      if (!content || content === 'none' || content === 'normal') return;
      let text;
      if (/^".*"$|^'.*'$/.test(content)) {
        try {
          text = JSON.parse(content);
        } catch {
          text = content.slice(1, -1);
        }
      } else return;
      if (
        !text &&
        !(parseFloat(computed.width) > 0 && parseFloat(computed.height) > 0) &&
        computed.clear === 'none' &&
        !['top', 'right', 'bottom', 'left'].some((side) =>
          ['padding-' + side, 'margin-' + side, 'border-' + side + '-width'].some(
            (key) => Math.abs(parseFloat(computed.getPropertyValue(key))) > 0,
          ),
        ) &&
        computed.aspectRatio === 'auto'
      )
        return;
      const span = doc.createElement('span'),
        id = 'n' + ++counter;
      span.textContent = text;
      span.style.cssText = css;
      span.style.removeProperty('content');
      span.dataset.uicId = id;
      const parent = nodes.find((node) => node.id === parentId);
      nodes.push({
        id,
        parentId,
        kind: 'pseudo',
        tag: '::' + position,
        name: '생성된 ' + position + (text ? ' · ' + short(text) : ' 아이콘'),
        text,
        rect: parent.rect,
        ...(parent.captureClip ? { captureClip: parent.captureClip } : {}),
        locator: { ...parent.locator, pseudo: position },
        position: computed.position,
        visible: true,
        scroll: { x: 0, y: 0 },
      });
      if (position === 'before') clone.prepend(span);
      else clone.append(span);
    }
    function cloneSvg(source, parentId) {
      const iconLabel =
        source.getAttribute('aria-label') ||
        source.parentElement?.getAttribute('aria-label') ||
        short(source.parentElement?.innerText);
      const node = record(source, parentId, 'icon', {
          name: (iconLabel ? iconLabel + ' ' : '') + '아이콘',
        }),
        clone = source.cloneNode(true);
      if (
        [...source.querySelectorAll('image,use')].some((el) =>
          [...el.attributes].some(
            (a) => /href$/i.test(a.name) && a.value && !a.value.startsWith('#'),
          ),
        ) ||
        source.querySelector('mask,filter,radialGradient') ||
        /url\(/i.test(source.ownerDocument.defaultView.getComputedStyle(source).backgroundImage)
      ) {
        const placeholder = doc.createElement('span'),
          css = source.ownerDocument.defaultView.getComputedStyle(source),
          px = (key) => parseFloat(css.getPropertyValue(key)) || 0;
        placeholder.style.cssText = styles(source).css;
        if (placeholder.style.display === 'inline') placeholder.style.display = 'inline-block';
        if (source.id) placeholder.id = source.id;
        placeholder.dataset.uicId = node.id;
        node.kind = 'raster';
        node.rasterReason = source.querySelector('mask,filter,radialGradient')
          ? 'svg_complex_paint'
          : 'svg_external_reference';
        const sx =
            node.rect.width /
            (source.clientWidth + px('border-left-width') + px('border-right-width') ||
              node.rect.width ||
              1),
          sy =
            node.rect.height /
            (source.clientHeight + px('border-top-width') + px('border-bottom-width') ||
              node.rect.height ||
              1);
        const left = (px('border-left-width') + px('padding-left')) * sx,
          top = (px('border-top-width') + px('padding-top')) * sy;
        node.rasterContentRect = {
          x: node.rect.x + left,
          y: node.rect.y + top,
          width: Math.max(
            0,
            node.rect.width - left - (px('border-right-width') + px('padding-right')) * sx,
          ),
          height: Math.max(
            0,
            node.rect.height - top - (px('border-bottom-width') + px('padding-bottom')) * sy,
          ),
        };
        warnings.push({
          type: 'raster',
          id: node.id,
          message: '복합 효과·외부 참조 SVG는 당시 픽셀을 담은 이미지 한 레이어로 가져왔습니다.',
        });
        return placeholder;
      }
      clone
        .querySelectorAll('script,foreignObject,animate,animateMotion,animateTransform,set')
        .forEach((el) => el.remove());
      const originals = [source, ...source.querySelectorAll('*')],
        clones = [clone, ...clone.querySelectorAll('*')];
      for (const el of clones)
        for (const attr of [...el.attributes]) {
          if (
            /^on/i.test(attr.name) ||
            /^(data-uic-|style$)/.test(attr.name) ||
            attr.name === 'srcdoc'
          )
            el.removeAttribute(attr.name);
          if (
            /href$/i.test(attr.name) &&
            !attr.value.startsWith('#') &&
            !/^https?:|^data:image\//.test(absolute(attr.value, sourceUrl))
          )
            el.removeAttribute(attr.name);
        }
      // Resolve colors inherited through the page's CSS, including currentColor.
      for (let i = 0; i < clones.length; i++)
        if (originals[i]) clones[i].style.cssText = styles(originals[i]).css;
      clone.dataset.uicId = node.id;
      return clone;
    }
    function cloneElement(source, parentId) {
      if (++traversed > maxElements)
        throw new Error(
          '화면 요소가 ' +
            maxElements.toLocaleString() +
            '개를 넘습니다. 목록을 접거나 페이지 크기를 줄인 뒤 다시 가져와 주세요.',
        );
      if (OMIT.has(source.tagName)) return null;
      if (source.namespaceURI === 'http://www.w3.org/2000/svg') return cloneSvg(source, parentId);
      if (source.tagName === 'INPUT' && source.type === 'hidden') return null;
      const raster = ['CANVAS', 'VIDEO', 'IFRAME'].includes(source.tagName),
        closedShadow = source.shadowRoot || registeredShadows.get(source);
      const node = record(source, parentId, raster ? 'raster' : 'element');
      const tag = raster ? 'div' : source.localName.includes('-') ? 'div' : source.localName;
      const clone = doc.createElement(tag),
        { css } = styles(source);
      clone.style.cssText = css;
      for (const attr of [...source.attributes])
        if (SAFE_ATTR.test(attr.name) && !/^data-uic-/.test(attr.name)) {
          if (attr.name === 'value' && source.type === 'password') continue;
          try {
            clone.setAttribute(attr.name, attr.value);
          } catch {}
        }
      clone.dataset.uicId = node.id;
      if (source.tagName === 'IFRAME') {
        const frameKey = frameIndex(source);
        const sx = node.rect.width / (source.offsetWidth || node.rect.width || 1),
          sy = node.rect.height / (source.offsetHeight || node.rect.height || 1);
        node.frame = {
          mode: 'image',
          index: frameKey,
          url: absolute(source.getAttribute('src') || '', source.ownerDocument.baseURI),
          contentRect: {
            x: node.rect.x + source.clientLeft * sx,
            y: node.rect.y + source.clientTop * sy,
            width: source.clientWidth * sx,
            height: source.clientHeight * sy,
          },
        };
        if (clone.style.display === 'inline') clone.style.display = 'inline-block';
        const external =
          source.ownerDocument === doc && options.frames?.find((f) => f.index === frameKey);
        if (external?.snapshot) {
          const captured = external.snapshot,
            parsed = new win.DOMParser().parseFromString(captured.html, 'text/html');
          const ids = new Map(captured.nodes.map((child) => [child.id, 'n' + ++counter]));
          const area = node.frame.contentRect,
            scroll = captured.source.scroll;
          const mapRect = (r) => ({
            x: area.x + (r.x - scroll.x) * sx,
            y: area.y + (r.y - scroll.y) * sy,
            width: r.width * sx,
            height: r.height * sy,
          });
          const intersect = (a, b) => {
            const x = Math.max(a.x, b.x),
              y = Math.max(a.y, b.y);
            return {
              x,
              y,
              width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
              height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
            };
          };
          const clip = node.captureClip ? intersect(area, node.captureClip) : area;
          for (const child of captured.nodes) {
            const imported = {
              ...child,
              id: ids.get(child.id),
              parentId: ids.get(child.parentId) || node.id,
              rect: mapRect(child.rect),
              captureClip: child.captureClip ? intersect(clip, mapRect(child.captureClip)) : clip,
              locator: {
                ...child.locator,
                frames: [
                  ...(node.locator.frames || []),
                  { selector: node.locator.selector, url: captured.source.url },
                  ...(child.locator.frames || []),
                ],
              },
            };
            if (child.rasterContentRect)
              imported.rasterContentRect = mapRect(child.rasterContentRect);
            if (child.image?.contentRect)
              imported.image = { ...child.image, contentRect: mapRect(child.image.contentRect) };
            if (child.frame?.contentRect)
              imported.frame = { ...child.frame, contentRect: mapRect(child.frame.contentRect) };
            nodes.push(imported);
          }
          const body = doc.createElement('div');
          for (const attr of [...parsed.body.attributes]) body.setAttribute(attr.name, attr.value);
          body.append(...parsed.body.childNodes);
          for (const el of [body, ...body.querySelectorAll('[data-uic-id]')]) {
            if (ids.has(el.dataset.uicId)) el.dataset.uicId = ids.get(el.dataset.uicId);
          }
          // Frame documents have independent ID scopes. Retain original IDs in
          // locators while namespacing rendered IDs and their local references.
          const prefix = node.id + '-',
            scoped = new Map(
              [...body.querySelectorAll('[id]')].map((el) => [el.id, prefix + el.id]),
            );
          if (body.id) scoped.set(body.id, prefix + body.id);
          for (const el of [body, ...body.querySelectorAll('*')])
            for (const attr of [...el.attributes]) {
              let value = attr.value;
              if (attr.name === 'id') value = scoped.get(value) || value;
              else if (
                [
                  'for',
                  'aria-labelledby',
                  'aria-describedby',
                  'aria-controls',
                  'aria-activedescendant',
                ].includes(attr.name)
              )
                value = value
                  .split(/\s+/)
                  .map((id) => scoped.get(id) || id)
                  .join(' ');
              else if (['href', 'xlink:href'].includes(attr.name) && value.startsWith('#'))
                value = '#' + (scoped.get(value.slice(1)) || value.slice(1));
              else if (attr.name === 'style')
                value = value.replace(/url\(["']?#([^)'" ]+)["']?\)/g, (all, id) =>
                  scoped.has(id) ? 'url("#' + scoped.get(id) + '")' : all,
                );
              if (value !== attr.value) el.setAttribute(attr.name, value);
            }
          for (const style of parsed.querySelectorAll('head style'))
            try {
              const sheet = new win.CSSStyleSheet();
              sheet.replaceSync(style.textContent);
              for (const rule of sheet.cssRules)
                if (isFontRule(rule)) extraFonts.push(rule.cssText);
            } catch {}
          for (const warning of captured.warnings || [])
            warnings.push({
              ...warning,
              ...(ids.has(warning.id) ? { id: ids.get(warning.id) } : {}),
            });
          const viewport = doc.createElement('div'),
            content = doc.createElement('div');
          viewport.style.cssText = `position:relative;width:${captured.source.viewport.width}px;height:${captured.source.viewport.height}px;overflow:hidden;transform:translateZ(0);background:${captured.source.background || 'transparent'}`;
          content.style.cssText = `position:relative;width:${captured.source.viewport.width}px;transform:translate(${-scroll.x}px,${-scroll.y}px)`;
          content.append(body);
          viewport.append(content);
          clone.append(viewport);
          clone.style.overflow = 'hidden';
          node.kind = 'element';
          node.frame = { ...node.frame, mode: 'dom', url: captured.source.url };
          return clone;
        }
        if (external?.error) node.frame.failure = external.error;
        let child;
        try {
          if (options.includeFrames !== false) child = source.contentDocument;
        } catch {}
        {
          const parent = contexts.get(source.ownerDocument);
          if (child?.body && child.defaultView && parent.frames.length < 5 && contexts.size < 33) {
            const sx = node.rect.width / (source.offsetWidth || node.rect.width || 1),
              sy = node.rect.height / (source.offsetHeight || node.rect.height || 1),
              x = node.rect.x + source.clientLeft * sx,
              y = node.rect.y + source.clientTop * sy,
              width = child.defaultView.innerWidth,
              height = child.defaultView.innerHeight;
            const viewport = { x, y, width: width * sx, height: height * sy };
            let clip = viewport;
            if (parent.clip) {
              const left = Math.max(x, parent.clip.x),
                top = Math.max(y, parent.clip.y);
              clip = {
                x: left,
                y: top,
                width: Math.max(
                  0,
                  Math.min(x + viewport.width, parent.clip.x + parent.clip.width) - left,
                ),
                height: Math.max(
                  0,
                  Math.min(y + viewport.height, parent.clip.y + parent.clip.height) - top,
                ),
              };
            }
            contexts.set(child, {
              x,
              y,
              sx,
              sy,
              clip,
              frames: [
                ...parent.frames,
                { selector: node.locator.selector, url: child.location.href },
              ],
            });
            node.kind = 'element';
            node.frame = { ...node.frame, mode: 'dom', url: child.location.href };
            clone.style.overflow = 'hidden';
            if (clone.style.display === 'inline') clone.style.display = 'inline-block';
            const viewportElement = doc.createElement('div'),
              content = doc.createElement('div');
            viewportElement.style.cssText = `position:relative;width:${width}px;height:${height}px;overflow:hidden;transform:translateZ(0);background:${canvasBackground(child)}`;
            content.style.cssText = `position:relative;width:${width}px;transform:translate(${-child.defaultView.scrollX}px,${-child.defaultView.scrollY}px)`;
            const body = cloneElement(child.body, node.id),
              bodyBox = doc.createElement('div');
            for (const attr of [...body.attributes]) bodyBox.setAttribute(attr.name, attr.value);
            bodyBox.append(...body.childNodes);
            content.append(bodyBox);
            viewportElement.append(content);
            clone.append(viewportElement);
            return clone;
          }
        }
      }
      if (raster) {
        let data;
        try {
          const canvas = source.tagName === 'CANVAS' ? source : doc.createElement('canvas');
          // Prefer the raw frame: a composited screenshot can bake HTML text
          // and gradients over the video and duplicate those editable overlays.
          if (source.tagName === 'VIDEO') {
            canvas.width = source.videoWidth;
            canvas.height = source.videoHeight;
            canvas.getContext('2d').drawImage(source, 0, 0);
          }
          if (source.tagName !== 'IFRAME') data = canvas.toDataURL('image/png');
        } catch {}
        clone.style.overflow = 'hidden';
        if (data && data !== 'data:,') {
          const image = doc.createElement('img');
          image.src = data;
          image.style.cssText = 'width:100%;height:100%;object-fit:fill;display:block';
          if (source.tagName === 'VIDEO') {
            const style = source.ownerDocument.defaultView.getComputedStyle(source);
            image.style.objectFit = style.objectFit;
            image.style.objectPosition = style.objectPosition;
          }
          clone.append(image);
        } else {
          clone.textContent =
            source.tagName === 'IFRAME'
              ? 'iframe 이미지 · 보이는 영역을 가져옵니다'
              : '이미지로 가져오지 못한 ' + source.localName;
          clone.style.background = '#f2f4f7';
          clone.style.color = '#667085';
        }
        warnings.push({
          type: 'raster',
          id: node.id,
          message:
            source.localName +
            ' 영역은 한 개의 레이어입니다. 내부 개체는 분리되지 않습니다.' +
            (source.tagName === 'VIDEO'
              ? ' 영상은 수집 시점의 정지 이미지이며 다른 촬영 시점과 다를 수 있습니다.'
              : ''),
        });
        return clone;
      }
      if (source.tagName === 'IMG') {
        const url = absolute(source.currentSrc || source.src, source.ownerDocument.baseURI),
          cached = options.assetData?.[url],
          data =
            cached &&
            completeImageData(cached, win) &&
            /^data:image\/(?:jpeg|jpg|png|avif);/.test(cached)
              ? cached
              : imageData(source, doc);
        clone.src = data || url;
        clone.removeAttribute('srcset');
        clone.loading = 'eager';
        const computed = source.ownerDocument.defaultView.getComputedStyle(source),
          px = (key) => parseFloat(computed.getPropertyValue(key)) || 0,
          bx = px('border-left-width') + px('padding-left'),
          by = px('border-top-width') + px('padding-top'),
          right = px('border-right-width') + px('padding-right'),
          bottom = px('border-bottom-width') + px('padding-bottom');
        const sx = node.rect.width / (source.offsetWidth || node.rect.width || 1),
          sy = node.rect.height / (source.offsetHeight || node.rect.height || 1);
        node.image = {
          mode: data ? 'embedded' : 'screenshot',
          url,
          contentRect: {
            x: node.rect.x + bx * sx,
            y: node.rect.y + by * sy,
            width: Math.max(0, node.rect.width - (bx + right) * sx),
            height: Math.max(0, node.rect.height - (by + bottom) * sy),
          },
        };
        imageJobs.push({ node, clone, url, data });
        if (/^https?:/.test(url)) assets.add(url);
      }
      if (source.tagName === 'INPUT') {
        clone.setAttribute('value', source.type === 'password' ? '' : source.value);
        if (source.checked) clone.setAttribute('checked', '');
        else clone.removeAttribute('checked');
        if (source.type === 'image') clone.setAttribute('type', 'button');
      }
      if (source.tagName === 'TEXTAREA') {
        clone.textContent = source.value;
        return clone;
      }
      if (source.tagName === 'OPTION') {
        clone.selected = source.selected;
        if (source.selected) clone.setAttribute('selected', '');
        else clone.removeAttribute('selected');
      }
      if (source.tagName === 'BUTTON') clone.type = 'button';
      if (source.tagName === 'A') clone.removeAttribute('href');
      const assigned =
        source.localName === 'slot' ? source.assignedNodes?.({ flatten: true }) : null;
      const children = assigned?.length
        ? assigned
        : closedShadow
          ? closedShadow.childNodes
          : source.childNodes;
      for (const child of children) {
        if (child.nodeType === 3) clone.append(textNode(child, node.id));
        else if (child.nodeType === 1) {
          const result = cloneElement(child, node.id);
          if (result) clone.append(result);
        }
      }
      if (closedShadow)
        warnings.push({
          type: 'shadow',
          id: node.id,
          message: 'Shadow DOM을 펼쳐 가져왔습니다. 슬롯 표현은 원본과 다를 수 있습니다.',
        });
      pseudo(source, clone, node.id, 'before');
      pseudo(source, clone, node.id, 'after');
      return clone;
    }
    const clonedBody = cloneElement(doc.body, null);
    const rootStyle = styles(doc.documentElement).css;
    let fonts = [...extraFonts, ...(options.fontCss || [])].join('\n');
    function fontRules(sheet, base) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        return;
      }
      for (const rule of rules) {
        if (isFontRule(rule))
          fonts +=
            rule.cssText.replace(/url\(["']?(.*?)["']?\)/g, (all, url) => {
              const full = absolute(url, sheet.href || base);
              if (/^https?:/.test(full)) assets.add(full);
              return 'url("' + full.replace(/"/g, '%22') + '")';
            }) + '\n';
        if (rule.styleSheet) fontRules(rule.styleSheet, base);
        else if (
          rule.cssRules &&
          (!(rule instanceof win.CSSMediaRule) || win.matchMedia(rule.conditionText).matches) &&
          (!(rule instanceof win.CSSSupportsRule) || win.CSS.supports(rule.conditionText))
        )
          fontRules({ cssRules: rule.cssRules, href: sheet.href }, base);
      }
    }
    for (const owner of contexts.keys())
      for (const sheet of owner.styleSheets) fontRules(sheet, owner.baseURI);
    const width = Math.max(sourceWidth, doc.documentElement.scrollWidth),
      height = Math.max(sourceHeight, (doc.scrollingElement || doc.documentElement).scrollHeight);
    const policy =
      "default-src 'none'; script-src 'none'; img-src data: blob: https: http:; style-src 'unsafe-inline'; font-src data: https: http:; frame-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none';";
    // Embed resources when the source page can read them. Unreadable cross-origin URLs remain explicit.
    const assetResults = await Promise.all(
      [
        ...new Set([
          ...[...fonts.matchAll(/url\(["']?([^)'"\s]+)["']?\)/g)]
            .map((m) => m[1])
            .filter((url) => /^https?:/.test(url)),
          ...assets,
        ]),
      ]
        .slice(0, 180)
        .map(async (url) => {
          try {
            const data = await deadline(
              (async () => {
                if (options.assetData?.[url]) return options.assetData[url];
                if (resourceCache.has(url)) return resourceCache.get(url);
                if (options.fetchAssets === false) return null;
                const response = await win.fetch(url, { credentials: 'same-origin' });
                if (!response.ok) return null;
                let blob = await response.blob();
                if (blob.size > 5_000_000) return null;
                const magic = String.fromCharCode(
                  ...new Uint8Array(await blob.slice(0, 4).arrayBuffer()),
                );
                if (
                  magic === 'wOF2' ||
                  magic === 'wOFF' ||
                  magic === 'OTTO' ||
                  magic === '\u0000\u0001\u0000\u0000'
                )
                  blob = new win.Blob([blob], {
                    type:
                      magic === 'wOF2' ? 'font/woff2' : magic === 'wOFF' ? 'font/woff' : 'font/ttf',
                  });
                if (
                  !/^(image\/|font\/|application\/(font|x-font|octet-stream)|binary\/octet-stream)/.test(
                    blob.type,
                  )
                )
                  return null;
                return await new Promise((resolve) => {
                  const reader = new win.FileReader();
                  reader.onload = () => resolve(reader.result);
                  reader.onerror = () => resolve(null);
                  reader.readAsDataURL(
                    blob.type === 'binary/octet-stream'
                      ? new win.Blob([blob], {
                          type: new URL(url).pathname.endsWith('.woff2')
                            ? 'font/woff2'
                            : new URL(url).pathname.endsWith('.woff')
                              ? 'font/woff'
                              : 'application/octet-stream',
                        })
                      : blob,
                  );
                });
              })(),
              1800,
            );
            return { url, data };
          } catch {
            return { url, data: null };
          }
        }),
    );
    const available = new Map([
      ...resourceCache,
      ...Object.entries(options.assetData || {}),
      ...assetResults.filter((r) => r.data).map((r) => [r.url, r.data]),
    ]);
    for (const [url, data] of available) if (!completeImageData(data, win)) available.delete(url);
    let cacheSize = 0;
    resourceCache.clear();
    for (const [url, data] of available)
      if (typeof data === 'string' && cacheSize + data.length <= 35_000_000) {
        resourceCache.set(url, data);
        cacheSize += data.length;
      }
    for (const job of imageJobs) {
      const original = available.get(job.url);
      // Keep the original compressed photo when available. Re-encoding every
      // readable JPEG/WebP as PNG can exceed the document budget manyfold.
      const candidate =
        original && !/^data:image\/(?:svg\+xml|gif);/.test(original)
          ? original
          : job.data || original;
      let staticWebp = false;
      if (typeof candidate === 'string' && /^data:image\/webp;base64,/.test(candidate)) {
        try {
          const header = win.atob(candidate.split(',')[1].slice(0, 44));
          staticWebp =
            header.slice(0, 4) === 'RIFF' &&
            header.slice(8, 12) === 'WEBP' &&
            (header.slice(12, 16) !== 'VP8X' ||
              (header.length > 20 && !(header.charCodeAt(20) & 2)));
        } catch {}
      }
      const data =
        typeof candidate === 'string' &&
        candidate.startsWith('data:image/') &&
        !/^data:image\/gif;/.test(candidate) &&
        (!/^data:image\/webp;/.test(candidate) || staticWebp)
          ? candidate
          : null;
      if (data) {
        job.clone.src = data;
        job.node.image.mode = 'embedded';
      } else {
        job.node.image.mode = 'screenshot';
        job.clone.src = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
        job.clone.dataset.uicImageFallback = 'screenshot';
      }
    }
    // The same face is often declared in the main document and many frames.
    // Canonicalize embedded sources before deduplicating, avoiding dozens of
    // repeated copies of the same large font in the immutable document.
    function embedUrls(text) {
      const replacements = new Map();
      for (const [url, data] of available)
        if (data) {
          replacements.set(url, data);
          replacements.set(esc(url), data);
        }
      if (!replacements.size) return text;
      const pattern = [...replacements.keys()]
        .sort((a, b) => b.length - a.length)
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
      return text.replace(new RegExp(pattern, 'g'), (url) => replacements.get(url));
    }
    fonts = embedUrls(fonts);
    try {
      const sheet = new win.CSSStyleSheet();
      sheet.replaceSync(fonts);
      for (const rule of sheet.cssRules) {
        if (rule.type !== 5) continue;
        const embedded = rule.style
          .getPropertyValue('src')
          .match(/url\(\s*["']?(data:[^"')\s]+)["']?\s*\)/);
        if (embedded) rule.style.setProperty('src', 'url("' + embedded[1] + '")');
      }
      fonts = [...new Set([...sheet.cssRules].map((rule) => rule.cssText))].join('\n');
    } catch {}
    // Inline sprite URLs repeat on many elements. Store their bytes once per
    // captured subtree; inherited CSS variables survive offline frame merging.
    const sharedImages = new Map(),
      resourcePrefix = '--uic-asset-' + crypto.randomUUID().slice(0, 8) + '-';
    for (const element of [clonedBody, ...clonedBody.querySelectorAll('[style]')]) {
      for (const property of [...element.style]) {
        if (property.startsWith('--')) continue;
        const before = element.style.getPropertyValue(property);
        const after = before.replace(/url\(\s*(["']?)(.*?)\1\s*\)/g, (all, quote, url) => {
          const data = available.get(url) || url;
          if (!data.startsWith('data:') || data.length < 1000) return all;
          if (!sharedImages.has(data)) sharedImages.set(data, resourcePrefix + sharedImages.size);
          return 'var(' + sharedImages.get(data) + ')';
        });
        if (after !== before)
          element.style.setProperty(property, after, element.style.getPropertyPriority(property));
      }
    }
    for (const [data, name] of sharedImages)
      clonedBody.style.setProperty(name, 'url("' + data + '")');
    const byId = new Map(nodes.map((node) => [node.id, node]));
    for (const element of clonedBody.querySelectorAll('[data-uic-id]')) {
      const node = byId.get(element.dataset.uicId);
      if (
        !node ||
        node.kind === 'raster' ||
        node.tag === 'img' ||
        element.children.length ||
        element.textContent.trim()
      )
        continue;
      const paint = [
        element.style.backgroundImage,
        element.style.maskImage,
        element.style.webkitMaskImage,
      ].join(' ');
      if (/url\(\s*["']?https?:/i.test(paint)) node.background = { mode: 'screenshot' };
    }
    let html =
      '<!doctype html><html lang="' +
      esc(doc.documentElement.lang || '') +
      '" dir="' +
      esc(doc.documentElement.dir || '') +
      '" style="' +
      esc(rootStyle) +
      '"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' +
      esc(policy) +
      '"><style>html{margin:0;padding:0;overflow:visible!important;min-height:100%;background:' +
      win.getComputedStyle(doc.documentElement).backgroundColor +
      '}body{overflow:visible!important}*{animation:none!important;transition:none!important}[data-uic-text]{display:contents}' +
      fonts +
      '</style></head>' +
      clonedBody.outerHTML +
      '</html>';
    html = embedUrls(html);
    const unresolved = assetResults.filter((item) => !item.data).map((item) => item.url);
    if (unresolved.length)
      warnings.push({
        type: 'assets',
        message:
          '외부 리소스 ' +
          unresolved.length +
          '개는 원래 주소를 참조합니다. 오프라인에서 일부 이미지·폰트가 달라질 수 있습니다.',
        urls: unresolved,
      });
    if (assets.size > 180)
      warnings.push({ type: 'assets', message: '180개를 넘는 리소스는 원래 주소를 참조합니다.' });
    const id =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) =>
            value.toString(16).padStart(2, '0'),
          ).join('');
    return {
      format: 'console-canvas-snapshot',
      version: VERSION,
      id,
      capturedAt: new Date().toISOString(),
      source: {
        url: sourceUrl,
        title: doc.title,
        viewport: { width: sourceWidth, height: sourceHeight },
        scroll: { x: scrollX, y: scrollY },
        width: Math.ceil(width),
        height: Math.ceil(height),
        background: canvasBackground(doc),
        rootStyle,
      },
      html,
      nodes,
      warnings,
      screenshot: null,
    };
  }
  function matchesView(doc, source) {
    const win = doc.defaultView;
    return (
      doc.location.href === source.url &&
      win.innerWidth === source.viewport.width &&
      win.innerHeight === source.viewport.height &&
      win.scrollX === source.scroll.x &&
      win.scrollY === source.scroll.y
    );
  }
  async function settleVisibleMedia(doc = document, timeout = 800) {
    const win = doc.defaultView,
      jobs = [],
      urls = new Set();
    for (const element of [...doc.querySelectorAll('*')].slice(0, 15000)) {
      const r = element.getBoundingClientRect();
      if (
        !r.width ||
        !r.height ||
        r.bottom <= 0 ||
        r.top >= win.innerHeight ||
        r.right <= 0 ||
        r.left >= win.innerWidth
      )
        continue;
      if (element.localName === 'img') jobs.push(element.decode().catch(() => {}));
      for (const pseudo of [null, '::before', '::after'])
        for (const match of win
          .getComputedStyle(element, pseudo)
          .backgroundImage.matchAll(/url\(["']?([^)'"\s]+)["']?\)/g))
          urls.add(absolute(match[1], doc.baseURI));
    }
    for (const url of urls) {
      const image = new win.Image();
      image.src = url;
      jobs.push(image.decode().catch(() => {}));
    }
    await deadline(Promise.all(jobs), timeout);
    await deadline(
      new Promise((r) => win.requestAnimationFrame(() => win.requestAnimationFrame(r))),
      250,
    );
  }
  let surfaceStop = () => {},
    surfaceChanged = false;
  function watchSurface(doc = document) {
    surfaceStop();
    surfaceChanged = false;
    const win = doc.defaultView;
    const onAnimation = (event) => {
      const el = event.target;
      if (!el?.getBoundingClientRect) return;
      const rect = el.getBoundingClientRect(),
        css = win.getComputedStyle(el);
      if (
        rect.width * rect.height > win.innerWidth * win.innerHeight * 0.6 &&
        !['fixed', 'absolute'].includes(css.position)
      )
        surfaceChanged = true;
    };
    doc.addEventListener('animationstart', onAnimation, true);
    doc.addEventListener('transitionrun', onAnimation, true);
    surfaceStop = () => {
      doc.removeEventListener('animationstart', onAnimation, true);
      doc.removeEventListener('transitionrun', onAnimation, true);
    };
  }
  function fingerprint(doc = document) {
    const view = doc.defaultView;
    // A loaded image/font or CSS entrance animation can change the rendered
    // frame without changing outerHTML. Such a frame must use its photographed
    // pixels rather than combine a different visual state with the parent.
    const visual = [...doc.querySelectorAll('*')]
      .slice(0, 15000)
      .map((element) => {
        const style = view.getComputedStyle(element),
          r = element.getBoundingClientRect();
        return (
          [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 100) / 100).join(',') +
          '|' +
          [
            style.display,
            style.visibility,
            style.opacity,
            style.transform,
            style.backgroundImage,
            style.fontFamily,
            style.fontSize,
          ].join('|') +
          (element.localName === 'img'
            ? '|' + element.complete + ',' + element.naturalWidth + ',' + element.currentSrc
            : '')
        );
      })
      .join('\n');
    const html = doc.documentElement.outerHTML + '\n' + doc.fonts.status + '\n' + visual;
    let hash = 2166136261;
    for (let i = 0; i < html.length; i++) hash = Math.imul(hash ^ html.charCodeAt(i), 16777619);
    return html.length + ':' + (hash >>> 0);
  }
  function collectAssets(doc = document) {
    const urls = new Set(),
      win = doc.defaultView;
    for (const element of [...doc.querySelectorAll('*')].slice(0, 15000))
      for (const pseudo of [null, '::before', '::after']) {
        const style = win.getComputedStyle(element, pseudo);
        for (const key of [
          'background-image',
          'mask-image',
          '-webkit-mask-image',
          'border-image-source',
          'list-style-image',
        ])
          for (const match of style
            .getPropertyValue(key)
            .matchAll(/url\(["']?([^)'"\s]+)["']?\)/g)) {
            const url = absolute(match[1], doc.baseURI);
            if (/^https?:/.test(url)) urls.add(url);
          }
      }
    return [...urls].slice(0, 180);
  }
  function anchorElement(doc, anchor) {
    let element;
    try {
      element = doc.querySelector(anchor.selector);
    } catch {}
    if (
      element &&
      (element.currentSrc ||
        element.textContent.trim().slice(0, 80) ||
        element.id ||
        element.getAttribute('src') ||
        '') === anchor.key
    )
      return element;
    if (anchor.tag === 'img') {
      const images = [...doc.images].filter((i) => i.currentSrc === anchor.key);
      if (images.length === 1) return images[0];
    }
    return null;
  }
  function anchors(doc = document) {
    const win = doc.defaultView;
    function selector(element) {
      const parts = [];
      for (let e = element; e && e.nodeType === 1; e = e.parentElement) {
        if (e.id && doc.querySelectorAll('[id="' + win.CSS.escape(e.id) + '"]').length === 1) {
          parts.unshift('#' + win.CSS.escape(e.id));
          break;
        }
        const peers = [...(e.parentElement?.children || [])].filter(
          (n) => n.localName === e.localName,
        );
        parts.unshift(e.localName + ':nth-of-type(' + (peers.indexOf(e) + 1) + ')');
      }
      return parts.join(' > ');
    }
    return [...doc.querySelectorAll('img,iframe,h1,h2,h3,p,button')]
      .map((e) => {
        const r = e.getBoundingClientRect();
        if (
          r.width < 60 ||
          r.height < 16 ||
          r.bottom < 100 ||
          r.top > win.innerHeight - 40 ||
          r.right < 0 ||
          r.left > win.innerWidth
        )
          return null;
        for (let p = e; p && p !== doc.documentElement; p = p.parentElement)
          if (['fixed', 'sticky'].includes(win.getComputedStyle(p).position)) return null;
        const key =
          e.currentSrc || e.textContent.trim().slice(0, 80) || e.id || e.getAttribute('src');
        return key
          ? {
              selector: selector(e),
              key,
              tag: e.localName,
              x: r.x + win.scrollX,
              y: r.y + win.scrollY,
              area: r.width * r.height,
            }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.area - a.area)
      .slice(0, 8);
  }
  function headerInset(doc = document) {
    const win = doc.defaultView;
    return Math.min(
      Math.min(200, win.innerHeight * 0.4),
      Math.max(
        0,
        ...[
          ...doc.querySelectorAll('header,nav,[role="banner"],[class*="header"],[class*="nav"]'),
        ].map((e) => {
          const r = e.getBoundingClientRect(),
            p = win.getComputedStyle(e).position;
          for (let ancestor = e; ancestor; ancestor = ancestor.parentElement) {
            const style = win.getComputedStyle(ancestor);
            if (
              style.display === 'none' ||
              style.visibility === 'hidden' ||
              parseFloat(style.opacity) === 0
            )
              return 0;
          }
          return ['fixed', 'sticky'].includes(p) &&
            r.top <= 1 &&
            r.bottom > 0 &&
            r.width > win.innerWidth * 0.6
            ? r.bottom
            : 0;
        }),
      ),
    );
  }
  function alignAnchors(doc, groups) {
    const win = doc.defaultView;
    return groups.map((group) => {
      const deltas = group
        .map((anchor) => {
          const e = anchorElement(doc, anchor);
          if (!e) return null;
          const r = e.getBoundingClientRect();
          return {
            x: anchor.x,
            dx: r.x + win.scrollX - anchor.x,
            dy: r.y + win.scrollY - anchor.y,
          };
        })
        .filter(Boolean);
      const stationary = deltas.filter((d) => Math.abs(d.dx) < 2);
      if (!stationary.length) return null;
      // A separately sticky/right ad column must not move the whole page.
      // Prefer the leftmost visible flow and require a strict local majority.
      const left = Math.min(...stationary.map((d) => d.x));
      const flow = stationary.filter((d) => d.x <= left + win.innerWidth * 0.25);
      const dy = [...flow].sort((a, b) => a.dy - b.dy)[Math.floor(flow.length / 2)].dy;
      return flow.filter((d) => Math.abs(d.dy - dy) < 2).length > flow.length / 2
        ? { dx: 0, dy }
        : null;
    });
  }
  globalThis.UICloneCapture = {
    capture,
    matchesView,
    settleVisibleMedia,
    fingerprint,
    anchors,
    headerInset,
    alignAnchors,
    collectAssets,
    watchSurface,
    surfaceChanged: () => surfaceChanged,
    stopSurfaceWatch: () => surfaceStop(),
    version: VERSION,
    registerShadow: (root) => {
      if (root?.host) registeredShadows.set(root.host, root);
    },
    frameIndex,
    frames: frameElements,
  };
})();
