import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppProviders } from '../../app/AppProviders';
import {
  loginResponse,
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockResponse,
} from '../../test/mock-api';
import { stubColorScheme, tokenFor } from '../../test/theme-fixtures';
import { useAuth } from '../auth/useAuth';
import { THEME_CACHE_KEY } from './theme';
import type { ThemePreference, UserPreferences } from './types';

const PATH = '/users/me/preferences';
const prefs = (theme: ThemePreference): UserPreferences => ({
  theme,
  timeZone: 'UTC',
  dateFormat: 'YYYY-MM-DD',
  weekStartsOn: 'monday',
});

const theme = () => document.documentElement.dataset.theme;
const cache = () => JSON.parse(localStorage.getItem(THEME_CACHE_KEY) ?? 'null');

let auth: ReturnType<typeof useAuth>;
function AuthProbe() {
  auth = useAuth();
  return null;
}

function renderApp() {
  return render(
    <AppProviders>
      <AuthProbe />
    </AppProviders>,
  );
}

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('ThemeSync', () => {
  it('follows the OS live while signed out', async () => {
    const scheme = stubColorScheme(false);
    mockApi({});
    renderApp();
    await waitFor(() => expect(theme()).toBe('light'));
    act(() => scheme.setDark(true));
    expect(theme()).toBe('dark');
  });

  it("applies and caches the signed-in user's saved theme", async () => {
    stubColorScheme(false);
    storeSession();
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET ${PATH}`]: ok(prefs('dark')),
    });
    renderApp();
    await waitFor(() => expect(theme()).toBe('dark'));
    expect(cache()).toEqual({ userId: testUser.id, theme: 'dark' });
  });

  it('keeps an explicit choice when the OS changes, but tracks it for system', async () => {
    const scheme = stubColorScheme(false);
    storeSession();
    let saved = prefs('light');
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET ${PATH}`]: () => ok(saved),
    });
    renderApp();
    await waitFor(() => expect(cache()?.theme).toBe('light'));
    act(() => scheme.setDark(true));
    expect(theme()).toBe('light');

    saved = prefs('system');
    act(() => auth.signIn(loginResponse()));
    await waitFor(() => expect(cache()?.theme).toBe('system'));
    expect(theme()).toBe('dark');
    act(() => scheme.setDark(false));
    expect(theme()).toBe('light');
  });

  it('keeps the boot theme while the session is still being confirmed', async () => {
    stubColorScheme(false);
    storeSession();
    document.documentElement.dataset.theme = 'dark';
    let releaseUser!: (response: MockResponse) => void;
    mockApi({
      'GET /users/me': () =>
        new Promise<MockResponse>((resolve) => (releaseUser = resolve)),
      [`GET ${PATH}`]: ok(prefs('dark')),
    });
    renderApp();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(theme()).toBe('dark');
    releaseUser(ok(testUser));
    await waitFor(() => expect(cache()?.theme).toBe('dark'));
  });

  it('uses the cached theme until the preferences request answers', async () => {
    stubColorScheme(false);
    storeSession(tokenFor(testUser.id));
    localStorage.setItem(
      THEME_CACHE_KEY,
      JSON.stringify({ userId: testUser.id, theme: 'dark' }),
    );
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET ${PATH}`]: () => new Promise<MockResponse>(() => undefined),
    });
    renderApp();
    await waitFor(() => expect(auth.status).toBe('authenticated'));
    expect(theme()).toBe('dark');
  });

  it("does not show the previous account's theme to the next one", async () => {
    stubColorScheme(false);
    storeSession();
    const userB = { ...testUser, id: 'user-b', email: 'b@example.com' };
    let signedInAsB = false;
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET ${PATH}`]: () =>
        signedInAsB
          ? new Promise<MockResponse>(() => undefined)
          : ok(prefs('dark')),
    });
    renderApp();
    await waitFor(() => expect(theme()).toBe('dark'));

    signedInAsB = true;
    act(() => auth.signIn(loginResponse(userB)));
    await waitFor(() => expect(theme()).toBe('light'));
  });

  it('forgets the cached theme on logout and returns to the OS theme', async () => {
    stubColorScheme(false);
    storeSession();
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET ${PATH}`]: ok(prefs('dark')),
      'POST /auth/logout': ok(null),
    });
    renderApp();
    await waitFor(() => expect(cache()?.theme).toBe('dark'));

    act(() => auth.signOut());
    await waitFor(() => expect(theme()).toBe('light'));
    expect(cache()).toBeNull();
  });
});
