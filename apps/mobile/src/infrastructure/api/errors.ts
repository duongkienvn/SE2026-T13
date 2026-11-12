import type { ApiErrorResponse } from '@kanban/shared';

export type ApiErrorKind =
  | 'http'
  | 'invalid-response'
  | 'configuration'
  | 'unauthenticated'
  | 'session-changed'
  | 'timeout'
  | 'aborted'
  | 'offline'
  | 'network';

/** No response/request objects, bearer, URL, raw body or native exception cause. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly code: string;
  readonly details: readonly string[];
  readonly requestId?: string;
  readonly retryAfterMs?: number;

  constructor(
    kind: ApiErrorKind,
    options: {
      status?: number;
      code?: string;
      message?: string;
      details?: readonly string[];
      requestId?: string;
      retryAfterMs?: number;
    } = {},
  ) {
    super(
      options.message ??
        {
          http: 'The request failed.',
          'invalid-response': 'The server returned an unexpected response.',
          configuration: 'The API is not configured correctly.',
          unauthenticated: 'Sign in to continue.',
          'session-changed': 'The session changed.',
          timeout: 'The request timed out.',
          aborted: 'The request was cancelled.',
          offline: 'The device is offline.',
          network: 'Could not reach the server.',
        }[kind],
    );
    this.name = 'ApiError';
    this.kind = kind;
    this.status = options.status ?? 0;
    this.code = options.code ?? kind.toUpperCase().replaceAll('-', '_');
    this.details = options.details ?? [];
    this.requestId = options.requestId;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export function invalidResponse(status: number): ApiError {
  return new ApiError('invalid-response', { status });
}

const STATUS_CODES: Readonly<Record<number, string>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'TOO_MANY_REQUESTS',
};

function safeString(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max &&
    !/[\u0000-\u001f]/.test(value)
  );
}

export function httpError(
  status: number,
  payload: unknown,
  retryAfterMs?: number,
): ApiError {
  const value = payload as Partial<ApiErrorResponse> | null;
  const valid =
    value &&
    typeof value === 'object' &&
    value.success === false &&
    value.statusCode === status &&
    safeString(value.code, 100) &&
    /^[A-Z][A-Z0-9_]*$/.test(value.code) &&
    safeString(value.message, 500);
  return new ApiError('http', {
    status,
    code: valid
      ? value.code
      : (STATUS_CODES[status] ??
        (status >= 500 ? 'INTERNAL_ERROR' : 'HTTP_ERROR')),
    message: valid ? value.message : 'The request failed.',
    details:
      valid && Array.isArray(value.details)
        ? value.details.filter((item) => safeString(item, 500)).slice(0, 20)
        : [],
    requestId:
      valid && safeString(value.requestId, 100) ? value.requestId : undefined,
    retryAfterMs,
  });
}
