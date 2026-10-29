import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { captureChromeTab } from '../../chrome-capture.js';
import { fetchPublicAssets, fetchPublicFontCss } from '../../capture-assets.js';
test('public stylesheet rescue retains only font metadata with absolute resources', async () => {
  const original = globalThis.fetch;
  let options;
  globalThis.fetch = async (_url, init) => {
    options = init;
    return new Response(
      'body{display:none}@font-face{font-family:Demo;src:url(../fonts/a.woff2)}@font-feature-values Demo{@styleset{alt:1}}',
    );
  };
  try {
    const rules = await fetchPublicFontCss(['https://assets.example.test/css/main.css']);
    assert.equal(options.credentials, 'omit');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(rules.length, 2);
    assert.ok(rules[0].includes('https://assets.example.test/fonts/a.woff2'));
    assert.ok(rules.every((rule) => !rule.includes('body')));
    assert.deepEqual(
      await fetchPublicFontCss([
        'file:///private/secret.css',
        'https://user:secret@example.test/styles.css',
      ]),
      [],
    );
  } finally {
    globalThis.fetch = original;
  }
});
test('public stylesheet rescue cancels a streaming response beyond its budget', async () => {
  const original = globalThis.fetch;
  let cancelled = false;
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(2_000_001));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
  try {
    assert.deepEqual(await fetchPublicFontCss(['https://assets.example.test/styles.css']), []);
    assert.equal(cancelled, true);
  } finally {
    globalThis.fetch = original;
  }
});
test('font bytes without Content-Type remain available offline', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([119, 79, 70, 50, 0, 0, 0, 0]));
  try {
    const assets = await fetchPublicAssets(['https://example.test/font.woff2']);
    assert.match(assets['https://example.test/font.woff2'], /^data:font\/woff2;base64,/);
  } finally {
    globalThis.fetch = original;
  }
});
function fixture(url, children = []) {
  return {
    html: '<body>test</body>',
    source: {
      url,
      viewport: { width: 100, height: 100 },
      width: 100,
      height: 100,
      scroll: { x: 0, y: 0 },
    },
    warnings: [],
    nodes: children.map((url, index) => ({ tag: 'iframe', locator: {}, frame: { url, index } })),
  };
}
test('capture failure restores source scroll while retaining the DOM', async () => {
  const source = fixture('https://a.test/');
  source.source.height = 600;
  const chrome = browser([{ frameId: 0, result: source }]);
  let count = 0;
  chrome.tabs.captureVisibleTab = async () => {
    if (++count >= 3) throw Error('Screenshot unavailable');
    return 'data:image/png;base64,QQ==';
  };
  const result = await captureChromeTab(chrome, { id: 7, windowId: 1 });
  assert.equal(result.html, source.html);
  assert.equal(chrome.inspectScroll().y, 0);
  assert.ok(result.warnings.some((w) => w.type === 'screenshot'));
});
test('changing active tab never includes its pixels or retries capture on it', async () => {
  const source = fixture('https://a.test/');
  source.source.height = 600;
  const chrome = browser([{ frameId: 0, result: source }]);
  let count = 0,
    active = true;
  chrome.tabs.query = async () => [{ id: active ? 7 : 99 }];
  chrome.tabs.captureVisibleTab = async () => {
    if (++count === 3) {
      active = false;
      return 'data:image/png;base64,QkFE';
    }
    return 'data:image/png;base64,QQ==';
  };
  const result = await captureChromeTab(chrome, { id: 7, windowId: 1 });
  assert.equal(count, 3);
  assert.equal(chrome.inspectScroll().y, 0);
  assert.ok(!JSON.stringify(result).includes('QkFE'));
  assert.ok(result.warnings.some((w) => w.type === 'screenshot'));
});
function browser(records, denied = false) {
  const contexts = new Map(
    records.map((r) => {
      const view = {
        document: {
          fonts: { ready: Promise.resolve() },
          getAnimations: () => [],
          images: [],
          documentElement: { scrollHeight: 100 },
          body: { scrollHeight: 100 },
        },
        location: { href: r.result.source.url },
        innerWidth: 100,
        innerHeight: 100,
        scrollX: 0,
        scrollY: 0,
        args: [],
        setTimeout: (fn) => {
          fn();
          return 0;
        },
      };
      view.window = view;
      view.scrollTo = ({ left, top }) => {
        view.scrollX = left;
        view.scrollY = top;
      };
      view.requestAnimationFrame = (fn) => fn();
      view.UICloneCapture = {
        capture: (_document, options) => ({
          ...structuredClone(r.result),
          mergedFrames: options?.frames,
        }),
        matchesView: () => true,
      };
      return [r.frameId, view];
    }),
  );
  return {
    inspectScroll: () => ({ x: contexts.get(0).scrollX, y: contexts.get(0).scrollY }),
    scripting: {
      async executeScript(input) {
        if (denied && input.target.allFrames) throw Error('Missing host permission');
        if (input.files) return [];
        const ids = input.target.allFrames
          ? records.map((r) => r.frameId)
          : input.target.frameIds || [0];
        return Promise.all(
          ids.map(async (frameId) => {
            const world = contexts.get(frameId);
            world.args = input.args || [];
            return {
              frameId,
              result: await vm.runInNewContext('(' + input.func.toString() + ')(...args)', world),
            };
          }),
        );
      },
    },
    tabs: {
      query: async () => [{ id: 7 }],
      captureVisibleTab: async () => 'data:image/png;base64,AA==',
    },
  };
}
test('extension merges a permitted cross-origin grandchild before its parent', async () => {
  const records = [
    { frameId: 0, result: fixture('https://a.test/', ['https://b.test/']) },
    { frameId: 2, result: fixture('https://b.test/', ['https://c.test/']) },
    { frameId: 3, result: fixture('https://c.test/') },
  ];
  const capture = await captureChromeTab(browser(records), { id: 7, windowId: 1 });
  assert.equal(
    capture.mergedFrames[0].snapshot.mergedFrames[0].snapshot.source.url,
    'https://c.test/',
  );
  assert.equal(capture.captureReport.failedFrames.length, 0);
  assert.equal(capture.screenshotTiles.length, 1);
});
test('denied frame injection preserves root DOM and records fallback instead of failing capture', async () => {
  const records = [{ frameId: 0, result: fixture('https://a.test/', ['https://b.test/']) }];
  const capture = await captureChromeTab(browser(records, true), { id: 7, windowId: 1 });
  assert.equal(capture.source.url, 'https://a.test/');
  assert.equal(capture.mergedFrames[0].error.code, 'frame_access_denied');
  assert.equal(capture.captureReport.failedFrames.length, 1);
  assert.ok(capture.screenshot.startsWith('data:image/png'));
});
