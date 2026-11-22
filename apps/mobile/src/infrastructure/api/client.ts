import type {
  ApiSuccessResponse,
  CursorPaginationMeta,
  PaginationMeta,
} from '@kanban/shared';
import {
  systemClock,
  systemTimers,
  type Clock,
  type Timers,
} from '../auth/clock.ts';
import { parseApiBaseUrl, requestUrl, type QueryParams } from './config.ts';
import { ApiError, httpError, invalidResponse } from './errors.ts';

export type Decoder<T> = (value: unknown) => T;
export type Envelope<T> = ApiSuccessResponse<T> & {
  meta?: PaginationMeta | CursorPaginationMeta;
};
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export const MAX_AUTOMATIC_RETRY_DELAY_MS = 5000;

/** Expo-compatible multipart body. Use createNativeMultipartUpload for URI files. */
export interface NativeUpload {
  readonly kind: 'native-upload';
  createBody(): FormData;
}

export interface RequestOptions {
  readonly method?: HttpMethod;
  /** Verified prefix-exempt endpoints only (HealthController). Same origin. */
  readonly originRelative?: boolean;
  readonly query?: QueryParams;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly upload?: NativeUpload;
  /** Bootstrap session verification/logout only; features use SessionHttpClient. */
  readonly accessToken?: string;
  readonly signal?: AbortSignal;
  readonly expectedStatus?: number;
  readonly timeoutMs?: number;
  /** Retry owner is the transport, never TanStack Query as well. Reads only. */
  readonly retries?: 0 | 1 | 2;
  /** Private file consumers can bound allocation and require declared byte integrity. */
  readonly maximumBytes?: number;
  readonly requireContentLength?: boolean;
  /** Bounded binary reads only: actual bytes received so far and the declared total. */
  readonly onProgress?: (received: number, total: number | undefined) => void;
}

export interface BinaryResult {
  readonly bytes: ArrayBuffer;
  readonly contentType: string;
  /** Untrusted metadata; never use directly as a filesystem path. */
  readonly contentDisposition: string | null;
  readonly contentLength?: number;
}

export interface HttpClient {
  envelope<T>(
    path: string,
    decode: Decoder<T>,
    options?: RequestOptions,
  ): Promise<Envelope<T>>;
  json<T>(
    path: string,
    decode: Decoder<T>,
    options?: RequestOptions,
  ): Promise<T>;
  rawJson<T>(
    path: string,
    decode: Decoder<T>,
    options?: RequestOptions,
  ): Promise<T>;
  empty(path: string, options?: RequestOptions): Promise<void>;
  text(
    path: string,
    contentTypes: readonly string[],
    options?: RequestOptions,
  ): Promise<string>;
  binary(
    path: string,
    contentTypes: readonly string[],
    options?: RequestOptions,
  ): Promise<BinaryResult>;
}

export interface HttpClientOptions {
  readonly allowInsecureLocal?: boolean;
  readonly baseUrl: URL | null;
  readonly fetch: typeof fetch;
  readonly timers?: Timers;
  readonly clock?: Clock;
  readonly isOnline?: () => boolean;
  readonly timeoutMs?: number;
}

function contentType(response: Response): string {
  return (
    response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ??
    ''
  );
}
function isJson(type: string): boolean {
  return type === 'application/json' || type.endsWith('+json');
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pagination(
  value: unknown,
  status: number,
): PaginationMeta | CursorPaginationMeta {
  if (
    !record(value) ||
    !Number.isSafeInteger(value.limit) ||
    (value.limit as number) < 1
  )
    throw invalidResponse(status);
  if ('nextCursor' in value) {
    if (value.nextCursor !== null && typeof value.nextCursor !== 'string')
      throw invalidResponse(status);
    return {
      limit: value.limit as number,
      nextCursor: value.nextCursor as string | null,
    };
  }
  for (const key of ['page', 'total', 'totalPages'])
    if (
      !Number.isSafeInteger(value[key]) ||
      (value[key] as number) < (key === 'page' ? 1 : 0)
    )
      throw invalidResponse(status);
  return {
    page: value.page as number,
    limit: value.limit as number,
    total: value.total as number,
    totalPages: value.totalPages as number,
  };
}

/** Abort wins even when a native transport/response body ignores its signal. */
function abortable<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
  error: () => ApiError,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(error());
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    try {
      operation()
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', abort));
    } catch (cause) {
      signal.removeEventListener('abort', abort);
      reject(cause);
    }
  });
}

export function createHttpClient(config: HttpClientOptions): HttpClient {
  const timers = config.timers ?? systemTimers;
  const clock = config.clock ?? systemClock;
  // Snapshot configuration so callers cannot mutate a URL after validation.
  const base = parseApiBaseUrl(
    config.baseUrl?.href,
    config.allowInsecureLocal === true,
  );

  async function send<T>(
    path: string,
    options: RequestOptions,
    accept: string,
    consume: (response: Response, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (!base) throw new ApiError('configuration');
    const timeout = options.timeoutMs ?? config.timeoutMs ?? 15_000;
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 120_000)
      throw new ApiError('configuration');
    let url: string;
    let body: BodyInit | undefined;
    const method = options.method ?? 'GET';
    const headers: Record<string, string> = { Accept: accept };
    try {
      url = requestUrl(
        options.originRelative ? new URL(base.origin) : base,
        path,
        options.query,
      );
      for (const [name, value] of Object.entries(options.headers ?? {})) {
        if (
          /^(authorization|cookie|host|content-length|content-type|accept)$/i.test(
            name,
          ) ||
          /[\r\n]/.test(name + value)
        )
          throw new Error();
        headers[name] = value;
      }
      if (options.accessToken) {
        if (/[\s]/.test(options.accessToken)) throw new Error();
        headers.Authorization = `Bearer ${options.accessToken}`;
      }
      if (options.body !== undefined && options.upload) throw new Error();
      if (method === 'GET' && (options.body !== undefined || options.upload))
        throw new Error();
      if (options.upload) {
        const form = options.upload.createBody();
        // Expo fetch accepts strings, Blobs and bytes-backed Expo File parts,
        // but rejects RN's legacy { uri, name, type } parts before transmission.
        if (!(form instanceof FormData)) throw new Error();
        form.forEach((part: unknown) => {
          if (
            typeof part !== 'string' &&
            !(part instanceof Blob) &&
            !(record(part) && typeof part.bytes === 'function')
          )
            throw new Error();
        });
        body = form;
      } else if (options.body !== undefined) {
        body = JSON.stringify(options.body);
        if (body === undefined) throw new Error();
        headers['Content-Type'] = 'application/json';
      }
    } catch {
      throw new ApiError('configuration');
    }
    const controller = new AbortController();
    let timedOut = false;
    let requestStarted = false;
    const abortError = () =>
      new ApiError(timedOut ? 'timeout' : 'aborted', { requestStarted });
    const cancel = () => controller.abort();
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) cancel();
    const timer = timers.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeout);
    const retryCount =
      method === 'GET' ? Math.min(2, Math.max(0, options.retries ?? 1)) : 0;
    try {
      for (let attempt = 0; ; attempt++) {
        requestStarted = false;
        try {
          if (controller.signal.aborted) throw abortError();
          if (config.isOnline?.() === false) throw new ApiError('offline');
          return await abortable(
            async () => {
              requestStarted = true;
              const response = await config.fetch(url, {
                method,
                headers,
                body,
                signal: controller.signal,
                credentials: 'omit',
                redirect: 'error',
                cache: 'no-store',
              });
              if (!response.ok) {
                let payload: unknown;
                try {
                  if (isJson(contentType(response)))
                    payload = JSON.parse(await response.text());
                } catch {
                  /* Generic HTTP error, never raw HTML/native errors. */
                }
                const policy = response.headers.get('retry-after');
                let retryAfterMs: number | undefined;
                if (policy !== null) {
                  const seconds = Number(policy);
                  const delay =
                    policy.trim() && Number.isFinite(seconds)
                      ? seconds * 1000
                      : Date.parse(policy) - clock.now();
                  // Invalid policy disables automatic retry rather than ignoring the server.
                  retryAfterMs = Number.isFinite(delay)
                    ? Math.max(0, delay)
                    : Number.POSITIVE_INFINITY;
                }
                throw httpError(response.status, payload, retryAfterMs);
              }
              if (
                options.expectedStatus !== undefined &&
                response.status !== options.expectedStatus
              )
                throw invalidResponse(response.status);
              return consume(response, controller.signal);
            },
            controller.signal,
            abortError,
          );
        } catch (cause) {
          const error = controller.signal.aborted
            ? abortError()
            : cause instanceof ApiError
              ? new ApiError(cause.kind, {
                  ...cause,
                  message: cause.message,
                  requestStarted,
                })
              : new ApiError(
                  config.isOnline?.() === false ? 'offline' : 'network',
                  { requestStarted },
                );
          const transient =
            error.kind === 'network' ||
            error.kind === 'timeout' ||
            (error.kind === 'http' &&
              [429, 500, 502, 503, 504].includes(error.status));
          if (attempt >= retryCount || !transient || controller.signal.aborted)
            throw error;
          const delay = error.retryAfterMs ?? 250 * 2 ** attempt;
          if (delay > MAX_AUTOMATIC_RETRY_DELAY_MS) throw error;
          await abortable(
            () =>
              new Promise<void>((resolve) => {
                const wait = timers.setTimeout(done, delay);
                function done() {
                  controller.signal.removeEventListener('abort', stop);
                  resolve();
                }
                function stop() {
                  timers.clearTimeout(wait);
                  controller.signal.removeEventListener('abort', stop);
                }
                controller.signal.addEventListener('abort', stop, {
                  once: true,
                });
              }),
            controller.signal,
            abortError,
          );
        }
      }
    } finally {
      timers.clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
    }
  }

  async function jsonBody(response: Response): Promise<unknown> {
    if (response.status === 204 || !isJson(contentType(response)))
      throw invalidResponse(response.status);
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw invalidResponse(response.status);
    }
  }
  function decodeValue<T>(
    decode: Decoder<T>,
    value: unknown,
    status: number,
  ): T {
    try {
      return decode(value);
    } catch {
      throw invalidResponse(status);
    }
  }
  async function envelope<T>(
    path: string,
    decode: Decoder<T>,
    options: RequestOptions = {},
  ): Promise<Envelope<T>> {
    return send(path, options, 'application/json', async (response) => {
      const value = await jsonBody(response);
      if (
        !record(value) ||
        value.success !== true ||
        value.statusCode !== response.status ||
        typeof value.message !== 'string' ||
        !('data' in value)
      )
        throw invalidResponse(response.status);
      return {
        success: true,
        statusCode: response.status,
        message: value.message,
        data: decodeValue(decode, value.data, response.status),
        ...('meta' in value
          ? { meta: pagination(value.meta, response.status) }
          : {}),
      };
    });
  }
  return {
    envelope,
    async json(path, decode, options) {
      return (await envelope(path, decode, options)).data;
    },
    async rawJson(path, decode, options = {}) {
      return send(path, options, 'application/json', async (response) => {
        const value = await jsonBody(response);
        if (record(value) && value.success === false)
          throw invalidResponse(response.status);
        return decodeValue(decode, value, response.status);
      });
    },
    async empty(path, options = {}) {
      return send(
        path,
        { ...options, expectedStatus: 204 },
        'application/json',
        async () => undefined,
      );
    },
    async text(path, contentTypes, options = {}) {
      return send(path, options, contentTypes.join(', '), async (response) => {
        if (
          response.status === 204 ||
          !contentTypes.includes(contentType(response)) ||
          isJson(contentType(response))
        )
          throw invalidResponse(response.status);
        return response.text();
      });
    },
    async binary(path, contentTypes, options = {}) {
      return send(
        path,
        { ...options, expectedStatus: options.expectedStatus ?? 200 },
        contentTypes.join(', '),
        async (response, signal) => {
          const type = contentType(response);
          if (!contentTypes.includes(type))
            throw invalidResponse(response.status);
          const declared = response.headers.get('content-length');
          const length =
            declared !== null && /^\d+$/.test(declared)
              ? Number(declared)
              : undefined;
          const maximum = options.maximumBytes;
          const tooLarge = () =>
            new ApiError('invalid-response', {
              status: response.status,
              code: 'RESPONSE_TOO_LARGE',
            });
          if (
            (options.requireContentLength &&
              (!Number.isSafeInteger(length) || !length)) ||
            (maximum !== undefined &&
              (!Number.isSafeInteger(maximum) || maximum < 1))
          ) {
            await response.body?.cancel().catch(() => undefined);
            throw invalidResponse(response.status);
          }
          if (
            maximum !== undefined &&
            length !== undefined &&
            length > maximum
          ) {
            await response.body?.cancel().catch(() => undefined);
            throw tooLarge();
          }
          let bytes: ArrayBuffer;
          if (maximum !== undefined) {
            // Expo fetch exposes a native readable body. Fail closed without a
            // bounded reader rather than allocate an arbitrarily large response.
            // Without a declared length, chunks are kept until the cap is hit.
            if (!response.body) throw invalidResponse(response.status);
            const reader = response.body.getReader();
            const cancelReader = () => {
              void reader.cancel().catch(() => undefined);
            };
            signal.addEventListener('abort', cancelReader, { once: true });
            if (signal.aborted) cancelReader();
            const output = length === undefined ? null : new Uint8Array(length);
            const chunks: Uint8Array[] = [];
            let received = 0;
            try {
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                if (signal.aborted) throw new ApiError('aborted');
                received += value.byteLength;
                if (received > maximum) throw tooLarge();
                if (length !== undefined && received > length)
                  throw invalidResponse(response.status);
                if (output) output.set(value, received - value.byteLength);
                else chunks.push(value.slice());
                options.onProgress?.(received, length);
              }
              if (length !== undefined && received !== length)
                throw invalidResponse(response.status);
              if (output) bytes = output.buffer;
              else {
                const joined = new Uint8Array(received);
                let offset = 0;
                for (const chunk of chunks) {
                  joined.set(chunk, offset);
                  offset += chunk.byteLength;
                }
                chunks.length = 0;
                bytes = joined.buffer;
              }
            } finally {
              signal.removeEventListener('abort', cancelReader);
              await reader.cancel().catch(() => undefined);
            }
          } else bytes = await response.arrayBuffer();
          if (bytes.byteLength === 0) throw invalidResponse(response.status);
          if (isJson(type)) {
            // JSON exports are raw downloads; require attachment disposition and reject envelopes.
            if (
              !/^attachment\s*;/i.test(
                response.headers.get('content-disposition') ?? '',
              )
            )
              throw invalidResponse(response.status);
            let value: unknown;
            try {
              value = JSON.parse(await new Response(bytes).text());
            } catch {
              throw invalidResponse(response.status);
            }
            if (record(value) && 'success' in value)
              throw invalidResponse(response.status);
          }
          return {
            bytes,
            contentType: type,
            contentDisposition: response.headers.get('content-disposition'),
            ...(length === undefined ? {} : { contentLength: length }),
          };
        },
      );
    },
  };
}
