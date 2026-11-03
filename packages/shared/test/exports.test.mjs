import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  ActivityActionType,
  ActivityEntityType,
  APP_NAME,
  BoardRole,
  RealtimeEvent,
  TaskGroup,
  GlobalSearchType,
  NotificationKind,
  RealtimeNotificationEvent,
} from '@kanban/shared';

const require = createRequire(import.meta.url);

test('exports notification kinds and separate ID-free invalidation in both formats', () => {
  assert.deepEqual(Object.values(NotificationKind), [
    'CARD_ASSIGNED',
    'COMMENT_MENTIONED',
    'WORKSPACE_INVITED',
    'BOARD_INVITED',
    'MEMBERSHIP_CHANGED',
    'DUE_REMINDER',
  ]);
  assert.deepEqual(RealtimeNotificationEvent, {
    CHANGED: 'notifications:changed',
  });
  assert.deepEqual(
    require('@kanban/shared').NotificationKind,
    NotificationKind,
  );
  assert.deepEqual(
    require('@kanban/shared').RealtimeNotificationEvent,
    RealtimeNotificationEvent,
  );
});

test('exports global search types to ESM and CommonJS', () => {
  assert.deepEqual(GlobalSearchType, {
    ALL: 'all',
    WORKSPACES: 'workspaces',
    BOARDS: 'boards',
    CARDS: 'cards',
  });
  assert.deepEqual(
    require('@kanban/shared').GlobalSearchType,
    GlobalSearchType,
  );
});

test('exports exhaustive productivity groups to both module formats', () => {
  assert.deepEqual(TaskGroup, {
    OVERDUE: 'OVERDUE',
    NEXT_7_DAYS: 'NEXT_7_DAYS',
    LATER: 'LATER',
    NO_DUE_DATE: 'NO_DUE_DATE',
  });
  assert.deepEqual(require('@kanban/shared').TaskGroup, TaskGroup);
});

test('exports the same realtime event names for both module formats', () => {
  assert.deepEqual(RealtimeEvent, {
    BOARD_JOIN: 'board:join',
    BOARD_LEAVE: 'board:leave',
  });
  assert.deepEqual(require('@kanban/shared').RealtimeEvent, RealtimeEvent);
});

test('provides the same named export to ESM and CommonJS consumers', () => {
  assert.equal(APP_NAME, 'Realtime Collaborative Kanban');
  assert.equal(require('@kanban/shared').APP_NAME, APP_NAME);
});

test('provides the shared domain values to ESM and CommonJS consumers', () => {
  const shared = require('@kanban/shared');

  assert.deepEqual(BoardRole, { OWNER: 'OWNER', MEMBER: 'MEMBER' });
  assert.deepEqual(ActivityActionType, {
    BOARD_UPDATED: 'BOARD_UPDATED',
    BOARD_ARCHIVED: 'BOARD_ARCHIVED',
    BOARD_RESTORED: 'BOARD_RESTORED',
    MEMBER_ADDED: 'MEMBER_ADDED',
    MEMBER_REMOVED: 'MEMBER_REMOVED',
    ROLE_CHANGED: 'ROLE_CHANGED',
    COLUMN_CREATED: 'COLUMN_CREATED',
    COLUMN_UPDATED: 'COLUMN_UPDATED',
    COLUMN_MOVED: 'COLUMN_MOVED',
    COLUMN_DELETED: 'COLUMN_DELETED',
    CARD_CREATED: 'CARD_CREATED',
    CARD_UPDATED: 'CARD_UPDATED',
    CARD_MOVED: 'CARD_MOVED',
    CARD_ARCHIVED: 'CARD_ARCHIVED',
    CARD_RESTORED: 'CARD_RESTORED',
    COMMENT_CREATED: 'COMMENT_CREATED',
    COMMENT_UPDATED: 'COMMENT_UPDATED',
    COMMENT_DELETED: 'COMMENT_DELETED',
  });
  assert.deepEqual(ActivityEntityType, {
    BOARD: 'BOARD',
    COLUMN: 'COLUMN',
    CARD: 'CARD',
    COMMENT: 'COMMENT',
    MEMBER: 'MEMBER',
  });
  assert.deepEqual(
    {
      BoardRole: shared.BoardRole,
      ActivityActionType: shared.ActivityActionType,
      ActivityEntityType: shared.ActivityEntityType,
    },
    { BoardRole, ActivityActionType, ActivityEntityType },
  );
});
