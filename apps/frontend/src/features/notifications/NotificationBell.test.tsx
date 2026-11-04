import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fail, mockApi, ok, storeSession, testUser } from '../../test/mock-api';
import { renderApp } from '../../test/render';
import { createdSockets } from '../../test/fake-socket';
import {
  notificationItem,
  notificationPage,
  unavailableItem,
} from '../../test/notification-fixtures';
import { badgeText } from './NotificationBell';

const unreadList = 'GET /notifications?filter=unread&page=1&limit=5';
const base = {
  'GET /users/me': ok(testUser),
  'GET /users/me/preferences': ok({
    theme: 'light',
    timeZone: 'UTC',
    dateFormat: 'YYYY-MM-DD',
    weekStartsOn: 'monday',
  }),
};
const bell = (name: RegExp | string = /^Notifications,/) =>
  screen.findByRole('button', { name });

describe('badgeText', () => {
  it.each([
    [1, '1'],
    [99, '99'],
    [100, '99+'],
    [2500, '99+'],
  ])('%i → %s', (count, text) => expect(badgeText(count)).toBe(text));
});

describe('Notification bell', () => {
  it('shows the authoritative count, keeping the exact value in its name', async () => {
    storeSession();
    mockApi({
      ...base,
      'GET /notifications/unread-count': ok({ count: 120 }),
    });
    renderApp('/settings/preferences');
    const button = await bell('Notifications, 120 unread');
    expect(button.textContent).toContain('99+');
  });

  it('shows no badge at zero and an unavailable state on error', async () => {
    storeSession();
    mockApi({ ...base, 'GET /notifications/unread-count': ok({ count: 0 }) });
    renderApp('/settings/preferences');
    expect((await bell('Notifications, no unread')).textContent).toBe('');
  });

  it('reports a failed count without a fake number', async () => {
    storeSession();
    mockApi({
      ...base,
      'GET /notifications/unread-count': fail(500, 'INTERNAL'),
    });
    renderApp('/settings/preferences');
    expect(await bell('Notifications, unread count unavailable')).toBeTruthy();
  });

  it('opens a popover of unread items, closes on Escape and restores focus', async () => {
    storeSession();
    mockApi({
      ...base,
      'GET /notifications/unread-count': ok({ count: 2 }),
      [unreadList]: notificationPage([notificationItem(), unavailableItem()]),
    });
    renderApp('/settings/preferences');
    const button = await bell('Notifications, 2 unread');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const dialog = screen.getByRole('dialog', { name: 'Notifications' });
    const link = await within(dialog).findByRole('link', {
      name: /Assigned to a card/,
    });
    expect(link.getAttribute('href')).toBe(notificationItem().target!.path);
    // Unavailable history is listed but never linked.
    expect(
      within(dialog)
        .getByText('This notification is no longer available')
        .closest('a'),
    ).toBeNull();
    expect(
      within(dialog)
        .getByRole('link', { name: /View all notifications/ })
        .getAttribute('href'),
    ).toBe('/notifications');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('closes on an outside click', async () => {
    storeSession();
    mockApi({
      ...base,
      'GET /notifications/unread-count': ok({ count: 0 }),
      [unreadList]: notificationPage([]),
    });
    renderApp('/settings/preferences');
    fireEvent.click(await bell());
    expect(await screen.findByText(/all caught up/)).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
  });

  it('marks an item read on open and navigates to its server target', async () => {
    storeSession();
    const calls = mockApi({
      ...base,
      'GET /notifications/unread-count': ok({ count: 1 }),
      [unreadList]: notificationPage([notificationItem()]),
      [`PATCH /notifications/${notificationItem().id}/read`]: ok(
        notificationItem({ readAt: '2026-11-03T11:00:00.000Z' }),
      ),
      'GET /boards/10000000-0000-4000-8000-000000000004': fail(
        404,
        'NOT_FOUND',
      ),
    });
    const { router } = renderApp('/settings/preferences');
    fireEvent.click(await bell());
    fireEvent.click(
      await screen.findByRole('link', { name: /Assigned to a card/ }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        notificationItem().target!.path,
      ),
    );
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === 'PATCH' &&
            call.path === `/notifications/${notificationItem().id}/read`,
        ),
      ).toBe(true),
    );
  });

  it('marks all read through the API and refreshes the count', async () => {
    storeSession();
    let unread = 3;
    const calls = mockApi({
      ...base,
      'GET /notifications/unread-count': () => ok({ count: unread }),
      [unreadList]: () => notificationPage(unread ? [notificationItem()] : []),
      'POST /notifications/read-all': () => {
        unread = 0;
        return ok({ updatedCount: 3 });
      },
    });
    renderApp('/settings/preferences');
    fireEvent.click(await bell('Notifications, 3 unread'));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Mark all as read' }),
    );
    expect(await bell('Notifications, no unread')).toBeTruthy();
    expect(await screen.findByText(/all caught up/)).toBeTruthy();
    expect(
      calls.filter((call) => call.path === '/notifications/read-all'),
    ).toHaveLength(1);
  });

  it('does not pretend success when read-all fails', async () => {
    storeSession();
    mockApi({
      ...base,
      'GET /notifications/unread-count': ok({ count: 3 }),
      [unreadList]: notificationPage([notificationItem()]),
      'POST /notifications/read-all': fail(500, 'INTERNAL'),
    });
    renderApp('/settings/preferences');
    fireEvent.click(await bell('Notifications, 3 unread'));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Mark all as read' }),
    );
    expect(await screen.findByText('Could not mark all as read.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Notifications, 3 unread' }));
  });

  it('refetches count and items after notifications:changed, coalescing bursts', async () => {
    storeSession();
    let count = 0;
    const calls = mockApi({
      ...base,
      'GET /notifications/unread-count': () => ok({ count }),
    });
    renderApp('/settings/preferences');
    await bell('Notifications, no unread');
    await waitFor(() => expect(createdSockets.length).toBeGreaterThan(0));
    const before = calls.filter(
      (call) => call.path === '/notifications/unread-count',
    ).length;
    count = 4;
    act(() => {
      for (let i = 0; i < 10; i++)
        createdSockets.at(-1)!.socket.push('notifications:changed', {
          summary: 'forged',
        });
    });
    expect(await bell('Notifications, 4 unread')).toBeTruthy();
    expect(
      calls.filter((call) => call.path === '/notifications/unread-count')
        .length - before,
    ).toBe(1);
    expect(screen.queryByText('forged')).toBeNull();
  });

  it('gives way to the global search palette (P4-08) and keeps its header slot', async () => {
    storeSession();
    mockApi({
      ...base,
      'GET /notifications/unread-count': ok({ count: 1 }),
      [unreadList]: notificationPage([notificationItem()]),
    });
    renderApp('/settings/preferences');
    const button = await bell('Notifications, 1 unread');
    // Search trigger, then bell, then the avatar: the header order is unchanged.
    const header = button.closest('header')!;
    const controls = within(header).getAllByRole('button');
    expect(
      controls.indexOf(screen.getByRole('button', { name: 'Search' })),
    ).toBeLessThan(controls.indexOf(button));
    fireEvent.click(button);
    await screen.findByRole('dialog', { name: 'Notifications' });
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(
      await screen.findByRole('combobox', {
        name: 'Search workspaces, boards and cards',
      }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Notifications' }),
      ).toBeNull(),
    );
  });
});
