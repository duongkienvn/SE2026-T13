import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { ExecutionContext } from '@nestjs/common';
import { NotificationPreferencesBodyGuard } from '../../src/api/notifications/notification-preferences-body.guard';
import { ListNotificationsDto } from '../../src/api/notifications/dto/list-notifications.dto';
import { UpdateNotificationPreferencesDto } from '../../src/api/notifications/dto/notification-preferences.dto';
import { NotificationResponseDto } from '../../src/api/notifications/dto/notification-response.dto';
import { toResponseDto } from '../../src/common/dto/to-response-dto';
import { toNotificationPreferences } from '../../src/api/notifications/notification-preferences';
import {
  notificationOccurrence,
  notificationScope,
} from '../../src/api/notifications/notification-record';

const guard = new NotificationPreferencesBodyGuard();
const raw = (body: unknown) =>
  guard.canActivate({
    switchToHttp: () => ({ getRequest: () => ({ body }) }),
  } as unknown as ExecutionContext);
describe('notification contracts and preference validation', () => {
  it('defaults to all/20 and returns new default values without metadata', () => {
    expect(plainToInstance(ListNotificationsDto, {})).toMatchObject({
      page: 1,
      limit: 20,
      filter: 'all',
    });
    expect(toNotificationPreferences()).toEqual({
      inApp: {
        cardAssigned: true,
        commentMentioned: true,
        workspaceInvited: true,
        boardInvited: true,
        membershipChanged: true,
        dueReminder: true,
      },
      email: {
        cardAssigned: false,
        commentMentioned: false,
        dueReminder: false,
      },
    });
  });
  it.each([
    {},
    null,
    [],
    true,
    'text',
    { inApp: {} },
    { email: {} },
    { inApp: null },
    { email: [] },
    { inApp: { cardAssigned: 'false' } },
    { email: { dueReminder: 0 } },
    { inApp: { cardAssigned: null } },
    { email: { workspaceInvited: true } },
    { email: { security: false } },
    { userId: 'other', inApp: { cardAssigned: false } },
    JSON.parse('{"inApp":{"__proto__":true}}'),
    JSON.parse('{"constructor":{},"inApp":{"cardAssigned":true}}'),
  ])('rejects invalid raw preference body %j', (body) =>
    expect(() => raw(body)).toThrow(),
  );
  it.each([
    { inApp: { cardAssigned: false } },
    { email: { commentMentioned: true, dueReminder: false } },
    { inApp: {}, email: { dueReminder: true } },
    {
      inApp: {
        workspaceInvited: false,
        boardInvited: false,
        membershipChanged: false,
      },
      email: { cardAssigned: true },
    },
  ])('accepts and validates partial boolean leaves %j', async (body) => {
    expect(raw(body)).toBe(true);
    expect(
      await validate(plainToInstance(UpdateNotificationPreferencesDto, body), {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    ).toEqual([]);
  });
  it.each([
    { filter: 'read' },
    { page: '0' },
    { limit: '101' },
    { page: '1.1' },
    { filter: ['all'] },
    { userId: 'other' },
  ])('rejects malformed inbox query %j', async (query) => {
    expect(
      (
        await validate(plainToInstance(ListNotificationsDto, query), {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).length,
    ).toBeGreaterThan(0);
  });
  it('retains source scope and colon-containing occurrence identity', () => {
    const row = {
      dedupeKey: 'DUE_REMINDER:card:card-id:2026-11-03T08:00:00Z:morning',
    };
    expect(notificationScope(row)).toBe('card');
    expect(notificationOccurrence(row)).toBe(
      'card-id:2026-11-03T08:00:00Z:morning',
    );
    expect(
      notificationScope({ dedupeKey: 'MEMBERSHIP_CHANGED:unknown:id' }),
    ).toBeNull();
  });
  it('allowlists nested context, actor and target without recipient or dedupe keys', () => {
    const value = toResponseDto(NotificationResponseDto, {
      id: 'id',
      kind: 'CARD_ASSIGNED',
      recipientUserId: 'private',
      dedupeKey: 'private-key',
      actor: { id: 'actor', displayName: 'Name', email: 'private-email' },
      context: {
        workspaceId: null,
        boardId: 'b',
        cardId: 'c',
        proof: 'secret',
      },
      target: {
        kind: 'card',
        path: '/boards/b/cards/c',
        external: 'https://evil.test',
      },
      summary: 'Current title',
      createdAt: 'now',
      readAt: null,
      isUnavailable: false,
    });
    const json = JSON.stringify(value);
    for (const key of [
      'recipientUserId',
      'dedupeKey',
      'private-email',
      'proof',
      'external',
    ])
      expect(json).not.toContain(key);
    expect(value.actor).toEqual({ id: 'actor', displayName: 'Name' });
  });
});
