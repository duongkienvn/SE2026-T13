import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { okPage } from '../../../test/board-fixtures';
import {
  fail,
  loginResponse,
  mockApi,
  ok,
  testUser,
} from '../../../test/mock-api';
import { renderApp } from '../../../test/render';

function fillLogin(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Log In' }));
}

describe('LoginPage', () => {
  it('allows a verified existing user to log in with a weak legacy password', async () => {
    const calls = mockApi({
      'POST /auth/login': ok(loginResponse()),
      'GET /boards?page=1&limit=100': okPage([]),
    });
    renderApp('/login');
    fillLogin(testUser.email, '12345678');
    expect(await screen.findByRole('heading', { name: 'Boards' })).toBeTruthy();
    expect(calls[0].body).toEqual({
      email: testUser.email,
      password: '12345678',
    });
  });
  it('renders the login form without out-of-scope controls', () => {
    renderApp('/login');

    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy();
    expect(screen.getByLabelText('Email address')).toBeTruthy();
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe(
      'password',
    );
    expect(screen.getByRole('link', { name: 'Create one' })).toBeTruthy();
    expect(screen.queryByText(/remember me/i)).toBeNull();
    expect(
      screen
        .getByRole('link', { name: 'Forgot password?' })
        .getAttribute('href'),
    ).toBe('/forgot-password');
  });

  it('toggles password visibility', () => {
    renderApp('/login');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeTruthy();
  });

  it('sets the tab title', () => {
    renderApp('/login');
    expect(document.title).toBe('Log in · Kanvexa');
  });

  it('moves focus to the first invalid field after a failed submit', () => {
    mockApi({});
    renderApp('/login');

    fillLogin('', '');
    expect(document.activeElement).toBe(screen.getByLabelText('Email address'));

    fillLogin('ada@example.com', '');
    expect(document.activeElement).toBe(screen.getByLabelText('Password'));
  });

  it('validates input before sending a request', () => {
    const calls = mockApi({});
    renderApp('/login');

    fillLogin('not-an-email', '');

    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
    expect(screen.getByText('Enter your password.')).toBeTruthy();
    expect(
      screen.getByLabelText('Email address').getAttribute('aria-invalid'),
    ).toBe('true');
    expect(calls).toHaveLength(0);
  });

  it('stores the token, normalizes the email and opens the boards page', async () => {
    const calls = mockApi({ 'POST /auth/login': ok(loginResponse()) });
    renderApp('/login');

    fillLogin('  Ada@Example.COM ', 'correct-horse');

    expect(await screen.findByRole('heading', { name: 'Boards' })).toBeTruthy();
    expect(calls[0].body).toEqual({
      email: 'ada@example.com',
      password: 'correct-horse',
    });
    expect(
      JSON.parse(sessionStorage.getItem('kanban.session')!).accessToken,
    ).toBe('test-access-token');
    expect(
      screen.getByRole('button', {
        name: `Account menu for ${testUser.displayName}`,
      }),
    ).toBeTruthy();
  });

  it('shows a generic error for wrong credentials and stays on login', async () => {
    mockApi({
      'POST /auth/login': fail(
        401,
        'INVALID_CREDENTIALS',
        'Invalid credentials',
      ),
    });
    const { router } = renderApp('/login');

    fillLogin('ada@example.com', 'wrong-password');

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Incorrect email or password.',
    );
    expect(router.state.location.pathname).toBe('/login');
    expect(sessionStorage.getItem('kanban.session')).toBeNull();
  });

  it('asks the user to wait when rate limited', async () => {
    mockApi({ 'POST /auth/login': fail(429, 'TOO_MANY_REQUESTS') });
    renderApp('/login');

    fillLogin('ada@example.com', 'whatever-pass');

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Too many attempts',
    );
  });

  it('offers resend for an unverified account and never stores a session', async () => {
    mockApi({ 'POST /auth/login': fail(403, 'EMAIL_NOT_VERIFIED') });
    const { router } = renderApp('/login');
    fillLogin('ada@example.com', 'correct-password');
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Verify your email',
    );
    expect(sessionStorage.getItem('kanban.session')).toBeNull();
    fireEvent.click(
      screen.getByRole('link', { name: 'Resend verification email' }),
    );
    expect(router.state.location.pathname).toBe('/check-email');
    expect(
      (
        screen.getByRole('button', {
          name: 'Resend verification email',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it('prevents duplicate submissions while the request is pending', async () => {
    let release: () => void = () => undefined;
    const calls = mockApi({
      'POST /auth/login': () =>
        new Promise((resolve) => {
          release = () =>
            resolve(fail(401, 'INVALID_CREDENTIALS', 'Invalid credentials'));
        }),
    });
    renderApp('/login');

    fillLogin('ada@example.com', 'password-1');
    const submit = await screen.findByRole('button', { name: 'Logging in…' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(submit.closest('form')!);

    release();
    await screen.findByRole('alert');
    expect(calls).toHaveLength(1);
  });

  it('returns to the protected page the user originally requested', async () => {
    mockApi({ 'POST /auth/login': ok(loginResponse()) });
    const { router } = renderApp('/profile');

    await screen.findByRole('heading', { name: 'Welcome back' });
    fillLogin('ada@example.com', 'correct-horse');

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/profile'),
    );
    expect(
      await screen.findByRole('heading', { name: 'Profile' }),
    ).toBeTruthy();
  });
});
