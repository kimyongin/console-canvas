export const AI_IMAGE_LIMIT = 12 * 1024 * 1024;
export function aiInputError(code) {
  const error = new Error('이미지 맥락 크기 한도를 초과했습니다. 더 작은 범위를 선택해 주세요.');
  error.code = code;
  return error;
}
