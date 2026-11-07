import { describe, expect, it, vi } from 'vitest';
import { fail, mockApi, ok } from '../test/mock-api';
import {
  apiRequest,
  ApiError,
  ClientErrorCode,
  parseDeletionBlockers,
  requestBinary,
} from './api-client';

describe('apiRequest', () => {
  it('unwraps the success envelope and sends JSON with a bearer token', async () => {
    const calls = mockApi({ 'POST /things': ok({ id: 1 }, 201) });

    await expect(
      apiRequest('/things', {
        method: 'POST',
        body: { name: 'x' },
        accessToken: 'abc',
      }),
    ).resolves.toEqual({ id: 1 });
    expect(calls[0].headers).toMatchObject({
      Authorization: 'Bearer abc',
      'Content-Type': 'application/json',
    });
    expect(calls[0].body).toEqual({ name: 'x' });
  });

  it('resolves to undefined for 204 No Content', async () => {
    mockApi({ 'POST /auth/logout': { status: 204 } });
    await expect(
      apiRequest('/auth/logout', { method: 'POST' }),
    ).resolves.toBeUndefined();
  });

  it('resolves to undefined for an empty 2xx body', async () => {
    mockApi({ 'POST /auth/logout': { status: 201 } });
    await expect(
      apiRequest('/auth/logout', { method: 'POST' }),
    ).resolves.toBeUndefined();
  });

  it('maps the error envelope to ApiError', async () => {
    mockApi({
      'POST /auth/register': fail(409, 'EMAIL_ALREADY_EXISTS', 'Email taken'),
    });

    const error = await apiRequest('/auth/register', { method: 'POST' }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'EMAIL_ALREADY_EXISTS',
      message: 'Email taken',
    });
  });

  it('reports network failures separately from HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await expect(apiRequest('/users/me')).rejects.toMatchObject({
      status: 0,
      code: ClientErrorCode.NETWORK_ERROR,
    });
  });

  it('rejects malformed responses safely', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response('<html>oops</html>', { status: 502 })),
      ),
    );
    await expect(apiRequest('/users/me')).rejects.toMatchObject({
      status: 502,
      code: ClientErrorCode.INVALID_RESPONSE,
    });

    mockApi({ 'GET /users/me': { status: 200, body: { unexpected: true } } });
    await expect(apiRequest('/users/me')).rejects.toMatchObject({
      code: ClientErrorCode.INVALID_RESPONSE,
    });
  });
});

/** jsdom's Blob has no `text()`; FileReader works for both Blob kinds. */
function readText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe('requestBinary', () => {
  it('returns the 200 bytes as a Blob without parsing an envelope', async () => {
    const csv = 'boardId,title\r\n"b1","=SUM(1)"\r\n';
    const calls = mockApi({
      'GET /boards/b1/export?format=csv': {
        status: 200,
        raw: csv,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="x.csv"',
        },
      },
    });
    const result = await requestBinary('/boards/b1/export?format=csv', {
      accessToken: 'abc',
      accept: 'text/csv',
    });
    expect(await readText(result.blob)).toBe(csv);
    expect(result.contentDisposition).toBe('attachment; filename="x.csv"');
    expect(calls[0].headers).toMatchObject({ Authorization: 'Bearer abc' });
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(init.cache).toBe('no-store');
  });

  it('a JSON success body is still returned as bytes, not unwrapped', async () => {
    const body = { schemaVersion: 1, success: true, data: 'not an envelope' };
    mockApi({ 'GET /users/me/export': { status: 200, body } });
    const result = await requestBinary('/users/me/export', {
      accessToken: 'abc',
      accept: 'application/json',
    });
    expect(JSON.parse(await readText(result.blob))).toEqual(body);
  });

  it.each([
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [413, 'EXPORT_TOO_LARGE'],
    [429, 'TOO_MANY_REQUESTS'],
    [503, 'EXPORT_TIMEOUT'],
  ])(
    'decodes a %i error envelope instead of returning a file',
    async (status, code) => {
      mockApi({ 'GET /users/me/export': fail(status, code, 'Nope') });
      await expect(
        requestBinary('/users/me/export', {
          accessToken: 'abc',
          accept: 'application/json',
        }),
      ).rejects.toMatchObject({ status, code, message: 'Nope' });
    },
  );

  it('rejects a non-envelope error body as an invalid response', async () => {
    mockApi({
      'GET /users/me/export': { status: 502, raw: '<html>bad gateway</html>' },
    });
    await expect(
      requestBinary('/users/me/export', {
        accessToken: 'abc',
        accept: 'application/json',
      }),
    ).rejects.toMatchObject({
      status: 502,
      code: ClientErrorCode.INVALID_RESPONSE,
    });
  });

  it('treats a 2xx other than 200 as unexpected', async () => {
    mockApi({ 'GET /users/me/export': { status: 204 } });
    await expect(
      requestBinary('/users/me/export', {
        accessToken: 'abc',
        accept: 'application/json',
      }),
    ).rejects.toMatchObject({ code: ClientErrorCode.INVALID_RESPONSE });
  });

  it('maps a failed fetch to NETWORK_ERROR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );
    await expect(
      requestBinary('/users/me/export', {
        accessToken: 'abc',
        accept: 'application/json',
      }),
    ).rejects.toMatchObject({ status: 0, code: ClientErrorCode.NETWORK_ERROR });
  });

  it('passes an abort through unchanged', async () => {
    const controller = new AbortController();
    const abort = new DOMException('Aborted', 'AbortError');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        controller.abort();
        return Promise.reject(abort);
      }),
    );
    await expect(
      requestBinary('/users/me/export', {
        accessToken: 'abc',
        accept: 'application/json',
        signal: controller.signal,
      }),
    ).rejects.toBe(abort);
  });
});

describe('account deletion blockers', () => {
  const blocked = (blockers: unknown, code = 'ACCOUNT_DELETION_BLOCKED') => ({
    status: 409,
    body: {
      success: false,
      statusCode: 409,
      code,
      message: 'Resolve ownership requirements',
      timestamp: '2026-11-05T00:00:00.000Z',
      path: '/api/users/me',
      blockers,
      stack: 'never exposed',
    },
  });

  it('keeps the validated top-level blockers of a 409 ACCOUNT_DELETION_BLOCKED', async () => {
    mockApi({
      'DELETE /users/me': blocked([
        {
          type: 'BOARD_REQUIRES_ANOTHER_OWNER',
          totalCount: 24,
          resources: [{ id: 'b1', name: 'Project', email: 'x@y.z' }],
          extra: true,
        },
        {
          type: 'TEAM_WORKSPACE_REQUIRES_ANOTHER_ADMIN',
          totalCount: 1,
          resources: [],
        },
      ]),
    });
    const error = await apiRequest('/users/me', { method: 'DELETE' }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).blockers).toEqual([
      {
        type: 'BOARD_REQUIRES_ANOTHER_OWNER',
        totalCount: 24,
        resources: [{ id: 'b1', name: 'Project' }],
      },
      {
        type: 'TEAM_WORKSPACE_REQUIRES_ANOTHER_ADMIN',
        totalCount: 1,
        resources: [],
      },
    ]);
    expect(error).not.toHaveProperty('stack', 'never exposed');
  });

  it('ignores blockers on any other error code', async () => {
    mockApi({
      'DELETE /users/me': blocked(
        [
          {
            type: 'BOARD_REQUIRES_ANOTHER_OWNER',
            totalCount: 1,
            resources: [],
          },
        ],
        'CONFLICT',
      ),
    });
    const error = (await apiRequest('/users/me', { method: 'DELETE' }).catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(error.code).toBe('CONFLICT');
    expect(error.blockers).toEqual([]);
  });

  it('drops unknown types, bad counts, duplicates and malformed resources; caps at 20', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: `b${i}`,
      name: `B${i}`,
    }));
    expect(
      parseDeletionBlockers([
        { type: 'EVERYTHING', totalCount: 1, resources: [] },
        { type: 'BOARD_REQUIRES_ANOTHER_OWNER', totalCount: -1, resources: [] },
        {
          type: 'BOARD_REQUIRES_ANOTHER_OWNER',
          totalCount: 1.5,
          resources: [],
        },
        {
          type: 'PERSONAL_WORKSPACE_HAS_BOARDS',
          totalCount: 30,
          resources: [...many, { id: 1 }, null],
        },
        { type: 'PERSONAL_WORKSPACE_HAS_BOARDS', totalCount: 2, resources: [] },
        'junk',
      ]),
    ).toEqual([
      {
        type: 'PERSONAL_WORKSPACE_HAS_BOARDS',
        totalCount: 30,
        resources: many.slice(0, 20),
      },
    ]);
    expect(parseDeletionBlockers({ not: 'an array' })).toEqual([]);
  });
});
