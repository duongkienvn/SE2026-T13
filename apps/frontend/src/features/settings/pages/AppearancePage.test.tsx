import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockResponse,
} from '../../../test/mock-api';
import { renderApp } from '../../../test/render';
import { stubColorScheme } from '../../../test/theme-fixtures';
import type { ThemePreference, UserPreferences } from '../types';

const PATH = '/users/me/preferences';
const prefs = (theme: ThemePreference): UserPreferences => ({
  theme,
  timeZone: 'UTC',
  dateFormat: 'YYYY-MM-DD',
  weekStartsOn: 'monday',
});

const radio = (name: string) =>
  screen.getByRole('radio', { name }) as HTMLInputElement;
const appliedTheme = () => document.documentElement.dataset.theme;

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

function setup(patch: () => MockResponse | Promise<MockResponse>) {
  storeSession();
  return mockApi({
    'GET /users/me': ok(testUser),
    [`GET ${PATH}`]: ok(prefs('light')),
    [`PATCH ${PATH}`]: patch,
  });
}

describe('AppearancePage', () => {
  it('applies a new theme at once and says Saved only after the server confirms', async () => {
    stubColorScheme(false);
    let release!: (response: MockResponse) => void;
    const calls = setup(
      () => new Promise<MockResponse>((resolve) => (release = resolve)),
    );
    renderApp('/settings/appearance');
    await waitFor(() => expect(radio('Light').checked).toBe(true));

    fireEvent.click(radio('Dark'));
    await waitFor(() => expect(appliedTheme()).toBe('dark'));
    expect(radio('Dark').checked).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Saving…');
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      theme: 'dark',
    });

    await act(async () => release(ok(prefs('dark'))));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Saved'),
    );
  });

  it('puts the previous theme back when the save fails', async () => {
    stubColorScheme(false);
    setup(() => fail(503, 'SERVICE_UNAVAILABLE'));
    renderApp('/settings/appearance');
    await waitFor(() => expect(radio('Light').checked).toBe(true));

    fireEvent.click(radio('Dark'));
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /could not save your theme/i,
    );
    expect(radio('Light').checked).toBe(true);
    expect(appliedTheme()).toBe('light');
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('explains Match System with the current device theme', async () => {
    stubColorScheme(true);
    setup(() => ok(prefs('system')));
    renderApp('/settings/appearance');
    fireEvent.click(await screen.findByRole('radio', { name: 'Match System' }));
    expect(
      (await screen.findByText(/following your device/i)).textContent,
    ).toContain('dark');
    expect(appliedTheme()).toBe('dark');
  });

  it('offers a retry when preferences cannot be loaded', async () => {
    stubColorScheme(false);
    storeSession();
    let attempts = 0;
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET ${PATH}`]: () => {
        attempts += 1;
        return attempts === 1 ? fail(404, 'NOT_FOUND') : ok(prefs('dark'));
      },
    });
    renderApp('/settings/appearance');
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(radio('Dark').checked).toBe(true));
  });
});
