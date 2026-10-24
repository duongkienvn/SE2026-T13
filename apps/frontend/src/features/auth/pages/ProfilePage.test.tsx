import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  fail,
  loginResponse,
  mockApi,
  ok,
  storeSession,
  testUser,
} from '../../../test/mock-api';
import { renderApp } from '../../../test/render';

async function openProfile(extra: Parameters<typeof mockApi>[0] = {}) {
  storeSession('profile-token');
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    'GET /auth/linked-providers': ok({
      googleLinked: false,
      hasPassword: true,
    }),
    ...extra,
  });
  const view = renderApp('/profile');
  await screen.findByRole('heading', { name: 'Profile' });
  return { calls, ...view };
}

describe('ProfilePage', () => {
  it('shows the current user with a read-only email', async () => {
    await openProfile();

    const email = screen.getByLabelText('Email address') as HTMLInputElement;
    expect(email.value).toBe(testUser.email);
    expect(email.readOnly).toBe(true);
    expect(document.title).toBe('Profile · Kanvexa');
    expect(
      (screen.getByLabelText('Display name') as HTMLInputElement).value,
    ).toBe(testUser.displayName);
    expect(
      (
        screen.getByRole('button', {
          name: 'Save changes',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('never sends a PATCH when nothing changed', async () => {
    const { calls } = await openProfile();
    const name = screen.getByLabelText('Display name');
    const save = screen.getByRole('button', {
      name: 'Save changes',
    }) as HTMLButtonElement;

    // Edit and revert (with surrounding spaces that trim back to the same value).
    fireEvent.change(name, { target: { value: 'Someone' } });
    expect(save.disabled).toBe(false);
    fireEvent.change(name, { target: { value: ` ${testUser.displayName} ` } });
    expect(save.disabled).toBe(true);

    // Submitting anyway (e.g. Enter in a field) must not send an empty PATCH.
    fireEvent.submit(name.closest('form')!);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('sends only the changed fields and updates the header', async () => {
    const updated = { ...testUser, displayName: 'Countess Ada' };
    const { calls } = await openProfile({
      'PATCH /users/me': ok(updated),
    });

    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: ' Countess Ada ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect((await screen.findByRole('status')).textContent).toContain(
      'Profile updated.',
    );
    const patch = calls.find((call) => call.method === 'PATCH')!;
    expect(patch.body).toEqual({ displayName: 'Countess Ada' });
    expect(patch.headers.Authorization).toBe('Bearer profile-token');
    expect(
      screen.getByRole('button', { name: 'Account menu for Countess Ada' }),
    ).toBeTruthy();
  });

  it('requires an HTTPS avatar URL and sends null to clear it', async () => {
    const { calls } = await openProfile({
      'PATCH /users/me': ok({ ...testUser, avatarUrl: null }),
    });
    const avatar = screen.getByLabelText('Avatar URL');

    fireEvent.change(avatar, {
      target: { value: 'http://insecure.example/a.png' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      screen.getByText('Enter a valid HTTPS image URL, or leave it empty.'),
    ).toBeTruthy();
    expect(document.activeElement).toBe(avatar);
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('ends the session when the profile update is unauthorized', async () => {
    const { router } = await openProfile({
      'PATCH /users/me': fail(401, 'UNAUTHORIZED'),
    });

    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'Someone Else' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(sessionStorage.getItem('kanban.session')).toBeNull();
  });
});

describe('logout', () => {
  async function logOut() {
    fireEvent.click(
      await screen.findByRole('button', {
        name: `Account menu for ${testUser.displayName}`,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
  }

  it('calls the logout API and clears the local session', async () => {
    const { calls, router } = await openProfile({
      'POST /auth/logout': { status: 204 },
    });

    await logOut();

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    const logoutCall = calls.find((call) => call.path === '/auth/logout')!;
    expect(logoutCall.headers.Authorization).toBe('Bearer profile-token');
    expect(sessionStorage.getItem('kanban.session')).toBeNull();
  });

  it('still logs out locally when the logout API fails', async () => {
    const { router } = await openProfile({
      'POST /auth/logout': fail(500, 'INTERNAL_ERROR'),
    });

    await logOut();

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(sessionStorage.getItem('kanban.session')).toBeNull();
  });

  it('does not show the previous account after switching users', async () => {
    const other = {
      ...testUser,
      id: '00000000-0000-4000-8000-000000000002',
      email: 'grace@example.com',
      displayName: 'Grace Hopper',
    };
    await openProfile({
      'POST /auth/logout': { status: 204 },
      'POST /auth/login': ok(loginResponse(other)),
    });

    await logOut();
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: other.email },
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
    expect(screen.queryByText(testUser.displayName)).toBeNull();
  });
});
