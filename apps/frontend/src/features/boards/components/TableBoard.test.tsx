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
  makeMember,
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

  it('refreshes the current page after a realtime card archive', async () => {
    storeSession();
    const board = makeBoard();
    const column = makeColumn({ boardId: board.id });
    const card = makeCard({
      boardId: board.id,
      columnId: column.id,
      title: 'Archived remotely',
    });
    let listed = [card];
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${board.id}`]: ok(board),
      [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([column]),
      [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
      [`GET /boards/${board.id}/cards?page=1&limit=100&sortBy=title&sortDirection=asc`]:
        () => okPage(listed),
    });
    renderApp(`/boards/${board.id}/table`);
    await screen.findByRole('button', { name: 'Archived remotely' });
    await waitFor(() => expect(createdSockets.length).toBeGreaterThan(0));
    const { socket } = createdSockets.at(-1)!;
    act(() => socket.open());
    await waitFor(() =>
      expect(socket.requests('board:join').length).toBeGreaterThan(0),
    );
    act(() => socket.lastJoin().reply(joined(board.id)));
    listed = [];
    act(() =>
      socket.push('card:archived', {
        boardId: board.id,
        cardId: card.id,
        columnId: column.id,
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Archived remotely' }),
      ).toBeNull(),
    );
    expect(screen.getByText('No cards on this board yet.')).toBeTruthy();
  });

  it.each(['archived', 'workspace viewer'] as const)(
    'opens %s cards without enabling writes or leaking the roster',
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
      });
      const calls = mockApi({
        'GET /users/me': ok(testUser),
        [`GET /boards/${board.id}`]: ok(board),
        [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([column]),
        [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
        [`GET /boards/${board.id}/cards?page=1&limit=100&sortBy=title&sortDirection=asc`]:
          okPage([card]),
        [`GET /boards/${board.id}/cards/${card.id}`]: ok(card),
      });
      renderApp(`/boards/${board.id}/table`);
      fireEvent.click(
        await screen.findByRole('button', { name: 'Open Read-only card' }),
      );
      const dialog = await screen.findByRole('dialog');
      expect(
        within(dialog).queryByRole('button', { name: 'Edit title' }),
      ).toBeNull();
      expect(
        within(dialog).queryByRole('button', { name: /Duplicate card/i }),
      ).toBeNull();
      if (mode === 'workspace viewer')
        expect(calls.some((call) => call.path.includes('/members?'))).toBe(
          false,
        );
    },
  );

  it('renders canonical metadata, accessible assignee names and separate due status', async () => {
    storeSession();
    const board = makeBoard();
    const column = makeColumn({ boardId: board.id, name: 'Review' });
    const member = makeMember();
    const labelId = '00000000-0000-4000-9000-000000000099';
    const longTitle = 'Long card title '.repeat(12).trim();
    const card = makeCard({
      boardId: board.id,
      columnId: column.id,
      title: longTitle,
      dueDate: '2020-01-01T12:00:00Z',
      assignees: [
        {
          userId: member.user.id,
          assignedById: null,
          createdAt: '2020-01-01T00:00:00Z',
        },
      ],
    });
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${board.id}`]: ok(board),
      [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([column]),
      [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([member]),
      [`GET /boards/${board.id}/labels?page=1&limit=100`]: okPage([
        {
          id: labelId,
          boardId: board.id,
          name: 'Important label',
          color: '#112233',
        },
      ]),
      [`GET /boards/${board.id}/cards?page=1&limit=100&sortBy=title&sortDirection=asc`]:
        okPage([card]),
      [`GET /boards/${board.id}/card-preview-summaries?cardIds=${card.id}`]: ok(
        {
          summaries: [
            {
              cardId: card.id,
              labelIds: [labelId],
              checklist: { checkedItems: 1, totalItems: 3 },
              attachmentCount: 0,
              commentCount: 0,
            },
          ],
        },
      ),
    });
    renderApp(`/boards/${board.id}/table`);
    const row = (
      await screen.findByRole('button', { name: longTitle })
    ).closest('tr')!;
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeTruthy();
    expect(await within(row).findByText('Important label')).toBeTruthy();
    expect(
      within(row).getByRole('img', { name: member.user.displayName }),
    ).toBeTruthy();
    expect(
      within(row)
        .getByRole('progressbar', { name: `Checklist for ${longTitle}` })
        .getAttribute('value'),
    ).toBe('1');
    expect(within(row).getByText('Review')).toBeTruthy();
    expect(within(row).getByText('Overdue')).toBeTruthy();
    expect(within(row).queryByText(member.user.email!)).toBeNull();
  });

  it('synchronizes submitted search, history and the shared view selector', async () => {
    storeSession();
    const board = makeBoard();
    const base = `/boards/${board.id}/cards?page=1&limit=100`;
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${board.id}`]: ok(board),
      [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([]),
      [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
      [`GET ${base}&sortBy=title&sortDirection=asc`]: okPage([]),
      [`GET ${base}&q=two+words&sortBy=title&sortDirection=asc`]: okPage([]),
      [`GET ${base}&q=two+words`]: okPage([]),
    });
    const { router } = renderApp(`/boards/${board.id}/table`);
    const input = await screen.findByRole('textbox', { name: 'Search cards' });
    fireEvent.change(input, { target: { value: 'two words' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() =>
      expect(router.state.location.search).toBe('?q=two+words'),
    );
    expect(await screen.findByText('Keyword: two words')).toBeTruthy();
    const views = screen.getByRole('navigation', { name: 'Board views' });
    expect(
      within(views)
        .getByRole('link', { name: 'Calendar' })
        .getAttribute('href'),
    ).toContain('/calendar?q=two+words');
    fireEvent.click(within(views).getByRole('link', { name: 'Calendar' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/boards/${board.id}/calendar`,
      ),
    );
    expect(router.state.location.search).toBe('?q=two+words');
    await act(async () => {
      await router.navigate(-1);
    });
    expect(router.state.location.pathname).toBe(`/boards/${board.id}/table`);
    expect(
      (
        (await screen.findByRole('textbox', {
          name: 'Search cards',
        })) as HTMLInputElement
      ).value,
    ).toBe('two words');
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(
      (
        screen.getByRole('textbox', {
          name: 'Search cards',
        }) as HTMLInputElement
      ).value,
    ).toBe('');
  });
  it('keeps the board photo and filters while switching Calendar and Table', async () => {
    storeSession();
    const board = makeBoard({ backgroundPreset: 'lake' });
    const base = `/boards/${board.id}/cards?page=1&limit=100&q=match`;
    mockApi({
      'GET /users/me': ok(testUser),
      [`GET /boards/${board.id}`]: ok(board),
      'GET /boards/background-presets': ok([
        { id: 'lake', kind: 'photo', value: 'lake' },
      ]),
      [`GET /boards/${board.id}/columns?page=1&limit=100`]: okPage([]),
      [`GET /boards/${board.id}/members?page=1&limit=100`]: okPage([]),
      [`GET ${base}&sortBy=title&sortDirection=asc`]: okPage([]),
      [`GET ${base}`]: okPage([]),
    });
    const { router } = renderApp(`/boards/${board.id}/table?q=match`);
    const tableCanvas = await screen.findByRole('region', {
      name: 'Table workspace',
    });
    await waitFor(() =>
      expect(tableCanvas.getAttribute('style')).toContain(
        '/board-backgrounds/lake.jpg',
      ),
    );
    fireEvent.click(
      within(
        await screen.findByRole('navigation', { name: 'Board views' }),
      ).getByRole('link', { name: 'Calendar' }),
    );
    const calendarCanvas = await screen.findByRole('region', {
      name: 'Calendar workspace',
    });
    expect(calendarCanvas.getAttribute('style')).toContain(
      '/board-backgrounds/lake.jpg',
    );
    expect(router.state.location.search).toBe('?q=match');
    fireEvent.click(
      within(
        await screen.findByRole('navigation', { name: 'Board views' }),
      ).getByRole('link', { name: 'Table' }),
    );
    expect(
      (
        await screen.findByRole('region', { name: 'Table workspace' })
      ).getAttribute('style'),
    ).toContain('/board-backgrounds/lake.jpg');
    expect(router.state.location.search).toBe('?q=match');
  });
});
