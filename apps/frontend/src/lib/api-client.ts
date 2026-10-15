import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  PaginationMeta,
} from '@kanban/shared';
import { env } from './env';

/** Codes produced on the client when no backend error envelope is available. */
export const ClientErrorCode = {
  NETWORK_ERROR: 'NETWORK_ERROR',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
} as const;

/** Server code for changes to an archived board (409). */
export const BOARD_ARCHIVED = 'BOARD_ARCHIVED';

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

function invalidResponse(status: number): ApiError {
  return new ApiError(
    status,
    ClientErrorCode.INVALID_RESPONSE,
    'The server returned an unexpected response.',
  );
}

/**
 * Sends a request and returns the validated success envelope, or `undefined`
 * for `204 No Content` / an empty 2xx body. Rejects with `ApiError` otherwise.
 */
async function requestEnvelope(
  path: string,
  { method = 'GET', body, accessToken, signal }: ApiRequestOptions,
): Promise<ApiSuccessResponse<unknown> | undefined> {
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

  if (response.status === 204) return undefined;

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
    throw invalidResponse(response.status);
  }

  // Void handlers may answer 200/201 with an empty body instead of 204.
  if (payload === undefined) return undefined;

  if (!isSuccessEnvelope(payload)) throw invalidResponse(response.status);
  return payload;
}

/**
 * Calls the backend REST API and unwraps the shared response envelope.
 * Resolves to `undefined` for `204 No Content` or an empty 2xx body; rejects
 * with `ApiError` otherwise.
 */
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const envelope = await requestEnvelope(path, options);
  return envelope?.data as T;
}

/** The backend's maximum page size (`PageQueryDto`). */
export const MAX_PAGE_LIMIT = 100;

export interface Page<T> {
  items: T[];
  meta: PaginationMeta;
}

function isPaginationMeta(value: unknown): value is PaginationMeta {
  if (!value || typeof value !== 'object') return false;
  const meta = value as Record<string, unknown>;
  return ['page', 'limit', 'total', 'totalPages'].every(
    (key) => typeof meta[key] === 'number',
  );
}

/** Like `apiRequest`, for list endpoints that return `data` plus pagination `meta`. */
export async function apiRequestPage<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<Page<T>> {
  const envelope = await requestEnvelope(path, options);
  const meta = (envelope as { meta?: unknown } | undefined)?.meta;
  if (!envelope || !Array.isArray(envelope.data) || !isPaginationMeta(meta)) {
    throw invalidResponse(200);
  }
  return { items: envelope.data as T[], meta };
}

/** Requests page 1, then every remaining page, and joins their items in order. */
export async function fetchAllPages<T>(
  fetchPage: (page: number) => Promise<Page<T>>,
): Promise<T[]> {
  const first = await fetchPage(1);
  const items = [...first.items];
  for (let page = 2; page <= first.meta.totalPages; page += 1) {
    items.push(...(await fetchPage(page)).items);
  }
  return items;
}
