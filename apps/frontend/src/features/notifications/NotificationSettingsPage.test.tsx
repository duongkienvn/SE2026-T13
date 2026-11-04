import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fail, mockApi, ok, storeSession, testUser } from '../../test/mock-api';
import { renderApp } from '../../test/render';
import { defaultNotificationPreferences as defaults } from '../../test/notification-fixtures';
import { env } from '../../lib/env';

const base = {
  'GET /users/me': ok(testUser),
  'GET /users/me/notification-preferences': ok(defaults),
};
/** Switches by id: in-app and email rows share labels. */
const toggle = async (id: string) => {
  await screen.findAllByRole('switch');
  return document.getElementById(id) as HTMLInputElement;
};

afterEach(() => {
  (env as { taskEmailEnabled: boolean }).taskEmailEnabled = false;
});

describe('Settings > Notifications', () => {
  it('shows all six in-app defaults on, Board invitations as not sent, and no security switch', async () => {
    storeSession();
    mockApi(base);
    renderApp('/settings/notifications');
    for (const name of [
      'Card assignments',
      'Mentions',
      'Due date reminders',
      'Workspace invitations',
      'Membership changes',
      'Board invitations',
    ]) {
      const [inApp] = await screen.findAllByRole('switch', {
        name: new RegExp(`^${name}`),
      });
      expect((inApp as HTMLInputElement).checked).toBe(true);
    }
    expect(screen.getByText(/Not sent yet/)).toBeTruthy();
    expect(screen.getByText('Security and account')).toBeTruthy();
    expect(screen.queryByRole('switch', { name: /Security/ })).toBeNull();
  });

  it('keeps task email unavailable unless the deployment turns it on', async () => {
    storeSession();
    mockApi(base);
    renderApp('/settings/notifications');
    await screen.findByText(/not turned on for this Kanvexa server/);
    const emailSwitches = (await screen.findAllByRole('switch')).filter(
      (item) => item.id.startsWith('email-'),
    );
    expect(emailSwitches).toHaveLength(3);
    // A disabled fieldset disables its inputs without setting `.disabled`.
    for (const item of emailSwitches)
      expect(item.matches(':disabled')).toBe(true);
    expect((await toggle('in-app-cardAssigned')).matches(':disabled')).toBe(
      false,
    );
  });

  it('PATCHes only the changed leaves and reconciles from the server result', async () => {
    (env as { taskEmailEnabled: boolean }).taskEmailEnabled = true;
    storeSession();
    const saved = {
      inApp: { ...defaults.inApp, dueReminder: false },
      email: { ...defaults.email, dueReminder: true },
    };
    const calls = mockApi({
      ...base,
      'PATCH /users/me/notification-preferences': ok(saved),
    });
    renderApp('/settings/notifications');
    const save = await screen.findByRole('button', { name: 'Save changes' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(await toggle('in-app-dueReminder'));
    fireEvent.click(await toggle('email-dueReminder'));
    fireEvent.click(save);
    expect(
      await screen.findByText('Notification preferences saved.'),
    ).toBeTruthy();
    const patch = calls.find((call) => call.method === 'PATCH');
    expect(patch?.body).toEqual({
      inApp: { dueReminder: false },
      email: { dueReminder: true },
    });
    expect((await toggle('in-app-dueReminder')).checked).toBe(false);
    expect((await toggle('email-dueReminder')).checked).toBe(true);
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });

  it('Cancel restores the saved values without a request', async () => {
    storeSession();
    const calls = mockApi(base);
    renderApp('/settings/notifications');
    const mentions = await toggle('in-app-commentMentioned');
    fireEvent.click(mentions);
    expect(mentions.checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mentions.checked).toBe(true);
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('keeps the draft and reports a failed save', async () => {
    storeSession();
    mockApi({
      ...base,
      'PATCH /users/me/notification-preferences': fail(500, 'INTERNAL'),
    });
    renderApp('/settings/notifications');
    const mentions = await toggle('in-app-commentMentioned');
    fireEvent.click(mentions);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText(/Could not save your preferences/),
    ).toBeTruthy();
    expect(mentions.checked).toBe(false);
  });

  it('offers Retry when preferences cannot load', async () => {
    storeSession();
    let attempt = 0;
    mockApi({
      ...base,
      'GET /users/me/notification-preferences': () =>
        ++attempt === 1 ? fail(500, 'INTERNAL') : ok(defaults),
    });
    renderApp('/settings/notifications');
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getAllByRole('switch').length).toBe(9));
  });
});
