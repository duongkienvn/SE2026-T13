import { QueryClient, type QueryKey } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { boardKeys } from '../boards/query-keys';
import { commentKeys } from '../comments/query-keys';
import { avatarKeys } from '../auth/avatar-query-keys';
import {
  BOARD_EVENTS,
  boardResyncTargets,
  invalidationTargets,
  type BoardEventName,
  type BoardEventPayload,
} from './event-invalidation';

const BOARD = 'board-a';
const OTHER = 'board-b';
const CARD = 'card-1';
const OTHER_CARD = 'card-2';

const cached = {
  board: boardKeys.detail(BOARD),
  members: boardKeys.members(BOARD),
  columns: boardKeys.columns(BOARD),
  cards: boardKeys.cards(BOARD),
  card: boardKeys.card(BOARD, CARD),
  otherCard: boardKeys.card(BOARD, OTHER_CARD),
  archived: boardKeys.archivedCardsPage(BOARD, 1),
  archivedPage2: boardKeys.archivedCardsPage(BOARD, 2),
  boardList: boardKeys.lists(),
  otherBoard: boardKeys.detail(OTHER),
  otherCards: boardKeys.cards(OTHER),
  otherBoardCard: boardKeys.card(OTHER, CARD),
  otherArchived: boardKeys.archivedCardsPage(OTHER, 1),
  commentsPage1: commentKeys.page(BOARD, CARD, 1),
  commentsPage2: commentKeys.page(BOARD, CARD, 2),
  otherCardComments: commentKeys.page(BOARD, OTHER_CARD, 1),
  otherBoardComments: commentKeys.page(OTHER, CARD, 1),
  avatar: avatarKeys.image(0, '/users/user-1/avatar/asset-1'),
  newerAvatar: avatarKeys.image(1, '/users/user-1/avatar/asset-2'),
} satisfies Record<string, QueryKey>;
type CachedQuery = keyof typeof cached;

/** Applies the targets to a seeded cache and names the queries they hit. */
async function invalidated(
  targets: ReturnType<typeof boardResyncTargets>,
): Promise<CachedQuery[]> {
  const client = new QueryClient();
  for (const key of Object.values(cached)) client.setQueryData(key, {});
  await Promise.all(targets.map((target) => client.invalidateQueries(target)));
  return (Object.keys(cached) as CachedQuery[]).filter(
    (name) => client.getQueryState(cached[name])?.isInvalidated,
  );
}

function hit<E extends BoardEventName>(
  event: E,
  payload: BoardEventPayload<E>,
) {
  return invalidated(invalidationTargets(event, payload));
}

const column = { boardId: BOARD, columnId: 'column-1' };
const cardEvent = { boardId: BOARD, cardId: CARD, columnId: 'column-1' };
const member = { boardId: BOARD, userId: 'user-1' };

describe('BOARD_EVENTS', () => {
  it('lists the Board events of the shared contract', () => {
    expect([...BOARD_EVENTS].sort()).toEqual([
      'board:access-changed',
      'board:access-revoked',
      'board:archived',
      'board:restored',
      'card:archived',
      'card:assignees-changed',
      'card:created',
      'card:moved',
      'card:restored',
      'card:updated',
      'column:created',
      'column:deleted',
      'column:moved',
      'column:updated',
      'comment:created',
      'comment:deleted',
      'comment:updated',
      'labels:changed',
      'member:added',
      'member:removed',
      'member:role-changed',
    ]);
  });
});

describe('invalidationTargets', () => {
  it.each(['board:archived', 'board:restored'] as const)(
    '%s refreshes board detail and both list scopes',
    async (event) => {
      const client = new QueryClient();
      client.setQueryData(boardKeys.detail(BOARD), {});
      client.setQueryData(boardKeys.columns(BOARD), {});
      client.setQueryData(boardKeys.list('active'), {});
      client.setQueryData(boardKeys.list('archived'), {});
      client.setQueryData(boardKeys.detail(OTHER), {});
      for (const target of invalidationTargets(event, { boardId: BOARD })) {
        await client.invalidateQueries(target);
      }
      expect(client.getQueryState(boardKeys.detail(BOARD))?.isInvalidated).toBe(
        true,
      );
      expect(
        client.getQueryState(boardKeys.list('active'))?.isInvalidated,
      ).toBe(true);
      expect(
        client.getQueryState(boardKeys.list('archived'))?.isInvalidated,
      ).toBe(true);
      expect(
        client.getQueryState(boardKeys.columns(BOARD))?.isInvalidated,
      ).toBe(false);
      expect(client.getQueryState(boardKeys.detail(OTHER))?.isInvalidated).toBe(
        false,
      );
    },
  );
  it.each([
    'column:created',
    'column:updated',
    'column:moved',
    'column:deleted',
  ] as const)('%s refreshes only the columns', async (event) => {
    expect(await hit(event, column)).toEqual(['columns']);
  });

  it.each(['card:created', 'card:updated', 'card:assignees-changed'] as const)(
    '%s refreshes the card list, detail and its comments',
    async (event) => {
      expect(await hit(event, cardEvent)).toEqual([
        'cards',
        'card',
        'commentsPage1',
        'commentsPage2',
      ]);
    },
  );

  it.each(['card:archived', 'card:restored'] as const)(
    '%s refreshes both lists, the detail and comments',
    async (event) => {
      expect(await hit(event, cardEvent)).toEqual([
        'cards',
        'card',
        'archived',
        'archivedPage2',
        'commentsPage1',
        'commentsPage2',
      ]);
    },
  );

  it('card:moved refreshes the whole card list, so both columns update', async () => {
    const moved = {
      boardId: BOARD,
      cardId: CARD,
      fromColumnId: 'column-1',
      toColumnId: 'column-2',
    };

    expect(await hit('card:moved', moved)).toEqual([
      'cards',
      'card',
      'commentsPage1',
      'commentsPage2',
    ]);
  });

  it('labels:changed refreshes all Card queries and archived pages of its Board', async () => {
    expect(
      await hit('labels:changed', { boardId: BOARD, labelId: 'label-1' }),
    ).toEqual([
      'cards',
      'card',
      'otherCard',
      'archived',
      'archivedPage2',
      'commentsPage1',
      'commentsPage2',
      'otherCardComments',
    ]);
  });

  it('labels:changed isolates Boards even when cached Card IDs match', async () => {
    expect(
      await hit('labels:changed', { boardId: OTHER, labelId: 'label-1' }),
    ).toEqual([
      'otherCards',
      'otherBoardCard',
      'otherArchived',
      'otherBoardComments',
    ]);
  });

  it('member:added refreshes membership and any newly granted collaboration role', async () => {
    expect(await hit('member:added', member)).toEqual([
      'board',
      'members',
      'boardList',
    ]);
  });

  it('member:role-changed also refreshes the role shown on the board', async () => {
    expect(await hit('member:role-changed', member)).toEqual([
      'board',
      'members',
      'boardList',
    ]);
  });

  it('member:removed also refreshes every card and cached avatar permissions', async () => {
    expect(await hit('member:removed', member)).toEqual([
      'board',
      'members',
      'cards',
      'card',
      'otherCard',
      'archived',
      'archivedPage2',
      'boardList',
      'commentsPage1',
      'commentsPage2',
      'otherCardComments',
      'avatar',
      'newerAvatar',
    ]);
  });

  it.each(['comment:created', 'comment:updated', 'comment:deleted'] as const)(
    '%s refetches only pages of its card',
    async (event) => {
      expect(
        await hit(event, {
          boardId: BOARD,
          cardId: CARD,
          commentId: 'comment',
        }),
      ).toEqual(['commentsPage1', 'commentsPage2']);
    },
  );

  it('never touches another board', async () => {
    for (const event of BOARD_EVENTS) {
      const payload = {
        boardId: BOARD,
        cardId: CARD,
        columnId: 'column-1',
        fromColumnId: 'column-1',
        toColumnId: 'column-2',
        userId: 'user-1',
        labelId: 'label-1',
      };
      const names = await invalidated(invalidationTargets(event, payload));
      expect(names).not.toContain('otherBoard');
      expect(names).not.toContain('otherCards');
      expect(names).not.toContain('otherBoardCard');
      expect(names).not.toContain('otherArchived');
      expect(names).not.toContain('otherBoardComments');
    }
  });
});

describe('boardResyncTargets', () => {
  it('refreshes everything of the board and nothing of another', async () => {
    expect(await invalidated(boardResyncTargets(BOARD))).toEqual([
      'board',
      'members',
      'columns',
      'cards',
      'card',
      'otherCard',
      'archived',
      'archivedPage2',
      'boardList',
      'commentsPage1',
      'commentsPage2',
      'otherCardComments',
    ]);
  });
});
