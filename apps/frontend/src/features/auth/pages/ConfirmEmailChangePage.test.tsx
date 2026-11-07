import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../../app/routes';
import {
  fail,
  loginResponse,
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockRequest,
  type MockResponse,
} from '../../../test/mock-api';
import { renderApp } from '../../../test/render';
import type { AuthContextValue } from '../auth-context';
import { AuthProvider } from '../AuthProvider';
import {
  captureEmailChangeLink,
  clearIncomingEmailChangeToken,
  readIncomingEmailChangeToken,
} from '../email-change-link';
import { useAuth } from '../useAuth';

const TOKEN = 'A'.repeat(21) + '_-' + 'b'.repeat(20); // 43 base64url chars

afterEach(() => {
  clearIncomingEmailChangeToken();
  window.history.replaceState(null, '', '/');
});

const confirmCalls = (calls: MockRequest[]) =>
  calls.filter((call) => call.path === '/auth/email-change/confirm');

function signedIn(
  confirm?: MockResponse | (() => MockResponse | Promise<MockResponse>),
) {
  storeSession();
  return mockApi({
    'GET /users/me': ok(testUser),
    'POST /auth/logout': { status: 204 },
    ...(confirm ? { 'POST /auth/email-change/confirm': confirm } : {}),
  });
}

describe('email change link capture', () => {
  it('reads the token and strips it from the address bar before React mounts', () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    window.history.pushState(null, '', `/confirm-email-change?token=${TOKEN}`);
    captureEmailChangeLink();
    expect(readIncomingEmailChangeToken()).toBe(TOKEN);
    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe('/confirm-email-change');
    expect(replace).toHaveBeenCalled();
    expect(JSON.stringify(window.history.state ?? null)).not.toContain(TOKEN);
    expect(JSON.stringify({ ...localStorage })).not.toContain(TOKEN);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(TOKEN);
  });

  it('ignores other paths', () => {
    window.history.pushState(null, '', `/reset-password?token=${TOKEN}`);
    captureEmailChangeLink();
    expect(readIncomingEmailChangeToken()).toBeNull();
  });
});

describe('/confirm-email-change', () => {
  it('never confirms on load; a deliberate click confirms, signs out and asks to log in again', async () => {
    const calls = signedIn({ status: 204 });
    const { router } = renderApp(`/confirm-email-change?token=${TOKEN}`);
    const button = await screen.findByRole('button', {
      name: 'Confirm email change',
    });
    // The query string is removed from router history at once.
    expect(router.state.location.search).toBe('');
    expect(JSON.stringify(router.state.location.state ?? null)).not.toContain(
      TOKEN,
    );
    expect(screen.getByText(testUser.email)).toBeTruthy();
    expect(confirmCalls(calls)).toHaveLength(0);

    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByText(
      'Email updated. Log in with your new email address.',
    );
    expect(confirmCalls(calls)).toHaveLength(1);
    expect(confirmCalls(calls)[0]).toMatchObject({
      headers: { Authorization: 'Bearer stored-token' },
      body: { token: TOKEN },
    });
    expect(router.state.location.pathname).toBe('/login');
    expect(localStorage.getItem('kanban.session')).toBeNull();
    // Credential changes revoke the JWT; no best-effort logout call is needed.
    expect(calls.some((call) => call.path === '/auth/logout')).toBe(false);
  });

  it('signed out: asks to sign in with the current email and sends nothing', async () => {
    const calls = mockApi({});
    renderApp(`/confirm-email-change?token=${TOKEN}`);
    expect(await screen.findByText(/not the new one/)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Sign in' }).getAttribute('href'),
    ).toBe('/login');
    expect(
      screen.queryByRole('button', { name: 'Confirm email change' }),
    ).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('rejects a malformed link without a request', async () => {
    const calls = signedIn();
    renderApp('/confirm-email-change?token=short');
    expect(
      await screen.findByText(/This link is invalid, expired/),
    ).toBeTruthy();
    expect(confirmCalls(calls)).toHaveLength(0);
  });

  it.each([
    [
      fail(400, 'INVALID_EMAIL_CHANGE_TOKEN'),
      /This link is invalid, expired or already used, or it belongs to a different account/,
    ],
    [fail(409, 'EMAIL_CHANGE_UNAVAILABLE'), /can no longer be used/],
  ])(
    'a final %# error discards the proof and keeps the session',
    async (response, text) => {
      signedIn(response);
      renderApp(`/confirm-email-change?token=${TOKEN}`);
      fireEvent.click(
        await screen.findByRole('button', { name: 'Confirm email change' }),
      );
      expect(await screen.findByText(text)).toBeTruthy();
      expect(
        screen.queryByRole('button', { name: 'Confirm email change' }),
      ).toBeNull();
      expect(localStorage.getItem('kanban.session')).not.toBeNull();
    },
  );

  it('a transient 429 keeps the proof so the user can retry', async () => {
    let attempts = 0;
    const calls = signedIn(() =>
      ++attempts === 1 ? fail(429, 'TOO_MANY_REQUESTS') : { status: 204 },
    );
    renderApp(`/confirm-email-change?token=${TOKEN}`);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Confirm email change' }),
    );
    expect(await screen.findByText(/Too many attempts/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm email change' }),
    );
    await screen.findByText(/Email updated/);
    expect(confirmCalls(calls).map((c) => c.body)).toEqual([
      { token: TOKEN },
      { token: TOKEN },
    ]);
  });

  it('a 401 (old or expired JWT) ends only that session and shows sign-in guidance', async () => {
    signedIn(fail(401, 'UNAUTHORIZED'));
    renderApp(`/confirm-email-change?token=${TOKEN}`);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Confirm email change' }),
    );
    expect(await screen.findByText(/not the new one/)).toBeTruthy();
    expect(localStorage.getItem('kanban.session')).toBeNull();
  });

  it('shows a committed 204 after the initiating session was revoked before the response', async () => {
    storeSession('old-session');
    let resolve!: (value: MockResponse) => void;
    const pending = new Promise<MockResponse>((done) => {
      resolve = done;
    });
    mockApi({
      'GET /users/me': ok(testUser),
      'POST /auth/email-change/confirm': () => pending,
    });
    const router = createMemoryRouter(routes, {
      initialEntries: [`/confirm-email-change?token=${TOKEN}`],
    });
    let auth!: AuthContextValue;
    function Probe() {
      auth = useAuth();
      return null;
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Probe />
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Confirm email change' }),
    );
    // Same auth transition produced by the socket-driven 401 verification.
    act(() => auth.signOut({ notifyServer: false }));
    await act(async () => resolve({ status: 204 }));
    expect(
      await screen.findByText(
        'Email updated. Log in with your new email address.',
      ),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect(localStorage.getItem('kanban.session')).toBeNull();
  });

  it('a late 204 does not sign out a newer session', async () => {
    storeSession('old-session');
    let resolve!: (value: MockResponse) => void;
    const pending = new Promise<MockResponse>((done) => {
      resolve = done;
    });
    mockApi({
      'GET /users/me': ok(testUser),
      'POST /auth/email-change/confirm': () => pending,
    });
    const router = createMemoryRouter(routes, {
      initialEntries: [`/confirm-email-change?token=${TOKEN}`],
    });
    let auth!: AuthContextValue;
    function Probe() {
      auth = useAuth();
      return null;
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Probe />
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Confirm email change' }),
    );
    const other = { ...testUser, id: 'other-user', email: 'other@example.com' };
    act(() =>
      auth.signIn({ ...loginResponse(other), accessToken: 'new-session' }),
    );
    await act(async () => resolve({ status: 204 }));
    await waitFor(() => expect(auth.user?.id).toBe(other.id));
    expect(localStorage.getItem('kanban.session')).toContain('new-session');
    expect(router.state.location.pathname).toBe('/confirm-email-change');
  });
});
