import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationPreferences } from '@kanban/shared';
import {
  listNotifications,
  markAllNotificationsRead,
  parseNotification,
  parsePreferences,
  preferencesPatch,
  readUnreadCount,
} from './api';
import { notificationItem } from '../../test/notification-fixtures';

afterEach(() => vi.unstubAllGlobals());

const envelope = (data: unknown, extra: object = {}) =>
  new Response(
    JSON.stringify({
      success: true,
      statusCode: 200,
      message: 'OK',
      data,
      ...extra,
    }),
  );

const defaults: NotificationPreferences = {
  inApp: {
    cardAssigned: true,
    commentMentioned: true,
    workspaceInvited: true,
    boardInvited: true,
    membershipChanged: true,
    dueReminder: true,
  },
  email: { cardAssigned: false, commentMentioned: false, dueReminder: false },
};

describe('notification API', () => {
  it('lists a server page with filter, page and limit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      envelope([notificationItem()], {
        meta: { page: 2, limit: 5, total: 6, totalPages: 2 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const page = await listNotifications('token', {
      filter: 'unread',
      page: 2,
      limit: 5,
    });
    expect(fetchMock.mock.calls[0][0]).toMatch(
      /\/notifications\?filter=unread&page=2&limit=5$/,
    );
    expect(page.meta.total).toBe(6);
    expect(page.items[0].summary).toBe(notificationItem().summary);
  });

  it('reads the authoritative unread count and the read-all result', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(envelope({ count: 120 }))
        .mockResolvedValueOnce(envelope({ updatedCount: 3 }))
        .mockResolvedValueOnce(envelope({ count: -1 })),
    );
    await expect(readUnreadCount('token')).resolves.toBe(120);
    await expect(markAllNotificationsRead('token')).resolves.toBe(3);
    await expect(readUnreadCount('token')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('strips everything protected from an unavailable stub', () => {
    const item = parseNotification(notificationItem({ isUnavailable: true }));
    expect(item).toMatchObject({ actor: null, context: null, target: null });
  });

  it('drops a target that is not an internal route', () => {
    for (const path of ['https://evil.test', '//evil.test/x', 'boards/1'])
      expect(
        parseNotification(notificationItem({ target: { kind: 'card', path } }))
          .target,
      ).toBeNull();
  });

  it('rejects an unknown kind', () => {
    expect(() =>
      parseNotification(notificationItem({ kind: 'CHAT' as never })),
    ).toThrow(expect.objectContaining({ code: 'INVALID_RESPONSE' }));
  });

  it('keeps only the recognized preference leaves', () => {
    expect(
      parsePreferences({
        ...defaults,
        email: { ...defaults.email, security: true },
      }).email,
    ).toEqual(defaults.email);
    expect(() =>
      parsePreferences({ inApp: defaults.inApp, email: {} }),
    ).toThrow();
  });

  it('builds a patch of only the changed boolean leaves', () => {
    expect(preferencesPatch(defaults, defaults)).toEqual({});
    expect(
      preferencesPatch(defaults, {
        inApp: { ...defaults.inApp, dueReminder: false },
        email: { ...defaults.email, dueReminder: true },
      }),
    ).toEqual({ inApp: { dueReminder: false }, email: { dueReminder: true } });
  });
});
