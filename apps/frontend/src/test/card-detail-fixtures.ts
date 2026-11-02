import { screen } from '@testing-library/react';
import type { Card } from '../features/cards/types';
import { makeBoard, makeCard, makeColumn, okPage } from './board-fixtures';
import {
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockRequest,
  type MockResponse,
} from './mock-api';
import { renderApp } from './render';

export type Handler =
  | MockResponse
  | ((request: MockRequest) => MockResponse | Promise<MockResponse>);

/** Opens one card's detail directly, with its board around it. */
export function openCardDetail({
  card: overrides = {},
  boardArchived = false,
  readOnlyViewer = false,
  timeZone = 'UTC',
  extra = () => ({}),
}: {
  card?: Partial<Card>;
  boardArchived?: boolean;
  readOnlyViewer?: boolean;
  timeZone?: string;
  extra?: (card: Card, path: string) => Record<string, Handler>;
} = {}) {
  const board = makeBoard({
    name: 'Launch',
    isArchived: boardArchived,
    ...(readOnlyViewer
      ? { currentUserRole: null, capabilities: { canWriteBoard: false } }
      : {}),
  } as never);
  const column = makeColumn({ boardId: board.id, name: 'Doing' });
  const card = makeCard({
    boardId: board.id,
    columnId: column.id,
    title: 'Ship it',
    ...overrides,
  });
  const boardPath = `/boards/${board.id}`;
  const path = `${boardPath}/cards/${card.id}`;
  storeSession();
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    'GET /users/me/preferences': ok({
      theme: 'system',
      timeZone,
      dateFormat: 'YYYY-MM-DD',
      weekStartsOn: 'monday',
    }),
    [`GET ${boardPath}`]: ok(board),
    [`GET ${boardPath}/columns?page=1&limit=100`]: okPage([column]),
    [`GET ${boardPath}/cards?page=1&limit=100`]: okPage(
      card.isArchived ? [] : [card],
    ),
    [`GET ${boardPath}/members?page=1&limit=100`]: okPage([]),
    [`GET ${path}`]: ok(card),
    [`GET ${path}/comments?page=1&limit=20`]: okPage([], { limit: 20 }),
    ...extra(card, path),
  });
  const result = renderApp(path);
  const dialog = () => screen.findByRole('dialog', { name: card.title });
  return { ...result, board, card, path, boardPath, calls, dialog };
}

export const writes = (calls: MockRequest[]) =>
  calls.filter(
    (call) => call.method !== 'GET' && !call.path.endsWith('/views'),
  );
