import { focusManager } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  makeBoard,
  makeCard,
  makeColumn,
  okPage,
} from '../../../test/board-fixtures';
import { createdSockets, joined } from '../../../test/fake-socket';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
  type MockResponse,
} from '../../../test/mock-api';
import { renderApp } from '../../../test/render';

const board = makeBoard({ name: 'Launch', currentUserRole: 'OWNER' });
const column = makeColumn({ boardId: board.id, name: 'To do' });
const BOARD = `GET /boards/${board.id}`;
const CARDS = `GET /boards/${board.id}/cards?page=1&limit=100`;

type Handler = MockResponse | (() => MockResponse);

/** Opens the board page and answers its join, so other users' changes arrive. */
async function openLiveBoard(extra: Record<string, Handler> = {}) {
  storeSession();
  mockApi({
    'GET /users/me': ok(testUser),
    [BOARD]: ok(board),
    [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([column]),
    [CARDS]: okPage([]),
    [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
    ...extra,
  });
  renderApp(`/boards/${board.id}`);
  const main = within(await screen.findByRole('main'));
  await main.findByRole('heading', { name: 'Launch' });
  await waitFor(() => expect(createdSockets).toHaveLength(1));
  const { socket } = createdSockets[0];
  act(() => socket.open());
  act(() => socket.lastJoin().reply(joined(board.id)));
  return { main, socket };
}

/** Returns each response in turn, repeating the last one. */
function sequence(...responses: MockResponse[]) {
  let calls = 0;
  return () => responses[Math.min(calls++, responses.length - 1)];
}

afterEach(() => focusManager.setFocused(undefined));

describe('BoardDetailPage realtime', () => {
  it('shows initial presence without waiting for a second viewer or creating another connection', async () => {
    const { main, socket } = await openLiveBoard();
    act(() =>
      socket.push('presence:sync', {
        boardId: board.id,
        userIds: [testUser.id],
      }),
    );
    expect(
      main.getByRole('button', { name: '1 person viewing. Show viewers' }),
    ).toBeTruthy();
    expect(createdSockets).toHaveLength(1);
    expect(socket.requests('board:join')).toHaveLength(1);
    expect(main.getByRole('link', { name: 'Members' })).toBeTruthy();
    expect(
      main.getByRole('button', { name: 'Actions for Launch' }),
    ).toBeTruthy();
  });

  it('keeps presence on archived boards while edit controls remain unavailable', async () => {
    const { main, socket } = await openLiveBoard({
      [BOARD]: ok({ ...board, isArchived: true }),
    });
    act(() =>
      socket.push('presence:sync', {
        boardId: board.id,
        userIds: [testUser.id],
      }),
    );
    expect(
      main.getByRole('button', { name: '1 person viewing. Show viewers' }),
    ).toBeTruthy();
    expect(main.getByRole('link', { name: 'Members' })).toBeTruthy();
    expect(
      main.getByRole('button', { name: 'Actions for Launch' }),
    ).toBeTruthy();
    expect(main.queryByRole('button', { name: 'Add column' })).toBeNull();
    expect(main.getByText(/This board is archived/)).toBeTruthy();
  });

  it('switches between read-only and active after board events without reload', async () => {
    const archived = {
      ...board,
      isArchived: true,
      archivedAt: new Date().toISOString(),
    };
    const { main, socket } = await openLiveBoard({
      [BOARD]: sequence(ok(board), ok(board), ok(archived), ok(board)),
    });
    act(() => socket.push('board:archived', { boardId: board.id }));
    expect(await main.findByText(/This board is archived/)).toBeTruthy();
    expect(main.queryByRole('button', { name: 'Add column' })).toBeNull();
    act(() => socket.push('board:restored', { boardId: board.id }));
    await waitFor(() =>
      expect(main.queryByText(/This board is archived/)).toBeNull(),
    );
    expect(main.getByRole('button', { name: 'Add column' })).toBeTruthy();
  });

  it("shows another user's new card without a reload", async () => {
    const card = makeCard({
      boardId: board.id,
      columnId: column.id,
      title: 'Write the launch post',
    });
    let listed: ReturnType<typeof makeCard>[] = [];
    const { main, socket } = await openLiveBoard({
      [CARDS]: () => okPage(listed),
    });
    expect(main.queryByText('Write the launch post')).toBeNull();

    listed = [card];
    act(() =>
      socket.push('card:created', {
        boardId: board.id,
        cardId: card.id,
        columnId: column.id,
      }),
    );

    expect(await main.findByText('Write the launch post')).toBeTruthy();
  });

  it('updates the role chip when the signed-in role changes elsewhere', async () => {
    const { main, socket } = await openLiveBoard({
      [BOARD]: sequence(
        ok(board),
        ok(board),
        ok({ ...board, currentUserRole: 'MEMBER' }),
      ),
    });
    await waitFor(() => expect(main.getByText('Owner')).toBeTruthy());

    act(() =>
      socket.push('member:role-changed', {
        boardId: board.id,
        userId: testUser.id,
      }),
    );

    expect(await main.findByText('Member')).toBeTruthy();
    expect(main.queryByText('Owner')).toBeNull();
  });

  it('shows a reconnecting pill only while the connection is down', async () => {
    const { main, socket } = await openLiveBoard();
    expect(main.queryByText('Reconnecting…')).toBeNull();

    act(() => socket.drop());
    expect(main.getByText('Reconnecting…').getAttribute('role')).toBe('status');

    act(() => socket.open());
    act(() => socket.lastJoin().reply(joined(board.id)));
    await waitFor(() => expect(main.queryByText('Reconnecting…')).toBeNull());
  });

  it('hides the board and leaves its room once REST says access is gone', async () => {
    // A removed member gets no event of their own; returning to the tab
    // refetches the board, which now answers 404.
    const { main, socket } = await openLiveBoard({
      [BOARD]: sequence(ok(board), ok(board), fail(404, 'BOARD_NOT_FOUND')),
    });
    act(() =>
      socket.push('presence:sync', {
        boardId: board.id,
        userIds: [testUser.id],
      }),
    );
    expect(
      main.getByRole('button', { name: '1 person viewing. Show viewers' }),
    ).toBeTruthy();

    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    expect(await main.findByText('Board not found')).toBeTruthy();
    expect(main.queryByRole('heading', { name: 'Launch' })).toBeNull();
    expect(
      main.queryByRole('button', { name: '1 person viewing. Show viewers' }),
    ).toBeNull();
    await waitFor(() =>
      expect(socket.requests('board:leave').map((r) => r.boardId)).toEqual([
        board.id,
      ]),
    );
  });
});
