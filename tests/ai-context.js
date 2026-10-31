import { layoutContext } from '../ai-layout-context.js';
import { validateAiInput, aiFailureMessage } from '../ai-input-policy.js';
const results = [];
function check(name, value) {
  results.push({ name, passed: !!value });
  document.querySelector('#results').textContent = results
    .map((r) => (r.passed ? 'PASS ' : 'FAIL ') + r.name)
    .join('\n');
  if (!value) throw Error(name);
}
try {
  const root = document.createElement('main');
  root.innerHTML =
    '<section data-uic-id="n1" style="display:flex;gap:16px;color:#3730a3"><button data-uic-id="n2" id="original" aria-label="Create">등록</button><div data-uic-id="n3"></div></section>';
  const noise = root.querySelector('[data-uic-id="n3"]');
  const captured =
    'display:block;position:static;inset:auto;z-index:auto;box-sizing:border-box;width:240px;height:24px;padding:6px 11px;border:1px solid #aaa;color:#333;font-family:system-ui;font-size:12px;animation:1s infinite;transition:all 1s;'.repeat(
      12,
    );
  for (let i = 0; i < 2000; i++) {
    const row = document.createElement('div');
    row.dataset.uicId = 'n' + (i + 10);
    row.setAttribute('style', captured);
    row.textContent = 'Nested preview item';
    noise.append(row);
  }
  const elements = new Map(
    [...root.querySelectorAll('[data-uic-id]')].map((e) => [e.dataset.uicId, e]),
  );
  const before = root.outerHTML;
  const context = layoutContext({ elements }, [root.firstElementChild], ['n2']);
  check(
    'Large captured styles are described within a bounded code budget',
    before.length > 2_000_000 && context.html.length < 1_000_000,
  );
  check(
    'Selection and its original DOM identity remain addressable',
    context.included.has('n2') &&
      context.html.includes('id="original"') &&
      context.html.includes('data-uic-id="n1"'),
  );
  check(
    'Layout and typography cues survive compression',
    context.html.includes('gap:16px') && context.html.includes('font-size:12px'),
  );
  check(
    'Omitted preview content is explicit and not silently claimed as full code',
    context.representation.kind === 'layout_description' &&
      context.representation.omitted_subtree_count > 0,
  );
  check('Inference preparation never mutates captured DOM', root.outerHTML === before);
  const deep = document.createElement('div');
  deep.dataset.uicId = 'deep-root';
  let leaf = deep;
  for (let i = 0; i < 15; i++) {
    const next = document.createElement('div');
    next.dataset.uicId = 'd' + i;
    leaf.append(next);
    leaf = next;
  }
  elements.set('d14', leaf);
  const detailed = layoutContext({ elements }, [deep], ['d14']);
  check(
    'An explicitly selected deep descendant is retained',
    detailed.included.has('d14') && detailed.html.includes('data-uic-id="d14"'),
  );
  const image = document.createElement('img');
  image.dataset.uicId = 'asset';
  image.src = 'data:image/png;base64,' + 'A'.repeat(1_500_000);
  elements.set('asset', image);
  const asset = layoutContext({ elements }, [image], ['asset']);
  check(
    'Embedded binary data is omitted from inference code only',
    asset.html.includes('[embedded asset]') &&
      !asset.html.includes('AAAA') &&
      image.src.length > 1_500_000,
  );
  const narrow = document.createElement('main');
  for (let i = 0; i < 605; i++) {
    const e = document.createElement('div');
    e.dataset.uicId = 's' + i;
    narrow.append(e);
    elements.set('s' + i, e);
  }
  let tooMany = false;
  try {
    layoutContext(
      { elements },
      [narrow],
      [...narrow.children].map((e) => e.dataset.uicId),
    );
  } catch (e) {
    tooMany = e.code === 'input_too_large';
  }
  check('Too many mandatory targets fail before inference instead of dropping selection', tooMany);
  let oversized = false;
  try {
    validateAiInput({ html: 'x'.repeat(2_000_001) });
  } catch (e) {
    oversized = e.code === 'input_too_large';
  }
  check(
    'Remaining oversized text has an actionable input error',
    oversized && aiFailureMessage('input_too_large').includes('더 작은 영역'),
  );
  check(
    'Input errors do not direct users to change credentials',
    !aiFailureMessage('input_too_large').includes('계정') &&
      !aiFailureMessage('input_image_too_large').includes('모델'),
  );
  document.body.dataset.result = 'pass';
} catch (error) {
  document.body.dataset.result = 'fail';
  results.push({ name: error.stack, passed: false });
}
document.querySelector('#status').textContent = JSON.stringify({
  passed: results.filter((r) => r.passed).length,
  failed: results.filter((r) => !r.passed).length,
  total: results.length,
});
