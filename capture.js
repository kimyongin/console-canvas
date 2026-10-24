/* Runs in an isolated extension world. The source page is read, never modified. */
(() => {
  'use strict';
  const VERSION = 1;
  const PROPS =
    `display position top right bottom left z-index float clear box-sizing width height min-width min-height max-width max-height
    margin-top margin-right margin-bottom margin-left padding-top padding-right padding-bottom padding-left
    border-top-width border-right-width border-bottom-width border-left-width border-top-style border-right-style border-bottom-style border-left-style
    border-top-color border-right-color border-bottom-color border-left-color border-top-left-radius border-top-right-radius border-bottom-left-radius border-bottom-right-radius
    border-collapse border-spacing table-layout caption-side empty-cells vertical-align
    color background-color background-image background-size background-position background-repeat background-origin background-clip background-attachment
    font-family font-size font-weight font-style font-stretch font-variant font-feature-settings font-kerning line-height letter-spacing word-spacing
    text-align text-align-last text-decoration text-transform text-indent text-overflow text-shadow text-rendering white-space word-break overflow-wrap direction writing-mode
    opacity visibility overflow-x overflow-y clip clip-path box-shadow filter backdrop-filter mix-blend-mode isolation
    transform transform-origin perspective object-fit object-position aspect-ratio appearance accent-color outline outline-offset
    flex-direction flex-wrap flex-grow flex-shrink flex-basis justify-content align-items align-self align-content order gap row-gap column-gap
    grid-template-columns grid-template-rows grid-template-areas grid-auto-columns grid-auto-rows grid-auto-flow grid-column-start grid-column-end grid-row-start grid-row-end
    justify-items justify-self list-style-type list-style-position list-style-image fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-opacity
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
    if (!doc.body || !win)
      throw new Error('아직 화면이 준비되지 않았습니다. 로딩 후 다시 가져와 주세요.');
    const sourceUrl = doc.location.href;
    const sourceWidth = win.innerWidth,
      sourceHeight = win.innerHeight;
    const scrollX = win.scrollX,
      scrollY = win.scrollY;
    const nodes = [],
      warnings = [],
      assets = new Set(),
      imageJobs = [];
    let counter = 0,
      traversed = 0;
    const maxElements = options.maxElements || 15000;
    const bounds = (element) => {
      const r = element.getBoundingClientRect();
      return {
        x: Math.round((r.left + scrollX) * 100) / 100,
        y: Math.round((r.top + scrollY) * 100) / 100,
        width: Math.round(r.width * 100) / 100,
        height: Math.round(r.height * 100) / 100,
      };
    };
    function styles(element, pseudo) {
      const result = doc.createElement('span').style,
        computed = win.getComputedStyle(element, pseudo);
      for (const property of PROPS) {
        const value = computed.getPropertyValue(property);
        if (value) result.setProperty(property, value);
        for (const match of value.matchAll(/url\(["']?(.*?)["']?\)/g)) {
          const url = absolute(match[1], sourceUrl);
          if (/^https?:/.test(url)) assets.add(url);
        }
      }
      result.setProperty('animation', 'none', 'important');
      result.setProperty('transition', 'none', 'important');
      result.setProperty('caret-color', 'transparent');
      result.setProperty('scroll-behavior', 'auto');
      return { css: result.cssText, computed };
    }
    function locator(element) {
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
      return {
        selector: parts.join(' > ') || 'body',
        id: element.id || null,
        role: element.getAttribute('role'),
        label: element.getAttribute('aria-label'),
        text: short(element.textContent),
      };
    }
    function record(element, parentId, kind = 'element', extra = {}) {
      const id = 'n' + ++counter,
        computed = win.getComputedStyle(element),
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
      nodes.push(node);
      return node;
    }
    function textNode(source, parentId) {
      const text = source.textContent;
      if (!text.trim()) return doc.createTextNode(text);
      const parent = source.parentElement;
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
        rect: { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height },
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
      if (!text && !(parseFloat(computed.width) > 0 && parseFloat(computed.height) > 0)) return;
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
        closedShadow = source.shadowRoot;
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
      if (raster) {
        let data;
        try {
          const canvas = source.tagName === 'CANVAS' ? source : doc.createElement('canvas');
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
          clone.append(image);
        } else {
          clone.textContent =
            source.tagName === 'IFRAME'
              ? '삽입된 외부 화면'
              : '이미지로 가져오지 못한 ' + source.localName;
          clone.style.background = '#f2f4f7';
          clone.style.color = '#667085';
        }
        warnings.push({
          type: 'raster',
          id: node.id,
          message:
            source.localName + ' 영역은 한 개의 레이어입니다. 내부 개체는 분리되지 않습니다.',
        });
        return clone;
      }
      if (source.tagName === 'IMG') {
        const data = imageData(source, doc),
          url = absolute(source.currentSrc || source.src, sourceUrl);
        clone.src = data || url;
        clone.removeAttribute('srcset');
        clone.loading = 'eager';
        if (!data && /^https?:/.test(url)) assets.add(url);
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
      const children = closedShadow ? closedShadow.childNodes : source.childNodes;
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
    let fonts = '';
    function fontRules(sheet) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        return;
      }
      for (const rule of rules) {
        if (rule.type === 5)
          fonts +=
            rule.cssText.replace(/url\(["']?(.*?)["']?\)/g, (all, url) => {
              const full = absolute(url, sheet.href || sourceUrl);
              if (/^https?:/.test(full)) assets.add(full);
              return 'url("' + full.replace(/"/g, '%22') + '")';
            }) + '\n';
        if (rule.styleSheet) fontRules(rule.styleSheet);
      }
    }
    for (const sheet of doc.styleSheets) fontRules(sheet);
    const width = Math.max(sourceWidth, doc.documentElement.scrollWidth),
      height = Math.max(sourceHeight, doc.documentElement.scrollHeight, doc.body.scrollHeight);
    const policy =
      "default-src 'none'; script-src 'none'; img-src data: blob: https: http:; style-src 'unsafe-inline'; font-src data: https: http:; frame-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none';";
    let html =
      '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' +
      esc(policy) +
      '"><style>html{margin:0;padding:0;overflow:visible!important;min-height:100%;background:' +
      win.getComputedStyle(doc.documentElement).backgroundColor +
      '}body{overflow:visible!important}*{animation:none!important;transition:none!important}[data-uic-text]{display:contents}' +
      fonts +
      '</style></head>' +
      clonedBody.outerHTML +
      '</html>';
    // Embed resources when the source page can read them. Unreadable cross-origin URLs remain explicit.
    const assetResults = await Promise.all(
      [...assets].slice(0, 100).map(async (url) => {
        try {
          const data = await deadline(
            (async () => {
              const response = await win.fetch(url, { credentials: 'same-origin' });
              if (!response.ok) return null;
              const blob = await response.blob();
              if (blob.size > 5_000_000) return null;
              if (!/^(image\/|font\/|application\/(font|x-font|octet-stream))/.test(blob.type))
                return null;
              return await new Promise((resolve) => {
                const reader = new win.FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => resolve(null);
                reader.readAsDataURL(blob);
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
    for (const { url, data } of assetResults)
      if (data) {
        html = html.split(esc(url)).join(data);
        html = html.split(url).join(data);
      }
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
    if (assets.size > 100)
      warnings.push({ type: 'assets', message: '100개를 넘는 리소스는 원래 주소를 참조합니다.' });
    const maxRight = Math.max(
      width,
      ...nodes.filter((node) => node.visible).map((node) => node.rect.x + node.rect.width),
    );
    const maxBottom = Math.max(
      height,
      ...nodes.filter((node) => node.visible).map((node) => node.rect.y + node.rect.height),
    );
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
        width: Math.ceil(maxRight),
        height: Math.ceil(maxBottom),
      },
      html,
      nodes,
      warnings,
      screenshot: null,
    };
  }
  globalThis.UICloneCapture = { capture, version: VERSION };
})();
