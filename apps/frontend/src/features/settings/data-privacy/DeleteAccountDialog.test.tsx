import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../../app/AppProviders';
import { routes } from '../../../app/routes';
import type { AuthContextValue } from '../../auth/auth-context';
import { useAuth } from '../../auth/useAuth';
import { okPage } from '../../../test/board-fixtures';
import { installGoogle } from '../../../test/fake-google';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockRequest,
  type MockResponse,
} from '../../../test/mock-api';
import { renderApp } from '../../../test/render';

type Handler =
  | MockResponse
  | ((request: MockRequest) => MockResponse | Promise<MockResponse>);

function signedIn(
  providers = { hasPassword: true, googleLinked: false },
  overrides: Record<string, Handler> = {},
) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  storeSession();
  return mockApi({
    'GET /users/me': ok(testUser),
    'GET /boards?page=1&limit=100': okPage([]),
    'GET /boards?page=1&limit=100&status=archived': okPage([]),
    'GET /workspaces?page=1&limit=100': okPage([]),
    'GET /auth/linked-providers': ok(providers),
    'POST /auth/logout': { status: 204 },
    ...overrides,
  });
}

const deletes = (calls: MockRequest[]) =>
  calls.filter((call) => call.method === 'DELETE' && call.path === '/users/me');

async function openDialog() {
  const app = renderApp('/settings/data-privacy');
  const zone = within(
    await screen.findByRole('region', { name: 'Danger Zone' }),
  );
  const opener = zone.getByRole('button', { name: 'Delete account' });
  // A real click focuses the button; fireEvent does not.
  opener.focus();
  fireEvent.click(opener);
  const dialog = within(
    await screen.findByRole('dialog', { name: 'Delete account' }),
  );
  return { ...app, dialog };
}

function blockedResponse(): MockResponse {
  return {
    status: 409,
    body: {
      success: false,
      statusCode: 409,
      code: 'ACCOUNT_DELETION_BLOCKED',
      message: 'Resolve ownership requirements before deleting your account',
      timestamp: '2026-11-05T00:00:00.000Z',
      path: '/api/users/me',
      blockers: [
        {
          type: 'PERSONAL_WORKSPACE_HAS_BOARDS',
          totalCount: 1,
          resources: [{ id: 'b-personal', name: 'Archived plan' }],
        },
        {
          type: 'BOARD_REQUIRES_ANOTHER_OWNER',
          totalCount: 24,
          resources: Array.from({ length: 20 }, (_, i) => ({
            id: `b-${i}`,
            name: `Shared ${i}`,
          })),
        },
        {
          type: 'TEAM_WORKSPACE_REQUIRES_ANOTHER_ADMIN',
          totalCount: 1,
          resources: [{ id: 'w-1', name: '<b>Team</b>' }],
        },
      ],
    },
  };
}

describe('Data & Privacy → Danger Zone', () => {
  it('sits below the unchanged export sections and explains what is kept', async () => {
    signedIn();
    renderApp('/settings/data-privacy');
    const zone = await screen.findByRole('region', { name: 'Danger Zone' });
    const regions = screen
      .getAllByRole('region')
      .map((region) => region.getAttribute('aria-labelledby'));
    expect(regions).toEqual([
      'account-export-heading',
      'board-export-heading',
      'danger-zone-heading',
    ]);
    expect(zone.textContent).toMatch(/irreversible/);
    expect(zone.textContent).toMatch(/“Deleted user”/);
  });

  it('nothing is deleted on open or while typing; DELETE is exact and case-sensitive', async () => {
    const calls = signedIn();
    const { dialog } = await openDialog();
    const submit = () =>
      dialog.getByRole('button', {
        name: 'Delete account',
      }) as HTMLButtonElement;
    const confirmation = dialog.getByLabelText('Type DELETE to confirm');
    fireEvent.change(await dialog.findByLabelText('Current password'), {
      target: { value: 'Current1!' },
    });
    for (const value of ['delete', 'DELETE ', ' DELETE', 'Delete']) {
      fireEvent.change(confirmation, { target: { value } });
      expect(submit().disabled).toBe(true);
    }
    fireEvent.change(confirmation, { target: { value: 'DELETE' } });
    expect(submit().disabled).toBe(false);
    expect(deletes(calls)).toHaveLength(0);
    expect(
      dialog.getByText(/Text you wrote in shared cards and comments is kept/),
    ).toBeTruthy();
    expect(
      dialog.getByText(/signed out immediately after deletion/),
    ).toBeTruthy();
  });

  it('a 204 sends one exact request, signs out once and shows the deleted confirmation', async () => {
    let release!: (value: MockResponse) => void;
    const pending = new Promise<MockResponse>((done) => {
      release = done;
    });
    const calls = signedIn(undefined, { 'DELETE /users/me': () => pending });
    const { dialog, router } = await openDialog();
    fireEvent.change(dialog.getByLabelText('Type DELETE to confirm'), {
      target: { value: 'DELETE' },
    });
    fireEvent.change(await dialog.findByLabelText('Current password'), {
      target: { value: 'Current1!' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Delete account' }));
    const busy = dialog.getByRole('button', {
      name: 'Deleting…',
    }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    // No optimistic sign-out while the request runs; Escape cannot close it.
    expect(localStorage.getItem('kanban.session')).not.toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    });
    expect(screen.getByRole('dialog', { name: 'Delete account' })).toBeTruthy();

    await act(async () => release({ status: 204 }));
    expect(
      await screen.findByRole('heading', {
        name: 'Your account has been deleted',
      }),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe('/account-deleted');
    expect(localStorage.getItem('kanban.session')).toBeNull();
    expect(deletes(calls)).toHaveLength(1);
    expect(deletes(calls)[0]).toMatchObject({
      headers: { Authorization: 'Bearer stored-token' },
      body: { confirmation: 'DELETE', currentPassword: 'Current1!' },
    });
    expect(Object.keys(deletes(calls)[0].body as object).sort()).toEqual([
      'confirmation',
      'currentPassword',
    ]);
    expect(calls.some((call) => call.path === '/auth/logout')).toBe(false);
  });

  it('shows committed deletion after the initiating session is revoked before 204', async () => {
    let release!: (value: MockResponse) => void;
    const pending = new Promise<MockResponse>((done) => {
      release = done;
    });
    signedIn(undefined, { 'DELETE /users/me': () => pending });
    const router = createMemoryRouter(routes, {
      initialEntries: ['/settings/data-privacy'],
    });
    let auth!: AuthContextValue;
    function Probe() {
      auth = useAuth();
      return null;
    }
    render(
      <AppProviders>
        <Probe />
        <RouterProvider router={router} />
      </AppProviders>,
    );
    const zone = within(
      await screen.findByRole('region', { name: 'Danger Zone' }),
    );
    fireEvent.click(zone.getByRole('button', { name: 'Delete account' }));
    const dialog = within(
      await screen.findByRole('dialog', { name: 'Delete account' }),
    );
    fireEvent.change(dialog.getByLabelText('Type DELETE to confirm'), {
      target: { value: 'DELETE' },
    });
    fireEvent.change(await dialog.findByLabelText('Current password'), {
      target: { value: 'Current1!' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Delete account' }));
    // A real revocation is discovered through the realtime 401 recheck.
    act(() => auth.signOut({ notifyServer: false }));
    await act(async () => release({ status: 204 }));
    expect(
      await screen.findByRole('heading', {
        name: 'Your account has been deleted',
      }),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe('/account-deleted');
    expect(localStorage.getItem('kanban.session')).toBeNull();
  });

  it('409 blockers are grouped with counts, safe names and links; the user stays signed in', async () => {
    signedIn(undefined, { 'DELETE /users/me': blockedResponse() });
    const { dialog } = await openDialog();
    fireEvent.change(dialog.getByLabelText('Type DELETE to confirm'), {
      target: { value: 'DELETE' },
    });
    fireEvent.change(await dialog.findByLabelText('Current password'), {
      target: { value: 'Current1!' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Delete account' }));
    const personal = await dialog.findByRole('region', {
      name: 'Move boards out of your Personal workspace',
    });
    expect(
      within(personal)
        .getByRole('link', { name: 'Move Archived plan' })
        .getAttribute('href'),
    ).toBe('/boards/b-personal/settings');
    const owners = dialog.getByRole('region', {
      name: 'Add another owner to these boards',
    });
    expect(owners.textContent).toContain('(24)');
    expect(within(owners).getAllByRole('link')).toHaveLength(20);
    expect(within(owners).getByText('Showing 20 of 24.')).toBeTruthy();
    expect(
      within(owners)
        .getByRole('link', { name: 'Members Shared 0' })
        .getAttribute('href'),
    ).toBe('/boards/b-0/members');
    const admins = dialog.getByRole('region', {
      name: 'Add another admin to these Team workspaces',
    });
    // Names are rendered as text, never HTML.
    expect(within(admins).getAllByText('<b>Team</b>').length).toBeGreaterThan(
      0,
    );
    expect(admins.querySelector('b')).toBeNull();
    expect(
      within(admins)
        .getByRole('link', { name: 'Members <b>Team</b>' })
        .getAttribute('href'),
    ).toBe('/workspaces/w-1/members');
    expect(localStorage.getItem('kanban.session')).not.toBeNull();
    // Password is cleared; a retry needs fresh proof.
    expect(
      (dialog.getByLabelText('Current password') as HTMLInputElement).value,
    ).toBe('');
  });

  it.each([
    [fail(403, 'INVALID_CREDENTIALS'), 'Your current password is incorrect.'],
    [fail(409, 'CONFLICT'), /Another change to your account is in progress/],
    [fail(429, 'TOO_MANY_REQUESTS'), /Too many attempts/],
    [fail(400, 'VALIDATION_FAILED'), /Type DELETE exactly/],
    [
      fail(500, 'INTERNAL_ERROR', 'stack trace'),
      /could not be deleted right now/,
    ],
  ])(
    'failure %# keeps the session and allows a safe retry',
    async (response, text) => {
      signedIn(undefined, { 'DELETE /users/me': response });
      const { dialog, router } = await openDialog();
      fireEvent.change(dialog.getByLabelText('Type DELETE to confirm'), {
        target: { value: 'DELETE' },
      });
      fireEvent.change(await dialog.findByLabelText('Current password'), {
        target: { value: 'Current1!' },
      });
      fireEvent.click(dialog.getByRole('button', { name: 'Delete account' }));
      expect(await dialog.findByText(text)).toBeTruthy();
      expect(screen.queryByText(/stack trace/)).toBeNull();
      expect(router.state.location.pathname).toBe('/settings/data-privacy');
      expect(localStorage.getItem('kanban.session')).not.toBeNull();
    },
  );

  it('Google-only: requires DELETE before the popup result counts, then sends only the Google proof', async () => {
    const google = installGoogle();
    const calls = signedIn(
      { hasPassword: false, googleLinked: true },
      { 'DELETE /users/me': { status: 204 } },
    );
    const { dialog } = await openDialog();
    expect(dialog.queryByLabelText('Current password')).toBeNull();
    expect(dialog.queryByRole('button', { name: 'Delete account' })).toBeNull();
    const button = await dialog.findByRole('button', {
      name: 'Continue with Google',
    });
    fireEvent.click(button);
    expect(dialog.getByText('Type DELETE to confirm.')).toBeTruthy();
    act(() => google.respond('ignored'));
    expect(deletes(calls)).toHaveLength(0);

    fireEvent.change(dialog.getByLabelText('Type DELETE to confirm'), {
      target: { value: 'DELETE' },
    });
    fireEvent.click(button);
    act(() => google.respond('fresh-google-token'));
    await screen.findByRole('heading', {
      name: 'Your account has been deleted',
    });
    expect(deletes(calls)[0].body).toEqual({
      confirmation: 'DELETE',
      googleCredential: 'fresh-google-token',
    });
  });

  it('a rejected Google proof does not sign the user out', async () => {
    const google = installGoogle();
    signedIn(
      { hasPassword: true, googleLinked: true },
      { 'DELETE /users/me': fail(401, 'INVALID_GOOGLE_CREDENTIAL') },
    );
    const { dialog } = await openDialog();
    fireEvent.click(
      await dialog.findByRole('radio', { name: /Google account/ }),
    );
    fireEvent.change(dialog.getByLabelText('Type DELETE to confirm'), {
      target: { value: 'DELETE' },
    });
    fireEvent.click(
      await dialog.findByRole('button', { name: 'Continue with Google' }),
    );
    act(() => google.respond('stale'));
    expect(
      await dialog.findByText(/Google couldn’t confirm your identity/),
    ).toBeTruthy();
    expect(localStorage.getItem('kanban.session')).not.toBeNull();
  });

  it('Cancel closes the dialog, clears it and returns focus to the opener', async () => {
    signedIn();
    const { dialog } = await openDialog();
    fireEvent.change(dialog.getByLabelText('Type DELETE to confirm'), {
      target: { value: 'DELETE' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Delete account' }),
      ).toBeNull(),
    );
    const opener = within(
      screen.getByRole('region', { name: 'Danger Zone' }),
    ).getByRole('button', { name: 'Delete account' });
    await waitFor(() => expect(document.activeElement).toBe(opener));
    fireEvent.click(opener);
    const reopened = within(
      await screen.findByRole('dialog', { name: 'Delete account' }),
    );
    expect(
      (reopened.getByLabelText('Type DELETE to confirm') as HTMLInputElement)
        .value,
    ).toBe('');
  });

  it('the deleted confirmation page is not reachable without a completed deletion', async () => {
    mockApi({});
    const { router } = renderApp('/account-deleted');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});
