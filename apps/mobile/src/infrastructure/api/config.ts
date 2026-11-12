/** Public configuration only. No fallback server and no credentials in URLs. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '10.0.2.2', '[::1]']);

function isLocal(host: string): boolean {
  if (LOCAL_HOSTS.has(host)) return true;
  const octets = host.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  )
    return false;
  return (
    octets[0] === 10 ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31)
  );
}

export function parseApiBaseUrl(
  value: string | undefined,
  allowInsecureLocal: boolean,
): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return null;
    if (
      url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && allowInsecureLocal && isLocal(url.hostname))
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Readonly<
  Record<string, QueryValue | readonly QueryValue[]>
>;

/** Paths are API-relative; identifiers must be passed through encodeURIComponent. */
export function requestUrl(
  base: URL,
  path: string,
  query?: QueryParams,
): string {
  if (!path.startsWith('/') || path.startsWith('//') || /[?#\\]/.test(path))
    throw new Error('Invalid API-relative path');
  const url = new URL(base.href.replace(/\/+$/, '') + path);
  if (
    url.origin !== base.origin ||
    !url.pathname.startsWith(base.pathname.replace(/\/+$/, '') + '/')
  )
    throw new Error('Invalid API-relative path');
  for (const key of Object.keys(query ?? {}).sort()) {
    const value = query![key];
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined && item !== null) {
        if (typeof item === 'number' && !Number.isFinite(item))
          throw new Error('Invalid query number');
        url.searchParams.append(key, String(item));
      }
    }
  }
  return url.href;
}
