import { useQueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '../../app/AppProviders';
import {
  fail,
  loginResponse,
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockResponse,
} from '../../test/mock-api';
import { useAuth } from '../auth/useAuth';
import { preferencesKeys, usePreferences, useUpdatePreferences } from './hooks';
import type { UserPreferences } from './types';

const wrapper = ({ children }: { children: ReactNode }) => (
  <AppProviders>{children}</AppProviders>
);

const defaults: UserPreferences = {
  theme: 'system',
  timeZone: 'UTC',
  dateFormat: 'YYYY-MM-DD',
  weekStartsOn: 'monday',
};

const PATH = '/users/me/preferences';

/** A response the test releases explicitly, to control request ordering. */
function deferred() {
  let release!: (response: MockResponse) => void;
  const promise = new Promise<MockResponse>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function renderPreferences() {
  return renderHook(
    () => ({
      query: usePreferences(),
      update: useUpdatePreferences(),
      auth: useAuth(),
      client: useQueryClient(),
    }),
    { wrapper },
  );
}

const cached = (result: ReturnType<typeof renderPreferences>['result']) =>
  result.current.client.getQueryData<UserPreferences>(preferencesKeys.current);

describe('usePreferences', () => {
  it('does not request preferences without a session', async () => {
    const calls = mockApi({});
    const { result } = renderPreferences();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(calls).toHaveLength(0);
    expect(result.current.query.fetchStatus).toBe('idle');
  });

  it('loads defaults for a signed-in user with the bearer token', async () => {
    storeSession('prefs-token');
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      [`GET ${PATH}`]: ok(defaults),
    });
    const { result } = renderPreferences();
    await waitFor(() => expect(result.current.query.data).toEqual(defaults));
    const get = calls.find((call) => call.path === PATH);
    expect(get?.headers.Authorization).toBe('Bearer prefs-token');
  });
});

describe('useUpdatePreferences', () => {
  it('shows the change at once and keeps the server response', async () => {
    storeSession();
    const response = deferred();
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      [`GET ${PATH}`]: ok(defaults),
      [`PATCH ${PATH}`]: () => response.promise,
    });
    const { result } = renderPreferences();
    await waitFor(() => expect(result.current.query.data).toEqual(defaults));

    act(() => result.current.update.save({ theme: 'dark' }));
    await waitFor(() => expect(cached(result)?.theme).toBe('dark'));
    expect(result.current.update.isSuccess).toBe(false);

    response.release(
      ok({ ...defaults, theme: 'dark', timeZone: 'Asia/Tokyo' }),
    );
    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
    expect(cached(result)).toEqual({
      ...defaults,
      theme: 'dark',
      timeZone: 'Asia/Tokyo',
    });
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      theme: 'dark',
    });
  });

  it('reverts a failed save and reloads the authoritative value', async () => {
    storeSession();
    let gets = 0;
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      [`GET ${PATH}`]: () => {
        gets += 1;
        return ok(defaults);
      },
      [`PATCH ${PATH}`]: fail(503, 'SERVICE_UNAVAILABLE'),
    });
    const { result } = renderPreferences();
    await waitFor(() => expect(result.current.query.data).toEqual(defaults));

    act(() => result.current.update.save({ theme: 'dark' }));
    await waitFor(() => expect(result.current.update.isError).toBe(true));
    expect(cached(result)?.theme).toBe('system');
    await waitFor(() => expect(gets).toBe(2));
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
  });

  it('does not let a failed save undo a different field saved meanwhile', async () => {
    storeSession();
    const themeSave = deferred();
    const formatSave = deferred();
    let server: UserPreferences = { ...defaults, dateFormat: 'DD/MM/YYYY' };
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET ${PATH}`]: () => ok(server),
      [`PATCH ${PATH}`]: (request) =>
        'theme' in (request.body as object)
          ? themeSave.promise
          : formatSave.promise,
    });
    const { result } = renderPreferences();
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));

    act(() => result.current.update.save({ theme: 'dark' }));
    act(() => result.current.update.save({ dateFormat: 'MM/DD/YYYY' }));
    await waitFor(() =>
      expect(cached(result)).toMatchObject({
        theme: 'dark',
        dateFormat: 'MM/DD/YYYY',
      }),
    );

    // Responses arrive out of order: the later format save answers first.
    server = { ...defaults, dateFormat: 'MM/DD/YYYY' };
    formatSave.release(ok(server));
    await waitFor(() =>
      expect(cached(result)).toMatchObject({ dateFormat: 'MM/DD/YYYY' }),
    );
    // Merged by field: the format response must not reset the pending theme.
    expect(cached(result)?.theme).toBe('dark');

    themeSave.release(fail(503, 'SERVICE_UNAVAILABLE'));
    await waitFor(() => expect(cached(result)?.theme).toBe('system'));
    expect(cached(result)?.dateFormat).toBe('MM/DD/YYYY');
  });

  it('keeps a newer choice of the same field when an older save fails', async () => {
    storeSession();
    const darkSave = deferred();
    let server: UserPreferences = defaults;
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET ${PATH}`]: () => ok(server),
      [`PATCH ${PATH}`]: (request) => {
        if ((request.body as { theme: string }).theme === 'dark')
          return darkSave.promise;
        server = { ...defaults, theme: 'light' };
        return ok(server);
      },
    });
    const { result } = renderPreferences();
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));

    act(() => result.current.update.save({ theme: 'dark' }));
    act(() => result.current.update.save({ theme: 'light' }));
    await waitFor(() => expect(cached(result)?.theme).toBe('light'));

    // Record every cached value: a revert that a refetch later repairs still flashes.
    const seen: string[] = [];
    const unsubscribe = result.current.client
      .getQueryCache()
      .subscribe(() => seen.push(cached(result)?.theme ?? 'none'));
    darkSave.release(fail(503, 'SERVICE_UNAVAILABLE'));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    unsubscribe();
    expect(cached(result)?.theme).toBe('light');
    expect(seen).not.toContain('system');
  });

  it('ignores a response that arrives after another user signed in', async () => {
    storeSession();
    const oldSave = deferred();
    const nextUser = { ...testUser, id: 'user-b', email: 'b@example.com' };
    const nextPrefs = { ...defaults, theme: 'light' as const };
    let signedInAsB = false;
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET ${PATH}`]: () => ok(signedInAsB ? nextPrefs : defaults),
      [`PATCH ${PATH}`]: () => oldSave.promise,
    });
    const { result } = renderPreferences();
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));

    act(() => result.current.update.save({ theme: 'dark' }));
    await waitFor(() => expect(cached(result)?.theme).toBe('dark'));

    signedInAsB = true;
    act(() => result.current.auth.signIn(loginResponse(nextUser)));
    await waitFor(() => expect(result.current.query.data).toEqual(nextPrefs));

    oldSave.release(ok({ ...defaults, theme: 'dark' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(cached(result)).toEqual(nextPrefs);
  });
});
