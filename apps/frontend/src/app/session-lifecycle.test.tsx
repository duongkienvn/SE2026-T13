import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fail, mockApi, ok, storeSession, testUser } from '../test/mock-api';
import { renderApp } from '../test/render';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
});

describe('session lifecycle', () => {
  it('signs the user out when the access token expires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    storeSession('short-lived', 5_000);
    mockApi({ 'GET /users/me': ok(testUser) });
    const { router } = renderApp('/boards');
    await screen.findByRole('heading', { name: 'Boards' });

    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(sessionStorage.getItem('kanban.session')).toBeNull();
  });

  it('keeps long-lived sessions without exceeding the setTimeout limit', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    storeSession('long-lived', THIRTY_DAYS_MS);
    mockApi({ 'GET /users/me': ok(testUser) });
    const { router } = renderApp('/boards');
    await screen.findByRole('heading', { name: 'Boards' });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Larger delays overflow and fire at once, which would spin the expiry check.
    const delays = setTimeoutSpy.mock.calls.map(([, delay]) => delay ?? 0);
    expect(Math.max(...delays)).toBeLessThanOrEqual(2_147_483_647);
    expect(router.state.location.pathname).toBe('/boards');
    expect(sessionStorage.getItem('kanban.session')).not.toBeNull();
  });

  it('still shows the login form while a stored session cannot be verified', async () => {
    storeSession('unverifiable');
    mockApi({ 'GET /users/me': fail(503, 'INTERNAL_ERROR') });
    renderApp('/login');

    expect(
      await screen.findByRole('heading', { name: 'Welcome back' }),
    ).toBeTruthy();
    expect(screen.queryByText("We couldn't verify your session")).toBeNull();
  });

  it('reports an unreachable server on login without signing in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const { router } = renderApp('/login');

    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Log In' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not reach the server',
    );
    expect(router.state.location.pathname).toBe('/login');
    expect(sessionStorage.getItem('kanban.session')).toBeNull();
  });
});
