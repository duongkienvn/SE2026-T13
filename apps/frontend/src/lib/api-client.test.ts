import { describe, expect, it, vi } from 'vitest';
import { fail, mockApi, ok } from '../test/mock-api';
import { apiRequest, ApiError, ClientErrorCode } from './api-client';

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
