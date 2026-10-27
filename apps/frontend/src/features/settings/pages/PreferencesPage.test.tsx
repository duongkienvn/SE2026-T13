import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
import type { UserPreferences } from '../types';

const PATH = '/users/me/preferences';
const saved: UserPreferences = {
  theme: 'dark',
  timeZone: 'UTC',
  dateFormat: 'YYYY-MM-DD',
  weekStartsOn: 'monday',
};

function setup(patch: (request: MockRequest) => MockResponse) {
  storeSession();
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    'GET /auth/linked-providers': ok({
      googleLinked: false,
      hasPassword: true,
    }),
    [`GET ${PATH}`]: ok(saved),
    [`PATCH ${PATH}`]: patch,
  });
  const view = renderApp('/settings/preferences');
  return { calls, ...view };
}

const timeZone = () => screen.getByLabelText('Time zone') as HTMLSelectElement;
const radio = (name: RegExp | string) =>
  screen.getByRole('radio', { name }) as HTMLInputElement;
const save = () => screen.getByRole('button', { name: 'Save changes' });
const patches = (calls: MockRequest[]) =>
  calls.filter((call) => call.method === 'PATCH');

describe('PreferencesPage', () => {
  it('shows saved values and sends only the fields that changed', async () => {
    const { calls } = setup((request) =>
      ok({ ...saved, ...(request.body as object) }),
    );
    await waitFor(() => expect(timeZone().value).toBe('UTC'));
    expect(radio('Monday').checked).toBe(true);
    expect(radio(/YYYY-MM-DD/).checked).toBe(true);
    expect((save() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(radio(/DD\/MM\/YYYY/));
    fireEvent.change(timeZone(), { target: { value: 'Asia/Ho_Chi_Minh' } });
    fireEvent.click(save());

    await screen.findByText('Preferences saved.');
    expect(patches(calls).map((call) => call.body)).toEqual([
      { timeZone: 'Asia/Ho_Chi_Minh', dateFormat: 'DD/MM/YYYY' },
    ]);
    expect((save() as HTMLButtonElement).disabled).toBe(true);
  });

  it('lists UTC and Asia/Ho_Chi_Minh among the time zones', async () => {
    setup(() => ok(saved));
    await waitFor(() => expect(timeZone().value).toBe('UTC'));
    const values = [...timeZone().options].map((option) => option.value);
    expect(values).toContain('UTC');
    expect(values).toContain('Asia/Ho_Chi_Minh');
  });

  it('shows a server validation error on the field and keeps the edit', async () => {
    const { calls } = setup(() =>
      fail(400, 'VALIDATION_FAILED', 'Validation failed', [
        'timeZone: timeZone must be a valid IANA time zone',
      ]),
    );
    await waitFor(() => expect(timeZone().value).toBe('UTC'));
    fireEvent.change(timeZone(), { target: { value: 'Asia/Tokyo' } });
    fireEvent.click(save());

    expect(
      await screen.findByText('Time zone must be a valid IANA time zone'),
    ).toBeTruthy();
    expect(timeZone().value).toBe('Asia/Tokyo');
    expect(timeZone().getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByText('Preferences saved.')).toBeNull();
    expect(patches(calls)).toHaveLength(1);
  });

  it('keeps the edit and explains a failed save', async () => {
    setup(() => fail(503, 'SERVICE_UNAVAILABLE', 'Down'));
    await waitFor(() => expect(timeZone().value).toBe('UTC'));
    fireEvent.click(radio('Sunday'));
    fireEvent.click(save());
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(radio('Sunday').checked).toBe(true);
    expect((save() as HTMLButtonElement).disabled).toBe(false);
  });

  it('Cancel restores the saved values', async () => {
    const { calls } = setup(() => ok(saved));
    await waitFor(() => expect(timeZone().value).toBe('UTC'));
    fireEvent.click(radio('Sunday'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(radio('Monday').checked).toBe(true);
    expect(patches(calls)).toHaveLength(0);
  });

  it('asks before leaving with unsaved changes', async () => {
    const { router } = setup(() => ok(saved));
    await waitFor(() => expect(timeZone().value).toBe('UTC'));
    fireEvent.click(radio('Sunday'));
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Settings' })).getByRole(
        'link',
        { name: 'Security' },
      ),
    );
    expect(
      await screen.findByRole('dialog', { name: 'Discard unsaved changes?' }),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe('/settings/preferences');
  });

  it('previews today in the chosen zone and format', async () => {
    setup(() => ok(saved));
    await waitFor(() => expect(timeZone().value).toBe('UTC'));
    fireEvent.click(radio(/DD\/MM\/YYYY/));
    const preview = screen.getByText('Preview').parentElement;
    expect(preview?.textContent).toMatch(/Today is \d{2}\/\d{2}\/\d{4} in UTC/);
    expect(preview?.textContent).toContain('Weeks start on Monday');
  });
});
