import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../app/routes';
import {
  fail,
  loginResponse,
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockResponse,
} from '../../test/mock-api';
import { AuthProvider, currentUserQueryKey } from './AuthProvider';
import type { AuthContextValue } from './auth-context';
import { useAuthSession, type AuthSessionScope } from './auth-session-context';
import { useAuth } from './useAuth';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const otherUser = {
  ...testUser,
  id: '00000000-0000-4000-8000-000000000002',
  email: 'grace@example.com',
  displayName: 'Grace Hopper',
};
const oldProfile = { ...testUser, displayName: 'Old session profile' };

function renderSession(path = '/profile', mutationCache?: MutationCache) {
  const client = new QueryClient({ mutationCache });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  let auth!: AuthContextValue;
  let scope!: AuthSessionScope;
  function Probe() {
    auth = useAuth();
    scope = useAuthSession();
    return null;
  }
  const view = render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Probe />
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return {
    ...view,
    client,
    router,
    get auth() {
      return auth;
    },
    get scope() {
      return scope;
    },
  };
}

async function pendingPatch(mutationCache?: MutationCache) {
  const response = deferred<MockResponse>();
  storeSession('same-token');
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    'PATCH /users/me': () => response.promise,
    'POST /auth/logout': { status: 204 },
  });
  const view = renderSession('/profile', mutationCache);
  await screen.findByRole('heading', { name: 'Profile' });
  fireEvent.change(screen.getByLabelText('Display name'), {
    target: { value: oldProfile.displayName },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() =>
    expect(calls.some((call) => call.method === 'PATCH')).toBe(true),
  );
  const mutation = view.client.getMutationCache().getAll()[0];
  const settle = async (result: MockResponse) => {
    await act(async () => {
      response.resolve(result);
    });
    await waitFor(() => expect(mutation.state.status).not.toBe('pending'));
  };
  return { view, settle, calls };
}

function expectUser(view: ReturnType<typeof renderSession>, user = otherUser) {
  expect(view.auth.status).toBe('authenticated');
  expect(view.auth.user).toEqual(user);
  expect(view.client.getQueryData(currentUserQueryKey)).toEqual(user);
  expect(
    screen.getByRole('button', {
      name: `Account menu for ${user.displayName}`,
    }),
  ).toBeTruthy();
  expect(screen.queryByText(oldProfile.displayName)).toBeNull();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('auth session isolation', () => {
  it('applies a PATCH to the cache and form in the same session', async () => {
    const { view, settle, calls } = await pendingPatch();
    const generation = view.scope.generation;
    await settle(ok(oldProfile));
    expect(view.scope.generation).toBe(generation);
    expect(view.client.getQueryData(currentUserQueryKey)).toEqual(oldProfile);
    expect(view.auth.user).toEqual(oldProfile);
    expect(
      (screen.getByLabelText('Display name') as HTMLInputElement).value,
    ).toBe(oldProfile.displayName);
    expect(screen.getByRole('status').textContent).toContain(
      'Profile updated.',
    );
    expect(
      calls.find((call) => call.method === 'PATCH')?.headers.Authorization,
    ).toBe('Bearer same-token');
  });

  it.each([
    ['success', ok(oldProfile)],
    ['401', fail(401, 'UNAUTHORIZED')],
    ['validation error', fail(400, 'VALIDATION_FAILED', 'Old session error')],
  ])(
    'ignores an old PATCH %s after A logs out and B logs in',
    async (_, result) => {
      const { view, settle } = await pendingPatch();
      const oldScope = view.scope;
      act(() => view.auth.signOut());
      expect(oldScope.isCurrent()).toBe(false);
      expect(view.scope.generation).toBeGreaterThan(oldScope.generation);
      act(() =>
        view.auth.signIn({
          ...loginResponse(otherUser),
          accessToken: 'b-token',
        }),
      );
      await screen.findByRole('heading', { name: 'Profile' });
      const writes = vi.spyOn(view.client, 'setQueryData');
      await settle(result);
      expectUser(view);
      expect(writes).not.toHaveBeenCalled();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(
        JSON.parse(sessionStorage.getItem('kanban.session')!).accessToken,
      ).toBe('b-token');
    },
  );

  it.each([ok(oldProfile), fail(401, 'UNAUTHORIZED')])(
    'keeps an anonymous cache empty after logout with a pending PATCH (%j)',
    async (result) => {
      const { view, settle } = await pendingPatch();
      act(() => view.auth.signOut());
      await settle(result);
      expect(view.auth.status).toBe('anonymous');
      expect(view.auth.user).toBeNull();
      expect(view.client.getQueryData(currentUserQueryKey)).toBeUndefined();
      expect(sessionStorage.getItem('kanban.session')).toBeNull();
      expect(screen.queryByText(oldProfile.displayName)).toBeNull();
    },
  );

  it('distinguishes a fresh login to the same account with the same token', async () => {
    const { view, settle } = await pendingPatch();
    const oldScope = view.scope;
    act(() => view.auth.signOut());
    act(() =>
      view.auth.signIn({ ...loginResponse(), accessToken: 'same-token' }),
    );
    await screen.findByRole('heading', { name: 'Profile' });
    await settle(ok(oldProfile));
    expectUser(view, testUser);
    expect(view.scope.generation).toBe(oldScope.generation + 2);
    expect(
      (screen.getByLabelText('Display name') as HTMLInputElement).value,
    ).toBe(testUser.displayName);
  });

  it('checks the initiating generation again between request completion and onSuccess', async () => {
    const callback = deferred<void>();
    const reachedCallback = deferred<void>();
    const cache = new MutationCache({
      onSuccess: async () => {
        reachedCallback.resolve();
        await callback.promise;
      },
    });
    const { view, settle } = await pendingPatch(cache);
    const settling = settle(ok(oldProfile));
    await reachedCallback.promise;
    act(() => view.auth.signIn(loginResponse(otherUser)));
    await act(async () => {
      callback.resolve();
    });
    await settling;
    expectUser(view);
  });

  it('isolates a pending mutation even if cache clearing cannot remove it', async () => {
    const { view, settle } = await pendingPatch();
    // Cache cleanup is not the security boundary for mutations.
    const clear = vi
      .spyOn(view.client, 'clear')
      .mockImplementation(() => undefined);
    act(() => view.auth.signOut());
    act(() => view.auth.signIn(loginResponse(otherUser)));
    await settle(ok(oldProfile));
    expect(clear).toHaveBeenCalledTimes(2);
    expectUser(view);
  });

  it.each([
    ['success', ok(testUser)],
    ['401', fail(401, 'UNAUTHORIZED')],
  ])(
    'ignores stored-session verification %s arriving after a new login',
    async (_, result) => {
      const response = deferred<MockResponse>();
      storeSession();
      const calls = mockApi({ 'GET /users/me': () => response.promise });
      const view = renderSession('/login');
      await waitFor(() => expect(calls).toHaveLength(1));
      act(() => view.auth.signIn(loginResponse(otherUser)));
      await act(async () => {
        response.resolve(result);
      });
      expectUser(view);
    },
  );

  it('does not restore profile data when pending verification completes after logout', async () => {
    const response = deferred<MockResponse>();
    storeSession();
    const calls = mockApi({
      'GET /users/me': () => response.promise,
      'POST /auth/logout': { status: 204 },
    });
    const view = renderSession();
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => view.auth.signOut());
    await act(async () => {
      response.resolve(ok(testUser));
    });
    expect(view.auth.user).toBeNull();
    expect(view.client.getQueryData(currentUserQueryKey)).toBeUndefined();
  });

  it('invalidates the generation on a current-session 401', async () => {
    const { view, settle } = await pendingPatch();
    const oldScope = view.scope;
    await settle(fail(401, 'UNAUTHORIZED'));
    expect(view.auth.status).toBe('anonymous');
    expect(view.scope.generation).toBe(oldScope.generation + 1);
    expect(oldScope.isCurrent()).toBe(false);
  });

  it('invalidates pending work when the session expires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { view, settle } = await pendingPatch();
    const expiringScope = view.scope;
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(view.scope.generation).toBe(expiringScope.generation + 1);
    expect(expiringScope.isCurrent()).toBe(false);
    await settle(ok(oldProfile));
    expect(view.auth.status).toBe('anonymous');
    expect(view.client.getQueryData(currentUserQueryKey)).toBeUndefined();
  });

  it('keeps a new login after expiry when the expired PATCH returns 401', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { view, settle } = await pendingPatch();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    act(() => view.auth.signIn(loginResponse(otherUser)));
    await settle(fail(401, 'UNAUTHORIZED'));
    expectUser(view);
  });

  it('rejects retained authorized callbacks without sending old credentials', async () => {
    mockApi({});
    const view = renderSession('/login');
    act(() => view.auth.signIn(loginResponse()));
    const request = vi.fn(async () => testUser);
    const oldAuthorized = view.auth.runAuthorized;
    act(() => view.auth.signIn(loginResponse(otherUser)));
    await expect(oldAuthorized(request)).rejects.toThrow(
      'Your session has ended.',
    );
    expect(request).not.toHaveBeenCalled();
    expectUser(view);
  });

  it.each(['login', 'register'] as const)(
    'ignores a pending %s after another session starts',
    async (page) => {
      const response = deferred<MockResponse>();
      const calls = mockApi({ [`POST /auth/${page}`]: () => response.promise });
      const view = renderSession(`/${page}`);
      if (page === 'register') {
        fireEvent.change(screen.getByLabelText('Display name'), {
          target: { value: testUser.displayName },
        });
        fireEvent.change(screen.getByLabelText('Confirm password'), {
          target: { value: 'password123' },
        });
      }
      fireEvent.change(screen.getByLabelText('Email address'), {
        target: { value: testUser.email },
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      });
      fireEvent.click(
        screen.getByRole('button', {
          name: page === 'login' ? 'Log In' : 'Create account',
        }),
      );
      await waitFor(() => expect(calls).toHaveLength(1));
      const mutation = view.client.getMutationCache().getAll()[0];
      act(() => view.auth.signIn(loginResponse(otherUser)));
      await screen.findByRole('heading', { name: 'Boards' });
      await act(async () => {
        response.resolve(ok(page === 'login' ? loginResponse() : testUser));
      });
      await waitFor(() => expect(mutation.state.status).toBe('success'));
      expectUser(view);
      expect(view.router.state.location.pathname).toBe('/boards');
      expect(view.router.state.location.state).toBeNull();
    },
  );
});
