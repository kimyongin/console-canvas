const { readPublicResource } = require('./capture-resources.cjs');
function mime(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  const magic = bytes.toString('ascii', 0, 4);
  if (['GIF8'].includes(magic)) return 'image/gif';
  if (magic === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.toString('ascii', 4, 8) === 'ftyp' && /avif|avis/.test(bytes.toString('ascii', 8, 32)))
    return 'image/avif';
  if (magic === 'wOFF') return 'font/woff';
  if (magic === 'wOF2') return 'font/woff2';
  if (magic === 'OTTO') return 'font/otf';
  if (bytes.readUInt32BE(0) === 0x00010000) return 'font/ttf';
  throw Error('지원하는 바이너리 이미지·폰트가 아닙니다.');
}
module.exports = async function retryAssets(urls, fetchResource) {
  if (
    !Array.isArray(urls) ||
    urls.length > 16 ||
    urls.some((u) => typeof u !== 'string' || u.length > 8192)
  )
    throw Error('자산은 최대 16개씩 다시 읽을 수 있습니다.');
  let total = 0;
  const result = [];
  for (const url of [...new Set(urls)])
    try {
      const resource = await readPublicResource(url, fetchResource),
        bytes = Buffer.from(resource.content, 'base64');
      if (bytes.length < 12 || bytes.length > 900_000 || total + bytes.length > 1_250_000)
        throw Error('자산 복구 크기 한도를 초과했습니다.');
      const type = mime(bytes);
      total += bytes.length;
      result.push({ url, data: `data:${type};base64,${resource.content}` });
    } catch (error) {
      result.push({ url, error: error.message });
    }
  return result;
};
module.exports.mime = mime;
