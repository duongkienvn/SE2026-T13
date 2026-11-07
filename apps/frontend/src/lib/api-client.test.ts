import { describe, expect, it, vi } from 'vitest';
import { MutationObserver } from '@tanstack/react-query';
import { fail, mockApi, ok } from '../test/mock-api';
import { apiRequest, ApiError, ClientErrorCode } from './api-client';
import { createQueryClient } from './query-client';

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

  it.each([200, 201])(
    'accepts a void handler with an empty %i body',
    async (status) => {
      mockApi({ 'POST /auth/logout': { status } });
      await expect(
        apiRequest('/auth/logout', { method: 'POST' }),
      ).resolves.toBeUndefined();
    },
  );

  it.each([200, 201])(
    'rejects malformed non-empty %i bodies without retrying mutations',
    async (status) => {
      for (const body of [
        '{"success":true,"data":',
        '<html>oops</html>',
        '   ',
      ]) {
        const fetch = vi.fn(async () => new Response(body, { status }));
        vi.stubGlobal('fetch', fetch);
        const onSuccess = vi.fn();
        const mutation = new MutationObserver(createQueryClient(), {
          mutationFn: () => apiRequest('/things', { method: 'POST' }),
          onSuccess,
        });

        await expect(mutation.mutate(undefined)).rejects.toMatchObject({
          name: 'ApiError',
          status,
          code: ClientErrorCode.INVALID_RESPONSE,
        });
        expect(onSuccess).not.toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledTimes(1);
      }
    },
  );

  it.each([200, 201])('rejects a failed %i response stream', async (status) => {
    const response = new Response(null, { status });
    vi.spyOn(response, 'text').mockRejectedValue(new TypeError('terminated'));
    const fetch = vi.fn(async () => response);
    vi.stubGlobal('fetch', fetch);

    await expect(
      apiRequest('/things', { method: 'PATCH' }),
    ).rejects.toMatchObject({
      status,
      code: ClientErrorCode.INVALID_RESPONSE,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['fetch', 'body'])(
    'preserves cancellation during %s without affecting another session',
    async (phase) => {
      const controller = new AbortController();
      const aborted = new DOMException(
        'The operation was aborted.',
        'AbortError',
      );
      const response = new Response(null, { status: 200 });
      vi.spyOn(response, 'text').mockImplementation(async () => {
        controller.abort();
        throw aborted;
      });
      const fetch = vi
        .fn()
        .mockImplementationOnce(async () => {
          if (phase === 'fetch') {
            controller.abort();
            throw aborted;
          }
          return response;
        })
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ success: true, data: 'new session' })),
        );
      vi.stubGlobal('fetch', fetch);

      const cancelled = apiRequest('/users/me', {
        accessToken: 'old',
        signal: controller.signal,
      });
      const current = apiRequest('/users/me', { accessToken: 'new' });
      await expect(cancelled).rejects.toBe(aborted);
      await expect(current).resolves.toBe('new session');
      expect(fetch.mock.calls[0][1]).toMatchObject({
        signal: controller.signal,
        headers: { Authorization: 'Bearer old' },
      });
      expect(fetch.mock.calls[1][1]).toMatchObject({
        headers: { Authorization: 'Bearer new' },
      });
    },
  );

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
