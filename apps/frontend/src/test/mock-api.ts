import { vi } from 'vitest';
import type { LoginResponse, User } from '../features/auth/types';
import { env } from '../lib/env';

export interface MockRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface MockResponse {
  status: number;
  body?: unknown;
}

type Handler =
  | MockResponse
  | ((request: MockRequest) => MockResponse | Promise<MockResponse>);

/** Every signed-in app loads preferences (ThemeSync); tests may override this. */
const defaultHandlers: Record<string, Handler> = {
  'GET /users/me/preferences': ok({
    theme: 'system',
    timeZone: 'UTC',
    dateFormat: 'YYYY-MM-DD',
    weekStartsOn: 'monday',
  }),
};

/**
 * Replaces `fetch` with handlers keyed by "METHOD /path" (relative to the API
 * base URL). Unknown requests fail the test loudly. Returns the call log.
 */
export function mockApi(overrides: Record<string, Handler>): MockRequest[] {
  const handlers = { ...defaultHandlers, ...overrides };
  const calls: MockRequest[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const path = input.replace(env.apiBaseUrl, '');
      const request: MockRequest = {
        method,
        path,
        headers: (init.headers ?? {}) as Record<string, string>,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      };
      calls.push(request);

      const handler = handlers[`${method} ${path}`];
      if (!handler) throw new Error(`Unexpected request: ${method} ${path}`);
      const { status, body } =
        typeof handler === 'function' ? await handler(request) : handler;
      return new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );

  return calls;
}

export function ok<T>(data: T, statusCode = 200): MockResponse {
  return {
    status: statusCode,
    body: { success: true, statusCode, message: 'OK', data },
  };
}

export function fail(
  statusCode: number,
  code: string,
  message = code,
  details?: string[],
): MockResponse {
  return {
    status: statusCode,
    body: {
      success: false,
      statusCode,
      code,
      message,
      timestamp: new Date(0).toISOString(),
      path: '/api',
      ...(details ? { details } : {}),
    },
  };
}

export const testUser: User = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  avatarUrl: null,
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:00:00.000Z',
};

export function loginResponse(user: User = testUser): LoginResponse {
  return {
    accessToken: 'test-access-token',
    tokenType: 'Bearer',
    expiresIn: 3600,
    user,
  };
}

/** Pre-populates sessionStorage as if the user had logged in earlier in this tab. */
export function storeSession(
  accessToken = 'stored-token',
  expiresInMs = 60_000,
) {
  sessionStorage.setItem(
    'kanban.session',
    JSON.stringify({ accessToken, expiresAt: Date.now() + expiresInMs }),
  );
}
