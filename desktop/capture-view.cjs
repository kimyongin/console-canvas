// Bring lazy-loaded public view content into the renderer before freezing the
// DOM/resources. Only the viewport moves; no service controls are activated.
async function prepareCaptureView(contents) {
  const read = (expression) =>
    contents.executeJavaScriptInIsolatedWorld(1002, [{ code: expression }]);
  const original = await read(
    '({url:location.href,x:scrollX,y:scrollY,width:innerWidth,height:innerHeight})',
  );
  let steps = 0;
  try {
    for (
      let y = 0;
      y <
        Math.min(
          await read(
            'Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0)',
          ),
          24000,
        ) && steps < 32;
      y += Math.max(300, original.height - 200)
    ) {
      if ((await read('location.href')) !== original.url)
        throw Error('가져오는 동안 원본 주소가 변경되었습니다.');
      await read(
        `(async()=>{scrollTo({left:${original.x},top:${y},behavior:'instant'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const images=[...document.images].filter(i=>{const r=i.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight});await Promise.race([Promise.all(images.map(i=>i.decode().catch(()=>{}))),new Promise(r=>setTimeout(r,500))]);})()`,
      );
      steps++;
    }
  } finally {
    if ((await read('location.href')) === original.url)
      await read(
        `(async()=>{scrollTo({left:${original.x},top:${original.y},behavior:'instant'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`,
      );
  }
  await read(
    `new Promise(resolve=>{let quiet,limit,finished=false;const done=()=>{if(finished)return;finished=true;clearTimeout(quiet);clearTimeout(limit);observer.disconnect();resolve()};const observer=new MutationObserver(()=>{clearTimeout(quiet);quiet=setTimeout(done,350)});observer.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});quiet=setTimeout(done,350);limit=setTimeout(done,2000)})`,
  );
  return { steps, restored: true };
}
module.exports = { prepareCaptureView };
