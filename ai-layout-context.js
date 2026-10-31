// A bounded description for inference, never HTML used to render or persist a capture.
import { aiInputError } from './ai-input-policy.js';
const escape = (s) =>
  String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const assets = (s) => s.replace(/data:[^\s"'<>)]*/g, '[embedded asset]');
const attributes =
  /^(id|class|role|title|name|type|placeholder|value|disabled|checked|selected|colspan|rowspan|alt|href|src|aria-[\w-]+)$/;
const properties =
  /^(display|position|inset|top|right|bottom|left|z-index|float|clear|box-sizing|(?:min-|max-)?(?:width|height)|margin(?:-\w+)?|padding(?:-\w+)?|(?:row-|column-)?gap|flex(?:-\w+)?|grid(?:-[\w-]+)?|align-[\w-]+|justify-[\w-]+|place-[\w-]+|overflow(?:-\w+)?|color|background(?:-[\w-]+)?|font(?:-[\w-]+)?|line-height|letter-spacing|text-align|white-space|border(?:-[\w-]+)?|box-shadow|opacity|transform|visibility)$/;
export function layoutContext(scene, roots, selected) {
  const included = new Set(),
    omitted = [];
  const targets = selected.map((id) => scene.elements.get(id)).filter(Boolean);
  let count = 0,
    length = 0,
    omittedCount = 0;
  function omit(el, reason) {
    omittedCount++;
    if (omitted.length < 60)
      omitted.push({
        id: el.getAttribute('data-uic-id'),
        reason,
        descendants: el.querySelectorAll('[data-uic-id]').length,
      });
    return '<!-- subtree omitted: select this region for detailed editing -->';
  }
  function describe(el, depth = 0) {
    if (el.nodeType === 3)
      return escape(
        el.textContent.length > 1000
          ? el.textContent.slice(0, 1000) + ' [long text omitted]'
          : el.textContent,
      );
    if (el.nodeType !== 1 || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) return '';
    const id = el.getAttribute('data-uic-id'),
      isTarget = selected.includes(id);
    const targetPath = targets.some((target) => el === target || el.contains(target));
    if (isTarget) depth = 0;
    if ((depth > 8 || count >= 600 || length > 700_000) && !targetPath)
      return omit(el, depth > 8 ? 'depth' : 'budget');
    if (count >= 600 && targetPath) throw aiInputError('input_too_large');
    count++;
    if (id) included.add(id);
    const attrs = [...el.attributes]
      .filter((a) => a.name === 'data-uic-id' || attributes.test(a.name))
      .map((a) => `${a.name}="${escape(assets(a.value).slice(0, 2000))}"`);
    const css = [...el.style]
      .filter((p) => properties.test(p))
      .map((p) => [p, el.style.getPropertyValue(p)])
      .filter(([, v]) => !/^(none|normal|auto|initial|inherit|unset)$/.test(v))
      .map(([p, v]) => `${p}:${assets(v).slice(0, 2000)}`)
      .join(';');
    if (css) attrs.push(`style="${escape(css)}"`);
    const tag = el.tagName.toLowerCase();
    const start = `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
    length += start.length;
    return (
      start + [...el.childNodes].map((child) => describe(child, depth + 1)).join('') + `</${tag}>`
    );
  }
  const html = roots.map((el) => describe(el)).join('\n');
  if (selected.some((id) => !included.has(id))) throw aiInputError('input_too_large');
  return {
    html,
    included,
    representation: {
      kind: 'layout_description',
      description:
        'Inference-only HTML outline with original data-uic-id values and layout styles. Not standalone rendered HTML. Deep/large subtrees are summarized; long text/attributes are bounded; embedded asset bytes are omitted and the image is supplied separately. Edit described IDs only; select an omitted region for detail. Preserve untouched descendants and responsive relationships.',
      described_elements: included.size,
      omitted_subtree_count: omittedCount,
      omitted_subtrees: omitted,
    },
  };
}
