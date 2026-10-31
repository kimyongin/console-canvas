export const AI_CODE_LIMIT = 2_000_000;
export const AI_IMAGE_LIMIT = 15_000_000;
export function aiFailureMessage(code) {
  if (code === 'input_too_large')
    return '선택 영역의 코드가 너무 큽니다. 더 작은 영역을 선택해 시안을 요청하세요. 문서와 완료된 시안은 유지됩니다.';
  if (code === 'input_image_too_large')
    return '화면 이미지가 너무 큽니다. 가져올 화면 범위를 줄여 다시 요청하세요. 기존 문서는 유지됩니다.';
  if (code === 'model_unavailable')
    return '선택한 모델을 현재 계정 목록에서 찾지 못했습니다. AI API 연결에서 계정·모델을 새로고침하세요.';
  if (code === 'generation_invalid')
    return '앱에서 요청 형식 또는 입력 크기를 확인하지 못했습니다. 더 작은 영역으로 새 요청을 만들어 보세요.';
  if (['candidate_invalid', 'invalid_css_property', 'invalid_output'].includes(code))
    return 'AI 응답을 안전한 편집으로 적용하지 못했습니다. 문서와 완료된 시안은 유지됩니다. 요청을 구체화해 다시 시도하세요.';
  return '시안 생성에 실패했습니다. AI API 연결에서 계정·인증·모델·사용 한도를 확인하세요. 완료된 시안은 유지됩니다.';
}
export function aiInputError(code) {
  return Object.assign(new Error(aiFailureMessage(code)), { code });
}
export function validateAiInput(context) {
  const { image_url, images = [], ...code } = context;
  if (JSON.stringify(code).length > AI_CODE_LIMIT) throw aiInputError('input_too_large');
  if (
    image_url &&
    (typeof image_url !== 'string' || image_url.length > (AI_IMAGE_LIMIT * 4) / 3 + 100)
  )
    throw aiInputError('input_image_too_large');
  if (
    !Array.isArray(images) ||
    images.length > 8 ||
    images.reduce(
      (n, i) => n + (typeof i.image_url === 'string' ? i.image_url.length : Infinity),
      0,
    ) >
      (AI_IMAGE_LIMIT * 4) / 3 + 100 * 8
  )
    throw aiInputError('input_image_too_large');
}
