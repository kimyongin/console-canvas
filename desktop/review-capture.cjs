// Only the trusted editor can create a capture destination. Captured pages cannot.
function createReviewCapture() {
  let target = null;
  return {
    current: () => target && { ...target },
    begin(value) {
      if (
        !value ||
        !['request_id', 'review_id', 'document_id', 'label'].every(
          (k) => typeof value[k] === 'string' && value[k].length > 0 && value[k].length <= 160,
        )
      )
        throw Error('구현 검토 대상이 올바르지 않습니다.');
      target = Object.fromEntries(
        ['request_id', 'review_id', 'document_id', 'label'].map((k) => [k, value[k]]),
      );
      return { ...target };
    },
    clear(requestId) {
      if (!target || target.request_id !== requestId) return false;
      target = null;
      return true;
    },
  };
}
module.exports = { createReviewCapture };
