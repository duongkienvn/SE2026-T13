import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  makeBoard,
  makeCard,
  makeColumn,
  okPage,
} from '../../../test/board-fixtures';
import {
  fail,
  mockApi,
  ok,
  storeSession,
  testUser,
} from '../../../test/mock-api';
import { renderApp } from '../../../test/render';
import { createdSockets, joined } from '../../../test/fake-socket';

describe('Calendar view', () => {
  it.each(['archived', 'workspace viewer'] as const)(
    'shows %s cards without enabling edits',
    async (mode) => {
      storeSession();
      const board = makeBoard(
        mode === 'archived'
          ? { isArchived: true }
          : { currentUserRole: null, visibility: 'WORKSPACE_VISIBLE' },
      );
      const column = makeColumn({ boardId: board.id });
      const card = makeCard({
        boardId: board.id,
        columnId: column.id,
        title: 'Read-only card',
        dueDate: new Date().toISOString(),
      });
      const calls = mockApi({
        'GET /users/me': ok(testUser),
        [`GET /boards/${board.id}`]: ok(board),
        [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([column]),
        [`GET /boards/${board.id}/cards?page=1&limit=100`]: okPage([card]),
        [`GET /boards/${board.id}/cards/${card.id}`]: ok(card),
        [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
      });
      renderApp(`/boards/${board.id}/calendar`);
      fireEvent.click(
        await screen.findByRole('button', { name: /Read-only card/ }),
      );
      fireEvent.click(
        within(
          screen.getByRole('complementary', { name: 'Selected card' }),
        ).getByRole('button', { name: 'Open card' }),
      );
      const dialog = await screen.findByRole('dialog');
      expect(
        within(dialog).queryByRole('button', { name: 'Edit title' }),
      ).toBeNull();
      if (mode === 'workspace viewer')
        expect(calls.some((call) => call.path.includes('/members?'))).toBe(
          false,
        );
    },
  );
  it('refreshes cards on realtime updates and removes them after revocation', async () => {
    storeSession();
    const board = makeBoard();
    const column = makeColumn({ boardId: board.id });
    const card = makeCard({
      boardId: board.id,
      columnId: column.id,
      title: 'Private scheduled card',
      dueDate: new Date().toISOString(),
    });
    let listed: (typeof card)[] = [];
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${board.id}`]: ok(board),
      [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([column]),
      [`GET /boards/${board.id}/cards?page=1&limit=100`]: () => okPage(listed),
      [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
    });
    renderApp(`/boards/${board.id}/calendar`);
    await screen.findByRole('heading', { name: board.name });
    await waitFor(() => expect(createdSockets.length).toBeGreaterThan(0));
    const { socket } = createdSockets.at(-1)!;
    act(() => socket.open());
    await waitFor(() =>
      expect(socket.requests('board:join').length).toBeGreaterThan(0),
    );
    act(() => socket.lastJoin().reply(joined(board.id)));
    listed = [card];
    act(() =>
      socket.push('card:created', {
        boardId: board.id,
        cardId: card.id,
        columnId: column.id,
      }),
    );
    await screen.findByRole('button', { name: /Private scheduled card/ });
    act(() => socket.push('board:access-revoked', { boardId: board.id }));
    await screen.findByRole('heading', { name: 'Board not found' });
    expect(screen.queryByText('Private scheduled card')).toBeNull();
  });
  it('hides the calendar when card access is denied', async () => {
    storeSession();
    const board = makeBoard();
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${board.id}`]: ok(board),
      [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([]),
      [`GET /boards/${board.id}/cards?page=1&limit=100`]: fail(
        403,
        'FORBIDDEN',
      ),
      [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
    });
    renderApp(`/boards/${board.id}/calendar`);
    expect(await screen.findByText('Checking board access…')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Calendar' })).toBeNull();
  });

  it('opens overflow cards and returns to the selected calendar with filters', async () => {
    storeSession();
    const board = makeBoard();
    const column = makeColumn({ boardId: board.id });
    const dueDate = new Date().toISOString();
    const cards = ['First', 'Second', 'Third'].map((title) =>
      makeCard({ boardId: board.id, columnId: column.id, title, dueDate }),
    );
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${board.id}`]: ok(board),
      [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([column]),
      [`GET /boards/${board.id}/cards?page=1&limit=100&q=Card`]: okPage(cards),
      [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
      [`GET /boards/${board.id}/cards/${cards[2].id}`]: ok(cards[2]),
    });
    const { router } = renderApp(`/boards/${board.id}/calendar?q=Card`);
    const heading = await screen.findByRole('heading', {
      level: 2,
      name: /\w+ \d{4}/,
    });
    const initialMonth = heading.textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(heading.textContent).not.toBe(initialMonth);
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(heading.textContent).toBe(initialMonth);
    expect(router.state.location.search).toBe('?q=Card');
    const more = await screen.findByText('+1 more');
    fireEvent.click(more);
    fireEvent.click(screen.getByRole('button', { name: /^Third/ }));
    const inspector = screen.getByRole('complementary', {
      name: 'Selected card',
    });
    expect(within(inspector).getByText('Third')).toBeTruthy();
    fireEvent.click(
      within(inspector).getByRole('button', { name: 'Open card' }),
    );
    expect(router.state.location.pathname).toBe(
      `/boards/${board.id}/cards/${cards[2].id}`,
    );
    expect(router.state.location.search).toBe('?q=Card');
    fireEvent.click(await screen.findByRole('button', { name: 'Close card' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/boards/${board.id}/calendar`,
      ),
    );
    expect(router.state.location.search).toBe('?q=Card');
    expect(
      screen.getByRole('complementary', { name: 'Selected card' }),
    ).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(
      screen.queryByRole('complementary', { name: 'Selected card' }),
    ).toBeNull();
  });
});
