// React wraps the native event; Chromium also exposes legacy IME keyCode 229.
export function isComposingKey(event) {
  const native = event.nativeEvent || event;
  return !!(native.isComposing || native.keyCode === 229);
}
