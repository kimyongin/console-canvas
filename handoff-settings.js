// Shared with the MV3 service worker: keep this module free of DOM/render imports.
export function cleanHandoffSettings(value) {
  return { mode: value?.mode === 'exact' ? 'exact' : 'reference' };
}
