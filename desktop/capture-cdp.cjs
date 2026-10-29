// Read-only capture in each frame's own isolated world. The transport is shared
// by embedded Chromium and browser integration tests; it never disables SOP.
const MAX_FRAMES = 32;
async function captureWithProtocol({
  send,
  code,
  onProgress = () => {},
  getTargets = () => [],
  beforeScreenshot = async () => {},
}) {
  const screenshot = async (params) => {
    await beforeScreenshot();
    return send('Page.captureScreenshot', params);
  };
  await send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });
  await send('Page.enable', {});
  await send('Network.enable', {});
  const { frameTree } = await send('Page.getFrameTree', {});
  const frames = [],
    started = Date.now();
  function visit(tree, parent = null, depth = 0) {
    if (frames.length >= MAX_FRAMES || depth > 5) return;
    if (frames.some((frame) => frame.id === tree.frame.id)) return;
    const item = { ...tree.frame, parent, depth, session: null };
    frames.push(item);
    for (const child of tree.childFrames || []) visit(child, item, depth + 1);
  }
  visit(frameTree);
  const root = frames[0];
  const seenTargets = new Set();
  for (let round = 0; round < 6; round++) {
    const targets = (await getTargets()).filter(
      (t) => t.targetInfo?.type === 'iframe' && !seenTargets.has(t.sessionId),
    );
    if (!targets.length) break;
    for (const target of targets) {
      seenTargets.add(target.sessionId);
      try {
        await send(
          'Target.setAutoAttach',
          { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
          target.sessionId,
        );
        await send('Page.enable', {}, target.sessionId);
        await send('Network.enable', {}, target.sessionId);
        const tree = (await send('Page.getFrameTree', {}, target.sessionId)).frameTree;
        const parent = frames.find((f) => f.id === tree.frame.parentId) || root;
        const start = frames.length;
        visit(tree, parent, parent.depth + 1);
        for (const frame of frames.slice(start)) frame.session = target.sessionId;
      } catch {}
    }
  }
  const call = (frame, method, params = {}) => send(method, params, frame.session);
  async function resourceContent(frame, resource) {
    try {
      return await call(frame, 'Page.getResourceContent', { frameId: frame.id, url: resource.url });
    } catch {
      // Fonts may have left Blink's text-resource cache. Read only an already
      // observed page resource through Chromium's inspector loader.
      const loaded = (
        await call(frame, 'Network.loadNetworkResource', {
          frameId: frame.id,
          url: resource.url,
          options: {
            disableCache: false,
            includeCredentials: new URL(resource.url).origin === frame.securityOrigin,
          },
        })
      ).resource;
      if (!loaded?.success || !loaded.stream) throw Error('원본 리소스를 읽지 못했습니다.');
      const chunks = [];
      let length = 0;
      try {
        while (true) {
          const part = await call(frame, 'IO.read', { handle: loaded.stream, size: 262144 });
          const data = Buffer.from(part.data, part.base64Encoded ? 'base64' : 'utf8');
          length += data.length;
          if (length > 5_000_000) throw Error('리소스 크기 한도');
          chunks.push(data);
          if (part.eof) break;
        }
        return { content: Buffer.concat(chunks).toString('base64'), base64Encoded: true };
      } finally {
        await call(frame, 'IO.close', { handle: loaded.stream }).catch(() => {});
      }
    }
  }
  async function evaluate(frame, expression) {
    const result = await call(frame, 'Runtime.evaluate', {
      expression,
      contextId: frame.context,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  }
  async function registerShadows(frame) {
    try {
      await call(frame, 'DOM.enable');
      const tree = (await call(frame, 'DOM.getDocument', { depth: -1, pierce: true })).root;
      const roots = [];
      function scan(node) {
        for (const shadow of node.shadowRoots || []) {
          if (shadow.shadowRootType === 'closed') roots.push(shadow);
          scan(shadow);
        }
        for (const child of node.children || []) scan(child);
        if (node.contentDocument) scan(node.contentDocument);
      }
      scan(tree);
      for (const shadow of roots) {
        const resolved = await call(frame, 'DOM.resolveNode', {
          backendNodeId: shadow.backendNodeId,
          executionContextId: frame.context,
        });
        try {
          await call(frame, 'Runtime.callFunctionOn', {
            objectId: resolved.object.objectId,
            functionDeclaration:
              'function(){globalThis.UICloneCapture.registerShadow(this);return true}',
            returnByValue: true,
          });
        } finally {
          await call(frame, 'Runtime.releaseObject', {
            objectId: resolved.object.objectId,
          }).catch(() => {});
        }
      }
      frame.closedShadowRoots = roots.length;
    } catch (error) {
      frame.shadowCaptureError = error.message;
    }
  }
  for (const frame of frames) {
    try {
      let context;
      try {
        context = await call(frame, 'Page.createIsolatedWorld', {
          frameId: frame.id,
          worldName: 'console-canvas-capture',
          grantUniveralAccess: false,
        });
      } catch (error) {
        if (frame === root) throw error;
        const attached = await send('Target.attachToTarget', {
          targetId: frame.id,
          flatten: true,
        });
        frame.session = attached.sessionId;
        await call(frame, 'Page.enable');
        await call(frame, 'Network.enable');
        context = await call(frame, 'Page.createIsolatedWorld', {
          frameId: frame.id,
          worldName: 'console-canvas-capture',
          grantUniveralAccess: false,
        });
      }
      frame.context = context.executionContextId;
      await evaluate(frame, code + '\n;true');
      await registerShadows(frame);
      if (frame.parent?.context) {
        const owner = await call(frame.parent, 'DOM.getFrameOwner', { frameId: frame.id });
        const resolved = await call(frame.parent, 'DOM.resolveNode', {
          backendNodeId: owner.backendNodeId,
          executionContextId: frame.parent.context,
        });
        try {
          const result = await call(frame.parent, 'Runtime.callFunctionOn', {
            objectId: resolved.object.objectId,
            functionDeclaration: 'function(){return globalThis.UICloneCapture.frameIndex(this)}',
            returnByValue: true,
          });
          frame.index = result.result.value;
        } finally {
          await call(frame.parent, 'Runtime.releaseObject', {
            objectId: resolved.object.objectId,
          }).catch(() => {});
        }
      }
    } catch (error) {
      frame.error = { code: 'frame_capture_unavailable', message: error.message };
    }
  }
  if (root.error) throw Error(root.error.message);
  // Paint first so entrance animations have actually started before settling.
  await beforeScreenshot();
  await evaluate(
    root,
    `Promise.race([Promise.all(document.getAnimations({subtree:true}).filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{}))),new Promise(r=>setTimeout(r,2000))])`,
  );
  await beforeScreenshot();
  const assetData = {},
    fontCss = [];
  let assetBytes = 0,
    resourceCount = 0;
  const resourceDeadline = Date.now() + 12000;
  for (const frame of frames.filter((f) => !f.error)) {
    if (Date.now() > resourceDeadline || resourceCount >= 400) break;
    let resources;
    try {
      const tree = (await call(frame, 'Page.getResourceTree')).frameTree;
      const find = (item) =>
        item.frame.id === frame.id ? item : (item.childFrames || []).map(find).find(Boolean);
      resources = (find(tree)?.resources || []).sort(
        (a, b) =>
          (({ Font: 0, Stylesheet: 1, Image: 2 })[a.type] ?? 3) -
          ({ Font: 0, Stylesheet: 1, Image: 2 }[b.type] ?? 3),
      );
    } catch {
      continue;
    }
    for (
      let i = 0;
      i < Math.min(resources.length, 250) && Date.now() < resourceDeadline && resourceCount < 400;
      i += 8
    ) {
      await Promise.all(
        resources.slice(i, i + 8).map(async (resource) => {
          if (assetData[resource.url] || !['Image', 'Font', 'Stylesheet'].includes(resource.type))
            return;
          try {
            if (resourceCount++ >= 400) return;
            const value = await resourceContent(frame, resource);
            const bytes = value.base64Encoded
              ? Buffer.from(value.content, 'base64')
              : Buffer.from(value.content);
            if (bytes.length > 5_000_000 || assetBytes + bytes.length > 25_000_000) return;
            if (resource.type === 'Stylesheet') {
              for (const match of bytes.toString().matchAll(/@font-face\s*\{[^}]*\}/gi))
                fontCss.push(
                  match[0].replace(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g, (all, url) => {
                    try {
                      return (
                        'url("' + new URL(url, resource.url).href.replaceAll('"', '%22') + '")'
                      );
                    } catch {
                      return all;
                    }
                  }),
                );
            } else {
              const mime =
                resource.type === 'Font'
                  ? bytes.toString('ascii', 0, 4) === 'wOF2'
                    ? 'font/woff2'
                    : bytes.toString('ascii', 0, 4) === 'wOFF'
                      ? 'font/woff'
                      : 'font/ttf'
                  : resource.mimeType === 'binary/octet-stream'
                    ? 'application/octet-stream'
                    : resource.mimeType || 'application/octet-stream';
              if (!/^(image\/|font\/|application\/(font|x-font|octet-stream))/.test(mime)) return;
              assetData[resource.url] = `data:${mime};base64,${bytes.toString('base64')}`;
              assetBytes += bytes.length;
            }
          } catch {}
        }),
      );
    }
  }
  const missingFonts = [
    ...new Set(
      fontCss.flatMap((css) =>
        [...css.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/g)].map((m) => m[1]),
      ),
    ),
  ]
    .filter((url) => /^https?:/.test(url) && !assetData[url])
    .slice(0, 80);
  for (const url of await evaluate(root, 'globalThis.UICloneCapture.collectAssets(document)'))
    if (!assetData[url] && !missingFonts.includes(url) && missingFonts.length < 180)
      missingFonts.push(url);
  if (missingFonts.length) {
    const fetched = await evaluate(
      root,
      `(async()=>Promise.all(${JSON.stringify(missingFonts)}.map(async url=>{try{const response=await fetch(url,{credentials:'same-origin',signal:AbortSignal.timeout(2000)});if(!response.ok)return null;const blob=await response.blob();if(blob.size>5000000||!(blob.type.startsWith('image/')||blob.type.startsWith('font/')||['application/font','application/x-font','application/octet-stream','binary/octet-stream'].some(m=>blob.type.startsWith(m))))return null;const data=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>resolve(null);reader.readAsDataURL(blob.type==='binary/octet-stream'?new Blob([blob],{type:new URL(url).pathname.endsWith('.woff2')?'font/woff2':new URL(url).pathname.endsWith('.woff')?'font/woff':'application/octet-stream'}):blob)});return data?{url,data}:null}catch{return null}})))()`,
    );
    for (const item of fetched || []) if (item) assetData[item.url] = item.data;
  }
  async function capturePictures(snapshot) {
    await evaluate(root, 'globalThis.UICloneCapture.watchSurface(document)');
    try {
      const { cssContentSize } = await send('Page.getLayoutMetrics', {});
      const width = Math.min(
        6000,
        Math.max(snapshot.source.viewport.width, Math.ceil(cssContentSize.width)),
      );
      let height = Math.min(
        40000,
        Math.max(snapshot.source.viewport.height, Math.ceil(cssContentSize.height)),
      );
      const ratio = await evaluate(root, 'devicePixelRatio || 1');
      const current = {
        x: snapshot.source.scroll.x,
        y: snapshot.source.scroll.y,
        ...snapshot.source.viewport,
      };
      const matches = () =>
        evaluate(
          root,
          'globalThis.UICloneCapture.matchesView(document,' + JSON.stringify(snapshot.source) + ')',
        );
      let animatedSurface = false;
      if (await matches()) {
        const view = await screenshot({
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: false,
          clip: { ...current, scale: 1 / ratio },
        });
        snapshot.screenshot = 'data:image/png;base64,' + view.data;
        snapshot.screenshotTiles = [];
        let pixels = 0,
          budgetTruncated = false;
        const hasSurfaceAnimation = () =>
          evaluate(
            root,
            `document.getAnimations({subtree:true}).some(a=>{const r=a.effect?.target?.getBoundingClientRect();return r && r.width*r.height>innerWidth*innerHeight*.6 && a.effect.getKeyframes().some(k=>k.opacity!==undefined)}) || globalThis.UICloneCapture.surfaceChanged()`,
          );
        animatedSurface = await hasSurfaceAnimation();
        if (!animatedSurface) {
          const tileHeight = Math.max(1, Math.min(height, Math.floor(40_000_000 / width)));
          for (let y = 0; y < height && snapshot.screenshotTiles.length < 32; y += tileHeight) {
            const rect = { x: 0, y, width, height: Math.min(tileHeight, height - y) };
            if (pixels + rect.width * rect.height > 40_000_000) {
              budgetTruncated = true;
              break;
            }
            const tile = await screenshot({
              format: 'png',
              fromSurface: true,
              captureBeyondViewport: true,
              clip: { ...rect, scale: 1 / ratio },
            });
            snapshot.screenshotTiles.push({ rect, data: 'data:image/png;base64,' + tile.data });
            pixels += rect.width * rect.height;
            if (await hasSurfaceAnimation()) {
              animatedSurface = true;
              break;
            }
          }
        }
        if (animatedSurface) {
          await evaluate(
            root,
            `Promise.race([Promise.all(document.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{}))),new Promise(r=>setTimeout(r,1200))])`,
          );
          snapshot.screenshotTiles = [];
          pixels = 0;
          try {
            for (
              let y = 0;
              y < height && snapshot.screenshotTiles.length < 32;
              y += Math.max(300, current.height - 400) / (y === 0 ? 2 : 1)
            ) {
              if (pixels + current.width * current.height > 40_000_000) {
                budgetTruncated = true;
                break;
              }
              let scroll, tile;
              for (let attempt = 0; attempt < 4; attempt++) {
                scroll = await evaluate(
                  root,
                  `(async()=>{if(location.href!==${JSON.stringify(snapshot.source.url)})throw Error('Source navigated');scrollTo({left:0,top:${y},behavior:'instant'});await new Promise(r=>setTimeout(r,200));scrollTo({left:0,top:${y},behavior:'instant'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))));return {x:scrollX,y:scrollY}})()`,
                );
                tile = await screenshot({
                  format: 'png',
                  fromSurface: true,
                  captureBeyondViewport: false,
                  clip: {
                    ...scroll,
                    width: current.width,
                    height: current.height,
                    scale: 1 / ratio,
                  },
                });
                const after = await evaluate(root, '({x:scrollX,y:scrollY})');
                if (after.x === scroll.x && after.y === scroll.y && scroll.y <= y + 1) break;
                if (attempt === 3)
                  throw Error(
                    '페이지의 자동 스크롤이 안정되지 않아 전체 촬영을 완료하지 못했습니다.',
                  );
              }
              const rect = { ...scroll, width: current.width, height: current.height };
              const inset = y
                ? await evaluate(root, 'globalThis.UICloneCapture.headerInset(document)')
                : 0;
              snapshot.screenshotTiles.push({
                rect,
                anchors: await evaluate(root, 'globalThis.UICloneCapture.anchors(document)'),
                clip: {
                  x: rect.x,
                  y: rect.y + inset,
                  width: rect.width,
                  height: rect.height - inset,
                },
                data: 'data:image/png;base64,' + tile.data,
              });
              pixels += rect.width * rect.height;
              height = Math.min(
                40000,
                Math.max(
                  height,
                  Math.ceil((await send('Page.getLayoutMetrics', {})).cssContentSize.height),
                ),
              );
              if (scroll.y + rect.height >= height) {
                await evaluate(root, 'new Promise(r=>setTimeout(r,700))');
                height = Math.min(
                  40000,
                  Math.max(
                    height,
                    Math.ceil((await send('Page.getLayoutMetrics', {})).cssContentSize.height),
                  ),
                );
                if (scroll.y + rect.height >= height) break;
              }
            }
          } finally {
            await evaluate(
              root,
              `(async()=>{if(location.href!==${JSON.stringify(snapshot.source.url)})return;scrollTo({left:${current.x},top:${current.y},behavior:'instant'});await new Promise(r=>setTimeout(r,250));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`,
            );
          }
        }
        // Scrollbars/layout clamping can leave a short strip beyond the final
        // scroll position. Photograph that strip rather than assuming coverage.
        const coveredBottom = Math.max(
          0,
          ...snapshot.screenshotTiles.map((t) => t.rect.y + t.rect.height),
        );
        if (
          coveredBottom < height &&
          snapshot.screenshotTiles.length < 32 &&
          pixels + width * (height - coveredBottom) <= 40_000_000
        ) {
          const rect = { x: 0, y: coveredBottom, width, height: height - coveredBottom };
          const tail = await screenshot({
            format: 'png',
            fromSurface: true,
            captureBeyondViewport: true,
            clip: { ...rect, scale: 1 / ratio },
          });
          snapshot.screenshotTiles.push({ rect, data: 'data:image/png;base64,' + tail.data });
          pixels += rect.width * rect.height;
        }
        // Offscreen OOPIF surfaces can remain blank in beyond-viewport captures.
        // Paint them in the real viewport, and overlay only the frame rectangle.
        let correctedFrames = 0;
        try {
          const candidates = animatedSurface
            ? []
            : snapshot.nodes.filter((n) => n.tag === 'iframe' && n.visible);
          for (const node of candidates.slice(0, 16)) {
            const area = node.frame?.contentRect || node.rect;
            for (
              let y = area.y;
              y < area.y + area.height;
              y += Math.max(100, current.height - 200)
            ) {
              if (snapshot.screenshotTiles.length >= 32) break;
              const view = await evaluate(
                root,
                `(async()=>{scrollTo({left:${Math.max(0, area.x - 20)},top:${Math.max(0, y - 50)},behavior:'instant'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))));return {x:scrollX,y:scrollY,width:innerWidth,height:innerHeight};})()`,
              );
              const x = Math.max(area.x, view.x),
                top = Math.max(area.y, view.y),
                right = Math.min(area.x + area.width, view.x + view.width),
                bottom = Math.min(area.y + area.height, view.y + view.height);
              if (right <= x || bottom <= top) continue;
              const tile = await screenshot({
                format: 'png',
                fromSurface: true,
                captureBeyondViewport: false,
                clip: { ...view, scale: 1 / ratio },
              });
              snapshot.screenshotTiles.push({
                rect: view,
                clip: { x, y: top, width: right - x, height: bottom - top },
                data: 'data:image/png;base64,' + tile.data,
              });
              if (bottom >= area.y + area.height) break;
            }
            correctedFrames++;
          }
        } finally {
          await evaluate(
            root,
            `(async()=>{if(location.href!==${JSON.stringify(snapshot.source.url)})return;scrollTo({left:${current.x},top:${current.y},behavior:'instant'});await new Promise(r=>setTimeout(r,250));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`,
          );
        }
        snapshot.captureCorrections = correctedFrames;
        if (!(await matches())) {
          snapshot.screenshot = null;
          snapshot.screenshotTiles = [];
          snapshot.warnings.push({
            type: 'screenshot',
            message: '가져오는 동안 주소·화면 크기·스크롤이 변경되어 이미지 캡처를 생략했습니다.',
          });
        }
        if (
          budgetTruncated ||
          (snapshot.screenshotTiles.length >= 32 &&
            Math.max(0, ...snapshot.screenshotTiles.map((t) => t.rect.y + t.rect.height)) <
              height) ||
          cssContentSize.height > height ||
          cssContentSize.width > width
        )
          snapshot.warnings.push({
            type: 'capture_limit',
            message: '화면 캡처 한도로 일부 영역의 이미지 보완을 하지 못했습니다.',
          });
      }
      await evaluate(
        root,
        `Promise.race([Promise.all(document.getAnimations({subtree:true}).filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{}))),new Promise(r=>setTimeout(r,1200))])`,
      );
      snapshot.captureReport = {
        contentSize: { width, height },
        frameCount: frames.length,
        domFrames: frames.filter((f) => f.snapshot && !f.error).length,
        failedFrames: frames.filter((f) => f.error).map((f) => ({ url: f.url, error: f.error })),
        embeddedResourceCount: Object.keys(assetData).length,
        screenshotMode: animatedSurface ? 'viewport-scroll' : 'document-surface',
      };
      if (await matches()) {
        const view = await screenshot({
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: false,
          clip: { ...current, scale: 1 / ratio },
        });
        snapshot.screenshot = 'data:image/png;base64,' + view.data;
      }
      return snapshot;
    } finally {
      await evaluate(root, 'globalThis.UICloneCapture.stopSurfaceWatch()').catch(() => {});
    }
  }
  for (let depth = Math.max(...frames.map((f) => f.depth)); depth >= 0; depth--) {
    await Promise.all(
      frames
        .filter((f) => f.depth === depth && !f.error)
        .map(async (frame) => {
          try {
            const children = frames
              .filter((child) => child.parent === frame && child.index >= 0)
              .map((child) => ({
                index: child.index,
                ...(child.snapshot
                  ? { snapshot: child.snapshot }
                  : {
                      error: child.error || {
                        code: 'frame_capture_unavailable',
                        message: 'Frame did not finish loading',
                      },
                    }),
              }));
            let expression =
              'globalThis.UICloneCapture.capture(document,' +
              JSON.stringify({
                includeFrames: false,
                fetchAssets: false,
                frames: children,
                assetData,
                fontCss,
              }) +
              ')';
            if (frame === root) {
              const source = await evaluate(
                root,
                '({url:location.href,viewport:{width:innerWidth,height:innerHeight},scroll:{x:scrollX,y:scrollY}})',
              );
              const nodes = await evaluate(
                root,
                `globalThis.UICloneCapture.frames(document).map(e=>{const r=e.getBoundingClientRect(),sx=r.width/(e.offsetWidth||r.width||1),sy=r.height/(e.offsetHeight||r.height||1);return {tag:'iframe',visible:r.width>0&&r.height>0,rect:{x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height},frame:{contentRect:{x:r.left+scrollX+e.clientLeft*sx,y:r.top+scrollY+e.clientTop*sy,width:e.clientWidth*sx,height:e.clientHeight*sy}}}})`,
              );
              try {
                root.pictures = await capturePictures({ source, nodes, warnings: [] });
              } catch (error) {
                root.pictureError = error.message;
              }
            }
            if (frame === root) {
              for (const child of frames.filter((f) => f !== root && f.snapshot && f.fingerprint)) {
                let changed = false;
                try {
                  changed =
                    child.fingerprint !==
                    (await evaluate(child, 'globalThis.UICloneCapture.fingerprint(document)'));
                } catch {
                  changed = true;
                }
                if (!changed) continue;
                let owner = child;
                while (owner.parent && owner.parent !== root) owner = owner.parent;
                owner.error = {
                  code: 'frame_changed_during_capture',
                  message: '수집 중 프레임 내용이 바뀌어 촬영한 이미지로 보존합니다.',
                };
                const entry = children.find((c) => c.index === owner.index);
                if (entry) {
                  delete entry.snapshot;
                  entry.error = owner.error;
                }
              }
              expression =
                'globalThis.UICloneCapture.capture(document,' +
                JSON.stringify({
                  includeFrames: false,
                  fetchAssets: false,
                  frames: children,
                  assetData,
                  fontCss,
                }) +
                ')';
            }
            await evaluate(
              frame,
              `Promise.race([Promise.all([document.fonts.ready,...[...document.images].filter(i=>{const r=i.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight}).map(i=>i.decode().catch(()=>{}))]),new Promise(r=>setTimeout(r,1000))])`,
            );
            await registerShadows(frame);
            if (frame !== root)
              frame.fingerprint = await evaluate(
                frame,
                'globalThis.UICloneCapture.fingerprint(document)',
              );
            frame.snapshot = await evaluate(frame, expression);
            if (frame === root) {
              for (
                let retry = 0;
                retry < 2 &&
                root.pictures?.captureReport &&
                frame.snapshot.source.height > root.pictures.captureReport.contentSize.height + 1;
                retry++
              ) {
                root.pictures = await capturePictures({
                  source: frame.snapshot.source,
                  nodes: frame.snapshot.nodes,
                  warnings: [],
                });
                frame.snapshot = await evaluate(frame, expression);
                root.pictures.captureReport.layoutRetries = retry + 1;
              }
            }
          } catch (error) {
            frame.error = { code: 'frame_capture_failed', message: error.message };
          }
        }),
    );
    onProgress({
      phase: 'frames',
      depth,
      completed: frames.filter((f) => f.snapshot && !f.error).length,
      total: frames.length,
    });
  }
  const snapshot = root.snapshot;
  if (!snapshot?.html) throw Error(root.error?.message || '화면을 가져오지 못했습니다.');
  snapshot.captureReport = {
    frameCount: frames.length,
    domFrames: frames.filter((f) => f.snapshot && !f.error).length,
    failedFrames: frames.filter((f) => f.error).map((f) => ({ url: f.url, error: f.error })),
  };
  if (root.pictureError) snapshot.warnings.push({ type: 'screenshot', message: root.pictureError });
  const pictures = root.pictures;
  if (pictures) {
    const shifts = await evaluate(
      root,
      'globalThis.UICloneCapture.alignAnchors(document,' +
        JSON.stringify((pictures.screenshotTiles || []).map((t) => t.anchors || [])) +
        ')',
    );
    for (let i = 0; i < (pictures.screenshotTiles || []).length; i++) {
      const tile = pictures.screenshotTiles[i],
        shift = shifts[i];
      if (
        !shift ||
        Math.abs(shift.dx) > snapshot.source.viewport.width ||
        Math.abs(shift.dy) > snapshot.source.viewport.height ||
        Math.abs(shift.dx) + Math.abs(shift.dy) < 0.5
      )
        continue;
      tile.sourceRect = { ...tile.rect };
      tile.layoutShift = shift;
      tile.rect = { ...tile.rect, x: tile.rect.x + shift.dx, y: tile.rect.y + shift.dy };
      if (tile.clip)
        tile.clip = { ...tile.clip, x: tile.clip.x + shift.dx, y: tile.clip.y + shift.dy };
    }
    snapshot.screenshot = pictures.screenshot;
    snapshot.screenshotTiles = pictures.screenshotTiles;
    snapshot.captureCorrections = pictures.captureCorrections;
    snapshot.captureReport = pictures.captureReport;
    snapshot.captureReport.layoutAlignedTiles = pictures.screenshotTiles.filter(
      (t) => t.layoutShift,
    ).length;
    snapshot.captureReport.closedShadowRoots = frames.reduce(
      (total, f) => total + (f.closedShadowRoots || 0),
      0,
    );
    snapshot.captureReport.frameCount = frames.length;
    snapshot.captureReport.domFrames = frames.filter((f) => f.snapshot && !f.error).length;
    snapshot.captureReport.failedFrames = frames
      .filter((f) => f.error)
      .map((f) => ({ url: f.url, error: f.error }));
    snapshot.warnings.push(...pictures.warnings);
  }
  snapshot.captureReport.finalContentSize = (
    await send('Page.getLayoutMetrics', {})
  ).cssContentSize;
  snapshot.captureReport.finalDocumentSize = await evaluate(
    root,
    '({html:document.documentElement.scrollHeight,body:document.body.scrollHeight,overflow:getComputedStyle(document.body).overflowY})',
  );
  snapshot.captureReport.elapsedMs = Date.now() - started;
  return snapshot;
}
module.exports = { captureWithProtocol };
