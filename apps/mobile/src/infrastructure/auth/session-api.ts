import { createHttpClient, type HttpClient } from '../api/client.ts';
import { ApiError } from '../api/errors.ts';
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
 * The two backend calls the session owns, using the common native transport.
 */
export interface SessionApi {
  verify(accessToken: string): Promise<VerifyResult>;
  /** Resolves `true` on 204. Never throws; logout is stateless server-side. */
  logout(accessToken: string): Promise<boolean>;
}

export { parseApiBaseUrl } from '../api/config.ts';

export function decodeSessionUser(data: unknown): SessionUser {
  if (typeof data !== 'object' || data === null)
    throw new Error('Invalid user');
  const { id, email, displayName, avatarUrl, isDeleted } = data as Record<
    string,
    unknown
  >;
  if (
    !isUuid(id) ||
    typeof email !== 'string' ||
    typeof displayName !== 'string' ||
    (avatarUrl !== null && typeof avatarUrl !== 'string') ||
    isDeleted === true
  )
    throw new Error('Invalid user');
  return {
    id: id.toLowerCase(),
    email,
    displayName,
    avatarUrl: avatarUrl as string | null,
  };
}

export interface FetchSessionApiOptions {
  readonly allowInsecureLocal?: boolean;
  /** Validated base such as `https://kanvexa.tech/api`. */
  readonly baseUrl: URL;
  readonly fetch: typeof fetch;
  readonly timers: Timers;
  readonly timeoutMs?: number;
}

export function createFetchSessionApi(
  options: FetchSessionApiOptions,
): SessionApi {
  return createTransportSessionApi(createHttpClient(options));
}

/** Explicit bearer is confined to bootstrap verification and best-effort logout. */
export function createTransportSessionApi(http: HttpClient): SessionApi {
  return {
    async verify(accessToken) {
      if (!accessToken) return { kind: 'unauthorized' };
      try {
        const user = await http.json('/users/me', decodeSessionUser, {
          accessToken,
          expectedStatus: 200,
          retries: 0,
        });
        return { kind: 'verified', user };
      } catch (error) {
        if (error instanceof ApiError && error.status === 401)
          return { kind: 'unauthorized' };
        const reason =
          error instanceof ApiError && error.kind === 'timeout'
            ? 'timeout'
            : error instanceof ApiError &&
                (error.kind === 'network' || error.kind === 'offline')
              ? 'network'
              : 'server';
        return { kind: 'unavailable', reason };
      }
    },
    async logout(accessToken) {
      if (!accessToken) return false;
      try {
        await http.empty('/auth/logout', {
          method: 'POST',
          accessToken,
          retries: 0,
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}
