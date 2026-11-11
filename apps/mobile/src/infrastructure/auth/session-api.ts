import { isUuid } from './credential-record.ts';
import type { Timers } from './clock.ts';

/** The identity fields the session keeps from `GET /api/users/me`. */
export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
}

export type VerifyResult =
  | { readonly kind: 'verified'; readonly user: SessionUser }
  /** The server rejected the bearer token (expired, revoked or unknown). */
  | { readonly kind: 'unauthorized' }
  /** Nothing proves the token is bad: offline, timeout, 5xx, 429, malformed. */
  | {
      readonly kind: 'unavailable';
      readonly reason: 'network' | 'timeout' | 'server';
    };

/**
 * The two backend calls the session owns. MOB-04's transport can provide this
 * port later; {@link createFetchSessionApi} is the dependency-free version.
 */
export interface SessionApi {
  verify(accessToken: string): Promise<VerifyResult>;
  /** Resolves `true` on 204. Never throws; logout is stateless server-side. */
  logout(accessToken: string): Promise<boolean>;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '10.0.2.2', '[::1]']);

function isPrivateLanHost(host: string): boolean {
  return (
    LOCAL_HOSTS.has(host) ||
    /^10\.\d+\.\d+\.\d+$/.test(host) ||
    /^192\.168\.\d+\.\d+$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host)
  );
}

/**
 * Validates `EXPO_PUBLIC_API_BASE_URL`. HTTPS is required everywhere except
 * development builds talking to a loopback, emulator or private-LAN host.
 */
export function parseApiBaseUrl(
  value: string | undefined,
  allowInsecureLocal: boolean,
): URL | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.protocol === 'https:') return url;
  if (
    url.protocol === 'http:' &&
    allowInsecureLocal &&
    isPrivateLanHost(url.hostname)
  )
    return url;
  return null;
}

function parseUser(body: unknown): SessionUser | null {
  if (typeof body !== 'object' || body === null) return null;
  const envelope = body as { success?: unknown; data?: unknown };
  if (envelope.success !== true) return null;
  const data = envelope.data as Record<string, unknown> | null | undefined;
  if (typeof data !== 'object' || data === null) return null;
  const { id, email, displayName, avatarUrl, isDeleted } = data;
  if (
    !isUuid(id) ||
    typeof email !== 'string' ||
    typeof displayName !== 'string' ||
    (avatarUrl !== null && typeof avatarUrl !== 'string') ||
    isDeleted === true
  )
    return null;
  return {
    id: id.toLowerCase(),
    email,
    displayName,
    avatarUrl: avatarUrl as string | null,
  };
}

export interface FetchSessionApiOptions {
  /** Validated base such as `https://kanvexa.tech/api`. */
  readonly baseUrl: URL;
  readonly fetch: typeof fetch;
  readonly timers: Timers;
  readonly timeoutMs?: number;
}

export function createFetchSessionApi(
  options: FetchSessionApiOptions,
): SessionApi {
  const base = options.baseUrl.href.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function send(
    method: 'GET' | 'POST',
    path: string,
    accessToken: string,
  ): Promise<Response | 'timeout' | 'network'> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = options.timers.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      return await options.fetch(`${base}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        signal: controller.signal,
      });
    } catch {
      return timedOut ? 'timeout' : 'network';
    } finally {
      options.timers.clearTimeout(timer);
    }
  }

  return {
    async verify(accessToken) {
      const response = await send('GET', '/users/me', accessToken);
      if (response === 'timeout' || response === 'network')
        return { kind: 'unavailable', reason: response };
      // Only 401 proves the token is unusable. 403/404/429/5xx on the
      // identity route keep the credential and the guard closed instead.
      if (response.status === 401) return { kind: 'unauthorized' };
      if (response.status !== 200)
        return { kind: 'unavailable', reason: 'server' };
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { kind: 'unavailable', reason: 'server' };
      }
      const user = parseUser(body);
      return user
        ? { kind: 'verified', user }
        : { kind: 'unavailable', reason: 'server' };
    },

    async logout(accessToken) {
      const response = await send('POST', '/auth/logout', accessToken);
      return typeof response !== 'string' && response.status === 204;
    },
  };
}
