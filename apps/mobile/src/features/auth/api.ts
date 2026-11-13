import type { HttpClient } from '../../infrastructure/api/client.ts';
import { ApiError } from '../../infrastructure/api/errors.ts';
import { decodeSessionUser } from '../../infrastructure/auth/session-api.ts';
import type { LoginResponseLike } from '../../infrastructure/auth/session-manager.ts';
import { isProof } from './validation.ts';

// Mail endpoints deliberately wait >=10.5s. Allow provider and network latency.
export const MAIL_TIMEOUT_MS = 45_000;

function decodeLogin(value: unknown): LoginResponseLike {
  if (typeof value !== 'object' || !value) throw new Error();
  const data = value as Record<string, unknown>;
  if (
    typeof data.accessToken !== 'string' ||
    !data.accessToken ||
    data.tokenType !== 'Bearer' ||
    !Number.isSafeInteger(data.expiresIn) ||
    (data.expiresIn as number) <= 0
  )
    throw new Error();
  return {
    accessToken: data.accessToken,
    tokenType: 'Bearer',
    expiresIn: data.expiresIn,
    user: decodeSessionUser(data.user),
  };
}
function decodeNull(value: unknown): null {
  if (value !== null) throw new Error();
  return null;
}
function requireProof(token: string) {
  if (!isProof(token)) throw new ApiError('configuration');
}

/** Public calls intentionally use MOB-04's unauthenticated transport. No query cache. */
export function createAuthApi(http: HttpClient) {
  return {
    login(email: string, password: string, signal: AbortSignal) {
      return http.json('/auth/login', decodeLogin, {
        method: 'POST',
        expectedStatus: 200,
        body: { email: email.trim(), password },
        signal,
      });
    },
    register(
      displayName: string,
      email: string,
      password: string,
      signal: AbortSignal,
    ) {
      return http.json('/auth/register', decodeSessionUser, {
        method: 'POST',
        expectedStatus: 201,
        timeoutMs: MAIL_TIMEOUT_MS,
        body: {
          email: email.trim(),
          password,
          displayName: displayName.trim(),
        },
        signal,
      });
    },
    verify(token: string, signal: AbortSignal) {
      requireProof(token);
      return http.empty('/auth/verify-email', {
        method: 'POST',
        body: { token },
        signal,
      });
    },
    resend(email: string, signal: AbortSignal) {
      return http.json('/auth/resend-verification', decodeNull, {
        method: 'POST',
        expectedStatus: 202,
        timeoutMs: MAIL_TIMEOUT_MS,
        body: { email: email.trim() },
        signal,
      });
    },
    forgot(email: string, signal: AbortSignal) {
      return http.json('/auth/forgot-password', decodeNull, {
        method: 'POST',
        expectedStatus: 202,
        timeoutMs: MAIL_TIMEOUT_MS,
        body: { email: email.trim() },
        signal,
      });
    },
    reset(token: string, newPassword: string, signal: AbortSignal) {
      requireProof(token);
      return http.empty('/auth/reset-password', {
        method: 'POST',
        body: { token, newPassword },
        signal,
      });
    },
  };
}
export type AuthApi = ReturnType<typeof createAuthApi>;
