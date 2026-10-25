import { selectionRoots, alignmentOperations, snapDelta } from './selection-tools.js';
import { expandCopyNodes } from './copy-model.js';
import { indexNodes } from './node-index.js';
import {
  cleanEdits,
  cleanComments,
  pointTarget,
  EDIT_LIMITS,
  prepareEdits,
} from './edit-commands.js';
export { cleanEdits, cleanComments } from './edit-commands.js';
export const copy = (value) => JSON.parse(JSON.stringify(value));
const POLICY =
  "default-src 'none'; script-src 'none'; img-src data: blob: https: http:; style-src 'unsafe-inline'; font-src data: https: http:; frame-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none';";
export function validateSnapshot(value) {
  if (
    !value ||
    value.format !== 'console-canvas-snapshot' ||
    value.version !== 1 ||
    typeof value.html !== 'string' ||
    !Array.isArray(value.nodes)
  )
    throw new Error('Console Canvas에서 가져온 화면 파일이 아닙니다.');
  if (value.html.length > 60_000_000 || value.nodes.length > 40000)
    throw new Error('화면 파일이 너무 큽니다.');
  if (
    !value.source ||
    !Number.isFinite(value.source.width) ||
    !Number.isFinite(value.source.height) ||
    value.source.width < 1 ||
    value.source.height < 1 ||
    value.source.width > 60000 ||
    value.source.height > 200000
  )
    throw new Error('화면 크기 정보가 올바르지 않습니다.');
  if (
    !value.source.viewport ||
    !Number.isFinite(value.source.viewport.width) ||
    !Number.isFinite(value.source.viewport.height)
  )
    throw new Error('원본 화면의 표시 크기가 올바르지 않습니다.');
  if (!Array.isArray(value.warnings)) value.warnings = [];
  const ids = new Set();
  for (const node of value.nodes) {
    if (
      !/^n\d+$/.test(node.id) ||
      ids.has(node.id) ||
      !node.rect ||
      !['x', 'y', 'width', 'height'].every((k) => Number.isFinite(node.rect[k]))
    )
      throw new Error('요소 정보가 올바르지 않습니다.');
    ids.add(node.id);
  }
  const parents = new Map(value.nodes.map((n) => [n.id, n.parentId]));
  for (const node of value.nodes) {
    const visited = new Set([node.id]);
    let id = node.parentId;
    while (id) {
      if (!ids.has(id) || visited.has(id)) throw new Error('요소의 상위 구조가 올바르지 않습니다.');
      visited.add(id);
      id = parents.get(id);
    }
  }
  return value;
}
export function sanitizeHtml(html) {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed
    .querySelectorAll(
      'script,base,link,iframe,object,embed,foreignObject,animate,animateMotion,animateTransform,set,meta[http-equiv]',
    )
    .forEach((el) => el.remove());
  for (const element of parsed.querySelectorAll('*'))
    for (const attr of [...element.attributes]) {
      if (
        /^on/i.test(attr.name) ||
        ['srcdoc', 'action', 'formaction', 'target', 'autofocus', 'autoplay'].includes(attr.name)
      )
        element.removeAttribute(attr.name);
      if (['href', 'xlink:href'].includes(attr.name) && !attr.value.startsWith('#'))
        element.removeAttribute(attr.name);
      if (
        ['src', 'poster'].includes(attr.name) &&
        !/^(https?:|data:image\/|blob:)/i.test(attr.value)
      )
        element.removeAttribute(attr.name);
    }
  const policy = parsed.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = POLICY;
  parsed.head.prepend(policy);
  return '<!doctype html>' + parsed.documentElement.outerHTML;
}
export class CanvasScene {
  constructor(frame, snapshot, callbacks = {}) {
    validateSnapshot(snapshot);
    this.frame = frame;
    this.snapshot = snapshot;
    this.callbacks = callbacks;
    this.nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
    this.originalNodes = new Map(this.nodes);
    this.copySignature = '{}';
    Object.assign(this, indexNodes(snapshot.nodes));
    this.edits = {};
    this.annotations = {};
    this.interactionMode = 'edit';
    this.elements = new Map();
    this.lifts = new Map();
    this.selected = null;
    this.selection = new Set();
    this.selectionOutlines = [];
    this.snapEnabled = false;
    this.drag = null;
    this.commentMarkers = new Map();
    this.displayScale = 1;
  }
  async mount() {
    this.frame.width = Math.max(this.snapshot.source.width, this.snapshot.source.viewport.width);
    this.frame.height = this.snapshot.source.height;
    const loaded = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('복제 화면을 여는 시간이 초과되었습니다.')),
        15000,
      );
      this.frame.onload = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    this.frame.srcdoc = sanitizeHtml(this.snapshot.html);
    await loaded;
    this.doc = this.frame.contentDocument;
    if (!this.doc?.body) throw new Error('복제 화면에 접근할 수 없습니다.');
    await Promise.race([this.doc.fonts.ready, new Promise((resolve) => setTimeout(resolve, 1000))]);
    for (const el of this.doc.querySelectorAll('[data-uic-id]')) {
      const id = el.dataset.uicId;
      if (this.nodes.has(id) && !this.elements.has(id)) this.elements.set(id, el);
      else el.removeAttribute('data-uic-id');
    }
    this.defaults = new Map(
      [...this.elements].map(([id, el]) => [
        id,
        {
          visibility: el.style.visibility,
          opacity: el.style.opacity,
          translate: el.style.translate,
        },
      ]),
    );
    for (const node of this.nodes.values())
      if (this.elements.has(node.id)) {
        const el = this.elements.get(node.id);
        el.scrollLeft = node.scroll?.x || 0;
        el.scrollTop = node.scroll?.y || 0;
        if (el.tagName === 'INPUT' && el.type === 'password') el.value = '';
      }
    await this.rasterFallbacks();
    const originalTree = this.doc.documentElement.cloneNode(true);
    this.originalElements = new Map(
      [...originalTree.querySelectorAll('[data-uic-id]')].map((el) => [el.dataset.uicId, el]),
    );
    this.baseRects = new Map([...this.elements.keys()].map((id) => [id, this.rect(id)]));
    for (const node of this.nodes.values())
      if (node.kind === 'pseudo' && this.baseRects.has(node.id))
        node.rect = { ...this.baseRects.get(node.id) };
    this.portal = this.doc.createElement('div');
    this.portal.dataset.uicEditor = 'portal';
    this.portal.style.cssText =
      'position:absolute!important;left:0!important;top:0!important;width:0!important;height:0!important;z-index:2147480000!important;overflow:visible!important';
    this.doc.documentElement.append(this.portal);
    this.outline = this.doc.createElement('div');
    this.outline.dataset.uicEditor = 'selection';
    this.outline.style.cssText =
      'position:absolute!important;pointer-events:none!important;box-sizing:border-box!important;outline:2px solid #5a55d9!important;outline-offset:2px!important;z-index:2147483646!important;display:none';
    this.doc.documentElement.append(this.outline);
    this.groupBox = this.doc.createElement('div');
    this.groupBox.dataset.uicEditor = 'selection-group';
    this.groupBox.style.cssText =
      this.outline.style.cssText +
      ';outline:1px dashed #7771dc!important;outline-offset:7px!important';
    this.groupHandle = this.doc.createElement('button');
    this.groupHandle.type = 'button';
    this.groupHandle.dataset.uicGroupHandle = 'true';
    this.groupHandle.style.cssText =
      'all:initial!important;position:absolute!important;left:0!important;top:-37px!important;display:block!important;pointer-events:auto!important;cursor:move!important;white-space:nowrap!important;background:#5a55d9!important;color:white!important;border-radius:6px!important;padding:6px 10px!important;font:12px/18px system-ui,sans-serif!important;box-shadow:0 2px 8px #302b6630!important';
    this.groupHandle.title = '드래그로 묶음 이동 · 방향키로 미세 이동 · Shift+방향키 10px';
    this.groupBox.append(this.groupHandle);
    this.doc.documentElement.append(this.groupBox);
    this.hover = this.doc.createElement('div');
    this.hover.dataset.uicEditor = 'hover';
    this.hover.style.cssText =
      'position:absolute!important;pointer-events:none!important;box-sizing:border-box!important;outline:1px dashed #7771dc!important;outline-offset:1px!important;z-index:2147483645!important;display:none';
    this.doc.documentElement.append(this.hover);
    this.commentLayer = this.doc.createElement('div');
    this.commentLayer.dataset.uicEditor = 'comment-markers';
    this.commentLayer.style.cssText =
      'position:absolute!important;left:0!important;top:0!important;width:0!important;height:0!important;overflow:visible!important;pointer-events:none!important;z-index:2147483647!important';
    this.doc.documentElement.append(this.commentLayer);
    this.addCommentButton = this.doc.createElement('button');
    this.addCommentButton.dataset.uicEditor = 'add-comment';
    this.addCommentButton.dataset.uicAddComment = 'true';
    this.addCommentButton.innerHTML =
      '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 3h12v10H9l-4 4v-4H4z"/><path d="M7 8h6M10 5v6"/></svg>';
    this.addCommentButton.setAttribute('aria-label', '선택한 위치에 주석 작성');
    this.doc.documentElement.append(this.addCommentButton);
    for (const node of this.nodes.values())
      if (node.position === 'fixed' && node.visible && this.elements.has(node.id))
        this.lift(node.id, node.rect);
    this.doc.addEventListener('pointerdown', (event) => this.begin(event), true);
    this.doc.addEventListener('pointermove', (event) => this.move(event), true);
    this.doc.addEventListener('pointerup', (event) => this.finish(event, false), true);
    this.doc.addEventListener('pointercancel', (event) => this.finish(event, true), true);
    this.doc.addEventListener(
      'lostpointercapture',
      (event) => {
        if (this.drag) this.finish(event, true);
      },
      true,
    );
    this.doc.addEventListener(
      'click',
      (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true,
    );
    this.doc.addEventListener('submit', (event) => event.preventDefault(), true);
    this.doc.addEventListener(
      'keydown',
      (event) => {
        if (
          event.target.closest?.('[data-uic-add-comment]') &&
          ['Enter', ' '].includes(event.key)
        ) {
          event.preventDefault();
          this.callbacks.onCommentSelect?.(
            this.selected || `point:${this.pointComment.x}:${this.pointComment.y}`,
          );
          return;
        }
        const marker = event.target.closest?.('[data-uic-comment]');
        if (marker && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          this.openComment(marker.dataset.uicComment);
          return;
        }
        this.callbacks.onKey?.(event);
        if (!event.ctrlKey && !event.metaKey && event.key !== 'Tab') event.preventDefault();
      },
      true,
    );
    this.doc.addEventListener(
      'focusin',
      (event) => {
        if (!this.drag && !this.areaSelecting) {
          const id = event.target.closest?.('[data-uic-id]')?.dataset.uicId;
          if (id) this.select(id);
        }
      },
      true,
    );
    this.doc.addEventListener('pointerleave', () => {
      this.hover.style.display = 'none';
    });
    this.apply();
    return this;
  }
  async rasterFallbacks() {
    if (!this.snapshot.screenshot) return;
    const image = new Image();
    image.src = this.snapshot.screenshot;
    try {
      await image.decode();
    } catch {
      return;
    }
    const view = this.snapshot.source.viewport,
      scroll = this.snapshot.source.scroll;
    for (const node of this.nodes.values())
      if (node.kind === 'raster') {
        const element = this.elements.get(node.id);
        if (!element || element.querySelector('img')) continue;
        const r = node.rect,
          x = r.x - scroll.x,
          y = r.y - scroll.y;
        if (
          x < 0 ||
          y < 0 ||
          x + r.width > view.width + 1 ||
          y + r.height > view.height + 1 ||
          !r.width ||
          !r.height
        )
          continue;
        const canvas = document.createElement('canvas'),
          ratio = image.width / view.width;
        canvas.width = Math.max(1, Math.round(r.width * ratio));
        canvas.height = Math.max(1, Math.round(r.height * ratio));
        canvas
          .getContext('2d')
          .drawImage(
            image,
            x * ratio,
            y * ratio,
            r.width * ratio,
            r.height * ratio,
            0,
            0,
            canvas.width,
            canvas.height,
          );
        const img = this.doc.createElement('img');
        img.src = canvas.toDataURL();
        img.style.cssText = 'display:block;width:100%;height:100%;object-fit:fill';
        element.replaceChildren(img);
      }
  }
  parent(id) {
    return this.nodes.get(id)?.parentId || null;
  }
  ancestors(id) {
    const result = [];
    for (let p = this.parent(id); p; p = this.parent(p)) result.push(p);
    return result;
  }
  hidden(id) {
    return (
      !!this.nodes.get(id)?.copyHidden ||
      !!this.edits[id]?.deleted ||
      this.ancestors(id).some((p) => this.edits[p]?.deleted || this.nodes.get(p)?.copyHidden)
    );
  }
  offset(id) {
    let x = 0,
      y = 0;
    for (const key of [id, ...this.ancestors(id)]) {
      x += this.edits[key]?.dx || 0;
      y += this.edits[key]?.dy || 0;
    }
    return { x, y };
  }
  rect(id) {
    const el = this.elements.get(id);
    if (!el) return null;
    let rect;
    if (el.hasAttribute('data-uic-text') && !this.lifts.has(id)) {
      const range = this.doc.createRange();
      range.selectNodeContents(el);
      rect = range.getBoundingClientRect();
    } else rect = (this.lifts.get(id)?.wrapper || el).getBoundingClientRect();
    return {
      x: rect.left + this.frame.contentWindow.scrollX,
      y: rect.top + this.frame.contentWindow.scrollY,
      width: rect.width,
      height: rect.height,
    };
  }
  select(id, { additive = false, ids = null } = {}) {
    if (ids) this.selection = new Set(ids.filter((key) => this.elements.has(key)).slice(0, 100));
    else if (additive && this.elements.has(id)) {
      if (this.selection.has(id)) this.selection.delete(id);
      else if (this.selection.size < 100) this.selection.add(id);
      else this.callbacks.onMessage?.('한 번에 100개까지 선택할 수 있습니다.');
    } else this.selection = new Set(this.elements.has(id) ? [id] : []);
    this.selected = this.selection.has(id) ? id : [...this.selection].at(-1) || null;
    this.drawSelection();
    this.callbacks.onSelect?.(this.selected);
  }
  drawSelection() {
    const r = this.selected && !this.hidden(this.selected) ? this.rect(this.selected) : null;
    this.setOutline(this.outline, r);
    for (const outline of this.selectionOutlines) outline.remove();
    this.selectionOutlines = [];
    for (const id of this.selection)
      if (id !== this.selected && !this.hidden(id)) {
        const outline = this.outline.cloneNode();
        outline.dataset.uicEditor = 'multi-selection';
        this.doc.documentElement.append(outline);
        this.setOutline(outline, this.rect(id));
        this.selectionOutlines.push(outline);
      }
    const boxes = this.selectionRoots()
      .filter((id) => !this.hidden(id))
      .map((id) => this.rect(id))
      .filter(Boolean);
    if (this.selection.size > 1 && boxes.length && this.interactionMode === 'edit') {
      const x = Math.min(...boxes.map((r) => r.x)),
        y = Math.min(...boxes.map((r) => r.y));
      this.setOutline(this.groupBox, {
        x,
        y,
        width: Math.max(...boxes.map((r) => r.x + r.width)) - x,
        height: Math.max(...boxes.map((r) => r.y + r.height)) - y,
      });
      this.groupHandle.textContent = '⠿ ' + this.selection.size + '개 이동';
      this.groupHandle.setAttribute('aria-label', '선택한 ' + this.selection.size + '개 요소 이동');
      this.groupHandle.style.setProperty('top', y < 38 ? '8px' : '-37px', 'important');
    } else this.setOutline(this.groupBox, null);
    this.hover.style.display = 'none';
    this.renderCommentMarkers();
  }
  selectionRoots() {
    return selectionRoots(this);
  }
  align(kind) {
    this.commitOperations(alignmentOperations(this, kind));
  }
  targetId(event) {
    let id = event.target.closest?.('[data-uic-id]')?.dataset.uicId;
    if (this.callbacks.smartSelection && !event.altKey && id) {
      const semantic = [id, ...this.ancestors(id)].find((key) =>
        ['button', 'a', 'input', 'select', 'textarea', 'svg'].includes(this.nodes.get(key)?.tag),
      );
      if (semantic) id = semantic;
    }
    return event.shiftKey && id ? this.parent(id) || id : id;
  }
  clearGuides() {
    for (const guide of this.guides || []) guide.remove();
    this.guides = [];
  }
  drawGuides(guides) {
    this.clearGuides();
    for (const guide of guides) {
      const line = this.doc.createElement('div');
      line.dataset.uicEditor = 'guides';
      const vertical = guide.axis === 'x';
      line.style.cssText =
        'position:absolute!important;pointer-events:none!important;background:#d64dc1!important;z-index:2147483647!important;' +
        (vertical
          ? 'width:1px!important;height:' +
            this.snapshot.source.height +
            'px!important;top:0!important;left:' +
            guide.position +
            'px!important'
          : 'height:1px!important;width:' +
            this.snapshot.source.width +
            'px!important;left:0!important;top:' +
            guide.position +
            'px!important');
      this.doc.documentElement.append(line);
      this.guides.push(line);
    }
  }
  setOutline(element, rect) {
    element.style.display = rect && rect.width && rect.height ? 'block' : 'none';
    if (rect) {
      element.style.left = rect.x + 'px';
      element.style.top = rect.y + 'px';
      element.style.width = rect.width + 'px';
      element.style.height = rect.height + 'px';
    }
  }
  lift(id, forcedRect) {
    if (this.lifts.has(id)) return this.lifts.get(id);
    const element = this.elements.get(id),
      node = this.nodes.get(id);
    if (!element) return null;
    if (element === this.doc.body) return null;
    const rect = forcedRect || this.baseRects.get(id) || this.rect(id);
    const base = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    const placeholder = element.cloneNode(false);
    placeholder.removeAttribute('data-uic-id');
    placeholder.setAttribute('data-uic-placeholder', id);
    if (node.kind === 'text') placeholder.textContent = element.textContent;
    placeholder.style.setProperty('visibility', 'hidden', 'important');
    placeholder.style.setProperty('pointer-events', 'none', 'important');
    element.replaceWith(placeholder);
    const originalStyle = element.getAttribute('style') || '';
    if (node.kind === 'text') {
      // A text range inherits typography, never its parent's button padding/background.
      const inherited = this.doc.createElement('span').style;
      inherited.cssText = node.textStyle || '';
      element.style.cssText = '';
      for (const property of inherited)
        if (
          /^(font-|line-height$|letter-spacing$|word-spacing$|text-|white-space$|word-break$|overflow-wrap$|direction$|writing-mode$|color$|-webkit-text-)/.test(
            property,
          )
        )
          element.style.setProperty(
            property,
            inherited.getPropertyValue(property),
            inherited.getPropertyPriority(property),
          );
    }
    const wrapper = this.doc.createElement('div');
    wrapper.dataset.uicLift = id;
    wrapper.style.cssText =
      'position:absolute!important;box-sizing:border-box!important;margin:0!important;padding:0!important;border:0!important;overflow:visible!important;pointer-events:auto!important;';
    wrapper.style.width = base.width + 'px';
    wrapper.style.height = base.height + 'px';
    for (const [property, value] of Object.entries({
      position: 'relative',
      top: '0px',
      left: '0px',
      right: 'auto',
      bottom: 'auto',
      margin: '0px',
      transform: 'none',
      translate: 'none',
      'box-sizing': 'border-box',
      width: base.width + 'px',
      height: base.height + 'px',
      'max-width': 'none',
      'min-width': '0px',
      'max-height': 'none',
      'min-height': '0px',
    }))
      element.style.setProperty(property, value, 'important');
    if (node.kind === 'text') {
      element.style.setProperty('display', 'block', 'important');
      const lineHeight = parseFloat(this.frame.contentWindow.getComputedStyle(element).lineHeight);
      if (!lineHeight || base.height < lineHeight * 1.4)
        element.style.setProperty('line-height', base.height + 'px', 'important');
    }
    wrapper.append(element);
    this.portal.append(wrapper);
    const lift = { wrapper, element, placeholder, originalStyle, base, baseline: !!forcedRect };
    this.lifts.set(id, lift);
    return lift;
  }
  restoreLift(id) {
    const lift = this.lifts.get(id);
    if (!lift || lift.baseline) return;
    lift.element.setAttribute('style', lift.originalStyle);
    lift.placeholder.replaceWith(lift.element);
    lift.wrapper.remove();
    this.lifts.delete(id);
  }
  setEdits(edits) {
    const cleaned = cleanEdits(edits, this.originalNodes);
    this.syncCopies(cleaned);
    this.edits = cleaned;
    this.annotations = cleanComments(this.annotations, this.nodes);
    this.selection = new Set([...this.selection].filter((id) => this.nodes.has(id)));
    if (!this.selection.has(this.selected)) this.selected = [...this.selection].at(-1) || null;
    this.apply();
  }
  syncCopies(edits) {
    const { nodes, copies } = expandCopyNodes(edits, this.originalNodes),
      signature = JSON.stringify(copies);
    if (signature === this.copySignature) return;
    this.copySignature = null;
    for (const [id, node] of this.nodes)
      if (node.copiedFrom) {
        const lift = this.lifts.get(id);
        lift?.wrapper.remove();
        lift?.placeholder.remove();
        this.elements.get(id)?.remove();
        this.elements.delete(id);
        this.lifts.delete(id);
        this.defaults.delete(id);
        this.baseRects.delete(id);
      }
    this.nodes = nodes;
    Object.assign(this, indexNodes([...nodes.values()]));
    for (const [rootId, descriptor] of Object.entries(copies)) {
      const first = descriptor.nodes[0],
        clone = this.originalElements.get(first.sourceId)?.cloneNode(true);
      if (!clone) throw new Error('복제할 원본 요소를 찾을 수 없습니다.');
      const mapped = new Map(descriptor.nodes.map((n) => [n.sourceId, n.id]));
      for (const el of [clone, ...clone.querySelectorAll('[data-uic-id]')]) {
        const old = el.dataset.uicId;
        if (!mapped.has(old)) {
          el.remove();
          continue;
        }
        el.dataset.uicId = mapped.get(old);
      }
      const domIds = new Map();
      for (const el of [clone, ...clone.querySelectorAll('*')])
        if (el.id) {
          domIds.set(el.id, 'uic-' + rootId + '-' + el.id);
          el.id = domIds.get(el.id);
        }
      for (const el of [clone, ...clone.querySelectorAll('*')])
        for (const attr of [...el.attributes]) {
          let value = attr.value.replace(/url\(["']?#([^\s)"']+)["']?\)/g, (all, id) =>
            domIds.has(id) ? 'url(#' + domIds.get(id) + ')' : all,
          );
          if (
            ['href', 'xlink:href'].includes(attr.name) &&
            value.startsWith('#') &&
            domIds.has(value.slice(1))
          )
            value = '#' + domIds.get(value.slice(1));
          if (['for', 'aria-labelledby', 'aria-describedby'].includes(attr.name))
            value = value
              .split(' ')
              .map((id) => domIds.get(id) || id)
              .join(' ');
          if (value !== attr.value) el.setAttribute(attr.name, value);
        }
      this.portal.append(clone);
      const elements = new Map(
        [clone, ...clone.querySelectorAll('[data-uic-id]')].map((el) => [el.dataset.uicId, el]),
      );
      for (const record of descriptor.nodes) {
        const el = elements.get(record.id);
        if (!el) throw new Error('복제 요소가 원본 화면에 없습니다.');
        this.elements.set(record.id, el);
        this.defaults.set(record.id, {
          visibility: el.style.visibility,
          opacity: el.style.opacity,
          translate: el.style.translate,
        });
        this.baseRects.set(record.id, record.rect);
      }
      for (const record of descriptor.nodes) this.lift(record.id, record.rect);
    }
    this.copySignature = signature;
  }
  copySelection() {
    const roots = this.selectionRoots();
    if (!roots.length) throw new Error('복사할 요소를 선택해 주세요.');
    let count = 0;
    const items = roots.map((root) => {
      const queue = [root],
        records = [];
      while (queue.length) {
        const id = queue.shift(),
          node = this.nodes.get(id),
          rect = this.rect(id) || node.rect;
        if (!this.elements.has(id)) continue;
        if (++count > 5000)
          throw new Error('한 번에 하위 요소를 포함해 5,000개까지 복사할 수 있습니다.');
        records.push({
          id,
          sourceId: node.copiedFrom || id,
          parentId: id === root ? null : node.parentId,
          rect,
          hidden: this.hidden(id) || !node.visible,
          comment: this.annotations[id] || '',
        });
        queue.push(...(this.children.get(id) || []).map((n) => n.id));
      }
      return { nodes: records };
    });
    return { format: 'console-canvas-clipboard', version: 1, document_id: this.snapshot.id, items };
  }
  pasteSelection(payload, offset = 24) {
    if (
      payload?.format !== 'console-canvas-clipboard' ||
      payload.version !== 1 ||
      payload.document_id !== this.snapshot.id
    )
      throw new Error('이 화면에서 복사한 요소를 붙여넣어 주세요.');
    if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > 100)
      throw new Error('복사한 요소 정보가 올바르지 않습니다.');
    const edits = copy(this.edits),
      annotations = copy(this.annotations),
      roots = [];
    let count = 0;
    for (const item of payload.items) {
      if (!Array.isArray(item.nodes) || !item.nodes.length || (count += item.nodes.length) > 5000)
        throw new Error('복사한 요소 정보가 너무 큽니다.');
      const ids = new Map(
        item.nodes.map((n) => [
          n.id,
          'n' + BigInt('0x' + crypto.randomUUID().replaceAll('-', '')).toString(),
        ]),
      );
      if (ids.size !== item.nodes.length) throw new Error('복사한 요소 식별자가 중복됩니다.');
      const records = item.nodes.map((n, index) => ({
        id: ids.get(n.id),
        sourceId: n.sourceId,
        parentId: index === 0 ? null : ids.get(n.parentId),
        rect: { ...n.rect, x: n.rect?.x + offset, y: n.rect?.y + offset },
        hidden: n.hidden === true,
      }));
      const id = records[0].id;
      roots.push(id);
      edits[id] = { dx: 0, dy: 0, deleted: false, copy: { nodes: records } };
      for (const n of item.nodes)
        if (typeof n.comment === 'string' && n.comment.trim())
          annotations[ids.get(n.id)] = n.comment.trim().slice(0, EDIT_LIMITS.comment);
    }
    // Validate before opening a shared history step or changing the DOM.
    expandCopyNodes(edits, this.originalNodes);
    for (const item of payload.items)
      for (const record of item.nodes)
        if (!this.originalElements.has(record.sourceId))
          throw new Error('복제할 원본 요소를 찾을 수 없습니다.');
    const before = {
      edits: copy(this.edits),
      annotations: copy(this.annotations),
      selection: [...this.selection],
      selected: this.selected,
    };
    this.callbacks.onBeforeChange?.();
    try {
      this.setEdits(edits);
      this.setComments(annotations);
      this.select(roots.at(-1), { ids: roots });
    } catch (error) {
      this.setEdits(before.edits);
      this.setComments(before.annotations);
      this.select(before.selected, { ids: before.selection });
      this.callbacks.onCommit?.({ cancel: true });
      throw error;
    }
    this.callbacks.onCommit?.({ label: '요소 붙여넣기' });
    return roots;
  }
  setComments(value) {
    this.annotations = cleanComments(value, this.nodes);
    this.renderCommentMarkers();
  }
  setComment(id, text) {
    if (!this.nodes.has(id) && !pointTarget(id)) return;
    this.commitOperations([{ type: 'comment', element_id: id, text }]);
  }
  commitOperations(operations) {
    const next = prepareEdits(
      { edits: this.edits, annotations: this.annotations },
      operations,
      this.elements,
    );
    if (!next.changed) return;
    this.callbacks.onBeforeChange?.();
    this.annotations = next.annotations;
    this.setEdits(next.edits);
    this.callbacks.onCommit?.({
      label:
        this.editCategory === 'property'
          ? '속성 변경'
          : operations.some((o) => o.type.includes('comment'))
            ? '주석 편집'
            : operations.some((o) => o.type === 'delete')
              ? '요소 삭제'
              : '요소 이동',
      category: this.editCategory || 'move',
    });
  }
  setDisplayScale(value) {
    if (Number.isFinite(value) && value > 0 && value !== this.displayScale) {
      this.displayScale = value;
      this.renderCommentMarkers();
    }
  }
  showPointComment(x, y) {
    this.pointComment = {
      x: Math.max(0, Math.round(x)),
      y: Math.max(0, Math.round(y)),
      width: 0,
      height: 0,
    };
    this.select(null);
    this.drawCommentButton();
  }
  drawCommentButton() {
    const button = this.addCommentButton;
    if (!button) return;
    const r = this.selected ? this.rect(this.selected) : this.pointComment;
    button.style.cssText =
      'all:initial!important;position:absolute!important;z-index:2147483647!important;cursor:pointer!important;background:#6557dc!important;color:white!important;border-radius:7px!important;box-shadow:0 2px 8px #31236e55!important;text-align:center!important;';
    if (!r || this.drag?.started || this.areaSelecting) {
      button.style.setProperty('display', 'none', 'important');
      return;
    }
    button.style.setProperty('display', 'grid', 'important');
    button.style.setProperty('place-items', 'center', 'important');
    const size = 28 / this.displayScale;
    button.style.setProperty('left', Math.max(0, r.x + r.width / 2 - size / 2) + 'px', 'important');
    button.style.setProperty(
      'top',
      Math.max(0, r.y - size - 5 / this.displayScale) + 'px',
      'important',
    );
    button.style.setProperty('width', size + 'px', 'important');
    button.style.setProperty('height', size + 'px', 'important');
    button.style.setProperty('font', '700 ' + 16 / this.displayScale + 'px system-ui', 'important');
  }
  openComment(id) {
    if (!this.annotations[id]) return;
    if (!pointTarget(id)) this.select(id);
    this.callbacks.onCommentSelect?.(id);
  }
  renderCommentMarkers() {
    if (!this.commentLayer) return;
    this.drawCommentButton();
    for (const [id, marker] of this.commentMarkers)
      if (!this.annotations[id]) {
        marker.remove();
        this.commentMarkers.delete(id);
      }
    const size = 24 / this.displayScale,
      gap = 4 / this.displayScale,
      bounds = this.contentSize(),
      occupied = [];
    Object.entries(this.annotations).forEach(([id, text], index) => {
      const point = pointTarget(id),
        node = this.nodes.get(id) || { name: '위치 주석', rect: point },
        offset = point ? { x: 0, y: 0 } : this.offset(id),
        deleted = !point && this.hidden(id);
      const rect = point ||
        (!deleted && this.rect(id)) || {
          ...node.rect,
          x: node.rect.x + offset.x,
          y: node.rect.y + offset.y,
        };
      let marker = this.commentMarkers.get(id);
      if (!marker) {
        marker = this.doc.createElement('button');
        marker.type = 'button';
        marker.dataset.uicComment = id;
        this.commentLayer.append(marker);
        this.commentMarkers.set(id, marker);
      }
      let x = Math.max(0, Math.min(bounds.width - size, rect.x + rect.width - size * 0.45)),
        y = Math.max(0, Math.min(bounds.height - size, rect.y - size * 0.6));
      for (
        let tries = 0;
        tries < occupied.length &&
        occupied.some((r) => Math.abs(r.x - x) < size + gap && Math.abs(r.y - y) < size + gap);
        tries++
      )
        y += size + gap;
      occupied.push({ x, y });
      marker.textContent = String(index + 1);
      marker.setAttribute('aria-label', '주석 ' + (index + 1) + ' · ' + node.name + ' 편집');
      marker.setAttribute('aria-pressed', String(this.selected === id));
      marker.title =
        '주석 ' +
        (index + 1) +
        ' · ' +
        node.name +
        (deleted ? ' (삭제된 대상)' : '') +
        '\n' +
        text +
        '\n클릭해서 주석 편집';
      marker.style.cssText =
        'all:initial!important;position:absolute!important;display:grid!important;place-items:center!important;box-sizing:border-box!important;pointer-events:auto!important;cursor:pointer!important;border-radius:50% 50% 50% 4px!important;' +
        'background:' +
        (this.selected === id ? '#4036ae' : '#6557dc') +
        '!important;color:#fff!important;border:' +
        2 / this.displayScale +
        'px ' +
        (deleted ? 'dashed' : 'solid') +
        ' #fff!important;box-shadow:0 2px 8px #31236e55!important;' +
        'font:700 ' +
        12 / this.displayScale +
        'px system-ui,sans-serif!important;line-height:1!important;left:' +
        x +
        'px!important;top:' +
        y +
        'px!important;width:' +
        size +
        'px!important;height:' +
        size +
        'px!important;';
    });
  }
  comments() {
    return Object.entries(this.annotations).map(([id, text]) => {
      const point = pointTarget(id),
        node = this.nodes.get(id) || {
          name: '위치 주석',
          kind: 'point',
          tag: 'point',
          rect: point,
          locator: null,
          parentId: null,
        },
        offset = point ? { x: 0, y: 0 } : this.offset(id);
      return {
        id,
        ...(point ? { point } : {}),
        name: node.name,
        kind: node.kind,
        tag: node.tag,
        parentId: node.parentId,
        locator: node.locator,
        text,
        ...(node.copiedFrom ? { copiedFrom: node.copiedFrom } : {}),
        before: node.rect,
        after:
          !point && this.hidden(id)
            ? null
            : { ...node.rect, x: node.rect.x + offset.x, y: node.rect.y + offset.y },
        targetDeleted: !point && this.hidden(id),
      };
    });
  }
  apply() {
    for (const [id] of [...this.lifts])
      if (!this.edits[id]?.dx && !this.edits[id]?.dy) this.restoreLift(id);
    for (const [id, edit] of Object.entries(this.edits))
      if ((edit.dx || edit.dy) && this.elements.has(id)) this.lift(id);
    for (const [id, element] of this.elements) {
      const hidden = this.hidden(id),
        defaults = this.defaults.get(id);
      element.style.setProperty(
        'visibility',
        hidden ? 'hidden' : defaults.visibility || 'visible',
        'important',
      );
      element.style.setProperty('opacity', hidden ? '0' : defaults.opacity || '1', 'important');
      if (element === this.doc.body) {
        const own = this.edits[id] || {};
        element.style.translate = (own.dx || 0) + 'px ' + (own.dy || 0) + 'px';
      }
      const lift = this.lifts.get(id);
      if (lift) {
        const offset = this.offset(id);
        lift.wrapper.style.left = lift.base.x + offset.x + 'px';
        lift.wrapper.style.top = lift.base.y + offset.y + 'px';
        lift.wrapper.style.zIndex = this.selected === id ? '10' : '1';
      }
    }
    this.drawSelection();
    this.callbacks.onSize?.(this.contentSize());
  }
  contentSize() {
    let width = this.snapshot.source.width,
      height = this.snapshot.source.height;
    for (const [id, lift] of this.lifts)
      if (!this.hidden(id)) {
        const offset = this.offset(id);
        width = Math.max(width, lift.base.x + offset.x + lift.base.width + 24);
        height = Math.max(height, lift.base.y + offset.y + lift.base.height + 24);
      }
    return { width: Math.ceil(width), height: Math.ceil(height) };
  }
  begin(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.target.closest?.('[data-uic-group-handle]')) {
      if (this.interactionMode === 'edit' && this.selection.size > 1)
        this.beginDrag(event, this.selected);
      return;
    }
    if (event.target.closest?.('[data-uic-add-comment]')) {
      const id = this.selected || `point:${this.pointComment.x}:${this.pointComment.y}`;
      this.callbacks.onCommentSelect?.(id);
      return;
    }
    this.pointComment = null;
    const marker = event.target.closest?.('[data-uic-comment]');
    if (marker) {
      this.openComment(marker.dataset.uicComment);
      return;
    }
    let id = this.targetId(event);
    if (
      this.callbacks.smartSelection &&
      this.interactionMode === 'edit' &&
      !event.altKey &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      id
    )
      id = [id, ...this.ancestors(id)].find((key) => this.selection.has(key)) || id;
    if (this.interactionMode === 'edit' && this.callbacks.onAreaStart?.(event, id)) return;
    if (!id || !this.elements.has(id) || this.hidden(id)) {
      this.select(null);
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      this.select(id, { additive: true });
      return;
    }
    if (!this.selection.has(id) || this.interactionMode === 'comment') this.select(id);
    if (this.interactionMode === 'comment') {
      this.callbacks.onCommentSelect?.(id, { floating: true });
      return;
    }
    this.beginDrag(event, id);
  }
  beginDrag(event, id) {
    const ids = this.selectionRoots(),
      selectedSet = new Set(ids),
      boxes = ids.map((key) => this.rect(key)),
      left = Math.min(...boxes.map((r) => r.x)),
      top = Math.min(...boxes.map((r) => r.y)),
      moving = {
        x: left,
        y: top,
        width: Math.max(...boxes.map((r) => r.x + r.width)) - left,
        height: Math.max(...boxes.map((r) => r.y + r.height)) - top,
      };
    this.drag = {
      id,
      ids,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      before: copy(this.edits),
      started: false,
      moving,
      candidates: this.snapEnabled
        ? [...this.nodes.values()]
            .filter(
              (n) =>
                !selectedSet.has(n.id) &&
                !this.ancestors(n.id).some((p) => selectedSet.has(p)) &&
                !ids.some((key) => this.ancestors(key).includes(n.id)) &&
                !this.hidden(n.id) &&
                n.visible &&
                n.kind !== 'text',
            )
            .slice(0, 1500)
            .map((n) => this.rect(n.id))
            .filter(Boolean)
        : [],
    };
    this.doc.documentElement.setPointerCapture(event.pointerId);
  }
  move(event) {
    if (this.areaSelecting) return;
    if (!this.drag) {
      const id = this.targetId(event);
      this.setOutline(
        this.hover,
        id && id !== this.selected && !this.hidden(id) ? this.rect(id) : null,
      );
      return;
    }
    const d = this.drag;
    if (event.pointerId !== d.pointerId) return;
    const dx = event.clientX - d.x,
      dy = event.clientY - d.y;
    if (!d.started && Math.hypot(dx, dy) < 3) return;
    if (!d.started) {
      this.callbacks.onBeforeChange?.();
      for (const id of d.ids) this.lift(id);
      d.started = true;
    }
    const snapped =
      this.snapEnabled && !event.altKey
        ? snapDelta(d.moving, d.candidates, Math.round(dx), Math.round(dy), 6 / this.displayScale)
        : { dx: Math.round(dx), dy: Math.round(dy), guides: [] };
    let moveX = snapped.dx,
      moveY = snapped.dy;
    for (const id of d.ids) {
      const previous = d.before[id] || {};
      moveX = Math.max(
        -EDIT_LIMITS.x - (previous.dx || 0),
        Math.min(EDIT_LIMITS.x - (previous.dx || 0), moveX),
      );
      moveY = Math.max(
        -EDIT_LIMITS.y - (previous.dy || 0),
        Math.min(EDIT_LIMITS.y - (previous.dy || 0), moveY),
      );
    }
    for (const id of d.ids) {
      const previous = d.before[id] || {};
      this.edits[id] = {
        ...previous,
        dx: (previous.dx || 0) + moveX,
        dy: (previous.dy || 0) + moveY,
      };
    }
    this.drawGuides(snapped.guides);
    this.apply();
    this.callbacks.onLiveChange?.();
  }
  finish(event, cancel) {
    if (!this.drag || this.drag.pointerId !== event.pointerId) return;
    const d = this.drag;
    this.drag = null;
    this.clearGuides();
    if (this.doc.documentElement.hasPointerCapture(event.pointerId))
      this.doc.documentElement.releasePointerCapture(event.pointerId);
    if (cancel) this.setEdits(d.before);
    if (d.started) this.callbacks.onCommit?.({ cancel });
  }
  nudge(dx, dy) {
    const ids = selectionRoots(this);
    if (!ids.length) return;
    this.commitOperations(
      ids.map((id) => ({ type: 'move', element_id: id, dx, dy, mode: 'relative' })),
    );
  }
  setPosition(dx, dy) {
    if (!this.selected) return;
    this.commitOperations([{ type: 'move', element_id: this.selected, dx, dy, mode: 'absolute' }]);
  }
  remove(id) {
    const ids = id ? [id] : this.selectionRoots();
    const visible = ids.filter((key) => !this.hidden(key));
    if (!visible.length) return;
    this.commitOperations(visible.map((key) => ({ type: 'delete', element_id: key })));
    this.select(visible.length === 1 ? this.parent(visible[0]) : null);
  }
  changes() {
    const result = [];
    for (const [id, edit] of Object.entries(this.edits)) {
      if (this.ancestors(id).some((parent) => this.edits[parent]?.deleted)) continue;
      if (!edit.deleted && !edit.dx && !edit.dy && !edit.copy) continue;
      const node = this.nodes.get(id),
        offset = this.offset(id),
        descendants = this.descendantCounts.get(id);
      result.push({
        id,
        name: node.name,
        kind: node.kind,
        tag: node.tag,
        parentId: node.parentId,
        locator: node.locator,
        action: edit.deleted ? 'delete' : edit.copy ? 'copy' : 'move',
        ...(node.copiedFrom ? { copiedFrom: node.copiedFrom } : {}),
        delta: { x: edit.dx || 0, y: edit.dy || 0 },
        effectiveDelta: offset,
        before: node.rect,
        after: edit.deleted
          ? null
          : { ...node.rect, x: node.rect.x + offset.x, y: node.rect.y + offset.y },
        affectedDescendants: descendants,
      });
    }
    return result;
  }
  serialize() {
    const clone = this.doc.documentElement.cloneNode(true);
    clone
      .querySelectorAll('[data-uic-editor]:not([data-uic-editor="portal"])')
      .forEach((el) => el.remove());
    return '<!doctype html>' + clone.outerHTML;
  }
  async beforeHtml() {
    const edits = copy(this.edits),
      annotations = copy(this.annotations),
      selection = [...this.selection],
      selected = this.selected;
    this.setEdits({});
    const result = this.serialize();
    this.setEdits(edits);
    this.setComments(annotations);
    this.select(selected, { ids: selection });
    return result;
  }
}
