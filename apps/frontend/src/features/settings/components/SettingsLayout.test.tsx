import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mockApi, ok, storeSession, testUser } from '../../../test/mock-api';
import { renderApp } from '../../../test/render';
import { settingsSections } from '../sections';

/** Desktop or phone width; every other media query (dark mode) is off. */
function stubViewport(desktop: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width') ? desktop : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function signedIn() {
  storeSession();
  return mockApi({
    'GET /users/me': ok(testUser),
    'GET /users/me/preferences': ok({
      theme: 'light',
      timeZone: 'UTC',
      dateFormat: 'YYYY-MM-DD',
      weekStartsOn: 'monday',
    }),
    'GET /auth/linked-providers': ok({
      googleLinked: false,
      hasPassword: true,
    }),
    'PATCH /users/me': ok({ ...testUser, displayName: 'Ada King' }),
    'POST /auth/logout': ok(null),
  });
}

const settingsNav = () => screen.getByRole('navigation', { name: 'Settings' });

describe('Settings on desktop', () => {
  it('opens Profile from /settings and lists all seven sections in order', async () => {
    stubViewport(true);
    signedIn();
    const { router } = renderApp('/settings');
    await screen.findByRole('heading', { name: 'Profile', level: 1 });
    expect(router.state.location.pathname).toBe('/settings/profile');

    const items = within(settingsNav()).getAllByRole('listitem');
    expect(
      items.map((item) => item.textContent?.replace(/Soon|, coming soon/g, '')),
    ).toEqual(settingsSections.map((section) => section.label));
    expect(
      within(settingsNav())
        .getByRole('link', { name: 'Profile' })
        .getAttribute('aria-current'),
    ).toBe('page');
  });

  it('shows future sections as unavailable, never as links', async () => {
    stubViewport(true);
    signedIn();
    renderApp('/settings/profile');
    await screen.findByRole('heading', { name: 'Profile', level: 1 });
    const nav = within(settingsNav());
    for (const label of ['Notifications', 'Data & Privacy']) {
      expect(nav.queryByRole('link', { name: new RegExp(label) })).toBeNull();
      const item = nav.getByText(label).closest('li');
      expect(item?.textContent).toContain('coming soon');
      expect(item?.getAttribute('title')).toBe(`${label} — coming soon`);
      expect(item?.querySelector('a, button, [tabindex]')).toBeNull();
    }
  });

  it('has no fake page for a future section', async () => {
    stubViewport(true);
    signedIn();
    renderApp('/settings/notifications');
    expect(await screen.findByText(/page not found/i)).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Settings' })).toBeNull();
  });

  it('moves Security and Connected Accounts to their own sections', async () => {
    stubViewport(true);
    signedIn();
    const { router } = renderApp('/settings/profile');
    await screen.findByRole('heading', { name: 'Profile', level: 1 });
    expect(
      screen.queryByRole('heading', { name: 'Account security' }),
    ).toBeNull();
    expect(
      screen.queryByRole('heading', { name: 'Connected accounts' }),
    ).toBeNull();

    fireEvent.click(
      within(settingsNav()).getByRole('link', { name: 'Security' }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Account security' }),
    ).toBeTruthy();
    expect(await screen.findAllByLabelText(/current password/i)).toHaveLength(
      1,
    );
    expect(router.state.location.pathname).toBe('/settings/security');

    fireEvent.click(
      within(settingsNav()).getByRole('link', { name: 'Connected Accounts' }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Connected accounts' }),
    ).toBeTruthy();
  });

  it('redirects old /profile links, keeping query and state, without a history entry', async () => {
    stubViewport(true);
    signedIn();
    const { router } = renderApp({
      pathname: '/profile',
      search: '?from=email',
      state: { note: 'kept' },
    });
    await screen.findByRole('heading', { name: 'Profile', level: 1 });
    expect(router.state.location).toMatchObject({
      pathname: '/settings/profile',
      search: '?from=email',
      state: { note: 'kept' },
    });
    expect(router.state.historyAction).toBe('REPLACE');
  });
});

describe('Settings on phones', () => {
  it('shows the section list at /settings, then a detail page with Back', async () => {
    stubViewport(false);
    signedIn();
    const { router } = renderApp('/settings');
    await screen.findByRole('heading', { name: 'Settings', level: 1 });
    expect(router.state.location.pathname).toBe('/settings');
    const list = within(settingsNav());
    expect(list.getAllByRole('listitem')).toHaveLength(7);
    expect(list.getByText('Password and account recovery')).toBeTruthy();
    expect(list.queryByRole('link', { name: /Notifications/ })).toBeNull();

    fireEvent.click(list.getByRole('link', { name: /Security/ }));
    await screen.findByRole('heading', { name: 'Account security' });
    expect(screen.queryByRole('navigation', { name: 'Settings' })).toBeNull();

    fireEvent.click(screen.getByRole('link', { name: 'Back to Settings' }));
    await screen.findByRole('heading', { name: 'Settings', level: 1 });
    expect(router.state.location.pathname).toBe('/settings');
  });
});

describe('Unsaved profile edits', () => {
  async function editName() {
    await screen.findByRole('heading', { name: 'Profile', level: 1 });
    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'Ada King' },
    });
  }

  it('asks before a section link drops them, and can keep editing', async () => {
    stubViewport(true);
    signedIn();
    const { router } = renderApp('/settings/profile');
    await editName();

    fireEvent.click(
      within(settingsNav()).getByRole('link', { name: 'Security' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Discard unsaved changes?',
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Keep editing' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.pathname).toBe('/settings/profile');
    expect(
      (screen.getByLabelText('Display name') as HTMLInputElement).value,
    ).toBe('Ada King');

    fireEvent.click(
      within(settingsNav()).getByRole('link', { name: 'Security' }),
    );
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Discard changes',
      }),
    );
    await screen.findByRole('heading', { name: 'Account security' });
    expect(router.state.location.pathname).toBe('/settings/security');
  });

  it('does not ask once the edits are saved', async () => {
    stubViewport(true);
    signedIn();
    const { router } = renderApp('/settings/profile');
    await editName();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Profile updated.');

    fireEvent.click(
      within(settingsNav()).getByRole('link', { name: 'Security' }),
    );
    await screen.findByRole('heading', { name: 'Account security' });
    expect(router.state.location.pathname).toBe('/settings/security');
  });

  it('never holds up logout', async () => {
    stubViewport(true);
    signedIn();
    const { router } = renderApp('/settings/profile');
    await editName();
    fireEvent.click(
      screen.getByRole('button', {
        name: `Account menu for ${testUser.displayName}`,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
