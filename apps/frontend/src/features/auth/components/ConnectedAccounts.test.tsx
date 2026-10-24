import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../AuthProvider';
import { useAuth } from '../useAuth';
import { useAuthSession } from '../auth-session-context';
import type { AuthContextValue } from '../auth-context';
import { ConnectedAccounts } from './ConnectedAccounts';
import { installGoogle } from '../../../test/fake-google';
import {
  fail,
  loginResponse,
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockResponse,
} from '../../../test/mock-api';

afterEach(() => vi.unstubAllEnvs());
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let auth!: AuthContextValue;
  function Probe() {
    auth = useAuth();
    const { generation } = useAuthSession();
    return auth.user ? <ConnectedAccounts key={generation} /> : null;
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
  };
}

describe('Profile connected accounts', () => {
  it('requires password before opening a link attempt, then links using only the current JWT without rotation', async () => {
    const google = installGoogle();
    storeSession('existing-jwt');
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      'GET /auth/linked-providers': ok({
        googleLinked: false,
        hasPassword: true,
      }),
      'POST /auth/google/link': { status: 204 },
    });
    mount();
    const button = await screen.findByRole('button', {
      name: 'Continue with Google',
    });
    fireEvent.click(button);
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Enter your current',
    );
    expect(document.activeElement).toBe(
      screen.getByLabelText('Current password'),
    );
    act(() => google.respond());
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'legacy-password' },
    });
    fireEvent.click(button);
    act(() => google.respond());
    expect(await screen.findByText(/You can now sign in/)).toBeTruthy();
    expect(calls.find((c) => c.path === '/auth/google/link')).toMatchObject({
      headers: { Authorization: 'Bearer existing-jwt' },
      body: { credential: 'google-id-token', password: 'legacy-password' },
    });
    expect(sessionStorage.getItem('kanban.session')).toContain('existing-jwt');
    expect(sessionStorage.getItem('kanban.session')).not.toContain(
      'legacy-password',
    );
    expect(screen.queryByLabelText('Current password')).toBeNull();
  });

  it.each([
    ['INVALID_CREDENTIALS', 'Could not confirm your current password'],
    [
      'GOOGLE_ACCOUNT_CONFLICT',
      'Choose a Google account with the same verified email',
    ],
  ])('keeps the current session after %s', async (code, message) => {
    const google = installGoogle();
    storeSession('existing-jwt');
    mockApi({
      'GET /users/me': ok(testUser),
      'GET /auth/linked-providers': ok({
        googleLinked: false,
        hasPassword: true,
      }),
      'POST /auth/google/link': fail(403, code),
    });
    mount();
    const button = await screen.findByRole('button', {
      name: 'Continue with Google',
    });
    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'wrong' },
    });
    fireEvent.click(button);
    act(() => google.respond());
    expect((await screen.findByRole('alert')).textContent).toContain(message);
    expect(
      (screen.getByLabelText('Current password') as HTMLInputElement).value,
    ).toBe('');
    expect(sessionStorage.getItem('kanban.session')).toContain('existing-jwt');
  });

  it('shows Google-only status without a useless password form', async () => {
    installGoogle();
    storeSession();
    mockApi({
      'GET /users/me': ok(testUser),
      'GET /auth/linked-providers': ok({
        googleLinked: true,
        hasPassword: false,
      }),
    });
    mount();
    expect(await screen.findByText(/A password has not been set/)).toBeTruthy();
    expect(screen.queryByLabelText('Current password')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Continue with Google' }),
    ).toBeNull();
  });

  it('offers retry after status failure', async () => {
    storeSession();
    let attempts = 0;
    mockApi({
      'GET /users/me': ok(testUser),
      'GET /auth/linked-providers': () =>
        ++attempts === 1
          ? fail(503, 'INTERNAL_ERROR')
          : ok({ googleLinked: true, hasPassword: true }),
    });
    mount();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Retry connected accounts' }),
    );
    expect(await screen.findByText('Connected')).toBeTruthy();
  });

  it('ignores a stale linking result after another user signs in and does not populate their cache', async () => {
    const google = installGoogle();
    storeSession('old-user-jwt');
    let finish!: (response: MockResponse) => void;
    const result = new Promise<MockResponse>((resolve) => {
      finish = resolve;
    });
    const calls = mockApi({
      'GET /users/me': ok(testUser),
      'GET /auth/linked-providers': ok({
        googleLinked: false,
        hasPassword: true,
      }),
      'POST /auth/google/link': () => result,
    });
    const view = mount();
    fireEvent.change(await screen.findByLabelText('Current password'), {
      target: { value: 'legacy' },
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Continue with Google' }),
    );
    act(() => google.respond());
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST')).toBe(true),
    );
    const other = { ...testUser, id: 'other-user', displayName: 'Other user' };
    act(() =>
      view.auth.signIn({
        ...loginResponse(other),
        accessToken: 'new-user-jwt',
      }),
    );
    await screen.findByLabelText('Current password');
    await act(async () => {
      finish({ status: 204 });
      await result;
    });
    expect(screen.queryByText(/You can now sign in/)).toBeNull();
    expect(sessionStorage.getItem('kanban.session')).toContain('new-user-jwt');
    expect(view.client.getQueryData(['auth', 'linked-providers', 1])).toEqual({
      googleLinked: false,
      hasPassword: true,
    });
  });
});
