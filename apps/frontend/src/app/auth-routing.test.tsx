import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  fail,
  loginResponse,
  mockApi,
  ok,
  storeSession,
  testUser,
} from '../test/mock-api';
import { renderApp } from '../test/render';

describe('auth routing and session restore', () => {
  it('redirects anonymous users from protected routes to login', async () => {
    const calls = mockApi({});
    const { router } = renderApp('/boards');

    expect(
      await screen.findByRole('heading', { name: 'Welcome back' }),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('sends the root path to login or boards depending on the session', async () => {
    const { router } = renderApp('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });

  it('restores a stored session through GET /users/me before rendering', async () => {
    storeSession('stored-token');
    const calls = mockApi({ 'GET /users/me': ok(testUser) });
    renderApp('/boards');

    expect(screen.getByRole('status').textContent).toContain(
      'Checking your session',
    );
    expect(await screen.findByRole('heading', { name: 'Boards' })).toBeTruthy();
    expect(calls[0].headers.Authorization).toBe('Bearer stored-token');
  });

  it('keeps signed-in users away from login and register', async () => {
    storeSession();
    mockApi({ 'GET /users/me': ok(testUser) });
    const { router } = renderApp('/register');

    await waitFor(() => expect(router.state.location.pathname).toBe('/boards'));
  });

  it('clears the session when the stored token is rejected', async () => {
    storeSession();
    mockApi({ 'GET /users/me': fail(401, 'UNAUTHORIZED') });
    const { router } = renderApp('/boards');

    expect(
      await screen.findByRole('heading', { name: 'Welcome back' }),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe('/login');
    expect(sessionStorage.getItem('kanban.session')).toBeNull();
  });

  it('skips the request for an expired stored token', async () => {
    storeSession('old-token', -1);
    const calls = mockApi({});
    renderApp('/boards');

    expect(
      await screen.findByRole('heading', { name: 'Welcome back' }),
    ).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('does not treat network or server errors as an expired session', async () => {
    storeSession('kept-token');
    let respond: (() => void) | undefined;
    let attempt = 0;
    mockApi({
      'GET /users/me': () => {
        attempt += 1;
        if (attempt === 1) return fail(500, 'INTERNAL_ERROR');
        return new Promise((resolve) => {
          respond = () => resolve(ok(testUser));
        });
      },
    });
    renderApp('/boards');

    expect(
      await screen.findByText("We couldn't verify your session"),
    ).toBeTruthy();
    expect(sessionStorage.getItem('kanban.session')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    // Retrying shows progress instead of leaving the error screen untouched.
    expect((await screen.findByRole('status')).textContent).toContain(
      'Checking your session',
    );
    respond?.();
    expect(await screen.findByRole('heading', { name: 'Boards' })).toBeTruthy();
  });

  it('lets a different user sign in over an unverified stored session', async () => {
    storeSession('stale-token');
    const other = { ...testUser, displayName: 'Grace Hopper' };
    mockApi({
      'GET /users/me': fail(503, 'INTERNAL_ERROR'),
      'POST /auth/login': ok(loginResponse(other)),
    });
    renderApp('/login');

    fireEvent.change(await screen.findByLabelText('Email address'), {
      target: { value: 'grace@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'nanoseconds' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Log In' }));

    expect(
      await screen.findByRole('button', {
        name: 'Account menu for Grace Hopper',
      }),
    ).toBeTruthy();
    expect(
      JSON.parse(sessionStorage.getItem('kanban.session')!).accessToken,
    ).toBe('test-access-token');
  });

  it('shows a not-found page for unknown routes', () => {
    renderApp('/does-not-exist');
    expect(
      screen.getByRole('heading', { name: 'Page not found' }),
    ).toBeTruthy();
  });
});
