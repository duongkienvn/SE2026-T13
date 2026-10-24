import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installGoogle } from '../../../test/fake-google';
import { fail, loginResponse, mockApi, ok } from '../../../test/mock-api';
import { okPage } from '../../../test/board-fixtures';
import { renderApp } from '../../../test/render';

afterEach(() => vi.unstubAllEnvs());
describe('Google login and registration', () => {
  it.each(['/login', '/register'])(
    'orders primary action, one divider, Google and page switch on %s',
    async (path) => {
      const google = installGoogle();
      mockApi({});
      const view = renderApp(path);
      const primary = screen.getByRole('button', {
        name: path === '/login' ? 'Log In' : 'Create account',
      });
      const divider = screen.getByText('or continue with');
      const social = screen.getByRole('region', {
        name: 'Alternative sign-in',
      });
      const button = await within(social).findByRole('button', {
        name: 'Continue with Google',
      });
      const link = screen.getByRole('link', {
        name: path === '/login' ? 'Create one' : 'Log in',
      });
      const precedes = (a: Element, b: Element) =>
        expect(
          a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      precedes(primary, divider);
      precedes(divider, button);
      precedes(button, link);
      expect(screen.getAllByText('or continue with')).toHaveLength(1);
      expect(screen.queryByText('or', { exact: true })).toBeNull();
      // Rerender with local input state, then switch routes without reloading GIS.
      fireEvent.change(screen.getByLabelText('Email address'), {
        target: { value: 'ada@example.com' },
      });
      expect(
        screen.getAllByRole('button', { name: 'Continue with Google' }),
      ).toHaveLength(1);
      fireEvent.click(link);
      await waitFor(() =>
        expect(view.router.state.location.pathname).toBe(
          path === '/login' ? '/register' : '/login',
        ),
      );
      expect(
        await screen.findByRole('button', { name: 'Continue with Google' }),
      ).toBeTruthy();
      expect(screen.getAllByText('or continue with')).toHaveLength(1);
      expect(google.api.initialize).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['/login', '/register'])(
    'exchanges Google credential via the shared auth session from %s',
    async (path) => {
      const google = installGoogle();
      const calls = mockApi({
        'POST /auth/google': ok(loginResponse()),
        'GET /boards?page=1&limit=100': okPage([]),
      });
      renderApp(path);
      fireEvent.click(
        await screen.findByRole('button', { name: 'Continue with Google' }),
      );
      act(() => google.respond('google-sensitive-id-token'));
      expect(
        await screen.findByRole('heading', { name: 'Boards' }),
      ).toBeTruthy();
      expect(calls.find((call) => call.path === '/auth/google')?.body).toEqual({
        credential: 'google-sensitive-id-token',
      });
      expect(sessionStorage.getItem('kanban.session')).toContain(
        'test-access-token',
      );
      expect(JSON.stringify(sessionStorage)).not.toContain(
        'google-sensitive-id-token',
      );
      expect(JSON.stringify(localStorage)).not.toContain(
        'google-sensitive-id-token',
      );
    },
  );
  it('preserves protected redirect through Google sign-in', async () => {
    const google = installGoogle();
    mockApi({
      'POST /auth/google': ok(loginResponse()),
      'GET /auth/linked-providers': ok({
        googleLinked: true,
        hasPassword: false,
      }),
    });
    const { router } = renderApp({
      pathname: '/login',
      state: { from: '/profile' },
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Continue with Google' }),
    );
    act(() => google.respond());
    expect(
      await screen.findByRole('heading', { name: 'Profile' }),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe('/profile');
  });
  it('explains explicit linking without issuing/storing a session', async () => {
    const google = installGoogle();
    mockApi({ 'POST /auth/google': fail(409, 'ACCOUNT_LINK_REQUIRED') });
    renderApp('/register');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Continue with Google' }),
    );
    act(() => google.respond());
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Connected accounts',
    );
    expect(sessionStorage.getItem('kanban.session')).toBeNull();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeTruthy();
  });
  it.each(['EMAIL_NOT_VERIFIED', 'MAIL_DELIVERY_UNAVAILABLE'])(
    'offers existing email verification for %s',
    async (code) => {
      const google = installGoogle();
      mockApi({ 'POST /auth/google': fail(403, code) });
      const { router } = renderApp({
        pathname: '/login',
        state: { from: '/profile' },
      });
      fireEvent.click(
        await screen.findByRole('button', { name: 'Continue with Google' }),
      );
      act(() => google.respond());
      fireEvent.click(
        await screen.findByRole('link', { name: 'Request verification email' }),
      );
      expect(router.state.location.pathname).toBe('/check-email');
      expect(router.state.location.state).toEqual({ from: '/profile' });
      expect(sessionStorage.getItem('kanban.session')).toBeNull();
    },
  );
  it('keeps local login usable after a Google API error', async () => {
    const google = installGoogle();
    mockApi({
      'POST /auth/google': fail(503, 'GOOGLE_AUTH_UNAVAILABLE'),
      'POST /auth/login': ok(loginResponse()),
      'GET /boards?page=1&limit=100': okPage([]),
    });
    renderApp('/login');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Continue with Google' }),
    );
    act(() => google.respond());
    await screen.findByRole('alert');
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'legacy' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Log In' }));
    expect(await screen.findByRole('heading', { name: 'Boards' })).toBeTruthy();
  });
  it('ignores a completed request after navigating to another public page', async () => {
    const google = installGoogle();
    let finish!: (value: ReturnType<typeof ok>) => void;
    const response = new Promise<ReturnType<typeof ok>>((resolve) => {
      finish = resolve;
    });
    const calls = mockApi({ 'POST /auth/google': () => response });
    const { router } = renderApp('/login');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Continue with Google' }),
    );
    act(() => google.respond());
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(() => router.navigate('/register'));
    await act(async () => {
      finish(ok(loginResponse()));
      await response;
    });
    expect(router.state.location.pathname).toBe('/register');
    expect(sessionStorage.getItem('kanban.session')).toBeNull();
  });
  it('does not let a late Google response overwrite a newer password login', async () => {
    const google = installGoogle();
    let finish!: (value: ReturnType<typeof ok>) => void;
    const response = new Promise<ReturnType<typeof ok>>((resolve) => {
      finish = resolve;
    });
    const calls = mockApi({
      'POST /auth/google': () => response,
      'POST /auth/login': ok({
        ...loginResponse(),
        accessToken: 'new-local-session',
      }),
      'GET /boards?page=1&limit=100': okPage([]),
    });
    renderApp('/login');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Continue with Google' }),
    );
    act(() => google.respond());
    await waitFor(() => expect(calls).toHaveLength(1));
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'ada@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'legacy' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Log In' }));
    await screen.findByRole('heading', { name: 'Boards' });
    await act(async () => {
      finish(ok(loginResponse()));
      await response;
    });
    expect(sessionStorage.getItem('kanban.session')).toContain(
      'new-local-session',
    );
  });
});
