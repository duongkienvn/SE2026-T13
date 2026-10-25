import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '../../../app/routes';
import {
  fail,
  loginResponse,
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockResponse,
} from '../../../test/mock-api';
import { renderApp } from '../../../test/render';
import { AuthProvider } from '../AuthProvider';
import { useAuth } from '../useAuth';
import type { AuthContextValue } from '../auth-context';

async function fillChange(
  currentPassword = 'OldPass123!',
  newPassword = 'NewPass123!',
) {
  await screen.findByLabelText('Current password');
  fireEvent.change(screen.getByLabelText('Current password'), {
    target: { value: currentPassword },
  });
  fireEvent.change(screen.getByLabelText('New password'), {
    target: { value: newPassword },
  });
  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: newPassword },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
}
function handlers(hasPassword = true) {
  return {
    'GET /users/me': ok(testUser),
    'GET /auth/linked-providers': ok({ hasPassword, googleLinked: true }),
    'POST /auth/logout': { status: 204 },
  };
}

describe('AccountSecurity', () => {
  it('changes password and ends the current session only after API success', async () => {
    storeSession();
    const calls = mockApi({
      ...handlers(),
      'POST /auth/change-password': { status: 204 },
    });
    renderApp('/profile');
    await fillChange();
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(await screen.findByText(/Password updated/)).toBeTruthy();
    expect(sessionStorage.getItem('kanban.session')).toBeNull();
    expect(calls.some((call) => call.path === '/auth/logout')).toBe(false);
    expect(
      calls.find((call) => call.path === '/auth/change-password'),
    ).toMatchObject({
      body: { currentPassword: 'OldPass123!', newPassword: 'NewPass123!' },
    });
  });
  it('shows safe reauthentication errors without logging out; allows retry', async () => {
    storeSession();
    let attempts = 0;
    mockApi({
      ...handlers(),
      'POST /auth/change-password': () =>
        ++attempts === 1
          ? fail(403, 'CURRENT_PASSWORD_INCORRECT')
          : { status: 204 },
    });
    renderApp('/profile');
    await fillChange('wrong');
    await screen.findByText('Could not confirm your current password.');
    expect(sessionStorage.getItem('kanban.session')).not.toBeNull();
    await fillChange();
    await screen.findByRole('heading', { name: 'Welcome back' });
  });
  it('rejects a reused password before sending', async () => {
    storeSession();
    const calls = mockApi(handlers());
    renderApp('/profile');
    await fillChange('OldPass123!', 'OldPass123!');
    expect(
      screen.getByText(
        'Choose a password different from your current password.',
      ),
    ).toBeTruthy();
    expect(calls.some((call) => call.path === '/auth/change-password')).toBe(
      false,
    );
  });
  it('routes Google-only accounts through verified-email recovery without a current-password field', async () => {
    storeSession();
    mockApi(handlers(false));
    renderApp('/profile');
    await screen.findByText(/To set a password, request a recovery link/);
    expect(screen.queryByLabelText('Current password')).toBeNull();
    fireEvent.click(
      screen.getByRole('link', { name: 'Set password via email' }),
    );
    await screen.findByRole('heading', { name: 'Forgot your password?' });
  });
  it.each([204, 401, 403])(
    'does not let an old change response (%s) log out or redirect a new session',
    async (status) => {
      storeSession('old-session');
      let resolve!: (value: MockResponse) => void;
      const pending = new Promise<MockResponse>((done) => {
        resolve = done;
      });
      const calls = mockApi({
        ...handlers(),
        'POST /auth/change-password': () => pending,
      });
      const client = new QueryClient();
      const router = createMemoryRouter(routes, {
        initialEntries: ['/profile'],
      });
      let auth!: AuthContextValue;
      function Probe() {
        auth = useAuth();
        return null;
      }
      render(
        <QueryClientProvider client={client}>
          <AuthProvider>
            <Probe />
            <RouterProvider router={router} />
          </AuthProvider>
        </QueryClientProvider>,
      );
      await fillChange();
      await waitFor(() =>
        expect(
          calls.some((call) => call.path === '/auth/change-password'),
        ).toBe(true),
      );
      const other = {
        ...testUser,
        id: 'other-user',
        displayName: 'Other User',
      };
      act(() =>
        auth.signIn({ ...loginResponse(other), accessToken: 'new-session' }),
      );
      await act(async () => {
        resolve(status === 204 ? { status } : fail(status, 'UNAUTHORIZED'));
      });
      expect(auth.user?.id).toBe(other.id);
      expect(router.state.location.pathname).toBe('/profile');
      expect(sessionStorage.getItem('kanban.session')).toContain('new-session');
      expect(screen.queryByText(/Password updated/)).toBeNull();
    },
  );
});
