import './background-worker-shim.js';
import '../background.js';
self.addEventListener('message', (event) => {
  event.ports[0]?.postMessage({ ready: globalThis.captureListenerReady === true });
});
