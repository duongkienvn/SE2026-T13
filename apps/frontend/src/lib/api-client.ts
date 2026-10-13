import type { ApiErrorResponse, ApiSuccessResponse } from '@kanban/shared';
import { env } from './env';

/** Codes produced on the client when no backend error envelope is available. */
export const ClientErrorCode = {
  NETWORK_ERROR: 'NETWORK_ERROR',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
} as const;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: string[];

  constructor(
    status: number,
    code: string,
    message: string,
    details: string[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Sent as `Authorization: Bearer <token>`. */
  accessToken?: string;
  signal?: AbortSignal;
}

function isErrorEnvelope(value: unknown): value is ApiErrorResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ApiErrorResponse>;
  return (
    candidate.success === false &&
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string'
  );
}

function isSuccessEnvelope(
  value: unknown,
): value is ApiSuccessResponse<unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as Partial<ApiSuccessResponse<unknown>>).success === true &&
    'data' in value
  );
}

/**
 * Calls the backend REST API and unwraps the shared response envelope.
 * Resolves to `undefined` for `204 No Content` or an empty 2xx body; rejects
 * with `ApiError` otherwise.
 */
export async function apiRequest<T>(
  path: string,
  { method = 'GET', body, accessToken, signal }: ApiRequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response: Response;
  try {
    response = await fetch(`${env.apiBaseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(
      0,
      ClientErrorCode.NETWORK_ERROR,
      'Could not reach the server. Check your connection and try again.',
    );
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    const text = await response.text();
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    if (isErrorEnvelope(payload)) {
      throw new ApiError(
        response.status,
        payload.code,
        payload.message,
        payload.details ?? [],
      );
    }
    throw new ApiError(
      response.status,
      ClientErrorCode.INVALID_RESPONSE,
      'The server returned an unexpected response.',
    );
  }

  // Void handlers may answer 200/201 with an empty body instead of 204.
  if (payload === undefined) return undefined as T;

  if (!isSuccessEnvelope(payload)) {
    throw new ApiError(
      response.status,
      ClientErrorCode.INVALID_RESPONSE,
      'The server returned an unexpected response.',
    );
  }

  return payload.data as T;
}
