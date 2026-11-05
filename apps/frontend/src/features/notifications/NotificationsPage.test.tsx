import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { NotificationResponse } from '@kanban/shared';
import { mockApi, ok, storeSession, testUser } from '../../test/mock-api';
import { renderApp } from '../../test/render';
import { createdSockets } from '../../test/fake-socket';
import {
  notificationItem,
  notificationPage,
  unavailableItem,
} from '../../test/notification-fixtures';
import { groupByDay, parseInboxSearch } from './NotificationsPage';

const base = {
  'GET /users/me': ok(testUser),
  'GET /notifications/unread-count': ok({ count: 2 }),
};
const item = (n: number, extra: Partial<NotificationResponse> = {}) =>
  notificationItem({
    id: `10000000-0000-4000-8000-00000000010${n}`,
    summary: `Summary ${n}`,
    ...extra,
  });

describe('inbox helpers', () => {
  it('parses filter/page from the URL with safe defaults', () => {
    expect(
      parseInboxSearch(new URLSearchParams('filter=unread&page=3')),
    ).toEqual({ filter: 'unread', page: 3 });
    for (const search of ['filter=x&page=0', 'page=-2', 'page=1e3', 'page=abc'])
      expect(parseInboxSearch(new URLSearchParams(search))).toEqual({
        filter: search.startsWith('filter=x') ? 'all' : 'all',
        page: 1,
      });
  });

  it('labels days in the saved time zone and keeps server order', () => {
    const now = new Date('2026-11-04T02:00:00.000Z');
    const groups = groupByDay(
      [
        item(1, { createdAt: '2026-11-04T01:00:00.000Z' }),
        item(2, { createdAt: '2026-11-03T17:30:00.000Z' }),
        item(3, { createdAt: '2026-11-03T10:00:00.000Z' }),
        item(4, { createdAt: '2026-10-30T10:00:00.000Z' }),
      ],
      { timeZone: 'Asia/Ho_Chi_Minh', dateFormat: 'DD/MM/YYYY' },
      now,
    );
    // 17:30Z on Nov 3 is already 00:30 on Nov 4 in UTC+7.
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([
      ['Today', 2],
      ['Yesterday', 1],
      ['30/10/2026', 1],
    ]);
  });
});

describe('Notifications page', () => {
  it('keeps header actions usable and marks all read with pending and disabled states', async () => {
    storeSession();
    let unread = 2;
    let finish!: () => void;
    const pending = new Promise<ReturnType<typeof ok>>((resolve) => {
      finish = () => {
        unread = 0;
        resolve(ok({ updatedCount: 2 }));
      };
    });
    mockApi({
      ...base,
      'GET /notifications/unread-count': () => ok({ count: unread }),
      'GET /notifications?filter=all&page=1&limit=5': () =>
        notificationPage(
          [item(1, { readAt: unread ? null : '2026-11-05T10:00:00Z' })],
          { limit: 5 },
        ),
      'POST /notifications/read-all': () => pending,
    });
    renderApp('/notifications');
    await screen.findByText('Summary 1');
    const header = screen
      .getByRole('heading', { name: 'Notifications' })
      .closest('header')!;
    expect(
      within(header)
        .getByRole('link', { name: 'Preferences' })
        .getAttribute('href'),
    ).toBe('/settings/notifications');
    const markAll = within(header).getByRole('button', {
      name: 'Mark all as read',
    });
    await waitFor(() => expect(markAll).toHaveProperty('disabled', false));
    fireEvent.click(markAll);
    expect(
      await within(header).findByRole('button', { name: 'Marking…' }),
    ).toHaveProperty('disabled', true);
    await act(async () => finish());
    await screen.findByText('Marked 2 notifications as read.');
    await screen.findByRole('link', { name: 'Unread (0)' });
    expect(
      within(header).getByRole('button', { name: 'Mark all as read' }),
    ).toHaveProperty('disabled', true);
  });

  it('renders the server page with All / Unread tabs and pagination in the URL', async () => {
    storeSession();
    const calls = mockApi({
      ...base,
      'GET /notifications?filter=all&page=1&limit=5': notificationPage(
        [item(1), item(2, { readAt: '2026-11-03T11:00:00.000Z' })],
        { limit: 5, total: 8 },
      ),
      'GET /notifications?filter=all&page=2&limit=5': notificationPage(
        [item(7)],
        { page: 2, limit: 5, total: 8 },
      ),
      'GET /notifications?filter=unread&page=1&limit=5': notificationPage(
        [item(1)],
        { limit: 5, total: 1 },
      ),
    });
    const { router } = renderApp('/notifications');
    expect(
      await screen.findByRole('heading', { name: 'Notifications', level: 1 }),
    ).toBeTruthy();
    expect(await screen.findByText('Summary 1')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Unread (2)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    expect(await screen.findByText('Summary 7')).toBeTruthy();
    expect(router.state.location.search).toBe('?page=2');
    fireEvent.click(screen.getByRole('link', { name: 'Unread (2)' }));
    await waitFor(() =>
      expect(router.state.location.search).toBe('?filter=unread'),
    );
    expect(await screen.findByText('Summary 1')).toBeTruthy();
    await act(() => router.navigate(-1));
    expect(await screen.findByText('Summary 7')).toBeTruthy();
    expect(calls.some((call) => call.path.includes('limit=5'))).toBe(true);
  });

  it('keeps unavailable history unlinked and lets it be marked read', async () => {
    storeSession();
    let stub = unavailableItem();
    const calls = mockApi({
      ...base,
      'GET /notifications?filter=all&page=1&limit=5': () =>
        notificationPage([stub], { limit: 5 }),
      [`PATCH /notifications/${stub.id}/read`]: () => {
        stub = { ...stub, readAt: '2026-11-03T12:00:00.000Z' };
        return ok(stub);
      },
    });
    renderApp('/notifications');
    const text = await screen.findByText(
      'This notification is no longer available',
    );
    expect(text.closest('a')).toBeNull();
    expect(screen.queryByText('Linh')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: /Mark as read: No longer available/ }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Mark as read/ })).toBeNull(),
    );
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
  });

  it('shows an informational item without a link when the target is null', async () => {
    storeSession();
    mockApi({
      ...base,
      'GET /notifications?filter=all&page=1&limit=5': notificationPage(
        [item(1, { kind: 'WORKSPACE_INVITED', target: null })],
        { limit: 5 },
      ),
    });
    renderApp('/notifications');
    const row = await screen.findByText('Summary 1');
    expect(row.closest('a')).toBeNull();
    expect(screen.getByText('Workspace invitation')).toBeTruthy();
  });

  it('never renders summary text as HTML', async () => {
    storeSession();
    mockApi({
      ...base,
      'GET /notifications?filter=all&page=1&limit=5': notificationPage(
        [item(1, { summary: '<img src=x onerror=alert(1)>Hi' })],
        { limit: 5 },
      ),
    });
    renderApp('/notifications');
    expect(
      await screen.findByText('<img src=x onerror=alert(1)>Hi'),
    ).toBeTruthy();
    expect(document.querySelector('.notifications-page img')).toBeNull();
  });

  it('shows empty states for All and Unread', async () => {
    storeSession();
    mockApi({
      ...base,
      'GET /notifications/unread-count': ok({ count: 0 }),
      'GET /notifications?filter=unread&page=1&limit=5': notificationPage([], {
        limit: 5,
      }),
    });
    renderApp('/notifications?filter=unread');
    expect(await screen.findByText('No unread notifications')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Mark all as read' }),
    ).toHaveProperty('disabled', true);
  });

  it('steps back when the current page no longer exists', async () => {
    storeSession();
    mockApi({
      ...base,
      'GET /notifications?filter=all&page=4&limit=5': notificationPage([], {
        page: 4,
        limit: 5,
        total: 7,
      }),
      'GET /notifications?filter=all&page=2&limit=5': notificationPage(
        [item(7)],
        { page: 2, limit: 5, total: 7 },
      ),
    });
    const { router } = renderApp('/notifications?page=4');
    expect(await screen.findByText('Summary 7')).toBeTruthy();
    expect(router.state.location.search).toBe('?page=2');
  });

  it('drops rendered summaries when Board access is revoked, then re-resolves them', async () => {
    storeSession();
    let revoked = false;
    mockApi({
      ...base,
      'GET /notifications?filter=all&page=1&limit=5': () =>
        notificationPage([revoked ? unavailableItem() : item(1)], {
          limit: 5,
        }),
    });
    renderApp('/notifications');
    await screen.findByText('Summary 1');
    await waitFor(() => expect(createdSockets.length).toBeGreaterThan(0));
    revoked = true;
    act(() =>
      createdSockets.at(-1)!.socket.push('board:access-revoked', {
        boardId: notificationItem().context!.boardId,
      }),
    );
    await waitFor(() => expect(screen.queryByText('Summary 1')).toBeNull());
    const list = await screen.findByText(
      'This notification is no longer available',
    );
    expect(within(list.closest('li')!).queryByRole('link')).toBeNull();
  });

  it.each(['board', 'workspace'] as const)(
    'does not restore protected details when mark-read finishes after %s access revocation',
    async (resource) => {
      storeSession();
      const original = item(1);
      const stub = unavailableItem({ id: original.id });
      const readAt = '2026-11-05T00:00:00.000Z';
      let finishRead!: () => void;
      const pendingRead = new Promise<ReturnType<typeof ok>>((resolve) => {
        finishRead = () => resolve(ok({ ...original, readAt }));
      });
      let revoked = false;
      let readFinished = false;
      let finishRefresh!: () => void;
      const pendingRefresh = new Promise<ReturnType<typeof notificationPage>>(
        (resolve) => {
          finishRefresh = () =>
            resolve(notificationPage([{ ...stub, readAt }], { limit: 5 }));
        },
      );
      const calls = mockApi({
        ...base,
        'GET /notifications?filter=all&page=1&limit=5': () =>
          readFinished
            ? pendingRefresh
            : notificationPage([revoked ? stub : original], { limit: 5 }),
        [`PATCH /notifications/${original.id}/read`]: () => pendingRead,
      });
      renderApp('/notifications');
      await screen.findByText(original.summary);
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Mark as read: Assigned to a card',
        }),
      );
      await waitFor(() =>
        expect(calls.some((call) => call.method === 'PATCH')).toBe(true),
      );
      await waitFor(() => expect(createdSockets.length).toBeGreaterThan(0));
      revoked = true;
      act(() =>
        createdSockets
          .at(-1)!
          .socket.push(
            resource === 'board'
              ? 'board:access-revoked'
              : 'workspace:access-revoked',
            resource === 'board'
              ? { boardId: original.context!.boardId }
              : { workspaceId: original.context!.workspaceId },
          ),
      );
      await screen.findByText(stub.summary);

      readFinished = true;
      await act(async () => finishRead());
      await waitFor(() =>
        expect(
          calls.filter((call) => call.path.startsWith('/notifications?')),
        ).toHaveLength(3),
      );
      // Keep the next list request pending so it cannot hide a stale mutation write.
      expect(screen.getByText(stub.summary)).toBeTruthy();
      expect(screen.queryByText(original.summary)).toBeNull();
      expect(screen.queryByText(original.actor!.displayName)).toBeNull();
      const row = screen.getByText(stub.summary).closest('li')!;
      expect(within(row).queryByRole('link')).toBeNull();
      expect(
        within(row).queryByRole('button', { name: /Mark as read/ }),
      ).toBeNull();
      await act(async () => finishRefresh());
    },
  );
});
