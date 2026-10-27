import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { useAuth } from './useAuth';
import { useAuthSession } from './auth-session-context';
import { saveSession, SESSION_STORAGE_KEY } from './session';
import { ApiError } from '../../lib/api-client';
import { openPermalink } from '../../test/permalink-fixtures';
import { createdSockets } from '../../test/fake-socket';

const otherUser = {
  ...testUser,
  id: 'user-b',
  displayName: 'Grace Hopper',
  email: 'grace@example.com',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function storageEvent(
  key: string | null = SESSION_STORAGE_KEY,
  newValue = localStorage.getItem(SESSION_STORAGE_KEY),
  storageArea = localStorage,
) {
  window.dispatchEvent(
    new StorageEvent('storage', { key, newValue, storageArea }),
  );
}

function renderSession() {
  const client = new QueryClient();
  let auth!: ReturnType<typeof useAuth>;
  let scope!: ReturnType<typeof useAuthSession>;
  function Probe() {
    auth = useAuth();
    scope = useAuthSession();
    return null;
  }
  const view = render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return {
    ...view,
    client,
    get auth() {
      return auth;
    },
    get scope() {
      return scope;
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('cross-tab sessions', () => {
  it('does not pair one account with a newer storage snapshot during initialization', async () => {
    storeSession('a');
    const previous = localStorage.getItem(SESSION_STORAGE_KEY);
    const newer = JSON.stringify({
      accessToken: 'b',
      expiresAt: Date.now() + 60000,
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
      localStorage.setItem(SESSION_STORAGE_KEY, newer);
      return previous;
    });
    const calls = mockApi({ 'GET /users/me': ok(otherUser) });
    const view = renderSession();
    await waitFor(() => expect(view.auth.user).toEqual(otherUser));
    expect(calls.map((call) => call.headers.Authorization)).toEqual([
      'Bearer b',
    ]);
    expect(view.scope.isCurrent()).toBe(true);
  });

  it('resumes an intended Card permalink after remote login and disposes sockets on remote logout', async () => {
    const view = openPermalink({ direct: true, anonymous: true });
    await screen.findByRole('heading', { name: 'Welcome back' });
    saveSession('remote-token', 3600);
    act(() => storageEvent());
    await screen.findByRole('dialog', { name: 'Private card' });
    expect(view.router.state.location.pathname).toBe(view.cardPath);
    await waitFor(() => expect(createdSockets).toHaveLength(1));
    const socket = createdSockets[0].socket;
    localStorage.removeItem(SESSION_STORAGE_KEY);
    act(() => storageEvent());
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(view.router.state.location.pathname).toBe('/login');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Private board')).toBeNull();
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it('verifies a shared session when mounting a new tab or refreshing', async () => {
    storeSession();
    const calls = mockApi({ 'GET /users/me': ok(testUser) });
    const first = renderSession();
    expect(first.auth.status).toBe('loading');
    await waitFor(() => expect(first.auth.user).toEqual(testUser));
    first.unmount();
    const second = renderSession();
    expect(second.auth.status).toBe('loading');
    await waitFor(() => expect(second.auth.user).toEqual(testUser));
    expect(calls).toHaveLength(2);
  });

  it('verifies an incoming login and clears the old generation without echoing it', async () => {
    const response = deferred<MockResponse>();
    const calls = mockApi({ 'GET /users/me': () => response.promise });
    const view = renderSession();
    const oldScope = view.scope;
    view.client.setQueryData(['private'], 'previous data');
    saveSession('remote-token', 3600);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    act(() => storageEvent());
    expect(view.auth.status).toBe('loading');
    expect(view.auth.user).toBeNull();
    expect(oldScope.isCurrent()).toBe(false);
    expect(view.scope.generation).toBe(oldScope.generation + 1);
    expect(view.client.getQueryData(['private'])).toBeUndefined();
    await act(async () => response.resolve(ok(testUser)));
    await waitFor(() => expect(view.auth.status).toBe('authenticated'));
    expect(calls[0].headers.Authorization).toBe('Bearer remote-token');
    expect(write).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'clears local auth and all protected caches on remote logout (clear: %s)',
    async (clear) => {
      storeSession();
      const calls = mockApi({ 'GET /users/me': ok(testUser) });
      const view = renderSession();
      await waitFor(() => expect(view.auth.status).toBe('authenticated'));
      const oldScope = view.scope;
      view.client.setQueryData(['boards'], ['private board']);
      view.client
        .getMutationCache()
        .build(view.client, { mutationKey: ['private-mutation'] });
      if (clear) localStorage.clear();
      else localStorage.removeItem(SESSION_STORAGE_KEY);
      act(() => storageEvent(clear ? null : SESSION_STORAGE_KEY));
      expect(view.auth.status).toBe('anonymous');
      expect(oldScope.isCurrent()).toBe(false);
      expect(view.client.getQueryData(['boards'])).toBeUndefined();
      expect(view.client.getQueryData(currentUserQueryKey)).toBeUndefined();
      expect(view.client.getMutationCache().getAll()).toHaveLength(0);
      expect(calls).toHaveLength(1); // A receiver never sends a second logout command.
    },
  );

  it('re-verifies an account switch without exposing the previous user while loading', async () => {
    storeSession('a');
    const response = deferred<MockResponse>();
    mockApi({
      'GET /users/me': (request) =>
        request.headers.Authorization === 'Bearer a'
          ? ok(testUser)
          : response.promise,
    });
    const view = renderSession();
    await waitFor(() => expect(view.auth.user).toEqual(testUser));
    saveSession('b', 3600);
    act(() => storageEvent());
    expect(view.auth.status).toBe('loading');
    expect(view.auth.user).toBeNull();
    expect(view.client.getQueryData(currentUserQueryKey)).toBeUndefined();
    await act(async () => response.resolve(ok(otherUser)));
    await waitFor(() => expect(view.auth.user).toEqual(otherUser));
  });

  it('uses latest storage for rapid/duplicate events and ignores unrelated or legacy events', async () => {
    mockApi({ 'GET /users/me': ok(otherUser) });
    const view = renderSession();
    saveSession('a', 3600);
    const stale = localStorage.getItem(SESSION_STORAGE_KEY);
    saveSession('b', 3600);
    act(() => storageEvent(SESSION_STORAGE_KEY, stale));
    await waitFor(() => expect(view.auth.user).toEqual(otherUser));
    const generation = view.scope.generation;
    const clear = vi.spyOn(view.client, 'clear');
    act(() => {
      storageEvent(SESSION_STORAGE_KEY, null);
      storageEvent('kanvexa.theme', '{}');
      storageEvent(SESSION_STORAGE_KEY, null, sessionStorage);
    });
    expect(view.scope.generation).toBe(generation);
    expect(clear).not.toHaveBeenCalled();
    expect(view.auth.user).toEqual(otherUser);
  });

  it.each(['{broken', 'null', '{"accessToken":"expired","expiresAt":1}'])(
    'rejects incoming invalid data: %s',
    async (value) => {
      mockApi({});
      const view = renderSession();
      localStorage.setItem(SESSION_STORAGE_KEY, value);
      act(() => storageEvent());
      expect(view.auth.status).toBe('anonymous');
      expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    },
  );

  it('does not accept an incoming token rejected by the server', async () => {
    mockApi({ 'GET /users/me': fail(401, 'UNAUTHORIZED') });
    const view = renderSession();
    saveSession('invalid-signature-or-version', 3600);
    act(() => storageEvent());
    await waitFor(() => expect(view.auth.status).toBe('anonymous'));
    expect(view.auth.user).toBeNull();
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it.each([ok(testUser), fail(401, 'UNAUTHORIZED')])(
    'ignores late verification from a previous tab session (%j)',
    async (result) => {
      storeSession('a');
      const response = deferred<MockResponse>();
      const calls = mockApi({
        'GET /users/me': (request) =>
          request.headers.Authorization === 'Bearer a'
            ? response.promise
            : ok(otherUser),
      });
      const view = renderSession();
      await waitFor(() => expect(calls).toHaveLength(1));
      saveSession('b', 3600);
      act(() => storageEvent());
      await waitFor(() => expect(view.auth.user).toEqual(otherUser));
      await act(async () => response.resolve(result));
      expect(view.auth.user).toEqual(otherUser);
      expect(view.client.getQueryData(currentUserQueryKey)).toEqual(otherUser);
      expect(localStorage.getItem(SESSION_STORAGE_KEY)).toContain('"b"');
    },
  );

  it.each([false, true])(
    'rejects late authorized work, including before storage event delivery (delivered: %s)',
    async (delivered) => {
      storeSession('a');
      mockApi({
        'GET /users/me': (request) =>
          ok(
            request.headers.Authorization === 'Bearer a' ? testUser : otherUser,
          ),
      });
      const view = renderSession();
      await waitFor(() => expect(view.auth.user).toEqual(testUser));
      const success = deferred<string>();
      const unauthorized = deferred<string>();
      const successResult = view.auth
        .runAuthorized(() => success.promise)
        .catch((error: unknown) => error);
      const errorResult = view.auth
        .runAuthorized(() => unauthorized.promise)
        .catch((error: unknown) => error);
      const oldScope = view.scope;
      const retained = view.auth.runAuthorized;
      saveSession('b', 3600);
      if (delivered) act(() => storageEvent());
      else act(() => view.auth.signOut()); // A stale tab must not delete B's login.
      expect(oldScope.isCurrent()).toBe(false);
      const request = vi.fn(async () => 'must not run');
      await expect(retained(request)).rejects.toThrow(
        'Your session has ended.',
      );
      expect(request).not.toHaveBeenCalled();
      await act(async () => {
        success.resolve('old private data');
        unauthorized.reject(new ApiError(401, 'UNAUTHORIZED', 'Old 401'));
      });
      expect(await successResult).toBeInstanceOf(Error);
      await errorResult;
      expect(localStorage.getItem(SESSION_STORAGE_KEY)).toContain('"b"');
      if (!delivered) act(() => storageEvent());
      await waitFor(() => expect(view.auth.user).toEqual(otherUser));
    },
  );

  it('reconciles expiry immediately when a suspended tab regains focus', async () => {
    storeSession('short-lived', 5000);
    mockApi({ 'GET /users/me': ok(testUser) });
    const view = renderSession();
    await waitFor(() => expect(view.auth.user).toEqual(testUser));
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 6000);
    act(() => window.dispatchEvent(new Event('focus')));
    expect(view.auth.status).toBe('anonymous');
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('keeps same-tab login/logout working when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    mockApi({ 'POST /auth/logout': { status: 204 } });
    const view = renderSession();
    expect(view.auth.status).toBe('anonymous');
    act(() => view.auth.signIn(loginResponse()));
    expect(view.auth.user).toEqual(testUser);
    expect(view.scope.isCurrent()).toBe(true);
    act(() => view.auth.signOut());
    expect(view.auth.status).toBe('anonymous');
  });

  it('removes an older stored account if a new login cannot be persisted', async () => {
    storeSession('old');
    mockApi({ 'GET /users/me': ok(testUser) });
    const view = renderSession();
    await waitFor(() => expect(view.auth.user).toEqual(testUser));
    const storage = localStorage;
    vi.stubGlobal('localStorage', {
      getItem: storage.getItem.bind(storage),
      removeItem: storage.removeItem.bind(storage),
      setItem: () => {
        throw new Error('quota');
      },
    });
    act(() => view.auth.signIn(loginResponse(otherUser)));
    act(() => window.dispatchEvent(new Event('focus')));
    expect(view.auth.user).toEqual(otherUser);
    expect(view.scope.isCurrent()).toBe(true);
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });
});
