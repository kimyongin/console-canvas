export const isExtension =
  location.protocol === 'chrome-extension:' && !!globalThis.chrome?.runtime?.id;
