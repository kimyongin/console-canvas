// Operates only on inert exported copies, never on source websites.
export function restoreSerializedScroll(doc) {
  for (const el of doc.querySelectorAll('[data-uic-scroll-x],[data-uic-scroll-y]')) {
    const x = Number(el.getAttribute('data-uic-scroll-x') || 0),
      y = Number(el.getAttribute('data-uic-scroll-y') || 0);
    if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 60000 && Math.abs(y) <= 200000) {
      el.scrollLeft = x;
      el.scrollTop = y;
    }
  }
}
