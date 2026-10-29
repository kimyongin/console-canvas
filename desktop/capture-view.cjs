// Bring lazy-loaded public view content into the renderer before freezing the
// DOM/resources. Only the viewport moves; no service controls are activated.
async function prepareCaptureView(contents, collectorCode = '', { timeoutMs = 10000 } = {}) {
  const read = async (expression) => {
    let timer;
    try {
      return await Promise.race([
        contents.executeJavaScriptInIsolatedWorld(1002, [{ code: expression }]),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Error('원본 화면 응답이 지연되어 가져오기를 중단했습니다.')),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  if (collectorCode) await read(collectorCode);
  const original = await read(
    '({url:location.href,x:scrollX,y:scrollY,width:innerWidth,height:innerHeight})',
  );
  let steps = 0;
  try {
    for (
      let y = 0;
      y <
        Math.min(
          await read('(document.scrollingElement||document.documentElement).scrollHeight'),
          24000,
        ) && steps < 32;
      y += Math.max(300, original.height - 200)
    ) {
      if ((await read('location.href')) !== original.url)
        throw Error('가져오는 동안 원본 주소가 변경되었습니다.');
      await read(
        `(async()=>{scrollTo({left:${original.x},top:${y},behavior:'instant'});await Promise.race([new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))),new Promise(r=>setTimeout(r,250))]);await globalThis.UICloneCapture?.settleVisibleMedia(document);})()`,
      );
      steps++;
    }
  } finally {
    if ((await read('location.href')) === original.url)
      await read(
        `(async()=>{scrollTo({left:${original.x},top:${original.y},behavior:'instant'});await Promise.race([new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))),new Promise(r=>setTimeout(r,250))]);})()`,
      );
  }
  await read(
    `new Promise(resolve=>{let quiet,limit,finished=false;const done=()=>{if(finished)return;finished=true;clearTimeout(quiet);clearTimeout(limit);observer.disconnect();resolve()};const observer=new MutationObserver(()=>{clearTimeout(quiet);quiet=setTimeout(done,350)});observer.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});quiet=setTimeout(done,350);limit=setTimeout(done,2000)})`,
  );
  return { steps, restored: true };
}
module.exports = { prepareCaptureView };
