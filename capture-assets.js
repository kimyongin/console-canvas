// Public CORS reads in the extension worker avoid the page's connect-src rules.
// No host permissions, cookies, credentials or browser security settings change.
export async function fetchPublicAssets(urls) {
  const result = {};
  let total = 0;
  const candidates = [...new Set(urls)]
    .filter((url) => {
      try {
        const parsed = new URL(url);
        return /^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password;
      } catch {
        return false;
      }
    })
    .slice(0, 180);
  for (let i = 0; i < candidates.length && total < 25_000_000; i += 8) {
    const values = await Promise.all(
      candidates.slice(i, i + 8).map(async (url) => {
        try {
          const response = await fetch(url, {
            credentials: 'omit',
            cache: 'force-cache',
            signal: AbortSignal.timeout(2000),
          });
          if (!response.ok) return null;
          const blob = await response.blob();
          if (blob.size > 5_000_000) return null;
          const suffix = new URL(url).pathname.toLowerCase();
          let type = blob.type.split(';')[0];
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const magic = String.fromCharCode(...bytes.subarray(0, 4));
          if (magic === 'wOF2') type = 'font/woff2';
          else if (magic === 'wOFF') type = 'font/woff';
          else if (magic === 'OTTO' || bytes.slice(0, 4).join(',') === '0,1,0,0') type = 'font/ttf';
          if (
            !/^(image\/|font\/|application\/(font|x-font|octet-stream)|binary\/octet-stream)/.test(
              type,
            )
          )
            return null;
          if (type === 'binary/octet-stream' || type === 'application/octet-stream') {
            type = suffix.endsWith('.woff2')
              ? 'font/woff2'
              : suffix.endsWith('.woff')
                ? 'font/woff'
                : suffix.endsWith('.ttf')
                  ? 'font/ttf'
                  : 'application/octet-stream';
          }
          let text = '';
          for (let j = 0; j < bytes.length; j += 32768)
            text += String.fromCharCode(...bytes.subarray(j, j + 32768));
          return { url, size: bytes.length, data: 'data:' + type + ';base64,' + btoa(text) };
        } catch {
          return null;
        }
      }),
    );
    for (const value of values)
      if (value && total + value.size <= 25_000_000) {
        total += value.size;
        result[value.url] = value.data;
      }
  }
  return result;
}
