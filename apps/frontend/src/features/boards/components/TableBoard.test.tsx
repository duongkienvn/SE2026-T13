import { act, fireEvent, screen, waitFor } from '@testing-library/react';
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

describe('Table view', () => {
  it('opens a card and sends sort changes to the paginated API', async () => {
    storeSession();
    const board = makeBoard();
    const column = makeColumn({ boardId: board.id, name: 'In progress' });
    const card = makeCard({
      boardId: board.id,
      columnId: column.id,
      title: 'A card',
    });
    const base = `/boards/${board.id}/cards?page=1&limit=100`;
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${board.id}`]: ok(board),
      [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([column]),
      [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
      [`GET ${base}&sortBy=title&sortDirection=asc`]: okPage([card]),
      [`GET ${base}&sortBy=dueDate&sortDirection=asc`]: okPage([card]),
      [`GET /boards/${board.id}/cards/${card.id}`]: ok(card),
    });
    const { router } = renderApp(`/boards/${board.id}/table`);
    expect(await screen.findByRole('button', { name: 'A card' })).toBeTruthy();
    expect(screen.getByText('In progress')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Due date/ }));
    await waitFor(() =>
      expect(
        screen
          .getByRole('columnheader', { name: /Due date/ })
          .getAttribute('aria-sort'),
      ).toBe('ascending'),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'A card' }));
    expect(router.state.location.pathname).toBe(
      `/boards/${board.id}/cards/${card.id}`,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Close card' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/boards/${board.id}/table`),
    );
  });

  it('hides cached rows if the card endpoint denies access', async () => {
    storeSession();
    const board = makeBoard();
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${board.id}`]: ok(board),
      [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([]),
      [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
      [`GET /boards/${board.id}/cards?page=1&limit=100&sortBy=title&sortDirection=asc`]:
        fail(403, 'FORBIDDEN'),
    });
    renderApp(`/boards/${board.id}/table`);
    expect(await screen.findByText('Checking board access…')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('keeps filters and server sorting while paging', async () => {
    storeSession();
    const board = makeBoard();
    const column = makeColumn({ boardId: board.id });
    const first = makeCard({
      boardId: board.id,
      columnId: column.id,
      title: 'First match',
    });
    const last = makeCard({
      boardId: board.id,
      columnId: column.id,
      title: 'Last match',
    });
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${board.id}`]: ok(board),
      [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([column]),
      [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
      [`GET /boards/${board.id}/cards?page=1&limit=100&q=match&sortBy=title&sortDirection=asc`]:
        okPage([first], { total: 101 }),
      [`GET /boards/${board.id}/cards?page=2&limit=100&q=match&sortBy=title&sortDirection=asc`]:
        okPage([last], { page: 2, total: 101 }),
    });
    const { router } = renderApp(`/boards/${board.id}/table?q=match`);
    expect(
      await screen.findByRole('button', { name: 'First match' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(
      await screen.findByRole('button', { name: 'Last match' }),
    ).toBeTruthy();
    expect(screen.getByText('Showing 101–101 of 101 cards')).toBeTruthy();
    expect(router.state.location.search).toBe('?q=match');
  });

  it('removes visible rows after realtime access revocation', async () => {
    storeSession();
    const board = makeBoard();
    const column = makeColumn({ boardId: board.id });
    const card = makeCard({
      boardId: board.id,
      columnId: column.id,
      title: 'Private row',
    });
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${board.id}`]: ok(board),
      [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([column]),
      [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
      [`GET /boards/${board.id}/cards?page=1&limit=100&sortBy=title&sortDirection=asc`]:
        okPage([card]),
    });
    renderApp(`/boards/${board.id}/table`);
    await screen.findByRole('button', { name: 'Private row' });
    await waitFor(() => expect(createdSockets.length).toBeGreaterThan(0));
    const { socket } = createdSockets.at(-1)!;
    act(() => socket.open());
    await waitFor(() =>
      expect(socket.requests('board:join').length).toBeGreaterThan(0),
    );
    act(() => socket.lastJoin().reply(joined(board.id)));
    act(() => socket.push('board:access-revoked', { boardId: board.id }));
    await screen.findByRole('heading', { name: 'Board not found' });
    expect(screen.queryByText('Private row')).toBeNull();
  });
});
