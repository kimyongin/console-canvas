import { fetchPublicAssets } from './capture-assets.js';
// Extension capture coordinator. Collector scripts only read DOM; viewport
// scrolling for screenshot tiles is restored in finally and never clicks UI.
const nap = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const message = (error) => String(error?.message || error || 'Frame capture unavailable');
export async function captureChromeTab(chrome, tab, layoutAttempt = 0) {
  const target = { tabId: tab.id };
  await chrome.scripting.executeScript({ target, files: ['capture.js'] });
  // Load lazy content before collecting DOM, while preserving the source view.
  await chrome.scripting.executeScript({
    target,
    func: async () => {
      const original = { url: location.href, x: scrollX, y: scrollY };
      try {
        await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2000))]);
        await new Promise((r) => setTimeout(r, 350));
        for (
          let y = 0, steps = 0;
          y <
            Math.min(24000, (document.scrollingElement || document.documentElement).scrollHeight) &&
          steps < 32;
          y += Math.max(300, innerHeight - 200), steps++
        ) {
          if (location.href !== original.url) throw Error('가져오는 동안 주소가 바뀌었습니다.');
          scrollTo({ left: original.x, top: y, behavior: 'instant' });
          await Promise.race([
            new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
            new Promise((r) => setTimeout(r, 250)),
          ]);
          await Promise.race([
            Promise.all(
              [...document.images]
                .filter((i) => {
                  const r = i.getBoundingClientRect();
                  return r.bottom > 0 && r.top < innerHeight;
                })
                .map((i) => i.decode().catch(() => {})),
            ),
            new Promise((r) => setTimeout(r, 400)),
          ]);
          await globalThis.UICloneCapture?.settleVisibleMedia?.(document);
        }
      } finally {
        if (location.href === original.url) {
          scrollTo({ left: original.x, top: original.y, behavior: 'instant' });
          await new Promise((r) => setTimeout(r, 250));
        }
      }
    },
  });
  let results, frameError;
  try {
    await chrome.scripting.executeScript({
      target: { ...target, allFrames: true },
      files: ['capture.js'],
    });
    results = await chrome.scripting.executeScript({
      target: { ...target, allFrames: true },
      func: () => globalThis.UICloneCapture.capture(document),
    });
  } catch (error) {
    frameError = { code: 'frame_access_denied', message: message(error) };
  }
  if (!results?.some((r) => r.frameId === 0 && r.result?.html)) {
    await chrome.scripting.executeScript({ target, files: ['capture.js'] });
    results = await chrome.scripting.executeScript({
      target,
      func: () => globalThis.UICloneCapture.capture(document),
    });
  }
  let snapshot = results.find((r) => r.frameId === 0)?.result;
  if (!snapshot?.html)
    throw Error('화면을 가져오지 못했습니다. 로딩이 끝난 뒤 다시 시도해 주세요.');
  let assetData = await fetchPublicAssets(
    results.flatMap((r) =>
      (r.result?.warnings || []).filter((w) => w.type === 'assets').flatMap((w) => w.urls || []),
    ),
  );
  const failures = [],
    merged = new Map();
  let finalCollection = false,
    finalScreenshot = null;
  async function merge(result, trail = []) {
    if (merged.has(result.frameId)) return merged.get(result.frameId);
    const direct = result.result.nodes.filter(
      (n) => n.tag === 'iframe' && !n.locator.frames?.length,
    );
    const frames = [];
    for (const node of direct) {
      const matches = results.filter(
        (r) => r.frameId !== result.frameId && r.result?.source.url === node.frame?.url,
      );
      const unique = direct.filter((n) => n.frame?.url === node.frame?.url).length === 1;
      let entry;
      if (
        matches.length === 1 &&
        unique &&
        trail.length < 5 &&
        !trail.includes(matches[0].frameId)
      ) {
        entry = { snapshot: await merge(matches[0], [...trail, result.frameId]) };
      } else {
        entry = {
          error: frameError || {
            code: matches.length ? 'ambiguous_frame_identity' : 'frame_access_unavailable',
            message: matches.length
              ? '프레임의 신원을 구분할 수 없거나 중첩 한도를 넘어 이미지로 보완합니다.'
              : '프레임의 독립 DOM 수집이 허용되지 않았거나 준비되지 않았습니다.',
          },
        };
        failures.push({ url: node.frame?.url, index: node.frame?.index, error: entry.error });
      }
      frames.push({ index: node.frame?.index, ...entry });
    }
    let capture = result.result;
    if (frames.length || Object.keys(assetData).length || finalCollection) {
      try {
        if (finalCollection && result.frameId === 0) finalScreenshot = await shot();
        capture = (
          await chrome.scripting.executeScript({
            target: { ...target, frameIds: [result.frameId] },
            func: (frames, assetData) =>
              globalThis.UICloneCapture.capture(document, {
                frames,
                assetData,
                fetchAssets: false,
              }),
            args: [frames, assetData],
          })
        )[0].result;
      } catch (error) {
        failures.push({
          frameId: result.frameId,
          error: { code: 'frame_capture_failed', message: message(error) },
        });
      }
    }
    merged.set(result.frameId, capture);
    return capture;
  }
  snapshot = await merge(results.find((r) => r.frameId === 0));
  const run = async (func, args = []) =>
    (await chrome.scripting.executeScript({ target, func, args }))[0]?.result;
  const active = async () =>
    (await chrome.tabs.query({ active: true, windowId: tab.windowId }))[0]?.id === tab.id;
  const initial = snapshot.source;
  let interrupted = false,
    restoreAfterInterruption = false,
    moved = false,
    lastCapture = 0;
  const sameViewport = async () =>
    await run(
      (source) =>
        location.href === source.url &&
        innerWidth === source.viewport.width &&
        innerHeight === source.viewport.height,
      [initial],
    );
  async function shot() {
    await nap(Math.max(0, 550 - (Date.now() - lastCapture)));
    await ensureSource('가져오는 동안 활성 탭·주소·화면 크기가 변경되었습니다.');
    const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    lastCapture = Date.now();
    await ensureSource('캡처 중 탭이나 화면이 변경되었습니다.');
    return image;
  }
  async function ensureSource(message) {
    const focused = await active(),
      same = await sameViewport().catch(() => false);
    if (!focused || !same) {
      interrupted = true;
      restoreAfterInterruption = !focused && same;
      throw Error(message);
    }
  }
  snapshot.screenshotTiles = [];
  try {
    if (
      !(await run((source) => globalThis.UICloneCapture.matchesView(document, source), [initial]))
    ) {
      interrupted = true;
      throw Error('가져오는 동안 스크롤이 변경되었습니다.');
    }
    snapshot.screenshot = await shot();
    snapshot.screenshotTiles = [];
    let limitHeight = Math.min(initial.height, 24000);
    const limitWidth = Math.min(initial.width, 6000);
    let pixels = 0,
      budgetTruncated = false;
    for (
      let y = 0;
      y < limitHeight && snapshot.screenshotTiles.length < 32;
      y += Math.max(100, initial.viewport.height - 400) / (y === 0 ? 2 : 1)
    ) {
      for (
        let x = 0;
        x < limitWidth && snapshot.screenshotTiles.length < 32;
        x += Math.max(100, initial.viewport.width - 100)
      ) {
        if (pixels + initial.viewport.width * initial.viewport.height > 40_000_000) {
          budgetTruncated = true;
          break;
        }
        await ensureSource('긴 화면 캡처 중 탭이나 화면이 변경되었습니다.');
        let view, data;
        for (let attempt = 0; attempt < 4; attempt++) {
          view = await run(
            async (x, y) => {
              window.scrollTo({ left: x, top: y, behavior: 'instant' });
              await new Promise((r) => setTimeout(r, 200));
              window.scrollTo({ left: x, top: y, behavior: 'instant' });
              await Promise.race([
                new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
                new Promise((r) => setTimeout(r, 250)),
              ]);
              return { x: scrollX, y: scrollY, width: innerWidth, height: innerHeight };
            },
            [x, y],
          );
          data = await shot();
          const after = await run(() => ({ x: scrollX, y: scrollY }));
          if (after.x === view.x && after.y === view.y && view.y <= y + 1) break;
          if (attempt === 3) {
            interrupted = true;
            throw Error('사용자 또는 페이지가 캡처 중 스크롤을 변경했습니다.');
          }
        }
        moved = true;
        if (x && snapshot.screenshotTiles.at(-1)?.rect.x === view.x) break;
        const inset = y
          ? await run(() => globalThis.UICloneCapture.headerInset?.(document) || 0)
          : 0;
        snapshot.screenshotTiles.push({
          rect: view,
          anchors: await run(() => globalThis.UICloneCapture.anchors?.(document) || []),
          clip: {
            x: view.x + (x ? 100 : 0),
            y: view.y + inset,
            width: view.width - (x ? 100 : 0),
            height: view.height - inset,
          },
          data,
        });
        pixels += view.width * view.height;
        if (view.x + view.width >= limitWidth) break;
      }
      const last = snapshot.screenshotTiles.at(-1);
      if (budgetTruncated) break;
      if (last && last.rect.y + last.rect.height >= limitHeight) {
        await nap(700);
        limitHeight = Math.min(
          24000,
          Math.max(
            limitHeight,
            await run(() => (document.scrollingElement || document.documentElement).scrollHeight),
          ),
        );
        if (last.rect.y + last.rect.height >= limitHeight) break;
      }
    }
    if (
      snapshot.screenshotTiles.length >= 32 ||
      budgetTruncated ||
      initial.height > limitHeight ||
      initial.width > limitWidth
    )
      snapshot.warnings.push({
        type: 'capture_limit',
        message: '긴 화면 캡처 한도로 일부 이미지 영역을 보완하지 못했습니다.',
      });
  } catch (error) {
    snapshot.warnings.push({ type: 'screenshot', message: message(error) });
  } finally {
    if (
      moved &&
      (!interrupted || restoreAfterInterruption) &&
      (await sameViewport().catch(() => false))
    )
      await run(
        (source) =>
          window.scrollTo({ left: source.scroll.x, top: source.scroll.y, behavior: 'instant' }),
        [initial],
      ).catch(() => {});
  }
  // Scrolling can reveal lazy DOM (including footer panels). Recollect the
  // editable tree after restoring the source, retaining the original pixels.
  if (!interrupted && (await sameViewport().catch(() => false))) {
    try {
      await run(async () => {
        await Promise.race([
          new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
          new Promise((r) => setTimeout(r, 250)),
        ]);
        await Promise.race([
          Promise.all(
            document
              .getAnimations({ subtree: true })
              .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime))
              .map((a) => a.finished.catch(() => {})),
          ),
          new Promise((r) => setTimeout(r, 2000)),
        ]);
      });
      const pictures = {
        screenshot: snapshot.screenshot,
        screenshotTiles: snapshot.screenshotTiles,
      };
      const pictureWarnings = snapshot.warnings.filter(
        (w) => w.type === 'screenshot' || w.type === 'capture_limit',
      );
      results = await chrome.scripting.executeScript({
        target: { ...target, allFrames: true },
        func: () => globalThis.UICloneCapture.capture(document, { fetchAssets: false }),
      });
      const fresh = await fetchPublicAssets(
        results.flatMap((r) =>
          (r.result?.warnings || [])
            .filter((w) => w.type === 'assets')
            .flatMap((w) => w.urls || []),
        ),
      );
      assetData = { ...assetData, ...fresh };
      merged.clear();
      failures.length = 0;
      await run(async () => {
        await Promise.race([
          Promise.all(
            document
              .getAnimations({ subtree: true })
              .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime))
              .map((a) => a.finished.catch(() => {})),
          ),
          new Promise((r) => setTimeout(r, 2000)),
        ]);
      });
      finalCollection = true;
      snapshot = await merge(results.find((r) => r.frameId === 0));
      Object.assign(snapshot, pictures);
      snapshot.warnings.push(...pictureWarnings);
      if (finalScreenshot) snapshot.screenshot = finalScreenshot;
    } catch (error) {
      snapshot.warnings.push({ type: 'capture_refresh', message: message(error) });
    }
  }
  const shifts = await run(
    (groups) => globalThis.UICloneCapture.alignAnchors?.(document, groups) || [],
    [(snapshot.screenshotTiles || []).map((t) => t.anchors || [])],
  );
  for (let i = 0; i < (snapshot.screenshotTiles || []).length; i++) {
    const tile = snapshot.screenshotTiles[i],
      shift = shifts[i];
    if (
      !shift ||
      Math.abs(shift.dx) > initial.viewport.width ||
      Math.abs(shift.dy) > initial.viewport.height ||
      Math.abs(shift.dx) + Math.abs(shift.dy) < 0.5
    )
      continue;
    tile.sourceRect = { ...tile.rect };
    tile.layoutShift = shift;
    tile.rect = { ...tile.rect, x: tile.rect.x + shift.dx, y: tile.rect.y + shift.dy };
    if (tile.clip)
      tile.clip = { ...tile.clip, x: tile.clip.x + shift.dx, y: tile.clip.y + shift.dy };
  }
  // Font/layout settling during DOM serialization can extend the final bottom
  // by a few pixels. Photograph that real footer after the final tree exists.
  const beforeBottom = Math.max(
    0,
    ...(snapshot.screenshotTiles || []).map((t) => t.rect.y + t.rect.height),
  );
  if (
    !interrupted &&
    snapshot.source.height > beforeBottom + 1 &&
    snapshot.source.height - beforeBottom < initial.viewport.height - 200 &&
    snapshot.screenshotTiles.length < 32
  ) {
    try {
      const view = await run(
        async (y) => {
          scrollTo({ left: 0, top: y, behavior: 'instant' });
          await new Promise((r) => setTimeout(r, 200));
          scrollTo({ left: 0, top: y, behavior: 'instant' });
          await Promise.race([
            new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
            new Promise((r) => setTimeout(r, 250)),
          ]);
          return { x: scrollX, y: scrollY, width: innerWidth, height: innerHeight };
        },
        [Math.max(0, snapshot.source.height - initial.viewport.height)],
      );
      const data = await shot();
      snapshot.screenshotTiles.push({
        rect: view,
        clip: { x: view.x, y: view.y + 200, width: view.width, height: view.height - 200 },
        data,
      });
    } catch (error) {
      snapshot.warnings.push({ type: 'screenshot', message: message(error) });
    } finally {
      await run(
        (source) => scrollTo({ left: source.scroll.x, top: source.scroll.y, behavior: 'instant' }),
        [initial],
      ).catch(() => {});
    }
  }
  snapshot.captureReport = {
    frameCount: results.length,
    domFrames: results.filter((r) => r.result?.html).length,
    failedFrames: failures,
    captureMode: 'extension-frame-dom-and-scroll-tiles',
    layoutAlignedTiles: snapshot.screenshotTiles.filter((t) => t.layoutShift).length,
  };
  const photographedBottom = Math.max(
    0,
    ...(snapshot.screenshotTiles || []).map((t) => t.rect.y + t.rect.height),
  );
  if (
    !interrupted &&
    !snapshot.warnings.some((w) => ['capture_limit', 'screenshot'].includes(w.type)) &&
    layoutAttempt < 2 &&
    snapshot.source.height <= 24000 &&
    snapshot.source.height > photographedBottom + 1
  )
    return captureChromeTab(chrome, tab, layoutAttempt + 1);
  snapshot.captureReport.layoutRetries = layoutAttempt;
  return snapshot;
}
