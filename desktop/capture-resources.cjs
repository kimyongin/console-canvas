// A bounded, credential-free read of a resource already observed by Inspector.
// No page IPC, custom protocols, authenticated session or security flag changes.
async function readPublicResource(url, fetchResource) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
    throw Error('지원하지 않는 리소스 주소입니다.');
  const response = await fetchResource(parsed.href, {
    credentials: 'omit',
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok || Number(response.headers.get('content-length')) > 5_000_000) {
    await response.body?.cancel().catch(() => {});
    throw Error('공개 리소스를 읽지 못했습니다.');
  }
  const reader = response.body.getReader(),
    parts = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 5_000_000) throw Error('리소스 크기 한도');
      parts.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return { content: Buffer.concat(parts).toString('base64'), base64Encoded: true };
}
module.exports = { readPublicResource };
