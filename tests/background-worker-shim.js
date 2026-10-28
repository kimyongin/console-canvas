// Only the Chrome event registration API is mocked; the production imports stay intact.
globalThis.chrome = {
  action: {
    onClicked: {
      addListener(listener) {
        globalThis.captureListenerReady = typeof listener === 'function';
      },
    },
  },
};
