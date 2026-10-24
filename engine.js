import { indexNodes } from './node-index.js';
import { cleanEdits, cleanComments, boundedPosition, prepareEdits } from './edit-commands.js';
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
    Object.assign(this, indexNodes(snapshot.nodes));
    this.edits = {};
    this.annotations = {};
    this.interactionMode = 'edit';
    this.elements = new Map();
    this.lifts = new Map();
    this.selected = null;
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
        if (!this.drag) {
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
    return !!this.edits[id]?.deleted || this.ancestors(id).some((p) => this.edits[p]?.deleted);
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
  select(id) {
    this.selected = this.elements.has(id) ? id : null;
    this.drawSelection();
    this.callbacks.onSelect?.(this.selected);
  }
  drawSelection() {
    const r = this.selected && !this.hidden(this.selected) ? this.rect(this.selected) : null;
    this.setOutline(this.outline, r);
    this.hover.style.display = 'none';
    this.renderCommentMarkers();
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
    if (node.kind === 'text') element.style.cssText = node.textStyle || '';
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
    this.edits = cleanEdits(edits, this.nodes);
    this.apply();
  }
  setComments(value) {
    this.annotations = cleanComments(value, this.nodes);
    this.renderCommentMarkers();
  }
  setComment(id, text) {
    if (!this.nodes.has(id)) return;
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
    this.callbacks.onCommit?.();
  }
  setDisplayScale(value) {
    if (Number.isFinite(value) && value > 0 && value !== this.displayScale) {
      this.displayScale = value;
      this.renderCommentMarkers();
    }
  }
  openComment(id) {
    if (!this.annotations[id]) return;
    this.select(id);
    this.callbacks.onCommentSelect?.(id);
  }
  renderCommentMarkers() {
    if (!this.commentLayer) return;
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
      const node = this.nodes.get(id),
        offset = this.offset(id),
        deleted = this.hidden(id);
      const rect = (!deleted && this.rect(id)) || {
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
      const node = this.nodes.get(id),
        offset = this.offset(id);
      return {
        id,
        name: node.name,
        kind: node.kind,
        tag: node.tag,
        parentId: node.parentId,
        locator: node.locator,
        text,
        before: node.rect,
        after: this.hidden(id)
          ? null
          : { ...node.rect, x: node.rect.x + offset.x, y: node.rect.y + offset.y },
        targetDeleted: this.hidden(id),
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
    const marker = event.target.closest?.('[data-uic-comment]');
    if (marker) {
      this.openComment(marker.dataset.uicComment);
      return;
    }
    let element = event.target.closest?.('[data-uic-id]'),
      id = element?.dataset.uicId;
    if (event.shiftKey && id) id = this.parent(id) || id;
    if (!id || !this.elements.has(id) || this.hidden(id)) {
      this.select(null);
      return;
    }
    this.select(id);
    if (this.interactionMode === 'comment') return;
    this.drag = {
      id,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      before: copy(this.edits),
      started: false,
    };
    this.doc.documentElement.setPointerCapture(event.pointerId);
  }
  move(event) {
    if (!this.drag) {
      const id = event.target.closest?.('[data-uic-id]')?.dataset.uicId;
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
      this.lift(d.id);
      d.started = true;
    }
    const previous = d.before[d.id] || {};
    this.edits[d.id] = {
      ...previous,
      ...boundedPosition((previous.dx || 0) + Math.round(dx), (previous.dy || 0) + Math.round(dy)),
    };
    this.apply();
    this.callbacks.onLiveChange?.();
  }
  finish(event, cancel) {
    if (!this.drag || this.drag.pointerId !== event.pointerId) return;
    const d = this.drag;
    this.drag = null;
    if (this.doc.documentElement.hasPointerCapture(event.pointerId))
      this.doc.documentElement.releasePointerCapture(event.pointerId);
    if (cancel) this.setEdits(d.before);
    if (d.started) this.callbacks.onCommit?.({ cancel });
  }
  nudge(dx, dy) {
    if (!this.selected || this.hidden(this.selected)) return;
    this.commitOperations([{ type: 'move', element_id: this.selected, dx, dy, mode: 'relative' }]);
  }
  setPosition(dx, dy) {
    if (!this.selected) return;
    this.commitOperations([{ type: 'move', element_id: this.selected, dx, dy, mode: 'absolute' }]);
  }
  remove(id = this.selected) {
    if (!id || this.hidden(id)) return;
    this.commitOperations([{ type: 'delete', element_id: id }]);
    this.select(this.parent(id));
  }
  changes() {
    const result = [];
    for (const [id, edit] of Object.entries(this.edits)) {
      if (this.ancestors(id).some((parent) => this.edits[parent]?.deleted)) continue;
      if (!edit.deleted && !edit.dx && !edit.dy) continue;
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
        action: edit.deleted ? 'delete' : 'move',
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
      .querySelectorAll(
        '[data-uic-editor="selection"],[data-uic-editor="hover"],[data-uic-editor="comment-markers"]',
      )
      .forEach((el) => el.remove());
    return '<!doctype html>' + clone.outerHTML;
  }
  async beforeHtml() {
    const edits = copy(this.edits);
    this.setEdits({});
    const result = this.serialize();
    this.setEdits(edits);
    return result;
  }
}
