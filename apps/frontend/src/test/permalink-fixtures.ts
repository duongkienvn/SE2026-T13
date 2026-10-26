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

type Handler =
  | MockResponse
  | ((request: MockRequest) => MockResponse | Promise<MockResponse>);

export function openPermalink(
  options: {
    readonly direct?: boolean;
    readonly anonymous?: boolean;
    readonly archivedBoard?: boolean;
    readonly archivedCard?: boolean;
    readonly handlers?: Record<string, Handler>;
  } = {},
) {
  const board = makeBoard({
    name: 'Private board',
    isArchived: options.archivedBoard ?? false,
  });
  const column = makeColumn({ boardId: board.id });
  const card = makeCard({
    boardId: board.id,
    columnId: column.id,
    title: 'Private card',
    isArchived: options.archivedCard ?? false,
  });
  const path = `/boards/${board.id}`;
  const cardPath = `${path}/cards/${card.id}`;
  let boardResponse: MockResponse = ok(board);
  let cardResponse: MockResponse = ok(card);
  if (!options.anonymous) storeSession();
  const calls = mockApi({
    'GET /users/me': ok(testUser),
    [`GET ${path}`]: () => boardResponse,
    [`GET ${path}/columns?page=1&limit=100`]: okPage([column]),
    [`GET ${path}/cards?page=1&limit=100`]: okPage(
      options.archivedCard ? [] : [card],
    ),
    [`GET ${path}/members?page=1&limit=100`]: okPage([]),
    [`GET ${cardPath}`]: () => cardResponse,
    [`GET ${cardPath}/comments?page=1&limit=20`]: okPage([], { limit: 20 }),
    ...options.handlers,
  });
  const result = renderApp(
    options.direct ? cardPath : `${path}?filter=mine#kanban`,
  );
  return {
    ...result,
    board,
    card,
    path,
    cardPath,
    calls,
    refuseBoard: (response: MockResponse) => {
      boardResponse = response;
    },
    refuseCard: (response: MockResponse) => {
      cardResponse = response;
    },
  };
}
