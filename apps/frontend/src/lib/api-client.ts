import type {
  AccountDeletionBlocker,
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

/** Server code for an account deletion refused by ownership rules (409). */
export const ACCOUNT_DELETION_BLOCKED = 'ACCOUNT_DELETION_BLOCKED';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: string[];
  /** Validated blockers of a 409 `ACCOUNT_DELETION_BLOCKED`; empty otherwise. */
  readonly blockers: AccountDeletionBlocker[];

  constructor(
    status: number,
    code: string,
    message: string,
    details: string[] = [],
    blockers: AccountDeletionBlocker[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.blockers = blockers;
  }
}

const BLOCKER_TYPES: ReadonlySet<string> = new Set([
  'PERSONAL_WORKSPACE_HAS_BOARDS',
  'BOARD_REQUIRES_ANOTHER_OWNER',
  'TEAM_WORKSPACE_REQUIRES_ANOTHER_ADMIN',
] satisfies AccountDeletionBlocker['type'][]);
const MAX_BLOCKER_RESOURCES = 20;

/**
 * Rebuilds the documented blocker shape field by field (#218): unknown types,
 * malformed entries and extra properties are dropped, never passed through.
 */
export function parseDeletionBlockers(
  value: unknown,
): AccountDeletionBlocker[] {
  if (!Array.isArray(value)) return [];
  const blockers: AccountDeletionBlocker[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const { type, totalCount, resources } = item as Record<string, unknown>;
    if (typeof type !== 'string' || !BLOCKER_TYPES.has(type) || seen.has(type))
      continue;
    if (
      typeof totalCount !== 'number' ||
      !Number.isSafeInteger(totalCount) ||
      totalCount < 1 ||
      !Array.isArray(resources)
    )
      continue;
    const safe = resources
      .filter(
        (resource): resource is { id: string; name: string } =>
          !!resource &&
          typeof resource === 'object' &&
          typeof (resource as { id?: unknown }).id === 'string' &&
          typeof (resource as { name?: unknown }).name === 'string',
      )
      .slice(0, MAX_BLOCKER_RESOURCES)
      .map(({ id, name }) => ({ id, name }));
    seen.add(type);
    blockers.push({
      type: type as AccountDeletionBlocker['type'],
      totalCount: Math.max(totalCount, safe.length),
      resources: safe,
    });
  }
  return blockers;
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
  /** Require an exact successful HTTP status when the endpoint contract needs it. */
  expectedStatus?: number;
  /** Extra request headers, e.g. `Idempotency-Key`. */
  headers?: Record<string, string>;
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

/** The `ApiError` for a non-2xx response body; unknown bodies stay generic. */
function errorFromPayload(status: number, payload: unknown): ApiError {
  if (isErrorEnvelope(payload)) {
    return new ApiError(
      status,
      payload.code,
      payload.message,
      payload.details ?? [],
      status === 409 && payload.code === ACCOUNT_DELETION_BLOCKED
        ? parseDeletionBlockers((payload as { blockers?: unknown }).blockers)
        : [],
    );
  }
  return invalidResponse(status);
}

async function sendRequest(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(
      0,
      ClientErrorCode.NETWORK_ERROR,
      'Could not reach the server. Check your connection and try again.',
    );
  }
}

/**
 * Sends a request and returns the validated success envelope, or `undefined`
 * for `204 No Content` / an empty 2xx body. Rejects with `ApiError` otherwise.
 */
export async function requestEnvelope(
  path: string,
  {
    method = 'GET',
    body,
    accessToken,
    signal,
    expectedStatus,
    headers: extraHeaders,
  }: ApiRequestOptions,
): Promise<ApiSuccessResponse<unknown> | undefined> {
  const headers: Record<string, string> = {
    ...extraHeaders,
    Accept: 'application/json',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await sendRequest(
    `${env.apiBaseUrl}${path}`,
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    signal,
  );

  if (
    response.ok &&
    expectedStatus !== undefined &&
    response.status !== expectedStatus
  )
    throw invalidResponse(response.status);
  if (response.status === 204) return undefined;

  let payload: unknown;
  try {
    const text = await response.text();
    payload = text ? JSON.parse(text) : undefined;
  } catch (error) {
    if (signal?.aborted) throw error;
    throw invalidResponse(response.status);
  }

  if (!response.ok) throw errorFromPayload(response.status, payload);

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

/** A file answered outside the JSON envelope, e.g. a data export. */
export interface BinaryResponse {
  blob: Blob;
  /** Raw header when CORS exposes it; validate before using any part of it. */
  contentDisposition: string | null;
}

/** JSON endpoints deliberately outside the envelope (asynchronous export status). */
export async function requestRawJson(
  path: string,
  {
    method = 'GET',
    body,
    accessToken,
    signal,
    expectedStatus,
    headers,
  }: ApiRequestOptions,
): Promise<unknown> {
  signal?.throwIfAborted();
  const response = await sendRequest(
    `${env.apiBaseUrl}${path}`,
    {
      method,
      cache: 'no-store',
      headers: {
        ...headers,
        Accept: 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    signal,
  );
  let payload: unknown;
  try {
    payload = JSON.parse(await response.text());
  } catch (error) {
    if (signal?.aborted) throw error;
    throw invalidResponse(response.status);
  }
  signal?.throwIfAborted();
  if (!response.ok) throw errorFromPayload(response.status, payload);
  if (expectedStatus !== undefined && response.status !== expectedStatus)
    throw invalidResponse(response.status);
  return payload;
}

/**
 * Authenticated GET for attachment bytes. Only `200` yields a Blob; any other
 * status rejects with the decoded `ApiError`, so an error body is never
 * mistaken for a file.
 */
export async function requestBinary(
  path: string,
  {
    accessToken,
    signal,
    accept,
  }: { accessToken: string; signal?: AbortSignal; accept: string },
): Promise<BinaryResponse> {
  const response = await sendRequest(
    `${env.apiBaseUrl}${path}`,
    {
      method: 'GET',
      headers: {
        Accept: `${accept}, application/json;q=0.5`,
        Authorization: `Bearer ${accessToken}`,
      },
      // Exports are private snapshots; never answer from the HTTP cache.
      cache: 'no-store',
    },
    signal,
  );

  if (!response.ok) {
    let payload: unknown;
    try {
      const text = await response.text();
      payload = text ? JSON.parse(text) : undefined;
    } catch {
      payload = undefined;
    }
    throw errorFromPayload(response.status, payload);
  }
  if (response.status !== 200) throw invalidResponse(response.status);

  let blob: Blob;
  try {
    blob = await response.blob();
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(
      0,
      ClientErrorCode.NETWORK_ERROR,
      'The download was interrupted. Check your connection and try again.',
    );
  }
  return {
    blob,
    contentDisposition: response.headers.get('Content-Disposition'),
  };
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
