import { CanvasScene, copy } from './engine.js';
export async function withSceneCopy(snapshot, point, run) {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;left:-100000px;top:0;border:0;visibility:hidden';
  document.body.append(frame);
  try {
    const scene = new CanvasScene(frame, copy(snapshot));
    await scene.mount();
    scene.setResourceRepairs(point.resourceRepairs || []);
    scene.setEdits(point.edits || {});
    scene.setComments(point.annotations || {});
    return await run(scene);
  } finally {
    frame.remove();
  }
}
