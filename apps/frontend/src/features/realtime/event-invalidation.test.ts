import { QueryClient, type QueryKey } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { boardKeys } from '../boards/query-keys';
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
  boardList: boardKeys.lists(),
  otherBoard: boardKeys.detail(OTHER),
  otherCards: boardKeys.cards(OTHER),
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
  it('lists the 12 board events of the shared contract', () => {
    expect([...BOARD_EVENTS].sort()).toEqual([
      'card:archived',
      'card:assignees-changed',
      'card:created',
      'card:moved',
      'card:updated',
      'column:created',
      'column:deleted',
      'column:moved',
      'column:updated',
      'member:added',
      'member:removed',
      'member:role-changed',
    ]);
  });
});

describe('invalidationTargets', () => {
  it.each([
    'column:created',
    'column:updated',
    'column:moved',
    'column:deleted',
  ] as const)('%s refreshes only the columns', async (event) => {
    expect(await hit(event, column)).toEqual(['columns']);
  });

  it.each([
    'card:created',
    'card:updated',
    'card:archived',
    'card:assignees-changed',
  ] as const)(
    '%s refreshes the card list and that card only',
    async (event) => {
      expect(await hit(event, cardEvent)).toEqual(['cards', 'card']);
    },
  );

  it('card:moved refreshes the whole card list, so both columns update', async () => {
    const moved = {
      boardId: BOARD,
      cardId: CARD,
      fromColumnId: 'column-1',
      toColumnId: 'column-2',
    };

    expect(await hit('card:moved', moved)).toEqual(['cards', 'card']);
  });

  it('member:added refreshes the members', async () => {
    expect(await hit('member:added', member)).toEqual(['members']);
  });

  it('member:role-changed also refreshes the role shown on the board', async () => {
    expect(await hit('member:role-changed', member)).toEqual([
      'board',
      'members',
      'boardList',
    ]);
  });

  it('member:removed also refreshes every card, for their assignees', async () => {
    expect(await hit('member:removed', member)).toEqual([
      'board',
      'members',
      'cards',
      'card',
      'otherCard',
      'boardList',
    ]);
  });

  it('never touches another board', async () => {
    for (const event of BOARD_EVENTS) {
      const payload = {
        boardId: BOARD,
        cardId: CARD,
        columnId: 'column-1',
        fromColumnId: 'column-1',
        toColumnId: 'column-2',
        userId: 'user-1',
      };
      const names = await invalidated(invalidationTargets(event, payload));
      expect(names).not.toContain('otherBoard');
      expect(names).not.toContain('otherCards');
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
    ]);
  });
});
