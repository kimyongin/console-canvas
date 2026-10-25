export function cleanLayerNames(value) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 100000)
    throw new Error('레이어 별칭 형식이 올바르지 않습니다.');
  for (const [id, name] of Object.entries(value))
    if (!id || id.length > 200 || typeof name !== 'string' || !name.trim() || name.length > 120)
      throw new Error('레이어 별칭은 1~120자여야 합니다.');
  return Object.fromEntries(Object.entries(value).map(([id, name]) => [id, name.trim()]));
}
