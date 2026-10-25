import { ActivityActionType } from '@kanban/shared';
import { describe, expect, it } from 'vitest';
import { makeActivity, makeMember } from '../../test/board-fixtures';
import { testUser } from '../../test/mock-api';
import {
  describeActivity,
  resolveActor,
  validTimestamp,
} from './format-activity';
import type { Activity } from './types';

const COLUMN_A = '00000000-0000-4000-9000-00000000000a';
const COLUMN_B = '00000000-0000-4000-9000-00000000000b';

describe('describeActivity', () => {
  it.each([
    ['BOARD_UPDATED', 'updated the board'],
    ['BOARD_ARCHIVED', 'archived the board'],
    ['BOARD_RESTORED', 'restored the board'],
    ['MEMBER_ADDED', 'added a board member'],
    ['MEMBER_REMOVED', 'removed a board member'],
    ['ROLE_CHANGED', "changed a member's role"],
    ['COLUMN_CREATED', 'created a column'],
    ['COLUMN_UPDATED', 'updated a column'],
    ['COLUMN_MOVED', 'reordered a column'],
    ['COLUMN_DELETED', 'deleted a column'],
    ['CARD_CREATED', 'created a card'],
    ['CARD_UPDATED', 'updated a card'],
    ['CARD_MOVED', 'moved a card'],
    ['CARD_ARCHIVED', 'archived a card'],
    ['CARD_RESTORED', 'restored a card'],
    ['COMMENT_CREATED', 'added a comment'],
    ['COMMENT_UPDATED', 'edited a comment'],
    ['COMMENT_DELETED', 'deleted a comment'],
  ] as const)('labels %s as "%s"', (actionType, action) => {
    expect(describeActivity(makeActivity({ actionType }))).toEqual({
      action,
    });
  });

  it('covers every shared action type', () => {
    for (const actionType of Object.values(ActivityActionType)) {
      expect(describeActivity(makeActivity({ actionType })).action).not.toBe(
        'made a change',
      );
    }
  });

  it.each(['CARD_ASSIGNED', 'toString', '__proto__', 'constructor', ''])(
    'falls back for unknown action %j',
    (actionType) => {
      expect(
        describeActivity(
          makeActivity({ actionType: actionType as Activity['actionType'] }),
        ),
      ).toEqual({ action: 'made a change' });
    },
  );

  it('says "reordered" for a move within one column', () => {
    const activity = makeActivity({
      actionType: 'CARD_MOVED',
      metadata: { fromColumnId: COLUMN_A, toColumnId: COLUMN_A },
    });
    expect(describeActivity(activity)).toEqual({ action: 'reordered a card' });
  });

  it('says "moved" across columns, without echoing column ids', () => {
    const description = describeActivity(
      makeActivity({
        actionType: 'CARD_MOVED',
        metadata: { fromColumnId: COLUMN_A, toColumnId: COLUMN_B },
      }),
    );
    expect(description).toEqual({ action: 'moved a card' });
    expect(JSON.stringify(description)).not.toContain(COLUMN_A);
  });

  it.each([
    null,
    {},
    { fromColumnId: COLUMN_A },
    { fromColumnId: 1, toColumnId: 1 },
  ])('says "moved" when move metadata is incomplete: %j', (metadata) => {
    expect(
      describeActivity(makeActivity({ actionType: 'CARD_MOVED', metadata })),
    ).toEqual({ action: 'moved a card' });
  });

  it.each([
    ['MEMBER', 'OWNER', 'Member → Owner'],
    ['OWNER', 'MEMBER', 'Owner → Member'],
  ])('shows a role change %s → %s', (fromRole, toRole, detail) => {
    expect(
      describeActivity(
        makeActivity({
          actionType: 'ROLE_CHANGED',
          metadata: { fromRole, toRole },
        }),
      ),
    ).toEqual({ action: "changed a member's role", detail });
  });

  it.each([
    null,
    {},
    { fromRole: 'MEMBER' },
    { fromRole: 'VIEWER', toRole: 'OWNER' },
    { fromRole: '<img src=x onerror=alert(1)>', toRole: 'OWNER' },
    { fromRole: { toString: (): string => 'OWNER' }, toRole: 'MEMBER' },
    { fromRole: '__proto__', toRole: 'MEMBER' },
  ])('omits role detail for invalid metadata %j', (metadata) => {
    expect(
      describeActivity(
        makeActivity({
          actionType: 'ROLE_CHANGED',
          metadata: metadata as Activity['metadata'],
        }),
      ),
    ).toEqual({ action: "changed a member's role", detail: undefined });
  });

  it('ignores metadata on actions that have no detail', () => {
    expect(
      describeActivity(
        makeActivity({
          actionType: 'MEMBER_REMOVED',
          metadata: { targetUserId: 'secret-user-id' },
        }),
      ),
    ).toEqual({ action: 'removed a board member' });
  });

  it('tolerates non-object metadata', () => {
    for (const metadata of ['text', 42, ['OWNER', 'MEMBER']]) {
      expect(
        describeActivity(
          makeActivity({
            actionType: 'ROLE_CHANGED',
            metadata: metadata as unknown as Activity['metadata'],
          }),
        ).detail,
      ).toBeUndefined();
    }
  });
});

describe('resolveActor', () => {
  const grace = makeMember({
    id: 'membership-grace',
    role: 'MEMBER',
    user: {
      id: 'user-grace',
      email: 'grace@example.com',
      displayName: 'Grace Hopper',
      avatarUrl: null,
    },
  });

  it('calls the signed-in user "You"', () => {
    expect(resolveActor(testUser.id, [makeMember()], testUser)).toEqual({
      name: 'You',
      user: testUser,
    });
  });

  it('names a current member by their user id', () => {
    expect(resolveActor('user-grace', [grace], testUser)).toEqual({
      name: 'Grace Hopper',
      user: grace.user,
    });
  });

  it('does not match the membership id', () => {
    expect(resolveActor('membership-grace', [grace], testUser)).toEqual({
      name: 'Former member',
    });
  });

  it('falls back to "Former member" without leaking identifiers', () => {
    const actor = resolveActor('user-gone', [grace], null);
    expect(actor).toEqual({ name: 'Former member' });
    expect(JSON.stringify(actor)).not.toMatch(/user-gone|@/);
  });
});

describe('validTimestamp', () => {
  it('keeps a valid ISO timestamp', () => {
    expect(validTimestamp('2026-10-22T08:30:00.000Z')).toBe(
      '2026-10-22T08:30:00.000Z',
    );
  });

  it.each(['', 'not a date', '2026-13-45T99:00:00Z'])('rejects %j', (value) => {
    expect(validTimestamp(value)).toBeUndefined();
  });
});
